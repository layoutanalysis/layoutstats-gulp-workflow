var path = require('path');
var endOfLine = require('os').EOL;
var del = require('del');

var gulp = require('gulp');
var ext_replace = require('gulp-ext-replace');
var jsonConcat = require('gulp-json-concat');
var jsonTransform = require('gulp-json-transform');
var uglifycss = require('uglifycss');
var merge = require('merge-stream');
var cssstats = require('cssstats');
var log = require('fancy-log');
var File = require('vinyl');
var getCSS = require('get-css');
var Queue = require('p-queue');
var vinylPaths = require('vinyl-paths');
var readFiles = require('read-vinyl-file-stream');


var newspapers = ['clarin','diepresse','eluniversal','nytimes','oglobo','repubblica','sz','elpais','guardian','lefigaro'];
const options = {
    cssByteSizeThreshold: 0.5, //snapshot must at least have 50% of the average CSS byte or it will be discarded as incomplete download
}


gulp.task('clean:dist', function(){
  return gulp.src('dist/*')
        .pipe(vinylPaths(del))
});

var URL_CACHE = {}
var CSS_FILE_CACHE = {}

function getOriginalCSSLink(archiveCSSLink){
    return archiveCSSLink.split('cs_/')[1];
}

function getCSSDownloadErrors(getCSSJson){
    return getCSSJson.links.filter(function(link){
        return link.error !== undefined && link.url.indexOf("fonts.googleapis.com") === -1;
    });
}

function updateCSSFileCache (getCSSJson){
    getCSSJson.links.forEach(function(link){
        if (link.error === undefined && link.css.length > 0){
            var origCSSLink = getOriginalCSSLink(link.url);
             if (!CSS_FILE_CACHE[origCSSLink]){
                 CSS_FILE_CACHE[origCSSLink] = link;
             }
        }
     });
}

function getMissingFilesFromCSSCache (getCSSJson){
    var CSSDownloadErrors = getCSSDownloadErrors(getCSSJson);
    if (CSSDownloadErrors.length > 0){
        var missingFiles = CSSDownloadErrors.map(link => link.url);
        missingFiles.forEach(function(missingFile, idx){
           var cachedFile = CSS_FILE_CACHE[getOriginalCSSLink(missingFile)];
           if (cachedFile){
               log.info("Replaced missing CSS file from cache:" + missingFile);
               missingIndex = getCSSJson.links.map(link => link.url).indexOf(missingFile);
               getCSSJson.links[missingIndex] = cachedFile;
           }
        });
    }
    return getCSSJson;
}

function buildCssStats (newspaper){
    var pipeline = gulp.src(`snapshot-css/${newspaper}*.json`)
        .pipe(readFiles(function (content, file, stream, cb) {
            try {
                var getCSSJson = JSON.parse(content);
                var isWebArchivePage = getCSSJson.html.indexOf('<title>Welcome to the US Petabox</title>') > -1;

                if (isWebArchivePage){
                    log.warn(`Skipping snapshot ${file.path} - it captured a wayback machine status page`);
                    return cb();
                }

                var CSSDownloadErrors = getCSSDownloadErrors(getCSSJson);

                updateCSSFileCache(getCSSJson);
                if (CSSDownloadErrors.length > 0){
                    getCSSJson = getMissingFilesFromCSSCache(getCSSJson);
                }


                var cssFileContents = getCSSJson.links.map(function(cssFile){
                    //exclude wayback machine's own css from the analysis
                    if (cssFile.url.indexOf('https://web.archive.org/static/css') > -1){
                        return '';
                    }
                    return cssFile.css;
                });
                var cssContents = cssFileContents.concat(getCSSJson.styles);
                var snapshotCSS =  cssContents.join('\n');

                var cssStats;
                var uglifiedCSS = uglifycss.processString(
                    snapshotCSS,
                    { maxLineLen: 500, expandVars: true }
                );
                cssStats = cssstats(uglifiedCSS);
                //cssStats found no declarations in stylesheet, so don't continue processing the result
                if (cssStats.declarations.total === 0){
                    return cb(); 
                }
            }
            catch (err) {
                log(`Error processing ${file.path}: ${err}`);
                return cb(); // cannot get cssstats for file, so don't continue processing it
            }

            cb(null,JSON.stringify(cssStats));
        }))
        .pipe(ext_replace('.json'))
        .pipe(gulp.dest('dist'));
    return pipeline;
}

gulp.task('cssstats',['clean:dist'], function () {
    var cssStatsTasks = newspapers.map(buildCssStats);
    return merge(cssStatsTasks);
});

gulp.task('snapshotFilesToURLs',['cssstats'],function(){
   return gulp.src('snapshot-css/*.txt')
       .pipe(readFiles(function (content, file, stream, cb) {
           var lines = content.split(endOfLine);
           var newspaper = path.basename(file.path,'.txt');
           lines.forEach(function (line, idx) {
               var dateBorder = line.split("://web.archive.org/web/");
               if (dateBorder[1]){
                   var snapshotDate = parseInt(dateBorder[1]);
                   var filename = `${newspaper}${snapshotDate}.json`;
                   var archiveUrl = line;
                   URL_CACHE[filename] = archiveUrl;
               }
           });
           cb(null,content);
       }))
       .pipe(gulp.dest('dist'));
});

function buildNewspaperJSON (newspaperID) {
    return gulp.src(`dist/${newspaperID}*.json`)
    //TODO: make sure each newspaper gets its own json file created
    .pipe(jsonConcat(`${newspaperID}.2007-2017.json`, function (data) {
        var jsonFileNames = Object.keys(data).sort();

        //filter out partial css captures - byte size  must be > averageCSSByteSize*Threshold
        var cssByteSizes = [];
        jsonFileNames = jsonFileNames.filter(function (fileName, idx, fileNames){
            var cssStats = data[fileName];
            if(cssStats && cssStats.size) {
                cssByteSizes.push(cssStats.size);
                var cssByteAverage = cssByteSizes.reduce((a,b) => (a+b)) / cssByteSizes.length;
                var threshold = cssByteAverage * options.cssByteSizeThreshold;
                var CSSByteSizeAboveThreshold = cssStats.size > threshold;
                if (!CSSByteSizeAboveThreshold) {
                    log.warn(`Skipping Snapshot ${fileName} - CSS size: ${cssStats.size} bytes is below threshold of ${threshold} bytes`);
                }
                return CSSByteSizeAboveThreshold;
            }
            return false;
        });

        var outJSON = jsonFileNames.map(function (fileName) {
            var cssStats = data[fileName];

            var cssProps = cssStats["declarations"]["properties"];
            var cssPropKeys = Object.keys(cssProps);
            var NonVendorProps = cssPropKeys.filter(function (prop) {
                return prop.startsWith('-') === false;
            });

            var analyzedProps = {};
            NonVendorProps.map(function (prop) {
                var uniquePropValues = [... new Set(cssProps[prop])]
                analyzedProps[prop] = uniquePropValues;
            });
            analyzedProps['snapshot-date'] = fileName.split("").filter(c => !isNaN(c)).join("");
            var lookupFilename =  path.basename(fileName) + '.json';
            console.log("Looking URL cache for file:" + lookupFilename);
            analyzedProps['url'] = URL_CACHE[lookupFilename];
            return analyzedProps;
        });
        return new Buffer(JSON.stringify(outJSON));
    }))
    .pipe(gulp.dest('dist/'))
}

gulp.task('concatjson',['snapshotFilesToURLs'], function(){

    newspaperTasks = newspapers.map(buildNewspaperJSON);
    return merge(newspaperTasks);
});

gulp.task('default',['concatjson']);


gulp.task('download_css', function(){
    var queue = new Queue({concurrency: 2});
    return gulp.src(['snapshot-css/lefigaro.txt'])  //breaks at Downloaded https://web.archive.org/web/20111101014023/http://www.lefigaro.fr/ to lefigaro20111101014023.json
       .pipe(readFiles(function (content, file, stream, cb) {
           var snapshotUrls = content.split(endOfLine);
           var newspaper = path.basename(file.path,'.txt');
           snapshotUrls = snapshotUrls.filter(url => url.startsWith('http'));
           snapshotUrls = snapshotUrls.slice(50)
           snapshotUrls.forEach(function (url, idx) {
                try {
                    queue.add(() => getCSS(url, {timeout: 30000,verbose:true, stripWayback: true}).then(function(getCSSJson){
                        var dateBorder = url.split("://web.archive.org/web/");
                        if (dateBorder[1]){
                            var snapshotDate = parseInt(dateBorder[1]);
                            var filename = `${newspaper}${snapshotDate}.json`;
                            var archiveUrl = url;
                            URL_CACHE[filename] = archiveUrl;
                        
                            stream.push(new File({
                                contents: new Buffer(JSON.stringify(getCSSJson)),
                                path: filename
                            }));
                            log(`Downloaded ${url} to ${filename}`);
                        }    
                    }, function(err){
                        log.warn("Error downloading snapshot for",url, ":",err);    
                    }));
                }
                catch (err) {
                    log.warn("Error downloading snapshot for",url, ":",err);
                }
           });
           queue.onIdle().then(() => { cb(null,content) });
       }))
       .pipe(gulp.dest('snapshot-css'));
})
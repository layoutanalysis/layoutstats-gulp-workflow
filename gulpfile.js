var path = require('path');
var endOfLine = require('os').EOL;
var del = require('del');

var gulp = require('gulp');
var ext_replace = require('gulp-ext-replace');
var jsonConcat = require('gulp-json-concat');
var jsonTransform = require('gulp-json-transform');
var merge = require('merge-stream');
var cssstats = require('cssstats');

var vinylPaths = require('vinyl-paths');
var readFiles = require('read-vinyl-file-stream');


var newspapers = ['clarin','diepresse','eluniversal','nytimes','oglobo','repubblica','sz'];


gulp.task('clean:dist', function(){
  return gulp.src('dist/*')
        .pipe(vinylPaths(del))
});

var URL_CACHE = {}

function buildCssStats (newspaper){
    var pipeline = gulp.src(`snapshot-css/${newspaper}*.json`)
        .pipe(jsonTransform(function(cssStats, file) {
            var cssFileContents = cssStats.links.map(function(cssFile){
                return cssFile.css;
            });
            var cssContents = cssFileContents.concat(cssStats.styles);
            return cssContents.join('\n');
        }))
        .pipe(readFiles(function (content, file, stream, cb) {
            var cssStats;
            try {
               cssStats = cssstats(content);
            }
            catch (err) {
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
    .pipe(jsonConcat(`${newspaperID}.json`, function (data) {
        var jsonFileNames = Object.keys(data);
        console.log(URL_CACHE);
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
var gulp = require('gulp');
var run = require('gulp-run');
var cssLonghand = require('gulp-css-longhand');
var ext_replace = require('gulp-ext-replace');
var jsonConcat = require('gulp-json-concat');
var del = require('del');
var vinylPaths = require('vinyl-paths');
var concat = require('gulp-concat');



gulp.task('clean:dist', function(){
  return gulp.src('dist/*')
        .pipe(vinylPaths(del))
});
 
gulp.task('cssstats',['clean:dist'], function () {
     var pipeline = gulp.src('snapshot-css/*.css')
        .pipe(cssLonghand())
        .pipe(run('cssstats'))
        .pipe(ext_replace('.json'))
        .pipe(gulp.dest('dist'));
     return pipeline;   
});

gulp.task('concatjson',['cssstats'], function(){
         gulp.src('dist/*.json')
        .pipe(jsonConcat('db.json',function(data){
            var jsonFileNames = Object.keys(data);
            var outJSON = jsonFileNames.map(function(fileName){
                var cssStats = data[fileName];
                
                var cssProps = cssStats["declarations"]["properties"];
                var cssPropKeys = Object.keys(cssProps);
                var NonVendorProps = cssPropKeys.filter(function(prop){
                  return prop.startsWith('-') === false;
                });
                
            });
            return new Buffer(JSON.stringify(outJSON));
        }))
        .pipe(gulp.dest('dist/'))
});
//'clean:dist','cssstats',
gulp.task('default',['concatjson']);
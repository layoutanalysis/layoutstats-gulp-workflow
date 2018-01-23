var gulp = require('gulp');
var run = require('gulp-run');
var cssLonghand = require('gulp-css-longhand');
var colorguard = require('gulp-colorguard');
var ext_replace = require('gulp-ext-replace');
 
gulp.task('default', function () {
    return gulp.src('snapshot-css/*.css')
        .pipe(cssLonghand())
        .pipe(run('cssstats'))
        .pipe(ext_replace('.json'))
        .pipe(gulp.dest('dist'));
});
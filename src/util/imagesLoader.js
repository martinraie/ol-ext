import { asArray as ol_color_asArray } from 'ol/color'

/** @namespace ol.ext.imageLoader
 */
if (window.ol) window.ol.ext.imageLoader = {};

/** Helper for loading BIL-32 (Band Interleaved by Line) image
 * @param {string} src
 * @param {function} onload a function that takes a Float32Array and a number (array size)
 * @param {function} onerror
 */
var ol_ext_imageLoader_loadBILImage = function(src, onload, onerror) {
  var xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.addEventListener('loadend', function () {
    var resp = this.response;
    if (resp !== undefined) {
      const reader = new FileReader();
      // Get as array
      reader.addEventListener('loadend', (e) => {
        var data = new Float32Array(e.target.result);
        var size = Math.sqrt(data.length);
        onload(data, size);
      });
      // Start reading the blob
      reader.readAsArrayBuffer(resp);
      // tile.getImage().src = URL.createObjectURL(blob);
    } else {
      onerror();
    }
  });
  xhr.addEventListener('error', function () {
    onerror();
  });
  xhr.open('GET', src);
  xhr.send();
};

/** Returns an Imageloader function to load an x-bil-32 image as sea level map 
 * to use as a ol/Tile~LoadFunction or ol/Image~LoadFunction
 * @param { number } level
 * @param {*} options
 *  @param { ol.Color } [options.color] fill color
 *  @param { boolean } [options.opacity=true] smooth color on border
 */
var ol_ext_imageLoader_seaLevelMap = function(level, options) {
  options = options || {};
  var h0 = Math.max(level + .01, .01);
  var c = options.color ? ol_color_asArray(options.color) : [135,203,249];
  var opacity = options.opacity!==false;
  return ol_ext_imageLoader_elevationMap(function(h) {
    if (h < h0 && h > -99999) {
      return [c[0], c[1], c[2], opacity ? 255 * (h0-h) / h0 : 255];
    } else {
      return [0,0,0,0];
    }
  })
};

/** Shaded relief ? */
var ol_ext_imageLoader_shadedRelief = function() {
  var sunElev = Math.PI / 4;
  var sunAzimuth = 2*Math.PI - Math.PI / 4;

  return function (tile, src) {
    ol_ext_imageLoader_loadBILImage(
      src,
      function(data, size) {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var width = canvas.width = size;
        var height = canvas.height = size;
        var imgData = ctx.getImageData(0, 0, size, size);
        var pixels = imgData.data;

        function getIndexForCoordinates(x, y) {
          return x + y*size;
        }
        for (var x=0; x<size; x++) for(var y=0; y<size; y++) {
          var top = getIndexForCoordinates(x,Math.max(0,y-1))
          var left = getIndexForCoordinates(Math.max(0,x-1),y);
          var right = getIndexForCoordinates(Math.min(width-1,x+1),y);
          var bottom = getIndexForCoordinates(x,Math.min(height,y+1))
          // get slope values
          var topValue = data[top];
          var leftValue = data[left];
          var rightValue = data[right];
          var bottomValue = data[bottom];
          var slx = (rightValue - leftValue)/3;
          var sly = ( bottomValue - topValue )/3;
          var sl0 = Math.sqrt( slx*slx + sly*sly );
          
          // get aspect
          var phi = Math.acos( slx/sl0 );
          if ( sl0 == 0 ) {
            phi = 0;
          }
          var azimuth = 0;
          if ( slx > 0 ) {
            if ( sly > 0 ) azimuth = phi + 1.5*Math.PI;
            else if ( sly < 0 ) azimuth = 1.5*Math.PI - phi;
            else phi = 1.5*Math.PI;
          } else if ( slx < 0 ){
            if ( sly < 0 ) azimuth = phi + .5*Math.PI;
            else if ( sly > 0 ) azimuth = .5*Math.PI - phi;
            else azimuth = .5*Math.PI;
          } else {
            if ( sly < 0 ) azimuth = Math.PI;
            else if ( sly > 0 ) azimuth = 0;
          }
          
          // get luminance
          var lum = Math.cos( azimuth - sunAzimuth )*Math.cos( Math.PI*.5 - Math.atan(sl0) )*Math.cos( sunElev ) +  Math.sin( Math.PI*.5 - Math.atan(sl0) )*Math.sin( sunElev );
          
          if (lum<0) lum = 0;
          lum = Math.sqrt(lum*.8 + .5);
          var p = getIndexForCoordinates(x,y) * 4;
          pixels[p] = pixels[p+1] = pixels[p+2] = 0;
          pixels[p+3] = 255 - lum*255;
        }
        ctx.putImageData(imgData, 0, 0);
        tile.setImage(canvas);
      },
      function () {
        tile.setState(3);
      }
    )
  };
};

/** Returns an Imageloader function to load an x-bil-32 image as elevation map
 * If getPixelColor is not define pixel store elevation as rgb, use ol_ext_getElevationFromPixel to get elevation from pixel
 * @param {function} [getPixelColor] a function that taket an elevation and return a color array [r,g,b,a], default store elevation as pixel
 */
var ol_ext_imageLoader_elevationMap = function(getPixelColor) {
  if (typeof(getPixelColor) !== 'function') getPixelColor = ol_ext_getPixelFromElevation;
  return function (tile, src) {
    ol_ext_imageLoader_loadBILImage(
      src,
      function(data, size) {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        canvas.width = canvas.height = size;
        var imgData = ctx.getImageData(0, 0, size, size);
        var pixels = imgData.data;
        for (var i=0; i<data.length; i++) {
          var p = getPixelColor(data[i]);
          pixels[4*i] = p[0];
          pixels[4*i+1] = p[1];
          pixels[4*i+2] = p[2];
          pixels[4*i+3] = p[3];
        }
        ctx.putImageData(imgData, 0, 0);
        tile.setImage(canvas);
      },
      function () {
        tile.setState(3);
      }
    )
  };
};

/** Convert elevation to pixel 
 * Encode elevation data in raster tiles
 * - max deep watter trench min > -12000 m
 * - 2 digits (0.01 m)
 */
var ol_ext_getPixelFromElevation =  function(height) {
  var h = Math.round(height*100 + 1200000);
  var pixel = [
    h >> 16, 
    (h % 65536) >> 8, 
    h % 256, 
    255
  ];
  return pixel;
};

/* Convert pixel to elevation */
var ol_ext_getElevationFromPixel = function(pixel) {
  // return -10000 + (pixel[0] * 65536 + pixel[1] * 256 + pixel[2]) * 0.01;
  return -12000 + ((pixel[0] << 16) + (pixel[1] << 8) + pixel[2]) * 0.01;
}

export { ol_ext_imageLoader_loadBILImage as loadBILImage }
export { ol_ext_imageLoader_seaLevelMap as seaLevelMap, ol_ext_imageLoader_elevationMap as elevationMap }
export { ol_ext_getPixelFromElevation as getPixelFromElevation, ol_ext_getElevationFromPixel as getElevationFromPixel }

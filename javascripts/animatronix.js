(function($) {
  $.fn.Animatronix = function(type, options) {
    var settings = {
      fps: 24,
      shape: function(c){
        c.fillStyle = "rgba(255,0,0,1)";
        c.beginPath();
        c.arc(0,0,5,0,Math.PI*2,false);
        c.fill();
        c.closePath();
      },
      background: function(c) {
        var width = c.canvas.width;
        var height = c.canvas.height;
        var halfWidth = width/2;
        var halfHeight = height/2;
        g = c.createRadialGradient(halfWidth, halfHeight, 0, halfWidth, halfHeight, halfWidth);
        g.addColorStop(0.0, "rgba(255,255,255,1)");
        g.addColorStop(1.0, "rgba(0,0,0,1)");
        c.fillStyle = g;
        c.beginPath();
        c.fillRect(0, 0, width, height);
        c.closePath();
      }
    }

    var calculators = {
      rose: function() { return {
        t: 0,
        x: 1,
        y: 1,

        calculate: function() {
          var t = this.t, x = this.x, y = this.y;
          t++;
          x = Math.sin(2*t/180)*Math.cos(5*t/180)*(this.halfWidth/1.2);
          y = Math.sin(2*t/180)*Math.sin(5*t/180)*(this.halfHeight/1.2);
          this.c.translate(Math.ceil(x)+this.halfWidth, Math.ceil(y)+this.halfHeight);
          this.t = t; this.x = x; this.y = y;
        }
      } },

      lissajous: function() { return {
        t: 0,
        x: 1,
        y: 1,

        calculate: function() {
          var t = this.t, x = this.x, y = this.y;
          t++;
          x = -Math.cos(t/288 * (Math.PI*2))*(this.halfWidth/1.2);
          y = Math.sin(t/360 * (Math.PI*2))*(this.halfHeight/1.2);
          this.c.translate(Math.ceil(x)+this.halfWidth, Math.ceil(y)+this.halfHeight);
          this.t = t; this.x = x; this.y = y;
        }
      } },

      ellipse: function(ellipsoid) { return {
        t: 0,
        x: 1,
        y: 1,
        z: 1,

        ellipsoid: ellipsoid,

        calculate: function() {
          var t = this.t, x = this.x, y = this.y, z = this.z;
          t++;
          x = -Math.sin(t/360 * (Math.PI*2))*(this.halfWidth/1.2);
          y = Math.cos(t/360 * (Math.PI*2))*(this.halfHeight/2.5);
          this.c.translate(Math.ceil(x)+this.halfWidth, Math.ceil(y)+this.halfHeight);
          if (this.ellipsoid) {
            z = Math.round(Math.abs(Math.cos(t/360 * Math.PI))*100)/100;
            this.c.scale(z+0.5, z+0.5);
          }
          this.t = t; this.x = x; this.y = y; this.z = z;
        }
      } },

      ellipsoid: function() { return calculators.ellipse(true); },

      vanderpol: function() { return {
        t: 0,
        x: 1,
        y: 1,

        calculate: function() {
          var t = this.t, x = this.x, y = this.y;
          t++;
          var h = 0.1;
          var mu = 1.0;
          var _x,_y;
          _x = x+h * y;
          _y = y+h * (-x - mu * (Math.pow(x,2) - 1) * y);
          x = _x;
          y = _y;
          this.c.translate(Math.ceil(x*40)+this.halfWidth, Math.ceil(y*40)+this.halfHeight);
          this.t = t; this.x = x; this.y = y;
        }
      } },

      duffing: function() { return {
        t: 0.0,
        x: 0.2,
        y: -0.3,

        calculate: function() {
          var t = this.t, x = this.x, y = this.y;
          if (t >= 500.0) t = 0.0;
          if (x*60 > this.halfWidth+1 || x*60 < -this.halfWidth-1) x = 0;
          if (y*50 > this.halfHeight+1 || y*50 < -this.halfHeight-1) y = 0;
          else t += 0.1;
          var h = 0.1;
          var a = 0.25;
          var b = 0.3;
          var w = 1;
          var _x,_y;
          _x = x+h * y;
          _y = y+h * (x-Math.pow(x,3)-a*y+b*Math.cos(w*t));
          x = _x;
          y = _y;
          this.c.translate(Math.ceil(x*60)+this.halfWidth, Math.ceil(y*50)+this.halfHeight);
          this.t = t; this.x = x; this.y = y;
        }
      } },

      lorenz: function() { return {
        t: 0,
        x: 1,
        y: 1,
        z: 1,

        calculate: function() {
          var t = this.t, x = this.x, y = this.y, z = this.z;
          t++;
          var h = 0.01;
          var b = 8.0/3.0;
          var s = 10.0;
          var r = 28.0;
          var _x,_y,_z;
          _x = x+h * (s * (y - x));
          _y = y+h * (x * (r - z) - y);
          _z = z+h * ((x * y) - (b * z));
          x = _x;
          y = _y;
          z = _z;
          this.c.translate(Math.ceil(x*5)+this.halfWidth, Math.ceil(y*5)+this.halfHeight);
          this.c.scale(z/20,z/20);
          this.t = t; this.x = x; this.y = y; this.z = z;
        }
      } }
    }

    return this.each(function(i) {
      if (options) { settings = $.extend(settings, options); }

      var calc = new calculators[type]();

      calc.c = this.getContext('2d');
      calc.width = calc.c.canvas.width;
      calc.height = calc.c.canvas.height;
      calc.halfHeight = calc.height/2;
      calc.halfWidth = calc.width/2;

      var draw = function() {
        calc.c.clearRect(0, 0, calc.width, calc.height);
        calc.c.save();
        settings.background(calc.c);
        calc.calculate();
        settings.shape(calc.c);
        calc.c.restore();
      }

      if (null != window["animint"+i]) { clearInterval(window["animint"+i]); }
      window["animint"+i] = setInterval(draw, 600/settings.fps);
    });
  }
})(jQuery);

(function($) {
  $.fn.OscillateWildly = function(type, options) {
    var settings = {
      fps: 24,
      shape: function(calc, c){
        var state = calc.calculate();

        c.clearRect(0, 0, calc.width, calc.height);

        var radius = 5;
        if (state.posZ) {
          radius = radius * Math.abs(state.posZ);
        }

        c.beginPath();
        c.arc(state.posX, state.posY,radius,0,Math.PI*2,false);
        c.fillStyle = "rgb(255,0,0)";
        c.fill();
        c.closePath();
      }
    }

    if (options) { settings = $.extend(settings, options); }

    var calculators = {
      rose: function() {
        var t = 0;
        var x = 1;
        var y = 1;

        return {
          calculate: function() {
            t++;
            x = Math.sin(2*t/180)*Math.cos(5*t/180)*(this.halfWidth/1.1);
            y = Math.sin(2*t/180)*Math.sin(5*t/180)*(this.halfHeight/1.1);
            return {
              time: t, x: x, y: y,
              posX: x+this.halfWidth,
              posY: y+this.halfHeight
            }
          }
        }
      },

      lissajous: function() {
        var t = 0;
        var x = 1;
        var y = 1;

        return {
          calculate: function() {
            t++;
            x = -Math.cos(t/288 * (Math.PI*2))*(this.halfWidth/1.1);
            y = Math.sin(t/360 * (Math.PI*2))*(this.halfHeight/1.1);
            return {
              time: t, x: x, y: y,
              posX: x+this.halfWidth,
              posY: y+this.halfHeight
            }
          }
        }
      },

      ellipse: function() {
        var t = 0;
        var x = 1;
        var y = 1;
        var z = 1;

        return {
          calculate: function() {
            t++;
            x = -Math.sin(t/360 * (Math.PI*2))*(this.halfWidth/1.1);
            y = Math.cos(t/360 * (Math.PI*2))*(this.halfHeight/1.1);
            z = Math.round(Math.abs(Math.cos(t/360 * Math.PI))*100)/100;
            return {
              time: t, x: x, y: y, z: z,
              posX: x+this.halfWidth,
              posY: y+this.halfHeight,
              posZ: z+0.5
            }
          }
        }
      },

      vanderpol: function() {
        var t = 0;
        var x = 1;
        var y = 1;

        return {
          calculate: function() {
            t++;
            var h = 0.1;
            var mu = 1.0;
            var _x,_y;
            _x = x+h * y;
            _y = y+h * (-x - mu * (Math.pow(x,2) - 1) * y);
            x = _x;
            y = _y;
            return {
              time: t, x: x, y: y,
              posX: (x*(this.width/6))+this.halfWidth,
              posY: (y*(this.height/6))+this.halfHeight
            }
          }
        }
      },

      duffing: function() {
        var t = 0.0;
        var x = 0.2;
        var y = -0.3;

        return {
          calculate: function() {
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
            return {
              time: t*10, x: x, y: y,
              posX: (x*(this.width/6))+this.halfWidth,
              posY: (y*(this.height/6))+this.halfHeight
            }
          }
        }
      },

      lorenz: function() {
        var t = 40;
        var x = 18.89688574723792;
        var y = 2.799477162418296;
        var z = 53.555488125917094;

        return  {
          calculate: function() {
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
            return {
              time: t, x: x, y: y, z: z,
              posX: (y*(this.width/55))+this.halfWidth,
              posY: z*(this.height/55),
              posZ: x/10
            }
          }
        }
      },

      helix: function() {
        var t = 0;
        var x = 1;
        var y = 1;
        var z = 0;

        return {
          calculate: function() {
            t++;
            z++;
            x = Math.cos(t/10);
            y = Math.sin((t+50)/20);
            if (z > this.height) {
              z = 0;
            }
            return {
              time: t, x: x, y: y, z: z,
              posX: (x*this.halfWidth*.9)+this.halfWidth,
              posY: z,
              posZ: y*2
            }
          }
        }
      }
    }

    return this.each(function(i) {
      var calc = new calculators[type]();

      var c = this.getContext('2d');
      calc.width = c.canvas.width;
      calc.height = c.canvas.height;
      calc.halfHeight = calc.height/2;
      calc.halfWidth = calc.width/2;
      calc.half = calc.halfWidth < calc.halfHeight ? calc.halfWidth : calc.halfHeight;

      var now, delta;
      var then = Date.now();
      var interval = 1000/settings.fps;
      var $this = $(this);

      var draw = function() {
        $this.attr("data-raf", requestAnimationFrame(draw));

        now = Date.now();
        delta = now - then;

        if (delta >= interval) {
          settings.shape(calc, c);

          then = now - (delta % interval);
        }
      }

      draw();
    });
  }
})(jQuery);

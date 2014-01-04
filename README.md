# Oscillate Wildly

Oscillate Wildly is a collection of HTML5 canvas oscillators and fractal/chaos animations packaged as a jQuery plugin. The algorithms are broken apart fairly well, so the code could easily be ported and modified to other projects and languages.

The following animation types are currently available:

- Ellipse Orbit (2D & 3D) `ellipse`
- Rose Oscillator `rose`
- Lissajous Oscillator `lissajous`
- Van der Pol Oscillator `vanderpol`
- Duffing Oscillator `duffing`
- Lorenz Attractor `lorenz`
- Helix Spiral `helix`

## Usage

To use, include jQuery and the OW javascript code, and instantiate similarly:

```js
$("#oscillate-wildly").OscillateWildly('lorenz');
```

The plugin also accepts an optional settings object that accepts `fps` and `shape` members. The `shape` member is a function that is passed two arguments.

- A `calculator` object for the given animation type
- The `canvas` 2d context

The `calculator` has a `calculate` function that returns an object representing the state of the equation for each frame in which it is called. This setup allows you to do basically anything you want with the variables returned buring computation.

## Contributing

Feel free to fork this repo and submit a pull request. Thanks!

---

Created and maintained by Charles Hudson

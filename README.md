# Oscillate Wildly

Animate an existing DOM element, SVG marker, Canvas 2D surface, or WebGL canvas
with periodic curves and numerical attractors. Motion sources describe the
movement; adapters draw it into elements your application owns.

## Install

```sh
pnpm add oscillate-wildly
```

The package is ESM and includes TypeScript declarations. Use Node.js 20.19 or
later for package tooling and a browser build setup that resolves npm imports.
You can use the library from JavaScript or TypeScript; the examples below use
TypeScript. Adapters run in a browser after their target elements exist.

## Start an animation

For a new project, follow the [complete runnable quickstart](./docs/quickstart.md),
which includes the build setup and every file. In an existing TypeScript browser
application, add this markup to your page, the styles to `style.css`, and the code
to your client entry module.

```html
<div id="orbit" aria-hidden="true">
  <span id="dot"></span>
</div>
<button id="remove-orbit" type="button">Remove animation</button>
```

```css
#orbit {
  position: relative;
  width: min(100%, 24rem);
  height: 16rem;
  overflow: hidden;
  background: #eef2ff;
}
#dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #4338ca;
}
```

```ts
import './style.css';
import { createEllipseMotion } from 'oscillate-wildly';
import { animateDom } from 'oscillate-wildly/dom';

const viewport = document.querySelector<HTMLElement>('#orbit')!;
const marker = document.querySelector<HTMLElement>('#dot')!;
const removeButton = document.querySelector<HTMLButtonElement>('#remove-orbit')!;

const controller = animateDom(
  { viewport, marker },
  createEllipseMotion({ periodSeconds: 6 }),
  { framing: { fit: 'contain' } },
);

removeButton.addEventListener('click', () => {
  controller.dispose(); // Release the animation before removing its target.
  viewport.remove();
  removeButton.disabled = true;
}, { once: true });
```

A purple dot moves around an ellipse every six seconds. **Remove animation**
stops it and removes the viewport. If reduced motion is enabled in the browser
or operating system, the marker stays still; controllers respect that preference.
In a component-based application, call `dispose()` from its unmount cleanup
instead of the demonstration button.

## Choose a renderer

| Renderer | Use it for | Your application supplies |
| --- | --- | --- |
| [DOM](./docs/integration.md#dom) | Moving an existing styled element | A sized viewport, positioned marker, styles and clipping |
| [SVG](./docs/integration.md#svg) | Vector markers, trails and complete analytic paths | An SVG viewport, graphics elements and their styles |
| [Canvas 2D](./docs/integration.md#canvas-2d) | Drawing on a raster surface or using a custom render callback | A canvas with CSS dimensions and a backing bitmap |
| [WebGL](./docs/webgl.md) | Depth-tested markers, retained drawing and 3D ribbon paint | A dedicated WebGL canvas; an orthographic camera for 3D |

Canvas 2D and SVG support optional trail and analytic-path helpers. WebGL
supports trails, accumulated markers, and ribbon paint as separate drawing
modes. DOM moves one element and has no built-in trail helper. WebGL is opaque
and orthographic: it does not provide translucent drawing or perspective.

## Choose and configure a motion

All factories are available from `oscillate-wildly`. Individual motion subpaths
are also available when you want narrow imports.

| Factory | Motion | Common controls |
| --- | --- | --- |
| `createEllipseMotion` | Ellipse with a size cue | `periodSeconds`, `radiusX`, `radiusY` |
| `createRoseMotion` | Closed rose curve | `periodSeconds` |
| `createLissajousMotion` | Repeating multi-axis curve | `periodSeconds`, `cyclesX`, `cyclesY`, `cyclesZ` |
| `createHelixMotion` | Helix with independently chosen rotation and flow | `periodSeconds`, `turns`, `rotationDirection`, `flowDirection` |
| `createVanderPolMotion` | Van der Pol oscillator | `timeScale`, `mu` |
| `createDuffingMotion` | Driven Duffing oscillator | `timeScale`, `damping`, `forcing`, `angularFrequency` |
| `createLorenzMotion` | Lorenz attractor | `timeScale`, `sigma`, `rho`, `beta` |

The [motion reference](./docs/motions.md) lists every parameter, default, valid
range, state field, and import path. Analytic motions sample an elapsed time;
stateful motions advance a numerical model. The adapter manages that timing.
Use a **separate stateful motion instance for each animation**.

## Fit and control the animation

Every adapter accepts `framing`, `markerScale`, and `autoplay`. `cover` is the
default fit and may crop the curve. `contain` fits the motion's declared bounds;
its default padding is 16 CSS pixels. Size the padding for your marker's largest
footprint. Bounds do not automatically expand when equation parameters change.

A controller returned by any adapter supports:

```ts
// Continue from the quickstart's controller, before removing its viewport.
controller.pause();
controller.resume();
controller.reset();
controller.setFraming({ fit: 'contain', padding: 24 });
controller.setMarkerScale({ depthStrength: 0 }); // Keep the base marker size.
const paused = controller.isPaused();
```

Dispose a controller before removing or replacing its target. Only one active
controller may own a target; sharing a stateful motion instance across active
controllers also throws. A disposed instance can be replaced with a new one.

All adapters pause when the document is hidden and respect reduced motion.
Offscreen behavior differs: Canvas 2D and WebGL default to pausing offscreen,
SVG offers `offscreen: true` but defaults to `false`, and DOM has no offscreen
option. `resume()` does not override document visibility or reduced motion.

See [integration and lifecycle](./docs/integration.md) for sizing, pixel ratio,
framing, rendering callbacks, helper cleanup, server rendering and mounting.

## Reference and examples

- [Runnable quickstart](./docs/quickstart.md)
- [Integration, adapter options and lifecycle](./docs/integration.md)
- [Motion parameters and custom sources](./docs/motions.md)
- [WebGL options, cameras, lighting and paint](./docs/webgl.md)
- [Rendering implementation details](./docs/rendering-internals.md)
- [Run the interactive playground locally](./docs/development.md#run-the-playground)
- [Playground controls](./docs/playground.md)
- [Contributing and tests](./docs/development.md)

The [playground source](https://github.com/phobetron/oscillate-wildly/tree/master/examples)
is an integration example; it requires a local build to run. For problems or
feature requests, use the [issue tracker](https://github.com/phobetron/oscillate-wildly/issues).
The library is [MIT licensed](./LICENSE).

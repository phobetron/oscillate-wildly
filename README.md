# Oscillate Wildly

Oscillate Wildly supplies motion sources and small browser adapters for animating an existing Canvas, DOM, or SVG marker. It has no framework or jQuery dependency. The [interactive example](./examples) switches among all seven motions and all three render targets, with controls for framing, overflow, appearance, and equation parameters.

## Install

```sh
pnpm add oscillate-wildly
```

The package is ESM and requires Node.js 20.19 or later for local development.

## Start an animation

Create a motion source, then give it an element you own. The adapters return a controller.

```ts
import { createEllipseMotion } from 'oscillate-wildly';
import { animateCanvas } from 'oscillate-wildly/canvas';

const canvas = document.querySelector<HTMLCanvasElement>('#orbit')!;
const controller = animateCanvas(canvas, createEllipseMotion(), {
  framing: { fit: 'contain', zoom: 0.9 },
});
```

The root entry exports these factory functions:

| Factory | Motion |
| --- | --- |
| `createEllipseMotion` | Elliptical orbit with depth |
| `createRoseMotion` | Rose curve |
| `createLissajousMotion` | Lissajous curve |
| `createHelixMotion` | Rising helix with depth and opacity |
| `createVanderPolMotion` | Van der Pol oscillator |
| `createDuffingMotion` | Duffing oscillator |
| `createLorenzMotion` | Lorenz attractor |

Every factory accepts an optional parameter object. Its source has `bounds`, `reset()`, and either `sample(elapsedSeconds)` for analytic motions or `step(realSeconds)` and `snapshot()` for stateful motions.

For the most common timing and equation controls:

| Motion | Parameters |
| --- | --- |
| Rose | `periodSeconds` for one closed path |
| Lissajous | `periodSeconds`, plus positive-integer `cyclesX` and `cyclesY` for completed horizontal and vertical cycles |
| Ellipse and helix | `periodSeconds` |
| Van der Pol, Duffing, and Lorenz | `timeScale` for model-time units advanced per real second; each also exposes its equation coefficients and initial conditions |

## Choose a renderer

### Canvas

`animateCanvas(canvas, motion, options)` draws the built-in red marker unless `render` is supplied. It reads the canvas's CSS size and never changes its CSS dimensions or backing bitmap. Set those yourself; the backing bitmap should normally account for the device pixel ratio.

```ts
import { animateCanvas, renderCanvasMarker } from 'oscillate-wildly/canvas';
import { createRoseMotion } from 'oscillate-wildly';

const canvas = document.querySelector<HTMLCanvasElement>('#rose')!;
const ratio = window.devicePixelRatio;
canvas.width = Math.round(canvas.clientWidth * ratio);
canvas.height = Math.round(canvas.clientHeight * ratio);

animateCanvas(canvas, createRoseMotion(), {
  render(context, frame) {
    context.fillStyle = '#151b2f';
    context.fillRect(0, 0, frame.viewport.width, frame.viewport.height);
    renderCanvasMarker(context, frame, { color: '#7dd3fc', radius: 6 });
  },
});
```

Canvas is clipped by its own drawing surface. For trails and analytic paths, opt in to `createCanvasTrail` from `oscillate-wildly/canvas/trail` and `createCanvasPath` from `oscillate-wildly/canvas/path`, then call their returned renderers from your `render` function.

### DOM

`animateDom({ viewport, marker }, motion, options)` moves the center of an existing marker with a CSS transform. You own layout and clipping.

```ts
import { animateDom } from 'oscillate-wildly/dom';
import { createLissajousMotion } from 'oscillate-wildly';

const viewport = document.querySelector<HTMLElement>('#field')!;
const marker = document.querySelector<HTMLElement>('#dot')!;

animateDom({ viewport, marker }, createLissajousMotion());
```

```css
#field { position: relative; overflow: hidden; }
#dot { position: absolute; left: 0; top: 0; }
```

Pass `render(frame, targets)` to replace the default transform, depth, and opacity behavior. The callback receives a CSS-pixel `frame.position` and `frame.project(pose)` for projecting another world-space pose with the current framing.

### SVG

`animateSvg({ viewport, marker }, motion, options)` moves a consumer-created graphics element. It maps CSS-pixel positions through the existing `viewBox` and `preserveAspectRatio`, preserving your SVG and CSS transforms.

```ts
import { animateSvg } from 'oscillate-wildly/svg';
import { createHelixMotion } from 'oscillate-wildly';

animateSvg({
  viewport: document.querySelector<SVGSVGElement>('#helix')!,
  marker: document.querySelector<SVGGraphicsElement>('#helix-marker')!,
}, createHelixMotion());
```

Set SVG clipping in your own markup or CSS, for example `overflow: hidden` on the SVG. Optional helpers are `createSvgTrail` from `oscillate-wildly/svg/trail` and `createSvgStaticPath` (or `renderSvgStaticPath`) from `oscillate-wildly/svg/path`. Both operate on a path element you create and restore its original `d` value when disposed.

## Framing

All adapters accept `framing`:

```ts
{
  fit: 'cover',       // 'cover' (default), 'contain', or 'stretch'
  zoom: 1,
  padding: 16,        // CSS-pixel inset for contain; 0 for other fits
  offsetX: 0,         // fractions of viewport width and height
  offsetY: 0,
  bounds: undefined,  // optional { minX, maxX, minY, maxY } override
}
```

`cover` fills the viewport and may crop the projected world. `contain` shows the complete bounds and reserves a fixed 16 CSS pixels by default for a typical marker. Set `padding` to the largest footprint you want to keep inside, including radius, stroke, and any intended glow. The library cannot infer the footprint of custom drawing or guarantee containment when a marker changes size over time; consumers choose a sufficient inset for those effects. `stretch` scales each axis independently. Positive offsets move the projected result right and down. Zoom above 1 or an offset can intentionally move a marker beyond the box.

Built-in bounds are calibrated for each motion's default equation parameters. If changing coefficients or initial conditions changes the trajectory's extent, provide `framing.bounds` in the motion's projected-pose coordinate system. Use `fit: 'contain'` and, when useful, `zoom` to choose the resulting view. Bounds do not auto-fit as a trajectory evolves.

## Lifecycle and motion preferences

Animations autoplay unless `autoplay: false` is passed. A returned controller provides:

```ts
controller.pause();
controller.resume();
controller.reset();
controller.setFraming({ fit: 'contain', zoom: 1.2, offsetX: 0.1 });
controller.dispose();
controller.isPaused();
```

`setFraming()` reprojects the current motion without resetting its time or state. Call `dispose()` before removing a target or replacing it with another animation. Adapters preserve and restore the DOM marker's inline transform and opacity, and the SVG marker's `transform` and `opacity`, when disposed. Controllers pause when the document is hidden and respect a user's reduced-motion preference. Canvas controllers also pause while their canvas is offscreen by default; DOM and SVG do not unless their `offscreen` option is set.

## Performance and imports

Import the adapter and helper subpaths you use so a bundler can avoid unrelated adapter code:

```ts
import { createLorenzMotion } from 'oscillate-wildly/motions/lorenz';
import { animateSvg } from 'oscillate-wildly/svg';
```

Stateful motions use fixed simulation steps while sharing a browser animation-frame scheduler across controllers. Keep custom render callbacks short, bound trail sample counts, and call `dispose()` for views that no longer need animation.

## Development

```sh
pnpm install
pnpm dev        # starts the interactive example
pnpm build      # builds the library
pnpm typecheck
pnpm test
pnpm exec playwright install chromium # one-time browser setup if needed
pnpm test:browser              # builds the library and demo, then runs Chrome smoke checks
```

The example source is in [`examples/`](./examples). It is the integration reference for mounting and replacing controllers.
If Chromium is not installed through Playwright, set `CHROME_PATH` to an installed Chrome or Chromium executable when running `pnpm test:browser`.

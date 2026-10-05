# Oscillate Wildly

Oscillate Wildly supplies motion sources and small browser adapters for animating an existing Canvas 2D, WebGL, DOM, or SVG marker. The [interactive example](./examples) switches among all seven motions and all four render targets, with controls for framing, overflow, appearance, and equation parameters. Its WebGL controls include planar and true 3D views, fixed camera presets, accumulation, and frame-based marker colors.

## Install

```sh
pnpm add oscillate-wildly
```

The package is ESM and requires Node.js 20.19 or later for local development.

## Start an animation

Create a motion source, then give it an element you own. The adapters return a controller.

```ts
import { createEllipseMotion } from "oscillate-wildly";
import { animateCanvas } from "oscillate-wildly/canvas";

const canvas = document.querySelector<HTMLCanvasElement>("#orbit")!;
const controller = animateCanvas(canvas, createEllipseMotion(), {
  framing: { fit: "contain", zoom: 0.9 },
});
```

The root entry exports these factory functions:

| Factory                 | Motion                              |
| ----------------------- | ----------------------------------- |
| `createEllipseMotion`   | Elliptical orbit with depth         |
| `createRoseMotion`      | Rose curve                          |
| `createLissajousMotion` | Lissajous curve                     |
| `createHelixMotion`     | Rising helix with depth and opacity |
| `createVanderPolMotion` | Van der Pol oscillator              |
| `createDuffingMotion`   | Duffing oscillator                  |
| `createLorenzMotion`    | Lorenz attractor                    |

Every factory accepts an optional parameter object. Its source has `bounds`, `reset()`, and either `sample(elapsedSeconds)` for analytic motions or `step(realSeconds)` and `snapshot()` for stateful motions.

For the most common timing and equation controls:

| Motion                           | Parameters                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Rose                             | `periodSeconds` for one closed path                                                                                                   |
| Lissajous                        | `periodSeconds`, plus positive-integer `cyclesX`, `cyclesY`, and `cyclesZ` for completed cycles on each axis (defaults `5`, `4`, `3`) |
| Ellipse and helix                | `periodSeconds`                                                                                                                       |
| Van der Pol, Duffing, and Lorenz | `timeScale` for model-time units advanced per real second; each also exposes its equation coefficients and initial conditions         |

Lissajous always supplies `state.z` and `state.zAngleRadians` in addition to its XY state. The Z coordinate is `sin(zAngleRadians)`, with `cyclesZ` complete cycles per period. Its pose uses X/Y for screen position and `depth = 0.625 + 0.375 * state.z` for marker size. Changing Z frequency changes the size cue across Canvas 2D, DOM, SVG, and WebGL. The XY trajectory and bounds stay the same.

Duffing always supplies `state.forcingPhaseRadians = angularFrequency * state.timeSeconds`. This is the unwrapped angle of the periodic force, not a physical Z position. Its pose uses displacement/velocity for screen position and `depth = 0.625 + 0.375 * sin(forcingPhaseRadians)` for marker size. The equation, two-variable integration, model-time scaling, XY trajectory, and bounds stay the same. Resetting the source resets phase and size cue along with model time. The full state is displacement, velocity, and periodic forcing phase; a 3D renderer chooses how to display that angular dimension.

These state fields and size cues are computed by default without a 3D feature flag. Lissajous adds one sine evaluation per sample, while Duffing adds one multiplication and one sine evaluation per snapshot, with no additional integration steps. These are bounded operation costs, not benchmark measurements. Consumers constructing `LissajousState` or `DuffingState` objects themselves must include the added state fields; factory samples receive them automatically. Lissajous and Duffing markers now vary in size by default, consistently with the other motions that expose a hidden-coordinate size cue.

## Choose a renderer

### Canvas

`animateCanvas(canvas, motion, options)` draws the built-in red marker unless `render` is supplied. It reads the canvas's CSS size and never changes its CSS dimensions or backing bitmap. Set those yourself; the backing bitmap should normally account for the device pixel ratio.

```ts
import { animateCanvas, renderCanvasMarker } from "oscillate-wildly/canvas";
import { createRoseMotion } from "oscillate-wildly";

const canvas = document.querySelector<HTMLCanvasElement>("#rose")!;
const ratio = window.devicePixelRatio;
canvas.width = Math.round(canvas.clientWidth * ratio);
canvas.height = Math.round(canvas.clientHeight * ratio);

animateCanvas(canvas, createRoseMotion(), {
  render(context, frame) {
    context.fillStyle = "#151b2f";
    context.fillRect(0, 0, frame.viewport.width, frame.viewport.height);
    renderCanvasMarker(context, frame, { color: "#7dd3fc", radius: 6 });
  },
});
```

Canvas is clipped by its own drawing surface. For trails and analytic paths, opt in to `createCanvasTrail` from `oscillate-wildly/canvas/trail` and `createCanvasPath` from `oscillate-wildly/canvas/path`, then call their returned renderers from your `render` function.

### WebGL

Import `animateWebGL` from `oscillate-wildly/webgl`. WebGL code is kept out of the root, Canvas 2D, DOM, and SVG entries. Use a dedicated canvas: a canvas that already has a 2D context cannot supply a WebGL context. The adapter throws if WebGL 1 is unavailable or GPU resources cannot be created; it does not select a fallback renderer. Set the canvas's CSS dimensions and backing bitmap yourself, just as with Canvas 2D. Colors are opaque RGB tuples with channels in `[0, 1]`; palettes and the canvas background belong to the application.

This planar example uses the existing motion and framing unchanged:

```ts
import { createEllipseMotion } from "oscillate-wildly";
import { animateWebGL } from "oscillate-wildly/webgl";

const planar = animateWebGL(
  document.querySelector<HTMLCanvasElement>("#planar")!,
  createEllipseMotion(),
  {
    framing: { fit: "contain", padding: 10 },
    accumulate: true,
    marker: (frame) => ({
      radius: 6,
      color: [0.2, 0.6, (Math.sin(frame.elapsedSeconds) + 1) / 2],
    }),
  },
);

planar.clear(); // erase color and depth; continue from the current motion
// planar.reset() instead restarts the motion and draws its initial marker.
```

For true 3D, supply a fixed orthographic `camera`. Lissajous, helix, and Lorenz motions keep their planar poses for compatibility; select their preserved XYZ model coordinates with `position(frame)`. Duffing exposes displacement, velocity, and forcing phase, which need a phase-space display mapping. Custom motions may instead supply `pose.z` alongside `pose.x` and `pose.y`; the shared controller interpolates all three pose coordinates for stateful motions. A `position` callback receives the current model snapshot rather than an interpolated model state.

```ts
import { createHelixMotion } from "oscillate-wildly";
import { animateWebGL } from "oscillate-wildly/webgl";

const spatial = animateWebGL(
  document.querySelector<HTMLCanvasElement>("#spatial")!,
  createHelixMotion({ turns: 4 }),
  {
    position: ({ state }) => ({ x: state.x, y: state.y, z: state.z }),
    camera: {
      position: { x: 5, y: 4, z: 6 },
      target: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 0, z: 1 },
      near: 0.1,
      far: 20,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    },
    framing: { fit: "contain", padding: 10 },
    accumulate: true,
    marker: { radius: 5, color: [0.3, 0.8, 1], shape: "circle" },
  },
);
```

Projection is independent of WebGL. `projectOrthographic(pose, viewport, camera, framing?)`, exported from the root and `/core`, returns CSS-pixel coordinates and `visibilityDepth`. `OrthographicCamera` requires `position` and view-plane `bounds`; `target` defaults to the origin, `up` to positive Y, `near` to `0.1`, and `far` to `100`. Camera up points toward the top of the screen; bounds use screen-plane coordinates with positive Y downward. Near must be finite and non-negative, far must be finite and greater than near, and view direction and up must form a nondegenerate basis. Camera settings are copied on mount and `setCamera`; update them through the controller. `framing.bounds`, if supplied, overrides camera bounds.

| WebGL option                       | Behavior                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marker`                           | Object or `(frame) => options \| null`. Defaults to a red circle, radius `5` CSS pixels; `null` skips the current marker. `shape` may be `'circle'` or `'square'`.                          |
| `accumulate`                       | Defaults to `false`, clearing before each frame. `true` retains both color and hardware depth and adds markers incrementally.                                                               |
| `camera`                           | Optional fixed orthographic view; omit for planar motion.                                                                                                                                   |
| `position`                         | Optional `(frame) => { x, y, z }` mapping from the model. Defaults to the motion's pose; absent Z is zero in camera mode.                                                                   |
| `visibilityDepth`                  | Planar number or `(frame) => number`, default `0.5`; near is `0`, far is `1`, and values outside the interval are clipped. Camera mode derives depth from position and ignores this option. |
| `framing`, `autoplay`, `offscreen` | Shared controller behavior. `offscreen` defaults to `true`. `platform` may inject runtime services for tests or another host.                                                               |

Appearance callbacks receive a `WebGLFrame`: its `pose` contains the selected coordinates, its `position` includes `visibilityDepth`, and `project(pose)` uses the same current projection. **`pose.depth` remains a marker-radius multiplier**, independently of visibility depth. WebGL markers are opaque, camera-facing flat discs or squares; `pose.opacity` is intentionally ignored. Blending is disabled, and hardware depth testing lets nearer markers occlude farther ones in either drawing order, including across accumulated frames. At equal depth, the latest marker wins.

The `WebGLController` supports normal lifecycle methods plus `clear()` and `setCamera(camera | undefined)`. `clear()` immediately presents an empty transparent drawing without drawing a marker or resetting motion; the next animation frame adds its marker. `reset()` clears accumulation, restarts motion, and draws its initial marker. `setCamera(undefined)` returns to planar projection. Camera/framing updates, CSS viewport changes, and bitmap changes clear accumulated output and redraw the current marker, including while paused. Bitmap attributes are observed independently of CSS resize notifications. A zero-size target suspends animation until it becomes drawable again.

GPU programs, a quad buffer, color texture, depth renderbuffer, and framebuffer are reused for a fixed view. Resize reallocates attachment storage without retaining CPU path history. Context loss suspends motion time; restoration rebuilds resources, clears accumulated output, and redraws the current motion. Manual pause/resume choices, document visibility, offscreen state, and reduced-motion preferences remain in effect. `dispose()` removes observers/listeners and deletes live GPU resources. The adapter owns its canvas's GL context; interleaving another renderer on it is unsupported. WebGL, like Canvas 2D, pauses offscreen by default.

This release supports fixed-view opaque accumulation only. It does not provide perspective, interactive camera controls, retained-path reprojection, translucent accumulation, or anti-aliased marker edges. Projection does not auto-fit a 3D trajectory: choose camera bounds and clipping distances for your motion. Accumulation is clipped by the canvas and is lost on view changes or context loss.

### DOM

`animateDom({ viewport, marker }, motion, options)` moves the center of an existing marker with a CSS transform. You own layout and clipping.

```ts
import { animateDom } from "oscillate-wildly/dom";
import { createLissajousMotion } from "oscillate-wildly";

const viewport = document.querySelector<HTMLElement>("#field")!;
const marker = document.querySelector<HTMLElement>("#dot")!;

animateDom({ viewport, marker }, createLissajousMotion());
```

```css
#field {
  position: relative;
  overflow: hidden;
}
#dot {
  position: absolute;
  left: 0;
  top: 0;
}
```

Pass `render(frame, targets)` to replace the default transform, depth, and opacity behavior. The callback receives a CSS-pixel `frame.position` and `frame.project(pose)` for projecting another world-space pose with the current framing.

### SVG

`animateSvg({ viewport, marker }, motion, options)` moves a consumer-created graphics element. It maps CSS-pixel positions through the existing `viewBox` and `preserveAspectRatio`, preserving your SVG and CSS transforms.

```ts
import { animateSvg } from "oscillate-wildly/svg";
import { createHelixMotion } from "oscillate-wildly";

animateSvg(
  {
    viewport: document.querySelector<SVGSVGElement>("#helix")!,
    marker: document.querySelector<SVGGraphicsElement>("#helix-marker")!,
  },
  createHelixMotion(),
);
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
controller.setFraming({ fit: "contain", zoom: 1.2, offsetX: 0.1 });
controller.dispose();
controller.isPaused();
```

`setFraming()` reprojects the current motion without resetting its time or state. Call `dispose()` before removing a target or replacing it with another animation. Adapters preserve and restore the DOM marker's inline transform and opacity, and the SVG marker's `transform` and `opacity`, when disposed. Controllers pause when the document is hidden and respect a user's reduced-motion preference. Canvas controllers also pause while their canvas is offscreen by default; DOM and SVG do not unless their `offscreen` option is set.

## Performance and imports

Import the adapter and helper subpaths you use so a bundler can avoid unrelated adapter code:

```ts
import { createLorenzMotion } from "oscillate-wildly/motions/lorenz";
import { animateSvg } from "oscillate-wildly/svg";
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
Choose **WebGL** for any planar motion, or choose **Lissajous**, **Helix**, **Lorenz**, or **Duffing**, then **3D coordinates** with a fixed front or oblique orthographic camera. Lissajous has a **Z cycles** parameter. Duffing's view displays forcing phase around a cylinder: `radius = 1.2 + 0.8 * tanh(displacement / 3)`, height is `velocity / 3`, and the circular X/Z coordinates are `radius * cos(phase)` and `radius * sin(phase)`. This is a continuous phase-space visualization rather than physical XYZ motion; the positive, bounded radius maps displacement monotonically and avoids a discontinuity at phase multiples of `2π`. The display mapping is computed only when the 3D view is selected.

Every renderer consumes the motion factory's `pose.depth` as a marker-size scale. Lissajous and Duffing use a `0.25` to `1` size range, as with the helix cue; Lorenz and ellipse also supply their size cues in the pose. The playground uses the same factory output for Canvas 2D, DOM, SVG, and WebGL, including WebGL 3D views. This cue is independent of camera clipping depth, and planar WebGL still has equal visibility depth for its markers.

Enable **Accumulate drawing**, then compare **Clear drawing** (keeps motion time) with **Reset** (restarts the motion). **Animate with time** and **Shade by view depth** demonstrate appearance computed from the current frame. The readout separates marker-size scale from visibility depth. Appearance, coordinate-view, and camera changes preserve motion time and manual pause while clearing the drawing; changing accumulation, equation parameters, motion, or renderer remounts the animation and restarts its time while preserving manual pause. **Restore playground defaults** starts the default Canvas 2D animation again.
If Chromium is not installed through Playwright, set `CHROME_PATH` to an installed Chrome or Chromium executable when running `pnpm test:browser`.

# Oscillate Wildly

Oscillate Wildly supplies motion sources and small browser adapters for animating an existing Canvas 2D, WebGL, DOM, or SVG marker. The [interactive example](./examples) switches among all seven motions and all four render targets, with controls for framing, overflow, appearance, and equation parameters. Its WebGL controls include planar and true 3D views, camera presets, mouse and touch orbit controls, accumulation, and frame-based marker colors.

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

Canvas is clipped by its own drawing surface. For trails and analytic paths, opt in to `createCanvasTrail` from `oscillate-wildly/canvas/trail` and `createCanvasPath` from `oscillate-wildly/canvas/path`, then call their returned renderers from your `render` function. Trails default to `maxSamples: 128`; set a positive safe integer to retain that many positions. `maxSamples: 1` produces no line.

```ts
import { createCanvasTrail } from "oscillate-wildly/canvas/trail";
import { animateCanvas, renderCanvasMarker } from "oscillate-wildly/canvas";

const trail = createCanvasTrail({ maxSamples: 128, color: "#7dd3fc", width: 2 });
const controller = animateCanvas(canvas, createRoseMotion(), {
  render(context, frame) {
    trail(context, frame);
    renderCanvasMarker(context, frame, { color: "#7dd3fc", radius: 6 });
  },
});

trail.clear(); // discard history; the next render clears the old drawing
// controller.reset() restarts motion and clears the trail.
```

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
    trail: { maxSamples: 128, width: 2 },
    marker: { radius: 5, color: [0.3, 0.8, 1], shape: "circle" },
  },
);
```

Projection is independent of WebGL. `projectOrthographic(pose, viewport, camera, framing?)`, exported from the root and `/core`, returns CSS-pixel coordinates and `visibilityDepth`. `OrthographicCamera` requires `position` and view-plane `bounds`; `target` defaults to the origin, `up` to positive Y, `near` to `0.1`, and `far` to `100`. Camera up points toward the top of the screen; bounds use screen-plane coordinates with positive Y downward. Near must be finite and non-negative, far must be finite and greater than near, and view direction and up must form a nondegenerate basis. Camera settings are copied on mount and `setCamera`; update them through the controller. `framing.bounds`, if supplied, overrides camera bounds.

| WebGL option                       | Behavior                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marker`                           | Object or `(frame) => options \| null`. Defaults to a red circle, radius `5` CSS pixels; `null` skips the current marker. `shape` may be `'circle'` or `'square'`, independently of paint mode.                          |
| `accumulate`                       | Defaults to `false`. `true` or `{ maxSamples? }` retains world-space markers and their sampled appearance. Defaults to `12000` samples; the oldest expire at the limit. Mutually exclusive with `trail` and `paint`.                    |
| `paint`                            | Defaults to `false`. `true` or `{ maxSamples?, limitBehavior? }` retains connected world-space paint with flat circle/square brush footprints. Defaults to `12000` samples and `limitBehavior: 'pause'`, preserving all paint at the limit. `'trim-oldest'` keeps motion running and expires the oldest paint. Mutually exclusive with `trail` and `accumulate`. |
| `trail`                            | Disabled by default. `true` or `{ maxSamples?, width?, color? }` enables a bounded opaque tail. Defaults: `128` samples, `1` CSS-pixel width, and the current marker color (red when the marker is skipped).        |
| `camera`                           | Optional fixed orthographic view; omit for planar motion.                                                                                                                                   |
| `lighting`                         | Defaults to `false`. Enables render-time lighting for retained WebGL geometry; `WebGLController.setLighting(enabled)` changes it and redraws retained geometry without resetting motion or uploading it again. |
| `position`                         | Optional `(frame) => { x, y, z }` mapping from the model. Defaults to the motion's pose; absent Z is zero in camera mode.                                                                   |
| `visibilityDepth`                  | Planar number or `(frame) => number`, default `0.5`; near is `0`, far is `1`, and values outside the interval are clipped. Camera mode derives depth from position and ignores this option. |
| `framing`, `autoplay`, `offscreen` | Shared controller behavior. `offscreen` defaults to `true`. `platform` may inject runtime services for tests or another host.                                                               |

Appearance callbacks receive a `WebGLFrame`: its `pose` contains the selected coordinates, its `position` includes `visibilityDepth`, and `project(pose)` uses the same current projection. **`pose.depth` remains a marker-radius multiplier**, independently of visibility depth. Outside paint mode, circle and square markers are opaque, camera-facing flat discs or squares; `pose.opacity` is intentionally ignored. Blending is disabled, and hardware depth testing lets nearer markers occlude farther ones in either drawing order, including accumulated markers after camera rotation. At equal depth, the latest marker wins.

Lighting is off by default, preserving the supplied RGB marker colors exactly. When enabled, the renderer shades geometry at draw time with ambient light, an off-axis directional light fixed in view space, subtle specular highlights, and attenuation from current view depth. The host still chooses marker colors; the library applies GPU shading to those base colors, including retained markers, tails, and paint, without changing stored RGB values or adding geometry-buffer uploads. Circle and square markers remain flat and camera-facing; paint caps align with their adjoining ribbon faces. Neither uses spherical normals. Lighting is two-sided. Ribbon paint uses shared, area-weighted vertex normals interpolated across triangles and neighboring segments, so bends and twists receive smooth highlights instead of visible triangle facets. Endpoint caps share the adjoining endpoint normals. The normals rotate with the camera and work without optional WebGL extensions. Other geometry uses shader-derived surface normals when `OES_standard_derivatives` is available; otherwise it retains depth attenuation with a constant front-facing normal. Lighting adds neither shadow mapping nor perspective projection.

A trail retains at most `maxSamples` world-space XYZ positions and reprojects them in the current view on each redraw. `maxSamples` must be a positive safe integer and defaults to `128`; `1` leaves only the current marker with no line. `width` is a non-negative finite CSS-pixel stroke width; `0` suppresses the line. Set an explicit opaque RGB `color` to keep the whole tail one color, or omit it to follow the current marker color, including appearance callbacks. The tail is drawn together with the current marker using hardware depth testing. Enabling both `trail` and `accumulate` throws a `TypeError`.

Circle/square accumulation retains each marker's XYZ position, size scale, radius, color, and shape, then redraws the complete retained object through the current camera. `accumulate: true` uses a `12000`-sample limit, or use `accumulate: { maxSamples: 24000 }` to choose a positive safe integer. At the limit, the oldest marker expires when a new sample arrives. `maxSamples: 1` displays only the latest retained marker. Paused redraws replace the current sample when its appearance changes; they do not extend or age history. Appearance callbacks run for the current frame; historical markers keep the appearance captured when sampled. `marker: null` adds no marker and leaves earlier history intact.

Enable `paint: true` to deposit a connected world-space ribbon using the selected circle or square as its flat brush footprint. Marker radius in CSS pixels, multiplied by `pose.depth`, determines brush size; a square's support width can be larger along a diagonal. There is no separate ribbon-width or tail-length setting. Each stroke captures its orientation and CSS-pixel-to-world size calibration from the camera, framing, and viewport at its first sample. Subsequent motion derives the ribbon axis in that frozen basis. Camera orbit, framing changes, and resize only change projection; they do not twist future paint toward the new view or recalibrate its world width during the stroke. Flat brush footprints are retained only at the start and current end of each stroke; circular brushes give both ends rounded caps. The surface between them stays continuous, and intermediate caps are removed as the leading end advances. Paint mode aligns each endpoint footprint with its adjoining ribbon triangle, preserving its captured shape, size, and color. The starting footprint uses the calibrated brush plane while stationary; the first moving segment finalizes its orientation once. Leading footprints follow the local ribbon face as the path bends in 3D. These orientations depend on retained geometry rather than camera movement, so lighting remains continuous at the join without a separate camera-facing head marker. The complete stroke, including its ends, rotates with the camera and may turn edge-on.

Each sample captures its shape, size, color, and brush-plane axes, and deposited paint positions and colors are immutable. As adjoining segments arrive, their shared lighting normals are updated to keep the surface shading smooth. Changing radius, color, or marker shape affects future paint and its leading endpoint without altering the retained surface or lifting the brush. `marker: null` or zero radius lifts the brush; the next nonzero marker starts a new stroke with a fresh orientation and size calibration, without connecting across the gap. Clear and reset also discard the captured basis.

Configure the paint budget with `paint: { maxSamples: 12000 }`; `paint: true` defaults to `12000`. The limit must be a positive safe integer. The default `limitBehavior: 'pause'` pauses the entire animation when the budget fills and preserves the stroke instead of expiring its beginning. Set `paint: { maxSamples: 12000, limitBehavior: 'trim-oldest' }` to keep motion running and expire the oldest samples, retaining a connected suffix of each surviving stroke without connecting across brush lifts. `maxSamples: 1` retains only the latest brush footprint. `controller.isPaintFull()` reports that capacity has been reached in either mode; it does not imply a pause in trim mode. Optional `onPaintLimit()` runs once each time a new budget fills in pause mode only. Clear or reset replenishes the budget; resume after clearing continues from the current motion time. A stationary brush adds no degenerate segments. Camera and paused appearance redraws do not add paint or replace deposited samples. Paint cannot be combined with `trail` or `accumulate`.

```ts
animateWebGL(canvas, motion, {
  camera,
  position: ({ state }) => ({ x: state.x, y: state.y, z: state.z }),
  marker: { shape: "circle", radius: 9, color: [0.3, 0.8, 1] },
  paint: { maxSamples: 12000 },
});
```

The `WebGLController` supports normal lifecycle methods plus `clear()`, `setCamera(camera | undefined)`, and `setLighting(enabled)`. `setLighting` redraws the complete retained geometry with the selected shading and preserves motion time, pause state, stored colors, and geometry uploads. `clear()` discards all history and immediately presents an empty transparent drawing without resetting motion; the next render can add the current marker. `reset()` discards history, restarts motion, and draws its initial marker. `setCamera(undefined)` returns to planar projection. Camera/framing updates, CSS viewport changes, and bitmap changes reproject all retained geometry, including while paused. If an application changes its `position` mapping, call `clear()` to discard positions from the old coordinate system. Bitmap attributes are observed independently of CSS resize notifications. A zero-size target suspends animation until it becomes drawable again.

GPU programs, buffers, color texture, depth renderbuffer, and framebuffer are reused. Accumulated markers use a circular vertex buffer that grows geometrically up to the sample limit. Each new or replaced sample uploads one small vertex block once capacity is stable; camera changes update the projection matrix without repacking or uploading the retained geometry. Brush paint uses the same world-space camera pipeline and a chronological buffer containing each connecting surface followed by its endpoint. Advancing the brush removes the previous leading cap and appends the new surface and leading cap. In pause mode, the starting cap remains. Trim mode replaces expired geometry with a new starting cap at the oldest surviving sample. Both paint modes bound retained CPU and GPU memory by the sample limit. Once capacity is stable, each advancing frame uploads only small affected geometry blocks; drawing the complete retained scene remains O(sample limit). Camera-only redraws upload no retained geometry. The vertex shader projects world-space samples and draws them in one or two chronological ranges. Color and depth are cleared before redrawing the complete scene, so occlusion always reflects the current camera. Resize reallocates framebuffer attachment storage while keeping geometry. Context loss suspends motion time; restoration rebuilds resources from retained history and redraws the object. Manual pause/resume choices, document visibility, offscreen state, and reduced-motion preferences remain in effect. `dispose()` removes observers/listeners and deletes live GPU resources. The adapter owns its canvas's GL context; interleaving another renderer on it is unsupported. WebGL, like Canvas 2D, pauses offscreen by default.

WebGL supports bounded opaque trails, accumulated markers, and retained ribbon brush paint. It does not provide perspective projection, translucent drawing, or anti-aliased marker edges. Camera interaction belongs to the application; the playground supplies mouse, touch, and keyboard orbit controls through `setCamera`. Projection does not auto-fit a 3D trajectory: choose camera bounds and clipping distances for your motion. All drawing modes are clipped by the canvas; history survives view changes and context recovery.

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

Set SVG clipping in your own markup or CSS, for example `overflow: hidden` on the SVG. Optional helpers are `createSvgTrail` from `oscillate-wildly/svg/trail` and `createSvgStaticPath` (or `renderSvgStaticPath`) from `oscillate-wildly/svg/path`. Both operate on a path element you create and restore its original `d` value when disposed. SVG trails default to `maxSamples: 128`; choose a positive safe integer to set the retained sample count:

```ts
import { createSvgTrail } from "oscillate-wildly/svg/trail";
import { animateSvg, renderSvgMarker } from "oscillate-wildly/svg";

trailPath.style.stroke = "#7dd3fc";
trailPath.style.strokeWidth = "2px";
const trail = createSvgTrail({ viewport, path: trailPath, maxSamples: 128 });
const controller = animateSvg({ viewport, marker }, createHelixMotion(), {
  render(frame, targets) {
    trail.render(frame);
    renderSvgMarker(frame, targets);
  },
});

trail.clear(); // erase the trail without resetting motion
// controller.reset() restarts motion and clears the trail.
// trail.dispose() restores the path's original d attribute.
```

Canvas, SVG, and WebGL trails retain model-space positions and reproject existing history on framing or viewport changes and paused redraws without adding samples. Repeated renders at the same motion time do not extend the trail; reset clears history and restarts motion. `clear()` discards history without resetting motion. `maxSamples: 1` retains one position and produces no line. Invalid limits (zero, negatives, fractions, unsafe integers, `NaN`, or infinities) throw a `RangeError`. DOM has no trail helper.

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

The example source is in [`examples/`](./examples). It is the integration reference for mounting and replacing controllers. Renderer tabs appear in the order **WebGL**, **Canvas 2D**, **DOM**, and **SVG**, with WebGL selected by default. Use the arrow keys, Home, or End to focus a tab, then Enter or Space to activate it. Each tab shows only its relevant controls, with library configuration grouped beside its output on desktop and above it on narrow screens. Playground actions stay below the output. DOM and SVG marker styling and overflow are host controls below the output; Canvas and WebGL marker appearance is library configuration in the settings column. Select options are ordered alphabetically, while the default motion remains **Ellipse** and fit remains **Cover**.
Choose **WebGL** for any planar motion, or choose **Lissajous**, **Helix**, **Lorenz**, or **Duffing**, then **3D coordinates** with a front or oblique orthographic camera. Drag the canvas with the primary mouse button or one finger to orbit around the motion, or focus the canvas and use the arrow keys. Dragging continues outside the canvas until release or cancellation. The camera stays at the same distance and stops short of the poles. **Camera preset** shows **Dragged view** after rotation; choosing **Front** or **Oblique** restores that preset without restarting motion. Planar views retain normal touch scrolling. Orbiting preserves motion time and manual pause, reprojects the entire retained drawing with current-camera depth testing. The projection remains orthographic.

Lissajous has a **Z cycles** parameter. Duffing's view displays forcing phase around a cylinder: `radius = 1.2 + 0.8 * tanh(displacement / 3)`, height is `velocity / 3`, and the circular X/Z coordinates are `radius * cos(phase)` and `radius * sin(phase)`. This is a continuous phase-space visualization rather than physical XYZ motion; the positive, bounded radius maps displacement monotonically and avoids a discontinuity at phase multiples of `2π`. The display mapping is computed only when the 3D view is selected.

Every renderer consumes the motion factory's `pose.depth` as a marker-size scale. Lissajous and Duffing use a `0.25` to `1` size range, as with the helix cue; Lorenz and ellipse also supply their size cues in the pose. The playground uses the same factory output for Canvas 2D, DOM, SVG, and WebGL, including WebGL 3D views. This cue is independent of camera clipping depth, and planar WebGL still has equal visibility depth for its markers.

Enable **Show trail** on Canvas 2D, SVG, or WebGL. **Tail length (samples)** defaults to `128` and keeps the latest positive safe integer number of positions; `1` produces no line. This control requires an enabled trail; DOM omits the history controls. **Show full path** appears only for analytic motions on Canvas 2D or SVG. For WebGL, **Show trail** retains connected geometry that follows the current view; **Accumulate drawing** retains world-space markers that rotate as one object. **Retained samples / paint limit** defaults to `12000` and bounds retained markers, discarding the oldest at the limit. Enable **Paint ribbon** to paint a continuous stroke with **Marker radius** controlling brush size and the selected circle or square defining the endpoint footprints. **Retained samples / paint limit** defaults to `12000`; **At sample limit** appears when WebGL's **Paint ribbon** is enabled and defaults to **Pause**, preserving the entire stroke; clear or reset before resuming. Choose **Trim oldest** to keep motion running while replacing the oldest paint within the same sample budget. Paint, trail, and accumulation are mutually exclusive; selecting one unchecks the other two. Marker shape remains available while painting. A stroke freezes its orientation and world-width calibration at its starting view, so camera orbit and resize only reproject it. Switching to WebGL with both controls checked selects the trail. **Lighting** is available in WebGL's 3D coordinate view and defaults off; it shades the current base colors during rendering while preserving retained geometry and motion time. The readout separates marker-size scale from visibility depth. Appearance, coordinate-view, and camera changes preserve motion time and manual pause. Camera and framing changes reproject all retained history. Outside paint mode, appearance and marker-shape changes update the current circle/square marker while older markers keep their sampled appearance; brush changes affect only future paint and preserve motion time and the existing stroke; coordinate-view changes discard retained drawing because they change the position mapping. Changing trail visibility, tail length, accumulation, paint mode, their sample limit, paint limit behavior, equation parameters, motion, or renderer remounts the animation and restarts its time while preserving manual pause. Invalid sample limits show a status message and keep the current animation running. **Restore playground defaults** disables paint and lighting, resets tail length to `128`, the retained-sample limit to `12000`, and **At sample limit** to **Pause**, then starts the default WebGL animation again.
If Chromium is not installed through Playwright, set `CHROME_PATH` to an installed Chrome or Chromium executable when running `pnpm test:browser`.

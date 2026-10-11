# WebGL reference

Use `animateWebGL` from `oscillate-wildly/webgl` to draw opaque markers, trails, accumulated markers, or ribbon paint on an existing canvas. This guide serves application developers; implementation details are in [Rendering internals](./rendering-internals.md). See [Integration](./integration.md) for shared framing, marker scale, scheduling, and lifecycle behavior, and [Motions](./motions.md) for model coordinates.

## Canvas setup and planar drawing

Use a dedicated canvas with a positive CSS size and backing bitmap. A canvas already used for Canvas 2D cannot provide a WebGL context. The adapter owns its GL context and leaves CSS and bitmap sizing to the application. It requests WebGL 1 and throws if the context or required GPU resources are unavailable; choose any fallback in application code.

The following complete TypeScript example creates a fixed-size canvas. Run it in a browser after `document.body` exists. Responsive applications should follow the sizing procedure in [Integration](./integration.md).

```ts
import { createEllipseMotion } from "oscillate-wildly";
import { animateWebGL } from "oscillate-wildly/webgl";

const canvas = document.createElement("canvas");
canvas.style.width = "480px";
canvas.style.height = "320px";
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(480 * dpr);
canvas.height = Math.round(320 * dpr);
document.body.append(canvas);

const controller = animateWebGL(canvas, createEllipseMotion(), {
  framing: { fit: "contain", padding: 10 },
  accumulate: { maxSamples: 12000 },
  marker: (frame) => ({
    radius: 6,
    color: [0.2, 0.6, (Math.sin(frame.elapsedSeconds) + 1) / 2],
  }),
});

// On application teardown:
// controller.dispose();
```

The example draws a colored ellipse and retains earlier markers. Omit `accumulate` to display only the current marker. Backgrounds and palettes belong to the application; an empty drawing is transparent.

## Spatial drawing and projection

Supply an orthographic `camera` to project XYZ positions. Lissajous, helix, and Lorenz expose XYZ model coordinates in `state` while keeping a planar `pose`; select those model coordinates with `position`. Duffing needs a deliberate phase-space mapping. Custom motions may supply `pose.z` directly. Missing `pose.z` is treated as zero in camera mode.

This standalone browser example uses the Lissajous model's XYZ state:

```ts
import { createLissajousMotion } from "oscillate-wildly";
import { animateWebGL } from "oscillate-wildly/webgl";

const canvas = document.createElement("canvas");
canvas.style.width = "480px";
canvas.style.height = "320px";
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(480 * dpr);
canvas.height = Math.round(320 * dpr);
document.body.append(canvas);

const spatial = animateWebGL(canvas, createLissajousMotion(), {
  position: ({ state }) => ({ x: state.x, y: state.y, z: state.z }),
  camera: {
    position: { x: 5, y: 4, z: 6 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    near: 0.1,
    far: 20,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
  },
  framing: { fit: "contain", padding: 10 },
  trail: { maxSamples: 128, width: 2 },
  marker: { radius: 5, color: [0.3, 0.8, 1] },
});
```

`position` receives the shared `Frame<State>` before WebGL projection. For stateful motions, `frame.pose` is interpolated between simulation steps, while `frame.state` is the current model snapshot. Mapping `state` therefore selects model values without pose interpolation. The selected coordinates preserve the pose's marker-size cue.

`OrthographicCamera` requires `position` and `bounds`. Its defaults are `target: { x: 0, y: 0, z: 0 }`, `up: { x: 0, y: 1, z: 0 }`, `near: 0.1`, and `far: 100`. All camera coordinates must be finite. Bounds must have finite, positive width and height. Near must be finite and nonnegative; far must be finite and greater than near. Position and target must differ, and up must form a nondegenerate basis with the view direction. Camera up points toward the screen's top; view-plane bounds use positive Y downward. `framing.bounds` overrides camera bounds.

Camera settings are copied on creation and `setCamera()`. Mutating the supplied object does not update the view. Projection does not automatically fit the 3D trajectory: select bounds and clipping distances that contain your motion. `projectOrthographic(pose, viewport, camera, framing?)` is also exported from the root and `/core` for projection without WebGL; it returns CSS-pixel coordinates and unclamped `visibilityDepth`.

## Options and appearance

`animateWebGL(canvas, motion, options?)` returns a `WebGLController`. The `/webgl` entry also exports `AnimateWebGLOptions`, `WebGLFrame`, `WebGLProjectedPose`, `WebGLMarkerOptions`, `WebGLColor`, trail/paint/accumulation option types, and `WebGLLightingOptions`.

| Option | Default | Behavior |
| --- | --- | --- |
| `framing` | `{}` | Shared planar framing; camera mode uses camera bounds unless overridden. |
| `markerScale` | Shared defaults | Maps the pose's marker-size cue; see [Integration](./integration.md). |
| `autoplay` | `true` | Starts scheduling subject to runtime suspension conditions. |
| `offscreen` | `true` | Suspends work when the target is outside the viewport. |
| `platform` | Browser platform | Injects runtime services, primarily for tests or another host. |
| `marker` | `{}` | Appearance object or `(frame) => appearance \| null`. Callback `null` skips the marker or lifts the paint brush. |
| `camera` | Omitted | Orthographic camera; omission selects planar projection. |
| `position` | Motion pose | `(frame) => ({ x, y, z })` selects coordinates. |
| `visibilityDepth` | `0.5` | Finite planar number or `(frame) => number`; `0` is near and `1` is far. Outside that interval drawing is clipped. Camera mode ignores this option and derives clipping depth from position. |
| `trail` | `false` | `true` or `{ maxSamples?, width?, color? }`; defaults are `128` samples and full width `1` CSS pixel. Color follows the current marker, or red when skipped. |
| `accumulate` | `false` | `true` or `{ maxSamples? }`; retains sampled markers, default `12000`, expiring the oldest at capacity. |
| `paint` | `false` | `true` or `{ maxSamples?, limitBehavior? }`; defaults are `12000` samples and `"pause"`. `"trim-oldest"` keeps running and expires earlier samples. |
| `onPaintLimit` | Omitted | Callback invoked once when a new paint budget fills in pause mode. Clear/reset starts a new budget; trim mode never invokes it. |
| `lighting` | `false` | `true` or an options object enables render-time shading. |

Trail, accumulation, and paint are mutually exclusive; enabling more than one throws `TypeError`. Every `maxSamples` must be a positive safe integer. Trail width must be finite and nonnegative; zero suppresses the line.

Marker appearance defaults to `{ radius: 5, color: [1, 0, 0], shape: "circle" }`. Radius is a nonnegative finite CSS-pixel radius multiplied by `pose.depth` (default `1`). Shape is `"circle"` or `"square"`; color is a readonly tuple of three finite RGB channels in `[0, 1]`. `pose.depth` controls size independently of `visibilityDepth`. `pose.opacity` is ignored. Markers are flat and camera-facing. Blending is disabled; nearer geometry occludes farther geometry, and later geometry wins at equal depth.

Appearance callbacks receive `WebGLFrame<State>`: `pose` contains the selected coordinates, `position` includes clipping depth, and `project(pose)` uses the current projection. To skip drawing, use **`marker: () => null`**. A literal `marker: null` is not part of the TypeScript API and falls back to the default marker at runtime.

## Retained drawing

A trail retains world-space positions, projects them into the current view, and draws a connected opaque tail with the current marker. All positions share one current tail color. `maxSamples: 1` leaves no line. A change in a motion's `pathSegment` starts a separate connected segment, including helix loop boundaries. The sample budget applies across all segments.

Accumulation retains each marker's XYZ coordinates, size cue, radius, color, shape, and planar visibility depth. Earlier markers keep their sampled appearance. Redraws at the same elapsed time replace the current sample when it changes without aging history. `marker: () => null` adds no marker and preserves existing history. `maxSamples: 1` retains only the latest marker.

Paint uses the marker's circle or square footprint to deposit a connected world-space ribbon. Radius multiplied by `pose.depth` controls brush size; square footprints can be wider along a diagonal. There is no separate ribbon-width setting. Each stroke captures its orientation and CSS-pixel-to-world size calibration from its starting camera, viewport, and framing. Subsequent camera, framing, and size changes reproject existing paint without recalibrating that stroke. The stroke may turn edge-on as the camera rotates. Radius, shape, and color changes affect future paint. Stationary or paused redraws add no degenerate segments or replace deposited samples.

Callback `null`, zero radius, and motion path discontinuities lift the brush. The next deposit begins a separate stroke with fresh calibration. Start and end footprints cap each stroke; circular footprints produce rounded ends. At a pause-mode budget limit, the controller pauses and preserves all paint; `resume()` cannot restart an active full brush until its budget is cleared or reset. Trim mode retains a connected suffix without connecting across brush lifts. `maxSamples: 1` retains only the latest footprint.

To paint instead of a trail, replace the spatial example's `trail` option with `paint: { maxSamples: 12000, limitBehavior: "pause" }`. Do not enable both options.

## Lighting

Lighting is disabled by default and preserves base RGB colors. `true` or `{}` enables the defaults below. Each options object replaces the complete configuration; omitted nested fields resolve to defaults. Lighting options and tuples are copied on creation and `setLighting()`.

| Field | Default | Constraints and meaning |
| --- | --- | --- |
| `ambient.color` | `[1, 1, 1]` | Three finite RGB channels in `[0, 1]`. |
| `ambient.intensity` | `0.3` | Finite value in `[0, 4096]`. |
| `directional.direction` | `[-0.45, 0.65, 1]` | Three finite components pointing toward the light; nonzero and normalized internally. |
| `directional.space` | `"view"` | `"view"` follows the viewer; `"world"` follows motion axes. |
| `directional.color` | `[1, 1, 1]` | Three finite RGB channels in `[0, 1]`; also tints highlights. |
| `directional.intensity` | `0.7` | Finite value in `[0, 4096]`; zero disables highlights too. |
| `specular.intensity` | `0.12` | Finite value in `[0, 4096]`; zero gives matte shading. Effective strength `intensity * directional.intensity / 0.7` must also be at most `4096`. |
| `specular.shininess` | `24` | Finite value in `[1 / 16384, 16384]`; higher gives sharper highlights. |
| `depthCue.strength` | `0.3` | Finite value in `[0, 1]`; darkens toward the far clipping plane. Zero disables the depth cue independently. |

All nested fields are optional. Malformed objects, field types, and direction spaces throw `TypeError`; invalid numeric values, channels, or zero direction throw `RangeError`. Invalid `setLighting()` configurations preserve the previous settings. Creation validates lighting before allocating GPU resources.

View axes are X right, Y up, and Z toward the viewer. World directions follow camera rotation, independently of translation. In planar mode, world axes are X right, Y down, and Z away, so world `[x, y, z]` becomes view `[x, -y, -z]`. The depth cue uses clipping depth independently of the size cue.

The following continues the `spatial` example above:

```ts
import type { WebGLLightingOptions } from "oscillate-wildly/webgl";

const lighting: WebGLLightingOptions = {
  ambient: { intensity: 0.2 },
  directional: { direction: [1, -1, 2], space: "world", color: [1, 0.85, 0.65] },
  specular: { intensity: 0.15, shininess: 32 },
  depthCue: { strength: 0 },
};
spatial.setLighting(lighting);
spatial.setLighting(true); // Replace with default lighting.
spatial.setLighting(false); // Display base RGB colors.
```

Shading applies to current and retained geometry without changing stored colors. Lighting is two-sided; markers remain flat, and paint has smooth normals shared along connected surfaces and end caps. See [Rendering internals](./rendering-internals.md) for normal generation and extension fallback. Lighting does not provide shadows or custom shaders.

## Controller and recovery

| Method | Effect |
| --- | --- |
| `pause()`, `resume()`, `isPaused()` | Shared lifecycle controls, subject to runtime suspension and paint capacity. |
| `reset()` | Discards retained history, restarts motion, and renders the initial drawing. |
| `setFraming(framing)` | Reprojects without restarting time or changing manual pause. |
| `setMarkerScale(options)` | Updates the size cue without restarting motion. Earlier accumulated sizes and deposited paint remain; the current accumulated sample can update, and paint changes affect future deposits. |
| `dispose()` | Removes listeners/observers and deletes live GPU resources. |
| `clear()` | Discards history and presents an empty transparent drawing immediately without resetting motion. The next render can draw again; after clearing a full paint budget, call `resume()` to continue. |
| `setCamera(camera \| undefined)` | Copies and validates a new camera, then reprojects retained drawing; `undefined` returns to planar mode. |
| `setLighting(lighting)` | Replaces shading and redraws the cached scene without invoking application callbacks, adding samples, or changing time/pause. After `clear()`, lighting changes keep the drawing empty. |
| `isPaintFull()` | Reports a full retained paint budget; false outside paint mode. Full does not imply paused in trim mode. |

CSS viewport changes and bitmap attribute changes reproject retained drawing, including while paused. A zero-size target suspends scheduling until it becomes drawable. If a callback starts returning coordinates in a different system, clear history before mixing those coordinates with earlier samples.

Context loss suspends motion time. Restoration rebuilds GPU resources from retained CPU history and redraws with the selected lighting. Manual pause, document visibility, offscreen state, and reduced-motion conditions still govern scheduling. A lighting-only update during loss reuses captured inputs on restoration without reevaluating callbacks; explicit camera, framing, or marker-scale updates during loss apply on recovery. Resource restoration failures dispose the controller and throw.

The adapter's context cannot be interleaved with another renderer. All modes are clipped by the canvas. Perspective projection, translucent drawing, anti-aliased marker edges, and built-in camera interaction are unavailable; implement camera controls using `setCamera()`. Return to the [README](../README.md) for package entry points and quick start.

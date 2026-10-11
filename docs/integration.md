# Integrating DOM, Canvas 2D, and SVG

This guide is for applications mounting animations into existing browser elements. It describes the consumer API in package version 1.6.0. Install the package and configure a TypeScript-capable ESM bundler as shown in the [README](../README.md). The snippets below are TypeScript modules; run their mount functions after the corresponding markup exists and retain the returned cleanup function for unmounting. See [motions](./motions.md) for source selection and [WebGL](./webgl.md) for GPU rendering.

## Ownership and client lifecycle

The application creates, sizes, styles, and removes every element. Adapters never create a viewport or marker. Give the viewport a finite, positive rendered width and height: a zero-size viewport skips drawing and suspends scheduling until a resize makes it drawable. Use the browser's `ResizeObserver` for resize notifications; without it, the default platform does not observe size changes.

Static package imports are safe during server rendering because browser services are accessed lazily. Call browser adapters only in a client lifecycle after real elements are mounted. Server-render the markup if useful, then mount the animation after hydration. A framework effect or equivalent mount hook should return the cleanup function. No framework dependency is required.

Only one controller can own a target at a time. For DOM and SVG the target is the marker; for Canvas 2D and WebGL it is the canvas. Dispose the previous controller before mounting a replacement on that target. Each stateful motion source can belong to only one controller at a time; create a separate source for each animation. Attempting either duplicate ownership throws. Analytic sources can be sampled by multiple consumers, including a controller and static path helper.

All controllers draw an initial still frame when the viewport is valid, including with `autoplay: false`. Default browser controllers suspend scheduled motion while the document is hidden or reduced motion is requested. Resume does not override these conditions. Canvas 2D and WebGL also pause offscreen by default; SVG defaults to continuing offscreen and can opt into pausing. DOM has no `offscreen` option and always disables that check.

## DOM

The viewport must establish the marker's containing block. Position the marker at the top-left origin and provide its dimensions; the adapter translates its center to the projected point. The following markup and styles work with `mountDom`:

```html
<div id="dom-field" aria-hidden="true">
  <div id="dom-dot"></div>
</div>
```

```css
#dom-field {
  position: relative;
  width: min(100%, 640px);
  height: 320px;
  overflow: hidden;
  background: #111827;
}
#dom-dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #7dd3fc;
}
```

```ts
import { createEllipseMotion } from "oscillate-wildly";
import { animateDom } from "oscillate-wildly/dom";

export function mountDom(): () => void {
  const viewport = document.querySelector<HTMLElement>("#dom-field");
  const marker = document.querySelector<HTMLElement>("#dom-dot");
  if (!viewport || !marker) throw new Error("DOM animation markup is missing");

  const controller = animateDom({ viewport, marker }, createEllipseMotion(), {
    framing: { fit: "contain", padding: 20 },
  });
  return () => controller.dispose();
}
```

`animateDom(targets, motion, options?)` measures `viewport.getBoundingClientRect()` in CSS pixels. The default renderer writes the marker's inline transform as a translation, a `translate(-50%, -50%)` centering correction, an optional depth scale, then the original inline transform. It sets opacity from `pose.opacity`, or restores the original inline opacity when that channel is absent. Disposal restores both original inline values. The application owns layout, clipping, marker appearance, and any other style changes made by a custom renderer.

| DOM option | Contract |
| --- | --- |
| `framing` | Shared projection options; defaults described below. |
| `markerScale` | Shared depth presentation; defaults described below. |
| `autoplay` | Defaults to `true`. `false` draws the initial frame without advancing. |
| `render` | Optional `(frame, targets) => void`; completely replaces default transform, depth, and opacity rendering. |

## Canvas 2D

The canvas has two independent sizes: its CSS rectangle establishes the animation viewport, and its `width`/`height` attributes establish the backing bitmap. `animateCanvas` changes neither. Size the bitmap for your chosen device-pixel ratio (DPR) before mounting and update it when the CSS size or DPR changes. Bitmap resizing clears the canvas and resets its context state. The adapter scales its render context from bitmap pixels to CSS pixels each frame, so custom renderers should use `frame.position` directly and should not apply DPR scaling again.

```html
<canvas id="canvas-field" aria-hidden="true"></canvas>
```

```css
#canvas-field {
  display: block;
  width: min(100%, 640px);
  height: 320px;
  background: #111827;
}
```

```ts
import { createEllipseMotion, type EllipseState } from "oscillate-wildly";
import { animateCanvas, renderCanvasMarker } from "oscillate-wildly/canvas";
import { createCanvasPath } from "oscillate-wildly/canvas/path";
import { createCanvasTrail } from "oscillate-wildly/canvas/trail";

export function mountCanvas(): () => void {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas-field");
  if (!canvas) throw new Error("Canvas animation markup is missing");

  const framing = { fit: "contain" as const, padding: 20 };
  const motion = createEllipseMotion({ radiusX: 2 });
  const path = createCanvasPath(motion, { color: "#334155" });
  const trail = createCanvasTrail<EllipseState>({ color: "#7dd3fc", width: 2 });

  const sizeBitmap = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };
  sizeBitmap();

  const controller = animateCanvas(canvas, motion, {
    framing,
    render(context, frame) {
      path(context, frame);
      trail(context, frame);
      renderCanvasMarker(context, frame, { radius: 6, color: "#f8fafc" });
    },
  });
  const resize = (): void => {
    sizeBitmap();
    // Redraw even when paused: changing bitmap attributes clears its contents.
    controller.setFraming(framing);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener("resize", resize);

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", resize);
    controller.dispose();
    trail.clear();
  };
}
```

This example requires `ResizeObserver`. The host resize listener also rechecks DPR; if the application detects a DPR change through another mechanism, run the same sizing and redraw steps. The runtime's own resize observer reprojects motion but does not resize the bitmap. If your application changes framing, keep the framing used by its resize callback up to date.

`animateCanvas(canvas, motion, options?)` requires an existing 2D context and throws if one is unavailable. Each render saves context state, resets the transform, optionally clears the entire backing bitmap, applies CSS-pixel scaling, calls the renderer, and restores context state.

| Canvas option | Default and contract |
| --- | --- |
| `framing`, `markerScale` | Shared options below. |
| `autoplay` | `true`. |
| `offscreen` | `true`; set `false` to continue when outside the viewport. |
| `clear` | `true`; clear the entire bitmap before each render. `false` leaves previous bitmap content. |
| `marker` | `{ radius?: number, color?: string \| CanvasGradient \| CanvasPattern }`; radius defaults to `5` CSS pixels and color to `"red"`. |
| `render` | Optional `(context, frame) => void`; replaces the built-in marker, while clearing and context scaling still occur. |

`renderCanvasMarker(context, frame, markerOptions?)` draws a filled circle with radius multiplied by `frame.pose.depth ?? 1` and alpha set to `frame.pose.opacity ?? 1`. Compose it explicitly after helpers in a custom callback to retain the standard marker behavior.

## SVG

Create the marker around local coordinate `(0, 0)`. SVG geometry, fill, stroke, CSS size, `viewBox`, `preserveAspectRatio`, and clipping belong to the application. Set `fill="none"` on line paths so SVG's default fill does not fill the curve. Place the path elements before the marker to draw them behind it.

```html
<svg id="svg-field" viewBox="0 0 640 320" aria-hidden="true">
  <path id="svg-full-path" fill="none" stroke="#334155" stroke-width="2" />
  <path id="svg-trail" fill="none" stroke="#7dd3fc" stroke-width="2" />
  <circle id="svg-dot" cx="0" cy="0" r="6" fill="#f8fafc" />
</svg>
```

```css
#svg-field {
  display: block;
  width: min(100%, 640px);
  height: 320px;
  overflow: hidden;
  background: #111827;
}
```

```ts
import { createEllipseMotion, type EllipseState } from "oscillate-wildly";
import { animateSvg, renderSvgMarker } from "oscillate-wildly/svg";
import { createSvgStaticPath } from "oscillate-wildly/svg/path";
import { createSvgTrail } from "oscillate-wildly/svg/trail";

export function mountSvg(): () => void {
  const viewport = document.querySelector<SVGSVGElement>("#svg-field");
  const marker = document.querySelector<SVGGraphicsElement>("#svg-dot");
  const fullPath = document.querySelector<SVGPathElement>("#svg-full-path");
  const trailPath = document.querySelector<SVGPathElement>("#svg-trail");
  if (!viewport || !marker || !fullPath || !trailPath) {
    throw new Error("SVG animation markup is missing");
  }

  const motion = createEllipseMotion({ radiusX: 2 });
  const framing = { fit: "contain" as const, padding: 20 };
  const path = createSvgStaticPath({ viewport, path: fullPath, motion, framing });
  const trail = createSvgTrail<EllipseState>({ viewport, path: trailPath });
  const controller = animateSvg({ viewport, marker }, motion, {
    framing,
    render(frame, targets) {
      trail.render(frame);
      renderSvgMarker(frame, targets);
    },
    onReset: () => trail.clear(),
    onDispose: () => {
      trail.dispose();
      path.dispose();
    },
  });
  return () => controller.dispose();
}
```

`animateSvg(targets, motion, options?)` measures local CSS dimensions (`clientWidth`/`clientHeight`, with a bounding-rectangle fallback), then converts positions through the existing `viewBox`, `preserveAspectRatio`, and target transforms. The default renderer translates the marker, applies its depth scale, and preserves the original `transform` attribute. It sets or restores the original `opacity` attribute according to the pose. Disposal restores those two marker attributes before calling the consumer's `onDispose`.

| SVG option | Default and contract |
| --- | --- |
| `framing`, `markerScale` | Shared options below. |
| `autoplay` | `true`. |
| `offscreen` | `false`; set `true` to pause when outside the viewport. |
| `render` | Optional `(frame, targets) => void`; replaces default marker rendering completely. Use `renderSvgMarker(frame, targets)` to compose the standard behavior. |
| `onReset` | Optional `() => void`, called after motion reset and before the reset frame renders. |
| `onDispose` | Optional `() => void`, called once after controller resources and marker attributes are restored. |
| `platform` | Optional injected runtime services, primarily for tests; normally omitted in browser applications. |

Changing the SVG `viewBox` or ancestor transforms does not itself guarantee a runtime resize notification. After such a change, redraw the controller with its current framing and call the static path's `render()` so both use the new coordinate conversion.

## Trail and static path reference

Trails retain world-space poses and reproject their whole history when rendering with changed framing or viewport dimensions. Redrawing at the same elapsed time replaces the latest sample instead of extending history. A `pathSegment` change starts a new subpath instead of joining across a discontinuity. A reset to time zero after positive elapsed time clears history; use `clear()` when an explicit reset of helper history is needed, including before a reset-frame render.

| Helper and import | Options and default behavior | Lifetime |
| --- | --- | --- |
| `createCanvasTrail<State>` from `oscillate-wildly/canvas/trail` | Optional `maxSamples: 128`, `width: 1` CSS pixel, `color: "rgba(255, 0, 0, 0.45)"` (string, gradient, or pattern). | Returns `(context, frame) => void` with `.clear()`. No observers or `dispose()` method. Stop calling it and release the reference when done. |
| `createCanvasPath(motion, options?)` from `oscillate-wildly/canvas/path` | Analytic source only. Optional `maxSegments: 2048`, `width: 1` CSS pixel, `color: "rgba(255, 0, 0, 0.3)"` (string, gradient, or pattern). Samples one period and refines toward two CSS pixels per segment, subject to the cap. Caches samples until projection changes. | Returns `(context, frame) => void`; no `clear()` or `dispose()` method. Release the reference when done. |
| `createSvgTrail<State>(options)` from `oscillate-wildly/svg/trail` | Required `viewport` and consumer-created `path`; optional `maxSamples: 128`. Styling stays on the path. | Returns `render(frame)`, `clear()`, `dispose()`. `clear()` empties `d`; disposal restores the original `d` attribute or removes it if originally absent. |
| `createSvgStaticPath(options)` from `oscillate-wildly/svg/path` | Required `viewport`, `path`, and analytic `motion`; optional `framing`, `segmentLength: 2` CSS pixels, `maxSegments: 2048`. Estimates arc length and samples one period up to the cap; segment length is a target, not a strict guarantee. | Renders immediately and observes viewport resize when `ResizeObserver` is available. Returns `render()`, `update(framing?)`, `dispose()`. `update` replaces framing; omitted framing restores defaults. Disposal disconnects the observer and restores original `d`. |

`renderSvgStaticPath` is an alias that returns the same managed helper as `createSvgStaticPath`; retain and dispose its result. SVG helpers are independent of the controller: wire their disposal into `onDispose`, as above, or dispose them separately. To change framing with an SVG static path, call both `controller.setFraming(nextFraming)` and `path.update(nextFraming)`.

`maxSamples` and `maxSegments` must be positive safe integers; invalid values throw `RangeError`. A trail with `maxSamples: 1` produces no line. SVG `segmentLength` must be finite and positive. DOM has no built-in trail or static path helper.

## Shared framing and marker size

| `framing` field | Default and meaning |
| --- | --- |
| `fit` | `"cover"`: uniform scale filling the viewport, which can crop bounds. `"contain"` fits both dimensions uniformly; `"stretch"` scales axes independently. |
| `zoom` | `1`; finite and greater than zero. Values above one enlarge the projected motion. |
| `padding` | `16` CSS pixels for `contain`, otherwise `0`. Must be finite and nonnegative; only applied to `contain`, capped at half the viewport dimensions. |
| `offsetX`, `offsetY` | `0`; fractions of viewport width and height. Positive values move right/down. |
| `bounds` | Motion source bounds; optionally replace with `{ minX, maxX, minY, maxY }`. Both spans must be finite and greater than zero. |

Padding reserves a fixed inset, not an inferred marker footprint. Choose it for the maximum marker radius, stroke, glow, and depth scale you intend to display. Zoom and offsets can move drawing beyond the viewport. Custom parameters may require custom bounds; see [motions](./motions.md).

`markerScale` changes presentation of `pose.depth`, independently of world position, `pose.z`, and WebGL clipping depth. It applies before your render callback:

| Field | Default and meaning |
| --- | --- |
| `depthStrength` | `1`; amplifies departure from scale `1`. `0` disables native size variation. |
| `minMarkerScale` | `0`; lower clamp. |
| `maxMarkerScale` | Omitted for no upper limit; upper clamp when provided. |

The calculation is `clamp(1 + depthStrength * ((pose.depth ?? 1) - 1), minMarkerScale, maxMarkerScale)`. Provided settings must be finite and nonnegative, with minimum no greater than maximum; invalid settings throw `RangeError`. Position projection remains the same. Custom renderers choose whether and how to consume the resulting depth and opacity channels.

## Frame callback and controller reference

Render callbacks receive `Frame<State>`, available as a public type from `oscillate-wildly` or `oscillate-wildly/core`. `frame.state` preserves model state; `frame.pose` is the world-space pose after interpolation and marker-scale presentation; `frame.position` is its CSS-pixel projection. `frame.viewport` contains CSS dimensions, `frame.elapsedSeconds` is controller motion time, and optional `frame.pathSegment` identifies continuous motion. `frame.project(pose)` reprojects another world-space pose with the current viewport and framing; it does not apply marker-scale settings to the supplied pose. Keep callbacks short and synchronous. A render or motion error during a scheduled frame disposes that controller and rethrows the error.

Adapters return a controller. Infer its type with `ReturnType<typeof animateDom>` (or the adapter you use) when needed; there is no exported `oscillate-wildly/runtime` package subpath.

| Method | Observable behavior |
| --- | --- |
| `pause()` | Records manual pause and stops scheduled advancement. |
| `resume()` | Clears manual pause; scheduling resumes when visibility, size, motion preferences, and adapter availability allow it. |
| `reset()` | Resets source state, elapsed time, and interpolation; invokes any `onReset`, then redraws the initial frame. Preserves manual pause. |
| `setFraming(framing)` | Replaces the entire framing object and redraws the current motion without resetting time or pause. Omitted fields revert to defaults; this is not a merge. |
| `setMarkerScale(options)` | Replaces the entire scale configuration and redraws without resetting time or pause. Omitted fields revert to defaults. |
| `isPaused()` | Reports suspension from manual pause, document visibility, zero size, reduced motion, offscreen checks, or renderer availability. It is not solely a manual-pause flag. |
| `dispose()` | Idempotently stops scheduling, removes runtime observers/listeners, releases target/source ownership, and invokes adapter cleanup. |

Mutating methods become no-ops after disposal. Do not use `isPaused()` as a disposed-state check. Canvas disposal does not erase the bitmap; clear it yourself if the element remains visible. DOM and SVG restore the marker properties described above, while application-owned helper resources and additional custom-renderer changes require application cleanup.

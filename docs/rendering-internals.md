# WebGL rendering internals

This document serves contributors investigating rendering behavior and performance. The consumer contract is in [WebGL reference](./webgl.md); these storage layouts are implementation details rather than public APIs. The source of truth is [the adapter](https://github.com/phobetron/oscillate-wildly/blob/master/src/webgl/index.ts), [renderer](https://github.com/phobetron/oscillate-wildly/blob/master/src/webgl/renderer.ts), [brush geometry](https://github.com/phobetron/oscillate-wildly/blob/master/src/webgl/ribbon.ts), and [lighting resolver](https://github.com/phobetron/oscillate-wildly/blob/master/src/webgl/lighting.ts).

## Scene and resource ownership

The adapter requests a WebGL 1 context with `{ alpha: true, depth: true, antialias: false }`. It owns the context, reusable programs, buffers, color texture, depth renderbuffer, and framebuffer. It renders into color/depth attachments and presents the color texture on the canvas. Before redrawing the complete scene, it clears color and depth so occlusion reflects the current camera. Blending is disabled and drawing uses `LEQUAL` depth comparison, allowing later geometry at equal depth to win.

Bitmap resize reallocates framebuffer attachment storage while preserving geometry. CSS size defines projection and CSS-pixel appearance sizes; the backing bitmap defines raster resolution. The adapter observes bitmap width/height attributes separately from CSS resize notifications. Context loss suspends the runtime's availability; restoration recreates resources and restores retained CPU history. Disposal removes availability listeners and dimension observers and deletes live resources.

## Coordinates and accumulated markers

The adapter builds an affine projection matrix by projecting the origin and three unit basis vectors. The vertex shader projects retained world-space coordinates. In planar accumulation, a separate stored visibility-depth attribute replaces world Z for clipping. Camera mode uses actual XYZ geometry. Marker quads then expand in screen coordinates, keeping circles and squares camera-facing and their radii in CSS pixels.

Each marker occupies six triangle vertices. Each vertex has 11 floats: world XYZ, local XY corner, RGB, circle flag, scaled radius, and planar visibility depth. A marker slot is therefore 66 floats. CPU and GPU storage grows geometrically up to the selected sample limit. Once capacity is stable, a new or replaced sample uploads one slot with `bufferSubData`. Growth and restoration require larger uploads.

The circular buffer draws in chronological order using one or two ranges across its wrap point. Drawing the retained scene is O(retained samples), even when upload work is small. Camera changes update the projection matrix without repacking or uploading accumulated vertices. Lighting changes update shading uniforms without geometry uploads.

## Trails and paint

Trails retain XYZ positions and planar depths in shared chronological history. The adapter separates path segments, projects their samples on the CPU, and the renderer constructs screen-space triangle geometry for the specified CSS-pixel width. Camera changes can therefore rebuild and upload trail vertices; the no-upload camera path applies to retained markers and paint, not trails.

Paint calibrates the projected world basis at each stroke's first sample. It uses that fixed basis to recover a world-space side vector and brush-plane axes from CSS-pixel radius. The square brush's support width includes the absolute projected normal components. A singular mapping or zero effective radius lifts the brush rather than inverting a degenerate basis.

Paint keeps a chronological buffer of connecting surfaces and endpoint footprints. Advancing removes the previous leading cap, appends a surface and new leading cap, and updates adjoining normals. Pause mode preserves the original starting cap; trim mode replaces expired geometry with a cap at the oldest surviving sample. Separate strokes retain explicit connectivity, so coincident points across brush lifts do not share normals or form connectors.

The footprint renderer stores 12 vertices per slot, each with nine floats: XYZ, RGB, local XY, and circle flag. A separate normal buffer stores three floats per vertex. Dirty slots identify small affected regions for `bufferSubData`; capacity growth or restoration triggers full upload. Positions, colors, endpoint data, and CPU/GPU capacities remain bounded by the paint sample budget. Drawing uses one or two chronological ranges. Camera-only redraws update the projection and normal matrices without uploading paint geometry.

## Lighting and normals

The lighting resolver validates and copies a complete replacement configuration before GPU allocation on creation. It normalizes light directions safely by scaling components first. Intensity limits leave room for ambient, directional, and specular contributions within WebGL 1's minimum fragment `mediump` range. The effective specular strength also accounts for directional intensity.

Shading combines ambient color, clamped diffuse illumination, a half-vector specular highlight, and normalized clipping-depth darkening. Base colors stay in retained storage. A zero directional intensity disables specular highlights; a zero depth-cue strength disables only depth darkening.

Marker and trail shaders derive surface normals from screen-space depth derivatives when `OES_standard_derivatives` is available, and otherwise use a constant front-facing normal. This optional extension does not gate rendering. These surfaces are flat rather than spherical. Shader generation selects depth precision according to fragment precision support and evaluates shading before circular fragment discards so derivative calculations see complete fragment quads.

Paint supplies world-space normals explicitly. It accumulates area-weighted triangle normals at shared connected vertices and interpolates them across adjoining segments. Endpoint caps share the endpoint's adjoining normals; the first moving segment finalizes the starting cap's orientation. The shader transforms normals into the view basis without projection scale, normalizes them, and flips back-facing normals for two-sided lighting. This paint-normal path does not require derivative extensions.

## Redraw and recovery boundaries

Application position, depth, and appearance callbacks run during ordinary frame rendering. Retained markers capture their appearance; retained paint captures deposit geometry and color. Same-time marker redraws replace the latest sample, while paused paint redraws preserve deposits. Path discontinuities break trail segments and brush strokes.

The adapter caches a scene redraw closure and its input. `setLighting()` redraws through that closure without invoking callbacks or changing retained samples. `clear()` discards the closure and captured input as well as history. During context restoration, a lighting-only update can replay captured inputs; a presentation change that requests a runtime render invalidates those inputs so recovery applies the current presentation. Selected lighting survives resource recreation.

Consult [Integration](./integration.md) for the runtime's shared scheduling and motion lifecycle. These implementation choices should be rechecked against source when changing renderer storage or shaders.

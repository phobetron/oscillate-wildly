import { projectOrthographic, validateOrthographicCamera } from '../core';
import type { Framing, MotionSource, OrthographicCamera, Point3D, Pose, ProjectedPose, Viewport } from '../core';
import { createController } from '../runtime';
import type { Controller, Frame, RuntimePlatform } from '../runtime';
import { createTrailHistory } from '../runtime/trail';
import { createMarkerRenderer } from './renderer';
import type { WebGLMarker, WebGLMarkerOptions, WebGLTrailStyle } from './renderer';
import { createRibbonBrush } from './ribbon';

export type { WebGLColor, WebGLMarkerOptions } from './renderer';

export interface WebGLProjectedPose extends ProjectedPose {
  /** Near = 0, far = 1. Positions outside this interval are clipped. */
  readonly visibilityDepth: number;
}

export interface WebGLFrame<State> extends Frame<State> {
  readonly position: WebGLProjectedPose;
  project(pose: Pose): WebGLProjectedPose;
}

export interface WebGLTrailOptions extends WebGLTrailStyle {
  /** Maximum retained positions. Must be a positive safe integer. Defaults to 128. */
  readonly maxSamples?: number;
  /** Opaque color for the whole tail. Defaults to the current marker color, or red when skipped. */
  readonly color?: WebGLTrailStyle['color'];
}

export interface WebGLAccumulationOptions {
  /** Maximum retained markers. Positive safe integer; defaults to 12000. Oldest markers expire at the limit. */
  readonly maxSamples?: number;
}

export interface WebGLPaintOptions {
  /** Maximum brush samples before painting pauses. Defaults to 12000. Earlier paint is preserved. */
  readonly maxSamples?: number;
}

export interface AnimateWebGLOptions<State> {
  readonly framing?: Framing;
  readonly autoplay?: boolean;
  /** Defaults to true, as with the Canvas adapter. */
  readonly offscreen?: boolean;
  /** Shade all drawing at render time with surface lighting and a depth cue. Defaults to false (flat base colors). */
  readonly lighting?: boolean;
  /** Retain bounded world-space markers, including across view changes. true uses defaults. Defaults to false. */
  readonly accumulate?: boolean | WebGLAccumulationOptions;
  /** Paint a connected ribbon using the marker footprint, independently of marker shape. Exclusive with trail and accumulate. */
  readonly paint?: boolean | WebGLPaintOptions;
  /** Called once when a ribbon brush fills its sample budget and pauses. Clear or reset starts a new budget. */
  readonly onPaintLimit?: () => void;
  /** Bounded, opaque connected tail. true uses defaults. Cannot be combined with accumulate. */
  readonly trail?: boolean | WebGLTrailOptions;
  /** Opaque marker appearance, evaluated with the current projected frame. null skips drawing. */
  readonly marker?: WebGLMarkerOptions | ((frame: WebGLFrame<State>) => WebGLMarkerOptions | null);
  /** Fixed orthographic camera. Omit for the existing planar framing. */
  readonly camera?: OrthographicCamera;
  /** Select model coordinates without changing the motion's legacy planar pose. */
  readonly position?: (frame: Frame<State>) => Point3D;
  /** Planar visibility depth in [0, 1], independent of pose.depth. Defaults to 0.5. Camera mode derives it from position. */
  readonly visibilityDepth?: number | ((frame: Frame<State>) => number);
  readonly platform?: RuntimePlatform;
}

export interface WebGLController extends Controller {
  /** Whether deposited ribbon paint has filled its sample budget. */
  isPaintFull(): boolean;
  /** Clear all drawing and retained history immediately, without resetting or redrawing the motion. */
  clear(): void;
  /** Reproject all retained drawing without changing motion/pause. undefined returns to planar mode. */
  setCamera(camera: OrthographicCamera | undefined): void;
  /** Change shading and redraw retained geometry without changing motion, samples, or pause state. */
  setLighting(enabled: boolean): void;
}

const snapshotCamera = (camera: OrthographicCamera | undefined): OrthographicCamera | undefined => {
  if (!camera) return undefined;
  validateOrthographicCamera(camera);
  return {
    ...camera,
    position: { ...camera.position },
    target: camera.target ? { ...camera.target } : undefined,
    up: camera.up ? { ...camera.up } : undefined,
    bounds: { ...camera.bounds },
  };
};

const writeProjectionMatrix = (
  project: (pose: Pose) => WebGLProjectedPose,
  viewport: Viewport,
  matrix: Float32Array,
): void => {
  // An affine projection is determined by the origin and three basis vectors.
  const zero = project({ x: 0, y: 0, z: 0 });
  const axes = [project({ x: 1, y: 0, z: 0 }), project({ x: 0, y: 1, z: 0 }), project({ x: 0, y: 0, z: 1 })];
  axes.forEach((axis, index) => {
    matrix[index * 4] = (axis.x - zero.x) * 2 / viewport.width;
    matrix[index * 4 + 1] = (zero.y - axis.y) * 2 / viewport.height;
    matrix[index * 4 + 2] = (axis.visibilityDepth - zero.visibilityDepth) * 2;
    matrix[index * 4 + 3] = 0;
  });
  matrix[12] = zero.x * 2 / viewport.width - 1;
  matrix[13] = 1 - zero.y * 2 / viewport.height;
  matrix[14] = zero.visibilityDepth * 2 - 1;
  matrix[15] = 1;
};

/**
 * Draw opaque camera-facing markers and optional tails using WebGL 1.
 * Owns the canvas's GL context, never its CSS or bitmap dimensions. Retained
 * world-space geometry is redrawn through the current camera on every frame.
 */
export const animateWebGL = <State>(
  canvas: HTMLCanvasElement,
  motion: MotionSource<State>,
  options: AnimateWebGLOptions<State> = {},
): WebGLController => {
  const trail = options.trail ? options.trail === true ? {} : options.trail : undefined;
  const history = trail ? createTrailHistory<{ pose: Pose; visibilityDepth: number }>(trail.maxSamples) : undefined;
  const accumulation = options.accumulate ? options.accumulate === true ? {} : options.accumulate : undefined;
  const paint = options.paint ? options.paint === true ? {} : options.paint : undefined;
  if ([trail, accumulation, paint].filter(Boolean).length > 1) throw new TypeError('WebGL trail, accumulate, and paint cannot be combined');
  const accumulationLimit = accumulation?.maxSamples ?? 12000;
  const ribbon = paint ? createRibbonBrush(paint.maxSamples) : undefined;
  let previousBrushPose: Pose | undefined;
  let brushBasis: { x: number[]; y: number[]; xx: number; yy: number; xy: number; determinant: number } | undefined;
  let currentBrush = false;
  const markers = accumulation ? createTrailHistory<WebGLMarker>(accumulationLimit) : undefined;
  const markerProjection = new Float32Array(16);
  let previousMarkerTime: number | undefined;
  let previousMarker: WebGLMarker | undefined;
  let markerRendererNeedsRestore = true;
  if (trail) {
    if (!Number.isFinite(trail.width ?? 1) || (trail.width ?? 1) < 0) {
      throw new RangeError('WebGL trail width must be finite and non-negative');
    }
    if (trail.color && (trail.color.length !== 3
      || !trail.color.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1))) {
      throw new RangeError('WebGL trail color must contain three RGB channels in [0, 1]');
    }
  }
  const clearHistory = (): void => {
    history?.clear(); markers?.clear(); ribbon?.clear(); previousBrushPose = undefined; brushBasis = undefined; previousMarkerTime = undefined; previousMarker = undefined; markerRendererNeedsRestore = true;
  };
  let camera = snapshotCamera(options.camera);
  let framing = options.framing ?? {};
  let lighting = options.lighting ?? false;
  if (typeof lighting !== 'boolean') throw new TypeError('WebGL lighting must be a boolean');
  const gl = canvas.getContext('webgl', { alpha: true, depth: true, antialias: false });
  if (!gl) throw new TypeError('canvas must provide a WebGL rendering context');

  let renderer: ReturnType<typeof createMarkerRenderer> | undefined;
  let controller: Controller | undefined;
  let disposed = false;
  let lost = gl.isContextLost();
  let stopDimensions = (): void => undefined;

  const measureViewport = () => {
    const rect = canvas.getBoundingClientRect();
    return canvas.width > 0 && canvas.height > 0
      ? { width: rect.width, height: rect.height }
      : { width: 0, height: 0 };
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    clearHistory();
    stopDimensions();
    renderer?.dispose();
    renderer = undefined;
  };

  try {
    if (!lost) renderer = createMarkerRenderer(gl);
    controller = createController({
      target: canvas,
      source: motion,
      measureViewport,
      framing,
      autoplay: options.autoplay,
      offscreen: options.offscreen ?? true,
      platform: options.platform,
      onReset: clearHistory,
      onDispose: cleanup,
      observeAvailability(notify) {
        const onLost = (event: Event): void => {
          event.preventDefault();
          lost = true;
          // Lost-context resources are invalidated by the browser; drop all handles.
          renderer = undefined;
          markerRendererNeedsRestore = true;
          notify(false);
        };
        const onRestored = (): void => {
          if (disposed) return;
          try {
            renderer = createMarkerRenderer(gl);
            lost = false;
            markerRendererNeedsRestore = true;
            notify(true);
          } catch (error) {
            controller?.dispose();
            throw error;
          }
        };
        canvas.addEventListener('webglcontextlost', onLost);
        canvas.addEventListener('webglcontextrestored', onRestored);
        // Bitmap attribute changes need invalidation even when CSS size is fixed
        // and the animation is paused (ResizeObserver alone does not cover them).
        const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
          if (disposed) return;
          if (!lost) {
            try { notify(true); }
            catch (error) { controller?.dispose(); throw error; }
          }
        });
        observer?.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
        stopDimensions = () => observer?.disconnect();
        if (lost) notify(false);
        return () => {
          canvas.removeEventListener('webglcontextlost', onLost);
          canvas.removeEventListener('webglcontextrestored', onRestored);
          stopDimensions();
        };
      },
      render(frame) {
        if (lost || !renderer) return;
        const pose = options.position ? { ...frame.pose, ...options.position(frame) } : frame.pose;
        const planarDepth = camera ? 0.5 : typeof options.visibilityDepth === 'function'
          ? options.visibilityDepth(frame)
          : options.visibilityDepth ?? 0.5;
        const project = (point: Pose): WebGLProjectedPose => camera
          ? projectOrthographic(point, frame.viewport, camera, framing)
          : { ...frame.project(point), visibilityDepth: planarDepth };
        const position = project(pose);
        const webglFrame: WebGLFrame<State> = { ...frame, pose, position, project };
        const resized = renderer.resize(canvas.width, canvas.height);
        const scaleX = Math.abs(position.scaleX);
        const scaleY = Math.abs(position.scaleY);
        renderer.setLighting(lighting, [
          scaleX > 0 ? frame.viewport.width / canvas.width / scaleX : 1,
          scaleY > 0 ? frame.viewport.height / canvas.height / scaleY : 1,
          camera ? (camera.far ?? 100) - (camera.near ?? 0.1) : 1,
        ]);
        const marker = typeof options.marker === 'function' ? options.marker(webglFrame) : options.marker ?? {};
        currentBrush = paint !== undefined && marker !== null;
        const retainedMarker: WebGLMarker | undefined = markers && marker !== null && !currentBrush ? {
          pose: { ...pose }, visibilityDepth: planarDepth,
          options: { radius: marker.radius ?? 5, shape: marker.shape ?? 'circle', color: [...(marker.color ?? [1, 0, 0])] as [number, number, number] },
        } : undefined;
        const sameMarkerTime = frame.elapsedSeconds === previousMarkerTime;
        const markerChanged = retainedMarker !== undefined && (!sameMarkerTime || !previousMarker
          || retainedMarker.pose.x !== previousMarker.pose.x || retainedMarker.pose.y !== previousMarker.pose.y
          || (retainedMarker.pose.z ?? 0) !== (previousMarker.pose.z ?? 0)
          || (retainedMarker.pose.depth ?? 1) !== (previousMarker.pose.depth ?? 1)
          || retainedMarker.visibilityDepth !== previousMarker.visibilityDepth
          || retainedMarker.options.radius !== previousMarker.options.radius || retainedMarker.options.shape !== previousMarker.options.shape
          || retainedMarker.options.color!.length !== previousMarker.options.color!.length
          || retainedMarker.options.color!.some((channel, index) => channel !== previousMarker!.options.color![index]));
        const replacingMarker = markerChanged && sameMarkerTime;
        if (!resized) renderer.clear();
        if (markers && retainedMarker && markerChanged) {
          if (![pose.x, pose.y, pose.z ?? 0, planarDepth].every(Number.isFinite)) {
            throw new RangeError('WebGL accumulated coordinates and visibility depth must be finite');
          }
          markers.add(retainedMarker, frame.elapsedSeconds);
          previousMarkerTime = frame.elapsedSeconds;
          previousMarker = retainedMarker;
        }
        if (markers) {
          if (markerRendererNeedsRestore) {
            renderer.setMarkers(markers.values(), accumulationLimit);
            markerRendererNeedsRestore = false;
          } else if (retainedMarker && markerChanged) renderer.addMarker(retainedMarker, accumulationLimit, replacingMarker);
        }
        if (trail && history) {
          if (![pose.x, pose.y, pose.z ?? 0, planarDepth].every(Number.isFinite)) {
            throw new RangeError('WebGL trail coordinates and visibility depth must be finite');
          }
          history.add({ pose: { ...pose }, visibilityDepth: planarDepth }, frame.elapsedSeconds);
          const positions = history.values().map((retained) => {
            const projected = project(retained.pose);
            return camera ? projected : { ...projected, visibilityDepth: retained.visibilityDepth };
          });
          renderer.drawTrail(positions, frame.viewport, { width: trail.width, color: trail.color ?? marker?.color });
        }
        if (ribbon && currentBrush && marker !== null) {
          const radius = (marker.radius ?? 5) * (pose.depth ?? 1);
          if (!Number.isFinite(radius) || radius < 0 || (marker.radius ?? 5) < 0 || (pose.depth ?? 1) < 0) {
            throw new RangeError('WebGL brush radius and depth must be finite and non-negative');
          }
          // Calibrate the brush in its starting view once per stroke. Keep
          // this basis for future samples so camera motion cannot twist paint.
          if (!brushBasis) {
            const origin = project({ x: 0, y: 0, z: 0 });
            const axes = [project({ x: 1, y: 0, z: 0 }), project({ x: 0, y: 1, z: 0 }), project({ x: 0, y: 0, z: 1 })];
            const x = axes.map((axis) => axis.x - origin.x);
            const y = axes.map((axis) => axis.y - origin.y);
            const xx = x.reduce((sum, value) => sum + value * value, 0);
            const yy = y.reduce((sum, value) => sum + value * value, 0);
            const xy = x.reduce((sum, value, index) => sum + value * y[index], 0);
            const determinant = xx * yy - xy * xy;
            if (Number.isFinite(determinant) && determinant > 0) brushBasis = { x, y, xx, yy, xy, determinant };
          }
          const delta = previousBrushPose ? [pose.x - previousBrushPose.x, pose.y - previousBrushPose.y, (pose.z ?? 0) - (previousBrushPose.z ?? 0)] : [0, 0, 0];
          const dx = brushBasis?.x.reduce((sum, value, index) => sum + value * delta[index], 0) ?? 0;
          const dy = brushBasis?.y.reduce((sum, value, index) => sum + value * delta[index], 0) ?? 0;
          const length = Math.hypot(dx, dy);
          const nx = length > 0 ? -dy / length : 0;
          const ny = length > 0 ? dx / length : 1;
          if (brushBasis && radius > 0) {
            const { x, y, xx, yy, xy, determinant } = brushBasis;
            const a = (yy * nx - xy * ny) / determinant;
            const b = (xx * ny - xy * nx) / determinant;
            const side = { x: x[0] * a + y[0] * b, y: x[1] * a + y[1] * b, z: x[2] * a + y[2] * b };
            const worldPerPixel = Math.hypot(side.x, side.y, side.z);
            const wasFull = ribbon.full;
            const footprint = marker.shape === 'square' ? Math.abs(nx) + Math.abs(ny) : 1;
            const axisX = x.map((value, index) => radius * (value * yy - y[index] * xy) / determinant);
            const axisY = y.map((value, index) => radius * (value * xx - x[index] * xy) / determinant);
            ribbon.add(pose, frame.elapsedSeconds, 2 * radius * worldPerPixel * footprint, side, marker.color ?? [1, 0, 0], {
              shape: marker.shape ?? 'circle',
              axisX: { x: axisX[0], y: axisX[1], z: axisX[2] },
              axisY: { x: axisY[0], y: axisY[1], z: axisY[2] },
            });
            previousBrushPose = { ...pose };
            if (ribbon.full) {
              controller?.pause();
              if (!wasFull) options.onPaintLimit?.();
            }
          } else {
            // Contain padding can collapse a tiny viewport to zero drawable
            // scale. Lift the brush instead of inverting a singular mapping.
            ribbon.breakStroke();
            previousBrushPose = undefined;
            brushBasis = undefined;
          }
        } else {
          ribbon?.breakStroke();
          previousBrushPose = undefined;
          brushBasis = undefined;
        }
        if (ribbon && ribbon.footprints.count > 0) {
          writeProjectionMatrix(project, frame.viewport, markerProjection);
          renderer.drawPaintFootprints(ribbon.footprints, frame.viewport, markerProjection);
        }
        if (markers) {
          if (markers.size === 1 && previousMarker) {
            const retained = previousMarker;
            const projected = project(retained.pose);
            renderer.draw(projected, camera ? projected.visibilityDepth : retained.visibilityDepth, frame.viewport, retained.options);
          } else if (markers.size > 1) {
            const projectVertex = (point: Pose) => camera ? project(point) : { ...frame.project(point), visibilityDepth: point.z ?? 0 };
            writeProjectionMatrix(projectVertex, frame.viewport, markerProjection);
            renderer.drawMarkers(frame.viewport, markerProjection, !camera);
          }
        } else if (marker !== null && !paint) renderer.draw(position, position.visibilityDepth, frame.viewport, marker);
        renderer.present();
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  const runtime = controller;
  if (currentBrush && ribbon?.full) runtime.pause();
  return {
    ...runtime,
    isPaintFull: () => ribbon?.full ?? false,
    resume() { if (!currentBrush || !ribbon?.full) runtime.resume(); },
    setFraming(nextFraming) {
      if (disposed) return;
      const previous = framing;
      framing = nextFraming;
      try { runtime.setFraming(nextFraming); }
      catch (error) { framing = previous; throw error; }
    },
    setCamera(nextCamera) {
      if (disposed) return;
      const previous = camera;
      camera = snapshotCamera(nextCamera);
      try { runtime.setFraming(framing); }
      catch (error) { camera = previous; throw error; }
    },
    setLighting(enabled) {
      if (disposed) return;
      if (typeof enabled !== 'boolean') throw new TypeError('WebGL lighting must be a boolean');
      const previous = lighting;
      lighting = enabled;
      try { runtime.setFraming(framing); }
      catch (error) { lighting = previous; throw error; }
    },
    clear() {
      if (disposed) return;
      clearHistory();
      if (lost || !renderer || canvas.width === 0 || canvas.height === 0) return;
      renderer.resize(canvas.width, canvas.height);
      renderer.clear();
      renderer.present();
    },
  };
};

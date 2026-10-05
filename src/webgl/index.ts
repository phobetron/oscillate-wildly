import { projectOrthographic, validateOrthographicCamera } from '../core';
import type { Framing, MotionSource, OrthographicCamera, Point3D, Pose, ProjectedPose } from '../core';
import { createController } from '../runtime';
import type { Controller, Frame, RuntimePlatform } from '../runtime';
import { createMarkerRenderer } from './renderer';
import type { WebGLMarkerOptions } from './renderer';

export type { WebGLColor, WebGLMarkerOptions } from './renderer';

export interface WebGLProjectedPose extends ProjectedPose {
  /** Near = 0, far = 1. Positions outside this interval are clipped. */
  readonly visibilityDepth: number;
}

export interface WebGLFrame<State> extends Frame<State> {
  readonly position: WebGLProjectedPose;
  project(pose: Pose): WebGLProjectedPose;
}

export interface AnimateWebGLOptions<State> {
  readonly framing?: Framing;
  readonly autoplay?: boolean;
  /** Defaults to true, as with the Canvas adapter. */
  readonly offscreen?: boolean;
  /** Retain color and hardware depth between frames. Defaults to false. */
  readonly accumulate?: boolean;
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
  /** Clear color and depth immediately, without resetting or redrawing the motion. */
  clear(): void;
  /** Reproject the current marker and clear accumulation, preserving motion and pause. undefined returns to planar mode. */
  setCamera(camera: OrthographicCamera | undefined): void;
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

/**
 * Draw opaque camera-facing markers using WebGL 1 and the shared controller.
 * Owns the canvas's GL context, never its CSS or bitmap dimensions. A persistent
 * framebuffer keeps accumulation independent of browser drawing-buffer clears.
 */
export const animateWebGL = <State>(
  canvas: HTMLCanvasElement,
  motion: MotionSource<State>,
  options: AnimateWebGLOptions<State> = {},
): WebGLController => {
  let camera = snapshotCamera(options.camera);
  let framing = options.framing ?? {};
  const gl = canvas.getContext('webgl', { alpha: true, depth: true, antialias: false });
  if (!gl) throw new TypeError('canvas must provide a WebGL rendering context');

  let renderer: ReturnType<typeof createMarkerRenderer> | undefined;
  let controller: Controller | undefined;
  let disposed = false;
  let lost = gl.isContextLost();
  let invalidated = true;
  let viewKey: string | undefined;
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
      onReset: () => { invalidated = true; },
      onDispose: cleanup,
      observeAvailability(notify) {
        const onLost = (event: Event): void => {
          event.preventDefault();
          lost = true;
          // Lost-context resources are invalidated by the browser; drop all handles.
          renderer = undefined;
          invalidated = true;
          notify(false);
        };
        const onRestored = (): void => {
          if (disposed) return;
          try {
            renderer = createMarkerRenderer(gl);
            lost = false;
            invalidated = true;
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
          invalidated = true;
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
        const origin = project({ x: 0, y: 0, z: 0 });
        const diagonal = project({ x: 1, y: 1, z: 0 });
        const key = JSON.stringify([
          canvas.width, canvas.height, frame.viewport.width, frame.viewport.height,
          origin.x, origin.y, diagonal.x, diagonal.y,
        ]);
        const resized = renderer.resize(canvas.width, canvas.height);
        if (!options.accumulate || invalidated || key !== viewKey) {
          if (!resized) renderer.clear();
        }
        viewKey = key;
        invalidated = false;
        const marker = typeof options.marker === 'function' ? options.marker(webglFrame) : options.marker ?? {};
        if (marker !== null) renderer.draw(position, position.visibilityDepth, frame.viewport, marker);
        renderer.present();
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  const runtime = controller;
  return {
    ...runtime,
    setFraming(nextFraming) {
      if (disposed) return;
      const previous = framing;
      framing = nextFraming;
      invalidated = true;
      try { runtime.setFraming(nextFraming); }
      catch (error) { framing = previous; invalidated = true; throw error; }
    },
    setCamera(nextCamera) {
      if (disposed) return;
      const previous = camera;
      camera = snapshotCamera(nextCamera);
      invalidated = true;
      try { runtime.setFraming(framing); }
      catch (error) { camera = previous; invalidated = true; throw error; }
    },
    clear() {
      if (disposed) return;
      invalidated = true;
      if (lost || !renderer || canvas.width === 0 || canvas.height === 0) return;
      renderer.resize(canvas.width, canvas.height);
      renderer.clear();
      renderer.present();
    },
  };
};

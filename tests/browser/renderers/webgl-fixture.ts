import type { MotionSource, Pose, Point3D } from '../../../src/core';
import type { RuntimePlatform } from '../../../src/runtime';
import type { AnimateWebGLOptions, WebGLMarkerOptions, WebGLController } from '../../../src/webgl';

export type FixtureSample = {
  pose?: Partial<Pose>;
  marker?: WebGLMarkerOptions;
  skip?: boolean;
  visibilityDepth?: number;
  point?: Point3D;
};
type FixtureObservers = {
  resize?: () => void;
  intersection?: (value: boolean) => void;
  visibility?: (value: boolean) => void;
  reduced?: (value: boolean) => void;
};

export interface BrowserFixture {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  controller: WebGLController;
  observers: FixtureObservers;
  readonly resets: number;
  readonly sampledTime: number;
  readonly scheduled: number;
  step(milliseconds?: number): void;
  advance(nextIndex: number): void;
  pixel(x: number, y: number, expected: readonly number[], label: string): void;
  rgba(x: number, y: number): number[];
  dispose(): void;
}
export type FixtureOptions = AnimateWebGLOptions<FixtureSample> & {
  withoutDerivatives?: boolean;
};
interface WebGLHarness {
  fixture(samples: FixtureSample[], options?: FixtureOptions, motion?: MotionSource<FixtureSample>): BrowserFixture;
  lose(target: BrowserFixture): Promise<() => Promise<void>>;
  check(condition: unknown, message: string): void;
  createHelixMotion: typeof import('../../../src/motions/helix')['createHelixMotion'];
  disposeAll(): void;
}
declare global {
  interface Window {
    webglHarness: WebGLHarness;
  }
}
/** Install a real GPU fixture with a deterministic runtime clock in the current document. */
export async function installWebGLHarness(): Promise<void> {
  const { animateWebGL } = await import('/lib/webgl/index.js' as string) as typeof import('../../../src/webgl/index.ts');
  const { createHelixMotion } = await import('/lib/motions/helix.js' as string) as typeof import('../../../src/motions/helix.ts');
  const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  const check = (condition: unknown, message: string): void => {
    if (!condition)
      throw new Error(message);
  };
  const fixtures: BrowserFixture[] = [];
  const fixture = (samples: FixtureSample[], options: FixtureOptions = {}, motion?: MotionSource<FixtureSample>): BrowserFixture => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    canvas.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:100px';
    document.body.append(canvas);
    let index = 0;
    let time = 0;
    let resets = 0;
    let sampledTime = 0;
    let nextHandle = 0;
    const pending = new Map<unknown, (timestamp: number) => void>();
    const observers: FixtureObservers = {};
    const platform: RuntimePlatform = {
      requestAnimationFrame(callback) { const handle = ++nextHandle; pending.set(handle, callback); return handle; },
      cancelAnimationFrame(handle) { pending.delete(handle); },
      isDocumentVisible: () => true,
      prefersReducedMotion: () => false,
      observeResize(_target, callback) { observers.resize = callback; return () => { delete observers.resize; }; },
      observeIntersection(_target, callback) { observers.intersection = callback; return () => { delete observers.intersection; }; },
      observeVisibility(callback) { observers.visibility = callback; return () => { delete observers.visibility; }; },
      observeReducedMotion(callback) { observers.reduced = callback; return () => { delete observers.reduced; }; },
    };
    const source: MotionSource<FixtureSample> = motion ?? {
      kind: 'analytic' as const, bounds, periodSeconds: 1,
      sample(elapsedSeconds) {
        sampledTime = elapsedSeconds;
        const sample = samples[index];
        return { state: sample, pose: { x: 0, y: 0, ...sample.pose } };
      },
      reset() { resets += 1; index = 0; },
    };
    if (options.withoutDerivatives) {
      const context = canvas.getContext('webgl', { alpha: true, depth: true, antialias: false })!;
      const getExtension = context.getExtension.bind(context);
      context.getExtension = (name) => name === 'OES_standard_derivatives' ? null : getExtension(name);
    }
    const controller = animateWebGL(canvas, source, {
      autoplay: false, offscreen: false, accumulate: true,
      framing: { fit: 'stretch', padding: 0 }, platform,
      visibilityDepth: ({ state }) => state.visibilityDepth ?? 0.5,
      ...options,
      marker(current) {
        return current.state.skip ? null : { radius: 10, color: [1, 0, 0] as const, ...current.state.marker };
      },
    });
    const gl = canvas.getContext('webgl')!;
    check(gl !== null, 'Chromium did not provide the WebGL context');
    const step = (milliseconds = 16) => {
      time += milliseconds;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(time));
    };
    // Read in CSS coordinates; the library owns projection onto the backing bitmap.
    const rgba = (x: number, y: number): number[] => {
      const pixel = new Uint8Array(4);
      const rect = canvas.getBoundingClientRect();
      gl.readPixels(
        Math.floor(x * canvas.width / rect.width),
        canvas.height - 1 - Math.floor(y * canvas.height / rect.height),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel,
      );
      check(gl.getError() === gl.NO_ERROR, `WebGL error reading CSS pixel (${x}, ${y})`);
      return [...pixel];
    };
    let disposed = false;
    const result = {
      canvas, gl, controller, observers,
      get resets() { return resets; },
      get sampledTime() { return sampledTime; },
      get scheduled() { return pending.size; },
      step,
      advance(nextIndex: number) {
        index = nextIndex;
        controller.resume();
        step(); // Establish the timestamp after resume.
        step();
        controller.pause();
      },
      pixel(x: number, y: number, expected: readonly number[], label: string) {
        const actual = rgba(x, y);
        check(actual.every((value, channel) => Math.abs(value - expected[channel]) <= 1),
          `${label}: expected ${expected}, got ${actual}`);
      },
      rgba,
      dispose() {
        if (disposed) return;
        disposed = true;
        controller.dispose();
        canvas.remove();
      },
    };
    fixtures.push(result);
    return result;
  };
  const event = (canvas: HTMLCanvasElement, name: string) => new Promise<void>((resolveEvent, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
    canvas.addEventListener(name, () => { clearTimeout(timeout); resolveEvent(); }, { once: true });
  });
  const lose = async (target: BrowserFixture) => {
    const extension = target.gl.getExtension('WEBGL_lose_context')!;
    check(extension !== null, 'Chromium did not expose WEBGL_lose_context');
    const lost = event(target.canvas, 'webglcontextlost');
    extension.loseContext();
    await lost;
    check(target.controller.isPaused() && target.scheduled === 0, 'Context loss did not suspend scheduling');
    return async () => {
      // Chromium requires a delay between losing and restoring a real context.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      const restored = event(target.canvas, 'webglcontextrestored');
      extension.restoreContext();
      await restored;
    };
  };
  window.webglHarness = {
    fixture, lose, check, createHelixMotion,
    disposeAll() { fixtures.forEach((target) => target.dispose()); },
  };
}

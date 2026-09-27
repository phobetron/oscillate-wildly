import { describe, expect, it } from '@rstest/core';
import { createController, type Frame, type RuntimePlatform } from '../../src/runtime';
import type { AnalyticMotionSource, MotionSample, Pose, StatefulMotionSource, Viewport } from '../../src/core';

class FakePlatform implements RuntimePlatform {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, (timestamp: number) => void>();
  private visibilityListener: ((visible: boolean) => void) | undefined;
  private reducedMotionListener: ((reduced: boolean) => void) | undefined;
  readonly resizeCallbacks = new Map<object, () => void>();
  readonly intersectionCallbacks = new Map<object, (visible: boolean) => void>();
  visible = true;
  reduced = false;
  requests = 0;

  requestAnimationFrame(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    this.requests += 1;
    return handle;
  }

  cancelAnimationFrame(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  isDocumentVisible = (): boolean => this.visible;
  prefersReducedMotion = (): boolean => this.reduced;
  observeVisibility = (callback: (visible: boolean) => void): (() => void) => {
    this.visibilityListener = callback;
    return () => { this.visibilityListener = undefined; };
  };
  observeResize = (target: object, callback: () => void): (() => void) => {
    this.resizeCallbacks.set(target, callback);
    return () => { this.resizeCallbacks.delete(target); };
  };
  observeIntersection = (target: object, callback: (visible: boolean) => void): (() => void) => {
    this.intersectionCallbacks.set(target, callback);
    return () => { this.intersectionCallbacks.delete(target); };
  };
  observeReducedMotion = (callback: (reduced: boolean) => void): (() => void) => {
    this.reducedMotionListener = callback;
    return () => { this.reducedMotionListener = undefined; };
  };

  fire(timestamp: number): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(timestamp));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.visibilityListener?.(visible);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.reducedMotionListener?.(reduced);
  }
}

const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };

const analytic = (): AnalyticMotionSource<number> => ({
  kind: 'analytic',
  bounds,
  periodSeconds: 1,
  sample: (elapsedSeconds): MotionSample<number> => ({ state: elapsedSeconds, pose: { x: elapsedSeconds, y: elapsedSeconds * 2 } }),
  reset: () => undefined,
});

const viewport = (): Viewport => ({ width: 200, height: 100 });

describe('createController', () => {
  it('keeps visual-time progress comparable at 60, 120, and 144 Hz', () => {
    const results = [60, 120, 144].map((refreshRate) => {
      const platform = new FakePlatform();
      let state = 0;
      let analyticTime = 0;
      let statefulPosition = 0;
      const source: StatefulMotionSource<number> = {
        kind: 'stateful',
        bounds,
        step: (seconds) => { state += seconds; },
        snapshot: () => ({ state, pose: { x: state, y: 0 } }),
        reset: () => { state = 0; },
      };
      const analyticController = createController({
        target: {}, source: analytic(), measureViewport: viewport,
        render: (frame) => { analyticTime = frame.elapsedSeconds; }, platform,
      });
      const statefulController = createController({
        target: {}, source, measureViewport: viewport,
        render: (frame) => { statefulPosition = frame.pose.x; }, platform,
      });
      for (let frame = 0; frame <= refreshRate; frame += 1) {
        platform.fire(frame * 1000 / refreshRate);
      }
      analyticController.dispose();
      statefulController.dispose();
      return { analyticTime, statefulPosition };
    });

    for (const result of results) expect(result.analyticTime).toBeCloseTo(1, 6);
    const positions = results.map((result) => result.statefulPosition);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1 / 120);
  });

  it('updates framing without restarting the motion', () => {
    const platform = new FakePlatform();
    const frames: Frame<number>[] = [];
    const controller = createController({
      target: {}, source: analytic(), measureViewport: viewport,
      render: (frame) => frames.push(frame), platform,
    });
    platform.fire(0);
    platform.fire(100);
    const elapsed = frames.at(-1)?.elapsedSeconds;
    const oldX = frames.at(-1)?.position.x;
    controller.setFraming({ fit: 'contain', offsetX: 0.25 });
    expect(frames.at(-1)?.elapsedSeconds).toBe(elapsed);
    expect(frames.at(-1)?.position.x).not.toBe(oldX);
    controller.dispose();
  });


  it('renders an initial still frame, shares one RAF callback, and advances analytic elapsed time', () => {
    const platform = new FakePlatform();
    const first: Frame<number>[] = [];
    const second: Frame<number>[] = [];
    const firstController = createController({ target: {}, source: analytic(), measureViewport: viewport, render: (frame) => first.push(frame), platform });
    const secondController = createController({ target: {}, source: analytic(), measureViewport: viewport, render: (frame) => second.push(frame), platform });

    expect(first).toHaveLength(1);
    expect(first[0].elapsedSeconds).toBe(0);
    expect(first[0].position).toEqual(first[0].project(first[0].pose));
    expect(platform.requests).toBe(1);

    platform.fire(0);
    platform.fire(250);
    expect(first.at(-1)?.elapsedSeconds).toBe(0.05);
    expect(second.at(-1)?.pose).toMatchObject({ x: 0.05, y: 0.1 });

    firstController.dispose();
    secondController.dispose();
  });

  it('uses bounded fixed stateful steps and interpolates between snapshots', () => {
    const platform = new FakePlatform();
    let state = 0;
    const steps: number[] = [];
    const source: StatefulMotionSource<number> = {
      kind: 'stateful',
      bounds,
      step: (seconds) => { steps.push(seconds); state += 1; },
      snapshot: () => ({ state, pose: { x: state, y: 0 } }),
      reset: () => { state = 0; },
    };
    const frames: Frame<number>[] = [];
    const controller = createController({ target: {}, source, measureViewport: viewport, render: (frame) => frames.push(frame), platform });

    platform.fire(0);
    platform.fire(10);
    expect(steps).toHaveLength(1);
    expect(frames.at(-1)?.pose.x).toBeCloseTo(0.2, 8);

    platform.fire(1010);
    expect(steps).toHaveLength(7);
    expect(steps.every((seconds) => seconds === 1 / 120)).toBe(true);
    controller.dispose();
  });

  it('freezes elapsed time while hidden and resumes without catch-up', () => {
    const platform = new FakePlatform();
    const frames: Frame<number>[] = [];
    const controller = createController({ target: {}, source: analytic(), measureViewport: viewport, render: (frame) => frames.push(frame), platform });

    platform.fire(0);
    platform.fire(100);
    platform.setVisible(false);
    platform.fire(10_000);
    platform.setVisible(true);
    platform.fire(20_000);
    platform.fire(20_100);

    expect(frames.at(-1)?.elapsedSeconds).toBeCloseTo(0.1, 8);
    controller.dispose();
  });

  it('caps analytic elapsed time after a visible stall and responds to reduced-motion changes', () => {
    const platform = new FakePlatform();
    const frames: Frame<number>[] = [];
    const controller = createController({ target: {}, source: analytic(), measureViewport: viewport, render: (frame) => frames.push(frame), platform });

    platform.fire(0);
    platform.fire(1_000);
    expect(frames.at(-1)?.elapsedSeconds).toBe(0.05);
    platform.setReducedMotion(true);
    expect(controller.isPaused()).toBe(true);
    platform.fire(2_000);
    expect(frames.at(-1)?.elapsedSeconds).toBe(0.05);
    platform.setReducedMotion(false);
    platform.fire(3_000);
    platform.fire(3_010);
    expect(frames.at(-1)?.elapsedSeconds).toBeCloseTo(0.06, 8);
    controller.dispose();
  });

  it('stops on zero-sized viewports, resumes from its resize target, and keeps lifecycle operations idempotent', () => {
    const platform = new FakePlatform();
    const target = {};
    const resizeTarget = {};
    let size = 0;
    let resets = 0;
    let disposals = 0;
    const frames: Frame<number>[] = [];
    const controller = createController({
      target,
      resizeTarget,
      source: analytic(),
      measureViewport: () => ({ width: size, height: size }),
      render: (frame) => frames.push(frame),
      platform,
      onReset: () => { resets += 1; },
      onDispose: () => { disposals += 1; },
    });

    expect(frames).toHaveLength(0);
    expect(platform.requests).toBe(0);
    size = 100;
    platform.resizeCallbacks.get(resizeTarget)?.();
    expect(frames).toHaveLength(1);
    expect(platform.requests).toBe(1);
    controller.reset();
    controller.reset();
    controller.pause();
    controller.pause();
    controller.resume();
    controller.resume();
    controller.dispose();
    controller.dispose();
    expect(resets).toBe(2);
    expect(disposals).toBe(1);
    expect(() => createController({ target, source: analytic(), measureViewport: viewport, render: () => undefined, platform })).not.toThrow();
  });

  it('honors reduced motion and rejects duplicate targets until disposal', () => {
    const platform = new FakePlatform();
    platform.reduced = true;
    const target = {};
    const frames: Frame<number>[] = [];
    const controller = createController({ target, source: analytic(), measureViewport: viewport, render: (frame) => frames.push(frame), platform });
    expect(frames).toHaveLength(1);
    expect(platform.requests).toBe(0);
    expect(() => createController({ target, source: analytic(), measureViewport: viewport, render: () => undefined, platform })).toThrow(/already owns/);
    controller.dispose();
  });

  it('rejects concurrent controllers for one stateful source and releases it on disposal', () => {
    const platform = new FakePlatform();
    let state = 0;
    const source: StatefulMotionSource<number> = {
      kind: 'stateful', bounds,
      step: () => { state += 1; },
      snapshot: () => ({ state, pose: { x: state, y: 0 } }),
      reset: () => { state = 0; },
    };
    const controller = createController({ target: {}, source, measureViewport: viewport, render: () => undefined, platform });
    expect(() => createController({ target: {}, source, measureViewport: viewport, render: () => undefined, platform })).toThrow(/stateful motion source/);
    controller.dispose();
    expect(() => createController({ target: {}, source, measureViewport: viewport, render: () => undefined, platform })).not.toThrow();
  });

  it('faults one throwing controller without freezing healthy controllers', () => {
    const platform = new FakePlatform();
    const healthyFrames: Frame<number>[] = [];
    const healthy = createController({ target: {}, source: analytic(), measureViewport: viewport, render: (frame) => healthyFrames.push(frame), platform });
    const faultyTarget = {};
    const faulty = createController({
      target: faultyTarget,
      source: analytic(),
      measureViewport: viewport,
      render: (frame) => {
        if (frame.elapsedSeconds > 0) throw new Error('render failed');
      },
      platform,
    });

    platform.fire(0);
    expect(() => platform.fire(10)).toThrow(/render failed/);
    expect(healthyFrames.at(-1)?.elapsedSeconds).toBeCloseTo(0.01, 8);
    expect(() => platform.fire(20)).not.toThrow();
    expect(healthyFrames.at(-1)?.elapsedSeconds).toBeCloseTo(0.02, 8);
    expect(() => createController({ target: faultyTarget, source: analytic(), measureViewport: viewport, render: () => undefined, platform })).not.toThrow();

    healthy.dispose();
    faulty.dispose();
  });

  it('releases reservations and observer hooks when setup fails', () => {
    const platform = new FakePlatform();
    const target = {};
    expect(() => createController({
      target,
      source: analytic(),
      measureViewport: viewport,
      render: () => { throw new Error('renderer failed'); },
      platform,
    })).toThrow(/renderer failed/);
    expect(platform.resizeCallbacks.has(target)).toBe(false);
    expect(() => createController({ target, source: analytic(), measureViewport: viewport, render: () => undefined, platform })).not.toThrow();

    const failingSource: AnalyticMotionSource<number> = { ...analytic(), sample: () => { throw new Error('sample failed'); } };
    expect(() => createController({ target: {}, source: failingSource, measureViewport: viewport, render: () => undefined, platform })).toThrow(/sample failed/);
  });
});

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
  it('does not interpolate across a path jump and resumes interpolation within the new path', () => {
    const platform = new FakePlatform();
    let step = 0;
    const source: StatefulMotionSource<number> = {
      kind: 'stateful', bounds,
      step: () => { step += 1; }, reset: () => { step = 0; },
      snapshot: () => ({ state: step, pathSegment: step === 0 ? 0 : 1,
        pose: { x: step === 0 ? 0 : 100 + 2 * (step - 1), y: 0 } }),
    };
    let frame!: Frame<number>;
    const controller = createController({
      target: {}, source, platform, measureViewport: viewport,
      render: (next) => { frame = next; },
    });
    expect(frame.pathSegment).toBe(0);
    platform.fire(0);
    platform.fire(10);
    expect(frame.pathSegment).toBe(1);
    expect(frame.pose.x).toBe(100);
    controller.pause();
    controller.setFraming({ zoom: 2 });
    expect(frame.pathSegment).toBe(1);
    expect(frame.pose.x).toBe(100);
    controller.resume();
    platform.fire(10);
    platform.fire(20);
    expect(frame.pose.x).toBeCloseTo(100.8, 12);
    controller.reset();
    expect(frame.pathSegment).toBe(0);
    expect(frame.pose.x).toBe(0);
    controller.dispose();
  });

  it('updates marker presentation without changing simulation time, state, or pause', () => {
    const platform = new FakePlatform();
    const source = {
      ...analytic(),
      sample: (elapsed: number) => ({ state: elapsed, pose: { x: elapsed, y: 2, z: 3, opacity: 0.5, depth: 0.875 } }),
    };
    let frame!: Frame<number>;
    const controller = createController({
      target: {}, source, platform, measureViewport: viewport,
      render: (next) => { frame = next; },
    });
    platform.fire(0);
    platform.fire(50);
    const before = frame;
    const requests = platform.requests;
    controller.setMarkerScale({ depthStrength: 2 });
    expect(frame.elapsedSeconds).toBe(before.elapsedSeconds);
    expect(frame.state).toBe(before.state);
    expect(frame.pose).toEqual({ ...before.pose, depth: 0.75 });
    expect(frame.position).toEqual(frame.project(frame.pose));
    expect(frame.project(source.sample(0).pose).depth).toBe(0.875);
    expect(controller.isPaused()).toBe(false);
    expect(platform.requests).toBe(requests);
    controller.pause();
    controller.setMarkerScale({ depthStrength: 0 });
    expect(frame.pose.depth).toBe(1);
    expect(frame.elapsedSeconds).toBe(before.elapsedSeconds);
    expect(controller.isPaused()).toBe(true);
    expect(source.sample(0).pose.depth).toBe(0.875);
    controller.reset();
    expect(frame.elapsedSeconds).toBe(0);
    expect(frame.pose.depth).toBe(1);
    controller.dispose();
  });

  it('applies scale clamps after stateful pose interpolation', () => {
    const platform = new FakePlatform();
    let depth = 0;
    const source: StatefulMotionSource<number> = {
      kind: 'stateful', bounds,
      step: () => { depth += 0.4; },
      reset: () => { depth = 0; },
      snapshot: () => ({ state: depth, pose: { x: 0, y: 0, depth } }),
    };
    let frame!: Frame<number>;
    const controller = createController({
      target: {}, source, platform, measureViewport: viewport,
      markerScale: { minMarkerScale: 0.25, maxMarkerScale: 1 },
      render: (next) => { frame = next; },
    });
    platform.fire(0);
    platform.fire(10);
    expect(frame.state).toBe(0.4);
    expect(frame.pose.depth).toBe(0.25);
    expect(source.snapshot().pose.depth).toBe(0.4);
    platform.fire(15);
    expect(frame.pose.depth).toBeCloseTo(0.32, 12);
    controller.dispose();
  });

  it('rejects invalid marker updates atomically and rolls back a failed redraw', () => {
    const platform = new FakePlatform();
    const target = {};
    let renders = 0;
    let fail = false;
    let depth: number | undefined;
    const controller = createController({
      target, source: analytic(), platform, measureViewport: viewport, autoplay: false,
      markerScale: { minMarkerScale: 1.5 },
      render: (frame) => {
        if (fail) throw new Error('consumer render failed');
        renders += 1;
        depth = frame.pose.depth;
      },
    });
    expect(depth).toBe(1.5);
    expect(() => controller.setMarkerScale({ minMarkerScale: 2, maxMarkerScale: 1 })).toThrow(/Minimum.*maximum/);
    expect(() => controller.setMarkerScale({ depthStrength: NaN })).toThrow(/finite/);
    expect(renders).toBe(1);
    fail = true;
    expect(() => controller.setMarkerScale({ depthStrength: 0 })).toThrow(/consumer render failed/);
    fail = false;
    controller.setFraming({});
    expect(depth).toBe(1.5);
    expect(controller.isPaused()).toBe(true);
    platform.resizeCallbacks.get(target)!();
    expect(depth).toBe(1.5);
    controller.dispose();
    controller.setMarkerScale({ depthStrength: NaN });
    expect(renders).toBe(3);
  });

  it('does not claim a target or source when initial scale settings are invalid', () => {
    const platform = new FakePlatform();
    const target = {};
    const options = { target, source: analytic(), platform, measureViewport: viewport, render: () => undefined };
    expect(() => createController({ ...options, markerScale: { maxMarkerScale: -1 } })).toThrow(/finite and nonnegative/);
    const controller = createController(options);
    controller.dispose();
  });

  it('keeps advancing across repeated renderer redraw notifications and reactivates zero-sized targets', () => {
    const platform = new FakePlatform();
    let available!: (available: boolean) => void;
    let size = 100;
    let elapsed = 0;
    const controller = createController({
      target: {}, source: analytic(), platform,
      measureViewport: () => ({ width: size, height: size }),
      observeAvailability: (notify) => { available = notify; return () => undefined; },
      render: (frame) => { elapsed = frame.elapsedSeconds; },
    });
    platform.fire(0);
    for (let index = 1; index <= 60; index++) {
      available(true);
      platform.fire(index * 16);
    }
    expect(elapsed).toBeCloseTo(0.96);
    size = 0;
    available(true);
    expect(controller.isPaused()).toBe(true);
    platform.fire(5000);
    size = 100;
    available(true);
    expect(controller.isPaused()).toBe(false);
    platform.fire(10000);
    expect(elapsed).toBeCloseTo(0.96);
    platform.fire(10016);
    expect(elapsed).toBeCloseTo(0.976);
    controller.dispose();
  });
  it('suspends availability independently and redraws restoration without advancing motion', () => {
    const platform = new FakePlatform();
    const frames: Frame<number>[] = [];
    let notify!: (available: boolean) => void;
    let releases = 0;
    const controller = createController({
      target: {}, source: analytic(), measureViewport: viewport, platform,
      render: (frame) => frames.push(frame),
      observeAvailability: (callback) => {
        notify = callback;
        return () => { releases += 1; };
      },
    });
    platform.fire(0);
    platform.fire(10);
    notify(false);
    expect(controller.isPaused()).toBe(true);
    const suspendedFrames = frames.length;
    platform.fire(1000);
    expect(frames).toHaveLength(suspendedFrames);
    notify(true);
    expect(controller.isPaused()).toBe(false);
    expect(frames).toHaveLength(suspendedFrames + 1);
    expect(frames.at(-1)?.elapsedSeconds).toBeCloseTo(0.01, 8);
    platform.fire(2000);
    expect(frames).toHaveLength(suspendedFrames + 1);
    platform.fire(2010);
    expect(frames.at(-1)?.elapsedSeconds).toBeCloseTo(0.02, 8);
    controller.dispose();
    controller.dispose();
    expect(releases).toBe(1);
    notify(true);
    expect(frames.at(-1)?.elapsedSeconds).toBeCloseTo(0.02, 8);
  });

  it('availability restoration preserves manual pause, visibility, intersection and reduced motion', () => {
    for (const gate of ['manual', 'visibility', 'intersection', 'reduced'] as const) {
      const platform = new FakePlatform();
      const target = {};
      let notify!: (available: boolean) => void;
      const controller = createController({
        target, source: analytic(), measureViewport: viewport, platform, offscreen: true,
        render: () => undefined,
        observeAvailability: (callback) => { notify = callback; return () => undefined; },
      });
      notify(false);
      if (gate === 'manual') controller.pause();
      if (gate === 'visibility') platform.setVisible(false);
      if (gate === 'intersection') platform.intersectionCallbacks.get(target)?.(false);
      if (gate === 'reduced') platform.setReducedMotion(true);
      const requests = platform.requests;
      notify(true);
      expect(controller.isPaused()).toBe(true);
      expect(platform.requests).toBe(requests);
      if (gate === 'manual') controller.resume();
      if (gate === 'visibility') platform.setVisible(true);
      if (gate === 'intersection') platform.intersectionCallbacks.get(target)?.(true);
      if (gate === 'reduced') platform.setReducedMotion(false);
      expect(controller.isPaused()).toBe(false);
      expect(platform.requests).toBe(requests + 1);
      controller.dispose();
    }
  });

  it('releases availability observation after failed setup', () => {
    const platform = new FakePlatform();
    let releases = 0;
    expect(() => createController({
      target: {}, source: analytic(), measureViewport: viewport, platform,
      render: () => { throw new Error('render failed'); },
      observeAvailability: () => () => { releases += 1; },
    })).toThrow(/render failed/);
    expect(releases).toBe(1);
  });

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
      snapshot: () => ({ state, pose: { x: state, y: 0, z: state * 3 } }),
      reset: () => { state = 0; },
    };
    const frames: Frame<number>[] = [];
    const controller = createController({ target: {}, source, measureViewport: viewport, render: (frame) => frames.push(frame), platform });

    platform.fire(0);
    platform.fire(10);
    expect(steps).toHaveLength(1);
    expect(frames.at(-1)?.pose.x).toBeCloseTo(0.2, 8);
    expect(frames.at(-1)?.pose.z).toBeCloseTo(0.6, 8);
    expect(frames.at(-1)?.position.z).toBeCloseTo(0.6, 8);

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

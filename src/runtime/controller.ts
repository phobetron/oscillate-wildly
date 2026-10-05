import { projectToCssPixels } from '../core/framing';
import type { Framing, MotionSample, MotionSource, Pose, ProjectedPose, Viewport } from '../core/types';
import { createBrowserPlatform, type RuntimePlatform } from './platform';

const STEP_SECONDS = 1 / 120;
const MAX_DELTA_SECONDS = 0.05;
const MAX_STEPS_PER_FRAME = 6;

export interface Frame<State> {
  readonly state: State;
  /** A world-space pose. Stateful sources are interpolated between fixed simulation steps. */
  readonly pose: Pose;
  /** The current pose projected into CSS pixels. */
  readonly position: ProjectedPose;
  readonly viewport: Viewport;
  readonly elapsedSeconds: number;
  /** Reprojects a world-space pose using this frame's viewport and framing. */
  project(pose: Pose): ProjectedPose;
}

export interface CreateControllerOptions<State> {
  /** Identity used to reject accidentally mounting two animations on one target. */
  readonly target: object;
  /** Element whose dimensions establish the renderer's viewport. Defaults to target. */
  readonly resizeTarget?: object;
  /** Element whose visibility controls offscreen work. Defaults to target. */
  readonly intersectionTarget?: object;
  readonly source: MotionSource<State>;
  readonly measureViewport: () => Viewport;
  readonly render: (frame: Frame<State>) => void;
  readonly framing?: Framing;
  readonly autoplay?: boolean;
  /** Pause while the target is outside the viewport. Adapters choose their own default. */
  readonly offscreen?: boolean;
  /** Injectable browser services, primarily for non-browser hosts and tests. */
  readonly platform?: RuntimePlatform;
  readonly onReset?: () => void;
  readonly onDispose?: () => void;
  /** Suspend scheduling while the renderer is unavailable, independently of user preferences. */
  readonly observeAvailability?: (callback: (available: boolean) => void) => () => void;
}

/** Short form retained for adapter-facing controller configuration. */
export type ControllerOptions<State> = CreateControllerOptions<State>;

export interface Controller {
  pause(): void;
  resume(): void;
  reset(): void;
  /** Reproject the current motion without resetting its elapsed time or state. */
  setFraming(framing: Framing): void;
  dispose(): void;
  isPaused(): boolean;
}

interface ActiveController {
  tick(timestamp: number): void;
  canRun(): boolean;
  fault(): void;
}

interface Scheduler {
  active: Set<ActiveController>;
  handle: unknown | undefined;
}

const targets = new WeakSet<object>();
const statefulSources = new WeakSet<object>();
const schedulers = new WeakMap<RuntimePlatform, Scheduler>();
let defaultPlatform: RuntimePlatform | undefined;

const platformFor = (provided?: RuntimePlatform): RuntimePlatform => {
  if (provided) return provided;
  defaultPlatform ??= createBrowserPlatform();
  return defaultPlatform;
};

const schedulerFor = (platform: RuntimePlatform): Scheduler => {
  let scheduler = schedulers.get(platform);
  if (!scheduler) {
    scheduler = { active: new Set(), handle: undefined };
    schedulers.set(platform, scheduler);
  }
  return scheduler;
};

const schedule = (platform: RuntimePlatform, scheduler: Scheduler): void => {
  if (scheduler.handle !== undefined || scheduler.active.size === 0) return;
  scheduler.handle = platform.requestAnimationFrame((timestamp) => {
    scheduler.handle = undefined;
    let firstError: unknown;
    let hasError = false;
    for (const controller of [...scheduler.active]) {
      if (!controller.canRun()) continue;
      try {
        controller.tick(timestamp);
      } catch (error) {
        // A custom renderer or motion source must not stall every other controller.
        try {
          controller.fault();
        } catch {
          // The triggering error is more useful than an error from best-effort teardown.
        }
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }
    if (scheduler.active.size > 0) schedule(platform, scheduler);
    if (hasError) throw firstError;
  });
};

const unscheduleIfIdle = (platform: RuntimePlatform, scheduler: Scheduler): void => {
  if (scheduler.active.size !== 0 || scheduler.handle === undefined) return;
  platform.cancelAnimationFrame(scheduler.handle);
  scheduler.handle = undefined;
};

const validViewport = (viewport: Viewport): boolean =>
  Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;

const interpolate = (from: Pose, to: Pose, amount: number): Pose => {
  const channel = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined || b === undefined ? (b ?? a) : a + (b - a) * amount;
  const depth = channel(from.depth, to.depth);
  const z = channel(from.z, to.z);
  const opacity = channel(from.opacity, to.opacity);
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    ...(z === undefined ? {} : { z }),
    ...(depth === undefined ? {} : { depth }),
    ...(opacity === undefined ? {} : { opacity }),
  };
};

/**
 * Drives a motion source and sends projected frames to a renderer adapter.
 * The browser RAF is shared by every running controller that uses a platform.
 */
export const createController = <State>(options: CreateControllerOptions<State>): Controller => {
  if (targets.has(options.target)) throw new Error('An animation controller already owns this target');
  if (options.source.kind === 'stateful' && statefulSources.has(options.source)) {
    throw new Error('A stateful motion source can only be used by one animation controller at a time');
  }

  const platform = platformFor(options.platform);
  const scheduler = schedulerFor(platform);
  const source = options.source;
  let framing = options.framing ?? {};
  const offscreen = options.offscreen ?? false;
  const resizeTarget = options.resizeTarget ?? options.target;
  const intersectionTarget = options.intersectionTarget ?? options.target;
  let disposed = false;
  let manuallyPaused = options.autoplay === false;
  let documentVisible = platform.isDocumentVisible?.() ?? true;
  let intersecting = true;
  let reducedMotion = platform.prefersReducedMotion?.() ?? false;
  let available = true;
  let hasViewport = false;
  let lastTimestamp: number | undefined;
  let elapsedSeconds = 0;
  let accumulator = 0;
  let current!: MotionSample<State>;
  let previous!: MotionSample<State>;
  let stopForVisibility = (): void => undefined;
  let stopForResize = (): void => undefined;
  let stopForIntersection = (): void => undefined;
  let stopForReducedMotion = (): void => undefined;
  let stopForAvailability = (): void => undefined;

  const running = (): boolean => !disposed && available && hasViewport && !manuallyPaused && documentVisible && (!offscreen || intersecting) && !reducedMotion;

  const frameFor = (sample: MotionSample<State>, pose: Pose, viewport: Viewport): Frame<State> => {
    const project = (worldPose: Pose): ProjectedPose => projectToCssPixels(worldPose, viewport, framing, source.bounds);
    return { state: sample.state, pose, position: project(pose), viewport, elapsedSeconds, project };
  };

  const render = (): boolean => {
    const viewport = options.measureViewport();
    hasViewport = validViewport(viewport);
    if (!hasViewport) return false;
    const pose = source.kind === 'stateful' ? interpolate(previous.pose, current.pose, accumulator / STEP_SECONDS) : current.pose;
    options.render(frameFor(current, pose, viewport));
    return true;
  };

  const addToScheduler = (): void => {
    if (!running()) return;
    scheduler.active.add(active);
    schedule(platform, scheduler);
  };

  const removeFromScheduler = (): void => {
    scheduler.active.delete(active);
    unscheduleIfIdle(platform, scheduler);
  };

  const release = (): void => {
    removeFromScheduler();
    stopForVisibility();
    stopForResize();
    stopForIntersection();
    stopForReducedMotion();
    stopForAvailability();
    targets.delete(options.target);
    if (source.kind === 'stateful') statefulSources.delete(source);
  };

  const disposeController = (): void => {
    if (disposed) return;
    disposed = true;
    release();
    options.onDispose?.();
  };

  const active: ActiveController = {
    canRun: running,
    fault: disposeController,
    tick(timestamp) {
      const viewport = options.measureViewport();
      if (!validViewport(viewport)) {
        hasViewport = false;
        lastTimestamp = timestamp;
        removeFromScheduler();
        return;
      }
      hasViewport = true;
      if (lastTimestamp === undefined) {
        lastTimestamp = timestamp;
        return;
      }
      const delta = Math.max(0, (timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;
      if (source.kind === 'analytic') {
        const capped = Math.min(delta, MAX_DELTA_SECONDS);
        elapsedSeconds += capped;
        current = source.sample(elapsedSeconds);
      } else {
        const capped = Math.min(delta, MAX_DELTA_SECONDS);
        accumulator += capped;
        let steps = 0;
        while (accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
          previous = current;
          source.step(STEP_SECONDS);
          current = source.snapshot();
          accumulator -= STEP_SECONDS;
          steps += 1;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = Math.min(accumulator, STEP_SECONDS);
        elapsedSeconds += capped;
      }
      const pose = source.kind === 'stateful' ? interpolate(previous.pose, current.pose, accumulator / STEP_SECONDS) : current.pose;
      const project = (worldPose: Pose): ProjectedPose => projectToCssPixels(worldPose, viewport, framing, source.bounds);
      options.render({ state: current.state, pose, position: project(pose), viewport, elapsedSeconds, project });
    },
  };

  const cleanupSetup = (): void => {
    release();
  };

  try {
    targets.add(options.target);
    if (source.kind === 'stateful') statefulSources.add(source);
    current = source.kind === 'stateful' ? source.snapshot() : source.sample(0);
    previous = current;
    stopForVisibility = platform.observeVisibility?.((visible) => {
      documentVisible = visible;
      lastTimestamp = undefined;
      if (visible) addToScheduler(); else removeFromScheduler();
    }) ?? (() => undefined);
    stopForResize = platform.observeResize?.(resizeTarget, () => {
      if (render()) addToScheduler(); else removeFromScheduler();
    }) ?? (() => undefined);
    stopForIntersection = offscreen
      ? (platform.observeIntersection?.(intersectionTarget, (visible) => {
        intersecting = visible;
        lastTimestamp = undefined;
        if (visible) addToScheduler(); else removeFromScheduler();
      }) ?? (() => undefined))
      : () => undefined;
    stopForReducedMotion = platform.observeReducedMotion?.((reduced) => {
      reducedMotion = reduced;
      lastTimestamp = undefined;
      if (reduced) removeFromScheduler(); else addToScheduler();
    }) ?? (() => undefined);
    stopForAvailability = options.observeAvailability?.((nextAvailable) => {
      if (disposed) return;
      // An available renderer may request another still-frame redraw (for
      // example a bitmap resize). Only a real suspension resets motion time.
      if (nextAvailable !== available || !hasViewport) lastTimestamp = undefined;
      available = nextAvailable;
      if (available) {
        if (render()) addToScheduler(); else removeFromScheduler();
      } else {
        removeFromScheduler();
      }
    }) ?? (() => undefined);

    // Every controller exposes a deterministic still frame before autoplay begins.
    render();
    addToScheduler();
  } catch (error) {
    cleanupSetup();
    throw error;
  }

  return {
    pause() {
      if (disposed || manuallyPaused) return;
      manuallyPaused = true;
      lastTimestamp = undefined;
      removeFromScheduler();
    },
    resume() {
      if (disposed || !manuallyPaused) return;
      manuallyPaused = false;
      lastTimestamp = undefined;
      addToScheduler();
    },
    reset() {
      if (disposed) return;
      source.reset();
      elapsedSeconds = 0;
      accumulator = 0;
      current = source.kind === 'stateful' ? source.snapshot() : source.sample(0);
      previous = current;
      lastTimestamp = undefined;
      options.onReset?.();
      render();
    },
    setFraming(nextFraming) {
      if (disposed) return;
      const previousFraming = framing;
      framing = nextFraming;
      try {
        render();
      } catch (error) {
        framing = previousFraming;
        throw error;
      }
    },
    dispose() {
      disposeController();
    },
    isPaused: () => !available || manuallyPaused || !hasViewport || !documentVisible || (offscreen && !intersecting) || reducedMotion,
  };
};

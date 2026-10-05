import type { Bounds, StatefulMotionSource } from '../core';
import { createStatefulMotion, type NumericalOptions } from './numerical';

export interface DuffingParams extends NumericalOptions {
  readonly damping?: number;
  readonly forcing?: number;
  readonly angularFrequency?: number;
  readonly initialX?: number;
  readonly initialY?: number;
}

export interface DuffingState {
  readonly timeSeconds: number;
  /** Unwrapped forcing angle at the current model time, in radians. */
  readonly forcingPhaseRadians: number;
  readonly x: number;
  readonly y: number;
}

export const createDuffingMotion = (params: DuffingParams = {}): StatefulMotionSource<DuffingState> => {
  const damping = params.damping ?? 0.25;
  const forcing = params.forcing ?? 0.3;
  const angularFrequency = params.angularFrequency ?? 1;
  const initialX = params.initialX ?? 0.2;
  const initialY = params.initialY ?? -0.3;
  if (![damping, forcing, angularFrequency, initialX, initialY].every(Number.isFinite)) throw new RangeError('Duffing parameters must be finite');
  // Fixed envelope sampled from the nominal seeded trajectory, with margin.
  const bounds: Bounds = { minX: -0.55, maxX: 0.55, minY: -0.35, maxY: 0.35 };
  return createStatefulMotion({
    bounds,
    initialState: [initialX, initialY] as const,
    derivative: ([x, y], timeSeconds) => [y, x - x ** 3 - damping * y + forcing * Math.cos(angularFrequency * timeSeconds)] as const,
    snapshot: ([x, y], timeSeconds) => {
      const forcingPhaseRadians = angularFrequency * timeSeconds;
      // Use forcing phase as a bounded marker-size cue in the planar pose.
      return { state: { timeSeconds, forcingPhaseRadians, x, y }, pose: { x: x / 3, y: y / 3, depth: 0.625 + 0.375 * Math.sin(forcingPhaseRadians) } };
    },
    timeScale: params.timeScale ?? 2.4,
    runawayLimit: params.runawayLimit,
  });
};

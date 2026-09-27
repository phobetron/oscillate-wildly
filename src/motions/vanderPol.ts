import type { Bounds, StatefulMotionSource } from '../core';
import { createStatefulMotion, type NumericalOptions } from './numerical';

export interface VanderPolParams extends NumericalOptions {
  readonly mu?: number;
  readonly initialX?: number;
  readonly initialY?: number;
}

export interface VanderPolState {
  readonly timeSeconds: number;
  readonly x: number;
  readonly y: number;
}

export const createVanderPolMotion = (params: VanderPolParams = {}): StatefulMotionSource<VanderPolState> => {
  const mu = params.mu ?? 1;
  const initialX = params.initialX ?? 1;
  const initialY = params.initialY ?? 1;
  if (!Number.isFinite(mu) || !Number.isFinite(initialX) || !Number.isFinite(initialY)) throw new RangeError('Van der Pol parameters must be finite');
  // Fixed envelope sampled from the nominal seeded trajectory, with margin.
  const bounds: Bounds = { minX: -0.75, maxX: 0.75, minY: -1, maxY: 1 };
  return createStatefulMotion({
    bounds,
    initialState: [initialX, initialY] as const,
    derivative: ([x, y]) => [y, -x - mu * (x * x - 1) * y] as const,
    snapshot: ([x, y], timeSeconds) => ({ state: { timeSeconds, x, y }, pose: { x: x / 3, y: y / 3 } }),
    timeScale: params.timeScale ?? 2.4,
    runawayLimit: params.runawayLimit,
  });
};

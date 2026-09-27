import type { Bounds, StatefulMotionSource } from '../core';
import { createStatefulMotion, type NumericalOptions } from './numerical';

export interface LorenzParams extends NumericalOptions {
  readonly sigma?: number;
  readonly rho?: number;
  readonly beta?: number;
  readonly initialX?: number;
  readonly initialY?: number;
  readonly initialZ?: number;
}

export interface LorenzState {
  readonly timeSeconds: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const createLorenzMotion = (params: LorenzParams = {}): StatefulMotionSource<LorenzState> => {
  const sigma = params.sigma ?? 10;
  const rho = params.rho ?? 28;
  const beta = params.beta ?? 8 / 3;
  const initialX = params.initialX ?? 18.89688574723792;
  const initialY = params.initialY ?? 2.799477162418296;
  const initialZ = params.initialZ ?? 53.555488125917094;
  if (![sigma, rho, beta, initialX, initialY, initialZ].every(Number.isFinite)) throw new RangeError('Lorenz parameters must be finite');
  // Fixed envelope sampled from the nominal seeded trajectory, with margin.
  const bounds: Bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1.1 };
  return createStatefulMotion({
    bounds,
    initialState: [initialX, initialY, initialZ] as const,
    initialTimeSeconds: 40 * 0.01,
    derivative: ([x, y, z]) => [sigma * (y - x), x * (rho - z) - y, x * y - beta * z] as const,
    snapshot: ([x, y, z], timeSeconds) => ({ state: { timeSeconds, x, y, z }, pose: { x: 2 * y / 55, y: 2 * z / 55 - 1, depth: Math.max(0.25, Math.min(1, 0.625 + x / 80)) } }),
    // Legacy Lorenz used h = .01 at 24 updates per second.
    timeScale: params.timeScale ?? 0.24,
    runawayLimit: params.runawayLimit,
  });
};

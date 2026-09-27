import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';
import { createAnalyticMotion, positivePeriod, wrapElapsed } from './analytic';

export interface RoseParams {
  /** Duration of one closed rose path. Defaults to the legacy 15π seconds. */
  readonly periodSeconds?: number;
}

export interface RoseState {
  readonly elapsedSeconds: number;
  readonly phase: number;
  readonly radialAngleRadians: number;
  readonly petalAngleRadians: number;
  readonly x: number;
  readonly y: number;
}

/** The default phase relationship retains the original rose shape. */
export const createRoseMotion = (params: RoseParams = {}): AnalyticMotionSource<RoseState> => {
  const periodSeconds = positivePeriod(params.periodSeconds ?? 15 * Math.PI);
  const bounds: Bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

  return createAnalyticMotion(bounds, periodSeconds, (elapsedSeconds): MotionSample<RoseState> => {
    const wrapped = wrapElapsed(elapsedSeconds, periodSeconds);
    const phase = wrapped / periodSeconds;
    const radialAngleRadians = phase * Math.PI * 4;
    const petalAngleRadians = phase * Math.PI * 10;
    const radius = Math.sin(radialAngleRadians);
    const x = radius * Math.cos(petalAngleRadians);
    const y = radius * Math.sin(petalAngleRadians);
    return { state: { elapsedSeconds: wrapped, phase, radialAngleRadians, petalAngleRadians, x, y }, pose: { x, y } };
  });
};

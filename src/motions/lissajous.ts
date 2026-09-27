import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';
import { createAnalyticMotion, positivePeriod, wrapElapsed } from './analytic';

export interface LissajousParams {
  /** Duration of the complete closed path. */
  readonly periodSeconds?: number;
  /** Complete horizontal cycles during one period. */
  readonly cyclesX?: number;
  /** Complete vertical cycles during one period. */
  readonly cyclesY?: number;
}

export interface LissajousState {
  readonly elapsedSeconds: number;
  readonly xAngleRadians: number;
  readonly yAngleRadians: number;
  readonly x: number;
  readonly y: number;
}

export const createLissajousMotion = (params: LissajousParams = {}): AnalyticMotionSource<LissajousState> => {
  const periodSeconds = positivePeriod(params.periodSeconds ?? 60);
  const cyclesX = params.cyclesX ?? 5;
  const cyclesY = params.cyclesY ?? 4;
  if (!Number.isSafeInteger(cyclesX) || cyclesX <= 0 || !Number.isSafeInteger(cyclesY) || cyclesY <= 0) {
    throw new RangeError('cyclesX and cyclesY must be positive integers');
  }
  const bounds: Bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

  return createAnalyticMotion(bounds, periodSeconds, (elapsedSeconds): MotionSample<LissajousState> => {
    const wrapped = wrapElapsed(elapsedSeconds, periodSeconds);
    const xAngleRadians = wrapped / periodSeconds * cyclesX * Math.PI * 2;
    const yAngleRadians = wrapped / periodSeconds * cyclesY * Math.PI * 2;
    const x = -Math.cos(xAngleRadians);
    const y = Math.sin(yAngleRadians);
    return { state: { elapsedSeconds: wrapped, xAngleRadians, yAngleRadians, x, y }, pose: { x, y } };
  });
};

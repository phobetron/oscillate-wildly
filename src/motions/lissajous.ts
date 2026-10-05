import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';
import { createAnalyticMotion, positivePeriod, wrapElapsed } from './analytic';

export interface LissajousParams {
  /** Duration of the complete closed path. */
  readonly periodSeconds?: number;
  /** Complete horizontal cycles during one period. */
  readonly cyclesX?: number;
  /** Complete vertical cycles during one period. */
  readonly cyclesY?: number;
  /** Complete Z-axis cycles during one period; independent of marker-size depth. */
  readonly cyclesZ?: number;
}

export interface LissajousState {
  readonly elapsedSeconds: number;
  readonly xAngleRadians: number;
  readonly yAngleRadians: number;
  readonly zAngleRadians: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const createLissajousMotion = (params: LissajousParams = {}): AnalyticMotionSource<LissajousState> => {
  const periodSeconds = positivePeriod(params.periodSeconds ?? 60);
  const cyclesX = params.cyclesX ?? 5;
  const cyclesY = params.cyclesY ?? 4;
  const cyclesZ = params.cyclesZ ?? 3;
  if (!Number.isSafeInteger(cyclesX) || cyclesX <= 0 || !Number.isSafeInteger(cyclesY) || cyclesY <= 0) {
    throw new RangeError('cyclesX and cyclesY must be positive integers');
  }
  if (!Number.isSafeInteger(cyclesZ) || cyclesZ <= 0) {
    throw new RangeError('cyclesZ must be a positive integer');
  }
  const bounds: Bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

  return createAnalyticMotion(bounds, periodSeconds, (elapsedSeconds): MotionSample<LissajousState> => {
    const wrapped = wrapElapsed(elapsedSeconds, periodSeconds);
    const xAngleRadians = wrapped / periodSeconds * cyclesX * Math.PI * 2;
    const yAngleRadians = wrapped / periodSeconds * cyclesY * Math.PI * 2;
    const zAngleRadians = wrapped / periodSeconds * cyclesZ * Math.PI * 2;
    const x = -Math.cos(xAngleRadians);
    const y = Math.sin(yAngleRadians);
    const z = Math.sin(zAngleRadians);
    // Use model Z as a bounded marker-size cue in the planar pose.
    return { state: { elapsedSeconds: wrapped, xAngleRadians, yAngleRadians, zAngleRadians, x, y, z }, pose: { x, y, depth: 0.625 + 0.375 * z } };
  });
};

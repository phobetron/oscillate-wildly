import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';
import { createAnalyticMotion, positivePeriod, wrapElapsed } from './analytic';

export interface EllipseParams {
  readonly periodSeconds?: number;
  readonly radiusX?: number;
  readonly radiusY?: number;
}

export interface EllipseState {
  readonly elapsedSeconds: number;
  readonly angleRadians: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const createEllipseMotion = (params: EllipseParams = {}): AnalyticMotionSource<EllipseState> => {
  const periodSeconds = positivePeriod(params.periodSeconds ?? 15);
  const radiusX = params.radiusX ?? 1;
  const radiusY = params.radiusY ?? 1;
  if (!Number.isFinite(radiusX) || radiusX <= 0 || !Number.isFinite(radiusY) || radiusY <= 0) {
    throw new RangeError('radiusX and radiusY must be finite numbers greater than zero');
  }
  const bounds: Bounds = { minX: -Math.abs(radiusX), maxX: Math.abs(radiusX), minY: -Math.abs(radiusY), maxY: Math.abs(radiusY) };

  return createAnalyticMotion(bounds, periodSeconds, (elapsedSeconds): MotionSample<EllipseState> => {
    const wrapped = wrapElapsed(elapsedSeconds, periodSeconds);
    const angleRadians = wrapped / periodSeconds * Math.PI * 2;
    const x = -Math.sin(angleRadians) * radiusX;
    const y = Math.cos(angleRadians) * radiusY;
    const z = Math.abs(Math.cos(angleRadians / 2));
    return { state: { elapsedSeconds: wrapped, angleRadians, x, y, z }, pose: { x, y, depth: z + 0.5 } };
  });
};

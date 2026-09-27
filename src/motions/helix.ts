import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';
import { createAnalyticMotion, wrapElapsed } from './analytic';

export interface HelixParams {
  readonly periodSeconds?: number;
  readonly turns?: number;
  readonly fadeFraction?: number;
}

export interface HelixState {
  readonly elapsedSeconds: number;
  readonly angleRadians: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const createHelixMotion = (params: HelixParams = {}): AnalyticMotionSource<HelixState> => {
  const periodSeconds = params.periodSeconds ?? 12;
  const turns = params.turns ?? 4;
  const fadeFraction = params.fadeFraction ?? 0.05;
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0 || !Number.isFinite(turns) || turns <= 0 || !Number.isFinite(fadeFraction) || fadeFraction <= 0 || fadeFraction >= 0.5) {
    throw new RangeError('helix parameters must be finite and within their supported ranges');
  }
  const bounds: Bounds = { minX: -1, maxX: 1, minY: 0, maxY: turns / 2 };

  return createAnalyticMotion(bounds, periodSeconds, (elapsedSeconds): MotionSample<HelixState> => {
    const wrapped = wrapElapsed(elapsedSeconds, periodSeconds);
    const progress = wrapped / periodSeconds;
    const angleRadians = progress * turns * Math.PI * 2;
    const x = Math.cos(angleRadians);
    const y = Math.sin(angleRadians);
    const z = 0.5 * angleRadians / (Math.PI * 2);
    const opacity = progress < fadeFraction
      ? progress / fadeFraction
      : progress > 1 - fadeFraction
        ? (1 - progress) / fadeFraction
        : 1;
    return { state: { elapsedSeconds: wrapped, angleRadians, x, y, z }, pose: { x, y: z, depth: 0.25 + 0.75 * (y + 1) / 2, opacity } };
  });
};

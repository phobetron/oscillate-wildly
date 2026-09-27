import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';

export const createAnalyticMotion = <State>(
  bounds: Bounds,
  periodSeconds: number,
  sample: (elapsedSeconds: number) => MotionSample<State>,
): AnalyticMotionSource<State> => ({
  kind: 'analytic',
  bounds,
  periodSeconds,
  sample,
  // Analytic sources have no evolving state. This method keeps the lifecycle
  // uniform with numerical sources.
  reset: () => undefined,
});

export const positivePeriod = (periodSeconds: number): number => {
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) {
    throw new RangeError('periodSeconds must be a finite number greater than zero');
  }
  return periodSeconds;
};

export const wrapElapsed = (elapsedSeconds: number, periodSeconds: number): number => {
  if (!Number.isFinite(elapsedSeconds)) {
    throw new RangeError('elapsedSeconds must be finite');
  }
  const elapsed = elapsedSeconds % periodSeconds;
  return elapsed < 0 ? elapsed + periodSeconds : elapsed;
};

import type { AnalyticMotionSource, Pose } from '../../../src/core';

/** A fixed pose isolates adapter projection and rendering from motion formulas. */
export const fixedMotion = (pose: Pose = { x: 0, y: 0 }): AnalyticMotionSource<undefined> => ({
  kind: 'analytic',
  periodSeconds: 1,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  sample: () => ({ state: undefined, pose }),
  reset: () => undefined,
});

export const invalidCapacities = [
  ['positive infinity', Infinity],
  ['negative infinity', -Infinity],
  ['NaN', NaN],
  ['zero', 0],
  ['negative integer', -1],
  ['fraction', 1.5],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
] as const;

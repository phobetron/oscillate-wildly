import { expect, test } from '@rstest/core';
import { createDuffingMotion, createLorenzMotion, createVanderPolMotion } from '../../../src/motions';

test.each([
  { name: 'Duffing', create: () => createDuffingMotion(), modelSeconds: 0.02 },
  { name: 'Lorenz', create: () => createLorenzMotion(), modelSeconds: 0.402 },
])('$name advances model time at its default speed', ({ create, modelSeconds }) => {
  const motion = create();

  motion.step(1 / 120);

  expect(motion.snapshot().state.timeSeconds).toBeCloseTo(modelSeconds);
});

test.each([
  { name: 'Van der Pol', create: () => createVanderPolMotion(), bounds: { minX: -0.75, maxX: 0.75, minY: -1, maxY: 1 } },
  { name: 'Duffing', create: () => createDuffingMotion(), bounds: { minX: -0.55, maxX: 0.55, minY: -0.35, maxY: 0.35 } },
  { name: 'Lorenz', create: () => createLorenzMotion(), bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1.1 } },
])('$name exposes its nominal framing bounds', ({ create, bounds }) => {
  expect(create().bounds).toEqual(bounds);
});

test('Lorenz keeps its marker size positive after advancing the trajectory', () => {
  const motion = createLorenzMotion();

  for (let index = 0; index < 100; index += 1) motion.step(1 / 120);

  const depth = motion.snapshot().pose.depth;
  expect(depth).toBeGreaterThan(0);
  expect(depth).toBeLessThanOrEqual(1);
});

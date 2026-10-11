import { expect, test } from '@rstest/core';
import { createLissajousMotion } from '../../../src/motions';

test('Lissajous exposes default and custom depth cycles with closed, wrapped samples', () => {
  const defaults = createLissajousMotion();
  expect(defaults.sample(5).state.zAngleRadians).toBe(Math.PI / 2);
  expect(defaults.sample(5).state.z).toBe(1);
  expect(defaults.sample(60)).toEqual(defaults.sample(0));

  const custom = createLissajousMotion({ periodSeconds: 8, cyclesZ: 2 });
  expect(custom.sample(1).state.zAngleRadians).toBe(Math.PI / 2);
  expect(custom.sample(1).state.z).toBe(1);
  expect(custom.sample(8)).toEqual(custom.sample(0));
  expect(custom.sample(-1)).toEqual(custom.sample(7));
  expect(custom.sample(9)).toEqual(custom.sample(1));
  for (const cyclesZ of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createLissajousMotion({ cyclesZ })).toThrow(RangeError);
  }
});

test('Lissajous depth cycles preserve planar XY, bounds, and existing state values', () => {
  const defaults = createLissajousMotion();
  const custom = createLissajousMotion({ cyclesZ: 7 });
  expect(custom.bounds).toEqual(defaults.bounds);
  expect(custom.periodSeconds).toBe(defaults.periodSeconds);
  for (const seconds of [0, 5, 13, 59, 60, -1]) {
    const original = defaults.sample(seconds);
    const changed = custom.sample(seconds);
    expect(changed.pose).toMatchObject({ x: original.pose.x, y: original.pose.y });
    for (const key of ['elapsedSeconds', 'xAngleRadians', 'yAngleRadians', 'x', 'y'] as const) {
      expect(changed.state[key]).toBe(original.state[key]);
    }
  }
  expect(custom.sample(5).pose.depth).not.toBe(defaults.sample(5).pose.depth);
});

test('Lissajous depth is a positive bounded size cue with repeatable endpoints', () => {
  const motion = createLissajousMotion();
  expect(motion.sample(0).pose.depth).toBe(0.625);
  expect(motion.sample(5).pose.depth).toBe(1);
  expect(motion.sample(15).pose.depth).toBe(0.25);
  for (const seconds of [-60, -1, 0, 2.5, 5, 10, 15, 17.5, 60, 120]) {
    expect(motion.sample(seconds).pose.depth).toBeGreaterThanOrEqual(0.25);
    expect(motion.sample(seconds).pose.depth).toBeLessThanOrEqual(1);
  }
  motion.reset();
  expect(motion.sample(0).pose).toEqual({ x: -1, y: 0, depth: 0.625 });
});

test('the default Lissajous model trajectory is not confined to a plane', () => {
  const motion = createLissajousMotion();
  const [origin, ...points] = [0, 4.2, 11.4, 18.6].map((seconds) => motion.sample(seconds).state);
  const [a, b, c] = points.map((point) => [point.x - origin.x, point.y - origin.y, point.z - origin.z]);
  const volume = a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);
  expect(Math.abs(volume)).toBeGreaterThan(0.1);
});

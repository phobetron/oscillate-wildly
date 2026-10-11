import { expect, test } from '@rstest/core';
import { createEllipseMotion, createRoseMotion, createLissajousMotion } from '../../../src/motions';

test('analytic factories expose their default initial poses and period', () => {
  const ellipse = createEllipseMotion();
  const rose = createRoseMotion();
  const lissajous = createLissajousMotion();

  expect(ellipse.kind).toBe('analytic');
  expect(ellipse.sample(0).pose.x).toBeCloseTo(0);
  expect(ellipse.sample(0).pose.y).toBe(1);
  expect(ellipse.sample(0).pose.depth).toBe(1.5);
  expect(rose.sample(0).pose).toEqual({ x: 0, y: 0 });
  expect(lissajous.periodSeconds).toBe(60);
});

test('analytic parameters reject invalid radii and fractional cycles', () => {
  expect(() => createLissajousMotion({ cyclesX: 1.5 })).toThrow(RangeError);
  expect(() => createEllipseMotion({ radiusX: 0 })).toThrow(RangeError);
  expect(() => createEllipseMotion({ radiusY: Number.POSITIVE_INFINITY })).toThrow(RangeError);
});

test.each([
  { name: 'ellipse', create: () => createEllipseMotion() },
  { name: 'rose', create: () => createRoseMotion({ periodSeconds: 10 }) },
  { name: 'Lissajous', create: () => createLissajousMotion({ periodSeconds: 7, cyclesX: 3, cyclesY: 2 }) },
])('$name closes its path without a trail segment break', ({ create }) => {
  const motion = create();
  const initial = motion.sample(0);
  const wrapped = motion.sample(motion.periodSeconds);

  expect(wrapped).toEqual(initial);
  expect(initial.pathSegment).toBeUndefined();
  expect(wrapped.pathSegment).toBeUndefined();
});

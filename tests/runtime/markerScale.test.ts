import { expect, test } from '@rstest/core';
import type { MarkerScaleOptions, Pose } from '../../src/core';
import { createMarkerScaleMapper } from '../../src/runtime/markerScale';
import {
  createDuffingMotion, createEllipseMotion, createHelixMotion, createLissajousMotion,
  createLorenzMotion, createRoseMotion, createVanderPolMotion,
} from '../../src/motions';

test('default marker presentation preserves every factory sample exactly', () => {
  const defaults = createMarkerScaleMapper();
  const explicit = createMarkerScaleMapper({ depthStrength: 1, minMarkerScale: 0 });
  for (const motion of [createEllipseMotion(), createHelixMotion(), createLissajousMotion(), createDuffingMotion(), createLorenzMotion(), createRoseMotion(), createVanderPolMotion()]) {
    for (let index = 0; index < 30; index += 1) {
      if (motion.kind === 'stateful') motion.step(1 / 120);
      const sample = motion.kind === 'analytic' ? motion.sample(index / 10) : motion.snapshot();
      expect(defaults(sample.pose)).toBe(sample.pose);
      expect(explicit(sample.pose)).toBe(sample.pose);
    }
  }
});

test('strength adjusts contrast about base size and leaves other pose channels intact', () => {
  const pose: Pose = { x: 2, y: 3, z: 4, opacity: 0.5, depth: 0.75 };
  expect(createMarkerScaleMapper({ depthStrength: 2 })(pose)).toEqual({ ...pose, depth: 0.5 });
  expect(createMarkerScaleMapper({ depthStrength: 2 })({ ...pose, depth: 1.5 }).depth).toBe(2);
  expect(createMarkerScaleMapper({ depthStrength: 0 })(pose)).toEqual({ ...pose, depth: 1 });
  expect(createMarkerScaleMapper({ depthStrength: 2 })({ ...pose, depth: 0.25 }).depth).toBe(0);
  expect(pose.depth).toBe(0.75);
});

test('limits clamp rather than remap cues and can size motions without a depth cue', () => {
  const clamp = createMarkerScaleMapper({ minMarkerScale: 0.5, maxMarkerScale: 2 });
  expect(clamp({ x: 0, y: 0, depth: 0.25 }).depth).toBe(0.5);
  expect(clamp({ x: 0, y: 0, depth: 3 }).depth).toBe(2);
  expect(clamp({ x: 0, y: 0, depth: 0.75 }).depth).toBe(0.75);
  const planar: Pose = { x: 0, y: 0 };
  expect(createMarkerScaleMapper({ depthStrength: 3 })(planar)).toBe(planar);
  expect(createMarkerScaleMapper({ minMarkerScale: 1.5, maxMarkerScale: 1.5 })(planar).depth).toBe(1.5);
  expect(createMarkerScaleMapper({ minMarkerScale: 0, maxMarkerScale: 0 })(planar).depth).toBe(0);
  expect(createMarkerScaleMapper({ depthStrength: 0, maxMarkerScale: 0.5 })(planar).depth).toBe(0.5);
  // An omitted maximum preserves the ellipse's native values above one.
  expect(createMarkerScaleMapper({ minMarkerScale: 0.25 })({ ...planar, depth: 1.5 }).depth).toBe(1.5);
});

test('marker settings are validated and snapshotted before rendering', () => {
  for (const key of ['depthStrength', 'minMarkerScale', 'maxMarkerScale'] as const) {
    for (const value of [NaN, Infinity, -Infinity, -0.1]) {
      expect(() => createMarkerScaleMapper({ [key]: value })).toThrow(/finite and nonnegative/);
    }
  }
  expect(() => createMarkerScaleMapper({ minMarkerScale: 2, maxMarkerScale: 1 })).toThrow(/Minimum.*maximum/);
  const options: { depthStrength: number } = { depthStrength: 2 };
  const mapper = createMarkerScaleMapper(options);
  options.depthStrength = 0;
  expect(mapper({ x: 0, y: 0, depth: 1.5 }).depth).toBe(2);
});

test('nonfinite effective scales fail unless a finite limit bounds the amplified value', () => {
  const options: MarkerScaleOptions = { depthStrength: Number.MAX_VALUE };
  const pose = { x: 0, y: 0, depth: Number.MAX_VALUE };
  expect(() => createMarkerScaleMapper(options)(pose)).toThrow(/Resulting marker scale must be finite/);
  expect(createMarkerScaleMapper({ ...options, maxMarkerScale: 2 })(pose).depth).toBe(2);
  expect(createMarkerScaleMapper({ minMarkerScale: Number.MAX_VALUE, maxMarkerScale: Number.MAX_VALUE })({ x: 0, y: 0 }).depth).toBe(Number.MAX_VALUE);
});

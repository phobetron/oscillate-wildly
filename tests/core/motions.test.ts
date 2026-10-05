import { expect, test } from '@rstest/core';
import {
  createDuffingMotion,
  createEllipseMotion,
  createHelixMotion,
  createLissajousMotion,
  createLorenzMotion,
  createRoseMotion,
  createVanderPolMotion,
} from '../../src/motions';
import { createController } from '../../src/runtime';

test('analytic factories expose repeatable samples and periods', () => {
  const ellipse = createEllipseMotion();
  const rose = createRoseMotion();
  const lissajous = createLissajousMotion();

  expect(ellipse.kind).toBe('analytic');
  expect(ellipse.sample(0).pose.x).toBeCloseTo(0);
  expect(ellipse.sample(0).pose.y).toBe(1);
  expect(ellipse.sample(0).pose.depth).toBe(1.5);
  expect(ellipse.sample(ellipse.periodSeconds)).toEqual(ellipse.sample(0));
  expect(rose.sample(0).pose).toEqual({ x: 0, y: 0 });
  expect(lissajous.periodSeconds).toBe(60);
});

test('helix makes four turns in 12 seconds and fades through its loop boundary', () => {
  const helix = createHelixMotion();
  const quarter = helix.sample(3);

  expect(helix.periodSeconds).toBe(12);
  expect(helix.sample(0)).toMatchObject({ state: { x: 1, y: 0, z: 0 }, pose: { x: 1, y: 0, depth: 0.625, opacity: 0 } });
  expect(quarter.state.x).toBeCloseTo(1);
  expect(quarter.state.y).toBeCloseTo(0);
  expect(quarter.state.z).toBeCloseTo(0.5);
  expect(quarter.pose.y).toBeCloseTo(0.5);
  expect(quarter.pose.depth).toBeCloseTo(0.625);
  expect(quarter.pose.opacity).toBe(1);
  expect(helix.sample(0.3).pose.opacity).toBeCloseTo(0.5);
  expect(helix.sample(12)).toEqual(helix.sample(0));
});

test('analytic period parameters always close their paths', () => {
  const rose = createRoseMotion({ periodSeconds: 10 });
  const lissajous = createLissajousMotion({ periodSeconds: 7, cyclesX: 3, cyclesY: 2 });

  expect(rose.sample(rose.periodSeconds)).toEqual(rose.sample(0));
  expect(lissajous.sample(lissajous.periodSeconds)).toEqual(lissajous.sample(0));
  expect(() => createLissajousMotion({ cyclesX: 1.5 })).toThrow(RangeError);
});

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
    expect(changed.pose).toEqual({ x: original.state.x, y: original.state.y, depth: 0.625 + 0.375 * changed.state.z });
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
  for (let seconds = -60; seconds <= 120; seconds += 0.5) {
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

test('ellipse requires positive finite radii', () => {
  expect(() => createEllipseMotion({ radiusX: 0 })).toThrow(RangeError);
  expect(() => createEllipseMotion({ radiusY: Number.POSITIVE_INFINITY })).toThrow(RangeError);
});

test('stateful ODE factories preserve their model state and use real seconds', () => {
  const vanderPol = createVanderPolMotion();
  const initial = vanderPol.snapshot();
  vanderPol.step(1 / 120);
  const stepped = vanderPol.snapshot();

  expect(vanderPol.kind).toBe('stateful');
  expect(initial.state).toEqual({ timeSeconds: 0, x: 1, y: 1 });
  expect(stepped.state.timeSeconds).toBeCloseTo(0.02);
  expect(stepped.state.x).toBeCloseTo(1.0198);
  expect(stepped.state.y).toBeCloseTo(0.979402);
  vanderPol.reset();
  expect(vanderPol.snapshot()).toEqual(initial);
});

test('numerical motion defaults retain legacy relative model speeds', () => {
  const duffing = createDuffingMotion();
  const lorenz = createLorenzMotion();
  duffing.step(1 / 120);
  lorenz.step(1 / 120);

  expect(duffing.snapshot().state.timeSeconds).toBeCloseTo(0.02);
  expect(lorenz.snapshot().state.timeSeconds).toBeCloseTo(0.402);
});

test('Duffing forcing phase follows scaled model time and resets with the model', () => {
  const motion = createDuffingMotion({ timeScale: 3, angularFrequency: 2 });
  const initial = motion.snapshot();
  expect(initial.state.forcingPhaseRadians).toBe(0);
  for (let index = 0; index < 120; index += 1) motion.step(1 / 120);
  expect(motion.snapshot().state.timeSeconds).toBeCloseTo(3);
  expect(motion.snapshot().state.forcingPhaseRadians).toBeCloseTo(6);
  motion.step(0.1);
  const crossed = motion.snapshot();
  expect(crossed.state.forcingPhaseRadians).toBeCloseTo(6.6);
  expect(crossed.state.forcingPhaseRadians).toBeGreaterThan(2 * Math.PI);
  expect(crossed.state.forcingPhaseRadians).toBe(2 * crossed.state.timeSeconds);
  expect(crossed.pose).toEqual({ x: crossed.state.x / 3, y: crossed.state.y / 3, depth: 0.625 + 0.375 * Math.sin(crossed.state.forcingPhaseRadians) });
  expect('z' in crossed.state).toBe(false);
  motion.reset();
  expect(motion.snapshot()).toEqual(initial);
});

test('Duffing retains zero and negative forcing frequencies and runaway reset behavior', () => {
  for (const angularFrequency of [0, -2]) {
    const motion = createDuffingMotion({ angularFrequency });
    motion.step(0.1);
    expect(motion.snapshot().state.forcingPhaseRadians).toBe(angularFrequency * motion.snapshot().state.timeSeconds);
    expect(motion.snapshot().pose.depth).toBe(0.625 + 0.375 * Math.sin(angularFrequency * motion.snapshot().state.timeSeconds));
    if (angularFrequency === 0) expect(motion.snapshot().pose.depth).toBe(0.625);
    else expect(motion.snapshot().pose.depth).toBeLessThan(0.625);
  }
  const runaway = createDuffingMotion({ angularFrequency: 2 });
  const initial = runaway.snapshot();
  runaway.step(0.1);
  expect(runaway.snapshot().state.forcingPhaseRadians).toBeGreaterThan(0);
  runaway.step(1_000_000);
  expect(runaway.snapshot()).toEqual(initial);
});

test('Duffing preserves legacy midpoint trajectory and planar pose numerics', () => {
  // Recorded from the pre-change built Duffing module at the same step sequence.
  const motion = createDuffingMotion();
  for (let index = 0; index < 120; index += 1) motion.step(1 / 120);
  const xySnapshot = () => {
    const sample = motion.snapshot();
    return { state: sample.state, pose: { x: sample.pose.x, y: sample.pose.y } };
  };
  expect(xySnapshot()).toEqual({
    state: { timeSeconds: 2.4000000000000017, forcingPhaseRadians: 2.4000000000000017, x: 0.43411399643227366, y: 0.2972396348950929 },
    pose: { x: 0.14470466547742455, y: 0.0990798782983643 },
  });
  motion.step(0.125);
  expect(xySnapshot()).toEqual({
    state: { timeSeconds: 2.7000000000000015, forcingPhaseRadians: 2.7000000000000015, x: 0.5258407635383029, y: 0.3103043580570707 },
    pose: { x: 0.17528025451276763, y: 0.10343478601902356 },
  });
});

test('Duffing phase produces a positive bounded size cue and resets to its midpoint', () => {
  const motion = createDuffingMotion({ angularFrequency: Math.PI / 2, timeScale: 1 });
  const initial = motion.snapshot();
  expect(initial.pose.depth).toBe(0.625);
  for (let index = 0; index < 360; index += 1) {
    motion.step(1 / 120);
    expect(motion.snapshot().pose.depth).toBeGreaterThanOrEqual(0.25);
    expect(motion.snapshot().pose.depth).toBeLessThanOrEqual(1);
    if (index === 119) expect(motion.snapshot().pose.depth).toBeCloseTo(1, 12);
  }
  expect(motion.snapshot().pose.depth).toBeCloseTo(0.25, 12);
  motion.reset();
  expect(motion.snapshot()).toEqual(initial);
});

test('Duffing size cues are interpolated by the shared controller with the pose', () => {
  const source = createDuffingMotion({ angularFrequency: 120, timeScale: 1 });
  let callback: ((timestamp: number) => void) | undefined;
  let renderedScale = 0;
  const controller = createController({
    target: {}, source, measureViewport: () => ({ width: 100, height: 100 }),
    render: (frame) => { renderedScale = frame.pose.depth!; },
    platform: {
      requestAnimationFrame: (next) => { callback = next; return 1; },
      cancelAnimationFrame: () => { callback = undefined; },
    },
  });
  callback?.(0);
  callback?.(10);
  expect(source.snapshot().state.forcingPhaseRadians).toBe(1);
  expect(renderedScale).toBeCloseTo(0.625 + 0.375 * Math.sin(1) * 0.2, 12);
  controller.dispose();
});

test('numerical bounds frame nominal trajectories and depth is always positive', () => {
  const vanderPol = createVanderPolMotion();
  const duffing = createDuffingMotion();
  const lorenz = createLorenzMotion();

  expect(vanderPol.bounds).toEqual({ minX: -0.75, maxX: 0.75, minY: -1, maxY: 1 });
  expect(duffing.bounds).toEqual({ minX: -0.55, maxX: 0.55, minY: -0.35, maxY: 0.35 });
  expect(lorenz.bounds).toEqual({ minX: -1, maxX: 1, minY: -1, maxY: 1.1 });
  for (let index = 0; index < 100; index += 1) lorenz.step(1 / 120);
  const depth = lorenz.snapshot().pose.depth;
  expect(depth).toBeGreaterThan(0);
  expect(depth).toBeLessThanOrEqual(1);
});

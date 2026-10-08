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
import { projectOrthographic, type OrthographicCamera } from '../../src/core';
import type { HelixFlowDirection, HelixRotationDirection } from '../../src/motions';

const helixFlows: readonly HelixFlowDirection[] = ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left'];
const helixRotations: readonly HelixRotationDirection[] = ['counter-clockwise', 'clockwise'];

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
  expect(helix.sample(12)).toEqual({ ...helix.sample(0), pathSegment: 1 });
});

test('helix direction defaults preserve the original samples exactly', () => {
  const defaults = createHelixMotion();
  const explicit = createHelixMotion({ rotationDirection: 'counter-clockwise', flowDirection: 'top-to-bottom' });
  for (const time of [-1, 0, 0.1, 0.3, 3, 5.5, 11.999, 12, 12.5, 24.1]) {
    const remainder = time % 12;
    const wrapped = remainder < 0 ? remainder + 12 : remainder;
    const progress = wrapped / 12;
    const angleRadians = progress * 4 * Math.PI * 2;
    const x = Math.cos(angleRadians);
    const y = Math.sin(angleRadians);
    const z = 0.5 * angleRadians / (Math.PI * 2);
    const opacity = progress < 0.05 ? progress / 0.05 : progress > 0.95 ? (1 - progress) / 0.05 : 1;
    expect(defaults.sample(time)).toEqual({
      state: { elapsedSeconds: wrapped, angleRadians, x, y, z },
      pose: { x, y: z, depth: 0.25 + 0.75 * (y + 1) / 2, opacity },
      pathSegment: Math.round((time - wrapped) / 12),
    });
    expect(explicit.sample(time)).toEqual(defaults.sample(time));
  }
});

test('helix rotation and flow remain independent across all eight combinations', () => {
  for (const flowDirection of helixFlows) {
    const horizontal = flowDirection === 'left-to-right' || flowDirection === 'right-to-left';
    const reverse = flowDirection === 'bottom-to-top' || flowDirection === 'right-to-left';
    const forward = createHelixMotion({ flowDirection });
    for (const rotationDirection of helixRotations) {
      const motion = createHelixMotion({ flowDirection, rotationDirection });
      expect(motion.bounds).toEqual(horizontal
        ? { minX: 0, maxX: 2, minY: -1, maxY: 1 }
        : { minX: -1, maxX: 1, minY: 0, maxY: 2 });
      const first = motion.sample(0).state;
      const quarter = motion.sample(0.75).state;
      // Signed radial cross product verifies the sense of rotation about the axis.
      const orientation = horizontal
        ? first.y * quarter.z - first.z * quarter.y
        : first.x * quarter.y - first.y * quarter.x;
      expect(orientation).toBeCloseTo(rotationDirection === 'clockwise' ? -1 : 1, 12);
      const early = motion.sample(0.3).state;
      const later = motion.sample(3.3).state;
      expect((horizontal ? later.x - early.x : later.z - early.z)).toBeCloseTo(reverse ? -0.5 : 0.5, 12);
      for (let index = 0; index < 100; index += 1) {
        const time = index * 0.12;
        const sample = motion.sample(time);
        const native = forward.sample(time);
        expect(sample.pose.x).toBe(native.pose.x);
        expect(sample.pose.y).toBe(native.pose.y);
        expect(sample.pose.opacity).toBe(native.pose.opacity);
        expect(sample.pathSegment).toBe(native.pathSegment);
        expect(sample.pose.x).toBeGreaterThanOrEqual(motion.bounds.minX);
        expect(sample.pose.x).toBeLessThanOrEqual(motion.bounds.maxX);
        expect(sample.pose.y).toBeGreaterThanOrEqual(motion.bounds.minY);
        expect(sample.pose.y).toBeLessThanOrEqual(motion.bounds.maxY);
        expect(Math.hypot(sample.state.y, horizontal ? sample.state.z : sample.state.x)).toBeCloseTo(1, 12);
        if (rotationDirection === 'clockwise') expect(sample.pose.depth! + native.pose.depth!).toBeCloseTo(1.25, 12);
        else expect(sample.pose.depth).toBe(native.pose.depth);
      }
      const beforeWrap = motion.sample(11.999);
      const afterWrap = motion.sample(12.001);
      expect(beforeWrap.pathSegment).toBe(0);
      expect(afterWrap.pathSegment).toBe(1);
      expect(Math.abs((horizontal ? afterWrap.pose.x - beforeWrap.pose.x : afterWrap.pose.y - beforeWrap.pose.y))).toBeGreaterThan(1.9);
    }
  }
});

test('helix flow names match the planar pose and canonical Front camera', () => {
  for (const flowDirection of helixFlows) {
    const horizontal = flowDirection === 'left-to-right' || flowDirection === 'right-to-left';
    const motion = createHelixMotion({ flowDirection });
    const camera: OrthographicCamera = horizontal
      ? { target: { x: 1, y: 0, z: 0 }, position: { x: 1, y: -7, z: 0 }, up: { x: 0, y: 0, z: 1 }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } }
      : { target: { x: 0, y: 0, z: 1 }, position: { x: 0, y: 7, z: 1 }, up: { x: 0, y: 0, z: -1 }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } };
    const early = motion.sample(0.3);
    const later = motion.sample(3.3);
    const a = projectOrthographic(early.state, { width: 200, height: 200 }, camera, { fit: 'contain', padding: 0 });
    const b = projectOrthographic(later.state, { width: 200, height: 200 }, camera, { fit: 'contain', padding: 0 });
    const delta = horizontal ? b.x - a.x : b.y - a.y;
    expect(delta).toBeCloseTo(flowDirection === 'bottom-to-top' || flowDirection === 'right-to-left' ? -25 : 25, 12);
    expect((horizontal ? later.pose.x - early.pose.x : later.pose.y - early.pose.y)).toBeCloseTo(delta / 50, 12);
  }
});

test('helix rejects unrecognized rotation and flow directions', () => {
  for (const value of ['', 'left', 'CLOCKWISE', 1, false]) {
    expect(() => createHelixMotion({ rotationDirection: value as HelixRotationDirection })).toThrow(/rotationDirection/);
    expect(() => createHelixMotion({ flowDirection: value as HelixFlowDirection })).toThrow(/flowDirection/);
  }
});

test('analytic period parameters always close their paths', () => {
  const rose = createRoseMotion({ periodSeconds: 10 });
  const lissajous = createLissajousMotion({ periodSeconds: 7, cyclesX: 3, cyclesY: 2 });

  expect(rose.sample(rose.periodSeconds)).toEqual(rose.sample(0));
  expect(lissajous.sample(lissajous.periodSeconds)).toEqual(lissajous.sample(0));
  expect(() => createLissajousMotion({ cyclesX: 1.5 })).toThrow(RangeError);
});

test('helix identifies separate loops without splitting continuous closed motions', () => {
  const helix = createHelixMotion({ periodSeconds: 2 });
  expect(helix.sample(0).pathSegment).toBe(0);
  expect(helix.sample(1.999).pathSegment).toBe(0);
  expect(helix.sample(2).pathSegment).toBe(1);
  expect(helix.sample(2.001).pathSegment).toBe(1);
  expect(helix.sample(8.001).pathSegment).toBe(4);
  expect(helix.sample(-0.001).pathSegment).toBe(-1);
  expect(helix.sample(-2).pathSegment).toBe(-1);
  expect(helix.sample(2).pose).toEqual(helix.sample(0).pose);
  for (const motion of [createEllipseMotion(), createRoseMotion(), createLissajousMotion()]) {
    expect(motion.sample(0).pathSegment).toBeUndefined();
    expect(motion.sample(motion.periodSeconds).pathSegment).toBeUndefined();
  }
});

test('helix path identity changes with the actual wrap at repeated fractional periods', () => {
  const helix = createHelixMotion({ periodSeconds: 0.1, turns: 1 });
  expect(helix.sample(0.49).pathSegment).toBe(4);
  expect(helix.sample(0.5).pathSegment).toBe(4);
  expect(helix.sample(0.51).pathSegment).toBe(5);
  for (const periodSeconds of [0.1, 0.18, 1.2]) {
    const motion = createHelixMotion({ periodSeconds });
    let previous = motion.sample(0);
    for (let index = 1; index <= 1000; index += 1) {
      const current = motion.sample(index * periodSeconds / 10);
      const jumped = current.state.elapsedSeconds < previous.state.elapsedSeconds;
      expect(current.pathSegment !== previous.pathSegment).toBe(jumped);
      previous = current;
    }
  }
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

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

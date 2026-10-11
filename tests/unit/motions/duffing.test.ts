import { expect, test } from '@rstest/core';
import { createDuffingMotion } from '../../../src/motions';
import { createController } from '../../../src/runtime';

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
  expect('z' in crossed.state).toBe(false);
  motion.reset();
  expect(motion.snapshot()).toEqual(initial);
});

test('Duffing retains zero and negative forcing frequencies and runaway reset behavior', () => {
  for (const angularFrequency of [0, -2]) {
    const motion = createDuffingMotion({ angularFrequency });
    motion.step(0.1);
    expect(motion.snapshot().state.forcingPhaseRadians).toBe(angularFrequency * motion.snapshot().state.timeSeconds);
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

test('Duffing follows its reference trajectory through fixed and variable steps', () => {
  // Reference trajectory protects integration accuracy independently of the solver formula.
  const motion = createDuffingMotion();
  for (let index = 0; index < 120; index += 1) motion.step(1 / 120);
  const xySnapshot = () => {
    const sample = motion.snapshot();
    return { state: sample.state, pose: { x: sample.pose.x, y: sample.pose.y } };
  };
  const fixedStep = xySnapshot();
  expect(fixedStep.state.timeSeconds).toBeCloseTo(2.4, 12);
  expect(fixedStep.state.x).toBeCloseTo(0.43411399643227366, 12);
  expect(fixedStep.state.y).toBeCloseTo(0.2972396348950929, 12);
  expect(fixedStep.pose.x).toBeCloseTo(0.14470466547742455, 12);
  expect(fixedStep.pose.y).toBeCloseTo(0.0990798782983643, 12);

  motion.step(0.125);
  const variableStep = xySnapshot();
  expect(variableStep.state.timeSeconds).toBeCloseTo(2.7, 12);
  expect(variableStep.state.x).toBeCloseTo(0.5258407635383029, 12);
  expect(variableStep.state.y).toBeCloseTo(0.3103043580570707, 12);
  expect(variableStep.pose.x).toBeCloseTo(0.17528025451276763, 12);
  expect(variableStep.pose.y).toBeCloseTo(0.10343478601902356, 12);
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
  callback!(0);
  callback!(10);
  expect(source.snapshot().state.forcingPhaseRadians).toBe(1);
  expect(renderedScale).toBeCloseTo(0.6881103238605922, 12);
  controller.dispose();
});

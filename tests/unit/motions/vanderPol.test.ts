import { expect, test } from '@rstest/core';
import { createVanderPolMotion } from '../../../src/motions';

test('Van der Pol advances its model in scaled seconds and restores the initial state on reset', () => {
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

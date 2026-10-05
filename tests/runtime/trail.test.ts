import { describe, expect, it } from '@rstest/core';
import { createTrailHistory } from '../../src/runtime/trail';

describe('trail history', () => {
  it('defaults to retaining the latest 128 samples', () => {
    const history = createTrailHistory<number>();
    for (let index = 0; index < 140; index += 1) history.add(index, index);
    expect(history.values()).toEqual(Array.from({ length: 128 }, (_, index) => index + 12));
  });

  it('evicts oldest samples in chronological order after multiple ring rotations', () => {
    const history = createTrailHistory<number>(3);
    for (let index = 0; index < 10; index += 1) history.add(index, index);
    expect(history.values()).toEqual([7, 8, 9]);
    history.add(90, 9);
    expect(history.values()).toEqual([7, 8, 90]);
  });

  it('replaces paused samples without aging the history, including at time zero', () => {
    const history = createTrailHistory<string>(2);
    history.add('initial', 0);
    history.add('redraw', 0);
    expect(history.values()).toEqual(['redraw']);
    history.add('next', 1);
    history.add('paused', 1);
    expect(history.values()).toEqual(['redraw', 'paused']);
  });

  it('clears on reset and resets its time tracking when explicitly cleared', () => {
    const history = createTrailHistory<number>(2);
    history.add(1, 1);
    history.add(2, 2);
    history.add(0, 0);
    expect(history.values()).toEqual([0]);
    history.clear();
    expect(history.values()).toEqual([]);
    history.add(3, 0);
    history.add(4, 1);
    expect(history.values()).toEqual([3, 4]);
  });

  it('supports a capacity of one and very large safe capacities without preallocation', () => {
    const single = createTrailHistory<number>(1);
    single.add(1, 1);
    single.add(2, 2);
    single.add(3, 2);
    expect(single.values()).toEqual([3]);
    const large = createTrailHistory<number>(Number.MAX_SAFE_INTEGER);
    large.add(1, 1);
    expect(large.values()).toEqual([1]);
  });

  it('rejects invalid capacities', () => {
    for (const capacity of [Infinity, -Infinity, NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createTrailHistory(capacity)).toThrow(RangeError);
    }
  });
});

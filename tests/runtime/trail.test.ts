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

  it('retains separate adjacent paths within one sample budget through ring rotation', () => {
    const history = createTrailHistory<string>(4);
    history.add('a', 1, 0);
    history.add('b', 2, 0);
    history.add('c', 3, 1);
    history.add('d', 4, 1);
    expect(history.segments()).toEqual([['a', 'b'], ['c', 'd']]);
    history.add('e', 5, 2);
    expect(history.values()).toEqual(['b', 'c', 'd', 'e']);
    expect(history.segments()).toEqual([['b'], ['c', 'd'], ['e']]);
    history.add('f', 6, 2);
    expect(history.segments()).toEqual([['c', 'd'], ['e', 'f']]);
    history.add('redraw', 6, 2);
    expect(history.size).toBe(4);
    expect(history.segments()).toEqual([['c', 'd'], ['e', 'redraw']]);
    // Returning to an earlier identifier still starts a new adjacent run.
    history.add('g', 7, 1);
    expect(history.segments()).toEqual([['d'], ['e', 'redraw'], ['g']]);
  });

  it('clears path metadata on reset and supports unchanged or single-sample paths', () => {
    const history = createTrailHistory<number>(2);
    expect(history.segments()).toEqual([]);
    history.add(1, 1, 1);
    history.add(2, 2, 2);
    history.add(0, 0, 0);
    expect(history.segments()).toEqual([[0]]);
    history.clear();
    history.add(3, 1);
    history.add(4, 2);
    expect(history.segments()).toEqual([[3, 4]]);
    history.add(40, 2, 1);
    expect(history.segments()).toEqual([[3], [40]]);
    const single = createTrailHistory<number>(1);
    single.add(1, 1, 0);
    single.add(2, 2, 1);
    expect(single.segments()).toEqual([[2]]);
  });
});

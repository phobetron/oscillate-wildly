import { RIBBON_SLOT_FLOATS, ribbonVertex } from './geometry';
import { describe, expect, it } from '@rstest/core';
import { createRibbonBrush } from '../../../src/webgl/ribbon';

const up = { x: 0, y: 1, z: 0 };
describe('world-space ribbon archive', () => {
  it('deposits two triangles per segment with dynamic width and continuous frozen edges', () => {
    const brush = createRibbonBrush(8);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    expect(brush.count).toBe(0);
    brush.add({ x: 1, y: 0 }, 1, 4, up);
    expect(ribbonVertex(brush.vertices, 0, 0)).toEqual([0, -1, 0]);
    expect(ribbonVertex(brush.vertices, 0, 1)).toEqual([0, 1, 0]);
    expect(ribbonVertex(brush.vertices, 0, 2)).toEqual([1, -2, 0]);
    expect(ribbonVertex(brush.vertices, 0, 4)).toEqual([1, 2, 0]);
    const first = brush.vertices.slice(0, RIBBON_SLOT_FLOATS);
    brush.add({ x: 1, y: 1, z: 1 }, 2, 6, { x: 1, y: 0, z: 0 });
    expect(brush.count).toBe(2);
    expect(ribbonVertex(brush.vertices, 1, 0)).toEqual(ribbonVertex(first, 0, 2));
    expect(ribbonVertex(brush.vertices, 1, 1)).toEqual(ribbonVertex(first, 0, 4));
    expect(Array.from(brush.vertices.slice(0, RIBBON_SLOT_FLOATS))).toEqual(Array.from(first));
    expect(ribbonVertex(brush.vertices, 1, 2)).toEqual([-2, 1, 1]);
    expect(ribbonVertex(brush.vertices, 1, 4)).toEqual([4, 1, 1]);
    expect(ribbonVertex(brush.vertices, 1, 1)).toEqual(ribbonVertex(brush.vertices, 1, 3));
    expect(ribbonVertex(brush.vertices, 1, 2)).toEqual(ribbonVertex(brush.vertices, 1, 5));
  });

  it('normalizes supplied 3D sides, including very large and subnormal directions', () => {
    for (const magnitude of [3, Number.MAX_VALUE, Number.MIN_VALUE]) {
      const brush = createRibbonBrush();
      const side = { x: magnitude, y: magnitude, z: magnitude };
      brush.add({ x: 0, y: 0, z: 0 }, 0, 0.6, side);
      brush.add({ x: 1, y: 2, z: 3 }, 1, 0.6, side);
      const left = ribbonVertex(brush.vertices, 0, 2);
      const right = ribbonVertex(brush.vertices, 0, 4);
      expect(Math.hypot(...right.map((value, index) => value - left[index]))).toBeCloseTo(0.6, 6);
      left.forEach((value, index) => expect((value + right[index]) / 2).toBeCloseTo(index + 1, 6));
      expect(Array.from(brush.vertices).every(Number.isFinite)).toBe(true);
    }
  });

  it('orients the initial footprint with the first moving sample while retaining its width', () => {
    const brush = createRibbonBrush();
    brush.add({ x: 0, y: 0 }, 0, 2, up, [1, 0, 0]);
    brush.add({ x: 0, y: 1 }, 1, 4, { x: 1, y: 0, z: 0 }, [0, 0, 1]);
    expect(ribbonVertex(brush.vertices, 0, 0)).toEqual([-1, 0, 0]);
    expect(ribbonVertex(brush.vertices, 0, 1)).toEqual([1, 0, 0]);
    expect(ribbonVertex(brush.vertices, 0, 2)).toEqual([-2, 1, 0]);
    expect(ribbonVertex(brush.vertices, 0, 4)).toEqual([2, 1, 0]);
    expect(ribbonVertex(brush.colors, 0, 0)).toEqual([1, 0, 0]);
    expect(ribbonVertex(brush.colors, 0, 2)).toEqual([0, 0, 1]);
    brush.breakStroke();
    brush.add({ x: 10, y: 0 }, 2, 6, up);
    brush.add({ x: 10, y: 1 }, 3, 2, { x: 1, y: 0, z: 0 });
    expect(ribbonVertex(brush.vertices, 1, 0)).toEqual([7, 0, 0]);
    expect(ribbonVertex(brush.vertices, 1, 1)).toEqual([13, 0, 0]);
  });

  it('deposits per-sample RGB without recoloring old paint, even across buffer growth', () => {
    const brush = createRibbonBrush();
    const red: [number, number, number] = [1, 0, 0];
    const blue: [number, number, number] = [0, 0, 1];
    brush.add({ x: 0, y: 0 }, 0, 2, up, red);
    red[0] = 0;
    brush.add({ x: 1, y: 0 }, 1, 2, up, blue);
    expect(ribbonVertex(brush.colors, 0, 0)).toEqual([1, 0, 0]);
    expect(ribbonVertex(brush.colors, 0, 1)).toEqual([1, 0, 0]);
    expect(ribbonVertex(brush.colors, 0, 2)).toEqual(blue);
    expect(ribbonVertex(brush.colors, 0, 3)).toEqual([1, 0, 0]);
    expect(ribbonVertex(brush.colors, 0, 4)).toEqual(blue);
    expect(ribbonVertex(brush.colors, 0, 5)).toEqual(blue);
    const first = brush.colors.slice();
    const revision = brush.revision;
    brush.add({ x: 1, y: 0 }, 1, 2, up, [0, 1, 0]);
    expect(brush.revision).toBe(revision);
    brush.add({ x: 2, y: 0 }, 2, 2, up, [0, 1, 0]);
    expect(brush.colors.length).toBe(brush.vertices.length);
    expect(Array.from(brush.colors.slice(0, RIBBON_SLOT_FLOATS))).toEqual(Array.from(first));
    expect(ribbonVertex(brush.colors, 1, 0)).toEqual(blue);
    expect(ribbonVertex(brush.colors, 1, 4)).toEqual([0, 1, 0]);
    brush.clear();
    brush.add({ x: 3, y: 0 }, 0, 2, up);
    brush.add({ x: 4, y: 0 }, 1, 2, up);
    expect(ribbonVertex(brush.colors, 0, 0)).toEqual([1, 0, 0]);
  });

  it('freezes deposited geometry on same-time camera, position, and width redraws', () => {
    const brush = createRibbonBrush();
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    brush.add({ x: 99, y: 99 }, 0, 20, { x: 1, y: 0, z: 0 });
    brush.add({ x: 1, y: 0 }, 1, 2, up);
    const before = brush.vertices.slice();
    const revision = brush.revision;
    brush.add({ x: 2, y: 3 }, 1, 20, { x: 1, y: 0, z: 0 });
    expect(brush.count).toBe(1);
    expect(brush.revision).toBe(revision);
    expect(Array.from(brush.vertices)).toEqual(Array.from(before));
    brush.add({ x: 2, y: 0 }, 2, 4, up);
    expect(ribbonVertex(brush.vertices, 1, 0)).toEqual(ribbonVertex(before, 0, 2));
    expect(ribbonVertex(brush.vertices, 1, 4)).toEqual([2, 2, 0]);
  });

  it('skips duplicate centers without aging paint or repainting the previous footprint', () => {
    const brush = createRibbonBrush(3);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    brush.add({ x: 1, y: 0 }, 1, 2, up);
    const revision = brush.revision;
    const buffer = brush.vertices;
    for (const time of [1, 2, 3, 4]) brush.add({ x: 1, y: 0 }, time, 20, up);
    expect(brush.revision).toBe(revision);
    expect(brush.vertices).toBe(buffer);
    expect(brush.full).toBe(false);
    brush.add({ x: 2, y: 0 }, 4, 4, up);
    expect(brush.count).toBe(1);
    brush.add({ x: 2, y: 0 }, 5, 4, up);
    expect(brush.count).toBe(2);
    expect(ribbonVertex(brush.vertices, 1, 0)).toEqual([1, -1, 0]);
    expect(brush.full).toBe(true);
  });

  it('grows geometrically and freezes original paint when the sample budget fills', () => {
    const brush = createRibbonBrush(10);
    brush.add({ x: 0, y: 0 }, 0, 1, up);
    let firstBuffer: Float32Array | undefined;
    for (let index = 1; index < 10; index += 1) {
      brush.add({ x: index, y: 0 }, index, 1, up);
      if (index === 1) firstBuffer = brush.vertices;
      if (index === 2) expect(brush.vertices).not.toBe(firstBuffer);
      const capacity = brush.vertices.length / RIBBON_SLOT_FLOATS;
      expect(brush.next).toBe(index % capacity);
      expect(Array.from({ length: brush.count }, (_, slot) => ribbonVertex(brush.vertices, slot, 2)[0]))
        .toEqual(Array.from({ length: index }, (_, offset) => offset + 1));
    }
    expect(brush.full).toBe(true);
    expect(brush.vertices.length).toBe(9 * RIBBON_SLOT_FLOATS);
    const before = brush.vertices.slice();
    const revision = brush.revision;
    const dirtySlot = brush.dirtySlot;
    for (let index = 10; index <= 30; index += 1) brush.add({ x: index, y: 0 }, index, 8, up);
    brush.add({ x: 100, y: 0 }, 0, 8, up);
    expect(brush.count).toBe(9);
    expect(brush.next).toBe(0);
    expect(brush.revision).toBe(revision);
    expect(brush.dirtySlot).toBe(dirtySlot);
    expect(Array.from(brush.vertices)).toEqual(Array.from(before));
  });

  it('lifts the brush without bridging gaps or replenishing capacity', () => {
    const brush = createRibbonBrush(5);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    brush.add({ x: 1, y: 0 }, 1, 2, up);
    const before = brush.vertices.slice();
    const revision = brush.revision;
    brush.breakStroke();
    expect(brush.revision).toBe(revision);
    brush.add({ x: 10, y: 0 }, 2, 2, up);
    brush.add({ x: 11, y: 0 }, 3, 2, up);
    expect(brush.count).toBe(2);
    expect(ribbonVertex(brush.vertices, 1, 0)[0]).toBe(10);
    expect(Array.from(brush.vertices.slice(0, RIBBON_SLOT_FLOATS))).toEqual(Array.from(before));
    brush.breakStroke();
    brush.add({ x: 20, y: 0 }, 4, 2, up);
    expect(brush.full).toBe(true);
    brush.add({ x: 21, y: 0 }, 5, 2, up);
    expect(brush.count).toBe(2);
  });

  it('uses width zero to lift the brush without consuming its sample budget', () => {
    const brush = createRibbonBrush(4);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    brush.add({ x: 1, y: 0 }, 1, 2, up);
    brush.add({ x: 2, y: 0 }, 2, 0, up);
    brush.add({ x: 3, y: 0 }, 3, 2, up);
    expect(brush.count).toBe(1);
    expect(brush.full).toBe(false);
    brush.add({ x: 4, y: 0 }, 4, 2, up);
    expect(brush.count).toBe(2);
    expect(ribbonVertex(brush.vertices, 1, 0)[0]).toBe(3);
    expect(brush.full).toBe(true);
  });

  it('keeps paint across time resets and clears explicitly with reusable allocation', () => {
    const brush = createRibbonBrush(3);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    brush.add({ x: 1, y: 0 }, 1, 2, up);
    brush.add({ x: 2, y: 0 }, 0, 2, up);
    expect(brush.count).toBe(2);
    const buffer = brush.vertices;
    const revision = brush.revision;
    brush.clear();
    expect(brush.vertices).toBe(buffer);
    expect(brush.count).toBe(0);
    expect(brush.next).toBe(0);
    expect(brush.full).toBe(false);
    expect(brush.dirtySlot).toBeUndefined();
    expect(brush.revision).toBe(revision + 1);
    brush.add({ x: 10, y: 0 }, 0, 2, up);
    brush.add({ x: 11, y: 0 }, 1, 2, up);
    expect(ribbonVertex(brush.vertices, 0, 0)[0]).toBe(10);
  });

  it('supports single-sample and huge budgets without preallocation', () => {
    const single = createRibbonBrush(1);
    expect(single.full).toBe(false);
    single.add({ x: 0, y: 0 }, 0, 2, up);
    expect(single.full).toBe(true);
    single.add({ x: 1, y: 0 }, 1, 2, up);
    expect(single.count).toBe(0);
    expect(single.vertices.length).toBe(0);
    const huge = createRibbonBrush(Number.MAX_SAFE_INTEGER);
    huge.add({ x: 0, y: 0 }, 0, 2, up);
    huge.add({ x: 1, y: 0 }, 1, 2, up);
    expect(huge.vertices.length).toBe(RIBBON_SLOT_FLOATS);
  });

  it('rejects invalid inputs before any mutation, including redraws and full brushes', () => {
    for (const limit of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createRibbonBrush(limit)).toThrow(RangeError);
    }
    const brush = createRibbonBrush(3);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    brush.add({ x: 1, y: 0 }, 1, 2, up);
    const invalidCalls = [
      () => brush.add({ x: NaN, y: 0 }, 0, 2, up),
      () => brush.add({ x: 0, y: Infinity }, 0, 2, up),
      () => brush.add({ x: 0, y: 0, z: NaN }, 0, 2, up),
      () => brush.add({ x: 0, y: 0 }, NaN, 2, up),
      ...[-1, Infinity, NaN].map((width) => () => brush.add({ x: 0, y: 0 }, 1, width, up)),
      ...[-1, 2, Infinity, NaN].map((value) => () => brush.add({ x: 0, y: 0 }, 1, 2, up, [value, 0, 0])),
      ...[{ x: 0, y: 0, z: 0 }, { x: Infinity, y: 1, z: 0 }, { x: 0, y: 0, z: NaN }]
        .map((side) => () => brush.add({ x: 0, y: 0 }, 1, 2, side)),
    ];
    for (const full of [false, true]) {
      if (full) brush.add({ x: 2, y: 0 }, 2, 2, up);
      const revision = brush.revision;
      const before = brush.vertices.slice();
      const colors = brush.colors.slice();
      for (const call of invalidCalls) expect(call).toThrow(RangeError);
      expect(brush.revision).toBe(revision);
      expect(Array.from(brush.vertices)).toEqual(Array.from(before));
      expect(Array.from(brush.colors)).toEqual(Array.from(colors));
      expect(brush.full).toBe(full);
    }
  });
});


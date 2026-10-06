import { describe, expect, it } from '@rstest/core';
import { createRibbonBrush } from '../../src/webgl/ribbon';

const up = { x: 0, y: 1, z: 0 };
const vertex = (vertices: Float32Array, slot: number, index: number): number[] =>
  Array.from(vertices.slice(slot * 18 + index * 3, slot * 18 + index * 3 + 3));
const footprintVertex = (vertices: Float32Array, slot: number, index: number): number[] =>
  Array.from(vertices.slice(slot * 108 + 54 + index * 9, slot * 108 + 54 + index * 9 + 9));
const flat = { axisX: { x: 2, y: 0, z: 0 }, axisY: { x: 0, y: 3, z: 0 } };
const visibleCaps = (vertices: Float32Array, count: number): number[] =>
  Array.from({ length: count }, (_, slot) => slot).filter((slot) => {
    const a = footprintVertex(vertices, slot, 0);
    const b = footprintVertex(vertices, slot, 1);
    return a.slice(0, 3).some((value, index) => value !== b[index]);
  });

describe('world-space ribbon brush', () => {
  it('aligns start/end caps to their actual 3D triangles, preserving footprint lengths and RGB', () => {
    const normal = (a: number[], b: number[], c: number[]): number[] => {
      const u = b.map((value, index) => value - a[index]);
      const v = c.map((value, index) => value - a[index]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...n);
      return n.map((value) => value / length);
    };
    for (const shape of ['circle', 'square'] as const) {
      const brush = createRibbonBrush();
      const footprint = { shape, axisX: { x: 2, y: 0, z: 0 }, axisY: { x: 1, y: 3, z: 0 } };
      brush.add({ x: 0, y: 0 }, 0, 4, up, [1, 0, 0], footprint);
      const stationary = brush.footprints.vertices;
      brush.add({ x: 2, y: 0, z: 3 }, 1, 6, up, [0, 1, 0], footprint);
      expect(brush.footprints.vertices).not.toBe(stationary);
      expect(brush.footprints.dirtyPreviousSlot).toBe(0);
      for (const slot of [0, 1]) {
        const cap = [0, 1, 2].map((index) => footprintVertex(brush.footprints.vertices, slot, index).slice(0, 3));
        const capNormal = normal(...cap as [number[], number[], number[]]);
        const triangle = slot === 0 ? [0, 1, 2] : [3, 4, 5];
        const stripNormal = normal(...triangle.map((index) => vertex(brush.vertices, 0, index)) as [number[], number[], number[]]);
        expect(Math.abs(capNormal.reduce((sum, value, index) => sum + value * stripNormal[index], 0))).toBeCloseTo(1, 6);
        expect(Math.hypot(...cap[1].map((value, index) => value - cap[0][index])) / 2).toBeCloseTo(2, 6);
        expect(Math.hypot(...cap[2].map((value, index) => value - cap[0][index])) / 2).toBeCloseTo(Math.sqrt(10), 6);
        const x = cap[1].map((value, index) => (value - cap[0][index]) / 2);
        const y = cap[2].map((value, index) => (value - cap[0][index]) / 2);
        expect(x.reduce((sum, value, index) => sum + value * y[index], 0)).toBeCloseTo(2, 6);
        expect(footprintVertex(brush.footprints.vertices, slot, 0).slice(3, 6)).toEqual(slot === 0 ? [1, 0, 0] : [0, 1, 0]);
        expect(footprintVertex(brush.footprints.vertices, slot, 0)[8]).toBe(shape === 'circle' ? 1 : 0);
      }
      const finalized = brush.footprints.vertices.slice(0, 108);
      const before = brush.footprints.vertices.slice();
      brush.add({ x: 20, y: 10, z: -20 }, 1, 20, { x: 1, y: 0, z: 0 }, [0, 0, 1], flat);
      expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
      brush.add({ x: 4, y: 3, z: -1 }, 2, 4, up, undefined, footprint);
      expect(Array.from(brush.footprints.vertices.slice(0, 108))).toEqual(Array.from(finalized));
      expect(brush.footprints.dirtyPreviousSlot).toBe(1);
    }
  });

  it('keeps incoming footprint axes for a degenerate connecting triangle', () => {
    const brush = createRibbonBrush();
    const alongPath = { x: 1, y: 0, z: 0 };
    brush.add({ x: 0, y: 0 }, 0, 2, alongPath, undefined, flat);
    const start = brush.footprints.vertices.slice(0, 108);
    brush.add({ x: 10, y: 0 }, 1, 2, alongPath, undefined, flat);
    expect(Array.from(brush.footprints.vertices.slice(0, 108))).toEqual(Array.from(start));
    expect(footprintVertex(brush.footprints.vertices, 1, 0).slice(0, 3)).toEqual([8, -3, 0]);
    expect(brush.footprints.dirtyPreviousSlot).toBe(0);
  });

  it('keeps only start and current end caps, preserving connectors and captured styles', () => {
    const brush = createRibbonBrush(6);
    brush.add({ x: 0, y: 0 }, 0, 4, up, [1, 0, 0], flat);
    const start = brush.footprints.vertices.slice(0, 108);
    expect(brush.footprints.dirtyPreviousSlot).toBeUndefined();
    brush.add({ x: 10, y: 0 }, 1, 4, up, [0, 1, 0], flat);
    const connector = brush.footprints.vertices.slice(108, 162);
    expect(brush.footprints.dirtyPreviousSlot).toBe(0);
    brush.add({ x: 20, y: 0 }, 2, 6, up, [0, 0, 1], { ...flat, shape: 'square' });
    expect(visibleCaps(brush.footprints.vertices, 3)).toEqual([0, 2]);
    expect(brush.footprints.dirtyPreviousSlot).toBe(1);
    expect(brush.footprints.dirtySlot).toBe(2);
    expect(Array.from(brush.footprints.vertices.slice(0, 108))).toEqual(Array.from(start));
    expect(Array.from(brush.footprints.vertices.slice(108, 162))).toEqual(Array.from(connector));
    for (let index = 0; index < 6; index += 1) {
      expect(footprintVertex(brush.footprints.vertices, 1, index)).toEqual([10, 0, 0, 0, 1, 0, 0, 0, 0]);
    }
    expect(footprintVertex(brush.footprints.vertices, 2, 0).slice(3)).toEqual([0, 0, 1, -1, -1, 0]);
    const before = brush.footprints.vertices.slice();
    brush.add({ x: 30, y: 0 }, 2, 4, up, [1, 0, 0], flat);
    expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
    brush.breakStroke();
    brush.add({ x: 100, y: 0 }, 3, 4, up, [1, 0, 0], flat);
    expect(brush.footprints.dirtyPreviousSlot).toBeUndefined();
    brush.add({ x: 110, y: 0 }, 4, 4, up, [1, 0, 0], flat);
    expect(brush.footprints.dirtyPreviousSlot).toBe(3);
    brush.add({ x: 120, y: 0 }, 5, 4, up, [1, 0, 0], flat);
    expect(visibleCaps(brush.footprints.vertices, 6)).toEqual([0, 2, 3, 5]);
    expect(brush.footprints.dirtyPreviousSlot).toBe(4);
    expect(brush.full).toBe(true);
    const capped = brush.footprints.vertices.slice();
    brush.add({ x: 130, y: 0 }, 6, 4, up, undefined, flat);
    expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(capped));
    brush.clear();
    expect(brush.footprints.dirtyPreviousSlot).toBeUndefined();
    brush.add({ x: 200, y: 0 }, 0, 4, up, undefined, flat);
    expect(visibleCaps(brush.footprints.vertices, 1)).toEqual([0]);
    expect(brush.footprints.dirtyPreviousSlot).toBeUndefined();
  });

  it('stamps frozen world quads with local circle/square masks at each sample', () => {
    for (const shape of ['circle', 'square'] as const) {
      const brush = createRibbonBrush();
      brush.add({ x: 10, y: 20, z: 30 }, 0, 4, up, [0, 1, 0], { ...flat, shape });
      expect(brush.count).toBe(0);
      expect(brush.footprints.count).toBe(1);
      for (let index = 0; index < 6; index += 1) {
        expect(Array.from(brush.footprints.vertices.slice(index * 9, index * 9 + 9)))
          .toEqual([10, 20, 30, 0, 1, 0, 0, 0, 0]);
      }
      const corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
      corners.forEach(([x, y], index) => {
        expect(footprintVertex(brush.footprints.vertices, 0, index))
          .toEqual([10 + x * 2, 20 + y * 3, 30, 0, 1, 0, x, y, shape === 'circle' ? 1 : 0]);
      });
      brush.add({ x: 11, y: 20, z: 30 }, 1, 4, up, [0, 0, 1], { ...flat, shape });
      expect(brush.footprints.count).toBe(2);
      expect(brush.footprints.dirtySlot).toBe(1);
      expect(brush.footprints.revision).toBe(2);
      for (let index = 0; index < 6; index += 1) {
        const packed = Array.from(brush.footprints.vertices.slice(108 + index * 9, 108 + index * 9 + 9));
        expect(packed).toEqual([...vertex(brush.vertices, 0, index), ...vertex(brush.colors, 0, index), 0, 0, 0]);
      }
    }
  });

  it('orders a new crossing strip after all old caps and before its own cap', () => {
    const brush = createRibbonBrush();
    brush.add({ x: 0, y: 0 }, 0, 2, up, [1, 0, 0], flat);
    brush.add({ x: 4, y: 0 }, 1, 2, up, [1, 0, 0], flat);
    brush.breakStroke();
    brush.add({ x: 0, y: -4 }, 2, 2, up, [0, 1, 0], flat);
    brush.add({ x: 0, y: 4 }, 3, 2, { x: 1, y: 0, z: 0 }, [0, 1, 0], flat);
    expect(brush.footprints.count).toBe(4);
    expect(footprintVertex(brush.footprints.vertices, 0, 0).slice(3, 6)).toEqual([1, 0, 0]);
    const latestStripOffset = 3 * 108;
    expect(latestStripOffset).toBeGreaterThan(2 * 108 + 54);
    for (let index = 0; index < 6; index += 1) {
      const packed = Array.from(brush.footprints.vertices.slice(latestStripOffset + index * 9,
        latestStripOffset + index * 9 + 9));
      expect(packed.slice(0, 3)).toEqual(vertex(brush.vertices, 1, index));
      expect(packed.slice(3)).toEqual([0, 1, 0, 0, 0, 0]);
    }
    // Stroke starts have no connecting area, so lifting does not add a bridge.
    for (let index = 0; index < 6; index += 1) {
      expect(Array.from(brush.footprints.vertices.slice(2 * 108 + index * 9, 2 * 108 + index * 9 + 3)))
        .toEqual([0, -4, 0]);
    }
    expect(footprintVertex(brush.footprints.vertices, 3, 0).slice(3, 6)).toEqual([0, 1, 0]);
  });

  it('keeps 3D footprint planes and captured styles frozen on redraws and later paint', () => {
    const brush = createRibbonBrush();
    const footprint = { axisX: { x: 0, y: 2, z: 0 }, axisY: { x: 0, y: 0, z: 3 } };
    const color: [number, number, number] = [1, 0, 0];
    brush.add({ x: 5, y: 0, z: 0 }, 0, 4, up, color, footprint);
    const before = brush.footprints.vertices.slice();
    expect(footprintVertex(before, 0, 0)).toEqual([5, -2, -3, 1, 0, 0, -1, -1, 1]);
    expect(footprintVertex(before, 0, 5)).toEqual([5, 2, 3, 1, 0, 0, 1, 1, 1]);
    footprint.axisX.y = 20;
    color[0] = 0;
    brush.add({ x: 99, y: 0 }, 0, 20, up, [0, 1, 0], { ...flat, shape: 'square' });
    brush.add({ x: 5, y: 0 }, 1, 20, up, [0, 1, 0], flat);
    expect(brush.footprints.count).toBe(1);
    expect(brush.footprints.revision).toBe(1);
    expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
    brush.add({ x: 6, y: 0 }, 2, 4, up, [0, 1, 0], { ...flat, shape: 'square' });
    expect(Array.from(brush.footprints.vertices.slice(0, 54))).toEqual(Array.from(before.slice(0, 54)));
    expect(footprintVertex(brush.footprints.vertices, 0, 0).slice(3)).toEqual([1, 0, 0, -1, -1, 1]);
    expect(footprintVertex(brush.footprints.vertices, 0, 0).slice(0, 3)).toEqual([2, -2, 0]);
    expect(footprintVertex(brush.footprints.vertices, 1, 0).slice(3)).toEqual([0, 1, 0, -1, -1, 0]);
  });

  it('retains initial and final footprints through growth, lifts, capacity, and clear', () => {
    const brush = createRibbonBrush(5);
    let first: Float32Array | undefined;
    for (let index = 0; index < 5; index += 1) {
      if (index > 1) brush.breakStroke();
      brush.add({ x: index * 10, y: 0 }, index, 4, up, undefined, flat);
      if (index === 0) first = brush.footprints.vertices;
      if (index === 1) expect(brush.footprints.vertices).not.toBe(first);
    }
    expect(brush.count).toBe(1);
    expect(brush.full).toBe(true);
    expect(brush.footprints.count).toBe(5);
    expect(brush.footprints.vertices.length).toBe(5 * 108);
    for (let slot = 0; slot < 5; slot += 1) {
      expect(footprintVertex(brush.footprints.vertices, slot, 0)[0]).toBe(slot * 10 - 2);
    }
    const buffer = brush.footprints.vertices;
    const before = buffer.slice();
    const revision = brush.footprints.revision;
    brush.breakStroke();
    brush.add({ x: 100, y: 0 }, 6, 4, up, undefined, flat);
    expect(brush.footprints.revision).toBe(revision);
    expect(Array.from(buffer)).toEqual(Array.from(before));
    brush.clear();
    expect(brush.footprints.vertices).toBe(buffer);
    expect(brush.footprints.count).toBe(0);
    expect(brush.footprints.dirtySlot).toBeUndefined();
    expect(brush.footprints.revision).toBe(revision + 1);
    brush.add({ x: 200, y: 0 }, 0, 4, up, undefined, flat);
    expect(brush.footprints.count).toBe(1);
    expect(footprintVertex(buffer, 0, 0)[0]).toBe(198);
  });

  it('paints a stationary single-sample footprint and skips zero width', () => {
    const brush = createRibbonBrush(1);
    brush.add({ x: 0, y: 0 }, 0, 0, up, undefined, flat);
    expect(brush.footprints.count).toBe(0);
    expect(brush.full).toBe(false);
    brush.add({ x: 0, y: 0 }, 1, 4, up, undefined, flat);
    expect(brush.footprints.count).toBe(1);
    expect(brush.full).toBe(true);
    expect(brush.count).toBe(0);
    brush.add({ x: 1, y: 0 }, 2, 4, up, undefined, flat);
    expect(brush.footprints.count).toBe(1);
  });

  it('validates footprint planes and shapes before mutating even a frozen brush', () => {
    const brush = createRibbonBrush(1);
    brush.add({ x: 0, y: 0 }, 0, 4, up, undefined, flat);
    const before = brush.footprints.vertices.slice();
    for (const footprint of [
      { ...flat, axisX: { x: 0, y: 0, z: 0 } },
      { ...flat, axisY: { x: 0, y: Infinity, z: 0 } },
      { ...flat, axisY: { x: 4, y: 0, z: 0 } },
      { ...flat, shape: 'triangle' as 'circle' },
    ]) {
      expect(() => brush.add({ x: 1, y: 0 }, 1, 4, up, undefined, footprint)).toThrow(RangeError);
    }
    expect(brush.footprints.revision).toBe(1);
    expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
  });

  it('deposits two triangles per segment with dynamic width and continuous frozen edges', () => {
    const brush = createRibbonBrush(8);
    brush.add({ x: 0, y: 0 }, 0, 2, up);
    expect(brush.count).toBe(0);
    brush.add({ x: 1, y: 0 }, 1, 4, up);
    expect(vertex(brush.vertices, 0, 0)).toEqual([0, -1, 0]);
    expect(vertex(brush.vertices, 0, 1)).toEqual([0, 1, 0]);
    expect(vertex(brush.vertices, 0, 2)).toEqual([1, -2, 0]);
    expect(vertex(brush.vertices, 0, 4)).toEqual([1, 2, 0]);
    const first = brush.vertices.slice(0, 18);
    brush.add({ x: 1, y: 1, z: 1 }, 2, 6, { x: 1, y: 0, z: 0 });
    expect(brush.count).toBe(2);
    expect(vertex(brush.vertices, 1, 0)).toEqual(vertex(first, 0, 2));
    expect(vertex(brush.vertices, 1, 1)).toEqual(vertex(first, 0, 4));
    expect(Array.from(brush.vertices.slice(0, 18))).toEqual(Array.from(first));
    expect(vertex(brush.vertices, 1, 2)).toEqual([-2, 1, 1]);
    expect(vertex(brush.vertices, 1, 4)).toEqual([4, 1, 1]);
    expect(vertex(brush.vertices, 1, 1)).toEqual(vertex(brush.vertices, 1, 3));
    expect(vertex(brush.vertices, 1, 2)).toEqual(vertex(brush.vertices, 1, 5));
  });

  it('normalizes supplied 3D sides, including very large and subnormal directions', () => {
    for (const magnitude of [3, Number.MAX_VALUE, Number.MIN_VALUE]) {
      const brush = createRibbonBrush();
      const side = { x: magnitude, y: magnitude, z: magnitude };
      brush.add({ x: 0, y: 0, z: 0 }, 0, 0.6, side);
      brush.add({ x: 1, y: 2, z: 3 }, 1, 0.6, side);
      const left = vertex(brush.vertices, 0, 2);
      const right = vertex(brush.vertices, 0, 4);
      expect(Math.hypot(...right.map((value, index) => value - left[index]))).toBeCloseTo(0.6, 6);
      left.forEach((value, index) => expect((value + right[index]) / 2).toBeCloseTo(index + 1, 6));
      expect(Array.from(brush.vertices).every(Number.isFinite)).toBe(true);
    }
  });

  it('orients the initial footprint with the first moving sample while retaining its width', () => {
    const brush = createRibbonBrush();
    brush.add({ x: 0, y: 0 }, 0, 2, up, [1, 0, 0]);
    brush.add({ x: 0, y: 1 }, 1, 4, { x: 1, y: 0, z: 0 }, [0, 0, 1]);
    expect(vertex(brush.vertices, 0, 0)).toEqual([-1, 0, 0]);
    expect(vertex(brush.vertices, 0, 1)).toEqual([1, 0, 0]);
    expect(vertex(brush.vertices, 0, 2)).toEqual([-2, 1, 0]);
    expect(vertex(brush.vertices, 0, 4)).toEqual([2, 1, 0]);
    expect(vertex(brush.colors, 0, 0)).toEqual([1, 0, 0]);
    expect(vertex(brush.colors, 0, 2)).toEqual([0, 0, 1]);
    brush.breakStroke();
    brush.add({ x: 10, y: 0 }, 2, 6, up);
    brush.add({ x: 10, y: 1 }, 3, 2, { x: 1, y: 0, z: 0 });
    expect(vertex(brush.vertices, 1, 0)).toEqual([7, 0, 0]);
    expect(vertex(brush.vertices, 1, 1)).toEqual([13, 0, 0]);
  });

  it('deposits per-sample RGB without recoloring old paint, even across buffer growth', () => {
    const brush = createRibbonBrush();
    const red: [number, number, number] = [1, 0, 0];
    const blue: [number, number, number] = [0, 0, 1];
    brush.add({ x: 0, y: 0 }, 0, 2, up, red);
    red[0] = 0;
    brush.add({ x: 1, y: 0 }, 1, 2, up, blue);
    expect(vertex(brush.colors, 0, 0)).toEqual([1, 0, 0]);
    expect(vertex(brush.colors, 0, 1)).toEqual([1, 0, 0]);
    expect(vertex(brush.colors, 0, 2)).toEqual(blue);
    expect(vertex(brush.colors, 0, 3)).toEqual([1, 0, 0]);
    expect(vertex(brush.colors, 0, 4)).toEqual(blue);
    expect(vertex(brush.colors, 0, 5)).toEqual(blue);
    const first = brush.colors.slice();
    const revision = brush.revision;
    brush.add({ x: 1, y: 0 }, 1, 2, up, [0, 1, 0]);
    expect(brush.revision).toBe(revision);
    brush.add({ x: 2, y: 0 }, 2, 2, up, [0, 1, 0]);
    expect(brush.colors.length).toBe(brush.vertices.length);
    expect(Array.from(brush.colors.slice(0, 18))).toEqual(Array.from(first));
    expect(vertex(brush.colors, 1, 0)).toEqual(blue);
    expect(vertex(brush.colors, 1, 4)).toEqual([0, 1, 0]);
    brush.clear();
    brush.add({ x: 3, y: 0 }, 0, 2, up);
    brush.add({ x: 4, y: 0 }, 1, 2, up);
    expect(vertex(brush.colors, 0, 0)).toEqual([1, 0, 0]);
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
    expect(vertex(brush.vertices, 1, 0)).toEqual(vertex(before, 0, 2));
    expect(vertex(brush.vertices, 1, 4)).toEqual([2, 2, 0]);
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
    expect(vertex(brush.vertices, 1, 0)).toEqual([1, -1, 0]);
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
      const capacity = brush.vertices.length / 18;
      expect(brush.next).toBe(index % capacity);
      expect(Array.from({ length: brush.count }, (_, slot) => vertex(brush.vertices, slot, 2)[0]))
        .toEqual(Array.from({ length: index }, (_, offset) => offset + 1));
    }
    expect(brush.full).toBe(true);
    expect(brush.vertices.length).toBe(9 * 18);
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
    expect(vertex(brush.vertices, 1, 0)[0]).toBe(10);
    expect(Array.from(brush.vertices.slice(0, 18))).toEqual(Array.from(before));
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
    expect(vertex(brush.vertices, 1, 0)[0]).toBe(3);
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
    expect(vertex(brush.vertices, 0, 0)[0]).toBe(10);
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
    expect(huge.vertices.length).toBe(18);
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

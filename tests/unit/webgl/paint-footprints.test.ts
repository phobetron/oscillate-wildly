import { PAINT_SLOT_FLOATS, PAINT_CAP_OFFSET, ribbonVertex, capVertex, paintVertex } from './geometry';
import { describe, expect, it } from '@rstest/core';
import { createRibbonBrush } from '../../../src/webgl/ribbon';

const up = { x: 0, y: 1, z: 0 };
const flat = { axisX: { x: 2, y: 0, z: 0 }, axisY: { x: 0, y: 3, z: 0 } };
const visibleCaps = (vertices: Float32Array, count: number): number[] =>
  Array.from({ length: count }, (_, slot) => slot).filter((slot) => {
    const a = capVertex(vertices, slot, 0);
    const b = capVertex(vertices, slot, 1);
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
        const cap = [0, 1, 2].map((index) => capVertex(brush.footprints.vertices, slot, index).slice(0, 3));
        const capNormal = normal(...cap as [number[], number[], number[]]);
        const triangle = slot === 0 ? [0, 1, 2] : [3, 4, 5];
        const stripNormal = normal(...triangle.map((index) => ribbonVertex(brush.vertices, 0, index)) as [number[], number[], number[]]);
        expect(Math.abs(capNormal.reduce((sum, value, index) => sum + value * stripNormal[index], 0))).toBeCloseTo(1, 6);
        expect(Math.hypot(...cap[1].map((value, index) => value - cap[0][index])) / 2).toBeCloseTo(2, 6);
        expect(Math.hypot(...cap[2].map((value, index) => value - cap[0][index])) / 2).toBeCloseTo(Math.sqrt(10), 6);
        const x = cap[1].map((value, index) => (value - cap[0][index]) / 2);
        const y = cap[2].map((value, index) => (value - cap[0][index]) / 2);
        expect(x.reduce((sum, value, index) => sum + value * y[index], 0)).toBeCloseTo(2, 6);
        expect(capVertex(brush.footprints.vertices, slot, 0).slice(3, 6)).toEqual(slot === 0 ? [1, 0, 0] : [0, 1, 0]);
        expect(capVertex(brush.footprints.vertices, slot, 0)[8]).toBe(shape === 'circle' ? 1 : 0);
      }
      const finalized = brush.footprints.vertices.slice(0, PAINT_SLOT_FLOATS);
      const before = brush.footprints.vertices.slice();
      brush.add({ x: 20, y: 10, z: -20 }, 1, 20, { x: 1, y: 0, z: 0 }, [0, 0, 1], flat);
      expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
      brush.add({ x: 4, y: 3, z: -1 }, 2, 4, up, undefined, footprint);
      expect(Array.from(brush.footprints.vertices.slice(0, PAINT_SLOT_FLOATS))).toEqual(Array.from(finalized));
      expect(brush.footprints.dirtyPreviousSlot).toBe(1);
    }
  });

  it('keeps incoming footprint axes for a degenerate connecting triangle', () => {
    const brush = createRibbonBrush();
    const alongPath = { x: 1, y: 0, z: 0 };
    brush.add({ x: 0, y: 0 }, 0, 2, alongPath, undefined, flat);
    const start = brush.footprints.vertices.slice(0, PAINT_SLOT_FLOATS);
    brush.add({ x: 10, y: 0 }, 1, 2, alongPath, undefined, flat);
    expect(Array.from(brush.footprints.vertices.slice(0, PAINT_SLOT_FLOATS))).toEqual(Array.from(start));
    expect(capVertex(brush.footprints.vertices, 1, 0).slice(0, 3)).toEqual([8, -3, 0]);
    expect(brush.footprints.dirtyPreviousSlot).toBe(0);
  });

  it('keeps only start and current end caps, preserving connectors and captured styles', () => {
    const brush = createRibbonBrush(6);
    brush.add({ x: 0, y: 0 }, 0, 4, up, [1, 0, 0], flat);
    const start = brush.footprints.vertices.slice(0, PAINT_SLOT_FLOATS);
    expect(brush.footprints.dirtyPreviousSlot).toBeUndefined();
    brush.add({ x: 10, y: 0 }, 1, 4, up, [0, 1, 0], flat);
    const connector = brush.footprints.vertices.slice(PAINT_SLOT_FLOATS, 162);
    expect(brush.footprints.dirtyPreviousSlot).toBe(0);
    brush.add({ x: 20, y: 0 }, 2, 6, up, [0, 0, 1], { ...flat, shape: 'square' });
    expect(visibleCaps(brush.footprints.vertices, 3)).toEqual([0, 2]);
    expect(brush.footprints.dirtyPreviousSlot).toBe(1);
    expect(brush.footprints.dirtySlot).toBe(2);
    expect(Array.from(brush.footprints.vertices.slice(0, PAINT_SLOT_FLOATS))).toEqual(Array.from(start));
    expect(Array.from(brush.footprints.vertices.slice(PAINT_SLOT_FLOATS, 162))).toEqual(Array.from(connector));
    for (let index = 0; index < 6; index += 1) {
      expect(capVertex(brush.footprints.vertices, 1, index)).toEqual([10, 0, 0, 0, 1, 0, 0, 0, 0]);
    }
    expect(capVertex(brush.footprints.vertices, 2, 0).slice(3)).toEqual([0, 0, 1, -1, -1, 0]);
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
        expect(paintVertex(brush.footprints.vertices, 0, index))
          .toEqual([10, 20, 30, 0, 1, 0, 0, 0, 0]);
      }
      const corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
      corners.forEach(([x, y], index) => {
        expect(capVertex(brush.footprints.vertices, 0, index))
          .toEqual([10 + x * 2, 20 + y * 3, 30, 0, 1, 0, x, y, shape === 'circle' ? 1 : 0]);
      });
      brush.add({ x: 11, y: 20, z: 30 }, 1, 4, up, [0, 0, 1], { ...flat, shape });
      expect(brush.footprints.count).toBe(2);
      expect(brush.footprints.dirtySlot).toBe(1);
      expect(brush.footprints.revision).toBe(2);
      for (let index = 0; index < 6; index += 1) {
        const packed = paintVertex(brush.footprints.vertices, 1, index);
        expect(packed).toEqual([...ribbonVertex(brush.vertices, 0, index), ...ribbonVertex(brush.colors, 0, index), 0, 0, 0]);
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
    expect(capVertex(brush.footprints.vertices, 0, 0).slice(3, 6)).toEqual([1, 0, 0]);
    for (let index = 0; index < 6; index += 1) {
      const packed = paintVertex(brush.footprints.vertices, 3, index);
      expect(packed.slice(0, 3)).toEqual(ribbonVertex(brush.vertices, 1, index));
      expect(packed.slice(3)).toEqual([0, 1, 0, 0, 0, 0]);
    }
    // Stroke starts have no connecting area, so lifting does not add a bridge.
    for (let index = 0; index < 6; index += 1) {
      expect(paintVertex(brush.footprints.vertices, 2, index).slice(0, 3))
        .toEqual([0, -4, 0]);
    }
    expect(capVertex(brush.footprints.vertices, 3, 0).slice(3, 6)).toEqual([0, 1, 0]);
  });

  it('keeps 3D footprint planes and captured styles frozen on redraws and later paint', () => {
    const brush = createRibbonBrush();
    const footprint = { axisX: { x: 0, y: 2, z: 0 }, axisY: { x: 0, y: 0, z: 3 } };
    const color: [number, number, number] = [1, 0, 0];
    brush.add({ x: 5, y: 0, z: 0 }, 0, 4, up, color, footprint);
    const before = brush.footprints.vertices.slice();
    expect(capVertex(before, 0, 0)).toEqual([5, -2, -3, 1, 0, 0, -1, -1, 1]);
    expect(capVertex(before, 0, 5)).toEqual([5, 2, 3, 1, 0, 0, 1, 1, 1]);
    footprint.axisX.y = 20;
    color[0] = 0;
    brush.add({ x: 99, y: 0 }, 0, 20, up, [0, 1, 0], { ...flat, shape: 'square' });
    brush.add({ x: 5, y: 0 }, 1, 20, up, [0, 1, 0], flat);
    expect(brush.footprints.count).toBe(1);
    expect(brush.footprints.revision).toBe(1);
    expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
    brush.add({ x: 6, y: 0 }, 2, 4, up, [0, 1, 0], { ...flat, shape: 'square' });
    expect(Array.from(brush.footprints.vertices.slice(0, PAINT_CAP_OFFSET))).toEqual(Array.from(before.slice(0, PAINT_CAP_OFFSET)));
    expect(capVertex(brush.footprints.vertices, 0, 0).slice(3)).toEqual([1, 0, 0, -1, -1, 1]);
    expect(capVertex(brush.footprints.vertices, 0, 0).slice(0, 3)).toEqual([2, -2, 0]);
    expect(capVertex(brush.footprints.vertices, 1, 0).slice(3)).toEqual([0, 1, 0, -1, -1, 0]);
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
    expect(brush.footprints.vertices.length).toBe(5 * PAINT_SLOT_FLOATS);
    for (let slot = 0; slot < 5; slot += 1) {
      expect(capVertex(brush.footprints.vertices, slot, 0)[0]).toBe(slot * 10 - 2);
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
    expect(capVertex(buffer, 0, 0)[0]).toBe(198);
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

});

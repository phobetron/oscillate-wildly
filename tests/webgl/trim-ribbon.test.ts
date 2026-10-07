import { describe, expect, it } from '@rstest/core';
import { createTrimmingPaintBrush } from '../../src/webgl/ribbon';

const side = { x: 0, y: 1, z: 0 };
const flat = { axisX: { x: 2, y: 0, z: 0 }, axisY: { x: 1, y: 3, z: 0 } };
const vertex = (vertices: Float32Array, slot: number, index: number): number[] =>
  Array.from(vertices.slice(slot * 108 + index * 9, slot * 108 + index * 9 + 9));
const capVisible = (vertices: Float32Array, slot: number): boolean =>
  vertex(vertices, slot, 6).slice(0, 3).some((value, axis) => value !== vertex(vertices, slot, 7)[axis]);
const normal = (a: number[], b: number[], c: number[]): number[] => {
  const u = b.map((value, index) => value - a[index]);
  const v = c.map((value, index) => value - a[index]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return n.map((value) => value / Math.hypot(...n));
};

describe('trimming world-space paint', () => {
  it('wraps repeatedly with stable allocation, chronological centers, and at most four changed slots', () => {
    const brush = createTrimmingPaintBrush(5);
    let fullBuffer: Float32Array | undefined;
    for (let i = 0; i < 31; i += 1) {
      const before = brush.footprints.vertices.slice();
      brush.add({ x: i * 10, y: 0 }, i, 4, side, [1, 0, 0], flat);
      const fp = brush.footprints;
      expect(fp.count).toBe(Math.min(i + 1, 5));
      expect(fp.dirtySlots!.length).toBeLessThanOrEqual(4);
      if (i === 4) fullBuffer = fp.vertices;
      if (i >= 4) expect(fp.vertices).toBe(fullBuffer);
      for (let slot = 0; slot < Math.min(before.length / 108, fp.count); slot += 1) {
        if (!fp.dirtySlots!.includes(slot)) {
          expect(Array.from(fp.vertices.slice(slot * 108, (slot + 1) * 108)))
            .toEqual(Array.from(before.slice(slot * 108, (slot + 1) * 108)));
        }
      }
      const centers = Array.from({ length: fp.count }, (_, offset) => {
        const slot = (fp.start! + offset) % 5;
        return (vertex(fp.vertices, slot, 6)[0] + vertex(fp.vertices, slot, 11)[0]) / 2;
      });
      expect(centers).toEqual(Array.from({ length: fp.count }, (_, offset) => (i - fp.count + 1 + offset) * 10));
      for (let offset = 0; offset < fp.count; offset += 1) {
        expect(capVisible(fp.vertices, (fp.start! + offset) % 5)).toBe(offset === 0 || offset === fp.count - 1);
      }
      expect(vertex(fp.vertices, fp.start!, 0).slice(0, 3)).toEqual(vertex(fp.vertices, fp.start!, 1).slice(0, 3));
    }
    expect(brush.full).toBe(true);
    const revision = brush.footprints.revision;
    brush.clear();
    expect(brush.footprints.vertices).toBe(fullBuffer);
    expect(brush.footprints.count).toBe(0);
    expect(brush.footprints.start).toBe(0);
    expect(brush.footprints.dirtySlots).toEqual([]);
    expect(brush.footprints.revision).toBe(revision + 1);
    brush.add({ x: 99, y: 0 }, 0, 4, side, undefined, flat);
    expect(capVisible(brush.footprints.vertices, 0)).toBe(true);
  });

  it('supports a moving standalone dab at capacity one and both connector endpoints at capacity two', () => {
    for (const limit of [1, 2]) {
      const brush = createTrimmingPaintBrush(limit);
      for (let i = 0; i < 9; i += 1) {
        brush.add({ x: i * 10, y: 0 }, i, 4, side, undefined, flat);
        const fp = brush.footprints;
        for (let slot = 0; slot < fp.count; slot += 1) expect(capVisible(fp.vertices, slot)).toBe(true);
        const head = (fp.start! + fp.count - 1) % limit;
        expect(vertex(fp.vertices, head, 6)[0]).toBe(i * 10 - 3);
        if (limit === 1) {
          expect(vertex(fp.vertices, 0, 0).slice(0, 3)).toEqual([i * 10, 0, 0]);
          expect(vertex(fp.vertices, 0, 1).slice(0, 3)).toEqual([i * 10, 0, 0]);
        } else if (i > 0) {
          expect(vertex(fp.vertices, head, 0).slice(0, 3)).toEqual([(i - 1) * 10, -2, 0]);
          expect(vertex(fp.vertices, head, 2).slice(0, 3)).toEqual([i * 10, -2, 0]);
        }
      }
    }
  });

  it('restores trimmed tail caps from original axes, RGB and shape aligned to the outgoing first triangle', () => {
    const brush = createTrimmingPaintBrush(3);
    const footprint = { ...flat, shape: 'square' as const };
    const color: [number, number, number] = [0, 1, 0];
    brush.add({ x: 0, y: 0 }, 0, 2, side, undefined, flat);
    brush.add({ x: 3, y: 1, z: 5 }, 1, 4, side, color, footprint);
    footprint.axisX = { x: 100, y: 0, z: 0 };
    color[1] = 0;
    brush.add({ x: 9, y: 4, z: -2 }, 2, 6, { x: 1, y: 1, z: 1 }, [0, 0, 1], flat);
    expect(capVisible(brush.footprints.vertices, 1)).toBe(false);
    brush.add({ x: 13, y: 0, z: 3 }, 3, 2, side, undefined, flat);
    const v = brush.footprints.vertices;
    expect(brush.footprints.start).toBe(1);
    const cap = [6, 7, 8].map((index) => vertex(v, 1, index).slice(0, 3));
    const capNormal = normal(...cap as [number[], number[], number[]]);
    const stripNormal = normal(...[0, 1, 2].map((index) => vertex(v, 2, index).slice(0, 3)) as [number[], number[], number[]]);
    expect(Math.abs(capNormal.reduce((sum, value, index) => sum + value * stripNormal[index], 0))).toBeCloseTo(1, 6);
    expect(Math.hypot(...cap[1].map((value, index) => value - cap[0][index])) / 2).toBeCloseTo(2, 6);
    expect(Math.hypot(...cap[2].map((value, index) => value - cap[0][index])) / 2).toBeCloseTo(Math.sqrt(10), 6);
    expect(vertex(v, 1, 6).slice(3)).toEqual([0, 1, 0, -1, -1, 0]);
  });

  it('preserves gaps and ignores redraws/stationary deposits without eviction or revision changes', () => {
    const brush = createTrimmingPaintBrush(3);
    brush.add({ x: 0, y: 0 }, 0, 2, side, undefined, flat);
    brush.add({ x: 10, y: 0 }, 1, 2, side, undefined, flat);
    brush.breakStroke();
    brush.add({ x: 20, y: 0 }, 2, 2, side, undefined, flat);
    const before = brush.footprints.vertices.slice();
    for (const [x, time] of [[90, 2], [20, 3], [20, 4]]) {
      brush.add({ x, y: 0 }, time, 2, side, undefined, flat);
      expect(brush.footprints.revision).toBe(3);
      expect(brush.footprints.start).toBe(0);
      expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
    }
    brush.add({ x: 30, y: 0 }, 4, 2, side, undefined, flat);
    expect(brush.footprints.revision).toBe(3);
    brush.add({ x: 30, y: 0 }, 5, 2, side, undefined, flat);
    expect(brush.footprints.start).toBe(1);
    expect(vertex(brush.footprints.vertices, 2, 0).slice(0, 3)).toEqual([20, 0, 0]);
    expect(capVisible(brush.footprints.vertices, 1)).toBe(true);
    expect(capVisible(brush.footprints.vertices, 2)).toBe(true);
    brush.add({ x: 40, y: 0 }, 6, 0, side, undefined, flat);
    brush.add({ x: 50, y: 0 }, 7, 2, side, undefined, flat);
    expect(vertex(brush.footprints.vertices, 1, 0).slice(0, 3)).toEqual([50, 0, 0]);
    brush.add({ x: 60, y: 0 }, 8, 2, side, undefined, flat);
    expect(vertex(brush.footprints.vertices, 2, 0).slice(0, 3)).toEqual([50, -1, 0]);
  });

  it('validates before mutation including when full, and grows only as samples arrive', () => {
    for (const limit of [0, -1, 1.5, Infinity, NaN]) expect(() => createTrimmingPaintBrush(limit)).toThrow(RangeError);
    const huge = createTrimmingPaintBrush(Number.MAX_SAFE_INTEGER);
    expect(huge.footprints.vertices.length).toBe(0);
    huge.add({ x: 0, y: 0 }, 0, 2, side, undefined, flat);
    expect(huge.footprints.vertices.length).toBe(108);
    const brush = createTrimmingPaintBrush(1);
    brush.add({ x: 0, y: 0 }, 0, 2, side, undefined, flat);
    const before = brush.footprints.vertices.slice();
    for (const call of [
      () => brush.add({ x: NaN, y: 0 }, 1, 2, side),
      () => brush.add({ x: 1, y: 0 }, Infinity, 2, side),
      () => brush.add({ x: 1, y: 0 }, 1, -1, side),
      () => brush.add({ x: 1, y: 0 }, 1, 2, { x: 0, y: 0, z: 0 }),
      () => brush.add({ x: 1, y: 0 }, 1, 2, side, [2, 0, 0]),
      () => brush.add({ x: 1, y: 0 }, 1, 2, side, undefined, { ...flat, axisY: flat.axisX }),
    ]) expect(call).toThrow(RangeError);
    expect(brush.footprints.revision).toBe(1);
    expect(Array.from(brush.footprints.vertices)).toEqual(Array.from(before));
  });
});

describe('trimming smooth normals', () => {
  it('removes discarded segment contributions and reports every changed normal slot', () => {
    const brush = createTrimmingPaintBrush(5);
    const reference = createTrimmingPaintBrush(5);
    const points = [
      { x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 4 }, { x: 5, y: 0, z: -1 },
      { x: 8, y: 2, z: 3 }, { x: 10, y: 1, z: 1 }, { x: 13, y: 0, z: 2 },
    ];
    points.slice(0, 5).forEach((point, i) => brush.add(point, i, 2, side, undefined, flat));
    const allocated = brush.footprints.normals;
    const before = allocated!.slice();
    brush.add(points[5], 5, 2, side, undefined, flat);
    points.slice(1).forEach((point, i) => reference.add(point, i, 2, side, undefined, flat));
    expect(brush.footprints.normals).toBe(allocated);
    expect(brush.footprints.dirtySlots!.length).toBeLessThanOrEqual(4);
    expect(brush.footprints.dirtySlots).toContain(2);
    for (let i = 0; i < 5; i += 1) {
      const physical = (brush.footprints.start! + i) % 5;
      const actual = Array.from(allocated!.slice(physical * 36, (physical + 1) * 36));
      const expected = Array.from(reference.footprints.normals!.slice(i * 36, (i + 1) * 36));
      for (let vertex = 0; vertex < 12; vertex += 1) {
        const dot = [0, 1, 2].reduce((sum, axis) => sum
          + actual[vertex * 3 + axis] * expected[vertex * 3 + axis], 0);
        // The renderer is two-sided; a whole normal's sign is immaterial.
        expect(Math.abs(dot)).toBeCloseTo(1, 6);
      }
      if (!brush.footprints.dirtySlots!.includes(physical)) {
        expect(actual).toEqual(Array.from(before.slice(physical * 36, (physical + 1) * 36)));
      }
    }
    brush.clear();
    expect(brush.footprints.normals).toBe(allocated);
    brush.add({ x: 99, y: 0 }, 0, 2, side, undefined, flat);
    expect(Array.from(allocated!.slice(0, 36))).toEqual(Array.from({ length: 12 }, () => [0, 0, 1]).flat());
  });

  it('preserves independent strokes when eviction exposes a stroke boundary', () => {
    const brush = createTrimmingPaintBrush(3);
    brush.add({ x: 0, y: 0 }, 0, 2, side, undefined, flat);
    brush.add({ x: 2, y: 0, z: 4 }, 1, 2, side, undefined, flat);
    const endpoint = Array.from(brush.footprints.normals!.slice(36, 72));
    brush.breakStroke();
    brush.add({ x: 2, y: 0, z: 4 }, 2, 2, side, undefined, flat);
    brush.add({ x: 5, y: 0, z: 4 }, 3, 2, side, undefined, flat);
    const tail = Array.from(brush.footprints.normals!.slice(36, 72));
    // Once its incoming segment is gone, the isolated tail is a standalone dab.
    expect(tail).not.toEqual(endpoint);
    tail.forEach((value, index) => expect(value).toBeCloseTo(index % 3 === 2 ? 1 : 0, 6));
  });
});

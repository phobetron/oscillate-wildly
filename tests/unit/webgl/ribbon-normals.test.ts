import { PAINT_VERTEX_COMPONENTS, PAINT_SLOT_FLOATS, paintNormal } from './geometry';
import { describe, expect, it } from '@rstest/core';
import { createRibbonBrush } from '../../../src/webgl/ribbon';

const up = { x: 0, y: 1, z: 0 };
const flat = { axisX: { x: 2, y: 0, z: 0 }, axisY: { x: 0, y: 3, z: 0 } };
describe('smooth ribbon footprint normals', () => {
  const area = (values: Float32Array, slot: number, vertex: number): number[] => {
    const offset = slot * PAINT_SLOT_FLOATS + vertex * PAINT_VERTEX_COMPONENTS;
    const a = [0, 1, 2].map((axis) => values[offset + PAINT_VERTEX_COMPONENTS + axis] - values[offset + axis]);
    const b = [0, 1, 2].map((axis) => values[offset + 2 * PAINT_VERTEX_COMPONENTS + axis] - values[offset + axis]);
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  };
  it('weights shared strip corners by triangle area across the diagonal and adjoining segments', () => {
    const brush = createRibbonBrush(5);
    brush.add({ x: 0, y: 0 }, 0, 2, up, undefined, flat);
    brush.add({ x: 3, y: 0, z: 1 }, 1, 4, up, undefined, flat);
    brush.add({ x: 5, y: 1, z: 3 }, 2, 3, { x: 0, y: 1, z: 1 }, undefined, flat);
    const { vertices, normals } = brush.footprints;
    expect(normals!.length).toBe(vertices.length / 3);
    expect(paintNormal(normals!, 2, 1)).toEqual(paintNormal(normals!, 2, 3));
    expect(paintNormal(normals!, 2, 2)).toEqual(paintNormal(normals!, 2, 5));
    expect(paintNormal(normals!, 1, 2)).toEqual(paintNormal(normals!, 2, 0));
    expect(paintNormal(normals!, 1, 4)).toEqual(paintNormal(normals!, 2, 1));
    const faces = [area(vertices, 1, 0), area(vertices, 1, 3), area(vertices, 2, 0)];
    const weighted = [0, 1, 2].map((axis) => faces.reduce((sum, face) => sum + face[axis], 0));
    const length = Math.hypot(...weighted);
    const sign = weighted.reduce((sum, value, axis) => sum + value * paintNormal(normals!, 1, 2)[axis], 0) < 0 ? -1 : 1;
    paintNormal(normals!, 1, 2).forEach((value, axis) => expect(value).toBeCloseTo(sign * weighted[axis] / length, 6));
    expect(paintNormal(normals!, 2, 0)).not.toEqual(paintNormal(normals!, 2, 1));
    expect(brush.footprints.dirtyPreviousSlot).toBe(1);
    expect(paintNormal(normals!, 2, 8)).toEqual(paintNormal(normals!, 2, 9));
    expect(paintNormal(normals!, 2, 7)).toEqual(paintNormal(normals!, 2, 10));
    // End caps interpolate the same endpoint normals across their width.
    expect(paintNormal(normals!, 2, 6)).not.toEqual(paintNormal(normals!, 2, 11));
    for (let vertex = 0; vertex < 36; vertex += 1) {
      expect(Math.hypot(...paintNormal(normals!, Math.floor(vertex / 12), vertex % 12))).toBeCloseTo(1, 6);
    }
  });

  it('uses actual incoming strip geometry after a sample omits its footprint', () => {
    const brush = createRibbonBrush(3);
    brush.add({ x: 0, y: 0 }, 0, 2, up, undefined, flat);
    brush.add({ x: 3, y: 0, z: 1 }, 1, 4, up);
    brush.add({ x: 5, y: 1, z: 3 }, 2, 3, { x: 0, y: 1, z: 1 }, undefined, flat);
    const { vertices, normals } = brush.footprints;
    const faces = [area(vertices, 1, 0), area(vertices, 1, 3)];
    const contributions = [faces[0], faces[0].map((value, axis) => value + faces[1][axis]),
      faces[0].map((value, axis) => value + faces[1][axis]), faces[1]];
    [0, 1, 2, 1, 3, 2].forEach((corner, vertex) => {
      const expected = contributions[corner];
      const length = Math.hypot(...expected);
      paintNormal(normals!, 1, vertex).forEach((value, axis) => expect(value).toBeCloseTo(expected[axis] / length, 6));
    });
    expect(paintNormal(normals!, 1, 0)).not.toEqual(paintNormal(normals!, 1, 4));
  });

  it('preserves winding when a sharp bend has opposing face hemispheres', () => {
    const brush = createRibbonBrush(3);
    brush.add({ x: -0.8, y: 0, z: 1 }, 0, 2, up, undefined, flat);
    brush.add({ x: 0, y: 0, z: -1 }, 1, 2, up, undefined, flat);
    brush.add({ x: 0.8, y: 0, z: 1 }, 2, 2, up, undefined, flat);
    const { vertices, normals } = brush.footprints;
    const a = area(vertices, 1, 0);
    const b = area(vertices, 2, 0);
    expect(a.reduce((sum, value, axis) => sum + value * b[axis], 0)).toBeLessThan(0);
    const weighted = [0, 1, 2].map((axis) => 2 * a[axis] + b[axis]);
    const length = Math.hypot(...weighted);
    paintNormal(normals!, 1, 2).forEach((value, axis) => expect(value).toBeCloseTo(weighted[axis] / length, 6));
    expect(paintNormal(normals!, 1, 2)).toEqual(paintNormal(normals!, 2, 0));
    expect(paintNormal(normals!, 1, 4)).toEqual(paintNormal(normals!, 2, 1));
  });

  it('does not join coincident disconnected strokes and supplies stable degenerate normals', () => {
    const brush = createRibbonBrush(8);
    brush.add({ x: 0, y: 0 }, 0, 2, up, undefined, flat);
    brush.add({ x: 4, y: 0 }, 1, 2, up, undefined, flat);
    const before = brush.footprints.normals!.slice(0, 72);
    brush.breakStroke();
    brush.add({ x: 4, y: 0 }, 2, 2, up, undefined, flat);
    brush.add({ x: 4, y: 0, z: 4 }, 3, 2, up, undefined, flat);
    expect(Array.from(brush.footprints.normals!.slice(0, 72))).toEqual(Array.from(before));
    expect(paintNormal(brush.footprints.normals!, 3, 0)).not.toEqual(paintNormal(before, 1, 2));
    brush.breakStroke();
    brush.add({ x: 0, y: 0 }, 4, 2, { x: 1, y: 0, z: 0 }, undefined, flat);
    brush.add({ x: 4, y: 0 }, 5, 2, { x: 1, y: 0, z: 0 }, undefined, flat);
    for (let vertex = 0; vertex < 12; vertex += 1) {
      expect(paintNormal(brush.footprints.normals!, 5, vertex)).toEqual([0, 0, 1]);
    }
  });
});

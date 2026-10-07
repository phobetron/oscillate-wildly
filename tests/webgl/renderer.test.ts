import { describe, expect, it } from '@rstest/core';
import { createMarkerRenderer } from '../../src/webgl/renderer';
import type { PaintFootprints } from '../../src/webgl/ribbon';
import { createRibbonBrush } from '../../src/webgl/ribbon';

const fakeGL = () => {
  const uploads: { offset: number; data: Float32Array }[] = [];
  const draws: { first: number; count: number }[] = [];
  const allocations: number[] = [];
  const normalProjections: Float32Array[] = [];
  const methods: Record<string, unknown> = {
    getExtension: () => null,
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: () => ({}),
    bufferData: (_target: number, data: number | Float32Array) => {
      allocations.push(typeof data === 'number' ? data : data.byteLength);
    },
    bufferSubData: (_target: number, offset: number, data: Float32Array) => {
      uploads.push({ offset, data: new Float32Array(data) });
    },
    drawArrays: (_mode: number, first: number, count: number) => { draws.push({ first, count }); },
    uniformMatrix3fv: (_location: unknown, _transpose: boolean, matrix: Float32Array) => { normalProjections.push(new Float32Array(matrix)); },
  };
  const gl = new Proxy(methods, {
    get: (target, key: string) => {
      if (key in target) return target[key];
      if (key.startsWith('create')) return () => ({});
      if (key === key.toUpperCase()) return 1;
      return () => {};
    },
  }) as unknown as WebGLRenderingContext;
  return { gl, uploads, draws, allocations, normalProjections };
};

const geometry = (capacity = 8): PaintFootprints => ({
  vertices: new Float32Array(capacity * 108),
  count: capacity,
  revision: 1,
  dirtySlot: undefined,
  dirtyPreviousSlot: undefined,
});
const viewport = { width: 100, height: 100 };
const projection = new Float32Array(16);

const setup = () => {
  const fake = fakeGL();
  const renderer = createMarkerRenderer(fake.gl);
  const initial = geometry();
  renderer.drawPaintFootprints(initial, viewport, projection);
  fake.uploads.length = 0;
  fake.draws.length = 0;
  return { ...fake, renderer, initial };
};

describe('paint footprint renderer', () => {
  it('resizes normal storage after growing geometry while normals were omitted', () => {
    const { gl, allocations } = fakeGL();
    const renderer = createMarkerRenderer(gl);
    renderer.drawPaintFootprints({ ...geometry(2), normals: new Float32Array(2 * 36) }, viewport, projection);
    const larger = geometry(8);
    renderer.drawPaintFootprints(larger, viewport, projection);
    const allocated = allocations.length;
    renderer.drawPaintFootprints({ ...larger, normals: new Float32Array(8 * 36) }, viewport, projection);
    expect(allocations.slice(allocated)).toEqual([8 * 36 * 4]);
  });

  it('rotates normals without introducing orthographic zoom, aspect or clipping-depth scale', () => {
    const { gl, uploads, normalProjections } = fakeGL();
    const renderer = createMarkerRenderer(gl);
    const initial = { ...geometry(), normals: new Float32Array(8 * 36) };
    const matrix = new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, -0.1, 0, 0, 0, 0, 1]);
    renderer.drawPaintFootprints(initial, viewport, matrix);
    expect(Array.from(normalProjections.at(-1)!, (value) => value + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    uploads.length = 0;
    matrix[0] = 10; matrix[5] = 20; matrix[10] = -0.05;
    renderer.drawPaintFootprints(initial, viewport, matrix);
    expect(Array.from(normalProjections.at(-1)!, (value) => value + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(uploads).toEqual([]);
  });

  it('uploads normal blocks alongside disjoint dirty vertex blocks without reallocating stable storage', () => {
    const { gl, uploads, allocations } = fakeGL();
    const renderer = createMarkerRenderer(gl);
    const initial = { ...geometry(), normals: new Float32Array(8 * 36) };
    renderer.drawPaintFootprints(initial, viewport, projection);
    const allocated = allocations.length;
    uploads.length = 0;
    renderer.drawPaintFootprints({ ...initial, revision: 2, dirtySlots: [0, 1, 7] }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([
      [0, 216], [7 * 108 * 4, 108], [0, 72], [7 * 36 * 4, 36],
    ]);
    expect(allocations.length).toBe(allocated);
  });

  it('uploads production normals in the same dirty ranges and reuses them on camera/lighting redraws', () => {
    const { gl, uploads, allocations } = fakeGL();
    const renderer = createMarkerRenderer(gl);
    const brush = createRibbonBrush(8);
    const footprint = { axisX: { x: 0.2, y: 0, z: 0 }, axisY: { x: 0, y: 0.2, z: 0 } };
    for (let index = 0; index < 4; index++) {
      brush.add({ x: index, y: 0, z: index % 2 }, index, 0.4, { x: 0, y: 1, z: 0 }, [0.2, 0.6, 1], footprint);
    }
    renderer.drawPaintFootprints(brush.footprints, viewport, projection);
    const allocated = allocations.length;
    uploads.length = 0;
    renderer.setLighting(true, [1, 1, 2]);
    renderer.drawPaintFootprints(brush.footprints, viewport, projection);
    expect(uploads).toEqual([]);
    brush.add({ x: 4, y: 0, z: 0 }, 4, 0.4, { x: 0, y: 1, z: 0 }, [0.2, 0.6, 1], footprint);
    renderer.drawPaintFootprints(brush.footprints, viewport, projection);
    // Capacity growth reallocates both storage buffers together.
    expect(uploads.some(({ data }) => data.length === brush.footprints.normals!.length)).toBe(true);
    expect(allocations.length).toBe(allocated + 2);
  });

  it('rejects mismatched and nonfinite normals before submitting geometry', () => {
    const { renderer, uploads, initial } = setup();
    expect(() => renderer.drawPaintFootprints({ ...initial, normals: new Float32Array(3) }, viewport, projection)).toThrow(RangeError);
    const normals = new Float32Array(8 * 36);
    normals[7 * 36] = NaN;
    expect(() => renderer.drawPaintFootprints({ ...initial, normals }, viewport, projection)).toThrow(RangeError);
    expect(uploads).toEqual([]);
  });
  it('draws wrapped samples oldest first in two physical ranges', () => {
    const { renderer, draws, initial } = setup();
    renderer.drawPaintFootprints({ ...initial, start: 6 }, viewport, projection);
    expect(draws).toEqual([{ first: 72, count: 24 }, { first: 0, count: 72 }]);
  });

  it('merges unsorted adjacent dirty slots without uploading intervening ring history', () => {
    const { renderer, uploads, allocations, initial } = setup();
    const allocated = allocations.length;
    renderer.drawPaintFootprints({ ...initial, revision: 2, dirtySlots: [7, 1, 0, 7] }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[0, 216], [7 * 108 * 4, 108]]);
    expect(allocations.length).toBe(allocated);
  });

  it('normalizes the legacy dirty slot pair across wrap', () => {
    const { renderer, uploads, initial } = setup();
    renderer.drawPaintFootprints({ ...initial, revision: 2, dirtySlot: 0, dirtyPreviousSlot: 7 }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[0, 108], [7 * 108 * 4, 108]]);
  });

  it('prefers dirtySlots over the legacy pair', () => {
    const { renderer, uploads, initial } = setup();
    renderer.drawPaintFootprints({ ...initial, revision: 2, dirtySlots: [4], dirtySlot: 0, dirtyPreviousSlot: 7 }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[4 * 108 * 4, 108]]);
  });

  it('uploads all storage after skipped revisions or missing dirty metadata', () => {
    const { renderer, uploads, initial } = setup();
    renderer.drawPaintFootprints({ ...initial, revision: 3, dirtySlots: [0] }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[0, 8 * 108]]);
    uploads.length = 0;
    renderer.drawPaintFootprints({ ...initial, revision: 4 }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[0, 8 * 108]]);
  });

  it('uploads replacement backing storage and a recreated renderer in full', () => {
    const { renderer, gl, uploads, initial } = setup();
    renderer.drawPaintFootprints({ ...initial, vertices: new Float32Array(initial.vertices), dirtySlots: [0] }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[0, 8 * 108]]);
    uploads.length = 0;
    renderer.dispose();
    createMarkerRenderer(gl).drawPaintFootprints({ ...initial, start: 6, dirtySlots: [0] }, viewport, projection);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[0, 8 * 108]]);
  });

  it('redraws camera and lighting changes without geometry uploads', () => {
    const { renderer, uploads, initial } = setup();
    renderer.setLighting(true, [1, 1, 2]);
    renderer.drawPaintFootprints({ ...initial, start: 2, dirtySlots: [0, 7] }, viewport, new Float32Array(16).fill(1));
    expect(uploads).toEqual([]);
  });

  it('preserves the default contiguous draw and uploads adjacent legacy slots', () => {
    const { renderer, uploads, draws, initial } = setup();
    renderer.drawPaintFootprints({ ...initial, count: 3, revision: 2, dirtySlot: 2, dirtyPreviousSlot: 1 }, viewport, projection);
    expect(draws).toEqual([{ first: 0, count: 36 }]);
    expect(uploads.map(({ offset, data }) => [offset, data.length])).toEqual([[108 * 4, 216]]);
  });

  it('rejects invalid start and dirty slots before uploading', () => {
    const { renderer, uploads, initial } = setup();
    for (const start of [-1, 8, 0.5, NaN]) {
      expect(() => renderer.drawPaintFootprints({ ...initial, start }, viewport, projection)).toThrow(RangeError);
    }
    for (const slot of [-1, 8, 0.5, NaN]) {
      expect(() => renderer.drawPaintFootprints({ ...initial, dirtySlots: [slot] }, viewport, projection)).toThrow(RangeError);
    }
    expect(uploads).toEqual([]);
  });

  it('validates disjoint uploaded slots before submitting any of them', () => {
    const { renderer, uploads, initial } = setup();
    initial.vertices[7 * 108 + 3] = 2;
    expect(() => renderer.drawPaintFootprints({ ...initial, revision: 2, dirtySlots: [0, 7] }, viewport, projection)).toThrow(RangeError);
    expect(uploads).toEqual([]);
  });
});

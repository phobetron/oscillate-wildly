// GPU layout contract: one paint slot contains a six-vertex connector followed
// by a six-vertex cap. Vertices store XYZ, RGB, then mask XY and shape.
export const XYZ_COMPONENTS = 3;
export const PAINT_VERTEX_COMPONENTS = 9;
export const TRIANGLE_PAIR_VERTICES = 6;
export const PAINT_SLOT_VERTICES = 2 * TRIANGLE_PAIR_VERTICES;
export const RIBBON_SLOT_FLOATS = TRIANGLE_PAIR_VERTICES * XYZ_COMPONENTS;
export const PAINT_CAP_OFFSET = TRIANGLE_PAIR_VERTICES * PAINT_VERTEX_COMPONENTS;
export const PAINT_SLOT_FLOATS = PAINT_SLOT_VERTICES * PAINT_VERTEX_COMPONENTS;
export const NORMAL_SLOT_FLOATS = PAINT_SLOT_VERTICES * XYZ_COMPONENTS;
export const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

export const ribbonVertex = (vertices: Float32Array, slot: number, index: number): number[] => {
  const start = slot * RIBBON_SLOT_FLOATS + index * XYZ_COMPONENTS;
  return Array.from(vertices.slice(start, start + XYZ_COMPONENTS));
};
export const paintVertex = (vertices: Float32Array, slot: number, index: number): number[] => {
  const start = slot * PAINT_SLOT_FLOATS + index * PAINT_VERTEX_COMPONENTS;
  return Array.from(vertices.slice(start, start + PAINT_VERTEX_COMPONENTS));
};
export const capVertex = (vertices: Float32Array, slot: number, index: number): number[] =>
  paintVertex(vertices, slot, TRIANGLE_PAIR_VERTICES + index);
export const paintNormal = (normals: Float32Array, slot: number, index: number): number[] => {
  const start = slot * NORMAL_SLOT_FLOATS + index * XYZ_COMPONENTS;
  return Array.from(normals.slice(start, start + XYZ_COMPONENTS));
};
export const paintStrip = (vertices: readonly number[], slot: number): number[] =>
  vertices.slice(slot * PAINT_SLOT_FLOATS, slot * PAINT_SLOT_FLOATS + PAINT_CAP_OFFSET);

// Accumulated marker vertices store XYZ, local XY, RGB, shape, radius, depth.
export const MARKER_VERTEX_COMPONENTS = 11;
export const MARKER_SLOT_FLOATS = TRIANGLE_PAIR_VERTICES * MARKER_VERTEX_COMPONENTS;
export const markerRadius = (vertices: readonly number[], slot: number): number =>
  vertices[slot * MARKER_SLOT_FLOATS + 9];
export const markerVisibilityDepth = (vertices: readonly number[], slot: number): number =>
  vertices[slot * MARKER_SLOT_FLOATS + 10];

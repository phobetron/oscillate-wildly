import type { Pose } from '../core/types';
import type { Point3D } from '../core/orthographic';

/** Chronological strip + cap slots, with only each stroke's start/end caps visible. */
export interface PaintFootprints {
  readonly vertices: Float32Array;
  readonly count: number;
  readonly revision: number;
  readonly dirtySlot: number | undefined;
  readonly dirtyPreviousSlot: number | undefined;
  /** Oldest physical slot; omitted for the append-only archive. */
  readonly start?: number;
  /** Physical slots changed by the latest deposit. */
  readonly dirtySlots?: readonly number[];
}

interface BrushFootprint {
  readonly shape?: 'circle' | 'square';
  readonly axisX: Point3D;
  readonly axisY: Point3D;
}

/** Shared production paint contract; ribbon-only fields remain on RibbonGeometry. */
export interface PaintBrush {
  readonly full: boolean;
  readonly footprints: PaintFootprints;
  add(pose: Pose, elapsedSeconds: number, width: number, side: Point3D, color?: Vector, footprint?: BrushFootprint): void;
  breakStroke(): void;
  clear(): void;
}

/** Packed world-space triangles, with six XYZ vertices per deposited segment. */
export interface RibbonGeometry {
  readonly vertices: Float32Array;
  readonly colors: Float32Array;
  readonly count: number;
  readonly next: number;
  readonly revision: number;
  readonly dirtySlot: number | undefined;
  readonly full: boolean;
  readonly footprints: PaintFootprints;
}

type Vector = readonly [number, number, number];
type Edges = readonly [Vector, Vector];
interface Endpoint {
  point: Vector;
  edges?: Edges;
  width: number;
  color: Vector;
}

const edgesFor = (point: Vector, side: Vector, width: number): Edges => {
  const half = width / 2;
  return [[point[0] - side[0] * half, point[1] - side[1] * half, point[2] - side[2] * half],
    [point[0] + side[0] * half, point[1] + side[1] * half, point[2] + side[2] * half]];
};
const equal = (a: Vector, b: Vector): boolean => a.every((value, index) => value === b[index]);
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vector): Vector | undefined => {
  const scale = Math.max(...v.map(Math.abs));
  if (scale === 0 || !Number.isFinite(scale)) return undefined;
  const scaled: Vector = [v[0] / scale, v[1] / scale, v[2] / scale];
  const length = Math.hypot(...scaled);
  return [scaled[0] / length, scaled[1] / length, scaled[2] / length];
};
const planeNormal = (x: Vector, y: Vector): Vector | undefined => {
  const a = unit(x);
  const b = unit(y);
  return a && b ? unit(cross(a, b)) : undefined;
};
const triangleNormal = (vertices: Float32Array, offset: number, stride = 3): Vector | undefined => {
  const a: Vector = [vertices[offset + stride] - vertices[offset], vertices[offset + stride + 1] - vertices[offset + 1],
    vertices[offset + stride + 2] - vertices[offset + 2]];
  const b: Vector = [vertices[offset + stride * 2] - vertices[offset], vertices[offset + stride * 2 + 1] - vertices[offset + 1],
    vertices[offset + stride * 2 + 2] - vertices[offset + 2]];
  return planeNormal(a, b);
};
const alignAxes = (x: Vector, y: Vector, target?: Vector): Edges => {
  const old = planeNormal(x, y);
  if (!old || !target) return [x, y];
  let dot = old[0] * target[0] + old[1] * target[1] + old[2] * target[2];
  if (dot < 0) {
    target = [-target[0], -target[1], -target[2]];
    dot = -dot;
  }
  const k = cross(old, target);
  const rotate = (v: Vector): Vector => {
    const kv = cross(k, v);
    const kkv = cross(k, kv);
    return [v[0] + kv[0] + kkv[0] / (1 + dot), v[1] + kv[1] + kkv[1] / (1 + dot),
      v[2] + kv[2] + kkv[2] / (1 + dot)];
  };
  return [rotate(x), rotate(y)];
};

const writeFootprintCap = (footprintVertices: Float32Array, slot: number, point: Vector, color: Vector,
  axes: Edges, circle: number): void => {
  const corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
  corners.forEach(([x, y], index) => {
    footprintVertices.set([
      point[0] + x * axes[0][0] + y * axes[1][0],
      point[1] + x * axes[0][1] + y * axes[1][1],
      point[2] + x * axes[0][2] + y * axes[1][2],
      ...color, x, y, circle,
    ], slot * 108 + 54 + index * 9);
  });
};

const validateDeposit = (pose: Pose, elapsedSeconds: number, width: number, direction: Point3D,
  color: Vector, footprint?: BrushFootprint): { point: Vector; normalized: Vector } => {
  const point: Vector = [pose.x, pose.y, pose.z ?? 0];
  if (!point.every(Number.isFinite)) throw new RangeError('pose coordinates must be finite');
  if (!Number.isFinite(elapsedSeconds)) throw new RangeError('elapsedSeconds must be finite');
  if (!Number.isFinite(width) || width < 0) throw new RangeError('width must be finite and nonnegative');
  if (color.length !== 3 || !color.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError('color must contain three finite RGB channels between zero and one');
  }
  const side: Vector = [direction.x, direction.y, direction.z];
  if (!side.every(Number.isFinite)) throw new RangeError('side coordinates must be finite');
  // Scale first so even subnormal or very large finite directions normalize safely.
  const scale = Math.max(...side.map(Math.abs));
  if (scale === 0) throw new RangeError('side must be nonzero');
  const scaled: Vector = [side[0] / scale, side[1] / scale, side[2] / scale];
  const length = Math.hypot(...scaled);
  const normalized: Vector = [scaled[0] / length, scaled[1] / length, scaled[2] / length];
  if (footprint) {
    if (footprint.shape !== undefined && footprint.shape !== 'circle' && footprint.shape !== 'square') {
      throw new RangeError('footprint shape must be circle or square');
    }
    const axes = [footprint.axisX, footprint.axisY].map((axis): Vector => [axis.x, axis.y, axis.z]);
    const scaledAxes = axes.map((axis): Vector => {
      if (!axis.every(Number.isFinite)) throw new RangeError('footprint axes must be finite');
      const axisScale = Math.max(...axis.map(Math.abs));
      if (axisScale === 0) throw new RangeError('footprint axes must be nonzero');
      return [axis[0] / axisScale, axis[1] / axisScale, axis[2] / axisScale];
    });
    const [x, y] = scaledAxes;
    if (Math.hypot(x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2],
      x[0] * y[1] - x[1] * y[0]) === 0) {
      throw new RangeError('footprint axes must span a plane');
    }
  }
  return { point, normalized };
};

/** Deposits a frozen ribbon body with moving end caps until its sample budget is full. */
export const createRibbonBrush = (maxSamples = 12000): RibbonGeometry & {
  add(pose: Pose, elapsedSeconds: number, width: number, side: Point3D, color?: Vector, footprint?: BrushFootprint): void;
  breakStroke(): void;
  clear(): void;
} => {
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) {
    throw new RangeError('maxSamples must be a positive safe integer');
  }
  const maxSegments = maxSamples - 1;
  let vertices = new Float32Array(0);
  let colors = new Float32Array(0);
  let count = 0;
  let samples = 0;
  let revision = 0;
  let dirtySlot: number | undefined;
  let endpoint: Endpoint | undefined;
  let elapsed: number | undefined;
  let footprintVertices = new Float32Array(0);
  let footprintCount = 0;
  let footprintRevision = 0;
  let footprintDirtySlot: number | undefined;
  let footprintDirtyPreviousSlot: number | undefined;
  let strokeStartSlot: number | undefined;
  let strokeStart: { point: Vector; color: Vector; x: Vector; y: Vector; circle: number; finalized: boolean } | undefined;
  let strokeEnd: { slot: number; point: Vector; color: Vector } | undefined;
  const breakStroke = (): void => {
    endpoint = undefined;
    strokeStartSlot = undefined;
    strokeStart = undefined;
    strokeEnd = undefined;
  };
  const footprints: PaintFootprints = {
    get vertices() { return footprintVertices; },
    get count() { return footprintCount; },
    get revision() { return footprintRevision; },
    get dirtySlot() { return footprintDirtySlot; },
    get dirtyPreviousSlot() { return footprintDirtyPreviousSlot; },
  };

  return {
    get vertices() { return vertices; },
    get colors() { return colors; },
    get count() { return count; },
    get next() { return vertices.length === 0 ? 0 : count % (vertices.length / 18); },
    get revision() { return revision; },
    get dirtySlot() { return dirtySlot; },
    get full() { return samples === maxSamples; },
    footprints,
    breakStroke,
    clear() {
      count = 0;
      samples = 0;
      breakStroke();
      elapsed = undefined;
      dirtySlot = undefined;
      revision += 1;
      footprintCount = 0;
      footprintDirtySlot = undefined;
      footprintDirtyPreviousSlot = undefined;
      footprintRevision += 1;
    },
    add(pose, elapsedSeconds, width, direction, color = [1, 0, 0], footprint) {
      const { point, normalized } = validateDeposit(pose, elapsedSeconds, width, direction, color, footprint);

      if (samples === maxSamples || elapsedSeconds === elapsed) return;
      elapsed = elapsedSeconds;
      if (width === 0) {
        breakStroke();
        return;
      }
      if (endpoint && equal(endpoint.point, point)) return;
      const to = edgesFor(point, normalized, width);
      if (endpoint) {
        const slot = count;
        if (vertices.length / 18 <= slot) {
          const capacity = Math.min(maxSegments, Math.max(slot + 1, vertices.length / 18 * 2, 1));
          const grown = new Float32Array(capacity * 18);
          grown.set(vertices);
          vertices = grown;
          const grownColors = new Float32Array(capacity * 18);
          grownColors.set(colors);
          colors = grownColors;
        }
        // A stroke's first point has no motion direction yet. Orient its initial
        // footprint using the first segment while retaining its own width/color.
        const from = endpoint.edges ?? edgesFor(endpoint.point, normalized, endpoint.width);
        vertices.set([...from[0], ...from[1], ...to[0], ...from[1], ...to[1], ...to[0]], slot * 18);
        colors.set([...endpoint.color, ...endpoint.color, ...color, ...endpoint.color, ...color, ...color], slot * 18);
        count += 1;
        dirtySlot = slot;
        revision += 1;
      }
      if (footprint) {
        const slot = footprintCount;
        if (footprintVertices.length / 108 <= slot) {
          const capacity = Math.min(maxSamples, Math.max(slot + 1, footprintVertices.length / 108 * 2, 1));
          const grown = new Float32Array(capacity * 108);
          grown.set(footprintVertices);
          footprintVertices = grown;
        }
        footprintDirtyPreviousSlot = undefined;
        if (endpoint && strokeStart && !strokeStart.finalized && strokeStartSlot !== undefined) {
          writeFootprintCap(footprintVertices, strokeStartSlot, strokeStart.point, strokeStart.color,
            alignAxes(strokeStart.x, strokeStart.y, triangleNormal(vertices, (count - 1) * 18)), strokeStart.circle);
          strokeStart.finalized = true;
          footprintDirtyPreviousSlot = strokeStartSlot;
        }
        if (strokeEnd && strokeEnd.slot !== strokeStartSlot) {
          // The former head is now body. Keep its connector, but remove its cap
          // so only the stroke's original start and current end remain visible.
          for (let index = 0; index < 6; index += 1) {
            footprintVertices.set([...strokeEnd.point, ...strokeEnd.color, 0, 0, 0],
              strokeEnd.slot * 108 + 54 + index * 9);
          }
          footprintDirtyPreviousSlot = strokeEnd.slot;
        }
        // Keep each connecting strip immediately before its cap so later paint
        // wins at equal-depth crossings when the archive is drawn in one call.
        for (let index = 0; index < 6; index += 1) {
          const stripOffset = (count - 1) * 18 + index * 3;
          footprintVertices.set([
            ...(endpoint ? vertices.subarray(stripOffset, stripOffset + 3) : point),
            ...(endpoint ? colors.subarray(stripOffset, stripOffset + 3) : color),
            0, 0, 0,
          ], slot * 108 + index * 9);
        }
        const { axisX, axisY } = footprint;
        const x: Vector = [axisX.x, axisX.y, axisX.z];
        const y: Vector = [axisY.x, axisY.y, axisY.z];
        const circle = footprint.shape === 'square' ? 0 : 1;
        writeFootprintCap(footprintVertices, slot, point, color, alignAxes(x, y,
          endpoint ? triangleNormal(vertices, (count - 1) * 18 + 9) : undefined), circle);
        footprintCount += 1;
        footprintDirtySlot = slot;
        footprintRevision += 1;
        if (strokeStartSlot === undefined) {
          strokeStartSlot = slot;
          strokeStart = { point, color: [color[0], color[1], color[2]], x, y, circle, finalized: false };
        }
        strokeEnd = { slot, point, color: [color[0], color[1], color[2]] };
      }
      endpoint = { point, edges: endpoint ? to : undefined, width, color: [color[0], color[1], color[2]] };
      samples += 1;
    },
  };
};

interface TrimmingSample extends Endpoint {
  axes: Edges;
  circle: number;
  hasIncoming: boolean;
}

/** Retains the newest deposits in stable physical slots, drawn starting at footprints.start. */
export const createTrimmingPaintBrush = (maxSamples = 12000): PaintBrush => {
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) {
    throw new RangeError('maxSamples must be a positive safe integer');
  }
  let vertices = new Float32Array(0);
  const samples: TrimmingSample[] = [];
  let count = 0;
  let start = 0;
  let revision = 0;
  let dirtySlots: number[] = [];
  let elapsed: number | undefined;
  let endpoint: TrimmingSample | undefined;
  let headSlot: number | undefined;
  const collapse = (slot: number, sample: TrimmingSample, offset: number): void => {
    for (let index = 0; index < 6; index += 1) {
      vertices.set([...sample.point, ...sample.color, 0, 0, 0], slot * 108 + offset + index * 9);
    }
  };
  const mark = (slot: number): void => {
    if (!dirtySlots.includes(slot)) dirtySlots.push(slot);
  };
  const cap = (slot: number, target?: Vector): void => {
    const sample = samples[slot];
    writeFootprintCap(vertices, slot, sample.point, sample.color,
      alignAxes(sample.axes[0], sample.axes[1], target), sample.circle);
    mark(slot);
  };
  const breakStroke = (): void => { endpoint = undefined; headSlot = undefined; };
  const footprints: PaintFootprints = {
    get vertices() { return vertices; },
    get count() { return count; },
    get start() { return start; },
    get revision() { return revision; },
    get dirtySlots() { return dirtySlots; },
    get dirtySlot() { return dirtySlots[0]; },
    get dirtyPreviousSlot() { return dirtySlots[1]; },
  };
  return {
    get full() { return count === maxSamples; },
    footprints,
    breakStroke,
    clear() {
      count = 0;
      start = 0;
      revision += 1;
      dirtySlots = [];
      elapsed = undefined;
      samples.length = 0;
      breakStroke();
    },
    add(pose, elapsedSeconds, width, direction, color = [1, 0, 0], footprint) {
      const { point, normalized } = validateDeposit(pose, elapsedSeconds, width, direction, color, footprint);
      if (elapsedSeconds === elapsed) return;
      elapsed = elapsedSeconds;
      if (width === 0) { breakStroke(); return; }
      if (endpoint && equal(endpoint.point, point)) return;
      const slot = count === maxSamples ? start : count;
      const overwriting = count === maxSamples;
      const previous = endpoint;
      const previousSlot = headSlot;
      const to = edgesFor(point, normalized, width);
      // Production supplies its captured world-space footprint. The default is
      // an orthogonal dab for callers using the shared optional-footprint contract.
      const perpendicular = footprint ? undefined
        : unit(cross(normalized, Math.abs(normalized[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]))!;
      const scaledAxis = (axis: Vector): Vector => [axis[0] * width / 2, axis[1] * width / 2, axis[2] * width / 2];
      const axes: Edges = footprint ? [
        [footprint.axisX.x, footprint.axisX.y, footprint.axisX.z],
        [footprint.axisY.x, footprint.axisY.y, footprint.axisY.z],
      ] : [scaledAxis(normalized), scaledAxis(perpendicular!)];
      const sample: TrimmingSample = {
        point, color: [color[0], color[1], color[2]], width,
        edges: previous ? to : undefined, axes, circle: footprint?.shape === 'square' ? 0 : 1,
        hasIncoming: previous !== undefined && maxSamples > 1,
      };
      if (!overwriting) {
        if (vertices.length / 108 <= slot) {
          const capacity = Math.min(maxSamples, Math.max(slot + 1, vertices.length / 108 * 2, 1));
          const grown = new Float32Array(capacity * 108);
          grown.set(vertices);
          vertices = grown;
        }
        count += 1;
      } else {
        start = (start + 1) % maxSamples;
      }
      dirtySlots = [slot];
      samples[slot] = sample;
      if (sample.hasIncoming && previous) {
        const from = previous.edges ?? edgesFor(previous.point, normalized, previous.width);
        const corners = [from[0], from[1], to[0], from[1], to[1], to[0]];
        for (let index = 0; index < 6; index += 1) {
          vertices.set([...corners[index], ...(index === 0 || index === 1 || index === 3 ? previous.color : sample.color),
            0, 0, 0], slot * 108 + index * 9);
        }
      } else {
        collapse(slot, sample, 0);
      }
      cap(slot, sample.hasIncoming ? triangleNormal(vertices, slot * 108 + 27, 9) : undefined);
      if (overwriting && maxSamples > 1 && samples[start].hasIncoming) {
        const tail = samples[start];
        tail.hasIncoming = false;
        collapse(start, tail, 0);
        const next = (start + 1) % maxSamples;
        cap(start, samples[next].hasIncoming ? triangleNormal(vertices, next * 108, 9) : undefined);
      }
      if (previous && previousSlot !== undefined && previousSlot !== slot) {
        if (!previous.hasIncoming) {
          // Both a stroke start and a newly exposed archive tail keep their cap.
          cap(previousSlot, triangleNormal(vertices, slot * 108, 9));
        } else {
          collapse(previousSlot, previous, 54);
          mark(previousSlot);
        }
      }
      endpoint = sample;
      headSlot = slot;
      revision += 1;
    },
  };
};

import { projectToCssPixels } from './framing';
import type { Bounds, Framing, Pose, ProjectedPose, Viewport } from './types';

export interface Point3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Fixed view-plane bounds use screen coordinates: positive Y points down. */
export interface OrthographicCamera {
  readonly position: Point3D;
  readonly target?: Point3D;
  readonly up?: Point3D;
  readonly near?: number;
  readonly far?: number;
  readonly bounds: Bounds;
}

export interface OrthographicPose extends ProjectedPose {
  readonly visibilityDepth: number;
}

const origin: Point3D = { x: 0, y: 0, z: 0 };
const defaultUp: Point3D = { x: 0, y: 1, z: 0 };
const finitePoint = (point: Point3D, name: string): void => {
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new RangeError(`${name} coordinates must be finite`);
  }
};
const subtract = (a: Point3D, b: Point3D): Point3D => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point3D, b: Point3D): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3D, b: Point3D): Point3D => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (point: Point3D, name: string): Point3D => {
  const length = Math.hypot(point.x, point.y, point.z);
  if (!Number.isFinite(length) || length === 0) throw new RangeError(`${name} must be nondegenerate`);
  return { x: point.x / length, y: point.y / length, z: point.z / length };
};
const validBounds = (bounds: Bounds): void => {
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    throw new RangeError('camera bounds must be finite with positive width and height');
  }
};
const cameraBasis = (camera: OrthographicCamera) => {
  const target = camera.target ?? origin;
  const up = camera.up ?? defaultUp;
  finitePoint(camera.position, 'camera position');
  finitePoint(target, 'camera target');
  finitePoint(up, 'camera up');
  validBounds(camera.bounds);
  const near = camera.near ?? 0.1;
  const far = camera.far ?? 100;
  if (!Number.isFinite(near) || near < 0 || !Number.isFinite(far) || far <= near) {
    throw new RangeError('camera near must be non-negative and far must be finite and greater than near');
  }
  const forward = normalize(subtract(target, camera.position), 'camera view direction');
  const right = normalize(cross(forward, normalize(up, 'camera up')), 'camera up and view direction');
  const screenUp = cross(right, forward);
  return { forward, right, screenUp, near, far };
};

/** Validate a camera without requiring a viewport, motion sample, or renderer. */
export const validateOrthographicCamera = (camera: OrthographicCamera): void => {
  cameraBasis(camera);
};

/** Look-at orthographic projection into CSS pixels; clipping depth is not clamped. */
export const projectOrthographic = (
  pose: Pose,
  viewport: Viewport,
  camera: OrthographicCamera,
  framing: Framing = {},
): OrthographicPose => {
  const world = { x: pose.x, y: pose.y, z: pose.z ?? 0 };
  finitePoint(world, 'pose');
  const { forward, right, screenUp, near, far } = cameraBasis(camera);
  if (framing.bounds) validBounds(framing.bounds);
  if (![framing.offsetX ?? 0, framing.offsetY ?? 0].every(Number.isFinite)) {
    throw new RangeError('framing offsets must be finite');
  }
  const relative = subtract(world, camera.position);
  const projected = projectToCssPixels({
    ...pose,
    x: dot(relative, right),
    y: -dot(relative, screenUp),
  }, viewport, framing, camera.bounds);
  return { ...projected, visibilityDepth: (dot(relative, forward) - near) / (far - near) };
};

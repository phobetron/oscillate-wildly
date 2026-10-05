import { validateOrthographicCamera, type OrthographicCamera } from '../src/core';

const radiansPerPixel = 0.005;
const maximumElevation = Math.PI / 2 - 0.05;

/** Orbit around the target using drag distances measured in CSS pixels. */
export const orbitCamera = (
  camera: OrthographicCamera,
  deltaX: number,
  deltaY: number,
): OrthographicCamera => {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new RangeError('camera drag distances must be finite');
  }
  validateOrthographicCamera(camera);
  if (deltaX === 0 && deltaY === 0) return camera;

  const target = camera.target ?? { x: 0, y: 0, z: 0 };
  const up = camera.up ?? { x: 0, y: 1, z: 0 };
  const upLength = Math.hypot(up.x, up.y, up.z);
  const axis = { x: up.x / upLength, y: up.y / upLength, z: up.z / upLength };
  const offset = {
    x: camera.position.x - target.x,
    y: camera.position.y - target.y,
    z: camera.position.z - target.z,
  };
  const radius = Math.hypot(offset.x, offset.y, offset.z);
  const vertical = offset.x * axis.x + offset.y * axis.y + offset.z * axis.z;
  const horizontal = {
    x: offset.x - vertical * axis.x,
    y: offset.y - vertical * axis.y,
    z: offset.z - vertical * axis.z,
  };
  const horizontalLength = Math.hypot(horizontal.x, horizontal.y, horizontal.z);
  const direction = {
    x: horizontal.x / horizontalLength,
    y: horizontal.y / horizontalLength,
    z: horizontal.z / horizontalLength,
  };
  // Rodrigues' rotation simplifies here because the horizontal direction is perpendicular to up.
  const tangent = {
    x: axis.y * direction.z - axis.z * direction.y,
    y: axis.z * direction.x - axis.x * direction.z,
    z: axis.x * direction.y - axis.y * direction.x,
  };
  const yaw = -deltaX * radiansPerPixel;
  const elevation = Math.max(-maximumElevation, Math.min(maximumElevation,
    Math.asin(Math.max(-1, Math.min(1, vertical / radius))) + deltaY * radiansPerPixel));
  const horizontalRadius = radius * Math.cos(elevation);
  const verticalRadius = radius * Math.sin(elevation);
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    ...camera,
    position: {
      x: target.x + horizontalRadius * (direction.x * cosine + tangent.x * sine) + axis.x * verticalRadius,
      y: target.y + horizontalRadius * (direction.y * cosine + tangent.y * sine) + axis.y * verticalRadius,
      z: target.z + horizontalRadius * (direction.z * cosine + tangent.z * sine) + axis.z * verticalRadius,
    },
  };
};

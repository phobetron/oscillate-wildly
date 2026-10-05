import { expect, test } from '@rstest/core';
import { orbitCamera } from '../../examples/orbitCamera';
import { validateOrthographicCamera, type OrthographicCamera } from '../../src/core';

const bounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 };
const camera: OrthographicCamera = { position: { x: 0, y: 0, z: 10 }, bounds };

test('horizontal dragging rotates clockwise around default Y-up at CSS pixel sensitivity', () => {
  const rotated = orbitCamera(camera, 100, 0);
  expect(rotated.position.x).toBeCloseTo(-10 * Math.sin(0.5), 10);
  expect(rotated.position.y).toBeCloseTo(0, 10);
  expect(rotated.position.z).toBeCloseTo(10 * Math.cos(0.5), 10);
});

test('Z-up dragging uses the same yaw direction and raises elevation with downward drag', () => {
  const rotated = orbitCamera({ ...camera, position: { x: 10, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }, 100, 60);
  expect(rotated.position.x).toBeCloseTo(10 * Math.cos(0.3) * Math.cos(0.5), 10);
  expect(rotated.position.y).toBeCloseTo(-10 * Math.cos(0.3) * Math.sin(0.5), 10);
  expect(rotated.position.z).toBeCloseTo(10 * Math.sin(0.3), 10);
  expect(orbitCamera(camera, 0, 60).position.y).toBeCloseTo(10 * Math.sin(0.3), 10);
});

test('orbit preserves distance and camera configuration for an arbitrary up axis and translated target', () => {
  const configured: OrthographicCamera = {
    position: { x: 4, y: 7, z: 9 }, target: { x: 1, y: 2, z: 3 },
    up: { x: 2, y: 3, z: -4 }, near: 0.5, far: 30, bounds,
  };
  const before = structuredClone(configured);
  const rotated = orbitCamera(configured, -123, 80);
  expect(Math.hypot(rotated.position.x - 1, rotated.position.y - 2, rotated.position.z - 3))
    .toBeCloseTo(Math.hypot(3, 5, 6), 10);
  expect(rotated.target).toBe(configured.target);
  expect(rotated.up).toBe(configured.up);
  expect(rotated.bounds).toBe(bounds);
  expect(rotated.near).toBe(configured.near);
  expect(rotated.far).toBe(configured.far);
  expect(rotated.position).not.toBe(configured.position);
  expect(configured).toEqual(before);
  expect(() => validateOrthographicCamera(rotated)).not.toThrow();
});

test('extreme repeated pitch dragging clamps both poles without a degenerate view', () => {
  for (const up of [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    let current: OrthographicCamera = { ...camera, up, position: { x: 10, y: 0, z: 0 } };
    for (const sign of [1, -1]) {
      for (let drag = 0; drag < 100; drag++) {
        current = orbitCamera(current, 400, sign * 100000);
        expect(() => validateOrthographicCamera(current)).not.toThrow();
        expect(Math.hypot(current.position.x, current.position.y, current.position.z)).toBeCloseTo(10, 10);
      }
      const elevation = Math.asin((current.position.y * up.y + current.position.z * up.z) / 10);
      expect(elevation).toBeCloseTo(sign * (Math.PI / 2 - 0.05), 10);
    }
  }
});

test('zero drag returns the camera unchanged and invalid inputs fail clearly', () => {
  expect(orbitCamera(camera, 0, 0)).toBe(camera);
  for (const value of [NaN, Infinity, -Infinity]) {
    expect(() => orbitCamera(camera, value, 0)).toThrow(RangeError);
    expect(() => orbitCamera(camera, 0, value)).toThrow(RangeError);
  }
  expect(() => orbitCamera({ ...camera, up: { x: 0, y: 0, z: 1 } }, 1, 0)).toThrow(RangeError);
  expect(() => orbitCamera({ ...camera, position: { x: 0, y: 0, z: 0 } }, 1, 0)).toThrow(RangeError);
});

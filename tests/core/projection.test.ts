import { expect, test } from '@rstest/core';
import { projectOrthographic, projectToCssPixels, validateOrthographicCamera, type OrthographicCamera } from '../../src/core';

const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
const viewport = { width: 200, height: 100 };
const camera: OrthographicCamera = { position: { x: 0, y: 0, z: 10 }, near: 1, far: 11, bounds };

test('2D projection preserves world z and marker visual channels', () => {
  expect(projectToCssPixels({ x: 0, y: 0, z: 7, depth: 2, opacity: 0.4 }, viewport, {}, bounds))
    .toMatchObject({ x: 100, y: 50, z: 7, depth: 2, opacity: 0.4 });
});

test('orthographic camera maps up toward negative screen Y and preserves marker depth', () => {
  const projected = projectOrthographic({ x: 1, y: 1, z: 5, depth: 2, opacity: 0.4 }, viewport, camera, { fit: 'stretch' });
  expect(projected).toMatchObject({ x: 200, y: 0, z: 5, depth: 2, opacity: 0.4, visibilityDepth: 0.4, scaleX: 100, scaleY: 50 });
  expect(projectOrthographic({ x: 0, y: 0 }, viewport, camera).visibilityDepth).toBe(0.9);
});

test('rotated look-at cameras project into their view plane with fixed framing controls', () => {
  const rotated = { ...camera, position: { x: 10, y: 0, z: 0 } };
  expect(projectOrthographic({ x: 5, y: 1, z: -1 }, viewport, rotated, { fit: 'contain', padding: 0, zoom: 2, offsetX: 0.1, offsetY: 0.2 }))
    .toMatchObject({ x: 220, y: -30, visibilityDepth: 0.4, scaleX: 100, scaleY: 100 });
  const customUp = { ...camera, up: { x: 1, y: 0, z: 0 }, target: { x: 0, y: 0, z: 5 } };
  expect(projectOrthographic({ x: 1, y: 1, z: 5 }, viewport, customUp, { fit: 'stretch' }))
    .toMatchObject({ x: 0, y: 0, visibilityDepth: 0.4 });
});

test('normalized clipping depth includes both planes and keeps outside values', () => {
  expect(projectOrthographic({ x: 0, y: 0, z: 9 }, viewport, camera).visibilityDepth).toBe(0);
  expect(projectOrthographic({ x: 0, y: 0, z: -1 }, viewport, camera).visibilityDepth).toBe(1);
  expect(projectOrthographic({ x: 0, y: 0, z: 10 }, viewport, camera).visibilityDepth).toBeLessThan(0);
  expect(projectOrthographic({ x: 0, y: 0, z: -2 }, viewport, camera).visibilityDepth).toBeGreaterThan(1);
});

test('invalid camera, coordinates, dimensions, and framing fail clearly', () => {
  const invalid: OrthographicCamera[] = [
    { ...camera, position: { x: 0, y: 0, z: 0 } },
    { ...camera, position: { x: Infinity, y: 0, z: 10 } },
    { ...camera, up: { x: 0, y: 0, z: 1 } },
    { ...camera, up: { x: 0, y: 0, z: 0 } },
    { ...camera, target: { x: NaN, y: 0, z: 0 } },
    { ...camera, near: -1 }, { ...camera, far: 1 }, { ...camera, far: Infinity },
    { ...camera, bounds: { ...bounds, minX: NaN } },
    { ...camera, bounds: { ...bounds, maxY: -1 } },
  ];
  for (const config of invalid) expect(() => validateOrthographicCamera(config)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: NaN, y: 0 }, viewport, camera)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: 0, y: 0, z: Infinity }, viewport, camera)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: 0, y: 0 }, { width: 0, height: 100 }, camera)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: 0, y: 0 }, viewport, camera, { offsetX: Infinity })).toThrow(RangeError);
  expect(() => validateOrthographicCamera({ ...camera, near: 0 })).not.toThrow();
});

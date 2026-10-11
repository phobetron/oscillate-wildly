import { expect, test } from '@rstest/core';
import { projectOrthographic, projectToCssPixels, validateOrthographicCamera, type OrthographicCamera } from '../../../src/core';

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

test.each([
  { name: 'near plane', z: 9, visibilityDepth: 0 },
  { name: 'far plane', z: -1, visibilityDepth: 1 },
  { name: 'before the near plane', z: 10, visibilityDepth: -0.1 },
  { name: 'beyond the far plane', z: -2, visibilityDepth: 1.1 },
])('retains normalized clipping depth at $name', ({ z, visibilityDepth }) => {
  const projected = projectOrthographic({ x: 0, y: 0, z }, viewport, camera);

  expect(projected.visibilityDepth).toBeCloseTo(visibilityDepth);
});

const invalidCameras = [
  { name: 'position equals target', camera: { ...camera, position: { x: 0, y: 0, z: 0 } } },
  { name: 'nonfinite position', camera: { ...camera, position: { x: Infinity, y: 0, z: 10 } } },
  { name: 'up parallel to view', camera: { ...camera, up: { x: 0, y: 0, z: 1 } } },
  { name: 'zero up vector', camera: { ...camera, up: { x: 0, y: 0, z: 0 } } },
  { name: 'nonfinite target', camera: { ...camera, target: { x: NaN, y: 0, z: 0 } } },
  { name: 'negative near plane', camera: { ...camera, near: -1 } },
  { name: 'coincident clipping planes', camera: { ...camera, far: 1 } },
  { name: 'nonfinite far plane', camera: { ...camera, far: Infinity } },
  { name: 'nonfinite bounds', camera: { ...camera, bounds: { ...bounds, minX: NaN } } },
  { name: 'collapsed bounds', camera: { ...camera, bounds: { ...bounds, maxY: -1 } } },
] satisfies ReadonlyArray<{ name: string; camera: OrthographicCamera }>;

test.each(invalidCameras)('rejects camera with $name', ({ camera: invalid }) => {
  expect(() => validateOrthographicCamera(invalid)).toThrow(RangeError);
});

test('projection rejects invalid coordinates, dimensions, and framing', () => {
  expect(() => projectOrthographic({ x: NaN, y: 0 }, viewport, camera)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: 0, y: 0, z: Infinity }, viewport, camera)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: 0, y: 0 }, { width: 0, height: 100 }, camera)).toThrow(RangeError);
  expect(() => projectOrthographic({ x: 0, y: 0 }, viewport, camera, { offsetX: Infinity })).toThrow(RangeError);
});

test('accepts a near clipping plane at zero', () => {
  expect(() => validateOrthographicCamera({ ...camera, near: 0 })).not.toThrow();
});

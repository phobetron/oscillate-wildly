import { expect, test } from '@rstest/core';
import { projectToCssPixels, type Bounds, type Framing, type Viewport } from '../../../src/core';

const bounds: Bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
const viewport: Viewport = { width: 300, height: 100 };

test('cover is the default and centers projected world coordinates', () => {
  const projected = projectToCssPixels({ x: 0, y: 0 }, viewport, {}, bounds);

  expect(projected.x).toBe(150);
  expect(projected.y).toBe(50);
  expect(projected.scaleX).toBe(150);
  expect(projected.scaleY).toBe(150);
});

test('contain, stretch, zoom, and fractional viewport offsets project independently', () => {
  const contained = projectToCssPixels({ x: 1, y: 1 }, viewport, { fit: 'contain', padding: 0, zoom: 2, offsetX: 0.1, offsetY: -0.2 }, bounds);
  const stretched = projectToCssPixels({ x: 1, y: 1 }, viewport, { fit: 'stretch' }, bounds);

  expect(contained).toMatchObject({ x: 280, y: 130, scaleX: 100, scaleY: 100 });
  expect(stretched).toMatchObject({ x: 300, y: 100, scaleX: 150, scaleY: 50 });
});

test('contain reserves visual padding for a marker at the world bounds', () => {
  const upper = projectToCssPixels({ x: 1, y: 1 }, viewport, { fit: 'contain' }, bounds);
  const lower = projectToCssPixels({ x: -1, y: -1 }, viewport, { fit: 'contain' }, bounds);

  expect(upper.y).toBe(84);
  expect(lower.y).toBe(16);
  expect(upper.x).toBeLessThanOrEqual(viewport.width - 16);
  expect(lower.x).toBeGreaterThanOrEqual(16);
});

test('framing bounds override source bounds without changing the source object', () => {
  const sourceBounds = Object.freeze({ minX: -1, maxX: 1, minY: -1, maxY: 1 });
  const projected = projectToCssPixels({ x: 0, y: 0 }, viewport, { bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 } }, sourceBounds);

  expect(projected).toMatchObject({ x: 0, y: -100 });
  expect(sourceBounds).toEqual({ minX: -1, maxX: 1, minY: -1, maxY: 1 });
});

test.each([
  { name: 'zero viewport width', viewport: { width: 0, height: 100 }, framing: {} },
  { name: 'zero zoom', viewport, framing: { zoom: 0 } },
  { name: 'negative padding', viewport, framing: { fit: 'contain', padding: -1 } },
] satisfies ReadonlyArray<{ name: string; viewport: Viewport; framing: Framing }>)(
  'rejects $name', ({ viewport: size, framing }) => {
    expect(() => projectToCssPixels({ x: 0, y: 0 }, size, framing, bounds)).toThrow(RangeError);
  },
);

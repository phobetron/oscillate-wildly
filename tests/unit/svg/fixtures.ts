import type { Pose } from '../../../src/core';
import type { Frame } from '../../../src/runtime';

const attributes = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getAttribute: (name: string) => values.get(name) ?? null,
    setAttribute: (name: string, value: string) => { values.set(name, value); },
    removeAttribute: (name: string) => { values.delete(name); },
  };
};

export const elements = () => {
  const viewportAttributes = attributes({ width: '200', height: '100', viewBox: '0 0 100 50' });
  const point = { x: 0, y: 0 };
  const localViewport = {
    clientWidth: undefined as number | undefined,
    clientHeight: undefined as number | undefined,
    ...viewportAttributes,
    style: { width: '200px', height: '100px', overflow: 'visible' },
    viewBox: { baseVal: { x: 0, y: 0, width: 100, height: 50 } },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    getScreenCTM: () => ({ inverse: () => ({ a: 0.5, d: 0.5, e: -5, f: -10 }) }),
    createSVGPoint: () => ({
      ...point,
      matrixTransform(matrix: { a: number; d: number; e: number; f: number }) {
        return { x: matrix.a * this.x + matrix.e, y: matrix.d * this.y + matrix.f };
      },
    }),
  };
  const viewport = localViewport as unknown as SVGSVGElement;
  const marker = attributes({ transform: 'rotate(10)', opacity: '0.7' }) as unknown as SVGGraphicsElement;
  const path = attributes({ d: 'M 0 0' }) as unknown as SVGPathElement;
  return { viewport, marker, path, localViewport };
};

export const frame = (x: number, y: number, elapsedSeconds = x): Frame<undefined> => ({
  state: undefined, pose: { x, y }, position: { x, y, scaleX: 1, scaleY: 1 },
  viewport: { width: 200, height: 100 }, elapsedSeconds,
  project: (pose) => ({ ...pose, scaleX: 1, scaleY: 1 }),
});

export const worldFrame = (pose: Pose, elapsedSeconds: number, multiplier = 1): Frame<undefined> => ({
  state: undefined,
  pose,
  position: { x: pose.x * multiplier, y: pose.y * multiplier, scaleX: 1, scaleY: 1 },
  viewport: { width: 200, height: 100 },
  elapsedSeconds,
  project: (projected) => ({ ...projected, x: projected.x * multiplier, y: projected.y * multiplier, scaleX: 1, scaleY: 1 }),
});


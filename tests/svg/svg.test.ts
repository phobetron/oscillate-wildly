import { createHelixMotion } from '../../src/motions/helix';
import { createEllipseMotion } from '../../src/motions/ellipse';
import { describe, expect, test } from '@rstest/core';
import type { AnalyticMotionSource, MotionSample, Pose } from '../../src/core';
import { animateSvg, renderSvgMarker } from '../../src/svg';
import { createSvgStaticPath } from '../../src/svg/path';
import { createSvgTrail } from '../../src/svg/trail';
import type { Frame } from '../../src/runtime';
import { cssPointToSvgPoint } from '../../src/svg/coordinates';

interface TestState { readonly value: number }

const motion = (pose: Pose): AnalyticMotionSource<TestState> => ({
  kind: 'analytic', periodSeconds: 1,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  sample: (): MotionSample<TestState> => ({ state: { value: 1 }, pose }),
  reset: () => undefined,
});

const attributes = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getAttribute: (name: string) => values.get(name) ?? null,
    setAttribute: (name: string, value: string) => { values.set(name, value); },
    removeAttribute: (name: string) => { values.delete(name); },
  };
};

const elements = () => {
  const viewportAttributes = attributes({ width: '200', height: '100', viewBox: '0 0 100 50' });
  const point = { x: 0, y: 0 };
  const viewport = {
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
  } as unknown as SVGSVGElement;
  const marker = attributes({ transform: 'rotate(10)', opacity: '0.7' }) as unknown as SVGGraphicsElement;
  const path = attributes({ d: 'M 0 0' }) as unknown as SVGPathElement;
  return { viewport, marker, path };
};

const frame = (x: number, y: number, elapsedSeconds = x): Frame<undefined> => ({
  state: undefined, pose: { x, y }, position: { x, y, scaleX: 1, scaleY: 1 },
  viewport: { width: 200, height: 100 }, elapsedSeconds,
  project: (pose) => ({ ...pose, scaleX: 1, scaleY: 1 }),
});

const worldFrame = (pose: Pose, elapsedSeconds: number, multiplier = 1): Frame<undefined> => ({
  state: undefined,
  pose,
  position: { x: pose.x * multiplier, y: pose.y * multiplier, scaleX: 1, scaleY: 1 },
  viewport: { width: 200, height: 100 },
  elapsedSeconds,
  project: (projected) => ({ ...projected, x: projected.x * multiplier, y: projected.y * multiplier, scaleX: 1, scaleY: 1 }),
});

describe('animateSvg', () => {
  test('uses local viewport dimensions despite outer transforms and honors preserveAspectRatio', () => {
    const { viewport, marker } = elements();
    const localViewport = viewport as unknown as {
      clientWidth: number; clientHeight: number;
      viewBox: { baseVal: { x: number; y: number; width: number; height: number } };
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
    };
    localViewport.clientWidth = 200;
    localViewport.clientHeight = 100;
    localViewport.viewBox.baseVal = { x: 0, y: 0, width: 100, height: 100 };
    viewport.setAttribute('preserveAspectRatio', 'xMaxYMin meet');
    // This is a rotated/scaled screen rect. It must not affect local mapping.
    localViewport.getBoundingClientRect = () => ({ left: 800, top: 120, width: 100, height: 250 });

    const controller = animateSvg({ viewport, marker }, motion({ x: 0, y: 0 }), { autoplay: false });
    expect(marker.getAttribute('transform')).toBe('translate(0 50) scale(1) rotate(10)');
    controller.dispose();
  });

  test('leaves consumer SVG dimensions, viewBox, and overflow untouched', () => {
    const { viewport, marker } = elements();
    const controller = animateSvg({ viewport, marker }, motion({ x: 0, y: 0, depth: 0.5, opacity: 0.25 }), { autoplay: false });

    expect(viewport.getAttribute('width')).toBe('200');
    expect(viewport.getAttribute('height')).toBe('100');
    expect(viewport.getAttribute('viewBox')).toBe('0 0 100 50');
    expect((viewport as unknown as { style: CSSStyleDeclaration }).style.overflow).toBe('visible');
    expect(marker.getAttribute('transform')).toBe('translate(50 25) scale(0.5) rotate(10)');
    expect(marker.getAttribute('opacity')).toBe('0.25');
    controller.dispose();
    expect(marker.getAttribute('transform')).toBe('rotate(10)');
    expect(marker.getAttribute('opacity')).toBe('0.7');
  });

  test('hands custom renderers the unmodified frame and supplied elements', () => {
    const { viewport, marker } = elements();
    let calls = 0;
    const controller = animateSvg({ viewport, marker }, motion({ x: 0, y: 0 }), {
      autoplay: false,
      render: (received, receivedElements) => {
        calls += 1;
        expect(received.position).toMatchObject({ x: 100, y: 50 });
        expect(receivedElements).toEqual({ viewport, marker });
      },
    });
    expect(calls).toBe(1);
    expect(marker.getAttribute('transform')).toBe('rotate(10)');
    controller.dispose();
  });

  test('rerenders when the SVG viewport resizes while retaining its attributes', () => {
    const { viewport, marker } = elements();
    let width = 200;
    (viewport as unknown as { getBoundingClientRect: () => { left: number; top: number; width: number; height: number } }).getBoundingClientRect = () => ({ left: 10, top: 20, width, height: 100 });
    let resizeTarget: object | undefined;
    let resize: (() => void) | undefined;
    const platform = {
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
      observeResize: (target: object, callback: () => void) => {
        resizeTarget = target;
        resize = callback;
        return () => undefined;
      },
    };
    const controller = animateSvg({ viewport, marker }, motion({ x: 0.5, y: 0 }), { autoplay: false, platform });
    const initial = marker.getAttribute('transform');
    width = 400;
    resize?.();

    expect(resizeTarget).toBe(viewport);
    expect(initial).toBe('translate(75 25) scale(1) rotate(10)');
    expect(marker.getAttribute('transform')).toBe('translate(100 25) scale(1) rotate(10)');
    expect(viewport.getAttribute('width')).toBe('200');
    expect(viewport.getAttribute('viewBox')).toBe('0 0 100 50');
    controller.dispose();
  });
});

describe('SVG helpers', () => {
  test('retains separate helix subpaths across wraps, paused reprojection, and eviction', () => {
    const motion = createHelixMotion({ periodSeconds: 1, turns: 1 });
    const { viewport, path } = elements();
    const trail = createSvgTrail({ viewport, path, maxSamples: 4 });
    const render = (time: number, multiplier = 1) => {
      const sample = motion.sample(time);
      trail.render({ ...worldFrame(sample.pose, time, multiplier), ...sample });
      return path.getAttribute('d')!;
    };
    const commands = (data: string) => data.match(/[ML]/g);
    render(0.75);
    render(0.875);
    expect(commands(render(1))).toEqual(['M', 'L', 'M']);
    const advanced = render(1.125);
    expect(commands(advanced)).toEqual(['M', 'L', 'M', 'L']);
    const reprojected = render(1.125, 10);
    expect(reprojected).toBe(advanced.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (coordinate) => String(Number(coordinate) * 10)));
    expect(render(1.125, 10)).toBe(reprojected);
    expect(commands(render(2))).toEqual(['M', 'M', 'L', 'M']);
    expect(commands(render(2.125))).toEqual(['M', 'L', 'M', 'L']);
    expect(render(0)).toBe('M 0.5 0');
    trail.clear();
    expect(path.getAttribute('d')).toBe('');
    expect(commands(render(0.125))).toEqual(['M']);
    trail.dispose();
    expect(path.getAttribute('d')).toBe('M 0 0');
  });

  test('breaks helix static paths at the endpoint while leaving closed curves continuous', () => {
    const { viewport, path } = elements();
    const helix = createSvgStaticPath({ viewport, path, motion: createHelixMotion({ periodSeconds: 1, turns: 1 }), maxSegments: 4 });
    expect(path.getAttribute('d')!.match(/[ML]/g)).toEqual(['M', 'L', 'L', 'L', 'M']);
    helix.dispose();
    const ellipse = createSvgStaticPath({ viewport, path, motion: createEllipseMotion(), maxSegments: 4 });
    expect(path.getAttribute('d')!.match(/[ML]/g)).toEqual(['M', 'L', 'L', 'L', 'L']);
    ellipse.dispose();
  });

  test('reprojects paused history without eviction and snapshots mutable poses', () => {
    const { viewport, path } = elements();
    const trail = createSvgTrail<undefined>({ viewport, path, maxSamples: 2 });
    const pose = { x: 1, y: 1 };
    trail.render(worldFrame(pose, 1));
    pose.x = 2;
    pose.y = 2;
    trail.render(worldFrame(pose, 2));
    const paused = worldFrame({ x: 3, y: 3 }, 2, 2);
    trail.render(paused);
    trail.render(paused);
    expect(path.getAttribute('d')).toBe('M 1 1 L 3 3');
    trail.clear();
    expect(path.getAttribute('d')).toBe('');
    trail.render(paused);
    expect(path.getAttribute('d')).toBe('M 3 3');
    trail.dispose();
    expect(path.getAttribute('d')).toBe('M 0 0');
  });

  test('rejects invalid trail capacities', () => {
    const { viewport, path } = elements();
    for (const maxSamples of [Infinity, -Infinity, NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createSvgTrail({ viewport, path, maxSamples })).toThrow(RangeError);
    }
  });

  test('maps none, meet, and slice preserveAspectRatio modes in local coordinates', () => {
    const { viewport } = elements();
    const localViewport = viewport as unknown as {
      clientWidth: number; clientHeight: number;
      viewBox: { baseVal: { x: number; y: number; width: number; height: number } };
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
    };
    localViewport.clientWidth = 200;
    localViewport.clientHeight = 100;
    localViewport.viewBox.baseVal = { x: 0, y: 0, width: 100, height: 100 };
    localViewport.getBoundingClientRect = () => ({ left: -300, top: 700, width: 75, height: 240 });

    viewport.setAttribute('preserveAspectRatio', 'none');
    expect(cssPointToSvgPoint(viewport, { x: 100, y: 50 })).toEqual({ x: 50, y: 50 });
    viewport.setAttribute('preserveAspectRatio', 'xMaxYMin meet');
    expect(cssPointToSvgPoint(viewport, { x: 100, y: 50 })).toEqual({ x: 0, y: 50 });
    viewport.setAttribute('preserveAspectRatio', 'xMinYMax slice');
    expect(cssPointToSvgPoint(viewport, { x: 0, y: 0 })).toEqual({ x: 0, y: 50 });
  });

  test('maps marker and path points through transformed parent groups', () => {
    const { viewport, marker, path } = elements();
    const root = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20, inverse: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: -5, f: -10 }) };
    const group = { getScreenCTM: () => ({ a: 4, b: 0, c: 0, d: 4, e: 10, f: 20, inverse: () => ({ a: 0.25, b: 0, c: 0, d: 0.25, e: -2.5, f: -5 }) }) };
    (viewport as unknown as { getScreenCTM: () => typeof root }).getScreenCTM = () => root;
    (marker as unknown as { parentElement: typeof group }).parentElement = group;
    (path as unknown as { parentElement: typeof group }).parentElement = group;
    const current = worldFrame({ x: 100, y: 50 }, 1);
    const trail = createSvgTrail<undefined>({ viewport, path });

    renderSvgMarker(current, { viewport, marker });
    trail.render(current);
    expect(marker.getAttribute('transform')).toBe('translate(25 12.5) scale(1) rotate(10)');
    expect(path.getAttribute('d')).toBe('M 25 12.5');
    trail.dispose();
  });

  test('composes a trail with the reusable default marker renderer', () => {
    const { viewport, marker, path } = elements();
    const trail = createSvgTrail<undefined>({ viewport, path });
    const current = worldFrame({ x: 100, y: 50, depth: 0.5, opacity: 0.25 }, 1);

    trail.render(current);
    renderSvgMarker(current, { viewport, marker });

    expect(path.getAttribute('d')).toBe('M 50 25');
    expect(marker.getAttribute('transform')).toBe('translate(50 25) scale(0.5) rotate(10)');
    expect(marker.getAttribute('opacity')).toBe('0.25');
    trail.dispose();
  });

  test('keeps trail samples bounded and restores the consumer path', () => {
    const { viewport, path } = elements();
    const trail = createSvgTrail<undefined>({ viewport, path, maxSamples: 2 });
    trail.render(frame(1, 1));
    trail.render(frame(2, 2));
    trail.render(frame(3, 3));

    expect(path.getAttribute('d')).toBe('M 1 1 L 1.5 1.5');
    trail.dispose();
    expect(path.getAttribute('d')).toBe('M 0 0');
  });

  test('reprojects retained world poses on resize and clears when elapsed time resets', () => {
    const { viewport, path } = elements();
    const trail = createSvgTrail<undefined>({ viewport, path, maxSamples: 3 });
    trail.render(worldFrame({ x: 1, y: 1 }, 1));
    trail.render(worldFrame({ x: 2, y: 2 }, 2, 2));

    // The first point is recomputed with the second frame's projector: (1, 1)
    // becomes CSS (2, 2), then SVG user coordinates (1, 1).
    expect(path.getAttribute('d')).toMatch(/^M 1 1 L 2 2$/);
    trail.render(worldFrame({ x: 3, y: 3 }, 0, 2));
    expect(path.getAttribute('d')).toBe('M 3 3');
    trail.dispose();
  });

  test('draws only analytic full paths and restores the supplied path', () => {
    const { viewport, path } = elements();
    const rendered = createSvgStaticPath({ viewport, path, motion: motion({ x: 0, y: 0 }), maxSegments: 4 });
    expect(path.getAttribute('d')).toContain('M 50 25');
    rendered.update({ fit: 'contain' });
    rendered.dispose();
    expect(path.getAttribute('d')).toBe('M 0 0');
  });
});

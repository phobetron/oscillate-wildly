import { createHelixMotion } from '../../src/motions/helix';
import { createEllipseMotion } from '../../src/motions/ellipse';
import { describe, expect, it } from '@rstest/core';
import { animateCanvas, renderCanvasMarker } from '../../src/canvas';
import { createCanvasTrail } from '../../src/canvas/trail';
import { createCanvasPath } from '../../src/canvas/path';
import type { AnalyticMotionSource, MotionSource } from '../../src/core';
import type { Frame } from '../../src/runtime';

type Operation = readonly [string, ...number[]];

const context = () => {
  const operations: Operation[] = [];
  let alpha = 1;
  const value = {
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    save: () => operations.push(['save']), restore: () => operations.push(['restore']),
    setTransform: (...values: number[]) => operations.push(['setTransform', ...values]),
    scale: (...values: number[]) => operations.push(['scale', ...values]),
    clearRect: (...values: number[]) => operations.push(['clearRect', ...values]),
    beginPath: () => operations.push(['beginPath']),
    arc: (...values: number[]) => operations.push(['arc', ...values]),
    fill: () => operations.push(['fill']),
    moveTo: (...values: number[]) => operations.push(['moveTo', ...values]),
    lineTo: (...values: number[]) => operations.push(['lineTo', ...values]),
    stroke: () => operations.push(['stroke']),
    drawImage: (_image: CanvasImageSource, ...values: number[]) => operations.push(['drawImage', ...values]),
  };
  Object.defineProperty(value, 'globalAlpha', {
    get: () => alpha,
    set: (next: number) => { alpha = next; operations.push(['globalAlpha', next]); },
  });
  return { value: value as unknown as CanvasRenderingContext2D, operations };
};

const source = (): MotionSource<{ value: number }> => ({
  kind: 'analytic', periodSeconds: 1,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  sample: () => ({ state: { value: 1 }, pose: { x: 0, y: 0 } }), reset: () => undefined,
});

const canvas = (drawing: CanvasRenderingContext2D) => ({
  width: 400, height: 200,
  getContext: () => drawing,
  getBoundingClientRect: () => ({ width: 200, height: 100 }),
}) as unknown as HTMLCanvasElement;

describe('animateCanvas', () => {
  it('preserves configured bitmap dimensions and renders in CSS pixels', () => {
    const drawing = context();
    const target = canvas(drawing.value);
    const controller = animateCanvas(target, source(), { autoplay: false });

    expect(target.width).toBe(400);
    expect(target.height).toBe(200);
    expect(drawing.operations).toContainEqual(['clearRect', 0, 0, 400, 200]);
    expect(drawing.operations).toContainEqual(['scale', 2, 2]);
    expect(drawing.operations).toContainEqual(['arc', 100, 50, 5, 0, Math.PI * 2]);
    controller.dispose();
  });

  it('replaces the marker with a custom renderer while retaining the canvas clip', () => {
    const drawing = context();
    let position: { x: number; y: number } | undefined;
    const controller = animateCanvas(canvas(drawing.value), source(), {
      autoplay: false,
      framing: { offsetX: 1 },
      render: (_context, frame) => { position = frame.position; },
    });

    expect(position).toEqual(expect.objectContaining({ x: 300, y: 50 }));
    expect(drawing.operations.some(([name]) => name === 'arc')).toBe(false);
    expect(drawing.operations).toContainEqual(['clearRect', 0, 0, 400, 200]);
    controller.dispose();
  });
});

const frame = (x: number, y: number, elapsedSeconds = x): Frame<undefined> => ({
  state: undefined, pose: { x, y }, position: { x, y, scaleX: 1, scaleY: 1 },
  viewport: { width: 100, height: 100 }, elapsedSeconds,
  project: (pose) => ({ ...pose, scaleX: 1, scaleY: 1 }),
});

describe('Canvas helpers', () => {
  it('retains separate helix strokes across wraps, paused reprojection, and eviction', () => {
    const motion = createHelixMotion({ periodSeconds: 1, turns: 1 });
    const drawing = context();
    const trail = createCanvasTrail({ maxSamples: 4 });
    const render = (time: number, multiplier = 1) => {
      drawing.operations.length = 0;
      const sample = motion.sample(time);
      trail(drawing.value, {
        ...frame(0, 0, time), ...sample,
        project: (pose) => ({ x: pose.x * multiplier, y: pose.y * multiplier, scaleX: multiplier, scaleY: multiplier }),
      });
      return drawing.operations.filter(([name]) => name === 'moveTo' || name === 'lineTo');
    };
    render(0.75);
    render(0.875);
    const wrapped = render(1);
    expect(wrapped.map(([name]) => name)).toEqual(['moveTo', 'lineTo', 'moveTo']);
    const advanced = render(1.125);
    expect(advanced.map(([name]) => name)).toEqual(['moveTo', 'lineTo', 'moveTo', 'lineTo']);
    expect(render(1.125, 10)).toEqual(advanced.map(([name, x, y]) => [name, x * 10, y * 10]));
    expect(render(1.125, 10)).toHaveLength(4);
    expect(render(2).map(([name]) => name)).toEqual(['moveTo', 'moveTo', 'lineTo', 'moveTo']);
    expect(render(2.125).map(([name]) => name)).toEqual(['moveTo', 'lineTo', 'moveTo', 'lineTo']);
    expect(render(0)).toEqual([]);
    trail.clear();
    expect(render(0.125)).toEqual([]);
  });

  it('breaks helix full paths at the period endpoint while leaving closed curves continuous', () => {
    const drawing = context();
    const helixMotion = createHelixMotion({ periodSeconds: 1, turns: 1 });
    const helix = createCanvasPath(helixMotion, { maxSegments: 4 });
    helix(drawing.value, { ...frame(0, 0), ...helixMotion.sample(0) });
    expect(drawing.operations.filter(([name]) => name === 'moveTo' || name === 'lineTo').map(([name]) => name))
      .toEqual(['moveTo', 'lineTo', 'lineTo', 'lineTo', 'moveTo']);
    expect(drawing.operations).toContainEqual(['moveTo', 1, 0]);
    drawing.operations.length = 0;
    const ellipse = createEllipseMotion();
    createCanvasPath(ellipse, { maxSegments: 4 })(drawing.value, { ...frame(0, 0), ...ellipse.sample(0) });
    expect(drawing.operations.filter(([name]) => name === 'moveTo')).toHaveLength(1);
    expect(drawing.operations.filter(([name]) => name === 'lineTo')).toHaveLength(4);
  });

  it('reprojects paused history without evicting samples and snapshots mutable poses', () => {
    const drawing = context();
    const trail = createCanvasTrail<undefined>({ maxSamples: 2 });
    const pose = { x: 1, y: 1 };
    trail(drawing.value, { ...frame(1, 1), pose });
    pose.x = 2;
    pose.y = 2;
    trail(drawing.value, { ...frame(2, 2), pose });
    drawing.operations.length = 0;
    const paused = {
      ...frame(3, 3, 2),
      project: (sample: typeof pose) => ({ x: sample.x * 10, y: sample.y * 10, scaleX: 10, scaleY: 10 }),
    };
    trail(drawing.value, paused);
    trail(drawing.value, paused);
    expect(drawing.operations.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 10, 10], ['moveTo', 10, 10],
    ]);
    expect(drawing.operations).toContainEqual(['lineTo', 30, 30]);
    trail.clear();
    drawing.operations.length = 0;
    trail(drawing.value, paused);
    expect(drawing.operations).toEqual([]);
  });

  it('rejects invalid trail capacities', () => {
    for (const maxSamples of [Infinity, -Infinity, NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createCanvasTrail({ maxSamples })).toThrow(RangeError);
    }
  });

  it('keeps world-space history bounded and reprojects it after a resize', () => {
    const drawing = context();
    const trail = createCanvasTrail<undefined>({ maxSamples: 2 });
    trail(drawing.value, frame(1, 1));
    trail(drawing.value, frame(2, 2));
    const resized: Frame<undefined> = {
      ...frame(3, 3),
      project: (pose) => ({ ...pose, x: pose.x * 10, y: pose.y * 10, scaleX: 10, scaleY: 10 }),
    };
    trail(drawing.value, resized);

    expect(drawing.operations).toContainEqual(['moveTo', 20, 20]);
    expect(drawing.operations).toContainEqual(['lineTo', 30, 30]);
  });

  it('clears trail history after a controller reset', () => {
    const drawing = context();
    const trail = createCanvasTrail<undefined>();
    trail(drawing.value, { ...frame(1, 1), elapsedSeconds: 1 });
    trail(drawing.value, { ...frame(2, 2), elapsedSeconds: 2 });
    trail(drawing.value, { ...frame(0, 0), elapsedSeconds: 0 });

    expect(drawing.operations.filter(([name]) => name === 'stroke')).toHaveLength(1);
  });

  it('caches an analytic path until its projected viewport changes', () => {
    let samples = 0;
    const analytic: AnalyticMotionSource<undefined> = {
      kind: 'analytic', periodSeconds: 1,
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      sample: (time) => { samples += 1; return { state: undefined, pose: { x: time, y: time } }; },
      reset: () => undefined,
    };
    const path = createCanvasPath(analytic, { maxSegments: 32 });
    const drawing = context();
    path(drawing.value, frame(0, 0));
    const afterFirst = samples;
    path(drawing.value, frame(0, 0));

    expect(afterFirst).toBeGreaterThan(0);
    expect(samples).toBe(afterFirst);
  });

  it('uses the current frame projection after a framing update', () => {
    const analytic: AnalyticMotionSource<undefined> = {
      kind: 'analytic', periodSeconds: 1,
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      sample: (time) => ({ state: undefined, pose: { x: time, y: time } }),
      reset: () => undefined,
    };
    const path = createCanvasPath(analytic, { maxSegments: 32 });
    const drawing = context();
    path(drawing.value, frame(0, 0));
    const zoomed: Frame<undefined> = {
      ...frame(0, 0),
      project: (pose) => ({ ...pose, x: pose.x * 2 + 10, y: pose.y * 2, scaleX: 2, scaleY: 2 }),
    };
    path(drawing.value, zoomed);

    expect(drawing.operations).toContainEqual(['moveTo', 10, 0]);
    expect(drawing.operations).toContainEqual(['lineTo', 12, 2]);
  });
});

describe('renderCanvasMarker', () => {
  it('honors marker customization', () => {
    const drawing = context();
    renderCanvasMarker(drawing.value, frame(3, 4), { radius: 7, color: 'blue' });
    expect(drawing.operations).toContainEqual(['arc', 3, 4, 7, 0, Math.PI * 2]);
    expect(drawing.value.fillStyle).toBe('blue');
  });

  it('applies helix opacity and depth channels without leaking canvas state', () => {
    const drawing = context();
    renderCanvasMarker(drawing.value, {
      ...frame(3, 4),
      pose: { x: 3, y: 4, depth: 2, opacity: 0.25 },
    }, { radius: 7 });
    expect(drawing.operations).toContainEqual(['arc', 3, 4, 14, 0, Math.PI * 2]);
    expect(drawing.operations).toContainEqual(['globalAlpha', 0.25]);
    expect(drawing.operations).toContainEqual(['save']);
    expect(drawing.operations).toContainEqual(['restore']);
  });
});

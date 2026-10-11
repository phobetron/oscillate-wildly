import { describe, expect, it } from '@rstest/core';
import { createCanvasPath } from '../../../src/canvas/path';
import { createHelixMotion } from '../../../src/motions/helix';
import { createEllipseMotion } from '../../../src/motions/ellipse';
import type { AnalyticMotionSource } from '../../../src/core';
import type { Frame } from '../../../src/runtime';
import { context, frame } from './fixtures';

describe('createCanvasPath', () => {
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

  it('reuses sampled geometry until framing changes, then draws the new projection', () => {
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
    const initialSamples = samples;
    const initialDrawing = [...drawing.operations];

    drawing.operations.length = 0;
    path(drawing.value, frame(0, 0));

    expect(initialSamples).toBeGreaterThan(0);
    expect(samples).toBe(initialSamples);
    expect(drawing.operations).toEqual(initialDrawing);

    const zoomed: Frame<undefined> = {
      ...frame(0, 0),
      project: (pose) => ({ ...pose, x: pose.x * 2 + 10, y: pose.y * 2, scaleX: 2, scaleY: 2 }),
    };
    drawing.operations.length = 0;
    path(drawing.value, zoomed);

    expect(samples).toBeGreaterThan(initialSamples);
    expect(drawing.operations).toContainEqual(['moveTo', 10, 0]);
    expect(drawing.operations).toContainEqual(['lineTo', 12, 2]);
  });
});

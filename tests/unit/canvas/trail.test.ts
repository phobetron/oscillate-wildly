import { invalidCapacities } from '../support/adapters';
import { describe, expect, it } from '@rstest/core';
import { createCanvasTrail } from '../../../src/canvas/trail';
import { createHelixMotion } from '../../../src/motions/helix';
import type { Frame } from '../../../src/runtime';
import { context, frame } from './fixtures';

describe('createCanvasTrail', () => {
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

  it.each(invalidCapacities)('rejects %s trail capacity', (_case, maxSamples) => {
    expect(() => createCanvasTrail({ maxSamples })).toThrow(RangeError);
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
});

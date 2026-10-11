import { invalidCapacities } from '../support/adapters';
import { describe, expect, test } from '@rstest/core';
import { createSvgTrail } from '../../../src/svg/trail';
import { createHelixMotion } from '../../../src/motions/helix';
import { elements, frame, worldFrame } from './fixtures';

describe('createSvgTrail', () => {
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
  });

  test.each(invalidCapacities)('rejects %s trail capacity', (_case, maxSamples) => {
    const { viewport, path } = elements();
    expect(() => createSvgTrail({ viewport, path, maxSamples })).toThrow(RangeError);
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
});

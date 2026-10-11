import { describe, expect, test } from '@rstest/core';
import { createSvgTrail } from '../../../src/svg/trail';
import { renderSvgMarker } from '../../../src/svg';
import { elements, worldFrame } from './fixtures';

describe('renderSvgMarker', () => {
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
});

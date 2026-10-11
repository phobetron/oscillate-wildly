import { describe, expect, test } from '@rstest/core';
import { cssPointToSvgPoint } from '../../../src/svg/coordinates';
import { createSvgTrail } from '../../../src/svg/trail';
import { renderSvgMarker } from '../../../src/svg';
import { elements, worldFrame } from './fixtures';

describe('SVG coordinates', () => {
  test('maps none, meet, and slice preserveAspectRatio modes in local coordinates', () => {
    const { viewport, localViewport } = elements();
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
});

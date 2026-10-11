import { describe, expect, test } from '@rstest/core';
import { createSvgStaticPath } from '../../../src/svg/path';
import { createHelixMotion } from '../../../src/motions/helix';
import { createEllipseMotion } from '../../../src/motions/ellipse';
import { fixedMotion } from '../support/adapters';
import { elements } from './fixtures';

describe('createSvgStaticPath', () => {
  test('breaks helix static paths at the endpoint while leaving closed curves continuous', () => {
    const { viewport, path } = elements();
    const helix = createSvgStaticPath({ viewport, path, motion: createHelixMotion({ periodSeconds: 1, turns: 1 }), maxSegments: 4 });
    expect(path.getAttribute('d')!.match(/[ML]/g)).toEqual(['M', 'L', 'L', 'L', 'M']);
    helix.dispose();
    const ellipse = createSvgStaticPath({ viewport, path, motion: createEllipseMotion(), maxSegments: 4 });
    expect(path.getAttribute('d')!.match(/[ML]/g)).toEqual(['M', 'L', 'L', 'L', 'L']);
    ellipse.dispose();
  });

  test('redraws after framing changes and restores the supplied path on disposal', () => {
    const { viewport, path } = elements();
    const rendered = createSvgStaticPath({ viewport, path, motion: fixedMotion({ x: 0, y: 0 }), maxSegments: 4 });
    expect(path.getAttribute('d')).toBe('M 50 25 L 50 25');

    rendered.update({ offsetX: 0.5 });

    expect(path.getAttribute('d')).toBe('M 100 25 L 100 25');
    rendered.dispose();
    expect(path.getAttribute('d')).toBe('M 0 0');
  });
});

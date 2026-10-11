import { describe, expect, test } from '@rstest/core';
import { animateSvg } from '../../../src/svg';
import { fixedMotion } from '../support/adapters';
import { elements } from './fixtures';

describe('animateSvg', () => {
  test('uses local viewport dimensions despite outer transforms and honors preserveAspectRatio', () => {
    const { viewport, marker, localViewport } = elements();
    localViewport.clientWidth = 200;
    localViewport.clientHeight = 100;
    localViewport.viewBox.baseVal = { x: 0, y: 0, width: 100, height: 100 };
    viewport.setAttribute('preserveAspectRatio', 'xMaxYMin meet');
    // This is a rotated/scaled screen rect. It must not affect local mapping.
    localViewport.getBoundingClientRect = () => ({ left: 800, top: 120, width: 100, height: 250 });

    const controller = animateSvg({ viewport, marker }, fixedMotion({ x: 0, y: 0 }), { autoplay: false });
    expect(marker.getAttribute('transform')).toBe('translate(0 50) scale(1) rotate(10)');
    controller.dispose();
  });

  test('leaves consumer SVG dimensions, viewBox, and overflow untouched', () => {
    const { viewport, marker } = elements();
    const controller = animateSvg({ viewport, marker }, fixedMotion({ x: 0, y: 0, depth: 0.5, opacity: 0.25 }), { autoplay: false });

    expect(viewport.getAttribute('width')).toBe('200');
    expect(viewport.getAttribute('height')).toBe('100');
    expect(viewport.getAttribute('viewBox')).toBe('0 0 100 50');
    expect(viewport.style.overflow).toBe('visible');
    expect(marker.getAttribute('transform')).toBe('translate(50 25) scale(0.5) rotate(10)');
    expect(marker.getAttribute('opacity')).toBe('0.25');
    controller.dispose();
    expect(marker.getAttribute('transform')).toBe('rotate(10)');
    expect(marker.getAttribute('opacity')).toBe('0.7');
  });

  test('hands custom renderers the unmodified frame and supplied elements', () => {
    const { viewport, marker } = elements();
    let calls = 0;
    const controller = animateSvg({ viewport, marker }, fixedMotion({ x: 0, y: 0 }), {
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
    const { viewport, marker, localViewport } = elements();
    let width = 200;
    localViewport.getBoundingClientRect = () => ({ left: 10, top: 20, width, height: 100 });
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
    const controller = animateSvg({ viewport, marker }, fixedMotion({ x: 0.5, y: 0 }), { autoplay: false, platform });
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

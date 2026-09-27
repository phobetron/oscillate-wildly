import { describe, expect, test } from '@rstest/core';
import type { AnalyticMotionSource, MotionSample, Pose } from '../../src/core';
import { animateDom } from '../../src/dom';

interface TestState {
  readonly id: string;
}

const motion = (pose: Pose): AnalyticMotionSource<TestState> => ({
  kind: 'analytic',
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  periodSeconds: 1,
  sample: (): MotionSample<TestState> => ({ state: { id: 'still' }, pose }),
  reset: () => undefined,
});

const element = (
  width: number,
  height: number,
  style: Partial<CSSStyleDeclaration> = {},
): HTMLElement => ({
  style: { transform: '', opacity: '', ...style },
  getBoundingClientRect: () => ({ width, height }),
}) as unknown as HTMLElement;

describe('animateDom', () => {
  test('requires existing viewport and marker elements', () => {
    const marker = element(0, 0);

    expect(() => animateDom(
      { viewport: undefined, marker } as unknown as { viewport: HTMLElement; marker: HTMLElement },
      motion({ x: 0, y: 0 }),
      { autoplay: false },
    )).toThrow('animateDom requires a viewport element');
  });

  test('does not change viewport sizing or overflow styles', () => {
    const viewport = element(200, 100, { width: '200px', height: '100px', overflow: 'visible' });
    const marker = element(0, 0);

    const controller = animateDom({ viewport, marker }, motion({ x: 0, y: 0 }), { autoplay: false });

    expect(viewport.style.width).toBe('200px');
    expect(viewport.style.height).toBe('100px');
    expect(viewport.style.overflow).toBe('visible');
    controller.dispose();
  });

  test('uses viewport-relative CSS pixels and restores marker styles on dispose', () => {
    const viewport = element(200, 100);
    const marker = element(0, 0, { transform: 'rotate(10deg)', opacity: '0.7' });

    const controller = animateDom(
      { viewport, marker },
      motion({ x: 0, y: 0, depth: 0.5, opacity: 0.25 }),
      { autoplay: false },
    );

    expect(marker.style.transform).toBe('translate(100px, 50px) translate(-50%, -50%) scale(0.5) rotate(10deg)');
    expect(marker.style.opacity).toBe('0.25');
    controller.dispose();
    expect(marker.style.transform).toBe('rotate(10deg)');
    expect(marker.style.opacity).toBe('0.7');
  });

  test('hands the complete frame and elements to a custom renderer', () => {
    const viewport = element(200, 100);
    const marker = element(0, 0, { transform: 'rotate(10deg)', opacity: '0.7' });
    let calls = 0;

    const controller = animateDom({ viewport, marker }, motion({ x: 0, y: 0 }), {
      autoplay: false,
      render: (frame, targets) => {
        calls += 1;
        expect(frame.position).toMatchObject({ x: 100, y: 50 });
        expect(frame.project({ x: 1, y: 1 })).toMatchObject({ x: 200, y: 150 });
        expect(targets).toEqual({ viewport, marker });
      },
    });

    expect(calls).toBe(1);
    expect(marker.style.transform).toBe('rotate(10deg)');
    expect(marker.style.opacity).toBe('0.7');
    controller.dispose();
  });

  test('allows independent controllers for multiple markers in one viewport', () => {
    const viewport = element(100, 100);
    const firstMarker = element(0, 0);
    const secondMarker = element(0, 0);

    const first = animateDom({ viewport, marker: firstMarker }, motion({ x: 0, y: 0 }), { autoplay: false });
    const second = animateDom({ viewport, marker: secondMarker }, motion({ x: 0, y: 0 }), { autoplay: false });

    expect(firstMarker.style.transform).toBe('translate(50px, 50px) translate(-50%, -50%)');
    expect(secondMarker.style.transform).toBe('translate(50px, 50px) translate(-50%, -50%)');
    first.dispose();
    second.dispose();
  });

  test('does not render when the viewport has zero size', () => {
    const viewport = element(0, 100);
    const marker = element(0, 0, { transform: 'rotate(10deg)', opacity: '0.7' });

    const controller = animateDom({ viewport, marker }, motion({ x: 0, y: 0, opacity: 0.25 }), { autoplay: false });

    expect(marker.style.transform).toBe('rotate(10deg)');
    expect(marker.style.opacity).toBe('0.7');
    controller.dispose();
  });
});

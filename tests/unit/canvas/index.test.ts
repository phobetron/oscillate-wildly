import { describe, expect, it } from '@rstest/core';
import { animateCanvas, renderCanvasMarker } from '../../../src/canvas';
import { fixedMotion } from '../support/adapters';
import { canvas, context, frame } from './fixtures';

describe('Canvas adapter and marker', () => {
  it('preserves configured bitmap dimensions and renders in CSS pixels', () => {
    const drawing = context();
    const target = canvas(drawing.value);
    const controller = animateCanvas(target, fixedMotion(), { autoplay: false });

    expect(target.width).toBe(400);
    expect(target.height).toBe(200);
    expect(drawing.operations).toContainEqual(['clearRect', 0, 0, 400, 200]);
    expect(drawing.operations).toContainEqual(['scale', 2, 2]);
    expect(drawing.operations).toContainEqual(['arc', 100, 50, 5, 0, Math.PI * 2]);
    controller.dispose();
  });

  it('replaces the marker with a custom renderer while clearing the backing bitmap', () => {
    const drawing = context();
    let position: { x: number; y: number } | undefined;
    const controller = animateCanvas(canvas(drawing.value), fixedMotion(), {
      autoplay: false,
      framing: { offsetX: 1 },
      render: (_context, frame) => { position = frame.position; },
    });

    expect(position).toEqual(expect.objectContaining({ x: 300, y: 50 }));
    expect(drawing.operations.some(([name]) => name === 'arc')).toBe(false);
    expect(drawing.operations).toContainEqual(['clearRect', 0, 0, 400, 200]);
    controller.dispose();
  });

  it('honors marker customization', () => {
    const drawing = context();
    renderCanvasMarker(drawing.value, frame(3, 4), { radius: 7, color: 'blue' });
    expect(drawing.operations).toContainEqual(['arc', 3, 4, 7, 0, Math.PI * 2]);
    expect(drawing.value.fillStyle).toBe('blue');
  });

  it('applies opacity and depth between saving and restoring canvas state', () => {
    const drawing = context();
    renderCanvasMarker(drawing.value, {
      ...frame(3, 4),
      pose: { x: 3, y: 4, depth: 2, opacity: 0.25 },
    }, { radius: 7 });
    expect(drawing.operations).toContainEqual(['arc', 3, 4, 14, 0, Math.PI * 2]);
    expect(drawing.operations).toContainEqual(['globalAlpha', 0.25]);
    expect(drawing.operations[0]).toEqual(['save']);
    expect(drawing.operations.at(-1)).toEqual(['restore']);
  });
});

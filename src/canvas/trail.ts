import type { CanvasRenderer } from '../canvas';
import type { Pose } from '../core';
import { createTrailHistory } from '../runtime/trail';

export interface CanvasTrailOptions {
  /** Maximum retained positions. Must be a positive safe integer. Defaults to 128. */
  readonly maxSamples?: number;
  readonly color?: string | CanvasGradient | CanvasPattern;
  /** Line width in CSS pixels. Defaults to 1. */
  readonly width?: number;
}

export type CanvasTrailRenderer<State> = CanvasRenderer<State> & { clear(): void };

/**
 * Returns a bounded history renderer. Call it before a marker in a custom
 * Canvas renderer to draw the trail behind that marker.
 */
export const createCanvasTrail = <State>(
  options: CanvasTrailOptions = {},
): CanvasTrailRenderer<State> => {
  const history = createTrailHistory<Pose>(options.maxSamples);

  const render: CanvasTrailRenderer<State> = (context, frame) => {
    history.add({ ...frame.pose }, frame.elapsedSeconds);
    const samples = history.values();
    if (samples.length < 2) return;

    context.save();
    try {
      context.strokeStyle = options.color ?? 'rgba(255, 0, 0, 0.45)';
      context.lineWidth = options.width ?? 1;
      context.beginPath();
      const first = frame.project(samples[0]);
      context.moveTo(first.x, first.y);
      for (let index = 1; index < samples.length; index += 1) {
        const position = frame.project(samples[index]);
        context.lineTo(position.x, position.y);
      }
      context.stroke();
    } finally {
      context.restore();
    }
  };
  render.clear = history.clear;
  return render;
};

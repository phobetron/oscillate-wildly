import { createController } from '../runtime';
import type { Controller, Frame } from '../runtime';
import type { Framing, MotionSource } from '../core';

/** A Canvas 2D render callback. Coordinates are CSS pixels. */
export type CanvasRenderer<State> = (
  context: CanvasRenderingContext2D,
  frame: Frame<State>,
) => void;

export interface CanvasMarkerOptions {
  /** Marker radius in CSS pixels. Defaults to 5. */
  readonly radius?: number;
  /** Any Canvas 2D fill style. Defaults to red. */
  readonly color?: string | CanvasGradient | CanvasPattern;
}

export interface AnimateCanvasOptions<State> {
  readonly framing?: Framing;
  readonly autoplay?: boolean;
  /** Lets the controller stop work while the canvas is outside the viewport. */
  readonly offscreen?: boolean;
  /** Clear the complete backing bitmap before each render. Defaults to true. */
  readonly clear?: boolean;
  readonly marker?: CanvasMarkerOptions;
  /** Replaces the built-in marker renderer. */
  readonly render?: CanvasRenderer<State>;
}

const cssViewport = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
};

/** Draws the standard oscillate-wildly Canvas marker. */
export const renderCanvasMarker = <State>(
  context: CanvasRenderingContext2D,
  frame: Frame<State>,
  options: CanvasMarkerOptions = {},
): void => {
  context.save();
  try {
    context.fillStyle = options.color ?? 'red';
    context.globalAlpha = frame.pose.opacity ?? 1;
    const depthScale = frame.pose.depth ?? 1;
    context.beginPath();
    context.arc(
      frame.position.x,
      frame.position.y,
      (options.radius ?? 5) * depthScale,
      0,
      Math.PI * 2,
    );
    context.fill();
  } finally {
    context.restore();
  }
};

/**
 * Animates a motion source on an existing canvas without changing its bitmap
 * dimensions or CSS sizing. Render callbacks receive a context scaled to CSS
 * pixels so they can use Frame.position directly.
 */
export const animateCanvas = <State>(
  canvas: HTMLCanvasElement,
  motion: MotionSource<State>,
  options: AnimateCanvasOptions<State> = {},
): Controller => {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new TypeError('canvas must provide a 2D rendering context');
  }

  return createController({
    target: canvas,
    source: motion,
    measureViewport: () => cssViewport(canvas),
    framing: options.framing,
    autoplay: options.autoplay,
    offscreen: options.offscreen ?? true,
    render: (frame: Frame<State>) => {
      const viewport = cssViewport(canvas);
      const scaleX = canvas.width / viewport.width;
      const scaleY = canvas.height / viewport.height;

      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        if (options.clear ?? true) {
          context.clearRect(0, 0, canvas.width, canvas.height);
        }
        context.scale(scaleX, scaleY);
        if (options.render) {
          options.render(context, frame);
        } else {
          renderCanvasMarker(context, frame, options.marker);
        }
      } finally {
        context.restore();
      }
    },
  });
};

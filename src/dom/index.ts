import type { Framing, MarkerScaleOptions, MotionSource } from '../core';
import { createController } from '../runtime';
import type { Controller, Frame } from '../runtime';

/**
 * Elements used by {@link animateDom}.
 *
 * The viewport must establish the marker's containing block, for example:
 *
 * ```css
 * .motion-viewport { position: relative; }
 * .motion-marker { position: absolute; left: 0; top: 0; }
 * ```
 *
 * `animateDom` deliberately does not set these layout styles, viewport size, or
 * overflow. This lets the surrounding application control clipping and layout.
 */
export interface DomTargets {
  readonly viewport: HTMLElement;
  readonly marker: HTMLElement;
}

/** Receives each frame when a consumer replaces the default marker renderer. */
export type DomRender<State> = (frame: Frame<State>, targets: DomTargets) => void;

export interface AnimateDomOptions<State> {
  readonly framing?: Framing;
  readonly markerScale?: MarkerScaleOptions;
  readonly autoplay?: boolean;
  /** Replaces the default transform, depth, and opacity rendering completely. */
  readonly render?: DomRender<State>;
}

const required = <ElementType>(value: ElementType | null | undefined, name: string): ElementType => {
  if (value === null || value === undefined) {
    throw new TypeError(`animateDom requires a ${name} element`);
  }
  return value;
};

const translatedTransform = (
  x: number,
  y: number,
  depth: number | undefined,
  originalTransform: string,
): string => {
  const translation = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  const scale = depth === undefined ? '' : ` scale(${Math.abs(depth)})`;
  const preserved = originalTransform === '' ? '' : ` ${originalTransform}`;
  return `${translation}${scale}${preserved}`;
};

/**
 * Animates an existing marker inside an existing viewport.
 *
 * Coordinates come from the viewport's CSS-pixel rectangle and locate the
 * marker's center, including when its size changes.
 */
export const animateDom = <State>(
  targets: DomTargets,
  motion: MotionSource<State>,
  options: AnimateDomOptions<State> = {},
): Controller => {
  const viewport = required(targets?.viewport, 'viewport');
  const marker = required(targets?.marker, 'marker');
  const originalTransform = marker.style.transform;
  const originalOpacity = marker.style.opacity;

  return createController({
    target: marker,
    resizeTarget: viewport,
    intersectionTarget: viewport,
    source: motion,
    measureViewport: () => {
      const rect = viewport.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    },
    render: (frame) => {
      if (options.render) {
        options.render(frame, { viewport, marker });
        return;
      }

      marker.style.transform = translatedTransform(
        frame.position.x,
        frame.position.y,
        frame.pose.depth,
        originalTransform,
      );
      marker.style.opacity = frame.pose.opacity === undefined
        ? originalOpacity
        : String(frame.pose.opacity);
    },
    framing: options.framing,
    markerScale: options.markerScale,
    autoplay: options.autoplay,
    offscreen: false,
    onDispose: () => {
      marker.style.transform = originalTransform;
      marker.style.opacity = originalOpacity;
    },
  });
};

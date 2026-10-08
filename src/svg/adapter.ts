import type { Framing, MarkerScaleOptions, MotionSource, Viewport } from '../core';
import {
  createController,
  type Controller,
  type Frame,
  type RuntimePlatform,
} from '../runtime';
import { cssPointToSvgPoint, measureSvgViewport } from './coordinates';

export interface SvgTargets {
  /** Existing SVG element. The adapter never changes its dimensions or viewBox. */
  readonly viewport: SVGSVGElement;
  /** Existing consumer-styled graphics element to position. */
  readonly marker: SVGGraphicsElement;
}

/** Backward-compatible descriptive name for the SVG target pair. */
export type SvgAnimationElements = SvgTargets;

export type SvgRender<State> = (frame: Frame<State>, targets: SvgTargets) => void;

export interface AnimateSvgOptions<State> {
  readonly framing?: Framing;
  readonly markerScale?: MarkerScaleOptions;
  readonly autoplay?: boolean;
  /** Defaults to false so SVG animations continue when scrolled outside the viewport. */
  readonly offscreen?: boolean;
  /** Replaces the default marker transform renderer entirely. */
  readonly render?: SvgRender<State>;
  /** Injectable browser services, primarily useful for tests. */
  readonly platform?: RuntimePlatform;
  readonly onReset?: () => void;
  readonly onDispose?: () => void;
}

const restoreAttribute = (element: Element, name: string, value: string | null): void => {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
};

interface MarkerAttributes {
  readonly transform: string | null;
  readonly opacity: string | null;
}

const markerAttributes = new WeakMap<SVGGraphicsElement, MarkerAttributes>();

const attributesFor = (marker: SVGGraphicsElement): MarkerAttributes => {
  let attributes = markerAttributes.get(marker);
  if (!attributes) {
    attributes = { transform: marker.getAttribute('transform'), opacity: marker.getAttribute('opacity') };
    markerAttributes.set(marker, attributes);
  }
  return attributes;
};

/**
 * Renders the standard SVG marker transform. It can be composed in a custom
 * render hook after helpers such as `createSvgTrail` without duplicating the
 * CSS-pixel to SVG-coordinate conversion or depth/opacity behavior.
 */
export const renderSvgMarker = <State>(frame: Frame<State>, elements: SvgTargets): void => {
  const { viewport, marker } = elements;
  const attributes = attributesFor(marker);
  const point = cssPointToSvgPoint(viewport, frame.position, marker);
  const scale = frame.pose.depth ?? 1;
  const original = attributes.transform ? ` ${attributes.transform}` : '';
  marker.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${scale})${original}`);
  if (frame.pose.opacity === undefined) restoreAttribute(marker, 'opacity', attributes.opacity);
  else marker.setAttribute('opacity', String(frame.pose.opacity));
};

/**
 * Animates a consumer-owned SVG marker using the runtime controller. Positions
 * are projected in local CSS pixels, then converted through viewBox and
 * preserveAspectRatio without changing consumer SVG geometry or CSS.
 */
export const animateSvg = <State>(
  elements: SvgTargets,
  motion: MotionSource<State>,
  options: AnimateSvgOptions<State> = {},
): Controller => {
  const { viewport, marker } = elements;
  if (!viewport || !marker) throw new TypeError('animateSvg requires existing viewport and marker elements');

  const originalAttributes = attributesFor(marker);
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    restored = true;
    restoreAttribute(marker, 'transform', originalAttributes.transform);
    restoreAttribute(marker, 'opacity', originalAttributes.opacity);
    markerAttributes.delete(marker);
  };

  const defaultRender = (frame: Frame<State>): void => renderSvgMarker(frame, elements);

  const measureViewport = (): Viewport => {
    return measureSvgViewport(viewport);
  };

  return createController({
    target: marker,
    resizeTarget: viewport,
    intersectionTarget: viewport,
    source: motion,
    measureViewport,
    render: options.render
      ? (frame) => options.render?.(frame, elements)
      : defaultRender,
    framing: options.framing,
    markerScale: options.markerScale,
    autoplay: options.autoplay,
    offscreen: options.offscreen ?? false,
    platform: options.platform,
    onReset: options.onReset,
    onDispose: () => {
      restore();
      options.onDispose?.();
    },
  });
};

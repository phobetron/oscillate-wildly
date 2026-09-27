import type { ProjectedPose, Viewport } from '../core';

export interface SvgPoint {
  readonly x: number;
  readonly y: number;
}

/** Measures local CSS pixels before outer CSS transforms. */
export const measureSvgViewport = (viewport: SVGSVGElement): Viewport => {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (width > 0 && height > 0) return { width, height };
  const rect = viewport.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
};

type Align = 'min' | 'mid' | 'max';

interface PreserveAspectRatio {
  readonly none: boolean;
  readonly slice: boolean;
  readonly alignX: Align;
  readonly alignY: Align;
}

const preserveAspectRatioFor = (viewport: SVGSVGElement): PreserveAspectRatio => {
  const tokens = (viewport.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet').trim().split(/\s+/);
  if (tokens.some((token) => token.toLowerCase() === 'none')) return { none: true, slice: false, alignX: 'mid', alignY: 'mid' };
  const alignment = tokens.find((token) => /^x(?:Min|Mid|Max)Y(?:Min|Mid|Max)$/i.test(token)) ?? 'xMidYMid';
  const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/i.exec(alignment);
  return {
    none: false,
    slice: tokens.some((token) => token.toLowerCase() === 'slice'),
    alignX: (match?.[1].toLowerCase() ?? 'mid') as Align,
    alignY: (match?.[2].toLowerCase() ?? 'mid') as Align,
  };
};

const alignmentOffset = (available: number, alignment: Align): number =>
  alignment === 'min' ? 0 : alignment === 'max' ? available : available / 2;

/**
 * Converts local SVG CSS pixels to user coordinates. This avoids screen CTMs:
 * outer CSS rotate, skew, scale, and translation do not affect local points.
 */
export const cssPointToSvgPoint = (
  viewport: SVGSVGElement,
  position: Pick<ProjectedPose, 'x' | 'y'>,
  target?: SVGGraphicsElement,
): SvgPoint => {
  const { width, height } = measureSvgViewport(viewport);
  if (width <= 0 || height <= 0) throw new Error('Unable to map CSS pixels to SVG coordinates for this viewport');

  const viewBox = viewport.viewBox.baseVal;
  const preserve = preserveAspectRatioFor(viewport);
  const rootPoint = viewBox.width <= 0 || viewBox.height <= 0
    ? { x: position.x, y: position.y }
    : preserve.none
    ? { x: viewBox.x + position.x / width * viewBox.width, y: viewBox.y + position.y / height * viewBox.height }
    : (() => {
      const scale = preserve.slice
        ? Math.max(width / viewBox.width, height / viewBox.height)
        : Math.min(width / viewBox.width, height / viewBox.height);
      const offsetX = alignmentOffset(width - viewBox.width * scale, preserve.alignX);
      const offsetY = alignmentOffset(height - viewBox.height * scale, preserve.alignY);
      return { x: viewBox.x + (position.x - offsetX) / scale, y: viewBox.y + (position.y - offsetY) / scale };
    })();
  return target ? rootPointToTargetParent(viewport, target, rootPoint) : rootPoint;
};

/** Converts an SVG-root point to a target's parent user coordinate system. */
const rootPointToTargetParent = (
  viewport: SVGSVGElement,
  target: SVGGraphicsElement,
  rootPoint: SvgPoint,
): SvgPoint => {
  const parent = target.parentElement as (Element & { getScreenCTM?: () => DOMMatrix | null }) | null;
  if (!parent || parent === viewport || typeof parent.getScreenCTM !== 'function') return rootPoint;
  const rootMatrix = viewport.getScreenCTM();
  const parentMatrix = parent.getScreenCTM();
  if (!rootMatrix || !parentMatrix) return rootPoint;
  const point = viewport.createSVGPoint();
  point.x = rootPoint.x;
  point.y = rootPoint.y;
  const screenPoint = point.matrixTransform(rootMatrix);
  const parentInput = viewport.createSVGPoint();
  parentInput.x = screenPoint.x;
  parentInput.y = screenPoint.y;
  const parentPoint = parentInput.matrixTransform(parentMatrix.inverse());
  return { x: parentPoint.x, y: parentPoint.y };
};

export const svgPathData = (points: readonly SvgPoint[]): string => points
  .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
  .join(' ');

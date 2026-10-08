import { projectToCssPixels, type AnalyticMotionSource, type Framing } from '../core';
import { cssPointToSvgPoint, measureSvgViewport, svgPathData } from './coordinates';

export interface SvgStaticPathOptions<State> {
  readonly viewport: SVGSVGElement;
  /** A consumer-created path. Its `d` attribute is restored on disposal. */
  readonly path: SVGPathElement;
  readonly motion: AnalyticMotionSource<State>;
  readonly framing?: Framing;
  /** Desired maximum CSS-pixel segment length. Defaults to 2. */
  readonly segmentLength?: number;
  /** Hard cap that bounds both sampling work and generated path length. */
  readonly maxSegments?: number;
}

export interface SvgStaticPath {
  render(): void;
  /** Replaces framing and resamples the path for the current viewport. */
  update(framing?: Framing): void;
  dispose(): void;
}

const finitePositive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be greater than zero`);
  return value;
};

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
};

const projectedPosition = <State>(
  motion: AnalyticMotionSource<State>,
  elapsedSeconds: number,
  width: number,
  height: number,
  framing: Framing | undefined,
) => {
  const sample = motion.sample(elapsedSeconds);
  return {
    position: projectToCssPixels(sample.pose, { width, height }, framing, motion.bounds),
    pathSegment: sample.pathSegment,
  };
};

/**
 * Draws one period of an analytic motion into a consumer-owned SVG path.
 * Calling `render` after a size or framing change resamples the curve for the
 * current rendered viewport. Stateful sources are intentionally not accepted.
 */
export const createSvgStaticPath = <State>(options: SvgStaticPathOptions<State>): SvgStaticPath => {
  const { viewport, path, motion } = options;
  const segmentLength = finitePositive(options.segmentLength ?? 2, 'segmentLength');
  const maxSegments = positiveInteger(options.maxSegments ?? 2048, 'maxSegments');
  const initialPath = path.getAttribute('d');
  let framing = options.framing;
  let disposed = false;

  const render = (): void => {
    if (disposed) return;
    const viewportSize = measureSvgViewport(viewport);
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      path.setAttribute('d', '');
      return;
    }

    // A modest first pass estimates arc length, then the full pass maintains
    // approximately the requested CSS-pixel segment length.
    const estimateSegments = Math.min(256, maxSegments);
    let length = 0;
    let previous = projectedPosition(motion, 0, viewportSize.width, viewportSize.height, framing);
    for (let index = 1; index <= estimateSegments; index += 1) {
      const current = projectedPosition(motion, motion.periodSeconds * index / estimateSegments, viewportSize.width, viewportSize.height, framing);
      if (current.pathSegment === previous.pathSegment) {
        length += Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y);
      }
      previous = current;
    }
    const segments = Math.max(1, Math.min(maxSegments, Math.ceil(length / segmentLength)));
    const subpaths = [];
    let points = [];
    let previousSegment: number | undefined;
    for (let index = 0; index <= segments; index += 1) {
      const sample = projectedPosition(motion, motion.periodSeconds * index / segments, viewportSize.width, viewportSize.height, framing);
      if (points.length > 0 && sample.pathSegment !== previousSegment) {
        subpaths.push(svgPathData(points));
        points = [];
      }
      points.push(cssPointToSvgPoint(viewport, sample.position, path));
      previousSegment = sample.pathSegment;
    }
    subpaths.push(svgPathData(points));
    path.setAttribute('d', subpaths.join(' '));
  };

  render();
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver(() => render());
  resizeObserver?.observe(viewport);

  return {
    render,
    update(nextFraming): void {
      if (disposed) return;
      framing = nextFraming;
      render();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      if (initialPath === null) path.removeAttribute('d');
      else path.setAttribute('d', initialPath);
    },
  };
};

/** Convenience form for drawing a static analytic path once. */
export const renderSvgStaticPath = <State>(options: SvgStaticPathOptions<State>): SvgStaticPath => createSvgStaticPath(options);

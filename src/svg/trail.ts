import type { Pose } from '../core';
import type { Frame } from '../runtime';
import { cssPointToSvgPoint, svgPathData } from './coordinates';

export interface SvgTrailOptions {
  /** SVG element whose rendered coordinate system is used by `path`. */
  readonly viewport: SVGSVGElement;
  /** A consumer-created path. Its `d` attribute is restored on disposal. */
  readonly path: SVGPathElement;
  /** Maximum retained samples. Defaults to 128. */
  readonly maxSamples?: number;
}

export interface SvgTrail<State> {
  render(frame: Frame<State>): void;
  clear(): void;
  dispose(): void;
}

const maxSampleCount = (value: number | undefined): number => {
  const count = value ?? 128;
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('maxSamples must be a positive integer');
  }
  return count;
};

/**
 * Maintains a bounded history of rendered positions in a consumer-supplied
 * SVG path. Samples stay in world space so a later viewport or framing change
 * reprojects the entire retained trail consistently.
 */
export const createSvgTrail = <State>(options: SvgTrailOptions): SvgTrail<State> => {
  const { viewport, path } = options;
  const maxSamples = maxSampleCount(options.maxSamples);
  const initialPath = path.getAttribute('d');
  const samples: Pose[] = [];
  let previousElapsedSeconds: number | undefined;
  let disposed = false;

  const write = (frame: Frame<State>): void => {
    const points = samples.map((pose) => cssPointToSvgPoint(viewport, frame.project(pose), path));
    path.setAttribute('d', svgPathData(points));
  };

  return {
    render(frame): void {
      if (disposed) return;
      if (frame.elapsedSeconds === 0 && (previousElapsedSeconds ?? 0) > 0) samples.length = 0;
      samples.push(frame.pose);
      if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
      previousElapsedSeconds = frame.elapsedSeconds;
      write(frame);
    },
    clear(): void {
      if (disposed) return;
      samples.length = 0;
      previousElapsedSeconds = undefined;
      path.setAttribute('d', '');
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (initialPath === null) path.removeAttribute('d');
      else path.setAttribute('d', initialPath);
    },
  };
};

import type { Pose } from '../core';
import type { Frame } from '../runtime';
import { createTrailHistory } from '../runtime/trail';
import { cssPointToSvgPoint, svgPathData } from './coordinates';

export interface SvgTrailOptions {
  /** SVG element whose rendered coordinate system is used by `path`. */
  readonly viewport: SVGSVGElement;
  /** A consumer-created path. Its `d` attribute is restored on disposal. */
  readonly path: SVGPathElement;
  /** Maximum retained samples. Must be a positive safe integer. Defaults to 128. */
  readonly maxSamples?: number;
}

export interface SvgTrail<State> {
  render(frame: Frame<State>): void;
  clear(): void;
  dispose(): void;
}

/**
 * Maintains a bounded history of rendered positions in a consumer-supplied
 * SVG path. Samples stay in world space so a later viewport or framing change
 * reprojects the entire retained trail consistently.
 */
export const createSvgTrail = <State>(options: SvgTrailOptions): SvgTrail<State> => {
  const { viewport, path } = options;
  const history = createTrailHistory<Pose>(options.maxSamples);
  const initialPath = path.getAttribute('d');
  let disposed = false;

  const write = (frame: Frame<State>): void => {
    const points = history.values().map((pose) => cssPointToSvgPoint(viewport, frame.project(pose), path));
    path.setAttribute('d', svgPathData(points));
  };

  return {
    render(frame): void {
      if (disposed) return;
      history.add({ ...frame.pose }, frame.elapsedSeconds);
      write(frame);
    },
    clear(): void {
      if (disposed) return;
      history.clear();
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

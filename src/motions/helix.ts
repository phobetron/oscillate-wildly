import type { AnalyticMotionSource, Bounds, MotionSample } from '../core';
import { createAnalyticMotion, wrapElapsed } from './analytic';

export type HelixRotationDirection = 'counter-clockwise' | 'clockwise';
export type HelixFlowDirection = 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left';

export interface HelixParams {
  readonly periodSeconds?: number;
  readonly turns?: number;
  readonly fadeFraction?: number;
  /** Viewed from the positive helix axis (+Z vertically, +X horizontally). Defaults to counter-clockwise. */
  readonly rotationDirection?: HelixRotationDirection;
  /** Travel direction in the planar pose's screen coordinates. Defaults to top-to-bottom. */
  readonly flowDirection?: HelixFlowDirection;
}

export interface HelixState {
  readonly elapsedSeconds: number;
  readonly angleRadians: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const createHelixMotion = (params: HelixParams = {}): AnalyticMotionSource<HelixState> => {
  const periodSeconds = params.periodSeconds ?? 12;
  const turns = params.turns ?? 4;
  const fadeFraction = params.fadeFraction ?? 0.05;
  const rotationDirection = params.rotationDirection ?? 'counter-clockwise';
  const flowDirection = params.flowDirection ?? 'top-to-bottom';
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0 || !Number.isFinite(turns) || turns <= 0 || !Number.isFinite(fadeFraction) || fadeFraction <= 0 || fadeFraction >= 0.5) {
    throw new RangeError('helix parameters must be finite and within their supported ranges');
  }
  if (rotationDirection !== 'counter-clockwise' && rotationDirection !== 'clockwise') {
    throw new RangeError('rotationDirection must be counter-clockwise or clockwise');
  }
  if (!['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left'].includes(flowDirection)) {
    throw new RangeError('flowDirection must be top-to-bottom, bottom-to-top, left-to-right, or right-to-left');
  }
  const horizontal = flowDirection === 'left-to-right' || flowDirection === 'right-to-left';
  const reverseFlow = flowDirection === 'bottom-to-top' || flowDirection === 'right-to-left';
  const length = turns / 2;
  const bounds: Bounds = horizontal
    ? { minX: 0, maxX: length, minY: -1, maxY: 1 }
    : { minX: -1, maxX: 1, minY: 0, maxY: length };

  return createAnalyticMotion(bounds, periodSeconds, (elapsedSeconds): MotionSample<HelixState> => {
    const wrapped = wrapElapsed(elapsedSeconds, periodSeconds);
    // Match the remainder's actual wrap; division alone can round into the
    // next cycle before the remainder resets for fractional periods.
    const pathSegment = Math.round((elapsedSeconds - wrapped) / periodSeconds);
    const progress = wrapped / periodSeconds;
    const unsignedAngle = progress * turns * Math.PI * 2;
    const angleRadians = rotationDirection === 'clockwise' ? -unsignedAngle : unsignedAngle;
    const radial = Math.cos(angleRadians);
    const advance = 0.5 * unsignedAngle / (Math.PI * 2);
    const axial = reverseFlow ? length - advance : advance;
    const x = horizontal ? axial : radial;
    const y = Math.sin(angleRadians);
    const z = horizontal ? -radial : axial;
    const opacity = progress < fadeFraction
      ? progress / fadeFraction
      : progress > 1 - fadeFraction
        ? (1 - progress) / fadeFraction
        : 1;
    return { state: { elapsedSeconds: wrapped, angleRadians, x, y, z }, pose: { x, y: horizontal ? radial : z, depth: 0.25 + 0.75 * (y + 1) / 2, opacity }, pathSegment };
  });
};

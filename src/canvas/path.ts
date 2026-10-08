import type { CanvasRenderer } from '../canvas';
import type { AnalyticMotionSource, Pose } from '../core';

export interface CanvasPathOptions {
  readonly color?: string | CanvasGradient | CanvasPattern;
  /** Line width in CSS pixels. Defaults to 1. */
  readonly width?: number;
  /** Caps sampling work. Defaults to 2048. */
  readonly maxSegments?: number;
}

const cacheKey = <State>(frame: Parameters<CanvasRenderer<State>>[1], source: AnalyticMotionSource<State>): string => {
  const bounds = source.bounds;
  const lower = frame.project({ x: bounds.minX, y: bounds.minY });
  const upper = frame.project({ x: bounds.maxX, y: bounds.maxY });
  return [frame.viewport.width, frame.viewport.height, lower.x, lower.y, upper.x, upper.y].join(':');
};

/**
 * Returns a cached analytic-path renderer. It resamples only when projection
 * changes and refines until its sampled segments are about two CSS pixels.
 */
export const createCanvasPath = <State>(
  source: AnalyticMotionSource<State>,
  options: CanvasPathOptions = {},
): CanvasRenderer<State> => {
  const maxSegments = options.maxSegments ?? 2048;
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) {
    throw new RangeError('maxSegments must be a positive integer');
  }
  let previousKey: string | undefined;
  let points: { position: Pose; pathSegment: number | undefined }[] = [];

  return (context, frame) => {
    const nextKey = cacheKey(frame, source);
    if (nextKey !== previousKey) {
      const project = (elapsedSeconds: number) => {
        const sample = source.sample(elapsedSeconds);
        return { position: frame.project(sample.pose), pathSegment: sample.pathSegment };
      };
      let segments = Math.min(32, maxSegments);
      let sampled = Array.from({ length: segments + 1 }, (_, index) =>
        project((index / segments) * source.periodSeconds));
      while (segments < maxSegments) {
        let longest = 0;
        for (let index = 1; index < sampled.length; index += 1) {
          if (sampled[index].pathSegment !== sampled[index - 1].pathSegment) continue;
          longest = Math.max(longest, Math.hypot(
            sampled[index].position.x - sampled[index - 1].position.x,
            sampled[index].position.y - sampled[index - 1].position.y,
          ));
        }
        if (longest <= 2) break;
        segments = Math.min(segments * 2, maxSegments);
        sampled = Array.from({ length: segments + 1 }, (_, index) =>
          project((index / segments) * source.periodSeconds));
      }
      points = sampled;
      previousKey = nextKey;
    }
    if (points.length < 2) return;

    context.save();
    try {
      context.strokeStyle = options.color ?? 'rgba(255, 0, 0, 0.3)';
      context.lineWidth = options.width ?? 1;
      context.beginPath();
      context.moveTo(points[0].position.x, points[0].position.y);
      for (let index = 1; index < points.length; index += 1) {
        const { position, pathSegment } = points[index];
        if (pathSegment !== points[index - 1].pathSegment) context.moveTo(position.x, position.y);
        else context.lineTo(position.x, position.y);
      }
      context.stroke();
    } finally {
      context.restore();
    }
  };
};

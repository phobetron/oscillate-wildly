import type { Bounds, Framing, Pose, ProjectedPose, Viewport } from './types';

const positive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`);
  }
  return value;
};

const dimensions = (bounds: Bounds): { width: number; height: number } => ({
  width: positive(bounds.maxX - bounds.minX, 'bounds width'),
  height: positive(bounds.maxY - bounds.minY, 'bounds height'),
});

/** Projects a world-space pose into CSS pixels without accessing the DOM. */
export const projectToCssPixels = (
  pose: Pose,
  viewport: Viewport,
  framing: Framing = {},
  sourceBounds?: Bounds,
): ProjectedPose => {
  const width = positive(viewport.width, 'viewport width');
  const height = positive(viewport.height, 'viewport height');
  const bounds = framing.bounds ?? sourceBounds;

  if (!bounds) {
    throw new TypeError('sourceBounds or framing.bounds is required');
  }

  const world = dimensions(bounds);
  const zoom = positive(framing.zoom ?? 1, 'zoom');
  const fit = framing.fit ?? 'cover';
  const requestedPadding = framing.padding ?? (fit === 'contain' ? 16 : 0);
  if (!Number.isFinite(requestedPadding) || requestedPadding < 0) {
    throw new RangeError('padding must be a finite, non-negative number');
  }
  const padding = fit === 'contain' ? Math.min(requestedPadding, width / 2, height / 2) : 0;
  const baseScaleX = (width - padding * 2) / world.width;
  const baseScaleY = (height - padding * 2) / world.height;
  const sharedScale = fit === 'contain'
    ? Math.min(baseScaleX, baseScaleY)
    : Math.max(baseScaleX, baseScaleY);
  const scaleX = (fit === 'stretch' ? baseScaleX : sharedScale) * zoom;
  const scaleY = (fit === 'stretch' ? baseScaleY : sharedScale) * zoom;
  const offsetX = (framing.offsetX ?? 0) * width;
  const offsetY = (framing.offsetY ?? 0) * height;

  return {
    x: (pose.x - (bounds.minX + bounds.maxX) / 2) * scaleX + width / 2 + offsetX,
    y: (pose.y - (bounds.minY + bounds.maxY) / 2) * scaleY + height / 2 + offsetY,
    ...(pose.depth === undefined ? {} : { depth: pose.depth }),
    ...(pose.opacity === undefined ? {} : { opacity: pose.opacity }),
    scaleX,
    scaleY,
  };
};

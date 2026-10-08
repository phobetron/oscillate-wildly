import type { MarkerScaleOptions, Pose } from '../core';

/** Snapshot and validate settings once, rather than once per animation frame. */
export const createMarkerScaleMapper = (options: MarkerScaleOptions = {}): ((pose: Pose) => Pose) => {
  const strength = options.depthStrength ?? 1;
  const minimum = options.minMarkerScale ?? 0;
  const maximum = options.maxMarkerScale ?? Infinity;
  if (![strength, minimum].every((value) => Number.isFinite(value) && value >= 0)
    || (options.maxMarkerScale !== undefined && (!Number.isFinite(maximum) || maximum < 0))) {
    throw new RangeError('Marker depth strength and scale limits must be finite and nonnegative');
  }
  if (minimum > maximum) throw new RangeError('Minimum marker scale must not exceed maximum marker scale');
  if (strength === 1 && minimum === 0 && maximum === Infinity) return (pose) => pose;

  return (pose) => {
    const native = pose.depth ?? 1;
    if (!Number.isFinite(native) || native < 0) throw new RangeError('Motion marker scale must be finite and nonnegative');
    const amplified = strength === 1 ? native : strength === 0 ? 1 : 1 + strength * (native - 1);
    const depth = Math.max(minimum, Math.min(maximum, amplified));
    if (!Number.isFinite(depth)) throw new RangeError('Resulting marker scale must be finite');
    return depth === native ? pose : { ...pose, depth };
  };
};

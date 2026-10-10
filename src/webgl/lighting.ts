import type { OrthographicCamera } from '../core';
import type { WebGLColor } from './renderer';

/** Render-time lighting shared by markers, trails, and retained paint. */
export interface WebGLLightingOptions {
  readonly ambient?: {
    /** RGB channels in [0, 1]. Defaults to white. */
    readonly color?: WebGLColor;
    /** Intensity in [0, 4096]. Defaults to 0.3. */
    readonly intensity?: number;
  };
  readonly directional?: {
    /** Finite, nonzero vector pointing toward the light; normalized internally. Defaults to [-0.45, 0.65, 1]. */
    readonly direction?: readonly [number, number, number];
    /** View axes: right, up, toward viewer. World uses motion axes; planar view maps them to right, down, away. Defaults to view. */
    readonly space?: 'view' | 'world';
    /** RGB channels in [0, 1]. Defaults to white. Also tints specular highlights. */
    readonly color?: WebGLColor;
    /** Intensity in [0, 4096]. Defaults to 0.7; zero also disables specular highlights. */
    readonly intensity?: number;
  };
  readonly specular?: {
    /** Strength in [0, 4096] at the default directional intensity. Its product with directional intensity / 0.7 must also be at most 4096. Defaults to 0.12; zero gives matte surfaces. */
    readonly intensity?: number;
    /** Exponent in [1/16384, 16384] controlling highlight concentration. Defaults to 24. */
    readonly shininess?: number;
  };
  readonly depthCue?: {
    /** Darkening at the far clipping plane, in [0, 1]. Defaults to 0.3; zero disables this cue independently. */
    readonly strength?: number;
  };
}

type Vector = readonly [number, number, number];

export interface ResolvedWebGLLighting {
  readonly enabled: boolean;
  readonly ambientColor: WebGLColor;
  readonly ambientIntensity: number;
  readonly direction: Vector;
  readonly space: 'view' | 'world';
  readonly directionalColor: WebGLColor;
  readonly directionalIntensity: number;
  readonly specularIntensity: number;
  readonly shininess: number;
  readonly depthCueStrength: number;
}

const object = (value: unknown, name: string): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`WebGL lighting ${name} must be an object`);
  }
};

// Leave room for all three lighting contributions within WebGL 1's minimum
// mediump range (2^14), including devices without fragment highp support.
const MAX_INTENSITY = 4096;
const scalar = (value: number | undefined, fallback: number, name: string, positive = false, maximum = MAX_INTENSITY): number => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number') throw new TypeError(`WebGL lighting ${name} must be a number`);
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0) || value > maximum) {
    throw new RangeError(`WebGL lighting ${name} must be finite and ${positive ? 'positive' : 'nonnegative'}, and at most ${maximum}`);
  }
  return value;
};

const vector = (value: Vector, name: string): Vector => {
  if (!Array.isArray(value) || value.length !== 3 || ![value[0], value[1], value[2]].every((channel) => typeof channel === 'number')) {
    throw new TypeError(`WebGL lighting ${name} must contain three numbers`);
  }
  if (!value.every(Number.isFinite)) {
    throw new RangeError(`WebGL lighting ${name} must contain three finite numbers`);
  }
  return [value[0], value[1], value[2]];
};

const color = (value: WebGLColor | undefined, name: string): WebGLColor => {
  const result = vector(value === undefined ? [1, 1, 1] : value, name);
  if (result.some((channel) => channel < 0 || channel > 1)) {
    throw new RangeError(`WebGL lighting ${name} channels must be in [0, 1]`);
  }
  return result;
};

// Scale before taking the length so both subnormal and very large directions work.
const normalize = (value: Vector): Vector => {
  const scale = Math.max(...value.map(Math.abs));
  if (scale === 0) throw new RangeError('WebGL lighting direction must be nonzero');
  const scaled = value.map((channel) => channel / scale);
  const length = Math.hypot(...scaled);
  return [scaled[0] / length, scaled[1] / length, scaled[2] / length];
};

/** Validate and snapshot a complete replacement configuration, resolving omitted fields against legacy defaults. */
export const resolveWebGLLighting = (value: boolean | WebGLLightingOptions): ResolvedWebGLLighting => {
  if (typeof value !== 'boolean') object(value, 'configuration');
  const options: WebGLLightingOptions = typeof value === 'boolean' ? {} : value;
  for (const name of ['ambient', 'directional', 'specular', 'depthCue'] as const) {
    if (options[name] !== undefined) object(options[name], name);
  }
  const space = options.directional?.space === undefined ? 'view' : options.directional.space;
  if (space !== 'view' && space !== 'world') throw new TypeError('WebGL lighting direction space must be view or world');
  const resolved: ResolvedWebGLLighting = {
    enabled: value !== false,
    ambientColor: color(options.ambient?.color, 'ambient color'),
    ambientIntensity: scalar(options.ambient?.intensity, 0.3, 'ambient intensity'),
    direction: normalize(vector(options.directional?.direction === undefined ? [-0.45, 0.65, 1] : options.directional.direction, 'direction')),
    space,
    directionalColor: color(options.directional?.color, 'directional color'),
    directionalIntensity: scalar(options.directional?.intensity, 0.7, 'directional intensity'),
    specularIntensity: scalar(options.specular?.intensity, 0.12, 'specular intensity'),
    shininess: scalar(options.specular?.shininess, 24, 'shininess', true, 16384),
    depthCueStrength: scalar(options.depthCue?.strength, 0.3, 'depth cue strength', false, 1),
  };
  if (resolved.shininess < 1 / 16384) throw new RangeError('WebGL lighting shininess must be at least 1/16384');
  if (resolved.specularIntensity * resolved.directionalIntensity / 0.7 > MAX_INTENSITY) {
    throw new RangeError('WebGL lighting combined specular strength must be at most 4096');
  }
  return resolved;
};

const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rotate the light into the same view basis as surface normals, without framing or projection scale. */
export const lightingDirectionInView = (lighting: ResolvedWebGLLighting, camera?: OrthographicCamera): Vector => {
  if (lighting.space === 'view') return lighting.direction;
  if (!camera) return [lighting.direction[0], -lighting.direction[1], -lighting.direction[2]];
  const target = camera.target ?? { x: 0, y: 0, z: 0 };
  const up = camera.up ?? { x: 0, y: 1, z: 0 };
  const forward = normalize([target.x - camera.position.x, target.y - camera.position.y, target.z - camera.position.z]);
  const right = normalize(cross(forward, normalize([up.x, up.y, up.z])));
  const screenUp = cross(right, forward);
  return [dot(lighting.direction, right), dot(lighting.direction, screenUp), -dot(lighting.direction, forward)];
};

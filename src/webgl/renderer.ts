import type { Pose, ProjectedPose, Viewport } from '../core';
import type { PaintFootprints, RibbonGeometry } from './ribbon';

/** Opaque RGB channels in the range [0, 1]. */
export type WebGLColor = readonly [number, number, number];

export interface WebGLMarkerOptions {
  /** Radius in CSS pixels, multiplied by pose.depth. Defaults to 5. */
  readonly radius?: number;
  readonly color?: WebGLColor;
  readonly shape?: 'circle' | 'square';
}

export interface WebGLMarker {
  readonly pose: Pose;
  readonly visibilityDepth: number;
  readonly options: WebGLMarkerOptions;
}

export interface WebGLTrailStyle {
  /** Full width in CSS pixels, independent of marker scale. Defaults to 1. */
  readonly width?: number;
  readonly color?: WebGLColor;
}

const vertex = `
attribute vec2 corner;
uniform vec3 center;
uniform vec2 radius;
varying vec2 local;
varying SURFACE_DEPTH_PRECISION float surfaceDepth;
void main() {
  local = corner;
  gl_Position = vec4(center.xy + corner * radius, center.z, 1.0);
  surfaceDepth = gl_Position.z;
}`;

const fragment = `
precision mediump float;
LIGHTING_SOURCE
uniform vec3 color;
uniform bool circle;
varying vec2 local;
void main() {
  vec4 shaded = shade(color);
  if (circle && dot(local, local) > 1.0) discard;
  gl_FragColor = shaded;
}`;

const markersVertex = `
attribute vec3 corner;
attribute vec2 markerLocal;
attribute vec3 markerColor;
attribute float markerCircle;
attribute float markerRadius;
attribute float markerDepth;
uniform bool planar;
uniform mat4 projection;
uniform vec2 pixelScale;
varying mediump vec2 local;
varying mediump vec3 color;
varying mediump float circle;
varying SURFACE_DEPTH_PRECISION float surfaceDepth;
void main() {
  local = markerLocal;
  color = markerColor;
  circle = markerCircle;
  vec3 position = vec3(corner.xy, planar ? markerDepth : corner.z);
  gl_Position = projection * vec4(position, 1.0);
  gl_Position.xy += markerLocal * markerRadius * pixelScale * gl_Position.w;
  surfaceDepth = gl_Position.z;
}`;

const markersFragment = `
precision mediump float;
LIGHTING_SOURCE
varying mediump vec2 local;
varying mediump vec3 color;
varying mediump float circle;
void main() {
  vec4 shaded = shade(color);
  if (circle > 0.5 && dot(local, local) > 1.0) discard;
  gl_FragColor = shaded;
}`;

const defaultMarkerColor: WebGLColor = [1, 0, 0];
const markerCorners = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
const markerStride = 11;
const markerSlotFloats = 6 * markerStride;

const validateMarker = (position: Pick<Pose, 'x' | 'y' | 'depth'>, visibilityDepth: number, options: WebGLMarkerOptions): number => {
  const markerRadius = options.radius ?? 5;
  const depthScale = position.depth ?? 1;
  const size = markerRadius * depthScale;
  const rgb = options.color ?? defaultMarkerColor;
  if (!Number.isFinite(size) || markerRadius < 0 || depthScale < 0 || ![position.x, position.y, visibilityDepth].every(Number.isFinite)) {
    throw new RangeError('WebGL marker position, visibility depth, and radius must be finite; radius must be non-negative');
  }
  if (rgb.length !== 3 || !rgb.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError('WebGL marker color must contain three RGB channels in [0, 1]');
  }
  if (options.shape !== undefined && options.shape !== 'circle' && options.shape !== 'square') {
    throw new TypeError('WebGL marker shape must be circle or square');
  }
  return size;
};

const copyVertex = `
attribute vec2 corner;
varying vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const copyFragment = `
precision mediump float;
uniform sampler2D image;
varying vec2 uv;
void main() { gl_FragColor = texture2D(image, uv); }
`;

const trailVertex = `
attribute vec3 corner;
varying SURFACE_DEPTH_PRECISION float surfaceDepth;
void main() {
  gl_Position = vec4(corner, 1.0);
  surfaceDepth = gl_Position.z;
}
`;

const trailFragment = `
precision mediump float;
LIGHTING_SOURCE
uniform vec3 color;
void main() {
  gl_FragColor = shade(color);
}
`;

const ribbonVertex = `
attribute vec3 corner;
attribute vec3 paintColor;
uniform mat4 projection;
varying mediump vec3 color;
varying SURFACE_DEPTH_PRECISION float surfaceDepth;
void main() {
  color = paintColor;
  gl_Position = projection * vec4(corner, 1.0);
  surfaceDepth = gl_Position.z;
}
`;

const ribbonFragment = `
precision mediump float;
LIGHTING_SOURCE
varying mediump vec3 color;
void main() {
  gl_FragColor = shade(color);
}
`;

const footprintsVertex = `
attribute vec3 corner;
attribute vec3 paintColor;
attribute vec2 paintLocal;
attribute float paintCircle;
uniform mat4 projection;
varying mediump vec2 local;
varying mediump vec3 color;
varying mediump float circle;
varying SURFACE_DEPTH_PRECISION float surfaceDepth;
void main() {
  local = paintLocal;
  color = paintColor;
  circle = paintCircle;
  gl_Position = projection * vec4(corner, 1.0);
  surfaceDepth = gl_Position.z;
}
`;

const required = <T>(value: T | null, name: string): T => {
  if (value === null) throw new Error(`Unable to allocate WebGL ${name}`);
  return value;
};

const shader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const result = required(gl.createShader(type), 'shader');
  try {
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      throw new Error(`WebGL shader compilation failed: ${gl.getShaderInfoLog(result)}`);
    }
    return result;
  } catch (error) {
    gl.deleteShader(result);
    throw error;
  }
};

const program = (gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string, attributes: readonly string[] = ['corner']): WebGLProgram => {
  const result = required(gl.createProgram(), 'program');
  let vs: WebGLShader | undefined;
  let fs: WebGLShader | undefined;
  let linked = false;
  let attached = false;
  try {
    vs = shader(gl, gl.VERTEX_SHADER, vertexSource);
    fs = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(result, vs);
    gl.attachShader(result, fs);
    attached = true;
    attributes.forEach((name, index) => gl.bindAttribLocation(result, index, name));
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
      throw new Error(`WebGL program linking failed: ${gl.getProgramInfoLog(result)}`);
    }
    linked = true;
    return result;
  } finally {
    if (vs) { if (attached) gl.detachShader(result, vs); gl.deleteShader(vs); }
    if (fs) { if (attached) gl.detachShader(result, fs); gl.deleteShader(fs); }
    if (!linked) gl.deleteProgram(result);
  }
};

/** One fixed-size color/depth target. No CPU path or per-frame GPU allocation. */
export const createMarkerRenderer = (gl: WebGLRenderingContext) => {
  const derivatives = Boolean(gl.getExtension('OES_standard_derivatives'));
  // WebGL 1 fragment highp is optional. Match both shader stages explicitly.
  const depthPrecision = gl.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision
    ? 'highp' : 'mediump';
  // Shade before shape discards so derivatives see the complete fragment quad.
  const lightingSource = `
uniform bool lightingEnabled;
uniform ${depthPrecision} vec3 lightingViewScale;
varying ${depthPrecision} float surfaceDepth;
vec4 shade(vec3 base) {
  if (!lightingEnabled) return vec4(base, 1.0);
  ${depthPrecision} vec3 normal = ${derivatives ? `normalize(vec3(
    dFdx(surfaceDepth) * lightingViewScale.z / (2.0 * lightingViewScale.x),
    dFdy(surfaceDepth) * lightingViewScale.z / (2.0 * lightingViewScale.y), 1.0))` : 'vec3(0.0, 0.0, 1.0)'};
  vec3 light = normalize(vec3(-0.45, 0.65, 1.0));
  float diffuse = max(dot(normal, light), 0.0);
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float specular = 0.12 * pow(max(dot(normal, halfway), 0.0), 24.0);
  float attenuation = 1.0 - 0.3 * clamp(surfaceDepth * 0.5 + 0.5, 0.0, 1.0);
  return vec4((base * (0.3 + 0.7 * diffuse) + vec3(specular)) * attenuation, 1.0);
}`;
  let lightingEnabled = false;
  let lightingViewScale: readonly [number, number, number] = [1, 1, 1];
  const lightingUniforms = new Map<WebGLProgram, {
    enabled: WebGLUniformLocation | null;
    viewScale: WebGLUniformLocation | null;
  }>();
  const geometryProgram = (vertexSource: string, fragmentSource: string, attributes?: readonly string[]): WebGLProgram => {
    const result = program(gl,
      vertexSource.replace('SURFACE_DEPTH_PRECISION', depthPrecision),
      (derivatives ? '#extension GL_OES_standard_derivatives : enable\n' : '') +
        fragmentSource.replace('LIGHTING_SOURCE', lightingSource), attributes);
    lightingUniforms.set(result, {
      enabled: gl.getUniformLocation(result, 'lightingEnabled'),
      viewScale: gl.getUniformLocation(result, 'lightingViewScale'),
    });
    return result;
  };
  const applyLighting = (geometry: WebGLProgram): void => {
    const uniforms = lightingUniforms.get(geometry)!;
    gl.uniform1i(uniforms.enabled, lightingEnabled ? 1 : 0);
    gl.uniform3f(uniforms.viewScale, lightingViewScale[0], lightingViewScale[1], lightingViewScale[2]);
  };
  let markerProgram: WebGLProgram | undefined;
  let markersProgram: WebGLProgram | undefined;
  let markersBuffer: WebGLBuffer | undefined;
  let markersVertices = new Float32Array(0);
  let markersBufferCapacity = 0;
  let markersProjection!: WebGLUniformLocation;
  let markersPixelScale!: WebGLUniformLocation;
  let markersPlanar!: WebGLUniformLocation;
  // The next append slot is also the oldest slot once the ring is full.
  let markersNext = 0;
  let markersCount = 0;
  let copyProgram: WebGLProgram | undefined;
  let trailProgram: WebGLProgram | undefined;
  let trailBuffer: WebGLBuffer | undefined;
  let trailColor!: WebGLUniformLocation;
  let trailVertices = new Float32Array(0);
  let trailBufferCapacity = 0;
  let trailSubmittedFloats = 0;
  let ribbonProgram: WebGLProgram | undefined;
  let ribbonBuffer: WebGLBuffer | undefined;
  let ribbonColorBuffer: WebGLBuffer | undefined;
  let ribbonProjection!: WebGLUniformLocation;
  let ribbonVertices: Float32Array | undefined;
  let ribbonColors: Float32Array | undefined;
  let ribbonBufferCapacity = 0;
  let ribbonRevision: number | undefined;
  let footprintsProgram: WebGLProgram | undefined;
  let footprintsBuffer: WebGLBuffer | undefined;
  let footprintsProjection!: WebGLUniformLocation;
  let footprintsVertices: Float32Array | undefined;
  let footprintsBufferCapacity = 0;
  let footprintsRevision: number | undefined;
  let buffer: WebGLBuffer | undefined;
  let texture: WebGLTexture | undefined;
  let depth: WebGLRenderbuffer | undefined;
  let target: WebGLFramebuffer | undefined;
  let width = 0;
  let height = 0;
  let center!: WebGLUniformLocation;
  let radius!: WebGLUniformLocation;
  let color!: WebGLUniformLocation;
  let circle!: WebGLUniformLocation;
  let image!: WebGLUniformLocation;

  const dispose = (): void => {
    // In particular, an active program is retained by GL until it is unbound.
    gl.useProgram(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (markerProgram) gl.deleteProgram(markerProgram);
    if (markersProgram) gl.deleteProgram(markersProgram);
    if (markersBuffer) gl.deleteBuffer(markersBuffer);
    if (copyProgram) gl.deleteProgram(copyProgram);
    if (trailProgram) gl.deleteProgram(trailProgram);
    if (trailBuffer) gl.deleteBuffer(trailBuffer);
    if (ribbonProgram) gl.deleteProgram(ribbonProgram);
    if (ribbonBuffer) gl.deleteBuffer(ribbonBuffer);
    if (ribbonColorBuffer) gl.deleteBuffer(ribbonColorBuffer);
    if (footprintsProgram) gl.deleteProgram(footprintsProgram);
    if (footprintsBuffer) gl.deleteBuffer(footprintsBuffer);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    if (depth) gl.deleteRenderbuffer(depth);
    if (target) gl.deleteFramebuffer(target);
    markerProgram = copyProgram = buffer = texture = depth = target = undefined;
    trailProgram = trailBuffer = undefined;
    ribbonProgram = ribbonBuffer = ribbonColorBuffer = undefined;
    ribbonVertices = undefined;
    ribbonColors = undefined;
    ribbonBufferCapacity = 0;
    ribbonRevision = undefined;
    footprintsProgram = footprintsBuffer = undefined;
    footprintsVertices = undefined;
    footprintsBufferCapacity = 0;
    footprintsRevision = undefined;
    markersProgram = markersBuffer = undefined;
    markersVertices = new Float32Array(0);
    markersBufferCapacity = 0;
    markersNext = 0;
    markersCount = 0;
    trailVertices = new Float32Array(0);
    trailBufferCapacity = 0;
    trailSubmittedFloats = 0;
    lightingUniforms.clear();
  };

  try {
    markerProgram = geometryProgram(vertex, fragment);
    copyProgram = program(gl, copyVertex, copyFragment);
    buffer = required(gl.createBuffer(), 'buffer');
    texture = required(gl.createTexture(), 'texture');
    depth = required(gl.createRenderbuffer(), 'depth buffer');
    target = required(gl.createFramebuffer(), 'framebuffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    center = required(gl.getUniformLocation(markerProgram, 'center'), 'center uniform');
    radius = required(gl.getUniformLocation(markerProgram, 'radius'), 'radius uniform');
    color = required(gl.getUniformLocation(markerProgram, 'color'), 'color uniform');
    circle = required(gl.getUniformLocation(markerProgram, 'circle'), 'shape uniform');
    image = required(gl.getUniformLocation(copyProgram, 'image'), 'image uniform');
  } catch (error) {
    dispose();
    throw error;
  }

  const bindQuad = (): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer!);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.disableVertexAttribArray(3);
    gl.disableVertexAttribArray(4);
    gl.disableVertexAttribArray(5);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.viewport(0, 0, width, height);
  };

  const clear = (): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };

  const validateMarkerLimit = (maxSamples: number): void => {
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) {
      throw new RangeError('WebGL marker sample limit must be a positive safe integer');
    }
  };

  const validateWorldMarker = (marker: WebGLMarker): void => {
    validateMarker(marker.pose, marker.visibilityDepth, marker.options);
    if (!Number.isFinite(marker.pose.z ?? 0)) throw new RangeError('WebGL marker world position must be finite');
  };

  const packMarker = ({ pose, visibilityDepth, options }: WebGLMarker, slot: number): void => {
    const rgb = options.color ?? defaultMarkerColor;
    const size = (options.radius ?? 5) * (pose.depth ?? 1);
    let offset = slot * markerSlotFloats;
    for (let corner = 0; corner < markerCorners.length; corner += 2) {
      markersVertices[offset++] = pose.x;
      markersVertices[offset++] = pose.y;
      markersVertices[offset++] = pose.z ?? 0;
      markersVertices[offset++] = markerCorners[corner];
      markersVertices[offset++] = markerCorners[corner + 1];
      markersVertices[offset++] = rgb[0];
      markersVertices[offset++] = rgb[1];
      markersVertices[offset++] = rgb[2];
      markersVertices[offset++] = options.shape === 'square' ? 0 : 1;
      markersVertices[offset++] = size;
      markersVertices[offset++] = visibilityDepth;
    }
  };

  const ensureMarkerCapacity = (needed: number, maxSamples: number): boolean => {
    const previousCapacity = markersVertices.length / markerSlotFloats;
    if (previousCapacity >= needed && previousCapacity <= maxSamples) return false;
    let capacity = Math.min(maxSamples, Math.max(1, previousCapacity));
    while (capacity < needed) capacity = Math.min(maxSamples, capacity * 2);
    const vertices = new Float32Array(capacity * markerSlotFloats);
    const retained = Math.min(markersCount, capacity);
    const oldest = previousCapacity === markersCount ? markersNext : 0;
    // Growth (or a reduced limit) unwraps retained samples once; subsequent
    // appends overwrite one slot without repacking the rest of the history.
    for (let index = 0; index < retained; index++) {
      const slot = (oldest + markersCount - retained + index) % previousCapacity;
      vertices.set(markersVertices.subarray(slot * markerSlotFloats, (slot + 1) * markerSlotFloats), index * markerSlotFloats);
    }
    markersVertices = vertices;
    markersCount = retained;
    markersNext = retained % capacity;
    return true;
  };

  const uploadMarkers = (): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, markersBuffer!);
    if (markersBufferCapacity !== markersVertices.length) {
      gl.bufferData(gl.ARRAY_BUFFER, markersVertices.byteLength, gl.DYNAMIC_DRAW);
      markersBufferCapacity = markersVertices.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, markersVertices.subarray(0, markersCount * markerSlotFloats));
  };

  return {
    dispose,
    /** World units per backing pixel (X/Y), and the camera depth span. */
    setLighting(enabled: boolean, viewScale: readonly [number, number, number]): void {
      if (viewScale.length !== 3 || !viewScale.every((value) => Number.isFinite(value) && value > 0)) {
        throw new RangeError('WebGL lighting view scale must contain three finite positive values');
      }
      lightingEnabled = enabled;
      lightingViewScale = [viewScale[0], viewScale[1], viewScale[2]];
    },
    resize(nextWidth: number, nextHeight: number): boolean {
      if (nextWidth === width && nextHeight === height) return false;
      const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      if (nextWidth > limit || nextHeight > limit) throw new RangeError('WebGL canvas exceeds the maximum render target size');
      gl.bindTexture(gl.TEXTURE_2D, texture!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nextWidth, nextHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth!);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, nextWidth, nextHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('WebGL color/depth framebuffer is incomplete');
      }
      width = nextWidth;
      height = nextHeight;
      clear();
      return true;
    },
    clear,
    drawTrail(positions: readonly (ProjectedPose & { readonly visibilityDepth: number })[], viewport: Viewport, options: WebGLTrailStyle): void {
      const trailWidth = options.width ?? 1;
      const rgb = options.color ?? [1, 0, 0];
      if (!Number.isFinite(trailWidth) || trailWidth < 0) {
        throw new RangeError('WebGL trail width must be finite and non-negative');
      }
      if (rgb.length !== 3 || !rgb.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
        throw new RangeError('WebGL trail color must contain three RGB channels in [0, 1]');
      }
      let segments = 0;
      for (let index = 0; index < positions.length; index++) {
        const position = positions[index];
        if (![position.x, position.y, position.visibilityDepth].every(Number.isFinite)) {
          throw new RangeError('WebGL trail position and visibility depth must be finite');
        }
        const previous = positions[index - 1];
        if (previous && (previous.x !== position.x || previous.y !== position.y)) segments++;
      }
      if (trailWidth === 0 || segments === 0) return;

      // Allocate only when a trail has visible geometry to submit. Existing
      // marker-only users keep exactly the same GPU resource footprint.
      if (!trailProgram) {
        try {
          trailProgram = geometryProgram(trailVertex, trailFragment);
          trailBuffer = required(gl.createBuffer(), 'trail buffer');
          trailColor = required(gl.getUniformLocation(trailProgram, 'color'), 'trail color uniform');
        } catch (error) {
          if (trailProgram) { gl.deleteProgram(trailProgram); lightingUniforms.delete(trailProgram); }
          if (trailBuffer) gl.deleteBuffer(trailBuffer);
          trailProgram = trailBuffer = undefined;
          throw error;
        }
      }
      const floats = segments * 18;
      let changed = floats !== trailSubmittedFloats;
      if (trailVertices.length < floats) {
        trailVertices = new Float32Array(Math.max(floats, trailVertices.length * 2));
        changed = true;
      }
      let offset = 0;
      const appendFloat = (value: number): void => {
        const packed = Math.fround(value);
        if (trailVertices[offset] !== packed) changed = true;
        trailVertices[offset++] = packed;
      };
      const append = (x: number, y: number, visibilityDepth: number): void => {
        appendFloat(x * 2 / viewport.width - 1);
        appendFloat(1 - y * 2 / viewport.height);
        appendFloat(visibilityDepth * 2 - 1);
      };
      for (let index = 1; index < positions.length; index++) {
        const a = positions[index - 1];
        const b = positions[index];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) continue;
        const nx = -dy / length * trailWidth / 2;
        const ny = dx / length * trailWidth / 2;
        // Segment quads avoid implementation-dependent GL line width limits.
        // Keep each endpoint's depth so hardware clips and interpolates it,
        // including segments crossing either camera plane or viewport edge.
        append(a.x + nx, a.y + ny, a.visibilityDepth);
        append(a.x - nx, a.y - ny, a.visibilityDepth);
        append(b.x + nx, b.y + ny, b.visibilityDepth);
        append(b.x + nx, b.y + ny, b.visibilityDepth);
        append(a.x - nx, a.y - ny, a.visibilityDepth);
        append(b.x - nx, b.y - ny, b.visibilityDepth);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      bindQuad();
      gl.bindBuffer(gl.ARRAY_BUFFER, trailBuffer!);
      if (trailBufferCapacity < trailVertices.length) {
        gl.bufferData(gl.ARRAY_BUFFER, trailVertices.byteLength, gl.DYNAMIC_DRAW);
        trailBufferCapacity = trailVertices.length;
        changed = true;
      }
      // Lighting and color changes redraw without resubmitting identical geometry.
      if (changed) gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailVertices.subarray(0, offset));
      trailSubmittedFloats = offset;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(trailProgram);
      applyLighting(trailProgram!);
      gl.uniform3f(trailColor, rgb[0], rgb[1], rgb[2]);
      gl.drawArrays(gl.TRIANGLES, 0, offset / 3);
    },
    drawRibbon(geometry: RibbonGeometry, viewport: Viewport, projection: Float32Array): void {
      if (geometry.colors.length !== geometry.vertices.length) {
        throw new RangeError('WebGL ribbon colors must match world position storage');
      }
      const capacity = geometry.vertices.length / 18;
      if (!Number.isInteger(capacity) || !Number.isSafeInteger(geometry.count) || geometry.count < 0 || geometry.count > capacity ||
          !Number.isSafeInteger(geometry.next) || geometry.next < 0 || (capacity > 0 ? geometry.next >= capacity : geometry.next !== 0)) {
        throw new RangeError('WebGL ribbon geometry must contain a valid segment ring');
      }
      if (geometry.dirtySlot !== undefined && (!Number.isSafeInteger(geometry.dirtySlot) || geometry.dirtySlot < 0 || geometry.dirtySlot >= capacity)) {
        throw new RangeError('WebGL ribbon dirty segment must be within the ring');
      }
      if (geometry.count === 0) return;
      const changed = geometry.revision !== ribbonRevision;
      const fullUpload = !ribbonBuffer || ribbonVertices !== geometry.vertices || ribbonColors !== geometry.colors ||
        ribbonBufferCapacity !== geometry.vertices.length ||
        (changed && geometry.dirtySlot === undefined);
      const offset = fullUpload ? 0 : (geometry.dirtySlot ?? 0) * 18;
      const upload = fullUpload || (changed && geometry.dirtySlot !== undefined);
      const vertices = upload ? geometry.vertices.subarray(offset, fullUpload ? geometry.vertices.length : offset + 18) : undefined;
      const colors = upload ? geometry.colors.subarray(offset, fullUpload ? geometry.colors.length : offset + 18) : undefined;
      if (vertices && !vertices.every(Number.isFinite)) {
        throw new RangeError('WebGL ribbon world positions must be finite');
      }
      if (colors && !colors.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
        throw new RangeError('WebGL ribbon colors must contain RGB channels in [0, 1]');
      }
      if (!ribbonProgram) {
        try {
          ribbonProgram = geometryProgram(ribbonVertex, ribbonFragment, ['corner', 'paintColor']);
          ribbonBuffer = required(gl.createBuffer(), 'ribbon buffer');
          ribbonColorBuffer = required(gl.createBuffer(), 'ribbon color buffer');
          ribbonProjection = required(gl.getUniformLocation(ribbonProgram, 'projection'), 'ribbon projection uniform');
        } catch (error) {
          if (ribbonProgram) { gl.deleteProgram(ribbonProgram); lightingUniforms.delete(ribbonProgram); }
          if (ribbonBuffer) gl.deleteBuffer(ribbonBuffer);
          if (ribbonColorBuffer) gl.deleteBuffer(ribbonColorBuffer);
          ribbonProgram = ribbonBuffer = ribbonColorBuffer = undefined;
          throw error;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      bindQuad();
      gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer!);
      if (ribbonBufferCapacity !== geometry.vertices.length) {
        gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices.byteLength, gl.DYNAMIC_DRAW);
      }
      if (vertices) gl.bufferSubData(gl.ARRAY_BUFFER, offset * Float32Array.BYTES_PER_ELEMENT, vertices);
      ribbonVertices = geometry.vertices;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ribbonColorBuffer!);
      if (ribbonBufferCapacity !== geometry.colors.length) {
        gl.bufferData(gl.ARRAY_BUFFER, geometry.colors.byteLength, gl.DYNAMIC_DRAW);
      }
      if (colors) gl.bufferSubData(gl.ARRAY_BUFFER, offset * Float32Array.BYTES_PER_ELEMENT, colors);
      ribbonBufferCapacity = geometry.vertices.length;
      ribbonColors = geometry.colors;
      ribbonRevision = geometry.revision;
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(ribbonProgram!);
      applyLighting(ribbonProgram!);
      gl.uniformMatrix4fv(ribbonProjection, false, projection);
      const oldest = geometry.count === capacity ? geometry.next : 0;
      const first = Math.min(geometry.count, capacity - oldest);
      gl.drawArrays(gl.TRIANGLES, oldest * 6, first * 6);
      if (first < geometry.count) gl.drawArrays(gl.TRIANGLES, 0, (geometry.count - first) * 6);
    },
    drawPaintFootprints(geometry: PaintFootprints, viewport: Viewport, projection: Float32Array): void {
      const capacity = geometry.vertices.length / 108;
      if (!Number.isInteger(capacity) || !Number.isSafeInteger(geometry.count) || geometry.count < 0 || geometry.count > capacity) {
        throw new RangeError('WebGL paint footprints must contain a valid sample count');
      }
      const start = geometry.start ?? 0;
      if (!Number.isSafeInteger(start) || start < 0 || (capacity > 0 ? start >= capacity : start !== 0)) {
        throw new RangeError('WebGL paint footprint start sample must be within storage');
      }
      const dirtySlots = geometry.dirtySlots ?? (geometry.dirtySlot === undefined ? undefined :
        [geometry.dirtySlot, ...(geometry.dirtyPreviousSlot === undefined ? [] : [geometry.dirtyPreviousSlot])]);
      for (const slot of [geometry.dirtySlot, geometry.dirtyPreviousSlot, ...(geometry.dirtySlots ?? [])]) {
        if (slot !== undefined && (!Number.isSafeInteger(slot) || slot < 0 || slot >= capacity)) {
          throw new RangeError('WebGL paint footprint dirty sample must be within storage');
        }
      }
      if (geometry.count === 0) return;
      const changed = geometry.revision !== footprintsRevision;
      const fullUpload = !footprintsBuffer || footprintsVertices !== geometry.vertices || footprintsBufferCapacity !== geometry.vertices.length ||
        (changed && (dirtySlots === undefined || footprintsRevision === undefined || geometry.revision !== footprintsRevision + 1));
      const ranges: [number, number][] = [];
      if (fullUpload) {
        ranges.push([0, geometry.vertices.length]);
      } else if (changed && dirtySlots) {
        // Merge only physically adjacent slots. Ring wrap leaves two uploads,
        // avoiding a resubmission of the unchanged history between them.
        for (const slot of [...new Set(dirtySlots)].sort((a, b) => a - b)) {
          const previous = ranges[ranges.length - 1];
          if (previous && previous[1] === slot * 108) previous[1] = (slot + 1) * 108;
          else ranges.push([slot * 108, (slot + 1) * 108]);
        }
      }
      for (const [from, to] of ranges) {
        for (let index = from; index < to; index++) {
          const value = geometry.vertices[index];
          const channel = index % 9;
          if (!Number.isFinite(value) ||
              (channel >= 3 && channel <= 5 && (value < 0 || value > 1)) ||
              ((channel === 6 || channel === 7) && (value < -1 || value > 1)) ||
              (channel === 8 && value !== 0 && value !== 1)) {
            throw new RangeError('WebGL paint footprint vertices must contain finite positions, RGB in [0, 1], local coordinates in [-1, 1], and a circle flag of zero or one');
          }
        }
      }
      if (!footprintsProgram) {
        try {
          footprintsProgram = geometryProgram(footprintsVertex, markersFragment, ['corner', 'paintColor', 'paintLocal', 'paintCircle']);
          footprintsBuffer = required(gl.createBuffer(), 'paint footprints buffer');
          footprintsProjection = required(gl.getUniformLocation(footprintsProgram, 'projection'), 'paint footprints projection uniform');
        } catch (error) {
          if (footprintsProgram) { gl.deleteProgram(footprintsProgram); lightingUniforms.delete(footprintsProgram); }
          if (footprintsBuffer) gl.deleteBuffer(footprintsBuffer);
          footprintsProgram = footprintsBuffer = undefined;
          throw error;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      bindQuad();
      gl.bindBuffer(gl.ARRAY_BUFFER, footprintsBuffer!);
      if (footprintsBufferCapacity !== geometry.vertices.length) {
        gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices.byteLength, gl.DYNAMIC_DRAW);
        footprintsBufferCapacity = geometry.vertices.length;
      }
      for (const [from, to] of ranges) {
        gl.bufferSubData(gl.ARRAY_BUFFER, from * Float32Array.BYTES_PER_ELEMENT, geometry.vertices.subarray(from, to));
      }
      footprintsVertices = geometry.vertices;
      footprintsRevision = geometry.revision;
      const stride = 9 * Float32Array.BYTES_PER_ELEMENT;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 8 * Float32Array.BYTES_PER_ELEMENT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(footprintsProgram!);
      applyLighting(footprintsProgram!);
      gl.uniformMatrix4fv(footprintsProjection, false, projection);
      // Connectors and endpoint caps share chronological submission; interior
      // caps are degenerate, and newer equal-depth paint wins at crossings.
      const first = Math.min(geometry.count, capacity - start);
      gl.drawArrays(gl.TRIANGLES, start * 12, first * 12);
      if (first < geometry.count) gl.drawArrays(gl.TRIANGLES, 0, (geometry.count - first) * 12);
    },
    setMarkers(markers: readonly WebGLMarker[], maxSamples: number): void {
      validateMarkerLimit(maxSamples);
      for (const marker of markers) validateWorldMarker(marker);
      markersCount = 0;
      markersNext = 0;
      const count = Math.min(markers.length, maxSamples);
      ensureMarkerCapacity(count, maxSamples);
      for (let index = markers.length - count; index < markers.length; index++) {
        packMarker(markers[index], markersCount++);
      }
      const capacity = markersVertices.length / markerSlotFloats;
      markersNext = capacity === 0 ? 0 : markersCount % capacity;
      if (markersBuffer && markersCount > 0) uploadMarkers();
    },
    addMarker(marker: WebGLMarker, maxSamples: number, replace: boolean): void {
      validateMarkerLimit(maxSamples);
      validateWorldMarker(marker);
      const resized = ensureMarkerCapacity(Math.min(maxSamples, markersCount + (replace && markersCount > 0 ? 0 : 1)), maxSamples);
      const capacity = markersVertices.length / markerSlotFloats;
      const slot = replace && markersCount > 0 ? (markersNext + capacity - 1) % capacity : markersNext;
      packMarker(marker, slot);
      if (!replace || markersCount === 0) {
        markersCount = Math.min(markersCount + 1, capacity);
        markersNext = (slot + 1) % capacity;
      }
      if (markersBuffer) {
        if (resized) uploadMarkers();
        else {
          gl.bindBuffer(gl.ARRAY_BUFFER, markersBuffer);
          const offset = slot * markerSlotFloats;
          gl.bufferSubData(gl.ARRAY_BUFFER, offset * Float32Array.BYTES_PER_ELEMENT,
            markersVertices.subarray(offset, offset + markerSlotFloats));
        }
      }
    },
    drawMarkers(viewport: Viewport, projection: Float32Array, planar: boolean): void {
      if (markersCount === 0) return;
      if (!markersProgram) {
        try {
          markersProgram = geometryProgram(markersVertex, markersFragment,
            ['corner', 'markerLocal', 'markerColor', 'markerCircle', 'markerRadius', 'markerDepth']);
          markersBuffer = required(gl.createBuffer(), 'markers buffer');
          markersProjection = required(gl.getUniformLocation(markersProgram, 'projection'), 'markers projection uniform');
          markersPixelScale = required(gl.getUniformLocation(markersProgram, 'pixelScale'), 'markers pixel scale uniform');
          markersPlanar = required(gl.getUniformLocation(markersProgram, 'planar'), 'markers planar uniform');
          uploadMarkers();
        } catch (error) {
          if (markersProgram) { gl.deleteProgram(markersProgram); lightingUniforms.delete(markersProgram); }
          if (markersBuffer) gl.deleteBuffer(markersBuffer);
          markersProgram = markersBuffer = undefined;
          markersBufferCapacity = 0;
          throw error;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      bindQuad();
      gl.bindBuffer(gl.ARRAY_BUFFER, markersBuffer!);
      const stride = markerStride * Float32Array.BYTES_PER_ELEMENT;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 5 * Float32Array.BYTES_PER_ELEMENT);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 8 * Float32Array.BYTES_PER_ELEMENT);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 9 * Float32Array.BYTES_PER_ELEMENT);
      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 10 * Float32Array.BYTES_PER_ELEMENT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(markersProgram!);
      applyLighting(markersProgram!);
      gl.uniformMatrix4fv(markersProjection, false, projection);
      gl.uniform2f(markersPixelScale, 2 / viewport.width, 2 / viewport.height);
      gl.uniform1i(markersPlanar, planar ? 1 : 0);
      const capacity = markersVertices.length / markerSlotFloats;
      const oldest = markersCount === capacity ? markersNext : 0;
      const first = Math.min(markersCount, capacity - oldest);
      // Preserve chronological submission so equal-depth newer samples win.
      gl.drawArrays(gl.TRIANGLES, oldest * 6, first * 6);
      if (first < markersCount) gl.drawArrays(gl.TRIANGLES, 0, (markersCount - first) * 6);
    },
    draw(position: ProjectedPose, visibilityDepth: number, viewport: Viewport, options: WebGLMarkerOptions): void {
      const size = validateMarker(position, visibilityDepth, options);
      const rgb = options.color ?? defaultMarkerColor;
      if (size === 0 || visibilityDepth < 0 || visibilityDepth > 1) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      bindQuad();
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      // Equal-depth planar samples replace previous samples. Nearer samples win
      // in either drawing order; discarded circle corners never write depth.
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(markerProgram!);
      applyLighting(markerProgram!);
      gl.uniform3f(center, position.x * 2 / viewport.width - 1, 1 - position.y * 2 / viewport.height, visibilityDepth * 2 - 1);
      gl.uniform2f(radius, size * 2 / viewport.width, size * 2 / viewport.height);
      gl.uniform3f(color, rgb[0], rgb[1], rgb[2]);
      gl.uniform1i(circle, options.shape === 'square' ? 0 : 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    present(): void {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      bindQuad();
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(copyProgram!);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture!);
      gl.uniform1i(image, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
};

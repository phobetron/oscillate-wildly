import type { ProjectedPose, Viewport } from '../core';

/** Opaque RGB channels in the range [0, 1]. */
export type WebGLColor = readonly [number, number, number];

export interface WebGLMarkerOptions {
  /** Radius in CSS pixels, multiplied by pose.depth. Defaults to 5. */
  readonly radius?: number;
  readonly color?: WebGLColor;
  readonly shape?: 'circle' | 'square';
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
void main() {
  local = corner;
  gl_Position = vec4(center.xy + corner * radius, center.z, 1.0);
}`;

const fragment = `
precision mediump float;
uniform vec3 color;
uniform bool circle;
varying vec2 local;
void main() {
  if (circle && dot(local, local) > 1.0) discard;
  gl_FragColor = vec4(color, 1.0);
}`;

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
void main() { gl_Position = vec4(corner, 1.0); }
`;

const trailFragment = `
precision mediump float;
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }
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

const program = (gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram => {
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
    gl.bindAttribLocation(result, 0, 'corner');
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
  let markerProgram: WebGLProgram | undefined;
  let copyProgram: WebGLProgram | undefined;
  let trailProgram: WebGLProgram | undefined;
  let trailBuffer: WebGLBuffer | undefined;
  let trailColor!: WebGLUniformLocation;
  let trailVertices = new Float32Array(0);
  let trailBufferCapacity = 0;
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
    if (copyProgram) gl.deleteProgram(copyProgram);
    if (trailProgram) gl.deleteProgram(trailProgram);
    if (trailBuffer) gl.deleteBuffer(trailBuffer);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    if (depth) gl.deleteRenderbuffer(depth);
    if (target) gl.deleteFramebuffer(target);
    markerProgram = copyProgram = buffer = texture = depth = target = undefined;
    trailProgram = trailBuffer = undefined;
    trailVertices = new Float32Array(0);
    trailBufferCapacity = 0;
  };

  try {
    markerProgram = program(gl, vertex, fragment);
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

  return {
    dispose,
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
          trailProgram = program(gl, trailVertex, trailFragment);
          trailBuffer = required(gl.createBuffer(), 'trail buffer');
          trailColor = required(gl.getUniformLocation(trailProgram, 'color'), 'trail color uniform');
        } catch (error) {
          if (trailProgram) gl.deleteProgram(trailProgram);
          if (trailBuffer) gl.deleteBuffer(trailBuffer);
          trailProgram = trailBuffer = undefined;
          throw error;
        }
      }
      const floats = segments * 18;
      if (trailVertices.length < floats) {
        trailVertices = new Float32Array(Math.max(floats, trailVertices.length * 2));
      }
      let offset = 0;
      const append = (x: number, y: number, visibilityDepth: number): void => {
        trailVertices[offset++] = x * 2 / viewport.width - 1;
        trailVertices[offset++] = 1 - y * 2 / viewport.height;
        trailVertices[offset++] = visibilityDepth * 2 - 1;
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
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailVertices.subarray(0, offset));
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(trailProgram);
      gl.uniform3f(trailColor, rgb[0], rgb[1], rgb[2]);
      gl.drawArrays(gl.TRIANGLES, 0, offset / 3);
    },
    draw(position: ProjectedPose, visibilityDepth: number, viewport: Viewport, options: WebGLMarkerOptions): void {
      const markerRadius = options.radius ?? 5;
      const depthScale = position.depth ?? 1;
      const size = markerRadius * depthScale;
      const rgb = options.color ?? [1, 0, 0];
      if (!Number.isFinite(size) || markerRadius < 0 || depthScale < 0 || ![position.x, position.y, visibilityDepth].every(Number.isFinite)) {
        throw new RangeError('WebGL marker position, visibility depth, and radius must be finite; radius must be non-negative');
      }
      if (rgb.length !== 3 || !rgb.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
        throw new RangeError('WebGL marker color must contain three RGB channels in [0, 1]');
      }
      if (options.shape !== undefined && options.shape !== 'circle' && options.shape !== 'square') {
        throw new TypeError('WebGL marker shape must be circle or square');
      }
      if (size === 0 || visibilityDepth < 0 || visibilityDepth > 1) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!);
      bindQuad();
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      // Equal-depth planar samples replace previous samples. Nearer samples win
      // in either drawing order; discarded circle corners never write depth.
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(markerProgram!);
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

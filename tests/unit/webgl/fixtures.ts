import { expect } from '@rstest/core';
import type { AnalyticMotionSource, OrthographicCamera } from '../../../src/core';
import type { RuntimePlatform } from '../../../src/runtime';

// A recording boundary for the WebGL calls made by our renderer. It models buffer
// uploads and context loss only; shader compilation and rasterization are covered
// by browser tests. Unlisted methods deliberately have no fallback implementation.
type Operation = readonly [string, ...unknown[]];

export const fakeGL = (derivatives = true) => {
  const operations: Operation[] = [];
  let nextId = 1;
  let lost = false;
  let boundBuffer: unknown;
  const submitted: { buffer: unknown; data: Float32Array }[] = [];
  const normalBuffers = new Set<unknown>();
  const buffers = new Map<unknown, Float32Array>();
  const value: Record<string, unknown> = {};
  const constants = [
    'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'TRIANGLES',
    'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'NEAREST', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T',
    'CLAMP_TO_EDGE', 'FRAMEBUFFER', 'COLOR_ATTACHMENT0', 'DEPTH_ATTACHMENT', 'RENDERBUFFER', 'FLOAT',
    'BLEND', 'SCISSOR_TEST', 'CULL_FACE', 'DEPTH_TEST', 'LEQUAL', 'TRIANGLE_STRIP', 'TEXTURE0',
    'MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'RGBA', 'UNSIGNED_BYTE', 'DEPTH_COMPONENT16',
    'HIGH_FLOAT',
  ];
  constants.forEach((name, index) => { value[name] = index + 10; });
  Object.assign(value, { COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, FRAMEBUFFER_COMPLETE: 100 });
  for (const name of ['Shader', 'Program', 'Buffer', 'Texture', 'Renderbuffer', 'Framebuffer']) {
    value[`create${name}`] = () => {
      const handle = { type: name, id: nextId++ };
      operations.push([`create${name}`, handle]);
      return handle;
    };
  }
  for (const name of [
    'shaderSource', 'compileShader', 'deleteShader', 'attachShader', 'detachShader', 'bindAttribLocation',
    'linkProgram', 'deleteProgram', 'deleteBuffer', 'deleteTexture', 'deleteRenderbuffer', 'deleteFramebuffer',
    'bindBuffer', 'bufferData', 'bindTexture', 'texParameteri', 'bindFramebuffer', 'framebufferTexture2D',
    'framebufferRenderbuffer', 'enableVertexAttribArray', 'disableVertexAttribArray', 'vertexAttribPointer', 'disable', 'colorMask',
    'viewport', 'depthMask', 'clearColor', 'clearDepth', 'clear', 'texImage2D', 'bindRenderbuffer',
    'renderbufferStorage', 'enable', 'depthFunc', 'useProgram', 'uniform3f', 'uniform2f', 'uniform1i', 'uniform1f',
    'drawArrays', 'activeTexture', 'uniformMatrix3fv', 'vertexAttrib3f',
  ]) value[name] = (...args: unknown[]) => { operations.push([name, ...args]); };
  value.bindBuffer = (target: number, buffer: unknown) => { boundBuffer = buffer; operations.push(['bindBuffer', target, buffer]); };
  value.bufferData = (target: number, data: number | Float32Array, usage: number) => {
    buffers.set(boundBuffer, typeof data === 'number' ? new Float32Array(data / 4) : new Float32Array(data));
    operations.push(['bufferData', target, data, usage]);
  };
  value.bufferSubData = (target: number, offset: number, data: Float32Array) => {
    buffers.get(boundBuffer)?.set(data, offset / 4);
    submitted.push({ buffer: boundBuffer, data: new Float32Array(data) });
    operations.push(['bufferSubData', target, offset, new Float32Array(data)]);
  };
  value.uniformMatrix4fv = (location: unknown, transpose: boolean, matrix: Float32Array) => {
    operations.push(['uniformMatrix4fv', location, transpose, new Float32Array(matrix)]);
  };
  value.vertexAttribPointer = (...args: unknown[]) => {
    if (args[0] === 4 && args[1] === 3) normalBuffers.add(boundBuffer);
    operations.push(['vertexAttribPointer', ...args]);
  };
  Object.assign(value, {
    getShaderInfoLog: () => null,
    getProgramInfoLog: () => null,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program: unknown, name: string) => name,
    getParameter: () => 4096,
    checkFramebufferStatus: () => 100,
    isContextLost: () => lost,
    getExtension: (name: string) => derivatives && name === 'OES_standard_derivatives' ? {} : null,
    getShaderPrecisionFormat: () => ({ precision: 23 }),
  });
  return {
    value: value as unknown as WebGLRenderingContext,
    operations,
    failCompile: () => { value.getShaderParameter = () => false; value.getShaderInfoLog = () => 'bad shader'; },
    failUniform: () => { value.getUniformLocation = () => null; },
    failFramebuffer: () => { value.checkFramebufferStatus = () => -1; },
    setLost: (next: boolean) => { lost = next; },
    count: (name: string) => operations.filter(([operation]) => operation === name).length,
    uploadedBuffer: () => Array.from(buffers.get([...submitted].reverse().find(({ buffer }) => !normalBuffers.has(buffer))?.buffer) ?? []),
    uploadedPositions: () => [...submitted].reverse().find(({ buffer }) => !normalBuffers.has(buffer))?.data ?? new Float32Array(),
  };
};

export class Platform implements RuntimePlatform {
  callbacks = new Map<number, (time: number) => void>();
  next = 1;
  visible = true;
  reduced = false;
  visibility?: (visible: boolean) => void;
  preference?: (reduced: boolean) => void;
  intersection?: (visible: boolean) => void;
  resize?: () => void;
  requestAnimationFrame(callback: (time: number) => void) { const id = this.next++; this.callbacks.set(id, callback); return id; }
  cancelAnimationFrame(id: unknown) { this.callbacks.delete(id as number); }
  isDocumentVisible = () => this.visible;
  prefersReducedMotion = () => this.reduced;
  observeVisibility = (callback: (visible: boolean) => void) => { this.visibility = callback; return () => { this.visibility = undefined; }; };
  observeReducedMotion = (callback: (reduced: boolean) => void) => { this.preference = callback; return () => { this.preference = undefined; }; };
  observeIntersection = (_target: object, callback: (visible: boolean) => void) => { this.intersection = callback; return () => { this.intersection = undefined; }; };
  observeResize = (_target: object, callback: () => void) => { this.resize = callback; return () => { this.resize = undefined; }; };
  fire(time: number) { const pending = [...this.callbacks.values()]; this.callbacks.clear(); pending.forEach((callback) => callback(time)); }
}

export class Canvas extends EventTarget {
  width = 400;
  height = 200;
  cssWidth = 200;
  cssHeight = 100;
  constructor(readonly gl: WebGLRenderingContext | null) { super(); }
  getContext() { return this.gl; }
  getBoundingClientRect() { return { width: this.cssWidth, height: this.cssHeight }; }
  asElement() { return this as unknown as HTMLCanvasElement; }
}

export const source = (): AnalyticMotionSource<number> => ({
  kind: 'analytic', periodSeconds: 1,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  sample: (time) => ({ state: time, pose: { x: time, y: 0, depth: 2, opacity: 0.1 } }),
  reset() {},
});

export const camera: OrthographicCamera = {
  position: { x: 0, y: 0, z: 10 }, near: 1, far: 21,
  bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
};

export const loss = (canvas: Canvas, gl: ReturnType<typeof fakeGL>) => {
  gl.setLost(true);
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
};
export const restore = (canvas: Canvas, gl: ReturnType<typeof fakeGL>) => {
  gl.setLost(false);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
};

export const uploadedTrail = (gl: ReturnType<typeof fakeGL>): number[] => Array.from(gl.uploadedPositions());
export const coordinates = (vertices: number[], axis: number) => vertices.filter((_, index) => index % 3 === axis);
export const lastUniform = (gl: ReturnType<typeof fakeGL>, name: string) =>
  gl.operations.filter(([operation, location]) => operation.startsWith('uniform') && location === name).at(-1)?.slice(2);

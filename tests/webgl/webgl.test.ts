import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../src/webgl';
import type { WebGLFrame } from '../../src/webgl';
import type { AnalyticMotionSource, OrthographicCamera } from '../../src/core';
import type { RuntimePlatform } from '../../src/runtime';

type Operation = readonly [string, ...unknown[]];

const fakeGL = (derivatives = true) => {
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
    'renderbufferStorage', 'enable', 'depthFunc', 'useProgram', 'uniform3f', 'uniform2f', 'uniform1i',
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

class Platform implements RuntimePlatform {
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

class Canvas extends EventTarget {
  width = 400;
  height = 200;
  cssWidth = 200;
  cssHeight = 100;
  constructor(readonly gl: WebGLRenderingContext | null) { super(); }
  getContext() { return this.gl; }
  getBoundingClientRect() { return { width: this.cssWidth, height: this.cssHeight }; }
  asElement() { return this as unknown as HTMLCanvasElement; }
}

const source = (): AnalyticMotionSource<number> => ({
  kind: 'analytic', periodSeconds: 1,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  sample: (time) => ({ state: time, pose: { x: time, y: 0, depth: 2, opacity: 0.1 } }),
  reset() {},
});

const camera: OrthographicCamera = {
  position: { x: 0, y: 0, z: 10 }, near: 1, far: 21,
  bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
};

const loss = (canvas: Canvas, gl: ReturnType<typeof fakeGL>) => {
  gl.setLost(true);
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
};
const restore = (canvas: Canvas, gl: ReturnType<typeof fakeGL>) => {
  gl.setLost(false);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
};

describe('WebGL adapter', () => {
  const uploadedTrail = (gl: ReturnType<typeof fakeGL>): number[] => {
    return Array.from(gl.uploadedPositions());
  };
  const coordinates = (vertices: number[], axis: number) => vertices.filter((_, index) => index % 3 === axis);

  it('bounds tail history, copies poses, and does not age it on paused redraws', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const pose = { x: 0, y: 0 };
    const motion = { ...source(), sample: (time: number) => {
      pose.x = time;
      return { state: time, pose };
    } };
    const controller = animateWebGL(new Canvas(gl.value).asElement(), motion, {
      platform, trail: { maxSamples: 3, width: 4 }, framing: { fit: 'stretch' },
      marker: { color: [0, 1, 0] },
    });
    platform.fire(0);
    for (let index = 1; index <= 4; index++) platform.fire(index * 100);
    controller.pause();
    const vertices = uploadedTrail(gl);
    expect(vertices).toHaveLength(36); // Two segments, six XYZ vertices each.
    expect(Math.min(...coordinates(vertices, 0))).toBeCloseTo(0.1);
    expect(Math.max(...coordinates(vertices, 0))).toBeCloseTo(0.2);
    expect(gl.operations).toContainEqual(['uniform3f', 'color', 0, 1, 0]);
    expect(Math.max(...coordinates(vertices, 1)) - Math.min(...coordinates(vertices, 1))).toBeCloseTo(0.08);
    const programs = gl.count('createProgram');
    const buffers = gl.count('bufferData');
    for (let index = 0; index < 5; index++) controller.setFraming({ fit: 'stretch' });
    expect(uploadedTrail(gl)).toEqual(vertices);
    expect(gl.count('createProgram')).toBe(programs);
    expect(gl.count('bufferData')).toBe(buffers);
    controller.dispose();
    expect(gl.count('deleteProgram')).toBe(gl.count('createProgram'));
    expect(gl.count('deleteBuffer')).toBe(gl.count('createBuffer'));
  });

  it('reprojects retained XYZ samples on camera, framing, resize, and context recovery', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, trail: true, camera, framing: { fit: 'stretch' }, marker: () => null,
      position: ({ state }) => ({ x: state, y: 0, z: state * 10 }),
    });
    platform.fire(0); platform.fire(100); platform.fire(200);
    controller.pause();
    expect(uploadedTrail(gl)).toHaveLength(36);
    expect(Math.max(...coordinates(uploadedTrail(gl), 2))).toBeCloseTo(-0.1);
    controller.setCamera({ ...camera, position: { x: 0, y: 0, z: 20 } });
    expect(uploadedTrail(gl)).toHaveLength(36);
    expect(Math.max(...coordinates(uploadedTrail(gl), 2))).toBeCloseTo(0.9);
    controller.setFraming({ fit: 'stretch', offsetX: 0.1 });
    expect(Math.min(...coordinates(uploadedTrail(gl), 0))).toBeCloseTo(0.2);
    canvas.cssWidth = 300;
    canvas.width = 600;
    platform.resize?.();
    const vertices = uploadedTrail(gl);
    loss(canvas, gl);
    restore(canvas, gl);
    expect(uploadedTrail(gl)).toEqual(vertices);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
  });

  it('clears history immediately and resets it without retaining a connector', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    let time = 0;
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, trail: true, marker: (frame) => { time = frame.elapsedSeconds; return {}; },
    });
    platform.fire(0); platform.fire(100);
    controller.pause();
    const uploads = gl.count('bufferSubData');
    controller.clear();
    expect(time).toBeCloseTo(0.05);
    controller.setFraming({ fit: 'stretch' });
    expect(gl.count('bufferSubData')).toBe(uploads);
    controller.resume();
    platform.fire(200); platform.fire(300);
    expect(gl.count('bufferSubData')).toBe(uploads + 1);
    controller.reset();
    expect(time).toBe(0);
    expect(gl.count('bufferSubData')).toBe(uploads + 1);
    controller.dispose();
  });

  it('validates trail options before allocating resources and handles a one-sample tail', () => {
    for (const trail of [{ maxSamples: 0 }, { maxSamples: 1.5 }, { maxSamples: Infinity }, { maxSamples: -Infinity },
      { width: -1 }, { width: NaN }, { color: [1, -1, 0] as const }]) {
      const gl = fakeGL();
      expect(() => animateWebGL(new Canvas(gl.value).asElement(), source(), { trail, platform: new Platform() })).toThrow();
      expect(gl.count('createProgram')).toBe(0);
    }
    expect(() => animateWebGL(new Canvas(null).asElement(), source(), { trail: true, accumulate: true })).toThrow(/cannot be combined/);
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), { platform, trail: { maxSamples: 1 } });
    platform.fire(0); platform.fire(100);
    expect(gl.count('bufferSubData')).toBe(0);
    expect(gl.count('createProgram')).toBe(2);
    controller.dispose();
  });

  it('keeps each planar sample visibility depth and lets explicit tail color override marker color', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform, trail: { color: [0, 0, 1] }, visibilityDepth: ({ state }) => state * 10,
      marker: { color: [0, 1, 0] },
    });
    platform.fire(0); platform.fire(50); platform.fire(100);
    const depths = coordinates(uploadedTrail(gl), 2);
    expect(Math.min(...depths)).toBeCloseTo(-1);
    expect(Math.max(...depths)).toBeCloseTo(1);
    expect(gl.operations).toContainEqual(['uniform3f', 'color', 0, 0, 1]);
    controller.dispose();
  });

  it('releases all resources when lazy trail setup fails', () => {
    for (const failure of ['shader', 'uniform', 'buffer']) {
      const gl = fakeGL();
      const platform = new Platform();
      const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), { platform, trail: true });
      if (failure === 'shader') gl.failCompile();
      if (failure === 'uniform') gl.failUniform();
      if (failure === 'buffer') Object.assign(gl.value, { createBuffer: () => null });
      platform.fire(0);
      expect(() => platform.fire(50)).toThrow();
      expect(gl.count('deleteProgram')).toBe(gl.count('createProgram'));
      expect(gl.count('deleteShader')).toBe(gl.count('createShader'));
      expect(gl.count('deleteBuffer')).toBe(gl.count('createBuffer'));
      expect(gl.count('deleteFramebuffer')).toBe(gl.count('createFramebuffer'));
      expect(platform.callbacks.size).toBe(0);
      expect(platform.resize).toBeUndefined();
      controller.dispose();
    }
  });

  it('keeps consumer dimensions, configures opaque depth testing, and evaluates appearance from the current frame', () => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const platform = new Platform();
    const frames: WebGLFrame<number>[] = [];
    const controller = animateWebGL(canvas.asElement(), source(), {
      autoplay: false, platform, visibilityDepth: 0.2,
      marker: (frame) => { frames.push(frame); return { radius: 7, color: [0, 0.5, 1], shape: 'square' }; },
    });
    expect([canvas.width, canvas.height, canvas.cssWidth, canvas.cssHeight]).toEqual([400, 200, 200, 100]);
    expect(frames[0].position.visibilityDepth).toBe(0.2);
    expect(frames[0].position.depth).toBe(2);
    expect(gl.operations).toContainEqual(['uniform2f', 'radius', 0.14, 0.28]);
    expect(gl.operations).toContainEqual(['uniform3f', 'color', 0, 0.5, 1]);
    expect(gl.operations).toContainEqual(['uniform1i', 'circle', 0]);
    expect(gl.operations).toContainEqual(['depthFunc', gl.value.LEQUAL]);
    expect(gl.operations).toContainEqual(['enable', gl.value.DEPTH_TEST]);
    expect(gl.operations).toContainEqual(['disable', gl.value.BLEND]);
    controller.dispose();
  });

  it('updates retained marker slots with stable GPU resources and clears independently of resetting motion', () => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const platform = new Platform();
    let resets = 0;
    let latestTime = 0;
    const motion = { ...source(), reset: () => { resets += 1; } };
    const controller = animateWebGL(canvas.asElement(), motion, {
      accumulate: true, platform,
      marker: (frame) => { latestTime = frame.elapsedSeconds; return {}; },
    });
    platform.fire(0);
    for (let index = 1; index <= 100; index++) platform.fire(index * 10);
    expect(gl.count('clear')).toBe(101);
    expect(gl.count('drawArrays')).toBe(202);
    expect(gl.count('createProgram')).toBe(3);
    expect(gl.count('createTexture')).toBe(1);
    expect((gl.operations.filter(([name]) => name === 'bufferSubData').at(-1)?.[3] as Float32Array).length).toBe(66);
    expect(gl.count('texImage2D')).toBe(1);
    const elapsed = latestTime;
    const drawings = gl.count('drawArrays');
    controller.pause();
    controller.clear();
    expect(resets).toBe(0);
    expect(latestTime).toBe(elapsed);
    expect(gl.count('drawArrays')).toBe(drawings + 1); // presentation only
    expect(controller.isPaused()).toBe(true);
    controller.reset();
    expect(resets).toBe(1);
    expect(latestTime).toBe(0);
    expect(gl.count('clear')).toBe(103);
    controller.dispose();
    controller.dispose();
    expect(gl.count('deleteProgram')).toBe(3);
    expect(gl.count('deleteShader')).toBe(6);
    expect(gl.count('deleteTexture')).toBe(1);
    expect(gl.count('deleteRenderbuffer')).toBe(1);
    expect(gl.count('deleteFramebuffer')).toBe(1);
    expect(gl.count('deleteBuffer')).toBe(2);
    expect(platform.callbacks.size).toBe(0);
    expect(platform.resize).toBeUndefined();
    expect(platform.visibility).toBeUndefined();
  });

  it('clears each frame by default and permits skipping a marker', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), source(), { platform, marker: () => null });
    platform.fire(0);
    platform.fire(10);
    expect(gl.count('clear')).toBe(2);
    expect(gl.count('drawArrays')).toBe(2); // presentation only
    controller.dispose();
  });

  it('bounds accumulated markers and reprojects the entire history without adding paused samples', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    const color: [number, number, number] = [1, 0, 0];
    const motion = { ...source(), sample: (time: number) => ({ state: time, pose: { x: time * 10 - 0.5, y: 0, z: 0 } }) };
    const controller = animateWebGL(canvas.asElement(), motion, {
      platform, accumulate: { maxSamples: 3 }, camera, framing: { fit: 'stretch' },
      marker: () => ({ color, shape: 'square', radius: 4 }),
    });
    platform.fire(0);
    for (let index = 1; index <= 4; index++) platform.fire(index * 100);
    controller.pause();
    const vertices = gl.uploadedBuffer();
    expect(vertices).toHaveLength(3 * 6 * 11);
    expect([0, 66, 132].map((start) => vertices[start]).sort()).toEqual([0.5, 1, 1.5]);
    const draws = gl.count('drawArrays');
    const uploadsBeforeOrbit = gl.count('bufferSubData');
    const projectionBefore = gl.operations.filter(([operation]) => operation === 'uniformMatrix4fv').at(-1)?.[3];
    controller.setCamera({ ...camera, position: { x: 10, y: 0, z: 0 } });
    const rotated = gl.uploadedBuffer();
    expect(rotated).toEqual(vertices); // Retained XYZ stays fixed; only the projection changes.
    expect(gl.count('bufferSubData')).toBe(uploadsBeforeOrbit);
    expect(gl.operations.filter(([operation]) => operation === 'uniformMatrix4fv').at(-1)?.[3]).not.toEqual(projectionBefore);
    expect(gl.count('drawArrays')).toBe(draws + 3); // Two wrapped ranges plus presentation.
    expect(controller.isPaused()).toBe(true);
    loss(canvas, gl);
    restore(canvas, gl);
    expect(gl.uploadedBuffer().filter((_, index) => index % 66 === 0).sort()).toEqual([0.5, 1, 1.5]);
    controller.clear();
    controller.setCamera(camera);
    expect(gl.count('drawArrays')).toBeGreaterThan(draws); // The new current marker is redrawn.
    controller.dispose();
  });

  it('validates accumulation limits before allocating resources', () => {
    for (const maxSamples of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const gl = fakeGL();
      expect(() => animateWebGL(new Canvas(gl.value).asElement(), source(), {
        platform: new Platform(), accumulate: { maxSamples },
      })).toThrow(RangeError);
      expect(gl.count('createProgram')).toBe(0);
    }
  });

  it('paints with the marker footprint, preserves the whole stroke, and pauses at the paint limit', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    let limits = 0;
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, paint: { maxSamples: 4 }, camera,
      marker: { shape: 'circle', radius: 5 }, onPaintLimit: () => { limits++; },
    });
    platform.fire(0);
    for (let index = 1; index <= 4; index++) platform.fire(index * 100);
    expect(controller.isPaintFull()).toBe(true);
    expect(controller.isPaused()).toBe(true);
    expect(limits).toBe(1);
    const positions = gl.uploadedPositions();
    const ys = Array.from(positions).filter((_, index) => index % 9 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.4); // radius 5 × pose.depth 2 gives 20 CSS pixels.
    const uploads = gl.count('bufferSubData');
    const draws = gl.count('drawArrays');
    controller.setCamera({ ...camera, position: { x: 0, y: -10, z: 0 }, up: { x: 0, y: 0, z: 1 } });
    expect(gl.count('bufferSubData')).toBe(uploads);
    expect(gl.count('drawArrays')).toBe(draws + 2); // Continuous surface and endpoint caps, then presentation.
    controller.resume();
    expect(platform.callbacks.size).toBe(0); // Full paint cannot silently discard its beginning.
    loss(canvas, gl); restore(canvas, gl);
    expect(controller.isPaintFull()).toBe(true);
    expect(controller.isPaused()).toBe(true);
    controller.clear();
    expect(controller.isPaintFull()).toBe(false);
    controller.resume();
    platform.fire(1000); platform.fire(1100);
    expect(gl.count('bufferSubData')).toBeGreaterThan(uploads);
    controller.dispose();
    expect(gl.count('deleteBuffer')).toBe(3); // Quad, paint vertices and smooth normals.
  });

  it('paints independently of marker shape and rejects invalid brushes', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), { platform, paint: true, marker: { shape: 'circle' } });
    platform.fire(0); platform.fire(100);
    expect(uploadedTrail(gl)).toHaveLength(216); // Two samples, each with surface and endpoint geometry.
    controller.dispose();
    for (const marker of [
      { shape: 'circle' as const, radius: -1 }, { shape: 'circle' as const, radius: NaN },
      { shape: 'circle' as const, color: [1, -1, 0] as const },
    ]) {
      expect(() => animateWebGL(new Canvas(fakeGL().value).asElement(), source(), { platform: new Platform(), paint: true, marker })).toThrow();
    }
    expect(() => animateWebGL(new Canvas(fakeGL().value).asElement(), source(), {
      platform: new Platform(), trail: true, paint: true, marker: { shape: 'circle' },
    })).toThrow(/cannot be combined/);
  });

  it('continues bounded painting in trim-oldest mode and preserves retained geometry on redraw and recovery', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    let limits = 0;
    const sampleTimes: number[] = [];
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, camera, paint: { maxSamples: 5, limitBehavior: 'trim-oldest' },
      onPaintLimit: () => { limits++; }, marker(frame) {
        if (sampleTimes.at(-1) !== frame.elapsedSeconds) sampleTimes.push(frame.elapsedSeconds);
        return { radius: 5 };
      },
    });
    platform.fire(0);
    for (let index = 1; index <= 8; index++) platform.fire(index * 100);
    expect(controller.isPaintFull()).toBe(true);
    expect(controller.isPaused()).toBe(false);
    expect(limits).toBe(0);
    const allocations = gl.count('bufferData');
    for (let index = 9; index <= 40; index++) {
      const firstOperation = gl.operations.length;
      platform.fire(index * 100);
      const uploads = gl.operations.slice(firstOperation).filter(([name]) => name === 'bufferSubData');
      // Head, previous head, exposed tail and its outgoing strip; each has XYZ normals too.
      expect(uploads.reduce((sum, upload) => sum + (upload[3] as Float32Array).length, 0)).toBeLessThanOrEqual(4 * (108 + 36));
    }
    expect(gl.count('bufferData')).toBe(allocations);
    const stored = gl.uploadedBuffer();
    expect(stored).toHaveLength(5 * 108);
    // Connector slot XYZ begins at the prior point: no evicted point remains in geometry.
    const xs = stored.filter((_, index) => index % 9 === 0);
    expect(Math.min(...xs)).toBeCloseTo(sampleTimes.at(-5)! - 0.2);
    controller.pause();
    const uploads = gl.count('bufferSubData');
    controller.setCamera({ ...camera, position: { x: 2, y: -3, z: 8 } });
    controller.setLighting(true);
    expect(gl.count('bufferSubData')).toBe(uploads);
    expect(controller.isPaused()).toBe(true);
    loss(canvas, gl); restore(canvas, gl);
    expect(gl.uploadedBuffer()).toEqual(stored);
    expect(controller.isPaintFull()).toBe(true);
    controller.resume();
    expect(platform.callbacks.size).toBe(1);
    controller.clear();
    expect(controller.isPaintFull()).toBe(false);
    platform.fire(4100); platform.fire(4200);
    expect(controller.isPaused()).toBe(false);
    controller.dispose();
  });

  it('supports a one-sample rolling dab and rejects invalid paint limit policies before resource allocation', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform, paint: { maxSamples: 1, limitBehavior: 'trim-oldest' },
    });
    expect(controller.isPaintFull()).toBe(true);
    expect(controller.isPaused()).toBe(false);
    platform.fire(0); platform.fire(100);
    expect(controller.isPaused()).toBe(false);
    expect(gl.uploadedBuffer()).toHaveLength(108);
    controller.pause(); controller.resume();
    expect(platform.callbacks.size).toBe(1);
    controller.dispose();
    const invalidGL = fakeGL();
    expect(() => animateWebGL(new Canvas(invalidGL.value).asElement(), source(), {
      paint: { limitBehavior: 'invalid' as 'pause' }, platform: new Platform(),
    })).toThrow(/limitBehavior/);
    expect(invalidGL.count('createProgram')).toBe(0);
    for (const maxSamples of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => animateWebGL(new Canvas(invalidGL.value).asElement(), source(), {
        paint: { maxSamples, limitBehavior: 'trim-oldest' }, platform: new Platform(),
      })).toThrow(RangeError);
    }
  });

  it('lifts the brush when contain padding collapses a tiny viewport without losing paint or faulting', () => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    canvas.cssWidth = canvas.cssHeight = 20;
    const platform = new Platform();
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, paint: true, framing: { fit: 'contain' }, marker: { shape: 'circle' },
    });
    platform.fire(0); platform.fire(100);
    expect(gl.count('bufferSubData')).toBe(0);
    canvas.cssWidth = 200; canvas.cssHeight = 100;
    platform.resize?.();
    platform.fire(200); platform.fire(300);
    expect(gl.count('bufferSubData')).toBeGreaterThan(0);
    controller.dispose();
  });

  it('deposits identical world-space paint while moving with a fixed or rotating camera', () => {
    const create = () => {
      const gl = fakeGL();
      const platform = new Platform();
      const motion = { ...source(), sample: (time: number) => ({ state: time, pose: { x: 3 * time, y: 5 * time, z: 7 * time } }) };
      const controller = animateWebGL(new Canvas(gl.value).asElement(), motion, {
        platform, camera, paint: true, marker: { radius: 5 },
      });
      return { gl, platform, controller };
    };
    const fixed = create();
    const orbiting = create();
    for (const target of [fixed, orbiting]) { target.platform.fire(0); target.platform.fire(100); }
    orbiting.controller.setCamera({ ...camera, position: { x: 7, y: -7, z: 3 }, up: { x: 0, y: 0, z: 1 } });
    for (const target of [fixed, orbiting]) target.platform.fire(200);
    const positions = (gl: ReturnType<typeof fakeGL>) => gl.uploadedPositions();
    expect(positions(orbiting.gl)).toEqual(positions(fixed.gl));
    orbiting.controller.setFraming({ fit: 'contain', zoom: 2 });
    for (const target of [fixed, orbiting]) target.platform.fire(300);
    expect(positions(orbiting.gl)).toEqual(positions(fixed.gl));
    fixed.controller.dispose(); orbiting.controller.dispose();
  });

  it('changes future brush footprints from circle to square without replacing paint or resetting motion', () => {
    const gl = fakeGL();
    const platform = new Platform();
    let shape: 'circle' | 'square' = 'circle';
    let time = 0;
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform, paint: true, marker(frame) { time = frame.elapsedSeconds; return { shape }; },
    });
    platform.fire(0); platform.fire(100); controller.pause();
    const elapsed = time;
    const uploads = gl.count('bufferSubData');
    shape = 'square';
    controller.setFraming({ fit: 'stretch' });
    expect(time).toBe(elapsed);
    expect(gl.count('bufferSubData')).toBe(uploads);
    expect(gl.operations.filter(([name, uniform]) => name === 'uniform3f' && uniform === 'color')).toHaveLength(0); // No separate head marker.
    expect(controller.isPaused()).toBe(true);
    controller.resume(); platform.fire(200); platform.fire(300);
    const footprints = gl.uploadedBuffer();
    expect(footprints[54 + 8]).toBe(1); // Captured circular starting cap.
    expect(footprints[108 + 54 + 6]).toBe(0); // Intermediate cap is collapsed.
    expect(footprints[216 + 54 + 6]).toBe(-1); // Leading cap is still present.
    expect(footprints[216 + 54 + 8]).toBe(0); // Newly selected square brush.
    controller.dispose();
  });

  it('toggles lighting on retained drawing while paused without changing samples, colors, size, or GPU buffers', () => {
    for (const mode of [{ accumulate: true }, { paint: true }, { trail: true }, {}]) {
      const gl = fakeGL();
      const platform = new Platform();
      let time = 0;
      const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
        platform, camera, ...mode,
        marker(frame) { time = frame.elapsedSeconds; return { radius: 7, color: [0.2, 0.5, 0.8] }; },
      });
      platform.fire(0); platform.fire(100); controller.pause();
      const elapsed = time;
      const uploads = gl.count('bufferSubData');
      const allocations = gl.count('bufferData');
      const geometry = gl.uploadedBuffer();
      controller.setLighting(true);
      expect(gl.operations).toContainEqual(['uniform1i', 'lightingEnabled', 1]);
      expect(time).toBe(elapsed);
      expect(gl.count('bufferSubData')).toBe(uploads);
      expect(gl.count('bufferData')).toBe(allocations);
      expect(gl.uploadedBuffer()).toEqual(geometry);
      expect(controller.isPaused()).toBe(true);
      controller.setLighting(false);
      expect(gl.operations).toContainEqual(['uniform1i', 'lightingEnabled', 0]);
      controller.dispose();
    }
  });

  it('keeps lighting choices through context recovery and supports depth-cue fallback without derivatives', () => {
    for (const derivatives of [true, false]) {
      const gl = fakeGL(derivatives);
      const canvas = new Canvas(gl.value);
      const platform = new Platform();
      const controller = animateWebGL(canvas.asElement(), source(), { platform, paint: true, camera });
      platform.fire(0); platform.fire(100); controller.pause();
      loss(canvas, gl);
      controller.setLighting(true);
      restore(canvas, gl);
      expect(gl.operations).toContainEqual(['uniform1i', 'lightingEnabled', 1]);
      expect(controller.isPaused()).toBe(true);
      const fragmentSources = gl.operations.filter(([name, , source]) => name === 'shaderSource' && String(source).includes('vec4 shade'));
      expect(fragmentSources.length).toBeGreaterThan(0);
      for (const [, , source] of fragmentSources) {
        expect(String(source).includes('dFdx')).toBe(derivatives);
        expect(String(source).includes('#extension GL_OES_standard_derivatives')).toBe(derivatives);
      }
      controller.dispose();
    }
  });

  it('rejects invalid lighting settings before allocating resources or changing a live view', () => {
    const gl = fakeGL();
    expect(() => animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform: new Platform(), lighting: 'yes' as unknown as boolean,
    })).toThrow(/boolean/);
    expect(gl.count('createProgram')).toBe(0);
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), { platform: new Platform(), autoplay: false });
    expect(() => controller.setLighting('yes' as unknown as boolean)).toThrow(/boolean/);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
  });

  it('reprojects accumulated model coordinates on camera, framing, CSS, and bitmap changes while paused', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    let frame!: WebGLFrame<number>;
    const mutableCamera = { ...camera, position: { ...camera.position } };
    const controller = animateWebGL(canvas.asElement(), source(), {
      accumulate: true, autoplay: false, platform, camera: mutableCamera,
      framing: { fit: 'stretch' }, position: () => ({ x: 1, y: 0.5, z: 5 }),
      marker: (value) => { frame = value; return {}; },
    });
    expect(frame.position).toMatchObject({ x: 150, y: 25, depth: 2, visibilityDepth: 0.2 });
    expect(frame.pose).toMatchObject({ x: 1, y: 0.5, z: 5 });
    expect(frame.project(frame.pose)).toEqual(frame.position);
    mutableCamera.position.z = 100;
    platform.resize?.();
    expect(frame.position.visibilityDepth).toBe(0.2); // snapshot configuration
    expect(gl.count('clear')).toBe(2);
    controller.setCamera({ ...camera, position: { x: 0, y: 0, z: 15 } });
    expect(frame.position.visibilityDepth).toBe(0.45);
    expect(gl.count('clear')).toBe(3);
    expect(gl.operations.filter(([operation]) => operation === 'clear').at(-1)).toEqual(['clear', gl.value.COLOR_BUFFER_BIT | gl.value.DEPTH_BUFFER_BIT]);
    controller.setFraming({ fit: 'stretch', offsetX: 0.1 });
    expect(frame.position.x).toBe(170);
    expect(gl.count('clear')).toBe(4);
    expect(gl.operations.filter(([operation]) => operation === 'clear').at(-1)).toEqual(['clear', gl.value.COLOR_BUFFER_BIT | gl.value.DEPTH_BUFFER_BIT]);
    canvas.cssWidth = 300;
    platform.resize?.();
    expect(gl.count('clear')).toBe(5);
    expect(gl.count('texImage2D')).toBe(1);
    canvas.width = 600;
    platform.resize?.();
    expect(gl.count('clear')).toBe(6);
    expect(gl.count('texImage2D')).toBe(2);
    expect(gl.count('createTexture')).toBe(1);
    expect(controller.isPaused()).toBe(true);
    expect(() => controller.setCamera({ ...camera, far: 0 })).toThrow(/far/);
    platform.resize?.();
    expect(frame.position.visibilityDepth).toBe(0.45);
    controller.setCamera(undefined);
    expect(frame.position.visibilityDepth).toBe(0.5);
    controller.dispose();
  });

  it('clips visibility depth independently of marker scale', () => {
    for (const depth of [-0.1, 1.1]) {
      const gl = fakeGL();
      const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
        autoplay: false, platform: new Platform(), visibilityDepth: depth,
      });
      expect(gl.count('drawArrays')).toBe(1);
      controller.dispose();
    }
  });

  it('suspends lost contexts without advancing time and preserves pause changes made during loss', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    let time = 0;
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, accumulate: true, marker: (frame) => { time = frame.elapsedSeconds; return {}; },
    });
    platform.fire(0); platform.fire(20);
    const elapsed = time;
    loss(canvas, gl);
    expect(controller.isPaused()).toBe(true);
    expect(platform.callbacks.size).toBe(0);
    controller.pause();
    controller.clear();
    controller.setCamera(camera);
    platform.fire(1000);
    restore(canvas, gl);
    expect(time).toBe(elapsed);
    expect(controller.isPaused()).toBe(true);
    expect(platform.callbacks.size).toBe(0);
    expect(gl.count('createProgram')).toBe(5);
    controller.resume();
    platform.fire(10000); platform.fire(10010);
    expect(time).toBeCloseTo(elapsed + 0.01);
    loss(canvas, gl);
    controller.pause();
    controller.resume();
    restore(canvas, gl);
    expect(controller.isPaused()).toBe(false);
    controller.dispose();
    const programs = gl.count('createProgram');
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(gl.count('createProgram')).toBe(programs);
  });

  it('restoration retains document, reduced-motion, and offscreen preferences', () => {
    for (const preference of ['hidden', 'reduced', 'offscreen']) {
      const gl = fakeGL();
      const platform = new Platform();
      const canvas = new Canvas(gl.value);
      const controller = animateWebGL(canvas.asElement(), source(), { platform });
      loss(canvas, gl);
      if (preference === 'hidden') platform.visibility?.(false);
      if (preference === 'reduced') platform.preference?.(true);
      if (preference === 'offscreen') platform.intersection?.(false);
      restore(canvas, gl);
      expect(controller.isPaused()).toBe(true);
      expect(platform.callbacks.size).toBe(0);
      if (preference === 'hidden') platform.visibility?.(true);
      if (preference === 'reduced') platform.preference?.(false);
      if (preference === 'offscreen') platform.intersection?.(true);
      expect(controller.isPaused()).toBe(false);
      controller.dispose();
    }
  });

  it('mounts an initially lost context without scheduling and restores its paused still frame', () => {
    const gl = fakeGL();
    gl.setLost(true);
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), source(), { autoplay: false, platform });
    expect(controller.isPaused()).toBe(true);
    expect(gl.count('createProgram')).toBe(0);
    expect(platform.callbacks.size).toBe(0);
    restore(canvas, gl);
    expect(controller.isPaused()).toBe(true);
    expect(gl.count('createProgram')).toBe(2);
    expect(gl.count('drawArrays')).toBe(2);
    controller.dispose();
  });

  it('releases controller ownership and partially rebuilt resources when restoration fails', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    // Capture the browser listener to exercise its error path synchronously.
    const listeners = new Map<string, EventListener>();
    canvas.addEventListener = (name: string, callback: EventListenerOrEventListenerObject | null) => {
      if (typeof callback === 'function') listeners.set(name, callback);
    };
    canvas.removeEventListener = (name: string) => { listeners.delete(name); };
    const controller = animateWebGL(canvas.asElement(), source(), { platform });
    listeners.get('webglcontextlost')?.(new Event('webglcontextlost', { cancelable: true }));
    gl.failCompile();
    expect(() => listeners.get('webglcontextrestored')?.(new Event('webglcontextrestored'))).toThrow(/bad shader/);
    expect(listeners.size).toBe(0);
    expect(platform.callbacks.size).toBe(0);
    expect(platform.resize).toBeUndefined();
    expect(gl.count('createProgram')).toBe(3);
    expect(gl.count('deleteProgram')).toBe(1); // original lost programs were invalidated by GL
    expect(gl.count('deleteShader')).toBe(5);
    Object.assign(gl.value, { getShaderParameter: () => true });
    const replacement = animateWebGL(canvas.asElement(), source(), { autoplay: false, platform });
    replacement.dispose();
    controller.dispose();
  });

  it('cleans up after setup failures and releases target ownership', () => {
    for (const failure of ['shader', 'uniform', 'framebuffer', 'marker']) {
      const gl = fakeGL();
      const platform = new Platform();
      const canvas = new Canvas(gl.value);
      if (failure === 'shader') gl.failCompile();
      if (failure === 'uniform') gl.failUniform();
      if (failure === 'framebuffer') gl.failFramebuffer();
      expect(() => animateWebGL(canvas.asElement(), source(), {
        autoplay: false, platform,
        marker: failure === 'marker' ? { color: [1, -1, 0] } : {},
      })).toThrow();
      expect(gl.count('deleteProgram')).toBe(gl.count('createProgram'));
      expect(gl.count('deleteShader')).toBe(gl.count('createShader'));
      expect(gl.count('deleteTexture')).toBe(gl.count('createTexture'));
      expect(platform.resize).toBeUndefined();
      const event = new Event('webglcontextlost', { cancelable: true });
      canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), source(), { autoplay: false, platform: new Platform() });
    controller.dispose();
    const replacement = animateWebGL(canvas.asElement(), source(), { autoplay: false, platform: new Platform() });
    replacement.dispose();
    expect(() => animateWebGL(new Canvas(null).asElement(), source())).toThrow(/WebGL/);
  });

  it('faults and releases resources when a later appearance callback fails', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform,
      marker: (frame) => {
        if (frame.elapsedSeconds > 0) throw new Error('appearance failed');
        return {};
      },
    });
    platform.fire(0);
    expect(() => platform.fire(10)).toThrow(/appearance failed/);
    expect(gl.count('deleteProgram')).toBe(2);
    expect(platform.callbacks.size).toBe(0);
    controller.dispose();
  });
});

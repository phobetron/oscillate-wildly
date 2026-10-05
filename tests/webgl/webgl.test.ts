import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../src/webgl';
import type { WebGLFrame } from '../../src/webgl';
import type { AnalyticMotionSource, OrthographicCamera } from '../../src/core';
import type { RuntimePlatform } from '../../src/runtime';

type Operation = readonly [string, ...unknown[]];

const fakeGL = () => {
  const operations: Operation[] = [];
  let nextId = 1;
  let lost = false;
  const value: Record<string, unknown> = {};
  const constants = [
    'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'TRIANGLES',
    'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'NEAREST', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T',
    'CLAMP_TO_EDGE', 'FRAMEBUFFER', 'COLOR_ATTACHMENT0', 'DEPTH_ATTACHMENT', 'RENDERBUFFER', 'FLOAT',
    'BLEND', 'SCISSOR_TEST', 'CULL_FACE', 'DEPTH_TEST', 'LEQUAL', 'TRIANGLE_STRIP', 'TEXTURE0',
    'MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'RGBA', 'UNSIGNED_BYTE', 'DEPTH_COMPONENT16',
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
    'framebufferRenderbuffer', 'enableVertexAttribArray', 'vertexAttribPointer', 'disable', 'colorMask',
    'viewport', 'depthMask', 'clearColor', 'clearDepth', 'clear', 'texImage2D', 'bindRenderbuffer',
    'renderbufferStorage', 'enable', 'depthFunc', 'useProgram', 'uniform3f', 'uniform2f', 'uniform1i',
    'drawArrays', 'activeTexture',
  ]) value[name] = (...args: unknown[]) => { operations.push([name, ...args]); };
  value.bufferSubData = (target: number, offset: number, data: Float32Array) => {
    operations.push(['bufferSubData', target, offset, new Float32Array(data)]);
  };
  Object.assign(value, {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program: unknown, name: string) => name,
    getParameter: () => 4096,
    checkFramebufferStatus: () => 100,
    isContextLost: () => lost,
  });
  return {
    value: value as unknown as WebGLRenderingContext,
    operations,
    failCompile: () => { value.getShaderParameter = () => false; value.getShaderInfoLog = () => 'bad shader'; },
    failUniform: () => { value.getUniformLocation = () => null; },
    failFramebuffer: () => { value.checkFramebufferStatus = () => -1; },
    setLost: (next: boolean) => { lost = next; },
    count: (name: string) => operations.filter(([operation]) => operation === name).length,
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
    const upload = gl.operations.filter(([operation]) => operation === 'bufferSubData').at(-1);
    return Array.from(upload?.[3] as Float32Array ?? []);
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

  it('adds markers incrementally with stable GPU resources and clears independently of resetting motion', () => {
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
    expect(gl.count('clear')).toBe(1);
    expect(gl.count('drawArrays')).toBe(202);
    expect(gl.count('createProgram')).toBe(2);
    expect(gl.count('createTexture')).toBe(1);
    expect(gl.count('bufferData')).toBe(1);
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
    expect(gl.count('clear')).toBe(3);
    controller.dispose();
    controller.dispose();
    expect(gl.count('deleteProgram')).toBe(2);
    expect(gl.count('deleteShader')).toBe(4);
    expect(gl.count('deleteTexture')).toBe(1);
    expect(gl.count('deleteRenderbuffer')).toBe(1);
    expect(gl.count('deleteFramebuffer')).toBe(1);
    expect(gl.count('deleteBuffer')).toBe(1);
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

  it('projects model coordinates in 3D and clears on camera, framing, CSS, and bitmap changes while paused', () => {
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
    expect(gl.count('clear')).toBe(1);
    controller.setCamera({ ...camera, position: { x: 0, y: 0, z: 15 } });
    expect(frame.position.visibilityDepth).toBe(0.45);
    expect(gl.count('clear')).toBe(2);
    controller.setFraming({ fit: 'stretch', offsetX: 0.1 });
    expect(frame.position.x).toBe(170);
    expect(gl.count('clear')).toBe(3);
    canvas.cssWidth = 300;
    platform.resize?.();
    expect(gl.count('clear')).toBe(4);
    expect(gl.count('texImage2D')).toBe(1);
    canvas.width = 600;
    platform.resize?.();
    expect(gl.count('clear')).toBe(5);
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
    expect(gl.count('createProgram')).toBe(4);
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

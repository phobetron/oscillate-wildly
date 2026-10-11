import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../../src/webgl';

import { fakeGL, Platform, Canvas, source, camera, loss, restore, lastUniform } from './fixtures';

describe('WebGL lifecycle', () => {
  it.each([
    ['accumulated markers', { accumulate: true }],
    ['paint', { paint: true }],
    ['trail', { trail: true }],
    ['current marker', {}],
  ] as const)('redraws the initial paused marker when reset follows clear during context loss (%s)', (_name, mode) => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const platform = new Platform();
    let time = -1;
    const controller = animateWebGL(canvas.asElement(), source(), {
      platform, ...mode, marker: (frame) => { time = frame.elapsedSeconds; return { color: [0, 1, 0] }; },
    });
    platform.fire(0); platform.fire(100); controller.pause();
    controller.clear();
    loss(canvas, gl);
    controller.reset();
    const drawings = gl.count('drawArrays');
    restore(canvas, gl);
    expect(time).toBe(0);
    expect(gl.count('drawArrays')).toBeGreaterThan(drawings + 1); // Restored marker/paint and presentation.
    expect(controller.isPaused()).toBe(true);
    expect(platform.callbacks.size).toBe(0);
    controller.dispose();
  });

  it.each([['accumulated markers', { accumulate: true }], ['current marker', {}]] as const)('applies marker scale changes made during context loss to the restored current marker (%s)', (_name, mode) => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), source(), {
      autoplay: false, platform: new Platform(), ...mode,
    });
    expect(lastUniform(gl, 'radius')).toEqual([0.1, 0.2]);
    loss(canvas, gl);
    controller.setMarkerScale({ depthStrength: 0 });
    restore(canvas, gl);
    expect(lastUniform(gl, 'radius')).toEqual([0.05, 0.1]);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
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

  it.each([['hidden document', 'hidden'], ['reduced motion', 'reduced'], ['offscreen canvas', 'offscreen']] as const)('restoration retains document, reduced-motion, and offscreen preferences (%s)', (_name, preference) => {
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

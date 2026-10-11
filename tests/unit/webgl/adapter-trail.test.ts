import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../../src/webgl';
import { createHelixMotion } from '../../../src/motions/helix';

import { fakeGL, Platform, Canvas, source, camera, loss, restore, uploadedTrail, coordinates } from './fixtures';

describe('WebGL trail', () => {
  it('retains Helix tail segments without connecting the end of a cycle to the next start', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), createHelixMotion({ periodSeconds: 0.18, turns: 1 }), {
      platform, trail: { maxSamples: 12, width: 2 }, marker: () => null, framing: { fit: 'stretch', padding: 0 },
    });
    platform.fire(0);
    for (let time = 40; time <= 160; time += 40) platform.fire(time);
    const oldCycle = uploadedTrail(gl);
    expect(oldCycle).toHaveLength(72);
    platform.fire(200); // New cycle has only one point, so it has no connecting strip yet.
    expect(uploadedTrail(gl)).toEqual(oldCycle);
    platform.fire(240);
    controller.pause();
    const newCycle = uploadedTrail(gl);
    expect(newCycle).toHaveLength(18);
    const uploads = gl.operations.filter(([operation]) => operation === 'bufferSubData');
    expect(Array.from(uploads.at(-2)![3] as Float32Array)).toEqual(oldCycle);
    controller.setFraming({ fit: 'stretch', padding: 0 });
    expect(uploadedTrail(gl)).toEqual(newCycle);
    loss(canvas, gl); restore(canvas, gl);
    expect(uploadedTrail(gl)).toEqual(newCycle);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
  });

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
});

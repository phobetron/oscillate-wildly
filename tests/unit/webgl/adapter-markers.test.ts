import { PAINT_VERTEX_COMPONENTS, paintStrip, MARKER_SLOT_FLOATS, markerRadius, markerVisibilityDepth } from './geometry';
import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../../src/webgl';
import type { WebGLFrame } from '../../../src/webgl';
import { createEllipseMotion } from '../../../src/motions/ellipse';

import { fakeGL, Platform, Canvas, source, camera, loss, restore, uploadedTrail } from './fixtures';

describe('WebGL markers', () => {
  it.each([['trail', false], ['paint', true]] as const)('keeps a closed ellipse connected across its period boundary (%s)', (_name, paint) => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), createEllipseMotion({ periodSeconds: 0.18 }), {
      platform, ...(paint ? { paint: true, marker: { radius: 2 } } : { trail: { maxSamples: 12 }, marker: () => null }),
    });
    platform.fire(0);
    for (let time = 40; time <= 200; time += 40) platform.fire(time);
    if (paint) {
      const bridge = paintStrip(gl.uploadedBuffer(), 5);
      expect(new Set(bridge.filter((_, index) => index % PAINT_VERTEX_COMPONENTS === 0)).size).toBeGreaterThan(1);
    } else expect(uploadedTrail(gl)).toHaveLength(90); // Five strips include the continuous period crossing.
    controller.dispose();
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

  it('maps marker scale into appearance and GPU radius without changing geometry or playback', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const frames: WebGLFrame<number>[] = [];
    let resets = 0;
    const controller = animateWebGL(new Canvas(gl.value).asElement(), {
      ...source(), reset: () => { resets++; },
    }, {
      platform, visibilityDepth: 0.2, markerScale: { depthStrength: 2, maxMarkerScale: 2.5 },
      marker: (frame) => { frames.push(frame); return { radius: 7 }; },
    });
    const radius = () => gl.operations.filter(([name, uniform]) => name === 'uniform2f' && uniform === 'radius').at(-1)?.slice(2);
    expect(frames.at(-1)!.pose.depth).toBe(2.5);
    expect(frames.at(-1)!.position.depth).toBe(2.5);
    expect(radius()).toEqual([0.175, 0.35]);
    platform.fire(0); platform.fire(100);
    const before = frames.at(-1)!;
    const pending = [...platform.callbacks.keys()];
    controller.setMarkerScale({ depthStrength: 0 });
    expect(controller.isPaused()).toBe(false);
    expect([...platform.callbacks.keys()]).toEqual(pending);
    expect(frames.at(-1)!.elapsedSeconds).toBe(before.elapsedSeconds);
    expect(frames.at(-1)!.state).toBe(before.state);
    expect(frames.at(-1)!.position.x).toBe(before.position.x);
    expect(frames.at(-1)!.position.visibilityDepth).toBe(0.2);
    expect(frames.at(-1)!.pose.depth).toBe(1);
    expect(radius()).toEqual([0.07, 0.14]);
    controller.pause();
    controller.setMarkerScale({ depthStrength: 0, minMarkerScale: 1.5 });
    expect(controller.isPaused()).toBe(true);
    expect(platform.callbacks.size).toBe(0);
    expect(frames.at(-1)!.elapsedSeconds).toBe(before.elapsedSeconds);
    expect(radius()).toEqual([0.105, 0.21]);
    controller.setMarkerScale({});
    expect(frames.at(-1)!.pose.depth).toBe(2);
    expect(radius()).toEqual([0.14, 0.28]);
    expect(resets).toBe(0);
    controller.dispose();
  });

  it('rejects invalid live scale settings while preserving the last rendered frame and scheduling', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const frames: WebGLFrame<number>[] = [];
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform, markerScale: { depthStrength: 0 },
      marker: (frame) => { frames.push(frame); return {}; },
    });
    platform.fire(0); platform.fire(100);
    const latest = frames.at(-1);
    const pending = [...platform.callbacks.keys()];
    const operations = gl.operations.length;
    for (const options of [{ depthStrength: -1 }, { minMarkerScale: NaN }, { maxMarkerScale: Infinity },
      { minMarkerScale: 2, maxMarkerScale: 1 }]) {
      expect(() => controller.setMarkerScale(options)).toThrow(RangeError);
      expect(frames.at(-1)).toBe(latest);
      expect(gl.operations.length).toBe(operations);
      expect([...platform.callbacks.keys()]).toEqual(pending);
      expect(controller.isPaused()).toBe(false);
    }
    platform.fire(200);
    expect(frames.at(-1)!.pose.depth).toBe(1);
    expect(frames.at(-1)!.elapsedSeconds).toBeGreaterThan(latest!.elapsedSeconds);
    controller.dispose();
  });

  it('replaces only the newest accumulated size on a same-time scale change', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform, accumulate: { maxSamples: 4 }, marker: { radius: 5 },
    });
    platform.fire(0); platform.fire(100); platform.fire(200);
    controller.pause();
    // Each marker has six vertices of XYZ, local XY, RGB, shape, radius, and visibility depth.
    const before = gl.uploadedBuffer();
    expect([0, 1, 2].map((slot) => markerRadius(before, slot))).toEqual([10, 10, 10]);
    const allocations = gl.count('bufferData');
    controller.setMarkerScale({ depthStrength: 0 });
    const after = gl.uploadedBuffer();
    expect(after).toHaveLength(before.length);
    expect(after.slice(0, 2 * MARKER_SLOT_FLOATS)).toEqual(before.slice(0, 2 * MARKER_SLOT_FLOATS));
    expect([0, 1, 2].map((slot) => markerRadius(after, slot))).toEqual([10, 10, 5]);
    expect(after[2 * MARKER_SLOT_FLOATS]).toBe(before[2 * MARKER_SLOT_FLOATS]);
    expect(markerVisibilityDepth(after, 2)).toBe(markerVisibilityDepth(before, 2));
    expect(gl.operations.filter(([name]) => name === 'drawArrays').at(-2)?.[3]).toBe(18);
    controller.setMarkerScale({ depthStrength: 0 });
    expect(gl.uploadedBuffer()).toEqual(after);
    expect(gl.count('bufferData')).toBe(allocations);
    controller.resume();
    platform.fire(300); platform.fire(400);
    expect(markerRadius(gl.uploadedBuffer(), 3)).toBe(5);
    controller.dispose();
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
      for (const depthStrength of [0, 10]) {
        const gl = fakeGL();
        const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
          autoplay: false, platform: new Platform(), visibilityDepth: depth, markerScale: { depthStrength },
        });
        expect(gl.count('drawArrays')).toBe(1);
        controller.dispose();
      }
    }
  });
});

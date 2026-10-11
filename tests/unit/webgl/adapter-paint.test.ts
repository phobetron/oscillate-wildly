import { PAINT_CAP_OFFSET, PAINT_SLOT_FLOATS, PAINT_VERTEX_COMPONENTS, NORMAL_SLOT_FLOATS, paintStrip } from './geometry';
import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../../src/webgl';
import { createHelixMotion, type HelixState } from '../../../src/motions/helix';

import { fakeGL, Platform, Canvas, source, camera, loss, restore, uploadedTrail } from './fixtures';

describe('WebGL paint', () => {
  it.each([
    ['planar pause at limit', 'pause', false],
    ['spatial pause at limit', 'pause', true],
    ['planar trim oldest', 'trim-oldest', false],
    ['spatial trim oldest', 'trim-oldest', true],
  ] as const)('starts a separate Helix paint stroke at each wrap while retaining earlier deposits (%s)', (_name, limitBehavior, spatial) => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    const controller = animateWebGL(canvas.asElement(), createHelixMotion({ periodSeconds: 0.18, turns: 1 }), {
      platform, paint: { maxSamples: 12, limitBehavior }, marker: { radius: 2 },
      ...(spatial ? { camera, position: ({ state }: { state: HelixState }) => ({ x: state.x, y: state.y, z: state.z }) } : {}),
    });
    platform.fire(0);
    for (let time = 40; time <= 160; time += 40) platform.fire(time);
    const oldCycle = gl.uploadedBuffer().slice(0, 5 * PAINT_SLOT_FLOATS);
    platform.fire(200);
    const atWrap = gl.uploadedBuffer();
    expect(atWrap.slice(0, 5 * PAINT_SLOT_FLOATS)).toEqual(oldCycle);
    const strip = paintStrip(atWrap, 5);
    const xyz = [0, 1, 2].map((axis) => strip.filter((_, index) => index % PAINT_VERTEX_COMPONENTS === axis));
    for (const channel of xyz) expect(new Set(channel).size).toBe(1); // A dab, without a bridge to the old endpoint.
    platform.fire(240);
    controller.pause();
    const after = gl.uploadedBuffer();
    const nextStrip = paintStrip(after, 6);
    expect(new Set(nextStrip.filter((_, index) => index % PAINT_VERTEX_COMPONENTS === 0)).size).toBeGreaterThan(1);
    controller.setFraming({ fit: 'stretch' });
    expect(gl.uploadedBuffer()).toEqual(after);
    loss(canvas, gl); restore(canvas, gl);
    expect(gl.uploadedBuffer()).toEqual(after);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
  });

  it('preserves deposited paint sizes and uses the new scale for future footprints', () => {
    const gl = fakeGL();
    const platform = new Platform();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      platform, camera, paint: { maxSamples: 8 }, marker: { radius: 5 },
    });
    platform.fire(0); platform.fire(100); platform.fire(200);
    controller.pause();
    const before = gl.uploadedBuffer();
    const uploads = gl.count('bufferSubData');
    controller.setMarkerScale({ depthStrength: 0 });
    expect(gl.uploadedBuffer()).toEqual(before);
    expect(gl.count('bufferSubData')).toBe(uploads);
    controller.resume();
    platform.fire(300); platform.fire(400);
    const after = gl.uploadedBuffer();
    expect(after.slice(0, PAINT_SLOT_FLOATS)).toEqual(before.slice(0, PAINT_SLOT_FLOATS));
    const footprintHeight = (slot: number) => {
      const ys = after.slice(slot * PAINT_SLOT_FLOATS + PAINT_CAP_OFFSET, (slot + 1) * PAINT_SLOT_FLOATS).filter((_, index) => index % PAINT_VERTEX_COMPONENTS === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(footprintHeight(0)).toBeCloseTo(0.4);
    expect(footprintHeight(3)).toBeCloseTo(0.2);
    controller.dispose();
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
    const ys = Array.from(positions).filter((_, index) => index % PAINT_VERTEX_COMPONENTS === 1);
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
      expect(uploads.reduce((sum, upload) => sum + (upload[3] as Float32Array).length, 0)).toBeLessThanOrEqual(4 * (PAINT_SLOT_FLOATS + NORMAL_SLOT_FLOATS));
    }
    expect(gl.count('bufferData')).toBe(allocations);
    const stored = gl.uploadedBuffer();
    expect(stored).toHaveLength(5 * PAINT_SLOT_FLOATS);
    // Connector slot XYZ begins at the prior point: no evicted point remains in geometry.
    const xs = stored.filter((_, index) => index % PAINT_VERTEX_COMPONENTS === 0);
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
    expect(gl.uploadedBuffer()).toHaveLength(PAINT_SLOT_FLOATS);
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
    expect(footprints[PAINT_CAP_OFFSET + 8]).toBe(1); // Captured circular starting cap.
    expect(footprints[PAINT_SLOT_FLOATS + PAINT_CAP_OFFSET + 6]).toBe(0); // Intermediate cap is collapsed.
    expect(footprints[216 + PAINT_CAP_OFFSET + 6]).toBe(-1); // Leading cap is still present.
    expect(footprints[216 + PAINT_CAP_OFFSET + 8]).toBe(0); // Newly selected square brush.
    controller.dispose();
  });
});

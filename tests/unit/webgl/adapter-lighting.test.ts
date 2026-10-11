import { describe, expect, it } from '@rstest/core';
import { animateWebGL } from '../../../src/webgl';
import type { WebGLLightingOptions } from '../../../src/webgl';

import { fakeGL, Platform, Canvas, source, camera, loss, restore, lastUniform } from './fixtures';

describe('WebGL lighting', () => {
  it.each([
    ['accumulated markers', { accumulate: true }],
    ['paint', { paint: true }],
    ['trimming paint', { paint: { maxSamples: 3, limitBehavior: 'trim-oldest' } }],
    ['trail', { trail: true }],
    ['current marker', {}],
  ] as const)('toggles lighting on retained drawing while paused without changing samples, colors, size, or GPU buffers (%s)', (_name, mode) => {
    const gl = fakeGL();
    const platform = new Platform();
    const canvas = new Canvas(gl.value);
    let time = 0;
    let samples = 0;
    let colors = 0;
    let positions = 0;
    const motion = source();
    const controller = animateWebGL(canvas.asElement(), { ...motion, sample(time) { samples++; return motion.sample(time); } }, {
      platform, camera, ...mode,
      position: ({ state }) => { positions++; return { x: state + positions / 10, y: 0, z: 0 }; },
      marker(frame) { colors++; time = frame.elapsedSeconds; return { radius: 7, color: [colors % 2 ? 0.2 : 0.3, 0.5, 0.8] }; },
    });
    platform.fire(0); platform.fire(100); controller.pause();
    const elapsed = time;
    const sampling = [samples, colors, positions];
    const programs = gl.count('createProgram');
    const uploads = gl.count('bufferSubData');
    const allocations = gl.count('bufferData');
    const geometry = gl.uploadedBuffer();
    controller.setLighting({ ambient: { color: [0.1, 0.5, 1], intensity: 0.2 }, directional: { intensity: 0 }, depthCue: { strength: 0 } });
    expect(gl.operations).toContainEqual(['uniform1i', 'lightingEnabled', 1]);
    expect(gl.count('createProgram')).toBe(programs);
    expect(time).toBe(elapsed);
    expect([samples, colors, positions]).toEqual(sampling);
    expect(gl.count('bufferSubData')).toBe(uploads);
    expect(gl.count('bufferData')).toBe(allocations);
    expect(gl.uploadedBuffer()).toEqual(geometry);
    expect(controller.isPaused()).toBe(true);
    controller.setLighting(false);
    expect(gl.operations).toContainEqual(['uniform1i', 'lightingEnabled', 0]);
    loss(canvas, gl);
    controller.setLighting({ ambient: { intensity: 0.5 } });
    restore(canvas, gl);
    expect([samples, colors, positions]).toEqual(sampling);
    expect(gl.uploadedBuffer()).toEqual(geometry);
    expect(controller.isPaused()).toBe(true);
    controller.clear();
    const drawsAfterClear = gl.count('drawArrays');
    controller.setLighting({});
    expect(gl.count('drawArrays')).toBe(drawsAfterClear);
    expect([samples, colors, positions]).toEqual(sampling);
    controller.dispose();
  });

  it.each([
    ['accumulated markers', { accumulate: true }],
    ['paint', { paint: true }],
    ['trail', { trail: true }],
    ['current marker', {}],
  ] as const)('keeps the last valid drawing usable for lighting after a paused framing update fails (%s)', (_name, mode) => {
    const gl = fakeGL();
    let appearances = 0;
    let positions = 0;
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      autoplay: false, platform: new Platform(), ...mode,
      marker: () => { appearances++; return { color: [0.2, 0.5, 0.8] }; },
      position: ({ state }) => { positions++; return { x: state, y: 0, z: 0 }; },
    });
    const geometry = gl.uploadedBuffer();
    expect(() => controller.setFraming({ zoom: Number.MIN_VALUE })).toThrow(RangeError);
    const sampling = [appearances, positions];
    const uploads = gl.count('bufferSubData');
    const allocations = gl.count('bufferData');
    expect(() => controller.setLighting({ ambient: { intensity: 0.4 } })).not.toThrow();
    expect(() => controller.setLighting(true)).not.toThrow();
    expect([appearances, positions]).toEqual(sampling);
    expect(gl.uploadedBuffer()).toEqual(geometry);
    expect(gl.count('bufferSubData')).toBe(uploads);
    expect(gl.count('bufferData')).toBe(allocations);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
  });

  it.each([['omitted', undefined], ['disabled', false], ['enabled', true], ['default options', {}]] as const)('resolves disabled lighting, empty options, and legacy boolean defaults through the public API (%s)', (_name, lighting) => {
    const gl = fakeGL();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      autoplay: false, platform: new Platform(), lighting,
    });
    expect(lastUniform(gl, 'lightingEnabled')).toEqual([lighting === undefined || lighting === false ? 0 : 1]);
    if (lighting !== undefined && lighting !== false) {
      expect(lastUniform(gl, 'lightingAmbientColor')).toEqual([1, 1, 1]);
      expect(lastUniform(gl, 'lightingAmbientIntensity')).toEqual([0.3]);
      expect(lastUniform(gl, 'lightingDirectionalColor')).toEqual([1, 1, 1]);
      expect(lastUniform(gl, 'lightingDirectionalIntensity')).toEqual([0.7]);
      expect(lastUniform(gl, 'lightingSpecularIntensity')).toEqual([0.12]);
      expect(lastUniform(gl, 'lightingShininess')).toEqual([24]);
      expect(lastUniform(gl, 'lightingDepthCueStrength')).toEqual([0.3]);
      const direction = lastUniform(gl, 'lightingDirection') as number[];
      const length = Math.hypot(-0.45, 0.65, 1);
      [-0.45, 0.65, 1].forEach((component, index) => expect(direction[index]).toBeCloseTo(component / length));
    }
    controller.dispose();
  });

  it('snapshots nested lighting options and replaces omitted fields with defaults', () => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const color: [number, number, number] = [0.2, 0.4, 0.6];
    const direction: [number, number, number] = [1, 0, 0];
    const lighting = { ambient: { color, intensity: 0.8 }, directional: { direction, intensity: 2 },
      specular: { intensity: 0.5, shininess: 8 }, depthCue: { strength: 0 } } satisfies WebGLLightingOptions;
    const controller = animateWebGL(canvas.asElement(), source(), {
      autoplay: false, platform: new Platform(), lighting,
    });
    color[0] = 1; direction[0] = 0; direction[1] = 1; lighting.ambient.intensity = 3;
    controller.setFraming({ fit: 'stretch' });
    expect(lastUniform(gl, 'lightingAmbientColor')).toEqual([0.2, 0.4, 0.6]);
    expect(lastUniform(gl, 'lightingAmbientIntensity')).toEqual([0.8]);
    expect(lastUniform(gl, 'lightingDirection')).toEqual([1, 0, 0]);
    controller.setLighting(lighting);
    color[1] = 1; direction[1] = 0; direction[2] = 1;
    loss(canvas, gl); restore(canvas, gl);
    expect(lastUniform(gl, 'lightingAmbientColor')).toEqual([1, 0.4, 0.6]);
    expect(lastUniform(gl, 'lightingDirection')).toEqual([0, 1, 0]);
    controller.setLighting({ ambient: { intensity: 0 } });
    expect(lastUniform(gl, 'lightingAmbientColor')).toEqual([1, 1, 1]);
    expect(lastUniform(gl, 'lightingDirectionalIntensity')).toEqual([0.7]);
    expect(lastUniform(gl, 'lightingSpecularIntensity')).toEqual([0.12]);
    expect(lastUniform(gl, 'lightingShininess')).toEqual([24]);
    expect(lastUniform(gl, 'lightingDepthCueStrength')).toEqual([0.3]);
    controller.dispose();
  });

  it.each([
    ['null options', null, TypeError],
    ['numeric options', 1, TypeError],
    ['string options', 'yes', TypeError],
    ['array options', [], TypeError],
    ['null ambient', { ambient: null }, TypeError],
    ['array directional', { directional: [] }, TypeError],
    ['boolean specular', { specular: false }, TypeError],
    ['numeric depth cue', { depthCue: 1 }, TypeError],
    ['unknown direction space', { directional: { space: 'local' } }, TypeError],
    ['short ambient color', { ambient: { color: [1, 1] } }, TypeError],
    ['short direction', { directional: { direction: [1, 0] } }, TypeError],
    ['boolean direction component', { directional: { direction: [true, 0, 0] } }, TypeError],
    ['string color component', { ambient: { color: [1, '0', 0] } }, TypeError],
    ['null direction space', { directional: { space: null } }, TypeError],
    ['string intensity', { ambient: { intensity: '1' } }, TypeError],
    ['null shininess', { specular: { shininess: null } }, TypeError],
    ['boolean depth cue', { depthCue: { strength: false } }, TypeError],
    ['overflow ambient', { ambient: { intensity: Number.MAX_VALUE } }, RangeError],
    ['overflow directional', { directional: { intensity: Number.MAX_VALUE } }, RangeError],
    ['combined intensity overflow', { specular: { intensity: 4096 }, directional: { intensity: 4096 } }, RangeError],
    ['subnormal shininess', { specular: { shininess: Number.MIN_VALUE } }, RangeError],
    ['overflow shininess', { specular: { shininess: Number.MAX_VALUE } }, RangeError],
    ['negative ambient', { ambient: { intensity: -1 } }, RangeError],
    ['infinite directional', { directional: { intensity: Infinity } }, RangeError],
    ['NaN specular', { specular: { intensity: NaN } }, RangeError],
    ['zero shininess', { specular: { shininess: 0 } }, RangeError],
    ['depth cue above one', { depthCue: { strength: 1.01 } }, RangeError],
    ['negative depth cue', { depthCue: { strength: -0.1 } }, RangeError],
    ['negative color component', { ambient: { color: [1, -0.1, 0] } }, RangeError],
    ['infinite color component', { directional: { color: [0, 0, Infinity] } }, RangeError],
    ['zero direction', { directional: { direction: [0, 0, 0] } }, RangeError],
    ['NaN direction', { directional: { direction: [NaN, 0, 1] } }, RangeError],
  ])('rejects malformed and out-of-range lighting atomically (%s)', (_name, value, error) => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    expect(() => animateWebGL(canvas.asElement(), source(), {
      platform: new Platform(), lighting: value as WebGLLightingOptions,
    })).toThrow(error);
    expect(gl.count('createProgram')).toBe(0);
    const controller = animateWebGL(canvas.asElement(), source(), {
      autoplay: false, platform: new Platform(), lighting: { ambient: { intensity: 0.9 } },
    });
    const operations = gl.operations.length;
    expect(() => controller.setLighting(value as WebGLLightingOptions)).toThrow(error);
    expect(gl.operations.length).toBe(operations);
    controller.setFraming({ fit: 'stretch' });
    expect(lastUniform(gl, 'lightingAmbientIntensity')).toEqual([0.9]);
    expect(controller.isPaused()).toBe(true);
    controller.dispose();
  });

  it.each([
    ['maximum scalars', { ambient: { intensity: 4096 }, directional: { intensity: 0.7 }, specular: { intensity: 4096, shininess: 16384 }, depthCue: { strength: 1 } }],
    ['minimum scalars', { ambient: { intensity: 0 }, directional: { intensity: 0 }, specular: { intensity: 0, shininess: 1 / 16384 }, depthCue: { strength: 0 } }],
  ] as const)('accepts portable GPU scalar boundaries (%s)', (_name, lighting) => {
    const gl = fakeGL();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      autoplay: false, platform: new Platform(), lighting,
    });
    expect(lastUniform(gl, 'lightingAmbientIntensity')).toEqual([lighting.ambient.intensity]);
    expect(lastUniform(gl, 'lightingDirectionalIntensity')).toEqual([lighting.directional.intensity]);
    expect(lastUniform(gl, 'lightingSpecularIntensity')).toEqual([lighting.specular.intensity]);
    expect(lastUniform(gl, 'lightingShininess')).toEqual([lighting.specular.shininess]);
    expect(lastUniform(gl, 'lightingDepthCueStrength')).toEqual([lighting.depthCue.strength]);
    controller.dispose();
  });

  it.each([['largest finite number', Number.MAX_VALUE], ['smallest positive number', Number.MIN_VALUE]] as const)('normalizes finite extreme directions without overflow or underflow (%s)', (_name, magnitude) => {
    const gl = fakeGL();
    const controller = animateWebGL(new Canvas(gl.value).asElement(), source(), {
      autoplay: false, platform: new Platform(), lighting: { directional: { direction: [magnitude, magnitude, magnitude] } },
    });
    for (const component of lastUniform(gl, 'lightingDirection') as number[]) expect(component).toBeCloseTo(1 / Math.sqrt(3));
    controller.dispose();
  });

  it('rotates world directions with the camera but ignores camera translation, framing, and viewport scale', () => {
    const gl = fakeGL();
    const canvas = new Canvas(gl.value);
    const platform = new Platform();
    const controller = animateWebGL(canvas.asElement(), source(), { autoplay: false, platform, camera,
      lighting: { directional: { direction: [0, 0, 1], space: 'world' } },
    });
    expect(lastUniform(gl, 'lightingDirection')).toEqual([0, 0, 1]);
    controller.setCamera({ ...camera, position: { x: 0, y: 0, z: 20 } });
    controller.setFraming({ fit: 'stretch', zoom: 2 });
    canvas.width = 800; platform.resize?.();
    expect(lastUniform(gl, 'lightingDirection')).toEqual([0, 0, 1]);
    controller.setCamera({ ...camera, position: { x: 0, y: 0, z: -10 } });
    expect(lastUniform(gl, 'lightingDirection')).toEqual([0, 0, -1]);
    controller.setCamera({ ...camera, position: { x: 10, y: 0, z: 0 } });
    [-1, 0, 0].forEach((component, index) => expect((lastUniform(gl, 'lightingDirection') as number[])[index]).toBeCloseTo(component));
    controller.setLighting({ directional: { direction: [0, 0, 1], space: 'view' } });
    expect(lastUniform(gl, 'lightingDirection')).toEqual([0, 0, 1]);
    controller.setCamera(undefined);
    controller.setLighting({ directional: { direction: [1, 2, 2], space: 'world' } });
    const direction = lastUniform(gl, 'lightingDirection') as number[];
    [1 / 3, -2 / 3, -2 / 3].forEach((component, index) => expect(direction[index]).toBeCloseTo(component));
    controller.dispose();
  });

  it.each([['derivatives available', true], ['depth-cue fallback', false]] as const)('keeps lighting choices through context recovery and supports depth-cue fallback without derivatives (%s)', (_name, derivatives) => {
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
  });


});

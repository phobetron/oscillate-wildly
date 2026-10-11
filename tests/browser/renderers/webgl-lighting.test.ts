import { test } from '../fixtures';
import type { WebGLMarkerOptions } from '../../../src/webgl';
import { installWebGLHarness } from './webgl-fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures');
  await page.evaluate(installWebGLHarness);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.webglHarness?.disposeAll());
});

test('ambient and directional controls change GPU pixels', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const lightingCamera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const whiteMarker: WebGLMarkerOptions = { color: [1, 1, 1] as const };
    const configured = fixture([{ marker: whiteMarker }], { camera: lightingCamera, lighting: true });
    const legacyPixel = configured.rgba(50, 50);
    configured.controller.setLighting({});
    check(configured.rgba(50, 50).every((value, channel) => value === legacyPixel[channel]), 'Empty lighting options retain exact boolean-default pixels');
    configured.controller.setLighting({ ambient: { color: [1, 0.5, 0.25] as const, intensity: 0.25 },
      directional: { intensity: 0 }, specular: { intensity: 0 }, depthCue: { strength: 0 } });
    configured.pixel(50, 50, [64, 32, 16, 255], 'Ambient RGB and intensity control actual GPU output');
    let rejectedFraming = false;
    try {
      configured.controller.setFraming({ zoom: Number.MIN_VALUE });
    }
    catch (error) {
      rejectedFraming = error instanceof RangeError;
    }
    check(rejectedFraming, 'Subnormal framing zoom must be rejected');
    configured.controller.setLighting({ ambient: { color: [1, 0.5, 0.25], intensity: 0.25 },
      directional: { intensity: 0 }, specular: { intensity: 0 }, depthCue: { strength: 0 } });
    configured.pixel(50, 50, [64, 32, 16, 255], 'Rejected framing preserves the last valid GPU scene');
    configured.controller.setLighting({ ambient: { intensity: 0 },
      directional: { direction: [0, 0, 1] as const, color: [1, 0, 0] as const, intensity: 0.4 },
      specular: { intensity: 0 }, depthCue: { strength: 0 } });
    configured.pixel(50, 50, [102, 0, 0, 255], 'Directional color and intensity tint diffuse GPU shading');
    configured.controller.setLighting({ ambient: { intensity: 0 },
      directional: { direction: [0, 0, -1] as const, intensity: 1 }, depthCue: { strength: 0 } });
    configured.pixel(50, 50, [0, 0, 0, 255], 'Opposite light/view halfway vector remains finite and produces no highlight');
    configured.dispose();
  });
});

test('specular color intensity and shininess control highlights', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const lightingCamera = camera;
    const highlight = fixture([{ marker: { color: [0, 0, 0] as const } }], { camera: lightingCamera });
    const highlightOptions = { ambient: { intensity: 0 }, directional: { direction: [0, 0, 1] as const, color: [0, 1, 0] as const, intensity: 0.7 },
      specular: { intensity: 0.2, shininess: 16 }, depthCue: { strength: 0 } };
    highlight.controller.setLighting(highlightOptions);
    const fullHighlight = highlight.rgba(50, 50);
    check(fullHighlight[0] === 0 && fullHighlight[2] === 0 && fullHighlight[1] > 40, 'Specular highlight follows directional RGB on a black surface');
    highlight.controller.setLighting({ ...highlightOptions, directional: { ...highlightOptions.directional, intensity: 0.35 } });
    const halfHighlight = highlight.rgba(50, 50);
    check(Math.abs(fullHighlight[1] - 2 * halfHighlight[1]) <= 2, 'Specular highlight scales with directional intensity');
    highlight.controller.setLighting({ ...highlightOptions, directional: { ...highlightOptions.directional, intensity: 0 } });
    highlight.pixel(50, 50, [0, 0, 0, 255], 'Zero directional intensity removes specular light');
    const angledHighlight = { ...highlightOptions, directional: { ...highlightOptions.directional, direction: [0.8, 0, 0.6] as const },
      specular: { intensity: 0.5, shininess: 1 } };
    highlight.controller.setLighting(angledHighlight);
    const broadHighlight = highlight.rgba(50, 50);
    highlight.controller.setLighting({ ...angledHighlight, specular: { intensity: 0.5, shininess: 64 } });
    check(broadHighlight[1] > highlight.rgba(50, 50)[1] + 50, 'Shininess concentrates specular highlights at fixed light direction');
    highlight.dispose();
  });
});

test('depth cue changes retained geometry brightness', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const lightingCamera = camera;
    const brightness = (pixel: readonly number[]) => pixel[0] + pixel[1] + pixel[2];
    const whiteMarker: WebGLMarkerOptions = { color: [1, 1, 1] as const };
    const depthSettings = { ambient: { intensity: 0.5 }, directional: { intensity: 0 }, depthCue: { strength: 0 } };
    const customDepth = fixture([{ pose: { x: -0.5, z: 2 }, marker: whiteMarker }, { pose: { x: 0.5, z: -2 }, marker: whiteMarker }], { camera: lightingCamera, lighting: depthSettings });
    customDepth.advance(1);
    customDepth.pixel(25, 50, [128, 128, 128, 255], 'Zero depth cue preserves near ambient lighting');
    customDepth.pixel(75, 50, [128, 128, 128, 255], 'Zero depth cue preserves far ambient lighting');
    customDepth.controller.setLighting({ ...depthSettings, depthCue: { strength: 0.8 } });
    check(brightness(customDepth.rgba(25, 50)) > brightness(customDepth.rgba(75, 50)) + 100, 'Custom depth strength darkens distant retained geometry');
    customDepth.dispose();
  });
});

test('world and view lights respond differently to camera rotation', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const lightingCamera = camera;
    const whiteMarker: WebGLMarkerOptions = { color: [1, 1, 1] as const };
    const anchored = fixture([{ marker: whiteMarker }], { camera: lightingCamera });
    const anchoredOptions = { ambient: { intensity: 0 }, directional: { direction: [0, 0, 1] as const, intensity: 0.5, space: 'world' as const },
      specular: { intensity: 0 }, depthCue: { strength: 0 } };
    anchored.controller.setLighting(anchoredOptions);
    anchored.pixel(50, 50, [128, 128, 128, 255], 'World light illuminates a camera-facing marker');
    anchored.controller.setCamera({ ...lightingCamera, position: { x: 0, y: 0, z: -5 } });
    anchored.pixel(50, 50, [0, 0, 0, 255], 'Orbiting rotates world lighting into view coordinates');
    anchored.controller.setLighting({ ...anchoredOptions, directional: { ...anchoredOptions.directional, space: 'view' } });
    anchored.pixel(50, 50, [128, 128, 128, 255], 'View light remains attached to the orbiting camera');
    anchored.dispose();
  });
});

for (const withoutDerivatives of [false, true]) {
  test(`paint joins interpolate lighting with and without shader derivatives (${withoutDerivatives ? 'fallback shader' : 'shader derivatives'})`, async ({ page }) => {
    await page.evaluate(async (withoutDerivatives) => {
      const { fixture, check } = window.webglHarness;
      const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
      const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      const lightingCamera = camera;
      for (const limitBehavior of ['pause', 'trim-oldest'] as const) {
        const smooth = fixture([
          { pose: { x: -0.8, z: 1 }, marker: { color: [0.2, 0.6, 1] as const, radius: 12 } },
          { pose: { x: 0, z: -1 }, marker: { color: [0.2, 0.6, 1] as const, radius: 12 } },
          { pose: { x: 0.8, z: 1 }, marker: { color: [0.2, 0.6, 1] as const, radius: 12 } },
        ], { camera: lightingCamera, accumulate: false, paint: { maxSamples: 3, limitBehavior }, lighting: true, withoutDerivatives });
        smooth.advance(1);
        smooth.advance(2);
        const row = Array.from({ length: 51 }, (_, index) => smooth.rgba(25 + index, 50));
        check(row.every((pixel) => pixel[3] === 255), 'Smooth ribbon keeps continuous coverage');
        const jumps = row.slice(1).map((pixel, index) => Math.max(...pixel.slice(0, 3).map((value, channel) => Math.abs(value - row[index][channel]))));
        check(Math.max(...jumps) <= 8, `Ribbon highlights interpolate through the segment join (${limitBehavior}, derivatives=${!withoutDerivatives}): ${Math.max(...jumps)}`);
        check(Math.max(...row.map((pixel) => pixel[2])) - Math.min(...row.map((pixel) => pixel[2])) > 15, 'Smooth ribbon retains orientation-based shading instead of flattening the light');
        smooth.dispose();
      }
    }, withoutDerivatives);
  });
}

for (const shape of ['circle', 'square'] as const) {
  test(`flat marker lighting preserves shape and follows camera depth (${shape})`, async ({ page }) => {
    await page.evaluate(async (shape) => {
      const { fixture, check } = window.webglHarness;
      const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
      const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      const lightingCamera = camera;
      const brightness = (pixel: readonly number[]) => pixel[0] + pixel[1] + pixel[2];
      for (const withoutDerivatives of [false, true]) {
        const depthLit = fixture([
          { pose: { x: -0.5, z: 2, depth: 0.75 }, marker: { shape, color: [0.6, 0.7, 0.9] as const } },
          { pose: { x: 0.5, z: -2, depth: 0.75 }, marker: { shape, color: [0.6, 0.7, 0.9] as const } },
        ], { camera: lightingCamera, withoutDerivatives });
        depthLit.advance(1);
        const flatNear = depthLit.rgba(25, 50);
        const flatFar = depthLit.rgba(75, 50);
        depthLit.controller.setLighting(true);
        const near = depthLit.rgba(25, 50);
        const far = depthLit.rgba(75, 50);
        check(brightness(near) > brightness(far), 'Lighting separates near and far retained markers');
        check(brightness(near) !== brightness(flatNear), 'Lighting changes rendered color');
        check(near[3] === 255 && far[3] === 255, 'Lighting preserves opaque marker coverage');
        check(depthLit.rgba(28, 50).every((value, index) => value === near[index]), 'Flat markers keep a plane normal, not a sphere gradient');
        depthLit.controller.setCamera({ ...lightingCamera, position: { x: 0, y: 0, z: -5 } });
        check(brightness(depthLit.rgba(25, 50)) > brightness(depthLit.rgba(75, 50)), 'Depth shading follows the current camera across retained history');
        depthLit.controller.setCamera(lightingCamera);
        depthLit.controller.setLighting(false);
        check(depthLit.rgba(25, 50).every((value, index) => value === flatNear[index]), 'Flat mode restores captured base RGB exactly');
        check(depthLit.rgba(75, 50).every((value, index) => value === flatFar[index]), 'Flat mode restores old samples too');
        depthLit.dispose();
      }
    }, shape);
  });
}

for (const [label, mode] of [['trail', { trail: { width: 8 } }], ['paint', { paint: true }]] as const) {
  test(`surface lighting survives backing scale zoom and context recovery (${label})`, async ({ page }) => {
    await page.evaluate(async (mode) => {
      const { fixture, lose, check } = window.webglHarness;
      const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
      const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      const lightingCamera = camera;
      const brightness = (pixel: readonly number[]) => pixel[0] + pixel[1] + pixel[2];
      const surface = fixture([
        { pose: { x: -0.8, z: 2 }, marker: { color: [0.2, 0.6, 1] as const } },
        { pose: { x: 0.8, z: -2 }, marker: { color: [0.2, 0.6, 1] as const } },
      ], { camera: lightingCamera, accumulate: false, ...mode });
      surface.advance(1);
      const flat = surface.rgba(50, 50);
      surface.controller.setLighting(true);
      const lit = surface.rgba(50, 50);
      check(lit[3] === flat[3] && lit[3] === 255, 'Surface lighting keeps the same ribbon/tail pixels');
      check(brightness(lit) !== brightness(flat), 'Surface lighting changes retained ribbon/tail shading');
      const near = surface.rgba(30, 50);
      const far = surface.rgba(70, 50);
      check(brightness(near) > brightness(far), 'Surface lighting includes the actual interpolated view depth');
      surface.canvas.width = surface.canvas.height = 200;
      surface.observers.resize!();
      check(surface.rgba(50, 50).every((value, index) => Math.abs(value - lit[index]) <= 1), 'Surface normals account for backing-pixel scale');
      surface.controller.setFraming({ fit: 'stretch', zoom: 2 });
      check(surface.rgba(50, 50).every((value, index) => Math.abs(value - lit[index]) <= 1), 'Zoom changes projection without changing physical surface lighting');
      surface.controller.setFraming({ fit: 'stretch' });
      const restoreSurface = await lose(surface);
      await restoreSurface();
      check(surface.rgba(50, 50).every((value, index) => Math.abs(value - lit[index]) <= 1), 'Context restoration retains lighting and geometry');
      surface.controller.setLighting(false);
      check(surface.rgba(50, 50).every((value, index) => Math.abs(value - flat[index]) <= 1), 'Flat surface base color survives lighting and recovery');
      surface.dispose();
    }, mode);
  });
}

for (const shape of ['circle', 'square'] as const) {
  test(`paint endpoints share their surface orientation and lighting (${shape})`, async ({ page }) => {
    await page.evaluate(async (shape) => {
      const { fixture, lose, check } = window.webglHarness;
      const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
      const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      const lightingCamera = camera;
      const joined = fixture([
        { pose: { x: -0.8, z: 2 }, marker: { shape, color: [0.2, 0.6, 1] as const } },
        { pose: { x: 0.8, z: -2 }, marker: { shape, color: [0.2, 0.6, 1] as const } },
      ], { camera: lightingCamera, accumulate: false, paint: true, lighting: true });
      joined.advance(1);
      const start = joined.rgba(8, 50);
      const startSurface = joined.rgba(22, 50);
      const end = joined.rgba(92, 50);
      const endSurface = joined.rgba(78, 50);
      check(start[3] === 255 && end[3] === 255, 'Aligned endpoint markers stay visible on their adjoining planes');
      check(start.every((value, index) => Math.abs(value - startSurface[index]) <= 3), 'Starting marker receives the same surface lighting as the ribbon');
      check(end.every((value, index) => Math.abs(value - endSurface[index]) <= 3), 'Leading marker receives the same surface lighting as the ribbon');
      const restoreJoined = await lose(joined);
      await restoreJoined();
      check(joined.rgba(92, 50).every((value, index) => value === end[index]), 'Recovery retains endpoint orientation and shading');
      joined.controller.setCamera({ ...lightingCamera, position: { x: 0, y: 0, z: -5 } });
      const reverseEnd = joined.rgba(8, 50);
      const reverseSurface = joined.rgba(22, 50);
      check(reverseEnd[3] === 255, 'Aligned endpoint remains attached when viewed from the opposite side');
      check(reverseEnd.every((value, index) => Math.abs(value - reverseSurface[index]) <= 3), 'Endpoint and ribbon shading stay consistent after camera rotation');
      joined.dispose();
    }, shape);
  });
}

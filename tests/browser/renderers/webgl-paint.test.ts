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

test('deposited circular paint retains its plane through rotation and recovery', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, lose } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const sheet = fixture([{ pose: { x: -0.5 }, marker: brush }, { pose: { x: 0.5 }, marker: brush }], {
      camera: ribbonCamera, accumulate: false, paint: true,
    });
    sheet.advance(1);
    sheet.pixel(50, 50, red, 'The marker paints continuously between samples');
    sheet.pixel(50, 57, red, 'Brush width follows marker diameter');
    sheet.pixel(50, 62, blank, 'Brush paint stays within the marker footprint');
    sheet.pixel(20, 50, red, 'The beginning of a circular brush stroke has a rounded cap');
    sheet.pixel(16, 59, blank, 'The starting cap discards corners instead of leaving a square end');
    sheet.pixel(83, 50, red, 'The stroke ends with the retained circular brush footprint');
    sheet.pixel(83, 59, blank, 'The end cap rounds off its corners');
    sheet.controller.setCamera(camera);
    sheet.pixel(50, 50, blank, 'Deposited paint rotates edge-on as fixed 3D geometry');
    sheet.pixel(75, 50, blank, 'The leading footprint turns edge-on instead of facing the camera like a sphere');
    sheet.pixel(25, 50, blank, 'The starting cap shares the retained paint plane');
    sheet.controller.setCamera(ribbonCamera);
    sheet.pixel(50, 57, red, 'Camera changes preserve the deposited stroke');
    const restoreSheet = await lose(sheet);
    await restoreSheet();
    sheet.pixel(50, 57, red, 'Context recovery reconstructs deposited paint');
    sheet.controller.clear();
    sheet.pixel(50, 50, blank, 'Clear discards deposited paint');
    sheet.dispose();
  });
});

test('a single dab consumes the paint budget and retains its plane', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const singleDab = fixture([{ pose: { x: 0.5 }, marker: brush }], {
      camera: ribbonCamera, accumulate: false, paint: { maxSamples: 1 },
    });
    singleDab.pixel(75, 50, red, 'A stationary brush leaves a flat initial dab');
    singleDab.pixel(83, 59, blank, 'The initial dab follows its circular footprint');
    check(singleDab.controller.isPaintFull() && singleDab.controller.isPaused(), 'Single-dab budget does not pause correctly');
    singleDab.controller.setCamera(camera);
    singleDab.pixel(75, 50, blank, 'An initial dab has a retained 3D plane');
    singleDab.dispose();
  });
});

test('pause limit preserves paint and prevents further motion', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const limitedPaint = fixture([
      { pose: { x: -0.8 }, marker: brush }, { pose: { x: -0.4 }, marker: brush },
      { pose: { x: 0.4 }, marker: brush }, { pose: { x: 0.8 }, marker: brush },
    ], { camera: ribbonCamera, accumulate: false, paint: { maxSamples: 3 } });
    limitedPaint.advance(1);
    limitedPaint.advance(2);
    limitedPaint.pixel(15, 50, red, 'The beginning of a brush stroke never expires');
    limitedPaint.pixel(50, 50, red, 'The entire painted stroke is retained at the limit');
    check(limitedPaint.controller.isPaintFull() && limitedPaint.controller.isPaused(), 'Paint limit did not stop animation');
    const fullTime = limitedPaint.sampledTime;
    limitedPaint.advance(3);
    check(limitedPaint.sampledTime === fullTime, 'Full paint budget advanced motion');
    limitedPaint.pixel(80, 50, blank, 'Painting cannot overwrite earlier samples after the cap');
    limitedPaint.controller.clear();
    check(!limitedPaint.controller.isPaintFull(), 'Clear did not replenish the paint budget');
    limitedPaint.dispose();
  });
});

test('rolling paint trims old geometry and preserves its caps after recovery', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, lose, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const rollingPaint = fixture([
      { pose: { x: -0.8 }, marker: brush }, { pose: { x: -0.4 }, marker: brush },
      { pose: { x: 0 }, marker: brush }, { pose: { x: 0.4 }, marker: brush },
      { pose: { x: 0.8 }, marker: brush },
    ], { camera: ribbonCamera, accumulate: false, paint: { maxSamples: 3, limitBehavior: 'trim-oldest' as const } });
    rollingPaint.advance(1);
    rollingPaint.advance(2);
    rollingPaint.advance(3);
    rollingPaint.pixel(10, 50, blank, 'Rolling paint discards its evicted beginning');
    rollingPaint.pixel(24, 50, red, 'The new trailing endpoint has its rounded brush cap');
    rollingPaint.pixel(22, 59, blank, 'The new trailing endpoint discards circular cap corners');
    rollingPaint.pixel(50, 50, red, 'Rolling paint preserves its connected body after wrapping');
    rollingPaint.advance(4);
    rollingPaint.pixel(30, 50, blank, 'Each new sample trims from the tail end');
    rollingPaint.pixel(43, 50, red, 'The rounded trailing cap advances with the retained surface');
    rollingPaint.pixel(47, 57, red, 'Only the endpoint has a cap; retained surface stays smooth');
    rollingPaint.pixel(80, 50, red, 'The latest paint survives multiple wraps');
    check(rollingPaint.controller.isPaintFull(), 'Rolling brush should report its filled retention budget');
    rollingPaint.controller.resume();
    check(!rollingPaint.controller.isPaused() && rollingPaint.scheduled === 1, 'A full rolling brush should resume');
    rollingPaint.controller.pause();
    const rollingFlat = rollingPaint.rgba(50, 50);
    rollingPaint.controller.setLighting(true);
    check(rollingPaint.rgba(50, 50)[3] === 255, 'Rolling tail caps retain lighting coverage');
    rollingPaint.controller.setLighting(false);
    check(rollingPaint.rgba(50, 50).every((value, channel) => value === rollingFlat[channel]), 'Lighting redraw does not age rolling paint');
    rollingPaint.controller.setCamera(camera);
    rollingPaint.pixel(50, 50, blank, 'Rolling caps keep their world-space orientation');
    rollingPaint.controller.setCamera(ribbonCamera);
    rollingPaint.pixel(43, 50, red, 'Camera round trip restores rolling paint');
    const restoreRolling = await lose(rollingPaint);
    await restoreRolling();
    rollingPaint.pixel(30, 50, blank, 'Context recovery does not resurrect evicted paint');
    rollingPaint.pixel(43, 50, red, 'Context recovery restores the rolling tail cap');
    rollingPaint.controller.clear();
    rollingPaint.pixel(80, 50, blank, 'Clear removes rolling paint');
    check(!rollingPaint.controller.isPaintFull(), 'Clear resets rolling capacity state');
    rollingPaint.dispose();
  });
});

test('rolling paint preserves gaps where the brush is lifted', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const rollingGap = fixture([
      { pose: { x: -0.8 }, marker: brush }, { pose: { x: -0.6 }, marker: brush },
      { pose: { x: 0 }, skip: true }, { pose: { x: 0.6 }, marker: brush },
      { pose: { x: 0.8 }, marker: brush },
    ], { camera: ribbonCamera, accumulate: false, paint: { maxSamples: 3, limitBehavior: 'trim-oldest' as const } });
    rollingGap.advance(1);
    rollingGap.advance(2);
    rollingGap.advance(3);
    rollingGap.advance(4);
    rollingGap.pixel(20, 50, red, 'Eviction into a gap preserves the isolated earlier endpoint');
    rollingGap.pixel(50, 50, blank, 'Rolling paint never bridges a lifted brush');
    rollingGap.pixel(85, 50, red, 'The later retained stroke remains connected');
    rollingGap.dispose();
  });
});

test('later brush styles do not alter earlier deposited paint', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const styledPaint = fixture([
      { pose: { x: -0.8 }, marker: { ...brush, color: [1, 0, 0] as const } },
      { pose: { x: -0.4 }, marker: { ...brush, color: [1, 0, 0] as const } },
      { pose: { x: 0.4 }, marker: { ...brush, radius: 20, color: [0, 1, 0] as const } },
    ], { camera: ribbonCamera, accumulate: false, paint: true });
    styledPaint.advance(1);
    styledPaint.advance(2);
    styledPaint.pixel(15, 50, red, 'Later brush colors do not recolor old paint');
    styledPaint.pixel(15, 65, blank, 'A larger brush does not widen old paint');
    styledPaint.pixel(65, 63, green, 'The deposited brush footprint retains its sampled shape and color');
    styledPaint.dispose();
  });
});

test('crossing paint covers earlier geometry in chronological order', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const brush: WebGLMarkerOptions = { shape: 'circle', radius: 10 };
    const crossingPaint = fixture([
      { pose: { x: 0, y: 0 }, marker: { ...brush, color: [1, 0, 0] as const } },
      { pose: { x: 0.6, y: 0 }, marker: { ...brush, color: [1, 0, 0] as const } },
      { pose: { x: 0.6, y: 0.6 }, marker: { ...brush, color: [0, 1, 0] as const } },
      { pose: { x: -0.6, y: -0.6 }, marker: { ...brush, color: [0, 1, 0] as const } },
    ], { camera, accumulate: false, paint: true });
    crossingPaint.advance(1);
    crossingPaint.advance(2);
    crossingPaint.advance(3);
    crossingPaint.pixel(50, 50, green, 'New crossing paint covers an older starting cap at equal depth');
    crossingPaint.dispose();
    const rollingCrossing = fixture([
      { pose: { x: -0.9, y: 0.9 } },
      { pose: { x: 0, y: 0 }, marker: { ...brush, color: [1, 0, 0] as const } },
      { pose: { x: 0.6, y: 0 }, marker: { ...brush, color: [1, 0, 0] as const } },
      { pose: { x: 0.6, y: 0.6 }, marker: { ...brush, color: [0, 1, 0] as const } },
      { pose: { x: -0.6, y: -0.6 }, marker: { ...brush, color: [0, 1, 0] as const } },
    ], { camera, accumulate: false, paint: { maxSamples: 4, limitBehavior: 'trim-oldest' as const } });
    for (let index = 1; index <= 4; index++)
      rollingCrossing.advance(index);
    rollingCrossing.pixel(50, 50, green, 'Wrapped paint draws in chronological order at equal depth');
    rollingCrossing.dispose();
    for (const z of [4.5, -5]) {
      const clipped = fixture([{ pose: { z } }], { camera });
      clipped.pixel(50, 50, blank, `Camera near/far clipping at z=${z}`);
      clipped.dispose();
    }
  });
});

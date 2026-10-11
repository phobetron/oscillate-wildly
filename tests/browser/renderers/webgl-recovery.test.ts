import { test, expect } from '../fixtures';
import type { WebGLMarkerOptions } from '../../../src/webgl';
import { installWebGLHarness } from './webgl-fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures');
  await page.evaluate(installWebGLHarness);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.webglHarness?.disposeAll());
});

for (const [label, mode] of [
  ['accumulated markers', { accumulate: true }],
  ['current marker', { accumulate: false }],
  ['trail', { accumulate: false, trail: { width: 8 } }],
  ['paint', { accumulate: false, paint: true }],
  ['rolling paint', { accumulate: false, paint: { maxSamples: 3, limitBehavior: 'trim-oldest' } }],
] as const) {
  test(`lighting updates survive context recovery (${label})`, async ({ page }) => {
    await page.evaluate(async (mode) => {
      const { fixture, lose, check } = window.webglHarness;
      const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
      const blank = [0, 0, 0, 0];
      const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      const lightingCamera = camera;
      const whiteMarker: WebGLMarkerOptions = { color: [1, 1, 1] as const };
      const retainedLight = fixture([{ pose: { x: -0.5 }, marker: whiteMarker }, { pose: { x: 0.5 }, marker: whiteMarker }], { camera: lightingCamera, ...mode });
      retainedLight.advance(1);
      const elapsed = retainedLight.sampledTime;
      const settings = { ambient: { color: [0.2, 0.6, 1] as const, intensity: 0.5 }, directional: { intensity: 0 }, depthCue: { strength: 0 } };
      retainedLight.controller.setLighting(settings);
      const beforeLoss = retainedLight.rgba(75, 50);
      retainedLight.pixel(75, 50, [26, 77, 128, 255], 'Structured lighting shades paused retained modes');
      const restoreRetainedLight = await lose(retainedLight);
      retainedLight.controller.setLighting({ ...settings, ambient: { color: [1, 0.4, 0.2] as const, intensity: 0.5 } });
      await restoreRetainedLight();
      retainedLight.pixel(75, 50, [128, 51, 26, 255], 'Lighting changes during context loss survive GPU recovery');
      retainedLight.controller.setLighting(settings);
      check(retainedLight.rgba(75, 50).every((value, channel) => value === beforeLoss[channel]), 'Recovery restores custom lighting on retained geometry');
      check(retainedLight.sampledTime === elapsed && retainedLight.controller.isPaused() && retainedLight.scheduled === 0, 'Structured lighting and recovery preserve paused motion');
      retainedLight.controller.clear();
      retainedLight.controller.setLighting(settings);
      retainedLight.pixel(75, 50, blank, 'Lighting cannot repopulate cleared retained geometry');
      retainedLight.dispose();
    }, mode);
  });
}

for (const accumulate of [false, true]) {
  test(`marker scale updates during context loss change restored coverage (accumulate=${accumulate})`, async ({ page }) => {
    await page.evaluate(async (accumulate) => {
      const { fixture, lose } = window.webglHarness;
      const blank = [0, 0, 0, 0];
      const whiteMarker: WebGLMarkerOptions = { color: [1, 1, 1] as const };
      const scaledRecovery = fixture([{ pose: { depth: 2 }, marker: whiteMarker }], { accumulate });
      scaledRecovery.pixel(65, 50, [255, 255, 255, 255], 'Initial marker uses its depth scale');
      const restoreScale = await lose(scaledRecovery);
      scaledRecovery.controller.setMarkerScale({ depthStrength: 0 });
      await restoreScale();
      scaledRecovery.pixel(65, 50, blank, 'Marker scale setter during loss updates restored footprint');
      scaledRecovery.pixel(55, 50, [255, 255, 255, 255], 'Updated marker footprint still draws its initial center');
      scaledRecovery.dispose();
    }, accumulate);
  });
}

test('running context recovery preserves elapsed motion and retained geometry', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, lose, check } = window.webglHarness;
    const red = [255, 0, 0, 255];
    const recovery = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0.5 } }], { offscreen: true });
    recovery.advance(1);
    const elapsed = recovery.sampledTime;
    const restore = await lose(recovery);
    recovery.controller.resume();
    await restore();
    recovery.pixel(25, 50, red, 'Restored context redraws accumulated history');
    recovery.pixel(75, 50, red, 'Restored context redraws current motion');
    check(!recovery.controller.isPaused() && recovery.scheduled === 1 && recovery.sampledTime === elapsed && recovery.resets === 0, 'Resume during context loss did not preserve current elapsed motion');
    recovery.step();
    check(recovery.sampledTime === elapsed, 'Restoration counted unavailable time as motion time');
    recovery.step();
    check(recovery.sampledTime > elapsed, 'Restored running context did not advance');
    recovery.controller.pause();
    recovery.dispose();
    check(Object.keys(recovery.observers).length === 0 && recovery.scheduled === 0, 'Disposal left browser observers or scheduled frames');
  });
});

test('clear and reset during loss determine the recovered scene', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, lose, check } = window.webglHarness;
    const blank = [0, 0, 0, 0];
    const retainedLight = fixture([
      { pose: { x: -0.5 }, marker: { color: [1, 1, 1] } },
      { pose: { x: 0.5 }, marker: { color: [1, 1, 1] } },
    ]);
    retainedLight.advance(1);
    retainedLight.controller.clear();
    const restoreClearedLight = await lose(retainedLight);
    retainedLight.controller.setLighting({});
    await restoreClearedLight();
    retainedLight.pixel(75, 50, blank, 'Context recovery cannot repopulate cleared geometry');
    const restoreResetLight = await lose(retainedLight);
    retainedLight.controller.reset();
    retainedLight.controller.setLighting(false);
    await restoreResetLight();
    retainedLight.pixel(25, 50, [255, 255, 255, 255], 'Reset during loss redraws the initial marker after clear');
    check(retainedLight.controller.isPaused() && retainedLight.scheduled === 0, 'Reset during loss retains manual pause');
    retainedLight.dispose();
  });
});

for (const preference of ['manual', 'intersection', 'visibility', 'reduced'] as const) {
  test(`context recovery respects ${preference} pause`, async ({ page }) => {
    const disposed = await page.evaluate(async (preference) => {
      const { fixture, lose, check } = window.webglHarness;
      const recovery = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0.5 } }], { offscreen: true });
      recovery.advance(1);
      const restore = await lose(recovery);
      recovery.controller.resume();
      if (preference === 'manual')
        recovery.controller.pause();
      else
        recovery.observers[preference]!(preference === 'reduced');
      const before = recovery.sampledTime;
      await restore();
      recovery.pixel(75, 50, [255, 0, 0, 255], `Recovery redraws while paused by ${preference}`);
      check(recovery.controller.isPaused() && recovery.scheduled === 0 && recovery.sampledTime === before, `Recovery overrode ${preference} pause preference`);
      recovery.dispose();
      return { observers: Object.keys(recovery.observers), scheduled: recovery.scheduled };
    }, preference);
    expect(disposed).toEqual({ observers: [], scheduled: 0 });
  });
}

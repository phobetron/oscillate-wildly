import assert from 'node:assert/strict';
import { test, expect } from '../fixtures';
import { webglControls } from './webgl.helpers';
import type { PixelSummary } from './webgl.helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.click('#pause');
  await expect(page.locator('#pause')).toHaveText('Resume');
});

for (const flow of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
  test(`Helix ${flow} input changes rendered screen progression`, async ({ page }) => {
    const { change, animate } = await webglControls(page);
    await change('#webgl-camera', 'front');
    await page.getByRole('combobox', { name: 'Flow direction', exact: true }).selectOption(flow);
    const first = await animate(0.4);
    const second = await animate(0.4);
    assert.ok(first.center && second.center, `${flow} paints its front view`);
    const horizontal = flow === 'left-to-right' || flow === 'right-to-left';
    const delta = second.center[horizontal ? 0 : 1] - first.center[horizontal ? 0 : 1];
    // readPixels uses bottom-to-top rows, opposite CSS screen Y.
    const positive = flow === 'left-to-right' || flow === 'bottom-to-top';
    assert.ok(positive ? delta > 1 : delta < -1, `${flow} front view progresses in the selected screen direction`);
  });
}

test('Helix rotation input mirrors the rendered depth size cue', async ({ page }) => {
  const { change, readout, animate } = await webglControls(page);
  await change('#webgl-camera', 'front');
  await page.getByRole('combobox', { name: 'Rotation direction', exact: true }).selectOption('counter-clockwise');
  await animate(0.4);
  const counterClockwiseSize = (await readout()).size;
  await page.getByRole('combobox', { name: 'Rotation direction', exact: true }).selectOption('clockwise');
  await animate(0.4);
  const clockwiseSize = (await readout()).size;
  assert.ok(counterClockwiseSize - clockwiseSize > 0.4, 'Reversed rotation mirrors the depth cue at the same early phase');
  assert.ok(Math.abs(counterClockwiseSize + clockwiseSize - 1.25) < 0.05, 'Opposite rotation cues mirror around the native .625 midpoint');
});

test('Duffing cylindrical projection remains continuous across forcing phase wrap', async ({ page }) => {
  const { change: webglChange, readout: webglReadout } = await webglControls(page);
  const bitmapWidth = await page.locator('#webgl-stage').evaluate((canvas: HTMLCanvasElement) => canvas.width);
  await webglChange('#motion', 'duffing');
  await webglChange('#webgl-view', 'spatial');
  await webglChange('#webgl-camera', 'front');

  await webglChange('#webgl-accumulate', false);
  await webglChange('#parameter-controls [data-parameter="angularFrequency"]', 10);
  await webglChange('#parameter-controls [data-parameter="timeScale"]', 2.4);
  assert.equal((await webglReadout()).time, 0);
  assert.equal((await webglReadout()).pause, 'Resume');
  await page.locator('#webgl-stage').scrollIntoViewIfNeeded();
  const phaseFrames = await page.evaluate(() => new Promise<(PixelSummary & { time: number })[]>((resolveFrames, reject) => {
    const output = document.querySelector<HTMLElement>('#webgl-time')!;
    const frames: (PixelSummary & { time: number })[] = [];
    const observer = new MutationObserver(() => {
      const time = Number(output.textContent);
      try {
        frames.push({ time, ...window.demoWebGLPixels() });
        if (time < 0.36) return;
        observer.disconnect();
        clearTimeout(timeout);
        document.querySelector<HTMLElement>('#pause')!.click();
        resolveFrames(frames);
      } catch (error) {
        observer.disconnect();
        clearTimeout(timeout);
        document.querySelector<HTMLElement>('#pause')!.click();
        reject(error);
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      document.querySelector<HTMLElement>('#pause')!.click();
      reject(new Error('Duffing example did not advance across its forcing phase wrap'));
    }, 5000);
    observer.observe(output, { childList: true, characterData: true, subtree: true });
    document.querySelector<HTMLElement>('#pause')!.click();
  }));
  const wrapTime = 2 * Math.PI / (10 * 2.4);
  const afterWrapIndex = phaseFrames.findIndex((frame) => frame.time >= wrapTime);
  assert.ok(afterWrapIndex > 0, 'Duffing renders samples before and after one complete forcing cycle');
  const beforeWrap = phaseFrames[afterWrapIndex - 1];
  const afterWrap = phaseFrames[afterWrapIndex];
  assert.ok(beforeWrap.count > 0 && afterWrap.count > 0, 'Duffing marker remains visible across the forcing phase wrap');
  const wrapDistance = Math.hypot(afterWrap.center![0] - beforeWrap.center![0], afterWrap.center![1] - beforeWrap.center![1]);
  const phaseStep = (afterWrap.time - beforeWrap.time) * 10 * 2.4;
  assert.ok(wrapDistance / bitmapWidth < 0.4 * phaseStep + 0.01, 'Duffing cylindrical view moves continuously across the forcing phase wrap');
  assert.equal((await webglReadout()).pause, 'Resume');
});

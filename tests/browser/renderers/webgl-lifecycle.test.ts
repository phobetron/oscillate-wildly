import { test } from '../fixtures';
import { installWebGLHarness } from './webgl-fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures');
  await page.evaluate(installWebGLHarness);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.webglHarness?.disposeAll());
});

for (const accumulate of [false, true]) {
  test(`clear preserves motion and reset returns to the initial sample (accumulate=${JSON.stringify(accumulate)})`, async ({ page }) => {
    await page.evaluate(async (accumulate) => {
      const { fixture, check } = window.webglHarness;
      const red = [255, 0, 0, 255];
      const blank = [0, 0, 0, 0];
      const target = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0.5 } }], { accumulate });
      target.advance(1);
      target.pixel(25, 50, accumulate ? red : blank, `Previous frame persistence with accumulate=${accumulate}`);
      target.pixel(75, 50, red, 'Current marker is painted');
      const elapsed = target.sampledTime;
      target.controller.clear();
      target.pixel(25, 50, blank, 'Clear removes old accumulated marker');
      target.pixel(75, 50, blank, 'Clear removes current marker');
      check(target.resets === 0 && target.sampledTime === elapsed && target.controller.isPaused(), 'Clear changed motion or pause state');
      target.controller.reset();
      target.pixel(25, 50, red, 'Reset paints the initial marker');
      target.pixel(75, 50, blank, 'Reset clears accumulated output');
      check(target.resets === 1 && target.sampledTime === 0, 'Reset did not reset the source and elapsed time');
      target.dispose();
    }, accumulate);
  });
}

test('paused bitmap and CSS resize redraw retained geometry', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const resized = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0.5 } }]);
    resized.advance(1);
    resized.canvas.width = 200;
    resized.canvas.height = 200;
    await Promise.resolve(); // Deliver bitmap attribute mutations while paused.
    resized.pixel(25, 50, red, 'Bitmap resize redraws accumulated history');
    resized.pixel(75, 50, red, 'Bitmap resize repaints current paused marker');
    resized.canvas.style.width = '200px';
    resized.observers.resize!();
    resized.pixel(75, 50, blank, 'CSS resize clears old projected marker');
    resized.pixel(150, 50, red, 'CSS resize reprojects current paused marker');
    resized.pixel(50, 50, red, 'CSS resize reprojects older accumulated markers');
    check(resized.canvas.width === 200 && resized.canvas.height === 200 && resized.controller.isPaused(), 'Resize changed bitmap ownership or pause state');
    resized.dispose();
  });
});

test('zero bitmap size suspends motion and recovery preserves pause intent', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const red = [255, 0, 0, 255];
    const runningResize = fixture([{}]);
    runningResize.controller.resume();
    runningResize.step();
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const before = runningResize.sampledTime;
      runningResize.canvas.width = runningResize.canvas.width;
      await Promise.resolve();
      runningResize.step();
      check(runningResize.sampledTime > before, 'Repeated bitmap assignments froze running motion');
      runningResize.pixel(50, 50, red, 'Running bitmap assignment preserves current marker');
    }
    const beforeZeroSize = runningResize.sampledTime;
    runningResize.canvas.width = 0;
    await Promise.resolve();
    check(runningResize.controller.isPaused() && runningResize.scheduled === 0, 'Zero-size bitmap did not suspend scheduling');
    runningResize.step();
    check(runningResize.sampledTime === beforeZeroSize, 'Zero-size bitmap advanced motion');
    runningResize.canvas.width = 100;
    await Promise.resolve();
    runningResize.pixel(50, 50, red, 'Restoring bitmap dimensions redraws current marker');
    check(!runningResize.controller.isPaused() && runningResize.scheduled === 1, 'Restoring bitmap dimensions did not reactivate running motion');
    runningResize.step();
    check(runningResize.sampledTime === beforeZeroSize, 'Bitmap reactivation counted suspended time');
    runningResize.step();
    check(runningResize.sampledTime > beforeZeroSize, 'Bitmap reactivation did not advance motion');
    runningResize.controller.pause();
    runningResize.canvas.height = 0;
    await Promise.resolve();
    runningResize.canvas.height = 100;
    await Promise.resolve();
    runningResize.pixel(50, 50, red, 'Paused zero-size recovery redraws current marker');
    check(runningResize.controller.isPaused() && runningResize.scheduled === 0 && runningResize.resets === 0, 'Zero-size recovery overrode manual pause or reset motion');
    runningResize.dispose();
  });
});

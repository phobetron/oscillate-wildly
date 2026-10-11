import { test } from '../fixtures';
import type { MotionSource } from '../../../src/core';
import type { FixtureSample } from './webgl-fixture';
import { installWebGLHarness } from './webgl-fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures');
  await page.evaluate(installWebGLHarness);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.webglHarness?.disposeAll());
});

for (const [label, drawing] of [
  ['trail', { trail: { maxSamples: 12, width: 6 } }],
  ['paint with pause limit', { paint: { maxSamples: 12, limitBehavior: 'pause' } }],
  ['rolling paint', { paint: { maxSamples: 12, limitBehavior: 'trim-oldest' } }],
] as const) {
  test(`helix cycle boundaries do not connect separate turns (${label})`, async ({ page }) => {
    await page.evaluate(async (drawing) => {
      const { fixture, createHelixMotion } = window.webglHarness;
      const red = [255, 0, 0, 255];
      const blank = [0, 0, 0, 0];
      const label = 'trail' in drawing ? 'Helix tail' : `Helix ${drawing.paint.limitBehavior} paint`;
      const helix = fixture([], { accumulate: false, ...drawing }, createHelixMotion({ periodSeconds: 0.18, turns: 1 }) as MotionSource<FixtureSample>);
      helix.controller.resume();
      helix.step(0);
      for (let frame = 0; frame < 4; frame++)
        helix.step(40);
      helix.pixel(57, 22, red, `${label} retains its first-cycle segment`);
      helix.step(40); // .16 -> .20 crosses the .18-second Helix wrap.
      helix.pixel(88, 50, blank, `${label} does not bridge the wrap at the right edge`);
      helix.pixel(57, 22, red, `${label} preserves the completed cycle`);
      helix.step(40);
      helix.controller.pause();
      helix.pixel(57, 78, red, `${label} draws the new cycle`);
      helix.controller.setFraming({ fit: 'stretch', padding: 0 });
      helix.pixel(88, 50, blank, `${label} stays disconnected on paused redraw`);
      helix.pixel(57, 22, red, `${label} keeps old geometry on paused redraw`);
      helix.dispose();
    }, drawing);
  });
}

test('bounded trails retain CSS width through resize and context recovery', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, lose } = window.webglHarness;
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const tail = fixture([
      { pose: { x: -0.8 }, skip: true }, { pose: { x: -0.4 }, skip: true },
      { pose: { x: 0.4, depth: 0.01 }, skip: true }, { pose: { x: 0.8 }, skip: true },
    ], { accumulate: false, trail: { maxSamples: 2, width: 6 } });
    tail.advance(1);
    tail.pixel(20, 50, red, 'Tail connects retained samples');
    tail.advance(2);
    tail.pixel(20, 50, blank, 'Expired tail segment disappears');
    tail.pixel(50, 52, red, 'Tail width uses CSS pixels independently of pose depth');
    tail.pixel(50, 55, blank, 'Tail width is bounded');
    tail.controller.setFraming({ fit: 'stretch' });
    tail.pixel(50, 50, red, 'Paused redraws do not age the tail');
    tail.advance(3);
    tail.pixel(50, 50, blank, 'Tail remains bounded after ring buffer wraps');
    tail.pixel(80, 50, red, 'Latest segment survives ring buffer wrap');
    tail.canvas.width = tail.canvas.height = 200;
    await Promise.resolve();
    tail.pixel(80, 52, red, 'Bitmap resize retains tail with CSS pixel width');
    tail.pixel(80, 55, blank, 'High-resolution bitmap preserves tail width');
    const restoreTail = await lose(tail);
    await restoreTail();
    tail.pixel(80, 50, red, 'Context restoration reprojects retained tail');
    tail.controller.clear();
    tail.pixel(80, 50, blank, 'Clear removes tail output');
    tail.controller.setFraming({ fit: 'stretch' });
    tail.pixel(80, 50, blank, 'Clear discards retained samples');
    tail.advance(1);
    tail.controller.reset();
    tail.pixel(50, 50, blank, 'Reset discards the tail and any old connector');
    tail.dispose();
  });
});

test('trail and marker depth occlusion follows camera distance', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const tailCamera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    for (const nearTail of [false, true]) {
      const lineZ = nearTail ? 2 : -2;
      const crossing = fixture([
        { pose: { x: -0.8, z: lineZ }, skip: true },
        { pose: { x: 0.8, z: lineZ }, skip: true },
        { pose: { x: 0, z: -lineZ }, marker: { color: [0, 1, 0] as const } },
      ], { accumulate: false, trail: { width: 6, color: [1, 0, 0] as const }, camera: tailCamera });
      crossing.advance(1);
      crossing.advance(2);
      crossing.pixel(50, 50, nearTail ? red : green, `Tail/marker hardware depth occlusion with nearTail=${nearTail}`);
      crossing.dispose();
    }
    const clippedTail = fixture([
      { pose: { x: -0.8, z: 6 }, skip: true },
      { pose: { x: 0.8, z: -6 }, skip: true },
    ], { accumulate: false, trail: { width: 4 }, camera: tailCamera });
    clippedTail.advance(1);
    clippedTail.pixel(15, 50, blank, 'Tail clips at the near plane');
    clippedTail.pixel(50, 50, red, 'Tail crossing both clipping planes retains the visible segment');
    clippedTail.pixel(85, 50, blank, 'Tail clips at the far plane');
    clippedTail.controller.setCamera({ ...tailCamera, position: { x: 0, y: 0, z: 8 } });
    clippedTail.pixel(15, 50, red, 'Camera update reprojects retained XYZ tail');
    clippedTail.pixel(65, 50, blank, 'Camera update recalculates clipping without old raster output');
    clippedTail.dispose();
  });
});

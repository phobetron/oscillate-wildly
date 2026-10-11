import { test } from '../fixtures';
import type { FixtureSample } from './webgl-fixture';
import { installWebGLHarness } from './webgl-fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures');
  await page.evaluate(installWebGLHarness);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.webglHarness?.disposeAll());
});

for (const nearFirst of [false, true]) {
  test(`planar depth occlusion is independent of draw order (nearFirst=${JSON.stringify(nearFirst)})`, async ({ page }) => {
    await page.evaluate(async (nearFirst) => {
      const { fixture } = window.webglHarness;
      const green = [0, 255, 0, 255];
      const near: FixtureSample = { visibilityDepth: 0.2, marker: { color: [0, 1, 0] as const } };
      const far = { visibilityDepth: 0.8 };
      const target = fixture(nearFirst ? [near, far] : [far, near]);
      target.advance(1);
      target.pixel(50, 50, green, `Near marker must win with nearFirst=${nearFirst}`);
      target.dispose();
    }, nearFirst);
  });
}

test('circle discard leaves farther square corners visible', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const corners = fixture([
      { visibilityDepth: 0.2, marker: { color: [0, 1, 0] as const } },
      { visibilityDepth: 0.8, marker: { shape: 'square' as const } },
    ]);
    corners.advance(1);
    corners.pixel(50, 50, green, 'Near circle occludes far square');
    corners.pixel(58, 58, red, 'Discarded circle corners must not occlude the far square');
    corners.dispose();
  });
});

test('opaque marker depth scales size and visibility depth clips output', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const opaque = fixture([{ pose: { opacity: 0, depth: 0.5 } }]);
    opaque.pixel(50, 50, red, 'Opaque marker ignores pose opacity');
    opaque.pixel(54, 50, red, 'Pose depth scales marker radius');
    opaque.pixel(57, 50, blank, 'Pose depth is size, not visibility depth');
    opaque.dispose();
    for (const visibilityDepth of [-0.1, 1.1]) {
      const clipped = fixture([{ visibilityDepth }]);
      clipped.pixel(50, 50, blank, `Planar clipping at depth ${visibilityDepth}`);
      clipped.dispose();
    }
  });
});

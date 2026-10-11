import { test } from '../fixtures';
import type { Pose } from '../../../src/core';
import type { WebGLMarkerOptions } from '../../../src/webgl';
import { installWebGLHarness } from './webgl-fixture';

test.beforeEach(async ({ page }) => {
  await page.goto('/fixtures');
  await page.evaluate(installWebGLHarness);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.webglHarness?.disposeAll());
});

test('camera projection selects coordinates and updates paused geometry', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture, check } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    for (const nearFirst of [false, true]) {
      const near = { pose: { z: 2 }, marker: { color: [0, 1, 0] as const } };
      const far = { pose: { z: -2 } };
      const target = fixture(nearFirst ? [near, far] : [far, near], { camera });
      target.advance(1);
      target.pixel(50, 50, green, `3D camera occlusion with nearFirst=${nearFirst}`);
      target.dispose();
    }
    const projected = fixture([{ pose: { x: -0.5, y: -0.5 }, point: { x: 0.5, y: 0.5, z: 0 } }], {
      camera, position: ({ state }) => state.point!,
    });
    projected.pixel(75, 25, red, 'Camera projects selected 3D coordinates');
    projected.pixel(25, 25, blank, 'Camera uses position callback instead of legacy pose');
    projected.controller.setCamera({ ...camera, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } });
    projected.pixel(75, 25, blank, 'Camera update moves retained geometry out of its old projection');
    projected.pixel(62, 37, red, 'Camera update reprojects current frame');
    check(projected.controller.isPaused() && projected.resets === 0 && projected.sampledTime === 0, 'Camera update changed motion or pause');
    projected.controller.setCamera(undefined);
    projected.pixel(75, 75, red, 'Removing camera restores planar projection');
    projected.pixel(62, 37, blank, 'Removing camera reprojects retained geometry');
    projected.dispose();
  });
});

test('camera rotation reverses retained marker occlusion', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const rotatingDepth = fixture([
      { pose: { x: -0.5, z: 2 } },
      { pose: { x: -0.5, z: -2 }, marker: { color: [0, 1, 0] as const } },
    ], { camera });
    rotatingDepth.advance(1);
    rotatingDepth.pixel(25, 50, red, 'Near retained marker occludes the far marker');
    rotatingDepth.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: -5 } });
    rotatingDepth.pixel(75, 50, green, 'Orbiting reverses occlusion using all retained world positions');
    rotatingDepth.pixel(25, 50, blank, 'Orbiting leaves no paint in the old projection');
    rotatingDepth.controller.setCamera(camera);
    rotatingDepth.pixel(25, 50, red, 'Returning to the camera restores the original occlusion');
    rotatingDepth.dispose();
  });
});

test('bounded marker history keeps sampled styles across camera rotation', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const styledSamples: {
      pose: Partial<Pose>;
      marker: {
        radius: number;
        shape?: WebGLMarkerOptions["shape"];
        color?: WebGLMarkerOptions["color"];
      };
    }[] = [
      { pose: { x: -0.5 }, marker: { radius: 5 } },
      { pose: { x: 0 }, marker: { radius: 10, shape: 'square', color: [0, 1, 0] as const } },
      { pose: { x: 0.5 }, marker: { radius: 5, color: [0, 0, 1] as const } },
      { pose: { x: -0.5 }, marker: { radius: 5, color: [1, 1, 0] as const } },
    ];
    const bounded = fixture(styledSamples, { camera, accumulate: { maxSamples: 3 } });
    bounded.advance(1);
    bounded.advance(2);
    bounded.advance(3);
    // Changing the latest appearance at the same time replaces its wrapped
    // slot. Earlier shapes/colors must remain the captured values.
    styledSamples[3].marker.radius = 2;
    styledSamples[3].marker.shape = 'square';
    styledSamples[3].marker.color = [1, 0, 1];
    bounded.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: -5 } });
    bounded.pixel(75, 50, [255, 0, 255, 255], 'Same-time replacement updates the latest wrapped slot');
    bounded.pixel(78, 50, blank, 'Replacement removes the old larger marker footprint');
    bounded.pixel(58, 58, green, 'Earlier square keeps its sampled shape and color');
    bounded.pixel(25, 50, [0, 0, 255, 255], 'Earlier circle keeps its sampled color');
    bounded.pixel(29, 54, blank, 'Earlier circle retains discarded corners');
    bounded.dispose();
  });
});

test('expired marker geometry cannot reappear after camera rotation', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const expired = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0 } }, { pose: { x: 0.5 } }], {
      camera, accumulate: { maxSamples: 2 },
    });
    expired.advance(1);
    expired.advance(2);
    expired.pixel(25, 50, blank, 'Oldest geometry expires at the sample cap');
    expired.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: -5 } });
    expired.pixel(75, 50, blank, 'Expired geometry cannot reappear after camera rotation');
    expired.pixel(25, 50, red, 'Latest geometry rotates after buffer wrap');
    expired.dispose();
  });
});

test('camera changes reveal retained geometry previously clipped', async ({ page }) => {
  await page.evaluate(async () => {
    const { fixture } = window.webglHarness;
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const blank = [0, 0, 0, 0];
    const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
    const retainedClip = fixture([{ pose: { x: -0.5, z: 4.5 } }, { pose: { x: 0.5 } }], { camera });
    retainedClip.advance(1);
    retainedClip.pixel(25, 50, blank, 'Near-clipped samples are initially hidden');
    retainedClip.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: 6 }, far: 10 });
    retainedClip.pixel(25, 50, red, 'Clipped retained geometry becomes visible in a new camera');
    retainedClip.dispose();
  });
});

import assert from 'node:assert/strict';
import { test, expect } from '../fixtures';
import { webglControls } from './webgl.helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Resume');
});

test('planar appearance, trails and accumulation redraw pixels while preserving pause and time', async ({ page }) => {
  const { change: webglChange, click: webglClick, readout: webglReadout, animate: animateWebGLFor } = await webglControls(page);
  await webglChange('#motion', 'ellipse');
  assert.equal(await page.locator('#show-trail').isDisabled(), false);
  assert.equal(await page.locator('#show-path').isDisabled(), true);
  assert.equal(await page.locator('#clear-drawing').isDisabled(), false);
  assert.equal(await page.locator('#webgl-camera').isDisabled(), true);
  assert.equal(await page.locator('#webgl-view option[value="spatial"]').evaluate((option: HTMLOptionElement) => option.disabled), true);
  await webglChange('#parameter-controls [data-parameter="periodSeconds"]', 1);
  await page.selectOption('#fit', 'contain');
  const circle = await webglChange('#marker-size', 24);
  assert.ok(circle.count > 0, 'Paused WebGL example must paint a marker');
  const pausedWebGL = await webglReadout();
  assert.equal(pausedWebGL.pause, 'Resume');
  const square = await webglChange('#webgl-shape', 'square');
  assert.ok(square.count > circle.count, 'Square marker must paint its corners');
  const redSquare = await webglChange('#marker-color', '#ff0000');
  assert.ok(redSquare.colors.includes('255,0,0'), 'Solid marker uses the selected color');
  assert.deepEqual(await webglReadout(), pausedWebGL, 'Appearance changes preserve paused elapsed motion');
  const singleFrame = await animateWebGLFor(0.2);
  assert.ok(singleFrame.count > 0, 'Planar example must animate and paint');
  assert.ok((await webglReadout()).time > pausedWebGL.time);
  assert.equal(await page.locator('#webgl-lighting').isDisabled(), true, 'Lighting control is available for the 3D view');
  await webglChange('#show-trail', true);
  assert.equal(await page.locator('#webgl-accumulate').isChecked(), false);
  assert.equal(await page.locator('#trail-length').isDisabled(), false);
  await webglChange('#trail-length', 16);
  const withTrail = await animateWebGLFor(0.25);
  const currentMarkerDiameter = 2 * 24 * (await webglReadout()).size;
  assert.ok(Math.max(...withTrail.size!) > currentMarkerDiameter + 2, 'WebGL Show trail extends beyond the current marker footprint');
  const beforeInvalidLength = await webglReadout();
  for (const length of [0, '', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await webglChange('#trail-length', length);
    assert.match((await page.locator('#status').textContent())!, /positive safe integer/, `Invalid tail length ${length} is rejected`);
    assert.deepEqual(await webglReadout(), beforeInvalidLength, 'Invalid length keeps the existing animation and manual pause');
  }
  await webglChange('#trail-length', 16);
  const beforeTrailClear = await webglReadout();
  assert.equal((await webglClick('#clear-drawing')).count, 0, 'Clear removes the WebGL tail and marker');
  assert.deepEqual(await webglReadout(), beforeTrailClear, 'Tail clear preserves motion time and manual pause');
  await webglChange('#webgl-accumulate', true);
  assert.equal(await page.locator('#show-trail').isChecked(), false);
  assert.equal(await page.locator('#trail-length').isDisabled(), true);
  assert.equal(await page.locator('#accumulation-length').isDisabled(), false);
  assert.equal(await page.locator('#accumulation-length').inputValue(), '12000');
  const beforeInvalidAccumulationLength = await webglReadout();
  for (const length of [0, '', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await webglChange('#accumulation-length', length);
    assert.match((await page.locator('#status').textContent())!, /positive safe integer/);
    assert.deepEqual(await webglReadout(), beforeInvalidAccumulationLength, 'Invalid accumulation length preserves the animation');
  }
  await webglChange('#accumulation-length', 12000);
  await webglClick('#reset');
  assert.equal((await webglReadout()).time, 0, 'Reset returns source elapsed time to zero');
  const accumulated = await animateWebGLFor(0.25);
  assert.ok(accumulated.count > singleFrame.count * 2, 'Accumulation retains earlier marker pixels');
  const beforeClear = await webglReadout();
  assert.equal((await webglClick('#clear-drawing')).count, 0, 'Clear removes the actual accumulated raster');
  assert.deepEqual(await webglReadout(), beforeClear, 'Clear preserves time, frame readout, and manual pause');
  assert.deepEqual(await webglReadout(), beforeClear, 'Clearing paused output must not restart animation');
  const resetRaster = await webglClick('#reset');
  assert.ok(resetRaster.count > 0 && resetRaster.count < accumulated.count, 'Reset discards accumulation and paints only the initial marker');
  assert.equal((await webglReadout()).time, 0);

});

test('spatial view and camera redraw preserve time; frequency changes restart the motion', async ({ page }) => {
  const { change: webglChange, readout: webglReadout, animate: animateWebGLFor } = await webglControls(page);

  for (const motion of ['lissajous']) {
    await webglChange('#motion', motion);
    assert.equal((await page.locator('#pause').textContent())!, 'Resume', 'Remount preserves manual pause');
    assert.equal(await page.locator('#webgl-view option[value="spatial"]').evaluate((option: HTMLOptionElement) => option.disabled), false);
    assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial', `${motion} defaults to its supported spatial view`);
    await webglChange('#webgl-camera', 'front');
    await webglChange('#webgl-view', 'spatial');
    assert.equal(await page.locator('#webgl-camera').isDisabled(), false);
    await webglChange('#webgl-lighting', true);
    if (motion === 'lissajous') {
      assert.equal(await page.locator('#parameter-controls [data-parameter="cyclesZ"]').inputValue(), '3');
      await webglChange('#parameter-controls [data-parameter="periodSeconds"]', 4);
    }
    if (motion === 'duffing') {
      const explanation =(await page.locator('#webgl-note').textContent())!;
      assert.match(explanation, /displacement/i);
      assert.match(explanation, /velocity/i);
      assert.match(explanation, /forcing phase/i);
    }
    const initialDepth = await webglReadout();
    assert.ok(Number.isFinite(initialDepth.depth), `${motion} spatial depth readout is numeric`);
    assert.ok((await animateWebGLFor(0.3)).count > 0, `${motion} spatial animation paints a marker`);
    const spatialFrame = await webglReadout();
    assert.notEqual(spatialFrame.depth, initialDepth.depth, `${motion} spatial depth changes with motion`);
    assert.ok(Number.isFinite(spatialFrame.size) && spatialFrame.size > 0, `${motion} projected size scale is numeric`);
    const cameraRaster = await webglChange('#webgl-camera', 'oblique');
    assert.ok(cameraRaster.count > 0, `${motion} oblique camera redraws a marker`);
    assert.equal((await webglReadout()).time, spatialFrame.time, 'Camera changes preserve elapsed time');
    assert.equal((await webglReadout()).pause, 'Resume');
    const frontRaster = await webglChange('#webgl-camera', 'front');
    assert.ok(frontRaster.count > 0, `${motion} front camera redraws a marker`);
    assert.equal((await webglReadout()).time, spatialFrame.time, 'Returning to front camera preserves elapsed time');
    assert.equal((await webglReadout()).pause, 'Resume');
    await webglChange('#webgl-view', 'planar');
    assert.equal((await webglReadout()).time, spatialFrame.time, 'Returning to planar view preserves elapsed time');
    assert.equal((await webglReadout()).pause, 'Resume');
    assert.equal(await page.locator('#webgl-camera').isDisabled(), true);
    await webglChange('#webgl-view', 'spatial');
    assert.equal((await webglReadout()).time, spatialFrame.time, 'Returning to spatial view preserves elapsed time');
    assert.equal((await webglReadout()).pause, 'Resume');
    if (motion === 'lissajous') {
      await webglChange('#parameter-controls [data-parameter="cyclesZ"]', 1);
      assert.equal((await webglReadout()).time, 0, 'Changing Lissajous frequency remounts at initial time');
      assert.equal((await webglReadout()).pause, 'Resume', 'Changing Lissajous frequency preserves manual pause');
      assert.ok((await animateWebGLFor(0.3)).count > 0, 'Changed Lissajous depth frequency paints a marker');
      assert.ok(Math.abs((await webglReadout()).depth - spatialFrame.depth) > 0.005, 'Lissajous depth frequency changes the 3D projection at advanced time');
    }
  }

});

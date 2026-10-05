import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const demoRoot = resolve('demo-dist');
const libraryRoot = resolve('dist');
const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const library = pathname.startsWith('/lib/');
  const root = library ? libraryRoot : demoRoot;
  const relative = library ? pathname.slice('/lib/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Unable to start browser test server');
const origin = `http://127.0.0.1:${address.port}`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  const failedAssets = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(origin);
  await page.locator('#status').waitFor();

  const initial = await page.evaluate(() => ({
    bitmap: [document.querySelector('#canvas-stage').width, document.querySelector('#canvas-stage').height],
    webglBitmap: [document.querySelector('#webgl-stage').width, document.querySelector('#webgl-stage').height],
    viewBox: document.querySelector('#svg-stage').getAttribute('viewBox'),
    stage: document.querySelector('.stage-shell').getBoundingClientRect().toJSON(),
  }));

  for (const renderer of ['canvas', 'dom', 'svg', 'webgl']) {
    await page.selectOption('#renderer', renderer);
    const visibility = await page.evaluate(() => Object.fromEntries(
      ['canvas', 'dom', 'svg', 'webgl'].map((name) => [name, getComputedStyle(document.querySelector(`#${name}-stage`)).display !== 'none']),
    ));
    assert.deepEqual(visibility, Object.fromEntries(['canvas', 'dom', 'svg', 'webgl'].map((name) => [name, name === renderer])));
    for (const motion of ['ellipse', 'rose', 'lissajous', 'helix', 'vander-pol', 'duffing', 'lorenz']) {
      await page.selectOption('#motion', motion);
      assert.match(await page.locator('#status').textContent(), /; cover at/);
    }
  }
  await page.selectOption('#renderer', 'svg');
  for (const fit of ['cover', 'contain', 'stretch']) {
    await page.selectOption('#fit', fit);
    await page.locator('#zoom').fill('1.5');
    assert.match(await page.locator('#status').textContent(), new RegExp(`; ${fit} at`));
  }

  await page.locator('#offset-x').fill('0.5');
  await page.locator('#offset-y').fill('-0.25');
  assert.match(await page.locator('#status').textContent(), /position 50%\/-25%/);
  await page.selectOption('#overflow', 'visible');
  assert.equal(await page.locator('.stage-shell').evaluate((element) => getComputedStyle(element).overflow), 'visible');
  await page.selectOption('#renderer', 'canvas');
  assert.equal(await page.locator('#overflow').isDisabled(), true);
  await page.selectOption('#motion', 'ellipse');
  await page.locator('#show-trail').check();
  await page.locator('#show-path').check();
  await page.selectOption('#renderer', 'svg');
  assert.ok((await page.locator('#svg-full-path').getAttribute('d'))?.startsWith('M'));
  await page.locator('.stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  assert.ok((await page.locator('#svg-trail').getAttribute('d'))?.startsWith('M'));
  await page.locator('#parameter-controls [data-parameter="radiusX"]').fill('1.5');
  await page.locator('#parameter-controls [data-parameter="radiusX"]').press('Tab');
  await page.selectOption('#motion', 'lorenz');
  assert.equal(await page.locator('#show-path').isDisabled(), true);
  await page.locator('#custom-bounds').check();
  await page.locator('#min-x').fill('-2');
  await page.locator('#min-x').press('Tab');
  await page.click('#defaults');
  assert.equal(await page.locator('#show-trail').isChecked(), false);
  assert.equal(await page.locator('#custom-bounds').isChecked(), false);

  await page.selectOption('#motion', 'ellipse');
  await page.locator('#parameter-controls [data-parameter="periodSeconds"]').fill('1');
  await page.locator('#parameter-controls [data-parameter="periodSeconds"]').press('Tab');
  await page.locator('#marker-size').fill('24');
  await page.selectOption('#fit', 'contain');
  for (const renderer of ['dom', 'svg']) {
    await page.selectOption('#renderer', renderer);
    await page.locator(`#${renderer}-stage`).scrollIntoViewIfNeeded();
    for (let sample = 0; sample < 12; sample += 1) {
      await page.waitForTimeout(90);
      const extents = await page.evaluate((name) => {
        const viewport = document.querySelector(`#${name}-stage`).getBoundingClientRect();
        const marker = document.querySelector(name === 'dom' ? '#dom-marker' : '#svg-marker circle').getBoundingClientRect();
        return { viewport: viewport.toJSON(), marker: marker.toJSON() };
      }, renderer);
      assert.ok(extents.marker.left >= extents.viewport.left - 0.5, `${renderer} marker escaped left in contain`);
      assert.ok(extents.marker.right <= extents.viewport.right + 0.5, `${renderer} marker escaped right in contain`);
      assert.ok(extents.marker.top >= extents.viewport.top - 0.5, `${renderer} marker escaped top in contain`);
      assert.ok(extents.marker.bottom <= extents.viewport.bottom + 0.5, `${renderer} marker escaped bottom in contain`);
    }
  }
  await page.selectOption('#renderer', 'canvas');
  await page.locator('.stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  const firstCanvasFrame = await page.locator('#canvas-stage').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#canvas-stage').evaluate((canvas) => canvas.toDataURL()), firstCanvasFrame);
  await page.selectOption('#renderer', 'dom');
  await page.locator('.stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  const firstDomFrame = await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform), firstDomFrame);
  await page.selectOption('#renderer', 'svg');
  await page.locator('.stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  const firstSvgFrame = await page.locator('#svg-marker').getAttribute('transform');
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#svg-marker').getAttribute('transform'), firstSvgFrame);
  await page.click('#defaults');

  await page.selectOption('#renderer', 'dom');
  await page.selectOption('#motion', 'ellipse');
  await page.locator('.stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.click('#pause');
  const paused = await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform), paused);
  await page.locator('#offset-x').fill('0.2');
  assert.equal(await page.locator('#pause').textContent(), 'Resume');
  const reframedWhilePaused = await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform);
  assert.notEqual(reframedWhilePaused, paused);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform), reframedWhilePaused);
  await page.click('#reset');
  await page.click('#pause');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(40);
  const reduced = await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform), reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Keep pixel inspection in the same callback as a UI redraw: Chromium may
  // discard the default WebGL drawing buffer after compositing a frame.
  await page.evaluate(() => {
    window.demoWebGLPixels = () => {
      const canvas = document.querySelector('#webgl-stage');
      const gl = canvas.getContext('webgl');
      if (!gl) throw new Error('Example did not provide a WebGL context');
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Example WebGL pixel read failed');
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = canvas.width;
      let maxX = -1;
      let minY = canvas.height;
      let maxY = -1;
      let hash = 2166136261;
      const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] === 0) continue;
        count += 1;
        const x = (offset / 4) % canvas.width;
        const y = Math.floor(offset / 4 / canvas.width);
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
        hash = Math.imul(hash ^ offset, 16777619);
        for (let channel = 0; channel < 4; channel += 1) hash = Math.imul(hash ^ pixels[offset + channel], 16777619);
      }
      const rect = canvas.getBoundingClientRect();
      const size = count ? [(maxX - minX + 1) * rect.width / canvas.width, (maxY - minY + 1) * rect.height / canvas.height] : null;
      return { count, hash: hash >>> 0, colors: [...colors], center: count ? [sumX / count, sumY / count] : null, size };
    };
  });
  const webglChange = (selector, value) => page.evaluate(({ selector, value }) => {
    const control = document.querySelector(selector);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return window.demoWebGLPixels();
  }, { selector, value });
  const webglClick = (selector) => page.evaluate((selector) => {
    document.querySelector(selector).click();
    return window.demoWebGLPixels();
  }, selector);
  const webglReadout = () => page.evaluate(() => ({
    time: Number(document.querySelector('#webgl-time').textContent),
    size: Number(document.querySelector('#webgl-size-scale').textContent),
    depth: Number(document.querySelector('#webgl-depth').textContent),
    pause: document.querySelector('#pause').textContent,
  }));
  const animateWebGLFor = async (seconds) => {
    await page.locator('#webgl-stage').scrollIntoViewIfNeeded();
    return page.evaluate((seconds) => {
      const output = document.querySelector('#webgl-time');
      const time = () => Number(output.textContent);
      const start = time();
      return new Promise((resolveFrame, reject) => {
        // Output mutations are delivered after rendering, before Chromium
        // composites and discards the default WebGL drawing buffer.
        const observer = new MutationObserver(() => {
          if (time() - start < seconds) return;
          observer.disconnect();
          clearTimeout(timeout);
          document.querySelector('#pause').click();
          try {
            resolveFrame(window.demoWebGLPixels());
          } catch (error) {
            reject(error);
          }
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          document.querySelector('#pause').click();
          reject(new Error('Example WebGL animation did not advance'));
        }, 5000);
        observer.observe(output, { childList: true, characterData: true, subtree: true });
        document.querySelector('#pause').click();
      });
    }, seconds);
  };

  // A reset supplies the same initial depth cue to every example renderer.
  // Read raster output synchronously with reset, before WebGL compositing.
  await page.evaluate(() => {
    document.querySelector('#defaults').click();
    document.querySelector('#pause').click();
  });
  for (const motion of ['lissajous', 'duffing']) {
    for (const renderer of ['canvas', 'dom', 'svg', 'webgl']) {
      const marker = await page.evaluate(({ motion, renderer }) => {
        const change = (selector, value, event = 'change') => {
          const control = document.querySelector(selector);
          control.value = value;
          control.dispatchEvent(new Event(event, { bubbles: true }));
        };
        change('#motion', motion);
        change('#renderer', renderer);
        change('#fit', 'contain', 'input');
        change('#marker-size', '24');
        document.querySelector('#reset').click();
        if (renderer === 'dom' || renderer === 'svg') {
          const element = document.querySelector(renderer === 'dom' ? '#dom-marker' : '#svg-marker circle');
          const rect = element.getBoundingClientRect();
          return {
            size: [rect.width, rect.height],
            transform: renderer === 'dom' ? element.style.transform : element.parentElement.getAttribute('transform'),
          };
        }
        if (renderer === 'webgl') return {
          size: window.demoWebGLPixels().size,
          scale: Number(document.querySelector('#webgl-size-scale').textContent),
          depth: Number(document.querySelector('#webgl-depth').textContent),
        };
        const canvas = document.querySelector('#canvas-stage');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width;
        let maxX = -1;
        let minY = canvas.height;
        let maxY = -1;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] === 0) continue;
          const x = (offset / 4) % canvas.width;
          const y = Math.floor(offset / 4 / canvas.width);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        const rect = canvas.getBoundingClientRect();
        return { size: maxX < minX ? null : [(maxX - minX + 1) * rect.width / canvas.width, (maxY - minY + 1) * rect.height / canvas.height] };
      }, { motion, renderer });
      assert.ok(marker.size, `${motion} ${renderer} reset paints a marker`);
      for (const extent of marker.size) {
        assert.ok(Math.abs(extent - 30) < 2, `${motion} ${renderer} reset uses radius 24 × .625 = 15 CSS pixels; got extent ${extent}`);
      }
      if (marker.transform) assert.match(marker.transform, /scale\(0\.625\)/, `${motion} ${renderer} receives the depth cue`);
      if (renderer === 'webgl') {
        assert.equal(marker.scale, 0.63, `${motion} WebGL rounds the .625 size cue in its readout`);
        assert.equal(marker.depth, 0.5, `${motion} planar visibility depth stays independent of marker size`);
      }
    }
  }

  await page.selectOption('#motion', 'lissajous');
  await page.selectOption('#renderer', 'dom');
  await page.locator('#parameter-controls [data-parameter="periodSeconds"]').fill('4');
  await page.locator('#parameter-controls [data-parameter="periodSeconds"]').press('Tab');
  await page.locator('#dom-stage').scrollIntoViewIfNeeded();
  const depthScales = await page.evaluate(() => new Promise((resolveFrames) => {
    document.querySelector('#reset').click();
    const marker = document.querySelector('#dom-marker');
    const scales = [];
    const start = performance.now();
    const sample = (timestamp) => {
      const transform = new DOMMatrix(getComputedStyle(marker).transform);
      scales.push(Math.hypot(transform.a, transform.b));
      if (timestamp - start < 450) requestAnimationFrame(sample);
      else {
        document.querySelector('#pause').click();
        resolveFrames(scales);
      }
    };
    document.querySelector('#pause').click();
    requestAnimationFrame(sample);
  }));
  assert.ok(depthScales.every((scale) => scale >= 0.25 - 1e-6 && scale <= 1 + 1e-6), 'Lissajous animated depth cue remains bounded');
  assert.ok(Math.max(...depthScales) - Math.min(...depthScales) > 0.1, 'Lissajous Z motion changes the planar marker size');

  await page.click('#defaults');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.selectOption('#renderer', 'webgl');
  await page.evaluate(() => document.querySelector('#pause').click());
  assert.equal(await page.locator('#pause').textContent(), 'Resume');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('#show-trail').isDisabled(), true);
  assert.equal(await page.locator('#show-path').isDisabled(), true);
  assert.equal(await page.locator('#clear-drawing').isDisabled(), false);
  assert.equal(await page.locator('#webgl-camera').isDisabled(), true);
  assert.equal(await page.locator('#webgl-view option[value="spatial"]').evaluate((option) => option.disabled), true);
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
  const beforeTimeColor = await webglReadout();
  const timeColor = await webglChange('#webgl-color-mode', 'time');
  assert.notDeepEqual(timeColor.colors, redSquare.colors, 'Time color mode changes the painted color');
  assert.deepEqual(await webglReadout(), beforeTimeColor, 'Time color redraw preserves elapsed motion and pause');
  await webglChange('#webgl-color-mode', 'solid');
  await webglChange('#webgl-accumulate', true);
  await webglClick('#reset');
  assert.equal((await webglReadout()).time, 0, 'Reset returns source elapsed time to zero');
  const accumulated = await animateWebGLFor(0.25);
  assert.ok(accumulated.count > singleFrame.count * 2, 'Accumulation retains earlier marker pixels');
  const beforeClear = await webglReadout();
  assert.equal((await webglClick('#clear-drawing')).count, 0, 'Clear removes the actual accumulated raster');
  assert.deepEqual(await webglReadout(), beforeClear, 'Clear preserves time, frame readout, and manual pause');
  await page.waitForTimeout(100);
  assert.deepEqual(await webglReadout(), beforeClear, 'Clearing paused output must not restart animation');
  const resetRaster = await webglClick('#reset');
  assert.ok(resetRaster.count > 0 && resetRaster.count < accumulated.count, 'Reset discards accumulation and paints only the initial marker');
  assert.equal((await webglReadout()).time, 0);

  for (const motion of ['helix', 'lorenz', 'lissajous', 'duffing']) {
    await webglChange('#motion', motion);
    assert.equal(await page.locator('#pause').textContent(), 'Resume', 'Remount preserves manual pause');
    assert.equal(await page.locator('#webgl-view option[value="spatial"]').evaluate((option) => option.disabled), false);
    await webglChange('#webgl-camera', 'front');
    await webglChange('#webgl-view', 'spatial');
    assert.equal(await page.locator('#webgl-camera').isDisabled(), false);
    await webglChange('#webgl-color-mode', 'depth');
    if (motion === 'lissajous') {
      assert.equal(await page.locator('#parameter-controls [data-parameter="cyclesZ"]').inputValue(), '3');
      await webglChange('#parameter-controls [data-parameter="periodSeconds"]', 4);
    }
    if (motion === 'duffing') {
      const explanation = await page.locator('#webgl-note').textContent();
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

  await webglChange('#webgl-accumulate', false);
  await webglChange('#parameter-controls [data-parameter="angularFrequency"]', 10);
  await webglChange('#parameter-controls [data-parameter="timeScale"]', 2.4);
  assert.equal((await webglReadout()).time, 0);
  assert.equal((await webglReadout()).pause, 'Resume');
  await page.locator('#webgl-stage').scrollIntoViewIfNeeded();
  const phaseFrames = await page.evaluate(() => new Promise((resolveFrames, reject) => {
    const output = document.querySelector('#webgl-time');
    const frames = [];
    const observer = new MutationObserver(() => {
      const time = Number(output.textContent);
      try {
        frames.push({ time, ...window.demoWebGLPixels() });
        if (time < 0.36) return;
        observer.disconnect();
        clearTimeout(timeout);
        document.querySelector('#pause').click();
        resolveFrames(frames);
      } catch (error) {
        observer.disconnect();
        clearTimeout(timeout);
        document.querySelector('#pause').click();
        reject(error);
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      document.querySelector('#pause').click();
      reject(new Error('Duffing example did not advance across its forcing phase wrap'));
    }, 5000);
    observer.observe(output, { childList: true, characterData: true, subtree: true });
    document.querySelector('#pause').click();
  }));
  const wrapTime = 2 * Math.PI / (10 * 2.4);
  const afterWrapIndex = phaseFrames.findIndex((frame) => frame.time >= wrapTime);
  assert.ok(afterWrapIndex > 0, 'Duffing renders samples before and after one complete forcing cycle');
  const beforeWrap = phaseFrames[afterWrapIndex - 1];
  const afterWrap = phaseFrames[afterWrapIndex];
  assert.ok(beforeWrap.count > 0 && afterWrap.count > 0, 'Duffing marker remains visible across the forcing phase wrap');
  const wrapDistance = Math.hypot(afterWrap.center[0] - beforeWrap.center[0], afterWrap.center[1] - beforeWrap.center[1]);
  const phaseStep = (afterWrap.time - beforeWrap.time) * 10 * 2.4;
  assert.ok(wrapDistance / initial.webglBitmap[0] < 0.4 * phaseStep + 0.01, 'Duffing cylindrical view moves continuously across the forcing phase wrap');
  assert.equal((await webglReadout()).pause, 'Resume');
  await webglChange('#motion', 'ellipse');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'planar');
  assert.equal(await page.locator('#webgl-view option[value="spatial"]').evaluate((option) => option.disabled), true);
  await page.click('#defaults');
  assert.equal(await page.locator('#renderer').inputValue(), 'canvas');
  assert.equal(await page.locator('#motion').inputValue(), 'ellipse');
  assert.equal(await page.locator('#pause').textContent(), 'Pause');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'planar');
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'oblique');
  assert.equal(await page.locator('#webgl-shape').inputValue(), 'circle');
  assert.equal(await page.locator('#webgl-color-mode').inputValue(), 'solid');
  assert.equal(await page.locator('#webgl-accumulate').isChecked(), false);
  assert.equal(await page.locator('#clear-drawing').isDisabled(), true);

  const final = await page.evaluate(() => ({
    bitmap: [document.querySelector('#canvas-stage').width, document.querySelector('#canvas-stage').height],
    webglBitmap: [document.querySelector('#webgl-stage').width, document.querySelector('#webgl-stage').height],
    viewBox: document.querySelector('#svg-stage').getAttribute('viewBox'),
    stage: document.querySelector('.stage-shell').getBoundingClientRect().toJSON(),
  }));
  assert.deepEqual(final.bitmap, initial.bitmap);
  assert.deepEqual(initial.webglBitmap, [1280, 720]);
  assert.deepEqual(final.webglBitmap, initial.webglBitmap);
  assert.equal(final.viewBox, initial.viewBox);
  assert.equal(final.stage.width, initial.stage.width);
  assert.equal(final.stage.height, initial.stage.height);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedAssets, []);

  await page.evaluate(async () => {
    const { animateSvg } = await import('/lib/svg/index.js');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.width = '400px';
    svg.style.height = '200px';
    svg.style.transform = 'rotate(20deg)';
    svg.style.transformOrigin = 'center';
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('transform', 'scale(2)');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('r', '3');
    group.append(marker);
    svg.append(group);
    document.body.append(svg);
    const source = {
      kind: 'analytic',
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      periodSeconds: 1,
      sample: () => ({ state: null, pose: { x: 0.5, y: 0.5 } }),
      reset() {},
    };
    const controller = animateSvg({ viewport: svg, marker }, source, { autoplay: false, framing: { fit: 'contain', padding: 0 } });
    const expected = svg.createSVGPoint();
    expected.x = 75;
    expected.y = 75;
    const screen = expected.matrixTransform(svg.getScreenCTM());
    const rect = marker.getBoundingClientRect();
    if (Math.hypot(rect.left + rect.width / 2 - screen.x, rect.top + rect.height / 2 - screen.y) > 2) {
      throw new Error('Transformed SVG group placed marker at the wrong screen position');
    }
    controller.dispose();
    svg.remove();
  });

  await page.evaluate(async () => {
    const { animateDom } = await import('/lib/dom/index.js');
    const { animateSvg } = await import('/lib/svg/index.js');
    const source = {
      kind: 'analytic',
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      periodSeconds: 1,
      sample: () => ({ state: null, pose: { x: 1, y: 0 } }),
      reset() {},
    };
    const viewport = document.createElement('div');
    viewport.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:100px;overflow:visible;z-index:1000';
    const marker = document.createElement('div');
    marker.style.cssText = 'position:absolute;left:0;top:0;width:12px;height:12px;background:red';
    viewport.append(marker);
    document.body.append(viewport);
    const domController = animateDom({ viewport, marker }, source, { autoplay: false, framing: { fit: 'stretch', zoom: 2 } });
    let rect = marker.getBoundingClientRect();
    const domX = rect.left + rect.width / 2;
    const domY = rect.top + rect.height / 2;
    if (document.elementFromPoint(domX, domY) !== marker) throw new Error('DOM visible overflow did not paint outside the viewport');
    viewport.style.overflow = 'hidden';
    if (document.elementFromPoint(domX, domY) === marker) throw new Error('DOM clipped overflow remained visible');
    domController.dispose();
    viewport.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.style.cssText = 'position:fixed;left:300px;top:20px;width:100px;height:100px;overflow:visible;z-index:1000';
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '6');
    dot.setAttribute('fill', 'red');
    svg.append(dot);
    document.body.append(svg);
    const svgController = animateSvg({ viewport: svg, marker: dot }, source, { autoplay: false, framing: { fit: 'stretch', zoom: 2 } });
    rect = dot.getBoundingClientRect();
    const svgX = rect.left + rect.width / 2;
    const svgY = rect.top + rect.height / 2;
    if (document.elementFromPoint(svgX, svgY) !== dot) throw new Error('SVG visible overflow did not paint outside the viewport');
    svg.style.overflow = 'hidden';
    if (document.elementFromPoint(svgX, svgY) === dot) throw new Error('SVG clipped overflow remained visible');
    svgController.dispose();
    svg.remove();
  });

  await page.evaluate(async () => {
    const { animateCanvas, renderCanvasMarker } = await import('/lib/canvas/index.js');
    const { animateDom } = await import('/lib/dom/index.js');
    const { animateSvg } = await import('/lib/svg/index.js');
    const source = {
      kind: 'analytic',
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      periodSeconds: 1,
      sample: () => ({ state: null, pose: { x: 1, y: 1 } }),
      reset() {},
    };
    for (const radius of [5, 24]) {
      const framing = radius === 5 ? { fit: 'contain' } : { fit: 'contain', padding: 39 };
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 100;
      canvas.style.cssText = 'position:fixed;left:20px;top:150px;width:100px;height:100px';
      document.body.append(canvas);
      let canvasPosition;
      const canvasController = animateCanvas(canvas, source, {
        autoplay: false, offscreen: false, framing,
        render(context, frame) {
          canvasPosition = frame.position;
          renderCanvasMarker(context, frame, { radius });
        },
      });
      if (!canvasPosition || canvasPosition.x + radius > 100 || canvasPosition.y + radius > 100) {
        throw new Error('Contain framing clipped the Canvas marker');
      }
      canvasController.dispose();
      canvas.remove();

      const viewport = document.createElement('div');
      viewport.style.cssText = 'position:fixed;left:140px;top:150px;width:100px;height:100px;overflow:hidden';
      const marker = document.createElement('div');
      marker.style.cssText = `position:absolute;left:0;top:0;width:${radius * 2}px;height:${radius * 2}px;background:red`;
      viewport.append(marker);
      document.body.append(viewport);
      const domController = animateDom({ viewport, marker }, source, { autoplay: false, framing });
      let outer = viewport.getBoundingClientRect();
      let inner = marker.getBoundingClientRect();
      if (inner.right > outer.right + 0.5 || inner.bottom > outer.bottom + 0.5) {
        throw new Error('Contain framing clipped the DOM marker');
      }
      domController.dispose();
      viewport.remove();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.style.cssText = 'position:fixed;left:260px;top:150px;width:100px;height:100px;overflow:hidden';
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', String(radius));
      svg.append(circle);
      document.body.append(svg);
      const svgController = animateSvg({ viewport: svg, marker: circle }, source, { autoplay: false, framing });
      outer = svg.getBoundingClientRect();
      inner = circle.getBoundingClientRect();
      if (inner.right > outer.right + 0.5 || inner.bottom > outer.bottom + 0.5) {
        throw new Error('Contain framing clipped the SVG marker');
      }
      svgController.dispose();
      svg.remove();
    }
  });

  await page.evaluate(async () => {
    const { animateWebGL } = await import('/lib/webgl/index.js');
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const fixtures = [];
    const fixture = (samples, options = {}) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 100;
      canvas.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:100px';
      document.body.append(canvas);
      let index = 0;
      let time = 0;
      let resets = 0;
      let sampledTime = 0;
      let frame;
      let nextHandle = 0;
      const pending = new Map();
      const observers = {};
      const platform = {
        requestAnimationFrame(callback) { const handle = ++nextHandle; pending.set(handle, callback); return handle; },
        cancelAnimationFrame(handle) { pending.delete(handle); },
        isDocumentVisible: () => true,
        prefersReducedMotion: () => false,
        observeResize(_target, callback) { observers.resize = callback; return () => { delete observers.resize; }; },
        observeIntersection(_target, callback) { observers.intersection = callback; return () => { delete observers.intersection; }; },
        observeVisibility(callback) { observers.visibility = callback; return () => { delete observers.visibility; }; },
        observeReducedMotion(callback) { observers.reduced = callback; return () => { delete observers.reduced; }; },
      };
      const source = {
        kind: 'analytic', bounds, periodSeconds: 1,
        sample(elapsedSeconds) {
          sampledTime = elapsedSeconds;
          const sample = samples[index];
          return { state: sample, pose: { x: 0, y: 0, ...sample.pose } };
        },
        reset() { resets += 1; index = 0; },
      };
      const controller = animateWebGL(canvas, source, {
        autoplay: false, offscreen: false, accumulate: true,
        framing: { fit: 'stretch', padding: 0 }, platform,
        visibilityDepth: ({ state }) => state.visibilityDepth ?? 0.5,
        ...options,
        marker(current) {
          frame = current;
          return current.state.skip ? null : { radius: 10, color: [1, 0, 0], ...current.state.marker };
        },
      });
      const gl = canvas.getContext('webgl');
      check(gl !== null, 'Chromium did not provide the WebGL context');
      const step = () => {
        time += 16;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach((callback) => callback(time));
      };
      const result = {
        canvas, gl, controller, observers,
        get frame() { return frame; },
        get resets() { return resets; },
        get sampledTime() { return sampledTime; },
        get scheduled() { return pending.size; },
        step,
        advance(nextIndex) {
          index = nextIndex;
          controller.resume();
          step(); // Establish the timestamp after resume.
          step();
          controller.pause();
        },
        pixel(x, y, expected, label) {
          const rgba = new Uint8Array(4);
          const rect = canvas.getBoundingClientRect();
          gl.readPixels(Math.floor(x * canvas.width / rect.width), canvas.height - 1 - Math.floor(y * canvas.height / rect.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          check([...rgba].every((value, channel) => Math.abs(value - expected[channel]) <= 1), `${label}: expected ${expected}, got ${[...rgba]}`);
          const error = gl.getError();
          check(error === gl.NO_ERROR, `${label}: WebGL error ${error} during pixel read`);
        },
        dispose() { controller.dispose(); canvas.remove(); },
      };
      fixtures.push(result);
      return result;
    };
    const event = (canvas, name) => new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
      canvas.addEventListener(name, () => { clearTimeout(timeout); resolveEvent(); }, { once: true });
    });
    const lose = async (target) => {
      const extension = target.gl.getExtension('WEBGL_lose_context');
      check(extension !== null, 'Chromium did not expose WEBGL_lose_context');
      const lost = event(target.canvas, 'webglcontextlost');
      extension.loseContext();
      await lost;
      check(target.controller.isPaused() && target.scheduled === 0, 'Context loss did not suspend scheduling');
      return async () => {
        // Chromium requires a delay between losing and restoring a real context.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        const restored = event(target.canvas, 'webglcontextrestored');
        extension.restoreContext();
        await restored;
      };
    };
    try {
      for (const nearFirst of [false, true]) {
        const near = { visibilityDepth: 0.2, marker: { color: [0, 1, 0] } };
        const far = { visibilityDepth: 0.8 };
        const target = fixture(nearFirst ? [near, far] : [far, near]);
        target.advance(1);
        target.pixel(50, 50, green, `Near marker must win with nearFirst=${nearFirst}`);
        target.dispose();
      }
      const corners = fixture([
        { visibilityDepth: 0.2, marker: { color: [0, 1, 0] } },
        { visibilityDepth: 0.8, marker: { shape: 'square' } },
      ]);
      corners.advance(1);
      corners.pixel(50, 50, green, 'Near circle occludes far square');
      corners.pixel(58, 58, red, 'Discarded circle corners must not occlude the far square');
      corners.dispose();

      for (const accumulate of [false, true]) {
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
      }
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

      const camera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      for (const nearFirst of [false, true]) {
        const near = { pose: { z: 2 }, marker: { color: [0, 1, 0] } };
        const far = { pose: { z: -2 } };
        const target = fixture(nearFirst ? [near, far] : [far, near], { camera });
        target.advance(1);
        target.pixel(50, 50, green, `3D camera occlusion with nearFirst=${nearFirst}`);
        target.dispose();
      }
      const projected = fixture([{ pose: { x: -0.5, y: -0.5 }, point: { x: 0.5, y: 0.5, z: 0 } }], {
        camera, position: ({ state }) => state.point,
      });
      projected.pixel(75, 25, red, 'Camera projects selected 3D coordinates');
      projected.pixel(25, 25, blank, 'Camera uses position callback instead of legacy pose');
      projected.controller.setCamera({ ...camera, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } });
      projected.pixel(75, 25, blank, 'Camera update clears old projection');
      projected.pixel(62, 37, red, 'Camera update reprojects current frame');
      check(projected.controller.isPaused() && projected.resets === 0 && projected.sampledTime === 0, 'Camera update changed motion or pause');
      projected.controller.setCamera(undefined);
      projected.pixel(75, 75, red, 'Removing camera restores planar projection');
      projected.pixel(62, 37, blank, 'Removing camera clears old camera projection');
      projected.dispose();
      for (const z of [4.5, -5]) {
        const clipped = fixture([{ pose: { z } }], { camera });
        clipped.pixel(50, 50, blank, `Camera near/far clipping at z=${z}`);
        clipped.dispose();
      }

      const resized = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0.5 } }]);
      resized.advance(1);
      resized.canvas.width = 200;
      resized.canvas.height = 200;
      await Promise.resolve(); // Deliver bitmap attribute mutations while paused.
      resized.pixel(25, 50, blank, 'Bitmap resize clears accumulated color and depth');
      resized.pixel(75, 50, red, 'Bitmap resize repaints current paused marker');
      resized.canvas.style.width = '200px';
      resized.observers.resize();
      resized.pixel(75, 50, blank, 'CSS resize clears old projected marker');
      resized.pixel(150, 50, red, 'CSS resize reprojects current paused marker');
      check(resized.canvas.width === 200 && resized.canvas.height === 200 && resized.controller.isPaused(), 'Resize changed bitmap ownership or pause state');
      resized.dispose();

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

      const recovery = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0.5 } }], { offscreen: true });
      recovery.advance(1);
      const elapsed = recovery.sampledTime;
      let restore = await lose(recovery);
      recovery.controller.resume();
      await restore();
      recovery.pixel(25, 50, blank, 'Restored context discards accumulation');
      recovery.pixel(75, 50, red, 'Restored context redraws current motion');
      check(!recovery.controller.isPaused() && recovery.scheduled === 1 && recovery.sampledTime === elapsed && recovery.resets === 0, 'Resume during context loss did not preserve current elapsed motion');
      recovery.step();
      check(recovery.sampledTime === elapsed, 'Restoration counted unavailable time as motion time');
      recovery.step();
      check(recovery.sampledTime > elapsed, 'Restored running context did not advance');
      recovery.controller.pause();
      for (const preference of ['manual', 'intersection', 'visibility', 'reduced']) {
        restore = await lose(recovery);
        if (preference === 'manual') {
          recovery.controller.resume();
          recovery.controller.pause();
        } else {
          recovery.controller.resume();
          recovery.observers[preference](preference === 'reduced');
        }
        const before = recovery.sampledTime;
        await restore();
        recovery.pixel(75, 50, red, `Recovery redraws while paused by ${preference}`);
        check(recovery.controller.isPaused() && recovery.scheduled === 0 && recovery.sampledTime === before, `Recovery overrode ${preference} pause preference`);
        if (preference !== 'manual') recovery.observers[preference](preference !== 'reduced');
        recovery.controller.pause();
      }
      recovery.dispose();
      check(Object.keys(recovery.observers).length === 0 && recovery.scheduled === 0, 'Disposal left browser observers or scheduled frames');
    } finally {
      fixtures.forEach((target) => target.dispose());
    }
  });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedAssets, []);

  console.log('Browser smoke passed: 28 motion/renderer combinations, controls, consistent Lissajous/Duffing planar depth cue sizes, animated Lissajous size, example WebGL planar/spatial views, camera and appearance pause preservation, accumulation/clear/reset pixels, contain marker bounds, pause, reduced motion, fixed target sizes, transformed SVG, DOM/SVG overflow, WebGL pixels, depth, accumulation, clipping, camera, resize, and context recovery.');
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

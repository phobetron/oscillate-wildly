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
    viewBox: document.querySelector('#svg-stage').getAttribute('viewBox'),
    stage: document.querySelector('.stage-shell').getBoundingClientRect().toJSON(),
  }));

  for (const renderer of ['canvas', 'dom', 'svg']) {
    await page.selectOption('#renderer', renderer);
    const visibility = await page.evaluate(() => Object.fromEntries(
      ['canvas', 'dom', 'svg'].map((name) => [name, getComputedStyle(document.querySelector(`#${name}-stage`)).display !== 'none']),
    ));
    assert.deepEqual(visibility, Object.fromEntries(['canvas', 'dom', 'svg'].map((name) => [name, name === renderer])));
    for (const motion of ['ellipse', 'rose', 'lissajous', 'helix', 'vander-pol', 'duffing', 'lorenz']) {
      await page.selectOption('#motion', motion);
      assert.match(await page.locator('#status').textContent(), /; cover at/);
    }
  }
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
  await page.waitForTimeout(60);
  const firstCanvasFrame = await page.locator('#canvas-stage').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#canvas-stage').evaluate((canvas) => canvas.toDataURL()), firstCanvasFrame);
  await page.selectOption('#renderer', 'dom');
  await page.waitForTimeout(60);
  const firstDomFrame = await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform), firstDomFrame);
  await page.selectOption('#renderer', 'svg');
  await page.waitForTimeout(60);
  const firstSvgFrame = await page.locator('#svg-marker').getAttribute('transform');
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#svg-marker').getAttribute('transform'), firstSvgFrame);
  await page.click('#defaults');

  await page.selectOption('#renderer', 'dom');
  await page.selectOption('#motion', 'ellipse');
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

  const final = await page.evaluate(() => ({
    bitmap: [document.querySelector('#canvas-stage').width, document.querySelector('#canvas-stage').height],
    viewBox: document.querySelector('#svg-stage').getAttribute('viewBox'),
    stage: document.querySelector('.stage-shell').getBoundingClientRect().toJSON(),
  }));
  assert.deepEqual(final.bitmap, initial.bitmap);
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

  console.log('Browser smoke passed: 21 motion/renderer combinations, controls, contain marker bounds, pause, reduced motion, fixed target sizes, transformed SVG, DOM/SVG overflow.');
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

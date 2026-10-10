import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import ts from 'typescript';

// Read public interfaces independently of the playground control definitions.
const motionInterfaces = {
  duffing: 'DuffingParams', ellipse: 'EllipseParams', helix: 'HelixParams',
  lissajous: 'LissajousParams', lorenz: 'LorenzParams', rose: 'RoseParams', 'vander-pol': 'VanderPolParams',
};
const motionProgram = ts.createProgram([resolve('src/motions/index.ts')], {
  noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const motionChecker = motionProgram.getTypeChecker();
const motionModule = motionChecker.getSymbolAtLocation(motionProgram.getSourceFile(resolve('src/motions/index.ts')));
assert.ok(motionModule, 'Public motion module is available for control coverage');
const motionExports = motionChecker.getExportsOfModule(motionModule);
const publicMotionControls = Object.fromEntries(Object.entries(motionInterfaces).map(([motion, name]) => {
  const exported = motionExports.find((symbol) => symbol.name === name);
  assert.ok(exported, `${name} is publicly exported`);
  const symbol = exported.flags & ts.SymbolFlags.Alias ? motionChecker.getAliasedSymbol(exported) : exported;
  const properties = motionChecker.getDeclaredTypeOfSymbol(symbol).getProperties();
  return [motion, properties.map((property) => {
    const type = motionChecker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations[0]);
    const members = type.isUnion() ? type.types : [type];
    const choices = members.filter((member) => member.flags & ts.TypeFlags.StringLiteral);
    return { key: property.name, tag: choices.length ? 'SELECT' : 'INPUT' };
  }).sort((a, b) => a.key.localeCompare(b.key))];
}));

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

  const switchRenderer = (renderer) => page.locator(`#tab-${renderer}`).click();
  const rendererOrder = ['webgl', 'canvas', 'dom', 'svg'];
  const assertActiveRenderer = async (renderer) => {
    const tabs = await page.getByRole('tablist', { name: 'Renderer', exact: true }).getByRole('tab').evaluateAll((elements) => elements.map((tab) => ({
      id: tab.id,
      selected: tab.getAttribute('aria-selected'),
      tabIndex: tab.tabIndex,
      panel: tab.getAttribute('aria-controls'),
    })));
    assert.deepEqual(tabs.map((tab) => tab.id), rendererOrder.map((name) => `tab-${name}`));
    for (const tab of tabs) {
      const active = tab.id === `tab-${renderer}`;
      assert.equal(tab.selected, String(active));
      assert.equal(tab.tabIndex, active ? 0 : -1);
      assert.equal(tab.panel, tab.id.replace('tab-', 'panel-'));
      assert.equal(await page.locator(`#${tab.panel}`).getAttribute('aria-labelledby'), tab.id);
    }
    assert.equal(await page.getByRole('tabpanel').count(), 1, 'Only the active renderer panel is exposed');
    assert.equal(await page.locator('.renderer-panel:not([hidden])').getAttribute('id'), `panel-${renderer}`);
  };
  await assertActiveRenderer('webgl');
  const assertMotionMenu = async (renderer, expectFirst = false) => {
    const menu = await page.locator('#motion').evaluate((select) => ({
      value: select.value,
      first: select.options[0].value,
      groups: [...select.querySelectorAll('optgroup')].map((group) => ({
        label: group.label,
        values: [...group.children].map((option) => option.value),
        labels: [...group.children].map((option) => option.textContent.trim()),
      })),
      labels: [...select.options].map((option) => option.textContent.trim()),
    }));
    if (renderer === 'webgl') {
      assert.deepEqual(menu.groups.map(({ label, values }) => ({ label, values })), [
        { label: 'True 3D', values: ['helix', 'lissajous', 'lorenz'] },
        { label: 'Other motions', values: ['duffing', 'ellipse', 'rose', 'vander-pol'] },
      ], 'WebGL groups true XYZ motions before other motions');
      for (const group of menu.groups) assert.deepEqual(group.labels, [...group.labels].sort((a, b) => a.localeCompare(b)), 'Each motion group is alphabetical');
      assert.equal(menu.first, 'helix');
    } else {
      assert.deepEqual(menu.groups, [], `${renderer} has a flat motion menu`);
      assert.deepEqual(menu.labels, [...menu.labels].sort((a, b) => a.localeCompare(b)), `${renderer} motions are alphabetical`);
      assert.equal(menu.first, 'duffing');
    }
    if (expectFirst) assert.equal(menu.value, menu.first, `${renderer} defaults to its first motion option`);
  };
  const assertHelixDirectionDefaults = async () => {
    for (const [label, values] of [
      ['Rotation direction', ['counter-clockwise', 'clockwise']],
      ['Flow direction', ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']],
    ]) {
      const control = page.getByRole('combobox', { name: label, exact: true });
      assert.deepEqual(await control.locator('option').evaluateAll((options) => options.map((option) => option.value)), values);
      assert.equal(await control.inputValue(), values[0], `${label} defaults to the first option`);
    }
  };
  await assertMotionMenu('webgl', true);
  assert.equal(await page.locator('#fit').inputValue(), 'contain');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial');
  await assertHelixDirectionDefaults();
  await page.locator('#show-trail').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#show-trail').evaluate((control) => control === document.activeElement), true, 'Reconfiguring the current renderer preserves control focus');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#show-trail').isChecked(), false);

  // Arrow keys move tab focus; Enter and Space explicitly activate the focused renderer.
  await page.locator('#tab-webgl').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-canvas').evaluate((tab) => tab === document.activeElement), true);
  assert.equal(await page.locator('#tab-webgl').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Enter');
  await assertActiveRenderer('canvas');
  await assertMotionMenu('canvas', true);
  await page.keyboard.press('End');
  assert.equal(await page.locator('#tab-svg').evaluate((tab) => tab === document.activeElement), true);
  await page.keyboard.press('Space');
  await assertActiveRenderer('svg');
  await assertMotionMenu('svg', true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tab-dom').evaluate((tab) => tab === document.activeElement), true);
  await page.keyboard.press('Enter');
  await assertActiveRenderer('dom');
  await assertMotionMenu('dom', true);
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#tab-webgl').evaluate((tab) => tab === document.activeElement), true);
  await page.keyboard.press('Enter');
  await assertActiveRenderer('webgl');
  await assertMotionMenu('webgl', true);
  assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tab-svg').evaluate((tab) => tab === document.activeElement), true, 'Left arrow wraps to the last tab');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-webgl').evaluate((tab) => tab === document.activeElement), true, 'Right arrow wraps to the first tab');

  const selectLabels = await page.locator('select').evaluateAll((selects) => selects.map((select) => ({
    id: select.id,
    labels: [...select.options].map((option) => option.textContent.trim()),
  })));
  for (const { id, labels } of selectLabels) {
    if (!['motion', 'helix-rotationDirection', 'helix-flowDirection'].includes(id)) assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), `${id} options are alphabetical, including disabled options`);
  }

  await page.selectOption('#motion', 'ellipse');
  for (const renderer of rendererOrder) {
    await switchRenderer(renderer);
    await assertActiveRenderer(renderer);
    await assertMotionMenu(renderer);
    assert.equal(await page.locator('#motion').inputValue(), 'ellipse', 'Explicitly chosen motion persists across renderer tabs');
    const placement = await page.evaluate((name) => {
      const panel = document.querySelector(`#panel-${name}`);
      const library = document.querySelector('#library-settings');
      const preview = document.querySelector('#preview-controls');
      const stage = panel.querySelector('.stage-shell');
      const marker = document.querySelector('#marker-config');
      return {
        libraryInPanel: panel.contains(library),
        previewInPanel: panel.contains(preview),
        libraryBeforeOutput: Boolean(library.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING),
        previewAfterOutput: Boolean(stage.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING),
        markerInPreview: preview.contains(marker),
        overflowInPreview: preview.contains(document.querySelector('#overflow')),
        actionsInPreview: ['pause', 'reset', 'defaults', 'clear-drawing'].every((id) => preview.contains(document.querySelector(`#${id}`))),
      };
    }, renderer);
    assert.equal(placement.libraryInPanel, true);
    assert.equal(placement.previewInPanel, true);
    assert.equal(placement.libraryBeforeOutput, true, `${renderer} library settings precede the output`);
    assert.equal(placement.previewAfterOutput, true, `${renderer} preview controls follow the output`);
    assert.equal(placement.markerInPreview, renderer === 'dom' || renderer === 'svg');
    assert.equal(placement.overflowInPreview, true);
    assert.equal(placement.actionsInPreview, true);
    assert.equal(await page.locator('#host-viewport-config').isVisible(), renderer === 'dom' || renderer === 'svg');
    assert.equal(await page.locator('#history-config').isVisible(), renderer !== 'dom');
    assert.equal(await page.locator('#webgl-shape').isVisible(), renderer === 'webgl');
    assert.equal(await page.locator('#webgl-view').isVisible(), renderer === 'webgl');
    assert.equal(await page.locator('#webgl-accumulate').isVisible(), renderer === 'webgl');
    assert.equal(await page.locator('#webgl-paint').isVisible(), renderer === 'webgl');
    assert.equal(await page.locator('#clear-drawing').isVisible(), renderer === 'webgl');
    assert.equal(await page.locator('#camera-config').isVisible(), false, 'Ellipse has no spatial camera settings');
    assert.equal(await page.locator('#shading-config').isVisible(), false, 'Planar motion has no lighting settings');
    assert.equal(await page.locator('#show-path').isVisible(), renderer === 'canvas' || renderer === 'svg');
  }
  await switchRenderer('webgl');
  await page.selectOption('#motion', 'helix');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial', 'Selecting a supported motion defaults to spatial coordinates');
  assert.equal(await page.locator('#camera-config').isVisible(), true);
  assert.equal(await page.locator('#shading-config').isVisible(), true);
  await page.selectOption('#webgl-view', 'planar');
  assert.equal(await page.locator('#camera-config').isVisible(), false);
  assert.equal(await page.locator('#shading-config').isVisible(), false);
  await page.locator('#zoom').fill('1.5');
  await page.locator('#parameter-controls [data-parameter="turns"]').fill('5');
  await page.locator('#parameter-controls [data-parameter="turns"]').press('Tab');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'planar', 'Framing and parameter changes retain an explicitly selected planar view');
  await page.locator('#zoom').fill('1');
  await page.locator('#custom-bounds').check();
  await page.locator('#min-x').fill('');
  await switchRenderer('canvas');
  await assertActiveRenderer('webgl');
  assert.equal(await page.locator('#webgl-view').isVisible(), true, 'A failed switch retains the current renderer controls');
  assert.match(await page.locator('#status').textContent(), /Custom bounds require/);
  await page.locator('#min-x').fill('-1');
  await page.locator('#min-x').press('Tab');
  await switchRenderer('canvas');
  await assertActiveRenderer('canvas');
  await page.locator('#custom-bounds').uncheck();
  await page.selectOption('#motion', 'lorenz');
  assert.equal(await page.locator('#show-path').isVisible(), false, 'Integrated motions have no full-path control');
  await page.selectOption('#fit', 'contain');
  await page.click('#pause');
  await switchRenderer('svg');
  assert.equal(await page.locator('#motion').inputValue(), 'lorenz', 'Renderer changes retain the motion');
  assert.equal(await page.locator('#fit').inputValue(), 'contain', 'Renderer changes retain shared configuration');
  assert.equal(await page.locator('#pause').textContent(), 'Resume', 'Renderer changes preserve manual pause');
  await switchRenderer('webgl');
  assert.equal(await page.locator('#motion').inputValue(), 'lorenz');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial', 'Entering WebGL selects spatial coordinates for the retained supported motion');
  await page.click('#defaults');

  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'The playground fits a narrow viewport');
  for (const renderer of rendererOrder) {
    await switchRenderer(renderer);
    await assertActiveRenderer(renderer);
    await assertMotionMenu(renderer, true);
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.click('#defaults');

  const noWebGL = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await noWebGL.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl' ? null : getContext.call(this, type, ...args);
    };
  });
  await noWebGL.goto(origin);
  await noWebGL.locator('#status').waitFor();
  assert.match(await noWebGL.locator('#status').textContent(), /WebGL rendering context/);
  await noWebGL.locator('#custom-bounds').check();
  await noWebGL.locator('#min-x').fill('');
  await noWebGL.locator('#tab-canvas').click();
  assert.equal(await noWebGL.locator('#tab-webgl').getAttribute('aria-selected'), 'true', 'Invalid switches roll back even without an existing controller');
  await noWebGL.locator('#min-x').fill('-1');
  await noWebGL.locator('#min-x').press('Tab');
  await noWebGL.locator('#tab-canvas').click();
  assert.equal(await noWebGL.locator('#tab-canvas').getAttribute('aria-selected'), 'true', 'Corrected settings allow switching away from unsupported WebGL');
  assert.equal(await noWebGL.locator('#panel-canvas').isVisible(), true);
  await noWebGL.close();

  // Every public factory option, including inherited numerical options, is exposed.
  await page.evaluate(() => {
    document.querySelector('#defaults').click();
    document.querySelector('#pause').click();
  });
  const changeMotionParameter = (key, value) => page.evaluate(({ key, value }) => {
    const control = document.querySelector(`#parameter-controls [data-parameter="${key}"]`);
    control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return { value: control.value, status: document.querySelector('#status').textContent };
  }, { key, value });
  const controlDefaults = new Map();
  for (const renderer of rendererOrder) {
    await switchRenderer(renderer);
    for (const motion of Object.keys(motionInterfaces)) {
      await page.selectOption('#motion', motion);
      const controls = await page.locator('#parameter-controls [data-parameter]').evaluateAll((elements) => elements.map((element) => ({
        key: element.dataset.parameter, tag: element.tagName, value: element.value,
        enabled: !element.disabled,
        visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
      })).sort((a, b) => a.key.localeCompare(b.key)));
      assert.deepEqual(controls.map(({ key, tag }) => ({ key, tag })), publicMotionControls[motion], `${motion} ${renderer} exposes each public option exactly once`);
      assert.ok(controls.every(({ enabled, visible }) => enabled && visible), `${motion} ${renderer} public controls are visible and enabled`);
      if (!controlDefaults.has(motion)) controlDefaults.set(motion, controls.map(({ key, value }) => ({ key, value })));
      else assert.deepEqual(controls.map(({ key, value }) => ({ key, value })), controlDefaults.get(motion), `${motion} defaults are shared across renderer tabs`);
    }
  }
  const acceptedParameters = {
    ellipse: { periodSeconds: 0.5, radiusX: 0.05, radiusY: 0.075 },
    rose: { periodSeconds: 0.5 },
    helix: { periodSeconds: 0.5, turns: 0.5, fadeFraction: 0.007 },
    lissajous: { periodSeconds: 0.5, cyclesX: 21, cyclesY: 22, cyclesZ: 23 },
    'vander-pol': { mu: -0.5, timeScale: 0.005, runawayLimit: 0.5 },
    duffing: { damping: -0.2, forcing: -0.1, angularFrequency: -1, timeScale: 0.005, runawayLimit: 0.75 },
    lorenz: { sigma: 0, rho: -1, beta: 0, timeScale: 0.005, runawayLimit: 0.9 },
  };
  for (const [motion, parameters] of Object.entries(acceptedParameters)) {
    await page.selectOption('#motion', motion);
    for (const [key, value] of Object.entries(parameters)) {
      const result = await changeMotionParameter(key, value);
      assert.equal(result.value, String(value), `${motion} ${key} accepts the API-valid value ${value}`);
      assert.match(result.status, /; contain at/, `${motion} ${key} mounts its accepted configuration`);
    }
  }
  for (const renderer of rendererOrder) {
    await switchRenderer(renderer);
    for (const [motion, parameters] of Object.entries(acceptedParameters)) {
      await page.selectOption('#motion', motion);
      for (const [key, value] of Object.entries(parameters)) assert.equal(await page.locator(`#parameter-controls [data-parameter="${key}"]`).inputValue(), String(value), `${motion} ${key} survives motion and renderer switching`);
    }
  }
  await page.selectOption('#motion', 'ellipse');
  const retainedPeriod = await page.locator('#parameter-controls [data-parameter="periodSeconds"]').inputValue();
  const beforeNumericMountFailure = await page.locator('#svg-marker').getAttribute('transform');
  await page.evaluate(() => {
    const control = document.querySelector('#depth-strength');
    control.value = '-1';
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const failedNumericMount = await changeMotionParameter('periodSeconds', 0.75);
  assert.equal(failedNumericMount.value, retainedPeriod, 'A numeric option rolls back when another control blocks remounting');
  assert.match(failedNumericMount.status, /finite and nonnegative/i);
  assert.equal(await page.locator('#svg-marker').getAttribute('transform'), beforeNumericMountFailure, 'Failed numeric remount preserves the paused rendered source');
  await page.evaluate(() => {
    const control = document.querySelector('#depth-strength');
    control.value = '1';
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#parameter-controls [data-parameter="periodSeconds"]').inputValue(), retainedPeriod);
  assert.match((await changeMotionParameter('periodSeconds', 0.75)).status, /; contain at/, 'Corrected shared settings permit the next valid numeric change');
  for (const [motion, key, invalid] of [
    ['ellipse', 'periodSeconds', 0], ['ellipse', 'radiusX', 0],
    ['helix', 'turns', 0], ['helix', 'fadeFraction', 0], ['helix', 'fadeFraction', 0.5],
    ['duffing', 'timeScale', 0], ['duffing', 'runawayLimit', 0],
    ['lissajous', 'cyclesX', 1.5], ['lorenz', 'rho', ''],
  ]) {
    await page.selectOption('#motion', motion);
    const control = page.locator(`#parameter-controls [data-parameter="${key}"]`);
    const previous = await control.inputValue();
    const result = await changeMotionParameter(key, invalid);
    assert.equal(result.value, previous, `${motion} ${key} rejects ${invalid} and restores the committed value`);
    assert.doesNotMatch(result.status, /; contain at/, 'Rejected numeric input reports an error');
    const corrected = await changeMotionParameter(key, previous);
    assert.match(corrected.status, /; contain at/, 'A valid correction clears the numeric error');
  }
  await page.click('#defaults');
  await page.click('#pause');
  for (const [motion, defaults] of controlDefaults) {
    await page.selectOption('#motion', motion);
    const values = await page.locator('#parameter-controls [data-parameter]').evaluateAll((elements) => elements.map((element) => ({ key: element.dataset.parameter, value: element.value })).sort((a, b) => a.key.localeCompare(b.key)));
    assert.deepEqual(values, defaults, `${motion} Defaults restores every public option`);
  }
  for (const motion of ['vander-pol', 'duffing', 'lorenz']) {
    await page.selectOption('#motion', motion);
    assert.equal(await page.getByRole('spinbutton', { name: 'Runaway state limit', exact: true }).inputValue(), '1000000');
  }
  // A low state limit causes Duffing to reseed on each step; restoring the
  // normal limit resumes evolution, demonstrating the example factory wiring.
  await switchRenderer('dom');
  await page.selectOption('#motion', 'duffing');
  await changeMotionParameter('runawayLimit', 0.1);
  await page.locator('#dom-stage').scrollIntoViewIfNeeded();
  const sampleDuffing = () => page.evaluate(() => new Promise((resolveSamples) => {
    const transforms = [];
    const start = performance.now();
    document.querySelector('#pause').click();
    const sample = (timestamp) => {
      transforms.push(document.querySelector('#dom-marker').style.transform);
      if (timestamp - start < 250) requestAnimationFrame(sample);
      else {
        document.querySelector('#pause').click();
        resolveSamples(transforms);
      }
    };
    requestAnimationFrame(sample);
  }));
  const limitedDuffing = await sampleDuffing();
  assert.ok(limitedDuffing.length > 2);
  assert.equal(new Set(limitedDuffing).size, 1, 'The example passes runawayLimit to Duffing and repeatedly reseeds above the limit');
  await changeMotionParameter('runawayLimit', 1000000);
  const evolvingDuffing = await sampleDuffing();
  assert.ok(new Set(evolvingDuffing).size > 2, 'Restoring the normal runaway limit allows actual DOM motion to evolve');
  await page.click('#defaults');

  const initial = await page.evaluate(() => ({
    bitmap: [document.querySelector('#canvas-stage').width, document.querySelector('#canvas-stage').height],
    webglBitmap: [document.querySelector('#webgl-stage').width, document.querySelector('#webgl-stage').height],
    viewBox: document.querySelector('#svg-stage').getAttribute('viewBox'),
    stage: document.querySelector('.renderer-panel:not([hidden]) .stage-shell').getBoundingClientRect().toJSON(),
  }));

  for (const renderer of ['canvas', 'dom', 'svg', 'webgl']) {
    await switchRenderer(renderer);
    const visibility = await page.evaluate(() => Object.fromEntries(
      ['canvas', 'dom', 'svg', 'webgl'].map((name) => [name, getComputedStyle(document.querySelector(`#${name}-stage`)).display !== 'none']),
    ));
    assert.deepEqual(visibility, Object.fromEntries(['canvas', 'dom', 'svg', 'webgl'].map((name) => [name, name === renderer])));
    for (const motion of ['ellipse', 'rose', 'lissajous', 'helix', 'vander-pol', 'duffing', 'lorenz']) {
      await page.selectOption('#motion', motion);
      assert.match(await page.locator('#status').textContent(), /; contain at/);
      if (renderer === 'webgl') assert.equal(await page.locator('#webgl-view').inputValue(), ['helix', 'lissajous', 'lorenz', 'duffing'].includes(motion) ? 'spatial' : 'planar', `${motion} chooses its supported default coordinate view`);
    }
  }
  await switchRenderer('svg');
  for (const fit of ['cover', 'contain', 'stretch']) {
    await page.selectOption('#fit', fit);
    await page.locator('#zoom').fill('1.5');
    assert.match(await page.locator('#status').textContent(), new RegExp(`; ${fit} at`));
  }

  await page.locator('#offset-x').fill('0.5');
  await page.locator('#offset-y').fill('-0.25');
  assert.match(await page.locator('#status').textContent(), /position 50%\/-25%/);
  await page.selectOption('#overflow', 'visible');
  assert.equal(await page.locator('.renderer-panel:not([hidden]) .stage-shell').evaluate((element) => getComputedStyle(element).overflow), 'visible');
  await switchRenderer('canvas');
  assert.equal(await page.locator('#overflow').isDisabled(), true);
  await page.selectOption('#motion', 'ellipse');
  await page.locator('#show-trail').check();
  await page.locator('#show-path').check();
  await switchRenderer('svg');
  assert.ok((await page.locator('#svg-full-path').getAttribute('d'))?.startsWith('M'));
  await page.locator('.renderer-panel:not([hidden]) .stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  assert.ok((await page.locator('#svg-trail').getAttribute('d'))?.startsWith('M'));
  assert.equal(await page.locator('#trail-length').isDisabled(), false);
  await page.locator('#trail-length').fill('3');
  await page.locator('#trail-length').press('Tab');
  await page.waitForTimeout(100);
  assert.equal(((await page.locator('#svg-trail').getAttribute('d'))?.match(/[ML]/g) ?? []).length, 3, 'Configured SVG tail length limits retained points');
  await switchRenderer('canvas');
  assert.equal(await page.locator('#trail-length').isDisabled(), false);
  assert.equal(await page.locator('#trail-length').inputValue(), '3', 'Configured length is shared across renderers');
  await switchRenderer('dom');
  assert.equal(await page.locator('#show-trail').isDisabled(), true);
  assert.equal(await page.locator('#trail-length').isDisabled(), true);
  await switchRenderer('svg');
  await page.locator('#parameter-controls [data-parameter="radiusX"]').fill('1.5');
  await page.locator('#parameter-controls [data-parameter="radiusX"]').press('Tab');
  await page.selectOption('#motion', 'lorenz');
  assert.equal(await page.locator('#show-path').isDisabled(), true);
  await page.locator('#custom-bounds').check();
  await page.locator('#min-x').fill('-2');
  await page.locator('#min-x').press('Tab');
  await page.click('#defaults');
  assert.equal(await page.locator('#show-trail').isChecked(), false);
  assert.equal(await page.locator('#trail-length').inputValue(), '128');
  assert.equal(await page.locator('#custom-bounds').isChecked(), false);

  await page.selectOption('#motion', 'ellipse');
  await page.locator('#parameter-controls [data-parameter="periodSeconds"]').fill('1');
  await page.locator('#parameter-controls [data-parameter="periodSeconds"]').press('Tab');
  await page.locator('#marker-size').fill('24');
  await page.selectOption('#fit', 'contain');
  for (const renderer of ['dom', 'svg']) {
    await switchRenderer(renderer);
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
  await switchRenderer('canvas');
  await page.locator('.renderer-panel:not([hidden]) .stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  const firstCanvasFrame = await page.locator('#canvas-stage').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#canvas-stage').evaluate((canvas) => canvas.toDataURL()), firstCanvasFrame);
  await switchRenderer('dom');
  await page.locator('.renderer-panel:not([hidden]) .stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  const firstDomFrame = await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform), firstDomFrame);
  await switchRenderer('svg');
  await page.locator('.renderer-panel:not([hidden]) .stage-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  const firstSvgFrame = await page.locator('#svg-marker').getAttribute('transform');
  await page.waitForTimeout(140);
  assert.notEqual(await page.locator('#svg-marker').getAttribute('transform'), firstSvgFrame);
  await page.click('#defaults');

  await switchRenderer('dom');
  await page.selectOption('#motion', 'ellipse');
  await page.locator('.renderer-panel:not([hidden]) .stage-shell').scrollIntoViewIfNeeded();
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

  // Direction controls preserve paused state and use the native motion coordinates.
  await page.evaluate(() => {
    document.querySelector('#defaults').click();
    document.querySelector('#pause').click();
  });
  await switchRenderer('dom');
  await page.selectOption('#motion', 'helix');
  const directionSnapshot = () => page.evaluate(() => ({
    transform: document.querySelector('#dom-marker').style.transform,
    bounds: ['min-x', 'max-x', 'min-y', 'max-y'].map((id) => document.getElementById(id).value),
  }));
  const beforeRejectedDirection = await directionSnapshot();
  for (const invalidStrength of [-1, '']) {
    await webglChange('#depth-strength', invalidStrength);
    for (const [label, attempted, committed] of [
      ['Flow direction', 'left-to-right', 'top-to-bottom'],
      ['Rotation direction', 'clockwise', 'counter-clockwise'],
    ]) {
      await page.getByRole('combobox', { name: label, exact: true }).selectOption(attempted);
      assert.equal(await page.getByRole('combobox', { name: label, exact: true }).inputValue(), committed, 'Rejected direction change restores its committed choice');
      assert.deepEqual(await directionSnapshot(), beforeRejectedDirection, 'Rejected direction change preserves native position and bounds');
      assert.match(await page.locator('#status').textContent(), /finite and nonnegative/i);
    }
    await webglChange('#depth-strength', 1);
    assert.deepEqual(await directionSnapshot(), beforeRejectedDirection, 'Correcting shared settings keeps the original flow');
  }
  await page.getByRole('combobox', { name: 'Rotation direction', exact: true }).selectOption('clockwise');
  for (const flow of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
    await page.getByRole('combobox', { name: 'Flow direction', exact: true }).selectOption(flow);
    assert.equal(await page.locator('#pause').textContent(), 'Resume', 'Direction changes retain manual pause');
    const seed = await page.evaluate(() => {
      const stage = document.querySelector('#dom-stage').getBoundingClientRect();
      const marker = document.querySelector('#dom-marker').getBoundingClientRect();
      return {
        x: (marker.left + marker.right - stage.left - stage.right) / 2,
        y: (marker.top + marker.bottom - stage.top - stage.bottom) / 2,
        bounds: ['min-x', 'max-x', 'min-y', 'max-y'].map((id) => Number(document.getElementById(id).value)),
      };
    });
    const horizontal = flow === 'left-to-right' || flow === 'right-to-left';
    assert.deepEqual(seed.bounds, horizontal ? [0, 2, -1, 1] : [-1, 1, 0, 2], `${flow} exposes matching native bounds`);
    const axisPosition = horizontal ? seed.x : seed.y;
    const forward = flow === 'top-to-bottom' || flow === 'left-to-right';
    assert.ok(forward ? axisPosition < -1 : axisPosition > 1, `${flow} starts at its named edge`);
  }
  await page.selectOption('#motion', 'ellipse');
  await switchRenderer('svg');
  await page.selectOption('#motion', 'helix');
  assert.equal(await page.getByRole('combobox', { name: 'Rotation direction', exact: true }).inputValue(), 'clockwise');
  assert.equal(await page.getByRole('combobox', { name: 'Flow direction', exact: true }).inputValue(), 'right-to-left', 'Direction choices survive motion and renderer switches');
  await switchRenderer('webgl');
  await webglChange('#webgl-camera', 'front');
  await webglChange('#show-trail', true);
  await webglChange('#trail-length', 0);
  await page.locator('#webgl-stage').focus();
  await page.keyboard.press('ArrowRight');
  const rejectedDirectionScene = await webglReadout();
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'custom');
  await page.getByRole('combobox', { name: 'Flow direction', exact: true }).selectOption('top-to-bottom');
  assert.equal(await page.getByRole('combobox', { name: 'Flow direction', exact: true }).inputValue(), 'right-to-left');
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'custom', 'Rejected flow change preserves the dragged camera');
  assert.deepEqual(await webglReadout(), rejectedDirectionScene, 'Invalid trail length keeps the old paused scene');
  assert.match(await page.locator('#status').textContent(), /positive safe integer/);
  await webglChange('#trail-length', 128);
  assert.equal(await page.getByRole('combobox', { name: 'Flow direction', exact: true }).inputValue(), 'right-to-left', 'Correcting a trail limit retains the committed flow');
  await webglChange('#show-trail', false);
  for (const flow of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
    await page.getByRole('combobox', { name: 'Flow direction', exact: true }).selectOption(flow);
    const first = await animateWebGLFor(0.4);
    const second = await animateWebGLFor(0.4);
    assert.ok(first.center && second.center, `${flow} paints its front view`);
    const horizontal = flow === 'left-to-right' || flow === 'right-to-left';
    const delta = second.center[horizontal ? 0 : 1] - first.center[horizontal ? 0 : 1];
    // readPixels uses bottom-to-top rows, opposite CSS screen Y.
    const positive = flow === 'left-to-right' || flow === 'bottom-to-top';
    assert.ok(positive ? delta > 1 : delta < -1, `${flow} front view progresses in the selected screen direction`);
  }
  await page.getByRole('combobox', { name: 'Rotation direction', exact: true }).selectOption('counter-clockwise');
  await animateWebGLFor(0.4);
  const counterClockwiseSize = (await webglReadout()).size;
  await page.getByRole('combobox', { name: 'Rotation direction', exact: true }).selectOption('clockwise');
  await animateWebGLFor(0.4);
  const clockwiseSize = (await webglReadout()).size;
  assert.ok(counterClockwiseSize - clockwiseSize > 0.4, 'Reversed rotation mirrors the depth cue at the same early phase');
  assert.ok(Math.abs(counterClockwiseSize + clockwiseSize - 1.25) < 0.05, 'Opposite rotation cues mirror around the native .625 midpoint');
  await page.click('#defaults');
  await assertHelixDirectionDefaults();

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
        document.querySelector(`#tab-${renderer}`).click();
        if (renderer === 'webgl') change('#webgl-view', 'planar');
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

  // Shared presentation changes redraw the same paused frame on every renderer.
  const changeMarkerScale = (id, value) => webglChange(`#${id}`, value);
  const assertMarkerScale = async (renderer, scale) => {
    const marker = await page.locator(renderer === 'dom' ? '#dom-marker' : '#svg-marker circle').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const svg = element.ownerSVGElement;
      const transform = svg ? element.parentElement.getAttribute('transform') : element.style.transform;
      const scale = Number(transform.match(/scale\(([^)]+)\)/)[1]);
      if (!svg) return { extents: [rect.width, rect.height], pixelScales: [1, 1], scale };
      // SVG meet mapping uses the fractional viewport; radius uses clientWidth.
      const coordinatesPerPixel = svg.viewBox.baseVal.width / svg.clientWidth;
      const mapping = svg.getScreenCTM();
      return {
        extents: [rect.width, rect.height],
        pixelScales: [Math.hypot(mapping.a, mapping.b), Math.hypot(mapping.c, mapping.d)].map((value) => value * coordinatesPerPixel),
        scale,
      };
    });
    assert.ok(Math.abs(marker.scale - scale) < 1e-12, `${renderer} receives exact shared marker scale ${scale}`);
    for (const [axis, extent] of marker.extents.entries()) {
      const expected = 48 * scale * marker.pixelScales[axis];
      assert.ok(Math.abs(extent - expected) < 0.05, `${renderer} marker extent should map to ${expected}, got ${extent}`);
    }
    assert.equal(await page.locator('#pause').textContent(), 'Resume', 'Live marker changes preserve manual pause');
  };
  const assertContainedMarker = async (renderer) => {
    const contained = await page.evaluate((renderer) => {
      const marker = document.querySelector(renderer === 'dom' ? '#dom-marker' : '#svg-marker circle').getBoundingClientRect();
      const stage = document.querySelector(`#${renderer}-stage`).getBoundingClientRect();
      return marker.left >= stage.left - 0.05 && marker.right <= stage.right + 0.05
        && marker.top >= stage.top - 0.05 && marker.bottom <= stage.bottom + 0.05;
    }, renderer);
    assert.equal(contained, true, `${renderer} contain framing reserves the effective marker radius`);
  };
  await page.selectOption('#motion', 'lorenz');
  await switchRenderer('dom');
  for (const [id, label, value] of [
    ['depth-strength', 'Depth strength', '1'],
    ['min-marker-scale', 'Minimum marker scale', '0.25'],
    ['max-marker-scale', 'Maximum marker scale', '1'],
  ]) {
    assert.equal(await page.getByRole('spinbutton', { name: label, exact: true }).inputValue(), value);
    assert.equal(await page.locator(`#${id}`).getAttribute('min'), '0');
    assert.equal(await page.locator(`#${id}`).getAttribute('step'), 'any');
  }
  assert.equal(await page.locator('#clamp-marker-scale').isChecked(), false);
  assert.equal(await page.locator('#min-marker-scale').isDisabled(), true);
  assert.equal(await page.locator('#max-marker-scale').isDisabled(), true);
  assert.equal(await page.locator('#parameter-controls [data-parameter="depthStrength"]').count(), 0);
  await webglChange('#parameter-controls [data-parameter="initialX"]', 20);
  await assertMarkerScale('dom', 0.875);
  await changeMarkerScale('depth-strength', 0);
  await assertMarkerScale('dom', 1);
  await changeMarkerScale('depth-strength', 0.5);
  await assertMarkerScale('dom', 0.9375);
  await page.selectOption('#motion', 'ellipse');
  await assertMarkerScale('dom', 1.25);
  await changeMarkerScale('depth-strength', 1);
  await assertMarkerScale('dom', 1.5);
  await changeMarkerScale('depth-strength', 3);
  await assertMarkerScale('dom', 2.5);
  await assertContainedMarker('dom');
  await changeMarkerScale('depth-strength', 1);
  await changeMarkerScale('clamp-marker-scale', true);
  await assertMarkerScale('dom', 1);
  assert.equal(await page.locator('#min-marker-scale').isDisabled(), false);
  await changeMarkerScale('max-marker-scale', 2);
  await changeMarkerScale('min-marker-scale', 0.5);
  await assertMarkerScale('dom', 1.5);
  await changeMarkerScale('depth-strength', 3);
  await assertMarkerScale('dom', 2);
  await switchRenderer('svg');
  await assertMarkerScale('svg', 2);
  await switchRenderer('canvas');
  const canvasScaleSize = await page.evaluate(() => {
    const control = document.querySelector('#depth-strength');
    control.value = '0';
    control.dispatchEvent(new Event('change', { bubbles: true }));
    const canvas = document.querySelector('#canvas-stage');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width, maxX = -1, minY = canvas.height, maxY = -1;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (!pixels[offset + 3]) continue;
      const x = (offset / 4) % canvas.width, y = Math.floor(offset / 4 / canvas.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const rect = canvas.getBoundingClientRect();
    return [(maxX - minX + 1) * rect.width / canvas.width, (maxY - minY + 1) * rect.height / canvas.height];
  });
  assert.ok(canvasScaleSize.every((extent) => Math.abs(extent - 48) < 2), 'Canvas live strength zero uses the base marker radius');
  await switchRenderer('svg');
  await changeMarkerScale('min-marker-scale', 2);
  await changeMarkerScale('depth-strength', 0);
  await assertMarkerScale('svg', 2);

  const invalidScaleTransform = await page.locator('#svg-marker').getAttribute('transform');
  for (const [id, value, message] of [
    ['max-marker-scale', 1, /minimum.*maximum/i],
    ['max-marker-scale', -1, /finite and nonnegative/i],
    ['max-marker-scale', '1e309', /finite and nonnegative/i],
  ]) {
    await changeMarkerScale(id, value);
    assert.match(await page.locator('#status').textContent(), message);
    assert.equal(await page.locator('#svg-marker').getAttribute('transform'), invalidScaleTransform, 'Invalid scale leaves the current frame unchanged');
  }
  // A failed renderer switch validates before disposing the current animation.
  await switchRenderer('canvas');
  await assertActiveRenderer('svg');
  await changeMarkerScale('max-marker-scale', 2);
  await assertMarkerScale('svg', 2);
  assert.match(await page.locator('#status').textContent(), /; contain at/, 'A valid correction clears the error');
  for (const invalidStrength of [-1, '']) {
    await changeMarkerScale('depth-strength', invalidStrength);
    const beforeMotionSwitch = await page.locator('#svg-marker').getAttribute('transform');
    await page.selectOption('#motion', 'rose');
    assert.equal(await page.locator('#motion').inputValue(), 'ellipse', 'Invalid strength rolls back a no-cue motion switch');
    assert.equal(await page.locator('#depth-strength').isDisabled(), false, 'Rejected switch leaves strength editable');
    assert.equal(await page.locator('#parameter-controls [data-parameter="radiusX"]').count(), 1, 'Rejected switch preserves the mounted motion parameters');
    assert.equal(await page.locator('#svg-marker').getAttribute('transform'), beforeMotionSwitch, 'Rejected switch preserves the current animation');
    assert.match(await page.locator('#status').textContent(), /finite and nonnegative/i);
    await changeMarkerScale('depth-strength', 0.8);
  }
  await changeMarkerScale('min-marker-scale', '');
  assert.match(await page.locator('#status').textContent(), /finite and nonnegative/i);
  await changeMarkerScale('depth-strength', 0.8);
  await changeMarkerScale('min-marker-scale', 0.5);
  await assertMarkerScale('svg', 1.4);

  for (const motion of ['lissajous', 'helix', 'duffing', 'rose', 'vander-pol']) {
    await page.selectOption('#motion', motion);
    const noCue = ['rose', 'vander-pol'].includes(motion);
    assert.equal(await page.locator('#depth-strength').isDisabled(), noCue, `${motion} advertises whether strength has a depth cue`);
    assert.equal(await page.locator('#depth-strength').inputValue(), '0.8', 'Motion switches persist depth strength');
    await assertMarkerScale('svg', noCue ? 1 : 0.7);
  }
  // Clamps still apply to motions without a depth cue.
  await changeMarkerScale('max-marker-scale', 3);
  await changeMarkerScale('min-marker-scale', 3);
  await assertMarkerScale('svg', 3);
  await assertContainedMarker('svg');
  await page.selectOption('#motion', 'lorenz');
  await changeMarkerScale('min-marker-scale', 0.5);
  await changeMarkerScale('max-marker-scale', 2);
  await assertMarkerScale('svg', 0.9);
  await switchRenderer('webgl');
  assert.equal((await webglReadout()).size, 0.9);
  assert.equal(await page.locator('#clamp-marker-scale').isChecked(), true);
  assert.equal(await page.locator('#max-marker-scale').inputValue(), '2');
  await webglChange('#show-trail', true);
  await animateWebGLFor(0.4);
  const beforeLiveScale = await webglReadout();
  const withHistory = await changeMarkerScale('depth-strength', 0);
  assert.equal((await webglReadout()).time, beforeLiveScale.time, 'Live scale change preserves stateful motion time');
  assert.equal((await webglReadout()).size, 1, 'WebGL strength zero uses the base marker radius');
  const markerOnly = await webglClick('#reset');
  assert.ok(withHistory.count > markerOnly.count, 'Live scale change retains the existing WebGL trail');
  await page.click('#defaults');
  await page.click('#pause');
  for (const [id, value] of [['depth-strength', '1'], ['min-marker-scale', '0.25'], ['max-marker-scale', '1']]) {
    assert.equal(await page.locator(`#${id}`).inputValue(), value, 'Defaults reset shared marker scale values');
  }
  assert.equal(await page.locator('#clamp-marker-scale').isChecked(), false);
  assert.equal(await page.locator('#min-marker-scale').isDisabled(), true);
  assert.equal(await page.locator('#max-marker-scale').isDisabled(), true);
  assert.equal(await page.locator('#depth-strength').isDisabled(), false);
  await webglClick('#reset');
  assert.equal((await webglReadout()).size, 0.63, 'Default Helix sizing rounds its native .625 seed cue');
  assert.equal(await page.locator('#motion').inputValue(), 'helix');
  assert.equal(await page.locator('#fit').inputValue(), 'contain');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial');

  await page.selectOption('#motion', 'lissajous');
  await switchRenderer('dom');
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
  await page.selectOption('#motion', 'ellipse'); // Planar raster fixtures explicitly select their motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await switchRenderer('webgl');
  await page.evaluate(() => document.querySelector('#pause').click());
  assert.equal(await page.locator('#pause').textContent(), 'Resume');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('#show-trail').isDisabled(), false);
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
  assert.equal(await page.locator('#webgl-lighting').isDisabled(), true, 'Lighting control is available for the 3D view');
  await webglChange('#show-trail', true);
  assert.equal(await page.locator('#webgl-accumulate').isChecked(), false);
  assert.equal(await page.locator('#trail-length').isDisabled(), false);
  await webglChange('#trail-length', 16);
  const withTrail = await animateWebGLFor(0.25);
  const currentMarkerDiameter = 2 * 24 * (await webglReadout()).size;
  assert.ok(Math.max(...withTrail.size) > currentMarkerDiameter + 2, 'WebGL Show trail extends beyond the current marker footprint');
  const beforeInvalidLength = await webglReadout();
  for (const length of [0, '', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await webglChange('#trail-length', length);
    assert.match(await page.locator('#status').textContent(), /positive safe integer/, `Invalid tail length ${length} is rejected`);
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
    assert.match(await page.locator('#status').textContent(), /positive safe integer/);
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
  await page.waitForTimeout(100);
  assert.deepEqual(await webglReadout(), beforeClear, 'Clearing paused output must not restart animation');
  const resetRaster = await webglClick('#reset');
  assert.ok(resetRaster.count > 0 && resetRaster.count < accumulated.count, 'Reset discards accumulation and paints only the initial marker');
  assert.equal((await webglReadout()).time, 0);

  for (const motion of ['helix', 'lorenz', 'lissajous', 'duffing']) {
    await webglChange('#motion', motion);
    assert.equal(await page.locator('#pause').textContent(), 'Resume', 'Remount preserves manual pause');
    assert.equal(await page.locator('#webgl-view option[value="spatial"]').evaluate((option) => option.disabled), false);
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

  // Real pointer input exercises capture and browser touch behavior. Raster
  // reads happen in a listener after the app's pointermove, before compositing.
  await webglChange('#motion', 'lissajous');
  await webglChange('#webgl-view', 'spatial');
  await webglChange('#webgl-camera', 'front');
  await webglChange('#show-trail', true);
  await webglChange('#trail-length', 32);
  await webglChange('#parameter-controls [data-parameter="periodSeconds"]', 4);
  const orbitInitial = await animateWebGLFor(0.3);
  const orbitTime = await webglReadout();
  const orbitStage = page.locator('#webgl-stage');
  await orbitStage.scrollIntoViewIfNeeded();
  assert.equal(await orbitStage.evaluate((element) => getComputedStyle(element).touchAction), 'none');
  await page.evaluate(() => {
    const canvas = document.querySelector('#webgl-stage');
    window.orbitRasters = [];
    const record = () => window.orbitRasters.push(window.demoWebGLPixels());
    canvas.addEventListener('pointermove', record);
    window.stopOrbitRecording = () => canvas.removeEventListener('pointermove', record);
  });
  const box = await orbitStage.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  assert.equal(await orbitStage.getAttribute('data-dragging'), '');
  await page.mouse.move(start.x + 100, start.y + 60, { steps: 5 });
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'custom');
  const mouseOrbit = await page.evaluate(() => window.orbitRasters.at(-1));
  assert.ok(mouseOrbit.count > 0, 'Mouse orbit retains and reprojects the tail');
  assert.notEqual(mouseOrbit.hash, orbitInitial.hash, 'Mouse drag changes the actual 3D view');
  assert.equal((await webglReadout()).time, orbitTime.time, 'Orbit preserves motion time');
  assert.equal((await webglReadout()).pause, 'Resume', 'Orbit preserves manual pause');
  await page.mouse.move(box.x + box.width + 20, start.y, { steps: 2 });
  const outsideOrbit = await page.evaluate(() => window.orbitRasters.at(-1));
  assert.notEqual(outsideOrbit.hash, mouseOrbit.hash, 'Pointer capture continues orbiting outside the canvas');
  await page.mouse.up();
  assert.equal(await orbitStage.getAttribute('data-dragging'), null);
  const releasedView = await webglReadout();
  await page.mouse.move(start.x, start.y);
  assert.deepEqual(await webglReadout(), releasedView, 'Mouse hover after release does not rotate');
  await webglChange('#webgl-camera', 'front');
  const restoredFront = await webglChange('#marker-size', 24);
  assert.equal(restoredFront.hash, orbitInitial.hash, 'Selecting the preset restores the original view and retained tail');
  assert.equal((await webglReadout()).time, orbitTime.time);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.down({ button: 'right' });
  await page.mouse.up();
  await page.mouse.move(start.x + 30, start.y + 20);
  assert.equal(await orbitStage.getAttribute('data-dragging'), null, 'Releasing the primary button ends orbit even while another button is held');
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'front', 'Secondary mouse buttons cannot continue orbiting');
  await page.mouse.up({ button: 'right' });

  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touchPoint = (x, y) => ({ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(start.x, start.y)] });
  assert.equal(await orbitStage.getAttribute('data-dragging'), '');
  const scrollBeforeTouch = await page.evaluate(() => window.scrollY);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(start.x - 80, start.y + 50)] });
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'custom');
  const touchOrbit = await page.evaluate(() => window.orbitRasters.at(-1));
  assert.notEqual(touchOrbit.hash, orbitInitial.hash, 'Touch drag changes the actual 3D view');
  assert.equal(await page.evaluate(() => window.scrollY), scrollBeforeTouch, 'Touch orbit does not scroll the page');
  assert.equal((await webglReadout()).time, orbitTime.time);
  assert.equal((await webglReadout()).pause, 'Resume');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await orbitStage.getAttribute('data-dragging'), null, 'Touch cancellation releases drag state');
  const cancelledView = await webglReadout();
  await page.mouse.move(start.x + 30, start.y + 10);
  assert.deepEqual(await webglReadout(), cancelledView, 'Hover after touch cancellation does not rotate');
  await webglChange('#webgl-camera', 'front');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(start.x, start.y)] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(start.x + 50, start.y - 20)] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await orbitStage.getAttribute('data-dragging'), null, 'Touch release permits a new drag');
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await touch.detach();

  await webglChange('#webgl-camera', 'front');
  await orbitStage.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'custom', 'Keyboard arrows rotate the camera');
  assert.equal((await webglReadout()).time, orbitTime.time);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  assert.equal(await orbitStage.getAttribute('data-dragging'), '');
  await webglChange('#webgl-view', 'planar');
  assert.equal(await orbitStage.getAttribute('data-dragging'), null, 'Switching views mid-drag releases pointer capture');
  await page.mouse.up();
  assert.notEqual(await orbitStage.evaluate((element) => getComputedStyle(element).touchAction), 'none', 'Planar view retains normal touch scrolling');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30);
  await page.mouse.up();
  assert.equal(await orbitStage.getAttribute('data-dragging'), null, 'Planar view does not capture drags');
  await page.evaluate(() => window.stopOrbitRecording());
  await webglChange('#show-trail', false);

  await webglChange('#webgl-view', 'spatial');
  await webglChange('#webgl-camera', 'front');
  await webglChange('#webgl-accumulate', true);
  const orbitPaint = await animateWebGLFor(0.3);
  const paintTime = await webglReadout();
  await page.evaluate(() => {
    const canvas = document.querySelector('#webgl-stage');
    window.orbitRasters = [];
    const record = () => window.orbitRasters.push(window.demoWebGLPixels());
    canvas.addEventListener('pointermove', record);
    window.stopOrbitRecording = () => canvas.removeEventListener('pointermove', record);
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 60, { steps: 5 });
  await page.mouse.up();
  const orbitPaintAfter = await page.evaluate(() => window.orbitRasters.at(-1));
  assert.ok(orbitPaintAfter.count > 0, 'Dragging with accumulation redraws retained markers');
  assert.notEqual(orbitPaintAfter.hash, orbitPaint.hash, 'The accumulated 3D drawing rotates with the camera');
  const paintTimeAfter = await webglReadout();
  assert.equal(paintTimeAfter.time, paintTime.time, 'Accumulated orbit preserves motion time');
  assert.equal(paintTimeAfter.pause, paintTime.pause, 'Accumulated orbit preserves manual pause');
  const presetPaint = await webglChange('#webgl-camera', 'front');
  assert.equal(presetPaint.hash, orbitPaint.hash, 'Returning to the original camera restores the entire accumulated drawing');
  await page.evaluate(() => window.stopOrbitRecording());

  await webglChange('#webgl-shape', 'circle');
  await webglChange('#webgl-lighting', false);
  await webglChange('#webgl-paint', true);
  assert.equal(await page.locator('#webgl-accumulate').isChecked(), false);
  assert.equal(await page.locator('#show-trail').isChecked(), false);
  assert.equal(await page.locator('#accumulation-length').isDisabled(), false);
  const ribbonRaster = await animateWebGLFor(0.3);
  const ribbonTime = await webglReadout();
  const litRibbon = await webglChange('#webgl-lighting', true);
  assert.equal(litRibbon.count, ribbonRaster.count, 'Lighting preserves ribbon coverage and the size cue');
  assert.notEqual(litRibbon.hash, ribbonRaster.hash, 'Lighting shades the entire retained ribbon while paused');
  assert.deepEqual(await webglReadout(), ribbonTime, 'Lighting preserves motion time, size, depth, and pause');
  const flatRibbonAgain = await webglChange('#webgl-lighting', false);
  assert.equal(flatRibbonAgain.hash, ribbonRaster.hash, 'Switching back to flat restores the original painted base colors');
  const squareBrush = await webglChange('#webgl-shape', 'square');
  assert.equal(squareBrush.hash, ribbonRaster.hash, 'Paused shape changes leave deposited brush footprints unchanged');
  assert.equal((await webglReadout()).time, ribbonTime.time, 'Shape changes preserve the painting and motion time');
  const circleBrush = await webglChange('#webgl-shape', 'circle');
  assert.equal(circleBrush.hash, ribbonRaster.hash, 'Switching marker shape back leaves the same deposited paint');
  const obliqueRibbon = await webglChange('#webgl-camera', 'oblique');
  assert.ok(obliqueRibbon.count > 0, 'World-space ribbon redraws through an oblique camera');
  assert.notEqual(obliqueRibbon.hash, ribbonRaster.hash, 'Ribbon geometry rotates with the camera');
  assert.equal((await webglChange('#webgl-camera', 'front')).hash, ribbonRaster.hash, 'Returning to the original view restores the same ribbon');
  assert.equal((await webglReadout()).time, ribbonTime.time);
  await webglChange('#accumulation-length', 3);
  const cappedBrush = await page.evaluate(() => new Promise((resolvePaint, reject) => {
    const pause = document.querySelector('#pause');
    const observer = new MutationObserver(() => {
      if (pause.textContent !== 'Resume') return;
      observer.disconnect(); clearTimeout(timeout);
      resolvePaint(window.demoWebGLPixels());
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Brush did not pause at its paint limit')); }, 5000);
    observer.observe(pause, { childList: true, subtree: true, characterData: true });
    pause.click();
  }));
  assert.ok(cappedBrush.count > 0, 'The example retains painted geometry when the budget fills');
  assert.match(await page.locator('#status').textContent(), /Paint limit reached/);
  const stoppedBrush = await webglReadout();
  await page.locator('#pause').click();
  assert.deepEqual(await webglReadout(), stoppedBrush, 'Full brush cannot resume and overwrite its beginning');
  await webglChange('#accumulation-length', 0);
  await webglChange('#paint-limit-behavior', 'trim-oldest');
  assert.equal(await page.locator('#paint-limit-behavior').inputValue(), 'pause', 'Failed remount restores the applied limit policy');
  assert.deepEqual(await webglReadout(), stoppedBrush, 'Invalid remount preserves the paused paint controller');
  await page.locator('#pause').click();
  assert.deepEqual(await webglReadout(), stoppedBrush, 'Failed trim switch keeps the full-paint resume guard');
  await webglChange('#accumulation-length', 3);
  assert.equal((await webglClick('#clear-drawing')).count, 0, 'Clear removes the completed brush painting');
  assert.doesNotMatch(await page.locator('#status').textContent(), /Paint limit reached/);
  assert.equal(await page.locator('#paint-limit-behavior').isVisible(), true);
  assert.equal(await page.locator('#paint-limit-behavior').inputValue(), 'pause');
  await webglChange('#paint-limit-behavior', 'trim-oldest');
  const rollingBrush = await animateWebGLFor(0.25);
  assert.ok(rollingBrush.count > 0, 'Trim mode retains the most recent painted surface');
  assert.ok((await webglReadout()).time > 0.1, 'Trim mode keeps advancing beyond its three-sample budget');
  assert.doesNotMatch(await page.locator('#status').textContent(), /Paint limit reached/);
  const rollingTime = await webglReadout();
  await webglChange('#webgl-camera', 'oblique');
  assert.equal((await webglReadout()).time, rollingTime.time, 'Camera redraw does not age rolling paint');
  assert.equal((await webglChange('#webgl-camera', 'front')).hash, rollingBrush.hash, 'Camera round trip preserves rolling geometry');
  await animateWebGLFor(0.1);
  assert.ok((await webglReadout()).time > rollingTime.time, 'A full rolling brush can resume after a manual pause');
  await webglChange('#accumulation-length', 12000);
  await webglChange('#webgl-paint', false);
  assert.equal(await page.locator('#paint-limit-behavior').isVisible(), false);

  await webglChange('#motion', 'duffing');
  await webglChange('#webgl-view', 'spatial');
  await webglChange('#webgl-camera', 'front');

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
  assert.equal(await page.locator('#tab-webgl').getAttribute('aria-selected'), 'true');
  await assertMotionMenu('webgl', true);
  await assertHelixDirectionDefaults();
  assert.equal(await page.locator('#motion').inputValue(), 'helix');
  assert.equal(await page.locator('#fit').inputValue(), 'contain');
  assert.equal(await page.locator('#pause').textContent(), 'Pause');
  assert.equal(await page.locator('#webgl-view').inputValue(), 'spatial');
  assert.equal(await page.locator('#webgl-camera').inputValue(), 'oblique');
  assert.equal(await page.locator('#webgl-shape').inputValue(), 'circle');
  assert.equal(await page.locator('#webgl-paint').isChecked(), false);
  assert.equal(await page.locator('#webgl-lighting').isChecked(), false);
  assert.equal(await page.locator('#webgl-accumulate').isChecked(), false);
  assert.equal(await page.locator('#accumulation-length').inputValue(), '12000');
  assert.equal(await page.locator('#accumulation-length').isDisabled(), true);
  assert.equal(await page.locator('#clear-drawing').isDisabled(), false);

  const final = await page.evaluate(() => ({
    bitmap: [document.querySelector('#canvas-stage').width, document.querySelector('#canvas-stage').height],
    webglBitmap: [document.querySelector('#webgl-stage').width, document.querySelector('#webgl-stage').height],
    viewBox: document.querySelector('#svg-stage').getAttribute('viewBox'),
    stage: document.querySelector('.renderer-panel:not([hidden]) .stage-shell').getBoundingClientRect().toJSON(),
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
    if (document.elementFromPoint(svgX, svgY) !== dot) {
      const hit = document.elementFromPoint(svgX, svgY);
      throw new Error(`SVG visible overflow did not paint outside the viewport at ${svgX},${svgY}; hit ${hit?.tagName}#${hit?.id}; overflow ${getComputedStyle(svg).overflow}; rect ${JSON.stringify(rect.toJSON())}; viewport ${innerWidth}x${innerHeight}, visual ${visualViewport.width}x${visualViewport.height} scale ${visualViewport.scale}`);
    }
    svg.style.overflow = 'hidden';
    if (document.elementFromPoint(svgX, svgY) === dot) throw new Error('SVG clipped overflow remained visible');
    svgController.dispose();
    svg.remove();
  });

  await page.evaluate(async () => {
    const { createCanvasTrail } = await import('/lib/canvas/trail.js');
    const { createSvgTrail } = await import('/lib/svg/trail.js');
    for (const maxSamples of [3, 16]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 100;
      const context = canvas.getContext('2d');
      const canvasTrail = createCanvasTrail({ maxSamples, color: 'red', width: 4 });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.append(path);
      document.body.append(svg);
      const svgTrail = createSvgTrail({ viewport: svg, path, maxSamples });
      const makeFrame = (index) => {
        const pose = index === 0 ? { x: 20, y: 20 } : index === 1 ? { x: 20, y: 50 } : { x: 80, y: 50 };
        return { state: null, pose, position: pose, viewport: { width: 100, height: 100 }, elapsedSeconds: index,
          project: (point) => ({ ...point, scaleX: 1, scaleY: 1 }) };
      };
      const draw = (frame) => {
        context.clearRect(0, 0, 100, 100);
        canvasTrail(context, frame);
        svgTrail.render(frame);
      };
      try {
        for (let index = 0; index < 132; index++) draw(makeFrame(index));
        const rgba = [...context.getImageData(20, 35, 1, 1).data];
        const expected = [0, 0, 0, 0];
        if (rgba.some((value, channel) => value !== expected[channel])) throw new Error(`Canvas tail retained incorrect history with maxSamples=${maxSamples}: ${rgba}`);
        const commands = path.getAttribute('d').match(/[ML]/g).length;
        if (commands !== maxSamples) throw new Error(`SVG retained incorrect tail length with maxSamples=${maxSamples}: ${commands}`);
        draw(makeFrame(131));
        if (path.getAttribute('d').match(/[ML]/g).length !== commands) throw new Error('Paused SVG redraw aged history');
        canvasTrail.clear(); svgTrail.clear();
        draw(makeFrame(131));
        if (path.getAttribute('d').match(/[ML]/g).length !== 1) throw new Error('Clear failed to discard SVG history');
        if (context.getImageData(20, 35, 1, 1).data[3] !== 0) throw new Error('Clear failed to discard Canvas history');
      } finally { svgTrail.dispose(); svg.remove(); }
    }
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
    const { createHelixMotion } = await import('/lib/motions/helix.js');
    const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    const red = [255, 0, 0, 255];
    const green = [0, 255, 0, 255];
    const blank = [0, 0, 0, 0];
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const fixtures = [];
    const fixture = (samples, options = {}, motion) => {
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
      const source = motion ?? {
        kind: 'analytic', bounds, periodSeconds: 1,
        sample(elapsedSeconds) {
          sampledTime = elapsedSeconds;
          const sample = samples[index];
          return { state: sample, pose: { x: 0, y: 0, ...sample.pose } };
        },
        reset() { resets += 1; index = 0; },
      };
      if (options.withoutDerivatives) {
        const context = canvas.getContext('webgl', { alpha: true, depth: true, antialias: false });
        const getExtension = context.getExtension.bind(context);
        context.getExtension = (name) => name === 'OES_standard_derivatives' ? null : getExtension(name);
      }
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
      const step = (milliseconds = 16) => {
        time += milliseconds;
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
        rgba(x, y) {
          const rgba = new Uint8Array(4);
          const rect = canvas.getBoundingClientRect();
          gl.readPixels(Math.floor(x * canvas.width / rect.width), canvas.height - 1 - Math.floor(y * canvas.height / rect.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          check(gl.getError() === gl.NO_ERROR, 'Lighting pixel read produced a WebGL error');
          return [...rgba];
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
      for (const drawing of [
        { trail: { maxSamples: 12, width: 6 } },
        { paint: { maxSamples: 12, limitBehavior: 'pause' } },
        { paint: { maxSamples: 12, limitBehavior: 'trim-oldest' } },
      ]) {
        const label = drawing.trail ? 'Helix tail' : `Helix ${drawing.paint.limitBehavior} paint`;
        const helix = fixture([], { accumulate: false, ...drawing }, createHelixMotion({ periodSeconds: 0.18, turns: 1 }));
        helix.controller.resume();
        helix.step(0);
        for (let frame = 0; frame < 4; frame++) helix.step(40);
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
      }
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
      for (let redraw = 0; redraw < 4; redraw++) tail.controller.setFraming({ fit: 'stretch' });
      tail.pixel(50, 50, red, 'Paused redraws do not age the tail');
      tail.advance(3);
      tail.pixel(50, 50, blank, 'Tail remains bounded after ring buffer wraps');
      tail.pixel(80, 50, red, 'Latest segment survives ring buffer wrap');
      tail.canvas.width = tail.canvas.height = 200;
      await Promise.resolve();
      tail.pixel(80, 52, red, 'Bitmap resize retains tail with CSS pixel width');
      tail.pixel(80, 55, blank, 'High-resolution bitmap preserves tail width');
      let restoreTail = await lose(tail);
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

      const tailCamera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      for (const nearTail of [false, true]) {
        const lineZ = nearTail ? 2 : -2;
        const crossing = fixture([
          { pose: { x: -0.8, z: lineZ }, skip: true },
          { pose: { x: 0.8, z: lineZ }, skip: true },
          { pose: { x: 0, z: -lineZ }, marker: { color: [0, 1, 0] } },
        ], { accumulate: false, trail: { width: 6, color: [1, 0, 0] }, camera: tailCamera });
        crossing.advance(1); crossing.advance(2);
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

      for (const nearFirst of [false, true]) {
        const near = { visibilityDepth: 0.2, marker: { color: [0, 1, 0] } };
        const far = { visibilityDepth: 0.8 };
        const target = fixture(nearFirst ? [near, far] : [far, near]);
        target.advance(1);
        target.pixel(50, 50, green, `Near marker must win with nearFirst=${nearFirst}`);
        target.dispose();
      }

      const lightingCamera = { position: { x: 0, y: 0, z: 5 }, bounds, near: 1, far: 9 };
      const brightness = (pixel) => pixel[0] + pixel[1] + pixel[2];
      const whiteMarker = { color: [1, 1, 1] };
      const configured = fixture([{ marker: whiteMarker }], { camera: lightingCamera, lighting: true });
      const legacyPixel = configured.rgba(50, 50);
      configured.controller.setLighting({});
      check(configured.rgba(50, 50).every((value, channel) => value === legacyPixel[channel]), 'Empty lighting options retain exact boolean-default pixels');
      configured.controller.setLighting({ ambient: { color: [1, 0.5, 0.25], intensity: 0.25 },
        directional: { intensity: 0 }, specular: { intensity: 0 }, depthCue: { strength: 0 } });
      configured.pixel(50, 50, [64, 32, 16, 255], 'Ambient RGB and intensity control actual GPU output');
      configured.controller.setLighting({ ambient: { intensity: 0 },
        directional: { direction: [0, 0, 1], color: [1, 0, 0], intensity: 0.4 },
        specular: { intensity: 0 }, depthCue: { strength: 0 } });
      configured.pixel(50, 50, [102, 0, 0, 255], 'Directional color and intensity tint diffuse GPU shading');
      configured.controller.setLighting({ ambient: { intensity: 0 },
        directional: { direction: [0, 0, -1], intensity: 1 }, depthCue: { strength: 0 } });
      configured.pixel(50, 50, [0, 0, 0, 255], 'Opposite light/view halfway vector remains finite and produces no highlight');
      configured.dispose();

      const highlight = fixture([{ marker: { color: [0, 0, 0] } }], { camera: lightingCamera });
      const highlightOptions = { ambient: { intensity: 0 }, directional: { direction: [0, 0, 1], color: [0, 1, 0], intensity: 0.7 },
        specular: { intensity: 0.2, shininess: 16 }, depthCue: { strength: 0 } };
      highlight.controller.setLighting(highlightOptions);
      const fullHighlight = highlight.rgba(50, 50);
      check(fullHighlight[0] === 0 && fullHighlight[2] === 0 && fullHighlight[1] > 40, 'Specular highlight follows directional RGB on a black surface');
      highlight.controller.setLighting({ ...highlightOptions, directional: { ...highlightOptions.directional, intensity: 0.35 } });
      const halfHighlight = highlight.rgba(50, 50);
      check(Math.abs(fullHighlight[1] - 2 * halfHighlight[1]) <= 2, 'Specular highlight scales with directional intensity');
      highlight.controller.setLighting({ ...highlightOptions, directional: { ...highlightOptions.directional, intensity: 0 } });
      highlight.pixel(50, 50, [0, 0, 0, 255], 'Zero directional intensity removes specular light');
      const angledHighlight = { ...highlightOptions, directional: { ...highlightOptions.directional, direction: [0.8, 0, 0.6] },
        specular: { intensity: 0.5, shininess: 1 } };
      highlight.controller.setLighting(angledHighlight);
      const broadHighlight = highlight.rgba(50, 50);
      highlight.controller.setLighting({ ...angledHighlight, specular: { intensity: 0.5, shininess: 64 } });
      check(broadHighlight[1] > highlight.rgba(50, 50)[1] + 50, 'Shininess concentrates specular highlights at fixed light direction');
      highlight.dispose();

      const depthSettings = { ambient: { intensity: 0.5 }, directional: { intensity: 0 }, depthCue: { strength: 0 } };
      const customDepth = fixture([{ pose: { x: -0.5, z: 2 }, marker: whiteMarker }, { pose: { x: 0.5, z: -2 }, marker: whiteMarker }],
        { camera: lightingCamera, lighting: depthSettings });
      customDepth.advance(1);
      customDepth.pixel(25, 50, [128, 128, 128, 255], 'Zero depth cue preserves near ambient lighting');
      customDepth.pixel(75, 50, [128, 128, 128, 255], 'Zero depth cue preserves far ambient lighting');
      customDepth.controller.setLighting({ ...depthSettings, depthCue: { strength: 0.8 } });
      check(brightness(customDepth.rgba(25, 50)) > brightness(customDepth.rgba(75, 50)) + 100, 'Custom depth strength darkens distant retained geometry');
      customDepth.dispose();

      const anchored = fixture([{ marker: whiteMarker }], { camera: lightingCamera });
      const anchoredOptions = { ambient: { intensity: 0 }, directional: { direction: [0, 0, 1], intensity: 0.5, space: 'world' },
        specular: { intensity: 0 }, depthCue: { strength: 0 } };
      anchored.controller.setLighting(anchoredOptions);
      anchored.pixel(50, 50, [128, 128, 128, 255], 'World light illuminates a camera-facing marker');
      anchored.controller.setCamera({ ...lightingCamera, position: { x: 0, y: 0, z: -5 } });
      anchored.pixel(50, 50, [0, 0, 0, 255], 'Orbiting rotates world lighting into view coordinates');
      anchored.controller.setLighting({ ...anchoredOptions, directional: { ...anchoredOptions.directional, space: 'view' } });
      anchored.pixel(50, 50, [128, 128, 128, 255], 'View light remains attached to the orbiting camera');
      anchored.dispose();

      for (const mode of [{ accumulate: true }, { accumulate: false }, { accumulate: false, trail: { width: 8 } },
        { accumulate: false, paint: true }, { accumulate: false, paint: { maxSamples: 3, limitBehavior: 'trim-oldest' } }]) {
        const retainedLight = fixture([{ pose: { x: -0.5 }, marker: whiteMarker }, { pose: { x: 0.5 }, marker: whiteMarker }], { camera: lightingCamera, ...mode });
        retainedLight.advance(1);
        const elapsed = retainedLight.sampledTime;
        const settings = { ambient: { color: [0.2, 0.6, 1], intensity: 0.5 }, directional: { intensity: 0 }, depthCue: { strength: 0 } };
        retainedLight.controller.setLighting(settings);
        const beforeLoss = retainedLight.rgba(75, 50);
        retainedLight.pixel(75, 50, [26, 77, 128, 255], 'Structured lighting shades paused retained modes');
        let rejectedFraming = false;
        try { retainedLight.controller.setFraming({ zoom: Number.MIN_VALUE }); } catch (error) { rejectedFraming = error instanceof RangeError; }
        check(rejectedFraming, 'Subnormal framing zoom must be rejected');
        retainedLight.controller.setLighting(settings);
        retainedLight.pixel(75, 50, [26, 77, 128, 255], 'Lighting preserves the last valid GPU scene after rejected framing');
        const restoreRetainedLight = await lose(retainedLight);
        retainedLight.controller.setLighting({ ...settings, ambient: { color: [1, 0.4, 0.2], intensity: 0.5 } });
        await restoreRetainedLight();
        retainedLight.pixel(75, 50, [128, 51, 26, 255], 'Lighting changes during context loss survive GPU recovery');
        retainedLight.controller.setLighting(settings);
        check(retainedLight.rgba(75, 50).every((value, channel) => value === beforeLoss[channel]), 'Recovery restores custom lighting on retained geometry');
        check(retainedLight.sampledTime === elapsed && retainedLight.controller.isPaused() && retainedLight.scheduled === 0, 'Structured lighting and recovery preserve paused motion');
        retainedLight.controller.clear();
        retainedLight.controller.setLighting(settings);
        retainedLight.pixel(75, 50, blank, 'Lighting cannot repopulate cleared retained geometry');
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
      }

      for (const accumulate of [false, true]) {
        const scaledRecovery = fixture([{ pose: { depth: 2 }, marker: whiteMarker }], { accumulate });
        scaledRecovery.pixel(65, 50, [255, 255, 255, 255], 'Initial marker uses its depth scale');
        const restoreScale = await lose(scaledRecovery);
        scaledRecovery.controller.setMarkerScale({ depthStrength: 0 });
        await restoreScale();
        scaledRecovery.pixel(65, 50, blank, 'Marker scale setter during loss updates restored footprint');
        scaledRecovery.pixel(55, 50, [255, 255, 255, 255], 'Updated marker footprint still draws its initial center');
        scaledRecovery.dispose();
      }

      for (const withoutDerivatives of [false, true]) {
        for (const limitBehavior of ['pause', 'trim-oldest']) {
          const smooth = fixture([
            { pose: { x: -0.8, z: 1 }, marker: { color: [0.2, 0.6, 1], radius: 12 } },
            { pose: { x: 0, z: -1 }, marker: { color: [0.2, 0.6, 1], radius: 12 } },
            { pose: { x: 0.8, z: 1 }, marker: { color: [0.2, 0.6, 1], radius: 12 } },
          ], { camera: lightingCamera, accumulate: false, paint: { maxSamples: 3, limitBehavior }, lighting: true, withoutDerivatives });
          smooth.advance(1); smooth.advance(2);
          const row = Array.from({ length: 51 }, (_, index) => smooth.rgba(25 + index, 50));
          check(row.every((pixel) => pixel[3] === 255), 'Smooth ribbon keeps continuous coverage');
          const jumps = row.slice(1).map((pixel, index) => Math.max(...pixel.slice(0, 3).map((value, channel) => Math.abs(value - row[index][channel]))));
          check(Math.max(...jumps) <= 8, `Ribbon highlights interpolate through the segment join (${limitBehavior}, derivatives=${!withoutDerivatives}): ${Math.max(...jumps)}`);
          check(Math.max(...row.map((pixel) => pixel[2])) - Math.min(...row.map((pixel) => pixel[2])) > 15,
            'Smooth ribbon retains orientation-based shading instead of flattening the light');
          smooth.dispose();
        }
      }

      for (const shape of ['circle', 'square']) {
        for (const withoutDerivatives of [false, true]) {
          const depthLit = fixture([
            { pose: { x: -0.5, z: 2, depth: 0.75 }, marker: { shape, color: [0.6, 0.7, 0.9] } },
            { pose: { x: 0.5, z: -2, depth: 0.75 }, marker: { shape, color: [0.6, 0.7, 0.9] } },
          ], { camera: lightingCamera, withoutDerivatives });
          depthLit.advance(1);
          const flatNear = depthLit.rgba(25, 50);
          const flatFar = depthLit.rgba(75, 50);
          depthLit.controller.setLighting(true);
          const near = depthLit.rgba(25, 50);
          const far = depthLit.rgba(75, 50);
          check(brightness(near) > brightness(far), 'Lighting separates near and far retained markers');
          check(brightness(near) !== brightness(flatNear), 'Lighting changes rendered color');
          check(near[3] === 255 && far[3] === 255, 'Lighting preserves opaque marker coverage');
          check(depthLit.rgba(28, 50).every((value, index) => value === near[index]), 'Flat markers keep a plane normal, not a sphere gradient');
          depthLit.controller.setCamera({ ...lightingCamera, position: { x: 0, y: 0, z: -5 } });
          check(brightness(depthLit.rgba(25, 50)) > brightness(depthLit.rgba(75, 50)), 'Depth shading follows the current camera across retained history');
          depthLit.controller.setCamera(lightingCamera);
          depthLit.controller.setLighting(false);
          check(depthLit.rgba(25, 50).every((value, index) => value === flatNear[index]), 'Flat mode restores captured base RGB exactly');
          check(depthLit.rgba(75, 50).every((value, index) => value === flatFar[index]), 'Flat mode restores old samples too');
          depthLit.dispose();
        }
      }

      for (const mode of [{ trail: { width: 8 } }, { paint: true }]) {
        const surface = fixture([
          { pose: { x: -0.8, z: 2 }, marker: { color: [0.2, 0.6, 1] } },
          { pose: { x: 0.8, z: -2 }, marker: { color: [0.2, 0.6, 1] } },
        ], { camera: lightingCamera, accumulate: false, ...mode });
        surface.advance(1);
        const flat = surface.rgba(50, 50);
        surface.controller.setLighting(true);
        const lit = surface.rgba(50, 50);
        check(lit[3] === flat[3] && lit[3] === 255, 'Surface lighting keeps the same ribbon/tail pixels');
        check(brightness(lit) !== brightness(flat), 'Surface lighting changes retained ribbon/tail shading');
        const near = surface.rgba(30, 50);
        const far = surface.rgba(70, 50);
        check(brightness(near) > brightness(far), 'Surface lighting includes the actual interpolated view depth');
        surface.canvas.width = surface.canvas.height = 200;
        surface.observers.resize();
        check(surface.rgba(50, 50).every((value, index) => Math.abs(value - lit[index]) <= 1), 'Surface normals account for backing-pixel scale');
        surface.controller.setFraming({ fit: 'stretch', zoom: 2 });
        check(surface.rgba(50, 50).every((value, index) => Math.abs(value - lit[index]) <= 1), 'Zoom changes projection without changing physical surface lighting');
        surface.controller.setFraming({ fit: 'stretch' });
        const restoreSurface = await lose(surface);
        await restoreSurface();
        check(surface.rgba(50, 50).every((value, index) => Math.abs(value - lit[index]) <= 1), 'Context restoration retains lighting and geometry');
        surface.controller.setLighting(false);
        check(surface.rgba(50, 50).every((value, index) => Math.abs(value - flat[index]) <= 1), 'Flat surface base color survives lighting and recovery');
        surface.dispose();
      }

      for (const shape of ['circle', 'square']) {
        const joined = fixture([
          { pose: { x: -0.8, z: 2 }, marker: { shape, color: [0.2, 0.6, 1] } },
          { pose: { x: 0.8, z: -2 }, marker: { shape, color: [0.2, 0.6, 1] } },
        ], { camera: lightingCamera, accumulate: false, paint: true, lighting: true });
        joined.advance(1);
        const start = joined.rgba(8, 50);
        const startSurface = joined.rgba(22, 50);
        const end = joined.rgba(92, 50);
        const endSurface = joined.rgba(78, 50);
        check(start[3] === 255 && end[3] === 255, 'Aligned endpoint markers stay visible on their adjoining planes');
        check(start.every((value, index) => Math.abs(value - startSurface[index]) <= 3), 'Starting marker receives the same surface lighting as the ribbon');
        check(end.every((value, index) => Math.abs(value - endSurface[index]) <= 3), 'Leading marker receives the same surface lighting as the ribbon');
        const restoreJoined = await lose(joined);
        await restoreJoined();
        check(joined.rgba(92, 50).every((value, index) => value === end[index]), 'Recovery retains endpoint orientation and shading');
        joined.controller.setCamera({ ...lightingCamera, position: { x: 0, y: 0, z: -5 } });
        const reverseEnd = joined.rgba(8, 50);
        const reverseSurface = joined.rgba(22, 50);
        check(reverseEnd[3] === 255, 'Aligned endpoint remains attached when viewed from the opposite side');
        check(reverseEnd.every((value, index) => Math.abs(value - reverseSurface[index]) <= 3), 'Endpoint and ribbon shading stay consistent after camera rotation');
        joined.dispose();
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
      projected.pixel(75, 25, blank, 'Camera update moves retained geometry out of its old projection');
      projected.pixel(62, 37, red, 'Camera update reprojects current frame');
      check(projected.controller.isPaused() && projected.resets === 0 && projected.sampledTime === 0, 'Camera update changed motion or pause');
      projected.controller.setCamera(undefined);
      projected.pixel(75, 75, red, 'Removing camera restores planar projection');
      projected.pixel(62, 37, blank, 'Removing camera reprojects retained geometry');
      projected.dispose();

      const rotatingDepth = fixture([
        { pose: { x: -0.5, z: 2 } },
        { pose: { x: -0.5, z: -2 }, marker: { color: [0, 1, 0] } },
      ], { camera });
      rotatingDepth.advance(1);
      rotatingDepth.pixel(25, 50, red, 'Near retained marker occludes the far marker');
      rotatingDepth.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: -5 } });
      rotatingDepth.pixel(75, 50, green, 'Orbiting reverses occlusion using all retained world positions');
      rotatingDepth.pixel(25, 50, blank, 'Orbiting leaves no paint in the old projection');
      rotatingDepth.controller.setCamera(camera);
      rotatingDepth.pixel(25, 50, red, 'Returning to the camera restores the original occlusion');
      rotatingDepth.dispose();

      const styledSamples = [
        { pose: { x: -0.5 }, marker: { radius: 5 } },
        { pose: { x: 0 }, marker: { radius: 10, shape: 'square', color: [0, 1, 0] } },
        { pose: { x: 0.5 }, marker: { radius: 5, color: [0, 0, 1] } },
        { pose: { x: -0.5 }, marker: { radius: 5, color: [1, 1, 0] } },
      ];
      const bounded = fixture(styledSamples, { camera, accumulate: { maxSamples: 3 } });
      bounded.advance(1); bounded.advance(2); bounded.advance(3);
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

      const expired = fixture([{ pose: { x: -0.5 } }, { pose: { x: 0 } }, { pose: { x: 0.5 } }], {
        camera, accumulate: { maxSamples: 2 },
      });
      expired.advance(1); expired.advance(2);
      expired.pixel(25, 50, blank, 'Oldest geometry expires at the sample cap');
      expired.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: -5 } });
      expired.pixel(75, 50, blank, 'Expired geometry cannot reappear after camera rotation');
      expired.pixel(25, 50, red, 'Latest geometry rotates after buffer wrap');
      expired.dispose();

      const retainedClip = fixture([{ pose: { x: -0.5, z: 4.5 } }, { pose: { x: 0.5 } }], { camera });
      retainedClip.advance(1);
      retainedClip.pixel(25, 50, blank, 'Near-clipped samples are initially hidden');
      retainedClip.controller.setCamera({ ...camera, position: { x: 0, y: 0, z: 6 }, far: 10 });
      retainedClip.pixel(25, 50, red, 'Clipped retained geometry becomes visible in a new camera');
      retainedClip.dispose();

      const ribbonCamera = { ...camera, position: { x: 0, y: -5, z: 0 }, up: { x: 0, y: 0, z: 1 } };
      const brush = { shape: 'circle', radius: 10 };
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
      let restoreSheet = await lose(sheet);
      await restoreSheet();
      sheet.pixel(50, 57, red, 'Context recovery reconstructs deposited paint');
      sheet.controller.clear();
      sheet.pixel(50, 50, blank, 'Clear discards deposited paint');
      sheet.dispose();

      const singleDab = fixture([{ pose: { x: 0.5 }, marker: brush }], {
        camera: ribbonCamera, accumulate: false, paint: { maxSamples: 1 },
      });
      singleDab.pixel(75, 50, red, 'A stationary brush leaves a flat initial dab');
      singleDab.pixel(83, 59, blank, 'The initial dab follows its circular footprint');
      check(singleDab.controller.isPaintFull() && singleDab.controller.isPaused(), 'Single-dab budget does not pause correctly');
      singleDab.controller.setCamera(camera);
      singleDab.pixel(75, 50, blank, 'An initial dab has a retained 3D plane');
      singleDab.dispose();

      const limitedPaint = fixture([
        { pose: { x: -0.8 }, marker: brush }, { pose: { x: -0.4 }, marker: brush },
        { pose: { x: 0.4 }, marker: brush }, { pose: { x: 0.8 }, marker: brush },
      ], { camera: ribbonCamera, accumulate: false, paint: { maxSamples: 3 } });
      limitedPaint.advance(1); limitedPaint.advance(2);
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

      const rollingPaint = fixture([
        { pose: { x: -0.8 }, marker: brush }, { pose: { x: -0.4 }, marker: brush },
        { pose: { x: 0 }, marker: brush }, { pose: { x: 0.4 }, marker: brush },
        { pose: { x: 0.8 }, marker: brush },
      ], { camera: ribbonCamera, accumulate: false, paint: { maxSamples: 3, limitBehavior: 'trim-oldest' } });
      rollingPaint.advance(1); rollingPaint.advance(2); rollingPaint.advance(3);
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

      const rollingGap = fixture([
        { pose: { x: -0.8 }, marker: brush }, { pose: { x: -0.6 }, marker: brush },
        { pose: { x: 0 }, skip: true }, { pose: { x: 0.6 }, marker: brush },
        { pose: { x: 0.8 }, marker: brush },
      ], { camera: ribbonCamera, accumulate: false, paint: { maxSamples: 3, limitBehavior: 'trim-oldest' } });
      rollingGap.advance(1); rollingGap.advance(2); rollingGap.advance(3); rollingGap.advance(4);
      rollingGap.pixel(20, 50, red, 'Eviction into a gap preserves the isolated earlier endpoint');
      rollingGap.pixel(50, 50, blank, 'Rolling paint never bridges a lifted brush');
      rollingGap.pixel(85, 50, red, 'The later retained stroke remains connected');
      rollingGap.dispose();

      const styledPaint = fixture([
        { pose: { x: -0.8 }, marker: { ...brush, color: [1, 0, 0] } },
        { pose: { x: -0.4 }, marker: { ...brush, color: [1, 0, 0] } },
        { pose: { x: 0.4 }, marker: { ...brush, radius: 20, color: [0, 1, 0] } },
      ], { camera: ribbonCamera, accumulate: false, paint: true });
      styledPaint.advance(1); styledPaint.advance(2);
      styledPaint.pixel(15, 50, red, 'Later brush colors do not recolor old paint');
      styledPaint.pixel(15, 65, blank, 'A larger brush does not widen old paint');
      styledPaint.pixel(65, 63, green, 'The deposited brush footprint retains its sampled shape and color');
      styledPaint.dispose();

      const crossingPaint = fixture([
        { pose: { x: 0, y: 0 }, marker: { ...brush, color: [1, 0, 0] } },
        { pose: { x: 0.6, y: 0 }, marker: { ...brush, color: [1, 0, 0] } },
        { pose: { x: 0.6, y: 0.6 }, marker: { ...brush, color: [0, 1, 0] } },
        { pose: { x: -0.6, y: -0.6 }, marker: { ...brush, color: [0, 1, 0] } },
      ], { camera, accumulate: false, paint: true });
      crossingPaint.advance(1); crossingPaint.advance(2); crossingPaint.advance(3);
      crossingPaint.pixel(50, 50, green, 'New crossing paint covers an older starting cap at equal depth');
      crossingPaint.dispose();
      const rollingCrossing = fixture([
        { pose: { x: -0.9, y: 0.9 } },
        { pose: { x: 0, y: 0 }, marker: { ...brush, color: [1, 0, 0] } },
        { pose: { x: 0.6, y: 0 }, marker: { ...brush, color: [1, 0, 0] } },
        { pose: { x: 0.6, y: 0.6 }, marker: { ...brush, color: [0, 1, 0] } },
        { pose: { x: -0.6, y: -0.6 }, marker: { ...brush, color: [0, 1, 0] } },
      ], { camera, accumulate: false, paint: { maxSamples: 4, limitBehavior: 'trim-oldest' } });
      for (let index = 1; index <= 4; index++) rollingCrossing.advance(index);
      rollingCrossing.pixel(50, 50, green, 'Wrapped paint draws in chronological order at equal depth');
      rollingCrossing.dispose();
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
      resized.pixel(25, 50, red, 'Bitmap resize redraws accumulated history');
      resized.pixel(75, 50, red, 'Bitmap resize repaints current paused marker');
      resized.canvas.style.width = '200px';
      resized.observers.resize();
      resized.pixel(75, 50, blank, 'CSS resize clears old projected marker');
      resized.pixel(150, 50, red, 'CSS resize reprojects current paused marker');
      resized.pixel(50, 50, red, 'CSS resize reprojects older accumulated markers');
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
      recovery.pixel(25, 50, red, 'Restored context redraws accumulated history');
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

  const previewArgument = process.argv.indexOf('--preview-dir');
  if (previewArgument !== -1) {
    const previewDirectory = resolve(process.argv[previewArgument + 1]);
    await mkdir(previewDirectory, { recursive: true });
    // Keep screenshot contexts separate from the many WebGL stress fixtures.
    const preview = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await preview.emulateMedia({ reducedMotion: 'no-preference' });
    await preview.goto(origin);
    await preview.locator('#status').waitFor();
    await preview.click('#pause');
    await preview.selectOption('#motion', 'lorenz');
    await preview.selectOption('#webgl-view', 'spatial');
    await preview.locator('#webgl-lighting').check();
    await preview.locator('#webgl-paint').check();
    const animatePreview = async () => {
      await preview.locator('#webgl-stage').scrollIntoViewIfNeeded();
      await preview.click('#pause');
      await preview.waitForFunction(() => Number(document.querySelector('#webgl-time').textContent) >= 0.6);
      await preview.click('#pause');
    };
    await animatePreview();
    await preview.evaluate(() => window.scrollTo(0, 0));
    await preview.screenshot({ path: resolve(previewDirectory, 'webgl.png'), fullPage: true });
    await preview.locator('#tab-dom').click();
    await preview.selectOption('#fit', 'contain');
    await preview.evaluate(() => window.scrollTo(0, 0));
    await preview.screenshot({ path: resolve(previewDirectory, 'dom.png'), fullPage: true });
    await preview.locator('#tab-webgl').click();
    await preview.setViewportSize({ width: 375, height: 812 });
    await preview.locator('#webgl-paint').uncheck();
    await preview.locator('#webgl-paint').check();
    await animatePreview();
    await preview.evaluate(() => window.scrollTo(0, 0));
    await preview.screenshot({ path: resolve(previewDirectory, 'mobile.png'), fullPage: true });
    await preview.close();
  }

  console.log('Browser smoke passed: renderer tabs, keyboard activation, renderer-specific controls, alphabetic selects, desktop/mobile layouts, 28 motion/renderer combinations, and WebGL geometry/lighting/lifecycle pixels.');
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

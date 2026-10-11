import { test, expect } from '../fixtures';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('renderer tabs support focus navigation and explicit keyboard activation', async ({ page }) => {
  const active = async (renderer: string) => {
    await expect(page.locator(`#tab-${renderer}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.locator(`#panel-${renderer}`)).toBeVisible();
    await expect(page.locator(`#panel-${renderer}`)).toHaveAttribute('aria-labelledby', `tab-${renderer}`);
  };
  await active('webgl');
  await page.locator('#tab-webgl').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-canvas')).toBeFocused();
  await expect(page.locator('#tab-canvas')).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#tab-webgl')).toHaveAttribute('tabindex', '-1');
  await active('webgl');
  await page.keyboard.press('Enter');
  await active('canvas');
  await page.keyboard.press('End');
  await expect(page.locator('#tab-svg')).toBeFocused();
  await page.keyboard.press('Space');
  await active('svg');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#tab-dom')).toBeFocused();
  await page.keyboard.press('Enter');
  await active('dom');
  await page.keyboard.press('Home');
  await expect(page.locator('#tab-webgl')).toBeFocused();
  await page.keyboard.press('Enter');
  await active('webgl');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#tab-svg')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-webgl')).toBeFocused();
});

test('shared settings and explicit motion survive renderer changes', async ({ page }) => {
  await page.selectOption('#motion', 'ellipse');
  await page.selectOption('#fit', 'cover');
  await page.click('#pause');
  for (const renderer of ['canvas', 'dom', 'svg', 'webgl']) {
    await page.locator(`#tab-${renderer}`).click();
    await expect(page.locator('#motion')).toHaveValue('ellipse');
    await expect(page.locator('#fit')).toHaveValue('cover');
    await expect(page.locator('#pause')).toHaveText('Resume');
    await expect(page.locator('#host-viewport-config')).toBeVisible({ visible: renderer === 'dom' || renderer === 'svg' });
    await expect(page.locator('#history-config')).toBeVisible({ visible: renderer !== 'dom' });
    await expect(page.locator('#webgl-shape')).toBeVisible({ visible: renderer === 'webgl' });
    await expect(page.locator('#camera-config')).toBeHidden();
    await expect(page.locator('#show-path')).toBeVisible({ visible: renderer === 'canvas' || renderer === 'svg' });
  }
});

test('failed renderer switch preserves mounted controls and recovers after correction', async ({ page }) => {
  await page.locator('#custom-bounds').check();
  await page.locator('#min-x').fill('');
  await page.locator('#tab-canvas').click();
  await expect(page.locator('#tab-webgl')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#status')).toContainText('Custom bounds require');
  await page.locator('#min-x').fill('-1');
  await page.locator('#min-x').press('Tab');
  await page.locator('#tab-canvas').click();
  await expect(page.locator('#panel-canvas')).toBeVisible();
});

test('unsupported WebGL can recover to Canvas after invalid settings are corrected', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: [options?: object]) {
      return type === 'webgl' ? null : getContext.call(this, type, ...args);
    } as typeof getContext;
  });
  await page.reload();
  await expect(page.locator('#status')).toContainText('WebGL rendering context');
  await page.locator('#custom-bounds').check();
  await page.locator('#min-x').fill('');
  await page.locator('#tab-canvas').click();
  await expect(page.locator('#tab-webgl')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#min-x').fill('-1');
  await page.locator('#min-x').press('Tab');
  await page.locator('#tab-canvas').click();
  await expect(page.locator('#panel-canvas')).toBeVisible();
});

test('numeric parameter rollback preserves paused output and committed settings', async ({ page }) => {
  await page.locator('#tab-svg').click();
  await page.selectOption('#motion', 'ellipse');
  await page.click('#pause');
  const period = page.locator('[data-parameter="periodSeconds"]');
  const initial = await period.inputValue();
  const transform = await page.locator('#svg-marker').getAttribute('transform');
  await page.locator('#depth-strength').fill('-1');
  await page.locator('#depth-strength').press('Tab');
  await period.fill('0.75');
  await period.press('Tab');
  await expect(period).toHaveValue(initial);
  await expect(page.locator('#status')).toContainText('finite and nonnegative');
  await expect(page.locator('#svg-marker')).toHaveAttribute('transform', transform!);
  await page.locator('#depth-strength').fill('1');
  await page.locator('#depth-strength').press('Tab');
  await period.fill('0.75');
  await period.press('Tab');
  await expect(period).toHaveValue('0.75');
  await page.selectOption('#motion', 'helix');
  await page.selectOption('#motion', 'ellipse');
  await expect(period).toHaveValue('0.75');
  await page.click('#defaults');
  await page.selectOption('#motion', 'ellipse');
  await expect(period).toHaveValue(initial);
});

test('reconfiguring a control preserves keyboard focus', async ({ page }) => {
  await page.locator('#show-trail').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#show-trail')).toBeFocused();
  await expect(page.locator('#show-trail')).toBeChecked();
  await page.keyboard.press('Space');
  await expect(page.locator('#show-trail')).not.toBeChecked();
});

test('renderer panels fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const renderer of ['webgl', 'canvas', 'dom', 'svg']) {
    await page.locator(`#tab-${renderer}`).click();
    await expect(page.locator(`#panel-${renderer}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('helix direction inputs move the paused seed to the named edge and reject failed changes', async ({ page }) => {
  await page.locator('#tab-dom').click();
  await page.click('#pause');
  await page.selectOption('#motion', 'helix');
  const flow = page.getByRole('combobox', { name: 'Flow direction', exact: true });
  const rotation = page.getByRole('combobox', { name: 'Rotation direction', exact: true });
  const seed = () => page.evaluate(() => {
    const stage = document.querySelector('#dom-stage')!.getBoundingClientRect();
    const marker = document.querySelector('#dom-marker')!.getBoundingClientRect();
    return {
      x: (marker.left + marker.right - stage.left - stage.right) / 2,
      y: (marker.top + marker.bottom - stage.top - stage.bottom) / 2,
      bounds: ['min-x', 'max-x', 'min-y', 'max-y'].map((id) => (document.getElementById(id) as HTMLInputElement).value),
    };
  });
  const before = await seed();
  await page.locator('#depth-strength').fill('-1');
  await page.locator('#depth-strength').press('Tab');
  await flow.selectOption('left-to-right');
  await expect(flow).toHaveValue('top-to-bottom');
  expect(await seed()).toEqual(before);
  await page.locator('#depth-strength').fill('1');
  await page.locator('#depth-strength').press('Tab');
  await rotation.selectOption('clockwise');
  for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
    await flow.selectOption(direction);
    const position = await seed();
    const horizontal = direction === 'left-to-right' || direction === 'right-to-left';
    expect(position.bounds).toEqual(horizontal ? ['0', '2', '-1', '1'] : ['-1', '1', '0', '2']);
    const coordinate = horizontal ? position.x : position.y;
    if (direction === 'top-to-bottom' || direction === 'left-to-right') expect(coordinate).toBeLessThan(-1);
    else expect(coordinate).toBeGreaterThan(1);
    await expect(page.locator('#pause')).toHaveText('Resume');
  }
  await page.selectOption('#motion', 'ellipse');
  await page.locator('#tab-svg').click();
  await page.selectOption('#motion', 'helix');
  await expect(rotation).toHaveValue('clockwise');
  await expect(flow).toHaveValue('right-to-left');
  await page.click('#defaults');
  await expect(rotation).toHaveValue('counter-clockwise');
  await expect(flow).toHaveValue('top-to-bottom');
});

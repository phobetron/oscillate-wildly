import type { Page } from 'playwright/test';
import { test, expect } from '../fixtures';

// Observe multiple real animation frames without a fixed wall-clock sleep.
async function domFrames(page: Page, count = 12) {
  return page.evaluate((count) => new Promise<string[]>((resolve) => {
    const samples: string[] = [];
    const sample = () => {
      samples.push(document.querySelector<HTMLElement>('#dom-marker')!.style.transform);
      if (samples.length === count) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), count);
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

for (const renderer of ['canvas', 'dom', 'svg'] as const) {
  test(`${renderer} preview produces changing rendered output`, async ({ page }) => {
    await page.locator(`#tab-${renderer}`).click();
    await page.selectOption('#motion', 'ellipse');
    await page.locator('[data-parameter="periodSeconds"]').fill('1');
    await page.locator('[data-parameter="periodSeconds"]').press('Tab');
    await page.locator(`#${renderer}-stage`).scrollIntoViewIfNeeded();
    const output = () => renderer === 'canvas'
      ? page.locator('#canvas-stage').evaluate((element: HTMLCanvasElement) => element.toDataURL())
      : renderer === 'dom'
        ? page.locator('#dom-marker').evaluate((element) => getComputedStyle(element).transform)
        : page.locator('#svg-marker').getAttribute('transform');
    const initial = await output();
    await expect.poll(output).not.toBe(initial);
  });
}

test('pause freezes output, framing redraws the paused frame, and resume advances it', async ({ page }) => {
  await page.locator('#tab-dom').click();
  await page.selectOption('#motion', 'ellipse');
  await page.locator('#dom-stage').scrollIntoViewIfNeeded();
  await expect.poll(async () => new Set(await domFrames(page)).size).toBeGreaterThan(1);
  await page.click('#pause');
  const paused = (await domFrames(page))[0];
  expect(new Set(await domFrames(page))).toEqual(new Set([paused]));
  await page.locator('#offset-x').fill('0.2');
  await expect(page.locator('#pause')).toHaveText('Resume');
  const reframed = await domFrames(page);
  expect(reframed[0]).not.toBe(paused);
  expect(new Set(reframed).size).toBe(1);
  await page.click('#pause');
  await expect.poll(async () => new Set(await domFrames(page)).size).toBeGreaterThan(1);
});

test('reduced motion stops output and preference recovery resumes it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#tab-dom').click();
  await page.selectOption('#motion', 'ellipse');
  await page.locator('#dom-stage').scrollIntoViewIfNeeded();
  expect(new Set(await domFrames(page)).size).toBe(1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => new Set(await domFrames(page)).size).toBeGreaterThan(1);
});

test('SVG path and trail controls create geometry and bound retained history', async ({ page }) => {
  await page.locator('#tab-svg').click();
  await page.selectOption('#motion', 'ellipse');
  await page.locator('#show-path').check();
  await expect(page.locator('#svg-full-path')).toHaveAttribute('d', /^M/);
  await page.locator('#show-trail').check();
  await page.locator('#trail-length').fill('3');
  await page.locator('#trail-length').press('Tab');
  await page.locator('#svg-stage').scrollIntoViewIfNeeded();
  await expect.poll(async () => ((await page.locator('#svg-trail').getAttribute('d'))?.match(/[ML]/g) ?? []).length).toBe(3);
  await page.locator('#tab-canvas').click();
  await expect(page.locator('#trail-length')).toHaveValue('3');
  await page.locator('#tab-dom').click();
  await expect(page.locator('#show-trail')).toBeDisabled();
  await page.locator('#tab-svg').click();
  await page.selectOption('#motion', 'lorenz');
  await expect(page.locator('#show-path')).toBeHidden();
});

test('runaway limit input changes the actual integrated DOM motion', async ({ page }) => {
  await page.locator('#tab-dom').click();
  await page.selectOption('#motion', 'duffing');
  await page.locator('[data-parameter="runawayLimit"]').fill('0.1');
  await page.locator('[data-parameter="runawayLimit"]').press('Tab');
  await page.locator('#dom-stage').scrollIntoViewIfNeeded();
  expect(new Set(await domFrames(page)).size).toBe(1);
  await page.locator('[data-parameter="runawayLimit"]').fill('1000000');
  await page.locator('[data-parameter="runawayLimit"]').press('Tab');
  await expect.poll(async () => new Set(await domFrames(page)).size).toBeGreaterThan(2);
});

for (const renderer of ['dom', 'svg'] as const) {
  test(`${renderer} live marker scale redraws the paused frame and reserves containment space`, async ({ page }) => {
    await page.locator(`#tab-${renderer}`).click();
    await page.click('#pause');
    await page.selectOption('#motion', 'ellipse');
    await page.locator('#marker-size').fill('24');
    const scale = () => page.locator(renderer === 'dom' ? '#dom-marker' : '#svg-marker').evaluate((element) => {
      const transform = element instanceof SVGElement ? element.getAttribute('transform') : (element as HTMLElement).style.transform;
      return Number(transform!.match(/scale\(([^)]+)\)/)![1]);
    });
    await page.locator('#depth-strength').fill('3');
    await page.locator('#depth-strength').press('Tab');
    expect(await scale()).toBe(2.5);
    await page.locator('#clamp-marker-scale').check();
    await page.locator('#max-marker-scale').fill('2');
    await page.locator('#max-marker-scale').press('Tab');
    expect(await scale()).toBe(2);
    await expect(page.locator('#pause')).toHaveText('Resume');
    expect(await page.evaluate((renderer) => {
      const marker = document.querySelector(renderer === 'dom' ? '#dom-marker' : '#svg-marker circle')!.getBoundingClientRect();
      const stage = document.querySelector(`#${renderer}-stage`)!.getBoundingClientRect();
      return marker.left >= stage.left - 0.05 && marker.right <= stage.right + 0.05
        && marker.top >= stage.top - 0.05 && marker.bottom <= stage.bottom + 0.05;
    }, renderer)).toBe(true);
    const before = await scale();
    await page.locator('#max-marker-scale').fill('-1');
    await page.locator('#max-marker-scale').press('Tab');
    await expect(page.locator('#status')).toContainText('finite and nonnegative');
    expect(await scale()).toBe(before);
    await page.locator('#tab-canvas').click();
    await expect(page.locator(`#tab-${renderer}`)).toHaveAttribute('aria-selected', 'true');
    await page.locator('#max-marker-scale').fill('2');
    await page.locator('#max-marker-scale').press('Tab');
    await page.click('#defaults');
    await expect(page.locator('#depth-strength')).toHaveValue('1');
    await expect(page.locator('#clamp-marker-scale')).not.toBeChecked();
  });
}

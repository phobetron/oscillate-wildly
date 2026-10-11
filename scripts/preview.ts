import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { startBrowserServer } from '../tests/browser/support/server';

const directory = resolve(process.argv[2] ?? '/tmp/oscillate-preview');
await mkdir(directory, { recursive: true });
const server = await startBrowserServer();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'no-preference' });
  await page.goto(server.url);
  await page.locator('#pause').click();
  await page.selectOption('#motion', 'lorenz');
  await page.selectOption('#webgl-view', 'spatial');
  await page.locator('#webgl-lighting').check();
  await page.locator('#webgl-paint').check();
  const animate = async () => {
    await page.locator('#webgl-stage').scrollIntoViewIfNeeded();
    await page.locator('#pause').click();
    await page.waitForFunction(() => Number(document.querySelector('#webgl-time')!.textContent) >= 0.6);
    await page.locator('#pause').click();
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  await animate();
  await page.screenshot({ path: resolve(directory, 'webgl.png'), fullPage: true });
  await page.locator('#tab-dom').click();
  await page.selectOption('#fit', 'contain');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, 'dom.png'), fullPage: true });
  await page.locator('#tab-webgl').click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#webgl-paint').uncheck();
  await page.locator('#webgl-paint').check();
  await animate();
  await page.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true });
  console.log(`Preview screenshots saved to ${directory}`);
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}

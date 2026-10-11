import { defineConfig } from 'playwright/test';

const port = Number(process.env.BROWSER_TEST_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.test.ts',
  forbidOnly: true,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'no-preference',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    },
  },
  webServer: {
    command: 'pnpm exec tsx tests/browser/server.ts',
    url: `${baseURL}/fixtures`,
    reuseExistingServer: false,
    env: { BROWSER_TEST_PORT: String(port) },
  },
});

import { test as base, expect } from 'playwright/test';

export { expect };

// Each case gets Playwright's isolated context and page. Failures from browser
// code and missing assets must be visible even when a UI assertion succeeds.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    await use(page);
    expect(errors, 'Browser exceptions and failed asset requests').toEqual([]);
  },
});

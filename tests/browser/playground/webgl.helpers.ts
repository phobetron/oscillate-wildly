import type { Page } from 'playwright/test';
export type PixelSummary = { count: number; hash: number; colors: string[]; center: number[] | null; size: number[] | null };
declare global {
  interface Window {
    demoWebGLPixels: () => PixelSummary;
    orbitRasters: PixelSummary[];
    stopOrbitRecording: () => void;
  }
}
// WebGL buffers may be discarded after compositing. Sample in the redraw callback.
export async function webglControls(page: Page) {
  await page.evaluate(() => {
    window.demoWebGLPixels = () => {
      const canvas = document.querySelector<HTMLCanvasElement>('#webgl-stage')!;
      const gl = canvas.getContext('webgl')!;
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
      const colors = new Set<string>();
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
  const change = (selector: string, value: string | number | boolean) => page.evaluate(({ selector, value }) => {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    if (control.type === 'checkbox') (control as HTMLInputElement).checked = value as boolean;
    else control.value = String(value);
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return window.demoWebGLPixels();
  }, { selector, value });
  const click = (selector: string) => page.evaluate((selector) => {
    document.querySelector<HTMLElement>(selector)!.click();
    return window.demoWebGLPixels();
  }, selector);
  const readout = () => page.evaluate(() => ({
    time: Number(document.querySelector<HTMLElement>('#webgl-time')!.textContent),
    size: Number(document.querySelector<HTMLElement>('#webgl-size-scale')!.textContent),
    depth: Number(document.querySelector<HTMLElement>('#webgl-depth')!.textContent),
    pause: document.querySelector<HTMLElement>('#pause')!.textContent,
  }));
  const animate = async (seconds: number) => {
    await page.locator('#webgl-stage').scrollIntoViewIfNeeded();
    return page.evaluate((seconds) => {
      const output = document.querySelector<HTMLElement>('#webgl-time')!;
      const time = () => Number(output.textContent);
      const start = time();
      return new Promise<PixelSummary>((resolveFrame, reject) => {
        // Output mutations are delivered after rendering, before Chromium
        // composites and discards the default WebGL drawing buffer.
        const observer = new MutationObserver(() => {
          if (time() - start < seconds) return;
          observer.disconnect();
          clearTimeout(timeout);
          document.querySelector<HTMLElement>('#pause')!.click();
          try {
            resolveFrame(window.demoWebGLPixels());
          } catch (error) {
            reject(error);
          }
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          document.querySelector<HTMLElement>('#pause')!.click();
          reject(new Error('Example WebGL animation did not advance'));
        }, 5000);
        observer.observe(output, { childList: true, characterData: true, subtree: true });
        document.querySelector<HTMLElement>('#pause')!.click();
      });
    }, seconds);
  };

  return { change, click, readout, animate };
}

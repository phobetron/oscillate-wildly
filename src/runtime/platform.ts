/** Browser services used by the runtime. Supplying these makes animation timing testable. */
export interface RuntimePlatform {
  requestAnimationFrame(callback: (timestamp: number) => void): unknown;
  cancelAnimationFrame(handle: unknown): void;
  isDocumentVisible?(): boolean;
  prefersReducedMotion?(): boolean;
  observeResize?(target: object, callback: () => void): () => void;
  observeIntersection?(target: object, callback: (isIntersecting: boolean) => void): () => void;
  observeVisibility?(callback: (isVisible: boolean) => void): () => void;
  observeReducedMotion?(callback: (prefersReducedMotion: boolean) => void): () => void;
}

type BrowserGlobal = typeof globalThis & {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  document?: Document;
  matchMedia?: (query: string) => MediaQueryList;
  ResizeObserver?: new (callback: ResizeObserverCallback) => ResizeObserver;
  IntersectionObserver?: new (callback: IntersectionObserverCallback) => IntersectionObserver;
};

const browser = (): BrowserGlobal => globalThis as BrowserGlobal;

/** Creates browser hooks lazily, so importing the package is safe during SSR. */
export const createBrowserPlatform = (): RuntimePlatform => {
  const root = browser();

  return {
    requestAnimationFrame(callback) {
      if (!root.requestAnimationFrame) {
        throw new Error('requestAnimationFrame is unavailable; provide a RuntimePlatform when rendering outside a browser');
      }
      return root.requestAnimationFrame(callback);
    },
    cancelAnimationFrame(handle) {
      if (root.cancelAnimationFrame) root.cancelAnimationFrame(handle as number);
    },
    isDocumentVisible: () => !root.document?.hidden,
    prefersReducedMotion: () => root.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    observeResize(target, callback) {
      if (!root.ResizeObserver) return () => undefined;
      const observer = new root.ResizeObserver(callback);
      observer.observe(target as Element);
      return () => observer.disconnect();
    },
    observeIntersection(target, callback) {
      if (!root.IntersectionObserver) return () => undefined;
      const observer = new root.IntersectionObserver((entries) => callback(entries.some((entry) => entry.isIntersecting)));
      observer.observe(target as Element);
      return () => observer.disconnect();
    },
    observeVisibility(callback) {
      const document = root.document;
      if (!document) return () => undefined;
      const listener = () => callback(!document.hidden);
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    observeReducedMotion(callback) {
      const media = root.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (!media) return () => undefined;
      const listener = () => callback(media.matches);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
  };
};

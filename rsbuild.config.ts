import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  output: {
    distPath: {
      root: 'demo-dist',
    },
  },
  source: {
    entry: {
      index: './examples/main.ts'
    }
  },
  html: {
    template: './examples/index.html'
  }
});

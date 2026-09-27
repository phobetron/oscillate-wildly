import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      bundle: false,
      dts: true,
      source: { tsconfigPath: './tsconfig.build.json' },
      output: {
        target: 'web'
      }
    }
  ]
});

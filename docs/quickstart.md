# Runnable quickstart

[Back to the README](../README.md)

This small project installs the package from npm and animates a styled DOM
marker. It uses [Rsbuild](https://rsbuild.dev/guide/start/quick-start), which
supports TypeScript directly. The library does not require Rsbuild; use your
existing browser bundler if you already have an application.

## Create the project

With Node.js 20.19 or later and pnpm installed:

```sh
mkdir motion-demo
cd motion-demo
pnpm init
pnpm add oscillate-wildly
pnpm add -D @rsbuild/core typescript
mkdir src
```

In the generated `package.json`, set `type` and `scripts` as follows, keeping the
dependencies that pnpm added:

```json
{
  "type": "module",
  "scripts": {
    "dev": "rsbuild dev",
    "build": "rsbuild build",
    "typecheck": "tsc --noEmit"
  }
}
```

Create the following files. Rsbuild injects the compiled entry into the HTML
template; do not add a second script tag.

### `rsbuild.config.ts`

```ts
import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: { entry: { index: './src/index.ts' } },
  html: { template: './index.html' },
});
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
```

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Oscillate Wildly quickstart</title>
  </head>
  <body>
    <h1>My first animation</h1>
    <div id="orbit" aria-hidden="true">
      <span id="dot"></span>
    </div>
    <button id="remove-orbit" type="button">Remove animation</button>
  </body>
</html>
```

### `src/style.css`

```css
#orbit {
  position: relative;
  width: min(100%, 24rem);
  height: 16rem;
  overflow: hidden;
  background: #eef2ff;
}
#dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #4338ca;
}
```

### `src/index.ts`

```ts
import './style.css';
import { createEllipseMotion } from 'oscillate-wildly';
import { animateDom } from 'oscillate-wildly/dom';

const viewport = document.querySelector<HTMLElement>('#orbit')!;
const marker = document.querySelector<HTMLElement>('#dot')!;
const removeButton = document.querySelector<HTMLButtonElement>('#remove-orbit')!;

const controller = animateDom(
  { viewport, marker },
  createEllipseMotion({ periodSeconds: 6 }),
  { framing: { fit: 'contain' } },
);

removeButton.addEventListener('click', () => {
  controller.dispose(); // Release the animation before removing its target.
  viewport.remove();
  removeButton.disabled = true;
}, { once: true });
```

## Run and verify

```sh
pnpm typecheck
pnpm dev
```

Open the local URL printed by Rsbuild. The dot should move around its viewport
once every six seconds. With reduced motion enabled, it intentionally stays
still. Clicking **Remove animation** disposes the controller before removing
the viewport and disables the button.

Use `pnpm build` to produce the application in `dist/`. For deployment, serve
that output through your normal static hosting setup.

If nothing appears, check that the IDs in the HTML match the selectors, the
viewport has nonzero dimensions, the marker has a size and background, and the
client entry was loaded through the build tool. `document.querySelector(...)!`
assumes that this specific markup is present; the TypeScript non-null assertion
does not create an element or perform a runtime check.

In a UI framework, mount the controller after the component's DOM exists and
call `dispose()` in its cleanup hook. See [integration](./integration.md) for
ownership, server rendering and Canvas/SVG examples, and the
[motion reference](./motions.md) to change the curve.

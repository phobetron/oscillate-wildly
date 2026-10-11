# Development

[Consumer quickstart](./quickstart.md) · [README](../README.md)

These commands are for a checkout of the library repository. Applications that
only consume the package can follow the quickstart instead.

## Run the playground

Use Node.js 20.19 or later and pnpm. The repository's `packageManager` field pins
the pnpm version used for development.

```sh
git clone https://github.com/phobetron/oscillate-wildly.git
cd oscillate-wildly
pnpm install
pnpm dev
```

Open the local URL printed by Rsbuild. The playground switches among all seven
motions and four renderers. See [playground controls](./playground.md) for the
meaning of its settings. The
[example source](https://github.com/phobetron/oscillate-wildly/tree/master/examples)
shows mounting, replacing and disposing controllers; it is not a hosted demo.

## Build and validate

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:list
pnpm exec playwright install chromium
pnpm test:browser
```

The Chromium installation is a one-time setup. Alternatively, set `CHROME_PATH`
to an installed Chrome/Chromium executable. Browser tests build the library and
example before running. The
[test guide](https://github.com/phobetron/oscillate-wildly/blob/master/tests/README.md)
explains suite responsibilities, focused commands and failure artifacts.

`pnpm build` writes ESM modules and TypeScript declarations to `dist/`.
`pnpm pack` creates a local package archive and runs the build through `prepack`;
it does not publish the package. The archive includes the consumer documentation.

## Capture previews

```sh
pnpm preview:capture /tmp/oscillate-preview
```

This creates WebGL, DOM and mobile screenshots for human inspection. It is a
separate utility, not an automated visual comparison. Use the same Chromium
setup as the browser tests.

# Tests

Tests are organized by the behavior they protect and the environment needed to
observe it. Executable cases use `*.test.ts`; fixtures and development utilities
do not. The library and example source are unchanged by this organization.

## Find and run a behavior

Run these commands from the repository root after `pnpm install`:

```sh
pnpm test:list                         # list unit and browser case names
pnpm test                             # unit tests
pnpm test tests/unit/runtime           # one unit area
pnpm test --testNamePattern 'pause'     # unit cases matching a behavior
pnpm test:browser                      # build the library/example and test Chromium
pnpm test:browser --grep 'context'      # build and run matching browser cases
pnpm typecheck                        # type-check tests, fixtures, scripts and source
```

Install Chromium once with `pnpm exec playwright install chromium`, or set
`CHROME_PATH` to an existing Chrome/Chromium executable. When the build is already
current, `pnpm exec playwright test` runs browser cases without rebuilding.
`pnpm exec playwright test --ui` provides an interactive case explorer. Browser
failures retain traces and screenshots in `test-results/`.

## What belongs where

| Location | Contract and reason for this test level |
| --- | --- |
| `unit/core/` | Projection, framing, clipping planes and invalid geometry. Known coordinates make failures precise without a browser. |
| `unit/motions/` | Motion periods, directions, discontinuities, model state and numerical reset behavior. Use known samples or independent invariants rather than reproducing the implementation. |
| `unit/runtime/` | Time, scheduling, pause preferences, ownership, fault cleanup, marker scale and bounded history. Controlled clocks make state transitions deterministic. |
| `unit/canvas/`, `unit/dom/`, `unit/svg/` | Adapter ownership, coordinate mapping, drawing commands and helper lifecycles. Fixtures record effects at the adapter boundary. |
| `unit/webgl/` | Option validation, retained geometry, bounded allocations/uploads, lifecycle and cleanup. Recording GL fixtures check these contracts; they do not establish shader or pixel correctness. |
| `unit/examples/` | Camera input calculations that can be checked independently of browser event delivery. |
| `browser/playground/` | User interactions and example wiring: keyboard activation, settings, rejected edits, animation preferences and real pointer input. |
| `browser/renderers/` | Real layout, clipping, raster output, depth, lighting, paint and context recovery that recording fixtures cannot establish. |

Rstest discovers only `tests/unit/**/*.test.ts`. Playwright discovers only
`tests/browser/**/*.test.ts`, creates a fresh page/context for each case and
starts a local server for the built library and example. Browser cases can run
independently; they must not rely on another case selecting controls or drawing
geometry first. Unexpected browser exceptions and failed asset responses fail
the case through the shared fixture.

## Keep a test when its failure matters

A test name should identify the contract and the circumstance that could break
it. Setup should establish only that circumstance, followed by the action and a
readable expected outcome. Use named parameterized cases when input variants
protect distinct boundaries.

Keep browser coverage for real rendering and browser integration. Keep unit
coverage for numerical boundaries and controlled state transitions. Similar
Canvas and SVG scenarios may both be necessary because their output paths
differ. Buffer upload tests are justified where they protect bounded work or
correct retained geometry; express expectations using semantic helpers and
named layout sizes.

Do not add a second check merely because it exercises the same line elsewhere.
Avoid copied production formulas, status-text checks used as a proxy for correct
rendering, incidental layout/wording assertions, and broad loops whose failure
does not identify the scenario. Before removing coverage, identify the remaining
case that protects its distinct contract, or explain why that contract is no
longer required. Passing counts alone do not measure the suite's value.

## Capture example previews

```sh
pnpm preview:capture /tmp/oscillate-preview
```

This separate TypeScript utility captures example images for human inspection.
It does not compare snapshots or count as a visual regression test.

# Motion reference

Use this reference to select and configure a motion source, read its model state, or implement a custom source. For mounting and controller lifecycle, see the [integration guide](./integration.md); for 3D display mappings, see the [WebGL guide](./webgl.md). The [README](../README.md) provides a starting example.

## Imports and factories

All seven factories and their parameter/state types are exported from `oscillate-wildly`. Individual entry points export the corresponding factory and types:

| Factory | Individual import path | Source kind |
| --- | --- | --- |
| `createEllipseMotion` | `oscillate-wildly/motions/ellipse` | Analytic |
| `createRoseMotion` | `oscillate-wildly/motions/rose` | Analytic |
| `createLissajousMotion` | `oscillate-wildly/motions/lissajous` | Analytic |
| `createHelixMotion` | `oscillate-wildly/motions/helix` | Analytic |
| `createVanderPolMotion` | `oscillate-wildly/motions/vander-pol` | Stateful |
| `createDuffingMotion` | `oscillate-wildly/motions/duffing` | Stateful |
| `createLorenzMotion` | `oscillate-wildly/motions/lorenz` | Stateful |

The Van der Pol import path is `vander-pol`; its types are `VanderPolParams` and `VanderPolState`. Other factories use the corresponding names, such as `EllipseParams` and `EllipseState`. Shared types such as `MotionSource`, `AnalyticMotionSource`, `StatefulMotionSource`, `MotionSample`, `Pose`, and `Bounds` are exported from the root and `oscillate-wildly/core`.

Every factory accepts an optional parameter object; omitted fields use the defaults below. Invalid built-in parameters throw `RangeError`. Values described as finite may be negative or zero unless a stricter range is specified. Model coordinates and equation coefficients use the model's own units; the library does not assign physical units such as meters. World coordinates become CSS-pixel coordinates through framing.

## Source lifecycle and time

An analytic source has `kind: "analytic"`, `bounds`, `periodSeconds`, `sample(elapsedSeconds)`, and `reset()`. Sampling computes a result at the supplied time without advancing mutable simulation state. Built-in sources accept any finite elapsed time, including negative times, and wrap it into `[0, periodSeconds)`. Their `state.elapsedSeconds` is that wrapped time in seconds. Their `reset()` is a no-op: sample at zero to obtain the initial pose.

A stateful source has `kind: "stateful"`, `bounds`, `step(realSeconds)`, `snapshot()`, and `reset()`. `step` advances the simulation by a finite, nonnegative real-time interval in seconds; zero does nothing. `snapshot()` reads the current state and pose without advancing it. `reset()` restores the configured initial coordinates and initial model time. Van der Pol and Duffing start at model time `0`; Lorenz starts at `0.4`. Model `timeSeconds` advances by `realSeconds * timeScale`, so it differs from controller elapsed time.

Controllers sample analytic sources using their own elapsed clock and advance stateful sources in fixed `1 / 120` real-second steps. They cap each frame's elapsed contribution at `0.05` seconds. Stateful poses are interpolated between simulation steps; `frame.state` is the latest snapshot, not an interpolated state. Use `frame.pose` or `frame.position` for the controller's interpolated motion, and use `frame.state` when deliberately selecting model coordinates. See [integration](./integration.md) for pause and reset behavior.

Create a separate stateful source for each concurrently mounted controller. Mounting the same stateful instance twice throws an error; disposal releases its ownership but does not reset the source. Mounting an already advanced stateful source starts from its current snapshot. Built-in analytic sources can be shared because they have no evolving state. Call `controller.reset()` to restart an attached animation and its clock; calling a source's `reset()` directly does not reset its controller clock or retained drawing.

### Shared numerical parameters

Van der Pol, Duffing, and Lorenz accept these additional fields:

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `timeScale` | `2.4` for Van der Pol and Duffing; `0.24` for Lorenz | Model-time units per real second; finite and greater than zero. |
| `runawayLimit` | `1_000_000` | Maximum absolute value of each model-state coordinate; finite and greater than zero. |

Each direct `step()` performs one explicit midpoint integration step. Large direct steps can change numerical accuracy; the adapters provide fixed steps automatically. If a newly computed coordinate is nonfinite or its absolute value exceeds `runawayLimit`, or the next model time is nonfinite, the source resets to its initial coordinates and initial time instead of throwing. The check applies to the computed next state, not to initial coordinates at construction. Finite coefficient values are accepted even when they produce unstable or unbounded trajectories; the limit is a recovery guard, not a guarantee of stability or containment.

## State, pose, and bounds

Every sample is `{ state, pose, pathSegment? }`. `state` preserves model values for custom rendering. `pose` selects coordinates and presentation channels for the default planar view:

| Pose field | Meaning |
| --- | --- |
| `x`, `y` | World-space position used by planar framing; positive projected Y goes down the screen. |
| `z` | Optional world-space Z position for spatial projection. |
| `depth` | Nonnegative marker-size multiplier; omission gives base size `1`. Shared `markerScale` options adjust this cue. |
| `opacity` | Optional opacity cue; omission gives full opacity in the default Canvas marker and preserves the original DOM/SVG opacity. WebGL uses opaque drawing. |

None of the built-in poses sets `pose.z`. A model's `state.z` may instead supply a hidden-coordinate size cue or axial coordinate. A WebGL `position` callback can select preserved XYZ values or define a phase-space mapping; see [WebGL](./webgl.md). Marker-size `pose.depth` is independent of geometric Z and camera clipping depth.

`bounds` is a rectangle in the planar **pose** coordinate system. Ellipse bounds follow its radii; helix bounds follow its turns and flow axis. Rose and Lissajous have fixed bounds. Numerical bounds are fixed envelopes calibrated for the default seeded trajectories, and do not change with coefficients, initial conditions, or simulation state. These rectangles neither constrain motion nor auto-fit an evolving trajectory. When custom parameters change the visible extent, supply `framing.bounds` in pose coordinates. For a 3D mapping, choose camera bounds and clipping distances for those mapped coordinates.

## Ellipse

`createEllipseMotion(params?: EllipseParams)` returns `AnalyticMotionSource<EllipseState>`.

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `periodSeconds` | `15` | Seconds per complete orbit; finite and greater than zero. |
| `radiusX` | `1` | Horizontal world-coordinate radius; finite and greater than zero. |
| `radiusY` | `1` | Vertical world-coordinate radius; finite and greater than zero. |

State fields are `elapsedSeconds`, `angleRadians`, `x`, `y`, and `z`. The angle runs from `0` up to `2π` during one period; X/Y are the ellipse coordinates. `z` is a size cue in `[0, 1]`, not a supplied spatial pose coordinate. The pose uses state X/Y and `depth = z + 0.5`, giving a multiplier in `[0.5, 1.5]`. The initial position is `(0, radiusY)`. Bounds are `[-radiusX, radiusX] × [-radiusY, radiusY]`.

## Rose

`createRoseMotion(params?: RoseParams)` returns `AnalyticMotionSource<RoseState>`.

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `periodSeconds` | `15 * Math.PI` (about `47.12`) | Seconds per complete closed path; finite and greater than zero. |

State fields are `elapsedSeconds`, `phase`, `radialAngleRadians`, `petalAngleRadians`, `x`, and `y`. `phase` is the fraction of the period in `[0, 1)`; radial angle is `4π * phase` and petal angle is `10π * phase`. The pose uses state X/Y with no size or opacity cue. Bounds are `[-1, 1] × [-1, 1]`. Petal shape is fixed; period changes playback duration.

## Lissajous

`createLissajousMotion(params?: LissajousParams)` returns `AnalyticMotionSource<LissajousState>`.

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `periodSeconds` | `60` | Seconds for the configured closed path; finite and greater than zero. |
| `cyclesX` | `5` | Complete horizontal cycles per period; positive safe integer. |
| `cyclesY` | `4` | Complete vertical cycles per period; positive safe integer. |
| `cyclesZ` | `3` | Complete Z cycles per period; positive safe integer. |

State fields are `elapsedSeconds`, `xAngleRadians`, `yAngleRadians`, `zAngleRadians`, `x`, `y`, and `z`. Each angle completes its configured number of `2π` cycles during a period. All coordinates lie in `[-1, 1]`; `z = sin(zAngleRadians)`. The pose uses state X/Y and `depth = 0.625 + 0.375 * z`, giving a multiplier in `[0.25, 1]`. Changing `cyclesZ` changes model Z and marker size independently of the XY path. Bounds are `[-1, 1] × [-1, 1]`.

## Helix

`createHelixMotion(params?: HelixParams)` returns `AnalyticMotionSource<HelixState>`.

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `periodSeconds` | `12` | Seconds per traverse; finite and greater than zero. |
| `turns` | `4` | Revolutions per traverse; finite and greater than zero, including fractions. |
| `fadeFraction` | `0.05` | Fraction of the period used for each endpoint fade; finite and strictly between `0` and `0.5`. |
| `rotationDirection` | `"counter-clockwise"` | `"counter-clockwise"` or `"clockwise"`, viewed from the positive helix axis toward the origin. |
| `flowDirection` | `"top-to-bottom"` | `"top-to-bottom"`, `"bottom-to-top"`, `"left-to-right"`, or `"right-to-left"`. Describes travel in planar screen coordinates. |

State fields are `elapsedSeconds`, `angleRadians`, `x`, `y`, and `z`. `angleRadians` makes `turns` revolutions per period, positive for counter-clockwise rotation and negative for clockwise. The axial length is `turns / 2` world units.

For vertical flow, the model axis is Z, model X/Y form the radial circle, and the planar pose uses `(state.x, state.z)`. For horizontal flow, the axis is X, model Y/Z form the radial circle, and the planar pose uses `(state.x, -state.z)`. Rotation is viewed from +Z for vertical flow or +X for horizontal flow. Reversing flow reverses axial travel; reversing rotation changes model Y and the size cue while preserving the planar trace. A rotated 3D camera can change the apparent screen direction.

The pose has `depth = 0.25 + 0.75 * (state.y + 1) / 2`, in `[0.25, 1]`, and opacity that fades from zero to one over the first `fadeFraction` of the period and back toward zero over the last fraction. Vertical bounds are `[-1, 1] × [0, turns / 2]`; horizontal bounds are `[0, turns / 2] × [-1, 1]`.

Each wrap jumps from the end of the traverse to the beginning and changes `pathSegment`. Connected trails, analytic path helpers, and WebGL paint start a new segment instead of drawing an end-to-start connector. Old retained segments remain subject to the helper's history limit.

## Van der Pol

`createVanderPolMotion(params?: VanderPolParams)` returns `StatefulMotionSource<VanderPolState>`. It accepts the [shared numerical parameters](#shared-numerical-parameters) and:

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `mu` | `1` | Model nonlinear damping coefficient; any finite number. |
| `initialX` | `1` | Initial displacement in model units; any finite number. |
| `initialY` | `1` | Initial velocity in displacement units per model-time unit; any finite number. |

State fields are `timeSeconds`, `x` (displacement), and `y` (velocity). The pose uses `(x / 3, y / 3)` with no size or opacity cue. Fixed bounds are `[-0.75, 0.75] × [-1, 1]`. Initial model time and reset model time are `0`.

## Duffing

`createDuffingMotion(params?: DuffingParams)` returns `StatefulMotionSource<DuffingState>`. It accepts the [shared numerical parameters](#shared-numerical-parameters) and:

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `damping` | `0.25` | Linear damping coefficient in the model equation; any finite number. |
| `forcing` | `0.3` | Periodic-force amplitude in model units; any finite number. |
| `angularFrequency` | `1` | Radians per model-time unit; any finite number, including zero or negative values. |
| `initialX` | `0.2` | Initial displacement in model units; any finite number. |
| `initialY` | `-0.3` | Initial velocity in displacement units per model-time unit; any finite number. |

State fields are `timeSeconds`, `forcingPhaseRadians`, `x` (displacement), and `y` (velocity). `forcingPhaseRadians = angularFrequency * timeSeconds` is an unwrapped forcing angle, not a physical Z coordinate. The pose uses `(x / 3, y / 3)` and `depth = 0.625 + 0.375 * sin(forcingPhaseRadians)`, in `[0.25, 1]`. A spatial display of displacement, velocity, and phase requires a consumer-defined phase-space mapping. Fixed bounds are `[-0.55, 0.55] × [-0.35, 0.35]`. Initial and reset model time are `0`, restoring forcing phase to `0`.

## Lorenz

`createLorenzMotion(params?: LorenzParams)` returns `StatefulMotionSource<LorenzState>`. It accepts the [shared numerical parameters](#shared-numerical-parameters) and:

| Parameter | Default | Units and constraints |
| --- | --- | --- |
| `sigma` | `10` | Model equation coefficient; any finite number. |
| `rho` | `28` | Model equation coefficient; any finite number. |
| `beta` | `8 / 3` | Model equation coefficient; any finite number. |
| `initialX` | `18.89688574723792` | Initial model X coordinate; any finite number. |
| `initialY` | `2.799477162418296` | Initial model Y coordinate; any finite number. |
| `initialZ` | `53.555488125917094` | Initial model Z coordinate; any finite number. |

State fields are `timeSeconds`, `x`, `y`, and `z`. The planar pose uses `(2 * y / 55, 2 * z / 55 - 1)`. Its size multiplier is `0.625 + x / 80`, clamped to `[0.25, 1]`. Fixed planar bounds are `[-1, 1] × [-1, 1.1]`. Initial and reset model time are `0.4`; reset restores the configured coordinates exactly. Use state X/Y/Z when selecting the model's spatial coordinates.

## Custom motion sources

Implement either source interface from `oscillate-wildly/core`. Provide bounds in your pose coordinate system, finite coordinates, and a `MotionSample<State>` with preserved state and renderer-facing pose. A custom analytic source should sample deterministically for a given elapsed time and advertise its complete path period. A custom stateful source should advance on `step(realSeconds)`, return a stable snapshot until the next step, and restore its intended seed in `reset()`.

This complete analytic source moves around a unit circle; it can be passed to any `animate*` adapter:

```ts
import type { AnalyticMotionSource } from "oscillate-wildly/core";

type CircleState = { elapsedSeconds: number; angleRadians: number };
const periodSeconds = 10;

const circle: AnalyticMotionSource<CircleState> = {
  kind: "analytic",
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  periodSeconds,
  sample(elapsedSeconds) {
    if (!Number.isFinite(elapsedSeconds)) {
      throw new RangeError("elapsedSeconds must be finite");
    }
    const wrapped = ((elapsedSeconds % periodSeconds) + periodSeconds) % periodSeconds;
    const angleRadians = (wrapped / periodSeconds) * 2 * Math.PI;
    return {
      state: { elapsedSeconds: wrapped, angleRadians },
      pose: { x: Math.cos(angleRadians), y: Math.sin(angleRadians) },
    };
  },
  reset() {},
};

const initialSample = circle.sample(0);
console.log(initialSample.pose); // { x: 1, y: 0 }
```

For discontinuous movement, include a numeric `pathSegment` on each sample and change it at a jump. Keep it stable along a continuous path. Controllers forward it to frames and avoid stateful pose interpolation across changed identifiers; connected drawing helpers also separate those segments. A closed continuous curve such as the circle above needs no segment change at its period boundary.

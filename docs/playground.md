# Playground controls

[Run the playground locally](./development.md#run-the-playground) · [README](../README.md)

The playground demonstrates library integration and lets you compare renderers.
Its controls and camera interaction belong to the example application; importing
the library does not create a user interface.

## Renderer and motion

Select WebGL, Canvas 2D, DOM or SVG. Arrow keys, Home and End move focus between
renderer tabs; Enter or Space activates the focused tab. An explicitly selected
motion and shared configuration persist when switching renderers, including a
manual pause. **Restore playground defaults** clears those choices and starts
the default WebGL animation again.

The motion controls expose factory parameters, including numerical initial
conditions, model speed and runaway limits. Changing the motion or its equation
parameters restarts it while preserving manual pause. Invalid inputs leave the
current animation and committed settings intact. Defaults and valid ranges are
listed in the [motion reference](./motions.md).

Helix rotation and flow are independent. Their flow names match the planar view
and the WebGL **Front** camera. Flow changes select a matching camera preset;
orbiting can change the apparent direction on screen. Lissajous **Z cycles**
changes model Z and marker size without changing its XY trajectory.

## Framing and marker size

**Contain** is the playground's default fit; the library itself defaults to
**Cover**. Zoom, offsets and custom bounds determine the visible region.
DOM/SVG viewport dimensions and overflow are host layout settings. Canvas
surfaces clip their output by design.

**Depth strength** and optional size clamps adjust the motion's size cue. They
do not change camera clipping depth. Rose and Van der Pol have no native size
variation, so strength is disabled for them; clamps can still set a constant
size. Appearance and framing changes redraw a paused frame without advancing
motion. Invalid changes preserve the current animation.

## WebGL coordinates and camera

Lissajous, Helix, Lorenz and Duffing offer **3D coordinates**. The first three
use model XYZ positions. Duffing uses a continuous phase-space mapping:
displacement controls a positive cylinder radius, velocity controls height,
and forcing phase determines the angle. It is a visualization chosen by the
example, not a built-in physical Z coordinate.

Choose **Planar** to use the motion's planar pose. A selected planar view persists
through framing and parameter edits. Changing coordinate mapping clears retained
drawing because old positions belong to a different coordinate system.

Drag with a mouse or one finger, or focus the canvas and use arrow keys, to orbit.
Dragging continues outside the canvas until release or cancellation. Planar
mode retains normal touch scrolling. Camera presets restore a known view;
camera changes preserve motion time, pause state and retained world geometry.
Projection remains orthographic and does not auto-fit the trajectory.

## Trails, accumulation and paint

Canvas 2D and SVG can show a bounded trail and, for analytic motions, a complete
path. DOM has neither helper. WebGL offers three mutually exclusive history
modes: a connected tail, retained individual markers, or ribbon paint.

**Tail length (samples)** controls the retained history, not wall-clock duration.
**Retained samples / paint limit** bounds accumulated markers or painted samples.
Paint defaults to **Pause** at the limit, preserving the whole stroke. **Trim
oldest** keeps motion running and removes the oldest paint. Clearing replenishes
the budget; resuming then continues at the existing motion time. Reset also
restarts the motion.

Paint retains its deposited positions, styles and surface orientation. Camera
orbit reprojects it, so a surface can turn edge-on. Brush changes affect future
paint; they do not recolor old deposits. Lighting shades the retained base colors
without changing motion or adding samples. See the [WebGL reference](./webgl.md)
for exact library options and limits.

Changing a history mode or its sample budget remounts the example's animation.
**Clear drawing** discards retained WebGL geometry without restarting time.
**Pause**, **Reset**, and **Restore playground defaults** are separate actions.

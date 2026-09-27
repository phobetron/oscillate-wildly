/** A rectangular region in a motion's projected world coordinates. */
export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Renderer-facing position and optional visual channels. */
export interface Pose {
  readonly x: number;
  readonly y: number;
  /** Positive, bounded marker scale for renderers that support depth. */
  readonly depth?: number;
  readonly opacity?: number;
}

/** The preserved model state paired with the position a renderer should draw. */
export interface MotionSample<State> {
  readonly state: State;
  readonly pose: Pose;
}

export interface AnalyticMotionSource<State> {
  readonly kind: 'analytic';
  readonly bounds: Bounds;
  readonly periodSeconds: number;
  sample(elapsedSeconds: number): MotionSample<State>;
  reset(): void;
}

export interface StatefulMotionSource<State> {
  readonly kind: 'stateful';
  readonly bounds: Bounds;
  step(realSeconds: number): void;
  snapshot(): MotionSample<State>;
  reset(): void;
}

export type MotionSource<State> =
  | AnalyticMotionSource<State>
  | StatefulMotionSource<State>;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export type FrameFit = 'cover' | 'contain' | 'stretch';

/**
 * Maps a world-space bounds rectangle to a viewport. Offsets are fractions of
 * the viewport dimensions, so 0.1 moves the result right/down by 10%.
 */
export interface Framing {
  readonly fit?: FrameFit;
  readonly zoom?: number;
  /** Fixed CSS-pixel inset for contain framing; consumers size it for custom or varying markers. */
  readonly padding?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly bounds?: Bounds;
}

export interface ProjectedPose extends Pose {
  readonly scaleX: number;
  readonly scaleY: number;
}

/** The complete renderer-facing result for one animation frame. */
export interface Frame<State> {
  readonly state: State;
  readonly pose: Pose;
  readonly position: ProjectedPose;
  readonly viewport: Viewport;
  readonly elapsedSeconds: number;
  project(pose: Pose): ProjectedPose;
}

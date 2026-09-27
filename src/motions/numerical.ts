import type { Bounds, MotionSample, StatefulMotionSource } from '../core';

export interface NumericalOptions {
  /** Model-time units advanced for each real second passed to `step`. */
  readonly timeScale?: number;
  readonly runawayLimit?: number;
}

export type Derivative<State extends readonly number[]> = (state: State, timeSeconds: number) => State;

const finiteState = (state: readonly number[], limit: number): boolean =>
  state.every((value) => Number.isFinite(value) && Math.abs(value) <= limit);

/** Advances an ODE with the explicit midpoint method. */
export const midpoint = <State extends readonly number[]>(
  state: State,
  timeSeconds: number,
  seconds: number,
  derivative: Derivative<State>,
): State => {
  const slopeAtStart = derivative(state, timeSeconds);
  const halfway = state.map((value, index) => value + slopeAtStart[index] * seconds / 2) as unknown as State;
  const slopeAtHalfway = derivative(halfway, timeSeconds + seconds / 2);
  return state.map((value, index) => value + slopeAtHalfway[index] * seconds) as unknown as State;
};

export const createStatefulMotion = <State extends readonly number[], Snapshot>(options: {
  readonly bounds: Bounds;
  readonly initialState: State;
  readonly initialTimeSeconds?: number;
  readonly derivative: Derivative<State>;
  readonly snapshot: (state: State, timeSeconds: number) => MotionSample<Snapshot>;
  /** Model-time units to advance for each real second passed to `step`. */
  readonly timeScale?: number;
  readonly runawayLimit?: number;
}): StatefulMotionSource<Snapshot> => {
  const initialState = [...options.initialState] as unknown as State;
  const initialTimeSeconds = options.initialTimeSeconds ?? 0;
  const timeScale = options.timeScale ?? 1;
  const runawayLimit = options.runawayLimit ?? 1_000_000;
  if (!Number.isFinite(timeScale) || timeScale <= 0 || !Number.isFinite(runawayLimit) || runawayLimit <= 0) {
    throw new RangeError('numerical motion options must be finite and greater than zero');
  }

  let state = initialState;
  let timeSeconds = initialTimeSeconds;
  const reset = (): void => {
    state = [...initialState] as unknown as State;
    timeSeconds = initialTimeSeconds;
  };

  return {
    kind: 'stateful',
    bounds: options.bounds,
    step(realSeconds: number): void {
      if (!Number.isFinite(realSeconds) || realSeconds < 0) {
        throw new RangeError('realSeconds must be finite and non-negative');
      }
      if (realSeconds === 0) return;
      const modelSeconds = realSeconds * timeScale;
      const nextState = midpoint(state, timeSeconds, modelSeconds, options.derivative);
      const nextTimeSeconds = timeSeconds + modelSeconds;
      if (!finiteState(nextState, runawayLimit) || !Number.isFinite(nextTimeSeconds)) {
        reset();
        return;
      }
      state = nextState;
      timeSeconds = nextTimeSeconds;
    },
    snapshot: (): MotionSample<Snapshot> => options.snapshot(state, timeSeconds),
    reset,
  };
};

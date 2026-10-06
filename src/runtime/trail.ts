/** Retains samples chronologically, replacing redraws at the same elapsed time. */
export const createTrailHistory = <Sample>(maxSamples = 128) => {
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) {
    throw new RangeError('maxSamples must be a positive safe integer');
  }
  const samples: Sample[] = [];
  let start = 0;
  let previousElapsedSeconds: number | undefined;

  const clear = (): void => {
    samples.length = 0;
    start = 0;
    previousElapsedSeconds = undefined;
  };

  return {
    get size(): number { return samples.length; },
    add(sample: Sample, elapsedSeconds: number): void {
      if ((previousElapsedSeconds ?? 0) > 0 && elapsedSeconds === 0) clear();
      if (samples.length > 0 && elapsedSeconds === previousElapsedSeconds) {
        samples[(start + samples.length - 1) % samples.length] = sample;
      } else if (samples.length < maxSamples) {
        samples.push(sample);
      } else {
        samples[start] = sample;
        start = (start + 1) % samples.length;
      }
      previousElapsedSeconds = elapsedSeconds;
    },
    values(): readonly Sample[] {
      return start === 0 ? samples.slice() : [...samples.slice(start), ...samples.slice(0, start)];
    },
    clear,
  };
};

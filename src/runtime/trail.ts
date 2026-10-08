/** Retains samples chronologically, replacing redraws at the same elapsed time. */
export const createTrailHistory = <Sample>(maxSamples = 128) => {
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1) {
    throw new RangeError('maxSamples must be a positive safe integer');
  }
  const samples: Sample[] = [];
  const pathSegments: (number | undefined)[] = [];
  let start = 0;
  let previousElapsedSeconds: number | undefined;

  const clear = (): void => {
    samples.length = 0;
    pathSegments.length = 0;
    start = 0;
    previousElapsedSeconds = undefined;
  };

  return {
    get size(): number { return samples.length; },
    add(sample: Sample, elapsedSeconds: number, pathSegment?: number): void {
      if ((previousElapsedSeconds ?? 0) > 0 && elapsedSeconds === 0) clear();
      if (samples.length > 0 && elapsedSeconds === previousElapsedSeconds) {
        const index = (start + samples.length - 1) % samples.length;
        samples[index] = sample;
        pathSegments[index] = pathSegment;
      } else if (samples.length < maxSamples) {
        samples.push(sample);
        pathSegments.push(pathSegment);
      } else {
        samples[start] = sample;
        pathSegments[start] = pathSegment;
        start = (start + 1) % samples.length;
      }
      previousElapsedSeconds = elapsedSeconds;
    },
    values(): readonly Sample[] {
      return start === 0 ? samples.slice() : [...samples.slice(start), ...samples.slice(0, start)];
    },
    /** Adjacent runs of continuous samples, sharing the same total sample budget. */
    segments(): readonly (readonly Sample[])[] {
      const groups: Sample[][] = [];
      let previousSegment: number | undefined;
      for (let offset = 0; offset < samples.length; offset += 1) {
        const index = (start + offset) % samples.length;
        const segment = pathSegments[index];
        if (offset === 0 || segment !== previousSegment) groups.push([]);
        groups[groups.length - 1].push(samples[index]);
        previousSegment = segment;
      }
      return groups;
    },
    clear,
  };
};

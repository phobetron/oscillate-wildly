import { expect, test } from '@rstest/core';
import { createHelixMotion, type HelixFlowDirection, type HelixRotationDirection } from '../../../src/motions';
import { projectOrthographic, type OrthographicCamera } from '../../../src/core';

const helixFlows: readonly HelixFlowDirection[] = ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left'];
const helixRotations: readonly HelixRotationDirection[] = ['counter-clockwise', 'clockwise'];

test('helix makes four turns in 12 seconds and fades through its loop boundary', () => {
  const helix = createHelixMotion();
  const quarter = helix.sample(3);

  expect(helix.periodSeconds).toBe(12);
  expect(helix.sample(0)).toMatchObject({ state: { x: 1, y: 0, z: 0 }, pose: { x: 1, y: 0, depth: 0.625, opacity: 0 } });
  expect(quarter.state.x).toBeCloseTo(1);
  expect(quarter.state.y).toBeCloseTo(0);
  expect(quarter.state.z).toBeCloseTo(0.5);
  expect(quarter.pose.y).toBeCloseTo(0.5);
  expect(quarter.pose.depth).toBeCloseTo(0.625);
  expect(quarter.pose.opacity).toBe(1);
  expect(helix.sample(0.3).pose.opacity).toBeCloseTo(0.5);
  expect(helix.sample(11.7).pose.opacity).toBeCloseTo(0.5);
  expect(helix.sample(12)).toEqual({ ...helix.sample(0), pathSegment: 1 });
});

test.each([
  { name: 'negative time', seconds: -1 },
  { name: 'initial sample', seconds: 0 },
  { name: 'fade-in', seconds: 0.3 },
  { name: 'steady loop', seconds: 3 },
  { name: 'fade-out', seconds: 11.999 },
  { name: 'loop boundary', seconds: 12 },
])('default directions match explicit directions at $name', ({ seconds }) => {
  const defaults = createHelixMotion();
  const explicit = createHelixMotion({ rotationDirection: 'counter-clockwise', flowDirection: 'top-to-bottom' });

  expect(defaults.sample(seconds)).toEqual(explicit.sample(seconds));
});

test.each(helixFlows.flatMap((flowDirection) => helixRotations.map((rotationDirection) => ({ flowDirection, rotationDirection }))))(
  '$flowDirection flow is independent of $rotationDirection rotation', ({ flowDirection, rotationDirection }) => {
    const horizontal = flowDirection === 'left-to-right' || flowDirection === 'right-to-left';
    const reverse = flowDirection === 'bottom-to-top' || flowDirection === 'right-to-left';
    const forward = createHelixMotion({ flowDirection });
    const motion = createHelixMotion({ flowDirection, rotationDirection });
    expect(motion.bounds).toEqual(horizontal
      ? { minX: 0, maxX: 2, minY: -1, maxY: 1 }
      : { minX: -1, maxX: 1, minY: 0, maxY: 2 });
    const first = motion.sample(0).state;
    const quarter = motion.sample(0.75).state;
    // Signed radial cross product verifies the sense of rotation about the axis.
    const orientation = horizontal
      ? first.y * quarter.z - first.z * quarter.y
      : first.x * quarter.y - first.y * quarter.x;
    expect(orientation).toBeCloseTo(rotationDirection === 'clockwise' ? -1 : 1, 12);
    const early = motion.sample(0.3).state;
    const later = motion.sample(3.3).state;
    expect((horizontal ? later.x - early.x : later.z - early.z)).toBeCloseTo(reverse ? -0.5 : 0.5, 12);
    // Include radial quadrants, both fades, and a sample immediately before wrap.
    for (const time of [0, 0.3, 0.75, 1.5, 2.25, 3.3, 11.7, 11.999]) {
      const sample = motion.sample(time);
      const native = forward.sample(time);
      expect(sample.pose.x).toBe(native.pose.x);
      expect(sample.pose.y).toBe(native.pose.y);
      expect(sample.pose.opacity).toBe(native.pose.opacity);
      expect(sample.pathSegment).toBe(native.pathSegment);
      expect(sample.pose.x).toBeGreaterThanOrEqual(motion.bounds.minX);
      expect(sample.pose.x).toBeLessThanOrEqual(motion.bounds.maxX);
      expect(sample.pose.y).toBeGreaterThanOrEqual(motion.bounds.minY);
      expect(sample.pose.y).toBeLessThanOrEqual(motion.bounds.maxY);
      expect(Math.hypot(sample.state.y, horizontal ? sample.state.z : sample.state.x)).toBeCloseTo(1, 12);
      if (rotationDirection === 'clockwise') expect(sample.pose.depth! + native.pose.depth!).toBeCloseTo(1.25, 12);
      else expect(sample.pose.depth).toBe(native.pose.depth);
    }
    const beforeWrap = motion.sample(11.999);
    const afterWrap = motion.sample(12.001);
    expect(beforeWrap.pathSegment).toBe(0);
    expect(afterWrap.pathSegment).toBe(1);
    expect(Math.abs((horizontal ? afterWrap.pose.x - beforeWrap.pose.x : afterWrap.pose.y - beforeWrap.pose.y))).toBeGreaterThan(1.9);
  });

test.each(helixFlows)('%s flow agrees with the planar pose and Front camera', (flowDirection) => {
  const horizontal = flowDirection === 'left-to-right' || flowDirection === 'right-to-left';
  const motion = createHelixMotion({ flowDirection });
  const camera: OrthographicCamera = horizontal
    ? { target: { x: 1, y: 0, z: 0 }, position: { x: 1, y: -7, z: 0 }, up: { x: 0, y: 0, z: 1 }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } }
    : { target: { x: 0, y: 0, z: 1 }, position: { x: 0, y: 7, z: 1 }, up: { x: 0, y: 0, z: -1 }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } };
  const early = motion.sample(0.3);
  const later = motion.sample(3.3);
  const a = projectOrthographic(early.state, { width: 200, height: 200 }, camera, { fit: 'contain', padding: 0 });
  const b = projectOrthographic(later.state, { width: 200, height: 200 }, camera, { fit: 'contain', padding: 0 });
  const delta = horizontal ? b.x - a.x : b.y - a.y;
  expect(delta).toBeCloseTo(flowDirection === 'bottom-to-top' || flowDirection === 'right-to-left' ? -25 : 25, 12);
  expect((horizontal ? later.pose.x - early.pose.x : later.pose.y - early.pose.y)).toBeCloseTo(delta / 50, 12);
});

test.each([
  { name: 'empty string', value: '' },
  { name: 'unsupported name', value: 'left' },
  { name: 'wrong casing', value: 'CLOCKWISE' },
  { name: 'number', value: 1 },
  { name: 'boolean', value: false },
])('rejects $name as a direction', ({ value }) => {
  expect(() => createHelixMotion({ rotationDirection: value as HelixRotationDirection })).toThrow(/rotationDirection/);
  expect(() => createHelixMotion({ flowDirection: value as HelixFlowDirection })).toThrow(/flowDirection/);
});


test('helix assigns loop identity at positive and negative boundaries', () => {
  const helix = createHelixMotion({ periodSeconds: 2 });
  expect(helix.sample(0).pathSegment).toBe(0);
  expect(helix.sample(1.999).pathSegment).toBe(0);
  expect(helix.sample(2).pathSegment).toBe(1);
  expect(helix.sample(2.001).pathSegment).toBe(1);
  expect(helix.sample(8.001).pathSegment).toBe(4);
  expect(helix.sample(-0.001).pathSegment).toBe(-1);
  expect(helix.sample(-2).pathSegment).toBe(-1);
  expect(helix.sample(2).pose).toEqual(helix.sample(0).pose);
});

test('helix path identity changes with the actual wrap at repeated fractional periods', () => {
  const helix = createHelixMotion({ periodSeconds: 0.1, turns: 1 });
  expect(helix.sample(0.49).pathSegment).toBe(4);
  expect(helix.sample(0.5).pathSegment).toBe(4);
  expect(helix.sample(0.51).pathSegment).toBe(5);
  for (const periodSeconds of [0.1, 0.18, 1.2]) {
    const motion = createHelixMotion({ periodSeconds });
    let previous = motion.sample(0);
    for (let index = 1; index <= 1000; index += 1) {
      const current = motion.sample(index * periodSeconds / 10);
      const jumped = current.state.elapsedSeconds < previous.state.elapsedSeconds;
      expect(current.pathSegment !== previous.pathSegment).toBe(jumped);
      previous = current;
    }
  }
});

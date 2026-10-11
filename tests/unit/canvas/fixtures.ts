import type { Frame } from '../../../src/runtime';

type Operation = readonly [string, ...number[]];

export const context = () => {
  const operations: Operation[] = [];
  let alpha = 1;
  const value = {
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    save: () => operations.push(['save']), restore: () => operations.push(['restore']),
    setTransform: (...values: number[]) => operations.push(['setTransform', ...values]),
    scale: (...values: number[]) => operations.push(['scale', ...values]),
    clearRect: (...values: number[]) => operations.push(['clearRect', ...values]),
    beginPath: () => operations.push(['beginPath']),
    arc: (...values: number[]) => operations.push(['arc', ...values]),
    fill: () => operations.push(['fill']),
    moveTo: (...values: number[]) => operations.push(['moveTo', ...values]),
    lineTo: (...values: number[]) => operations.push(['lineTo', ...values]),
    stroke: () => operations.push(['stroke']),
  };
  Object.defineProperty(value, 'globalAlpha', {
    get: () => alpha,
    set: (next: number) => { alpha = next; operations.push(['globalAlpha', next]); },
  });
  return { value: value as unknown as CanvasRenderingContext2D, operations };
};

export const canvas = (drawing: CanvasRenderingContext2D) => ({
  width: 400, height: 200,
  getContext: () => drawing,
  getBoundingClientRect: () => ({ width: 200, height: 100 }),
}) as unknown as HTMLCanvasElement;

export const frame = (x: number, y: number, elapsedSeconds = x): Frame<undefined> => ({
  state: undefined, pose: { x, y }, position: { x, y, scaleX: 1, scaleY: 1 },
  viewport: { width: 100, height: 100 }, elapsedSeconds,
  project: (pose) => ({ ...pose, scaleX: 1, scaleY: 1 }),
});


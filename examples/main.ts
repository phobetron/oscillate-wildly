import {
  createDuffingMotion,
  createEllipseMotion,
  createHelixMotion,
  createLissajousMotion,
  createLorenzMotion,
  createRoseMotion,
  createVanderPolMotion,
  type Bounds,
  type FrameFit,
  type Framing,
  type MotionSource,
} from '../src';
import { animateCanvas, renderCanvasMarker } from '../src/canvas';
import { createCanvasPath } from '../src/canvas/path';
import { createCanvasTrail } from '../src/canvas/trail';
import { animateDom } from '../src/dom';
import { animateSvg, renderSvgMarker } from '../src/svg';
import { createSvgStaticPath, type SvgStaticPath } from '../src/svg/path';
import { createSvgTrail } from '../src/svg/trail';
import type { Controller } from '../src/runtime';

import './styles.css';

type MotionName = 'ellipse' | 'rose' | 'lissajous' | 'helix' | 'vander-pol' | 'duffing' | 'lorenz';
type RendererName = 'canvas' | 'dom' | 'svg';
type Parameter = { key: string; label: string; value: number; step?: number; min?: number; max?: number };

const parameterDefinitions: Record<MotionName, readonly Parameter[]> = {
  ellipse: [
    { key: 'periodSeconds', label: 'Period (seconds)', value: 15, min: 1, step: 0.5 },
    { key: 'radiusX', label: 'Horizontal radius', value: 1, min: 0.1, step: 0.05 },
    { key: 'radiusY', label: 'Vertical radius', value: 1, min: 0.1, step: 0.05 },
  ],
  rose: [{ key: 'periodSeconds', label: 'Period (seconds)', value: 15 * Math.PI, min: 1 }],
  lissajous: [
    { key: 'periodSeconds', label: 'Period (seconds)', value: 60, min: 1, step: 1 },
    { key: 'cyclesX', label: 'Horizontal cycles', value: 5, min: 1, max: 20, step: 1 },
    { key: 'cyclesY', label: 'Vertical cycles', value: 4, min: 1, max: 20, step: 1 },
  ],
  helix: [
    { key: 'periodSeconds', label: 'Period (seconds)', value: 12, min: 1, step: 0.5 },
    { key: 'turns', label: 'Turns', value: 4, min: 1, max: 12, step: 1 },
    { key: 'fadeFraction', label: 'End fade fraction', value: 0.05, min: 0.01, max: 0.45, step: 0.01 },
  ],
  'vander-pol': [
    { key: 'mu', label: 'Nonlinearity μ', value: 1, min: 0, step: 0.1 },
    { key: 'timeScale', label: 'Playback speed', value: 2.4, min: 0.01, step: 0.1 },
    { key: 'initialX', label: 'Initial X', value: 1, step: 0.1 },
    { key: 'initialY', label: 'Initial Y', value: 1, step: 0.1 },
  ],
  duffing: [
    { key: 'damping', label: 'Damping', value: 0.25, min: 0, step: 0.05 },
    { key: 'forcing', label: 'Forcing', value: 0.3, min: 0, step: 0.05 },
    { key: 'angularFrequency', label: 'Angular frequency', value: 1, min: 0, step: 0.1 },
    { key: 'timeScale', label: 'Playback speed', value: 2.4, min: 0.01, step: 0.1 },
    { key: 'initialX', label: 'Initial X', value: 0.2, step: 0.1 },
    { key: 'initialY', label: 'Initial Y', value: -0.3, step: 0.1 },
  ],
  lorenz: [
    { key: 'sigma', label: 'Sigma σ', value: 10, min: 0.01, step: 0.1 },
    { key: 'rho', label: 'Rho ρ', value: 28, min: 0.01, step: 0.1 },
    { key: 'beta', label: 'Beta β', value: 8 / 3, min: 0.01 },
    { key: 'timeScale', label: 'Playback speed', value: 0.24, min: 0.01, step: 0.01 },
    { key: 'initialX', label: 'Initial X', value: 18.89688574723792 },
    { key: 'initialY', label: 'Initial Y', value: 2.799477162418296 },
    { key: 'initialZ', label: 'Initial Z', value: 53.555488125917094 },
  ],
};

const required = <ElementType extends Element>(selector: string): ElementType => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};

const motionSelect = required<HTMLSelectElement>('#motion');
const rendererSelect = required<HTMLSelectElement>('#renderer');
const fitSelect = required<HTMLSelectElement>('#fit');
const zoomInput = required<HTMLInputElement>('#zoom');
const zoomValue = required<HTMLOutputElement>('#zoom-value');
const offsetXInput = required<HTMLInputElement>('#offset-x');
const offsetYInput = required<HTMLInputElement>('#offset-y');
const offsetXValue = required<HTMLOutputElement>('#offset-x-value');
const offsetYValue = required<HTMLOutputElement>('#offset-y-value');
const overflowSelect = required<HTMLSelectElement>('#overflow');
const overflowNote = required<HTMLElement>('#overflow-note');
const colorInput = required<HTMLInputElement>('#marker-color');
const sizeInput = required<HTMLInputElement>('#marker-size');
const sizeValue = required<HTMLOutputElement>('#marker-size-value');
const trailInput = required<HTMLInputElement>('#show-trail');
const pathInput = required<HTMLInputElement>('#show-path');
const visualNote = required<HTMLElement>('#visual-note');
const parameterControls = required<HTMLElement>('#parameter-controls');
const customBounds = required<HTMLInputElement>('#custom-bounds');
const boundsInputs = {
  minX: required<HTMLInputElement>('#min-x'),
  maxX: required<HTMLInputElement>('#max-x'),
  minY: required<HTMLInputElement>('#min-y'),
  maxY: required<HTMLInputElement>('#max-y'),
};
const pauseButton = required<HTMLButtonElement>('#pause');
const resetButton = required<HTMLButtonElement>('#reset');
const defaultsButton = required<HTMLButtonElement>('#defaults');
const status = required<HTMLElement>('#status');
const shell = required<HTMLElement>('.stage-shell');
const canvas = required<HTMLCanvasElement>('#canvas-stage');
const domViewport = required<HTMLElement>('#dom-stage');
const domMarker = required<HTMLElement>('#dom-marker');
const svgViewport = required<SVGSVGElement>('#svg-stage');
const svgMarker = required<SVGGraphicsElement>('#svg-marker');
const svgCircle = required<SVGCircleElement>('#svg-marker circle');
const svgFullPath = required<SVGPathElement>('#svg-full-path');
const svgTrailPath = required<SVGPathElement>('#svg-trail');

const valuesByMotion = new Map<MotionName, Record<string, number>>();
const valuesFor = (name: MotionName): Record<string, number> => {
  let values = valuesByMotion.get(name);
  if (!values) {
    values = Object.fromEntries(parameterDefinitions[name].map(({ key, value }) => [key, value]));
    valuesByMotion.set(name, values);
  }
  return values;
};

const createMotion = (name: MotionName): MotionSource<unknown> => {
  const p = valuesFor(name);
  switch (name) {
    case 'ellipse': return createEllipseMotion({ periodSeconds: p.periodSeconds, radiusX: p.radiusX, radiusY: p.radiusY });
    case 'rose': return createRoseMotion({ periodSeconds: p.periodSeconds });
    case 'lissajous': return createLissajousMotion({ periodSeconds: p.periodSeconds, cyclesX: p.cyclesX, cyclesY: p.cyclesY });
    case 'helix': return createHelixMotion({ periodSeconds: p.periodSeconds, turns: p.turns, fadeFraction: p.fadeFraction });
    case 'vander-pol': return createVanderPolMotion({ mu: p.mu, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY });
    case 'duffing': return createDuffingMotion({ damping: p.damping, forcing: p.forcing, angularFrequency: p.angularFrequency, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY });
    case 'lorenz': return createLorenzMotion({ sigma: p.sigma, rho: p.rho, beta: p.beta, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY, initialZ: p.initialZ });
  }
};

let controller: Controller | undefined;
let staticPath: SvgStaticPath | undefined;
let clearTrail: (() => void) | undefined;
let disposeTrail: (() => void) | undefined;

const disposeCurrent = (): void => {
  controller?.dispose();
  controller = undefined;
  staticPath?.dispose();
  staticPath = undefined;
  disposeTrail?.();
  disposeTrail = undefined;
  clearTrail = undefined;
};

const updateOutputs = (): void => {
  zoomValue.value = `${Number(zoomInput.value).toFixed(1)}×`;
  offsetXValue.value = `${Math.round(Number(offsetXInput.value) * 100)}%`;
  offsetYValue.value = `${Math.round(Number(offsetYInput.value) * 100)}%`;
  sizeValue.value = `${sizeInput.value} px`;
};

const activeStage = (renderer: RendererName): void => {
  canvas.hidden = renderer !== 'canvas';
  domViewport.hidden = renderer !== 'dom';
  svgViewport.toggleAttribute('hidden', renderer !== 'svg');
  const visibleOverflow = renderer !== 'canvas' && overflowSelect.value === 'visible';
  shell.style.overflow = visibleOverflow ? 'visible' : 'hidden';
  domViewport.style.overflow = visibleOverflow ? 'visible' : 'hidden';
  svgViewport.style.overflow = visibleOverflow ? 'visible' : 'hidden';
  overflowSelect.disabled = renderer === 'canvas';
  overflowNote.textContent = renderer === 'canvas'
    ? 'Canvas always clips drawing to its existing bitmap.'
    : 'Visible overflow paints outside the reserved box when surrounding CSS allows it.';
};

const setBoundsInputs = (bounds: Bounds): void => {
  if (customBounds.checked) return;
  for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) boundsInputs[key].value = String(bounds[key]);
};

const readFraming = (): Framing => {
  const fit = fitSelect.value as FrameFit;
  const framing: Framing = {
    fit,
    zoom: Number(zoomInput.value),
    offsetX: Number(offsetXInput.value),
    offsetY: Number(offsetYInput.value),
    padding: fit === 'contain' ? Number(sizeInput.value) * 1.5 + 3 : 0,
  };
  if (!customBounds.checked) return framing;
  if (Object.values(boundsInputs).some((input) => input.value.trim() === '')) {
    throw new RangeError('Custom bounds require all four numbers');
  }
  const bounds = {
    minX: Number(boundsInputs.minX.value), maxX: Number(boundsInputs.maxX.value),
    minY: Number(boundsInputs.minY.value), maxY: Number(boundsInputs.maxY.value),
  };
  if (Object.values(bounds).some((value) => !Number.isFinite(value)) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
    throw new RangeError('Custom bounds need finite minimums smaller than maximums');
  }
  return { ...framing, bounds };
};

const updateAvailability = (motion: MotionSource<unknown>): void => {
  const dom = rendererSelect.value === 'dom';
  trailInput.disabled = dom;
  pathInput.disabled = dom || motion.kind !== 'analytic';
  visualNote.textContent = dom
    ? 'DOM moves your styled marker; Canvas and SVG provide the optional trail and full-path helpers.'
    : motion.kind === 'stateful'
      ? 'Trails are available. Full paths require a periodic motion.'
      : 'Trails and full paths are optional and use bounded or cached geometry.';
};

const applyMarkerStyle = (): void => {
  const size = Number(sizeInput.value);
  const color = colorInput.value;
  domMarker.style.width = `${size * 2}px`;
  domMarker.style.height = `${size * 2}px`;
  domMarker.style.backgroundColor = color;
  domMarker.style.boxShadow = `0 0 ${size * 2}px ${color}`;
  const svgScale = svgViewport.viewBox.baseVal.width / (svgViewport.clientWidth || 960);
  svgCircle.setAttribute('r', String(size * svgScale));
  svgCircle.setAttribute('fill', color);
  svgCircle.setAttribute('stroke', color);
  svgFullPath.style.stroke = `${color}66`;
  svgTrailPath.style.stroke = `${color}aa`;
};

const updateStatus = (): void => {
  const overflow = rendererSelect.value === 'canvas' ? 'bitmap clipping' : `${overflowSelect.value} overflow`;
  status.textContent = `${motionSelect.selectedOptions[0].text} on ${rendererSelect.selectedOptions[0].text}; ${fitSelect.value} at ${zoomInput.value}×, position ${offsetXValue.value}/${offsetYValue.value}, ${overflow}.`;
};

const mount = (): void => {
  try {
    const motion = createMotion(motionSelect.value as MotionName);
    setBoundsInputs(motion.bounds);
    const framing = readFraming();
    disposeCurrent();
    const renderer = rendererSelect.value as RendererName;
    activeStage(renderer);
    updateAvailability(motion);
    applyMarkerStyle();
    const color = colorInput.value;
    const radius = Number(sizeInput.value);

    if (renderer === 'canvas') {
      const trail = trailInput.checked && !trailInput.disabled
        ? createCanvasTrail<unknown>({ color: `${color}aa`, width: 2 }) : undefined;
      const path = pathInput.checked && !pathInput.disabled && motion.kind === 'analytic'
        ? createCanvasPath(motion, { color: `${color}66`, width: 1 }) : undefined;
      clearTrail = trail?.clear;
      controller = animateCanvas(canvas, motion, {
        framing,
        marker: { color, radius },
        ...(trail || path ? { render(context, frame) {
          path?.(context, frame);
          trail?.(context, frame);
          renderCanvasMarker(context, frame, { color, radius });
        } } : {}),
      });
    } else if (renderer === 'dom') {
      controller = animateDom({ viewport: domViewport, marker: domMarker }, motion, { framing });
    } else {
      staticPath = pathInput.checked && !pathInput.disabled && motion.kind === 'analytic'
        ? createSvgStaticPath({ viewport: svgViewport, path: svgFullPath, motion, framing }) : undefined;
      const trail = trailInput.checked && !trailInput.disabled
        ? createSvgTrail<unknown>({ viewport: svgViewport, path: svgTrailPath }) : undefined;
      clearTrail = trail?.clear;
      disposeTrail = trail?.dispose;
      controller = animateSvg({ viewport: svgViewport, marker: svgMarker }, motion, {
        framing,
        ...(trail ? { render(frame, targets) {
          trail.render(frame);
          renderSvgMarker(frame, targets);
        } } : {}),
      });
    }
    pauseButton.textContent = 'Pause';
    updateStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
};

const updateFraming = (): void => {
  updateOutputs();
  try {
    const framing = readFraming();
    controller?.setFraming(framing);
    staticPath?.update(framing);
    updateStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
};

const renderParameterControls = (): void => {
  parameterControls.replaceChildren();
  const name = motionSelect.value as MotionName;
  const values = valuesFor(name);
  for (const definition of parameterDefinitions[name]) {
    const label = document.createElement('label');
    label.textContent = definition.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.required = true;
    input.step = String(definition.step ?? 'any');
    if (definition.min !== undefined) input.min = String(definition.min);
    if (definition.max !== undefined) input.max = String(definition.max);
    input.value = String(values[definition.key]);
    input.dataset.parameter = definition.key;
    input.addEventListener('change', () => {
      if (!input.checkValidity()) {
        status.textContent = `${definition.label} is outside its allowed range.`;
        return;
      }
      values[definition.key] = Number(input.value);
      mount();
    });
    label.append(input);
    parameterControls.append(label);
  }
};

motionSelect.addEventListener('change', () => {
  customBounds.checked = false;
  for (const input of Object.values(boundsInputs)) input.disabled = true;
  renderParameterControls();
  mount();
});
rendererSelect.addEventListener('change', mount);
for (const control of [fitSelect, zoomInput, offsetXInput, offsetYInput]) control.addEventListener('input', updateFraming);
overflowSelect.addEventListener('change', () => { activeStage(rendererSelect.value as RendererName); updateStatus(); });
for (const control of [colorInput, sizeInput, trailInput, pathInput]) control.addEventListener('change', () => { updateOutputs(); mount(); });
customBounds.addEventListener('change', () => {
  for (const input of Object.values(boundsInputs)) input.disabled = !customBounds.checked;
  updateFraming();
});
for (const input of Object.values(boundsInputs)) input.addEventListener('change', updateFraming);

pauseButton.addEventListener('click', () => {
  if (!controller) return;
  if (controller.isPaused()) {
    controller.resume();
    pauseButton.textContent = 'Pause';
  } else {
    controller.pause();
    pauseButton.textContent = 'Resume';
  }
});
resetButton.addEventListener('click', () => { clearTrail?.(); controller?.reset(); });
defaultsButton.addEventListener('click', () => {
  valuesByMotion.clear();
  motionSelect.value = 'ellipse';
  rendererSelect.value = 'canvas';
  fitSelect.value = 'cover';
  zoomInput.value = '1';
  offsetXInput.value = '0';
  offsetYInput.value = '0';
  overflowSelect.value = 'clip';
  colorInput.value = '#67e8f9';
  sizeInput.value = '9';
  trailInput.checked = false;
  pathInput.checked = false;
  customBounds.checked = false;
  for (const input of Object.values(boundsInputs)) input.disabled = true;
  updateOutputs();
  renderParameterControls();
  mount();
});
window.addEventListener('beforeunload', disposeCurrent, { once: true });

for (const input of Object.values(boundsInputs)) input.disabled = true;
updateOutputs();
renderParameterControls();
mount();

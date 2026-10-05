import {
  createDuffingMotion,
  createEllipseMotion,
  createHelixMotion,
  createLissajousMotion,
  createLorenzMotion,
  createRoseMotion,
  createVanderPolMotion,
  type Bounds,
  type DuffingState,
  type FrameFit,
  type Framing,
  type MotionSource,
  type OrthographicCamera,
  type Point3D,
} from '../src';
import { animateCanvas, renderCanvasMarker } from '../src/canvas';
import { createCanvasPath } from '../src/canvas/path';
import { createCanvasTrail } from '../src/canvas/trail';
import { animateDom } from '../src/dom';
import { animateSvg, renderSvgMarker } from '../src/svg';
import { createSvgStaticPath, type SvgStaticPath } from '../src/svg/path';
import { createSvgTrail } from '../src/svg/trail';
import type { Controller } from '../src/runtime';
import { animateWebGL, type WebGLColor, type WebGLController } from '../src/webgl';
import { orbitCamera } from './orbitCamera';

import './styles.css';

type MotionName = 'ellipse' | 'rose' | 'lissajous' | 'helix' | 'vander-pol' | 'duffing' | 'lorenz';
type RendererName = 'canvas' | 'webgl' | 'dom' | 'svg';
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
    { key: 'cyclesZ', label: 'Z cycles', value: 3, min: 1, max: 20, step: 1 },
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
const trailLengthInput = required<HTMLInputElement>('#trail-length');
const pathInput = required<HTMLInputElement>('#show-path');
const visualNote = required<HTMLElement>('#visual-note');
const webglView = required<HTMLSelectElement>('#webgl-view');
const webglCamera = required<HTMLSelectElement>('#webgl-camera');
const webglShape = required<HTMLSelectElement>('#webgl-shape');
const webglColorMode = required<HTMLSelectElement>('#webgl-color-mode');
const webglAccumulate = required<HTMLInputElement>('#webgl-accumulate');
const clearDrawingButton = required<HTMLButtonElement>('#clear-drawing');
const webglNote = required<HTMLElement>('#webgl-note');
const webglReadout = required<HTMLElement>('#webgl-frame');
const webglTime = required<HTMLOutputElement>('#webgl-time');
const webglSizeScale = required<HTMLOutputElement>('#webgl-size-scale');
const webglDepth = required<HTMLOutputElement>('#webgl-depth');
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
const webglCanvas = required<HTMLCanvasElement>('#webgl-stage');
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
    case 'lissajous': return createLissajousMotion({ periodSeconds: p.periodSeconds, cyclesX: p.cyclesX, cyclesY: p.cyclesY, cyclesZ: p.cyclesZ });
    case 'helix': return createHelixMotion({ periodSeconds: p.periodSeconds, turns: p.turns, fadeFraction: p.fadeFraction });
    case 'vander-pol': return createVanderPolMotion({ mu: p.mu, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY });
    case 'duffing': return createDuffingMotion({ damping: p.damping, forcing: p.forcing, angularFrequency: p.angularFrequency, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY });
    case 'lorenz': return createLorenzMotion({ sigma: p.sigma, rho: p.rho, beta: p.beta, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY, initialZ: p.initialZ });
  }
};

let controller: Controller | undefined;
let webglController: WebGLController | undefined;
let manuallyPaused = false;
let motionBounds: Bounds;
let staticPath: SvgStaticPath | undefined;
let clearTrail: (() => void) | undefined;
let disposeTrail: (() => void) | undefined;
let cameraPreset: 'front' | 'oblique' = 'oblique';
let draggedCamera: OrthographicCamera | undefined;
let cameraDrag: { pointerId: number; x: number; y: number } | undefined;

const endCameraDrag = (): void => {
  const pointerId = cameraDrag?.pointerId;
  cameraDrag = undefined;
  webglCanvas.removeAttribute('data-dragging');
  if (pointerId !== undefined && webglCanvas.hasPointerCapture(pointerId)) webglCanvas.releasePointerCapture(pointerId);
};

const disposeCurrent = (): void => {
  endCameraDrag();
  controller?.dispose();
  controller = undefined;
  webglController = undefined;
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
  webglCanvas.hidden = renderer !== 'webgl';
  webglReadout.hidden = renderer !== 'webgl';
  domViewport.hidden = renderer !== 'dom';
  svgViewport.toggleAttribute('hidden', renderer !== 'svg');
  const bitmap = renderer === 'canvas' || renderer === 'webgl';
  const visibleOverflow = !bitmap && overflowSelect.value === 'visible';
  shell.style.overflow = visibleOverflow ? 'visible' : 'hidden';
  domViewport.style.overflow = visibleOverflow ? 'visible' : 'hidden';
  svgViewport.style.overflow = visibleOverflow ? 'visible' : 'hidden';
  overflowSelect.disabled = bitmap;
  overflowNote.textContent = bitmap
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
  const webgl = rendererSelect.value === 'webgl';
  const spatialMotion = ['helix', 'lorenz', 'lissajous', 'duffing'].includes(motionSelect.value);
  if (!spatialMotion) webglView.value = 'planar';
  webglView.querySelector<HTMLOptionElement>('option[value="spatial"]')!.disabled = !spatialMotion;
  webglView.disabled = !webgl;
  webglCamera.disabled = !webgl || webglView.value !== 'spatial';
  const canOrbit = webgl && webglView.value === 'spatial';
  webglCanvas.toggleAttribute('data-orbit-enabled', canOrbit);
  webglCanvas.tabIndex = canOrbit ? 0 : -1;
  if (!canOrbit) endCameraDrag();
  for (const control of [webglShape, webglColorMode, webglAccumulate, clearDrawingButton]) control.disabled = !webgl;
  webglNote.textContent = !webgl
    ? 'Choose WebGL for 3D Lissajous, Helix, Lorenz, or Duffing phase space.'
    : motionSelect.value === 'duffing'
      ? 'Duffing phase space: radius shows displacement, height shows velocity, and angle shows forcing phase. Trails follow view changes; accumulation clears. Clear keeps time; reset restarts it.'
      : 'Lissajous, Helix, and Lorenz offer XYZ motion. Trails follow view changes; accumulation clears. Clear keeps motion time; reset restarts it. Drawing is opaque.';
  if (canOrbit) webglNote.textContent += ' Drag with a mouse or one finger to orbit; arrow keys also rotate the view. Choose a camera preset to restore its angle.';
  trailInput.disabled = dom;
  trailLengthInput.disabled = dom || !trailInput.checked;
  pathInput.disabled = dom || webgl || motion.kind !== 'analytic';
  const tailNote = 'Tail length bounds the retained trail samples; the oldest expire as motion advances.';
  visualNote.textContent = dom
    ? 'DOM moves your styled marker; Canvas, SVG, and WebGL provide optional trails. Full paths are available for periodic motions on Canvas and SVG.'
    : webgl
      ? `${tailNote} Trails follow the current view. Accumulate drawing retains markers in a fixed view; choose one. Both use hardware depth testing. Marker-size scale and view depth are independent.`
      : `${tailNote} Full paths ${motion.kind === 'stateful' ? 'require a periodic motion' : 'use cached geometry'}.`;
};

const spatialView = (): boolean => rendererSelect.value === 'webgl' && webglView.value === 'spatial';

// The example owns camera interaction; the rendering adapter receives snapshots.
const presetCameraForView = (): OrthographicCamera | undefined => {
  if (!spatialView()) return undefined;
  const helix = motionSelect.value === 'helix';
  const centerZ = helix ? valuesFor('helix').turns / 4 : 0;
  const extent = helix ? Math.max(1.7, centerZ + 0.6) : 1.7;
  // Duffing's angular state is displayed continuously around a cylinder;
  // Lissajous uses conventional XYZ axes. Both views use positive Y as up.
  if (motionSelect.value === 'duffing' || motionSelect.value === 'lissajous') {
    const viewExtent = motionSelect.value === 'duffing' ? 2.1 : 1.7;
    return {
      position: cameraPreset === 'front' ? { x: 0, y: 0, z: 7 } : { x: 5, y: 4, z: 5 },
      target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
      near: 0.1, far: 14,
      bounds: { minX: -viewExtent, maxX: viewExtent, minY: -viewExtent, maxY: viewExtent },
    };
  }
  return {
    position: cameraPreset === 'front'
      ? { x: 0, y: -7, z: centerZ }
      : { x: 5, y: -5, z: centerZ + 4 },
    target: { x: 0, y: 0, z: centerZ }, up: { x: 0, y: 0, z: 1 },
    near: 0.1, far: 14,
    bounds: { minX: -extent, maxX: extent, minY: -extent, maxY: extent },
  };
};

const cameraForView = (): OrthographicCamera | undefined => {
  const preset = presetCameraForView();
  if (!preset || !draggedCamera) return preset;
  const target = preset.target!;
  const previousTarget = draggedCamera.target!;
  return {
    ...preset,
    // Equation changes can move the helix's center; retain the viewing angle
    // around its new target and use the new motion's camera bounds.
    position: {
      x: target.x + draggedCamera.position.x - previousTarget.x,
      y: target.y + draggedCamera.position.y - previousTarget.y,
      z: target.z + draggedCamera.position.z - previousTarget.z,
    },
  };
};

const rotateCamera = (deltaX: number, deltaY: number): void => {
  const camera = cameraForView();
  if (!webglController || !camera || (deltaX === 0 && deltaY === 0)) return;
  const next = orbitCamera(camera, deltaX, deltaY);
  webglController.setCamera(next);
  draggedCamera = next;
  const alreadyDragged = webglCamera.value === 'custom';
  webglCamera.value = 'custom';
  if (!alreadyDragged) updateStatus();
};

const selectedColor = (): WebGLColor => {
  const hex = colorInput.value.slice(1);
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
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

const trailDescription = (): string => `bounded trail (${trailLengthInput.value} samples)`;

const readTrailLimit = (): number => {
  const count = trailLengthInput.valueAsNumber;
  if (!trailLengthInput.checkValidity() || !Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('Tail length must be a positive safe integer (1–9007199254740991 samples). The current animation is unchanged.');
  }
  return count;
};

const updateStatus = (): void => {
  const bitmap = rendererSelect.value === 'canvas' || rendererSelect.value === 'webgl';
  const overflow = bitmap ? 'bitmap clipping' : `${overflowSelect.value} overflow`;
  const webgl = rendererSelect.value === 'webgl'
    ? ` ${spatialView() ? `${motionSelect.value === 'duffing' ? '3D phase space' : 'True 3D'}, ${draggedCamera ? 'dragged' : cameraPreset} orthographic camera` : 'Planar coordinates'}; ${trailInput.checked ? trailDescription() : webglAccumulate.checked ? 'accumulating drawing' : 'current marker only'}.`
    : '';
  const trail = rendererSelect.value !== 'webgl' && rendererSelect.value !== 'dom' && trailInput.checked
    ? ` ${trailDescription()}.` : '';
  status.textContent = `${motionSelect.selectedOptions[0].text} on ${rendererSelect.selectedOptions[0].text}; ${fitSelect.value} at ${zoomInput.value}×, position ${offsetXValue.value}/${offsetYValue.value}, ${overflow}.${webgl}${trail}`;
};

const mount = (): void => {
  try {
    const motion = createMotion(motionSelect.value as MotionName);
    motionBounds = motion.bounds;
    updateAvailability(motion);
    setBoundsInputs(cameraForView()?.bounds ?? motion.bounds);
    const framing = readFraming();
    const maxSamples = trailInput.checked && !trailInput.disabled ? readTrailLimit() : 128;
    disposeCurrent();
    const renderer = rendererSelect.value as RendererName;
    activeStage(renderer);
    applyMarkerStyle();
    const color = colorInput.value;
    const radius = Number(sizeInput.value);

    if (renderer === 'canvas') {
      const trail = trailInput.checked && !trailInput.disabled
        ? createCanvasTrail<unknown>({ maxSamples, color: `${color}aa`, width: 2 }) : undefined;
      const path = pathInput.checked && !pathInput.disabled && motion.kind === 'analytic'
        ? createCanvasPath(motion, { color: `${color}66`, width: 1 }) : undefined;
      clearTrail = trail?.clear;
      controller = animateCanvas(canvas, motion, {
        framing, autoplay: !manuallyPaused,
        marker: { color, radius },
        ...(trail || path ? { render(context, frame) {
          path?.(context, frame);
          trail?.(context, frame);
          renderCanvasMarker(context, frame, { color, radius });
        } } : {}),
      });
    } else if (renderer === 'webgl') {
      webglController = animateWebGL(webglCanvas, motion, {
        framing, autoplay: !manuallyPaused,
        camera: cameraForView(), accumulate: webglAccumulate.checked,
        trail: trailInput.checked ? { maxSamples, width: 2 } : false,
        position(frame): Point3D {
          if (!spatialView()) return { x: frame.pose.x, y: frame.pose.y, z: frame.pose.z ?? 0 };
          if (motionSelect.value === 'duffing') {
            const { x, y, forcingPhaseRadians } = frame.state as DuffingState;
            // A positive, bounded radius avoids folding displacement through
            // the cylinder axis; circular phase has no wrap discontinuity.
            const radius = 1.2 + 0.8 * Math.tanh(x / 3);
            return { x: radius * Math.cos(forcingPhaseRadians), y: y / 3, z: radius * Math.sin(forcingPhaseRadians) };
          }
          // Lissajous, Helix, and Lorenz preserve XYZ coordinates in state.
          const { x, y, z } = frame.state as Point3D;
          return motionSelect.value === 'lorenz'
            ? { x: x / 25, y: y / 25, z: (z - 27.5) / 25 }
            : { x, y, z };
        },
        marker(frame) {
          webglTime.value = frame.elapsedSeconds.toFixed(3);
          webglSizeScale.value = (frame.pose.depth ?? 1).toFixed(2);
          webglDepth.value = frame.position.visibilityDepth.toFixed(3);
          const brightness = webglColorMode.value === 'time'
            ? 0.35 + 0.65 * (Math.sin(frame.elapsedSeconds * 2) + 1) / 2
            : webglColorMode.value === 'depth'
              ? 1 - 0.65 * Math.max(0, Math.min(1, frame.position.visibilityDepth))
              : 1;
          const [r, g, b] = selectedColor();
          return {
            radius: Number(sizeInput.value), color: [r * brightness, g * brightness, b * brightness],
            shape: webglShape.value === 'square' ? 'square' : 'circle',
          };
        },
      });
      controller = webglController;
    } else if (renderer === 'dom') {
      controller = animateDom({ viewport: domViewport, marker: domMarker }, motion, { framing, autoplay: !manuallyPaused });
    } else {
      staticPath = pathInput.checked && !pathInput.disabled && motion.kind === 'analytic'
        ? createSvgStaticPath({ viewport: svgViewport, path: svgFullPath, motion, framing }) : undefined;
      const trail = trailInput.checked && !trailInput.disabled
        ? createSvgTrail<unknown>({ viewport: svgViewport, path: svgTrailPath, maxSamples }) : undefined;
      clearTrail = trail?.clear;
      disposeTrail = trail?.dispose;
      controller = animateSvg({ viewport: svgViewport, marker: svgMarker }, motion, {
        framing, autoplay: !manuallyPaused,
        ...(trail ? { render(frame, targets) {
          trail.render(frame);
          renderSvgMarker(frame, targets);
        } } : {}),
      });
    }
    pauseButton.textContent = manuallyPaused ? 'Resume' : 'Pause';
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
  draggedCamera = undefined;
  webglCamera.value = cameraPreset;
  customBounds.checked = false;
  for (const input of Object.values(boundsInputs)) input.disabled = true;
  renderParameterControls();
  mount();
});
rendererSelect.addEventListener('change', () => {
  if (rendererSelect.value === 'webgl' && trailInput.checked) webglAccumulate.checked = false;
  mount();
});
for (const control of [fitSelect, zoomInput, offsetXInput, offsetYInput]) control.addEventListener('input', updateFraming);
overflowSelect.addEventListener('change', () => { activeStage(rendererSelect.value as RendererName); updateStatus(); });
for (const control of [colorInput, sizeInput]) control.addEventListener('change', () => {
  updateOutputs();
  if (webglController) updateFraming(); else mount();
});
pathInput.addEventListener('change', mount);
trailInput.addEventListener('change', () => {
  if (rendererSelect.value === 'webgl' && trailInput.checked) webglAccumulate.checked = false;
  mount();
});
trailLengthInput.addEventListener('change', mount);
webglAccumulate.addEventListener('change', () => {
  if (webglAccumulate.checked) trailInput.checked = false;
  mount();
});
for (const control of [webglShape, webglColorMode]) control.addEventListener('change', updateFraming);
for (const control of [webglView, webglCamera]) control.addEventListener('change', () => {
  if (!webglController) return;
  try {
    endCameraDrag();
    if (control === webglCamera) {
      cameraPreset = webglCamera.value as 'front' | 'oblique';
      draggedCamera = undefined;
    }
    customBounds.checked = false;
    for (const input of Object.values(boundsInputs)) input.disabled = true;
    // Coordinate views change the position mapping; camera presets reproject trails.
    if (control === webglView) webglController.clear();
    const camera = cameraForView();
    setBoundsInputs(camera?.bounds ?? motionBounds);
    webglCamera.disabled = !spatialView();
    updateAvailability(createMotion(motionSelect.value as MotionName));
    webglController.setCamera(camera);
    updateFraming();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

webglCanvas.addEventListener('pointerdown', (event) => {
  if (!spatialView() || !webglController || !event.isPrimary || event.button !== 0 || cameraDrag) return;
  webglCanvas.setPointerCapture(event.pointerId);
  cameraDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  webglCanvas.setAttribute('data-dragging', '');
  webglCanvas.focus({ preventScroll: true });
  event.preventDefault();
});
webglCanvas.addEventListener('pointermove', (event) => {
  if (cameraDrag?.pointerId !== event.pointerId) return;
  if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) { endCameraDrag(); return; }
  const dx = event.clientX - cameraDrag.x;
  const dy = event.clientY - cameraDrag.y;
  cameraDrag.x = event.clientX;
  cameraDrag.y = event.clientY;
  try { rotateCamera(dx, dy); }
  catch (error) { endCameraDrag(); status.textContent = error instanceof Error ? error.message : String(error); }
  event.preventDefault();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  webglCanvas.addEventListener(type, (event) => {
    if (cameraDrag?.pointerId === event.pointerId) endCameraDrag();
  });
}
webglCanvas.addEventListener('keydown', (event) => {
  if (!spatialView()) return;
  const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
  if (!delta) return;
  rotateCamera(delta[0], delta[1]);
  event.preventDefault();
});
clearDrawingButton.addEventListener('click', () => {
  webglController?.clear();
  updateStatus();
  status.textContent += ' Drawing cleared; motion time is unchanged.';
});
customBounds.addEventListener('change', () => {
  for (const input of Object.values(boundsInputs)) input.disabled = !customBounds.checked;
  updateFraming();
});
for (const input of Object.values(boundsInputs)) input.addEventListener('change', updateFraming);

pauseButton.addEventListener('click', () => {
  if (!controller) return;
  if (manuallyPaused) {
    controller.resume();
    manuallyPaused = false;
    pauseButton.textContent = 'Pause';
  } else {
    controller.pause();
    manuallyPaused = true;
    pauseButton.textContent = 'Resume';
  }
});
resetButton.addEventListener('click', () => { clearTrail?.(); controller?.reset(); updateStatus(); });
defaultsButton.addEventListener('click', () => {
  valuesByMotion.clear();
  manuallyPaused = false;
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
  trailLengthInput.value = '128';
  pathInput.checked = false;
  webglView.value = 'planar';
  webglCamera.value = 'oblique';
  cameraPreset = 'oblique';
  draggedCamera = undefined;
  webglShape.value = 'circle';
  webglColorMode.value = 'solid';
  webglAccumulate.checked = false;
  customBounds.checked = false;
  for (const input of Object.values(boundsInputs)) input.disabled = true;
  updateOutputs();
  renderParameterControls();
  mount();
});
window.addEventListener('beforeunload', disposeCurrent, { once: true });
window.addEventListener('blur', endCameraDrag);

for (const input of Object.values(boundsInputs)) input.disabled = true;
updateOutputs();
renderParameterControls();
mount();

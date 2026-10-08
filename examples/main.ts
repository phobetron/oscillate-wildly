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
  type HelixRotationDirection,
  type HelixFlowDirection,
  type MotionSource,
  type MarkerScaleOptions,
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
type Parameter = {
  key: string; label: string; value: number; step?: number; min?: number; max?: number;
  minExclusive?: boolean; maxExclusive?: boolean; description?: string;
};
const positiveRange = { min: 0, minExclusive: true } as const;
const runawayLimitParameter: Parameter = {
  key: 'runawayLimit', label: 'Runaway state limit', value: 1_000_000, ...positiveRange,
  description: "Reset the motion if any model state's absolute value exceeds this limit.",
};

const parameterDefinitions: Record<MotionName, readonly Parameter[]> = {
  ellipse: [
    { key: 'periodSeconds', label: 'Period (seconds)', value: 15, ...positiveRange },
    { key: 'radiusX', label: 'Horizontal radius', value: 1, ...positiveRange },
    { key: 'radiusY', label: 'Vertical radius', value: 1, ...positiveRange },
  ],
  rose: [{ key: 'periodSeconds', label: 'Period (seconds)', value: 15 * Math.PI, ...positiveRange }],
  lissajous: [
    { key: 'periodSeconds', label: 'Period (seconds)', value: 60, ...positiveRange },
    { key: 'cyclesX', label: 'Horizontal cycles', value: 5, min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },
    { key: 'cyclesY', label: 'Vertical cycles', value: 4, min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },
    { key: 'cyclesZ', label: 'Z cycles', value: 3, min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },
  ],
  helix: [
    { key: 'periodSeconds', label: 'Period (seconds)', value: 12, ...positiveRange },
    { key: 'turns', label: 'Turns', value: 4, ...positiveRange },
    { key: 'fadeFraction', label: 'End fade fraction', value: 0.05, ...positiveRange, max: 0.5, maxExclusive: true },
  ],
  'vander-pol': [
    { key: 'mu', label: 'Nonlinearity μ', value: 1 },
    { key: 'timeScale', label: 'Playback speed', value: 2.4, ...positiveRange },
    { key: 'initialX', label: 'Initial X', value: 1 },
    { key: 'initialY', label: 'Initial Y', value: 1 },
    runawayLimitParameter,
  ],
  duffing: [
    { key: 'damping', label: 'Damping', value: 0.25 },
    { key: 'forcing', label: 'Forcing', value: 0.3 },
    { key: 'angularFrequency', label: 'Angular frequency', value: 1 },
    { key: 'timeScale', label: 'Playback speed', value: 2.4, ...positiveRange },
    { key: 'initialX', label: 'Initial X', value: 0.2 },
    { key: 'initialY', label: 'Initial Y', value: -0.3 },
    runawayLimitParameter,
  ],
  lorenz: [
    { key: 'sigma', label: 'Sigma σ', value: 10 },
    { key: 'rho', label: 'Rho ρ', value: 28 },
    { key: 'beta', label: 'Beta β', value: 8 / 3 },
    { key: 'timeScale', label: 'Playback speed', value: 0.24, ...positiveRange },
    { key: 'initialX', label: 'Initial X', value: 18.89688574723792 },
    { key: 'initialY', label: 'Initial Y', value: 2.799477162418296 },
    { key: 'initialZ', label: 'Initial Z', value: 53.555488125917094 },
    runawayLimitParameter,
  ],
};

const required = <ElementType extends Element>(selector: string): ElementType => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};

const motionSelect = required<HTMLSelectElement>('#motion');
const rendererNames: readonly RendererName[] = ['webgl', 'canvas', 'dom', 'svg'];
let selectedRenderer: RendererName = 'webgl';
const true3DMotions = new Set<MotionName>(['helix', 'lissajous', 'lorenz']);
const supportsSpatialCoordinates = (name: MotionName): boolean => true3DMotions.has(name) || name === 'duffing';
const motionOptions = Array.from(motionSelect.options).sort((a, b) => a.text.localeCompare(b.text));
let hasExplicitMotion = false;

const renderMotionOptions = (preferred?: MotionName): void => {
  motionSelect.replaceChildren();
  if (selectedRenderer === 'webgl') {
    for (const [label, isTrue3D] of [['True 3D', true], ['Other motions', false]] as const) {
      const group = document.createElement('optgroup');
      group.label = label;
      group.append(...motionOptions.filter((option) => true3DMotions.has(option.value as MotionName) === isTrue3D));
      motionSelect.append(group);
    }
  } else {
    motionSelect.append(...motionOptions);
  }
  motionSelect.value = preferred ?? motionSelect.options[0].value;
};

const defaultWebGLCoordinates = (): void => {
  webglView.value = supportsSpatialCoordinates(motionSelect.value as MotionName) ? 'spatial' : 'planar';
};
const rendererTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab][data-renderer]'));
const rendererPanels = rendererNames.map((name) => required<HTMLElement>(`#panel-${name}`));
const tablist = required<HTMLElement>('[role=tablist]');
const librarySettings = required<HTMLElement>('#library-settings');
const previewControls = required<HTMLElement>('#preview-controls');
const markerConfig = required<HTMLFieldSetElement>('#marker-config');
const nativeMarkerSlot = required<HTMLElement>('#native-marker-slot');
const presentationMarkerSlot = required<HTMLElement>('#presentation-marker-slot');
const historyConfig = required<HTMLElement>('#history-config');
const cameraConfig = required<HTMLElement>('#camera-config');
const shadingConfig = required<HTMLElement>('#shading-config');
const pathControl = required<HTMLElement>('#path-control');
const cameraPresetControl = required<HTMLElement>('#camera-preset-control');
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
const depthStrengthInput = required<HTMLInputElement>('#depth-strength');
const clampMarkerScaleInput = required<HTMLInputElement>('#clamp-marker-scale');
const minMarkerScaleInput = required<HTMLInputElement>('#min-marker-scale');
const maxMarkerScaleInput = required<HTMLInputElement>('#max-marker-scale');
const trailInput = required<HTMLInputElement>('#show-trail');
const trailLengthInput = required<HTMLInputElement>('#trail-length');
const pathInput = required<HTMLInputElement>('#show-path');
const visualNote = required<HTMLElement>('#visual-note');
const webglView = required<HTMLSelectElement>('#webgl-view');
const webglCamera = required<HTMLSelectElement>('#webgl-camera');
const webglShape = required<HTMLSelectElement>('#webgl-shape');
const webglLighting = required<HTMLInputElement>('#webgl-lighting');
const webglAccumulate = required<HTMLInputElement>('#webgl-accumulate');
const webglPaint = required<HTMLInputElement>('#webgl-paint');
const paintLimitBehavior = required<HTMLSelectElement>('#paint-limit-behavior');
const paintLimitBehaviorControl = required<HTMLElement>('#paint-limit-behavior-control');
let mountedPaintLimitBehavior = paintLimitBehavior.value;
const accumulationLengthInput = required<HTMLInputElement>('#accumulation-length');
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
const shellFor = (renderer: RendererName) => required<HTMLElement>(`#panel-${renderer} .stage-shell`);
const canvas = required<HTMLCanvasElement>('#canvas-stage');
const webglCanvas = required<HTMLCanvasElement>('#webgl-stage');
const domViewport = required<HTMLElement>('#dom-stage');
const domMarker = required<HTMLElement>('#dom-marker');
const svgViewport = required<SVGSVGElement>('#svg-stage');
const svgMarker = required<SVGGraphicsElement>('#svg-marker');
const svgCircle = required<SVGCircleElement>('#svg-marker circle');
const svgFullPath = required<SVGPathElement>('#svg-full-path');
const svgTrailPath = required<SVGPathElement>('#svg-trail');

const helixRotationOptions: readonly { value: HelixRotationDirection; label: string }[] = [
  { value: 'counter-clockwise', label: 'Counter-clockwise' },
  { value: 'clockwise', label: 'Clockwise' },
];
const helixFlowOptions: readonly { value: HelixFlowDirection; label: string }[] = [
  { value: 'top-to-bottom', label: 'Top to bottom' },
  { value: 'bottom-to-top', label: 'Bottom to top' },
  { value: 'left-to-right', label: 'Left to right' },
  { value: 'right-to-left', label: 'Right to left' },
];
let helixRotationDirection: HelixRotationDirection = helixRotationOptions[0].value;
let helixFlowDirection: HelixFlowDirection = helixFlowOptions[0].value;

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
    case 'helix': return createHelixMotion({ periodSeconds: p.periodSeconds, turns: p.turns, fadeFraction: p.fadeFraction, rotationDirection: helixRotationDirection, flowDirection: helixFlowDirection });
    case 'vander-pol': return createVanderPolMotion({ mu: p.mu, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY, runawayLimit: p.runawayLimit });
    case 'duffing': return createDuffingMotion({ damping: p.damping, forcing: p.forcing, angularFrequency: p.angularFrequency, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY, runawayLimit: p.runawayLimit });
    case 'lorenz': return createLorenzMotion({ sigma: p.sigma, rho: p.rho, beta: p.beta, timeScale: p.timeScale, initialX: p.initialX, initialY: p.initialY, initialZ: p.initialZ, runawayLimit: p.runawayLimit });
  }
};

let controller: Controller | undefined;
let webglController: WebGLController | undefined;
let manuallyPaused = false;
let activeMotionKind: MotionSource<unknown>['kind'] = 'analytic';
let activeMotionName: MotionName = motionSelect.value as MotionName;
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
  const panel = required<HTMLElement>(`#panel-${renderer}`);
  for (const candidate of rendererPanels) {
    candidate.hidden = candidate !== panel;
    candidate.tabIndex = 0;
  }
  for (const tab of rendererTabs) {
    const selected = tab.dataset.renderer === renderer;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const settingsSlot = panel.querySelector('[data-settings-slot]')!;
  const previewSlot = panel.querySelector('[data-preview-slot]')!;
  if (librarySettings.parentElement !== settingsSlot) settingsSlot.append(librarySettings);
  if (previewControls.parentElement !== previewSlot) previewSlot.append(previewControls);
  const styledElement = renderer === 'dom' || renderer === 'svg';
  const markerSlot = styledElement ? presentationMarkerSlot : nativeMarkerSlot;
  if (markerConfig.parentElement !== markerSlot) markerSlot.append(markerConfig);
  markerConfig.querySelector('legend')!.textContent = styledElement ? 'Marker element styling' : 'Marker';
  canvas.hidden = renderer !== 'canvas';
  webglCanvas.hidden = renderer !== 'webgl';
  webglReadout.hidden = renderer !== 'webgl';
  domViewport.hidden = renderer !== 'dom';
  svgViewport.toggleAttribute('hidden', renderer !== 'svg');
  const bitmap = renderer === 'canvas' || renderer === 'webgl';
  const visibleOverflow = !bitmap && overflowSelect.value === 'visible';
  shellFor(renderer).style.overflow = visibleOverflow ? 'visible' : 'hidden';
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
  const markerScale = readMarkerScale();
  const nativePeak = motionSelect.value === 'ellipse' ? 1.5 : 1;
  const effectivePeak = Math.max(markerScale.minMarkerScale ?? 0, Math.min(
    markerScale.maxMarkerScale ?? Infinity,
    1 + (markerScale.depthStrength ?? 1) * (nativePeak - 1),
  ));
  // Oversized markers can exceed the viewport; padding must remain finite.
  const markerPadding = Math.min(Number.MAX_VALUE, Math.max(1.5, effectivePeak) * Number(sizeInput.value) + 3);
  const framing: Framing = {
    fit,
    zoom: Number(zoomInput.value),
    offsetX: Number(offsetXInput.value),
    offsetY: Number(offsetYInput.value),
    padding: fit === 'contain' ? markerPadding : 0,
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

const updateAvailability = (motion: Pick<MotionSource<unknown>, 'kind'>): void => {
  const dom = selectedRenderer === 'dom';
  const webgl = selectedRenderer === 'webgl';
  depthStrengthInput.disabled = ['rose', 'vander-pol'].includes(motionSelect.value);
  minMarkerScaleInput.disabled = maxMarkerScaleInput.disabled = !clampMarkerScaleInput.checked;
  const spatialMotion = supportsSpatialCoordinates(motionSelect.value as MotionName);
  if (!spatialMotion) webglView.value = 'planar';
  webglView.querySelector<HTMLOptionElement>('option[value="spatial"]')!.disabled = !spatialMotion;
  webglView.disabled = !webgl;
  webglCamera.disabled = !webgl || webglView.value !== 'spatial';
  const canOrbit = webgl && webglView.value === 'spatial';
  for (const control of document.querySelectorAll<HTMLElement>('[data-renderers]')) {
    control.hidden = !control.dataset.renderers!.split(' ').includes(selectedRenderer);
  }
  historyConfig.hidden = dom;
  cameraConfig.hidden = !canOrbit;
  cameraPresetControl.hidden = !canOrbit;
  shadingConfig.hidden = !canOrbit;
  pathControl.hidden = dom || webgl || motion.kind !== 'analytic';
  webglCanvas.toggleAttribute('data-orbit-enabled', canOrbit);
  webglCanvas.tabIndex = canOrbit ? 0 : -1;
  if (!canOrbit) endCameraDrag();
  for (const control of [webglShape, webglAccumulate, webglPaint, clearDrawingButton]) control.disabled = !webgl;
  webglLighting.disabled = !canOrbit;
  const painting = webglPaint.checked;
  paintLimitBehaviorControl.hidden = !webgl || !painting;
  paintLimitBehavior.disabled = !webgl || !painting;
  accumulationLengthInput.disabled = !webgl || (!webglAccumulate.checked && !painting);
  webglNote.textContent = !webgl
    ? 'Choose WebGL for 3D Lissajous, Helix, Lorenz, or Duffing phase space.'
    : motionSelect.value === 'duffing'
      ? 'Duffing phase space: radius shows displacement, height shows velocity, and angle shows forcing phase. Retained drawing rotates with the camera. Sample limits bound retained geometry. Clear keeps time; reset restarts it.'
      : 'Lissajous, Helix, and Lorenz offer XYZ motion. Retained drawing rotates with the camera. Sample limits bound retained geometry. Clear keeps motion time; reset restarts it. Drawing is opaque.';
  if (canOrbit) webglNote.textContent += ' Drag with a mouse or one finger to orbit; arrow keys also rotate the view. Choose a camera preset to restore its angle.';
  if (painting && webgl) webglNote.textContent += paintLimitBehavior.value === 'pause'
    ? ' Ribbon paint stays until cleared; reaching its limit pauses the animation.'
    : ' At the ribbon paint limit, motion continues and the oldest paint is replaced.';
  trailInput.disabled = dom;
  trailLengthInput.disabled = dom || !trailInput.checked;
  pathInput.disabled = dom || webgl || motion.kind !== 'analytic';
  const tailNote = 'Tail length bounds the retained trail samples; the oldest expire as motion advances.';
  visualNote.textContent = dom
    ? 'DOM moves your styled marker; Canvas, SVG, and WebGL provide optional trails. Full paths are available for periodic motions on Canvas and SVG.'
    : webgl
      ? `${tailNote} Paint ribbon uses the marker radius. At sample limit either pauses motion and preserves paint or trims the oldest paint as motion continues. Marker-size scale and view depth are independent.`
      : `${tailNote} Full paths ${motion.kind === 'stateful' ? 'require a periodic motion' : 'use cached geometry'}.`;
};

const spatialView = (): boolean => selectedRenderer === 'webgl' && webglView.value === 'spatial';

// The example owns camera interaction; the rendering adapter receives snapshots.
const presetCameraForView = (): OrthographicCamera | undefined => {
  if (!spatialView()) return undefined;
  const helix = motionSelect.value === 'helix';
  const axisCenter = helix ? valuesFor('helix').turns / 4 : 0;
  const extent = helix ? Math.max(1.7, axisCenter + 0.6) : 1.7;
  if (helix) {
    const horizontal = helixFlowDirection === 'left-to-right' || helixFlowDirection === 'right-to-left';
    return {
      position: horizontal
        ? cameraPreset === 'front' ? { x: axisCenter, y: -7, z: 0 } : { x: axisCenter + 5, y: -5, z: 4 }
        : cameraPreset === 'front' ? { x: 0, y: 7, z: axisCenter } : { x: 5, y: 5, z: axisCenter - 4 },
      target: horizontal ? { x: axisCenter, y: 0, z: 0 } : { x: 0, y: 0, z: axisCenter },
      up: horizontal ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 },
      near: 0.1, far: 14,
      bounds: { minX: -extent, maxX: extent, minY: -extent, maxY: extent },
    };
  }
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
      ? { x: 0, y: -7, z: 0 }
      : { x: 5, y: -5, z: 4 },
    target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 },
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

const readAccumulationLimit = (): number => {
  const count = accumulationLengthInput.valueAsNumber;
  if (!accumulationLengthInput.checkValidity() || !Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('Retained samples / paint limit must be a positive safe integer (1–9007199254740991 samples). The current animation is unchanged.');
  }
  return count;
};

const readMarkerScale = (): MarkerScaleOptions => {
  const read = (input: HTMLInputElement, label: string): number => {
    const value = input.valueAsNumber;
    // Disabled strength is still persisted and validated for the next motion.
    if (input.value.trim() === '' || !input.checkValidity() || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} must be finite and nonnegative. The current animation is unchanged.`);
    }
    return value;
  };
  const depthStrength = read(depthStrengthInput, 'Depth strength');
  if (!clampMarkerScaleInput.checked) return { depthStrength };
  const minMarkerScale = read(minMarkerScaleInput, 'Minimum marker scale');
  const maxMarkerScale = read(maxMarkerScaleInput, 'Maximum marker scale');
  if (minMarkerScale > maxMarkerScale) {
    throw new RangeError('Minimum marker scale must not exceed maximum marker scale. The current animation is unchanged.');
  }
  return { depthStrength, minMarkerScale, maxMarkerScale };
};

const updateStatus = (): void => {
  const bitmap = selectedRenderer === 'canvas' || selectedRenderer === 'webgl';
  const overflow = bitmap ? 'bitmap clipping' : `${overflowSelect.value} overflow`;
  const webgl = selectedRenderer === 'webgl'
    ? ` ${spatialView() ? `${motionSelect.value === 'duffing' ? '3D phase space' : 'True 3D'}, ${draggedCamera ? 'dragged' : cameraPreset} orthographic camera` : 'Planar coordinates'}; ${trailInput.checked ? trailDescription() : webglPaint.checked ? `ribbon paint brush (${accumulationLengthInput.value} sample limit)` : webglAccumulate.checked ? `accumulating drawing (${accumulationLengthInput.value} samples)` : 'current marker only'}.`
    : '';
  const trail = selectedRenderer !== 'webgl' && selectedRenderer !== 'dom' && trailInput.checked
    ? ` ${trailDescription()}.` : '';
  status.textContent = `${motionSelect.selectedOptions[0].text} on ${rendererTabs.find((tab) => tab.dataset.renderer === selectedRenderer)!.textContent!.trim()}; ${fitSelect.value} at ${zoomInput.value}×, position ${offsetXValue.value}/${offsetYValue.value}, ${overflow}.${webgl}${trail}`;
  if (webglController?.isPaintFull() && webglPaint.checked) status.textContent += paintLimitBehavior.value === 'pause'
    ? ' Paint limit reached; clear or reset to paint again.'
    : ' Paint capacity reached; the oldest paint is replaced as motion continues.';
};

const mount = (): boolean => {
  try {
    const motionName = motionSelect.value as MotionName;
    const motion = createMotion(motionName);
    motionBounds = motion.bounds;
    updateAvailability(motion);
    setBoundsInputs(cameraForView()?.bounds ?? motion.bounds);
    const framing = readFraming();
    const markerScale = readMarkerScale();
    const maxSamples = trailInput.checked && !trailInput.disabled ? readTrailLimit() : 128;
    const accumulationMaxSamples = selectedRenderer === 'webgl' && (webglAccumulate.checked || webglPaint.checked) ? readAccumulationLimit() : 12000;
    disposeCurrent();
    const renderer = selectedRenderer as RendererName;
    activeMotionKind = motion.kind;
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
        framing, markerScale, autoplay: !manuallyPaused,
        marker: { color, radius },
        ...(trail || path ? { render(context, frame) {
          path?.(context, frame);
          trail?.(context, frame);
          renderCanvasMarker(context, frame, { color, radius });
        } } : {}),
      });
    } else if (renderer === 'webgl') {
      webglController = animateWebGL(webglCanvas, motion, {
        framing, markerScale, autoplay: !manuallyPaused, lighting: spatialView() && webglLighting.checked,
        camera: cameraForView(), accumulate: webglAccumulate.checked ? { maxSamples: accumulationMaxSamples } : false,
        trail: trailInput.checked ? { maxSamples, width: 2 } : false,
        paint: webglPaint.checked ? { maxSamples: accumulationMaxSamples, limitBehavior: paintLimitBehavior.value as 'pause' | 'trim-oldest' } : false,
        onPaintLimit() {
          manuallyPaused = true;
          pauseButton.textContent = 'Resume';
          updateStatus();
        },
        position(frame): Point3D {
          if (!spatialView()) return { x: frame.pose.x, y: frame.pose.y, z: frame.pose.z ?? 0 };
          if (motionName === 'duffing') {
            const { x, y, forcingPhaseRadians } = frame.state as DuffingState;
            // A positive, bounded radius avoids folding displacement through
            // the cylinder axis; circular phase has no wrap discontinuity.
            const radius = 1.2 + 0.8 * Math.tanh(x / 3);
            return { x: radius * Math.cos(forcingPhaseRadians), y: y / 3, z: radius * Math.sin(forcingPhaseRadians) };
          }
          // Lissajous, Helix, and Lorenz preserve XYZ coordinates in state.
          const { x, y, z } = frame.state as Point3D;
          return motionName === 'lorenz'
            ? { x: x / 25, y: y / 25, z: (z - 27.5) / 25 }
            : { x, y, z };
        },
        marker(frame) {
          webglTime.value = frame.elapsedSeconds.toFixed(3);
          webglSizeScale.value = (frame.pose.depth ?? 1).toFixed(2);
          webglDepth.value = frame.position.visibilityDepth.toFixed(3);
          return {
            radius: Number(sizeInput.value), color: selectedColor(),
            shape: webglShape.value as 'circle' | 'square',
          };
        },
      });
      controller = webglController;
    } else if (renderer === 'dom') {
      controller = animateDom({ viewport: domViewport, marker: domMarker }, motion, { framing, markerScale, autoplay: !manuallyPaused });
    } else {
      staticPath = pathInput.checked && !pathInput.disabled && motion.kind === 'analytic'
        ? createSvgStaticPath({ viewport: svgViewport, path: svgFullPath, motion, framing }) : undefined;
      const trail = trailInput.checked && !trailInput.disabled
        ? createSvgTrail<unknown>({ viewport: svgViewport, path: svgTrailPath, maxSamples }) : undefined;
      clearTrail = trail?.clear;
      disposeTrail = trail?.dispose;
      controller = animateSvg({ viewport: svgViewport, marker: svgMarker }, motion, {
        framing, markerScale, autoplay: !manuallyPaused,
        ...(trail ? { render(frame, targets) {
          trail.render(frame);
          renderSvgMarker(frame, targets);
        } } : {}),
      });
    }
    activeMotionName = motionName;
    mountedPaintLimitBehavior = paintLimitBehavior.value;
    pauseButton.textContent = manuallyPaused ? 'Resume' : 'Pause';
    updateStatus();
    return true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    return false;
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

const mountParameterChange = (apply: () => void, revert: () => void): boolean => {
  const previousCamera = draggedCamera;
  const previousCameraChoice = webglCamera.value;
  const previousBounds = motionBounds;
  const previousBoundsValues = Object.values(boundsInputs).map((input) => input.value);
  apply();
  if (mount()) return true;
  // Failed validation retains the old source; controls must describe that source.
  revert();
  draggedCamera = previousCamera;
  webglCamera.value = previousCameraChoice;
  motionBounds = previousBounds;
  updateAvailability({ kind: activeMotionKind });
  Object.values(boundsInputs).forEach((input, index) => { input.value = previousBoundsValues[index]; });
  return false;
};

const appendChoiceParameter = <Value extends string>(
  key: string, text: string, options: readonly { value: Value; label: string }[],
  value: Value, update: (value: Value) => void,
): void => {
  const label = document.createElement('label');
  label.textContent = text;
  const select = document.createElement('select');
  select.id = `helix-${key}`;
  select.dataset.parameter = key;
  for (const option of options) select.add(new Option(option.label, option.value));
  select.value = value;
  select.addEventListener('change', () => {
    const option = options.find((candidate) => candidate.value === select.value);
    if (!option) return;
    if (mountParameterChange(() => update(option.value), () => {
      update(value);
      select.value = value;
    })) value = option.value;
  });
  label.append(select);
  parameterControls.append(label);
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
    if (definition.description) input.title = definition.description;
    input.step = String(definition.step ?? 'any');
    if (definition.min !== undefined) input.min = String(definition.min);
    if (definition.max !== undefined) input.max = String(definition.max);
    input.value = String(values[definition.key]);
    input.dataset.parameter = definition.key;
    input.addEventListener('change', () => {
      const candidate = input.valueAsNumber;
      const belowMinimum = definition.min !== undefined && (definition.minExclusive ? candidate <= definition.min : candidate < definition.min);
      const aboveMaximum = definition.max !== undefined && (definition.maxExclusive ? candidate >= definition.max : candidate > definition.max);
      if (!input.checkValidity() || !Number.isFinite(candidate) || belowMinimum || aboveMaximum) {
        input.value = String(values[definition.key]);
        status.textContent = `${definition.label} is outside its allowed range.`;
        return;
      }
      const previousValue = values[definition.key];
      mountParameterChange(() => { values[definition.key] = candidate; }, () => {
        values[definition.key] = previousValue;
        input.value = String(previousValue);
      });
    });
    label.append(input);
    parameterControls.append(label);
  }
  if (name === 'helix') {
    appendChoiceParameter('rotationDirection', 'Rotation direction', helixRotationOptions, helixRotationDirection, (value) => {
      helixRotationDirection = value;
    });
    appendChoiceParameter('flowDirection', 'Flow direction', helixFlowOptions, helixFlowDirection, (value) => {
      helixFlowDirection = value;
      // Axis orientation changes the camera up vector; restore the chosen preset.
      draggedCamera = undefined;
      webglCamera.value = cameraPreset;
    });
  }
};

for (const control of [depthStrengthInput, clampMarkerScaleInput, minMarkerScaleInput, maxMarkerScaleInput]) {
  control.addEventListener('change', () => {
    minMarkerScaleInput.disabled = maxMarkerScaleInput.disabled = !clampMarkerScaleInput.checked;
    try {
      const markerScale = readMarkerScale();
      readFraming(); // Validate framing before applying either presentation change.
      controller?.setMarkerScale(markerScale);
      updateFraming();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

motionSelect.addEventListener('change', () => {
  try {
    readMarkerScale();
  } catch (error) {
    motionSelect.value = activeMotionName;
    status.textContent = error instanceof Error ? error.message : String(error);
    return;
  }
  hasExplicitMotion = true;
  if (selectedRenderer === 'webgl') defaultWebGLCoordinates();
  draggedCamera = undefined;
  webglCamera.value = cameraPreset;
  customBounds.checked = false;
  for (const input of Object.values(boundsInputs)) input.disabled = true;
  renderParameterControls();
  mount();
});
const selectRenderer = (renderer: RendererName): void => {
  if (selectedRenderer === renderer) return;
  const previous = selectedRenderer;
  const previousAccumulation = webglAccumulate.checked;
  const previousPaint = webglPaint.checked;
  const previousView = webglView.value;
  const previousMotion = motionSelect.value as MotionName;
  const previousDraggedCamera = draggedCamera;
  const previousCameraOption = webglCamera.value;
  selectedRenderer = renderer;
  renderMotionOptions(hasExplicitMotion ? previousMotion : undefined);
  const motionChanged = motionSelect.value !== previousMotion;
  if (motionChanged) {
    draggedCamera = undefined;
    webglCamera.value = cameraPreset;
    renderParameterControls();
  }
  if (renderer === 'webgl') defaultWebGLCoordinates();
  if (renderer === 'webgl' && trailInput.checked) { webglAccumulate.checked = false; webglPaint.checked = false; }
  if (!mount() && required<HTMLElement>(`#panel-${renderer}`).hidden) {
    // Validation failed before the panel switch. Keep selection and controls
    // coherent even if the current renderer could not create a controller.
    selectedRenderer = previous;
    renderMotionOptions(previousMotion);
    if (motionChanged) renderParameterControls();
    draggedCamera = previousDraggedCamera;
    webglCamera.value = previousCameraOption;
    webglAccumulate.checked = previousAccumulation;
    webglPaint.checked = previousPaint;
    webglView.value = previousView;
    updateAvailability({ kind: activeMotionKind });
    activeStage(previous);
    rendererTabs.find((tab) => tab.dataset.renderer === previous)!.focus({ preventScroll: true });
  }
};
for (const tab of rendererTabs) {
  tab.addEventListener('click', () => selectRenderer(tab.dataset.renderer as RendererName));
  tab.addEventListener('focus', () => {
    for (const candidate of rendererTabs) candidate.tabIndex = candidate === tab ? 0 : -1;
  });
  tab.addEventListener('keydown', (event) => {
    const index = rendererTabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % rendererTabs.length
      : event.key === 'ArrowLeft' ? (index + rendererTabs.length - 1) % rendererTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? rendererTabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    rendererTabs[next].focus();
  });
}
tablist.addEventListener('focusout', (event) => {
  if (event.relatedTarget instanceof Node && tablist.contains(event.relatedTarget)) return;
  for (const tab of rendererTabs) tab.tabIndex = tab.dataset.renderer === selectedRenderer ? 0 : -1;
});
for (const control of [fitSelect, zoomInput, offsetXInput, offsetYInput]) control.addEventListener('input', updateFraming);
overflowSelect.addEventListener('change', () => { activeStage(selectedRenderer as RendererName); updateStatus(); });
for (const control of [colorInput, sizeInput]) control.addEventListener('change', () => {
  updateOutputs();
  if (webglController) updateFraming(); else mount();
});
pathInput.addEventListener('change', mount);
trailInput.addEventListener('change', () => {
  if (selectedRenderer === 'webgl' && trailInput.checked) { webglAccumulate.checked = false; webglPaint.checked = false; }
  mount();
});
trailLengthInput.addEventListener('change', mount);
webglAccumulate.addEventListener('change', () => {
  if (webglAccumulate.checked) { trailInput.checked = false; webglPaint.checked = false; }
  mount();
});
accumulationLengthInput.addEventListener('change', mount);
paintLimitBehavior.addEventListener('change', () => {
  if (!mount()) {
    paintLimitBehavior.value = mountedPaintLimitBehavior;
    updateAvailability({ kind: activeMotionKind });
  }
});
webglPaint.addEventListener('change', () => {
  if (webglPaint.checked) { trailInput.checked = false; webglAccumulate.checked = false; }
  mount();
});
webglShape.addEventListener('change', updateFraming);
webglLighting.addEventListener('change', () => {
  webglController?.setLighting(spatialView() && webglLighting.checked);
});
for (const control of [webglView, webglCamera]) control.addEventListener('change', () => {
  if (!webglController) return;
  try {
    endCameraDrag();
    if (control === webglCamera) {
      cameraPreset = webglCamera.value as 'front' | 'oblique';
      draggedCamera = undefined;
    }
    const hadCustomBounds = customBounds.checked;
    customBounds.checked = false;
    for (const input of Object.values(boundsInputs)) input.disabled = true;
    // Coordinate views change the position mapping; camera presets reproject trails.
    if (control === webglView) webglController.clear();
    const camera = cameraForView();
    setBoundsInputs(camera?.bounds ?? motionBounds);
    webglCamera.disabled = !spatialView();
    updateAvailability(createMotion(motionSelect.value as MotionName));
    webglController.setCamera(camera);
    webglController.setLighting(spatialView() && webglLighting.checked);
    if (hadCustomBounds || control === webglView) updateFraming();
    else updateStatus();
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
  if (webglPaint.checked && paintLimitBehavior.value === 'pause' && webglController?.isPaintFull()) { updateStatus(); return; }
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
  helixRotationDirection = helixRotationOptions[0].value;
  helixFlowDirection = helixFlowOptions[0].value;
  manuallyPaused = false;
  selectedRenderer = 'webgl';
  hasExplicitMotion = false;
  renderMotionOptions();
  fitSelect.value = fitSelect.options[0].value;
  zoomInput.value = '1';
  offsetXInput.value = '0';
  offsetYInput.value = '0';
  overflowSelect.value = 'clip';
  colorInput.value = '#67e8f9';
  sizeInput.value = '9';
  depthStrengthInput.value = '1';
  clampMarkerScaleInput.checked = false;
  minMarkerScaleInput.value = '0.25';
  maxMarkerScaleInput.value = '1';
  trailInput.checked = false;
  trailLengthInput.value = '128';
  pathInput.checked = false;
  defaultWebGLCoordinates();
  webglCamera.value = 'oblique';
  cameraPreset = 'oblique';
  draggedCamera = undefined;
  webglShape.value = 'circle';
  webglLighting.checked = false;
  webglAccumulate.checked = false;
  webglPaint.checked = false;
  paintLimitBehavior.value = 'pause';
  accumulationLengthInput.value = '12000';
  customBounds.checked = false;
  for (const input of Object.values(boundsInputs)) input.disabled = true;
  updateOutputs();
  renderParameterControls();
  mount();
  defaultsButton.focus({ preventScroll: true });
});
window.addEventListener('beforeunload', disposeCurrent, { once: true });
window.addEventListener('blur', endCameraDrag);

for (const input of Object.values(boundsInputs)) input.disabled = true;
updateOutputs();
renderMotionOptions();
defaultWebGLCoordinates();
renderParameterControls();
mount();

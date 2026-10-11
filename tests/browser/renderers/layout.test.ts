import { test } from '../fixtures';
import type { Frame, Framing, Pose, ProjectedPose } from '../../../src/core';

test.beforeEach(async ({ page }) => { await page.goto('/fixtures'); });

test('transformed SVG ancestors preserve marker screen position', async ({ page }) => {
  await page.evaluate(async () => {
    const cleanups: (() => void)[] = [];
    try {
      const { animateSvg } = await import('/lib/svg/index.js' as string) as typeof import('../../../src/svg/index.ts');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.style.width = '400px';
      svg.style.height = '200px';
      svg.style.transform = 'rotate(20deg)';
      svg.style.transformOrigin = 'center';
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('transform', 'scale(2)');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('r', '3');
      group.append(marker);
      svg.append(group);
      document.body.append(svg);
      cleanups.push(() => svg.remove());
      const source = {
        kind: 'analytic' as const,
        bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
        periodSeconds: 1,
        sample: () => ({ state: null, pose: { x: 0.5, y: 0.5 } }),
        reset() { },
      };
      const controller = animateSvg({ viewport: svg, marker }, source, { autoplay: false, framing: { fit: 'contain', padding: 0 } });
      cleanups.push(() => controller.dispose());
      const expected = svg.createSVGPoint();
      expected.x = 75;
      expected.y = 75;
      const screen = expected.matrixTransform(svg.getScreenCTM()!);
      const rect = marker.getBoundingClientRect();
      if (Math.hypot(rect.left + rect.width / 2 - screen.x, rect.top + rect.height / 2 - screen.y) > 2) {
        throw new Error('Transformed SVG group placed marker at the wrong screen position');
      }
    }
    finally {
      cleanups.reverse().forEach((cleanup) => cleanup());
    }
  });
});

test('DOM and SVG overflow obey browser clipping', async ({ page }) => {
  await page.evaluate(async () => {
    const cleanups: (() => void)[] = [];
    try {
      const { animateDom } = await import('/lib/dom/index.js' as string) as typeof import('../../../src/dom/index.ts');
      const { animateSvg } = await import('/lib/svg/index.js' as string) as typeof import('../../../src/svg/index.ts');
      const source = {
        kind: 'analytic' as const,
        bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
        periodSeconds: 1,
        sample: () => ({ state: null, pose: { x: 1, y: 0 } }),
        reset() { },
      };
      const viewport = document.createElement('div');
      viewport.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:100px;overflow:visible;z-index:1000';
      const marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;left:0;top:0;width:12px;height:12px;background:red';
      viewport.append(marker);
      document.body.append(viewport);
      cleanups.push(() => viewport.remove());
      const domController = animateDom({ viewport, marker }, source, { autoplay: false, framing: { fit: 'stretch', zoom: 2 } });
      cleanups.push(() => domController.dispose());
      let rect = marker.getBoundingClientRect();
      const domX = rect.left + rect.width / 2;
      const domY = rect.top + rect.height / 2;
      if (document.elementFromPoint(domX, domY) !== marker)
        throw new Error('DOM visible overflow did not paint outside the viewport');
      viewport.style.overflow = 'hidden';
      if (document.elementFromPoint(domX, domY) === marker)
        throw new Error('DOM clipped overflow remained visible');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.style.cssText = 'position:fixed;left:300px;top:20px;width:100px;height:100px;overflow:visible;z-index:1000';
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '6');
      dot.setAttribute('fill', 'red');
      svg.append(dot);
      document.body.append(svg);
      cleanups.push(() => svg.remove());
      const svgController = animateSvg({ viewport: svg, marker: dot }, source, { autoplay: false, framing: { fit: 'stretch', zoom: 2 } });
      cleanups.push(() => svgController.dispose());
      rect = dot.getBoundingClientRect();
      const svgX = rect.left + rect.width / 2;
      const svgY = rect.top + rect.height / 2;
      if (document.elementFromPoint(svgX, svgY) !== dot) {
        const hit = document.elementFromPoint(svgX, svgY);
        throw new Error(`SVG visible overflow did not paint outside the viewport at ${svgX},${svgY}; hit ${hit?.tagName}#${hit?.id}; overflow ${getComputedStyle(svg).overflow}; rect ${JSON.stringify(rect.toJSON())}; viewport ${innerWidth}x${innerHeight}, visual ${visualViewport!.width}x${visualViewport!.height} scale ${visualViewport!.scale}`);
      }
      svg.style.overflow = 'hidden';
      if (document.elementFromPoint(svgX, svgY) === dot)
        throw new Error('SVG clipped overflow remained visible');
    }
    finally {
      cleanups.reverse().forEach((cleanup) => cleanup());
    }
  });
});

test('Canvas and SVG trails bound history and keep paused redraws stable', async ({ page }) => {
  await page.evaluate(async () => {
    const cleanups: (() => void)[] = [];
    try {
      const { createCanvasTrail } = await import('/lib/canvas/trail.js' as string) as typeof import('../../../src/canvas/trail.ts');
      const { createSvgTrail } = await import('/lib/svg/trail.js' as string) as typeof import('../../../src/svg/trail.ts');
      for (const maxSamples of [3, 16]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 100;
        const context = canvas.getContext('2d')!;
        const canvasTrail = createCanvasTrail({ maxSamples, color: 'red', width: 4 });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg.append(path);
        document.body.append(svg);
        cleanups.push(() => svg.remove());
        const svgTrail = createSvgTrail({ viewport: svg, path, maxSamples });
        const makeFrame = (index: number) => {
          const pose = index === 0 ? { x: 20, y: 20 } : index === 1 ? { x: 20, y: 50 } : { x: 80, y: 50 };
          return { state: null, pose, position: pose as ProjectedPose, viewport: { width: 100, height: 100 }, elapsedSeconds: index,
            project: (point: Pose) => ({ ...point, scaleX: 1, scaleY: 1 }) };
        };
        const draw = (frame: Frame<null>) => {
          context.clearRect(0, 0, 100, 100);
          canvasTrail(context, frame);
          svgTrail.render(frame);
        };
        try {
          for (let index = 0; index < 132; index++)
            draw(makeFrame(index));
          const rgba = [...context.getImageData(20, 35, 1, 1).data];
          const expected = [0, 0, 0, 0];
          if (rgba.some((value, channel) => value !== expected[channel]))
            throw new Error(`Canvas tail retained incorrect history with maxSamples=${maxSamples}: ${rgba}`);
          const commands = path.getAttribute('d')!.match(/[ML]/g)!.length;
          if (commands !== maxSamples)
            throw new Error(`SVG retained incorrect tail length with maxSamples=${maxSamples}: ${commands}`);
          draw(makeFrame(131));
          if (path.getAttribute('d')!.match(/[ML]/g)!.length !== commands)
            throw new Error('Paused SVG redraw aged history');
          canvasTrail.clear();
          svgTrail.clear();
          draw(makeFrame(131));
          if (path.getAttribute('d')!.match(/[ML]/g)!.length !== 1)
            throw new Error('Clear failed to discard SVG history');
          if (context.getImageData(20, 35, 1, 1).data[3] !== 0)
            throw new Error('Clear failed to discard Canvas history');
        }
        finally {
          svgTrail.dispose();
          svg.remove();
        }
      }
    }
    finally {
      cleanups.reverse().forEach((cleanup) => cleanup());
    }
  });
});

test('contain framing keeps Canvas DOM and SVG marker footprints inside viewports', async ({ page }) => {
  await page.evaluate(async () => {
    const cleanups: (() => void)[] = [];
    try {
      const { animateCanvas, renderCanvasMarker } = await import('/lib/canvas/index.js' as string) as typeof import('../../../src/canvas/index.ts');
      const { animateDom } = await import('/lib/dom/index.js' as string) as typeof import('../../../src/dom/index.ts');
      const { animateSvg } = await import('/lib/svg/index.js' as string) as typeof import('../../../src/svg/index.ts');
      const source = {
        kind: 'analytic' as const,
        bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
        periodSeconds: 1,
        sample: () => ({ state: null, pose: { x: 1, y: 1 } }),
        reset() { },
      };
      for (const radius of [5, 24]) {
        const framing: Framing = radius === 5 ? { fit: 'contain' } : { fit: 'contain', padding: 39 };
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 100;
        canvas.style.cssText = 'position:fixed;left:20px;top:150px;width:100px;height:100px';
        document.body.append(canvas);
        cleanups.push(() => canvas.remove());
        let canvasPosition: ProjectedPose | undefined;
        const canvasController = animateCanvas(canvas, source, {
          autoplay: false, offscreen: false, framing,
          render(context, frame) {
            canvasPosition = frame.position;
            renderCanvasMarker(context, frame, { radius });
          },
        });
        cleanups.push(() => canvasController.dispose());
        if (!canvasPosition || canvasPosition.x + radius > 100 || canvasPosition.y + radius > 100) {
          throw new Error('Contain framing clipped the Canvas marker');
        }
        const viewport = document.createElement('div');
        viewport.style.cssText = 'position:fixed;left:140px;top:150px;width:100px;height:100px;overflow:hidden';
        const marker = document.createElement('div');
        marker.style.cssText = `position:absolute;left:0;top:0;width:${radius * 2}px;height:${radius * 2}px;background:red`;
        viewport.append(marker);
        document.body.append(viewport);
        cleanups.push(() => viewport.remove());
        const domController = animateDom({ viewport, marker }, source, { autoplay: false, framing });
        cleanups.push(() => domController.dispose());
        let outer = viewport.getBoundingClientRect();
        let inner = marker.getBoundingClientRect();
        if (inner.right > outer.right + 0.5 || inner.bottom > outer.bottom + 0.5) {
          throw new Error('Contain framing clipped the DOM marker');
        }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.style.cssText = 'position:fixed;left:260px;top:150px;width:100px;height:100px;overflow:hidden';
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', String(radius));
        svg.append(circle);
        document.body.append(svg);
        cleanups.push(() => svg.remove());
        const svgController = animateSvg({ viewport: svg, marker: circle }, source, { autoplay: false, framing });
        cleanups.push(() => svgController.dispose());
        outer = svg.getBoundingClientRect();
        inner = circle.getBoundingClientRect();
        if (inner.right > outer.right + 0.5 || inner.bottom > outer.bottom + 0.5) {
          throw new Error('Contain framing clipped the SVG marker');
        }
      }
    }
    finally {
      cleanups.reverse().forEach((cleanup) => cleanup());
    }
  });
});

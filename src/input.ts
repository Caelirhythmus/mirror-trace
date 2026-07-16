/**
 * Input handling utilities for MirrorTraceApp
 *
 * Pure functions extracted from main.ts for pointer event processing,
 * coordinate translation, and pen-stroke rendering.
 */

import { Point } from './types';

/* ------------------------------------------------------------------ */
/*  Coordinate translation                                             */
/* ------------------------------------------------------------------ */

/**
 * Convert a PointerEvent's client-space coordinates into "virtual canvas"
 * space by accounting for the canvas offset and the uniform scale
 * transform applied to both canvases.
 */
export function clientToCanvas(
  e: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  virtOffX: number,
  virtOffY: number,
  virtScale: number,
): Point {
  const rect = canvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  return {
    x: (cssX - virtOffX) / virtScale,
    y: (cssY - virtOffY) / virtScale,
  };
}

/* ------------------------------------------------------------------ */
/*  Stroke segment rendering                                           */
/* ------------------------------------------------------------------ */

/**
 * Draw a single segment of the user's stroke with optional pressure /
 * tilt styling.  This is called during pointer-move so that the user
 * sees the stroke build up in real-time.
 */
export function drawSegment(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  pressure: number,
  tiltX: number,
  tiltY: number,
  pressureEnabled: boolean,
): void {
  let lineWidth = 2.5;
  let alpha = 1;

  if (pressureEnabled) {
    lineWidth = 1 + pressure * 5;               // 1–6 px
    const tiltMag = Math.min(90, Math.hypot(tiltX, tiltY));
    alpha = 1 - (tiltMag / 90) * 0.4;            // 1.0 → 0.6
  }

  ctx.strokeStyle = `rgba(255, 107, 107, ${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

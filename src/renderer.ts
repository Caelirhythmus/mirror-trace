/**
 * Canvas rendering utilities for MirrorTraceApp
 *
 * Pure functions extracted from main.ts for drawing reference curves,
 * heatmap guides, user strokes, and coverage overlays.
 */

import { Point } from './types';

/* ------------------------------------------------------------------ */
/*  State interfaces                                                    */
/* ------------------------------------------------------------------ */

/** All state needed to render the reference canvas (refCtx) */
export interface RefCanvasState {
  multiLineMode: boolean;
  multiLines: Point[][];
  multiLineColors: string[];
  multiLineCovered: boolean[];
  complexLineCoverage: (boolean[] | null)[];
  refPath: Point[];
  covered: boolean[];
  latestMatchStart: number;
  latestMatchEnd: number;
  liveHotspotPt: Point | null;
  heatmapEnabled: boolean;
  colorEnabled: boolean;
}

/** State needed to render the heatmap guide on the user canvas */
export interface HeatmapState {
  multiLineMode: boolean;
  multiLines: Point[][];
  refPath: Point[];
  singleStrokeMode: boolean;
  heatmapEnabled: boolean;
}

/* ------------------------------------------------------------------ */
/*  Path-range drawing helpers                                         */
/* ------------------------------------------------------------------ */

/** Draw a contiguous range of indices on an arbitrary point array */
export function drawRefRange(
  ctx: CanvasRenderingContext2D,
  path: readonly Point[],
  start: number,
  end: number,
  style: string,
  width: number,
): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(path[start].x, path[start].y);
  for (let i = start + 1; i <= end; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.stroke();
}

/** Draw all contiguous ranges where `predicate(i)` is true */
export function drawRanges(
  ctx: CanvasRenderingContext2D,
  path: readonly Point[],
  style: string,
  width: number,
  predicate: (i: number) => boolean,
): void {
  let i = 0;
  while (i < path.length) {
    if (predicate(i)) {
      let j = i;
      while (j < path.length && predicate(j)) j++;
      drawRefRange(ctx, path, i, j - 1, style, width);
      i = j;
    } else {
      i++;
    }
  }
}

/** Draw contiguous ranges within an arbitrary point array */
export function drawLineRanges(
  ctx: CanvasRenderingContext2D,
  line: readonly Point[],
  style: string,
  width: number,
  predicate: (i: number) => boolean,
): void {
  let i = 0;
  while (i < line.length) {
    if (predicate(i)) {
      let j = i;
      while (j < line.length && predicate(j)) j++;
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(line[i].x, line[i].y);
      for (let k = i + 1; k < j; k++) ctx.lineTo(line[k].x, line[k].y);
      ctx.stroke();
      i = j;
    } else {
      i++;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Reference canvas                                                   */
/* ------------------------------------------------------------------ */

/**
 * Full redraw of the reference canvas — both multi-line and single-path
 * modes, including coverage dimming, latest-match highlight, and the
 * pen-position hotspot crosshair.
 */
export function drawRefCanvas(
  ctx: CanvasRenderingContext2D,
  virtW: number,
  virtH: number,
  colors: readonly string[],
  state: RefCanvasState,
): void {
  ctx.clearRect(0, 0, virtW, virtH);

  /* Multi-line mode: draw each line with its color */
  if (state.multiLineMode && state.multiLines.length > 0) {
    for (let li = 0; li < state.multiLines.length; li++) {
      const line = state.multiLines[li];
      if (line.length < 2) continue;
      const baseColor = state.colorEnabled
        ? (state.multiLineColors[li] || colors[li % colors.length])
        : '#ffffff';
      const covered = state.multiLineCovered[li] || false;
      const segCov = state.complexLineCoverage[li];

      if (segCov) {
        /* Complex curve: dim covered segments, highlight uncovered */
        drawLineRanges(ctx, line, 'rgba(255,255,255,0.15)', 1.5, i => segCov[i]);
        drawLineRanges(ctx, line, baseColor, 2.5, i => !segCov[i]);
      } else {
        ctx.strokeStyle = covered ? 'rgba(255, 255, 255, 0.15)' : baseColor;
        ctx.lineWidth = covered ? 1.5 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(line[0].x, line[0].y);
        for (let i = 1; i < line.length; i++) {
          ctx.lineTo(line[i].x, line[i].y);
        }
        ctx.stroke();
      }
    }
    return;
  }

  if (state.refPath.length < 2) return;

  const hasCoverage =
    state.covered.length === state.refPath.length &&
    state.covered.some(v => v);

  if (!hasCoverage) {
    drawRefRange(ctx, state.refPath, 0, state.refPath.length - 1, '#4a9eff', 2);
    return;
  }

  /* Uncovered portions: dimmed */
  drawRanges(ctx, state.refPath, 'rgba(74, 158, 255, 0.20)', 2, i => !state.covered[i]);
  /* Covered portions: bright blue */
  drawRanges(ctx, state.refPath, '#4a9eff', 2.5, i => state.covered[i]);

  /* Latest-match highlight */
  if (state.latestMatchStart >= 0 && state.latestMatchEnd >= state.latestMatchStart) {
    drawRefRange(ctx, state.refPath, state.latestMatchStart, state.latestMatchEnd,
      'rgba(255, 220, 80, 0.35)', 6);
    drawRefRange(ctx, state.refPath, state.latestMatchStart, state.latestMatchEnd,
      'rgba(255, 240, 120, 0.60)', 3);
  }

  /* Pen-position hotspot crosshair */
  if (state.liveHotspotPt !== null && state.heatmapEnabled) {
    const hp = state.liveHotspotPt;
    const s = 6;
    ctx.strokeStyle = 'rgba(255, 255, 100, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hp.x - s, hp.y); ctx.lineTo(hp.x + s, hp.y);
    ctx.moveTo(hp.x, hp.y - s); ctx.lineTo(hp.x, hp.y + s);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/*  Heatmap guide (user canvas background)                             */
/* ------------------------------------------------------------------ */

/** Draw the faint reference curve guide on the user canvas */
export function drawHeatmapGuide(
  ctx: CanvasRenderingContext2D,
  state: HeatmapState,
): void {
  if (!state.heatmapEnabled) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (state.multiLineMode && state.multiLines.length > 0) {
    ctx.lineWidth = 1.5;
    for (const line of state.multiLines) {
      if (line.length < 2) continue;
      ctx.strokeStyle = 'rgba(74, 158, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) {
        ctx.lineTo(line[i].x, line[i].y);
      }
      ctx.stroke();
    }
    return;
  }

  if (state.refPath.length < 2) return;
  ctx.strokeStyle = 'rgba(74, 158, 255, 0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(state.refPath[0].x, state.refPath[0].y);
  for (let i = 1; i < state.refPath.length; i++) {
    ctx.lineTo(state.refPath[i].x, state.refPath[i].y);
  }
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/*  User stroke rendering                                              */
/* ------------------------------------------------------------------ */

/** Draw the processed (RDP + resampled) user stroke as a white overlay */
export function drawUserProcessed(
  ctx: CanvasRenderingContext2D,
  path: readonly Point[],
): void {
  if (path.length < 2) return;
  ctx.strokeStyle = 'rgba(255, 255, 100, 0.45)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.stroke();
}

/** Replay a single raw stroke polyline onto a canvas */
export function replayRawStroke(
  ctx: CanvasRenderingContext2D,
  raw: readonly Point[],
): void {
  if (raw.length < 2) return;
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(raw[0].x, raw[0].y);
  for (let i = 1; i < raw.length; i++) {
    ctx.lineTo(raw[i].x, raw[i].y);
  }
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/*  Multi-line matching visual                                         */
/* ------------------------------------------------------------------ */

/**
 * Redraw the reference canvas with a freshly matched multi-line index,
 * dimming all other lines except the matched one.
 */
export function highlightMatchedLine(
  ctx: CanvasRenderingContext2D,
  virtW: number,
  virtH: number,
  colors: readonly string[],
  multiLines: Point[][],
  multiLineColors: string[],
  matchedIdx: number,
): void {
  ctx.clearRect(0, 0, virtW, virtH);
  for (let li = 0; li < multiLines.length; li++) {
    const line = multiLines[li];
    if (line.length < 2) continue;
    if (li === matchedIdx) {
      /* Matched line — draw bright */
      const color = multiLineColors[li] || colors[li % colors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
    } else {
      /* Other lines — dim */
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) {
      ctx.lineTo(line[i].x, line[i].y);
    }
    ctx.stroke();
  }
}

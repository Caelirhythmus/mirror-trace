/**
 * Export utilities for MirrorTraceApp
 *
 * Supports SVG, PNG, and text-report export of the current drawing.
 */

import { Point } from './types';
import { HistoryEntry } from './storage';

const VIRTUAL_W = 800;
const VIRTUAL_H = 600;

/* ------------------------------------------------------------------ */
/*  SVG export                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build an SVG string from the reference path and user strokes.
 * All coordinates are in virtual canvas space (800×600).
 */
export function buildSVG(
  refPath: readonly Point[],
  userStrokes: readonly (readonly Point[])[],
  multiLines?: readonly (readonly Point[])[],
): string {
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIRTUAL_W} ${VIRTUAL_H}" width="100%" height="100%">`);
  lines.push('<rect width="100%" height="100%" fill="#0f0f1a"/>');

  /* Multi-line reference curves */
  if (multiLines && multiLines.length > 0) {
    const colors = ['#ff6b6b','#4a9eff','#50c878','#ffd700','#ff8c00','#da70d6','#00ced1','#f08080'];
    multiLines.forEach((line, i) => {
      if (line.length < 2) return;
      const pts = line.map(p => `${p.x},${p.y}`).join(' ');
      lines.push(`<polyline points="${pts}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2" opacity="0.9"/>`);
    });
  } else if (refPath.length >= 2) {
    const pts = refPath.map(p => `${p.x},${p.y}`).join(' ');
    lines.push(`<polyline points="${pts}" fill="none" stroke="#4a9eff" stroke-width="2"/>`);
  }

  /* User strokes */
  const userColor = 'rgba(255,107,107,0.8)';
  for (const stroke of userStrokes) {
    if (stroke.length < 2) continue;
    const pts = stroke.map(p => `${p.x},${p.y}`).join(' ');
    lines.push(`<polyline points="${pts}" fill="none" stroke="${userColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  lines.push('</svg>');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  PNG export                                                         */
/* ------------------------------------------------------------------ */

/**
 * Combine the reference and user canvases into a single PNG data URL
 * and trigger a download.
 */
export function downloadPNG(
  refCanvas: HTMLCanvasElement,
  userCanvas: HTMLCanvasElement,
  filename = 'mirror-trace.png',
): void {
  const w = refCanvas.width;
  const h = refCanvas.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(refCanvas, 0, 0);
  ctx.drawImage(userCanvas, 0, 0);
  triggerDownload(c.toDataURL('image/png'), filename);
}

/* ------------------------------------------------------------------ */
/*  Text report                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build a plain-text practice report from the current score and history.
 */
export function buildReport(
  finalScore: number,
  spatialScore: number,
  timeScore: number,
  elapsedMs: number,
  idealMs: number,
  hausdorff95Dist: number,
  rmsDist: number,
  mode: string,
  recentEntries: HistoryEntry[],
): string {
  const lines: string[] = [];
  lines.push('=== Mirror Trace — 练习报告 ===');
  lines.push('');
  lines.push(`模式:      ${mode}`);
  lines.push(`总分:      ${finalScore}`);
  lines.push(`空间分:    ${spatialScore}`);
  lines.push(`时间分:    ${timeScore}`);
  lines.push(`用时:      ${elapsedMs} ms (理想 ${idealMs} ms)`);
  lines.push(`Hausdorff: ${hausdorff95Dist} px`);
  lines.push(`RMS:       ${rmsDist} px`);
  lines.push('');
  lines.push('--- 最近记录 ---');
  for (const e of recentEntries.slice(-5).reverse()) {
    const d = new Date(e.timestamp);
    const t = d.toLocaleString();
    lines.push(`  ${t}  ${e.finalScore}  (空${e.spatialScore} 时${e.timeScore})  ${e.mode || '?'}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

/** Trigger a browser download from a data URL or blob URL */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Build a data URL for a text/plain string */
export function textToDataURL(text: string): string {
  return 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
}

/** Check if user strokes exist */
export function hasUserStrokes(userStrokes: readonly (readonly Point[])[]): boolean {
  return userStrokes.some(s => s.length >= 2);
}

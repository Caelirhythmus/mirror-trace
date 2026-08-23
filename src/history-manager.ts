/**
 * History panel rendering for MirrorTraceApp
 *
 * Pure functions for rendering the history chart (sparkline with Y-axis
 * labels and top-score markers) and the history list with mode badges.
 */

import { HistoryEntry } from './storage';
import { CanvasPalette } from './themes';

/* ------------------------------------------------------------------ */
/*  History chart (sparkline)                                          */
/* ------------------------------------------------------------------ */

/**
 * Draw a sparkline of recent final scores on the history chart canvas.
 *
 * Features:
 * - Y-axis labels (min / mid / max of visible data range)
 * - Top-score highlight marker
 */
export function renderHistoryChart(
  canvas: HTMLCanvasElement,
  parentWidth: number,
  dpr: number,
  entries: HistoryEntry[],
  palette: CanvasPalette,
): void {
  /* Chart height: fixed so the chart never competes with the history
     list for sidebar space.  Width follows the parent via JS-controlled
     inline style to avoid CSS-layout interference with the canvas. */
  const H = 100;
  const w = parentWidth;
  canvas.style.width = w + 'px';
  canvas.style.height = H + 'px';
  canvas.style.maxHeight = H + 'px';
  canvas.width = w * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, H);

  if (entries.length < 2) {
    ctx.fillStyle = palette.chartNoData;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', w / 2, H / 2 + 4);
    return;
  }

  const take = Math.min(entries.length, 30);
  const recent = entries.slice(-take);
  const scores = recent.map(e => e.finalScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = Math.max(maxS - minS, 10);

  /* ── Layout ── */

  /* Compact padding so the plot area doesn't vanish at sidebar scale.
     padL keeps room for Y-axis labels; padT/padB are proportional to h. */
  const padL = 26;
  const padR = 4;
  const padT = Math.max(2, Math.round(H * 0.16));
  const padB = Math.max(2, Math.round(H * 0.18));
  const plotW = w - padL - padR;
  const plotH = H - padT - padB;

  /* ── Y-axis labels + grid lines ── */

  const labelPositions = [minS, Math.round((minS + maxS) / 2), maxS];

  ctx.strokeStyle = palette.chartGrid;
  ctx.lineWidth = 1;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (const v of labelPositions) {
    const y = padT + plotH * (1 - (v - minS) / range);
    /* Grid line */
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    /* Label */
    ctx.fillStyle = palette.chartLabel;
    ctx.fillText(String(v), padL - 3, y);
  }

  /* ── Area fill ── */

  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  scores.forEach((s, i) => {
    const x = padL + (i / (scores.length - 1)) * plotW;
    const y = padT + plotH * (1 - (s - minS) / range);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, palette.chartFillTop);
  grad.addColorStop(1, palette.chartFillBottom);
  ctx.fillStyle = grad;
  ctx.fill();

  /* ── Line ── */

  ctx.beginPath();
  scores.forEach((s, i) => {
    const x = padL + (i / (scores.length - 1)) * plotW;
    const y = padT + plotH * (1 - (s - minS) / range);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* ── Regular dots ── */

  ctx.fillStyle = palette.accent;
  scores.forEach((s, i) => {
    const x = padL + (i / (scores.length - 1)) * plotW;
    const y = padT + plotH * (1 - (s - minS) / range);
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  });

  /* ── Top-score marker ── */

  const maxIdx = scores.indexOf(maxS);
  const maxX = padL + (maxIdx / (scores.length - 1)) * plotW;
  const maxY = padT + plotH * (1 - (maxS - minS) / range);

  /* Brighter, bigger dot */
  ctx.fillStyle = palette.accentGold;
  ctx.beginPath(); ctx.arc(maxX, maxY, 4, 0, Math.PI * 2); ctx.fill();

  /* Value label above the dot */
  ctx.fillStyle = palette.accentGold;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(String(maxS), maxX, maxY - 5);
}

/* ------------------------------------------------------------------ */
/*  History list                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render a compact list of the last N history entries as innerHTML.
 * Each entry shows: [mode badge]  time  finalScore  [details]
 */
export function renderHistoryList(
  el: HTMLElement,
  entries: HistoryEntry[],
): void {
  const take = Math.min(entries.length, 12);
  const recent = entries.slice(-take);
  el.innerHTML = recent
    .map(e => {
      const d = new Date(e.timestamp);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let badge = '[?]';
      if (e.mode === '概括') badge = '[概]';
      else if (e.mode === '单笔') badge = '[单]';
      else if (e.mode === '多条') badge = '[多]';
      else if (e.mode === '地狱') badge = '[地]';

      let detail = '';
      if (e.lineConfig) {
        detail = ` ${e.lineConfig}`;
      }
      detail += ` ${Math.round(e.elapsedMs)}ms`;

      return `<span class="history-entry">${badge} ${time}  ${e.finalScore}${detail}</span>`;
    })
    .join('');
}

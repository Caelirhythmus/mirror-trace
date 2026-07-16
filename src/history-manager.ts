/**
 * History panel rendering for MirrorTraceApp
 *
 * Pure functions extracted from main.ts for rendering the history chart
 * (sparkline) and the history list.
 */

import { HistoryEntry } from './storage';

/* ------------------------------------------------------------------ */
/*  History chart (sparkline)                                          */
/* ------------------------------------------------------------------ */

/**
 * Draw a sparkline of recent final scores on the history chart canvas.
 * Matches the original rendering in main.ts exactly.
 */
export function renderHistoryChart(
  canvas: HTMLCanvasElement,
  parentWidth: number,
  dpr: number,
  entries: HistoryEntry[],
): void {
  const w = parentWidth;
  const h = 60;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (entries.length < 2) {
    ctx.fillStyle = '#404060';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u6682\u65E0\u6570\u636E', w / 2, h / 2 + 4);
    return;
  }

  const take = Math.min(entries.length, 30);
  const recent = entries.slice(-take);
  const scores = recent.map(e => e.finalScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = Math.max(maxS - minS, 10);
  const padL = 4, padR = 4, padT = 6, padB = 10;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  /* Grid lines */
  ctx.strokeStyle = '#1a1a3a';
  ctx.lineWidth = 1;
  for (let v = 0; v <= 100; v += 25) {
    const y = padT + plotH * (1 - (v - minS) / range);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }

  /* Area fill */
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
  grad.addColorStop(0, 'rgba(74, 158, 255, 0.25)');
  grad.addColorStop(1, 'rgba(74, 158, 255, 0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  /* Line */
  ctx.beginPath();
  scores.forEach((s, i) => {
    const x = padL + (i / (scores.length - 1)) * plotW;
    const y = padT + plotH * (1 - (s - minS) / range);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#4a9eff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* Dots */
  scores.forEach((s, i) => {
    const x = padL + (i / (scores.length - 1)) * plotW;
    const y = padT + plotH * (1 - (s - minS) / range);
    ctx.fillStyle = '#4a9eff';
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  });
}

/* ------------------------------------------------------------------ */
/*  History list                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render a compact list of the last N history entries as innerHTML.
 */
export function renderHistoryList(
  el: HTMLElement,
  entries: HistoryEntry[],
): void {
  const take = Math.min(entries.length, 15);
  const recent = entries.slice(-take);
  el.innerHTML = recent
    .map(e => {
      const d = new Date(e.timestamp);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<span class="history-entry">${time}  ${e.finalScore}</span>`;
    })
    .join('');
}

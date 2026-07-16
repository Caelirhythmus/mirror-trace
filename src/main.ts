/**
 * Mirror Trace — 路径临摹工具
 *
 * 左右 Canvas 双缓冲框架，集成：
 *  - 左侧：随机 C¹ 连续贝塞尔曲线（参考线）
 *  - 右侧：用户临摹，RDP 压缩 → 等距重采样
 */

import { Point } from './types';
import { generateRandomCurve } from './generator';
import { rdpSimplify, resampleToCount, arcLength } from './trajectory';
import { computeScores, ScoreResult } from './scoring';
import { findSegment } from './matching';
import { saveEntry, loadHistory, clearHistory, makeId, HistoryEntry } from './storage';

/* ------------------------------------------------------------------ */
/*  Stroke history model                                               */
/* ------------------------------------------------------------------ */

interface StrokeState {
  raw: Point[];
  processed: Point[];
  score: ScoreResult | null;
}

class MirrorTraceApp {
  /* canvases & contexts */
  private refCanvas!: HTMLCanvasElement;
  private userCanvas!: HTMLCanvasElement;
  private refCtx!: CanvasRenderingContext2D;
  private userCtx!: CanvasRenderingContext2D;

  /* dimensions */
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  /* paths */
  private refPath: Point[] = [];          // reference curve (from generator)
  private userRawPath: Point[] = [];      // raw coalesced pointer points
  private userProcessedPath: Point[] = []; // after RDP + resample

  /* state */
  private isDrawing = false;
  private pointerDownTime = 0;
  private prevPoint: Point = { x: 0, y: 0 };
  private pressureEnabled = true;
  private heatmapEnabled = true;
  /** false = overview mode (multi-stroke, segment matching) */
  private singleStrokeMode = false;

  /* stroke history for undo / redo */
  private strokeHistory: StrokeState[] = [];
  private historyPointer = -1;

  /* DOM */
  private scoreFinalEl!: HTMLElement;
  private scoreSpatialEl!: HTMLElement;
  private scoreTimeEl!: HTMLElement;
  private debugHausdorffEl!: HTMLElement;
  private debugRmsEl!: HTMLElement;
  private debugElapsedEl!: HTMLElement;
  private debugIdealEl!: HTMLElement;
  private undoBtnEl!: HTMLButtonElement;
  private redoBtnEl!: HTMLButtonElement;
  private historyChartEl!: HTMLCanvasElement;
  private historyListEl!: HTMLElement;

  /* ──────────────────────────────────────────────── */
  /*  Lifecycle                                       */
  /* ──────────────────────────────────────────────── */

  constructor() {
    this.dpr = window.devicePixelRatio || 1;
    this.refCanvas = document.getElementById('ref-canvas') as HTMLCanvasElement;
    this.userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
    this.refCtx = this.refCanvas.getContext('2d')!;
    this.userCtx = this.userCanvas.getContext('2d')!;

    this.scoreFinalEl = document.getElementById('score-final')!;
    this.scoreSpatialEl = document.getElementById('score-spatial')!;
    this.scoreTimeEl = document.getElementById('score-time')!;
    this.debugHausdorffEl = document.getElementById('debug-hausdorff')!;
    this.debugRmsEl = document.getElementById('debug-rms')!;
    this.debugElapsedEl = document.getElementById('debug-elapsed')!;
    this.debugIdealEl = document.getElementById('debug-ideal')!;
    this.undoBtnEl = document.getElementById('btn-undo') as HTMLButtonElement;
    this.redoBtnEl = document.getElementById('btn-redo') as HTMLButtonElement;
    this.undoBtnEl.addEventListener('click', () => this.undo());
    this.redoBtnEl.addEventListener('click', () => this.redo());
    this.updateUndoRedoButtons();

    this.historyChartEl = document.getElementById('history-chart') as HTMLCanvasElement;
    this.historyListEl = document.getElementById('history-list')!;
    document.getElementById('btn-clear-history')!
      .addEventListener('click', () => { clearHistory(); this.refreshHistoryPanel(); });
    this.refreshHistoryPanel();

    /* Bind toggles */
    const pressureToggle = document.getElementById('toggle-pressure') as HTMLInputElement;
    pressureToggle.addEventListener('change', () => {
      this.pressureEnabled = pressureToggle.checked;
    });

    const heatmapToggle = document.getElementById('toggle-heatmap') as HTMLInputElement;
    heatmapToggle.addEventListener('change', () => {
      this.heatmapEnabled = heatmapToggle.checked;
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
    });

    this.initResizeObserver();
    this.bindPointerEvents();
    /* Force initial measurement so we have cssW/cssH before generating */
    this.resizeCanvases();
    this.newCurve();
  }

  /* ──────────────────────────────────────────────── */
  /*  Sizing / DPI                                    */
  /* ──────────────────────────────────────────────── */

  private initResizeObserver(): void {
    const ro = new ResizeObserver(() => this.resizeCanvases());
    ro.observe(this.refCanvas);
  }

  private resizeCanvases(): void {
    /* Ref canvas sets the baseline CSS size */
    const rectR = this.refCanvas.getBoundingClientRect();
    this.cssW = Math.round(rectR.width);
    this.cssH = Math.round(rectR.height);

    this.refCanvas.width = this.cssW * this.dpr;
    this.refCanvas.height = this.cssH * this.dpr;
    this.refCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    /* User canvas — use its own rect (should be nearly identical) */
    const rectU = this.userCanvas.getBoundingClientRect();
    this.userCanvas.width = Math.round(rectU.width) * this.dpr;
    this.userCanvas.height = Math.round(rectU.height) * this.dpr;
    this.userCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawScene();
  }

  /* ──────────────────────────────────────────────── */
  /*  Curve generation                                */
  /* ──────────────────────────────────────────────── */

  /** Generate a fresh reference curve and reset everything */
  newCurve(): void {
    if (this.cssW < 100 || this.cssH < 100) return;
    this.refPath = generateRandomCurve(this.cssW, this.cssH, 40);
    this.clearUserCanvas();
    this.clearScoreDisplay();
    this.drawScene();
  }

  /* ──────────────────────────────────────────────── */
  /*  Drawing                                         */
  /* ──────────────────────────────────────────────── */

  private drawScene(): void {
    this.drawRefCanvas();
  }

  private drawRefCanvas(): void {
    const ctx = this.refCtx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (this.refPath.length < 2) return;

    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(this.refPath[0].x, this.refPath[0].y);
    for (let i = 1; i < this.refPath.length; i++) {
      ctx.lineTo(this.refPath[i].x, this.refPath[i].y);
    }
    ctx.stroke();
  }

  private clearUserCanvas(): void {
    this.userCtx.clearRect(0, 0, this.cssW, this.cssH);
    this.userRawPath = [];
    this.userProcessedPath = [];
    this.prevPoint = { x: 0, y: 0 };
  }

  /**
   * Draw a single segment from `prevPoint` → `to`, with pen-pressure
   * feedback when `pressureEnabled` is true.
   *
   * Pressure (0–1)       → line width        1–6 px
   * Tilt magnitude (0–90) → alpha multiplier  1.0 → 0.6
   */
  private drawSegment(to: Point, pressure: number, tiltX: number, tiltY: number): void {
    const ctx = this.userCtx;

    let lineWidth = 2.5;
    let alpha = 1;

    if (this.pressureEnabled) {
      lineWidth = 1 + pressure * 5;               // 1–6 px
      const tiltMag = Math.min(90, Math.hypot(tiltX, tiltY));
      alpha = 1 - (tiltMag / 90) * 0.4;            // 1.0 → 0.6
    }

    ctx.strokeStyle = `rgba(255, 107, 107, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(this.prevPoint.x, this.prevPoint.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  /** Reset score panel to default state */
  private clearScoreDisplay(): void {
    this.scoreFinalEl.textContent = '\u2014';
    this.scoreSpatialEl.textContent = '\u2014';
    this.scoreTimeEl.textContent = '\u2014';
    this.debugHausdorffEl.textContent = '\u2014';
    this.debugRmsEl.textContent = '\u2014';
    this.debugElapsedEl.textContent = '\u2014';
    this.debugIdealEl.textContent = '\u2014';
  }

  /** Update score panel with a fresh ScoreResult */
  private showScore(s: ScoreResult): void {
    this.scoreFinalEl.textContent = String(s.finalScore);
    this.scoreSpatialEl.textContent = String(s.spatialScore);
    this.scoreTimeEl.textContent = String(s.timeScore);
    this.debugHausdorffEl.textContent = String(s.hausdorff95Dist);
    this.debugRmsEl.textContent = String(s.rmsDist);
    this.debugElapsedEl.textContent = String(s.elapsedMs);
    this.debugIdealEl.textContent = String(s.idealMs);
  }

  /** Highlight process-path overlay */
  private drawUserProcessed(): void {
    const pts = this.userProcessedPath;
    if (pts.length < 2) return;

    const ctx = this.userCtx;
    ctx.strokeStyle = 'rgba(255, 255, 100, 0.45)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  /* ──────────────────────────────────────────────── */
  /*  Heatmap guidance                                */
  /* ──────────────────────────────────────────────── */

  /** Draw the full reference curve very faintly as a static guide on the user canvas */
  private drawHeatmapGuide(): void {
    if (!this.heatmapEnabled || this.refPath.length < 2) return;
    const ctx = this.userCtx;
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.10)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.refPath[0].x, this.refPath[0].y);
    for (let i = 1; i < this.refPath.length; i++) {
      ctx.lineTo(this.refPath[i].x, this.refPath[i].y);
    }
    ctx.stroke();
  }

  /** Draw a glowing hotspot on the reference curve near the pen position */
  private drawHeatmapHotspot(penPos: Point): void {
    if (!this.heatmapEnabled || this.refPath.length < 2) return;

    /* Find index of nearest ref point */
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.refPath.length; i++) {
      const d = Math.hypot(this.refPath[i].x - penPos.x, this.refPath[i].y - penPos.y);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    const ctx = this.userCtx;
    const R = 25; // window radius (number of points on each side)
    const start = Math.max(0, bestIdx - R);
    const end = Math.min(this.refPath.length - 1, bestIdx + R);
    if (end - start < 2) return;

    /* Glow layer 1 (outer, wider) */
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.25)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.refPath[start].x, this.refPath[start].y);
    for (let i = start + 1; i <= end; i++) {
      ctx.lineTo(this.refPath[i].x, this.refPath[i].y);
    }
    ctx.stroke();

    /* Glow layer 2 (inner, brighter) */
    ctx.strokeStyle = 'rgba(100, 190, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.refPath[start].x, this.refPath[start].y);
    for (let i = start + 1; i <= end; i++) {
      ctx.lineTo(this.refPath[i].x, this.refPath[i].y);
    }
    ctx.stroke();
  }

  /* ──────────────────────────────────────────────── */
  /*  Pointer events                                  */
  /* ──────────────────────────────────────────────── */

  private bindPointerEvents(): void {
    const el = this.userCanvas;
    el.addEventListener('pointerdown', this.onPointerDown.bind(this));
    el.addEventListener('pointermove', this.onPointerMove.bind(this));
    el.addEventListener('pointerup', this.onPointerUp.bind(this));
    el.addEventListener('pointerleave', this.onPointerUp.bind(this));
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDrawing = true;
    this.pointerDownTime = performance.now();
    /* Any new stroke discards the redo future */
    this.strokeHistory.length = this.historyPointer + 1;
    this.userRawPath = [];

    /* Clear user canvas and previous score */
    this.userCtx.clearRect(0, 0, this.cssW, this.cssH);
    this.userProcessedPath = [];
    this.clearScoreDisplay();

    /* Draw heatmap guide as background layer */
    this.drawHeatmapGuide();

    const p = this.clientToCanvas(e);
    this.userRawPath.push(p);
    this.prevPoint = p;
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;

    const events = e.getCoalescedEvents();
    if (events.length > 0) {
      for (const ev of events) {
        const p = this.clientToCanvas(ev);
        this.userRawPath.push(p);
        this.drawSegment(p, ev.pressure, ev.tiltX, ev.tiltY);
        this.drawHeatmapHotspot(p);
        this.prevPoint = p;
      }
    } else {
      const p = this.clientToCanvas(e);
      this.userRawPath.push(p);
      this.drawSegment(p, e.pressure, e.tiltX, e.tiltY);
      this.drawHeatmapHotspot(p);
      this.prevPoint = p;
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const elapsedMs = performance.now() - this.pointerDownTime;

    /* Process the captured path */
    this.processUserPath(elapsedMs);
  }

  /* ──────────────────────────────────────────────── */
  /*  Trajectory processing (RDP → resample)          */
  /* ──────────────────────────────────────────────── */

  private processUserPath(elapsedMs: number): void {
    if (this.userRawPath.length < 3) return;
    if (this.refPath.length < 2) return;

    /* Truncate any undone states: new stroke discards redo future */
    this.strokeHistory.length = this.historyPointer + 1;

    const rdpEpsilon = 0.5; // CSS pixels
    const simplified = rdpSimplify(this.userRawPath, rdpEpsilon);

    /* Determine which reference sub-path to score against */
    let refSubPath: Point[];
    if (this.singleStrokeMode) {
      /* Single-stroke mode: entire ref path (full arch curve) */
      refSubPath = this.refPath;
    } else {
      /* Overview mode: match user stroke start/end to refPath segment */
      const match = findSegment(this.refPath, this.userRawPath);
      refSubPath = match.subPath;
    }

    const resampled = resampleToCount(simplified, refSubPath.length);

    this.userProcessedPath = resampled;

    /* Overlay the processed path for visual feedback */
    this.drawUserProcessed();

    /* Score the attempt */
    const score = computeScores(refSubPath, resampled, elapsedMs);
    this.showScore(score);

    /* Save to history */
    this.strokeHistory.push({
      raw: [...this.userRawPath],
      processed: [...this.userProcessedPath],
      score,
    });
    this.historyPointer = this.strokeHistory.length - 1;
    this.updateUndoRedoButtons();

    /* Persist to localStorage and refresh history panel */
    this.saveToPersistentHistory(score);

    /* Log stats for debugging */
    console.log({
      rawPts: this.userRawPath.length,
      afterRDP: simplified.length,
      afterResample: resampled.length,
      refPts: this.singleStrokeMode ? this.refPath.length : refSubPath.length,
      matchMode: this.singleStrokeMode ? 'single' : 'segment',
      rawLength: arcLength(this.userRawPath).toFixed(1),
      score: score.finalScore,
    });
  }

  /* ──────────────────────────────────────────────── */
  /*  Undo / Redo                                     */
  /* ──────────────────────────────────────────────── */

  /** Undo: restore the previous stroke from history */
  undo(): void {
    if (this.isDrawing) return;
    if (this.historyPointer < 0) return;

    this.historyPointer--;
    if (this.historyPointer >= 0) {
      this.restoreStrokeState(this.strokeHistory[this.historyPointer]);
    } else {
      /* No strokes left — show empty canvas */
      this.clearUserCanvas();
      this.clearScoreDisplay();
      this.drawHeatmapGuide();
    }
    this.updateUndoRedoButtons();
  }

  /** Redo: restore the next stroke from history */
  redo(): void {
    if (this.isDrawing) return;
    if (this.historyPointer >= this.strokeHistory.length - 1) return;

    this.historyPointer++;
    this.restoreStrokeState(this.strokeHistory[this.historyPointer]);
    this.updateUndoRedoButtons();
  }

  /** Redraw user canvas to match a historical stroke state */
  private restoreStrokeState(state: StrokeState): void {
    this.userCtx.clearRect(0, 0, this.cssW, this.cssH);
    this.drawHeatmapGuide();

    this.userRawPath = [...state.raw];
    this.userProcessedPath = [...state.processed];

    /* Replay the raw stroke as a polyline */
    if (state.raw.length >= 2) {
      const ctx = this.userCtx;
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(state.raw[0].x, state.raw[0].y);
      for (let i = 1; i < state.raw.length; i++) {
        ctx.lineTo(state.raw[i].x, state.raw[i].y);
      }
      ctx.stroke();
    }

    /* Draw processed overlay */
    if (state.processed.length >= 2) {
      this.drawUserProcessed();
    }

    /* Restore score display */
    state.score ? this.showScore(state.score) : this.clearScoreDisplay();
  }

  /** Enable / disable undo / redo buttons based on history state */
  private updateUndoRedoButtons(): void {
    this.undoBtnEl.disabled = this.historyPointer < 0;
    this.redoBtnEl.disabled = this.historyPointer >= this.strokeHistory.length - 1;
  }

  /* ──────────────────────────────────────────────── */
  /*  Persistent history (localStorage)               */
  /* ──────────────────────────────────────────────── */

  /** Save a ScoreResult to localStorage and refresh the history UI */
  private saveToPersistentHistory(score: ScoreResult): void {
    const entry: HistoryEntry = {
      id: makeId(),
      timestamp: Date.now(),
      finalScore: score.finalScore,
      spatialScore: score.spatialScore,
      timeScore: score.timeScore,
      elapsedMs: score.elapsedMs,
      idealMs: score.idealMs,
      hausdorff95Dist: score.hausdorff95Dist,
      rmsDist: score.rmsDist,
    };
    saveEntry(entry);
    this.refreshHistoryPanel();
  }

  /** Re-render the history chart + list from localStorage */
  private refreshHistoryPanel(): void {
    const entries = loadHistory();
    this.renderHistoryChart(entries);
    this.renderHistoryList(entries);
  }

  /** Draw a sparkline of recent final scores on the history chart canvas */
  private renderHistoryChart(entries: HistoryEntry[]): void {
    const canvas = this.historyChartEl;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = this.dpr;
    const w = parent.clientWidth;
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
      ctx.fillText('暂无数据', w / 2, h / 2 + 4);
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

  /** Show the last N entries as a compact list */
  private renderHistoryList(entries: HistoryEntry[]): void {
    const el = this.historyListEl;
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

  /* ──────────────────────────────────────────────── */
  /*  Utility                                         */
  /* ──────────────────────────────────────────────── */

  private clientToCanvas(e: PointerEvent): Point {
    const rect = this.userCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }
}

/* Boot */
document.addEventListener('DOMContentLoaded', () => {
  const app = new MirrorTraceApp();

  /* Expose newCurve() to dev-tools / future UI button */
  (window as unknown as Record<string, unknown>).__mirrorTrace = app;
});

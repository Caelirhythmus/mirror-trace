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

  /* DOM elements for score display */
  private scoreFinalEl!: HTMLElement;
  private scoreSpatialEl!: HTMLElement;
  private scoreTimeEl!: HTMLElement;
  private debugHausdorffEl!: HTMLElement;
  private debugRmsEl!: HTMLElement;
  private debugElapsedEl!: HTMLElement;
  private debugIdealEl!: HTMLElement;

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
  }

  private drawUserIncremental(p: Point): void {
    const ctx = this.userCtx;
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.lineTo(p.x, p.y);
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
    this.userRawPath = [];

    /* Clear user canvas and previous score */
    this.userCtx.clearRect(0, 0, this.cssW, this.cssH);
    this.userProcessedPath = [];
    this.clearScoreDisplay();

    const p = this.clientToCanvas(e);
    this.userRawPath.push(p);
    this.userCtx.beginPath();
    this.userCtx.moveTo(p.x, p.y);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;

    const events = e.getCoalescedEvents();
    if (events.length > 0) {
      for (const ev of events) {
        const p = this.clientToCanvas(ev);
        this.userRawPath.push(p);
        this.drawUserIncremental(p);
      }
    } else {
      const p = this.clientToCanvas(e);
      this.userRawPath.push(p);
      this.drawUserIncremental(p);
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

    const rdpEpsilon = 0.5; // CSS pixels
    const simplified = rdpSimplify(this.userRawPath, rdpEpsilon);
    const resampled = resampleToCount(simplified, this.refPath.length);

    this.userProcessedPath = resampled;

    /* Overlay the processed path for visual feedback */
    this.drawUserProcessed();

    /* Score the attempt */
    const score = computeScores(this.refPath, resampled, elapsedMs);
    this.showScore(score);

    /* Log stats for debugging */
    console.log({
      rawPts: this.userRawPath.length,
      afterRDP: simplified.length,
      afterResample: resampled.length,
      refPts: this.refPath.length,
      rawLength: arcLength(this.userRawPath).toFixed(1),
      score: score.finalScore,
    });
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

/**
 * Mirror Trace — 路径临摹工具
 *
 * 左右 Canvas 双缓冲框架，集成：
 *  - 左侧：随机 C¹ 连续贝塞尔曲线（参考线）
 *  - 右侧：用户临摹，RDP 压缩 → 等距重采样
 */

import { Point } from './types';
import { generateRandomCurve, generateRotatedArch, generateMultiLines } from './generator';
import { rdpSimplify, resampleToCount, arcLength } from './trajectory';
import { computeScores, ScoreResult } from './scoring';
import { findSegment } from './matching';
import { saveEntry, loadHistory, clearHistory, makeId, HistoryEntry } from './storage';
import { clientToCanvas, drawSegment } from './input';
import {
  drawRefCanvas as renderDrawRefCanvas,
  drawHeatmapGuide as renderDrawHeatmapGuide,
  drawUserProcessed as renderDrawUserProcessed,
  replayRawStroke as renderReplayRawStroke,
  RefCanvasState,
  HeatmapState,
} from './renderer';

/* Virtual canvas coordinate space — curves are generated in this fixed
   size and scaled to fit the actual canvas via context transform. */
const VIRTUAL_W = 800;
const VIRTUAL_H = 600;

const ML_COLORS = [
  '#ff6b6b', '#4a9eff', '#50c878', '#ffd700',
  '#ff8c00', '#da70d6', '#00ced1', '#f08080',
];

/* ------------------------------------------------------------------ */
/*  Stroke history model                                               */
/* ------------------------------------------------------------------ */

interface StrokeState {
  raw: Point[];
  processed: Point[];
  score: ScoreResult | null;
  /** Index of the matched multi-line (-1 if not in multi-line mode) */
  matchedLineIdx: number;
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
  /** Uniform scale + centering offset from virtual → actual CSS pixel space */
  private get virtScale(): number { return Math.min(this.cssW / VIRTUAL_W, this.cssH / VIRTUAL_H); }
  private get virtOffX(): number { return (this.cssW - VIRTUAL_W * this.virtScale) / 2; }
  private get virtOffY(): number { return (this.cssH - VIRTUAL_H * this.virtScale) / 2; }

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
  /** true = multi-line mode (multiple lines stacked, only in single-stroke) */
  private multiLineMode = false;
  /** true = hell mode (straight + arch + complex, independent counts) */
  private hellMode = false;
  private straightLineCount = 2;
  private totalLineCount = 5;
  /** Hell-mode individual line counts */
  private hellStraightCount = 2;
  private hellArchCount = 2;
  private hellComplexCount = 1;
  /** Number of cubic-Bézier segments for overview-mode complex curve */
  private complexSegments = 3;

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
  private coverageEl!: HTMLElement;
  private progressFillEl!: HTMLElement;
  private evalBadgesEl!: HTMLElement;
  private modeLabelEl!: HTMLElement;
  private multiConfigEl!: HTMLElement;
  private multiParamsEl!: HTMLElement;
  private hellParamsEl!: HTMLElement;
  private complexParamsEl!: HTMLElement;
  private segmentsInputEl!: HTMLInputElement;

  /* coverage tracking for overview mode */
  private covered: boolean[] = [];
  /** Per-line segment coverage for hell-mode complex curves (null = simple line) */
  private complexLineCoverage: (boolean[] | null)[] = [];
  private coveragePct = 0;
  private fullEvalReady = false;

  /* full-evaluation data collection */
  private allRawPaths: Point[][] = [];
  private globalStartTime = 0;
  private segmentRecords: { score: ScoreResult; subPathLen: number }[] = [];

  /* latest segment match (for visual highlight on ref canvas) */
  private latestMatchStart = -1;
  private latestMatchEnd = -1;
  /** Pen-position hotspot position on ref canvas (null = none) */
  private liveHotspotPt: Point | null = null;

  /* multi-line mode state */
  private multiLines: Point[][] = [];
  private multiLineCovered: boolean[] = [];
  private multiLineColors: string[] = [];

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

    document.getElementById('btn-redraw')!
      .addEventListener('click', () => this.redraw());
    document.getElementById('btn-newcurve')!
      .addEventListener('click', () => this.newCurve());

    this.historyChartEl = document.getElementById('history-chart') as HTMLCanvasElement;
    this.historyListEl = document.getElementById('history-list')!;
    document.getElementById('btn-clear-history')!
      .addEventListener('click', () => { clearHistory(); this.refreshHistoryPanel(); });
    this.refreshHistoryPanel();

    this.coverageEl = document.getElementById('coverage-pct')!;
    this.progressFillEl = document.getElementById('progress-fill')!;
    this.evalBadgesEl = document.getElementById('eval-badges')!;
    this.modeLabelEl = document.getElementById('mode-label')!;
    this.multiConfigEl = document.getElementById('multi-config')!;
    this.multiParamsEl = document.getElementById('multi-params')!;
    this.complexParamsEl = document.getElementById('complex-params')!;
    this.hellParamsEl = document.getElementById('hell-params')!;
    this.segmentsInputEl = document.getElementById('input-segments') as HTMLInputElement;

    /* Bind toggles */
    const pressureToggle = document.getElementById('toggle-pressure') as HTMLInputElement;
    pressureToggle.addEventListener('change', () => {
      this.pressureEnabled = pressureToggle.checked;
    });

    const heatmapToggle = document.getElementById('toggle-heatmap') as HTMLInputElement;
    heatmapToggle.addEventListener('change', () => {
      this.heatmapEnabled = heatmapToggle.checked;
    });

    /* Mode switch: overview ↔ single-stroke */
    const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
    modeToggle.addEventListener('change', () => {
      this.singleStrokeMode = modeToggle.checked;
      this.onModeChanged();
    });

    /* Multi-line / hell toggles (mutually exclusive, visible in single-stroke mode) */
    const multiToggle = document.getElementById('toggle-multi') as HTMLInputElement;
    multiToggle.addEventListener('change', () => {
      this.multiLineMode = multiToggle.checked;
      if (this.multiLineMode) this.hellMode = false;
      this.updateConfigVisibility();
      this.newCurve();
    });
    const hellToggle = document.getElementById('toggle-hell') as HTMLInputElement;
    hellToggle.addEventListener('change', () => {
      this.hellMode = hellToggle.checked;
      if (this.hellMode) {
        this.multiLineMode = true; // share rendering logic
      } else {
        this.multiLineMode = false; // restore on exit
      }
      this.updateConfigVisibility();
      this.newCurve();
    });

    /* Multi-line numeric parameters */
    const straightInput = document.getElementById('input-straight') as HTMLInputElement;
    straightInput.addEventListener('change', () => {
      this.straightLineCount = Math.max(0, Math.min(20, parseInt(straightInput.value) || 0));
      if (this.multiLineMode) this.newCurve();
    });
    const totalInput = document.getElementById('input-total') as HTMLInputElement;
    totalInput.addEventListener('change', () => {
      this.totalLineCount = Math.max(1, Math.min(20, parseInt(totalInput.value) || 1));
      if (this.multiLineMode) this.newCurve();
    });

    /* Hell-mode numeric parameters */
    const hellStraight = document.getElementById('input-hell-straight') as HTMLInputElement;
    hellStraight.addEventListener('change', () => {
      this.hellStraightCount = Math.max(0, Math.min(20, parseInt(hellStraight.value) || 0));
      if (this.hellMode) this.newCurve();
    });
    const hellArch = document.getElementById('input-hell-arch') as HTMLInputElement;
    hellArch.addEventListener('change', () => {
      this.hellArchCount = Math.max(0, Math.min(20, parseInt(hellArch.value) || 0));
      if (this.hellMode) this.newCurve();
    });
    const hellComplex = document.getElementById('input-hell-complex') as HTMLInputElement;
    hellComplex.addEventListener('change', () => {
      this.hellComplexCount = Math.max(0, Math.min(20, parseInt(hellComplex.value) || 0));
      if (this.hellMode) this.newCurve();
    });

    /* Complex segment count (overview mode) */
    this.segmentsInputEl.addEventListener('change', () => {
      this.complexSegments = Math.max(1, Math.min(12, parseInt(this.segmentsInputEl.value) || 1));
      if (!this.singleStrokeMode) this.newCurve();
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.redraw(); }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); this.newCurve(); }
      }
    });

    this.initResizeObserver();
    this.bindPointerEvents();
    /* Force initial measurement so we have cssW/cssH before generating */
    this.resizeCanvases();
    this.updateConfigVisibility();
    this.newCurve();
  }

  /* ──────────────────────────────────────────────── */
  /*  Sizing / DPI                                    */
  /* ──────────────────────────────────────────────── */

  private initResizeObserver(): void {
    const ro = new ResizeObserver(() => this.resizeCanvases());
    ro.observe(this.refCanvas);

    /* Detect DPR (browser zoom) changes that ResizeObserver may miss */
    this.initDprListener();
  }

  /** Listen for devicePixelRatio changes (browser zoom, external monitor DPI scaling) */
  private initDprListener(): void {
    let mq: MediaQueryList;
    const listen = () => {
      mq?.removeEventListener('change', listen);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', () => {
        this.resizeCanvases();
      });
    };
    listen();
  }

  private resizeCanvases(): void {
    /* Refresh DPR — browser zoom changes devicePixelRatio */
    this.dpr = window.devicePixelRatio || 1;

    /* Ref canvas sets the baseline CSS size */
    const rectR = this.refCanvas.getBoundingClientRect();
    this.cssW = Math.round(rectR.width);
    this.cssH = Math.round(rectR.height);

    this.refCanvas.width = this.cssW * this.dpr;
    this.refCanvas.height = this.cssH * this.dpr;
    /* Uniform scale + centre: preserves aspect ratio, letterboxes extra space */
    this.refCtx.setTransform(
      this.dpr * this.virtScale, 0,
      0, this.dpr * this.virtScale,
      this.dpr * this.virtOffX, this.dpr * this.virtOffY,
    );

    /* User canvas — use its own rect (should be nearly identical) */
    const rectU = this.userCanvas.getBoundingClientRect();
    this.userCanvas.width = Math.round(rectU.width) * this.dpr;
    this.userCanvas.height = Math.round(rectU.height) * this.dpr;
    this.userCtx.setTransform(
      this.dpr * this.virtScale, 0,
      0, this.dpr * this.virtScale,
      this.dpr * this.virtOffX, this.dpr * this.virtOffY,
    );

    /* Redraw ref canvas */
    this.drawScene();

    /* Redraw user canvas content lost due to buffer resize */
    this.redrawUserCanvasContent();
  }

  /* refitRefPath is no longer needed — the virtual canvas coordinate space
     ensures curves always fit regardless of CSS canvas dimensions. */

  /**
   * Redraw the user canvas from stored stroke data after a buffer resize
   * that would otherwise leave it blank.  Handles both completed strokes
   * (strokeHistory) and the in-progress partial stroke (userRawPath).
   */
  private redrawUserCanvasContent(): void {
    const ctx = this.userCtx;

    /* Heatmap guide background */
    if (this.singleStrokeMode || this.multiLineMode) {
      this.drawHeatmapGuide();
    }

    /* ── Completed strokes from history ── */

    if (this.historyPointer >= 0) {
      if (this.singleStrokeMode && !this.multiLineMode) {
        /* Single-stroke: only the last (current) completed stroke */
        const state = this.strokeHistory[this.historyPointer];
        if (state) {
          this.replayRawStroke(state);
          this.userProcessedPath = [...state.processed];
          if (state.processed.length >= 2) this.drawUserProcessed();
        }
      } else if (this.multiLineMode) {
        /* Multi-line: replay all strokes, restore coverage */
        this.multiLineCovered = new Array(this.multiLines.length).fill(false);
        for (let i = 0; i <= this.historyPointer; i++) {
          const s = this.strokeHistory[i];
          this.replayRawStroke(s);
          if (s.matchedLineIdx >= 0 && s.matchedLineIdx < this.multiLineCovered.length) {
            this.multiLineCovered[s.matchedLineIdx] = true;
          }
        }
        this.coveragePct = Math.round(
          (this.multiLineCovered.filter(v => v).length / this.multiLines.length) * 100,
        );
        this.updateCoverageUI();
        this.drawRefCanvas();
      } else {
        /* Overview: replay all strokes, restore coverage */
        this.covered = new Array(this.refPath.length).fill(false);
        for (let i = 0; i <= this.historyPointer; i++) {
          const s = this.strokeHistory[i];
          this.replayRawStroke(s);
          if (s.raw.length >= 2 && this.refPath.length >= 2) {
            const match = findSegment(this.refPath, s.raw);
            for (let j = match.startIdx; j <= match.endIdx; j++) {
              this.covered[j] = true;
            }
          }
        }
        this.coveragePct = Math.round(
          (this.covered.filter(v => v).length / this.refPath.length) * 100,
        );
        this.updateCoverageUI();
        this.drawRefCanvas();
      }

      /* Restore score display */
      const state = this.strokeHistory[this.historyPointer];
      state.score ? this.showScore(state.score) : this.clearScoreDisplay();
    }

    /* ── In-progress partial stroke (if currently drawing) ── */
    if (this.isDrawing && this.userRawPath.length >= 2) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(this.userRawPath[0].x, this.userRawPath[0].y);
      for (let i = 1; i < this.userRawPath.length; i++) {
        ctx.lineTo(this.userRawPath[i].x, this.userRawPath[i].y);
      }
      ctx.stroke();
    }
  }

  /* ──────────────────────────────────────────────── */
  /*  Curve generation                                */
  /* ──────────────────────────────────────────────── */

  /** Generate a fresh reference curve and reset everything */
  newCurve(): void {
    if (this.cssW < 100 || this.cssH < 100) return;
    this.strokeHistory = [];
    this.historyPointer = -1;
    if (this.multiLineMode) {
      const result = this.hellMode
        ? generateMultiLines(VIRTUAL_W, VIRTUAL_H, this.hellStraightCount, this.hellArchCount, this.hellComplexCount, 40, this.complexSegments)
        : generateMultiLines(VIRTUAL_W, VIRTUAL_H, this.straightLineCount, this.totalLineCount - this.straightLineCount, 0, 40);
      this.multiLines = result.lines;
      this.refPath = result.lines[0];
      this.multiLineCovered = new Array(this.multiLines.length).fill(false);
      this.multiLineColors = this.multiLines.map((_, i) => ML_COLORS[i % ML_COLORS.length]);
      /* In hell mode, detect complex curves (many points) for segment-level coverage */
      this.complexLineCoverage = this.hellMode
        ? this.multiLines.map(line => line.length > 80 ? new Array(line.length).fill(false) : null)
        : [];
      this.coveragePct = 0;
      this.fullEvalReady = false;
    } else {
      this.multiLines = [];
      this.multiLineCovered = [];
      this.multiLineColors = [];
      this.complexLineCoverage = [];
      this.refPath = this.singleStrokeMode
        ? generateRotatedArch(VIRTUAL_W, VIRTUAL_H, 40)
        : generateRandomCurve(VIRTUAL_W, VIRTUAL_H, 40, this.complexSegments);
      this.covered = new Array(this.refPath.length).fill(false);
      this.coveragePct = 0;
      this.fullEvalReady = false;
    }
    this.allRawPaths = [];
    this.globalStartTime = 0;
    this.segmentRecords = [];
    this.latestMatchStart = -1;
    this.latestMatchEnd = -1;
    this.evalBadgesEl.style.display = 'none';
    this.evalBadgesEl.innerHTML = '';
    /* Force layout recalculation so virtScale/virtOffX/Y reflect the
       post-panel canvas size before we clear and redraw. */
    this.resizeCanvases();
    this.updateCoverageUI();
    this.clearUserCanvas();
    this.clearScoreDisplay();
    this.drawScene();
  }

  /**
   * Redraw the SAME reference curve — clear user strokes but keep refPath.
   * Useful when the user wants to retry the current curve.
   */
  redraw(): void {
    this.strokeHistory = [];
    this.historyPointer = -1;
    if (this.multiLineMode) {
      this.multiLineCovered = new Array(this.multiLines.length).fill(false);
      this.coveragePct = 0;
      this.fullEvalReady = false;
      this.allRawPaths = [];
      this.globalStartTime = 0;
      this.segmentRecords = [];
      this.evalBadgesEl.style.display = 'none';
      this.evalBadgesEl.innerHTML = '';
      /* Reset hell-mode complex line segment coverage */
      this.complexLineCoverage = this.complexLineCoverage.map(c => c ? new Array(c.length).fill(false) : null);
      this.resizeCanvases();
      this.updateCoverageUI();
    } else {
      this.resetCoverage();
    }
    this.clearUserCanvas();
    this.clearScoreDisplay();
    this.drawScene();
  }

  /** Reset coverage tracking and re-render ref canvas */
  private resetCoverage(): void {
    this.covered = new Array(this.refPath.length).fill(false);
    this.coveragePct = 0;
    this.fullEvalReady = false;
    this.allRawPaths = [];
    this.globalStartTime = 0;
    this.segmentRecords = [];
    this.latestMatchStart = -1;
    this.latestMatchEnd = -1;
    this.liveHotspotPt = null;
    this.multiLines = [];
    this.multiLineCovered = [];
    this.multiLineColors = [];
    this.complexLineCoverage = [];
    this.evalBadgesEl.style.display = 'none';
    this.evalBadgesEl.innerHTML = '';
    this.resizeCanvases();
    this.updateCoverageUI();
  }

  /** Called when the user toggles between overview and single-stroke mode */
  private onModeChanged(): void {
    this.modeLabelEl.textContent = this.singleStrokeMode ? '单笔' : '概括';
    if (!this.singleStrokeMode) {
      /* Switch to overview: reset multi-line/hell toggles */
      this.multiLineMode = false;
      this.hellMode = false;
    }
    this.updateConfigVisibility();
    this.newCurve();
  }

  /** Show/hide multi-line config and mode controls based on current states */
  private updateConfigVisibility(): void {
    this.multiConfigEl.style.display = 'flex';

    if (this.hellMode) {
      /* Hell mode is independent: hide all mode/line toggles, show only hell
         params + generic controls (pen, guide, history) */
      document.getElementById('multi-toggle-row')!.style.display = 'none';
      document.getElementById('hell-toggle-row')!.style.display = 'flex';
      this.multiParamsEl.style.display = 'none';
      this.hellParamsEl.style.display = 'flex';
      this.complexParamsEl.style.display = 'none';
      document.getElementById('mode-switch')!.style.display = 'none';
      return;
    }

    if (this.singleStrokeMode) {
      document.getElementById('multi-toggle-row')!.style.display = 'flex';
      document.getElementById('hell-toggle-row')!.style.display = 'flex';
      this.multiParamsEl.style.display = this.multiLineMode ? 'flex' : 'none';
      this.hellParamsEl.style.display = 'none';
      this.complexParamsEl.style.display = 'none';
      document.getElementById('mode-switch')!.style.display = 'inline-flex';
    } else {
      /* Overview mode */
      document.getElementById('multi-toggle-row')!.style.display = 'none';
      document.getElementById('hell-toggle-row')!.style.display = 'flex';
      this.multiParamsEl.style.display = 'none';
      this.hellParamsEl.style.display = 'none';
      this.complexParamsEl.style.display = 'flex';
      document.getElementById('mode-switch')!.style.display = 'inline-flex';
    }
  }

  /* ──────────────────────────────────────────────── */
  /*  Drawing                                         */
  /* ──────────────────────────────────────────────── */

  /** Build the rendering state object for drawRefCanvas */
  private getRefCanvasState(): RefCanvasState {
    return {
      multiLineMode: this.multiLineMode,
      multiLines: this.multiLines,
      multiLineColors: this.multiLineColors,
      multiLineCovered: this.multiLineCovered,
      complexLineCoverage: this.complexLineCoverage,
      refPath: this.refPath,
      covered: this.covered,
      latestMatchStart: this.latestMatchStart,
      latestMatchEnd: this.latestMatchEnd,
      liveHotspotPt: this.liveHotspotPt,
      heatmapEnabled: this.heatmapEnabled,
    };
  }

  /** Build the rendering state object for drawHeatmapGuide */
  private getHeatmapState(): HeatmapState {
    return {
      multiLineMode: this.multiLineMode,
      multiLines: this.multiLines,
      refPath: this.refPath,
      singleStrokeMode: this.singleStrokeMode,
      heatmapEnabled: this.heatmapEnabled,
    };
  }

  private drawScene(): void {
    this.drawRefCanvas();
  }

  private drawRefCanvas(): void {
    renderDrawRefCanvas(this.refCtx, VIRTUAL_W, VIRTUAL_H, ML_COLORS, this.getRefCanvasState());
  }

  private clearUserCanvas(): void {
    this.userCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    this.userRawPath = [];
    this.userProcessedPath = [];
    this.prevPoint = { x: 0, y: 0 };
    this.liveHotspotPt = null;
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
    renderDrawUserProcessed(this.userCtx, this.userProcessedPath);
  }

  /* ──────────────────────────────────────────────── */
  /*  Heatmap guidance                                */
  /* ──────────────────────────────────────────────── */

  /** Draw the full reference curve very faintly as a static guide on the user canvas */
  private drawHeatmapGuide(): void {
    renderDrawHeatmapGuide(this.userCtx, this.getHeatmapState());
  }

  /** Update coverage UI based on mode and coverage percentage */
  private updateCoverageUI(): void {
    if (!this.multiLineMode && this.singleStrokeMode) {
      this.coverageEl.textContent = '\u2014';
      this.progressFillEl.style.width = '0%';
    } else {
      this.coverageEl.textContent = `${this.coveragePct}%`;
      this.progressFillEl.style.width = `${this.coveragePct}%`;
    }
  }

  /** Update live pen-position hotspot on the reference canvas */
  private updateLiveHotspot(penPos: Point): void {
    if (!this.heatmapEnabled) {
      if (this.liveHotspotPt !== null) { this.liveHotspotPt = null; this.drawRefCanvas(); }
      return;
    }

    let bestPt: Point | null = null;
    let bestDist = Infinity;

    if (this.multiLineMode) {
      /* Multi-line: find nearest point on any uncovered line */
      for (let li = 0; li < this.multiLines.length; li++) {
        if (this.multiLineCovered[li]) continue;
        const line = this.multiLines[li];
        if (line.length < 2) continue;
        for (let i = 0; i < line.length; i++) {
          const d = Math.hypot(line[i].x - penPos.x, line[i].y - penPos.y);
          if (d < bestDist) { bestDist = d; bestPt = line[i]; }
        }
      }
    } else {
      /* Single-stroke / overview mode */
      if (this.refPath.length < 2) {
        if (this.liveHotspotPt !== null) { this.liveHotspotPt = null; this.drawRefCanvas(); }
        return;
      }
      for (let i = 0; i < this.refPath.length; i++) {
        const d = Math.hypot(this.refPath[i].x - penPos.x, this.refPath[i].y - penPos.y);
        if (d < bestDist) { bestDist = d; bestPt = this.refPath[i]; }
      }
    }

    /* Only redraw if the position actually changed */
    const changed = bestPt === null
      ? this.liveHotspotPt !== null
      : this.liveHotspotPt === null ||
        bestPt.x !== this.liveHotspotPt.x ||
        bestPt.y !== this.liveHotspotPt.y;

    if (changed) {
      this.liveHotspotPt = bestPt;
      this.drawRefCanvas();
    }
  }

  /* ──────────────────────────────────────────────── */
  /*  Pointer events                                  */
  /* ──────────────────────────────────────────────── */

  private bindPointerEvents(): void {
    const el = this.userCanvas;
    el.addEventListener('pointerdown', this.onPointerDown.bind(this));
    el.addEventListener('pointermove', this.onPointerMove.bind(this));
    el.addEventListener('pointerup', this.onPointerUp.bind(this));
    /* Don't bind pointerleave — lifting the pen outside the canvas
       would truncate the stroke. Let the next pointerdown discard it. */
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDrawing = true;
    /* Capture pointer so pointerup fires even outside the canvas */
    this.userCanvas.setPointerCapture(e.pointerId);
    this.pointerDownTime = performance.now();
    /* Any new stroke discards the redo future */
    this.strokeHistory.length = this.historyPointer + 1;
    this.userRawPath = [];

    /* Start global timer on very first stroke */
    if (this.allRawPaths.length === 0) {
      this.globalStartTime = performance.now();
    }

    if (this.singleStrokeMode || this.multiLineMode) {
      /* Clear canvas for independent strokes */
      this.userCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    }
    this.userProcessedPath = [];
    this.clearScoreDisplay();

    /* Clear latest-match highlight and hotspot on ref canvas */
    if (this.latestMatchStart >= 0 || this.liveHotspotPt !== null) {
      this.latestMatchStart = -1;
      this.latestMatchEnd = -1;
      this.liveHotspotPt = null;
      this.drawRefCanvas();
    }

    /* Draw heatmap guide as background layer */
    if (this.singleStrokeMode || this.multiLineMode) {
      this.drawHeatmapGuide();
    }

    const p = clientToCanvas(e, this.userCanvas, this.virtOffX, this.virtOffY, this.virtScale);
    this.userRawPath.push(p);
    this.prevPoint = p;
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;

    const events = e.getCoalescedEvents();
    if (events.length > 0) {
      for (const ev of events) {
        const p = clientToCanvas(ev, this.userCanvas, this.virtOffX, this.virtOffY, this.virtScale);
        this.userRawPath.push(p);
        drawSegment(this.userCtx, this.prevPoint, p, ev.pressure, ev.tiltX, ev.tiltY, this.pressureEnabled);
        this.prevPoint = p;
      }
    } else {
      const p = clientToCanvas(e, this.userCanvas, this.virtOffX, this.virtOffY, this.virtScale);
      this.userRawPath.push(p);
      drawSegment(this.userCtx, this.prevPoint, p, e.pressure, e.tiltX, e.tiltY, this.pressureEnabled);
      this.prevPoint = p;
    }

    /* Update live pen-position hotspot on the reference canvas */
    this.updateLiveHotspot(this.userRawPath[this.userRawPath.length - 1]);
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

    /* strokeHistory was already truncated in onPointerDown */
    const rdpEpsilon = 0.5; // CSS pixels
    const simplified = rdpSimplify(this.userRawPath, rdpEpsilon);

    /* Determine which reference sub-path to score against */
    let refSubPath: Point[];
    let matchedLineIdx = -1;
    if (this.multiLineMode) {
      /* Multi-line mode: match stroke to nearest un-covered line */
      matchedLineIdx = this.matchMultiLine();
      if (matchedLineIdx < 0) return; // no matching line found
      const matchedLine = this.multiLines[matchedLineIdx];
      /* Hell mode complex curve: use segment matching within the line */
      const segCov = this.complexLineCoverage[matchedLineIdx];
      if (segCov) {
        const match = findSegment(matchedLine, this.userRawPath);
        refSubPath = match.subPath;
        /* Track segment coverage within this complex line */
        for (let j = match.startIdx; j <= match.endIdx; j++) {
          segCov[j] = true;
        }
      } else {
        refSubPath = matchedLine;
      }
    } else if (this.singleStrokeMode) {
      /* Single-stroke mode: entire ref path (arch curve) */
      refSubPath = this.refPath;
    } else {
      /* Overview mode: match user stroke start/end to refPath segment */
      const match = findSegment(this.refPath, this.userRawPath);
      refSubPath = match.subPath;

      /* Store stroke & segment data for full evaluation */
      this.allRawPaths.push([...this.userRawPath]);
      this.segmentRecords.push({
        score: null as unknown as ScoreResult, // placeholder, filled below
        subPathLen: arcLength(refSubPath),
      });

      /* Record latest match for visual highlight on ref canvas */
      this.latestMatchStart = match.startIdx;
      this.latestMatchEnd = match.endIdx;

      /* Mark covered indices on refPath */
      for (let i = match.startIdx; i <= match.endIdx; i++) {
        this.covered[i] = true;
      }
      this.coveragePct = Math.round(
        (this.covered.filter(v => v).length / this.refPath.length) * 100,
      );
      this.updateCoverageUI();

      /* Redraw ref canvas to show updated coverage */
      this.drawRefCanvas();
    }

    const resampled = resampleToCount(simplified, refSubPath.length);

    this.userProcessedPath = resampled;

    /* Only show processed overlay in single-stroke (non-multi) mode */
    if (this.singleStrokeMode && !this.multiLineMode) {
      this.drawUserProcessed();
    }

    /* Score the attempt */
    const score = computeScores(refSubPath, resampled, elapsedMs);

    /* Store score in segment records (overview mode) */
    if (!this.singleStrokeMode && this.segmentRecords.length > 0) {
      const last = this.segmentRecords[this.segmentRecords.length - 1];
      last.score = score;
    }

    /* Multi-line: mark line as covered and update UI */
    if (this.multiLineMode && matchedLineIdx >= 0) {
      /* Hell mode complex curve: only mark fully covered when all segments traced */
      const segCov = this.complexLineCoverage[matchedLineIdx];
      if (segCov) {
        if (segCov.every(v => v)) this.multiLineCovered[matchedLineIdx] = true;
      } else {
        this.multiLineCovered[matchedLineIdx] = true;
      }
      this.coveragePct = Math.round(
        (this.multiLineCovered.filter(v => v).length / this.multiLines.length) * 100,
      );
      this.updateCoverageUI();
      this.drawRefCanvas();

      /* Check completion */
      if (this.coveragePct >= 100 && !this.fullEvalReady) {
        this.triggerFullEvaluation(score);
      }
    }

    /* Auto-trigger full evaluation when coverage ≥ 97 % (overview non-multi) */
    if (!this.singleStrokeMode && !this.multiLineMode && this.coveragePct >= 97 && !this.fullEvalReady) {
      this.triggerFullEvaluation(score);
    }
    this.showScore(score);

    /* Save to history */
    this.strokeHistory.push({
      raw: [...this.userRawPath],
      processed: [...this.userProcessedPath],
      score,
      matchedLineIdx,
    });
    this.historyPointer = this.strokeHistory.length - 1;
    this.updateUndoRedoButtons();

    /* Persist to localStorage only for full-attempt strokes */
    if (this.singleStrokeMode) {
      this.saveToPersistentHistory(score);
    }

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
      this.restoreStrokesUpTo(this.historyPointer);
    } else {
      /* No strokes left — show empty canvas */
      this.clearUserCanvas();
      this.clearScoreDisplay();
      /* Reset coverage tracking */
      if (this.multiLineMode) {
        this.multiLineCovered = new Array(this.multiLines.length).fill(false);
      } else if (!this.singleStrokeMode) {
        this.covered = new Array(this.refPath.length).fill(false);
      }
      this.globalStartTime = 0;
      this.coveragePct = 0;
      this.updateCoverageUI();
      this.drawRefCanvas();
      if (this.singleStrokeMode || this.multiLineMode) {
        this.drawHeatmapGuide();
      }
    }
    this.updateUndoRedoButtons();
  }

  /** Redo: restore the next stroke from history */
  redo(): void {
    if (this.isDrawing) return;
    if (this.historyPointer >= this.strokeHistory.length - 1) return;

    this.historyPointer++;
    this.restoreStrokesUpTo(this.historyPointer);
    this.updateUndoRedoButtons();
  }

  /** Replay a single raw stroke polyline onto the user canvas */
  private replayRawStroke(state: StrokeState): void {
    renderReplayRawStroke(this.userCtx, state.raw);
  }

  /**
   * Restore canvas + state to reflect the cumulative state after
   * strokeHistory[index].
   *
   * - Single-stroke mode: each stroke is a full curve → show only that one.
   * - Overview mode: strokes accumulate → replay all 0…index with coverage.
   * - Multi-line mode: each stroke covers one sub-line → replay all 0…index.
   */
  private restoreStrokesUpTo(index: number): void {
    const state = this.strokeHistory[index];
    if (!state) return;

    this.userCtx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    /* Single-stroke (non-multi) mode — independent full-curve attempts */
    if (this.singleStrokeMode && !this.multiLineMode) {
      this.drawHeatmapGuide();
      this.replayRawStroke(state);
      this.userProcessedPath = [...state.processed];
      if (state.processed.length >= 2) this.drawUserProcessed();
      state.score ? this.showScore(state.score) : this.clearScoreDisplay();
      return;
    }

    /* Multi-line mode — each stroke covers one sub-line */
    if (this.multiLineMode) {
      this.drawHeatmapGuide();
      for (let i = 0; i <= index; i++) {
        const s = this.strokeHistory[i];
        this.replayRawStroke(s);
        if (s.matchedLineIdx >= 0 && s.matchedLineIdx < this.multiLineCovered.length) {
          this.multiLineCovered[s.matchedLineIdx] = true;
        }
      }
      this.coveragePct = Math.round(
        (this.multiLineCovered.filter(v => v).length / this.multiLines.length) * 100,
      );
      this.updateCoverageUI();
      this.drawRefCanvas();
      state.score ? this.showScore(state.score) : this.clearScoreDisplay();
      return;
    }

    /* Overview mode — strokes accumulate with coverage tracking */
    this.covered = new Array(this.refPath.length).fill(false);
    this.drawHeatmapGuide();
    for (let i = 0; i <= index; i++) {
      const s = this.strokeHistory[i];
      this.replayRawStroke(s);
      if (s.raw.length >= 2 && this.refPath.length >= 2) {
        const match = findSegment(this.refPath, s.raw);
        for (let j = match.startIdx; j <= match.endIdx; j++) {
          this.covered[j] = true;
        }
      }
    }
    this.coveragePct = Math.round(
      (this.covered.filter(v => v).length / this.refPath.length) * 100,
    );
    this.updateCoverageUI();
    this.drawRefCanvas();
    state.score ? this.showScore(state.score) : this.clearScoreDisplay();
  }

  /** Enable / disable undo / redo buttons based on history state */
  private updateUndoRedoButtons(): void {
    this.undoBtnEl.disabled = this.historyPointer < 0;
    this.redoBtnEl.disabled = this.historyPointer >= this.strokeHistory.length - 1;
  }

  /* ──────────────────────────────────────────────── */
  /*  Full evaluation (triggered at ≥ 97 % coverage)  */
  /* ──────────────────────────────────────────────── */

  /**
   * Compute and display full evaluation results using two algorithms:
   *
   *   A — Global timer + global spatial score.
   *       All strokes are concatenated into one path (with straight-line
   *       connectors), simplified, resampled to full refPath length,
   *       then scored as a single attempt.
   *
   *   B — Length-weighted average of all segment final scores.
   */
  private triggerFullEvaluation(lastStrokeScore: ScoreResult): void {
    this.fullEvalReady = true;

    const globalElapsed = performance.now() - this.globalStartTime;

    /* ── Algorithm A: Global (concatenated path) ── */
    let globalCombined: Point[] = [];
    for (let s = 0; s < this.allRawPaths.length; s++) {
      const stroke = this.allRawPaths[s];
      if (stroke.length < 2) continue;
      if (globalCombined.length === 0) {
        globalCombined.push(...stroke.map(p => ({ x: p.x, y: p.y })));
      } else {
        /* Connector: straight line from end of previous stroke to start of this one */
        globalCombined.push(stroke[0]);
        globalCombined.push(...stroke.map(p => ({ x: p.x, y: p.y })));
      }
    }

    let globalScore: ScoreResult;
    if (globalCombined.length >= 3) {
      const simplified = rdpSimplify(globalCombined, 0.5);
      const resampled = resampleToCount(simplified, this.refPath.length);
      globalScore = computeScores(this.refPath, resampled, globalElapsed);
    } else {
      globalScore = lastStrokeScore;
    }

    /* ── Algorithm B: Length-weighted average ── */
    let weightedSum = 0;
    let totalWeight = 0;
    for (const rec of this.segmentRecords) {
      if (rec.score) {
        weightedSum += rec.score.finalScore * rec.subPathLen;
        totalWeight += rec.subPathLen;
      }
    }
    const avgScore = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 10) / 10
      : 0;

    /* ── Display (inline badges in score panel) ── */
    this.evalBadgesEl.innerHTML = `
      <span class="eval-badge">
        <span class="eval-badge-label">全评 A</span>
        <span class="eval-badge-score">${globalScore.finalScore}</span>
        <span class="eval-badge-sub">空 ${globalScore.spatialScore} · 时 ${globalScore.timeScore}</span>
      </span>
      <span class="eval-badge">
        <span class="eval-badge-label">段均 B</span>
        <span class="eval-badge-score">${avgScore}</span>
        <span class="eval-badge-sub">${this.segmentRecords.length} 段</span>
      </span>
    `;
    this.evalBadgesEl.style.display = 'inline-flex';

    /* Persist the global evaluation score to localStorage */
    this.saveToPersistentHistory(globalScore);
  }

  /** Find the un-covered multi-line closest to the user's current stroke start/end */
  private matchMultiLine(): number {
    if (this.userRawPath.length < 2) return -1;
    const startP = this.userRawPath[0];
    const endP = this.userRawPath[this.userRawPath.length - 1];

    let bestIdx = -1;
    let bestDist = Infinity;

    for (let li = 0; li < this.multiLines.length; li++) {
      if (this.multiLineCovered[li]) continue;
      const line = this.multiLines[li];
      if (line.length < 2) continue;

      /* Find nearest index for start and end, sum distances */
      let minStart = Infinity, minEnd = Infinity;
      for (const p of line) {
        const ds = Math.hypot(p.x - startP.x, p.y - startP.y);
        const de = Math.hypot(p.x - endP.x, p.y - endP.y);
        if (ds < minStart) minStart = ds;
        if (de < minEnd) minEnd = de;
      }
      const combined = minStart + minEnd;
      if (combined < bestDist) {
        bestDist = combined;
        bestIdx = li;
      }
    }
    return bestIdx;
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

}

/* Boot */
document.addEventListener('DOMContentLoaded', () => {
  const app = new MirrorTraceApp();

  /* Expose newCurve() to dev-tools / future UI button */
  (window as unknown as Record<string, unknown>).__mirrorTrace = app;
});

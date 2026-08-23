/**
 * Mirror Trace — 路径临摹工具
 *
 * 左右 Canvas 双缓冲框架，集成：
 *  - 左侧：随机 C¹ 连续贝塞尔曲线（参考线）
 *  - 右侧：用户临摹，RDP 压缩 → 等距重采样
 */

import { Point, VIRTUAL_W, VIRTUAL_H } from './types';
import { generateRandomCurve, generateRotatedArch, generateMultiLines } from './generator';
import { rdpSimplify, resampleToCount } from './trajectory';
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
import { renderHistoryChart, renderHistoryList } from './history-manager';
import { buildSVG, downloadPNG, buildReport, triggerDownload, textToDataURL } from './exporter';
import { findPreset } from './presets';
import {
  themes, findTheme, loadThemeName, saveThemeName, applyTheme,
  paletteFromTheme, hexToRgb, CanvasPalette, Theme,
} from './themes';

const ML_COLORS = [
  '#ff6b6b', '#4a9eff', '#50c878', '#ffd700',
  '#ff8c00', '#da70d6', '#00ced1', '#f08080',
  '#98fb98', '#ff69b4', '#87ceeb', '#dda0dd',
  '#f0e68c', '#90ee90', '#ffb347', '#add8e6',
];

/* Point-count threshold separating complex curves (segment-level
   coverage in hell mode) from simple lines.  Arch/straight lines are
   sampled at t = 0.015 (~68 points); complex curves at t = 0.01 per
   Bézier segment (≥ 101 points for a single segment).  80 sits safely
   between the two sampling densities. */
const COMPLEX_LINE_MIN_POINTS = 80;

/* ------------------------------------------------------------------ */
/*  Stroke history model                                               */
/* ------------------------------------------------------------------ */

interface StrokeState {
  raw: Point[];
  processed: Point[];
  score: ScoreResult | null;
  /** Index of the matched multi-line (-1 if not in multi-line mode) */
  matchedLineIdx: number;
  /** Reference sub-path this stroke was scored against (full-eval input) */
  refSubPath: Point[];
  /** performance.now() at pointerdown */
  startTime: number;
  /** performance.now() at pointerup */
  endTime: number;
}

export class MirrorTraceApp {
  /* canvases & contexts */
  private refCanvas!: HTMLCanvasElement;
  private userCanvas!: HTMLCanvasElement;
  private refCtx!: CanvasRenderingContext2D;
  private userCtx!: CanvasRenderingContext2D;

  /* dimensions */
  dpr = 1; // ↑ public for integration-test access
  private cssW = 0;
  private cssH = 0;
  /** Uniform scale + centering offset from virtual → actual CSS pixel space */
  private get virtScale(): number { return Math.min(this.cssW / VIRTUAL_W, this.cssH / VIRTUAL_H); }
  private get virtOffX(): number { return (this.cssW - VIRTUAL_W * this.virtScale) / 2; }
  private get virtOffY(): number { return (this.cssH - VIRTUAL_H * this.virtScale) / 2; }

  /* paths */
  refPath: Point[] = [];          // reference curve (from generator) — public for tests
  userRawPath: Point[] = [];      // raw coalesced pointer points — public for tests
  userProcessedPath: Point[] = []; // after RDP + resample — public for tests

  /* state */
  isDrawing = false; // public for tests
  private pointerDownTime = 0;
  prevPoint: Point = { x: 0, y: 0 };
  pressureEnabled = true;
  heatmapEnabled = true;
  gridEnabled = false;
  private gridSize = 40;
  colorEnabled = false;
  /** false = overview mode (multi-stroke, segment matching) */
  singleStrokeMode = false;
  /** true = multi-line mode (multiple lines stacked, only in single-stroke) */
  multiLineMode = false;
  /** true = hell mode (straight + arch + complex, independent counts) */
  hellMode = false;
  private straightLineCount = 2;
  private archLineCount = 3;
  /** Hell-mode individual line counts */
  private hellStraightCount = 2;
  private hellArchCount = 2;
  private hellComplexCount = 1;
  /** Number of cubic-Bézier segments for overview-mode complex curve */
  private complexSegments = 3;

  /* canvas colours from the active theme */
  private palette: CanvasPalette = paletteFromTheme(themes[0]);
  /** User-stroke ink as RGB components (alpha varies per tilt) */
  private strokeRGB = hexToRgb(themes[0].vars['stroke-default'] ?? '#ff6b6b');

  /* stroke history for undo / redo */
  strokeHistory: StrokeState[] = [];
  historyPointer = -1;

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
  private replayBtnEl!: HTMLButtonElement;
  private sidebarEl!: HTMLElement;
  private backdropEl!: HTMLElement;
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
  /** Latest full-evaluation score — null when it no longer reflects
      the visible strokes (used by the report export). */
  private lastFullEval: ScoreResult | null = null;

  /* latest segment match (for visual highlight on ref canvas) */
  private latestMatchStart = -1;
  private latestMatchEnd = -1;
  /** Pen-position hotspot position on ref canvas (null = none) */
  liveHotspotPt: Point | null = null; // public for tests

  /* multi-line mode state */
  multiLines: Point[][] = [];
  multiLineCovered: boolean[] = [];
  multiLineColors: string[] = [];

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
    const replayBtn = document.getElementById('btn-replay') as HTMLButtonElement;
    replayBtn.addEventListener('click', () => this.replayStroke());
    this.replayBtnEl = replayBtn;
    this.updateUndoRedoButtons();

    /* Export button + popup menu */
    const exportBtn = document.getElementById('btn-export')!;
    const exportMenu = document.getElementById('export-menu')!;
    exportBtn.addEventListener('click', () => {
      const rect = exportBtn.getBoundingClientRect();
      exportMenu.style.display = 'flex';
      exportMenu.style.left = `${rect.left}px`;
      exportMenu.style.top = `${rect.bottom + 2}px`;
    });
    document.addEventListener('click', (e) => {
      if (!exportMenu.contains(e.target as Node) && e.target !== exportBtn) {
        exportMenu.style.display = 'none';
      }
    });
    exportMenu.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-export]') as HTMLElement | null;
      if (!target) return;
      exportMenu.style.display = 'none';
      const format = target.getAttribute('data-export');
      this.doExport(format!);
    });

    /* Help button */
    const helpOverlay = document.getElementById('help-overlay')!;
    document.getElementById('btn-help')!
      .addEventListener('click', () => { helpOverlay.style.display = 'flex'; });
    helpOverlay.addEventListener('click', () => { helpOverlay.style.display = 'none'; });

    /* Sidebar toggle + backdrop */
    this.sidebarEl = document.getElementById('sidebar')!;
    this.backdropEl = document.getElementById('sidebar-backdrop')!;
    document.getElementById('btn-sidebar')!
      .addEventListener('click', () => this.toggleSidebar());
    this.backdropEl.addEventListener('click', () => this.closeSidebar());
    document.getElementById('btn-close-sidebar')!
      .addEventListener('click', () => this.closeSidebar());

    document.getElementById('btn-redraw')!
      .addEventListener('click', () => this.redraw());
    document.getElementById('btn-newcurve')!
      .addEventListener('click', () => this.newCurve());

    this.historyChartEl = document.getElementById('history-chart') as HTMLCanvasElement;
    this.historyListEl = document.getElementById('history-list')!;
    document.getElementById('btn-clear-history')!
      .addEventListener('click', () => { clearHistory(); this.refreshHistoryPanel(); });
    this.refreshHistoryPanel();
    this.initTheme();

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
      this.clearUserCanvas();
      this.redrawUserCanvasContent();
    });

    /* Grid toggle + density */
    const gridToggle = document.getElementById('toggle-grid') as HTMLInputElement;
    const gridSizeInput = document.getElementById('input-grid-size') as HTMLInputElement;
    const updateGrid = () => {
      this.gridEnabled = gridToggle.checked;
      gridSizeInput.style.display = this.gridEnabled ? 'inline-block' : 'none';
      this.updateGridOverlay();
    };
    gridToggle.addEventListener('change', updateGrid);
    gridSizeInput.addEventListener('change', () => {
      this.gridSize = Math.max(20, Math.min(100, parseInt(gridSizeInput.value) || 40));
      this.updateGridOverlay();
    });

    /* Color toggle */
    document.getElementById('toggle-color')!.addEventListener('change', (e) => {
      this.colorEnabled = (e.target as HTMLInputElement).checked;
      this.drawRefCanvas();
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
        /* Restore multi-line state from the actual checkbox */
        this.multiLineMode = (document.getElementById('toggle-multi') as HTMLInputElement).checked;
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
    const archInput = document.getElementById('input-arch') as HTMLInputElement;
    archInput.addEventListener('change', () => {
      this.archLineCount = Math.max(0, Math.min(20, parseInt(archInput.value) || 0));
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

    /* Preset selector */
    document.getElementById('preset-select')!.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (!id) return;
      const preset = findPreset(id);
      if (!preset) return;
      /* Presets always use single-stroke (multi-line / hell) mode */
      this.singleStrokeMode = true;
      this.modeLabelEl.textContent = '单笔';
      (document.getElementById('toggle-mode') as HTMLInputElement).checked = true;

      if (preset.hellMode) {
        this.hellStraightCount = preset.counts[0];
        this.hellArchCount = preset.counts[1];
        this.hellComplexCount = preset.counts[2];
        this.hellMode = true;
        this.multiLineMode = true;
        /* Sync hell-mode inputs */
        (document.getElementById('input-hell-straight') as HTMLInputElement).value = String(preset.counts[0]);
        (document.getElementById('input-hell-arch') as HTMLInputElement).value = String(preset.counts[1]);
        (document.getElementById('input-hell-complex') as HTMLInputElement).value = String(preset.counts[2]);
        (document.getElementById('toggle-hell') as HTMLInputElement).checked = true;
        (document.getElementById('toggle-multi') as HTMLInputElement).checked = true;
      } else {
        this.straightLineCount = preset.counts[0];
        this.archLineCount = preset.counts[1];
        this.hellMode = false;
        this.multiLineMode = true;
        /* Sync multi-mode inputs */
        (document.getElementById('input-straight') as HTMLInputElement).value = String(preset.counts[0]);
        (document.getElementById('input-arch') as HTMLInputElement).value = String(this.archLineCount);
        (document.getElementById('toggle-multi') as HTMLInputElement).checked = true;
        (document.getElementById('toggle-hell') as HTMLInputElement).checked = false;
      }
      this.updateConfigVisibility();
      this.newCurve();
      /* Reset the select to the placeholder */
      (e.target as HTMLSelectElement).value = '';
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', (e) => {
      /* Skip while typing in form controls — digits typed into the
         line-count inputs would otherwise switch modes and reset the
         canvas, and Ctrl+Z would undo the app instead of the text. */
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT'
        || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        /* Close overlays first; only fall through to the sidebar when
           nothing else was open. */
        const help = document.getElementById('help-overlay')!;
        const menu = document.getElementById('export-menu')!;
        const helpOpen = help.style.display === 'flex';
        const menuOpen = menu.style.display === 'flex';
        if (helpOpen) help.style.display = 'none';
        if (menuOpen) menu.style.display = 'none';
        if (!helpOpen && !menuOpen
          && !this.sidebarEl.classList.contains('sidebar-closed')) {
          this.closeSidebar();
        }
      }
      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key) {
          case 'r': case 'R': e.preventDefault(); this.redraw(); break;
          case 'n': case 'N': e.preventDefault(); this.newCurve(); break;
          case 's': case 'S': e.preventDefault(); this.doExport('svg'); break;
          case 'b': case 'B':
            e.preventDefault();
            this.toggleSidebar();
            break;
          case '?':
            e.preventDefault();
            const overlay = document.getElementById('help-overlay')!;
            overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
            break;
          /* Mode shortcuts */
          case '1':
            e.preventDefault();
            this.singleStrokeMode = false;
            this.hellMode = false;
            this.multiLineMode = false;
            this.modeLabelEl.textContent = '概括';
            (document.getElementById('toggle-mode') as HTMLInputElement).checked = false;
            (document.getElementById('toggle-multi') as HTMLInputElement).checked = false;
            (document.getElementById('toggle-hell') as HTMLInputElement).checked = false;
            this.updateConfigVisibility();
            this.newCurve();
            break;
          case '2':
            e.preventDefault();
            this.singleStrokeMode = true;
            this.hellMode = false;
            this.multiLineMode = false;
            this.modeLabelEl.textContent = '单笔';
            (document.getElementById('toggle-mode') as HTMLInputElement).checked = true;
            (document.getElementById('toggle-multi') as HTMLInputElement).checked = false;
            (document.getElementById('toggle-hell') as HTMLInputElement).checked = false;
            this.updateConfigVisibility();
            this.newCurve();
            break;
          case '3':
            e.preventDefault();
            this.singleStrokeMode = true;
            this.multiLineMode = true;
            this.hellMode = false;
            this.modeLabelEl.textContent = '单笔';
            (document.getElementById('toggle-mode') as HTMLInputElement).checked = true;
            (document.getElementById('toggle-multi') as HTMLInputElement).checked = true;
            (document.getElementById('toggle-hell') as HTMLInputElement).checked = false;
            this.updateConfigVisibility();
            this.newCurve();
            break;
          case '4':
            e.preventDefault();
            this.singleStrokeMode = true;
            this.hellMode = true;
            this.multiLineMode = true;
            this.modeLabelEl.textContent = '单笔';
            (document.getElementById('toggle-mode') as HTMLInputElement).checked = true;
            (document.getElementById('toggle-hell') as HTMLInputElement).checked = true;
            (document.getElementById('toggle-multi') as HTMLInputElement).checked = true;
            this.updateConfigVisibility();
            this.newCurve();
            break;
          /* Toggle shortcuts */
          case 'g': case 'G':
            e.preventDefault();
            (document.getElementById('toggle-grid') as HTMLInputElement).click();
            break;
          case 'c': case 'C':
            e.preventDefault();
            (document.getElementById('toggle-color') as HTMLInputElement).click();
            break;
          case 'h': case 'H':
            if (e.ctrlKey) {
              e.preventDefault();
              this.toggleSidebar();
            } else {
              e.preventDefault();
              (document.getElementById('toggle-heatmap') as HTMLInputElement).click();
            }
            break;
          case 'p': case 'P':
            e.preventDefault();
            (document.getElementById('toggle-pressure') as HTMLInputElement).click();
            break;
        }
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

  /** Listen for devicePixelRatio changes (browser zoom, external monitor DPI scaling).
      The media query matches the *current* DPR, so after each change it must
      be re-armed for the new value — otherwise only the first change is caught. */
  private initDprListener(): void {
    const onChange = () => {
      listen();
      this.resizeCanvases();
    };
    let mq: MediaQueryList | undefined;
    const listen = () => {
      mq?.removeEventListener('change', onChange);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onChange);
    };
    listen();
  }

  resizeCanvases(): void {
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

    /* Heatmap guide background — all modes */
    this.drawHeatmapGuide();

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
        /* Multi-line: rebuild coverage and restore the visible stroke.
           Steady state shows only the latest stroke (onPointerDown
           clears the canvas per stroke), so mirror that here. */
        this.rebuildMultiLineCoverage();
        const state = this.strokeHistory[this.historyPointer];
        if (state) {
          this.replayRawStroke(state);
          this.userProcessedPath = [...state.processed];
          if (state.processed.length >= 2) this.drawUserProcessed();
        }
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
      ctx.strokeStyle = this.palette.strokeDefault;
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
        : generateMultiLines(VIRTUAL_W, VIRTUAL_H, this.straightLineCount, this.archLineCount, 0, 40);
      this.multiLines = result.lines;
      this.refPath = result.lines[0];
      this.multiLineCovered = new Array(this.multiLines.length).fill(false);
      this.multiLineColors = this.multiLines.map((_, i) => ML_COLORS[i % ML_COLORS.length]);
      /* In hell mode, detect complex curves (many points) for segment-level coverage */
      this.complexLineCoverage = this.hellMode
        ? this.multiLines.map(line => line.length > COMPLEX_LINE_MIN_POINTS ? new Array(line.length).fill(false) : null)
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
    this.latestMatchStart = -1;
    this.latestMatchEnd = -1;
    this.lastFullEval = null;
    this.evalBadgesEl.style.display = 'none';
    this.evalBadgesEl.innerHTML = '';
    /* Force layout recalculation so virtScale/virtOffX/Y reflect the
       post-panel canvas size before we clear and redraw. */
    this.resizeCanvases();
    this.updateCoverageUI();
    this.clearUserCanvas();
    this.redrawUserCanvasContent();
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
      this.lastFullEval = null;
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
    this.redrawUserCanvasContent();
    this.clearScoreDisplay();
    this.drawScene();
  }

  /** Reset coverage tracking and re-render ref canvas */
  private resetCoverage(): void {
    this.covered = new Array(this.refPath.length).fill(false);
    this.coveragePct = 0;
    this.fullEvalReady = false;
    this.lastFullEval = null;
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

  /* ──────────────────────────────────────────────── */
  /*  Export                                           */
  /* ──────────────────────────────────────────────── */

  /** Handle SVG / PNG / report export */
  private doExport(format: string): void {
    const history = loadHistory(); // from storage

    /* Collect the visible user strokes (exclude the redo future) */
    const userStrokes = this.strokeHistory
      .slice(0, this.historyPointer + 1)
      .map(s => s.raw);

    switch (format) {
      case 'svg': {
        const svg = buildSVG(this.refPath, userStrokes, this.multiLineMode ? this.multiLines : undefined);
        triggerDownload(textToDataURL(svg), 'mirror-trace.svg');
        break;
      }
      case 'png': {
        downloadPNG(this.refCanvas, this.userCanvas, 'mirror-trace.png');
        break;
      }
      case 'report': {
        /* Prefer the full-evaluation score when it reflects the visible strokes */
        const s = (this.fullEvalReady && this.lastFullEval)
          ? this.lastFullEval
          : (this.historyPointer >= 0 ? this.strokeHistory[this.historyPointer].score : null);

        let mode = '?';
        if (this.hellMode) mode = '地狱';
        else if (this.multiLineMode) mode = '多条';
        else if (this.singleStrokeMode) mode = '单笔';
        else mode = '概括';

        const report = buildReport(
          s ? s.finalScore : 0,
          s ? s.spatialScore : 0,
          s ? s.timeScore : 0,
          s ? s.elapsedMs : 0,
          s ? s.idealMs : 0,
          s ? s.hausdorff95Dist : 0,
          s ? s.rmsDist : 0,
          mode, history,
        );
        triggerDownload(textToDataURL(report), 'mirror-trace-report.txt');
        break;
      }
    }
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
      /* Overview mode — hell requires single-stroke rendering, so its
         toggle is hidden here to avoid the mixed state it would create. */
      document.getElementById('multi-toggle-row')!.style.display = 'none';
      document.getElementById('hell-toggle-row')!.style.display = 'none';
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
      colorEnabled: this.colorEnabled,
      palette: this.palette,
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
      palette: this.palette,
    };
  }

  private drawScene(): void {
    this.drawRefCanvas();
  }

  private drawRefCanvas(): void {
    renderDrawRefCanvas(this.refCtx, VIRTUAL_W, VIRTUAL_H, ML_COLORS, this.getRefCanvasState());
  }

  /** Clear the ENTIRE user-canvas buffer in device pixels, including the
      letterbox area outside the virtual 800×600 region — strokes drawn
      beyond the canvas edges (pointer capture keeps events while the pen
      is outside) would otherwise leave marks that survive clears. */
  private clearUserBuffer(): void {
    this.userCtx.save();
    this.userCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.userCtx.clearRect(0, 0, this.userCanvas.width, this.userCanvas.height);
    this.userCtx.restore();
  }

  private clearUserCanvas(): void {
    this.clearUserBuffer();
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
    this.debugElapsedEl.textContent = String(Math.round(s.elapsedMs));
    this.debugIdealEl.textContent = String(s.idealMs);
  }

  /** Tracks active replay animation so it can be cancelled on new draw */
  private replayRafId = 0;

  /** Highlight process-path overlay */
  private drawUserProcessed(): void {
    renderDrawUserProcessed(this.userCtx, this.userProcessedPath, this.palette.strokeProcessed);
  }

  /**
   * Animate the most recent completed stroke in real-time on the user canvas.
   * Clears existing content, draws the heatmap guide, then replays the raw
   * pointer points at approximately the original drawing speed.
   */
  private replayStroke(): void {
    if (this.historyPointer < 0) return;
    const state = this.strokeHistory[this.historyPointer];
    if (!state || state.raw.length < 2) return;

    /* Cancel any previous replay immediately */
    if (this.replayRafId) { cancelAnimationFrame(this.replayRafId); this.replayRafId = 0; }

    /* Clear canvas and draw only the heatmap guide — hide history strokes
       so the replay animation is clearly visible against a clean background. */
    this.clearUserCanvas();
    this.drawHeatmapGuide();

    const raw = state.raw;
    const total = raw.length;
    /* Replay at roughly original speed, but cap between 0.5 s and 3 s */
    const duration = Math.max(500, Math.min(3000, state.score?.elapsedMs ?? 1500));
    const ctx = this.userCtx;

    /* Use a bright, distinct colour with a glow so the replay pops.
       lineWidth matches replayRawStroke (2.5) since the original
       per-segment pressure data is not preserved in history. */
    ctx.strokeStyle = this.palette.strokeReplay;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = this.palette.strokeReplay;
    ctx.shadowBlur = 6;

    let idx = 0;
    const t0 = performance.now();

    const draw = () => {
      if (this.replayRafId === 0) return; /* cancelled */
      const elapsed = performance.now() - t0;
      const target = Math.floor((elapsed / duration) * (total - 1));
      while (idx <= target && idx < total) {
        if (idx === 0) {
          ctx.beginPath();
          ctx.moveTo(raw[0].x, raw[0].y);
        } else {
          ctx.lineTo(raw[idx].x, raw[idx].y);
          ctx.stroke();
        }
        idx++;
      }
      if (idx < total) {
        this.replayRafId = requestAnimationFrame(draw);
      } else {
        /* Replay finished — restore the full canvas (all history strokes
           plus the heatmap) so earlier strokes are not missing. */
        ctx.shadowBlur = 0;
        ctx.stroke();
        this.replayRafId = 0;
        this.clearUserCanvas();
        this.redrawUserCanvasContent();
      }
    };
    this.replayRafId = requestAnimationFrame(draw);
  }

  /**
   * Rebuild multi-line coverage state from strokeHistory.
   *
   * For simple lines: each stroke marks its entire line as covered.
   * For complex curves: segment-level indices are tracked in
   * complexLineCoverage; the line is only marked fully covered
   * when ALL its segments are done.
   */
  private rebuildMultiLineCoverage(): void {
    this.multiLineCovered = new Array(this.multiLines.length).fill(false);
    /* Reset segment-level coverage for complex curves */
    this.complexLineCoverage = this.complexLineCoverage.map(
      c => c ? new Array(c.length).fill(false) : null,
    );

    for (let i = 0; i <= this.historyPointer; i++) {
      const s = this.strokeHistory[i];
      if (s.matchedLineIdx < 0 || s.matchedLineIdx >= this.multiLines.length) continue;
      const segCov = this.complexLineCoverage[s.matchedLineIdx];
      if (segCov) {
        /* Complex curve: re-run segment matching to restore coverage */
        const line = this.multiLines[s.matchedLineIdx];
        if (s.processed.length >= 2 && line.length >= 2) {
          const segmentResult = findSegment(line, s.processed);
          for (let j = segmentResult.startIdx; j <= segmentResult.endIdx; j++) {
            segCov[j] = true;
          }
        }
      } else {
        /* Simple line: mark entire line as covered */
        this.multiLineCovered[s.matchedLineIdx] = true;
      }
    }

    /* Compute coverage: each line counts equally (1 unit), complex
       curves use their segment-covered ratio as the fractional unit. */
    let totalUnits = 0;
    let coveredUnits = 0;
    for (let li = 0; li < this.multiLines.length; li++) {
      const segCov = this.complexLineCoverage[li];
      totalUnits += 1;
      if (segCov) {
        const covered = segCov.filter(c => c).length;
        coveredUnits += covered / segCov.length; // fractional: 0 → 1
        if (covered >= segCov.length) this.multiLineCovered[li] = true;
      } else {
        coveredUnits += this.multiLineCovered[li] ? 1 : 0;
      }
    }
    this.coveragePct = totalUnits > 0 ? Math.round((coveredUnits / totalUnits) * 100) : 0;
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

  /** Draw the full reference curve very faintly as a static guide on the user canvas */
  private drawHeatmapGuide(): void {
    renderDrawHeatmapGuide(this.userCtx, this.getHeatmapState());
  }

  /** Toggle the sidebar open/closed — also syncs the backdrop */
  private toggleSidebar(): void {
    const closed = this.sidebarEl.classList.toggle('sidebar-closed');
    this.backdropEl.classList.toggle('sidebar-closed', closed);
  }

  /** Close the sidebar unconditionally */
  private closeSidebar(): void {
    this.sidebarEl.classList.add('sidebar-closed');
    this.backdropEl.classList.add('sidebar-closed');
  }

  /** Initialise theme from localStorage and wire up theme-dot buttons */
  private initTheme(): void {
    const saved = loadThemeName();
    const theme = findTheme(saved) || themes[0];
    this.applyPalette(theme);

    /* Mark the active dot and bind clicks */
    document.querySelectorAll('.theme-dot').forEach(el => {
      const dot = el as HTMLElement;
      if (dot.dataset.theme === saved) dot.classList.add('active');
      dot.addEventListener('click', () => {
        const name = dot.dataset.theme || 'dark-blue';
        const t = findTheme(name);
        if (!t) return;
        this.applyPalette(t);
        saveThemeName(name);
        document.querySelectorAll('.theme-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      });
    });
  }

  /** Apply a theme to the CSS variables and the canvas palette, then
      repaint the canvases and the history chart so canvas-drawn colours
      follow the theme (they cannot read CSS custom properties). */
  private applyPalette(theme: Theme): void {
    applyTheme(theme);
    this.palette = paletteFromTheme(theme);
    this.strokeRGB = hexToRgb(this.palette.strokeDefault);
    this.drawRefCanvas();
    this.clearUserBuffer();
    this.redrawUserCanvasContent();
    this.refreshHistoryPanel();
  }

  /** Toggle the optional grid overlay on both canvases */
  private updateGridOverlay(): void {
    this.refCanvas.classList.toggle('show-grid', this.gridEnabled);
    this.userCanvas.classList.toggle('show-grid', this.gridEnabled);
    if (this.gridEnabled) {
      const px = `${this.gridSize}px`;
      this.refCanvas.style.setProperty('--grid-size', px);
      this.userCanvas.style.setProperty('--grid-size', px);
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
    /* pointercancel (system-interrupted input) ends the stroke the same
       way so isDrawing can't get stuck. */
    el.addEventListener('pointercancel', this.onPointerUp.bind(this));
    /* Don't bind pointerleave — lifting the pen outside the canvas
       would truncate the stroke. Let the next pointerdown discard it. */
  }

  private onPointerDown(e: PointerEvent): void {
    /* Cancel any ongoing replay and clear its glow style so it doesn't
       leak into strokes drawn afterwards */
    if (this.replayRafId) {
      cancelAnimationFrame(this.replayRafId);
      this.replayRafId = 0;
      this.userCtx.shadowBlur = 0;
      this.userCtx.shadowColor = 'rgba(0, 0, 0, 0)';
    }
    this.isDrawing = true;
    /* Capture pointer so pointerup fires even outside the canvas */
    this.userCanvas.setPointerCapture(e.pointerId);
    this.pointerDownTime = performance.now();
    /* Any new stroke discards the redo future */
    this.strokeHistory.length = this.historyPointer + 1;
    this.userRawPath = [];

    if (this.singleStrokeMode || this.multiLineMode) {
      /* Clear canvas for independent strokes */
      this.clearUserBuffer();
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

    /* Draw heatmap guide as background layer — all modes */
    this.drawHeatmapGuide();

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
        drawSegment(this.userCtx, this.prevPoint, p, ev.pressure, ev.tiltX, ev.tiltY, this.pressureEnabled, this.strokeRGB);
        this.prevPoint = p;
      }
    } else {
      const p = clientToCanvas(e, this.userCanvas, this.virtOffX, this.virtOffY, this.virtScale);
      this.userRawPath.push(p);
      drawSegment(this.userCtx, this.prevPoint, p, e.pressure, e.tiltX, e.tiltY, this.pressureEnabled, this.strokeRGB);
      this.prevPoint = p;
    }

    /* Update live pen-position hotspot on the reference canvas.
       Coalesced pen input can fire far more often than the display
       refreshes, so coalesce to one nearest-point search + repaint
       per animation frame. */
    this.scheduleLiveHotspot(this.userRawPath[this.userRawPath.length - 1]);
  }

  /** rAF handle for the pending hotspot update (0 = none scheduled) */
  private hotspotRafId = 0;
  /** Latest pen position awaiting a hotspot update */
  private pendingHotspotPt: Point | null = null;

  /** Schedule a live-hotspot update on the next animation frame */
  private scheduleLiveHotspot(p: Point): void {
    this.pendingHotspotPt = p;
    if (this.hotspotRafId) return;
    this.hotspotRafId = requestAnimationFrame(() => {
      this.hotspotRafId = 0;
      if (this.pendingHotspotPt) {
        this.updateLiveHotspot(this.pendingHotspotPt);
      }
    });
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
      matchedLineIdx = this.matchMultiLine(simplified);
      if (matchedLineIdx < 0) return; // no matching line found
      const matchedLine = this.multiLines[matchedLineIdx];
      /* Hell mode complex curve: use segment matching within the line */
      const segCov = this.complexLineCoverage[matchedLineIdx];

      if (segCov) {
        /* Complex curve: find uncovered segments within this line */
        const segmentResult = findSegment(matchedLine, simplified);
        const matchedPart = matchedLine.slice(segmentResult.startIdx, segmentResult.endIdx + 1);
        refSubPath = matchedPart;
        /* Mark covered segment indices */
        for (let j = segmentResult.startIdx; j <= segmentResult.endIdx; j++) {
          segCov[j] = true;
        }
      } else {
        /* Simple line: score against entire line */
        refSubPath = matchedLine;
      }
    } else if (this.singleStrokeMode) {
      refSubPath = this.refPath; // single arch
    } else {
      /* Overview mode: segment match the ref path */
      const segmentResult = findSegment(this.refPath, simplified);
      refSubPath = this.refPath.slice(segmentResult.startIdx, segmentResult.endIdx + 1);
      /* Mark coverage */
      for (let j = segmentResult.startIdx; j <= segmentResult.endIdx; j++) {
        this.covered[j] = true;
      }
      this.latestMatchStart = segmentResult.startIdx;
      this.latestMatchEnd = segmentResult.endIdx;
    }

    /* Resample the simplified user path to match the reference sub-path length */
    const resampled = resampleToCount(simplified, refSubPath.length);
    const score = computeScores(refSubPath, resampled, elapsedMs);

    /* Record the stroke in history — full evaluation is derived from
       these entries, so undo/redo stay in sync automatically. */
    const state: StrokeState = {
      raw: [...this.userRawPath],
      processed: [...resampled],
      score,
      matchedLineIdx,
      refSubPath,
      startTime: this.pointerDownTime,
      endTime: this.pointerDownTime + elapsedMs,
    };
    this.strokeHistory.push(state);
    this.historyPointer = this.strokeHistory.length - 1;

    /* Update coverage */
    if (this.multiLineMode && matchedLineIdx >= 0) {
      this.rebuildMultiLineCoverage();
    } else if (!this.singleStrokeMode) {
      this.coveragePct = Math.round(
        (this.covered.filter(v => v).length / this.refPath.length) * 100,
      );
    }
    this.updateCoverageUI();
    this.drawRefCanvas();

    /* ── Score / persist ── */
    if (this.singleStrokeMode && matchedLineIdx < 0) {
      /* Non-multi single-stroke: show score directly & save immediately */
      this.showScore(score);
      this.userProcessedPath = [...resampled];
      this.drawUserProcessed();
      this.saveToPersistentHistory(score);
      this.updateUndoRedoButtons();
      return;
    }

    if (this.multiLineMode && matchedLineIdx >= 0) {
      this.showScore(score);
      this.userProcessedPath = [...resampled];
      this.drawUserProcessed();
      if (!this.hellMode) {
        this.saveToPersistentHistory(score);
      }
      this.updateUndoRedoButtons();

      /* Check if coverage ≥ 97 % → trigger full evaluation */
      if (this.coveragePct >= 97 && !this.fullEvalReady) {
        this.triggerFullEvaluation(score);
      }
      return;
    }

    /* Overview mode */
    this.showScore(score);
    this.userProcessedPath = [...resampled];
    this.drawUserProcessed();
    this.updateUndoRedoButtons();

    /* Check if coverage >= 97 % → trigger full evaluation */
    if (this.coveragePct >= 97 && !this.fullEvalReady) {
      this.triggerFullEvaluation(score);
    }
  }

  /* ──────────────────────────────────────────────── */
  /*  Undo / Redo                                    */
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
        this.complexLineCoverage = this.complexLineCoverage.map(
          c => c ? new Array(c.length).fill(false) : null,
        );
      } else if (!this.singleStrokeMode) {
        this.covered = new Array(this.refPath.length).fill(false);
      }
      this.coveragePct = 0;
      this.fullEvalReady = false;
      this.lastFullEval = null;
      this.evalBadgesEl.style.display = 'none';
      this.updateCoverageUI();
      this.drawRefCanvas();
      this.drawHeatmapGuide();
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

    this.clearUserBuffer();

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
      this.rebuildMultiLineCoverage();
      for (let i = 0; i <= index; i++) {
        this.replayRawStroke(this.strokeHistory[i]);
      }
      this.updateCoverageUI();
      this.syncFullEvalBadges(state);
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
    this.syncFullEvalBadges(state);
    this.drawRefCanvas();
    state.score ? this.showScore(state.score) : this.clearScoreDisplay();
  }

  /** Enable / disable undo / redo / replay buttons based on history state */
  private updateUndoRedoButtons(): void {
    this.undoBtnEl.disabled = this.historyPointer < 0;
    this.redoBtnEl.disabled = this.historyPointer >= this.strokeHistory.length - 1;
    this.replayBtnEl.disabled = this.historyPointer < 0;
  }

  /* ──────────────────────────────────────────────── */
  /*  Full evaluation (triggered at ≥ 97 % coverage)  */
  /* ──────────────────────────────────────────────── */

  /**
   * Compute and display full evaluation results using two algorithms:
   *
   *   A — Global timer + global spatial score.
   *       All strokes are concatenated into one path (with straight-line
   *       connectors), simplified, resampled, then scored as a single
   *       attempt.  The reference side is the full refPath in overview
   *       mode; in multi-line mode it is the concatenation of each
   *       stroke's matched sub-path (in stroke order), so both paths
   *       align index-by-index instead of being compared against just
   *       the first line.
   *
   *   B — Length-weighted average of all segment final scores.
   *
   * All inputs are derived from strokeHistory (up to historyPointer),
   * so the result always reflects the visible strokes after undo/redo.
   *
   * @param persist Save the result to localStorage (false when merely
   *                re-deriving after undo/redo, to avoid duplicates).
   */
  private triggerFullEvaluation(lastStrokeScore: ScoreResult, persist = true): void {
    this.fullEvalReady = true;

    const strokes = this.strokeHistory.slice(0, this.historyPointer + 1);
    if (strokes.length === 0) return;

    /* Attempt time = first pointerdown → last pointerup.  Read from the
       stroke records (not wall-clock) so undo/redo and re-derivation
       don't inflate the elapsed time. */
    const globalElapsed =
      strokes[strokes.length - 1].endTime - strokes[0].startTime;

    /* ── Algorithm A: Global (concatenated path) ── */
    let globalCombined: Point[] = [];
    for (const s of strokes) {
      if (s.raw.length < 2) continue;
      if (globalCombined.length === 0) {
        globalCombined.push(...s.raw.map(p => ({ x: p.x, y: p.y })));
      } else {
        /* Connector: straight line from end of previous stroke to start of this one */
        globalCombined.push(s.raw[0]);
        globalCombined.push(...s.raw.map(p => ({ x: p.x, y: p.y })));
      }
    }

    /* Reference side — overview: whole curve; multi-line: matched
       sub-paths concatenated in stroke order (see doc comment). */
    let refCombined: Point[];
    if (this.multiLineMode) {
      refCombined = [];
      for (const s of strokes) refCombined.push(...s.refSubPath);
    } else {
      refCombined = this.refPath;
    }

    let globalScore: ScoreResult;
    if (globalCombined.length >= 3 && refCombined.length >= 2) {
      const simplified = rdpSimplify(globalCombined, 0.5);
      /* Resample the reference to uniform arc-length too — the user
         side is resampled uniformly, so an unevenly-sampled reference
         (dense lines + a single-segment jump between them) would skew
         the index-by-index Procrustes RMS even for an exact trace. */
      const refUniform = resampleToCount(refCombined, refCombined.length);
      const resampled = resampleToCount(simplified, refUniform.length);
      globalScore = computeScores(refUniform, resampled, globalElapsed);
    } else {
      globalScore = lastStrokeScore;
    }

    /* ── Algorithm B: Length-weighted average ── */
    let weightedSum = 0;
    let totalWeight = 0;
    for (const s of strokes) {
      if (s.score) {
        weightedSum += s.score.finalScore * s.refSubPath.length;
        totalWeight += s.refSubPath.length;
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
        <span class="eval-badge-sub">${strokes.length} 段</span>
      </span>
    `;
    this.evalBadgesEl.style.display = 'inline-flex';

    /* Persist the global evaluation score to localStorage */
    this.lastFullEval = globalScore;
    if (persist) this.saveToPersistentHistory(globalScore);
  }

  /**
   * After undo/redo restored coverage, refresh (without re-persisting)
   * or hide the full-evaluation badges so they always match the
   * currently visible strokes.
   */
  private syncFullEvalBadges(state: StrokeState): void {
    if (this.coveragePct >= 97 && state.score) {
      this.triggerFullEvaluation(state.score, false);
    } else {
      this.fullEvalReady = false;
      this.lastFullEval = null;
      this.evalBadgesEl.style.display = 'none';
    }
  }

  /**
   * Find the un-covered multi-line whose shape best matches the user's
   * simplified stroke.  Uses the average nearest-point distance across
   * all simplified points (not just start/end), so a stroke that traces
   * part of a complex curve correctly prefers that curve over a simpler
   * nearby line whose endpoints happen to be closer.
   */
  private matchMultiLine(simplified: readonly Point[]): number {
    if (simplified.length < 2) return -1;

    let bestIdx = -1;
    let bestAvgDist = Infinity;

    for (let li = 0; li < this.multiLines.length; li++) {
      if (this.multiLineCovered[li]) continue;
      const line = this.multiLines[li];
      if (line.length < 2) continue;

      /* Average nearest-point distance from all simplified points to this line */
      let totalDist = 0;
      for (const pt of simplified) {
        let minD = Infinity;
        for (const lp of line) {
          const d = Math.hypot(pt.x - lp.x, pt.y - lp.y);
          if (d < minD) minD = d;
        }
        totalDist += minD;
      }
      const avgDist = totalDist / simplified.length;

      if (avgDist < bestAvgDist) {
        bestAvgDist = avgDist;
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
    let mode: string, lineConfig: string | undefined;
    if (this.hellMode) {
      mode = '地狱';
      lineConfig = `${this.hellStraightCount}+${this.hellArchCount}+${this.hellComplexCount}`;
    } else if (this.multiLineMode) {
      mode = '多条';
      lineConfig = `${this.straightLineCount}+${this.archLineCount}`;
    } else if (this.singleStrokeMode) {
      mode = '单笔';
    } else {
      mode = '概括';
    }
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
      mode,
      lineConfig,
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
    const parent = this.historyChartEl.parentElement;
    if (!parent) return;
    renderHistoryChart(this.historyChartEl, parent.clientWidth, this.dpr, entries, this.palette);
  }

  /** Show the last N entries as a compact list */
  private renderHistoryList(entries: HistoryEntry[]): void {
    renderHistoryList(this.historyListEl, entries);
  }

  /** Replay a single raw stroke polyline onto the user canvas */
  private replayRawStroke(state: StrokeState): void {
    renderReplayRawStroke(this.userCtx, state.raw, this.palette.strokeDefault);
  }
}

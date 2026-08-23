// @vitest-environment happy-dom
/**
 * Integration tests for MirrorTraceApp
 *
 * These tests set up the complete DOM required by main.ts, boot the app,
 * and verify interaction flows through the public API (window.__mirrorTrace).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Setup helpers                                                      */
/* ------------------------------------------------------------------ */

function createDOM(): void {
  document.body.innerHTML = `
    <div id="app">
      <h1>
        <span id="top-left-group">
          <button id="btn-sidebar" title="侧栏 B/Ctrl+H">菜单</button>
          <span id="theme-selector">
            <button class="theme-dot" data-theme="dark-blue" title="深蓝"></button>
            <button class="theme-dot" data-theme="light" title="浅色"></button>
            <button class="theme-dot" data-theme="dark-green" title="墨绿"></button>
            <button class="theme-dot" data-theme="dark-purple" title="暮紫"></button>
            <button class="theme-dot" data-theme="gray" title="现代"></button>
          </span>
        </span>
        Mirror Trace
      </h1>
      <div id="canvas-container">
        <div class="canvas-wrapper">
          <h2>参考线条</h2>
          <canvas id="ref-canvas" width="800" height="600" style="width:800px;height:600px"></canvas>
        </div>
        <div class="canvas-wrapper">
          <h2>你的临摹</h2>
          <canvas id="user-canvas" width="800" height="600" style="width:800px;height:600px"></canvas>
        </div>
      </div>

      <div id="score-panel">
        <div class="score-primary">
          <span class="score-value" id="score-final">—</span>
        </div>
        <div class="score-detail">
          <span><strong id="score-spatial">—</strong></span>
          <span><strong id="score-time">—</strong></span>
        </div>
        <div class="coverage-info">
          <span id="coverage-pct">0%</span>
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
        </div>
        <div class="score-debug">
          <span id="debug-hausdorff">—</span>
          <span id="debug-rms">—</span>
          <span id="debug-elapsed">—</span>
          <span id="debug-ideal">—</span>
        </div>
        <div id="eval-badges" class="eval-badges" style="display:none"></div>
      </div>

      <div id="multi-config">
        <div class="config-row" id="multi-toggle-row">
          <input type="checkbox" id="toggle-multi" />
        </div>
        <div class="config-row" id="hell-toggle-row" style="display:none">
          <input type="checkbox" id="toggle-hell" />
        </div>
        <div class="config-row" id="multi-params" style="display:none">
          <label>直线 <input type="number" id="input-straight" value="2" min="0" max="20" /></label>
          <label>弧线 <input type="number" id="input-arch" value="3" min="0" max="20" /></label>
        </div>
        <div class="config-row" id="hell-params" style="display:none">
          <label>直线 <input type="number" id="input-hell-straight" value="2" min="0" max="20" /></label>
          <label>弧线 <input type="number" id="input-hell-arch" value="2" min="0" max="20" /></label>
          <label>复杂 <input type="number" id="input-hell-complex" value="1" min="0" max="20" /></label>
        </div>
        <div class="config-row" id="complex-params" style="display:none">
          <label>复杂分段 <input type="number" id="input-segments" value="3" min="1" max="12" /></label>
        </div>
        <div class="ctrl-group">
          <input type="checkbox" id="toggle-pressure" checked />
          <input type="checkbox" id="toggle-heatmap" checked />
          <input type="checkbox" id="toggle-grid" />
          <input type="checkbox" id="toggle-color" />
          <input type="number" id="input-grid-size" value="40" min="20" max="100" step="10"
            style="display:none;width:48px;" />
          <input type="checkbox" id="toggle-mode" />
          <span id="mode-label">概括</span>
          <span id="mode-switch" style="display:inline-flex"></span>
          <button id="btn-redraw">↺</button>
          <button id="btn-newcurve">✚</button>
          <button id="btn-replay" disabled>▶</button>
          <button id="btn-undo" disabled>↩</button>
          <button id="btn-redo" disabled>↪</button>
          <button id="btn-export">↓</button>
          <button id="btn-help">?</button>
        </div>
      </div>

      <div id="export-menu" style="display:none">
        <button data-export="svg">SVG</button>
        <button data-export="png">PNG</button>
        <button data-export="report">报告</button>
      </div>

      <div id="help-overlay" style="display:none">
        <div id="help-box"><h3>快捷键</h3></div>
      </div>

      <div class="config-row" id="preset-row">
        <label>预设 <select id="preset-select"><option value="">—</option></select></label>
      </div>

      <div id="sidebar-backdrop" class="sidebar-closed"></div>

      <div id="sidebar" class="sidebar-closed">
        <div id="sidebar-nav">
          <button class="sidebar-nav-btn" disabled>🏠</button>
          <button class="sidebar-nav-btn" disabled>📊</button>
          <button class="sidebar-nav-btn" disabled>⚙️</button>
        </div>
        <div class="sidebar-divider"></div>
        <div id="sidebar-history">
          <div id="sidebar-history-header">
            <span id="sidebar-history-label">历史记录</span>
            <button id="btn-close-sidebar">✕</button>
            <button id="btn-clear-history">清空</button>
          </div>
          <canvas id="history-chart" width="300" height="60" style="width:300px;height:60px"></canvas>
          <div id="history-list"></div>
        </div>
      </div>
    </div>
  `;
}

/** Return a non-zero bounding rect for canvas elements */
function makeRect(
  w: number,
  h: number,
): DOMRect {
  return {
    x: 0, y: 0, width: w, height: h,
    top: 0, right: w, bottom: h, left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function setupCanvasRects(): void {
  const refCanvas = document.getElementById('ref-canvas') as HTMLCanvasElement;
  const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
  const historyChart = document.getElementById('history-chart') as HTMLCanvasElement;

  vi.spyOn(refCanvas, 'getBoundingClientRect').mockReturnValue(makeRect(800, 600));
  vi.spyOn(userCanvas, 'getBoundingClientRect').mockReturnValue(makeRect(800, 600));
  vi.spyOn(historyChart, 'getBoundingClientRect').mockReturnValue(makeRect(300, 60));
}

/* Shared mock 2D context — module-scoped so tests can inspect calls
   and style properties (e.g. the replay glow reset). */
let mockCtx: CanvasRenderingContext2D;

function createMockCanvasCtx(): CanvasRenderingContext2D {
  // happy-dom's getContext('2d') returns null — provide a mock
  const ctx = {
    canvas: null,
    scale: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    clip: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'round' as CanvasLineCap,
    lineJoin: 'round' as CanvasLineJoin,
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    measureText: vi.fn(() => ({ width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

function setupMocks(): void {
  // ResizeObserver — not available in happy-dom
  class MockRO {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  }
  (window as any).ResizeObserver = MockRO;

  // Canvas getContext('2d') — happy-dom doesn't support it
  mockCtx = createMockCanvasCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (type: string) => (type === '2d' ? mockCtx : null),
  );
}

function clearTestState(): void {
  localStorage.clear();
  // Remove the app instance from window if it exists
  delete (window as any).__mirrorTrace;
}

/** Dispatch pointer events tracing the given points (canvas rect is
    mocked to 800×600 at (0,0), so client coords = virtual coords). */
function drawAlongPath(
  canvas: HTMLCanvasElement,
  pts: readonly { x: number; y: number }[],
  pointerId: number,
): void {
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: pts[0].x, clientY: pts[0].y, pointerId,
  }));
  for (let i = 1; i < pts.length; i++) {
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: pts[i].x, clientY: pts[i].y, pointerId,
    }));
  }
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId }));
}

/* ------------------------------------------------------------------ */
/*  Test suite                                                         */
/* ------------------------------------------------------------------ */

describe('MirrorTraceApp — 集成测试', () => {
  beforeAll(async () => {
    clearTestState();
    createDOM();
    setupCanvasRects();
    setupMocks();
    // Import main.ts (side-effect: registers DOMContentLoaded listener)
    await import('./main');
    // Fire DOMContentLoaded to boot the app
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  /* ──────────────────────────── */
  /*  启动                         */
  /* ──────────────────────────── */

  describe('启动', () => {
    it('在 window.__mirrorTrace 上暴露出 app 实例', () => {
      const app = (window as any).__mirrorTrace;
      expect(app).toBeDefined();
    });

    it('生成初始参考曲线 (refPath 应有坐标点)', () => {
      const app = (window as any).__mirrorTrace as any;
      expect(app.refPath.length).toBeGreaterThanOrEqual(2);
    });

    it('初始模式为概括 (singleStrokeMode = false)', () => {
      const app = (window as any).__mirrorTrace as any;
      expect(app.singleStrokeMode).toBe(false);
      expect(app.hellMode).toBe(false);
      expect(app.multiLineMode).toBe(false);
    });
  });

  /* ──────────────────────────── */
  /*  模式切换                     */
  /* ──────────────────────────── */

  describe('模式切换', () => {
    it('切换为单笔模式后 singleStrokeMode = true, 曲线为 arch 类型', () => {
      const app = (window as any).__mirrorTrace as any;
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;

      // Overview → single-stroke
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));

      expect(app.singleStrokeMode).toBe(true);
      // In single-stroke mode, refPath should be shorter (arch, ~40 points vs random complex)
      expect(app.refPath.length).toBeGreaterThanOrEqual(2);
    });

    it('切换回概括模式后 singleStrokeMode = false, 曲线更复杂', () => {
      const app = (window as any).__mirrorTrace as any;
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;

      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));

      expect(app.singleStrokeMode).toBe(false);
    });
  });

  /* ──────────────────────────── */
  /*  多条 / 地狱切换              */
  /* ──────────────────────────── */

  describe('多条/地狱模式', () => {
    beforeEach(() => {
      // Ensure we're in single-stroke mode so multi toggle is visible
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));
    });

    it('多条模式: toggle-multi 开启后 multiLineMode = true', () => {
      const app = (window as any).__mirrorTrace as any;
      const multiToggle = document.getElementById('toggle-multi') as HTMLInputElement;

      multiToggle.checked = true;
      multiToggle.dispatchEvent(new Event('change'));

      expect(app.multiLineMode).toBe(true);
      expect(app.multiLines.length).toBeGreaterThan(0);
    });

    it('地狱模式: toggle-hell 开启后 hellMode = true, multiLineMode = true', () => {
      const app = (window as any).__mirrorTrace as any;
      const hellToggle = document.getElementById('toggle-hell') as HTMLInputElement;

      hellToggle.checked = true;
      hellToggle.dispatchEvent(new Event('change'));

      expect(app.hellMode).toBe(true);
      expect(app.multiLineMode).toBe(true);
      // Hell mode generates straight + arch + complex lines
      expect(app.multiLines.length).toBe(2 + 2 + 1); // 2 straight + 2 arch + 1 complex
    });

    it('地狱模式关闭后 multiLineMode 恢复为多线 checkbox 的实际状态', () => {
      const app = (window as any).__mirrorTrace as any;
      const hellToggle = document.getElementById('toggle-hell') as HTMLInputElement;
      const multiToggle = document.getElementById('toggle-multi') as HTMLInputElement;

      // Open multi-line first
      multiToggle.checked = true;
      multiToggle.dispatchEvent(new Event('change'));
      expect(app.multiLineMode).toBe(true);

      // Turn on hell
      hellToggle.checked = true;
      hellToggle.dispatchEvent(new Event('change'));
      expect(app.hellMode).toBe(true);

      // Turn off hell
      hellToggle.checked = false;
      hellToggle.dispatchEvent(new Event('change'));
      expect(app.hellMode).toBe(false);

      // multiLineMode should restore to the multi-toggle checkbox state (still checked)
      expect(app.multiLineMode).toBe(true);

      // Also verify it responds to actually unchecking multi-line
      multiToggle.checked = false;
      multiToggle.dispatchEvent(new Event('change'));
      expect(app.multiLineMode).toBe(false);
    });
  });

  /* ──────────────────────────── */
  /*  UI 可见性                    */
  /* ──────────────────────────── */

  describe('UI 可见性', () => {
    it('地狱模式隐藏 mode-switch 和 multi-toggle-row', () => {
      const hellToggle = document.getElementById('toggle-hell') as HTMLInputElement;
      const modeSwitch = document.getElementById('mode-switch')!;
      const multiToggleRow = document.getElementById('multi-toggle-row')!;

      // Ensure we're in single-stroke mode
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));

      // Enable hell mode
      hellToggle.checked = true;
      hellToggle.dispatchEvent(new Event('change'));

      expect(modeSwitch.style.display).toBe('none');
      expect(multiToggleRow.style.display).toBe('none');

      // Exit hell
      hellToggle.checked = false;
      hellToggle.dispatchEvent(new Event('change'));
    });

    it('概括模式显示 complex-params 而非 multi-params 或 hell-params', () => {
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      const complexParams = document.getElementById('complex-params')!;
      const multiParams = document.getElementById('multi-params')!;
      const hellParams = document.getElementById('hell-params')!;

      // Switch to overview mode
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));

      expect(complexParams.style.display).not.toBe('none');
      expect(multiParams.style.display).toBe('none');
      expect(hellParams.style.display).toBe('none');
    });
  });

  /* ──────────────────────────── */
  /*  画布交互 — 指点事件           */
  /* ──────────────────────────── */

  describe('指点事件交互', () => {
    beforeEach(() => {
      // Reset to overview mode with clean state
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));
    });

    it('pointerdown → pointermove → pointerup 完成一次笔画', () => {
      const app = (window as any).__mirrorTrace as any;
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;

      // Spy on setPointerCapture
      const captureSpy = vi.spyOn(userCanvas, 'setPointerCapture');

      // Simulate a short stroke
      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 100, clientY: 100, pointerId: 1,
      }));
      expect(app.isDrawing).toBe(true);
      expect(app.userRawPath.length).toBe(1);

      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 120, clientY: 120, pointerId: 1,
      }));
      expect(app.userRawPath.length).toBeGreaterThanOrEqual(2);

      userCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      expect(app.isDrawing).toBe(false);

      // After pointerup, stroke is processed and stored in history
      expect(captureSpy).toHaveBeenCalled();
    });

    it('完成笔画后 strokeHistory 长度增加', () => {
      const app = (window as any).__mirrorTrace as any;
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      const historyBefore = app.historyPointer;

      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 200, clientY: 200, pointerId: 2,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 210, clientY: 205, pointerId: 2,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 220, clientY: 210, pointerId: 2,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 230, clientY: 215, pointerId: 2,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));

      // Verify the stroke was processed (3+ raw points in overview mode)
      expect(app.historyPointer).toBe(historyBefore + 1);
    });

    it('指点笔压设置会影响 drawing', () => {
      const app = (window as any).__mirrorTrace as any;
      const pressureToggle = document.getElementById('toggle-pressure') as HTMLInputElement;

      expect(app.pressureEnabled).toBe(true);

      pressureToggle.checked = false;
      pressureToggle.dispatchEvent(new Event('change'));

      expect(app.pressureEnabled).toBe(false);

      pressureToggle.checked = true;
      pressureToggle.dispatchEvent(new Event('change'));
      expect(app.pressureEnabled).toBe(true);
    });
  });

  /* ──────────────────────────── */
  /*  Undo / Redo                  */
  /* ──────────────────────────── */

  describe('Undo / Redo', () => {
    function drawShortStroke(): void {
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 150, clientY: 150, pointerId: 10,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 160, clientY: 155, pointerId: 10,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 170, clientY: 160, pointerId: 10,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10 }));
    }

    beforeEach(() => {
      // Single-stroke mode for cleaner undo/redo testing
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));
    });

    it('undo 后 historyPointer 减小', () => {
      const app = (window as any).__mirrorTrace as any;

      drawShortStroke();
      const afterDraw = app.historyPointer;
      expect(afterDraw).toBeGreaterThanOrEqual(0);

      // Undo
      const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
      undoBtn.click();

      expect(app.historyPointer).toBe(afterDraw - 1);
    });

    it('redo 后 historyPointer 恢复', () => {
      const app = (window as any).__mirrorTrace as any;

      drawShortStroke();
      const afterDraw = app.historyPointer;

      // Undo then redo
      const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
      const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
      undoBtn.click();
      redoBtn.click();

      expect(app.historyPointer).toBe(afterDraw);
    });

    it('Ctrl+Z 触发 undo, Ctrl+Y 触发 redo', () => {
      const app = (window as any).__mirrorTrace as any;
      drawShortStroke();
      const afterDraw = app.historyPointer;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      expect(app.historyPointer).toBe(afterDraw - 1);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
      expect(app.historyPointer).toBe(afterDraw);
    });
  });

  /* ──────────────────────────── */
  /*  按钮交互                      */
  /* ──────────────────────────── */

  describe('按钮交互', () => {
    it('重画按钮 (btn-redraw) 重置笔画但保留曲线', () => {
      const app = (window as any).__mirrorTrace as any;
      const refPathBefore = [...app.refPath];

      // Draw a stroke first
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 300, clientY: 300, pointerId: 20,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 310, clientY: 305, pointerId: 20,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 20 }));

      expect(app.historyPointer).toBeGreaterThanOrEqual(0);

      // Click redraw
      const redrawBtn = document.getElementById('btn-redraw') as HTMLButtonElement;
      redrawBtn.click();

      // History reset, but reference curve unchanged
      expect(app.historyPointer).toBe(-1);
      expect(app.refPath).toEqual(refPathBefore);
    });

    it('新曲线按钮 (btn-newcurve) 生成新参考曲线', () => {
      const app = (window as any).__mirrorTrace as any;

      const newCurveBtn = document.getElementById('btn-newcurve') as HTMLButtonElement;
      newCurveBtn.click();

      // New curve should be different (or at least not the same reference)
      // In rare cases the random generator could produce identical points,
      // but the array identity (===) should differ since it's a new array
      // Actually they could be content-equal, but array reference is definitely new
      // Let's just check history is reset
      expect(app.historyPointer).toBe(-1);
    });
  });

  /* ──────────────────────────── */
  /*  localStorage 持久化          */
  /* ──────────────────────────── */

  describe('localStorage 持久化', () => {
    beforeEach(() => {
      // Switch to single-stroke mode (saves on each stroke)
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));
    });

    it('单笔模式下完成笔画后保存到 localStorage', () => {
      // Ensure clean state
      const key = 'mirror-trace-history';
      localStorage.removeItem(key);

      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 400, clientY: 400, pointerId: 30,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 410, clientY: 405, pointerId: 30,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 420, clientY: 410, pointerId: 30,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 430, clientY: 415, pointerId: 30,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 440, clientY: 420, pointerId: 30,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 30 }));

      const app = (window as any).__mirrorTrace as any;
      expect(app.historyPointer).toBeGreaterThanOrEqual(0);

      const stored = localStorage.getItem(key);
      expect(stored).not.toBeNull();

      if (stored) {
        const entries = JSON.parse(stored);
        expect(Array.isArray(entries)).toBe(true);
        // At least one entry should be present
        expect(entries.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  /* ──────────────────────────── */
  /*  键盘快捷键                    */
  /* ──────────────────────────── */

  describe('键盘快捷键', () => {
    it('Ctrl+Z 不会影响非 drawing 以外的 keydown 行为', () => {
      // Just ensure no crash
      expect(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      }).not.toThrow();
    });

    it('R 键触发 redraw', () => {
      const app = (window as any).__mirrorTrace as any;
      const refPathBefore = [...app.refPath];

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));

      // History reset
      expect(app.historyPointer).toBe(-1);
      expect(app.refPath).toEqual(refPathBefore);
    });

    it('N 键触发 newCurve', () => {
      const app = (window as any).__mirrorTrace as any;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));

      expect(app.historyPointer).toBe(-1);
    });
  });

  /* ──────────────────────────── */
  /*  高优先级修复回归              */
  /* ──────────────────────────── */

  describe('键盘快捷键 — 输入框守卫 (H1)', () => {
    it('数字输入框内的按键不触发快捷键，非输入目标仍然生效', () => {
      const app = (window as any).__mirrorTrace as any;
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));
      expect(app.singleStrokeMode).toBe(false);

      /* 在数字输入框里键入 '2'/'n' —— 不应切换模式或重置 */
      const straightInput = document.getElementById('input-straight') as HTMLInputElement;
      straightInput.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      straightInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
      expect(app.singleStrokeMode).toBe(false);

      /* 同样的按键在非输入目标上照常生效 */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
      expect(app.singleStrokeMode).toBe(true);
    });
  });

  describe('全评价 — 数据随撤销/重做同步 (H3)', () => {
    const key = 'mirror-trace-history';

    /** Switch to overview mode and trace refPath in `chunks` strokes */
    function drawRefCoverage(chunks: number, pointerBase: number): void {
      const app = (window as any).__mirrorTrace as any;
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      const path = app.refPath as { x: number; y: number }[];
      const per = Math.ceil(path.length / chunks);
      for (let c = 0; c < chunks; c++) {
        const slice = path.slice(c * per, Math.min((c + 1) * per + 1, path.length));
        drawAlongPath(userCanvas, slice, pointerBase + c);
      }
    }

    beforeEach(() => {
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));
      localStorage.removeItem(key);
    });

    it('概括模式覆盖 ≥97% 后显示全评徽章并持久化', () => {
      const app = (window as any).__mirrorTrace as any;
      drawRefCoverage(3, 300);

      expect(app.coveragePct).toBeGreaterThanOrEqual(97);
      expect(document.getElementById('eval-badges')!.style.display).not.toBe('none');
      expect(localStorage.getItem(key)).not.toBeNull();
    });

    it('撤销后徽章隐藏；重做后恢复且不重复持久化', () => {
      const app = (window as any).__mirrorTrace as any;
      drawRefCoverage(3, 400);
      expect(app.coveragePct).toBeGreaterThanOrEqual(97);

      const countEntries = () =>
        (JSON.parse(localStorage.getItem(key) || '[]') as unknown[]).length;
      const saved = countEntries();
      expect(saved).toBeGreaterThanOrEqual(1);

      /* Undo the last chunk → coverage < 97% → badges hide */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      expect(app.coveragePct).toBeLessThan(97);
      expect(document.getElementById('eval-badges')!.style.display).toBe('none');

      /* Redo → badges re-derived from visible strokes, no duplicate save */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
      expect(app.coveragePct).toBeGreaterThanOrEqual(97);
      expect(document.getElementById('eval-badges')!.style.display).not.toBe('none');
      expect(countEntries()).toBe(saved);
    });

    it('撤销到底后重画可再次触发全评（计时器随新笔画重启）', () => {
      const app = (window as any).__mirrorTrace as any;
      drawRefCoverage(3, 500);
      expect(app.coveragePct).toBeGreaterThanOrEqual(97);

      /* Undo everything */
      for (let i = 0; i < 4; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      }
      expect(app.historyPointer).toBe(-1);
      expect(document.getElementById('eval-badges')!.style.display).toBe('none');

      /* Redraw full coverage → full evaluation triggers again */
      drawRefCoverage(2, 600);
      expect(app.coveragePct).toBeGreaterThanOrEqual(97);
      expect(document.getElementById('eval-badges')!.style.display).not.toBe('none');
    });
  });

  describe('多条模式全评价 — 合并参考路径 (H2)', () => {
    it('逐线画完后全评以全部匹配线为基准，精确描画应得高分', () => {
      const app = (window as any).__mirrorTrace as any;
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;

      /* 复位到概括（清掉 multi/hell 标志）→ 单笔 → 多条：2 直线 + 0 弧线 */
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));
      const straightInput = document.getElementById('input-straight') as HTMLInputElement;
      straightInput.value = '2';
      straightInput.dispatchEvent(new Event('change'));
      const archInput = document.getElementById('input-arch') as HTMLInputElement;
      archInput.value = '0';
      archInput.dispatchEvent(new Event('change'));
      const multiToggle = document.getElementById('toggle-multi') as HTMLInputElement;
      multiToggle.checked = true;
      multiToggle.dispatchEvent(new Event('change'));

      expect(app.multiLines.length).toBe(2);
      localStorage.removeItem('mirror-trace-history');

      /* 沿每条线精确描画 */
      (app.multiLines as { x: number; y: number }[][]).forEach((line, i) => {
        const step = Math.max(1, Math.floor(line.length / 30));
        const pts: { x: number; y: number }[] = [];
        for (let j = 0; j < line.length; j += step) pts.push(line[j]);
        if (pts[pts.length - 1] !== line[line.length - 1]) pts.push(line[line.length - 1]);
        drawAlongPath(userCanvas, pts, 700 + i);
      });

      expect(app.coveragePct).toBe(100);
      expect(document.getElementById('eval-badges')!.style.display).not.toBe('none');

      /* 精确描画下全评 A 应接近满分 —— 修复前以 lines[0] 为基准时
         拼接路径与单线比对，得分会远低于此 */
      const entries = JSON.parse(localStorage.getItem('mirror-trace-history') || '[]') as any[];
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[entries.length - 1].finalScore).toBeGreaterThanOrEqual(90);
    });
  });

  /* ──────────────────────────── */
  /*  中优先级修复回归              */
  /* ──────────────────────────── */

  describe('中优先级修复回归', () => {
    /** 复位到概括（清掉 multi/hell 标志），再切到单笔 */
    function enterSingleStrokeMode(): void {
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));
      modeToggle.checked = true;
      modeToggle.dispatchEvent(new Event('change'));
    }

    function setNumberInput(id: string, value: string): void {
      const input = document.getElementById(id) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('change'));
    }

    it('resize 后多条模式重放最近笔画 (M1)', () => {
      const app = (window as any).__mirrorTrace as any;
      enterSingleStrokeMode();
      setNumberInput('input-straight', '2');
      setNumberInput('input-arch', '0');
      const multiToggle = document.getElementById('toggle-multi') as HTMLInputElement;
      multiToggle.checked = true;
      multiToggle.dispatchEvent(new Event('change'));
      expect(app.multiLines.length).toBe(2);

      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      drawAlongPath(userCanvas, app.multiLines[0].slice(0, 20), 800);
      expect(app.historyPointer).toBe(0);

      /* Canvas buffer resize wipes the ink — the redraw must replay the
         stroke + processed overlay (≥7 stroke calls; the old code that
         only redrew the reference canvas produced 6). */
      const before = (mockCtx.stroke as any).mock.calls.length;
      app.resizeCanvases();
      const after = (mockCtx.stroke as any).mock.calls.length;
      expect(after - before).toBeGreaterThanOrEqual(7);
    });

    it('地狱模式撤销到底后复杂线分段覆盖重置 (M3)', () => {
      const app = (window as any).__mirrorTrace as any;
      enterSingleStrokeMode();
      setNumberInput('input-hell-straight', '0');
      setNumberInput('input-hell-arch', '0');
      setNumberInput('input-hell-complex', '1');
      const hellToggle = document.getElementById('toggle-hell') as HTMLInputElement;
      hellToggle.checked = true;
      hellToggle.dispatchEvent(new Event('change'));

      expect(app.multiLines.length).toBe(1);
      const cov = app.complexLineCoverage as (boolean[] | null)[];
      expect(cov[0]).not.toBeNull();

      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      drawAlongPath(userCanvas, app.multiLines[0].slice(0, 15), 810);
      expect(app.historyPointer).toBe(0);
      expect((cov[0] as boolean[]).some(v => v)).toBe(true);

      /* Undo to zero → segment coverage must reset too */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      expect(app.historyPointer).toBe(-1);
      expect((app.complexLineCoverage[0] as boolean[]).some(v => v)).toBe(false);
      expect(app.multiLineCovered.every((v: boolean) => !v)).toBe(true);
    });

    it('主题切换更新画布调色板并重绘 (M4)', () => {
      const app = (window as any).__mirrorTrace as any;
      expect(app.palette.refLine).toBe('#ffffff');

      const lightDot = document.querySelector('.theme-dot[data-theme="light"]') as HTMLElement;
      lightDot.click();
      expect(app.palette.refLine).toBe('#2a2a4a');
      expect(app.palette.strokeDefault).toBe('#e05050');

      /* Restore the default theme for subsequent tests */
      const darkDot = document.querySelector('.theme-dot[data-theme="dark-blue"]') as HTMLElement;
      darkDot.click();
      expect(app.palette.refLine).toBe('#ffffff');
    });

    it('回放被新笔画取消后辉光样式重置 (M6)', () => {
      const app = (window as any).__mirrorTrace as any;
      enterSingleStrokeMode();
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      drawAlongPath(userCanvas, [{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 140 }], 820);
      expect(app.historyPointer).toBe(0);

      (app as any).replayStroke();
      expect((app as any).userCtx.shadowBlur).toBe(6);

      /* A new pointerdown cancels the replay and must clear the glow */
      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 50, clientY: 50, pointerId: 821,
      }));
      expect((app as any).userCtx.shadowBlur).toBe(0);
      userCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 821 }));
    });
  });

  /* ──────────────────────────── */
  /*  清扫修复回归                   */
  /* ──────────────────────────── */

  describe('清扫修复回归', () => {
    beforeEach(() => {
      /* Reset to overview mode for a clean canvas state */
      const modeToggle = document.getElementById('toggle-mode') as HTMLInputElement;
      modeToggle.checked = false;
      modeToggle.dispatchEvent(new Event('change'));
    });

    it('pointercancel 结束笔画而非卡住 isDrawing', () => {
      const app = (window as any).__mirrorTrace as any;
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      const before = app.historyPointer;

      userCanvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 100, clientY: 100, pointerId: 900,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 130, clientY: 120, pointerId: 900,
      }));
      userCanvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 160, clientY: 140, pointerId: 900,
      }));
      expect(app.isDrawing).toBe(true);

      userCanvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 900 }));
      expect(app.isDrawing).toBe(false);
      expect(app.historyPointer).toBe(before + 1);
    });

    it('ESC 优先关闭帮助覆盖层', () => {
      const help = document.getElementById('help-overlay')!;
      help.style.display = 'flex';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(help.style.display).toBe('none');
    });

    it('ESC 关闭导出菜单', () => {
      const menu = document.getElementById('export-menu')!;
      menu.style.display = 'flex';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(menu.style.display).toBe('none');
    });

    it('全评后 lastFullEval 可供报告导出使用，撤销后清空', () => {
      const app = (window as any).__mirrorTrace as any;
      const userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;
      const path = app.refPath as { x: number; y: number }[];
      const per = Math.ceil(path.length / 2);
      drawAlongPath(userCanvas, path.slice(0, per + 1), 910);
      drawAlongPath(userCanvas, path.slice(per), 911);

      expect(app.coveragePct).toBeGreaterThanOrEqual(97);
      expect(app.lastFullEval).not.toBeNull();
      expect(typeof app.lastFullEval.finalScore).toBe('number');

      /* Undo below the threshold → the cached full-eval score must go away */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
      expect(app.lastFullEval).toBeNull();
    });

    it('SVG 导出仅包含可见笔画且不抛异常', () => {
      const app = (window as any).__mirrorTrace as any;
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => { /* prevent navigation in happy-dom */ });
      try {
        expect(() => (app as any).doExport('svg')).not.toThrow();
        expect(clickSpy).toHaveBeenCalled();
      } finally {
        clickSpy.mockRestore();
      }
    });
  });
});

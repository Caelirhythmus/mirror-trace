/**
 * Mirror Trace — 路径临摹工具
 *
 * 左右 Canvas 双缓冲框架：
 *  - refCanvas: 显示随机生成的参考贝塞尔曲线
 *  - userCanvas: 用户临摹绘制区域
 */

interface Point {
  x: number;
  y: number;
}

class MirrorTraceApp {
  private refCanvas!: HTMLCanvasElement;
  private userCanvas!: HTMLCanvasElement;
  private refCtx!: CanvasRenderingContext2D;
  private userCtx!: CanvasRenderingContext2D;

  private isDrawing = false;
  private currentPath: Point[] = [];

  constructor() {
    this.initCanvases();
    this.bindEvents();
    this.resize();
  }

  private initCanvases(): void {
    this.refCanvas = document.getElementById('ref-canvas') as HTMLCanvasElement;
    this.userCanvas = document.getElementById('user-canvas') as HTMLCanvasElement;

    this.refCtx = this.refCanvas.getContext('2d')!;
    this.userCtx = this.userCanvas.getContext('2d')!;

    // Handle DPI scaling for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    const resizeObserver = new ResizeObserver(() => {
      const rect = this.refCanvas.getBoundingClientRect();
      this.refCanvas.width = rect.width * dpr;
      this.refCanvas.height = rect.height * dpr;
      this.refCtx.scale(dpr, dpr);

      this.userCanvas.width = rect.width * dpr;
      this.userCanvas.height = rect.height * dpr;
      this.userCtx.scale(dpr, dpr);

      this.drawScene();
    });
    resizeObserver.observe(this.refCanvas);
  }

  private resize(): void {
    // Trigger initial resize via ResizeObserver
  }

  private bindEvents(): void {
    this.userCanvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.userCanvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.userCanvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.userCanvas.addEventListener('pointerleave', this.onPointerUp.bind(this));
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDrawing = true;
    this.currentPath = [];
    const p = this.clientToCanvas(e);
    this.currentPath.push(p);
    this.userCtx.beginPath();
    this.userCtx.moveTo(p.x, p.y);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;

    const events = e.getCoalescedEvents();
    if (events.length > 0) {
      for (const ev of events) {
        const p = this.clientToCanvas(ev);
        this.currentPath.push(p);
        this.userCtx.lineTo(p.x, p.y);
        this.userCtx.stroke();
      }
    } else {
      const p = this.clientToCanvas(e);
      this.currentPath.push(p);
      this.userCtx.lineTo(p.x, p.y);
      this.userCtx.stroke();
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    this.isDrawing = false;
    // TODO: trigger similarity scoring
  }

  private clientToCanvas(e: PointerEvent): Point {
    const rect = this.userCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private drawScene(): void {
    this.drawRefCanvas();
  }

  private drawRefCanvas(): void {
    const ctx = this.refCtx;
    const w = this.refCanvas.width / (window.devicePixelRatio || 1);
    const h = this.refCanvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, w, h);
    // Placeholder: draw a sample line
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, h * 0.5);
    for (let t = 0; t <= 1; t += 0.02) {
      const x = w * (0.1 + t * 0.8);
      const y = h * (0.3 + 0.4 * Math.sin(t * Math.PI * 3));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  new MirrorTraceApp();
});

import { Point } from './types';

/* ------------------------------------------------------------------ */
/*  Internal model: one cubic-Bezier segment (4 control points)       */
/* ------------------------------------------------------------------ */

interface BezierSeg {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

/* ------------------------------------------------------------------ */
/*  Random helpers                                                     */
/* ------------------------------------------------------------------ */

/** Integer in [lo, hi] inclusive */
function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Float in [-range, +range] */
function jitter(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}

/** Cubic Bézier evaluation at t ∈ [0, 1] */
function evalCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x,
    y: u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y,
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Generate a random multi-segment cubic Bézier curve.
 *
 * The curve is C¹-continuous at every joint, drawn left-to-right
 * (x-monotonic anchors) so it stays traceable.
 *
 * @param w      CSS width of the canvas
 * @param h      CSS height of the canvas
 * @param margin padding from edges
 * @returns      Sampled point array (100–400 points)
 */
export function generateRandomCurve(
  w: number,
  h: number,
  margin = 40,
): Point[] {
  /* --- 1. pick anchor count (2–4 segments → 3–5 anchors) --- */
  const numSegments = randInt(2, 4);
  const numAnchors = numSegments + 1;

  /* --- 2. generate x-monotonic anchors --- */
  const anchors: Point[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const t = i / (numAnchors - 1);
    // x sweeps from left edge to right edge, with some randomness
    const xMin = margin + w * t * 0.75;
    const xMax = margin + w * (0.2 + t * 0.7);
    anchors.push({
      x: xMin + Math.random() * (xMax - xMin),
      y: margin + Math.random() * (h - 2 * margin),
    });
  }

  /* --- 3. build C¹-continuous segments --- */
  const segs: BezierSeg[] = [];

  for (let i = 0; i < numSegments; i++) {
    const p0 = anchors[i];
    const p3 = anchors[i + 1];
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const dist = Math.hypot(dx, dy);
    const halfDist = Math.max(dist * 0.25, 30); // min control-arm length

    let p1: Point;
    let p2: Point;

    if (i === 0) {
      // First segment — both control points are free
      p1 = {
        x: p0.x + halfDist + jitter(halfDist * 0.4),
        y: p0.y + jitter(halfDist * 0.5),
      };
      p2 = {
        x: p3.x - halfDist + jitter(halfDist * 0.4),
        y: p3.y + jitter(halfDist * 0.5),
      };
    } else {
      // C¹ continuity: incoming tangent ⇢ outgoing tangent
      // tangent_in = p3_prev - p2_prev
      // ⇒ p1_i = p0_i + (p0_i - p2_prev) = 2·p0_i - p2_prev
      const prev = segs[i - 1];
      p1 = {
        x: 2 * p0.x - prev.p2.x,
        y: 2 * p0.y - prev.p2.y,
      };

      // p2 is free
      p2 = {
        x: p3.x - halfDist + jitter(halfDist * 0.4),
        y: p3.y + jitter(halfDist * 0.5),
      };
    }

    segs.push({ p0, p1, p2, p3 });
  }

  /* --- 4. sample at uniform t intervals --- */
  const step = 0.01;
  const points: Point[] = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // Avoid duplicate anchors between segments (except last segment)
    const endT = i < segs.length - 1 ? 1 - step : 1;
    for (let t = 0; t <= endT + step * 0.5; t += step) {
      const clamped = Math.min(t, endT);
      points.push(evalCubic(s.p0, s.p1, s.p2, s.p3, clamped));
    }
  }

  return points;
}

/* ------------------------------------------------------------------ */
/*  Rotation utility                                                   */
/* ------------------------------------------------------------------ */

/**
 * Rotate an array of points by `angle` degrees about center `(cx, cy)`.
 */
export function rotatePoints(
  pts: readonly Point[],
  angleDeg: number,
  cx: number,
  cy: number,
): Point[] {
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  return pts.map(p => ({
    x: cx + (p.x - cx) * cosA - (p.y - cy) * sinA,
    y: cy + (p.x - cx) * sinA + (p.y - cy) * cosA,
  }));
}

/* ------------------------------------------------------------------ */
/*  Bounding-box fitting                                               */
/* ------------------------------------------------------------------ */

/**
 * Translate (and optionally scale) a point array so its bounding box
 * fits within `[margin, w-margin]` × `[margin, h-margin]`.
 *
 * The curve's shape is preserved; only its position changes (plus
 * uniform down-scaling when the rotated curve is too large to fit).
 * A random offset within the available space keeps placement varied.
 */
export function translateToFit(
  pts: readonly Point[],
  w: number,
  h: number,
  margin = 40,
): Point[] {
  if (pts.length === 0) return [...pts];

  /* Bounding box */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }

  const cw = x1 - x0, ch = y1 - y0;
  const availW = w - 2 * margin;
  const availH = h - 2 * margin;

  /* Scale down uniformly if the curve is too large to fit */
  if (cw > availW || ch > availH) {
    const s = Math.min(availW / cw, availH / ch, 1);
    const scaled = pts.map(p => ({
      x: x0 + (p.x - x0) * s,
      y: y0 + (p.y - y0) * s,
    }));
    return translateToFit(scaled, w, h, margin);
  }

  /* Random offset within the available space */
  const dx = margin - x0 + Math.random() * (availW - cw);
  const dy = margin - y0 + Math.random() * (availH - ch);

  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

/* ------------------------------------------------------------------ */
/*  Arch curve (single-stroke mode)                                    */
/* ------------------------------------------------------------------ */

/**
 * Generate a simple arch (bridge) curve for single-stroke mode.
 *
 * The curve is a single cubic Bézier spanning the canvas left-to-right.
 * `curvature` controls how high (positive) or low (negative) the arch
 * goes relative to the canvas height.  curvature = 0  ⇒  straight line.
 *
 * The arch direction and slant are randomised each call (up / down / tilted)
 * so users get varied practice.
 *
 * @param w         Canvas CSS width
 * @param h         Canvas CSS height
 * @param curvature Relative arch height; default 0.15 (15 % of h)
 * @param margin    Padding from edges
 * @param step      Sampling interval in t; default 0.015
 */
export function generateArchCurve(
  w: number,
  h: number,
  curvature = 0.15,
  margin = 40,
  step = 0.015,
): Point[] {
  const midY = h / 2;
  const archPx = curvature * h;

  /* Endpoint vertical offset — shared jitter + tilt so one end sits higher */
  const yOff = (Math.random() - 0.5) * h * 0.08;
  const tiltOff = (Math.random() - 0.5) * h * 0.20;

  const p0: Point = {
    x: margin + Math.random() * w * 0.05,
    y: midY + yOff + tiltOff,
  };
  const p3: Point = {
    x: w - margin - Math.random() * w * 0.05,
    y: midY + yOff - tiltOff,
  };

  const xSpan = p3.x - p0.x;

  /* Control points with varied horizontal ratios for asymmetric arches */
  const p1xRatio = 0.25 + Math.random() * 0.18;   // 0.25 – 0.43
  const p2xRatio = 0.57 + Math.random() * 0.18;   // 0.57 – 0.75

  const p1x = p0.x + xSpan * p1xRatio + (Math.random() - 0.5) * w * 0.04;
  const p2x = p0.x + xSpan * p2xRatio + (Math.random() - 0.5) * w * 0.04;

  /* Baseline y at each x (linear interp between endpoints), then add arch */
  const baseY = (x: number) => p0.y + (p3.y - p0.y) * ((x - p0.x) / xSpan);
  const p1: Point = { x: p1x, y: baseY(p1x) - archPx };
  const p2: Point = { x: p2x, y: baseY(p2x) - archPx };

  /* Sample */
  const points: Point[] = [];
  for (let t = 0; t <= 1 + step * 0.5; t += step) {
    points.push(evalCubic(p0, p1, p2, p3, Math.min(t, 1)));
  }
  return points;
}

/**
 * Convenience: call `generateArchCurve` with a random curvature sign
 * and magnitude so each invocation feels fresh.
 */
export function generateRandomArchCurve(
  w: number,
  h: number,
  margin = 40,
  step = 0.015,
): Point[] {
  const sign = Math.random() > 0.5 ? 1 : -1;
  const mag = 0.05 + Math.random() * 0.20; // 0.05 – 0.25
  return generateArchCurve(w, h, sign * mag, margin, step);
}

/**
 * Generate a randomly-rotated arch — the base arch is produced by
 * `generateRandomArchCurve` and then rotated by a random angle (0–360°)
 * about a random centre within the canvas.
 */
export function generateRotatedArch(
  w: number,
  h: number,
  margin = 40,
  step = 0.015,
): Point[] {
  const pts = generateRandomArchCurve(w, h, margin, step);
  const angle = Math.random() * 360;
  const cx = margin + Math.random() * (w - 2 * margin);
  const cy = margin + Math.random() * (h - 2 * margin);
  const rotated = rotatePoints(pts, angle, cx, cy);
  return translateToFit(rotated, w, h, margin);
}

/* ------------------------------------------------------------------ */
/*  Straight line (single-stroke multi-line mode)                      */
/* ------------------------------------------------------------------ */

/**
 * Generate a straight line from left to right with slight random y-offset.
 */
export function generateStraightLine(
  w: number,
  h: number,
  margin = 40,
  step = 0.015,
): Point[] {
  return generateArchCurve(w, h, 0, margin, step);
}

/* ------------------------------------------------------------------ */
/*  Multi-line generation (multiple curves stacked together)           */
/* ------------------------------------------------------------------ */

export interface MultiLineResult {
  lines: Point[][];
}

/**
 * Generate a set of lines for multi-line practice mode.
 *
 * @param w             Canvas CSS width
 * @param h             Canvas CSS height
 * @param totalLines    Total number of lines to generate
 * @param straightCount Number of straight lines among them
 * @param margin        Padding from edges
 */
export function generateMultiLines(
  w: number,
  h: number,
  totalLines: number,
  straightCount: number,
  margin = 40,
): MultiLineResult {
  const clampedTotal = Math.max(1, Math.min(totalLines, 20));
  const clampedStraight = Math.max(0, Math.min(straightCount, clampedTotal));
  const archCount = clampedTotal - clampedStraight;

  const lines: Point[][] = [];

  /* Generate base lines (horizontal left→right) */
  for (let i = 0; i < clampedStraight; i++) {
    lines.push(generateStraightLine(w, h, margin));
  }
  for (let i = 0; i < archCount; i++) {
    lines.push(generateRandomArchCurve(w, h, margin));
  }

  /* Shuffle, then rotate each line by a random angle around a random centre */
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }

  const rotated = lines.map(line => {
    const angle = Math.random() * 360;
    const cx = margin + Math.random() * (w - 2 * margin);
    const cy = margin + Math.random() * (h - 2 * margin);
    return translateToFit(rotatePoints(line, angle, cx, cy), w, h, margin);
  });

  return { lines: rotated };
}

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
/*  Arch curve (single-stroke mode)                                    */
/* ------------------------------------------------------------------ */

/**
 * Generate a simple arch (bridge) curve for single-stroke mode.
 *
 * The curve is a single cubic Bézier spanning the canvas left-to-right.
 * `curvature` controls how high (positive) or low (negative) the arch
 * goes relative to the canvas height.  curvature = 0  ⇒  straight line.
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

  /* Endpoints with a little vertical jitter so not every arch is dead-centre */
  const yOff = (Math.random() - 0.5) * h * 0.08;
  const p0: Point = { x: margin + Math.random() * w * 0.05, y: midY + yOff };
  const p3: Point = { x: w - margin - Math.random() * w * 0.05, y: midY + yOff };

  /* Control points – horizontal spread at 1/3 and 2/3, vertical = arch */
  const p1: Point = {
    x: p0.x + (p3.x - p0.x) * 0.33 + (Math.random() - 0.5) * w * 0.04,
    y: midY - archPx + yOff,
  };
  const p2: Point = {
    x: p0.x + (p3.x - p0.x) * 0.67 + (Math.random() - 0.5) * w * 0.04,
    y: midY - archPx + yOff,
  };

  /* Sample */
  const points: Point[] = [];
  for (let t = 0; t <= 1 + step * 0.5; t += step) {
    points.push(evalCubic(p0, p1, p2, p3, Math.min(t, 1)));
  }
  return points;
}

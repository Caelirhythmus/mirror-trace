import { Point } from './types';

/* ------------------------------------------------------------------ */
/*  RDP (Ramer–Douglas–Peucker) simplification                        */
/* ------------------------------------------------------------------ */

/**
 * Simplify a polyline using the Ramer–Douglas–Peucker algorithm.
 *
 * @param pts     Input point array (at least 2 points)
 * @param epsilon Distance threshold in CSS pixels (recommended: 0.5)
 * @returns       Simplified point array
 */
export function rdpSimplify(pts: readonly Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return [...pts];

  const first = pts[0];
  const last = pts[pts.length - 1];

  // Find the point farthest from the baseline [first–last]
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(pts.slice(maxIdx), epsilon);
    // Avoid duplicating the split point
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/** Perpendicular distance of point p from line (a–b) */
function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/* ------------------------------------------------------------------ */
/*  Equidistant resampling to a target point count                     */
/* ------------------------------------------------------------------ */

/**
 * Resample a polyline so it contains exactly `count` points,
 * equally spaced along the original path.
 *
 * @param pts   Input points (>= 1)
 * @param count Target count (>= 2)
 * @returns     Resampled point array of length `count`
 */
export function resampleToCount(
  pts: readonly Point[],
  count: number,
): Point[] {
  if (pts.length <= 1 || count <= 1) {
    return pts.length > 0 ? [pts[0]] : [];
  }
  if (count === 2) {
    return [pts[0], pts[pts.length - 1]];
  }

  const totalLen = arcLength(pts);
  const segLen = totalLen / (count - 1);

  const result: Point[] = [pts[0]];
  let accum = 0;
  let i = 0;

  for (let dst = 1; dst < count - 1; dst++) {
    const target = dst * segLen;

    // Advance until we pass the target distance
    while (i < pts.length - 1 && accum < target) {
      i++;
      if (i < pts.length) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        accum += Math.hypot(dx, dy);
      }
    }

    // Interpolate between pts[i-1] and pts[i]
    const prev = pts[Math.max(0, i - 1)];
    const curr = pts[Math.min(i, pts.length - 1)];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLenActual = Math.hypot(dx, dy);

    if (segLenActual < 1e-10) {
      result.push({ x: prev.x, y: prev.y });
    } else {
      const overshoot = accum - target;
      const t = 1 - overshoot / segLenActual;
      result.push({
        x: prev.x + dx * t,
        y: prev.y + dy * t,
      });
    }
  }

  result.push(pts[pts.length - 1]);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

/** Total arc length of a polyline */
export function arcLength(pts: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

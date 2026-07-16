import { Point } from './types';

/* ------------------------------------------------------------------ */
/*  Segment matching — find the refPath sub-segment a user stroke      */
/*  corresponds to, by matching the stroke's start/end points to       */
/*  the nearest indices on the reference curve.                        */
/* ------------------------------------------------------------------ */

export interface SegmentMatch {
  /** Start index on refPath (inclusive) */
  startIdx: number;
  /** End index on refPath (inclusive) */
  endIdx: number;
  /** The extracted sub-path: refPath[startIdx .. endIdx] */
  subPath: Point[];
}

/**
 * Find the sub-segment of `refPath` that best matches a user stroke.
 *
 * The match is based on the user stroke's first and last points:
 * 1. Find the nearest refPath index to `stroke[0]`  →  `si`
 * 2. Find the nearest refPath index to `stroke[end]` →  `ei`
 * 3. Ensure `si <= ei` (swap if drawn right-to-left)
 * 4. Return the sub-path `refPath[si .. ei]`
 *
 * @param refPath  The full reference curve
 * @param stroke   The user's stroke (raw or simplified — only first
 *                 and last points are used for matching)
 * @param minSpan  Minimum number of points the sub-path must contain;
 *                 if the match is too short it will be expanded
 *                 symmetrically (default 3)
 */
export function findSegment(
  refPath: readonly Point[],
  stroke: readonly Point[],
  minSpan = 3,
): SegmentMatch {
  if (refPath.length < 2 || stroke.length < 2) {
    return {
      startIdx: 0,
      endIdx: refPath.length - 1,
      subPath: [...refPath],
    };
  }

  let si = nearestIndex(refPath, stroke[0]);
  let ei = nearestIndex(refPath, stroke[stroke.length - 1]);

  /* Ensure left-to-right order along refPath */
  if (si > ei) [si, ei] = [ei, si];

  /* Expand if the span is below the minimum */
  const span = ei - si + 1;
  if (span < minSpan) {
    const shortage = minSpan - span;
    const expandL = Math.ceil(shortage / 2);
    const expandR = shortage - expandL;
    si = Math.max(0, si - expandL);
    ei = Math.min(refPath.length - 1, ei + expandR);
  }

  return {
    startIdx: si,
    endIdx: ei,
    subPath: refPath.slice(si, ei + 1),
  };
}

/**
 * Find the index of the point in `path` closest to `target`.
 */
export function nearestIndex(
  path: readonly Point[],
  target: Point,
): number {
  if (path.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i].x - target.x, path[i].y - target.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

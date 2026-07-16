import { describe, it, expect } from 'vitest';
import { computeScores } from './scoring';
import type { Point } from './types';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const p = (x: number, y: number): Point => ({ x, y });

/** A horizontal line of N evenly-spaced points from (10, 50) to (300, 50) */
function refLine(n: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(p(10 + (290 * i) / (n - 1), 50));
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/*  computeScores                                                      */
/* ------------------------------------------------------------------ */

describe('computeScores', () => {
  it('returns 100 for identical paths drawn at ideal speed', () => {
    const path = refLine(150);
    const idealMs = 290 / 160 * 1000; // ≈ 1812 ms
    const result = computeScores(path, path, idealMs);

    expect(result.hausdorff95Dist).toBeCloseTo(0, 1);
    expect(result.rmsDist).toBeCloseTo(0, 1);
    expect(result.spatialScore).toBe(100);
    expect(result.timeScore).toBe(100);
    expect(result.finalScore).toBe(100);
  });

  it('penalises paths with different curvature', () => {
    // ref: straight horizontal line
    const ref = refLine(150);
    // user: sine wave that deviates from the line (not just translated,
    //       because procrustes translation-only would cancel pure shifts)
    const user: Point[] = ref.map((pt, i) => {
      const t = i / (ref.length - 1);
      return p(pt.x, pt.y + Math.sin(t * Math.PI * 4) * 15);
    });
    const elapsed = 290 / 160 * 1000;

    const result = computeScores(ref, user, elapsed);
    expect(result.spatialScore).toBeLessThan(100);
    expect(result.rmsDist).toBeGreaterThan(0);
    expect(result.hausdorff95Dist).toBeGreaterThan(0);
  });

  it('gives 100 time score when faster than ideal', () => {
    const path = refLine(150);
    const result = computeScores(path, path, 100); // very fast
    expect(result.timeScore).toBe(100);
  });

  it('reduces time score when slower than ideal', () => {
    const path = refLine(150);
    const elapsed = 290 / 160 * 1000; // ≈ 1812 ms
    const result = computeScores(path, path, elapsed * 2); // 2x slower
    expect(result.timeScore).toBeLessThan(100);
    expect(result.timeScore).toBeGreaterThan(0);
  });

  it('exponentially decays time score (more penalty for slightly over)', () => {
    const path = refLine(150);
    const elapsed = 290 / 160 * 1000;
    const slightlyOver = computeScores(path, path, elapsed * 1.2);
    const wayOver = computeScores(path, path, elapsed * 3);

    // Slightly over should still lose significant points
    expect(slightlyOver.timeScore).toBeLessThan(90);
    // Way over should be very low but non-zero
    expect(wayOver.timeScore).toBeLessThan(slightlyOver.timeScore);
    expect(wayOver.timeScore).toBeGreaterThan(0);
  });

  it('final score weights spatial 65% and time 35%', () => {
    const ref = refLine(150);
    const shifted = ref.map(pt => p(pt.x + 20, pt.y));
    const elapsed = 290 / 160 * 1000;

    const result = computeScores(ref, shifted, elapsed);
    const expectedSpatial = result.spatialScore * 0.65 + result.timeScore * 0.35;
    expect(result.finalScore).toBeCloseTo(expectedSpatial, 1);
  });

  it('handles degenerate paths gracefully', () => {
    const path = [p(10, 10), p(20, 20)];
    const result = computeScores(path, path, 100);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(100);
  });
});

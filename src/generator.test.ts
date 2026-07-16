import { describe, it, expect } from 'vitest';
import { generateRandomCurve } from './generator';

/* ------------------------------------------------------------------ */
/*  Generator tests                                                    */
/* ------------------------------------------------------------------ */

describe('generateRandomCurve', () => {
  it('returns points within canvas bounds', () => {
    const pts = generateRandomCurve(500, 400, 40);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(500);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
  });

  it('returns at least 100 points', () => {
    const pts = generateRandomCurve(500, 400);
    expect(pts.length).toBeGreaterThanOrEqual(100);
  });

  it('returns at most 500 points', () => {
    const pts = generateRandomCurve(500, 400);
    expect(pts.length).toBeLessThanOrEqual(500);
  });

  it('returns a different curve each call (randomised)', () => {
    const a = generateRandomCurve(500, 400);
    const b = generateRandomCurve(500, 400);

    // Very unlikely to generate identical curves
    const same = a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);
    expect(same).toBe(false);
  });

  it('handles small canvas', () => {
    const pts = generateRandomCurve(100, 100, 10);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
    }
  });

  it('produces a path with mostly increasing x (traceable left→right)', () => {
    const pts = generateRandomCurve(600, 400, 40);
    let increasingCount = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x >= pts[i - 1].x) increasingCount++;
    }
    // At least 80% of consecutive points should have non-decreasing x
    expect(increasingCount / (pts.length - 1)).toBeGreaterThan(0.8);
  });
});

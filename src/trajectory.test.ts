import { describe, it, expect } from 'vitest';
import { rdpSimplify, resampleToCount, arcLength } from './trajectory';
import type { Point } from './types';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const p = (x: number, y: number): Point => ({ x, y });

/* ------------------------------------------------------------------ */
/*  arcLength                                                          */
/* ------------------------------------------------------------------ */

describe('arcLength', () => {
  it('returns 0 for a single point', () => {
    expect(arcLength([p(0, 0)])).toBe(0);
  });

  it('computes Euclidean distance for two points', () => {
    expect(arcLength([p(0, 0), p(3, 4)])).toBe(5);
  });

  it('sums multiple segments', () => {
    // (0,0)→(3,0)→(3,4) = 3 + 4 = 7
    expect(arcLength([p(0, 0), p(3, 0), p(3, 4)])).toBe(7);
  });
});

/* ------------------------------------------------------------------ */
/*  rdpSimplify                                                        */
/* ------------------------------------------------------------------ */

describe('rdpSimplify', () => {
  it('returns same array for ≤ 2 points', () => {
    expect(rdpSimplify([], 0.5)).toEqual([]);
    expect(rdpSimplify([p(1, 2)], 0.5)).toEqual([p(1, 2)]);
    expect(rdpSimplify([p(1, 2), p(3, 4)], 0.5)).toEqual([p(1, 2), p(3, 4)]);
  });

  it('collapses collinear points on a straight line', () => {
    const pts = [p(0, 0), p(1, 0.01), p(2, -0.01), p(3, 0)];
    const simplified = rdpSimplify(pts, 0.5);
    expect(simplified.length).toBe(2);
    expect(simplified[0]).toEqual(p(0, 0));
    expect(simplified[1]).toEqual(p(3, 0));
  });

  it('preserves points that deviate beyond epsilon', () => {
    // A clear V shape — the middle point should be kept
    const pts = [p(0, 0), p(50, 50), p(100, 0)];
    const simplified = rdpSimplify(pts, 5);
    expect(simplified.length).toBe(3);
  });

  it('removes points below epsilon threshold', () => {
    // Tiny deviation — middle point should be dropped
    const pts = [p(0, 0), p(50, 0.1), p(100, 0)];
    const simplified = rdpSimplify(pts, 1);
    expect(simplified.length).toBe(2);
  });

  it('preserves first and last point', () => {
    const pts = Array.from({ length: 20 }, (_, i) => p(i * 2, Math.sin(i * 0.5) * 3));
    const simplified = rdpSimplify(pts, 0.5);
    expect(simplified[0]).toEqual(pts[0]);
    expect(simplified[simplified.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

/* ------------------------------------------------------------------ */
/*  resampleToCount                                                    */
/* ------------------------------------------------------------------ */

describe('resampleToCount', () => {
  it('returns single point for count ≤ 1 or empty input', () => {
    expect(resampleToCount([], 10)).toEqual([]);
    expect(resampleToCount([p(5, 5)], 10)).toEqual([p(5, 5)]);
    expect(resampleToCount([p(0, 0), p(10, 0)], 1)).toEqual([p(0, 0)]);
  });

  it('returns endpoints when count is 2', () => {
    const pts = [p(0, 0), p(5, 5), p(10, 10), p(15, 15)];
    const resampled = resampleToCount(pts, 2);
    expect(resampled).toEqual([p(0, 0), p(15, 15)]);
  });

  it('returns correct number of points', () => {
    const pts = [p(0, 0), p(100, 0)];
    const resampled = resampleToCount(pts, 10);
    expect(resampled.length).toBe(10);
  });

  it('evenly spaces points along a horizontal line', () => {
    const pts = [p(0, 0), p(100, 0)];
    const resampled = resampleToCount(pts, 6);
    expect(resampled[0]).toEqual(p(0, 0));
    expect(resampled[5]).toEqual(p(100, 0));
    for (let i = 1; i < 5; i++) {
      expect(resampled[i].x).toBeCloseTo(i * 20, 5);
      expect(resampled[i].y).toBe(0);
    }
  });

  it('preserves first and last points', () => {
    const pts = Array.from({ length: 50 }, (_, i) => p(i * 3, Math.random() * 10));
    const resampled = resampleToCount(pts, 20);
    expect(resampled[0]).toEqual(pts[0]);
    expect(resampled[resampled.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('handles count larger than input length', () => {
    const pts = [p(0, 0), p(10, 10), p(20, 0)];
    const resampled = resampleToCount(pts, 10);
    expect(resampled.length).toBe(10);
  });
});

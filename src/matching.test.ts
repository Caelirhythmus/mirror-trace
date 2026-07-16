import { describe, it, expect } from 'vitest';
import { findSegment, nearestIndex } from './matching';
import type { Point } from './types';

const p = (x: number, y: number): Point => ({ x, y });

describe('nearestIndex', () => {
  it('returns 0 for empty path', () => {
    expect(nearestIndex([], p(10, 10))).toBe(0);
  });

  it('finds the closest point index', () => {
    const path = [p(0, 0), p(10, 0), p(20, 0)];
    expect(nearestIndex(path, p(9, 0))).toBe(1);
    expect(nearestIndex(path, p(21, 0))).toBe(2);
    expect(nearestIndex(path, p(-5, 0))).toBe(0);
  });
});

describe('findSegment', () => {
  /** 11 points: (0,0), (10,0), …, (100,0) */
  const refPath = Array.from({ length: 11 }, (_, i) => p(i * 10, 0));

  it('returns full refPath when stroke has < 2 points', () => {
    const result = findSegment(refPath, [p(5, 0)]);
    expect(result.startIdx).toBe(0);
    expect(result.endIdx).toBe(10);
    expect(result.subPath.length).toBe(11);
  });

  it('matches the correct segment for a left→right stroke', () => {
    // (12,2) nearest to ref[1]=(10,0), (48,1) nearest to ref[5]=(50,0)
    const stroke = [p(12, 2), p(20, 1), p(30, -1), p(40, 0), p(48, 1)];
    const result = findSegment(refPath, stroke);
    expect(result.startIdx).toBe(1);
    expect(result.endIdx).toBe(5);
    expect(result.subPath.length).toBe(5); // indices 1..5 → 5 points
  });

  it('handles right→left strokes by swapping indices', () => {
    const stroke = [p(85, 0), p(75, 2), p(50, 1), p(25, -1), p(15, 0)];
    const result = findSegment(refPath, stroke);
    expect(result.startIdx).toBeLessThanOrEqual(result.endIdx);
    // (85,0) nearest to ref[8] or ref[9], (15,0) nearest to ref[1] or ref[2]
    // After swap: start ≤ end
    expect(result.subPath.length).toBeGreaterThanOrEqual(5);
  });

  it('expands short spans to meet minSpan', () => {
    // stroke near ref[2]=(20,0) only — less than 5 points
    const stroke = [p(21, 0), p(22, 0), p(23, 0)];
    const result = findSegment(refPath, stroke, 5);
    expect(result.endIdx - result.startIdx + 1).toBe(5);
    expect(result.subPath.length).toBe(5);
  });
});

import { describe, it, expect } from 'vitest';
import { generateRandomCurve, generateArchCurve, generateRandomArchCurve, generateRotatedArch, generateMultiLines, generateStraightLine, rotatePoints, translateToFit } from './generator';

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
    // At least 75% of consecutive points should have non-decreasing x
    expect(increasingCount / (pts.length - 1)).toBeGreaterThan(0.75);
  });

  it('respects the numSegments parameter', () => {
    // A 1-segment curve is just one cubic bezier → very few points
    // A 10-segment curve should have many more points
    const few = generateRandomCurve(500, 400, 40, 1);
    const many = generateRandomCurve(500, 400, 40, 10);
    expect(many.length).toBeGreaterThan(few.length);
  });
});

/* ------------------------------------------------------------------ */
/*  Arch-curve tests                                                   */
/* ------------------------------------------------------------------ */

describe('generateArchCurve', () => {
  it('returns a straight (collinear) line when curvature = 0', () => {
    const pts = generateArchCurve(500, 400, 0, 40, 0.01);
    expect(pts.length).toBeGreaterThan(50);
    // All points must be collinear (curvature = 0 ⇒ degenerate cubic)
    const first = pts[0], last = pts[pts.length - 1];
    const dx = last.x - first.x, dy = last.y - first.y;
    const lineLen = Math.hypot(dx, dy);
    let maxDist = 0;
    for (const p of pts) {
      // Perpendicular distance from point p to the baseline first–last
      const t = ((p.x - first.x) * dx + (p.y - first.y) * dy) / (lineLen * lineLen || 1);
      const projX = first.x + t * dx;
      const projY = first.y + t * dy;
      maxDist = Math.max(maxDist, Math.hypot(p.x - projX, p.y - projY));
    }
    expect(maxDist).toBeLessThan(0.5);
  });

  it('arch goes upward when curvature > 0', () => {
    const pts = generateArchCurve(500, 400, 0.2, 40, 0.01);
    const last = pts.length - 1;
    const midIdx = Math.floor(pts.length / 2);
    // Midpoint should be higher (lower y) than both endpoints
    expect(pts[midIdx].y).toBeLessThan(pts[0].y);
    expect(pts[midIdx].y).toBeLessThan(pts[last].y);
  });

  it('arch goes downward when curvature < 0', () => {
    const pts = generateArchCurve(500, 400, -0.2, 40, 0.01);
    const last = pts.length - 1;
    const midIdx = Math.floor(pts.length / 2);
    expect(pts[midIdx].y).toBeGreaterThan(pts[0].y);
    expect(pts[midIdx].y).toBeGreaterThan(pts[last].y);
  });

  it('keeps points within canvas bounds', () => {
    const pts = generateArchCurve(500, 400, 0.2, 30);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(500);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
  });

  it('x is strictly increasing (left→right traceable)', () => {
    const pts = generateArchCurve(500, 400, 0.15);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    }
  });

  it('generateRandomArchCurve produces varied directions', () => {
    // Call many times and check that at least one goes up and one goes down
    let seenUp = false, seenDown = false;
    for (let i = 0; i < 20; i++) {
      const pts = generateRandomArchCurve(500, 400);
      const midIdx = Math.floor(pts.length / 2);
      if (pts[midIdx].y < pts[0].y) seenUp = true;   // arch up
      if (pts[midIdx].y > pts[0].y) seenDown = true; // arch down
    }
    expect(seenUp).toBe(true);
    expect(seenDown).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Multi-line tests                                                    */
/* ------------------------------------------------------------------ */

describe('generateMultiLines', () => {
  it('returns correct number of lines', () => {
    const result = generateMultiLines(500, 400, 2, 2, 1);
    expect(result.lines.length).toBe(5);
  });

  it('each line has at least 2 points', () => {
    const result = generateMultiLines(500, 400, 1, 1, 1);
    for (const line of result.lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('clamps each count to 0–20', () => {
    const result0 = generateMultiLines(500, 400, 0, 0, 0);
    expect(result0.lines.length).toBe(0);
    const resultBig = generateMultiLines(500, 400, 99, 0, 0);
    expect(resultBig.lines.length).toBe(20);
  });
});

describe('generateStraightLine', () => {
  it('x is strictly increasing', () => {
    const pts = generateStraightLine(500, 400);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    }
  });

  it('points are collinear', () => {
    const pts = generateStraightLine(500, 400, 40, 0.01);
    const first = pts[0], last = pts[pts.length - 1];
    const dx = last.x - first.x, dy = last.y - first.y;
    const lenSq = dx * dx + dy * dy;
    let maxDist = 0;
    for (const p of pts) {
      const t = ((p.x - first.x) * dx + (p.y - first.y) * dy) / (lenSq || 1);
      const px = first.x + t * dx, py = first.y + t * dy;
      maxDist = Math.max(maxDist, Math.hypot(p.x - px, p.y - py));
    }
    expect(maxDist).toBeLessThan(0.5);
  });
});

/* ------------------------------------------------------------------ */
/*  Rotation tests                                                     */
/* ------------------------------------------------------------------ */

describe('rotatePoints', () => {
  it('0° rotation returns same points', () => {
    const pts = [{ x: 10, y: 0 }, { x: 0, y: 10 }];
    const rotated = rotatePoints(pts, 0, 0, 0);
    expect(rotated[0].x).toBeCloseTo(10, 5);
    expect(rotated[0].y).toBeCloseTo(0, 5);
    expect(rotated[1].x).toBeCloseTo(0, 5);
    expect(rotated[1].y).toBeCloseTo(10, 5);
  });

  it('90° rotation about origin', () => {
    const pts = [{ x: 10, y: 0 }];
    const rotated = rotatePoints(pts, 90, 0, 0);
    expect(rotated[0].x).toBeCloseTo(0, 5);
    expect(rotated[0].y).toBeCloseTo(10, 5);
  });

  it('180° rotation about a non-origin centre', () => {
    const pts = [{ x: 20, y: 10 }];
    const rotated = rotatePoints(pts, 180, 10, 10);
    expect(rotated[0].x).toBeCloseTo(0, 5);
    expect(rotated[0].y).toBeCloseTo(10, 5);
  });

  it('preserves point count', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }));
    const rotated = rotatePoints(pts, 45, 25, 25);
    expect(rotated.length).toBe(50);
  });
});

/* ------------------------------------------------------------------ */
/*  translateToFit tests                                               */
/* ------------------------------------------------------------------ */

describe('translateToFit', () => {
  it('brings out-of-bounds points inside the canvas', () => {
    // A line that extends far beyond the canvas
    const pts = [{ x: -100, y: 50 }, { x: 600, y: 50 }];
    const fitted = translateToFit(pts, 500, 400, 40);
    for (const p of fitted) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(500);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
  });

  it('keeps points within margin when possible', () => {
    const pts = [{ x: -100, y: 50 }, { x: 600, y: 50 }];
    const fitted = translateToFit(pts, 500, 400, 40);
    for (const p of fitted) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(500);
    }
  });

  it('preserves the original shape (relative positions)', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const fitted = translateToFit(pts, 500, 400, 40);
    // Side lengths should be preserved (no scaling needed)
    const d1 = Math.hypot(fitted[1].x - fitted[0].x, fitted[1].y - fitted[0].y);
    const d2 = Math.hypot(fitted[2].x - fitted[1].x, fitted[2].y - fitted[1].y);
    expect(d1).toBeCloseTo(100, 1);
    expect(d2).toBeCloseTo(100, 1);
  });

  it('handles empty arrays', () => {
    expect(translateToFit([], 500, 400)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Rotated arch bounds test                                           */
/* ------------------------------------------------------------------ */

describe('generateRotatedArch', () => {
  it('keeps all points within canvas bounds for many random seeds', () => {
    for (let i = 0; i < 50; i++) {
      const pts = generateRotatedArch(500, 400, 40);
      expect(pts.length).toBeGreaterThan(10);
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(500);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(400);
      }
    }
  });
});

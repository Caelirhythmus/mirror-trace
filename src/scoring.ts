/**
 * Mirror Trace — 路径相似度评分模块
 *
 * 混合加权评分（满分 100）：
 *   Spatial  (65%) = Procrustes(60%) + Hausdorff95(40%)
 *   Time     (35%) = 负指数衰减（只扣慢不扣快）
 *
 * @see 1-docs/design.md §四
 */

import { Point } from './types';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ScoreResult {
  /** 空间相似度分 (0–100) */
  spatialScore: number;
  /** 时间消耗分 (0–100) */
  timeScore: number;
  /** 最终总分 (0–100) */
  finalScore: number;

  /** 原始 95% 豪斯多夫距离 (CSS px) */
  hausdorff95Dist: number;
  /** 普鲁克平移后 RMS 距离 (CSS px) */
  rmsDist: number;
  /** 实际用时 (ms) */
  elapsedMs: number;
  /** 理想用时 (ms) */
  idealMs: number;
}

/* ------------------------------------------------------------------ */
/*  Tunable parameters                                                 */
/* ------------------------------------------------------------------ */

const V_IDEAL = 160; // px/s — 最佳临摹速度

// 时间负指数衰减系数 — 值越大，超时扣分越狠
const TIME_DECAY_K = 2.0;

/* ------------------------------------------------------------------ */
/*  Scoring                                                            */
/* ------------------------------------------------------------------ */

/**
 * 对一条用户路径进行完整评分。
 *
 * @param ref      参考路径（经 generator 采样后的等距点）
 * @param user     用户路径（经 RDP + resampleToCount 处理）
 * @param elapsedMs实际绘画耗时 (ms)
 */
export function computeScores(
  ref: readonly Point[],
  user: readonly Point[],
  elapsedMs: number,
): ScoreResult {
  /* ---- 1. 空间相似度 ---- */
  const h95 = hausdorff95(ref, user);

  /* Procrustes is index-by-index, so a stroke drawn from the opposite
     end would get a bad RMS despite being geometrically identical.
     Compute in both directions and take the better match. */
  const userRev = [...user].reverse();
  const { rms: rmsFwd } = procrustesTranslate(ref, user);
  const { rms: rmsRev } = procrustesTranslate(ref, userRev);
  const rms = Math.min(rmsFwd, rmsRev);

  /* Scale thresholds by reference path length so longer curves get
     proportionate tolerance.  The minimum floor prevents degenerate
     paths from being unfairly strict. */
  const refLen = arcLength(ref);
  const hausdorffMax = Math.max(20, refLen * 0.15);
  const rmsMax = Math.max(15, refLen * 0.10);

  const hausdorffScore = distToScore(h95, hausdorffMax);
  const rmsScore = distToScore(rms, rmsMax);

  const spatialScore = rmsScore * 0.6 + hausdorffScore * 0.4;

  /* ---- 2. 时间消耗分 ---- */
  const idealMs = (refLen / V_IDEAL) * 1000;
  const timeScore = computeTimeScore(elapsedMs, idealMs);

  /* ---- 3. 总分 ---- */
  const finalScore = spatialScore * 0.65 + timeScore * 0.35;

  return {
    spatialScore: round1(spatialScore),
    timeScore: round1(timeScore),
    finalScore: round1(finalScore),
    hausdorff95Dist: round1(h95),
    rmsDist: round1(rms),
    elapsedMs,
    idealMs: Math.round(idealMs),
  };
}

/* ------------------------------------------------------------------ */
/*  KD-Tree (2D) for nearest-neighbour search                         */
/* ------------------------------------------------------------------ */

interface KDNode {
  p: Point;
  axis: 0 | 1;
  left: KDNode | null;
  right: KDNode | null;
}

/** Build a KD-Tree from an array of points (clones the slice). */
function buildKDTree(pts: readonly Point[]): KDNode | null {
  if (pts.length === 0) return null;
  return build(pts.slice(), 0); // clone so sorting doesn't mutate input
}

function build(pts: Point[], depth: number): KDNode | null {
  if (pts.length === 0) return null;
  const axis = (depth % 2) as 0 | 1;
  pts.sort((a, b) => axis === 0 ? a.x - b.x : a.y - b.y);
  const mid = Math.floor(pts.length / 2);
  return {
    p: pts[mid],
    axis,
    left: build(pts.slice(0, mid), depth + 1),
    right: build(pts.slice(mid + 1), depth + 1),
  };
}

/** Squared distance between two points (avoids sqrt during search). */
function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Find the nearest point in the KD-Tree to `target`. */
function nearest(node: KDNode | null, target: Point, best: { dSq: number; pt: Point }): void {
  if (!node) return;

  const d = distSq(target, node.p);
  if (d < best.dSq) {
    best.dSq = d;
    best.pt = node.p;
  }

  const axis = node.axis;
  const diff = axis === 0 ? target.x - node.p.x : target.y - node.p.y;
  const first = diff <= 0 ? node.left : node.right;
  const second = diff <= 0 ? node.right : node.left;

  nearest(first, target, best);
  if (diff * diff < best.dSq) {
    nearest(second, target, best);
  }
}

/* ------------------------------------------------------------------ */
/*  95% 豪斯多夫距离（KD-Tree 加速）                                    */
/* ------------------------------------------------------------------ */

function hausdorff95(A: readonly Point[], B: readonly Point[]): number {
  const dAB = directionalH95(A, B);
  const dBA = directionalH95(B, A);
  return Math.max(dAB, dBA);
}

/** 单向 95%：点集 A 中每个点到 B 的最近距离（KD-Tree 加速），取 95% 分位 */
function directionalH95(A: readonly Point[], B: readonly Point[]): number {
  if (A.length === 0 || B.length === 0) return 0;

  const tree = buildKDTree(B);

  const dists: number[] = [];
  for (const a of A) {
    const best = { dSq: Infinity, pt: B[0] };
    nearest(tree, a, best);
    dists.push(Math.sqrt(best.dSq));
  }

  dists.sort((a, b) => a - b); // 升序
  const idx = Math.ceil(dists.length * 0.95) - 1;
  return idx >= 0 ? dists[idx] : 0;
}

/* ------------------------------------------------------------------ */
/*  普鲁克分析（仅平移）                                                */
/* ------------------------------------------------------------------ */

function procrustesTranslate(
  ref: readonly Point[],
  user: readonly Point[],
): { rms: number } {
  const n = Math.min(ref.length, user.length);
  if (n === 0) return { rms: 0 };

  const cRef = centroid(ref);
  const cUser = centroid(user);
  const tx = cRef.x - cUser.x;
  const ty = cRef.y - cUser.y;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const ux = user[i].x + tx;
    const uy = user[i].y + ty;
    const dx = ux - ref[i].x;
    const dy = uy - ref[i].y;
    sumSq += dx * dx + dy * dy;
  }

  return { rms: Math.sqrt(sumSq / n) };
}

/* ------------------------------------------------------------------ */
/*  时间分（负指数衰减）                                                */
/* ------------------------------------------------------------------ */

function computeTimeScore(elapsedMs: number, idealMs: number): number {
  if (idealMs <= 0) return 100;
  if (elapsedMs <= idealMs) return 100; // 更快不扣分

  const ratio = elapsedMs / idealMs;
  return 100 * Math.exp(-TIME_DECAY_K * (ratio - 1));
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

/** 弧长 */
function arcLength(pts: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/** 质心 */
function centroid(pts: readonly Point[]): Point {
  let cx = 0, cy = 0;
  const n = pts.length;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / n, y: cy / n };
}

/** 距离 → 0–100 线性分（归零阈值 D_MAX） */
function distToScore(dist: number, dMax: number): number {
  if (dist >= dMax) return 0;
  return 100 * (1 - dist / dMax);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

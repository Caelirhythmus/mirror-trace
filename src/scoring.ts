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

const V_IDEAL = 160; // px/s — 最佳临摹速度（调高一倍增加挑战性）

// 距离→分数映射：线性下降至 D_MAX 时归零
const HAUSDORFF_D_MAX = 60; // px
const RMS_D_MAX = 40; // px

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
  const { rms } = procrustesTranslate(ref, user);

  const hausdorffScore = distToScore(h95, HAUSDORFF_D_MAX);
  const rmsScore = distToScore(rms, RMS_D_MAX);

  const spatialScore = rmsScore * 0.6 + hausdorffScore * 0.4;

  /* ---- 2. 时间消耗分 ---- */
  const refLen = arcLength(ref);
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
/*  95% 豪斯多夫距离                                                   */
/* ------------------------------------------------------------------ */

function hausdorff95(A: readonly Point[], B: readonly Point[]): number {
  const dAB = directionalH95(A, B);
  const dBA = directionalH95(B, A);
  return Math.max(dAB, dBA);
}

/** 单向 95%：点集 A 中每个点到 B 的最近距离，取 95% 分位 */
function directionalH95(A: readonly Point[], B: readonly Point[]): number {
  if (A.length === 0 || B.length === 0) return 0;

  const dists: number[] = [];
  for (const a of A) {
    let best = Infinity;
    for (const b of B) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < best) best = d;
    }
    dists.push(best);
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

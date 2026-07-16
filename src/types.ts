export interface Point {
  x: number;
  y: number;
}

/** Configuration for the arch curve used in single-stroke mode */
export interface ArchConfig {
  /** Relative curvature: 0 = straight, 0.15 = 15 % of canvas height, default 0.15 */
  curvature: number;
  /** Minimum curvature for random generation */
  minCurvature: number;
  /** Maximum curvature for random generation */
  maxCurvature: number;
}


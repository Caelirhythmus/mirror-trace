export interface Point {
  x: number;
  y: number;
}

/* Virtual canvas coordinate space — curves are generated in this fixed
   size and scaled to fit the actual canvas via context transform. */
export const VIRTUAL_W = 800;
export const VIRTUAL_H = 600;

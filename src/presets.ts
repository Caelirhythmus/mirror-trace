/**
 * Configuration presets for MirrorTraceApp
 *
 * Built-in presets that set mode + line counts in a single selection.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Preset {
  id: string;
  name: string;
  hellMode: boolean;
  /** For hell mode: [straight, arch, complex]; for multi mode: [straight, rest] */
  counts: number[];
}

/* ------------------------------------------------------------------ */
/*  Built-in presets                                                   */
/* ------------------------------------------------------------------ */

export const BUILT_IN_PRESETS: Preset[] = [
  { id: 'hell-4-3-2', name: '地狱 4-3-2', hellMode: true, counts: [4, 3, 2] },
  { id: 'hell-2-2-2', name: '地狱 2-2-2', hellMode: true, counts: [2, 2, 2] },
  { id: 'hell-1-1-2', name: '地狱 1-1-2', hellMode: true, counts: [1, 1, 2] },
  { id: 'hell-0-0-2', name: '地狱 0-0-2', hellMode: true, counts: [0, 0, 2] },
  { id: 'multi-3+2',  name: '多线 3+2',   hellMode: false, counts: [3, 2] },
  { id: 'multi-1+1',  name: '多线 1+1',   hellMode: false, counts: [1, 1] },
  { id: 'quick-2',    name: '多线 0+2',  hellMode: false, counts: [0, 2] },
];

/* ------------------------------------------------------------------ */
/*  Lookup                                                             */
/* ------------------------------------------------------------------ */

export function findPreset(id: string): Preset | undefined {
  return BUILT_IN_PRESETS.find(p => p.id === id);
}

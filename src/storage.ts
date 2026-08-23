/* ------------------------------------------------------------------ */
/*  Persistent history storage (localStorage)                         */
/* ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: string;
  timestamp: number;
  finalScore: number;
  spatialScore: number;
  timeScore: number;
  elapsedMs: number;
  idealMs: number;
  hausdorff95Dist: number;
  rmsDist: number;
  /** Mode label: 概括 | 单笔 | 多条 | 地狱 */
  mode?: string;
  /** Human-readable line configuration, e.g. "2+3" or "2+2+1" */
  lineConfig?: string;
}

const STORAGE_KEY = 'mirror-trace-history';
const MAX_ENTRIES = 12;

/* ------------------------------------------------------------------ */
/*  Validation                                                          */
/* ------------------------------------------------------------------ */

/** Entry shape check — guards against corrupted or legacy localStorage
    data (a bad entry would otherwise poison the chart with NaNs or
    make saveEntry throw on a non-array payload). */
function isValidEntry(e: unknown): e is HistoryEntry {
  if (typeof e !== 'object' || e === null) return false;
  const rec = e as Record<string, unknown>;
  return typeof rec.finalScore === 'number'
    && typeof rec.timestamp === 'number';
}

/* ------------------------------------------------------------------ */
/*  Public API                                                          */
/* ------------------------------------------------------------------ */

/** Load all stored history entries (newest last). */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

/** Append one entry and persist. */
export function saveEntry(entry: HistoryEntry): void {
  const history = loadHistory();
  history.push(entry);
  // Trim oldest if over limit
  if (history.length > MAX_ENTRIES) {
    history.splice(0, history.length - MAX_ENTRIES);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Delete every stored entry. */
export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

/** Generate a short unique id for an entry. */
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

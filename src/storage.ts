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
}

const STORAGE_KEY = 'mirror-trace-history';
const MAX_ENTRIES = 100;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Load all stored history entries (newest last). */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
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

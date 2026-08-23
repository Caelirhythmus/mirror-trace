// @vitest-environment happy-dom
/**
 * Unit tests for the localStorage history store — mainly the data
 * validation added so corrupted storage can't poison the chart or
 * make saveEntry throw.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadHistory, saveEntry, clearHistory, HistoryEntry } from './storage';

const KEY = 'mirror-trace-history';

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'test',
    timestamp: Date.now(),
    finalScore: 90,
    spatialScore: 90,
    timeScore: 90,
    elapsedMs: 1000,
    idealMs: 1000,
    hausdorff95Dist: 5,
    rmsDist: 4,
    ...overrides,
  };
}

describe('storage — localStorage 校验 (M5)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无数据时返回空数组', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('JSON 损坏时返回空数组', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadHistory()).toEqual([]);
  });

  it('非数组 JSON 返回空数组，且 saveEntry 不会抛异常', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(loadHistory()).toEqual([]);
    expect(() => saveEntry(makeEntry())).not.toThrow();
    expect(loadHistory().length).toBe(1);
  });

  it('过滤掉缺少关键字段的损坏条目', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { foo: 1 },                        // 不是条目
      'junk',                            // 字符串
      null,                              // null
      { id: 'no-score', timestamp: 1 },  // 缺 finalScore
      makeEntry({ id: 'ok', finalScore: 80 }),
    ]));
    const h = loadHistory();
    expect(h.length).toBe(1);
    expect(h[0].id).toBe('ok');
  });

  it('追加条目并在超过 12 条时裁剪最旧的', () => {
    for (let i = 0; i < 15; i++) {
      saveEntry(makeEntry({ id: `e${i}`, timestamp: i }));
    }
    const h = loadHistory();
    expect(h.length).toBe(12);
    expect(h[0].id).toBe('e3');
    expect(h[11].id).toBe('e14');
  });

  it('clearHistory 清空全部记录', () => {
    saveEntry(makeEntry());
    saveEntry(makeEntry({ id: 'e2' }));
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});

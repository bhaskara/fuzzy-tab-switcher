// Tests for segment building in src/core/highlight.js.

import { describe, expect, it } from 'vitest';

import { toSegments } from '../src/core/highlight.js';

/** Segments rendered as a string, matched runs bracketed, for readable asserts. */
function shown(text, indices) {
  return toSegments(text, indices)
    .map((s) => (s.matched ? `[${s.text}]` : s.text))
    .join('');
}

describe('toSegments', () => {
  it('brackets the matched characters', () => {
    expect(shown('github', [0, 1])).toBe('[gi]thub');
  });

  it('merges consecutive matches into one segment', () => {
    expect(toSegments('github', [0, 1, 2])).toEqual([
      { text: 'git', matched: true },
      { text: 'hub', matched: false },
    ]);
  });

  it('splits non-consecutive matches', () => {
    expect(shown('github', [0, 3])).toBe('[g]it[h]ub');
  });

  it('handles a match at the very end', () => {
    expect(shown('git', [2])).toBe('gi[t]');
  });

  it('returns one unmatched segment when nothing matched', () => {
    expect(toSegments('git', [])).toEqual([{ text: 'git', matched: false }]);
    expect(toSegments('git', null)).toEqual([{ text: 'git', matched: false }]);
  });

  it('returns nothing for empty text', () => {
    expect(toSegments('', [0])).toEqual([]);
  });

  it('tolerates unsorted, duplicated and out-of-range indices', () => {
    expect(shown('git', [2, 0, 0, 99, -1])).toBe('[g]i[t]');
  });

  it('reassembles into the original text', () => {
    const text = 'https://github.com/torvalds';
    const rebuilt = toSegments(text, [0, 5, 6, 20]).map((s) => s.text).join('');
    expect(rebuilt).toBe(text);
  });

  it('never emits an empty segment', () => {
    expect(toSegments('github', [0, 2, 5]).every((s) => s.text.length > 0)).toBe(true);
  });
});

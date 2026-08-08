// Tests for the fuzzy scorer in src/core/fuzzy.js.
//
// Absolute scores are an implementation detail, so these assert on the things
// callers actually depend on: whether something matched, the *relative* order
// of two candidates, and which characters the highlight will land on.

import { describe, expect, it } from 'vitest';

import { positions, score } from '../src/core/fuzzy.js';

/** Whether `query` scores better against `better` than against `worse`. */
function prefers(query, better, worse) {
  const a = score(query, better);
  const b = score(query, worse);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  return a > b;
}

describe('score', () => {
  it('matches a query that appears as a subsequence', () => {
    expect(score('gh', 'github.com')).not.toBeNull();
    expect(score('ghb', 'github.com')).not.toBeNull();
  });

  it('rejects a query whose characters are out of order', () => {
    expect(score('hg', 'github.com')).toBeNull();
  });

  it('rejects a query with a character the text lacks', () => {
    expect(score('gz', 'github.com')).toBeNull();
  });

  it('rejects a query longer than the text', () => {
    expect(score('github', 'git')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(score('GH', 'github.com')).not.toBeNull();
    expect(score('gh', 'GitHub')).not.toBeNull();
  });

  it('reports no match for an empty query, leaving that case to the caller', () => {
    expect(score('', 'anything')).toBeNull();
  });

  it('scores a whole-string match above every partial match', () => {
    expect(score('git', 'git')).toBe(Infinity);
    expect(score('git', 'git')).toBeGreaterThan(score('git', 'github'));
  });

  it('prefers consecutive characters to scattered ones', () => {
    expect(prefers('abc', 'abc-xx', 'a-b-c-x')).toBe(true);
  });

  it('prefers a match at a word boundary', () => {
    expect(prefers('rd', 'read docs', 'random')).toBe(true);
  });

  it('prefers a match after a path separator', () => {
    expect(prefers('ab', 'x/a/b', 'xaxb')).toBe(true);
  });

  it('prefers a camelCase hump to a mid-word character', () => {
    expect(prefers('ab', 'xAxB', 'xaxb')).toBe(true);
  });

  it('prefers a match near the start of the text', () => {
    expect(prefers('ab', 'ab-zzzzzzzz', 'zzzzzzzz-ab')).toBe(true);
  });

  it('barely penalises trailing text, so a long title is not buried by its length', () => {
    // The two align identically and differ only in what follows the match, so
    // the whole gap between them is the trailing penalty. Over a long but
    // realistic page title it stays worth less than a single positional bonus,
    // which is what keeps alignment quality — not length — deciding the order.
    const short = score('gh', 'github');
    const long = score('gh', `github${'x'.repeat(60)}`);
    expect(short).toBeGreaterThan(long);
    expect(short - long).toBeLessThan(0.5);
  });

  it('prefers a consecutive match to a better-placed scattered one', () => {
    // `gh` is consecutive in the second but split across a word in the first,
    // and consecutiveness outweighs the first's earlier start.
    expect(prefers('gh', 'ghost', 'github')).toBe(true);
  });

  it('scores very long text without blowing up', () => {
    const long = `${'x'.repeat(5000)}query`;
    // Beyond the truncation limit the tail is unreachable, hence no match.
    expect(score('query', long)).toBeNull();
    expect(score('x', long)).not.toBeNull();
  });
});

describe('positions', () => {
  /** The characters `positions` selected, as a string, for readable asserts. */
  function matched(query, text) {
    const idx = positions(query, text);
    return idx === null ? null : idx.map((i) => text[i]).join('');
  }

  it('returns one ascending index per query character', () => {
    const idx = positions('ghb', 'github.com');
    expect(idx).toHaveLength(3);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(new Set(idx).size).toBe(3);
  });

  it('selects characters that spell the query', () => {
    expect(matched('ghb', 'github.com')).toBe('ghb');
    expect(matched('gh', 'GitHub')).toBe('GH');
  });

  it('picks the alignment the score was based on, not the leftmost one', () => {
    // Both `d` characters could match, but the one after the space is the
    // word-boundary match that scores best, so that is what gets highlighted.
    expect(positions('d', 'red door')).toEqual([4]);
  });

  it('agrees with score about whether there is a match', () => {
    for (const [query, text] of [
      ['gh', 'github.com'],
      ['hg', 'github.com'],
      ['', 'github.com'],
      ['toolong', 'short'],
      ['git', 'git'],
    ]) {
      expect(positions(query, text) === null).toBe(score(query, text) === null);
    }
  });

  it('covers the whole text for a whole-string match', () => {
    expect(positions('git', 'GIT')).toEqual([0, 1, 2]);
  });
});

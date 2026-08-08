// Tests for settings validation in src/core/settings.js.
//
// Storage is untrusted input: it survives upgrades that change this shape, it
// can be edited by hand, and it is empty on first run. The contract is that
// anything at all coming out of it yields usable settings, so most of these
// tests are about garbage rather than about valid input.

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, MAX_HISTORY_LIMIT, normalizeSettings } from '../src/core/settings.js';

describe('normalizeSettings', () => {
  it('returns the defaults on a first run, when nothing is stored', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults history to 3000 entries', () => {
    expect(DEFAULT_SETTINGS.historyLimit).toBe(3000);
  });

  it('keeps valid settings unchanged', () => {
    const settings = {
      sources: { tabs: true, bookmarks: false, closed: true, history: false },
      historyLimit: 1500,
    };
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it('fills in a source the stored object does not mention', () => {
    // An upgrade that adds a source must not leave it undefined, which would
    // read as disabled and silently drop it from search.
    const result = normalizeSettings({ sources: { tabs: false } });
    expect(result.sources.tabs).toBe(false);
    expect(result.sources.history).toBe(DEFAULT_SETTINGS.sources.history);
  });

  it.each([
    ['a string', 'nonsense'],
    ['null', null],
    ['a number', 42],
    ['an array', []],
  ])('falls back to the defaults given %s', (_name, raw) => {
    expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it.each([
    ['a string', 'yes'],
    ['a number', 1],
    ['null', null],
  ])('ignores a source flag that is %s', (_name, value) => {
    expect(normalizeSettings({ sources: { tabs: value } }).sources.tabs).toBe(
      DEFAULT_SETTINGS.sources.tabs,
    );
  });

  it('clamps a history limit above the maximum', () => {
    expect(normalizeSettings({ historyLimit: 10_000_000 }).historyLimit).toBe(MAX_HISTORY_LIMIT);
  });

  it('clamps a negative history limit to zero', () => {
    expect(normalizeSettings({ historyLimit: -5 }).historyLimit).toBe(0);
  });

  it('allows zero, which reads no history at all', () => {
    expect(normalizeSettings({ historyLimit: 0 }).historyLimit).toBe(0);
  });

  it('rounds a fractional history limit to an integer', () => {
    expect(normalizeSettings({ historyLimit: 1500.7 }).historyLimit).toBe(1501);
  });

  it.each([
    ['a string', '2000'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
  ])('falls back to the default history limit given %s', (_name, value) => {
    expect(normalizeSettings({ historyLimit: value }).historyLimit).toBe(
      DEFAULT_SETTINGS.historyLimit,
    );
  });

  it('drops keys it does not know about', () => {
    const result = normalizeSettings({ historyLimit: 100, somethingElse: 'x' });
    expect(Object.keys(result).toSorted()).toEqual(['historyLimit', 'sources']);
  });

  it('returns a frozen object, so no caller can corrupt shared settings', () => {
    const result = normalizeSettings({});
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
  });

  it('is idempotent, so saving what was loaded changes nothing', () => {
    const once = normalizeSettings({ historyLimit: 99_999, sources: { tabs: 'bad' } });
    expect(normalizeSettings(once)).toEqual(once);
  });
});

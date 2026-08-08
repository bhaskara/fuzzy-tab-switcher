// Tests for the SearchItem model in src/core/items.js.

import { describe, expect, it } from 'vitest';

import { KIND_TAB, byRecencyDesc, tabToItem } from '../src/core/items.js';

/** A minimal valid `chrome.tabs.Tab`-shaped literal, overridable per test. */
function rawTab(overrides = {}) {
  return {
    id: 7,
    windowId: 2,
    index: 3,
    title: 'Example',
    url: 'https://example.com/',
    lastAccessed: 1000,
    ...overrides,
  };
}

describe('tabToItem', () => {
  it('copies the identifying fields a tab needs to be acted on', () => {
    expect(tabToItem(rawTab())).toEqual({
      kind: KIND_TAB,
      key: 'tab:7',
      title: 'Example',
      url: 'https://example.com/',
      lastUsed: 1000,
      tabId: 7,
      windowId: 2,
      tabIndex: 3,
    });
  });

  it('normalizes a loading tab with no title or url to empty strings', () => {
    const item = tabToItem(rawTab({ title: undefined, url: undefined }));
    expect(item.title).toBe('');
    expect(item.url).toBe('');
  });

  it('treats a Chrome too old to report lastAccessed as no recency', () => {
    expect(tabToItem(rawTab({ lastAccessed: undefined })).lastUsed).toBe(0);
  });

  it('returns a frozen item so callers cannot mutate shared state', () => {
    expect(Object.isFrozen(tabToItem(rawTab()))).toBe(true);
  });

  it.each([
    ['id', { id: undefined }],
    ['windowId', { windowId: undefined }],
    ['index', { index: undefined }],
  ])('rejects a tab missing %s rather than producing a broken item', (_field, missing) => {
    expect(() => tabToItem(rawTab(missing))).toThrow(TypeError);
  });
});

describe('byRecencyDesc', () => {
  /** Sort by the comparator and return just the titles, for readable asserts. */
  function sortedTitles(items) {
    return items.toSorted(byRecencyDesc).map((item) => item.title);
  }

  it('puts the most recently used item first', () => {
    const items = [
      tabToItem(rawTab({ id: 1, title: 'old', lastAccessed: 100 })),
      tabToItem(rawTab({ id: 2, title: 'new', lastAccessed: 300 })),
      tabToItem(rawTab({ id: 3, title: 'middle', lastAccessed: 200 })),
    ];
    expect(sortedTitles(items)).toEqual(['new', 'middle', 'old']);
  });

  it('sorts items with no recency information last', () => {
    const items = [
      tabToItem(rawTab({ id: 1, title: 'unknown', lastAccessed: undefined })),
      tabToItem(rawTab({ id: 2, title: 'known', lastAccessed: 1 })),
    ];
    expect(sortedTitles(items)).toEqual(['known', 'unknown']);
  });

  it('breaks recency ties on title, so the order is total', () => {
    const items = [
      tabToItem(rawTab({ id: 1, title: 'b', lastAccessed: 5 })),
      tabToItem(rawTab({ id: 2, title: 'a', lastAccessed: 5 })),
    ];
    expect(sortedTitles(items)).toEqual(['a', 'b']);
    expect(sortedTitles(items.toReversed())).toEqual(['a', 'b']);
  });
});

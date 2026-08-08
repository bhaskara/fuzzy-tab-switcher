// Tests for the SearchItem model in src/core/items.js.

import { describe, expect, it } from 'vitest';

import {
  KIND_BOOKMARK,
  KIND_TAB,
  bookmarkToItem,
  byRecencyDesc,
  displayUrl,
  flattenBookmarks,
  tabToItem,
} from '../src/core/items.js';

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
      display: 'example.com',
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

describe('displayUrl', () => {
  it.each([
    ['https://example.com/', 'example.com'],
    ['http://example.com/', 'example.com'],
    ['https://www.example.com/', 'example.com'],
    ['HTTPS://Example.com/', 'Example.com'],
    ['https://example.com/a/b', 'example.com/a/b'],
    ['https://example.com/a/', 'example.com/a'],
    ['https://wwwx.example.com/', 'wwwx.example.com'],
  ])('shortens %s to %s', (url, expected) => {
    expect(displayUrl(url)).toBe(expected);
  });

  it.each([
    ['chrome://extensions/', 'chrome://extensions/'],
    ['file:///home/x/', 'file:///home/x/'],
    ['', ''],
  ])('leaves %s alone, where the scheme is the informative part', (url, expected) => {
    expect(displayUrl(url)).toBe(expected);
  });
});

describe('bookmarkToItem', () => {
  it('copies the fields a bookmark needs to be opened', () => {
    const node = {
      id: 'b7',
      title: 'Example',
      url: 'https://example.com/',
      dateAdded: 100,
      dateLastUsed: 500,
    };
    expect(bookmarkToItem(node, 'Bookmarks bar/Dev')).toEqual({
      kind: KIND_BOOKMARK,
      key: 'bookmark:b7',
      title: 'Example',
      url: 'https://example.com/',
      display: 'example.com',
      lastUsed: 500,
      bookmarkId: 'b7',
      folderPath: 'Bookmarks bar/Dev',
    });
  });

  it('falls back to dateAdded for a bookmark that was never opened', () => {
    const node = { id: 'b1', title: 'x', url: 'https://x.test/', dateAdded: 100 };
    expect(bookmarkToItem(node).lastUsed).toBe(100);
  });

  it('reports no recency when the bookmark carries neither date', () => {
    expect(bookmarkToItem({ id: 'b1', title: 'x', url: 'https://x.test/' }).lastUsed).toBe(0);
  });

  it('rejects a folder, which is not an item', () => {
    expect(() => bookmarkToItem({ id: 'f1', title: 'Folder' })).toThrow(TypeError);
  });
});

describe('flattenBookmarks', () => {
  /** A bookmark tree shaped like Chrome's: an unnamed root over named folders. */
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks bar',
          children: [
            { id: '3', title: 'Top', url: 'https://top.test/' },
            {
              id: '4',
              title: 'Dev',
              children: [{ id: '5', title: 'Nested', url: 'https://nested.test/' }],
            },
          ],
        },
        { id: '2', title: 'Other bookmarks', children: [] },
      ],
    },
  ];

  it('returns every bookmark and no folders', () => {
    expect(flattenBookmarks(tree).map((item) => item.title)).toEqual(['Top', 'Nested']);
  });

  it('records the enclosing folders, excluding the unnamed root', () => {
    const paths = Object.fromEntries(
      flattenBookmarks(tree).map((item) => [item.title, item.folderPath]),
    );
    expect(paths).toEqual({ Top: 'Bookmarks bar', Nested: 'Bookmarks bar/Dev' });
  });

  it('returns nothing for an empty tree', () => {
    expect(flattenBookmarks([])).toEqual([]);
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

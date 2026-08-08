// Tests for the SearchItem model in src/core/items.js.

import { describe, expect, it } from 'vitest';

import {
  KIND_BOOKMARK,
  KIND_CLOSED_TAB,
  KIND_HISTORY,
  KIND_TAB,
  bookmarkToItem,
  byRecencyDesc,
  closedTabToItem,
  displayUrl,
  flattenBookmarks,
  historyToItem,
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

describe('closedTabToItem', () => {
  /** A `chrome.sessions.Session` for a closed tab, as Chrome shapes it. */
  function session(overrides = {}) {
    return {
      lastModified: 1_700_000_000,
      tab: {
        // A closed tab's own id is TAB_ID_NONE; only sessionId can restore it.
        id: -1,
        sessionId: 's42',
        title: 'Closed page',
        url: 'https://example.com/gone',
        ...overrides.tab,
      },
      ...overrides,
    };
  }

  it('copies the fields a closed tab needs to be restored', () => {
    expect(closedTabToItem(session())).toEqual({
      kind: KIND_CLOSED_TAB,
      key: 'closed:s42',
      title: 'Closed page',
      url: 'https://example.com/gone',
      display: 'example.com/gone',
      lastUsed: 1_700_000_000_000,
      sessionId: 's42',
    });
  });

  it('converts lastModified from seconds to milliseconds', () => {
    // The sessions API reports seconds; every other timestamp in the model is
    // milliseconds. Left unscaled, every closed tab would sort as 1970 and
    // never appear near the top of the most-recently-used list.
    const item = closedTabToItem(session({ lastModified: 1_700_000_000 }));
    const tab = tabToItem({
      id: 1,
      windowId: 1,
      index: 0,
      title: 'Open',
      url: 'https://open.test/',
      lastAccessed: 1_700_000_001_000,
    });
    // One second younger, so the open tab sorts first — not 53 years first.
    expect([item, tab].toSorted(byRecencyDesc).map((i) => i.kind)).toEqual([
      KIND_TAB,
      KIND_CLOSED_TAB,
    ]);
    expect(tab.lastUsed - item.lastUsed).toBe(1000);
  });

  it('reports no recency when the session carries no timestamp', () => {
    expect(closedTabToItem(session({ lastModified: undefined })).lastUsed).toBe(0);
  });

  it('normalizes a closed tab with no title or url to empty strings', () => {
    const item = closedTabToItem(session({ tab: { sessionId: 's1' } }));
    expect(item.title).toBe('');
    expect(item.url).toBe('');
  });

  it('rejects a session describing a closed window, which is not an item', () => {
    expect(() => closedTabToItem({ lastModified: 1, window: { tabs: [] } })).toThrow(TypeError);
  });

  it('rejects a closed tab with no session id, which could not be restored', () => {
    expect(() => closedTabToItem({ lastModified: 1, tab: { url: 'https://x.test/' } })).toThrow(
      TypeError,
    );
  });
});

describe('historyToItem', () => {
  /** A `chrome.history.HistoryItem`, as Chrome shapes it. */
  function entry(overrides = {}) {
    return {
      id: 'h9',
      title: 'Visited page',
      url: 'https://example.com/page',
      lastVisitTime: 1_700_000_000_000,
      visitCount: 4,
      ...overrides,
    };
  }

  it('copies the fields a history entry needs to be opened', () => {
    expect(historyToItem(entry())).toEqual({
      kind: KIND_HISTORY,
      key: 'history:h9',
      title: 'Visited page',
      url: 'https://example.com/page',
      display: 'example.com/page',
      lastUsed: 1_700_000_000_000,
      historyId: 'h9',
    });
  });

  it('takes lastVisitTime as milliseconds, needing no scaling', () => {
    // Unlike chrome.sessions, which reports seconds. Comparable against a tab
    // one second newer proves the units line up.
    const item = historyToItem(entry({ lastVisitTime: 1_700_000_000_000 }));
    const tab = tabToItem({
      id: 1,
      windowId: 1,
      index: 0,
      title: 'Open',
      url: 'https://open.test/',
      lastAccessed: 1_700_000_001_000,
    });
    expect(tab.lastUsed - item.lastUsed).toBe(1000);
  });

  it('reports no recency when the entry has never been visited', () => {
    expect(historyToItem(entry({ lastVisitTime: undefined })).lastUsed).toBe(0);
  });

  it('normalizes a missing title to an empty string', () => {
    expect(historyToItem(entry({ title: undefined })).title).toBe('');
  });

  it('rejects an entry with no url, which could not be opened', () => {
    expect(() => historyToItem(entry({ url: undefined }))).toThrow(TypeError);
  });

  it('rejects an entry with no id', () => {
    expect(() => historyToItem(entry({ id: undefined }))).toThrow(TypeError);
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

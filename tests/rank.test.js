// Tests for ranking and deduplication in src/core/rank.js.

import { describe, expect, it } from 'vitest';

import { bookmarkToItem, closedTabToItem, tabToItem } from '../src/core/items.js';
import { buildIndex, rank } from '../src/core/rank.js';

/** A tab item, from a few readable fields. */
function tab({ id = 1, title = 'Tab', url = 'https://example.com/', lastAccessed = 0 } = {}) {
  return tabToItem({ id, windowId: 1, index: 0, title, url, lastAccessed });
}

/** A bookmark item, from a few readable fields. */
function bookmark({ id = 'b1', title = 'Bookmark', url = 'https://example.org/', dateAdded = 0 } = {}) {
  return bookmarkToItem({ id, title, url, dateAdded });
}

/** A recently closed tab item. */
function closed({ id = 's1', title = 'Closed', url = 'https://example.net/', lastModified = 0 } = {}) {
  return closedTabToItem({ lastModified, tab: { sessionId: id, title, url } });
}

/** Build an index and rank in one step, as the popup does across two phases. */
function ranked(items, query) {
  return rank(buildIndex(items), query);
}

/** Rank and return just the titles, in order. */
function rankedTitles(items, query) {
  return ranked(items, query).map((entry) => entry.item.title);
}

describe('rank with an empty query', () => {
  it('returns everything most-recently-used first, across both sources', () => {
    const items = [
      tab({ id: 1, title: 'old tab', lastAccessed: 100 }),
      bookmark({ id: 'b1', title: 'recent bookmark', dateAdded: 300 }),
      tab({ id: 2, title: 'new tab', url: 'https://a.test/', lastAccessed: 400 }),
    ];
    expect(rankedTitles(items, '')).toEqual(['new tab', 'recent bookmark', 'old tab']);
  });

  it('treats an all-whitespace query as empty', () => {
    const items = [tab({ title: 'only' })];
    expect(rankedTitles(items, '   ')).toEqual(['only']);
  });

  it('returns an empty list when there is nothing to rank', () => {
    expect(ranked([], '')).toEqual([]);
  });
});

describe('rank with a query', () => {
  it('keeps only matching items', () => {
    const items = [
      tab({ id: 1, title: 'GitHub', url: 'https://github.com/' }),
      tab({ id: 2, title: 'Hacker News', url: 'https://news.ycombinator.com/' }),
    ];
    expect(rankedTitles(items, 'github')).toEqual(['GitHub']);
  });

  it('matches against the URL as well as the title', () => {
    const items = [tab({ title: 'Untitled', url: 'https://github.com/torvalds' })];
    expect(rankedTitles(items, 'torvalds')).toEqual(['Untitled']);
  });

  it('matches the URL without its scheme, so a query cannot lean on https', () => {
    const items = [tab({ title: 'Untitled', url: 'https://example.com/' })];
    expect(rankedTitles(items, 'http')).toEqual([]);
  });

  it('prefers a title match to an equally good URL match', () => {
    const items = [
      tab({ id: 1, title: 'Nothing here', url: 'https://alpha.test/' }),
      tab({ id: 2, title: 'alpha', url: 'https://nothing.test/' }),
    ];
    expect(rankedTitles(items, 'alpha')).toEqual(['alpha', 'Nothing here']);
  });

  it('breaks score ties by recency', () => {
    const items = [
      tab({ id: 1, title: 'Same', url: 'https://a.test/', lastAccessed: 100 }),
      tab({ id: 2, title: 'Same', url: 'https://b.test/', lastAccessed: 900 }),
    ];
    expect(ranked(items, 'same').map((entry) => entry.item.tabId)).toEqual([2, 1]);
  });

  it('does not reorder equal results between keystrokes', () => {
    const items = [
      tab({ id: 1, title: 'alpha', url: 'https://a.test/' }),
      tab({ id: 2, title: 'alpha', url: 'https://b.test/' }),
      tab({ id: 3, title: 'alpha', url: 'https://c.test/' }),
    ];
    const first = ranked(items, 'alpha').map((entry) => entry.item.key);
    const again = ranked(items.toReversed(), 'alpha').map((entry) => entry.item.key);
    expect(again).toEqual(first);
  });
});

describe('rank deduplication', () => {
  it('drops a bookmark whose page is already open as a tab', () => {
    const items = [
      tab({ id: 1, title: 'Open tab', url: 'https://example.com/x' }),
      bookmark({ id: 'b1', title: 'Same page bookmarked', url: 'https://example.com/x' }),
    ];
    expect(rankedTitles(items, '')).toEqual(['Open tab']);
  });

  it('ignores a trailing slash when comparing', () => {
    const items = [
      tab({ id: 1, title: 'Open tab', url: 'https://example.com/x/' }),
      bookmark({ id: 'b1', title: 'Bookmarked', url: 'https://example.com/x' }),
    ];
    expect(rankedTitles(items, '')).toEqual(['Open tab']);
  });

  it('keeps a bookmark for a page that is not open', () => {
    const items = [
      tab({ id: 1, title: 'Open tab', url: 'https://example.com/x' }),
      bookmark({ id: 'b1', title: 'Elsewhere', url: 'https://example.com/y' }),
    ];
    expect(rankedTitles(items, '').toSorted()).toEqual(['Elsewhere', 'Open tab']);
  });

  it('does not merge paths differing only in case, which servers distinguish', () => {
    const items = [
      tab({ id: 1, title: 'Open tab', url: 'https://example.com/X' }),
      bookmark({ id: 'b1', title: 'Bookmarked', url: 'https://example.com/x' }),
    ];
    expect(rankedTitles(items, '')).toHaveLength(2);
  });

  it('keeps two tabs showing the same page, since both can be switched to', () => {
    const items = [
      tab({ id: 1, title: 'First', url: 'https://example.com/' }),
      tab({ id: 2, title: 'Second', url: 'https://example.com/' }),
    ];
    expect(rankedTitles(items, '')).toHaveLength(2);
  });

  it('collapses one page to the kind that preserves the most state', () => {
    // Switching keeps everything, restoring keeps the back/forward history,
    // loading a bookmark keeps nothing — so the open tab is the only survivor.
    const url = 'https://example.com/same';
    const items = [
      bookmark({ id: 'b1', title: 'Bookmarked', url }),
      closed({ id: 's1', title: 'Closed', url }),
      tab({ id: 1, title: 'Open', url }),
    ];
    expect(rankedTitles(items, '')).toEqual(['Open']);
  });

  it('prefers restoring a closed tab to reloading a bookmark of the same page', () => {
    const url = 'https://example.com/same';
    const items = [
      bookmark({ id: 'b1', title: 'Bookmarked', url }),
      closed({ id: 's1', title: 'Closed', url }),
    ];
    expect(rankedTitles(items, '')).toEqual(['Closed']);
  });

  it('drops a closed tab for a page that has since been reopened', () => {
    const url = 'https://example.com/same';
    const items = [tab({ id: 1, title: 'Open again', url }), closed({ id: 's1', url })];
    expect(rankedTitles(items, '')).toEqual(['Open again']);
  });

  it('keeps a closed tab for a page that is neither open nor bookmarked', () => {
    const items = [
      tab({ id: 1, title: 'Open', url: 'https://a.test/' }),
      closed({ id: 's1', title: 'Closed', url: 'https://b.test/' }),
    ];
    expect(rankedTitles(items, '').toSorted()).toEqual(['Closed', 'Open']);
  });

  it('lets an unranked future kind lose ties rather than suppress open tabs', () => {
    // A source added without being listed in KIND_PRECEDENCE must not silently
    // outrank everything; it sorts last, so the open tab still wins.
    const url = 'https://example.com/same';
    const alien = { kind: 'history', key: 'history:1', title: 'History', url, display: url, lastUsed: 0 };
    expect(rankedTitles([alien, tab({ id: 1, title: 'Open', url })], '')).toEqual(['Open']);
  });
});

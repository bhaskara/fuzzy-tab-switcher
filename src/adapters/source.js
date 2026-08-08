// Read side of the Chrome adapter layer: turns live browser state into
// SearchItems. This module and its sibling exec.js are the only places in the
// extension that touch chrome.*, which is what keeps src/core pure.

import {
  closedTabToItem,
  flattenBookmarks,
  historyToItem,
  tabToItem,
} from '../core/items.js';

/**
 * Read every open tab, across all normal windows, as search items.
 *
 * Only `windowType: "normal"` windows are considered: `chrome.tabs.move`
 * refuses to move tabs to or from popup, panel and app windows, so listing
 * their tabs would offer the user choices that cannot be acted on.
 *
 * @returns {Promise<import('../core/items.js').TabItem[]>} Items in Chrome's
 *   own query order — callers are expected to rank them.
 *
 * Preconditions
 * -------------
 * The `"tabs"` permission must be granted, otherwise `title` and `url` come
 * back undefined and every item is normalized to empty strings.
 */
export async function readTabs() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return tabs.map(tabToItem);
}

/**
 * Read every bookmark as search items.
 *
 * @returns {Promise<import('../core/items.js').BookmarkItem[]>} Items in tree
 *   order. Folders are not included, but contribute to their descendants'
 *   `folderPath`.
 *
 * Preconditions
 * -------------
 * The `"bookmarks"` permission must be granted, otherwise this rejects.
 */
export async function readBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  return flattenBookmarks(tree);
}

/**
 * Read recently closed tabs as search items.
 *
 * Chrome caps this list at `chrome.sessions.MAX_SESSION_RESULTS` (25) entries,
 * so it reaches back minutes or hours, not days. Deeper reach would mean the
 * history API, which is a different thing: history entries are bare URLs with
 * no state to restore.
 *
 * Sessions describing a closed *window* are skipped rather than flattened into
 * their tabs — see the note in ../../DESIGN.md §8.
 *
 * @returns {Promise<import('../core/items.js').ClosedTabItem[]>} Most recently
 *   closed first, as Chrome returns them.
 *
 * Preconditions
 * -------------
 * The `"sessions"` permission must be granted, otherwise this rejects.
 */
export async function readRecentlyClosed() {
  const sessions = await chrome.sessions.getRecentlyClosed();
  return sessions.filter((session) => session.tab !== undefined).map(closedTabToItem);
}

/**
 * Read the most recent history entries as search items.
 *
 * Bounded deliberately. Ranking is linear in the number of candidates, and a
 * real browsing history runs to hundreds of thousands of entries — at 100,000
 * the popup would take some 700ms to open and 100ms per keystroke. See
 * ../../bench/README.md.
 *
 * @param {number} maxResults How many entries to load. 0 reads nothing.
 * @returns {Promise<import('../core/items.js').HistoryItem[]>} Entries without
 *   a URL are dropped: they cannot be opened.
 *
 * Preconditions
 * -------------
 * The `"history"` permission must be granted, otherwise this rejects.
 *
 * Notes
 * -----
 * `startTime` must be passed explicitly. Omitted, `chrome.history.search`
 * defaults it to 24 hours ago, which would silently reduce the whole feature to
 * "pages visited today". Chrome does not document what order results come back
 * in, so which entries survive the `maxResults` cut is not guaranteed to be the
 * most recent; ranking sorts by `lastVisitTime` regardless.
 */
export async function readHistory(maxResults) {
  if (maxResults <= 0) return [];
  const entries = await chrome.history.search({ text: '', startTime: 0, maxResults });
  return entries.filter((entry) => typeof entry.url === 'string').map(historyToItem);
}

/**
 * Read what `core/plan.js` needs to know about the browser.
 *
 * `currentWindow` resolves to the window the popup is anchored to, which is the
 * window the user is looking at.
 *
 * @returns {Promise<import('../core/plan.js').BrowserState>}
 *
 * Throws
 * ------
 * Error
 *     If the current window has no active tab, which should not happen while a
 *     popup anchored to that window is open.
 */
export async function readBrowserState() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) {
    throw new Error('the current window has no active tab');
  }
  return {
    currentWindowId: activeTab.windowId,
    activeTabId: activeTab.id,
    activeTabIndex: activeTab.index,
  };
}

/**
 * Read every searchable item from every source.
 *
 * Sources are read concurrently, since the popup cannot show anything until
 * all of them have answered.
 *
 * @param {import('../core/settings.js').Settings} settings Which sources to
 *   read, and how much history. A disabled source is not read at all rather
 *   than read and filtered, so turning one off actually saves its cost.
 * @returns {Promise<import('../core/items.js').SearchItem[]>} Tabs, then
 *   recently closed tabs, then bookmarks, then history — unranked and not yet
 *   deduplicated against each other, which `buildIndex` does.
 */
export async function readAll(settings) {
  const { sources } = settings;
  const [tabs, closed, bookmarks, history] = await Promise.all([
    sources.tabs ? readTabs() : [],
    sources.closed ? readRecentlyClosed() : [],
    sources.bookmarks ? readBookmarks() : [],
    sources.history ? readHistory(settings.historyLimit) : [],
  ]);
  return [...tabs, ...closed, ...bookmarks, ...history];
}

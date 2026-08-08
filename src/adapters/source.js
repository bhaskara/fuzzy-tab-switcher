// Read side of the Chrome adapter layer: turns live browser state into
// SearchItems. This module and its sibling exec.js are the only places in the
// extension that touch chrome.*, which is what keeps src/core pure.

import { flattenBookmarks, tabToItem } from '../core/items.js';

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
 * @returns {Promise<import('../core/items.js').SearchItem[]>} Tabs followed by
 *   bookmarks, unranked and not yet deduplicated against each other — `rank`
 *   does both.
 */
export async function readAll() {
  const [tabs, bookmarks] = await Promise.all([readTabs(), readBookmarks()]);
  return [...tabs, ...bookmarks];
}

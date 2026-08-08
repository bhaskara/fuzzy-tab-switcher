// Read side of the Chrome adapter layer: turns live browser state into
// SearchItems. This module and its sibling exec.js are the only places in the
// extension that touch chrome.*, which is what keeps src/core pure.

import { tabToItem } from '../core/items.js';

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

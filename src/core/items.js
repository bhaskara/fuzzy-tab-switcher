// The SearchItem model: one normalized shape covering every searchable source
// (open tabs now; bookmarks and history later), together with the pure
// conversions into it from the raw shapes the Chrome APIs hand back. Nothing
// here touches chrome.* — the conversions take plain objects so they can be
// exercised from tests in Node.

/** Discriminator for items backed by an open tab. */
export const KIND_TAB = 'tab';

/** Discriminator for items backed by a bookmark. */
export const KIND_BOOKMARK = 'bookmark';

/**
 * An item backed by a currently open tab.
 *
 * @typedef {Object} TabItem
 * @property {'tab'} kind
 * @property {string} key Unique across all sources, of the form `tab:<tabId>`.
 * @property {string} title Tab title; may be empty while a page is loading.
 * @property {string} url Full URL of the tab.
 * @property {number} lastUsed Epoch milliseconds of last access, or 0 if the
 *   running Chrome does not report it.
 * @property {number} tabId
 * @property {number} windowId Window the tab currently lives in.
 * @property {number} tabIndex Position of the tab within that window.
 */

/**
 * Any searchable item. Currently only {@link TabItem}; bookmark and history
 * variants join this union in later milestones, each discriminated by `kind`.
 *
 * @typedef {TabItem} SearchItem
 */

/**
 * Convert a raw Chrome tab into a {@link TabItem}.
 *
 * @param {Object} tab A `chrome.tabs.Tab`-shaped object. Only plain properties
 *   are read, so tests may pass literals.
 * @returns {TabItem} A frozen item. `title` and `url` are normalized to the
 *   empty string when absent.
 *
 * Preconditions
 * -------------
 * `tab.id`, `tab.windowId` and `tab.index` must be numbers. Tabs returned by
 * `chrome.tabs.query` for normal windows always satisfy this; devtools targets
 * and prerendered tabs may not, and are rejected rather than silently skipped.
 *
 * Throws
 * ------
 * TypeError
 *     If any of the required numeric fields is missing.
 */
export function tabToItem(tab) {
  if (typeof tab.id !== 'number') {
    throw new TypeError(`tab is missing a numeric id: ${JSON.stringify(tab)}`);
  }
  if (typeof tab.windowId !== 'number' || typeof tab.index !== 'number') {
    throw new TypeError(`tab ${tab.id} is missing windowId or index`);
  }
  return Object.freeze({
    kind: KIND_TAB,
    key: `${KIND_TAB}:${tab.id}`,
    title: tab.title ?? '',
    url: tab.url ?? '',
    lastUsed: tab.lastAccessed ?? 0,
    tabId: tab.id,
    windowId: tab.windowId,
    tabIndex: tab.index,
  });
}

/**
 * Order items most-recently-used first.
 *
 * Intended as the comparator for `Array.prototype.sort`. Items with no recency
 * information (`lastUsed === 0`) sort last, and ties break on `title` so the
 * ordering is total and therefore stable across calls.
 *
 * @param {SearchItem} a
 * @param {SearchItem} b
 * @returns {number} Negative if `a` sorts before `b`, positive if after, 0 if
 *   the two are indistinguishable.
 */
export function byRecencyDesc(a, b) {
  if (a.lastUsed !== b.lastUsed) {
    return b.lastUsed - a.lastUsed;
  }
  return a.title.localeCompare(b.title);
}

// The SearchItem model: one normalized shape covering every searchable source
// (open tabs and bookmarks now; history later), together with the pure
// conversions into it from the raw shapes the Chrome APIs hand back. Nothing
// here touches chrome.* — the conversions take plain objects so they can be
// exercised from tests in Node.

/** Discriminator for items backed by an open tab. */
export const KIND_TAB = 'tab';

/** Discriminator for items backed by a bookmark. */
export const KIND_BOOKMARK = 'bookmark';

/** Discriminator for items backed by a recently closed tab. */
export const KIND_CLOSED_TAB = 'closed';

/**
 * Fields every item carries, whatever its source.
 *
 * @typedef {Object} ItemBase
 * @property {string} key Unique across all sources, of the form `<kind>:<id>`.
 * @property {string} title Human-readable name; may be empty while a page loads.
 * @property {string} url Full URL, used for navigation and for deduplication.
 * @property {string} display The URL as shown to the user and as matched
 *   against — see {@link displayUrl}.
 * @property {number} lastUsed Epoch milliseconds of last use, or 0 when the
 *   source does not report it.
 */

/**
 * An item backed by a currently open tab.
 *
 * @typedef {ItemBase & {kind: 'tab', tabId: number, windowId: number, tabIndex: number}} TabItem
 */

/**
 * An item backed by a bookmark.
 *
 * @typedef {ItemBase & {kind: 'bookmark', bookmarkId: string, folderPath: string}} BookmarkItem
 */

/**
 * An item backed by a tab that was recently closed and can be restored.
 *
 * @typedef {ItemBase & {kind: 'closed', sessionId: string}} ClosedTabItem
 */

/**
 * Any searchable item, discriminated by `kind`.
 *
 * @typedef {TabItem|BookmarkItem|ClosedTabItem} SearchItem
 */

/**
 * Shorten a URL for display and for matching.
 *
 * Drops the `http://` or `https://` scheme, a leading `www.`, and a lone
 * trailing slash. This is cosmetic but it also sharpens search: without it,
 * every candidate matches a query beginning `htt`, and `w` matches most of
 * them.
 *
 * @param {string} url
 * @returns {string} The shortened form. Non-web schemes such as `chrome://`
 *   and `file://` are returned untouched, since there the scheme is the
 *   informative part.
 *
 * Postconditions
 * --------------
 * The result is never longer than `url`, and is empty only if `url` is.
 */
export function displayUrl(url) {
  const withoutScheme = url.replace(/^https?:\/\//i, '');
  if (withoutScheme === url) return url;
  return withoutScheme.replace(/^www\./i, '').replace(/\/$/, '');
}

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
  const url = tab.url ?? '';
  return Object.freeze({
    kind: KIND_TAB,
    key: `${KIND_TAB}:${tab.id}`,
    title: tab.title ?? '',
    url,
    display: displayUrl(url),
    lastUsed: tab.lastAccessed ?? 0,
    tabId: tab.id,
    windowId: tab.windowId,
    tabIndex: tab.index,
  });
}

/**
 * Convert a raw Chrome bookmark into a {@link BookmarkItem}.
 *
 * @param {Object} node A `chrome.bookmarks.BookmarkTreeNode`-shaped object.
 * @param {string} [folderPath] Slash-joined titles of the enclosing folders,
 *   for example `Bookmarks bar/Dev`. Empty for a bookmark at the root.
 * @returns {BookmarkItem} A frozen item. `lastUsed` prefers `dateLastUsed`
 *   and falls back to `dateAdded`, so that a bookmark never opened still
 *   carries a plausible recency.
 *
 * Preconditions
 * -------------
 * `node.url` must be present — folders are not items, and callers are expected
 * to have filtered them out (see {@link flattenBookmarks}).
 *
 * Throws
 * ------
 * TypeError
 *     If `node.url` or `node.id` is missing.
 */
export function bookmarkToItem(node, folderPath = '') {
  if (typeof node.id !== 'string') {
    throw new TypeError(`bookmark is missing a string id: ${JSON.stringify(node)}`);
  }
  if (typeof node.url !== 'string') {
    throw new TypeError(`bookmark ${node.id} has no url; folders are not items`);
  }
  return Object.freeze({
    kind: KIND_BOOKMARK,
    key: `${KIND_BOOKMARK}:${node.id}`,
    title: node.title ?? '',
    url: node.url,
    display: displayUrl(node.url),
    lastUsed: node.dateLastUsed ?? node.dateAdded ?? 0,
    bookmarkId: node.id,
    folderPath,
  });
}

/**
 * Convert a recently closed session into a {@link ClosedTabItem}.
 *
 * @param {Object} session A `chrome.sessions.Session`-shaped object whose `tab`
 *   is set. Sessions describing a closed *window* are not items and must be
 *   filtered out by the caller.
 * @returns {ClosedTabItem} A frozen item.
 *
 * Preconditions
 * -------------
 * `session.tab.sessionId` must be present. The tab's own `id` is deliberately
 * ignored: a closed tab's `id` is `chrome.tabs.TAB_ID_NONE`, and only the
 * session id can restore it.
 *
 * Notes
 * -----
 * `Session.lastModified` is in **seconds** since the epoch, unlike every other
 * timestamp the Chrome extension APIs hand us, so it is scaled to milliseconds
 * here to match `lastUsed` everywhere else. Skipping that would silently sort
 * every closed tab as though it were from 1970.
 *
 * Throws
 * ------
 * TypeError
 *     If the session has no tab, or that tab has no session id.
 */
export function closedTabToItem(session) {
  const tab = session.tab;
  if (!tab) {
    throw new TypeError('session describes a closed window, which is not an item');
  }
  if (typeof tab.sessionId !== 'string') {
    throw new TypeError(`closed tab has no sessionId: ${JSON.stringify(tab)}`);
  }
  const url = tab.url ?? '';
  return Object.freeze({
    kind: KIND_CLOSED_TAB,
    key: `${KIND_CLOSED_TAB}:${tab.sessionId}`,
    title: tab.title ?? '',
    url,
    display: displayUrl(url),
    lastUsed: (session.lastModified ?? 0) * 1000,
    sessionId: tab.sessionId,
  });
}

/**
 * Walk a bookmark tree into a flat list of {@link BookmarkItem}.
 *
 * @param {Object[]} nodes `chrome.bookmarks.BookmarkTreeNode`-shaped objects,
 *   as returned by `chrome.bookmarks.getTree`.
 * @param {string} [folderPath] Path accumulated so far; callers pass nothing.
 * @returns {BookmarkItem[]} Items in tree order. Folders contribute their
 *   titles to the paths of their descendants but are not themselves items, and
 *   the unnamed tree root contributes nothing.
 */
export function flattenBookmarks(nodes, folderPath = '') {
  const items = [];
  for (const node of nodes) {
    if (typeof node.url === 'string') {
      items.push(bookmarkToItem(node, folderPath));
    } else if (node.children) {
      const title = node.title ?? '';
      const childPath = !title ? folderPath : folderPath ? `${folderPath}/${title}` : title;
      items.push(...flattenBookmarks(node.children, childPath));
    }
  }
  return items;
}

/**
 * Order items most-recently-used first.
 *
 * Intended as the comparator for `Array.prototype.sort`. Items with no recency
 * information (`lastUsed === 0`) sort last, and ties break first on `title`,
 * then on `key`.
 *
 * The final tie-break on `key` is arbitrary but total: `key` is unique by
 * construction, so no two distinct items ever compare equal. Without it the
 * result would depend on the order the sources happened to be read in, and the
 * list could reshuffle under the user between keystrokes.
 *
 * @param {SearchItem} a
 * @param {SearchItem} b
 * @returns {number} Negative if `a` sorts before `b`, positive if after, 0 only
 *   if `a` and `b` are the same item.
 */
export function byRecencyDesc(a, b) {
  if (a.lastUsed !== b.lastUsed) {
    return b.lastUsed - a.lastUsed;
  }
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

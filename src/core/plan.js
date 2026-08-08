// Deciding what activating a result should do.
//
// This is the keystone of the ports-and-adapters split: choosing an item does
// not perform anything, it *returns* a described action, which
// adapters/exec.js then carries out. All of the branching in the spec — tab
// versus bookmark versus closed tab, and the three ways of activating any of
// them — is therefore a pure function over a small truth table that can be
// tested exhaustively with no browser.

import { KIND_BOOKMARK, KIND_CLOSED_TAB, KIND_TAB } from './items.js';

/** Bring the item into the current window. The default, on Enter. */
export const INTENT_HERE = 'here';

/** Go to the item where it already is, following it. On Shift+Enter. */
export const INTENT_IN_PLACE = 'inPlace';

/** Put the item in the other window without following it. On Ctrl+Enter. */
export const INTENT_OTHER_WINDOW = 'otherWindow';

/**
 * What the popup knows about the browser when the user activates a result.
 *
 * Captured once when the popup opens: the popup holds focus for its whole life,
 * so none of it can change underneath.
 *
 * @typedef {Object} BrowserState
 * @property {number} currentWindowId The window the popup belongs to.
 * @property {number} activeTabId The active tab in that window.
 * @property {number} activeTabIndex That tab's position in that window.
 * @property {number|null} otherWindowId The window {@link INTENT_OTHER_WINDOW}
 *   targets, or null when there is no other window. See
 *   {@link mostRecentOtherWindow}.
 */

/**
 * Something for `adapters/exec.js` to do.
 *
 * Only `focusTab` moves window focus. Everything else leaves the user looking
 * at whatever they were looking at, which is what makes
 * {@link INTENT_OTHER_WINDOW} possible: Chrome documents `active` on both
 * `tabs.create` and `tabs.update` as "does not affect whether the window is
 * focused".
 *
 * `reportProblem` is the exception that never reaches `exec` — the popup shows
 * its message and stays open.
 *
 * @typedef {{type: 'focusTab', tabId: number, windowId: number}
 *   | {type: 'activateTab', tabId: number}
 *   | {type: 'moveAndActivate', tabId: number, toWindowId: number, index: number}
 *   | {type: 'navigateActive', tabId: number, url: string}
 *   | {type: 'openNewTab', url: string, windowId: number}
 *   | {type: 'restoreSession', sessionId: string}
 *   | {type: 'reportProblem', message: string}} Action
 */

/**
 * Index meaning "after the last tab" in `chrome.tabs.move`.
 *
 * Tabs sent to the other window go on its end. Any other position would be a
 * guess about a window the user is not currently working in.
 */
const INDEX_LAST = -1;

/**
 * Pick the window that {@link INTENT_OTHER_WINDOW} should target.
 *
 * Neither the tabs nor the windows API exposes window recency, so it is derived
 * from the tabs: the window holding the most recently accessed tab that is not
 * in the current window. With two windows side by side this is simply the other
 * one, which is the case the feature exists for.
 *
 * @param {import('./items.js').SearchItem[]} items Every candidate; non-tab
 *   items are ignored.
 * @param {number} currentWindowId The window to exclude.
 * @returns {number|null} A window id, or null if no tab lives outside
 *   `currentWindowId`.
 *
 * Postconditions
 * --------------
 * The result is never `currentWindowId`. Ties on recency — which is what a
 * Chrome too old to report `lastAccessed` produces for every tab — break on the
 * lower window id, so the choice is deterministic rather than dependent on the
 * order tabs were read in.
 */
export function mostRecentOtherWindow(items, currentWindowId) {
  let bestWindowId = null;
  let bestLastUsed = -Infinity;
  for (const item of items) {
    if (item.kind !== KIND_TAB || item.windowId === currentWindowId) continue;
    if (
      item.lastUsed > bestLastUsed ||
      (item.lastUsed === bestLastUsed && item.windowId < bestWindowId)
    ) {
      bestWindowId = item.windowId;
      bestLastUsed = item.lastUsed;
    }
  }
  return bestWindowId;
}

/**
 * Plan the activation of an open tab.
 *
 * @param {import('./items.js').TabItem} item
 * @param {string} intent
 * @param {BrowserState} state
 * @returns {Action}
 */
function planTab(item, intent, state) {
  if (intent === INTENT_IN_PLACE) {
    return Object.freeze({ type: 'focusTab', tabId: item.tabId, windowId: item.windowId });
  }

  if (intent === INTENT_OTHER_WINDOW) {
    if (state.otherWindowId === null) {
      return Object.freeze({ type: 'reportProblem', message: 'No other window' });
    }
    // Already sitting in the target window: activate it there and leave its
    // position alone rather than shuffling it to the end for no reason.
    if (item.windowId === state.otherWindowId) {
      return Object.freeze({ type: 'activateTab', tabId: item.tabId });
    }
    return Object.freeze({
      type: 'moveAndActivate',
      tabId: item.tabId,
      toWindowId: state.otherWindowId,
      index: INDEX_LAST,
    });
  }

  // A tab already in the current window is only focused, never moved. Moving it
  // would drag it across to sit beside the active tab, silently rearranging a
  // window the user can see, to no benefit.
  if (item.windowId === state.currentWindowId) {
    return Object.freeze({ type: 'focusTab', tabId: item.tabId, windowId: item.windowId });
  }
  return Object.freeze({
    type: 'moveAndActivate',
    tabId: item.tabId,
    toWindowId: state.currentWindowId,
    index: state.activeTabIndex + 1,
  });
}

/**
 * Plan the activation of a bookmark.
 *
 * @param {import('./items.js').BookmarkItem} item
 * @param {string} intent
 * @param {BrowserState} state
 * @returns {Action}
 */
function planBookmark(item, intent, state) {
  if (intent === INTENT_OTHER_WINDOW) {
    if (state.otherWindowId === null) {
      return Object.freeze({ type: 'reportProblem', message: 'No other window' });
    }
    return Object.freeze({ type: 'openNewTab', url: item.url, windowId: state.otherWindowId });
  }
  if (intent === INTENT_IN_PLACE) {
    return Object.freeze({ type: 'openNewTab', url: item.url, windowId: state.currentWindowId });
  }
  return Object.freeze({ type: 'navigateActive', tabId: state.activeTabId, url: item.url });
}

/**
 * Decide what activating `item` should do.
 *
 * | Selected | here (Enter) | inPlace (Shift) | otherWindow (Ctrl) |
 * | --- | --- | --- | --- |
 * | open tab | move to the current window beside the active tab, activate | focus it where it is, switching windows | move to the other window's end, activate without following |
 * | bookmark | navigate the active tab | open in a new tab here | open in a new tab over there |
 * | closed tab | restore | restore | restore |
 *
 * Restoring ignores the intent because restoring is only half the job: where
 * Chrome reopens the tab is not knowable until it has done so. The caller
 * restores, then plans a *second* action from the reopened tab with the same
 * intent, at which point the open-tab row applies and the intent does its usual
 * work. So a restored tab is brought here, followed, or sent across exactly
 * like any other tab, without this function having to predict where it lands.
 *
 * @param {import('./items.js').SearchItem} item The activated item.
 * @param {string} intent One of {@link INTENT_HERE}, {@link INTENT_IN_PLACE},
 *   {@link INTENT_OTHER_WINDOW}. An unrecognized value is treated as
 *   {@link INTENT_HERE}, since refusing to switch tabs is a worse failure than
 *   switching them the ordinary way.
 * @param {BrowserState} state
 * @returns {Action} A frozen action. Nothing has happened yet.
 *
 * Throws
 * ------
 * TypeError
 *     If `item.kind` is not a known kind, rather than silently doing nothing.
 */
export function plan(item, intent, state) {
  if (item.kind === KIND_TAB) return planTab(item, intent, state);
  if (item.kind === KIND_BOOKMARK) return planBookmark(item, intent, state);
  if (item.kind === KIND_CLOSED_TAB) {
    return Object.freeze({ type: 'restoreSession', sessionId: item.sessionId });
  }
  throw new TypeError(`cannot plan an action for item kind ${JSON.stringify(item.kind)}`);
}

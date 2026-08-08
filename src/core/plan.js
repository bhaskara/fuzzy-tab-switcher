// Deciding what activating a result should do.
//
// This is the keystone of the ports-and-adapters split: choosing an item does
// not perform anything, it *returns* a described action, which
// adapters/exec.js then carries out. All of the branching in the spec — tab
// versus bookmark, plain versus alternate activation, and one day split view
// versus not — is therefore a pure function over a small truth table that can
// be tested exhaustively with no browser.

import { KIND_BOOKMARK, KIND_CLOSED_TAB, KIND_TAB } from './items.js';

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
 */

/**
 * How the user asked for the result to be activated.
 *
 * Named for intent rather than for the key, so that `core/` knows nothing about
 * the keyboard: the popup maps Shift+Enter onto `alternate`.
 *
 * @typedef {Object} Modifiers
 * @property {boolean} alternate Whether the secondary behaviour was requested.
 */

/**
 * Something for `adapters/exec.js` to do.
 *
 * @typedef {{type: 'focusTab', tabId: number, windowId: number}
 *   | {type: 'moveAndFocus', tabId: number, toWindowId: number, index: number}
 *   | {type: 'navigateActive', tabId: number, url: string}
 *   | {type: 'openNewTab', url: string, windowId: number}
 *   | {type: 'restoreSession', sessionId: string}} Action
 */

/**
 * Decide what activating `item` should do.
 *
 * The behaviour, per the README:
 *
 * | Selected | plain | alternate |
 * | --- | --- | --- |
 * | open tab | move it to the current window, just right of the active tab, and focus it | focus it where it already is, switching windows |
 * | bookmark | navigate the active tab to it | open it in a new tab |
 * | recently closed tab | restore it | restore it |
 *
 * with one exception: a tab that is *already* in the current window is only
 * focused, never moved. Moving it would drag it across to sit beside the active
 * tab, silently rearranging a window the user can see, to no benefit.
 *
 * Restoring ignores `alternate` because restoring is only half the job: where
 * Chrome reopens the tab is not knowable until it has done so. The caller
 * restores, then plans a *second* action from the reopened tab, at which point
 * the open-tab row above applies and `alternate` does its usual work. So plain
 * activation still brings the tab to the current window and alternate still
 * leaves it where it landed, without this function having to predict where
 * that is.
 *
 * @param {import('./items.js').SearchItem} item The activated item.
 * @param {Modifiers} modifiers
 * @param {BrowserState} state
 * @returns {Action} A frozen action. Nothing has happened yet.
 *
 * Throws
 * ------
 * TypeError
 *     If `item.kind` is not a known kind, rather than silently doing nothing.
 */
export function plan(item, modifiers, state) {
  if (item.kind === KIND_TAB) {
    if (modifiers.alternate || item.windowId === state.currentWindowId) {
      return Object.freeze({ type: 'focusTab', tabId: item.tabId, windowId: item.windowId });
    }
    return Object.freeze({
      type: 'moveAndFocus',
      tabId: item.tabId,
      toWindowId: state.currentWindowId,
      index: state.activeTabIndex + 1,
    });
  }

  if (item.kind === KIND_CLOSED_TAB) {
    return Object.freeze({ type: 'restoreSession', sessionId: item.sessionId });
  }

  if (item.kind === KIND_BOOKMARK) {
    if (modifiers.alternate) {
      return Object.freeze({
        type: 'openNewTab',
        url: item.url,
        windowId: state.currentWindowId,
      });
    }
    return Object.freeze({ type: 'navigateActive', tabId: state.activeTabId, url: item.url });
  }

  throw new TypeError(`cannot plan an action for item kind ${JSON.stringify(item.kind)}`);
}

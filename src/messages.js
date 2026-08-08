// The contract between the popup and the service worker.
//
// Kept in its own module so that neither imports the other: importing
// background.js from the popup would register the worker's listeners inside the
// popup, and importing the popup from the worker would drag the DOM in.

/**
 * Restore a closed tab and then place it according to the user's intent.
 *
 * Sent by the popup, handled by the service worker, because
 * `chrome.sessions.restore` focuses the window the tab lands in — which closes
 * the popup and would destroy any work queued behind it. Nothing is sent back:
 * by the time the work finishes, the popup that asked for it is gone.
 *
 * @typedef {Object} RestoreAndPlace
 * @property {'restoreAndPlace'} type
 * @property {string} sessionId The closed tab to restore.
 * @property {string} intent One of the `INTENT_` constants from `core/plan.js`.
 * @property {import('./core/plan.js').BrowserState} browserState Captured by
 *   the popup before it closed.
 */

/** Message type for {@link RestoreAndPlace}. */
export const RESTORE_AND_PLACE = 'restoreAndPlace';

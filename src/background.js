// Service worker: the work that has to outlive the popup.
//
// A popup cannot reliably do anything after a call that moves window focus,
// because losing focus is what closes it, and closing it destroys the
// JavaScript context mid-sequence. Every action but one either leaves focus
// alone or moves it as its final step. The exception is restoring a closed tab:
// `chrome.sessions.restore` reopens the tab and focuses whichever window it
// lands in, and only *then* can the tab be placed where the user asked. Run
// from the popup, the placement half simply never happened.
//
// This worker is not tied to the popup's lifetime, so it can finish. It is also
// far easier to debug: its console survives, reachable from the extension's
// card in chrome://extensions.

import { execute } from './adapters/exec.js';
import { tabToItem } from './core/items.js';
import { plan } from './core/plan.js';
import { RESTORE_AND_PLACE } from './messages.js';

/**
 * Restore a closed tab, then place it according to the user's intent.
 *
 * The placement is planned only after the restore, because where Chrome
 * reopens a tab is not knowable until it has done so. Planning against the
 * reopened tab is what makes a restored tab behave like any other tab under
 * every intent.
 *
 * @param {import('./messages.js').RestoreAndPlace} message
 * @returns {Promise<void>}
 *
 * Throws
 * ------
 * Error
 *     If Chrome refuses the restore or the move. Callers are expected to log
 *     it; there is no popup left to show it in.
 */
async function restoreAndPlace(message) {
  const restored = await execute({ type: 'restoreSession', sessionId: message.sessionId });
  if (restored === null) {
    // Chrome recreated a window rather than handing back a tab, or reported
    // nothing at all. The tab is back either way, just not where it was asked
    // to go, and there is nothing further to act on.
    console.warn('[tab-switcher] restore returned no tab; leaving it where Chrome put it');
    return;
  }

  const followUp = plan(tabToItem(restored), message.intent, message.browserState);
  if (followUp.type === 'reportProblem') {
    console.warn(`[tab-switcher] restored, but cannot place it: ${followUp.message}`);
    return;
  }
  await execute(followUp);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== RESTORE_AND_PLACE) return false;

  restoreAndPlace(message)
    .catch((err) => {
      console.error('[tab-switcher] restore and place failed', err);
    })
    .finally(() => {
      // The popup that asked is already gone, so nobody receives this. It is
      // sent anyway to close the channel: returning true above is what keeps
      // the worker alive across the await, and leaving the channel open would
      // hold it awake for no reason.
      try {
        sendResponse({ done: true });
      } catch {
        // Expected — the sender is gone.
      }
    });

  return true;
});

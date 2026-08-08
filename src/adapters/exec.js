// Write side of the Chrome adapter layer: carries out the actions that
// core/plan.js describes. This module and its sibling source.js are the only
// places in the extension that touch chrome.*.

/**
 * Carry out an action.
 *
 * Errors are not caught. `chrome.tabs.move` in particular refuses several
 * things — moving across the incognito boundary, or to or from a window that is
 * not a normal one — and the caller needs to be able to say so rather than
 * appear to have done nothing.
 *
 * @param {import('../core/plan.js').Action} action As returned by `plan`.
 * @returns {Promise<Object|null>} A `chrome.tabs.Tab`-shaped object for
 *   `restoreSession`, describing where the tab was reopened, so the caller can
 *   plan a follow-up action against it; null for every other action. Resolves
 *   once the browser has applied the action — though it may not resolve at all
 *   in practice, since focusing another window closes the popup and tears down
 *   the context this is running in.
 *
 * Throws
 * ------
 * TypeError
 *     If `action.type` is not a known type.
 */
export async function execute(action) {
  switch (action.type) {
    case 'focusTab':
      // Activate before focusing: the reverse order shows the user whatever was
      // active in the target window first, which reads as a visible flicker.
      await chrome.tabs.update(action.tabId, { active: true });
      await chrome.windows.update(action.windowId, { focused: true });
      return null;

    case 'restoreSession': {
      // Restoring reopens the tab with its back/forward history intact, which
      // is the whole advantage over loading the same URL fresh. Chrome decides
      // where it lands, so the reopened tab is handed back for the caller to
      // plan against rather than acted on here.
      const session = await chrome.sessions.restore(action.sessionId);
      return session?.tab ?? null;
    }

    case 'activateTab':
      await chrome.tabs.update(action.tabId, { active: true });
      return null;

    case 'moveAndActivate':
      // Moving a tab between two normal windows preserves its renderer, exactly
      // as dragging it does, so the page is not reloaded and keeps its scroll
      // position and form state.
      await chrome.tabs.move(action.tabId, {
        windowId: action.toWindowId,
        index: action.index,
      });
      // Deliberately no windows.update: `active` does not move window focus, so
      // sending a tab to another window leaves the user where they are.
      await chrome.tabs.update(action.tabId, { active: true });
      return null;

    case 'navigateActive':
      await chrome.tabs.update(action.tabId, { url: action.url });
      return null;

    case 'openNewTab':
      await chrome.tabs.create({ url: action.url, windowId: action.windowId });
      return null;

    default:
      // Includes `reportProblem`, which the popup is expected to have handled
      // and shown to the user before getting here.
      throw new TypeError(`unknown action type ${JSON.stringify(action.type)}`);
  }
}

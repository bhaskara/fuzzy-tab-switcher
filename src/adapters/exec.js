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
 * @returns {Promise<void>} Resolves once the browser has applied the action.
 *   May not resolve at all in practice: focusing another window closes the
 *   popup, which tears down the context this is running in.
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
      return;

    case 'moveAndFocus':
      // Moving a tab between two normal windows preserves its renderer, exactly
      // as dragging it does, so the page is not reloaded and keeps its scroll
      // position and form state.
      await chrome.tabs.move(action.tabId, {
        windowId: action.toWindowId,
        index: action.index,
      });
      await chrome.tabs.update(action.tabId, { active: true });
      return;

    case 'navigateActive':
      await chrome.tabs.update(action.tabId, { url: action.url });
      return;

    case 'openNewTab':
      await chrome.tabs.create({ url: action.url, windowId: action.windowId });
      return;

    default:
      throw new TypeError(`unknown action type ${JSON.stringify(action.type)}`);
  }
}

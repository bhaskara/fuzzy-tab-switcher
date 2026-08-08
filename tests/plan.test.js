// Tests for action planning in src/core/plan.js.
//
// This is the whole behavioural contract of the extension — what actually
// happens when you press Enter — so the truth table is covered exhaustively.

import { describe, expect, it } from 'vitest';

import { bookmarkToItem, closedTabToItem, tabToItem } from '../src/core/items.js';
import {
  INTENT_HERE,
  INTENT_IN_PLACE,
  INTENT_OTHER_WINDOW,
  mostRecentOtherWindow,
  plan,
} from '../src/core/plan.js';

/**
 * The window the popup belongs to (1), with its active tab third from the left,
 * and window 5 as the other window Ctrl+Enter targets.
 */
const STATE = Object.freeze({
  currentWindowId: 1,
  activeTabId: 100,
  activeTabIndex: 2,
  otherWindowId: 5,
});

/** The same, with only one window open. */
const LONE_WINDOW = Object.freeze({ ...STATE, otherWindowId: null });

/** A tab item, in `windowId` by default the current window. */
function tab({ id = 42, windowId = 1, index = 0, lastAccessed = 0 } = {}) {
  return tabToItem({ id, windowId, index, title: 'Tab', url: 'https://example.com/', lastAccessed });
}

/** A bookmark item. */
function bookmark({ url = 'https://example.org/page' } = {}) {
  return bookmarkToItem({ id: 'b1', title: 'Bookmark', url });
}

describe('plan for an open tab', () => {
  it('moves a tab from another window in beside the active tab, and activates it', () => {
    expect(plan(tab({ id: 42, windowId: 9 }), INTENT_HERE, STATE)).toEqual({
      type: 'moveAndActivate',
      tabId: 42,
      toWindowId: 1,
      index: 3,
    });
  });

  it('focuses a tab in another window in place', () => {
    expect(plan(tab({ id: 42, windowId: 9 }), INTENT_IN_PLACE, STATE)).toEqual({
      type: 'focusTab',
      tabId: 42,
      windowId: 9,
    });
  });

  it('only focuses a tab already in the current window, never rearranging it', () => {
    expect(plan(tab({ id: 42, windowId: 1 }), INTENT_HERE, STATE)).toEqual({
      type: 'focusTab',
      tabId: 42,
      windowId: 1,
    });
  });

  it('places a moved tab immediately right of the active tab', () => {
    const at = (activeTabIndex) =>
      plan(tab({ windowId: 9 }), INTENT_HERE, { ...STATE, activeTabIndex }).index;
    expect([at(0), at(2), at(7)]).toEqual([1, 3, 8]);
  });
});

describe('plan for the other window', () => {
  it('sends a tab from the current window to the end of the other one', () => {
    expect(plan(tab({ id: 42, windowId: 1 }), INTENT_OTHER_WINDOW, STATE)).toEqual({
      type: 'moveAndActivate',
      tabId: 42,
      toWindowId: 5,
      index: -1,
    });
  });

  it('sends a tab from a third window to the other one too', () => {
    expect(plan(tab({ id: 42, windowId: 9 }), INTENT_OTHER_WINDOW, STATE).toWindowId).toBe(5);
  });

  it('leaves a tab already in the other window where it sits, just activating it', () => {
    // Moving it to the end would shuffle a window the user is not looking at,
    // for no gain.
    expect(plan(tab({ id: 42, windowId: 5 }), INTENT_OTHER_WINDOW, STATE)).toEqual({
      type: 'activateTab',
      tabId: 42,
    });
  });

  it('opens a bookmark in a new tab over there', () => {
    expect(plan(bookmark(), INTENT_OTHER_WINDOW, STATE)).toEqual({
      type: 'openNewTab',
      url: 'https://example.org/page',
      windowId: 5,
    });
  });

  it('never plans an action that moves window focus', () => {
    // The entire point is that the user keeps looking at what they were looking
    // at; only focusTab moves focus, so it must not appear here.
    const items = [tab({ windowId: 1 }), tab({ windowId: 9 }), tab({ windowId: 5 }), bookmark()];
    for (const item of items) {
      expect(plan(item, INTENT_OTHER_WINDOW, STATE).type).not.toBe('focusTab');
    }
  });

  it('reports the problem instead of acting when there is no other window', () => {
    for (const item of [tab({ windowId: 1 }), bookmark()]) {
      expect(plan(item, INTENT_OTHER_WINDOW, LONE_WINDOW)).toEqual({
        type: 'reportProblem',
        message: 'No other window',
      });
    }
  });
});

describe('plan for a bookmark', () => {
  it('navigates the active tab to it', () => {
    expect(plan(bookmark(), INTENT_HERE, STATE)).toEqual({
      type: 'navigateActive',
      tabId: 100,
      url: 'https://example.org/page',
    });
  });

  it('opens it in a new tab in this window in place', () => {
    expect(plan(bookmark(), INTENT_IN_PLACE, STATE)).toEqual({
      type: 'openNewTab',
      url: 'https://example.org/page',
      windowId: 1,
    });
  });

  it('navigates to the full URL, not the shortened one shown in the list', () => {
    const item = bookmark({ url: 'https://www.example.org/' });
    expect(item.display).toBe('example.org');
    expect(plan(item, INTENT_HERE, STATE).url).toBe('https://www.example.org/');
  });
});

describe('plan for a recently closed tab', () => {
  const item = closedTabToItem({
    lastModified: 1_700_000_000,
    tab: { sessionId: 's42', title: 'Closed', url: 'https://example.com/gone' },
  });

  it.each([
    ['here', INTENT_HERE],
    ['in place', INTENT_IN_PLACE],
    ['other window', INTENT_OTHER_WINDOW],
  ])('restores it the same way for intent %s', (_name, intent) => {
    // Restoring is only half the job. Where Chrome reopens the tab is not
    // knowable until it has, so the caller restores and then plans a second
    // action against the reopened tab — and that is where the intent applies.
    expect(plan(item, intent, STATE)).toEqual({ type: 'restoreSession', sessionId: 's42' });
  });

  it('hands the reopened tab back to the open-tab rules, whichever window it lands in', () => {
    // The second half of the sequence, as popup/main.js performs it.
    const reopened = tab({ id: 77, windowId: 9 });
    expect(plan(reopened, INTENT_HERE, STATE)).toEqual({
      type: 'moveAndActivate',
      tabId: 77,
      toWindowId: 1,
      index: 3,
    });
    expect(plan(reopened, INTENT_IN_PLACE, STATE)).toEqual({
      type: 'focusTab',
      tabId: 77,
      windowId: 9,
    });
    expect(plan(reopened, INTENT_OTHER_WINDOW, STATE).toWindowId).toBe(5);
  });
});

describe('plan in general', () => {
  it('returns a frozen action, so no caller can rewrite it in flight', () => {
    expect(Object.isFrozen(plan(tab(), INTENT_HERE, STATE))).toBe(true);
  });

  it('rejects an unknown kind rather than silently doing nothing', () => {
    const alien = { kind: 'history', url: 'https://example.com/' };
    expect(() => plan(alien, INTENT_HERE, STATE)).toThrow(TypeError);
  });

  it('falls back to ordinary activation for an unrecognized intent', () => {
    // Refusing to switch tabs would be a worse failure than switching them the
    // ordinary way.
    expect(plan(tab({ windowId: 9 }), 'nonsense', STATE)).toEqual(
      plan(tab({ windowId: 9 }), INTENT_HERE, STATE),
    );
  });

  it('never mutates the state it is given', () => {
    const state = { ...STATE };
    plan(tab({ windowId: 9 }), INTENT_HERE, state);
    plan(bookmark(), INTENT_OTHER_WINDOW, state);
    expect(state).toEqual(STATE);
  });
});

describe('mostRecentOtherWindow', () => {
  it('picks the window holding the most recently accessed tab elsewhere', () => {
    const items = [
      tab({ id: 1, windowId: 1, lastAccessed: 900 }),
      tab({ id: 2, windowId: 5, lastAccessed: 300 }),
      tab({ id: 3, windowId: 9, lastAccessed: 500 }),
    ];
    expect(mostRecentOtherWindow(items, 1)).toBe(9);
  });

  it('never picks the current window, however recently it was used', () => {
    const items = [
      tab({ id: 1, windowId: 1, lastAccessed: 999 }),
      tab({ id: 2, windowId: 5, lastAccessed: 1 }),
    ];
    expect(mostRecentOtherWindow(items, 1)).toBe(5);
  });

  it('returns null when every tab is in the current window', () => {
    expect(mostRecentOtherWindow([tab({ windowId: 1 })], 1)).toBeNull();
  });

  it('returns null when there is nothing to choose from', () => {
    expect(mostRecentOtherWindow([], 1)).toBeNull();
  });

  it('ignores bookmarks and closed tabs, which live in no window', () => {
    const items = [
      bookmark(),
      closedTabToItem({ lastModified: 9_999_999, tab: { sessionId: 's1', url: 'https://x.test/' } }),
      tab({ id: 2, windowId: 5, lastAccessed: 1 }),
    ];
    expect(mostRecentOtherWindow(items, 1)).toBe(5);
  });

  it('breaks recency ties deterministically, not on the order tabs were read', () => {
    // Every tab reports lastAccessed 0 on a Chrome too old to support it, so
    // this is the whole behaviour there, not a corner case.
    const items = [tab({ id: 1, windowId: 9 }), tab({ id: 2, windowId: 5 })];
    expect(mostRecentOtherWindow(items, 1)).toBe(5);
    expect(mostRecentOtherWindow(items.toReversed(), 1)).toBe(5);
  });
});

// Tests for action planning in src/core/plan.js.
//
// This is the whole behavioural contract of the extension — what actually
// happens when you press Enter — so the truth table is covered exhaustively.

import { describe, expect, it } from 'vitest';

import { bookmarkToItem, tabToItem } from '../src/core/items.js';
import { plan } from '../src/core/plan.js';

/** The window the popup belongs to, with its active tab third from the left. */
const STATE = Object.freeze({
  currentWindowId: 1,
  activeTabId: 100,
  activeTabIndex: 2,
});

const PLAIN = Object.freeze({ alternate: false });
const ALTERNATE = Object.freeze({ alternate: true });

/** A tab item, in `windowId` by default the current window. */
function tab({ id = 42, windowId = 1, index = 0 } = {}) {
  return tabToItem({ id, windowId, index, title: 'Tab', url: 'https://example.com/' });
}

/** A bookmark item. */
function bookmark({ url = 'https://example.org/page' } = {}) {
  return bookmarkToItem({ id: 'b1', title: 'Bookmark', url });
}

describe('plan for an open tab', () => {
  it('moves a tab from another window in beside the active tab, and focuses it', () => {
    expect(plan(tab({ id: 42, windowId: 9 }), PLAIN, STATE)).toEqual({
      type: 'moveAndFocus',
      tabId: 42,
      toWindowId: 1,
      index: 3,
    });
  });

  it('focuses a tab in another window in place when alternate is asked for', () => {
    expect(plan(tab({ id: 42, windowId: 9 }), ALTERNATE, STATE)).toEqual({
      type: 'focusTab',
      tabId: 42,
      windowId: 9,
    });
  });

  it('only focuses a tab already in the current window, never rearranging it', () => {
    expect(plan(tab({ id: 42, windowId: 1 }), PLAIN, STATE)).toEqual({
      type: 'focusTab',
      tabId: 42,
      windowId: 1,
    });
  });

  it('focuses a tab in the current window under alternate too', () => {
    expect(plan(tab({ id: 42, windowId: 1 }), ALTERNATE, STATE)).toEqual({
      type: 'focusTab',
      tabId: 42,
      windowId: 1,
    });
  });

  it('places a moved tab immediately right of the active tab', () => {
    const at = (activeTabIndex) =>
      plan(tab({ windowId: 9 }), PLAIN, { ...STATE, activeTabIndex }).index;
    expect([at(0), at(2), at(7)]).toEqual([1, 3, 8]);
  });
});

describe('plan for a bookmark', () => {
  it('navigates the active tab to it', () => {
    expect(plan(bookmark(), PLAIN, STATE)).toEqual({
      type: 'navigateActive',
      tabId: 100,
      url: 'https://example.org/page',
    });
  });

  it('opens it in a new tab when alternate is asked for', () => {
    expect(plan(bookmark(), ALTERNATE, STATE)).toEqual({
      type: 'openNewTab',
      url: 'https://example.org/page',
      windowId: 1,
    });
  });

  it('navigates to the full URL, not the shortened one shown in the list', () => {
    const item = bookmark({ url: 'https://www.example.org/' });
    expect(item.display).toBe('example.org');
    expect(plan(item, PLAIN, STATE).url).toBe('https://www.example.org/');
  });
});

describe('plan in general', () => {
  it('returns a frozen action, so no caller can rewrite it in flight', () => {
    expect(Object.isFrozen(plan(tab(), PLAIN, STATE))).toBe(true);
  });

  it('rejects an unknown kind rather than silently doing nothing', () => {
    const alien = { kind: 'history', url: 'https://example.com/' };
    expect(() => plan(alien, PLAIN, STATE)).toThrow(TypeError);
  });

  it('never mutates the state it is given', () => {
    const state = { ...STATE };
    plan(tab({ windowId: 9 }), PLAIN, state);
    plan(bookmark(), ALTERNATE, state);
    expect(state).toEqual(STATE);
  });
});

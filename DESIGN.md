# Design

Design and implementation plan for the `switch-to` Chrome extension described in
[README.md](README.md). This document records *how* the spec is realized, which
Chrome APIs it rests on, and what is deliberately deferred.

## 1. Feasibility summary

Everything in the spec is supported by MV3 extension APIs **except moving a tab
into an existing split view**, which has no API (see §3).

| Spec requirement | Mechanism | Status |
| --- | --- | --- |
| Custom keyboard shortcut opens a popup | `chrome.commands` reserved `_execute_action` | supported, user-rebindable at `chrome://extensions/shortcuts` |
| Search open tabs across all windows | `chrome.tabs.query({})`, `"tabs"` permission | supported |
| Search bookmarks | `chrome.bookmarks.getTree()`, `"bookmarks"` permission | supported |
| Fuzzy match, narrowing as you type | pure JS in the popup | supported; ~5k items score in a few ms |
| Move an open tab to the current window, no reload | `chrome.tabs.move` then `chrome.tabs.update({active:true})` | supported; equivalent to dragging the tab, renderer is preserved |
| Bookmark navigates the current tab | `chrome.tabs.update(activeTabId, {url})` | supported |
| Move a tab into a split view | — | **no API; out of scope, see §3** |
| Recent history as a source | `chrome.history.search()` | supported; deferred to a later milestone |

## 2. Behaviour

The popup is opened by the configured shortcut and lists open tabs and bookmarks
in a single ranked list. Typing narrows the list; arrow keys (and `Ctrl-N` /
`Ctrl-P`) move the selection; `Enter` activates it.

**Ranking.** With an empty query the list is ordered most-recently-used first,
across both sources: tabs by `Tab.lastAccessed` and bookmarks by
`BookmarkTreeNode.dateLastUsed` (falling back to `dateAdded`). With a non-empty
query, fuzzy match score dominates and recency breaks ties.

**Activation.**

| Selected item | `Enter` | `Shift+Enter` |
| --- | --- | --- |
| Open tab | move the tab to the current window, just right of the active tab, then focus it | focus the tab where it already is, switching windows |
| Bookmark | navigate the active tab to its URL | open it in a new tab |

Neither path reloads an existing tab: `chrome.tabs.move` between two normal
windows preserves the renderer, exactly as dragging the tab does.

**Deduplication.** A bookmark whose URL matches an open tab is collapsed into a
single row that behaves as the tab (switching beats reloading). The row is
labelled as a tab.

## 3. Split view: deferred

Chrome 140 added a read-only `Tab.splitViewId` (with `tabs.SPLIT_VIEW_ID_NONE`
= `-1`) so extensions can *detect* split views, but there is no API to create,
dissolve, or add a tab to one. The gap is tracked upstream in
[w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967) (opened
March 2026, "needs further discussion", no milestone).

We therefore ignore split view entirely for now: when the active tab happens to
be in a split, activation behaves exactly as it does outside one. This is a
conscious deviation from the README's split-view section, to be revisited when
the API lands.

The code is structured so that revisiting is cheap: `core/plan.js` turns a
selection plus a snapshot of browser state into a described action, so split
handling is a new branch in one pure function plus a new case in the executor,
not a change spread across the UI.

## 4. Known platform constraints

- **The popup is anchored to the toolbar icon** and cannot be centred on screen.
  A centred command-palette overlay would require a content script, which does
  not run on `chrome://` pages, the PDF viewer, the Web Store, or other
  extensions' pages — precisely where a tab switcher gets invoked. We accept the
  toolbar popup. Maximum popup size is 800x600.
- **`chrome://` pages.** Per the project decision, we do not special-case them.
  Bookmark activation navigates the active tab even when that tab is a
  `chrome://` page; if Chrome refuses, the error surfaces rather than being
  swallowed.
- **`tabs.move` restrictions.** Only between `windowType: "normal"` windows,
  never across the incognito boundary, and moving the last tab out of a window
  closes that window. Sources are filtered to normal windows for this reason.
- **Shortcut choice.** `Ctrl+Shift+A` is reserved by Chrome's own tab search and
  cannot be taken. We suggest `Ctrl+Shift+K`; users can rebind freely.
- **Favicons.** `chrome://favicon` is gone in MV3. We use the `"favicon"`
  permission with `chrome.runtime.getURL("/_favicon/?pageUrl=…&size=32")`.

## 5. Architecture

Ports and adapters. Every `chrome.*` call lives in `src/adapters/`; everything
interesting is a pure function in `src/core/` that can be unit-tested in Node
with no browser.

```
src/                 <- Chrome loads this directory unpacked; there is no build step
  manifest.json
  core/              pure, no chrome.* — the whole test surface
    items.js         the SearchItem model + normalization from raw API shapes
    fuzzy.js         score / positions, in prepared and convenience forms
    highlight.js     text + matched indices -> runs, for rendering
    rank.js          buildIndex(items) once; rank(index, query) per keystroke
    plan.js          (item, modifiers, browserState) -> Action
  adapters/          the only place chrome.* is touched
    source.js        tabs.query + bookmarks.getTree -> SearchItem[]
    exec.js          Action -> chrome.* calls
  popup/
    index.html
    popup.css
    main.js          wiring: read -> rank on keystroke -> render -> plan -> exec
tests/               vitest; imports src/core/* directly
bench/               timings for the ranking path; npm run bench
```

**No build step.** The sources are plain ES modules that Chrome loads directly,
so the edit/reload cycle is: save the file, press reload in
`chrome://extensions`. Node is a *development* dependency only, used to run
vitest against `src/core/`; the extension itself has zero dependencies and the
test tooling never ships.

**`plan.js` is the keystone.** Selecting an item does not perform an action, it
*returns* one:

```js
{ type: 'focusTab',    tabId, windowId }
{ type: 'moveAndFocus', tabId, toWindowId, index }
{ type: 'navigateActive', tabId, url }
{ type: 'openNewTab',  url, windowId }
```

All of the branching in the spec — tab vs. bookmark, plain vs. `Shift`, and
later split vs. not — becomes a pure function over a small truth table, testable
exhaustively without a browser.

**Fuzzy scoring is swappable.** `core/fuzzy.js` exposes `score(query, text)`,
returning a number or `null` for no match, and `positions(query, text)`,
returning the matched character indices for highlighting. `rank.js` depends only
on those, so the hand-rolled fzy-style scorer can be replaced by `fzf-for-js`,
`uFuzzy`, or anything else by swapping one module. Each also has a "prepared"
form used on the hot path, below.

**Search is fast because of two decisions, both measured** (see
[bench/README.md](bench/README.md); the first version cost 40ms per keystroke at
5,000 items, which is enough to feel):

- *Work that does not depend on the query happens once.* `buildIndex(items)`
  deduplicates and pre-lowercases every candidate when the popup opens;
  `rank(index, query)` then runs per keystroke. Worth ~1.5-2x.
- *The scoring rows are reused, not reallocated.* Allocation, not arithmetic,
  dominated the scorer. Worth ~15x, and the reason `core/` contains its one
  piece of mutable state — documented at `scratch` in `fuzzy.js`.

Ranking now costs ~3ms per keystroke at 5,000 items, so the popup re-ranks
synchronously on every keystroke and does not debounce: debouncing at that cost
would only add latency.

## 6. Milestones

Each milestone ends in a commit.

1. **Skeleton** — manifest, `_execute_action` command, popup that lists all open
   tabs most-recently-used first, no filtering. Establishes the `core`/`adapters`
   split and the item model.
2. **Fuzzy search** — the fzy-style scorer, bookmarks as a second source,
   ranking and deduplication, live narrowing with match highlighting. Unit tests
   for `fuzzy.js` and `rank.js`.
3. **Keyboard and activation** — full key handling, `plan.js` + `exec.js`, the
   `Enter` / `Shift+Enter` table from §2. Unit tests for `plan.js`.
4. **Polish** — favicons, source badges, window indicators, empty and error
   states, popup sizing and scrolling.
5. **Options** (optional) — scoring weights, `Enter` behaviour, sources enabled.
6. **History source** (deferred) — `"history"` permission and a third source;
   the item model already accommodates it.

Split view stays out until the upstream API exists.

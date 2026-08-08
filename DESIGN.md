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
| Search recently closed tabs | `chrome.sessions.getRecentlyClosed()`, `"sessions"` permission | supported; capped at 25 entries by `MAX_SESSION_RESULTS` |
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
| Recently closed tab | restore it, then bring it here and focus it | restore it, then focus it where it landed |

with one exception: a tab that is *already* in the current window is only
focused, never moved. Moving it would drag it across to sit beside the active
tab, silently rearranging a window the user can see, to no benefit.

Neither path reloads an existing tab: `chrome.tabs.move` between two normal
windows preserves the renderer, exactly as dragging the tab does.

**Keys.** `Down`/`Up` and `Ctrl-N`/`Ctrl-P` move the selection, wrapping at both
ends; `Enter` and `Shift+Enter` activate as above; `Escape` closes. Clicking a
row activates it, with `Shift` held for the alternate behaviour. The popup knows
about keys and `core/plan.js` does not: the popup maps `Shift` onto an
`alternate` flag, so the truth table stays free of input concerns.

**Restoring is two steps.** `chrome.sessions.restore` reopens a tab with its
back and forward history intact — the whole advantage over loading the same URL
fresh — but Chrome decides which window it lands in, and that is not knowable
until it has. So `plan` returns a bare `restoreSession` action, the popup
performs it, and then plans a *second* action against the reopened tab, at which
point the open-tab row above applies unchanged. A restored tab therefore behaves
exactly like any other tab without `plan` having to predict where it will be.

**Deduplication.** Items pointing at the same page collapse to the one that
preserves the most state: an open tab beats a recently closed one, which beats a
bookmark. Switching keeps everything, restoring keeps the session history,
loading a bookmark keeps nothing. Two items of the *same* kind survive — two
tabs showing one page are two things to switch between, and two bookmarks of it
are two entries the user made. A kind missing from that ordering sorts last
rather than first, so adding a source and forgetting to rank it makes the new
source lose ties instead of silently hiding open tabs.

**Row anatomy.** Each row carries Chrome's cached favicon, the title, and a
label plus the shortened URL. The label reads `tab`, `recently closed`, the
bookmark's folder path,
or — for a tab living in another window — `other window`, highlighted rather
than muted because that is the one case where activating does something beyond
switching. Both text lines are ellipsized rather than wrapped, so row heights
stay uniform and arrow-key navigation does not feel unsteady; the full title and
URL are on the row's tooltip.

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
- **Shortcut choice.** `suggested_key` accepts only `A`-`Z`, `0`-`9`, and a
  short named list — `Comma`, `Period`, `Home`, `End`, `PageUp`, `PageDown`,
  `Space`, `Insert`, `Delete`, the arrow keys and the media keys — and must
  include `Ctrl` or `Alt`. No other punctuation is legal, so `Ctrl+'` and the
  like cannot be used, in the manifest or via `chrome://extensions/shortcuts`.
  `Ctrl+Shift+A` is additionally reserved by Chrome's own tab search. We suggest
  `Ctrl+Comma`, which Chrome leaves unbound; users can rebind freely.
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

## 6. Popup open latency

Opening the popup felt like a couple of hundred milliseconds. Only part of that
is ours: Chrome creates the popup's window and renderer before a single line of
the extension runs, and that phase is neither measurable from inside the popup
nor influenceable from it. `performance.now()` starts at the popup document, so
everything below is the tail.

`popup/timing.js` marks the steps and can display them in the popup; leave
`SHOW_TIMING` off in normal use, since the marks themselves cost nothing.

Measured tail, in milliseconds:

| Change | to first module | read+index | render+paint | total |
| --- | --- | --- | --- | --- |
| baseline | 61-65 | 13 | 24-28 | 100-105 |
| `modulepreload` for all nine modules | 54 | 14 | 19 | 88 |
| ...and styles inlined into the HTML | 46 | 14 | 26 | 86 |

Two things this overturned. Reading the bookmark tree and building the index —
the costs the previous round of optimisation had been aimed at, and the ones
[bench/README.md](bench/README.md) flagged as the next lever — together account
for about 13ms and are not worth touching. Nearly all of the tail is spent
before the first line of JavaScript runs.

**Kept:** `modulepreload` links in `popup/index.html`, worth ~9ms. Without them
the browser cannot discover a module until it has fetched and parsed whichever
module imports it, so the graph loads as a waterfall. They cost nothing and need
no build step. Keep them in step with the imports in `popup/main.js`.

**Reverted:** inlining the stylesheet. It moved 8ms off the pre-script span and
gave 6ms back at paint, for a net ~2ms, which does not justify losing
`popup.css` as a file.

**Not attempted:** bundling the modules into one file. About 36ms remains in
fetching, compiling and evaluating nine files, and bundling is the only lever
left on it — but it would mean the build step §5 deliberately avoids, trading
the "save the file, press reload" cycle for perhaps 25ms on top of a delay whose
larger half is Chrome's and untouchable. Revisit only if the popup starts
feeling slow in use rather than in a measurement.

Two methods that do *not* work here, recorded so they are not tried again:
Chrome emits no ResourceTiming entries for `chrome-extension://` subresources,
so individual module fetches cannot be timed; and MV3 forbids inline scripts on
extension pages, so an inline `<script>` cannot be used to timestamp anything.

## 7. Milestones

Each milestone ends in a commit.

1. ~~**Skeleton**~~ *(done)* — manifest, `_execute_action` command, popup that
   lists all open tabs most-recently-used first, no filtering. Establishes the
   `core`/`adapters` split and the item model.
2. ~~**Fuzzy search**~~ *(done)* — the fzy-style scorer, bookmarks as a second
   source, ranking and deduplication, live narrowing with match highlighting.
   Unit tests for `fuzzy.js` and `rank.js`.
3. ~~**Keyboard and activation**~~ *(done)* — full key handling, `plan.js` +
   `exec.js`, the `Enter` / `Shift+Enter` table from §2. Unit tests for
   `plan.js`. The extension is usable from here on.
4. ~~**Polish**~~ *(done)* — favicons, a marker on tabs living in another
   window, empty and error states, popup sizing and scrolling.
5. ~~**Recently closed tabs**~~ *(done)* — `"sessions"` permission, a third
   source, restore-then-focus, and deduplication by state preserved.
6. **Options** (optional) — scoring weights, `Enter` behaviour, sources enabled.

## 8. Deferred and future work

Nothing here is blocking; each is recorded so the reasoning is not re-derived.

- **Split view.** No API exists to move a tab into one. See §3.
- **Closed *windows*.** `chrome.sessions.getRecentlyClosed` returns sessions
  that are either a tab or a whole window, and `adapters/source.js` currently
  skips the window ones. Whether they can be flattened into individually
  restorable tabs depends on whether tabs inside a closed window carry their own
  `sessionId`, which the API reference does not say — that needs checking in a
  browser before the shape of the feature can be decided. A window that can only
  be restored whole is a different sort of row from everything else in the list.
- **History as a source.** `"history"` permission and `chrome.history.search`.
  The item model accommodates it, and `KIND_PRECEDENCE` in `rank.js` is where it
  would slot in — below recently closed, since a history entry is a bare URL
  with no state to restore. Worth having because recently closed is capped at 25
  entries and so reaches back minutes, not days.
- **Tabs on other synced devices.** `chrome.sessions.getDevices()`, same
  permission already granted, same item model. Activating one would have to open
  the URL rather than restore, since the tab is on another machine.
- **Publishing to the Chrome Web Store.** Assessed and deferred. The gaps were:
  no icons in the manifest, no `minimum_chrome_version` (MRU silently needs
  Chrome 121), incognito tabs appearing when the extension is allowed in
  incognito and then failing to move, and bookmarked `chrome://` pages which
  `tabs.update` may refuse to navigate to.

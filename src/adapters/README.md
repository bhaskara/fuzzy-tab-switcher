# `src/adapters/` — the Chrome boundary

The only modules in the extension permitted to call `chrome.*`. Keeping the API
surface confined here is what keeps [`../core/`](../core/) pure and testable;
these modules stay correspondingly thin, doing translation and nothing else, so
that little logic is stranded outside the tests.

| Module | Direction | Contents | Milestone |
| --- | --- | --- | --- |
| `source.js` | read | Live browser state to `SearchItem[]`: `chrome.tabs.query` now, `chrome.bookmarks.getTree` from milestone 2. | 1 |
| `exec.js` | write | Performs the `Action` values produced by `core/plan.js` — `chrome.tabs.move`, `update`, `create`, `chrome.windows.update`. | 3 |

Rows past milestone 1 are planned, not yet present.

These modules are not unit-tested: there is nothing to assert about them that
does not amount to asserting that `chrome.*` was called, and they are verified
by using the extension. Anything worth testing belongs in `core/` instead.

# `src/adapters/` — the Chrome boundary

The only modules in the extension permitted to call `chrome.*`. Keeping the API
surface confined here is what keeps [`../core/`](../core/) pure and testable;
these modules stay correspondingly thin, doing translation and nothing else, so
that little logic is stranded outside the tests.

| Module | Direction | Contents |
| --- | --- | --- |
| `source.js` | read | `chrome.tabs.query`, `chrome.bookmarks.getTree`, `chrome.sessions.getRecentlyClosed` and `chrome.history.search` to `SearchItem[]`, plus the current window and active tab that actions are planned against. Reads only the sources the settings enable. |
| `settings.js` | both | `chrome.storage.sync` to and from `Settings`, validated through `core/settings.js` in both directions. |
| `exec.js` | write | Performs the `Action` values produced by `core/plan.js` — `chrome.tabs.move`, `update`, `create`, `chrome.windows.update` and `chrome.sessions.restore`. Returns the reopened tab after a restore, so the caller can plan a follow-up against it. |

Neither module catches anything. Chrome refuses several moves — across the
incognito boundary, or to or from a window that is not a normal one — and the
popup needs to be able to report that rather than appear to have done nothing.

These modules are not unit-tested: there is nothing to assert about them that
does not amount to asserting that `chrome.*` was called, and they are verified
by using the extension. Anything worth testing belongs in `core/` instead.

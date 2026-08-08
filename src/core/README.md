# `src/core/` — pure logic

Every module here is free of `chrome.*` and of the DOM, and every exported
function is pure: same inputs, same outputs, no side effects. That is what lets
[`../../tests/`](../../tests/) exercise the interesting behaviour in Node with
no browser and no mocking of the extension APIs.

Modules take plain objects, not live Chrome objects, so tests can pass literals.

| Module | Contents | Milestone |
| --- | --- | --- |
| `items.js` | The `SearchItem` model and conversions into it from raw Chrome shapes; recency ordering. | 1 |
| `fuzzy.js` | `score(query, text) -> {score, positions} \| null`. Hand-rolled fzy-style scorer, deliberately behind a one-function interface so it can be swapped for `fzf-for-js`, `uFuzzy`, or anything else. | 2 |
| `rank.js` | Items plus a query to an ordered, deduplicated result list. | 2 |
| `plan.js` | A selection plus browser state to a described `Action`, which `adapters/exec.js` then performs. Where the tab-vs-bookmark and `Enter`-vs-`Shift+Enter` truth table lives. | 3 |

Rows past milestone 1 are planned, not yet present.

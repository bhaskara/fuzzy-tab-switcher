# `src/core/` — pure logic

Every module here is free of `chrome.*` and of the DOM, and every exported
function is pure: same inputs, same outputs, no side effects. That is what lets
[`../../tests/`](../../tests/) exercise the interesting behaviour in Node with
no browser and no mocking of the extension APIs.

Modules take plain objects, not live Chrome objects, so tests can pass literals.

| Module | Contents | Milestone |
| --- | --- | --- |
| `items.js` | The `SearchItem` model and conversions into it from raw Chrome shapes; recency ordering. | 1, 5 |
| `fuzzy.js` | `score` and `positions`. Hand-rolled fzy-style scorer, deliberately behind a small interface so it can be swapped for `fzf-for-js`, `uFuzzy`, or anything else. | 2 |
| `highlight.js` | Matched character indices to runs of text, so the popup builds one element per run. | 2 |
| `rank.js` | `buildIndex(items)` once when the popup opens, then `rank(index, query)` on every keystroke, including which kind wins when two items point at one page. | 2, 5 |
| `plan.js` | A selection plus browser state to a described `Action`, which `adapters/exec.js` then performs. Where the item-kind by intent truth table lives, and which window `Ctrl+Enter` targets. | 3, 6 |

## A note on the one exception

`fuzzy.js` holds a module-level scratch buffer, the single piece of mutable
state here. It is a measured optimisation — allocation dominated scoring, and
reusing the rows is worth about 15x — and it is invisible to callers, since
every row is written in full before it is read. See
[`../../bench/README.md`](../../bench/README.md). Do not take it as licence to
add more: it is documented at its definition precisely because it is an
exception.

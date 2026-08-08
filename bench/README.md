# `bench/` — performance measurements

The README asks for search that is "fast and responsive", which is a claim that
has to be checked rather than assumed. This directory holds benchmarks against
synthetic corpora; like [`../tests/`](../tests/) it runs in plain Node against
[`../src/core/`](../src/core/), with no browser involved.

```sh
npm run bench
```

| File | Measures |
| --- | --- |
| `rank.js` | One keystroke's worth of work: `buildIndex` on open, `rank` per keystroke at three corpus sizes, and highlighting the rows actually drawn. |

## What it has caught

The first version of the scorer took ~40ms per keystroke at 5,000 items — bad
enough to feel, and quite invisible without measuring. Two changes fixed it:

| Change | Worth |
| --- | --- |
| Reusing the scoring rows instead of allocating four `Float64Array`s per candidate | ~15x |
| Preparing each candidate's text once on open rather than per keystroke | ~1.5-2x |

Allocation, not arithmetic, was nearly the whole cost — which is the opposite of
where the obvious optimisations pointed. Measure before optimising this code.

Current figures on a 2025 laptop, per keystroke:

| Corpus | `buildIndex` (once) | `rank` (per keystroke) |
| --- | --- | --- |
| 1,100 items | ~9 ms | ~0.7 ms |
| 5,300 items | ~27 ms | ~3 ms |
| 20,500 items | ~103 ms | ~14 ms |

`buildIndex` is the remaining lever if a corpus that large ever needs to feel
instant: it runs once, after the popup's tabs and bookmarks have been read, and
the empty-query view does not actually need the prepared text it spends its time
on, so it could be deferred until the first keystroke.

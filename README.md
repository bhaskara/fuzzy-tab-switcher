# Fuzzy Tab Switcher

A Chrome extension for getting to a page by typing a few characters of its name,
wherever that page happens to be — an open tab in another window, a bookmark, a
tab you closed ten minutes ago, or something from your history.

Chrome already has tab search on `Ctrl+Shift+A`. This differs in three ways:

- **Fuzzy matching, not prefix matching.** `ghb` finds `github.com`. Matches are
  scored, so the ones at word boundaries and after slashes rank first, and the
  matched characters are highlighted in the results.
- **It searches more than open tabs** — bookmarks, recently closed tabs, and
  history, all in one ranked list, with each source switchable off.
- **It brings the page to you.** Choosing a tab from another window *moves* that
  tab into your current window rather than throwing you across to the window it
  was in. If you would rather go to it, `Shift+Enter` does that instead. Moving
  a tab does not reload it — scroll position, form contents and playing media
  all survive.

If you keep two windows side by side, `Ctrl+Enter` sends the chosen page to the
*other* window without moving your focus, so you can load something up over
there and carry on working here.

## Install

Not on the Chrome Web Store. To run it:

1. `git clone https://github.com/bhaskara/fuzzy-tab-switcher`
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked**, and pick the `src/` directory inside the clone.

There is no build step — `src/` is the extension as it ships.

Needs Chrome 121 or newer for the most-recently-used ordering, which relies on
`Tab.lastAccessed`. Everything else works on older versions; that ordering just
degrades.

## Use

Press `Ctrl+,` (rebind at `chrome://extensions/shortcuts`) and start typing. The
list narrows as you type; with an empty query it shows what you used most
recently.

| Key | Does |
| --- | --- |
| `Down` / `Up`, or `Ctrl-N` / `Ctrl-P` | Move through the results |
| `Enter` | Bring it here — move the tab into this window, or open the page in this tab |
| `Shift+Enter` | Go to it instead — switch to the tab where it already is, or open the page in a new tab |
| `Ctrl+Enter` | Put it in the other window, without following it |
| `Escape` | Close |

Clicking a result does the same as `Enter`, and honours the same modifiers.

Open tabs always rank above everything else, so switching to something you
already have open never gets displaced by a bookmark that happens to match
better.

## What it searches

| Source | Notes |
| --- | --- |
| Open tabs | Across every window. |
| Bookmarks | Labelled with their folder. |
| Recently closed tabs | Restored with their back/forward history intact. Chrome caps this at 25, so it reaches back minutes or hours, not days. |
| History | The most recent 3,000 entries by default. |

A page that turns up in more than one source appears once, as whichever version
keeps the most state — an open tab beats a closed one, which beats a bookmark,
which beats a history entry.

The **options page** (on the extension's card in `chrome://extensions`, or
right-click the toolbar icon → Options) turns sources on and off and sets how
much history to load. History is deliberately bounded: searching is linear in
the number of candidates, and a full browsing history would make the popup take
most of a second to open. A source switched off is not read at all, so turning
one off also makes the popup open faster.

## Permissions, and what it does with them

It reads a lot, because searching your tabs and history means reading your tabs
and history. Nothing leaves your browser: there is no server, no analytics, no
network access of any kind, and the extension has no host permissions, so it
cannot read or alter the content of any page.

| Permission | Why |
| --- | --- |
| `tabs` | Read the title and URL of open tabs, and move or activate them. |
| `bookmarks` | Read your bookmarks. Never modifies them. |
| `sessions` | List and restore recently closed tabs. |
| `history` | Read recent history entries. Never modifies them. |
| `storage` | Save your options. |
| `favicon` | Show each result's icon from Chrome's own cache. |

Every one of these can be checked in [`src/`](src/) — roughly 900 lines of plain
JavaScript with no dependencies and no build step, so what you load is exactly
what you can read.

## Limitations

- **Split view is not supported.** Chrome lets an extension *detect* a split
  view but provides no way to move a tab into one, so a tab chosen while you are
  in a split view is handled as it would be outside one. Tracked upstream in
  [w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967).
- **History reaches back only as far as its limit**, 3,000 entries by default.
  Raising it a long way makes the popup noticeably slower to open.
- **At most 50 results are shown** at once, with the rest counted in the status
  line.
- Incognito windows and Chrome's own pages have rough edges; this has been built
  for one person's daily use rather than hardened for everyone's.

## Development

[`dev.md`](dev.md) has the original specification and how to work on it;
[`DESIGN.md`](DESIGN.md) has the architecture, the Chrome APIs it rests on, what
was measured, and what was deliberately left out and why.

```sh
npm install
npm test        # 143 unit tests, no browser needed
npm run bench   # timings for the ranking path
```

Node is only needed for those; the extension itself has no dependencies.

## License

[MIT](LICENSE).

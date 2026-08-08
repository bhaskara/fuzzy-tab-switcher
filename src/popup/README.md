# `src/popup/` — the popup UI

The window opened by the `_execute_action` shortcut (`Ctrl+Comma` by default)
and by clicking the toolbar icon: a search field over a ranked list of tabs and
bookmarks.

| File | Contents |
| --- | --- |
| `index.html` | Markup: the query input, the result list, and a status line. Also the `modulepreload` links — **keep those in step with the imports in `main.js`**, or the module graph goes back to loading as a waterfall. |
| `popup.css` | Styling, including the light/dark palette. Sets the popup width. |
| `main.js` | Wiring only — read via `adapters/`, rank via `core/`, render, and on activation hand the chosen action back to `adapters/`. Logic that could live in `core/` should. |
| `timing.js` | Startup marks, for diagnosing how long the popup takes to open. Off by default; set `SHOW_TIMING` to display the breakdown in the popup. See [../../DESIGN.md](../../DESIGN.md) §6 for what has already been measured and ruled out. |

| Key | Does |
| --- | --- |
| `Down` / `Up`, `Ctrl-N` / `Ctrl-P` | Move the selection, wrapping at both ends. |
| `Enter` | Move the selected tab to this window and focus it, navigate this tab to the selected bookmark, or restore the selected closed tab and bring it here. |
| `Shift+Enter` | Focus the selected tab where it already is, open the selected bookmark in a new tab, or restore the selected closed tab where it landed. |
| `Escape` | Close. |

Clicking a row activates it, with `Shift` held for the alternate behaviour.

Only this directory knows about keys: `Shift` is mapped to an `alternate` flag
before `core/plan.js` sees it, so the behaviour table stays free of input
concerns and can be rebound here alone.

Chrome anchors the popup to the toolbar icon; it cannot be centred on screen,
and it closes whenever it loses focus. Maximum size is 800x600, and the popup
sizes itself to its content, so the width is set on `body` in `popup.css`.

To debug it, right-click the toolbar icon and choose **Inspect popup** — the
popup stays open while its devtools window has focus.

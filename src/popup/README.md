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
| `Enter` | Bring the item into this window: move the tab here and focus it, navigate this tab to the bookmark, or restore the closed tab here. |
| `Shift+Enter` | Go to the item instead: focus the tab where it already is, or open the bookmark in a new tab here. |
| `Ctrl+Enter` | Put the item in the *other* window without following it — window focus does not move. Reports `No other window` and stays open if there is only one. |
| `Escape` | Close. |

Clicking a row activates it, honouring the same modifiers. Shift wins over Ctrl
when both are held.

Only this directory knows about keys: the modifiers are mapped to one of three
named intents — `here`, `inPlace`, `otherWindow` — before `core/plan.js` sees
them, so the behaviour table stays free of input concerns and can be rebound
here alone.

Chrome anchors the popup to the toolbar icon; it cannot be centred on screen,
and it closes whenever it loses focus. Maximum size is 800x600, and the popup
sizes itself to its content, so the width is set on `body` in `popup.css`.

To debug it, right-click the toolbar icon and choose **Inspect popup** — the
popup stays open while its devtools window has focus.

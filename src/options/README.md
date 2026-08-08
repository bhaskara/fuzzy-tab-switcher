# `src/options/` — the options page

Embedded in `chrome://extensions` (via `options_ui` with `open_in_tab: false`),
reachable from the extension's card or by right-clicking the toolbar icon.

| File | Contents |
| --- | --- |
| `index.html` | The form: a checkbox per source, and the history length. |
| `options.css` | Styling. The colour tokens are duplicated from `../popup/popup.css` on purpose — see the comment at the top of the file. |
| `options.js` | Wiring only. What the settings *are* and what counts as valid live in [`../core/settings.js`](../core/settings.js); storage lives in [`../adapters/settings.js`](../adapters/settings.js). |

There is no Save button: each change is written as it is made, and the status
line confirms it so that saving stays visible rather than merely implied.

After saving, the form is refilled from the settings as actually stored rather
than from what was typed. That is what makes clamping visible — entering 99999
for the history length leaves the field showing the maximum, instead of the page
disagreeing silently with what the popup will do.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Sources | all on | A source switched off is not read at all, so turning one off also makes the popup open faster. |
| History length | 3000 | Bounded because ranking is linear in the number of candidates. See [`../../bench/README.md`](../../bench/README.md) for the measurements behind the warning threshold. |

# `src/` — the extension itself

This directory *is* the extension. There is no build step: `manifest.json` lives
here and Chrome loads this directory directly via **Load unpacked** in
`chrome://extensions` with Developer mode on. The edit/reload cycle is save the
file, press the reload button on the extension card.

Everything here is plain ES modules with no dependencies. Node and vitest are
development tooling for [`../tests/`](../tests/) and [`../bench/`](../bench/)
only, and never ship.

| Path | Contents |
| --- | --- |
| `manifest.json` | MV3 manifest: permissions, the service worker, the popup action, and the `_execute_action` shortcut. |
| `background.js` | Service worker. Holds only the work that must outlive the popup — see [../DESIGN.md](../DESIGN.md) §4. |
| `messages.js` | The contract between the popup and the worker, imported by both so neither imports the other. |
| `core/` | Pure logic — no `chrome.*`, no DOM. The whole unit-test surface. |
| `adapters/` | The only modules that call `chrome.*`. |
| `popup/` | The popup UI: markup, styles, and the wiring between core and adapters. |

The layering rule is one-directional: `popup/` and `background.js` may import
from `adapters/` and `core/`, `adapters/` may import from `core/`, and `core/`
imports nothing. The popup and the worker never import each other — they share
only `messages.js`. See [../DESIGN.md](../DESIGN.md) §5 for why.

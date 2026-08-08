# Fuzzy Tab Switcher

This is a Chrome extension that allows rapidly opening/switching tabs/bookmarks in Chrome with a keyboard based workflow.

The basic command is switch-to.  The idea is when this is invoked (using some customizable keyboard shortcut), a pop-up opens, that is similar to the usual control-shift-a "Search tabs" command.  However, it differs in a couple of ways:
1. It uses fuzzy matching, rather than just matching on the prefix of the name.  
2. It searches over currently open tabs (across all windows) as well as bookmark items (and in future maybe recent history items as well).

Like with the usual "search tabs", as the user types the set of options narrows.  This needs to be fast and responsive.  At any point the user can use arrow keys to move between the current options and can hit enter to choose one.

Now, once an option is selected, there are a few possibilities for what happens.  Let's start with the case where we're not in tab split view.
1. If the item is a currently open tab, that tab is moved to the current window, and then we switch to it.  There is no reloading of the page so this should be fast.
2. If the item is a bookmark item that is not currently open, then the current tab browses to that page (just like opening that bookmark directly).

In tab split view:
1. If the selected item is a currently open tab, that tab is moved into the split view (whichever side we're currently on).
2. If it is a bookmark item, we browse to that.

## Status

Recently closed tabs and history are both searched as well, the latter bounded
to a configurable number of entries. Which sources to search, and how much
history to load, are set on the extension's options page.

The split-view behaviour above is **not implemented and not currently
implementable**: Chrome exposes a read-only `Tab.splitViewId` but no API to move
a tab into a split view. It is deferred until
[w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967) lands.
Everything else is in progress; see [DESIGN.md](DESIGN.md) for the API-by-API
feasibility table, the decisions taken, and the milestone plan.

## Repository layout

| Path | Contents |
| --- | --- |
| [`src/`](src/) | The extension. Load this directory unpacked in `chrome://extensions`; there is no build step. |
| [`tests/`](tests/) | Vitest unit tests for the pure core. |
| [`bench/`](bench/) | Timings for the ranking path, which the "fast and responsive" requirement above needs checked rather than assumed. |
| [`DESIGN.md`](DESIGN.md) | Design, platform constraints, and milestones. |
| [`LICENSE`](LICENSE) | MIT. |

## Development

Load `src/` via **Load unpacked** in `chrome://extensions` with Developer mode
on; after editing a file, press reload on the extension card. Rebind the
shortcut (default `Ctrl+Comma`) at `chrome://extensions/shortcuts`.

Node is needed only to run the tests and benchmarks, never to build or run the
extension:

```sh
npm install
npm test
npm run bench
```

## License

[MIT](LICENSE).


# `tests/` — unit tests

[Vitest](https://vitest.dev) tests covering [`../src/core/`](../src/core/). One
file per core module, named `<module>.test.js`.

```sh
npm install     # once
npm test        # single run
npm run test:watch
```

These run in plain Node with no browser and no stubbing of `chrome.*`: core
functions take plain objects, so a test can hand `tabToItem` a literal shaped
like a `chrome.tabs.Tab`. That property is worth protecting — if a core module
ever needs the extension APIs mocked, the logic has leaked out of `core/` and
belongs behind an adapter instead.

`../src/adapters/` is deliberately untested; see
[its README](../src/adapters/README.md) for why.

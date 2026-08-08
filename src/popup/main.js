// Popup entry point: reads browser state through the adapter layer, ranks it
// with core, renders the result list, and on activation hands the chosen action
// back to the adapter layer. Wiring only — anything worth testing belongs in
// core/ instead.

import { execute } from '../adapters/exec.js';
import { readAll, readBrowserState } from '../adapters/source.js';
import { positions } from '../core/fuzzy.js';
import { toSegments } from '../core/highlight.js';
import { KIND_CLOSED_TAB, KIND_TAB, tabToItem } from '../core/items.js';
import { plan } from '../core/plan.js';
import { buildIndex, rank } from '../core/rank.js';
import { mark, report } from './timing.js';

mark('modules');

/**
 * How many results to put in the DOM. Ranking is cheap and runs over
 * everything; building thousands of elements is not, and no user scrolls that
 * far. When the cap bites, the status line says so rather than pretending the
 * list is complete.
 */
const MAX_RENDERED = 50;

/**
 * Base of Chrome's cached-favicon endpoint, which the `"favicon"` permission
 * grants. The old `chrome://favicon` scheme does not exist under MV3.
 */
const FAVICON_BASE = chrome.runtime.getURL('/_favicon/');

const queryEl = document.getElementById('query');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');

/** Every candidate, prepared for matching once when the popup opens. */
let index = [];

/** The browser state actions are planned against, read once when the popup opens. */
let browserState = null;

/** The results currently in the DOM, best first. */
let shown = [];

/** The row elements, parallel to {@link shown}. */
let rowEls = [];

/** Index into {@link shown} of the highlighted row. */
let selected = 0;

/**
 * Append `text` to `parent`, wrapping matched runs in `<mark>`.
 *
 * Text is added as text nodes, never as markup: titles and URLs are
 * attacker-influenced strings and the popup must not interpret them as HTML.
 *
 * @param {HTMLElement} parent
 * @param {string} text
 * @param {number[]|null} matchedIndices Indices from `fuzzy.positions`.
 * @returns {void}
 */
function appendHighlighted(parent, text, matchedIndices) {
  for (const segment of toSegments(text, matchedIndices)) {
    if (segment.matched) {
      const mark = document.createElement('mark');
      mark.textContent = segment.text;
      parent.append(mark);
    } else {
      parent.append(document.createTextNode(segment.text));
    }
  }
}

/**
 * Whether activating this item would pull a tab in from another window.
 *
 * @param {import('../core/items.js').SearchItem} item
 * @returns {boolean} False until the browser state has been read.
 */
function isElsewhere(item) {
  return (
    item.kind === KIND_TAB &&
    browserState !== null &&
    item.windowId !== browserState.currentWindowId
  );
}

/**
 * Short label describing where an item came from.
 *
 * A tab living in another window says so rather than saying `tab`, because that
 * is the case where activating it does something extra — it gets moved into
 * this window. Nothing else produces that label, so a row marked this way is
 * still unambiguously a tab.
 *
 * @param {import('../core/items.js').SearchItem} item
 * @returns {string}
 */
function kindLabel(item) {
  if (item.kind === KIND_CLOSED_TAB) return 'recently closed';
  if (item.kind !== KIND_TAB) return item.folderPath || 'bookmark';
  return isElsewhere(item) ? 'other window' : 'tab';
}

/**
 * URL of Chrome's cached favicon for a page.
 *
 * Chrome serves a generic globe for pages it has no icon for, so there is no
 * missing-icon case to handle. The icon is fetched at twice its 16px display
 * size so that it stays crisp on hidpi screens.
 *
 * @param {string} pageUrl The page whose icon is wanted.
 * @returns {string} An extension URL, safe to use as an `img` source.
 */
function faviconUrl(pageUrl) {
  // Built by concatenation, and the base resolved once at load: this runs for
  // every drawn row on every keystroke, which is no place for a URL object and
  // an extension API call.
  return `${FAVICON_BASE}?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
}

/**
 * Build the list element for a single ranked item.
 *
 * @param {import('../core/rank.js').RankedItem} ranked
 * @param {string} query The trimmed query, for highlighting. Empty for none.
 * @param {number} position Index into {@link shown}, used for click handling.
 * @returns {HTMLLIElement}
 */
function renderResult(ranked, query, position) {
  const { item } = ranked;

  const li = document.createElement('li');
  li.className = 'result';
  li.id = `result-${position}`;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', 'false');
  // Both text lines are ellipsized, so hovering is the only way to read a long
  // title or URL in full.
  li.title = item.title ? `${item.title}\n${item.url}` : item.url;

  const icon = document.createElement('img');
  icon.className = 'result-icon';
  icon.src = faviconUrl(item.url);
  // Decorative: the title beside it already names the page.
  icon.alt = '';

  const title = document.createElement('span');
  title.className = 'result-title';
  appendHighlighted(title, item.title || item.display, query ? positions(query, item.title) : null);

  const kind = document.createElement('span');
  kind.className = 'result-kind';
  kind.textContent = kindLabel(item);
  kind.classList.toggle('result-kind-elsewhere', isElsewhere(item));

  const url = document.createElement('span');
  url.className = 'result-url';
  appendHighlighted(url, item.display, query ? positions(query, item.display) : null);

  const sub = document.createElement('span');
  sub.className = 'result-sub';
  sub.append(kind, url);

  li.append(icon, title, sub);
  return li;
}

/**
 * Show a message under the results, or clear it.
 *
 * @param {string|null} message Message to show, or null to hide the line.
 * @param {{error?: boolean}} [options] `error` styles the line as a failure
 *   rather than as ordinary information.
 * @returns {void}
 */
function setStatus(message, { error = false } = {}) {
  statusEl.textContent = message ?? '';
  statusEl.hidden = message === null;
  statusEl.classList.toggle('status-error', error);
}

/**
 * Move the highlight to `position`, scrolling it into view.
 *
 * @param {number} position Index into {@link shown}. Out-of-range values are
 *   ignored, so callers need not check an empty list.
 * @returns {void}
 */
function select(position) {
  if (position < 0 || position >= rowEls.length) return;
  rowEls[selected]?.setAttribute('aria-selected', 'false');
  selected = position;
  const el = rowEls[selected];
  el.setAttribute('aria-selected', 'true');
  el.scrollIntoView({ block: 'nearest' });
  queryEl.setAttribute('aria-activedescendant', el.id);
}

/**
 * Move the highlight by `delta` rows, wrapping at both ends.
 *
 * Wrapping means one press of Up from the top reaches the last result, which is
 * how every other launcher behaves.
 *
 * @param {number} delta
 * @returns {void}
 */
function moveSelection(delta) {
  if (rowEls.length === 0) return;
  select((selected + delta + rowEls.length) % rowEls.length);
}

/**
 * Re-rank against the current query and redraw the list.
 *
 * @returns {void}
 */
function refresh() {
  const query = queryEl.value.trim();
  const ranked = rank(index, query);
  shown = ranked.slice(0, MAX_RENDERED);

  rowEls = shown.map((entry, i) => renderResult(entry, query, i));
  resultsEl.replaceChildren(...rowEls);
  resultsEl.scrollTop = 0;
  selected = 0;
  select(0);

  if (ranked.length === 0) {
    setStatus(query ? `No tab or bookmark matches “${query}”` : 'No tabs or bookmarks to show');
  } else if (ranked.length > shown.length) {
    setStatus(`Showing ${shown.length} of ${ranked.length}`);
  } else {
    setStatus(null);
  }
}

/**
 * Act on the highlighted result and close the popup.
 *
 * @param {boolean} alternate Whether the secondary behaviour was requested.
 * @returns {Promise<void>}
 */
async function activate(alternate) {
  const entry = shown[selected];
  if (!entry || browserState === null) return;
  const modifiers = { alternate };
  try {
    const restored = await execute(plan(entry.item, modifiers, browserState));
    // Restoring a closed tab only reopens it; Chrome decides which window it
    // lands in, and that is not knowable until it has. Planning a second action
    // against the reopened tab is what makes a restored tab behave like any
    // other tab — brought here on Enter, left in place on Shift+Enter.
    if (restored !== null) {
      await execute(plan(tabToItem(restored), modifiers, browserState));
    }
  } catch (err) {
    // Chrome refuses some moves — across the incognito boundary, for instance.
    // Say so and stay open rather than closing as though it had worked.
    setStatus(`Could not switch: ${err.message}`, { error: true });
    throw err;
  }
  window.close();
}

/**
 * Handle a key pressed in the search field.
 *
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function onKeyDown(event) {
  const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;

  if (event.key === 'ArrowDown' || (ctrl && event.key === 'n')) {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === 'ArrowUp' || (ctrl && event.key === 'p')) {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    activate(event.shiftKey);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    window.close();
  }
}

async function main() {
  queryEl.focus();
  // Re-rank synchronously on every keystroke. At a few thousand candidates this
  // costs about three milliseconds, so debouncing would only add latency.
  queryEl.addEventListener('input', refresh);
  queryEl.addEventListener('keydown', onKeyDown);

  // Keep the caret in the search field when a result is clicked.
  resultsEl.addEventListener('mousedown', (event) => event.preventDefault());
  resultsEl.addEventListener('click', (event) => {
    const row = event.target.closest('.result');
    if (!row) return;
    select(rowEls.indexOf(row));
    activate(event.shiftKey);
  });

  // Normally replaced within milliseconds, but a very large bookmark tree or a
  // busy browser should not leave the popup looking empty and broken.
  setStatus('Loading…');

  try {
    const [items, state] = await Promise.all([readAll(), readBrowserState()]);
    mark('sources');
    browserState = state;
    index = buildIndex(items);
    mark('index');
    refresh();
    mark('render');
    console.log(`[tab-switcher] ${items.length} items, ${index.length} after dedup`);
    // The frame after the first render is the first the user could actually see.
    requestAnimationFrame(() => {
      mark('paint');
      report(document.getElementById('timing'));
    });
  } catch (err) {
    // The popup is the only surface a user ever sees, so an adapter failure has
    // to be shown rather than swallowed. Re-thrown for the devtools console.
    setStatus(`Could not read tabs and bookmarks: ${err.message}`, { error: true });
    throw err;
  }
}

main();

// Popup entry point: reads browser state through the adapter layer, ranks it
// with core, renders the result list, and on activation hands the chosen action
// back to the adapter layer. Wiring only — anything worth testing belongs in
// core/ instead.

import { execute } from '../adapters/exec.js';
import { readAll, readBrowserState } from '../adapters/source.js';
import { positions } from '../core/fuzzy.js';
import { toSegments } from '../core/highlight.js';
import { KIND_TAB } from '../core/items.js';
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
 * Short label describing where an item came from.
 *
 * @param {import('../core/items.js').SearchItem} item
 * @returns {string}
 */
function kindLabel(item) {
  if (item.kind === KIND_TAB) return 'tab';
  return item.folderPath || 'bookmark';
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

  const title = document.createElement('span');
  title.className = 'result-title';
  appendHighlighted(title, item.title || item.display, query ? positions(query, item.title) : null);

  const kind = document.createElement('span');
  kind.className = 'result-kind';
  kind.textContent = kindLabel(item);

  const url = document.createElement('span');
  url.className = 'result-url';
  appendHighlighted(url, item.display, query ? positions(query, item.display) : null);

  const sub = document.createElement('span');
  sub.className = 'result-sub';
  sub.append(kind, url);

  li.append(title, sub);
  return li;
}

/**
 * Show a message under the results, or clear it.
 *
 * @param {string|null} message Message to show, or null to hide the line.
 * @returns {void}
 */
function setStatus(message) {
  statusEl.textContent = message ?? '';
  statusEl.hidden = message === null;
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
    setStatus(query ? 'No matches' : 'Nothing to show');
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
  try {
    await execute(plan(entry.item, { alternate }, browserState));
  } catch (err) {
    // Chrome refuses some moves — across the incognito boundary, for instance.
    // Say so and stay open rather than closing as though it had worked.
    setStatus(`Could not switch: ${err.message}`);
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
    setStatus(`Could not read tabs and bookmarks: ${err.message}`);
    throw err;
  }
}

main();

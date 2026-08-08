// Popup entry point: reads browser state through the adapter layer, ranks it
// with core, and renders the result list, re-ranking on every keystroke.
// Keyboard navigation and activation arrive in milestone 3; for now the first
// result is shown as selected but nothing acts on it.

import { readAll } from '../adapters/source.js';
import { positions } from '../core/fuzzy.js';
import { toSegments } from '../core/highlight.js';
import { KIND_TAB } from '../core/items.js';
import { buildIndex, rank } from '../core/rank.js';

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
 * @param {boolean} selected Whether to render the row as the current selection.
 * @returns {HTMLLIElement}
 */
function renderResult(ranked, query, selected) {
  const { item } = ranked;

  const li = document.createElement('li');
  li.className = 'result';
  li.id = `result-${item.key}`;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', String(selected));

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
 * Re-rank against the current query and redraw the list.
 *
 * @returns {void}
 */
function refresh() {
  const query = queryEl.value.trim();
  const ranked = rank(index, query);
  const shown = ranked.slice(0, MAX_RENDERED);

  const list = document.createDocumentFragment();
  shown.forEach((entry, i) => list.append(renderResult(entry, query, i === 0)));
  resultsEl.replaceChildren(list);
  resultsEl.scrollTop = 0;

  if (ranked.length === 0) {
    setStatus(query ? 'No matches' : 'Nothing to show');
  } else if (ranked.length > shown.length) {
    setStatus(`Showing ${shown.length} of ${ranked.length}`);
  } else {
    setStatus(null);
  }
}

async function main() {
  queryEl.focus();
  // Re-rank synchronously on every keystroke. At a few thousand candidates this
  // costs a couple of milliseconds, so debouncing would only add latency.
  queryEl.addEventListener('input', refresh);
  try {
    index = buildIndex(await readAll());
    refresh();
  } catch (err) {
    // The popup is the only surface a user ever sees, so an adapter failure has
    // to be shown rather than swallowed. Re-thrown for the devtools console.
    setStatus(`Could not read tabs and bookmarks: ${err.message}`);
    throw err;
  }
}

main();

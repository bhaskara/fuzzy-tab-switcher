// Popup entry point: reads browser state through the adapter layer, ranks it
// with core, and renders the result list. Milestone 1 renders every open tab
// most-recently-used first; the search field is not yet wired up, and keyboard
// activation arrives in milestone 3.

import { readTabs } from '../adapters/source.js';
import { byRecencyDesc } from '../core/items.js';

const queryEl = document.getElementById('query');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');

/**
 * Build the list element for a single item.
 *
 * All text is set via `textContent`, never `innerHTML`: titles and URLs are
 * attacker-influenced strings and the popup must not interpret them as markup.
 *
 * @param {import('../core/items.js').SearchItem} item
 * @param {boolean} selected Whether to render the row as the current selection.
 * @returns {HTMLLIElement}
 */
function renderResult(item, selected) {
  const li = document.createElement('li');
  li.className = 'result';
  li.id = `result-${item.key}`;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', String(selected));

  const title = document.createElement('span');
  title.className = 'result-title';
  title.textContent = item.title || item.url;

  const url = document.createElement('span');
  url.className = 'result-url';
  url.textContent = item.url;

  li.append(title, url);
  return li;
}

/**
 * Replace the contents of the result list.
 *
 * @param {import('../core/items.js').SearchItem[]} items Items in display
 *   order. The first is rendered as selected.
 * @returns {void}
 */
function renderResults(items) {
  const list = document.createDocumentFragment();
  items.forEach((item, i) => list.append(renderResult(item, i === 0)));
  resultsEl.replaceChildren(list);
}

/**
 * Show a message in place of results, or clear it.
 *
 * @param {string|null} message Message to show, or null to hide the line.
 * @returns {void}
 */
function setStatus(message) {
  statusEl.textContent = message ?? '';
  statusEl.hidden = message === null;
}

async function main() {
  queryEl.focus();
  try {
    const items = (await readTabs()).toSorted(byRecencyDesc);
    renderResults(items);
    setStatus(items.length === 0 ? 'No open tabs' : null);
  } catch (err) {
    // The popup is the only surface a user ever sees, so an adapter failure has
    // to be shown rather than swallowed. Re-thrown for the devtools console.
    setStatus(`Could not read tabs: ${err.message}`);
    throw err;
  }
}

main();

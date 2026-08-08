// Options page: which sources to search, and how much history to load.
//
// Wiring only, like the popup — the shape of the settings and what counts as
// valid live in core/settings.js, and storage lives in adapters/settings.js.
//
// There is no Save button. Every change is written as it is made, which is one
// less thing to forget; the status line confirms it so that saving is still
// visible rather than merely implied.

import { readSettings, writeSettings } from '../adapters/settings.js';
import { HISTORY_LIMIT_COMFORTABLE, MAX_HISTORY_LIMIT, normalizeSettings } from '../core/settings.js';

const formEl = document.getElementById('settings');
const historyLimitEl = document.getElementById('historyLimit');
const historyHintEl = document.getElementById('historyHint');
const statusEl = document.getElementById('status');

const SOURCE_NAMES = ['tabs', 'bookmarks', 'closed', 'history'];

/**
 * Read the form back as a settings object.
 *
 * Not validated here: `writeSettings` normalizes, so the form is free to hold
 * a half-typed number without this having to guess what the user meant by it.
 *
 * @returns {import('../core/settings.js').Settings}
 */
function readForm() {
  const sources = {};
  for (const name of SOURCE_NAMES) sources[name] = formEl.elements[name].checked;
  return { sources, historyLimit: Number(historyLimitEl.value) };
}

/**
 * Put settings into the form.
 *
 * @param {import('../core/settings.js').Settings} settings
 * @returns {void}
 */
function fillForm(settings) {
  for (const name of SOURCE_NAMES) formEl.elements[name].checked = settings.sources[name];
  historyLimitEl.value = String(settings.historyLimit);
}

/**
 * Describe what the current history length costs, warning past the measured
 * comfortable threshold.
 *
 * @param {import('../core/settings.js').Settings} settings
 * @returns {void}
 */
function updateHistoryHint(settings) {
  const { historyLimit, sources } = settings;
  let text;
  let warn = false;

  if (!sources.history || historyLimit === 0) {
    text = 'History is not being searched.';
  } else if (historyLimit > HISTORY_LIMIT_COMFORTABLE) {
    text =
      `Above about ${HISTORY_LIMIT_COMFORTABLE.toLocaleString()} entries the popup ` +
      'takes noticeably longer to open and to respond to typing. ' +
      `The maximum is ${MAX_HISTORY_LIMIT.toLocaleString()}.`;
    warn = true;
  } else {
    text =
      'Only the most recent entries are loaded, because searching is linear in ' +
      'the number of them. The default of 3,000 reaches back weeks for most people.';
  }

  historyHintEl.textContent = text;
  historyHintEl.classList.toggle('hint-warn', warn);
}

/**
 * Show a message under the form.
 *
 * @param {string} message
 * @param {{error?: boolean}} [options]
 * @returns {void}
 */
function setStatus(message, { error = false } = {}) {
  statusEl.textContent = message;
  statusEl.classList.toggle('status-error', error);
}

/**
 * Save the form, then show the settings as actually stored.
 *
 * Writing back what was stored, rather than what was typed, is what makes
 * clamping visible: entering 99999 leaves the field showing the maximum rather
 * than silently disagreeing with what the popup will do.
 *
 * @returns {Promise<void>}
 */
async function save() {
  const settings = normalizeSettings(readForm());
  try {
    await writeSettings(settings);
  } catch (err) {
    setStatus(`Could not save: ${err.message}`, { error: true });
    throw err;
  }
  fillForm(settings);
  updateHistoryHint(settings);
  setStatus('Saved');
}

async function main() {
  const settings = await readSettings();
  fillForm(settings);
  updateHistoryHint(settings);

  // `change` rather than `input`, so a number is saved when the field is left
  // rather than after each digit — typing 3000 would otherwise pass through 3,
  // 30 and 300, saving each.
  formEl.addEventListener('change', () => {
    save();
  });
}

main();

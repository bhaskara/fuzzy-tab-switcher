// Startup timing, for working out where the delay between pressing the shortcut
// and seeing the list actually goes.
//
// Only part of that delay is ours. Chrome has to create the popup's window and
// renderer before a single line of this extension runs, and nothing here can
// measure or influence that: `performance.now()` counts from the moment the
// popup document began loading, so everything reported here is the *tail* of
// the delay. Subtracting the reported total from the delay you perceive gives a
// rough figure for Chrome's share.

/**
 * Whether to show the breakdown in the popup. Leave off in normal use; the
 * marks themselves cost nothing, so only the display is conditional.
 */
const SHOW_TIMING = true;

/** Marks recorded so far, in the order they were taken. */
const marks = [];

/**
 * Record the time at which some startup step finished.
 *
 * @param {string} label What just finished, as a short noun phrase.
 * @returns {void}
 */
export function mark(label) {
  marks.push({ label, at: performance.now() });
}

/**
 * Format the marks as durations between consecutive steps.
 *
 * @returns {string} For example `modules 12 · sources 48 · index 27 · total 87`,
 *   in milliseconds. Empty if nothing was marked.
 */
export function summary() {
  if (marks.length === 0) return '';
  const parts = [];
  let previous = 0;
  for (const { label, at } of marks) {
    parts.push(`${label} ${Math.round(at - previous)}`);
    previous = at;
  }
  parts.push(`total ${Math.round(marks[marks.length - 1].at)}`);
  return `${parts.join(' · ')} ms`;
}

/**
 * Break down everything that happened before the first mark.
 *
 * That span covers creating the document, parsing the HTML, fetching the
 * stylesheet, and fetching, compiling and evaluating the module graph — and
 * they want very different fixes, so this separates them. In particular, if the
 * resources overlap and finish early, the remaining time is fixed renderer and
 * compile cost and bundling the modules would not help.
 *
 * @returns {string[]} One line per resource, plus a trailing line for whatever
 *   time is not accounted for by any of them.
 */
function resourceLines() {
  const [navigation] = performance.getEntriesByType('navigation');
  const entries = [];
  if (navigation) entries.push({ name: 'document', entry: navigation });
  for (const entry of performance.getEntriesByType('resource')) {
    entries.push({ name: entry.name.replace(/^.*\//, ''), entry });
  }

  const lines = entries.map(
    ({ name, entry }) =>
      `${name.padEnd(14)}${Math.round(entry.startTime).toString().padStart(4)}` +
      ` -> ${Math.round(entry.responseEnd).toString().padStart(4)} ms`,
  );

  const lastResponse = Math.max(0, ...entries.map(({ entry }) => entry.responseEnd));
  const firstMark = marks.length > 0 ? marks[0].at : 0;
  lines.push(`${'compile+eval'.padEnd(14)}${Math.round(lastResponse).toString().padStart(4)}` +
    ` -> ${Math.round(firstMark).toString().padStart(4)} ms`);
  return lines;
}

/**
 * Show the breakdown, if enabled, and log it for the popup's devtools console.
 *
 * Everything is rendered into the popup itself rather than only logged, because
 * opening devtools to read the console distorts the very numbers being read.
 *
 * @param {HTMLElement} target Element to write the summary into.
 * @returns {void}
 */
export function report(target) {
  const text = [summary(), ...resourceLines()].join('\n');
  console.log(`[tab-switcher] startup:\n${text}`);
  if (!SHOW_TIMING) return;
  target.textContent = text;
  target.hidden = false;
}

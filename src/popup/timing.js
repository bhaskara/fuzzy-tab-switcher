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
 * Show the breakdown, if enabled, and log it for the popup's devtools console.
 *
 * @param {HTMLElement} target Element to write the summary into.
 * @returns {void}
 */
export function report(target) {
  const text = summary();
  console.log(`[tab-switcher] startup: ${text}`);
  if (!SHOW_TIMING) return;
  target.textContent = text;
  target.hidden = false;
}

// User settings: defaults, validation, and the shape both the options page and
// the popup agree on. Pure — storage lives in adapters/settings.js.

/** Key the settings object is stored under. */
export const SETTINGS_KEY = 'settings';

/**
 * Largest history length accepted.
 *
 * Ranking is linear in the number of candidates, and past roughly ten thousand
 * the popup is unusable whatever else is done — see bench/README.md. This is a
 * guard rail well above anything sensible rather than a recommendation.
 */
export const MAX_HISTORY_LIMIT = 20_000;

/**
 * History length above which the popup starts to feel slow.
 *
 * Measured, not guessed: around 5,000 total candidates the index takes ~36ms to
 * build on every open and each keystroke costs ~4ms. The options page warns
 * above this rather than refusing.
 */
export const HISTORY_LIMIT_COMFORTABLE = 5_000;

/**
 * What the user can configure.
 *
 * @typedef {Object} Settings
 * @property {{tabs: boolean, bookmarks: boolean, closed: boolean, history: boolean}} sources
 *   Which sources to search.
 * @property {number} historyLimit How many history entries to load. 0 is
 *   equivalent to disabling the history source.
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = Object.freeze({
  sources: Object.freeze({ tabs: true, bookmarks: true, closed: true, history: true }),
  historyLimit: 3000,
});

/**
 * Coerce anything read from storage into valid {@link Settings}.
 *
 * Storage is not a trusted source: it survives extension upgrades that change
 * this shape, it can be edited, and it is empty on first run. Rather than
 * failing — which would leave the user with no way to search at all — every
 * field falls back to its default, so a corrupt or partial object degrades to
 * a working one.
 *
 * @param {unknown} raw Whatever came out of storage, including undefined.
 * @returns {Settings} A frozen, valid settings object. `historyLimit` is
 *   rounded and clamped to `[0, MAX_HISTORY_LIMIT]`; unknown keys are dropped.
 *
 * Postconditions
 * --------------
 * The result is always usable: every source flag is a boolean and
 * `historyLimit` is a non-negative integer.
 */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const sources = source.sources !== null && typeof source.sources === 'object' ? source.sources : {};

  const flag = (name) =>
    typeof sources[name] === 'boolean' ? sources[name] : DEFAULT_SETTINGS.sources[name];

  const rawLimit = source.historyLimit;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.round(rawLimit), 0), MAX_HISTORY_LIMIT)
    : DEFAULT_SETTINGS.historyLimit;

  return Object.freeze({
    sources: Object.freeze({
      tabs: flag('tabs'),
      bookmarks: flag('bookmarks'),
      closed: flag('closed'),
      history: flag('history'),
    }),
    historyLimit: limit,
  });
}

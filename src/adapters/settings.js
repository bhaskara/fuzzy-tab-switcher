// Reading and writing user settings. One of the modules permitted to call
// chrome.*; the validation it leans on is pure and lives in core/settings.js.

import { SETTINGS_KEY, normalizeSettings } from '../core/settings.js';

/**
 * Read the user's settings.
 *
 * `chrome.storage.sync` rather than `local` so that settings follow the user
 * between machines. It works whether or not the user is signed in, falling back
 * to local storage.
 *
 * @returns {Promise<import('../core/settings.js').Settings>} Always valid: a
 *   first run, a partial object, or anything unexpected in storage yields the
 *   defaults rather than an error, since the popup is unusable without
 *   settings and has nowhere good to report the failure.
 */
export async function readSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

/**
 * Save the user's settings.
 *
 * Normalized on the way in as well as on the way out, so that nothing invalid
 * is ever written, whatever the options page sends.
 *
 * @param {import('../core/settings.js').Settings} settings
 * @returns {Promise<void>} Resolves once written.
 *
 * Throws
 * ------
 * Error
 *     If the write fails — over quota, for instance. The options page shows
 *     this, since a silently unsaved setting is worse than a visible failure.
 */
export async function writeSettings(settings) {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

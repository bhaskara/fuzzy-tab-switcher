// Ranking: turning the full set of candidate items plus the user's query into
// the ordered list the popup draws.
//
// Work that does not depend on the query — deduplication, and preparing each
// item's text for matching — happens once in `buildIndex`, not on every
// keystroke. See ../../DESIGN.md §5.

import { prepareQuery, prepareText, scorePrepared } from './fuzzy.js';
import { KIND_TAB, byRecencyDesc } from './items.js';

/**
 * Added to a title's score before comparing it with the same item's URL score.
 *
 * Two items can match equally well, one in its title and one in its URL; the
 * title match is almost always what the user meant. The constant is small
 * enough that a decisively better URL match still wins.
 */
const TITLE_PREFERENCE = 0.5;

/**
 * One item with its text prepared for matching.
 *
 * @typedef {Object} Candidate
 * @property {import('./items.js').SearchItem} item
 * @property {import('./fuzzy.js').PreparedText} title
 * @property {import('./fuzzy.js').PreparedText} display
 */

/**
 * A scored item, ready to display.
 *
 * @typedef {Object} RankedItem
 * @property {import('./items.js').SearchItem} item
 * @property {number} score Comparable only within one call to {@link rank};
 *   0 for every item when the query is empty.
 */

/**
 * Key under which two URLs are considered the same page for deduplication.
 *
 * Only a trailing slash is ignored, since `example.com/x` and `example.com/x/`
 * are reliably the same page. Case is deliberately preserved: paths are
 * case-sensitive on most servers, and wrongly merging two entries loses one of
 * them, whereas failing to merge merely shows a duplicate.
 *
 * @param {string} url
 * @returns {string}
 */
function dedupeKey(url) {
  return url.replace(/\/$/, '');
}

/**
 * Build the searchable index the popup queries on every keystroke.
 *
 * Does the two things that do not depend on the query. First, drops bookmarks
 * that duplicate an open tab: a bookmark for a page that is already open should
 * offer to switch to the tab rather than reload the page over it, so the tab
 * wins. Second, prepares each surviving item's title and URL for matching.
 *
 * @param {import('./items.js').SearchItem[]} items Every candidate, in any
 *   order — typically every open tab followed by every bookmark.
 * @returns {Candidate[]} A new array, input order preserved.
 *
 * Postconditions
 * --------------
 * No bookmark in the result shares a URL with a tab in `items`. Two tabs
 * showing the same page both survive, since either can be switched to.
 */
export function buildIndex(items) {
  const openUrls = new Set();
  for (const item of items) {
    if (item.kind === KIND_TAB) openUrls.add(dedupeKey(item.url));
  }
  const candidates = [];
  for (const item of items) {
    if (item.kind !== KIND_TAB && openUrls.has(dedupeKey(item.url))) continue;
    candidates.push({
      item,
      title: prepareText(item.title),
      display: prepareText(item.display),
    });
  }
  return candidates;
}

/**
 * Score a candidate by the better of its title and its URL.
 *
 * @param {import('./fuzzy.js').PreparedQuery} query
 * @param {Candidate} candidate
 * @returns {number|null} Null if the query matches neither field.
 */
function scoreCandidate(query, candidate) {
  const titleScore = scorePrepared(query, candidate.title);
  const urlScore = scorePrepared(query, candidate.display);
  if (titleScore === null && urlScore === null) return null;
  return Math.max(
    titleScore === null ? -Infinity : titleScore + TITLE_PREFERENCE,
    urlScore === null ? -Infinity : urlScore,
  );
}

/**
 * Order two scored items: best score first, most recently used to break ties.
 *
 * @param {RankedItem} a
 * @param {RankedItem} b
 * @returns {number}
 */
function byScoreThenRecency(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  return byRecencyDesc(a.item, b.item);
}

/**
 * Rank an index against a query.
 *
 * @param {Candidate[]} index As returned by {@link buildIndex}.
 * @param {string} query The user's search string. Surrounding whitespace is
 *   ignored; an all-whitespace query counts as empty.
 * @returns {RankedItem[]} A new array. For an empty query, every candidate
 *   ordered most-recently-used first. Otherwise only matching candidates, best
 *   first, with recency then title then key breaking ties. The order is total,
 *   so it does not depend on the order of `index` and does not shuffle between
 *   keystrokes.
 *
 * Postconditions
 * --------------
 * The result is never longer than `index`.
 */
export function rank(index, query) {
  const trimmed = query.trim();

  if (trimmed === '') {
    return index
      .map((candidate) => ({ item: candidate.item, score: 0 }))
      .sort((a, b) => byRecencyDesc(a.item, b.item));
  }

  const prepared = prepareQuery(trimmed);
  const ranked = [];
  for (const candidate of index) {
    const itemScore = scoreCandidate(prepared, candidate);
    if (itemScore !== null) ranked.push({ item: candidate.item, score: itemScore });
  }
  return ranked.sort(byScoreThenRecency);
}

// Ranking: turning the full set of candidate items plus the user's query into
// the ordered list the popup draws.
//
// Work that does not depend on the query — deduplication, and preparing each
// item's text for matching — happens once in `buildIndex`, not on every
// keystroke. See ../../DESIGN.md §5.

import { prepareQuery, prepareText, scorePrepared } from './fuzzy.js';
import { KIND_BOOKMARK, KIND_CLOSED_TAB, KIND_TAB, byRecencyDesc } from './items.js';

/**
 * Which kind wins when two items point at the same page, best first.
 *
 * Switching to an open tab beats restoring a closed one, which beats loading
 * the page fresh from a bookmark: each keeps strictly more of the page's state
 * than the next. Showing all three would be three rows that look identical and
 * behave differently.
 */
const KIND_PRECEDENCE = [KIND_TAB, KIND_CLOSED_TAB, KIND_BOOKMARK];

/**
 * Position of `kind` in {@link KIND_PRECEDENCE}, lower being better.
 *
 * A kind not in the list sorts last rather than first, so that adding a source
 * and forgetting to rank it makes that source lose ties instead of silently
 * suppressing open tabs.
 *
 * @param {string} kind
 * @returns {number}
 */
function precedenceOf(kind) {
  const rank = KIND_PRECEDENCE.indexOf(kind);
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

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
 * Does the two things that do not depend on the query. First, collapses items
 * that point at the same page down to the one that preserves the most state,
 * per {@link KIND_PRECEDENCE}. Second, prepares each surviving item's title and
 * URL for matching.
 *
 * @param {import('./items.js').SearchItem[]} items Every candidate, in any
 *   order — typically open tabs, then recently closed tabs, then bookmarks.
 * @returns {Candidate[]} A new array, input order preserved.
 *
 * Postconditions
 * --------------
 * For any URL, no item of a kind later in {@link KIND_PRECEDENCE} survives if
 * an item of an earlier kind shares that URL. Two items of the *same* kind
 * sharing a URL both survive: two tabs showing one page are two things a user
 * can switch between, and two bookmarks of it are two entries they made.
 */
export function buildIndex(items) {
  // The best kind seen for each URL, as an index into KIND_PRECEDENCE.
  const bestRank = new Map();
  for (const item of items) {
    const rank = precedenceOf(item.kind);
    const key = dedupeKey(item.url);
    const seen = bestRank.get(key);
    if (seen === undefined || rank < seen) bestRank.set(key, rank);
  }

  const candidates = [];
  for (const item of items) {
    if (precedenceOf(item.kind) > bestRank.get(dedupeKey(item.url))) continue;
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
 * Which of the two ranking tiers an item belongs to, lower being higher up.
 *
 * Tier 0 is everything that is open right now — a tab, whether it lives in this
 * window or another. Tier 1 is everything else: bookmarks, recently closed
 * tabs, and any source added later, which lands here by default rather than by
 * being listed.
 *
 * @param {import('./items.js').SearchItem} item
 * @returns {number}
 */
function tierOf(item) {
  return item.kind === KIND_TAB ? 0 : 1;
}

/**
 * Order two scored items: tier first, then the ordering within a tier.
 *
 * The tier is absolute — it outranks the match score, so a bookmark or a closed
 * tab never appears above an open tab however much better it matches. That is
 * deliberate: switching to something already open is the common case, and this
 * keeps it from being displaced by things that merely look similar. The cost is
 * that a precise query matching a closed tab exactly still sits below open tabs
 * matching it weakly.
 *
 * @param {RankedItem} a
 * @param {RankedItem} b
 * @returns {number}
 */
function byTierThenScore(a, b) {
  const byTier = tierOf(a.item) - tierOf(b.item);
  if (byTier !== 0) return byTier;
  if (a.score !== b.score) return b.score - a.score;
  return byRecencyDesc(a.item, b.item);
}

/**
 * Order two unscored items: tier first, then most recently used.
 *
 * @param {RankedItem} a
 * @param {RankedItem} b
 * @returns {number}
 */
function byTierThenRecency(a, b) {
  const byTier = tierOf(a.item) - tierOf(b.item);
  if (byTier !== 0) return byTier;
  return byRecencyDesc(a.item, b.item);
}

/**
 * Rank an index against a query.
 *
 * @param {Candidate[]} index As returned by {@link buildIndex}.
 * @param {string} query The user's search string. Surrounding whitespace is
 *   ignored; an all-whitespace query counts as empty.
 * @returns {RankedItem[]} A new array. Open tabs come first as a block, then
 *   everything else — see {@link tierOf}. Within a tier: for an empty query,
 *   most-recently-used first; otherwise only matching candidates, best match
 *   first, with recency then title then key breaking ties. The order is total,
 *   so it does not depend on the order of `index` and does not shuffle between
 *   keystrokes.
 *
 * Postconditions
 * --------------
 * The result is never longer than `index`. No item that is not an open tab
 * appears before one that is, whatever the query.
 */
export function rank(index, query) {
  const trimmed = query.trim();

  if (trimmed === '') {
    return index.map((candidate) => ({ item: candidate.item, score: 0 })).sort(byTierThenRecency);
  }

  const prepared = prepareQuery(trimmed);
  const ranked = [];
  for (const candidate of index) {
    const itemScore = scoreCandidate(prepared, candidate);
    if (itemScore !== null) ranked.push({ item: candidate.item, score: itemScore });
  }
  return ranked.sort(byTierThenScore);
}

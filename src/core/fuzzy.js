// Fuzzy matching: an fzy-style scorer over subsequence matches.
//
// This module is deliberately the whole fuzzy-matching interface, so that it
// can be swapped for fzf-for-js, uFuzzy, or anything else. It has two layers:
//
//   score(query, text)     -> number | null    convenience, prepares as it goes
//   positions(query, text) -> number[] | null
//
//   prepareQuery / prepareText / scorePrepared / positionsPrepared
//                                              the hot path, for ranking
//
// The split exists because nothing about a candidate's text depends on the
// query: lowercasing it and working out which of its characters sit at word
// boundaries is the same on every keystroke. Preparing each candidate once,
// when the popup opens, is worth about 1.5-2x on `bench/rank.js`. Use the
// convenience layer anywhere that is not a loop over every candidate.
//
// `score` and `positions` are separate for the same reason: ranking calls
// `score` on everything and only needs the number, so it runs on two rolling
// rows of the dynamic-programming table, whereas highlighting calls `positions`
// on the handful of rows actually drawn and needs the full table to trace back
// through.
//
// The algorithm is Seth Warn's fzy (https://github.com/jhawthorn/fzy), an
// alignment score in the Smith-Waterman family: every character of the query
// must appear in the text in order, gaps are penalised, and matches at
// "interesting" positions — after a slash, at a word boundary, at a camelCase
// hump — are rewarded, so `gh` prefers `github.com` over `alg-hash`.

/** Score of a match that continues the previous matched character. */
const SCORE_MATCH_CONSECUTIVE = 1.0;

/** Bonus for matching the first character after a `/`, and the first character overall. */
const SCORE_MATCH_SLASH = 0.9;

/** Bonus for matching the first character of a word (after `-`, `_` or a space). */
const SCORE_MATCH_WORD = 0.8;

/** Bonus for matching an uppercase character that begins a camelCase hump. */
const SCORE_MATCH_CAPITAL = 0.7;

/** Bonus for matching the first character after a `.`. */
const SCORE_MATCH_DOT = 0.6;

/** Per-character penalty for unmatched text before the first matched character. */
const SCORE_GAP_LEADING = -0.005;

/** Per-character penalty for unmatched text after the last matched character. */
const SCORE_GAP_TRAILING = -0.005;

/** Per-character penalty for unmatched text between two matched characters. */
const SCORE_GAP_INNER = -0.01;

/**
 * Longest text scored. Beyond this the text is truncated: the table is
 * quadratic in text length, and a match thousands of characters into a URL is
 * not something a user is looking for anyway.
 */
const MAX_TEXT_LENGTH = 1024;

/**
 * Score returned for a whole-string case-insensitive match. Nothing can beat
 * it, which lets exact matches skip the table entirely.
 */
const SCORE_EXACT = Infinity;

/** Sentinel for "no alignment is possible here", per fzy. */
const SCORE_MIN = -Infinity;

/**
 * A query, lowercased into character codes. See {@link prepareQuery}.
 *
 * @typedef {Object} PreparedQuery
 * @property {Int32Array} codes Lowercased character codes.
 */

/**
 * A candidate text with everything query-independent precomputed. See
 * {@link prepareText}.
 *
 * @typedef {Object} PreparedText
 * @property {string} text The text, truncated to {@link MAX_TEXT_LENGTH}.
 * @property {Int32Array} codes Lowercased character codes, parallel to `text`.
 * @property {Float64Array} bonus Positional bonuses, parallel to `text`.
 */

/**
 * Whether `ch` is a lowercase letter, for the camelCase bonus.
 *
 * Compares against both cases rather than testing an ASCII range so that
 * non-Latin scripts, which are caseless, are correctly reported as neither
 * upper nor lower.
 *
 * @param {string} ch A single character.
 * @returns {boolean}
 */
function isLower(ch) {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}

/**
 * Whether `ch` is an uppercase letter, for the camelCase bonus.
 *
 * @param {string} ch A single character.
 * @returns {boolean}
 */
function isUpper(ch) {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

/**
 * Positional bonus for matching `ch`, given the character before it.
 *
 * @param {string} prevCh The preceding character. Callers pass `/` for the
 *   first character of the text, so that a match at the very start scores as
 *   well as one after a path separator.
 * @param {string} ch The character being matched.
 * @returns {number} A non-negative bonus, 0 in ordinary positions.
 */
function bonusFor(prevCh, ch) {
  if (prevCh === '/') return SCORE_MATCH_SLASH;
  if (prevCh === '-' || prevCh === '_' || prevCh === ' ') return SCORE_MATCH_WORD;
  if (prevCh === '.') return SCORE_MATCH_DOT;
  if (isLower(prevCh) && isUpper(ch)) return SCORE_MATCH_CAPITAL;
  return 0;
}

/**
 * Lowercase one character to a single character code.
 *
 * Lowercasing is done per character rather than on the whole string because a
 * few characters lowercase to more than one (`İ` becomes `i̇`), which would
 * shift every subsequent index and misplace highlights. Taking the first code
 * unit keeps the result exactly parallel to the input.
 *
 * @param {string} ch A single character.
 * @returns {number} A UTF-16 code unit.
 */
function lowerCode(ch) {
  return ch.toLowerCase().charCodeAt(0);
}

/**
 * Prepare a query for repeated matching.
 *
 * @param {string} query The user's search string.
 * @returns {PreparedQuery|null} Null for an empty query, which matches nothing
 *   here; callers that want "everything" for an empty query are expected to
 *   skip scoring altogether (see `rank.js`).
 */
export function prepareQuery(query) {
  if (query.length === 0) return null;
  const codes = new Int32Array(query.length);
  for (let i = 0; i < query.length; i++) codes[i] = lowerCode(query[i]);
  return { codes };
}

/**
 * Prepare a candidate text for repeated matching.
 *
 * Everything here is independent of the query, so the result can be computed
 * once per candidate and reused for the life of the popup.
 *
 * @param {string} text The candidate text.
 * @returns {PreparedText} Truncated to {@link MAX_TEXT_LENGTH} if need be.
 */
export function prepareText(text) {
  const truncated = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
  const n = truncated.length;
  const codes = new Int32Array(n);
  const bonus = new Float64Array(n);
  let prevCh = '/';
  for (let j = 0; j < n; j++) {
    const ch = truncated[j];
    codes[j] = lowerCode(ch);
    bonus[j] = bonusFor(prevCh, ch);
    prevCh = ch;
  }
  return { text: truncated, codes, bonus };
}

/**
 * Whether every code of `query` appears in `text`, in order.
 *
 * A linear-time reject that spares the quadratic table for the overwhelming
 * majority of candidates, which do not match at all.
 *
 * @param {Int32Array} query
 * @param {Int32Array} text
 * @returns {boolean}
 */
function isSubsequence(query, text) {
  let i = 0;
  for (let j = 0; j < text.length && i < query.length; j++) {
    if (text[j] === query[i]) i++;
  }
  return i === query.length;
}

/**
 * Whether a match is possible at all, and whether it is a whole-string one.
 *
 * @param {PreparedQuery|null} query
 * @param {PreparedText} text
 * @returns {'none'|'exact'|'partial'}
 */
function classify(query, text) {
  if (query === null || query.codes.length > text.codes.length) return 'none';
  if (!isSubsequence(query.codes, text.codes)) return 'none';
  return query.codes.length === text.codes.length ? 'exact' : 'partial';
}

/**
 * Reusable rows for {@link scorePrepared}.
 *
 * Scoring is the hot path — thousands of calls per keystroke — and four fresh
 * `Float64Array`s per call dominated its cost, well ahead of the arithmetic:
 * reusing them is worth about 15x on `bench/rank.js`, far more than any other
 * change made here. The rows are allocated once and grown as needed.
 *
 * This is the one piece of mutable state in `core/`, and it is invisible:
 * every row is written
 * in full before it is read, so no value survives from one call to the next and
 * `scorePrepared` remains a pure function of its arguments.
 *
 * @type {{size: number, rows: Float64Array[]}}
 */
const scratch = { size: 0, rows: [] };

/**
 * Four rows of at least `m` elements, reused across calls.
 *
 * @param {number} m Row length required.
 * @returns {Float64Array[]} Four rows, each at least `m` long. Contents are
 *   arbitrary.
 */
function scratchRows(m) {
  if (m > scratch.size) {
    // Grow geometrically so a run of ever-longer texts does not reallocate on
    // every call.
    scratch.size = Math.max(m, scratch.size * 2);
    scratch.rows = [0, 1, 2, 3].map(() => new Float64Array(scratch.size));
  }
  return scratch.rows;
}

/**
 * Score a prepared query against a prepared text.
 *
 * The hot path: called once per candidate per keystroke. See
 * {@link score} for the semantics of the result.
 *
 * @param {PreparedQuery|null} query
 * @param {PreparedText} text
 * @returns {number|null}
 */
export function scorePrepared(query, text) {
  const kind = classify(query, text);
  if (kind === 'none') return null;
  if (kind === 'exact') return SCORE_EXACT;

  const q = query.codes;
  const t = text.codes;
  const bonus = text.bonus;
  const n = q.length;
  const m = t.length;

  // `best` is the best score for matching query[0..i] into text[0..j] (fzy's
  // M); `end` is the best score for doing so with a match *at* j (fzy's D).
  // Only the previous row of each is ever read, so two rows suffice.
  let [prevBest, prevEnd, best, end] = scratchRows(m);

  for (let i = 0; i < n; i++) {
    // A gap after the final query character is trailing, not inner, so that
    // long texts are not punished for what follows the match.
    const gapScore = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    const qi = q[i];
    let runningBest = SCORE_MIN;

    for (let j = 0; j < m; j++) {
      if (qi === t[j]) {
        let matched = SCORE_MIN;
        if (i === 0) {
          matched = j * SCORE_GAP_LEADING + bonus[j];
        } else if (j > 0) {
          // Either start a fresh match here and take its positional bonus, or
          // extend the previous match, which scores better than any bonus.
          matched = Math.max(prevBest[j - 1] + bonus[j], prevEnd[j - 1] + SCORE_MATCH_CONSECUTIVE);
        }
        end[j] = matched;
        runningBest = Math.max(matched, runningBest + gapScore);
      } else {
        end[j] = SCORE_MIN;
        runningBest += gapScore;
      }
      best[j] = runningBest;
    }

    [prevBest, best] = [best, prevBest];
    [prevEnd, end] = [end, prevEnd];
  }

  return prevBest[m - 1];
}

/**
 * Find the matched character positions for a prepared query and text.
 *
 * See {@link positions} for the semantics of the result.
 *
 * @param {PreparedQuery|null} query
 * @param {PreparedText} text
 * @returns {number[]|null}
 */
export function positionsPrepared(query, text) {
  const kind = classify(query, text);
  if (kind === 'none') return null;
  if (kind === 'exact') return Array.from({ length: query.codes.length }, (_, i) => i);

  const q = query.codes;
  const t = text.codes;
  const bonus = text.bonus;
  const n = q.length;
  const m = t.length;
  const best = new Float64Array(n * m);
  const end = new Float64Array(n * m);

  for (let i = 0; i < n; i++) {
    const gapScore = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    const row = i * m;
    const prevRow = row - m;
    const qi = q[i];
    let runningBest = SCORE_MIN;

    for (let j = 0; j < m; j++) {
      if (qi === t[j]) {
        let matched = SCORE_MIN;
        if (i === 0) {
          matched = j * SCORE_GAP_LEADING + bonus[j];
        } else if (j > 0) {
          matched = Math.max(
            best[prevRow + j - 1] + bonus[j],
            end[prevRow + j - 1] + SCORE_MATCH_CONSECUTIVE,
          );
        }
        end[row + j] = matched;
        runningBest = Math.max(matched, runningBest + gapScore);
      } else {
        end[row + j] = SCORE_MIN;
        runningBest += gapScore;
      }
      best[row + j] = runningBest;
    }
  }

  // Trace back through the table. At each query character walk left until a
  // cell that the best score could have come through. `mustMatch` carries the
  // knowledge that the cell to the right was reached by extending a run, so
  // this cell has to be a match even where a gap would have scored the same.
  const result = new Array(n);
  let mustMatch = false;
  let j = m - 1;
  for (let i = n - 1; i >= 0; i--) {
    const row = i * m;
    for (; j >= 0; j--) {
      const isMatchCell = end[row + j] !== SCORE_MIN;
      if (isMatchCell && (mustMatch || end[row + j] === best[row + j])) {
        mustMatch =
          i > 0 && j > 0 && best[row + j] === end[row - m + j - 1] + SCORE_MATCH_CONSECUTIVE;
        result[i] = j;
        j--;
        break;
      }
    }
  }
  return result;
}

/**
 * Score how well `query` matches `text`.
 *
 * Convenience over {@link scorePrepared} that prepares both arguments. Do not
 * call it in a loop over every candidate — prepare the candidates once instead.
 *
 * @param {string} query The user's search string. An empty query matches
 *   nothing.
 * @param {string} text The candidate text.
 * @returns {number|null} A score, higher being better, or null if `query` is
 *   not a subsequence of `text`. Scores are comparable only between candidates
 *   matched against the *same* query — the scale depends on query length — and
 *   a whole-string case-insensitive match returns `Infinity`.
 *
 * Postconditions
 * --------------
 * `score(q, t) !== null` if and only if `positions(q, t) !== null`.
 */
export function score(query, text) {
  return scorePrepared(prepareQuery(query), prepareText(text));
}

/**
 * Find which characters of `text` the query matched, for highlighting.
 *
 * Returns the alignment the score was computed from, so highlights always agree
 * with the ranking. This runs the full dynamic-programming table rather than
 * two rows, so call it only for candidates actually being displayed.
 *
 * Convenience over {@link positionsPrepared} that prepares both arguments.
 *
 * @param {string} query The user's search string.
 * @param {string} text The candidate text.
 * @returns {number[]|null} Indices into `text`, strictly ascending, one per
 *   character of `query`; or null if there is no match.
 */
export function positions(query, text) {
  return positionsPrepared(prepareQuery(query), prepareText(text));
}

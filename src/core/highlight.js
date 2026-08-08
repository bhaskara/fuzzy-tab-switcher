// Turning a set of matched character indices into runs of text, so the popup
// can build one element per run instead of one per character.

/**
 * A run of consecutive characters that are either all matched or all unmatched.
 *
 * @typedef {Object} Segment
 * @property {string} text Non-empty.
 * @property {boolean} matched
 */

/**
 * Split `text` into alternating matched and unmatched runs.
 *
 * @param {string} text The text being displayed.
 * @param {number[]|null} matchedIndices Indices into `text`, as returned by
 *   `fuzzy.positions`. Null or empty yields the whole text as one unmatched
 *   segment. Indices need not be sorted, and duplicates and indices outside
 *   `text` are ignored.
 * @returns {Segment[]} Segments that concatenate back to `text` exactly, with
 *   no empty segments and no two adjacent segments sharing a `matched` value.
 */
export function toSegments(text, matchedIndices) {
  if (text.length === 0) return [];
  const matched = new Set(matchedIndices ?? []);
  if (matched.size === 0) return [{ text, matched: false }];

  const segments = [];
  let runStart = 0;
  let runMatched = matched.has(0);
  for (let i = 1; i <= text.length; i++) {
    const isMatched = i < text.length && matched.has(i);
    if (i === text.length || isMatched !== runMatched) {
      segments.push({ text: text.slice(runStart, i), matched: runMatched });
      runStart = i;
      runMatched = isMatched;
    }
  }
  return segments;
}

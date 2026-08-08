// How long does one keystroke's worth of ranking cost?
//
// The README asks for search that is "fast and responsive", and intuition about
// what JavaScript costs turned out to be unreliable here — the first version of
// the scorer took 40ms per keystroke at 5,000 items, and the fix that mattered
// (reusing the scoring rows instead of allocating them) was not the one that
// looked most promising. Measure before optimising this code.
//
// Run with `npm run bench`. Numbers are worst-case in one important way: the
// synthetic corpus is built from a small vocabulary, so short queries match
// nearly everything and every match pays for the full scoring table.

import { positionsPrepared, prepareQuery, prepareText } from '../src/core/fuzzy.js';
import { bookmarkToItem, tabToItem } from '../src/core/items.js';
import { buildIndex, rank } from '../src/core/rank.js';

/** Corpus sizes to report: roughly typical, heavy, and implausible. */
const CORPORA = [
  { tabs: 100, bookmarks: 1_000 },
  { tabs: 300, bookmarks: 5_000 },
  { tabs: 500, bookmarks: 20_000 },
];

/** Queries to time, covering the expensive short ones and a total miss. */
const QUERIES = ['g', 'gh', 'git', 'githu', 'github', 'zzqx'];

/** How many results the popup puts in the DOM, and so how many get highlighted. */
const RENDERED = 50;

const WORDS = [
  'github', 'docs', 'review', 'anthropic', 'console', 'dashboard', 'issue',
  'pull-request', 'archive', 'MeetingNotes', 'search', 'reference', 'api', 'settings',
];

/**
 * A deterministic pseudo-random number source, so runs are comparable.
 *
 * @param {number} seed
 * @returns {() => number} Successive values in [0, 1).
 */
function randomSource(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const random = randomSource(12345);

/** `count` vocabulary words joined by `separator`. */
function words(count, separator) {
  return Array.from({ length: count }, () => WORDS[Math.floor(random() * WORDS.length)]).join(
    separator,
  );
}

/**
 * Build a synthetic corpus of tabs and bookmarks.
 *
 * @param {number} tabCount
 * @param {number} bookmarkCount
 * @returns {import('../src/core/items.js').SearchItem[]}
 */
function makeItems(tabCount, bookmarkCount) {
  const items = [];
  for (let i = 0; i < tabCount; i++) {
    items.push(
      tabToItem({
        id: i,
        windowId: 1,
        index: i,
        title: words(6, ' '),
        url: `https://${WORDS[i % WORDS.length]}.example.com/${words(4, '/')}`,
        lastAccessed: i,
      }),
    );
  }
  for (let i = 0; i < bookmarkCount; i++) {
    items.push(
      bookmarkToItem(
        {
          id: `b${i}`,
          title: words(5, ' '),
          url: `https://site${i % 50}.example.org/${words(5, '/')}`,
          dateAdded: i,
        },
        'Bookmarks bar/Dev',
      ),
    );
  }
  return items;
}

/**
 * Time `fn`, discarding a warm-up run so the JIT has compiled it.
 *
 * @param {() => unknown} fn
 * @param {number} reps
 * @returns {number} Mean milliseconds per call.
 */
function timeIt(fn, reps) {
  fn();
  const start = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - start) / reps;
}

/** Print one right-aligned timing row. */
function report(label, ms, note = '') {
  console.log(`  ${label.padEnd(34)} ${`${ms.toFixed(2)} ms`.padStart(9)}  ${note}`);
}

for (const { tabs, bookmarks } of CORPORA) {
  const items = makeItems(tabs, bookmarks);
  const index = buildIndex(items);
  console.log(`\n${tabs} tabs + ${bookmarks} bookmarks = ${items.length} items`);

  report('buildIndex (once, on open)', timeIt(() => buildIndex(items), 5));

  for (const query of QUERIES) {
    const matches = rank(index, query).length;
    report(`rank(${JSON.stringify(query)})`, timeIt(() => rank(index, query), 30), `${matches} matches`);
  }

  // Highlighting only ever runs over the rows actually drawn, so it is timed
  // against that cap rather than against the whole match set.
  const drawn = rank(index, 'git').slice(0, RENDERED);
  const prepared = drawn.map((entry) => [prepareText(entry.item.title), prepareText(entry.item.display)]);
  const preparedQuery = prepareQuery('git');
  report(
    `positions, ${drawn.length} drawn rows`,
    timeIt(() => {
      for (const [title, display] of prepared) {
        positionsPrepared(preparedQuery, title);
        positionsPrepared(preparedQuery, display);
      }
    }, 30),
  );
}

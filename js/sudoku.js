// Sudoku engine: board geometry, brute-force solver, generator,
// technique-based grader and hint finder. No DOM access, so it runs in
// the page, in a Web Worker and under Node for tests.

export const ALL = 0x3fe; // candidate bits 1..9

export const LEVELS = {
  1: { name: 'Easy', blurb: 'Singles only. Scan rows, columns and boxes.' },
  2: { name: 'Medium', blurb: 'Needs locked candidates or pairs.' },
  3: { name: 'Hard', blurb: 'Needs triples or an X-Wing.' },
  4: { name: 'Expert', blurb: 'Needs Y-Wing, Swordfish, quads and friends.' },
};

export const rowOf = (i) => (i / 9) | 0;
export const colOf = (i) => i % 9;
export const boxOf = (i) => 3 * ((rowOf(i) / 3) | 0) + ((colOf(i) / 3) | 0);

const range9 = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const ROWS = range9.map((r) => range9.map((c) => r * 9 + c));
const COLS = range9.map((c) => range9.map((r) => r * 9 + c));
const BOXES = range9.map((b) =>
  range9.map((k) => (3 * ((b / 3) | 0) + ((k / 3) | 0)) * 9 + 3 * (b % 3) + (k % 3)),
);

/** All 27 units: indices 0-8 rows, 9-17 columns, 18-26 boxes. */
export const UNITS = [...ROWS, ...COLS, ...BOXES];

/** For every cell, the 20 other cells sharing a row, column or box. */
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const set = new Set([...ROWS[rowOf(i)], ...COLS[colOf(i)], ...BOXES[boxOf(i)]]);
  set.delete(i);
  return [...set];
});

const isPeer = Array.from({ length: 81 }, (_, i) => {
  const a = new Uint8Array(81);
  for (const p of PEERS[i]) a[p] = 1;
  return a;
});

export const sees = (a, b) => isPeer[a][b] === 1;

export const bit = (d) => 1 << d;

export function popcount(m) {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

/** Digits contained in a candidate mask, ascending. */
export function digitsOf(m) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (m & (1 << d)) out.push(d);
  return out;
}

export const cellName = (i) => `R${rowOf(i) + 1}C${colOf(i) + 1}`;

export function unitName(u) {
  if (u < 9) return `row ${u + 1}`;
  if (u < 18) return `column ${u - 8}`;
  return `box ${u - 17}`;
}

export function parseGrid(s) {
  return Array.from(s, (ch) => (ch >= '1' && ch <= '9' ? Number(ch) : 0));
}

export const gridToString = (g) => g.map((v) => v || '.').join('');

/** Candidate masks for every empty cell, computed from placed values only. */
export function candidatesFor(values) {
  const cands = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (values[i]) continue;
    let m = ALL;
    for (const p of PEERS[i]) if (values[p]) m &= ~bit(values[p]);
    cands[i] = m;
  }
  return cands;
}

/** Cells whose value clashes with another value in the same unit. */
export function conflicts(values) {
  const bad = new Set();
  for (let i = 0; i < 81; i++) {
    if (!values[i]) continue;
    for (const p of PEERS[i]) if (values[p] === values[i]) bad.add(i);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Brute-force solver (uniqueness checks and solution generation)
// ---------------------------------------------------------------------------

/**
 * Backtracking solver with minimum-remaining-values ordering.
 *
 * Returns { count, solution } where count stops at `limit` and solution is
 * the first solution found (or null).
 *
 *   solveBrute(parseGrid(puzzle), 2).count === 1  // unique puzzle
 */
export function solveBrute(grid, limit = 2, rng = null) {
  const g = Array.from(grid);
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = bit(g[i]);
    const r = rowOf(i), c = colOf(i), x = boxOf(i);
    if ((rows[r] | cols[c] | boxes[x]) & b) return { count: 0, solution: null };
    rows[r] |= b;
    cols[c] |= b;
    boxes[x] |= b;
  }
  let count = 0;
  let solution = null;

  const search = () => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = popcount(m);
      if (n === 0) return false;
      if (n < bestN) {
        best = i;
        bestMask = m;
        bestN = n;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      count++;
      if (!solution) solution = g.slice();
      return count >= limit;
    }
    const ds = digitsOf(bestMask);
    if (rng) shuffle(ds, rng);
    const r = rowOf(best), c = colOf(best), x = boxOf(best);
    for (const d of ds) {
      const b = bit(d);
      g[best] = d;
      rows[r] |= b;
      cols[c] |= b;
      boxes[x] |= b;
      if (search()) return true;
      rows[r] &= ~b;
      cols[c] &= ~b;
      boxes[x] &= ~b;
    }
    g[best] = 0;
    return false;
  };

  search();
  return { count, solution };
}

export function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Small seedable PRNG (mulberry32) so tests are reproducible. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Logical techniques
//
// Each technique takes a state { values, cands } and returns a step or null:
//   { tech, level, place?: {cell, digit}, elims: [{cell, digit}],
//     unit?, cells: [...pattern], digits: [...], focus: [...] , ...extra }
// ---------------------------------------------------------------------------

export function makeState(values) {
  return { values: Array.from(values), cands: candidatesFor(values) };
}

export function applyStep(state, step) {
  if (step.place) {
    const { cell, digit } = step.place;
    state.values[cell] = digit;
    state.cands[cell] = 0;
    for (const p of PEERS[cell]) state.cands[p] &= ~bit(digit);
  }
  for (const { cell, digit } of step.elims) state.cands[cell] &= ~bit(digit);
}

const emptyCells = (state, unit) => unit.filter((i) => !state.values[i]);

function fullHouse(state) {
  for (let u = 0; u < 27; u++) {
    const empty = emptyCells(state, UNITS[u]);
    if (empty.length !== 1 || !state.cands[empty[0]]) continue;
    const cell = empty[0];
    if (popcount(state.cands[cell]) !== 1) continue;
    const digit = digitsOf(state.cands[cell])[0];
    return { tech: 'fullHouse', level: 1, place: { cell, digit }, elims: [], unit: u, cells: [cell], digits: [digit], focus: UNITS[u] };
  }
  return null;
}

function hiddenSingleIn(state, unitIds) {
  for (const u of unitIds) {
    const empty = emptyCells(state, UNITS[u]);
    for (let d = 1; d <= 9; d++) {
      const spots = empty.filter((i) => state.cands[i] & bit(d));
      if (spots.length !== 1) continue;
      const cell = spots[0];
      return { tech: 'hiddenSingle', level: 1, place: { cell, digit: d }, elims: [], unit: u, cells: [cell], digits: [d], focus: UNITS[u] };
    }
  }
  return null;
}

const BOX_IDS = range9.map((b) => 18 + b);
const LINE_IDS = range9.flatMap((k) => [k, 9 + k]);

const hiddenSingleBox = (s) => hiddenSingleIn(s, BOX_IDS);
const hiddenSingleLine = (s) => hiddenSingleIn(s, LINE_IDS);

function nakedSingle(state) {
  for (let cell = 0; cell < 81; cell++) {
    if (state.values[cell] || popcount(state.cands[cell]) !== 1) continue;
    const digit = digitsOf(state.cands[cell])[0];
    return { tech: 'nakedSingle', level: 1, place: { cell, digit }, elims: [], cells: [cell], digits: [digit], focus: BOXES[boxOf(cell)], unit: 18 + boxOf(cell) };
  }
  return null;
}

function lockedCandidates(state) {
  // Pointing: within a box, a digit confined to one row/column.
  for (let b = 0; b < 9; b++) {
    for (let d = 1; d <= 9; d++) {
      const spots = BOXES[b].filter((i) => !state.values[i] && state.cands[i] & bit(d));
      if (spots.length < 2) continue;
      for (const [lineOf, lineIds, offset] of [[rowOf, ROWS, 0], [colOf, COLS, 9]]) {
        const line = lineOf(spots[0]);
        if (!spots.every((i) => lineOf(i) === line)) continue;
        const elims = lineIds[line]
          .filter((i) => boxOf(i) !== b && !state.values[i] && state.cands[i] & bit(d))
          .map((cell) => ({ cell, digit: d }));
        if (elims.length) {
          return { tech: 'pointing', level: 2, elims, unit: 18 + b, line: offset + line, cells: spots, digits: [d], focus: BOXES[b] };
        }
      }
    }
  }
  // Claiming: within a row/column, a digit confined to one box.
  for (const u of LINE_IDS) {
    for (let d = 1; d <= 9; d++) {
      const spots = UNITS[u].filter((i) => !state.values[i] && state.cands[i] & bit(d));
      if (spots.length < 2) continue;
      const b = boxOf(spots[0]);
      if (!spots.every((i) => boxOf(i) === b)) continue;
      const inLine = new Set(UNITS[u]);
      const elims = BOXES[b]
        .filter((i) => !inLine.has(i) && !state.values[i] && state.cands[i] & bit(d))
        .map((cell) => ({ cell, digit: d }));
      if (elims.length) {
        return { tech: 'claiming', level: 2, elims, unit: u, box: 18 + b, cells: spots, digits: [d], focus: UNITS[u] };
      }
    }
  }
  return null;
}

function* combinations(arr, k, start = 0, acc = []) {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* combinations(arr, k, i + 1, acc);
    acc.pop();
  }
}

const SUBSET_LEVEL = { 2: 2, 3: 3, 4: 4 };
const SUBSET_NAME = { 2: 'Pair', 3: 'Triple', 4: 'Quad' };

function nakedSubset(k) {
  return (state) => {
    for (let u = 0; u < 27; u++) {
      const pool = emptyCells(state, UNITS[u]).filter((i) => {
        const n = popcount(state.cands[i]);
        return n >= 2 && n <= k;
      });
      for (const combo of combinations(pool, k)) {
        let union = 0;
        for (const i of combo) union |= state.cands[i];
        if (popcount(union) !== k) continue;
        const inCombo = new Set(combo);
        const elims = [];
        for (const i of emptyCells(state, UNITS[u])) {
          if (inCombo.has(i)) continue;
          for (const d of digitsOf(state.cands[i] & union)) elims.push({ cell: i, digit: d });
        }
        if (elims.length) {
          return { tech: 'naked' + SUBSET_NAME[k], level: SUBSET_LEVEL[k], elims, unit: u, cells: combo, digits: digitsOf(union), focus: UNITS[u] };
        }
      }
    }
    return null;
  };
}

function hiddenSubset(k) {
  return (state) => {
    for (let u = 0; u < 27; u++) {
      const empty = emptyCells(state, UNITS[u]);
      if (empty.length <= k) continue;
      const pos = {};
      const pool = [];
      for (let d = 1; d <= 9; d++) {
        const spots = empty.filter((i) => state.cands[i] & bit(d));
        if (spots.length >= 2 && spots.length <= k) {
          pos[d] = spots;
          pool.push(d);
        }
      }
      for (const combo of combinations(pool, k)) {
        const cells = new Set(combo.flatMap((d) => pos[d]));
        if (cells.size !== k) continue;
        let keep = 0;
        for (const d of combo) keep |= bit(d);
        const elims = [];
        for (const i of cells) {
          for (const d of digitsOf(state.cands[i] & ~keep)) elims.push({ cell: i, digit: d });
        }
        if (elims.length) {
          return { tech: 'hidden' + SUBSET_NAME[k], level: SUBSET_LEVEL[k], elims, unit: u, cells: [...cells].sort((a, b) => a - b), digits: combo, focus: UNITS[u] };
        }
      }
    }
    return null;
  };
}

const FISH = { 2: ['xWing', 3], 3: ['swordfish', 4] };

function fish(n) {
  const [tech, level] = FISH[n];
  return (state) => {
    for (let d = 1; d <= 9; d++) {
      for (const byRow of [true, false]) {
        const base = byRow ? ROWS : COLS;
        const cover = byRow ? COLS : ROWS;
        const crossOf = byRow ? colOf : rowOf;
        const lines = [];
        for (let k = 0; k < 9; k++) {
          const spots = base[k].filter((i) => !state.values[i] && state.cands[i] & bit(d));
          if (spots.length >= 2 && spots.length <= n) lines.push({ k, spots });
        }
        for (const combo of combinations(lines, n)) {
          const crosses = new Set(combo.flatMap((l) => l.spots.map(crossOf)));
          if (crosses.size !== n) continue;
          const baseSet = new Set(combo.map((l) => l.k));
          const elims = [];
          for (const x of crosses) {
            for (const i of cover[x]) {
              const along = byRow ? rowOf(i) : colOf(i);
              if (baseSet.has(along) || state.values[i] || !(state.cands[i] & bit(d))) continue;
              elims.push({ cell: i, digit: d });
            }
          }
          if (elims.length) {
            const baseUnits = combo.map((l) => (byRow ? l.k : 9 + l.k));
            const coverUnits = [...crosses].sort().map((x) => (byRow ? 9 + x : x));
            return {
              tech, level, elims, digits: [d],
              cells: combo.flatMap((l) => l.spots),
              baseUnits, coverUnits,
              focus: baseUnits.flatMap((u) => UNITS[u]),
            };
          }
        }
      }
    }
    return null;
  };
}

function yWing(state) {
  const bivalue = [];
  for (let i = 0; i < 81; i++) if (!state.values[i] && popcount(state.cands[i]) === 2) bivalue.push(i);
  for (const pivot of bivalue) {
    const [a, b] = digitsOf(state.cands[pivot]);
    const wings = bivalue.filter((w) => w !== pivot && sees(pivot, w));
    for (const p1 of wings) {
      const m1 = state.cands[p1];
      if (!(m1 & bit(a)) || m1 & bit(b)) continue;
      const c = digitsOf(m1 & ~bit(a))[0];
      for (const p2 of wings) {
        if (p2 === p1 || state.cands[p2] !== (bit(b) | bit(c))) continue;
        const elims = [];
        for (let i = 0; i < 81; i++) {
          if (i === pivot || i === p1 || i === p2 || state.values[i]) continue;
          if (state.cands[i] & bit(c) && sees(i, p1) && sees(i, p2)) elims.push({ cell: i, digit: c });
        }
        if (elims.length) {
          return { tech: 'yWing', level: 4, elims, cells: [pivot, p1, p2], digits: [a, b, c], pivot, focus: [pivot, ...PEERS[pivot]] };
        }
      }
    }
  }
  return null;
}

function xyzWing(state) {
  for (let pivot = 0; pivot < 81; pivot++) {
    if (state.values[pivot] || popcount(state.cands[pivot]) !== 3) continue;
    const pm = state.cands[pivot];
    const wings = PEERS[pivot].filter((w) => !state.values[w] && popcount(state.cands[w]) === 2 && (state.cands[w] & ~pm) === 0);
    for (const [p1, p2] of combinations(wings, 2)) {
      if (state.cands[p1] === state.cands[p2]) continue;
      const shared = state.cands[p1] & state.cands[p2];
      if (popcount(shared) !== 1) continue;
      const z = digitsOf(shared)[0];
      const elims = [];
      for (const i of PEERS[pivot]) {
        if (i === p1 || i === p2 || state.values[i]) continue;
        if (state.cands[i] & bit(z) && sees(i, p1) && sees(i, p2)) elims.push({ cell: i, digit: z });
      }
      if (elims.length) {
        return { tech: 'xyzWing', level: 4, elims, cells: [pivot, p1, p2], digits: digitsOf(pm), pivot, z, focus: [pivot, ...PEERS[pivot]] };
      }
    }
  }
  return null;
}

/** Techniques in the order a person would usually look for them. */
export const TECHNIQUES = [
  fullHouse,
  hiddenSingleBox,
  hiddenSingleLine,
  nakedSingle,
  lockedCandidates,
  nakedSubset(2),
  hiddenSubset(2),
  nakedSubset(3),
  hiddenSubset(3),
  fish(2),
  yWing,
  xyzWing,
  fish(3),
  nakedSubset(4),
  hiddenSubset(4),
];

export function nextStep(state) {
  for (const t of TECHNIQUES) {
    const step = t(state);
    if (step) return step;
  }
  return null;
}

/**
 * Solve a puzzle with human techniques only and report how hard it was.
 *
 * Returns { level, solved, steps, techniques } where level is the hardest
 * technique tier needed (1-4), or 5 when the techniques above get stuck.
 *
 *   grade(parseGrid(puzzle)).level  // -> 1..5
 */
export function grade(values) {
  const state = makeState(values);
  let level = 1;
  let steps = 0;
  const techniques = new Set();
  for (;;) {
    if (state.values.every((v) => v)) return { level, solved: true, steps, techniques: [...techniques] };
    const step = nextStep(state);
    if (!step) return { level: 5, solved: false, steps, techniques: [...techniques] };
    level = Math.max(level, step.level);
    techniques.add(step.tech);
    applyStep(state, step);
    steps++;
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/** Clue floors per level, so easier levels also feel more open. */
const MIN_CLUES = { 1: 36, 2: 28, 3: 24, 4: 17 };

/**
 * Remove clues from a full solution while the puzzle stays unique and no
 * harder than maxLevel, never going below that level's clue floor.
 */
function carve(solution, maxLevel, rng) {
  const puzzle = solution.slice();
  const minClues = MIN_CLUES[maxLevel];
  const order = shuffle([...Array(41).keys()], rng);
  let clues = 81;
  for (const i of order) {
    const pair = i === 40 ? [40] : [i, 80 - i];
    if (clues - pair.length < minClues) continue;
    const saved = pair.map((p) => puzzle[p]);
    for (const p of pair) puzzle[p] = 0;
    const ok = solveBrute(puzzle, 2).count === 1 && grade(puzzle).level <= maxLevel;
    if (ok) clues -= pair.length;
    else pair.forEach((p, k) => (puzzle[p] = saved[k]));
  }
  return puzzle;
}

/**
 * Generate a puzzle whose hardest required technique is in `level` (1-4).
 *
 * Gives up after `timeLimitMs` and returns the closest puzzle found, so
 * callers always get something playable.
 *
 *   const { puzzle, solution, level } = generate(3);
 */
export function generate(level, { rng = Math.random, timeLimitMs = 8000 } = {}) {
  const started = Date.now();
  let best = null;
  for (let attempt = 0; ; attempt++) {
    const solution = solveBrute(new Array(81).fill(0), 1, rng).solution;
    const puzzle = carve(solution, level, rng);
    const g = grade(puzzle);
    const result = { puzzle, solution, level: g.level, techniques: g.techniques, attempts: attempt + 1 };
    if (g.level === level) return result;
    if (!best || Math.abs(g.level - level) < Math.abs(best.level - level)) best = result;
    if (Date.now() - started > timeLimitMs) return best;
  }
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

/**
 * Work out the next hint for the player's current board.
 *
 * Checks for wrong values first, then for notes that rule out the right
 * digit, then finds the next logical placement (with any elimination steps
 * needed to reach it). Falls back to revealing a cell if logic gets stuck.
 *
 * Returns one of:
 *   { kind: 'mistake', cells }
 *   { kind: 'badNotes', cells }
 *   { kind: 'logic', chain: [step, ...], place: {cell, digit} }
 *   { kind: 'reveal', place: {cell, digit} }
 *   null when the board is already solved.
 */
export function findHint(values, solution, notes = null) {
  const wrong = [];
  for (let i = 0; i < 81; i++) if (values[i] && values[i] !== solution[i]) wrong.push(i);
  if (wrong.length) return { kind: 'mistake', cells: wrong };

  if (notes) {
    const bad = [];
    for (let i = 0; i < 81; i++) if (!values[i] && notes[i] && !(notes[i] & bit(solution[i]))) bad.push(i);
    if (bad.length) return { kind: 'badNotes', cells: bad };
  }

  if (values.every((v) => v)) return null;

  const state = makeState(values);
  const chain = [];
  for (let guard = 0; guard < 50; guard++) {
    const before = state.cands.slice();
    const step = nextStep(state);
    if (!step) break;
    step.candsBefore = before;
    chain.push(step);
    if (step.place) return { kind: 'logic', chain: pruneChain(values, chain), place: step.place };
    applyStep(state, step);
  }

  let cell = -1, fewest = 10;
  for (let i = 0; i < 81; i++) {
    if (values[i]) continue;
    const n = popcount(state.cands[i]);
    if (n < fewest) {
      fewest = n;
      cell = i;
    }
  }
  return { kind: 'reveal', place: { cell, digit: solution[cell] } };
}

const fact = (cell, digit) => cell * 10 + digit;

/** The (cell, digit) candidate facts a step's reasoning depends on. */
function support(step) {
  const out = [];
  const add = (cells, digits) => cells.forEach((c) => digits.forEach((d) => out.push(fact(c, d))));
  const every = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  switch (step.tech) {
    case 'hiddenSingle':
    case 'pointing':
    case 'claiming':
      add(UNITS[step.unit], step.digits);
      break;
    case 'hiddenPair':
    case 'hiddenTriple':
    case 'hiddenQuad':
      add(UNITS[step.unit], step.digits);
      add(step.cells, every);
      break;
    case 'xWing':
    case 'swordfish':
      add(step.baseUnits.flatMap((u) => UNITS[u]), step.digits);
      break;
    default: // singles, naked subsets, wings: the pattern cells' full candidate lists
      add(step.cells, every);
  }
  return out;
}

/**
 * Drop elimination steps that don't feed into the final placement, then
 * replay the rest so each step's candsBefore matches the shorter chain.
 */
function pruneChain(values, chain) {
  const final = chain[chain.length - 1];
  const relevant = new Set(support(final));
  const kept = [final];
  for (let k = chain.length - 2; k >= 0; k--) {
    const step = chain[k];
    if (!step.elims.some((e) => relevant.has(fact(e.cell, e.digit)))) continue;
    kept.unshift(step);
    support(step).forEach((f) => relevant.add(f));
  }
  const state = makeState(values);
  for (const step of kept) {
    step.candsBefore = state.cands.slice();
    step.elims = step.elims.filter((e) => state.cands[e.cell] & bit(e.digit));
    applyStep(state, step);
  }
  return kept;
}

export const TECH_NAMES = {
  fullHouse: 'Full house',
  hiddenSingle: 'Hidden single',
  nakedSingle: 'Naked single',
  pointing: 'Locked candidates (pointing)',
  claiming: 'Locked candidates (claiming)',
  nakedPair: 'Naked pair',
  hiddenPair: 'Hidden pair',
  nakedTriple: 'Naked triple',
  hiddenTriple: 'Hidden triple',
  nakedQuad: 'Naked quad',
  hiddenQuad: 'Hidden quad',
  xWing: 'X-Wing',
  swordfish: 'Swordfish',
  yWing: 'Y-Wing',
  xyzWing: 'XYZ-Wing',
};

const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cellList = (cells) => list(cells.map(cellName));
const cap = (t) => t[0].toUpperCase() + t.slice(1);

function elimSummary(elims) {
  const byDigit = new Map();
  for (const { cell, digit } of elims) {
    if (!byDigit.has(digit)) byDigit.set(digit, []);
    byDigit.get(digit).push(cell);
  }
  return list([...byDigit].map(([d, cells]) => `${d} from ${cellList(cells)}`));
}

/** Plain-language nudge (level 1) for the first step of a logic hint. */
export function nudgeText(step) {
  const where = step.unit !== undefined ? unitName(step.unit) : null;
  switch (step.tech) {
    case 'fullHouse':
      return `Look at ${where}. It's nearly complete.`;
    case 'hiddenSingle':
      return `Look at ${where}. One digit has only one place it can go.`;
    case 'nakedSingle':
      return `Look at ${where}. One of its empty cells has only one possible digit.`;
    case 'xWing':
    case 'swordfish':
      return `Look at where ${step.digits[0]} can go in ${list(step.baseUnits.map(unitName))}.`;
    case 'yWing':
    case 'xyzWing':
      return `Look at the cells around ${cellName(step.pivot)}. Some candidates can be ruled out before the next number appears.`;
    default:
      return `Look at ${where}. Some candidates can be ruled out before the next number appears.`;
  }
}

/**
 * Technique explanation (level 2) for one step, without the technique name.
 * Pass afterElims for a single that only appears once earlier steps ran.
 */
export function explainStep(step, { afterElims = false } = {}) {
  const d = step.digits;
  const where = step.unit !== undefined ? unitName(step.unit) : '';
  if (afterElims && step.tech === 'nakedSingle') return `That leaves ${cellName(step.place.cell)} with only one possible digit.`;
  if (afterElims && step.tech === 'hiddenSingle') return `That leaves ${d[0]} with only one spot in ${where}.`;
  switch (step.tech) {
    case 'fullHouse':
      return `${cap(where)} has one empty cell left, and the only digit it's missing is ${d[0]}.`;
    case 'hiddenSingle':
      return `In ${where}, ${d[0]} fits in only one cell. Every other empty cell there already sees a ${d[0]} in its row, column or box.`;
    case 'nakedSingle':
      return `${cellName(step.place.cell)} has only one possible digit. Its row, column and box already contain the other eight.`;
    case 'pointing':
      return `In ${where}, every spot for ${d[0]} lies in ${unitName(step.line)}. So the ${d[0]} of ${unitName(step.line)} must be inside ${where}, and ${d[0]} can be removed from ${cellList(step.elims.map((e) => e.cell))}.`;
    case 'claiming':
      return `In ${where}, every spot for ${d[0]} lies inside ${unitName(step.box)}. So ${unitName(step.box)} gets its ${d[0]} there, and ${d[0]} can be removed from ${cellList(step.elims.map((e) => e.cell))}.`;
    case 'nakedPair':
    case 'nakedTriple':
    case 'nakedQuad':
      return `${cellList(step.cells)} in ${where} can only hold ${list(d)}. Those digits must go in these ${step.cells.length} cells, so remove ${elimSummary(step.elims)}.`;
    case 'hiddenPair':
    case 'hiddenTriple':
    case 'hiddenQuad':
      return `In ${where}, ${list(d)} can only go in ${cellList(step.cells)}. Those cells are reserved for them, so remove ${elimSummary(step.elims)}.`;
    case 'xWing':
    case 'swordfish':
      return `In ${list(step.baseUnits.map(unitName))}, ${d[0]} can only go in ${list(step.coverUnits.map(unitName))}. Whichever cells end up holding it, those lines get their ${d[0]} here, so remove ${d[0]} from ${cellList(step.elims.map((e) => e.cell))}.`;
    case 'yWing': {
      const [p, w1, w2] = step.cells;
      const c = step.elims[0].digit;
      return `${cellName(p)} is either ${d[0]} or ${d[1]}. If it's ${d[0]}, ${cellName(w1)} becomes ${c}; if it's ${d[1]}, ${cellName(w2)} becomes ${c}. Either way one of them is ${c}, so remove ${c} from ${cellList(step.elims.map((e) => e.cell))}, which see both.`;
    }
    case 'xyzWing': {
      const [p, w1, w2] = step.cells;
      return `${cellName(p)} holds ${list(d)}, and ${cellName(w1)} and ${cellName(w2)} each hold ${step.z} plus one of the others. One of the three must be ${step.z}, so remove ${step.z} from ${cellList(step.elims.map((e) => e.cell))}, which see all three.`;
    }
    default:
      return TECH_NAMES[step.tech];
  }
}

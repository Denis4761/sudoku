// Puzzle modifiers and the daily puzzle plan. Pure functions with no DOM
// access, so they run in the page and under Node for tests.

import { seededRng } from './sudoku.js';

/**
 * Every modifier changes one rule for a single game. `weight` is how much
 * harder it makes the game and is used later to balance quests.
 */
export const MODIFIERS = {
  handNotes: { name: 'Hand notes', weight: 1, blurb: 'Fill all notes is off.' },
  noUndo: { name: 'No undo', weight: 1, blurb: 'Undo is off. Erase still works.' },
  mystery: { name: 'Mystery', weight: 1, blurb: 'A hidden level from Medium to Expert.' },
  blindfold: { name: 'Blindfold', weight: 2, blurb: 'No highlights and no wrong-number marks.' },
  inOrder: { name: 'In order', weight: 2, blurb: 'Finish every 1 before any 2, and so on.' },
  threeStrikes: { name: 'Three strikes', weight: 2, blurb: 'The third wrong number ends the game.' },
  countdown: { name: 'Countdown', weight: 2, blurb: 'Beat a par time or the game ends.' },
  penOnly: { name: 'Pen only', weight: 3, blurb: 'No notes at all.' },
  suddenDeath: { name: 'Sudden death', weight: 3, blurb: 'One wrong number ends the game.' },
};

/** Pairs where turning the first on turns the second off. */
const EXCLUSIVE = [
  ['suddenDeath', 'threeStrikes'],
  ['threeStrikes', 'suddenDeath'],
  ['penOnly', 'handNotes'],
  ['handNotes', 'penOnly'],
];

/**
 * Toggle a modifier in a list, dropping any it can't be combined with.
 *
 *   toggleModifier(['threeStrikes'], 'suddenDeath')  // -> ['suddenDeath']
 */
export function toggleModifier(mods, id) {
  if (mods.includes(id)) return mods.filter((m) => m !== id);
  const drop = new Set(EXCLUSIVE.filter(([a]) => a === id).map(([, b]) => b));
  return [...mods.filter((m) => !drop.has(m)), id];
}

/** Total difficulty weight of a modifier list. */
export const modWeight = (mods) => mods.reduce((sum, m) => sum + (MODIFIERS[m]?.weight ?? 0), 0);

/** Wrong numbers allowed before the game ends, or Infinity. */
export function strikeLimit(mods) {
  if (mods.includes('suddenDeath')) return 1;
  if (mods.includes('threeStrikes')) return 3;
  return Infinity;
}

/** Par times in ms used by Countdown before there is a best time. */
const DEFAULT_PAR = { 1: 10, 2: 18, 3: 30, 4: 45 };

/**
 * Countdown length for a level: half again your best time, never less
 * than a minute, or a default par when there is no best yet.
 *
 *   countdownPar(2, 600000)  // -> 900000 (15:00)
 */
export function countdownPar(level, best) {
  if (best) return Math.max(60000, Math.round((best * 1.5) / 1000) * 1000);
  return DEFAULT_PAR[level] * 60000;
}

/**
 * The only digit In order allows right now: the smallest digit that is not
 * on the board nine times yet. Returns 10 when every digit is complete.
 */
export function nextInOrder(values) {
  const counts = new Array(10).fill(0);
  for (const v of values) counts[v]++;
  for (let d = 1; d <= 9; d++) if (counts[d] < 9) return d;
  return 10;
}

/** Whether placing `digit` is allowed under the game's modifiers. */
export function canPlaceDigit(mods, values, digit) {
  return !mods.includes('inOrder') || digit <= nextInOrder(values);
}

/** Today's date on the phone's clock as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashString(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Level of the daily puzzle by weekday, Sunday first. */
const DAILY_LEVEL = [3, 1, 2, 2, 3, 3, 4];

/** Twists each weekday can draw from, Sunday first: light early in the week, heavy on Saturday. */
const DAILY_TWISTS = [
  ['blindfold', 'inOrder', 'threeStrikes', 'countdown', 'mystery'],
  ['handNotes', 'noUndo'],
  ['handNotes', 'noUndo', 'blindfold'],
  ['blindfold', 'inOrder', 'mystery', 'noUndo'],
  ['inOrder', 'threeStrikes', 'countdown'],
  ['threeStrikes', 'countdown', 'inOrder'],
  ['penOnly', 'suddenDeath'],
];

/**
 * The plan for one day's puzzle, the same every time it is asked for.
 *
 *   dailyPlan('2026-11-09')  // -> { date, level: 1, twist: 'noUndo', seed }
 */
export function dailyPlan(date) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  const seed = hashString(`sudoku-daily-${date}`);
  const rng = seededRng(seed ^ 0x9e3779b9);
  const pool = DAILY_TWISTS[weekday];
  const twist = pool[Math.floor(rng() * pool.length)];
  const level = twist === 'mystery' ? 2 + Math.floor(rng() * 3) : DAILY_LEVEL[weekday];
  return { date, level, twist, seed };
}

/** The date one day before a YYYY-MM-DD date. */
export function previousDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d - 1));
}

/**
 * Days in a row the daily puzzle was solved, counting back from today, or
 * from yesterday when today's isn't solved yet.
 *
 *   dailyStreak({ '2026-11-08': { solved: true } }, '2026-11-09')  // -> 1
 */
export function dailyStreak(log, today) {
  let day = log[today]?.solved ? today : previousDate(today);
  let n = 0;
  while (log[day]?.solved) {
    n++;
    day = previousDate(day);
  }
  return n;
}

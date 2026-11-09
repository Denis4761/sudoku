// Quests: six challenge ladders, daily quests, a weekly gauntlet, stars,
// ranks, milestones and streak freezes. Pure functions over a plain state
// object, so they run in the page and under Node for tests.
//
// The app calls three things:
//   rollover(q, ctx)            on start and when the app comes back, to roll a new day or week
//   recordGame(q, game, ctx)    when a game is solved, failed or abandoned
//   startSpec(quest)            to get the level, modifiers and technique for a quest's Play button

import { seededRng, TECH_NAMES } from './sudoku.js';
import { MODIFIERS, toggleModifier, modWeight, previousDate, dailyStreak } from './modifiers.js';

export const TYPES = {
  clean: { name: 'Clean', blurb: 'no wrong numbers' },
  pure: { name: 'Pure', blurb: 'no hints' },
  speed: { name: 'Speed', blurb: 'beat your own time' },
  hunter: { name: 'Hunter', blurb: 'a puzzle that needs a technique' },
  endurance: { name: 'Endurance', blurb: 'several in a row today' },
  survival: { name: 'Survival', blurb: 'a run that can end early' },
};

const PAIRS = ['nakedPair', 'hiddenPair'];
const TRIPLES = ['nakedTriple', 'hiddenTriple'];

/** The five steps of each ladder. */
export const LADDERS = {
  clean: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 3, mods: ['penOnly'] }, { level: 4, mods: ['penOnly'] }],
  pure: [{ level: 2 }, { level: 3 }, { level: 3, mods: ['noUndo'] }, { level: 4 }, { level: 4, mods: ['noUndo', 'blindfold'] }],
  speed: [{ level: 1, ratio: 1.5 }, { level: 2, ratio: 1.25 }, { level: 3, ratio: 1.25 }, { level: 3, ratio: 1.1 }, { level: 4, ratio: 1 }],
  hunter: [
    { level: 2, techs: PAIRS, label: 'a pair' },
    { level: 3, techs: TRIPLES, label: 'a triple' },
    { level: 3, techs: ['xWing'], label: 'an X-Wing' },
    { level: 4, techs: ['yWing', 'xyzWing'], label: 'a Y-Wing or XYZ-Wing' },
    { level: 4, techs: ['swordfish', 'nakedQuad', 'hiddenQuad'], label: 'a Swordfish or quad' },
  ],
  endurance: [{ level: 1, count: 2 }, { level: 2, count: 2 }, { level: 2, count: 3 }, { level: 3, count: 2 }, { level: 3, count: 3 }],
  survival: [
    { level: 2, mods: ['threeStrikes'] },
    { level: 3, mods: ['threeStrikes'] },
    { level: 3, mods: ['threeStrikes', 'countdown'] },
    { level: 3, mods: ['suddenDeath'] },
    { level: 4, mods: ['suddenDeath', 'countdown'] },
  ],
};

export const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
export const stepLabel = (step) => (step <= 5 ? ROMAN[step - 1] : `V+${step - 5}`);

/** Speed targets before you have a best time at a level. */
const SPEED_DEFAULT = { 1: 8, 2: 15, 3: 25, 4: 40 };

export const RANKS = [
  ['Single', 0], ['Pair', 40], ['Triple', 120], ['X-Wing', 250], ['Y-Wing', 450], ['Swordfish', 750], ['Quad', 1200],
];

/**
 * Rank for a star total, with the next rank to aim for.
 *
 *   rankFor(130)  // -> { name: 'Triple', next: 'X-Wing', from: 120, to: 250 }
 */
export function rankFor(stars) {
  let k = 0;
  while (k + 1 < RANKS.length && stars >= RANKS[k + 1][1]) k++;
  const next = RANKS[k + 1];
  return { name: RANKS[k][0], from: RANKS[k][1], next: next?.[0] ?? null, to: next?.[1] ?? null };
}

/** Milestone families: three thresholds each, read from the counters. */
export const MILESTONES = {
  solver: { name: 'Solver', tiers: [25, 100, 500], unit: 'solved', read: (c) => c.solved },
  streak: { name: 'Streak', tiers: [7, 30, 100], unit: 'day streak', read: (c) => c.bestStreak },
  expert: { name: 'Expert', tiers: [5, 25, 100], unit: 'Expert solves', read: (c) => c.expert },
  collector: { name: 'Collector', tiers: [5, 10, 15], unit: 'techniques', read: (c) => c.techniques.length },
  purist: { name: 'Purist', tiers: [3, 10, 25], unit: 'no-hint Hard+ in a row', read: (c) => c.bestPureRun },
  speedster: { name: 'Speedster', tiers: [1, 2, 3], unit: 'speed marks', read: (c) => c.speedMarks.length, goal: (c) => ['Easy under 4:00', 'Medium under 8:00', 'Hard under 15:00'][[1, 2, 3].find((l) => !c.speedMarks.includes(l)) - 1] },
  flawless: { name: 'Flawless', tiers: [1, 5, 20], unit: 'perfect Experts', read: (c) => c.flawless },
  regular: { name: 'Regular', tiers: [30, 100, 365], unit: 'days played', read: (c) => c.daysPlayed },
  climber: { name: 'Climber', tiers: [2, 4, 6], unit: 'ladders at V', read: (c, q) => Object.values(q.ladders).filter((s) => s > 5).length },
};
const MILESTONE_STARS = [3, 5, 10];

/** Speed marks for the Speedster milestone: level and time to beat. */
const SPEED_MARKS = [[1, 4 * 60000], [2, 8 * 60000], [3, 15 * 60000]];

const DAILY_PUZZLE_STARS = 2;
const FULL_DAY_BONUS = 2;
const GAUNTLET_STARS = 12;
const MAX_FREEZES = 2;

/** A fresh quest state, with solved and Expert counts carried over from existing stats. */
export function newQuestState(stats = {}) {
  const won = (lvl) => stats[lvl]?.won ?? 0;
  return {
    stars: 0,
    ladders: Object.fromEntries(Object.keys(TYPES).map((t) => [t, 1])),
    day: null,
    week: null,
    freezes: 0,
    milestones: {},
    counters: {
      solved: won(1) + won(2) + won(3) + won(4),
      expert: won(4),
      techniques: [],
      pureRun: 0,
      bestPureRun: 0,
      bestStreak: 0,
      speedMarks: [],
      flawless: 0,
      daysPlayed: 0,
      lastPlayed: null,
    },
    lastOffered: {},
    unseen: false,
  };
}

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Monday of the week a YYYY-MM-DD date falls in, used as the week's id. */
export function weekOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() + 6) % 7;
  const mon = new Date(y, m - 1, d - back);
  const p = (n) => String(n).padStart(2, '0');
  return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`;
}

/** Add random modifiers that fit with `mods` until `extra` more are added. */
function addRandomMods(mods, extra, rng, pool = Object.keys(MODIFIERS)) {
  let out = mods.slice();
  for (let k = 0; k < extra; k++) {
    const options = pool.filter((m) => !out.includes(m) && m !== 'mystery' && toggleModifier(out, m).length === out.length + 1);
    if (!options.length) break;
    out = toggleModifier(out, options[Math.floor(rng() * options.length)]);
  }
  return out;
}

/**
 * Build the quest for a ladder type at a step. Steps past V reuse step V
 * and add one random extra modifier per step, picked from the seed.
 *
 *   makeQuest('survival', 2, 'seed')  // -> { type, step: 2, level: 3, mods: ['threeStrikes'], ... }
 */
export function makeQuest(type, step, seed) {
  const base = LADDERS[type][Math.min(step, 5) - 1];
  const rng = seededRng(hash(`${seed}-${type}-${step}`));
  let mods = base.mods ?? [];
  if (step > 5) {
    const pool = type === 'survival' || type === 'clean' ? undefined : Object.keys(MODIFIERS).filter((m) => m !== 'threeStrikes' && m !== 'suddenDeath');
    mods = addRandomMods(mods, step - 5, rng, pool);
  }
  const quest = { id: `${type}-${step}`, type, step, level: base.level, mods, progress: 0, need: base.count ?? 1, done: false };
  if (base.ratio) quest.ratio = base.ratio;
  if (base.techs) Object.assign(quest, { techs: base.techs, techLabel: base.label });
  quest.stars = Math.min(step, 5) + mods.length + Math.max(0, step - 5);
  return quest;
}

/** One-line description of a quest. */
export function describeQuest(q, best = {}) {
  const level = ['', 'Easy', 'Medium', 'Hard', 'Expert'][q.level];
  const harder = q.level < 4 ? ' or harder' : '';
  switch (q.type) {
    case 'daily': return 'Solve today\'s daily puzzle';
    case 'clean': return `${level}${harder} with no wrong numbers`;
    case 'pure': return `${level}${harder} with no hints`;
    case 'speed': {
      const target = speedTarget(q, best[q.level]);
      return `${level} in ${Math.floor(target / 60000)}:${String(Math.floor(target / 1000) % 60).padStart(2, '0')} or less`;
    }
    case 'hunter': return `Solve a puzzle that needs ${q.techLabel}`;
    case 'endurance': return `${q.need} ${level}${harder} solves in a row today`;
    case 'survival': return `Survive a ${level}${harder}`;
    default: return '';
  }
}

export function speedTarget(q, best) {
  return best ? Math.round(best * q.ratio) : SPEED_DEFAULT[q.level] * 60000;
}

/** Pick two ladder types for a day, preferring ones not offered recently. */
function pickTypes(q, date, n = 2, exclude = []) {
  const rng = seededRng(hash(`quests-${date}-${exclude.join()}`));
  const types = Object.keys(TYPES).filter((t) => !exclude.includes(t));
  const ageOf = (t) => (q.lastOffered[t] ? Math.max(1, daysBetween(q.lastOffered[t], date)) : 7);
  const picked = [];
  for (let k = 0; k < n && types.length; k++) {
    const weights = types.map((t) => ageOf(t) ** 2);
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r > weights[i] && i < types.length - 1) r -= weights[i++];
    picked.push(types.splice(i, 1)[0]);
  }
  return picked;
}

function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** The five rungs of a week's gauntlet, harder as you climb your ladders. */
export function makeGauntlet(q, weekId) {
  const rng = seededRng(hash(`gauntlet-${weekId}`));
  const avgStep = Object.values(q.ladders).reduce((a, b) => a + b, 0) / Object.keys(q.ladders).length;
  const lift = Math.min(3, Math.floor((avgStep - 1) / 2));
  const levels = avgStep < 2 ? [1, 2, 2, 3, 3] : [2, 2, 3, 3, 4];
  return [0, 2, 3, 4, 5].map((target, k) => {
    let mods = [];
    while (modWeight(mods) < target + lift) {
      const next = addRandomMods(mods, 1, rng);
      if (next.length === mods.length) break;
      mods = next;
    }
    return { level: levels[k], mods };
  });
}

/**
 * Bring the state up to date for `ctx.today`: use streak freezes on missed
 * days, roll a new day of quests and a new gauntlet when needed.
 * Returns true when anything changed.
 *
 * ctx: { today, dailyLog, dailyTwist }
 */
export function rollover(q, { today, dailyLog }) {
  let changed = false;
  changed = useFreezes(q, today, dailyLog) || changed;
  if (q.day?.date !== today) {
    const types = pickTypes(q, today);
    for (const t of types) q.lastOffered[t] = today;
    q.day = {
      date: today,
      swapped: false,
      bonus: false,
      quests: [
        { id: 'daily', type: 'daily', step: 0, level: 0, mods: [], progress: 0, need: 1, done: false, stars: DAILY_PUZZLE_STARS },
        ...types.map((t) => makeQuest(t, q.ladders[t], today)),
      ],
    };
    changed = true;
  }
  const weekId = weekOf(today);
  if (q.week?.id !== weekId) {
    q.week = { id: weekId, rungs: makeGauntlet(q, weekId), at: 0, done: false };
    changed = true;
  }
  if (dailyLog[today]?.solved && !q.day.quests[0].done) {
    completeQuest(q, q.day.quests[0], []);
    changed = true;
  }
  return changed;
}

/** Cover missed days since the last solved daily with freezes, when there are enough. */
function useFreezes(q, today, log) {
  if (!q.freezes) return false;
  const yesterday = previousDate(today);
  if (log[yesterday]?.solved) return false;
  const missed = [];
  let day = yesterday;
  while (!log[day]?.solved && missed.length <= q.freezes) {
    missed.push(day);
    day = previousDate(day);
  }
  if (missed.length > q.freezes || !log[day]?.solved) return false;
  for (const d of missed) log[d] = { solved: true, frozen: true };
  q.freezes -= missed.length;
  return true;
}

/** Swap one daily quest for a different ladder type, once per day. */
export function swapQuest(q, index) {
  const day = q.day;
  const quest = day?.quests[index];
  if (!quest || day.swapped || quest.type === 'daily' || quest.done) return false;
  const current = day.quests.map((x) => x.type);
  const [type] = pickTypes(q, day.date, 1, current);
  if (!type) return false;
  q.lastOffered[type] = day.date;
  day.quests[index] = makeQuest(type, q.ladders[type], `${day.date}-swap`);
  day.swapped = true;
  return true;
}

function completeQuest(q, quest, events) {
  quest.done = true;
  quest.progress = quest.need;
  q.stars += quest.stars;
  events.push({ kind: 'quest', title: questTitle(quest), stars: quest.stars });
  if (quest.type !== 'daily') {
    q.ladders[quest.type] = quest.step + 1;
    events.push({ kind: 'unlock', title: `${TYPES[quest.type].name} ${stepLabel(quest.step + 1)} unlocked` });
  }
  if (!q.day.bonus && q.day.quests.every((x) => x.done)) {
    q.day.bonus = true;
    q.stars += FULL_DAY_BONUS;
    events.push({ kind: 'bonus', title: 'All three today', stars: FULL_DAY_BONUS });
  }
  q.unseen = true;
}

export function questTitle(quest) {
  return quest.type === 'daily' ? 'Daily puzzle' : `${TYPES[quest.type].name} ${stepLabel(quest.step)}`;
}

/** Whether a finished game satisfies a quest's level and modifiers. */
function fits(quest, g) {
  if (g.level < quest.level) return false;
  return quest.mods.every((m) => g.mods.includes(m));
}

/**
 * Update quests, counters and milestones for a finished game and return
 * what happened, for the Solved sheet.
 *
 * game: { level, mods, mistakes, hints, elapsed, techniques, solved, failed, abandoned, daily, gauntlet, rung }
 * ctx: { today, best (best times by level before this game), dailyLog }
 *
 *   recordGame(q, { level: 3, mods: [], mistakes: 0, hints: 0, solved: true, ... }, ctx)
 *   // -> [{ kind: 'quest', title: 'Clean III', stars: 3 }, ...]
 */
export function recordGame(q, g, { today, best = {}, dailyLog = {} }) {
  const events = [];
  const c = q.counters;
  if (c.lastPlayed !== today) {
    c.daysPlayed++;
    c.lastPlayed = today;
  }
  const quests = q.day?.date === today ? q.day.quests : [];

  if (!g.solved) {
    for (const quest of quests) if (quest.type === 'endurance' && !quest.done) quest.progress = 0;
    if (g.level >= 3) c.pureRun = 0;
    return events;
  }

  c.solved++;
  if (g.level === 4) c.expert++;
  for (const t of g.techniques ?? []) if (TECH_NAMES[t] && !c.techniques.includes(t)) c.techniques.push(t);
  if (g.level >= 3) {
    c.pureRun = g.hints ? 0 : c.pureRun + 1;
    c.bestPureRun = Math.max(c.bestPureRun, c.pureRun);
  }
  if (g.level === 4 && !g.hints && !g.mistakes) c.flawless++;
  for (const [lvl, ms] of SPEED_MARKS) {
    if (g.level === lvl && g.elapsed <= ms && !c.speedMarks.includes(lvl)) c.speedMarks.push(lvl);
  }
  c.bestStreak = Math.max(c.bestStreak, dailyStreak(dailyLog, today));

  for (const quest of quests) {
    if (quest.done) continue;
    let ok = false;
    if (quest.type === 'daily') ok = g.daily === today;
    else if (fits(quest, g)) {
      if (quest.type === 'clean') ok = !g.mistakes;
      else if (quest.type === 'pure') ok = !g.hints;
      else if (quest.type === 'speed') ok = g.elapsed <= speedTarget(quest, best[quest.level]);
      else if (quest.type === 'hunter') ok = (g.techniques ?? []).some((t) => quest.techs.includes(t));
      else if (quest.type === 'survival') ok = true;
      else if (quest.type === 'endurance') {
        quest.progress++;
        ok = quest.progress >= quest.need;
        if (!ok) events.push({ kind: 'progress', title: questTitle(quest), detail: `${quest.progress} / ${quest.need}` });
      }
    }
    if (ok) completeQuest(q, quest, events);
  }

  const week = q.week;
  if (week && !week.done && g.gauntlet === week.id && g.rung === week.at) {
    week.at++;
    if (week.at >= week.rungs.length) {
      week.done = true;
      q.stars += GAUNTLET_STARS;
      q.freezes = Math.min(MAX_FREEZES, q.freezes + 1);
      events.push({ kind: 'gauntlet', title: 'Weekly gauntlet cleared', stars: GAUNTLET_STARS });
    } else {
      events.push({ kind: 'progress', title: 'Weekly gauntlet', detail: `rung ${week.at} of ${week.rungs.length} cleared` });
    }
    q.unseen = true;
  }

  events.push(...checkMilestones(q));
  return events;
}

/** Award any milestone tiers newly reached. */
export function checkMilestones(q) {
  const events = [];
  for (const [id, m] of Object.entries(MILESTONES)) {
    const value = m.read(q.counters, q);
    let tier = q.milestones[id] ?? 0;
    while (tier < 3 && value >= m.tiers[tier]) {
      q.stars += MILESTONE_STARS[tier];
      tier++;
      events.push({ kind: 'milestone', title: `${m.name} ${ROMAN[tier - 1]}`, stars: MILESTONE_STARS[tier - 1] });
    }
    if (tier !== (q.milestones[id] ?? 0)) q.unseen = true;
    q.milestones[id] = tier;
  }
  return events;
}

/** Level, modifiers and wanted techniques for a quest's or rung's Play button. */
export function startSpec(quest) {
  return { level: quest.level, mods: quest.mods, techs: quest.techs ?? null };
}

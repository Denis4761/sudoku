import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newQuestState, rollover, recordGame, makeQuest, swapQuest, rankFor, weekOf, makeGauntlet,
  describeQuest, stepLabel, LADDERS, TYPES,
} from '../js/quests.js';
import { toggleModifier, modWeight } from '../js/modifiers.js';

const game = (over) => ({ level: 3, mods: [], mistakes: 0, hints: 0, elapsed: 600000, techniques: ['hiddenSingle'], solved: true, ...over });

test('rollover rolls a stable day with the daily puzzle and two ladder quests', () => {
  const q = newQuestState();
  assert.ok(rollover(q, { today: '2026-11-09', dailyLog: {} }));
  assert.equal(q.day.quests.length, 3);
  assert.equal(q.day.quests[0].type, 'daily');
  assert.notEqual(q.day.quests[1].type, q.day.quests[2].type);
  const again = newQuestState();
  rollover(again, { today: '2026-11-09', dailyLog: {} });
  assert.deepEqual(again.day, q.day);
  assert.ok(!rollover(q, { today: '2026-11-09', dailyLog: {} }));
  assert.equal(q.week.id, '2026-11-09');
  assert.equal(q.week.rungs.length, 5);
});

test('every ladder quest is completable and moves its ladder up', () => {
  for (const type of Object.keys(TYPES)) {
    const q = newQuestState();
    rollover(q, { today: '2026-11-09', dailyLog: {} });
    q.day.quests[1] = makeQuest(type, 1, 'x');
    const quest = q.day.quests[1];
    const g = game({ level: quest.level, mods: quest.mods, techniques: quest.techs ?? [], elapsed: 1000 });
    for (let k = 0; k < quest.need; k++) recordGame(q, g, { today: '2026-11-09' });
    assert.ok(quest.done, type);
    assert.equal(q.ladders[type], 2, type);
    assert.ok(q.stars >= 1);
  }
});

test('quests check level, modifiers and the challenge rule', () => {
  const q = newQuestState();
  rollover(q, { today: '2026-11-09', dailyLog: {} });
  q.day.quests[1] = makeQuest('survival', 3, 'x');
  q.day.quests[2] = makeQuest('clean', 3, 'x');
  const ctx = { today: '2026-11-09' };
  recordGame(q, game({ mods: ['threeStrikes'], mistakes: 1 }), ctx);
  assert.ok(!q.day.quests[1].done, 'survival III needs countdown too');
  assert.ok(!q.day.quests[2].done, 'clean needs no mistakes');
  recordGame(q, game({ level: 2 }), ctx);
  assert.ok(!q.day.quests[2].done, 'clean III needs Hard');
  const events = recordGame(q, game({ level: 4, mods: ['threeStrikes', 'countdown'] }), ctx);
  assert.ok(q.day.quests[1].done && q.day.quests[2].done);
  assert.ok(events.some((e) => e.kind === 'unlock' && e.title === 'Survival IV unlocked'));
});

test('endurance resets on a failed game', () => {
  const q = newQuestState();
  rollover(q, { today: '2026-11-09', dailyLog: {} });
  q.day.quests[1] = makeQuest('endurance', 3, 'x');
  const ctx = { today: '2026-11-09' };
  recordGame(q, game({ level: 2 }), ctx);
  recordGame(q, game({ level: 2 }), ctx);
  recordGame(q, game({ solved: false, failed: 'strikes' }), ctx);
  assert.equal(q.day.quests[1].progress, 0);
  for (let k = 0; k < 3; k++) recordGame(q, game({ level: 2 }), ctx);
  assert.ok(q.day.quests[1].done);
});

test('daily quest, full-day bonus and stars', () => {
  const q = newQuestState();
  rollover(q, { today: '2026-11-09', dailyLog: {} });
  q.day.quests[1] = makeQuest('pure', 1, 'x');
  q.day.quests[2] = makeQuest('clean', 1, 'x');
  const events = recordGame(q, game({ level: 2, daily: '2026-11-09' }), { today: '2026-11-09' });
  assert.ok(q.day.quests.every((x) => x.done));
  assert.ok(events.some((e) => e.kind === 'bonus'));
  assert.equal(q.stars, 2 + 1 + 1 + 2);
});

test('steps past V add an extra modifier each', () => {
  for (const type of Object.keys(LADDERS)) {
    const five = makeQuest(type, 5, 's');
    const seven = makeQuest(type, 7, 's');
    assert.equal(seven.mods.length, five.mods.length + 2, type);
    assert.equal(seven.stars, five.stars + 4);
    const rebuilt = seven.mods.reduce((m, id) => toggleModifier(m, id), []);
    assert.equal(rebuilt.length, seven.mods.length, `${type} mods are compatible`);
  }
  assert.equal(stepLabel(7), 'V+2');
});

test('swap replaces one quest once per day', () => {
  const q = newQuestState();
  rollover(q, { today: '2026-11-09', dailyLog: {} });
  const before = q.day.quests.map((x) => x.type);
  assert.ok(swapQuest(q, 1));
  assert.ok(!before.includes(q.day.quests[1].type));
  assert.ok(!swapQuest(q, 2));
  assert.ok(!swapQuest(q, 0));
});

test('gauntlet rungs climb and clearing it gives a freeze', () => {
  const q = newQuestState();
  rollover(q, { today: '2026-11-11', dailyLog: {} });
  const weights = q.week.rungs.map((r) => modWeight(r.mods));
  for (let k = 1; k < 5; k++) assert.ok(weights[k] >= weights[k - 1], `rung ${k} weight`);
  for (let k = 0; k < 5; k++) {
    const r = q.week.rungs[k];
    recordGame(q, game({ level: r.level, mods: r.mods, gauntlet: q.week.id, rung: k }), { today: '2026-11-11' });
  }
  assert.ok(q.week.done);
  assert.equal(q.freezes, 1);
  assert.equal(weekOf('2026-11-15'), '2026-11-09');
  assert.deepEqual(makeGauntlet(q, '2026-11-09'), makeGauntlet(q, '2026-11-09'));
});

test('freezes cover a missed day and keep the streak', () => {
  const q = newQuestState();
  q.freezes = 1;
  const log = { '2026-11-07': { solved: true } };
  rollover(q, { today: '2026-11-09', dailyLog: log });
  assert.ok(log['2026-11-08'].frozen);
  assert.equal(q.freezes, 0);
  const q2 = newQuestState();
  q2.freezes = 1;
  const log2 = { '2026-11-05': { solved: true } };
  rollover(q2, { today: '2026-11-09', dailyLog: log2 });
  assert.equal(q2.freezes, 1, 'not enough freezes for three missed days');
});

test('milestones backfill from stats and ranks follow stars', () => {
  const q = newQuestState({ 1: { won: 20 }, 4: { won: 6 } });
  rollover(q, { today: '2026-11-09', dailyLog: {} });
  const events = recordGame(q, game({ level: 1 }), { today: '2026-11-09' });
  assert.ok(events.some((e) => e.title === 'Solver I'));
  assert.ok(events.some((e) => e.title === 'Expert I'));
  assert.equal(rankFor(0).name, 'Single');
  assert.deepEqual(rankFor(130), { name: 'Triple', from: 120, next: 'X-Wing', to: 250 });
  assert.equal(rankFor(5000).next, null);
  assert.match(describeQuest(makeQuest('speed', 2, 'x'), { 2: 600000 }), /Medium in 12:30/);
});

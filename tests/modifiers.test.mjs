import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleModifier, strikeLimit, countdownPar, nextInOrder, canPlaceDigit,
  dailyPlan, dailyStreak, previousDate, localDate, MODIFIERS,
} from '../js/modifiers.js';

test('exclusive modifiers replace each other', () => {
  assert.deepEqual(toggleModifier(['threeStrikes', 'noUndo'], 'suddenDeath'), ['noUndo', 'suddenDeath']);
  assert.deepEqual(toggleModifier(['handNotes'], 'penOnly'), ['penOnly']);
  assert.deepEqual(toggleModifier(['penOnly'], 'penOnly'), []);
});

test('strike limits and countdown par', () => {
  assert.equal(strikeLimit([]), Infinity);
  assert.equal(strikeLimit(['threeStrikes']), 3);
  assert.equal(strikeLimit(['suddenDeath']), 1);
  assert.equal(countdownPar(2, null), 18 * 60000);
  assert.equal(countdownPar(2, 600000), 900000);
  assert.equal(countdownPar(1, 10000), 60000);
});

test('in order allows only the smallest unfinished digit', () => {
  const values = new Array(81).fill(0);
  assert.equal(nextInOrder(values), 1);
  for (let i = 0; i < 9; i++) values[i] = 1;
  assert.equal(nextInOrder(values), 2);
  assert.ok(canPlaceDigit(['inOrder'], values, 2));
  assert.ok(!canPlaceDigit(['inOrder'], values, 3));
  assert.ok(canPlaceDigit([], values, 9));
});

test('daily plan is stable and follows the weekday', () => {
  assert.deepEqual(dailyPlan('2026-11-09'), dailyPlan('2026-11-09'));
  const levels = { '2026-11-09': 1, '2026-11-10': 2, '2026-11-12': 3, '2026-11-14': 4 };
  for (const [date, level] of Object.entries(levels)) {
    const p = dailyPlan(date);
    assert.ok(MODIFIERS[p.twist], `${date} twist`);
    if (p.twist !== 'mystery') assert.equal(p.level, level, date);
  }
  assert.ok(['penOnly', 'suddenDeath'].includes(dailyPlan('2026-11-14').twist));
});

test('daily streak counts back through consecutive days', () => {
  assert.equal(previousDate('2026-03-01'), '2026-02-28');
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
  const log = { '2026-11-07': { solved: true }, '2026-11-08': { solved: true }, '2026-11-05': { solved: true } };
  assert.equal(dailyStreak(log, '2026-11-09'), 2);
  assert.equal(dailyStreak({ ...log, '2026-11-09': { solved: true } }, '2026-11-09'), 3);
  assert.equal(dailyStreak(log, '2026-11-11'), 0);
});

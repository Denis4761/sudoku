import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generate, grade, seededRng, solveBrute, findHint, makeState, nextStep, applyStep,
  parseGrid, bit, explainStep, nudgeText,
} from '../js/sudoku.js';

test('generated puzzles are unique and match the requested level', () => {
  for (const level of [1, 2, 3, 4]) {
    for (let s = 0; s < 3; s++) {
      const r = generate(level, { rng: seededRng(100 * level + s), timeLimitMs: 30000 });
      assert.equal(r.level, level);
      assert.equal(solveBrute(r.puzzle, 2).count, 1);
      assert.deepEqual(solveBrute(r.puzzle, 1).solution, r.solution);
      r.puzzle.forEach((v, i) => v && assert.equal(v, r.solution[i]));
    }
  }
});

test('every logical step is sound against the real solution', () => {
  for (let s = 0; s < 40; s++) {
    const level = 1 + (s % 4);
    const { puzzle, solution } = generate(level, { rng: seededRng(9000 + s), timeLimitMs: 30000 });
    const state = makeState(puzzle);
    for (;;) {
      const step = nextStep(state);
      if (!step) break;
      for (const e of step.elims) assert.notEqual(e.digit, solution[e.cell], `${step.tech} removed the answer`);
      if (step.place) assert.equal(step.place.digit, solution[step.place.cell], `${step.tech} placed wrong`);
      assert.ok(explainStep(step).length > 10);
      assert.ok(nudgeText(step).length > 10);
      applyStep(state, step);
    }
  }
});

test('a known X-Wing puzzle is solved with an X-Wing', () => {
  const xwing = parseGrid('1.....569492.561.8.561.924...964.8.1.64.1....218.356.4.4.5...169.5.614.2621.....5');
  const g = grade(xwing);
  assert.ok(g.techniques.includes('xWing'), g.techniques.join());
});

test('hints flag mistakes, then bad notes, then logic', () => {
  const { puzzle, solution } = generate(2, { rng: seededRng(7) });
  const values = puzzle.slice();
  const empty = values.findIndex((v) => !v);
  values[empty] = (solution[empty] % 9) + 1;
  assert.deepEqual(findHint(values, solution), { kind: 'mistake', cells: [empty] });

  values[empty] = 0;
  const notes = new Array(81).fill(0);
  notes[empty] = bit((solution[empty] % 9) + 1);
  assert.deepEqual(findHint(values, solution, notes), { kind: 'badNotes', cells: [empty] });

  const h = findHint(values, solution, null);
  assert.equal(h.kind, 'logic');
  assert.equal(h.place.digit, solution[h.place.cell]);
  assert.equal(findHint(solution, solution), null);
});

test('multi-step hints keep only steps that lead to the placement, and stay sound', () => {
  let multi = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { puzzle, solution } = generate(4, { rng: seededRng(seed) });
    const state = makeState(puzzle);
    for (;;) {
      const h = findHint(state.values, solution);
      if (!h || h.kind !== 'logic') break;
      if (h.chain.length > 1) multi++;
      const replay = makeState(state.values);
      for (const step of h.chain) {
        assert.ok(step.place || step.elims.length, `${step.tech} kept with nothing to remove`);
        for (const e of step.elims) assert.notEqual(e.digit, solution[e.cell]);
        applyStep(replay, step);
      }
      assert.equal(h.place.digit, solution[h.place.cell]);
      applyStep(state, { place: h.place, elims: [] });
    }
  }
  assert.ok(multi > 0, 'saw at least one multi-step hint');
});

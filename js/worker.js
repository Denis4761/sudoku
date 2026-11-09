import { generate, seededRng } from './sudoku.js';

self.onmessage = (e) => {
  const { id, level, seed } = e.data;
  const r = generate(level, seed == null ? {} : { rng: seededRng(seed) });
  self.postMessage({ id, puzzle: r.puzzle, solution: r.solution, level: r.level, techniques: r.techniques });
};

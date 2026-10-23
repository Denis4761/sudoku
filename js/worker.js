import { generate } from './sudoku.js';

self.onmessage = (e) => {
  const { id, level } = e.data;
  const r = generate(level);
  self.postMessage({ id, puzzle: r.puzzle, solution: r.solution, level: r.level, techniques: r.techniques });
};

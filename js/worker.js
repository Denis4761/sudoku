import { generate, seededRng } from './sudoku.js';

/** Keep generating until a puzzle needs one of `techs`, for up to 25 seconds. */
function generateWith(level, techs) {
  const started = Date.now();
  let r;
  do {
    r = generate(level);
    if (r.techniques.some((t) => techs.includes(t))) return r;
  } while (Date.now() - started < 25000);
  return r;
}

self.onmessage = (e) => {
  const { id, level, seed, techs } = e.data;
  const r = techs ? generateWith(level, techs) : generate(level, seed == null ? {} : { rng: seededRng(seed) });
  self.postMessage({ id, puzzle: r.puzzle, solution: r.solution, level: r.level, techniques: r.techniques });
};

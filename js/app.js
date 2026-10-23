import {
  LEVELS, PEERS, UNITS, bit, boxOf, cellName, colOf, rowOf, conflicts, candidatesFor,
  findHint, nudgeText, explainStep, TECH_NAMES, generate, parseGrid,
} from './sudoku.js';
import * as store from './storage.js';

const HISTORY_LIMIT = 300;
const $ = (sel) => document.querySelector(sel);

const defaults = () => ({
  version: 1,
  game: null,
  history: [],
  settings: { autoClean: true, showMistakes: false, highlightSame: true },
  stats: {},
  bank: {},
  installDismissed: false,
  lastExport: null,
});

let data = defaults();
let selected = -1;
let notesMode = false;
let paused = false;
let hint = null; // { info, level, title, lines, overlay, classes }
let cells = [];
let padButtons = [];

// ---------------------------------------------------------------------------
// Puzzle supply: a Web Worker builds puzzles off the main thread and keeps
// one spare per level so "New game" is instant.
// ---------------------------------------------------------------------------

let worker = null;
let jobId = 0;
const pending = new Map();

function startWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const resolve = pending.get(e.data.id);
      pending.delete(e.data.id);
      resolve?.(e.data);
    };
    worker.onerror = () => (worker = null);
  } catch {
    worker = null;
  }
}

function buildPuzzle(level) {
  if (!worker) {
    return new Promise((resolve) => setTimeout(() => resolve(generate(level)), 30));
  }
  const id = ++jobId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, level });
  });
}

const refilling = new Set();

async function refillBank(level) {
  if (data.bank[level] || refilling.has(level)) return;
  refilling.add(level);
  const p = await buildPuzzle(level);
  refilling.delete(level);
  data.bank[level] = { puzzle: p.puzzle.join(''), solution: p.solution.join(''), level: p.level, techniques: p.techniques };
  persist();
}

async function newGame(level) {
  closeHint();
  let p = data.bank[level];
  if (p) {
    delete data.bank[level];
  } else {
    $('#busy').hidden = false;
    const r = await buildPuzzle(level);
    p = { puzzle: r.puzzle.join(''), solution: r.solution.join(''), level: r.level, techniques: r.techniques };
    $('#busy').hidden = true;
  }
  if (data.game && !data.game.done && data.game.values.some((v, i) => v && !Number(data.game.puzzle[i]))) {
    bumpStat(data.game.level, 'abandoned');
  }
  data.game = {
    level,
    grade: p.level,
    techniques: p.techniques,
    puzzle: p.puzzle,
    solution: p.solution,
    values: parseGrid(p.puzzle),
    notes: new Array(81).fill(0),
    elapsed: 0,
    mistakes: 0,
    hints: 0,
    done: false,
    startedAt: new Date().toISOString(),
  };
  data.history = [];
  bumpStat(level, 'started');
  selected = -1;
  paused = false;
  persist();
  render();
  refillAll(level);
}

/** Keep a spare puzzle for every level, the current level first. */
function refillAll(first) {
  for (const lvl of [first, 1, 2, 3, 4]) refillBank(lvl);
}

// ---------------------------------------------------------------------------
// Game actions. Every change pushes a snapshot first so Undo can revert it.
// ---------------------------------------------------------------------------

const game = () => data.game;
const isGiven = (i) => Number(game().puzzle[i]) !== 0;

function snapshot() {
  const g = game();
  data.history.push({ v: g.values.slice(), n: g.notes.slice() });
  if (data.history.length > HISTORY_LIMIT) data.history.shift();
}

function commit() {
  closeHint();
  persist();
  render();
}

function canEdit(i) {
  const g = game();
  return g && !g.done && !paused && i >= 0 && !isGiven(i);
}

function clearPeerNotes(i, d) {
  const g = game();
  for (const p of PEERS[i]) g.notes[p] &= ~bit(d);
}

function placeValue(i, d) {
  const g = game();
  if (!canEdit(i)) return;
  snapshot();
  if (g.values[i] === d) {
    g.values[i] = 0;
  } else {
    g.values[i] = d;
    g.notes[i] = 0;
    if (d !== Number(g.solution[i])) g.mistakes++;
    if (data.settings.autoClean) clearPeerNotes(i, d);
  }
  commit();
  checkWin();
}

function toggleNote(i, d) {
  const g = game();
  if (!canEdit(i) || g.values[i]) return;
  snapshot();
  g.notes[i] ^= bit(d);
  commit();
}

function erase(i) {
  const g = game();
  if (!canEdit(i) || (!g.values[i] && !g.notes[i])) return;
  snapshot();
  g.values[i] = 0;
  g.notes[i] = 0;
  commit();
}

function undo() {
  const g = game();
  if (!g || g.done || !data.history.length) return;
  const s = data.history.pop();
  g.values = s.v;
  g.notes = s.n;
  commit();
}

function fillNotes() {
  const g = game();
  if (!g || g.done) return;
  snapshot();
  const c = candidatesFor(g.values);
  for (let i = 0; i < 81; i++) if (!g.values[i]) g.notes[i] = c[i];
  commit();
}

function clearNotes() {
  const g = game();
  if (!g || g.done || !g.notes.some(Boolean)) return;
  snapshot();
  g.notes.fill(0);
  commit();
}

function restart() {
  const g = game();
  if (!g || !confirm('Clear all your numbers and notes and start this puzzle over?')) return;
  snapshot();
  g.values = parseGrid(g.puzzle);
  g.notes.fill(0);
  g.done = false;
  commit();
}

function checkWin() {
  const g = game();
  if (g.values.join('') !== g.solution) return;
  g.done = true;
  selected = -1;
  const s = statFor(g.level);
  s.won = (s.won ?? 0) + 1;
  if (!s.best || g.elapsed < s.best) s.best = g.elapsed;
  persist();
  render();
  const bits = [`${LEVELS[g.level].name} in ${fmtTime(g.elapsed)}`];
  bits.push(g.mistakes ? `${g.mistakes} mistake${g.mistakes > 1 ? 's' : ''}` : 'no mistakes');
  bits.push(g.hints ? `${g.hints} hint${g.hints > 1 ? 's' : ''}` : 'no hints');
  $('#win-text').textContent = `${bits.join(', ')}. Best ${LEVELS[g.level].name.toLowerCase()} time: ${fmtTime(s.best)}.`;
  setTimeout(() => $('#win').showModal(), 450);
}

// ---------------------------------------------------------------------------
// Hints: three taps. 1 = where to look, 2 = which technique and why,
// 3 = apply the answer (undoable like any other move).
// ---------------------------------------------------------------------------

function onHint() {
  const g = game();
  if (!g || g.done || paused) return;
  if (hint) return advanceHint();
  const info = findHint(g.values, parseGrid(g.solution), g.notes);
  if (!info) return;
  g.hints++;
  persist();
  hint = { info, level: 1 };
  showHint();
}

function advanceHint() {
  if (hint.level < 2) {
    hint.level++;
    showHint();
  } else {
    applyHint();
  }
}

function showHint() {
  const { info, level } = hint;
  const view = { title: '', lines: [], button: '', classes: {}, overlay: null };
  const mark = (cls, list) => list.forEach((i) => (view.classes[i] = cls));

  if (info.kind === 'mistake') {
    view.title = 'Check your numbers';
    if (level === 1) {
      view.lines = [info.cells.length > 1 ? `${info.cells.length} numbers on the board are wrong.` : 'One number on the board is wrong.'];
      view.button = 'Show where';
    } else {
      mark('hint-wrong', info.cells);
      view.lines = [`Wrong: ${info.cells.map(cellName).join(', ')}.`];
      view.button = info.cells.length > 1 ? 'Remove them' : 'Remove it';
    }
  } else if (info.kind === 'badNotes') {
    view.title = 'Check your notes';
    if (level === 1) {
      view.lines = ["Some of your notes rule out a cell's real answer."];
      view.button = 'Show where';
    } else {
      mark('hint-wrong', info.cells);
      view.lines = [`The notes in ${info.cells.map(cellName).join(', ')} are missing the right digit.`];
      view.button = 'Recalculate those notes';
    }
  } else if (info.kind === 'reveal') {
    view.title = 'Tough spot';
    if (level === 1) {
      view.lines = ['None of the built-in techniques make progress from here. The next step reveals one cell.'];
      view.button = 'Show the cell';
    } else {
      mark('hint-target', [info.place.cell]);
      view.lines = [`${cellName(info.place.cell)} is the most constrained cell.`];
      view.button = 'Reveal it';
    }
  } else {
    const { chain, place } = info;
    const first = chain[0];
    const final = chain[chain.length - 1];
    if (level === 1) {
      view.title = 'Where to look';
      mark('hint-focus', first.focus);
      view.lines = [nudgeText(first)];
      view.button = 'Show technique';
    } else {
      const elimSteps = chain.filter((s) => !s.place);
      view.title = [...new Set(chain.map((s) => TECH_NAMES[s.tech]))].join(' → ');
      view.lines = chain.map((s, k) => ({
        name: chain.length === 1 ? '' : k === chain.length - 1 ? `Then, ${TECH_NAMES[s.tech].toLowerCase()}.` : `${TECH_NAMES[s.tech]}.`,
        text: explainStep(s, { afterElims: k > 0 }),
      }));
      if (elimSteps.length) {
        view.overlay = buildOverlay(elimSteps);
        elimSteps.forEach((s) => mark('hint-focus', s.elims.map((e) => e.cell)));
        elimSteps.forEach((s) => mark('hint-pattern', s.cells));
      }
      if (final.tech === 'nakedSingle') {
        mark('hint-target', [place.cell]);
      } else if (final.unit !== undefined && !elimSteps.length) {
        mark('hint-focus', UNITS[final.unit]);
      }
      view.sameDigit = final.tech === 'hiddenSingle' ? place.digit : 0;
      view.button = 'Show answer';
    }
  }

  hint.view = view;
  $('#hint-step').textContent = `Hint ${hint.level}/3`;
  $('#hint-title').textContent = view.title;
  $('#hint-text').replaceChildren(...view.lines.map(hintLine));
  $('#hint-next').textContent = view.button;
  $('#hint-panel').hidden = false;
  render();
}

function hintLine(line) {
  const p = document.createElement('p');
  if (typeof line === 'string') {
    p.textContent = line;
  } else {
    if (line.name) p.append(Object.assign(document.createElement('b'), { textContent: line.name }), ' ');
    p.append(line.text);
  }
  return p;
}

/** Candidate overlay for hint step 2: pattern digits in blue, removed ones struck out in red. */
function buildOverlay(steps) {
  const overlay = {};
  for (const s of steps) {
    for (const c of s.cells) {
      overlay[c] ??= { cands: s.candsBefore[c], keep: 0, elim: 0 };
      for (const d of s.digits) overlay[c].keep |= s.candsBefore[c] & bit(d);
    }
    for (const e of s.elims) {
      overlay[e.cell] ??= { cands: s.candsBefore[e.cell], keep: 0, elim: 0 };
      overlay[e.cell].elim |= bit(e.digit);
    }
  }
  return overlay;
}

function applyHint() {
  const g = game();
  const { info } = hint;
  let flashCells;
  closeHint();
  snapshot();
  if (info.kind === 'mistake') {
    for (const i of info.cells) g.values[i] = 0;
    flashCells = info.cells;
  } else if (info.kind === 'badNotes') {
    const c = candidatesFor(g.values);
    for (const i of info.cells) g.notes[i] = c[i];
    flashCells = info.cells;
  } else {
    if (info.kind === 'logic') {
      for (const e of info.chain.flatMap((s) => s.elims)) g.notes[e.cell] &= ~bit(e.digit);
    }
    const { cell, digit } = info.place;
    g.values[cell] = digit;
    g.notes[cell] = 0;
    if (data.settings.autoClean) clearPeerNotes(cell, digit);
    selected = cell;
    flashCells = [cell];
  }
  commit();
  flash(flashCells);
  checkWin();
}

function closeHint() {
  if (!hint) return;
  hint = null;
  $('#hint-panel').hidden = true;
  render();
}

function flash(list) {
  for (const i of list) {
    cells[i].classList.remove('flash');
    void cells[i].offsetWidth;
    cells[i].classList.add('flash');
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function buildBoard() {
  const board = $('#board');
  const boxes = [];
  for (let b = 0; b < 9; b++) {
    const box = document.createElement('div');
    box.className = 'box';
    boxes.push(box);
    board.append(box);
  }
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('role', 'gridcell');
    cell.dataset.i = i;
    const v = document.createElement('span');
    v.className = 'v';
    const notes = document.createElement('div');
    notes.className = 'notes';
    for (let d = 1; d <= 9; d++) notes.append(document.createElement('span'));
    cell.append(v, notes);
    cells[i] = cell;
  }
  // Append cells box by box so each box is its own 3x3 grid.
  for (let b = 0; b < 9; b++) {
    for (let k = 0; k < 9; k++) {
      const r = 3 * ((b / 3) | 0) + ((k / 3) | 0);
      const c = 3 * (b % 3) + (k % 3);
      boxes[b].append(cells[r * 9 + c]);
    }
  }
  board.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !game() || paused) return;
    selected = Number(cell.dataset.i);
    render();
  });

  const pad = $('#pad');
  for (let d = 1; d <= 9; d++) {
    const b = document.createElement('button');
    b.dataset.d = d;
    b.append(String(d), document.createElement('small'));
    b.addEventListener('click', () => onDigit(d));
    pad.append(b);
    padButtons[d] = b;
  }
}

function render() {
  const g = game();
  $('#level-label').textContent = g ? LEVELS[g.level].name : 'Sudoku';
  $('#meta-label').textContent = g ? metaText(g) : '';
  $('#notes-state').textContent = notesMode ? 'on' : 'off';
  $('#notes-btn').setAttribute('aria-pressed', String(notesMode));
  $('#pad').classList.toggle('notes-mode', notesMode);
  $('#undo-btn').disabled = !g || g.done || !data.history.length;
  $('#paused').hidden = !paused;
  renderTimer();
  if (!g) return;

  const sol = g.solution;
  const dupes = conflicts(g.values);
  const selVal = selected >= 0 ? g.values[selected] : 0;
  const view = hint?.view;
  const sameDigit = view?.sameDigit || (data.settings.highlightSame ? selVal : 0);
  const showPeers = selected >= 0 && !view;

  for (let i = 0; i < 81; i++) {
    const el = cells[i];
    const v = g.values[i];
    const given = isGiven(i);
    const wrong = v && !given && (dupes.has(i) || (data.settings.showMistakes && v !== Number(sol[i])));
    const peer = showPeers && i !== selected && (rowOf(i) === rowOf(selected) || colOf(i) === colOf(selected) || boxOf(i) === boxOf(selected));
    const hintCls = view?.classes[i];

    el.className = 'cell';
    if (given) el.classList.add('given');
    if (peer) el.classList.add('peer');
    if (sameDigit && v === sameDigit) el.classList.add('same');
    if (i === selected && !view) el.classList.add('sel');
    if (wrong) el.classList.add('bad');
    if (hintCls) el.classList.add(hintCls);

    el.firstChild.textContent = v || '';
    const overlay = view?.overlay?.[i];
    const noteMask = v ? 0 : overlay ? overlay.cands : g.notes[i];
    const spans = el.lastChild.children;
    for (let d = 1; d <= 9; d++) {
      const s = spans[d - 1];
      const on = (noteMask & bit(d)) !== 0;
      s.textContent = on ? d : '';
      s.className = !on ? '' : overlay?.elim & bit(d) ? 'elim' : overlay?.keep & bit(d) ? 'keep' : !overlay && sameDigit === d ? 'on-same' : '';
    }
    el.setAttribute('aria-label', `${cellName(i)} ${v || 'empty'}`);
  }

  const counts = new Array(10).fill(0);
  for (const v of g.values) counts[v]++;
  for (let d = 1; d <= 9; d++) {
    padButtons[d].classList.toggle('done', counts[d] >= 9 && !dupes.size);
    padButtons[d].lastChild.textContent = 9 - counts[d] > 0 ? 9 - counts[d] : '';
  }
}

function metaText(g) {
  const parts = [];
  if (g.mistakes) parts.push(`${g.mistakes} mistake${g.mistakes > 1 ? 's' : ''}`);
  if (g.hints) parts.push(`${g.hints} hint${g.hints > 1 ? 's' : ''}`);
  if (g.done) parts.unshift('Solved');
  return parts.join(' · ');
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function renderTimer() {
  const g = game();
  $('#timer').textContent = g ? (paused ? '▶ ' : '') + fmtTime(g.elapsed) : '0:00';
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function onDigit(d) {
  if (selected < 0) return;
  if (notesMode) toggleNote(selected, d);
  else placeValue(selected, d);
}

function setPaused(p) {
  const g = game();
  if (!g || g.done) return;
  paused = p;
  if (p) closeHint();
  render();
}

function moveSelection(dr, dc) {
  if (selected < 0) selected = 40;
  else selected = ((rowOf(selected) + dr + 9) % 9) * 9 + ((colOf(selected) + dc + 9) % 9);
  render();
}

function onKey(e) {
  if (document.querySelector('dialog[open]') || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k >= '1' && k <= '9') onDigit(Number(k));
  else if (k === 'Backspace' || k === 'Delete' || k === '0') erase(selected);
  else if (k === 'ArrowUp') moveSelection(-1, 0);
  else if (k === 'ArrowDown') moveSelection(1, 0);
  else if (k === 'ArrowLeft') moveSelection(0, -1);
  else if (k === 'ArrowRight') moveSelection(0, 1);
  else if (k === 'n') toggleNotesMode();
  else if (k === 'z' || k === 'u') undo();
  else if (k === 'h') onHint();
  else if (k === 'Escape') closeHint();
  else return;
  e.preventDefault();
}

function toggleNotesMode() {
  notesMode = !notesMode;
  render();
}

// ---------------------------------------------------------------------------
// Persistence, timer, stats
// ---------------------------------------------------------------------------

function persist() {
  store.save(data);
}

function statFor(level) {
  data.stats[level] ??= {};
  return data.stats[level];
}

function bumpStat(level, key) {
  const s = statFor(level);
  s[key] = (s[key] ?? 0) + 1;
}

let lastTick = performance.now();
let ticksSinceSave = 0;

function tick() {
  const now = performance.now();
  const g = game();
  if (g && !g.done && !paused && document.visibilityState === 'visible' && !$('#menu').open) {
    g.elapsed += Math.min(now - lastTick, 2000);
    renderTimer();
    if (++ticksSinceSave >= 10) {
      ticksSinceSave = 0;
      persist();
    }
  }
  lastTick = now;
}

// ---------------------------------------------------------------------------
// Menu, backup and install hints
// ---------------------------------------------------------------------------

function openMenu() {
  const wrap = $('#level-buttons');
  wrap.replaceChildren();
  for (const [lvl, info] of Object.entries(LEVELS)) {
    const b = document.createElement('button');
    b.innerHTML = `<b></b><span></span>`;
    b.firstChild.textContent = info.name;
    b.lastChild.textContent = info.blurb;
    if (game()?.level === Number(lvl)) b.classList.add('current');
    b.addEventListener('click', () => {
      const g = game();
      const inProgress = g && !g.done && g.values.some((v, i) => v && !isGiven(i));
      if (inProgress && !confirm('Start a new game? The current one will be replaced.')) return;
      $('#menu').close();
      newGame(Number(lvl));
    });
    wrap.append(b);
  }
  for (const key of Object.keys(data.settings)) $(`#set-${key}`).checked = data.settings[key];
  renderStats();
  $('#backup-status').textContent = data.lastExport ? `Last backup: ${new Date(data.lastExport).toLocaleDateString()}` : 'No backup exported yet.';
  $('#menu').showModal();
}

function renderStats() {
  const wrap = $('#stats');
  wrap.replaceChildren();
  for (const [lvl, info] of Object.entries(LEVELS)) {
    const s = data.stats[lvl] ?? {};
    const div = document.createElement('div');
    div.innerHTML = `<span></span><b></b><span></span>`;
    div.children[0].textContent = info.name;
    div.children[1].textContent = s.won ?? 0;
    div.children[2].textContent = s.best ? `best ${fmtTime(s.best)}` : 'solved';
    wrap.append(div);
  }
}

async function exportBackup() {
  const payload = { app: 'sudoku-pwa', ...data, exportedAt: new Date().toISOString() };
  delete payload.bank;
  const name = `sudoku-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sudoku backup' });
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    data.lastExport = Date.now();
    persist();
    $('#backup-status').textContent = 'Backup exported.';
  } catch (err) {
    if (err?.name !== 'AbortError') $('#backup-status').textContent = `Export failed: ${err?.message ?? err}`;
  }
}

function validBackup(b) {
  if (!b || b.app !== 'sudoku-pwa' || typeof b.settings !== 'object') return false;
  if (b.game === null) return true;
  const g = b.game;
  return typeof g.puzzle === 'string' && g.puzzle.length === 81 && typeof g.solution === 'string' && g.solution.length === 81
    && Array.isArray(g.values) && g.values.length === 81 && Array.isArray(g.notes) && g.notes.length === 81;
}

async function importBackup(file) {
  try {
    const b = JSON.parse(await file.text());
    if (!validBackup(b)) throw new Error("this doesn't look like a Sudoku backup");
    if (!confirm('Replace the current game, settings and stats with this backup?')) return;
    const bank = data.bank;
    data = { ...defaults(), ...b, bank };
    delete data.app;
    delete data.exportedAt;
    closeHint();
    selected = -1;
    paused = false;
    persist();
    render();
    $('#backup-status').textContent = 'Backup restored.';
  } catch (err) {
    $('#backup-status').textContent = `Import failed: ${err.message}`;
  }
}

function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function maybeShowInstallBanner() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install-banner').hidden = !ios || isStandalone() || data.installDismissed;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function wire() {
  $('#menu-btn').addEventListener('click', openMenu);
  $('#timer').addEventListener('click', () => setPaused(!paused));
  $('#resume').addEventListener('click', () => setPaused(false));
  $('#undo-btn').addEventListener('click', undo);
  $('#erase-btn').addEventListener('click', () => erase(selected));
  $('#notes-btn').addEventListener('click', toggleNotesMode);
  $('#hint-btn').addEventListener('click', onHint);
  $('#hint-next').addEventListener('click', advanceHint);
  $('#hint-close').addEventListener('click', closeHint);
  $('#fill-notes').addEventListener('click', () => { $('#menu').close(); fillNotes(); });
  $('#clear-notes').addEventListener('click', () => { $('#menu').close(); clearNotes(); });
  $('#restart').addEventListener('click', () => { $('#menu').close(); restart(); });
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) importBackup(f);
  });
  for (const key of Object.keys(defaults().settings)) {
    $(`#set-${key}`).addEventListener('change', (e) => {
      data.settings[key] = e.target.checked;
      persist();
      render();
    });
  }
  $('#win').addEventListener('close', () => {
    if ($('#win').returnValue === 'new') openMenu();
  });
  $('#install-dismiss').addEventListener('click', () => {
    data.installDismissed = true;
    persist();
    maybeShowInstallBanner();
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    lastTick = performance.now();
    if (document.visibilityState === 'hidden') persist();
  });
  window.addEventListener('pagehide', persist);
  setInterval(tick, 1000);
}

async function main() {
  buildBoard();
  wire();
  const saved = await store.load();
  if (saved) data = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings } };
  store.requestPersist();
  startWorker();
  maybeShowInstallBanner();
  render();
  if (data.game) refillAll(data.game.level);
  else openMenu();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main();

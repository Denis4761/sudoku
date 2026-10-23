// Headless smoke test of the UI on an iPhone-sized viewport.
// Run: npx http-server -p 8080 . & node tests/ui.mjs
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8080/';
const OUT = process.env.OUT ?? '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudoku.save.v1')));

await page.goto(BASE);
await page.waitForSelector('#menu[open]');
await page.screenshot({ path: `${OUT}/01-menu.png` });
await page.click('#level-buttons button:nth-child(2)');
await page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelectorAll('.cell.given').length > 0, null, { timeout: 30000 });

let s = await state();
assert(s.game.level === 2, 'medium game started');
const empty = s.game.values.findIndex((v) => !v);
const answer = Number(s.game.solution[empty]);
const wrong = (answer % 9) + 1;

await page.tap(`.cell[data-i="${empty}"]`);
await page.tap(`#pad button[data-d="${wrong}"]`);
s = await state();
assert(s.game.values[empty] === wrong && s.game.mistakes === 1, 'wrong value placed and counted');

await page.tap('#undo-btn');
s = await state();
assert(s.game.values[empty] === 0, 'undo cleared value');

await page.tap('#notes-btn');
for (const d of [1, 3, 5, 7]) await page.tap(`#pad button[data-d="${d}"]`);
s = await state();
assert(s.game.notes[empty] === (2 | 8 | 32 | 128), 'four notes in one cell');
await page.tap('#undo-btn');
s = await state();
assert(s.game.notes[empty] === (2 | 8 | 32), 'undo removed last note');
await page.tap('#notes-btn');

await page.reload();
await page.waitForSelector('.cell.given');
s = await state();
assert(s.game.notes[empty] === (2 | 8 | 32), 'notes persisted across reload');
assert(s.history.length === 3, `undo history persisted (${s.history.length})`);

// Clear the notes so the hint is about logic, not bad notes.
await page.tap(`.cell[data-i="${empty}"]`);
await page.tap('#erase-btn');

await page.tap('#hint-btn');
await page.waitForSelector('#hint-panel:not([hidden])');
await page.screenshot({ path: `${OUT}/02-hint1.png` });
const nudge = await page.textContent('#hint-text');
await page.tap('#hint-next');
await page.screenshot({ path: `${OUT}/03-hint2.png` });
const tech = await page.textContent('#hint-title');
const before = (await state()).game.values.filter(Boolean).length;
await page.tap('#hint-next');
s = await state();
assert(s.game.values.filter(Boolean).length === before + 1, 'hint placed a value');
assert(s.game.values.every((v, i) => !v || v === Number(s.game.solution[i])), 'hint placement correct');
console.log('hint:', tech, '|', nudge);

await page.tap('#undo-btn');
s = await state();
assert(s.game.values.filter(Boolean).length === before, 'undo reverted hint');

// Play the rest via the keyboard to hit the win screen.
const sol = s.game.solution;
for (let i = 0; i < 81; i++) {
  if (s.game.values[i]) continue;
  await page.tap(`.cell[data-i="${i}"]`);
  await page.keyboard.press(sol[i]);
}
await page.waitForSelector('#win[open]');
await page.screenshot({ path: `${OUT}/04-win.png` });
console.log('win:', await page.textContent('#win-text'));

await page.click('#win button[value="new"]');
await page.waitForSelector('#menu[open]');
await page.click('#level-buttons button:nth-child(4)');
await page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelectorAll('.cell.given').length > 0, null, { timeout: 60000 });
await page.click('#menu-btn');
await page.click('#fill-notes');
await page.screenshot({ path: `${OUT}/05-expert-notes.png` });
await page.tap('#hint-btn');
await page.tap('#hint-next');
await page.screenshot({ path: `${OUT}/06-expert-hint.png` });
console.log('expert hint:', await page.textContent('#hint-title'), '|', await page.textContent('#hint-text'));

await page.emulateMedia({ colorScheme: 'dark' });
await page.screenshot({ path: `${OUT}/07-dark.png` });

assert(!errors.length, 'console errors: ' + errors.join('\n'));
console.log('UI OK');
await browser.close();

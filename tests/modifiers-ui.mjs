// Headless check of modifiers and the daily puzzle on an iPhone-sized viewport.
// Run: npx http-server -p 8080 . & node tests/modifiers-ui.mjs
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:8080/';
const OUT = process.env.OUT ?? '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('sudoku.save.v1')));
const ready = () => page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelectorAll('.cell.given').length > 0, null, { timeout: 60000 });
const chip = (name) => page.click(`#mod-chips .chip:text-is("${name}")`);
const emptyCells = (g) => g.values.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);

await page.goto(BASE);
await page.waitForSelector('#menu[open]');
await chip('Three strikes');
await chip('No undo');
await chip('Pen only');
await page.screenshot({ path: `${OUT}/m1-menu.png` });
await page.click('#level-buttons button:nth-child(1)');
await ready();

let s = await state();
assert(JSON.stringify(s.game.mods) === '["threeStrikes","noUndo","penOnly"]', 'mods saved on the game: ' + s.game.mods);
assert(await page.isDisabled('#notes-btn'), 'pen only disables notes');
const cells = emptyCells(s.game);
for (let k = 0; k < 2; k++) {
  const i = cells[k];
  await page.tap(`.cell[data-i="${i}"]`);
  await page.tap(`#pad button[data-d="${(Number(s.game.solution[i]) % 9) + 1}"]`);
}
assert(await page.isDisabled('#undo-btn'), 'no undo disables undo');
assert((await page.textContent('#mods-bar')).includes('✕✕○'), 'two strikes shown');
await page.screenshot({ path: `${OUT}/m2-strikes.png` });
const i3 = cells[2];
await page.tap(`.cell[data-i="${i3}"]`);
await page.tap(`#pad button[data-d="${(Number(s.game.solution[i3]) % 9) + 1}"]`);
await page.waitForSelector('#fail[open]');
await page.screenshot({ path: `${OUT}/m3-fail.png` });
s = await state();
assert(s.game.failed === 'strikes' && s.game.done, 'third strike fails the game');
const oldPuzzle = s.game.puzzle;
await page.click('#fail button[value="retry"]');
await page.waitForFunction((old) => JSON.parse(localStorage.getItem('sudoku.save.v1')).game.puzzle !== old, oldPuzzle, { timeout: 60000 });
await ready();
s = await state();
assert(s.game.puzzle !== oldPuzzle && !s.game.failed && s.game.mods.includes('threeStrikes'), 'retry gives a new puzzle with the same mods');

await page.click('#menu-btn');
for (const name of ['Three strikes', 'No undo', 'Pen only']) await chip(name);
await chip('In order');
await page.click('#level-buttons button:nth-child(1)');
await ready();
s = await state();
const counts = new Array(10).fill(0);
s.game.values.forEach((v) => counts[v]++);
const firstOpen = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => counts[d] < 9);
const blocked = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => d > firstOpen);
const target = emptyCells(s.game).find((i) => Number(s.game.solution[i]) === blocked);
await page.tap(`.cell[data-i="${target}"]`);
await page.tap(`#pad button[data-d="${blocked}"]`);
s = await state();
assert(s.game.values[target] === 0, 'in order blocks a later digit');
assert(await page.isVisible('#toast'), 'in order shows a toast');
await page.screenshot({ path: `${OUT}/m4-inorder.png` });

await page.click('#menu-btn');
await chip('In order');
await page.screenshot({ path: `${OUT}/m5-daily-card.png` });
await page.click('#daily-btn');
await ready();
s = await state();
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
assert(s.game.daily === today && s.game.mods.length === 1, 'daily game started with one twist');
assert(s.daily.puzzle.date === today && s.daily.puzzle.puzzle === s.game.puzzle, 'daily puzzle cached for today');
assert((await page.textContent('#level-label')).startsWith('Daily'), 'daily label');
await page.screenshot({ path: `${OUT}/m6-daily.png` });

// Solve the daily in order (works for any twist) and check the streak.
for (let d = 1; d <= 9; d++) {
  s = await state();
  for (const i of emptyCells(s.game)) {
    if (Number(s.game.solution[i]) !== d) continue;
    await page.tap(`.cell[data-i="${i}"]`);
    await page.keyboard.press(String(d));
  }
}
await page.waitForSelector('#win[open]');
const winText = await page.textContent('#win-text');
assert(winText.includes('Daily streak: 1 day'), 'daily win text: ' + winText);
s = await state();
assert(s.daily.log[today]?.solved, 'daily logged');
await page.screenshot({ path: `${OUT}/m7-daily-win.png` });
await page.click('#win button[value="new"]');
await page.waitForSelector('#menu[open]');
assert(await page.isDisabled('#daily-btn'), 'solved daily card is disabled');
await page.emulateMedia({ colorScheme: 'dark' });
await page.screenshot({ path: `${OUT}/m8-menu-dark.png` });

assert(!errors.length, 'console errors: ' + errors.join('\n'));
console.log('MODIFIERS UI OK');
await browser.close();

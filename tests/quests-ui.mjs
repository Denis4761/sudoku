// Headless check of the Quests sheet, quest games and the Solved sheet.
// Run: npx http-server -p 8080 . & node tests/quests-ui.mjs
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
const ready = () => page.waitForFunction(() => document.querySelector('#busy').hidden && document.querySelectorAll('.cell.given').length > 0, null, { timeout: 90000 });

/** Fill the rest of the board digit by digit, which also satisfies In order. */
async function solve() {
  for (let d = 1; d <= 9; d++) {
    const s = await state();
    for (let i = 0; i < 81; i++) {
      if (s.game.values[i] || Number(s.game.solution[i]) !== d) continue;
      await page.tap(`.cell[data-i="${i}"]`);
      await page.keyboard.press(String(d));
    }
  }
  await page.waitForSelector('#win[open]');
}

// Pretend this phone already has some games, to check the milestone backfill.
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('sudoku.save.v1', JSON.stringify({
    version: 1, game: null, history: [], settings: { autoClean: true, showMistakes: false, highlightSame: true },
    stats: { 1: { won: 22, best: 300000 }, 4: { won: 5, best: 1800000 } }, bank: {}, installDismissed: true,
  }));
});
await page.goto(BASE);
await page.waitForSelector('#menu[open]');
await page.click('#menu .sheet-head button');

await page.click('#quests-btn');
await page.waitForSelector('#quests[open]');
let s = await state();
assert(s.quests.day.quests.length === 3, 'three daily quests');
assert(s.quests.milestones.expert === 1, 'Expert I backfilled from stats');
assert(s.quests.stars === 6 && s.quests.milestones.solver === 1, `backfill stars (${s.quests.stars})`);
assert((await page.$$('#ladders .ladder')).length === 6, 'six ladders');
assert((await page.$$('#milestones .ms')).length === 9, 'nine milestone families');
await page.screenshot({ path: `${OUT}/q1-sheet.png` });
await page.evaluate(() => document.querySelector('#quests').scrollTo(0, 2000));
await page.screenshot({ path: `${OUT}/q2-sheet-bottom.png` });
await page.evaluate(() => document.querySelector('#quests').scrollTo(0, 0));

const before = s.quests.day.quests[1].type;
await page.click('#today-quests .q:nth-child(2) .q-swap');
s = await state();
assert(s.quests.day.swapped && s.quests.day.quests[1].type !== before, 'swap replaced the quest');
assert(!(await page.$('#today-quests .q-swap')), 'swap buttons gone after use');

const slow = (t) => t === 'hunter' || t === 'endurance';
const pick = slow(s.quests.day.quests[1].type) && !slow(s.quests.day.quests[2].type) ? 3 : 2;
const quest = s.quests.day.quests[pick - 1];
await page.click(`#today-quests .q:nth-child(${pick}) .q-play`);
await ready();
s = await state();
assert(s.game.level === quest.level && JSON.stringify(s.game.mods) === JSON.stringify(quest.mods), 'quest game uses the quest level and modifiers');
await page.screenshot({ path: `${OUT}/q3-quest-game.png` });
await solve();
await page.screenshot({ path: `${OUT}/q4-win.png` });
s = await state();
const done = s.quests.day.quests[pick - 1];
if (!slow(done.type)) {
  assert(done.done, `${done.type} quest completed`);
  assert(s.quests.ladders[done.type] === 2, 'ladder moved up');
  assert((await page.textContent('#win-quests')).includes('unlocked'), 'win sheet lists the unlock');
}
console.log('played:', done.type, done.done ? 'done' : `${done.progress}/${done.need}`, '|', await page.textContent('#win-quests'));

await page.click('#win button[value="quests"]');
await page.waitForSelector('#quests[open]');
assert(await page.isHidden('#quests-dot'), 'opening quests clears the dot');
await page.click('#gauntlet .q-play');
await ready();
await solve();
s = await state();
assert(s.quests.week.at === 1, 'gauntlet rung cleared');

await page.click('#win button[value="quests"]');
await page.waitForSelector('#quests[open]');
await page.emulateMedia({ colorScheme: 'dark' });
await page.screenshot({ path: `${OUT}/q5-sheet-dark.png` });

assert(!errors.length, 'console errors: ' + errors.join('\n'));
console.log('QUESTS UI OK');
await browser.close();

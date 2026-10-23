# Sudoku

A personal Sudoku game for iPhone, built as an offline web app. No App Store, no signing, no fees.

**Play:** https://denis4761.github.io/sudoku/

## Install on iPhone

1. Open the link above in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Launch it from the Home Screen icon. It runs full screen and works offline.

Always launch from the Home Screen icon: that copy has its own storage, separate from Safari tabs.

## Features

- **Autosave** after every move to IndexedDB, mirrored to localStorage, with persistent storage requested from the browser.
- **Notes**: toggle Notes and tap digits to add or remove candidates; any number per cell. *Fill all notes* in the menu computes them for you.
- **Undo** for every value, note, erase and hint (history survives closing the app).
- **Hints in three taps**: 1) where to look, 2) the technique and why it works, with the relevant candidates drawn on the board, 3) the answer, placed for you (undoable). Hints check for wrong numbers and broken notes first.
- **Difficulty by technique**, not just clue count:
  - Easy: singles only
  - Medium: locked candidates, pairs
  - Hard: triples, X-Wing
  - Expert: Y-Wing, XYZ-Wing, Swordfish, quads
- **Backup**: Menu → Export backup opens the share sheet so you can save a JSON file to Files or iCloud Drive; Import backup restores it.

## Development

Plain HTML, CSS and ES modules; no build step.

```sh
npx http-server -p 8080 .        # serve locally
node --test tests/*.test.mjs     # engine tests
node tests/ui.mjs                # headless UI smoke test (needs playwright)
```

`js/sudoku.js` holds the solver, generator, grader and hint engine; `js/app.js` the UI; `sw.js` the offline cache.

// Saves the whole app state to IndexedDB and mirrors it to localStorage.
// On load the newer of the two copies wins, so either one surviving is enough.

const DB_NAME = 'sudoku';
const STORE = 'kv';
const KEY = 'save';
const LS_KEY = 'sudoku.save.v1';

let dbPromise = null;

function openDb() {
  if (!('indexedDB' in self)) return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function idbGet() {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(value) {
  const db = await openDb();
  if (!db) return;
  db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, KEY);
}

function lsGet() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY));
  } catch {
    return null;
  }
}

/**
 * Load the most recent saved state, or null on first run.
 *
 *   const data = (await load()) ?? defaults();
 */
export async function load() {
  const [a, b] = [await idbGet().catch(() => null), lsGet()];
  if (!a) return b;
  if (!b) return a;
  return (a.savedAt ?? 0) >= (b.savedAt ?? 0) ? a : b;
}

/** Save state to both stores. Safe to call after every move. */
export function save(data) {
  data.savedAt = Date.now();
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(LS_KEY, json);
  } catch {
    // Quota or private mode: IndexedDB still has a copy.
  }
  idbPut(JSON.parse(json)).catch(() => {});
}

/** Ask the browser to exempt our storage from eviction. Returns true if granted. */
export async function requestPersist() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

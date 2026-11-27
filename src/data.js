// ---------------------------------------------------------------------------
// data.js — game content read from plain JSON files in data/ (see CLAUDE.md: content is
// data, not code, so a later engine port can read the same files).
//
//   data/palette.json   facade, shutter and door colours
//   data/facades.json   window, shutter, balcony, ground-floor and trim variants
//   data/houses.json    floor uses and the condition spread of houses
//
// Loaded once at start-up (top-level await), in the browser with fetch and in Node (unit
// tests) from disk.
// ---------------------------------------------------------------------------
async function load(name) {
  const url = new URL(`../data/${name}.json`, import.meta.url);
  if (typeof window === 'undefined') {
    const fs = await import('node:fs');
    return JSON.parse(fs.readFileSync(url, 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('missing data file ' + name);
  return res.json();
}

export const PALETTE = await load('palette');
export const FACADES = await load('facades');
export const HOUSES = await load('houses');

/** [value, weight] pairs from a list of { …, weight } objects (for rng.weighted). */
export const weighted = (list, key = 'name') => list.map((o) => [o[key] ?? o, o.weight ?? 1]);

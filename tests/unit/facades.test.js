// Phase C: the look of the town. Colours, doors, shutters, roofs and proportions of the demo town.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.js';
import { FACADE_COLOURS, CONFIG } from '../../src/config.js';

const game = makeGame();
game.demo();
const t0 = performance.now();
game.growth.grow(600);
const growMs = performance.now() - t0;
const G = game.growth, houses = G.live.map((id) => G.buildings[id]);

test('the demo town grows in reasonable time', () => {
  assert.ok(houses.length > 150, houses.length + ' houses');
  assert.ok(growMs < 60000, `600 growth steps took ${(growMs / 1000).toFixed(1)} s`);
});

test('houses that touch never share a facade colour', () => {
  let pairs = 0, same = 0, sameFamily = 0;
  for (const b of houses) for (const id of G.neighboursOf(b)) {
    const o = G.buildings[id];
    if (!o || o.id <= b.id) continue;
    pairs++;
    if (o.colourKey === b.colourKey) same++;
    if (FACADE_COLOURS[o.colourKey][2] === FACADE_COLOURS[b.colourKey][2]) sameFamily++;
  }
  assert.ok(pairs > 100, pairs + ' touching pairs');
  assert.equal(same, 0, same + ' touching pairs share a colour');
  assert.ok(sameFamily / pairs < 0.12, `${sameFamily}/${pairs} touching pairs share a colour family`);
});

test('the palette is varied and not mostly yellow', () => {
  const fam = {};
  for (const b of houses) fam[FACADE_COLOURS[b.colourKey][2]] = (fam[FACADE_COLOURS[b.colourKey][2]] || 0) + 1;
  assert.ok(Object.keys(fam).length >= 5, JSON.stringify(fam));
  assert.ok((fam.yellow || 0) / houses.length < 0.42, 'yellow family share ' + ((fam.yellow || 0) / houses.length).toFixed(2));
});

test('every house has a door; houses between two lanes have a second one', () => {
  const none = houses.filter((b) => !b.arch && b.kind !== 2 && !(b.doors > 0) && b.vaultEdge === -1);
  assert.ok(none.length / houses.length < 0.08, none.length + ' houses without a door');
  const two = houses.filter((b) => b.doors >= 2).length;
  assert.ok(two >= 8, two + ' houses with a back or side door onto another lane');
});

test('shutters come in all four states, mostly shut', () => {
  const sum = {};
  for (const b of houses) for (const [k, v] of Object.entries(b.shutterStates || {})) sum[k] = (sum[k] || 0) + v;
  for (const k of ['shutterClosed', 'shutterTilt', 'shutterOpen', 'shutterHalf']) assert.ok(sum[k] > 20, k + ': ' + sum[k]);
  const total = Object.values(sum).reduce((a, b) => a + b, 0);
  assert.ok(sum.shutterClosed / total > 0.3 && sum.shutterOpen / total > 0.15, JSON.stringify(sum));
});

test('roofs are mostly grey slate, with some terracotta and some terraces', () => {
  let slate = 0, terra = 0, flat = 0;
  for (const b of houses) { if (b.roof === 'flat') flat++; else if (b.roofKind === 'terracotta') terra++; else slate++; }
  assert.ok(slate > terra * 2.5, `slate ${slate}, terracotta ${terra}`);
  assert.ok(terra >= 5 && flat >= 5, `terracotta ${terra}, terraces ${flat}`);
});

test('tower houses: narrow fronts, and the harbour front stands tallest', () => {
  const FH = CONFIG.building.floorHeight;
  const ratio = (b) => {
    const w = Math.hypot(b.corners[1][0] - b.corners[0][0], b.corners[1][1] - b.corners[0][1]);
    return (b.floors * FH + b.gMax - b.gMin) / w;
  };
  const front = houses.filter((b) => b.effort < 40 && !b.arch), back = houses.filter((b) => b.effort > 110 && !b.arch);
  const mean = (a) => a.reduce((s, b) => s + ratio(b), 0) / a.length;
  assert.ok(front.length > 5 && mean(front) > 2.2, `harbour-front height:width ${mean(front).toFixed(2)}`);
  assert.ok(mean(front) > mean(back), 'the town steps down away from the harbour');
  const widths = houses.map((b) => Math.hypot(b.corners[1][0] - b.corners[0][0], b.corners[1][1] - b.corners[0][1])).sort((a, b) => a - b);
  assert.ok(widths[widths.length >> 1] < 6, 'median front width ' + widths[widths.length >> 1].toFixed(1));
  const floors = new Set(houses.map((b) => b.floors));
  assert.ok(floors.size >= 5, 'storey counts vary: ' + [...floors].sort().join(','));
});

test('no ordinary house stands on a lane', () => {
  for (const b of houses) if (!b.arch) assert.ok(G.lanes.clearOf(b.corners), 'house ' + b.id + ' overlaps a lane');
});

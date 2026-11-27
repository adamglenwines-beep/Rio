import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.js';
import { CONFIG } from '../../src/config.js';
import { makeRng } from '../../src/noise.js';
import { polySegDist, convexOverlap } from '../../src/geom.js';

const game = makeGame();
game.demo();
game.growth.rng = makeRng(4242);
game.growth.grow(400);
const G = game.growth;
const houses = G.live.map((id) => G.buildings[id]);

test('demo growth builds houses', () => {
  assert.ok(houses.length > 100, `only ${houses.length} buildings`);
});

test('no ordinary house comes closer than path.width/2 to a connected lane centreline', () => {
  const min = CONFIG.path.width / 2;
  const bad = [];
  for (const b of houses) {
    if (b.arch) continue;
    for (const lane of G.lanes.lanes) {
      if (!lane.connected) continue;
      for (let i = 0; i + 1 < lane.pts.length; i++) {
        const d = polySegDist(b.corners, lane.pts[i], lane.pts[i + 1]);
        if (d < min - 1e-6) { bad.push(`${lane.name} d=${d.toFixed(2)} at ${b.corners[0].map((v) => v.toFixed(1))}`); break; }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} violations`);
});

test('no two houses overlap by more than 0.15 m', () => {
  const bad = [];
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) {
    const d = convexOverlap(houses[i].corners, houses[j].corners);
    if (d > 0.15) bad.push(`${i}/${j} ${d.toFixed(2)}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} overlaps`);
});

test('every flatiron building fronts two lanes', () => {
  const fl = houses.filter((b) => b.flatiron);
  if (fl.length === 0) return; // none grown with this seed; nothing to check
  for (const b of fl) assert.ok(b.frontage && b.frontage2, 'flatiron missing frontage/frontage2');
});

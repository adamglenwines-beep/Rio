// v0.14 Footprints: blocks and lots (src/blocks.js). Houses fill the land between the lanes:
// none on a path, no slivers left beside a lane, dense near the harbour, every house reachable
// from a lane, and no facade detail on a shared (party) wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.js';
import { CONFIG } from '../../src/config.js';
import { BLOCKS } from '../../src/data.js';
import { blockCoverage } from '../../src/blocks.js';
import { laneRadius } from '../../src/lanes.js';
import { edgeNormal, dist } from '../../src/geom.js';

const game = makeGame();
game.demo();
game.growth.grow(700);
const G = game.growth, houses = G.live.map((id) => G.buildings[id]);
G.renderer.rebuild(houses);
const grid = G.plan.grid;
const cov = blockCoverage(grid, houses.map((b) => b.corners));

test('the town is built from the block plan', () => {
  assert.ok(CONFIG.sim.plannedLots, 'plannedLots is off');
  assert.ok(houses.length > 140, `only ${houses.length} houses`);
  assert.ok(houses.every((b) => b.lot), 'a house was not built on a planned lot');
});

test('no building overlaps a path, the quay, the piazza or the slipway', () => {
  const bad = houses.filter((b) => !b.arch && !G.lanes.clearOf(b.corners));
  assert.equal(bad.length, 0, `${bad.length} houses on a path, e.g. at ${bad[0]?.corners[0].map((v) => v.toFixed(1))}`);
});

/** Uncovered pieces of blocks that touch a lane: { area, thin, band, block, at }. */
function laneGaps() {
  const cc = cov[0].coveredCells, seen = new Uint8Array(grid.N * grid.N), out = [];
  for (const blk of grid.blocks) for (const c0 of blk.cells) {
    if (cc[c0] || seen[c0]) continue;
    const comp = [], st = [c0]; seen[c0] = 1;
    while (st.length) {
      const k = st.pop(); comp.push(k);
      const i = k % grid.N, j = (k / grid.N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = (j + dj) * grid.N + i + di;
        if (grid.id[nk] === blk.id && !cc[nk] && !seen[nk]) { seen[nk] = 1; st.push(nk); }
      }
    }
    const pts = comp.map((k) => [grid.xOf(k % grid.N), grid.xOf((k / grid.N) | 0)]);
    if (!pts.some((p) => G.lanes.distToLane(p, 4) < laneRadius() + 1.3)) continue;
    let span = 0;
    for (const a of pts) for (const b of pts) span = Math.max(span, dist(a, b));
    const area = comp.length * grid.C * grid.C;
    // a sliver or a wedge: long and thin (mean width = area / length under 2.5 m)
    out.push({ area, thin: area / (span + 1) < 2.5, band: blk.band.name, block: blk.id, at: pts[0].map((v) => v.toFixed(0)).join(',') });
  }
  return out;
}

test('no sliver or wedge gaps beside a lane in the harbour and town blocks', () => {
  const gaps = laneGaps().filter((g) => g.band !== 'edge');
  const slivers = gaps.filter((g) => g.thin && g.area > BLOCKS.test.maxSliver);
  assert.equal(slivers.length, 0, 'slivers: ' + slivers.map((g) => `${g.area} m² at ${g.at}`).join('; '));
  // anything larger and roundish is a small courtyard or yard: at most one per block
  const yards = gaps.filter((g) => !g.thin && g.area > BLOCKS.test.maxSliver);
  const per = new Map();
  for (const g of yards) per.set(g.block, (per.get(g.block) || 0) + 1);
  assert.ok([...per.values()].every((n) => n <= 1), 'more than one yard in a block');
  assert.ok(yards.every((g) => g.area <= BLOCKS.test.maxYard), 'a yard beside a lane is too big: ' + yards.map((g) => `${g.area} m² at ${g.at}`).join('; '));
});

test('blocks near the harbour meet their coverage target', () => {
  for (const band of ['harbour', 'town']) {
    const target = BLOCKS.bands.find((b) => b.name === band).coverage;
    const list = cov.filter((c) => c.band === band && c.area >= BLOCKS.test.minBlockArea);
    assert.ok(list.length, 'no ' + band + ' blocks');
    let a = 0, c = 0;
    for (const x of list) { a += x.area; c += x.covered * x.area; }
    assert.ok(c / a >= target, `${band} blocks ${(100 * c / a).toFixed(0)}% covered, target ${target * 100}%`);
    // no single big harbour block far below its target
    for (const x of list) assert.ok(x.covered >= target - BLOCKS.test.blockSlack, `${band} block ${x.block} only ${(x.covered * 100).toFixed(0)}% covered`);
  }
});

test('every house can be reached from a lane', () => {
  const R = laneRadius();
  for (const b of houses) {
    if (b.lot.kind === 'rear') {
      const f = G.buildings[b.via];
      assert.ok(f && f.passage && f.frontage, `rear house ${b.id} has no passage through a front house`);
      continue;
    }
    // the front wall stands on its lane's frontage line
    const m = [(b.corners[0][0] + b.corners[1][0]) / 2, (b.corners[0][1] + b.corners[1][1]) / 2];
    const lane = G.lanes.byName.get(b.frontage.name);
    assert.ok(lane && lane.connected, `house ${b.id} fronts no connected lane`);
    const d = G.lanes.distToLane(m, 10);
    assert.ok(d < R + 0.6 || b.frontage.name === 'quay', `house ${b.id}'s front is ${d.toFixed(2)} m from a lane`);
  }
});

test('shared (party) walls have no openings or wall-mounted parts', () => {
  let party = 0;
  for (const b of houses) {
    if (!b.partyTops) continue;
    b.partyTops.forEach((top, i) => {
      if (!(top > -Infinity)) return;
      party++;
      const on = (b.openings || []).filter((o) => o.wall === i && o.y0 < top - 0.1);
      assert.equal(on.length, 0, `house ${b.id} wall ${i}: ${on.map((o) => o.kind).join(', ')} below the neighbour's top`);
    });
  }
  assert.ok(party > 100, `only ${party} party walls`);
});

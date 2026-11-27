import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.js';
import { computeAccess } from '../../src/access.js';

function setup() {
  const g = makeGame(), t = g.terrain, h = t.harbour;
  const P = (dz, dx = 0) => { const z = h.z + dz; return { x: t.ravineX(z) + dx, z }; };
  return { g, t, h, P };
}

test('harbour nodes have effort 0; connected path reachable; isolated path Infinity', () => {
  const { g, h, P } = setup();
  const quay = g.paths.addPath([{ x: h.x, z: h.z }, P(-14), P(-30)]);
  const iso = g.paths.addPath([P(-60, 40), P(-70, 44)]);
  const acc = computeAccess(g.terrain, g.paths);
  const harbourIds = g.paths.nodes.map((n, i) => n.harbour ? i : -1).filter((i) => i >= 0);
  assert.ok(harbourIds.length > 0);
  for (const i of harbourIds) assert.equal(acc.nodeEffort[i], 0);
  for (const id of quay.nodeIds) assert.ok(Number.isFinite(acc.nodeEffort[id]), 'joined path should be reachable');
  assert.ok(acc.nodeEffort[quay.nodeIds[quay.nodeIds.length - 1]] > 0);
  for (const id of iso.nodeIds) assert.equal(acc.nodeEffort[id], Infinity);
});

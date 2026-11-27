import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { Terrain } from '../../src/terrain.js';
import { PathNetwork } from '../../src/paths.js';
import { CONFIG } from '../../src/config.js';

const t = new Terrain(7), net = new PathNetwork(t), h = t.harbour;
const P = (dz, dx = 0) => { const z = h.z + dz; return { x: t.ravineX(z) + dx, z }; };

function worstGrade(pts) {
  let worst = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i], B = pts[i + 1], len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    const k = Math.max(2, Math.ceil(len / 2));
    let prev = t.surfaceAt(A.x, A.z);
    for (let s = 1; s <= k; s++) {
      const x = A.x + (B.x - A.x) * s / k, z = A.z + (B.z - A.z) * s / k, hh = t.surfaceAt(x, z);
      worst = Math.max(worst, Math.abs(hh - prev) / (len / k));
      prev = hh;
    }
  }
  return worst;
}

test('route never produces a leg steeper than maxGrade * 1.2', () => {
  const pairs = [
    [P(-10, 0), P(-60, 0)], [P(-8, 16), P(-4, 34)], [P(-10, -30), P(-50, -10)],
    [P(-40, 0), P(-34, 36)], [P(-20, 40), P(-70, 16)], [P(-4, -34), P(-66, -34)],
  ];
  const limit = CONFIG.path.maxGrade * 1.2;
  for (const [a, b] of pairs) {
    const poly = net.route(a, b);
    assert.ok(poly.length >= 2);
    const g = worstGrade(poly);
    assert.ok(g <= limit, `grade ${g.toFixed(3)} > ${limit.toFixed(3)} for ${JSON.stringify(a)} -> ${JSON.stringify(b)} (${poly.length} pts)`);
  }
});

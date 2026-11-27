// v0.12: nothing on a wall may sit where a neighbour covers that wall, houses never push into
// each other, and every wall-mounted part stands clear of its wall. (The flicker bugs of v0.10–0.11.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.js';
import { CONFIG } from '../../src/config.js';
import { FACADES } from '../../src/data.js';
import { convexOverlap, edgeNormal } from '../../src/geom.js';

const game = makeGame();
game.demo();
game.growth.grow(600);
const G = game.growth, R = G.renderer, houses = G.live.map((id) => G.buildings[id]);
R.rebuild(houses);

/** Is point (x, z) inside convex polygon `poly` (either winding)? */
function inside(poly, x, z) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

test('houses touch but never push into each other', () => {
  let worst = 0, pair = '';
  for (const a of houses) for (const b of houses) {
    if (b.id <= a.id || Math.abs(a.x - b.x) > 16 || Math.abs(a.z - b.z) > 16) continue;
    const o = convexOverlap(a.corners, b.corners);
    if (o > worst) { worst = o; pair = a.id + '/' + b.id; }
  }
  assert.ok(worst <= CONFIG.building.maxOverlap + 1e-9, `houses ${pair} overlap by ${(worst * 100).toFixed(1)} cm`);
});

test('no opening sits on a wall area covered by a neighbour', () => {
  // An independent check (point sampling, not the renderer's own polygon test): for every
  // door, window and wall-mounted part, sample points just in front of the wall across its
  // width; none may lie inside another house's footprint at a height that house reaches.
  let checked = 0;
  const bad = [];
  for (const b of houses) {
    assert.ok(Array.isArray(b.openings), 'house ' + b.id + ' records its openings');
    for (const op of b.openings) {
      checked++;
      const q = b.corners, A = q[op.wall], B = q[(op.wall + 1) % 4];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]), e = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = edgeNormal(q, op.wall);
      for (let k = 0; k <= 6 && !bad.includes(op); k++) {
        const u = op.u0 + (op.u1 - op.u0) * k / 6;
        for (const out of [0.05, 0.3, 0.6]) {
          const x = A[0] + e[0] * u + n[0] * out, z = A[1] + e[1] * u + n[1] * out;
          for (const o of houses) {
            if (o === b || Math.abs(o.x - x) > 12 || Math.abs(o.z - z) > 12) continue;
            if (o.top > op.y0 && o.gMin - 1.2 < op.y1 && inside(o.corners, x, z)) { bad.push(op); op.by = o.id; op.house = b.id; break; }
          }
          if (bad.includes(op)) break;
        }
      }
    }
  }
  assert.ok(checked > 1500, checked + ' openings checked');
  assert.equal(bad.length, 0, bad.slice(0, 5).map((o) => `${o.kind} on house ${o.house} covered by ${o.by}`).join('; '));
});

test('openings are recessed; wall-mounted parts stand clear of the wall', () => {
  const gap = CONFIG.building.facadeGap;
  assert.ok(gap >= 0.03, 'facade gap ' + gap);
  const front = (geo, pick = () => true) => {
    let z = -Infinity; const P = geo.attributes.position, N = geo.attributes.normal;
    for (let i = 0; i < P.count; i++) if (N.getZ(i) > 0.99 && pick(P.getX(i), P.getY(i))) z = Math.max(z, P.getZ(i));
    return z;
  };
  // the frame and glass sit well back in the opening (recessed: they catch the wall's shadow)
  const T = FACADES.windows.types.standard;
  const frameFront = front(R.parts.frame_standard.geo, (x, y) => Math.abs(x) < T.w / 2 && Math.abs(y) < T.h / 2 - 0.01);
  assert.ok(frameFront <= -0.08, 'frame front ' + frameFront.toFixed(3));
  // every part's faces parallel to the wall are buried (< -1.5 cm) or stand clear (>= the gap). Shutter leaves are
  // placed at their hinge, which stands gap + thickness out, so they are checked at placement, not here.
  for (const [k, p] of Object.entries(R.parts)) {
    if (['bar', 'pot', 'blob', 'cloth', 'cone', 'chimney', 'awning', 'awningStripe', 'storeRoom', 'flowerbox', 'balcony', 'balconySolid', 'leafL', 'leafR'].includes(k)) continue;
    const P = p.geo.attributes.position, N = p.geo.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      if (N.getZ(i) < 0.99) continue;
      const z = P.getZ(i);
      assert.ok(z < -0.015 || z >= gap - 1e-6, `${k}: a face ${(z * 100).toFixed(1)} cm from the wall`);
    }
  }
  // the painted far opening stands in front of the painted surround
  assert.ok(front(R.parts.paint_closed.geo) - front(R.parts.sur_standard.geo) >= 0.015);
});

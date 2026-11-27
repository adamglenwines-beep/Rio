// Terraces: contour walls are chained and smoothed, and the ground is cut into level treads.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { Terrain } from '../../src/terrain.js';
import { Terraces, chainSegments, smoothLine, resample } from '../../src/terraces.js';
import { CONFIG } from '../../src/config.js';

test('chainSegments joins loose segments into one polyline', () => {
  const P = (x, key) => ({ x, z: 0, key });
  // four segments of a line, given out of order and in mixed directions
  const segs = [[P(2, 2), P(3, 3)], [P(1, 1), P(0, 0)], [P(1, 1), P(2, 2)], [P(4, 4), P(3, 3)]];
  const lines = chainSegments(segs);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 5);
  const xs = lines[0].map((p) => p.x);
  assert.ok(xs.join() === '0,1,2,3,4' || xs.join() === '4,3,2,1,0', xs.join());
});

test('chainSegments keeps separate lines apart', () => {
  const P = (x, key) => ({ x, z: 0, key });
  const lines = chainSegments([[P(0, 0), P(1, 1)], [P(5, 5), P(6, 6)]]);
  assert.equal(lines.length, 2);
});

test('smoothLine removes a zig-zag but keeps the ends', () => {
  const zig = Array.from({ length: 21 }, (_, i) => ({ x: i, z: i % 2 ? 0.5 : -0.5 }));
  const s = smoothLine(zig, 3);
  assert.deepEqual([s[0].x, s[0].z], [0, -0.5]);
  const rough = (L) => L.slice(1, -1).reduce((a, p, i) => a + Math.abs(p.z - (L[i].z + L[i + 2].z) / 2), 0);
  assert.ok(rough(s) < rough(zig) * 0.1, 'much smoother');
});

test('resample gives evenly spaced points', () => {
  const r = resample([{ x: 0, z: 0 }, { x: 10, z: 0 }], 2);
  assert.equal(r.length, 6);
  for (let i = 1; i < r.length; i++) assert.ok(Math.abs(r[i].x - r[i - 1].x - 2) < 1e-9);
});

const t = new Terrain(7);
const T = new Terraces(t);

test('a terrace area cuts level treads into a slope and builds walls', () => {
  // find a moderately steep spot well above the shore
  let spot = null;
  for (let x = 40; x < 90 && !spot; x += 3) for (let z = -90; z < -20 && !spot; z += 3) {
    const s = t.slopeAt(x, z, 6);
    if (s > 22 && s < 32 && t.heightAt(x, z) > 15) spot = { x, z };
  }
  assert.ok(spot, 'found a slope to terrace');
  const before = t.slopeAt(spot.x, spot.z, 0.8);
  T.addArea({ ...spot, r: 20, crop: 'vine' });
  T.rebuild(null);
  assert.ok(T.walls.length > 2, 'walls were traced: ' + T.walls.length);
  // treads: most of the area is now much flatter than the natural slope
  let flat = 0, n = 0;
  for (let dx = -8; dx <= 8; dx += 1.5) for (let dz = -8; dz <= 8; dz += 1.5) {
    if (T.maskAt(spot.x + dx, spot.z + dz) < 0.9) continue;
    n++;
    if (t.slopeAt(spot.x + dx, spot.z + dz, 0.4) < before * 0.5) flat++;
  }
  assert.ok(n > 20 && flat / n > 0.5, `treads are level: ${flat}/${n} samples`);
  // walls are about one step high and follow the contour
  const hs = T.walls.flatMap((W) => W.pts.map((p) => p.yTop - p.yBot));
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  assert.ok(mean > CONFIG.terraces.step * 0.5 && mean < CONFIG.terraces.step * 1.6, 'mean wall height ' + mean.toFixed(2));
  assert.ok(T.wallMesh && T.wallMesh.geometry.attributes.position.count > 100);
  assert.equal(T.areaAt(spot.x, spot.z).crop, 'vine');
});

test('clearing the areas puts the natural ground back', () => {
  T.clear();
  T.rebuild(null);
  assert.equal(T.walls.length, 0);
  for (let i = 0; i < t.hf.length; i += 97) assert.equal(t.hf[i], t.hBase[i]);
});

test('the fine ground and the 2 m cells agree at cell corners', () => {
  for (let j = 0; j < t.V; j += 7) for (let i = 0; i < t.V; i += 5) {
    const x = i * t.cell - t.half, z = j * t.cell - t.half;
    assert.ok(Math.abs(t.h[j * t.V + i] - t.baseHeightAt(Math.min(x, t.half - 1e-3), Math.min(z, t.half - 1e-3))) < 0.02);
  }
});

test('rock ledges leave buildable ground untouched', () => {
  let checked = 0;
  for (let idx = 0; idx < t.N * t.N; idx += 13) {
    if (t.slopeDeg[idx] > 36) continue;
    const [x, z] = t.cellCentre(idx);
    const k = Math.round((z + t.half) / t.fcell) * t.FV + Math.round((x + t.half) / t.fcell);
    if (t.rockMask[k] === 0) { assert.ok(Math.abs(t.hBase[k] - t.heightFn(x, z)) < 1e-4); checked++; }
  }
  assert.ok(checked > 200);
});

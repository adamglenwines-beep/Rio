// Fish stay in swimmable water, keep moving, and dart from the rowing boat.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { Terrain } from '../../src/terrain.js';
import { FishSchool } from '../../src/fish.js';
import { rowingRoute } from '../../src/water.js';
import { CONFIG } from '../../src/config.js';

const t = new Terrain(7);
const depthAt = (x, z) => -t.heightAt(x, z);
const school = new FishSchool(depthAt, { x: t.harbour.x, z: t.harbour.z + 14 });

test('the harbour has swimmable water and the shoals start in it', () => {
  assert.ok(school.cells.length > 100, school.cells.length + ' swimmable cells');
  assert.equal(school.count, CONFIG.fish.shoals * CONFIG.fish.perShoal.high);
  for (let i = 0; i < school.count; i++) assert.ok(school.py[i] < 0, 'fish start under water');
});

test('after two minutes every fish is still in water deep enough, and under the surface', () => {
  let moved = 0;
  const x0 = Float32Array.from(school.px), z0 = Float32Array.from(school.pz);
  for (let k = 0; k < 120 * 30; k++) school.step(1 / 30, k / 30);
  for (let i = 0; i < school.count; i++) {
    assert.ok(school.swimmable(school.px[i], school.pz[i]), `fish ${i} left the water`);
    const depth = depthAt(school.px[i], school.pz[i]);
    assert.ok(depth > 0.5, `fish ${i} is over ${depth.toFixed(2)} m of water`);
    assert.ok(school.py[i] < -0.2 && school.py[i] > -depth - 0.2, `fish ${i} at y=${school.py[i].toFixed(2)}, depth ${depth.toFixed(2)}`);
    if (Math.hypot(school.px[i] - x0[i], school.pz[i] - z0[i]) > 2) moved++;
  }
  assert.ok(moved > school.count * 0.5, 'shoals wander: ' + moved + ' fish moved more than 2 m');
});

test('fish dart away from something close', () => {
  let mx = 0, mz = 0;
  for (let i = 0; i < school.perShoal; i++) { mx += school.px[i] / school.perShoal; mz += school.pz[i] / school.perShoal; }
  for (let k = 0; k < 20; k++) school.step(1 / 30, 200 + k / 30, { x: mx, z: mz, r: 6 });
  let scared = 0;
  for (let i = 0; i < school.perShoal; i++) if (school.panic[i] > 0.1) scared++;
  assert.ok(scared > school.perShoal * 0.5, scared + ' fish panicked');
});

test('fewer fish on lower quality', () => {
  const s2 = new FishSchool(depthAt, { x: t.harbour.x, z: t.harbour.z + 14 });
  s2.setCount(CONFIG.fish.perShoal.low);
  assert.ok(s2.count < school.count && s2.count > 0);
});

test('the rowing boat keeps to the water', () => {
  const route = rowingRoute(t);
  for (let u = 0; u < 1; u += 0.01) {
    const p = route.getPointAt(u);
    assert.ok(t.heightAt(p.x, p.z) < -0.4, `route point at u=${u.toFixed(2)} is over ground at ${t.heightAt(p.x, p.z).toFixed(2)} m`);
  }
});

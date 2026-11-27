import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { Terrain, BAND } from '../../src/terrain.js';
import { CONFIG } from '../../src/config.js';
import * as THREE from 'three';

const t = new Terrain(7);

test('heights are finite', () => {
  assert.ok(t.h.every(Number.isFinite));
  for (let i = -100; i <= 100; i += 7) for (let j = -100; j <= 100; j += 9) assert.ok(Number.isFinite(t.heightAt(i, j)));
});

test('all slope bands are present', () => {
  const counts = new Array(5).fill(0);
  for (const b of t.band) counts[b]++;
  for (const [name, k] of Object.entries(BAND)) assert.ok(counts[k] > 0, `band ${name} is empty`);
});

function landSamples(n) {
  const out = [];
  for (let idx = 0; idx < t.N * t.N && out.length < n; idx += 397) {
    if (t.band[idx] === BAND.SEA) continue;
    const [x, z] = t.cellCentre(idx);
    if (t.heightAt(x, z) < 0.3) continue;
    out.push([x + 0.37, z - 0.23]);
  }
  return out;
}

test('raycast agrees with surfaceAt on land', () => {
  const pts = landSamples(25);
  assert.ok(pts.length >= 10);
  for (const [x, z] of pts) {
    const hit = t.raycast(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
    assert.ok(hit, `no hit at ${x},${z}`);
    assert.equal(hit.water, false);
    assert.ok(Math.abs(hit.point.y - t.surfaceAt(x, z)) < 0.05, `at ${x},${z}: ray ${hit.point.y} vs ${t.surfaceAt(x, z)}`);
  }
});

test('raycast reports water over the sea', () => {
  let found = null;
  for (let idx = 0; idx < t.N * t.N; idx++) if (t.band[idx] === BAND.SEA && t.heightAt(...t.cellCentre(idx)) < -3) { found = t.cellCentre(idx); break; }
  assert.ok(found, 'no deep sea cell');
  const hit = t.raycast(new THREE.Vector3(found[0], 100, found[1]), new THREE.Vector3(0, -1, 0));
  assert.ok(hit && hit.water === true);
  assert.ok(Math.abs(hit.point.y) < 1e-6);
});

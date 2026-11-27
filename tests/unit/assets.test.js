import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const dir = path.join(ROOT, 'assets/textures/web');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const sets = JSON.parse(fs.readFileSync(path.join(dir, 'sets.json'), 'utf8'));

test('every manifest layer has albedo and data files for every size', () => {
  assert.ok(manifest.sizes.length > 0);
  for (const L of manifest.layers) for (const s of manifest.sizes) {
    const f = L.files[String(s)];
    assert.ok(f, `${L.key}: no entry for size ${s}`);
    for (const k of ['albedo', 'data']) {
      const p = path.join(dir, f[k]);
      assert.ok(fs.existsSync(p) && fs.statSync(p).size > 0, `missing/empty ${p}`);
    }
  }
});

test('manifest layer keys match sets.json in order; layer count <= 32', () => {
  assert.deepEqual(manifest.layers.map((l) => l.key), sets.layers.map((l) => l.key));
  assert.ok(manifest.layers.length <= 32);
  assert.deepEqual(manifest.sizes, sets.sizes);
});

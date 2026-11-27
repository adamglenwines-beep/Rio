import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, makeNoise2D } from '../../src/noise.js';

test('makeRng is deterministic per seed and in [0,1)', () => {
  const a = makeRng(123), b = makeRng(123), c = makeRng(124);
  const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('rng helpers', () => {
  const r = makeRng(5);
  for (let i = 0; i < 100; i++) {
    const v = r.range(2, 3); assert.ok(v >= 2 && v < 3);
    const n = r.int(1, 4); assert.ok(Number.isInteger(n) && n >= 1 && n <= 4);
  }
  assert.equal(r.weighted([['x', 1]]), 'x');
});

test('makeNoise2D stays in range and is deterministic', () => {
  const n1 = makeNoise2D(7), n2 = makeNoise2D(7);
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37 - 50, y = i * 0.91 + 3;
    const v = n1.noise(x, y), f = n1.fbm(x, y);
    assert.ok(v >= -1 && v <= 1, 'noise ' + v);
    assert.ok(f >= -1 && f <= 1, 'fbm ' + f);
    assert.equal(v, n2.noise(x, y));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isConvex, pointInPoly, offsetPoly, convexOverlap, chamferPoly, signedArea, polySegDist } from '../../src/geom.js';

const sq = (x, z, s = 2) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];

test('isConvex', () => {
  assert.ok(isConvex(sq(0, 0)));
  assert.ok(isConvex(sq(0, 0).reverse()));
  assert.ok(!isConvex([[0, 0], [4, 0], [1, 1], [0, 4]]), 'concave L/arrow shape');
  assert.ok(!isConvex([[0, 0], [2, 2], [2, 0], [0, 2]]), 'bow-tie');
  assert.ok(!isConvex([[0, 0], [1, 0], [2, 0]]), 'degenerate line');
});

test('pointInPoly', () => {
  const p = sq(0, 0, 4);
  assert.ok(pointInPoly([2, 2], p));
  assert.ok(!pointInPoly([5, 2], p));
  assert.ok(!pointInPoly([-0.1, 2], p));
});

test('offsetPoly grows and shrinks a square', () => {
  const g = offsetPoly(sq(0, 0, 4), 1);
  assert.ok(Math.abs(Math.abs(signedArea(g)) - 36) < 1e-6);
  const s = offsetPoly(sq(0, 0, 4), -1);
  assert.ok(Math.abs(Math.abs(signedArea(s)) - 4) < 1e-6);
  // winding independent
  const g2 = offsetPoly(sq(0, 0, 4).reverse(), 1);
  assert.ok(Math.abs(Math.abs(signedArea(g2)) - 36) < 1e-6);
});

test('convexOverlap: separated, touching, overlapping', () => {
  assert.equal(convexOverlap(sq(0, 0), sq(5, 0)), 0);
  assert.equal(convexOverlap(sq(0, 0), sq(2, 0)), 0, 'touching edges');
  const d = convexOverlap(sq(0, 0), sq(1.5, 0));
  assert.ok(Math.abs(d - 0.5) < 1e-9, 'overlap depth ' + d);
  assert.ok(convexOverlap(sq(0, 0), sq(0.5, 0.5)) > 0);
});

test('chamferPoly cuts corners', () => {
  const { poly, normals } = chamferPoly(sq(0, 0, 4), 0.5);
  assert.equal(poly.length, 8);
  assert.equal(normals.length, 8);
  assert.ok(isConvex(poly));
  assert.ok(Math.abs(signedArea(poly)) < 16);
  assert.ok(normals.filter((n) => n === null).length === 4);
  for (const p of poly) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
});

test('polySegDist', () => {
  const p = sq(0, 0, 2);
  assert.equal(polySegDist(p, [1, 1], [10, 10]), 0);
  assert.ok(Math.abs(polySegDist(p, [5, -1], [5, 5]) - 3) < 1e-9);
});

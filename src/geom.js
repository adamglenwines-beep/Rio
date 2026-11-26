// ---------------------------------------------------------------------------
// geom.js — small 2D geometry helpers on the ground plane (x, z).
// Points are [x, z] arrays. Building footprints are convex quadrilaterals
// stored as [frontLeft, frontRight, backRight, backLeft].
// ---------------------------------------------------------------------------

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const crossZ = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Rotate a direction by angle (radians). */
export const rot = (a, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; };

/** Signed area (positive or negative depending on winding). */
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += crossZ(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

/** True if the polygon is convex and not self-intersecting (and not degenerate). */
export function isConvex(poly, minAngleSin = 0.12) {
  const n = poly.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
    const e1 = norm(sub(b, a)), e2 = norm(sub(c, b));
    const cz = crossZ(e1, e2);
    if (Math.abs(cz) < minAngleSin && dot(e1, e2) < 0) return false;   // folds back on itself
    if (Math.abs(cz) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cz);
    else if (Math.sign(cz) !== sign) return false;
  }
  return sign !== 0;
}

export function pointInPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Distance from point p to segment ab. */
export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  let u = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Distance between segments ab and cd (0 if they cross). */
export function segSegDist(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/** Distance from a polygon (area included) to segment ab: 0 if they touch. */
export function polySegDist(poly, a, b) {
  if (pointInPoly(a, poly) || pointInPoly(b, poly)) return 0;
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    m = Math.min(m, segSegDist(poly[i], poly[(i + 1) % poly.length], a, b));
    if (m === 0) return 0;
  }
  return m;
}

/** Signed distance of p from the polygon boundary: positive inside, negative outside. */
export function insideDepth(p, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
  return pointInPoly(p, poly) ? m : -m;
}

/** Grow (or shrink, with negative d) a convex polygon by moving every edge outward by d. */
export function offsetPoly(poly, d) {
  const n = poly.length, ccw = signedArea(poly) > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const e = norm(sub(b, a));
    const out = ccw > 0 ? [e[1], -e[0]] : [-e[1], e[0]];   // outward normal
    lines.push({ p: add(a, mul(out, d)), e });
  }
  const res = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    const den = crossZ(L1.e, L2.e);
    if (Math.abs(den) < 1e-6) { res.push(L2.p); continue; }
    const t = crossZ(sub(L2.p, L1.p), L2.e) / den;
    res.push(add(L1.p, mul(L1.e, t)));
  }
  return res;
}

/** Point inside a quad by bilinear parameters: u along the front, v from front to back. */
export function quadPoint(q, u, v) {
  const f = lerp2(q[0], q[1], u), b = lerp2(q[3], q[2], u);
  return lerp2(f, b, v);
}

export function centroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}

/** Outward unit normal of edge i of a polygon. */
export function edgeNormal(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const e = norm(sub(b, a));
  const ccw = signedArea(poly) > 0;
  return ccw ? [e[1], -e[0]] : [-e[1], e[0]];
}

/**
 * How deeply two convex polygons overlap (separating-axis test): 0 if they are
 * apart or only touch, otherwise the smallest push that would separate them.
 */
export function convexOverlap(P, Q) {
  let depth = Infinity;
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const ax = norm([-e[1], e[0]]);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of P) { const d = dot(p, ax); a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const p of Q) { const d = dot(p, ax); b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      depth = Math.min(depth, o);
    }
  }
  return depth;
}

/**
 * Cut every corner of a convex polygon by up to `c` (at most 30% of each
 * adjacent edge). Returns { poly, normals }: normals[i] is null for an original
 * wall edge, or [nA, nB] (the outward normals of the two walls it joins) for a
 * new corner edge, so a renderer can shade the corner smoothly round.
 */
export function chamferPoly(poly, c) {
  const n = poly.length, out = [], normals = [];
  const ccw = signedArea(poly) > 0;
  const outward = (a, b) => { const e = norm(sub(b, a)); return ccw ? [e[1], -e[0]] : [-e[1], e[0]]; };
  for (let i = 0; i < n; i++) {
    const p = poly[(i - 1 + n) % n], v = poly[i], q = poly[(i + 1) % n];
    const ca = Math.min(c, 0.3 * dist(p, v)), cb = Math.min(c, 0.3 * dist(v, q));
    out.push(add(v, mul(norm(sub(p, v)), ca)), add(v, mul(norm(sub(q, v)), cb)));
    normals.push([outward(p, v), outward(v, q)], null);
  }
  return { poly: out, normals };
}

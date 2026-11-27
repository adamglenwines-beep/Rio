// ---------------------------------------------------------------------------
// blocks.js — blocks and lots: how houses fill the land between paths (v0.14).
//
// Pure game rules (no Three.js, no DOM; see CLAUDE.md), parameters in data/blocks.json,
// so a later engine port can reuse it as it is.
//
//   findBlocks(world)       zoned, buildable land on a grid, minus the lanes and open
//                           spaces, split into connected BLOCKS. Each block gets a value
//                           band (by walking effort to the harbour): harbour, town, edge.
//   planLots(world, grid)   the LOTS that fill the blocks:
//     FRONT lots: every lane's frontage line (main lanes first) is cut into narrow lots.
//       The front runs exactly along the line; the sides follow the lane's normal there,
//       so neighbours share their side walls exactly and rows follow bends as trapezoids.
//       A lot is as deep as the middle of the block (half way to the next lane's frontage),
//       the block's edge, or its band's maximum, whichever comes first.
//     CORNERS: where a row runs into another lane, its end lot's side is snapped onto that
//       lane's frontage line, so the corner house fronts both lanes and no wedge is left.
//     REAR lots: where a deep block's interior is still empty behind a front lot, a rear
//       house shares its back wall, reached through an arched passage in the front house.
//     Steep lots whose ground falls too far are cut into a front and a rear house.
//
// `world` (supplied by growth.js) answers questions about the map:
//   { half, zoned(x,z), buildable(x,z), clearPoint(x,z), clear(poly), existing: [corners],
//     taken: { 'lane:side': [{ s0, s1 }] }, lanes: [{ name, rank, connected,
//     lines: {1, -1} }], at(line, s) → { p, n }, rayToFrontage(p, d, minT, maxT, exclude),
//     nearestFrontage(p, maxD, exclude), effortAt(x,z), steepAt(x,z), heightAt(x,z), rng }
// Lots: { corners: [frontLeft, frontRight, backRight, backLeft], kind: 'front'|'rear',
//   block, frontage?: { name, side, s0, s1, key }, parent? (rear: the front lot's index),
//   corner?: true, effort }
// ---------------------------------------------------------------------------
import { BLOCKS } from './data.js';
import { sub, add, mul, dot, norm, dist, isConvex, signedArea, convexOverlap, centroid } from './geom.js';

/** The value band (data/blocks.json bands) for a walking effort. */
export function bandFor(effort) {
  return BLOCKS.bands.find((b) => effort <= b.maxEffort) || BLOCKS.bands[BLOCKS.bands.length - 1];
}

/** The block grid: which block (or -1) every cell belongs to, and the blocks themselves. */
export function findBlocks(world) {
  const C = BLOCKS.cell, half = world.half, N = Math.round((2 * half) / C);
  const ok = new Uint8Array(N * N), id = new Int32Array(N * N).fill(-1);
  const xOf = (i) => -half + (i + 0.5) * C;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = xOf(i), z = xOf(j);
    if (world.zoned(x, z) && world.buildable(x, z) && world.clearPoint(x, z)) ok[j * N + i] = 1;
  }
  const blocks = [];
  const stack = [];
  for (let k = 0; k < N * N; k++) {
    if (!ok[k] || id[k] >= 0) continue;
    const b = { id: blocks.length, cells: [], effort: 0 };
    id[k] = b.id; stack.push(k);
    while (stack.length) {
      const c = stack.pop(); b.cells.push(c);
      const i = c % N, j = (c / N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const nk = jj * N + ii;
        if (ok[nk] && id[nk] < 0) { id[nk] = b.id; stack.push(nk); }
      }
    }
    let e = 0, en = 0;
    for (const c of b.cells) { const v = world.effortAt(xOf(c % N), xOf((c / N) | 0)); if (isFinite(v)) { e += v; en++; } }
    b.effort = en ? e / en : Infinity;
    b.area = b.cells.length * C * C;
    b.band = bandFor(b.effort);
    blocks.push(b);
  }
  const cellOf = (x, z) => {
    const i = Math.floor((x + half) / C), j = Math.floor((z + half) / C);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  return { N, C, half, id, blocks, xOf, cellOf, blockAt: (x, z) => { const k = cellOf(x, z); return k < 0 ? -1 : id[k]; } };
}

/** Visit the grid cells whose centre lies inside the convex polygon q. */
function forCellsIn(grid, q, fn) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  for (let j = Math.floor((z0 + grid.half) / grid.C); j <= Math.floor((z1 + grid.half) / grid.C); j++)
    for (let i = Math.floor((x0 + grid.half) / grid.C); i <= Math.floor((x1 + grid.half) / grid.C); i++) {
      if (i < 0 || j < 0 || i >= grid.N || j >= grid.N) continue;
      if (insideConvex([grid.xOf(i), grid.xOf(j)], q)) fn(j * grid.N + i);
    }
}

function insideConvex(p, q) {
  let sgn = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (!sgn) sgn = Math.sign(c); else if (Math.sign(c) !== sgn) return false;
  }
  return true;
}

/** Where p lies relative to a frontage line: s along it and d (distance in front, along its normal). */
function project(line, p) {
  const { O, S } = line;
  let best = { s: 0, d: Infinity, dd: Infinity };
  for (let i = 0; i + 1 < O.length; i++) {
    const a = O[i], b = O[i + 1], e = sub(b, a), L2 = e[0] * e[0] + e[1] * e[1] || 1;
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / L2));
    const q = [a[0] + e[0] * u, a[1] + e[1] * u], dd = dist(p, q);
    if (dd < best.dd) best = { s: S[i] + u * (S[i + 1] - S[i]), dd, i };
  }
  const e = norm(sub(O[best.i + 1], O[best.i])), n = line.N[best.i];
  best.d = dot(sub(p, O[best.i]), n);
  return best;
}

/** Intersection of lines p + t·d and q + u·e (t, u returned), or null if parallel. */
function cross(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(q, p);
  return { t: (w[0] * e[1] - w[1] * e[0]) / den, u: (w[0] * d[1] - w[1] * d[0]) / den };
}

const fall = (world, q) => {
  let lo = Infinity, hi = -Infinity;
  for (const p of [...q, centroid(q)]) { const h = world.heightAt(p[0], p[1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  return hi - lo;
};

/** The lots that fill the blocks (see the top of this file). */
export function planLots(world, grid) {
  const D = BLOCKS, rng = world.rng, lots = [];
  // houses already standing (when the plan is redone after a path or zone change): lots fit around them
  const existing = (world.existing || []).map((corners) => { const [cx, cz] = centroid(corners); return { corners, cx, cz }; });
  // cells already covered by a lot (or a standing house): later lots stop at them
  // (each cell remembers which run claimed it: a lot's neighbours in its own run don't stop it)
  const claimed = new Int32Array(grid.N * grid.N);
  let runId = 1;
  const claim = (q, who = -1) => forCellsIn(grid, q, (k) => { claimed[k] = who; });
  for (const e of existing) claim(e.corners);
  const blockOk = (p, blk, own = 0) => { const k = grid.cellOf(p[0], p[1]); return k >= 0 && grid.id[k] === blk && (!claimed[k] || claimed[k] === own); };
  // how deep a lot can reach from p along n inside block blk: the block's edge (or a lot already
  // there), the middle of the block (half way to another lane's frontage line), or `max`
  const depthAt = (p, n, blk, max, ownLane, own = 0) => {
    let t = 0.3;
    while (t < max && blockOk(add(p, mul(n, t + 0.25)), blk, own)) t += 0.25;
    let lim = { t: Math.min(t, max), by: t >= max ? 'max' : 'edge' };
    const hl = world.rayToFrontage(p, n, 1, 2 * max + 3, ownLane);
    if (hl && hl.t / 2 < lim.t) lim = { t: hl.t / 2, by: 'mid' };
    return lim;
  };
  // a spatial index of lots (and standing houses) by their bounding boxes, 8 m cells
  const HASH = 8, buckets = new Map();
  const box = (q) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; };
  const keys = (b) => { const out = []; for (let i = Math.floor(b[0] / HASH); i <= Math.floor(b[2] / HASH); i++) for (let j = Math.floor(b[1] / HASH); j <= Math.floor(b[3] / HASH); j++) out.push(i * 4099 + j); return out; };
  const index = (o) => {
    for (const k of o._keys || []) { const a = buckets.get(k); a.splice(a.indexOf(o), 1); }
    o._box = box(o.corners); o._keys = keys(o._box);
    for (const k of o._keys) { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(o); }
  };
  for (const e of existing) index(e);
  /** Does q push into any lot or house other than `skip`? */
  const overlaps = (q, skip = null) => {
    const b = box(q), seen = new Set();
    for (const k of keys(b)) for (const o of buckets.get(k) || []) {
      if (o === skip || seen.has(o)) continue;
      seen.add(o);
      const ob = o._box;
      if (ob[0] > b[2] || ob[2] < b[0] || ob[1] > b[3] || ob[3] < b[1]) continue;
      if (convexOverlap(q, o.corners) > D.maxOverlap) return true;
    }
    return false;
  };
  const clash = (q) => overlaps(q);
  const accept = (lot, who) => { [lot.cx, lot.cz] = centroid(lot.corners); lot.index = lots.length; lots.push(lot); index(lot); claim(lot.corners, who); return lot; };
  const dbg = world.debug || null, why = (k) => { if (dbg) dbg[k] = (dbg[k] || 0) + 1; return false; };
  const good = (q) => (isConvex(q) || why('convex')) && (Math.abs(signedArea(q)) >= D.minLotArea || why('area')) && (world.clear(q) || why('lane')) && (!clash(q) || why('clash'));
  /** Bisection: the x in [bad, ok] closest to `bad` for which test(x) holds (test(ok) is known true). */
  const closest = (test, bad, ok) => { for (let k = 0; k < 7; k++) { const m = (bad + ok) / 2; if (test(m)) ok = m; else bad = m; } return ok; };

  const lanes = world.lanes.filter((l) => l.connected).sort((a, b) => b.rank - a.rank);
  for (const lane of lanes) for (const side of [1, -1]) {
    const line = lane.lines[side], key = lane.name + ':' + side, st = D.sample;
    if (!line || line.total < D.minLotWidth) continue;
    // runs of this frontage line with the same (still free) block right behind it
    const runs = [];
    let cur = null;
    for (let s = 0; s <= line.total + 1e-6; s += st) {
      const { p, n } = world.at(line, Math.min(s, line.total));
      const taken = (world.taken[key] || []).some((iv) => s > iv.s0 - 0.05 && s < iv.s1 + 0.05);
      const q = [p[0] + n[0] * 0.6, p[1] + n[1] * 0.6];
      const blk = taken ? -1 : grid.blockAt(q[0], q[1]);
      const ok = blk >= 0 && blockOk(q, blk);
      if (cur && ok && blk === cur.blk) cur.sb = Math.min(s, line.total);
      else { if (cur) runs.push(cur); cur = ok ? { blk, sa: s, sb: s } : null; }
    }
    if (cur) runs.push(cur);
    for (const run of runs) {
      const len = run.sb - run.sa, who = ++runId;
      if (len < D.minLotWidth) continue;
      const block = grid.blocks[run.blk], band = block.band;
      const mid = world.at(line, (run.sa + run.sb) / 2).p;
      const steep = world.steepAt(mid[0], mid[1]);
      const [wMin, wMax] = steep ? D.steep.lotWidth : band.lotWidth;
      const maxDepth = steep ? Math.min(D.steep.maxDepth, band.maxDepth) : band.maxDepth;
      let n = Math.max(1, Math.round(len / ((wMin + wMax) / 2)));
      while (len / n > wMax * 1.15) n++;
      while (n > 1 && len / n < wMin) n--;
      // widths vary within the band's range, summing to the run exactly
      const ws = []; let sum = 0;
      for (let i = 0; i < n; i++) { const w = (len / n) * (1 + (rng() - 0.5) * 0.36); ws.push(w); sum += w; }
      let s = run.sa;
      for (let i = 0; i < n; i++) {
        let s0 = s, s1 = i === n - 1 ? run.sb : s + ws[i] * (len / sum);
        s = s1;
        const A0 = world.at(line, s0), B0 = world.at(line, s1);
        const inset = Math.min(0.4, (s1 - s0) / 4);
        const iA = world.at(line, s0 + inset), iB = world.at(line, s1 - inset);
        const dA = depthAt(iA.p, iA.n, run.blk, maxDepth, lane.name, who), dB = depthAt(iB.p, iB.n, run.blk, maxDepth, lane.name, who);
        let depth = Math.min(dA.t, dB.t), by = dA.t <= dB.t ? dA.by : dB.by;
        if (Math.max(dA.t, dB.t) - depth > 1.5 && by !== 'max') depth = (dA.t + dB.t) / 2;   // the back may be skewed a little
        let qA = Math.min(dA.t, depth + 1.5), qB = Math.min(dB.t, depth + 1.5);
        const lotQ = (a0, a1, da, db) => { const A = world.at(line, a0), Bp = world.at(line, a1); return [A.p, Bp.p, add(Bp.p, mul(Bp.n, db)), add(A.p, mul(A.n, da))]; };
        // the ends of a run meet the lot beside them exactly: move the end until the two touch
        if (i === 0) {
          const ok = (x) => good(lotQ(x, s1, qA, qB));
          if (!ok(s0)) { let f = null; for (let d = 0.25; d <= 2 && s0 + d < s1 - D.minLotWidth; d += 0.25) if (ok(s0 + d)) { f = s0 + d; break; } if (f !== null) s0 = closest(ok, f - 0.25, f); }
          else if (s0 > 0.2 && !ok(Math.max(0, s0 - 1.5))) s0 = closest(ok, Math.max(0, s0 - 1.5), s0);
        }
        if (i === n - 1) {
          const ok = (x) => good(lotQ(s0, x, qA, qB));
          if (!ok(s1)) { let f = null; for (let d = 0.25; d <= 2 && s1 - d > s0 + D.minLotWidth; d += 0.25) if (ok(s1 - d)) { f = s1 - d; break; } if (f !== null) s1 = closest(ok, f + 0.25, f); }
          else if (s1 < line.total - 0.2 && !ok(Math.min(line.total, s1 + 1.5))) s1 = closest(ok, Math.min(line.total, s1 + 1.5), s1);
        }
        const A = world.at(line, s0), Bp = world.at(line, s1);
        const make = (a, b) => lotQ(s0, s1, a, b);
        let q = make(qA, qB);
        // a corner: the run ends (or starts) at another lane: snap that side onto its frontage line
        let corner = false;
        for (const atEnd of [false, true]) {
          if (atEnd ? i !== n - 1 || run.sb >= line.total - 0.01 : i !== 0 || run.sa <= 0.01) continue;
          const P = atEnd ? Bp : A, beyond = world.at(line, atEnd ? Math.min(line.total, s1 + 0.75) : Math.max(0, s0 - 0.75)).p;
          const nf = world.nearestFrontage(beyond, 3, lane.name);
          if (!nf) continue;
          const along = nf.d;                                      // the other lane's frontage direction
          const fr = norm(sub(Bp.p, A.p));
          const X = cross(atEnd ? A.p : Bp.p, fr, nf.p, along);   // the two frontage lines meet here
          const back = atEnd ? q[2] : q[3], K = cross(back, norm(sub(q[2], q[3])), nf.p, along);
          if (!X || !K) continue;
          const Xp = add(atEnd ? A.p : Bp.p, mul(fr, X.t)), Kp = add(back, mul(norm(sub(q[2], q[3])), K.t));
          const qc = atEnd ? [A.p, Xp, Kp, q[3]] : [Xp, Bp.p, q[2], Kp];
          if (dist(Xp, P.p) < 4 && good(qc)) { q = qc; corner = true; }
        }
        if (!corner && !good(q)) {
          // too deep for the space (a neighbour already there): try shallower
          let ok = false;
          for (const f of [0.8, 0.6, 0.45]) { const q2 = make(qA * f, qB * f); if (Math.min(qA, qB) * f >= D.minDepth && good(q2)) { q = q2; qA *= f; qB *= f; ok = true; by = 'edge'; break; } }
          if (!ok) continue;
        }
        // the back wall meets whatever is behind it (another lot, the block's edge): close the gap
        if (!corner && by === 'edge') {
          const ok = (x) => good(make(qA + x, qB + x));
          if (ok(0.15) && !ok(1.2)) { const x = closest(ok, 1.2, 0.15); qA += x; qB += x; q = make(qA, qB); }
        }
        // on steep ground a deep lot becomes a front house and a rear one
        if (fall(world, q) > D.maxFall && Math.min(qA, qB) > 2 * D.minDepth) {
          const q2 = make(qA / 2, qB / 2);
          if (good(q2)) { q = q2; by = 'max'; }
        }
        accept({ corners: q, kind: 'front', block: run.blk, band: band.name, corner, by,
          frontage: { name: lane.name, side, s0, s1, key }, rear: band.rear || steep,
          effort: world.effortAt(A.p[0], A.p[1]), who }, who);
        s = Math.max(s, s1);
      }
    }
  }
  // REAR lots: behind front lots that stopped at their maximum depth, where the block goes on
  for (const f of lots.slice()) {
    if (f.kind !== 'front' || f.by !== 'max' || !f.rear) continue;
    const [A, Bp, C, Dk] = f.corners, dR = norm(sub(C, Bp)), dL = norm(sub(Dk, A));
    const rC = depthAt(C, dR, f.block, D.rearMax, f.frontage.name, f.who), rD = depthAt(Dk, dL, f.block, D.rearMax, f.frontage.name, f.who);
    let r = Math.min(rC.t, rD.t);
    if (r < D.rearMin) continue;
    for (const k of [1, 0.75, 0.55]) {
      const q = [C, Dk, add(Dk, mul(dL, r * k)), add(C, mul(dR, r * k))];
      if (r * k >= D.rearMin && good(q)) { const w = ++runId; accept({ corners: q, kind: 'rear', block: f.block, band: f.band, parent: f.index, effort: f.effort + 6, who: w }, w); break; }
    }
  }
  // GAP LOTS: a leftover piece of a dense block beside a lane (where lanes meet at a sharp
  // angle, or a run's end was cut short) gets a lot of its own, fronting that lane
  {
    const seen = new Uint8Array(grid.N * grid.N);
    for (const blk of grid.blocks) {
      if (blk.band.name === 'edge') continue;
      for (const c0 of blk.cells) {
        if (claimed[c0] || seen[c0]) continue;
        const comp = [], st = [c0]; seen[c0] = 1;
        while (st.length) {
          const k = st.pop(); comp.push(k);
          const i = k % grid.N, j = (k / grid.N) | 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nk = (j + dj) * grid.N + i + di;
            if (grid.id[nk] === blk.id && !claimed[nk] && !seen[nk]) { seen[nk] = 1; st.push(nk); }
          }
        }
        if (comp.length < D.gapMinArea) continue;
        // the lane it lies along: the frontage line most of its lane-side cells are nearest to
        const votes = new Map();
        for (const k of comp) {
          const p = [grid.xOf(k % grid.N), grid.xOf((k / grid.N) | 0)], nf = world.nearestFrontage(p, D.gapReach, null);
          if (!nf) continue;
          const key = nf.lane.name + ':' + nf.side, v = votes.get(key) || { n: 0, lane: nf.lane, side: nf.side, pts: [] };
          v.n++; v.pts.push(p); votes.set(key, v);
        }
        const v = [...votes.values()].sort((x, y) => y.n - x.n)[0];
        if (dbg) (dbg.gaps ||= []).push({ at: [grid.xOf(c0 % grid.N), grid.xOf((c0 / grid.N) | 0)], n: comp.length, votes: [...votes.values()].map((x) => x.lane.name + ':' + x.side + '=' + x.n).join(' ') });
        if (!v || v.n < 2) continue;
        const line = v.lane.lines[v.side];
        let s0 = Infinity, s1 = -Infinity, dmax = 0;
        for (const k of comp) {
          const p = [grid.xOf(k % grid.N), grid.xOf((k / grid.N) | 0)], pr = project(line, p);
          if (pr.d > D.maxDepth8 || pr.d < -0.5) continue;
          dmax = Math.max(dmax, pr.d + 0.5);
          if (pr.d < D.gapReach + 1) { s0 = Math.min(s0, pr.s - 0.5); s1 = Math.max(s1, pr.s + 0.5); }   // its stretch of lane
        }
        s0 = Math.max(0, s0); s1 = Math.min(line.total, s1);
        if (!(s1 - s0 >= D.gapMinWidth)) continue;
        const who = ++runId;
        const lotQ = (a0, a1, dd) => { const A = world.at(line, a0), Bp = world.at(line, a1); return [A.p, Bp.p, add(Bp.p, mul(Bp.n, dd)), add(A.p, mul(A.n, dd))]; };
        const fitsGap = (q) => isConvex(q) && world.clear(q) && !clash(q);
        // try a narrow seed lot at each point of the stretch, deep first; grow the best one sideways
        let best = null;
        const hw = D.gapMinWidth / 2;
        for (let dep = Math.max(D.minDepth, Math.min(dmax, blk.band.maxDepth)); dep >= D.minDepth - 1e-6 && !best; dep = dep > D.minDepth ? Math.max(D.minDepth, dep * 0.75) : -1) {
          for (let c = s0 + hw; c <= s1 - hw + 1e-6; c += 0.5) {
            if (!fitsGap(lotQ(c - hw, c + hw, dep))) continue;
            const a = fitsGap(lotQ(s0, c + hw, dep)) ? s0 : closest((x) => fitsGap(lotQ(x, c + hw, dep)), s0, c - hw);
            const b = fitsGap(lotQ(a, s1, dep)) ? s1 : closest((x) => fitsGap(lotQ(a, x, dep)), s1, c + hw);
            const area = (b - a) * dep;
            if (!best || area > best.area) best = { a, b, dep, area };
          }
        }
        if (dbg) dbg.gaps[dbg.gaps.length - 1].ok = !!best;
        if (!best || best.area < D.gapMinArea * 0.6) continue;
        const A = world.at(line, best.a);
        accept({ corners: lotQ(best.a, best.b, best.dep), kind: 'front', block: blk.id, band: blk.band.name, corner: false, by: 'edge', gap: true,
          frontage: { name: v.lane.name, side: v.side, s0: best.a, s1: best.b, key: v.lane.name + ':' + v.side }, rear: false,
          effort: world.effortAt(A.p[0], A.p[1]), who }, who);
      }
    }
  }
  // WEDGES: the leftover corners of odd-shaped blocks (where lanes meet at an angle) are taken
  // by the lot beside them: its back corners move out until the lot meets its neighbours
  const inBlock = (q, lot) => {
    let n = 0, bad = 0;
    forCellsIn(grid, q, (k) => { n++; if (grid.id[k] !== lot.block || (claimed[k] && claimed[k] !== lot.who)) bad++; });
    return bad <= Math.max(1, n * 0.04);
  };
  const others = (lot, q) => overlaps(q, lot);
  const fits = (lot, q) => isConvex(q, D.wedgeMinSin) && !others(lot, q) && world.clear(q) && inBlock(q, lot) && fall(world, q) <= D.maxFall + 1;   // cheapest tests first
  const DIRS = [];
  for (let a = 0; a < 16; a++) DIRS.push([Math.cos((a * Math.PI) / 8), Math.sin((a * Math.PI) / 8)]);
  for (let pass = 0; pass < D.wedgePasses; pass++) for (const lot of lots) {
    for (const k of [2, 3]) {
      let best = null, gain = 0.5;
      const a0 = Math.abs(signedArea(lot.corners));
      for (const d of DIRS) {
        const at = (t) => { const q = lot.corners.slice(); q[k] = add(q[k], mul(d, t)); return q; };
        if (!fits(lot, at(0.25))) continue;
        if (fits(lot, at(D.wedgeReach))) continue;           // open land, not a gap: leave it
        const t = closest((x) => fits(lot, at(x)), D.wedgeReach, 0.25);
        // only a gap closed against a neighbour or a lane counts, not one that runs out at the block's edge
        const past = at(t + 0.4);
        if (!(others(lot, past) || !world.clear(past))) continue;
        const q = at(t), g = Math.abs(signedArea(q)) - a0;
        // not deeper than the band allows (measured from the front wall)
        const fr = norm(sub(q[1], q[0])), nrm = [-fr[1], fr[0]], dep = Math.abs(dot(sub(q[k], q[0]), nrm));
        if (dep > (BLOCKS.bands.find((x) => x.name === lot.band)?.maxDepth ?? 10) + 2) continue;
        if (g > gain) { gain = g; best = q; }
      }
      if (best) { lot.corners = best; [lot.cx, lot.cz] = centroid(best); lot.wedge = true; index(lot); claim(best, lot.who); }
    }
  }
  for (const l of lots) { delete l._box; delete l._keys; }
  return lots;
}

/**
 * How much of each block is covered by footprints (cells whose centre lies inside one).
 * Returns [{ block, band, area, covered }] (covered 0..1).
 */
export function blockCoverage(grid, footprints) {
  const covered = new Uint8Array(grid.N * grid.N);
  for (const q of footprints) forCellsIn(grid, q, (k) => { covered[k] = 1; });
  return grid.blocks.map((b) => ({ block: b.id, band: b.band.name, area: b.area, effort: b.effort, covered: b.cells.reduce((n, c) => n + covered[c], 0) / b.cells.length, cells: b.cells, coveredCells: covered }));
}

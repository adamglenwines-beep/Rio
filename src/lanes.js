// ---------------------------------------------------------------------------
// lanes.js — lanes as the skeleton of the town.
//
// For every connected lane (each path, plus the harbour quay) we build two
// FRONTAGE LINES, one either side: the lane centreline offset by
//     R = half the paved width + a small setback.
// A lane-front house takes a stretch [s0, s1] of a frontage line: its front
// wall runs along the line and its side walls run square to the lane at s0
// and s1. The next house along starts at s1 and reuses exactly the same side
// line, so neighbours share walls and follow the lane's curve with no gaps.
//
// Lanes also define CLEARANCE: no ordinary wall may come closer than R to a
// lane centreline (or into the quay, piazza or slipway). This is an exact
// geometric test (polygon vs. capsule), not a grid approximation.
// ---------------------------------------------------------------------------
import { CONFIG } from './config.js';
import { polySegDist, pointSegDist, norm, sub, add, mul, dot, dist, lerp2 } from './geom.js';

const HASH = 6;   // spatial hash cell size (m) for clearance capsules

export const laneRadius = () => CONFIG.path.width / 2 + CONFIG.path.setback;

export class Lanes {
  constructor(game) {
    this.game = game;
    this.lanes = [];
    this.byName = new Map();
    this.capsules = [];
    this.hash = new Map();
  }

  /** Recompute lanes, frontage lines and clearance capsules. */
  rebuild(access) {
    const net = this.game.paths, H = CONFIG.harbour;
    this.lanes = [];
    this.byName.clear();
    this.capsules = [];
    this.hash.clear();
    const R = laneRadius();

    // the quay: houses front the waterfront walkway
    const quayPts = net.quay.points.map((p) => [p.x, p.z]);
    this._addLane(quayPts, H.quayHalfWidth, true, 1e6, 'quay');
    net.paths.forEach((p, i) => {
      const connected = p.nodeIds.some((id) => access && isFinite(access.nodeEffort[id]));
      const pts = p.points.map((q) => [q.x, q.z]);
      // rank = foot traffic through the lane (ties broken by length)
      let flow = 0, length = 0;
      if (access) for (const id of p.nodeIds) flow = Math.max(flow, access.nodeFlow[id] || 0);
      for (let k = 0; k + 1 < pts.length; k++) length += dist(pts[k], pts[k + 1]);
      this._addLane(pts, R, connected, flow + length * 0.001, 'path' + i);
    });
    // the piazza and slipway are open space too
    const lay = net.layout;
    this._addCapsule([lay.x, lay.piazzaZ], [lay.x, lay.piazzaZ], lay.piazzaR, -1);
    this._addCapsule([lay.slipX, lay.slipZ0], [lay.slipX, lay.slipZ1], lay.slipW / 2 + 0.4, -1);
    this._findCrossings();
    this._findForks();
    this.reserved = this.forkReserved();
    const maxRank = Math.max(1, ...this.lanes.filter((l) => l.kind !== 'quay').map((l) => l.rank));
    for (const l of this.lanes) l.rankNorm = l.kind === 'quay' ? 1.2 : l.rank / maxRank;
  }

  _addLane(pts, R, connected, rank, name) {
    // drop repeated points
    const P = [];
    for (const p of pts) if (!P.length || dist(P[P.length - 1], p) > 0.05) P.push(p);
    if (P.length < 2) return;
    const lane = { id: this.lanes.length, name, kind: name === 'quay' ? 'quay' : 'path', pts: P, R, connected, rank, lines: {} };
    for (let i = 0; i + 1 < P.length; i++) this._addCapsule(P[i], P[i + 1], R - 0.02, lane.id);
    lane.lines[1] = this._offsetLine(P, R, 1);
    lane.lines[-1] = this._offsetLine(P, R, -1);
    this.lanes.push(lane);
    this.byName.set(name, lane);
  }

  /** The lane offset by R to one side, with unit normals pointing away from the lane. */
  _offsetLine(P, R, side) {
    const n = P.length, segN = [];
    for (let i = 0; i + 1 < n; i++) { const d = norm(sub(P[i + 1], P[i])); segN.push([-d[1] * side, d[0] * side]); }
    const O = [], N = [], S = [0];
    for (let i = 0; i < n; i++) {
      const a = segN[Math.max(0, i - 1)], b = segN[Math.min(n - 2, i)];
      const vn = norm(add(a, b));
      const miter = 1 / Math.max(dot(vn, b), 0.5);
      O.push(add(P[i], mul(vn, R * miter)));
      N.push(vn);
      if (i > 0) S.push(S[i - 1] + dist(O[i - 1], O[i]));
    }
    return { O, N, S, total: S[n - 1] };
  }

  /**
   * Where other (side) lanes cross each frontage line: candidate spots for an
   * archway house fronting this lane with the side lane tunnelling under it.
   * line.crossings = [{ s, lane, sin }] (sin = sine of the crossing angle).
   */
  /**
   * Sharp forks: places where the frontage lines of two lanes cross at a sharp
   * angle. The wedge between them (on the away-from-lane side of both) is the
   * fork tip. this.forks = [{ p, angle, a: {lane, side, s, dir}, b: {…} }],
   * where `dir` is +1/-1 along that line's arclength, pointing into the wedge.
   */
  _findForks() {
    this.forks = [];
    const maxA = CONFIG.path.forkMaxAngle * Math.PI / 180;
    const L = this.lanes.filter((l) => l.connected);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      for (const sa of [1, -1]) for (const sb of [1, -1]) {
        const la = L[i].lines[sa], lb = L[j].lines[sb];
        for (let a = 0; a + 1 < la.O.length; a++) {
          const A0 = la.O[a], A1 = la.O[a + 1], ra = sub(A1, A0);
          for (let b = 0; b + 1 < lb.O.length; b++) {
            const B0 = lb.O[b], B1 = lb.O[b + 1], rb = sub(B1, B0);
            const den = ra[0] * rb[1] - ra[1] * rb[0];
            if (Math.abs(den) < 1e-9) continue;
            const w = sub(B0, A0);
            const t = (w[0] * rb[1] - w[1] * rb[0]) / den, u = (w[0] * ra[1] - w[1] * ra[0]) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const p = add(A0, mul(ra, t));
            const ta = norm(ra), tb = norm(rb);
            const na = norm(lerp2(la.N[a], la.N[a + 1], t)), nb = norm(lerp2(lb.N[b], lb.N[b + 1], u));
            // walk into the wedge: along A away from lane B, along B away from lane A
            const da = dot(ta, nb) > 0 ? 1 : -1, db = dot(tb, na) > 0 ? 1 : -1;
            const angle = Math.acos(Math.max(-1, Math.min(1, dot(mul(ta, da), mul(tb, db)))));
            if (angle > maxA || angle < 0.15) continue;
            if (this.forks.some((f) => dist(f.p, p) < 2)) continue;
            const f = {
              p, angle,
              a: { lane: L[i], side: sa, s: la.S[a] + t * dist(A0, A1), dir: da },
              b: { lane: L[j], side: sb, s: lb.S[b] + u * dist(B0, B1), dir: db },
            };
            // the tip: a triangle reaching forkReserve metres along both frontage lines
            const R = CONFIG.path.forkReserve;
            f.tip = [p, this.at(la, f.a.s + da * R).p, this.at(lb, f.b.s + db * R).p];
            this.forks.push(f);
          }
        }
      }
    }
  }

  /** A stable name for a fork (its tip position), so growth can remember which are built. */
  static forkKey(f) { return f.p[0].toFixed(1) + ',' + f.p[1].toFixed(1); }

  /** Stretches of frontage kept for fork-tip buildings, as { key: [[s0, s1, forkKey], …] }. */
  forkReserved() {
    const out = {}, R = CONFIG.path.forkReserve;
    for (const f of this.forks) for (const e of [f.a, f.b]) {
      const key = e.lane.name + ':' + e.side;
      const s0 = e.dir > 0 ? e.s : e.s - R, s1 = e.dir > 0 ? e.s + R : e.s;
      (out[key] = out[key] || []).push([s0, s1, Lanes.forkKey(f)]);
    }
    return out;
  }

  _findCrossings() {
    for (const A of this.lanes) for (const side of [1, -1]) {
      const line = A.lines[side];
      line.crossings = [];
      for (const Bl of this.lanes) {
        if (Bl === A || Bl.kind === 'quay') continue;
        for (let j = 0; j + 1 < Bl.pts.length; j++) {
          const p = Bl.pts[j], q = Bl.pts[j + 1];
          for (let i = 0; i + 1 < line.O.length; i++) {
            const a = line.O[i], b = line.O[i + 1];
            const r = sub(q, p), e = sub(b, a);
            const den = r[0] * e[1] - r[1] * e[0];
            if (Math.abs(den) < 1e-9) continue;
            const w = sub(a, p);
            const t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const sin = Math.abs(den) / (Math.hypot(r[0], r[1]) * Math.hypot(e[0], e[1]));
            line.crossings.push({ s: line.S[i] + u * dist(a, b), lane: Bl, sin });
          }
        }
      }
    }
  }

  /** Point and away-from-lane normal at arclength s along a frontage line. */
  at(line, s) {
    const { O, N, S } = line;
    if (s <= 0) return { p: O[0], n: N[0] };
    if (s >= line.total) return { p: O[O.length - 1], n: N[N.length - 1] };
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1);
    return { p: lerp2(O[lo], O[hi], t), n: norm(lerp2(N[lo], N[hi], t)) };
  }

  /**
   * Nearest point on any frontage line other than `excludeName`'s, within maxD:
   * { p, lane, side } or null. Used to fill corners where a row meets another lane.
   */
  nearestFrontage(p, maxD, excludeName) {
    let best = null, bd = maxD;
    for (const lane of this.lanes) {
      if (lane.name === excludeName || !lane.connected) continue;
      for (const side of [1, -1]) {
        const O = lane.lines[side].O;
        for (let i = 0; i + 1 < O.length; i++) {
          const a = O[i], b = O[i + 1];
          const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
          let u = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const q = [a[0] + u * dx, a[1] + u * dz];
          const d = dist(p, q);
          if (d < bd) { bd = d; best = { p: q, lane, side }; }
        }
      }
    }
    return best;
  }

  /**
   * Cast a ray from p along unit direction d; return the first crossing with
   * another lane's frontage line within [minT, maxT] as { t, lane } (or null).
   */
  rayToFrontage(p, d, minT, maxT, excludeName) {
    let best = null;
    for (const lane of this.lanes) {
      if (lane.name === excludeName || !lane.connected) continue;
      for (const side of [1, -1]) {
        const O = lane.lines[side].O;
        for (let i = 0; i + 1 < O.length; i++) {
          const a = O[i], b = O[i + 1];
          const e = [b[0] - a[0], b[1] - a[1]];
          const den = d[0] * e[1] - d[1] * e[0];
          if (Math.abs(den) < 1e-9) continue;
          const w = [a[0] - p[0], a[1] - p[1]];
          const t = (w[0] * e[1] - w[1] * e[0]) / den;
          const u = (w[0] * d[1] - w[1] * d[0]) / den;
          if (u < 0 || u > 1 || t < minT || t > maxT) continue;
          if (!best || t < best.t) best = { t, lane };
        }
      }
    }
    return best;
  }

  _addCapsule(a, b, r, lane) {
    const idx = this.capsules.length;
    this.capsules.push({ a, b, r, lane });
    const x0 = Math.floor((Math.min(a[0], b[0]) - r) / HASH), x1 = Math.floor((Math.max(a[0], b[0]) + r) / HASH);
    const z0 = Math.floor((Math.min(a[1], b[1]) - r) / HASH), z1 = Math.floor((Math.max(a[1], b[1]) + r) / HASH);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 100003 + j;
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(idx);
    }
  }

  /** Capsules near a polygon's bounding box. */
  _near(poly) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const out = new Set();
    for (let i = Math.floor(x0 / HASH); i <= Math.floor(x1 / HASH); i++)
      for (let j = Math.floor(z0 / HASH); j <= Math.floor(z1 / HASH); j++) {
        const list = this.hash.get(i * 100003 + j);
        if (list) for (const c of list) out.add(c);
      }
    return out;
  }

  /**
   * The hard rule: is this footprint clear of every lane, the quay, piazza and
   * slipway? `reserve` widens the lanes (not the open spaces) to keep the band
   * along each lane for houses that actually front it. A house fronting lane
   * `own` may use its own band and the bands of lanes it outranks, so a corner
   * house always fronts the main (busier) lane.
   */
  clearOf(poly, reserve = 0, own = null) {
    const ownRank = own ? (this.byName.get(own)?.rank ?? -1) : -Infinity;
    const pad = [[-reserve, -reserve], [reserve, reserve]];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const box = [[x0 + pad[0][0], z0 + pad[0][1]], [x1 + pad[1][0], z1 + pad[1][1]]];
    for (const ci of this._near(box)) {
      const c = this.capsules[ci];
      // a house may use the band of its own lane, and of lanes it outranks
      let r = c.r;
      if (c.lane >= 0 && reserve > 0) {
        const L = this.lanes[c.lane];
        if (L.name !== own && L.rank >= ownRank) r += reserve;
      }
      if (polySegDist(poly, c.a, c.b) < r) return false;
    }
    return true;
  }

  /** Distance from a point to the nearest lane centreline (paths and quay). */
  distToLane(p, maxD = 20) {
    let m = maxD;
    for (const ci of this._near([[p[0] - maxD, p[1] - maxD], [p[0] + maxD, p[1] + maxD]])) {
      const c = this.capsules[ci];
      if (c.lane < 0) continue;
      const d = pointSegDist(p, c.a, c.b);
      if (d < m) m = d;
    }
    return m;
  }
}

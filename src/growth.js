// ---------------------------------------------------------------------------
// growth.js — the town grows itself. THIS IS THE CORE OF THE PROTOTYPE.
//
// LANES COME FIRST. Every footprint is a convex quadrilateral
//     corners = [frontLeft, frontRight, backRight, backLeft]
// and houses are laid out from the lanes inward (see lanes.js):
//
//   • FRONTAGE: a house beside a lane takes a stretch [s0, s1] of the lane's
//     frontage line. Its front wall is flush along the lane (at a small fixed
//     setback); its side walls run square to the lane. Neighbours along the
//     lane share those side walls exactly, and on bends the footprints become
//     trapezoids/wedges that follow the curve. Main lanes (the quay, then the
//     longest paths) are preferred, so a corner house fronts the main lane.
//   • BACK lots: a second-row house shares the back wall of the house in front
//     and continues its side lines, so lots run straight into the block.
//   • SIDE lots: away from lanes, rows continue sideways sharing a side wall;
//     with no lane nearby they bend gently to face downhill.
//   • WEDGE infill: joins the side wall of one house to the facing side wall of
//     a differently-aligned neighbour, closing the triangular gaps at bends,
//     junction corners and in the middle of blocks.
//   • ARCHWAYS: where a side stair leaves a lane, a lane-front house may span
//     it on two piers with the stair tunnelling underneath; and occasionally a
//     house is built right across a lane (a covered passage). Both keep the
//     lane walkable with full headroom.
//
// HARD RULE: apart from archways, no wall may come within the lane radius of a
// lane centreline, the quay, piazza or slipway (exact test, lanes.clearOf).
//
// Each step evaluates a batch of candidates and builds the best-scoring one:
//     low walking effort + touching neighbours + fronting a lane + randomness
// Floors are counted from the *uphill* ground; walls go down to the lowest
// ground, so downhill facades are taller. A few houses gain a storey per step.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, FACADE_COLOURS, SHUTTER_COLOURS, ROOF_COLOURS } from './config.js';
import { makeRng, clamp, lerp, smoothstep } from './noise.js';
import { BAND } from './terrain.js';
import { ZONE } from './zones.js';
import { PathNetwork } from './paths.js';
import { Lanes, laneRadius } from './lanes.js';
import { BuildingRenderer } from './buildings.js';
import {
  sub, add, mul, dot, norm, dist, signedArea, isConvex, quadPoint, centroid, edgeNormal, convexOverlap,
} from './geom.js';

const B = CONFIG.building;
const OCC = 0.5;            // occupancy grid resolution (m)
const EMPTY = -1, PATH = -2, HARBOUR = -3;   // HARBOUR: quay/piazza/slipway, never built over
const RASTER_INSET = 0.25;  // a building claims cells this far inside its walls
const FIT_INSET = 0.3;      // a new footprint is tested this far inside its walls

/** Corners of a rectangle given centre, axes and size (used for archway houses). */
function rectCorners(c) {
  const hw = c.w / 2, hd = c.d / 2;
  return [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]].map(([u, v]) => [c.x + c.rx * u + c.fx * v, c.z + c.rz * u + c.fz * v]);
}

export class Growth {
  constructor(game) {
    this.game = game;
    this.terrain = game.terrain;
    this.rng = makeRng(CONFIG.seed * 101 + 9);
    const t = this.terrain;
    this.occN = Math.round(t.size / OCC);
    this.occ = new Int32Array(this.occN * this.occN).fill(EMPTY);
    this.lanes = new Lanes(game);
    this.buildings = [];          // index = id; removed → null
    this.live = [];               // ids of existing buildings
    this.frontLive = [];          // ids of lane-front buildings
    this.front = new Map();       // "lane:side" → [{s0, s1, id}] taken stretches of frontage
    this.acc = 0;
    this.dirty = true;
    this.renderer = new BuildingRenderer(t, this);
    this.group = this.renderer.group;
    this._rebuildTimer = 0;
    this._pathsSeen = -1;
    this.rebuilds = 0;           // bumps every time the meshes are rebuilt
  }

  clear() {
    this.occ.fill(EMPTY);
    this.buildings = [];
    this.live = [];
    this.frontLive = [];
    this.front.clear();
    this._pathsSeen = -1;
    this.dirty = true;
  }

  // ---- Occupancy grid -------------------------------------------------------

  occIndex(x, z) {
    const t = this.terrain;
    const i = Math.floor((x + t.half) / OCC), j = Math.floor((z + t.half) / OCC);
    if (i < 0 || j < 0 || i >= this.occN || j >= this.occN) return -1;
    return j * this.occN + i;
  }
  occAt(x, z) { const k = this.occIndex(x, z); return k < 0 ? PATH : this.occ[k]; }

  /** Visit every grid cell whose centre lies at least `inset` inside a convex polygon. */
  _forCells(poly, inset, fn) {
    const t = this.terrain;
    const ccw = signedArea(poly) > 0;
    const edges = poly.map((a, i) => {
      const e = norm(sub(poly[(i + 1) % poly.length], a));
      return { a, n: ccw ? [-e[1], e[0]] : [e[1], -e[0]] };   // inward normal
    });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const i0 = Math.floor((x0 + t.half) / OCC), i1 = Math.floor((x1 + t.half) / OCC);
    const j0 = Math.floor((z0 + t.half) / OCC), j1 = Math.floor((z1 + t.half) / OCC);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * OCC - t.half, pz = (j + 0.5) * OCC - t.half;
      let depth = Infinity;
      for (const { a, n } of edges) depth = Math.min(depth, (px - a[0]) * n[0] + (pz - a[1]) * n[1]);
      if (depth < inset) continue;
      const k = (i < 0 || j < 0 || i >= this.occN || j >= this.occN) ? -1 : j * this.occN + i;
      if (fn(k) === false) return false;
    }
    return true;
  }

  /** Mark the lanes in the grid (used by archways, scenery and window checks). */
  _markPaths() {
    const net = this.game.paths;
    for (let k = 0; k < this.occ.length; k++) if (this.occ[k] === PATH || this.occ[k] === HARBOUR) this.occ[k] = EMPTY;
    const stamp = (poly, r, value = PATH) => {
      for (const p of PathNetwork.resample(poly, 0.5)) {
        for (let dz = -r; dz <= r; dz += OCC) for (let dx = -r; dx <= r; dx += OCC) {
          if (dx * dx + dz * dz > r * r) continue;
          const k = this.occIndex(p.x + dx, p.z + dz);
          if (k < 0) continue;
          const o = this.occ[k];
          if (o >= 0) { if (this.buildings[o] && this.buildings[o].arch) continue; this._remove(o); }
          if (o !== HARBOUR && this.occ[k] < 0) this.occ[k] = value;
        }
      }
    };
    const H = CONFIG.harbour, lay = net.layout;
    stamp(net.quay.points, H.quayHalfWidth, HARBOUR);
    // keep the piazza and slipway open
    stamp([{ x: lay.x, z: lay.piazzaZ }, { x: lay.x, z: lay.piazzaZ + 0.01 }], lay.piazzaR, HARBOUR);
    stamp([{ x: lay.slipX, z: lay.slipZ0 }, { x: lay.slipX, z: lay.slipZ1 }], lay.slipW / 2 + 0.4, HARBOUR);
    for (const p of net.paths) stamp(p.points, laneRadius() - 0.15);
  }

  _remove(id) {
    const b = this.buildings[id];
    if (!b) return;
    this._forCells(b.corners, RASTER_INSET, (k) => { if (k >= 0 && this.occ[k] === id) this.occ[k] = EMPTY; });
    for (const F of [b.frontage, b.frontage2]) {
      const list = F && this.front.get(F.key);
      if (list) this.front.set(F.key, list.filter((iv) => iv.id !== id));
    }
    this.buildings[id] = null;
    this.live = this.live.filter((i) => i !== id);
    this.frontLive = this.frontLive.filter((i) => i !== id);
    this.dirty = true;
  }

  // ---- Reacting to paths / zones ---------------------------------------------

  onAccessChanged() {
    const g = this.game;
    const pathsChanged = this._pathsSeen !== g.paths.version;
    if (pathsChanged) { this._markPaths(); this._pathsSeen = g.paths.version; }
    this.lanes.rebuild(g.access);
    if (pathsChanged) {
      // a new lane may run through ordinary houses: they make way (the hard rule)
      for (const id of [...this.live]) {
        const b = this.buildings[id];
        if (b && !b.arch && !this.lanes.clearOf(b.corners)) this._remove(id);
      }
    }
    this.dirty = true;
  }

  // ---- Candidate construction -----------------------------------------------

  /** Distance along a ray (p, unit d) to the first wall of an existing house, or Infinity. */
  _rayToBuildings(p, d, maxT) {
    let best = Infinity;
    for (const id of this.live) {
      const o = this.buildings[id];
      if (Math.abs(o.x - p[0]) > maxT + 10 || Math.abs(o.z - p[1]) > maxT + 10) continue;
      const q = o.corners;
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4], e = sub(b, a);
        const den = d[0] * e[1] - d[1] * e[0];
        if (Math.abs(den) < 1e-9) continue;
        const w = sub(a, p);
        const t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den;
        if (u >= 0 && u <= 1 && t > 0.05 && t < best && t <= maxT) best = t;
      }
    }
    return best;
  }

  /**
   * How deep a lot starting at p (going along n) can be: up to the row of houses
   * behind it if there is one, else to the middle of the block (half way to the
   * next lane's frontage line). Infinity if neither is within reach.
   */
  _blockReach(p, n, ownLane) {
    const R = 26;
    const tb = this._rayToBuildings(p, n, R);
    if (isFinite(tb)) return tb;
    const hl = this.lanes.rayToFrontage(p, n, 1, R, ownLane);
    return hl ? hl.t / 2 : Infinity;
  }

  /** Fill in centre, facing and size from a candidate's corners. */
  _derive(c) {
    const q = c.corners;
    [c.x, c.z] = centroid(q);
    const n = edgeNormal(q, 0);                 // the front wall faces outward along this
    c.fx = n[0]; c.fz = n[1];
    c.rx = c.fz; c.rz = -c.fx;
    c.theta = Math.atan2(c.fx, c.fz);
    c.w = dist(q[0], q[1]);
    c.d = (dist(q[1], q[2]) + dist(q[0], q[3])) / 2;
    return c;
  }

  _sizeFor(band, kind, x, z) {
    const key = kind === ZONE.COM || band === BAND.FLAT ? 'flat' : band === BAND.STEEP ? 'steep' : 'moderate';
    const r = this.rng, H = CONFIG.harbour, h = this.terrain.harbour;
    // slim tower-houses along the harbour front
    const front = band !== BAND.STEEP && Math.hypot(x - h.x, z - h.z) < H.frontRadius;
    const wr = front ? H.frontWidth : B.width[key], dr = front ? H.frontDepth : B.depth[key];
    // quantise widths a little so rows read as one consistent town
    const w = Math.round(r.range(...wr) * 2) / 2;
    const d = Math.round(r.range(...dr) * 2) / 2;
    return { w, d, key };
  }

  _sizeAt(p) {
    const kind = this.game.zones.at(p[0], p[1]) === ZONE.COM ? ZONE.COM : ZONE.RES;
    return this._sizeFor(this.terrain.bandAt(p[0], p[1]), kind, p[0], p[1]);
  }

  /**
   * FRONTAGE: a house along a lane. Either extends an existing row along the
   * same frontage line (sharing its side wall), or starts a new one.
   */
  _frontageVariants() {
    const r = this.rng, L = this.lanes;
    let lane, side, start, dir;
    if (this.frontLive.length && r() < 0.75) {
      const F = this.buildings[r.pick(this.frontLive)].frontage;
      lane = L.byName.get(F.name); side = F.side;
      if (!lane || !lane.connected) return [];
      dir = r() < 0.5 ? 1 : -1;
      start = dir > 0 ? F.s1 : F.s0;
    } else {
      const open = L.lanes.filter((l) => l.connected);
      if (!open.length) return [];
      // longer / more important lanes get more new rows
      lane = r.weighted(open.map((l) => [l, l.kind === 'quay' ? 80 : Math.min(l.rank, 80) + 5]));
      side = r() < 0.5 ? 1 : -1;
      start = r() * lane.lines[side].total;
      dir = 1;
    }
    const line = lane.lines[side];
    const key = lane.name + ':' + side;
    const list = this.front.get(key) || [];
    if (list.some((iv) => start > iv.s0 + 0.01 && start < iv.s1 - 0.01)) return [];
    // a new row snaps onto the end of a row just behind it, so no sliver is left
    for (const iv of list) if (dir > 0 && start - iv.s1 > 0 && start - iv.s1 < 2.6) start = iv.s1;
    // room up to the next house along this frontage (or the end of the lane)
    let limit = dir > 0 ? line.total : 0;
    for (const iv of list) {
      if (dir > 0 && iv.s0 >= start - 0.01 && iv.s0 < limit) limit = iv.s0;
      if (dir < 0 && iv.s1 <= start + 0.01 && iv.s1 > limit) limit = iv.s1;
    }
    const gap = Math.abs(limit - start);
    if (gap < 2.4) return [];
    const { w, d } = this._sizeAt(L.at(line, start).p);
    const maxW = 6.5;
    let widths;
    if (gap <= maxW) widths = [gap];                              // fill the gap exactly
    else {
      let ww = w;
      if (gap - ww < 2.6) ww = Math.min(gap - 2.6, maxW);         // leave room for one more
      widths = [ww, Math.max(2.6, ww - 1)];
    }
    const depths = [...new Set([d, Math.max(4.5, d - 1.5), 4.5, 3.2])];   // shallow houses fit narrow strips
    const out = [];
    for (const ww of widths) {
      const s0 = dir > 0 ? start : start - ww, s1 = s0 + ww;
      const A = L.at(line, s0), Bp = L.at(line, s1);
      const frontage = { name: lane.name, side, s0, s1, key };
      // THROUGH-HOUSE: in a narrow block, reach right across to the next lane's
      // frontage line (only into the band of a lane this one outranks).
      const ha = L.rayToFrontage(A.p, A.n, 2, d + 1.5, lane.name), hb = L.rayToFrontage(Bp.p, Bp.n, 2, d + 1.5, lane.name);
      if (ha && hb && ha.lane === hb.lane && ha.lane.rank < lane.rank) {
        const corners = [A.p, Bp.p, add(Bp.p, mul(Bp.n, hb.t)), add(A.p, mul(A.n, ha.t))];
        out.push({ corners, type: 'front', through: true, frontage, rankNorm: lane.rankNorm });
      }
      // LOT TO THE BACK OF THE BLOCK: reach the row behind (or the middle of the
      // block), so blocks fill edge to edge; the irregular back wall is hidden.
      const inset = mul(norm(sub(Bp.p, A.p)), 0.3);
      const ta = this._blockReach(add(A.p, inset), A.n, lane.name), tb = this._blockReach(sub(Bp.p, inset), Bp.n, lane.name);
      if (isFinite(ta) && isFinite(tb) && Math.min(ta, tb) >= 3.2 && Math.max(ta, tb) <= 12 && Math.abs(ta - tb) < 4) {
        const corners = [A.p, Bp.p, add(Bp.p, mul(Bp.n, tb)), add(A.p, mul(A.n, ta))];
        out.push({ corners, type: 'front', frontage, rankNorm: lane.rankNorm, filled: true });
      }
      for (const dd of depths) {
        const corners = [A.p, Bp.p, add(Bp.p, mul(Bp.n, dd)), add(A.p, mul(A.n, dd))];
        out.push({ corners, type: 'front', frontage, rankNorm: lane.rankNorm });
      }
    }
    return out;
  }

  /** BACK lot: shares b's back wall and continues its side lines into the block. */
  _backVariants(b) {
    const [FL, FR, BR, BL] = b.corners;
    const dR = norm(sub(BR, FR)), dL = norm(sub(BL, FL));
    const { d } = this._sizeAt(add(mul(add(BR, BL), 0.5), mul(add(dR, dL), 2)));
    const out = [];
    // reach the next row of houses, or stop at the edge of the next lane's band
    const reach = (p, dir) => {
      const tb = this._rayToBuildings(p, dir, 14);
      const hl = this.lanes.rayToFrontage(p, dir, 0.5, 14 + CONFIG.path.frontageReserve, null);
      return Math.min(tb, hl ? hl.t - CONFIG.path.frontageReserve : Infinity);
    };
    const inset = mul(norm(sub(BL, BR)), 0.3);
    const tR = reach(add(BR, inset), dR), tL = reach(sub(BL, inset), dL);
    if (isFinite(tR) && isFinite(tL) && Math.min(tR, tL) >= 2.5 && Math.max(tR, tL) <= 12 && Math.abs(tR - tL) < 4) {
      out.push({ corners: [BR, BL, add(BL, mul(dL, tL)), add(BR, mul(dR, tR))], type: 'back', filled: true });
    }
    for (const dd of [...new Set([d, Math.max(4, d - 1.5), 4])]) {
      const corners = [BR, BL, add(BL, mul(dL, dd)), add(BR, mul(dR, dd))];
      if (dist(corners[2], corners[3]) > dist(BR, BL) * 1.6 + 1) continue;   // fanning out too far
      out.push({ corners, type: 'back' });
    }
    return out;
  }

  /**
   * SIDE lot: continues a row sideways, sharing b's side wall. Near lanes the
   * row stays straight; with no lane nearby it bends gently to face downhill.
   */
  _sideVariants(b, s) {
    const [FL, FR, BR, BL] = b.corners;
    let t = norm(sub(FR, FL));
    const ref = s > 0 ? FR : FL;
    if (this.lanes.distToLane(ref, 14) >= 14) {
      const dh = this.terrain.downhillAt(ref[0], ref[1]);
      let contour = [dh.z, -dh.x];
      if (dot(contour, t) < 0) contour = mul(contour, -1);
      t = norm(add(mul(t, 0.75), mul(contour, 0.25)));
    }
    const { w } = this._sizeAt(ref);
    const out = [];
    for (const ww of [...new Set([w, Math.max(3, w - 0.8), 3])]) {
      const corners = s > 0
        ? [FR, add(FR, mul(t, ww)), add(BR, mul(t, ww)), BR]
        : [add(FL, mul(t, -ww)), FL, BL, add(BL, mul(t, -ww))];
      out.push({ corners, type: 'side' });
    }
    return out;
  }

  /** WEDGE: fill the gap between b's side wall and a nearby neighbour's facing side wall. */
  _wedgeVariants(b) {
    const out = [];
    const [FL, FR, BR, BL] = b.corners;
    for (const id of this.live) {
      const o = this.buildings[id];
      if (o === b || Math.abs(o.x - b.x) > 14 || Math.abs(o.z - b.z) > 14) continue;
      const [oFL, oFR, oBR, oBL] = o.corners;
      // b's right wall to o's left wall, and o's right wall to b's left wall
      for (const [p1, q1, p2, q2] of [[FR, BR, oFL, oBL], [oFR, oBR, FL, BL]]) {
        const front = dist(p1, p2), back = dist(q1, q2);
        if (front < 0.8 || front > 7 || back > 9) continue;
        const corners = [p1, p2, q2, q1];
        if (!isConvex(corners)) continue;
        // a wedge between two lane-front houses belongs to the busier of their lanes
        let ownLane = null;
        if (b.frontage && o.frontage) {
          const lb = this.lanes.byName.get(b.frontage.name), lo = this.lanes.byName.get(o.frontage.name);
          ownLane = (!lo || (lb && lb.rank >= lo.rank)) ? b.frontage.name : o.frontage.name;
        }
        out.push({ corners, type: 'wedge', gap: front, betweenFronts: !!ownLane, ownLane });
      }
    }
    out.sort((a, c) => a.gap - c.gap);
    return out.slice(0, 4);
  }

  /**
   * CORNER: where a row of lane-front houses ends near another lane (a fork or
   * a junction), fill the space between the last house's side wall and that
   * lane's frontage line. The result fronts both lanes, like a corner building.
   */
  _cornerVariants(b) {
    if (!b.frontage) return [];
    const out = [];
    const [FL, FR, BR, BL] = b.corners;
    for (const [p, q, right] of [[FR, BR, true], [FL, BL, false]]) {
      for (const f of [1, 0.75, 0.5]) {
        const qq = add(p, mul(sub(q, p), f));               // shorten the shared wall if needed
        const np = this.lanes.nearestFrontage(p, 7, b.frontage.name);
        const nq = this.lanes.nearestFrontage(qq, 7, b.frontage.name);
        if (!np || !nq || np.lane !== nq.lane || np.side !== nq.side) continue;
        if (dist(p, np.p) < 1.2) continue;
        const corners = right ? [p, np.p, nq.p, qq] : [np.p, p, qq, nq.p];
        if (!isConvex(corners)) continue;
        out.push({ corners, type: 'wedge', betweenFronts: true, ownLane: b.frontage.name, corner: true });
      }
    }
    return out;
  }

  /**
   * ARCHWAY on a lane: a lane-front house centred where a side stair leaves the
   * lane, standing on a pier either side with the stair tunnelling under it.
   * It joins the lane's row of houses like any other frontage house.
   */
  _archFrontVariants() {
    const r = this.rng, L = this.lanes;
    const spots = [];
    for (const lane of L.lanes) if (lane.connected) for (const side of [1, -1])
      for (const x of lane.lines[side].crossings || []) if (x.lane.rank < lane.rank && x.sin > 0.6) spots.push({ lane, side, x });
    if (!spots.length) return [];
    const { lane, side, x } = r.pick(spots);
    const line = lane.lines[side];
    const key = lane.name + ':' + side;
    const span = (2 * laneRadius()) / x.sin + 2 * (CONFIG.path.archMinPier + 0.7);   // lane + two piers
    const { d } = this._sizeAt(L.at(line, x.s).p);
    const out = [];
    for (const shift of [0, 0.6, -0.6]) {                 // the stair may sit a little off-centre
      const s0 = x.s + shift - span / 2, s1 = s0 + span;
      if (s0 < 0 || s1 > line.total) continue;
      if ((this.front.get(key) || []).some((iv) => iv.s1 > s0 + 0.01 && iv.s0 < s1 - 0.01)) continue;
      const A = L.at(line, s0), Bp = L.at(line, s1), M = L.at(line, (s0 + s1) / 2);
      const theta = Math.atan2(-M.n[0], -M.n[1]);         // facing the lane
      const fx = Math.sin(theta), fz = Math.cos(theta);
      const w = dist(A.p, Bp.p), cx = (A.p[0] + Bp.p[0]) / 2 + M.n[0] * d / 2, cz = (A.p[1] + Bp.p[1]) / 2 + M.n[1] * d / 2;
      const c = { x: cx, z: cz, theta, fx, fz, rx: fz, rz: -fx, w, d, rect: true, type: 'arch', allowArch: true,
        frontage: { name: lane.name, side, s0, s1, key }, rankNorm: lane.rankNorm };
      c.corners = rectCorners(c);
      out.push(c);
    }
    return out;
  }

  /**
   * COVERED PASSAGE: a house built right across a lane, standing on a pier on
   * each side, with the lane running lengthwise underneath. It takes the same
   * stretch of frontage on both sides of the lane.
   */
  _passageVariants() {
    const r = this.rng, L = this.lanes;
    // continue an existing row: start where a lane-front house on side +1 ends
    const rows = this.frontLive.map((id) => this.buildings[id]).filter((b) => b.frontage.side === 1 && b.type === 'front');
    if (!rows.length) return [];
    const F = r.pick(rows).frontage;
    const lane = L.byName.get(F.name);
    if (!lane || !lane.connected || lane.kind === 'quay') return [];
    const l1 = lane.lines[1], l2 = lane.lines[-1];
    const w = r.range(4, 5.5);
    const s0 = r() < 0.5 ? F.s1 : F.s0 - w, s1 = s0 + w, s = (s0 + s1) / 2;
    if (s0 < 0 || s1 > l1.total) return [];
    const k2 = l2.total / l1.total, t0 = s0 * k2, t1 = s1 * k2;       // the matching stretch opposite
    const k1 = lane.name + ':1', km = lane.name + ':-1';
    const busy = (key, a, b) => (this.front.get(key) || []).some((iv) => iv.s1 > a + 0.01 && iv.s0 < b - 0.01);
    if (busy(k1, s0, s1) || busy(km, t0, t1)) return [];
    const A = L.at(l1, s0), Bp = L.at(l1, s1), M = L.at(l1, s);
    const across = 2 * laneRadius() + 2 * (CONFIG.path.archMinPier + 0.9);
    const theta = Math.atan2(M.n[0], M.n[1]);
    const fx = Math.sin(theta), fz = Math.cos(theta);
    // centre on the lane centreline
    const cx = (A.p[0] + Bp.p[0]) / 2 - M.n[0] * laneRadius(), cz = (A.p[1] + Bp.p[1]) / 2 - M.n[1] * laneRadius();
    const c = { x: cx, z: cz, theta, fx, fz, rx: fz, rz: -fx, w: dist(A.p, Bp.p), d: across, rect: true, type: 'arch', allowArch: true,
      frontage: { name: lane.name, side: 1, s0, s1, key: k1 }, frontage2: { name: lane.name, side: -1, s0: t0, s1: t1, key: km },
      rankNorm: lane.rankNorm };
    c.corners = rectCorners(c);
    return [c];
  }

  // ---- Validation & scoring ---------------------------------------------------

  /**
   * Fill in ground heights, kind, band, effort; return false if it can't be
   * built (c.why then says why — handy when tuning from the console).
   */
  _evaluate(c) {
    const t = this.terrain, g = this.game;
    const q = c.corners;
    if (!isConvex(q)) return (c.why = 'not convex', false);
    if (!c.rect) this._derive(c);
    const small = c.type === 'wedge';             // corner/wedge pieces may be small
    if (Math.abs(signedArea(q)) < (small ? 4 : 7) || c.w < (small ? 1.5 : 2.3)) return (c.why = 'too small', false);
    for (const p of q) if (!t.inside(p[0], p[1], 3)) return (c.why = 'off map', false);
    // 1. occupancy. Lane cells are only OK for an archway house.
    const lane = [];
    const free = this._forCells(q, FIT_INSET, (k) => {
      if (k < 0) return (c.why = 'off map', false);
      const o = this.occ[k];
      if (o === EMPTY) return true;
      if (o === PATH && c.allowArch) { lane.push(k); return true; }
      return (c.why = 'occupied', false);
    });
    if (!free) return (c.why = 'occupied', false);
    // exact check against nearby houses (the grid can miss thin slivers)
    for (const id of this.live) {
      const o = this.buildings[id];
      if (Math.abs(o.x - c.x) > 16 || Math.abs(o.z - c.z) > 16) continue;
      if (convexOverlap(q, o.corners) > 0.12) return (c.why = 'overlap', false);
    }
    c.arch = null;
    if (c.type === 'arch') {
      if (!lane.length || !this._fitArch(c, lane)) return (c.why = 'no archway fit', false);   // only straddling ones
    } else if (!this.lanes.clearOf(q, this._reserveFor(c), this._ownLane(c))) {
      return (c.why = 'too close to a lane', false);                                                 // THE HARD RULE
    }
    // 2. land: zoned, reachable, not sea/cliff. Sample a 3x3 grid in the footprint.
    let zonedRes = 0, zonedCom = 0, bad = 0, steep = 0, flat = 0, effSum = 0, effN = 0;
    let gMin = Infinity, gMax = -Infinity;
    for (const u of [0.12, 0.5, 0.88]) for (const v of [0.12, 0.5, 0.88]) {
      const [x, z] = quadPoint(q, u, v);
      const idx = t.cellIndex(x, z);
      if (idx < 0) return (c.why = 'off map', false);
      const band = t.band[idx];
      if (band === BAND.SEA) return (c.why = 'in the sea', false);
      if (band === BAND.CLIFF) bad++;
      if (band === BAND.STEEP) steep++;
      if (band === BAND.FLAT) flat++;
      const zv = g.zones.grid[idx];
      if (zv === ZONE.RES) zonedRes++; else if (zv === ZONE.COM) zonedCom++;
      const e = g.access.cellEffort[idx];
      if (isFinite(e)) { effSum += e; effN++; }
    }
    for (const p of [...q, [c.x, c.z]]) {
      const h = t.heightAt(p[0], p[1]);
      gMin = Math.min(gMin, h); gMax = Math.max(gMax, h);
    }
    if (bad > 1) return (c.why = 'on a cliff', false);                      // (one corner on a rocky bit is ok)
    if (zonedRes + zonedCom < 7 || effN < 7) return (c.why = 'not zoned or unreachable', false);
    if (gMin < B.minGround) return (c.why = 'too low', false);           // keep feet dry
    if (gMax - gMin > 9) return (c.why = 'slope too great', false);              // absurd stilts
    c.kind = zonedCom > zonedRes ? ZONE.COM : ZONE.RES;
    c.band = steep >= 4 ? BAND.STEEP : flat >= 5 ? BAND.FLAT : BAND.MODERATE;
    if (c.kind === ZONE.COM && c.band === BAND.STEEP) return (c.why = 'no shops on steep land', false); // no shops on steep land
    if (c.arch) {
      if (c.kind === ZONE.COM) return (c.why = 'no shops over archways', false);
      // enough storeys to put rooms above the arch
      c.minFloors = Math.ceil((c.arch.y + B.floorHeight * 1.5 - gMax) / B.floorHeight);
      if (c.minFloors > 6) return (c.why = 'archway too tall', false);
    }
    // only small houses on steep ground (wedges are gap-fillers, so exempt)
    if (c.band === BAND.STEEP && c.type !== 'wedge' && (c.w > B.width.steep[1] + 0.8 || c.d > B.depth.steep[1] + 0.8)) return (c.why = 'too big for steep ground', false);
    c.gMin = gMin; c.gMax = gMax;
    c.effort = effSum / effN;
    return true;
  }

  /**
   * How far beyond the lane clearance a candidate must also stay (see
   * lanes.clearOf). Lane-front houses — and corner wedges joining them — may
   * use their own lane's band and those of less busy lanes; every other lot
   * stops at the band's edge, so it can't arrive at a lane at an angle.
   */
  _reserveFor(c) {
    return CONFIG.path.frontageReserve;
  }

  /** The lane whose band (and less busy lanes' bands) this candidate may use. */
  _ownLane(c) {
    if (c.frontage) return c.frontage.name;
    if (c.type === 'wedge' && c.betweenFronts) return c.ownLane;
    return null;
  }

  /**
   * Can this footprint straddle the lane cells it covers? The lane must cross
   * cleanly (front-to-back or side-to-side) leaving a pier on each side. On
   * success c.arch = { axis, lo, hi, y }: the lane occupies [lo, hi] along
   * the house's local x ('f': lane runs front-to-back) or local z ('r': a
   * covered passage running along the row), and the house starts at height y.
   */
  _fitArch(c, lane) {
    const t = this.terrain, P = CONFIG.path;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
    for (const k of lane) {
      const i = k % this.occN, j = (k / this.occN) | 0;
      const wx = (i + 0.5) * OCC - t.half, wz = (j + 0.5) * OCC - t.half;
      const dx = wx - c.x, dz = wz - c.z;
      const lx = dx * c.rx + dz * c.rz, lz = dx * c.fx + dz * c.fz;
      x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
      top = Math.max(top, t.surfaceAt(wx, wz));
    }
    const laneMax = 2 * laneRadius() + 1.4, pad = OCC / 2 + 0.05;   // a little slack for stairs crossing at an angle
    const hw = c.w / 2, hd = c.d / 2;
    let arch = null;
    if (x1 - x0 <= laneMax && z1 - z0 >= c.d * 0.6 &&
        x0 - pad + hw >= P.archMinPier && hw - (x1 + pad) >= P.archMinPier) {
      arch = { axis: 'f', lo: x0 - pad, hi: x1 + pad };
    } else if (z1 - z0 <= laneMax && x1 - x0 >= c.w * 0.6 &&
        z0 - pad + hd >= P.archMinPier && hd - (z1 + pad) >= P.archMinPier) {
      arch = { axis: 'r', lo: z0 - pad, hi: z1 + pad };
    }
    if (!arch) return false;
    arch.y = top + 0.2 + P.archHeadroom;
    c.arch = arch;
    return true;
  }

  /** How many distinct buildings (and lanes) this footprint would touch. */
  _touches(c) {
    const ids = new Set();
    let lane = 0;
    const q = c.corners;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], n = edgeNormal(q, i), L = dist(a, b);
      const e = norm(sub(b, a));
      for (let u = 0.5; u < L; u += 1) {
        const p = add(add(a, mul(e, u)), mul(n, 0.7));
        const o = this.occAt(p[0], p[1]);
        if (o >= 0) ids.add(o); else if (o === PATH || o === HARBOUR) lane = 1;
      }
    }
    return { n: ids.size, lane };
  }

  _score(c) {
    const E = CONFIG.effort;
    const touch = this._touches(c);
    c.touch = touch.n;
    let s = -c.effort / 22;                       // near the harbour first
    s += 1.35 * Math.min(touch.n, 4);             // compact: fill gaps, share walls
    if (c.type === 'front') s += 1.0 + 0.6 * c.rankNorm;   // lanes first; main lanes before side lanes
    else s += 0.6 * touch.lane;
    if (c.type === 'wedge') s += 0.8;             // close gaps
    if (c.filled) s += 0.5;                       // lots that reach the back of the block
    if (c.type === 'arch') s += c.frontage ? 1.4 + 0.6 * c.rankNorm : 0.4;   // archway houses front their lane too
    if (c.kind === ZONE.COM && c.band === BAND.FLAT) s += 1.0;
    if (c.band === BAND.STEEP) s -= 0.6;          // steep land fills last
    s += this.rng() * 1.3;                        // a little life
    if (c.effort > E.edgeEffort * 2.2) s -= 3;    // very far: very slow
    return s;
  }

  // ---- Adding and growing buildings -----------------------------------------

  _add(c) {
    const r = this.rng;
    const id = this.buildings.length;
    const b = Object.assign(c, {
      id, floors: 1 + (r() < 0.35 ? 1 : 0),
      bonus: r.weighted([[0, 5], [1, 2], [-1, 2]]),
      facade: new THREE.Color(r.weighted(FACADE_COLOURS)).offsetHSL(r.range(-0.01, 0.01), r.range(-0.05, 0.03), r.range(-0.03, 0.03)),
      shutter: new THREE.Color(r.pick(SHUTTER_COLOURS)),
      roofCol: new THREE.Color(r.weighted(ROOF_COLOURS)).offsetHSL(0, 0, r.range(-0.04, 0.04)),
      roof: c.kind === ZONE.COM ? r.weighted([['gable', 3], ['hip', 2], ['flat', 2]]) : r.weighted([['gable', 6], ['hip', 2], ['flat', 2], ['gableX', 2]]),
      balconies: r() < 0.45,
      seed: (r() * 1e9) | 0,
      age: 0,
      fails: 0,
    });
    if (b.arch) b.floors = Math.max(b.floors, b.minFloors);
    this.buildings.push(b);
    this.live.push(id);
    for (const F of [b.frontage, b.frontage2]) {
      if (!F) continue;
      if (!this.front.has(F.key)) this.front.set(F.key, []);
      this.front.get(F.key).push({ s0: F.s0, s1: F.s1, id });
    }
    if (b.frontage) this.frontLive.push(id);
    this._forCells(b.corners, RASTER_INSET, (k) => { if (k >= 0 && this.occ[k] === EMPTY) this.occ[k] = id; });
    this.dirty = true;
    return b;
  }

  /** Target storeys (above the uphill ground) for a building right now. */
  targetFloors(b) {
    const E = CONFIG.effort;
    let maxF = b.band === BAND.STEEP ? B.maxFloors.steep : b.band === BAND.FLAT ? B.maxFloors.flat : B.maxFloors.moderate;
    if (b.kind === ZONE.COM) maxF = Math.min(maxF, B.commercialMaxFloors);
    // the harbour front stands tallest, easing back to the normal cap with effort
    if (b.band !== BAND.STEEP) {
      const H = CONFIG.harbour;
      maxF = Math.max(maxF, Math.round(H.maxFloors - (H.maxFloors - maxF) * smoothstep(0, H.tallEffort, b.effort)));
    }
    const core = Math.pow(1 - smoothstep(0, E.edgeEffort, b.effort), 0.8);   // 1 at the harbour
    const dens = clamp(this._neighbourCount(b, 11) / 7, 0, 1);
    // density lifts heights inland; right on the harbour front houses stand tall regardless
    const H = CONFIG.harbour;
    const inland = smoothstep(H.tallEffort * 0.4, H.tallEffort, b.effort);   // 0 on the harbour front
    const densF = lerp(1, 0.3 + 0.7 * dens, inland);
    const bonus = inland > 0 ? b.bonus : Math.max(b.bonus, 0);
    const f = 1 + Math.round((maxF - 1) * core * densF) + bonus;
    return clamp(f, 1, maxF);
  }

  _neighbourCount(b, radius) {
    let n = 0;
    for (const id of this.live) {
      const o = this.buildings[id];
      if (o !== b && Math.abs(o.x - b.x) < radius && Math.abs(o.z - b.z) < radius) n++;
    }
    return n;
  }

  /** One growth step: maybe build one house, and let a few gain a storey. */
  step() {
    const g = this.game, r = this.rng;
    if (!g.access) return;
    let best = null, bestScore = -Infinity;
    const tries = CONFIG.sim.candidatesPerStep;
    for (let k = 0; k < tries; k++) {
      let variants, parent = null;
      const roll = r();
      if (!this.live.length || roll < 0.4) {
        variants = this._frontageVariants();
      } else {
        // pick a building that still has free sides (the growth "frontier")
        for (let a = 0; a < 6; a++) { parent = this.buildings[r.pick(this.live)]; if (parent.fails < 30) break; }
        if (roll < 0.65) variants = this._backVariants(parent);
        else if (roll < 0.78) variants = parent.frontage ? this._backVariants(parent) : this._sideVariants(parent, r() < 0.5 ? 1 : -1);
        else if (roll < 0.86) variants = this._wedgeVariants(parent);
        else if (roll < 0.86 + 0.2 * CONFIG.path.archChance) variants = this._archFrontVariants();    // stairs under houses
        else if (roll < 0.86 + 0.27 * CONFIG.path.archChance) variants = this._passageVariants();     // lanes under houses
        else variants = this._cornerVariants(parent);
      }
      const c = variants.find((v) => this._evaluate(v));
      if (!c) { if (parent) parent.fails++; continue; }
      const s = this._score(c);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best) this._add(best);

    // --- densify: a few buildings gain a storey ---
    for (let k = 0; k < CONFIG.sim.floorGrowthsPerStep && this.live.length; k++) {
      const b = this.buildings[r.pick(this.live)];
      b.age++;
      if (b.age > 2 && b.floors < this.targetFloors(b)) { b.floors++; this.dirty = true; }
    }
  }

  /** Called every frame with simulated seconds. */
  update(dt) {
    this.acc += dt * CONFIG.sim.stepsPerSecond;
    let n = 0;
    while (this.acc >= 1 && n < 40) { this.step(); this.acc -= 1; n++; }
    if (this.acc > 1) this.acc = 1;
    this._rebuildTimer -= 1 / 60;
    if (this.dirty && this._rebuildTimer <= 0) {
      this.renderer.rebuild(this.live.map((id) => this.buildings[id]));
      this.dirty = false;
      this.rebuilds++;
      this._rebuildTimer = 0.2;
    }
  }

  /** Run many steps at once (used by tests and the console). */
  grow(steps) {
    for (let i = 0; i < steps; i++) this.step();
    this.renderer.rebuild(this.live.map((id) => this.buildings[id]));
    this.dirty = false;
    this.rebuilds++;
  }

  stats() {
    let houses = 0, shops = 0, floors = 0, tallest = 0;
    for (const id of this.live) {
      const b = this.buildings[id];
      if (b.kind === ZONE.COM) shops++; else houses++;
      floors += b.floors;
      tallest = Math.max(tallest, Math.floor((b.floors * B.floorHeight + b.gMax - b.gMin) / B.floorHeight));
    }
    return { houses, shops, floors, tallest };
  }

  /** Who occupies (x, z) and how tall is it there? Used to hide covered windows. */
  blockerTop(x, z) {
    const o = this.occAt(x, z);
    if (o < 0) return -Infinity;
    const b = this.buildings[o];
    return b ? b.top : -Infinity;
  }
}

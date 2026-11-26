// ---------------------------------------------------------------------------
// growth.js — the town grows itself. THIS IS THE CORE OF THE PROTOTYPE.
//
// Buildings are oriented rectangles: the facade faces "downhill" (a smoothed
// slope direction from terrain.downhillAt) and the width runs along the
// contour. Each building is footprint + floors; floors are counted from the
// *uphill* ground, and the body extends down to the lowest ground, so on a
// slope the downhill facade is automatically taller.
//
// How new buildings are found (each growth step):
//   • ATTACH candidates: next to an existing building.
//       - left/right: hinged on the shared FRONT corner, so the two share a
//         side wall and the facade line continues along the contour (a row).
//       - uphill: front wall against the neighbour's back wall, so rows step
//         up the hill (sometimes leaving a narrow alley).
//       - downhill: the same, the other way (rarer).
//   • SEED candidates: right beside a connected path. This is the only way a
//     brand-new cluster can start, so houses never pop up in the middle of
//     nowhere.
// Every candidate must fit (occupancy grid), sit on zoned, reachable,
// non-cliff land, and is then scored:
//     low walking effort  +  touching many neighbours  +  a little randomness
// The best one is built. Touch-weighting is what fills gaps and makes the
// mass compact; effort-weighting makes the town spread out from the harbour.
//
// Densification: each step a few buildings gain a storey, up to a target that
// grows with closeness to the harbour (in effort) and local density, and is
// capped by the slope band (steep → small houses only).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, FACADE_COLOURS, SHUTTER_COLOURS, ROOF_COLOURS } from './config.js';
import { makeRng, clamp, smoothstep } from './noise.js';
import { BAND } from './terrain.js';
import { ZONE } from './zones.js';
import { PathNetwork } from './paths.js';
import { BuildingRenderer } from './buildings.js';

const B = CONFIG.building;
const OCC = 0.5;            // occupancy grid resolution (m)
const EMPTY = -1, PATH = -2;
const RASTER_INSET = 0.25;  // a building claims cells this far inside its walls
const FIT_INSET = 0.3;      // a new footprint is tested this far inside its walls

const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

export class Growth {
  constructor(game) {
    this.game = game;
    this.terrain = game.terrain;
    this.rng = makeRng(CONFIG.seed * 101 + 9);
    const t = this.terrain;
    this.occN = Math.round(t.size / OCC);
    this.occ = new Int32Array(this.occN * this.occN).fill(EMPTY);
    this.buildings = [];          // index = id; removed → null
    this.live = [];               // ids of existing buildings
    this.seedNodes = [];
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

  /** Visit every grid cell whose centre lies inside the (inset) footprint. */
  _forCells(b, inset, fn) {
    const t = this.terrain;
    const hw = b.w / 2 - inset, hd = b.d / 2 - inset;
    const R = Math.hypot(hw, hd);
    const i0 = Math.floor((b.x - R + t.half) / OCC), i1 = Math.floor((b.x + R + t.half) / OCC);
    const j0 = Math.floor((b.z - R + t.half) / OCC), j1 = Math.floor((b.z + R + t.half) / OCC);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * OCC - t.half - b.x, cz = (j + 0.5) * OCC - t.half - b.z;
      const lx = cx * b.rx + cz * b.rz, lz = cx * b.fx + cz * b.fz; // local coords
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) {
        if (i < 0 || j < 0 || i >= this.occN || j >= this.occN) { if (fn(-1) === false) return false; continue; }
        if (fn(j * this.occN + i) === false) return false;
      }
    }
    return true;
  }

  /** Mark the lanes so nothing is ever built on them. */
  _markPaths() {
    const net = this.game.paths;
    for (let k = 0; k < this.occ.length; k++) if (this.occ[k] === PATH) this.occ[k] = EMPTY;
    const stamp = (poly, r) => {
      for (const p of PathNetwork.resample(poly, 0.5)) {
        for (let dz = -r; dz <= r; dz += OCC) for (let dx = -r; dx <= r; dx += OCC) {
          if (dx * dx + dz * dz > r * r) continue;
          const k = this.occIndex(p.x + dx, p.z + dz);
          if (k < 0) continue;
          const o = this.occ[k];
          if (o >= 0) this._remove(o);   // a new lane cuts through a house
          this.occ[k] = PATH;
        }
      }
    };
    stamp(net.quay.points, 3.2);
    for (const p of net.paths) stamp(p.points, CONFIG.path.clearance);
  }

  _remove(id) {
    const b = this.buildings[id];
    if (!b) return;
    this._forCells(b, RASTER_INSET, (k) => { if (k >= 0 && this.occ[k] === id) this.occ[k] = EMPTY; });
    this.buildings[id] = null;
    this.live = this.live.filter((i) => i !== id);
    this.dirty = true;
  }

  // ---- Reacting to paths / zones ---------------------------------------------

  onAccessChanged() {
    const g = this.game;
    if (this._pathsSeen !== g.paths.version) { this._markPaths(); this._pathsSeen = g.paths.version; }
    // Path nodes that can start a new cluster: connected, with zoning nearby.
    const t = this.terrain, z = g.zones, a = g.access;
    this.seedNodes = [];
    g.paths.nodes.forEach((n, i) => {
      if (!isFinite(a.nodeEffort[i])) return;
      for (const [ox, oz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) {
        if (z.at(n.x + ox, n.z + oz)) { this.seedNodes.push(i); return; }
      }
    });
    this.dirty = true;
  }

  // ---- Candidate construction -----------------------------------------------

  /** Build a candidate record from centre, facing angle and size. */
  _make(x, z, theta, w, d) {
    const fx = Math.sin(theta), fz = Math.cos(theta);   // facade normal (downhill)
    return { x, z, theta, fx, fz, rx: fz, rz: -fx, w, d };
  }

  _sizeFor(band, kind) {
    const key = kind === ZONE.COM || band === BAND.FLAT ? 'flat' : band === BAND.STEEP ? 'steep' : 'moderate';
    const r = this.rng;
    // quantise widths a little so rows read as one consistent town
    const w = Math.round(r.range(...B.width[key]) * 2) / 2;
    const d = Math.round(r.range(...B.depth[key]) * 2) / 2;
    return { w, d, key };
  }

  /** Local facing angle at a point (facade looks downhill). */
  _localTheta(x, z) {
    const dir = this.terrain.downhillAt(x, z);
    return Math.atan2(dir.x, dir.z);
  }

  /**
   * Candidates next to building b on the given side, biggest first, then
   * shrinking — so a house squeezes into whatever gap is left ("shrink to
   * fit"). The caller builds the first variant that fits.
   */
  _attachVariants(b, side) {
    const r = this.rng, t = this.terrain;
    let { w, d } = this._sizeFor(t.bandAt(b.x, b.z), b.kind);
    if (r() < 0.65) d = b.d;                      // keep row depth consistent
    const out = [];
    if (side === 'left' || side === 'right') {
      const s = side === 'right' ? 1 : -1;
      // hinge = the shared FRONT corner, so the facade line continues
      const hx = b.x + s * b.rx * b.w / 2 + b.fx * b.d / 2;
      const hz = b.z + s * b.rz * b.w / 2 + b.fz * b.d / 2;
      const guess = this._localTheta(hx + s * b.rx * w / 2, hz + s * b.rz * w / 2);
      // follow the contour, but only gently, so a row stays a row
      const theta = b.theta + clamp(angleDiff(guess, b.theta) * 0.5, -0.09, 0.09);
      const setback = r() < 0.25 ? r.range(-0.5, 0.5) : 0;   // slightly irregular facade line
      for (const [ww, dd] of [[w, d], [w - 0.8, d], [r.range(3.0, 3.4), d], [3.0, Math.min(d, 5)]]) {
        if (ww < 2.9) continue;
        const c = this._make(0, 0, theta, ww, dd);
        c.x = hx + s * c.rx * (ww / 2 - 0.15) - c.fx * (dd / 2 + setback);
        c.z = hz + s * c.rz * (ww / 2 - 0.15) - c.fz * (dd / 2 + setback);
        out.push(c);
      }
      return out;
    }
    // uphill / downhill: back-to-back, so the rows step up the slope
    const s = side === 'up' ? -1 : 1;
    const gap = r() < B.alleyChance ? B.alleyWidth : -0.15;
    const guess = this._localTheta(b.x + s * b.fx * (b.d + d) / 2, b.z + s * b.fz * (b.d + d) / 2);
    const theta = b.theta + clamp(angleDiff(guess, b.theta) * 0.5, -0.07, 0.07);
    const lat0 = r() < 0.5 ? 0 : r.range(-0.3, 0.3) * b.w;
    for (const [lat, dd, ww] of [[lat0, d, w], [lat0 + 0.3 * b.w, d, w], [lat0 - 0.3 * b.w, d, w], [lat0, Math.max(4.5, d - 2), w], [lat0, 4.5, 3.2]]) {
      const c = this._make(0, 0, theta, ww, dd);
      const off = (b.d / 2 + dd / 2 + gap) * s;
      c.x = b.x + b.fx * off + b.rx * lat;
      c.z = b.z + b.fz * off + b.rz * lat;
      out.push(c);
    }
    return out;
  }

  /** The nearest building within radius (or null). */
  _nearest(x, z, radius) {
    let best = null, bd = radius;
    for (const id of this.live) {
      const o = this.buildings[id];
      const dd = Math.hypot(o.x - x, o.z - z);
      if (dd < bd) { bd = dd; best = o; }
    }
    return best;
  }

  /** Candidate beside a connected path node (starts a new cluster). */
  _seed() {
    const r = this.rng, t = this.terrain, g = this.game;
    if (!this.seedNodes.length) return null;
    const n = g.paths.nodes[r.pick(this.seedNodes)];
    let theta = this._localTheta(n.x, n.z);
    // line up with the neighbourhood, so separate clusters merge cleanly
    const near = this._nearest(n.x, n.z, 16);
    if (near && Math.abs(angleDiff(near.theta, theta)) < 0.6) theta = near.theta;
    const band = t.bandAt(n.x, n.z);
    const kind = g.zones.at(n.x, n.z) === ZONE.COM ? ZONE.COM : ZONE.RES;
    const { w, d } = this._sizeFor(band, kind);
    const c = this._make(n.x, n.z, theta, w, d);
    // put the house on one side of the lane: its back, front or a side to it
    const which = r.int(0, 3);
    const clear = CONFIG.path.clearance + 0.3;
    const [ax, az, ext] = [[c.rx, c.rz, w], [-c.rx, -c.rz, w], [c.fx, c.fz, d], [-c.fx, -c.fz, d]][which];
    c.x += ax * (clear + ext / 2);
    c.z += az * (clear + ext / 2);
    return c;
  }

  // ---- Validation & scoring ---------------------------------------------------

  /** Fill in ground heights, kind, band, effort; return false if it can't be built. */
  _evaluate(c) {
    const t = this.terrain, g = this.game;
    if (!t.inside(c.x, c.z, 4)) return false;
    // 1. occupancy
    const free = this._forCells(c, FIT_INSET, (k) => k >= 0 && this.occ[k] === EMPTY);
    if (!free) return false;
    // 2. land: zoned, reachable, not sea/cliff. Sample a 3x3 grid in the footprint.
    let zonedRes = 0, zonedCom = 0, bad = 0, steep = 0, flat = 0, effSum = 0, effN = 0;
    let gMin = Infinity, gMax = -Infinity;
    for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) {
      const x = c.x + c.rx * a * (c.w / 2 - 0.2) + c.fx * bb * (c.d / 2 - 0.2);
      const z = c.z + c.rz * a * (c.w / 2 - 0.2) + c.fz * bb * (c.d / 2 - 0.2);
      const idx = t.cellIndex(x, z);
      if (idx < 0) return false;
      const band = t.band[idx];
      if (band === BAND.SEA) return false;
      if (band === BAND.CLIFF) bad++;
      if (band === BAND.STEEP) steep++;
      if (band === BAND.FLAT) flat++;
      const zv = g.zones.grid[idx];
      if (zv === ZONE.RES) zonedRes++; else if (zv === ZONE.COM) zonedCom++;
      const e = g.access.cellEffort[idx];
      if (isFinite(e)) { effSum += e; effN++; }
      const h = t.heightAt(x, z);
      gMin = Math.min(gMin, h); gMax = Math.max(gMax, h);
    }
    if (bad > 1) return false;                      // (one corner on a rocky bit is ok)
    if (zonedRes + zonedCom < 7 || effN < 7) return false;
    if (gMin < 0.9) return false;                   // keep feet dry
    if (gMax - gMin > 9) return false;              // absurd stilts
    c.kind = zonedCom > zonedRes ? ZONE.COM : ZONE.RES;
    c.band = steep >= 4 ? BAND.STEEP : flat >= 5 ? BAND.FLAT : BAND.MODERATE;
    if (c.kind === ZONE.COM && c.band === BAND.STEEP) return false; // no shops on steep land
    if (c.band === BAND.STEEP && (c.w > B.width.steep[1] + 0.6 || c.d > B.depth.steep[1] + 0.6)) {
      // only small houses on steep ground: shrink towards the front wall
      const nw = Math.min(c.w, B.width.steep[1]), nd = Math.min(c.d, B.depth.steep[1]);
      c.x += c.fx * (c.d - nd) / 2; c.z += c.fz * (c.d - nd) / 2;
      c.w = nw; c.d = nd;
    }
    c.gMin = gMin; c.gMax = gMax;
    c.effort = effSum / effN;
    return true;
  }

  /** How many distinct buildings (and lanes) this footprint would touch. */
  _touches(c) {
    const ids = new Set();
    let lane = 0;
    const ring = 0.7;
    const sides = [[c.rx, c.rz, c.w / 2, c.fx, c.fz, c.d], [-c.rx, -c.rz, c.w / 2, c.fx, c.fz, c.d],
                   [c.fx, c.fz, c.d / 2, c.rx, c.rz, c.w], [-c.fx, -c.fz, c.d / 2, c.rx, c.rz, c.w]];
    for (const [nx, nz, e, tx, tz, L] of sides) {
      for (let u = -L / 2 + 0.5; u <= L / 2 - 0.5; u += 1) {
        const o = this.occAt(c.x + nx * (e + ring) + tx * u, c.z + nz * (e + ring) + tz * u);
        if (o >= 0) ids.add(o); else if (o === PATH) lane = 1;
      }
    }
    return { n: ids.size, lane };
  }

  _score(c, attached) {
    const E = CONFIG.effort;
    const touch = this._touches(c);
    c.touch = touch.n;
    let s = -c.effort / 22;                       // near the harbour first
    s += 1.35 * Math.min(touch.n, 4);             // compact: fill gaps, share walls
    s += 0.6 * touch.lane;                        // front onto a lane
    s += attached ? 0.4 : 0;
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
    this.buildings.push(b);
    this.live.push(id);
    this._forCells(b, RASTER_INSET, (k) => { if (k >= 0 && this.occ[k] === EMPTY) this.occ[k] = id; });
    this.dirty = true;
    return b;
  }

  /** Target storeys (above the uphill ground) for a building right now. */
  targetFloors(b) {
    const E = CONFIG.effort;
    let maxF = b.band === BAND.STEEP ? B.maxFloors.steep : b.band === BAND.FLAT ? B.maxFloors.flat : B.maxFloors.moderate;
    if (b.kind === ZONE.COM) maxF = Math.min(maxF, B.commercialMaxFloors);
    const core = Math.pow(1 - smoothstep(0, E.edgeEffort, b.effort), 0.8);   // 1 at the harbour
    const dens = clamp(this._neighbourCount(b, 11) / 7, 0, 1);
    const f = 1 + Math.round((maxF - 1) * core * (0.3 + 0.7 * dens)) + b.bonus;
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
    // --- new building ---
    let best = null, bestScore = -Infinity;
    const tries = CONFIG.sim.candidatesPerStep;
    const sides = ['left', 'right', 'left', 'right', 'up', 'up', 'down'];
    for (let k = 0; k < tries; k++) {
      let c, attached = false;
      if (this.live.length && k < tries * 0.75) {
        // pick a building that still has free sides (the growth "frontier")
        let b = null;
        for (let a = 0; a < 6; a++) { b = this.buildings[r.pick(this.live)]; if (b.fails < 30) break; }
        attached = true;
        c = this._attachVariants(b, r.pick(sides)).find((v) => this._evaluate(v));
        if (!c) { b.fails++; continue; }
      } else {
        c = this._seed();
        if (!c || !this._evaluate(c)) continue;
      }
      const s = this._score(c, attached);
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

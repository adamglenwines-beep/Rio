// ---------------------------------------------------------------------------
// infill.js — leftover spaces are never bare.
//
// After the town changes, the ground in and around it is rasterised on a 1 m
// grid: every cell is a house, a lane, harbour open space, sea, or free.
// Two distance fields (to the nearest house, to the nearest lane) tell us how
// much room each free cell has. Free cells near houses are grouped into
// connected PATCHES (big patches are cut into ~5 m plots), and each patch is
// classified by its size, width, slope and position:
//
//   sliver     narrow gaps        → planters, pots, a short dry-stone wall, steps
//   rocky      steep/cliff ground → rock outcrops, agave, prickly pear, wild plants
//   piazzetta  at forks / lanes   → paving, a bench, a fountain or wayside shrine
//   patch      everything else    → an orto, lemon/fig trees, a patio with a
//                                   pergola, a shed — or the odd umbrella pine
// and along house walls: flower pots, bougainvillea, cisterns, washing lines.
//
// Every item is checked exactly against lanes, the quay, piazza and slipway
// (never blocks a path) and against house walls. Choices are seeded from each
// patch's position so a patch keeps its look while the town grows around it.
//
// Rendering: everything is built from five primitive shapes (box, cylinder,
// cone, blob, flat tile), one InstancedMesh each, coloured per instance.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './noise.js';
import { BAND } from './terrain.js';
import { registerStyled } from './style.js';
import { gozzoHull } from './water.js';
import { harbourLayout } from './paths.js';

const FREE = 0, HOUSE = 1, LANE = 2, OPEN = 3, VOID = 4;
const C = (hex) => new THREE.Color(hex);
const COL = {
  terracotta: [C('#b5653f'), C('#a85a38'), C('#c27a52')],
  stone: [C('#a89c88'), C('#9a8f7d'), C('#b3a893'), C('#8f8576')],
  paving: [C('#c4bcae'), C('#b9b0a1'), C('#cfc7b8'), C('#bdb5a6')],
  soil: [C('#6f5238'), C('#7a5a3c'), C('#664b33')],
  leaf: [C('#3f6b2e'), C('#4c7a34'), C('#5a8a3a'), C('#467130')],
  lightLeaf: [C('#7a9a45'), C('#6f8f3c'), C('#86a64f')],
  flowers: [C('#d23c5a'), C('#e8e4d8'), C('#e9b13a'), C('#c2347f'), C('#8a5ac2')],
  bouga: [C('#c2347f'), C('#d44a9a'), C('#b52a73')],
  cloth: [C('#f2efe6'), C('#3a6ea5'), C('#d8463b'), C('#e9c34a'), C('#f2efe6'), C('#9bc1d8')],
  rock: [C('#8e8272'), C('#7f7466'), C('#9a8e7c'), C('#857a6a')],
  agave: [C('#6f8f7a'), C('#7d9c86')],
  cactus: [C('#5f8a3a'), C('#6a9442')],
  wood: [C('#6b4a33'), C('#7a5a3e')],
  white: C('#efe9dc'), water: C('#4f9fc4'), lemon: C('#f2d43a'), dark: C('#3a3a3a'),
  slate: C('#6e6b69'), pine: C('#3f6b34'), trunk: C('#6b5040'),
};

export class Infill {
  constructor(game) {
    this.game = game;
    this.terrain = game.terrain;
    this.group = new THREE.Group();
    this.group.name = 'infill';
    this.count = 0;
    this.grid = null;      // the published grid (what's on screen)
    this.wg = null;        // the grid being worked on
    this.job = null;
    const mat = registerStyled(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true }), 'foliage');
    this.blobGeos = { faceted: new THREE.IcosahedronGeometry(1, 0), round: new THREE.IcosahedronGeometry(1, 2) };
    const geos = {
      box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
      cone: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0),
      blob: this.blobGeos.faceted,
      boat: gozzoHull().translate(0, 0.28, 0),
    };
    this.kinds = {};
    for (const [k, geo] of Object.entries(geos)) this.kinds[k] = { geo, mat, mesh: null, cap: 0, shadow: k !== 'box' || true };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  /** Art style: faceted or round foliage and rocks. */
  setStyle(style) {
    const K = this.kinds.blob;
    K.geo = style.roundFoliage ? this.blobGeos.round : this.blobGeos.faceted;
    if (K.mesh) K.mesh.geometry = K.geo;
  }

  /** Is (x, z) covered by a decoration (used by scenery and the gap metric)? */
  claimedAt(x, z) {
    const g = this.grid;
    if (!g) return false;
    const i = Math.floor(x - g.x0), j = Math.floor(z - g.z0);
    if (i < 0 || j < 0 || i >= g.W || j >= g.H) return false;
    return g.claimed[j * g.W + i] >= 1;
  }

  // ---- primitives --------------------------------------------------------------

  /** Queue one primitive: kind, position (base), scale, rotation (yaw, tiltX, tiltZ), colour. */
  _put(kind, x, y, z, sx, sy, sz, col, yaw = 0, tx = 0, tz = 0) {
    const L = this.lists[kind];
    if (tx === 0 && tz === 0) {
      // fast path: translate · rotateY(yaw) · scale, column-major
      const c = Math.cos(yaw), s = Math.sin(yaw);
      L.m.push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1);
    } else {
      this._e.set(tx, yaw, tz);
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(x, y, z), this._q, this._s.set(sx, sy, sz));
      const e = this._m.elements;
      L.m.push(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14], e[15]);
    }
    L.c.push(col.r, col.g, col.b);
  }

  _flush() {
    let total = 0;
    for (const [k, K] of Object.entries(this.kinds)) {
      const L = this.lists[k], n = L.c.length / 3;
      total += n;
      if (!K.mesh || K.cap < n) {
        if (K.mesh) { this.group.remove(K.mesh); K.mesh.dispose(); }
        K.cap = Math.max(256, Math.ceil(n * 1.5));
        K.mesh = new THREE.InstancedMesh(K.geo, K.mat, K.cap);
        K.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(K.cap * 3), 3);
        K.mesh.castShadow = k !== 'box';
        K.mesh.receiveShadow = true;
        K.mesh.frustumCulled = false;
        this.group.add(K.mesh);
      }
      K.mesh.instanceMatrix.array.set(L.m);
      K.mesh.instanceColor.array.set(L.c);
      K.mesh.count = n;
      K.mesh.instanceMatrix.needsUpdate = true;
      K.mesh.instanceColor.needsUpdate = true;
    }
    this.count = total;
    this.version = (this.version || 0) + 1;
  }

  // ---- the grid ------------------------------------------------------------------

  _buildGrid() {
    const g = this.game, G = g.growth, t = this.terrain, lanes = G.lanes;
    const live = G.live.map((id) => G.buildings[id]);
    if (!live.length) return null;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of live) for (const p of b.corners) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const M = CONFIG.infill.townRadius + 2;
    x0 = Math.max(Math.floor(x0 - M), -t.half + 1); z0 = Math.max(Math.floor(z0 - M), -t.half + 1);
    x1 = Math.min(Math.ceil(x1 + M), t.half - 1); z1 = Math.min(Math.ceil(z1 + M), t.half - 1);
    const W = x1 - x0, H = z1 - z0, N = W * H;
    const kind = new Uint8Array(N), laneOf = new Int16Array(N).fill(-1);
    const band = new Uint8Array(N);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = x0 + i + 0.5, z = z0 + j + 0.5;
      const ci = t.cellIndex(x, z);
      band[k] = ci < 0 ? BAND.SEA : t.band[ci];
      if (band[k] === BAND.SEA) { const h = t.heightAt(x, z); if (h < 0.35) { kind[k] = VOID; continue; } }
      // the four 0.5 m occupancy cells under this 1 m cell (the grids are aligned)
      const oi = (x0 + i + t.half) * 2, oj = (z0 + j + t.half) * 2, on = G.occN, occ = G.occ;
      if (occ[oj * on + oi] >= 0 || occ[oj * on + oi + 1] >= 0 || occ[(oj + 1) * on + oi] >= 0 || occ[(oj + 1) * on + oi + 1] >= 0) kind[k] = HOUSE;
    }
    // lanes and harbour open space: cells whose centre is inside a clearance capsule
    for (const c of lanes.capsules) {
      const r = c.r;
      const ia = Math.max(0, Math.floor(Math.min(c.a[0], c.b[0]) - r - x0)), ib = Math.min(W - 1, Math.ceil(Math.max(c.a[0], c.b[0]) + r - x0));
      const ja = Math.max(0, Math.floor(Math.min(c.a[1], c.b[1]) - r - z0)), jb = Math.min(H - 1, Math.ceil(Math.max(c.a[1], c.b[1]) + r - z0));
      const dx = c.b[0] - c.a[0], dz = c.b[1] - c.a[1], L2 = dx * dx + dz * dz;
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const px = x0 + i + 0.5, pz = z0 + j + 0.5;
        let u = L2 ? ((px - c.a[0]) * dx + (pz - c.a[1]) * dz) / L2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        if (Math.hypot(px - c.a[0] - u * dx, pz - c.a[1] - u * dz) > r) continue;
        const k = j * W + i;
        if (kind[k] === HOUSE && !(G.buildings[G.occAt(px, pz)] || {}).arch) continue;
        if (c.lane >= 0) { if (kind[k] !== OPEN) { kind[k] = LANE; laneOf[k] = c.lane; } }
        else kind[k] = OPEN;
      }
    }
    const isHouse = (k) => kind[k] === HOUSE, isLane = (k) => kind[k] === LANE || kind[k] === OPEN;
    const dB = chamfer(W, H, isHouse, null), dLres = chamfer(W, H, isLane, laneOf);
    return { x0, z0, W, H, N, kind, laneOf, band, dB, dL: dLres, nearLane: dLres.label, claimed: new Uint8Array(N) };
  }

  // ---- patches -------------------------------------------------------------------

  _patches(g) {
    const I = CONFIG.infill, { W, H, kind, dB } = g;
    const inTown = (k) => kind[k] === FREE && dB[k] <= I.townRadius;
    const seen = new Uint8Array(g.N), out = [];
    const stack = [];
    for (let k0 = 0; k0 < g.N; k0++) {
      if (seen[k0] || !inTown(k0)) continue;
      const cells = [];
      stack.push(k0); seen[k0] = 1;
      while (stack.length) {
        const k = stack.pop(); cells.push(k);
        const i = k % W, j = (k / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const kk = jj * W + ii;
          if (!seen[kk] && inTown(kk)) { seen[kk] = 1; stack.push(kk); }
        }
      }
      if (cells.length <= I.plotSize * I.plotSize * 1.3) { out.push(cells); continue; }
      // big patch: cut into ~5 m plots on a world-aligned grid (stable as the town grows)
      const plots = new Map();
      for (const k of cells) {
        const key = Math.floor((g.x0 + (k % W)) / I.plotSize) + ',' + Math.floor((g.z0 + ((k / W) | 0)) / I.plotSize);
        if (!plots.has(key)) plots.set(key, []);
        plots.get(key).push(k);
      }
      for (const p of plots.values()) out.push(p);
    }
    return out;
  }

  _describe(g, cells) {
    const { W, dB, dL, band, nearLane } = g;
    const P = { cells, n: cells.length, maxClear: 0, best: cells[0], laneCells: 0, wallCells: [], lanes: new Set(), rocky: 0, fork: false };
    let sx = 0, sz = 0, minK = Infinity;
    for (const k of cells) {
      const clear = Math.min(dB[k], dL[k]);
      if (clear > P.maxClear) { P.maxClear = clear; P.best = k; }
      if (dL[k] <= 1.6) { P.laneCells++; if (nearLane[k] >= 0) P.lanes.add(nearLane[k]); }
      if (dB[k] <= 1.6) P.wallCells.push(k);
      if (band[k] === BAND.STEEP || band[k] === BAND.CLIFF) P.rocky++;
      sx += k % W; sz += (k / W) | 0;
      minK = Math.min(minK, k);
    }
    P.rocky /= P.n;
    P.cx = g.x0 + sx / P.n + 0.5; P.cz = g.z0 + sz / P.n + 0.5;
    // the seed comes from the patch's world position, so its look is stable
    const sk = P.best;
    P.seed = ((g.x0 + (sk % W)) * 73856093) ^ ((g.z0 + ((sk / W) | 0)) * 19349663);
    for (const f of this.game.growth.lanes.forks || []) {
      if (Math.hypot(f.p[0] - P.cx, f.p[1] - P.cz) < Math.max(4, Math.sqrt(P.n))) P.fork = true;
    }
    return P;
  }

  _classify(P, rng) {
    if (P.n < 3) return 'sliver';
    if (P.rocky > 0.55) return 'rocky';
    if (P.maxClear < 1.45) return 'sliver';
    if ((P.fork || P.lanes.size >= 2) && P.laneCells >= 3 && P.maxClear >= 1.5) return 'piazzetta';
    if (P.n <= 12) return rng.weighted([['patio', 3], ['tree', 3], ['orto', 2], ['shed', 1]]);
    const opts = [['orto', 4], ['orchard', 3], ['patio', 2]];
    if (P.laneCells >= 6) opts.push(['piazzetta', 1]);
    if (P.maxClear >= 3.2) opts.push(['pine', 1]);
    if (P.rocky > 0.3) opts.push(['rocky', 2]);
    return rng.weighted(opts);
  }

  // ---- placement helpers -------------------------------------------------------

  _xz(g, k) { return [g.x0 + (k % g.W) + 0.5, g.z0 + ((k / g.W) | 0) + 0.5]; }

  /** Exact check: an item of radius r at (x, z) blocks no path and touches no wall. */
  _fits(x, z, r) {
    const G = this.game.growth, g = this.wg;
    const sq = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
    for (const [px, pz] of [[x, z], ...sq]) if (G.occAt(px, pz) !== -1) return false;
    // the exact lane test is only needed close to a lane (the distance field says how close)
    const ci = Math.floor(x - g.x0), cj = Math.floor(z - g.z0);
    const near = ci < 0 || cj < 0 || ci >= g.W || cj >= g.H || g.dL[cj * g.W + ci] < r * 1.5 + 1.6;
    if (near && !G.lanes.clearOf(sq)) return false;
    // not on someone else's decoration
    const i0 = Math.floor(x - r - g.x0), i1 = Math.floor(x + r - g.x0), j0 = Math.floor(z - r - g.z0), j1 = Math.floor(z + r - g.z0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= g.W || j >= g.H) return false;
      if (g.claimed[j * g.W + i] === 2) return false;
    }
    return true;
  }

  /** Mark the cells under an item as covered (1) or solid (2: no other item may overlap). */
  _claim(x, z, r, solid = true) {
    const g = this.wg, R = r + CONFIG.infill.coverRadius;   // an item also "covers" the ground around it
    const i0 = Math.floor(x - R - g.x0), i1 = Math.floor(x + R - g.x0), j0 = Math.floor(z - R - g.z0), j1 = Math.floor(z + R - g.z0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= g.W || j >= g.H) continue;
      const k = j * g.W + i;
      const d = Math.hypot(g.x0 + i + 0.5 - x, g.z0 + j + 0.5 - z);
      if (solid && d <= r + 0.5) g.claimed[k] = 2;
      else if (d <= R && g.claimed[k] === 0) g.claimed[k] = 1;
    }
  }

  /** Ground cover: tufts, shrubs and flowers (or rocks, or pots) on any still-bare cell of a patch. */
  _cover(g, P, type, rng) {
    for (const k of P.cells) {
      if (g.claimed[k] !== 0) continue;
      const [x0, z0] = this._xz(g, k);
      let x = x0 + rng.range(-0.3, 0.3), z = z0 + rng.range(-0.3, 0.3);
      if (!this._fits(x, z, 0.25)) {
        // right beside a lane: try a little further from it
        const d = this._towardLane(g, k);
        if (!d) continue;
        x = x0 - d[0] * 0.4; z = z0 - d[1] * 0.4;
        if (!this._fits(x, z, 0.22)) continue;
      }
      const r = rng();
      if (type === 'rocky') { if (r < 0.15) this._rock(x, z, rng); else if (r < 0.3) this._agave(x, z, rng); else if (r < 0.55) this._shrub(x, z, rng); else this._wild(x, z, rng); }
      else if (type === 'piazzetta' || type === 'patio') this._pot(x, z, rng);
      else if (r < 0.15) this._pot(x, z, rng);
      else if (r < 0.35) this._shrub(x, z, rng);
      else this._wild(x, z, rng);
      this._claim(x, z, 0.25);
    }
  }

  _shrub(x, z, rng) {
    if (!CONFIG.flora.trees) return;   // trees and bushes are off for now (see config)
    const y = this._h(x, z), s = rng.range(0.7, 1.2);
    this._put('blob', x, y + 0.3 * s, z, 0.55 * s, 0.45 * s, 0.5 * s, rng.pick(COL.leaf), rng() * 6);
    if (rng() < 0.4) for (let k = 0; k < 3; k++) this._put('blob', x + rng.range(-0.35, 0.35) * s, y + rng.range(0.4, 0.7) * s, z + rng.range(-0.35, 0.35) * s, 0.08, 0.08, 0.08, rng.pick(COL.flowers));
  }

  _h(x, z) { return this.terrain.heightAt(x, z); }

  /** A flat 1 m tile on cell k that meets the slope (its top sits on the highest corner). */
  _tile(g, k, col, lift = 0.06) {
    const [x, z] = this._xz(g, k), t = this.terrain;
    const hs = [t.heightAt(x - 0.5, z - 0.5), t.heightAt(x + 0.5, z - 0.5), t.heightAt(x - 0.5, z + 0.5), t.heightAt(x + 0.5, z + 0.5)];
    const lo = Math.min(...hs), hi = Math.max(...hs);
    this._put('box', x, lo - 0.1, z, 1.0, hi - lo + 0.1 + lift, 1.0, col);
    if (g.claimed[k] === 0) g.claimed[k] = 1;
    return hi + lift;
  }

  // ---- decorations ---------------------------------------------------------------

  _pot(x, z, rng) {
    const y = this._h(x, z) - 0.04, s = rng.range(0.8, 1.25);
    this._put('cyl', x, y, z, 0.2 * s, 0.32 * s, 0.2 * s, rng.pick(COL.terracotta));
    this._put('blob', x, y + 0.42 * s, z, 0.24 * s, 0.2 * s, 0.24 * s, rng.pick(COL.leaf));
    if (rng() < 0.7) this._put('blob', x + 0.06, y + 0.52 * s, z, 0.1, 0.08, 0.1, rng.pick(COL.flowers));
  }

  _planter(x, z, yaw, len, rng) {
    const y = this._h(x, z) - 0.05;
    this._put('box', x, y, z, len, 0.42, 0.42, rng.pick(COL.terracotta), yaw);
    this._put('box', x, y + 0.42, z, len - 0.08, 0.16, 0.32, rng.pick(COL.leaf), yaw);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let u = -len / 2 + 0.25; u < len / 2; u += 0.4) {
      if (rng() < 0.6) this._put('blob', x + c * u, y + 0.6, z - s * u, 0.1, 0.09, 0.1, rng.pick(COL.flowers));
    }
  }

  _lowWall(x, z, yaw, len, rng) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ha = this._h(x - c * len / 2, z + s * len / 2), hb = this._h(x + c * len / 2, z - s * len / 2);
    const lo = Math.min(ha, hb, this._h(x, z)), hi = Math.max(ha, hb, this._h(x, z));
    this._put('box', x, lo - 0.3, z, len, hi - lo + 0.95, 0.42, rng.pick(COL.stone), yaw);
    this._put('box', x, hi + 0.62, z, len + 0.05, 0.08, 0.48, rng.pick(COL.stone).clone().multiplyScalar(1.08), yaw);
    if (rng() < 0.5 && CONFIG.flora.trees) this._put('blob', x + c * len * 0.3, hi + 0.7, z - s * len * 0.3, 0.3, 0.18, 0.25, rng.pick(COL.lightLeaf));
  }

  _steps(x, z, rng) {
    const d = this.terrain.downhillAt(x, z), up = [-d.x, -d.z], yaw = Math.atan2(d.x, d.z);
    const col = rng.pick(COL.stone);
    for (let k = 0; k < 3; k++) {
      const px = x + up[0] * (k - 1) * 0.45, pz = z + up[1] * (k - 1) * 0.45;
      const y = this._h(px, pz);
      this._put('box', px, y - 0.3, pz, 1.0, 0.42, 0.45, col, yaw);
    }
  }

  _lemon(x, z, rng, fig = false) {
    if (!CONFIG.flora.trees) return;
    const y = this._h(x, z), s = rng.range(0.85, 1.2);
    this._put('cyl', x, y - 0.1, z, 0.1 * s, 1.3 * s, 0.1 * s, COL.trunk);
    if (fig) {
      this._put('blob', x, y + 1.7 * s, z, 1.45 * s, 0.85 * s, 1.35 * s, rng.pick(COL.lightLeaf), rng() * 6);
    } else {
      this._put('blob', x, y + 1.75 * s, z, 1.0 * s, 0.95 * s, 1.0 * s, rng.pick(COL.leaf), rng() * 6);
      for (let k = 0; k < 6; k++) {
        const a = rng() * 6.28, r = rng.range(0.5, 0.85) * s;
        this._put('blob', x + Math.cos(a) * r, y + rng.range(1.3, 2.3) * s, z + Math.sin(a) * r, 0.09, 0.11, 0.09, COL.lemon);
      }
    }
  }

  _pine(x, z, rng) {
    if (!CONFIG.flora.trees) return;
    const y = this._h(x, z), s = rng.range(0.9, 1.2);
    this._put('cyl', x, y - 0.2, z, 0.22 * s, 6 * s, 0.22 * s, COL.trunk, 0, rng.range(-0.08, 0.08));
    this._put('blob', x, y + 6 * s, z, 3.2 * s, 1.1 * s, 3.0 * s, COL.pine, rng() * 6);
  }

  _agave(x, z, rng) {
    const y = this._h(x, z) - 0.05, s = rng.range(0.7, 1.2), col = rng.pick(COL.agave);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * 6.28 + rng() * 0.3;
      this._put('cone', x, y, z, 0.11 * s, 0.95 * s, 0.11 * s, col, a, rng.range(0.55, 0.95), 0);
    }
    this._put('cone', x, y, z, 0.12 * s, 0.8 * s, 0.12 * s, col);
  }

  _prickly(x, z, rng) {
    const y = this._h(x, z), col = rng.pick(COL.cactus);
    let px = x, py = y + 0.3, pz = z;
    for (let k = 0; k < 5; k++) {
      const yaw = rng() * 6.28;
      this._put('blob', px, py, pz, 0.32, 0.38, 0.09, col, yaw, 0, rng.range(-0.5, 0.5));
      if (rng() < 0.5) this._put('blob', px + 0.15, py + 0.35, pz, 0.06, 0.07, 0.06, rng() < 0.5 ? COL.flowers[2] : COL.flowers[0]);
      px += rng.range(-0.3, 0.3); pz += rng.range(-0.3, 0.3); py += rng.range(0.15, 0.45);
    }
  }

  _rock(x, z, rng) {
    const y = this._h(x, z), s = rng.range(0.5, 1.2);
    this._put('blob', x, y + 0.1 * s, z, 0.8 * s, 0.5 * s, 0.65 * s, rng.pick(COL.rock), rng() * 6, rng.range(-0.3, 0.3));
  }

  _wild(x, z, rng) {
    if (!CONFIG.flora.trees) return;
    const y = this._h(x, z);
    this._put('blob', x, y + 0.12, z, 0.35, 0.25, 0.35, rng.pick(COL.lightLeaf), rng() * 6);
    if (rng() < 0.5) this._put('blob', x, y + 0.3, z, 0.08, 0.08, 0.08, rng.pick(COL.flowers));
  }

  _shed(x, z, yaw, rng) {
    const y = this._h(x, z);
    const col = rng() < 0.5 ? rng.pick(COL.stone) : C('#e6d6b8');
    this._put('box', x, y - 0.4, z, 1.7, 2.2, 1.4, col, yaw);
    this._put('box', x, y + 1.8, z, 1.95, 0.12, 1.65, COL.slate, yaw, 0.12);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._put('box', x + s * 0.71, y, z + c * 0.71, 0.7, 1.4, 0.05, rng.pick(COL.wood), yaw);
  }

  _cistern(x, z, rng) {
    const y = this._h(x, z);
    this._put('cyl', x, y - 0.3, z, 0.7, 1.3, 0.7, rng.pick(COL.stone));
    this._put('cyl', x, y + 1.0, z, 0.74, 0.1, 0.74, COL.white);
  }

  _washing(x, z, dir, rng) {
    // a line along a wall: two posts, the line, and laundry
    const len = rng.range(2.4, 3.4), y = this._h(x, z);
    const ax = x - dir[0] * len / 2, az = z - dir[1] * len / 2, bx = x + dir[0] * len / 2, bz = z + dir[1] * len / 2;
    const yaw = Math.atan2(dir[1], -dir[0]) + Math.PI / 2;
    for (const [px, pz] of [[ax, az], [bx, bz]]) this._put('box', px, this._h(px, pz) - 0.2, pz, 0.07, 2.3, 0.07, rng.pick(COL.wood));
    this._put('box', x, y + 1.98, z, len, 0.02, 0.02, COL.dark, yaw);
    for (let u = -len / 2 + 0.35; u < len / 2 - 0.2; u += rng.range(0.4, 0.6)) {
      const cx = x + dir[0] * u, cz = z + dir[1] * u, h = rng.range(0.4, 0.75);
      this._put('box', cx, y + 1.98 - h, cz, rng.range(0.3, 0.5), h, 0.03, rng.pick(COL.cloth), yaw);
    }
  }

  /** Distance (m) from (x, z) to the nearest house or lane, from the last finished plan; Infinity outside it. */
  townDistance(x, z) {
    const g = this.grid;
    if (!g) return Infinity;
    const i = Math.floor(x - g.x0), j = Math.floor(z - g.z0);
    if (i < 0 || j < 0 || i >= g.W || j >= g.H) return Infinity;
    return Math.min(g.dB[j * g.W + i], g.dL[j * g.W + i]);
  }

  // ---- the two quarters: fishing gear by the harbour, farm gear up the hill -------------

  /** Which quarter a spot belongs to: 'fishing' by the harbour, 'farming' higher up, or null. */
  quarterAt(x, z) {
    const t = this.terrain, h = t.harbour, I = CONFIG.infill, y = t.heightAt(x, z);
    if (Math.hypot(x - h.x, z - h.z) < I.fishingRadius && y < I.fishingMaxHeight) return 'fishing';
    if (y > I.farmingMinHeight) return 'farming';
    return null;
  }

  /** A boat hauled out and chocked up, some under a canvas cover. */
  _boat(x, z, yaw, rng) {
    const y = this._h(x, z) + 0.12, c = Math.cos(yaw), s = Math.sin(yaw);
    const hull = rng.weighted([[C('#f2efe6'), 6], [C('#3f7fc4'), 2], [C('#5ab0d8'), 1.5], [C('#d64a3b'), 0.7], [C('#3b9c6b'), 0.5], [C('#e8c14a'), 0.4]]);
    this._put('boat', x, y, z, 1, 1, 1, hull, yaw, 0, (rng() - 0.5) * 0.16);
    for (const u of [-0.9, 0.9]) this._put('box', x + s * u, y - 0.14, z + c * u, 0.9, 0.16, 0.14, rng.pick(COL.wood), yaw);   // chocks
    if (rng() < 0.45) this._put('box', x, y + 0.5, z, 1.0, 0.07, 2.6, rng() < 0.6 ? C('#3f6fb0') : C('#e9e4d6'), yaw);      // canvas cover
    else this._put('box', x, y + 0.36, z, 0.9, 0.05, 2.2, C('#c9a77a'), yaw);                                              // thwarts and boards
  }

  /** Nets heaped to dry, with a few floats. */
  _nets(x, z, rng) {
    const y = this._h(x, z);
    this._put('blob', x, y + 0.1, z, 0.75, 0.22, 0.6, rng.pick([C('#c9c2ad'), C('#b8ad8f'), C('#a89a78')]), rng() * 6);
    for (let i = 0, n = rng.int(2, 4); i < n; i++) this._put('blob', x + rng.range(-0.5, 0.5), y + 0.24, z + rng.range(-0.4, 0.4), 0.09, 0.09, 0.09, rng() < 0.75 ? C('#e8502a') : C('#f2efe6'));
  }

  /** Nets hung to dry on a rail between two posts. */
  _netRack(x, z, dir, rng) {
    const len = rng.range(1.8, 2.6), y = this._h(x, z), yaw = Math.atan2(dir[1], -dir[0]) + Math.PI / 2;
    for (const u of [-len / 2, len / 2]) { const px = x + dir[0] * u, pz = z + dir[1] * u; this._put('box', px, this._h(px, pz) - 0.2, pz, 0.07, 1.75, 0.07, rng.pick(COL.wood)); }
    this._put('box', x, y + 1.5, z, len, 0.05, 0.05, rng.pick(COL.wood), yaw);
    this._put('box', x, y + 0.45, z, len - 0.15, 1.05, 0.04, rng.pick([C('#b8ad8f'), C('#9aa38a'), C('#a89a78')]), yaw);
    this._put('blob', x + dir[0] * 0.3, y + 0.35, z + dir[1] * 0.3, 0.1, 0.1, 0.1, C('#e8502a'));
  }

  _crates(x, z, rng) {
    const y = this._h(x, z);
    this._put('box', x, y, z, 0.6, 0.32, 0.42, rng.pick(COL.wood), rng() * 3);
    if (rng() < 0.6) this._put('box', x + 0.05, y + 0.32, z, 0.55, 0.3, 0.4, rng.pick(COL.wood), rng() * 3);
    if (rng() < 0.5) this._put('cyl', x + 0.55, y + 0.3, z + 0.1, 0.3, 0.08, 0.3, C('#e8703a'), 0, 1.3);   // a lifebuoy leaning
  }

  /** Wine barrels: one or two standing, sometimes one on its side. */
  _barrels(x, z, rng) {
    const y = this._h(x, z), oak = () => rng.pick([C('#7a6a55'), C('#6e5f4e'), C('#8a7a64')]);
    this._put('cyl', x, y, z, 0.36, 0.9, 0.36, oak());
    for (const hy of [0.18, 0.7]) this._put('cyl', x, y + hy, z, 0.375, 0.05, 0.375, COL.dark);
    if (rng() < 0.55) { this._put('cyl', x + 0.8, y, z + 0.1, 0.33, 0.82, 0.33, oak()); this._put('cyl', x + 0.8, y + 0.4, z + 0.1, 0.345, 0.05, 0.345, COL.dark); }
    if (rng() < 0.4) this._put('blob', x - 0.55, y + 0.24, z + 0.3, 0.24, 0.26, 0.24, C('#4f7a4a'));   // a demijohn
  }

  /** A bundle of vine stakes and a hoe or two leaning on the wall behind (direction d). */
  _stakes(x, z, d, rng) {
    const y = this._h(x, z), yaw = Math.atan2(d[0], d[1]);
    for (let i = 0, n = rng.int(4, 7); i < n; i++) {
      const u = (i - n / 2) * 0.09 + rng.range(-0.03, 0.03);
      this._put('box', x + d[1] * u - d[0] * 0.15, y - 0.05, z - d[0] * u - d[1] * 0.15, 0.05, rng.range(1.5, 2.0), 0.05, rng.pick([C('#a39d90'), C('#8f8676'), C('#b3ab9c')]), yaw, -0.2, 0);
    }
    this._put('box', x + d[1] * 0.5 - d[0] * 0.15, y - 0.05, z - d[0] * 0.5 - d[1] * 0.15, 0.04, 1.5, 0.04, rng.pick(COL.wood), yaw, -0.25, 0);
    this._put('box', x + d[1] * 0.5 + d[0] * 0.2, y + 1.36, z - d[0] * 0.5 + d[1] * 0.2, 0.2, 0.04, 0.1, COL.dark, yaw);
  }

  _baskets(x, z, rng) {
    const y = this._h(x, z);
    for (let i = 0, n = rng.int(1, 3); i < n; i++) {
      const px = x + rng.range(-0.4, 0.4), pz = z + rng.range(-0.3, 0.3);
      this._put('cyl', px, y, pz, 0.26, 0.3, 0.26, rng.pick([C('#b89a66'), C('#a88a58')]));
      if (rng() < 0.6) this._put('blob', px, y + 0.3, pz, 0.22, 0.1, 0.22, rng.pick([C('#5a2f5a'), C('#7a9a45'), C('#e2c93a')]));   // grapes, leaves, lemons
    }
  }

  /** Café tables with parasols on the harbour piazza (kept off the lane through its middle). */
  _cafe() {
    const t = this.terrain, lay = harbourLayout(t), rng = makeRng(t.seed * 17 + 5), G = this.game.growth;
    const spots = [[-3.3, -2.0], [3.3, -2.0], [-3.5, 1.2], [3.5, 1.2], [-1.6, -3.6], [1.9, -3.5]];
    const cream = [C('#ece6d6'), C('#ece6d6'), C('#c9a593'), C('#e6cf8a')];
    for (const [ox, oz] of spots) {
      const x = lay.x + ox, z = lay.piazzaZ + oz;
      if (G.occAt(x, z) >= 0 || t.heightAt(x, z) < 0.6) continue;
      if (Math.abs(ox) < 1.6 && Math.abs(x - t.ravineX(z)) < 1.4) continue;   // the main street
      const y = t.heightAt(x, z) + 0.05;
      this._put('cyl', x, y, z, 0.05, 0.72, 0.05, COL.dark);
      this._put('cyl', x, y + 0.72, z, 0.42, 0.04, 0.42, COL.white);
      for (let c = 0, n = rng.int(2, 4); c < n; c++) {
        const a = c / n * 6.28 + rng() * 0.5, cx = x + Math.cos(a) * 0.72, cz = z + Math.sin(a) * 0.72;
        this._put('box', cx, y, cz, 0.36, 0.44, 0.36, rng.pick(COL.wood), a);
        this._put('box', cx + Math.cos(a) * 0.16, y + 0.44, cz + Math.sin(a) * 0.16, 0.05, 0.42, 0.36, rng.pick(COL.wood), a + Math.PI / 2);
      }
      this._put('cyl', x + 0.15, y, z + 0.15, 0.035, 2.3, 0.035, COL.dark);
      this._put('cone', x + 0.15, y + 2.05, z + 0.15, 1.5, 0.5, 1.5, rng.pick(cream), rng() * 6);
    }
  }

  _bench(x, z, yaw, rng) {
    const y = this._h(x, z), col = rng() < 0.5 ? rng.pick(COL.stone) : rng.pick(COL.wood);
    this._put('box', x, y + 0.38, z, 1.4, 0.08, 0.42, col, yaw);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const u of [-0.55, 0.55]) this._put('box', x + c * u, y - 0.1, z - s * u, 0.1, 0.5, 0.4, col, yaw);
    this._put('box', x - s * 0.2, y + 0.45, z - c * 0.2, 1.4, 0.4, 0.07, col, yaw);
  }

  _fountain(x, z, y, rng) {
    const st = rng.pick(COL.stone);
    this._put('cyl', x, y - 0.1, z, 0.95, 0.6, 0.95, st);
    this._put('cyl', x, y + 0.45, z, 0.82, 0.04, 0.82, COL.water);
    this._put('cyl', x, y + 0.4, z, 0.14, 1.0, 0.14, st);
    this._put('blob', x, y + 1.45, z, 0.25, 0.2, 0.25, st);
  }

  _shrine(x, z, y, yaw, rng) {
    const st = rng() < 0.5 ? rng.pick(COL.stone) : C('#e8dcc4');
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._put('box', x, y - 0.1, z, 0.6, 1.9, 0.45, st, yaw);
    this._put('box', x + s * 0.2, y + 0.9, z + c * 0.2, 0.42, 0.55, 0.1, COL.white, yaw);
    this._put('box', x + s * 0.25, y + 1.0, z + c * 0.25, 0.18, 0.3, 0.04, C('#3a6ea5'), yaw);
    this._put('box', x, y + 1.8, z, 0.75, 0.1, 0.6, COL.slate, yaw);
    this._put('blob', x + s * 0.35, y + 0.15, z + c * 0.35, 0.18, 0.15, 0.18, rng.pick(COL.flowers));
  }

  _bouga(g, k, rng) {
    // walk from the cell to the nearest wall, and grow up it
    const [x, z] = this._xz(g, k), G = this.game.growth;
    const dir = this._towardWall(g, k);
    if (!dir) return false;
    let wx = x, wz = z, hit = false;
    for (let s = 0; s < 1.8; s += 0.1) {
      if (G.occAt(x + dir[0] * s, z + dir[1] * s) >= 0) { wx = x + dir[0] * (s - 0.25); wz = z + dir[1] * (s - 0.25); hit = true; break; }
    }
    if (!hit) return false;
    const y = this._h(wx, wz), yaw = Math.atan2(dir[0], dir[1]);
    this._put('blob', wx, y + 0.3, wz, 0.45, 0.4, 0.3, rng.pick(COL.leaf), yaw);
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const u = rng.range(-0.7, 0.7);
      this._put('blob', wx + dir[1] * u, y + 0.8 + i * rng.range(0.55, 0.8), wz - dir[0] * u, rng.range(0.4, 0.7), rng.range(0.35, 0.5), 0.22, rng.pick(COL.bouga), yaw);
    }
    return true;
  }

  /** Unit vector from cell k toward the nearest house wall (down the distance field). */
  _towardWall(g, k) {
    const { W, H, dB } = g, i = k % W, j = (k / W) | 0;
    const at = (ii, jj) => (ii < 0 || jj < 0 || ii >= W || jj >= H) ? dB[k] : dB[jj * W + ii];
    const gx = at(i + 1, j) - at(i - 1, j), gz = at(i, j + 1) - at(i, j - 1);
    const l = Math.hypot(gx, gz);
    return l < 1e-6 ? null : [-gx / l, -gz / l];
  }

  // ---- per-patch layouts -------------------------------------------------------

  _decorate(g, P, type, rng) {
    const I = CONFIG.infill;
    const [bx, bz] = this._xz(g, P.best);
    const cellsByClear = [...P.cells].sort((a, b) => Math.min(g.dB[b], g.dL[b]) - Math.min(g.dB[a], g.dL[a]));
    const scatter = (fn, r, spacing, max, filter) => {
      const placed = [];
      for (const k of cellsByClear) {
        if (placed.length >= max) break;
        if (filter && !filter(k)) continue;
        const [x, z] = this._xz(g, k);
        const jx = x + rng.range(-0.3, 0.3), jz = z + rng.range(-0.3, 0.3);
        if (placed.some(([px, pz]) => Math.hypot(px - jx, pz - jz) < spacing)) continue;
        if (!this._fits(jx, jz, r)) continue;
        fn(jx, jz);
        this._claim(jx, jz, r);
        placed.push([jx, jz]);
      }
      return placed.length;
    };
    const axisYaw = () => {
      // principal direction of the patch (for walls and planters along slivers)
      let sxx = 0, szz = 0, sxz = 0;
      for (const k of P.cells) { const [x, z] = this._xz(g, k); const dx = x - P.cx, dz = z - P.cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
      return -0.5 * Math.atan2(2 * sxz, sxx - szz);
    };

    // the fishing quarter keeps its boats and gear in every yard by the harbour
    const qtr = this.quarterAt(P.cx, P.cz);
    if (qtr === 'fishing' && ['orto', 'orchard', 'tree', 'shed', 'patio', 'pine'].includes(type) && rng() < I.boatYard) {
      const yaw0 = axisYaw();
      scatter((x, z) => this._boat(x, z, yaw0 + rng.range(-0.25, 0.25), rng), 1.25, 2.6, 2, (k) => Math.min(g.dB[k], g.dL[k]) >= 1.1);
      scatter((x, z) => (rng() < 0.5 ? this._nets(x, z, rng) : this._crates(x, z, rng)), 0.6, 1.8, 3, null);
      type = 'yard';
    }
    switch (type) {
      case 'sliver': {
        if (P.n >= 4 && rng() < 0.45) {
          const yaw = axisYaw(), len = Math.min(3.5, Math.max(1.4, Math.sqrt(P.n) * 1.2));
          if (this._fits(P.cx, P.cz, 0.5)) { this._lowWall(P.cx, P.cz, yaw, len, rng); this._claim(P.cx, P.cz, len / 2, false); }
        }
        const steep = g.band[P.best] === BAND.STEEP || g.band[P.best] === BAND.MODERATE;
        if (steep && P.n >= 3 && rng() < 0.25 && this._fits(bx, bz, 0.55)) { this._steps(bx, bz, rng); this._claim(bx, bz, 0.6); }
        scatter((x, z) => (rng() < 0.4 && P.n >= 3 ? this._planter(x, z, axisYaw(), rng.range(0.8, 1.4), rng) : this._pot(x, z, rng)), 0.3, 1.1, Math.ceil(P.n / 2), null);
        break;
      }
      case 'rocky':
        scatter((x, z) => this._rock(x, z, rng), 0.5, 2.2, Math.ceil(P.n / 12), null);
        scatter((x, z) => this._agave(x, z, rng), 0.6, 1.8, Math.ceil(P.n / 8), null);
        scatter((x, z) => this._prickly(x, z, rng), 0.45, 1.6, Math.ceil(P.n / 10), null);
        scatter((x, z) => this._wild(x, z, rng), 0.3, 1.0, Math.ceil(P.n / 4), null);
        break;
      case 'piazzetta': {
        let top = -Infinity;
        for (const k of P.cells) if (g.dL[k] >= 0.9) top = Math.max(top, this._tile(g, k, rng.pick(COL.paving)));
        const y = this._h(bx, bz) + 0.06;
        const feature = rng.weighted([['fountain', 3], ['shrine', 3], ['both', 1]]);
        // face the nearest lane
        const face = this._towardLane(g, P.best);
        const yaw = face ? Math.atan2(face[0], face[1]) : 0;
        if ((feature === 'fountain' || feature === 'both') && P.maxClear >= 1.6 && this._fits(bx, bz, 0.95)) {
          this._fountain(bx, bz, y, rng); this._claim(bx, bz, 1.0);
        } else if (this._fits(bx, bz, 0.4)) {
          this._shrine(bx, bz, y, yaw, rng); this._claim(bx, bz, 0.5);
        }
        scatter((x, z) => this._bench(x, z, yaw, rng), 0.75, 2.2, feature === 'both' ? 2 : 1, (k) => g.dB[k] <= 2.2);
        if (feature === 'both') scatter((x, z) => this._shrine(x, z, this._h(x, z) + 0.06, yaw, rng), 0.4, 2.5, 1, (k) => g.dB[k] <= 1.6);
        scatter((x, z) => this._pot(x, z, rng), 0.3, 1.2, 4, (k) => g.dB[k] <= 1.5);
        break;
      }
      case 'patio': {
        const R = Math.min(2.2, P.maxClear + 0.6);
        for (const k of P.cells) { const [x, z] = this._xz(g, k); if (Math.hypot(x - bx, z - bz) <= R && g.dL[k] >= 1.2) this._tile(g, k, rng.pick(COL.terracotta).clone().lerp(COL.white, 0.35)); }
        const y = this._h(bx, bz) + 0.06;
        if (this._fits(bx, bz, 0.7)) {
          this._put('cyl', bx, y, bz, 0.06, 0.72, 0.06, COL.dark);
          this._put('cyl', bx, y + 0.72, bz, 0.5, 0.05, 0.5, COL.white);
          for (let c = 0, n = rng.int(2, 4); c < n; c++) {
            const a = c / n * 6.28 + rng() * 0.4, cx = bx + Math.cos(a) * 0.8, cz = bz + Math.sin(a) * 0.8;
            this._put('box', cx, y, cz, 0.38, 0.45, 0.38, rng.pick(COL.wood), a);
            this._put('box', cx + Math.cos(a) * 0.17, y + 0.45, cz + Math.sin(a) * 0.17, 0.05, 0.45, 0.38, rng.pick(COL.wood), a + Math.PI / 2);
          }
          if (P.maxClear >= 1.6 && rng() < 0.75) {
            // pergola with a vine canopy
            const h = 2.35;
            for (const [ox, oz] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) {
              if (this.game.growth.occAt(bx + ox, bz + oz) === -1) this._put('box', bx + ox, this._h(bx + ox, bz + oz) - 0.1, bz + oz, 0.1, y + h - this._h(bx + ox, bz + oz) + 0.1, 0.1, rng.pick(COL.wood));
            }
            this._put('box', bx, y + h, bz, 2.4, 0.08, 2.4, rng.pick(COL.wood));
            this._put('blob', bx, y + h + 0.2, bz, 1.5, 0.28, 1.5, rng.pick(COL.leaf), rng() * 6);
          }
          this._claim(bx, bz, 1.2);
        }
        scatter((x, z) => this._pot(x, z, rng), 0.3, 1.0, 3, (k) => g.dB[k] <= 1.5);
        break;
      }
      case 'orto': {
        const rowYaw = rng() * Math.PI;
        for (const k of P.cells) {
          if (g.dL[k] < 1.6 || g.dB[k] < 0.9) continue;
          const top = this._tile(g, k, rng.pick(COL.soil), 0.05);
          const [x, z] = this._xz(g, k);
          const crop = rng.weighted([['row', 5], ['cabbage', 3], ['beans', 2]]);
          if (crop === 'row') {
            for (const o of [-0.25, 0.25]) this._put('box', x + Math.sin(rowYaw) * o, top, z + Math.cos(rowYaw) * o, 0.85, 0.2, 0.18, rng.pick(COL.leaf), rowYaw);
          } else if (crop === 'cabbage') {
            for (const [ox, oz] of [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25]]) this._put('blob', x + ox, top + 0.08, z + oz, 0.17, 0.13, 0.17, rng.pick(COL.lightLeaf));
          } else {
            this._put('box', x, top, z, 0.05, 1.2, 0.05, rng.pick(COL.wood));
            this._put('blob', x, top + 0.75, z, 0.22, 0.5, 0.22, rng.pick(COL.leaf));
          }
        }
        scatter((x, z) => this._lemon(x, z, rng, rng() < 0.4), 1.0, 3, 1, (k) => g.dB[k] >= 1.2);
        break;
      }
      case 'orchard':
        scatter((x, z) => this._lemon(x, z, rng, rng() < 0.35), 0.9, 2.6, Math.max(1, Math.round(P.n / 7)), null);
        scatter((x, z) => this._wild(x, z, rng), 0.3, 1.2, Math.ceil(P.n / 6), null);
        break;
      case 'tree':
        scatter((x, z) => this._lemon(x, z, rng, rng() < 0.4), 0.8, 3, 1, null);
        scatter((x, z) => this._pot(x, z, rng), 0.3, 1.0, 2, (k) => g.dB[k] <= 1.5);
        break;
      case 'shed':
        scatter((x, z) => { const d = this._towardWall(g, P.best); this._shed(x, z, d ? Math.atan2(d[0], d[1]) : rng() * 6, rng); }, 1.0, 3, 1, null);
        scatter((x, z) => this._pot(x, z, rng), 0.3, 1.0, 2, null);
        break;
      case 'pine':
        scatter((x, z) => this._pine(x, z, rng), 1.2, 6, 1, null);
        scatter((x, z) => this._wild(x, z, rng), 0.3, 1.4, Math.ceil(P.n / 5), null);
        break;
    }

    // --- life against the house walls (then ground cover for whatever is still bare) ---
    let lineDone = false, gear = 0;
    for (const k of P.wallCells) {
      if (g.claimed[k] === 2) continue;
      const roll = rng();
      const [x, z] = this._xz(g, k);
      // each quarter's own clutter against the walls
      if (qtr && gear < 3 && rng() < I.quarterClutter) {
        const d = this._towardWall(g, k), pick = rng();
        if (qtr === 'fishing') {
          if (pick < 0.3 && d && this._fits(x, z, 0.9) && this._fits(x + d[1] * 1.3, z - d[0] * 1.3, 0.6) && this._fits(x - d[1] * 1.3, z + d[0] * 1.3, 0.6)) {
            this._boat(x, z, Math.atan2(d[1], -d[0]), rng); this._claim(x, z, 1.5); gear++; continue;
          } else if (pick < 0.55 && d && this._fits(x, z, 0.5)) { this._netRack(x, z, [d[1], -d[0]], rng); this._claim(x, z, 1.1, false); gear++; continue; }
          else if (pick < 0.8 && this._fits(x, z, 0.55)) { this._nets(x, z, rng); this._claim(x, z, 0.7); gear++; continue; }
          else if (this._fits(x, z, 0.45)) { this._crates(x, z, rng); this._claim(x, z, 0.6); gear++; continue; }
        } else {
          if (pick < 0.4 && this._fits(x, z, 0.55)) { this._barrels(x, z, rng); this._claim(x, z, 0.8); gear++; continue; }
          else if (pick < 0.7 && d && this._fits(x, z, 0.35)) { this._stakes(x, z, d, rng); this._claim(x, z, 0.5); gear++; continue; }
          else if (this._fits(x, z, 0.4)) { this._baskets(x, z, rng); this._claim(x, z, 0.5); gear++; continue; }
        }
      }
      if (roll < I.bougainvillea) { if (this._fits(x, z, 0.3) && this._bouga(g, k, rng)) this._claim(x, z, 0.45); }
      else if (roll < I.bougainvillea + I.washing && !lineDone && P.wallCells.length >= 3) {
        const d = this._towardWall(g, k);
        if (d && this._fits(x, z, 0.45)) { this._washing(x, z, [d[1], -d[0]], rng); this._claim(x, z, 1.2, false); lineDone = true; }
      } else if (roll < I.bougainvillea + I.washing + I.cistern) { if (Math.min(g.dB[k], g.dL[k]) >= 1.2 && this._fits(x, z, 0.75)) { this._cistern(x, z, rng); this._claim(x, z, 0.8); } }
      else if (roll < I.bougainvillea + I.washing + I.cistern + I.pots) { if (this._fits(x, z, 0.28)) { this._pot(x, z, rng); this._claim(x, z, 0.3); } }
    }
    this._cover(g, P, type, rng);
  }

  /** Unit vector from cell k toward the nearest lane. */
  _towardLane(g, k) {
    const { W, H, dL } = g, i = k % W, j = (k / W) | 0;
    const at = (ii, jj) => (ii < 0 || jj < 0 || ii >= W || jj >= H) ? dL[k] : dL[jj * W + ii];
    const gx = at(i + 1, j) - at(i - 1, j), gz = at(i, j + 1) - at(i, j - 1);
    const l = Math.hypot(gx, gz);
    return l < 1e-6 ? null : [-gx / l, -gz / l];
  }

  // ---- main entry ------------------------------------------------------------------
  //
  // The work is split into stages so it can be spread over several frames (a few
  // milliseconds each) while the town grows: no stutter on a tablet. The previous
  // decorations stay on screen until the new set is complete.

  get busy() { return !!this.job; }

  /** Begin re-planning the infill (call work() each frame until it returns true). */
  start() {
    this.job = { stage: 0 };
    this.lists = {};
    for (const k of Object.keys(this.kinds)) this.lists[k] = { m: [], c: [] };
  }

  /** Do up to `budgetMs` of work; returns true when the new decorations are on screen. */
  work(budgetMs = Infinity) {
    const J = this.job;
    if (!J) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (J.stage === 0) {
        this.wg = this._buildGrid();
        J.stage = this.wg ? 1 : 3;
      } else if (J.stage === 1) {
        J.patches = this._patches(this.wg).map((cells) => this._describe(this.wg, cells));
        // most constrained first: forks and slivers claim their spots before big gardens
        J.patches.sort((a, b) => (b.fork - a.fork) || (a.n - b.n));
        J.i = 0; J.types = {};
        J.stage = 2;
      } else if (J.stage === 2) {
        if (J.i >= J.patches.length) { J.stage = 3; continue; }
        const P = J.patches[J.i++];
        const rng = makeRng(P.seed >>> 0);
        const type = this._classify(P, rng);
        J.types[type] = (J.types[type] || 0) + 1;
        this._decorate(this.wg, P, type, rng);
      } else {
        this._cafe();
        this._flush();
        this.grid = this.wg;
        this.types = J.types || {};
        this.job = null;
        return true;
      }
    }
    return false;
  }

  /** Re-plan everything right now (tests, console). */
  refresh() { this.start(); this.work(Infinity); }
}

/**
 * Two-pass chamfer distance transform on a W×H grid (in cells ≈ metres).
 * `isSource(k)` marks the zero cells. If `label` is given, the nearest
 * source's label is propagated too (returned as .label).
 */
function chamfer(W, H, isSource, label) {
  const N = W * H, d = new Float32Array(N), lab = label ? new Int16Array(N).fill(-1) : null;
  for (let k = 0; k < N; k++) { if (isSource(k)) { d[k] = 0; if (lab) lab[k] = label[k]; } else d[k] = 1e9; }
  const D = Math.SQRT2;
  const relax = (k, kk, w) => { if (d[kk] + w < d[k]) { d[k] = d[kk] + w; if (lab) lab[k] = lab[kk]; } };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (i > 0) relax(k, k - 1, 1);
    if (j > 0) { relax(k, k - W, 1); if (i > 0) relax(k, k - W - 1, D); if (i < W - 1) relax(k, k - W + 1, D); }
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    if (i < W - 1) relax(k, k + 1, 1);
    if (j < H - 1) { relax(k, k + W, 1); if (i < W - 1) relax(k, k + W + 1, D); if (i > 0) relax(k, k + W - 1, D); }
  }
  if (lab) d.label = lab;
  return d;
}

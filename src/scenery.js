// ---------------------------------------------------------------------------
// scenery.js — the wild hillside: scrub, trees, flowers, boulders.
//
// A light first pass at vegetation (it gets a fuller pass later):
//   * macchia scrub: lumpy bushes, placed by the terrain's cover map (dense on
//     slopes too steep to build on, patchy elsewhere), a few in yellow flower;
//   * umbrella pines in small clumps on knolls and ridges, olives on olive
//     terraces and near the town edge;
//   * agave rosettes and flowering tufts on sunny rock;
//   * bougainvillea spilling over terrace walls;
//   * big soft clumps on the distant hills, so they don't look bald;
//   * boulders along the rocky shore and piled against the jetty (a breakwater).
//
// Everything is instanced: one draw call per kind. To stay fast:
//   * BUDGET — instances are sorted most-important first (trees and big bushes
//     before small ones); each quality preset draws only the first N;
//   * DISTANCE — in the shader, a plant shrinks away once it would be only a
//     few pixels across, so far hillsides cost almost nothing to shade.
// Plants make way for lanes, houses and infill: refresh() rebuilds the lists.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { registerStyled } from './style.js';
import { makeRng, smoothstep } from './noise.js';
import { harbourLayout } from './paths.js';

const C = (h) => new THREE.Color(h);

/** A lumpy ball with a flat-ish underside: bushes, tree crowns, flower mounds. */
function blobGeometry(detail, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, rng = makeRng(seed);
  const bump = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!bump.has(key)) bump.set(key, 0.82 + rng() * 0.36);
    const k = bump.get(key);
    p.setXYZ(i, p.getX(i) * k, Math.max(p.getY(i) * k, -0.35), p.getZ(i) * k);
  }
  const out = mergeVerts(g);
  out.computeVertexNormals();
  // shade built in: darker underneath and in the hollows, lighter on top, so a bush has volume
  const q = out.attributes.position, col = new Float32Array(q.count * 3);
  for (let i = 0; i < q.count; i++) {
    const r = Math.hypot(q.getX(i), q.getY(i), q.getZ(i));
    const s = (0.55 + 0.5 * (q.getY(i) + 0.35) / 1.4) * (0.82 + 0.36 * (r - 0.82) / 0.36);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Weld identical positions so normals come out smooth (IcosahedronGeometry is not indexed). */
function mergeVerts(g) {
  const p = g.attributes.position, map = new Map(), pos = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!map.has(key)) { map.set(key, pos.length / 3); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(map.get(key));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

/** An angular boulder: a coarse ball knocked about, with flat facets. */
function boulderGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, rng = makeRng(seed), bump = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!bump.has(key)) bump.set(key, 0.7 + rng() * 0.5);
    const k = bump.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.82, p.getZ(i) * k);
  }
  g.computeVertexNormals();   // not indexed → one normal per facet
  return g;
}

/** An agave rosette: tapering blades fanning out and arching over. */
function agaveGeometry() {
  const pos = [], rng = makeRng(91);
  const blades = 11;
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rng() * 0.3, lift = 0.35 + rng() * 0.75, len = 0.8 + rng() * 0.35;
    const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
    const w = 0.13;
    // three points along the blade: base, belly, tip (the tip droops a little)
    const P = [[0.05, 0.05], [len * 0.55, lift * 0.62], [len, lift * 0.78]];
    const pt = (i, side, up = 0) => [dx * P[i][0] + px * side, P[i][1] + up, dz * P[i][0] + pz * side];
    const tri = (a, b2, c) => pos.push(...a, ...b2, ...c, ...a, ...c, ...b2);   // both sides
    tri(pt(0, -w), pt(0, w), pt(1, w * 0.8)); tri(pt(0, -w), pt(1, w * 0.8), pt(1, -w * 0.8));
    tri(pt(1, -w * 0.8), pt(1, w * 0.8), pt(2, 0));
    tri(pt(0, -w), pt(1, 0, 0.09), pt(1, -w * 0.8)); tri(pt(0, w), pt(1, w * 0.8), pt(1, 0, 0.09));   // a ridge down the middle
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class Scenery {
  constructor(terrain, terraces = null) {
    this.terrain = terrain;
    this.terraces = terraces;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.version = 0;
    this.lod = { value: CONFIG.flora.lod.high };
    this.budget = CONFIG.flora.budget.high;

    const foliage = (opts = {}) => {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });
      // distance LOD: shrink an instance away once it would be only a few pixels across
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uLod = this.lod;
        sh.vertexShader = 'uniform float uLod;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          {
            float lodSize = length(instanceMatrix[0].xyz);
            float lodDist = distance(cameraPosition, (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz);
            transformed *= clamp((lodSize / max(lodDist, 1.0) - uLod) / uLod, 0.0, 1.0);
          }
          #endif`);
      };
      return registerStyled(m, 'foliage');
    };
    this.geos = {
      blob: blobGeometry(1, 5), blobRound: blobGeometry(2, 5),
      trunk: new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0),
      agave: agaveGeometry(),
      boulder: boulderGeometry(17),
    };
    this.kinds = {
      blob: { geo: this.geos.blob, mat: foliage({ vertexColors: true }), shadow: true },
      trunk: { geo: this.geos.trunk, mat: registerStyled(new THREE.MeshStandardMaterial({ roughness: 0.95 }), 'foliage'), shadow: true },
      agave: { geo: this.geos.agave, mat: foliage({ side: THREE.DoubleSide }), shadow: false },
      boulder: { geo: this.geos.boulder, mat: registerStyled(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), 'ground', { mode: 'rock', layer: 'rockPale' }), shadow: true },
    };
    for (const K of Object.values(this.kinds)) { K.mesh = null; K.cap = 0; }
    this.items = { blob: [], trunk: [], agave: [], boulder: [] };
    this.regenerate();
  }

  /** Art style: faceted or round foliage (materials follow via style.js). */
  setStyle(style) {
    const K = this.kinds.blob;
    K.geo = style.roundFoliage ? this.geos.blobRound : this.geos.blob;
    if (K.mesh) K.mesh.geometry = K.geo;
  }

  /** Quality preset: how many plants to draw, and how soon small ones shrink away. */
  setQuality(name) {
    const F = CONFIG.flora;
    this.budget = F.budget[name] ?? F.budget.high;
    this.lod.value = F.lod[name] ?? F.lod.high;
    this._applyCounts();
  }

  // ---- placement ----------------------------------------------------------------

  /** Work out where everything stands (after the ground or the terraces change). */
  regenerate() {
    const t = this.terrain, F = CONFIG.flora, P = F.colours;
    const rng = makeRng(t.seed * 3 + 11);
    const pick = (arr) => arr[(rng() * arr.length) | 0];
    const blob = [], trunk = [], agave = [], boulder = [];
    const scrub = P.scrub.map(C), broom = P.broom.map(C), pine = P.pine.map(C), olive = P.olive.map(C);
    const bouga = P.bougainvillea.map(C), leaf = P.leaf.map(C), flower = P.flowers.map(C), agaveC = P.agave.map(C);
    const far = P.far.map(C), rockC = P.boulder.map(([h, w]) => [C(h), w]);
    const put = (list, x, y, z, sx, sy, sz, col, yaw, rank, fixed = false, tilt = 0, tilt2 = 0) =>
      list.push({ x, y, z, sx, sy, sz, col, yaw, rank, fixed, tilt, tilt2 });

    // --- macchia scrub inside the playable square ---
    const S = F.spacing, half = t.half;
    for (let gz = -half + 2; gz < half - 2; gz += S) for (let gx = -half + 2; gx < half - 2; gx += S) {
      const x = gx + (rng() - 0.5) * S * 0.95, z = gz + (rng() - 0.5) * S * 0.95;
      const cover = t.coverAt(x, z), r = rng(), r2 = rng(), r3 = rng(), r4 = rng();
      if (r > cover * F.density) continue;
      const y = t.heightAt(x, z);
      if (y < 2) continue;
      const flowering = r3 < F.broomShare;
      const size = (F.bushSize[0] + (F.bushSize[1] - F.bushSize[0]) * r2 * r2) * (0.7 + 0.5 * cover) * (flowering ? 0.7 : 1);
      const col = (flowering ? pick(broom) : pick(scrub)).clone().multiplyScalar(0.85 + 0.3 * r4);
      put(blob, x, y - size * 0.15, z, size * (0.9 + 0.35 * r3), size * (flowering ? 0.6 : 0.68 + 0.38 * r4), size * (0.9 + 0.35 * r), col, r * 6.28, size);
      if (size > 1.5 && r4 < 0.6) {   // big bushes are two lumps, so they don't read as balls
        const a = r3 * 6.28, d = size * 0.7;
        put(blob, x + Math.cos(a) * d, t.heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d) - size * 0.1, z + Math.sin(a) * d,
          size * 0.75, size * 0.62, size * 0.8, col.clone().multiplyScalar(0.92 + 0.16 * r), r2 * 6.28, size * 0.8);
      }
    }

    // --- soft clumps on the distant hills ---
    const R = F.farReach, FS = F.farSpacing;
    for (let gz = -R; gz < R; gz += FS) for (let gx = -R; gx < R; gx += FS) {
      const x = gx + (rng() - 0.5) * FS, z = gz + (rng() - 0.5) * FS;
      const r = rng(), r2 = rng(), r3 = rng();
      if (Math.abs(x) < half + 1 && Math.abs(z) < half + 1) continue;
      const y = t.outerHeightFn(x, z);
      if (y < 4) continue;
      const e = 6, deg = Math.atan(Math.hypot(t.outerHeightFn(x + e, z) - y, t.outerHeightFn(x, z + e) - y) / e) * 180 / Math.PI;
      if (deg > 50 || r > 0.85) continue;
      const size = F.farSize[0] + (F.farSize[1] - F.farSize[0]) * r2;
      put(blob, x, y - size * 0.25, z, size * (1 + 0.5 * r3), size * (0.75 + 0.3 * r), size * (1 + 0.5 * r), pick(far).clone().multiplyScalar(0.85 + 0.3 * r3), r * 6.28, size * 0.6);
    }

    // --- umbrella pines: clumps on knolls and ridges ---
    const pineAt = (x, z, y, s) => {
      const lean = (rng() - 0.5) * 0.24, lean2 = (rng() - 0.5) * 0.24, h = (6.5 + rng() * 3.5) * s, yaw = rng() * 6.28;
      put(trunk, x, y - 0.3, z, s * 1.1, h, s * 1.1, C('#6b5040'), yaw, 99, true, lean, lean2);
      const tx = x + Math.sin(lean2) * h, tz = z - Math.sin(lean) * h;   // where the leaning trunk ends
      const col = pick(pine).clone();
      put(blob, tx, y + h - 0.3 * s, tz, 3.4 * s, 1.15 * s, 3.4 * s, col, yaw, 99, true);
      for (let k = 0; k < 3; k++) {
        const a = yaw + k * 2.1, d = 1.9 * s;
        put(blob, tx + Math.cos(a) * d, y + h - (0.5 + rng() * 0.4) * s, tz + Math.sin(a) * d, 2.2 * s, 0.9 * s, 2.2 * s, col.clone().multiplyScalar(0.88 + rng() * 0.2), a, 98, true);
      }
    };
    let clumps = 0;
    for (let k = 0; k < 3000 && clumps < F.pineClumps; k++) {
      const x = rng.range(-half + 8, half - 8), z = rng.range(-half + 8, half - 30);
      const y = t.heightAt(x, z);
      if (y < F.pineMinHeight || t.slopeAt(x, z, 3) > 36) continue;
      // a knoll or ridge: higher than the ground around it
      const around = (t.heightAt(x + 9, z) + t.heightAt(x - 9, z) + t.heightAt(x, z + 9) + t.heightAt(x, z - 9)) / 4;
      if (y - around < 0.6 && rng() < 0.85) continue;
      if (trunk.some((o) => o.fixed && Math.hypot(o.x - x, o.z - z) < 22)) continue;
      const n = 1 + ((rng() * 3.4) | 0);
      for (let i = 0; i < n; i++) {
        const px = x + rng.range(-5, 5), pz = z + rng.range(-5, 5);
        pineAt(px, pz, t.heightAt(px, pz), rng.range(0.85, 1.25));
      }
      clumps++;
    }
    // a few on the near skyline outside the square, where they show against the sky
    for (let k = 0; k < 4000 && clumps < F.pineClumps + F.farPineClumps; k++) {
      const x = rng.range(-320, 320), z = rng.range(-340, 60);
      if (Math.abs(x) < half && Math.abs(z) < half) continue;
      const y = t.outerHeightFn(x, z);
      const around = (t.outerHeightFn(x + 20, z) + t.outerHeightFn(x - 20, z) + t.outerHeightFn(x, z + 20) + t.outerHeightFn(x, z - 20)) / 4;
      if (y < 30 || y - around < 1.2) continue;
      const n = 1 + ((rng() * 3.4) | 0);
      for (let i = 0; i < n; i++) { const px = x + rng.range(-6, 6), pz = z + rng.range(-6, 6); pineAt(px, pz, t.outerHeightFn(px, pz), rng.range(1.0, 1.5)); }
      clumps++;
    }

    // --- olives: on olive terraces ---
    const T = this.terraces;
    const oliveAt = (x, z) => {
      const y = t.heightAt(x, z), s = rng.range(0.8, 1.2), yaw = rng() * 6.28;
      put(trunk, x, y - 0.2, z, 1.2 * s, 1.5 * s, 1.2 * s, C('#75695a'), yaw, 97, true, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
      const col = pick(olive).clone().multiplyScalar(0.9 + rng() * 0.2);
      put(blob, x, y + 2.1 * s, z, 1.9 * s, 1.35 * s, 1.9 * s, col, yaw, 97, true);
      put(blob, x + Math.cos(yaw) * 0.9 * s, y + 1.8 * s, z + Math.sin(yaw) * 0.9 * s, 1.3 * s, 1.0 * s, 1.3 * s, col.clone().multiplyScalar(0.92), yaw + 1, 96, true);
    };
    if (T) for (const A of T.areas) {
      if (A.crop !== 'olive') continue;
      for (let k = 0; k < A.r * A.r * 0.09; k++) {
        const a = rng() * 6.28, d = Math.sqrt(rng()) * A.r, x = A.x + Math.cos(a) * d, z = A.z + Math.sin(a) * d;
        if (T.maskAt(x, z) < 0.6) continue;
        if (trunk.some((o) => Math.hypot(o.x - x, o.z - z) < 5)) continue;
        oliveAt(x, z);
      }
    }

    // --- agave and flowering tufts on sunny rock and steep banks ---
    for (let k = 0; k < F.rockPlantTries; k++) {
      const x = rng.range(-half + 4, half - 4), z = rng.range(-half + 4, half - 4);
      const y = t.heightAt(x, z), r = rng(), r2 = rng();
      if (y < 3 || y > F.rockPlantMaxHeight) continue;
      const deg = t.slopeAt(x, z, 1.5);
      if (deg < 30 || deg > 54) continue;
      if (r < 0.4) {
        const s = rng.range(0.8, 1.5);
        put(agave, x, y - 0.05, z, s, s, s, pick(agaveC).clone().multiplyScalar(0.9 + 0.2 * r2), r2 * 6.28, 60 + s, true, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
      } else {
        const s = rng.range(0.35, 0.8), col = pick(flower).clone();
        put(blob, x, y - s * 0.1, z, s * 1.3, s * 0.7, s * 1.3, col, r2 * 6.28, 40 + s, true);
        if (r2 < 0.6) put(blob, x + 0.5, t.heightAt(x + 0.5, z + 0.3) - s * 0.1, z + 0.3, s * 0.9, s * 0.6, s * 0.9, pick(leaf).clone(), r * 6.28, 39, true);
      }
    }

    // --- bougainvillea spilling over terrace walls ---
    if (T) for (const w of T.wallPoints) {
      if (rng() > F.bougainvilleaOnWalls || w.h < 0.9) continue;
      const n = 5 + ((rng() * 5) | 0), along = { x: -w.nz, z: w.nx };
      const tone = pick(bouga);
      for (let i = 0; i < n; i++) {
        const a = (rng() - 0.5) * 3.4, drop = rng() * Math.min(w.h, 1.8), out = 0.15 + rng() * 0.3, s = 0.45 + rng() * 0.5;
        const col = (rng() < 0.24 ? pick(leaf) : rng() < 0.6 ? tone : pick(bouga)).clone().multiplyScalar(0.88 + rng() * 0.24);
        put(blob, w.x + along.x * a + w.nx * out, w.y - drop + 0.1, w.z + along.z * a + w.nz * out, s * 1.25, s * 0.85, s * 1.0, col, Math.atan2(along.x, along.z), 80 + s, true);
      }
    }

    // --- boulders: the rocky shore, and a breakwater piled against the jetty ---
    const B = F.boulders;
    const rock = (x, y, z, s) => {
      put(boulder, x, y, z, s * rng.range(0.8, 1.35), s * rng.range(0.6, 1.0), s * rng.range(0.8, 1.35), rng.weighted(rockC).clone().multiplyScalar(0.85 + rng() * 0.3), rng() * 6.28, s, true, (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9);
    };
    for (let x = -half + 2; x < half - 2; x += B.step) {
      const coast = t.coastZ(x);
      if (t.baseHeightAt(x, coast - 14) < 6) continue;            // only below high ground (not on the harbour beach)
      for (let k = 0; k < B.perStep; k++) {
        const z = coast + rng.range(-5, 17), xx = x + rng.range(-0.6, 0.6);
        if (Math.abs(z) > half - 2) continue;
        const h = t.heightAt(xx, z);
        if (h < -1.9 || h > 2.6) continue;
        if (t.noise.fbm(xx * 0.09 + 3, z * 0.09, 2) < B.clusterCut) continue;
        const s = rng() < 0.08 ? rng.range(1.8, 3.0) : rng.range(0.45, 1.5);
        rock(xx, h + s * 0.18, z, s);
      }
    }
    const lay = harbourLayout(t), z0 = t.coastZ(lay.x) - 2;
    for (let d = 2; d < 21; d += 0.9) {
      const jx = lay.x + 4 + Math.min(d, 16) * 0.25, jz = z0 + d;
      const tip = d > 15.5;
      for (let k = 0; k < (tip ? 3 : 2); k++) {
        const side = tip ? rng.range(-2.6, 4.5) : rng.range(1.8, 5.2);
        const x = jx + side + (tip ? 0 : 0), z = jz + rng.range(-0.6, 0.6) + (tip ? rng.range(0, 2.5) : 0);
        const h = t.heightAt(x, z);
        if (h > 0.4) continue;
        const s = rng.range(1.0, 1.9), top = k === 0 ? rng.range(0.3, 1.0) : rng.range(-0.5, 0.3);
        rock(x, Math.max(h + s * 0.3, top - s * 0.3), z, s);
      }
    }

    for (const list of [blob, trunk, agave, boulder]) list.sort((a, b) => (b.fixed - a.fixed) || (b.rank - a.rank));
    this.items = { blob, trunk, agave, boulder };
    this.refresh(this._growth, this._infill);
  }

  // ---- drawing ------------------------------------------------------------------

  _mesh(kind, n) {
    const K = this.kinds[kind];
    if (K.mesh && K.cap >= n) return K.mesh;
    if (K.mesh) { this.group.remove(K.mesh); K.mesh.dispose(); }
    K.cap = Math.max(16, Math.ceil(n * 1.1));
    const m = new THREE.InstancedMesh(K.geo, K.mat, K.cap);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(K.cap * 3).fill(1), 3);
    m.frustumCulled = false;   // instances span the whole map
    m.castShadow = K.shadow; m.receiveShadow = true;
    K.mesh = m; this.group.add(m);
    return m;
  }

  /** Rebuild instances, skipping anything on a lane, inside a house, or where infill has put something. */
  refresh(growth, infill) {
    this._growth = growth; this._infill = infill;
    const t = this.terrain;
    const free = (x, z) => !t.inside(x, z) || ((!growth || growth.occAt(x, z) === -1) && !(infill && infill.claimedAt(x, z)));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), s = new THREE.Vector3();
    this.shown = {};
    for (const kind of Object.keys(this.items)) {
      const list = this.items[kind], mesh = this._mesh(kind, list.length);
      let n = 0;
      for (const it of list) {
        if (kind !== 'boulder' && !free(it.x, it.z)) continue;
        e.set(it.tilt, it.yaw, it.tilt2);
        mesh.setMatrixAt(n, m.compose(v.set(it.x, it.y, it.z), q.setFromEuler(e), s.set(it.sx, it.sy, it.sz)));
        mesh.setColorAt(n++, it.col);
      }
      this.shown[kind] = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
    this._applyCounts();
    this.version++;
  }

  _applyCounts() {
    if (!this.shown) return;
    for (const kind of Object.keys(this.items)) {
      const mesh = this.kinds[kind].mesh;
      if (mesh) mesh.count = kind === 'blob' ? Math.min(this.shown.blob, this.budget) : this.shown[kind];
    }
  }
}

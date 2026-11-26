// ---------------------------------------------------------------------------
// buildings.js — turns building records into low-poly meshes.
//
// Footprints are convex quadrilaterals (trapezoids and wedges as well as
// rectangles), so walls, cornices, stone bases and roofs are generated as
// polygon prisms and merged into ONE mesh (one draw call). Small repeated
// details — windows, shutters, balconies, doors, shopfronts, awnings,
// chimneys, boat-store vaults — are InstancedMeshes laid out along each wall.
// Everything is rebuilt a few times per second while the town grows.
//
// A building's walls run from below its lowest ground up to
//     top = (uphill ground) + floors × floorHeight
// so on a slope the downhill facade is taller ("stepping down the hill").
// Windows are laid out per storey from the roof down and are skipped where
// they'd be underground or covered by a neighbour's wall.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './noise.js';
import { ZONE } from './zones.js';
import { sub, norm, dist, lerp2, centroid, edgeNormal, offsetPoly } from './geom.js';

const FH = CONFIG.building.floorHeight;
const WHITE = new THREE.Color(1, 1, 1);
const CREAM = new THREE.Color('#f3ead6'), STONE = new THREE.Color('#9c9184');
const DOOR_COLS = [new THREE.Color('#3b5d46'), new THREE.Color('#6b4a33'), new THREE.Color('#2f5f78')];
const AWN_COLS = [new THREE.Color('#d24b3f'), new THREE.Color('#2e7cb8'), new THREE.Color('#3b9c6b'), new THREE.Color('#e3a63a')];

// ---- geometry helpers ---------------------------------------------------------

/** Accumulates flat-shaded, vertex-coloured triangles into one BufferGeometry. */
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  /** A planar convex face from 3D points; wound to face along `want` (if given). */
  face(pts, c, want) {
    if (pts.length < 3) return;
    const [a, b, d] = pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) return;
    n = n.map((k) => k / l);
    if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) { pts = [...pts].reverse(); n = n.map((k) => -k); }
    for (let i = 1; i + 1 < pts.length; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c.r, c.g, c.b);
      }
    }
  }

  /** Push one triangle with a known normal. */
  _tri(a, b, d, n, c) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
    this.nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    this.col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
  }

  /** Vertical prism over a convex 2D polygon from y0 to y1 (fast path: normals known). */
  prism(poly, y0, y1, c, top = true, bottom = false) {
    if (y1 - y0 < 0.01) return;
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - a[1] * b[0]; }
    const ccw = area > 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      let ex = b[0] - a[0], ez = b[1] - a[1];
      const l = Math.hypot(ex, ez);
      if (l < 1e-6) continue;
      ex /= l; ez /= l;
      const nx = ccw ? ez : -ez, nz = ccw ? -ex : ex;      // outward
      const A0 = [a[0], y0, a[1]], B0 = [b[0], y0, b[1]], B1 = [b[0], y1, b[1]], A1 = [a[0], y1, a[1]];
      const N = [nx, 0, nz];
      // wind so the face points outward: (B0-A0) x (A1-A0) has direction (-ez, 0, ex)·sign
      if (ccw) { this._tri(A0, A1, B1, N, c); this._tri(A0, B1, B0, N, c); }
      else { this._tri(A0, B0, B1, N, c); this._tri(A0, B1, A1, N, c); }
    }
    if (top) this.face(poly.map((p) => [p[0], y1, p[1]]), c, [0, 1, 0]);
    if (bottom) this.face(poly.map((p) => [p[0], y0, p[1]]), c, [0, -1, 0]);
  }

  /** Typed arrays for this builder's triangles, plus per-vertex occlusion params (see step 4). */
  /**
   * Typed arrays for this builder's triangles, plus baked occlusion params per
   * vertex: aoParams = (ground height here, how enclosed it is 0..1, unused).
   * The walls shader darkens walls near the ground, more so in narrow lanes.
   * `probe(x, z, nx, nz)` returns the enclosure for a wall facing (nx, nz).
   */
  arrays(probe, terrain) {
    const n = this.pos.length, P = this.pos, N = this.nor;
    const ao = new Float32Array(n);
    const memo = new Map();
    for (let i = 0; i < n; i += 3) {
      const x = P[i], z = P[i + 2], nx = N[i], nz = N[i + 2];
      const key = Math.round(x * 2) + ',' + Math.round(z * 2) + ',' + Math.round(nx * 4) + ',' + Math.round(nz * 4);
      let v = memo.get(key);
      if (!v) {
        const g = terrain.heightAt(x, z);
        const enc = Math.abs(N[i + 1]) > 0.7 ? 0 : probe(x, z, nx, nz);   // roofs/terraces: open sky
        v = [g, enc];
        memo.set(key, v);
      }
      ao[i] = v[0]; ao[i + 1] = v[1]; ao[i + 2] = 0;
    }
    return { pos: new Float32Array(P), nor: new Float32Array(N), col: new Float32Array(this.col), ao };
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Merge several (geometry, colour) pairs into one vertex-coloured geometry. */
function mergeColoured(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, hex] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    c.set(hex);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A round-headed opening (unit width/height, origin at bottom centre) with a stone surround. */
function vaultGeometry() {
  const opening = new THREE.Shape();
  opening.moveTo(-0.5, 0); opening.lineTo(0.5, 0); opening.lineTo(0.5, 0.6);
  opening.absarc(0, 0.6, 0.5, 0, Math.PI, false); opening.lineTo(-0.5, 0);
  const ring = new THREE.Shape();
  ring.moveTo(-0.62, 0); ring.lineTo(-0.5, 0); ring.lineTo(-0.5, 0.6);
  ring.absarc(0, 0.6, 0.5, Math.PI, 0, true); ring.lineTo(0.5, 0); ring.lineTo(0.62, 0); ring.lineTo(0.62, 0.6);
  ring.absarc(0, 0.6, 0.62, 0, Math.PI, false); ring.lineTo(-0.62, 0);
  const g1 = new THREE.ShapeGeometry(opening, 10).translate(0, 0, 0.03);
  const g2 = new THREE.ShapeGeometry(ring, 10).translate(0, 0, 0.05);
  return mergeColoured([[g1, '#2c2622'], [g2, '#b9ad97']]);
}

// ---- the renderer -------------------------------------------------------------

export class BuildingRenderer {
  constructor(terrain, growth) {
    this.terrain = terrain;
    this.growth = growth;
    this.group = new THREE.Group();
    this.group.name = 'buildings';

    const lambert = (opts = {}) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true, ...opts });
    const vc = lambert({ vertexColors: true });
    this.massMat = lambert({ vertexColors: true });
    // Baked ambient occlusion: walls darken toward the ground, more in narrow lanes.
    // (Cheap: two numbers per vertex, computed once when a house is built.)
    this.aoUniforms = { uAO: { value: 1 } };
    this.massMat.onBeforeCompile = (sh) => {
      sh.uniforms.uAO = this.aoUniforms.uAO;
      sh.vertexShader = 'attribute vec3 aoParams;\nvarying float vAO;\nuniform float uAO;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float hAbove = max((modelMatrix * vec4(position, 1.0)).y - aoParams.x, 0.0);
        float reach = mix(1.8, 7.0, aoParams.y);            // narrow lanes stay dark higher up
        float k = 1.0 - smoothstep(0.0, reach, hAbove);
        vAO = 1.0 - uAO * k * mix(0.22, 0.5, aoParams.y);`);
      sh.fragmentShader = 'varying float vAO;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vAO;`);
    };
    this.mass = null;   // the merged walls + roofs mesh
    this.cache = new Map();   // house id → its generated geometry and instances

    // Instanced details: geometry + material + whether it casts shadows.
    this.parts = {
      window:  { geo: mergeColoured([[box(1.0, 1.5, 0.08, 0, 0, 0.0), '#f1e9d6'], [box(0.74, 1.24, 0.06, 0, 0, 0.04), '#3a3d44']]), mat: vc, shadow: false },
      shutterOpen:   { geo: mergeColoured([[box(0.42, 1.3, 0.05, -0.68, 0, 0.03), '#ffffff'], [box(0.42, 1.3, 0.05, 0.68, 0, 0.03), '#ffffff']]), mat: lambert(), shadow: false },
      shutterClosed: { geo: mergeColoured([[box(0.8, 1.3, 0.06, 0, 0, 0.07), '#ffffff'], [box(0.8, 0.05, 0.02, 0, 0, 0.11), '#c8c8c8']]), mat: lambert({ vertexColors: true }), shadow: false },
      balcony: { geo: mergeColoured([[box(1.45, 0.14, 0.8, 0, -0.75, 0.4), '#e5dccb'], [box(1.45, 0.08, 0.05, 0, -0.05, 0.78), '#2d2d2d'],
                                     [box(0.05, 0.7, 0.05, -0.7, -0.4, 0.78), '#2d2d2d'], [box(0.05, 0.7, 0.05, 0.7, -0.4, 0.78), '#2d2d2d'],
                                     [box(1.4, 0.03, 0.03, 0, -0.35, 0.78), '#2d2d2d']]), mat: vc, shadow: false },
      door:    { geo: box(0.95, 2.05, 0.1, 0, 1.03, 0.03), mat: lambert(), shadow: false },
      shop:    { geo: mergeColoured([[box(2.5, 2.4, 0.08, 0, 1.2, 0), '#ece3cf'], [box(2.2, 2.1, 0.06, 0, 1.12, 0.04), '#3a3d44']]), mat: vc, shadow: false },
      awning:  { geo: box(1, 0.08, 1.3).rotateX(0.4), mat: lambert(), shadow: true },
      chimney: { geo: mergeColoured([[box(0.55, 1.2, 0.55, 0, 0.6, 0), '#ffffff'], [box(0.75, 0.12, 0.75, 0, 1.25, 0), '#d8d0c0']]), mat: lambert({ vertexColors: true }), shadow: true },
      vault:   { geo: vaultGeometry(), mat: lambert({ vertexColors: true, side: THREE.DoubleSide }), shadow: false },
    };
    for (const p of Object.values(this.parts)) { p.mesh = null; p.cap = 0; }
  }

  /** Make sure a part's InstancedMesh can hold n instances. */
  _ensure(name, n) {
    const p = this.parts[name];
    if (p.mesh && p.cap >= n) return p.mesh;
    if (p.mesh) { this.group.remove(p.mesh); p.mesh.dispose(); }
    p.cap = Math.max(64, Math.ceil(n * 1.5));
    const m = new THREE.InstancedMesh(p.geo, p.mat, p.cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.cap * 3).fill(1), 3);
    m.castShadow = p.shadow;
    m.receiveShadow = true;
    m.frustumCulled = false; // instances span the whole town
    p.mesh = m;
    this.group.add(m);
    return m;
  }

  /**
   * How enclosed a wall is: walk out from it and see how soon another house's
   * wall is met (a narrow lane is dark at the bottom, an open piazza isn't).
   */
  _enclosure(b, x, z, nx, nz) {
    const l = Math.hypot(nx, nz);
    if (l < 1e-3) return 0;
    nx /= l; nz /= l;
    const G = this.growth;
    for (let d = 0.6; d <= 6; d += 0.6) {
      const o = G.occAt(x + nx * d, z + nz * d);
      if (o >= 0 && o !== b.id) return 1 - (d - 0.6) / 6;
    }
    return 0;
  }

  /** Corners of part of an archway house's rectangle, in its local frame. */
  _rectPart(b, u0, u1, v0, v1) {
    return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]].map(([u, v]) => [b.x + b.rx * u + b.fx * v, b.z + b.rz * u + b.fz * v]);
  }

  /**
   * Waterfront houses stand on a rough stone base (sets b.stoneTop) and may
   * have a boat-store vault in the wall that faces the water.
   */
  _harbourBase(b, rng) {
    const S = CONFIG.harbour.stoneBase, t = this.terrain;
    const [cx, cz] = centroid(b.corners);
    if (b.gMin > S.maxGround || t.coastZ(cx) - cz > S.coastDistance) { b.stoneTop = 0; return null; }
    const top = b.gMin + S.height[0] + rng() * (S.height[1] - S.height[0]);
    b.stoneTop = Math.min(top, b.top - FH);              // always leave rooms above
    const stones = ['#8f8576', '#9a8f7d', '#857b6d', '#a39883'];
    const col = new THREE.Color(stones[(b.seed >> 7) % stones.length]);
    let vault = null;
    if (rng() < S.vaultChance) {
      // the wall that faces the sea most squarely (+z is seaward)
      let edge = 0, best = -Infinity;
      for (let i = 0; i < 4; i++) {
        const n = edgeNormal(b.corners, i), L = dist(b.corners[i], b.corners[(i + 1) % 4]);
        const score = n[1] + (L > 3 ? 0.2 : -1);
        if (score > best) { best = score; edge = i; }
      }
      const L = dist(b.corners[edge], b.corners[(edge + 1) % 4]);
      const m = lerp2(b.corners[edge], b.corners[(edge + 1) % 4], 0.5);
      const h = Math.min(3.4, b.stoneTop - t.heightAt(m[0], m[1]) - 0.15);
      const w = Math.min(3.6, L - 1.0);
      if (h > 2.1 && w > 1.8 && edgeNormal(b.corners, edge)[1] > 0.2) vault = { edge, w, h };
    }
    b.vaultEdge = vault ? vault.edge : -1;
    return { top: b.stoneTop, col, vault };
  }

  /** Nearly-flat roofs over any convex quad: gable, hip, gable end-on, or a roof terrace. */
  _roof(gb, b, ov, pitch) {
    const P = offsetPoly(b.corners, ov);
    const top = b.top;
    const up = [0, 1, 0];
    const lift = (p, y) => [p[0], y, p[1]];
    const side = (i) => { const n = edgeNormal(P, i); return [n[0], 0, n[1]]; };
    if (b.roof === 'flat') {
      // a roof terrace: low parapet in a lighter shade, tiled floor inside
      gb.prism(offsetPoly(b.corners, 0.05), top, top + 0.55, b.facade.clone().offsetHSL(0, -0.05, 0.06));
      gb.prism(offsetPoly(b.corners, -0.25), top + 0.05, top + 0.57, b.roofCol);
      return;
    }
    const depth = (dist(P[1], P[2]) + dist(P[0], P[3])) / 2, width = (dist(P[0], P[1]) + dist(P[2], P[3])) / 2;
    const along = b.roof !== 'gableX';                  // ridge parallel to the front wall?
    const yr = top + pitch * (along ? depth : width) + 0.15;
    let R0, R1;
    if (along) { R0 = lerp2(P[3], P[0], 0.5); R1 = lerp2(P[1], P[2], 0.5); }
    else { R0 = lerp2(P[0], P[1], 0.5); R1 = lerp2(P[2], P[3], 0.5); }
    if (b.roof === 'hip') { const C = centroid(P); R0 = lerp2(R0, C, 0.35); R1 = lerp2(R1, C, 0.35); }
    const p = P.map((q) => lift(q, top)), r0 = lift(R0, yr), r1 = lift(R1, yr);
    const col = b.roofCol, hip = b.roof === 'hip';
    if (along) {
      gb.face([p[0], p[1], r1, r0], col, up);
      gb.face([p[2], p[3], r0, r1], col, up);
      gb.face([p[1], p[2], r1], col, hip ? up : side(1));
      gb.face([p[3], p[0], r0], col, hip ? up : side(3));
    } else {
      gb.face([p[3], p[0], r0, r1], col, up);
      gb.face([p[1], p[2], r1, r0], col, up);
      gb.face([p[0], p[1], r0], col, side(0));
      gb.face([p[2], p[3], r1], col, side(2));
    }
    gb.face(p, col, [0, -1, 0]);   // the eaves seen from below
  }

  /** Forget every cached house (the next rebuild redraws the whole town). */
  invalidateAll() { this.cache.clear(); }

  /**
   * Redraw the town. Only houses whose `ver` changed since they were last
   * built are regenerated (growth bumps `ver` on a house and its neighbours
   * when it is added, gains a floor or is removed); everything else is copied
   * from the per-house cache into the shared buffers.
   */
  rebuild(buildings) {
    // tops first, so neighbour checks use the current heights
    for (const b of buildings) b.top = b.gMax + b.floors * FH;
    const seen = new Set();
    let rebuilt = 0;
    for (const b of buildings) {
      seen.add(b.id);
      const c = this.cache.get(b.id);
      if (!c || c.ver !== b.ver) { this.cache.set(b.id, this._buildOne(b)); rebuilt++; }
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.cache.delete(id);
    this.lastRebuilt = rebuilt;

    // --- the merged walls + roofs mesh: concatenate the cached pieces ---
    let nv = 0;
    for (const b of buildings) nv += this.cache.get(b.id).pos.length;
    if (!this.mass || this.massCap < nv) {
      // (re)allocate with head-room, so most rebuilds just copy into existing buffers
      this.massCap = Math.ceil((nv * 1.4 + 3000) / 9) * 9;   // whole triangles (3 vertices × 3 floats)
      const geo = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aoParams', 3]]) {
        geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(this.massCap), size).setUsage(THREE.DynamicDrawUsage));
      }
      if (this.mass) { this.mass.geometry.dispose(); this.mass.geometry = geo; }
      else {
        this.mass = new THREE.Mesh(geo, this.massMat);
        this.mass.castShadow = true;
        this.mass.receiveShadow = true;
        this.mass.frustumCulled = false;
        this.group.add(this.mass);
      }
    }
    const A = this.mass.geometry.attributes;
    let o = 0;
    for (const b of buildings) {
      const c = this.cache.get(b.id);
      A.position.array.set(c.pos, o); A.normal.array.set(c.nor, o); A.color.array.set(c.col, o); A.aoParams.array.set(c.ao, o);
      o += c.pos.length;
    }
    for (const a of Object.values(A)) { a.clearUpdateRanges(); a.addUpdateRange(0, nv); a.needsUpdate = true; }
    this.mass.geometry.setDrawRange(0, nv / 3);

    // --- instance buffers: concatenate the cached matrices and colours ---
    for (const k of Object.keys(this.parts)) {
      let n = 0;
      for (const b of buildings) n += this.cache.get(b.id).parts[k].n;
      const mesh = this._ensure(k, n);
      const M = mesh.instanceMatrix.array, C = mesh.instanceColor.array;
      let i = 0;
      for (const b of buildings) {
        const p = this.cache.get(b.id).parts[k];
        if (!p.n) continue;
        M.set(p.m, i * 16); C.set(p.c, i * 3);
        i += p.n;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Generate one house: its wall/roof triangles and its detail instances. */
  _buildOne(b) {
    const t = this.terrain;
    const lists = {};
    for (const k of Object.keys(this.parts)) lists[k] = [];
    // instance = [x, y, z, rotY, sx, sy, sz, colour]
    const put = (k, x, y, z, rot, sx, sy, sz, col) => lists[k].push(x, y, z, rot, sx, sy, sz, col.r, col.g, col.b);
    const cream = CREAM, stone = STONE, doorCols = DOOR_COLS, awnCols = AWN_COLS;
    const gb = new GeoBuilder();
    const ov = CONFIG.building.roofOverhang, pitch = CONFIG.building.roofPitch;

    const rng = makeRng(b.seed);
    const base = b.gMin - 1.2;
    const q = b.corners;

    // --- walls, stone plinth, cornice ---
    if (b.arch) {
      // Archway / covered passage: the house sits on two piers over the lane.
      const a = b.arch, hw = b.w / 2, hd = b.d / 2;
      gb.prism(q, a.y, b.top, b.facade, false, true);
      const piers = a.axis === 'f'
        ? [this._rectPart(b, -hw, a.lo, -hd, hd), this._rectPart(b, a.hi, hw, -hd, hd)]
        : [this._rectPart(b, -hw, hw, -hd, a.lo), this._rectPart(b, -hw, hw, a.hi, hd)];
      for (const pier of piers) if (dist(pier[0], pier[1]) > 0.2 && dist(pier[1], pier[2]) > 0.2) gb.prism(pier, base, a.y + 0.05, b.facade, false);
      // a stone lintel over each opening
      const lint = a.axis === 'f' ? this._rectPart(b, a.lo - 0.15, a.hi + 0.15, -hd - 0.05, hd + 0.05)
                                  : this._rectPart(b, -hw - 0.05, hw + 0.05, a.lo - 0.15, a.hi + 0.15);
      gb.prism(lint, a.y - 0.4, a.y - 0.1, stone);
    } else {
      gb.prism(q, base, b.top, b.facade, false);
      const hb = this._harbourBase(b, rng);
      if (hb) {
        // rough stone base, battered at the foot, with a pale string course on top
        gb.prism(offsetPoly(q, 0.14), base, hb.top, hb.col);
        gb.prism(offsetPoly(q, 0.26), base, b.gMin + 0.9, hb.col.clone().multiplyScalar(0.9));
        gb.prism(offsetPoly(q, 0.18), hb.top - 0.04, hb.top + 0.16, cream);
        if (hb.vault) {
          const { edge, w, h } = hb.vault;
          const A = q[edge], Bc = q[(edge + 1) % 4], n = edgeNormal(q, edge);
          const m = lerp2(A, Bc, 0.5), g = t.heightAt(m[0], m[1]);
          put('vault', m[0] + n[0] * 0.16, g - 0.05, m[1] + n[1] * 0.16, Math.atan2(n[0], n[1]), w, h / 1.1, 1, WHITE);
        }
      } else {
        gb.prism(offsetPoly(q, 0.06), base, b.gMin + 0.45, stone);
      }
    }
    const corniceCol = rng() < 0.6 ? cream : b.facade.clone().offsetHSL(0, -0.1, 0.12);
    gb.prism(offsetPoly(q, 0.11), b.top - 0.32, b.top, corniceCol);

    // --- roof ---
    this._roof(gb, b, ov, pitch);
    if (rng() < 0.55) {
      const back = lerp2(q[2], q[3], 0.5 + (rng() - 0.5) * 0.6);
      const p = lerp2(centroid(q), back, 0.55);
      put('chimney', p[0], b.top + 0.35, p[1], b.theta, 1, 1, 1, b.facade);
    }

    // --- facades: windows along every wall ---
    const closedChance = rng() * 0.6;
    for (let i = 0; i < 4; i++) {
      const A = q[i], Bc = q[(i + 1) % 4];
      const L = dist(A, Bc);
      if (L < 1.6) continue;
      const n = edgeNormal(q, i), e = norm(sub(Bc, A));
      const front = i === 0;
      const cols = front ? Math.max(1, Math.round(L / 2.0)) : Math.max(1, Math.round(L / 2.9));
      const srot = Math.atan2(n[0], n[1]);
      let lowestFloor = true;
      for (let k = 0; ; k++) {
        const floorBottom = b.top - FH * (k + 1);
        if (floorBottom < base) break;
        const wy = floorBottom + 1.55;
        let any = false;
        for (let ci = 0; ci < cols; ci++) {
          const u = L * ((ci + 0.5) / cols);
          const wx = A[0] + e[0] * u, wz = A[1] + e[1] * u;
          const ground = t.heightAt(wx, wz);
          if (floorBottom < ground - 0.4) continue;           // this storey is underground here
          if (b.arch && floorBottom < b.arch.y - 0.2) continue; // below the rooms of an archway house
          if (b.stoneTop && floorBottom < b.stoneTop - 0.5) continue; // the stone base / boat store
          // hidden behind a neighbour's wall?
          if (this.growth.blockerTop(wx + n[0] * 0.8, wz + n[1] * 0.8) > wy - 0.5) continue;
          const px = wx + n[0] * 0.02, pz = wz + n[1] * 0.02;
          const groundFloor = floorBottom < ground + 1.2;
          if (front && groundFloor) {
            any = true;
            if (b.kind === ZONE.COM) {
              if (ci === Math.floor(cols / 2) || cols === 1) {
                put('shop', px, Math.max(floorBottom, ground - 0.1), pz, srot, Math.min(1, L / cols / 2.6), 1, 1, WHITE);
                put('awning', px + n[0] * 0.55, Math.max(floorBottom, ground) + 2.75, pz + n[1] * 0.55, srot, Math.min(2.6, L / cols), 1, 1, awnCols[(b.seed >> 3) % awnCols.length]);
              }
            } else if (b.vaultEdge === i) {
              // the boat store is this wall's ground floor
            } else if (ci === Math.floor((cols - 1) / 2)) {
              put('door', px, Math.max(floorBottom, ground - 0.1), pz, srot, 1, 1, 1, doorCols[(b.seed >> 5) % 3]);
            } else {
              this._window(put, px, wy, pz, srot, b, rng, closedChance, false);
            }
            continue;
          }
          any = true;
          const balcony = front && b.balconies && !lowestFloor && rng() < 0.4;
          this._window(put, px, wy, pz, srot, b, rng, closedChance, balcony);
        }
        if (any) lowestFloor = false;
      }
    }

    // --- pack the detail instances as ready-made matrices ---
    const parts = {};
    for (const [k, arr] of Object.entries(lists)) {
      const n = arr.length / 10, M = new Float32Array(n * 16), C = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const o = i * 10, m = i * 16;
        const x = arr[o], y = arr[o + 1], z = arr[o + 2], r = arr[o + 3];
        const sx = arr[o + 4], sy = arr[o + 5], sz = arr[o + 6];
        const c = Math.cos(r), s = Math.sin(r);
        // column-major matrix for: translate · rotateY(r) · scale(sx, sy, sz)
        M[m] = c * sx; M[m + 2] = -s * sx;
        M[m + 5] = sy;
        M[m + 8] = s * sz; M[m + 10] = c * sz;
        M[m + 12] = x; M[m + 13] = y; M[m + 14] = z; M[m + 15] = 1;
        C[i * 3] = arr[o + 7]; C[i * 3 + 1] = arr[o + 8]; C[i * 3 + 2] = arr[o + 9];
      }
      parts[k] = { n, m: M, c: C };
    }
    const g = gb.arrays((x, z, nx, nz) => this._enclosure(b, x, z, nx, nz), t);
    return { ver: b.ver, pos: g.pos, nor: g.nor, col: g.col, ao: g.ao, parts };
  }

  _window(put, x, y, z, rot, b, rng, closedChance, balcony) {
    put('window', x, y, z, rot, 1, 1, 1, WHITE);
    // a few slightly different shades per house, made once (not per window)
    if (!b.shutterShades) b.shutterShades = [-0.025, 0, 0.025].map((k) => b.shutter.clone().offsetHSL(0, 0, k));
    const shut = b.shutterShades[(rng() * 3) | 0];
    put(rng() < closedChance ? 'shutterClosed' : 'shutterOpen', x, y, z, rot, 1, 1, 1, shut);
    if (balcony) put('balcony', x, y, z, rot, 1, 1, 1, WHITE);
  }
}

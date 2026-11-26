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

  /** Vertical prism over a convex 2D polygon from y0 to y1. */
  prism(poly, y0, y1, c, top = true, bottom = false) {
    if (y1 - y0 < 0.01) return;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = edgeNormal(poly, i);
      this.face([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], c, [n[0], 0, n[1]]);
    }
    if (top) this.face(poly.map((p) => [p[0], y1, p[1]]), c, [0, 1, 0]);
    if (bottom) this.face(poly.map((p) => [p[0], y0, p[1]]), c, [0, -1, 0]);
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
    this.mass = null;   // the merged walls + roofs mesh

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

  /** Corners of part of an archway house's rectangle, in its local frame. */
  _rectPart(b, u0, u1, v0, v1) {
    return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]].map(([u, v]) => [b.x + b.rx * u + b.fx * v, b.z + b.rz * u + b.fz * v]);
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

  rebuild(buildings) {
    const t = this.terrain;
    const lists = {};
    for (const k of Object.keys(this.parts)) lists[k] = [];
    // instance = [x, y, z, rotY, sx, sy, sz, colour]
    const put = (k, x, y, z, rot, sx, sy, sz, col) => lists[k].push(x, y, z, rot, sx, sy, sz, col.r, col.g, col.b);
    const WHITE = new THREE.Color(1, 1, 1);
    const cream = new THREE.Color('#f3ead6');
    const stone = new THREE.Color('#9c9184');
    const doorCols = [new THREE.Color('#3b5d46'), new THREE.Color('#6b4a33'), new THREE.Color('#2f5f78')];
    const awnCols = [new THREE.Color('#d24b3f'), new THREE.Color('#2e7cb8'), new THREE.Color('#3b9c6b'), new THREE.Color('#e3a63a')];
    const gb = new GeoBuilder();
    const ov = CONFIG.building.roofOverhang, pitch = CONFIG.building.roofPitch;

    // tops first, so neighbour checks use the current heights
    for (const b of buildings) b.top = b.gMax + b.floors * FH;

    for (const b of buildings) {
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
        gb.prism(offsetPoly(q, 0.06), base, b.gMin + 0.45, stone);
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
    }

    // --- the merged walls + roofs mesh ---
    if (this.mass) { this.group.remove(this.mass); this.mass.geometry.dispose(); }
    this.mass = new THREE.Mesh(gb.toGeometry(), this.massMat);
    this.mass.castShadow = true;
    this.mass.receiveShadow = true;
    this.group.add(this.mass);

    // --- write instance buffers ---
    for (const [k, arr] of Object.entries(lists)) {
      const n = arr.length / 10;
      const mesh = this._ensure(k, n);
      const M = mesh.instanceMatrix.array, C = mesh.instanceColor.array;
      for (let i = 0; i < n; i++) {
        const o = i * 10, m = i * 16;
        const x = arr[o], y = arr[o + 1], z = arr[o + 2], r = arr[o + 3];
        const sx = arr[o + 4], sy = arr[o + 5], sz = arr[o + 6];
        const c = Math.cos(r), s = Math.sin(r);
        // column-major matrix for: translate · rotateY(r) · scale(sx, sy, sz)
        M[m] = c * sx; M[m + 1] = 0; M[m + 2] = -s * sx; M[m + 3] = 0;
        M[m + 4] = 0; M[m + 5] = sy; M[m + 6] = 0; M[m + 7] = 0;
        M[m + 8] = s * sz; M[m + 9] = 0; M[m + 10] = c * sz; M[m + 11] = 0;
        M[m + 12] = x; M[m + 13] = y; M[m + 14] = z; M[m + 15] = 1;
        C[i * 3] = arr[o + 7]; C[i * 3 + 1] = arr[o + 8]; C[i * 3 + 2] = arr[o + 9];
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  _window(put, x, y, z, rot, b, rng, closedChance, balcony) {
    put('window', x, y, z, rot, 1, 1, 1, new THREE.Color(1, 1, 1));
    const shut = b.shutter.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    put(rng() < closedChance ? 'shutterClosed' : 'shutterOpen', x, y, z, rot, 1, 1, 1, shut);
    if (balcony) put('balcony', x, y, z, rot, 1, 1, 1, new THREE.Color(1, 1, 1));
  }
}

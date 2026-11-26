// ---------------------------------------------------------------------------
// buildings.js — turns building records into instanced low-poly meshes.
//
// Every part type (walls, roofs, windows, shutters, balconies, doors, ...) is
// ONE InstancedMesh, so a town of hundreds of houses is only a dozen draw
// calls — important for phones. The whole set is rebuilt a few times per
// second while the town grows (fast: it's only filling number arrays).
//
// A building's body runs from below its lowest ground up to
//     top = (uphill ground) + floors × floorHeight
// so on a slope the downhill facade is taller ("stepping down the hill").
// Windows are laid out per storey from the roof down and are skipped where
// they'd be underground or covered by a neighbour's wall.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './noise.js';
import { ZONE } from './zones.js';

const FH = CONFIG.building.floorHeight;

// ---- geometry helpers ---------------------------------------------------------

/** Convex polyhedron from triangles; winds every face outward automatically. */
function convexGeo(tris, centre) {
  const pos = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), m = new THREE.Vector3();
  for (const [p, q, r] of tris) {
    a.fromArray(p); b.fromArray(q); c.fromArray(r);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).sub(centre);
    if (n.dot(mid) < 0) pos.push(...p, ...r, ...q); else pos.push(...p, ...q, ...r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];

/** Unit gable roof: base 1×1 at y=0, ridge along x at y=1. */
function gableGeometry() {
  const A = [-0.5, 0, -0.5], Bq = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const R1 = [-0.5, 1, 0], R2 = [0.5, 1, 0];
  return convexGeo([...quad(D, C, R2, R1), ...quad(Bq, A, R1, R2), [A, D, R1], [C, Bq, R2], ...quad(A, Bq, C, D)], new THREE.Vector3(0, 0.35, 0));
}
/** Unit hip roof: like the gable but the ends slope too. */
function hipGeometry() {
  const A = [-0.5, 0, -0.5], Bq = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
  const R1 = [-0.2, 1, 0], R2 = [0.2, 1, 0];
  return convexGeo([...quad(D, C, R2, R1), ...quad(Bq, A, R1, R2), [A, D, R1], [C, Bq, R2], ...quad(A, Bq, C, D)], new THREE.Vector3(0, 0.35, 0));
}

/** Merge several (geometry, colour) pairs into one vertex-coloured geometry. */
function mergeColoured(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, hex] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
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

// ---- the renderer -------------------------------------------------------------

export class BuildingRenderer {
  constructor(terrain, growth) {
    this.terrain = terrain;
    this.growth = growth;
    this.group = new THREE.Group();
    this.group.name = 'buildings';

    const lambert = (opts = {}) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true, ...opts });
    const vc = lambert({ vertexColors: true });

    // Each "part" = geometry + material + whether it casts shadows.
    this.parts = {
      body:    { geo: box(1, 1, 1, 0, 0.5, 0), mat: lambert(), shadow: true },
      plinth:  { geo: box(1, 1, 1, 0, 0.5, 0), mat: lambert({ color: '#9c9184' }), shadow: false },
      cornice: { geo: box(1, 1, 1, 0, 0.5, 0), mat: lambert(), shadow: false },
      gable:   { geo: gableGeometry(), mat: lambert(), shadow: true },
      hip:     { geo: hipGeometry(), mat: lambert(), shadow: true },
      terrace: { geo: box(1, 1, 1, 0, 0.5, 0), mat: lambert(), shadow: true },
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

  rebuild(buildings) {
    const t = this.terrain;
    const lists = {};
    for (const k of Object.keys(this.parts)) lists[k] = [];
    // instance = [x, y, z, rotY, sx, sy, sz, colour]
    const put = (k, x, y, z, rot, sx, sy, sz, col) => lists[k].push(x, y, z, rot, sx, sy, sz, col.r, col.g, col.b);
    const WHITE = new THREE.Color(1, 1, 1);
    const cream = new THREE.Color('#f3ead6');
    const doorCols = [new THREE.Color('#3b5d46'), new THREE.Color('#6b4a33'), new THREE.Color('#2f5f78')];
    const awnCols = [new THREE.Color('#d24b3f'), new THREE.Color('#2e7cb8'), new THREE.Color('#3b9c6b'), new THREE.Color('#e3a63a')];

    // tops first, so neighbour checks use the current heights
    for (const b of buildings) b.top = b.gMax + b.floors * FH;

    for (const b of buildings) {
      const rng = makeRng(b.seed);
      const base = b.gMin - 1.2;
      const H = b.top - base;
      const rot = b.theta;
      // --- walls, stone plinth, cornice ---
      if (b.arch) {
        // Archway / covered passage: the house sits on two piers over the lane.
        const a = b.arch;
        put('body', b.x, a.y, b.z, rot, b.w, b.top - a.y, b.d, b.facade);
        const piers = a.axis === 'f'
          ? [[-b.w / 2, a.lo, 'x'], [a.hi, b.w / 2, 'x']]
          : [[-b.d / 2, a.lo, 'z'], [a.hi, b.d / 2, 'z']];
        for (const [lo, hi, ax] of piers) {
          const mid = (lo + hi) / 2, len = hi - lo;
          if (len < 0.2) continue;
          const px = b.x + (ax === 'x' ? b.rx : b.fx) * mid, pz = b.z + (ax === 'x' ? b.rz : b.fz) * mid;
          if (ax === 'x') put('body', px, base, pz, rot, len, a.y - base + 0.05, b.d, b.facade);
          else put('body', px, base, pz, rot, b.w, a.y - base + 0.05, len, b.facade);
        }
        // a stone lintel over each opening
        const lintW = a.axis === 'f' ? a.hi - a.lo + 0.3 : b.w + 0.1;
        const lintD = a.axis === 'f' ? b.d + 0.1 : a.hi - a.lo + 0.3;
        const lm = (a.lo + a.hi) / 2;
        const lx = b.x + (a.axis === 'f' ? b.rx * lm : b.fx * lm), lz = b.z + (a.axis === 'f' ? b.rz * lm : b.fz * lm);
        put('plinth', lx, a.y - 0.25, lz, rot, lintW, 0.3, lintD, WHITE);
      } else {
        put('body', b.x, base, b.z, rot, b.w, H, b.d, b.facade);
        put('plinth', b.x, base, b.z, rot, b.w + 0.12, b.gMin - base + 0.45, b.d + 0.12, WHITE);
      }
      const corniceCol = rng() < 0.6 ? cream : b.facade.clone().offsetHSL(0, -0.1, 0.12);
      put('cornice', b.x, b.top - 0.32, b.z, rot, b.w + 0.22, 0.32, b.d + 0.22, corniceCol);

      // --- roof ---
      const ov = CONFIG.building.roofOverhang, pitch = CONFIG.building.roofPitch;
      if (b.roof === 'flat') {
        put('terrace', b.x, b.top, b.z, rot, b.w + 0.1, 0.55, b.d + 0.1, b.facade.clone().offsetHSL(0, -0.05, 0.06));
        put('terrace', b.x, b.top + 0.05, b.z, rot, b.w - 0.5, 0.52, b.d - 0.5, b.roofCol);
      } else if (b.roof === 'gableX') {
        // ridge runs downhill: gable end faces the sea
        put('gable', b.x, b.top, b.z, rot + Math.PI / 2, b.d + ov * 2, pitch * (b.w + 2 * ov) + 0.15, b.w + ov * 2, b.roofCol);
      } else {
        put(b.roof === 'hip' ? 'hip' : 'gable', b.x, b.top, b.z, rot, b.w + ov * 2, pitch * (b.d + 2 * ov) + 0.15, b.d + ov * 2, b.roofCol);
      }
      if (rng() < 0.55) {
        const u = (rng() - 0.5) * b.w * 0.6, v = -b.d * 0.25;
        put('chimney', b.x + b.rx * u + b.fx * v, b.top + 0.4, b.z + b.rz * u + b.fz * v, rot, 1, 1, 1, b.facade);
      }

      // --- facades ---
      const sides = [
        { nx: b.fx, nz: b.fz, e: b.d / 2, tx: b.rx, tz: b.rz, L: b.w, front: true },
        { nx: -b.fx, nz: -b.fz, e: b.d / 2, tx: -b.rx, tz: -b.rz, L: b.w },
        { nx: b.rx, nz: b.rz, e: b.w / 2, tx: -b.fx, tz: -b.fz, L: b.d },
        { nx: -b.rx, nz: -b.rz, e: b.w / 2, tx: b.fx, tz: b.fz, L: b.d },
      ];
      const closedChance = rng() * 0.6;
      for (const s of sides) {
        const cols = s.front ? Math.max(1, Math.round(b.w / 2.0)) : Math.max(1, Math.round(s.L / 2.9));
        const srot = Math.atan2(s.nx, s.nz);
        let lowestFloor = true;
        for (let k = 0; ; k++) {
          const floorBottom = b.top - FH * (k + 1);
          if (floorBottom < base) break;
          const wy = floorBottom + 1.55;
          let any = false;
          for (let ci = 0; ci < cols; ci++) {
            const u = s.L * ((ci + 0.5) / cols - 0.5);
            const wx = b.x + s.nx * s.e + s.tx * u, wz = b.z + s.nz * s.e + s.tz * u;
            const ground = t.heightAt(wx, wz);
            if (floorBottom < ground - 0.4) continue;           // this storey is underground here
            if (b.arch && floorBottom < b.arch.y - 0.2) continue; // below the rooms of an archway house
            // hidden behind a neighbour's wall?
            if (this.growth.blockerTop(wx + s.nx * 0.8, wz + s.nz * 0.8) > wy - 0.5) continue;
            const px = wx + s.nx * 0.02, pz = wz + s.nz * 0.02;
            const groundFloor = floorBottom < ground + 1.2;
            if (s.front && groundFloor) {
              any = true;
              if (b.kind === ZONE.COM) {
                if (ci === Math.floor(cols / 2) || cols === 1) {
                  put('shop', px, Math.max(floorBottom, ground - 0.1), pz, srot, Math.min(1, s.L / cols / 2.6), 1, 1, WHITE);
                  put('awning', px + s.nx * 0.55, Math.max(floorBottom, ground) + 2.75, pz + s.nz * 0.55, srot, Math.min(2.6, s.L / cols), 1, 1, awnCols[(b.seed >> 3) % awnCols.length]);
                }
              } else if (ci === Math.floor((cols - 1) / 2)) {
                put('door', px, Math.max(floorBottom, ground - 0.1), pz, srot, 1, 1, 1, doorCols[(b.seed >> 5) % 3]);
              } else {
                this._window(put, px, wy, pz, srot, b, rng, closedChance, false);
              }
              continue;
            }
            any = true;
            const balcony = s.front && b.balconies && !lowestFloor && rng() < 0.4;
            this._window(put, px, wy, pz, srot, b, rng, closedChance, balcony);
          }
          if (any) lowestFloor = false;
        }
      }
    }

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

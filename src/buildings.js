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
const DARK = new THREE.Color('#2a2420'), IRON = new THREE.Color('#2e2b28');
const DOOR_WEATHERED = ['#7d6b55', '#6e5f4e', '#8a7a64', '#5f6e5f', '#5d6b78', '#7a5e48'];   // sun-bleached timber, faded paint
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

  /** Add every triangle of a three.js geometry, transformed by `m`, in one colour. */
  geometry(geo, m, c) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < P.count; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(P, i + k).applyMatrix4(m);
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      const l = n.length();
      if (l < 1e-9) continue;
      n.divideScalar(l);
      this._tri(v[0].toArray(), v[1].toArray(), v[2].toArray(), n.toArray(), c);
    }
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

/** A round-headed arch outline: width w, total height h, origin at the bottom centre. */
function archShape(w, h, shape = new THREE.Shape()) {
  const r = w / 2, ys = h - r;
  shape.moveTo(-r, 0); shape.lineTo(r, 0); shape.lineTo(r, ys);
  shape.absarc(0, ys, r, 0, Math.PI, false);
  shape.lineTo(-r, 0);
  return shape;
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
      // the glass: an interior-mapped fake room behind every window (see _glassMaterial)
      glass:   { geo: new THREE.PlaneGeometry(0.74, 1.24).translate(0, 0, 0.072), mat: this._glassMaterial(), shadow: false },
      shutterOpen:   { geo: mergeColoured([[box(0.42, 1.3, 0.05, -0.68, 0, 0.03), '#ffffff'], [box(0.42, 1.3, 0.05, 0.68, 0, 0.03), '#ffffff']]), mat: lambert(), shadow: false },
      shutterClosed: { geo: mergeColoured([[box(0.8, 1.3, 0.06, 0, 0, 0.07), '#ffffff'], [box(0.8, 0.05, 0.02, 0, 0, 0.11), '#c8c8c8']]), mat: lambert({ vertexColors: true }), shadow: false },
      balcony: { geo: mergeColoured([[box(1.45, 0.14, 0.8, 0, -0.75, 0.4), '#e5dccb'], [box(1.45, 0.08, 0.05, 0, -0.05, 0.78), '#2d2d2d'],
                                     [box(0.05, 0.7, 0.05, -0.7, -0.4, 0.78), '#2d2d2d'], [box(0.05, 0.7, 0.05, 0.7, -0.4, 0.78), '#2d2d2d'],
                                     [box(1.4, 0.03, 0.03, 0, -0.35, 0.78), '#2d2d2d']]), mat: vc, shadow: false },
      door:    { geo: box(0.95, 2.05, 0.1, 0, 1.03, 0.03), mat: lambert(), shadow: false },
      shop:    { geo: mergeColoured([[box(2.5, 2.4, 0.08, 0, 1.2, 0), '#ece3cf'], [box(2.2, 2.1, 0.06, 0, 1.12, 0.04), '#3a3d44']]), mat: vc, shadow: false },
      awning:  { geo: box(1, 0.08, 1.3).rotateX(0.4), mat: lambert(), shadow: true },
      chimney: { geo: mergeColoured([[box(0.55, 1.2, 0.55, 0, 0.6, 0), '#ffffff'], [box(0.75, 0.12, 0.75, 0, 1.25, 0), '#d8d0c0']]), mat: lambert({ vertexColors: true }), shadow: true },
      // the inside of an open boat store: an interior-mapped vaulted room (see _storeMaterial)
      storeRoom: { geo: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), mat: this._storeMaterial(), shadow: false },
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

  /** A local frame on a wall: origin `o` (x, z), x along the wall, z out of it. */
  _wallFrame(ox, oy, oz, nx, nz) {
    const ez = new THREE.Vector3(nx, 0, nz).normalize(), ey = new THREE.Vector3(0, 1, 0);
    const ex = new THREE.Vector3().crossVectors(ey, ez);
    return new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(ox, oy, oz);
  }

  /**
   * A boat store with real depth: a thick dressed-stone arch standing out from
   * the stone base, its reveal (the arched tunnel through the frame) lit and
   * shadowed like any wall, and at the back either weathered timber double
   * doors or — for a few — the open store itself (an interior-mapped vaulted
   * room with a boat or nets; see _storeMaterial).
   */
  _boatStore(gb, put, b, v, rng) {
    const S = CONFIG.harbour.stoneBase, t = this.terrain, q = b.corners;
    const { edge, w, h } = v;
    const A = q[edge], Bc = q[(edge + 1) % 4], n = edgeNormal(q, edge);
    const mid = lerp2(A, Bc, 0.5), g = t.heightAt(mid[0], mid[1]) - 0.05;
    const M = this._wallFrame(mid[0] + n[0] * 0.14, g, mid[1] + n[1] * 0.14, n[0], n[1]);
    const F = S.frameWidth, P = S.portalDepth;
    // the frame: a stone block with the arch cut through it (the reveal comes free)
    const outer = new THREE.Shape();
    outer.moveTo(-w / 2 - F, 0); outer.lineTo(w / 2 + F, 0); outer.lineTo(w / 2 + F, h + F * 0.8); outer.lineTo(-w / 2 - F, h + F * 0.8); outer.lineTo(-w / 2 - F, 0);
    outer.holes.push(archShape(w, h, new THREE.Path()));
    const frameCol = new THREE.Color('#bcb09a').offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    gb.geometry(new THREE.ExtrudeGeometry(outer, { depth: P, bevelEnabled: false, curveSegments: 12 }), M, frameCol);
    // a keystone, standing a little proud
    const key = new THREE.BoxGeometry(0.34, 0.42, 0.08).translate(0, h + 0.05, P + 0.03);
    gb.geometry(key, M, frameCol.clone().multiplyScalar(1.06));
    // the back of the opening
    const r = w / 2, ys = h - r;
    const at = (x, z) => new THREE.Vector3(x, 0, z);
    gb.geometry(new THREE.ShapeGeometry(archShape(w, h), 12).translate(0, 0, 0.01), M, DARK);
    if (rng() < S.openChance) {
      // open: the store inside, interior-mapped behind the arch (lit some nights)
      const o = at(0, 0.03).applyMatrix4(M);
      this._gc.setRGB(rng(), rng(), rng());
      put('storeRoom', o.x, o.y, o.z, Math.atan2(n[0], n[1]), w, h, 1, this._gc);
      return;
    }
    // closed: weathered timber double doors, plank by plank
    const base = new THREE.Color(rng.pick(DOOR_WEATHERED));
    const N = 2 * Math.max(3, Math.round(w / 0.5));      // even, so the leaves meet in the middle
    const pw = w / N, topAt = (x) => ys + Math.sqrt(Math.max(r * r - x * x, 0));
    for (let i = 0; i < N; i++) {
      const x0 = -r + i * pw + (i === N / 2 ? 0.03 : 0.012), x1 = -r + (i + 1) * pw - (i === N / 2 - 1 ? 0.03 : 0.012);
      const z = 0.03 + rng() * 0.012;
      const c = base.clone().offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08);
      const pts = [[x0, 0.02], [x1, 0.02], [x1, topAt(x1) - 0.02], [x0, topAt(x0) - 0.02]].map(([x, y]) => new THREE.Vector3(x, y, z).applyMatrix4(M).toArray());
      gb.face(pts, c, new THREE.Vector3(n[0], 0, n[1]).toArray());
    }
    // iron straps across each leaf, and a ring handle
    for (const y of [0.35, Math.min(ys, h * 0.72)]) for (const s of [-1, 1]) {
      const strap = new THREE.BoxGeometry(r - 0.12, 0.07, 0.02).translate(s * (r / 2 + 0.02), y, 0.05);
      gb.geometry(strap, M, IRON);
    }
    gb.geometry(new THREE.TorusGeometry(0.07, 0.015, 4, 8).translate(0.1, 1.05, 0.06), M, IRON);
  }

  /**
   * A lane passing under a house gets a stone vault: a segmental arch lining
   * the passage from end to end, so it reads as a tunnel, not a flat slot.
   */
  _passageVault(gb, b, stone) {
    const a = b.arch, hw = b.w / 2, hd = b.d / 2;
    const half = (a.hi - a.lo) / 2, mid = (a.lo + a.hi) / 2;
    const rise = Math.min(CONFIG.path.archRise, half * 0.9);
    const R = (half * half + rise * rise) / (2 * rise);
    // the spandrels: the space between the flat soffit and the arch curve
    const sh = new THREE.Shape();
    const spring = a.y - rise, a1 = Math.atan2(R - rise, half);
    sh.moveTo(a.lo, spring); sh.lineTo(a.lo, a.y + 0.02); sh.lineTo(a.hi, a.y + 0.02); sh.lineTo(a.hi, spring);
    sh.absarc(mid, a.y - R, R, a1, Math.PI - a1, false);
    // a frame along the passage: x across the lane, z along it
    let ex, ez, len;
    if (a.axis === 'f') { ex = new THREE.Vector3(b.rx, 0, b.rz); ez = new THREE.Vector3(b.fx, 0, b.fz); len = 2 * hd; }
    else { ex = new THREE.Vector3(b.fx, 0, b.fz); ez = new THREE.Vector3(-b.rx, 0, -b.rz); len = 2 * hw; }
    const ey = new THREE.Vector3(0, 1, 0);
    const M = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(b.x, 0, b.z);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: len + 0.06, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -len / 2 - 0.03);
    gb.geometry(geo, M, stone.clone().multiplyScalar(1.12));
    // dressed-stone arch rings at both ends
    const ring = new THREE.Shape();
    ring.absarc(mid, a.y - R, R + 0.22, a1 - 0.05, Math.PI - a1 + 0.05, false);
    ring.absarc(mid, a.y - R, R, Math.PI - a1, a1, true);
    for (const z of [-len / 2 - 0.08, len / 2 - 0.02]) {
      gb.geometry(new THREE.ExtrudeGeometry(ring, { depth: 0.1, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, z), M, CREAM);
    }
  }

  /**
   * Inside an open boat store: a ray from the eye is marched into a barrel-
   * vaulted room behind the arch (in metres, in the opening's own frame), which
   * may hold a boat on the floor and nets hanging on a side wall. Dim by day,
   * darker toward the back; some light a warm lantern as evening falls.
   */
  _storeMaterial() {
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.glassUniforms);
      sh.vertexShader = 'varying vec3 vPosM;\nvarying vec3 vCamM;\nvarying vec2 vDim;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 mI = modelMatrix;
        vec3 sc = vec3(1.0);
        #ifdef USE_INSTANCING
          mI = modelMatrix * instanceMatrix;
          sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), 1.0);
        #endif
        vDim = sc.xy;                                    // opening width, height (m)
        vPosM = position * sc;
        vCamM = (inverse(mI) * vec4(cameraPosition, 1.0)).xyz * sc;`);
      sh.fragmentShader = `uniform float uLit, uDay; uniform vec3 uWarm;
        varying vec3 vPosM; varying vec3 vCamM; varying vec2 vDim;
        // what is at p inside the store: 0 air, 1 boat, 2 floor, 3 back wall, 4 side wall / vault
        float storeCell(vec3 p, vec3 boatC, bool boat, float W, float D, float spring, float rise) {
          if (boat) {
            vec3 b = (p - boatC) / vec3(0.75, 0.55, 2.1);
            float rr = dot(b.xz, b.xz);
            // an open hull: solid shell, hollow inside down to its boards
            if (rr < 1.0 && p.y < 0.55 && p.y > 0.55 - 0.55 * sqrt(1.0 - rr) && !(rr < 0.72 && p.y > 0.22)) return 1.0;
          }
          if (p.y < 0.0) return 2.0;
          if (p.z < -D) return 3.0;
          float ceil = spring + rise * sqrt(max(1.0 - (p.x * p.x) / (W * W), 0.0));
          if (abs(p.x) > W || p.y > ceil) return 4.0;
          return 0.0;
        }
        ` + sh.fragmentShader.replace('#include <color_fragment>', `
        vec3 rnd = vec3(0.5);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          rnd = vColor.rgb;
        #endif
        float r = vDim.x * 0.5;
        // only inside the arch outline
        if (vPosM.y > vDim.y - r && length(vec2(vPosM.x, vPosM.y - (vDim.y - r))) > r) discard;
        vec3 o = vPosM, d = normalize(vPosM - vCamM);
        float W = r + 0.7, D = 5.5, spring = max(vDim.y - r - 0.2, 1.4), rise = W * 0.75;
        // march into the room, then bisect each hit for clean edges
        vec3 boatC = vec3((rnd.g - 0.5) * 0.6, 0.0, -2.8);
        bool boat = rnd.b > 0.2, nets = rnd.b < 0.8;
        float hit = 0.0, tt = 0.0, kind = 0.0;
        vec3 p = o; vec3 col = vec3(0.0);
        for (int i = 0; i < 56; i++) {
          tt += 0.12;
          p = o + d * tt;
          if (p.z > 0.05) break;
          kind = storeCell(p, boatC, boat, W, D, spring, rise);
          if (kind > 0.0) { hit = 1.0; break; }
        }
        if (hit > 0.5) {
          float lo = tt - 0.12, hi = tt;
          for (int k = 0; k < 6; k++) { float m = 0.5 * (lo + hi); if (storeCell(o + d * m, boatC, boat, W, D, spring, rise) > 0.0) hi = m; else lo = m; }
          p = o + d * hi;
          kind = storeCell(p, boatC, boat, W, D, spring, rise);
          if (kind == 1.0) {
            vec3 bb = (p - boatC) / vec3(0.75, 0.55, 2.1);
            if (dot(bb.xz, bb.xz) < 0.72) col = vec3(0.5, 0.36, 0.22) * (0.85 + 0.15 * step(0.5, fract(p.z * 4.0)));   // boards
            else col = p.y > 0.5 ? vec3(0.75, 0.25, 0.2) : (p.y > 0.3 ? vec3(0.92, 0.9, 0.84) : vec3(0.22, 0.42, 0.62));
          }
          else if (kind == 2.0) col = vec3(0.45, 0.42, 0.38) * (0.8 + 0.2 * step(0.5, fract(p.x * 1.5 + floor(p.z * 1.5) * 0.5)));
          else if (kind == 3.0) col = vec3(0.62, 0.57, 0.5);
          else {
            col = vec3(0.66, 0.6, 0.52) * (p.y > spring ? 0.85 : 1.0);
            if (nets && p.x < 0.0 && p.y > 0.5 && p.y < 2.2 && p.z < -1.0 && p.z > -3.8 &&
                (fract(p.y * 7.0 + p.z * 2.0) < 0.22 || fract(p.z * 7.0) < 0.22)) col = vec3(0.32, 0.24, 0.16);
          }
        }
        if (hit < 0.5) col = vec3(0.3, 0.27, 0.24);
        // light: daylight from the doorway, falling off into the dark; or a lantern
        float depth = clamp(-p.z / D, 0.0, 1.0);
        float day = (0.06 + 0.3 * uDay) * mix(1.0, 0.18, depth) * (p.y > spring ? 0.75 : 1.0);
        float lit = smoothstep(rnd.r, rnd.r + 0.04, uLit * 0.8);
        vec3 lamp = uWarm * 1.4 / (1.0 + 0.25 * dot(p - vec3(0.0, spring, -1.5), p - vec3(0.0, spring, -1.5)));
        diffuseColor.rgb = col * (day + lit * lamp);`);
    };
    return m;
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

  /**
   * Interior mapping: a ray from the eye through the glass is traced into a
   * box-shaped room (back wall, side walls, floor, ceiling) in the window's own
   * space, so every window shows a little room with depth. By day the rooms are
   * dim; as evening falls, a growing share light up warm (uLit), bright enough
   * to bloom. Unlit (MeshBasic) so it costs only the window pixels.
   */
  _glassMaterial() {
    this._gc = new THREE.Color();
    this.glassUniforms = {
      uLit: { value: 0 }, uDay: { value: 1 }, uSky: { value: new THREE.Color('#bcd6ea') }, uWarm: { value: new THREE.Color('#ffc07a') },
    };
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.glassUniforms);
      sh.vertexShader = 'varying vec3 vPosL;\nvarying vec3 vCamL;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 mI = modelMatrix;
        #ifdef USE_INSTANCING
          mI = modelMatrix * instanceMatrix;
        #endif
        vCamL = (inverse(mI) * vec4(cameraPosition, 1.0)).xyz;
        vPosL = position;`);
      sh.fragmentShader = `uniform float uLit, uDay; uniform vec3 uSky, uWarm;
        varying vec3 vPosL; varying vec3 vCamL;
        ` + sh.fragmentShader.replace('#include <color_fragment>', `
        vec3 rnd = vec3(1.0);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          rnd = vColor.rgb;
        #endif
        // the room, in window space: glass at z = 0.072, room behind it
        vec3 o = vPosL - vec3(0.0, 0.0, 0.072);
        vec3 d = normalize(vPosL - vCamL);
        const vec3 R = vec3(1.3, 1.45, 3.0);       // half-width, half-height (around the window), depth
        float floorY = -1.55, ceilY = 1.45;
        float tx = ((d.x > 0.0 ? R.x : -R.x) - o.x) / d.x;
        float ty = ((d.y > 0.0 ? ceilY : floorY) - o.y) / d.y;
        float tz = (-R.z - o.z) / min(d.z, -1e-4);
        float t = min(tx, min(ty, tz));
        vec3 p = o + d * t;
        vec3 wall = mix(vec3(0.85, 0.78, 0.64), vec3(0.62, 0.72, 0.70), rnd.g);   // plaster tint
        vec3 col;
        float shade;
        if (t == tz) {            // back wall, with a dark wainscot and a picture
          col = wall; shade = 0.8;
          if (p.y < -0.75) col *= 0.6;
          if (abs(p.x - (rnd.b - 0.5)) < 0.3 && abs(p.y - 0.35) < 0.22) col = vec3(0.35, 0.25, 0.2);
        } else if (t == tx) {     // side walls
          col = wall * 0.85; shade = 0.65 + 0.2 * (p.z / R.z + 1.0);
        } else if (d.y < 0.0) {   // floor: terracotta tiles
          col = vec3(0.55, 0.32, 0.22) * (0.85 + 0.15 * step(0.5, fract(p.x * 2.0) + fract(p.z * 2.0) - 0.5)); shade = 0.6;
        } else {                  // ceiling, with dark beams
          col = vec3(0.9, 0.86, 0.78) * (fract(p.z * 1.4) < 0.2 ? 0.55 : 1.0); shade = 0.9;
        }
        col *= shade;
        // curtain drawn part way across
        float cur = rnd.b * 0.7;
        bool curtain = (o.x < -0.37 + cur * 0.74) && rnd.b > 0.35;
        if (curtain) col = mix(vec3(0.9, 0.86, 0.8), vec3(0.75, 0.3, 0.25), step(0.7, rnd.g)) * 0.9;
        // light: dim daylight inside, or a warm lamp once this room's light is on
        float lit = smoothstep(rnd.r, rnd.r + 0.04, uLit);
        float depthFall = 1.0 - 0.5 * clamp(-p.z / R.z, 0.0, 1.0);
        vec3 dayL = col * (0.07 + 0.11 * uDay) * depthFall;   // rooms are dim by day (glass reads dark)
        // lamplight falls off from a ceiling lamp; the lamp itself is bright enough to bloom
        vec3 lampPos = vec3((rnd.g - 0.5) * 0.8, ceilY - 0.25, -1.4);
        float near = 1.0 / (1.0 + 0.35 * dot(p - lampPos, p - lampPos));
        vec3 lampL = col * uWarm * (curtain ? 0.9 : 1.3) * (0.35 + 0.9 * near);
        if (!curtain && t == ty && d.y > 0.0) lampL += uWarm * 4.0 * smoothstep(0.32, 0.18, length(p.xz - lampPos.xz));
        vec3 inside = mix(dayL, lampL, lit);
        // the glass: a faint sky sheen, stronger at grazing angles
        float fres = pow(1.0 - abs(d.z), 3.0);
        diffuseColor.rgb = mix(inside, uSky * (0.15 + 0.35 * uDay), (0.08 + 0.45 * fres) * (1.0 - lit * 0.8));`);
    };
    return m;
  }

  /** Detail meshes too small to matter in a ripply reflection. */
  smallParts() {
    return ['shutterOpen', 'shutterClosed', 'balcony', 'door', 'awning', 'chimney', 'storeRoom']
      .map((k) => this.parts[k].mesh).filter(Boolean);
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
      this._passageVault(gb, b, stone);
    } else {
      gb.prism(q, base, b.top, b.facade, false);
      const hb = this._harbourBase(b, rng);
      if (hb) {
        // rough stone base, battered at the foot, with a pale string course on top
        gb.prism(offsetPoly(q, 0.14), base, hb.top, hb.col);
        gb.prism(offsetPoly(q, 0.26), base, b.gMin + 0.9, hb.col.clone().multiplyScalar(0.9));
        gb.prism(offsetPoly(q, 0.18), hb.top - 0.04, hb.top + 0.16, cream);
        if (hb.vault) this._boatStore(gb, put, b, hb.vault, rng);
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
    // per-window randoms (packed in the instance colour): when its light comes on,
    // the room's wall colour, and how far its curtain is drawn
    this._gc.setRGB(rng(), rng(), rng());
    put('glass', x, y, z, rot, 1, 1, 1, this._gc);
    // a few slightly different shades per house, made once (not per window)
    if (!b.shutterShades) b.shutterShades = [-0.025, 0, 0.025].map((k) => b.shutter.clone().offsetHSL(0, 0, k));
    const shut = b.shutterShades[(rng() * 3) | 0];
    put(rng() < closedChance ? 'shutterClosed' : 'shutterOpen', x, y, z, rot, 1, 1, 1, shut);
    if (balcony) put('balcony', x, y, z, rot, 1, 1, 1, WHITE);
  }
}

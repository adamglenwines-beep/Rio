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
import { makeRng, clamp } from './noise.js';
import { ZONE } from './zones.js';
import { sub, norm, dist, lerp2, centroid, edgeNormal, offsetPoly, chamferPoly, convexOverlap, pointInPoly } from './geom.js';
import { STYLES, registerStyled } from './style.js';
import { LAYERS } from './materials.js';
import { PALETTE, FACADES } from './data.js';
import { planHouse, groundLook } from './houseplan.js';
import { frameGeometry, sillGeometry, leafGeometry, surroundGeometry, doorGeometries, balconyGeometries, chairGeometry, shopfrontGeometry, signGeometry, archGeometries, awningGeometry, awningMaterial, WINDOW_TYPES, GLASS_Z } from './facade.js';

const FH = CONFIG.building.floorHeight;
const WHITE = new THREE.Color(1, 1, 1);
const CREAM = new THREE.Color('#f3ead6'), STONE = new THREE.Color('#9c9184');
const DOOR_COLS = [new THREE.Color('#3b5d46'), new THREE.Color('#6b4a33'), new THREE.Color('#2f5f78')];
const DARK = new THREE.Color('#2a2420'), IRON = new THREE.Color('#2e2b28');
const DOOR_WEATHERED = ['#7d6b55', '#6e5f4e', '#8a7a64', '#5f6e5f', '#5d6b78', '#7a5e48'];   // sun-bleached timber, faded paint
const TERRACOTTA = new THREE.Color('#b5653f'), LEAF = new THREE.Color('#4c6a2e'), AWN_CREAM = new THREE.Color('#ece6d6');
const AWN_COLS = [new THREE.Color('#d24b3f'), new THREE.Color('#2e7cb8'), new THREE.Color('#3b9c6b'), new THREE.Color('#e3a63a')];

// ---- geometry helpers ---------------------------------------------------------

/** Accumulates flat-shaded, vertex-coloured triangles into one BufferGeometry. */
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.lay = []; this.wall = []; this.bake = []; this.gnd = []; this.layer = -1; this.wear = 0; this.ground = NaN; }
  // this.wear: how worn this house's plaster is (0–0.95) plus flags in the whole part (1 = painted corner stones)
  // this.layer: the texture layer (materials.js LAYERS index, -1 = none) for what is added next
  // this.bake: three baked numbers per vertex (v0.18), worked out once when the house is built:
  //   x  how open to the sky this spot is: 1 = open wall … 0 = deep in a crease (inside a window reveal,
  //      right under a sill or a balcony, in the corner where a neighbour's wall juts out)
  //   y, z  weathering masks (v0.20): drip streaks under sills and balconies; scuffing round doors
  // this.ground: the "ground" under what is added next, when that is not the terrain (a wall that
  //   starts on a neighbour's roof): baked shade and damp gather there (NaN = the terrain)

  /** Give the last `n` vertices the neutral bake (open wall, no weathering) and the current ground. */
  _meta(n) { for (let i = 0; i < n; i++) { this.bake.push(1, 0, 0); this.gnd.push(this.ground); } }

  /** Set the bake of the last vertices: `list` = one [open, drip, scuff] per vertex. */
  _bakeLast(list) {
    const o = this.bake.length - list.length * 3;
    for (let i = 0; i < list.length; i++) { this.bake[o + i * 3] = list[i][0]; this.bake[o + i * 3 + 1] = list[i][1]; this.bake[o + i * 3 + 2] = list[i][2]; }
  }

  /** A planar quad p0→p1→p2→p3 facing along `want`, with a bake per corner (window reveals). */
  quadB(pts, c, want, bakes) {
    const [a, b, , d] = pts;
    const u = sub3(b, a), v = sub3(d, a);
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) return;
    n = n.map((k) => k / l);
    let P = pts, B = bakes;
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) { P = [...pts].reverse(); B = [...bakes].reverse(); n = n.map((k) => -k); }
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) { this._tri(P[i], P[j], P[k], n, c); this._bakeLast([B[i], B[j], B[k]]); }
  }

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
        this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c.r, c.g, c.b); this.lay.push(this.layer);
        this.wall.push(-1, 0, this.wear);
      }
      this._meta(3);
    }
  }

  /** Push one triangle with a known normal. */
  _tri(a, b, d, n, c) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
    this.nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    this.col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
    this.lay.push(this.layer, this.layer, this.layer);
    this.wall.push(-1, 0, this.wear, -1, 0, this.wear, -1, 0, this.wear);
    this._meta(3);
  }

  /** Push one triangle with a known normal and a colour per vertex. */
  _triVC(a, b, d, n, ca, cb, cd) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
    this.nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    this.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cd[0], cd[1], cd[2]);
    this.lay.push(this.layer, this.layer, this.layer);
    this.wall.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    this._meta(3);
  }

  /** Arrays for merged facade detail (frames, leaves, balconies…): textured per vertex, no baked AO. */
  arraysPlain(rand = 0) {
    const n = this.pos.length, ao = new Float32Array(n);
    for (let i = 0; i < n; i += 3) { ao[i] = -1e4; ao[i + 1] = 0; ao[i + 2] = this.lay[i / 3] + 1 + rand * 0.9; }
    return { pos: new Float32Array(this.pos), nor: new Float32Array(this.nor), col: new Float32Array(this.col), ao, wall: new Float32Array(this.wall), bake: new Float32Array(this.bake) };
  }

  /** Mark the last `count` vertices as wall: u = metres along the wall for each, L = the wall's length. */
  _wallUV(us, L) {
    const o = this.wall.length - us.length * 3;
    for (let i = 0; i < us.length; i++) { this.wall[o + i * 3] = us[i]; this.wall[o + i * 3 + 1] = L; }
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
  prism(poly, y0, y1, c, top = true, bottom = false, edgeNormals = null, polyTop = null) {
    if (y1 - y0 < 0.01) return;
    const n = poly.length, T = polyTop || poly;   // polyTop: a slightly smaller top outline (walls lean in)
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
      const ta = T[i], tb = T[(i + 1) % n];
      const A0 = [a[0], y0, a[1]], B0 = [b[0], y0, b[1]], B1 = [tb[0], y1, tb[1]], A1 = [ta[0], y1, ta[1]];
      const N = [nx, 0, nz];
      const en = edgeNormals && edgeNormals[i];
      if (en) {
        // a rounded corner: normals blend from one wall's to the next
        const NA = [en[0][0], 0, en[0][1]], NB = [en[1][0], 0, en[1][1]];
        const tri = (p1, n1, p2, n2, p3, n3) => {
          this.pos.push(...p1, ...p2, ...p3); this.nor.push(...n1, ...n2, ...n3);
          for (let k = 0; k < 3; k++) { this.col.push(c.r, c.g, c.b); this.lay.push(this.layer); this.wall.push(-1, 0, this.wear); }
          this._meta(3);
        };
        if (ccw) { tri(A0, NA, A1, NA, B1, NB); tri(A0, NA, B1, NB, B0, NB); }
        else { tri(A0, NA, B0, NB, B1, NB); tri(A0, NA, B1, NB, A1, NA); }
        continue;
      }
      // wind so the face points outward: (B0-A0) x (A1-A0) has direction (-ez, 0, ex)·sign
      if (ccw) { this._tri(A0, A1, B1, N, c); this._tri(A0, B1, B0, N, c); this._wallUV([0, 0, l, 0, l, l], l); }
      else { this._tri(A0, B0, B1, N, c); this._tri(A0, B1, A1, N, c); this._wallUV([0, l, l, 0, l, 0], l); }
    }
    if (top) this.face(T.map((p) => [p[0], y1, p[1]]), c, [0, 1, 0]);
    if (bottom) this.face(poly.map((p) => [p[0], y0, p[1]]), c, [0, -1, 0]);
  }

  /**
   * A wall face with rectangular openings cut through it (v0.13). The face is the
   * quad P00 (u = 0, bottom) → P10 (u = L, bottom) → P11 → P01 (top), planar, with
   * outward normal `n`; `yb`/`yt` its bottom and top heights. `holes`: [{ u0, u1, y0,
   * y1, depth, col }] in metres along the wall and world heights. The solid parts are
   * tiled in rows (runs without an opening merged into one quad), and each opening
   * gets four reveal faces going `depth` into the wall: the sun casts real shadow in them.
   * `u` per vertex goes to the wall attribute (wear at corners, painted quoins).
   */
  wallHoles(P00, P10, P01, P11, L, yb, yt, holes, c, n, uStart = 0, Lwall = L, noReveal = false, feats = null) {
    const at = (u, y) => {
      const s = u / L, t = (y - yb) / (yt - yb);
      const b0 = [P00[0] + (P10[0] - P00[0]) * s, P00[1] + (P10[1] - P00[1]) * s, P00[2] + (P10[2] - P00[2]) * s];
      const b1 = [P01[0] + (P11[0] - P01[0]) * s, P01[1] + (P11[1] - P01[1]) * s, P01[2] + (P11[2] - P01[2]) * s];
      return [b0[0] + (b1[0] - b0[0]) * t, b0[1] + (b1[1] - b0[1]) * t, b0[2] + (b1[2] - b0[2]) * t];
    };
    // openings inside this face (clipped to its height); winding so the face looks out along n
    const H = holes.filter((h) => h.u0 > 0.02 && h.u1 < L - 0.02 && h.y1 > yb + 0.02 && h.y0 < yt - 0.02)
      .map((h) => ({ ...h, y0: Math.max(h.y0, yb), y1: Math.min(h.y1, yt), cutTop: h.y1 >= yt, cutBottom: h.y0 <= yb }));
    const ex = [P10[0] - P00[0], P10[1] - P00[1], P10[2] - P00[2]], ey = [P01[0] - P00[0], P01[1] - P00[1], P01[2] - P00[2]];
    const flip = (ex[1] * ey[2] - ex[2] * ey[1]) * n[0] + (ex[2] * ey[0] - ex[0] * ey[2]) * n[1] + (ex[0] * ey[1] - ex[1] * ey[0]) * n[2] < 0;
    const N = [n[0], n[1], n[2]];
    // baked shading (v0.18): `feats` = patches of this face with their own baked numbers, each
    // { u0, u1, y0, y1, us, ys, f(u, y) → [open, drip, scuff] }. The face is cut along each patch's
    // lines (us, ys: only in the rows the patch touches), so the numbers can change across it; a
    // patch is neutral on its own outline, so it joins the plain wall round it without a seam.
    const F = (feats || []).filter((f) => f.u1 > 1e-3 && f.u0 < L - 1e-3 && f.y1 > yb + 1e-3 && f.y0 < yt - 1e-3);
    const addLine = (arr, v, lo, hi) => { if (v > lo + 0.004 && v < hi - 0.004 && !arr.some((x) => Math.abs(x - v) < 0.004)) arr.push(v); };
    const lines = [yb, yt, ...H.flatMap((h) => [h.y0, h.y1])];
    for (const f of F) for (const y of f.ys) addLine(lines, y, yb, yt);
    const ys = [...new Set(lines)].sort((a, b) => a - b);
    const NEUT = [1, 0, 0];
    const bk = (u, y, list) => {
      let o = 1, d = 0, w = 0;
      for (const f of list) {
        if (u < f.u0 - 1e-6 || u > f.u1 + 1e-6 || y < f.y0 - 1e-6 || y > f.y1 + 1e-6) continue;
        const v = f.f(u, y);
        if (v[0] < o) o = v[0];
        if (v[1] > d) d = v[1];
        if (v[2] > w) w = v[2];
      }
      return [o, d, w];
    };
    const quad = (u0, u1, y0, y1, list) => {
      const P = [at(u0, y0), at(u1, y0), at(u1, y1), at(u0, y1)], U = [u0 + uStart, u1 + uStart, u1 + uStart, u0 + uStart];
      const B = list.length ? [bk(u0, y0, list), bk(u1, y0, list), bk(u1, y1, list), bk(u0, y1, list)] : [NEUT, NEUT, NEUT, NEUT];
      // split along the diagonal whose two ends are more alike: smoother shading across the quad
      const sc = (v) => v[0] - v[1] - v[2];
      const order = Math.abs(sc(B[0]) - sc(B[2])) <= Math.abs(sc(B[1]) - sc(B[3])) ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3];
      for (let t = 0; t < 6; t += 3) {
        const i0 = order[t], i1 = order[t + (flip ? 2 : 1)], i2 = order[t + (flip ? 1 : 2)];
        this._tri(P[i0], P[i1], P[i2], N, c);
        this._wallUV([U[i0], U[i1], U[i2]], Lwall);
        if (list.length) this._bakeLast([B[i0], B[i1], B[i2]]);
      }
    };
    for (let j = 0; j + 1 < ys.length; j++) {
      const y0 = ys[j], y1 = ys[j + 1], ym = (y0 + y1) / 2;
      if (y1 - y0 < 1e-4) continue;
      const cut = H.filter((h) => h.y0 <= ym && h.y1 >= ym);
      const rowF = F.filter((f) => f.y0 < y1 - 1e-4 && f.y1 > y0 + 1e-4);
      const ul = [0, L, ...cut.flatMap((h) => [h.u0, h.u1])];
      for (const f of rowF) for (const u of f.us) addLine(ul, u, 0, L);
      ul.sort((a, b) => a - b);
      for (let k = 0; k + 1 < ul.length; k++) {
        const ua = ul[k], ub = ul[k + 1];
        if (ub - ua < 1e-4) continue;
        const um = (ua + ub) / 2;
        if (cut.some((h) => h.u0 < um && h.u1 > um)) continue;   // inside an opening
        quad(ua, ub, y0, y1, rowF);
      }
    }
    // reveals: the four sides of each opening, going into the wall. Baked shade: darkest at the
    // back and under the head, lighter on the seat; a shallow step (a stone base's) hardly at all.
    for (const h of H) {
      if (noReveal || !(h.depth > 0)) continue;
      const d = h.depth, rc = h.col || c, inn = [-N[0] * d, -N[1] * d, -N[2] * d];
      const back = (p) => [p[0] + inn[0], p[1] + inn[1], p[2] + inn[2]];
      const a = at(h.u0, h.y0), b = at(h.u1, h.y0), cc = at(h.u1, h.y1), dd = at(h.u0, h.y1);
      const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], el = Math.hypot(...e);
      const E = e.map((v) => v / el);
      const deep = Math.min(1, d / 0.16), bkv = (front, inner) => { const f = [1 - deep * (1 - front), 0, 0], i = [1 - deep * (1 - inner), 0, 0]; return [f, f, i, i]; };
      const R = REVEAL_SHADE;
      if (!h.cutTop) this.quadB([dd, cc, back(cc), back(dd)], rc, [0, -1, 0], bkv(R.head[0], R.head[1]));   // head (soffit)
      if (!h.cutBottom) this.quadB([a, b, back(b), back(a)], rc, [0, 1, 0], bkv(R.seat[0], R.seat[1]));     // seat
      this.quadB([a, dd, back(dd), back(a)], rc, E, bkv(R.jamb[0], R.jamb[1]));                             // jambs
      this.quadB([b, cc, back(cc), back(b)], rc, [-E[0], -E[1], -E[2]], bkv(R.jamb[0], R.jamb[1]));
    }
  }

  /**
   * Typed arrays for this builder's triangles, plus baked occlusion params per
   * vertex: aoParams = (ground height here, eaves height in decimetres + how
   * enclosed it is 0..0.9, texture layer + house random). The walls shader
   * darkens walls near the ground (more so in narrow lanes) and under the eaves.
   * `probe(x, z, nx, nz)` returns the enclosure for a wall facing (nx, nz).
   */
  arrays(probe, terrain, rand = 0, eaves = 0) {
    const n = this.pos.length, P = this.pos, N = this.nor;
    const ao = new Float32Array(n);
    const memo = new Map();
    for (let i = 0; i < n; i += 3) {
      const x = P[i], z = P[i + 2], nx = N[i], nz = N[i + 2];
      const over = this.gnd[i / 3];   // a wall that starts on a neighbour's roof: that roof is its ground, and it is in the open
      const key = Math.round(x * 2) + ',' + Math.round(z * 2) + ',' + Math.round(nx * 4) + ',' + Math.round(nz * 4) + (over === over ? ',' + Math.round(over * 4) : '');
      let v = memo.get(key);
      if (!v) {
        const g = over === over ? over : terrain.heightAt(x, z);
        const enc = Math.abs(N[i + 1]) > 0.7 ? 0 : over === over ? ROOF_JUNCTION_ENCLOSURE : probe(x, z, nx, nz);   // roofs/terraces: open sky
        v = [g, enc];
        memo.set(key, v);
      }
      ao[i] = v[0]; ao[i + 1] = Math.floor(Math.max(eaves, 0) * 10) + v[1] * 0.9; ao[i + 2] = this.lay[i / 3] + 1 + rand * 0.9;   // layer + house random (materials.js)
    }
    return { pos: new Float32Array(P), nor: new Float32Array(N), col: new Float32Array(this.col), ao, wall: new Float32Array(this.wall), bake: new Float32Array(this.bake) };
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
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// baked shade inside an opening's reveal, as "how open" [at the wall face, at the back] (see GeoBuilder.bake)
const REVEAL_SHADE = CONFIG.building.ao.reveal;
const ROOF_JUNCTION_ENCLOSURE = 0.12;   // a wall rising from a neighbour's roof is in the open: a short, light foot shade
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** mergeColoured, moved `dz` further out from the wall. */
const shift = (dz, parts) => mergeColoured(parts).translate(0, 0, dz);

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
    // Baked ambient occlusion (stable, and on every quality level): walls darken toward
    // the ground, more in narrow lanes, and in a band under the eaves. Worked out per
    // pixel from three numbers per vertex, computed once when a house is built.
    const AO = CONFIG.building.ao;
    this.aoUniforms = { uAO: { value: 1 }, uAOOnly: { value: 0 } };   // uAOOnly = 1: draw the baked shade alone on white walls (a check: tools/shot.cjs --js)
    this.massMat.onBeforeCompile = (sh) => {
      sh.uniforms.uAO = this.aoUniforms.uAO; sh.uniforms.uAOOnly = this.aoUniforms.uAOOnly;
      sh.vertexShader = 'attribute vec3 aoParams;\nattribute vec3 aBake;\nvarying vec4 vAOp;\nvarying vec3 vBake;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vBake = aBake;
          float wy = (modelMatrix * vec4(position, 1.0)).y;
          // height above the ground, enclosure, height below the eaves, wall (1) or roof (0)
          vAOp = vec4(wy - aoParams.x, fract(aoParams.y) / 0.9, floor(aoParams.y) * 0.1 - wy, step(abs(normal.y), 0.5));
        }`);
      sh.fragmentShader = 'varying vec4 vAOp;\nvarying vec3 vBake;\nuniform float uAO, uAOOnly;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float enc = clamp(vAOp.y, 0.0, 1.0);
          float k = 1.0 - smoothstep(0.0, mix(${AO.baseReach[0].toFixed(2)}, ${AO.baseReach[1].toFixed(2)}, enc), max(vAOp.x, 0.0));   // narrow lanes stay dark higher up
          float ao = 1.0 - uAO * k * mix(${AO.base[0].toFixed(2)}, ${AO.base[1].toFixed(2)}, enc);
          float e = vAOp.w * step(-0.05, vAOp.z) * (1.0 - smoothstep(0.0, ${AO.eavesReach.toFixed(2)}, vAOp.z));
          ao *= 1.0 - uAO * ${AO.eaves.toFixed(2)} * e;
          // baked creases (v0.18): inside window reveals, under sills and balconies, inside corners.
          // vBake.x runs 1 (open wall) … 0 (deep in the crease); the shade gathers close in.
          float crease = 1.0 - clamp(vBake.x, 0.0, 1.0);
          ao *= 1.0 - uAO * ${AO.crease.toFixed(2)} * crease;
          // what light does reach a crease has bounced off the warm walls and paving round it:
          // the shade is a little warm, never grey
          vec3 aoCol = pow(vec3(ao), vec3(${(1 - AO.warmth).toFixed(3)}, 1.0, ${(1 + 1.4 * AO.warmth).toFixed(3)}));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8), uAOOnly) * aoCol;
        }`);
    };
    this.chunks = new Map();   // chunk key → { mass, parts: { kind: InstancedMesh }, sphere } (see rebuild)
    this.cache = new Map();   // house id → its generated geometry and instances
    this.style = STYLES.clean;

    // Instanced details: geometry + material + whether it casts shadows, and (far)
    // the distance beyond which the part is not worth drawing (detail by distance).
    const iron = '#262d28', stoneTrim = '#cfc8ba', pale = '#e5dccb';
    const bars = [];
    for (let i = 0; i < 9; i++) bars.push([box(0.03, 0.9, 0.03, -0.68 + i * 0.17, -0.25, 0.8), iron]);
    for (const sx of [-0.74, 0.74]) for (const z of [0.2, 0.5]) bars.push([box(0.03, 0.9, 0.03, sx, -0.25, z), iron]);
    const tiltPanel = new THREE.BoxGeometry(0.8, 0.6, 0.05).translate(0, -0.3, 0).rotateX(-0.42).translate(0, 0.0, CONFIG.building.facadeGap + 0.095);
    const lump = (r, x, y, z) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z);
    const stripes = [];
    for (let i = 0; i < 8; i++) stripes.push([box(0.125, 0.06, 1.3, -0.4375 + i * 0.125, 0, 0).rotateX(0.4), i % 2 ? '#ffffff' : '#8a8a8a']);
    // Depths are measured out from the wall's surface (z = 0; the instance origin sits on
    // the wall's outer skin, see _skin). Faces parallel to the wall are either buried at
    // least 2 cm inside it or stand at least GAP in front, and a window's layers (painted
    // surround, frame, pane, glass, shutters) are at least 2 cm apart, so nothing can
    // fight for the same depth even far away.
    const GAP = CONFIG.building.facadeGap;
    const zb = (front, depth) => front - depth / 2;     // centre of a box whose front face is at `front`
    this.layers = { surround: GAP, frame: GAP + 0.04, pane: GAP + 0.07, glass: GAP + 0.09, shutterOpen: GAP + 0.06, shutterShut: GAP + 0.12 };
    const Ly = this.layers;
    this.parts = {
      pediment: { geo: mergeColoured([[box(1.52, 0.12, 0.12, 0, 1.03, zb(GAP + 0.07, 0.12)), '#ffffff'], [box(1.4, 0.06, 0.08, 0, 0.95, zb(GAP + 0.03, 0.08)), '#e6e6e6']]), mat: lambert({ vertexColors: true }), shadow: false, far: 260 },
      // a window painted on the plaster (see _fakeMaterial)
      fake:    { geo: new THREE.PlaneGeometry(1.36, 1.9).translate(0, 0.02, GAP), mat: this._fakeMaterial(), shadow: false },
      // the glass: an interior-mapped fake room behind every window (see _glassMaterial)
      // (v0.13: at the back of the recess; scaled to each opening)
      // (v0.19: drawn at every distance, and it draws the frame and glazing bars itself, so far-away windows are
      // the same dark panes set back in the wall as near ones; near, the modelled frame stands in front of it)
      glass:   { geo: new THREE.PlaneGeometry(0.74, 1.24).translate(0, 0, GLASS_Z), mat: this._glassMaterial(), shadow: false },
      balcony: { geo: shift(0.02, [[box(1.56, 0.12, 0.86, 0, -0.78, 0.42), pale], [box(0.1, 0.22, 0.6, -0.6, -0.92, 0.3), stoneTrim], [box(0.1, 0.22, 0.6, 0.6, -0.92, 0.3), stoneTrim],
                                     [box(1.52, 0.05, 0.05, 0, 0.21, 0.8), iron], [box(1.52, 0.03, 0.03, 0, -0.68, 0.8), iron],
                                     [box(0.05, 0.05, 0.8, -0.74, 0.21, 0.42), iron], [box(0.05, 0.05, 0.8, 0.74, 0.21, 0.42), iron], ...bars]), mat: vc, shadow: true },
      // a solid rendered parapet instead of bars
      balconySolid: { geo: shift(0.02, [[box(1.56, 0.12, 0.86, 0, -0.78, 0.42), pale], [box(1.56, 0.92, 0.1, 0, -0.26, 0.8), '#ffffff'],
                                          [box(0.1, 0.92, 0.8, -0.73, -0.26, 0.42), '#ffffff'], [box(0.1, 0.92, 0.8, 0.73, -0.26, 0.42), '#ffffff'], [box(1.62, 0.05, 0.16, 0, 0.22, 0.8), stoneTrim]]), mat: vc, shadow: true },
      // door: a stone surround with a step, and the leaf set back inside it
      doorFrame: { geo: mergeColoured([[box(0.17, 2.3, 0.2, -0.6, 1.15, 0.08), '#ffffff'], [box(0.17, 2.3, 0.2, 0.6, 1.15, 0.08), '#ffffff'], [box(1.37, 0.2, 0.2, 0, 2.4, 0.08), '#f6f6f6'],
                                       [box(1.5, 0.2, 0.6, 0, -0.1, 0.32), '#e0e0e0']]), mat: vc, shadow: false },
      // the leaf, set back inside the stone surround but standing GAP clear of the wall
      door:    { geo: mergeColoured([[box(1.04, 2.3, 0.06, 0, 1.15, zb(GAP + 0.06, 0.06)), '#ffffff'], [box(0.03, 2.3, 0.02, 0, 1.15, GAP + 0.07), '#6a6a6a'], [box(0.06, 0.06, 0.05, 0.12, 1.1, GAP + 0.085), '#3a3a3a']]), mat: lambert({ vertexColors: true }), shadow: false },
      shop:    { geo: mergeColoured([[box(2.5, 2.4, 0.1, 0, 1.2, zb(GAP + 0.04, 0.1)), '#ece3cf'], [box(2.2, 2.1, 0.04, 0, 1.12, zb(GAP + 0.07, 0.04)), '#3a3d44']]), mat: vc, shadow: false },
      awning:  { geo: box(1, 0.08, 1.3).rotateX(0.4), mat: lambert(), shadow: true },
      awningStripe: { geo: mergeColoured(stripes), mat: lambert({ vertexColors: true }), shadow: true },
      chimney: { geo: mergeColoured([[box(0.46, 1.0, 0.46, 0, 0.5, 0), '#ffffff'], [box(0.07, 0.16, 0.07, -0.17, 1.08, -0.17), '#b9b3a8'], [box(0.07, 0.16, 0.07, 0.17, 1.08, -0.17), '#b9b3a8'],
                                     [box(0.07, 0.16, 0.07, -0.17, 1.08, 0.17), '#b9b3a8'], [box(0.07, 0.16, 0.07, 0.17, 1.08, 0.17), '#b9b3a8'], [box(0.62, 0.07, 0.62, 0, 1.2, 0), '#c9c2b6']]), mat: lambert({ vertexColors: true }), shadow: true },
      // small things, coloured per instance
      bar:     { geo: box(1, 1, 1, 0, 0.5, 0), mat: lambert(), shadow: false, far: 190 },        // rails, posts, pipes, lines, beams
      pot:     { geo: new THREE.CylinderGeometry(0.2, 0.13, 0.3, 7).translate(0, 0.15, 0), mat: lambert(), shadow: false, far: 130 },
      blob:    { geo: new THREE.IcosahedronGeometry(1, 1), mat: lambert({ flatShading: false }), shadow: false, far: 150, kind: 'foliage' },   // climbers, pot plants
      cloth:   { geo: box(1, 1, 0.02, 0, -0.5, 0), mat: lambert(), shadow: false, far: 230 },    // washing
      cone:    { geo: new THREE.ConeGeometry(1, 0.42, 8).translate(0, 0.21, 0), mat: lambert(), shadow: true, far: 400 },   // parasols
      flowerbox: { geo: mergeColoured([[box(0.92, 0.16, 0.2, 0, 0, 0), '#a2674a'], [lump(0.15, -0.28, 0.14, 0.02), '#6f8f4a'], [lump(0.13, 0.05, 0.16, 0), '#ffffff'],
                                       [lump(0.15, 0.3, 0.13, 0.02), '#6f8f4a'], [lump(0.11, -0.1, 0.17, 0.03), '#ffffff'], [lump(0.11, 0.2, 0.2, 0), '#ffffff']]), mat: vc, shadow: false, far: 150 },
      // the inside of an open boat store: an interior-mapped vaulted room (see _storeMaterial)
      storeRoom: { geo: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), mat: this._storeMaterial(), shadow: false },
    };
    // Openings (src/facade.js, data/facades.json). v0.19: a window is a hole in a thick wall at every
    // distance: the reveal is part of the wall mesh, the stone sill and the dark glass at the back are
    // always drawn; near, the frame is modelled and the shutter leaves are louvred; far, the leaves are
    // framed boards. (v0.13–v0.18 covered far-away openings with a flat painted panel.)
    const frameMat = lambert({ vertexColors: true });
    for (const k of WINDOW_TYPES) {
      this.parts['frame_' + k] = { geo: frameGeometry(k), mat: frameMat, shadow: true, lod: 'near' };
      this.parts['sill_' + k] = { geo: sillGeometry(k), mat: lambert(), shadow: true };
      this.parts['sur_' + k] = { geo: surroundGeometry(k), mat: lambert(), shadow: false };
    }
    const leafMat = lambert({ vertexColors: true });
    // shutter leaves: L / R = hinged left / right; Shut = only the face seen when shut; Far = the framed board
    for (const [name, right] of [['L', false], ['R', true]]) {
      this.parts['leaf' + name] = { geo: leafGeometry(right, true), mat: leafMat, shadow: true, lod: 'near' };
      this.parts['leafShut' + name] = { geo: leafGeometry(right, true, true), mat: leafMat, shadow: true, lod: 'near' };
      this.parts['leafFar' + name] = { geo: leafGeometry(right, false), mat: leafMat, shadow: true, lod: 'far' };
      this.parts['leafFarShut' + name] = { geo: leafGeometry(right, false, true), mat: leafMat, shadow: true, lod: 'far' };
    }
    // the back of every window opening: a dark plate behind the glass, always drawn and casting a
    // shadow, so the sun never shines through a house's openings
    this.parts.holeBack = { geo: new THREE.PlaneGeometry(1, 1).translate(0, 0, -FACADES.windows.recess - 0.01), mat: lambert({ color: '#2b2a28' }), shadow: true };
    // balconies: a slab (stone, consoles) and a railing per variant in data/facades.json
    for (const v of FACADES.balconies.variants) {
      const g = balconyGeometries(v.width, v.depth, v.rail);
      this.parts['balSlab_' + v.name] = { geo: g.slab, mat: vc, shadow: true };
      this.parts['balRail_' + v.name] = { geo: g.rail, mat: lambert(), shadow: true, far: 320 };
    }
    this.parts.chair = { geo: chairGeometry(), mat: lambert(), shadow: false, far: 120 };
    // ground floors (data/facades.json groundFloors): workshop doors, arched entries, shopfronts, awnings
    const GF = FACADES.groundFloors;
    const wd = doorGeometries(GF.workshopDoor.w, GF.workshopDoor.h, GF.workshopDoor.recess);
    this.parts.wsJambs = { geo: wd.surround, mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.wsLeaf = { geo: wd.leaf, mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.wsTrim = { geo: wd.trim, mat: lambert({ vertexColors: true }), shadow: false, lod: 'near' };
    const ad = doorGeometries(GF.archedEntry.w, GF.archedEntry.h, GF.archedEntry.recess, true), ag = archGeometries(GF.archedEntry.w, GF.archedEntry.h, GF.archedEntry.recess);
    this.parts.archJambs = { geo: ad.surround, mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.archLeaf = { geo: ad.leaf, mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.archTrim = { geo: ad.trim, mat: lambert({ vertexColors: true }), shadow: false, lod: 'near' };
    this.parts.archSpandrel = { geo: ag.spandrel, mat: lambert(), shadow: true };
    this.parts.archRing = { geo: ag.voussoirs, mat: lambert(), shadow: false };
    this.parts.shopFront = { geo: shopfrontGeometry(GF.shopfront.w, GF.shopfront.h, GF.shopfront.recess), mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.shopSign = { geo: signGeometry(GF.shopfront.w + 0.2), mat: lambert({ vertexColors: true }), shadow: false };
    this.parts.awningCloth = { geo: awningGeometry(GF.awning.depth, GF.awning.drop), mat: awningMaterial(GF.awning.stripe), shadow: true };
    const D = GF.door, dg = doorGeometries(D.w, D.h, D.recess);
    this.parts.doorJambs = { geo: dg.surround, mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.doorLeaf = { geo: dg.leaf, mat: lambert({ vertexColors: true }), shadow: true };
    this.parts.doorTrim = { geo: dg.trim, mat: lambert({ vertexColors: true }), shadow: false, lod: 'near' };
    for (const p of Object.values(this.parts)) { p.mesh = null; p.cap = 0; }
    registerStyled(this.massMat, 'surface', { mode: 'face', layer: 'attr', weather: true, trueMean: true });
    const surf = { door: 'woodPaint', chimney: 'plaster', doorFrame: 'stoneDressed', doorLeaf: 'planks', doorTrim: 'planks', doorJambs: 'stoneDressed', wsLeaf: 'planks', wsTrim: 'planks', wsJambs: 'stoneDressed',
      archLeaf: 'planks', archTrim: 'planks', archJambs: 'stoneDressed', archRing: 'stoneDressed', archSpandrel: 'plaster' };
    for (const k of Object.keys(this.parts)) {
      if (k.startsWith('leaf')) surf[k] = 'woodPaint';
      if (k.startsWith('sur_')) surf[k] = 'plaster';
      if (k.startsWith('sill_')) surf[k] = 'stoneDressed';
    }
    // detail by distance: a part with `far` shrinks away beyond that many metres (× the quality's reach)
    this.detailReach = { value: 1 };
    const fadeFar = (mat, far) => {
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(mat, sh, r);
        sh.uniforms.uReach = this.detailReach;
        sh.uniforms.uFar = { value: far };
        sh.vertexShader = 'uniform float uReach, uFar;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          {
            float dFar = distance(cameraPosition, (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz) / (uFar * uReach);
            transformed *= 1.0 - smoothstep(0.85, 1.0, dFar);
          }
          #endif`);
      };
    };
    // detail by distance for whole openings: 'near' parts (recess frames, glass, louvred leaves) show
    // only in chunks within the LOD distance, 'far' parts (painted openings) only beyond it (updateLod)
    this.lodDist = { value: CONFIG.building.lodDistance };
    // Facade parts that never change on their own are baked into two merged meshes per chunk
    // (one always drawn, one only near: frames and louvred leaves) instead of one instanced batch
    // per kind per chunk: far fewer draw calls. Parts with their own shaders or a fade with
    // distance (glass, painted openings, awnings, plants, pots, washing) stay instanced.
    this.mergeNear = new Set(['leafL', 'leafR', 'leafShutL', 'leafShutR', 'doorTrim', 'wsTrim', 'archTrim', ...WINDOW_TYPES.map((k) => 'frame_' + k)]);
    this.mergeFar = new Set(['leafFarL', 'leafFarR', 'leafFarShutL', 'leafFarShutR']);
    this.mergeAlways = new Set(['doorJambs', 'doorLeaf', 'wsJambs', 'wsLeaf', 'archJambs', 'archLeaf', 'archSpandrel', 'archRing', 'shopFront', 'shopSign',
      'chimney', 'pediment', 'door', 'doorFrame', 'shop', 'awning', 'awningStripe', 'balcony', 'balconySolid', 'holeBack',
      ...Object.keys(this.parts).filter((k) => k.startsWith('balSlab_') || k.startsWith('balRail_') || k.startsWith('sur_') || k.startsWith('sill_'))]);
    this.partLayer = {};
    for (const k of Object.keys(this.parts)) this.partLayer[k] = surf[k] ? (LAYERS[surf[k]] ?? -1) : -1;
    this._flats = {};
    const seen = new Set([this.massMat]);
    for (const [k, p] of Object.entries(this.parts)) {
      if (seen.has(p.mat)) { if (p.far) { p.mat = p.mat.clone(); } else continue; }
      seen.add(p.mat);
      if (p.far) fadeFar(p.mat, p.far);
      if (p.mat.isMeshBasicMaterial) continue;
      registerStyled(p.mat, p.kind || 'surface', surf[k] ? { mode: 'face', layer: surf[k], trueMean: true } : null);
    }
  }

  /** Quality preset: how far away small details are still drawn. */
  setQuality(name) { this.detailReach.value = CONFIG.building.detailReach[name] ?? 1; this.lodDist.value = CONFIG.building.lodDistance * this.detailReach.value; }

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

  /**
   * The highest a house's roof can reach (ridge, chimneys aside), worked out from its
   * shape alone so it is the same whichever house is rebuilt first: a roof terrace's
   * parapet, or the steepest pitch over the house's span.
   */
  _roofTop(b) {
    if (b.roof === 'flat') return b.top + 0.65;
    const q = b.corners, span = Math.max(dist(q[0], q[1]), dist(q[1], q[2])) + 2 * 0.4;
    return b.top + CONFIG.building.look.roofPitch[1] * span / 2 + 0.25;
  }

  /**
   * A test for wall areas covered by a neighbour. covered(A, e, n, u0, u1, y0, y1, reach)
   * asks: is the strip of wall from u0 to u1 metres along it (from corner A, direction e,
   * outward normal n), between heights y0 and y1, buried in or pressed up against another
   * house? "Pressed up against" = another house (its walls, stone base, eaves or roof)
   * comes within `reach` metres in front of it. Shared and covered walls get no openings,
   * and no wall-mounted parts.
   */
  _coverTest(b) {
    const G = this.growth, near = [];
    const [cx, cz] = centroid(b.corners);
    for (const id of G.live) {
      if (id === b.id) continue;
      const o = G.buildings[id];
      if (!o || Math.abs(o.x - cx) > 20 || Math.abs(o.z - cz) > 20) continue;
      near.push({ o, poly: offsetPoly(o.corners, 0.3) });   // walls + stone bases, cornices and eaves
    }
    return (A, e, n, u0, u1, y0, y1, reach = 0.9) => {
      const back = 0.05;
      const quad = [[A[0] + e[0] * u0 - n[0] * back, A[1] + e[1] * u0 - n[1] * back], [A[0] + e[0] * u1 - n[0] * back, A[1] + e[1] * u1 - n[1] * back],
        [A[0] + e[0] * u1 + n[0] * reach, A[1] + e[1] * u1 + n[1] * reach], [A[0] + e[0] * u0 + n[0] * reach, A[1] + e[1] * u0 + n[1] * reach]];
      for (const { o, poly } of near) {
        const top = o.roofTop ?? o.top + 2;
        if (top <= y0 || o.gMin - 1.2 >= y1) continue;
        if (convexOverlap(quad, poly) > 1e-4) return true;
      }
      return false;
    };
  }

  /**
   * PARTY WALLS (v0.14): for each wall of b, the height up to which a neighbour stands right
   * against it along its whole length (-Infinity if it doesn't). That part of the wall is never
   * seen, so it isn't drawn at all: the wall starts there. (Its openings and wall-mounted parts
   * are already left off by the cover test.)
   */
  _partyTops(b, q) {
    const G = this.growth, near = [];
    const [cx, cz] = centroid(q);
    for (const id of G.live) {
      const o = G.buildings[id];
      if (!o || o === b || o.arch || Math.abs(o.x - cx) > 20 || Math.abs(o.z - cz) > 20) continue;
      near.push(o);
    }
    return q.map((A, i) => {
      const Bq = q[(i + 1) % q.length], e = norm(sub(Bq, A)), n = edgeNormal(q, i), L = dist(A, Bq);
      if (!near.length || L < 0.8) return -Infinity;
      let top = Infinity;
      const k = Math.max(2, Math.ceil((L - 0.4) / 0.6));
      for (let j = 0; j <= k && top > -Infinity; j++) {
        const u = 0.2 + ((L - 0.4) * j) / k, p = [A[0] + e[0] * u + n[0] * 0.15, A[1] + e[1] * u + n[1] * 0.15];
        let h = -Infinity;
        for (const o of near) if (pointInPoly(p, o.corners)) h = Math.max(h, o.top);
        top = Math.min(top, h);
      }
      return top;
    });
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
    gb.layer = LAYERS.stoneDressed;
    gb.geometry(new THREE.ExtrudeGeometry(outer, { depth: P, bevelEnabled: false, curveSegments: 12 }), M, frameCol);
    // a keystone, standing a little proud
    const key = new THREE.BoxGeometry(0.34, 0.42, 0.08).translate(0, h + 0.05, P + 0.03);
    gb.geometry(key, M, frameCol.clone().multiplyScalar(1.06));
    // the back of the opening
    const r = w / 2, ys = h - r;
    const at = (x, z) => new THREE.Vector3(x, 0, z);
    gb.layer = -1;
    const GAP = CONFIG.building.facadeGap;
    gb.geometry(new THREE.ShapeGeometry(archShape(w, h), 12).translate(0, 0, GAP + 0.01), M, DARK);
    if (rng() < S.openChance) {
      // open: the store inside, interior-mapped behind the arch (lit some nights)
      const o = at(0, GAP + 0.04).applyMatrix4(M);
      this._gc.setRGB(rng(), rng(), rng());
      put('storeRoom', o.x, o.y, o.z, Math.atan2(n[0], n[1]), w, h, 1, this._gc);
      return;
    }
    // closed: weathered timber double doors, plank by plank
    const base = new THREE.Color(rng.pick(DOOR_WEATHERED));
    gb.layer = LAYERS.planks;
    const N = 2 * Math.max(3, Math.round(w / 0.5));      // even, so the leaves meet in the middle
    const pw = w / N, topAt = (x) => ys + Math.sqrt(Math.max(r * r - x * x, 0));
    for (let i = 0; i < N; i++) {
      const x0 = -r + i * pw + (i === N / 2 ? 0.03 : 0.012), x1 = -r + (i + 1) * pw - (i === N / 2 - 1 ? 0.03 : 0.012);
      const z = GAP + 0.04 + rng() * 0.012;
      const c = base.clone().offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08);
      const pts = [[x0, 0.02], [x1, 0.02], [x1, topAt(x1) - 0.02], [x0, topAt(x0) - 0.02]].map(([x, y]) => new THREE.Vector3(x, y, z).applyMatrix4(M).toArray());
      gb.face(pts, c, new THREE.Vector3(n[0], 0, n[1]).toArray());
    }
    // iron straps across each leaf, and a ring handle
    gb.layer = -1;
    for (const y of [0.35, Math.min(ys, h * 0.72)]) for (const s of [-1, 1]) {
      const strap = new THREE.BoxGeometry(r - 0.12, 0.07, 0.02).translate(s * (r / 2 + 0.02), y, GAP + 0.075);
      gb.geometry(strap, M, IRON);
    }
    gb.geometry(new THREE.TorusGeometry(0.07, 0.015, 4, 8).translate(0.1, 1.05, GAP + 0.09), M, IRON);
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
    gb.layer = LAYERS.stoneBase;
    gb.geometry(geo, M, stone.clone().multiplyScalar(1.12));
    gb.layer = LAYERS.stoneDressed;
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

  /**
   * Low-pitched roofs over any convex quad: gable, hip, gable end-on, or a roof
   * terrace. Slate roofs get a ridge of terracotta tiles (or pale lime mortar),
   * and every roof a thin eaves edge. Returns { yr, R0, R1 } (the ridge) or null.
   */
  _roof(gb, b, ov, pitch, F) {
    const P = offsetPoly(b.corners, ov);
    const top = b.top;
    const up = [0, 1, 0];
    const lift = (p, y) => [p[0], y, p[1]];
    const side = (i) => { const n = edgeNormal(P, i); return [n[0], 0, n[1]]; };
    if (b.roof === 'flat') {
      // a roof terrace: low parapet in a lighter shade, tiled floor inside
      gb.layer = LAYERS.plaster;
      gb.prism(offsetPoly(b.corners, 0.05), top, top + 0.6, b.facade.clone().offsetHSL(0, -0.05, 0.06));
      gb.layer = F.terraceFloor.r > F.terraceFloor.b + 0.12 ? LAYERS.terraA : LAYERS.setts;
      gb.prism(offsetPoly(b.corners, -0.25), top + 0.05, top + 0.62, F.terraceFloor);
      return null;
    }
    const depth = (dist(P[1], P[2]) + dist(P[0], P[3])) / 2, width = (dist(P[0], P[1]) + dist(P[2], P[3])) / 2;
    const along = b.roof !== 'gableX';                  // ridge parallel to the front wall?
    const yr = top + pitch * (along ? depth : width) / 2 + 0.12;
    let R0, R1;
    if (along) { R0 = lerp2(P[3], P[0], 0.5); R1 = lerp2(P[1], P[2], 0.5); }
    else { R0 = lerp2(P[0], P[1], 0.5); R1 = lerp2(P[2], P[3], 0.5); }
    if (b.roof === 'hip') { const C = centroid(P); R0 = lerp2(R0, C, 0.35); R1 = lerp2(R1, C, 0.35); }
    const p = P.map((q) => lift(q, top)), r0 = lift(R0, yr), r1 = lift(R1, yr);
    const col = b.roofCol, hip = b.roof === 'hip';
    gb.layer = this._roofLayer(b);
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
    // the eaves: a thin edge all round, and the underside
    gb.layer = LAYERS.stoneDressed;
    gb.prism(P, top - 0.09, top + 0.005, F.eaves, false, true);
    // ridge (and hips): a line of half-round tiles
    gb.layer = F.ridgeTerracotta ? LAYERS.terraA : LAYERS.plaster;
    const cap = (A, B) => {
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]);
      if (L < 0.4) return;
      const ez = new THREE.Vector3(d[0], d[1], d[2]).divideScalar(L), ex = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ez).normalize();
      const ey = new THREE.Vector3().crossVectors(ez, ex);
      // the cap's underside is sunk well into the roof (8 cm below the ridge line), so its sides
      // meet both slopes cleanly; a cap sitting on the ridge left a thin floating slit beside it
      // that showed as a jagged dark line (bug report roof-shimmer-v0.11)
      const M = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 0.0025, (A[2] + B[2]) / 2);
      gb.geometry(new THREE.BoxGeometry(0.26, 0.165, L + 0.1), M, F.ridge);
    };
    cap(r0, r1);
    if (hip) { if (along) { cap(p[0], r0); cap(p[3], r0); cap(p[1], r1); cap(p[2], r1); } }
    return { yr, R0, R1, along };
  }

  /**
   * Interior mapping: a ray from the eye through the glass is traced into a
   * box-shaped room (back wall, side walls, floor, ceiling) in the window's own
   * space, so every window shows a little room with depth. By day the rooms are
   * dim; as evening falls, a growing share light up warm (uLit), bright enough
   * to bloom. Unlit (MeshBasic) so it costs only the window pixels.
   */
  _glassMaterial() {
    this._gc = new THREE.Color(); this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this.glassUniforms = {
      uLit: { value: 0 }, uDay: { value: 1 }, uSky: { value: new THREE.Color('#bcd6ea') }, uWarm: { value: new THREE.Color('#ffc07a') },
    };
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.glassUniforms);
      sh.vertexShader = 'varying vec3 vPosL;\nvarying vec3 vCamL;\nvarying vec4 vWinM;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 mI = modelMatrix;
        vec2 gSc = vec2(1.0);
        #ifdef USE_INSTANCING
          mI = modelMatrix * instanceMatrix;
          gSc = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        #endif
        vCamL = (inverse(mI) * vec4(cameraPosition, 1.0)).xyz;
        vPosL = position;
        vWinM = vec4(position.xy * gSc, vec2(0.37, 0.62) * gSc);   // metres from the middle of the opening; its half-size`);
      sh.fragmentShader = `uniform float uLit, uDay; uniform vec3 uSky, uWarm;
        varying vec3 vPosL; varying vec3 vCamL; varying vec4 vWinM;
        ` + sh.fragmentShader.replace('#include <color_fragment>', `
        vec3 rnd = vec3(1.0);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          rnd = vColor.rgb;
        #endif
        // the room, in window space: the glass plane, room behind it
        vec3 o = vPosL - vec3(0.0, 0.0, ${GLASS_Z.toFixed(3)});
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
        vec3 dayL = col * (0.035 + 0.065 * uDay) * depthFall;   // rooms are dim by day: from outside the glass reads dark
        // lamplight falls off from a ceiling lamp; the lamp itself is bright enough to bloom
        vec3 lampPos = vec3((rnd.g - 0.5) * 0.8, ceilY - 0.25, -1.4);
        float near = 1.0 / (1.0 + 0.35 * dot(p - lampPos, p - lampPos));
        vec3 lampL = col * uWarm * (curtain ? 0.9 : 1.3) * (0.35 + 0.9 * near);
        if (!curtain && t == ty && d.y > 0.0) lampL += uWarm * 4.0 * smoothstep(0.32, 0.18, length(p.xz - lampPos.xz));
        vec3 inside = mix(dayL, lampL, lit);
        // the glass: a faint sky sheen, stronger at grazing angles
        float fres = pow(1.0 - abs(d.z), 3.0);
        diffuseColor.rgb = mix(inside, uSky * (0.15 + 0.35 * uDay), (0.05 + 0.35 * fres) * (1.0 - lit * 0.8));
        // the window frame and its glazing bars, drawn on the pane (near the camera a modelled frame
        // stands in front of this). Thinner than a pixel, a bar fades by its share of the pixel
        // instead of flickering on and off.
        {
          vec2 am = abs(vWinM.xy), hf = vWinM.zw;
          float px = max(fwidth(vWinM.x) + fwidth(vWinM.y), 1e-4);
          float cov = clamp(${(2 * FACADES.windows.frame.mullion).toFixed(3)} / px, 0.0, 1.0);
          float fr = clamp((${FACADES.windows.frame.bar.toFixed(3)} + 0.5 * px - min(hf.x - am.x, hf.y - am.y)) / px, 0.0, 1.0) * clamp(${(1.3 * FACADES.windows.frame.bar).toFixed(3)} / px, 0.0, 1.0);
          float mu = hf.x > 0.4 ? clamp((${(FACADES.windows.frame.mullion / 2).toFixed(3)} + 0.5 * px - am.x) / px, 0.0, 1.0) * cov : 0.0;
          float tr = (hf.y > 0.75 && hf.y < 1.05) ? clamp((${(FACADES.windows.frame.mullion / 2).toFixed(3)} + 0.5 * px - abs(vWinM.y - (hf.y - ${FACADES.windows.frame.transomAt.toFixed(2)}))) / px, 0.0, 1.0) * cov : 0.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.21, 0.2, 0.175) * (0.2 + 0.8 * uDay), max(fr, max(mu, tr)));
        }`);
    };
    return m;
  }

  /** Slate or terracotta, by the house's roof colour (two variants of each). */
  _roofLayer(b) {
    const terra = b.roofKind === 'terracotta';
    const alt = (b.seed >> 4) & 1;
    return terra ? (alt ? LAYERS.terraA : LAYERS.terraB) : (alt ? LAYERS.slateA : LAYERS.slateB);
  }

  /**
   * The outer walls of a house with its openings cut through them (v0.13). Follows the art
   * style: corners cut off (chamfered) in the softer styles, or walls leaning in a touch
   * (q at the foot, qTop at the eaves). `holes[i]` = the openings in wall i (from corner i).
   */
  _shell(gb, q, qTop, y0, y1, col, holes, from = null, feats = null) {
    const S = this.style;
    // where a neighbour hides the lower part of a wall (a party wall), the wall starts higher
    const start = (i) => {
      if (!from || !(from[i] > y0 + 0.3)) return y0;
      let y = Math.min(from[i] - 0.05, y1);
      for (const h of holes[i]) y = Math.min(y, h.y0 - 0.05);
      return y > y0 + 0.3 ? y : y0;
    };
    if (S.chamfer) {
      const ch = chamferPoly(q, S.chamfer), P = ch.poly, m = P.length;
      for (let k = 0; k < m; k++) {
        const a = P[k], c2 = P[(k + 1) % m];
        if (ch.normals[k]) {                                  // a cut-off corner: a plain narrow face
          const nA = ch.normals[k][0], nB = ch.normals[k][1], nn = norm([nA[0] + nB[0], nA[1] + nB[1]]);
          gb.face([[a[0], y0, a[1]], [c2[0], y0, c2[1]], [c2[0], y1, c2[1]], [a[0], y1, a[1]]], col, [nn[0], 0, nn[1]]);
          continue;
        }
        const i = (k - 1) / 2, n = edgeNormal(q, i), uStart = dist(q[i], a), L = dist(a, c2), ys = start(i);
        if (ys >= y1 - 0.01) continue;
        const hs = holes[i].map((h) => ({ ...h, u0: h.u0 - uStart, u1: h.u1 - uStart }));
        // (patches of baked shade are given along the whole wall: move them to this face's own start)
        const fs = feats ? feats[i].map((f) => ({ ...f, u0: f.u0 - uStart, u1: f.u1 - uStart, us: f.us.map((u) => u - uStart), f: (u, y) => f.f(u + uStart, y) })) : null;
        gb.ground = ys > y0 + 0.3 ? ys : NaN;                 // it starts on a neighbour's roof
        gb.wallHoles([a[0], ys, a[1]], [c2[0], ys, c2[1]], [a[0], y1, a[1]], [c2[0], y1, c2[1]], L, ys, y1, hs, col, [n[0], 0, n[1]], uStart, dist(q[i], q[(i + 1) % 4]), false, fs);
        gb.ground = NaN;
      }
      return;
    }
    for (let i = 0; i < q.length; i++) {
      const A0 = q[i], B0 = q[(i + 1) % q.length], At = qTop[i], Bt = qTop[(i + 1) % q.length], n = edgeNormal(q, i);
      const ys = start(i);
      if (ys >= y1 - 0.01) continue;
      const f = (ys - y0) / (y1 - y0), A = lerp2(A0, At, f), Bq = lerp2(B0, Bt, f);
      const P00 = [A[0], ys, A[1]], P10 = [Bq[0], ys, Bq[1]], P01 = [At[0], y1, At[1]], P11 = [Bt[0], y1, Bt[1]];
      // the face's own normal (the wall leans in a touch), pointing out
      const ex = sub3(P10, P00), ey = sub3(P01, P00);
      let N = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
      const l = Math.hypot(...N); N = N.map((v) => v / l);
      if (N[0] * n[0] + N[2] * n[1] < 0) N = N.map((v) => -v);
      gb.ground = ys > y0 + 0.3 ? ys : NaN;
      gb.wallHoles(P00, P10, P01, P11, dist(A, Bq), ys, y1, holes[i], col, N, 0, dist(A, Bq), false, feats ? feats[i] : null);
      gb.ground = NaN;
    }
  }

  /**
   * One window. v0.19: a hole in a thick wall at every distance. The reveal is cut into the
   * wall mesh; here come the stone sill, the dark glass at the back (it draws its own frame;
   * near, a modelled frame stands in front of it), a thin painted surround on decorated
   * houses, and two louvred shutter leaves hinged on the corners of the reveal: shut (lying
   * inside the reveal), folded back flat against the wall (where there is room), standing
   * part open, or missing; some houses' leaves are sun-bleached. Then whatever hangs off the
   * window: a flower box or a washing line (a balcony is added per floor).
   * `o` = { u, w, h, y0, y1, yc, type, px, pz, inset, balcony, ground, roomLeft, roomRight }.
   * Returns true if the right-hand leaf is folded back (it then takes wall space).
   */
  _opening(put, b, rng, F, W, o) {
    const WIN = FACADES.windows, SH = FACADES.shutters, K = CONFIG.building.look;
    const { A, e, n, rot, sgn } = W, T = WIN.types[o.type], ky = o.h / T.h, kx = o.w / T.w;
    if (T.sill !== false) put('sill_' + o.type, o.px, o.yc, o.pz, rot, kx, ky, 1, F.sillCol);
    put('holeBack', o.px, o.yc, o.pz, rot, o.w, o.h, 1, WHITE);
    if (F.deco === 'surrounds' || F.deco === 'full') {
      put('sur_' + o.type, o.px, o.yc, o.pz, rot, kx, ky, 1, F.trimSoft);
      if (F.deco === 'full' && o.type !== 'small') put('pediment', o.px, o.y1 + WIN.lintel.height + 0.04 - 0.92, o.pz, rot, (o.w + 0.4) / 1.52, 1, 1, F.trimSoft);
    }
    // ---- shutters: what each leaf is doing ('shut' | 'flat' | an angle in radians | null = missing) ----
    if (!b.shutterShades) b.shutterShades = [-0.03, 0, 0.03].map((d) => b.shutter.clone().offsetHSL(0, 0, d));
    let state = rng.weighted(SH.states.map((s) => [s.name, s.weight * (s.name === 'closed' ? F.shutMul.closed : s.name === 'open' ? F.shutMul.open : 1)]));
    if (o.balcony && state === 'none') state = 'closed';
    b.shutterStates = b.shutterStates || {}; b.shutterStates[state] = (b.shutterStates[state] || 0) + 1;
    const side = rng() < 0.5 ? -1 : 1;                    // which leaf is the odd one out
    const ajar = () => SH.ajarAngle[0] + rng() * (SH.ajarAngle[1] - SH.ajarAngle[0]);
    const half = () => SH.halfAngle[0] + rng() * (SH.halfAngle[1] - SH.halfAngle[0]);
    const leaves = {};                                    // by side (-1 = low u, +1 = high u)
    for (const s of [-1, 1]) {
      const room = s < 0 ? o.roomLeft : o.roomRight, odd = s === side;
      let what;
      if (state === 'none') what = null;
      else if (state === 'closed') what = 'shut';
      else if (state === 'open') what = room ? 'flat' : half();
      else if (state === 'oneOpen') what = odd ? (room ? 'flat' : half()) : 'shut';
      else if (state === 'half') what = odd ? half() : 'shut';
      else if (state === 'ajar') what = ajar();
      else what = odd ? null : (room && rng() < 0.5 ? 'flat' : 'shut');   // 'lost': one leaf gone
      leaves[s] = what;
    }
    const bothShut = leaves[-1] === 'shut' && leaves[1] === 'shut';
    // the glass (and near, the frame) show unless both leaves are shut in front of them
    if (!bothShut) {
      put('frame_' + o.type, o.px, o.yc, o.pz, rot, kx, ky, 1, WHITE);
      // per-window randoms (packed in the instance colour): when its light comes on, the room's wall colour, the curtain
      this._gc.setRGB(rng(), rng(), rng());
      put('glass', o.px, o.yc, o.pz, rot, o.w / 0.74, o.h / 1.24, 1, this._gc);
    }
    let foldRight = false;
    const lw = o.w / 2 - 0.004, lh = o.h - 0.02;
    for (const s of [-1, 1]) {
      const what = leaves[s];
      if (what === null) continue;
      const name = (s < 0) === (sgn > 0) ? 'L' : 'R', openSign = name === 'L' ? -1 : 1;
      const ang = what === 'shut' ? rng() * SH.closedJitter : what === 'flat' ? Math.PI - rng() * SH.openJitter : what;
      if (s > 0 && what === 'flat') foldRight = true;
      // each leaf its own shade of the house's shutter colour; on some houses, bleached by the sun
      let col = b.shutterShades[(rng() * 3) | 0];
      if (F.shutFade > 0) col = this._c2.copy(col).lerp(F.shutFadeCol, F.shutFade * (0.5 + 0.5 * rng()));
      // the hinge: on the corner of the reveal, on the wall's face
      const hu = o.u + s * o.w / 2, hx = A[0] + e[0] * hu + n[0] * o.inset, hz = A[1] + e[1] * hu + n[1] * o.inset;
      const y = o.yc + (rng() - 0.5) * 2 * SH.sag, r = rot + openSign * ang, shutNow = what === 'shut';
      put((shutNow ? 'leafShut' : 'leaf') + name, hx, y, hz, r, lw, lh, 1, col);
      put((shutNow ? 'leafFarShut' : 'leafFar') + name, hx, y, hz, r, lw, lh, 1, col);
    }
    const at = (along, out) => [o.px + e[0] * along + n[0] * out, o.pz + e[1] * along + n[1] * out];
    if (o.balcony) return foldRight;                      // (the balcony is added per floor, see _balcony)
    if (o.ground) return foldRight;
    if (rng() < F.flowers) {
      const [px, pz] = at(0, 0.2);
      put('flowerbox', px, o.y0 + 0.02, pz, rot, o.w / 1.0, 1, 1, this._c.set(rng.pick(K.flowerColours)));
    } else if (rng() < F.wash) {
      // a washing line on two brackets under the sill
      const ly = o.y0 - WIN.sill.height - 0.3, [lx, lz] = at(0, 0.38);
      put('bar', lx, ly, lz, rot, 1.4 * o.w, 0.015, 0.015, IRON);
      for (const a of [-0.62, 0.62]) { const [bx, bz] = at(a * o.w, 0.2); put('bar', bx, ly, bz, rot, 0.03, 0.03, 0.4, IRON); }
      const nn = 2 + ((rng() * 3) | 0);
      for (let i = 0; i < nn; i++) {
        const [px, pz] = at((-0.55 + (i + rng() * 0.3) * (1.1 / nn)) * o.w, 0.38);
        put('cloth', px, ly, pz, rot, 0.26 + rng() * 0.26, 0.4 + rng() * 0.5, 1, this._c.set(rng.pick(K.washColours)));
      }
    }
    return foldRight;
  }

  /**
   * A balcony on a wall (v0.13): slab on consoles with an iron railing or a rendered
   * parapet, a variant from data/facades.json chosen to fit the width it must span;
   * then pots and flowers along the rail, sometimes a chair, washing over the rail.
   */
  _balcony(put, b, rng, F, W, uC, span, y, wide, inset = 0) {
    const BAL = FACADES.balconies, K = CONFIG.building.look, { A, e, n, rot } = W, t = this.terrain;
    const fits = BAL.variants.filter((v) => (wide ? v.width >= 2.2 : v.width < 2.2));
    const v = rng.weighted((fits.length ? fits : BAL.variants).map((x) => [x, x.weight]));
    const sx = Math.max(span, v.width * 0.85) / v.width, w = v.width * sx, d = v.depth;
    const ox = A[0] + e[0] * uC + n[0] * inset, oz = A[1] + e[1] * uC + n[1] * inset;
    if (y - t.heightAt(ox + n[0] * d, oz + n[1] * d) < 2.2) return null;   // never a balcony hanging over a lane at head height
    const solid = v.rail === 'solid';
    const railCol = solid ? b.facade.clone().offsetHSL(0, -0.04, 0.05) : new THREE.Color(rng.weighted(BAL.railColours));
    put('balSlab_' + v.name, ox, y, oz, rot, sx, 1, 1, WHITE);
    put('balRail_' + v.name, ox, y, oz, rot, sx, 1, 1, railCol);
    b.balconyCount = (b.balconyCount || 0) + 1; (b.balconyWalls = b.balconyWalls || []).push(W.wall);
    const at = (along, out) => [ox + e[0] * along + n[0] * out, oz + e[1] * along + n[1] * out];
    const H = BAL.railHeight, potY = solid ? y + H * 0.95 + 0.05 : y, potOut = solid ? d - 0.06 : d - 0.2;
    if (rng() < BAL.pots) {
      const np = Math.max(1, Math.round(w / 0.55));
      for (let k = 0; k < np; k++) {
        const a = -w / 2 + 0.2 + (k + 0.5) * ((w - 0.4) / np) + (rng() - 0.5) * 0.1;
        if (!wide && Math.abs(a) < 0.35 && !solid) continue;      // keep the doorway clear
        if (rng() < 0.25) continue;
        const [px, pz] = at(a, potOut), s = 0.7 + rng() * 0.4;
        put('pot', px, potY, pz, 0, s, 0.9 * s, s, TERRACOTTA);
        put('blob', px, potY + 0.38 * s, pz, rng() * 6, 0.22 * s, 0.24 * s, 0.22 * s, LEAF);
        if (rng() < BAL.flowers) put('blob', px, potY + 0.56 * s, pz, rng() * 6, 0.15, 0.11, 0.15, rng() < 0.5 ? F.flowerCol : this._c.set(rng.pick(K.flowerColours)));
      }
      // geraniums spilling over the front rail
      if (!solid && rng() < BAL.flowers) for (let k = 0; k < 2 + ((rng() * 3) | 0); k++) {
        const [px, pz] = at((rng() - 0.5) * (w - 0.4), d + 0.04);
        put('blob', px, y + H * (0.55 + rng() * 0.3), pz, rng() * 6, 0.2, 0.16, 0.09, rng() < 0.6 ? F.flowerCol : LEAF);
      }
    }
    if (rng() < BAL.chair) { const [px, pz] = at((rng() < 0.5 ? -1 : 1) * (w / 2 - 0.35), 0.45); put('chair', px, y, pz, rot + (rng() - 0.5) * 0.6, 1, 1, 1, this._c.set(rng.pick(['#2f5a44', '#e9e6de', '#8a6844']))); }
    if (!solid && rng() < BAL.washing) {
      const nn = 2 + ((rng() * 3) | 0);
      for (let i = 0; i < nn; i++) {
        const [px, pz] = at(-w / 2 + 0.3 + (i + rng() * 0.4) * ((w - 0.6) / nn), d + 0.02);
        put('cloth', px, y + H + 0.01, pz, rot, 0.3 + rng() * 0.25, 0.55 + rng() * 0.35, 1, this._c.set(rng.pick(K.washColours)));
      }
    }
    return { u0: uC - w / 2, u1: uC + w / 2, y: y - BAL.slab, depth: d };
  }

  /**
   * Patches of baked shade on a wall (v0.18, see GeoBuilder.wallHoles): each darkens the wall
   * where less sky reaches it. `open` runs from `from` (0 = deepest) at the crease up to 1.
   *   _shadeBelow  under something that juts out (a sill, a balcony slab): fades over `reach`
   *                metres down the wall and over `side` metres past each end
   *   _shadeCorner in the corner where a neighbour's wall stands out in front of this one
   */
  _shadeBelow(u0, u1, yTop, reach, side, from, up = false) {
    // (`up`: the same, but on the wall above the line: where a balcony slab meets the wall)
    const a = u0 - side, b = u1 + side, y0 = up ? yTop : yTop - reach, y1 = up ? yTop + reach : yTop;
    return { u0: a, u1: b, y0, y1, us: [a, u0, u1, b], ys: [y0, y1],
      f: (u, y) => {
        const ty = clamp((up ? y - yTop : yTop - y) / reach, 0, 1), tu = u < u0 ? clamp((u0 - u) / side, 0, 1) : u > u1 ? clamp((u - u1) / side, 0, 1) : 0;
        return [from + (1 - from) * Math.max(ty, tu), 0, 0];
      } };
  }

  /**
   * Weathering patches (v0.20), the second and third baked numbers:
   *   _dripBelow  rain runs off a sill or a balcony slab and stains the wall under it: strongest
   *               at the top, fading down over `reach` m; `ends` = stronger under the two ends
   *               (where water leaves a slab)
   *   _scuffRound plaster knocked about round a door: strongest at the jambs near the ground
   */
  _dripBelow(u0, u1, yTop, reach, strength, ends = 0) {
    const side = 0.1, a = u0 - side, b = u1 + side, y0 = yTop - reach, w = Math.min(0.35, (u1 - u0) / 3);
    return { u0: a, u1: b, y0, y1: yTop, us: ends ? [a, u0, u0 + w, u1 - w, u1, b] : [a, u0, u1, b], ys: [y0, yTop],
      f: (u, y) => {
        if (u <= a || u >= b || y <= y0) return [1, 0, 0];
        const ty = clamp((yTop - y) / reach, 0, 1), tu = u < u0 ? (u0 - u) / side : u > u1 ? (u - u1) / side : 0;
        const end = ends ? Math.max(0, 1 - Math.min(u - u0, u1 - u) / w) : 0;
        return [1, strength * (1 - ty) * (1 - clamp(tu, 0, 1)) * (ends ? 1 - ends + ends * end : 1), 0];
      } };
  }

  _scuffRound(u0, u1, yFoot, yTop, reach) {
    const a = u0 - reach, b = u1 + reach, yMid = yFoot + (yTop - yFoot) * 0.45;
    return { u0: a, u1: b, y0: yFoot - 0.4, y1: yTop, us: [a, u0, u1, b], ys: [yFoot - 0.4, yMid, yTop],
      f: (u, y) => {
        const tu = u < u0 ? clamp((u0 - u) / reach, 0, 1) : u > u1 ? clamp((u - u1) / reach, 0, 1) : 0;
        const ty = clamp((y - yMid) / (yTop - yMid), 0, 1);
        return [1, 0, (1 - tu) * (1 - ty)];
      } };
  }

  _shadeCorner(atEnd, L, yBottom, yTop, reach, from) {
    const u0 = atEnd ? L - reach : 0, u1 = atEnd ? L : reach, fade = 0.6;
    return { u0, u1, y0: yBottom, y1: yTop, us: [atEnd ? L - reach : reach], ys: [yTop - fade, yTop],
      f: (u, y) => {
        const tu = clamp((atEnd ? L - u : u) / reach, 0, 1), ty = clamp((y - (yTop - fade)) / fade, 0, 1);
        return [from + (1 - from) * Math.max(tu, ty), 0, 0];
      } };
  }

  /**
   * Stone bases, dados and string courses as bands standing `out` proud of the walls, with
   * the ground-floor openings cut through them (v0.13). A 'level' band runs between two
   * heights (a harbour base, a rough stone ground floor, a string course): it is tiled
   * round each opening, with stone reveals back to `revealTo` (the next layer in). A 'follow'
   * band follows the lane (a dado, a low stone base, `h` high above the ground at each end):
   * an opening through it splits it, with stone jambs.
   */
  _bands(gb, q, bands, holes, from = null) {
    for (const B of bands) {
      gb.layer = B.layer;
      const oq = offsetPoly(q, B.out);
      for (let i = 0; i < 4; i++) {
        // a band on a party wall is hidden inside the neighbour
        if (from && from[i] > -Infinity) {
          const bTop = B.kind === 'level' ? B.y1 : Math.max(B.walls[i].gA, B.walls[i].gB) + B.h;
          if (bTop <= from[i] - 0.05) continue;
        }
        const A = q[i], n = edgeNormal(q, i), e = norm(sub(q[(i + 1) % 4], A));
        const a = oq[i], c = oq[(i + 1) % 4], s = (a[0] - A[0]) * e[0] + (a[1] - A[1]) * e[1], Lb = dist(a, c), N = [n[0], 0, n[1]];
        const hs = holes[i].map((h) => ({ ...h, u0: h.u0 - s, u1: h.u1 - s, depth: B.out - (B.revealTo || 0), col: B.col.clone().multiplyScalar(0.9) }));
        if (B.kind === 'level') {
          const P = (p, y) => [p[0], y, p[1]];
          gb.wallHoles(P(a, B.y0), P(c, B.y0), P(a, B.y1), P(c, B.y1), Lb, B.y0, B.y1, hs, B.col, N);
          continue;
        }
        // follows the ground: split at every opening that reaches its foot
        const { gA, gB } = B.walls[i], lo = Math.min(gA, gB) - 0.7;
        const top = (u) => gA + (gB - gA) * clamp(u / Lb, 0, 1) + B.h;
        const at = (u, y) => [a[0] + e[0] * u, y, a[1] + e[1] * u];
        const back = (p) => [p[0] - n[0] * B.out, p[1], p[2] - n[1] * B.out];
        const cuts = hs.filter((h) => h.y0 < top((h.u0 + h.u1) / 2) && h.u1 > 0 && h.u0 < Lb).sort((x, y) => x.u0 - y.u0);
        let u = 0;
        const seg = (u0, u1) => {
          if (u1 - u0 < 0.02) return;
          const f = [at(u0, lo), at(u1, lo), at(u1, top(u1)), at(u0, top(u0))];
          gb.face(f, B.col, N);
          gb.face([f[3], f[2], back(f[2]), back(f[3])], B.col.clone().multiplyScalar(1.04), [0, 1, 0]);   // its top ledge
        };
        for (const h of cuts) {
          seg(u, Math.max(u, h.u0));
          // stone jambs from the band's face back to the wall, either side of the opening
          const y0 = Math.max(lo, Math.min(h.y0, top(h.u0))), yl = top(h.u0), yr = top(h.u1);
          gb.face([at(h.u0, y0), back(at(h.u0, y0)), back(at(h.u0, yl)), at(h.u0, yl)], h.col, [e[0], 0, e[1]]);
          gb.face([at(h.u1, y0), at(h.u1, yr), back(at(h.u1, yr)), back(at(h.u1, y0))], h.col, [-e[0], 0, -e[1]]);
          u = Math.max(u, h.u1);
        }
        seg(u, Lb);
      }
      if (B.kind === 'level') {
        gb.face(oq.map((p) => [p[0], B.y1, p[1]]), B.col.clone().multiplyScalar(1.03), [0, 1, 0]);
        if (B.bottom) gb.face(oq.map((p) => [p[0], B.y0, p[1]]), B.col.clone().multiplyScalar(0.8), [0, -1, 0]);
      }
    }
  }

  /** A flat band standing `out` proud of a wall (from corner A along e, outward n), from u0 to u1: a string course that can stop short. */
  _strip(gb, A, e, n, u0, u1, y0, y1, out, col) {
    const p = (u, o, y) => [A[0] + e[0] * u + n[0] * o, y, A[1] + e[1] * u + n[1] * o];
    const N = [n[0], 0, n[1]], E = [e[0], 0, e[1]];
    gb.face([p(u0, out, y0), p(u1, out, y0), p(u1, out, y1), p(u0, out, y1)], col, N);
    gb.face([p(u0, -0.02, y1), p(u1, -0.02, y1), p(u1, out, y1), p(u0, out, y1)], col.clone().multiplyScalar(1.04), [0, 1, 0]);
    gb.face([p(u0, -0.02, y0), p(u1, -0.02, y0), p(u1, out, y0), p(u0, out, y0)], col.clone().multiplyScalar(0.72), [0, -1, 0]);
    gb.face([p(u0, -0.02, y0), p(u0, out, y0), p(u0, out, y1), p(u0, -0.02, y1)], col, [-E[0], 0, -E[2]]);
    gb.face([p(u1, -0.02, y0), p(u1, out, y0), p(u1, out, y1), p(u1, -0.02, y1)], col, E);
  }

  /** Walls of a footprint: chamfered (and shaded round) in the softer styles. */
  _walls(gb, poly, y0, y1, col, top = false) {
    const S = this.style;
    if (!S.chamfer) return gb.prism(poly, y0, y1, col, top);
    const ch = chamferPoly(poly, S.chamfer);
    gb.prism(ch.poly, y0, y1, col, top, false, S.smoothCorners ? ch.normals : null);
  }

  /** Switch art style: materials follow via style.js; houses are rebuilt. */
  setStyle(style, buildings) {
    this.style = style;
    this.invalidateAll();
    if (buildings) this.rebuild(buildings);
  }

  /** Detail meshes too small to matter in a ripply reflection. */
  smallParts() {
    const keep = (k) => ['glass', 'storeRoom'].includes(k);
    return [...this.chunks.values()].flatMap((ch) => [ch.det, ch.detN, ch.detF, ...Object.entries(ch.parts).filter(([k]) => !keep(k)).map(([, m]) => m)]).filter(Boolean);
  }

  /** Flat overlays drawn on top of walls (not solid surfaces): left out of the ambient-occlusion pass. */
  overlayParts() { return []; }   // (none since v0.20: the sill streaks are baked into the wall, not a decal)

  /** Forget every cached house (the next rebuild redraws the whole town). */
  invalidateAll() { this.cache.clear(); }

  /**
   * Redraw the town. Only houses whose `ver` changed since they were last
   * built are regenerated (growth bumps `ver` on a house and its neighbours
   * when it is added, gains a floor or is removed); everything else is copied
   * from the per-house cache.
   *
   * v0.13: the town is split into square chunks (CONFIG.building.chunkSize), each with
   * its own walls-and-roofs mesh and its own instanced batches, so whole chunks off
   * screen are skipped (frustum culling), and only chunks whose houses changed are
   * re-uploaded. Detail by distance is per chunk too (see updateLod).
   */
  rebuild(buildings) {
    // tops first, so neighbour checks use the current heights
    for (const b of buildings) { b.top = b.gMax + b.floors * FH; b.roofTop = this._roofTop(b); }
    const seen = new Set();
    let rebuilt = 0;
    const touched = new Set();
    const CH = CONFIG.building.chunkSize, keyOf = (b) => { const [cx, cz] = centroid(b.corners); return Math.floor(cx / CH) + ',' + Math.floor(cz / CH); };
    const groups = new Map();
    for (const b of buildings) {
      seen.add(b.id);
      const c = this.cache.get(b.id), key = keyOf(b);
      if (!c || c.ver !== b.ver) { this.cache.set(b.id, this._buildOne(b)); rebuilt++; touched.add(key); }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.cache.delete(id);
    this.lastRebuilt = rebuilt;
    // chunks that lost or gained a house, or are gone
    for (const [key, ch] of this.chunks) {
      const list = groups.get(key);
      const ids = list ? list.map((b) => b.id).join(',') : '';
      if (ids !== ch.ids) touched.add(key);
      if (!list) { this._disposeChunk(ch); this.chunks.delete(key); }
    }
    for (const key of groups.keys()) if (!this.chunks.has(key)) touched.add(key);
    for (const key of touched) if (groups.has(key)) this._fillChunk(key, groups.get(key));
  }

  /** (Re)fill one chunk's meshes from its houses' cached pieces. */
  _fillChunk(key, list) {
    let ch = this.chunks.get(key);
    if (!ch) { ch = { key, mass: null, det: null, detN: null, detF: null, parts: {}, sphere: new THREE.Sphere(), ids: '' }; this.chunks.set(key, ch); }
    ch.ids = list.map((b) => b.id).join(',');
    // its bounding sphere: every house's footprint, from its lowest ground to its roof (plus balconies and awnings)
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const b of list) for (const p of b.corners) { box.expandByPoint(v.set(p[0], b.gMin - 1.5, p[1])); box.expandByPoint(v.set(p[0], (b.roofTop ?? b.top) + 2, p[1])); }
    box.expandByScalar(2.5);
    box.getBoundingSphere(ch.sphere);
    // --- the merged meshes: walls + roofs, facade detail, and near-only facade detail ---
    this._fillMerged(ch, 'mass', list, (c) => c);
    this._fillMerged(ch, 'det', list, (c) => c.det);
    this._fillMerged(ch, 'detN', list, (c) => c.detN);
    this._fillMerged(ch, 'detF', list, (c) => c.detF);
    // --- instance batches ---
    for (const k of Object.keys(this.parts)) {
      let n = 0;
      for (const b of list) n += this.cache.get(b.id).parts[k].n;
      let mesh = ch.parts[k];
      if (!n) { if (mesh) mesh.count = 0, mesh.visible = false; continue; }
      if (!mesh || mesh.userData.cap < n) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        const P = this.parts[k], cap = Math.max(8, Math.ceil(n * 1.3));
        mesh = new THREE.InstancedMesh(P.geo, P.mat, cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        mesh.castShadow = P.shadow; mesh.receiveShadow = true;
        mesh.userData = { cap, kind: k, lod: P.lod || null };
        ch.parts[k] = mesh;
        this.group.add(mesh);
      }
      const M = mesh.instanceMatrix.array, C = mesh.instanceColor.array;
      let i = 0;
      for (const b of list) {
        const p = this.cache.get(b.id).parts[k];
        if (!p.n) continue;
        M.set(p.m, i * 16); C.set(p.c, i * 3);
        i += p.n;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = ch.sphere.clone();   // whole-chunk culling (no per-instance bounds)
    }
    ch.lodNear = null;                           // re-apply detail by distance on the next frame
  }

  /** Copy the cached pieces of a chunk's houses into one of its merged meshes (`slot`). */
  _fillMerged(ch, slot, list, pick) {
    let nv = 0;
    for (const b of list) nv += pick(this.cache.get(b.id)).pos.length;
    const capKey = slot + 'Cap';
    if (!ch[slot] || ch[capKey] < nv) {
      ch[capKey] = Math.ceil((nv * 1.3 + 900) / 9) * 9;   // whole triangles (3 vertices × 3 floats), with head-room
      const geo = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aoParams', 3], ['aWall', 3], ['aBake', 3]]) {
        geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(ch[capKey]), size).setUsage(THREE.DynamicDrawUsage));
      }
      if (ch[slot]) { ch[slot].geometry.dispose(); ch[slot].geometry = geo; }
      else {
        const m = new THREE.Mesh(geo, this.massMat);
        m.castShadow = true; m.receiveShadow = true;
        m.userData = { houseMass: slot === 'mass', merged: slot, lod: slot === 'detN' ? 'near' : slot === 'detF' ? 'far' : null };
        ch[slot] = m;
        this.group.add(m);
      }
    }
    const A = ch[slot].geometry.attributes;
    let o = 0;
    for (const b of list) {
      const c = pick(this.cache.get(b.id));
      A.position.array.set(c.pos, o); A.normal.array.set(c.nor, o); A.color.array.set(c.col, o); A.aoParams.array.set(c.ao, o); A.aWall.array.set(c.wall, o); A.aBake.array.set(c.bake, o);
      o += c.pos.length;
    }
    for (const a of Object.values(A)) { a.clearUpdateRanges(); a.addUpdateRange(0, nv); a.needsUpdate = true; }
    ch[slot].geometry.setDrawRange(0, nv / 3);
    ch[slot].geometry.boundingSphere = ch.sphere.clone();
    ch[slot].visible = nv > 0;
  }

  _disposeChunk(ch) {
    for (const slot of ['mass', 'det', 'detN', 'detF']) if (ch[slot]) { this.group.remove(ch[slot]); ch[slot].geometry.dispose(); }
    for (const m of Object.values(ch.parts)) { this.group.remove(m); m.dispose(); }
  }

  /**
   * Detail by distance, per chunk (call once a frame with the camera): close chunks show
   * recessed openings with frames, glass and louvred leaves; far ones (beyond the LOD
   * distance × the quality's reach) show only the flat painted openings. Hidden meshes
   * cost nothing to draw.
   */
  updateLod(camera) {
    const D = this.lodDist.value, p = camera.position;
    let changed = false;
    for (const ch of this.chunks.values()) {
      const near = p.distanceTo(ch.sphere.center) - ch.sphere.radius * 0.55 < D;
      if (near === ch.lodNear) continue;
      ch.lodNear = near; changed = true;
      for (const m of Object.values(ch.parts)) {
        const lod = m.userData.lod;
        m.visible = m.count > 0 && (!lod || (lod === 'near') === near);
      }
      if (ch.detN) ch.detN.visible = near && ch.detN.geometry.drawRange.count > 0;
      if (ch.detF) ch.detF.visible = !near && ch.detF.geometry.drawRange.count > 0;
    }
    return changed;
  }

  /** How many instances of a part kind the town has (all chunks). */
  partCount(k) {
    let n = 0;
    for (const ch of this.chunks.values()) if (ch.parts[k]) n += ch.parts[k].count;
    for (const c of this.cache.values()) if (c.counts && c.counts[k]) n += c.counts[k];   // (merged parts)
    return n;
  }

  /** Every walls-and-roofs mesh (one per chunk). */
  massMeshes() { return [...this.chunks.values()].map((ch) => ch.mass).filter(Boolean); }

  /**
   * A window painted on the plaster (Ligurian trompe-l'oeil): a painted frame,
   * one shutter leaf shut and one swung open in perspective, a dark room, and
   * now and then a cat on the sill. Flat paint: no depth, no reveal shadow.
   * The instance colour is the shutter colour.
   */
  _fakeMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec2 vFk;\nvarying float vFr;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vFk = position.xy - vec2(0.0, 0.02);
        vFr = 0.5;
        #ifdef USE_INSTANCING
          vFr = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9, 78.2, 37.7))) * 43758.5);
        #endif`);
      sh.fragmentShader = 'varying vec2 vFk;\nvarying float vFr;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
        vec3 shut = vec3(0.2, 0.45, 0.3);
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          shut = vColor.rgb;
        #endif
        vec2 q = vFk / vec2(0.68, 0.95);                       // -1..1 across the painted panel
        vec3 c = vec3(0.92, 0.88, 0.78);                       // the painted surround
        c *= 0.93 + 0.07 * step(q.x + q.y * 0.3, 0.0);         // a painted shadow side, to fake relief
        if (abs(q.x) < 0.76 && abs(q.y) < 0.8) {
          c = vec3(0.13, 0.15, 0.17);                          // the dark room
          float louvre = 0.84 + 0.16 * step(0.5, fract(q.y * 10.0));
          if (q.x > 0.02) c = shut * louvre;                   // right leaf: shut
          else {
            float w = 0.34 * (1.0 - 0.14 * q.y);               // left leaf: swung open, seen edge-on in perspective
            if (q.x < -0.76 + w) c = shut * 0.78 * (0.84 + 0.16 * step(0.5, fract(q.y * 10.0 + q.x * 3.0)));
            else if (abs(q.x + 0.2) < 0.022 || abs(fract((q.y + 0.8) / 0.4) - 0.5) > 0.47) c = vec3(0.86, 0.84, 0.78);   // glazing bars
          }
          if (vFr > 0.72) {                                    // the odd painted cat on the sill
            vec2 k = q - vec2(-0.2, -0.8);
            vec3 fur = vFr > 0.9 ? vec3(0.12) : vFr > 0.8 ? vec3(0.72, 0.42, 0.16) : vec3(0.55, 0.53, 0.5);
            float body = length(k / vec2(0.15, 0.2) - vec2(0.0, 0.95));
            float head = length((k - vec2(0.02, 0.42)) / vec2(0.1, 0.085));
            float ear = max(abs(abs(k.x - 0.02) - 0.06) * 14.0 + (k.y - 0.5) * 9.0, -(k.y - 0.47) * 30.0);
            float tail = abs(length(k - vec2(0.2, 0.1)) - 0.12);
            if (body < 1.0 || head < 1.0 || ear < 0.55 || (tail < 0.02 && k.y < 0.14 && k.y > 0.0)) c = fur;
          }
        }
        diffuseColor.rgb = c;`);
    };
    return m;
  }

  /** Is there a lane (or the quay) right outside wall `i` of this footprint? */
  _laneBeside(q, i) {
    const A = q[i], Bc = q[(i + 1) % 4], n = edgeNormal(q, i);
    for (const f of [0.35, 0.5, 0.65]) for (const d of [0.9, 1.5]) {
      const p = lerp2(A, Bc, f), o = this.growth.occAt(p[0] + n[0] * d, p[1] + n[1] * d);
      if (o < -1) return true;
    }
    return false;
  }

  /** The look of one house, drawn once from its seed: wear, trim, ground floor, roof, habits. */
  _look(b, rng) {
    const K = CONFIG.building.look, hsl = {};
    b.facade.getHSL(hsl);
    const wr = rng(), dr = rng(), gr = rng();
    const wear = wr < K.wearNone ? rng() * 0.1 : wr < K.wearNone + K.wearSome ? 0.15 + rng() * 0.3 : 0.45 + rng() * 0.5;
    const deco = dr < K.decoNone ? 'none' : dr < K.decoNone + K.decoBand ? 'band' : dr < 1 - K.decoFull ? 'surrounds' : 'full';
    const terra = b.roofKind === 'terracotta';
    const F = {
      wear, deco,
      quoins: deco === 'full' && rng() < 0.6,
      // painted trim is lighter than the wall; on pale walls a soft ochre or grey instead
      trim: new THREE.Color(hsl.l > 0.8 ? rng.pick(K.trimOnPale) : rng.pick(K.trim)),
      ground: gr < K.groundStone ? 'stone' : gr < K.groundStone + K.groundDado ? 'dado' : 'plain',
      taper: K.taper[0] + rng() * (K.taper[1] - K.taper[0]),
      pitch: K.roofPitch[0] + rng() * (K.roofPitch[1] - K.roofPitch[0]),
      ridgeTerracotta: terra || rng() < K.ridgeTerracotta,
      eaves: new THREE.Color('#b9b2a6').multiplyScalar(0.92 + rng() * 0.14),
      terraceFloor: new THREE.Color(rng.pick(['#c2b6a4', '#b9ad9c', '#cbbfae', '#b8704e'])),
      shut: [K.shutClosed * (0.6 + rng() * 0.9), K.shutTilt, K.shutOpen * (0.6 + rng() * 0.9), K.shutHalf],
      smallTop: rng() < K.smallTopFloor,
      blindCol: rng() < FACADES.windows.blindBay ? (rng() * 4) | 0 : -1,
      irregular: rng(),
      balconySolid: rng() < K.balconySolid,
      balconyTint: new THREE.Color(rng.pick(['#ffffff', '#ffffff', '#dfe8df', '#f4efe6'])),
      doorCol: new THREE.Color(rng.weighted(PALETTE.door)),
      doorStone: new THREE.Color(rng.pick(['#b3ada2', '#c8c0b0', '#a5a096'])),
      pipe: rng() < K.drainpipe, pipeCol: new THREE.Color(rng.pick(['#7a4a3a', '#8a5a44', '#4f6e66', '#6b665e'])),
      bouga: rng() < K.bougainvillea,
      pots: rng() < K.doorPots,
      wash: K.washing * (rng() < 0.5 ? 0.3 : 1.7),
      flowers: K.flowerBox * (rng() < 0.6 ? 0.4 : 2.2),
      flowerCol: new THREE.Color(rng.pick(K.flowerColours)),
    };
    // (drawn last, so houses keep the look they had before these were added)
    F.sillCol = new THREE.Color(rng.weighted(FACADES.windows.sill.colours));
    F.shutFade = rng() < FACADES.shutters.fadedHouses ? FACADES.shutters.fade[0] + rng() * (FACADES.shutters.fade[1] - FACADES.shutters.fade[0]) : 0;
    F.shutFadeCol = new THREE.Color(FACADES.shutters.fadeColour);
    // the house's own rhythm (v0.21, data/facades.json rhythm): storey heights, window size and spacing, trim
    const RH = FACADES.rhythm, pickIn = (r) => r[0] + rng() * (r[1] - r[0]);
    F.floorH = pickIn(RH.storey);
    F.atticH = rng() < RH.lowAttic ? pickIn(RH.attic) : F.floorH;
    F.tallFloor = rng() < RH.tallFloor ? 1 + ((rng() * 3) | 0) : -1;      // one storey (counted from the top) with higher rooms
    F.tallBy = pickIn(RH.tallBy);
    F.storeyJit = Array.from({ length: 8 }, () => (rng() - 0.5) * 2 * RH.storeyJitter);
    F.colPitch = pickIn(RH.columnPitch);
    F.colShift = rng() < RH.centred ? 0.5 : rng();                       // where the window columns sit between the corners
    F.winW = pickIn(RH.windowWidth); F.winH = pickIn(RH.windowHeight);
    F.oddCol = rng() < RH.oddColumn ? (rng() * 4) | 0 : -1;              // one column of narrower windows
    F.oddFloor = rng() < RH.oddFloor ? 1 + ((rng() * 4) | 0) : -1;       // one storey of shorter windows
    F.cornice = rng.weighted(RH.cornice);
    F.balMul = rng.pick(RH.balconyShare);
    F.bandBreak = rng() < RH.bandBreak ? (rng() < 0.5 ? -1 : 1) * pickIn(RH.bandBreakAt) : 0;   // a string course that stops part-way (sign: from which end)
    F.shutMul = { closed: F.shut[0] / K.shutClosed, open: F.shut[2] / K.shutOpen };
    F.trimSoft = F.trim.clone().lerp(b.facade, 0.5);        // painted surrounds and bands: half way to the wall colour (thin and low in contrast)
    F.ridge = F.ridgeTerracotta ? new THREE.Color(rng.pick(['#ae7055', '#b6775d', '#a2643f'])) : new THREE.Color('#dcd8cf');
    return F;
  }

  /** Generate one house: its wall/roof triangles and its detail instances. */
  _buildOne(b) {
    const t = this.terrain, K = CONFIG.building.look;
    const lists = {};
    for (const k of Object.keys(this.parts)) lists[k] = [];
    // instance = [x, y, z, rotY, sx, sy, sz, colour]
    const gbA = new GeoBuilder(), gbN = new GeoBuilder(), gbF = new GeoBuilder(), counts = {};   // merged facade detail: always / near only / far only
    const put = (k, x, y, z, rot, sx, sy, sz, col) => {
      const gbX = this.mergeAlways.has(k) ? gbA : this.mergeNear.has(k) ? gbN : this.mergeFar.has(k) ? gbF : null;
      if (gbX) { this._bake(gbX, k, x, y, z, rot, sx, sy, sz, col); counts[k] = (counts[k] || 0) + 1; }
      else lists[k].push(x, y, z, rot, sx, sy, sz, col.r, col.g, col.b);
    };
    const cream = CREAM, stone = STONE, awnCols = AWN_COLS;
    const gb = new GeoBuilder();
    const ov = this.style.overhang;

    const rng = makeRng(b.seed);
    // the house as the simulation sees it: its condition and what each floor is used for
    const [pcx, pcz] = centroid(b.corners), phb = this.terrain.harbour;
    const plan = planHouse(b, Math.max(1, Math.round((b.top - b.gMin) / FH)), Math.hypot(pcx - phb.x, pcz - phb.z) < FACADES.groundFloors.harbourRadius);
    const F = this._look(b, rng);
    // condition: paint fades and greys, plaster crumbles only on houses in poor repair, fewer flowers
    const cond = plan.condition, paint = b.facade.clone(), hslP = {};
    paint.getHSL(hslP); paint.setHSL(hslP.h, hslP.s * (0.74 + 0.26 * cond), Math.min(0.92, hslP.l + (1 - cond) * 0.05));
    F.wear = cond < CONFIG.building.condition.wearBelow ? (CONFIG.building.condition.wearBelow - cond) / CONFIG.building.condition.wearBelow * 0.85 : 0;
    F.flowers *= 0.4 + cond; F.pots = F.pots && rng() < 0.45 + cond;
    const base = b.gMin - 1.2;
    const q = b.corners;
    // Storeys, from the roof down (v0.21): each house has its own heights (a low attic, one storey of
    // higher rooms, none quite equal), fitted so that together they still fill the house from the
    // uphill ground to the eaves: the ground floor's floor stays at ground level. Below that (the
    // downhill side of a house on a slope) the storeys are the plain 3 m. floorBottoms[k] = the floor of storey k.
    const nFl = Math.max(1, Math.round((b.top - b.gMax) / FH));
    const rawH = [];
    for (let k = 0; k < nFl; k++) rawH.push(Math.max(2.3, (k === 0 && nFl >= 3 ? F.atticH : F.floorH + (k === F.tallFloor && nFl >= 3 ? F.tallBy : 0)) + F.storeyJit[k % 8]));
    const fitH = (b.top - b.gMax) / rawH.reduce((a, v) => a + v, 0);
    const storeyH = (k) => (k < nFl ? rawH[k] * fitH : FH);
    const floorBottoms = [];
    for (let y = b.top, k = 0; k < 40; k++) { y -= storeyH(k); if (y < base) break; floorBottoms.push(k === nFl - 1 ? b.gMax : y); }
    const qTop = offsetPoly(q, -F.taper);                 // walls lean in a touch: old walls are never plumb
    gb.wear = Math.min(F.wear, 0.95) + (F.quoins ? 1 : 0);

    // --- walls, stone ground floor, string courses, cornice ---
    let stoneTop = 0;                                     // top of the rough stone, where there is some
    const bands = [];                                     // stone bases, dados, string courses: built after the openings (cut through them)
    // the wall's outer skin: bands (from the foot up to `top`) that stand `out` metres proud of
    // the footprint (stone bases, dados, plinths); wall-mounted parts are placed on the skin
    const skins = [];
    b.openings = [];                                      // every opening and wall-mounted part (tests check them)
    if (b.arch) {
      // Archway / covered passage: the house sits on two piers over the lane.
      const a = b.arch, hw = b.w / 2, hd = b.d / 2;
      gb.layer = LAYERS.plaster;
      gb.prism(q, a.y, b.top, b.facade, false, true);
      const piers = a.axis === 'f'
        ? [this._rectPart(b, -hw, a.lo, -hd, hd), this._rectPart(b, a.hi, hw, -hd, hd)]
        : [this._rectPart(b, -hw, hw, -hd, a.lo), this._rectPart(b, -hw, hw, a.hi, hd)];
      for (const pier of piers) if (dist(pier[0], pier[1]) > 0.2 && dist(pier[1], pier[2]) > 0.2) gb.prism(pier, base, a.y + 0.05, b.facade, false);
      this._passageVault(gb, b, stone);
    } else {
      // (the walls themselves are built after the facades, with the openings cut through them)
      const hb = this._harbourBase(b, rng);
      if (hb) {
        // rough stone base, battered at the foot, with a pale string course on top
        const rub = LAYERS.rubble ?? LAYERS.stoneBase;
        bands.push({ kind: 'level', out: 0.14, y0: base, y1: hb.top, col: hb.col, layer: rub },
          { kind: 'level', out: 0.26, y0: base, y1: b.gMin + 0.9, col: hb.col.clone().multiplyScalar(0.9), layer: rub, revealTo: 0.14 },
          { kind: 'level', out: 0.18, y0: hb.top - 0.04, y1: hb.top + 0.16, col: cream, layer: LAYERS.stoneDressed, revealTo: 0.14, bottom: true });
        skins.push({ top: b.gMin + 0.9, out: 0.26 }, { top: hb.top - 0.04, out: 0.14 }, { top: hb.top + 0.16, out: 0.18 });
        if (hb.vault) this._boatStore(gb, put, b, hb.vault, rng);
        stoneTop = hb.top;
      } else if (F.ground === 'stone') {
        // a rough stone ground floor (the cellar), plaster above
        stoneTop = Math.min(b.gMin + K.stoneStorey[0] + rng() * (K.stoneStorey[1] - K.stoneStorey[0]), b.top - FH);
        const rub = LAYERS.rubble ?? LAYERS.stoneBase;
        bands.push({ kind: 'level', out: 0.05, y0: base, y1: stoneTop, col: new THREE.Color(rng.pick(K.stoneColours)), layer: rub },
          { kind: 'level', out: 0.11, y0: base, y1: b.gMin + 0.5, col: new THREE.Color(rng.pick(K.stoneColours)).multiplyScalar(0.9), layer: rub, revealTo: 0.05 });
        skins.push({ top: b.gMin + 0.5, out: 0.11 }, { top: stoneTop, out: 0.05 });
      } else if (F.ground === 'dado') {
        // a rough render dado whose top line follows the lane up the slope
        const h = K.dado[0] + rng() * (K.dado[1] - K.dado[0]), col = new THREE.Color(rng.pick(K.dadoColours));
        const dado = { kind: 'follow', h, col, walls: [], layer: LAYERS.plasterWorn, out: 0.035 };
        bands.push(dado);
        for (let i = 0; i < 4; i++) {
          const A = q[i], Bc = q[(i + 1) % 4], n = edgeNormal(q, i);
          const gA = t.heightAt(A[0] + n[0] * 0.3, A[1] + n[1] * 0.3), gB = t.heightAt(Bc[0] + n[0] * 0.3, Bc[1] + n[1] * 0.3);
          dado.walls.push({ gA, gB });
          skins.push({ top: Math.max(gA, gB) + h + 0.03, out: 0.035, dado: true });
        }
      } else {
        // a dressed-stone base along the foot of the walls, following the lane (doors are cut through it)
        const SB = FACADES.groundFloors.stoneBase, h = SB.height[0] + rng() * (SB.height[1] - SB.height[0]);
        const dado = { kind: 'follow', h, col: new THREE.Color(rng.pick(K.stoneColours)).multiplyScalar(1.05), walls: [], layer: LAYERS.stoneBase, out: SB.out };
        bands.push(dado);
        for (let i = 0; i < 4; i++) {
          const A = q[i], Bc = q[(i + 1) % 4], n = edgeNormal(q, i);
          const gA = t.heightAt(A[0] + n[0] * 0.3, A[1] + n[1] * 0.3), gB = t.heightAt(Bc[0] + n[0] * 0.3, Bc[1] + n[1] * 0.3);
          dado.walls.push({ gA, gB });
          skins.push({ top: Math.max(gA, gB) + h + 0.03, out: SB.out, dado: true });
        }
      }
    }
    b.stoneTop = stoneTop;
    /** How far the wall's surface stands out from the footprint at height y (bands, or the lean of the wall). */
    const skin = (y) => {
      let out = -F.taper * clamp((y - base) / (b.top - base), 0, 1);
      for (const k of skins) if (y < k.top) out = Math.max(out, k.out);
      if (this.style.chamfer) out = Math.max(out, 0);
      return out;
    };
    const covered = this._coverTest(b);
    // trim (data/facades.json trim): bands at the floor lines on decorated houses and some plain ones, kept
    // subtle (close to the wall colour), always above the highest ground so they never cross a door
    const TR = FACADES.trim, RH = FACADES.rhythm;
    const party = b.arch ? null : this._partyTops(b, q);   // (where a neighbour hides the lower part of a wall)
    b.partyTops = party;
    if (!b.arch && (F.deco !== 'none' || rng() < TR.bands.chance)) {
      // v0.21: a string course is laid wall by wall. It always runs along the front; on the other walls only
      // sometimes; never where a neighbour hides it; and on some houses it stops part-way along the front.
      gb.layer = LAYERS.plaster;
      const bandCol = F.deco === 'none' ? paint.clone().offsetHSL(0, -0.04, 0.05) : F.trimSoft;
      const onWall = [true, rng() < RH.bandOnSide, rng() < RH.bandOnSide * 0.6, rng() < RH.bandOnSide];
      let first = true;
      for (let k = floorBottoms.length - 1; k >= 0; k--) {
        const y = floorBottoms[k];
        if (y < Math.max(b.gMax + 2.9, stoneTop + 0.3) || y > b.top - 2) continue;
        if (first || F.deco !== 'band') {
          for (let i = 0; i < 4; i++) {
            if (!onWall[i] || (party && party[i] >= y - 0.1)) continue;
            const A = q[i], Bc = q[(i + 1) % 4], L = dist(A, Bc), e = norm(sub(Bc, A)), n = edgeNormal(q, i), o = TR.bands.proud;
            let u0 = -o, u1 = L + o;
            if (i === 0 && F.bandBreak && L > 3) { if (F.bandBreak > 0) u1 = L * F.bandBreak; else u0 = L * (1 + F.bandBreak); }
            this._strip(gb, A, e, n, u0, u1, y - TR.bands.height / 2, y + TR.bands.height / 2, o, bandCol);
          }
        }
        first = false;
      }
    }
    // the cornice under the eaves. v0.21: not every house has the full one. 'full' = two steps, the upper
    // standing further out, so it casts a shadow line; 'single' = one plain step; 'none' = the eaves sit
    // straight on the wall. Along a street the cornice line therefore breaks from house to house.
    const corniceCol = rng() < 0.6 ? cream : b.facade.clone().offsetHSL(0, -0.1, 0.12);
    const cor = this.style.cornice, cp = TR.cornice.proud * (0.8 + 0.4 * this.style.cornice);
    const corKind = b.arch ? 'full' : F.cornice;
    gb.layer = LAYERS.plaster;
    if (corKind === 'full') {
      this._walls(gb, offsetPoly(qTop, cp * 0.45), b.top - cor, b.top - cor * 0.45, corniceCol.clone().multiplyScalar(0.97), true);
      this._walls(gb, offsetPoly(qTop, cp), b.top - cor * 0.45, b.top, corniceCol, true);
      gb.face(offsetPoly(qTop, cp).map((p2) => [p2[0], b.top - cor * 0.45, p2[1]]), corniceCol.clone().multiplyScalar(0.7), [0, -1, 0]);   // its underside, in shade
    } else if (corKind === 'single') {
      this._walls(gb, offsetPoly(qTop, cp * 0.55), b.top - cor * 0.5, b.top, corniceCol.clone().lerp(paint, 0.4), true);
      gb.face(offsetPoly(qTop, cp * 0.55).map((p2) => [p2[0], b.top - cor * 0.5, p2[1]]), corniceCol.clone().multiplyScalar(0.7), [0, -1, 0]);
    }

    // --- roof, chimneys, roof terrace ---
    const ridge = this._roof(gb, b, ov, F.pitch, F);
    if (ridge) {
      const n = 1 + (rng() < K.secondChimney ? 1 : 0) + (rng() < 0.12 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const tt = 0.18 + rng() * 0.64, f = 0.15 + rng() * 0.5, sideA = rng() < 0.5;
        const Rp = lerp2(ridge.R0, ridge.R1, tt);
        const eave = ridge.along ? (sideA ? lerp2(q[0], q[1], tt) : lerp2(q[3], q[2], tt)) : (sideA ? lerp2(q[0], q[3], tt) : lerp2(q[1], q[2], tt));
        const p = lerp2(Rp, eave, f), y = ridge.yr - (ridge.yr - b.top) * f - 0.2;
        const col = rng() < 0.6 ? b.facade : new THREE.Color(rng.pick(['#e6dcc6', '#d9c9a0', '#c9c2b6']));
        const sy = 0.75 + rng() * 0.5;
        put('chimney', p[0], y, p[1], b.theta, 1, sy, 1, col);
        if (rng() < K.chimneyPot) put('pot', p[0], y + 1.23 * sy, p[1], 0, 0.75, 1.5, 0.75, TERRACOTTA);
      }
    } else if (b.roof === 'flat') this._terrace(put, b, rng, F);

    // --- facades: doors and windows along every wall (v0.13: openings cut into the walls) ---
    const holes = [[], [], [], []];                       // per wall: openings to cut, { u0, u1, y0, y1, depth, col }
    const feats = [[], [], [], []];                       // per wall: patches of baked shade (under sills and balconies, inside corners)
    const AOc = CONFIG.building.ao, WE = CONFIG.building.weather;
    // inside corners: where a neighbour's wall stands out in front of the end of this wall
    const nearHouses = this.growth.live.map((id) => this.growth.buildings[id]).filter((o) => o && o !== b && !o.arch && Math.abs(o.x - b.x) < 20 && Math.abs(o.z - b.z) < 20);
    const WIN = FACADES.windows;
    const plain = (y) => skins.every((k) => k.dado || y >= k.top);   // plaster here (or a dado that can be cut through)
    const lean = (y) => (this.style.chamfer ? 0 : -F.taper * clamp((y - base) / (b.top - base), 0, 1));
    for (let i = 0; i < 4; i++) {
      const A = q[i], Bc = q[(i + 1) % 4];
      const L = dist(A, Bc);
      if (L < 1.6) continue;
      const n = edgeNormal(q, i), e = norm(sub(Bc, A));
      const front = i === 0;
      const srot = Math.atan2(n[0], n[1]);
      const sgn = Math.sign(n[1] * e[0] - n[0] * e[1]) || 1;   // does the parts' local +x run along e (1) or against it (-1)?
      const W = { A, e, n, L, nx: n[0], nz: n[1], ex: e[0], ez: e[1], rot: srot, sgn, wall: i };
      for (const atEnd of [false, true]) {
        const cnr = atEnd ? Bc : A, s = atEnd ? 0.35 : -0.35, px = cnr[0] + e[0] * s + n[0] * 0.45, pz = cnr[1] + e[1] * s + n[1] * 0.45;
        let top = -Infinity;
        for (const o of nearHouses) if (pointInPoly([px, pz], o.corners)) top = Math.max(top, o.top);
        if (top > base + 1 && L > 2 * AOc.cornerReach) feats[i].push(this._shadeCorner(atEnd, L, base, Math.min(top, b.top), AOc.cornerReach, AOc.cornerFrom));
      }
      const [hcx, hcz] = centroid(q), hbr = this.terrain.harbour;
      const harbourHouse = Math.hypot(hcx - hbr.x, hcz - hbr.z) < FACADES.groundFloors.harbourRadius;
      const seaward = harbourHouse && n[1] > 0.35;          // the sea lies toward +z: walls looking out over the harbour
      // Window columns (v0.21). Windows still stack in vertical columns, but each house has its own spacing
      // (`F.colPitch`), its columns need not sit centred between the corners (`F.colShift`), a side wall may
      // have a single column or stand blank, and one column may be of narrower windows.
      const RH = FACADES.rhythm;
      const wStd = WIN.types.standard.w * F.winW, margin = WIN.edgeMargin + wStd / 2, avail = Math.max(0, L - 2 * margin);
      const pitchWanted = (front ? WIN.columns.front : WIN.columns.side) * F.colPitch;
      let cols = Math.max(1, Math.round(L / pitchWanted));
      while (cols > 1 && avail / (cols - 1) < wStd + RH.minGap) cols--;
      const plainSide = !front && !seaward && !b.arch;
      const blankWall = plainSide && rng() < RH.blankWall;                // a wall with no windows at all (a painted one, now and then)
      if (plainSide && rng() < RH.sparseWall) cols = 1;
      const pitch = cols > 1 ? Math.min(pitchWanted, avail / (cols - 1)) : 0;
      const start = margin + (avail - pitch * (cols - 1)) * (front ? F.colShift : rng());
      const jit = Math.min(0.12, Math.max(0, pitch - wStd - RH.minGap) * 0.5) * F.irregular;
      const us = [];
      for (let ci = 0; ci < cols; ci++) us.push(clamp(start + ci * pitch + (rng() - 0.5) * 2 * jit, Math.min(margin, L / 2), Math.max(L - margin, L / 2)));
      if (front && cols >= 2 && rng() < WIN.pairChance) {
        const ci = (rng() * (cols - 1)) | 0, mid = (us[ci] + us[ci + 1]) / 2, half = wStd / 2 + WIN.pairGap / 2;
        us[ci] = clamp(mid - half, Math.min(margin, L / 2), L / 2); us[ci + 1] = clamp(mid + half, L / 2, Math.max(L - margin, L / 2));
      }

      // the ground floor on the lane (data/facades.json groundFloors): a shopfront, a workshop door, an
      // arched entry or a house door, by the harbour and piazza more often a shop; and a back or side
      // door wherever another lane runs past
      let doorCol = -1, door = null;
      const midCol = Math.floor((cols - 1) / 2);
      const GF = FACADES.groundFloors;
      // (by the harbour, also onto open ground: the quay, the piazza and the café)
      const wantsDoor = b.vaultEdge !== i && (front || (!b.arch && (this._laneBeside(q, i) || harbourHouse)));
      if (wantsDoor) {
        const where = harbourHouse ? 'harbour' : 'town';
        let kind = 'door', awn = 0;
        if (front || harbourHouse) {                       // by the harbour, every wall onto a lane, the quay or the piazza
          // the front wall shows the ground floor's use (from the house's plan); other walls by the harbour, a mix
          const v = front ? GF.variants.find((x) => x.name === groundLook(plan) && x.where === where) || GF.variants.find((x) => x.name === groundLook(plan))
            : rng.weighted(GF.variants.filter((x) => x.where === where).map((x) => [x, x.weight]));
          kind = v.name; awn = v.awning;
        }
        const D = kind === 'shop' ? GF.shopfront : kind === 'workshop' ? GF.workshopDoor : kind === 'arched' ? GF.archedEntry : GF.door;
        const u = clamp(us[midCol], D.w / 2 + 0.45, L - D.w / 2 - 0.45), dx = A[0] + e[0] * u, dz = A[1] + e[1] * u;
        const g = t.heightAt(dx + n[0] * 0.5, dz + n[1] * 0.5);
        let y0 = g + (kind === 'shop' ? 0.05 : kind === 'workshop' ? 0.15 : GF.doorRise);   // a house door stands on two stone steps
        const clear = L > D.w + 0.9 && !covered(A, e, n, u - D.w / 2 - 0.3, u + D.w / 2 + 0.3, g - 0.2, g + D.h + 0.5, front ? 1.0 : FACADES.windows.clearInFront) && y0 + D.h + 0.6 < b.top
          && t.heightAt(dx + n[0] * 1.6, dz + n[1] * 1.6) < g + 0.5 && Math.abs(t.heightAt(A[0] + n[0] * 0.5, A[1] + n[1] * 0.5) - t.heightAt(Bc[0] + n[0] * 0.5, Bc[1] + n[1] * 0.5)) < (front ? 9 : 1.5)
          && !(b.arch && g < b.arch.y - 0.2 && front === false);
        if (clear) {
          doorCol = midCol;
          const recessed = true;                         // (stone bases and dados are cut through too: see _bands)
          const sk = recessed ? lean(y0) : skin(g), px = dx + n[0] * sk, pz = dz + n[1] * sk;
          b.openings.push({ kind: kind === 'door' ? 'door' : kind, wall: i, u0: u - D.w / 2 - 0.2, u1: u + D.w / 2 + 0.2, y0: y0 - 0.2, y1: y0 + D.h + 0.3 });
          const leafCol = front ? F.doorCol : this._c.copy(F.doorCol).multiplyScalar(0.85);
          if (!recessed) {
            // on a rough stone ground floor: the old flat door in its stone frame
            put('doorFrame', px, g + 0.2, pz, srot, 1, 1, 1, F.doorStone);
            put('door', px, g + 0.2, pz, srot, 1, 1, 1, leafCol);
          } else {
            holes[i].push({ u0: u - D.w / 2, u1: u + D.w / 2, y0, y1: y0 + D.h, depth: D.recess, col: (kind === 'shop' ? b.facade : F.doorStone).clone().multiplyScalar(0.95) });
            if (kind !== 'shop') feats[i].push(this._scuffRound(u - D.w / 2 - 0.15, u + D.w / 2 + 0.15, g, y0 + D.h * 0.8, WE.scuffReach));   // plaster knocked about round the door
            if (kind === 'shop') {
              put('shopFront', px, y0, pz, srot, 1, 1, 1, WHITE);
              put('shopSign', px, y0 + D.h + 0.1, pz, srot, 1, 1, 1, this._c.set(rng.pick(['#2f5a44', '#6b3b2a', '#2a4a6b', '#7a2e2a', '#3a3a3a'])));
            } else if (kind === 'workshop') {
              put('wsJambs', px, y0, pz, srot, 1, 1, 1, F.doorStone);
              put('wsLeaf', px, y0, pz, srot, 1, 1, 1, this._c.set(rng.pick(['#7d6b55', '#6e5f4e', '#8a7a64', '#5f6e5f', '#5d6b78'])));
              put('wsTrim', px, y0, pz, srot, 1, 1, 1, this._c);
            } else if (kind === 'arched') {
              put('archJambs', px, y0, pz, srot, 1, 1, 1, F.doorStone);
              put('archLeaf', px, y0, pz, srot, 1, 1, 1, leafCol);
              put('archTrim', px, y0, pz, srot, 1, 1, 1, leafCol);
              put('archSpandrel', px, y0, pz, srot, 1, 1, 1, b.facade);
              put('archRing', px, y0, pz, srot, 1, 1, 1, F.doorStone);
            } else {
              put('doorJambs', px, y0, pz, srot, 1, 1, 1, F.doorStone);
              put('doorLeaf', px, y0, pz, srot, 1, 1, 1, leafCol);
              put('doorTrim', px, y0, pz, srot, 1, 1, 1, leafCol);
            }
            // an awning over a shop or workshop: striped (stripes made in the shader) or plain cream
            if (awn > 0 && rng() < awn) {
              const pair = rng() < GF.awning.plain ? ['#ece6d6', '#ece6d6'] : rng.pick(PALETTE.awningStripes);
              const aw = D.w + 0.5, ay = y0 + D.h + (kind === 'shop' ? 0.62 : 0.35);
              if (ay + 0.1 < b.top) put('awningCloth', px, ay, pz, srot, aw, 1, 1, this._c.set(pair[1]));
            }
          }
          door = { u, w: D.w + 0.34, y0, y1: y0 + D.h + (kind === 'shop' ? 0.7 : 0.25) };
          b.doors = (b.doors || 0) + 1;
          b.groundKinds = b.groundKinds || {}; b.groundKinds[kind] = (b.groundKinds[kind] || 0) + 1;
          if (F.pots && front && kind !== 'shop') this._pots(put, dx, dz, g, W, rng, F);
        }
      }

      // balconies: most upper floors of harbour-front houses, some elsewhere; one per floor, or now and then
      // one running across the whole facade
      const BAL = FACADES.balconies;
      // (v0.21) each house has more or fewer balconies than its neighbours (`F.balMul`), and on a wall they
      // mostly stack in one column (`balHome`), so facades are lopsided the way real ones are
      const pBal = (seaward ? BAL.chanceHarbourFront : front ? (b.balconies ? BAL.chanceFront : 0) : (b.balconies ? BAL.chanceSide : 0)) * F.balMul;
      const balHome = (rng() * cols) | 0;
      let lowestFloor = true;
      for (let k = 0; k < floorBottoms.length; k++) {
        const floorBottom = floorBottoms[k], hF = storeyH(k);
        let any = false;
        const row = [];
        const floorBal = rng() < pBal ? ((front || seaward) && cols >= 2 && rng() < RH.balconyAcross ? 'all' : 'one') : 'none', balCol = rng() < RH.balconyStack ? balHome : (rng() * cols) | 0;   // this storey's windows: planned first, shutters decided left to right
        for (let ci = 0; ci < cols; ci++) {
          const u = us[ci];
          const wx = A[0] + e[0] * u, wz = A[1] + e[1] * u;
          const ground = t.heightAt(wx, wz);
          if (b.arch && floorBottom < b.arch.y - 0.2) continue; // below the rooms of an archway house
          const groundFloor = floorBottom < ground + 1.2;
          const inStone = stoneTop && floorBottom < stoneTop - 0.5;
          // which kind of window: a balcony door (French window), a small top-floor window, or the standard one
          const balcony = floorBal !== 'none' && !lowestFloor && !groundFloor && (floorBal === 'all' || ci === balCol);
          let type = balcony ? 'french' : (k === 0 && F.smallTop ? 'small' : 'standard');
          let T = WIN.types[type];
          // the window's height: the house's own proportion, shorter on its odd storey, and never taller than the storey allows
          const odd = k === F.oddFloor && type === 'standard';
          const hWin = Math.min(T.h * (type === 'small' ? 1 : F.winH) * (odd ? RH.oddFloorScale : 1), Math.max(0.9, hF - T.sillAt - 0.32));
          let y0 = floorBottom + T.sillAt + (odd ? 0.15 : 0), y1 = y0 + hWin;
          for (const s2 of skins) if (s2.dado && y0 < s2.top + 0.1) { y0 = s2.top + 0.1; y1 = Math.max(y1, y0 + 1.1); }   // clear of a dado
          const yMax = b.top - cor - WIN.lintel.height - 0.08;
          if (y1 > yMax) y1 = yMax;
          if (y1 - y0 < 1.2 && type !== 'small') { type = 'small'; T = WIN.types.small; y1 = Math.min(y0 + T.h, yMax); }
          if (y1 - y0 < 0.8) continue;
          if (y0 < ground + 0.35) continue;                // this storey is underground here
          // facing the hillside close in front? (no openings onto a bank of earth)
          if (t.heightAt(wx + n[0] * WIN.clearInFront, wz + n[1] * WIN.clearInFront) > y0 - 0.3) continue;
          const w = T.w * (type === 'small' ? Math.min(1, F.winW) : F.winW) * (ci === F.oddCol % cols && cols > 1 && type !== 'french' ? RH.oddColumnScale : 1);
          // on a wall area covered by, or within ~2 m of, a neighbour? Shared walls get no openings.
          if (covered(A, e, n, u - w / 2 - 0.15, u + w / 2 + 0.15, y0 - 0.2, y1 + 0.3, WIN.clearInFront)) continue;
          if (ci === doorCol && door && y0 < door.y1 && y1 > door.y0) { any = true; continue; }   // the door is here
          const yc = (y0 + y1) / 2;
          if (b.vaultEdge === i && inStone) continue;         // the boat store is this wall's ground floor
          if (inStone) {
            // the cellar: at most a small grated window, no shutters
            if (rng() < 0.3 && floorBottom + WIN.types.cellar.sillAt > ground + 0.5 && floorBottom + WIN.types.cellar.sillAt + WIN.types.cellar.h < stoneTop - 0.25) {
              any = true;
              // a small barred opening through the stone and the wall behind it
              const C = WIN.types.cellar, cy0 = floorBottom + C.sillAt, cy1 = cy0 + C.h, ins = lean(cy0), sk = skin(cy0);
              holes[i].push({ u0: u - C.w / 2, u1: u + C.w / 2, y0: cy0, y1: cy1, depth: WIN.recess });
              put('holeBack', wx + n[0] * ins, (cy0 + cy1) / 2, wz + n[1] * ins, srot, C.w, C.h, 1, WHITE);
              for (const du of [-C.w / 6, C.w / 6]) put('bar', wx + e[0] * du + n[0] * (sk - 0.05), cy0, wz + e[1] * du + n[1] * (sk - 0.05), srot, 0.03, C.h, 0.03, IRON);
              b.openings.push({ kind: 'cellar', wall: i, u0: u - C.w / 2, u1: u + C.w / 2, y0: cy0, y1: cy1 });
            }
            continue;
          }
          if (!plain(y0)) continue;
          const inset = lean(yc), px = wx + n[0] * inset, pz = wz + n[1] * inset;
          // a blind bay: bare wall, or a window painted on it
          if ((front && ci === F.blindCol && cols > 1) || blankWall || rng() < WIN.skipWindow) {
            if (rng() < (blankWall ? RH.blankWallPainted : WIN.fakeWindow)) put('fake', px, yc, pz, srot, w / 1.0, (y1 - y0) / 1.5, 1, b.shutter);
            continue;
          }
          any = true;
          row.push({ u, w, h: y1 - y0, y0, y1, yc, type, px, pz, inset, balcony: type === 'french', ground: groundFloor });
        }
        // shutters: a leaf folds back only where there is room beside the window (not over the next window or the door)
        row.sort((p, p2) => p.u - p2.u);
        const dripReach = WE.dripReach[0] + rng() * (WE.dripReach[1] - WE.dripReach[0]);
        let used = 0.08;                                  // how far along the wall is taken, by openings or folded leaves
        for (let r = 0; r < row.length; r++) {
          const o = row[r], lw = o.w / 2;
          if (door && o.y0 < door.y1 && o.y1 > door.y0 && door.u < o.u) used = Math.max(used, door.u + door.w / 2);
          const next = r + 1 < row.length ? row[r + 1] : null;
          const nextEdge = next ? next.u - next.w / 2 : (door && door.u > o.u && o.y0 < door.y1 && o.y1 > door.y0 ? door.u - door.w / 2 : L - 0.08);
          // (and a folded leaf must not reach into a neighbour standing beside the window)
          o.roomLeft = o.u - o.w / 2 - used >= lw + 0.03 && !covered(A, e, n, o.u - o.w / 2 - lw - 0.05, o.u - o.w / 2, o.y0, o.y1, 0.25);
          o.roomRight = nextEdge - (o.u + o.w / 2) >= lw + 0.03 + (next ? next.w / 2 + 0.03 : 0)   // leave the next window its own left leaf
            && !covered(A, e, n, o.u + o.w / 2, o.u + o.w / 2 + lw + 0.05, o.y0, o.y1, 0.25);
          holes[i].push({ u0: o.u - o.w / 2, u1: o.u + o.w / 2, y0: o.y0, y1: o.y1, depth: WIN.recess });
          // the sill juts out: shade gathers on the wall under it
          if (WIN.types[o.type].sill !== false) {
            feats[i].push(this._shadeBelow(o.u - o.w / 2 - WIN.sill.overhang, o.u + o.w / 2 + WIN.sill.overhang, o.y0 - WIN.sill.height, AOc.sillReach, 0.1, AOc.sillFrom));
            // …and rain running off it leaves streaks down the wall (under most sills, each its own strength)
            // (one length per storey, so the windows of a row share their cut lines in the wall mesh)
            if (rng() < WE.dripChance) feats[i].push(this._dripBelow(o.u - o.w / 2 - WIN.sill.overhang, o.u + o.w / 2 + WIN.sill.overhang, o.y0 - WIN.sill.height, dripReach, 0.45 + 0.55 * rng()));
          }
          b.openings.push({ kind: 'window', wall: i, u0: o.u - o.w / 2, u1: o.u + o.w / 2, y0: o.y0, y1: o.y1 });
          const foldRight = this._opening(put, b, rng, F, W, o);
          used = o.u + o.w / 2 + (foldRight ? lw : 0);
        }
        // the balconies of this floor: one per French window, merged where two would touch
        const bal = row.filter((o) => o.balcony);
        for (let r = 0; r < bal.length;) {
          let r2 = r;
          while (r2 + 1 < bal.length && bal[r2 + 1].u - bal[r2].u < 2.4) r2++;
          const u0 = bal[r].u - bal[r].w / 2 - 0.25, u1 = bal[r2].u + bal[r2].w / 2 + 0.25;
          const placed = this._balcony(put, b, rng, F, W, (u0 + u1) / 2, u1 - u0, bal[r].y0 - 0.005, r2 > r || floorBal === 'all', lean(bal[r].y0));
          if (placed) feats[i].push(this._shadeBelow(placed.u0, placed.u1, placed.y, AOc.balconyReach, 0.3, AOc.balconyFrom),
            this._shadeBelow(placed.u0, placed.u1, placed.y + BAL.slab, AOc.slabReach, 0.15, AOc.slabFrom, true),
            this._dripBelow(placed.u0, placed.u1, placed.y, WE.balconyDripReach, 0.6 + 0.4 * rng(), 0.6));
          r = r2 + 1;
        }
        if (any) lowestFloor = false;
      }

      if (front && !b.arch) {
        // a drainpipe down the party line, and bougainvillea climbing a corner
        if (F.pipe) {
          // down to the ground, or onto the top of a stone ground floor
          const g = Math.max(t.heightAt(A[0], A[1]) - 0.3, stoneTop), out = skin(g) + 0.045 + CONFIG.building.facadeGap;
          if (!covered(A, e, n, 0, 0.32, g, b.top, 0.2)) {
            put('bar', A[0] + e[0] * 0.16 + n[0] * out, g, A[1] + e[1] * 0.16 + n[1] * out, srot, 0.09, b.top - 0.12 - g, 0.09, F.pipeCol);
            b.openings.push({ kind: 'pipe', wall: i, u0: 0.1, u1: 0.22, y0: g, y1: b.top });
          }
        }
        if (F.bouga && !covered(A, e, n, Math.max(0, L - 4.2), L, t.heightAt(Bc[0], Bc[1]), b.top, 0.5)) this._climber(put, b, Bc, e, n, L, rng);
      }
    }

    // --- the walls, with every opening cut through them ---
    gb.layer = LAYERS.plaster;
    const yb = b.arch ? b.arch.y : base;
    if (b.arch) gb.face(q.map((p2) => [p2[0], yb, p2[1]]), b.facade, [0, -1, 0]);
    this._shell(gb, q, qTop, yb, b.top, paint, holes, party, feats);
    this._bands(gb, q, bands, holes, party);

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
    const g = gb.arrays((x, z, nx, nz) => this._enclosure(b, x, z, nx, nz), t, (b.seed % 997) / 997, b.top - this.style.cornice);
    const rnd = (b.seed % 997) / 997;
    return { ver: b.ver, pos: g.pos, nor: g.nor, col: g.col, ao: g.ao, wall: g.wall, bake: g.bake, parts, det: gbA.arraysPlain(rnd), detN: gbN.arraysPlain(rnd), detF: gbF.arraysPlain(rnd), counts };
  }

  /** A part's triangles (non-indexed positions and vertex colours), made once. */
  _flat(k) {
    if (this._flats[k]) return this._flats[k];
    const g = this.parts[k].geo.index ? this.parts[k].geo.toNonIndexed() : this.parts[k].geo;
    const C = g.attributes.color;
    return (this._flats[k] = { pos: g.attributes.position.array, col: C ? C.array : null });
  }

  /** Bake one placed part into a merged builder: translate · rotateY · scale, colour × the part's vertex colours. */
  _bake(gbX, k, x, y, z, rot, sx, sy, sz, col) {
    const f = this._flat(k), P = f.pos, C = f.col, c = Math.cos(rot), s = Math.sin(rot);
    gbX.layer = this.partLayer[k];
    const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], n = [0, 0, 0];
    for (let i = 0; i < P.length; i += 9) {
      for (let j = 0; j < 3; j++) {
        const o = i + j * 3, lx = P[o] * sx, ly = P[o + 1] * sy, lz = P[o + 2] * sz;
        v[j][0] = x + c * lx + s * lz; v[j][1] = y + ly; v[j][2] = z - s * lx + c * lz;
        if (C) { vc[j][0] = C[o] * col.r; vc[j][1] = C[o + 1] * col.g; vc[j][2] = C[o + 2] * col.b; } else { vc[j][0] = col.r; vc[j][1] = col.g; vc[j][2] = col.b; }
      }
      const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
      n[0] = uy * wz - uz * wy; n[1] = uz * wx - ux * wz; n[2] = ux * wy - uy * wx;
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) continue;
      n[0] /= l; n[1] /= l; n[2] /= l;
      gbX._triVC([...v[0]], [...v[1]], [...v[2]], [...n], [...vc[0]], [...vc[1]], [...vc[2]]);
    }
  }

  /** Terracotta pots with geraniums and greenery clustered by a door. */
  _pots(put, x, z, g, W, rng, F) {
    const n = 1 + ((rng() * 3.2) | 0);
    for (let i = 0; i < n; i++) {
      const a = (rng() < 0.5 ? -1 : 1) * (0.95 + rng() * 0.55), out = 0.26 + rng() * 0.16, s = 0.8 + rng() * 0.9;
      const px = x + W.ex * a + W.nx * out, pz = z + W.ez * a + W.nz * out;
      const y = this.terrain.heightAt(px, pz);
      put('pot', px, y, pz, rng() * 6, s, s, s, TERRACOTTA);
      put('blob', px, y + 0.42 * s, pz, rng() * 6, 0.24 * s, 0.28 * s, 0.24 * s, LEAF);
      if (rng() < 0.6) put('blob', px, y + 0.62 * s, pz, rng() * 6, 0.14 * s, 0.1 * s, 0.14 * s, F.flowerCol);
    }
  }

  /** Bougainvillea climbing the corner of a facade and spreading along it. */
  _climber(put, b, corner, e, n, L, rng) {
    const K = CONFIG.building.look, t = this.terrain;
    const g = t.heightAt(corner[0] + n[0] * 0.3, corner[1] + n[1] * 0.3);
    const H = Math.min(3 + rng() * 4.5, b.top - g - 0.8), rot = Math.atan2(n[0], n[1]);
    const tone = new THREE.Color(rng.pick(K.bougainvilleaColours));
    const dab = (u, y, s) => {
      const col = rng() < 0.25 ? LEAF : rng() < 0.6 ? tone : this._c.set(rng.pick(K.bougainvilleaColours));
      put('blob', corner[0] - e[0] * u + n[0] * 0.12, y, corner[1] - e[1] * u + n[1] * 0.12, rot, s * 1.25, s, 0.16, col.clone().multiplyScalar(0.88 + rng() * 0.24));
    };
    for (let y = 0.4; y < H; y += 0.26) dab(0.4 + (rng() - 0.5) * 0.5, g + y, 0.2 + rng() * 0.2);
    const spread = Math.min(L - 0.6, 1.6 + rng() * 2.4);
    for (let u = 0.2; u < spread; u += 0.24) dab(u, g + H + (rng() - 0.5) * 0.5, 0.22 + rng() * 0.22);
    put('pot', corner[0] - e[0] * 0.4 + n[0] * 0.3, g, corner[1] - e[1] * 0.4 + n[1] * 0.3, 0, 1.2, 1.1, 1.2, TERRACOTTA);
  }

  /** A roof terrace (altana): railing, and some of a pergola, a parasol, pots, a washing line. */
  _terrace(put, b, rng, F) {
    const K = CONFIG.building.look, q = b.corners, y0 = b.top + 0.6;
    const inner = offsetPoly(q, -0.08);
    if (rng() < K.terraceRailing) {
      const col = rng() < 0.5 ? IRON : new THREE.Color(rng.pick(['#3f6b52', '#8a3a30', '#d9d5cc']));
      for (let i = 0; i < 4; i++) {
        const A = inner[i], Bc = inner[(i + 1) % 4], L = dist(A, Bc), n = edgeNormal(inner, i), rot = Math.atan2(n[0], n[1]);
        const m = lerp2(A, Bc, 0.5);
        put('bar', m[0], y0 + 0.4, m[1], rot, L, 0.04, 0.04, col);
        const posts = Math.max(2, Math.round(L / 1.4));
        for (let k = 0; k <= posts; k++) { const p = lerp2(A, Bc, k / posts); put('bar', p[0], y0, p[1], rot, 0.04, 0.42, 0.04, col); }
      }
    }
    const P = offsetPoly(q, -0.75), fy = b.top + 0.62;
    if (dist(P[0], P[1]) < 1.2 || dist(P[1], P[2]) < 1.2) return;
    const r = rng();
    if (r < K.terracePergola) {
      const wood = new THREE.Color('#7a6248');
      for (const p of P) put('bar', p[0], fy, p[1], b.theta, 0.09, 2.1, 0.09, wood);
      for (const [i, j] of [[0, 1], [3, 2]]) {
        const m = lerp2(P[i], P[j], 0.5), n = edgeNormal(P, 0);
        put('bar', m[0], fy + 2.1, m[1], Math.atan2(n[0], n[1]), dist(P[i], P[j]) + 0.4, 0.08, 0.08, wood);
      }
      const n1 = edgeNormal(P, 1), rot1 = Math.atan2(n1[0], n1[1]);
      for (let k = 0; k <= 4; k++) { const a = lerp2(P[0], P[1], k / 4), c2 = lerp2(P[3], P[2], k / 4), m = lerp2(a, c2, 0.5); put('bar', m[0], fy + 2.18, m[1], rot1, dist(a, c2) + 0.4, 0.06, 0.06, wood); }
      if (rng() < 0.6) for (let k = 0; k < 7; k++) { const p = quadAt(P, rng(), rng()); put('blob', p[0], fy + 2.25, p[1], rng() * 6, 0.5 + rng() * 0.3, 0.2, 0.5 + rng() * 0.3, rng() < 0.3 ? this._c.set(rng.pick(K.bougainvilleaColours)).clone() : LEAF); }
    } else if (r < K.terracePergola + K.terraceParasol) {
      const p = quadAt(P, 0.3 + rng() * 0.4, 0.3 + rng() * 0.4);
      put('bar', p[0], fy, p[1], 0, 0.05, 2.1, 0.05, IRON);
      put('cone', p[0], fy + 1.95, p[1], rng() * 6, 1.25, 1.2, 1.25, this._c.set(rng.pick(K.parasolColours)).clone());
    }
    if (rng() < K.terraceWashing) {
      const a = quadAt(P, 0.05, 0.85), c2 = quadAt(P, 0.95, 0.85), m = lerp2(a, c2, 0.5), L = dist(a, c2);
      const d = norm(sub(c2, a)), rot = Math.atan2(-d[1], d[0]) + Math.PI / 2;
      for (const p of [a, c2]) put('bar', p[0], fy, p[1], 0, 0.04, 1.75, 0.04, IRON);
      put('bar', m[0], fy + 1.7, m[1], rot, L, 0.015, 0.015, IRON);
      const n = Math.max(2, Math.round(L / 0.55));
      for (let i = 0; i < n; i++) { if (rng() < 0.25) continue; const p = lerp2(a, c2, (i + 0.5) / n); put('cloth', p[0], fy + 1.7, p[1], rot, 0.4 + rng() * 0.25, 0.6 + rng() * 0.5, 1, this._c.set(rng.pick(K.washColours)).clone()); }
    }
    const pots = (rng() * 5) | 0;
    for (let i = 0; i < pots; i++) {
      const p = quadAt(offsetPoly(q, -0.45), rng() < 0.5 ? 0.04 : 0.96, rng()), s = 0.9 + rng() * 0.8;
      put('pot', p[0], fy, p[1], 0, s, s, s, TERRACOTTA);
      put('blob', p[0], fy + 0.4 * s, p[1], rng() * 6, 0.2 * s, 0.24 * s, 0.2 * s, LEAF);
    }
  }
}

/** A point inside a quad [frontLeft, frontRight, backRight, backLeft] at (u across, v front to back). */
function quadAt(q, u, v) { return lerp2(lerp2(q[0], q[1], u), lerp2(q[3], q[2], u), v); }

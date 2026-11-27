// ---------------------------------------------------------------------------
// facade.js — shapes for facade parts (v0.13), built from data/facades.json.
//
// Every part is built in a "wall frame": x along the wall, y up, z out of the wall,
// with the origin on the wall's face at the middle of the opening. The house
// generator (buildings.js) cuts the opening through the wall and places these as
// instances (one draw call per kind of part).
//
//   frameGeometry(type)     window frame at the back of the recess, glazing bars,
//                           stone sill and lintel (vertex-coloured)
//   leafGeometry(side, near) one shutter leaf, 1 m × 1 m (scaled per window): near =
//                           louvred slats in a frame; far = a plain board
//   surroundGeometry(type)  a thin painted band round the opening (trompe-l'oeil)
//   paintedOpening material a flat painted window for distant houses (no recess, no slats)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FACADES } from './data.js';
import { CONFIG } from './config.js';

const WIN = FACADES.windows, SH = FACADES.shutters;
export const GAP = CONFIG.building.facadeGap;

/** Accumulate boxes and quads into one vertex-coloured, non-indexed geometry. */
class Parts {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  /** A box from (x0, y0, z0) to (x1, y1, z1), all six faces. */
  box(x0, y0, z0, x1, y1, z1, hex) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
    this._add(g, hex);
  }
  /** A quad a→b→c→d (counter-clockwise seen from the front). */
  quad(a, b, c, d, hex) {
    const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...d), new THREE.Vector3(...a))).normalize();
    const col = new THREE.Color(hex);
    for (const p of [a, b, c, a, c, d]) { this.pos.push(...p); this.nor.push(n.x, n.y, n.z); this.col.push(col.r, col.g, col.b); }
  }
  _add(g, hex) {
    const col = new THREE.Color(hex), P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) { this.pos.push(P.getX(i), P.getY(i), P.getZ(i)); this.nor.push(N.getX(i), N.getY(i), N.getZ(i)); this.col.push(col.r, col.g, col.b); }
  }
  /** Mirror x (a right-hand leaf from a left-hand one), keeping faces outward. */
  mirrorX() {
    const P = this.pos, N = this.nor, C = this.col;
    for (let i = 0; i < P.length; i += 3) { P[i] = -P[i]; N[i] = -N[i]; }
    for (let t = 0; t < P.length; t += 9) for (const arr of [P, N, C]) {   // swap 2nd and 3rd vertex: same winding after the flip
      for (let k = 0; k < 3; k++) { const a = arr[t + 3 + k]; arr[t + 3 + k] = arr[t + 6 + k]; arr[t + 6 + k] = a; }
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Window kinds with an opening cut through the wall (cellar windows are small grilles on the stone). */
export const WINDOW_TYPES = Object.keys(WIN.types).filter((k) => k !== 'cellar');

/** The frame at the back of the recess, glazing bars, sill and lintel, for a window kind. */
export function frameGeometry(type) {
  const T = WIN.types[type], F = WIN.frame, S = WIN.sill, Li = WIN.lintel, R = WIN.recess;
  const w = T.w, h = T.h, b = F.bar, zb = -R, zf = -R + F.depth, p = new Parts();
  // the frame ring fills the back of the opening edge to edge (so it can never be seen through)
  p.box(-w / 2, h / 2 - b, zb, w / 2, h / 2, zf, F.colour);
  p.box(-w / 2, -h / 2, zb, w / 2, -h / 2 + b, zf, F.colour);
  p.box(-w / 2, -h / 2 + b, zb, -w / 2 + b, h / 2 - b, zf, F.colour);
  p.box(w / 2 - b, -h / 2 + b, zb, w / 2, h / 2 - b, zf, F.colour);
  // glazing bars: a mullion between the two casements, and a transom light on tall windows
  const m = F.mullion;
  if (w > 0.8) p.box(-m / 2, -h / 2 + b, zf - 0.03, m / 2, h / 2 - b, zf + 0.012, F.colour);
  if (T.transom) p.box(-w / 2 + b, h / 2 - 0.45 - m / 2, zf - 0.03, w / 2 - b, h / 2 - 0.45 + m / 2, zf + 0.012, F.colour);
  // the stone sill: from the frame out past the wall face, a little wider than the opening
  if (T.sill !== false) p.box(-w / 2 - S.overhang, -h / 2 - S.height, zb, w / 2 + S.overhang, -h / 2, S.proud, S.colour);
  // the lintel: a pale band over the opening, standing just clear of the wall
  p.box(-w / 2 - Li.overhang, h / 2, GAP - 0.01, w / 2 + Li.overhang, h / 2 + Li.height, GAP + 0.03, Li.colour);
  return p.geometry();
}

/** Where the glass sits in the recess (its z), shared by the glass shader. */
export const GLASS_Z = -WIN.recess + WIN.frame.depth * 0.45;

/**
 * One shutter leaf, 1 m wide and 1 m tall (instances scale it to half the opening),
 * hinged at x = 0 and reaching to x = +1 (a left leaf; `right` mirrors it), front at
 * z = +thickness. Near: stiles, rails and angled louvre slats, a plain back. Far: a board.
 */
export function leafGeometry(right, near) {
  const t = SH.thickness, p = new Parts(), white = '#ffffff', shade = '#dcdcdc';
  if (!near) {
    p.box(0, -0.5, 0, 1, 0.5, t, white);
  } else {
    const st = SH.stile, ra = SH.rail;   // in metres, on a ~0.58 × 1.85 leaf: scaled with the leaf, so a touch thinner on small windows
    const sx = st / 0.58, ry = ra / 1.85;
    p.box(0, -0.5, 0, sx, 0.5, t, white);
    p.box(1 - sx, -0.5, 0, 1, 0.5, t, white);
    p.box(sx, 0.5 - ry, 0, 1 - sx, 0.5, t, white);
    p.box(sx, -0.5, 0, 1 - sx, -0.5 + ry, t, white);
    p.box(sx, -0.5 + ry, 0.2 * t, 1 - sx, 0.5 - ry, 0.35 * t, shade);   // the back of the louvres (seen when folded open)
    // louvre slats: each tilted out at the bottom (they shed rain), overlapping the one below
    const n = SH.slats, y0 = -0.5 + ry, y1 = 0.5 - ry, s = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const yb = y0 + i * s, yt = yb + s * 1.08;
      p.quad([sx, yb, t * 0.95], [1 - sx, yb, t * 0.95], [1 - sx, yt, t * 0.35], [sx, yt, t * 0.35], white);   // the slat face
      p.quad([sx, yb - 0.004, t * 0.35], [1 - sx, yb - 0.004, t * 0.35], [1 - sx, yb, t * 0.95], [sx, yb, t * 0.95], shade);   // its underside lip
    }
  }
  if (right) p.mirrorX();
  return p.geometry();
}

/** A thin painted band round the opening (window surrounds on decorated houses). */
export function surroundGeometry(type) {
  const T = WIN.types[type], w = T.w, h = T.h, band = 0.13, p = new Parts(), z0 = -0.02, z1 = GAP, c = '#ffffff';
  p.box(-w / 2 - band, h / 2, z0, w / 2 + band, h / 2 + band, z1, c);
  p.box(-w / 2 - band, -h / 2 - band, z0, w / 2 + band, -h / 2, z1, c);
  p.box(-w / 2 - band, -h / 2, z0, -w / 2, h / 2, z1, c);
  p.box(w / 2, -h / 2, z0, w / 2 + band, h / 2, z1, c);
  return p.geometry();
}

/**
 * Painted openings for distant houses: one flat quad per window instead of a recess,
 * frame, glass and slatted leaves. The plane spans the opening (|x| < 0.5) and, for open
 * shutters, a leaf's width either side (|x| < 1); y covers the opening and the sill.
 * Instance scale = (window width, window height); instance colour = shutter colour.
 * `state`: 'closed' | 'open' | 'half' | 'none'.
 */
export function paintedOpeningMaterial(state) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const code = { closed: 0, open: 1, half: 2, none: 3 }[state];
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec2 vPo;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vPo = position.xy;`);
    sh.fragmentShader = 'varying vec2 vPo;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      vec3 shut = vec3(0.2, 0.45, 0.3);
      #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        shut = vColor.rgb;
      #endif
      float x = vPo.x, y = vPo.y, ax = abs(x);
      float louvre = 0.86 + 0.14 * step(0.5, fract(y * 13.0));
      vec3 c = vec3(0.0); bool hit = false;
      if (y < -0.5) { if (ax < 0.56) { c = vec3(0.80, 0.77, 0.71); hit = true; } }           // the sill
      else if (ax < 0.5) {
        hit = true;
        bool leaf = ${code === 0 ? 'true' : code === 2 ? 'x < 0.0' : 'false'};
        if (leaf) c = shut * louvre;
        else {
          c = vec3(0.10, 0.11, 0.12);                                                    // dark glass in the shadow of the recess
          if (ax > 0.44 || abs(y) > 0.465 || ax < 0.02) c = vec3(0.62, 0.6, 0.55);         // frame and mullion, in shade
        }
      } else if (${code === 1 ? 'true' : code === 2 ? 'x > 0.0' : 'false'}) { c = shut * louvre * 0.92; hit = true; }   // leaves folded back
      if (!hit) discard;
      diffuseColor.rgb = c;`);
  };
  return m;
}

/**
 * A recessed doorway of width w and height h (origin at the threshold, middle of the
 * opening, on the wall face): `surround` = dressed-stone jambs and lintel standing just
 * proud of the wall, with a stone step in front; `leaf` = the timber door at the back of
 * the recess (vertex colour white: tinted per house by the instance colour).
 */
export function doorGeometries(w, h, recess, arched = false) {
  const st = 0.17, s = new Parts(), l = new Parts(), stone = '#ffffff';
  s.box(-w / 2 - st, 0, -0.02, -w / 2, h, 0.08, stone);
  s.box(w / 2, 0, -0.02, w / 2 + st, h, 0.08, stone);
  if (!arched) s.box(-w / 2 - st, h, -0.02, w / 2 + st, h + 0.2, 0.08, '#f4f4f4');
  s.box(-w / 2 - 0.12, -0.16, -recess, w / 2 + 0.12, 0.0, 0.42, '#e2e2e2');          // threshold step
  // the leaf: vertical planks with a dark gap between the two halves, and a handle
  const z = -recess, t = 0.06;
  l.box(-w / 2, 0, z, w / 2, arched ? h - w / 2 : h, z + t, '#ffffff');
  if (arched) l.box(-w / 2, h - w / 2, z, w / 2, h - 0.04, z + t * 0.5, '#2a2622');   // the dark fanlight
  l.box(-0.012, 0.02, z + t, 0.012, (arched ? h - w / 2 : h) - 0.02, z + t + 0.01, '#5e5e5e');
  for (const x of [-w / 4, w / 4]) l.box(x - 0.005, 0.05, z + t, x + 0.005, (arched ? h - w / 2 : h) - 0.05, z + t + 0.006, '#c8c8c8');
  l.box(0.07, h * 0.45, z + t, 0.12, h * 0.45 + 0.05, z + t + 0.05, '#3a3a3a');
  return { surround: s.geometry(), leaf: l.geometry() };
}

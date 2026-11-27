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
// Baked shade on parts (v0.18): undersides that see no sky, consoles under a slab, the frame at the back of a recess.
const SHADE = CONFIG.building.ao.parts;
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
  /** Baked shade: darken every face added since vertex `from` that looks down (undersides) by `k`, the rest by `kSide`. */
  shadeUnder(from, k, kSide = 1) {
    for (let i = from * 3; i < this.col.length; i += 3) {
      const m = this.nor[i + 1] < -0.9 ? k : kSide;
      this.col[i] *= m; this.col[i + 1] *= m; this.col[i + 2] *= m;
    }
    return this;
  }
  get count() { return this.pos.length / 3; }
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
  const inRecess = '#' + new THREE.Color(F.colour).multiplyScalar(SHADE.recess).getHexString();   // the frame sits back in the wall's shade
  // the frame ring fills the back of the opening edge to edge (so it can never be seen through)
  p.box(-w / 2, h / 2 - b, zb, w / 2, h / 2, zf, inRecess);
  p.box(-w / 2, -h / 2, zb, w / 2, -h / 2 + b, zf, inRecess);
  p.box(-w / 2, -h / 2 + b, zb, -w / 2 + b, h / 2 - b, zf, inRecess);
  p.box(w / 2 - b, -h / 2 + b, zb, w / 2, h / 2 - b, zf, inRecess);
  // glazing bars: a mullion between the two casements, and a transom light on tall windows
  const m = F.mullion;
  if (w > 0.8) p.box(-m / 2, -h / 2 + b, zf - 0.03, m / 2, h / 2 - b, zf + 0.012, inRecess);
  if (T.transom) p.box(-w / 2 + b, h / 2 - 0.45 - m / 2, zf - 0.03, w / 2 - b, h / 2 - 0.45 + m / 2, zf + 0.012, inRecess);
  // the stone sill: from the frame out past the wall face, a little wider than the opening
  const s0 = p.count;
  if (T.sill !== false) p.box(-w / 2 - S.overhang, -h / 2 - S.height, zb, w / 2 + S.overhang, -h / 2, S.proud, S.colour);
  p.shadeUnder(s0, SHADE.under);
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
  // (front faces and outer edges only: the band is a few centimetres thick, its inner edges hidden by the reveal)
  const T = WIN.types[type], w = T.w / 2, h = T.h / 2, b = 0.13, p = new Parts(), z = GAP, c = '#ffffff';
  const W = w + b, Hh = h + b;
  p.quad([-W, h, z], [W, h, z], [W, Hh, z], [-W, Hh, z], c);             // head
  p.quad([-W, -Hh, z], [W, -Hh, z], [W, -h, z], [-W, -h, z], c);         // foot
  p.quad([-W, -h, z], [-w, -h, z], [-w, h, z], [-W, h, z], c);           // left
  p.quad([w, -h, z], [W, -h, z], [W, h, z], [w, h, z], c);               // right
  p.quad([-W, Hh, z], [W, Hh, z], [W, Hh, -0.02], [-W, Hh, -0.02], c);   // outer edges
  p.quad([-W, -Hh, -0.02], [W, -Hh, -0.02], [W, -Hh, z], [-W, -Hh, z], c);
  p.quad([-W, -Hh, -0.02], [-W, -Hh, z], [-W, Hh, z], [-W, Hh, -0.02], c);
  p.quad([W, -Hh, z], [W, -Hh, -0.02], [W, Hh, -0.02], [W, Hh, z], c);
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

/**
 * A balcony of a variant from data (width w, depth d), origin on the wall face at the
 * middle of the slab's top edge. `slab`: the stone slab, its moulded edge and the consoles
 * under it (vertex-coloured). `rail`: the iron railing (white: tinted by the instance
 * colour), or for a solid one a rendered parapet (tinted with the wall colour).
 */
export function balconyGeometries(w, d, kind) {
  const B = FACADES.balconies, t = B.slab, H = B.railHeight, s = new Parts(), r = new Parts();
  const stone = '#e6dfd2', under = '#cfc7b8';
  s.box(-w / 2, -t, 0, w / 2, 0, d, stone);
  s.box(-w / 2 - 0.03, -t - 0.02, d - 0.05, w / 2 + 0.03, -t + 0.04, d + 0.03, under);   // a moulded front edge
  s.shadeUnder(0, SHADE.under);                                          // baked shade: the slab's underside sees no sky
  const nb = w > 2.2 ? 3 : 2, c0 = s.count;
  for (let k = 0; k < nb; k++) {                                         // consoles under the slab, tapering to the wall
    const x = nb === 2 ? (k ? 1 : -1) * (w / 2 - 0.22) : (k - 1) * (w / 2 - 0.25);
    s.box(x - 0.06, -t - 0.16, 0, x + 0.06, -t, d * 0.75, under);
    s.box(x - 0.06, -t - 0.34, 0, x + 0.06, -t - 0.16, d * 0.35, under);
  }
  s.shadeUnder(c0, SHADE.under, SHADE.console);                          // …and the consoles sit in its shade
  const zf = d - 0.06, white = '#ffffff';
  if (kind === 'solid') {
    r.box(-w / 2, 0, zf - 0.04, w / 2, H * 0.95, zf + 0.04, white);
    r.box(-w / 2, 0, 0.02, -w / 2 + 0.08, H * 0.95, zf, white);
    r.box(w / 2 - 0.08, 0, 0.02, w / 2, H * 0.95, zf, white);
    r.box(-w / 2 - 0.03, H * 0.95, zf - 0.07, w / 2 + 0.03, H * 0.95 + 0.05, zf + 0.06, '#f2efe8');
  } else {
    const bar = 0.022;
    r.box(-w / 2, H - 0.04, zf - 0.025, w / 2, H, zf + 0.025, white);          // hand rail
    r.box(-w / 2, 0.08, zf - 0.015, w / 2, 0.11, zf + 0.015, white);           // bottom rail
    for (const x of [-w / 2, w / 2 - 0.04]) {                                  // side rails and corner posts
      r.box(x, H - 0.04, 0.02, x + 0.04, H, zf, white);
      r.box(x, 0, zf - 0.02, x + 0.04, H, zf + 0.02, white);
    }
    const n = Math.max(2, Math.round(w / B.barSpacing));
    for (let k = 1; k < n; k++) { const x = -w / 2 + (k / n) * w; r.box(x - bar / 2, 0.11, zf - bar / 2, x + bar / 2, H - 0.04, zf + bar / 2, white); }
    const ns = Math.max(2, Math.round(d / B.barSpacing));
    for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) for (let k = 1; k < ns; k++) {
      const z = 0.02 + (k / ns) * (zf - 0.02); r.box(x - bar / 2, 0.11, z - bar / 2, x + bar / 2, H - 0.04, z + bar / 2, white);
    }
  }
  return { slab: s.geometry(), rail: r.geometry() };
}

/** A chair on a balcony or terrace (seat, back, legs), about 0.45 m wide. */
export function chairGeometry() {
  const p = new Parts(), c = '#ffffff';
  p.box(-0.21, 0.42, -0.2, 0.21, 0.46, 0.2, c);
  p.box(-0.21, 0.46, -0.21, 0.21, 0.88, -0.18, c);
  for (const [x, z] of [[-0.19, -0.18], [0.17, -0.18], [-0.19, 0.16], [0.17, 0.16]]) p.box(x, 0, z, x + 0.03, 0.42, z + 0.03, c);
  return p.geometry();
}

/** A shopfront in a recessed opening w × h: frame, glazing bars, a glazed door and a stall riser (vertex-coloured). */
export function shopfrontGeometry(w, h, recess) {
  const p = new Parts(), wood = '#e9e1cf', glass = '#2c3238', riser = '#cfc6b5', z0 = -recess, z1 = -recess + 0.08, b = 0.08;
  p.box(-w / 2, 0, z0, w / 2, 0.55, z1, riser);                                   // the stall riser
  p.box(-w / 2, 0.55, z0 - 0.02, w / 2, h, z0 + 0.01, glass);                      // glazing (behind the bars)
  p.box(-w / 2, h - b, z0, w / 2, h, z1, wood);
  p.box(-w / 2, 0.55, z0, w / 2, 0.55 + b, z1, wood);
  for (const x of [-w / 2, w / 2 - b, -w / 6 - b / 2, w / 6 - b / 2]) p.box(x, 0, z0, x + b, h, z1, wood);
  p.box(-w / 2, h - 0.6, z0, w / 2, h - 0.6 + b * 0.7, z1, wood);                  // transom bar
  p.box(-w / 6, 0, z0 - 0.01, w / 6, 0.55, z1 - 0.01, glass);                     // the door's glazed lower half (it is a door)
  p.box(-w / 2 - 0.15, -0.16, z0, w / 2 + 0.15, 0.0, 0.3, '#e0dcd4');              // stone threshold
  return p.geometry();
}

/** A shop sign board over the opening (white: tinted per shop), with pale lettering strokes. */
export function signGeometry(w) {
  const p = new Parts();
  p.box(-w / 2, 0, GAP - 0.01, w / 2, 0.42, GAP + 0.04, '#ffffff');
  for (let k = 0; k < 5; k++) { const x = -w * 0.3 + k * w * 0.13; p.box(x, 0.12, GAP + 0.04, x + w * 0.08, 0.3, GAP + 0.05, '#f0e9d8'); }
  return p.geometry();
}

/**
 * A round-headed entry w × h (opening cut through the wall as a rectangle): the spandrels
 * that fill its top corners and the arch's curved soffit (tinted with the wall colour),
 * and a ring of stone voussoirs standing just proud of the wall.
 */
export function archGeometries(w, h, recess) {
  const r = w / 2, ys = h - r;
  const sp = new THREE.Shape();
  sp.moveTo(-r, ys); sp.lineTo(-r, h); sp.lineTo(r, h); sp.lineTo(r, ys);
  sp.absarc(0, ys, r, 0, Math.PI, false);
  const spandrel = new THREE.ExtrudeGeometry(sp, { depth: recess, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -recess).toNonIndexed();
  spandrel.computeVertexNormals();
  const ring = new THREE.Shape(), R2 = r + 0.2;
  ring.absarc(0, ys, R2, 0, Math.PI, false); ring.lineTo(-r, ys); ring.absarc(0, ys, r, Math.PI, 0, true); ring.lineTo(R2, ys);
  const voussoirs = new THREE.ExtrudeGeometry(ring, { depth: 0.05, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, GAP - 0.03).toNonIndexed();
  voussoirs.computeVertexNormals();
  return { spandrel, voussoirs };
}

/**
 * An awning: a sloping canopy with a valance along its front, 1 m wide (scaled to the
 * opening) and `depth` deep, hung from the wall at the origin. Striped in the shader.
 */
export function awningGeometry(depth, drop) {
  const p = new Parts(), c = '#ffffff';
  const slope = 0.42, zf = depth, yf = -depth * Math.tan(slope);
  p.quad([-0.5, 0, GAP], [-0.5, yf, zf], [0.5, yf, zf], [0.5, 0, GAP], c);           // canopy, top
  p.quad([-0.5, 0, GAP], [0.5, 0, GAP], [0.5, yf, zf], [-0.5, yf, zf], '#b4b4b4');   // canopy, underside (in its own shade)
  p.quad([-0.5, yf - drop, zf], [0.5, yf - drop, zf], [0.5, yf, zf], [-0.5, yf, zf], c);   // valance
  p.quad([-0.5, yf - drop, zf], [-0.5, yf, zf], [0.5, yf, zf], [0.5, yf - drop, zf], '#d9d9d9');
  for (const x of [-0.5, 0.5]) p.quad([x, 0, GAP], [x, yf, zf], [x, yf - 0.02, zf], [x, -0.02, GAP], '#bdbdbd');   // side arms (thin)
  return p.geometry();
}

/** Awning cloth: stripes of the instance colour and cream across its width (`stripe` metres each). */
export function awningMaterial(stripe) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vAw;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vAw = position;
      #ifdef USE_INSTANCING
        vAw.x *= length(instanceMatrix[0].xyz);           // metres across, so stripes keep their width
      #endif`);
    sh.fragmentShader = 'varying vec3 vAw;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float st = step(0.5, fract(vAw.x / ${(2 * stripe).toFixed(3)} + 0.25));
        diffuseColor.rgb = mix(vec3(0.86, 0.82, 0.72), diffuseColor.rgb, st);
      }`);
  };
  return m;
}

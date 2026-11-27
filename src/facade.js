// ---------------------------------------------------------------------------
// facade.js — shapes for facade parts (v0.13), built from data/facades.json.
//
// Every part is built in a "wall frame": x along the wall, y up, z out of the wall,
// with the origin on the wall's face at the middle of the opening. The house
// generator (buildings.js) cuts the opening through the wall and places these as
// instances (one draw call per kind of part).
//
//   frameGeometry(type)     window frame at the back of the recess, with its glazing bars
//   sillGeometry(type)      the stone sill under the opening
//   leafGeometry(...)       one shutter leaf, 1 m × 1 m (scaled per window), hinged on the
//                           corner of the reveal: near = louvred slats in a frame; far = a
//                           framed board; `shut` = only the face seen when it is closed
//   surroundGeometry(type)  a thin painted band round the opening (trompe-l'oeil)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FACADES } from './data.js';
import { CONFIG } from './config.js';

const WIN = FACADES.windows, SH = FACADES.shutters;
// Baked shade on parts (v0.18): undersides that see no sky, consoles under a slab, the frame at the back of a recess.
const SHADE = CONFIG.building.ao.parts;
const DOOR = FACADES.groundFloors.steps;
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

/** The frame at the back of the recess and its glazing bars, for a window kind (drawn near only). */
export function frameGeometry(type) {
  const T = WIN.types[type], F = WIN.frame, R = WIN.recess;
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
  if (T.transom) p.box(-w / 2 + b, h / 2 - F.transomAt - m / 2, zf - 0.03, w / 2 - b, h / 2 - F.transomAt + m / 2, zf + 0.012, inRecess);
  return p.geometry();
}

/**
 * The stone sill: a slab the full depth of the wall, standing a little proud of it and a
 * little wider than the opening (vertex colour white: tinted per house). Its underside is
 * in its own shade (baked).
 */
export function sillGeometry(type) {
  const T = WIN.types[type], S = WIN.sill, p = new Parts();
  p.box(-T.w / 2 - S.overhang, -T.h / 2 - S.height, -WIN.recess, T.w / 2 + S.overhang, -T.h / 2, S.proud, '#ffffff');
  p.shadeUnder(0, SHADE.under);
  return p.geometry();
}

/** Where the glass sits in the recess (its z), shared by the glass shader. */
export const GLASS_Z = -WIN.recess + WIN.frame.depth * 0.45;

/**
 * One shutter leaf, 1 m wide and 1 m tall (instances scale it to half the opening). It is
 * hinged at x = 0, z = 0: the outer corner of the reveal, on the wall's face. Shut, it lies
 * inside the reveal, its face `inset` behind the wall face (as real persiane close into the
 * opening); swung right round on that hinge it lies flat against the wall, standing the same
 * `inset` clear of it. `right` mirrors it (a leaf hinged on the right).
 *   near: stiles, three rails and tilted louvre slats on both faces; under each slat the
 *         shaded gap is a dark strip, so the slats read from any distance they are drawn at
 *   far:  a framed board: paler stiles and rails round a darker louvred panel
 *   shut: only the face that shows when the leaf is shut (the rest is hidden in the reveal)
 */
export function leafGeometry(right, near, shut = false) {
  const t = SH.thickness, zF = -SH.inset, zB = -SH.inset - t, p = new Parts(), white = '#ffffff';
  const gapCol = '#' + new THREE.Color(1, 1, 1).multiplyScalar(SH.slatShadow).getHexString();     // the shaded gap under a slat
  const panelCol = '#' + new THREE.Color(1, 1, 1).multiplyScalar(SH.farPanel).getHexString();     // slats and gaps averaged, for the far board
  const st = SH.stile, ra = SH.rail;   // in metres, on a ~0.58 × 1.85 leaf: scaled with the leaf, so a touch thinner on small windows
  const sx = st / 0.58, ry = ra / 1.85, mid = -0.07;           // the middle rail sits a little below half height
  // one face of the leaf, looking along +z (front) or -z (back)
  const faceQuad = (x0, y0, x1, y1, z, front, hex) => (front
    ? p.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], hex)
    : p.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], hex));
  const frameFace = (z, front) => {
    faceQuad(0, -0.5, sx, 0.5, z, front, white); faceQuad(1 - sx, -0.5, 1, 0.5, z, front, white);
    faceQuad(sx, 0.5 - ry, 1 - sx, 0.5, z, front, white); faceQuad(sx, -0.5, 1 - sx, -0.5 + ry, z, front, white);
    faceQuad(sx, mid, 1 - sx, mid + ry, z, front, white);
  };
  const edges = () => {
    p.quad([0, -0.5, zB], [0, -0.5, zF], [0, 0.5, zF], [0, 0.5, zB], white);           // hinge edge
    p.quad([1, -0.5, zF], [1, -0.5, zB], [1, 0.5, zB], [1, 0.5, zF], white);           // meeting edge
    p.quad([0, 0.5, zF], [1, 0.5, zF], [1, 0.5, zB], [0, 0.5, zB], white);             // top
    p.quad([0, -0.5, zB], [1, -0.5, zB], [1, -0.5, zF], [0, -0.5, zF], white);         // bottom
  };
  const panels = [[-0.5 + ry, mid], [mid + ry, 0.5 - ry]];
  if (!near) {
    frameFace(zF, true);
    for (const [y0, y1] of panels) faceQuad(sx, y0, 1 - sx, y1, zF, true, panelCol);
    if (!shut) { edges(); faceQuad(0, -0.5, 1, 0.5, zB, false, panelCol); }
  } else {
    frameFace(zF, true);
    if (!shut) { edges(); frameFace(zB, false); }
    // louvre slats: each tilted out at the bottom (they shed rain); the strip under it is the shaded gap
    const n = SH.slats, total = panels[0][1] - panels[0][0] + panels[1][1] - panels[1][0];
    for (const [y0, y1] of panels) {
      const k = Math.max(2, Math.round(n * (y1 - y0) / total)), sH = (y1 - y0) / k, zo = zF - 0.004, zi = zB + 0.004, g = SH.slatGap;
      for (let i = 0; i < k; i++) {
        const yb = y0 + i * sH, ym = yb + sH * g, yt = yb + sH;
        p.quad([sx, ym, zo], [1 - sx, ym, zo], [1 - sx, yt, zo - t * 0.55], [sx, yt, zo - t * 0.55], white);   // the slat, seen from outside
        faceQuad(sx, yb, 1 - sx, ym, zo - t * 0.55, true, gapCol);
        if (shut) continue;
        p.quad([1 - sx, yb, zi + t * 0.55], [sx, yb, zi + t * 0.55], [sx, yt - sH * g, zi], [1 - sx, yt - sH * g, zi], white);   // …and from inside (it shows when the leaf is folded back)
        faceQuad(sx, yt - sH * g, 1 - sx, yt, zi + t * 0.55, false, gapCol);
      }
    }
  }
  if (right) p.mirrorX();
  return p.geometry();
}

/** A thin painted band round the opening (window surrounds on decorated houses). */
export function surroundGeometry(type) {
  // (front faces and outer edges only: the band is a few centimetres thick, its inner edges hidden by the reveal)
  const T = WIN.types[type], w = T.w / 2, h = T.h / 2, b = WIN.surround, p = new Parts(), z = GAP, c = '#ffffff';
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
 * A recessed doorway of width w and height h (origin at the threshold, middle of the
 * opening, on the wall face). `surround` = dressed-stone jambs and lintel standing just
 * proud of the wall, and two stone steps: the threshold, and a wider one below it (it
 * sinks into the ground where the lane is higher). `leaf` = the timber door at the back of
 * the recess: two leaves meeting in the middle. `trim` (drawn near only) = their raised
 * stiles and rails round sunk panels, and a knob. Vertex colour white = tinted per house.
 */
export function doorGeometries(w, h, recess, arched = false) {
  const st = 0.15, s = new Parts(), l = new Parts(), tr = new Parts(), stone = '#ffffff';
  s.box(-w / 2 - st, 0, -0.02, -w / 2, h, 0.06, stone);
  s.box(w / 2, 0, -0.02, w / 2 + st, h, 0.06, stone);
  if (!arched) s.box(-w / 2 - st, h, -0.02, w / 2 + st, h + 0.18, 0.06, '#f4f4f4');
  const s0 = s.count;
  s.box(-w / 2 - 0.1, -DOOR.step, -recess, w / 2 + 0.1, 0.0, 0.34, '#e6e6e6');                          // threshold
  s.box(-w / 2 - 0.3, -2 * DOOR.step, 0.02, w / 2 + 0.3, -DOOR.step, 0.34 + DOOR.tread, '#dcdcdc');     // the step below it
  s.shadeUnder(s0, 1, 0.92);
  // the leaves: a timber slab at the back of the recess, a dark joint where the two meet
  const z = -recess, t = 0.05, H = arched ? h - w / 2 : h;
  l.box(-w / 2, 0, z, w / 2, H, z + t, '#d9d9d9');
  if (arched) l.box(-w / 2, H, z, w / 2, h - 0.04, z + t * 0.5, '#2a2622');   // the dark fanlight
  l.box(-0.01, 0.02, z + t, 0.01, H - 0.02, z + t + 0.004, '#4a4a4a');
  // raised stiles and rails (the panels are the slab showing between them), and a knob
  const zt = z + t, zp = zt + 0.022, sw = 0.085;
  for (const [x0, x1] of [[-w / 2, -0.012], [0.012, w / 2]]) {
    tr.box(x0, 0, zt, x0 + sw, H, zp, '#ffffff'); tr.box(x1 - sw, 0, zt, x1, H, zp, '#ffffff');
    for (const [y0, y1] of [[0, 0.18], [H * 0.44, H * 0.44 + 0.11], [H - 0.11, H]]) tr.box(x0 + sw, y0, zt, x1 - sw, y1, zp, '#ffffff');
  }
  tr.box(0.05, H * 0.47, zp, 0.1, H * 0.47 + 0.05, zp + 0.04, '#b9a468');
  return { surround: s.geometry(), leaf: l.geometry(), trim: tr.geometry() };
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

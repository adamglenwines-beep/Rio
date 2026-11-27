// ---------------------------------------------------------------------------
// terraces.js — vine terraces held up by dry-stone walls, on any slope.
//
// The hillside starts wild. A terrace AREA (a circle for now) can be laid on
// any slope: inside it the ground is re-cut into level treads a wall-height
// apart, each held by a dry-stone wall that follows the contour of the
// natural ground. Areas fade out at their edges, stop at cliffs and the
// shore, and leave lanes and zoned land alone.
//
//   terraces.addArea({ x, z, r, crop })   crop: 'vine' | 'olive' | 'bare'
//   terraces.clear()
//   terraces.rebuild(game)                re-cut the ground, rebuild walls
//   terraces.refresh(growth, infill)      hide walls/vines under new houses
//
// How it works:
//  * a mask (0…1) per fine-grid vertex says how terraced the ground is;
//  * terraced height = the natural height snapped to treads (cut and fill:
//    the outer edge of each tread is filled up to the wall top, the inner
//    edge is cut into the hill);
//  * walls are contour lines of the NATURAL ground at each tread level
//    (marching squares on the fine grid), chained into long polylines and
//    smoothed, then built as one mesh: a battered stone face, a ragged top,
//    and a strip of soil behind it covering the step in the ground mesh;
//  * vines are rows on the tread above each wall: a low leafy band (the local
//    low pergola) on weathered chestnut stakes.
// Gameplay hooks for later: areas are plain data, so a "Vines" paint tool or
// a farm building can add them; `areaAt(x, z)` tells what grows where.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { registerStyled } from './style.js';
import { LAYERS } from './materials.js';
import { makeRng, clamp, lerp, smoothstep } from './noise.js';

const hash2 = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export class Terraces {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'terraces';
    this.areas = [];
    this.version = 0;
    this.walls = [];        // polylines: [{ pts: [{x, z, gx, gz, yTop, yBot, level, area}], … }]
    this.wallPoints = [];   // sample points along wall tops (for plants spilling over)
    this.wallMat = registerStyled(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 'ground', { mode: 'face', layer: 'attr' });
    this.vineMat = registerStyled(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), 'foliage');
    this.stakeMat = new THREE.MeshStandardMaterial({ color: '#a39d90', roughness: 0.95 });
    this.wallMesh = null; this.vineMesh = null; this.stakes = null;
    const FV = terrain.FV;
    this.mask = new Float32Array(FV * FV);
    this.areaId = new Int16Array(FV * FV).fill(-1);
    this._dirtyRect = null;
  }

  addArea(a) { this.areas.push({ crop: 'vine', ...a }); }
  clear() { this.areas.length = 0; }

  /** The terrace area covering (x, z), or null. */
  areaAt(x, z) {
    const t = this.terrain;
    const i = Math.round((x + t.half) / t.fcell), j = Math.round((z + t.half) / t.fcell);
    if (i < 0 || j < 0 || i >= t.FV || j >= t.FV) return null;
    const k = j * t.FV + i;
    return this.mask[k] > 0.5 && this.areaId[k] >= 0 ? this.areas[this.areaId[k]] : null;
  }
  maskAt(x, z) { return this.terrain._sample(this.mask, x, z); }

  // ---- the ground -------------------------------------------------------------

  /** Re-cut the ground for the current areas and rebuild walls and vines. */
  rebuild(game) {
    const t = this.terrain, T = CONFIG.terraces, { FV, fcell, half, hBase, hf } = t;
    // put back any ground we cut before
    const prev = this._dirtyRect;
    if (prev) for (let j = prev.j0; j <= prev.j1; j++) for (let i = prev.i0; i <= prev.i1; i++) hf[j * FV + i] = hBase[j * FV + i];
    this.mask.fill(0); this.areaId.fill(-1);
    let i0 = FV, j0 = FV, i1 = -1, j1 = -1;
    const H = (i, j) => hBase[clamp(j, 0, FV - 1) * FV + clamp(i, 0, FV - 1)];
    const blocked = (x, z) => {
      if (!game) return false;
      if (game.zones && game.zones.grid[t.cellIndex(x, z)] > 0) return true;
      if (game.growth && game.growth.occAt(x, z) !== -1) return true;
      return false;
    };
    this.areas.forEach((A, ai) => {
      const a0 = Math.max(0, Math.floor((A.x - A.r + half) / fcell)), a1 = Math.min(FV - 1, Math.ceil((A.x + A.r + half) / fcell));
      const b0 = Math.max(0, Math.floor((A.z - A.r + half) / fcell)), b1 = Math.min(FV - 1, Math.ceil((A.z + A.r + half) / fcell));
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const x = i * fcell - half, z = j * fcell - half;
        const d = Math.hypot(x - A.x, z - A.z);
        // a wobbly edge, so areas are not perfect circles
        const edge = A.r * (0.86 + 0.14 * t.noise.fbm(x * 0.06 + ai * 7, z * 0.06, 2));
        let m = 1 - smoothstep(edge - T.edgeFade, edge, d);
        if (m <= 0) continue;
        const gx = (H(i + 2, j) - H(i - 2, j)) / (4 * fcell), gz = (H(i, j + 2) - H(i, j - 2)) / (4 * fcell);
        const deg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
        m *= 1 - smoothstep(T.maxSlope - 5, T.maxSlope, deg);      // not on cliffs
        m *= smoothstep(T.minSlope - 4, T.minSlope, deg) * 0.7 + 0.3;   // barely needed on flat ground
        m *= smoothstep(2.5, 5, hBase[j * FV + i]);                // not on the shore
        const k = j * FV + i;
        if (m > this.mask[k]) { this.mask[k] = m; this.areaId[k] = ai; }
      }
      i0 = Math.min(i0, a0); j0 = Math.min(j0, b0); i1 = Math.max(i1, a1); j1 = Math.max(j1, b1);
    });
    // keep clear of lanes, houses and zoned land (with a soft margin)
    if (i1 >= 0 && game) {
      const R = Math.ceil(T.townMargin / fcell);
      const hit = new Uint8Array(FV * FV);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (this.mask[j * FV + i] > 0 && blocked(i * fcell - half, j * fcell - half)) hit[j * FV + i] = 1;
      }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * FV + i;
        if (this.mask[k] <= 0) continue;
        let best = R + 1;
        for (let b = -R; b <= R && best > 0; b++) for (let a = -R; a <= R; a++) {
          const ii = i + a, jj = j + b;
          if (ii < 0 || jj < 0 || ii >= FV || jj >= FV || !hit[jj * FV + ii]) continue;
          best = Math.min(best, Math.hypot(a, b));
        }
        this.mask[k] *= smoothstep(R * 0.35, R, best);
      }
    }
    // cut the treads
    const cover = Float32Array.from(t.coverBase), soil = new Float32Array(FV * FV);
    if (i1 >= 0) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * FV + i, m = this.mask[k];
      if (m <= 0) continue;
      const A = this.areas[this.areaId[k]];
      hf[k] = lerp(hBase[k], this._treadHeight(hBase[k], A), m);
      soil[k] = smoothstep(0.25, 0.7, m) * (A.crop === 'bare' ? 0.45 : 0.85);
      cover[k] *= 1 - smoothstep(0.1, 0.6, m);
    }
    const rect = { i0: Math.min(i0, prev ? prev.i0 : i0), j0: Math.min(j0, prev ? prev.j0 : j0), i1: Math.max(i1, prev ? prev.i1 : i1), j1: Math.max(j1, prev ? prev.j1 : j1) };
    this._dirtyRect = i1 >= 0 ? { i0, j0, i1, j1 } : null;
    if (rect.i1 >= 0) t.updateRegion(rect.i0, rect.j0, rect.i1, rect.j1, { cover, soil });
    t.cover = cover;
    this._traceWalls();
    this.refresh(game && game.growth, game && game.infill);
  }

  /** Height of the terraced ground where the natural ground is `hb`. */
  _treadHeight(hb, A) {
    const T = CONFIG.terraces, Hs = A.step || T.step, off = A.offset || 0;
    const q = (hb - off) / Hs, k = Math.floor(q), frac = q - k;
    return off + k * Hs + Hs * (0.5 * (1 - T.treadSlope) + T.treadSlope * frac);
  }

  // ---- walls: contours of the natural ground ----------------------------------------

  _traceWalls() {
    const t = this.terrain, T = CONFIG.terraces, { FV, FN, fcell, half, hBase } = t;
    this.walls = []; this.wallPoints = [];
    const R = this._dirtyRect;
    if (!R) return;
    const lines = [];
    this.areas.forEach((A, ai) => {
      const Hs = A.step || T.step, off = A.offset || 0;
      // marching squares per level, restricted to this area's cells
      const segsByLevel = new Map();
      for (let j = Math.max(0, R.j0); j < Math.min(FN, R.j1); j++) for (let i = Math.max(0, R.i0); i < Math.min(FN, R.i1); i++) {
        const k = j * FV + i;
        if (this.areaId[k] !== ai || Math.max(this.mask[k], this.mask[k + 1], this.mask[k + FV], this.mask[k + FV + 1]) < T.wallMinMask) continue;
        const h = [hBase[k], hBase[k + 1], hBase[k + FV + 1], hBase[k + FV]];
        const lo = Math.min(...h), hi = Math.max(...h);
        const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        for (let lv = Math.ceil((lo - off) / Hs); off + lv * Hs < hi; lv++) {
          const L = off + lv * Hs;
          const pts = [];
          for (let e = 0; e < 4; e++) {
            const a = h[e], b = h[(e + 1) % 4];
            if ((a < L) !== (b < L)) {
              const f = (L - a) / (b - a);
              const [ai2, aj] = corners[e], [bi, bj] = corners[(e + 1) % 4];
              // a key for the grid edge this point sits on, so neighbouring cells share it exactly
              const key = (Math.min(aj, bj) * FV + Math.min(ai2, bi)) * 2 + (aj === bj ? 0 : 1);
              pts.push({ x: (ai2 + (bi - ai2) * f) * fcell - half, z: (aj + (bj - aj) * f) * fcell - half, key });
            }
          }
          if (pts.length < 2) continue;
          if (!segsByLevel.has(lv)) segsByLevel.set(lv, []);
          segsByLevel.get(lv).push([pts[0], pts[1]]);
          if (pts.length === 4) segsByLevel.get(lv).push([pts[2], pts[3]]);
        }
      }
      for (const [lv, segs] of segsByLevel) for (const chain of chainSegments(segs)) lines.push({ area: ai, level: off + lv * Hs, pts: chain });
    });
    const rngJ = (x, z) => hash2(Math.round(x * 3.1), Math.round(z * 3.1));
    for (const L of lines) {
      if (L.pts.length < 4) continue;
      let pts = smoothLine(L.pts, 3);
      pts = resample(pts, T.wallSegment);
      if (pts.length < 3) continue;
      // per point: uphill direction of the natural ground, wall top and bottom from the cut ground
      let run = [];
      const flush = () => {
        if (run.length >= 6) {
          // walk every wall the same way round (downhill on the right), so faces point outwards
          const a = run[0], b = run[1];
          if ((b.z - a.z) * a.gx - (b.x - a.x) * a.gz < 0) run.reverse();
          this.walls.push({ area: L.area, level: L.level, pts: run });
        }
        run = [];
      };
      for (const p of pts) {
        const e = 2.0;
        let gx = t.baseHeightAt(p.x + e, p.z) - t.baseHeightAt(p.x - e, p.z), gz = t.baseHeightAt(p.x, p.z + e) - t.baseHeightAt(p.x, p.z - e);
        const gl = Math.hypot(gx, gz);
        if (gl < 1e-4) { flush(); continue; }
        gx /= gl; gz /= gl;
        const yUp = t.heightAt(p.x + gx * 1.7, p.z + gz * 1.7);
        const yDn = t.heightAt(p.x - gx * (T.faceOffset + 1.5), p.z - gz * (T.faceOffset + 1.5));
        const yTop = yUp + T.wallProud + (rngJ(p.x, p.z) - 0.5) * T.topJitter;
        const yBot = yDn - 0.3;
        if (yTop - yDn < T.minWall) { flush(); continue; }
        run.push({ x: p.x, z: p.z, gx, gz, yTop, yBot, yUp });
      }
      flush();
    }
    // sample points along the wall tops, for plants that spill over them
    for (const W of this.walls) {
      for (let i = 2; i < W.pts.length - 2; i += 3) {
        const p = W.pts[i];
        this.wallPoints.push({ x: p.x - p.gx * CONFIG.terraces.faceOffset, z: p.z - p.gz * CONFIG.terraces.faceOffset, y: p.yTop, nx: -p.gx, nz: -p.gz, h: p.yTop - p.yBot - 0.3 });
      }
    }
  }

  // ---- meshes -------------------------------------------------------------------

  /** Rebuild the wall, vine and stake meshes, leaving out anything under a house, a lane or infill. */
  refresh(growth, infill) {
    const t = this.terrain, T = CONFIG.terraces;
    const free = (x, z) => (!growth || growth.occAt(x, z) === -1) && !(infill && infill.claimedAt(x, z));
    const pos = [], col = [], ao = [];
    const vpos = [], vcol = [];
    const stakes = [];
    const stoneLayer = (LAYERS.stoneDry ?? 0) + 1, soilLayer = (LAYERS.soil ?? 0) + 1;
    const cStone = new THREE.Color(T.stoneColour), cSoil = new THREE.Color(T.soilColour), c = new THREE.Color();
    // a quad A-B-C-D as two triangles (A, B, C) and (A, C, D)
    const quad = (arr, A, B, C, D) => { arr.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], A[0], A[1], A[2], C[0], C[1], C[2], D[0], D[1], D[2]); };
    const push = (A, B, C, D, colr, layer, rnd) => {
      quad(pos, A, B, C, D);
      for (let k = 0; k < 6; k++) { col.push(colr.r, colr.g, colr.b); ao.push(0, 0, layer + rnd * 0.9); }
    };
    for (const W of this.walls) {
      const A = this.areas[W.area], P = W.pts;
      const rnd = hash2(P[0].x, P[0].z);
      for (let i = 0; i + 1 < P.length; i++) {
        const p = P[i], q = P[i + 1];
        if (!free(p.x - p.gx * 0.6, p.z - p.gz * 0.6) || !free(q.x - q.gx * 0.6, q.z - q.gz * 0.6)) continue;
        const pts = [p, q].map((s) => {
          const hW = s.yTop - s.yBot, fo = T.faceOffset;
          return {
            b: [s.x - s.gx * (fo + T.batter * hW), s.yBot, s.z - s.gz * (fo + T.batter * hW)],   // foot of the face
            f: [s.x - s.gx * fo, s.yTop, s.z - s.gz * fo],                                       // top front edge
            k: [s.x - s.gx * (fo - T.thickness), s.yTop - 0.04, s.z - s.gz * (fo - T.thickness)], // top back edge
            s: [s.x + s.gx * T.soilStrip, s.yUp + 0.05, s.z + s.gz * T.soilStrip],                // soil strip back edge
          };
        });
        const shade = 0.86 + 0.26 * hash2(Math.floor(i / 3) + p.x, p.z);
        c.copy(cStone).multiplyScalar(shade);
        push(pts[0].b, pts[1].b, pts[1].f, pts[0].f, c, stoneLayer, rnd);     // battered face
        push(pts[0].f, pts[1].f, pts[1].k, pts[0].k, c.multiplyScalar(1.06), stoneLayer, rnd);     // ragged top
        c.copy(cSoil).multiplyScalar(0.92 + 0.14 * hash2(p.z, p.x));
        push(pts[0].k, pts[1].k, pts[1].s, pts[0].s, c, soilLayer, rnd);      // soil behind the wall
      }
      // vines: rows on the tread above this wall
      if (A.crop !== 'vine') continue;
      for (let row = 0; row < T.vineRows.length; row++) {
        const off = T.vineRows[row];
        let prev = null;
        for (let i = 0; i < P.length; i++) {
          const p = P[i];
          const x = p.x + p.gx * off, z = p.z + p.gz * off;
          const ok = this.maskAt(x, z) > 0.55 && free(x, z) && t.baseHeightAt(x, z) < W.level + (A.step || T.step) - 0.35 && Math.abs(t.heightAt(x, z) - p.yUp) < 0.6;
          if (!ok) { prev = null; continue; }
          const y = t.heightAt(x, z);
          const bump = hash2(x * 1.7, z * 1.3), bump2 = hash2(z * 2.1, x * 0.7);
          const hgt = T.vineHeight * (0.82 + 0.36 * bump), wid = T.vineWidth * (0.8 + 0.4 * bump2);
          const cur = {
            a: [x - p.gx * wid, y + hgt * 0.45, z - p.gz * wid], b: [x - p.gx * wid * 0.55, y + hgt, z - p.gz * wid * 0.55],
            c: [x + p.gx * wid * 0.55, y + hgt * 0.96, z + p.gz * wid * 0.55], d: [x + p.gx * wid, y + hgt * 0.5, z + p.gz * wid],
            shade: 0.8 + 0.4 * bump,
          };
          if (prev) {
            const leaf = c.set(T.vineColours[(hash2(x, z + row) * T.vineColours.length) | 0]);
            for (const [u, v, k] of [['a', 'b', 0.82], ['b', 'c', 1.12], ['c', 'd', 0.9]]) {
              quad(vpos, prev[u], cur[u], cur[v], prev[v]);
              const s0 = prev.shade * k, s1 = cur.shade * k;
              for (const s of [s0, s1, s1, s0, s1, s0]) vcol.push(leaf.r * s, leaf.g * s, leaf.b * s);
            }
            if (i % T.stakeEvery === 0) stakes.push([x, y, z, hgt, hash2(x, z) * 6.28]);
          }
          prev = cur;
        }
      }
    }
    this._setMesh('wallMesh', this.wallMat, pos, col, ao, true);
    this._setMesh('vineMesh', this.vineMat, vpos, vcol, null, true);
    // stakes: thin weathered chestnut posts
    if (this.stakes) { this.group.remove(this.stakes); this.stakes.dispose(); this.stakes = null; }
    if (stakes.length) {
      const g = new THREE.BoxGeometry(0.07, 1, 0.07).translate(0, 0.5, 0);
      const m = new THREE.InstancedMesh(g, this.stakeMat, stakes.length);
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
      stakes.forEach((k, i) => {
        e.set((hash2(k[0], k[2]) - 0.5) * 0.16, k[4], (hash2(k[2], k[0]) - 0.5) * 0.16);
        m.setMatrixAt(i, M.compose(v.set(k[0], k[1] - 0.1, k[2]), q.setFromEuler(e), s.set(1, k[3] + 0.25, 1)));
      });
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      this.stakes = m; this.group.add(m);
    }
    this.version++;
  }

  _setMesh(name, mat, pos, col, ao, shadow) {
    if (this[name]) { this.group.remove(this[name]); this[name].geometry.dispose(); this[name] = null; }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (ao) g.setAttribute('aoParams', new THREE.Float32BufferAttribute(ao, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    this[name] = m; this.group.add(m);
  }
}

// ---- polyline helpers (exported for the unit tests) -----------------------------------

/** Join loose segments [[p, q], …] (points carry a `key` for the grid edge they sit on) into polylines. */
export function chainSegments(segs) {
  const byKey = new Map();
  segs.forEach((s, i) => { for (const e of [0, 1]) { const k = s[e].key; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push([i, e]); } });
  const used = new Uint8Array(segs.length), out = [];
  const walk = (i, e) => {
    // follow from segment i out through its end `e`
    const pts = [];
    for (;;) {
      used[i] = 1;
      const p = segs[i][e];
      pts.push(p);
      const next = (byKey.get(p.key) || []).find(([j]) => !used[j]);
      if (!next) break;
      i = next[0]; e = 1 - next[1];
    }
    return pts;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const fwd = walk(i, 1);            // … from its start point onward
    used[i] = 0;
    const back = walk(i, 0);           // … and the other way
    out.push([...back.reverse(), ...fwd]);
  }
  return out;
}

/** A few passes of neighbour averaging (end points stay put): takes the grid zig-zag out of a line. */
export function smoothLine(pts, passes = 2) {
  let cur = pts.map((p) => ({ x: p.x, z: p.z }));
  for (let k = 0; k < passes; k++) {
    const nx = cur.map((p, i) => (i === 0 || i === cur.length - 1) ? p : { x: (cur[i - 1].x + 2 * p.x + cur[i + 1].x) / 4, z: (cur[i - 1].z + 2 * p.z + cur[i + 1].z) / 4 });
    cur = nx;
  }
  return cur;
}

/** Points every `step` metres along a polyline. */
export function resample(pts, step) {
  const out = [pts[0]];
  let need = step;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i];
    let d = Math.hypot(b.x - a.x, b.z - a.z);
    while (d >= need) {
      const f = need / d;
      a = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
      out.push(a);
      d -= need; need = step;
    }
    need -= d;
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > step * 0.4) out.push({ x: last.x, z: last.z });
  return out;
}

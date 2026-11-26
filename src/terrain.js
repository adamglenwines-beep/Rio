// ---------------------------------------------------------------------------
// terrain.js — the procedurally generated cove.
//
//  * A heightfield on a regular 2 m grid (vertices), rendered as flat-shaded
//    triangles for the low-poly look.
//  * Shape: a ravine running inland (towards -z) with a flat harbour at its
//    mouth, flanks that get steeper the further you climb, a band of cliffs
//    near the top, and two headlands that drop as cliffs into the sea (+z).
//  * Every 2 m cell is classified into a slope band (flat / moderate / steep /
//    cliff / sea). The same cells are what you paint zones onto.
//  * A heavily smoothed copy of the heightfield gives a calm "downhill
//    direction" field which buildings use to face the sea/ravine in rows.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeNoise2D, makeRng, clamp, lerp, smoothstep } from './noise.js';

export const BAND = { FLAT: 0, MODERATE: 1, STEEP: 2, CLIFF: 3, SEA: 4 };
export const BAND_NAMES = ['flat', 'moderate', 'steep', 'cliff', 'sea'];

export class Terrain {
  constructor(seed = CONFIG.seed) {
    const T = CONFIG.terrain;
    this.seed = seed;
    this.size = T.size;
    this.cell = T.cell;
    this.half = T.size / 2;
    this.N = Math.round(T.size / T.cell); // cells per side
    this.V = this.N + 1;                   // vertices per side
    this.noise = makeNoise2D(seed);

    this._buildFlankProfile();
    this._generateHeights();
    this._classifyCells();
    this._buildDownhillField();
    this.mesh = this._buildMesh();
  }

  // ---- Shape functions ------------------------------------------------------

  /** z of the coastline at a given x: headlands push seaward at the sides. */
  coastZ(x) {
    const ax = Math.abs(x);
    return 6 + 36 * smoothstep(16, 78, ax) + 8 * this.noise.fbm(x * 0.03, 3.1, 3);
  }

  /** x of the ravine centre line at a given z (it meanders a little). */
  ravineX(z) {
    return 5 * Math.sin(z * 0.022 + 1.0) + 5 * this.noise.fbm(z * 0.02, 7.7, 2);
  }

  /**
   * The cross-section of a flank. We integrate a slope function so we can
   * design the profile by slope: gentle at the bottom, steepening, a cliff
   * band, then easing off onto the hilltops (where terraced vineyards sit).
   */
  _buildFlankProfile() {
    const ds = 0.25, max = 200;
    this._flankLUT = new Float32Array(Math.ceil(max / ds) + 2);
    let h = 0;
    for (let i = 0; i < this._flankLUT.length; i++) {
      const s = i * ds;
      this._flankLUT[i] = h;
      const R = CONFIG.terrain.ravine;
      // leave the floor quickly, then steepen steadily up the buildable flank
      let slope = lerp(R.flankSlopeBottom, R.flankSlopeTop, Math.min(s / R.flankRun, 1));
      slope *= 0.35 + 0.65 * smoothstep(0, 2.5, s);
      const c0 = R.cliffStart;
      slope += 0.65 * smoothstep(c0, c0 + 5, s) * (1 - smoothstep(c0 + 10, c0 + 16, s)); // cliff band
      slope = lerp(slope, 0.3, smoothstep(c0 + 12, c0 + 32, s));                      // hilltops
      h += slope * ds;
    }
    this._flankDs = ds;
  }

  flank(s) {
    const f = s / this._flankDs;
    const i = Math.min(Math.floor(f), this._flankLUT.length - 2);
    const t = f - i;
    return lerp(this._flankLUT[i], this._flankLUT[i + 1], t);
  }

  /** The raw procedural height at any (x, z). */
  heightFn(x, z) {
    const { fbm } = this.noise;
    const coast = this.coastZ(x);
    const d = coast - z;                      // distance inland from the coast
    const xc = this.ravineX(z);
    const ax = Math.abs(x - xc);

    // Ravine floor: flat harbour for the first ~12 m, then rising inland.
    const R = CONFIG.terrain.ravine;
    const di = Math.max(d - 12, 0);
    const floor = 1.3 + R.floorRise * di + R.floorRiseCurve * di * di;
    // Half-width of the ravine floor: a narrow gully, wider at the harbour mouth.
    const mouth = 1 - smoothstep(R.harbourLength * 0.5, R.harbourLength, d);
    const fw = lerp(R.floorHalfWidth, R.harbourHalfWidth, mouth) + 0.01 * Math.max(d, 0) + 1.2 * fbm(z * 0.05, 1.3, 2);
    const s = Math.max(ax - fw, 0);
    // The flanks are a bit lower right at the coast so the headland cliffs
    // are tall but not absurd.
    const flankScale = 0.72 + 0.28 * smoothstep(0, 40, d);
    let h = floor + this.flank(s) * flankScale;

    // Irregularity: broad lumps on the flanks + fine bumps everywhere except
    // the harbour floor.
    const onFlank = smoothstep(0, 14, s);
    h += R.lumpiness * fbm(x * 0.017 + 11, z * 0.017 - 5, 4) * onFlank;
    h += R.bumpiness * fbm(x * 0.09, z * 0.09, 2) * smoothstep(8, 22, d + s);

    // Into the sea: blend down to the sea floor over a few metres. Where the
    // land is high this produces a sheer cliff, at the harbour a gentle shore.
    const sea = -1.6 - 0.45 * Math.max(-d, 0) + 1.5 * fbm(x * 0.06, z * 0.06, 2);
    const t = smoothstep(-5, 0.5, d);
    h = lerp(Math.max(sea, CONFIG.terrain.seaFloor), h, t);
    return h;
  }

  _generateHeights() {
    const { V, cell, half } = this;
    this.h = new Float32Array(V * V);
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        this.h[j * V + i] = this.heightFn(i * cell - half, j * cell - half);
      }
    }
    // The harbour: the point on the ravine floor just inland of the water.
    let hz = 0, hx = 0;
    for (let k = 0; k < 4; k++) { hx = this.ravineX(hz); hz = this.coastZ(hx) - 6; }
    this.harbour = new THREE.Vector3(hx, this.heightAt(hx, hz), hz);
  }

  // ---- Queries --------------------------------------------------------------

  /** World → fractional vertex-grid coordinates. */
  toGrid(x, z) { return [(x + this.half) / this.cell, (z + this.half) / this.cell]; }
  /** Cell index (or -1 if outside) for a world position. */
  cellIndex(x, z) {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return -1;
    return j * this.N + i;
  }
  cellCentre(idx) {
    const i = idx % this.N, j = (idx / this.N) | 0;
    return [(i + 0.5) * this.cell - this.half, (j + 0.5) * this.cell - this.half];
  }
  inside(x, z, margin = 0) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  /**
   * Exact height of the rendered surface (same triangle split as the mesh),
   * so steps and houses sit precisely on the ground.
   */
  heightAt(x, z) {
    const { V, N } = this;
    let [gx, gz] = this.toGrid(x, z);
    gx = clamp(gx, 0, N - 1e-4); gz = clamp(gz, 0, N - 1e-4);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const a = this.h[j * V + i], b = this.h[j * V + i + 1];
    const c = this.h[(j + 1) * V + i], d = this.h[(j + 1) * V + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Ground height, but never below the sea surface. */
  surfaceAt(x, z) { return Math.max(this.heightAt(x, z), 0); }

  bandAt(x, z) {
    const idx = this.cellIndex(x, z);
    return idx < 0 ? BAND.SEA : this.band[idx];
  }

  /** Smoothed downhill direction (unit {x, z}) used to orient buildings. */
  downhillAt(x, z) {
    const { V, N } = this;
    let [gx, gz] = this.toGrid(x, z);
    gx = clamp(gx, 0, N - 1e-4); gz = clamp(gz, 0, N - 1e-4);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const k = (a, b) => (b * V + a) * 2;
    let dx = 0, dz = 0;
    const w = [[i, j, (1 - fx) * (1 - fz)], [i + 1, j, fx * (1 - fz)],
               [i, j + 1, (1 - fx) * fz], [i + 1, j + 1, fx * fz]];
    for (const [a, b, wt] of w) { dx += this.dir[k(a, b)] * wt; dz += this.dir[k(a, b) + 1] * wt; }
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /** Ray-march a ray against the terrain and the sea surface. */
  raycast(origin, dir, maxDist = 900) {
    let prevT = 0, step = 1.0;
    for (let t = 0; t < maxDist; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < -1) return null; // went below the sea surface without a hit
      if (this.inside(x, z) && y <= this.surfaceAt(x, z)) {
        // binary refine between prevT and t
        let lo = prevT, hi = t;
        for (let k = 0; k < 12; k++) {
          const m = (lo + hi) / 2;
          const mx = origin.x + dir.x * m, my = origin.y + dir.y * m, mz = origin.z + dir.z * m;
          if (my <= this.surfaceAt(mx, mz)) hi = m; else lo = m;
        }
        const p = new THREE.Vector3(origin.x + dir.x * hi, 0, origin.z + dir.z * hi);
        p.y = this.surfaceAt(p.x, p.z);
        return { point: p, water: this.heightAt(p.x, p.z) < 0 };
      }
      prevT = t;
      step = t < 100 ? 0.5 : 1.0;
    }
    return null;
  }

  // ---- Classification -------------------------------------------------------

  _classifyCells() {
    const { N, V, cell } = this;
    const S = CONFIG.slope;
    this.slopeDeg = new Float32Array(N * N);
    this.band = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = this.h[j * V + i], b = this.h[j * V + i + 1];
        const c = this.h[(j + 1) * V + i], d = this.h[(j + 1) * V + i + 1];
        const gx = ((b - a) + (d - c)) / (2 * cell);
        const gz = ((c - a) + (d - b)) / (2 * cell);
        // also consider the worst edge so tiny cliffs are not missed
        const worst = Math.max(Math.abs(b - a), Math.abs(d - c), Math.abs(c - a), Math.abs(d - b)) / cell;
        const g = Math.max(Math.hypot(gx, gz), worst * 0.75);
        const deg = Math.atan(g) * 180 / Math.PI;
        const idx = j * N + i;
        this.slopeDeg[idx] = deg;
        const minH = Math.min(a, b, c, d);
        let band;
        if (minH < 0.4) band = BAND.SEA;
        else if (deg < S.flatMax) band = BAND.FLAT;
        else if (deg < S.moderateMax) band = BAND.MODERATE;
        else if (deg < S.steepMax) band = BAND.STEEP;
        else band = BAND.CLIFF;
        this.band[idx] = band;
      }
    }
  }

  _buildDownhillField() {
    const { V, cell } = this;
    // Box-blur the heights a few times (≈ gaussian, σ ≈ 11 m).
    let src = Float32Array.from(this.h), dst = new Float32Array(V * V);
    const r = 5;
    for (let pass = 0; pass < 3; pass++) {
      for (const horizontal of [true, false]) {
        for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
          let s = 0, n = 0;
          for (let k = -r; k <= r; k++) {
            const ii = horizontal ? clamp(i + k, 0, V - 1) : i;
            const jj = horizontal ? j : clamp(j + k, 0, V - 1);
            s += Math.max(src[jj * V + ii], 0); n++;
          }
          dst[j * V + i] = s / n;
        }
        [src, dst] = [dst, src];
      }
    }
    this.hSmooth = src;
    // Downhill direction; where the ground is flat, face the sea (+z).
    this.dir = new Float32Array(V * V * 2);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const hl = src[j * V + clamp(i - 1, 0, V - 1)], hr = src[j * V + clamp(i + 1, 0, V - 1)];
      const hu = src[clamp(j - 1, 0, V - 1) * V + i], hd = src[clamp(j + 1, 0, V - 1) * V + i];
      let gx = -(hr - hl) / (2 * cell), gz = -(hd - hu) / (2 * cell);
      const g = Math.hypot(gx, gz);
      const k = smoothstep(0.03, 0.14, g);
      gx = lerp(0, gx / (g || 1), k); gz = lerp(1, gz / (g || 1), k);
      const len = Math.hypot(gx, gz) || 1;
      this.dir[(j * V + i) * 2] = gx / len;
      this.dir[(j * V + i) * 2 + 1] = gz / len;
    }
  }

  // ---- Mesh -------------------------------------------------------------------

  _buildMesh() {
    const { N, V, cell, half } = this;
    const rng = makeRng(this.seed * 31 + 5);
    const pos = new Float32Array(N * N * 6 * 3);
    const col = new Float32Array(N * N * 6 * 3);
    const uv = new Float32Array(N * N * 6 * 2);
    const C = (hex) => new THREE.Color(hex);
    const pal = {
      seabed: C('#b9a983'), sand: C('#d3c29a'),
      grass: [C('#87a04f'), C('#7a9646'), C('#93aa58'), C('#6f8c40')],
      scrub: [C('#6b8240'), C('#5f7a3c'), C('#7b8a4a')],
      rock: [C('#a9937a'), C('#97836d'), C('#b29d80'), C('#8b7a67'), C('#a08c72')],
      deep: C('#2a6f8a'),
    };
    const tmp = new THREE.Color();
    const v3 = (i, j) => [i * cell - half, this.h[j * V + i], j * cell - half];
    let p = 0, q = 0, u = 0;

    const emitTri = (A, B, Cc, ai, aj, bi, bj, ci, cj) => {
      // face normal → slope of this triangle
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      const vx = Cc[0] - A[0], vy = Cc[1] - A[1], vz = Cc[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const slope = Math.acos(Math.abs(ny) / nl) * 180 / Math.PI;
      const cy = (A[1] + B[1] + Cc[1]) / 3;
      const cx = (A[0] + B[0] + Cc[0]) / 3, cz = (A[2] + B[2] + Cc[2]) / 3;
      const n = this.noise.noise(cx * 0.12, cz * 0.12);

      if (cy < -0.3) {
        tmp.copy(pal.seabed).lerp(pal.deep, clamp(-cy / 12, 0, 0.85));
      } else if (cy < 1.9 && slope < 14) {
        tmp.copy(pal.sand);
      } else if (slope > 38) {
        // stratified rock: colour bands by height, warped by noise (sampled at
        // the cell centre so both triangles of a cell match — no zig-zags)
        const ccx = (Math.floor((cx + half) / cell) + 0.5) * cell - half;
        const ccz = (Math.floor((cz + half) / cell) + 0.5) * cell - half;
        const strata = Math.floor(cy / 3.0 + this.noise.noise(ccx * 0.04, ccz * 0.04) * 1.2);
        tmp.copy(pal.rock[((strata % 5) + 5) % 5]);
        // tufts of green clinging to the rock
        if (this.noise.fbm(ccx * 0.08, ccz * 0.08 + 9, 2) > 0.28) tmp.lerp(pal.scrub[1], 0.6);
      } else if (slope > 27) {
        // scrubby slopes with patches of bare rock (noise-driven, not per-triangle)
        const veg = this.noise.fbm(cx * 0.05 + 3, cz * 0.05, 3);
        tmp.copy(veg > -0.05 ? pal.scrub[(rng() * 3) | 0] : pal.rock[(rng() * 5) | 0]);
      } else {
        tmp.copy(pal.grass[(rng() * 4) | 0]).lerp(pal.scrub[0], clamp(slope / 30, 0, 0.6));
      }
      const jitter = 0.95 + rng() * 0.08;
      tmp.multiplyScalar(jitter);
      for (const [P, gi, gj] of [[A, ai, aj], [B, bi, bj], [Cc, ci, cj]]) {
        pos[p++] = P[0]; pos[p++] = P[1]; pos[p++] = P[2];
        col[q++] = tmp.r; col[q++] = tmp.g; col[q++] = tmp.b;
        uv[u++] = gi / N; uv[u++] = gj / N;
      }
    };

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = v3(i, j), b = v3(i + 1, j), c = v3(i, j + 1), d = v3(i + 1, j + 1);
        // Same split as heightAt(): a-b-c and b-d-c (wound to face up).
        emitTri(a, c, b, i, j, i, j + 1, i + 1, j);
        emitTri(b, c, d, i + 1, j, i, j + 1, i + 1, j + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals(); // non-indexed → per-face normals → flat shading
    this.baseColors = col.slice();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  /** Re-tint the terrain to show slope bands (true) or natural colours (false). */
  showSlopeBands(on) {
    const col = this.mesh.geometry.attributes.color;
    if (!on) { col.array.set(this.baseColors); col.needsUpdate = true; return; }
    const bandCol = [new THREE.Color('#9fd27a'), new THREE.Color('#f1d36b'),
                     new THREE.Color('#ef9550'), new THREE.Color('#c0473f'), null];
    const { N } = this;
    for (let idx = 0; idx < N * N; idx++) {
      const b = this.band[idx];
      for (let v = 0; v < 6; v++) {
        const o = (idx * 6 + v) * 3;
        if (b === BAND.SEA) { col.array[o] = this.baseColors[o]; col.array[o + 1] = this.baseColors[o + 1]; col.array[o + 2] = this.baseColors[o + 2]; continue; }
        col.array[o] = bandCol[b].r; col.array[o + 1] = bandCol[b].g; col.array[o + 2] = bandCol[b].b;
      }
    }
    col.needsUpdate = true;
  }
}

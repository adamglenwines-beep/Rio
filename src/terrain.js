// ---------------------------------------------------------------------------
// terrain.js — the procedurally generated cove.
//
//  * A heightfield. Game logic (zones, slope bands) works on a 2 m grid of
//    CELLS; the ground you see and stand on is a finer 1 m grid of heights
//    (`hf`), drawn as one smooth indexed mesh, so hills are rounded instead
//    of faceted into zig-zags.
//  * Shape: a ravine running inland (towards -z) with a flat harbour at its
//    mouth, flanks that get steeper the further you climb, rock outcrops,
//    and two headlands that drop as cliffs into the sea (+z), with wave-cut
//    rock shelves and skerries at their feet.
//  * Rock: where the ground is too steep to build on, the surface is stepped
//    into ledges along tilted bedding planes (Riomaggiore's diagonal strata);
//    the same planes colour the rock in the shader (materials.js).
//  * Every 2 m cell is classified into a slope band (flat / moderate / steep /
//    cliff / sea). The same cells are what you paint zones onto.
//  * A heavily smoothed copy of the heightfield gives a calm "downhill
//    direction" field which buildings use to face the sea/ravine in rows.
//  * Beyond the playable square, a coarse ring of hills and headlands carries
//    the coast and the ridges on to the horizon (`outer`). It is scenery only.
//  * Terraces (terraces.js) reshape parts of the fine grid after the fact:
//    `hBase` keeps the natural ground, `hf` is what is there now.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeNoise2D, clamp, lerp, smoothstep } from './noise.js';
import { registerStyled } from './style.js';
import { MeshBVH } from 'three-mesh-bvh';

export const BAND = { FLAT: 0, MODERATE: 1, STEEP: 2, CLIFF: 3, SEA: 4 };
export const BAND_NAMES = ['flat', 'moderate', 'steep', 'cliff', 'sea'];

/** The bedding plane of the rock (unit normal). Strike runs roughly along the coast; beds dip ~55° inland. */
export const BEDDING = (() => {
  const d = CONFIG.terrain.rock.dipDegrees * Math.PI / 180, sk = CONFIG.terrain.rock.strikeSkew;
  const v = new THREE.Vector3(sk, Math.cos(d), -Math.sin(d)).normalize();
  return v;
})();

export class Terrain {
  constructor(seed = CONFIG.seed) {
    const T = CONFIG.terrain;
    this.seed = seed;
    this.size = T.size;
    this.cell = T.cell;
    this.half = T.size / 2;
    this.N = Math.round(T.size / T.cell); // cells per side
    this.V = this.N + 1;                   // cell-grid vertices per side
    this.sub = Math.max(1, Math.round(T.cell / T.fineCell));   // fine steps per cell
    this.fcell = T.cell / this.sub;        // fine grid spacing (m)
    this.FN = this.N * this.sub;           // fine quads per side
    this.FV = this.FN + 1;                 // fine vertices per side
    this.noise = makeNoise2D(seed);
    this.version = 0;                      // bumps when the ground is reshaped (terraces)

    this._buildFlankProfile();
    this._generateHeights();
    this._classifyCells();
    this._buildDownhillField();
    this._buildCover();
    this.mesh = this._buildMesh();
    this.outer = this._buildOuter();
  }

  // ---- Shape functions ------------------------------------------------------

  /** z of the coastline at a given x: headlands push seaward at the sides. */
  coastZ(x) {
    const ax = Math.abs(x);
    let z = 6 + 36 * smoothstep(16, 78, ax) + 8 * this.noise.fbm(x * 0.03, 3.1, 3);
    // far along the coast (outside the playable square): big headlands and bays
    if (ax > 125) z += 70 * this.noise.fbm(x * 0.0042 + 3.3, 1.7, 2) * smoothstep(125, 280, ax);
    return z;
  }

  /** x of the ravine centre line at a given z (it meanders a little). */
  ravineX(z) {
    return 5 * Math.sin(z * 0.022 + 1.0) + 5 * this.noise.fbm(z * 0.02, 7.7, 2);
  }

  /**
   * The cross-section of a flank. We integrate a slope function so we can
   * design the profile by slope: gentle at the bottom, steepening, a band of
   * rock outcrop, then easing off onto the hilltops.
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
      slope = lerp(slope, 0.42, smoothstep(c0 + 12, c0 + 32, s));                     // hilltops keep climbing
      h += slope * ds;
    }
    this._flankDs = ds;
    this._flankEnd = h;
  }

  flank(s) {
    const f = s / this._flankDs;
    const last = this._flankLUT.length - 2;
    if (f >= last) return this._flankLUT[last] + (s - last * this._flankDs) * 0.3;   // beyond the table: a steady rise
    const i = Math.floor(f);
    const t = f - i;
    return lerp(this._flankLUT[i], this._flankLUT[i + 1], t);
  }

  /** The raw procedural height at any (x, z) (before rock ledges and terraces). */
  heightFn(x, z) {
    const { fbm, noise } = this.noise;
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

    // Irregularity: broad lumps on the flanks + gentle small bumps everywhere
    // except the harbour floor.
    const onFlank = smoothstep(0, 14, s);
    h += R.lumpiness * fbm(x * 0.017 + 11, z * 0.017 - 5, 4) * onFlank;
    h += R.bumpiness * fbm(x * 0.09, z * 0.09, 2) * smoothstep(8, 22, d + s);

    // Into the sea: blend down to the sea floor over a few metres. Where the
    // land is high this produces a sheer cliff, at the harbour a gentle shore.
    const S = CONFIG.terrain.shore;
    let sea = -1.6 - 0.45 * Math.max(-d, 0) + 1.5 * fbm(x * 0.06, z * 0.06, 2);
    // Rocky coast (where the land above is high): a wave-cut shelf at the cliff
    // foot, and skerries just offshore.
    const rocky = smoothstep(4, 10, h);
    if (rocky > 0 && d < 2 && d > -60) {
      const wN = fbm(x * 0.045 + 17, z * 0.045 + 31, 2);
      const width = S.shelfWidth[0] + (S.shelfWidth[1] - S.shelfWidth[0]) * clamp(wN + 0.45, 0, 1);
      const plateau = smoothstep(-width - 2.5, -width + 1.2, d);
      const top = S.shelfHeight[0] + (S.shelfHeight[1] - S.shelfHeight[0]) * (0.5 + 0.5 * fbm(x * 0.11 + 5, z * 0.11, 2))
        + S.finHeight * Math.abs(noise(x * 0.45 + z * 0.8, z * 0.22 + 9));          // upturned beds: low parallel fins
      sea = lerp(sea, top, plateau * rocky);
      const sk = fbm(x * 0.062 + 90, z * 0.062 + 4, 3);
      if (sk > S.skerryThreshold && d < -width - 3) {
        const peak = Math.min((sk - S.skerryThreshold) * S.skerryRise, S.skerryMax) - 1.2;
        sea = Math.max(sea, lerp(sea, peak, rocky * smoothstep(-58, -46, d)));
      }
    }
    const t = smoothstep(-5, 0.5, d);
    h = lerp(Math.max(sea, CONFIG.terrain.seaFloor), h, t);
    return h;
  }

  /**
   * Scenery beyond the playable square: the same shape carried on, blending
   * into a far coast of headlands and hills rising to a ridge inland.
   */
  outerHeightFn(x, z) {
    const out = Math.max(Math.abs(x) - this.half, Math.abs(z) - this.half, 0);
    const near = this.heightFn(x, z);
    if (out <= 0) return near;
    const { fbm } = this.noise, O = CONFIG.terrain.outer;
    const d = this.coastZ(x) - z;
    const dl = Math.max(d, 0);
    let land = O.cliff * smoothstep(-2, 28, d) + O.ridge * (1 - Math.exp(-dl / O.ridgeRun))
      + O.relief * fbm(x / 170 + 2, z / 170, 4) * smoothstep(20, 140, d)
      + 14 * fbm(x / 55, z / 55 + 8, 3) * smoothstep(10, 60, d);
    // the ravine carries on inland as a valley that climbs to the ridge
    const ax = Math.abs(x - this.ravineX(z));
    land -= O.valleyDepth * Math.exp(-(ax * ax) / (O.valleyWidth * O.valleyWidth)) * (1 - smoothstep(330, 760, d)) * smoothstep(40, 110, d);
    const sea = Math.max(-3 - 0.4 * Math.max(-d, 0), CONFIG.terrain.seaFloor);
    const far = lerp(sea, land, smoothstep(-6, 1, d));
    return lerp(near, far, smoothstep(0, O.blend, out));
  }

  _generateHeights() {
    const { FV, fcell, half } = this;
    const hb = (this.hBase = new Float32Array(FV * FV));
    for (let j = 0; j < FV; j++) {
      for (let i = 0; i < FV; i++) hb[j * FV + i] = this.heightFn(i * fcell - half, j * fcell - half);
    }
    this._rockRelief(hb);
    this.hf = Float32Array.from(hb);
    this._syncCells();
    // The harbour: the point on the ravine floor just inland of the water.
    let hz = 0, hx = 0;
    for (let k = 0; k < 4; k++) { hx = this.ravineX(hz); hz = this.coastZ(hx) - 6; }
    this.harbour = new THREE.Vector3(hx, this.heightAt(hx, hz), hz);
  }

  /**
   * Where the ground is too steep to build on, step it into ledges along the
   * bedding planes and roughen it, so cliffs get a sawtooth skyline and broad
   * diagonal ribs. Buildable ground is left exactly as it was.
   */
  _rockRelief(h) {
    const { FV, fcell, half } = this, K = CONFIG.terrain.rock, { fbm } = this.noise;
    const mask = new Float32Array(FV * FV);
    const at = (i, j) => h[clamp(j, 0, FV - 1) * FV + clamp(i, 0, FV - 1)];
    for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
      const gx = (at(i + 2, j) - at(i - 2, j)) / (4 * fcell), gz = (at(i, j + 2) - at(i, j - 2)) / (4 * fcell);
      const deg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
      mask[j * FV + i] = smoothstep(K.reliefFrom, K.reliefFull, deg) * smoothstep(-4, -0.5, h[j * FV + i]);
    }
    // soften the mask so the relief fades in over a few metres
    const soft = new Float32Array(FV * FV);
    for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
      let s = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s += mask[clamp(j + b, 0, FV - 1) * FV + clamp(i + a, 0, FV - 1)];
      soft[j * FV + i] = Math.min(mask[j * FV + i], s / 9);
    }
    for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
      const m = soft[j * FV + i];
      if (m <= 0) continue;
      const x = i * fcell - half, z = j * fcell - half, y = h[j * FV + i];
      const s = x * BEDDING.x + y * BEDDING.y + z * BEDDING.z + 2.5 * fbm(x * 0.04, z * 0.04 + 3, 2);
      const f = s / K.ledgeSpacing, tri = Math.abs((f - Math.floor(f)) * 2 - 1);
      const step = smoothstep(0.3, 0.7, tri) - 0.5;
      h[j * FV + i] = y + m * (K.ledgeHeight * step + K.cragHeight * fbm(x * 0.22, z * 0.22 + 50, 3));
    }
    this.rockMask = soft;
  }

  /** The 2 m cell-corner heights (`h`), read from the natural fine ground. */
  _syncCells() {
    const { V, FV, sub } = this;
    this.h = this.h || new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) this.h[j * V + i] = this.hBase[(j * sub) * FV + i * sub];
  }

  // ---- Queries --------------------------------------------------------------

  /** World → fractional cell-grid coordinates. */
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

  /** Height of a fine-grid array at (x, z), using the same triangle split as the mesh. */
  _sample(arr, x, z) {
    const { FV, FN } = this;
    const gx = clamp((x + this.half) / this.fcell, 0, FN - 1e-4), gz = clamp((z + this.half) / this.fcell, 0, FN - 1e-4);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const a = arr[j * FV + i], b = arr[j * FV + i + 1];
    const c = arr[(j + 1) * FV + i], d = arr[(j + 1) * FV + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /**
   * Exact height of the rendered surface (same triangle split as the mesh),
   * so steps and houses sit precisely on the ground.
   */
  heightAt(x, z) { return this._sample(this.hf, x, z); }
  /** The natural ground, before any terracing. */
  baseHeightAt(x, z) { return this._sample(this.hBase, x, z); }

  /** Ground height, but never below the sea surface. */
  surfaceAt(x, z) { return Math.max(this.heightAt(x, z), 0); }

  /** Steepness in degrees of the rendered ground around (x, z), over about `r` metres. */
  slopeAt(x, z, r = 1.5) {
    const gx = (this.heightAt(x + r, z) - this.heightAt(x - r, z)) / (2 * r);
    const gz = (this.heightAt(x, z + r) - this.heightAt(x, z - r)) / (2 * r);
    return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
  }

  /** How thickly wild scrub covers the ground at (x, z): 0 bare … 1 dense. */
  coverAt(x, z) { return this._sample(this.cover, x, z); }

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

  /**
   * First hit of a ray on the terrain or the sea surface: { point, water } or null.
   * Uses a bounding-volume hierarchy (three-mesh-bvh), so it tests only the few
   * triangles near the ray instead of marching along it or testing them all.
   */
  raycast(origin, dir, maxDist = 900) {
    const ray = this._ray || (this._ray = new THREE.Ray());
    ray.origin.copy(origin); ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, maxDist);
    const tLand = hit ? hit.distance : Infinity;
    const tSea = ray.direction.y < -1e-6 ? -ray.origin.y / ray.direction.y : Infinity;
    const t = Math.min(tLand, tSea);
    if (!isFinite(t) || t < 0 || t > maxDist) return null;
    const p = ray.at(t, new THREE.Vector3());
    return { point: p, water: tSea <= tLand, distance: t };
  }

  /** Distance along a ray to the terrain (BVH), or Infinity. Used for camera collision. */
  rayDistance(origin, dir, maxDist) {
    const ray = this._ray2 || (this._ray2 = new THREE.Ray());
    ray.origin.copy(origin); ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, maxDist);
    return hit ? hit.distance : Infinity;
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

  // ---- Ground cover -----------------------------------------------------------

  /** How thickly wild scrub wants to grow at a point, from its height and slope (0…1). */
  _coverFn(x, z, y, deg) {
    const W = CONFIG.terrain.cover, { fbm } = this.noise;
    const patch = 0.5 + 0.5 * fbm(x * W.patchScale + 40, z * W.patchScale, 3);
    let c = W.base + (1 - W.base) * smoothstep(W.patchLow, W.patchHigh, patch);
    c = Math.max(c, W.steepBoost * smoothstep(24, 36, deg));        // steeper (unbuildable) slopes: a blanket of scrub
    c *= 1 - smoothstep(W.rockFrom, W.rockFull, deg);               // bare rock on cliffs
    c *= smoothstep(1.8, 5.5, y);                                   // none on the shore
    return c;
  }

  _buildCover() {
    const { FV, fcell, half, hf } = this;
    this.cover = new Float32Array(FV * FV);
    const at = (i, j) => hf[clamp(j, 0, FV - 1) * FV + clamp(i, 0, FV - 1)];
    this.coverBase = this.cover;   // the natural cover; `cover` is what is there now (terraces clear it)
    for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
      const gx = (at(i + 2, j) - at(i - 2, j)) / (4 * fcell), gz = (at(i, j + 2) - at(i, j - 2)) / (4 * fcell);
      const deg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
      this.cover[j * FV + i] = this._coverFn(i * fcell - half, j * fcell - half, hf[j * FV + i], deg);
    }
  }

  // ---- Mesh -------------------------------------------------------------------

  _buildMesh() {
    const { FN, FV, fcell, half, hf } = this;
    const n = FV * FV;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1), uv = new Float32Array(n * 2);
    const nor = new Float32Array(n * 3), mask = new Float32Array(n * 4);
    for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
      const k = j * FV + i;
      pos[k * 3] = i * fcell - half; pos[k * 3 + 1] = hf[k]; pos[k * 3 + 2] = j * fcell - half;
      uv[k * 2] = i / FN; uv[k * 2 + 1] = j / FN;
      mask[k * 4] = this.cover[k];
      // w: rocky shore (below high ground) rather than the harbour's pebble beach
      if (hf[k] < 4) { const x = pos[k * 3]; mask[k * 4 + 3] = smoothstep(4, 9, this.baseHeightAt(x, this.coastZ(x) - 14)); }
    }
    const idx = new Uint32Array(FN * FN * 6);
    let q = 0;
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
      const a = j * FV + i, b = a + 1, c = a + FV, d = c + 1;
      // Same split as heightAt(): a-b-c and b-d-c (wound to face up).
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // per-vertex masks for the ground shader: x = scrub cover, y = terrace soil, z = trodden/bare, w = rocky shore
    geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this._writeNormals(nor, 0, 0, FN, FN);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
    registerStyled(mat, 'ground', { mode: 'terrain', masks: true });
    this.material = mat;
    // acceleration structure for picking and camera collision (see raycast)
    this.bvh = new MeshBVH(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  /** Smooth normals from the fine heights, for the vertices in a rectangle of the fine grid. */
  _writeNormals(nor, i0, j0, i1, j1) {
    const { FV, fcell, hf } = this;
    const H = (i, j) => hf[clamp(j, 0, FV - 1) * FV + clamp(i, 0, FV - 1)];
    for (let j = Math.max(0, j0); j <= Math.min(FV - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(FV - 1, i1); i++) {
      const nx = (H(i - 1, j) - H(i + 1, j)) / (2 * fcell), nz = (H(i, j - 1) - H(i, j + 1)) / (2 * fcell);
      const l = Math.hypot(nx, 1, nz), k = (j * FV + i) * 3;
      nor[k] = nx / l; nor[k + 1] = 1 / l; nor[k + 2] = nz / l;
    }
  }

  /**
   * The ground was reshaped (terraces): `hf` and the masks hold new values for
   * the fine-grid rectangle (i0, j0)–(i1, j1). Push them to the mesh.
   */
  updateRegion(i0, j0, i1, j1, masks = null) {
    const { FV, hf } = this, g = this.mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, am = g.attributes.aMask;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(FV - 1, i1); j1 = Math.min(FV - 1, j1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * FV + i;
      pos.array[k * 3 + 1] = hf[k];
      if (masks) { am.array[k * 4] = masks.cover[k]; am.array[k * 4 + 1] = masks.soil[k]; }
    }
    this._writeNormals(nor.array, i0 - 1, j0 - 1, i1 + 1, j1 + 1);
    pos.needsUpdate = true; nor.needsUpdate = true; am.needsUpdate = true;
    this.bvh.refit();
    g.computeBoundingBox(); g.computeBoundingSphere();
    this.version++;
  }

  /** The ring of distant hills, headlands and sea floor around the playable square (scenery only). */
  _buildOuter() {
    const O = CONFIG.terrain.outer, step = O.cell, R = O.reach, half = this.half;
    const n = Math.round((2 * R) / step), nv = n + 1;
    const hs = new Float32Array(nv * nv);
    const X = (i) => -R + i * step;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nv; i++) {
      const x = X(i), z = X(j);
      let h = this.outerHeightFn(x, z);
      // tuck the ring just under the fine ground where the two overlap, so there are no gaps
      const edge = Math.max(Math.abs(x), Math.abs(z)) - half;
      if (edge < 12) h -= 0.9 * (1 - smoothstep(0, 12, edge));
      hs[j * nv + i] = h;
    }
    const pos = new Float32Array(nv * nv * 3), nor = new Float32Array(nv * nv * 3), col = new Float32Array(nv * nv * 3).fill(1);
    const uv = new Float32Array(nv * nv * 2), mask = new Float32Array(nv * nv * 4);
    const H = (i, j) => hs[clamp(j, 0, nv - 1) * nv + clamp(i, 0, nv - 1)];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nv; i++) {
      const k = j * nv + i, x = X(i), z = X(j);
      pos[k * 3] = x; pos[k * 3 + 1] = hs[k]; pos[k * 3 + 2] = z;
      const nx = (H(i - 1, j) - H(i + 1, j)) / (2 * step), nz = (H(i, j - 1) - H(i, j + 1)) / (2 * step);
      const l = Math.hypot(nx, 1, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nz / l;
      uv[k * 2] = -1; uv[k * 2 + 1] = -1;   // outside the zone overlay
      const deg = Math.atan(Math.hypot(nx, nz)) * 180 / Math.PI;
      mask[k * 4] = Math.max(this._coverFn(x, z, hs[k], deg), 0.75 * smoothstep(3, 9, hs[k]) * (1 - smoothstep(46, 56, deg)));
    }
    const idx = [];
    const inner = half - step;   // cells wholly under the fine ground are left out
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = X(i), x1 = X(i + 1), z0 = X(j), z1 = X(j + 1);
      if (x0 >= -inner && x1 <= inner && z0 >= -inner && z1 <= inner) continue;
      const a = j * nv + i, b = a + 1, c = a + nv, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 4));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain-outer';
    return mesh;
  }

  /** Art style: facets vs smooth shading is a material switch now (style.js); nothing to rebuild. */
  setStyle() {}

  /** Re-tint the terrain to show slope bands (true) or natural colours (false). */
  showSlopeBands(on) {
    const col = this.mesh.geometry.attributes.color, { FV, N, sub } = this;
    if (!on) { col.array.fill(1); col.needsUpdate = true; return; }
    const bandCol = [new THREE.Color('#9fd27a'), new THREE.Color('#f1d36b'),
                     new THREE.Color('#ef9550'), new THREE.Color('#c0473f'), null];
    for (let j = 0; j < FV; j++) for (let i = 0; i < FV; i++) {
      const ci = Math.min(N - 1, Math.floor(i / sub)), cj = Math.min(N - 1, Math.floor(j / sub));
      const b = this.band[cj * N + ci], o = (j * FV + i) * 3;
      if (b === BAND.SEA) { col.array[o] = col.array[o + 1] = col.array[o + 2] = 1; continue; }
      // brighter than the real colours, because the ground texture is multiplied on top
      col.array[o] = bandCol[b].r * 1.6; col.array[o + 1] = bandCol[b].g * 1.6; col.array[o + 2] = bandCol[b].b * 1.6;
    }
    col.needsUpdate = true;
  }
}

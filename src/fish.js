// ---------------------------------------------------------------------------
// fish.js — small shoals of fish in the harbour shallows.
//
// Reuses the approach of Wattle Creek's sea life, cut down to a harbour's
// worth: every fish is one instance of a tiny mesh; the simulation keeps a
// position and a velocity per fish, and the vertex shader turns each fish to
// face the way it is swimming and wags its tail. A grid over the harbour (the
// "field") marks where the water is deep enough, so fish never swim onto the
// shore, the rocks or the slipway.
//
// Each shoal follows a wandering point: it picks somewhere else in the
// harbour to go, swims there, loiters, and picks again. Fish hold loose
// stations around the point, keep a little apart from each other, and dart if
// the rowing boat comes close.
//
// The simulation (FishSchool) is plain arithmetic, with no Three.js, so it is
// unit-tested in Node; FishView draws it.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './noise.js';

const CELL = 2;   // field grid spacing (m)

export class FishSchool {
  /**
   * @param depthAt (x, z) → water depth in metres (0 or less on land)
   * @param centre  {x, z} the harbour point
   */
  constructor(depthAt, centre, opts = {}) {
    const F = { ...CONFIG.fish, ...opts };
    this.F = F;
    this.rng = makeRng(F.seed ?? 77);
    this.cx = centre.x; this.cz = centre.z;
    // the field: which cells are swimmable, and how deep
    const R = F.radius, n = (this.n = Math.ceil((2 * R) / CELL));
    this.x0 = centre.x - R; this.z0 = centre.z - R;
    this.depth = new Float32Array(n * n);
    this.ok = new Uint8Array(n * n);
    this.cells = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
      // the shallowest of five soundings, so a cell beside a rock does not count as open water
      let d = Infinity;
      for (const [ox, oz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) d = Math.min(d, depthAt(x + ox * CELL * 0.6, z + oz * CELL * 0.6));
      this.depth[j * n + i] = d;
      if (d >= F.depth[0] && d <= F.depth[1] && Math.hypot(x - centre.x, z - centre.z) < R - CELL) { this.ok[j * n + i] = 1; this.cells.push(j * n + i); }
    }
    this.count = 0;
    this.shoals = [];
    this.setCount(F.perShoal.high);
  }

  cellOf(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  swimmable(x, z) { const c = this.cellOf(x, z); return c >= 0 && this.ok[c] === 1; }
  depthAt(x, z) { const c = this.cellOf(x, z); return c < 0 ? 0 : this.depth[c]; }
  _cellXZ(c) { return [this.x0 + ((c % this.n) + 0.5) * CELL, this.z0 + (((c / this.n) | 0) + 0.5) * CELL]; }

  /** (Re)create the shoals with `perShoal` fish each. */
  setCount(perShoal) {
    const F = this.F, rng = this.rng;
    const shoals = this.cells.length ? F.shoals : 0;
    this.count = shoals * perShoal;
    const N = this.count;
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.shoal = new Uint8Array(N); this.phase = new Float32Array(N); this.size = new Float32Array(N); this.panic = new Float32Array(N);
    this.ox = new Float32Array(N); this.oz = new Float32Array(N); this.level = new Float32Array(N);
    this.shoals = [];
    for (let s = 0; s < shoals; s++) {
      const [x, z] = this._cellXZ(this.cells[(rng() * this.cells.length) | 0]);
      this.shoals.push({ x, z, tx: x, tz: z, wait: rng() * 4, big: s % 2 === 0 });
      for (let k = 0; k < perShoal; k++) {
        const i = s * perShoal + k;
        let a = rng() * 6.28, r = Math.sqrt(rng()) * 2.4;
        for (let tries = 0; tries < 6 && !this.swimmable(x + Math.cos(a) * r, z + Math.sin(a) * r); tries++) { a = rng() * 6.28; r *= 0.6; }
        if (!this.swimmable(x + Math.cos(a) * r, z + Math.sin(a) * r)) r = 0;
        this.shoal[i] = s; this.phase[i] = rng() * 6.28;
        this.size[i] = (s % 2 === 0 ? 0.34 : 0.22) * (0.8 + rng() * 0.5);
        this.ox[i] = Math.cos(a) * r; this.oz[i] = Math.sin(a) * r;
        this.level[i] = 0.12 + rng() * 0.3;                // how far down between surface and bed (fish keep to the upper water)
        this.px[i] = x + this.ox[i]; this.pz[i] = z + this.oz[i];
        this.py[i] = -Math.max(0.35, this.depthAt(x, z) * this.level[i]);
        this.vx[i] = Math.cos(a) * 0.3; this.vz[i] = Math.sin(a) * 0.3;
      }
    }
    this.perShoal = perShoal;
  }

  /** Advance the simulation. `scare` (optional) is {x, z, r}: something fish dart away from. */
  step(dt, time, scare = null) {
    const F = this.F, rng = this.rng;
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    // the wandering points
    for (const S of this.shoals) {
      const dx = S.tx - S.x, dz = S.tz - S.z, d = Math.hypot(dx, dz);
      if (d < 1.2) {
        S.wait -= dt;
        if (S.wait <= 0) {
          // somewhere else in the harbour, not too far, reachable in a straight swimmable line
          for (let tries = 0; tries < 12; tries++) {
            const [x, z] = this._cellXZ(this.cells[(rng() * this.cells.length) | 0]);
            const L = Math.hypot(x - S.x, z - S.z);
            if (L < 5 || L > 34) continue;
            let clear = true;
            for (let k = 1; k < 8 && clear; k++) clear = this.swimmable(S.x + (x - S.x) * k / 8, S.z + (z - S.z) * k / 8);
            if (clear) { S.tx = x; S.tz = z; break; }
          }
          S.wait = 3 + rng() * 7;
        }
      } else {
        const sp = F.cruise * 0.8 * dt / d;
        S.x += dx * sp; S.z += dz * sp;
      }
    }
    // the fish
    const per = this.perShoal;
    for (let i = 0; i < this.count; i++) {
      const S = this.shoals[this.shoal[i]];
      const x = this.px[i], z = this.pz[i];
      // its station: a slowly circling offset from the wandering point
      const a = time * 0.25 + this.phase[i], c = Math.cos(a * 0.6), s = Math.sin(a * 0.6);
      const wx = S.x + this.ox[i] * c - this.oz[i] * s, wz = S.z + this.ox[i] * s + this.oz[i] * c;
      let ax = (wx - x) * 1.4, az = (wz - z) * 1.4;
      // keep a little apart from the next few in the shoal
      const base = this.shoal[i] * per;
      for (let k = 1; k <= 3; k++) {
        const j = base + ((i - base + k) % per);
        const ex = x - this.px[j], ez = z - this.pz[j], d2 = ex * ex + ez * ez;
        if (d2 < 0.5 && d2 > 1e-6) { ax += ex / d2 * 0.35; az += ez / d2 * 0.35; }
      }
      // dart away from the rowing boat
      let pan = this.panic[i] * Math.exp(-2.5 * dt);
      if (scare) {
        const ex = x - scare.x, ez = z - scare.z, d = Math.hypot(ex, ez);
        if (d < scare.r) { const k = (1 - d / scare.r) * 9 / (d + 0.01); ax += ex * k; az += ez * k; pan = Math.max(pan, 1 - d / scare.r); }
      }
      this.panic[i] = pan;
      ax += (rng() - 0.5) * 0.8; az += (rng() - 0.5) * 0.8;
      let nvx = this.vx[i] + ax * dt, nvz = this.vz[i] + az * dt;
      const want = F.cruise + (F.dart - F.cruise) * pan, sp = Math.hypot(nvx, nvz) || 1e-3;
      const ns = Math.min(Math.max(sp, want * 0.35), want * 1.25) / sp;
      nvx *= ns; nvz *= ns;
      let X = x + nvx * dt, Z = z + nvz * dt;
      if (!this.swimmable(X, Z)) {
        // never onto the shore or the rocks: turn back toward the shoal
        const bx = S.x - x, bz = S.z - z, bl = Math.hypot(bx, bz) || 1;
        nvx = bx / bl * want; nvz = bz / bl * want;
        X = x + nvx * dt; Z = z + nvz * dt;
        if (!this.swimmable(X, Z)) { X = x; Z = z; }
      }
      if (!this.swimmable(X, Z)) { X = x + (S.x - x) * 0.2; Z = z + (S.z - z) * 0.2; }   // somehow out of the water: straight back to the shoal
      const targetY = -Math.max(0.3, Math.min(this.depthAt(X, Z) - 0.3, this.depthAt(X, Z) * this.level[i], 1.7));
      const nvy = (targetY - this.py[i]) * 1.5;
      this.px[i] = X; this.pz[i] = Z; this.py[i] += nvy * dt;
      this.vx[i] = nvx; this.vz[i] = nvz; this.vy[i] = nvy;
    }
  }
}

/** A small fish: nose, deep body, a flat tail fin. Unit length, nose at +x. */
function fishGeometry() {
  const P = { N: [0.5, 0, 0], T: [0.1, 0.16, 0], B: [0.1, -0.14, 0], L: [0.1, 0, 0.09], R: [0.1, 0, -0.09], K: [-0.3, 0, 0], F1: [-0.5, 0.16, 0], F2: [-0.5, -0.16, 0] };
  const tris = [['N', 'T', 'L'], ['N', 'L', 'B'], ['N', 'B', 'R'], ['N', 'R', 'T'], ['K', 'L', 'T'], ['K', 'B', 'L'], ['K', 'R', 'B'], ['K', 'T', 'R'], ['K', 'F1', 'F2']];
  const pos = [];
  for (const t of tris) for (const k of t) pos.push(...P[k]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class FishView {
  constructor(game) {
    this.game = game;
    const t = game.terrain;
    this.school = new FishSchool((x, z) => -t.heightAt(x, z), { x: t.harbour.x, z: t.harbour.z + 14 });
    this.uniforms = { uTime: { value: 0 }, uDay: { value: 1 }, uDeep: { value: new THREE.Color(CONFIG.water.mid) } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iVel; attribute vec2 iMisc;
        uniform float uTime, uDay; uniform vec3 uDeep;
        varying vec3 vCol; varying float vA;
        void main() {
          vec3 p = position;
          float panic = iVel.w;
          // the tail wags: nothing at the nose, most at the tail; faster when darting
          p.z += sin(uTime * (8.0 + panic * 9.0) + iMisc.x - p.x * 5.0) * (0.5 - p.x) * 0.2;
          p *= iMisc.y;
          vec3 f = normalize(iVel.xyz + vec3(1e-4, 0.0, 0.0)), r = normalize(cross(f, vec3(0.0, 1.0, 0.0))), u = cross(r, f);
          vec3 wp = iPos + f * p.x + u * p.y + r * p.z;
          vec3 wn = normalize(f * normal.x + u * normal.y + r * normal.z);
          // dark back, pale belly, a glint off the flank; then tinted by the water above it
          float belly = smoothstep(-0.15, -0.6, normal.y);
          vec3 col = mix(vec3(0.05, 0.10, 0.12), vec3(0.62, 0.70, 0.70), belly);
          col = col * (0.55 + 0.6 * max(wn.y, 0.0)) + vec3(0.8, 0.9, 0.9) * pow(max(wn.y, 0.0), 3.0) * 0.15;
          vCol = mix(col, uDeep, clamp(-wp.y / 4.0, 0.0, 0.7)) * (0.25 + 0.75 * uDay);
          vA = mix(0.92, 0.3, clamp((-wp.y - 0.2) / 2.2, 0.0, 1.0));     // fainter the deeper it swims
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vA;
        void main() {
          gl_FragColor = vec4(vCol, vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(fishGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;   // after the water surface
    this.mesh.name = 'fish';
    this._alloc();
  }

  _alloc() {
    const S = this.school, g = this.mesh.geometry;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(S.count, 1) * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(S.count, 1) * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const misc = new Float32Array(Math.max(S.count, 1) * 2);
    for (let i = 0; i < S.count; i++) { misc[i * 2] = S.phase[i]; misc[i * 2 + 1] = S.size[i]; }
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel);
    g.setAttribute('iMisc', new THREE.InstancedBufferAttribute(misc, 2));
    g.instanceCount = S.count;
  }

  /** Quality preset: how many fish. */
  setQuality(name) {
    const n = CONFIG.fish.perShoal[name] ?? CONFIG.fish.perShoal.high;
    if (n === this.school.perShoal) return;
    this.school.setCount(n);
    this._alloc();
  }

  update(dt, time, day = 1) {
    const g = this.game, S = this.school, h = g.terrain.harbour;
    const seen = g.camera.position.distanceTo(h) < CONFIG.fish.viewDistance;
    this.mesh.visible = seen && S.count > 0;
    if (!this.mesh.visible) return;
    const boat = g.sea && g.sea.rowboat ? g.sea.rowboat.group.position : null;
    S.step(dt, time, boat ? { x: boat.x, z: boat.z, r: 4.5 } : null);
    const P = this.aPos.array, V = this.aVel.array;
    for (let i = 0; i < S.count; i++) {
      P[i * 3] = S.px[i]; P[i * 3 + 1] = S.py[i]; P[i * 3 + 2] = S.pz[i];
      V[i * 4] = S.vx[i]; V[i * 4 + 1] = S.vy[i] * 0.5; V[i * 4 + 2] = S.vz[i]; V[i * 4 + 3] = S.panic[i];
    }
    this.aPos.needsUpdate = true; this.aVel.needsUpdate = true;
    this.uniforms.uTime.value = time; this.uniforms.uDay.value = day;
  }
}

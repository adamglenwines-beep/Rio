// ---------------------------------------------------------------------------
// scenery.js — dry-stone terraces, vine rows and trees on the hillsides.
//
// Terrace walls follow contour lines (found with "marching squares" on the
// height grid every TERRACE_STEP metres of height), so the hills read as the
// stepped vineyards of the Cinque Terre. Anything that would sit on a lane or
// inside a house is skipped; the set is refreshed when paths or houses change.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeRng } from './noise.js';
import { BAND } from './terrain.js';

const TERRACE_STEP = 2.4;   // height between terrace walls (m)

export class Scenery {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.walls = this._contourWalls();
    this.trees = this._placeTrees();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true });
    this.meshes = {
      wall: this._mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat('#ffffff'), this.walls.length, false),
      vine: this._mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat('#ffffff'), this.walls.length, false),
      trunk: this._mesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 5).translate(0, 0.5, 0), mat('#6b5040'), this.trees.length, true),
      crown: this._mesh(new THREE.IcosahedronGeometry(1, 0), mat('#ffffff'), this.trees.length, true),
    };
  }

  _mesh(geo, material, n, shadow) {
    const m = new THREE.InstancedMesh(geo, material, Math.max(n, 1));
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 3).fill(1), 3);
    this.group.add(m);
    return m;
  }

  /** Marching squares: one wall segment per contour crossing of a grid cell. */
  _contourWalls() {
    const t = this.terrain, { N, V, cell, half } = t;
    const rng = makeRng(t.seed * 5 + 77);
    const walls = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const band = t.band[j * N + i];
      if (band !== BAND.MODERATE && band !== BAND.STEEP) continue;
      const h = [t.h[j * V + i], t.h[j * V + i + 1], t.h[(j + 1) * V + i + 1], t.h[(j + 1) * V + i]];
      const lo = Math.min(...h), hi = Math.max(...h);
      if (lo < 2.5) continue;
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      for (let L = Math.ceil(lo / TERRACE_STEP) * TERRACE_STEP; L < hi; L += TERRACE_STEP) {
        // crossing points on the four cell edges
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = h[e], b = h[(e + 1) % 4];
          if ((a < L) !== (b < L)) {
            const f = (L - a) / (b - a);
            const [ai, aj] = corners[e], [bi, bj] = corners[(e + 1) % 4];
            pts.push([(ai + (bi - ai) * f) * cell - half, (aj + (bj - aj) * f) * cell - half]);
          }
        }
        if (pts.length < 2) continue;
        const [p, q] = pts;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 0.3) continue;
        walls.push({
          x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2, y: L, len: len + 0.15,
          rot: Math.atan2(q[0] - p[0], q[1] - p[1]) + Math.PI / 2,
          vine: band === BAND.MODERATE && rng() < 0.75,
          shade: 0.88 + rng() * 0.2,
        });
      }
    }
    return walls;
  }

  _placeTrees() {
    const t = this.terrain, rng = makeRng(t.seed * 3 + 11);
    const trees = [];
    for (let k = 0; k < 4000 && trees.length < 140; k++) {
      const x = rng.range(-t.half + 6, t.half - 6), z = rng.range(-t.half + 6, t.half - 6);
      const y = t.heightAt(x, z), band = t.bandAt(x, z);
      if (y < 4 || band === BAND.CLIFF || band === BAND.SEA) continue;
      // cluster: pines up high, olives on the terraces
      const pine = y > 34 && rng() < 0.7;
      if (!pine && rng() < 0.6) continue;
      if (trees.some((o) => Math.hypot(o.x - x, o.z - z) < 5)) continue;
      trees.push({ x, z, y, pine, s: rng.range(0.8, 1.25), rot: rng() * 6 });
    }
    return trees;
  }

  /** Rebuild instances, skipping anything on a lane or inside a house. */
  refresh(growth) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const free = (x, z) => !growth || growth.occAt(x, z) === -1;
    const stone = new THREE.Color('#a8997f'), vineCol = new THREE.Color('#5d7d33');

    let nw = 0, nv = 0;
    for (const w of this.walls) {
      if (!free(w.x, w.z)) continue;
      q.setFromAxisAngle(up, w.rot);
      // a low dry-stone wall standing on the contour
      this.meshes.wall.setMatrixAt(nw, m.compose(v.set(w.x, w.y - 1.1, w.z), q, s.set(w.len, 1.6, 0.45)));
      this.meshes.wall.setColorAt(nw++, c.copy(stone).multiplyScalar(w.shade));
      if (w.vine) {
        // a row of vines on the terrace just uphill of the wall
        const ox = Math.sin(w.rot), oz = Math.cos(w.rot);   // across the wall
        const sgn = this.terrain.heightAt(w.x + ox, w.z + oz) > w.y ? 1 : -1;
        const vx = w.x + ox * sgn * 1.0, vz = w.z + oz * sgn * 1.0;
        this.meshes.vine.setMatrixAt(nv, m.compose(v.set(vx, this.terrain.heightAt(vx, vz) - 0.1, vz), q, s.set(w.len, 0.75, 0.5)));
        this.meshes.vine.setColorAt(nv++, c.copy(vineCol).multiplyScalar(w.shade));
      }
    }
    let nt = 0;
    for (const tr of this.trees) {
      if (!free(tr.x, tr.z)) continue;
      q.setFromAxisAngle(up, tr.rot);
      const trunkH = tr.pine ? 5.5 * tr.s : 1.6 * tr.s;
      this.meshes.trunk.setMatrixAt(nt, m.compose(v.set(tr.x, tr.y - 0.2, tr.z), q, s.set(tr.s, trunkH, tr.s)));
      if (tr.pine) {
        // umbrella pine: a wide flat crown on a tall trunk
        this.meshes.crown.setMatrixAt(nt, m.compose(v.set(tr.x, tr.y + trunkH, tr.z), q, s.set(3.2 * tr.s, 1.2 * tr.s, 3.2 * tr.s)));
        this.meshes.crown.setColorAt(nt, c.set('#3f6b34'));
      } else {
        // olive: small, round, silvery green
        this.meshes.crown.setMatrixAt(nt, m.compose(v.set(tr.x, tr.y + trunkH + 0.6 * tr.s, tr.z), q, s.set(1.6 * tr.s, 1.3 * tr.s, 1.6 * tr.s)));
        this.meshes.crown.setColorAt(nt, c.set('#7f9466'));
      }
      nt++;
    }
    const set = (mesh, n) => { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; };
    set(this.meshes.wall, nw); set(this.meshes.vine, nv);
    set(this.meshes.trunk, nt); set(this.meshes.crown, nt);
  }
}

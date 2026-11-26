// ---------------------------------------------------------------------------
// zones.js — painted zoning.
//
// Internally zones live on the terrain's 2 m cell grid, but the player never
// sees squares: the overlay is a small texture stretched over the terrain with
// smooth (linear) filtering, so painted areas show as soft blobs.
// Bright = connected to the harbour (can grow). Faded = not reachable yet.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { BAND } from './terrain.js';

export const ZONE = { NONE: 0, RES: 1, COM: 2 };
const COLOURS = { [ZONE.RES]: [118, 206, 104], [ZONE.COM]: [86, 160, 235] };

export class Zones {
  constructor(terrain) {
    this.terrain = terrain;
    const N = terrain.N;
    this.grid = new Uint8Array(N * N);
    this.version = 0;

    this.data = new Uint8Array(N * N * 4);
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    // The overlay re-uses the terrain's geometry, drawn on top with an offset.
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(terrain.mesh.geometry, this.material);
    this.mesh.renderOrder = 2;
    this.setEmphasis(false);
  }

  /** Paint (or erase with value 0) every cell within radius of (x, z). */
  paint(x, z, radius, value) {
    const t = this.terrain, N = t.N, c = t.cell;
    const i0 = Math.floor((x - radius + t.half) / c), i1 = Math.floor((x + radius + t.half) / c);
    const j0 = Math.floor((z - radius + t.half) / c), j1 = Math.floor((z + radius + t.half) / c);
    let changed = false;
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        const idx = j * N + i;
        const [cx, cz] = t.cellCentre(idx);
        if (Math.hypot(cx - x, cz - z) > radius) continue;
        const band = t.band[idx];
        if (value !== ZONE.NONE && (band === BAND.SEA || band === BAND.CLIFF)) continue;
        if (this.grid[idx] !== value) { this.grid[idx] = value; changed = true; }
      }
    }
    if (changed) this.version++;
    return changed;
  }

  clear() { this.grid.fill(0); this.version++; }

  at(x, z) {
    const idx = this.terrain.cellIndex(x, z);
    return idx < 0 ? 0 : this.grid[idx];
  }

  /** Recolour the overlay; `access` tells us which cells are reachable. */
  refresh(access) {
    const N = this.terrain.N;
    for (let idx = 0; idx < N * N; idx++) {
      const z = this.grid[idx], o = idx * 4;
      if (!z) { this.data[o + 3] = 0; continue; }
      const col = COLOURS[z];
      const ok = access && isFinite(access.cellEffort[idx]);
      const k = ok ? 1 : 0.55;
      this.data[o] = col[0] * k + 200 * (1 - k);
      this.data[o + 1] = col[1] * k + 200 * (1 - k);
      this.data[o + 2] = col[2] * k + 200 * (1 - k);
      this.data[o + 3] = ok ? 150 : 90;
    }
    this.texture.needsUpdate = true;
  }

  /** Stronger overlay while a zoning tool is in hand. */
  setEmphasis(on) { this.material.opacity = on ? 0.95 : 0.45; }
}

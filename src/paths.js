// ---------------------------------------------------------------------------
// paths.js — stairs and lanes.
//
// A path is laid by tapping waypoints. Between two waypoints we "route" a
// polyline that hugs the ground; if the straight line is steeper than a stair
// may climb, we zig-zag (switchback) across the slope until every leg is
// gentle enough.
//
// All paths together form a graph of nodes (every ~1.5 m). The harbour quay
// nodes are the roots: walking effort is measured from them (see access.js).
// Rendering: one instanced stone slab per step. On a slope consecutive slabs
// sit at different heights, which reads as a staircase; on the flat they are
// paving.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng, clamp } from './noise.js';
import { BAND } from './terrain.js';
import { registerStyled } from './style.js';

const P = CONFIG.path;

/**
 * Where the harbour's fixed pieces go: the piazza at the foot of the main
 * street and a slipway down into the water beside it. Shared with water.js
 * (boats are hauled up on the slipway) and growth.js (kept clear of houses).
 */
export function harbourLayout(t) {
  const H = CONFIG.harbour, h = t.harbour;
  const slipX = h.x + H.slipwayOffset;
  return {
    x: h.x, piazzaZ: h.z - 1, piazzaR: H.piazzaRadius,
    slipX, slipW: H.slipwayWidth,
    slipZ0: h.z - 1, slipZ1: t.coastZ(slipX) + 4,
  };
}

export class PathNetwork {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.nodes = [];     // {x, y, z, adj: Map<nodeId, cost>, harbour, path}
    this.paths = [];     // {points: [{x,z}], nodeIds: []}
    this.version = 0;    // bumps whenever the network changes
    this.rng = makeRng(terrain.seed * 13 + 1);

    const slab = new THREE.BoxGeometry(1, 1, 1);
    slab.translate(0, -0.5, 0); // origin at the top face, so y = walking surface
    this.slabGeo = slab;
    this.slabMat = registerStyled(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), 'surface');
    this.mesh = null;
    this.previewMat = new THREE.MeshStandardMaterial({ color: '#f39a4a', transparent: true, opacity: 0.85, emissive: '#7a3a10', emissiveIntensity: 0.25 });
    this.preview = null;

    this._buildHarbour();
    this.rebuildMesh();
  }

  // ---- The harbour (root of the network) ---------------------------------

  _buildHarbour() {
    const t = this.terrain, H = CONFIG.harbour;
    const lay = harbourLayout(t);
    // A narrow quay walkway along the waterfront through the harbour point.
    const pts = [];
    for (let dx = -H.quayReach; dx <= H.quayReach; dx += P.nodeSpacing) {
      const x = lay.x + dx;
      const z = t.coastZ(x) - H.quayInset;
      const hh = t.heightAt(x, z);
      if (hh < 0.4 || hh > 4.5) continue;
      pts.push({ x, z });
    }
    const ids = this._addNodeChain(pts, true);
    this.quay = { points: pts, nodeIds: ids };
    this.layout = lay;
    // Stone jetty out into the water (decorative, not walkable in the graph).
    this.jetty = [];
    const z0 = t.coastZ(lay.x) - 2;
    for (let d = 0; d < 16; d += 1.0) this.jetty.push({ x: lay.x + 4 + d * 0.25, z: z0 + d });
  }

  isHarbourNode(id) { return this.nodes[id].harbour; }

  // ---- Graph helpers --------------------------------------------------------

  _cost(a, b) {
    const dh = Math.abs(a.y - b.y);
    return Math.hypot(a.x - b.x, a.z - b.z) + CONFIG.effort.climbWeight * dh;
  }
  _link(i, j) {
    if (i === j) return;
    const c = this._cost(this.nodes[i], this.nodes[j]);
    this.nodes[i].adj.set(j, c);
    this.nodes[j].adj.set(i, c);
  }
  _addNodeChain(points, harbour = false) {
    const ids = [];
    const pathIndex = this.paths.length;
    for (const p of points) {
      const id = this.nodes.length;
      this.nodes.push({ x: p.x, z: p.z, y: this.terrain.surfaceAt(p.x, p.z), adj: new Map(), harbour, path: pathIndex });
      if (ids.length) this._link(ids[ids.length - 1], id);
      ids.push(id);
    }
    return ids;
  }

  /** Nearest node within radius (or -1). */
  nearestNode(x, z, radius = P.snapRadius) {
    let best = -1, bd = radius;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---- Routing --------------------------------------------------------------

  /** Polyline from a to b that never climbs steeper than maxGrade per leg. */
  route(a, b) {
    const t = this.terrain;
    const dx = b.x - a.x, dz = b.z - a.z;
    const D = Math.hypot(dx, dz);
    if (D < 0.5) return [a, b];
    const ux = dx / D, uz = dz / D;      // along the path
    const px = -uz, pz = ux;             // across the path
    const legGrade = (pts) => {
      let worst = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const A = pts[i], B = pts[i + 1];
        const len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
        // sample the leg so a bump in the middle is noticed too
        let prev = t.surfaceAt(A.x, A.z);
        const k = Math.max(2, Math.ceil(len / 2));
        for (let s = 1; s <= k; s++) {
          const x = A.x + (B.x - A.x) * s / k, z = A.z + (B.z - A.z) * s / k;
          const hh = t.surfaceAt(x, z);
          worst = Math.max(worst, Math.abs(hh - prev) / (len / k));
          prev = hh;
        }
      }
      return worst;
    };

    const straight = [a, b];
    // allow small local bumps over the limit on a straight run
    if (legGrade(straight) <= P.maxGrade * 1.15) return straight;

    // Switchbacks: alternate either side of the straight line. More legs →
    // each leg climbs less. Stop as soon as all legs are within the limit.
    const H = Math.abs(t.surfaceAt(b.x, b.z) - t.surfaceAt(a.x, a.z));
    const w = Math.min(P.switchbackWidth, Math.max(4, H * 0.6));
    // Enough legs for an ideal slope, plus a few spare; never a tangle.
    const maxLegs = clamp(Math.ceil(H / (P.maxGrade * w)) + 3, 2, 24);
    let best = straight, bestG = Infinity;
    for (let n = 2; n <= maxLegs; n++) {
      const pts = [a];
      for (let i = 1; i < n; i++) {
        const side = i % 2 ? 0.5 : -0.5;
        const f = i / n;
        let x = a.x + dx * f + px * w * side, z = a.z + dz * f + pz * w * side;
        x = clamp(x, -t.half + 2, t.half - 2); z = clamp(z, -t.half + 2, t.half - 2);
        pts.push({ x, z });
      }
      pts.push(b);
      const g = legGrade(pts);
      if (g < bestG) { bestG = g; best = pts; }
      if (g <= P.maxGrade * 1.15) break;
    }
    return best;
  }

  /** Route a whole chain of waypoints. */
  routeAll(waypoints) {
    const out = [];
    for (let i = 0; i + 1 < waypoints.length; i++) {
      const seg = this.route(waypoints[i], waypoints[i + 1]);
      if (out.length) seg.shift();
      out.push(...seg);
    }
    if (waypoints.length === 1) out.push(waypoints[0]);
    return out;
  }

  /** Resample a polyline at a fixed spacing. */
  static resample(poly, spacing) {
    const out = [poly[0]];
    let carry = 0;
    for (let i = 0; i + 1 < poly.length; i++) {
      const A = poly[i], B = poly[i + 1];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      let d = spacing - carry;
      while (d <= len) {
        out.push({ x: A.x + (B.x - A.x) * d / len, z: A.z + (B.z - A.z) * d / len });
        d += spacing;
      }
      carry = len - (d - spacing);
    }
    const last = poly[poly.length - 1], prev = out[out.length - 1];
    if (Math.hypot(last.x - prev.x, last.z - prev.z) > spacing * 0.3) out.push(last);
    else out[out.length - 1] = last;
    return out;
  }

  /** Snap a tapped point to an existing path node if it is close. */
  snap(p) {
    const id = this.nearestNode(p.x, p.z);
    if (id < 0) return { x: p.x, z: p.z, node: -1 };
    return { x: this.nodes[id].x, z: this.nodes[id].z, node: id };
  }

  // ---- Committing a path ----------------------------------------------------

  /** Turn tapped waypoints into a real path. Returns the new path or null. */
  addPath(waypoints) {
    if (waypoints.length < 2) return null;
    const wps = waypoints.map((w) => this.snap(w));
    const poly = this.routeAll(wps);
    const pts = PathNetwork.resample(poly, P.nodeSpacing);
    const existing = this.nodes.length;
    const ids = this._addNodeChain(pts);
    // join the ends to whatever they were snapped to
    if (wps[0].node >= 0) this._link(ids[0], wps[0].node);
    const last = wps[wps.length - 1];
    if (last.node >= 0) this._link(ids[ids.length - 1], last.node);
    // join crossings / near-touches with other paths
    for (const id of ids) {
      const n = this.nodes[id];
      for (let j = 0; j < existing; j++) {
        const m = this.nodes[j];
        if (Math.abs(m.x - n.x) < 2 && Math.abs(m.z - n.z) < 2 && Math.hypot(m.x - n.x, m.z - n.z) < 1.9) this._link(id, j);
      }
    }
    const path = { points: poly, nodeIds: ids };
    this.paths.push(path);
    this.version++;
    this.rebuildMesh();
    return path;
  }

  clear() {
    this.nodes = []; this.paths = [];
    this._buildHarbour();
    this.version++;
    this.rebuildMesh();
  }

  // ---- Rendering --------------------------------------------------------------

  /** Compute slab transforms for a polyline. */
  _slabsFor(poly, width, out) {
    const t = this.terrain;
    const fine = PathNetwork.resample(poly, 0.3);
    let i = 0;
    while (i + 1 < fine.length) {
      const A = fine[i];
      // step length adapts to the local grade: short treads on steep stairs
      const look = fine[Math.min(i + 3, fine.length - 1)];
      const g = Math.abs(t.surfaceAt(look.x, look.z) - t.surfaceAt(A.x, A.z)) / (Math.hypot(look.x - A.x, look.z - A.z) || 1);
      const len = clamp(0.22 / Math.max(g, 0.01), 0.45, 1.3);
      const k = Math.max(1, Math.round(len / 0.3));
      const B = fine[Math.min(i + k, fine.length - 1)];
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      const L = Math.hypot(B.x - A.x, B.z - A.z);
      if (L < 0.05) break;
      const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
      const hw = width / 2;
      const top = Math.max(t.surfaceAt(mx, mz), t.surfaceAt(mx - uz * hw, mz + ux * hw), t.surfaceAt(mx + uz * hw, mz - ux * hw),
        t.surfaceAt(A.x, A.z), t.surfaceAt(B.x, B.z)) + 0.1;
      out.push({ x: mx, z: mz, y: top, rot: Math.atan2(ux, uz), len: L + 0.04, width, depth: 1.8 });
      i += k;
    }
  }

  rebuildMesh() {
    const slabs = [];
    const t = this.terrain, lay = this.layout;
    this._slabsFor(this.quay.points, CONFIG.harbour.quayHalfWidth * 2 + 0.4, slabs);
    // the piazza: square paving stones over a small disc
    for (let dz = -lay.piazzaR; dz <= lay.piazzaR; dz += 1.4) for (let dx = -lay.piazzaR; dx <= lay.piazzaR; dx += 1.4) {
      if (dx * dx + dz * dz > lay.piazzaR * lay.piazzaR) continue;
      const x = lay.x + dx, z = lay.piazzaZ + dz;
      if (t.heightAt(x, z) < 0.3) continue;
      slabs.push({ x, z, y: t.surfaceAt(x, z) + 0.12, rot: 0, len: 1.42, width: 1.42, depth: 1.2 });
    }
    // the slipway: a stone ramp running down under the water
    for (let z = lay.slipZ0; z <= lay.slipZ1; z += 0.9) {
      const g = t.heightAt(lay.slipX, z);
      slabs.push({ x: lay.slipX, z, y: g + 0.12, rot: 0, len: 0.95, width: lay.slipW, depth: 1.2 });
    }
    for (const p of this.paths) this._slabsFor(p.points, P.width, slabs);
    // the jetty
    for (const j of this.jetty) {
      if (t.heightAt(j.x, j.z) > 1) continue;
      slabs.push({ x: j.x, z: j.z, y: 1.1, rot: 0.25, len: 1.05, width: 2.6, depth: 1.1 - t.heightAt(j.x, j.z) });
    }

    if (this.mesh) { this.group.remove(this.mesh); this.mesh.dispose(); }
    const mesh = new THREE.InstancedMesh(this.slabGeo, this.slabMat, Math.max(slabs.length, 1));
    mesh.count = slabs.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const stones = ['#b9afa1', '#aaa092', '#c3b9a8', '#a39a8c', '#bdb2a0'];
    const rng = makeRng(7);
    slabs.forEach((sl, i) => {
      q.setFromAxisAngle(up, sl.rot);
      m.compose(v.set(sl.x, sl.y, sl.z), q, s.set(sl.width, sl.depth, sl.len));
      mesh.setMatrixAt(i, m);
      c.set(stones[(rng() * stones.length) | 0]);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.group.add(mesh);
    this.slabs = slabs;
  }

  /** Orange preview of a path being drawn. */
  showPreview(waypoints) {
    if (this.preview) { this.group.remove(this.preview); this.preview.dispose(); this.preview = null; }
    if (!waypoints || waypoints.length < 2) return null;
    const poly = this.routeAll(waypoints.map((w) => this.snap(w)));
    const slabs = [];
    this._slabsFor(poly, P.width * 0.8, slabs);
    const mesh = new THREE.InstancedMesh(this.slabGeo, this.previewMat, Math.max(1, slabs.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    slabs.forEach((sl, i) => {
      q.setFromAxisAngle(up, sl.rot);
      m.compose(v.set(sl.x, sl.y + 0.08, sl.z), q, s.set(sl.width, 0.3, sl.len * 0.7));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = slabs.length;
    this.preview = mesh;
    this.group.add(mesh);
    return poly;
  }

  /** Is this spot too steep/wet to start or end a path? */
  validWaypoint(p) {
    const b = this.terrain.bandAt(p.x, p.z);
    return b !== BAND.SEA;
  }
}

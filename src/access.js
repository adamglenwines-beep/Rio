// ---------------------------------------------------------------------------
// access.js — walking effort.
//
// Effort = metres walked + climbWeight × metres climbed (stairs are tiring).
//  1. Dijkstra over the path graph from the harbour quay gives each path node
//     an effort. Paths not connected to the harbour stay at Infinity.
//  2. A second Dijkstra spreads that effort onto the 2 m ground cells, starting
//     from every connected path node. Walking off-path costs extra and stops
//     after `accessRadius` metres: land further from a path is unreachable.
// The result drives everything in the growth simulation: where houses may
// appear, in which order, and how tall they get.
// ---------------------------------------------------------------------------
import { CONFIG } from './config.js';
import { BAND } from './terrain.js';

/** Minimal binary min-heap of (key, value) pairs. */
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.lastKey = topK;
    return topV;
  }
}

export function computeAccess(terrain, network) {
  const E = CONFIG.effort;
  // ---- 1. path graph ---------------------------------------------------------
  const nodes = network.nodes;
  const nodeEffort = new Float64Array(nodes.length).fill(Infinity);
  const heap = new MinHeap();
  nodes.forEach((n, i) => { if (n.harbour) { nodeEffort[i] = 0; heap.push(0, i); } });
  while (heap.size) {
    const i = heap.pop(), d = heap.lastKey;
    if (d > nodeEffort[i]) continue;
    for (const [j, c] of nodes[i].adj) {
      const nd = d + c;
      if (nd < nodeEffort[j]) { nodeEffort[j] = nd; heap.push(nd, j); }
    }
  }

  // ---- 2. ground cells ---------------------------------------------------------
  const { N, cell } = terrain;
  const cellEffort = new Float64Array(N * N).fill(Infinity);
  const offDist = new Float32Array(N * N).fill(Infinity);
  const cellH = new Float32Array(N * N);
  for (let idx = 0; idx < N * N; idx++) {
    const [x, z] = terrain.cellCentre(idx);
    cellH[idx] = terrain.surfaceAt(x, z);
  }
  const h2 = new MinHeap();
  nodes.forEach((n, i) => {
    if (!isFinite(nodeEffort[i])) return;
    const idx = terrain.cellIndex(n.x, n.z);
    if (idx < 0) return;
    if (nodeEffort[i] < cellEffort[idx]) { cellEffort[idx] = nodeEffort[i]; offDist[idx] = 0; h2.push(nodeEffort[i], idx); }
  });
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (h2.size) {
    const idx = h2.pop(), d = h2.lastKey;
    if (d > cellEffort[idx]) continue;
    const i = idx % N, j = (idx / N) | 0;
    for (const [di, dj] of nb) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const k = jj * N + ii;
      const band = terrain.band[k];
      if (band === BAND.SEA || band === BAND.CLIFF) continue;
      const horiz = cell * (di && dj ? Math.SQRT2 : 1);
      const od = offDist[idx] + horiz;
      if (od > E.accessRadius) continue;
      const nd = d + (horiz + E.climbWeight * Math.abs(cellH[k] - cellH[idx])) * E.offPathMultiplier;
      if (nd < cellEffort[k]) { cellEffort[k] = nd; offDist[k] = od; h2.push(nd, k); }
    }
  }
  return { nodeEffort, cellEffort, offDist };
}

/** Effort at a world position (from the cell it falls in). */
export function effortAt(terrain, access, x, z) {
  const idx = terrain.cellIndex(x, z);
  return idx < 0 ? Infinity : access.cellEffort[idx];
}

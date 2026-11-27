// ---------------------------------------------------------------------------
// water.js — the sea and the boats on it.
//
// The sea knows how deep it is everywhere: the ground heights (and the
// boulders standing in the water) are baked into a small texture, and the water
// shader reads it per pixel. From that depth it works out:
//   * colour — turquoise over the shallows, fading through teal to deep blue;
//   * clarity — clear near the shore, so rocks and the sea bed show through;
//   * foam — a white fringe where the water meets rock, shore and breakwater,
//     and thin lines of surf running in over the shallows.
// (The depth-from-a-height-texture idea comes from Wattle Creek's water.)
// Waves are gentle and calm down toward the shore; ripples catch the sun.
// The harbour still mirrors the town (planar reflection, see gfx.js).
//
// Boats: fishing boats bob at their moorings beside orange buoys; one is rowed
// out round the harbour and back; and now and then a sailboat crosses the
// horizon.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './noise.js';
import { harbourLayout } from './paths.js';
import { registerStyled } from './style.js';

/** A little gozzo fishing boat hull: a box with pinched, raised ends (about 3.6 m long). */
export function gozzoHull() {
  const hull = new THREE.BoxGeometry(1.3, 0.55, 3.6, 1, 1, 4);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    const end = Math.abs(z) / 1.8;               // 0 middle → 1 bow/stern
    p.setX(i, p.getX(i) * (1 - 0.75 * end * end) * (y < 0 ? 0.75 : 1));
    p.setY(i, y + (y > 0 ? 0.25 * end * end : 0));
  }
  hull.computeVertexNormals();
  return hull;
}

/** The rowing boat's route: a loop from the slipway out past the breakwater and back, kept in deep-enough water. */
export function rowingRoute(terrain) {
  const h = terrain.harbour, lay = harbourLayout(terrain);
  const pts = CONFIG.water.rowRoute.map(([dx, dz]) => {
    let x = lay.x + dx, z = terrain.coastZ(lay.x) + dz;
    for (let k = 0; k < 40 && terrain.heightAt(x, z) > -0.9; k++) { z += 1.5; x += (h.x + 6 - x) * 0.08; }   // nudge seaward off the shallows
    return new THREE.Vector3(x, 0, z);
  });
  // follow that loop closely, easing any stretch that crosses shallows or rocks toward the middle of the harbour mouth
  const rough = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5).getSpacedPoints(56).slice(0, -1);
  const anchor = new THREE.Vector3(lay.x + 8, 0, terrain.coastZ(lay.x) + 30);
  const deep = (p) => Math.max(terrain.heightAt(p.x, p.z), terrain.heightAt(p.x + 1.2, p.z), terrain.heightAt(p.x - 1.2, p.z), terrain.heightAt(p.x, p.z + 1.2), terrain.heightAt(p.x, p.z - 1.2)) < -0.9;
  for (const p of rough) for (let k = 0; k < 40 && !deep(p); k++) p.lerp(anchor, 0.06);
  return new THREE.CatmullRomCurve3(rough, true, 'catmullrom', 0.5);
}

export class Sea {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    const W = CONFIG.water, col = (h) => new THREE.Color(h);
    // the sea bed (and boulders) as a height picture, one texel per fine-grid vertex
    const n = terrain.FV;
    this.heightData = new Uint16Array(n * n);
    this.heightTex = new THREE.DataTexture(this.heightData, n, n, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.generateMipmaps = false;
    this.uniforms = {
      uTime: { value: 0 },
      // planar reflection (filled in by gfx.js on Medium/High; strength 0 = off)
      uRefl: { value: null }, uReflMatrix: { value: new THREE.Matrix4() }, uReflStrength: { value: 0 }, uRipple: { value: 0.02 },
      uHeightTex: { value: this.heightTex },
      uMap: { value: new THREE.Vector4(-terrain.half - terrain.fcell / 2, -terrain.half - terrain.fcell / 2, terrain.size + terrain.fcell, 0) },
      uShallow: { value: col(W.shallow) }, uMid: { value: col(W.mid) }, uDeep: { value: col(W.deep) }, uFoam: { value: col(W.foam) },
      uClear: { value: new THREE.Vector2(W.clearAlpha, W.clearDepth) }, uFoamK: { value: W.foamAmount },
    };
    this.syncHeights();

    const geo = new THREE.PlaneGeometry(900, 900, 150, 150);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 200);
    // (no depth writing: things under the surface, like fish, are drawn after the water and show through it)
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.16, metalness: 0.0, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `uniform float uTime; uniform mat4 uReflMatrix; uniform sampler2D uHeightTex; uniform vec4 uMap;
        varying vec4 vReflUv; varying vec3 vSeaW;
        float seaGround(vec2 xz) {
          vec2 uv = (xz - uMap.xy) / uMap.z;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -14.0;
          return texture2D(uHeightTex, uv).r;
        }
        ` + shader.vertexShader.replace('#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vec4 seaW = modelMatrix * vec4(position, 1.0);
         // waves calm down toward the shore, and flatten far out (where the mesh is coarse)
         float seaAmp = clamp(-seaGround(seaW.xz) / 3.0, 0.12, 1.0) * (1.0 - smoothstep(300.0, 420.0, length(seaW.xz - vec2(0.0, 200.0))));
         float a1 = seaW.x * 0.21 + uTime * 0.9, a2 = seaW.z * 0.17 - uTime * 0.7, a3 = (seaW.x + seaW.z) * 0.37 + uTime * 1.3;
         float seaH = (sin(a1) * 0.16 + sin(a2) * 0.14 + sin(a3) * 0.07) * seaAmp;
         float seaDx = (cos(a1) * 0.16 * 0.21 + cos(a3) * 0.07 * 0.37) * seaAmp, seaDz = (cos(a2) * 0.14 * 0.17 + cos(a3) * 0.07 * 0.37) * seaAmp;
         objectNormal = normalize(vec3(-seaDx, 1.0, -seaDz));`
      ).replace('#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += seaH;
         vSeaW = vec3(seaW.x, seaH, seaW.z);
         vReflUv = uReflMatrix * (modelMatrix * vec4(transformed, 1.0));`);
      shader.fragmentShader = `uniform sampler2D uRefl, uHeightTex; uniform float uReflStrength, uRipple, uTime, uFoamK; uniform vec4 uMap;
        uniform vec3 uShallow, uMid, uDeep, uFoam; uniform vec2 uClear;
        varying vec4 vReflUv; varying vec3 vSeaW;
        float seaFoam = 0.0;
        float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y); }
        float seaGround(vec2 xz) {
          vec2 uv = (xz - uMap.xy) / uMap.z;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -14.0;
          return texture2D(uHeightTex, uv).r;
        }
        ` + shader.fragmentShader.replace('#include <color_fragment>',
        `#include <color_fragment>
         {
           float depth = vSeaW.y - seaGround(vSeaW.xz);
           float d = max(depth, 0.0);
           // colour by depth: turquoise shallows → teal → deep blue
           vec3 c = mix(uShallow, uMid, smoothstep(0.2, 5.5, d));
           c = mix(c, uDeep, smoothstep(4.5, 13.0, d));
           // clear near the shore, so the sea bed shows through
           float a = mix(uClear.x, 0.97, smoothstep(0.0, uClear.y, d));
           // foam: a fringe where the water meets rock and shore, and surf lines running in
           float n1 = wNoise(vSeaW.xz * 1.6 + vec2(uTime * 0.21, -uTime * 0.13));
           float n2 = wNoise(vSeaW.xz * 5.5 - vec2(uTime * 0.4, uTime * 0.3));
           float fringe = 1.0 - smoothstep(0.0, 0.16 + 0.34 * n1, d);
           float surf = smoothstep(0.7, 0.96, sin(d * 6.5 - uTime * 1.5 + n1 * 5.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.25, 1.7, d)) * smoothstep(0.25, 0.75, n2 + n1 * 0.4);
           seaFoam = clamp((fringe * (0.55 + 0.6 * n2) + surf * 0.8) * uFoamK, 0.0, 1.0) * smoothstep(-0.25, 0.0, depth);
           c = mix(c, uFoam, seaFoam);
           a = max(a, seaFoam * 0.94);
           diffuseColor.rgb *= c;
           diffuseColor.a = a;
         }`
      ).replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = mix(roughnessFactor, 0.9, seaFoam);`
      ).replace('#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           // ripples: two drifting layers of small waves tip the surface, so it catches the sun
           vec2 p1 = vSeaW.xz * 0.9 + vec2(uTime * 0.11, -uTime * 0.08), p2 = vSeaW.xz * 2.6 - vec2(uTime * 0.17, uTime * 0.12);
           float e = 0.12;
           vec2 g = vec2(wNoise(p1 + vec2(e, 0.0)) - wNoise(p1 - vec2(e, 0.0)), wNoise(p1 + vec2(0.0, e)) - wNoise(p1 - vec2(0.0, e))) * 0.9
                  + vec2(wNoise(p2 + vec2(e, 0.0)) - wNoise(p2 - vec2(e, 0.0)), wNoise(p2 + vec2(0.0, e)) - wNoise(p2 - vec2(0.0, e))) * 0.5;
           float fade = 1.0 - smoothstep(120.0, 420.0, length(vViewPosition));
           normal = normalize(normal - (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz * 1.5 * fade * (1.0 - seaFoam));
         }`
      ).replace('#include <opaque_fragment>',
        `if (uReflStrength > 0.0) {
           vec2 ruv = vReflUv.xy / vReflUv.w + normal.xy * uRipple;
           // tinted by the water, so the sea keeps its colour
           vec3 refl = texture2D(uRefl, ruv).rgb * mix(vec3(1.0), diffuseColor.rgb * 2.2, 0.45);
           float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
           float k = uReflStrength * mix(0.12, 0.7, fres) * (1.0 - seaFoam);
           outgoingLight = mix(outgoingLight, refl, k);
           diffuseColor.a = mix(diffuseColor.a, 1.0, k);
         }
         #include <opaque_fragment>`);
    };
    registerStyled(mat, 'water');
    this.material = mat;
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.water.renderOrder = 1;
    this.group.add(this.water);
    // the open sea beyond the animated patch, out to the horizon (same water, calm and flat)
    const far = new THREE.Mesh(new THREE.RingGeometry(425, 2600, 64, 4).rotateX(-Math.PI / 2).translate(0, -0.1, 200), mat);
    far.renderOrder = 1;
    this.farSea = far;
    this.group.add(far);

    this._buildBoats();
    this._buildRowboat();
    this._buildSailboat();
  }

  /** Bake the ground heights (plus any boulders standing in the water) into the depth texture. */
  syncHeights(scenery = null) {
    const t = this.terrain, n = t.FV, toHalf = THREE.DataUtils.toHalfFloat;
    const h = Float32Array.from(t.hf);
    if (scenery && scenery.items && scenery.items.boulder) {
      for (const b of scenery.items.boulder) {
        const r = Math.max(b.sx, b.sz), top = b.y + b.sy * 0.75;
        if (top < -0.6 || b.y > 3) continue;
        const i0 = Math.floor((b.x - r + t.half) / t.fcell), i1 = Math.ceil((b.x + r + t.half) / t.fcell);
        const j0 = Math.floor((b.z - r + t.half) / t.fcell), j1 = Math.ceil((b.z + r + t.half) / t.fcell);
        for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
          const d = Math.hypot(i * t.fcell - t.half - b.x, j * t.fcell - t.half - b.z) / r;
          if (d < 1) h[j * n + i] = Math.max(h[j * n + i], top * (1 - d * d * 0.6));
        }
      }
    }
    for (let k = 0; k < h.length; k++) this.heightData[k] = toHalf(h[k]);
    this.heightTex.needsUpdate = true;
  }

  _buildBoats() {
    const t = this.terrain, h = t.harbour;
    const rng = makeRng(t.seed * 7 + 3);
    const lay = harbourLayout(t);
    const hull = gozzoHull();
    const inner = new THREE.BoxGeometry(0.95, 0.06, 2.4).translate(0, 0.2, 0);
    // a painted band round the top of the hull
    const band = gozzoHull().scale(1.06, 0.2, 1.012).translate(0, 0.15, 0);

    const spots = [];
    // Fishing boats moored off the harbour, each lying to its buoy.
    for (let k = 0; k < 60 && spots.length < CONFIG.water.mooredBoats; k++) {
      const ang = rng.range(-1.1, 1.1);
      const r = rng.range(9, 26);
      const x = h.x + Math.sin(ang) * r * 1.3, z = h.z + 4 + Math.cos(ang) * r * 0.8;
      if (t.heightAt(x, z) > -0.8) continue;
      if (Math.abs(x - lay.slipX) < 3 && z < t.coastZ(x) + 6) continue; // keep the slipway clear
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3.6)) continue;
      // bows point roughly out to sea, the way boats lie to a mooring in a light breeze
      spots.push({ x, z, rot: Math.PI + rng.range(-0.45, 0.45) + ang * 0.25, phase: rng() * 6 });
    }
    // Two boats hauled up on the slipway.
    for (let k = 0; k < 2; k++) spots.push({ x: lay.slipX + (k ? 0.8 : -0.6), z: lay.slipZ0 + 2.5 + k * 4, rot: k ? 0.08 : -0.05, phase: 0, beached: true });

    const C = (hex) => new THREE.Color(hex);
    const hullCols = [[C('#f2efe6'), 5], [C('#3f7fc4'), 1.6], [C('#5ab0d8'), 1.2], [C('#d64a3b'), 0.8], [C('#3b9c6b'), 0.6], [C('#e8c14a'), 0.5]];
    const bandCols = [C('#2f6fb0'), C('#c8473a'), C('#2f8a5b'), C('#e2b93a'), C('#f2efe6'), C('#1f3f66')];
    const hullMat = registerStyled(new THREE.MeshStandardMaterial({ roughness: 0.6 }), 'surface');
    const innerMat = new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.9 });
    this.boats = new THREE.InstancedMesh(hull, hullMat, spots.length);
    this.boatBands = new THREE.InstancedMesh(band, hullMat, spots.length);
    this.boatInner = new THREE.InstancedMesh(inner, innerMat, spots.length);
    this.boats.castShadow = true;
    spots.forEach((s, i) => { this.boats.setColorAt(i, rng.weighted(hullCols)); this.boatBands.setColorAt(i, rng.pick(bandCols)); });
    this.spots = spots;
    // mooring buoys: an orange (or white) ball off each boat's bow
    const moored = spots.filter((s) => !s.beached);
    this.buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.6 }), moored.length);
    this.buoySpots = moored.map((s, i) => {
      this.buoys.setColorAt(i, rng() < 0.8 ? C('#e8502a') : C('#f2efe6'));
      return { x: s.x + Math.sin(s.rot) * 3.2, z: s.z + Math.cos(s.rot) * 3.2, phase: s.phase + 1.3 };
    });
    for (const m of [this.boats, this.boatBands, this.boatInner, this.buoys]) m.frustumCulled = false;
    this.group.add(this.boats, this.boatBands, this.boatInner, this.buoys);
  }

  /** One boat being rowed out round the harbour and back. */
  _buildRowboat() {
    const g = new THREE.Group(), M = (c, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    g.add(new THREE.Mesh(gozzoHull(), M('#f2efe6', 0.6)));
    g.add(new THREE.Mesh(gozzoHull().scale(1.06, 0.2, 1.012).translate(0, 0.15, 0), M('#2f6fb0', 0.6)));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 2.4).translate(0, 0.2, 0), M('#c9a77a', 0.9)));
    // the rower: sits facing the stern, leans with each stroke
    const rower = new THREE.Group();
    rower.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.28).translate(0, 0.58, 0), M('#3d5a80')));
    rower.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6).translate(0, 1.0, 0), M('#d9a47a')));
    rower.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 8).translate(0, 1.13, 0), M('#e8dcb8')));   // straw hat
    rower.position.set(0, 0.05, -0.2);
    g.add(rower);
    const oars = [-1, 1].map((s) => {
      const o = new THREE.Group();
      o.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.05).translate(s * 0.95, 0, 0), M('#b08d62')));
      o.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.16).translate(s * 2.1, 0, 0), M('#b08d62')));
      o.position.set(s * 0.55, 0.52, 0.1);
      g.add(o);
      return { o, s };
    });
    this.rowboat = { group: g, rower, oars, route: rowingRoute(this.terrain), u: 0.05 };
    this.rowboat.length = this.rowboat.route.getLength();
    this.group.add(g);
  }

  /** A sailboat that crosses the horizon now and then. */
  _buildSailboat() {
    const g = new THREE.Group(), M = (c, side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side });
    g.add(new THREE.Mesh(gozzoHull().scale(2.4, 2.0, 2.6), M('#f4f1ea')));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 11, 6).translate(0, 5.8, 0.4), M('#8a6a48')));
    const sail = (pts) => { const s = new THREE.BufferGeometry(); s.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); s.computeVertexNormals(); return s; };
    g.add(new THREE.Mesh(sail([0.05, 1.4, 0.3, 0.05, 10.8, 0.4, 0.5, 1.6, -4.2]), M('#f7f3e8', THREE.DoubleSide)));   // mainsail
    g.add(new THREE.Mesh(sail([0, 1.2, 0.7, 0, 9.6, 0.5, -0.3, 1.2, 4.6]), M('#efe9da', THREE.DoubleSide)));          // jib
    g.visible = false;
    this.sailboat = { group: g, t: CONFIG.water.sailFirst, dir: 1, sailing: false, x: 0 };
    this.group.add(g);
  }

  update(time, dt = 0) {
    this.uniforms.uTime.value = time;
    const W = CONFIG.water;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    this.spots.forEach((s, i) => {
      const bob = s.beached ? 0 : Math.sin(time * 1.1 + s.phase) * 0.08;
      const roll = s.beached ? 0.12 : Math.sin(time * 0.9 + s.phase) * 0.07;
      const y = s.beached ? this.terrain.heightAt(s.x, s.z) + 0.25 : 0.07 + bob;
      // moored boats swing a little round their buoys
      const swing = s.beached ? 0 : Math.sin(time * 0.13 + s.phase * 2.0) * 0.12;
      e.set(Math.sin(time * 0.7 + s.phase) * 0.035, s.rot + swing, roll);
      q.setFromEuler(e); pos.set(s.x, y, s.z);
      m.compose(pos, q, one);
      this.boats.setMatrixAt(i, m); this.boatInner.setMatrixAt(i, m); this.boatBands.setMatrixAt(i, m);
    });
    this.buoySpots.forEach((s, i) => {
      m.makeTranslation(s.x, 0.02 + Math.sin(time * 1.3 + s.phase) * 0.06, s.z);
      this.buoys.setMatrixAt(i, m);
    });
    for (const im of [this.boats, this.boatInner, this.boatBands, this.buoys]) im.instanceMatrix.needsUpdate = true;

    // the rowing boat: along its route, oars sweeping
    const R = this.rowboat;
    R.u = (R.u + (W.rowSpeed * dt) / R.length) % 1;
    const p = R.route.getPointAt(R.u), tan = R.route.getTangentAt(R.u);
    const stroke = time * W.rowStroke;
    R.group.position.set(p.x, 0.07 + Math.sin(time * 1.1) * 0.05, p.z);
    R.group.rotation.set(Math.sin(stroke) * 0.03, Math.atan2(tan.x, tan.z), Math.sin(time * 0.9) * 0.04);
    R.rower.rotation.x = -Math.sin(stroke) * 0.3;
    for (const { o, s } of R.oars) o.rotation.set(0, Math.sin(stroke) * 0.55 * s, (0.16 + Math.max(0, Math.cos(stroke)) * 0.22) * -s);

    // the sailboat: crosses the horizon, then stays away for a while
    const S = this.sailboat;
    if (!S.sailing) {
      S.t -= dt;
      if (S.t <= 0) { S.sailing = true; S.dir = -S.dir; S.x = -S.dir * W.sailSpan; S.group.visible = true; }
    } else {
      S.x += S.dir * W.sailSpeed * dt;
      const z = this.terrain.harbour.z + W.sailDistance + Math.sin(S.x * 0.004) * 40;
      S.group.position.set(this.terrain.harbour.x + S.x, 0.3 + Math.sin(time * 0.6) * 0.15, z);
      S.group.rotation.set(0, S.dir > 0 ? Math.PI / 2 : -Math.PI / 2, Math.sin(time * 0.5) * 0.04 + 0.08 * S.dir);
      if (Math.abs(S.x) > W.sailSpan) { S.sailing = false; S.group.visible = false; S.t = W.sailEvery[0] + Math.random() * (W.sailEvery[1] - W.sailEvery[0]); }
    }
  }
}

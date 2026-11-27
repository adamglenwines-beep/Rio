// ---------------------------------------------------------------------------
// water.js — the sea (gently animated low-poly waves) and moored fishing boats.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeRng } from './noise.js';
import { harbourLayout } from './paths.js';
import { registerStyled } from './style.js';

export class Sea {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.uniforms = {
      uTime: { value: 0 },
      // planar reflection (filled in by gfx.js on Medium/High; strength 0 = off)
      uRefl: { value: null }, uReflMatrix: { value: new THREE.Matrix4() }, uReflStrength: { value: 0 }, uRipple: { value: 0.035 },
    };

    // Faceted water: the waves are computed in the vertex shader and
    // flatShading derives a normal per triangle, so it sparkles low-poly style.
    const geo = new THREE.PlaneGeometry(900, 900, 150, 150).toNonIndexed();
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 200);
    const mat = new THREE.MeshStandardMaterial({
      color: '#1d7aa6', roughness: 0.25, metalness: 0.05,
      transparent: true, opacity: 0.82, flatShading: true,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      // reflections: project the wavy surface into the mirrored render, nudged by
      // the facet normals (ripples), and blend more at grazing angles (Fresnel)
      shader.fragmentShader = 'uniform sampler2D uRefl;\nuniform float uReflStrength, uRipple;\nvarying vec4 vReflUv;\n' + shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `if (uReflStrength > 0.0) {
           vec2 ruv = vReflUv.xy / vReflUv.w + normal.xy * uRipple;
           // tinted by the water, so the stylised blue sea stays blue
           vec3 refl = texture2D(uRefl, ruv).rgb * mix(vec3(1.0), diffuseColor.rgb * 2.2, 0.45);
           float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
           float k = uReflStrength * mix(0.12, 0.7, fres);
           outgoingLight = mix(outgoingLight, refl, k);
           diffuseColor.a = mix(diffuseColor.a, 1.0, k);
         }
         #include <opaque_fragment>`);
      shader.vertexShader = 'uniform float uTime;\nuniform mat4 uReflMatrix;\nvarying vec4 vReflUv;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 wp = modelMatrix * vec4(position, 1.0);
         float w = sin(wp.x * 0.21 + uTime * 0.9) * 0.16
                 + sin(wp.z * 0.17 - uTime * 0.7) * 0.14
                 + sin((wp.x + wp.z) * 0.37 + uTime * 1.3) * 0.07;
         transformed.y += w;
         vReflUv = uReflMatrix * (modelMatrix * vec4(transformed, 1.0));`
      );
    };
    registerStyled(mat, 'water');
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.water.renderOrder = 1;
    this.group.add(this.water);
    // the open sea beyond the animated patch, out to the horizon (calm and flat)
    const far = new THREE.Mesh(new THREE.RingGeometry(430, 2400, 48, 1).rotateX(-Math.PI / 2).translate(0, -0.12, 200),
      new THREE.MeshStandardMaterial({ color: '#1d7aa6', roughness: 0.3, metalness: 0.05 }));
    far.receiveShadow = false;
    this.farSea = far;
    this.group.add(far);

    this._buildBoats();
  }

  _buildBoats() {
    const t = this.terrain, h = t.harbour;
    const rng = makeRng(t.seed * 7 + 3);
    const lay = harbourLayout(t);

    // Hull: a box with pinched, raised ends — a little gozzo fishing boat.
    const hull = new THREE.BoxGeometry(1.3, 0.55, 3.6, 1, 1, 4);
    const p = hull.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), y = p.getY(i);
      const end = Math.abs(z) / 1.8;               // 0 middle → 1 bow/stern
      p.setX(i, p.getX(i) * (1 - 0.75 * end * end) * (y < 0 ? 0.75 : 1));
      p.setY(i, y + (y > 0 ? 0.25 * end * end : 0));
    }
    hull.computeVertexNormals();
    const inner = new THREE.BoxGeometry(0.95, 0.06, 2.4);
    inner.translate(0, 0.22, 0);

    const spots = [];
    // Fan of boats moored off the harbour, like the reference photo.
    for (let k = 0; k < 40 && spots.length < 14; k++) {
      const ang = rng.range(-1.1, 1.1);
      const r = rng.range(9, 26);
      const x = h.x + Math.sin(ang) * r * 1.3, z = h.z + 4 + Math.cos(ang) * r * 0.8;
      if (t.heightAt(x, z) > -0.6) continue;
      if (Math.abs(x - lay.slipX) < 3 && z < t.coastZ(x) + 6) continue; // keep the slipway clear
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3.2)) continue;
      spots.push({ x, z, rot: ang * 0.6 + rng.range(-0.3, 0.3), phase: rng() * 6 });
    }
    // Two boats hauled up on the harbour floor.
    // Two boats hauled up on the slipway.
    for (let k = 0; k < 2; k++) spots.push({ x: lay.slipX + (k ? 0.8 : -0.6), z: lay.slipZ0 + 2.5 + k * 4, rot: k ? 0.08 : -0.05, phase: 0, beached: true });

    const hullColours = ['#f4f1e8', '#2f7fbf', '#d64a3b', '#f2c94c', '#3b9c6b', '#e7e3d6', '#5aa6d6'];
    const hullMat = registerStyled(new THREE.MeshStandardMaterial({ roughness: 0.6 }), 'surface');
    const innerMat = new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.9 });
    this.boats = new THREE.InstancedMesh(hull, hullMat, spots.length);
    this.boatInner = new THREE.InstancedMesh(inner, innerMat, spots.length);
    this.boats.castShadow = true;
    const c = new THREE.Color();
    spots.forEach((s, i) => { c.set(rng.pick(hullColours)); this.boats.setColorAt(i, c); });
    this.spots = spots;
    this.group.add(this.boats, this.boatInner);
    this.update(0);
  }

  update(time) {
    this.uniforms.uTime.value = time;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    this.spots.forEach((s, i) => {
      const bob = s.beached ? 0 : Math.sin(time * 1.1 + s.phase) * 0.08;
      const roll = s.beached ? 0.12 : Math.sin(time * 0.9 + s.phase) * 0.06;
      const y = s.beached ? this.terrain.heightAt(s.x, s.z) + 0.25 : 0.05 + bob;
      e.set(Math.sin(time * 0.7 + s.phase) * 0.03, s.rot, roll);
      q.setFromEuler(e); pos.set(s.x, y, s.z);
      m.compose(pos, q, one);
      this.boats.setMatrixAt(i, m); this.boatInner.setMatrixAt(i, m);
    });
    this.boats.instanceMatrix.needsUpdate = true;
    this.boatInner.instanceMatrix.needsUpdate = true;
  }
}

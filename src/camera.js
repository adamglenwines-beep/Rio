// ---------------------------------------------------------------------------
// camera.js — orbit camera that never dips into the hillside, works with
// mouse and touch, and can glide to a "postcard" view from the water.
//
//   Mouse : left-drag rotate · right-drag pan · wheel zoom
//   Touch : one finger rotate · two fingers pinch-zoom + pan
// When a painting tool is active, one finger/left button paints instead, so
// rotation moves to the right mouse button (touch: switch to View tool).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
  constructor(camera, dom, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    const c = (this.controls = new OrbitControls(camera, dom));
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.minDistance = 12;
    c.maxDistance = 330;
    c.maxPolarAngle = Math.PI * 0.47;   // never look up from under the horizon
    c.screenSpacePanning = false;       // pan along the ground, not the screen
    c.zoomToCursor = true;
    c.rotateSpeed = 0.6;
    this.setPaintMode(false);
    this.tween = null;
  }

  /** In paint mode a single finger / left button belongs to the tool. */
  setPaintMode(on) {
    const c = this.controls;
    c.mouseButtons = on
      ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = on
      ? { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN }
      : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }

  /** The postcard: from out on the water, slightly to the side, like the photo. */
  postcard(instant = false) {
    const h = this.terrain.harbour;
    const target = new THREE.Vector3(h.x - 12, 13, h.z - 28);
    // From the water off the eastern headland (like the photo). On a tall
    // phone screen, swing round to face the cove more squarely from the sea
    // so stepping back doesn't put the headland in the way.
    const portrait = this.camera.aspect < 1;
    const pos = portrait ? new THREE.Vector3(h.x + 24, 25, h.z + 40) : new THREE.Vector3(h.x + 60, 33, h.z + 28);
    this._fitAspect(pos, target);
    this.flyTo(pos, target, instant ? 0 : 1.6);
  }

  overview(instant = false) {
    const h = this.terrain.harbour;
    const pos = new THREE.Vector3(h.x + 85, 120, h.z + 95), target = new THREE.Vector3(h.x - 5, 10, h.z - 40);
    this._fitAspect(pos, target);
    this.flyTo(pos, target, instant ? 0 : 1.6);
  }

  /** On a tall phone screen, step back so the same scene still fits the width. */
  _fitAspect(pos, target) {
    const k = Math.pow(Math.max(1, 1.3 / this.camera.aspect), 0.55);
    pos.sub(target).multiplyScalar(k).add(target);
  }

  flyTo(pos, target, seconds) {
    if (seconds <= 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = {
      p0: this.camera.position.clone(), t0: this.controls.target.clone(),
      p1: pos, t1: target, time: 0, dur: seconds,
    };
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.time += dt;
      const k = Math.min(tw.time / tw.dur, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out
      this.camera.position.lerpVectors(tw.p0, tw.p1, e);
      // lift the path a little so the flight arcs over the hills
      this.camera.position.y += Math.sin(Math.PI * e) * 25;
      this.controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    this._keepAboveGround();
  }

  _keepAboveGround() {
    const t = this.terrain, cam = this.camera.position, tgt = this.controls.target;
    // keep the pivot inside the map and on/above the ground
    const lim = t.half - 5;
    tgt.x = THREE.MathUtils.clamp(tgt.x, -lim, lim);
    tgt.z = THREE.MathUtils.clamp(tgt.z, -lim, lim + 60);
    const gy = t.surfaceAt(tgt.x, tgt.z);
    if (tgt.y < gy) tgt.y = gy;
    // keep the camera above the highest ground around it (a small ring, so
    // the near plane doesn't slice into a slope right beside the lens)
    let ground = t.surfaceAt(cam.x, cam.z);
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      ground = Math.max(ground, t.surfaceAt(cam.x + Math.cos(ang) * 3, cam.z + Math.sin(ang) * 3));
    }
    const minY = ground + 3;
    if (cam.y < minY) cam.y = minY;
  }
}

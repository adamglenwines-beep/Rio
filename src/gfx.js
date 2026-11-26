// ---------------------------------------------------------------------------
// gfx.js — lighting, sky, time of day, quality presets and the render pipeline.
//
// Quality presets (Low / Medium / High) decide resolution and which effects run;
// Auto picks one from the device and steps down (then lowers the resolution)
// if the frame rate stays low. Every effect reads its settings from the preset.
//
// Time of day is a continuous hour (12 = midday … 23 = night). Presets glide to
// a target hour over a couple of seconds, so lights and lit windows fade.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CONFIG } from './config.js';

// ---- quality presets ------------------------------------------------------------
export const PRESETS = {
  low:    { label: 'Low',    pixelRatio: 1.0, post: false, msaa: 0, bloom: 0,   shadowSize: 1024, shadowSoft: false, ssao: false, reflection: 0,    haze: true },
  medium: { label: 'Medium', pixelRatio: 1.5, post: true,  msaa: 4, bloom: 0.5, shadowSize: 2048, shadowSoft: true,  ssao: false, reflection: 0.25, haze: true },
  high:   { label: 'High',   pixelRatio: 2.0, post: true,  msaa: 4, bloom: 1.0, shadowSize: 4096, shadowSoft: true,  ssao: true,  reflection: 0.5,  haze: true },
};
const ORDER = ['low', 'medium', 'high'];

// ---- time of day ------------------------------------------------------------------
// Keyframes by hour; everything in between is interpolated.
export const TIMES = { midday: 12, golden: 18.6, dusk: 20.4, night: 23 };
const KEYS = [
  { h: 12, elev: 62, az: 35, sun: '#fff6e8', sunI: 3.0, sky: '#e6f4ff', ground: '#9a8466', hemiI: 1.5,
    top: '#3f97d6', hor: '#cfe7f2', glow: '#fff4dc', glowI: 0.6, fog: '#cfe7f2', exp: 1.1, lit: 0 },
  { h: 18.6, elev: 14, az: 40, sun: '#ffcf94', sunI: 3.3, sky: '#ffe9d2', ground: '#9a7a5c', hemiI: 1.4,
    top: '#5b93d4', hor: '#ffd2a6', glow: '#ffb878', glowI: 2.2, fog: '#f2d2b2', exp: 1.15, lit: 0.06 },
  { h: 20.4, elev: 7, az: 75, sun: '#ff9a7a', sunI: 0.35, sky: '#8a7fb8', ground: '#3d3550', hemiI: 0.95,
    top: '#1e2f5e', hor: '#e48a6f', glow: '#ff8a60', glowI: 1.4, fog: '#8f6f86', exp: 1.3, lit: 0.35 },
  { h: 23, elev: 40, az: -30, sun: '#9fb6ff', sunI: 0.5, sky: '#3a4a78', ground: '#1c1c2a', hemiI: 0.75,
    top: '#070d22', hor: '#1d2a4a', glow: '#8fa6e0', glowI: 0.25, fog: '#141d33', exp: 1.4, lit: 0.5 },
];

export class Graphics {
  constructor(game, renderer, scene, camera) {
    this.game = game; this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.hour = TIMES.golden; this.targetHour = this.hour;
    this.resolution = 1;           // extra scale on top of the preset (Auto lowers it if needed)
    this.mode = 'auto';            // 'auto' or a preset name
    this.preset = null;
    this.listeners = [];

    // lights
    this.hemi = new THREE.HemisphereLight('#e6f4ff', '#9a8466', 1.5);
    this.sun = new THREE.DirectionalLight('#fff0d4', 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.camera.layers.enableAll();
    scene.add(this.hemi, this.sun, this.sun.target);

    // sky dome: vertical gradient + a soft glow around the sun (bright enough to bloom)
    this.skyU = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
      uGlowI: { value: 1 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 uTop, uHor, uGlow; uniform float uGlowI; uniform vec3 uSunDir; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = clamp(d.y / 0.42, 0.0, 1.0);
          vec3 c = mix(uHor, uTop, pow(t, 0.75));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          c += uGlow * uGlowI * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.8 + pow(s, 900.0) * 3.0);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
    this.sky.scale.setScalar(1500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    scene.background = null;
    scene.fog = new THREE.Fog('#cfe7f2', 260, 720);

    this._fps = { t: 0, frames: 0, slow: 0, cooldown: 3, fps: 60 };
    this._shadowTimer = 0;
    this.setPreset(this._loadSetting('mode', 'auto'));
    this.resolution = +this._loadSetting('res', 1) || 1;
    this._applyTime(this.hour);
  }

  // ---- settings -------------------------------------------------------------------

  _loadSetting(k, d) { try { return localStorage.getItem('borgo.' + k) ?? d; } catch { return d; } }
  _saveSetting(k, v) { try { localStorage.setItem('borgo.' + k, v); } catch { /* private mode */ } }
  onChange(fn) { this.listeners.push(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  /** A sensible first guess for Auto, from the device. */
  autoGuess() {
    const touch = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    if (touch) return cores >= 8 ? 'medium' : 'low';
    return cores >= 8 ? 'high' : 'medium';
  }

  /** 'auto', 'low', 'medium' or 'high'. */
  setPreset(mode) {
    this.mode = PRESETS[mode] ? mode : 'auto';
    this._saveSetting('mode', this.mode);
    const name = this.mode === 'auto' ? this.autoGuess() : this.mode;
    if (this.mode !== 'auto') this._fps.slow = 0;
    this._use(name);
  }

  setResolution(scale) {
    this.resolution = scale;
    this._saveSetting('res', scale);
    this._applySize();
    this._emit();
  }

  _use(name) {
    this.presetName = name;
    this.preset = PRESETS[name];
    const r = this.renderer, P = this.preset;
    // shadows: map size and filtering (a filter change needs shaders recompiled)
    const type = P.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (r.shadowMap.type !== type) {
      r.shadowMap.type = type;
      this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    if (this.sun.shadow.mapSize.x !== P.shadowSize) {
      this.sun.shadow.mapSize.set(P.shadowSize, P.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this._applySize();
    this._buildPipeline();
    this._fps.cooldown = 3;
    this._emit();
  }

  /**
   * The post-processing chain for this preset. Low draws straight to the screen
   * (the canvas's own 4x multisampling smooths the edges). Medium and High
   * render into a high-dynamic-range target with 4x multisampling — so edges
   * stay smooth through the effects — then the effects, then tone mapping.
   */
  _buildPipeline() {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    this.bloom = null; this.ssao = null;
    const P = this.preset;
    if (!P.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: P.msaa });
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    c.setPixelRatio(this.renderer.getPixelRatio());
    c.setSize(innerWidth, innerHeight);
    c.addPass(new RenderPass(this.scene, this.camera));
    this._addEffects(c);
    c.addPass(new OutputPass());
  }

  /** Effects between the scene render and tone mapping. */
  _addEffects(c) {
    const P = this.preset, G = CONFIG.graphics;
    if (P.ssao) {
      // screen-space ambient occlusion (High only: it re-renders depth and normals)
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: G.ssaoRadius, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
      ao.blendIntensity = G.ssaoIntensity;
      c.addPass(ao);
      this.ssao = ao;
    }
    if (P.bloom > 0) {
      // only things brighter than a sunlit wall glow: the sun, its glints, lit windows
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), G.bloomStrength, G.bloomRadius, G.bloomThreshold);
      const setSize = bloom.setSize.bind(bloom);
      bloom.setSize = (w, h) => setSize(Math.max(1, Math.round(w * P.bloom)), Math.max(1, Math.round(h * P.bloom)));
      c.addPass(bloom);
      this.bloom = bloom;
    }
  }

  _applySize() {
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.resolution;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.pixelRatio = pr;
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(innerWidth, innerHeight); }
  }

  resize() { this._applySize(); }

  // ---- time of day ------------------------------------------------------------------

  /** A name from TIMES or an hour; glides there unless `instant`. */
  setTimeOfDay(t, instant = false) {
    const h = typeof t === 'number' ? t : TIMES[t] ?? TIMES.golden;
    this.targetHour = h;
    this.timeName = typeof t === 'string' ? t : null;
    if (instant) { this.hour = h; this._applyTime(h); }
    this._emit();
  }

  _key(h) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i + 1 < KEYS.length; i++) if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    if (h <= KEYS[0].h) a = b = KEYS[0];
    if (h >= KEYS[KEYS.length - 1].h) a = b = KEYS[KEYS.length - 1];
    const k = a === b ? 0 : (h - a.h) / (b.h - a.h);
    return { a, b, k };
  }

  _applyTime(h) {
    const { a, b, k } = this._key(h);
    const L = (p) => a[p] + (b[p] - a[p]) * k;
    const C = (p) => new THREE.Color(a[p]).lerp(new THREE.Color(b[p]), k);
    this.tod = { hour: h, lit: L('lit'), fog: C('fog'), hor: C('hor'), night: THREE.MathUtils.smoothstep(h, 19.5, 22) };
    const elev = THREE.MathUtils.degToRad(L('elev')), az = THREE.MathUtils.degToRad(L('az'));
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
    this.sun.color.copy(C('sun')); this.sun.intensity = L('sunI');
    this.hemi.color.copy(C('sky')); this.hemi.groundColor.copy(C('ground')); this.hemi.intensity = L('hemiI');
    this.skyU.uTop.value.copy(C('top')); this.skyU.uHor.value.copy(C('hor'));
    this.skyU.uGlow.value.copy(C('glow')); this.skyU.uGlowI.value = L('glowI');
    // the visible sun sits a little lower than the light (so golden-hour shadows stay readable)
    this.skyU.uSunDir.value.copy(this.sunDir).setY(this.sunDir.y * 0.45).normalize();
    this.scene.fog.color.copy(C('fog'));
    this.renderer.toneMappingExposure = L('exp');
    this._fitShadow(true);
    for (const fn of this.listeners) if (fn.onTime) fn.onTime(this.tod);
  }

  // ---- shadows: one map fitted tightly around the town ----------------------------------

  _fitShadow(force = false) {
    const G = this.game.growth, t = this.game.terrain, h = t.harbour;
    let x0 = h.x - 30, x1 = h.x + 30, z0 = h.z - 40, z1 = h.z + 12, y0 = -2, y1 = 30;
    if (G) for (const id of G.live) {
      const b = G.buildings[id];
      for (const p of b.corners) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      y1 = Math.max(y1, (b.top || b.gMax) + 3);
    }
    const m = 12; x0 -= m; x1 += m; z0 -= m; z1 += m;
    const key = [x0, x1, z0, z1, y1].map((v) => Math.round(v / 4)).join(',') + this.sunDir.toArray().map((v) => v.toFixed(3)).join(',');
    if (!force && key === this._shadowKey) return;
    this._shadowKey = key;
    const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 400);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position); cam.lookAt(c); cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let l = Infinity, r = -Infinity, b = Infinity, tp = -Infinity, n = Infinity, f = -Infinity;
    const v = new THREE.Vector3();
    for (const X of [x0, x1]) for (const Y of [y0, y1]) for (const Z of [z0, z1]) {
      v.set(X, Y, Z).applyMatrix4(inv);
      l = Math.min(l, v.x); r = Math.max(r, v.x); b = Math.min(b, v.y); tp = Math.max(tp, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    Object.assign(cam, { left: l, right: r, bottom: b, top: tp, near: Math.max(1, n - 60), far: f + 60 });
    cam.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  // ---- per frame ----------------------------------------------------------------------

  update(dt) {
    // glide toward the target time
    if (Math.abs(this.targetHour - this.hour) > 1e-3) {
      const step = Math.sign(this.targetHour - this.hour) * Math.max(dt * 4.5, Math.abs(this.targetHour - this.hour) * dt * 2.2);
      this.hour = Math.abs(step) >= Math.abs(this.targetHour - this.hour) ? this.targetHour : this.hour + step;
      this._applyTime(this.hour);
    }
    this.sky.position.copy(this.camera.position);
    this._shadowTimer -= dt;
    if (this._shadowTimer <= 0) { this._shadowTimer = 0.5; this._fitShadow(); }
    this._autoQuality(dt);
  }

  /** Auto: if the frame rate stays low, step down a preset, then lower the resolution. */
  _autoQuality(dt) {
    const F = this._fps;
    if (dt <= 0 || dt > 0.5 || document.hidden) return;
    F.t += dt; F.frames++;
    if (F.t < 2) return;
    F.fps = F.frames / F.t; F.t = 0; F.frames = 0;
    this._emit();
    if (this.mode !== 'auto') return;
    if (F.cooldown > 0) { F.cooldown -= 2; return; }
    F.slow = F.fps < CONFIG.graphics.autoMinFps ? F.slow + 1 : 0;
    if (F.slow < 2) return;
    F.slow = 0;
    const i = ORDER.indexOf(this.presetName);
    if (i > 0) this._use(ORDER[i - 1]);
    else if (this.resolution > CONFIG.graphics.autoMinResolution + 0.01) {
      this.resolution = Math.max(CONFIG.graphics.autoMinResolution, +(this.resolution - 0.15).toFixed(2));
      this._applySize(); this._emit(); F.cooldown = 3;
    }
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

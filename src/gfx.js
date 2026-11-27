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
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { STYLES } from './style.js';
import { loadTextures, matUniforms } from './materials.js';
import { AutoQuality } from './autoquality.js';

// Colour grade (linear HDR, before tone mapping): white balance for Warmth,
// and per-style saturation and contrast.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uWB: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uWB; uniform float uSat, uContrast; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWB;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = 0.18 * pow(max(col, 0.0) / 0.18, vec3(uContrast));
      gl_FragColor = vec4(col, c.a);
    }`,
};
const WARMTH = {
  cool:    { k: -1, sun: '#dbe6ff', sky: '#9fc7ef' },
  neutral: { k: 0 },
  warm:    { k: 1, sun: '#ffc68a', sky: '#ffd2a8' },
};
import { CONFIG } from './config.js';

// ---- distance haze ---------------------------------------------------------------
// Three's fog, reshaped for an atmosphere: it thickens smoothly with distance and
// is densest near sea level, thinning up the hillsides. The colour follows the
// time of day (scene.fog.color). Patched once, before any material compiles.
{
  const H = CONFIG.graphics;
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying float vFogY;\n#endif';
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
    vFogDepth = - mvPosition.z;
    vFogY = (vec4(mvPosition.xyz - viewMatrix[3].xyz, 0.0) * viewMatrix).y;   // world height
  #endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor; varying float vFogDepth; varying float vFogY;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear; uniform float fogFar;
    #endif
  #endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    float fogT = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    float fogFactor = 1.0 - exp(-${H.hazeDensity.toFixed(2)} * fogT * fogT);
    fogFactor *= mix(${H.hazeHighFactor.toFixed(2)}, 1.0, exp(-max(vFogY, 0.0) / ${H.hazeFalloff.toFixed(1)}));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
  #endif`;
}

// ---- quality presets ------------------------------------------------------------
export const PRESETS = {
  low:    { label: 'Low',    pixelRatio: 1.0, post: false, msaa: 0, bloom: 0,   shadowSize: 1024, shadowSoft: false, ssao: false, reflection: 0,    haze: true, tex: 512, aniso: 1, macro: 0 },
  medium: { label: 'Medium', pixelRatio: 1.5, post: true,  msaa: 4, bloom: 0.5, shadowSize: 2048, shadowSoft: true,  ssao: false, reflection: 0.25, haze: true, tex: 1024, aniso: 4, macro: 1 },
  high:   { label: 'High',   pixelRatio: 2.0, post: true,  msaa: 4, bloom: 1.0, shadowSize: 4096, shadowSoft: true,  ssao: true,  reflection: 0.5,  haze: true, tex: 1024, aniso: 8, macro: 1 },
};
// Auto's ladder, best first: each rung is a preset plus an extra resolution scale.
const LADDER = [
  { preset: 'high', scale: 1 }, { preset: 'medium', scale: 1 }, { preset: 'low', scale: 1 },
  { preset: 'low', scale: 0.85 }, { preset: 'low', scale: 0.7 }, { preset: 'low', scale: 0.6 },
];

// ---- time of day ------------------------------------------------------------------
// Keyframes by hour; everything in between is interpolated.
export const TIMES = { midday: 12, golden: 18.6, dusk: 20.4, night: 23 };
const KEYS = [
  { h: 12, elev: 50, az: 35, sun: '#fff7ea', sunI: 3.35, sky: '#e2f0ff', ground: '#9a8a70', hemiI: 1.5,
    top: '#2a7fd0', hor: '#bcdcf4', glow: '#fff6e6', glowI: 0.6, fog: '#bcd6ec', exp: 1.14, lit: 0 },
  { h: 18.6, elev: 14, az: 40, sun: '#ffdcb6', sunI: 3.2, sky: '#eef0f2', ground: '#94806a', hemiI: 1.4,
    top: '#4f8fd6', hor: '#f6dcc6', glow: '#ffc79c', glowI: 2.0, fog: '#e4dad2', exp: 1.12, lit: 0.06 },
  { h: 20.4, elev: 7, az: 75, sun: '#ff9a7a', sunI: 0.35, sky: '#8a7fb8', ground: '#3d3550', hemiI: 0.95,
    top: '#1e2f5e', hor: '#e48a6f', glow: '#ff8a60', glowI: 1.4, fog: '#8f6f86', exp: 1.3, lit: 0.35 },
  { h: 23, elev: 40, az: -30, sun: '#9fb6ff', sunI: 0.5, sky: '#3a4a78', ground: '#1c1c2a', hemiI: 0.75,
    top: '#070d22', hor: '#1d2a4a', glow: '#8fa6e0', glowI: 0.25, fog: '#141d33', exp: 1.4, lit: 0.5 },
];

export class Graphics {
  constructor(game, renderer, scene, camera) {
    this.game = game; this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.hour = TIMES.midday; this.targetHour = this.hour;
    this.timeName = 'midday';
    this.warmth = this._loadSetting('warmth', 'neutral');   // 'cool' | 'neutral' | 'warm'
    this.style = STYLES[this._loadSetting('style', 'painted')] || STYLES.painted;   // default: closest to the art target
    this.styleName = Object.keys(STYLES).find((k) => STYLES[k] === this.style);
    this.resolution = 1;           // the player's resolution setting (scale on top of the preset)
    this.autoScale = 1;            // extra scale Auto applies on its lowest rungs
    this.auto = new AutoQuality(LADDER.length, 0, CONFIG.graphics.auto);
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
      uGlowI: { value: 1 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uClouds: { value: 0 },
      uTime: { value: 0 }, uCloudLit: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.7, 0.75, 0.85) },
      uCover: { value: CONFIG.graphics.cloudCover },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 uTop, uHor, uGlow, uCloudLit, uCloudShade; uniform float uGlowI, uClouds, uTime, uCover; uniform vec3 uSunDir; varying vec3 vDir;
        float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
        float f2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.07 + 11.3; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float t = clamp(d.y / 0.42, 0.0, 1.0);
          vec3 c = mix(uHor, uTop, pow(t, 0.75));
          if (uClouds > 0.0 && d.y > 0.0) {
            // soft fair-weather clouds: a flat layer overhead, seen in perspective, drifting slowly.
            // Puffs come from broad noise; a finer noise breaks up their edges. The horizon stays clear.
            vec2 q = d.xz / (d.y + 0.1) * 0.75 + vec2(uTime * 0.006, uTime * 0.002);
            float broad = f2(q * 0.8), fine = f2(q * 3.1 + 5.0);
            float dens = broad + (fine - 0.5) * 0.3;
            float cl = smoothstep(uCover, uCover + 0.2, dens);
            // lit from the sun's side: compare the cloud with itself a step toward the sun
            vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.35;
            float lit = clamp(0.62 + (dens - (f2((q + toSun) * 0.8) + (fine - 0.5) * 0.3)) * 2.2, 0.0, 1.0);
            vec3 cc = mix(uCloudShade, uCloudLit, lit) * (0.9 + 0.1 * smoothstep(uCover, uCover + 0.35, dens));
            c = mix(c, cc, cl * uClouds * 0.92 * smoothstep(0.035, 0.22, d.y));
          }
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
    scene.fog = new THREE.Fog('#cfe7f2', CONFIG.graphics.hazeNear, CONFIG.graphics.hazeFar);

    this._fps = { t: 0, frames: 0, fps: 60, ms: 16.7, worst: 16.7, w: 0 };
    this._shadowTimer = 0;
    this._shadowSig = '';
    this._camPos = new THREE.Vector3(); this._camQuat = new THREE.Quaternion();
    this.cameraMoving = false;
    // the shadow map only needs redrawing when something that casts a shadow changes
    // (see _shadowsIfDirty), not every frame and never twice in one frame
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
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
    const rung = LADDER.findIndex((l) => l.preset === name);
    this.auto.reset(rung, rung);
    this.autoScale = 1;
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
    // textures for this preset (Low: half-size layers, no large-scale variation sample)
    matUniforms.uMacro.value = this.preset.macro;
    this.texturesReady = loadTextures(this.renderer, this.preset.tex, Math.min(this.preset.aniso, this.renderer.capabilities.getMaxAnisotropy()))
      .catch((e) => console.error('textures failed to load', e));
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
    if (this.game.scenery) this.game.scenery.setQuality(name);
    if (this.game.growth) this.game.growth.renderer.setQuality(name);
    if (this.game.fish) this.game.fish.setQuality(name);
    this.shadowsDirty();
    this._emit();
  }

  /** Ask for the shadow map to be redrawn on the next frame. */
  shadowsDirty() { this.renderer.shadowMap.needsUpdate = true; }

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
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    // remember which buffer the scene is drawn into, so every frame uses the same one (see render)
    this._sceneBuffer = c.readBuffer;
    this._applyGrade();
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
      // its depth-and-normals pass draws the whole scene again: skip overlays that are not
      // solid surfaces (shadows are not redrawn: the shadow map updates only when dirty)
      const aoRender = ao.render.bind(ao);
      ao.render = (...args) => {
        const g = this.game, hide = [g.zones && g.zones.mesh, ...(g.growth ? g.growth.renderer.overlayParts() : [])].filter((o) => o && o.visible);
        hide.forEach((o) => (o.visible = false));
        aoRender(...args);
        hide.forEach((o) => (o.visible = true));
      };
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
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.resolution * this.autoScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.pixelRatio = pr;
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(innerWidth, innerHeight); }
  }

  resize() { this._applySize(); }

  _applyGrade() {
    if (!this.grade) return;
    const k = (WARMTH[this.warmth] || WARMTH.neutral).k, U = this.grade.uniforms;
    U.uWB.value.set(1 + 0.05 * k, 1 + 0.008 * k, 1 - 0.07 * k);
    U.uSat.value = this.style.sat; U.uContrast.value = this.style.contrast;
  }

  /** 'cool' | 'neutral' | 'warm': light colour, sky and colour grade. */
  setWarmth(w) {
    this.warmth = WARMTH[w] ? w : 'neutral';
    this._saveSetting('warmth', this.warmth);
    this._applyTime(this.hour);
    this._emit();
  }

  /** Art style ('clean' | 'soft' | 'painted'): lighting and grade here; the rest via game.setStyle. */
  setStyle(name) {
    this.style = STYLES[name] || STYLES.clean;
    this.styleName = Object.keys(STYLES).find((k) => STYLES[k] === this.style);
    this._saveSetting('style', this.styleName);
    this._applyTime(this.hour);
    this._emit();
  }

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
    const W = WARMTH[this.warmth] || WARMTH.neutral, St = this.style;
    const tint = (col, hex, k) => (hex ? col.lerp(new THREE.Color(hex), k) : col);
    this.sun.color.copy(tint(C('sun'), W.sun, 0.3)); this.sun.intensity = L('sunI') * St.sun;
    this.hemi.color.copy(tint(C('sky'), W.sky, 0.15)); this.hemi.groundColor.copy(C('ground')); this.hemi.intensity = L('hemiI') * St.hemi;
    this.skyU.uTop.value.copy(tint(C('top'), W.sky, 0.12)); this.skyU.uHor.value.copy(tint(C('hor'), W.sky, 0.2));
    if (St.sky.soft) this.skyU.uTop.value.lerp(this.skyU.uHor.value, 0.22 * St.sky.soft);
    this.skyU.uClouds.value = St.sky.clouds;
    // clouds take their light from the sun and their shade from the sky
    const day = THREE.MathUtils.clamp(L('sunI') / 3.2, 0.08, 1);
    this.skyU.uCloudLit.value.copy(C('sun')).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(0.25 + 0.85 * day);
    this.skyU.uCloudShade.value.copy(C('hor')).lerp(C('top'), 0.35).multiplyScalar(0.55 + 0.4 * day);
    this.skyU.uGlow.value.copy(C('glow')); this.skyU.uGlowI.value = L('glowI');
    // the visible sun sits a little lower than the light (so golden-hour shadows stay readable)
    this.skyU.uSunDir.value.copy(this.sunDir).setY(this.sunDir.y * 0.45).normalize();
    this.scene.fog.color.copy(tint(C('fog'), W.sky, 0.2));
    this._applyGrade();
    // the zone overlay is unlit: dim it with the light, so it doesn't glow at dusk
    // interior-mapped windows: how many rooms are lit, how bright the day is
    const gu = this.game.growth && this.game.growth.renderer.glassUniforms;
    if (gu) {
      gu.uLit.value = L('lit');
      gu.uDay.value = THREE.MathUtils.clamp(L('sunI') / 3.2, 0, 1);
      gu.uSky.value.copy(C('hor'));
    }
    const zm = this.game.zones && this.game.zones.material;
    if (zm) zm.color.setScalar(THREE.MathUtils.clamp(L('sunI') / 3.2 * 0.75 + L('hemiI') / 1.5 * 0.25, 0.12, 1));
    this.renderer.toneMappingExposure = L('exp');
    this._fitShadow(true);
    this.shadowsDirty();
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
    this.shadowsDirty();
  }

  /** Redraw the shadow map only when a shadow caster changed (town, trees, infill, paths). */
  _shadowsIfDirty() {
    const g = this.game;
    const sig = [g.growth && g.growth.rebuilds, g.scenery && g.scenery.version, g.infill && g.infill.version,
      g.paths && g.paths.version, g.terraces && g.terraces.version, g.flora && g.flora.version].join(',');
    if (sig !== this._shadowSig) { this._shadowSig = sig; this.shadowsDirty(); }
  }

  // ---- per frame ----------------------------------------------------------------------

  update(dt, rawDt = dt) {
    // glide toward the target time
    if (Math.abs(this.targetHour - this.hour) > 1e-3) {
      const step = Math.sign(this.targetHour - this.hour) * Math.max(dt * 4.5, Math.abs(this.targetHour - this.hour) * dt * 2.2);
      this.hour = Math.abs(step) >= Math.abs(this.targetHour - this.hour) ? this.targetHour : this.hour + step;
      this._applyTime(this.hour);
    }
    const cam = this.camera;
    this.cameraMoving = this._camPos.distanceToSquared(cam.position) > 1e-8 || Math.abs(this._camQuat.dot(cam.quaternion)) < 1 - 1e-9;
    this._camPos.copy(cam.position); this._camQuat.copy(cam.quaternion);
    this.sky.position.copy(cam.position);
    this.skyU.uTime.value += dt;
    this._shadowTimer -= dt;
    if (this._shadowTimer <= 0) { this._shadowTimer = 0.5; this._fitShadow(); }
    this._shadowsIfDirty();
    this._autoQuality(rawDt);
  }

  /**
   * Frame-rate read-out, and Auto: the watchdog in autoquality.js decides (patiently)
   * when to move down or up a rung of the ladder; this applies its decision.
   */
  _autoQuality(dt) {
    const F = this._fps;
    if (dt <= 0 || document.hidden) { this.auto.tick(0, false, true); return; }
    F.t += dt; F.frames++; F.w = Math.max(F.w, dt * 1000);
    if (F.t >= 1) { F.fps = F.frames / F.t; F.ms = (F.t / F.frames) * 1000; F.worst = F.w; F.t = 0; F.frames = 0; F.w = 0; this._emit(); }
    if (this.mode !== 'auto') return;
    const level = this.auto.tick(dt, this.cameraMoving, false);
    if (level === null) return;
    const rung = LADDER[level];
    this.autoScale = Math.max(CONFIG.graphics.autoMinResolution, rung.scale);
    if (rung.preset !== this.presetName) this._use(rung.preset);
    else { this._applySize(); this._emit(); }
  }

  // ---- harbour reflections: a mirrored render of the town, sampled by the sea ----

  _renderReflection() {
    const P = this.preset, g = this.game, r = this.renderer;
    const U = g.sea.uniforms;
    if (!P.reflection) { U.uReflStrength.value = 0; return; }
    const size = r.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(P.reflection).floor();
    if (!this.reflRT || this.reflRT.width !== size.x || this.reflRT.height !== size.y) {
      if (this.reflRT) this.reflRT.dispose();
      this.reflRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
      this.reflCam = new THREE.PerspectiveCamera();
      this.reflCam.layers.enableAll();
    }
    const cam = this.camera, vc = this.reflCam, y0 = CONFIG.graphics.reflectionPlane;
    cam.updateMatrixWorld();   // this frame's camera, not last frame's (the mirror must match the main view)
    // mirror the camera in the sea plane (as three.js's Reflector does)
    const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    if (cp.y < y0 + 0.2) { U.uReflStrength.value = 0; return; }
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(cp);
    vc.position.set(cp.x, 2 * y0 - cp.y, cp.z);
    vc.up.set(0, 1, 0).applyMatrix4(rot); vc.up.y = -vc.up.y;
    vc.lookAt(look.x, 2 * y0 - look.y, look.z);
    vc.far = cam.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(cam.projectionMatrix);
    U.uReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane = the sea surface, so nothing underwater is reflected
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0).applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1; pm[14] = clip.w;
    // skip what barely shows in a ripply reflection (and the sea itself)
    const hide = [g.sea.water, g.sea.farSea, g.fish.mesh, g.infill.group, g.scenery.group, g.terraces.group, g.zones.mesh, ...g.growth.renderer.smallParts()];
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const prevTarget = r.getRenderTarget(), dirty = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;   // never draw shadows from this pass: some casters are hidden in it
    r.setRenderTarget(this.reflRT);
    r.clear();
    // textures barely show in a rippled reflection: skip them in this pass (a uniform, no recompile)
    const texOn = matUniforms.uTexOn.value;
    matUniforms.uTexOn.value = 0;
    r.render(this.scene, vc);
    matUniforms.uTexOn.value = texOn;
    r.setRenderTarget(prevTarget);
    r.shadowMap.needsUpdate = dirty;
    hide.forEach((o, i) => (o.visible = was[i]));
    U.uRefl.value = this.reflRT.texture;
    U.uReflStrength.value = CONFIG.graphics.reflectionStrength;
  }

  /**
   * The one and only place a frame is drawn. Every frame takes the same route:
   * mirror pass (if on) → scene → effects → screen.
   */
  render() {
    this._renderReflection();
    if (this.composer) {
      const c = this.composer;
      // the composer swaps its two buffers as it goes; start every frame from the same
      // one, so consecutive frames are processed identically
      if (c.readBuffer !== this._sceneBuffer) c.swapBuffers();
      c.render();
    } else this.renderer.render(this.scene, this.camera);
    this.frameCount = (this.frameCount || 0) + 1;
  }
}

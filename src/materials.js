// ---------------------------------------------------------------------------
// materials.js — the shared material system (textures for every surface).
//
// Code makes the shapes; these textures give them their surfaces. All the
// texture sets the game uses (assets/textures/web/manifest.json, packed by
// tools/pack_textures.py) are loaded into TWO GPU texture arrays:
//   albedo array — colour (sRGB), one layer per set
//   data array   — normal X/Y in red/green, roughness in blue (linear)
// so any material can use any surface with just two texture slots.
//
// A material opts in with surface(material, cfg) (via style.registerStyled).
// The shader then picks a layer and projects the texture onto the geometry:
//   'face'    — projected along each flat face's own direction (buildings,
//               paths, boxes): a wall at any angle, a wedge house or a roof all
//               get an undistorted texture; roof tiles run along the eaves.
//   'terrain' — triplanar: three world-axis projections blended by the surface
//               angle, so cliffs and slopes never stretch; ground, rock and cliff
//               layers blend by steepness.
// The material's own colour (vertex/instance colour) stays the AVERAGE colour:
// the texture adds detail around it. So one greyscale plaster texture covers
// every pastel facade, and the art style's palette is preserved.
//
// Against visible repetition: each house gets its own texture offset; a second,
// much larger-scale sample and low-frequency noise vary every big surface.
// Weathering (walls): rising damp near the ground, faint vertical grime, and
// worn-plaster patches blended in; streaks under windows are decals
// (buildings.js). Quality: 1024 px layers on Medium/High, 512 px on Low, and the
// extra large-scale sample is skipped on Low.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, TERRAIN_COLOURS } from './config.js';

const BASE = './assets/textures/web/';

/** Shared uniforms: textures are swapped in when loaded (no shader recompile). */
export const matUniforms = {
  uAlbedoArr: { value: placeholderArray(true) },
  uDataArr: { value: placeholderArray(false) },
  uTexOn: { value: 0 },                  // 0 until textures have loaded
  uLayerP: { value: Array.from({ length: 32 }, () => new THREE.Vector4(2, 0.5, 1, 0.7)) },   // scale, keepHue, normal, meanLum
  uLayerMean: { value: Array.from({ length: 32 }, () => new THREE.Color(0.7, 0.7, 0.7)) },
  uDetail: { value: 1 },                 // texture contrast (per art style)
  uNormalK: { value: 1 },                // normal-map strength (per art style)
  uMipBias: { value: 0 },                // >0 = softer textures (per art style)
  uMacro: { value: 1 },                  // large-scale anti-repetition sample (off on Low)
  uWeather: { value: 1 },                // damp / grime strength
};

/** Layer indices by key, filled from the manifest. */
export const LAYERS = {};
let manifest = null, loadedTier = 0, loading = null;

function placeholderArray(srgb) {
  const t = new THREE.DataArrayTexture(new Uint8Array([180, 180, 180, 255]), 1, 1, 1);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Read the manifest (layer order, scales, mean colours). Safe to call often. */
export async function loadManifest() {
  if (manifest) return manifest;
  return setManifest(await (await fetch(BASE + 'manifest.json')).json());
}

/** Use an already-read manifest (unit tests in Node read it from disk). */
export function setManifest(json) {
  manifest = json;
  manifest.layers.forEach((L, i) => {
    LAYERS[L.key] = i;
    const lum = 0.2126 * L.mean[0] + 0.7152 * L.mean[1] + 0.0722 * L.mean[2];
    const keepHue = L.tone === 'grey' ? 0 : L.tone === 'greyish' ? 0.35 : 0.6;
    matUniforms.uLayerP.value[i].set(L.scale, keepHue, 1, lum);
    matUniforms.uLayerMean.value[i].setRGB(L.mean[0], L.mean[1], L.mean[2], THREE.SRGBColorSpace);
  });
  return manifest;
}

/**
 * Load every layer at `size` px (1024 or 512) into the two texture arrays.
 * Resolves when the new arrays are live. Calling again with the same size
 * is free; a different size replaces the arrays (and frees the old ones).
 */
export function loadTextures(renderer, size = 1024, anisotropy = 4) {
  if (loadedTier === size && !loading) return Promise.resolve();
  if (loading && loading.size === size) return loading.promise;
  const p = (async () => {
    const m = await loadManifest();
    const n = m.layers.length, bytes = size * size * 4;
    const albedo = new Uint8Array(bytes * n), data = new Uint8Array(bytes * n);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const decode = async (file) => {
      const res = await fetch(BASE + file);
      if (!res.ok) throw new Error('missing texture ' + file);
      return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    };
    // fetch all files in parallel, then copy each into its layer
    const imgs = await Promise.all(m.layers.flatMap((L) => [decode(L.files[size].albedo), decode(L.files[size].data)]));
    for (let i = 0; i < n; i++) {
      for (const [k, target] of [[0, albedo], [1, data]]) {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(imgs[i * 2 + k], 0, 0, size, size);
        target.set(ctx.getImageData(0, 0, size, size).data, i * bytes);
        imgs[i * 2 + k].close();
      }
    }
    const make = (buf, srgb) => {
      const t = new THREE.DataArrayTexture(buf, size, size, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    const oldA = matUniforms.uAlbedoArr.value, oldD = matUniforms.uDataArr.value;
    matUniforms.uAlbedoArr.value = make(albedo, true);
    matUniforms.uDataArr.value = make(data, false);
    matUniforms.uTexOn.value = 1;
    oldA.dispose(); oldD.dispose();
    loadedTier = size;
    loading = null;
  })();
  loading = { size, promise: p };
  return p;
}

/** Download sizes per tier (for the settings panel and tests). */
export function textureBytes(size) {
  return manifest ? manifest.layers.reduce((s, L) => s + L.files[size].bytes, 0) : 0;
}

// ---- the shader ------------------------------------------------------------------

/** A colour from config as a GLSL vec3 (linear). */
const g3 = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const f1 = (v) => Number(v).toFixed(4);

const GLSL_COMMON = /* glsl */`
  uniform highp sampler2DArray uAlbedoArr, uDataArr;
  uniform float uTexOn, uDetail, uNormalK, uMipBias, uMacro, uWeather;
  uniform vec4 uLayerP[32];
  uniform vec3 uLayerMean[32];
  float mHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
  float mNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mHash(i), mHash(i + vec2(1, 0)), u.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), u.x), u.y);
  }
  float mFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * mNoise(p); p = p * 2.07 + 5.3; a *= 0.5; } return s / 0.875; }
  // A surface sample: colour (linear) and tangent-space normal + roughness.
  struct MSample { vec3 col; vec3 tn; float rough; };
  MSample mSample(vec2 uv, int layer) {
    MSample s;
    if (uTexOn < 0.5) { s.col = uLayerMean[layer]; s.tn = vec3(0.0, 0.0, 1.0); s.rough = 0.9; return s; }   // textures off (mirror pass)
    vec4 a = texture(uAlbedoArr, vec3(uv, float(layer)), uMipBias);
    vec4 d = texture(uDataArr, vec3(uv, float(layer)), uMipBias);
    s.col = a.rgb;
    vec2 nxy = (d.rg * 2.0 - 1.0) * uNormalK * uLayerP[layer].z;
    s.tn = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
    s.rough = d.b;
    // anti-repetition: the same texture at ~1/5 scale, rotated, modulates brightness
    if (uMacro > 0.0) {
      vec2 muv = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.21 + 0.37;
      vec3 m = texture(uAlbedoArr, vec3(muv, float(layer)), 2.0 + uMipBias).rgb;
      float ml = dot(m, vec3(0.2126, 0.7152, 0.0722));
      s.col *= mix(1.0, clamp(ml / max(uLayerP[layer].w, 0.05), 0.6, 1.5), 0.55 * uMacro);
    }
    return s;
  }
  // Recolour a texture sample around a base (average) colour.
  vec3 mTint(vec3 base, vec3 tex, int layer) {
    vec4 P = uLayerP[layer];
    float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
    float k = mix(1.0, lum / max(P.w, 0.03), uDetail);                    // luminance detail
    vec3 hue = tex / max(uLayerMean[layer], vec3(0.03));                  // the texture's own colour shifts
    return base * mix(vec3(k), mix(vec3(1.0), hue, uDetail), P.y);
  }
  // One rock bed: its colour, and (alpha) how proud it stands: 1 thick rib … 0 recessed shale.
  vec4 mBed(float id) {
    float h = mHash(vec2(id, 1.7));
    vec3 c = h < 0.32 ? BED_PALE : h < 0.70 ? BED_MID : h < 0.86 ? BED_DARK : BED_OCHRE;
    float proud = h < 0.32 ? 1.0 : h < 0.70 ? 0.6 : h < 0.86 ? 0.0 : 0.7;
    return vec4(c * (0.9 + 0.2 * mHash(vec2(id, 4.4))), proud);
  }
`.replace('BED_PALE', g3(TERRAIN_COLOURS.bedPale)).replace('BED_MID', g3(TERRAIN_COLOURS.bedMid))
  .replace('BED_DARK', g3(TERRAIN_COLOURS.bedDark)).replace('BED_OCHRE', g3(TERRAIN_COLOURS.bedOchre));

/**
 * Patch a compiled material's shaders. Called from style.registerStyled's
 * onBeforeCompile (so styles and textures share one patch).
 *   cfg.mode   'face' | 'terrain'
 *   cfg.layer  layer key, or 'attr' (per-vertex layer in aoParams.z: buildings)
 *   cfg.weather  true for house walls (damp, grime, worn patches)
 */
export function injectSurface(sh, cfg) {
  Object.assign(sh.uniforms, matUniforms);
  const fixed = cfg.layer !== 'attr' ? (LAYERS[cfg.layer] ?? 0) : -1;
  // vertex: per-house/instance random + layer, and height above ground (walls)
  sh.vertexShader = 'varying float vMLayer;\nvarying float vMRand;\nvarying float vMGround;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    {
      ${cfg.layer === 'attr'
        ? 'float z = aoParams.z; vMLayer = floor(z) - 1.0; vMRand = fract(z) / 0.9; vMGround = aoParams.x;'
        : `vMLayer = ${fixed.toFixed(1)}; vMGround = -1e4;
           vMRand = 0.0;
           #ifdef USE_INSTANCING
             vMRand = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
           #endif`}
      ${cfg.masks ? 'vMask = aMask;' : 'vMask = vec4(0.0);'}
    }`);
  sh.vertexShader = (cfg.masks ? 'attribute vec4 aMask;\n' : '') + 'varying vec4 vMask;\n' + sh.vertexShader;
  if (cfg.layer === 'attr' && !/attribute vec3 aoParams/.test(sh.vertexShader)) sh.vertexShader = 'attribute vec3 aoParams;\n' + sh.vertexShader;

  const body = cfg.mode === 'terrain' ? `{ vec3 wp = vSW; ${terrainGLSL()} }`
    : cfg.mode === 'rock' ? `{ vec3 wp = vSW; ${rockGLSL(cfg)} }`
    : `if (uTexOn > 0.5 && vMLayer > -0.5) {
      vec3 wp = vSW;
      vec3 nG = normalize(cross(dFdx(wp), dFdy(wp)));               // the true flat face
      if (dot(nG, vSN) < 0.0) nG = -nG;
      ${FACE_GLSL(cfg)}
    }`;
  sh.fragmentShader = 'varying float vMLayer;\nvarying float vMRand;\nvarying float vMGround;\nvarying vec4 vMask;\nvec3 mNormalW = vec3(0.0); float mRough = -1.0;\n' + GLSL_COMMON + sh.fragmentShader
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + body)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (mRough >= 0.0) roughnessFactor = clamp(mix(roughnessFactor, mRough, 0.85), 0.25, 1.0);`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (dot(mNormalW, mNormalW) > 0.5) normal = normalize((viewMatrix * vec4(mNormalW, 0.0)).xyz);`);
}

const FACE_GLSL = (cfg) => `
      int layer = int(vMLayer + 0.5);
      vec4 P = uLayerP[layer];
      // a frame on the face: t along it (horizontal), b up it
      vec3 t = abs(nG.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), nG));
      vec3 b = cross(nG, t);
      vec2 uv = vec2(dot(wp, t), -dot(wp, b)) / P.x + vMRand * vec2(7.31, 3.17);
      MSample s = mSample(uv, layer);
      vec3 base = diffuseColor.rgb;
      vec3 c = mTint(base, s.col, layer);
      ${cfg.weather ? WEATHER_GLSL.replace(/PLASTER_LAYER/g, String(LAYERS.plaster ?? 0)).replace(/WORN_LAYER/g, String(LAYERS.plasterWorn ?? 1)) : ''}
      diffuseColor.rgb = c;
      mNormalW = normalize(t * s.tn.x + b * s.tn.y + nG * s.tn.z);
      mRough = s.rough;`;

// house walls only: worn-plaster patches, rising damp, faint vertical grime
const WEATHER_GLSL = `
      if (layer == PLASTER_LAYER && abs(nG.y) < 0.5) {
        vec2 q = vec2(dot(wp, t), wp.y);
        // worn patches: blend in the weathered plaster where a large noise is high
        float patchN = mFbm(q * 0.22 + vMRand * 13.0);
        float worn = smoothstep(0.58, 0.78, patchN) * uWeather;
        if (worn > 0.01) {
          MSample w = mSample(uv * 0.9 + 0.31, WORN_LAYER);
          c = mix(c, mTint(base, w.col, WORN_LAYER) * 0.93, worn);
          s.tn = normalize(mix(s.tn, w.tn, worn));
        }
        // gentle colour variation across a facade (sun-faded, repainted bits)
        c *= 1.0 + (mFbm(q * 0.11 + 3.7 + vMRand * 5.0) - 0.5) * 0.14 * uWeather;
        // rising damp: darker, greyer and a touch green near the ground
        float h = wp.y - vMGround;
        float dampTop = 0.9 + 0.7 * mFbm(vec2(q.x * 0.6, vMRand * 9.0));
        float damp = (1.0 - smoothstep(dampTop - 0.5, dampTop, h)) * uWeather;
        vec3 dampCol = mix(vec3(dot(c, vec3(0.3, 0.55, 0.15))), c, 0.45) * vec3(0.72, 0.74, 0.68);
        c = mix(c, dampCol, damp * 0.85);
        // faint vertical grime streaks everywhere
        float streak = mNoise(vec2(q.x * 3.2, q.y * 0.18 + vMRand * 31.0));
        c *= 1.0 - 0.07 * uWeather * smoothstep(0.55, 0.9, streak);
      }`;


/**
 * The ground. Three families of surface, blended by steepness with a noisy edge:
 *   ground — dry earth, straw grass and scrub floor (by the cover mask), terrace
 *            soil, and pebbles / sea bed along the shore; one top-down projection;
 *   scree  — stony earth where soil gives way to rock;
 *   rock   — layered cliffs: beds along the tilted bedding plane (see terrain.js),
 *            each bed its own colour, thick pale beds standing proud as ribs, thin
 *            dark packets recessed, cut by joints; the cliff texture is projected
 *            from three sides and turned so its own layering runs along the beds.
 * Near sea level rock goes wet and near-black. Everything works without textures
 * too (the mirror pass), from the same colours.
 */
export function terrainGLSL() {
  const C = TERRAIN_COLOURS, K = CONFIG.terrain.rock;
  const d = K.dipDegrees * Math.PI / 180;
  const nb = new THREE.Vector3(K.strikeSkew, Math.cos(d), -Math.sin(d)).normalize();
  const L = (k) => String(LAYERS[k] ?? 0);
  return /* glsl */`
      vec3 n = normalize(vSN);
      float steep = 1.0 - n.y;                                  // 0 flat … 1 vertical
      float y = wp.y;
      float nA = mFbm(wp.xz * 0.07);
      float nB = mFbm(wp.xz * 0.33 + 7.1);
      float edge = (nA - 0.5) * 0.14 + (nB - 0.5) * 0.07;
      float wRock = smoothstep(0.29 + edge, 0.385 + edge, steep);
      float wScree = smoothstep(0.17 + edge, 0.29 + edge, steep) * (1.0 - wRock) * (1.0 - 0.7 * smoothstep(0.3, 0.7, vMask.x));
      vec3 col = vec3(0.0), nrm = vec3(0.0); float rough = 0.0;

      if (wRock < 0.99) {
        // ---- ground: one top-down projection ----
        MSample e = mSample(wp.xz / uLayerP[${L('ground')}].x, ${L('ground')});
        MSample g = mSample(wp.xz / uLayerP[${L('scrub')}].x + 0.37, ${L('scrub')});
        float cover = vMask.x;
        float grassy = max(smoothstep(0.40, 0.64, nA + (nB - 0.5) * 0.5), smoothstep(0.12, 0.55, cover));
        vec3 cE = mTint(${g3(C.earth)}, e.col, ${L('ground')});
        vec3 cG = mTint(mix(${g3(C.straw)}, ${g3(C.scrub)}, smoothstep(0.22, 0.72, cover + (nB - 0.5) * 0.45)), g.col, ${L('scrub')});
        vec3 cg = mix(cE, cG, grassy);
        vec3 tn = mix(e.tn, g.tn, grassy);
        float rg = mix(e.rough, g.rough, grassy);
        cg = mix(cg, cE * 1.03, vMask.z);                        // trodden, bare ground
        if (vMask.y > 0.01) {                                    // terrace soil
          MSample so = mSample(wp.xz / uLayerP[${L('soil')}].x, ${L('soil')});
          cg = mix(cg, mTint(${g3(C.soil)}, so.col, ${L('soil')}), vMask.y);
          tn = mix(tn, so.tn, vMask.y);
        }
        cg = mix(cg, mTint(${g3(C.scree)}, e.col, ${L('ground')}), wScree * 0.85);
        float shore = 1.0 - smoothstep(1.2 + nB * 0.9, 2.0 + nB * 0.9, y);
        if (shore > 0.01) {                                      // pebble beach, then the sea bed
          MSample pb = mSample(wp.xz / uLayerP[${L('pebbles')}].x, ${L('pebbles')});
          vec3 cp = mTint(mix(${g3(C.pebble)}, ${g3(C.sand)}, smoothstep(0.38, 0.66, nA)), pb.col, ${L('pebbles')});
          if (vMask.w > 0.01) {                                 // rocky shore: a pale rock shelf instead of pebbles
            MSample rs = mSample(wp.xz / uLayerP[${L('rockPale')}].x, ${L('rockPale')});
            cp = mix(cp, mTint(${g3(C.shelf)}, rs.col, ${L('rockPale')}), vMask.w);
            pb.tn = mix(pb.tn, rs.tn, vMask.w);
          }
          cp *= mix(1.0, 0.5, 1.0 - smoothstep(-0.1, 0.45, y)); // wet at the waterline
          cp = mix(cp, ${g3(C.seabed)}, smoothstep(-1.0, -8.0, y) * 0.75);
          cg = mix(cg, cp, shore); tn = mix(tn, pb.tn, shore); rg = mix(rg, pb.rough * 0.8, shore);
        }
        tn = normalize(tn);
        col += (1.0 - wRock) * cg;
        nrm += (1.0 - wRock) * normalize(vec3(tn.x + n.x, abs(tn.z) * n.y, tn.y + n.z));
        rough += (1.0 - wRock) * rg;
      }

      if (wRock > 0.01) {
        // ---- layered rock ----
        const vec3 nb = vec3(${f1(nb.x)}, ${f1(nb.y)}, ${f1(nb.z)});     // the bedding plane's normal
        float s = dot(wp, nb) + (mFbm(wp.xz * 0.045 + wp.y * 0.03) - 0.5) * 3.2;   // across the beds (m), gently warped
        float sp = s / 1.15;
        float aa = clamp(fwidth(sp) * 1.3, 0.04, 0.5);
        float id = floor(sp), bt = smoothstep(1.0 - aa, 1.0, fract(sp));
        vec4 b0 = mBed(id), b1 = mBed(id + 1.0);
        vec4 bed = mix(b0, b1, bt);                             // rgb + how proud the bed stands
        vec3 base = bed.rgb * mix(0.9, 1.07, mHash(vec2(floor(s / 5.3), 8.3)));   // packets of beds, a tone apart
        // thin laminations in the recessed beds (fade out with distance)
        float lam = 0.5 + 0.5 * sin(s * 34.0 + mNoise(wp.xz * 0.8) * 3.0);
        base *= 1.0 - (1.0 - bed.a) * 0.22 * lam * (1.0 - smoothstep(0.4, 1.6, fwidth(s) * 34.0));
        // joints: cracks across the proud beds, every metre or two along the strike
        float u1 = dot(wp, normalize(cross(nb, vec3(0.0, 1.0, 0.0))));
        float jw = mix(0.8, 2.6, mHash(vec2(id, 5.1)));
        float jd = abs(fract(u1 / jw + mHash(vec2(id, 2.2))) - 0.5) * jw;
        base *= 1.0 - 0.42 * bed.a * (1.0 - smoothstep(0.02, 0.07 + fwidth(u1), jd));
        base *= mix(0.85, 1.0, bed.a);                          // recesses sit in shade
        // the cliff texture from three sides, turned to run along the beds
        vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
        float sc = 1.0 / uLayerP[${L('cliff')}].x;
        vec2 aX = normalize(vec2(nb.y, -nb.z)), cX = vec2(-aX.y, aX.x);       // in the (z, y) plane
        vec2 aZ = normalize(vec2(nb.y, -nb.x)), cZ = vec2(-aZ.y, aZ.x);       // in the (x, y) plane
        vec2 cY = normalize(nb.xz), aY = vec2(-cY.y, cY.x);                   // in the (x, z) plane
        MSample sx = mSample(vec2(dot(wp.zy, aX), -dot(wp.zy, cX) * 1.3) * sc, ${L('cliff')});
        MSample sy = mSample(vec2(dot(wp.xz, aY), -dot(wp.xz, cY)) * sc, ${L('cliff')});
        MSample sz = mSample(vec2(dot(wp.xy, aZ), -dot(wp.xy, cZ) * 1.3) * sc, ${L('cliff')});
        vec3 tc = sx.col * w.x + sy.col * w.y + sz.col * w.z;
        vec3 cr = mTint(base, tc, ${L('cliff')});
        vec3 nX = vec3(abs(sx.tn.z) * n.x, n.y, n.z) + vec3(0.0, aX.y, aX.x) * sx.tn.x + vec3(0.0, cX.y, cX.x) * sx.tn.y;
        vec3 nY = vec3(n.x, abs(sy.tn.z) * n.y, n.z) + vec3(aY.x, 0.0, aY.y) * sy.tn.x + vec3(cY.x, 0.0, cY.y) * sy.tn.y;
        vec3 nZ = vec3(n.x, n.y, abs(sz.tn.z) * n.z) + vec3(aZ.x, aZ.y, 0.0) * sz.tn.x + vec3(cZ.x, cZ.y, 0.0) * sz.tn.y;
        vec3 nr = normalize(nX * w.x + nY * w.y + nZ * w.z);
        // relief: where a proud bed meets a recessed one, tip the surface so ribs catch the light
        float dP = (b1.a - b0.a) * 6.0 * bt * (1.0 - bt) / max(aa, 0.1);
        nr = normalize(nr - 0.11 * dP * (nb - n * dot(nb, n)));
        float rr = sx.rough * w.x + sy.rough * w.y + sz.rough * w.z;
        // the splash zone: wet and near-black at the waterline, olive just under it
        float wet = 1.0 - smoothstep(0.15, 1.0 + nB * 1.3, y);
        cr = mix(cr, cr * ${g3(C.wet)} * 1.6, wet);
        cr = mix(cr, ${g3(C.algae)} * 0.8, smoothstep(0.05, -1.5, y) * 0.55);
        rr *= 1.0 - 0.55 * wet;
        col += wRock * cr; nrm += wRock * nr; rough += wRock * rr;
      }
      diffuseColor.rgb *= col;
      mNormalW = normalize(nrm);
      mRough = rough;`;
}

/** Loose rock (boulders, breakwater blocks): the pale rock texture from three sides, wet near the sea. */
function rockGLSL(cfg) {
  const C = TERRAIN_COLOURS, layer = String(LAYERS[cfg.layer] ?? 0);
  return /* glsl */`
      vec3 n = normalize(vSN);
      vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
      float sc = 1.0 / uLayerP[${layer}].x;
      vec3 o = vec3(vMRand * 13.0, vMRand * 7.0, vMRand * 29.0);
      MSample sx = mSample((wp.zy + o.zy) * sc, ${layer});
      MSample sy = mSample((wp.xz + o.xz) * sc, ${layer});
      MSample sz = mSample((wp.xy + o.xy) * sc, ${layer});
      vec3 c = mTint(diffuseColor.rgb, sx.col * w.x + sy.col * w.y + sz.col * w.z, ${layer});
      vec3 tX = vec3(sx.tn.xy + n.zy, abs(sx.tn.z) * n.x);
      vec3 tY = vec3(sy.tn.xy + n.xz, abs(sy.tn.z) * n.y);
      vec3 tZ = vec3(sz.tn.xy + n.xy, abs(sz.tn.z) * n.z);
      float wet = 1.0 - smoothstep(0.1, 0.75 + vMRand * 0.7, wp.y);
      c = mix(c, c * ${g3(C.wet)} * 1.6, wet);
      c = mix(c, ${g3(C.algae)} * 0.8, smoothstep(0.05, -1.5, wp.y) * 0.55);
      diffuseColor.rgb = c;
      mNormalW = normalize(tX.zyx * w.x + tY.xzy * w.y + tZ.xyz * w.z);
      mRough = (sx.rough * w.x + sy.rough * w.y + sz.rough * w.z) * (1.0 - 0.55 * wet);`;
}

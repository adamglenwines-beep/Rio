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
`;

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
    }`);
  if (cfg.layer === 'attr' && !/attribute vec3 aoParams/.test(sh.vertexShader)) sh.vertexShader = 'attribute vec3 aoParams;\n' + sh.vertexShader;

  const terrain = cfg.mode === 'terrain';
  sh.fragmentShader = 'varying float vMLayer;\nvarying float vMRand;\nvarying float vMGround;\nvec3 mNormalW = vec3(0.0); float mRough = -1.0;\n' + GLSL_COMMON + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
    if (uTexOn > 0.5 && vMLayer > -0.5) {
      vec3 wp = vSW;
      vec3 nG = normalize(cross(dFdx(wp), dFdy(wp)));               // the true flat face
      if (dot(nG, vSN) < 0.0) nG = -nG;
      ${terrain ? terrainGLSL() : FACE_GLSL(cfg)}
    }`)
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

const TERRAIN_GLSL = `
      // triplanar: weights from the surface normal (smooth one if the style has it)
      vec3 n = normalize(vSN);
      vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
      float steep = 1.0 - n.y;                                  // 0 flat … 1 vertical
      float edge = mFbm(wp.xz * 0.08) * 0.18;
      // layer weights: ground on gentle slopes, broken rock between, cliff when steep
      float wCliff = smoothstep(0.24 + edge, 0.34 + edge, steep);
      float wRock = smoothstep(0.12 + edge, 0.2 + edge, steep) * (1.0 - wCliff);
      float wGround = 1.0 - wCliff - wRock;
      vec3 col = vec3(0.0), tnSum = vec3(0.0); float rough = 0.0;
      vec3 base = diffuseColor.rgb;
      for (int li = 0; li < 3; li++) {
        float lw = li == 0 ? wGround : li == 1 ? wRock : wCliff;
        if (lw < 0.01) continue;
        int layer = li == 0 ? ${'${GROUND}'} : li == 1 ? ${'${ROCK}'} : ${'${CLIFF}'};
        float sc = 1.0 / uLayerP[layer].x;
        // cliffs: squash the strata slightly so layers read as horizontal bands
        vec2 sy = li == 2 ? vec2(1.0, 1.6) : vec2(1.0);
        MSample sx = mSample(vec2(wp.z * sign(n.x), -wp.y) * sc * sy, layer);
        MSample sy2 = mSample(wp.xz * sc, layer);
        MSample sz = mSample(vec2(-wp.x * sign(n.z), -wp.y) * sc * sy, layer);
        vec3 tc = sx.col * w.x + sy2.col * w.y + sz.col * w.z;
        // whiteout-blended normals (Golus)
        vec3 tX = vec3(sx.tn.xy + n.zy, abs(sx.tn.z) * n.x);
        vec3 tY = vec3(sy2.tn.xy + n.xz, abs(sy2.tn.z) * n.y);
        vec3 tZ = vec3(sz.tn.xy + n.xy, abs(sz.tn.z) * n.z);
        vec3 nw = normalize(tX.zyx * w.x + tY.xzy * w.y + tZ.xyz * w.z);
        col += lw * mTint(base, tc, layer);
        tnSum += lw * nw;
        rough += lw * (sx.rough * w.x + sy2.rough * w.y + sz.rough * w.z);
      }
      diffuseColor.rgb = col;
      mNormalW = normalize(tnSum);
      mRough = rough;`;

/** Fill the terrain layer indices into the terrain GLSL (after the manifest loads). */
export function terrainGLSL() {
  return TERRAIN_GLSL.replace('${GROUND}', String(LAYERS.ground ?? 0)).replace('${ROCK}', String(LAYERS.rock ?? 0)).replace('${CLIFF}', String(LAYERS.cliff ?? 0));
}

// ---------------------------------------------------------------------------
// style.js — switchable art styles for the whole scene.
//
// The art style is undecided, so the town can be shown in three candidate
// styles on the same geometry:
//   clean   — Clean low-poly: crisp flat facets, flat colours, minimal detail.
//   soft    — Soft stylised: rounded/chamfered, chunky, smooth shading, gentle
//             colour gradients, soft light (cozy-builder feel).
//   painted — Hand-painted: storybook brushstroke textures on plaster, stone,
//             foliage, ground and water, painterly colour variation, slightly
//             exaggerated proportions.
//
// Every major material registers here (registerStyled). A shared shader patch
// adds world position/normal varyings and, per style, procedural gradients or
// brushstrokes; flat vs smooth shading is a material define. Geometry-level
// differences (chamfered houses, round foliage, terrain normals) are applied
// by each module's setStyle(). Switching style recompiles shaders once.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const STYLES = {
  clean: {
    label: 'Clean low-poly', flat: true, paint: 0, grad: 0,
    // lights & grade
    hemi: 1.0, sun: 1.0, sat: 1.04, contrast: 1.04, shadowTint: [1, 1, 1],
    // geometry
    chamfer: 0, smoothCorners: false, roundFoliage: false, smoothTerrain: false,
    detailScale: 1, cornice: 0.32, overhang: 0.2,
    sky: { clouds: 0, soft: 0 },
  },
  soft: {
    label: 'Soft stylised', flat: false, paint: 0, grad: 1,
    hemi: 1.15, sun: 0.92, sat: 1.06, contrast: 0.97, shadowTint: [1.05, 1.0, 1.12],
    chamfer: 0.32, smoothCorners: true, roundFoliage: true, smoothTerrain: true,
    detailScale: 1.06, cornice: 0.42, overhang: 0.32,
    sky: { clouds: 0, soft: 1 },
  },
  painted: {
    label: 'Hand-painted', flat: false, paint: 1, grad: 0.5,
    hemi: 1.1, sun: 0.95, sat: 1.12, contrast: 1.0, shadowTint: [1.08, 0.98, 1.2],
    chamfer: 0.12, smoothCorners: false, roundFoliage: true, smoothTerrain: true,
    detailScale: 1.14, cornice: 0.5, overhang: 0.36,
    sky: { clouds: 1, soft: 0.5 },
  },
};

/** Uniforms shared by every styled material (changed live, no recompile). */
export const styleUniforms = {
  uPaint: { value: 0 },        // brushstroke strength
  uGrad: { value: 0 },         // soft gradient strength
  uShadowTint: { value: new THREE.Color(1, 1, 1) },
};

const registry = [];   // { material, kind }

const NOISE = /* glsl */`
  float sHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float sNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
  }
  float sFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * sNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

/**
 * Register a material for style switching. `kind` tunes the brushwork:
 * 'surface' (houses, paths: plaster/stone by orientation), 'ground',
 * 'foliage', 'water'.
 */
export function registerStyled(material, kind = 'surface') {
  const prev = material.onBeforeCompile;
  const prevKey = prev ? prev.toString() : '';
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(material, sh, r);
    Object.assign(sh.uniforms, styleUniforms);
    sh.vertexShader = 'varying vec3 vSW;\nvarying vec3 vSN;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      {
        mat4 sM = modelMatrix;
        #ifdef USE_INSTANCING
          sM = modelMatrix * instanceMatrix;
        #endif
        vSW = (sM * vec4(transformed, 1.0)).xyz;
        vSN = normalize(mat3(sM) * objectNormal);
      }`);
    sh.fragmentShader = `uniform float uPaint, uGrad; uniform vec3 uShadowTint;
      varying vec3 vSW; varying vec3 vSN;
      ${NOISE}
      ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 wp = vSW, wn = normalize(vSN);
        float upness = abs(wn.y);
        // soft style: gentle colour gradients instead of texture
        if (uGrad > 0.0) {
          float g = sFbm(wp.xz * 0.035 + wp.y * 0.02);
          diffuseColor.rgb *= 1.0 + uGrad * ((g - 0.5) * 0.16 + (upness < 0.5 ? clamp((wp.y - 2.0) * 0.004, -0.05, 0.08) : 0.0));
        }
        // hand-painted: brushstrokes stretched along the surface
        if (uPaint > 0.0) {
          vec2 uv;
          if (${kind === 'ground' ? 'true' : 'false'}) {   // ground: overlapping dabs, no direction
            uv = vec2(wp.x * 0.9 + wp.y * 0.4, wp.z * 0.9 - wp.y * 0.3) * 1.1;
          } else if (upness < 0.6) {                // walls: vertical strokes
            vec2 t = normalize(vec2(-wn.z, wn.x) + 1e-4);
            uv = vec2(dot(wp.xz, t) * ${kind === 'foliage' ? '3.0' : '2.2'}, wp.y * ${kind === 'foliage' ? '3.0' : '0.45'});
          } else {                                  // roofs, ground, water: diagonal sweeps
            uv = vec2(wp.x * 0.5 + wp.z * 0.32, wp.z * ${kind === 'water' ? '2.4' : '1.6'} - wp.x * 0.55);
          }
          float stroke = sFbm(uv), big = sFbm(wp.xz * 0.06 + wp.y * 0.05);
          float amp = ${kind === 'foliage' ? '0.42' : kind === 'water' ? '0.2' : kind === 'ground' ? '0.2' : '0.28'};
          diffuseColor.rgb *= mix(1.0 - amp * uPaint, 1.0 + amp * 0.7 * uPaint, smoothstep(0.25, 0.75, stroke));
          // painterly hue drift: warm lights, cool shades in the colour itself
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(vec3(0.9, 0.95, 1.1), vec3(1.1, 1.02, 0.9), big), 0.45 * uPaint);
        }
      }`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      // coloured shadows / shade (soft and painted styles)
      reflectedLight.indirectDiffuse *= uShadowTint;`);
  };
  material.customProgramCacheKey = () => prevKey + '|styled:' + kind;
  registry.push({ material, kind });
  return material;
}

/** Switch every registered material to a style (flat vs smooth needs a recompile). */
export function applyStyleToMaterials(style) {
  styleUniforms.uPaint.value = style.paint;
  styleUniforms.uGrad.value = style.grad;
  styleUniforms.uShadowTint.value.setRGB(...style.shadowTint);
  for (const { material, kind } of registry) {
    const flat = kind === 'water' ? style.flat : style.flat;
    if (material.flatShading !== flat) { material.flatShading = flat; material.needsUpdate = true; }
  }
}

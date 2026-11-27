// Frame-time profile: where does a frame go?
//
//   node tools/profile.cjs [--presets low,medium,high] [--times midday,golden] [--size 1600x900] [--out file.json]
//
// Opens the demo town at the postcard view and, per preset and time of day, times
// each stage of a frame separately (the GPU is made to finish after each stage, so
// the numbers add up): the mirror pass for the harbour, the shadow map, the main
// scene, ambient occlusion, bloom, and the colour grade + output. It also counts
// draw calls and triangles, and measures what each part of the scene (trees,
// houses, infill, terrain, sea…) costs in the main pass by hiding it.
//
// This sandbox renders in software (SwiftShader), so absolute times are far
// slower than a real GPU; the split between stages is what to read.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, ROOT } = require('./harness.cjs');

function parseArgs() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  return o;
}

(async () => {
  const o = parseArgs();
  const presets = (o.presets || 'low,medium,high').split(',');
  const times = (o.times || 'midday,golden').split(',');
  const [W, H] = (o.size || '1600x900').split('x').map(Number);
  const reps = +(o.reps || 3);
  const h = await launch({ width: W, height: H, storage: { mode: 'high', style: 'painted', warmth: 'warm' } });
  const { page } = h;
  await page.evaluate(() => game.renderer.setAnimationLoop(null));
  await page.evaluate(async () => {
    await game.gfx.texturesReady;
    game.demo(); game.growth.grow(700); game.speed = 0;
    for (let i = 0; i < 400 && (game.infill.busy || i < 4); i++) game.renderFrame(0.05);
  });
  const all = [];
  for (const preset of presets) for (const time of times) {
    const r = await page.evaluate(async ({ preset, time, reps }) => {
      const g = game, gfx = g.gfx, R = g.renderer, gl = R.getContext(), px = new Uint8Array(4);
      gfx.setPreset(preset); await gfx.texturesReady;
      gfx.setTimeOfDay(time, true);
      const hb = g.terrain.harbour, T = g.THREE;
      g.rig.tween = null; g.rig.controls.enableDamping = false;
      g.rig.flyTo(new T.Vector3(hb.x + 16, 50, hb.z + 90), new T.Vector3(hb.x - 2, 15, hb.z - 28), 0);
      for (let i = 0; i < 6; i++) g.renderFrame(0.05);
      const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const now = () => performance.now();
      // --- whole frames ---
      finish();
      let t0 = now();
      for (let i = 0; i < reps; i++) { g.renderFrame(0.016); finish(); }
      const frame = (now() - t0) / reps;
      // --- stages: wrap each pass ---
      const stages = {};
      const add = (k, ms) => { stages[k] = (stages[k] || 0) + ms; };
      const wrap = (obj, fn, key) => { const orig = obj[fn]; obj[fn] = function (...a) { finish(); const t = now(); const res = orig.apply(this, a); finish(); add(key, now() - t); return res; }; return () => { obj[fn] = orig; }; };
      const undo = [];
      undo.push(wrap(gfx, '_renderReflection', 'reflection'));
      if (gfx.composer) for (const p of gfx.composer.passes) undo.push(wrap(p, 'render', p.constructor.name));
      else undo.push(wrap(R, 'render', 'scene (direct)'));
      for (let i = 0; i < reps; i++) g.renderFrame(0.016);
      undo.forEach((u) => u());
      for (const k in stages) stages[k] /= reps;
      // shadow map: force a redraw and time the scene pass with and without it
      const sceneOnce = () => { finish(); const t = now(); R.render(g.scene, g.camera); finish(); return now() - t; };
      R.shadowMap.needsUpdate = false; sceneOnce();
      let a = 0, b = 0;
      for (let i = 0; i < reps; i++) { R.shadowMap.needsUpdate = false; a += sceneOnce(); R.shadowMap.needsUpdate = true; b += sceneOnce(); }
      stages['shadow map redraw (only when dirty)'] = (b - a) / reps;
      // draw calls and triangles of one plain scene pass
      R.info.autoReset = false; R.info.reset(); R.shadowMap.needsUpdate = false;
      R.render(g.scene, g.camera); finish();
      const info = { calls: R.info.render.calls, triangles: R.info.render.triangles };
      R.info.autoReset = true;
      // cost of each part of the scene in a plain pass (hide it, time the difference)
      const parts = {
        'wild plants (scenery)': g.scenery.group, 'houses': g.growth.group, 'infill': g.infill.group,
        'terraces': g.terraces.group, 'terrain': g.terrain.mesh, 'far terrain': g.terrain.outer, 'sea': g.sea.group, 'paths': g.paths.group, 'fish': g.fish.mesh,
      };
      const base = (() => { let s = 0; for (let i = 0; i < reps; i++) s += sceneOnce(); return s / reps; })();
      const cost = {}, tris = {};
      for (const [k, obj] of Object.entries(parts)) {
        if (!obj) continue;
        let tri = 0; obj.traverse((m) => { if (m.isMesh && m.visible) { const gg = m.geometry; const n = gg.index ? gg.index.count / 3 : (gg.drawRange.count < Infinity ? gg.drawRange.count : gg.attributes.position.count) / 3; tri += n * (m.isInstancedMesh ? m.count : 1); } });
        tris[k] = Math.round(tri);
        const was = obj.visible; obj.visible = false;
        let s = 0; for (let i = 0; i < reps; i++) s += sceneOnce();
        obj.visible = was;
        cost[k] = +(base - s / reps).toFixed(1);
      }
      g.rig.controls.enableDamping = true;
      const round = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toFixed(1)]));
      return { preset: gfx.presetName, time, pixelRatio: R.getPixelRatio(), frame: +frame.toFixed(1), stages: round(stages), plainScene: +base.toFixed(1), info, partCost: cost, partTriangles: tris };
    }, { preset, time, reps });
    console.log(JSON.stringify(r, null, 1));
    all.push(r);
  }
  if (o.out) fs.writeFileSync(path.resolve(ROOT, o.out), JSON.stringify(all, null, 1) + '\n');
  if (h.errors.length) console.log('PAGE ERRORS:\n' + h.errors.slice(0, 8).join('\n'));
  await h.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Browser smoke + regression test (Playwright + headless Chromium, software WebGL).
// Usage: node tests/browser/run.cjs [--update-baseline]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, ROOT } = require('../../tools/harness.cjs');

const BASELINE = path.join(__dirname, 'baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const SLOWDOWN_LIMIT = 2.0;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
}

(async () => {
  const h = await launch({ width: 1280, height: 800 });
  const { page, errors, badAssets } = h;

  const timings = {};
  try {
    // c. textures
    const texOn = await page.evaluate(async () => {
      await game.gfx.texturesReady;
      return (await import('./src/materials.js')).matUniforms.uTexOn.value;
    });
    check('textures loaded (uTexOn === 1)', texOn === 1, 'uTexOn=' + texOn);

    // stop the live loop so it doesn't compete with our timed frames
    await page.evaluate(() => game.renderer.setAnimationLoop(null));

    // d. demo grows
    let houses = 0, growErr = '';
    try {
      houses = await page.evaluate(() => { game.demo(); game.growth.grow(600); return game.growth.live.length; });
    } catch (e) { growErr = e.message; }
    check('demo grows > 150 houses', !growErr && houses > 150, growErr || houses + ' buildings');

    // d2. landscape: the demo lays terraces; plants respect the quality budget; nothing grows on lanes or in houses
    try {
      const r = await page.evaluate(async () => {
        const { CONFIG } = await import('./src/config.js');
        for (let i = 0; i < 60 && (game.infill.busy || i < 3); i++) game.renderFrame(0.05);
        const sc = game.scenery, out = { walls: game.terraces.walls.length, areas: game.terraces.areas.length, counts: {}, onTown: 0 };
        for (const q of ['low', 'medium', 'high']) { sc.setQuality(q); out.counts[q] = sc.kinds.blob.mesh.count; }
        out.budget = CONFIG.flora.budget;
        const m = new game.THREE.Matrix4(), mesh = sc.kinds.blob.mesh;
        for (let i = 0; i < sc.shown.blob; i += 3) {
          mesh.getMatrixAt(i, m);
          const x = m.elements[12], z = m.elements[14];
          if (game.terrain.inside(x, z) && game.growth.occAt(x, z) !== -1) out.onTown++;
        }
        out.tris = game.renderer.info.render.triangles; out.calls = game.renderer.info.render.calls;
        return out;
      });
      check('demo lays terraces with walls', r.areas >= 3 && r.walls > 10, `${r.areas} areas, ${r.walls} walls`);
      check('plant budget follows quality', r.counts.low <= r.budget.low && r.counts.medium <= r.budget.medium && r.counts.low < r.counts.high,
        `low ${r.counts.low}, medium ${r.counts.medium}, high ${r.counts.high}`);
      check('no bushes on lanes or in houses', r.onTown === 0, r.onTown + ' found');
    } catch (e) { check('landscape checks', false, e.message); }

    // d3. facades and clutter: every kind of detail is present, and far details follow the quality setting
    try {
      const r = await page.evaluate(() => {
        const R = game.growth.renderer, I = game.infill, out = { parts: {}, reach: {}, infill: {} };
        for (const k of Object.keys(R.parts)) out.parts[k] = R.parts[k].mesh ? R.parts[k].mesh.count : 0;
        for (const q of ['low', 'medium', 'high']) { R.setQuality(q); out.reach[q] = R.detailReach.value; }
        for (const k of Object.keys(I.kinds)) out.infill[k] = I.kinds[k].mesh ? I.kinds[k].mesh.count : 0;
        const A = game.growth.renderer.mass.geometry.attributes;
        out.wall = !!A.aWall && A.aWall.count === A.position.count;
        return out;
      });
      const need = ['window', 'glass', 'shutterOpen', 'shutterClosed', 'shutterHalf', 'shutterTilt', 'balcony', 'doorFrame', 'door', 'chimney', 'surround', 'fake', 'bar', 'pot', 'blob', 'cloth', 'flowerbox'];
      const missing = need.filter((k) => !(r.parts[k] > 0));
      check('facade details are all present', missing.length === 0 && r.wall, missing.length ? 'missing: ' + missing.join(', ') : `${r.parts.window} windows, ${r.parts.fake} painted, ${r.parts.cloth} washing, ${r.parts.balcony + r.parts.balconySolid} balconies`);
      check('detail by distance follows quality', r.reach.low < r.reach.medium && r.reach.medium < r.reach.high, JSON.stringify(r.reach));
      check('quarter clutter and café are placed', r.infill.boat >= 2 && r.infill.cone >= 3, `${r.infill.boat} boats hauled up, ${r.infill.cone} cones (parasols, pines)`);
    } catch (e) { check('facade checks', false, e.message); }

    // e. frame time per preset
    for (const p of ['low', 'medium', 'high']) {
      try {
        timings[p] = await page.evaluate(async (preset) => {
          game.gfx.setPreset(preset);
          await game.gfx.texturesReady;
          const gl = game.renderer.getContext(), px = new Uint8Array(4);
          const frame = () => { game.renderFrame(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
          frame(); frame();
          const t0 = performance.now();
          for (let i = 0; i < 3; i++) frame();
          return (performance.now() - t0) / 3;
        }, p);
      } catch (e) { check(`frame time [${p}]`, false, e.message); }
    }

    // g. no flashing: with nothing moving, consecutive frames are identical; and a frame
    //    depends only on where the camera is, not on the frames before it
    for (const p of ['medium', 'high']) {
      try {
        const r = await page.evaluate(async (preset) => {
          game.gfx.setPreset(preset);
          await game.gfx.texturesReady;
          game.speed = 0;
          const T = game.THREE, hb = game.terrain.harbour, gl = game.renderer.getContext();
          const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight;
          const pose = (dx) => { game.rig.tween = null; game.rig.controls.enableDamping = false;
            game.rig.flyTo(new T.Vector3(hb.x + 16 + dx, 50, hb.z + 90), new T.Vector3(hb.x - 2, 15, hb.z - 28), 0); };
          const grab = () => { game.renderFrame(0); const px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
          const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++; return n / (a.length / 4); };
          pose(0);
          for (let i = 0; i < 40 && (game.infill.busy || i < 4); i++) game.renderFrame(0.05);   // let infill and shadows settle
          const a1 = grab(), a2 = grab(), a3 = grab();
          pose(6); const b1 = grab();
          pose(0); const a4 = grab();
          game.rig.controls.enableDamping = true;
          return { still: Math.max(diff(a1, a2), diff(a2, a3)), moved: diff(a1, b1), back: diff(a1, a4) };
        }, p);
        // (a handful of edge pixels may flip from rounding in the camera maths; a flash changes thousands)
        check(`no flashing at rest [${p}]`, r.still < 2e-4, `${(r.still * 100).toFixed(3)}% of pixels changed between identical frames`);
        check(`a frame depends only on the camera [${p}]`, r.back < 2e-4 && r.moved > 0.01, `after moving away and back ${(r.back * 100).toFixed(3)}% differ (moving changed ${(r.moved * 100).toFixed(1)}%)`);
      } catch (e) { check(`no flashing [${p}]`, false, e.message); }
    }

    // h. one render path: every frame draws the scene the same number of times, and
    //    Auto quality never changes level inside a short run of frames
    try {
      const r = await page.evaluate(async () => {
        game.gfx.setPreset('auto');
        await game.gfx.texturesReady;
        const start = game.gfx.presetName, R = game.renderer, orig = R.render.bind(R);
        let calls = 0; const perFrame = [], presets = new Set();
        R.render = (s, c) => { if (s === game.scene) calls++; return orig(s, c); };
        for (let i = 0; i < 8; i++) {
          calls = 0;
          game.rig.controls._rotateLeft ? game.rig.controls._rotateLeft(0.02) : 0;
          game.renderFrame(0.05, 0.5);     // pretend every frame took half a second
          perFrame.push(calls); presets.add(game.gfx.presetName);
        }
        R.render = orig;
        return { perFrame, presets: [...presets], start };
      });
      check('every frame takes the same render path', new Set(r.perFrame).size === 1, 'scene draws per frame: ' + r.perFrame.join(','));
      check('Auto quality does not change level within a few frames', r.presets.length === 1, r.presets.join(' → '));
    } catch (e) { check('one render path', false, e.message); }

    // f. art styles
    for (const s of ['clean', 'soft', 'painted']) {
      try {
        await page.evaluate((style) => {
          game.setStyle(style);
          game.renderFrame(0.016);
          const gl = game.renderer.getContext();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        }, s);
        check(`setStyle('${s}') renders`, true);
      } catch (e) { check(`setStyle('${s}') renders`, false, e.message); }
    }
  } catch (e) {
    check('test run completed', false, e.stack || e.message);
  }

  // a, b (collected over the whole run)
  check('no page errors / console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  check('all /Rio/assets/ requests returned 200', badAssets.length === 0, badAssets.slice(0, 5).join(' | '));

  // e. compare with baseline
  const measured = ['low', 'medium', 'high'].every((p) => typeof timings[p] === 'number');
  if (measured) {
    if (UPDATE || !fs.existsSync(BASELINE)) {
      const out = { low: timings.low, medium: timings.medium, high: timings.high };
      fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
      check('frame-time baseline', true, `written to tests/browser/baseline.json (${UPDATE ? '--update-baseline' : 'no baseline existed'})`);
    } else {
      const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
      for (const p of ['low', 'medium', 'high']) {
        const ratio = timings[p] / base[p];
        check(`frame time [${p}] within ${SLOWDOWN_LIMIT}x baseline`, ratio <= SLOWDOWN_LIMIT,
          `${timings[p].toFixed(0)} ms vs ${base[p].toFixed(0)} ms (x${ratio.toFixed(2)})`);
      }
    }
  }

  console.log('\nSummary');
  console.log('preset   mean frame (ms)');
  for (const p of ['low', 'medium', 'high']) console.log(`${p.padEnd(8)} ${timings[p] === undefined ? 'n/a' : timings[p].toFixed(1)}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed) console.log('  FAILED: ' + f.name);

  await h.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

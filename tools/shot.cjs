// Screenshot tool: opens the game headless, lays out and grows the demo town,
// then saves one image per named view.
//
//   node tools/shot.cjs --out docs/progress/phase-b --tag before \
//        --views postcard,aerial,cliff --preset high --time midday --grow 700
//
// Views are camera positions relative to the harbour point (see VIEWS below);
// a custom view is "name=px,py,pz:tx,ty,tz".
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, ROOT } = require('./harness.cjs');

const VIEWS = {
  // [camera offset from harbour], [target offset from harbour]
  postcard: [[66, 40, 40], [-12, 16, -35]],
  aerial: [[85, 120, 95], [-5, 10, -40]],
  harbour: [[18, 9, 30], [-4, 5, -8]],
  cliff: [[70, 22, 62], [58, 10, 10]],          // the eastern headland cliffs from the water
  cliffwest: [[-60, 24, 70], [-62, 12, 12]],
  terraces: [[40, 62, -20], [62, 34, -50]],       // terraced slope above the east flank
  hillside: [[-20, 70, 20], [-70, 30, -40]],
  lane: [[6, 9, -22], [-3, 9, -50]],              // looking up the main street
  roofs: [[25, 55, -20], [-8, 12, -50]],          // down onto the roofs
  facade: [[14, 10, 10], [-6, 8, -12]],           // harbour-front facades, close
  shore: [[40, 6, 38], [28, 0, 12]],              // shoreline rocks and shallows
  far: [[150, 60, 190], [0, 20, -30]],            // whole coast from out at sea
  waterline: [[10, 2.2, 26], [-2, 3, 0]],         // low over the water toward the quay
};

function parseArgs() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  return o;
}

(async () => {
  const o = parseArgs();
  const out = path.resolve(ROOT, o.out || 'docs/progress/tmp');
  fs.mkdirSync(out, { recursive: true });
  const tag = o.tag ? o.tag + '_' : '';
  const preset = o.preset || 'high';
  const [W, H] = (o.size || '1600x900').split('x').map(Number);
  const views = (o.views || 'postcard,aerial').split(',');
  const t0 = Date.now();
  const h = await launch({ width: W, height: H, storage: { mode: preset, style: o.style || 'painted', warmth: o.warmth || 'neutral' }, log: !!o.log });
  const { page } = h;
  await page.evaluate(() => game.renderer.setAnimationLoop(null));
  const info = await page.evaluate(async ({ grow, time, noDemo }) => {
    await game.gfx.texturesReady;
    if (!noDemo) { game.demo(); game.growth.grow(grow); }
    game.gfx.setTimeOfDay(time, true);
    // let spread-out work (infill, scenery) finish
    for (let i = 0; i < 400; i++) { game.simulate ? game.simulate(0.05) : null; if (game.settle && game.settle()) break; }
    return { houses: game.growth.live.length, version: document.getElementById('version').textContent };
  }, { grow: +(o.grow || 700), time: isNaN(+o.time) ? (o.time || 'midday') : +o.time, noDemo: !!o.nodemo });
  console.log(`loaded ${info.version}: ${info.houses} houses (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  for (const name of views) {
    let v = VIEWS[name], label = name;
    if (name.includes('=')) {
      const [n, spec] = name.split('=');
      const [p, t] = spec.split(':').map((s) => s.split('/').map(Number));
      v = [p, t]; label = n;
    }
    if (!v) { console.log('unknown view ' + name); continue; }
    await page.evaluate(async ({ v, frames, abs }) => {
      const hb = abs ? { x: 0, y: 0, z: 0 } : game.terrain.harbour;
      game.rig.tween = null;
      game.camera.position.set(hb.x + v[0][0], v[0][1], hb.z + v[0][2]);
      game.rig.controls.target.set(hb.x + v[1][0], v[1][1], hb.z + v[1][2]);
      game.rig.controls.update();
      const gl = game.renderer.getContext(), px = new Uint8Array(4);
      // a few frames so infill, LOD fades and shadow fitting settle
      for (let i = 0; i < frames; i++) { game.renderFrame(0.05); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    }, { v, frames: +(o.frames || 3), abs: !!o.abs });
    const file = path.join(out, `${tag}${label}.jpg`);
    if (o.clean) await page.addStyleTag({ content: '#toolbar,#speed,#side,#stats,#hint,#title,.pill,.panel{display:none !important}' }).catch(() => {});
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    console.log('saved ' + path.relative(ROOT, file));
  }
  if (h.errors.length) console.log('PAGE ERRORS:\n' + h.errors.slice(0, 8).join('\n'));
  if (h.badAssets.length) console.log('BAD ASSETS:\n' + h.badAssets.slice(0, 8).join('\n'));
  await h.close();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})().catch((e) => { console.error(e); process.exit(1); });

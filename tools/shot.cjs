// Screenshot tool: opens the game headless, lays out and grows the demo town,
// then saves one image per named view.
//
//   node tools/shot.cjs --out docs/progress/phase-b --tag before [--js "code run in the page first"] \
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
  postcard: [[16, 50, 90], [-2, 15, -28]],
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
  v010: [[54, 34, 50], [-14, 12, -28]],           // about where Adam's v0.10 High screenshot was taken (art-target-v2: target-v2-5)
  v010top: [[8, 96, 112], [-6, 10, -40]],         // about the view of game-v0.10-same-view.png (art-target-v2: target-v2-1…4)
  overhead: [[-2, 66, 4], [-2, 8, -14]],          // almost straight down on the shore–piazza blocks (Adam's v0.13 phone screenshot)
  single: [[22, 16, 22], [0, 11, -6]],            // close on harbour-front houses (single-building-target-vs-game)
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
  const h = await launch({ width: W, height: H, page: o.page, storage: { mode: preset, style: o.style || 'painted', warmth: o.warmth || 'neutral' }, log: !!o.log });
  if (o.page) await h.page.waitForFunction(() => !!window.game && (location.search.indexOf('six') < 0 || !!window.game.six), null, { timeout: 600000 });
  const { page } = h;
  await page.evaluate(() => game.renderer.setAnimationLoop(null));
  const info = await page.evaluate(async ({ grow, time, noDemo }) => {
    await game.gfx.texturesReady;
    if (!noDemo && !game.six) { game.demo(); game.growth.grow(grow); }
    game.gfx.setTimeOfDay(time, true);
    // let spread-out work (infill, scenery) finish
    for (let i = 0; i < 400; i++) { game.simulate ? game.simulate(0.05) : null; if (game.settle && game.settle()) break; }
    return { houses: game.growth.live.length, version: document.getElementById('version').textContent };
  }, { grow: +(o.grow || 700), time: isNaN(+o.time) ? (o.time || 'midday') : +o.time, noDemo: !!o.nodemo });
  console.log(`loaded ${info.version}: ${info.houses} houses (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  // --js "code": run in the page before the pictures are taken (e.g. to switch a debug view on)
  if (o.js) await page.evaluate(async (code) => { const f = new Function('game', 'return (async () => {' + code + '})()'); await f(game); }, o.js);

  for (const name of views) {
    let v = VIEWS[name], label = name;
    if (name.includes('=')) {
      const [n, spec] = name.split('=');
      const [p, t] = spec.split(':').map((s) => s.split('/').map(Number));
      v = [p, t]; label = n;
    }
    // "door", "arched", "workshop", "shop" (+ a number: "door3"): stand in front of the n-th such ground-floor opening
    const dm = name.match(/^(door|arched|workshop|shop|window)(\d*)$/);
    if (dm) {
      v = await page.evaluate(({ kind, nth }) => {
        const G = game.growth, found = [];
        for (const id of G.live) {
          const b = G.buildings[id];
          for (const op of b.openings || []) if (op.kind === kind) {
            const q = b.corners, A = q[op.wall], B = q[(op.wall + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
            const e = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = [e[1], -e[0]], c = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
            if (n[0] * (A[0] - c[0]) + n[1] * (A[1] - c[1]) < 0) { n[0] = -n[0]; n[1] = -n[1]; }
            const u = (op.u0 + op.u1) / 2, x = A[0] + e[0] * u, z = A[1] + e[1] * u, y = (op.y0 + op.y1) / 2;
            if (n[1] > 0.3) found.push([[x + n[0] * 5.5 + e[0] * 1.6, y + 1.6, z + n[1] * 5.5 + e[1] * 1.6], [x, y, z]]);
          }
        }
        return found.length ? found[Math.min(nth, found.length - 1)] : null;
      }, { kind: dm[1], nth: +(dm[2] || 0) });
      if (v) v.abs = true;
    }
    if (name === 'six') { await page.evaluate(() => { game.rig.controls.enableDamping = false; for (let i = 0; i < 3; i++) game.renderFrame(0.05); }); }
    else if (!v) { console.log('unknown view ' + name); continue; }
    if (v) await page.evaluate(async ({ v, frames, abs }) => {
      const hb = abs ? { x: 0, y: 0, z: 0 } : game.terrain.harbour;
      game.rig.tween = null;
      game.camera.position.set(hb.x + v[0][0], v[0][1], hb.z + v[0][2]);
      game.rig.controls.target.set(hb.x + v[1][0], v[1][1], hb.z + v[1][2]);
      game.rig.controls.update();
      const gl = game.renderer.getContext(), px = new Uint8Array(4);
      // a few frames so infill, LOD fades and shadow fitting settle
      for (let i = 0; i < frames; i++) { game.renderFrame(0.05); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    }, { v, frames: +(o.frames || 3), abs: !!o.abs || !!v.abs });
    const file = path.join(out, `${tag}${label}.jpg`);
    if (o.clean) await page.addStyleTag({ content: '#topbar,#speed,#hint,#stats,#side,#pathbar,#toolbar,#settings,#toast{display:none !important}' }).catch(() => {});
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    console.log('saved ' + path.relative(ROOT, file));
  }
  if (h.errors.length) console.log('PAGE ERRORS:\n' + h.errors.slice(0, 8).join('\n'));
  if (h.badAssets.length) console.log('BAD ASSETS:\n' + h.badAssets.slice(0, 8).join('\n'));
  await h.close();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})().catch((e) => { console.error(e); process.exit(1); });

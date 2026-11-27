// Measures the light and colour of house walls as they appear on screen.
//
//   node tools/measure_walls.cjs [--scene six|town] [--view postcard|six|cam=x,y,z:tx,ty,tz]
//        [--presets low,medium,high] [--times midday,golden] [--colours F3C17B,...] [--shots dir] [--tag name]
//
// For each preset and time of day it renders the view three times: as the player
// sees it; with only the house walls drawn white (a mask: roofs, windows, ground
// and everything else black); and with the sun switched off. A wall pixel is
// "sunlit" if the sun adds a good share of its brightness, otherwise "shade".
// It reports HSL lightness of warm-coloured wall pixels (hue 10–60°, saturation
// > 0.2): the 10th / 50th / 90th percentiles in sun and in shade, and the median
// colour of each. The art target: sun ~72% (#F3C17B), shade ~46% (#9E794D),
// hue ~35°; across the paint-overs warm walls run ~37% (shade) to ~76% (sun).
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
  const scene = o.scene || 'six';
  const presets = (o.presets || 'high').split(',');
  const times = (o.times || 'midday,golden').split(',');
  const [W, H] = (o.size || '960x600').split('x').map(Number);
  const query = scene === 'six' ? `index.html?scene=six${o.colours ? '&colours=' + o.colours : ''}` : 'index.html';
  const h = await launch({ width: W, height: H, page: query, storage: { mode: 'high', style: o.style || 'painted', warmth: o.warmth || 'neutral' } });
  const { page } = h;
  await page.waitForFunction(() => !!window.game && (location.search.indexOf('six') < 0 || !!window.game.six), null, { timeout: 600000 });
  await page.evaluate(() => game.renderer.setAnimationLoop(null));
  await page.evaluate(async (scene) => {
    await game.gfx.texturesReady;
    if (scene === 'town') { game.demo(); game.growth.grow(700); game.speed = 0; for (let i = 0; i < 400 && (game.infill.busy || i < 4); i++) game.renderFrame(0.05); }
  }, scene);
  // --js "code": run in the page before measuring (to try lighting values without editing files)
  if (o.js) await page.evaluate(async (code) => { const f = new Function('game', 'return (async () => {' + code + '})()'); await f(game); }, o.js);
  if (o.shots) fs.mkdirSync(path.resolve(ROOT, o.shots), { recursive: true });
  const rows = [];
  for (const preset of presets) for (const time of times) {
    const res = await page.evaluate(async ({ preset, time, view }) => {
      const g = game, T = g.THREE, gfx = g.gfx, R = g.renderer, gl = R.getContext();
      gfx.setPreset(preset); await gfx.texturesReady;
      gfx.setTimeOfDay(time, true);
      const hb = g.terrain.harbour;
      if (view && view !== 'six') {
        const V = { postcard: [[16, 50, 90], [-2, 15, -28]], close: [[10, 14, 26], [-4, 9, -6]] };
        let v = V[view];
        if (!v) { const [p, t] = view.split(':').map((s) => s.split(',').map(Number)); v = [p, t]; }
        g.rig.tween = null;
        g.camera.position.set(hb.x + v[0][0], v[0][1], hb.z + v[0][2]);
        g.rig.controls.target.set(hb.x + v[1][0], v[1][1], hb.z + v[1][2]);
        g.rig.controls.update();
      }
      g.rig.controls.enableDamping = false;
      for (let i = 0; i < 4; i++) g.renderFrame(0.05);
      const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight;
      const grab = () => { const px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      g.renderFrame(0); const full = grab();
      // sun off
      const si = gfx.sun.intensity; gfx.sun.intensity = 0; gfx.render(); const amb = grab(); gfx.sun.intensity = si;
      // mask: only walls of the merged house mesh, white
      const swapped = [];
      const black = new T.MeshBasicMaterial({ color: 0x000000 }), white = new T.ShaderMaterial({
        vertexShader: 'varying float vUp; void main() { vUp = abs(normal.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying float vUp; void main() { gl_FragColor = vec4(vec3(vUp < 0.3 ? 1.0 : 0.0), 1.0); }',
      });
      g.scene.traverse((m) => { if (m.isMesh || m.isPoints || m.isLine) { swapped.push([m, m.material, m.visible]); m.material = m.userData.houseMass ? white : black; } });
      g.gfx.sky.visible = false;
      const bg = R.getClearColor(new T.Color()), tm = R.toneMapping;
      R.setClearColor(0x000000); R.toneMapping = T.NoToneMapping;
      const was = R.shadowMap.needsUpdate; R.shadowMap.needsUpdate = false;
      R.setRenderTarget(null); R.render(g.scene, g.camera); const mask = grab();
      R.shadowMap.needsUpdate = was; R.toneMapping = tm; R.setClearColor(bg); g.gfx.sky.visible = true;
      for (const [m, mat] of swapped) m.material = mat;
      // classify
      const hsl = (r, gg, b) => { r /= 255; gg /= 255; b /= 255; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
        let hh2 = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
          hh2 = mx === r ? (gg - b) / d + (gg < b ? 6 : 0) : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; hh2 *= 60; } return [hh2, s, l]; };
      const lum = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      const sets = { sun: [], shade: [] }, cols = { sun: [0, 0, 0, 0], shade: [0, 0, 0, 0] };
      let wallPx = 0;
      for (let i = 0; i < full.length; i += 4) {
        if (mask[i] < 200) continue;
        wallPx++;
        const [hu, s, l] = hsl(full[i], full[i + 1], full[i + 2]);
        if (hu < 10 || hu > 60 || s < 0.2) continue;
        const k = lum(full, i) - lum(amb, i) > 0.3 * lum(full, i) ? 'sun' : 'shade';
        sets[k].push(l); const c = cols[k]; c[0] += full[i]; c[1] += full[i + 1]; c[2] += full[i + 2]; c[3]++;
      }
      const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100).toFixed(1); };
      const out = { preset: gfx.presetName, time, wallPx };
      for (const k of ['sun', 'shade']) {
        const c = cols[k], n = Math.max(c[3], 1);
        const hex = '#' + [c[0], c[1], c[2]].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
        out[k] = { n: sets[k].length, p10: pct(sets[k], 0.1), p50: pct(sets[k], 0.5), p90: pct(sets[k], 0.9), mean: hex, hue: +hsl(c[0] / n, c[1] / n, c[2] / n)[0].toFixed(0) };
      }
      g.rig.controls.enableDamping = true;
      g.renderFrame(0);
      return out;
    }, { preset, time, view: o.view || (scene === 'six' ? 'six' : 'postcard') });
    console.log(JSON.stringify(res));
    rows.push(res);
    if (o.shots) {
      await page.addStyleTag({ content: '#topbar,#speed,#hint,#stats,#side,#pathbar,#toolbar,#settings,#toast{display:none !important}' }).catch(() => {});
      await page.screenshot({ path: path.resolve(ROOT, o.shots, `${o.tag ? o.tag + '_' : ''}${scene}_${preset}_${time}.jpg`), type: 'jpeg', quality: 90 });
    }
  }
  if (o.out) fs.writeFileSync(path.resolve(ROOT, o.out), JSON.stringify(rows, null, 1) + '\n');
  if (h.errors.length) console.log('PAGE ERRORS:\n' + h.errors.slice(0, 8).join('\n'));
  await h.close();
})().catch((e) => { console.error(e); process.exit(1); });

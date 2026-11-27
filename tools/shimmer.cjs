// Shimmer meter: how much a close-up view "fizzes" as the camera drifts slowly.
//
//   node tools/shimmer.cjs [--view roof|wall|paving|grazing|cam=x,y,z:tx,ty,tz] [--preset high]
//        [--variants base,noAO,noNormal,noDetail,bias1,noPaint] [--strip out.jpg]
//
// The camera drifts in tiny steps (well under a pixel of movement each). A clean,
// well-filtered picture barely changes from step to step; fizzing and crawling
// (texture or normal-map detail finer than a pixel, screen-space noise) changes a
// lot. The score is the mean absolute change in brightness between consecutive
// frames (0–255 scale) over the middle of the screen. Each variant switches one
// suspected cause off, so the scores say which one matters.
'use strict';
const path = require('node:path');
const { launch, ROOT } = require('./harness.cjs');

function parseArgs() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  return o;
}
const VIEWS = {
  roof: [[6, 26, -22], [-2, 18, -34]],
  wall: [[12, 12, 8], [0, 10, -10]],
  paving: [[4, 6, -8], [-2, 3, -20]],
  grazing: [[24, 9, -6], [-14, 8, -26]],
};

(async () => {
  const o = parseArgs();
  const variants = (o.variants || 'base,noAO,noNormal,noDetail,bias1,noPaint').split(',');
  const [W, H] = (o.size || '800x500').split('x').map(Number);
  const h = await launch({ width: W, height: H, storage: { mode: o.preset || 'high', style: o.style || 'painted', warmth: 'neutral' } });
  const { page } = h;
  await page.evaluate(() => game.renderer.setAnimationLoop(null));
  await page.evaluate(async () => {
    await game.gfx.texturesReady; game.demo(); game.growth.grow(700); game.speed = 0;
    for (let i = 0; i < 400 && (game.infill.busy || i < 4); i++) game.renderFrame(0.05);
  });
  let view = o.view === 'auto-roof' ? 'auto-roof' : VIEWS[o.view || 'roof'];
  if (!view) { const [p, t] = o.view.replace('cam=', '').split(':').map((s) => s.split(',').map(Number)); view = [p, t]; }
  const results = {};
  for (const v of variants) {
    const r = await page.evaluate(async ({ v, view, steps, strip }) => {
      const g = game, gfx = g.gfx, gl = g.renderer.getContext();
      const { matUniforms } = await import('./src/materials.js');
      const { styleUniforms } = await import('./src/style.js');
      const saved = { n: matUniforms.uNormalK.value, d: matUniforms.uDetail.value, b: matUniforms.uMipBias.value, p: styleUniforms.uPaint.value, ao: gfx.ssao && gfx.ssao.enabled };
      if (v === 'noAO' && gfx.ssao) gfx.ssao.enabled = false;
      if (v === 'noNormal') matUniforms.uNormalK.value = 0;
      if (v === 'noDetail') matUniforms.uDetail.value = 0;
      if (v === 'bias1') matUniforms.uMipBias.value = 1;
      if (v === 'noPaint') styleUniforms.uPaint.value = 0;
      const qSaved = matUniforms.uLayerQ ? matUniforms.uLayerQ.value.map((q) => q.clone()) : null;
      if (v === 'oldTex' && qSaved) matUniforms.uLayerQ.value.forEach((q) => q.set(1, 0, 0, 0));   // v0.11 texture settings
      const hb = g.terrain.harbour, T = g.THREE;
      g.rig.tween = null; g.rig.controls.enableDamping = false;
      let P = new T.Vector3(hb.x + view[0][0], view[0][1], hb.z + view[0][2]), Q = new T.Vector3(hb.x + view[1][0], view[1][1], hb.z + view[1][2]);
      if (view === 'auto-roof') {
        // a slate roof near the middle of town, seen from a few metres above (as in the bug video)
        const G = g.growth, hs = G.live.map((id) => G.buildings[id]).filter((b) => b.roof !== 'flat' && b.roofKind !== 'terracotta');
        hs.sort((a, b) => Math.hypot(a.x - hb.x, a.z - hb.z + 30) - Math.hypot(b.x - hb.x, b.z - hb.z + 30));
        const b = hs[0];
        Q = new T.Vector3(b.x, b.top + 0.6, b.z); P = new T.Vector3(b.x + 3, b.top + 6.5, b.z + 4.5);
      }
      const side = new T.Vector3().subVectors(Q, P).cross(new T.Vector3(0, 1, 0)).normalize();
      const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight;
      const grab = () => { const px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const frames = [];
      for (let i = 0; i < steps; i++) {
        g.camera.position.copy(P).addScaledVector(side, i * 0.004); g.rig.controls.target.copy(Q).addScaledVector(side, i * 0.004);
        g.camera.lookAt(g.rig.controls.target); g.camera.updateMatrixWorld();
        g.renderFrame(0); frames.push(grab());
      }
      // brightness, and its fine detail (the picture minus a 3x3 blur of itself)
      const lumOf = (a) => { const L = new Float32Array(w * hh); for (let i = 0; i < w * hh; i++) L[i] = a[i * 4] * 0.21 + a[i * 4 + 1] * 0.72 + a[i * 4 + 2] * 0.07; return L; };
      const fine = (L) => { const F = new Float32Array(w * hh); for (let y = 1; y < hh - 1; y++) for (let x = 1; x < w - 1; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += L[(y + dy) * w + x + dx]; F[y * w + x] = L[y * w + x] - s / 9; } return F; };
      const Ls = frames.map(lumOf), Fs = Ls.map(fine);
      let sum = 0, fsum = 0, fmag = 0, n = 0;
      for (let f = 1; f < frames.length; f++) {
        for (let y = hh * 0.2 | 0; y < hh * 0.8; y++) for (let x = w * 0.2 | 0; x < w * 0.8; x++) {
          const i = y * w + x;
          sum += Math.abs(Ls[f][i] - Ls[f - 1][i]); fsum += Math.abs(Fs[f][i] - Fs[f - 1][i]); fmag += Math.abs(Fs[f][i]); n++;
        }
      }
      if (qSaved) qSaved.forEach((q, i) => matUniforms.uLayerQ.value[i].copy(q));
      if (gfx.ssao) gfx.ssao.enabled = saved.ao;
      matUniforms.uNormalK.value = saved.n; matUniforms.uDetail.value = saved.d; matUniforms.uMipBias.value = saved.b; styleUniforms.uPaint.value = saved.p;
      g.rig.controls.enableDamping = true;
      return { score: +(sum / n).toFixed(3), fizz: +(fsum / Math.max(fmag, 1e-6)).toFixed(3), detail: +(fmag / n).toFixed(2) };
    }, { v, view, steps: +(o.steps || 6) });
    results[v] = r;
    console.log(v.padEnd(10), 'change', r.score, ' fizz (fine-detail change ÷ fine detail)', r.fizz, ' fine detail', r.detail);
    if (o.strip) await page.screenshot({ path: path.resolve(ROOT, o.strip.replace('.jpg', '_' + v + '.jpg')), type: 'jpeg', quality: 90 });
  }
  console.log(JSON.stringify(results));
  if (h.errors.length) console.log('PAGE ERRORS:\n' + h.errors.slice(0, 8).join('\n'));
  await h.close();
})().catch((e) => { console.error(e); process.exit(1); });

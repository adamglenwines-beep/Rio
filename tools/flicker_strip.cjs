// Flicker recorder: frame strips and a popping-pixel count for the bug-report views.
//
//   node tools/flicker_strip.cjs --out dir --tag before [--views wide,clipping,washing,roof] [--preset high] [--time golden]
//
// For each view the camera drifts in tiny steps (a few millimetres, well under a pixel
// at that distance). A steady picture changes smoothly; z-fighting (two surfaces at
// the same depth), parts popping in and out, and screen-space noise make pixels jump.
// "Popping" = the share of pixels whose brightness jumps by more than 40 (of 255)
// between consecutive frames. Saves <tag>_<view>_strip.jpg (frames side by side,
// cropped to the middle) and <tag>_<view>_pops.png (where pixels popped, white).
// The views approximate the camera positions in Rio-reference/bug-reports.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, ROOT } = require('./harness.cjs');

const VIEWS = {
  // [camera offset from harbour], [target offset from harbour]
  wide: [[6, 34, 118], [-6, 22, -40]],        // window-flicker-wide-v0.11: the whole town from out on the water
  clipping: [[16, 30, 30], [-6, 20, -16]],    // window-clipping-v0.10: tall houses packed together, close
  washing: [[10, 16, 10], [-2, 12, -6]],      // washing-flicker-v0.11: a facade with washing, close up
  roof: [[6, 26, -22], [-2, 18, -34]],        // roof-texture-shimmer-v0.10: looking down onto a slate roof
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
  const views = (o.views || 'wide,clipping,washing,roof').split(',');
  const [W, H] = (o.size || '960x600').split('x').map(Number);
  const steps = +(o.steps || 8);
  const h = await launch({ width: W, height: H, storage: { mode: o.preset || 'high', style: 'painted', warmth: o.warmth || 'warm' } });
  const { page } = h;
  await page.evaluate(() => game.renderer.setAnimationLoop(null));
  await page.evaluate(async (time) => {
    await game.gfx.texturesReady; game.demo(); game.growth.grow(700); game.speed = 0;
    game.gfx.setTimeOfDay(time, true);
    for (let i = 0; i < 400 && (game.infill.busy || i < 4); i++) game.renderFrame(0.05);
  }, o.time || 'golden');
  const report = {};
  for (const name of views) {
    const v = VIEWS[name];
    const r = await page.evaluate(async ({ v, steps }) => {
      const g = game, gl = g.renderer.getContext(), T = g.THREE, hb = g.terrain.harbour;
      g.rig.tween = null; g.rig.controls.enableDamping = false;
      const P = new T.Vector3(hb.x + v[0][0], v[0][1], hb.z + v[0][2]), Q = new T.Vector3(hb.x + v[1][0], v[1][1], hb.z + v[1][2]);
      const side = new T.Vector3().subVectors(Q, P).cross(new T.Vector3(0, 1, 0)).normalize();
      const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight, frames = [];
      const step = P.distanceTo(Q) * 0.00012;   // about a fifth of a pixel at the target
      for (let i = 0; i < steps; i++) {
        g.camera.position.copy(P).addScaledVector(side, i * step); g.rig.controls.target.copy(Q).addScaledVector(side, i * step);
        g.rig.controls.update(); g.renderFrame(0);
        const px = new Uint8Array(w * hh * 4); gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px); frames.push(px);
      }
      const pops = new Uint8Array(w * hh);
      let n = 0;
      const L = (a, i) => a[i] * 0.21 + a[i + 1] * 0.72 + a[i + 2] * 0.07;
      for (let f = 1; f < frames.length; f++) for (let i = 0; i < w * hh; i++) if (Math.abs(L(frames[f], i * 4) - L(frames[f - 1], i * 4)) > 40) { pops[i] = 255; n++; }
      g.rig.controls.enableDamping = true;
      // frames back as base64 PNG-free raw (crop middle 40% x 50%) to stitch in node
      const cx0 = w * 0.3 | 0, cy0 = hh * 0.25 | 0, cw = w * 0.4 | 0, ch = hh * 0.5 | 0;
      const crops = [0, 1, 2, 3].map((k) => { const f = frames[Math.min(frames.length - 1, k * 2)], c = new Uint8Array(cw * ch * 3);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = ((hh - 1 - (cy0 + y)) * w + cx0 + x) * 4, di = (y * cw + x) * 3; c[di] = f[si]; c[di + 1] = f[si + 1]; c[di + 2] = f[si + 2]; }
        return Array.from(c); });
      const mask = []; for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) mask.push(pops[(hh - 1 - y) * w + x]);
      return { popping: +(100 * n / ((frames.length - 1) * w * hh)).toFixed(4), crops, cw, ch, mask, w, hh };
    }, { v, steps });
    report[name] = r.popping;
    console.log(`${name.padEnd(9)} popping pixels ${r.popping}% per frame`);
    // stitch with a tiny PPM → convert via python (PIL) to keep node dependency-free
    const base = path.join(out, `${o.tag || 'run'}_${name}`);
    const strip = Buffer.alloc(r.cw * 4 * r.ch * 3);
    for (let k = 0; k < 4; k++) for (let y = 0; y < r.ch; y++) for (let x = 0; x < r.cw; x++) {
      const si = (y * r.cw + x) * 3, di = (y * r.cw * 4 + k * r.cw + x) * 3;
      strip[di] = r.crops[k][si]; strip[di + 1] = r.crops[k][si + 1]; strip[di + 2] = r.crops[k][si + 2];
    }
    fs.writeFileSync(base + '_strip.ppm', Buffer.concat([Buffer.from(`P6 ${r.cw * 4} ${r.ch} 255\n`), strip]));
    fs.writeFileSync(base + '_pops.pgm', Buffer.concat([Buffer.from(`P5 ${r.w} ${r.hh} 255\n`), Buffer.from(r.mask)]));
    require('node:child_process').execFileSync('python3', ['-c',
      `from PIL import Image;import sys;b=sys.argv[1];Image.open(b+'_strip.ppm').save(b+'_strip.jpg',quality=88);Image.open(b+'_pops.pgm').save(b+'_pops.png');import os;os.remove(b+'_strip.ppm');os.remove(b+'_pops.pgm')`, base]);
  }
  fs.writeFileSync(path.join(out, `${o.tag || 'run'}_popping.json`), JSON.stringify(report, null, 1) + '\n');
  if (h.errors.length) console.log('PAGE ERRORS:\n' + h.errors.slice(0, 8).join('\n'));
  await h.close();
})().catch((e) => { console.error(e); process.exit(1); });

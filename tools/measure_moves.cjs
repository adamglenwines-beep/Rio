// Frame times during a scripted orbit + zoom: total, and the part that is game code (everything except drawing).
const { launch } = require('./harness.cjs');
(async () => {
  for (const preset of ['medium', 'high']) {
    const h = await launch({ width: 960, height: 600, storage: { mode: preset, style: 'painted' } });
    const { page } = h;
    await page.evaluate(() => game.renderer.setAnimationLoop(null));
    const r = await page.evaluate(async () => {
      await game.gfx.texturesReady; game.demo(); game.growth.grow(400); game.speed = 0;
      for (let i = 0; i < 40 && (game.infill.busy || i < 4); i++) game.renderFrame(0.05);
      const gl = game.renderer.getContext(), px = new Uint8Array(4);
      const gfx = game.gfx, orig = gfx.render.bind(gfx);
      let draw = 0;
      gfx.render = () => { const t = performance.now(); orig(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); draw = performance.now() - t; };
      const c = game.rig.controls, total = [], js = [];
      for (let f = 0; f < 36; f++) {
        if (f < 18) c._rotateLeft(0.03); else { c._dollyIn ? c._dollyIn(1.03) : 0; c._rotateUp(0.004); }
        const t0 = performance.now();
        game.renderFrame(1 / 60);
        const t = performance.now() - t0;
        total.push(t); js.push(t - draw);
      }
      gfx.render = orig;
      const st = (a) => { const s = [...a].sort((x, y) => x - y); return { median: +s[s.length >> 1].toFixed(2), max: +s[s.length - 1].toFixed(2), min: +s[0].toFixed(2) }; };
      return { preset: gfx.presetName, total: st(total), js: st(js), series: total.map((v) => Math.round(v)) };
    });
    console.log(JSON.stringify(r));
    await h.close();
  }
})();

// Browser smoke + regression test (Playwright + headless Chromium, software WebGL).
// Usage: node tests/browser/run.cjs [--update-baseline]
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const SLOWDOWN_LIMIT = 1.6;

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = loadPlaywright();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/** Serve the repo under /Rio/, like GitHub Pages. */
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/Rio/')) { res.writeHead(404); return res.end('not under /Rio/'); }
    p = p.slice('/Rio/'.length) || 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(ROOT, p);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  page.setDefaultNavigationTimeout(300000);

  // This sandbox blocks the CDN: serve jsdelivr npm files from node_modules when they exist.
  await page.route('https://cdn.jsdelivr.net/npm/**', (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/((?:@[^/@]+\/)?[^/@]+)@[^/]+\/(.+)$/);
    if (m) {
      const file = path.join(ROOT, 'node_modules', m[1], m[2]);
      if (file.startsWith(path.join(ROOT, 'node_modules')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
    }
    return route.continue();
  });

  const errors = [];
  const badAssets = [];
  const ignorable = (t) => /GPU stall|GL Driver Message|Performance|performance|ReadPixels/i.test(t);
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push('console.error: ' + m.text());
  });
  page.on('requestfailed', (r) => { if (/\/Rio\/assets\//.test(r.url())) badAssets.push('FAILED ' + r.url()); });
  page.on('response', (r) => { if (r.url().includes('/Rio/assets/') && r.status() !== 200) badAssets.push(r.status() + ' ' + r.url()); });

  const timings = {};
  try {
    await page.goto(`http://127.0.0.1:${port}/Rio/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.game, null, { timeout: 300000 });

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

  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

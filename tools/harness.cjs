// Shared headless-browser harness for tests and screenshot tools.
// Serves the repo under /Rio/ (like GitHub Pages), opens the game in headless
// Chromium (software WebGL) and serves the CDN modules from node_modules.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.hdr': 'application/octet-stream',
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
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Start a server + browser and open a page of the game.
 * opts: { width, height, page: 'index.html' | other path, storage: {key: value} (localStorage, 'borgo.' prefix added) }
 * Returns { page, browser, server, errors, badAssets, url, close() }.
 */
async function launch(opts = {}) {
  const { chromium } = loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: opts.width || 1280, height: opts.height || 800 }, deviceScaleFactor: opts.dpr || 1 });
  if (opts.storage) {
    await context.addInitScript((s) => { for (const k in s) try { localStorage.setItem('borgo.' + k, s[k]); } catch (e) { /* ignore */ } }, opts.storage);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(600000);
  page.setDefaultNavigationTimeout(600000);

  // The sandbox blocks the CDN: serve jsdelivr npm files from node_modules when they exist.
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

  const errors = [], badAssets = [];
  const ignorable = (t) => /GPU stall|GL Driver Message|Performance|performance|ReadPixels/i.test(t);
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push('console.error: ' + m.text());
    if (opts.log && m.type() === 'log') console.log('[page]', m.text());
  });
  page.on('requestfailed', (r) => { if (/\/Rio\/assets\//.test(r.url())) badAssets.push('FAILED ' + r.url()); });
  page.on('response', (r) => { if (r.url().includes('/Rio/assets/') && r.status() !== 200) badAssets.push(r.status() + ' ' + r.url()); });

  const url = `http://127.0.0.1:${port}/Rio/${opts.page || ''}`;
  await page.goto(url, { waitUntil: 'load' });
  if (!opts.page || opts.page === 'index.html') {
    await page.waitForFunction(() => !!window.game, null, { timeout: 600000 });
  }
  return { page, browser, server, errors, badAssets, url, close: async () => { await browser.close(); server.close(); } };
}

module.exports = { ROOT, TYPES, startServer, launch, loadPlaywright };

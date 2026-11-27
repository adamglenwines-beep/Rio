// Shared helpers for the unit tests: builds a minimal "game" like src/main.js, without DOM/WebGL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const mat = await import('../../src/materials.js');
mat.setManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/textures/web/manifest.json'), 'utf8')));

const { CONFIG } = await import('../../src/config.js');
const { Terrain } = await import('../../src/terrain.js');
const { PathNetwork } = await import('../../src/paths.js');
const { Zones } = await import('../../src/zones.js');
const { computeAccess } = await import('../../src/access.js');
const { Growth } = await import('../../src/growth.js');
const { layDemo } = await import('../../src/demo.js');

export function makeGame(seed = CONFIG.seed) {
  const terrain = new Terrain(seed);
  const paths = new PathNetwork(terrain);
  const zones = new Zones(terrain);
  const game = { terrain, paths, zones, speed: 1, access: null };
  game.growth = new Growth(game);
  let seenPaths = -1, seenZones = -1;
  game.refreshAccess = (force = false) => {
    if (!force && seenPaths === paths.version && seenZones === zones.version) return;
    const pathsChanged = seenPaths !== paths.version;
    seenPaths = paths.version; seenZones = zones.version;
    if (pathsChanged || !game.access) game.access = computeAccess(terrain, paths);
    zones.refresh(game.access);
    game.growth.onAccessChanged();
  };
  game.reset = () => { paths.clear(); zones.clear(); game.growth.clear(); game.refreshAccess(true); };
  game.demo = () => { layDemo(game); game.refreshAccess(true); };
  game.refreshAccess(true);
  return game;
}

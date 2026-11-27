// ---------------------------------------------------------------------------
// demo.js — lays out a sample village (paths + zones) so you can see growth
// without drawing anything yourself. Positions are relative to the ravine,
// so it adapts if you change the terrain seed.
// ---------------------------------------------------------------------------
import { ZONE } from './zones.js';

export function layDemo(game) {
  const t = game.terrain, h = t.harbour;
  // a point `dz` metres inland of the harbour, `dx` metres off the ravine line
  const P = (dz, dx = 0) => { const z = h.z + dz; return { x: t.ravineX(z) + dx, z }; };

  game.reset();
  const paths = game.paths;
  // The main street climbing the ravine floor.
  paths.addPath([{ x: h.x, z: h.z }, P(-14), P(-30), P(-48), P(-66), P(-84), P(-98)]);
  for (const side of [-1, 1]) {
    // Stairs climbing each flank from the main street (they zig-zag where steep)…
    paths.addPath([P(-10), P(-8, side * 16), P(-4, side * 34)]);
    paths.addPath([P(-40), P(-38, side * 16), P(-34, side * 36)]);
    paths.addPath([P(-72), P(-70, side * 16), P(-66, side * 34)]);
    // …and lanes running along the hillside, linking them.
    paths.addPath([P(-8, side * 16), P(-38, side * 16), P(-70, side * 16), P(-92, side * 14)]);
    paths.addPath([P(-4, side * 34), P(-34, side * 36), P(-66, side * 34)]);
  }

  // Two diagonal stairs forking off the main street at a sharp angle (pointed
  // corner buildings grow in the forks).
  paths.addPath([P(-22), P(-31, -9), P(-38, -16)]);
  paths.addPath([P(-54), P(-62, 9), P(-68, 16)]);

  // Homes on both flanks, shops on the harbour floor.
  const zones = game.zones;
  for (let dz = -2; dz >= -96; dz -= 3) {
    for (const side of [-1, 1]) {
      for (let dx = 5; dx <= 44; dx += 3) {
        const p = P(dz, side * dx);
        zones.paint(p.x, p.z, 3.2, ZONE.RES);
      }
    }
  }
  // the waterfront either side of the piazza
  for (let dx = -24; dx <= 24; dx += 3) {
    const x = t.ravineX(h.z) + dx, z = t.coastZ(x) - 5;    // right down to the quay
    zones.paint(x, z, 4, ZONE.RES);
  }
  for (const dz of [-2, -8, -14]) { const p = P(dz); zones.paint(p.x, p.z, 6, ZONE.COM); }

  // A few vine and olive terraces around the town (the rest of the hillside stays wild).
  if (game.terraces) {
    const T = game.terraces;
    T.clear();
    T.addArea({ ...P(-52, 66), r: 26, crop: 'vine' });
    T.addArea({ ...P(-84, 58), r: 22, crop: 'vine' });
    T.addArea({ ...P(-18, -62), r: 22, crop: 'vine' });
    T.addArea({ ...P(-60, -64), r: 26, crop: 'vine' });
    T.addArea({ ...P(-104, -40), r: 20, crop: 'olive' });
    T.addArea({ ...P(-108, 30), r: 18, crop: 'olive' });
    game.rebuildLandscape();
  }
}

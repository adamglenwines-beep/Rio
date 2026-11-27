// ---------------------------------------------------------------------------
// houseplan.js — what a house is, floor by floor, as the simulation sees it (v0.13).
// Pure game state: no Three.js, no DOM (see CLAUDE.md), so a later engine port can
// reuse it. Content comes from data/houses.json.
//
//   plan = { condition, floors: [{ use }] }      floors[0] is the ground floor
//
// condition 0..1: 0 = crumbling plaster and faded paint, 1 = freshly painted. For now it
// is drawn once from the house's seed (mostly in the middle); later a household's wealth
// can move it. The renderer (buildings.js) turns it into plaster wear, paint fade and
// tidiness. Floor uses ('family', 'shop', 'workshop', 'cellar') decide what the ground
// floor shows on its lane; later the player can set them.
// ---------------------------------------------------------------------------
import { HOUSES } from './data.js';
import { makeRng } from './noise.js';

/** A seeded bell-ish curve (mean of three uniforms), scaled to the data's spread. */
function bell(rng, mean, spread) { return mean + ((rng() + rng() + rng()) / 3 - 0.5) * 2 * spread * 1.7; }

/**
 * Make (or refresh) a house's plan. `nearHarbour`: within the harbour and piazza area.
 * Keeps an existing plan's condition and ground use, and adds or drops upper floors.
 */
export function planHouse(b, floors, nearHarbour) {
  const H = HOUSES, rng = makeRng((b.seed ^ 0x5bd1e995) >>> 0);
  const c = H.condition;
  const condition = b.plan ? b.plan.condition : Math.min(c.max, Math.max(c.min, bell(rng, c.mean, c.spread)));
  const groundUse = b.plan ? b.plan.floors[0].use : rng.weighted(H.groundUse[nearHarbour ? 'harbour' : 'town']);
  const arched = b.plan ? b.plan.arched : rng() < H.archedEntry;
  const list = [{ use: b.kind === 2 ? 'shop' : groundUse }];
  for (let k = 1; k < floors; k++) list.push({ use: (b.plan && b.plan.floors[k]) ? b.plan.floors[k].use : 'family' });
  b.plan = { condition, floors: list, arched };
  return b.plan;
}

/** The ground-floor look for a use: 'shop' | 'workshop' | 'arched' | 'door'. */
export function groundLook(plan) {
  const use = plan.floors[0].use;
  if (use === 'shop') return 'shop';
  if (use === 'workshop') return plan.arched ? 'arched' : 'workshop';
  return plan.arched ? 'arched' : 'door';
}

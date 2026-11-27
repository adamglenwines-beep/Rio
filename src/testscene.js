// ---------------------------------------------------------------------------
// testscene.js — a small test scene for tuning light and colour: six real houses
// from the demo town (made by the same generator, under the game's own lighting),
// with everything else on the hillside left out, and the camera on a corner so
// both a sunlit and a shaded wall show.
//
// Open it with  index.html?scene=six
// Options:      &colours=F3C17B,E5CE91,...   paint the six houses these colours
//               &condition=0.1,0.9,...       each house's condition (0 crumbling … 1 fresh)
//               &time=midday|golden          &quality=low|medium|high
// The houses are the six closest to a point on the harbour front; the camera
// framing is in VIEW below.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const VIEW = { cam: [17, 4, 30], target: [-1, 5, -2] };   // offsets from the group's middle

export function setupSixHouses(game, params) {
  game.demo();
  game.growth.grow(700);
  game.speed = 0;
  const G = game.growth, hb = game.terrain.harbour;
  // six neighbouring houses on the harbour front, just east of the piazza
  const centre = [hb.x + 9, hb.z - 9];
  const pick = G.live.map((id) => G.buildings[id]).filter((b) => !b.arch)
    .sort((a, b) => Math.hypot(a.x - centre[0], a.z - centre[1]) - Math.hypot(b.x - centre[0], b.z - centre[1])).slice(0, 6);
  const colours = (params.get('colours') || '').split(',').filter(Boolean);
  const conds = (params.get('condition') || '').split(',').filter(Boolean).map(Number);
  pick.forEach((b, i) => {
    if (colours[i % colours.length]) { b.facade = new THREE.Color('#' + colours[i % colours.length].replace('#', '')); b.ver = (b.ver || 0) + 1; }
    if (conds.length && b.plan) { b.plan.condition = conds[i % conds.length]; b.ver = (b.ver || 0) + 1; }
  });
  game.growth.renderer.rebuild(pick);
  game.growth.update = () => {};            // nothing grows or re-meshes in the test scene
  game.infill.group.visible = false;
  game.six = pick;
  let mx = 0, my = 0, mz = 0;
  for (const b of pick) { mx += b.x / 6; mz += b.z / 6; my += b.top / 6; }
  const c = new THREE.Vector3(mx, my * 0.6, mz);
  game.rig.tween = null;
  game.camera.position.set(c.x + VIEW.cam[0], c.y + VIEW.cam[1], c.z + VIEW.cam[2]);
  game.rig.controls.target.set(c.x + VIEW.target[0], c.y + VIEW.target[1] - 6, c.z + VIEW.target[2]);
  game.rig.controls.update();
  if (params.get('time')) game.gfx.setTimeOfDay(params.get('time'), true);
  if (params.get('quality')) game.gfx.setPreset(params.get('quality'));
  return pick;
}

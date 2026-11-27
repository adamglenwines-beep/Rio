// ---------------------------------------------------------------------------
// main.js — sets up the renderer, the world, and the frame loop.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Terrain } from './terrain.js';
import { Sea } from './water.js';
import { CameraRig } from './camera.js';
import { PathNetwork } from './paths.js';
import { Zones } from './zones.js';
import { computeAccess } from './access.js';
import { Growth } from './growth.js';
import { layDemo } from './demo.js';
import { Scenery } from './scenery.js';
import { Terraces } from './terraces.js';
import { Infill } from './infill.js';
import { UI } from './ui.js';
import { Graphics } from './gfx.js';
import { VERSION } from './version.js';
import { STYLES, applyStyleToMaterials } from './style.js';
import { loadManifest } from './materials.js';

// the texture manifest (layer order) must be known before any material compiles
await loadManifest();

// ---- Renderer ---------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
app.appendChild(renderer.domElement);

// ---- Scene, lights, sky, quality settings and time of day (see gfx.js) --------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.layers.enableAll();

// ---- World ------------------------------------------------------------------
const terrain = new Terrain(CONFIG.seed);
scene.add(terrain.mesh, terrain.outer);
const sea = new Sea(terrain);
scene.add(sea.group);
const paths = new PathNetwork(terrain);
scene.add(paths.group);
const zones = new Zones(terrain);
scene.add(zones.mesh);

const rig = new CameraRig(camera, renderer.domElement, terrain);
fitCamera();
rig.postcard(true);

const terraces = new Terraces(terrain);
scene.add(terraces.group);
const scenery = new Scenery(terrain, terraces);
scene.add(scenery.group);

const game = { THREE, scene, camera, renderer, terrain, sea, rig, paths, zones, scenery, terraces, speed: 1, access: null };
game.gfx = new Graphics(game, renderer, scene, camera);
game.growth = new Growth(game);
scene.add(game.growth.group);
game.infill = new Infill(game);
scene.add(game.infill.group);

/** Recompute walking effort whenever paths or zones change. */
let seenPaths = -1, seenZones = -1;
game.refreshAccess = (force = false) => {
  if (!force && seenPaths === paths.version && seenZones === zones.version) return;
  const pathsChanged = seenPaths !== paths.version;
  seenPaths = paths.version; seenZones = zones.version;
  if (pathsChanged || !game.access) game.access = computeAccess(terrain, paths);
  zones.refresh(game.access);
  game.growth.onAccessChanged();
};
/** Re-cut the terraces and re-seed the wild plants (after terrace areas change). */
game.rebuildLandscape = () => { terraces.rebuild(game); scenery.regenerate(); };
game.reset = () => { paths.clear(); zones.clear(); game.growth.clear(); terraces.clear(); game.rebuildLandscape(); game.refreshAccess(true); };
game.demo = () => { layDemo(game); game.refreshAccess(true); };
game.refreshAccess(true);
/** Switch the whole scene to an art style ('clean' | 'soft' | 'painted'). */
game.setStyle = (name) => {
  const st = STYLES[name] || STYLES.clean;
  game.gfx.setStyle(name);
  applyStyleToMaterials(st);
  terrain.setStyle(st);
  scenery.setStyle(st);
  game.infill.setStyle(st);
  game.growth.renderer.setStyle(st, game.growth.live.map((id) => game.growth.buildings[id]));
};
game.setStyle(game.gfx.styleName);
game.ui = new UI(game);
window.game = game; // handy for poking at things from the browser console

// ---- Frame loop -------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0, seenRebuilds = -1, seenSceneryPaths = -1, infillTimer = 0;
function frame() {
  const raw = clock.getDelta();
  game.renderFrame(Math.min(raw, 0.1), raw);
}
/** One frame: simulate, update, draw (also used by tests to time frames). */
game.renderFrame = (dt, rawDt = dt) => {
  elapsed += dt;
  game.refreshAccess();
  game.growth.update(dt * game.speed);
  // leftover spaces fill with life; terraces & trees make way for lanes, houses and infill
  // (the infill re-plan is spread over frames, a few ms each, so it never stutters)
  infillTimer -= dt;
  if (!game.infill.busy && infillTimer <= 0 &&
      (seenRebuilds !== game.growth.rebuilds || seenSceneryPaths !== paths.version)) {
    seenRebuilds = game.growth.rebuilds; seenSceneryPaths = paths.version;
    infillTimer = CONFIG.infill.refreshSeconds;
    game.infill.start();
  }
  if (game.infill.busy && game.infill.work(CONFIG.infill.frameBudgetMs)) { terraces.refresh(game.growth, game.infill); scenery.refresh(game.growth, game.infill); }
  rig.update(dt);
  camera.updateMatrixWorld();   // everything drawn this frame uses this frame's camera
  sea.update(elapsed);
  game.ui.update(dt);
  game.gfx.update(dt, rawDt);
  game.gfx.render();
};
renderer.setAnimationLoop(frame);

/** Tall phone screens get a wider lens so the cove still fits side to side. */
function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  const minHFov = 40 * Math.PI / 180;
  const vfov = 2 * Math.atan(Math.tan(minHFov / 2) / camera.aspect) * 180 / Math.PI;
  camera.fov = THREE.MathUtils.clamp(vfov, 45, 62);
  camera.updateProjectionMatrix();
  if (window.game && window.game.gfx) window.game.gfx.resize(); else renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitCamera);
document.getElementById('loading').remove();
document.getElementById('version').textContent = VERSION;
console.log('Borgo', VERSION);

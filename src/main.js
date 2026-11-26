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
import { UI } from './ui.js';

// ---- Renderer ---------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap for phones
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
app.appendChild(renderer.domElement);

// ---- Scene, sky and light ---------------------------------------------------
const scene = new THREE.Scene();
const skyTop = new THREE.Color('#3f97d6'), skyHorizon = new THREE.Color('#cfe7f2');
scene.background = makeSkyTexture(skyTop, skyHorizon);
scene.fog = new THREE.Fog(skyHorizon, 260, 720);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 2000);

scene.add(new THREE.HemisphereLight('#e6f4ff', '#9a8466', 1.55));
// Warm afternoon sun from the sea side, so the facades facing the water glow.
const sun = new THREE.DirectionalLight('#fff0d4', 2.9);
sun.position.set(110, 140, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 10; sc.far = 450;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);

// ---- World ------------------------------------------------------------------
const terrain = new Terrain(CONFIG.seed);
scene.add(terrain.mesh);
const sea = new Sea(terrain);
scene.add(sea.group);
const paths = new PathNetwork(terrain);
scene.add(paths.group);
const zones = new Zones(terrain);
scene.add(zones.mesh);

const rig = new CameraRig(camera, renderer.domElement, terrain);
fitCamera();
rig.postcard(true);

const scenery = new Scenery(terrain);
scene.add(scenery.group);

const game = { THREE, scene, camera, renderer, terrain, sea, rig, paths, zones, scenery, speed: 1, access: null };
game.growth = new Growth(game);
scene.add(game.growth.group);

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
game.reset = () => { paths.clear(); zones.clear(); game.growth.clear(); game.refreshAccess(true); };
game.demo = () => { layDemo(game); game.refreshAccess(true); };
game.refreshAccess(true);
game.ui = new UI(game);
window.game = game; // handy for poking at things from the browser console

// ---- Frame loop -------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0, seenRebuilds = -1, seenSceneryPaths = -1;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;
  game.refreshAccess();
  game.growth.update(dt * game.speed);
  // terraces & trees make way for new lanes and houses
  if (seenRebuilds !== game.growth.rebuilds || seenSceneryPaths !== paths.version) {
    seenRebuilds = game.growth.rebuilds; seenSceneryPaths = paths.version;
    scenery.refresh(game.growth);
  }
  rig.update(dt);
  sea.update(elapsed);
  game.ui.update(dt);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

/** Tall phone screens get a wider lens so the cove still fits side to side. */
function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  const minHFov = 40 * Math.PI / 180;
  const vfov = 2 * Math.atan(Math.tan(minHFov / 2) / camera.aspect) * 180 / Math.PI;
  camera.fov = THREE.MathUtils.clamp(vfov, 45, 62);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', fitCamera);
document.getElementById('loading').remove();

// A vertical gradient for the sky.
function makeSkyTexture(top, horizon) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + top.getHexString());
  grad.addColorStop(0.75, '#' + horizon.getHexString());
  grad.addColorStop(1, '#' + horizon.getHexString());
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// ui.js — toolbar, hints, and turning pointer/touch input into tool actions.
//
// Tools
//   Look    : one finger / left-drag orbits the camera.
//   Path    : tap points on the ground; drag still orbits. "Finish" commits.
//   Homes / Shops / Unzone : one finger / left-drag paints. Pinch/two fingers
//             still zoom & pan; on desktop right-drag rotates.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { ZONE } from './zones.js';

const TAP_MOVE_PX = 10, TAP_MS = 450;
const BRUSH_RADIUS = 6;

const HINTS = {
  view: 'Drag to look around · pinch or scroll to zoom · two fingers / right-drag to pan',
  path: 'Tap the ground to lay stairs. Start at the harbour or an existing path. Steep climbs zig-zag automatically.',
  res: 'Paint homes on the hillside. They grow where a path connects to the harbour. (Desktop: right-drag rotates.)',
  com: 'Paint shops — they like flat ground near the harbour.',
  erase: 'Rub out zoning.',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);
    this.tool = 'view';
    this.slopeOn = false;
    this.pointers = new Map();
    this.painting = false;
    this.pendingPaint = null;
    this.lastPaint = null;
    this.draft = [];
    this.raycaster = new THREE.Raycaster();

    // ---- buttons ----
    document.querySelectorAll('#toolbar button').forEach((b) => (b.onclick = () => this.setTool(b.dataset.tool)));
    document.querySelectorAll('#speed button').forEach((b) => (b.onclick = () => this.setSpeed(+b.dataset.speed)));
    this.$('btn-postcard').onclick = () => game.rig.postcard();
    this.$('btn-top').onclick = () => game.rig.overview();
    this.$('btn-slope').onclick = () => this.toggleSlopes();
    this.$('btn-demo').onclick = () => { game.demo(); this.toast('Demo village laid out — press ▶▶ and watch it grow'); };
    this.$('btn-reset').onclick = () => { game.reset(); this.cancelDraft(); this.toast('Cleared'); };
    this.$('btn-path-done').onclick = () => this.finishPath();
    this._initSettings();
    this.$('btn-path-undo').onclick = () => { this.draft.pop(); this.updateDraft(); };

    // ---- 3D helpers: brush ring and path waypoint pins ----
    const ring = new THREE.RingGeometry(BRUSH_RADIUS - 0.5, BRUSH_RADIUS, 48);
    ring.rotateX(-Math.PI / 2);
    this.brush = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthTest: false }));
    this.brush.renderOrder = 10;
    this.brush.visible = false;
    game.scene.add(this.brush);
    this.pinGeo = new THREE.CylinderGeometry(0.35, 0.35, 3, 8).translate(0, 1.5, 0);
    this.pinMat = new THREE.MeshBasicMaterial({ color: '#f39a4a' });
    this.pinSnapMat = new THREE.MeshBasicMaterial({ color: '#2f9e5b' });
    this.pins = new THREE.Group();
    game.scene.add(this.pins);

    // ---- pointer input ----
    const el = game.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('pointerleave', () => { if (!this.painting) this.brush.visible = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.setTool('view');
    this.setSpeed(1);
  }

  // ---- graphics settings panel ---------------------------------------------

  _initSettings() {
    const gfx = this.game.gfx, panel = this.$('settings');
    this.$('btn-settings').onclick = () => {
      panel.hidden = !panel.hidden;
      this.$('btn-settings').classList.toggle('on', !panel.hidden);
    };
    panel.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => gfx.setPreset(b.dataset.q)));
    panel.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => gfx.setResolution(+b.dataset.r)));
    panel.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => gfx.setTimeOfDay(b.dataset.t)));
    panel.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => this.game.setStyle(b.dataset.s)));
    panel.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => gfx.setWarmth(b.dataset.w)));
    const sync = () => {
      panel.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === gfx.mode));
      panel.querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.r - gfx.resolution) < 0.01));
      panel.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === gfx.timeName));
      panel.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === gfx.styleName));
      panel.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === gfx.warmth));
      this.$('set-auto-note').textContent = gfx.mode === 'auto' ? `Auto is using ${gfx.preset.label}` : '';
      this.$('set-fps').textContent = `${Math.round(gfx._fps.fps)} fps · ${gfx._fps.ms.toFixed(1)} ms a frame (slowest ${Math.round(gfx._fps.worst)} ms) · ${Math.round(gfx.pixelRatio * 100)}% pixel density`;
    };
    gfx.onChange(sync);
    gfx.timeName = gfx.timeName || 'midday';
    sync();
  }

  // ---- tools ----------------------------------------------------------------

  isPaintTool(t = this.tool) { return t === 'res' || t === 'com' || t === 'erase'; }

  setTool(tool) {
    if (this.tool === 'path' && tool !== 'path' && this.draft.length >= 2) this.finishPath();
    else if (tool !== 'path') this.cancelDraft();
    this.tool = tool;
    document.querySelectorAll('#toolbar button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    this.game.rig.setPaintMode(this.isPaintTool());
    this.game.zones.setEmphasis(this.isPaintTool() || tool === 'path');
    this.$('pathbar').style.display = tool === 'path' ? 'flex' : 'none';
    this.brush.visible = false;
    this.brush.material.color.set(tool === 'res' ? '#bff5b0' : tool === 'com' ? '#bfe0ff' : '#ffffff');
    this.hint(HINTS[tool]);
  }

  setSpeed(s) {
    this.game.speed = s;
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s));
  }

  toggleSlopes() {
    this.slopeOn = !this.slopeOn;
    this.game.terrain.showSlopeBands(this.slopeOn);
    this.$('btn-slope').classList.toggle('on', this.slopeOn);
    this.hint(this.slopeOn ? 'Slopes: green flat · yellow moderate · orange steep · red cliff (nothing grows)' : HINTS[this.tool]);
  }

  hint(text) {
    const el = this.$('hint');
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
    clearTimeout(this._hintTimer);
    if (text) this._hintTimer = setTimeout(() => (el.style.display = 'none'), 9000);
  }

  toast(text) {
    const el = this.$('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---- picking ----------------------------------------------------------------

  pick(e) {
    const r = this.game.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    return this.game.terrain.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  // ---- pointer events -------------------------------------------------------

  onDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
    if (this.pointers.size > 1) { this.painting = false; this.pendingPaint = null; return; } // second finger → camera gesture
    const primary = e.pointerType !== 'mouse' || e.button === 0;
    if (this.isPaintTool() && primary) {
      this.lastPaint = null;
      if (e.pointerType === 'mouse') { this.painting = true; this.paintAt(e); }
      // On touch, wait a moment: if a second finger lands it's a pinch, not paint.
      else this.pendingPaint = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  }

  /** Start a delayed touch stroke once it's clearly a one-finger drag. */
  _maybeStartPaint(e) {
    const p = this.pendingPaint;
    if (!p || this.pointers.size !== 1) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.t > 90) {
      this.pendingPaint = null;
      this.painting = true;
      this.paintAt({ clientX: p.x, clientY: p.y });
    }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MOVE_PX) p.moved = true;
    if (this.pendingPaint) this._maybeStartPaint(e);
    if (this.painting && this.pointers.size === 1) this.paintAt(e);
    else if (this.isPaintTool() && e.pointerType === 'mouse' && !this.pointers.size) {
      const hit = this.pick(e);
      this.brush.visible = !!hit;
      if (hit) this.brush.position.set(hit.point.x, hit.point.y + 0.4, hit.point.z);
    }
  }

  onUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    // a quick single-finger tap with a paint tool paints one dab
    if (this.pendingPaint && wasSingle && !cancelled) this.paintAt({ clientX: this.pendingPaint.x, clientY: this.pendingPaint.y });
    this.pendingPaint = null;
    if (this.painting) { this.painting = false; this.lastPaint = null; }
    if (e.pointerType !== 'mouse') this.brush.visible = false;
    if (cancelled || !p || !wasSingle) return;
    const isTap = !p.moved && performance.now() - p.t < TAP_MS && (e.pointerType !== 'mouse' || e.button === 0);
    if (isTap && this.tool === 'path') this.addWaypoint(e);
  }

  paintAt(e) {
    const hit = this.pick(e);
    if (!hit) return;
    const value = this.tool === 'res' ? ZONE.RES : this.tool === 'com' ? ZONE.COM : ZONE.NONE;
    const zones = this.game.zones;
    // fill the gap between two pointer events so fast strokes stay continuous
    const from = this.lastPaint || hit.point;
    const dist = from.distanceTo(hit.point);
    const steps = Math.max(1, Math.ceil(dist / (BRUSH_RADIUS * 0.5)));
    for (let s = 1; s <= steps; s++) {
      const x = from.x + (hit.point.x - from.x) * s / steps, z = from.z + (hit.point.z - from.z) * s / steps;
      zones.paint(x, z, BRUSH_RADIUS, value);
    }
    this.lastPaint = hit.point.clone();
    this.brush.visible = true;
    this.brush.position.set(hit.point.x, hit.point.y + 0.4, hit.point.z);
  }

  // ---- path drafting --------------------------------------------------------

  addWaypoint(e) {
    const hit = this.pick(e);
    if (!hit || hit.water) { this.toast('Paths need dry land'); return; }
    this.draft.push({ x: hit.point.x, z: hit.point.z });
    this.updateDraft();
  }

  updateDraft() {
    const paths = this.game.paths;
    this.pins.clear();
    this.draft.forEach((w, i) => {
      const s = paths.snap(w);
      const pin = new THREE.Mesh(this.pinGeo, s.node >= 0 ? this.pinSnapMat : this.pinMat);
      pin.position.set(s.x, this.game.terrain.surfaceAt(s.x, s.z), s.z);
      if (i === 0) pin.scale.set(1.4, 1.2, 1.4);
      this.pins.add(pin);
    });
    paths.showPreview(this.draft);
    this.$('btn-path-done').disabled = this.draft.length < 2;
    this.$('btn-path-done').style.opacity = this.draft.length < 2 ? 0.5 : 1;
  }

  finishPath() {
    if (this.draft.length < 2) { this.toast('Tap at least two points'); return; }
    const paths = this.game.paths;
    const startSnapped = paths.snap(this.draft[0]).node >= 0 || paths.snap(this.draft[this.draft.length - 1]).node >= 0;
    paths.addPath(this.draft);
    this.cancelDraft();
    this.toast(startSnapped ? 'Path built' : 'Path built — but it doesn’t touch the harbour or another path yet');
  }

  cancelDraft() {
    this.draft = [];
    this.pins.clear();
    this.game.paths.showPreview(null);
  }

  // ---- per-frame ------------------------------------------------------------

  update() {
    const g = this.game;
    if (!g.growth) return;
    const s = g.growth.stats();
    this.$('stats').innerHTML =
      `Houses <b>${s.houses}</b> · Shops <b>${s.shops}</b><br>Storeys <b>${s.floors}</b> · Tallest <b>${s.tallest}</b>`;
  }
}

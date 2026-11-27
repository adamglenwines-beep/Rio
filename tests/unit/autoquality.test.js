// Auto quality watchdog: patient by design, so it can never make the picture flicker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoQuality } from '../../src/autoquality.js';

/** Run `seconds` of frames at `ms` per frame; returns the list of level changes. */
function run(aq, seconds, ms, moving = false) {
  const changes = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const r = aq.tick(ms / 1000, moving);
    if (r !== null) changes.push(r);
  }
  return changes;
}

test('smooth frames never change the level', () => {
  const aq = new AutoQuality(6, 0);
  assert.deepEqual(run(aq, 300, 16.7), []);
  assert.equal(aq.level, 0);
});

test('a short slow spell does not step down', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 20, 16.7);
  assert.deepEqual(run(aq, 5, 40), []);       // 5 s slow: fewer than 3 slow windows
  assert.deepEqual(run(aq, 30, 16.7), []);
  assert.equal(aq.level, 0);
});

test('sustained slow frames step down one level at a time, with a pause between', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 12, 16.7);
  const times = [];
  let t = 0;
  for (; t < 60; t += 0.04) if (aq.tick(0.04, false) !== null) times.push(t);
  assert.ok(times.length >= 2, 'stepped down more than once in a minute');
  assert.ok(times[0] >= 7, 'first step needs at least 3 slow windows (7.5 s), got ' + times[0]);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 17, 'at least dwell + 3 windows between steps');
  assert.ok(aq.level <= 5);
});

test('single hitches are ignored', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 12, 16.7);
  const changes = [];
  for (let i = 0; i < 6000; i++) {
    const r = aq.tick(i % 50 === 0 ? 0.4 : 0.0167, false);   // a 400 ms hitch every 50 frames
    if (r !== null) changes.push(r);
  }
  assert.deepEqual(changes, []);
});

test('a change waits while the camera is moving, then applies at rest', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 12, 16.7);
  let changedWhileMoving = false, t = 0;
  for (; t < 10.5; t += 0.04) if (aq.tick(0.04, true) !== null) changedWhileMoving = true;
  assert.equal(changedWhileMoving, false);
  assert.equal(aq.pending, 1, 'a step down is waiting');
  let applied = null;
  for (let i = 0; i < 20 && applied === null; i++) applied = aq.tick(0.04, false);
  assert.equal(applied, 1);
});

test('a pending change is not held for ever while the camera keeps moving', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 12, 16.7);
  const changes = run(aq, 20, 40, true);
  assert.equal(changes[0], 1);
});

test('steps back up after a long smooth spell, never above its ceiling', () => {
  const aq = new AutoQuality(6, 1);            // device guess: medium
  aq.reset(1, 1);
  run(aq, 12, 16.7);
  run(aq, 30, 40);                             // slow → at least one step down
  const low = aq.level;
  assert.ok(low > 1);
  run(aq, 200, 12);                            // long smooth spell
  assert.equal(aq.level, 1, 'back to the ceiling, not above it');
});

test('if stepping up makes it slow again, it stops trying (no oscillation)', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 12, 16.7);
  let changes = 0;
  // a machine that is smooth one level down and slow at the top level
  for (let t = 0; t < 900; t += 0.02) {
    const ms = aq.level === 0 ? 40 : 12;
    if (aq.tick(ms / 1000, false) !== null) changes++;
  }
  assert.ok(changes <= 3, 'down, one try back up, down again, then settled; got ' + changes);
  assert.equal(aq.level, 1);
  assert.equal(aq.noUp, true);
});

test('a hidden tab or paused frames reset the window', () => {
  const aq = new AutoQuality(6, 0);
  run(aq, 12, 16.7);
  for (let i = 0; i < 2000; i++) { aq.tick(0.04, false, i % 40 === 0); }
  assert.equal(aq.level, 0);
});

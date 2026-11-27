# Progress

So a new session can pick up with "Read PROGRESS.md and continue". Read `CLAUDE.md` and
`DESIGN.md` first. Decisions made without the user (they asked not to be asked) are
recorded here with the reason.

## The current run: Borgo brief, Step 0 + Phases B, C, D

One long run. After each phase: commit, merge to `main`, wait for GitHub Pages, give the
live link, carry straight on. Dev branch: `claude/hopeful-knuth-kp9ia6`.

| Step | Label | State |
|---|---|---|
| Step 0: flashing when the camera moves | (in v0.9) | done |
| Phase B: terrain and vegetation | `v0.9 · Terrain` | done, published |
| Phase C: facades, town shape and clutter | `v0.10 · Facades` | done, published |
| Phase D: sky and water | `v0.11 · Sea and sky` | **next** |

Not in this run: Phases E to I (landmarks, life, camera and cutaway, foundations, gameplay).

### Inputs for the remaining phases
- The brief itself is in the first message of the run; its Phase C and D bullet lists are
  copied at the bottom of this file so a new session has them.
- Written visual briefs made from the reference photos (private repo `Rio-reference`):
  `briefs/VISUAL-BRIEF-landscape-and-sea.md` (B, D) and
  `briefs/VISUAL-BRIEF-buildings-and-clutter.md` (C). The second one only looked directly
  at 61 of 129 images; look at `facades/`, `plaster-walls/`, `painted-facades/`, `roofs/`
  yourself before building those parts.
- Wattle Creek techniques worth reusing in Phase D (from its newer `build/v60.73` branch):
  water depth from a **baked height texture** sampled per pixel (smooth waterlines), shallow
  → deep colour by depth, shore foam band + moving surf lines, fish as one instanced mesh
  oriented in the vertex shader from a velocity attribute with a tail-wag, a "field" grid
  that keeps fish in deep-enough water, and its frame-time watchdog (already adapted here
  as `src/autoquality.js`).

## Step 0 — flashing when the camera moves (done)

What was found:
- There is only one render path (no controls 'change' handler); frames are pixel-identical
  at rest on Medium and High, before and after the changes.
- The every-other-frame flash could **not be reproduced** in the software renderer used
  here. What could cause visible flashing and was fixed anyway:
  1. **Auto quality** stepped down after only 4 s of low frame rate, counted hitches
     (shader compiles, town re-meshing), and each step rebuilt the pipeline (SSAO, the
     "contact shadows" under trees, vanishes when High drops to Medium). It could cascade
     to Low and then shave the resolution. Now it is a patient watchdog (see DESIGN.md).
  2. On High the composer used alternate buffers on alternate frames; every frame now
     starts from the same one.
  3. The shadow map was redrawn every frame (twice on High). Now only when a shadow caster
     changes. Software-rendered frame cost roughly halved.
  4. Tree/terrace instances could be culled against a stale bounding sphere.
- Frame times during a scripted orbit and zoom (`tools/measure_moves.cjs`): steady, no
  alternating pattern or periodic spikes; game code outside drawing costs about 0.3 ms a
  frame. Real stutter from the game's own code is ruled out; GPU-side behaviour on real
  hardware is not measurable here.
- If the flash is still there on the user's machine, the settings panel now shows frame
  time and the slowest frame, which will help pin it down.

## Phase B — terrain and vegetation (done, `v0.9 · Terrain`)

- `src/terrain.js`: 1 m ground mesh (smooth, indexed; game logic still on 2 m cells);
  rock ledges along the bedding planes where too steep to build; shore shelves and
  skerries; a scenery ring out to 1 km (headlands, ridge behind the town); per-vertex
  masks for the ground shader (scrub cover, terrace soil, rocky shore).
- Ground shader (`materials.js`, `terrainGLSL`): ground / scree / layered rock by slope;
  beds coloured along the 55° bedding plane with proud ribs, joints, wet band at the sea.
- `src/terraces.js`: terrace areas on any slope (cut treads, contour walls, vines).
  `game.terraces.addArea({x, z, r, crop})` then `game.rebuildLandscape()`.
- `src/scenery.js`: scrub, pines, olives, agave, flowers, bougainvillea on terrace walls,
  far clumps, shore boulders and a breakwater by the jetty; quality budgets and distance
  fade.
- Old vertex-colour ground (the source of the blurry green patches) is gone.
- Comparisons: `docs/progress/phase-b/` (and its README: what still differs, what got worse).

## Phase C — facades, town shape and clutter (done, `v0.10 · Facades`)

- `src/buildings.js`: each house draws a "look" from its seed (`_look`): wear, trim,
  ground floor, roof pitch, shutter habits. New instanced parts (surround, pediment,
  painted window, four shutter states, two balcony kinds, door frame and leaf, bars, pots,
  plants, cloth, parasols, flower boxes), each with its own draw distance.
- Wall shader (`materials.js`, `WEATHER_GLSL`): layered plaster loss using a per-vertex
  wall coordinate (`aWall`: metres along the wall, wall length, wear + flags), painted
  quoins.
- `src/growth.js`: facade colour chosen after a house is on the map so touching houses
  never match (`neighboursOf`, `_pickColour`); roof kind stored (`roofKind`).
- `src/infill.js`: fishing and farming quarters (`quarterAt`), boats hauled up, nets,
  racks, crates, barrels, stakes, baskets, café on the piazza; the ground around the town
  is bare earth (`terrain.setTownMask`).
- Demo: four more flights of steps off the main street.
- Not done from the Phase C list: windows are still proud of the wall rather than recessed
  into it; no lamps, house numbers or awnings beyond shops; fake windows and the cat are
  drawn by a small shader, not hand art; the lane layout is otherwise as before (the
  frontage system already kept fronts on the lane edge and houses off the paths).
- Comparisons: `docs/progress/phase-c/` (and its README).

## Tests

`npm run test:unit` (46 tests, ~8 s) and `npm run test:browser` (22 checks, ~8 min in the
software renderer). `tests/browser/baseline.json` holds software-renderer frame times per
preset (2× tolerance). Re-create with `npm run test:browser -- --update-baseline`.

## Decisions (made without asking, with reasons)

- **No new downloads this run.** The build sandbox cannot reach Poly Haven, ambientCG,
  Kenney or Quaternius. Everything uses the CC0 library already in `assets/textures/`
  (which the user extended to 106 sets) plus shapes made by code.
- **`damaged_plaster` not moved into the game**: licence could not be verified (no access
  to polyhaven.com). See ASSETS.md.
- **Three-way comparisons with a real photo live in the private repo**
  (`Rio-reference/progress/`), because photos must not enter the public repo. Game-vs-target
  comparisons are in `docs/progress/phase-*/`.
- **Postcard view moved** to out on the water looking up the cove, to match the targets.
- **The valley head stays closed by a ridge** (real geography) rather than showing sea
  behind the town as two of the targets do; distant coast shows to the sides instead.
- **Rock palette**: between the real cliffs (grey, dark) and the targets (warm tan), with
  contrast between beds kept moderate so slopes don't look like zebra stripes.
- **Terraces only where farmed**: the demo has six small areas; there is no paint tool for
  them yet (gameplay comes later) but the API is ready.
- **Palette**: kept more saturated than the real town (the design asks for colours that
  read at a distance) but with less yellow than the targets: yellow-family houses are held
  under about 40%.
- **Roofs**: pale weathered slate rather than the dark slate of v0.8, because from above
  the real towns are pale; pitch raised from nearly flat to about 13–23°.
- **Plaster wear amount**: most houses sound, 3 in 10 worn, 1 in 8 badly; an earlier pass
  with more wear made the town look derelict from the postcard view.
- **Shadows redraw only on change**: bobbing boats therefore keep a still shadow (the
  movement is a few centimetres).
- **Default style = Hand-painted**; WebP textures, texture arrays (from Phase A, unchanged).
- Real-world reference photos stay out of this public repo.

## Remaining brief (copied from the run's first message)

PHASE C: Facades, town shape and clutter
- Facades follow the lanes: house fronts run along the path edge, with no triangular gaps beside paths and no buildings over paths (except archways).
- Lane layout: one main lane down the valley floor, with stair lanes branching up both sides. Flat ground is rare.
- Tower houses: tall and narrow on small footprints, some taller and narrower than others. On a slope, a house has a front door on the lower lane and a back door onto the higher lane behind it.
- Rough stone ground floors with plaster above; plaster worn away in patches at corners, bases and around doors, showing stone underneath (see plaster-walls/).
- House colours: neighbours never share a colour; the palette sits a little cooler than the targets, which are too yellow.
- Slightly irregular walls and small eaves overhangs.
- Roofs: mostly grey Ligurian slate (big square abbadini, terracotta ridge tiles), some all-terracotta, chimney pots, rooftop terraces, roofs stepping down onto the neighbour's (see roofs/).
- Painted window surrounds (Ligurian trompe-l'oeil), cornices and string courses (see painted-facades/); painted fake windows mixed with real ones, and the odd painted cat.
- Uneven window rhythms; shutters open, closed and half-open.
- Timber doors with stone steps, set back into the wall.
- Varied balconies with railings and flower boxes; washing lines, awnings and drainpipes; bougainvillea on some house walls.
- Two quarters with their own clutter: the fishing quarter by the harbour (boats pulled up, nets drying) and the farming quarter higher up (barrels, tools, vine stakes).
- Cafe tables and umbrellas on the piazza and waterfront.
- Boat-store arches with real depth: mostly timber doors, a few open showing a boat.
- Fill leftover gaps between buildings by size and slope: tiny vegetable gardens, patios with pergolas, steps, dry-stone walls, sheds, cisterns.
- Detail by distance: full detail up close, simpler facades from the postcard view. Check both views against the targets.

PHASE D: Sky and water
- Sky with soft clouds, and haze over distant headlands.
- Turquoise shallows fading to deep blue; rocks and seabed visible through clear water near the shore.
- White foam where waves meet rocks and the breakwater.
- Fish in the harbour shallows (reuse the Wattle Creek fish techniques).
- Boats bobbing at moorings, the odd one rowing in or out, and a sailboat on the horizon now and then.
- If time allows: lit windows at dusk (interior mapping), a random mix of lit and dark windows.

At the end: merge to main, live link, short plain-English summary of what changed, what
still differs from the targets, and what to do next. Also still owed: a list in ASSETS.md
of any paid pack worth buying (price and reason; buy nothing).

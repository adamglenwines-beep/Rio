# Progress

So a new session can pick up with "Read PROGRESS.md and continue". Read `CLAUDE.md` and
`DESIGN.md` first. Decisions made without the user (they asked not to be asked) are
recorded here with the reason.

## The current run: v0.12 · Light (flicker, shimmer, no trees, light and colour)

A small, surgical run in four parts, in this order. Dev branch: `claude/nice-planck-k467qs`.
Not touched (later runs): building shapes, window design, roofs, materials, terrain, water.

| Part | State |
|---|---|
| 1. Flicker: windows, shutters, washing | done |
| 2. Roof shimmer | done |
| 3. Take out the trees | done |
| 4. Light and colour on the buildings | done |
| Performance | done (see below) |

### Part 1 — flicker (done)

Causes found (videos and notes in `Rio-reference/bug-reports/`):
1. **Window glass 2 mm in front of its dark pane.** The interior-mapped glass sat at 7.2 cm,
   the dark pane behind it at 7.0 cm. Further than about 100 m the depth buffer can't tell
   2 mm apart, so the pane and the glass took turns: windows "there one frame, gone the next"
   (the wide-view video). Other near-misses: painted windows 1 mm from a dado, doors 1 cm in
   front of a dado, the dark back of boat-store arches 1 cm from the stone.
2. **The near plane was 0.5 m at every distance.** Depth precision falls with the square of
   the distance and rises with the near plane; at 150 m two surfaces under ~3 mm apart could
   swap. Now the near plane moves out with the camera's distance to its pivot (0.5–6 m,
   `CONFIG.graphics.nearPlane`), never so far it could cut into the ground or a roof under the
   camera: about ten times the precision at the postcard view.
3. **Houses pushed up to 12 cm into each other.** The growth rule allowed an overlap depth of
   0.12 m (`convexOverlap` measures depth, not area): 43 pairs in the demo town, walls
   crossing at a slight angle (long flickering slivers), windows half buried in a neighbour
   (the clipping video). Now `CONFIG.building.maxOverlap` = 5 mm: 0 pairs. The demo grows 219
   houses instead of 235.
4. **Openings on covered walls.** Windows were hidden only if a neighbour stood 0.8 m in
   front of the window's centre. Now every door, window, painted window, shopfront,
   drainpipe and climbing plant checks its whole width, its whole storey, and 0.9 m out in
   front against every nearby house (walls, stone bases, eaves and roof):
   `BuildingRenderer._coverTest`. Shared walls get no openings.
5. **No real gap from the wall.** All wall parts are placed on the wall's outer skin (stone
   base, dado, plinth or the leaning plaster: `skin()` in `_buildOne`), and every face
   parallel to the wall is either buried 2 cm in it or stands at least
   `CONFIG.building.facadeGap` (3 cm) in front. A window's layers are 2 cm apart: surround
   3 cm, frame 7, pane 10, glass 12, open shutters 9, shut shutters 15.
6. **Washing**: the jagged, changing edges were the screen-space ambient occlusion (GTAO,
   High only) working from an un-antialiased depth image at the cloth's edges, plus the cloth
   sitting where the above flickering parts were. (See part 2 for what replaced GTAO.)
- Level-of-detail on facade parts was checked: small parts shrink smoothly with distance
  (no on/off switching), so it was not a cause.
- **Measured** (`tools/flicker_strip.cjs`, High, Golden hour, views like the bug videos): with
  the camera still, the far plane is nudged by 0.05–0.2 %; that changes only depth rounding, so
  any pixel that changes is two surfaces fighting. Share of such pixels, v0.11 → v0.12: whole
  town from the water 0.189% → 0.005% (38× fewer), tall houses close 0.117% → 0.010%, washing
  close up 0.009% → 0.003%, roof 0.018% → 0.007%. Frame strips and maps:
  `docs/progress/run-e/flicker_*`.
- Test: `tests/unit/openings.test.js`: houses never overlap; no opening on a covered wall
  (an independent point-sampling check, which fails if the cover test is switched off);
  wall parts stand clear of the wall and a window's layers are apart.

### Part 2 — roof shimmer (done)

Measured with `tools/shimmer.cjs` (a slow sub-pixel camera drift; it scores how much the
picture changes between frames, and how unstable the fine detail is), switching each
suspect off in turn on a real slate roof seen from a few metres above:
- **Not the cause:** mipmaps (they are generated for the texture arrays), anisotropic
  filtering (on: 8x on High), the normal maps (switching them off changed nothing), the
  screen-space AO (tiny change), the hand-painted brushstrokes (no change).
- **The cause:** the slate texture's own detail. A texture's detail is applied as
  (brightness ÷ average brightness), multiplied onto the roof colour. The slate photo is
  dark with pale chipped edges, so that ratio reached 11x: hard white texel-sized specks
  that crawl as the camera moves (the "gravel" in the video). Fix: a per-texture detail
  contrast and extra mip bias (`CONFIG.textures`; slate 0.5 and +0.75, a few others 0.75–0.8
  and +0.25), and the ratio capped at 0.3–2.4 for every texture. Frame-to-frame change on the
  roof halved (2.84 → 1.39), the fine-detail instability fell from 0.45 to 0.38.
- **Every material checked** close up and at grazing angles (plaster wall, paving, a lane at a
  grazing angle, a hillside close up): none fizzed like the roof; a mip bias of +1 calmed all of
  them a little, so the default style now uses +0.3 everywhere (anisotropic filtering keeps
  them sharp at an angle). The hillside close-up's big score is the camera rig nudging the
  camera off the slope, not the texture.
- Screen-space AO (GTAO) is switched off on High (it was High-only): it cost about a fifth of a
  High frame, drew the scene a second time, and its un-antialiased edges caused the jagged,
  changing edges on washing. Baked AO replaces it on every quality level (part 4).

### Part 3 — trees taken out (done)

`CONFIG.flora.trees = false` switches off: the hillside scrub (the rounded green pads), the
soft clumps on the far hills, umbrella pines, olives, flowering cushions on rock
(`scenery.js`); and in the town's gardens lemon, fig and pine trees, shrubs, green tufts and
the plant on low walls (`infill.js`). **To bring them back, set `trees: true` in
`src/config.js` (`flora`)**; nothing was deleted. Kept: ground colour and slope blending,
terrace vines, agave and prickly pear (not trees or bushes), bougainvillea on houses and
terrace walls, pots, flower boxes, balcony plants, vegetable rows.

### Part 4 — light and colour on the buildings (done)

Method: a test scene of six real houses (`index.html?scene=six`, `src/testscene.js`; add
`&colours=E2BC78,...` to paint them), measured with `tools/measure_walls.cjs`: it renders a
view, then a mask of house walls only, then the view with the sun off, and reports the HSL
lightness of warm wall pixels in sun and in shade.

**Before (v0.11, postcard view, High, Hand-painted, Warm):** warm walls in sun 50% (median),
in shade 29%, overall 21% (shade, 10th percentile) to 65% (sun, 90th). Low: sun 58%, shade
36%. So v0.11 was darker than both the target and the 47–88% you measured on v0.10 (that
screenshot was Clean style, Neutral, Low).

What was wrong, and what changed:
1. **Every textured surface was drawn at about 65% of its colour** (since v0.8): texture
   brightness, in linear light, was divided by an average measured in sRGB. Fixed for houses
   (walls, roofs, wall parts): `materials.js`, `trueMean`. Ground, rock and paths keep their
   old look exactly (the terrain run can switch them over).
2. **Tone mapping**: ACES → Khronos PBR Neutral (keeps colours true and sunlit walls bright;
   ACES shifted yellows to mustard and washed highlights; AgX washed everything out).
3. **The sun was behind the camera's right shoulder** at the postcard view, so nearly every wall
   you saw was sunlit. The sun now stands in the west (as at Riomaggiore, where it sets over
   the sea): fronts and west sides lit, east sides in shade, shadows falling between houses.
   Midday is now an early-afternoon sun (42° high).
4. **Sun and sky fill calibrated**: warm sun ×1.6, cooler sky fill ×1.3–1.5, exposure 1.2 at
   midday; the Hand-painted grade's extra saturation (1.12) removed (it made walls egg-yolk).
5. **Baked ambient occlusion** on every quality level: per pixel (it used to be smeared up the
   whole wall from two vertices), darker at the wall foot and in narrow lanes, a band under the
   eaves, and a soft ring round every window and under its sill (`CONFIG.building.ao`).
6. **Palette** (`FACADE_COLOURS`): lighter, warmer, sun-faded: ochre, golden ochre, lemon,
   cream, limewash, peach, faded burnt orange, faded terracotta, salmon, dusty rose, pale rose,
   sage, limestone render. Started from section 7 of the graphics review; each colour
   lightened and faded the way ochre #D5AC55 had to become #E2BC78 to match the target, then
   brought back to mid-tones after a first, too-pale try. Touching houses still never share a
   colour. Soft variation within each wall: broad brightness drift plus paler, greyer
   sun-faded patches (`wallVariation`, `sunFade`).
7. **Shutters**: richer, lighter greens (#2f7656 … #4a8a63) instead of near-black.

**After, the single-building test** (all six houses ochre #E2BC78, midday; the same on Low,
Medium and High): sunlit wall **#E9C18D, 71%, hue 34°** (target #F3C17B, 72%, 35°); shaded wall
**#96744C, 44%** (target #9E794D, 46%). Golden hour: 69% / 42%, a warmer hue (30°).
**After, the whole town** (postcard, High, midday): warm walls 36% (shade, 10th percentile) to
83% (sun, 90th), median 68%; the paint-overs run 34% to 78%, median 60%. The game still has less
deep shade than the paint-overs: their houses stand closer and cast more shadow on each other.

### Performance (before and after)

**Before anything was changed** (v0.11, `tools/profile.cjs`, postcard view, 1280×720, software
renderer: absolute times are ~60× a real GPU's, the split is what to read). Where High's frame
went at Golden hour: the main scene pass 68% (of it, trees and bushes ~21%, houses ~31%, ground
~24%, sea ~9%), screen-space AO 18% (it also drew the whole scene again), the harbour mirror 4%,
bloom 3%, grade + output 2%; the shadow map is redrawn only when something changes. Triangles
per frame: High 2.85 million, of which 1.9 million were trees and bushes; Medium 2.46 M; Low
1.21 M. Draw calls: 57–59 (instancing works; calls are not the problem).

| Preset, time (software renderer) | v0.11 frame | v0.12 frame | change | triangles |
|---|---|---|---|---|
| Low, midday | 2.79 s | 2.80 s | 0% | 1.21 M → 0.52 M |
| Low, golden hour | 3.16 s | 2.89 s | −9% | 1.21 M → 0.52 M |
| Medium, midday | 5.63 s | 4.38 s | −22% | 2.46 M → 1.04 M |
| Medium, golden hour | 5.41 s | 5.06 s | −6% | 2.46 M → 1.04 M |
| High, midday | 7.24 s | 5.06 s | −30% | 2.85 M → 1.04 M |
| High, golden hour | 7.85 s | 5.34 s | −32% | 2.85 M → 1.04 M |

What saved it: trees and bushes out (−1.8 M triangles; they were drawn in the scene, the AO pass
and the shadow map), screen-space AO off (−18% of a High frame), and fewer window parts (no
openings on covered walls: 239k house triangles instead of 403k). Low barely changes because it
already drew few plants and no AO; its cost is filling pixels (ground and houses).
**On your PC** (v0.11, High, Golden hour: 8 fps, 121 ms) the same −32% would mean about
**82 ms, ~12 fps**; this sandbox has no real GPU, so please check the numbers in ⚙️ Settings.
Where the rest goes now (High): the main pass ~87%, of which ground ~35% and houses ~30%; the
mirror 6%, bloom 5%. Next savings to try: draw the far terrain ring coarser, and skip the
mirror pass when the harbour is off screen.

### What got worse, what still differs, what next

- **Hillsides look bare and bright green.** Expected with the trees out; the stronger sun also
  lights the scrub ground more, and from the west some cliffs are brighter and others darker.
- **The town is lighter than the paint-overs overall** (median warm wall 68% vs ~60%): the
  paint-overs have much more deep shade, from houses packed closer and taller. That is massing
  (next run), not light.
- **Still differs from the targets:** separate towers instead of continuous blocks; windows
  small and sparse with few balconies; mostly pale slate roofs where the targets show more
  terracotta; little greenery and flowers on the buildings; no deep shadowed lanes.
- **Roofs are a little lighter** than before (the texture-brightness fix); slate is calmer.
- **Tune next:** the far terrain and the mirror pass for speed; a contact shadow where walls meet
  the ground; golden-hour sky fill slightly warmer if shade reads too grey on your screen.
- **Next run: the buildings** (the brief Adam sent during this run): windows and doors, massing,
  roofs, materials, signs of life, floor-by-floor data and a condition value per house.
  Network: polyhaven.com and ambientcg.com are reachable again (checked at the end of this
  run); Poly Haven's `damaged_plaster` is confirmed CC0 (its licence page: all assets CC0).

## Earlier run: Borgo brief, Step 0 + Phases B, C, D (v0.9–v0.11)

One long run. After each phase: commit, merge to `main`, wait for GitHub Pages, give the
live link, carry straight on. Dev branch: `claude/hopeful-knuth-kp9ia6`.

| Step | Label | State |
|---|---|---|
| Step 0: flashing when the camera moves | (in v0.9) | done |
| Phase B: terrain and vegetation | `v0.9 · Terrain` | done, published |
| Phase C: facades, town shape and clutter | `v0.10 · Facades` | done, published |
| Phase D: sky and water | `v0.11 · Sea and sky` | done, published |

**The run is complete.** Next up would be Phases E to I (see "What to do next" below).

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

## Phase D — sky and water (done, `v0.11 · Sea and sky`)

- `src/water.js`: the sea reads a height texture of the ground and boulders
  (`sea.syncHeights(scenery)`, re-baked by `game.rebuildLandscape()`): colour and clarity
  by depth, foam fringe and surf lines, ripple normals, reflection kept. Water no longer
  writes depth. Moored boats with buoys, a rowing boat on a route kept in deep water
  (`rowingRoute`), a sailboat on a timer.
- `src/fish.js`: `FishSchool` (pure simulation, unit-tested) and `FishView` (one instanced
  mesh; orientation and tail-wag in the vertex shader). Counts per quality.
- Sky shader (`gfx.js`): soft drifting clouds in every style; brighter midday.
- Ground shader: light patterns on the shallow sea bed (`matUniforms.uTime`).
- Zone overlay hidden unless a zoning or path tool is active.
- Lit windows at dusk were already there (interior mapping, random share lit); checked.
- Comparisons: `docs/progress/phase-d/` (and its README).

## What to do next (suggestions)

1. **Grow the town to fill the valley** like the targets: wider demo zoning and more stair
   lanes, then tune the postcard framing. Cheap and very visible.
2. **Vegetation, full pass** (already planned): real leafy models or better procedural
   plants; bougainvillea as sheets of leaves rather than lumps. See the paid-pack notes in
   ASSETS.md.
3. **Cliffs beside the quay**: raise and roughen the rock right at the harbour sides.
4. **Recessed windows and louvred shutters** (a facade normal map or real reveals).
5. **Street lamps and warm lane light at dusk**, then Phase E (landmarks: church, tower,
   washhouse) and Phase F (people).
6. Check the flashing on real hardware: if it is still there, the frame time and slowest
   frame in Settings will say whether it is a quality change or something else.

## Tests

`npm run test:unit` (54 tests, ~10 s) and `npm run test:browser` (27 checks, ~9 min in the
software renderer). New in v0.12: `tests/unit/openings.test.js` (no opening on a covered wall,
houses never intersect, wall parts stand clear). Tools: `tools/profile.cjs` (where frame time
goes), `tools/measure_walls.cjs` (wall colours in sun and shade), `tools/shimmer.cjs`,
`tools/flicker_strip.cjs`, and the six-house scene `index.html?scene=six`. `tests/browser/baseline.json` holds software-renderer frame times per
preset (2× tolerance). Re-create with `npm run test:browser -- --update-baseline`.

## Decisions (made without asking, with reasons)

v0.12:
- **Trees switched off, not deleted** (`CONFIG.flora.trees`): one switch to bring them back for
  the vegetation pass. Agave, prickly pear and bougainvillea kept (not trees or bushes).
- **Screen-space AO (GTAO) off on all presets**, baked AO instead: GTAO cost ~20% of a High
  frame and caused jagged crawling edges; baked AO is stable and now on Low and Medium too.
- **Sun moved to the west** (from the east): the postcard view showed almost no shade, and at
  Riomaggiore the sun sets over the sea to the west of the harbour.
- **Tone mapping: Khronos PBR Neutral** (ACES and AgX were tried side by side on the six houses).
- **Texture brightness fix only on houses**: ground, rock and paths keep their exact old look,
  since this run must not change terrain; switch them over in the terrain/materials run.
- **Roof textures**: the fix in (1) also makes roofs show their intended (lighter) colours,
  and the slate's detail contrast was halved to stop the shimmer. The roof colours themselves
  are unchanged.
- **Near plane** follows the camera distance (0.5–6 m) rather than a fixed larger value, so
  close-up views near walls still work.
- **Houses may not overlap by more than 5 mm** (was 12 cm). The demo town grows 226 houses in
  the browser (was 235); still well over the 150 the tests ask for.
- **Palette calibrated on the six-house scene** to the single-building target, not on the
  whole-town paint-overs, because the town's geometry (spacing, shade) still differs from them.

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
- **Zone overlay only with a zoning tool.** It is unlit, so it glowed at dusk and tinted the
  ground green by day; the targets show no overlay.
- **Fish drawn after the water** (the water no longer writes depth) so they show through
  it, as Wattle Creek does by clearing its sea; simpler than making the water clear.
- **Paid packs**: listed in ASSETS.md with prices from memory, flagged as unchecked.
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

(All of the above is done; the lists are kept for reference.)

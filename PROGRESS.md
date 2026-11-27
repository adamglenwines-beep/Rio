# Progress

So a new session can pick up with "Read PROGRESS.md and continue". Read `CLAUDE.md` and
`DESIGN.md` first. Decisions made without the user (they asked not to be asked) are
recorded here with the reason.

## The current run: v0.16 → v0.21 · Buildings that look built and sunlit (unattended overnight run)

Adam's brief (27 Nov 2026, he is asleep: no questions, decisions recorded here with reasons):
make the buildings look individually built and sun-lit rather than generated, **judged from the
Postcard and Overview cameras**. Quality of existing detail over quantity: no new decorative
objects. Target: `Rio-reference/art-target-v2/` (paint-overs `target-v2-1…5`,
`single-building-target-vs-game.png`). Out of scope: roofs, lane widths, lot/block layout,
terrain, cliffs, vegetation, water. Frame rate is not a goal (report it on High after each
stage); prefer baked or texture-based solutions. Unit tests after every stage; the browser suite
once at the very end. After each stage: commit, merge to `main`, publish, screenshots in
`docs/progress/<version>/`, then carry straight on. Dev branch: `claude/adoring-allen-h9ie8v`.

| Stage | Version | State |
|---|---|---|
| 1. Sunlight | `v0.16 · Sunlight` | **done, published** |
| 2. Palette and shutter colour | `v0.17 · Palette` | **done, published** |
| 3. Small-scale shading | `v0.18 · Shading` | **done, published** |
| 4. Windows, shutters and doors | `v0.19 · Windows` | **done, published** |
| 5. Plaster weathering | `v0.20 · Weathering` | **done, published** |
| 6. Break the procedural rhythm | `v0.21 · Rhythm` | **done, published** |
| Wrap-up: browser suite, final sheets in `docs/progress/final/`, summary | | to do |

**To resume:** read this section, look at the table, and carry on with the first stage that is
not "done". Each stage's notes below say what was changed and what was measured.

### How things are measured in this run
- `python3 tools/measure_image.py <picture> x0,y0,x1,y1` (new): lightness of warm-coloured pixels
  in a crop of a picture. It works the same on a game screenshot and on a paint-over, so the two
  are compared like for like. Town crop of the Postcard screenshot: `0.22,0.22,0.8,0.74`; of
  the paint-overs `target-v2-1…4`: `0.12,0.02,0.85,0.85`. **The paint-overs measure: shade (10th
  percentile) 29–31%, typical (median) 56–61%, brightest (90th) 77–80%.** v0.15 measured this
  way: 36.5 / 67.5 / 87.6 (the brief's own figures: 32–47 / 68–72 / 85–91).
- `node tools/measure_walls.cjs --scene town` measures the game itself more strictly (wall
  pixels only, by a mask); it now also prints `all` = every warm wall pixel (10th / 50th / 90th
  percentile = shade / typical / brightest).
- Screenshots: `node tools/shot.cjs --views postcard,aerial,single --clean` (Postcard, Overview
  and a facade close-up; High, Hand-painted, Neutral, Midday, 1600×900). The v0.15 set is in
  `docs/progress/base-v0.15/`.
- This sandbox has no graphics card (it renders in software, seconds per frame), so "fps on
  High" is reported as the frame time relative to v0.15 measured back to back
  (`tools/profile.cjs`), plus triangles and draw calls. Please read the real fps in ⚙️ Settings.

### Stage 1 · Sunlight (v0.16) — done

**What was wrong.** The tone curve (Khronos Neutral) leaves everything below 76% of full
brightness alone, squeezes only the very top, and fades what it squeezes toward white. The sun
was strong enough to push sunlit walls into that zone, so they came out pale and chalky.

**What changed** (light only; no paint colour was touched):
1. **A new tone curve** (`src/gfx.js`, numbers in `CONFIG.graphics.tone`). It starts bending
   earlier (at 65% grey instead of 88%) and keeps each colour's own hue and saturation as it
   brightens (the brightest colour channel is eased toward a ceiling, the other two follow in
   proportion), so a sunlit yellow wall stays yellow instead of turning cream. Only things far
   brighter than a wall (the sun, glints, lit windows) still burn out to white. Shade lies below
   the bend, so it is drawn exactly as before. It replaces the body of three.js's Neutral curve,
   which both the renderer (Low) and the output pass (Medium, High) call, so all three quality
   levels get the same picture.
2. **The sun is about a fifth weaker**: 5.4 → 4.4 at midday, 5.35 → 4.4 at golden hour
   (`KEYS` in `gfx.js`). Sky fill and exposure (1.2) are unchanged: that is what keeps the shade
   where it was.

**Measured** (`tools/measure_walls.cjs --scene town`, Postcard view, warm wall pixels only;
shade / typical / brightest = 10th / 50th / 90th percentile of lightness; JSON files in
`docs/progress/v0.16/`):

| | v0.15 | v0.16 | target (brief) |
|---|---|---|---|
| High, Neutral, midday | 38 / 68 / 88 | **38 / 61 / 81** | 37–46 / ~60 / ~76 |
| Medium, Neutral, midday | (sun 73, shade 41) | 38 / 60 / 81 | |
| Low, Neutral, midday | (sun 73, shade 41) | 38 / 60 / 81 | |
| High, Warm, midday | 39 / 66 / 83 | 38 / 59 / 77 | |
| High, Neutral, golden hour | (sun 70, shade 38) | 36 / 58 / 75 | |
| Sunlit walls only, High midday: 10th / 50th / 90th | 60 / 73 / 88 | 53 / 62 / 79 | |
| Shaded walls only, High midday: 10th | 32.4 | 34.3 | |
| Same picture measured like the paint-overs (`measure_image.py`) | 36.5 / 67.5 / 87.6 | **35.5 / 60.8 / 80.6** | paint-overs: 29–31 / 56–61 / 77–80 |
| Single ochre wall (#E2BC78, six-house scene): sun / shade | #EDC99D 75.5% / #9A7B5B 47% | #D8B282 67.5% / #A28363 48% | #F3C17B 72% / #9E794D 46% |

So typical is on target and shade is where it was. **Brightest is 81%, not 76%**: what is left up
there is the pale paints (cream, limewash, pale rose) in full sun, which cannot be brought lower
by light without dulling every other wall; the palette stage deals with them. Measured the way
the paint-overs measure, the brightest 10% is 80.6% against their own 77–80%.
**The single ochre test wall is now a little under its target in sun** (67.5% against 72%): the
town-wide figures and that one wall cannot both be hit with the v0.15 paints. I chose the
town-wide figures, because the brief's complaint was about the whole view.

**Tried:** the new curve alone, sun unchanged, ceiling at 100%: 38 / 64 / 85 (not enough). Bend
at 65% grey with a 93% ceiling, sun unchanged: 38 / 62 / 81. Ceiling 86% instead of 93%: 38 / 60 /
80, but the single wall dropped to 66.5% and whites (boats, foam) went grey, so the ceiling stays
at 93%.

**Frame rate (High, Postcard, midday, software renderer):** v0.15 4.33 s a frame, v0.16 4.44 s
(+2.5%, inside the ±10–20% run-to-run noise); 122 draw calls, 0.61 M triangles, both unchanged.
The new curve is a few instructions per pixel. **Expect the same fps as v0.15.**

**Side effects, since light is shared by everything:** ground, rock, sea and sky are lit by the
same weaker sun, so the whole picture is slightly less bright and less bleached (the sea a touch
deeper). Nothing in terrain, water or sky code was edited.

Pictures: `docs/progress/v0.16/` (`postcard_`, `overview_`, `facade_before_after.jpg`).

### Stage 2 · Palette and shutter colour (v0.17) — done

Data only (`data/palette.json`), plus two one-line changes in code (a little more colour
difference from house to house in `growth.js`; paint in poor condition lightens a little less).

**How the colours were chosen.** Three sources had to agree:
- *The photos* (Riomaggiore harbour from the water, the row of shuttered facades): salmon and
  rose pinks, pale yellows and creams, ochre, one strong orange-red and one weathered red per
  row, the odd white, pale green or pale blue house. Chalky, not glossy. Shutters a deep
  bottle green, nearly black in shade.
- *The paint-overs* (clustered with a small script): sunlit walls are salmon/coral (#E68A63,
  #E78C72), orange (#D97244, #F1874A), golden (#D8A353, #F2B25B), peach (#EBAC79, #F7BF85) and
  pale cream-peach (#E8CFB5). They lean orange because they were painted over the game. Their
  shutters are dark teal-greens: #163A31 to #356156, lit slats about #116354.
- *The plaster texture* is greyscale and tinted by the house colour, so it agrees with anything;
  it adds about ±10% brightness, which is why the paints are mid-tones rather than pale.
So: fewer oranges, more pinks and creams, three cool colours at low weight, every pigment less
saturated than v0.15, and mid-toned enough that the brightest sunlit walls stay under ~80%.

**House colours** (hex, relative weight, family). With v0.16's light a wall in full sun shows
about the colour written here.

| Family | Colours |
|---|---|
| yellow | golden ochre `#dda546` (7) · deep ochre `#cb8f3b` (5) · straw `#e0bc73` (6) · pale lemon `#e5ce86` (5) |
| orange | soft orange `#db8444` (6) · burnt orange `#c66a39` (5) · peach `#e09a6b` (6) |
| red | Genoa red `#b14635` (4) · coral red `#cb5a41` (4) · terracotta `#aa5f44` (4) |
| pink | salmon `#d88269` (8) · rose `#d58d81` (7) · dusty rose `#c37c71` (6) · shell pink `#e0ac97` (6) |
| pale | cream `#e2cea3` (6) · limewash `#dfd4bd` (3) · stone render `#caba99` (4) |
| cool | sage `#adb795` (3) · pale mint `#beceae` (2) · grey blue `#b0bab8` (1) |

**Shutters** (per house): bottle greens `#2a5a3c` (3), `#23533a` (2.5), `#2e6347` (2), `#1f4d3b`
(1.5), lighter `#3a6844` (1.2), sun-faded `#5b7a60` (0.7), weathered grey-green `#7b8a7c` (0.3),
bare brown `#6b4a38` (0.3), slate blue `#39505a` (0.2). v0.15's were `#2f7656`–`#4a8a63`: lighter,
brighter and all one hue, which is why they read as flat poster green. The hue sits between the
photos' yellower green and the paint-overs' teal.
**Doors:** dark green `#24513b`, timber `#7d5f41`, walnut `#4a3226`, weathered grey `#6e6558`,
blue-grey `#3c5560`, oxblood `#6b2f28`. **Awning stripes** a little less bright.

**In the demo town** (182 houses): yellow 45 → 40, orange 41 → 33, red 26 → 21, pink 38 → 37,
pale 25 → 38, cool 7 → 13. Orange + yellow fell from 47% to 40% of houses. Touching houses still
never share a colour (unit test, unchanged) and rarely a family.

**Measured** (same methods as Stage 1; `docs/progress/v0.17/`):

| | v0.15 | v0.16 | v0.17 | target |
|---|---|---|---|---|
| Postcard picture, like the paint-overs: shade / typical / brightest | 36.5 / 67.5 / 87.6 | 35.5 / 60.8 / 80.6 | **32.5 / 59.8 / 79.6** | 29–31 / 56–61 / 77–80 |
| …mean saturation of warm pixels | 0.53 | 0.43 | **0.41** | 0.47–0.55 |
| Wall pixels only, High Neutral midday | 38 / 68 / 88 | 38 / 61 / 81 | 36 / 62 / 79 | 37–46 / ~60 / ~76 |
| …sunlit walls only (10th / 50th / 90th) | 60 / 73 / 88 | 53 / 62 / 79 | 49 / 65 / **76** | |
| Low Neutral midday | | 38 / 60 / 81 | 35 / 61 / 78 | |
| High Warm midday | 39 / 66 / 83 | 38 / 59 / 77 | 36 / 61 / 76 | |
| High Neutral golden hour | | 36 / 58 / 75 | 33 / 60 / 74 | |

**Decisions.**
- *Saturation went down, but not as far as a first try.* The first version of this palette
  (paler, greyer) measured 34 / 62.5 / 80 with saturation 0.38: lighter than the target and well
  under the paint-overs' own saturation (0.47–0.55). Each warm colour was then deepened by about
  4 points of lightness and given 5 points of saturation back. Every colour is still less
  saturated than its v0.15 counterpart.
- *Pale houses rose to one in five.* That is what the harbour photo shows, but it holds the
  "brightest" figure near 79–80%. If that still reads as washed out on a real screen, lower the
  weights of cream, limewash and shell pink in `data/palette.json`.
- *Shade got about 3 points darker* in these figures (35.5 → 32.5) although no light changed:
  the deeper reds and ochres are simply darker in shade. It is still inside the paint-overs'
  range.
- *Shutters stay mostly green.* The brief asked for less flat, less saturated: the paints are
  darker and vary more between houses now; the flatness itself is the job of Stages 3–4 (slats,
  thickness, shade).

**Frame rate:** data only, so nothing to draw differently (same 122 draw calls, 0.61 M
triangles as v0.16). Not re-profiled.

Pictures: `docs/progress/v0.17/`.

### Stage 3 · Small-scale shading (v0.18) — done

All of it is **baked when a house is built** (no screen-space effect, nothing per frame), so it
is the same on Low, Medium and High.

**How it works.** The wall mesh now carries three extra numbers per corner point (`aBake`;
`GeoBuilder.bake` in `src/buildings.js`). The first is "how open to the sky is this spot": 1 on
open wall, 0 deep in a crease. The wall is cut into a few extra pieces round each crease
(`GeoBuilder.wallHoles`, "patches") so that number can change across it, and the walls' shader
darkens by it. The other two numbers are spare, for Stage 5's weathering.

| Where | How |
|---|---|
| **Inside window and door reveals** | the four inner faces of every opening: darkest under the head and at the back, lighter on the seat |
| **Under sills** | a patch on the wall below each stone sill, fading over 0.6 m |
| **Under balconies** | a patch below each slab fading over 2.2 m (from the game's high cameras the slab hides the first half metre, so it has to reach further than a real one); a thin one on the wall just above the slab; slab undersides and consoles darkened in their own colours |
| **Under the eaves** | the existing band, stronger and longer (0.3 over 1.1 m → 0.4 over 1.4 m); cornice underside darker |
| **Wall bases** | the existing foot shade, reaching higher: in the open 0.22 over 1.8 m → 0.3 over 3 m; in a narrow lane 0.5 over 7 m → 0.55 over 8 m |
| **Where a wall rises from a neighbour's roof** | that wall now treats the roof as its ground, so it gets a foot shade (and damp) there instead of none |
| **Inside corners where houses meet** | where a neighbour's wall stands out in front of the end of a wall: a vertical patch 1.6 m wide, up to the neighbour's top |
| **Frames in the recess, awning undersides** | darkened in their own colours |

The shade is slightly **warm, not grey** (`ao.warmth`): what light reaches a crease has bounced
off warm walls and paving. All numbers: `CONFIG.building.ao`.

**A check view** (kept): `node tools/shot.cjs --js "game.growth.renderer.aoUniforms.uAOOnly.value = 1"`
draws the houses white with only the baked shade (`docs/progress/v0.18/shade_only_*.jpg`).

**What I learned on the way.** The first version (creases only, tight falloff) was correct but
changed the Postcard picture by a few percent: from above, what lies *under* a balcony or sill
is mostly hidden by it. What reads from the Postcard and Overview cameras is the broad shade:
wall feet, lanes, corners, roof junctions, and long soft falloffs. So the falloffs are longer
and straighter than a physically exact occlusion would be.

**Measured.** Postcard picture, like the paint-overs: 32.5 / 59.8 / 79.6 → **31.0 / 58.6 / 79.4**
(paint-overs 29–31 / 56–61 / 77–80): the shade got a little deeper, as the targets' is; sunlit
walls unchanged.

**Frame rate (High, Postcard, midday, software renderer):** 4.67 s a frame against v0.15's
4.33 s (+8%, inside the run-to-run noise of ±10–20%); **0.61 M → 0.64 M triangles** (the extra
cuts in the walls: +30,000), 122 draw calls (unchanged). No new textures, no new passes.
Expect the same fps as v0.15, or a frame or two less.

**Not done / limits.**
- No shade on the *ground* where walls meet it (terrain is out of scope).
- A house's side wall that is only partly covered by a set-back neighbour gets no corner patch
  on that side (only the wall that is overlooked does).
- The patches are straight-edged; right at a patch's corner the falloff follows the triangle
  split. Not visible from the Postcard or Overview; faintly from very close.

Pictures: `docs/progress/v0.18/`.

### Stage 4 · Windows, shutters and doors (v0.19) — done

**The main fault found.** From the Postcard and Overview cameras every window was drawn at its
"far" level of detail (anything beyond 55 m): one flat painted rectangle standing *in front of*
the wall, with painted green stripes for shutters. The recessed openings and louvred leaves of
v0.13 only ever showed close up. That is why windows read as panels on the wall's face.

**Now a window is a hole in a thick wall at every distance.**
- **The opening** is cut through the wall mesh as before, but **26 cm deep** (was 18), with the
  reveal's shade from Stage 3. Doors 32 cm, arched entries 38 cm, workshop doors 30 cm,
  shopfronts 26 cm.
- **Always drawn:** a **stone sill** (its own part now: pale limestone to grey slate, one stone
  per house, 7 cm thick, 6 cm proud) and the **dark glass at the back of the recess**. The glass
  draws its own pale frame, mullion and transom, softened when they get thinner than a pixel,
  so the far view is the same pane as the near one. Rooms behind the glass are about half as
  bright by day as before. *(This also means lit windows at dusk now show from the Postcard
  view; before, far windows could not light up.)*
- **No lintel boxes.** The plaster runs to the edge of the opening. Decorated houses keep a
  **painted surround, 9 cm wide (was 13), half way to the wall colour** (was a third).
- **Near (within 55 m on High):** the modelled frame with its glazing bars.
- The flat painted "far" openings (`paint_*`) are gone, with their four materials.

**Shutters** (`data/facades.json` → `shutters`).
- A leaf is **hinged on the outer corner of the reveal**, as real persiane are. Shut, it lies
  *inside* the reveal, 3 cm behind the wall face, in the reveal's shadow; folded back, it lies
  flat against the wall. It is **4.5 cm thick**, with stiles, top, bottom and middle rails.
- **Near:** 14 tilted slats per leaf on both faces; under each slat the shaded gap is a dark
  strip, so the slats show at any distance they are drawn at. **Far:** a framed board: paler
  stiles and rails round a darker louvred panel (20 triangles; 10 when shut).
- **States** (demo town, 2,492 windows): both shut 35%, both folded back 26%, one folded back
  and one shut 12%, one shut and one standing part open 9%, both pushed ajar 9%, one leaf
  missing 5%, no shutters 4%. Each leaf takes one of three shades of its house's shutter colour;
  **on about one house in five the leaves are sun-bleached** toward grey-green, each by a
  different amount.
- Shutter greens moved a little toward the paint-overs after measuring them (they came out
  darker, yellower and more saturated than the paint-overs' at first): now `#335d49`,
  `#2c5747`, `#386654`, `#285147`, `#446b52`, faded `#647e6c`, grey `#838f86`, brown `#6b4a38`,
  slate `#39505a`. Green pixels in the Postcard town: lightness 12 / 17 / 27% (10th / 50th /
  90th) against the paint-overs' 14 / 20 / 29% and v0.15's 17 / 31 / 41%; they cover 4% of the
  town picture (paint-overs 3.4–3.9%, v0.15 7.3%).

**Doors.**
- Deeper recess (32 cm); the **timber door is two leaves** with a dark joint, and near the
  camera raised stiles and rails round sunk panels, and a knob.
- **Two stone steps**: house doors and arched entries now stand 30 cm above the lane on a
  threshold and a wider step below it (the lower one sinks into the ground where the lane
  climbs). Jambs a little slimmer (15 cm).
- **Cellar windows** on stone ground floors are real barred holes through the stone now (they
  were a flat frame-and-pane sticker on the stone).

**Kept:** no openings on covered walls, and its test (`tests/unit/openings.test.js`, unchanged
check; 60/60 pass). The same test now also checks: openings at least 20 cm deep; a shut leaf lies
wholly inside the reveal, at least 3 cm behind the wall face and clear of the frame; no painted
far openings; the glass is drawn at every distance.

**Decisions.**
- *CC0 models:* see "Decisions that hold for the whole run": none suitable; built in code.
- *Far leaves are boards, not slats.* From the Postcard a leaf is about 5 pixels wide, so 14
  slats would be noise. The board's darker panel stands in for the slats' shade.
- *When both leaves are shut, the frame and glass behind them are not built* (never seen).
- *Lintels removed rather than restyled:* the brief asked for thin, low-contrast surrounds, and
  the photos show plaster straight to the opening on most houses.
- *Shut leaves 3 cm inside the reveal, not flush:* the gap rule (`CONFIG.building.facadeGap`)
  that stopped the v0.11 flicker still holds for every face.

**Frame rate (High, Postcard, midday, software renderer):** 4.83 s a frame against v0.15's
4.33 s (**+11%**; run-to-run noise is ±10–20%, but this one is probably real). **Draw calls 122
→ 107** (the four painted-opening batches per chunk are gone). **Triangles 0.64 M → 0.76 M**:
shutter boards, sills and glass are now drawn for every far window, where one painted
rectangle stood before. On a real graphics card I'd expect a few percent, not a visible drop;
please check ⚙️ Settings.

**What got worse / still differs.**
- Close to a house the shutters' wood texture is strong (streaky), most of all on sun-bleached
  leaves.
- "Ajar" and "part open" leaves swing through the corner of the reveal by a centimetre or two
  (they pivot on a point, not on real hinges). Not visible beyond a few metres.
- No tilted lower shutter panels (the Ligurian *gelosia*) and no curtains or people in windows.
- The single-building target's shutters are a brighter emerald in sun; ours are a touch darker
  and bluer.

Pictures: `docs/progress/v0.19/`.

### Stage 5 · Plaster weathering (v0.20) — done

The wall shader (`WEATHER_GLSL` in `src/materials.js`) was rewritten so weathering is **placed
by what is on the wall** (sills, balconies, doors, corners, the ground) rather than scattered
by noise. All numbers: `CONFIG.building.weather`.

| What | How |
|---|---|
| **Drip streaks below sills** | 70% of sills: a patch baked into the wall under the sill (the second `aBake` number) running 0.7–1.15 m down, at most to the head of the window below; the shader breaks it into soft runs a hand or two wide, darker and slightly greyer |
| **…and below balconies** | every slab: 2 m down, strongest under its two ends, where water leaves a slab |
| **Rising damp** | at every wall foot, 0.7–1.9 m high with a wandering top edge, darker, greyer and faintly green; also where a wall rises from a neighbour's roof (Stage 3 made that its "ground") |
| **Sun-faded patches** | paler, greyer patches a few metres across (strength 0.45 → 0.55), now stronger on the side the afternoon sun bleaches (south-west, toward the sea), at 45% strength on walls facing away, and stronger higher up the wall |
| **Plaster worn back at corners and doors** | on *every* house a little (it used to be only the ~1 house in 10 in poor repair): within 45 cm of a corner up to 2.4 m, and within 55 cm of a door (the third `aBake` number). It breaks first to the pale undercoat, then the grey render, and only in the deepest spots to the rubble stone |
| **Speckle removed** | (1) the plaster photo's pits: its detail contrast is now 0.7 with a softer mip level; (2) the Hand-painted style's brush strokes on walls fade out once they are finer than a few pixels (they were ±10% brightness at a 45 cm pitch: pure speckle from the Postcard); (3) the "crumbs" noise on worn plaster edges halved; (4) painted corner stones no longer amplify the plaster's pits |
| **Gone** | the sill streak *decals* (transparent multiply-blended rectangles in front of the wall, drawn only within 140 m, so never from the Postcard): replaced by the baked drips, which show at every distance |

**Kept subtle on purpose** (the brief): a streak darkens the wall by at most 40%, damp by 50% at
the very foot, grime 4%, mottling 4%.

**Measured.** Postcard, like the paint-overs: 29.6 / 57.8 / 79.0 (v0.19) → 30.4 / 58.8 / 79.4;
unchanged within a point, as it should be for weathering.

**Frame rate (High, Postcard, midday, software renderer):** 5.24 s a frame (v0.19 4.83 s, v0.15
4.33 s; single runs, noise ±10–20%). Draw calls 107 → **101** (the streak decals are gone);
triangles **0.76 M** (same as v0.19: the drip and scuff patches cut the walls into more pieces,
+24,000 triangles in the walls, the decals' removal gives it back). The wall shader does a
little more per pixel (three more noise lookups).
*First try:* drips 1–2.4 m long with a line across the wall per window: 0.84 M triangles. Now a
storey's windows share one drip length, and a drip stops at the window below.

**Decisions.**
- Drips stop at the head of the window below. Real streaks are often longer, but the windows
  stack in columns, so a longer one would only run into the next opening.
- Wear at corners and doors is on every house, but thin: at most a patch or two per corner.
  Houses in poor repair still lose plaster in blotches up the wall as before.
- The sun-bleached side is fixed (south-west), not tied to the time-of-day slider: paint does
  not un-fade at dusk.

**Still differs.** The paint-overs' walls have more hand-painted variation (brush texture,
warmer and cooler washes) than ours; close up our plaster is clean between the streaks.

Pictures: `docs/progress/v0.20/`.

### Stage 6 · Break the procedural rhythm (v0.21) — done

Every house now draws its own numbers from ranges in `data/facades.json` → `rhythm` (content is
data; the code is in `_look` and `_buildOne`, `src/buildings.js`). **Windows still stack in
vertical columns.**

| Asked for | What was done |
|---|---|
| **Storey heights** | each house has its own: ordinary storeys 2.75–3.25 m, a low attic (2.3–2.65 m) on 35% of houses, one storey of higher rooms (+0.25–0.5 m) on 35%, and ±7 cm on every storey. They are fitted so the ground floor still starts at ground level and the eaves stay where the town's growth put them (which still counts 3 m a storey) |
| **Mismatched window sizes** | per house: width × 0.86–1.06, height × 0.84–1.08 (and never taller than the storey allows); 30% of houses have one column of narrower windows (× 0.76), 25% one storey of shorter ones (× 0.8, sill raised) |
| **Irregular column spacing between houses** | per house: the spacing between columns is × 0.76–1.08; on 55% of fronts the columns sit to one side instead of centred; windows may stand 30 cm from a corner (was 55) |
| **Occasional blank walls** | 12% of side and back walls have no windows at all (never the front, never a wall looking over the harbour); another 14% of them have a single column |
| **Painted fake windows** | a blind column on 18% of fronts (was 8%), painted 6 times in 10; on a blank wall, 12% of the places a window would have been are painted. 89 in the demo town (v0.20: about 60) |
| **Interrupted string courses** | laid wall by wall now: always along the front, round each other wall only 55% of the time (33% on the back), never where a neighbour hides them, and on 30% of houses the front one stops 40–75% of the way along |
| **Interrupted cornices** | 48% of houses keep the two-step cornice, 29% have one plain step, 24% none (the eaves sit on the wall), so the cornice line breaks from house to house |
| **Asymmetric balconies** | each wall has a "balcony column" where 75% of its balconies stack; each house has × 0.7–1.3 the usual number; a balcony across the whole front is rarer (22% of balcony storeys, was 45%) |

Also: painted corner stones are lower in contrast (they read as a dotted white line from the
Postcard).

**Numbers (demo town, 182 houses):** 1,991 windows (v0.20: 2,492), 112 balconies (134), 89 painted
windows. A new unit test (`tests/unit/facades.test.js`) checks that windows stack in columns on
over 90% of walls while window widths, heights and storey heights vary; 61/61 pass.

**A bug caught on the way.** The first version lost a third of all windows. Two causes: storeys
of free height no longer lined up with the ground, so the ground-floor row fell half underground
and was dropped (fixed by fitting the heights between the ground and the eaves); and my change
to the "too short, make it a small window" rule moved such windows back down into the dado.
Found by counting, per storey, why each window was skipped.

**Decisions.**
- *Fewer windows (−20%) on purpose*: blank and one-column side walls and wider spacing on some
  houses are what the brief asked for. If the town now looks too closed from the Postcard, lower
  `rhythm.blankWall` and `rhythm.sparseWall`, or `rhythm.columnPitch`'s upper end.
- *Storey heights vary inside the same total height.* Changing how tall a house is would have
  been massing (out of scope) and would have moved roofs.
- *Cornices vary per house rather than breaking along one wall*: along a street that reads as an
  interrupted line, and a half-cornice on one wall would need new end pieces.

**Frame rate (High, Postcard, midday, software renderer):** 4.83 s a frame (v0.20 5.24 s, v0.15
4.33 s). Draw calls 101 → **95**, triangles 0.76 M → **0.69 M** (fewer windows).

**Still differs.** The paint-overs' facades carry more on them (awnings, plants, washing on most
floors): out of scope here (no new decorative objects). Blank walls are plain plaster; real ones
often show a bricked-up opening or a drainpipe.

Pictures: `docs/progress/v0.21/`.

### Decisions that hold for the whole run
- **CC0 models (windows, shutters, doors, railings): looked, not used.** Poly Haven is reachable
  but has only industrial roller-shutter windows, a castle door and modern apartment/factory
  facade kits; kenney.nl is blocked (HTTP 403) from this sandbox; Quaternius has no Ligurian
  louvred shutters or balconies. None is clearly better than the code-made parts, which already
  match the houses' sizes and can vary per window, so parts stay code-made. Nothing new in
  `ASSETS.md`.
- Reference photos stay in `Rio-reference`; only the game's own screenshots and Adam's
  paint-overs (in the final comparison sheets he asked for) go into `docs/progress/`.

## Earlier run: v0.15 · Lot sizes (short data-only run)

Brief: some lots were too big and became blocky houses, breaking the rhythm of narrow towers.
Only `data/blocks.json` changed (no planner code, roofs, facades, lighting or terrain):

| | v0.14 | v0.15 |
|---|---|---|
| harbour lots | 3.0–4.6 m wide, ≤ 8.5 m deep | 2.8–4.4 m wide, ≤ 7 m deep |
| town lots | 3.3–5.0 m wide, ≤ 8 m deep | 3.0–4.6 m wide, ≤ 7 m deep |

Result (demo town, 700 steps): 182 houses (177), 99 in harbour/town blocks (92); median
footprint there 23 m² (25), houses over 40 m² 3 (7), largest 46 m² (54). Coverage: harbour 87%
(86%), town 91% (92%). Draw calls 122 (unchanged). Unit tests 60/60; browser suite and speed
comparison skipped as asked. Sheets: `docs/progress/v0.15/`.

Tried and rejected: harbour depth 6.5 (coverage 83–84%), smaller wedge growth (`wedgeReach` 2.5–3,
coverage 77–81%), and some width settings that left 13–19 m² slivers beside lanes (the sliver
test caught them).

Still too big: the remaining large houses are **corner and wedge lots** (a corner snaps onto the
crossing lane; a wedge grows its back corners into leftover space). Lot width and depth settings
don't limit those. **"Split any lot over that size" needs a small planner change**: cut corner or
wedge lots over ~35 m² into two. I didn't make it, because this run was limited to data.

## Earlier run: v0.14 · Footprints (how houses fill the land between paths)

Adam's brief: blocks enclosed by lanes should be nearly solid building (continuous fronts along
every lane, shared side walls, interiors filled, at most a small courtyard), dense near the
harbour, looser up the hill. Not touched: palette, lighting, facade styles, trees, terrain, water.
Dev branch: `claude/nice-planck-k467qs`.

### How zoning and house placement worked before this run (v0.13)

- **Zoning** (`zones.js`): a 2 m grid of cells painted RES (homes) or COM (shops). The demo
  (`demo.js`) paints a broad band 5–44 m either side of the main street, the waterfront, and
  shops round the harbour floor. Walking effort from every cell to the harbour (`access.js`)
  says how central each place is.
- **Lanes** (`lanes.js`): every path (and the quay) has two *frontage lines*, the centreline
  offset by half the paving + a 0.25 m setback (1.25 m). The hard rule: no ordinary wall within
  that distance of a lane, the quay, piazza or slipway (`clearOf`, an exact test), plus a 4.5 m
  band along each lane reserved for houses that front it.
- **Growth** (`growth.js`), one house per step at most: each step tries 70 random *candidates*
  from templates and builds the best-scoring valid one (near the harbour, touching neighbours,
  fronting a lane, a bit of randomness):
  - *frontage* lots along a frontage line (front flush, sides square to the lane, extending a
    row so neighbours share side walls, depth 3.2–8 m or to the middle of the block);
  - *back* lots behind a house (continuing its side lines), *side* lots continuing a row,
    *wedges* joining two differently aligned neighbours, *corners* at junctions, pointed
    *fork* (flatiron) buildings, *archway* houses over side stairs and *covered passages*.
  - A candidate must be a convex quad, zoned, reachable, not on cliff or in the sea, under 9 m
    of fall, not overlap a house (since v0.12: by more than 5 mm), and clear of the lanes.
- **Why blocks end up loose**: nothing plans a block as a whole; templates are tried at random
  and many fail (ray-measured back and wedge lots overshoot their neighbours by centimetres and
  are rejected by the 5 mm overlap rule), so gaps that no template fits stay open. Infill
  (`infill.js`) then dresses every leftover with orti, patios, paving and pots, which is what the
  screenshot of the shore–piazza block shows.
- **Facade builder**: footprints are any convex quadrilateral (trapezoids and wedges already
  work); each of the four walls gets its own facade, openings, bands and party-wall checks.

### What was done (v0.14)

**Steps 1–2: blocks from paths, lots along the frontage** — new `src/blocks.js` (pure rules, no
Three.js, no DOM) with its numbers in `data/blocks.json`; `growth.js` builds its plan.
- *Blocks*: zoned, reachable, buildable land on a 1 m grid, minus every lane, the quay, piazza
  and slipway (the exact lane test), split into connected pieces. Each block gets a value band
  from its mean walking effort: harbour (≤ 75), town (≤ 140), edge.
- *Lots*: each lane's two frontage lines (busiest lane first, the quay first of all) are cut
  into runs where the same free block lies behind, and each run into lots of varied width
  (harbour 3.0–4.6 m, town 3.3–5.0 m, steep 3.3–4.6 m). Fronts lie exactly on the frontage line;
  sides follow the lane's normal there, so neighbours share side walls exactly and rows follow
  bends as trapezoids. Depth: to the middle of the block, its edge or a lot already there, or
  the band's maximum (8–8.5 m).
- *Corners*: where a run ends at another lane, the end lot's side is snapped onto that lane's
  frontage line, so the corner house fronts both. Run ends and lot backs are moved (by
  bisection) until they meet the neighbouring lot exactly.
- *Wedges and gap lots*: leftover corners are taken by moving a lot's back corners out until
  they meet a neighbour or a lane (never out into open land, never sharper than ~24°); any
  leftover still beside a lane in a harbour or town block gets a lot of its own fronting that lane.
- *Quads*: the facade builder already handled any convex quadrilateral (each wall its own
  facade, openings and cover checks), so no change was needed there.
- The old template growth is still there behind `CONFIG.sim.plannedLots = false`.

**Step 3: party walls** — the cover test already left openings, balconies, pipes and plants
off any wall a neighbour stands against (the 2 m rule from v0.13). Now the hidden part of such a
wall isn't drawn at all: the wall starts at the neighbour's eaves height (`_partyTops` in
`buildings.js`), and string courses/bases on it are skipped. Heights still vary per house
(`targetFloors`), so the roofline steps.

**Step 4: interiors** — mostly by deeper front houses that reach the middle of the block (the
blocks in the demo are 14–20 m between frontages). A *rear* lot is made behind a front lot that
stopped at its maximum depth with ≥ 3.2 m of block left; the front house then gets an arched
passage (`b.passage` → arched ground floor). In the demo only one block is deep enough.

**Step 5: density by land value** — the bands' coverage targets and lot sizes are data
(`data/blocks.json`). Result on the demo town (700 steps):

| Band | blocks | area | built over (v0.13 growth) | built over (v0.14) |
|---|---|---|---|---|
| harbour | 7 | 880 m² | 52% | 86% (target 85%) |
| town | 7 | 1,615 m² | 66% | 91% (target 70%) |
| edge | 6 | 4,750 m² | 67% | 62% (target ~40%) |

(Measured over the same blocks. The v0.13 edge figure is higher because its side lots spread
into open edge land; v0.14 keeps the edges looser on purpose.)

**Step 6: slopes** — no terrain smoothing. Lots follow the lanes; each house still steps with
its own ground (floors counted from the uphill side, walls down to the lowest ground). A lot whose
ground falls more than 7.5 m is cut into a front and a rear house.

**Step 7: growth** — each step builds the open lot nearest the harbour (frontage first, rear
houses once their front house stands); floors keep growing as before. No new gameplay. The
plan is redone (lazily, at the next growth step) when paths or zones change, fitting around the
houses already standing.

Numbers: 175 houses (v0.13: 219), mean footprint 30 m² (v0.13: 23 m²), 545 storeys (v0.13:
563), tallest 8 (8). Planning the demo town takes ~0.3–0.4 s in Node.

### Tests added (`tests/unit/blocks.test.js`)
- the town is built from the plan; no building overlaps a path, quay, piazza or slipway;
- no sliver/wedge gap (long and thin, over 12 m²) beside a lane in a harbour or town block, and
  at most one yard (≤ 60 m²) per block;
- harbour and town blocks meet their coverage targets (and no big one is > 12 points under);
- every house is reached from a lane (front on a connected lane, or a rear house through a
  passage);
- no opening or wall-mounted part on a party wall below the neighbour's top.

### Performance

Interleaved runs in this sandbox's software renderer (`tools/profile.cjs`, postcard view,
1280×720, Golden hour): v0.13, v0.14, v0.13, v0.14. Single runs vary by about ±10–20%.

| Preset | v0.13 | v0.14 | change |
|---|---|---|---|
| Low | 2.85 / 2.81 s, mean 2.83 s | 3.13 / 2.71 s, mean 2.92 s | +3% (within the noise) |
| Medium | 4.44 / 4.09 s, mean 4.26 s | 4.50 / 4.01 s, mean 4.25 s | 0% |
| High | 4.84 / 4.38 s, mean 4.61 s | 4.81 / 4.41 s, mean 4.61 s | 0% |

Draw calls 142 → 122. Triangles at the postcard view: Low/Medium 0.58 M → 0.61 M; High 0.58 M →
0.90 M (more houses inside High's near-detail range now the blocks are full). Party walls skip
their hidden faces, which pays for most of the extra walls of a denser town. The browser test
suite's frame-time checks: Low ×1.04, Medium ×1.04, High ×0.80 of baseline. **So v0.14 runs at
about the same speed as v0.13.** Raw runs: `docs/progress/v0.14/profile/`.

### Comparison sheets
In Rio-reference `progress/`: `v0.14_overhead_before_after.jpg` (the shore–piazza blocks from
above, as in Adam's phone screenshot), `v0.14_postcard_before_after.jpg`,
`v0.14_target-v2-1_vs_game.jpg`, `v0.14_block_plan.jpg` (top-down plans). Game-only copies in
`docs/progress/v0.14/`.

### What still differs from target-v2-1, what got worse, what next
Still differs:
- The target's town climbs the hill in long stepped rows along the stairs; ours is still a
  compact rectangle round the main street, because the demo's zoning and lanes stop there.
- The target has a few big landmark buildings and visible lanes/stairs cutting through; our
  lanes are now narrow slots between eaves, nearly hidden from above.
- Roofs: big wedge and corner lots get one broad roof each; the target's roofs are smaller and
  more broken up. Some wedge houses come to sharp points (down to ~24°) that real towns avoid.
- Rear houses and courtyards hardly appear (the demo's blocks are 14–20 m deep, so front houses
  reach the middle).
- Terraces, gardens and the shoreline detail of the target are untouched (out of scope).

Got worse:
- **Archways over stairs, covered passages over lanes and pointed flatiron buildings are no
  longer made** (the template growth made them; the block plan doesn't yet).
- Fewer, bigger houses: 175 instead of 219 (mean footprint 30 m² vs 23 m²), so fewer storeys in
  all (545 vs 563).
- Redoing the plan costs ~0.3–0.4 s, once, at the next growth step after a path or zone change
  (a small hitch while painting zones).
- Some houses now reach a little further onto the beach edge by the harbour.

Next I'd tune: bring archways and flatirons back as lot types in the plan; split very large
wedge lots in two (smaller roofs, more houses); cap the sharpest wedge angles; make the demo's
zoning run further up the hill so the town climbs like the target.

### Decisions (v0.14)
- Lots are cut from frontage lines in order of lane rank (the quay first), so a corner house
  fronts the busier lane: same rule as before.
- Fronts reach the middle of the block rather than stopping at a fixed depth and leaving a
  courtyard: the brief asked for nearly solid blocks, and the demo's blocks are shallow.
- The old template growth is kept behind `CONFIG.sim.plannedLots = false` for comparison and
  for a quick rollback.
- Coverage targets are minimums for harbour and town; the edge band's 40% is a guide, not
  enforced (it came out at 62%).

## Earlier run: v0.13 · Facades (facade detail and colour)

Adam's buildings brief, narrowed by his addendum after reviewing v0.12: building shapes and massing
are fine (not reworked), roofs low priority; the gap is facade detail and colour. Worked in his
order, committing and screenshotting after each step. Dev branch: `claude/nice-planck-k467qs`.
Not touched: trees, terrain, water. Network: polyhaven.com and ambientcg.com reachable.

| Step | State |
|---|---|
| 1. Windows and shutters | done |
| 2. Balconies | done |
| 3. Ground floors | done |
| 4. Palette (colour data only) | done |
| 5. Horizontal trim | done |
| 6. Plaster variation | done |
| Performance: chunks, detail by distance | done (numbers below) |
| Comparisons (target-v2-1, single building, target 05) | done: `Rio-reference/progress/v0.13_*` |

**Content is data** (CLAUDE.md): `data/facades.json` (window kinds and sizes, recess, frame,
sill, lintel, shutter states and angles, balcony variants, ground-floor variants by place,
awnings, trim), `data/palette.json` (facade, shutter, door and awning colours),
`data/houses.json` (condition spread, floor uses). Loaded by `src/data.js` (browser: fetch;
tests: from disk). New shapes in `src/facade.js`.

### 1. Windows and shutters
- **Openings are cut through the walls** (`GeoBuilder.wallHoles`, `_shell`): each wall face is
  tiled round its openings, with four reveal faces 18 cm deep, so the sun casts real shadow into
  them. The frame (7 cm bars, mullion, transom on tall windows), glass, stone sill and lintel
  sit in the recess (`frameGeometry`). Stone bases, dados and string courses are cut too
  (`_bands`).
- **Windows about twice the area**: 1.15 × 1.85 m standard (was 1.14 × 1.71 including its frame,
  with the glass only 0.84 × 1.41), French windows 1.15 × 2.35 down to the floor, small top-floor
  windows 0.85 × 1.15; a window column every 1.85 m on the lane wall (was 2.0) and 2.6 m on
  others (2.9); a third of facades pair two windows 0.5 m apart. Blank bays 8% (was 18%).
  The demo town has 2,273 windows (v0.12: about 1,600).
- **Louvred shutter leaves as geometry** (`leafGeometry`: stiles, rails, 12 tilted slats each,
  a plain back), hinged on the wall: shut, folded back flat against the wall, half open (one
  leaf shut, one standing out 30–80°), or none; small random angles and sag. A leaf folds back
  only where there is room (not over the next window, a door or a neighbour).
- **No openings on walls with a neighbour or the hillside within 2 m** (`clearInFront`).
- Bug fixed on the way: windows next to a corner were dropped whenever a neighbour stood beside
  them (the cover test included both folded leaves); it now tests the opening itself.

### 2. Balconies
- Most upper floors of harbour-facing houses (80% per floor), 42% elsewhere on lane walls; now and
  then one balcony across the whole facade (`_balcony`). Four variants: 1.6, 2.6 and 1.9 m wide,
  0.85–1.15 m deep; slab with a moulded edge on two or three consoles, iron railing (dark,
  green, white or grey) or a rendered parapet; pots with geraniums, flowers spilling over the
  rail, a chair now and then, washing over the rail. 92 balconies in the demo town (v0.12: 25).

### 3. Ground floors
- Each lane-facing ground floor shows its use (from the house's plan): a **shopfront** (recessed
  glazing, stall riser, glazed door, sign board), a **workshop** (wide plank double doors), an
  **arched entry** (round-headed, stone voussoirs, fanlight door), or a **house door** (stone
  jambs, lintel and step, set back 22 cm). Harbour houses also open onto the quay and piazza.
- **Awnings** over shops and some workshops: striped (stripes made in the shader, 20 cm wide,
  colours from `palette.json`) or plain cream, with a valance.
- Plain houses stand on a **dressed-stone base** following the lane (0.55–1.0 m), replacing the
  thin plinth; the harbour bases and rough stone ground floors are now cut by their openings.

### 4. Palette (data only)
Towards target 05 and the golden-hour photo: golden yellow, deep ochre, sun-faded ochre, lemon,
orange, burnt orange, peach, **Genoa red (bold)**, coral, terracotta, salmon, rose, dusty rose,
cream, limewash, sage. v0.12's lighting and colour-space fixes unchanged. Touching houses still
never share a colour (unit test).

### 5. Horizontal trim
A two-step cornice under the eaves on every house (the upper step further out, so it casts a
shadow line, with a shaded underside), and subtle bands at the floor lines on decorated houses
and 40% of the others, in a colour close to the wall, always above the highest ground (they never
cross a door).

### 6. Plaster, and the house's condition
- **Each house has a plan** (`src/houseplan.js`, pure game state, no Three.js): `condition` 0–1
  (seeded, mostly 0.4–0.75) and a `use` per floor ('family', 'shop', 'workshop'). The renderer
  only reads it: condition fades and greys the paint, crumbles plaster only below 0.35, and thins
  the flowers; the ground floor's use picks its look. Later gameplay can set both.
- The **grey blotches are gone**: houses in fair repair keep their plaster; where plaster falls
  away it shows mostly the pale undercoat, grey render only deeper in. Gentle mottling, a slight
  tone per house, softer damp at the foot, lighter streaks under sills.
- `damaged_plaster` (Poly Haven, CC0, confirmed) replaces the worn-plaster texture (ASSETS.md).

### Performance

Measured in this sandbox's software renderer (`tools/profile.cjs`, postcard view, 1280×720): only
relative numbers carry over to a real GPU, and single runs here vary by about ±20% (the same build
measured 4.6 s and 5.9 s a frame an hour apart). So the fair comparison is **interleaved**: v0.12,
v0.13, v0.12, v0.13 back to back, three timed frames each, Golden hour:

| Preset | v0.12 | v0.13 | change |
|---|---|---|---|
| High | 5.16 / 3.97 s, mean 4.57 s | 4.67 / 4.62 s, mean 4.65 s | +2% (within the noise) |
| Low | 2.84 / 2.57 s, mean 2.70 s | 2.66 / 2.78 s, mean 2.72 s | +1% (within the noise) |

Single full runs, all presets (noisy): `docs/progress/run-f/profile_before.json` (v0.12) and
`profile_after.json` (v0.13). Triangles per frame at the postcard view: Low 0.52 M → 0.58 M,
Medium/High 1.04 M → 1.11 M; draw calls 57–59 → 142–144.

**So v0.13 costs about the same as v0.12, with far more facade detail: not faster.** On your PC
expect roughly the same fps as v0.12 on each preset (please check ⚙️ Settings). What kept it level:
- **Chunks** (48 m) with whole-chunk culling and detail by distance: the first, unchunked version
  of step 1 was ~60% slower on High (8.6 s a frame; every louvre slat processed for every window).
- **Static parts merged** into two meshes per chunk: draw calls 263 → 135 (then 144 with flower
  boxes instanced again).
- **Near detail within 55 m only**, narrower painted openings, cheaper surrounds, plants and flower
  boxes fading with distance, no openings or detail on walls with a neighbour or the hillside
  within 2 m.
- Not tried: a depth pre-pass (see Decisions); GPU occlusion culling (as asked).
Where to look next for speed: the slatted leaves (480k triangles when a chunk is near: a cheaper
slat shape, or slats only within ~25 m), and the ground (still about a third of the main pass).

### What still differs from the targets, what got worse, what next

Sheets: `Rio-reference/progress/v0.13_target-v2-1_vs_game.jpg`, `v0.13_single-building_vs_game.jpg`,
`v0.13_target-05_vs_game.jpg`, `v0.13_target-v2-5_vs_game.jpg` (cameras matched by eye; the town
differs from the one the paint-overs were made from, so building-by-building matches are approximate).
- **Still differs:** the paint-overs pack houses tighter, with deep shade in the lanes between them;
  the game's towers stand more apart. Their facades carry more balconies and greenery at every level,
  and many more terracotta roofs. The single-building target has a balcony on almost every floor
  and pairs of tall windows; ours has a balcony on most floors of harbour houses, fewer elsewhere.
  Shopfronts and awnings are still few (14 shops, 12 awnings in the demo town): only harbour-area
  lane walls get them. Close up, shutters and stone are crisp but plaster is still uniform from afar.
- **Got worse:** draw calls up (57 → 144); the town looks busier from the postcard view (many more
  windows); low-condition houses' plaster loss is now subtle, perhaps too subtle.
- **Next:** more shops and awnings along the main street (zone more commercial ground floors); a
  balcony and window rhythm closer to the single-building target (pairs of French windows with one
  wide balcony); terracotta share on roofs (low priority); a test for "no triangular gaps beside
  paths" (from the brief; not done because massing was out of scope); slats only within ~25 m.

### Decisions (v0.13)
- **Openings are real holes** in the merged wall mesh rather than a shader trick: they cast real
  shadow and cost about 20 triangles per window in a mesh that is built once.
- **Slatted leaves near, painted far**: detail by distance per chunk of the town; a chunk switches
  as a whole (no per-window popping), at 55 m on High (× 0.8 Medium, × 0.5 Low). At 75 m the front
  of the town counted as near even from the postcard view, drawing slats smaller than a pixel.
- **Chunks of 48 m**: 36 m chunks gave finer culling but 420 draw calls; 48 m gave ~260, 64 m no
  better (the calls came from the ~50 kinds of part, not the number of chunks).
- **Static facade parts merged** (frames, leaves, jambs, door leaves, balconies, signs, chimneys,
  surrounds) into two meshes per chunk, one always drawn and one near-only, using the walls'
  material (textured per vertex): 135 draw calls instead of 263. In the software renderer this
  barely changed the frame time (it is limited by pixels and vertices); on a real GPU each call
  costs CPU time, so it is kept. Parts with their own shaders or a fade with distance (glass,
  painted openings, awnings, plants, pots, washing, flower boxes) stay instanced.
- **A dark plate at the back of every opening** casts the shadow, so sun never shines through a
  house at either detail level.
- **Depth pre-pass not tried**: three.js already draws solid objects front to back (cheap early
  depth rejection), and a pre-pass would draw every vertex twice, which this run increased.
- **Arched entries are cut as rectangles** with spandrels filling the corners (a curved hole in the
  merged wall would need a different tiling).
- **Building shapes untouched**, as asked. The floor height is still 3 m everywhere (taller ground
  floors would be massing).

## Earlier run: v0.12 · Light (flicker, shimmer, no trees, light and colour)

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
- **The v0.11 roof recording** (`roof-shimmer-v0.11`, added during the run) also showed speckle on
  the terracotta ridge tiles (now contrast 0.75, mip bias +0.5 for both terracotta textures) and a
  jagged dark line beside the ridge: the ridge cap's underside floated just above the roof on each
  side, leaving a thin shadowed slit. Caps are now sunk 8 cm into the roof so their sides meet both
  slopes cleanly.
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

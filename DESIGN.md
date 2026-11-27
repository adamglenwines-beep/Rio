# Borgo — design document

The shared vision for the game. Every working session starts by reading this file.
When a decision here changes, update this file in the same commit.

---

## Concept

A **cozy 3D city builder** inspired by the Cinque Terre, and Riomaggiore in particular.

- **Terrain:** steep, irregular coastal ground: ravines, cliffs and a small harbour cove.
  You adapt to the hill; you don't flatten it.
- **No roads.** Only pedestrian lanes and stairs. Connectivity is measured in walking
  effort (distance plus climbing), not tiles.
- **Full 3D** with a freely rotatable camera.
- **Platform: PC first** — a desktop browser with mouse and keyboard. Phones and tablets
  are a later port: touch input keeps working but isn't being designed or optimised for
  now. Input handling stays separate from game logic so that port stays easy.
- **The sea and the harbour** are the town's lifeline.

### Era

**Medieval to the 1960s. Nothing later.** No cars, no motor roads, no modern tech.
Whether the game progresses through eras within that span is **still undecided**.

### Control model (leaning)

A **Manor Lords-style hybrid**:
- **Homes grow on their own** along lanes, in zoned areas, driven by access and demand.
- **Work buildings and terraces are placed deliberately** by the player.
- The player lays lanes and stairs, paints zones, and places production.
- **To be tested** by adding one placeable building: a **quarry**.

## Town form

- **Lanes come first.** Buildings line them with **flush facades that follow the lane**
  and fill blocks **edge to edge**, so each lane reads as a continuous corridor between
  walls.
- **Blocks and lots (v0.14, `src/blocks.js`, `data/blocks.json`).** A *block* is zoned land
  enclosed by lanes, the shore, the piazza and unbuildable ground. Each block's lane edges are
  cut into narrow *lots*: fronts exactly on the lane, sides square to it, as deep as the middle
  of the block (or the band's maximum). Corner lots snap to the crossing lane; the ends of a
  row and the backs of lots meet their neighbours exactly; leftover corners become wedge lots
  or *gap lots* fronting the nearest lane. Houses are then built lot by lot, near the harbour
  first, fronts before interiors. Neighbours share **party walls** with no gap and no openings.
- **Density by land value**, from walking effort to the harbour (bands in `data/blocks.json`):
  *harbour* blocks ≥ 85% built over, *town* ≥ 70%, *edge* about 40% (open land for orti).
  Narrow tower-house lots by the harbour (3–4.6 m), wider ones up the hill.
- **Every house is reached from a lane**: its front is on a lane, or (a *rear* house in a deep
  block) through an arched passage in the house in front of it.
- **No ordinary house may overlap a path.**
- **Archways and covered passages** over lanes are welcome (the v0.13 growth made them; the
  v0.14 block plan doesn't yet).
- Footprints are irregular (trapezoids, wedges) to fit bends and forks. The irregularity
  is hidden at the backs of buildings and in the middle of blocks.
- **Main lanes win:** a corner building fronts the busier lane. Sharp forks get pointed
  (flatiron) buildings.
- **Steep land is buildable; slope shapes what grows.** Flat ground suits piazzas and
  shops, moderate slopes suit tall narrow houses, steep slopes suit small houses and
  terraces, and cliffs hold nothing.
- The town gets **denser and taller toward the harbour**, measured in walking effort.
- **Leftover spaces are never bare.** They're filled automatically, based on their size,
  slope and position, with:
  - vegetable gardens (orti), lemon and fig trees;
  - patios with pergolas;
  - little piazzette with benches, fountains or shrines;
  - dry-stone walls and steps;
  - rocks with agave and prickly pear;
  - sheds, cisterns, washing lines and bougainvillea.

## Landscape (v0.9)

- **The hillside starts wild**: dark macchia scrub, dry grass, bare rock, a few umbrella
  pines. **Terraces appear only where the player builds or farms.** They are a system
  (`src/terraces.js`) that can be laid on any slope: the ground is re-cut into level treads
  held by dry-stone walls that follow the contours. The demo lays a few around the town.
- **Rock** is layered sandstone and shale dipping about 55° inland, as at Riomaggiore: on
  the cliffs either side of the harbour the strata run diagonally. Rock shows where the
  ground is too steep to build on; soil and scrub cover gentler ground, blended by slope.
- **Shore**: wave-cut rock shelves and skerries under the headlands, loose boulders, a
  boulder breakwater piled against the jetty, a pebble beach only at the harbour.
- **Beyond the playable square** a scenery-only ring carries the coast and hills to the
  horizon (headlands receding in haze, a ridge behind the town). The valley head is closed
  by the ridge, as in reality; the targets' glimpse of sea behind the town is not copied.
- **Postcard view** = from out on the water, looking up the cove (as in the art targets).
- Vegetation is a **light first pass** (lumpy instanced bushes); a fuller pass comes later.
  **v0.12: trees and bushes are switched off** (`CONFIG.flora.trees`) until that pass; the
  hillsides are bare for now. Terrace vines, agave, prickly pear, bougainvillea, pots and
  flower boxes stay.

## The look of the town (v0.10)

- **Tower houses**: narrow fronts (3.5–6 m), each with its own leaning to be a storey or
  two taller or shorter than its site suggests. A house beside two lanes gets a door on
  each (front door low, back door on the higher lane: the *uservàn*).
- **Colour** (v0.13, `data/palette.json`): warm, strong Ligurian pigments, towards art target 05:
  golden yellow, deep and sun-faded ochre, lemon, orange, burnt orange, peach, a few bold Genoa-red
  houses, coral, terracotta, salmon, rose, cream, limewash, sage; soft mottling and sun-faded
  patches within each wall, a slight tone per house. (v0.12 was lighter and too pastel; v0.10 cooler.)
  Houses that touch never share a colour and rarely a colour family. Shutters are a rich, fairly
  light green on almost every house.
- **Walls**: rough stone ground floors (the cellar) or a rough render dado, plaster above,
  walls leaning in a touch. Plaster wears in layers (colour coat, pale undercoat, grey
  render, rubble stone), mostly low down and at corners; about one house in eight is badly
  worn.
- **Painted trim**: string courses, window surrounds and cornice strips on some houses,
  painted corner stones on a few, and now and then a window painted on a blank bay
  (sometimes with a cat).
- **Windows**: uneven rhythm, small top-floor windows on a third of houses; shutters shut,
  shut with the lower panel pushed out, open, or half and half. Balconies (bars or solid),
  flower boxes, washing lines, drainpipes, bougainvillea up some corners, pots by doors.
- **Roofs**: low-pitched, mostly pale weathered slate with a terracotta or lime-mortar
  ridge, about one in six terracotta; chimneys with slab caps or pots; roof terraces with
  railings, pergolas, parasols and washing.
- **Two quarters**: the fishing quarter by the harbour (boats hauled up, nets, crates,
  floats) and the farming quarter higher up (barrels, vine stakes, baskets). Café tables
  with parasols on the piazza.
- **Detail by distance**: small things (pots, bars, washing, flower boxes) are not drawn
  beyond a distance set per item and scaled by the quality setting.

## Facades (v0.13)

- **Facade content is data** (`data/facades.json`): window kinds and sizes, shutter states,
  balcony variants, ground-floor variants by place, awnings, trim. Shapes in `src/facade.js`.
- **Openings are cut through the walls** and recessed 18 cm (doors 22 cm, arches 32 cm), with a
  frame, glass, stone sill and lintel inside, so they catch real shadow. Windows are big (about
  1.15 × 1.85 m; French windows to the floor behind balconies), paired now and then, with few
  blank bays. Stone bases, dados and string courses are cut by the openings too.
- **Louvred shutters** built from slats, hinged on the wall: shut, folded back flat (only where
  there is room), or half open, each a little irregular.
- **Balconies** on most upper floors of harbour-facing houses: slab on consoles, iron railings or
  a rendered parapet, pots and geraniums, now and then a chair or washing.
- **Ground floors** show their use: shopfronts with signs and striped awnings, workshop doors,
  arched entries, house doors with stone jambs and steps; harbour houses open onto the quay.
- **Trim**: a two-step cornice under every eaves; subtle floor bands on some houses.
- **No facade detail on walls with a neighbour or the hillside within 2 m.**
- **Each house has a plan** (`src/houseplan.js`, `data/houses.json`, pure game state): a
  condition 0–1 (paint fade, plaster loss below 0.35, tidiness) and a use per floor (family,
  shop, workshop). Later gameplay sets them (floor uses, household wealth); the renderer reads.
- **Drawn in 48 m chunks** of the town (each with its walls mesh and instanced parts), so
  off-screen chunks are skipped; **detail by distance per chunk**: recessed openings with
  frames, glass and louvred leaves near, flat painted openings far (55 m on High). Static
  facade parts are merged into two meshes per chunk (always / near only).

## Light (v0.12)

- **Warm sun from the west, cool sky fill.** The sun stands to the left of the postcard view
  (setting over the sea, as at Riomaggiore), so fronts and west sides are sunlit and east sides
  and lanes are in shade. Midday is an early-afternoon sun.
- **Target spread**: sunlit warm walls ~72% lightness, shaded ~46% (the art target's yellow
  wall #F3C17B / #9E794D); checked with `tools/measure_walls.cjs` on the six-house scene
  (`index.html?scene=six`), and the same on Low, Medium and High.
- **Tone mapping: Khronos PBR Neutral**, exposure ~1.2.
- **Ambient occlusion is baked**, on every quality level: wall feet (deeper in narrow lanes),
  under the eaves, a soft ring round every window and under its sill. No screen-space AO.
- **Depth**: the camera's near plane moves out with distance; every wall-mounted part stands
  at least 3 cm clear of its wall; houses never intersect; covered walls get no openings.

## Sea and sky (v0.11)

- **The sea knows its depth** (ground heights baked into a texture): turquoise shallows
  fading through teal to deep blue; clear near the shore so rocks and the sea bed show;
  a foam fringe and surf lines where it meets rock, shore and breakwater; light dancing
  on the shallow bed. Calm by default.
- **Boats**: fishing boats lie to orange buoys and bob; one boat is rowed round the harbour;
  a sailboat crosses the horizon now and then. **Fish** shoal in the harbour shallows and
  dart from the rowing boat.
- **Sky**: soft fair-weather clouds drifting, clear toward the horizon; haze over the far
  headlands. Midday is brighter than before. Windows light up warm at dusk (a random
  share of them), as before.
- **The zone overlay shows only while a zoning or path tool is in hand.** It used to tint
  the ground around the town green all the time.
- **No ambient sound yet.**

## Resources and industry

- **Stone** comes from a quarry. It's needed for the harbour, terraces and stone bases.
  It's easy to move downhill and hard to move uphill. **Quarrying can cut ledges that
  become buildable land.**
- **Timber** is used for boats and buildings. Forests regrow slowly.
- **Industries:**
  - fishing;
  - vineyards on steep, sunny slopes;
  - olives;
  - orchards (lemons, figs).
- **Processing:** wine cellar, olive press, fish salting.
- **Flow:** produce on the hills → process in town → trade at the harbour.

### Harbour

Built in **stages**, each unlocking bigger boats:
1. beach;
2. slipway;
3. breakwater;
4. quay.

### Out of scope

- Erosion and landslide mechanics.

## Playability over realism

**Rule: realistic from the postcard view, simplified wherever you play.**

**Simplify:**
- Wider lanes (about 1.5–2× real width), compressed distances, fewer and slightly
  chunkier buildings than reality, and smoothed small terrain bumps.
- Exaggerated windows and shutters, and slightly more saturated colours, so the town reads
  well at a distance.
- Paths in a lighter stone so the network always reads clearly.
- **Buildings fade or cut away when they block lanes or the cursor.** This is the most
  important simplification. Archways show their lane from above.
- Toggle overlays: slope, walking effort, sun exposure.
- Compressed time: fast construction, short seasons, harvests as events.
- Abstracted carrying: a few porters and mules for flavour; goods flow along paths.
- Simple production chains: one step per building.
- A few figures represent many people.
- A friendly mix of history is fine if it looks and feels right.
- A calm, stylised sea and good weather by default; storms only as occasional flavour.

**Keep realistic:** town shape (lanes first, packed facades, terraces, stone bases),
the colour palette, and the vegetation.

## Graphics

- **Graphics are a major priority.** The current look (low-poly, pastel, flat-shaded) is
  a **placeholder**, and the final **art style is still undecided.**
- **Target: desktop browser** (PC first). Every effect still has Low / Medium / High
  quality settings, which will matter again for a later tablet port.
- **Art target:** the four images in `docs/art-target/` (see its README). Match them from
  the postcard view; simplify where you play. They read too yellow: prefer target 03's
  cooler light and blue sea. Real-world photos live in the private repo
  `adamglenwines-beep/Rio-reference` (never copy them into this public repo).
- **Textures:** a CC0 library in `assets/textures/` (see its README for recommended sets).
- **Approach:** code generates the shapes (buildings, lanes, terrain); assets supply the
  surfaces and dressing. Default look: neutral daylight, clear blue sky, blue sea; warmth
  and time of day stay adjustable. The style switcher stays, but the game is built to look
  best in the style closest to the targets (currently **Hand-painted**, the default).
- **Material system (v0.8, `src/materials.js`):** every surface comes from two GPU texture
  arrays (colour; normal + roughness). Buildings, paths and boxes use face-aligned
  projection; terrain uses triplanar. A material's own colour stays its average colour, so
  one greyscale plaster covers every pastel. Weathering (damp, grime, worn patches, sill
  streaks) and anti-repetition are built in. Every texture used is logged in `ASSETS.md`.
- Reference mood: Riomaggiore, Manarola and Vernazza for form, and Burano and Lake Como
  for colour and mood. Expect saturated pastel facades, green shutters, grey slate roofs,
  dry-stone terraces, and blue-green water.
- **Rendering rules (v0.9):** one render path per frame; the shadow map is redrawn only
  when something that casts a shadow changes; **Auto quality is patient** (it judges
  2.5-second windows, needs several slow windows to step down, half a minute of smooth
  running to step up, and never changes while the camera moves); plants have a per-quality
  budget and shrink away with distance.
- Visual decisions so far: nearly flat slate roofs; tall narrow houses; waterfront houses
  on rough stone bases with arched boat stores; stone stairs and paving.
- **Openings have real depth**, never flat stickers: boat-store arches are recessed in a
  thick stone frame, mostly closed by weathered timber double doors, a few open onto a
  vaulted store with a boat or nets inside; lane archways are vaulted passages.

**Style test (v0.7):** three candidate styles can be switched live in ⚙️ Settings —
Clean low-poly, Soft stylised, Hand-painted — plus a Warmth control (cool / neutral /
warm). Default: neutral midday with a blue sky and sea. Comparison grids are in
`docs/progress/style-test/`. The final choice is still the user's to make.

**Strong yes:**
- Interior mapping for windows (fake rooms, some lit warm at dusk).
- Ambient occlusion and contact shadows (since v0.12 baked, not screen-space: see Light).
- Bloom.
- Antialiasing.

**Adapted:**
- Planar reflections for the harbour water.
- Terrain and per-building shading baked as buildings are built.
- Cheap distance sea haze, plus particle chimney smoke (not volumetric).
- One well-fitted shadow map (cascades optional).

**Skip, or later:**
- Real-time global illumination. Fake it with sky light, baked shading and a warm bounce
  colour.
- Full PBR.
- Parallax occlusion (maybe later, for cobbles).
- DLSS/FSR. Use lower-resolution rendering on weak devices instead.
- Subsurface scattering, and hair and fur shaders.

**Status:** the first graphics pass below is in (quality presets with Auto and resolution
scaling; time of day; antialiasing; bloom; soft shadows with baked AO on all presets (SSAO on High
until v0.12); harbour reflections on Medium/High; distance haze; interior-mapped windows
that light up at dusk). The houses' shapes and colours are unchanged.

**Suggested first graphics pass, in order:**
1. antialiasing;
2. bloom;
3. soft shadows and SSAO;
4. harbour reflections;
5. distance haze;
6. interior-mapped windows.

## Open questions

- Era, or era progression.
- Final art style.
- Economy depth: demand model, trade, seasons.
- How deliberate placement (quarry, work buildings, terraces) and organic growth share the
  same land.

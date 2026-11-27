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
- **No ordinary house may overlap a path.**
- **Archways and covered passages** over lanes are welcome.
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
- SSAO and contact shadows.
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
scaling; time of day; antialiasing; bloom; soft shadows with baked AO on all presets and
SSAO on High; harbour reflections on Medium/High; distance haze; interior-mapped windows
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

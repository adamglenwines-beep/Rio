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

Not modern day: **the 1960s at the latest**. No cars, no motor roads, no modern tech.
The exact era, or whether the game progresses through eras, is **still undecided**.

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
- Reference mood: Riomaggiore, Manarola and Vernazza for form, and Burano and Lake Como
  for colour and mood. Expect saturated pastel facades, green shutters, grey slate roofs,
  dry-stone terraces, and blue-green water.
- Visual decisions so far: nearly flat slate roofs; tall narrow houses; waterfront houses
  on rough stone bases with arched boat stores; stone stairs and paving.
- **Openings have real depth**, never flat stickers: boat-store arches are recessed in a
  thick stone frame, mostly closed by weathered timber double doors, a few open onto a
  vaulted store with a boat or nets inside; lane archways are vaulted passages.

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

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
- **Full 3D** with a freely rotatable camera, playable on desktop, tablet and phone.
- **The sea and the harbour** are the town's lifeline.

## Era

Not modern day: **the 1960s at the latest**. No cars, no motor roads, no modern tech.
The exact era, or whether the game progresses through eras, is **still undecided**.

## Control model (leaning)

A **Manor Lords-style hybrid**:
- **Homes grow on their own** along lanes, in zoned areas, driven by access and demand.
- **Work buildings and terraces are placed deliberately** by the player.
- The player lays lanes and stairs, paints zones, and places production.

## Town form

- **Lanes come first.** Buildings line them with **flush facades** and fill blocks
  **edge to edge**, so each lane reads as a continuous corridor between walls.
- Footprints are irregular (trapezoids, wedges) to fit bends and forks. The irregularity
  is hidden at the backs of buildings and in the middle of blocks.
- **Main lanes win:** a corner building fronts the busier lane. Sharp forks get pointed
  (flatiron) buildings.
- **Steep land is buildable.** Slope shapes what grows: flat ground suits piazzas and
  shops, moderate slopes suit tall narrow houses, steep slopes suit small houses and
  terraces, and cliffs hold nothing.
- The town gets **denser and taller toward the harbour**, measured in walking effort.
- Archways and covered passages let lanes run under buildings.
- **Leftover spaces are never bare.** They fill with small life: planters, orti,
  lemon trees, patios, piazzette, shrines, rocks with agave, washing lines, bougainvillea.

## Resources and industry

- **Stone** comes from a quarry. It's needed for the harbour, terraces and stone bases.
  It's easy to move downhill and hard to move uphill.
- **Timber** is used for boats and buildings. Forests regrow slowly.
- **Industries:**
  - **fishing;**
  - **vineyards** on steep, sunny slopes;
  - **olives;**
  - **orchards** (lemons, figs).
- **Processing:** wine cellar, olive press, fish salting.
- **Flow:** produce on the hills → process in town → trade at the harbour.

## Harbour

Built in **stages**, each unlocking bigger boats:
1. beach;
2. slipway;
3. breakwater;
4. quay.

## Explicitly out of scope

- Erosion and landslide mechanics.

## Graphics

- **Graphics are a major priority.** The current look is a **placeholder**: low-poly,
  pastel, flat-shaded.
- The final **art style is still undecided.**
- Reference mood: Riomaggiore, Manarola and Vernazza for form, and Burano and Lake Como
  for colour and mood. Expect saturated pastel facades, green shutters, grey slate roofs,
  dry-stone terraces, and blue-green water.
- Visual decisions so far: nearly flat slate roofs; tall narrow houses; waterfront houses
  on rough stone bases with arched boat stores; stone stairs and paving.

## Open questions

- Era, or era progression.
- Final art style.
- Economy depth: demand model, trade, seasons.
- How deliberate placement and organic growth share the same land.

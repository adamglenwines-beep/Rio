# Borgo — a cozy Ligurian village builder (prototype)

**▶ Play it live: https://adamglenwines-beep.github.io/Rio/** (made for a desktop browser with mouse and keyboard; touch still works)

![Postcard view](docs/postcard.jpg)

A browser prototype of a city-builder inspired by Riomaggiore and the Cinque Terre.
You never place buildings: you lay **stairs and lanes** and paint **zones**, and the
village grows by itself. Houses pack tightly, share walls, step up the hillside and get
taller toward the harbour.

Plain HTML + JavaScript modules. Three.js comes from a CDN, so there's nothing to install
and no build step.

---

See **`DESIGN.md`** for the game's overall vision.

## Running it

The easiest way is the live link above: nothing to install. The site is published from the
`main` branch with GitHub Pages, so it always shows the latest approved version. Work in
progress happens on a separate development branch.

### Running it locally

You need **Python 3** (already on macOS and Linux; on Windows install it from
python.org or the Microsoft Store). A local server is needed because browsers block
JavaScript modules opened straight from a file.

1. Open a terminal in this folder.
2. Run:
   - macOS / Linux: `python3 serve.py`
   - Windows: `py serve.py`
3. Open the **"On this computer"** address it prints (usually http://localhost:8000).

The first load needs internet access, to fetch Three.js from the CDN.

**No Python?** If you have Node.js, `npx serve .` works too.

### Optional: open the local version on another device (same Wi-Fi)

1. Start the server on your computer as above.
2. On the phone, open the **"On your phone"** address it prints, e.g. `http://192.168.1.23:8000`.
3. If it doesn't load:
   - check that both devices are on the same Wi-Fi network (not a guest network);
   - on Windows, allow Python through the firewall when asked (Private networks);
   - on macOS, click "Allow" if asked about incoming connections.

---

## How to play

| Tool | What it does |
|---|---|
| ✋ **Look** | Drag to orbit · pinch / scroll to zoom · two fingers or right-drag to pan |
| 🪜 **Path** | Tap the ground to drop waypoints, then **Finish path**. Start at the harbour quay (or on an existing path) so it's connected. Steep climbs zig-zag automatically. Dragging still orbits the camera. |
| 🏠 **Homes** / 🏪 **Shops** | Paint zones with one finger (or left mouse). Bright = connected to the harbour, faded = not reachable yet. Pinch still zooms; on desktop, right-drag rotates. |
| 🧽 **Unzone** | Rub zoning out. |
| ▶ ▶▶ ▶▶▶ | Growth speed (❚❚ pauses). |
| 📷 **Postcard** | Glide to the classic view from the water. |
| ⛰️ **Slopes** | Shows the slope bands: green flat, yellow moderate, orange steep, red cliff (nothing grows there). |
| ⚙️ **Settings** | Quality (Auto / Low / Medium / High), render resolution, and time of day (Midday, Golden hour, Dusk, Night). Remembered between visits. |
| ✨ **Demo** | Lays out a sample village (paths + zones). Press ▶▶▶ and watch it grow. |
| ↺ **Reset** | Clears everything. |

**Quick start:** press ✨ Demo, then ▶▶▶, then 📷 Postcard.

---

## How it works

| File | Role |
|---|---|
| `index.html` | Page, styles, toolbar, import map for Three.js |
| `src/config.js` | **All tunable numbers** (slope bands, sizes, effort weights, speeds, colours) |
| `src/terrain.js` | Procedural cove (heightfield), slope bands, smoothed "downhill" field |
| `src/water.js` | Animated low-poly sea and boats |
| `src/camera.js` | Orbit camera, ground-collision clamp, postcard view |
| `src/paths.js` | Stairs/lanes: switchback routing, the path graph, stone-step rendering |
| `src/zones.js` | Zone painting on a hidden 2 m grid, soft overlay |
| `src/access.js` | Walking effort (Dijkstra over paths, then onto the ground) |
| `src/lanes.js` | Lanes as the town's skeleton: frontage lines, lane ranking, the no-overlap rule |
| `src/geom.js` | Small 2D polygon helpers |
| `src/growth.js` | **The growth simulation** (placement, scoring, storeys) |
| `src/infill.js` | Decorates leftover spaces: gardens, piazzette, rocks, pots, washing lines… |
| `src/buildings.js` | Low-poly houses from footprint polygons: walls, roofs, stone bases, windows, shutters… |
| `src/scenery.js` | Dry-stone terraces, vines and trees |
| `src/demo.js` | The sample village layout |
| `src/gfx.js` | Lights, sky, time of day, quality presets, effects (antialiasing, bloom, AO, reflections, haze) |
| `src/ui.js` | Tools, touch/mouse handling, hints, settings panel |

### How the town grows

**Lanes come first.** Every house footprint is a four-cornered polygon, and houses are
laid out from the lanes inward, the way real hill towns are:
- **Lane-front houses** take a stretch of a lane's edge. The front wall is flush along the
  lane at a small setback, and the side walls run square to the lane and are shared exactly
  with the neighbours. On a bend the footprints become trapezoids and wedges that follow
  the curve, so each lane reads as a continuous corridor between walls.
- **Main lanes win.** Lanes are ranked by foot traffic to the harbour. A band along each
  lane is reserved for houses that front it, and a corner house always fronts the busier
  lane.
- **Blocks fill edge to edge.** Lots run back to the next row (or the middle of the block),
  narrow blocks get through-houses, and back lots continue the lot lines. Wedge and corner
  pieces close the gaps where rows of different alignment meet. Irregular back walls are
  hidden in the middle of blocks.
- **Paths are never built on.** An exact geometric test keeps every ordinary wall clear of
  every lane, the quay, the piazza and the slipway. The only exceptions are deliberate
  **archways**: a house spanning a side stair where it leaves a lane, or a covered passage
  built across a lane, always with full headroom.
- Only houses with no lane nearby fall back to facing downhill.

- **Sharp forks** get a narrow **pointed building** fronting both lanes. If even that won't
  fit, the fork tip is left for a little piazzetta or a shrine.
- **Leftover spaces are never bare** (`src/infill.js`). Gaps are measured by size, width,
  slope and position, and filled with small life:
  - planters and short dry-stone walls in slivers;
  - orti, lemon and fig trees, patios with pergolas, and sheds in patches;
  - piazzette with a fountain or shrine at forks;
  - rocks, agave and prickly pear on rocky ground;
  - pots, bougainvillea, cisterns and washing lines against walls.

Floors are counted from the **uphill** ground and walls go down to the lowest ground, so
downhill facades are taller. Along the harbour front, footprints are slimmer, houses reach
up to 8 storeys, and they stand on **rough stone bases**, many with an arched boat store
facing the water. Every candidate must sit on zoned, reachable, non-cliff land. The
best-scoring one gets built: low walking effort, fronting a lane, touching neighbours,
plus a little randomness. Houses gain storeys toward a target set by closeness to the
harbour, local density and the slope band.

The look is tuned mainly through `src/config.js`:
- `terrain.ravine`: shape of the ravine (floor width, flank slopes, where the cliffs start);
- `slope`: the slope bands (moderate < 33°, steep < 42°, cliff above);
- `harbour`: quay, piazza, slipway, the waterfront's slim tall houses and stone bases;
- `path`: lane width, setback, the band reserved along lanes, archways;
- `building`: sizes, storeys, roof pitch;
- `infill`: how far from houses to decorate, plot size, wall-side extras, per-frame time budget;
- `graphics`: Auto's frame-rate floor, bloom, ambient occlusion, reflection and haze strengths.

`docs/progress/` holds before/after screenshots for each tuning step.

The browser console has a few helpers:
- `game.demo()` lays out the demo village;
- `game.growth.grow(500)` runs 500 growth steps instantly;
- `game.rig.postcard()` flies to the postcard view.

## Tests and tools

The game has no build step; `package.json` exists only for tests and tools.

```
npm install              # three + three-mesh-bvh, for running the tests in Node
npm run test:unit        # fast logic tests (~2 s)
npm run test:browser     # opens the game in a headless browser (needs Playwright)
npm run textures         # re-pack the textures listed in assets/textures/web/sets.json
```

The browser test checks for errors, missing textures and frame-time regressions against
`tests/browser/baseline.json` (re-create it on a new machine with
`npm run test:browser -- --update-baseline`).

Also see `PROGRESS.md` (where work stands), `GLOSSARY.md` (game-dev terms) and
`ASSETS.md` (every texture used and its licence).


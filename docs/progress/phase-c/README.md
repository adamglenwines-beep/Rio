# Phase C — facades, town shape and clutter (v0.10 · Facades)

| File | What it shows |
|---|---|
| `side-by-side_target04.jpg` | The game's postcard view next to art target 04 |
| `before-after_postcard.jpg` | v0.9 and v0.10 from the postcard position |
| `before-after_roofs.jpg`, `before-after_upper.jpg` | The roofscape: slate with terracotta ridges, chimneys, roof terraces |
| `before-after_harbour.jpg` | Harbour front: stone bases, café tables, balconies, washing, worn plaster |
| `before-after_facade.jpg`, `before-after_street.jpg` | Facades close up: shutter states, surrounds, doors, drainpipes |

The comparisons that include real photos are in the private reference repo
(`Rio-reference/progress/phase-c_*.jpg`).

## What still differs from the target (after Phase C)

- **Size and spread of the town.** The target's town climbs both flanks to the top of the
  frame, with long flights of steps showing between the houses. The demo town is a compact
  wedge in the valley floor; more zoned land and more stair lanes would close the gap.
- **Light.** The target is brighter, warmer and more contrasty; ours is flatter. Phase D
  (sky and light) should lift this.
- **Windows** stand slightly proud of the wall; real ones sit in a reveal. Shutters are
  flat boards with a wood texture, not louvres.
- **Plants on the houses.** The target has bougainvillea, pots and awnings everywhere;
  ours has some of each but the climbers are rows of small lumps.
- **Piazza life.** No people, lamps or shop signs yet (later phases).
- **Sea and sky** are still the old flat blue (Phase D).

## What got worse

- A frame costs about 10–18% more than v0.9 in the software renderer (about 2,400
  windows now carry up to four extra parts each; small parts are skipped beyond their draw
  distance).
- Download grew by 0.6 MB (one more texture layer).
- Close up, plaster-wear edges can look a little like torn paper: the pale undercoat rim is
  the same width everywhere.

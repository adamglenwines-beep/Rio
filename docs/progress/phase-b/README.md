# Phase B — terrain and vegetation (v0.9 · Terrain)

| File | What it shows |
|---|---|
| `side-by-side_target03.jpg` | The game's postcard view next to art target 03 |
| `before-after_postcard.jpg` | v0.8 and v0.9 from the new postcard position |
| `before-after_aerial.jpg`, `before-after_far.jpg` | From above, and the whole coast from out at sea |
| `before-after_terr.jpg` | Terraces close up (old boxes on the contours → cut treads, dry-stone walls, vine rows) |
| `before-after_shore.jpg`, `v0.9_shore.jpg` | Shoreline: rock shelf, boulders, the breakwater by the jetty |
| `v0.9_cliff-strata.jpg` | The west headland: diagonal strata |

The three-way comparison that includes a real photo (game, target, photo) is kept in the
private reference repo (`Rio-reference/progress/phase-b_game-target-photo.jpg`), because
the photos must not be copied into this public repo.

## What still differs from the target (after Phase B)

- **Cliffs beside the harbour.** The target has tall, chunky, warm rock walls right at
  both sides of the quay. Ours are lower there and the best strata are further out on the
  headlands. The rock is also greyer and more evenly striped than the target's blocky rock.
- **Vegetation.** The target has many umbrella pines, agaves, and bougainvillea in the
  foreground; ours is a light pass of lumpy bushes with a few pines. From above the bushes
  still read as rounded pads. (Plants get a fuller pass in a later run.)
- **Terraces.** The target terraces both flanks all the way up. Ours has only a few demo
  terraces, on purpose: the hillside starts wild and terraces come with farming.
- **Vines** are simple leafy bands; the target shows individual staked vines.
- **Town, sky and water** are untouched so far (Phases C and D): blocky houses, flat blue
  sea, no foam, plain sky.

## What got worse

- The ground shader does more work (layered rock, more ground types) and there are a few
  thousand bushes: in the software renderer used for tests a frame costs about a third
  more than straight after Step 0 (still about a third less than v0.8, because shadows are
  no longer redrawn every frame). Not measured on a real graphics card.
- Download grew by about 3.4 MB (four more texture layers).

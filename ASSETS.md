# Assets

Every texture the game uses, where, and its licence. The full library (74 sets) is in
`assets/textures/` (see its README); only the sets below are packed for the browser
(`tools/pack_textures.py` → `assets/textures/web/`) and loaded by the game.

All are **CC0** (public domain, no attribution required).

| Layer key | Texture set | Used for | Source | Licence | Download @1024 / @512 |
|---|---|---|---|---|---|
| `plaster` | `plastered_wall` | house walls (tinted per house) | [Poly Haven](https://polyhaven.com/a/plastered_wall) | CC0 | 600 KB / 118 KB |
| `plasterWorn` | `red_plaster_weathered` | weathered patches blended into walls | [Poly Haven](https://polyhaven.com/a/red_plaster_weathered) | CC0 | 369 KB / 59 KB |
| `stoneBase` | `stone_wall_04` | harbour stone bases, plinths, passage vaults | [Poly Haven](https://polyhaven.com/a/stone_wall_04) | CC0 | 848 KB / 194 KB |
| `stoneDry` | `stone_wall` | dry-stone terrace walls | [Poly Haven](https://polyhaven.com/a/stone_wall) | CC0 | 701 KB / 203 KB |
| `stoneDressed` | `Bricks111B` | dressed stone: arch frames, quay edges | [ambientCG](https://ambientcg.com/view?id=Bricks111B) | CC0 | 480 KB / 123 KB |
| `cliff` | `cliff_side` | cliffs and steep rock (toned toward grey) | [Poly Haven](https://polyhaven.com/a/cliff_side) | CC0 | 569 KB / 164 KB |
| `rock` | `rock_face_03` | outcrops and broken rock | [Poly Haven](https://polyhaven.com/a/rock_face_03) | CC0 | 737 KB / 178 KB |
| `ground` | `Ground081` | dry stony hillside earth (tinted by terrain colour) | [ambientCG](https://ambientcg.com/view?id=Ground081) | CC0 | 861 KB / 224 KB |
| `cobble` | `cobblestone_floor_001` | lanes and stairs | [Poly Haven](https://polyhaven.com/a/cobblestone_floor_001) | CC0 | 676 KB / 167 KB |
| `setts` | `pavement_05` | piazza, quay, slipway | [Poly Haven](https://polyhaven.com/a/pavement_05) | CC0 | 544 KB / 130 KB |
| `slateA` | `RoofingTiles003` | slate roofs | [ambientCG](https://ambientcg.com/view?id=RoofingTiles003) | CC0 | 596 KB / 160 KB |
| `slateB` | `RoofingTiles013A` | slate roofs (variant) | [ambientCG](https://ambientcg.com/view?id=RoofingTiles013A) | CC0 | 110 KB / 39 KB |
| `terraA` | `RoofingTiles012B` | terracotta roofs | [ambientCG](https://ambientcg.com/view?id=RoofingTiles012B) | CC0 | 269 KB / 78 KB |
| `terraB` | `RoofingTiles014C` | terracotta roofs (variant) | [ambientCG](https://ambientcg.com/view?id=RoofingTiles014C) | CC0 | 450 KB / 129 KB |
| `woodPaint` | `PaintedWood009B` | shutters and doors (tinted) | [ambientCG](https://ambientcg.com/view?id=PaintedWood009B) | CC0 | 536 KB / 95 KB |
| `planks` | `Planks012` | weathered timber boat-store doors | [ambientCG](https://ambientcg.com/view?id=Planks012) | CC0 | 585 KB / 128 KB |
| `scrub` | `Ground063` | wild hillside floor: dry grass and scrub (v0.9) | [ambientCG](https://ambientcg.com/view?id=Ground063) | CC0 | 917 KB / 234 KB |
| `soil` | `Ground085` | terrace treads and garden soil (v0.9) | [ambientCG](https://ambientcg.com/view?id=Ground085) | CC0 | 968 KB / 230 KB |
| `pebbles` | `ganges_river_pebbles` | pebble beach and shallow sea bed (v0.9) | [Poly Haven](https://polyhaven.com/a/ganges_river_pebbles) | CC0 | 671 KB / 204 KB |
| `rockPale` | `rocks_ground_06` | boulders, rock shelves and skerries (v0.9) | [Poly Haven](https://polyhaven.com/a/rocks_ground_06) | CC0 | 895 KB / 209 KB |
| `rubble` | `Bricks078` | rough stone ground floors, and the stone under worn plaster (v0.10) | [ambientCG](https://ambientcg.com/view?id=Bricks078) | CC0 | 624 KB / 167 KB |

Medium and High load the 1024 px files; Low loads the 512 px files.

## How assets are checked

Every packed layer can be inspected on the test page `tools/asset-test.html` (open it
through the local server: `http://localhost:8000/tools/asset-test.html`). It tiles each
colour map 3×2 so seams and repetition show, next to the packed normal/roughness data.
The four layers added in v0.9 were checked there: no seams; repetition is hidden in the
game by the large-scale second sample.

## Not used (and why)

- `damaged_plaster` (in the private `Rio-reference` repo, `textures/damaged_plaster_2k/`).
  Its file names follow Poly Haven's pattern, and everything on Poly Haven is CC0, but the
  licence could **not be verified** in the v0.9–v0.11 run: the build sandbox could not reach
  polyhaven.com. It stays in the private repo until someone confirms
  https://polyhaven.com/a/damaged_plaster exists and says CC0. The worn-plaster look is
  built from sets already in the library instead.
- No 3D model packs (Kenney, Quaternius) yet: shapes are made by code. The sandbox cannot
  reach those sites either, so nothing new was downloaded in this run.

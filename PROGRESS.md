# Progress

So a new session can pick up with "Read PROGRESS.md and continue". Read `CLAUDE.md` and
`DESIGN.md` first. Decisions made without the user (they asked not to be asked) are
recorded here with the reason.

## Current round: Phase A — textures and materials (target label `v0.8 · Textures`)

### Done
- **Art target**: the user's four images in `docs/art-target/` (pulled from their commit
  039fc20) are the official target; `DESIGN.md` Graphics section points at them.
- **Texture pipeline**: `assets/textures/web/sets.json` lists the 16 sets the game uses;
  `tools/pack_textures.py` packs each into two WebP files (colour with AO baked in; normal
  X/Y + roughness) at 1024 and 512 px → `assets/textures/web/` + `manifest.json`.
  8.9 MB download at Medium/High, 2.2 MB at Low (the raw 2K sets would be ~70 MB).
- **Shared material system** `src/materials.js`: two GPU texture arrays (colour, data);
  `registerStyled(material, kind, { mode, layer, weather })` opts a material in.
  Face-aligned projection (buildings, paths, boxes) and triplanar (terrain).
  The material's own colour stays the average colour → palette and styles preserved.
- **Surfaces**: plaster (tinted per house) + worn-plaster patches; stone bases/plinths
  (stone_wall_04), dressed stone (Bricks111B, greyed), terrace walls (stone_wall);
  cliffs (cliff_side, greyed) / broken rock / dry ground on terrain by steepness;
  cobbles on lanes and stairs, setts on quay/piazza/slipway/jetty; slate and terracotta
  roofs (two variants each, by roof colour); painted wood shutters/doors; planks on
  boat-store doors.
- **Weathering**: rising damp at wall bases, faint vertical grime, worn patches, and
  grime-streak decals under ~60% of sills.
- **Anti-repetition**: per-house texture offset, a rotated large-scale second sample,
  low-frequency colour noise.
- **Quality**: Low = 512 px layers, no large-scale sample, anisotropy 1; Medium = 1024,
  aniso 4; High = 1024, aniso 8. Reflections render untextured (barely visible there).
- **BVH ray tests**: terrain picking and a camera-collision ray use three-mesh-bvh.
- `GLOSSARY.md`, `ASSETS.md`, `package.json` (tests only; the game has no build step).

### In progress
- Unit tests (`tests/unit/`) and the browser test (`tests/browser/run.cjs`).
- Visual tuning against the targets; performance per preset; side-by-side vs target.

### Next
- Finish Phase A, publish `v0.8 · Textures`.
- Then, by priority (see the end-of-round report): terrain & vegetation, facade detail,
  sky & water.

### Decisions (made without asking, with reasons)
- **Default style = Hand-painted.** With real textures at full strength it is the
  closest to the targets (rich surface detail, painterly variation, painted clouds);
  brushstroke strength was halved so the textures carry the detail. Visitors who saved
  another style keep it.
- **WebP, not KTX2/Basis.** WebP cuts the download ~8×; GPU-compressed KTX2 would also
  cut video memory but needs an encoder pipeline and a WASM transcoder. At 1024 px the
  arrays use ~170 MB of video memory, fine on desktop (PC-first). Revisit for a tablet port.
- **Height maps unused** for now (no parallax): normal maps give the relief; height
  would mainly help height-blending.
- **Texture arrays, not separate textures**: every material can reach every surface with
  two texture slots, and one merged building mesh can mix plaster/stone/roof per vertex.
- **Reflections untextured**, to keep the extra reflection render cheap.
- Real-world reference photos stay out of this public repo (user's rule); they're in the
  private repo `adamglenwines-beep/Rio-reference` (not attached to this session).

# v0.12 · Light: comparison images

Flicker, roof shimmer, trees out, light and colour on the buildings. Notes: `PROGRESS.md`.
Comparisons with the art-target paint-overs and real photos are in the private repo
(`Rio-reference/progress/v0.12_*`), since those images live there.

| File | What it shows |
|---|---|
| `flicker_*_strips.jpg` | Four frames of a sub-pixel camera drift, v0.11 (top) vs v0.12 (bottom), in the four bug-report views |
| `flicker_*_pops.png` | Where pixels popped: v0.11 left, v0.12 right. White = depth-fighting (two surfaces at one depth), grey = jumps while moving |
| `flicker_before.json`, `flicker_after.json` | The numbers: % of popping and depth-fighting pixels |
| `roof_shimmer_texture_before-after.jpg` | The same slate roof with the old texture settings (left) and the new (right) |
| `before-after_midday_*.jpg` | v0.11 vs v0.12 on High at midday: postcard, aerial, facade, lane, roofs |
| `before-after_golden_*.jpg` | The same at golden hour |
| `v0.12_quality_levels.jpg` | Low, Medium and High |
| `six-houses_tone-mapping.jpg` | The six-house test scene under ACES, Neutral (chosen) and AgX |
| `six-houses_before-after.jpg` | The six houses: new lights before the palette, the ochre calibration, the first (too pale) palette |
| `profile_before.json`, `profile_after.json` | Frame time split by render pass and scene part (`tools/profile.cjs`) |

# Art target

Four AI-generated images Adam made of what Borgo should look like. They are the official
**art target**: match them from the postcard view, and simplify where you play. The UI
drawn in them is only a mock-up; the real UI doesn't need to match.

| File | What it shows |
|---|---|
| target-01-warm-midday.png | Bright midday, warm grade, saturated facades, dense planting |
| target-02-golden-hour.png | Golden-hour light, glowing walls, turquoise shallows |
| target-03-cool-midday.png | Cooler, clearer daylight; the least yellow of the four |
| target-04-hand-painted.png | The richest version: weathering, clutter, people on the piazza |
| target-05-sunlit-harbour.png | High three-quarter view of the harbour and stair lane; best reference for facade depth and roof colour (added 27 Nov 2026) |

They are concept art, so the realistic goal is "reads like this from the postcard view",
not a pixel match. They are too yellow overall; prefer target 03's light and sea.

Real-world reference photos (other people's, so kept out of this public repo) are in the
private repo **adamglenwines-beep/Rio-reference**. Add it to a Claude Code session to use them.

## Notes on target 05 (sunlit harbour)

Added 27 Nov 2026. It was resized by an LLM, so small details may have been regenerated:
use it for mood, palette and construction, not as an exact layout.

What to take from it, in priority order (buildings first):

1. **Recessed openings with real shadow.** Every window and door sits back in the wall with a
   dark reveal; shutters stand proud of the wall and cast shadows. The current code builds these
   as shallow boxes on the facade with shadow casting turned off. This is the biggest gap.
2. **Varied facade layouts.** Window rows don't line up between neighbours; some houses have
   balconies, awnings, arched ground floors or loggias, others are plain. Avoid one evenly
   spaced window grid for every house.
3. **Wealth shows on the facade.** Fresh saturated plaster sits next to faded, patchy plaster.
   This matches the household wealth bands (poor / getting by / prosperous) in the game framework.
4. **Cool roofs balance warm walls.** Many roofs are grey slate (ardesia), mixed with terracotta.
   Cool slate, grey rock and teal water keep the image from going yellow. Use this to fix the
   too-yellow look of targets 01, 02 and 04.
5. **Palette.** Coral, salmon pink, ochre, orange and cream walls; dark green shutters throughout;
   white or light-grey stone trim around openings.
6. **Ground-level life.** Pots everywhere, striped awnings, cafe umbrellas, washing lines, boats
   pulled up on the slipway, lifebuoy on the wall. Fits ground-floor uses and leftover-space dressing.
7. **Lanes as staircases.** The main lane is a long stepped stair with houses facing onto it.
8. **Land and sea (second priority).** Rock as big tilted slabs with real geometry, not colour
   stripes; dry-stone terraces with vines; clear turquoise shallows over rocks.

Trees and vegetation in it are reference for a later pass only; not a current focus.

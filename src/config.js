// ---------------------------------------------------------------------------
// config.js — every tunable number lives here so you can tweak the feel of the
// town without digging through the code. Units are metres (1 world unit = 1 m).
// ---------------------------------------------------------------------------

export const CONFIG = {
  seed: 7,                 // change for a different cove

  // ---- Terrain ------------------------------------------------------------
  terrain: {
    size: 240,             // world is size x size metres, centred on (0, 0)
    cell: 2,               // grid spacing (also the zoning resolution)
    seaFloor: -14,
    // Shape of the ravine the town climbs. Slopes are rise/run (0.47 ≈ 25°, 0.70 ≈ 35°).
    ravine: {
      floorHalfWidth: 3,       // half-width of the ravine floor inland (narrow!)
      harbourHalfWidth: 9,     // the floor widens at the mouth for the harbour piazza
      harbourLength: 24,       // how far inland that wider mouth reaches
      flankSlopeBottom: 0.38,  // designed slope leaving the floor (lumps add ~4°, so ~25° in practice)
      flankSlopeTop: 0.52,     // designed slope at the top of the buildable flank (~31° in practice)
      flankRun: 44,            // horizontal metres over which it steepens
      cliffStart: 50,          // horizontal distance from the floor where cliffs begin
      lumpiness: 2.5,          // height (m) of the broad irregular lumps on the flanks
      bumpiness: 0.45,         // height (m) of the small low-poly bumps everywhere
      floorRise: 0.11,         // how steeply the ravine floor climbs inland…
      floorRiseCurve: 0.0007,  // …and how much that steepens further in
    },
  },

  // Slope bands, in degrees. A cell's band decides what can grow there.
  slope: {
    flatMax: 10,           // < 10°  flat      → piazzas, shops, harbour
    moderateMax: 33,       // < 33°  moderate  → classic tall narrow houses
    steepMax: 42,          // < 42°  steep     → only small houses
                           // >= 42° cliff     → nothing
  },

  // ---- Harbour ----------------------------------------------------------------
  harbour: {
    quayInset: 2.5,        // quay walkway centre, metres inland of the waterline
    quayHalfWidth: 1.4,    // clear strip each side of the quay centreline (walkway ≈ 2.8 m)
    quayReach: 16,         // quay runs this far either side of the harbour point
    piazzaRadius: 5,       // small open piazza where the main street meets the quay
    slipwayWidth: 3.6,     // boat ramp running down into the water…
    slipwayOffset: -5,     // …this many metres along the shore from the piazza
    frontRadius: 30,       // "harbour front": within this distance of the harbour point
    frontWidth: [3.4, 4.4],// slimmer footprints on the harbour front…
    frontDepth: [6.0, 8.0],
    maxFloors: 8,          // …and up to 8 storeys (above uphill ground) right at the water
    tallEffort: 45,        // walking effort over which that eases to the normal cap
    // Waterfront houses stand on rough stone bases, some with boat-store vaults.
    stoneBase: {
      coastDistance: 16,   // houses this close to the waterline (m)…
      maxGround: 5,        // …and standing this low get a stone base
      height: [2.8, 3.6],  // base height (about one storey)
      vaultChance: 0.6,    // share of them with a big arched opening facing the water
    },
  },

  // ---- Paths ----------------------------------------------------------------
  path: {
    maxGrade: 0.62,        // rise/run a stair may climb before it switchbacks (~32°)
    switchbackWidth: 9,    // lateral width of a zig-zag leg
    stepLength: 0.9,       // length of one stone step / paving slab
    width: 2.0,            // paved lane width (the stone steps and paving)
    snapRadius: 4.5,       // taps this close to an existing path join it
    nodeSpacing: 1.5,      // spacing of graph nodes along a path
    setback: 0.25,         // house fronts stand this far back from the paving edge
                           // (so walls are width/2 + setback = 1.25 m from the centreline)
    frontageReserve: 4.5,  // a band this deep along each lane is kept for houses that FRONT
                           // that lane; back/side lots from other rows stop at its edge
    // Archways / covered passages: a house may straddle a lane on two piers.
    archChance: 0.6,       // how often the town tries to build archways over side stairs and lanes
    archHeadroom: 2.4,     // clear height above the highest step under the arch
    archMinPier: 0.8,      // each pier must be at least this wide
    // Sharp forks: where two lanes meet at less than this angle, the tip of the fork is
    // kept for a pointed (flatiron) building fronting both lanes, or else for infill.
    forkMaxAngle: 70,      // degrees
    forkReserve: 7,        // metres along each lane from the tip that are kept for it
  },

  // ---- Walking effort -------------------------------------------------------
  effort: {
    climbWeight: 4,        // 1 m of climbing costs as much as 4 m of walking
    offPathMultiplier: 2,  // walking across open hillside is twice as tiring
    accessRadius: 24,      // zoned land further than this from a path won't grow
    edgeEffort: 170,       // effort at which the town is at its smallest
  },

  // ---- Buildings ------------------------------------------------------------
  building: {
    floorHeight: 3.0,
    maxFloors: { flat: 5, moderate: 6, steep: 3 },
    commercialMaxFloors: 4,
    // footprint sizes [min, max] by slope band (width = along the contour)
    width:  { flat: [4.5, 6.5], moderate: [3.8, 5.2], steep: [3.4, 4.2] },
    depth:  { flat: [6.0, 8.5], moderate: [6.5, 8.5], steep: [4.8, 6.0] },
    roofPitch: 0.07,       // roof rise per metre of span (0.07 ≈ 8°: nearly flat, like Ligurian slate)
    roofOverhang: 0.2,     // eaves overhang (m); kept below path.setback so eaves never reach the steps
    minGround: 0.5,        // lowest ground (m above sea) a house may stand on
  },

  // ---- Infill: life in the leftover spaces -----------------------------------
  infill: {
    townRadius: 6,         // free ground within this distance of a house gets decorated
    plotSize: 5,           // big leftover patches are cut into plots about this wide
    refreshSeconds: 1.0,   // while the town grows, re-plan infill at most this often
    frameBudgetMs: 3,      // …spending at most about this long per frame on it
    coverRadius: 0.8,      // an item counts as covering the ground this far around it
    // per wall-side cell: chances of bougainvillea, a washing line, a cistern, a flower pot
    bougainvillea: 0.06, washing: 0.05, cistern: 0.03, pots: 0.22,
  },

  // ---- Graphics ---------------------------------------------------------------
  // (presets and time-of-day keyframes live in gfx.js)
  graphics: {
    autoMinFps: 40,          // Auto steps down if the frame rate stays below this
    autoMinResolution: 0.6,  // …and on Low, lowers the resolution no further than this
    bloomStrength: 0.22,     // keep it subtle
    bloomRadius: 0.5,
    ssaoRadius: 1.6,         // metres (High only)
    ssaoIntensity: 0.7,
    reflectionStrength: 0.65, // how strongly the harbour mirrors the town (Medium/High)
    reflectionPlane: 0.05,   // height of the mirror (the mean sea surface)
    bloomThreshold: 2.2,     // brightness (before tone mapping) above which things glow: the sun, glints, lit windows
  },

  // ---- Simulation -----------------------------------------------------------
  sim: {
    stepsPerSecond: 3,     // growth steps per second at 1x speed
    candidatesPerStep: 70, // how many spots are evaluated before building one
    floorGrowthsPerStep: 4,
  },
};

// Pastel facade palette (weights favour the warm Riomaggiore colours).
export const FACADE_COLOURS = [
  ['#e9b44c', 4], ['#f2cd5d', 3], ['#e57a3c', 3], ['#d6533f', 3],
  ['#f0a39a', 3], ['#e98d6c', 2], ['#f4e2bc', 2], ['#f6c98b', 3],
  ['#e8c4a4', 2], ['#cfdcc4', 1], ['#c3d6de', 1], ['#e7d36f', 2],
];
export const SHUTTER_COLOURS = ['#2f6b46', '#3c7a50', '#285c3d', '#43835a'];
// Roofs: mostly grey slate (ardesia), with the occasional terracotta.
export const ROOF_COLOURS = [
  ['#6e6b69', 5], ['#7c7874', 5], ['#5f5d5c', 3], ['#8a8580', 3], ['#696460', 3],
  ['#b4553b', 2], ['#c2683f', 1],
];

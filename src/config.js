// ---------------------------------------------------------------------------
// config.js — every tunable number lives here so you can tweak the feel of the
// town without digging through the code. Units are metres (1 world unit = 1 m).
// ---------------------------------------------------------------------------

export const CONFIG = {
  seed: 7,                 // change for a different cove

  // ---- Terrain ------------------------------------------------------------
  terrain: {
    size: 240,             // world is size x size metres, centred on (0, 0)
    cell: 2,               // grid spacing of the zoning / slope-band cells
    fineCell: 1,           // spacing of the ground mesh you see and stand on (a divisor of `cell`)
    seaFloor: -14,
    // Rock: the bedding planes (strata) and the ledges they cut into steep ground.
    rock: {
      dipDegrees: 55,        // how steeply the beds dip inland (Riomaggiore: 45–60°)
      strikeSkew: 0.18,      // how far the strike turns away from the coast line (0 = parallel)
      reliefFrom: 43,        // ground steeper than this (degrees) starts to break into ledges…
      reliefFull: 52,        // …fully by this slope (kept above slope.steepMax: buildable land stays smooth)
      ledgeSpacing: 6.5,     // distance between big ledges, measured across the beds (m)
      ledgeHeight: 1.7,      // how far a ledge stands proud (m)
      cragHeight: 0.9,       // extra roughness on rock faces (m)
    },
    // Rocky shoreline at the foot of the headlands.
    shore: {
      shelfWidth: [3, 13],   // width of the wave-cut rock shelf (m), varies along the coast
      shelfHeight: [0.35, 1.5], // its height above the sea (m)
      finHeight: 0.45,       // low parallel fins of upturned rock on the shelf (m)
      skerryThreshold: 0.36, // higher = fewer rocks standing offshore
      skerryRise: 26, skerryMax: 4.2,
    },
    // The scenery ring beyond the playable square (distant hills, headlands, ridge).
    outer: {
      reach: 1000,           // how far it extends from the centre (m)
      cell: 12.5,            // its grid spacing (m)
      blend: 90,             // metres over which the near shape turns into the far hills
      cliff: 42,             // height of the far coast's sea cliffs (m)
      ridge: 300,            // how high the hills climb inland (m)…
      ridgeRun: 420,         // …and over what distance
      relief: 40,            // broad humps and hollows (m)
      valleyDepth: 120, valleyWidth: 95,   // the ravine carries on inland as a valley
    },
    // Wild scrub cover (0 bare … 1 dense), used for the ground colour and for placing bushes.
    cover: {
      patchScale: 0.035,     // 1 / patch size (≈ 30 m patches)
      base: 0.12,            // thin cover between patches
      patchLow: 0.38, patchHigh: 0.66,
      steepBoost: 0.8,       // slopes too steep to build on are blanketed in scrub
      rockFrom: 45, rockFull: 55,   // …until they turn to bare rock (degrees)
    },
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
      bumpiness: 0.22,         // height (m) of the small bumps everywhere (kept low: smooth, rounded hills)
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
      openChance: 0.35,    // share of those boat stores left open (the rest have timber doors)
      portalDepth: 0.4,    // how far the stone arch frame stands out from the base (m)
      frameWidth: 0.38,    // width of the stone frame around the opening (m)
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
    archRise: 0.75,        // rise of the stone vault lining a passage under a house (m)
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
    streakChance: 0.6,     // share of windows with grime streaks running down from the sill
    streakStrength: 0.3,   // how much those streaks darken the wall (0–1)
  },

  // ---- Terraces: level treads held by dry-stone walls (terraces.js) ----------------
  terraces: {
    step: 2.2,             // height between treads = wall height (m); real walls are 1.5–2.5 m
    treadSlope: 0.12,      // share of the natural slope a tread keeps (0 = dead level)
    edgeFade: 7,           // an area fades back into wild hillside over this many metres
    maxSlope: 41,          // no terraces on ground steeper than this (degrees)…
    minSlope: 9,           // …and barely any below this
    townMargin: 5,         // keep this far from lanes, houses and zoned land (m)
    wallMinMask: 0.55,      // walls start where the ground is at least this terraced (0–1)
    wallSegment: 1.3,      // length of one wall segment (m)
    minWall: 0.5,          // lower than this and the wall is left out
    faceOffset: 0.85,      // the wall face stands this far downhill of the contour (hides the step in the ground mesh)
    batter: 0.13,          // lean of the face: metres back per metre of height
    thickness: 0.6,        // width of the stone top
    wallProud: 0.12,       // the top stands this far above the tread
    topJitter: 0.16,       // raggedness of the top (m)
    soilStrip: 1.9,        // soil behind the wall top, covering the step (m)
    stoneColour: '#b3a690', soilColour: '#9a7b5a',
    // vines: leafy bands (the low Cinque Terre pergola) on chestnut stakes
    vineRows: [1.5, 3.3],  // distance of each row uphill of the wall (m); a row is skipped where the tread is too narrow
    vineHeight: 1.25, vineWidth: 0.62, stakeEvery: 2,
    vineColours: ['#5f7a2c', '#6a8431', '#557026', '#748a38'],
  },

  // ---- Wild vegetation and boulders (scenery.js) ----------------------------------
  flora: {
    spacing: 2.0,          // one candidate bush per this many metres each way
    density: 1.15,         // chance of a bush = scrub cover × this
    bushSize: [0.7, 2.1],  // bush radius (m)
    broomShare: 0.018,     // share of bushes in yellow flower
    farReach: 400,         // soft clumps on the distant hills out to this distance (m)…
    farSpacing: 9, farSize: [3.5, 7.5],
    pineClumps: 9, farPineClumps: 10, pineMinHeight: 22,
    rockPlantTries: 2600, rockPlantMaxHeight: 45,   // agave and flowering tufts on sunny rock
    bougainvilleaOnWalls: 0.07,   // chance per sample point along a terrace wall
    // how many bushes each quality preset draws (most important first)…
    budget: { low: 3000, medium: 6000, high: 20000 },
    // …and when a plant shrinks away: its size ÷ distance below this (smaller = drawn further)
    lod: { low: 0.012, medium: 0.007, high: 0.004 },
    boulders: { step: 1.1, perStep: 3, clusterCut: -0.12 },
    colours: {
      scrub: ['#3a4a2d', '#435436', '#4d5f3a', '#313f28', '#566644', '#3f4c33', '#5c6a48'],
      broom: ['#b9a63f', '#a99a3a'],
      pine: ['#3d5426', '#46602a', '#37491f'],
      olive: ['#8a9478', '#7f8c70', '#95a084'],
      bougainvillea: ['#c2408f', '#b02a7c', '#d55aa6', '#9b1f6b'],
      leaf: ['#4c6a2e', '#5a7a36'],
      flowers: ['#d24a6a', '#e3c33e', '#cf5f84', '#e8e2c8'],
      agave: ['#7f9a84', '#6f8f7a', '#8a9d7c'],
      far: ['#3e4d31', '#48583a', '#35432b', '#526141'],
      boulder: [['#b0aaa2', 5], ['#d6d2cb', 1.5], ['#b89b7a', 2.5], ['#6e665c', 1]],
    },
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
    // Auto quality (see autoquality.js): patient on purpose, so it can never make the picture flicker
    auto: {
      windowSeconds: 2.5,    // frame times are judged over windows this long
      slowMs: 28,            // a window slower than this (mean ms per frame, ≈ 36 fps) counts as slow
      goodMs: 18,            // faster than this (≈ 55 fps) counts as smooth; in between, nothing changes
      slowWindows: 3,        // slow windows in a row before stepping down a level
      goodSeconds: 30,       // smooth seconds in a row before stepping back up
      dwellSeconds: 10,      // after any change, wait this long before judging again
    },
    autoMinResolution: 0.6,  // on Low, Auto lowers the resolution no further than this
    bloomStrength: 0.22,     // keep it subtle
    bloomRadius: 0.5,
    ssaoRadius: 1.6,         // metres (High only)
    ssaoIntensity: 0.7,
    reflectionStrength: 0.5,  // how strongly the harbour mirrors the town (Medium/High)
    reflectionPlane: 0.05,   // height of the mirror (the mean sea surface)
    hazeNear: 140,            // distance haze starts here (m)…
    hazeFar: 800,            // …and reaches its full strength here
    hazeDensity: 1.25,        // how thick it gets at hazeFar
    hazeFalloff: 45,         // it thins with height over this many metres…
    hazeHighFactor: 0.35,    // …to this fraction on the hilltops
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

// Ground and rock colours (average colours: the textures add detail around them).
// Rock beds follow the reference cliffs, a little warmer on the lit ribs (as in the art targets).
export const TERRAIN_COLOURS = {
  earth: '#b59c7a',      // dry stony earth
  straw: '#a69a68',      // sun-dried grass
  scrub: '#56633a',      // ground under dense macchia (dark olive)
  soil: '#9a7b5a',       // terrace and garden soil
  scree: '#8e8370',      // broken rock between soil and cliff
  pebble: '#8f908c',     // pebble beach
  sand: '#c6b68f',       // coarse sand
  seabed: '#5d7d74',     // what the sea bed fades to with depth
  bedPale: '#b3a48b',    // thick sandstone ribs (stand proud)
  bedMid: '#9a8b74',     // ordinary beds
  bedDark: '#6d6353',    // thin shale packets (recessed)
  bedOchre: '#a8855c',   // rusty weathered beds
  wet: '#4a4a44',        // multiplies rock in the splash zone (near-black wet band)
  algae: '#4c4f38',      // just under the waterline
  boulder: '#a9a39a',    // loose boulders (pale grey)
  shelf: '#a89f8d',      // wave-cut rock shelves at the cliff foot
};

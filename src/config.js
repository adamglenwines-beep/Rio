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
  },

  // Slope bands, in degrees. A cell's band decides what can grow there.
  slope: {
    flatMax: 10,           // < 10°  flat      → piazzas, shops, harbour
    moderateMax: 28,       // < 28°  moderate  → classic tall narrow houses
    steepMax: 40,          // < 40°  steep     → only small houses
                           // >= 40° cliff     → nothing
  },

  // ---- Paths ----------------------------------------------------------------
  path: {
    maxGrade: 0.62,        // rise/run a stair may climb before it switchbacks (~32°)
    switchbackWidth: 9,    // lateral width of a zig-zag leg
    stepLength: 0.9,       // length of one stone step / paving slab
    width: 1.8,            // lane width
    snapRadius: 4.5,       // taps this close to an existing path join it
    nodeSpacing: 1.5,      // spacing of graph nodes along a path
    clearance: 1.25,       // buildings keep this far from a path centreline
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
    alleyChance: 0.22,     // chance a new uphill row leaves a narrow alley
    alleyWidth: 1.4,
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
export const ROOF_COLOURS = [
  ['#b4553b', 5], ['#c2683f', 4], ['#a2483a', 3], ['#8a8079', 2], ['#7a726d', 1],
];

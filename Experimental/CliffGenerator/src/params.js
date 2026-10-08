// Parameter defaults, presets and the control schema the inspector is built from.
// Groups map 1:1 onto outliner rows; `stage` says what has to be recomputed when a value changes:
//   'terrain' → full heightfield pipeline (worker), 'rocks' → rock placement only, 'live' → uniforms.

export const defaults = {
  // Landform
  seed: 428,
  resolution: 512,
  worldSize: 2048,          // [m]
  mountainHeight: 520,      // [m]
  baseElevation: 40,        // [m]
  baseFrequency: 1.7,
  ridgeSharpness: 2.0,
  peakPower: 1.35,
  warpStrength: 0.6,
  reliefFrequency: 1.4,
  reliefContrast: 0.6,
  plateauStrength: 0,
  plateauHeight: 380,       // [m]
  canyonDepth: 0,           // [m]
  canyonWidth: 260,         // [m]
  duneAmount: 0,            // [m]
  duneWavelength: 140,      // [m]
  duneDirection: 30,        // [°]
  duneAsymmetry: 0.68,
  duneCoverage: 0.6,
  // Boulder outcrops (tors / core-stone clusters unioned into the landform)
  outcropDensity: 0,
  outcropSize: 16,          // [m]
  outcropSpacing: 220,      // [m]
  outcropCount: 5,
  outcropSpread: 1.6,
  outcropAspect: 0.7,
  outcropBury: 0.4,
  outcropRidge: 0.5,
  outcropSlopeMax: 30,      // [°]
  outcropWeather: 0.5,
  // Strata
  strataBand: 26,           // [m]
  strataStrength: 0.75,
  strataVariation: 0.6,
  strataPackaging: 0.6,
  strataHardShare: 0.4,
  strataLateral: 0.18,
  strataDip: 4,             // [°]
  strataDipDirection: 35,   // [°]
  hardnessContrast: 0.8,
  strataBreak: 0,           // [bands]
  strataFaultScale: 120,    // [m]
  strataFaultWidth: 6,      // [m]
  strataSub: 0,
  strataSubCount: 3,
  strataLateralMode: 0,     // [bands]
  // Rugged outcrops (Gaea Rugged / Outcrops / Rocky)
  ruggedAmount: 0,
  ruggedScale: 45,          // [m]
  ruggedRelief: 8,          // [m]
  ruggedBreakage: 0.5,
  ruggedCrevice: 0.6,
  ruggedDensity: 0,
  ruggedOctaves: 2,
  ruggedSweep: 1,
  ruggedCoverage: 0.6,
  ruggedSlopeMin: 12,       // [°]
  ruggedSlopeMax: 75,       // [°]
  ruggedHardBias: 0.5,
  ruggedWarp: 0.4,
  ruggedReverse: 0,
  ruggedSeed: 11,
  // Erosion
  droplets: 180000,
  inertia: 0.08,
  sedimentCapacity: 5,
  erodeSpeed: 0.35,
  depositSpeed: 0.25,
  evaporation: 0.015,
  gravity: 4,
  dropletLifetime: 40,
  erosionRadius: 3,
  initialSpeed: 1,
  hardnessInfluence: 0.85,
  thermalIterations: 24,
  thermalRate: 0.5,
  talusSoft: 33,            // [°]
  talusHard: 78,            // [°]
  // Rocks (plain scatter)
  rocksEnabled: 1,
  rockSeed: 7,
  rockDensity: 0.35,
  rockSlopeMin: 0,          // [°]
  rockSlopeMax: 55,         // [°]
  rockClustering: 0.5,
  rockClusterScale: 80,     // [m]
  rockTilt: 0.7,
  rockSizeMin: 0.8,         // [m]
  rockSizeMax: 9,           // [m]
  rockAngularity: 0.7,
  rockEmbed: 0.45,
  pebblesOn: 1,
  pebbleDensity: 0.45,
  pebbleSize: 0.45,         // [m]
  // True-3D cliffs (SDF chunks)
  sdfOn: 1,
  sdfAngle: 58,             // [°]
  sdfBlend: 2,              // [cells]
  sdfChunk: 16,             // [cells]
  sdfVoxel: 0,              // voxels per cell (0 = auto from budget)
  sdfVoxelBudget: 24,       // [M voxels]
  sdfUndercut: 6,           // [m]
  sdfBedContrast: 1,
  sdfPockets: 12,           // [m]
  sdfPits: 0.3,
  sdfJoints: 0.5,
  sdfRough: 0.5,
  sdfRugged: 0.8,
  sdfMaxChunks: 600,
  // Cliff depth (mesh displacement)
  overhang: 3.5,            // [m]
  buttress: 0.5,
  ledgeNoise: 0.6,
  meshSubdivision: 2,
  detailRelief: 0.5,        // [m]
  detailScale: 7,           // [m]
  rockyAmount: 0.6,         // [m]
  rockyScale: 3.5,          // [m]
  rockyAngular: 0.7,
  detailCliffBias: 0.8,
  // Rock material
  palette: 'granite',
  rockA: '#b3b1ae', rockB: '#94918f', rockC: '#c7c2ba', fresh: '#d6d3cd', oxide: '#ac947b',
  strataOn: 1,
  strataContrast: 0.7,
  strataBandScale: 1,
  seamStrength: 0.35,
  seamWidth: 0.08,
  laminae: 0.6,
  bedGradient: 0.6,
  hardnessTint: 0.8,
  grainOn: 1,
  grainSize: 0.9,           // [m]
  grainStrength: 0.6,
  grainContrast: 0.5,
  grainFineness: 0.5,
  oxideOn: 1,
  oxideAmount: 0.5,
  oxideScale: 5,            // [m]
  cavityStrength: 0.8,
  bumpScale: 1,
  baseRoughness: 0.9,
  // Mineral flakes — three layers, each with its own colour / size / height / crystals
  flakesOn: 1,
  flakeStrength: 0.7,
  flakeSheen: 0.35,
  flakeEdge: 0.3,
  flakeOxide: 0.5,
  flakeSparkle: 0.6,
  flakeOn1: 1, flakeColor1: '#9d9893', flakeSize1: 1.6, flakeDensity1: 0.7, flakeHeight1: 6, flakeCrystal1: 0.0, flakeVar1: 0.5, flakeShape1: 0.2, flakeReveal1: 0.0,
  flakeOn2: 1, flakeColor2: '#bdb4a7', flakeSize2: 0.55, flakeDensity2: 0.75, flakeHeight2: 4, flakeCrystal2: 0.08, flakeVar2: 0.5, flakeShape2: 0.1, flakeReveal2: 0.3,
  flakeOn3: 1, flakeColor3: '#d9d6cf', flakeSize3: 0.18, flakeDensity3: 0.6, flakeHeight3: 2, flakeCrystal3: 0.3, flakeVar3: 0.6, flakeShape3: 0.0, flakeReveal3: 0.0,
  // Spalling (peel)
  peelOn: 1,
  peelStrength: 0.6,
  peelScale: 1.6,           // [m]
  peelCoverage: 0.3,
  peelThickness: 0.025,     // [m]
  peelSecond: 0.6,
  peelPits: 0.5,
  peelBedding: 0.4,
  peelFresh: 0.7,
  peelShadow: 0.6,
  // Ground cover
  runoffOn: 1,
  wetness: 0.6,
  streakScale: 6,           // [m]
  streakAmount: 1,
  gravelOn: 1,
  gravelAmount: 0.8,
  gravelScale: 0.14,        // [m]
  gravelRelief: 0.7,
  gravelVariation: 0.6,
  gravelColor: '#9a938a',
  vegOn: 1,
  vegetation: 0.6,
  vegScale: 20,             // [m]
  vegSlope: 44,             // [°]
  vegPatchiness: 0.5,
  dryness: 0.5,
  grassA: '#6f8051', grassB: '#a8a26f', dryColor: '#ac9c7b',
  mossOn: 1,
  mossiness: 0.5,
  mossScale: 4,             // [m]
  mossColor: '#687b4c',
  snowOn: 1,
  snowLine: 430,            // [m]
  snowSlope: 48,            // [°]
  snowSoftness: 1,
  snowRoughness: 0.75,
  snowColor: '#eef1f7',
  // Drawn features (roads · rivers · lakes)
  features: { roads: [], rivers: [], lakes: [] },
  showFeatureLines: 1,
  roadWidth: 6,             // [m]
  roadShoulder: 2,          // [m]
  roadSmoothing: 60,        // [m]
  roadCut: 60,              // [°]
  roadFill: 34,             // [°]
  roadColor: '#5f5b55',
  roadShading: 1,
  riverWidth: 14,           // [m]
  riverDepth: 4,            // [m]
  riverBank: 24,            // [°]
  riverMaxBank: 10,         // [m]
  riverMeander: 0.4,
  riverErosion: 0.6,
  riverWater: 1,
  riverWaterDepth: 1.2,     // [m]
  // Simulated drainage
  riverSim: 1,
  riverCatchment: 0.04,     // [km²]
  riverWidthScale: 40,      // [m per √km²]
  riverMaxWidth: 150,       // [m]
  riverDepthScale: 0.7,
  riverWaterFrac: 0.7,
  riverDrySlope: 12,        // [°]
  riverDryBig: 1.5,         // [km²]
  riverBraiding: 0.35,
  riverLakes: 1,
  riverLakeFill: 0.8,
  riverLakeMax: 8,          // [% of map]
  riverLakeMin: 0.01,       // [km²]
  lakeConnect: 1,           // lake inlets & outlets join the river network
  lakeConnectLen: 200,      // [m] max connector length
  riverGuideFlow: 1.0,      // [km²]
  lakeDepth: 6,             // [m]
  lakeLevelOffset: 6,       // [m]
  lakeWater: 1,
  // Water
  waterColor: '#15303c',
  waterOpacity: 0.9,
  shoreWet: 0.7,
  bedShading: 1,
  siltColor: '#b9ad94',
  // Sun & sky
  sunAzimuth: 215,          // [°]
  sunElevation: 24,         // [°]
  turbidity: 4,
  exposure: 0.55,
  fogDensity: 0.35,
  seaLevel: 0,              // [m]
  waterEnabled: 1,
  // Viewport
  wireframe: 0,
  showRocks: 1,
  autoRotate: 0,
  debugView: 0,
};

export const presets = {
  'Alpine granite': {
    palette: 'granite', mountainHeight: 560, baseFrequency: 1.7, ridgeSharpness: 2.2, peakPower: 1.4, warpStrength: 0.6,
    strataBand: 26, strataStrength: 0.6, strataDip: 6, hardnessContrast: 0.7, plateauStrength: 0, canyonDepth: 0,
    snowLine: 430, vegetation: 0.6, seaLevel: 0, waterEnabled: 1, talusSoft: 34, talusHard: 80, droplets: 180000, peelStrength: 0.45, peelCoverage: 0.3, flakeStrength: 0.65,
  },
  'Sandstone mesa': {
    palette: 'sandstone', mountainHeight: 320, baseElevation: 60, baseFrequency: 1.3, ridgeSharpness: 1.4, peakPower: 1.0, warpStrength: 0.45,
    strataBand: 18, strataStrength: 1.0, strataDip: 2, hardnessContrast: 1.0, plateauStrength: 0.85, plateauHeight: 300,
    canyonDepth: 0, snowLine: 5000, vegetation: 0.15, seaLevel: -100, waterEnabled: 0, talusSoft: 30, talusHard: 86,
    droplets: 140000, erodeSpeed: 0.3, peelStrength: 0.7, peelScale: 3.0, peelCoverage: 0.45, flakeStrength: 0.4,
    sunElevation: 32, sunAzimuth: 240, turbidity: 6,
  },
  'Canyon': {
    palette: 'sandstone', mountainHeight: 260, baseElevation: 240, baseFrequency: 1.1, ridgeSharpness: 1.2, peakPower: 0.9, warpStrength: 0.4,
    plateauStrength: 0.9, plateauHeight: 420, canyonDepth: 380, canyonWidth: 420,
    strataBand: 16, strataStrength: 1.0, strataDip: 1.5, hardnessContrast: 1.0, snowLine: 5000, vegetation: 0.1, seaLevel: -20, waterEnabled: 1,
    talusSoft: 31, talusHard: 86, droplets: 160000,
    peelStrength: 0.7, peelScale: 3.2, peelCoverage: 0.45, flakeStrength: 0.4, sunElevation: 38, sunAzimuth: 200, turbidity: 5,
  },
  'Sea cliffs': {
    palette: 'basalt', mountainHeight: 300, baseElevation: 20, baseFrequency: 1.4, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.5,
    reliefContrast: 0.9, strataBand: 22, strataStrength: 0.85, strataDip: 8, strataDipDirection: 120, hardnessContrast: 0.9,
    plateauStrength: 0.5, plateauHeight: 220, canyonDepth: 0, snowLine: 5000, vegetation: 0.9, mossiness: 0.8, seaLevel: 70, waterEnabled: 1,
    talusSoft: 35, talusHard: 84, droplets: 150000,
    peelStrength: 0.5, peelScale: 1.8, flakeStrength: 0.7, sunElevation: 18, sunAzimuth: 290, turbidity: 3, fogDensity: 0.5,
  },
  'Limestone escarpment': {
    palette: 'limestone', mountainHeight: 420, baseElevation: 30, baseFrequency: 1.2, ridgeSharpness: 1.7, peakPower: 1.2, warpStrength: 0.7,
    reliefContrast: 0.95, strataBand: 30, strataStrength: 0.9, strataDip: 10, strataDipDirection: 300, hardnessContrast: 0.9,
    plateauStrength: 0.35, plateauHeight: 400, canyonDepth: 0, snowLine: 5000, vegetation: 0.75, mossiness: 0.5, seaLevel: 0, waterEnabled: 0,
    talusSoft: 33, talusHard: 82, droplets: 170000,
    peelStrength: 0.55, peelScale: 2.4, flakeStrength: 0.5, sunElevation: 28, sunAzimuth: 160, turbidity: 4,
  },
};

Object.assign(presets, {
  'Fjord': {
    palette: 'slate', mountainHeight: 720, baseElevation: -140, baseFrequency: 1.1, ridgeSharpness: 2.6, peakPower: 1.5, warpStrength: 0.7,
    reliefContrast: 0.95, strataBand: 40, strataStrength: 0.4, strataDip: 8, hardnessContrast: 0.5, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 520, vegetation: 0.5, mossiness: 0.7, seaLevel: 0, waterEnabled: 1, talusSoft: 36, talusHard: 84, droplets: 160000,
    rockDensity: 0.3, peelStrength: 0.35, sunElevation: 20, sunAzimuth: 300, turbidity: 3, fogDensity: 0.55,
  },
  'Badlands': {
    palette: 'sandstone', mountainHeight: 180, baseElevation: 80, baseFrequency: 2.6, ridgeSharpness: 1.3, peakPower: 0.9, warpStrength: 0.5,
    reliefFrequency: 2.2, reliefContrast: 0.5, strataBand: 9, strataStrength: 1, strataDip: 1, hardnessContrast: 0.9, plateauStrength: 0.6, plateauHeight: 220,
    canyonDepth: 0, snowOn: 0, vegetation: 0.05, mossiness: 0.1, waterEnabled: 0, seaLevel: -100, droplets: 320000, erodeSpeed: 0.6, sedimentCapacity: 7, evaporation: 0.01,
    talusSoft: 32, talusHard: 80, rockDensity: 0.15, oxideAmount: 0.8, peelStrength: 0.3, sunElevation: 40, sunAzimuth: 215, turbidity: 7, fogDensity: 0.25, riverWater: 0, riverLakes: 0, riverCatchment: 0.08,
  },
  'Dolomite towers': {
    palette: 'limestone', mountainHeight: 650, baseElevation: 120, baseFrequency: 2.0, ridgeSharpness: 3.2, peakPower: 1.9, warpStrength: 0.45,
    reliefContrast: 1, strataBand: 34, strataStrength: 0.9, strataDip: 3, hardnessContrast: 1, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 560, vegetation: 0.7, mossiness: 0.3, waterEnabled: 0, seaLevel: -100, talusSoft: 35, talusHard: 88, droplets: 150000,
    overhang: 5, rockDensity: 0.35, sunElevation: 30, sunAzimuth: 190, turbidity: 4, fogDensity: 0.3,
  },
  'Desert buttes': {
    palette: 'sandstone', mountainHeight: 240, baseElevation: 40, baseFrequency: 1.0, ridgeSharpness: 1.2, peakPower: 1.6, warpStrength: 0.3,
    reliefFrequency: 1.8, reliefContrast: 1, plateauStrength: 1, plateauHeight: 230, canyonDepth: 0, strataBand: 14, strataStrength: 1, hardnessContrast: 1,
    snowOn: 0, vegetation: 0.03, mossiness: 0, waterEnabled: 0, seaLevel: -100, talusSoft: 31, talusHard: 88, droplets: 120000, thermalIterations: 40,
    rockDensity: 0.4, oxideAmount: 0.7, sunElevation: 48, sunAzimuth: 230, turbidity: 8, fogDensity: 0.2, riverWater: 0, riverLakes: 0, riverCatchment: 0.08,
  },
  'Volcanic island': {
    palette: 'basalt', mountainHeight: 520, baseElevation: -90, baseFrequency: 0.8, ridgeSharpness: 1.5, peakPower: 1.8, warpStrength: 0.5,
    reliefFrequency: 0.8, reliefContrast: 1, strataBand: 22, strataStrength: 0.5, hardnessContrast: 0.6, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.9, mossiness: 0.8, seaLevel: 0, waterEnabled: 1, droplets: 240000, erodeSpeed: 0.45, talusSoft: 33, talusHard: 80,
    rockDensity: 0.3, fogDensity: 0.4, turbidity: 5, sunElevation: 35, sunAzimuth: 120,
  },
  'Highland glens': {
    palette: 'granite', mountainHeight: 380, baseElevation: 20, baseFrequency: 1.3, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.8,
    reliefContrast: 0.7, strataBand: 30, strataStrength: 0.35, hardnessContrast: 0.5, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.95, mossiness: 0.8, dryness: 0.6, seaLevel: -10, waterEnabled: 1, droplets: 220000, talusSoft: 34, talusHard: 78,
    rockDensity: 0.5, peelStrength: 0.3, sunElevation: 22, sunAzimuth: 250, turbidity: 4, fogDensity: 0.5,
  },
  'Boulder field': {
    palette: 'granite', mountainHeight: 420, baseElevation: 30, baseFrequency: 1.5, ridgeSharpness: 1.4, peakPower: 1.0, warpStrength: 0.7,
    reliefContrast: 0.6, strataBand: 36, strataStrength: 0.3, hardnessContrast: 0.4, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.25, mossiness: 0.5, dryness: 0.7, waterEnabled: 0, seaLevel: -100, droplets: 200000, thermalIterations: 40, talusSoft: 36, talusHard: 76,
    rockDensity: 0.95, rockSlopeMax: 50, rockClustering: 0.35, rockSizeMin: 1.5, rockSizeMax: 16, rockEmbed: 0.4, pebbleDensity: 0.7,
    outcropDensity: 0.35, outcropSize: 12, outcropCount: 4, outcropSpacing: 200, outcropRidge: 0.3, outcropWeather: 0.6,
    peelStrength: 0.4, sunElevation: 30, sunAzimuth: 225, turbidity: 4, fogDensity: 0.25,
  },
  'Scree slopes': {
    palette: 'slate', mountainHeight: 600, baseElevation: 40, baseFrequency: 1.4, ridgeSharpness: 2.6, peakPower: 1.5, warpStrength: 0.55,
    reliefContrast: 0.9, strataBand: 24, strataStrength: 0.6, strataDip: 12, hardnessContrast: 0.8, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 620, vegetation: 0.15, mossiness: 0.3, waterEnabled: 0, seaLevel: -100, droplets: 160000, thermalIterations: 60, thermalRate: 0.7, talusSoft: 37, talusHard: 84,
    rockDensity: 0.8, rockSlopeMin: 15, rockSlopeMax: 48, rockClustering: 0.2, rockSizeMin: 0.5, rockSizeMax: 6, pebbleDensity: 0.9, pebbleSize: 0.6, gravelAmount: 1,
    peelStrength: 0.5, sunElevation: 26, sunAzimuth: 200, turbidity: 3, fogDensity: 0.35,
  },
  'Granite domes': {
    palette: 'granite', mountainHeight: 520, baseElevation: 60, baseFrequency: 0.9, ridgeSharpness: 1.1, peakPower: 1.7, warpStrength: 0.35,
    reliefFrequency: 1.2, reliefContrast: 1, strataBand: 60, strataStrength: 0.15, hardnessContrast: 0.3, plateauStrength: 0.2, plateauHeight: 520, canyonDepth: 0,
    snowOn: 0, vegetation: 0.35, mossiness: 0.2, waterEnabled: 0, seaLevel: -100, droplets: 90000, erodeSpeed: 0.2, thermalIterations: 10, talusSoft: 38, talusHard: 85,
    rockDensity: 0.5, rockSlopeMax: 35, rockClustering: 0.6, rockSizeMin: 2, rockSizeMax: 22, rockEmbed: 0.55, pebbleDensity: 0.3,
    peelStrength: 0.85, peelCoverage: 0.45, peelScale: 4, peelThickness: 0.05, flakeStrength: 0.8, sunElevation: 42, sunAzimuth: 240, turbidity: 5, fogDensity: 0.15,
    outcropDensity: 0.4, outcropSize: 18, outcropCount: 5, outcropSpacing: 260, outcropAspect: 0.65, outcropBury: 0.45, outcropRidge: 0.6, outcropWeather: 0.8,
    riverLakeFill: 0.6, riverLakeMax: 3,
  },
  'Granite tors': {
    palette: 'granite', mountainHeight: 260, baseElevation: 80, baseFrequency: 1.1, ridgeSharpness: 1.0, peakPower: 0.9, warpStrength: 0.6, reliefFrequency: 0.9, reliefContrast: 0.35,
    strataBand: 40, strataStrength: 0.1, hardnessContrast: 0.3, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.9, vegSlope: 38, mossiness: 0.7, dryness: 0.5, waterEnabled: 0, seaLevel: -100, droplets: 160000, erodeSpeed: 0.3, thermalIterations: 30, talusSoft: 33, talusHard: 84,
    outcropDensity: 0.7, outcropSize: 16, outcropCount: 7, outcropSpread: 1.5, outcropSpacing: 170, outcropAspect: 0.75, outcropBury: 0.35, outcropRidge: 0.85, outcropSlopeMax: 25, outcropWeather: 0.75,
    rockDensity: 0.45, rockSlopeMax: 40, rockClustering: 0.7, rockSizeMin: 1, rockSizeMax: 6, rockEmbed: 0.5, pebbleDensity: 0.4, gravelAmount: 0.3,
    sdfOn: 1, sdfAngle: 55, sdfUndercut: 3, sdfPockets: 9, sdfJoints: 0.3, sdfPits: 0.4, peelStrength: 0.5, peelCoverage: 0.3, peelScale: 3,
    riverCatchment: 0.08, riverLakeMax: 2, sunElevation: 26, sunAzimuth: 235, turbidity: 4, fogDensity: 0.35,
  },
  'Rocky coast': {
    palette: 'basalt', mountainHeight: 220, baseElevation: -40, baseFrequency: 1.8, ridgeSharpness: 1.8, peakPower: 1.2, warpStrength: 0.6,
    reliefContrast: 0.8, strataBand: 16, strataStrength: 0.8, strataDip: 6, hardnessContrast: 0.9, plateauStrength: 0.4, plateauHeight: 140, canyonDepth: 0,
    snowOn: 0, vegetation: 0.5, mossiness: 0.7, seaLevel: 0, waterEnabled: 1, droplets: 180000, talusSoft: 34, talusHard: 86,
    rockDensity: 0.9, rockSlopeMax: 60, rockClustering: 0.4, rockSizeMin: 0.8, rockSizeMax: 12, pebbleDensity: 0.9, pebbleSize: 0.5, gravelAmount: 1,
    peelStrength: 0.4, sunElevation: 20, sunAzimuth: 280, turbidity: 4, fogDensity: 0.45, wetness: 0.9,
  },
  'Talus canyon': {
    palette: 'sandstone', mountainHeight: 300, baseElevation: 220, baseFrequency: 1.1, ridgeSharpness: 1.3, peakPower: 0.9, warpStrength: 0.4,
    plateauStrength: 0.9, plateauHeight: 440, canyonDepth: 360, canyonWidth: 520, strataBand: 20, strataStrength: 1, strataDip: 2, hardnessContrast: 1,
    snowOn: 0, vegetation: 0.08, mossiness: 0.05, seaLevel: -20, waterEnabled: 0, droplets: 170000, thermalIterations: 50, thermalRate: 0.7, talusSoft: 33, talusHard: 87,
    rockDensity: 0.9, rockSlopeMin: 10, rockSlopeMax: 55, rockClustering: 0.3, rockSizeMin: 0.8, rockSizeMax: 14, pebbleDensity: 0.8, pebbleSize: 0.6, gravelAmount: 1,
    peelStrength: 0.6, peelScale: 3, oxideAmount: 0.7, sunElevation: 40, sunAzimuth: 205, turbidity: 6, fogDensity: 0.2, riverWater: 0, riverLakes: 0, riverCatchment: 0.08,
  },
  'Rocky mountains': {
    palette: 'granite', mountainHeight: 900, baseElevation: 60, baseFrequency: 1.5, ridgeSharpness: 2.8, peakPower: 1.6, warpStrength: 0.7,
    reliefFrequency: 1.1, reliefContrast: 0.85, strataBand: 34, strataStrength: 0.7, strataDip: 8, hardnessContrast: 0.9, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 700, snowSlope: 50, vegetation: 0.45, vegSlope: 38, mossiness: 0.3, seaLevel: -100, waterEnabled: 0, droplets: 220000, erodeSpeed: 0.4, thermalIterations: 40, talusSoft: 35, talusHard: 84,
    rockDensity: 0.7, rockSlopeMax: 50, rockSizeMin: 1, rockSizeMax: 14, pebbleDensity: 0.6, gravelAmount: 0.9,
    sdfOn: 1, sdfAngle: 56, sdfUndercut: 8, sdfJoints: 0.7, overhang: 3, riverCatchment: 0.05, riverBraiding: 0.2, riverLakes: 1,
    peelStrength: 0.5, flakeStrength: 0.7, sunElevation: 32, sunAzimuth: 215, turbidity: 3, fogDensity: 0.3,
  },
  'Sand dunes': {
    palette: 'sandstone', rockA: '#e3c49a', rockB: '#d2ab7c', rockC: '#f0d9b5', fresh: '#f6e4c4', oxide: '#c89a6e', gravelColor: '#d9b98f',
    mountainHeight: 70, baseElevation: 60, baseFrequency: 1.2, ridgeSharpness: 1.0, peakPower: 0.8, warpStrength: 0.4, reliefFrequency: 1.0, reliefContrast: 0.2,
    duneAmount: 48, duneWavelength: 300, duneDirection: 40, duneAsymmetry: 0.8, duneCoverage: 0.85,
    strataStrength: 0, strataBand: 60, hardnessContrast: 0.1, plateauStrength: 0, canyonDepth: 0,
    droplets: 6000, erodeSpeed: 0.1, thermalIterations: 30, thermalRate: 0.6, talusSoft: 33, talusHard: 36,
    snowOn: 0, vegOn: 0, vegetation: 0, mossOn: 0, mossiness: 0, oxideAmount: 0.15, waterEnabled: 0, seaLevel: -100,
    rocksEnabled: 0, pebblesOn: 0, gravelAmount: 0, peelOn: 0, flakeStrength: 0.25, flakeSize3: 0.08, flakeCrystal3: 0.5, flakeSparkle: 1.2,
    sdfOn: 0, overhang: 0, detailRelief: 0.15, rockyAmount: 0, riverSim: 0, riverWater: 0, riverLakes: 0, streakAmount: 0, wetness: 0.1,
    sunElevation: 28, sunAzimuth: 250, turbidity: 8, fogDensity: 0.15,
  },
  'Icelandic highlands': {
    palette: 'basalt', rockA: '#5d5a56', rockB: '#3f3d3b', rockC: '#7a756d', fresh: '#8d8a84', oxide: '#8a6a4e', gravelColor: '#4a4846', mossColor: '#6f7f3f', grassA: '#6b7a3c', grassB: '#9a9a5a', dryColor: '#7f7a5a',
    mountainHeight: 620, baseElevation: 120, baseFrequency: 1.3, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.7, reliefFrequency: 1.0, reliefContrast: 0.55,
    plateauStrength: 0.45, plateauHeight: 560, canyonDepth: 0, strataBand: 22, strataStrength: 0.9, strataDip: 2, hardnessContrast: 1.0,
    droplets: 260000, erodeSpeed: 0.45, sedimentCapacity: 6, thermalIterations: 40, talusSoft: 34, talusHard: 86,
    snowOn: 1, snowLine: 520, snowSlope: 42, snowSoftness: 2.5, vegetation: 0.5, vegSlope: 30, vegPatchiness: 0.8, dryness: 0.3, mossiness: 0.9, mossScale: 6,
    waterEnabled: 0, seaLevel: -100, riverCatchment: 0.03, riverWidthScale: 55, riverMaxWidth: 220, riverBraiding: 0.8, riverLakes: 1, riverLakeFill: 0.9,
    rockDensity: 0.4, rockSizeMax: 6, pebbleDensity: 0.6, gravelAmount: 1, sdfOn: 1, sdfAngle: 60, sdfUndercut: 5,
    outcropDensity: 0.2, outcropSize: 10, outcropCount: 6, outcropSpacing: 180, outcropAspect: 0.55, outcropBury: 0.5, outcropRidge: 0.2, outcropWeather: 0.3,
    oxideAmount: 0.6, peelStrength: 0.35, flakeStrength: 0.5, sunElevation: 22, sunAzimuth: 200, turbidity: 4, fogDensity: 0.5,
  },
  'Icelandic river plains': {
    palette: 'basalt', rockA: '#5a5753', rockB: '#3d3b39', rockC: '#77726a', fresh: '#8a8781', oxide: '#86684d', gravelColor: '#3f3d3b', mossColor: '#6c7c3c', grassA: '#66753a', grassB: '#9b9a5c', dryColor: '#7b765a',
    mountainHeight: 420, baseElevation: 30, baseFrequency: 1.1, ridgeSharpness: 1.5, peakPower: 1.2, warpStrength: 0.6, reliefFrequency: 0.9, reliefContrast: 0.75,
    plateauStrength: 0.2, plateauHeight: 420, canyonDepth: 0, strataBand: 20, strataStrength: 0.8, strataDip: 1.5, hardnessContrast: 0.9,
    droplets: 280000, erodeSpeed: 0.5, sedimentCapacity: 7, depositSpeed: 0.35, thermalIterations: 36, talusSoft: 33, talusHard: 84,
    snowOn: 1, snowLine: 380, snowSlope: 40, snowSoftness: 3, vegetation: 0.55, vegSlope: 28, vegPatchiness: 0.85, dryness: 0.35, mossiness: 0.85, mossScale: 7,
    waterEnabled: 1, seaLevel: 0, riverCatchment: 0.02, riverWidthScale: 70, riverMaxWidth: 300, riverDepthScale: 0.8, riverBraiding: 1.0, riverLakes: 1, riverLakeFill: 0.95, riverGuideFlow: 2,
    rockDensity: 0.25, rockSizeMax: 5, pebbleDensity: 0.8, pebbleSize: 0.5, gravelAmount: 1, sdfOn: 1, sdfAngle: 60, sdfUndercut: 4,
    oxideAmount: 0.5, peelStrength: 0.3, flakeStrength: 0.45, sunElevation: 26, sunAzimuth: 190, turbidity: 5, fogDensity: 0.45,
  },
  'Karst pinnacles': {
    palette: 'limestone', mountainHeight: 300, baseElevation: 30, baseFrequency: 3.2, ridgeSharpness: 3.0, peakPower: 1.7, warpStrength: 0.4,
    reliefFrequency: 2.4, reliefContrast: 0.9, strataBand: 20, strataStrength: 0.5, hardnessContrast: 0.8, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.85, mossiness: 0.9, waterEnabled: 1, seaLevel: 0, droplets: 200000, talusSoft: 36, talusHard: 88,
    overhang: 4, rockDensity: 0.25, sunElevation: 45, sunAzimuth: 170, turbidity: 6, fogDensity: 0.45,
  },
  'Rugged escarpment': {
    palette: 'granite', mountainHeight: 640, baseElevation: 60, baseFrequency: 1.4, ridgeSharpness: 2.4, peakPower: 1.5, warpStrength: 0.7,
    reliefFrequency: 1.1, reliefContrast: 0.8, strataBand: 24, strataStrength: 0.9, strataDip: 5, strataDipDirection: 60, hardnessContrast: 0.9, plateauStrength: 0, canyonDepth: 0,
    strataBreak: 0.7, strataFaultScale: 150, strataFaultWidth: 8, strataSub: 0.6, strataSubCount: 3, strataLateralMode: 0.5,
    ruggedAmount: 0.85, ruggedScale: 55, ruggedRelief: 10, ruggedBreakage: 0.65, ruggedCrevice: 0.7, ruggedDensity: -0.2, ruggedCoverage: 0.75, ruggedSlopeMin: 10, ruggedHardBias: 0.4,
    droplets: 200000, erodeSpeed: 0.4, thermalIterations: 36, talusSoft: 34, talusHard: 84,
    snowOn: 1, snowLine: 560, snowSlope: 50, vegetation: 0.4, vegSlope: 40, mossiness: 0.35, waterEnabled: 0, seaLevel: -100,
    rockDensity: 0.6, rockSlopeMax: 55, rockSizeMin: 1, rockSizeMax: 12, pebbleDensity: 0.6, gravelAmount: 0.9,
    sdfOn: 1, sdfAngle: 56, sdfUndercut: 7, sdfRugged: 0.9, sdfJoints: 0.6, overhang: 3,
    riverCatchment: 0.05, riverBraiding: 0.2, riverLakes: 1,
    peelStrength: 0.5, flakeStrength: 0.7, sunElevation: 28, sunAzimuth: 220, turbidity: 4, fogDensity: 0.35,
  },
});

export const palettes = {
  granite:   { name: 'Granite',   rockA: '#b3b1ae', rockB: '#94918f', rockC: '#c7c2ba', fresh: '#d6d3cd', oxide: '#ac947b', flakeColor1: '#9d9893', flakeColor2: '#c9bfb3', flakeColor3: '#e4e0d8', gravelColor: '#9a938a' },
  sandstone: { name: 'Sandstone', rockA: '#e1b794', rockB: '#bd8f72', rockC: '#eed6b7', fresh: '#f3dec2', oxide: '#a8755a', flakeColor1: '#c9a07c', flakeColor2: '#e5c8a4', flakeColor3: '#f2e3c9', gravelColor: '#c7a383' },
  limestone: { name: 'Limestone', rockA: '#d9d3c7', rockB: '#b3aea4', rockC: '#e9e4d9', fresh: '#f1ede4', oxide: '#baa080', flakeColor1: '#c4bdae', flakeColor2: '#e2dccf', flakeColor3: '#f3f0e8', gravelColor: '#bdb6a8' },
  basalt:    { name: 'Basalt',    rockA: '#858588', rockB: '#616165', rockC: '#a09e9c', fresh: '#b1b0ae', oxide: '#a08068', flakeColor1: '#6c6c70', flakeColor2: '#8e8d8a', flakeColor3: '#b5b2ad', gravelColor: '#7a7a7c' },
  slate:     { name: 'Slate',     rockA: '#9498a0', rockB: '#6f7580', rockC: '#b0b3ba', fresh: '#c2c6ca', oxide: '#a48a75', flakeColor1: '#767b86', flakeColor2: '#a3a7ae', flakeColor3: '#cfd2d6', gravelColor: '#8a8e96' },
};
export const paletteKeys = ['rockA', 'rockB', 'rockC', 'fresh', 'oxide', 'flakeColor1', 'flakeColor2', 'flakeColor3', 'gravelColor'];

// Inspector schema. Each group = one outliner row. Each control: [key, label, min, max, step, unit, hint]
export const groups = [
  {
    id: 'landform', name: 'Landform', type: 'Base relief', stage: 'terrain', color: '#d6a078',
    cards: [
      { title: 'Preset', kind: 'presets' },
      { title: 'Elevation', controls: [
        ['mountainHeight', 'Mountain height', 100, 1200, 10, 'm', 'Peak elevation above the datum'],
        ['baseElevation', 'Base elevation', -200, 400, 5, 'm', 'Elevation of the plains'],
        ['worldSize', 'World size', 1024, 4096, 128, 'm', 'Side length of the generated tile'],
      ] },
      { title: 'Dunes', controls: [
        ['duneAmount', 'Dune height', 0, 80, 1, 'm', 'Transverse sand dunes added to the relief: long windward slope, short slip face'],
        ['duneWavelength', 'Dune spacing', 30, 600, 5, 'm', ''],
        ['duneDirection', 'Wind direction', 0, 360, 5, '°', ''],
        ['duneAsymmetry', 'Asymmetry', 0.5, 0.9, 0.01, '', 'Position of the crest along the wavelength (0.5 symmetric, 0.9 steep slip face)'],
        ['duneCoverage', 'Coverage', 0, 1, 0.05, '', 'Fraction of the tile with dune fields'],
      ] },
      { title: 'Boulder outcrops', controls: [
        ['outcropDensity', 'Outcrop density', 0, 1, 0.05, '', 'Clusters of large core-stones built into the relief before strata and erosion — tors, woolsacks, "encampments". 0 = none'],
        ['outcropSize', 'Boulder size', 4, 60, 1, 'm', 'Radius of the largest boulder in a cluster'],
        ['outcropCount', 'Boulders per cluster', 1, 12, 1, '', ''],
        ['outcropSpread', 'Cluster spread', 0.8, 3, 0.1, '', 'How far the satellites sit from the main stone (×size)'],
        ['outcropSpacing', 'Cluster spacing', 60, 800, 10, 'm', 'Site grid for clusters; density decides how many sites are used'],
        ['outcropAspect', 'Height / width', 0.3, 1.3, 0.05, '', 'Flat slabs to tall stacks'],
        ['outcropBury', 'Burial', 0.1, 0.8, 0.05, '', 'How deep the stones sit in the ground'],
        ['outcropWeather', 'Rounding', 0, 1, 0.05, '', '0 = blocky joint-bounded blocks, 1 = fully rounded woolsacks'],
        ['outcropRidge', 'Prefer high ground', 0, 1, 0.05, '', 'Bias clusters towards ridges and hill tops (tors) rather than anywhere'],
        ['outcropSlopeMax', 'Max ground slope', 5, 60, 1, '°', 'Clusters avoid ground steeper than this'],
      ] },
      { title: 'Relief', controls: [
        ['baseFrequency', 'Ridge frequency', 0.6, 4, 0.05, '', 'Number of ridge systems across the tile'],
        ['ridgeSharpness', 'Ridge sharpness', 1, 4, 0.05, '', 'Crest profile — rounded to knife-edge'],
        ['peakPower', 'Peak emphasis', 0.6, 2.5, 0.05, '', 'Concentrates height into the summits'],
        ['warpStrength', 'Domain warp', 0, 1.5, 0.05, '', 'Bends ridgelines into realistic curves'],
        ['reliefContrast', 'Massif contrast', 0.1, 1, 0.05, '', 'How sharply mountains rise from plains'],
        ['reliefFrequency', 'Massif frequency', 0.6, 3, 0.1, '', 'Scale of the mountain / plains pattern'],
      ] },
      { title: 'Mesa & canyon', controls: [
        ['plateauStrength', 'Plateau flattening', 0, 1, 0.05, '', 'Soft-clamps summits into flat tops'],
        ['plateauHeight', 'Plateau height', 50, 1000, 10, 'm', 'Elevation of the caprock surface'],
        ['canyonDepth', 'Canyon depth', 0, 600, 10, 'm', 'Incision of the meandering gorge'],
        ['canyonWidth', 'Canyon width', 60, 900, 10, 'm', 'Rim-to-rim width'],
      ] },
      { title: 'Grid', controls: [
        ['seed', 'Seed', 1, 9999, 1, '', 'Deterministic noise seed'],
        ['resolution', 'Resolution', 128, 2048, 128, 'px', 'Heightfield side in samples. 512 ≈ 2 s, 1024 ≈ 15 s, 2048 ≈ 1 min and a 4 M-vertex mesh'],
      ] },
    ],
  },
  {
    id: 'strata', name: 'Strata', type: 'Cliff layering', stage: 'terrain', color: '#c29583',
    cards: [
      { title: 'Bedding', controls: [
        ['strataBand', 'Bed thickness', 6, 80, 1, 'm', 'Typical vertical thickness of a rock layer'],
        ['strataStrength', 'Terracing', 0, 1, 0.05, '', 'How strongly beds step into benches and faces'],
        ['hardnessContrast', 'Caprock contrast', 0, 1, 0.05, '', 'Resistant layers hold vertical faces; soft layers slope'],
      ] },
      { title: 'Stratigraphic column', controls: [
        ['strataVariation', 'Thickness variation', 0, 1.5, 0.05, '', 'Spread of bed thicknesses around the typical value (0 = all beds alike)'],
        ['strataPackaging', 'Packaging', 0, 1, 0.05, '', 'How much beds group into thin-bedded (shale) and massive (sandstone / limestone) packages instead of a random stack'],
        ['strataHardShare', 'Hard share', 0, 1, 0.05, '', 'Share of resistant beds in the mixed packages'],
        ['strataLateral', 'Lateral change', 0, 0.4, 0.01, '', 'Beds thicken and thin across the tile'],
      ] },
      { title: 'Geological dip', controls: [
        ['strataDip', 'Dip angle', 0, 25, 0.5, '°', 'Tilt of the bedding planes'],
        ['strataDipDirection', 'Dip direction', 0, 360, 5, '°', 'Compass direction the beds dip towards'],
      ] },
      { title: 'Broken plates', controls: [
        ['strataBreak', 'Fault offset', 0, 1.5, 0.05, 'bands', 'Gaea-style broken strata: fault blocks shift the column up/down so beds end at scarps instead of wrapping the whole tile. 0 = continuous beds'],
        ['strataFaultScale', 'Block size', 20, 400, 5, 'm', 'Width of the fault blocks'],
        ['strataFaultWidth', 'Fault width', 1, 30, 0.5, 'm', 'Scarps stay continuous over this width so the heightfield never tears and the 3-D chunks stay watertight — keep it above the grid cell'],
      ] },
      { title: 'Substrata & lateral', controls: [
        ['strataSub', 'Substrata', 0, 1, 0.05, '', 'Secondary bedding inside each bed (Gaea Substrata): fine terraces on the heightfield, lips in the 3-D carve, seams in the paint'],
        ['strataSubCount', 'Sub-beds per bed', 2, 6, 1, '', ''],
        ['strataLateralMode', 'Lateral drift', 0, 1.5, 0.05, 'bands', 'Gaea Lateral mode: packages swell, pinch and drift across the tile instead of stacking flat'],
      ] },
    ],
  },
  {
    id: 'rugged', name: 'Rugged', type: 'Outcrops & shattered rock', stage: 'terrain', color: '#c98a5f',
    cards: [
      { title: 'Rugged outcrops', controls: [
        ['ruggedAmount', 'Rugged amount', 0, 1, 0.05, '', 'Gaea Rugged / Outcrops / Rocky in one node: shattered plates, crevices and fragmentation broken into the relief before erosion, so water weathers them. 0 = off'],
        ['ruggedScale', 'Plate scale', 8, 200, 1, 'm', 'Width of the broken plates'],
        ['ruggedRelief', 'Plate relief', 0, 30, 0.5, 'm', 'How far plates rise and sink — the broad shape is preserved, only detail is added'],
        ['ruggedBreakage', 'Breakage', 0, 1, 0.05, '', 'Clean tilted plates → fully shattered ground'],
        ['ruggedCoverage', 'Coverage', 0, 1, 0.05, '', 'Share of the tile with outcrop fields'],
      ] },
      { title: 'Crevices & detail', controls: [
        ['ruggedCrevice', 'Crevice depth', 0, 1, 0.05, '', 'V slots carved along the plate borders'],
        ['ruggedDensity', 'Density', -1, 1, 0.05, '', '−1 deep wide crevices · +1 fused plates with small-rock pockets (Gaea Density)'],
        ['ruggedOctaves', 'Detail octaves', 1, 4, 1, '', 'Iterations of fragmentation detail'],
        ['ruggedSweep', 'Sweep', 0, 4, 1, '', 'Lateral smoothing passes on the broken rock (Gaea Sweep)'],
        ['ruggedWarp', 'Warp', 0, 1, 0.05, '', 'Bend the plate lattice into curved shapes'],
        ['ruggedReverse', 'Reverse', 0, 1, 1, '', 'Invert the breakage: pits become pinnacles'],
        ['ruggedSeed', 'Rugged seed', 1, 999, 1, '', 'Plate layout without touching the landform seed'],
      ] },
      { title: 'Masking', controls: [
        ['ruggedSlopeMin', 'Slope · min', 0, 60, 1, '°', 'No rugged detail on ground gentler than this'],
        ['ruggedSlopeMax', 'Slope · max', 20, 89, 1, '°', 'No rugged detail on ground steeper than this'],
        ['ruggedHardBias', 'Hard-rock bias', -1, 1, 0.05, '', '−1 only on soft beds · 0 everywhere · +1 only on hard caprock'],
      ] },
    ],
  },
  {
    id: 'relief', name: 'Cliff depth', type: 'True-3D cliffs, overhangs & mesh detail', stage: 'mesh', color: '#b9a3d6',
    cards: [
      { title: 'True-3D cliffs (SDF chunks)', controls: [
        ['sdfOn', 'Enable 3D cliffs', 0, 1, 1, '', 'Steep parts of the terrain are re-meshed from a 3D field (heightfield distance + strata carving) in chunks that are watertight with the heightfield mesh — real undercuts, overhangs, notches and shelters'],
        ['sdfAngle', 'Cliff angle', 35, 80, 1, '°', 'Cells steeper than this get a 3D chunk'],
        ['sdfUndercut', 'Undercut depth', 0, 20, 0.5, 'm', 'How far soft strata beds are carved back under hard beds (follows the strata model: band, dip, hardness)'],
        ['sdfBedContrast', 'Bed contrast', 0.3, 3, 0.1, '', 'Higher = only the softest beds recede'],
        ['sdfPockets', 'Pocket scale', 3, 40, 1, 'm', 'Scale of the 3D noise that breaks undercuts into alcoves'],
        ['sdfJoints', 'Joints', 0, 1.5, 0.05, '', 'Near-vertical joint cuts and chimneys'],
        ['sdfPits', 'Pits', 0, 1, 0.05, '', 'Weathering hollows'],
        ['sdfRough', 'Roughness', 0, 1.5, 0.05, '', 'Fine 3D roughness on the carved faces'],
        ['sdfRugged', 'Rugged carve', 0, 1.5, 0.05, '', 'Crisp crevice slots along the rugged plates inside the 3-D chunks (needs Rugged amount > 0; band-limited to the voxel size so it fades instead of aliasing)'],
        ['sdfBlend', 'Blend margin', 1, 5, 1, 'cells', 'Cells over which the 3D field fades back to the plain heightfield'],
        ['sdfChunk', 'Chunk size', 8, 32, 8, 'cells', ''],
        ['sdfVoxel', 'Voxels per cell', 0, 3, 1, '', '0 = auto: the finest resolution that fits the voxel budget. 2 = voxels half the grid cell (8× the work), 3 = a third'],
        ['sdfVoxelBudget', 'Voxel budget', 2, 80, 2, 'M', 'Total voxels (in the surface band) auto mode may spend; raise it for finer cliffs if the machine can take it'],
        ['sdfMaxChunks', 'Chunk budget', 50, 4000, 50, '', 'Chunks with the most cliff area are built first; the rest fall back to the displaced heightfield'],
      ] },
      { title: 'Face displacement', controls: [
        ['overhang', 'Caprock overhang', 0, 8, 0.25, 'm', 'Hard beds pushed out of the face, soft beds recessed — real multi-cell overhangs a heightmap cannot hold (blurred + slope-limited so the grid never folds)'],
        ['buttress', 'Buttress bulge', 0, 1, 0.05, '', 'Large-scale swelling of the faces into ribs and alcoves'],
        ['ledgeNoise', 'Ledge irregularity', 0, 1, 0.05, '', 'Breaks ledges into blocks and notches'],
      ] },
      { title: 'Mesh detail', controls: [
        ['meshSubdivision', 'Mesh subdivision', 1, 4, 1, '×', 'Vertices per heightfield cell (bicubic). Mesh side is capped at 2049 vertices'],
        ['detailRelief', 'Detail relief', 0, 3, 0.05, 'm', 'Fine bumps and knobs pushed along the surface normal — independent of the heightfield'],
        ['detailScale', 'Detail scale', 1, 40, 0.5, 'm', ''],
        ['detailCliffBias', 'Cliff bias', 0, 1, 0.05, '', '0 = everywhere, 1 = steep rock only'],
        ['rockyAmount', 'Rocky facets', 0, 3, 0.05, 'm', 'Angular joint-bounded blocks on steep hard rock (soft beds stay smooth) — the "rocky" look of fractured faces'],
        ['rockyScale', 'Block size', 1, 20, 0.5, 'm', ''],
        ['rockyAngular', 'Blockiness', 0, 1, 0.05, '', '0 = rounded knobs, 1 = sharp-edged blocks'],
      ] },
    ],
  },
  {
    id: 'erosion', name: 'Erosion', type: 'Hydraulic & thermal', stage: 'terrain', color: '#81b8c8',
    cards: [
      { title: 'Hydraulic erosion', controls: [
        ['droplets', 'Droplets', 0, 600000, 10000, '', 'Rain particles traced downhill'],
        ['erodeSpeed', 'Cutting rate', 0.05, 1, 0.05, '', 'How fast flowing water removes material'],
        ['depositSpeed', 'Deposition rate', 0.05, 1, 0.05, '', 'How readily sediment settles into fans'],
        ['sedimentCapacity', 'Sediment capacity', 1, 12, 0.5, '', 'Load a fast droplet can carry'],
        ['evaporation', 'Evaporation', 0.002, 0.05, 0.001, '', 'Droplet lifetime limit by drying'],
        ['inertia', 'Inertia', 0, 0.5, 0.01, '', 'Momentum of flow around obstacles'],
        ['erosionRadius', 'Brush radius', 1, 6, 1, 'px', 'Width of the carved channel'],
        ['hardnessInfluence', 'Rock resistance', 0, 1, 0.05, '', 'How much caprock resists cutting'],
      ] },
      { title: 'Thermal weathering', controls: [
        ['thermalIterations', 'Slump passes', 0, 80, 1, '', 'Iterations of talus slumping'],
        ['talusSoft', 'Repose angle · soft', 20, 45, 1, '°', 'Scree settles to this slope'],
        ['talusHard', 'Repose angle · hard', 45, 89, 1, '°', 'Caprock holds faces up to this angle'],
        ['thermalRate', 'Slump rate', 0.1, 1, 0.05, '', 'Fraction of excess moved per pass'],
      ] },
    ],
  },
  {
    id: 'features', name: 'Roads, rivers & lakes', type: 'Drawn features', stage: 'mesh', color: '#7fb3d5',
    cards: [
      { title: 'Draw', kind: 'draw' },
      { title: 'Features', kind: 'featureList' },
      { title: 'Simulated rivers', stage: 'terrain', controls: [
        ['riverSim', 'Simulate drainage', 0, 1, 1, '', 'Fill depressions, route D8 flow over the eroded surface and carve a river network where the catchment is large enough. Drawn rivers become guides that inject flow'],
        ['riverCatchment', 'Min. catchment', 0.01, 2, 0.01, 'km²', 'Drainage area needed before a channel forms — smaller = denser network'],
        ['riverWidthScale', 'Width per √km²', 4, 120, 1, 'm', 'Channel width = this × √catchment'],
        ['riverMaxWidth', 'Max width', 10, 400, 5, 'm', ''],
        ['riverDepthScale', 'Depth scale', 0.2, 3, 0.05, '', 'Channel depth ≈ scale × width^0.45'],
        ['riverWaterFrac', 'Water fill', 0.2, 0.9, 0.05, '', 'Fraction of the channel depth filled with water'],
        ['riverDrySlope', 'Dry above grade', 2, 45, 1, '°', 'Reaches steeper than this show the carved gully (wet rock, gravel) instead of standing water — mountain torrents do not read as flat water'],
        ['riverDryBig', 'Always wet above', 0.1, 20, 0.1, 'km²', 'Rivers with a catchment this large keep water on any grade'],
        ['riverBraiding', 'Braiding', 0, 1, 0.05, '', 'Gravel bars and split threads on wide, gentle reaches (river plains)'],
        ['riverLakes', 'Lakes in depressions', 0, 1, 1, '', 'Closed basins fill to their spill level'],
        ['riverLakeFill', 'Lake fill', 0, 1, 0.05, '', '1 = basins fill to their spill level · lower leaves a dry floor with the river crossing it'],
        ['riverLakeMax', 'Lake area cap', 0, 40, 1, '%', 'Largest/deepest basins are filled first until this share of the map is lake; beyond it only a small pond remains where a river ends in a hollow'],
        ['riverLakeMin', 'Min. lake area', 0.001, 0.2, 0.001, 'km²', 'Smaller depressions stay dry unless a river feeds them'],
        ['lakeConnect', 'Lake inlets & outlets', 0, 1, 1, '', 'Every visible lake gets an outlet from its pour point plus up to two inlet streams, so lakes join the river network instead of sitting as isolated blobs'],
        ['lakeConnectLen', 'Connector length', 50, 500, 10, 'm', 'How far an inlet/outlet channel runs before it must join a river, another lake, or the sea'],
        ['riverGuideFlow', 'Guide flow', 0, 5, 0.1, 'km²', 'Catchment injected at the head of each drawn river so it always carries water'],
      ] },
      { title: 'Drawn river guides', stage: 'terrain', controls: [
        ['riverWidth', 'Channel width', 2, 120, 1, 'm', 'Width of the carved channel'],
        ['riverDepth', 'Channel depth', 0.5, 40, 0.5, 'm', 'Incision below the smoothed valley profile'],
        ['riverBank', 'Bank angle', 10, 80, 1, '°', 'Slope of the cut banks'],
        ['riverMaxBank', 'Bank height', 2, 200, 1, 'm', 'Banks are shaped up to this height (the cut fades out towards it); keep it low for valleys that follow the terrain, high for gorges'],
        ['riverMeander', 'Meander', 0, 1, 0.05, '', 'Lateral sinuosity added to the drawn line'],
        ['riverErosion', 'Water erosion', 0, 1, 0.05, '', 'Share of erosion droplets that start in the river and how much water they carry — carves the bed and drains the slopes into it. Rivers flow from their higher end'],
        ['riverWaterDepth', 'Water depth', 0.2, 10, 0.1, 'm', 'Depth of water standing in the channel'],
      ] },
      { title: 'Roads', controls: [
        ['roadWidth', 'Road width', 2, 30, 0.5, 'm', '6 m ≈ two-lane; 3.5 m ≈ track'],
        ['roadShoulder', 'Shoulder', 0, 10, 0.5, 'm', 'Bare verge either side'],
        ['roadSmoothing', 'Grade smoothing', 10, 300, 5, 'm', 'Length over which the road profile is averaged'],
        ['roadCut', 'Cut slope', 30, 85, 1, '°', 'Rock cut above the road'],
        ['roadFill', 'Fill slope', 20, 60, 1, '°', 'Embankment below the road'],
        ['roadShading', 'Road surface', 0, 1, 1, '', 'Shade the carriageway (off = bare carved ground)'],
        ['roadColor', 'Road colour', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Lakes', controls: [
        ['lakeLevelOffset', 'Level above click', 0, 60, 1, 'm', 'New lakes fill to the clicked ground height plus this'],
        ['lakeDepth', 'Bed depth', 1, 40, 0.5, 'm', 'Flat silt bed this far below the level'],
      ] },
      { title: 'Water in channels', controls: [
        ['riverWater', 'Water in rivers', 0, 1, 1, '', 'Off = dried river beds (cobbles and silt)'],
        ['lakeWater', 'Water in lakes', 0, 1, 1, '', 'Off = dried lake beds'],
      ] },
      { title: 'Display', controls: [
        ['showFeatureLines', 'Show feature lines', 0, 1, 1, '', 'Guide lines over roads, rivers and lake markers'],
      ] },
    ],
  },
  {
    id: 'rocks', name: 'Rocks', type: 'Plain scatter', stage: 'rocks', color: '#a8bbeb',
    cards: [
      { title: 'Scatter', controls: [
        ['rocksEnabled', 'Enable rocks', 0, 1, 1, '', ''],
        ['rockDensity', 'Density', 0, 1, 0.05, '', 'How many rocks are scattered'],
        ['rockSlopeMin', 'Slope · min', 0, 80, 1, '°', 'No rocks on ground gentler than this'],
        ['rockSlopeMax', 'Slope · max', 5, 89, 1, '°', 'No rocks on ground steeper than this'],
        ['rockClustering', 'Clustering', 0, 1, 0.05, '', 'Even spread → grouped into patches'],
        ['rockClusterScale', 'Cluster size', 10, 400, 5, 'm', ''],
        ['rockTilt', 'Follow slope', 0, 1, 0.05, '', 'Upright → aligned to the ground normal'],
      ] },
      { title: 'Gravel stones', controls: [
        ['pebblesOn', 'Enable stones', 0, 1, 1, '', 'Real small stone meshes on scree aprons and river beds, on top of the pebble shading'],
        ['pebbleDensity', 'Stone density', 0, 1, 0.05, '', 'Up to 40 000 instances'],
        ['pebbleSize', 'Largest stone', 0.1, 2, 0.05, 'm', ''],
      ] },
      { title: 'Rock shape', controls: [
        ['rockSizeMin', 'Smallest rock', 0.3, 6, 0.1, 'm', ''],
        ['rockSizeMax', 'Largest rock', 2, 40, 0.5, 'm', ''],
        ['rockAngularity', 'Angularity', 0, 1, 0.05, '', 'Planar cleavage cuts vs. rounded boulders'],
        ['rockEmbed', 'Embed depth', 0, 1, 0.05, '', 'How deep rocks sit in the ground'],
        ['rockSeed', 'Rock seed', 1, 999, 1, '', ''],
      ] },
    ],
  },
  {
    id: 'material', name: 'Rock material', type: 'Beds, grain & staining', stage: 'live', color: '#cab281',
    cards: [
      { title: 'Rock type', kind: 'palette' },
      { title: 'Colours', controls: [
        ['rockA', 'Base rock', 0, 0, 0, 'color', 'Dominant bed colour'],
        ['rockB', 'Dark beds', 0, 0, 0, 'color', 'Recessive / shaly beds'],
        ['rockC', 'Pale beds', 0, 0, 0, 'color', 'Caprock and resistant beds'],
        ['fresh', 'Fresh break', 0, 0, 0, 'color', 'Unweathered rock exposed by spalling'],
        ['oxide', 'Oxide stain', 0, 0, 0, 'color', 'Iron-oxide pocket colour'],
      ] },
      { title: 'Strata', controls: [
        ['strataOn', 'Enable strata', 0, 1, 1, '', ''],
        ['strataContrast', 'Bed contrast', 0, 1, 0.05, '', 'Tonal difference between beds'],
        ['strataBandScale', 'Band scale', 0.25, 4, 0.05, '×', 'Painted beds relative to the carved beds (1 = the colour follows the stratigraphic column exactly)'],
        ['laminae', 'Laminae', 0, 1, 0.05, '', 'Thin sub-bands inside each bed'],
        ['bedGradient', 'Bed shading', 0, 1, 0.05, '', 'Darkening towards the base of each bed'],
        ['seamStrength', 'Seam darkness', 0, 1, 0.05, '', 'Dark lines along bedding planes'],
        ['seamWidth', 'Seam width', 0.01, 0.3, 0.01, '', 'Fraction of the bed taken by the seam'],
        ['hardnessTint', 'Caprock tint', 0, 1, 0.05, '', 'Hard beds paler, soft beds warmer'],
      ] },
      { title: 'Grain', controls: [
        ['grainOn', 'Enable grain', 0, 1, 1, '', ''],
        ['grainSize', 'Grain size', 0.1, 3, 0.05, 'm', 'Scale of the aggregate bump'],
        ['grainStrength', 'Grain relief', 0, 1, 0.05, '', 'Bump strength of the grain'],
        ['grainContrast', 'Grain mottle', 0, 1, 0.05, '', 'Colour mottling from the grain field'],
        ['grainFineness', 'Fine grain', 0, 1, 0.05, '', 'Scale of the secondary fine grain'],
      ] },
      { title: 'Oxide & cavity', controls: [
        ['oxideOn', 'Enable oxide', 0, 1, 1, '', ''],
        ['oxideAmount', 'Oxide amount', 0, 1, 0.05, '', 'Coverage of iron-oxide pockets'],
        ['oxideScale', 'Oxide scale', 0.5, 30, 0.5, 'm', 'Size of the staining pockets'],
        ['cavityStrength', 'Cavity shading', 0, 1, 0.05, '', 'Darken concavities, lighten convex edges'],
      ] },
      { title: 'Material response', controls: [
        ['bumpScale', 'Bump strength', 0, 2, 0.05, '', 'Global multiplier on all normal detail'],
        ['baseRoughness', 'Base roughness', 0.3, 1, 0.05, '', ''],
      ] },
    ],
  },
  {
    id: 'flakes', name: 'Mineral flakes', type: 'Layered grain', stage: 'live', color: '#d8c38a',
    cards: [
      { title: 'Flakes', controls: [
        ['flakesOn', 'Enable flakes', 0, 1, 1, '', ''],
        ['flakeStrength', 'Coverage', 0, 1, 0.05, '', 'Overall amount of plates on exposed rock'],
        ['flakeEdge', 'Rim highlight', 0, 1, 0.05, '', 'Bright bevel along plate edges'],
        ['flakeSheen', 'Plate sheen', 0, 1, 0.05, '', 'Lower roughness on plates so they catch light'],
        ['flakeSparkle', 'Crystal glitter', 0, 2, 0.05, '', 'Sun glints on crystal plates (view dependent)'],
        ['flakeOxide', 'Oxidise with runoff', 0, 1, 0.05, '', 'Plates take the oxide colour where water flows and in oxide pockets — the erosion channels drive the tint'],
      ] },
      { title: 'Layer 1 · base chips', controls: [
        ['flakeOn1', 'Enable layer', 0, 1, 1, '', 'Largest plates at the bottom of the stack'],
        ['flakeColor1', 'Layer colour', 0, 0, 0, 'color', ''],
        ['flakeSize1', 'Plate size', 0.03, 8, 0.01, 'm', ''],
        ['flakeDensity1', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
        ['flakeHeight1', 'Plate height', 0, 30, 0.5, 'mm', 'Tilt and rim bevel in the normal'],
        ['flakeVar1', 'Tint variation', 0, 1, 0.05, '', 'Per-plate lightness / warmth jitter around the layer colour'],
        ['flakeShape1', 'Shape', 0, 1, 0.05, '', 'Angular chips → rounded grains'],
        ['flakeCrystal1', 'Crystals', 0, 1, 0.05, '', 'Share of plates that are crystals: brighter, glossy, they glint in the sun'],
        ['flakeReveal1', 'Reveal by hardness', -1, 1, 0.05, '', '−1 only on soft / eroded beds · 0 everywhere · +1 only on hard caprock'],
      ] },
      { title: 'Layer 2 · laminae', controls: [
        ['flakeOn2', 'Enable layer', 0, 1, 1, '', 'Mid-size plates over the chips'],
        ['flakeColor2', 'Layer colour', 0, 0, 0, 'color', ''],
        ['flakeSize2', 'Plate size', 0.03, 8, 0.01, 'm', ''],
        ['flakeDensity2', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
        ['flakeHeight2', 'Plate height', 0, 30, 0.5, 'mm', 'Tilt and rim bevel in the normal'],
        ['flakeVar2', 'Tint variation', 0, 1, 0.05, '', 'Per-plate lightness / warmth jitter around the layer colour'],
        ['flakeShape2', 'Shape', 0, 1, 0.05, '', 'Angular chips → rounded grains'],
        ['flakeCrystal2', 'Crystals', 0, 1, 0.05, '', 'Share of plates that are crystals: brighter, glossy, they glint in the sun'],
        ['flakeReveal2', 'Reveal by hardness', -1, 1, 0.05, '', '−1 only on soft / eroded beds · 0 everywhere · +1 only on hard caprock'],
      ] },
      { title: 'Layer 3 · fine grain', controls: [
        ['flakeOn3', 'Enable layer', 0, 1, 1, '', 'Smallest plates on top; the usual place for crystals'],
        ['flakeColor3', 'Layer colour', 0, 0, 0, 'color', ''],
        ['flakeSize3', 'Plate size', 0.03, 8, 0.01, 'm', ''],
        ['flakeDensity3', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
        ['flakeHeight3', 'Plate height', 0, 30, 0.5, 'mm', 'Tilt and rim bevel in the normal'],
        ['flakeVar3', 'Tint variation', 0, 1, 0.05, '', 'Per-plate lightness / warmth jitter around the layer colour'],
        ['flakeShape3', 'Shape', 0, 1, 0.05, '', 'Angular chips → rounded grains'],
        ['flakeCrystal3', 'Crystals', 0, 1, 0.05, '', 'Share of plates that are crystals: brighter, glossy, they glint in the sun'],
        ['flakeReveal3', 'Reveal by hardness', -1, 1, 0.05, '', '−1 only on soft / eroded beds · 0 everywhere · +1 only on hard caprock'],
      ] },
    ],
  },
  {
    id: 'exfoliation', name: 'Spalling', type: 'Sheets flaked off the face', stage: 'live', color: '#c9a37c',
    cards: [
      { title: 'Spalls', controls: [
        ['peelOn', 'Enable spalling', 0, 1, 1, '', 'Irregular patches where a thin sheet has flaked off: a shallow step with a bevelled rim, paler fresh rock inside'],
        ['peelStrength', 'Amount', 0, 1, 0.05, '', ''],
        ['peelCoverage', 'Coverage', 0, 1, 0.05, '', 'Share of the rock face that has spalled'],
        ['peelScale', 'Patch size', 0.2, 12, 0.1, 'm', ''],
        ['peelThickness', 'Sheet thickness', 0, 0.15, 0.005, 'm', 'Height of the step at the patch edge'],
        ['peelSecond', 'Small spalls', 0, 1, 0.05, '', 'Second generation of smaller patches stepping down inside and around the first'],
        ['peelPits', 'Weathering pits', 0, 1, 0.05, '', 'Sparse small holes'],
        ['peelBedding', 'Follow bedding', 0, 1, 0.05, '', 'Stretch patches horizontally along the beds'],
        ['peelFresh', 'Fresh contrast', 0, 1, 0.05, '', 'How pale the freshly exposed rock is'],
        ['peelShadow', 'Rim shadow', 0, 1, 0.05, '', 'Soft darkening in the bevel'],
      ] },
    ],
  },
  {
    id: 'cover', name: 'Ground cover', type: 'Runoff, gravel, plants & snow', stage: 'live', color: '#9fb57a',
    cards: [
      { title: 'Runoff', controls: [
        ['runoffOn', 'Enable runoff', 0, 1, 1, '', ''],
        ['wetness', 'Wetness', 0, 1, 0.05, '', 'Dark wet staining along drainage'],
        ['streakAmount', 'Face streaks', 0, 1, 0.05, '', 'Vertical water streaks down the faces'],
        ['streakScale', 'Streak scale', 1, 30, 0.5, 'm', 'Spacing of the streaks'],
      ] },
      { title: 'Gravel', controls: [
        ['gravelOn', 'Enable gravel', 0, 1, 1, '', ''],
        ['gravelAmount', 'Gravel on scree', 0, 1, 0.05, '', 'Fine debris texture where sediment collected'],
        ['gravelScale', 'Stone size', 0.03, 1.5, 0.01, 'm', 'Largest pebbles; a second generation at 0.45× fills the gaps'],
        ['gravelRelief', 'Stone relief', 0, 1, 0.05, '', 'Dome normal on each stone'],
        ['gravelVariation', 'Stone variation', 0, 1, 0.05, '', 'Tone and warmth jitter per stone'],
        ['gravelColor', 'Stone colour', 0, 0, 0, 'color', 'Matrix between the stones is a mix of this and the silt colour'],
      ] },
      { title: 'Vegetation', controls: [
        ['vegOn', 'Enable vegetation', 0, 1, 1, '', ''],
        ['vegetation', 'Vegetation', 0, 1, 0.05, '', 'Grass and scrub on gentle ground'],
        ['vegSlope', 'Slope limit', 15, 70, 1, '°', 'Steeper ground stays bare'],
        ['vegScale', 'Patch scale', 4, 80, 1, 'm', ''],
        ['vegPatchiness', 'Patchiness', 0, 1, 0.05, '', 'Broken patches vs. continuous cover'],
        ['dryness', 'Dry grass', 0, 1, 0.05, '', 'Mix in dry straw patches'],
        ['grassA', 'Grass', 0, 0, 0, 'color', ''],
        ['grassB', 'Grass · pale', 0, 0, 0, 'color', ''],
        ['dryColor', 'Dry grass', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Moss', controls: [
        ['mossOn', 'Enable moss', 0, 1, 1, '', ''],
        ['mossiness', 'Moss on rock', 0, 1, 0.05, '', 'Lichen and moss in sheltered cracks'],
        ['mossScale', 'Moss scale', 0.5, 20, 0.5, 'm', ''],
        ['mossColor', 'Moss colour', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Snow', controls: [
        ['snowOn', 'Enable snow', 0, 1, 1, '', ''],
        ['snowLine', 'Snow line', 0, 5000, 10, 'm', 'Snow settles above this elevation'],
        ['snowSlope', 'Slope limit', 10, 80, 1, '°', 'Steeper faces shed snow'],
        ['snowSoftness', 'Transition', 0.1, 3, 0.1, '', 'Width of the snow-line band'],
        ['snowRoughness', 'Snow roughness', 0.3, 1, 0.05, '', ''],
        ['snowColor', 'Snow colour', 0, 0, 0, 'color', ''],
      ] },
    ],
  },
  {
    id: 'sun', name: 'Sun & atmosphere', type: 'Lighting', stage: 'live', color: '#e8b65f',
    cards: [
      { title: 'Sun direction', controls: [
        ['sunAzimuth', 'Azimuth', 0, 360, 1, '°', ''],
        ['sunElevation', 'Elevation', 2, 80, 1, '°', 'Low sun rakes the cliff faces'],
      ] },
      { title: 'Atmosphere', controls: [
        ['turbidity', 'Turbidity', 1, 12, 0.5, '', 'Haze and aerosol density'],
        ['fogDensity', 'Valley fog', 0, 1, 0.05, '', 'Distance haze strength'],
        ['exposure', 'Exposure', 0.1, 1.5, 0.05, '', ''],
      ] },
    ],
  },
  {
    id: 'water', name: 'Water', type: 'Sea level & water bodies', stage: 'live', color: '#5aa7c9',
    cards: [
      { title: 'Sea level', controls: [
        ['waterEnabled', 'Sea', 0, 1, 1, '', 'Global water plane'],
        ['seaLevel', 'Sea level', -200, 800, 1, 'm', 'Everything below this is flooded — live'],
      ] },
      { title: 'Appearance', controls: [
        ['waterColor', 'Water colour', 0, 0, 0, 'color', ''],
        ['waterOpacity', 'Opacity', 0.2, 1, 0.05, '', ''],
        ['shoreWet', 'Shoreline wetness', 0, 1, 0.05, '', 'Dark wet band just above the waterline'],
        ['bedShading', 'Bed shading', 0, 1, 1, '', 'Silt / cobble shading on river and lake beds'],
        ['siltColor', 'Silt colour', 0, 0, 0, 'color', ''],
      ] },
    ],
  },
  {
    id: 'viewport', name: 'Viewport', type: 'Display & export', stage: 'live', color: '#99aafa',
    cards: [
      { title: 'Display', controls: [
        ['wireframe', 'Wireframe', 0, 1, 1, '', ''],
        ['showRocks', 'Show rocks', 0, 1, 1, '', ''],
        ['autoRotate', 'Auto-rotate', 0, 1, 1, '', ''],
      ] },
      { title: 'Isolate layer', controls: [
        ['debugView', 'Show only', 0, 8, 1, 'enum', 'Off|Strata|Grain|Flakes|Spalls|Pebbles|Cover|Masks|Features'],
      ] },
      { title: 'Export', kind: 'export' },
    ],
  },
];

export const outlinerSections = [
  { label: 'TERRAIN', ids: ['landform', 'strata', 'rugged', 'relief', 'erosion', 'features'] },
  { label: 'DRESSING', ids: ['rocks', 'material', 'flakes', 'exfoliation', 'cover'] },
  { label: 'ENVIRONMENT', ids: ['sun', 'water', 'viewport'] },
];

export function paramsForStage(values, stage) {
  const keys = new Set();
  for (const g of groups) for (const c of g.cards) if ((c.stage || g.stage) === stage) for (const ctl of c.controls || []) keys.add(ctl[0]);
  const out = {};
  for (const k of keys) out[k] = values[k];
  return out;
}

export function stageOf(key) {
  for (const g of groups) for (const c of g.cards) for (const ctl of c.controls || []) if (ctl[0] === key) return c.stage || g.stage;
  if (key === 'palette') return 'live';
  if (key === 'features') return 'mesh';
  return 'terrain';
}

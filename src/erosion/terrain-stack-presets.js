/**
 * Non-Destructive Geological & SDF Terrain Layer Stack Model and Preset Library.
 *
 * Unifies the 19 battle-tested geological generators, parameters, and seeds (`seed: 4029`)
 * from `erosion-presets.js` with a true bottom-to-top composable Layer Stack pipeline:
 *   - Newest / final operations sit at the TOP of the UI (index 0) and evaluate LAST.
 *   - Base landform sits at the BOTTOM of the UI (index length - 1) and evaluates FIRST.
 *   - Surface palette, rock fabric, view modes, sun angles, and particle display stay
 *     separate from the Layer Stack (zero fake colour/biome layers in the stack).
 */

import {
  DEFAULT_EROSION_PARAMS,
  EROSION_LANDSCAPES,
  MATERIAL_THEMES,
  ROCK_FABRIC_MODES,
  getVegetationDefaultsForLandscape,
} from './erosion-presets.js';

let layerUidCounter = 1;

export function nextLayerId(prefix = 'lyr') {
  return `${prefix}-${layerUidCounter++}`;
}

export const LAYER_CATEGORIES = {
  landform: {
    id: 'landform',
    label: 'Landform & SDF',
    eyebrow: 'LANDFORM / SDF OPERATION',
    color: '#c9b38c',
  },
  simulation: {
    id: 'simulation',
    label: 'Simulation',
    eyebrow: 'SIMULATION PROCESS',
    color: '#8ab49a',
  },
  spline: {
    id: 'spline',
    label: 'Spline Feature',
    eyebrow: 'SPATIAL SPLINE OPERATION',
    color: '#88acc4',
  },
  rocks: {
    id: 'rocks',
    label: 'Rock Placement',
    eyebrow: 'ROCK & BOULDER LAYER',
    color: '#b89f8d',
  },
  vegetation: {
    id: 'vegetation',
    label: 'Vegetation',
    eyebrow: 'PLANT & FOLIAGE LAYER',
    color: '#93b87e',
  },
};

export const DEFAULT_LAYER_MASK = {
  enabled: false,
  mode: 'height', // 'height' | 'slope' | 'flow' | 'concavity' | 'radial' | 'noise'
  min: 0.20,
  max: 0.85,
  feather: 0.15,
  invert: false,
  scale: 2.2,
  seed: 1337,
};

/**
 * All 19 proven `INIT_TERRAIN_FRAG` geological landform generators (`terrainType = 0..18`),
 * keyed by `terrainType` so `base-landform` executes the exact `c5ae88b` / `2cc3d34` generator!
 */
export const BASE_ARCHETYPES = {};
for (const preset of Object.values(EROSION_LANDSCAPES)) {
  BASE_ARCHETYPES[preset.terrainType] = {
    id: preset.terrainType,
    presetId: preset.id,
    label: preset.name,
  };
}

export const COMBINE_MODES = {
  0: { id: 0, label: 'Add (Uplift)' },
  1: { id: 1, label: 'Subtract (Excavate)' },
  2: { id: 2, label: 'Max (Union)' },
  3: { id: 3, label: 'Min (Clip)' },
  4: { id: 4, label: 'Blend (Lerp)' },
};

export const SPLINE_MODES = {
  0: { id: 0, label: 'Canyon Gorge Cut' },
  1: { id: 1, label: 'Graded Road / Terrace' },
  2: { id: 2, label: 'Lake Basin Boundary' },
};

export const VEG_SPECIES = {
  0: { id: 0, label: 'Alpine Green Grass' },
  1: { id: 1, label: 'Dry Steppe / Desert Grass' },
  2: { id: 2, label: 'Biome Moisture Auto-Blend' },
};

/**
 * All 10 regional geological surface palettes from `MATERIAL_THEMES` (`0..9`),
 * kept strictly separate from the Layer Stack.
 */
export const DERIVED_PALETTES = {};
for (const [k, theme] of Object.entries(MATERIAL_THEMES)) {
  const id = Number(k);
  DERIVED_PALETTES[id] = {
    id,
    label: theme.name,
    subtitle: theme.subtitle,
  };
}

export const DERIVED_FABRICS = {};
for (const [k, fab] of Object.entries(ROCK_FABRIC_MODES)) {
  const id = Number(k);
  DERIVED_FABRICS[id] = {
    id,
    label: fab.name,
  };
}

/**
 * Complete registry of composable Terrain Stack Operations.
 * Each operation declares what terrain channels it READS and what it WRITES.
 */
export const LAYER_OPERATION_SPECS = {
  'base-landform': {
    type: 'base-landform',
    category: 'landform',
    defaultName: 'Base landform',
    glyph: 'mountain',
    lockedPosition: false,
    reads: ['Domain XZ', 'Seed'],
    writes: ['Height', 'Sediment', 'Water'],
    summary: (p) => `${BASE_ARCHETYPES[p.archetype]?.label || 'Icelandic Highlands'} · ${Math.round(p.relief)}m · #${p.seed}`,
    defaults: {
      archetype: 6, // 0..18 -> exact `INIT_TERRAIN_FRAG` terrainType!
      seed: DEFAULT_EROSION_PARAMS.seed, // 4029
      relief: DEFAULT_EROSION_PARAMS.relief, // 168
      roughness: DEFAULT_EROSION_PARAMS.roughness, // 0.68
    },
  },

  'mountain-ridges': {
    type: 'mountain-ridges',
    category: 'landform',
    defaultName: 'Procedural landform',
    glyph: 'ridge',
    reads: ['Height', 'Mask'],
    writes: ['Height', 'FineSed'],
    summary: (p) => `${COMBINE_MODES[p.combineMode]?.label || 'Add'} · ${Math.round(p.amplitude)}m`,
    defaults: {
      generator: 0, // 0=Arête Ridges, 1=Mesa/Plateau, 2=Fault Escarpment, 3=Aeolian Dunes, 4=Impact Craters
      combineMode: 0, // 0=Add, 1=Subtract, 2=Max, 3=Min, 4=Blend
      amplitude: 48,
      scale: 2.2,
      sharpness: 0.60,
      azimuth: 28,
      opacity: 1.0,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },

  'stratigraphic-beds': {
    type: 'stratigraphic-beds',
    category: 'landform',
    defaultName: 'Stratigraphic beds',
    glyph: 'strata',
    reads: ['Height', '3D Strata'],
    writes: ['3D Hardness', 'Height', 'Overhang'],
    summary: (p) => `${Number(p.strataFreq).toFixed(1)} beds · dip ${Math.round(p.strataDip)}° · hard ${Math.round(p.rockHardness * 100)}%`,
    defaults: {
      rockHardness: DEFAULT_EROSION_PARAMS.rockHardness,
      strataStrength: DEFAULT_EROSION_PARAMS.strataStrength,
      strataFreq: DEFAULT_EROSION_PARAMS.strataFreq,
      strataDip: DEFAULT_EROSION_PARAMS.strataDip,
      strataStrike: DEFAULT_EROSION_PARAMS.strataStrike,
      faultWeakness: DEFAULT_EROSION_PARAMS.faultWeakness,
      terraceCarve: 0.0,
      ledgeOverhang: 0.0,
      opacity: 1.0,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },

  'rock-stacks': {
    type: 'rock-stacks',
    category: 'landform',
    defaultName: 'Rock stacks & hoodoos',
    glyph: 'stacks',
    reads: ['Height', 'Slope', 'Mask'],
    writes: ['Height', '3D Overhang'],
    summary: (p) => `${Math.round(p.height)}m · ${Math.round(p.tiers)} tiers`,
    defaults: {
      height: 48,
      spacing: 68,
      radius: 15,
      taper: 0.42,
      tiers: 5,
      lean: 0.28,
      leanAzimuth: 35,
      caprockOverhang: 0.45,
      opacity: 1.0,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },

  'cliff-push-pull': {
    type: 'cliff-push-pull',
    category: 'landform',
    defaultName: 'Rugged cliff push–pull',
    glyph: 'cliff',
    reads: ['Height', 'Slope', 'Hardness'],
    writes: ['Height', '3D Overhang'],
    summary: (p) => `${Number(p.displacement).toFixed(1)}m · >${Math.round(p.slopeThreshold)}°`,
    defaults: {
      displacement: 10.5,
      featureScale: 2.6,
      slopeThreshold: 28,
      ledgeStrength: 0.62,
      overhangBias: 0.52,
      verticalCrease: 0.58,
      opacity: 1.0,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },

  'sculpt-layer': {
    type: 'sculpt-layer',
    category: 'landform',
    defaultName: 'SDF sculpt layer',
    glyph: 'sculpt',
    reads: ['Height', 'SDF Caves', 'Brush'],
    writes: ['Height', 'SDF Caves'],
    summary: (p) => `${p.strokeCount || 0} edits · ${Math.round((p.opacity ?? 1) * 100)}%`,
    defaults: {
      opacity: 1.0,
      brushOp: 'add', // 'add' | 'remove' | 'smooth' | 'cave-carve' | 'cave-fill'
      brushRadius: 34,
      brushStrength: 0.72,
      caveHeightOffset: 8.0,
      strokeCount: 0,
    },
  },

  'sdf-caves': {
    type: 'sdf-caves',
    category: 'landform',
    defaultName: 'SDF caves & undercuts',
    glyph: 'cave',
    reads: ['Height', 'Slope', 'Hardness'],
    writes: ['3D SDF Volume', 'Cave Mesh'],
    summary: (p) => `${Math.round(p.carveDepth)}m depth · ${Math.round(p.archHeight)}m arch`,
    defaults: {
      carveDepth: 24,
      archHeight: 16,
      tunnelScale: 2.3,
      elevationCenter: 0.36,
      elevationBand: 0.28,
      slopeMin: 24,
      undercutStrength: 0.68,
      ribRoughness: 0.52,
      opacity: 1.0,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },

  'spline-feature': {
    type: 'spline-feature',
    category: 'spline',
    defaultName: 'Spline canyon / road',
    glyph: 'spline',
    reads: ['Height', 'Control Path'],
    writes: ['Height', 'Water'],
    summary: (p) => `${SPLINE_MODES[p.mode]?.label || 'Canyon Cut'} · ${Math.round(p.width)}m`,
    defaults: {
      mode: 0, // 0=Canyon Cut, 1=Graded Mountain Road, 2=Hydrostatic Lake Basin
      width: 44,
      depth: 48,
      wallSteepness: 0.74,
      meanderAmp: 0.32,
      waterFill: 0.28,
      bankFalloff: 0.55,
      opacity: 1.0,
      points: [
        [-190, -145],
        [-72, -38],
        [48, 26],
        [188, 152],
      ],
    },
  },

  'river-incision': {
    type: 'river-incision',
    category: 'simulation',
    defaultName: 'River incision & drainage',
    glyph: 'river',
    reads: ['Height', '3D Hardness'],
    writes: ['Height', 'Flow', 'Water'],
    summary: (p) => `${Math.round(p.iterations)} steps · cut ${Math.round(p.incisionStrength * 100)}%`,
    defaults: {
      iterations: 20,
      incisionStrength: 0.85,
      headwaterRain: 0.68,
      basinPooling: 0.45,
      hardnessRespect: 0.80,
    },
  },

  'hydraulic-erosion': {
    type: 'hydraulic-erosion',
    category: 'simulation',
    defaultName: 'Hydraulic erosion',
    glyph: 'droplet',
    reads: ['Height', '3D Hardness', 'Water'],
    writes: ['Height', 'Sediment', 'Flow'],
    summary: (p) =>
      (p.bakeSteps > 0 ? `${Math.round(p.bakeSteps)} baked + live` : 'Live GPU sim') +
      ` · rain ${Math.round((p.rainIntensity ?? 0.68) * 100)}% · erod ${Math.round((p.erosionStrength ?? 0.70) * 100)}%`,
    defaults: {
      bakeSteps: 0,
      rainIntensity: DEFAULT_EROSION_PARAMS.rainIntensity,
      erosionStrength: DEFAULT_EROSION_PARAMS.erosionStrength,
      sedimentCapacity: DEFAULT_EROSION_PARAMS.sedimentCapacity,
      depositionRate: DEFAULT_EROSION_PARAMS.depositionRate,
      evaporation: DEFAULT_EROSION_PARAMS.evaporation,
      headwaterFlow: DEFAULT_EROSION_PARAMS.headwaterFlow,
      lakeRetention: DEFAULT_EROSION_PARAMS.lakeRetention,
      oasisSpring: 0,
    },
  },

  'thermal-talus': {
    type: 'thermal-talus',
    category: 'simulation',
    defaultName: 'Thermal erosion & talus',
    glyph: 'talus',
    reads: ['Height', '3D Hardness'],
    writes: ['Height', 'Coarse Talus'],
    summary: (p) => {
      const deg = Math.round((Math.atan(p.talusAngle ?? 0.58) * 180) / Math.PI);
      return `${p.bakePasses > 0 ? `${Math.round(p.bakePasses)} baked · ` : ''}${deg}° repose · spall ${Math.round((p.rockfallRate ?? 0.45) * 100)}%`;
    },
    defaults: {
      bakePasses: 0,
      talusAngle: DEFAULT_EROSION_PARAMS.talusAngle, // slope tangent (0.58 ≈ 30°)
      rockfallRate: DEFAULT_EROSION_PARAMS.rockfallRate,
    },
  },

  'aeolian-glacial': {
    type: 'aeolian-glacial',
    category: 'simulation',
    defaultName: 'Glacial / wind process',
    glyph: 'wind',
    reads: ['Height', 'FineSed'],
    writes: ['Height', 'FineSed', 'SnowIce'],
    summary: (p) =>
      (p.dryAeolianMode ?? 0) > 0.4
        ? `Aeolian wind ${Math.round((p.windSpeed ?? 0.58) * 100)}% · ${Math.round(p.windAzimuth ?? 35)}°`
        : `Snowline ${Math.round((p.snowline ?? 0.42) * 100)}% · ice ${Math.round((p.glacierStrength ?? 0.74) * 100)}%`,
    defaults: {
      bakePasses: 0,
      snowline: DEFAULT_EROSION_PARAMS.snowline,
      snowfallRate: DEFAULT_EROSION_PARAMS.snowfallRate,
      glacierStrength: DEFAULT_EROSION_PARAMS.glacierStrength,
      iceMeltRate: DEFAULT_EROSION_PARAMS.iceMeltRate,
      windSpeed: DEFAULT_EROSION_PARAMS.windSpeed,
      windAzimuth: DEFAULT_EROSION_PARAMS.windAzimuth,
      dryAeolianMode: DEFAULT_EROSION_PARAMS.dryAeolianMode,
    },
  },

  'rock-placement': {
    type: 'rock-placement',
    category: 'rocks',
    defaultName: 'Distributed rocks & boulders',
    glyph: 'boulders',
    reads: ['Height', 'Slope', 'Coarse Talus', 'Water'],
    writes: ['3D Rock Instances'],
    summary: (p) => `${Math.round((p.density ?? 0.65) * 100)}% density · #${p.seed ?? 4029}`,
    defaults: {
      density: DEFAULT_EROSION_PARAMS.boulderDensity,
      talusAffinity: DEFAULT_EROSION_PARAMS.rockfallRate,
      settleSteps: 0,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },

  'vegetation-placement': {
    type: 'vegetation-placement',
    category: 'vegetation',
    defaultName: '3D grass & plants',
    glyph: 'grass',
    reads: ['Height', 'Slope', 'Water', 'Sediment', 'SnowIce'],
    writes: ['3D Plant Instances'],
    summary: (p) => `${VEG_SPECIES[p.species]?.label || 'Green Grass'} · ${Math.round((p.density ?? 0.55) * 100)}%`,
    defaults: {
      species: DEFAULT_EROSION_PARAMS.grassMode,
      density: DEFAULT_EROSION_PARAMS.grassDensity,
      bladeHeight: DEFAULT_EROSION_PARAMS.grassHeight,
      slopeMax: DEFAULT_EROSION_PARAMS.grassSlopeMax, // slope tangent (0.62 ≈ 32°)
      elevationMax: DEFAULT_EROSION_PARAMS.grassElevMax,
      patchiness: DEFAULT_EROSION_PARAMS.grassPatchiness,
      windSway: DEFAULT_EROSION_PARAMS.grassWindSway,
      dryBlend: DEFAULT_EROSION_PARAMS.grassDryBlend,
      seed: DEFAULT_EROSION_PARAMS.seed,
    },
  },
};

export function createStackLayer(type, overrides = {}) {
  const spec = LAYER_OPERATION_SPECS[type];
  if (!spec) throw new Error(`Unknown terrain layer operation: ${type}`);
  const { name, enabled = true, locked = false, mask, params = {}, ...restParams } = overrides;
  return {
    id: nextLayerId(type.slice(0, 4)),
    type,
    name: name || spec.defaultName,
    enabled,
    locked,
    mask: { ...DEFAULT_LAYER_MASK, ...(mask || {}) },
    params: {
      ...structuredClone(spec.defaults),
      ...structuredClone(restParams),
      ...structuredClone(params),
    },
  };
}

/**
 * Decomposes any of the 19 canonical `EROSION_LANDSCAPES` (`erosion-presets.js`) into its exact
 * bottom-to-top editable Layer Stack (index 0 = TOP / evaluated LAST, last index = BOTTOM / evaluated FIRST)
 * while preserving 100% identical generator parameters, seed (`4029`), and simulation behavior!
 */
function buildStackRecipeFromLandscape(landscapeId) {
  const preset = EROSION_LANDSCAPES[landscapeId];
  const d = { ...DEFAULT_EROSION_PARAMS, ...(preset.defaults || {}) };
  const veg = getVegetationDefaultsForLandscape(landscapeId);
  const seed = d.seed ?? 4029;

  const layers = []; // Push TOP -> BOTTOM

  // 1. Top: 3D Grass Vegetation Placement (enabled on biomes with grass)
  if (veg.grassEnabled) {
    layers.push(
      createStackLayer('vegetation-placement', {
        name: veg.grassMode === 1 ? 'Dry desert / canyon grass' : veg.grassMode === 2 ? 'Biome-blended 3D turf' : 'Lush highland 3D turf',
        species: veg.grassMode,
        density: veg.grassDensity,
        bladeHeight: veg.grassHeight,
        slopeMax: veg.grassSlopeMax,
        elevationMax: veg.grassElevMax,
        patchiness: veg.grassPatchiness,
        windSway: DEFAULT_EROSION_PARAMS.grassWindSway,
        dryBlend: veg.grassDryBlend,
        seed,
      })
    );
  }

  // 2. 3D Polyhedral Outcrops & Calved Cliff Boulders
  layers.push(
    createStackLayer('rock-placement', {
      name: '3D outcrops & talus boulders',
      enabled: d.showOutcrops !== false,
      density: d.boulderDensity ?? DEFAULT_EROSION_PARAMS.boulderDensity,
      talusAffinity: d.rockfallRate ?? DEFAULT_EROSION_PARAMS.rockfallRate,
      settleSteps: 0,
      seed,
    })
  );

  // 3. Cryosphere Snow/Glaciers & Aeolian Wind Process (when active in preset)
  const hasCryoOrWind =
    (d.snowfallRate ?? 0) > 0.015 ||
    (d.glacierStrength ?? 0) > 0.015 ||
    (d.windSpeed ?? 0) > 0.04;
  if (hasCryoOrWind) {
    const isDryWind = (d.dryAeolianMode ?? 0) > 0.4;
    layers.push(
      createStackLayer('aeolian-glacial', {
        name: isDryWind ? 'Aeolian sand saltation & wind' : 'Snowpack, glaciers & mountain wind',
        bakePasses: 0,
        snowline: d.snowline,
        snowfallRate: d.snowfallRate,
        glacierStrength: d.glacierStrength,
        iceMeltRate: d.iceMeltRate,
        windSpeed: d.windSpeed,
        windAzimuth: d.windAzimuth,
        dryAeolianMode: d.dryAeolianMode,
      })
    );
  }

  // 4. Thermal Cliff Spalling & Talus Scree Repose (when active in preset)
  if ((d.rockfallRate ?? 0) > 0.015) {
    layers.push(
      createStackLayer('thermal-talus', {
        name: 'Cliff spalling & talus repose',
        bakePasses: 0,
        talusAngle: d.talusAngle,
        rockfallRate: d.rockfallRate,
      })
    );
  }

  // 5. Hydraulic Rain, Shallow-Water Pipe Flow & Alluvial Sedimentation (when active in preset)
  const hasHydro =
    (d.rainIntensity ?? 0) > 0.005 ||
    (d.headwaterFlow ?? 0) > 0.005 ||
    Boolean(d.oasisSpring);
  if (hasHydro) {
    layers.push(
      createStackLayer('hydraulic-erosion', {
        name: d.oasisSpring ? 'Artesian oasis spring & hydrology' : (d.headwaterFlow ?? 0) > 0.25 ? 'River discharge & hydraulic erosion' : 'Hydraulic rain & alluvial runoff',
        bakeSteps: 0,
        rainIntensity: d.rainIntensity,
        erosionStrength: d.erosionStrength,
        sedimentCapacity: d.sedimentCapacity,
        depositionRate: d.depositionRate,
        evaporation: d.evaporation,
        headwaterFlow: d.headwaterFlow ?? 0,
        lakeRetention: d.lakeRetention ?? 0.4,
        oasisSpring: d.oasisSpring ? 1 : 0,
      })
    );
  }

  // 6. 3D Stratigraphic Bedding & Differential Rock Hardness
  layers.push(
    createStackLayer('stratigraphic-beds', {
      name: '3D stratigraphy & rock hardness',
      rockHardness: d.rockHardness,
      strataStrength: d.strataStrength,
      strataFreq: d.strataFreq,
      strataDip: d.strataDip,
      strataStrike: d.strataStrike,
      faultWeakness: d.faultWeakness,
      terraceCarve: 0.0,
      ledgeOverhang: 0.0,
      opacity: 1.0,
      seed,
    })
  );

  // 7. Bottom Foundation: Exact `INIT_TERRAIN_FRAG` Landform Generator (`terrainType` 0..18, `seed: 4029`)
  layers.push(
    createStackLayer('base-landform', {
      name: `${preset.name} base`,
      archetype: preset.terrainType,
      seed,
      relief: d.relief,
      roughness: d.roughness,
    })
  );

  return {
    id: preset.id,
    name: preset.name,
    subtitle: preset.subtitle,
    category: preset.category,
    terrainType: preset.terrainType,
    palette: preset.materialTheme ?? 0,
    fabricMode: d.fabricMode ?? 0,
    emitterMode: d.emitterMode ?? DEFAULT_EROSION_PARAMS.emitterMode,
    particleCount: d.particleCount ?? DEFAULT_EROSION_PARAMS.particleCount,
    particleInertia: d.particleInertia ?? DEFAULT_EROSION_PARAMS.particleInertia,
    pipeFlowBlend: d.pipeFlowBlend ?? DEFAULT_EROSION_PARAMS.pipeFlowBlend,
    sunAzimuth: d.sunAzimuth ?? DEFAULT_EROSION_PARAMS.sunAzimuth,
    sunElevation: d.sunElevation ?? DEFAULT_EROSION_PARAMS.sunElevation,
    showWater: d.showWater ?? true,
    showParticles: d.showParticles ?? true,
    layers: () => structuredClone(layers).map((l) => ({ ...l, id: nextLayerId(l.type.slice(0, 4)) })),
  };
}

/**
 * Curated showcase order across all 19 original `EROSION_LANDSCAPES` (`icelandic-highlands` default first!).
 */
const PRESET_ORDER = [
  'icelandic-highlands',
  'himalayan-karakoram',
  'grand-canyon',
  'studlagil-basalt',
  'fjadrargljufur-palagonite',
  'icelandic-green-highlands',
  'namib-erg-dunes',
  'sahara-tassili-erg',
  'desert-oasis-erg',
  'rugged-desert-crags',
  'yardang-wind-corridor',
  'glacial-lake-watershed',
  'lunar-mare-craters',
  'layered-plateau',
  'alpine-divide',
  'fault-escarpment',
  'volcanic-caldera',
  'badlands-domes',
  'coastal-massif',
];

export const TERRAIN_STACK_PRESETS = {};
for (const id of PRESET_ORDER) {
  if (EROSION_LANDSCAPES[id]) {
    TERRAIN_STACK_PRESETS[id] = buildStackRecipeFromLandscape(id);
  }
}
for (const id of Object.keys(EROSION_LANDSCAPES)) {
  if (!TERRAIN_STACK_PRESETS[id]) {
    TERRAIN_STACK_PRESETS[id] = buildStackRecipeFromLandscape(id);
  }
}

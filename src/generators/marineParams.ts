/**
 * Sea Plants & Marine Benthic Species Parameters, Species Profiles & Curated Reef Palettes.
 *
 * Covers 10 sculpted marine macroalgae, seagrasses, corals, gorgonians,
 * sea anemones, hollow tube sponges, and reef crinoid feather stars:
 *   A. SEA PLANTS (Marine Macroalgae & Seagrasses):
 *      - `giant_kelp`       : Macrocystis pyrifera · haptera holdfast, buoyant stipes, pyriform gas bladders & corrugated blades
 *      - `bull_kelp`        : Nereocystis luetkeana · slender whip stipe, floating spherical bulb & trailing ribbon crown
 *      - `neptune_seagrass` : Posidonia oceanica · creeping scaly rhizomes, fibrous sheaths & dense multi-veined emerald straps
 *      - `sargassum_weed`   : Sargassum horneri · zigzag thallus branches, serrated lanceolate blades & stalked berry vesicles
 *      - `sea_lettuce_ulva` : Ulva lactuca · hyperbolic-ruffled translucent emerald-jade foliose rosette lobes
 *   B. SEA SPECIES (Corals, Gorgonians, Anemones, Sponges & Echinoderms):
 *      - `staghorn_coral`   : Acropora cervicornis · watertight 2-manifold calcified antler colony, radial corallites & axial tips
 *      - `gorgonian_sea_fan`: Gorgonia ventalina · planar reticulate sea-fan lattice meshwork & 8-rayed octocoral polyps
 *      - `sea_anemone`      : Entacmaea quadricolor · verrucose pedal column, pleated oral disc & 3D bubble-tip tentacles
 *      - `azure_tube_sponge`: Callyspongia vaginalis · double-walled hollow organ-pipe chimneys with spicule conules & oscular rims
 *      - `feather_star_crinoid`: Comanthina schlegeli · grasping cirri, calyx & overarching pinnate feathery crinoid arms
 */

export type MarineSpecies =
  | 'giant_kelp'
  | 'bull_kelp'
  | 'neptune_seagrass'
  | 'sargassum_weed'
  | 'sea_lettuce_ulva'
  | 'staghorn_coral'
  | 'gorgonian_sea_fan'
  | 'sea_anemone'
  | 'azure_tube_sponge'
  | 'feather_star_crinoid';

export const MARINE_SPECIES_NAMES: Record<MarineSpecies, string> = {
  giant_kelp: 'Giant Bladder Kelp (Macrocystis)',
  bull_kelp: 'Bull Whip Kelp (Nereocystis)',
  neptune_seagrass: 'Neptune Seagrass (Posidonia)',
  sargassum_weed: 'Golden Berry Sargassum',
  sea_lettuce_ulva: 'Ruffled Sea Lettuce (Ulva)',
  staghorn_coral: 'Branching Staghorn Coral (Acropora)',
  gorgonian_sea_fan: 'Reticulate Gorgonian Sea Fan',
  sea_anemone: 'Bubble-Tip Sea Anemone (Entacmaea)',
  azure_tube_sponge: 'Organ-Pipe Azure Tube Sponge',
  feather_star_crinoid: 'Reef Crinoid Feather Star',
};

export type MarineColorPalette =
  | 'pacific_amber_kelp'
  | 'emerald_seagrass'
  | 'jade_tidepool'
  | 'acropora_rose_gold'
  | 'royal_purple_gorgonian'
  | 'biolum_bubble_anemone'
  | 'caribbean_azure_sponge'
  | 'crimson_gold_crinoid'
  | 'abyssal_neon_reef'
  | 'bleached_ivory_reef'
  | 'custom';

export const MARINE_PALETTE_NAMES: Record<MarineColorPalette, string> = {
  pacific_amber_kelp: 'Pacific Golden-Amber Kelp',
  emerald_seagrass: 'Mediterranean Emerald Seagrass',
  jade_tidepool: 'Translucent Tidepool Jade',
  acropora_rose_gold: 'Rose-Gold Staghorn Reef',
  royal_purple_gorgonian: 'Royal Violet & Gold Sea Fan',
  biolum_bubble_anemone: 'Bioluminescent Cyan-Magenta',
  caribbean_azure_sponge: 'Caribbean Cerulean & Turquoise',
  crimson_gold_crinoid: 'Imperial Crimson & Saffron',
  abyssal_neon_reef: 'Abyssal Ultraviolet Biolum',
  bleached_ivory_reef: 'Sunlit Ivory & Peach Reef',
  custom: 'Custom 5-Zone Marine Pigments',
};

export interface MarinePaletteSwatch {
  huePrimary: string;
  hueSecondary: string;
  hueAccent: string;
  hueHoldfast: string;
  huePolyp: string;
}

export const MARINE_PALETTES: Record<Exclude<MarineColorPalette, 'custom'>, MarinePaletteSwatch> = {
  pacific_amber_kelp: {
    huePrimary: '#544a14',
    hueSecondary: '#87721a',
    hueAccent: '#c48d1d',
    hueHoldfast: '#362912',
    huePolyp: '#a87d1c',
  },
  emerald_seagrass: {
    huePrimary: '#196935',
    hueSecondary: '#3da854',
    hueAccent: '#78cf6b',
    hueHoldfast: '#594732',
    huePolyp: '#d99bb5',
  },
  jade_tidepool: {
    huePrimary: '#116633',
    hueSecondary: '#2ca34c',
    hueAccent: '#68cf5f',
    hueHoldfast: '#1f472b',
    huePolyp: '#b5f279',
  },
  acropora_rose_gold: {
    huePrimary: '#d96c75',
    hueSecondary: '#f2a29b',
    hueAccent: '#f7f2ff',
    hueHoldfast: '#8c5360',
    huePolyp: '#ffd166',
  },
  royal_purple_gorgonian: {
    huePrimary: '#6d23b6',
    hueSecondary: '#a844e6',
    hueAccent: '#d27dff',
    hueHoldfast: '#3d1566',
    huePolyp: '#ffcf4d',
  },
  biolum_bubble_anemone: {
    huePrimary: '#11998e',
    hueSecondary: '#38ef7d',
    hueAccent: '#ff2e93',
    hueHoldfast: '#5c2d6e',
    huePolyp: '#ffe66d',
  },
  caribbean_azure_sponge: {
    huePrimary: '#2452bd',
    hueSecondary: '#2cb5e8',
    hueAccent: '#9b6bff',
    hueHoldfast: '#172b69',
    huePolyp: '#5cf2ff',
  },
  crimson_gold_crinoid: {
    huePrimary: '#b81835',
    hueSecondary: '#eb3b5a',
    hueAccent: '#ffbe2e',
    hueHoldfast: '#521024',
    huePolyp: '#ffe066',
  },
  abyssal_neon_reef: {
    huePrimary: '#1a4fff',
    hueSecondary: '#00f0ff',
    hueAccent: '#ff2bd6',
    hueHoldfast: '#1b1452',
    huePolyp: '#7dff6b',
  },
  bleached_ivory_reef: {
    huePrimary: '#d9cfc1',
    hueSecondary: '#f5ece0',
    hueAccent: '#ffb8a8',
    hueHoldfast: '#8f8478',
    huePolyp: '#ffe5b4',
  },
};

export interface MarineParams {
  species: MarineSpecies;
  colorPalette: MarineColorPalette;
  /** 1 = Preview, 2 = Standard, 3 = Hero, 4 = Cinema Ultra. */
  detailTier: number;
  /** Overall vertical height / span of the specimen or colony in metres. */
  colonyHeight: number;
  /** Number of stipes, shoots, sponge chimneys, coral main stems, or anemone rings. */
  colonyCount: number;
  /** Horizontal spread / fan width / tentacle crown flare [0.2..2.2]. */
  canopySpread: number;
  /** Characteristic length of blades, straps, tentacles, or arms in metres. */
  organLength: number;
  /** Characteristic width / thickness ratio of blades, tubes, or tentacles [0.04..0.85]. */
  organWidth: number;
  /** Density multiplier for blades, tentacles, pinnules, or lattice bars [0.35..2.0]. */
  organDensity: number;
  /** Marginal ruffling, bullate blade corrugation, or bubble-tip inflation [0..1]. */
  ruffleWave: number;
  /** Abundance of gas bladders (pneumatocysts), polyps, conules, or epiphytes [0..1.5]. */
  vesicleAbundance: number;
  /** Branching / lattice subdivision complexity [1..4]. */
  branchOrder: number;
  /** Prevailing ocean current lean angle in degrees [0..48]. */
  currentLeanDeg: number;
  /** Underwater surge / wave sway compliance [0..2]. */
  currentSway: number;
  /** Subsurface light transmission through wet thallus / tentacles [0..1]. */
  translucency: number;
  // 5-zone marine pigments
  huePrimary: string;
  hueSecondary: string;
  hueAccent: string;
  hueHoldfast: string;
  huePolyp: string;
}

export const DEFAULT_MARINE_PARAMS: MarineParams = {
  species: 'giant_kelp',
  colorPalette: 'pacific_amber_kelp',
  detailTier: 3,
  colonyHeight: 3.4,
  colonyCount: 5,
  canopySpread: 0.95,
  organLength: 0.72,
  organWidth: 0.22,
  organDensity: 1.0,
  ruffleWave: 0.72,
  vesicleAbundance: 1.0,
  branchOrder: 2,
  currentLeanDeg: 16,
  currentSway: 1.05,
  translucency: 0.68,
  ...MARINE_PALETTES.pacific_amber_kelp,
};

export const MARINE_SPECIES_PROFILES: Record<MarineSpecies, Partial<MarineParams>> = {
  giant_kelp: {
    colorPalette: 'pacific_amber_kelp',
    colonyHeight: 3.4,
    colonyCount: 5,
    canopySpread: 0.95,
    organLength: 0.72,
    organWidth: 0.22,
    organDensity: 1.0,
    ruffleWave: 0.72,
    vesicleAbundance: 1.0,
    branchOrder: 2,
    currentLeanDeg: 16,
    currentSway: 1.05,
    translucency: 0.68,
    ...MARINE_PALETTES.pacific_amber_kelp,
  },
  bull_kelp: {
    colorPalette: 'pacific_amber_kelp',
    colonyHeight: 3.1,
    colonyCount: 3,
    canopySpread: 1.05,
    organLength: 1.35,
    organWidth: 0.14,
    organDensity: 1.05,
    ruffleWave: 0.52,
    vesicleAbundance: 1.0,
    branchOrder: 2,
    currentLeanDeg: 22,
    currentSway: 1.15,
    translucency: 0.64,
    ...MARINE_PALETTES.pacific_amber_kelp,
  },
  neptune_seagrass: {
    colorPalette: 'emerald_seagrass',
    colonyHeight: 1.05,
    colonyCount: 16,
    canopySpread: 1.15,
    organLength: 0.88,
    organWidth: 0.08,
    organDensity: 1.15,
    ruffleWave: 0.24,
    vesicleAbundance: 0.55,
    branchOrder: 2,
    currentLeanDeg: 18,
    currentSway: 1.10,
    translucency: 0.58,
    ...MARINE_PALETTES.emerald_seagrass,
  },
  sargassum_weed: {
    colorPalette: 'pacific_amber_kelp',
    colonyHeight: 1.65,
    colonyCount: 6,
    canopySpread: 0.92,
    organLength: 0.24,
    organWidth: 0.24,
    organDensity: 1.1,
    ruffleWave: 0.68,
    vesicleAbundance: 1.25,
    branchOrder: 3,
    currentLeanDeg: 12,
    currentSway: 0.95,
    translucency: 0.62,
    ...MARINE_PALETTES.pacific_amber_kelp,
  },
  sea_lettuce_ulva: {
    colorPalette: 'jade_tidepool',
    colonyHeight: 0.58,
    colonyCount: 11,
    canopySpread: 1.12,
    organLength: 0.48,
    organWidth: 0.68,
    organDensity: 1.05,
    ruffleWave: 0.88,
    vesicleAbundance: 0.35,
    branchOrder: 2,
    currentLeanDeg: 8,
    currentSway: 0.88,
    translucency: 0.78,
    ...MARINE_PALETTES.jade_tidepool,
  },
  staghorn_coral: {
    colorPalette: 'acropora_rose_gold',
    colonyHeight: 1.18,
    colonyCount: 4,
    canopySpread: 1.15,
    organLength: 0.42,
    organWidth: 0.16,
    organDensity: 1.05,
    ruffleWave: 0.45,
    vesicleAbundance: 1.1,
    branchOrder: 3,
    currentLeanDeg: 4,
    currentSway: 0.12,
    translucency: 0.28,
    ...MARINE_PALETTES.acropora_rose_gold,
  },
  gorgonian_sea_fan: {
    colorPalette: 'royal_purple_gorgonian',
    colonyHeight: 1.38,
    colonyCount: 2,
    canopySpread: 1.28,
    organLength: 0.95,
    organWidth: 0.12,
    organDensity: 1.1,
    ruffleWave: 0.36,
    vesicleAbundance: 1.0,
    branchOrder: 3,
    currentLeanDeg: 8,
    currentSway: 0.62,
    translucency: 0.34,
    ...MARINE_PALETTES.royal_purple_gorgonian,
  },
  sea_anemone: {
    colorPalette: 'biolum_bubble_anemone',
    colonyHeight: 0.68,
    colonyCount: 5,
    canopySpread: 1.18,
    organLength: 0.38,
    organWidth: 0.24,
    organDensity: 1.15,
    ruffleWave: 0.82,
    vesicleAbundance: 1.0,
    branchOrder: 2,
    currentLeanDeg: 6,
    currentSway: 0.95,
    translucency: 0.74,
    ...MARINE_PALETTES.biolum_bubble_anemone,
  },
  azure_tube_sponge: {
    colorPalette: 'caribbean_azure_sponge',
    colonyHeight: 1.12,
    colonyCount: 8,
    canopySpread: 0.86,
    organLength: 0.85,
    organWidth: 0.28,
    organDensity: 1.0,
    ruffleWave: 0.64,
    vesicleAbundance: 1.05,
    branchOrder: 2,
    currentLeanDeg: 6,
    currentSway: 0.26,
    translucency: 0.38,
    ...MARINE_PALETTES.caribbean_azure_sponge,
  },
  feather_star_crinoid: {
    colorPalette: 'crimson_gold_crinoid',
    colonyHeight: 0.86,
    colonyCount: 20,
    canopySpread: 1.24,
    organLength: 0.68,
    organWidth: 0.16,
    organDensity: 1.1,
    ruffleWave: 0.58,
    vesicleAbundance: 0.95,
    branchOrder: 2,
    currentLeanDeg: 10,
    currentSway: 0.92,
    translucency: 0.46,
    ...MARINE_PALETTES.crimson_gold_crinoid,
  },
};

export function applyMarinePalette(target: MarineParams, palette: MarineColorPalette): void {
  target.colorPalette = palette;
  if (palette === 'custom') return;
  const sw = MARINE_PALETTES[palette];
  target.huePrimary = sw.huePrimary;
  target.hueSecondary = sw.hueSecondary;
  target.hueAccent = sw.hueAccent;
  target.hueHoldfast = sw.hueHoldfast;
  target.huePolyp = sw.huePolyp;
}

export function applyMarineSpeciesDefaults(target: MarineParams, species: MarineSpecies): void {
  const prof = MARINE_SPECIES_PROFILES[species];
  const keepTier = target.detailTier;
  Object.assign(target, prof, { species, detailTier: keepTier });
}

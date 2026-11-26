/**
 * Sea Plants, Sea Vegetation & Marine Benthic Species Parameters, Profiles & Palettes.
 *
 * Covers 18 sculpted marine macroalgae (brown kelps/rockweeds, green siphonous/foliose
 * seaweeds, red palmate seaweeds, calcified fan algae), marine flowering seagrasses,
 * and benthic reef species:
 *
 *   A. SEA PLANTS & SEA VEGETATION (13 Species):
 *      - `giant_kelp`                    : Macrocystis pyrifera · haptera holdfast, buoyant stipes, pyriform gas bladders & corrugated blades
 *      - `bull_kelp`                     : Nereocystis luetkeana · slender whip stipe, floating spherical bulb & S-wave silk ribbon crown
 *      - `sea_palm_postelsia`            : Postelsia palmaeformis · stout fluted rubbery trunk & drooping umbrella crown of channeled surf blades
 *      - `knotted_wrack_ascophyllum`     : Ascophyllum nodosum · Y-forking midribbed rockweed straps, inline air bladders & golden receptacles
 *      - `sargassum_weed`                : Sargassum horneri · zigzag thallus branches, serrated lanceolate blades & stalked berry vesicles
 *      - `peacock_tail_padina`           : Padina pavonica · funnel-cupped flabellate fans with concentric calcified chalk/turquoise bands & rolled rims
 *      - `red_dulse_palmaria`            : Palmaria palmata · deeply palmate crimson-burgundy red seaweed lobes with marginal baby bladelets
 *      - `sea_grapes_caulerpa`           : Caulerpa lentillifera · creeping emerald stolons & erect shoots packed with glossy translucent caviar spheres
 *      - `mermaid_wineglass_acetabularia`: Acetabularia crenulata · fairy colony of slender calcified stalks & radially pleated mint wineglass parasols
 *      - `codium_dead_mans_fingers`      : Codium fragile · watertight 2-manifold Y-forking spongy dark-emerald fingers with frosty utricle velvet
 *      - `sea_lettuce_ulva`              : Ulva lactuca · hyperbolic-ruffled translucent emerald-jade foliose rosette lobes
 *      - `neptune_seagrass`              : Posidonia oceanica · creeping scaly rhizomes, fibrous sheaths & dense multi-veined emerald straps
 *      - `eelgrass_zostera`              : Zostera marina · jointed rhizomes, sweeping jade-teal ribbon prairie & fertile underwater flowering spathes
 *
 *   B. BENTHIC REEF & MARINE SPECIES (5 Species):
 *      - `staghorn_coral`                : Acropora cervicornis · watertight 2-manifold calcified antler colony, radial corallites & axial tips
 *      - `gorgonian_sea_fan`             : Gorgonia ventalina · planar reticulate sea-fan lattice meshwork & 8-rayed octocoral polyps
 *      - `sea_anemone`                   : Entacmaea quadricolor · verrucose pedal column, pleated oral disc & 3D bubble-tip tentacles
 *      - `azure_tube_sponge`             : Callyspongia plicifera · double-walled hollow organ-pipe chimneys with spicule conules & oscular rims
 *      - `feather_star_crinoid`          : Himerometra robustipinna · grasping cirri, calyx & overarching pinnate feathery crinoid arms
 */

export type MarineSpecies =
  | 'giant_kelp'
  | 'bull_kelp'
  | 'sea_palm_postelsia'
  | 'knotted_wrack_ascophyllum'
  | 'sargassum_weed'
  | 'peacock_tail_padina'
  | 'red_dulse_palmaria'
  | 'sea_grapes_caulerpa'
  | 'mermaid_wineglass_acetabularia'
  | 'codium_dead_mans_fingers'
  | 'sea_lettuce_ulva'
  | 'neptune_seagrass'
  | 'eelgrass_zostera'
  | 'sea_anemone'
  | 'magnificent_ritteri_anemone'
  | 'giant_carpet_anemone'
  | 'tube_dwelling_cerianthus'
  | 'corkscrew_anemone'
  | 'rock_flower_anemone'
  | 'plumose_frilled_anemone'
  | 'strawberry_beadlet_anemone'
  | 'staghorn_coral'
  | 'gorgonian_sea_fan'
  | 'azure_tube_sponge'
  | 'feather_star_crinoid';

export const MARINE_SPECIES_NAMES: Record<MarineSpecies, string> = {
  giant_kelp: 'Giant Bladder Kelp (Macrocystis)',
  bull_kelp: 'Bull Whip Kelp (Nereocystis)',
  sea_palm_postelsia: 'Intertidal Sea Palm (Postelsia)',
  knotted_wrack_ascophyllum: 'Knotted Bladder Wrack (Ascophyllum)',
  sargassum_weed: 'Golden Berry Sargassum',
  peacock_tail_padina: "Peacock's Tail Fan Alga (Padina)",
  red_dulse_palmaria: 'Crimson Palmate Dulse (Palmaria)',
  sea_grapes_caulerpa: 'Emerald Sea Grapes (Caulerpa)',
  mermaid_wineglass_acetabularia: "Mermaid's Wineglass (Acetabularia)",
  codium_dead_mans_fingers: 'Velvet Staghorn Weed (Codium)',
  sea_lettuce_ulva: 'Ruffled Sea Lettuce (Ulva)',
  neptune_seagrass: 'Neptune Seagrass (Posidonia)',
  eelgrass_zostera: 'Flowering Eelgrass Meadow (Zostera)',
  sea_anemone: 'Bubble-Tip Sea Anemone (Entacmaea)',
  magnificent_ritteri_anemone: 'Magnificent Ritteri Anemone (Radianthus)',
  giant_carpet_anemone: 'Giant Folded Carpet Anemone (Stichodactyla)',
  tube_dwelling_cerianthus: 'Firework Tube Anemone (Cerianthus)',
  corkscrew_anemone: 'Spiral Corkscrew Anemone (Bartholomea)',
  rock_flower_anemone: 'Caribbean Rock Flower Anemone (Phymanthus)',
  plumose_frilled_anemone: 'Giant Plumose Anemone (Metridium)',
  strawberry_beadlet_anemone: 'Strawberry Beadlet Anemone (Actinia)',
  staghorn_coral: 'Branching Staghorn Coral (Acropora)',
  gorgonian_sea_fan: 'Reticulate Gorgonian Sea Fan',
  azure_tube_sponge: 'Organ-Pipe Azure Tube Sponge',
  feather_star_crinoid: 'Reef Crinoid Feather Star',
};

export type MarineColorPalette =
  | 'pacific_amber_kelp'
  | 'fucus_intertidal_amber'
  | 'emerald_seagrass'
  | 'eelgrass_teal_meadow'
  | 'jade_tidepool'
  | 'caulerpa_emerald_caviar'
  | 'acetabularia_mint_parasol'
  | 'padina_peacock_chalk'
  | 'crimson_dulse_rhodo'
  | 'biolum_bubble_anemone'
  | 'ritteri_magenta_gold'
  | 'carpet_cobalt_turquoise'
  | 'cerianthus_firework_violet'
  | 'rock_flower_ultra_rainbow'
  | 'plumose_sunset_alabaster'
  | 'strawberry_sapphire_actinia'
  | 'acropora_rose_gold'
  | 'royal_purple_gorgonian'
  | 'caribbean_azure_sponge'
  | 'crimson_gold_crinoid'
  | 'abyssal_neon_reef'
  | 'bleached_ivory_reef'
  | 'custom';

export const MARINE_PALETTE_NAMES: Record<MarineColorPalette, string> = {
  pacific_amber_kelp: 'Pacific Olive-Bronze Kelp',
  fucus_intertidal_amber: 'Intertidal Rockweed & Saffron',
  emerald_seagrass: 'Mediterranean Emerald Seagrass',
  eelgrass_teal_meadow: 'Coastal Jade-Teal Eelgrass',
  jade_tidepool: 'Translucent Tidepool Jade',
  caulerpa_emerald_caviar: 'Jewel Emerald Sea-Grape Caviar',
  acetabularia_mint_parasol: 'Calcified Mint & Aquamarine',
  padina_peacock_chalk: 'Peacock Chalk & Iridescent Teal',
  crimson_dulse_rhodo: 'Crimson-Burgundy Rhodophyta',
  biolum_bubble_anemone: 'Bioluminescent Cyan-Magenta',
  ritteri_magenta_gold: 'Ritteri Magenta Column & Gold Tips',
  carpet_cobalt_turquoise: 'Electric Cobalt & Turquoise Carpet',
  cerianthus_firework_violet: 'Cerianthus Ultraviolet & Tangerine',
  rock_flower_ultra_rainbow: 'Caribbean Ultra Rock-Flower Rainbow',
  plumose_sunset_alabaster: 'Metridium Salmon-Peach & Alabaster',
  strawberry_sapphire_actinia: 'Strawberry Crimson & Sapphire Beads',
  acropora_rose_gold: 'Rose-Gold Staghorn Reef',
  royal_purple_gorgonian: 'Royal Violet & Gold Sea Fan',
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
  fucus_intertidal_amber: {
    huePrimary: '#474214',
    hueSecondary: '#786c1c',
    hueAccent: '#e09a1e',
    hueHoldfast: '#2b2410',
    huePolyp: '#f0b429',
  },
  emerald_seagrass: {
    huePrimary: '#196935',
    hueSecondary: '#3da854',
    hueAccent: '#78cf6b',
    hueHoldfast: '#594732',
    huePolyp: '#d99bb5',
  },
  eelgrass_teal_meadow: {
    huePrimary: '#115e52',
    hueSecondary: '#279c7e',
    hueAccent: '#8be0a4',
    hueHoldfast: '#4a422d',
    huePolyp: '#d6f599',
  },
  jade_tidepool: {
    huePrimary: '#116633',
    hueSecondary: '#2ca34c',
    hueAccent: '#68cf5f',
    hueHoldfast: '#1f472b',
    huePolyp: '#b5f279',
  },
  caulerpa_emerald_caviar: {
    huePrimary: '#0e6b2e',
    hueSecondary: '#29b84a',
    hueAccent: '#7ef056',
    hueHoldfast: '#1b5228',
    huePolyp: '#aef77e',
  },
  acetabularia_mint_parasol: {
    huePrimary: '#36967d',
    hueSecondary: '#7ce0be',
    hueAccent: '#dcf7ed',
    hueHoldfast: '#6b7a70',
    huePolyp: '#b8ffdf',
  },
  padina_peacock_chalk: {
    huePrimary: '#6e5c2b',
    hueSecondary: '#389c94',
    hueAccent: '#ebe6d5',
    hueHoldfast: '#3d3119',
    huePolyp: '#8adbd2',
  },
  crimson_dulse_rhodo: {
    huePrimary: '#6e102b',
    hueSecondary: '#bd1e48',
    hueAccent: '#ed537a',
    hueHoldfast: '#380917',
    huePolyp: '#ff8ca8',
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
  ritteri_magenta_gold: {
    huePrimary: '#4d9e2a',
    hueSecondary: '#8ee846',
    hueAccent: '#ffd426',
    hueHoldfast: '#b81d78',
    huePolyp: '#f779c2',
  },
  carpet_cobalt_turquoise: {
    huePrimary: '#1638b8',
    hueSecondary: '#1fd6e8',
    hueAccent: '#69ff9c',
    hueHoldfast: '#301b70',
    huePolyp: '#ff8a5c',
  },
  cerianthus_firework_violet: {
    huePrimary: '#5e17c4',
    hueSecondary: '#e82ca8',
    hueAccent: '#4df5ff',
    hueHoldfast: '#2e222e',
    huePolyp: '#ff9626',
  },
  rock_flower_ultra_rainbow: {
    huePrimary: '#e63517',
    hueSecondary: '#17cc6c',
    hueAccent: '#ffd014',
    hueHoldfast: '#6b1839',
    huePolyp: '#ff42b0',
  },
  plumose_sunset_alabaster: {
    huePrimary: '#e87846',
    hueSecondary: '#f7bfa0',
    hueAccent: '#fff6ed',
    hueHoldfast: '#c9532b',
    huePolyp: '#ffd6ba',
  },
  strawberry_sapphire_actinia: {
    huePrimary: '#b8122a',
    hueSecondary: '#eb2f4b',
    hueAccent: '#ff6b80',
    hueHoldfast: '#8f0b1e',
    huePolyp: '#14b5ff',
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
  /** Abundance of gas bladders (pneumatocysts), polyps, grapes, or epiphytes [0..1.5]. */
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
  sea_palm_postelsia: {
    colorPalette: 'fucus_intertidal_amber',
    colonyHeight: 0.78,
    colonyCount: 5,
    canopySpread: 1.08,
    organLength: 0.36,
    organWidth: 0.18,
    organDensity: 1.15,
    ruffleWave: 0.68,
    vesicleAbundance: 0.85,
    branchOrder: 2,
    currentLeanDeg: 10,
    currentSway: 1.05,
    translucency: 0.56,
    ...MARINE_PALETTES.fucus_intertidal_amber,
  },
  knotted_wrack_ascophyllum: {
    colorPalette: 'fucus_intertidal_amber',
    colonyHeight: 1.15,
    colonyCount: 7,
    canopySpread: 1.12,
    organLength: 0.28,
    organWidth: 0.20,
    organDensity: 1.1,
    ruffleWave: 0.42,
    vesicleAbundance: 1.15,
    branchOrder: 3,
    currentLeanDeg: 14,
    currentSway: 1.0,
    translucency: 0.54,
    ...MARINE_PALETTES.fucus_intertidal_amber,
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
  peacock_tail_padina: {
    colorPalette: 'padina_peacock_chalk',
    colonyHeight: 0.46,
    colonyCount: 14,
    canopySpread: 1.18,
    organLength: 0.34,
    organWidth: 0.72,
    organDensity: 1.1,
    ruffleWave: 0.58,
    vesicleAbundance: 1.0,
    branchOrder: 2,
    currentLeanDeg: 6,
    currentSway: 0.68,
    translucency: 0.52,
    ...MARINE_PALETTES.padina_peacock_chalk,
  },
  red_dulse_palmaria: {
    colorPalette: 'crimson_dulse_rhodo',
    colonyHeight: 0.72,
    colonyCount: 9,
    canopySpread: 1.14,
    organLength: 0.56,
    organWidth: 0.44,
    organDensity: 1.1,
    ruffleWave: 0.74,
    vesicleAbundance: 0.95,
    branchOrder: 3,
    currentLeanDeg: 12,
    currentSway: 0.98,
    translucency: 0.76,
    ...MARINE_PALETTES.crimson_dulse_rhodo,
  },
  sea_grapes_caulerpa: {
    colorPalette: 'caulerpa_emerald_caviar',
    colonyHeight: 0.62,
    colonyCount: 13,
    canopySpread: 1.08,
    organLength: 0.48,
    organWidth: 0.24,
    organDensity: 1.15,
    ruffleWave: 0.35,
    vesicleAbundance: 1.2,
    branchOrder: 2,
    currentLeanDeg: 8,
    currentSway: 0.92,
    translucency: 0.86,
    ...MARINE_PALETTES.caulerpa_emerald_caviar,
  },
  mermaid_wineglass_acetabularia: {
    colorPalette: 'acetabularia_mint_parasol',
    colonyHeight: 0.42,
    colonyCount: 24,
    canopySpread: 1.05,
    organLength: 0.14,
    organWidth: 0.55,
    organDensity: 1.1,
    ruffleWave: 0.48,
    vesicleAbundance: 1.0,
    branchOrder: 2,
    currentLeanDeg: 6,
    currentSway: 0.82,
    translucency: 0.68,
    ...MARINE_PALETTES.acetabularia_mint_parasol,
  },
  codium_dead_mans_fingers: {
    colorPalette: 'jade_tidepool',
    colonyHeight: 0.84,
    colonyCount: 4,
    canopySpread: 1.08,
    organLength: 0.34,
    organWidth: 0.28,
    organDensity: 1.05,
    ruffleWave: 0.45,
    vesicleAbundance: 1.05,
    branchOrder: 3,
    currentLeanDeg: 10,
    currentSway: 0.86,
    translucency: 0.55,
    huePrimary: '#0c4d26',
    hueSecondary: '#1b7a3d',
    hueAccent: '#7be382',
    hueHoldfast: '#083319',
    huePolyp: '#a8f59d',
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
  eelgrass_zostera: {
    colorPalette: 'eelgrass_teal_meadow',
    colonyHeight: 1.48,
    colonyCount: 18,
    canopySpread: 1.2,
    organLength: 1.28,
    organWidth: 0.065,
    organDensity: 1.15,
    ruffleWave: 0.32,
    vesicleAbundance: 0.95,
    branchOrder: 2,
    currentLeanDeg: 24,
    currentSway: 1.22,
    translucency: 0.66,
    ...MARINE_PALETTES.eelgrass_teal_meadow,
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
  magnificent_ritteri_anemone: {
    colorPalette: 'ritteri_magenta_gold',
    colonyHeight: 0.78,
    colonyCount: 6,
    canopySpread: 1.22,
    organLength: 0.34,
    organWidth: 0.16,
    organDensity: 1.25,
    ruffleWave: 0.62,
    vesicleAbundance: 1.0,
    branchOrder: 2,
    currentLeanDeg: 10,
    currentSway: 1.08,
    translucency: 0.72,
    ...MARINE_PALETTES.ritteri_magenta_gold,
  },
  giant_carpet_anemone: {
    colorPalette: 'carpet_cobalt_turquoise',
    colonyHeight: 0.48,
    colonyCount: 16,
    canopySpread: 1.25,
    organLength: 0.46,
    organWidth: 0.28,
    organDensity: 1.2,
    ruffleWave: 0.88,
    vesicleAbundance: 1.1,
    branchOrder: 2,
    currentLeanDeg: 4,
    currentSway: 0.65,
    translucency: 0.68,
    ...MARINE_PALETTES.carpet_cobalt_turquoise,
  },
  tube_dwelling_cerianthus: {
    colorPalette: 'cerianthus_firework_violet',
    colonyHeight: 0.96,
    colonyCount: 3,
    canopySpread: 1.24,
    organLength: 0.58,
    organWidth: 0.08,
    organDensity: 1.15,
    ruffleWave: 0.68,
    vesicleAbundance: 1.05,
    branchOrder: 2,
    currentLeanDeg: 14,
    currentSway: 1.15,
    translucency: 0.78,
    ...MARINE_PALETTES.cerianthus_firework_violet,
  },
  corkscrew_anemone: {
    colorPalette: 'biolum_bubble_anemone',
    colonyHeight: 0.66,
    colonyCount: 5,
    canopySpread: 1.18,
    organLength: 0.44,
    organWidth: 0.16,
    organDensity: 1.1,
    ruffleWave: 0.86,
    vesicleAbundance: 1.15,
    branchOrder: 2,
    currentLeanDeg: 8,
    currentSway: 1.05,
    translucency: 0.76,
    huePrimary: '#246b5c',
    hueSecondary: '#6de8c1',
    hueAccent: '#ff52b6',
    hueHoldfast: '#59342b',
    huePolyp: '#fff3a1',
  },
  rock_flower_anemone: {
    colorPalette: 'rock_flower_ultra_rainbow',
    colonyHeight: 0.34,
    colonyCount: 5,
    canopySpread: 1.18,
    organLength: 0.16,
    organWidth: 0.26,
    organDensity: 1.15,
    ruffleWave: 0.74,
    vesicleAbundance: 1.15,
    branchOrder: 2,
    currentLeanDeg: 4,
    currentSway: 0.72,
    translucency: 0.66,
    ...MARINE_PALETTES.rock_flower_ultra_rainbow,
  },
  plumose_frilled_anemone: {
    colorPalette: 'plumose_sunset_alabaster',
    colonyHeight: 1.04,
    colonyCount: 3,
    canopySpread: 1.12,
    organLength: 0.22,
    organWidth: 0.12,
    organDensity: 1.2,
    ruffleWave: 0.85,
    vesicleAbundance: 1.0,
    branchOrder: 3,
    currentLeanDeg: 8,
    currentSway: 0.88,
    translucency: 0.80,
    ...MARINE_PALETTES.plumose_sunset_alabaster,
  },
  strawberry_beadlet_anemone: {
    colorPalette: 'strawberry_sapphire_actinia',
    colonyHeight: 0.42,
    colonyCount: 4,
    canopySpread: 1.10,
    organLength: 0.22,
    organWidth: 0.20,
    organDensity: 1.15,
    ruffleWave: 0.55,
    vesicleAbundance: 1.15,
    branchOrder: 2,
    currentLeanDeg: 6,
    currentSway: 0.85,
    translucency: 0.68,
    ...MARINE_PALETTES.strawberry_sapphire_actinia,
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

/**
 * Parametric model for Gigantic & Botanical Flowering Plants (`src/generators/flowerParams.ts`).
 *
 * Engineered for colossal scale (0.6 m up to 9.0 m tall specimens with 0.25 m – 2.4 m wide
 * flowers) where every petal has double-sided 3D mesophyll thickness, embossed branching
 * venation, satin plisse bullation, ruffled margins, nectar guides, 3D stamens/anthers/stigmas,
 * and closed 2-manifold welded stems, roots, pedicels & petioles (`V - E + F = 2C`).
 */

export type FlowerSpecies =
  | 'tropical_hibiscus'
  | 'oriental_lily'
  | 'sacred_lotus'
  | 'tree_peony'
  | 'passion_orchid'
  | 'titan_sunflower'
  | 'king_protea'
  | 'honeycomb_dahlia'
  | 'bearded_iris'
  | 'phalaenopsis_orchid'
  | 'imperial_crown_bell'
  | 'bird_of_paradise';

export const FLOWER_SPECIES_NAMES: Record<FlowerSpecies, string> = {
  tropical_hibiscus: 'Colossal Tropical Hibiscus (Hibiscus)',
  oriental_lily: 'Giant Stargazer Lily (Lilium orientalis)',
  sacred_lotus: 'Colossal Sacred Lotus (Nelumbo nucifera)',
  tree_peony: 'Imperial Giant Tree Peony (Paeonia)',
  passion_orchid: 'Colossal Crown Passionflower (Passiflora)',
  titan_sunflower: 'Giant Royal Sunflower (Helianthus)',
  king_protea: 'Giant King Protea (Protea cynaroides)',
  honeycomb_dahlia: 'Colossal Honeycomb Dahlia (Dahlia pinnata)',
  bearded_iris: 'Giant Cathedral Bearded Iris (Iris germanica)',
  phalaenopsis_orchid: 'Exotic Moth Orchid Spray (Phalaenopsis)',
  imperial_crown_bell: 'Imperial Pagoda Crown Bell (Fritillaria)',
  bird_of_paradise: 'Royal Crane Flower (Strelitzia reginae)',
};

export type FlowerColorPalette =
  | 'species_signature'
  | 'electric_magenta_gold'
  | 'crimson_velvet_ruby'
  | 'solar_tangerine_flame'
  | 'ultraviolet_orchid'
  | 'cerulean_sapphire'
  | 'imperial_coral_sunset'
  | 'bioluminescent_aurora'
  | 'royal_amethyst_rose'
  | 'neon_cyber_lotus'
  | 'golden_saffron_emperor'
  | 'velvet_midnight_noir'
  | 'pastel_sakura_pearl'
  | 'custom';

export const FLOWER_PALETTE_NAMES: Record<FlowerColorPalette, string> = {
  species_signature: 'Species Signature Vibrant',
  electric_magenta_gold: 'Electric Magenta & Solar Gold',
  crimson_velvet_ruby: 'Crimson Velvet & Deep Ruby',
  solar_tangerine_flame: 'Solar Tangerine & Scarlet Flame',
  ultraviolet_orchid: 'Ultraviolet Orchid & Lime Nectar',
  cerulean_sapphire: 'Cerulean Sapphire & Pearl',
  imperial_coral_sunset: 'Imperial Coral, Peach & Rose',
  bioluminescent_aurora: 'Bioluminescent Cyan & Violet',
  royal_amethyst_rose: 'Royal Amethyst, Fuchsia & Saffron',
  neon_cyber_lotus: 'Neon Cyber Fuchsia & Electric Cyan',
  golden_saffron_emperor: 'Golden Saffron & Imperial Vermilion',
  velvet_midnight_noir: 'Midnight Velvet Plum & Rose-Gold',
  pastel_sakura_pearl: 'Luminous Sakura Blush & Ivory Pearl',
  custom: 'Custom Sculpted Pigments',
};

export interface FlowerPigmentSet {
  huePrimary: string;
  hueSecondary: string;
  hueThroat: string;
  hueVein: string;
  huePollen: string;
  hueStemLeaf: string;
}

export const SPECIES_SIGNATURE_PIGMENTS: Record<FlowerSpecies, FlowerPigmentSet> = {
  tropical_hibiscus: {
    huePrimary: '#ff1452',
    hueSecondary: '#ff7b1c',
    hueThroat: '#2b010c',
    hueVein: '#69021f',
    huePollen: '#ffcb1f',
    hueStemLeaf: '#1e5c1a',
  },
  oriental_lily: {
    huePrimary: '#e60e6a',
    hueSecondary: '#fff4fb',
    hueThroat: '#6bd122',
    hueVein: '#7a0536',
    huePollen: '#d9480f',
    hueStemLeaf: '#21631c',
  },
  sacred_lotus: {
    huePrimary: '#f75296',
    hueSecondary: '#ff0f6b',
    hueThroat: '#ffe268',
    hueVein: '#c91c68',
    huePollen: '#ffbe18',
    hueStemLeaf: '#236938',
  },
  tree_peony: {
    huePrimary: '#f21b65',
    hueSecondary: '#ff9ec4',
    hueThroat: '#5e0429',
    hueVein: '#b50b49',
    huePollen: '#ffc414',
    hueStemLeaf: '#205723',
  },
  passion_orchid: {
    huePrimary: '#e9dfff',
    hueSecondary: '#9c5cff',
    hueThroat: '#2a086e',
    hueVein: '#4f18d9',
    huePollen: '#d6e31e',
    hueStemLeaf: '#1d5c26',
  },
  titan_sunflower: {
    huePrimary: '#ffb703',
    hueSecondary: '#ffe135',
    hueThroat: '#b52804',
    hueVein: '#d95307',
    huePollen: '#3b1c08',
    hueStemLeaf: '#286319',
  },
  king_protea: {
    huePrimary: '#e81c62',
    hueSecondary: '#ffd9e8',
    hueThroat: '#4a031d',
    hueVein: '#9e0b3f',
    huePollen: '#fff5f8',
    hueStemLeaf: '#2b5938',
  },
  honeycomb_dahlia: {
    huePrimary: '#ff0a6c',
    hueSecondary: '#ff9e1b',
    hueThroat: '#520238',
    hueVein: '#b50952',
    huePollen: '#ffcb14',
    hueStemLeaf: '#1d5c21',
  },
  bearded_iris: {
    huePrimary: '#6d3bff',
    hueSecondary: '#b89eff',
    hueThroat: '#210563',
    hueVein: '#f7ecff',
    huePollen: '#ff6d00',
    hueStemLeaf: '#296652',
  },
  phalaenopsis_orchid: {
    huePrimary: '#ffe8f7',
    hueSecondary: '#f51686',
    hueThroat: '#ffbe0b',
    hueVein: '#a80054',
    huePollen: '#fff7fc',
    hueStemLeaf: '#1b5726',
  },
  imperial_crown_bell: {
    huePrimary: '#ff3c00',
    hueSecondary: '#ffaa00',
    hueThroat: '#420210',
    hueVein: '#a81200',
    huePollen: '#fff2b2',
    hueStemLeaf: '#1f6622',
  },
  bird_of_paradise: {
    huePrimary: '#ff5e00',
    hueSecondary: '#0b3dff',
    hueThroat: '#d9043d',
    hueVein: '#ff9500',
    huePollen: '#fff9f0',
    hueStemLeaf: '#215c44',
  },
};

export const VIBRANT_PALETTE_SWATCHES: Record<
  Exclude<FlowerColorPalette, 'species_signature' | 'custom'>,
  FlowerPigmentSet
> = {
  electric_magenta_gold: {
    huePrimary: '#f50a7c',
    hueSecondary: '#ff5ec4',
    hueThroat: '#ffbe0b',
    hueVein: '#780242',
    huePollen: '#ffd60a',
    hueStemLeaf: '#1e5e20',
  },
  crimson_velvet_ruby: {
    huePrimary: '#d90429',
    hueSecondary: '#ff3b56',
    hueThroat: '#3b010b',
    hueVein: '#6e0216',
    huePollen: '#ffc300',
    hueStemLeaf: '#1b511d',
  },
  solar_tangerine_flame: {
    huePrimary: '#ff5400',
    hueSecondary: '#ffbd00',
    hueThroat: '#9e0031',
    hueVein: '#c9182b',
    huePollen: '#ffe135',
    hueStemLeaf: '#25611a',
  },
  ultraviolet_orchid: {
    huePrimary: '#8314f9',
    hueSecondary: '#e056fd',
    hueThroat: '#84e617',
    hueVein: '#390382',
    huePollen: '#ffe619',
    hueStemLeaf: '#1c5928',
  },
  cerulean_sapphire: {
    huePrimary: '#0062ff',
    hueSecondary: '#66d9ff',
    hueThroat: '#f4f9ff',
    hueVein: '#022682',
    huePollen: '#ffd11a',
    hueStemLeaf: '#1d5c33',
  },
  imperial_coral_sunset: {
    huePrimary: '#ff3d68',
    hueSecondary: '#ffb26b',
    hueThroat: '#7a0938',
    hueVein: '#cc164b',
    huePollen: '#ffd22b',
    hueStemLeaf: '#225e22',
  },
  bioluminescent_aurora: {
    huePrimary: '#00d9c0',
    hueSecondary: '#7b2cbf',
    hueThroat: '#240046',
    hueVein: '#00f5d4',
    huePollen: '#ffee32',
    hueStemLeaf: '#144d38',
  },
  royal_amethyst_rose: {
    huePrimary: '#b5179e',
    hueSecondary: '#f72585',
    hueThroat: '#ff9e00',
    hueVein: '#560bad',
    huePollen: '#ffd000',
    hueStemLeaf: '#1f5924',
  },
  neon_cyber_lotus: {
    huePrimary: '#ff007f',
    hueSecondary: '#00f5ff',
    hueThroat: '#1b004b',
    hueVein: '#ff4da6',
    huePollen: '#f4ff1a',
    hueStemLeaf: '#134e3a',
  },
  golden_saffron_emperor: {
    huePrimary: '#ffb700',
    hueSecondary: '#ff4800',
    hueThroat: '#6b0504',
    hueVein: '#d93800',
    huePollen: '#fff05a',
    hueStemLeaf: '#245c1d',
  },
  velvet_midnight_noir: {
    huePrimary: '#3d041d',
    hueSecondary: '#940b36',
    hueThroat: '#140109',
    hueVein: '#d91656',
    huePollen: '#ffd12b',
    hueStemLeaf: '#1a4728',
  },
  pastel_sakura_pearl: {
    huePrimary: '#ff85b3',
    hueSecondary: '#fff7fb',
    hueThroat: '#e62e6b',
    hueVein: '#ff4d8d',
    huePollen: '#ffd43b',
    hueStemLeaf: '#286634',
  },
};

export interface FlowerParams {
  species: FlowerSpecies;
  /** Poly budget / tessellation tier: 1 = Light, 2 = Standard, 3 = High-Poly, 4 = Cinema Macro. */
  detailTier: number;
  /** Curated vibrant colorway or `'custom'` for free per-organ hex colors. */
  colorPalette: FlowerColorPalette;

  // Gigantic Stature & Architecture
  /** Total plant height in metres [0.6..9.0]. */
  plantHeight: number;
  /** Primary open flower corolla diameter in metres [0.25..2.4]. */
  bloomDiameter: number;
  /** Number of open blooms on the welded peduncle crown [1..8]. */
  bloomCount: number;
  /** Number of unopened spiraled/swollen floral buds [0..6]. */
  budCount: number;
  /** Welded basal buttress/rhizome roots [0..8]. */
  rootCount: number;

  // Detailed Petal Sculpture & Micro-Relief
  /** Multiplier on species petal count [0.65..1.6]. */
  petalCountScale: number;
  /** Corolla opening spread [0.3..1.25]. */
  corollaOpenness: number;
  /** 3D harmonic margin ruffle / silk frill amplitude [0..1.5]. */
  petalRuffle: number;
  /** Distal petal curl / recurve (-0.6 = deep inward chalice, +1.2 = dramatic Stargazer reflex). */
  petalCurl: number;
  /** Physical 3D embossing depth of radiating branching petal veins & satin bullation [0..1.5]. */
  veinRelief: number;
  /** Abundance of 3D stamens, bilobed anthers, corona filaments & disc florets [0.4..1.6]. */
  stamenLushness: number;
  /** Density of welded cauline / peltate foliage leaves [0..1.6]. */
  foliageDensity: number;
  /** Isometric SO(3) wind sway & petal flutter compliance [0.2..2.0]. */
  windCompliance: number;

  // Vibrant Floral Chromatics
  /** Chroma saturation & epidermal papillae vibrancy boost [0.6..1.8]. */
  vibrancy: number;
  /** Two-tone margin / picotee / tip gradient strength [0..1.0]. */
  edgeBlend: number;
  /** Nectar throat eye radius fraction [0..0.72]. */
  throatSize: number;
  /** Nectar-guide vein striation pigment contrast [0..1.0]. */
  veinContrast: number;

  // Live Editable Hex Colors
  huePrimary: string;
  hueSecondary: string;
  hueThroat: string;
  hueVein: string;
  huePollen: string;
  hueStemLeaf: string;
}

export const DEFAULT_FLOWER_PARAMS: FlowerParams = {
  species: 'tropical_hibiscus',
  detailTier: 3,
  colorPalette: 'species_signature',

  plantHeight: 3.4,
  bloomDiameter: 1.05,
  bloomCount: 3,
  budCount: 2,
  rootCount: 6,

  petalCountScale: 1.0,
  corollaOpenness: 0.92,
  petalRuffle: 0.88,
  petalCurl: 0.42,
  veinRelief: 0.92,
  stamenLushness: 1.05,
  foliageDensity: 1.0,
  windCompliance: 0.85,

  vibrancy: 1.32,
  edgeBlend: 0.56,
  throatSize: 0.30,
  veinContrast: 0.54,

  ...SPECIES_SIGNATURE_PIGMENTS.tropical_hibiscus,
};

/** Apply a curated vibrant palette onto `fp` in-place so UI color pickers stay synced. */
export function applyFlowerPalette(fp: FlowerParams, palette: FlowerColorPalette): void {
  fp.colorPalette = palette;
  if (palette === 'custom') return;
  const set =
    palette === 'species_signature'
      ? SPECIES_SIGNATURE_PIGMENTS[fp.species]
      : VIBRANT_PALETTE_SWATCHES[palette];
  fp.huePrimary = set.huePrimary;
  fp.hueSecondary = set.hueSecondary;
  fp.hueThroat = set.hueThroat;
  fp.hueVein = set.hueVein;
  fp.huePollen = set.huePollen;
  fp.hueStemLeaf = set.hueStemLeaf;
}

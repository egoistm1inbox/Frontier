/**
 * Botanical Parameters for Anatomically Accurate Fruiting Palm Trees
 * (`Palms · Fruiting & Branched`), featuring welded root-boles & dichotomous
 * Y-forking trunks (`WeldedMesher`), spiral clasping leaf-boots / crownshafts,
 * V-ranked & plumose pinnate fronds, 3D accordion-pleated costapalmate fans,
 * and 3D fruits (Medjool Dates, Husked Coconuts, Royal Drupes, Fan Berries, Doum).
 */

export type PalmSpecies =
  | 'date_palm'
  | 'coconut_palm'
  | 'royal_palm'
  | 'fan_palm'
  | 'doum_palm';

export const PALM_SPECIES_NAMES: Record<PalmSpecies, string> = {
  date_palm: 'Medjool Date Palm (Phoenix dactylifera)',
  coconut_palm: 'Coastal Coconut Palm (Cocos nucifera)',
  royal_palm: 'Cuban Royal Palm (Roystonea regia)',
  fan_palm: 'Desert Oasis Fan Palm (Washingtonia)',
  doum_palm: 'Branching Doum Palm (Hyphaene · Y-Fork)',
};

export interface PalmParams {
  species: PalmSpecies;
  /** 1..4 detail tier. */
  detailTier: number;
  /** Trunk height in metres (3.0..16.0 m). */
  trunkHeight: number;
  /** Nominal trunk radius in metres (0.14..0.50 m). */
  trunkRadius: number;
  /** Coastal lean angle at base in degrees (0..38°). */
  trunkLeanDeg: number;
  /** Upward phototropic S-curve sweep in degrees (-15..52°). */
  trunkCurveDeg: number;
  /** Basal root-bole swelling (0..1.2). */
  basalBole: number;
  /** Welded anchoring root lobes at trunk base (0..8). */
  rootButtresses: number;
  /** Bark relief (diamond leaf-boots on Date/Fan, annular rings on Coconut/Royal/Doum) [0..1]. */
  trunkRelief: number;
  /** Smooth green tubular crownshaft fraction of trunk height (0..0.24, classic on Royal Palm). */
  crownshaftRatio: number;
  /** Dichotomous Y-fork levels (0 = single trunk, 1 = 2 crowns, 2 = 4 crowns as in Doum Palm). */
  forkLevels: number;
  /** Fronds per crown (12..56). */
  frondCount: number;
  /** Frond total length in metres (1.4..5.2 m). */
  frondLength: number;
  /** Maximum blade/fan width in metres (0.65..2.1 m). */
  frondWidth: number;
  /** Rachis arch droop angle in degrees (25..125°). */
  frondArchDeg: number;
  /** Leaflet pairs per pinnate frond OR radial pleat segments per costapalmate fan (20..60). */
  leafletPairs: number;
  /** Multi-plane plumose roll splay [0..1] (0 = crisp 2-rank V/A sheet, 0.85 = full Royal foxtail). */
  plumoseSplay: number;
  /** Persistent dry golden-tan shag skirt fraction under green crown (0..0.42). */
  skirtFraction: number;
  /** Grow 3D fruiting spadices & fruit clusters (dates, coconuts, drupes). */
  showFruits: boolean;
  /** Fruiting bunches per crown (1..9). */
  fruitBunches: number;
  /** Fruit cluster fullness multiplier (0.3..1.7). */
  fruitAbundance: number;
  /** Fruit ripeness [0..1] (0 = unripe green/yellow, 1 = ripe amber Medjool / mature coconut). */
  fruitRipeness: number;
  /** Trade-wind sway compliance (0.2..2.2). */
  windSway: number;
  /** Custom hex pigments. */
  hueTrunk: string;
  hueFrond: string;
  hueFrondTip: string;
  hueFruit: string;
  hueSpadix: string;
}

export const DEFAULT_PALM_PARAMS: PalmParams = {
  species: 'date_palm',
  detailTier: 3,
  trunkHeight: 7.6,
  trunkRadius: 0.28,
  trunkLeanDeg: 4,
  trunkCurveDeg: 7,
  basalBole: 0.34,
  rootButtresses: 6,
  trunkRelief: 0.78,
  crownshaftRatio: 0.0,
  forkLevels: 0,
  frondCount: 46,
  frondLength: 3.7,
  frondWidth: 1.18,
  frondArchDeg: 72,
  leafletPairs: 48,
  plumoseSplay: 0.16,
  skirtFraction: 0.0,
  showFruits: true,
  fruitBunches: 8,
  fruitAbundance: 1.1,
  fruitRipeness: 0.58,
  windSway: 1.0,
  hueTrunk: '#69533f',
  hueFrond: '#2c5e3a',
  hueFrondTip: '#538550',
  hueFruit: '#b85214',
  hueSpadix: '#e39622',
};

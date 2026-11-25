/**
 * Parametric model for Real Bryophyte & Carpet Moss Colonies (Gametophytes +
 * Phyllids + Stolon/Rhizoid Mat + Sporophyte Setae & Capsules).
 */

export type MossHabit =
  | 'velvet_carpet'
  | 'pleurocarp_feather'
  | 'acrocarp_star'
  | 'cushion_leucobryum'
  | 'sphagnum_bog'
  | 'rock_tortula';

export const MOSS_HABIT_NAMES: Record<MossHabit, string> = {
  velvet_carpet: 'Lush Velvet Carpet (Dicranum / Sheet Moss)',
  pleurocarp_feather: 'Feather Carpet Mat (Hypnum / Hylocomium)',
  acrocarp_star: 'Acrocarp Star Turf (Polytrichum Haircap)',
  cushion_leucobryum: 'Billowing Pincushion (Leucobryum Dome)',
  sphagnum_bog: 'Capitulum Bog Peat (Sphagnum)',
  rock_tortula: 'Hyaline Hair-Point Tuft (Tortula / Bryum)',
};

export interface MossParams {
  habit: MossHabit;
  /** Poly budget / density tier: 1 = Light, 2 = Standard, 3 = Lush High-Poly, 4 = Cinema Macro. */
  detailTier: number;

  // Colony Ecology & Carpet Topography
  /** Number of gametophyte shoots at tier 3 (scales with detailTier). */
  shootCount: number;
  colonyCoverage: number; // [0.15..1.0] coverage across substrate
  patchiness: number; // [0..1] 0 = continuous wall-to-wall carpet, 1 = clumped islands
  creviceAffinity: number; // [0..1] preference for rock cracks & bark furrows
  cushionHeightMm: number; // Voronoi hummock / carpet wave height in mm
  cushionScale: number; // number of carpet waves / pillows across substrate
  /** Coherent directional sweep of shoots across the carpet [0..1] (Dicranum / Hypnum wind-swept look). */
  carpetSweep: number;
  /** Supple angular wind bend sensitivity [0.2..2.0]. */
  windCompliance: number;

  // Gametophyte Shoot & Phyllid (Micro-Leaf) Anatomy
  shootHeightMm: number;
  shootHeightVar: number;
  stemRadiusMm: number;
  /** Lateral branchlets per stem (high for pleurocarp feather & sphagnum). */
  branching: number;
  /** Spiraled 3D micro-leaves (phyllids) per shoot. */
  phyllidsPerShoot: number;
  phyllidLengthMm: number;
  phyllidWidthMm: number;
  /** Spreading angle of phyllids (hydration state: dry = tight/twisted, wet = wide star-open). */
  hydration: number; // [0..1]
  phyllidCurl: number; // [-1..1] falcate / wind-swept tip curl
  /** Silvery translucent tip awn length fraction [0..0.8] (Tortula / Grimmia). */
  hyalineHairPoint: number;

  // Basal Rhizoid & Stolon Felt
  rhizoidDensity: number; // [0..1]

  // Sporophyte Generation (Seta Stalk + Theca Capsule + Operculum)
  sporophyteDensity: number; // [0..0.6] fraction of shoots bearing a sporophyte
  setaHeightMm: number;
  capsuleLengthMm: number;
  /** Capsule nod angle in degrees (0 = erect Tortula, 78 = inclined Bryum/Hypnum, 135 = nodding Funaria). */
  capsuleNodDeg: number;

  // Bryological Pigmentation
  hueCanopy: string; // hydrated upper chlorophyll phyllids
  hueTip: string; // luminous fresh chartreuse/crimson shoot apex
  hueBase: string; // humid olive/peat lower shoot & stem
  hueCapsule: string; // amber/russet/crimson sporophyte seta & capsule
}

export const DEFAULT_MOSS_PARAMS: MossParams = {
  habit: 'velvet_carpet',
  detailTier: 3,

  shootCount: 1180,
  colonyCoverage: 0.98,
  patchiness: 0.08,
  creviceAffinity: 0.25,
  cushionHeightMm: 10,
  cushionScale: 4.5,
  carpetSweep: 0.46,
  windCompliance: 1.15,

  shootHeightMm: 28,
  shootHeightVar: 0.18,
  stemRadiusMm: 0.34,
  branching: 1,
  phyllidsPerShoot: 20,
  phyllidLengthMm: 5.4,
  phyllidWidthMm: 1.35,
  hydration: 0.84,
  phyllidCurl: 0.36,
  hyalineHairPoint: 0.0,

  rhizoidDensity: 0.65,

  sporophyteDensity: 0.12,
  setaHeightMm: 42,
  capsuleLengthMm: 4.8,
  capsuleNodDeg: 76,

  hueCanopy: '#2d7524',
  hueTip: '#9be038',
  hueBase: '#382c18',
  hueCapsule: '#c45d22',
};

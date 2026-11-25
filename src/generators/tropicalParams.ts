/**
 * Parametric model for Giant Tropical Megaphyll Plants (Wild Fruiting Banana,
 * Red Abyssinian Banana, Traveller's Palm, Giant Rainforest Elephant Ear, and
 * Giant Bird of Paradise) engineered for realistic multi-modal wind motion.
 */

export type TropicalArchitecture =
  | 'banana_musa'
  | 'red_abyssinian_banana'
  | 'travellers_palm'
  | 'elephant_ear_alocasia'
  | 'bird_of_paradise';

export const TROPICAL_ARCH_NAMES: Record<TropicalArchitecture, string> = {
  banana_musa: 'Wild Fruiting Banana (Musa paradisiaca)',
  red_abyssinian_banana: 'Red Abyssinian Banana (Ensete maurelii)',
  travellers_palm: "Giant Traveller's Palm (Ravenala Fan)",
  elephant_ear_alocasia: 'Colossal Elephant Ear (Alocasia)',
  bird_of_paradise: 'Giant Bird of Paradise (Strelitzia)',
};

export interface TropicalParams {
  architecture: TropicalArchitecture;
  /** Poly budget / tessellation tier: 1 = Light, 2 = Standard, 3 = High-Poly, 4 = Cinema Scan. */
  detailTier: number;

  // Pseudostem & Clump Stature
  /** Main pseudostem / trunk height in metres [0.25..2.8]. */
  pseudostemHeight: number;
  /** Basal pseudostem radius in metres [0.04..0.24]. */
  pseudostemRadius: number;
  /** Number of stems in clump (1 = solitary giant, 2..4 = main + sucker pups). */
  stemCount: number;

  // Crown & Giant Megaphyll Paddles
  leafCount: number;
  /** Total leaf length (petiole + blade) in metres [0.7..2.8]. */
  leafLength: number;
  /** Maximum blade width in metres [0.24..0.95]. */
  leafWidth: number;
  /** Petiole fraction of total leaf length [0.12..0.58]. */
  petioleFraction: number;
  /** Emergence angle from vertical (degrees) for upper vs outer crown [12..75]. */
  crownSplayDeg: number;
  /** Heavy tropical blade arch droop from base to apex (degrees) [15..125]. */
  archDroopDeg: number;
  /** Transverse V-fold dihedral of the two blade halves [0..0.75]. */
  laminaVDih: number;

  // Wind-Split Banana Ribbons, Striate Venation & Ruffle
  /** Number of wind-torn clefts per blade side [0..22]. */
  windTears: number;
  /** Tear penetration depth from margin toward midrib [0.25..0.92]. */
  tearDepth: number;
  /** Aerodynamic sail & ribbon flutter responsiveness [0.2..2.0]. */
  windSail: number;
  /** 3D midrib keel & lateral striation relief [0..1.5]. */
  veinRelief: number;
  /** Margin undulation wave [0..1]. */
  edgeWave: number;

  // Cigar Furl, Inflorescence (Banana Bell / Bird Spathe) & Skirt
  showCigarLeaf: boolean;
  showInflorescence: boolean;
  /** Fraction of oldest lower leaves drooping into golden senescent skirt [0..0.5]. */
  senescence: number;

  // Tropical Pigmentation
  hueBlade: string;
  hueYoung: string;
  hueMidrib: string;
  hueStem: string;
}

export const DEFAULT_TROPICAL_PARAMS: TropicalParams = {
  architecture: 'banana_musa',
  detailTier: 3,

  pseudostemHeight: 1.45,
  pseudostemRadius: 0.115,
  stemCount: 2,

  leafCount: 11,
  leafLength: 1.65,
  leafWidth: 0.52,
  petioleFraction: 0.24,
  crownSplayDeg: 38,
  archDroopDeg: 68,
  laminaVDih: 0.22,

  windTears: 11,
  tearDepth: 0.78,
  windSail: 1.15,
  veinRelief: 0.95,
  edgeWave: 0.34,

  showCigarLeaf: true,
  showInflorescence: true,
  senescence: 0.2,

  hueBlade: '#2b6e22',
  hueYoung: '#8ad938',
  hueMidrib: '#9fd448',
  hueStem: '#566e2e',
};

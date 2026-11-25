/**
 * Parametric model for Studio Fur & Hair Groom Generation (Guides + Undercoat +
 * Guard Hairs + Whiskers/Flyaways + Clumping + Helical Curls + Melanin/Agouti).
 */

export type HairFlowMode =
  | 'crown_part_center'
  | 'crown_part_side'
  | 'crown_whorl'
  | 'pelt_spine_flank'
  | 'swept_back';

export const HAIR_FLOW_NAMES: Record<HairFlowMode, string> = {
  crown_part_center: 'Center Part Cascade',
  crown_part_side: 'Asymmetric Side Part',
  crown_whorl: 'Radial Crown Whorl',
  pelt_spine_flank: 'Mammal Spine → Flank Coat',
  swept_back: 'Swept-Back Mane Flow',
};

export interface HairParams {
  flowMode: HairFlowMode;
  /** Poly budget / strand count tier: 1 = Preview, 2 = Standard, 3 = High Groom, 4 = Cinema Dense. */
  detailTier: number;

  // Guide & Strand Counts (at tier 3)
  guideCount: number;
  guardCount: number;
  undercoatCount: number;
  whiskerCount: number;

  // Length, Taper & Profile
  lengthCm: number;
  lengthVar: number;
  undercoatLengthRatio: number; // [0.25..0.9] relative to guard length
  rootRadiusMm: number;
  tipTaper: number; // [0.5..1.0] 1.0 = razor-fine natural hair tip
  strandSegments: number; // longitudinal segments per strand [6..28]
  shaftSides: number; // 3 = fast prism tube, 4 = quad tube

  // Groom Physics & Combing
  rootLift: number; // [0.05..1.0] initial follicle lift along normal (volume!)
  combStrength: number; // [0..1] alignment with surface tangent flow field
  partSharpness: number; // [0..1] crispness of center/side part
  gravity: number; // [0..2.5] downward cantilever droop
  stiffness: number; // [0.6..3.0] higher = stiff base, bends near tip

  // Clumping, Wave, Helical Curl & Frizz
  clumpStrength: number; // [0..1] pull toward guide strands
  clumpPower: number; // [0.4..3.0] 0.6 = clumped from root, 2.0 = wispy clumped tips
  subClumpStrength: number; // [0..1] secondary lock clustering
  curlRadiusMm: number; // 3D helical curl/wave amplitude in mm
  curlTurns: number; // number of helical revolutions along strand [0..14]
  waveAmplitudeMm: number; // planar S-wave undulation in mm
  waveCycles: number;
  frizzMm: number; // high-frequency coherent strand frizz in mm
  flyawayFraction: number; // [0..0.35] stray halo strands

  // Physical Melanin, Agouti Fur Banding & Cuticle Optics
  eumelanin: number; // [0..1.4] brown-black pigment
  pheomelanin: number; // [0..1.4] red-amber-gold pigment
  rootDarkening: number; // [0..0.85] natural darker follicle roots & AO
  tipBleach: number; // [0..1] sun-bleached / silver-frosted guard tips!
  agoutiBand: number; // [0..1] wild mammal sub-apical pale/amber band (wolf/agouti/fox!)
  undercoatWarmth: number; // [-0.5..0.5] lighter/creamier or darker undercoat contrast
  cuticleRoughness: number; // [0.08..0.75] longitudinal specular sharpness
  cuticleTiltDeg: number; // [-10..0] scale tilt shifting primary R specular toward root
}

export const DEFAULT_HAIR_PARAMS: HairParams = {
  flowMode: 'pelt_spine_flank',
  detailTier: 3,

  guideCount: 165,
  guardCount: 3600,
  undercoatCount: 5400,
  whiskerCount: 85,

  lengthCm: 9.5,
  lengthVar: 0.22,
  undercoatLengthRatio: 0.56,
  rootRadiusMm: 0.62,
  tipTaper: 0.94,
  strandSegments: 12,
  shaftSides: 3,

  rootLift: 0.44,
  combStrength: 0.78,
  partSharpness: 0.7,
  gravity: 0.62,
  stiffness: 1.55,

  clumpStrength: 0.58,
  clumpPower: 1.15,
  subClumpStrength: 0.36,
  curlRadiusMm: 1.4,
  curlTurns: 1.2,
  waveAmplitudeMm: 3.2,
  waveCycles: 1.8,
  frizzMm: 1.8,
  flyawayFraction: 0.08,

  eumelanin: 0.72,
  pheomelanin: 0.24,
  rootDarkening: 0.48,
  tipBleach: 0.52,
  agoutiBand: 0.62,
  undercoatWarmth: 0.35,
  cuticleRoughness: 0.26,
  cuticleTiltDeg: -5.5,
};

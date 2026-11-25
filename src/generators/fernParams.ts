/**
 * Parametric model for Ultra-Realistic High-Poly Ferns & Forest Vascular Plants.
 */

export type FernArchitecture =
  | 'pinnate_sword'
  | 'bipinnate_lacy'
  | 'shuttlecock_ostrich'
  | 'maidenhair_fan'
  | 'tree_fern'
  | 'broadleaf_rosette';

export const FERN_ARCH_NAMES: Record<FernArchitecture, string> = {
  pinnate_sword: '1-Pinnate Sword (Nephrolepis / Polystichum)',
  bipinnate_lacy: '2-Pinnate Lacy (Athyrium / Dryopteris)',
  shuttlecock_ostrich: 'Dimorphic Vase (Matteuccia Ostrich)',
  maidenhair_fan: 'Dichotomous Fan (Adiantum Maidenhair)',
  tree_fern: 'Arborescent Caudex (Dicksonia Tree Fern)',
  broadleaf_rosette: 'Sculpted Broadleaf (Hosta / Monstera)',
};

export type BroadleafSubtype = 'none' | 'hosta_bullate' | 'monstera_fenestrated' | 'calathea_pleated';

export const BROADLEAF_NAMES: Record<BroadleafSubtype, string> = {
  none: 'Standard Ovate Leaf',
  hosta_bullate: 'Hosta (Deeply Bullate Cordate)',
  monstera_fenestrated: 'Monstera (Fenestrated Clefts)',
  calathea_pleated: 'Calathea (Pleated Silver-Striped)',
};

export interface FernParams {
  architecture: FernArchitecture;
  broadleafPlaced: BroadleafSubtype;
  /** Poly budget / tessellation tier: 1 = Realtime, 2 = High Poly, 3 = Ultra Hero, 4 = Cinema Scan. */
  detailTier: number;

  // Crown & Rhizome
  crownRadius: number;
  caudexHeight: number; // > 0 for tree fern or elevated rhizome
  ramentaDensity: number; // chaffy brown scales at crown & stipe base [0..1]

  // Fronds / Rosette
  frondCount: number;
  frondLength: number;
  frondLengthVar: number;
  frondWidth: number;
  /** Naked petiole/stipe fraction before lowest pinna [0.05..0.55]. */
  stipeFraction: number;
  stipeRadius: number;
  /** Emergence tilt from vertical (inner whorls steeper, outer whorls wider) in degrees. */
  rosetteAngle: number;
  /** Gravity arch bend from base to tip in degrees. */
  archDroop: number;
  archPower: number;
  /** Natural lateral S-curve & twist. */
  rachisTwist: number;
  rachisWave: number;

  // Crosiers (coiled fiddleheads at crown center)
  crosierCount: number;
  crosierHeight: number;
  crosierTurns: number;

  // Pinnae & Leaf Lamina Anatomy
  pinnaPairs: number;
  /** Sub-leaflets per pinna side (used in bipinnate & maidenhair). */
  pinnulePairs: number;
  pinnaAngle: number; // insertion angle from rachis in degrees
  /** Asymmetric acroscopic basal lobe ("sword hilt" auricle) [0..1]. */
  auricle: number;
  /** Marginal tooth / lobe depth [0..0.45]. */
  serrationDepth: number;
  /** Marginal tooth frequency along edge [4..36]. */
  serrationCount: number;

  // High-Poly 3D Venation, Thickness & Micro-Relief
  /** Physical two-sided closed lamina thickness in mm (for primary blades/pinnae). */
  laminaThicknessMm: number;
  /** Extruded 3D costa/midrib prominence [0..1.5]. */
  midribRelief: number;
  /** Extruded 3D lateral secondary vein relief [0..1.5]. */
  veinRelief: number;
  /** Secondary vein pairs per leaflet [4..28]. */
  veinCount: number;
  /** Inter-vein mesophyll pillowing / quilting (bullation) [0..1]. */
  bullation: number;
  /** Transverse V-keel / arch camber across leaflet [-1..1]. */
  laminaCamber: number;
  /** Edge ruffle / undulation amplitude [0..1]. */
  edgeUndulation: number;
  /** Tip & margin curl [0..1]. */
  tipCurl: number;

  // Reproductive Sori & Physiological Pigmentation
  soriCoverage: number; // [0..1] underside spore clusters on mature fronds
  soriSizeMm: number;
  hueBase: string; // rich mature chlorophyll hex
  hueYoung: string; // fresh lime/chartreuse inner fronds & tips
  hueStipe: string; // dark mahogany/ebony/olive stipe base
  senescence: number; // [0..1] outer frond bronze-olive aging & tip dry curl
}

export const DEFAULT_FERN_PARAMS: FernParams = {
  architecture: 'pinnate_sword',
  broadleafPlaced: 'none',
  detailTier: 3,

  crownRadius: 0.065,
  caudexHeight: 0.04,
  ramentaDensity: 0.7,

  frondCount: 16,
  frondLength: 0.78,
  frondLengthVar: 0.16,
  frondWidth: 0.17,
  stipeFraction: 0.18,
  stipeRadius: 0.0042,
  rosetteAngle: 38,
  archDroop: 68,
  archPower: 1.55,
  rachisTwist: 12,
  rachisWave: 7,

  crosierCount: 4,
  crosierHeight: 0.22,
  crosierTurns: 2.6,

  pinnaPairs: 32,
  pinnulePairs: 12,
  pinnaAngle: 68,
  auricle: 0.55,
  serrationDepth: 0.09,
  serrationCount: 16,

  laminaThicknessMm: 0.55,
  midribRelief: 0.9,
  veinRelief: 0.85,
  veinCount: 14,
  bullation: 0.42,
  laminaCamber: 0.28,
  edgeUndulation: 0.32,
  tipCurl: 0.22,

  soriCoverage: 0.65,
  soriSizeMm: 1.4,
  hueBase: '#2d5e24',
  hueYoung: '#74a938',
  hueStipe: '#2f1e14',
  senescence: 0.18,
};

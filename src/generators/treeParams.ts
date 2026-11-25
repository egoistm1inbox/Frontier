/**
 * Parameters for Welded Woody Trees (`Trees · Welded Roots & Crown`),
 * combining Weber & Penn (SIGGRAPH 1995) botanical skeletons with Frontier-OLD's
 * closed-manifold root-to-trunk and branch-to-trunk quad welding (`V - E + F = 2`).
 */

export type TreeSpecies =
  | 'english_oak'
  | 'tropical_banyan'
  | 'japanese_maple'
  | 'african_baobab';

export const TREE_SPECIES_NAMES: Record<TreeSpecies, string> = {
  english_oak: 'English Oak (Quercus robur)',
  tropical_banyan: 'Buttress Rain-Tree (Samanea / Ficus)',
  japanese_maple: 'Japanese Maple (Acer palmatum)',
  african_baobab: 'African Bottle Baobab (Adansonia)',
};

export interface TreeGeneratorParams {
  species: TreeSpecies;
  /** 1..4 detail tier. */
  detailTier: number;
  /** Overall tree height in metres (4..24 m). */
  height: number;
  /** Trunk base radius ratio (0.014..0.095). */
  trunkRatio: number;
  /** Exponential trunk root flare (0..1.8). */
  basalFlare: number;
  /** Recursion depth (2..4: trunk -> limbs -> branches -> twigs). */
  branchLevels: number;
  /** Main limbs count (4..36). */
  limbCount: number;
  /** Branch emergence angle in degrees (25..82). */
  branchAngleDeg: number;
  /** Forking / dichotomous split tendency (0..0.85). */
  forkTendency: number;
  /** Canopy spread / flatten tendency (0..1). */
  canopyFlatten: number;
  /** Welded primary surface roots (0..10). */
  rootCount: number;
  /** Primary root reach as fraction of tree height (0.10..0.42). */
  rootReach: number;
  /** Root buttress lobe amplitude on lower trunk (0..0.75). */
  buttressRelief: number;
  /** Lateral & forked secondary roots per primary root (0..4). */
  rootLaterals: number;
  /** Branch/root collar Bezier fillet smoothness (0.2..0.98). */
  collarFillet: number;
  /** Da Vinci pipe-model cross-section conservation across junctions (0..1). */
  pipeConservation: number;
  /** Show sculpted 3D foliage canopy. */
  showLeaves: boolean;
  /** Foliage density multiplier (0.25..1.8). */
  leafDensity: number;
  /** Individual leaf length in metres (0.07..0.28). */
  leafSize: number;
  /** Wind sway compliance (0.2..2.0). */
  windCompliance: number;
  /** Bark & foliage hex colors. */
  hueBark: string;
  hueLeaf: string;
  hueLeafTip: string;
}

export type TreeParams = TreeGeneratorParams;

export const DEFAULT_TREE_PARAMS: TreeGeneratorParams = {
  species: 'english_oak',
  detailTier: 3,
  height: 13.5,
  trunkRatio: 0.025,
  basalFlare: 0.95,
  branchLevels: 4,
  limbCount: 15,
  branchAngleDeg: 52,
  forkTendency: 0.42,
  canopyFlatten: 0.15,
  rootCount: 6,
  rootReach: 0.24,
  buttressRelief: 0.38,
  rootLaterals: 2,
  collarFillet: 0.76,
  pipeConservation: 0.62,
  showLeaves: true,
  leafDensity: 1.0,
  leafSize: 0.24,
  windCompliance: 1.0,
  hueBark: '#5c4633',
  hueLeaf: '#2f6b20',
  hueLeafTip: '#74bd34',
};

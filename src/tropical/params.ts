/**
 * Plant parameters + species library.
 *
 * One superset of botanical parameters covers the four growth habits
 * (palm, paddle-leaf, rosette, branching tree); each species preset fills
 * the fields its habit reads. Everything is in metres / degrees.
 */

export type Habit = 'palm' | 'paddle' | 'rosette' | 'branching';
export type FrondType = 'pinnate' | 'palmate';

export interface BotanyParams {
  // ── trunk / stem ──────────────────────────────────────────────────────────
  trunkHeight: number;
  trunkRadius: number;
  /** Lean + sweep of the trunk, 0 (pole straight) .. 1 (strong curve). */
  trunkCurve: number;
  /** Trunk ring scars per metre (0 = smooth). */
  ringFrequency: number;
  /** Scar relief 0..1. */
  ringDepth: number;
  /** Smooth green crownshaft, fraction of trunk height at the top (palms). */
  crownshaft: number;
  /** Clustering stems welded into a shared root crown (areca, banana mats). */
  stemCount: number;
  /** Rosette: stem winds upward with leaves along it (monstera) when > 0. */
  stemClimb: number;

  // ── crown / fronds ────────────────────────────────────────────────────────
  frondType: FrondType;
  frondCount: number;
  frondLength: number;
  /** Frond droop curvature, 0 (stiff) .. 2 (weeping). */
  frondArc: number;
  /** Elevation difference between youngest spear and oldest frond, degrees. */
  crownSpread: number;
  /** Azimuth step between successive fronds, degrees (137.5 = golden spiral). */
  phyllotaxis: number;
  /** Dead fronds hanging as a skirt under the crown. */
  skirtFronds: number;
  /** Bare stalk fraction of the frond before leaflets / segments begin. */
  petioleRatio: number;

  // ── leaflets (pinnate) / segments (palmate) ───────────────────────────────
  leafletsPerSide: number;
  leafletLength: number;
  leafletWidth: number;
  /** Insertion angle from the rachis axis, degrees (90 = perpendicular). */
  leafletAngle: number;
  leafletDroop: number;
  /** Roll of the leaflet blade toward its tip, degrees. */
  leafletTwist: number;
  /** 0 = flat two-ranked V, 1 = plumose (multi-plane, feathery). */
  plume: number;

  // ── simple blades (paddle / rosette / branching leaves) ───────────────────
  leafLength: number;
  bladeWidth: number;
  bladeArc: number;
  /** Elevation the blade is held at, degrees (90 = facing the sky). */
  bladePitch: number;
  /** Monstera-style marginal splits, 0..1. */
  bladeNotch: number;
  /** Heart-shaped basal lobes, 0..1. */
  bladeLobes: number;

  // ── fruit / flowers ───────────────────────────────────────────────────────
  nutCount: number;
  nutSize: number;

  // ── branching trees ───────────────────────────────────────────────────────
  branchLevels: number;
  branchCount: number;
  branchAngle: number;
  /** Branch radius relative to parent (succulent frangipani ≈ 0.75). */
  branchTaper: number;
  leavesPerTip: number;
  compoundLeaf: 'simple' | 'palmate';

  // ── colour (flat colour, modulated procedurally per vertex) ───────────────
  leafColor: string;
  leafColor2: string;
  deadColor: string;
  trunkColor: string;
  trunkColor2: string;
  rachisColor: string;
  nutColor: string;
  nutColor2: string;
}

export interface MeshParams {
  trunkSides: number;
  /** Global ring-density scale, 0.5..2. */
  quality: number;
  leafletRings: number;
  bladeRings: number;
  /** Intermediate edge loops in every weld collar, 0..3. */
  collarRings: number;
  /** Collar length in child radii. */
  collarScale: number;
}

export interface RootParams {
  /** Basal flare / root bulge, 0..2. */
  flare: number;
  stiltCount: number;
  /** Stilt-root attachment height, fraction of trunk height. */
  stiltHeight: number;
}

export interface PlantParams {
  name: string;
  seed: number;
  habit: Habit;
  botany: BotanyParams;
  mesh: MeshParams;
  roots: RootParams;
}

export function cloneParams(p: PlantParams): PlantParams {
  return JSON.parse(JSON.stringify(p)) as PlantParams;
}

const MESH: MeshParams = { trunkSides: 24, quality: 1, leafletRings: 9, bladeRings: 30, collarRings: 1, collarScale: 0.85 };
const ROOTS: RootParams = { flare: 0.7, stiltCount: 0, stiltHeight: 0.12 };

function botany(o: Partial<BotanyParams>): BotanyParams {
  return {
    trunkHeight: 10, trunkRadius: 0.18, trunkCurve: 0.2, ringFrequency: 12, ringDepth: 0.35, crownshaft: 0, stemCount: 1, stemClimb: 0,
    frondType: 'pinnate', frondCount: 28, frondLength: 4.2, frondArc: 1, crownSpread: 95, phyllotaxis: 137.5, skirtFronds: 0, petioleRatio: 0.22,
    leafletsPerSide: 50, leafletLength: 0.85, leafletWidth: 0.032, leafletAngle: 48, leafletDroop: 0.7, leafletTwist: 35, plume: 0.15,
    leafLength: 2.2, bladeWidth: 0.55, bladeArc: 0.8, bladePitch: 35, bladeNotch: 0, bladeLobes: 0,
    nutCount: 0, nutSize: 0.16,
    branchLevels: 3, branchCount: 3, branchAngle: 42, branchTaper: 0.62, leavesPerTip: 6, compoundLeaf: 'simple',
    leafColor: '#3d7a26', leafColor2: '#86b43c', deadColor: '#9a7434', trunkColor: '#8a7a64', trunkColor2: '#6f6152', rachisColor: '#5c7031',
    nutColor: '#7a9a3a', nutColor2: '#c98a3a',
    ...o,
  };
}

function species(name: string, habit: Habit, b: Partial<BotanyParams>, r: Partial<RootParams> = {}, m: Partial<MeshParams> = {}): PlantParams {
  return { name, seed: 7, habit, botany: botany(b), mesh: { ...MESH, ...m }, roots: { ...ROOTS, ...r } };
}

export const PRESETS: PlantParams[] = [
  // ───────────────────────────── Palms · feather ─────────────────────────────
  species('Coconut Palm', 'palm', {
    trunkHeight: 13, trunkRadius: 0.17, trunkCurve: 0.55, ringFrequency: 13, ringDepth: 0.3,
    frondCount: 30, frondLength: 5.2, frondArc: 1.1, crownSpread: 110,
    leafletsPerSide: 56, leafletLength: 0.95, leafletWidth: 0.04, leafletAngle: 46, leafletDroop: 0.8, leafletTwist: 55, plume: 0.25,
    nutCount: 9, nutSize: 0.19, nutColor: '#86a83e', nutColor2: '#b6a04a',
    leafColor: '#3c7c24', leafColor2: '#8cbc40', trunkColor: '#8d7c65', trunkColor2: '#77664f',
  }, { flare: 1.1 }),
  species('Royal Palm', 'palm', {
    trunkHeight: 19, trunkRadius: 0.3, trunkCurve: 0.04, ringFrequency: 7, ringDepth: 0.12, crownshaft: 0.075,
    frondCount: 22, frondLength: 4.6, frondArc: 0.9, crownSpread: 85,
    leafletsPerSide: 64, leafletLength: 0.8, leafletWidth: 0.03, leafletAngle: 52, leafletDroop: 0.55, plume: 0.45,
    leafColor: '#2f6e22', leafColor2: '#74a83a', trunkColor: '#b5afa1', trunkColor2: '#5d8f3e',
  }, { flare: 1.4 }),
  species('Date Palm', 'palm', {
    trunkHeight: 14, trunkRadius: 0.3, trunkCurve: 0.1, ringFrequency: 9, ringDepth: 0.85,
    frondCount: 38, frondLength: 4.2, frondArc: 0.55, crownSpread: 105, skirtFronds: 6,
    leafletsPerSide: 52, leafletLength: 0.55, leafletWidth: 0.028, leafletAngle: 55, leafletDroop: 0.25, leafletTwist: 15, plume: 0.1,
    nutCount: 16, nutSize: 0.05, nutColor: '#d98a2e', nutColor2: '#a85a22',
    leafColor: '#54743c', leafColor2: '#8aa860', trunkColor: '#7d6448', trunkColor2: '#6b5138', rachisColor: '#7a6c3a',
  }, { flare: 0.8 }),
  species('Queen Palm', 'palm', {
    trunkHeight: 12, trunkRadius: 0.2, trunkCurve: 0.18, ringFrequency: 11, ringDepth: 0.4,
    frondCount: 26, frondLength: 4.6, frondArc: 1.25, crownSpread: 100,
    leafletsPerSide: 58, leafletLength: 0.75, leafletWidth: 0.026, leafletAngle: 50, leafletDroop: 1.0, leafletTwist: 60, plume: 0.95,
    nutCount: 10, nutSize: 0.035, nutColor: '#e0a33c', nutColor2: '#c97e2e',
    leafColor: '#35732a', leafColor2: '#7fb53e',
  }),
  species('Foxtail Palm', 'palm', {
    trunkHeight: 10, trunkRadius: 0.16, trunkCurve: 0.08, ringFrequency: 12, ringDepth: 0.25, crownshaft: 0.06,
    frondCount: 11, frondLength: 3.4, frondArc: 0.75, crownSpread: 90,
    leafletsPerSide: 58, leafletLength: 0.55, leafletWidth: 0.038, leafletAngle: 58, leafletDroop: 0.35, leafletTwist: 85, plume: 1,
    nutCount: 6, nutSize: 0.06, nutColor: '#c94f30', nutColor2: '#a83c22',
    leafColor: '#2e7026', leafColor2: '#6fae38', trunkColor: '#a99f8d', trunkColor2: '#5d8f3e',
  }),
  species('Areca Palm', 'palm', {
    trunkHeight: 5.5, trunkRadius: 0.055, trunkCurve: 0.3, ringFrequency: 16, ringDepth: 0.2, stemCount: 6, crownshaft: 0.1,
    frondCount: 8, frondLength: 2.2, frondArc: 1.15, crownSpread: 100, petioleRatio: 0.3,
    leafletsPerSide: 44, leafletLength: 0.5, leafletWidth: 0.03, leafletAngle: 50, leafletDroop: 0.7, plume: 0.3,
    leafColor: '#3f8a28', leafColor2: '#93c544', trunkColor: '#a8b06a', trunkColor2: '#7d9448', rachisColor: '#8aa83e',
  }, { flare: 0.4 }, { trunkSides: 16 }),

  // ────────────────────────────── Palms · fan ────────────────────────────────
  species('Mexican Fan Palm', 'palm', {
    frondType: 'palmate',
    trunkHeight: 20, trunkRadius: 0.19, trunkCurve: 0.12, ringFrequency: 14, ringDepth: 0.5,
    frondCount: 24, frondLength: 3.4, frondArc: 0.8, crownSpread: 95, skirtFronds: 22, petioleRatio: 0.52,
    leafletsPerSide: 34, leafletLength: 1.15, leafletWidth: 0.045, leafletAngle: 65, leafletDroop: 0.9, leafletTwist: 20,
    leafColor: '#3a7828', leafColor2: '#7fae3e', trunkColor: '#97836a', deadColor: '#a8874e',
  }, { flare: 0.9 }),
  species('Chinese Fan Palm', 'palm', {
    frondType: 'palmate',
    trunkHeight: 8, trunkRadius: 0.17, trunkCurve: 0.1, ringFrequency: 12, ringDepth: 0.45,
    frondCount: 30, frondLength: 3.0, frondArc: 0.85, crownSpread: 100, petioleRatio: 0.55,
    leafletsPerSide: 38, leafletLength: 1.05, leafletWidth: 0.04, leafletAngle: 62, leafletDroop: 1.5, leafletTwist: 25,
    leafColor: '#2f7024', leafColor2: '#74b03c',
  }),
  species('Bismarck Palm', 'palm', {
    frondType: 'palmate',
    trunkHeight: 12, trunkRadius: 0.34, trunkCurve: 0.05, ringFrequency: 8, ringDepth: 0.35,
    frondCount: 24, frondLength: 3.8, frondArc: 0.5, crownSpread: 80, petioleRatio: 0.48,
    leafletsPerSide: 30, leafletLength: 1.3, leafletWidth: 0.07, leafletAngle: 68, leafletDroop: 0.35, leafletTwist: 10,
    leafColor: '#7e97a3', leafColor2: '#a9bfc4', trunkColor: '#9c8f7c', rachisColor: '#8fa5a8',
  }, { flare: 1.2 }, { trunkSides: 28 }),
  species('Dwarf Palmetto', 'palm', {
    frondType: 'palmate',
    trunkHeight: 0.4, trunkRadius: 0.16, trunkCurve: 0, ringFrequency: 10, ringDepth: 0.4,
    frondCount: 26, frondLength: 1.9, frondArc: 0.7, crownSpread: 105, petioleRatio: 0.5,
    leafletsPerSide: 26, leafletLength: 0.65, leafletWidth: 0.04, leafletAngle: 64, leafletDroop: 0.6,
    leafColor: '#3d7a2c', leafColor2: '#84b444',
  }, { flare: 0.5 }, { trunkSides: 20 }),

  // ───────────────────────────── Banana family ───────────────────────────────
  species('Banana', 'paddle', {
    trunkHeight: 3.2, trunkRadius: 0.15, trunkCurve: 0.08, ringFrequency: 0, stemCount: 3,
    frondCount: 9, petioleRatio: 0.22, crownSpread: 85,
    leafLength: 3.1, bladeWidth: 0.72, bladeArc: 1.0, bladePitch: 32,
    nutCount: 1, nutSize: 0.16, nutColor: '#e5c33c', nutColor2: '#7e3a5e',
    leafColor: '#3f8a2a', leafColor2: '#8cc63f', trunkColor: '#7d9a4a', trunkColor2: '#97b45e', rachisColor: '#86aa4e',
  }, { flare: 0.5 }, { trunkSides: 18 }),
  species('Bird of Paradise', 'paddle', {
    trunkHeight: 0.25, trunkRadius: 0.14, ringFrequency: 0, phyllotaxis: 180, stemCount: 1,
    frondCount: 9, petioleRatio: 0.58, crownSpread: 55,
    leafLength: 1.7, bladeWidth: 0.24, bladeArc: 0.35, bladePitch: 55,
    nutCount: 3, nutSize: 0.14, nutColor: '#e86a2a', nutColor2: '#3a5ea8',
    leafColor: '#2e6e34', leafColor2: '#5da24a', rachisColor: '#5d8a42',
  }, { flare: 0.3 }, { trunkSides: 16 }),
  species("Traveler's Palm", 'paddle', {
    trunkHeight: 7, trunkRadius: 0.2, trunkCurve: 0.05, ringFrequency: 6, ringDepth: 0.3, phyllotaxis: 180,
    frondCount: 15, petioleRatio: 0.42, crownSpread: 78,
    leafLength: 3.6, bladeWidth: 0.62, bladeArc: 0.7, bladePitch: 40,
    leafColor: '#35802c', leafColor2: '#7cb83e', trunkColor: '#8a7a5e', rachisColor: '#6d9440',
  }, { flare: 1.0 }, { trunkSides: 20 }),
  species('Heliconia', 'paddle', {
    trunkHeight: 1.6, trunkRadius: 0.045, ringFrequency: 0, stemCount: 4, phyllotaxis: 180,
    frondCount: 5, petioleRatio: 0.3, crownSpread: 70,
    leafLength: 1.5, bladeWidth: 0.3, bladeArc: 0.8, bladePitch: 38,
    nutCount: 2, nutSize: 0.11, nutColor: '#d8402e', nutColor2: '#e8a02e',
    leafColor: '#357a28', leafColor2: '#7fbc3e', trunkColor: '#6d9448', rachisColor: '#77a04a',
  }, { flare: 0.3 }, { trunkSides: 12 }),

  // ───────────────────────────── Big-leaf plants ─────────────────────────────
  species('Elephant Ear', 'rosette', {
    trunkHeight: 0.3, trunkRadius: 0.16, ringFrequency: 0,
    frondCount: 9, petioleRatio: 0.45,
    leafLength: 1.9, bladeWidth: 0.78, bladeArc: 0.5, bladePitch: 62, bladeLobes: 0.85,
    leafColor: '#2e7030', leafColor2: '#63a844', trunkColor: '#6d8a4c', rachisColor: '#74a04e',
  }, { flare: 0.3 }, { trunkSides: 16 }),
  species('Monstera', 'rosette', {
    trunkHeight: 2.6, trunkRadius: 0.035, ringFrequency: 0, stemClimb: 1, phyllotaxis: 180,
    frondCount: 13, petioleRatio: 0.48,
    leafLength: 1.5, bladeWidth: 0.62, bladeArc: 0.45, bladePitch: 55, bladeNotch: 0.85, bladeLobes: 0.55,
    leafColor: '#256b2c', leafColor2: '#4d9a3e', trunkColor: '#5d8140', rachisColor: '#63904a',
  }, { flare: 0.2, stiltCount: 5, stiltHeight: 0.5 }, { trunkSides: 12 }),
  species('Split-leaf Philodendron', 'rosette', {
    trunkHeight: 0.55, trunkRadius: 0.09, ringFrequency: 3, ringDepth: 0.3,
    frondCount: 10, petioleRatio: 0.48,
    leafLength: 1.7, bladeWidth: 0.7, bladeArc: 0.6, bladePitch: 48, bladeNotch: 0.65, bladeLobes: 0.7,
    leafColor: '#2b7230', leafColor2: '#5aa843', trunkColor: '#7a6a4e', rachisColor: '#6d9a48',
  }, { flare: 0.4, stiltCount: 4, stiltHeight: 0.4 }, { trunkSides: 14 }),
  species('Giant Taro', 'rosette', {
    trunkHeight: 0.35, trunkRadius: 0.2, ringFrequency: 0,
    frondCount: 8, petioleRatio: 0.5,
    leafLength: 2.1, bladeWidth: 0.9, bladeArc: 0.45, bladePitch: 70, bladeLobes: 0.6,
    leafColor: '#3a7d52', leafColor2: '#74b06e', trunkColor: '#77a05e', rachisColor: '#83ac66',
  }, { flare: 0.3 }, { trunkSides: 16 }),

  // ───────────────────────────── Tropical trees ──────────────────────────────
  species('Frangipani', 'branching', {
    trunkHeight: 1.4, trunkRadius: 0.13, trunkCurve: 0.15, ringFrequency: 0,
    branchLevels: 3, branchCount: 3, branchAngle: 38, branchTaper: 0.78, leavesPerTip: 8, compoundLeaf: 'simple',
    petioleRatio: 0.3, leafLength: 0.42, bladeWidth: 0.09, bladeArc: 0.5, bladePitch: 30,
    nutCount: 5, nutSize: 0.05, nutColor: '#f2e6ee', nutColor2: '#e88bb0',
    leafColor: '#2f7030', leafColor2: '#5fa843', trunkColor: '#9a8d7a', trunkColor2: '#8a7d68', rachisColor: '#7d9a52',
  }, { flare: 0.6 }, { trunkSides: 18 }),
  species('Umbrella Tree', 'branching', {
    trunkHeight: 2.8, trunkRadius: 0.07, trunkCurve: 0.1, ringFrequency: 0,
    branchLevels: 3, branchCount: 3, branchAngle: 48, branchTaper: 0.6, leavesPerTip: 3, compoundLeaf: 'palmate',
    petioleRatio: 0.55, leafLength: 0.75, bladeWidth: 0.36, bladeArc: 0.4, bladePitch: 42,
    leafColor: '#2c7030', leafColor2: '#5dab44', trunkColor: '#8a7a5e', rachisColor: '#6d9a48',
  }, { flare: 0.5 }, { trunkSides: 16 }),
  species('Fiddle-leaf Fig', 'branching', {
    trunkHeight: 2.4, trunkRadius: 0.06, trunkCurve: 0.12, ringFrequency: 0,
    branchLevels: 2, branchCount: 2.4, branchAngle: 35, branchTaper: 0.65, leavesPerTip: 5, compoundLeaf: 'simple',
    petioleRatio: 0.14, leafLength: 0.5, bladeWidth: 0.3, bladeArc: 0.35, bladePitch: 35, bladeLobes: 0.35,
    leafColor: '#245c2a', leafColor2: '#498a3a', trunkColor: '#7d6c55', rachisColor: '#5d8a42',
  }, { flare: 0.4 }, { trunkSides: 14 }),
];

export const PRESET_GROUPS: { label: string; icon: string; accent: string; names: string[] }[] = [
  { label: 'Palms · feather', icon: 'palm', accent: '#34c759', names: ['Coconut Palm', 'Royal Palm', 'Date Palm', 'Queen Palm', 'Foxtail Palm', 'Areca Palm'] },
  { label: 'Palms · fan', icon: 'palm', accent: '#4fd8e0', names: ['Mexican Fan Palm', 'Chinese Fan Palm', 'Bismarck Palm', 'Dwarf Palmetto'] },
  { label: 'Banana family', icon: 'banana', accent: '#e5d33a', names: ['Banana', 'Bird of Paradise', "Traveler's Palm", 'Heliconia'] },
  { label: 'Big-leaf plants', icon: 'leaf', accent: '#8fd15a', names: ['Elephant Ear', 'Monstera', 'Split-leaf Philodendron', 'Giant Taro'] },
  { label: 'Tropical trees', icon: 'tree', accent: '#ffb454', names: ['Frangipani', 'Umbrella Tree', 'Fiddle-leaf Fig'] },
];

export function groupOf(name: string): string {
  return PRESET_GROUPS.find((g) => g.names.includes(name))?.label ?? 'Custom';
}

/** Rough mature height for the library meta line. */
export function plantHeight(p: PlantParams): number {
  const b = p.botany;
  switch (p.habit) {
    case 'palm':
      return b.trunkHeight + b.frondLength * 0.55;
    case 'paddle':
      return b.trunkHeight + b.leafLength * 0.75;
    case 'rosette':
      return Math.max(b.trunkHeight, b.leafLength * 0.72);
    case 'branching':
      return b.trunkHeight * (1 + b.branchLevels * 0.55);
  }
}

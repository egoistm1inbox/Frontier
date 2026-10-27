/**
 * Plant parameters + species library.
 *
 * One superset of botanical parameters covers the growth habits
 * (palm, paddle-leaf, rosette, branching tree, grain, vegetable crop);
 * each species preset fills the fields its habit reads. Metres / degrees.
 */

export type Habit = 'palm' | 'paddle' | 'rosette' | 'branching' | 'grain' | 'vegetable';
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
  /** Where the blade is widest, 0 (at base) .. 1 (at tip): fiddle/obovate ≈ 0.65. */
  bladePeak: number;
  /** Blade halves hang down either side of the midrib (banana), 0..1. */
  bladeVee: number;
  /** Perpendicular wind-tears splitting the blade into strips (banana), 0..1. */
  bladeTears: number;

  // ── fruit / flowers ───────────────────────────────────────────────────────
  /** 'nuts' = individual fruits under the crown; 'dates' = hanging bunches of small fruit on strands. */
  fruitStyle: 'nuts' | 'dates';
  nutCount: number;
  nutSize: number;

  // ── branching trees ───────────────────────────────────────────────────────
  /** lateral = branches along the parent; fork = terminal dichotomy (frangipani); leader = upright trunk with sparse laterals (fiddle-leaf). */
  branchStyle: 'lateral' | 'fork' | 'leader';
  branchLevels: number;
  branchCount: number;
  branchAngle: number;
  /** Branch radius relative to parent (succulent frangipani ≈ 0.75). */
  branchTaper: number;
  leavesPerTip: number;
  compoundLeaf: 'simple' | 'palmate';

  // ── grains & vegetable crops ──────────────────────────────────────────────
  /** corn = tassels + husked ears; spike = dense head; panicle = branched head; cane = jointed sugarcane. */
  grainType: 'corn' | 'spike' | 'panicle' | 'cane';
  cropType: 'tomato' | 'strawberry' | 'pepper' | 'sunflower' | 'pumpkin' | 'cabbage';
  /** Length of the bristles/awns on each grain (wheat), metres. */
  awnLength: number;

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
    leafLength: 2.2, bladeWidth: 0.55, bladeArc: 0.8, bladePitch: 35, bladeNotch: 0, bladeLobes: 0, bladePeak: 0.38, bladeVee: 0.15, bladeTears: 0,
    fruitStyle: 'nuts', nutCount: 0, nutSize: 0.16,
    branchStyle: 'lateral', branchLevels: 3, branchCount: 3, branchAngle: 42, branchTaper: 0.62, leavesPerTip: 6, compoundLeaf: 'simple',
    grainType: 'spike', cropType: 'tomato', awnLength: 0,
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
    fruitStyle: 'dates', nutCount: 5, nutSize: 0.045, nutColor: '#e09a2e', nutColor2: '#8a4a26',
    leafColor: '#54743c', leafColor2: '#8aa860', trunkColor: '#7d6448', trunkColor2: '#6b5138', rachisColor: '#7a6c3a',
  }, { flare: 0.8 }),
  species('Queen Palm', 'palm', {
    trunkHeight: 12, trunkRadius: 0.2, trunkCurve: 0.18, ringFrequency: 11, ringDepth: 0.4,
    frondCount: 26, frondLength: 4.6, frondArc: 1.25, crownSpread: 100,
    leafletsPerSide: 58, leafletLength: 0.75, leafletWidth: 0.026, leafletAngle: 50, leafletDroop: 1.0, leafletTwist: 60, plume: 0.95,
    fruitStyle: 'dates', nutCount: 3, nutSize: 0.03, nutColor: '#e8a832', nutColor2: '#c46a26',
    leafColor: '#35732a', leafColor2: '#7fb53e',
  }),
  species('Foxtail Palm', 'palm', {
    trunkHeight: 10, trunkRadius: 0.16, trunkCurve: 0.08, ringFrequency: 12, ringDepth: 0.25, crownshaft: 0.06,
    frondCount: 11, frondLength: 3.4, frondArc: 0.75, crownSpread: 90,
    leafletsPerSide: 58, leafletLength: 0.55, leafletWidth: 0.038, leafletAngle: 58, leafletDroop: 0.35, leafletTwist: 85, plume: 1,
    fruitStyle: 'dates', nutCount: 3, nutSize: 0.035, nutColor: '#d84f2c', nutColor2: '#93321e',
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
    trunkHeight: 3.2, trunkRadius: 0.16, trunkCurve: 0.08, ringFrequency: 0, stemCount: 3,
    frondCount: 10, petioleRatio: 0.15, crownSpread: 100,
    leafLength: 3.2, bladeWidth: 0.75, bladeArc: 1.15, bladePitch: 30, bladePeak: 0.5, bladeVee: 0.85, bladeTears: 0.55,
    nutCount: 1, nutSize: 0.16, nutColor: '#e5c33c', nutColor2: '#7e3a5e',
    leafColor: '#3f8a2a', leafColor2: '#8cc63f', trunkColor: '#7d9a4a', trunkColor2: '#97b45e', rachisColor: '#86aa4e',
  }, { flare: 0.5 }, { trunkSides: 18 }),
  species('Bird of Paradise', 'paddle', {
    trunkHeight: 0.25, trunkRadius: 0.14, ringFrequency: 0, phyllotaxis: 180, stemCount: 1,
    frondCount: 11, petioleRatio: 0.58, crownSpread: 62,
    leafLength: 1.85, bladeWidth: 0.26, bladeArc: 0.4, bladePitch: 50, bladePeak: 0.55, bladeVee: 0.5, bladeTears: 0.3,
    nutCount: 3, nutSize: 0.14, nutColor: '#e86a2a', nutColor2: '#3a5ea8',
    leafColor: '#2e6e34', leafColor2: '#5da24a', rachisColor: '#5d8a42',
  }, { flare: 0.3 }, { trunkSides: 16 }),
  species("Traveler's Palm", 'paddle', {
    trunkHeight: 7, trunkRadius: 0.2, trunkCurve: 0.05, ringFrequency: 6, ringDepth: 0.3, phyllotaxis: 180,
    frondCount: 16, petioleRatio: 0.44, crownSpread: 85,
    leafLength: 3.8, bladeWidth: 0.6, bladeArc: 0.55, bladePitch: 38, bladePeak: 0.5, bladeVee: 0.65, bladeTears: 0.85,
    leafColor: '#35802c', leafColor2: '#7cb83e', trunkColor: '#8a7a5e', rachisColor: '#6d9440',
  }, { flare: 1.0 }, { trunkSides: 20 }),
  species('Heliconia', 'paddle', {
    trunkHeight: 1.7, trunkRadius: 0.05, ringFrequency: 0, stemCount: 5, phyllotaxis: 180,
    frondCount: 6, petioleRatio: 0.28, crownSpread: 75,
    leafLength: 1.6, bladeWidth: 0.3, bladeArc: 0.85, bladePitch: 36, bladePeak: 0.5, bladeVee: 0.7, bladeTears: 0.35,
    nutCount: 2, nutSize: 0.11, nutColor: '#d8402e', nutColor2: '#e8a02e',
    leafColor: '#357a28', leafColor2: '#7fbc3e', trunkColor: '#6d9448', rachisColor: '#77a04a',
  }, { flare: 0.3 }, { trunkSides: 12 }),

  // ───────────────────────────── Big-leaf plants ─────────────────────────────
  species('Elephant Ear', 'rosette', {
    trunkHeight: 0.3, trunkRadius: 0.16, ringFrequency: 0,
    frondCount: 11, petioleRatio: 0.48,
    leafLength: 2.0, bladeWidth: 0.82, bladeArc: 0.55, bladePitch: 68, bladeLobes: 0.9, bladePeak: 0.32, bladeVee: 0.1,
    leafColor: '#2e7030', leafColor2: '#63a844', trunkColor: '#6d8a4c', rachisColor: '#74a04e',
  }, { flare: 0.3 }, { trunkSides: 16 }),
  species('Monstera', 'rosette', {
    trunkHeight: 2.6, trunkRadius: 0.035, ringFrequency: 0, stemClimb: 1, phyllotaxis: 180,
    frondCount: 14, petioleRatio: 0.48,
    leafLength: 1.55, bladeWidth: 0.64, bladeArc: 0.5, bladePitch: 58, bladeNotch: 0.92, bladeLobes: 0.6, bladePeak: 0.38, bladeVee: 0.12,
    leafColor: '#256b2c', leafColor2: '#4d9a3e', trunkColor: '#5d8140', rachisColor: '#63904a',
  }, { flare: 0.2, stiltCount: 5, stiltHeight: 0.5 }, { trunkSides: 12 }),
  species('Split-leaf Philodendron', 'rosette', {
    trunkHeight: 0.55, trunkRadius: 0.09, ringFrequency: 3, ringDepth: 0.3,
    frondCount: 12, petioleRatio: 0.48,
    leafLength: 1.75, bladeWidth: 0.72, bladeArc: 0.65, bladePitch: 50, bladeNotch: 0.85, bladeLobes: 0.75, bladePeak: 0.4, bladeVee: 0.18,
    leafColor: '#2b7230', leafColor2: '#5aa843', trunkColor: '#7a6a4e', rachisColor: '#6d9a48',
  }, { flare: 0.4, stiltCount: 4, stiltHeight: 0.4 }, { trunkSides: 14 }),
  species('Giant Taro', 'rosette', {
    trunkHeight: 0.35, trunkRadius: 0.2, ringFrequency: 0,
    frondCount: 9, petioleRatio: 0.5,
    leafLength: 2.15, bladeWidth: 0.92, bladeArc: 0.5, bladePitch: 74, bladeLobes: 0.65, bladePeak: 0.34, bladeVee: 0.08,
    leafColor: '#3a7d52', leafColor2: '#74b06e', trunkColor: '#77a05e', rachisColor: '#83ac66',
  }, { flare: 0.3 }, { trunkSides: 16 }),

  // ───────────────────────────── Tropical trees ──────────────────────────────
  species('Frangipani', 'branching', {
    trunkHeight: 1.3, trunkRadius: 0.14, trunkCurve: 0.15, ringFrequency: 0,
    branchStyle: 'fork', branchLevels: 3, branchCount: 2.6, branchAngle: 36, branchTaper: 0.8, leavesPerTip: 8, compoundLeaf: 'simple',
    petioleRatio: 0.32, leafLength: 0.46, bladeWidth: 0.1, bladeArc: 0.55, bladePitch: 32, bladePeak: 0.45, bladeVee: 0.25,
    nutCount: 5, nutSize: 0.05, nutColor: '#f2e6ee', nutColor2: '#e88bb0',
    leafColor: '#2f7030', leafColor2: '#5fa843', trunkColor: '#9a8d7a', trunkColor2: '#8a7d68', rachisColor: '#7d9a52',
  }, { flare: 0.6 }, { trunkSides: 18 }),
  species('Umbrella Tree', 'branching', {
    trunkHeight: 3.1, trunkRadius: 0.07, trunkCurve: 0.1, ringFrequency: 0,
    branchStyle: 'lateral', branchLevels: 3, branchCount: 3, branchAngle: 50, branchTaper: 0.6, leavesPerTip: 3, compoundLeaf: 'palmate',
    petioleRatio: 0.55, leafLength: 0.8, bladeWidth: 0.38, bladeArc: 0.45, bladePitch: 42,
    leafColor: '#2c7030', leafColor2: '#5dab44', trunkColor: '#8a7a5e', rachisColor: '#6d9a48',
  }, { flare: 0.5 }, { trunkSides: 16 }),
  species('Fiddle-leaf Fig', 'branching', {
    trunkHeight: 2.6, trunkRadius: 0.06, trunkCurve: 0.12, ringFrequency: 0,
    branchStyle: 'leader', branchLevels: 1, branchCount: 4, branchAngle: 38, branchTaper: 0.62, leavesPerTip: 7, compoundLeaf: 'simple',
    petioleRatio: 0.13, leafLength: 0.52, bladeWidth: 0.32, bladeArc: 0.4, bladePitch: 38, bladeLobes: 0.3, bladePeak: 0.68, bladeVee: 0.1,
    leafColor: '#245c2a', leafColor2: '#498a3a', trunkColor: '#7d6c55', rachisColor: '#5d8a42',
  }, { flare: 0.4 }, { trunkSides: 14 }),
  // ───────────────────────────── Grains & cereals ────────────────────────────
  species('Corn (Maize)', 'grain', {
    grainType: 'corn',
    trunkHeight: 2.3, trunkRadius: 0.022, trunkCurve: 0.04, ringFrequency: 0, stemCount: 1, phyllotaxis: 180,
    frondCount: 14, petioleRatio: 0.3,
    leafLength: 1.0, bladeWidth: 0.09, bladeArc: 1.05, bladePitch: 30, bladePeak: 0.35, bladeVee: 0.25,
    nutCount: 2, nutSize: 0.055, nutColor: '#ecbe3c', nutColor2: '#c09a72',
    leafColor: '#4c8c2c', leafColor2: '#81bd40', trunkColor: '#7d9a4a', trunkColor2: '#93b45e', rachisColor: '#86aa4e', deadColor: '#b39b5a',
  }, { flare: 0.4, stiltCount: 6, stiltHeight: 0.06 }, { trunkSides: 12 }),
  species('Pearl Millet', 'grain', {
    grainType: 'spike',
    trunkHeight: 2.0, trunkRadius: 0.013, trunkCurve: 0.05, ringFrequency: 0, stemCount: 4, phyllotaxis: 180,
    frondCount: 10, petioleRatio: 0.32,
    leafLength: 0.85, bladeWidth: 0.045, bladeArc: 1.0, bladePitch: 32, bladePeak: 0.32, bladeVee: 0.2, awnLength: 0.014,
    nutCount: 60, nutSize: 0.011, nutColor: '#b3a284', nutColor2: '#8f8266',
    leafColor: '#5d8a3e', leafColor2: '#8cb45e', trunkColor: '#7d9a58', trunkColor2: '#93ad68', rachisColor: '#86a258',
  }, { flare: 0.3 }, { trunkSides: 10 }),
  species('Wheat', 'grain', {
    grainType: 'spike',
    trunkHeight: 0.95, trunkRadius: 0.005, trunkCurve: 0.03, ringFrequency: 0, stemCount: 7, phyllotaxis: 180,
    frondCount: 6, petioleRatio: 0.35,
    leafLength: 0.4, bladeWidth: 0.016, bladeArc: 0.9, bladePitch: 35, bladePeak: 0.3, bladeVee: 0.15, awnLength: 0.085,
    nutCount: 26, nutSize: 0.012, nutColor: '#e0b154', nutColor2: '#c49a44',
    leafColor: '#a89a4d', leafColor2: '#cbbd6a', trunkColor: '#c2a45c', trunkColor2: '#d3b96e', rachisColor: '#c8ae60',
  }, { flare: 0.2 }, { trunkSides: 8 }),
  species('Rice', 'grain', {
    grainType: 'panicle',
    trunkHeight: 1.0, trunkRadius: 0.006, trunkCurve: 0.05, ringFrequency: 0, stemCount: 8, phyllotaxis: 180,
    frondCount: 7, petioleRatio: 0.3,
    leafLength: 0.55, bladeWidth: 0.02, bladeArc: 1.35, bladePitch: 30, bladePeak: 0.3, bladeVee: 0.2, awnLength: 0,
    nutCount: 46, nutSize: 0.009, nutColor: '#dcC26a', nutColor2: '#c2a452',
    leafColor: '#4d8c34', leafColor2: '#7fb84e', trunkColor: '#7d9a58', trunkColor2: '#93ad68', rachisColor: '#86a258',
  }, { flare: 0.2 }, { trunkSides: 8 }),
  species('Sorghum', 'grain', {
    grainType: 'panicle',
    trunkHeight: 2.2, trunkRadius: 0.017, trunkCurve: 0.04, ringFrequency: 0, stemCount: 2, phyllotaxis: 180,
    frondCount: 11, petioleRatio: 0.3,
    leafLength: 0.85, bladeWidth: 0.07, bladeArc: 1.0, bladePitch: 32, bladePeak: 0.34, bladeVee: 0.22, awnLength: 0.006,
    nutCount: 64, nutSize: 0.011, nutColor: '#b04a2e', nutColor2: '#8a5a30',
    leafColor: '#4d8a34', leafColor2: '#7fb54a', trunkColor: '#7d9a58', trunkColor2: '#93ad68', rachisColor: '#8a9a54',
  }, { flare: 0.3 }, { trunkSides: 12 }),
  species('Sugarcane', 'grain', {
    grainType: 'cane',
    trunkHeight: 3.0, trunkRadius: 0.028, trunkCurve: 0.06, ringFrequency: 0, stemCount: 5, phyllotaxis: 180,
    frondCount: 12, petioleRatio: 0.24,
    leafLength: 1.3, bladeWidth: 0.055, bladeArc: 1.15, bladePitch: 34, bladePeak: 0.3, bladeVee: 0.25,
    nutCount: 0,
    leafColor: '#4d8a34', leafColor2: '#82b84a', trunkColor: '#9a8aa8', trunkColor2: '#7d9a5e', rachisColor: '#86aa4e', deadColor: '#b39b5a',
  }, { flare: 0.4 }, { trunkSides: 14 }),

  // ─────────────────────────────── Vegetables ────────────────────────────────
  species('Tomato', 'vegetable', {
    cropType: 'tomato',
    trunkHeight: 1.05, trunkRadius: 0.012, trunkCurve: 0.12, ringFrequency: 0,
    branchStyle: 'lateral', branchLevels: 2, branchCount: 3, branchAngle: 48, branchTaper: 0.62, leavesPerTip: 3,
    petioleRatio: 0.28, leafLength: 0.28, bladeWidth: 0.17, bladeArc: 0.55, bladePitch: 38,
    nutCount: 4, nutSize: 0.036, nutColor: '#d83a26', nutColor2: '#86b83e',
    leafColor: '#3a7a2e', leafColor2: '#63a844', trunkColor: '#6d8a4c', trunkColor2: '#7d9a58', rachisColor: '#74a04e',
  }, { flare: 0.3 }, { trunkSides: 10 }),
  species('Strawberry', 'vegetable', {
    cropType: 'strawberry',
    trunkHeight: 0.07, trunkRadius: 0.05, ringFrequency: 0,
    frondCount: 9, petioleRatio: 0.62,
    leafLength: 0.23, bladeWidth: 0.095, bladeArc: 0.35, bladePitch: 46, bladePeak: 0.5,
    nutCount: 6, nutSize: 0.02, nutColor: '#d8263a', nutColor2: '#f4f1e4',
    leafColor: '#2e7030', leafColor2: '#55a043', trunkColor: '#7a6a4e', rachisColor: '#6d9a48',
  }, { flare: 0.2 }, { trunkSides: 12 }),
  species('Chili Pepper', 'vegetable', {
    cropType: 'pepper',
    trunkHeight: 0.34, trunkRadius: 0.012, trunkCurve: 0.06, ringFrequency: 0,
    branchStyle: 'lateral', branchLevels: 2, branchCount: 3, branchAngle: 44, branchTaper: 0.62, leavesPerTip: 5,
    petioleRatio: 0.22, leafLength: 0.14, bladeWidth: 0.055, bladeArc: 0.45, bladePitch: 36, bladePeak: 0.42,
    nutCount: 14, nutSize: 0.055, nutColor: '#d82626', nutColor2: '#4a9a2e',
    leafColor: '#2e7030', leafColor2: '#55a043', trunkColor: '#6d8a4c', trunkColor2: '#7d9a58', rachisColor: '#5d8a42',
  }, { flare: 0.3 }, { trunkSides: 10 }),
  species('Sunflower', 'vegetable', {
    cropType: 'sunflower',
    trunkHeight: 1.9, trunkRadius: 0.024, trunkCurve: 0.05, ringFrequency: 0, phyllotaxis: 137.5,
    frondCount: 11, petioleRatio: 0.38,
    leafLength: 0.44, bladeWidth: 0.3, bladeArc: 0.55, bladePitch: 42, bladeLobes: 0.55, bladePeak: 0.34, bladeVee: 0.12,
    nutCount: 1, nutSize: 0.13, nutColor: '#f4bc22', nutColor2: '#5a3a22',
    leafColor: '#3d7a2c', leafColor2: '#68aa44', trunkColor: '#6d8a4c', trunkColor2: '#7d9a58', rachisColor: '#74a04e',
  }, { flare: 0.4 }, { trunkSides: 14 }),
  species('Pumpkin', 'vegetable', {
    cropType: 'pumpkin',
    trunkHeight: 0.28, trunkRadius: 0.03, ringFrequency: 0,
    frondCount: 10, petioleRatio: 0.55,
    leafLength: 0.85, bladeWidth: 0.34, bladeArc: 0.5, bladePitch: 52, bladeLobes: 0.8, bladeNotch: 0.35, bladePeak: 0.36,
    nutCount: 2, nutSize: 0.17, nutColor: '#e07820', nutColor2: '#c45e16',
    leafColor: '#35702a', leafColor2: '#64a843', trunkColor: '#6d8a4c', rachisColor: '#74a04e',
  }, { flare: 0.3 }, { trunkSides: 12 }),
  species('Cabbage', 'vegetable', {
    cropType: 'cabbage',
    trunkHeight: 0.12, trunkRadius: 0.045, ringFrequency: 0,
    frondCount: 9, petioleRatio: 0.2,
    leafLength: 0.52, bladeWidth: 0.34, bladeArc: 0.35, bladePitch: 58, bladeLobes: 0.3, bladePeak: 0.48, bladeVee: 0.08,
    nutCount: 1, nutSize: 0.125, nutColor: '#bcd4a2', nutColor2: '#9dbd84',
    leafColor: '#5d8a4e', leafColor2: '#83ac66', trunkColor: '#77a05e', rachisColor: '#83ac66',
  }, { flare: 0.2 }, { trunkSides: 12 }),
];

export const PRESET_GROUPS: { label: string; icon: string; accent: string; names: string[] }[] = [
  { label: 'Palms · feather', icon: 'palm', accent: '#34c759', names: ['Coconut Palm', 'Royal Palm', 'Date Palm', 'Queen Palm', 'Foxtail Palm', 'Areca Palm'] },
  { label: 'Palms · fan', icon: 'palm', accent: '#4fd8e0', names: ['Mexican Fan Palm', 'Chinese Fan Palm', 'Bismarck Palm', 'Dwarf Palmetto'] },
  { label: 'Banana family', icon: 'banana', accent: '#e5d33a', names: ['Banana', 'Bird of Paradise', "Traveler's Palm", 'Heliconia'] },
  { label: 'Big-leaf plants', icon: 'leaf', accent: '#8fd15a', names: ['Elephant Ear', 'Monstera', 'Split-leaf Philodendron', 'Giant Taro'] },
  { label: 'Tropical trees', icon: 'tree', accent: '#ffb454', names: ['Frangipani', 'Umbrella Tree', 'Fiddle-leaf Fig'] },
  { label: 'Grains & cereals', icon: 'wheat', accent: '#e0b83a', names: ['Corn (Maize)', 'Pearl Millet', 'Wheat', 'Rice', 'Sorghum', 'Sugarcane'] },
  { label: 'Vegetables', icon: 'carrot', accent: '#ff7847', names: ['Tomato', 'Strawberry', 'Chili Pepper', 'Sunflower', 'Pumpkin', 'Cabbage'] },
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
    case 'grain':
      return b.trunkHeight * 1.12;
    case 'vegetable':
      return Math.max(b.trunkHeight * 1.35, b.leafLength * 0.8);
  }
}

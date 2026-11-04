// Single source of truth for every size / budget in the engine.
// All world units are metres unless a name says otherwise.

/** Continent domain: a square of 8000 km × 8000 km centred on the origin (Africa-scale). */
export const WORLD = {
  halfExtentM: 4_000_000,
  /** Resolution of the 2D coastline SDF texture (texels per side). */
  coastTexels: 2048,
  /** Coastline distances are stored truncated to ±band (km). */
  coastBandKm: 64,
} as const;

export const BRICK = {
  /** Voxel cells per brick side. */
  cells: 32,
  /** Stored samples per brick side: cells + 1 shared border on each side. */
  texels: 34,
  /** Stored SDF is truncated to ±bandCells × cellSize (keeps R16F precision high). */
  bandCells: 4,
} as const;

export const LOD = {
  /** Number of clipmap levels. Level i has cell size baseCellM × 2^i. */
  levels: 8,
  baseCellM: 0.5,
  /** Bricks per level window (x, y, z). The window is centred on the camera. */
  grid: [16, 8, 16] as const,
} as const;

export const POOL = {
  /** Physical brick slots in the shared atlas. */
  slots: 8192,
  /** Slots per atlas z-block (16 × 16). */
  slotsPerLayerXY: 16,
  /** Bricks processed by the scratch buffer in one sculpt batch. */
  scratchBricks: 32,
} as const;

export const STREAM = {
  /** Bricks classified (uniform test) per frame. */
  classifyPerFrame: 256,
  /** Bricks generated / uploaded per frame. */
  generatePerFrame: 24,
  /** Pressure-driven readbacks of edited bricks per frame. */
  readbacksPerFrame: 4,
  /** Assumed Lipschitz bound of the field, used by the conservative uniform test. */
  uniformLipschitz: 1.5,
  /** Extra metres of margin in the uniform test. */
  uniformSafetyM: 0.5,
  /** A resident brick is only evicted for a candidate this many times closer. */
  evictHysteresis: 1.5,
} as const;

export const SCULPT = {
  minRadiusM: 1,
  /** Limits the dab footprint at the finest level to ≤ 27 bricks (one scratch batch). */
  maxRadiusM: 12,
  defaultRadiusM: 4,
  defaultStrength: 0.5,
} as const;

export const VRAM_BUDGET_BYTES = 1024 * 1024 * 1024;

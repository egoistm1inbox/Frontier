// CPU brick classification for the clipmap: decides whether a brick can be stored as a uniform
// air/solid code (no atlas slot) or must be generated as a mixed brick. Lives in clipmap/ so tests
// and the app share one implementation.
import { BRICK, STREAM } from '../config.ts';
import { type MacroField, macroSDF } from '../world/macroReference.ts';
import { brickCenter, cellSize } from './layout.ts';
import type { BrickClass } from './residency.ts';

/**
 * Brick class from the CPU macro reference. A brick is uniform only if its centre is farther from
 * the surface than the conservative bound (half-diagonal × Lipschitz + clamp band + safety margin).
 */
export function classifyBrick(field: MacroField, lv: number, x: number, y: number, z: number): BrickClass {
  const cs = cellSize(lv);
  const c = brickCenter(lv, x, y, z);
  const d = macroSDF(field, c[0], c[1], c[2], 8);
  const halfDiag = (BRICK.cells / 2) * Math.sqrt(3) * cs;
  const margin = halfDiag * STREAM.uniformLipschitz + BRICK.bandCells * cs + STREAM.uniformSafetyM;
  if (d > margin) return 'air';
  if (d < -margin) return 'solid';
  return 'mixed';
}

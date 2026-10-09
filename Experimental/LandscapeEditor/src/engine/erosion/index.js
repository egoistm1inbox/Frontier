// Dispatch to one erosion solver. Every solver takes the same arguments:
//   height  Float32Array of normalised heights, updated in place
//   params  the parameter object for this erosion type (see specs.js)
//   ctx     { size, cellMetres, maxHeight, random, checkpoint(fraction, preview?) }
// Each solver returns { removedVolume, depositedVolume } in cubic metres where it can.

import { erodeDroplets, erodeStreamPower } from './hydraulic.js';
import { erodeThermal, erodeWind } from './dry.js';

export async function runErosion(type, height, params, ctx) {
  switch (type) {
    case 'droplet':
      return erodeDroplets(height, ctx.size, params, ctx);
    case 'stream':
      return erodeStreamPower(height, ctx.size, params, ctx);
    case 'thermal':
      return erodeThermal(height, ctx.size, params, ctx);
    case 'wind':
      return erodeWind(height, ctx.size, params, ctx);
    default:
      throw new Error(`Unknown erosion type: ${type}`);
  }
}

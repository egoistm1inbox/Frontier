#!/usr/bin/env node
/**
 * Frontier Headless CLI Asset Baker for AAA Game Pipelines.
 *
 * Usage:
 *   npm run generate -- --archetype desert-arch --seed 4029 --quality high --out exports/arch.glb
 *   npm run generate -- --archetype sedimentary-cliff --seed 4029 --out exports/cliff.glb
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateRockFormation } from '../src/geology/generator.js';
import { exportFormationToGLB } from '../src/io/glb-exporter.js';
import { exportFormationToOBJ } from '../src/io/obj-exporter.js';
import { FORMATION_PRESETS } from '../src/geology/presets.js';

function parseArgs(argv) {
  const opts = {
    archetype: 'desert-arch',
    seed: 4029,
    quality: 'high',
    decimation: 1.0,
    lods: false,
    out: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--archetype' && argv[i + 1]) opts.archetype = argv[++i];
    else if (a === '--preset' && argv[i + 1]) opts.archetype = argv[++i];
    else if (a === '--seed' && argv[i + 1]) opts.seed = Number(argv[++i]);
    else if (a === '--quality' && argv[i + 1]) opts.quality = argv[++i];
    else if (a === '--decimation' && argv[i + 1]) opts.decimation = Number(argv[++i]);
    else if (a === '--scale' && argv[i + 1]) opts.scale = Number(argv[++i]);
    else if (a === '--dip' && argv[i + 1]) opts.dipAngle = Number(argv[++i]);
    else if (a === '--out' && argv[i + 1]) opts.out = argv[++i];
    else if (a === '--lods') opts.lods = true;
    else if (a === '--help' || a === '-h') {
      console.log('Frontier CLI Baker\nArchetypes:', Object.keys(FORMATION_PRESETS).join(', '));
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv);
const outBase = opts.out || `exports/frontier_${opts.archetype}_${opts.seed}.glb`;
fs.mkdirSync(path.dirname(path.resolve(outBase)), { recursive: true });

if (opts.lods) {
  const stem = outBase.replace(/\.(glb|obj)$/i, '');
  const lodTargets = [
    { suffix: 'LOD0', ratio: 0.40 },
    { suffix: 'LOD1', ratio: 0.16 },
    { suffix: 'LOD2', ratio: 0.06 },
  ];
  for (const lod of lodTargets) {
    const res = generateRockFormation({ ...opts, decimation: lod.ratio });
    const file = `${stem}_${lod.suffix}.glb`;
    fs.writeFileSync(file, exportFormationToGLB(res));
    console.log(`[LOD] ${lod.suffix} -> ${file} (${res.stats.triangles} tris, ${res.stats.elapsedMs}ms)`);
  }
} else {
  const res = generateRockFormation(opts);
  if (outBase.toLowerCase().endsWith('.obj')) {
    fs.writeFileSync(outBase, exportFormationToOBJ(res));
  } else {
    fs.writeFileSync(outBase, exportFormationToGLB(res));
  }
  console.log(`[Baked] ${res.stats.archetypeName} (seed ${opts.seed}) -> ${outBase}`);
  console.log(`        ${res.stats.triangles.toLocaleString()} tris | ${res.stats.dimensions.join('m x ')}m | ${res.stats.elapsedMs}ms`);
}

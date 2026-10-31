/**
 * Unified Procedural Rock & Cliff Synthesis Pipeline Orchestrator.
 */

import { createRng } from '../core/prng.js';
import { evaluateSparseSdf } from '../core/sparse-sdf.js';
import { extractDualContourMesh } from '../core/dual-contour.js';
import {
  removeFloatingIslands,
  taubinSmoothWeldedMesh,
  decimateMeshQEM,
  buildGameReadyAttributes,
} from '../core/mesh-post.js';
import { resolveParams, QUALITY_LEVELS, FORMATION_PRESETS } from './presets.js';
import { createTectonicField } from './tectonics.js';
import { buildMacroFormation } from './formations.js';
import { createGeologicalSdfEvaluator } from './surface-detail.js';

export function generateRockFormation(rawParams = {}, onProgress = null) {
  const t0 = performance.now();
  const params = resolveParams(rawParams);
  const rng = createRng(params.seed);

  if (onProgress) onProgress(0.03, 'Synthesizing tectonic stress & joint sets...');
  const tectonics = createTectonicField(params, rng.fork('tectonics'));

  if (onProgress) onProgress(0.08, 'Sculpting 3D structural rock blocks & curves...');
  const macro = buildMacroFormation(params, tectonics, rng.fork('macro'));

  // Compute tight bounding box around all positive blocks & 3D arch curves
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const allPositives = macro.curves ? [...macro.blocks, ...macro.curves] : macro.blocks;
  for (let i = 0; i < allPositives.length; i++) {
    const b = allPositives[i];
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.minZ < minZ) minZ = b.minZ;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    if (b.maxZ > maxZ) maxZ = b.maxZ;
  }

  if (!Number.isFinite(minX)) {
    minX = -2; minY = 0; minZ = -2;
    maxX = 2; maxY = 3; maxZ = 2;
  }

  const qSpec = QUALITY_LEVELS[params.quality] || QUALITY_LEVELS.high;
  const evaluator = createGeologicalSdfEvaluator(macro, params, rng.fork('detail'));
  const pad = evaluator.detailMargin + params.scale * 0.025;
  const bounds = {
    minX: minX - pad,
    minY: (macro.groundY !== null ? macro.groundY : minY) - pad * 0.6,
    minZ: minZ - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    maxZ: maxZ + pad,
  };

  const maxSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
  const voxelSize = maxSpan / qSpec.maxAxisVoxels;

  const sdf = evaluateSparseSdf(bounds, voxelSize, evaluator, onProgress);

  const dc = extractDualContourMesh(sdf, {
    qefRegularization: 0.014,
    rootSteps: 2,
  }, onProgress);

  if (onProgress) onProgress(0.84, 'Filtering islands & relaxing surface...');
  const cleaned = removeFloatingIslands(
    dc.positions,
    dc.indices,
    macro.groundY ?? 0,
    voxelSize * 3.5
  );

  const preset = FORMATION_PRESETS[params.archetype] || FORMATION_PRESETS['cliff-wall'];
  const surfacePositions = taubinSmoothWeldedMesh(
    cleaned.positions,
    cleaned.indices,
    2,
    macro.groundY ?? 0
  );

  const rawTriCount = cleaned.indices.length / 3;
  const decimated = params.decimation < 0.98
    ? decimateMeshQEM(surfacePositions, cleaned.indices, params.decimation)
    : { positions: surfacePositions, indices: cleaned.indices };

  if (onProgress) onProgress(0.92, 'Baking volumetric AO, curvature & normals...');
  const finalMesh = buildGameReadyAttributes(
    decimated.positions,
    decimated.indices,
    sdf,
    {
      creaseAngleDeg: params.creaseAngle ?? 68,
      uvScale: 0.35,
      evalRockColor: evaluator.evalRockColor || null,
    }
  );

  // Compute exact final mesh AABB & center X/Z around origin while keeping groundY = 0
  let fMinX = Infinity, fMinY = Infinity, fMinZ = Infinity;
  let fMaxX = -Infinity, fMaxY = -Infinity, fMaxZ = -Infinity;
  const pos = finalMesh.positions;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < fMinX) fMinX = x; if (x > fMaxX) fMaxX = x;
    if (y < fMinY) fMinY = y; if (y > fMaxY) fMaxY = y;
    if (z < fMinZ) fMinZ = z; if (z > fMaxZ) fMaxZ = z;
  }

  const shiftX = -0.5 * (fMinX + fMaxX);
  const shiftY = -fMinY;
  const shiftZ = -0.5 * (fMinZ + fMaxZ);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] += shiftX;
    pos[i + 1] += shiftY;
    pos[i + 2] += shiftZ;
  }

  const elapsedMs = Math.round(performance.now() - t0);

  if (onProgress) onProgress(1.0, 'Ready');

  return {
    params,
    lithology: preset.lithology,
    mesh: finalMesh,
    stats: {
      archetypeName: preset.name,
      blockCount: macro.blocks.length,
      cutCount: macro.cuts.length,
      faultCount: tectonics.faults.length,
      voxelSize: Number(voxelSize.toFixed(4)),
      gridDims: [sdf.nx, sdf.ny, sdf.nz],
      activeBricks: sdf.activeBrickCoords.length / 4,
      rawTriangles: rawTriCount,
      triangles: finalMesh.indices.length / 3,
      vertices: finalMesh.positions.length / 3,
      removedIslands: cleaned.removedIslands,
      dimensions: [
        Number((fMaxX - fMinX).toFixed(2)),
        Number((fMaxY - fMinY).toFixed(2)),
        Number((fMaxZ - fMinZ).toFixed(2)),
      ],
      elapsedMs,
    },
  };
}

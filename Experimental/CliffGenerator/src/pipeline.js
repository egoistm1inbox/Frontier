// End-to-end heightfield pipeline. Pure JS, no DOM — runs in the worker and under Node for checks.
//
//   synthesizeBase → applyStrata (+hardness) → thermal pre-settle → hydraulic erosion → thermal
//   → derived maps (deposit, flow, cavity, slope) packed for the vertex attributes.

import { synthesizeBase, applyStrata, computeCavity, computeSlopeMap } from './heightfield.js';
import { hydraulicErosion, thermalErosion, blurField } from './erosion.js';
import { carveRivers, NO_WATER } from './features.js';
import { simulateRivers } from './hydrology.js';
import { addOutcrops } from './outcrops.js';
import { applyRugged } from './rugged.js';

export function generateTerrain(params, progress = () => {}) {
  const N = params.resolution;
  const cell = params.worldSize / (N - 1);
  const t0 = now();

  progress({ phase: 'Synthesising base relief', fraction: 0 });
  const height = synthesizeBase(params, (f) => progress({ phase: 'Synthesising base relief', fraction: f }));

  // boulder outcrops are part of the landform: added before strata and erosion
  const outcrop = addOutcrops(height, params);

  progress({ phase: 'Layering strata', fraction: 0 });
  const hardness = applyStrata(height, params, (f) => progress({ phase: 'Layering strata', fraction: f }), outcrop);
  for (let i = 0; i < N * N; i++) if (outcrop[i] > 0) hardness[i] = Math.max(hardness[i], 0.55 + 0.4 * outcrop[i]);

  // Rugged outcrops (Gaea Rugged / Outcrops / Rocky): shattered plates + crevices broken into
  // the relief BEFORE erosion, so the water weathers them and drainage adapts to them.
  let rugged = null;
  if ((params.ruggedAmount || 0) > 0) {
    progress({ phase: 'Breaking rugged outcrops', fraction: 0 });
    rugged = applyRugged(height, hardness, params, outcrop, (f) => progress({ phase: 'Breaking rugged outcrops', fraction: f }));
  } else {
    rugged = new Float32Array(N * N);
  }

  const erosionParams = { ...params, heightScale: Math.max(1, params.mountainHeight) };

  progress({ phase: 'Thermal settling', fraction: 0 });
  thermalErosion(height, hardness, { ...erosionParams, thermalIterations: Math.ceil(params.thermalIterations * 0.3) },
    (f) => progress({ phase: 'Thermal settling', fraction: f }));

  // Drawn rivers: carve the channel first so the slopes drain into it, and seed the erosion with it.
  const rivers = (params.features && params.features.rivers) || [];
  const riverOpts = {
    width: params.riverWidth, depth: params.riverDepth, bankAngle: params.riverBank, maxBank: params.riverMaxBank, meander: params.riverMeander,
    water: true, waterDepth: params.riverWaterDepth,
  };
  let riverResult = { riverMask: new Float32Array(N * N), waterLevel: new Float32Array(N * N).fill(NO_WATER), sources: [] };
  if (rivers.length) {
    progress({ phase: 'Carving rivers', fraction: 0 });
    riverResult = carveRivers(height, N, params.worldSize, rivers, riverOpts, params.seed);
    erosionParams.sources = riverResult.sources;
    erosionParams.sourceFraction = 0.6 * params.riverErosion;
    erosionParams.sourceWater = 1.5 + 4 * params.riverErosion;
  }

  progress({ phase: 'Hydraulic erosion', fraction: 0 });
  const { flow, delta } = hydraulicErosion(height, hardness, erosionParams,
    (f) => progress({ phase: 'Hydraulic erosion', fraction: f }));

  progress({ phase: 'Scree slumping', fraction: 0 });
  const slumped = thermalErosion(height, hardness, erosionParams,
    (f) => progress({ phase: 'Scree slumping', fraction: f }));

  if (rivers.length) {
    // Restore the bed to its profile after erosion/slumping and take the final mask + water level.
    progress({ phase: 'Settling river beds', fraction: 0 });
    riverResult = carveRivers(height, N, params.worldSize, rivers, riverOpts, params.seed);
  }

  // Simulated drainage: the drawn rivers are guides (already carved + injected as flow); the
  // network itself comes from the eroded surface.
  let hydro = null;
  const lake = new Float32Array(N * N);
  if (params.riverSim) {
    progress({ phase: 'Simulating rivers', fraction: 0 });
    hydro = simulateRivers(height, N, params.worldSize, {
      catchment: params.riverCatchment, widthScale: params.riverWidthScale, maxWidth: params.riverMaxWidth, depthScale: params.riverDepthScale,
      bankAngle: params.riverBank, maxBank: params.riverMaxBank, waterDepth: params.riverWaterFrac, braiding: params.riverBraiding, drySlope: params.riverDrySlope, dryBig: params.riverDryBig,
      lakes: params.riverLakes, lakeFill: params.riverLakeFill, lakeMaxArea: (params.riverLakeMax == null ? 8 : params.riverLakeMax) / 100, lakeMinArea: Math.round((params.riverLakeMin || 0.01) * 1e6 / (cell * cell)),
      connect: params.lakeConnect, connectLen: params.lakeConnectLen,
      sediment: params.fluvialSediment, deltaSize: params.fluvialDelta, hardness,
      seaLevel: params.waterEnabled ? params.seaLevel : -Infinity, sources: riverResult.sources, guideFlow: params.riverGuideFlow,
    }, params.seed);
    for (let i = 0; i < N * N; i++) {
      riverResult.riverMask[i] = Math.max(riverResult.riverMask[i], hydro.riverMask[i]);
      riverResult.waterLevel[i] = Math.max(riverResult.waterLevel[i], hydro.waterLevel[i]);
      lake[i] = hydro.lakeMask[i];
    }
  }

  progress({ phase: 'Deriving shading maps', fraction: 0 });

  // Deposit: hydraulic sediment + thermally slumped material → scree/gravel aprons.
  const depositRaw = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) depositRaw[i] = Math.max(0, delta[i]) + slumped[i] * 0.6;
  const deposit = normalisePercentile(blurField(depositRaw, N, 2), 0.985);

  // Flow accumulation on a log scale → wet streaks, darkened gully floors.
  const flowRaw = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) flowRaw[i] = Math.log1p(flow[i]);
  const flowNorm = normalisePercentile(blurField(flowRaw, N, 1), 0.995);
  if (hydro) {
    // drainage network → wet gully floors; channels and lake shores → gravel / silt deposits
    for (let i = 0; i < N * N; i++) {
      const f = hydro.flow[i];
      flowNorm[i] = Math.max(flowNorm[i], f * f * 0.95);
      deposit[i] = Math.max(deposit[i], riverResult.riverMask[i] * 0.8, lake[i] * 0.5, Math.min(1, hydro.fluvialDep[i] / 1.5));
    }
  }

  // core-stones shed their debris: no scree skin on the boulders themselves
  for (let i = 0; i < N * N; i++) if (outcrop[i] > 0) deposit[i] *= 1 - 0.85 * outcrop[i];
  // rugged plates stand proud of the scree: thin the debris skin where rock is exposed
  for (let i = 0; i < N * N; i++) if (rugged[i] > 0) deposit[i] *= 1 - 0.55 * rugged[i];

  const cavityRaw = computeCavity(height, N, cell);
  const cavity = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) cavity[i] = Math.max(-1, Math.min(1, cavityRaw[i] * 1.5));

  const slope = computeSlopeMap(height, N, cell);

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < N * N; i++) {
    if (height[i] < min) min = height[i];
    if (height[i] > max) max = height[i];
  }

  progress({ phase: 'Done', fraction: 1 });
  return {
    resolution: N,
    worldSize: params.worldSize,
    height, hardness, deposit, flow: flowNorm, cavity, slope,
    river: riverResult.riverMask, waterLevel: riverResult.waterLevel, lake, outcrop, rugged,
    stats: { min, max, elapsedMs: now() - t0, rivers: hydro ? hydro.stats : null },
  };
}

function normalisePercentile(field, pct) {
  const sorted = Float32Array.from(field).sort();
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] || 1e-6;
  const out = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) out[i] = Math.min(1, field[i] / hi);
  return out;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

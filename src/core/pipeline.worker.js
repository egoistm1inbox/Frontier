/**
 * Frontier Landscape Studio — bake worker.
 *
 * The whole layer stack, every erosion pass and the surface texture bake run
 * here so the editor stays interactive. Erosion at 90,000 droplets takes well
 * over a second; running it on the main thread would freeze the viewport.
 *
 * Messages in:  { id, type: 'bake', payload }  |  { type: 'cancel' }
 * Messages out: { id, type: 'progress' | 'done' | 'error', ... }
 */

import { bakeStack } from './layers.js';
import { bakeSurfaceTexture, detailNormalTexture } from './textures.js';
import { slopeField, waterMask } from './erosion.js';

let cancelled = false;
let currentId = null;

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'cancel') { cancelled = true; return; }
  if (message.type !== 'bake') return;
  cancelled = false;
  currentId = message.id;
  const started = performance.now();

  try {
    bake(message.payload, message.id, started);
  } catch (error) {
    self.postMessage({ id: message.id, type: 'error', message: error?.message || String(error) });
  }
};

function progress(id, fraction, label, phase) {
  if (fraction < 0) fraction = 0;
  if (fraction > 1) fraction = 1;
  self.postMessage({ id, type: 'progress', fraction, label, phase });
}

function bake(payload, id, started) {
  const {
    layers, resolution: res, brushBuffers, importedBuffer, importedSize,
    texture, textureSize, seaLevel, seed, wantTexture = true, detailSeed = 7,
    worldSize = 2048, maxHeight = 900,
  } = payload;

  const n = res * res;

  // Reattach transferred brush and import fields.
  const brushFields = {};
  for (const [layerId, buffer] of Object.entries(brushBuffers || {})) {
    brushFields[layerId] = new Float32Array(buffer);
  }
  const imported = importedBuffer ? new Float32Array(importedBuffer) : null;

  const result = bakeStack(layers, res, {
    brushFields,
    imported,
    worldSize,
    maxHeight,
    captureLayers: !!payload.captureLayers,
    captureBefore: payload.captureBefore || [],
    onProgress: (f, label) => {
      // Layers are cheap; erosion is where the time actually goes.
      progress(id, f * 0.45, label, 'layer');
    },
    onErosionProgress: (f, label) => {
      erosionFraction = f;
      erosionPhase = label;
      progress(id, 0.05 + f * 0.4, label, 'erosion');
    },
  });

  if (cancelled) return;
  progress(id, 0.46, 'Diagnostics', 'diagnostics');

  const slope = slopeField(result.height, res);
  const water = payload.waterOverride !== undefined
    ? waterMask(result.height, res, payload.waterOverride, 0.012)
    : waterMask(result.height, res, seaLevel, 0.012);

  if (cancelled) return;

  let albedo = null;
  let albedoSize = 0;
  if (wantTexture && texture) {
    progress(id, 0.5, 'Surface texture', 'texture');
    const flowForTexture = result.flowNorm || result.flow;
    const talus = normalizeSmall(result.talus, n);
    const baked = bakeSurfaceTexture({
      res,
      heightField: result.height,
      slopeField: slope,
      flowField: flowForTexture,
      talusField: talus,
      layers: texture.layers || [],
      size: textureSize || 1024,
      seaLevel,
      seed,
    });
    albedo = baked.data;
    albedoSize = baked.size;
  }

  if (cancelled) return;
  progress(id, 0.94, 'Detail normals', 'texture');
  const detail = detailNormalTexture(256, detailSeed);

  // Pack erosion delta (removed minus added) for the diagnostic view.
  const erosionDelta = new Float32Array(n);
  for (let i = 0; i < n; i++) erosionDelta[i] = result.deposited[i] - result.eroded[i];

  const transfer = [
    result.height.buffer, slope.buffer, water.buffer,
    result.eroded.buffer, result.deposited.buffer, erosionDelta.buffer,
    (result.flowNorm || result.flow).buffer, result.talus.buffer, detail.data.buffer,
  ];
  if (albedo) transfer.push(albedo.buffer);

  // Pre-brush snapshots travel back so a stroke can be previewed locally
  // without waiting for the next full bake.
  const capturePayload = {};
  for (const [layerId, field] of Object.entries(result.captures || {})) {
    capturePayload[layerId] = field.buffer;
    transfer.push(field.buffer);
  }

  progress(id, 1, 'Ready', 'done');

  self.postMessage({
    id,
    type: 'done',
    resolution: res,
    height: result.height.buffer,
    slope: slope.buffer,
    water: water.buffer,
    eroded: result.eroded.buffer,
    deposited: result.deposited.buffer,
    erosionDelta: erosionDelta.buffer,
    flow: (result.flowNorm || result.flow).buffer,
    talus: result.talus.buffer,
    albedo: albedo ? albedo.buffer : null,
    albedoSize,
    detail: detail.data.buffer,
    detailSize: detail.size,
    stats: result.stats,
    layerOutputs: (result.layerOutputs || []).map((o) => ({ id: o.id, name: o.name })),
    captures: capturePayload,
    ms: performance.now() - started,
  }, transfer);
}

/** Talus accumulates without bound; compress it for display and texture rules. */
function normalizeSmall(field, n) {
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.log1p(Math.max(0, field[i]) * 4000);
    out[i] = v;
    if (v > max) max = v;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  return out;
}

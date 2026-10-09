// Evaluates the layer stack from the bottom up, caching each layer's output by a chained key.
// The key of layer i includes the keys of every layer below it, so changing one layer
// recomputes that layer and everything above it, and nothing below it.

import { applyLayer } from './layers.js';
import { downsample } from './grid.js';
import { fnv1a } from './random.js';

export const THUMBNAIL_SIZE = 64;

export class CancelledError extends Error {
  constructor() {
    super('Evaluation cancelled');
    this.name = 'CancelledError';
  }
}

export function terrainKey(settings) {
  // Sea level is only used for shading and water, so it is left out of the terrain key.
  return fnv1a(JSON.stringify([settings.size, settings.resolution, settings.maxHeight, settings.seed]));
}

export async function evaluateStack(project, options = {}) {
  const { settings, layers } = project;
  const { cache = new Map(), force = false, checkpoint = async () => {}, onLayer = () => {} } = options;
  const size = settings.resolution;
  const cellMetres = settings.size / (size - 1);
  const ctx = {
    settings,
    size,
    cellMetres,
    maxHeight: settings.maxHeight,
    checkpoint,
  };

  let heights = new Float32Array(size * size);
  let key = terrainKey(settings);
  const used = new Set();
  const results = [];
  let erosionDelta = new Float32Array(size * size);
  let cacheHits = 0;
  const started = performance.now();

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    // Only fields that change the output go into the key, so renaming a layer keeps its cache.
    const signature = JSON.stringify({
      kind: layer.kind,
      enabled: layer.enabled,
      opacity: layer.opacity,
      blend: layer.blend,
      seed: layer.seed,
      mask: layer.mask,
      params: layer.params,
    });
    key = fnv1a(key + signature);
    used.add(key);
    // Force replays erosion only: it is deterministic, so downstream cache entries stay valid.
    let entry = force && layer.kind === 'erosion' ? undefined : cache.get(key);
    const cached = entry !== undefined;
    if (cached) {
      cacheHits += 1;
    } else if (!layer.enabled) {
      entry = { heights, delta: null, metrics: null, skipped: true };
    } else {
      await checkpoint(0, null, layer.id);
      const layerCtx = { ...ctx, layerId: layer.id, checkpoint: (fraction, preview) => checkpoint(fraction, preview, layer.id) };
      entry = await applyLayer(heights, layer, layerCtx);
      entry.skipped = false;
    }
    cache.set(key, entry);
    if (layer.kind === 'erosion' && entry.delta && layer.enabled) {
      for (let i = 0; i < erosionDelta.length; i += 1) erosionDelta[i] += entry.delta[i];
    }
    heights = entry.heights;
    const result = {
      id: layer.id,
      index,
      skipped: !!entry.skipped,
      cached,
      snapshot: downsample(heights, size, THUMBNAIL_SIZE),
      metrics: entry.metrics,
    };
    results.push(result);
    onLayer(result);
  }

  for (const cached of [...cache.keys()]) if (!used.has(cached)) cache.delete(cached);
  return {
    heights,
    erosionDelta,
    results,
    key,
    cacheHits,
    size,
    cellMetres,
    milliseconds: performance.now() - started,
  };
}

// Web Worker entry: evaluates the layer stack off the main thread and posts
// progress + the resulting channel stack back. Arrays are transferred.

import { computeTerrain } from './pipeline.js';

self.onmessage = (e) => {
  const { type, runId, layers, terrain } = e.data || {};
  if (type !== 'compute') return;
  try {
    const result = computeTerrain({
      layers,
      size: terrain.size,
      seed: terrain.seed,
      waterLevel: terrain.waterLevel,
      onProgress: (progress, layerName) => {
        self.postMessage({ type: 'progress', runId, progress, layerName });
      },
    });
    self.postMessage({ type: 'done', runId, result }, [
      result.height.buffer, result.heightN.buffer, result.slopeN.buffer,
      result.rivers.buffer, result.sediment.buffer, result.strata.buffer,
      result.strataPhase.buffer,
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', runId, message: String(err && err.message || err) });
  }
};

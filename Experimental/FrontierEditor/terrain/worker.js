// Evaluation worker: owns the layer caches so the UI thread never blocks on erosion.
// Messages in:  { type: 'terrain', id, world, layers }  |  { type: 'texture', id, layers }
// Messages out: { type: 'progress' | 'terrain-done' | 'texture-done' | 'error', id, ... }

import { createTerrainCache, evaluateTerrainCached } from './stack.js';
import { evaluateTexturing, toRGBA8 } from './texturing.js';

const cache = createTerrainCache();
let current = null; // { st, world } — the last terrain result, used by texturing requests

self.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'terrain') {
      const t0 = performance.now();
      if (msg.fresh) { cache.world = null; cache.entries = []; } // Regenerate: drop every snapshot
      const { state, timings, reused } = evaluateTerrainCached(msg.world, msg.layers, cache, (index, count, layer) => {
        self.postMessage({ type: 'progress', id: msg.id, stage: 'terrain', index, count, label: layer.type });
      });
      current = { st: state, world: msg.world };
      const copy = (a) => a.slice();
      const fields = {
        height: copy(state.height), water: copy(state.water), hardness: copy(state.hardness),
        riverMask: copy(state.riverMask), lakeMask: copy(state.lakeMask), seaMask: copy(state.seaMask),
        sediment: copy(state.sediment), outcrop: copy(state.outcrop),
      };
      const transfer = Object.values(fields).map((a) => a.buffer);
      self.postMessage({
        type: 'terrain-done', id: msg.id, N: state.N, size: state.size, sea: state.sea,
        ms: performance.now() - t0, reused, count: msg.layers.length, timings, fields,
      }, transfer);
    } else if (msg.type === 'texture') {
      if (!current) {
        self.postMessage({ type: 'texture-done', id: msg.id, skipped: true });
        return;
      }
      const t0 = performance.now();
      const { out, timings } = evaluateTexturing(current.st, msg.layers, (index, count, layer) => {
        self.postMessage({ type: 'progress', id: msg.id, stage: 'texture', index, count, label: layer.type });
      });
      const rgba = toRGBA8(out);
      const rough = new Uint8Array(out.rough.length);
      for (let i = 0; i < rough.length; i++) rough[i] = Math.round(Math.min(1, Math.max(0, out.rough[i])) * 255);
      self.postMessage({ type: 'texture-done', id: msg.id, N: current.st.N, ms: performance.now() - t0, count: msg.layers.length, timings, rgba, rough }, [rgba.buffer, rough.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, message: String(error && error.stack ? error.stack : error) });
  }
};

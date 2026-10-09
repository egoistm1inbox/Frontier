// Runs the layer stack off the main thread so the UI stays responsive during erosion.
// Jobs are superseded: a newer evaluate message (or a cancel) makes the running job stop at its
// next checkpoint, and its messages are never posted.

import { evaluateProject, CancelledError } from '../engine/evaluate.js';

const cache = new Map();
const satmapCache = {};
let currentJob = 0;

const PROGRESS_INTERVAL = 80; // ms between progress messages
const PREVIEW_INTERVAL = 280; // ms between heightmap previews while an erosion layer runs

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    currentJob = 0;
    return;
  }
  if (message.type !== 'evaluate') return;

  const jobId = message.jobId;
  currentJob = jobId;
  let lastProgress = 0;
  let lastPreview = 0;
  const isCurrent = () => currentJob === jobId;

  // Called by the engine between layers and inside long loops. Throws to abandon the job.
  const checkpoint = async (fraction, preview, layerId) => {
    if (!isCurrent()) throw new CancelledError();
    const now = performance.now();
    if (layerId && (now - lastProgress >= PROGRESS_INTERVAL || fraction >= 1)) {
      lastProgress = now;
      self.postMessage({ type: 'progress', jobId, layerId, fraction });
    }
    if (preview && now - lastPreview >= PREVIEW_INTERVAL) {
      lastPreview = now;
      self.postMessage({ type: 'preview', jobId, layerId, heights: Float32Array.from(preview) });
    }
    // Yield so that a newer message (cancel or evaluate) can be received.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) throw new CancelledError();
  };

  try {
    const result = await evaluateProject(message.project, {
      cache,
      force: message.force,
      checkpoint,
      satmapCache,
    });
    if (!isCurrent()) return;
    currentJob = 0;
    self.postMessage({ type: 'result', jobId, result });
  } catch (error) {
    if (error instanceof CancelledError || !isCurrent()) return;
    currentJob = 0;
    self.postMessage({ type: 'error', jobId, message: String(error?.message || error) });
  }
};

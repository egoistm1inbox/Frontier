// Main-thread wrapper around the terrain worker. Each evaluation gets a job id; callers ignore
// messages for ids they no longer care about.

export function createTerrainClient(onMessage) {
  const worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
  let nextJob = 1;
  worker.onmessage = (event) => onMessage(event.data);
  worker.onerror = (event) => onMessage({ type: 'error', jobId: 0, message: event.message || 'Worker failed' });
  return {
    evaluate(project, force = false) {
      const jobId = nextJob;
      nextJob += 1;
      // Structured clone copies the project, so the worker never sees live React state.
      worker.postMessage({ type: 'evaluate', jobId, project, force });
      return jobId;
    },
    cancel() {
      worker.postMessage({ type: 'cancel' });
    },
    terminate() {
      worker.terminate();
    },
  };
}

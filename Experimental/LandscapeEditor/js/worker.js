// Worker entry. Runs the layer stack off the main thread and answers with plain copies of the results.
// Each evaluate request has a job number. A newer request sets `latest`, and the running job notices at
// its next yield point and stops, so a slider drag never queues up stale work.
import { evaluateProject } from './terrain/pipeline.js';

const cache = new Map();
let latest = 0;

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'evaluate') return;
  const job = msg.job;
  latest = job;
  const cancelled = () => job !== latest;
  try {
    const result = await evaluateProject(msg.project, {
      cache,
      hooks: {
        cancelled,
        tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
        progress: (p) => self.postMessage({ type: 'progress', job, ...p }),
      },
    });
    if (!result || cancelled()) return;
    self.postMessage({
      type: 'result',
      job,
      N: result.N,
      height: result.height,
      colour: result.colour,
      colourSize: result.colourSize,
      slope: result.slope,
      flow: result.flow,
      deposition: result.deposition,
      thumbs: result.thumbs,
      stats: result.stats,
      summary: result.summary,
      timing: result.timing,
    });
  } catch (err) {
    self.postMessage({ type: 'error', job, message: err && err.stack ? err.stack : String(err) });
  }
};

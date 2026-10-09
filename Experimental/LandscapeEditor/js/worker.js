// Worker entry. Runs the layer stack off the main thread and answers with plain copies of the results.
//
// evaluate: each request has a job number. A newer request sets `latest`, and the running job notices at
// its next yield point and stops, so a slider drag never queues up stale work.
//
// export: evaluates the snapshot first (cached, so it is cheap when the preview is up to date), then makes the
// file data here: the full-size heightmap, or the full-size satmap painted in row chunks. The buffer is
// transferred back. Export jobs are not cancelled; they report their own progress.
import { evaluateProject } from './terrain/pipeline.js';
import { exportHeight16 } from './terrain/export.js';
import { satmapPainter } from './terrain/satmap.js';

const cache = new Map();
let latest = 0;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'evaluate') await evaluate(msg);
  else if (msg.type === 'export') await runExport(msg);
};

async function evaluate(msg) {
  const job = msg.job;
  latest = job;
  const cancelled = () => job !== latest;
  try {
    const result = await evaluateProject(msg.project, {
      cache,
      hooks: {
        cancelled,
        tick,
        progress: (p) => self.postMessage({ type: 'progress', job, ...p }),
      },
    });
    if (!result || cancelled()) return;
    self.postMessage({
      type: 'result',
      job,
      N: result.N,
      outN: result.outN,
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
}

async function runExport(msg) {
  const job = msg.job;
  const report = (fraction, label) => self.postMessage({ type: 'export-progress', job, fraction, label });
  try {
    const project = msg.project;
    const terr = project.terrain;
    report(0, 'Computing terrain');
    const result = await evaluateProject(project, {
      cache,
      hooks: { tick, progress: (p) => report(p.fraction * 0.5, p.label) },
    });
    if (!result) throw new Error('The terrain could not be computed.');

    if (msg.kind === 'r16') {
      const buffer = await exportHeight16({
        h: result.height,
        W: result.N,
        N: terr.size,
        an: result.an,
        terr,
        seed: terr.seed,
        hooks: { tick, progress: (f) => report(0.5 + f * 0.5, 'Writing heightmap') },
      });
      self.postMessage({ type: 'export-done', job, kind: 'r16', size: terr.size, buffer }, [buffer]);
      return;
    }

    if (msg.kind === 'satmap') {
      const layer = project.layers.find((l) => l.id === msg.layerId && l.type === 'satmap');
      if (!layer) throw new Error('That satmap layer is no longer in the stack.');
      const S = layer.params.resolution;
      const paint = satmapPainter(layer.params, S, result.height, result.N, result.an, terr, terr.seed);
      const out = new Uint8ClampedArray(S * S * 4);
      const step = 64;
      for (let j0 = 0; j0 < S; j0 += step) {
        const j1 = Math.min(S, j0 + step);
        paint(out, j0, j1);
        report(0.5 + (0.5 * j1) / S, 'Painting satmap');
        await tick();
      }
      self.postMessage({ type: 'export-done', job, kind: 'satmap', size: S, buffer: out.buffer }, [out.buffer]);
      return;
    }

    throw new Error('Unknown export ' + msg.kind);
  } catch (err) {
    self.postMessage({ type: 'export-error', job, message: err && err.message ? err.message : String(err) });
  }
}

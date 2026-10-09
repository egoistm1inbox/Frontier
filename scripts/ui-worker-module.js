/**
 * Substitute for Vite's `?worker` import during UI verification.
 *
 * Vite compiles `import W from './x.worker.js?worker'` into a bundled worker
 * factory. Under esbuild + jsdom there is no worker runtime, so this module
 * hands back the in-process Worker installed by scripts/ui-shim.js. Returning
 * the instance from the constructor means the class itself needs no state.
 */
export default class WorkerBridge {
  constructor(url, options) {
    const Impl = globalThis.__InProcessWorker;
    if (!Impl) throw new Error('installWorkerShim() must run before the app is imported.');
    return new Impl(url, options);
  }
}

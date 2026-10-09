/**
 * Frontier Landscape Studio — UI test shims.
 *
 * Chromium cannot be downloaded in this environment, so the React tree is
 * verified under jsdom instead. These shims stand in for the two browser
 * surfaces the editor needs but jsdom does not provide: a WebGL2 context and a
 * 2D canvas context. The bake worker is not stubbed — the real worker module is
 * loaded in-process through a Worker-shaped wrapper, so the UI is exercised
 * against the genuine simulation.
 */

/* ------------------------------------------------------------- canvas mocks */

let imageCounter = 0;

export function make2DContext(canvas) {
  const noop = () => {};
  return {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    font: '10px sans-serif',
    textAlign: 'left',
    globalAlpha: 1,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop,
    drawImage: noop,
    fillRect: noop,
    clearRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
}

/** Enough WebGL2 to run the renderer's command stream and catch JS errors. */
export function makeGLContext(canvas) {
  const created = { shaders: 0, programs: 0, textures: 0, buffers: 0 };
  const constants = new Map();
  let constantSeed = 0x1000;

  const special = {
    canvas,
    getExtension: () => null,
    getShaderParameter: () => true,
    getProgramParameter: (target, pname) => {
      // ACTIVE_UNIFORMS drives a loop; keep it small and deterministic.
      if (String(pname) === String(constant('ACTIVE_UNIFORMS'))) return 4;
      return true;
    },
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getParameter: () => 16,
    getActiveUniform: () => ({ name: 'uMock', size: 1 }),
    getUniformLocation: () => ({ mock: 'uniform' }),
    getAttribLocation: () => 0,
    createShader: () => ({ shader: ++created.shaders }),
    createProgram: () => ({ program: ++created.programs }),
    createTexture: () => ({ texture: ++created.textures }),
    createBuffer: () => ({ buffer: ++created.buffers }),
    createVertexArray: () => ({ vao: 1 }),
    createFramebuffer: () => ({ fbo: 1 }),
    createRenderbuffer: () => ({ rbo: 1 }),
    isContextLost: () => false,
    getContextAttributes: () => ({ antialias: true, alpha: false }),
  };

  function constant(name) {
    if (!constants.has(name)) constants.set(name, constantSeed++);
    return constants.get(name);
  }

  const target = { ...special };
  const noop = () => {};

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'symbol') return undefined;
      const name = String(prop);
      if (/^[A-Z0-9_]+$/.test(name)) return constant(name);
      // Unknown members are GL entry points: record and ignore.
      const fn = () => undefined;
      Object.defineProperty(obj, name, { value: fn, configurable: true });
      return fn;
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
}

/** Install the canvas stubs on the jsdom window. */
export function installCanvasShims(window) {
  const proto = window.HTMLCanvasElement.prototype;
  proto.getContext = function getContext(kind) {
    if (kind === 'webgl2' || kind === 'webgl') {
      this.__gl = this.__gl || makeGLContext(this);
      return this.__gl;
    }
    this.__2d = this.__2d || make2DContext(this);
    return this.__2d;
  };
  proto.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  proto.toBlob = function toBlob(cb) {
    cb(new window.Blob([new Uint8Array(8)], { type: 'image/png' }));
  };
}

/* -------------------------------------------------------------- worker shim */

/**
 * A Worker that runs the real pipeline module in this thread. `self` is pointed
 * at a dispatcher so pipeline.worker.js's `self.onmessage` / `self.postMessage`
 * wiring is exercised exactly as it would be in a browser.
 */
export async function installWorkerShim() {
  const dispatcher = {
    onmessage: null,
    postMessage: (data) => {
      // Hand the message back to the owner on a later tick, like a real worker.
      const handler = dispatcher._owner;
      setTimeout(() => handler && handler({ data: structuredClone(data) }), 0);
    },
  };
  globalThis.self = dispatcher;
  await import('../src/core/pipeline.worker.js');

  class InProcessWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      dispatcher._owner = (event) => this.onmessage && this.onmessage(event);
    }
    postMessage(message) {
      const handler = dispatcher.onmessage;
      setTimeout(() => handler && handler({ data: structuredClone(message) }), 0);
    }
    terminate() { dispatcher._owner = null; }
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.Worker = InProcessWorker;
  globalThis.__InProcessWorker = InProcessWorker;
  return InProcessWorker;
}

/* ------------------------------------------------------- misc browser stubs */

export function installMiscShims(window) {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // Components call these as bare identifiers, so they must exist on the real
  // global object as well as on the jsdom window.
  globalThis.ResizeObserver = window.ResizeObserver;
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  if (!window.Element.prototype.setPointerCapture) {
    window.Element.prototype.setPointerCapture = () => {};
    window.Element.prototype.releasePointerCapture = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
  globalThis.matchMedia = window.matchMedia;
  globalThis.IntersectionObserver = window.IntersectionObserver;
  // Give laid-out elements a plausible box so geometry math is exercised.
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700, toJSON() {} };
  };
}

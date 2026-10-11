// Terrain build engine: evaluates the layer stack bottom→top on the GPU.
import { NOISE_WGSL } from '../wgsl/noise.js';
import { StructPacker, wg } from '../core/gpu.js';
import { TERRAIN_TYPES } from './layer-types.js';
import { Sims } from './sims.js';

export const ATTRS = ['flow', 'wear', 'deposit', 'talus', 'snow', 'water'];
export const THUMB = 96;

const COMMON_STRUCT = /* wgsl */`
struct Common {
  N: u32, seed: u32, blend: u32, maskMode: u32,
  world: f32, hscale: f32, opacity: f32, maskInvert: f32,
  maskMin: f32, maskMax: f32, maskFalloff: f32, maskScale: f32,
  smoothK: f32, sea: f32, cell: f32, iter: f32,
}`;

const POINT_HELPERS = /* wgsl */`
fn hAt(x: i32, y: i32) -> f32 {
  let n = i32(C.N);
  return hIn[u32(clamp(y, 0, n - 1)) * C.N + u32(clamp(x, 0, n - 1))];
}
fn hBil(tp: vec2f) -> f32 {
  let q = tp - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  return mix(mix(hAt(i.x, i.y), hAt(i.x + 1, i.y), f.x), mix(hAt(i.x, i.y + 1), hAt(i.x + 1, i.y + 1), f.x), f.y);
}
fn layerMask(uv: vec2f, hin: f32, g: vec2u) -> f32 {
  var m = 1.0;
  switch C.maskMode {
    case 1u: {
      let hm = hin * C.hscale;
      let f = max(C.maskFalloff, 0.5);
      m = sstep(C.maskMin - f, C.maskMin + f, hm) * (1.0 - sstep(C.maskMax - f, C.maskMax + f, hm));
    }
    case 2u: {
      let x = i32(g.x); let y = i32(g.y);
      let dx = (hAt(x + 1, y) - hAt(x - 1, y)) * C.hscale / (2.0 * C.cell);
      let dy = (hAt(x, y + 1) - hAt(x, y - 1)) * C.hscale / (2.0 * C.cell);
      let s = degrees(atan(length(vec2f(dx, dy))));
      let f = max(C.maskFalloff, 0.1);
      m = sstep(C.maskMin - f, C.maskMin + f, s) * (1.0 - sstep(C.maskMax - f, C.maskMax + f, s));
    }
    case 3u: {
      let p = (uv - 0.5) * C.world / max(C.maskScale * 1000.0, 1.0);
      let n = fbm(p, 6, 2.0, 0.5, C.seed + 4242u) * 0.5 + 0.5;
      let f = max(C.maskFalloff, 0.002);
      m = sstep(C.maskMin - f, C.maskMin + f, n);
    }
    case 4u: {
      let r = length(uv - 0.5) * 2.0;
      m = 1.0 - sstep(C.maskMin, max(C.maskMax, C.maskMin + 0.001), r);
    }
    default: {}
  }
  if (C.maskInvert > 0.5) { m = 1.0 - m; }
  return m;
}
fn blendOp(a: f32, b: f32) -> f32 {
  switch C.blend {
    case 0u: { return a + b; }
    case 1u: { return max(a, b); }
    case 2u: { return min(a, b); }
    case 3u: { return a - b; }
    case 4u: { return a * b; }
    case 5u: { return b; }
    case 6u: { return smax(a, b, C.smoothK); }
    case 7u: { return smin(a, b, C.smoothK); }
    default: { return a + b; }
  }
}`;

function buildPointShader(t) {
  const fields = Object.entries(t.params)
    .filter(([, d]) => d.gpu !== false && d.type !== 'curve')
    .map(([k]) => ({ name: k, type: 'f32' }));
  const packer = new StructPacker(fields);
  const code = `${NOISE_WGSL}
${COMMON_STRUCT}
${packer.wgsl('Params')}
@group(0) @binding(0) var<uniform> C: Common;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var<storage, read> hIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> hOut: array<f32>;
${t.needsAux ? '@group(0) @binding(4) var<storage, read> aux: array<f32>;' : ''}
${t.needsLUT ? '@group(0) @binding(5) var<storage, read> lut: array<f32>;' : ''}
${t.needsStats ? '@group(0) @binding(6) var<storage, read> stats: array<f32>;' : ''}
${POINT_HELPERS}
${t.wgsl}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= C.N || g.y >= C.N) { return; }
  let i = g.y * C.N + g.x;
  let uv = (vec2f(g.xy) + 0.5) / f32(C.N);
  let hin = hIn[i];
  let v = layer(uv, hin, g.xy);
  let m = clamp(layerMask(uv, hin, g.xy) * C.opacity, 0.0, 1.0);
  hOut[i] = ${t.role === 'generator' ? 'mix(hin, blendOp(hin, v), m)' : 'mix(hin, v, m)'};
}`;
  return { code, packer };
}

// Mixes a simulation result (aux) back over its input with the layer's opacity and mask.
const MIX_TYPE = { role: 'modifier', needsAux: true, params: { k: { type: 'float' } }, wgsl: `fn layer(uv: vec2f, hin: f32, g: vec2u) -> f32 { return aux[g.y * C.N + g.x] + P.k * 0.0; }` };

const STATS_WGSL = /* wgsl */`
@group(0) @binding(0) var<uniform> U: vec4u;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> mm: array<atomic<u32>, 4>;
var<workgroup> smin: array<u32, 256>;
var<workgroup> smax: array<u32, 256>;
fn key(f: f32) -> u32 { let b = bitcast<u32>(f); return select(b | 0x80000000u, ~b, (b & 0x80000000u) != 0u); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_index) li: u32, @builtin(num_workgroups) nw: vec3u) {
  var lo = 0xffffffffu; var hi = 0u;
  var i = g.x;
  let stride = nw.x * 256u;
  loop {
    if (i >= U.x) { break; }
    let k = key(src[i]);
    lo = min(lo, k); hi = max(hi, k);
    i += stride;
  }
  smin[li] = lo; smax[li] = hi;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (li < s) { smin[li] = min(smin[li], smin[li + s]); smax[li] = max(smax[li], smax[li + s]); }
    workgroupBarrier();
  }
  if (li == 0u) { atomicMin(&mm[0], smin[0]); atomicMax(&mm[1], smax[0]); }
}`;
const STATS_FINAL_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read> mm: array<u32, 4>;
@group(0) @binding(1) var<storage, read_write> stats: array<f32, 4>;
fn unkey(k: u32) -> f32 { return bitcast<f32>(select(~k, k & 0x7fffffffu, (k & 0x80000000u) != 0u)); }
@compute @workgroup_size(1)
fn main() { stats[0] = unkey(mm[0]); stats[1] = unkey(mm[1]); stats[2] = 0.0; stats[3] = 0.0; }`;

const SCALE_WGSL = /* wgsl */`
struct SP { n: u32, p0: u32, p1: u32, p2: u32, scale: f32, bias: f32, p3: f32, p4: f32 }
@group(0) @binding(0) var<uniform> P: SP;
@group(0) @binding(1) var<storage, read_write> b: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (i >= P.n) { return; }
  b[i] = b[i] * P.scale + P.bias;
}`;

const BLUR_WGSL = /* wgsl */`
struct BP { N: u32, dir: u32, taps: u32, pad: u32, stepT: f32, sigma: f32, p1: f32, p2: f32 }
@group(0) @binding(0) var<uniform> P: BP;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
fn at(x: i32, y: i32) -> f32 { let n = i32(P.N); return src[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))]; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let x = i32(g.x); let y = i32(g.y);
  var s = 0.0; var ws = 0.0;
  let t = i32(P.taps);
  for (var k = -t; k <= t; k++) {
    let o = f32(k) * P.stepT;
    let o0 = floor(o); let fr = o - o0; let oi = i32(o0);
    var v: f32;
    if (P.dir == 0u) { v = mix(at(x + oi, y), at(x + oi + 1, y), fr); } else { v = mix(at(x, y + oi), at(x, y + oi + 1), fr); }
    let w = exp(-0.5 * (o * o) / (P.sigma * P.sigma));
    s += v * w; ws += w;
  }
  dst[g.y * P.N + g.x] = s / ws;
}`;

const THUMB_WGSL = /* wgsl */`
struct TP { N: u32, T: u32, offset: u32, pad: u32 }
@group(0) @binding(0) var<uniform> P: TP;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
fn at(x: i32, y: i32) -> f32 { let n = i32(P.N); return src[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))]; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.T || g.y >= P.T) { return; }
  let s = f32(P.N) / f32(P.T);
  var acc = 0.0;
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) {
      let p = (vec2f(g.xy) + (vec2f(f32(i), f32(j)) + 0.5) / 3.0) * s;
      acc += at(i32(p.x), i32(p.y));
    }
  }
  dst[P.offset + g.y * P.T + g.x] = acc / 9.0;
}`;

const CLEAR_WGSL = /* wgsl */`
@group(0) @binding(0) var<uniform> U: vec4u;
@group(0) @binding(1) var<storage, read_write> b: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 256u;
  if (i >= U.x) { return; }
  b[i] = bitcast<f32>(U.y);
}`;

export class TerrainEngine {
  constructor(gpu) {
    this.gpu = gpu;
    this.sims = new Sims(gpu);
    this.N = 0;
    this.buf = null;
    this.cache = null;
    this.current = null;    // { N, height: GPUBuffer, attrs }
    this.queue = Promise.resolve();
    this.abort = null;
    this.pointShaders = new Map();
    this.zero = gpu.storage(64, 'zero');
    this.statsMM = gpu.storage(16, 'stats-mm');
    this.statsF = gpu.storage(16, 'stats-f');
    this.thumbBuf = null;
    this.thumbCap = 0;
  }

  // ── resources
  ensure(N, needAttrs, needScratch) {
    const g = this.gpu;
    const bytes = N * N * 4;
    if (this.N !== N) {
      this.release();
      this.N = N;
      this.buf = { h: [g.storage(bytes, 'h0'), g.storage(bytes, 'h1')], attr: {}, scratch: [] };
    }
    for (const a of ATTRS) {
      if (needAttrs.has(a) && !this.buf.attr[a]) this.buf.attr[a] = g.storage(bytes, 'attr-' + a);
    }
    while (this.buf.scratch.length < needScratch) this.buf.scratch.push(g.storage(bytes, 's' + this.buf.scratch.length));
  }

  release() {
    if (!this.buf) return;
    this.buf.h.forEach(b => b.destroy());
    Object.values(this.buf.attr).forEach(b => b.destroy());
    this.buf.scratch.forEach(b => b.destroy());
    this.dropCache();
    this.buf = null;
    this.N = 0;
  }

  dropCache() {
    if (!this.cache) return;
    this.cache.h.destroy();
    Object.values(this.cache.attr).forEach(b => b.destroy());
    this.cache = null;
  }

  attrBuffer(name) { return this.buf?.attr[name] || this.zero; }

  // ── helpers
  async clear(buffer, n, value = 0) {
    const p = await this.gpu.compute(CLEAR_WGSL, 'clear');
    const u = this.gpu.uniform(16);
    const v = new Float32Array([value]);
    this.gpu.write(u, new Uint32Array([n, new Uint32Array(v.buffer)[0], 0, 0]));
    const enc = this.gpu.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p); pass.setBindGroup(0, this.gpu.bind(p, [u, buffer]));
    const groups = Math.ceil(n / 256);
    pass.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    u.destroy();
  }

  async scaleBuffer(buffer, scale, bias) {
    const p = await this.gpu.compute(SCALE_WGSL, 'scale');
    const n = this.N * this.N;
    const u = this.gpu.uniform(32);
    const ab = new ArrayBuffer(32); new Uint32Array(ab)[0] = n; new Float32Array(ab)[4] = scale; new Float32Array(ab)[5] = bias;
    this.gpu.write(u, new Uint8Array(ab));
    const enc = this.gpu.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p); pass.setBindGroup(0, this.gpu.bind(p, [u, buffer]));
    const groups = Math.ceil(n / 256);
    pass.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    u.destroy();
  }

  async statsGPU(buffer, n = this.N * this.N) {
    const [p, pf] = await Promise.all([this.gpu.compute(STATS_WGSL, 'stats'), this.gpu.compute(STATS_FINAL_WGSL, 'stats-final')]);
    this.gpu.write(this.statsMM, new Uint32Array([0xffffffff, 0, 0, 0]));
    const u = this.gpu.uniform(16);
    this.gpu.write(u, new Uint32Array([n, 0, 0, 0]));
    const enc = this.gpu.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p); pass.setBindGroup(0, this.gpu.bind(p, [u, buffer, this.statsMM])); pass.dispatchWorkgroups(Math.min(256, Math.ceil(n / 256)));
    pass.setPipeline(pf); pass.setBindGroup(0, this.gpu.bind(pf, [this.statsMM, this.statsF])); pass.dispatchWorkgroups(1);
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    u.destroy();
    return this.statsF;
  }

  async stats(buffer) {
    await this.statsGPU(buffer);
    const f = new Float32Array(await this.gpu.read(this.statsF, 16));
    return { min: f[0], max: f[1] };
  }

  async blur(src, dst, tmp, radiusTexels) {
    const p = await this.gpu.compute(BLUR_WGSL, 'blur');
    const N = this.N;
    const r = Math.max(0.5, radiusTexels);
    const taps = Math.min(48, Math.max(1, Math.ceil(r * 1.5)));
    const step = Math.max(1, (r * 1.5) / taps);
    const mk = (dir) => {
      const u = this.gpu.uniform(32);
      const ab = new ArrayBuffer(32); const uu = new Uint32Array(ab), ff = new Float32Array(ab);
      uu[0] = N; uu[1] = dir; uu[2] = taps; ff[4] = step; ff[5] = r * 0.6;
      this.gpu.write(u, new Uint8Array(ab));
      return u;
    };
    const u0 = mk(0), u1 = mk(1);
    const enc = this.gpu.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p);
    pass.setBindGroup(0, this.gpu.bind(p, [u0, src, tmp])); pass.dispatchWorkgroups(wg(N), wg(N));
    pass.setBindGroup(0, this.gpu.bind(p, [u1, tmp, dst])); pass.dispatchWorkgroups(wg(N), wg(N));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    u0.destroy(); u1.destroy();
  }

  pointShader(type) {
    let s = this.pointShaders.get(type);
    if (!s) {
      const t = type === '__mix' ? MIX_TYPE : TERRAIN_TYPES[type];
      s = buildPointShader(t);
      s.type = t;
      this.pointShaders.set(type, s);
    }
    return s;
  }

  commonUniform(layer, ctx, seed) {
    const ab = new ArrayBuffer(64), u = new Uint32Array(ab), f = new Float32Array(ab);
    const b = layer.blend || {}, m = layer.mask || {};
    u[0] = ctx.N; u[1] = seed >>> 0; u[2] = b.mode ?? 0; u[3] = m.mode ?? 0;
    f[4] = ctx.world; f[5] = ctx.hscale; f[6] = b.opacity ?? 1; f[7] = m.invert ? 1 : 0;
    const mode = m.mode ?? 0;
    // mask parameter units: height → metres, slope → degrees, noise → 0..1 threshold, radial → 0..1
    f[8] = m.min ?? 0; f[9] = m.max ?? 0; f[10] = m.falloff ?? 0; f[11] = m.scale ?? 2;
    if (mode === 3) { f[8] = m.threshold ?? 0.5; f[10] = m.contrast ?? 0.08; }
    if (mode === 4) { f[8] = m.inner ?? 0.4; f[9] = m.outer ?? 0.9; }
    if (mode === 2) { f[8] = m.slopeMin ?? 0; f[9] = m.slopeMax ?? 35; f[10] = m.slopeFalloff ?? 4; }
    f[12] = Math.max(1, b.smooth ?? 100) / ctx.hscale; f[13] = ctx.sea; f[14] = ctx.cell; f[15] = 0;
    const ub = this.gpu.uniform(64);
    this.gpu.write(ub, f);
    return ub;
  }

  async runPoint(layer, src, dst, ctx, overrideType, auxBuf) {
    const type = overrideType || layer.type;
    const sh = this.pointShader(type);
    const t = sh.type;
    const pipe = await this.gpu.compute(sh.code, 'layer-' + type);
    const temp = [];
    const cu = this.commonUniform(layer, ctx, layer.params?.seed ?? 1); temp.push(cu);
    const pk = sh.packer;
    pk.f.fill(0);
    for (const fdef of pk.fields) {
      let v = layer.params?.[fdef.name];
      if (typeof v === 'boolean') v = v ? 1 : 0;
      pk.set(fdef.name, v ?? 0);
    }
    const pu = this.gpu.uniform(pk.size); this.gpu.write(pu, pk.f); temp.push(pu);
    let aux = null, lut = null, stats = null;
    if (t.needsAux) {
      if (auxBuf) aux = auxBuf;
      else {
        // per-type auxiliary input: blurred copy of the input
        const r = (layer.params.radius ?? 40) / ctx.cell;
        aux = this.buf.scratch[0];
        await this.blur(src, aux, this.buf.scratch[1], r);
      }
    }
    if (t.needsLUT) {
      lut = this.gpu.storage(256 * 4, 'lut'); temp.push(lut);
      this.gpu.write(lut, curveLUT(layer.params.curve));
    }
    if (t.needsStats) stats = await this.statsGPU(src);
    const bg = this.gpu.bind(pipe, [cu, pu, src, dst, aux, lut, stats]);
    const enc = this.gpu.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(wg(ctx.N), wg(ctx.N));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    this.gpu.idle().then(() => temp.forEach(b => b.destroy()));
  }

  async thumb(src, index) {
    const p = await this.gpu.compute(THUMB_WGSL, 'thumb');
    const need = (index + 1) * THUMB * THUMB * 4;
    if (!this.thumbBuf || this.thumbCap < need) {
      const old = this.thumbBuf;
      this.thumbCap = Math.max(need, 16 * THUMB * THUMB * 4);
      this.thumbBuf = this.gpu.storage(this.thumbCap, 'thumbs');
      if (old) old.destroy();
    }
    const u = this.gpu.uniform(16);
    this.gpu.write(u, new Uint32Array([this.N, THUMB, index * THUMB * THUMB, 0]));
    const enc = this.gpu.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p); pass.setBindGroup(0, this.gpu.bind(p, [u, src, this.thumbBuf])); pass.dispatchWorkgroups(wg(THUMB), wg(THUMB));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    this.gpu.idle().then(() => u.destroy());
  }

  // ── build
  // Builds are serialised; requesting a new build aborts the one in flight at its next checkpoint.
  build(project, opts = {}) {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const run = this.queue.then(() => ac.signal.aborted ? null : this._build(project, opts, ac.signal)).catch((e) => {
      console.error(e);
      opts.onError?.(e);
      return null;
    });
    this.queue = run;
    return run;
  }

  async _build(project, opts, signal) {
    const t0 = performance.now();
    const N = opts.res;
    const W = project.world;
    const layers = project.terrain.layers.filter(l => l.enabled && TERRAIN_TYPES[l.type]);
    const need = new Set();
    let scratch = 0;
    for (const l of layers) {
      const t = TERRAIN_TYPES[l.type];
      (t.produces || []).forEach(a => need.add(a));
      if (t.kind === 'sim') scratch = Math.max(scratch, { fluvial: 5, hydraulic: 2, snow: 2, thermal: 0, hydrology: 0 }[l.type] ?? 0);
      if (t.needsAux) scratch = Math.max(scratch, 2);
      if (t.kind === 'sim') scratch = Math.max(scratch, 1);
    }
    this.ensure(N, need, scratch);
    const ctx = {
      gpu: this.gpu, N, world: W.size, hscale: W.height, cell: W.size / N, sea: W.seaOn ? W.seaLevel : -1e9,
      signal, buf: {
        ...Object.fromEntries(ATTRS.map(a => [a, this.attrBuffer(a)])),
        ...Object.fromEntries(this.buf.scratch.map((b, i) => ['s' + i, b])),
      },
      stats: (b) => this.stats(b), scaleBuffer: (b, s, o) => this.scaleBuffer(b, s, o),
    };
    // cache keys
    const worldKey = JSON.stringify([N, W.size, W.height, W.seaOn, W.seaLevel]);
    const keys = [];
    let acc = worldKey;
    for (const l of layers) { acc += '|' + JSON.stringify([l.type, l.params, l.blend, l.mask]); keys.push(acc); }
    const weights = layers.map(l => ({ fluvial: 30, hydraulic: 22, thermal: 6, snow: 4, hydrology: 18 }[l.type] ?? 1));
    let start = 0;
    let cur = 0;
    const H = this.buf.h;
    const nn = N * N;
    const c = this.cache;
    if (c && c.N === N && c.index < layers.length && keys[c.index] === c.key) {
      const enc = this.gpu.device.createCommandEncoder();
      enc.copyBufferToBuffer(c.h, 0, H[0], 0, nn * 4);
      for (const a of ATTRS) {
        if (!this.buf.attr[a]) continue;
        if (c.attr[a]) enc.copyBufferToBuffer(c.attr[a], 0, this.buf.attr[a], 0, nn * 4);
        else enc.clearBuffer(this.buf.attr[a]);
      }
      this.gpu.device.queue.submit([enc.finish()]);
      start = c.index + 1;
    } else {
      const enc = this.gpu.device.createCommandEncoder();
      enc.clearBuffer(H[0]);
      for (const a of ATTRS) if (this.buf.attr[a]) enc.clearBuffer(this.buf.attr[a]);
      this.gpu.device.queue.submit([enc.finish()]);
    }
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    let doneW = weights.slice(0, start).reduce((a, b) => a + b, 0);
    const focus = opts.focusIndex ?? layers.length;
    let snapIndex = -1;
    layers.forEach((l, i) => { if (TERRAIN_TYPES[l.type].kind === 'sim' && i < focus) snapIndex = i; });
    const thumbs = [];
    for (let i = start; i < layers.length; i++) {
      if (signal.aborted) return null;
      const l = layers[i];
      const t = TERRAIN_TYPES[l.type];
      const src = H[cur], dst = H[cur ^ 1];
      opts.onProgress?.({ fraction: doneW / totalW, label: l.name, layerId: l.id });
      if (t.kind === 'point') {
        await this.runPoint(l, src, dst, ctx);
      } else {
        const needsMix = (l.blend?.opacity ?? 1) < 0.999 || (l.mask?.mode ?? 0) !== 0;
        let pre = null;
        if (needsMix) {
          pre = this.gpu.storage(nn * 4, 'pre-mix');
          const enc = this.gpu.device.createCommandEncoder();
          enc.copyBufferToBuffer(src, 0, pre, 0, nn * 4);
          this.gpu.device.queue.submit([enc.finish()]);
        }
        const sub = (f) => opts.onProgress?.({ fraction: (doneW + weights[i] * f) / totalW, label: l.name, layerId: l.id });
        const res = await this.sims[l.type]({ ...ctx, progress: sub }, l, src, dst);
        if (res === null || signal.aborted) { pre?.destroy(); return null; }
        if (pre) {
          // dst holds the sim result; mix it over the preserved input into src, then swap roles
          await this.runPoint({ ...l, params: { k: 0, seed: l.params.seed } }, pre, src, ctx, '__mix', dst);
          const enc = this.gpu.device.createCommandEncoder();
          enc.copyBufferToBuffer(src, 0, dst, 0, nn * 4);
          this.gpu.device.queue.submit([enc.finish()]);
          await this.gpu.idle();
          pre.destroy();
        }
      }
      cur ^= 1;
      doneW += weights[i];
      await this.thumb(H[cur], i);
      thumbs.push(i);
      if (i === snapIndex && N <= 2048) await this.snapshot(H[cur], i, keys[i], N);
      if (t.kind === 'sim') await this.gpu.idle();
    }
    if (signal.aborted) return null;
    if (layers.length === 0) await this.clear(H[0], nn, 0);
    const height = H[cur];
    let thumbData = null;
    if (thumbs.length) {
      const raw = new Float32Array(await this.gpu.read(this.thumbBuf, layers.length * THUMB * THUMB * 4));
      thumbData = {};
      for (const i of thumbs) thumbData[layers[i].id] = raw.slice(i * THUMB * THUMB, (i + 1) * THUMB * THUMB);
    }
    const st = await this.stats(height);
    await this.gpu.idle();
    const ms = performance.now() - t0;
    this.current = { N, height, stats: st, world: W.size, hscale: W.height };
    return { N, height, attrs: Object.fromEntries(ATTRS.map(a => [a, this.attrBuffer(a)])), present: need, stats: st, thumbs: thumbData, ms, startedAt: start };
  }

  async snapshot(h, index, key, N) {
    const nn = N * N;
    if (!this.cache || this.cache.N !== N) {
      this.dropCache();
      this.cache = { N, h: this.gpu.storage(nn * 4, 'cache-h'), attr: {}, index: -1, key: '' };
    }
    const enc = this.gpu.device.createCommandEncoder();
    enc.copyBufferToBuffer(h, 0, this.cache.h, 0, nn * 4);
    for (const a of ATTRS) {
      const b = this.buf.attr[a];
      if (!b) continue;
      if (!this.cache.attr[a]) this.cache.attr[a] = this.gpu.storage(nn * 4, 'cache-' + a);
      enc.copyBufferToBuffer(b, 0, this.cache.attr[a], 0, nn * 4);
    }
    this.gpu.device.queue.submit([enc.finish()]);
    this.cache.index = index;
    this.cache.key = key;
  }
}

// Monotone cubic (Fritsch–Carlson) curve → 256-entry LUT.
export function curveLUT(points) {
  const pts = (points && points.length >= 2 ? points : [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const out = new Float32Array(256);
  let seg = 0;
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    if (x <= xs[0]) { out[k] = ys[0]; continue; }
    if (x >= xs[n - 1]) { out[k] = ys[n - 1]; continue; }
    const hgt = xs[seg + 1] - xs[seg];
    const t = (x - xs[seg]) / hgt;
    const t2 = t * t, t3 = t2 * t;
    out[k] = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * hgt * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * hgt * m[seg + 1];
  }
  return out;
}

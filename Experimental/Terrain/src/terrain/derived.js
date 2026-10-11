// Derived maps consumed by the texture compositor and the renderer.
//  heightTex  r32float      normalised height
//  normalTex  rgba16float   world normal xyz + horizon-based sky visibility (AO)
//  attrA      rgba16float   flow, wear(m), deposit(m), talus(m)
//  attrB      rgba16float   snow(m), water depth(m), large curvature(m), small curvature(m)
//  waterTex   r32float      water surface level (normalised) or (height - 1m) where dry
//  shadowTex  rgba8unorm    r = soft sun visibility (recomputed when the sun moves)
import { wg } from '../core/gpu.js';

const NORMAL_AO = /* wgsl */`
struct AP { N: u32, dirs: u32, steps: u32, pad: u32, cell: f32, hscale: f32, maxDist: f32, seed: f32 }
@group(0) @binding(0) var<uniform> P: AP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var outT: texture_storage_2d<rgba16float, write>;
fn H(x: i32, y: i32) -> f32 { let n = i32(P.N); return h[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))] * P.hscale; }
fn Hb(p: vec2f) -> f32 {
  let q = p - 0.5; let i = vec2i(floor(q)); let f = q - floor(q);
  return mix(mix(H(i.x, i.y), H(i.x + 1, i.y), f.x), mix(H(i.x, i.y + 1), H(i.x + 1, i.y + 1), f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let gx = (H(x + 1, y - 1) + 2.0 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2.0 * H(x - 1, y) - H(x - 1, y + 1)) / (8.0 * P.cell);
  let gz = (H(x - 1, y + 1) + 2.0 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2.0 * H(x, y - 1) - H(x + 1, y - 1)) / (8.0 * P.cell);
  let n = normalize(vec3f(-gx, 1.0, -gz));
  let h0 = H(x, y) + 0.3;
  let c = vec2f(g.xy) + 0.5;
  let t0 = P.cell * 0.75;
  let growth = pow(P.maxDist / t0, 1.0 / f32(P.steps));
  let jit = fract(sin(dot(c, vec2f(12.9898, 78.233))) * 43758.5453);
  var vis = 0.0;
  for (var d = 0u; d < P.dirs; d++) {
    let a = (f32(d) + jit) / f32(P.dirs) * 6.2831853;
    let dir = vec2f(cos(a), sin(a));
    var t = t0 * (0.75 + 0.5 * jit);
    var tmax = -1.0;
    for (var s = 0u; s < P.steps; s++) {
      let p = c + dir * (t / P.cell);
      if (p.x < 0.0 || p.y < 0.0 || p.x > f32(P.N) || p.y > f32(P.N)) { break; }
      tmax = max(tmax, (Hb(p) - h0) / t);
      t *= growth;
    }
    // cosine-weighted sky visibility of the slice, relative to the local normal
    let sh = tmax / sqrt(1.0 + tmax * tmax);
    let tilt = dot(n.xz, dir);
    vis += clamp(1.0 - max(sh, -0.2) - tilt * 0.5, 0.0, 1.2);
  }
  let ao = clamp(vis / f32(P.dirs), 0.0, 1.0);
  textureStore(outT, vec2i(x, y), vec4f(n, ao));
}`;

const SHADOW = /* wgsl */`
struct SP { N: u32, steps: u32, p0: u32, p1: u32, sx: f32, sy: f32, sz: f32, cell: f32, hscale: f32, maxH: f32, pen: f32, p2: f32 }
@group(0) @binding(0) var<uniform> P: SP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var outT: texture_storage_2d<rgba8unorm, write>;
fn H(x: i32, y: i32) -> f32 { let n = i32(P.N); return h[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))] * P.hscale; }
fn Hb(p: vec2f) -> f32 {
  let q = p - 0.5; let i = vec2i(floor(q)); let f = q - floor(q);
  return mix(mix(H(i.x, i.y), H(i.x + 1, i.y), f.x), mix(H(i.x, i.y + 1), H(i.x + 1, i.y + 1), f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let sun = vec3f(P.sx, P.sy, P.sz);
  let hl = length(sun.xz);
  var vis = 1.0;
  if (sun.y < -0.05) { vis = 0.0; }
  else if (hl > 1e-4) {
    let dir = sun.xz / hl;
    let tanE = sun.y / hl;
    let c = vec2f(g.xy) + 0.5;
    let h0 = H(x, y) + P.cell * 0.2;
    var t = P.cell * 0.7;
    var minC = 1e9;
    for (var s = 0u; s < P.steps; s++) {
      let p = c + dir * (t / P.cell);
      if (p.x < 0.0 || p.y < 0.0 || p.x > f32(P.N) || p.y > f32(P.N)) { break; }
      let rayH = h0 + t * tanE;
      if (rayH > P.maxH) { break; }
      minC = min(minC, (rayH - Hb(p)) / t);
      if (minC < -P.pen) { break; }
      t = t * 1.045 + P.cell * 0.35;
    }
    vis = smoothstep(-P.pen, P.pen, minC);
  }
  textureStore(outT, vec2i(x, y), vec4f(vis, 0.0, 0.0, 1.0));
}`;

const PACK = /* wgsl */`
struct PK { N: u32, p0: u32, p1: u32, p2: u32, hscale: f32, cell: f32, p3: f32, p4: f32 }
@group(0) @binding(0) var<uniform> P: PK;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> hb: array<f32>;
@group(0) @binding(3) var<storage, read> flow: array<f32>;
@group(0) @binding(4) var<storage, read> wear: array<f32>;
@group(0) @binding(5) var<storage, read> dep: array<f32>;
@group(0) @binding(6) var<storage, read> talus: array<f32>;
@group(0) @binding(7) var<storage, read> snow: array<f32>;
@group(0) @binding(8) var<storage, read> water: array<f32>;
@group(0) @binding(9) var attrA: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var attrB: texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var waterT: texture_storage_2d<r32float, write>;
fn H(x: i32, y: i32) -> f32 { let n = i32(P.N); return h[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))]; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let i = g.y * P.N + g.x;
  let hc = h[i];
  let curvL = (hb[i] - hc) * P.hscale;
  let k = 2;
  let curvS = ((H(x + k, y) + H(x - k, y) + H(x, y + k) + H(x, y - k)) * 0.25 - hc) * P.hscale;
  textureStore(attrA, vec2i(x, y), vec4f(flow[i], wear[i], dep[i], talus[i]));
  let w = water[i];
  textureStore(attrB, vec2i(x, y), vec4f(snow[i], w, curvL, curvS));
  let lvl = select(hc - 1.0 / P.hscale, hc + w / P.hscale, w > 0.02);
  textureStore(waterT, vec2i(x, y), vec4f(lvl, 0.0, 0.0, 0.0));
}`;

const MINMAX = /* wgsl */`
struct MP { N: u32, L: u32, leaf: u32, M: u32 }
@group(0) @binding(0) var<uniform> P: MP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read_write> mm: array<f32>;
@group(0) @binding(3) var<storage, read> water: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.L || g.y >= P.L) { return; }
  let n = i32(P.N);
  var lo = 1e9; var hi = -1e9; var wmax = 0.0;
  let x0 = i32(g.x * P.leaf); let y0 = i32(g.y * P.leaf);
  for (var y = y0 - 1; y <= y0 + i32(P.leaf) + 1; y++) {
    for (var x = x0 - 1; x <= x0 + i32(P.leaf) + 1; x++) {
      let i = u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
      let v = h[i];
      lo = min(lo, v); hi = max(hi, v); wmax = max(wmax, water[i]);
    }
  }
  let o = (g.y * P.L + g.x) * 4u;
  mm[o] = lo; mm[o + 1u] = hi; mm[o + 2u] = wmax; mm[o + 3u] = 0.0;
}`;

const LOWRES = /* wgsl */`
struct MP { N: u32, L: u32, leaf: u32, M: u32 }
@group(0) @binding(0) var<uniform> P: MP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read_write> low: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.M || g.y >= P.M) { return; }
  let n = i32(P.N);
  let s = f32(P.N) / f32(P.M);
  let px = i32((f32(g.x) + 0.5) * s); let py = i32((f32(g.y) + 0.5) * s);
  low[g.y * P.M + g.x] = h[u32(clamp(py, 0, n - 1) * n + clamp(px, 0, n - 1))];
}`;

export class Derived {
  constructor(gpu) {
    this.gpu = gpu;
    this.N = 0;
    this.tex = null;
    this.version = 0;
    this.sunKey = '';
  }

  ensure(N) {
    if (this.N === N && this.tex) return;
    this.destroy();
    const d = this.gpu.device;
    const mk = (format, label) => d.createTexture({
      size: [N, N], format, label,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    this.tex = {
      height: mk('r32float', 'heightTex'),
      normal: mk('rgba16float', 'normalTex'),
      attrA: mk('rgba16float', 'attrA'),
      attrB: mk('rgba16float', 'attrB'),
      water: mk('r32float', 'waterTex'),
      shadow: mk('rgba8unorm', 'shadowTex'),
    };
    this.blurBuf = this.gpu.storage(N * N * 4, 'derived-blur');
    this.tmpBuf = this.gpu.storage(N * N * 4, 'derived-tmp');
    this.N = N;
  }

  destroy() {
    if (!this.tex) return;
    Object.values(this.tex).forEach(t => t.destroy());
    this.blurBuf.destroy(); this.tmpBuf.destroy();
    this.tex = null; this.N = 0;
  }

  async compute(engine, build, world) {
    const { N, height, attrs, stats } = build;
    const g = this.gpu, dev = g.device;
    this.ensure(N);
    const cell = world.size / N, hscale = world.height;
    const [pAO, pPack, pMM, pLow] = await Promise.all([
      g.compute(NORMAL_AO, 'normal-ao'), g.compute(PACK, 'pack'), g.compute(MINMAX, 'minmax'), g.compute(LOWRES, 'lowres'),
    ]);
    // large-scale curvature: blur over ~1.2% of the terrain width (≥ 4 texels)
    await engine.blur(height, this.blurBuf, this.tmpBuf, Math.max(4, Math.min(48, (world.size * 0.012) / cell)));
    const enc = dev.createCommandEncoder();
    enc.copyBufferToTexture({ buffer: height, bytesPerRow: N * 4 }, { texture: this.tex.height }, [N, N]);
    const ua = g.uniform(32);
    {
      const ab = new ArrayBuffer(32), u = new Uint32Array(ab), f = new Float32Array(ab);
      u[0] = N; u[1] = N >= 2048 ? 12 : 16; u[2] = N >= 2048 ? 20 : 24; f[4] = cell; f[5] = hscale; f[6] = Math.min(world.size * 0.18, 1600); f[7] = 0;
      g.write(ua, f);
    }
    const up = g.uniform(32);
    {
      const ab = new ArrayBuffer(32), u = new Uint32Array(ab), f = new Float32Array(ab);
      u[0] = N; f[4] = hscale; f[5] = cell;
      g.write(up, f);
    }
    // CDLOD leaf grid is always 128² so the quadtree depth is resolution independent
    const L = Math.min(128, N);
    const leaf = N / L;
    const M = Math.min(N, 512);
    const um = g.uniform(16); g.write(um, new Uint32Array([N, L, leaf, M]));
    const mmBuf = g.storage(L * L * 16, 'minmax');
    const lowBuf = g.storage(M * M * 4, 'lowres');
    const pass = enc.beginComputePass();
    pass.setPipeline(pAO); pass.setBindGroup(0, g.bind(pAO, [ua, height, this.tex.normal.createView()])); pass.dispatchWorkgroups(wg(N), wg(N));
    pass.setPipeline(pPack);
    pass.setBindGroup(0, g.bind(pPack, [up, height, this.blurBuf, attrs.flow, attrs.wear, attrs.deposit, attrs.talus, attrs.snow, attrs.water,
      this.tex.attrA.createView(), this.tex.attrB.createView(), this.tex.water.createView()]));
    pass.dispatchWorkgroups(wg(N), wg(N));
    pass.setPipeline(pMM); pass.setBindGroup(0, g.bind(pMM, [um, height, mmBuf, attrs.water])); pass.dispatchWorkgroups(wg(L), wg(L));
    pass.setPipeline(pLow); pass.setBindGroup(0, g.bind(pLow, [um, height, lowBuf])); pass.dispatchWorkgroups(wg(M), wg(M));
    pass.end();
    dev.queue.submit([enc.finish()]);
    const [mm, low] = await Promise.all([g.read(mmBuf, L * L * 16), g.read(lowBuf, M * M * 4)]);
    ua.destroy(); up.destroy(); um.destroy(); mmBuf.destroy(); lowBuf.destroy();
    this.minmax = { L, leaf, data: new Float32Array(mm) };
    this.low = { M, data: new Float32Array(low) };
    this.stats = stats;
    this.heightBuffer = height;
    this.world = { size: world.size, height: hscale };
    this.version++;
    this.sunKey = '';
  }

  async shadows(sunDir, force = false) {
    if (!this.tex || !this.heightBuffer) return;
    const key = sunDir.map(v => v.toFixed(4)).join(',') + ':' + this.version;
    if (!force && key === this.sunKey) return;
    this.sunKey = key;
    const g = this.gpu;
    const p = await g.compute(SHADOW, 'shadow');
    const N = this.N;
    const u = g.uniform(48);
    const ab = new ArrayBuffer(48), uu = new Uint32Array(ab), f = new Float32Array(ab);
    uu[0] = N; uu[1] = N >= 2048 ? 160 : 128;
    f[4] = sunDir[0]; f[5] = sunDir[1]; f[6] = sunDir[2]; f[7] = this.world.size / N;
    f[8] = this.world.height; f[9] = (this.stats?.max ?? 1) * this.world.height + 5; f[10] = Math.tan(0.9 * Math.PI / 180);
    g.write(u, f);
    const enc = g.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(p); pass.setBindGroup(0, g.bind(p, [u, this.heightBuffer, this.tex.shadow.createView()])); pass.dispatchWorkgroups(wg(N), wg(N));
    pass.end();
    g.device.queue.submit([enc.finish()]);
    g.idle().then(() => u.destroy());
  }

  // CPU height query (metres) from the low-res copy, bilinear. x,z in world metres centred on the terrain.
  heightAt(x, z) {
    if (!this.low) return 0;
    const { M, data } = this.low;
    const W = this.world.size;
    const u = (x / W + 0.5) * M - 0.5, v = (z / W + 0.5) * M - 0.5;
    const cl = (a) => Math.max(0, Math.min(M - 1, a));
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const at = (xx, yy) => data[cl(yy) * M + cl(xx)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * this.world.height;
  }
}

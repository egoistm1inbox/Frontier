// GPU erosion and weathering simulations.
// Heights are normalised (× world height scale = metres). Attributes are metres, flow is 0..1.
import { NOISE_WGSL } from '../wgsl/noise.js';
import { wg } from '../core/gpu.js';

const N8 = /* wgsl */`
const OFF = array<vec2i, 8>(vec2i(-1,-1), vec2i(0,-1), vec2i(1,-1), vec2i(-1,0), vec2i(1,0), vec2i(-1,1), vec2i(0,1), vec2i(1,1));
const DIST = array<f32, 8>(1.41421356, 1.0, 1.41421356, 1.0, 1.0, 1.41421356, 1.0, 1.41421356);
`;

// ───────────────────────── Fluvial: stream-power law with iterative MFD drainage ─────────────────────────
const FLUVIAL_COMMON = /* wgsl */`
struct FP {
  N: u32, iter: u32, seed: u32, fillOn: u32,
  cell: f32, hscale: f32, dt: f32, K: f32,
  m: f32, pexp: f32, fill: f32, uplift: f32,
  sea: f32, rainVar: f32, world: f32, pad0: f32,
}
${N8}
fn idx(x: i32, y: i32, n: i32) -> u32 { return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1)); }
`;

const FL_RAIN = /* wgsl */`
${NOISE_WGSL}
${FLUVIAL_COMMON}
@group(0) @binding(0) var<uniform> F: FP;
@group(0) @binding(1) var<storage, read_write> rain: array<f32>;
@group(0) @binding(2) var<storage, read_write> A: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.N || g.y >= F.N) { return; }
  let i = g.y * F.N + g.x;
  let uv = (vec2f(g.xy) + 0.5) / f32(F.N);
  let p = (uv - 0.5) * F.world / 3500.0;
  let r = max(0.05, 1.0 + F.rainVar * fbm(p, 4, 2.0, 0.5, F.seed + 404u) * 1.6);
  let a = r * F.cell * F.cell;
  rain[i] = a;
  A[i] = a;
}`;

const FL_WEIGHTS = /* wgsl */`
${FLUVIAL_COMMON}
@group(0) @binding(0) var<uniform> F: FP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read_write> S: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.N || g.y >= F.N) { return; }
  let n = i32(F.N); let x = i32(g.x); let y = i32(g.y);
  let hi = h[g.y * F.N + g.x];
  var s = 0.0;
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + OFF[k];
    if (q.x < 0 || q.y < 0 || q.x >= n || q.y >= n) { continue; }
    let d = (hi - h[u32(q.y * n + q.x)]) / DIST[k];
    if (d > 0.0) { s += pow(d, F.pexp); }
  }
  S[g.y * F.N + g.x] = s;
}`;

const FL_ACCUM = /* wgsl */`
${FLUVIAL_COMMON}
@group(0) @binding(0) var<uniform> F: FP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> S: array<f32>;
@group(0) @binding(3) var<storage, read> Ain: array<f32>;
@group(0) @binding(4) var<storage, read_write> Aout: array<f32>;
@group(0) @binding(5) var<storage, read> rain: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.N || g.y >= F.N) { return; }
  let n = i32(F.N); let x = i32(g.x); let y = i32(g.y);
  let i = g.y * F.N + g.x;
  let hi = h[i];
  var a = rain[i];
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + OFF[k];
    if (q.x < 0 || q.y < 0 || q.x >= n || q.y >= n) { continue; }
    let j = u32(q.y * n + q.x);
    let d = (h[j] - hi) / DIST[k];
    if (d > 0.0) {
      let sj = S[j];
      if (sj > 0.0) { a += Ain[j] * pow(d, F.pexp) / sj; }
    }
  }
  Aout[i] = a;
}`;

const FL_ERODE = /* wgsl */`
${FLUVIAL_COMMON}
@group(0) @binding(0) var<uniform> F: FP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read_write> hOut: array<f32>;
@group(0) @binding(3) var<storage, read> A: array<f32>;
@group(0) @binding(4) var<storage, read> U: array<f32>;
@group(0) @binding(5) var<storage, read_write> wear: array<f32>;
@group(0) @binding(6) var<storage, read_write> dep: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.N || g.y >= F.N) { return; }
  let n = i32(F.N); let x = i32(g.x); let y = i32(g.y);
  let i = g.y * F.N + g.x;
  let hi = h[i] * F.hscale;
  let edge = x == 0 || y == 0 || x == n - 1 || y == n - 1;
  if (edge || hi <= F.sea) { hOut[i] = h[i]; return; }
  // MFD-weighted receiver: avoids grid-locked straight channels of pure D8
  var wsum = 0.0; var hr = 0.0; var dr = 0.0; var hmin = 1e30; var best = 0.0;
  for (var k = 0; k < 8; k++) {
    let q = vec2i(x, y) + OFF[k];
    let hk = h[u32(q.y * n + q.x)] * F.hscale;
    hmin = min(hmin, hk);
    let dk = DIST[k] * F.cell;
    let s = (hi - hk) / dk;
    if (s > 0.0) {
      let w = pow(s, F.pexp);
      wsum += w; hr += w * hk; dr += w * dk; best = max(best, s);
    }
  }
  if (wsum > 0.0) { hr /= wsum; dr /= wsum; }
  let up = F.uplift * U[i] * F.dt;
  var hn = hi + up;
  if (best > 0.0) {
    // channel initiation: stream power acts where the catchment exceeds ~0.015 km²; hillslopes are left to talus/creep
    let ch = smoothstep(4000.0, 15000.0, A[i]);
    let f = F.K * F.dt * pow(A[i], F.m) / dr * (0.04 + 0.96 * ch);
    hn = (hi + up + f * hr) / (1.0 + f);
    hn = max(hn, hr);
    wear[i] += max(hi + up - hn, 0.0);
  } else if (F.fillOn == 1u) {
    let tgt = hmin + 0.002;
    let add = max(tgt - hn, 0.0) * F.fill;
    hn += add;
    dep[i] += add;
  }
  hOut[i] = hn / F.hscale;
}`;

const FL_FINAL = /* wgsl */`
${FLUVIAL_COMMON}
@group(0) @binding(0) var<uniform> F: FP;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read_write> flow: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= F.N || g.y >= F.N) { return; }
  let i = g.y * F.N + g.x;
  let a0 = 1500.0;
  let aref = F.world * F.world * 0.04;
  let f = clamp(log(1.0 + A[i] / a0) / log(1.0 + aref / a0), 0.0, 1.0);
  flow[i] = max(flow[i], f);
}`;

// ───────────────────────── Thermal: gather formulation, shared-memory tile ─────────────────────────
function thermalWGSL(writeTalus) {
  return /* wgsl */`
${NOISE_WGSL}
struct TP {
  N: u32, seed: u32, pad0: u32, pad1: u32,
  T: f32, rate: f32, variance: f32, creep: f32,
  world: f32, cell: f32, pad2: f32, pad3: f32,
}
${N8}
@group(0) @binding(0) var<uniform> P: TP;
@group(0) @binding(1) var<storage, read> hIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> hOut: array<f32>;
${writeTalus ? '@group(0) @binding(3) var<storage, read_write> talus: array<f32>;' : ''}
var<workgroup> tile: array<f32, 144>;
var<workgroup> thr: array<f32, 144>;

fn excessFrom(c: i32, tc: f32) -> vec2f {
  // returns (amount leaving tile cell c, sum of positive excess)
  let hc = tile[c];
  var sumE = 0.0; var maxE = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = OFF[k];
    let d = hc - tile[c + o.y * 12 + o.x] - tc * DIST[k];
    if (d > 0.0) { sumE += d; maxE = max(maxE, d); }
  }
  return vec2f(P.rate * maxE * 0.5, sumE);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let n = i32(P.N);
  let base = vec2i(w.xy) * 8 - 2;
  for (var k = i32(l.y * 8u + l.x); k < 144; k += 64) {
    let tx = k % 12; let ty = k / 12;
    let gx = clamp(base.x + tx, 0, n - 1); let gy = clamp(base.y + ty, 0, n - 1);
    tile[k] = hIn[u32(gy * n + gx)];
    let wp = (vec2f(f32(gx), f32(gy)) / f32(n) - 0.5) * P.world;
    thr[k] = P.T * max(0.15, 1.0 + P.variance * gnoise(wp / 90.0, P.seed + 17u) * 1.3);
  }
  workgroupBarrier();
  if (g.x >= P.N || g.y >= P.N) { return; }
  let c = (i32(l.y) + 2) * 12 + i32(l.x) + 2;
  let hi = tile[c];
  let own = excessFrom(c, thr[c]);
  var inflow = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = OFF[k];
    let j = c + o.y * 12 + o.x;
    let dji = tile[j] - hi - thr[j] * DIST[k];
    if (dji > 0.0) {
      let ej = excessFrom(j, thr[j]);
      if (ej.y > 0.0) { inflow += ej.x * dji / ej.y; }
    }
  }
  var lap = 0.0;
  if (P.creep > 0.0) {
    lap = (tile[c - 1] + tile[c + 1] + tile[c - 12] + tile[c + 12]) * 0.2 + (tile[c - 13] + tile[c - 11] + tile[c + 11] + tile[c + 13]) * 0.05 - hi;
  }
  let i = g.y * P.N + g.x;
  let hn = hi - own.x + inflow + lap * P.creep;
  hOut[i] = hn;
  ${writeTalus ? 'talus[i] += max(inflow - own.x, 0.0) * P.pad2;' : ''}
}`;
}

// ───────────────────────── Hydraulic: GPU droplets with fixed-point atomics ─────────────────────────
const FIX = 268435456.0; // 2^28
const HY_TOFIX = /* wgsl */`
struct HP { N: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<uniform> P: HP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read_write> hi: array<i32>;
@group(0) @binding(3) var<storage, read_write> acc0: array<i32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let i = g.y * P.N + g.x;
  hi[i] = i32(round(clamp(h[i], -7.9, 7.9) * ${FIX}));
  acc0[i] = 0;
}`;

const HY_DROPS = /* wgsl */`
${NOISE_WGSL}
// Droplet hydraulic erosion in physical units.
// Positions in cells, heights in metres, sediment as volume (m³). Rates are per 8 m of travel.
struct HP {
  N: u32, maxSteps: u32, count: u32, batch: u32,
  inertia: f32, Kc: f32, minCap: f32, Ke: f32,
  Kd: f32, evap: f32, grav: f32, fric: f32,
  brush: f32, seedf: f32, cell: f32, hscale: f32,
}
@group(0) @binding(0) var<uniform> P: HP;
@group(0) @binding(1) var<storage, read_write> hq: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> flowA: array<atomic<i32>>;
const FIX = ${FIX};
const IFIX = ${1 / FIX};

fn hget(x: i32, y: i32) -> f32 {
  return f32(atomicLoad(&hq[u32(y) * P.N + u32(x)])) * IFIX * P.hscale;
}
fn hadd(x: i32, y: i32, dm: f32) {
  let v = i32(round(dm / P.hscale * FIX));
  if (v != 0) { atomicAdd(&hq[u32(y) * P.N + u32(x)], v); }
}
fn hg(p: vec2f) -> vec3f {
  let ix = i32(floor(p.x)); let iy = i32(floor(p.y));
  let fx = p.x - f32(ix); let fy = p.y - f32(iy);
  let a = hget(ix, iy); let b = hget(ix + 1, iy); let c = hget(ix, iy + 1); let d = hget(ix + 1, iy + 1);
  let gx = (b - a) * (1.0 - fy) + (d - c) * fy;
  let gy = (c - a) * (1.0 - fx) + (d - b) * fx;
  return vec3f(a * (1.0 - fx) * (1.0 - fy) + b * fx * (1.0 - fy) + c * (1.0 - fx) * fy + d * fx * fy, gx, gy);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let id = g.x;
  if (id >= P.count) { return; }
  let n = i32(P.N);
  let r = pcg3d(vec3u(id, P.batch, u32(P.seedf)));
  let span = f32(n - 6);
  var pos = vec2f(3.0 + f32(r.x) * (1.0 / 4294967296.0) * span, 3.0 + f32(r.y) * (1.0 / 4294967296.0) * span);
  var dir = vec2f(0.0);
  var v = 0.5;
  var water = 1.0;
  var sed = 0.0;
  let c2 = P.cell * P.cell;
  let R = P.brush;
  let Ri = i32(ceil(R));
  for (var s = 0u; s < P.maxSteps; s++) {
    let ix = i32(floor(pos.x)); let iy = i32(floor(pos.y));
    let off = pos - vec2f(f32(ix), f32(iy));
    let cur = hg(pos);
    dir = dir * P.inertia - cur.yz * (1.0 - P.inertia);
    let len = length(dir);
    if (len < 1e-9) {
      let a = hash1(id * 9781u + s * 6271u + P.batch) * TAU;
      dir = vec2f(cos(a), sin(a));
    } else { dir = dir / len; }
    pos += dir;
    if (pos.x < 2.0 || pos.y < 2.0 || pos.x >= f32(n) - 3.0 || pos.y >= f32(n) - 3.0) { break; }
    let nh = hg(pos).x;
    let dh = nh - cur.x;
    let slope = -dh / P.cell;
    atomicAdd(&flowA[u32(iy) * P.N + u32(ix)], i32(water * 256.0));
    v = sqrt(clamp(v * v * (1.0 - P.fric) + slope * P.grav, 0.0, 36.0));
    let cap = max(P.Kc * max(slope, 0.0) * v * water, P.minCap);
    if (sed > cap || dh > 0.0) {
      var dv = select((sed - cap) * P.Kd, min(dh * c2, sed), dh > 0.0);
      dv = clamp(dv, 0.0, sed);
      sed -= dv;
      let dm = dv / c2;
      hadd(ix, iy, dm * (1.0 - off.x) * (1.0 - off.y)); hadd(ix + 1, iy, dm * off.x * (1.0 - off.y));
      hadd(ix, iy + 1, dm * (1.0 - off.x) * off.y); hadd(ix + 1, iy + 1, dm * off.x * off.y);
    } else {
      let ev = min((cap - sed) * P.Ke, -dh * c2 * 0.35);
      var wsum = 0.0;
      for (var by = -Ri; by <= Ri; by++) {
        for (var bx = -Ri; bx <= Ri; bx++) {
          wsum += max(0.0, R - length(vec2f(f32(bx), f32(by)) - off + 0.5));
        }
      }
      if (wsum > 0.0) {
        let k = ev / (wsum * c2);
        for (var by = -Ri; by <= Ri; by++) {
          for (var bx = -Ri; bx <= Ri; bx++) {
            let w = max(0.0, R - length(vec2f(f32(bx), f32(by)) - off + 0.5));
            if (w > 0.0) { hadd(clamp(ix + bx, 0, n - 1), clamp(iy + by, 0, n - 1), -k * w); }
          }
        }
      }
      sed += ev;
    }
    water *= (1.0 - P.evap);
    if (water < 0.02) { break; }
  }
}`;

const HY_FROMFIX = /* wgsl */`
struct HP { N: u32, smoothOn: u32, pad0: u32, pad1: u32, smoothAmt: f32, hscale: f32, flowNorm: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> P: HP;
@group(0) @binding(1) var<storage, read> h0: array<f32>;
@group(0) @binding(2) var<storage, read> hq: array<i32>;
@group(0) @binding(3) var<storage, read_write> hOut: array<f32>;
@group(0) @binding(4) var<storage, read_write> wear: array<f32>;
@group(0) @binding(5) var<storage, read_write> dep: array<f32>;
fn delta(x: i32, y: i32) -> f32 {
  let n = i32(P.N);
  let i = u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
  return f32(hq[i]) * ${1 / FIX} - h0[i];
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let i = g.y * P.N + g.x;
  var d = delta(x, y);
  if (P.smoothOn == 1u) {
    let b = (delta(x - 1, y) + delta(x + 1, y) + delta(x, y - 1) + delta(x, y + 1)) * 0.125
          + (delta(x - 1, y - 1) + delta(x + 1, y - 1) + delta(x - 1, y + 1) + delta(x + 1, y + 1)) * 0.0625 + d * 0.25;
    d = mix(d, b, P.smoothAmt);
  }
  hOut[i] = h0[i] + d;
  wear[i] += max(-d, 0.0) * P.hscale;
  dep[i] += max(d, 0.0) * P.hscale;
}`;

const HY_ATTRS = /* wgsl */`
struct HP { N: u32, smoothOn: u32, pad0: u32, pad1: u32, smoothAmt: f32, hscale: f32, flowNorm: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> P: HP;
@group(0) @binding(1) var<storage, read> flowA: array<i32>;
@group(0) @binding(2) var<storage, read_write> flow: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let i = g.y * P.N + g.x;
  let area = f32(flowA[i]) / 256.0 * P.flowNorm;
  let a0 = 1500.0;
  let aref = P.pad2 * P.pad2 * 0.04;
  flow[i] = max(flow[i], clamp(log(1.0 + area / a0) / log(1.0 + aref / a0), 0.0, 1.0));
}`;

// ───────────────────────── Snow ─────────────────────────
const SNOW_INIT = /* wgsl */`
${NOISE_WGSL}
struct SP {
  N: u32, seed: u32, pad0: u32, pad1: u32,
  cell: f32, hscale: f32, world: f32, snowline: f32,
  fade: f32, depth: f32, maxSlope: f32, aspect: f32,
  aspectDir: f32, drift: f32, pad2: f32, pad3: f32,
}
@group(0) @binding(0) var<uniform> P: SP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read_write> s: array<f32>;
fn H(x: i32, y: i32) -> f32 { let n = i32(P.N); return h[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))] * P.hscale; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let x = i32(g.x); let y = i32(g.y);
  let hm = H(x, y);
  let dx = (H(x + 1, y) - H(x - 1, y)) / (2.0 * P.cell);
  let dz = (H(x, y + 1) - H(x, y - 1)) / (2.0 * P.cell);
  let nrm = normalize(vec3f(-dx, 1.0, -dz));
  let slope = degrees(acos(clamp(nrm.y, 0.0, 1.0)));
  let wp = ((vec2f(g.xy) + 0.5) / f32(P.N) - 0.5) * P.world;
  let n1 = fbm(wp / 900.0, 5, 2.0, 0.5, P.seed + 3u);
  let alt = sstep(P.snowline - P.fade, P.snowline + P.fade, hm + n1 * P.fade * 0.6);
  let sl = 1.0 - sstep(P.maxSlope - 10.0, P.maxSlope + 3.0, slope);
  let b = radians(P.aspectDir);
  let shade = vec2f(sin(b), -cos(b));
  let asp = clamp(1.0 + P.aspect * dot(nrm.xz, shade) * 3.0, 0.0, 2.2);
  let k = max(1, i32(round(36.0 / P.cell)));
  let ring = (H(x + k, y) + H(x - k, y) + H(x, y + k) + H(x, y - k)) * 0.25;
  let lap = ring - hm;
  let dr = clamp(1.0 + P.drift * lap / 6.0, 0.15, 2.4);
  let n2 = 0.75 + 0.5 * (fbm(wp / 140.0, 4, 2.0, 0.5, P.seed + 9u) * 0.5 + 0.5);
  s[g.y * P.N + g.x] = P.depth * alt * sl * asp * dr * n2 / P.hscale;
}`;

const SNOW_SLIDE = /* wgsl */`
struct AP { N: u32, pad0: u32, pad1: u32, pad2: u32, T: f32, rate: f32, pad3: f32, pad4: f32 }
${N8}
@group(0) @binding(0) var<uniform> P: AP;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> sIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> sOut: array<f32>;
var<workgroup> th: array<f32, 144>;
var<workgroup> ts: array<f32, 144>;
fn outOf(c: i32) -> vec2f {
  let hc = th[c] + ts[c];
  var sumE = 0.0; var maxE = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = OFF[k]; let j = c + o.y * 12 + o.x;
    let d = hc - (th[j] + ts[j]) - P.T * DIST[k];
    if (d > 0.0) { sumE += d; maxE = max(maxE, d); }
  }
  return vec2f(min(ts[c], P.rate * maxE * 0.5), sumE);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let n = i32(P.N);
  let base = vec2i(w.xy) * 8 - 2;
  for (var k = i32(l.y * 8u + l.x); k < 144; k += 64) {
    let gx = clamp(base.x + k % 12, 0, n - 1); let gy = clamp(base.y + k / 12, 0, n - 1);
    let gi = u32(gy * n + gx);
    th[k] = h[gi]; ts[k] = sIn[gi];
  }
  workgroupBarrier();
  if (g.x >= P.N || g.y >= P.N) { return; }
  let c = (i32(l.y) + 2) * 12 + i32(l.x) + 2;
  let own = outOf(c);
  let hc = th[c] + ts[c];
  var inflow = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = OFF[k]; let j = c + o.y * 12 + o.x;
    let dji = (th[j] + ts[j]) - hc - P.T * DIST[k];
    if (dji > 0.0) { let e = outOf(j); if (e.y > 0.0) { inflow += e.x * dji / e.y; } }
  }
  sOut[g.y * P.N + g.x] = max(ts[c] - own.x + inflow, 0.0);
}`;

const SNOW_FINAL = /* wgsl */`
struct FP2 { N: u32, addH: u32, pad0: u32, pad1: u32, hscale: f32, pad2: f32, pad3: f32, pad4: f32 }
@group(0) @binding(0) var<uniform> P: FP2;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> s: array<f32>;
@group(0) @binding(3) var<storage, read_write> hOut: array<f32>;
@group(0) @binding(4) var<storage, read_write> snow: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.N || g.y >= P.N) { return; }
  let i = g.y * P.N + g.x;
  let d = s[i];
  hOut[i] = h[i] + select(0.0, d, P.addH == 1u);
  snow[i] = max(snow[i], d * P.hscale);
}`;

// ───────────────────────── Orchestration ─────────────────────────
export class Sims {
  constructor(gpu) { this.gpu = gpu; this.ubufs = []; }

  u(size) { return this.gpu.uniform(size); }

  async fluvial(ctx, layer, src, dst) {
    const { gpu, N, world, hscale, cell, buf, signal, progress } = ctx;
    const p = layer.params;
    const dev = gpu.device;
    const [pRain, pW, pA, pE, pF, pT] = await Promise.all([
      gpu.compute(FL_RAIN, 'fl-rain'), gpu.compute(FL_WEIGHTS, 'fl-weights'), gpu.compute(FL_ACCUM, 'fl-accum'),
      gpu.compute(FL_ERODE, 'fl-erode'), gpu.compute(FL_FINAL, 'fl-final'), gpu.compute(thermalWGSL(false), 'thermal-plain'),
    ]);
    const resF = Math.pow(Math.min(Math.max(N / 1024, 0.35), 2), 0.75);
    const iters = Math.max(20, Math.round((60 + 1500 * p.duration) * resF));
    const T = 250 + 900 * p.duration;
    const dt = T / iters;
    // Calibrate K by knickpoint travel: a 1 km² catchment's incision front travels `travel` metres over the run.
    const travel = world * (0.04 + 1.1 * p.strength * p.strength);
    const K = travel / (Math.pow(1e6, p.concavity) * T);
    // uplift map: input height normalised to its max (computed from stats)
    const stats = await ctx.stats(src);
    const hMax = Math.max(stats.max, 1e-4);
    const upliftRate = p.upliftOn ? (p.uplift * 1.6 * hMax * hscale) / T : 0;

    const fpU = this.u(64);
    const ab = new ArrayBuffer(64), u32 = new Uint32Array(ab), f32 = new Float32Array(ab);
    u32[0] = N; u32[1] = 0; u32[2] = layer.params.seed >>> 0; u32[3] = p.fillPits ? 1 : 0;
    f32[4] = cell; f32[5] = hscale; f32[6] = dt; f32[7] = K;
    f32[8] = p.concavity; f32[9] = 1.1 + 6.0 * p.spread; f32[10] = 0.15 + 0.85 * p.fillRate; f32[11] = upliftRate;
    f32[12] = ctx.sea; f32[13] = p.rainVar; f32[14] = world; f32[15] = 0;
    gpu.write(fpU, f32);

    // talus threshold (normalised height per texel)
    const tpU = this.u(48);
    const tab = new ArrayBuffer(48), tu = new Uint32Array(tab), tf = new Float32Array(tab);
    tu[0] = N; tu[1] = layer.params.seed >>> 0;
    // soil creep as linear diffusion: total smoothing length ≈ 2..40 m regardless of resolution
    const sigmaM = 2 + 38 * p.soften;
    const applications = Math.ceil(iters / 2);
    const creep = Math.min(0.2, (sigmaM * sigmaM) / (2 * applications * cell * cell));
    tf[4] = Math.tan(p.talus * Math.PI / 180) * cell / hscale; tf[5] = 0.5; tf[6] = 0.25; tf[7] = creep;
    tf[8] = world; tf[9] = cell;
    gpu.write(tpU, tf);

    const hA = src, hB = dst, A0 = buf.s0, A1 = buf.s1, S = buf.s2, rain = buf.s3, U = buf.s4;
    const enc0 = dev.createCommandEncoder();
    // uplift map = src / hMax
    enc0.copyBufferToBuffer(src, 0, U, 0, N * N * 4);
    dev.queue.submit([enc0.finish()]);
    if (p.upliftOn) await ctx.scaleBuffer(U, 1 / hMax, 0);

    const g = wg(N);
    {
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pRain); pass.setBindGroup(0, gpu.bind(pRain, [fpU, rain, A0])); pass.dispatchWorkgroups(g, g);
      pass.end();
      dev.queue.submit([enc.finish()]);
    }
    // bind groups for both ping-pong directions
    const bgW = [gpu.bind(pW, [fpU, hA, S]), gpu.bind(pW, [fpU, hB, S])];
    const bgA = [
      [gpu.bind(pA, [fpU, hA, S, A0, A1, rain]), gpu.bind(pA, [fpU, hA, S, A1, A0, rain])],
      [gpu.bind(pA, [fpU, hB, S, A0, A1, rain]), gpu.bind(pA, [fpU, hB, S, A1, A0, rain])],
    ];
    const bgE = [gpu.bind(pE, [fpU, hA, hB, A0, U, buf.wear, buf.deposit]), gpu.bind(pE, [fpU, hB, hA, A0, U, buf.wear, buf.deposit])];
    const bgT = [gpu.bind(pT, [tpU, hA, hB]), gpu.bind(pT, [tpU, hB, hA])];
    // warm-up drainage so channels exist from the first iteration
    const warm = Math.round(Math.min(N, 512) * 0.6);
    {
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pW); pass.setBindGroup(0, bgW[0]); pass.dispatchWorkgroups(g, g);
      pass.setPipeline(pA);
      for (let k = 0; k < warm; k += 2) {
        pass.setBindGroup(0, bgA[0][0]); pass.dispatchWorkgroups(g, g);
        pass.setBindGroup(0, bgA[0][1]); pass.dispatchWorkgroups(g, g);
      }
      pass.end();
      dev.queue.submit([enc.finish()]);
    }
    let cur = 0; // 0 → height in hA
    const chunk = Math.max(4, Math.round(24 * 1024 * 1024 / (N * N)));
    for (let it = 0; it < iters; it += chunk) {
      if (signal.aborted) return null;
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      const end = Math.min(iters, it + chunk);
      for (let k = it; k < end; k++) {
        pass.setPipeline(pW); pass.setBindGroup(0, bgW[cur]); pass.dispatchWorkgroups(g, g);
        pass.setPipeline(pA);
        pass.setBindGroup(0, bgA[cur][0]); pass.dispatchWorkgroups(g, g);
        pass.setBindGroup(0, bgA[cur][1]); pass.dispatchWorkgroups(g, g);
        pass.setPipeline(pE); pass.setBindGroup(0, bgE[cur]); pass.dispatchWorkgroups(g, g);
        cur ^= 1;
        if ((k & 1) === 1) { pass.setPipeline(pT); pass.setBindGroup(0, bgT[cur]); pass.dispatchWorkgroups(g, g); cur ^= 1; }
      }
      pass.end();
      dev.queue.submit([enc.finish()]);
      await gpu.idle();
      progress?.(end / iters);
    }
    // final flow attribute
    {
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pF); pass.setBindGroup(0, gpu.bind(pF, [fpU, A0, buf.flow])); pass.dispatchWorkgroups(g, g);
      pass.end();
      if (cur === 0) enc.copyBufferToBuffer(hA, 0, dst, 0, N * N * 4);
      dev.queue.submit([enc.finish()]);
    }
    if (p.upliftOn && p.keepHeight) {
      const st = await ctx.stats(dst);
      if (st.max > 1e-5) await ctx.scaleBuffer(dst, hMax / st.max, 0);
    }
    fpU.destroy(); tpU.destroy();
    return dst;
  }

  async thermal(ctx, layer, src, dst) {
    const { gpu, N, world, hscale, cell, buf, signal, progress } = ctx;
    const p = layer.params;
    const pT = await gpu.compute(thermalWGSL(true), 'thermal-talus');
    const tpU = this.u(48);
    const tab = new ArrayBuffer(48), tu = new Uint32Array(tab), tf = new Float32Array(tab);
    tu[0] = N; tu[1] = p.seed >>> 0;
    tf[4] = Math.tan(p.angle * Math.PI / 180) * cell / hscale; tf[5] = 0.1 + 0.8 * p.rate; tf[6] = p.variance; tf[7] = 0;
    tf[8] = world; tf[9] = cell; tf[10] = hscale;
    gpu.write(tpU, tf);
    const a = src, b = dst;
    const dev = gpu.device;
    let enc;
    const bg = [gpu.bind(pT, [tpU, a, b, buf.talus]), gpu.bind(pT, [tpU, b, a, buf.talus])];
    const g = wg(N);
    const iters = Math.round(p.iterations * Math.min(Math.max(N / 1024, 0.5), 2));
    const chunk = Math.max(8, Math.round(64 * 1024 * 1024 / (N * N)));
    let cur = 0;
    for (let it = 0; it < iters; it += chunk) {
      if (signal.aborted) return null;
      enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pT);
      for (let k = it; k < Math.min(iters, it + chunk); k++) { pass.setBindGroup(0, bg[cur]); pass.dispatchWorkgroups(g, g); cur ^= 1; }
      pass.end();
      dev.queue.submit([enc.finish()]);
      await gpu.idle();
      progress?.(Math.min(1, (it + chunk) / iters));
    }
    if (cur === 0) {
      enc = dev.createCommandEncoder();
      enc.copyBufferToBuffer(a, 0, dst, 0, N * N * 4);
      dev.queue.submit([enc.finish()]);
    }
    tpU.destroy();
    return dst;
  }

  async hydraulic(ctx, layer, src, dst) {
    const { gpu, N, hscale, cell, world, buf, signal, progress } = ctx;
    const p = layer.params;
    const dev = gpu.device;
    const [pTo, pDrop, pFrom, pAt] = await Promise.all([
      gpu.compute(HY_TOFIX, 'hy-tofix'), gpu.compute(HY_DROPS, 'hy-drops'), gpu.compute(HY_FROMFIX, 'hy-fromfix'),
      gpu.compute(HY_ATTRS, 'hy-attrs'),
    ]);
    const g = wg(N);
    const u0 = this.u(16); gpu.write(u0, new Uint32Array([N, 0, 0, 0]));
    const hq = buf.s0, fA = buf.s1;
    let enc = dev.createCommandEncoder();
    let pass = enc.beginComputePass();
    pass.setPipeline(pTo); pass.setBindGroup(0, gpu.bind(pTo, [u0, src, hq, fA])); pass.dispatchWorkgroups(g, g);
    pass.end();
    dev.queue.submit([enc.finish()]);

    // Droplet density is defined per area (rain × 0.35 per 64 m²) so results stay consistent across resolutions.
    const st = cell / 8; // per-step rates are defined per 8 m of travel
    const total = Math.round(p.rain * 0.35 * (world * world) / 64);
    const perBatch = Math.min(total, Math.max(16384, Math.round(N * N / 2)));
    const batches = Math.max(1, Math.ceil(total / perBatch));
    const brush = Math.max(0.75, Math.min(4.5, p.brush / cell));
    const steps = Math.max(12, Math.min(2048, Math.round(p.lifetime * 1000 / cell)));
    const ubufs = [];
    const chunkB = Math.max(1, Math.round(2 * 1024 * 1024 / perBatch));
    for (let b = 0; b < batches; b += chunkB) {
      if (signal.aborted) { ubufs.forEach(x => x.destroy()); return null; }
      enc = dev.createCommandEncoder();
      pass = enc.beginComputePass();
      pass.setPipeline(pDrop);
      for (let k = b; k < Math.min(batches, b + chunkB); k++) {
        const ab = new ArrayBuffer(64), u = new Uint32Array(ab), f = new Float32Array(ab);
        const count = Math.min(perBatch, total - k * perBatch);
        u[0] = N; u[1] = steps; u[2] = count; u[3] = k + 1;
        f[4] = Math.pow(p.inertia, st); f[5] = 80 * p.capacity; f[6] = 0.5; f[7] = Math.min(0.95, (0.03 + 0.5 * p.erosion) * st);
        f[8] = p.depositOn ? Math.min(0.95, (0.02 + 0.6 * p.deposition) * st) : 0.0; f[9] = Math.min(0.5, p.evaporation * st);
        f[10] = 2.0 * st; f[11] = Math.min(0.9, 0.12 * st);
        f[12] = brush; f[13] = (p.seed * 7919) % 100000; f[14] = cell; f[15] = hscale;
        const ub = this.u(64); gpu.write(ub, f); ubufs.push(ub);
        pass.setBindGroup(0, gpu.bind(pDrop, [ub, hq, fA]));
        pass.dispatchWorkgroups(Math.ceil(count / 64));
      }
      pass.end();
      dev.queue.submit([enc.finish()]);
      await gpu.idle();
      progress?.(Math.min(1, (b + chunkB) / batches));
    }
    ubufs.forEach(x => x.destroy());
    const uf = this.u(32);
    const ab = new ArrayBuffer(32), u = new Uint32Array(ab), f = new Float32Array(ab);
    // flow → equivalent drainage area (each droplet stands for world²/total m²), same log scale as fluvial
    u[0] = N; u[1] = p.smoothOn ? 1 : 0; f[4] = p.smoothing; f[5] = hscale; f[6] = (world * world) / total; f[7] = world;
    gpu.write(uf, f);
    enc = dev.createCommandEncoder();
    pass = enc.beginComputePass();
    pass.setPipeline(pFrom);
    pass.setBindGroup(0, gpu.bind(pFrom, [uf, src, hq, dst, buf.wear, buf.deposit]));
    pass.dispatchWorkgroups(g, g);
    pass.setPipeline(pAt);
    pass.setBindGroup(0, gpu.bind(pAt, [uf, fA, buf.flow]));
    pass.dispatchWorkgroups(g, g);
    pass.end();
    dev.queue.submit([enc.finish()]);
    u0.destroy(); uf.destroy();
    return dst;
  }

  async snow(ctx, layer, src, dst) {
    const { gpu, N, world, hscale, cell, buf, signal, progress } = ctx;
    const p = layer.params;
    const dev = gpu.device;
    const [pI, pS, pF] = await Promise.all([
      gpu.compute(SNOW_INIT, 'snow-init'), gpu.compute(SNOW_SLIDE, 'snow-slide'), gpu.compute(SNOW_FINAL, 'snow-final'),
    ]);
    const g = wg(N);
    const ui = this.u(64);
    {
      const ab = new ArrayBuffer(64), u = new Uint32Array(ab), f = new Float32Array(ab);
      u[0] = N; u[1] = p.seed >>> 0;
      f[4] = cell; f[5] = hscale; f[6] = world; f[7] = p.snowline;
      f[8] = p.fade; f[9] = p.depth; f[10] = p.maxSlope; f[11] = p.aspect;
      f[12] = p.aspectDir; f[13] = p.drift;
      gpu.write(ui, f);
    }
    const us = this.u(32);
    {
      const ab = new ArrayBuffer(32), u = new Uint32Array(ab), f = new Float32Array(ab);
      u[0] = N; f[4] = Math.tan(Math.max(20, p.maxSlope - 6) * Math.PI / 180) * cell / hscale; f[5] = 0.5;
      gpu.write(us, f);
    }
    const s0 = buf.s0, s1 = buf.s1;
    let enc = dev.createCommandEncoder();
    let pass = enc.beginComputePass();
    pass.setPipeline(pI); pass.setBindGroup(0, gpu.bind(pI, [ui, src, s0])); pass.dispatchWorkgroups(g, g);
    let cur = 0;
    const iters = Math.round(p.avalanche * Math.min(Math.max(N / 1024, 0.5), 2));
    if (iters > 0) {
      pass.setPipeline(pS);
      const bg = [gpu.bind(pS, [us, src, s0, s1]), gpu.bind(pS, [us, src, s1, s0])];
      for (let k = 0; k < iters; k++) { pass.setBindGroup(0, bg[cur]); pass.dispatchWorkgroups(g, g); cur ^= 1; }
    }
    const uf = this.u(32);
    gpu.write(uf, new Float32Array([0, 0, 0, 0, hscale, 0, 0, 0]));
    gpu.write(uf, new Uint32Array([N, p.addHeight ? 1 : 0, 0, 0]));
    pass.setPipeline(pF); pass.setBindGroup(0, gpu.bind(pF, [uf, src, cur === 0 ? s0 : s1, dst, buf.snow])); pass.dispatchWorkgroups(g, g);
    pass.end();
    dev.queue.submit([enc.finish()]);
    await gpu.idle();
    progress?.(1);
    ui.destroy(); us.destroy(); uf.destroy();
    if (signal.aborted) return null;
    return dst;
  }

  async hydrology(ctx, layer, src, dst) {
    const { gpu, N, world, hscale, cell, buf, signal, progress } = ctx;
    const p = layer.params;
    const heights = new Float32Array(await gpu.read(src, N * N * 4));
    if (signal.aborted) return null;
    progress?.(0.15);
    const flowPrev = new Float32Array(await gpu.read(buf.flow, N * N * 4));
    const waterPrev = new Float32Array(await gpu.read(buf.water, N * N * 4));
    const result = await runHydrologyWorker({
      heights, N, world, hscale, cell, sea: ctx.sea, params: { ...p },
    }, signal);
    if (!result || signal.aborted) return null;
    progress?.(0.9);
    for (let i = 0; i < N * N; i++) {
      flowPrev[i] = Math.max(flowPrev[i], result.flow[i]);
      waterPrev[i] = Math.max(waterPrev[i], result.water[i]);
    }
    gpu.write(dst, result.heights);
    gpu.write(buf.flow, flowPrev);
    gpu.write(buf.water, waterPrev);
    progress?.(1);
    return dst;
  }
}

let worker = null;
let jobId = 0;
function runHydrologyWorker(job, signal) {
  if (!worker) worker = new Worker(new URL('./hydrology-worker.js', import.meta.url), { type: 'module' });
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMsg);
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result);
    };
    worker.addEventListener('message', onMsg);
    signal?.addEventListener('abort', () => { worker.removeEventListener('message', onMsg); resolve(null); }, { once: true });
    worker.postMessage({ id, job }, [job.heights.buffer]);
  });
}

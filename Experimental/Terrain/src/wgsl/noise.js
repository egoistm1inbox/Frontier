// Shared WGSL noise library: PCG hashing, gradient noise with analytic derivatives,
// fBm families (fBm, ridged multifractal, billow, Swiss turbulence, derivative-damped "erosive"),
// Voronoi and domain warping. Deterministic for a given seed on every GPU.
export const NOISE_WGSL = /* wgsl */`
const PI = 3.14159265358979;
const TAU = 6.28318530717959;

fn pcg3d(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3u(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn pcg1(x: u32) -> u32 {
  let s = x * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash33(p: vec3i) -> vec3f { return vec3f(pcg3d(bitcast<vec3u>(p))) * (1.0 / 4294967296.0); }
fn hash1(x: u32) -> f32 { return f32(pcg1(x)) * (1.0 / 4294967296.0); }
fn hash2f(p: vec2i, seed: u32) -> vec2f { return hash33(vec3i(p, i32(seed))).xy; }

// Rotation applied between octaves to hide lattice alignment.
const OCT_ROT = mat2x2f(0.8, 0.6, -0.6, 0.8);
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

fn grad2(ip: vec2i, seed: u32) -> vec2f {
  let a = hash33(vec3i(ip, i32(seed))).x * TAU;
  return vec2f(cos(a), sin(a));
}

// Quintic gradient noise. Returns (value, d/dx, d/dy); value roughly in [-1, 1].
fn gnoised(p: vec2f, seed: u32) -> vec3f {
  let pf = floor(p);
  let i = vec2i(pf);
  let f = p - pf;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = grad2(i, seed);
  let gb = grad2(i + vec2i(1, 0), seed);
  let gc = grad2(i + vec2i(0, 1), seed);
  let gd = grad2(i + vec2i(1, 1), seed);
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let k = va - vb - vc + vd;
  let v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  let d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * k + vec2f(vb, vc) - va);
  return vec3f(v, d) * 1.4142;
}
fn gnoise(p: vec2f, seed: u32) -> f32 { return gnoised(p, seed).x; }

fn grad3(ip: vec3i, seed: u32) -> vec3f {
  let h = hash33(ip + vec3i(i32(seed) * 7919, i32(seed) * 104729, 0));
  let z = h.x * 2.0 - 1.0;
  let a = h.y * TAU;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3f(r * cos(a), r * sin(a), z);
}
fn gnoise3(p: vec3f, seed: u32) -> f32 {
  let pf = floor(p);
  let i = vec3i(pf);
  let f = p - pf;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = dot(grad3(i, seed), f);
  let n100 = dot(grad3(i + vec3i(1, 0, 0), seed), f - vec3f(1, 0, 0));
  let n010 = dot(grad3(i + vec3i(0, 1, 0), seed), f - vec3f(0, 1, 0));
  let n110 = dot(grad3(i + vec3i(1, 1, 0), seed), f - vec3f(1, 1, 0));
  let n001 = dot(grad3(i + vec3i(0, 0, 1), seed), f - vec3f(0, 0, 1));
  let n101 = dot(grad3(i + vec3i(1, 0, 1), seed), f - vec3f(1, 0, 1));
  let n011 = dot(grad3(i + vec3i(0, 1, 1), seed), f - vec3f(0, 1, 1));
  let n111 = dot(grad3(i + vec3i(1, 1, 1), seed), f - vec3f(1, 1, 1));
  let x00 = mix(n000, n100, u.x); let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x); let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 1.6;
}

fn fbm(p0: vec2f, octaves: i32, lac: f32, gain: f32, seed: u32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
  for (var i = 0; i < octaves; i++) {
    s += a * gnoise(p, seed + u32(i) * 131u);
    n += a; a *= gain; p = OCT_ROT * p * lac;
  }
  return s / max(n, 1e-5);
}
fn fbm3(p0: vec3f, octaves: i32, seed: u32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
  for (var i = 0; i < octaves; i++) {
    s += a * gnoise3(p, seed + u32(i) * 131u);
    n += a; a *= 0.5; p = p * 2.03 + vec3f(1.7, -3.1, 2.3);
  }
  return s / n;
}

// Musgrave ridged multifractal, result in [0, 1].
fn ridged(p0: vec2f, octaves: i32, lac: f32, gain: f32, sharp: f32, seed: u32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0; var w = 1.0;
  for (var i = 0; i < octaves; i++) {
    var r = 1.0 - abs(gnoise(p, seed + u32(i) * 131u));
    r = pow(clamp(r, 0.0, 1.0), sharp);
    r *= w;
    w = clamp(r * 1.8, 0.0, 1.0);
    s += r * a; n += a;
    a *= gain; p = OCT_ROT * p * lac;
  }
  return s / max(n, 1e-5);
}

fn billow(p0: vec2f, octaves: i32, lac: f32, gain: f32, seed: u32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
  for (var i = 0; i < octaves; i++) {
    s += a * (abs(gnoise(p, seed + u32(i) * 131u)) * 2.0 - 1.0);
    n += a; a *= gain; p = OCT_ROT * p * lac;
  }
  return s / max(n, 1e-5);
}

// de Carpentier & Bidarra Swiss turbulence: derivative-warped ridges, in ~[0, 1].
fn swiss(p0: vec2f, octaves: i32, lac: f32, gain: f32, warp: f32, seed: u32) -> f32 {
  var freq = 1.0; var amp = 1.0; var s = 0.0; var n = 0.0;
  var dsum = vec2f(0.0);
  for (var i = 0; i < octaves; i++) {
    let q = OCT_ROT * ((p0 + warp * dsum) * freq);
    let nd = gnoised(q, seed + u32(i) * 131u) * vec3f(0.72, 0.72, 0.72);
    s += amp * (1.0 - abs(nd.x));
    n += amp;
    dsum += amp * nd.yz * -nd.x;
    freq *= lac;
    amp *= gain * clamp(s / n, 0.0, 1.0);
  }
  return s / max(n, 1e-5);
}

// Derivative-damped fBm (Quilez): slopes suppress small detail, mimicking erosion.
fn erosive(p0: vec2f, octaves: i32, lac: f32, gain: f32, k: f32, seed: u32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
  var d = vec2f(0.0);
  for (var i = 0; i < octaves; i++) {
    let nd = gnoised(p, seed + u32(i) * 131u);
    d += nd.yz * a;
    s += a * nd.x / (1.0 + k * dot(d, d));
    n += a; a *= gain; p = OCT_ROT * p * lac;
  }
  return s / max(n, 1e-5);
}

// Voronoi: returns (F1, F2) distances in cell units.
fn voronoi(p: vec2f, jitter: f32, seed: u32) -> vec2f {
  let ip = vec2i(floor(p));
  let fp = p - floor(p);
  var f1 = 8.0; var f2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = vec2i(x, y);
      let o = hash2f(ip + c, seed) * jitter + 0.5 * (1.0 - jitter);
      let r = vec2f(c) + o - fp;
      let d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return sqrt(vec2f(f1, f2));
}

fn warp2(p: vec2f, amount: f32, freq: f32, seed: u32) -> vec2f {
  if (amount <= 0.0) { return p; }
  let q = vec2f(fbm(p * freq + vec2f(17.13, 3.71), 4, 2.0, 0.5, seed + 7001u),
                fbm(p * freq + vec2f(-9.27, 23.17), 4, 2.0, 0.5, seed + 7919u));
  return p + q * amount;
}

fn sstep(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.0) / max(k, 1e-6); return min(a, b) - h * h * k * 0.25; }
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }
`;

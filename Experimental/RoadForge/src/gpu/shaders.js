// RoadForge — WGSL shader library.
// Physically-motivated forward renderer: analytic sky + cascaded sun shadows +
// grid-culled street lighting + analytically antialiased road markings.
//
// NOTE: every derivative (fwidth/dpdx) is evaluated in the uniform prologue of
// the fragment entry points, then passed down — WGSL forbids derivatives in
// non-uniform control flow.

export const COMMON = /* wgsl */`
struct Globals {
  viewProj   : mat4x4<f32>,
  view       : mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  shadow0    : mat4x4<f32>,
  shadow1    : mat4x4<f32>,
  camPos     : vec4<f32>,
  sunDir     : vec4<f32>,
  sunColor   : vec4<f32>,
  skyParams  : vec4<f32>,
  fogParams  : vec4<f32>,
  shadowP    : vec4<f32>,
  gridP      : vec4<f32>,
  misc       : vec4<f32>,
  misc2      : vec4<f32>,
};

struct Material {
  color : vec4<f32>,
  pbr   : vec4<f32>,
  extra : vec4<f32>,
};

struct RoadParam {
  a : vec4<f32>,
  b : vec4<f32>,
  c : vec4<f32>,
  d : vec4<f32>,
};

struct Light {
  pos   : vec4<f32>,
  color : vec4<f32>,
  dir   : vec4<f32>,
  parm  : vec4<f32>,
};

@group(0) @binding(0) var<uniform> G : Globals;
@group(0) @binding(1) var<storage, read> materials : array<Material>;
@group(0) @binding(2) var<storage, read> roadParams : array<RoadParam>;
@group(0) @binding(3) var<storage, read> lights : array<Light>;
@group(0) @binding(4) var<storage, read> lightGrid : array<u32>;
@group(0) @binding(5) var texAlbedo : texture_2d_array<f32>;
@group(0) @binding(6) var texSurf   : texture_2d_array<f32>;
@group(0) @binding(7) var samp      : sampler;
@group(0) @binding(8) var shadowTex : texture_depth_2d_array;
@group(0) @binding(9) var shadowSamp: sampler_comparison;

const PI : f32 = 3.14159265359;

fn hash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>, oct: i32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < oct; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.03 + vec2<f32>(11.3, 7.1);
    a = a * 0.5;
  }
  return v;
}

/* ----------------------------------------------------------------- sky */

fn sunDisc(dir: vec3<f32>, sun: vec3<f32>) -> f32 {
  return smoothstep(0.99962, 0.99991, dot(dir, sun));
}

fn skyBase(dir: vec3<f32>, sun: vec3<f32>) -> vec3<f32> {
  let h = clamp(dir.y, -0.25, 1.0);
  let day = smoothstep(-0.12, 0.26, sun.y);
  let horizonT = pow(1.0 - clamp(h, 0.0, 1.0), 4.0);

  let zenithDay    = vec3<f32>(0.055, 0.135, 0.330);
  let horizonDay   = vec3<f32>(0.330, 0.430, 0.560);
  let zenithDusk   = vec3<f32>(0.048, 0.056, 0.108);
  let horizonDusk  = vec3<f32>(0.430, 0.185, 0.085);
  let zenithNight  = vec3<f32>(0.0060, 0.0098, 0.0230);
  let horizonNight = vec3<f32>(0.0165, 0.0215, 0.0380);

  let sy = max(sun.y, -0.25) * 4.4;
  let dusk = exp(-(sy * sy));
  var zen = mix(zenithNight, zenithDay, day);
  var hor = mix(horizonNight, horizonDay, day);
  zen = mix(zen, zenithDusk, dusk * 0.8);
  hor = mix(hor, horizonDusk, dusk * 0.9);

  var col = mix(zen, hor, horizonT);
  let m = max(dot(dir, sun), 0.0);
  let halo = pow(m, 7.0) * 0.40 + pow(m, 160.0) * 1.8;
  col = col + G.sunColor.rgb * halo * (0.30 + day * 0.9);
  let below = smoothstep(0.0, -0.12, dir.y);
  col = mix(col, vec3<f32>(0.030, 0.029, 0.027) * (0.25 + day), below);
  return col;
}

fn stars(dir: vec3<f32>) -> vec3<f32> {
  if (dir.y < 0.02) { return vec3<f32>(0.0); }
  let g = floor(vec2<f32>(dir.x, dir.z) / max(dir.y, 0.05) * 150.0);
  let n = hash21(g);
  let b = step(0.9968, n) * (0.4 + 0.6 * hash21(g + 3.7));
  let tw = 0.7 + 0.3 * sin(G.misc2.x * 2.3 + n * 60.0);
  return vec3<f32>(b * tw) * vec3<f32>(0.85, 0.9, 1.0);
}

fn clouds(dir: vec3<f32>, sun: vec3<f32>) -> vec4<f32> {
  let cover = G.skyParams.z;
  if (dir.y < 0.015 || cover < 0.01) { return vec4<f32>(0.0); }
  let t = 1400.0 / max(dir.y, 0.02);
  let p = vec2<f32>(dir.x, dir.z) * t * 0.0012 + vec2<f32>(G.misc2.x * 0.004, G.misc2.x * 0.002);
  var d = fbm(p, 5);
  d = smoothstep(1.0 - cover * 0.9, 1.0 - cover * 0.25, d);
  let fade = smoothstep(0.015, 0.16, dir.y);
  let dens = d * fade;
  let lit = clamp(dot(normalize(vec3<f32>(dir.x, 0.35, dir.z)), sun) * 0.5 + 0.6, 0.0, 1.4);
  let day = smoothstep(-0.1, 0.25, sun.y);
  var col = mix(vec3<f32>(0.030, 0.034, 0.045), vec3<f32>(0.60, 0.61, 0.64), day) * lit;
  col = col + G.sunColor.rgb * pow(max(dot(dir, sun), 0.0), 14.0) * 0.35 * day;
  return vec4<f32>(col, dens);
}

fn skyFull(dir: vec3<f32>) -> vec3<f32> {
  let sun = normalize(G.sunDir.xyz);
  var col = skyBase(dir, sun);
  col = col + stars(dir) * G.skyParams.y;
  col = col + G.sunColor.rgb * sunDisc(dir, sun) * 12.0;
  let c = clouds(dir, sun);
  col = mix(col, c.rgb, clamp(c.a, 0.0, 1.0));
  return col;
}

/* ------------------------------------------------------------- lighting */

fn D_GGX(NoH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}
fn V_Smith(NoV: f32, NoL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-6);
}
fn F_Schlick(u: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - u, 0.0, 1.0), 5.0);
}

fn sampleShadow(worldPos: vec3<f32>, NoL: f32, viewDepth: f32) -> f32 {
  var sp = vec4<f32>(0.0);
  var layer = 0;
  if (viewDepth < G.shadowP.x) {
    sp = G.shadow0 * vec4<f32>(worldPos, 1.0);
  } else if (viewDepth < G.shadowP.y) {
    sp = G.shadow1 * vec4<f32>(worldPos, 1.0);
    layer = 1;
  } else {
    return 1.0;
  }
  let ndc = sp.xyz / sp.w;
  if (ndc.x < -1.0 || ndc.x > 1.0 || ndc.y < -1.0 || ndc.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
    return 1.0;
  }
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  let scale = select(1.0, 3.0, layer == 1);
  let bias = G.shadowP.w * (1.0 + (1.0 - NoL) * 4.0) * scale;
  let d = ndc.z - bias;
  let tx = G.shadowP.z * scale;
  var sum = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let o = vec2<f32>(f32(x), f32(y)) * tx;
      sum = sum + textureSampleCompareLevel(shadowTex, shadowSamp, uv + o, layer, d);
    }
  }
  return sum / 9.0;
}

fn envSpecular(R: vec3<f32>, rough: f32) -> vec3<f32> {
  let sun = normalize(G.sunDir.xyz);
  let dir = normalize(mix(vec3<f32>(R.x, max(R.y, -0.25), R.z), vec3<f32>(0.0, 1.0, 0.0), rough * 0.55));
  var col = skyBase(dir, sun);
  col = col + G.sunColor.rgb * pow(max(dot(dir, sun), 0.0), mix(10.0, 900.0, 1.0 - rough)) * (1.0 - rough) * 2.0;
  return col;
}

fn ambientIBL(N: vec3<f32>) -> vec3<f32> {
  let sun = normalize(G.sunDir.xyz);
  let up = skyBase(vec3<f32>(0.0, 1.0, 0.0), sun);
  let hz = skyBase(normalize(vec3<f32>(N.x, 0.12, N.z) + vec3<f32>(0.0008, 0.0, 0.0)), sun);
  let dn = vec3<f32>(0.016, 0.015, 0.014) * (0.3 + smoothstep(-0.1, 0.3, sun.y));
  let t = N.y * 0.5 + 0.5;
  return mix(dn, mix(hz, up, smoothstep(0.0, 1.0, t)), smoothstep(0.0, 0.55, t)) * G.sunColor.w;
}

fn punctual(P: vec3<f32>, N: vec3<f32>, V: vec3<f32>, albedo: vec3<f32>, rough: f32, f0: vec3<f32>) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  let cs = G.gridP.z;
  let n = i32(G.gridP.w);
  let gx = i32(floor((P.x - G.gridP.x) / cs));
  let gz = i32(floor((P.z - G.gridP.y) / cs));
  if (gx < 0 || gz < 0 || gx >= n || gz >= n) { return acc; }
  let base = u32((gz * n + gx) * 8);
  let a = max(rough * rough, 0.015);
  for (var i = 0u; i < 8u; i = i + 1u) {
    let id = lightGrid[base + i];
    if (id == 0xffffffffu) { break; }
    let L = lights[id];
    let dv = L.pos.xyz - P;
    let dist = length(dv);
    if (dist > L.pos.w) { continue; }
    let ld = dv / max(dist, 1e-4);
    let NoL = dot(N, ld);
    if (NoL <= 0.0) { continue; }
    var att = clamp(1.0 - dist / L.pos.w, 0.0, 1.0);
    att = att * att / (1.0 + dist * dist * 0.05);
    if (L.dir.w > -0.5) {
      let cd = dot(normalize(-L.dir.xyz), ld);
      let sp = clamp((cd - L.dir.w) / max(L.parm.x - L.dir.w, 1e-3), 0.0, 1.0);
      att = att * sp * sp;
    }
    if (att < 0.0012) { continue; }
    let H = normalize(ld + V);
    let NoV = max(dot(N, V), 1e-4);
    let spec = D_GGX(max(dot(N, H), 0.0), a) * V_Smith(NoV, NoL, a) * F_Schlick(max(dot(H, V), 0.0), f0);
    acc = acc + L.color.rgb * L.color.w * att * NoL * (albedo / PI + spec);
  }
  return acc;
}

fn applyFog(col: vec3<f32>, P: vec3<f32>, dist: f32) -> vec3<f32> {
  let sun = normalize(G.sunDir.xyz);
  let hf = exp(-max(P.y - G.fogParams.z, 0.0) * G.fogParams.y);
  let d = max(dist - 14.0, 0.0);
  let f = 1.0 - exp(-d * G.fogParams.x * hf);
  let V = normalize(P - G.camPos.xyz);
  let inscat = pow(max(dot(V, sun), 0.0), 8.0);
  let fogCol = mix(skyBase(normalize(vec3<f32>(V.x, max(V.y, 0.02), V.z)), sun),
                   G.sunColor.rgb * 1.2, inscat * 0.4);
  return mix(col, fogCol, clamp(f, 0.0, 1.0));
}

fn tangentNormal(N: vec3<f32>, dpx: vec3<f32>, dpy: vec3<f32>, dux: vec2<f32>, duy: vec2<f32>, nt: vec2<f32>) -> vec3<f32> {
  let r = duy.y * dpx - dux.y * dpy;
  if (length(r) < 1e-7) { return N; }
  let T = normalize(r - N * dot(N, r));
  let B = cross(N, T);
  return normalize(T * nt.x + B * nt.y + N);
}
`;

/* ------------------------------------------------------------- markings */

export const MARKINGS = /* wgsl */`
fn band(x: f32, half: f32, w: f32) -> f32 {
  return 1.0 - smoothstep(half - w, half + w, abs(x));
}
fn dashMask(s: f32, on: f32, period: f32, w: f32) -> f32 {
  let t = fract(s / period) * period;
  return smoothstep(-w, w, on - t) * smoothstep(-w, w, t);
}

struct Paint { cov: f32, col: vec3<f32> };

fn roadPaint(lat: f32, along: f32, rpIdx: u32, dLat: f32, dAlong: f32) -> Paint {
  var out: Paint;
  out.cov = 0.0;
  out.col = vec3<f32>(0.52, 0.52, 0.50);
  if (G.misc.w < 0.5) { return out; }
  let rp = roadParams[rpIdx];
  let flags = u32(rp.b.w);
  if ((flags & 512u) != 0u) { return out; }
  if ((flags & 32768u) != 0u) { return out; }
  let wl = dLat * 0.85;
  let ws = dAlong * 0.85;
  let lw = rp.a.x;
  let lanesF = rp.a.y;
  let lanesB = rp.a.z;
  let mh = rp.a.w;
  let roadHalf = rp.b.x;
  let span = rp.b.y;
  let parkL = rp.d.x;
  let parkR = rp.d.y;
  let yellow = (flags & 1024u) != 0u;
  let white = vec3<f32>(0.54, 0.54, 0.52);
  let amber = vec3<f32>(0.46, 0.30, 0.035);
  let centreCol = select(white, amber, yellow);

  var cov = 0.0;
  var col = white;

  var x = mh;
  for (var i = 0; i < 5; i = i + 1) {
    if (f32(i) >= lanesF - 1.0) { break; }
    x = x + lw;
    let m = band(lat - x, 0.055, wl) * dashMask(along, 3.0, 9.0, ws);
    if (m > cov) { cov = m; col = white; }
  }
  var xb = -mh;
  for (var i = 0; i < 5; i = i + 1) {
    if (f32(i) >= lanesB - 1.0) { break; }
    xb = xb - lw;
    let m = band(lat - xb, 0.055, wl) * dashMask(along, 3.0, 9.0, ws);
    if (m > cov) { cov = m; col = white; }
  }

  if ((flags & 1u) != 0u) {
    let m = max(band(lat - 0.085, 0.055, wl), band(lat + 0.085, 0.055, wl));
    if (m > cov) { cov = m; col = centreCol; }
  } else if ((flags & 2u) != 0u) {
    let m = band(lat, 0.06, wl) * dashMask(along, 3.0, 9.0, ws);
    if (m > cov) { cov = m; col = centreCol; }
  }

  if ((flags & 4u) != 0u) {
    let e = roadHalf - 0.30;
    let mL = band(lat + e, 0.065, wl);
    let mR = band(lat - e, 0.065, wl);
    if (mL > cov) { cov = mL; col = select(white, amber, yellow); }
    if (mR > cov) { cov = mR; col = white; }
  }

  if ((flags & 128u) != 0u && parkL > 0.2) {
    let inner = -(roadHalf - 0.42 - parkL);
    let inBay = step(lat, inner) * step(-(roadHalf - 0.42), lat);
    let line = band(lat - inner, 0.05, wl);
    let ticks = band(fract(along / 6.4) * 6.4 - 0.08, 0.055, ws) * inBay;
    let m = max(line * step(lat, inner + 0.1), ticks);
    if (m > cov) { cov = m; col = white; }
  }
  if ((flags & 256u) != 0u && parkR > 0.2) {
    let inner = roadHalf - 0.42 - parkR;
    let inBay = step(inner, lat) * step(lat, roadHalf - 0.42);
    let line = band(lat - inner, 0.05, wl);
    let ticks = band(fract(along / 6.4) * 6.4 - 0.08, 0.055, ws) * inBay;
    let m = max(line * step(inner - 0.1, lat), ticks);
    if (m > cov) { cov = m; col = white; }
  }

  let cw = rp.c.w;
  let dA = along;
  let dB = span - along;
  let inRoad = step(abs(lat), roadHalf - 0.2);
  if ((flags & 8u) != 0u) {
    let z = dA - 0.55;
    let inZone = step(0.0, z) * step(z, cw);
    let stripe = dashMask(lat + 60.0, 0.55, 1.0, wl);
    let m = stripe * inZone * inRoad;
    if (m > cov) { cov = m; col = white; }
    let sl = band(dA - (cw + 1.3), 0.22, ws) * step(lat, 0.0) * step(-roadHalf + 0.3, lat);
    if (sl > cov && (flags & 32u) != 0u) { cov = sl; col = white; }
  }
  if ((flags & 16u) != 0u) {
    let z = dB - 0.55;
    let inZone = step(0.0, z) * step(z, cw);
    let stripe = dashMask(lat + 60.0, 0.55, 1.0, wl);
    let m = stripe * inZone * inRoad;
    if (m > cov) { cov = m; col = white; }
    let sl = band(dB - (cw + 1.3), 0.22, ws) * step(0.0, lat) * step(lat, roadHalf - 0.3);
    if (sl > cov && (flags & 64u) != 0u) { cov = sl; col = white; }
  }

  if ((flags & 16384u) != 0u) {
    let e = roadHalf - 0.42 - 1.6;
    let m = band(lat - e, 0.05, wl) * dashMask(along, 1.0, 2.0, ws);
    if (m > cov) { cov = m; col = white; }
  }

  out.cov = cov * clamp(rp.c.z, 0.12, 1.0);
  out.col = col;
  return out;
}
`;

/* --------------------------------------------------------------- surface */

export const SURFACE_WGSL = /* wgsl */`
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) nrm   : vec3<f32>,
  @location(2) uv    : vec2<f32>,
  @location(3) aux   : vec4<f32>,
  @location(4) @interpolate(flat) ids : vec4<u32>,
  @location(5) viewDepth : f32,
};

@vertex
fn vs(
  @location(0) pos: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) aux: vec4<f32>,
  @location(4) ids: vec4<u32>,
) -> VSOut {
  var o: VSOut;
  o.world = pos;
  o.nrm = nrm;
  o.uv = uv;
  o.aux = aux;
  o.ids = ids;
  o.clip = G.viewProj * vec4<f32>(pos, 1.0);
  o.viewDepth = -(G.view * vec4<f32>(pos, 1.0)).z;
  return o;
}

@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  let m = materials[i.ids.x];
  let slot = i32(m.pbr.z);
  let uvs = i.uv * m.pbr.w;

  // ---- uniform derivative prologue ----
  let dpx = dpdx(i.world);
  let dpy = dpdy(i.world);
  let dux = dpdx(uvs);
  let duy = dpdy(uvs);
  let dLat = max(fwidth(i.aux.x), 1e-5);
  let dAlong = max(fwidth(i.aux.y), 1e-5);
  let texA = textureSample(texAlbedo, samp, uvs, max(slot, 0));
  let texS = textureSample(texSurf, samp, uvs, max(slot, 0));

  var albedo = m.color.rgb;
  var rough = m.pbr.x;
  var ao = 1.0;
  var N = normalize(i.nrm);

  if (slot >= 0) {
    albedo = albedo * (texA.rgb * 2.0);
    rough = clamp(rough * (0.55 + texS.b * 0.9), 0.04, 1.0);
    ao = mix(1.0, texS.a, G.misc2.y);
    N = tangentNormal(N, dpx, dpy, dux, duy, (texS.rg - 0.5) * 2.0);
  }

  let wear = clamp(i.aux.z, 0.0, 1.5);
  let patch = clamp(i.aux.w, 0.0, 1.0);
  let flags = u32(m.extra.y);
  let isRoad = (flags & 1u) != 0u;

  if (isRoad) {
    albedo = albedo * (1.0 + wear * 0.8);
    rough = clamp(rough + wear * 0.1 - 0.04, 0.05, 1.0);
    if (patch > 0.01) {
      let pn = vnoise(vec2<f32>(i.world.x, i.world.z) * 1.7);
      albedo = mix(albedo, albedo * (0.5 + pn * 0.55), patch * 0.85);
      rough = mix(rough, 0.92, patch * 0.45);
    }
    let rp = roadParams[i.ids.y];
    let lw = max(rp.a.x, 2.5);
    let lat = abs(i.aux.x);
    let track = abs(fract(lat / lw + 0.5) - 0.5) * lw;
    let polish = (1.0 - smoothstep(0.16, 0.6, abs(track - 0.45))) * 0.5;
    rough = clamp(rough - polish * 0.2, 0.05, 1.0);
    albedo = albedo * (1.0 - polish * 0.1);

    let paint = roadPaint(i.aux.x, i.aux.y, i.ids.y, dLat, dAlong);
    if (paint.cov > 0.002) {
      let grime = 0.7 + 0.3 * vnoise(vec2<f32>(i.world.x, i.world.z) * 6.0);
      albedo = mix(albedo, paint.col * grime, paint.cov);
      rough = mix(rough, 0.58, paint.cov);
    }
  }

  let wet = G.fogParams.w;
  if (wet > 0.001 && (flags & 2u) != 0u) {
    let pud = smoothstep(0.5, 0.85, fbm(vec2<f32>(i.world.x, i.world.z) * 0.35, 3) + wear * 0.2);
    let k = wet * (0.4 + pud * 0.6) * clamp(N.y, 0.0, 1.0);
    albedo = albedo * (1.0 - 0.5 * k);
    rough = mix(rough, 0.05, k);
    N = normalize(mix(N, vec3<f32>(0.0, 1.0, 0.0), k * 0.7 * pud));
  }

  let V = normalize(G.camPos.xyz - i.world);
  let metal = m.pbr.y;
  let f0 = mix(vec3<f32>(0.04), albedo, metal);
  let diffuse = albedo * (1.0 - metal);
  let L = normalize(G.sunDir.xyz);
  let NoL = max(dot(N, L), 0.0);
  let NoV = max(dot(N, V), 1e-4);
  var col = vec3<f32>(0.0);

  if (NoL > 0.0) {
    let sh = sampleShadow(i.world, NoL, i.viewDepth);
    if (sh > 0.001) {
      let H = normalize(L + V);
      let a = max(rough * rough, 0.0025);
      let spec = D_GGX(max(dot(N, H), 0.0), a) * V_Smith(NoV, NoL, a) * F_Schlick(max(dot(H, V), 0.0), f0);
      col = col + (diffuse / PI + spec) * G.sunColor.rgb * G.sunDir.w * NoL * sh;
    }
  }

  col = col + diffuse * ambientIBL(N) * ao;
  let R = reflect(-V, N);
  col = col + envSpecular(R, rough) * F_Schlick(NoV, f0) * ao * mix(0.3, 1.0, 1.0 - rough);
  col = col + punctual(i.world, N, V, diffuse, rough, f0);
  col = col + m.color.rgb * m.extra.x * 3.0;

  let oid = f32(i.ids.z);
  if (oid > 0.5 && abs(oid - G.misc.x) < 0.5) {
    col = mix(col, col * 0.65 + vec3<f32>(0.42, 0.66, 1.05) * 0.55, 0.45);
  } else if (oid > 0.5 && abs(oid - G.misc.y) < 0.5) {
    col = mix(col, col * 0.85 + vec3<f32>(0.3, 0.45, 0.7) * 0.3, 0.3);
  }

  col = applyFog(col, i.world, length(i.world - G.camPos.xyz));
  return vec4<f32>(col, 1.0);
}

@vertex
fn vsShadow0(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return G.shadow0 * vec4<f32>(pos, 1.0);
}
@vertex
fn vsShadow1(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return G.shadow1 * vec4<f32>(pos, 1.0);
}
`;

/* ------------------------------------------------------------- instanced */

export const INSTANCED_WGSL = /* wgsl */`
struct Instance {
  model : mat4x4<f32>,
  color : vec4<f32>,
  parm  : vec4<f32>,
};
@group(1) @binding(0) var<storage, read> instances : array<Instance>;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) nrm   : vec3<f32>,
  @location(2) uv    : vec2<f32>,
  @location(3) aux   : vec4<f32>,
  @location(4) @interpolate(flat) ids : vec4<u32>,
  @location(5) viewDepth : f32,
  @location(6) @interpolate(flat) tint : vec4<f32>,
};

@vertex
fn vs(
  @builtin(instance_index) ii: u32,
  @location(0) pos: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) aux: vec4<f32>,
  @location(4) ids: vec4<u32>,
) -> VSOut {
  let inst = instances[ii];
  let wp = inst.model * vec4<f32>(pos, 1.0);
  var o: VSOut;
  o.world = wp.xyz;
  o.nrm = normalize((inst.model * vec4<f32>(nrm, 0.0)).xyz);
  o.uv = uv;
  o.aux = aux;
  var id2 = ids;
  if (inst.parm.y >= 0.0) { id2.x = u32(inst.parm.y); }
  id2.z = u32(inst.parm.x);
  o.ids = id2;
  o.tint = inst.color;
  o.clip = G.viewProj * wp;
  o.viewDepth = -(G.view * wp).z;
  return o;
}

@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  let m = materials[i.ids.x];
  let slot = i32(m.pbr.z);
  let uvs = i.uv * m.pbr.w;
  let dpx = dpdx(i.world);
  let dpy = dpdy(i.world);
  let dux = dpdx(uvs);
  let duy = dpdy(uvs);
  let texA = textureSample(texAlbedo, samp, uvs, max(slot, 0));
  let texS = textureSample(texSurf, samp, uvs, max(slot, 0));

  var albedo = m.color.rgb * i.tint.rgb;
  var rough = m.pbr.x;
  var ao = 1.0;
  var N = normalize(i.nrm);
  if (slot >= 0) {
    albedo = albedo * (texA.rgb * 2.0);
    rough = clamp(rough * (0.55 + texS.b * 0.9), 0.04, 1.0);
    ao = mix(1.0, texS.a, G.misc2.y);
    N = tangentNormal(N, dpx, dpy, dux, duy, (texS.rg - 0.5) * 2.0);
  }
  let V = normalize(G.camPos.xyz - i.world);
  let metal = m.pbr.y;
  let f0 = mix(vec3<f32>(0.04), albedo, metal);
  let diffuse = albedo * (1.0 - metal);
  let L = normalize(G.sunDir.xyz);
  let NoL = max(dot(N, L), 0.0);
  let NoV = max(dot(N, V), 1e-4);
  var col = vec3<f32>(0.0);
  if (NoL > 0.0) {
    let sh = sampleShadow(i.world, NoL, i.viewDepth);
    if (sh > 0.001) {
      let H = normalize(L + V);
      let a = max(rough * rough, 0.0025);
      let spec = D_GGX(max(dot(N, H), 0.0), a) * V_Smith(NoV, NoL, a) * F_Schlick(max(dot(H, V), 0.0), f0);
      col = col + (diffuse / PI + spec) * G.sunColor.rgb * G.sunDir.w * NoL * sh;
    }
  }
  col = col + diffuse * ambientIBL(N) * ao;
  let R = reflect(-V, N);
  col = col + envSpecular(R, rough) * F_Schlick(NoV, f0) * ao * mix(0.3, 1.0, 1.0 - rough);
  col = col + punctual(i.world, N, V, diffuse, rough, f0);
  col = col + albedo * (m.extra.x + i.tint.a) * 3.2;
  let oid = f32(i.ids.z);
  if (oid > 0.5 && abs(oid - G.misc.x) < 0.5) {
    col = mix(col, col * 0.65 + vec3<f32>(0.42, 0.66, 1.05) * 0.55, 0.45);
  }
  col = applyFog(col, i.world, length(i.world - G.camPos.xyz));
  return vec4<f32>(col, 1.0);
}

@vertex
fn vsShadow0(@builtin(instance_index) ii: u32, @location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return G.shadow0 * instances[ii].model * vec4<f32>(pos, 1.0);
}
@vertex
fn vsShadow1(@builtin(instance_index) ii: u32, @location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return G.shadow1 * instances[ii].model * vec4<f32>(pos, 1.0);
}
`;

/* -------------------------------------------------------------- sky pass */

export const SKY_WGSL = /* wgsl */`
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o: VSOut;
  o.ndc = p[vi];
  o.clip = vec4<f32>(p[vi], 0.0, 1.0);
  return o;
}
@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  let far = G.invViewProj * vec4<f32>(i.ndc, 1.0, 1.0);
  let near = G.invViewProj * vec4<f32>(i.ndc, 0.0, 1.0);
  let dir = normalize(far.xyz / far.w - near.xyz / near.w);
  var col = skyFull(dir);
  let haze = exp(-abs(dir.y) * 18.0) * 0.5;
  col = mix(col, skyBase(normalize(vec3<f32>(dir.x, 0.004, dir.z)), normalize(G.sunDir.xyz)) * 1.05, haze);
  return vec4<f32>(col, 1.0);
}
`;

/* ------------------------------------------------------------ line pass */

export const LINE_WGSL = /* wgsl */`
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) col : vec4<f32>,
};
@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) col: vec4<f32>) -> VSOut {
  var o: VSOut;
  var p = G.viewProj * vec4<f32>(pos, 1.0);
  p.z = p.z - 0.00025 * p.w;
  o.clip = p;
  o.col = col;
  return o;
}
@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  return i.col;
}
`;

/* ------------------------------------------------- quad topology overlay */
// Draws the mesh's unique quad-boundary edges straight from the surface
// vertex buffer, so the overlay is the real topology rather than a fake grid.

export const WIRE_WGSL = /* wgsl */`
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) fade : f32,
};
@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) nrm: vec3<f32>) -> VSOut {
  var o: VSOut;
  let lift = pos + nrm * 0.012;
  var p = G.viewProj * vec4<f32>(lift, 1.0);
  p.z = p.z - 0.00045 * p.w;
  o.clip = p;
  let d = length(lift - G.camPos.xyz);
  o.fade = clamp(1.0 - (d - 40.0) / 260.0, 0.0, 1.0);
  return o;
}
@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(vec3<f32>(0.58, 0.78, 0.95) * 0.9, 0.42 * i.fade);
}
`;

/* ------------------------------------------------------------- post pass */

export const POST_WGSL = /* wgsl */`
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var srcSamp : sampler;
@group(0) @binding(2) var<uniform> P : vec4<f32>;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o: VSOut;
  o.clip = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTex));
  var c = textureSample(srcTex, srcSamp, i.uv).rgb;
  var b = textureSample(srcTex, srcSamp, i.uv + vec2<f32>(3.0, 0.0) * texel).rgb;
  b = b + textureSample(srcTex, srcSamp, i.uv - vec2<f32>(3.0, 0.0) * texel).rgb;
  b = b + textureSample(srcTex, srcSamp, i.uv + vec2<f32>(0.0, 3.0) * texel).rgb;
  b = b + textureSample(srcTex, srcSamp, i.uv - vec2<f32>(0.0, 3.0) * texel).rgb;
  b = b * 0.25;
  let bright = max(b - vec3<f32>(1.0), vec3<f32>(0.0));
  c = c + bright * 0.45;
  c = c * P.x;
  c = aces(c);
  c = pow(c, vec3<f32>(0.4545));
  let d = length(i.uv - vec2<f32>(0.5));
  c = c * (1.0 - P.y * smoothstep(0.3, 0.98, d));
  let g = fract(sin(dot(i.uv * P.w, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  c = c + (g - 0.5) * P.z;
  return vec4<f32>(c, 1.0);
}
`;

export function surfaceModule() { return COMMON + MARKINGS + SURFACE_WGSL; }
export function instancedModule() { return COMMON + MARKINGS + INSTANCED_WGSL; }
export function skyModule() { return COMMON + SKY_WGSL; }
export function lineModule() { return COMMON + LINE_WGSL; }
export function wireModule() { return COMMON + WIRE_WGSL; }
export function postModule() { return POST_WGSL; }

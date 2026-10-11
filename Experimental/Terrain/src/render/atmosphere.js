// Physically based sky & aerial perspective (Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique"). Distances in km inside the atmosphere code; world is Y-up, metres.
import { hexToLinear } from '../core/math.js';

export const ATMO_STRUCT = /* wgsl */`
struct Atmo {
  bottomR: f32, topR: f32, rayleighH: f32, mieH: f32,
  rayleighScat: vec3f, mieG: f32,
  mieScat: vec3f, sunAngular: f32,
  mieExt: vec3f, camAltKm: f32,
  ozoneAbs: vec3f, baseAltKm: f32,
  groundAlbedo: vec3f, apMaxKm: f32,
  sunDir: vec3f, sunIllum: f32,
  sunColor: vec3f, fogDensity: f32,
  fogColor: vec3f, fogHeight: f32,
  invViewProj: mat4x4f,
  camPos: vec3f, fogBase: f32,
}
const PI_A = 3.14159265358979;
fn raySphere(ro: vec3f, rd: vec3f, r: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  if (c > 0.0 && b > 0.0) { return -1.0; }
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc);
  if (disc > b * b) { return -b + s; }
  return -b - s;
}
fn hgPhase(g: f32, c: f32) -> f32 {
  let g2 = g * g;
  // Cornette-Shanks
  return 3.0 / (8.0 * PI_A) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
fn rayleighPhase(c: f32) -> f32 { return 3.0 / (16.0 * PI_A) * (1.0 + c * c); }
struct Medium { rs: vec3f, ms: vec3f, ext: vec3f }
fn medium(A: Atmo, hkm: f32) -> Medium {
  let h = max(hkm, 0.0);
  let rd = exp(-h / A.rayleighH);
  let md = exp(-h / A.mieH);
  let od = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  var m: Medium;
  m.rs = A.rayleighScat * rd;
  m.ms = A.mieScat * md;
  m.ext = m.rs + A.mieExt * md + A.ozoneAbs * od;
  return m;
}
fn transUV(A: Atmo, vh: f32, cz: f32) -> vec2f {
  let H = sqrt(max(0.0, A.topR * A.topR - A.bottomR * A.bottomR));
  let rho = sqrt(max(0.0, vh * vh - A.bottomR * A.bottomR));
  let disc = vh * vh * (cz * cz - 1.0) + A.topR * A.topR;
  let d = max(0.0, -vh * cz + sqrt(max(disc, 0.0)));
  let dmin = A.topR - vh;
  let dmax = rho + H;
  return vec2f((d - dmin) / max(dmax - dmin, 1e-6), rho / H);
}
`;

const TRANSMITTANCE = /* wgsl */`
${ATMO_STRUCT}
@group(0) @binding(0) var<uniform> A: Atmo;
@group(0) @binding(1) var outT: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let dims = textureDimensions(outT);
  if (g.x >= dims.x || g.y >= dims.y) { return; }
  let uv = (vec2f(g.xy) + 0.5) / vec2f(dims);
  let H = sqrt(A.topR * A.topR - A.bottomR * A.bottomR);
  let rho = H * uv.y;
  let vh = sqrt(rho * rho + A.bottomR * A.bottomR);
  let dmin = A.topR - vh;
  let dmax = rho + H;
  let d = dmin + uv.x * (dmax - dmin);
  var cz = 1.0;
  if (d > 0.0) { cz = clamp((H * H - rho * rho - d * d) / (2.0 * vh * d), -1.0, 1.0); }
  let ro = vec3f(0.0, vh, 0.0);
  let rd = vec3f(sqrt(max(0.0, 1.0 - cz * cz)), cz, 0.0);
  let tMax = max(raySphere(ro, rd, A.topR), 0.0);
  var od = vec3f(0.0);
  let STEPS = 40;
  let dt = tMax / f32(STEPS);
  for (var i = 0; i < STEPS; i++) {
    let p = ro + rd * ((f32(i) + 0.5) * dt);
    od += medium(A, length(p) - A.bottomR).ext * dt;
  }
  textureStore(outT, g.xy, vec4f(exp(-od), 1.0));
}`;

const MULTISCAT = /* wgsl */`
${ATMO_STRUCT}
@group(0) @binding(0) var<uniform> A: Atmo;
@group(0) @binding(1) var transT: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var outM: texture_storage_2d<rgba16float, write>;
fn trans(vh: f32, cz: f32) -> vec3f { return textureSampleLevel(transT, samp, transUV(A, vh, cz), 0.0).rgb; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let dims = textureDimensions(outM);
  if (g.x >= dims.x || g.y >= dims.y) { return; }
  let uv = (vec2f(g.xy) + 0.5) / vec2f(dims);
  let cs = uv.x * 2.0 - 1.0;
  let vh = A.bottomR + clamp(uv.y + 0.0001, 0.0, 1.0) * (A.topR - A.bottomR - 0.002);
  let sunDir = vec3f(sqrt(max(0.0, 1.0 - cs * cs)), cs, 0.0);
  let ro = vec3f(0.0, vh, 0.0);
  var L2 = vec3f(0.0);
  var fms = vec3f(0.0);
  let SQ = 8;
  for (var a = 0; a < SQ; a++) {
    for (var b = 0; b < SQ; b++) {
      let th = PI_A * (f32(a) + 0.5) / f32(SQ);
      let ph = acos(clamp(1.0 - 2.0 * (f32(b) + 0.5) / f32(SQ), -1.0, 1.0));
      let rd = vec3f(cos(th) * sin(ph), cos(ph), sin(th) * sin(ph));
      let tB = raySphere(ro, rd, A.bottomR);
      let tT = raySphere(ro, rd, A.topR);
      var tMax = tT;
      if (tB > 0.0) { tMax = tB; }
      let STEPS = 20;
      let dt = max(tMax, 0.0) / f32(STEPS);
      var T = vec3f(1.0);
      var Lp = vec3f(0.0);
      var F = vec3f(0.0);
      for (var i = 0; i < STEPS; i++) {
        let p = ro + rd * ((f32(i) + 0.3) * dt);
        let r = length(p);
        let m = medium(A, r - A.bottomR);
        let sT = exp(-m.ext * dt);
        let up = p / r;
        let sz = dot(up, sunDir);
        let Ts = trans(r, sz);
        let shadow = select(1.0, 0.0, raySphere(p + up * 0.001, sunDir, A.bottomR) > 0.0);
        let sc = m.rs + m.ms;
        let S = shadow * Ts * sc / (4.0 * PI_A);
        let ext = max(m.ext, vec3f(1e-7));
        Lp += T * (S - S * sT) / ext;
        F += T * (sc - sc * sT) / ext;
        T *= sT;
      }
      if (tB > 0.0) {
        let p = ro + rd * tB;
        let up = normalize(p);
        let sz = dot(up, sunDir);
        Lp += T * trans(length(p), sz) * max(sz, 0.0) * A.groundAlbedo / PI_A;
      }
      L2 += Lp; fms += F;
    }
  }
  let invN = 1.0 / f32(SQ * SQ);
  L2 *= invN; fms *= invN;
  let psi = L2 / max(vec3f(1.0) - fms, vec3f(1e-4));
  textureStore(outM, g.xy, vec4f(psi, 1.0));
}`;

const COMMON_SCATTER = /* wgsl */`
fn trans(vh: f32, cz: f32) -> vec3f { return textureSampleLevel(transT, samp, transUV(A, vh, cz), 0.0).rgb; }
fn msLookup(vh: f32, cz: f32) -> vec3f {
  let uv = vec2f(cz * 0.5 + 0.5, (vh - A.bottomR) / (A.topR - A.bottomR));
  return textureSampleLevel(msT, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
}
struct ScatterOut { L: vec3f, T: vec3f }
fn scatterSegment(ro: vec3f, rd: vec3f, t0: f32, t1: f32, steps: i32, sunDir: vec3f) -> ScatterOut {
  var o: ScatterOut;
  o.L = vec3f(0.0); o.T = vec3f(1.0);
  let c = dot(rd, sunDir);
  let mp = hgPhase(A.mieG, c);
  let rp = rayleighPhase(c);
  let dt = (t1 - t0) / f32(steps);
  for (var i = 0; i < steps; i++) {
    let t = t0 + (f32(i) + 0.3) * dt;
    let p = ro + rd * t;
    let r = length(p);
    let m = medium(A, r - A.bottomR);
    let sT = exp(-m.ext * dt);
    let up = p / r;
    let sz = dot(up, sunDir);
    let Ts = trans(r, sz);
    let shadow = select(1.0, 0.0, raySphere(p + up * 0.001, sunDir, A.bottomR) > 0.0);
    let S = A.sunIllum * (shadow * Ts * (m.rs * rp + m.ms * mp) + msLookup(r, sz) * (m.rs + m.ms));
    let ext = max(m.ext, vec3f(1e-7));
    o.L += o.T * (S - S * sT) / ext;
    o.T *= sT;
  }
  return o;
}
`;

const SKYVIEW = /* wgsl */`
${ATMO_STRUCT}
@group(0) @binding(0) var<uniform> A: Atmo;
@group(0) @binding(1) var transT: texture_2d<f32>;
@group(0) @binding(2) var msT: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var outS: texture_storage_2d<rgba16float, write>;
${COMMON_SCATTER}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let dims = textureDimensions(outS);
  if (g.x >= dims.x || g.y >= dims.y) { return; }
  let uv = (vec2f(g.xy) + 0.5) / vec2f(dims);
  let vh = A.bottomR + max(A.camAltKm, 0.002);
  let vHor = sqrt(max(vh * vh - A.bottomR * A.bottomR, 0.0));
  let cosBeta = vHor / vh;
  let beta = acos(clamp(cosBeta, -1.0, 1.0));
  let zha = PI_A - beta;
  var vza: f32;
  if (uv.y < 0.5) {
    var k = 2.0 * uv.y; k = 1.0 - k; k = k * k; k = 1.0 - k;
    vza = zha * k;
  } else {
    var k = uv.y * 2.0 - 1.0; k = k * k;
    vza = zha + beta * k;
  }
  let cz = cos(vza);
  var kx = uv.x; kx = kx * kx;
  let lvc = -(kx * 2.0 - 1.0);
  let ro = vec3f(0.0, vh, 0.0);
  let sz = dot(vec3f(0.0, 1.0, 0.0), A.sunDir);
  let sunDir = normalize(vec3f(sqrt(max(0.0, 1.0 - sz * sz)), sz, 0.0));
  let sv = sqrt(max(0.0, 1.0 - cz * cz));
  let rd = vec3f(sv * lvc, cz, sv * sqrt(max(0.0, 1.0 - lvc * lvc)));
  let tB = raySphere(ro, rd, A.bottomR);
  let tT = raySphere(ro, rd, A.topR);
  var tMax = tT;
  if (tB > 0.0) { tMax = tB; }
  tMax = min(max(tMax, 0.0), 9000.0);
  let steps = i32(mix(24.0, 40.0, clamp(tMax / 300.0, 0.0, 1.0)));
  let s = scatterSegment(ro, rd, 0.0, tMax, steps, sunDir);
  textureStore(outS, g.xy, vec4f(s.L, 1.0));
}`;

export const AP_SLICES = 32;
const AERIAL = /* wgsl */`
${ATMO_STRUCT}
@group(0) @binding(0) var<uniform> A: Atmo;
@group(0) @binding(1) var transT: texture_2d<f32>;
@group(0) @binding(2) var msT: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var outAP: texture_storage_3d<rgba16float, write>;
${COMMON_SCATTER}
fn sliceDist(s: f32) -> f32 { let k = s / ${AP_SLICES}.0; return A.apMaxKm * k * k; }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let dims = textureDimensions(outAP);
  if (g.x >= dims.x || g.y >= dims.y) { return; }
  let uv = (vec2f(g.xy) + 0.5) / vec2f(dims.xy);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let wp = A.invViewProj * vec4f(ndc, 0.5, 1.0);
  let rd = normalize(wp.xyz / wp.w - A.camPos * 1000.0);
  let ro = vec3f(0.0, A.bottomR + max(A.camAltKm, 0.001), 0.0);
  let sz = A.sunDir;
  var L = vec3f(0.0);
  var T = vec3f(1.0);
  var t0 = 0.0;
  // planet/top boundaries
  let tB = raySphere(ro, rd, A.bottomR);
  for (var s = 0u; s < ${AP_SLICES}u; s++) {
    var t1 = sliceDist(f32(s) + 1.0);
    if (tB > 0.0) { t1 = min(t1, tB); }
    if (t1 > t0) {
      let seg = scatterSegment(ro, rd, t0, t1, 2, sz);
      L += T * seg.L;
      T *= seg.T;
      t0 = t1;
    }
    textureStore(outAP, vec3u(g.xy, s), vec4f(L, dot(T, vec3f(1.0 / 3.0))));
  }
}`;

// Ambient cube (+X,-X,+Y,-Y,+Z,-Z) irradiance from the sky-view LUT, plus ground bounce for downward faces.
const IRRADIANCE = /* wgsl */`
${ATMO_STRUCT}
@group(0) @binding(0) var<uniform> A: Atmo;
@group(0) @binding(1) var transT: texture_2d<f32>;
@group(0) @binding(2) var skyT: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<storage, read_write> outI: array<vec4f, 8>;
fn trans(vh: f32, cz: f32) -> vec3f { return textureSampleLevel(transT, samp, transUV(A, vh, cz), 0.0).rgb; }
fn skyUV(rd: vec3f, vh: f32) -> vec2f {
  let vHor = sqrt(max(vh * vh - A.bottomR * A.bottomR, 0.0));
  let beta = acos(clamp(vHor / vh, -1.0, 1.0));
  let zha = PI_A - beta;
  let cz = rd.y;
  let vza = acos(clamp(cz, -1.0, 1.0));
  var v: f32;
  if (vza < zha) { var k = vza / zha; k = 1.0 - k; k = sqrt(max(k, 0.0)); k = 1.0 - k; v = k * 0.5; }
  else { var k = (vza - zha) / beta; k = sqrt(clamp(k, 0.0, 1.0)); v = k * 0.5 + 0.5; }
  let side = cross(vec3f(0.0, 1.0, 0.0), rd);
  var lvc = 1.0;
  if (dot(side, side) > 1e-8) {
    let sn = normalize(side);
    let fw = normalize(cross(sn, vec3f(0.0, 1.0, 0.0)));
    let lp = vec2f(dot(A.sunDir, fw), dot(A.sunDir, sn));
    if (dot(lp, lp) > 1e-8) { lvc = normalize(lp).x; }
  }
  return vec2f(sqrt(clamp(-lvc * 0.5 + 0.5, 0.0, 1.0)), v);
}
var<workgroup> acc: array<vec3f, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u) {
  let face = wg.x;
  var n = vec3f(0.0);
  switch face {
    case 0u: { n = vec3f(1.0, 0.0, 0.0); } case 1u: { n = vec3f(-1.0, 0.0, 0.0); }
    case 2u: { n = vec3f(0.0, 1.0, 0.0); } case 3u: { n = vec3f(0.0, -1.0, 0.0); }
    case 4u: { n = vec3f(0.0, 0.0, 1.0); } default: { n = vec3f(0.0, 0.0, -1.0); }
  }
  let vh = A.bottomR + max(A.baseAltKm, 0.002);
  let Tsun = trans(vh, A.sunDir.y);
  let sunGround = A.sunIllum * Tsun * max(A.sunDir.y, 0.0);
  var sum = vec3f(0.0);
  for (var k = 0u; k < 16u; k++) {
    let idx = li * 16u + k; // 1024 samples
    let u1 = (f32(idx % 32u) + 0.5) / 32.0;
    let u2 = (f32(idx / 32u) + 0.5) / 32.0;
    let cz = 1.0 - 2.0 * u2;
    let ph = u1 * 6.2831853;
    let s = sqrt(max(0.0, 1.0 - cz * cz));
    let d = vec3f(s * cos(ph), cz, s * sin(ph));
    let w = max(dot(d, n), 0.0);
    if (w > 0.0) {
      var L: vec3f;
      if (d.y >= 0.0) { L = textureSampleLevel(skyT, samp, skyUV(d, vh), 0.0).rgb; }
      else { L = A.groundAlbedo * (sunGround + vec3f(0.0)) / PI_A + textureSampleLevel(skyT, samp, skyUV(vec3f(d.x, 0.02, d.z), vh), 0.0).rgb * A.groundAlbedo; }
      sum += L * w;
    }
  }
  acc[li] = sum;
  workgroupBarrier();
  if (li == 0u) {
    var t = vec3f(0.0);
    for (var i = 0u; i < 64u; i++) { t += acc[i]; }
    // ∫ L cos dω ≈ 4π/N Σ
    outI[face] = vec4f(t * (4.0 * PI_A / 1024.0), 1.0);
    if (face == 0u) { outI[6] = vec4f(A.sunIllum * Tsun, 1.0); outI[7] = vec4f(A.sunDir.y, 0.0, 0.0, 0.0); }
  }
}`;

export const SKY_DEFAULTS = {
  sunAzimuth: 128, sunElevation: 24, sunIntensity: 1.0, sunSize: 0.53, sunTint: '#fff4e8',
  airDensity: 1.0, haze: 1.6, hazeAnisotropy: 0.78, ozone: true, baseAltitude: 400,
  fogDensity: 0.0, fogHeight: 220, fogColor: '#c7d2dc',
  exposure: 0.0, autoExposure: true, tonemap: 'agx', bloom: 0.04, contrast: 1.06, saturation: 1.04,
  vignette: 0.18, grain: 0.0,
};

export class Atmosphere {
  constructor(gpu) {
    this.gpu = gpu;
    const dev = gpu.device;
    this.ubo = gpu.uniform(256, 'atmo-ubo');
    this.transT = dev.createTexture({ size: [256, 64], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, label: 'atmo-transmittance' });
    this.msT = dev.createTexture({ size: [32, 32], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, label: 'atmo-multiscat' });
    this.skyT = dev.createTexture({ size: [192, 108], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, label: 'atmo-skyview' });
    this.apT = dev.createTexture({ size: [32, 32, AP_SLICES], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, label: 'atmo-aerial' });
    this.irr = gpu.buffer(8 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'atmo-irradiance');
    this.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.ready = false;
    this.lutKey = '';
    this.sunDir = [0.5, 0.5, 0.5];
    this.sunColorLin = [1, 1, 1];
  }
  async init() {
    const g = this.gpu;
    [this.pT, this.pM, this.pS, this.pA, this.pI] = await Promise.all([
      g.compute(TRANSMITTANCE, 'atmo-trans'), g.compute(MULTISCAT, 'atmo-ms'), g.compute(SKYVIEW, 'atmo-sky'),
      g.compute(AERIAL, 'atmo-ap'), g.compute(IRRADIANCE, 'atmo-irr'),
    ]);
    this.ready = true;
  }
  static sunDirection(sky) {
    const az = sky.sunAzimuth * Math.PI / 180, el = sky.sunElevation * Math.PI / 180;
    // azimuth 0 = north (-Z), 90 = east (+X)
    return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  }
  pack(sky, cam, invViewProj, apMaxKm) {
    const f = new Float32Array(64);
    const haze = sky.haze, air = sky.airDensity;
    const sun = Atmosphere.sunDirection(sky);
    this.sunDir = sun;
    const tint = hexToLinear(sky.sunTint || '#ffffff');
    this.sunColorLin = tint;
    f[0] = 6360; f[1] = 6460; f[2] = 8; f[3] = 1.2;
    f[4] = 5.802e-3 * air; f[5] = 13.558e-3 * air; f[6] = 33.1e-3 * air; f[7] = sky.hazeAnisotropy;
    f[8] = 3.996e-3 * haze; f[9] = 3.996e-3 * haze; f[10] = 3.996e-3 * haze; f[11] = sky.sunSize * 0.5 * Math.PI / 180;
    f[12] = 4.40e-3 * haze; f[13] = 4.40e-3 * haze; f[14] = 4.40e-3 * haze;
    f[15] = Math.max(0.002, (cam.pos[1] + sky.baseAltitude) / 1000);
    const oz = sky.ozone ? 1 : 0;
    f[16] = 0.650e-3 * oz; f[17] = 1.881e-3 * oz; f[18] = 0.085e-3 * oz; f[19] = sky.baseAltitude / 1000;
    f[20] = 0.25; f[21] = 0.24; f[22] = 0.2; f[23] = apMaxKm;
    f[24] = sun[0]; f[25] = sun[1]; f[26] = sun[2]; f[27] = sky.sunIntensity;
    f[28] = tint[0]; f[29] = tint[1]; f[30] = tint[2]; f[31] = sky.fogDensity;
    const fc = hexToLinear(sky.fogColor || '#c7d2dc');
    f[32] = fc[0]; f[33] = fc[1]; f[34] = fc[2]; f[35] = sky.fogHeight;
    f.set(invViewProj, 36);
    f[52] = cam.pos[0] / 1000; f[53] = cam.pos[1] / 1000; f[54] = cam.pos[2] / 1000; f[55] = 0;
    return f;
  }
  // Recomputes LUTs when atmosphere parameters change; sky-view + aerial perspective each frame the camera moves.
  update(enc, sky, cam, invViewProj, apMaxKm) {
    if (!this.ready) return;
    const g = this.gpu;
    // AP marches in km from the camera at origin: provide invViewProj in km-scaled camera-relative space
    const data = this.pack(sky, cam, invViewProj, apMaxKm);
    g.write(this.ubo, data);
    const key = [sky.airDensity, sky.haze, sky.hazeAnisotropy, sky.ozone].join('|');
    const pass = enc.beginComputePass({ label: 'atmosphere' });
    const tv = this.transT.createView(), mv = this.msT.createView(), sv = this.skyT.createView();
    if (key !== this.lutKey) {
      pass.setPipeline(this.pT); pass.setBindGroup(0, g.bind(this.pT, [this.ubo, tv])); pass.dispatchWorkgroups(32, 8);
      pass.setPipeline(this.pM); pass.setBindGroup(0, g.bind(this.pM, [this.ubo, tv, this.samp, mv])); pass.dispatchWorkgroups(4, 4);
      this.lutKey = key;
    }
    pass.setPipeline(this.pS); pass.setBindGroup(0, g.bind(this.pS, [this.ubo, tv, mv, this.samp, sv])); pass.dispatchWorkgroups(24, 14);
    pass.setPipeline(this.pA); pass.setBindGroup(0, g.bind(this.pA, [this.ubo, tv, mv, this.samp, this.apT.createView({ dimension: '3d' })])); pass.dispatchWorkgroups(4, 4);
    pass.setPipeline(this.pI); pass.setBindGroup(0, g.bind(this.pI, [this.ubo, tv, sv, this.samp, this.irr])); pass.dispatchWorkgroups(6);
    pass.end();
  }
}

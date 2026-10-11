// Tileable procedural micro-relief used for close-range shading and displacement.
//   detH   rgba16float  heights 0..1: rock, ground, vegetation, snow
//   detG1  rgba16float  d/du, d/dv of rock and ground (height units per texel at mip 0)
//   detG2  rgba16float  d/du, d/dv of vegetation and snow
import { wg } from '../core/gpu.js';

export const DETAIL_SIZE = 1024;

const GEN = /* wgsl */`
@group(0) @binding(0) var outH: texture_storage_2d<rgba16float, write>;
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn h2(i: vec2i, per: i32, seed: u32) -> u32 {
  let w = ((i % vec2i(per)) + vec2i(per)) % vec2i(per);
  return pcg(u32(w.x) * 1973u + pcg(u32(w.y) * 9277u + seed));
}
fn rnd(i: vec2i, per: i32, seed: u32) -> f32 { return f32(h2(i, per, seed)) * (1.0 / 4294967296.0); }
fn grad(i: vec2i, per: i32, seed: u32) -> vec2f { let a = rnd(i, per, seed) * 6.2831853; return vec2f(cos(a), sin(a)); }
fn pnoise(p: vec2f, per: i32, seed: u32) -> f32 {
  let i = vec2i(floor(p)); let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(grad(i, per, seed), f);
  let b = dot(grad(i + vec2i(1, 0), per, seed), f - vec2f(1.0, 0.0));
  let c = dot(grad(i + vec2i(0, 1), per, seed), f - vec2f(0.0, 1.0));
  let d = dot(grad(i + vec2i(1, 1), per, seed), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}
fn pfbm(p: vec2f, per: i32, oct: i32, gain: f32, seed: u32) -> f32 {
  var s = 0.0; var a = 0.5; var q = p; var pr = per; var n = 0.0;
  for (var i = 0; i < oct; i++) { s += a * pnoise(q, pr, seed + u32(i) * 31u); n += a; a *= gain; q *= 2.0; pr *= 2; }
  return s / n;
}
struct Vor { f1: f32, f2: f32, id: vec2i, c: vec2f }
fn pvor(p: vec2f, per: i32, seed: u32, jit: f32) -> Vor {
  let i = vec2i(floor(p)); let f = p - floor(p);
  var o: Vor; o.f1 = 9.0; o.f2 = 9.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = i + vec2i(x, y);
      let r = vec2f(rnd(c, per, seed), rnd(c, per, seed + 77u));
      let pt = vec2f(f32(x), f32(y)) + 0.5 + (r - 0.5) * jit;
      let d = length(pt - f);
      if (d < o.f1) { o.f2 = o.f1; o.f1 = d; o.id = ((c % vec2i(per)) + vec2i(per)) % vec2i(per); o.c = pt - f; }
      else if (d < o.f2) { o.f2 = d; }
    }
  }
  return o;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let S = ${DETAIL_SIZE}u;
  if (g.x >= S || g.y >= S) { return; }
  let uv = (vec2f(g.xy) + 0.5) / f32(S);
  // ROCK: faceted plates separated by cracks, with fine grain
  let pr = uv * 6.0;
  let wq = pr + vec2f(pfbm(uv * 4.0, 4, 3, 0.5, 11u), pfbm(uv * 4.0 + 7.3, 4, 3, 0.5, 12u)) * 0.45;
  let v = pvor(wq, 6, 101u, 0.9);
  let cid = vec2i(v.id);
  let tilt = (vec2f(rnd(cid, 6, 5u), rnd(cid, 6, 6u)) - 0.5) * 1.4;
  let plate = 0.55 + dot(-v.c, tilt) * 0.5 + (rnd(cid, 6, 9u) - 0.5) * 0.35;
  let crack = smoothstep(0.0, 0.16, v.f2 - v.f1);
  let v2 = pvor(uv * 22.0, 22, 202u, 0.95);
  let crack2 = smoothstep(0.0, 0.12, v2.f2 - v2.f1);
  let grain = pfbm(uv * 64.0, 64, 4, 0.55, 33u);
  var rock = plate * mix(0.25, 1.0, crack) * mix(0.75, 1.0, crack2) + grain * 0.07 + pfbm(uv * 8.0, 8, 4, 0.5, 44u) * 0.18;
  // GROUND: pebbles over soil
  let pv = pvor(uv * 48.0, 48, 303u, 0.85);
  let pid = vec2i(pv.id);
  let psz = 0.28 + 0.3 * rnd(pid, 48, 7u);
  let pebble = sqrt(max(0.0, 1.0 - (pv.f1 / psz) * (pv.f1 / psz))) * step(0.45, rnd(pid, 48, 8u));
  let pv2 = pvor(uv * 160.0, 160, 404u, 0.9);
  let grit = sqrt(max(0.0, 1.0 - pv2.f1 * pv2.f1 * 8.0));
  let soil = pfbm(uv * 12.0, 12, 5, 0.55, 55u);
  let ground = 0.35 + soil * 0.25 + pebble * 0.45 + grit * 0.08;
  // VEGETATION: grass tufts in clumps
  let clump = pfbm(uv * 10.0, 10, 3, 0.5, 66u) * 0.5 + 0.5;
  let tv = pvor(uv * 120.0, 120, 505u, 1.0);
  let tuft = pow(max(0.0, 1.0 - tv.f1 * 1.6), 1.5);
  let blades = pfbm(uv * 256.0, 256, 2, 0.5, 77u) * 0.5 + 0.5;
  let veg = clamp(0.25 + clump * 0.35 + tuft * 0.45 * (0.6 + 0.4 * clump) + blades * 0.12 - 0.12, 0.0, 1.0);
  // SNOW: soft drifts and wind ripples
  let drift = pfbm(uv * 3.0, 3, 4, 0.45, 88u);
  let rw = uv * vec2f(1.0, 1.0) + vec2f(pfbm(uv * 5.0, 5, 3, 0.5, 99u) * 0.06, 0.0);
  let ripple = sin((rw.x * 0.35 + rw.y) * 6.2831853 * 40.0 + pfbm(uv * 20.0, 20, 2, 0.5, 98u) * 3.0) * 0.5 + 0.5;
  let snow = 0.5 + drift * 0.35 + ripple * 0.06 + pfbm(uv * 30.0, 30, 3, 0.5, 97u) * 0.05;
  textureStore(outH, g.xy, vec4f(clamp(rock, 0.0, 1.0), clamp(ground, 0.0, 1.0), veg, clamp(snow, 0.0, 1.0)));
}`;

const GRAD = /* wgsl */`
@group(0) @binding(0) var inH: texture_2d<f32>;
@group(0) @binding(1) var outG1: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var outG2: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let S = i32(textureDimensions(inH).x);
  if (i32(g.x) >= S || i32(g.y) >= S) { return; }
  let p = vec2i(g.xy);
  let l = textureLoad(inH, (p + vec2i(-1, 0) + S) % S, 0);
  let r = textureLoad(inH, (p + vec2i(1, 0)) % S, 0);
  let d = textureLoad(inH, (p + vec2i(0, -1) + S) % S, 0);
  let u = textureLoad(inH, (p + vec2i(0, 1)) % S, 0);
  let dx = (r - l) * 0.5; let dy = (u - d) * 0.5;
  textureStore(outG1, g.xy, vec4f(dx.x, dy.x, dx.y, dy.y));
  textureStore(outG2, g.xy, vec4f(dx.z, dy.z, dx.w, dy.w));
}`;

const DOWN = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> scale: vec4f;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(dst);
  if (g.x >= d.x || g.y >= d.y) { return; }
  let p = vec2i(g.xy) * 2;
  let s = textureLoad(src, p, 0) + textureLoad(src, p + vec2i(1, 0), 0) + textureLoad(src, p + vec2i(0, 1), 0) + textureLoad(src, p + vec2i(1, 1), 0);
  // gradients stay in mip-0 texel units, so plain averaging is the correct filter
  textureStore(dst, g.xy, s * 0.25 * scale);
}`;

export class DetailMaps {
  constructor(gpu) { this.gpu = gpu; }
  async init() {
    const g = this.gpu, dev = g.device;
    const S = DETAIL_SIZE;
    const mips = Math.log2(S) + 1;
    const mk = (label) => dev.createTexture({ size: [S, S], format: 'rgba16float', mipLevelCount: mips, label,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    this.H = mk('detail-h'); this.G1 = mk('detail-g1'); this.G2 = mk('detail-g2');
    const [pGen, pGrad, pDown] = await Promise.all([g.compute(GEN, 'detail-gen'), g.compute(GRAD, 'detail-grad'), g.compute(DOWN, 'detail-down')]);
    const one = g.uniform(16); g.write(one, new Float32Array([1, 1, 1, 1]));
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    const v = (t, m) => t.createView({ baseMipLevel: m, mipLevelCount: 1 });
    pass.setPipeline(pGen); pass.setBindGroup(0, g.bind(pGen, [v(this.H, 0)])); pass.dispatchWorkgroups(wg(S), wg(S));
    pass.setPipeline(pGrad); pass.setBindGroup(0, g.bind(pGrad, [v(this.H, 0), v(this.G1, 0), v(this.G2, 0)])); pass.dispatchWorkgroups(wg(S), wg(S));
    pass.setPipeline(pDown);
    for (let m = 1; m < mips; m++) {
      const s = Math.max(1, S >> m);
      pass.setBindGroup(0, g.bind(pDown, [v(this.H, m - 1), v(this.H, m), one])); pass.dispatchWorkgroups(wg(s), wg(s));
      pass.setBindGroup(0, g.bind(pDown, [v(this.G1, m - 1), v(this.G1, m), one])); pass.dispatchWorkgroups(wg(s), wg(s));
      pass.setBindGroup(0, g.bind(pDown, [v(this.G2, m - 1), v(this.G2, m), one])); pass.dispatchWorkgroups(wg(s), wg(s));
    }
    pass.end();
    dev.queue.submit([enc.finish()]);
    await g.idle();
    one.destroy();
  }
}

// Texture compositor: evaluates the material layer stack over the derived terrain maps in one compute pass.
// Outputs (N×N):
//   albedo  rgba16float  linear albedo rgb + roughness
//   detail  rgba8unorm   detail weights: rock, ground, vegetation, snow
//   surf    rgba8unorm   r wetness, g detail strength, b selected-layer mask, a forest canopy
import { NOISE_WGSL } from '../wgsl/noise.js';
import { RULES } from './layer-types.js';
import { hexToLinear, clamp } from '../core/math.js';
import { wg } from '../core/gpu.js';

export const MAX_TEX_LAYERS = 32;
export const TEX_THUMB = 96;
const VEC4_PER_LAYER = 20;

const COMMON = /* wgsl */`
${NOISE_WGSL}
struct TC {
  N: u32, count: u32, selected: i32, T: u32,
  world: f32, hscale: f32, hmin: f32, hmax: f32,
  cell: f32, pad0: f32, pad1: f32, pad2: f32,
}
struct TL {
  colA: vec4f, colB: vec4f, v0: vec4f, v1: vec4f, st: vec4f, stC: vec4f,
  rules: array<vec4f, 12>,
  flags: vec4f, extra: vec4f,
}
@group(0) @binding(0) var<uniform> C: TC;
@group(0) @binding(1) var<uniform> L: array<TL, ${MAX_TEX_LAYERS}>;
@group(0) @binding(2) var heightT: texture_2d<f32>;
@group(0) @binding(3) var normalT: texture_2d<f32>;
@group(0) @binding(4) var attrA: texture_2d<f32>;
@group(0) @binding(5) var attrB: texture_2d<f32>;
@group(0) @binding(6) var waterT: texture_2d<f32>;

struct Attr { hrel: f32, hm: f32, slope: f32, curv: f32, flow: f32, wear: f32, dep: f32, talus: f32, snow: f32, shore: f32, aspect: f32, occl: f32, pos: vec2f, n: vec3f }

fn fetchAttr(t: vec2i) -> Attr {
  var a: Attr;
  let h = textureLoad(heightT, t, 0).r;
  let nr = textureLoad(normalT, t, 0);
  let A = textureLoad(attrA, t, 0);
  let B = textureLoad(attrB, t, 0);
  let wl = textureLoad(waterT, t, 0).r;
  a.hm = h * C.hscale;
  a.hrel = clamp((h - C.hmin) / max(C.hmax - C.hmin, 1e-6), 0.0, 1.0);
  a.n = normalize(nr.xyz);
  a.slope = degrees(acos(clamp(a.n.y, -1.0, 1.0)));
  a.curv = B.w + 0.35 * B.z;
  a.flow = A.x;
  a.wear = 1.0 - exp(-A.y / 10.0);
  a.dep = 1.0 - exp(-A.z / 4.0);
  a.talus = 1.0 - exp(-A.w / 2.5);
  a.snow = 1.0 - exp(-B.x / 0.35);
  a.shore = (wl - h) * C.hscale;
  // aspect: bearing of the downslope direction, 0 = north (-z), 90 = east (+x)
  a.aspect = degrees(atan2(a.n.x, -a.n.z));
  a.occl = 1.0 - nr.w;
  let uv = (vec2f(t) + 0.5) / f32(C.N);
  a.pos = (uv - 0.5) * C.world;
  return a;
}

fn band(v: f32, r: vec4f) -> f32 {
  if (r.x < 0.5) { return 1.0; }
  let f = max(r.w, 1e-4);
  return sstep(r.y - f, r.y + f, v) * (1.0 - sstep(r.z - f, r.z + f, v));
}
fn angDiff(a: f32, b: f32) -> f32 { let d = abs(a - b) % 360.0; return min(d, 360.0 - d); }

fn layerMask(l: TL, a: Attr, li: u32) -> f32 {
  let sd = u32(l.flags.z);
  var m = 1.0;
  m *= band(a.hrel, l.rules[0]);
  m *= band(a.slope, l.rules[1]);
  m *= band(a.curv, l.rules[2]);
  m *= band(a.flow, l.rules[3]);
  m *= band(a.wear, l.rules[4]);
  m *= band(a.dep, l.rules[5]);
  m *= band(a.talus, l.rules[6]);
  m *= band(a.snow, l.rules[7]);
  m *= band(a.shore, l.rules[8]);
  let ar = l.rules[9];
  if (ar.x > 0.5) {
    let d = angDiff(a.aspect, ar.y);
    let am = 1.0 - sstep(ar.z - ar.w, ar.z + ar.w, d);
    m *= mix(0.5, am, sstep(2.0, 9.0, a.slope));
  }
  m *= band(a.occl, l.rules[10]);
  let nr = l.rules[11];
  if (nr.x > 0.5) {
    let n = fbm(a.pos / max(nr.y, 0.5), 5, 2.0, 0.5, sd + 101u) * 0.5 + 0.5;
    m *= clamp((n - nr.z) * nr.w + 0.5, 0.0, 1.0);
  }
  if (l.flags.x > 0.5) { m = 1.0 - m; }
  // coverage & edge breakup
  let cov = l.v1.y;
  let sharp = max(l.v1.z, 0.05);
  var e = 0.0;
  if (l.v1.w > 0.0) { e = fbm(a.pos / max(l.extra.x, 0.5), 4, 2.0, 0.55, sd + 211u); }
  let t = 1.0 - cov;
  let w = 0.5 / sharp;
  return sstep(t - w, t + w, m + e * l.v1.w * 0.5) * sstep(0.0, 0.05, m);
}

fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn overlayC(a: vec3f, b: vec3f) -> vec3f {
  let lo = 2.0 * a * b;
  let hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
  return select(hi, lo, a < vec3f(0.5));
}

struct LayerColor { col: vec3f, line: f32 }
fn layerColor(l: TL, a: Attr) -> LayerColor {
  let sd = u32(l.flags.z);
  let vs = max(l.v1.x, 0.5);
  let vn = fbm(a.pos / vs, 5, 2.0, 0.5, sd + 7u) * 0.5 + 0.5;
  let va = l.colB.w;
  let tt = sstep(1.0 - va - 0.18, 1.0 - va + 0.18, vn);
  var col = mix(l.colA.rgb, l.colB.rgb, tt);
  // fine value jitter (8%)
  col *= 1.0 + 0.08 * gnoise(a.pos / (vs * 0.13), sd + 13u);
  var o: LayerColor;
  o.line = 0.0;
  if (l.st.x > 0.5) {
    let wn = fbm(a.pos / 260.0, 3, 2.0, 0.5, sd + 31u) * l.st.w * l.st.y * 1.6;
    let y = a.hm + wn + a.pos.x * l.stC.w;
    let b = y / max(l.st.y, 0.1);
    let id = floor(b);
    let f = b - id;
    let r = hash1(u32(i32(id) + 100000) * 747796405u + sd);
    let r2 = hash1(u32(i32(id) + 100000) * 2891336453u + sd);
    let bandC = mix(col, l.stC.rgb, r * l.st.z * 1.6);
    let lift = 1.0 + (r2 - 0.5) * l.st.z * 0.6;
    col = clamp(bandC * lift, vec3f(0.0), vec3f(1.0));
    o.line = (1.0 - sstep(0.0, 0.08, f)) * l.st.z;
  }
  o.col = col;
  return o;
}

struct Comp { alb: vec3f, rough: f32, det: vec4f, wet: f32, dstr: f32, sel: f32, canopy: f32 }
fn composite(a: Attr) -> Comp {
  var c: Comp;
  c.alb = vec3f(0.18, 0.16, 0.14); c.rough = 0.85; c.det = vec4f(0.0, 1.0, 0.0, 0.0); c.wet = 0.0; c.dstr = 0.8; c.sel = 0.0; c.canopy = 0.0;
  for (var i = 0u; i < C.count; i++) {
    let l = L[i];
    let m = layerMask(l, a, i);
    let al = m * l.v0.x;
    if (i32(i) == C.selected) { c.sel = m; }
    if (al <= 0.0001) { continue; }
    let mode = u32(l.v0.y);
    if (mode == 4u) { c.wet = max(c.wet, al * l.extra.y); continue; }
    let lc = layerColor(l, a);
    if (mode == 0u) {
      c.alb = mix(c.alb, lc.col * (1.0 - lc.line * 0.35), al);
      c.rough = mix(c.rough, l.colA.w, al);
      var dv = vec4f(0.0);
      let dt = u32(l.v0.z);
      if (dt == 0u) { dv.x = 1.0; } else if (dt == 1u) { dv.y = 1.0; } else if (dt == 2u || dt == 4u) { dv.z = 1.0; } else { dv.w = 1.0; }
      c.det = mix(c.det, dv, al);
      c.dstr = mix(c.dstr, l.v0.w, al);
      c.canopy = mix(c.canopy, select(0.0, 1.0, dt == 4u), al);
    } else if (mode == 1u) {
      c.alb = mix(c.alb, c.alb * lc.col, al);
    } else if (mode == 2u) {
      c.alb = mix(c.alb, overlayC(c.alb, lc.col), al);
    } else {
      c.alb = mix(c.alb, lc.col * (lum(c.alb) / max(lum(lc.col), 0.01)), al);
    }
  }
  return c;
}
`;

const MAIN = /* wgsl */`
${COMMON}
@group(0) @binding(7) var outAlb: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var outDet: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(9) var outSurf: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= C.N || g.y >= C.N) { return; }
  let a = fetchAttr(vec2i(g.xy));
  let c = composite(a);
  let ds = max(dot(c.det, vec4f(1.0)), 1e-4);
  textureStore(outAlb, g.xy, vec4f(clamp(c.alb, vec3f(0.0), vec3f(1.0)), clamp(c.rough, 0.03, 1.0)));
  textureStore(outDet, g.xy, c.det / ds);
  textureStore(outSurf, g.xy, vec4f(clamp(c.wet, 0.0, 1.0), clamp(c.dstr / 1.5, 0.0, 1.0), c.sel, c.canopy));
}`;

const THUMBS = /* wgsl */`
${COMMON}
@group(0) @binding(7) var<storage, read_write> thumbs: array<f32>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= C.T || g.y >= C.T || g.z >= C.count) { return; }
  let t = vec2i(((vec2f(g.xy) + 0.5) / f32(C.T)) * f32(C.N));
  let a = fetchAttr(t);
  thumbs[g.z * C.T * C.T + g.y * C.T + g.x] = layerMask(L[g.z], a, g.z) * L[g.z].v0.x;
}`;

function seedOf(id) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 65536; }

export class TextureCompositor {
  constructor(gpu) {
    this.gpu = gpu;
    this.N = 0;
    this.tex = null;
    this.ubo = gpu.uniform(MAX_TEX_LAYERS * VEC4_PER_LAYER * 16, 'tex-layers');
    this.cubo = gpu.uniform(48, 'tex-common');
    this.version = 0;
  }
  async init() {
    [this.pMain, this.pThumb] = await Promise.all([this.gpu.compute(MAIN, 'tex-composite'), this.gpu.compute(THUMBS, 'tex-thumbs')]);
  }
  ensure(N) {
    if (this.N === N && this.tex) return;
    if (this.tex) Object.values(this.tex).forEach(t => t.destroy());
    const d = this.gpu.device;
    const mk = (format, label) => d.createTexture({ size: [N, N], format, label, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    this.tex = { albedo: mk('rgba16float', 'albedoTex'), detail: mk('rgba8unorm', 'detailTex'), surf: mk('rgba8unorm', 'surfTex') };
    this.N = N;
  }
  pack(layers) {
    const f = new Float32Array(MAX_TEX_LAYERS * VEC4_PER_LAYER * 4);
    const active = layers.filter(l => l.enabled).slice(0, MAX_TEX_LAYERS);
    active.forEach((l, i) => {
      const o = i * VEC4_PER_LAYER * 4;
      const p = l.params;
      const ca = hexToLinear(p.colorA), cb = hexToLinear(p.colorB), sc = hexToLinear(p.strataColor || '#555555');
      f.set([ca[0], ca[1], ca[2], p.roughness], o);
      f.set([cb[0], cb[1], cb[2], p.variation], o + 4);
      f.set([l.blend.opacity, l.blend.mode, p.detail, p.detailStrength], o + 8);
      f.set([p.varScale, p.coverage, p.sharpness, p.edge], o + 12);
      f.set([p.strataOn ? 1 : 0, p.strataSpacing, p.strataContrast, p.strataWarp], o + 16);
      f.set([sc[0], sc[1], sc[2], p.strataTilt], o + 20);
      RULES.forEach((r, k) => {
        const v = p.rules[r.key] || {};
        let vec;
        if (r.special === 'aspect') vec = [v.on ? 1 : 0, v.dir ?? 0, v.spread ?? 60, Math.max(1, v.fall ?? 20)];
        else if (r.special === 'noise') vec = [v.on ? 1 : 0, v.scale ?? 100, v.threshold ?? 0.5, v.contrast ?? 2];
        else {
          const lo = (v.lo ?? r.min) <= r.min + 1e-6 ? -1e9 : v.lo;
          const hi = (v.hi ?? r.max) >= r.max - 1e-6 ? 1e9 : v.hi;
          vec = [v.on ? 1 : 0, lo, hi, Math.max(1e-4, v.fall ?? 0)];
        }
        f.set(vec, o + 24 + k * 4);
      });
      f.set([l.blend.invert ? 1 : 0, 0, seedOf(l.id), 0], o + 72);
      f.set([p.edgeScale, p.wetness ?? 0.6, 0, 0], o + 76);
    });
    return { data: f, active };
  }
  writeCommon(count, selectedIdx, derived, T = 0) {
    const ab = new ArrayBuffer(48), u = new Uint32Array(ab), i = new Int32Array(ab), f = new Float32Array(ab);
    u[0] = derived.N; u[1] = count; i[2] = selectedIdx; u[3] = T;
    f[4] = derived.world.size; f[5] = derived.world.height; f[6] = derived.stats?.min ?? 0; f[7] = derived.stats?.max ?? 1;
    f[8] = derived.world.size / derived.N;
    this.gpu.write(this.cubo, f);
  }
  textures(derived) {
    const t = derived.tex;
    return [t.height.createView(), t.normal.createView(), t.attrA.createView(), t.attrB.createView(), t.water.createView()];
  }
  // Composite the full-resolution maps. selectedId: texture layer whose mask is written to surf.b.
  run(layers, derived, selectedId) {
    if (!derived?.tex || !this.pMain) return;
    this.ensure(derived.N);
    const { data, active } = this.pack(layers);
    this.gpu.write(this.ubo, data);
    const sel = active.findIndex(l => l.id === selectedId);
    this.writeCommon(active.length, sel, derived);
    const enc = this.gpu.device.createCommandEncoder({ label: 'texture-composite' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pMain);
    pass.setBindGroup(0, this.gpu.bind(this.pMain, [this.cubo, this.ubo, ...this.textures(derived),
      this.tex.albedo.createView(), this.tex.detail.createView(), this.tex.surf.createView()]));
    pass.dispatchWorkgroups(wg(derived.N), wg(derived.N));
    pass.end();
    this.gpu.device.queue.submit([enc.finish()]);
    this.version++;
  }
  // Returns { layerId: Float32Array(T²) } mask previews.
  async thumbnails(layers, derived) {
    if (!derived?.tex || !this.pThumb) return {};
    const { data, active } = this.pack(layers);
    if (!active.length) return {};
    const T = TEX_THUMB;
    const g = this.gpu;
    const ubo = g.uniform(MAX_TEX_LAYERS * VEC4_PER_LAYER * 16);
    g.write(ubo, data);
    const cubo = g.uniform(48);
    {
      const ab = new ArrayBuffer(48), u = new Uint32Array(ab), i = new Int32Array(ab), f = new Float32Array(ab);
      u[0] = derived.N; u[1] = active.length; i[2] = -1; u[3] = T;
      f[4] = derived.world.size; f[5] = derived.world.height; f[6] = derived.stats?.min ?? 0; f[7] = derived.stats?.max ?? 1; f[8] = derived.world.size / derived.N;
      g.write(cubo, f);
    }
    const buf = g.storage(T * T * active.length * 4, 'tex-thumbs');
    const enc = g.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pThumb);
    pass.setBindGroup(0, g.bind(this.pThumb, [cubo, ubo, ...this.textures(derived), buf]));
    pass.dispatchWorkgroups(wg(T), wg(T), active.length);
    pass.end();
    g.device.queue.submit([enc.finish()]);
    const raw = new Float32Array(await g.read(buf, T * T * active.length * 4));
    buf.destroy(); ubo.destroy(); cubo.destroy();
    const out = {};
    active.forEach((l, k) => { out[l.id] = raw.subarray(k * T * T, (k + 1) * T * T); });
    return out;
  }
}

export { clamp };

// RoadForge — procedural texture baking.
//
// Each surface slot is rendered by evaluating its authoring layer stack in a
// compute pass (albedo + height + roughness + AO), then a second pass turns
// the height field into a tangent-space normal map with a cavity term.
// Everything is tileable: all noise is evaluated on wrapped lattices.

export const BAKE_WGSL = /* wgsl */`
struct Layer {
  head : vec4<f32>,   // type, blend, opacity, stackScale
  pa   : vec4<f32>,
  pb   : vec4<f32>,
  col  : vec4<f32>,
};

struct Cfg { count: f32, slot: f32, size: f32, seed: f32 };

@group(0) @binding(0) var<uniform> U : Cfg;
@group(0) @binding(1) var<storage, read> layers : array<Layer>;
@group(0) @binding(2) var outAlbedo : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var outData   : texture_storage_2d_array<rgba16float, write>;

const PI : f32 = 3.14159265359;

fn wrap(p: vec2<f32>, per: f32) -> vec2<f32> {
  return p - floor(p / per) * per;
}
fn h21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031 + U.seed * 0.017);
  p3 = p3 + dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn h22(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(h21(p), h21(p + vec2<f32>(37.1, 11.7)));
}
fn pnoise(p: vec2<f32>, per: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = h21(wrap(i, per));
  let b = h21(wrap(i + vec2<f32>(1.0, 0.0), per));
  let c = h21(wrap(i + vec2<f32>(0.0, 1.0), per));
  let d = h21(wrap(i + vec2<f32>(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn pfbm(p: vec2<f32>, per: f32, oct: i32) -> f32 {
  var v = 0.0; var amp = 0.5; var fq = 1.0; var norm = 0.0;
  for (var i = 0; i < oct; i = i + 1) {
    v = v + amp * pnoise(p * fq, per * fq);
    norm = norm + amp;
    fq = fq * 2.0; amp = amp * 0.5;
  }
  return v / max(norm, 1e-5);
}
// returns: x = dist to cell centre, y = cell random, z = edge distance, w = cell id hash
fn voronoi(p: vec2<f32>, per: f32, jitter: f32) -> vec4<f32> {
  let n = floor(p);
  let f = p - n;
  var md = 8.0; var mr = vec2<f32>(0.0); var mid = vec2<f32>(0.0);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let id = wrap(n + g, per);
      let o = h22(id) * jitter + (1.0 - jitter) * 0.5;
      let r = g + o - f;
      let d = dot(r, r);
      if (d < md) { md = d; mr = r; mid = id; }
    }
  }
  var edge = 8.0;
  for (var j = -2; j <= 2; j = j + 1) {
    for (var i = -2; i <= 2; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let id = wrap(n + g, per);
      let o = h22(id) * jitter + (1.0 - jitter) * 0.5;
      let r = g + o - f;
      let dif = r - mr;
      if (dot(dif, dif) > 1e-5) {
        edge = min(edge, dot(0.5 * (mr + r), normalize(dif)));
      }
    }
  }
  return vec4<f32>(sqrt(md), h21(mid), edge, h21(mid + vec2<f32>(5.3, 9.1)));
}

// Paving bonds. Returns (localU, localV, tileRandom, jointDistance)
fn bond(uv: vec2<f32>, mode: i32, cells: f32) -> vec4<f32> {
  var p = uv * cells;
  if (mode == 0) {                       // running bond (2:1)
    let row = floor(p.y);
    let off = select(0.0, 0.5, (row - floor(row / 2.0) * 2.0) > 0.5);
    let x = p.x * 0.5 + off;
    let cid = vec2<f32>(floor(x), row);
    let f = vec2<f32>(fract(x), fract(p.y));
    let jd = min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y));
    return vec4<f32>(f, h21(cid), jd);
  } else if (mode == 1 || mode == 2) {   // herringbone parquet / basketweave
    var q = p;
    if (mode == 1) { q.x = q.x + floor(q.y / 2.0); }
    let blk = floor(q / 2.0);
    let l = q - blk * 2.0;
    let par = (blk.x + blk.y) - floor((blk.x + blk.y) / 2.0) * 2.0;
    var f: vec2<f32>;
    var cid: vec2<f32>;
    if (par < 0.5) {
      f = vec2<f32>(l.x * 0.5, fract(l.y));
      cid = blk * 3.1 + vec2<f32>(0.0, floor(l.y));
    } else {
      f = vec2<f32>(l.y * 0.5, fract(l.x));
      cid = blk * 3.1 + vec2<f32>(7.0, floor(l.x));
    }
    let jd = min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y));
    return vec4<f32>(f, h21(cid), jd);
  } else if (mode == 3) {                // hexagonal
    let hp = vec2<f32>(p.x, p.y / 0.8660254);
    let hc = floor(hp);
    var best = 9.0; var bid = vec2<f32>(0.0); var second = 9.0;
    for (var j = -1; j <= 1; j = j + 1) {
      for (var i = -1; i <= 1; i = i + 1) {
        let id = hc + vec2<f32>(f32(i), f32(j));
        let off = select(0.0, 0.5, (id.y - floor(id.y / 2.0) * 2.0) > 0.5);
        let c = vec2<f32>(id.x + off + 0.5, (id.y + 0.5) * 0.8660254);
        let d = distance(p, c);
        if (d < best) { second = best; best = d; bid = id; } else if (d < second) { second = d; }
      }
    }
    return vec4<f32>(vec2<f32>(best, best), h21(bid), clamp((second - best) * 1.1, 0.0, 1.0));
  } else if (mode == 4) {                // large slab
    let q = p * 0.5;
    let cid = floor(q);
    let f = fract(q);
    let jd = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 2.0;
    return vec4<f32>(f, h21(cid), jd);
  } else if (mode == 5) {                // granite setts (organic)
    let v = voronoi(p, cells, 0.85);
    return vec4<f32>(vec2<f32>(v.x, v.x), v.y, clamp(v.z * 1.6, 0.0, 1.0));
  } else if (mode == 6) {                // tactile blister
    let cid = floor(p);
    let f = fract(p) - 0.5;
    let d = length(f) * 2.0;
    return vec4<f32>(vec2<f32>(d, d), h21(cid), 1.0 - smoothstep(0.55, 0.75, d));
  }
  let cid = floor(p);                    // stack bond
  let f = fract(p);
  let jd = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 2.0;
  return vec4<f32>(f, h21(cid), jd);
}

fn blendRGB(base: vec3<f32>, top: vec3<f32>, mode: i32, a: f32) -> vec3<f32> {
  var r = top;
  if (mode == 1) { r = base * top * 2.0; }
  else if (mode == 2) {
    r = select(1.0 - 2.0 * (1.0 - base) * (1.0 - top), 2.0 * base * top, base < vec3<f32>(0.5));
  }
  else if (mode == 3) { r = base + top; }
  else if (mode == 4) { r = 1.0 - (1.0 - base) * (1.0 - top); }
  else if (mode == 5) {
    r = (1.0 - 2.0 * top) * base * base + 2.0 * top * base;
  }
  return mix(base, r, a);
}

struct Surf { col: vec3<f32>, h: f32, r: f32, ao: f32 };

@compute @workgroup_size(8, 8, 1)
fn bake(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = u32(U.size);
  if (gid.x >= size || gid.y >= size) { return; }
  let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / f32(size);
  var S: Surf;
  S.col = vec3<f32>(0.2);
  S.h = 0.5; S.r = 0.8; S.ao = 1.0;

  let n = i32(U.count);
  for (var li = 0; li < n; li = li + 1) {
    let L = layers[li];
    let kind = i32(L.head.x);
    let mode = i32(L.head.y);
    let op = L.head.z;
    let sc = max(L.head.w, 1.0);
    var col = L.col.rgb;
    var mask = 1.0;
    var dh = 0.0;
    var dr = 0.0;
    var dao = 0.0;

    if (kind == 0) {                       // BASE
      S.col = L.col.rgb * L.pa.y;
      S.r = L.pa.x;
      S.h = 0.5;
      continue;
    } else if (kind == 1) {                // GRAIN
      let fq = max(L.pa.x, 2.0);
      let v = pfbm(uv * fq, fq, 4);
      let c = (v - 0.5) * L.pa.y * 2.0;
      col = clamp(vec3<f32>(0.5 + c * 0.5), vec3<f32>(0.0), vec3<f32>(1.0));
      dh = c * L.pa.z * 0.25;
      dr = c * L.pa.w * 0.3;
      mask = 1.0;
    } else if (kind == 2) {                // AGGREGATE
      let dens = max(L.pa.x, 4.0);
      let v = voronoi(uv * dens, dens, 0.9);
      let chip = smoothstep(0.02, 0.22, v.z);
      let tone = mix(0.55, 1.45, v.y) * (1.0 - L.pa.y * 0.4 + v.w * L.pa.y * 0.8);
      col = L.col.rgb * tone;
      mask = chip * (0.35 + L.pa.w);
      dh = (chip - 0.4) * L.pa.z * 0.35;
      dr = -L.pa.w * 0.15 * chip;
      dao = (1.0 - chip) * 0.25;
    } else if (kind == 3) {                // CRACKS
      let dens = max(L.pa.x, 1.0);
      let v = voronoi(uv * dens, dens, 0.95);
      var line = 1.0 - smoothstep(0.0, L.pa.y, v.z);
      let micro = voronoi(uv * dens * 3.0, dens * 3.0, 0.9);
      let micl = (1.0 - smoothstep(0.0, L.pa.y * 0.8, micro.z)) * L.pa.w;
      line = max(line, micl * step(0.45, pfbm(uv * 3.0, 3.0, 3)));
      col = L.col.rgb;
      mask = line;
      dh = -line * L.pa.z * 0.5;
      dr = line * 0.25;
      dao = line * 0.8;
    } else if (kind == 4) {                // PATCH
      let cnt = max(L.pa.x, 1.0);
      let v = voronoi(uv * cnt, cnt, 0.85);
      let inside = step(v.y, L.pa.y * 2.0);
      let edge = 1.0 - smoothstep(0.0, 0.03, v.z);
      col = L.col.rgb * (1.0 + L.pa.z);
      mask = inside * (1.0 - edge * 0.0);
      dh = inside * 0.03 - edge * inside * L.pa.w * 0.15;
      dr = inside * 0.12;
      dao = edge * inside * L.pa.w;
    } else if (kind == 5) {                // OIL
      let cnt = max(L.pa.x, 1.0);
      let v = voronoi(uv * cnt, cnt, 0.95);
      let blob = 1.0 - smoothstep(L.pa.y * 2.0, L.pa.y * 6.0, v.x);
      let dr2 = pfbm(uv * 14.0, 14.0, 3);
      let m = clamp(blob * (0.5 + dr2) * step(v.y, 0.55), 0.0, 1.0);
      col = L.col.rgb;
      mask = m * L.pa.z;
      dr = -m * L.pa.w * 0.6;
      dh = -m * 0.01;
    } else if (kind == 6) {                // PAVING
      let b = bond(uv, i32(L.pa.x), max(L.pa.y, 2.0));
      let grout = 1.0 - smoothstep(L.pa.z * 0.5, L.pa.z, b.w);
      let bevel = 1.0 - smoothstep(L.pa.z, L.pa.z + L.pa.w * 0.25 + 0.02, b.w);
      let tone = 1.0 + (b.z - 0.5) * L.pb.x * 1.2;
      let wearK = L.pb.y * (1.0 - smoothstep(0.0, 0.35, b.w));
      col = L.col.rgb * tone * (1.0 - wearK * 0.25);
      if (i32(L.pa.x) == 6) {
        let dome = 1.0 - smoothstep(0.45, 0.62, b.x);
        dh = dome * 0.5 - grout * 0.1;
        col = L.col.rgb * (1.0 + dome * 0.25);
        mask = 1.0;
        dr = -dome * 0.1;
        dao = (1.0 - dome) * 0.3;
      } else {
        dh = -grout * 0.55 - bevel * 0.18 + (b.z - 0.5) * 0.04;
        mask = 1.0;
        dr = grout * 0.25 - (1.0 - grout) * 0.05;
        dao = grout * 0.95 + bevel * 0.35;
        col = mix(col, L.col.rgb * 0.45, grout * 0.85);
      }
    } else if (kind == 7) {                // MOSS
      let sc2 = max(L.pa.z, 1.0);
      let g = pfbm(uv * sc2, sc2, 4);
      let b = bond(uv, 0, 7.0);
      let jointK = mix(1.0, 1.0 - smoothstep(0.0, 0.25, b.w), L.pa.y);
      let m = smoothstep(0.52, 0.78, g) * jointK * L.pa.x;
      col = L.col.rgb * (0.7 + g * 0.6);
      mask = clamp(m, 0.0, 1.0);
      dr = m * 0.2;
      dh = m * 0.05;
    } else if (kind == 8) {                // STAIN
      let sc2 = max(L.pa.x, 0.5);
      let g = pfbm(uv * sc2, sc2, 5);
      let m = smoothstep(0.5 - L.pa.z * 0.35, 0.5 + L.pa.z * 0.35, g) * L.pa.y;
      col = L.col.rgb * (0.6 + g * 0.9);
      mask = m;
      dr = (g - 0.5) * 0.25;
    } else if (kind == 9) {                // GRAVEL
      let dens = max(L.pa.x, 6.0);
      let v = voronoi(uv * dens, dens, 1.0);
      let stone = smoothstep(0.0, L.pa.y * 0.45, v.z);
      let tone = mix(0.45, 1.6, v.y);
      col = L.col.rgb * tone;
      mask = stone;
      dh = (stone - 0.45) * L.pa.z * 0.6;
      dao = (1.0 - stone) * 0.7;
      dr = (v.w - 0.5) * 0.2;
    } else if (kind == 10) {               // SCRATCH
      let ang = L.pa.y * PI / 180.0;
      let ca = cos(ang); let sa = sin(ang);
      let q = vec2<f32>(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
      let dens = max(L.pa.x, 10.0);
      let lines = pnoise(vec2<f32>(q.x * dens, q.y * 2.0), dens);
      let m = smoothstep(0.58, 0.85, lines);
      col = L.col.rgb;
      mask = m * 0.6;
      dh = (m - 0.3) * L.pa.z * 0.12;
      dr = -m * 0.15;
    } else if (kind == 11) {               // POLISH
      let t = abs(fract(uv.y * 2.0) - 0.5) * 2.0;
      let m = (1.0 - smoothstep(0.0, L.pa.y, t)) * L.pa.x;
      col = L.col.rgb;
      mask = m * 0.3;
      dr = -m * 0.45;
    }

    let a = clamp(op * mask, 0.0, 1.0);
    S.col = blendRGB(S.col, col, mode, a);
    S.h = S.h + dh * a;
    S.r = clamp(S.r + dr * a, 0.02, 1.0);
    S.ao = clamp(S.ao - dao * a * 0.55, 0.05, 1.0);
  }

  let p = vec2<i32>(i32(gid.x), i32(gid.y));
  textureStore(outAlbedo, p, i32(U.slot), vec4<f32>(clamp(S.col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0));
  textureStore(outData, p, i32(U.slot), vec4<f32>(S.h, S.r, S.ao, 1.0));
}
`;

export const NORMAL_WGSL = /* wgsl */`
struct Cfg { count: f32, slot: f32, size: f32, seed: f32 };
@group(0) @binding(0) var<uniform> U : Cfg;
@group(0) @binding(1) var dataTex : texture_2d_array<f32>;
@group(0) @binding(2) var outSurf : texture_storage_2d_array<rgba8unorm, write>;

fn tap(p: vec2<i32>, size: i32, slot: i32) -> f32 {
  let q = vec2<i32>((p.x + size) % size, (p.y + size) % size);
  return textureLoad(dataTex, q, slot, 0).r;
}

@compute @workgroup_size(8, 8, 1)
fn normals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = i32(U.size);
  if (i32(gid.x) >= size || i32(gid.y) >= size) { return; }
  let slot = i32(U.slot);
  let p = vec2<i32>(i32(gid.x), i32(gid.y));
  let c = textureLoad(dataTex, p, slot, 0);
  let l = tap(p + vec2<i32>(-1, 0), size, slot);
  let r = tap(p + vec2<i32>(1, 0), size, slot);
  let d = tap(p + vec2<i32>(0, -1), size, slot);
  let u = tap(p + vec2<i32>(0, 1), size, slot);
  let l2 = tap(p + vec2<i32>(-2, 0), size, slot);
  let r2 = tap(p + vec2<i32>(2, 0), size, slot);
  let d2 = tap(p + vec2<i32>(0, -2), size, slot);
  let u2 = tap(p + vec2<i32>(0, 2), size, slot);
  let strength = f32(size) * 0.028;
  var n = normalize(vec3<f32>((l - r) * strength, (d - u) * strength, 1.0));
  let avg = (l + r + d + u + l2 + r2 + d2 + u2) * 0.125;
  let cav = clamp(1.0 - max(avg - c.r, 0.0) * 5.0, 0.0, 1.0);
  let ao = clamp(c.b * mix(1.0, cav, 0.75), 0.0, 1.0);
  textureStore(outSurf, p, slot, vec4<f32>(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, c.g, ao));
}
`;

export const MIP_WGSL = /* wgsl */`
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var ss  : sampler;
struct VSOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o: VSOut;
  o.clip = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}
@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  return textureSample(src, ss, i.uv);
}
`;

export const TEX_SIZE = 512;
export const MIPS = 7;

export class TextureBaker {
  constructor(device) {
    this.device = device;
    const size = TEX_SIZE;
    const layers = 8;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
    this.albedo = device.createTexture({
      label: 'tex-albedo', size: [size, size, layers], format: 'rgba8unorm',
      mipLevelCount: MIPS, usage, dimension: '2d',
    });
    this.surf = device.createTexture({
      label: 'tex-surf', size: [size, size, layers], format: 'rgba8unorm',
      mipLevelCount: MIPS, usage, dimension: '2d',
    });
    this.data = device.createTexture({
      label: 'tex-data', size: [size, size, layers], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.cfgBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.layerBuf = device.createBuffer({ size: 64 * 24, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    const bakeMod = device.createShaderModule({ code: BAKE_WGSL, label: 'bake' });
    const nrmMod = device.createShaderModule({ code: NORMAL_WGSL, label: 'normals' });
    this.bakePipe = device.createComputePipeline({
      layout: 'auto', compute: { module: bakeMod, entryPoint: 'bake' },
    });
    this.nrmPipe = device.createComputePipeline({
      layout: 'auto', compute: { module: nrmMod, entryPoint: 'normals' },
    });

    this.bakeBind = device.createBindGroup({
      layout: this.bakePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cfgBuf } },
        { binding: 1, resource: { buffer: this.layerBuf } },
        { binding: 2, resource: this.albedo.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 3, resource: this.data.createView({ dimension: '2d-array' }) },
      ],
    });
    this.nrmBind = device.createBindGroup({
      layout: this.nrmPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cfgBuf } },
        { binding: 1, resource: this.data.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: this.surf.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    });

    // mip chain
    const mipMod = device.createShaderModule({ code: MIP_WGSL, label: 'mip' });
    this.mipPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mipMod, entryPoint: 'vs' },
      fragment: { module: mipMod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  /** Bake one slot from a packed layer stack. */
  bakeSlot(slot, packed, seed = 7) {
    const d = this.device;
    d.queue.writeBuffer(this.cfgBuf, 0, new Float32Array([packed.count, slot, TEX_SIZE, seed]));
    d.queue.writeBuffer(this.layerBuf, 0, packed.buf);
    const enc = d.createCommandEncoder({ label: `bake-${slot}` });
    const g = Math.ceil(TEX_SIZE / 8);
    {
      const p = enc.beginComputePass();
      p.setPipeline(this.bakePipe);
      p.setBindGroup(0, this.bakeBind);
      p.dispatchWorkgroups(g, g, 1);
      p.end();
    }
    {
      const p = enc.beginComputePass();
      p.setPipeline(this.nrmPipe);
      p.setBindGroup(0, this.nrmBind);
      p.dispatchWorkgroups(g, g, 1);
      p.end();
    }
    this.genMips(enc, this.albedo, slot);
    this.genMips(enc, this.surf, slot);
    d.queue.submit([enc.finish()]);
  }

  genMips(enc, tex, slot) {
    for (let m = 1; m < MIPS; m++) {
      const srcView = tex.createView({
        dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: slot, arrayLayerCount: 1,
      });
      const dstView = tex.createView({
        dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: slot, arrayLayerCount: 1,
      });
      const bind = this.device.createBindGroup({
        layout: this.mipPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: this.mipSampler },
        ],
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: dstView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.mipPipe);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
    }
  }
}

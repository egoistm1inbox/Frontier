// Exports: 16-bit PNG / RAW heightmaps, maps (normal, albedo, splat, masks), GLB mesh, screenshots, project files, ZIP.
import { toast, download } from '../ui/dom.js';
import { normalizeProject } from '../app/presets.js';

// ── CRC32 / PNG / ZIP ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, crc = 0) { let c = ~crc >>> 0; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }
async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(u8) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
}
// channels: 1 (grey), 3 (rgb), 4 (rgba); depth 8 or 16. data: Uint8Array or Uint16Array (row-major, top row first)
export async function encodePNG(w, hgt, channels, depth, data) {
  const bpp = channels * (depth / 8);
  const stride = w * bpp;
  const raw = new Uint8Array((stride + 1) * hgt);
  const src = depth === 16 ? new Uint8Array(data.length * 2) : data;
  if (depth === 16) for (let i = 0; i < data.length; i++) { src[i * 2] = data[i] >> 8; src[i * 2 + 1] = data[i] & 255; }
  for (let y = 0; y < hgt; y++) {
    const o = y * (stride + 1);
    raw[o] = 2; // Up filter
    for (let x = 0; x < stride; x++) {
      const cur = src[y * stride + x], up = y ? src[(y - 1) * stride + x] : 0;
      raw[o + 1 + x] = (cur - up) & 255;
    }
  }
  const idat = await deflate(raw);
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, hgt); ihdr[8] = depth; ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
// Decodes 8/16-bit grey or RGB(A) PNGs (non-interlaced) to a Float32Array of normalised luminance.
export async function decodePNGHeight(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset);
  let p = 8, w = 0, hh = 0, depth = 8, ctype = 0; const idat = [];
  while (p < u8.length) {
    const len = dv.getUint32(p); const type = String.fromCharCode(...u8.subarray(p + 4, p + 8));
    const body = u8.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { const d = new DataView(body.buffer, body.byteOffset); w = d.getUint32(0); hh = d.getUint32(4); depth = body[8]; ctype = body[9]; if (body[12]) throw new Error('Interlaced PNGs are not supported'); }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch || (depth !== 8 && depth !== 16)) throw new Error('Unsupported PNG format (use 8/16-bit grey or RGB)');
  const data = await inflate(new Uint8Array(await new Blob(idat).arrayBuffer()));
  const bpp = ch * depth / 8, stride = w * bpp;
  const out = new Uint8Array(stride * hh);
  for (let y = 0; y < hh; y++) {
    const f = data[y * (stride + 1)];
    const row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  const res = new Float32Array(w * hh);
  for (let i = 0; i < w * hh; i++) {
    const o = i * bpp;
    const s = (k) => depth === 16 ? ((out[o + k * 2] << 8) | out[o + k * 2 + 1]) / 65535 : out[o + k] / 255;
    res[i] = ch >= 3 ? (s(0) + s(1) + s(2)) / 3 : s(0);
  }
  return { w, h: hh, data: res };
}
export function zip(files) {
  // files: [{name, data: Uint8Array}] — stored (no compression); PNGs are already deflated
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, f.data.length, true); dv.setUint32(22, f.data.length, true); dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    ch.set(name, 46);
    parts.push(lh, f.data); central.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

function f16(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}
const slug = (s) => (s || 'terrain').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'terrain';

export class Exporter {
  constructor(app) { this.app = app; }
  get gpu() { return this.app.gpu; }
  get d() { return this.app.derived; }

  menu() {
    const ready = !!this.d?.tex;
    const it = (label, icon, fn, right) => ({ label, icon, right, action: () => ready || label.includes('project') ? this.run(fn) : toast('Build the terrain first', 'err') });
    return [
      { group: 'Heightmap' },
      it('Heightmap PNG 16-bit', 'image', () => this.heightPNG(), 'PNG'),
      it('Heightmap RAW 16-bit', 'file-digit', () => this.heightRaw16(), 'R16'),
      it('Heightmap RAW 32-bit float', 'file-digit', () => this.heightRaw32(), 'R32'),
      { group: 'Maps' },
      it('Albedo colour', 'palette', () => this.albedoPNG(), 'PNG'),
      it('Normal map', 'move-3d', () => this.normalPNG(), 'PNG'),
      it('Splat weights (rock, ground, vegetation, snow)', 'layers', () => this.splatPNG(), 'PNG'),
      it('Erosion masks (flow, wear, deposits, talus, snow, water)', 'droplets', () => this.masksZip(), 'ZIP'),
      { group: 'Mesh & images' },
      it('Mesh with texture (GLB)', 'box', () => this.glb(), 'GLB'),
      it('Viewport screenshot', 'camera', () => this.screenshot(), 'P'),
      { sep: true },
      it('Everything (ZIP package)', 'package', () => this.packageZip()),
      { label: 'Save project file', icon: 'save', right: 'Ctrl S', action: () => this.saveProject() },
    ];
  }
  async run(fn) {
    try { toast('Exporting…', 'info', 1200); await fn(); }
    catch (e) { console.error(e); toast('Export failed: ' + e.message, 'err', 5000); }
  }

  async readTexture(tex, bytesPerTexel) {
    const N = tex.width;
    const bpr = Math.ceil(N * bytesPerTexel / 256) * 256;
    const buf = this.gpu.device.createBuffer({ size: bpr * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.gpu.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [tex.width, tex.height]);
    this.gpu.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(N * bytesPerTexel * tex.height);
    for (let y = 0; y < tex.height; y++) out.set(src.subarray(y * bpr, y * bpr + N * bytesPerTexel), y * N * bytesPerTexel);
    buf.unmap(); buf.destroy();
    return out;
  }
  async heights() {
    const N = this.d.N;
    return { N, data: new Float32Array(await this.gpu.read(this.d.heightBuffer, N * N * 4)) };
  }
  name(suffix, ext) { return `${slug(this.app.p.name)}_${suffix}.${ext}`; }

  async heightU16() {
    const { N, data } = await this.heights();
    let lo = Infinity, hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const u = new Uint16Array(N * N);
    const k = 65535 / Math.max(hi - lo, 1e-9);
    for (let i = 0; i < u.length; i++) u[i] = Math.round((data[i] - lo) * k);
    const hs = this.app.p.world.height;
    return { N, u, minM: lo * hs, maxM: hi * hs };
  }
  meta(extra = {}) {
    const p = this.app.p;
    return JSON.stringify({ generator: 'Frontier Terrain', name: p.name, worldSizeMeters: p.world.size, ...extra }, null, 2);
  }
  async heightPNG(asBlob) {
    const { N, u, minM, maxM } = await this.heightU16();
    const blob = await encodePNG(N, N, 1, 16, u);
    if (asBlob) return { blob, minM, maxM, N };
    download(blob, this.name(`height_${N}_${Math.round(minM)}m-${Math.round(maxM)}m`, 'png'));
    toast(`Heightmap ${N}² · ${Math.round(minM)}–${Math.round(maxM)} m`, 'ok', 4000);
  }
  async heightRaw16() {
    const { N, u, minM, maxM } = await this.heightU16();
    const out = new Uint8Array(N * N * 2); const dv = new DataView(out.buffer);
    for (let i = 0; i < u.length; i++) dv.setUint16(i * 2, u[i], true);
    download(new Blob([out]), this.name(`height_${N}_${Math.round(minM)}m-${Math.round(maxM)}m`, 'r16'));
    toast(`RAW 16-bit little-endian · Z range ${Math.round(maxM - minM)} m`, 'ok', 4000);
  }
  async heightRaw32() {
    const { N, data } = await this.heights();
    const hs = this.app.p.world.height;
    const out = new Float32Array(N * N);
    for (let i = 0; i < out.length; i++) out[i] = data[i] * hs;
    download(new Blob([out.buffer]), this.name(`height_${N}_metres_f32`, 'raw'));
  }
  async albedoPNG(asBlob) {
    const c = this.app.compositor;
    const raw = new Uint16Array((await this.readTexture(c.tex.albedo, 8)).buffer);
    const N = c.N;
    const rgb = new Uint8Array(N * N * 3);
    const oetf = (x) => { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
    for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.round(oetf(f16(raw[i * 4 + k])) * 255);
    const blob = await encodePNG(N, N, 3, 8, rgb);
    if (asBlob) return blob;
    download(blob, this.name(`albedo_${N}`, 'png'));
  }
  async normalPNG(asBlob) {
    const raw = new Uint16Array((await this.readTexture(this.d.tex.normal, 8)).buffer);
    const N = this.d.N;
    const rgb = new Uint8Array(N * N * 3);
    for (let i = 0; i < N * N; i++) {
      // world normal (x, y-up, z) → tangent-space for a top-down map: R = x, G = -z (OpenGL, +Y up the image), B = y
      const x = f16(raw[i * 4]), y = f16(raw[i * 4 + 1]), z = f16(raw[i * 4 + 2]);
      rgb[i * 3] = Math.round((x * 0.5 + 0.5) * 255); rgb[i * 3 + 1] = Math.round((-z * 0.5 + 0.5) * 255); rgb[i * 3 + 2] = Math.round((y * 0.5 + 0.5) * 255);
    }
    const blob = await encodePNG(N, N, 3, 8, rgb);
    if (asBlob) return blob;
    download(blob, this.name(`normal_ogl_${N}`, 'png'));
  }
  async splatPNG(asBlob) {
    const c = this.app.compositor;
    const raw = await this.readTexture(c.tex.detail, 4);
    const blob = await encodePNG(c.N, c.N, 4, 8, raw);
    if (asBlob) return blob;
    download(blob, this.name(`splat_rgba_${c.N}`, 'png'));
  }
  async maskBlobs() {
    const N = this.d.N;
    const A = new Uint16Array((await this.readTexture(this.d.tex.attrA, 8)).buffer);
    const B = new Uint16Array((await this.readTexture(this.d.tex.attrB, 8)).buffer);
    const Nn = new Uint16Array((await this.readTexture(this.d.tex.normal, 8)).buffer);
    const defs = [
      ['flow', (i) => f16(A[i * 4])], ['wear', (i) => 1 - Math.exp(-f16(A[i * 4 + 1]) / 10)], ['deposits', (i) => 1 - Math.exp(-f16(A[i * 4 + 2]) / 4)],
      ['talus', (i) => 1 - Math.exp(-f16(A[i * 4 + 3]) / 2.5)], ['snow', (i) => 1 - Math.exp(-f16(B[i * 4]) / 0.35)], ['water', (i) => Math.min(1, f16(B[i * 4 + 1]) / 8)],
      ['occlusion', (i) => f16(Nn[i * 4 + 3])], ['slope', (i) => Math.acos(Math.max(-1, Math.min(1, f16(Nn[i * 4 + 1])))) / (Math.PI / 2)],
    ];
    const out = [];
    for (const [nm, fn] of defs) {
      const u = new Uint16Array(N * N);
      for (let i = 0; i < N * N; i++) u[i] = Math.round(Math.max(0, Math.min(1, fn(i))) * 65535);
      out.push({ name: this.name(`mask_${nm}_${N}`, 'png'), blob: await encodePNG(N, N, 1, 16, u) });
    }
    return out;
  }
  async masksZip() {
    const m = await this.maskBlobs();
    const files = await Promise.all(m.map(async (x) => ({ name: x.name, data: new Uint8Array(await x.blob.arrayBuffer()) })));
    download(zip(files), this.name('masks', 'zip'));
  }
  async glb(asBlob) {
    const { N, data } = await this.heights();
    const p = this.app.p;
    const M = Math.min(N, 1024);
    const V = M + 1;
    const W = p.world.size, hs = p.world.height;
    const pos = new Float32Array(V * V * 3), nor = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2);
    const sample = (u, v) => {
      const x = u * (N - 1), y = v * (N - 1); const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1); const fx = x - x0, fy = y - y0;
      return ((data[y0 * N + x0] * (1 - fx) + data[y0 * N + x1] * fx) * (1 - fy) + (data[y1 * N + x0] * (1 - fx) + data[y1 * N + x1] * fx) * fy) * hs;
    };
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const hgt = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) hgt[j * V + i] = sample(i / M, j / M);
    const cell = W / M;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const y = hgt[k];
      pos[k * 3] = (i / M - 0.5) * W; pos[k * 3 + 1] = y; pos[k * 3 + 2] = (j / M - 0.5) * W;
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[k * 3 + a]); mx[a] = Math.max(mx[a], pos[k * 3 + a]); }
      const hx = (hgt[j * V + Math.min(V - 1, i + 1)] - hgt[j * V + Math.max(0, i - 1)]) / (2 * cell);
      const hz = (hgt[Math.min(V - 1, j + 1) * V + i] - hgt[Math.max(0, j - 1) * V + i]) / (2 * cell);
      const l = Math.hypot(hx, 1, hz);
      nor[k * 3] = -hx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -hz / l;
      uv[k * 2] = i / M; uv[k * 2 + 1] = j / M;
    }
    const idx = new Uint32Array(M * M * 6);
    let o = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const a = j * V + i, b = a + 1, c = a + V, d = c + 1; idx.set([a, c, b, b, c, d], o); o += 6; }
    const png = new Uint8Array(await (await this.albedoPNG(true)).arrayBuffer());
    const pad4 = (n) => (n + 3) & ~3;
    const views = [pos, nor, uv, idx].map(a => new Uint8Array(a.buffer));
    let off = 0; const bvs = [];
    for (const v of [...views, png]) { bvs.push({ buffer: 0, byteOffset: off, byteLength: v.length }); off = pad4(off + v.length); }
    bvs[4] = { buffer: 0, byteOffset: bvs[4].byteOffset, byteLength: png.length };
    const bin = new Uint8Array(off);
    let q = 0; for (const v of [...views, png]) { bin.set(v, q); q = pad4(q + v.length); }
    bvs[0].target = 34962; bvs[1].target = 34962; bvs[2].target = 34962; bvs[3].target = 34963;
    const gltf = {
      asset: { version: '2.0', generator: 'Frontier Terrain' },
      scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: p.name }],
      meshes: [{ name: 'terrain', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
      materials: [{ name: 'terrain', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 } }],
      textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
      images: [{ bufferView: 4, mimeType: 'image/png' }],
      buffers: [{ byteLength: bin.length }], bufferViews: bvs,
      accessors: [
        { bufferView: 0, componentType: 5126, count: V * V, type: 'VEC3', min: mn, max: mx },
        { bufferView: 1, componentType: 5126, count: V * V, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: V * V, type: 'VEC2' },
        { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
      ],
    };
    let json = new TextEncoder().encode(JSON.stringify(gltf));
    const jl = pad4(json.length);
    const jsonP = new Uint8Array(jl).fill(0x20); jsonP.set(json);
    const total = 12 + 8 + jl + 8 + bin.length;
    const head = new Uint8Array(12 + 8); const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x46546c67, true); hv.setUint32(4, 2, true); hv.setUint32(8, total, true); hv.setUint32(12, jl, true); hv.setUint32(16, 0x4e4f534a, true);
    const bh = new Uint8Array(8); const bv = new DataView(bh.buffer); bv.setUint32(0, bin.length, true); bv.setUint32(4, 0x004e4942, true);
    const blob = new Blob([head, jsonP, bh, bin], { type: 'model/gltf-binary' });
    if (asBlob) return blob;
    download(blob, this.name(`mesh_${M}`, 'glb'));
  }
  async screenshot() {
    const blob = await this.app.renderer.screenshot();
    if (blob) download(blob, this.name('view_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'), 'png'));
  }
  async packageZip() {
    const files = [];
    const add = async (name, blob) => files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    const hp = await this.heightPNG(true);
    await add(this.name(`height_${hp.N}`, 'png'), hp.blob);
    await add(this.name('albedo', 'png'), await this.albedoPNG(true));
    await add(this.name('normal_ogl', 'png'), await this.normalPNG(true));
    await add(this.name('splat_rgba', 'png'), await this.splatPNG(true));
    for (const m of await this.maskBlobs()) await add('masks/' + m.name, m.blob);
    await add(this.name('mesh', 'glb'), await this.glb(true));
    await add(this.name('project', 'json'), new Blob([JSON.stringify(this.app.p, null, 1)]));
    await add('README.txt', new Blob([`Frontier Terrain export\n\nHeightmap: 16-bit, normalised. Minimum ${hp.minM.toFixed(1)} m, maximum ${hp.maxM.toFixed(1)} m (Z range ${(hp.maxM - hp.minM).toFixed(1)} m).\nWorld width: ${this.app.p.world.size} m.\nSplat channels: R rock, G ground, B vegetation, A snow.\nNormal map: OpenGL convention (+Y up the image).\n\n${this.meta({ heightMinMeters: hp.minM, heightMaxMeters: hp.maxM })}\n`]));
    download(zip(files), this.name('package', 'zip'));
  }
  saveProject() {
    const p = { ...this.app.p, scene: { ...this.app.p.scene, camera: this.app.renderer.camera.toJSON() } };
    download(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }), slug(p.name) + '.frontier-terrain.json');
    toast('Project saved', 'ok');
  }
  openProject() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const p = normalizeProject(JSON.parse(await f.text()));
        if (!p.terrain?.layers) throw new Error('Not a Frontier Terrain project');
        this.app.store.load(p);
        toast(`Opened ${p.name}`, 'ok');
      } catch (e) { toast('Could not open: ' + e.message, 'err', 5000); }
    };
    inp.click();
  }
}

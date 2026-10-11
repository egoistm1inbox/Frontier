// Viewport renderer: CDLOD terrain + diorama walls, water, sea, physically based sky, bloom and tonemapping.
// Renders on demand (dirty flag) and while the camera moves.
import { FlyCamera } from './camera.js';
import { Atmosphere, SKY_DEFAULTS } from './atmosphere.js';
import { CDLOD, buildPatchIndices, PATCH_GRID } from './cdlod.js';
import { DetailMaps } from './detail.js';
import { RENDER_WGSL, POST_WGSL, FRAME_SIZE } from './shaders.js';
import { frustumPlanes, hexToLinear, clamp } from '../core/math.js';

export const SURROUNDS = ['Diorama', 'Mirror', 'Ocean'];
export const TONEMAPS = ['AgX', 'ACES', 'Neutral', 'None'];

export const SCENE_DEFAULTS = {
  sky: { ...SKY_DEFAULTS },
  water: { color: '#3c9aab', clarity: 9, turbidity: 0.12, waves: 0.5, windBearing: 220, animate: false },
  surround: 1,
  view: { mode: 0, contours: false, contourInterval: 50, grid: false, gridSpacing: 1000, detail: true, detailStrength: 1, displacement: 1, quality: 1 },
};

const HDR = 'rgba16float';
const MSAA = 4;
const BLOOM_LEVELS = 6;

export class Renderer {
  constructor(gpu, canvas) {
    this.gpu = gpu;
    this.canvas = canvas;
    this.camera = new FlyCamera();
    this.cdlod = new CDLOD();
    this.atmo = new Atmosphere(gpu);
    this.detail = new DetailMaps(gpu);
    this.scene = structuredClone(SCENE_DEFAULTS);
    this.derived = null;
    this.compositor = null;
    this.dirty = true;
    this.raf = 0;
    this.time = 0;
    this.stats = { instances: 0, water: 0, ms: 0 };
    this.onFrame = null;
    this.selectedMaskVersion = 0;
    this.scale = 1;
    this._bindKey = '';
    this.camera.onChange = () => this.requestFrame();
  }

  async init() {
    const g = this.gpu, dev = g.device;
    this.ctx = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: dev, format: this.format, alphaMode: 'opaque' });
    await Promise.all([this.atmo.init(), this.detail.init()]);
    this.frameUbo = g.uniform(FRAME_SIZE, 'frame');
    // samplers
    this.sampM = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
    this.sampR = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 16 });
    this.sampC = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    // fallback textures until the compositor has run
    const one = (fmt, rgba) => {
      const t = dev.createTexture({ size: [1, 1], format: fmt, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      if (fmt === 'rgba8unorm') dev.queue.writeTexture({ texture: t }, new Uint8Array(rgba.map(v => Math.round(v * 255))), { bytesPerRow: 4 }, [1, 1]);
      else {
        const h = new Uint16Array(4); const f2h = (v) => { const f = new Float32Array([v]); const u = new Uint32Array(f.buffer)[0]; const s = (u >> 16) & 0x8000; const e = ((u >> 23) & 0xff) - 112; const m = (u >> 13) & 0x3ff; return e <= 0 ? s : e >= 31 ? s | 0x7c00 : s | (e << 10) | m; };
        rgba.forEach((v, i) => { h[i] = f2h(v); });
        dev.queue.writeTexture({ texture: t }, h, { bytesPerRow: 8 }, [1, 1]);
      }
      return t;
    };
    this.fallback = { albedo: one('rgba16float', [0.2, 0.19, 0.17, 0.85]), detail: one('rgba8unorm', [0.3, 0.7, 0, 0]), surf: one('rgba8unorm', [0, 0.55, 0, 0]) };
    // geometry
    const idx = buildPatchIndices(PATCH_GRID);
    this.indexCount = idx.length;
    this.gridIndexCount = PATCH_GRID * PATCH_GRID * 6;
    this.indexBuf = g.buffer(idx.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'patch-idx');
    g.write(this.indexBuf, idx);
    this.instBuf = g.buffer(8192 * 16, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'inst-terrain');
    this.waterBuf = g.buffer(8192 * 16, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'inst-water');
    this._buildSea();
    await this._pipelines();
    this.resize();
    new ResizeObserver(() => { this.resize(); this.requestFrame(); }).observe(this.canvas.parentElement || this.canvas);
    this.camera.attach(this.canvas);
    this.camera.heightAt = (x, z) => this.heightAtWorld(x, z);
    this.camera.onSun = (dx, dy) => {
      const s = this.scene.sky;
      s.sunAzimuth = (s.sunAzimuth + dx * 0.35 + 360) % 360;
      s.sunElevation = clamp(s.sunElevation - dy * 0.25, -8, 89);
      this.onSunDrag?.();
      this.sunChanged();
    };
  }

  _buildSea() {
    const segs = 96, rings = 64;
    const verts = [0, 0];
    for (let r = 1; r <= rings; r++) {
      const rad = 3 * Math.pow(1.19, r) - 3 + r * 2;
      for (let s = 0; s < segs; s++) { const a = s / segs * Math.PI * 2; verts.push(Math.cos(a) * rad, Math.sin(a) * rad); }
    }
    const idx = [];
    for (let s = 0; s < segs; s++) idx.push(0, 1 + (s + 1) % segs, 1 + s);
    for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + (s + 1) % segs, c = 1 + r * segs + s, d = 1 + r * segs + (s + 1) % segs;
      idx.push(a, b, c, b, d, c);
    }
    const g = this.gpu;
    const vb = new Float32Array(verts), ib = new Uint32Array(idx);
    this.seaVB = g.buffer(vb.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, 'sea-vb'); g.write(this.seaVB, vb);
    this.seaIB = g.buffer(ib.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, 'sea-ib'); g.write(this.seaIB, ib);
    this.seaCount = ib.length;
  }

  async _pipelines() {
    const g = this.gpu, dev = g.device;
    const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const tex = (b, sampleType = 'float', viewDimension = '2d') => ({ binding: b, visibility: vf, texture: { sampleType, viewDimension } });
    this.bgl = dev.createBindGroupLayout({
      label: 'render-bgl',
      entries: [
        { binding: 0, visibility: vf, buffer: { type: 'uniform' } },
        { binding: 1, visibility: vf, buffer: { type: 'uniform' } },
        tex(2, 'unfilterable-float'), tex(3), tex(4), tex(5), tex(6), tex(7), tex(8), tex(9), tex(10, 'unfilterable-float'),
        tex(11), tex(12), tex(13, 'float', '3d'),
        { binding: 14, visibility: vf, buffer: { type: 'read-only-storage' } },
        tex(15), tex(16), tex(17),
        { binding: 18, visibility: vf, sampler: { type: 'filtering' } },
        { binding: 19, visibility: vf, sampler: { type: 'filtering' } },
        { binding: 20, visibility: vf, sampler: { type: 'filtering' } },
      ],
    });
    const layout = dev.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    const module = await g.module(RENDER_WGSL, 'render');
    const inst = [{ arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }];
    const ds = (write, compare) => ({ format: 'depth32float', depthWriteEnabled: write, depthCompare: compare });
    const ms = { count: MSAA };
    const tgt = [{ format: HDR }];
    const [terrain, water, sea, sky] = await Promise.all([
      dev.createRenderPipelineAsync({ label: 'terrain', layout, vertex: { module, entryPoint: 'vsTerrain', buffers: inst }, fragment: { module, entryPoint: 'fsTerrain', targets: tgt },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: ds(true, 'greater'), multisample: ms }),
      dev.createRenderPipelineAsync({ label: 'water', layout, vertex: { module, entryPoint: 'vsWater', buffers: inst }, fragment: { module, entryPoint: 'fsWater', targets: tgt },
        primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: ds(true, 'greater'), multisample: ms }),
      dev.createRenderPipelineAsync({ label: 'sea', layout, vertex: { module, entryPoint: 'vsSea', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
        fragment: { module, entryPoint: 'fsWater', targets: tgt }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: ds(true, 'greater'), multisample: ms }),
      dev.createRenderPipelineAsync({ label: 'sky', layout, vertex: { module, entryPoint: 'vsSky' }, fragment: { module, entryPoint: 'fsSky', targets: tgt },
        primitive: { topology: 'triangle-list' }, depthStencil: ds(false, 'equal'), multisample: ms }),
    ]);
    this.pTerrain = terrain; this.pWater = water; this.pSea = sea; this.pSky = sky;
    const post = await g.module(POST_WGSL, 'post');
    const mk = (fs, format, blend) => dev.createRenderPipelineAsync({ label: fs, layout: 'auto', vertex: { module: post, entryPoint: 'vsFull' },
      fragment: { module: post, entryPoint: fs, targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } });
    const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    [this.pDown, this.pUp, this.pTone] = await Promise.all([mk('fsDown', HDR), mk('fsUp', HDR, add), mk('fsTone', this.format)]);
    this.postUbos = Array.from({ length: BLOOM_LEVELS * 2 + 1 }, () => g.uniform(48));
  }

  resize() {
    const el = this.canvas;
    const r = el.getBoundingClientRect();
    const q = this.scene.view.quality ?? 1;
    const dprCap = q === 0 ? 1 : q === 1 ? 1.5 : 2;
    const scale = this.testMode ? 0.5 : Math.min(window.devicePixelRatio || 1, dprCap) * (q === 0 ? 0.8 : 1);
    const w = Math.max(64, Math.round(r.width * scale)), h = Math.max(64, Math.round(r.height * scale));
    if (this.w === w && this.h === h && this.msColor) return;
    this.w = w; this.h = h;
    el.width = w; el.height = h;
    const dev = this.gpu.device;
    [this.msColor, this.msDepth, this.hdrTex, this.bloomTex].forEach(t => t?.destroy());
    this.msColor = dev.createTexture({ size: [w, h], format: HDR, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.msDepth = dev.createTexture({ size: [w, h], format: 'depth32float', sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.hdrTex = dev.createTexture({ size: [w, h], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    this.bloomLevels = Math.max(1, Math.min(BLOOM_LEVELS, Math.floor(Math.log2(Math.min(bw, bh))) - 1));
    this.bloomTex = dev.createTexture({ size: [bw, bh], format: HDR, mipLevelCount: this.bloomLevels, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.dirty = true;
  }

  setScene(scene) { this.scene = scene; this.requestFrame(); }

  setTerrain(derived) {
    this.derived = derived;
    this.cdlod.setTerrain(derived);
    this.camera.bounds = derived.world.size;
    this._bindKey = '';
    this.sunChanged(true);
  }
  setCompositor(c) { this.compositor = c; this._bindKey = ''; this.requestFrame(); }

  sunChanged(force = false) {
    if (this.derived) {
      const sun = Atmosphere.sunDirection(this.scene.sky);
      const dir = sun[1] < 0.02 ? [sun[0], 0.02, sun[2]] : sun;
      this.derived.shadows(dir, force).then(() => this.requestFrame());
    }
    this.requestFrame();
  }

  heightAtWorld(x, z) {
    const d = this.derived;
    if (!d) return 0;
    const W = d.world.size;
    const mirror = this.scene.surround === 1;
    if (mirror) {
      const m = (v) => { const u = v / W + 0.5; const t = u - 2 * Math.floor(u / 2); return (1 - Math.abs(t - 1) - 0.5) * W; };
      x = m(x); z = m(z);
    } else if (Math.abs(x) > W / 2 || Math.abs(z) > W / 2) {
      return this.scene.surround === 2 ? (this.scene.water?.seaOn ? 0 : (d.stats.min * d.world.height)) : -1e5;
    }
    let h = d.heightAt(x, z);
    if (this.project?.world?.seaOn) h = Math.max(h, this.project.world.seaLevel);
    return h;
  }

  requestFrame() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this._loop(t));
  }
  _loop(t) {
    this.raf = 0;
    const dt = this._lastT ? Math.min(0.1, (t - this._lastT) / 1000) : 1 / 60;
    this._lastT = t;
    const moving = this.camera.update(dt);
    const animate = !!this.scene.water?.animate;
    if (animate) this.time += dt;
    if (this.dirty || moving || animate) {
      this.dirty = false;
      this.render();
    }
    if (moving || animate || this.dirty) this.raf = requestAnimationFrame((tt) => this._loop(tt));
    else this._lastT = 0;
  }

  _bindGroup() {
    const d = this.derived, c = this.compositor;
    const key = [d?.version, c?.version, c?.N, d?.N].join(':');
    if (key === this._bindKey && this.bg) return this.bg;
    const t = d.tex;
    const ct = c?.tex && c.N === d.N ? c.tex : this.fallback;
    this.bg = this.gpu.device.createBindGroup({
      layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.frameUbo } },
        { binding: 1, resource: { buffer: this.atmo.ubo } },
        { binding: 2, resource: t.height.createView() },
        { binding: 3, resource: t.normal.createView() },
        { binding: 4, resource: ct.albedo.createView() },
        { binding: 5, resource: ct.detail.createView() },
        { binding: 6, resource: ct.surf.createView() },
        { binding: 7, resource: t.shadow.createView() },
        { binding: 8, resource: t.attrA.createView() },
        { binding: 9, resource: t.attrB.createView() },
        { binding: 10, resource: t.water.createView() },
        { binding: 11, resource: this.atmo.transT.createView() },
        { binding: 12, resource: this.atmo.skyT.createView() },
        { binding: 13, resource: this.atmo.apT.createView({ dimension: '3d' }) },
        { binding: 14, resource: { buffer: this.atmo.irr } },
        { binding: 15, resource: this.detail.H.createView() },
        { binding: 16, resource: this.detail.G1.createView() },
        { binding: 17, resource: this.detail.G2.createView() },
        { binding: 18, resource: this.sampM },
        { binding: 19, resource: this.sampR },
        { binding: 20, resource: this.sampC },
      ],
    });
    this._bindKey = key;
    return this.bg;
  }

  _frameUniforms(m, project) {
    const s = this.scene, sky = s.sky, view = s.view, water = s.water;
    const d = this.derived;
    const f = new Float32Array(FRAME_SIZE / 4);
    const u = new Uint32Array(f.buffer);
    f.set(m.viewProj, 0); f.set(m.invViewProj, 16);
    const cp = this.camera.pos;
    f[32] = cp[0]; f[33] = cp[1]; f[34] = cp[2]; f[35] = this.time;
    const sun = Atmosphere.sunDirection(sky);
    f[36] = sun[0]; f[37] = sun[1]; f[38] = sun[2]; f[39] = 1;
    const tint = hexToLinear(sky.sunTint || '#ffffff');
    f[40] = tint[0]; f[41] = tint[1]; f[42] = tint[2]; f[43] = sky.sunIntensity;
    const W = d.world.size, hs = d.world.height;
    const seaOn = project?.world?.seaOn || s.surround === 2;
    f[44] = W; f[45] = hs; f[46] = seaOn ? (project?.world?.seaLevel ?? 0) : -1e5; f[47] = d.N;
    f[48] = this.w; f[49] = this.h; f[50] = 1 / this.w; f[51] = 1 / this.h;
    let flags = 0;
    if (view.contours) flags |= 1;
    if (view.grid) flags |= 2;
    if (s.surround === 1) flags |= 4;
    flags |= 8;
    if (seaOn) flags |= 16;
    if (view.detail) flags |= 64;
    u[52] = view.mode; u[53] = flags; u[54] = s.surround; u[55] = this.cdlod.D || 0;
    f[56] = view.contourInterval; f[57] = view.gridSpacing; f[58] = view.detailStrength; f[59] = this.apMaxKm;
    const wc = hexToLinear(water.color);
    const k = 2.5 / Math.max(0.5, water.clarity);
    f[60] = -Math.log(Math.max(wc[0], 0.004)) * k; f[61] = -Math.log(Math.max(wc[1], 0.004)) * k; f[62] = -Math.log(Math.max(wc[2], 0.004)) * k; f[63] = water.waves;
    f[64] = wc[0]; f[65] = wc[1]; f[66] = wc[2]; f[67] = 0.01 + water.turbidity * 0.5;
    f[68] = sky.baseAltitude / 1000; f[69] = sky.fogDensity; f[70] = sky.fogHeight; f[71] = view.displacement;
    const fc = hexToLinear(sky.fogColor || '#c7d2dc');
    const minH = (d.stats?.min ?? 0) * hs, maxH = (d.stats?.max ?? 1) * hs;
    f[72] = fc[0]; f[73] = fc[1]; f[74] = fc[2]; f[75] = minH;
    f[76] = minH; f[77] = maxH; f[78] = minH - Math.max(60, (maxH - minH) * 0.08); f[79] = (water.windBearing ?? 220) * Math.PI / 180;
    f.set(this.cdlod.morphTable(), 80);
    return f;
  }

  render() {
    if (!this.pTerrain) return;
    const t0 = performance.now();
    const g = this.gpu, dev = g.device;
    this.resize();
    const aspect = this.w / this.h;
    const m = this.camera.matrices(aspect);
    const project = this.project;
    const enc = dev.createCommandEncoder({ label: 'frame' });
    this.apMaxKm = 64;
    this.atmo.update(enc, this.scene.sky, this.camera, m.invViewProj, this.apMaxKm);
    const colorView = this.msColor.createView();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: colorView, resolveTarget: this.hdrTex.createView(), loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      depthStencilAttachment: { view: this.msDepth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 0 },
    });
    if (this.derived && this.cdlod.ready) {
      const planes = frustumPlanes(m.viewProj);
      this.cdlod.lodFactor = [1.6, 2.4, 3.2][this.scene.view.quality ?? 1];
      const sel = this.cdlod.select(this.camera.pos, planes, { mirror: this.scene.surround === 1 });
      const nT = Math.min(8192, sel.nT), nW = Math.min(8192, sel.nW);
      if (nT) g.write(this.instBuf, sel.terrain.subarray(0, nT * 4));
      if (nW) g.write(this.waterBuf, sel.water.subarray(0, nW * 4));
      g.write(this.frameUbo, this._frameUniforms(m, project));
      const bg = this._bindGroup();
      pass.setBindGroup(0, bg);
      pass.setIndexBuffer(this.indexBuf, 'uint32');
      if (nT) {
        pass.setPipeline(this.pTerrain);
        pass.setVertexBuffer(0, this.instBuf);
        pass.drawIndexed(this.indexCount, nT);
      }
      if (nW) {
        pass.setPipeline(this.pWater);
        pass.setVertexBuffer(0, this.waterBuf);
        pass.drawIndexed(this.gridIndexCount, nW);
      }
      const seaOn = project?.world?.seaOn || this.scene.surround === 2;
      if (seaOn) {
        pass.setPipeline(this.pSea);
        pass.setVertexBuffer(0, this.seaVB);
        pass.setIndexBuffer(this.seaIB, 'uint32');
        pass.drawIndexed(this.seaCount);
      }
      pass.setPipeline(this.pSky);
      pass.draw(3);
      this.stats.instances = nT; this.stats.water = nW;
    }
    pass.end();
    if (this.derived) this._post(enc);
    else {
      const p2 = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.06, g: 0.06, b: 0.06, a: 1 } }] });
      p2.end();
    }
    dev.queue.submit([enc.finish()]);
    this.stats.ms = performance.now() - t0;
    this.onFrame?.(this.stats);
  }

  _post(enc) {
    const g = this.gpu, dev = g.device;
    const s = this.scene.sky;
    const L = this.bloomLevels;
    const write = (i, texel, first) => {
      const ab = new ArrayBuffer(48), f = new Float32Array(ab), u = new Uint32Array(ab);
      f[0] = Math.pow(2, s.exposure); f[1] = s.bloom; u[2] = ['agx', 'aces', 'neutral', 'none'].indexOf(s.tonemap); f[3] = s.vignette;
      f[4] = s.contrast; f[5] = s.saturation; f[6] = s.grain; f[7] = performance.now() / 1000;
      f[8] = texel[0]; f[9] = texel[1]; f[10] = first; f[11] = s.exposure;
      if (u[2] > 3) u[2] = 0;
      g.write(this.postUbos[i], ab);
    };
    const mipView = (m) => this.bloomTex.createView({ baseMipLevel: m, mipLevelCount: 1 });
    // downsample chain
    for (let i = 0; i < L; i++) {
      const srcW = i === 0 ? this.w : Math.max(1, (this.w >> 1) >> (i - 1)), srcH = i === 0 ? this.h : Math.max(1, (this.h >> 1) >> (i - 1));
      write(i, [1 / srcW, 1 / srcH], i === 0 ? 1 : 0);
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: mipView(i), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(this.pDown);
      pass.setBindGroup(0, g.bind(this.pDown, [this.postUbos[i], i === 0 ? this.hdrTex.createView() : mipView(i - 1), this.sampC]));
      pass.draw(3);
      pass.end();
    }
    // upsample (additive)
    for (let i = L - 1; i > 0; i--) {
      const sw = Math.max(1, (this.w >> 1) >> i), sh = Math.max(1, (this.h >> 1) >> i);
      write(L + i, [1 / sw, 1 / sh], 0);
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: mipView(i - 1), loadOp: 'load', storeOp: 'store' }] });
      pass.setPipeline(this.pUp);
      pass.setBindGroup(0, g.bind(this.pUp, [this.postUbos[L + i], mipView(i), this.sampC]));
      pass.draw(3);
      pass.end();
    }
    // tonemap to the swapchain
    write(L * 2, [1 / this.w, 1 / this.h], s.autoExposure ? 1 : 0);
    {
      const ab = new ArrayBuffer(48), f = new Float32Array(ab), u = new Uint32Array(ab);
      f[0] = Math.pow(2, s.exposure) * 0.25; f[1] = s.bloom / Math.max(1, L * 0.8); u[2] = Math.max(0, ['agx', 'aces', 'neutral', 'none'].indexOf(s.tonemap)); f[3] = s.vignette;
      f[4] = s.contrast; f[5] = s.saturation; f[6] = s.grain; f[7] = (performance.now() / 1000) % 1000;
      f[8] = 1 / this.w; f[9] = 1 / this.h; f[10] = s.autoExposure ? 1 : 0; f[11] = s.exposure;
      g.write(this.postUbos[L * 2], ab);
    }
    const out = this.ctx.getCurrentTexture().createView();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pTone);
    pass.setBindGroup(0, g.bind(this.pTone, [this.postUbos[L * 2], this.hdrTex.createView(), this.sampC, mipView(0), this.atmo.irr]));
    pass.draw(3);
    pass.end();
  }

  // Capture the current frame as a PNG blob (re-renders synchronously first).
  async screenshot() {
    this.render();
    await this.gpu.idle();
    return new Promise((res) => this.canvas.toBlob(res, 'image/png'));
  }
}

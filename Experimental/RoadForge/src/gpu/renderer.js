// RoadForge — WebGPU forward renderer.
//
// Passes: 2 sun-shadow cascades → MSAA HDR forward (sky, road surface,
// instanced props, overlay lines) → resolve → tonemap/post to the swap chain.
// One explicit scene bind-group layout is shared by every scene pipeline
// because COMMON declares bindings that individual pipelines do not read.

import { m4, v3 } from '../core/math.js';
import { surfaceModule, instancedModule, skyModule, lineModule, wireModule, postModule } from './shaders.js';
import { materialBuffer, MATERIAL_COUNT } from '../road/materials.js';
import { VERT_STRIDE } from '../core/mesh.js';
import { TextureBaker } from './texbake.js';

export const GLOBAL_FLOATS = 16 * 5 + 4 * 9; // 5 mat4 + 9 vec4
const SHADOW_SIZE = 2048;
const MAX_INSTANCES = 6144;
const MAX_LIGHTS = 1024;
const GRID_CELLS = 64;
const GRID_SLOTS = 8;
const MAX_LINE_VERTS = 65536;
const MAX_RP = 4096;

const VERTEX_LAYOUT = {
  arrayStride: VERT_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' },
    { shaderLocation: 3, offset: 32, format: 'float32x4' },
    { shaderLocation: 4, offset: 48, format: 'uint32x4' },
  ],
};
const SHADOW_VERTEX_LAYOUT = {
  arrayStride: VERT_STRIDE,
  attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
};
const LINE_LAYOUT = {
  arrayStride: 28,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x4' },
  ],
};

export class Renderer {
  constructor(device, context, canvas, format) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.format = format;
    this.sampleCount = 4;
    this.width = 1; this.height = 1;

    this.globals = new Float32Array(GLOBAL_FLOATS);
    this.globalBuf = device.createBuffer({
      label: 'globals', size: GLOBAL_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.matBuf = device.createBuffer({
      label: 'materials', size: MATERIAL_COUNT * 12 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.matBuf, 0, materialBuffer());

    this.rpBuf = device.createBuffer({
      label: 'roadParams', size: MAX_RP * 16 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.lightBuf = device.createBuffer({
      label: 'lights', size: MAX_LIGHTS * 16 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gridBuf = device.createBuffer({
      label: 'lightGrid', size: GRID_CELLS * GRID_CELLS * GRID_SLOTS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.instBuf = device.createBuffer({
      label: 'instances', size: MAX_INSTANCES * 24 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.lineBuf = device.createBuffer({
      label: 'lines', size: MAX_LINE_VERTS * 28,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.postBuf = device.createBuffer({
      label: 'post', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.gridData = new Uint32Array(GRID_CELLS * GRID_CELLS * GRID_SLOTS).fill(0xffffffff);
    this.gridOrigin = [-512, -512];
    this.gridCell = 16;

    this.baker = new TextureBaker(device);

    this.shadowTex = device.createTexture({
      label: 'shadow', size: [SHADOW_SIZE, SHADOW_SIZE, 2], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowViews = [0, 1].map((i) => this.shadowTex.createView({
      dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1,
    }));

    this.sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 16,
    });
    this.shadowSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.postSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.buildLayouts();
    this.buildPipelines();
    this.buildBindGroups();

    this.road = null;       // { vbuf, ibuf, count, wbuf, wcount }
    this.props = null;      // { vbuf, ibuf }
    this.propDraws = [];
    this.lineCount = 0;
    this.lightCount = 0;
    this.stats = { tris: 0, draws: 0, gpuMs: 0 };
  }

  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter found.');
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 268435456),
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 536870912),
      },
    });
    const context = canvas.getContext('webgpu');
    // Non-sRGB target: the post pass applies the transfer function manually.
    const format = 'rgba8unorm';
    context.configure({ device, format, alphaMode: 'opaque' });
    return new Renderer(device, context, canvas, format);
  }

  buildLayouts() {
    const d = this.device;
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.sceneLayout = d.createBindGroupLayout({
      label: 'scene',
      entries: [
        { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.instLayout = d.createBindGroupLayout({
      label: 'instances',
      entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }],
    });
    this.scenePL = d.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout] });
    this.instPL = d.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout, this.instLayout] });
  }

  buildPipelines() {
    const d = this.device;
    const hdr = 'rgba16float';
    const ms = { count: this.sampleCount };
    const depthOn = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };

    const surf = d.createShaderModule({ code: surfaceModule(), label: 'surface' });
    const inst = d.createShaderModule({ code: instancedModule(), label: 'instanced' });
    const sky = d.createShaderModule({ code: skyModule(), label: 'sky' });
    const line = d.createShaderModule({ code: lineModule(), label: 'line' });
    const post = d.createShaderModule({ code: postModule(), label: 'post' });
    this.modules = { surf, inst, sky, line, post };

    this.pipeSurface = d.createRenderPipeline({
      label: 'surface', layout: this.scenePL,
      vertex: { module: surf, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      fragment: { module: surf, entryPoint: 'fs', targets: [{ format: hdr }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthOn, multisample: ms,
    });
    this.pipeInstanced = d.createRenderPipeline({
      label: 'instanced', layout: this.instPL,
      vertex: { module: inst, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
      fragment: { module: inst, entryPoint: 'fs', targets: [{ format: hdr }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthOn, multisample: ms,
    });
    this.pipeSky = d.createRenderPipeline({
      label: 'sky', layout: this.scenePL,
      vertex: { module: sky, entryPoint: 'vs' },
      fragment: { module: sky, entryPoint: 'fs', targets: [{ format: hdr }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: ms,
    });
    this.pipeLine = d.createRenderPipeline({
      label: 'line', layout: this.scenePL,
      vertex: { module: line, entryPoint: 'vs', buffers: [LINE_LAYOUT] },
      fragment: {
        module: line, entryPoint: 'fs',
        targets: [{
          format: hdr,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: ms,
    });

    const wire = d.createShaderModule({ label: 'wire', code: wireModule() });
    this.pipeWire = d.createRenderPipeline({
      label: 'wire', layout: this.scenePL,
      vertex: {
        module: wire, entryPoint: 'vs',
        buffers: [{
          arrayStride: VERT_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: wire, entryPoint: 'fs',
        targets: [{
          format: hdr,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: ms,
    });

    const shadowDepth = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 3.0, depthBiasClamp: 0.01 };
    this.pipeShadowSurface = [0, 1].map((i) => d.createRenderPipeline({
      label: `shadow-surface-${i}`, layout: this.scenePL,
      vertex: { module: surf, entryPoint: `vsShadow${i}`, buffers: [SHADOW_VERTEX_LAYOUT] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: shadowDepth,
    }));
    this.pipeShadowInst = [0, 1].map((i) => d.createRenderPipeline({
      label: `shadow-inst-${i}`, layout: this.instPL,
      vertex: { module: inst, entryPoint: `vsShadow${i}`, buffers: [SHADOW_VERTEX_LAYOUT] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: shadowDepth,
    }));

    this.pipePost = d.createRenderPipeline({
      label: 'post', layout: 'auto',
      vertex: { module: post, entryPoint: 'vs' },
      fragment: { module: post, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  buildBindGroups() {
    const d = this.device;
    this.sceneBind = d.createBindGroup({
      label: 'scene', layout: this.sceneLayout,
      entries: [
        { binding: 0, resource: { buffer: this.globalBuf } },
        { binding: 1, resource: { buffer: this.matBuf } },
        { binding: 2, resource: { buffer: this.rpBuf } },
        { binding: 3, resource: { buffer: this.lightBuf } },
        { binding: 4, resource: { buffer: this.gridBuf } },
        { binding: 5, resource: this.baker.albedo.createView({ dimension: '2d-array' }) },
        { binding: 6, resource: this.baker.surf.createView({ dimension: '2d-array' }) },
        { binding: 7, resource: this.sampler },
        { binding: 8, resource: this.shadowTex.createView({ dimension: '2d-array' }) },
        { binding: 9, resource: this.shadowSampler },
      ],
    });
    this.instBind = d.createBindGroup({
      label: 'instances', layout: this.instLayout,
      entries: [{ binding: 0, resource: { buffer: this.instBuf } }],
    });
  }

  resize(w, h) {
    w = Math.max(2, w | 0); h = Math.max(2, h | 0);
    if (w === this.width && h === this.height && this.hdrTex) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    for (const t of [this.hdrTex, this.hdrResolve, this.depthTex]) t?.destroy();
    const msaa = this.sampleCount > 1;
    this.hdrTex = d.createTexture({
      label: 'hdr', size: [w, h], format: 'rgba16float', sampleCount: this.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (msaa ? 0 : GPUTextureUsage.TEXTURE_BINDING),
    });
    this.hdrResolve = msaa ? d.createTexture({
      label: 'hdr-resolve', size: [w, h], format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }) : null;
    this.depthTex = d.createTexture({
      label: 'depth', size: [w, h], format: 'depth32float', sampleCount: this.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.hdrView = this.hdrTex.createView();
    this.resolveView = this.hdrResolve ? this.hdrResolve.createView() : null;
    this.depthView = this.depthTex.createView();
    this.postBind = d.createBindGroup({
      layout: this.pipePost.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.resolveView || this.hdrView },
        { binding: 1, resource: this.postSampler },
        { binding: 2, resource: { buffer: this.postBuf } },
      ],
    });
  }

  /* ------------------------------------------------------------ uploads */

  setRoadMesh(mesh) {
    const d = this.device;
    this.road?.vbuf.destroy(); this.road?.ibuf.destroy(); this.road?.wbuf?.destroy();
    if (!mesh || mesh.vertexCount === 0) { this.road = null; return; }
    const vbuf = d.createBuffer({ size: align4(mesh.vertexData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, mesh.vertexData);
    const ibuf = d.createBuffer({ size: align4(mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, mesh.indices);
    let wbuf = null, wcount = 0;
    if (mesh.wire && mesh.wire.length) {
      wbuf = d.createBuffer({ size: align4(mesh.wire.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(wbuf, 0, mesh.wire);
      wcount = mesh.wire.length;
    }
    this.road = { vbuf, ibuf, count: mesh.indices.length, wbuf, wcount, verts: mesh.vertexCount };
  }

  setPropMesh(mesh) {
    const d = this.device;
    this.props?.vbuf.destroy(); this.props?.ibuf.destroy();
    if (!mesh || mesh.vertexCount === 0) { this.props = null; return; }
    const vbuf = d.createBuffer({ size: align4(mesh.vertexData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, mesh.vertexData);
    const ibuf = d.createBuffer({ size: align4(mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, mesh.indices);
    this.props = { vbuf, ibuf, count: mesh.indices.length };
  }

  setRoadParams(f32) {
    this.device.queue.writeBuffer(this.rpBuf, 0, f32, 0, Math.min(f32.length, MAX_RP * 16));
  }

  setInstances(f32, draws) {
    if (f32.length) this.device.queue.writeBuffer(this.instBuf, 0, f32, 0, Math.min(f32.length, MAX_INSTANCES * 24));
    this.propDraws = draws || [];
  }

  /** lights: [{pos:[x,y,z], range, color:[r,g,b], intensity, dir:[x,y,z]|null, outer, inner}] */
  setLights(lights) {
    const n = Math.min(lights.length, MAX_LIGHTS);
    const f = new Float32Array(n * 16);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      const o = i * 16;
      f[o] = L.pos[0]; f[o + 1] = L.pos[1]; f[o + 2] = L.pos[2]; f[o + 3] = L.range;
      f[o + 4] = L.color[0]; f[o + 5] = L.color[1]; f[o + 6] = L.color[2]; f[o + 7] = L.intensity;
      if (L.dir) {
        f[o + 8] = L.dir[0]; f[o + 9] = L.dir[1]; f[o + 10] = L.dir[2];
        f[o + 11] = Math.cos(L.outer ?? 1.2);
        f[o + 12] = Math.cos(L.inner ?? 0.7);
      } else {
        f[o + 11] = -1;
        f[o + 12] = 1;
      }
      f[o + 13] = L.kind || 0;
      minX = Math.min(minX, L.pos[0] - L.range); maxX = Math.max(maxX, L.pos[0] + L.range);
      minZ = Math.min(minZ, L.pos[2] - L.range); maxZ = Math.max(maxZ, L.pos[2] + L.range);
    }
    this.lightCount = n;
    if (n) this.device.queue.writeBuffer(this.lightBuf, 0, f);

    if (!n) { minX = minZ = -100; maxX = maxZ = 100; }
    const span = Math.max(maxX - minX, maxZ - minZ, 32) * 1.02;
    this.gridCell = span / GRID_CELLS;
    this.gridOrigin = [(minX + maxX) * 0.5 - span * 0.5, (minZ + maxZ) * 0.5 - span * 0.5];

    const g = this.gridData.fill(0xffffffff);
    const counts = new Uint8Array(GRID_CELLS * GRID_CELLS);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      const x0 = Math.max(0, Math.floor((L.pos[0] - L.range - this.gridOrigin[0]) / this.gridCell));
      const x1 = Math.min(GRID_CELLS - 1, Math.floor((L.pos[0] + L.range - this.gridOrigin[0]) / this.gridCell));
      const z0 = Math.max(0, Math.floor((L.pos[2] - L.range - this.gridOrigin[1]) / this.gridCell));
      const z1 = Math.min(GRID_CELLS - 1, Math.floor((L.pos[2] + L.range - this.gridOrigin[1]) / this.gridCell));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const c = z * GRID_CELLS + x;
          const k = counts[c];
          if (k >= GRID_SLOTS - 1) continue;
          g[c * GRID_SLOTS + k] = i;
          counts[c] = k + 1;
        }
      }
    }
    this.device.queue.writeBuffer(this.gridBuf, 0, g);
  }

  setLines(f32, count) {
    this.lineCount = count;
    if (count) this.device.queue.writeBuffer(this.lineBuf, 0, f32, 0, count * 7);
  }

  /* ------------------------------------------------------------- shadows */

  sunCascade(center, radius, sunDir, texel) {
    const dist = Math.max(radius * 3.0, 160);
    const up = Math.abs(sunDir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    // Origin-anchored light basis so the texel snap below is stable as the
    // camera moves (otherwise shadows crawl along edges).
    const view = m4.lookAt([sunDir[0] * dist, sunDir[1] * dist, sunDir[2] * dist], [0, 0, 0], up);
    const lc = m4.transformPoint(view, center);
    const unit = (radius * 2) / texel;
    const cx = Math.round(lc[0] / unit) * unit;
    const cy = Math.round(lc[1] / unit) * unit;
    const near = Math.max(1, -lc[2] - dist);
    const far = -lc[2] + dist + radius * 2;
    const proj = m4.ortho(cx - radius, cx + radius, cy - radius, cy + radius, near, far);
    return m4.mul(proj, view);
  }

  /* -------------------------------------------------------------- frame */

  render(state) {
    const d = this.device;
    const { camera, env, time } = state;
    const G = this.globals;
    const aspect = this.width / this.height;
    const proj = m4.perspective(camera.fov, aspect, 0.1, 6000);
    const view = m4.lookAt(camera.eye, camera.target, [0, 1, 0]);
    const viewProj = m4.mul(proj, view);
    const invVP = m4.invert(viewProj);

    const sunDir = env.sunDir;
    const c0 = this.cascadeCenter(camera, 70);
    const c1 = this.cascadeCenter(camera, 260);
    const s0 = this.sunCascade(c0, 48, sunDir, SHADOW_SIZE);
    const s1 = this.sunCascade(c1, 190, sunDir, SHADOW_SIZE);

    let o = 0;
    G.set(viewProj, o); o += 16;
    G.set(view, o); o += 16;
    G.set(invVP, o); o += 16;
    G.set(s0, o); o += 16;
    G.set(s1, o); o += 16;
    G.set([camera.eye[0], camera.eye[1], camera.eye[2], 1], o); o += 4;
    G.set([sunDir[0], sunDir[1], sunDir[2], env.sunIntensity], o); o += 4;
    G.set([env.sunColor[0], env.sunColor[1], env.sunColor[2], env.ambient], o); o += 4;
    G.set([env.exposure, env.night, env.cloudCover, time], o); o += 4;
    G.set([env.fogDensity, env.fogFalloff, env.fogStartY, env.wetness], o); o += 4;
    G.set([70, 280, 1 / SHADOW_SIZE, env.shadowBias], o); o += 4;
    G.set([this.gridOrigin[0], this.gridOrigin[1], this.gridCell, GRID_CELLS], o); o += 4;
    G.set([state.selected ?? -1, state.hover ?? -1, state.overlay ?? 0, state.markings ?? 1], o); o += 4;
    G.set([time, env.aoStrength, this.lightCount, env.quality ?? 1], o); o += 4;
    d.queue.writeBuffer(this.globalBuf, 0, G);
    d.queue.writeBuffer(this.postBuf, 0, new Float32Array([env.exposure, env.vignette, env.grain, time]));

    const enc = d.createCommandEncoder({ label: 'frame' });
    let draws = 0;

    // --- shadow cascades
    if (env.shadows) {
      for (let c = 0; c < 2; c++) {
        const pass = enc.beginRenderPass({
          label: `shadow${c}`,
          colorAttachments: [],
          depthStencilAttachment: {
            view: this.shadowViews[c], depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1.0,
          },
        });
        pass.setBindGroup(0, this.sceneBind);
        if (this.road) {
          pass.setPipeline(this.pipeShadowSurface[c]);
          pass.setVertexBuffer(0, this.road.vbuf);
          pass.setIndexBuffer(this.road.ibuf, 'uint32');
          pass.drawIndexed(this.road.count);
          draws++;
        }
        if (this.props && this.propDraws.length) {
          pass.setPipeline(this.pipeShadowInst[c]);
          pass.setBindGroup(1, this.instBind);
          pass.setVertexBuffer(0, this.props.vbuf);
          pass.setIndexBuffer(this.props.ibuf, 'uint32');
          for (const dr of this.propDraws) {
            if (!dr.instanceCount || dr.noShadow) continue;
            pass.drawIndexed(dr.indexCount, dr.instanceCount, dr.indexOffset, 0, dr.firstInstance);
            draws++;
          }
        }
        pass.end();
      }
    } else {
      for (let c = 0; c < 2; c++) {
        const pass = enc.beginRenderPass({
          colorAttachments: [],
          depthStencilAttachment: {
            view: this.shadowViews[c], depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1.0,
          },
        });
        pass.end();
      }
    }

    // --- main
    const color = {
      view: this.hdrView,
      resolveTarget: this.resolveView || undefined,
      loadOp: 'clear', storeOp: this.resolveView ? 'discard' : 'store',
      clearValue: { r: 0.02, g: 0.025, b: 0.035, a: 1 },
    };
    const pass = enc.beginRenderPass({
      label: 'main',
      colorAttachments: [color],
      depthStencilAttachment: {
        view: this.depthView, depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1.0,
      },
    });
    pass.setBindGroup(0, this.sceneBind);

    pass.setPipeline(this.pipeSky);
    pass.draw(3);
    draws++;

    if (this.road) {
      pass.setPipeline(this.pipeSurface);
      pass.setVertexBuffer(0, this.road.vbuf);
      pass.setIndexBuffer(this.road.ibuf, 'uint32');
      pass.drawIndexed(this.road.count);
      draws++;
      this.stats.tris = this.road.count / 3;
    }
    if (this.props && this.propDraws.length) {
      pass.setPipeline(this.pipeInstanced);
      pass.setBindGroup(1, this.instBind);
      pass.setVertexBuffer(0, this.props.vbuf);
      pass.setIndexBuffer(this.props.ibuf, 'uint32');
      for (const dr of this.propDraws) {
        if (!dr.instanceCount) continue;
        pass.drawIndexed(dr.indexCount, dr.instanceCount, dr.indexOffset, 0, dr.firstInstance);
        draws++;
      }
    }
    if (state.wireframe && this.road && this.road.wbuf) {
      pass.setPipeline(this.pipeWire);
      pass.setVertexBuffer(0, this.road.vbuf);
      pass.setIndexBuffer(this.road.wbuf, 'uint32');
      pass.drawIndexed(this.road.wcount);
      draws++;
    }
    if (this.lineCount) {
      pass.setPipeline(this.pipeLine);
      pass.setVertexBuffer(0, this.lineBuf);
      pass.draw(this.lineCount);
      draws++;
    }
    pass.end();

    // --- post
    const swap = this.context.getCurrentTexture().createView();
    const pp = enc.beginRenderPass({
      label: 'post',
      colorAttachments: [{ view: swap, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pp.setPipeline(this.pipePost);
    pp.setBindGroup(0, this.postBind);
    pp.draw(3);
    pp.end();

    d.queue.submit([enc.finish()]);
    this.stats.draws = draws;
  }

  cascadeCenter(camera, dist) {
    const fwd = v3.norm(v3.sub(camera.target, camera.eye));
    return [
      camera.eye[0] + fwd[0] * dist * 0.5,
      Math.max(camera.target[1], 0),
      camera.eye[2] + fwd[2] * dist * 0.5,
    ];
  }
}

function align4(n) { return (n + 3) & ~3; }

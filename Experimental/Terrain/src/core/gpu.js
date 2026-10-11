// WebGPU bootstrap + small helpers shared by the terrain engine, compositor and renderer.

export const BU = () => GPUBufferUsage;
export const TU = () => GPUTextureUsage;

export class GPUContext {
  static async create() {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was found.');
    const want = ['float32-filterable', 'timestamp-query', 'rg11b10ufloat-renderable'];
    const requiredFeatures = want.filter(f => adapter.features.has(f));
    const L = adapter.limits;
    const requiredLimits = {
      maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
      maxBufferSize: L.maxBufferSize,
      maxStorageBuffersPerShaderStage: Math.min(L.maxStorageBuffersPerShaderStage, 10),
      maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: Math.min(L.maxComputeInvocationsPerWorkgroup, 256),
      maxTextureDimension2D: L.maxTextureDimension2D,
    };
    const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
    const ctx = new GPUContext(adapter, device);
    return ctx;
  }

  constructor(adapter, device) {
    this.adapter = adapter;
    this.device = device;
    this.features = device.features;
    this.limits = device.limits;
    this.floatFilterable = device.features.has('float32-filterable');
    this.pipelines = new Map();
    this.errors = [];
    this.onError = null;
    device.addEventListener('uncapturederror', (e) => {
      const msg = e.error?.message || String(e.error);
      console.error('[WebGPU]', msg);
      this.errors.push(msg);
      this.onError?.(msg);
    });
    this.lost = device.lost.then((info) => {
      console.error('[WebGPU] device lost', info.message);
      this.onError?.('GPU device lost: ' + info.message);
      return info;
    });
    this.info = adapter.info || {};
  }

  maxResolution() {
    // Height + six attributes + four scratch maps, each N*N*4 bytes.
    const maxBuf = Math.min(this.limits.maxStorageBufferBindingSize, this.limits.maxBufferSize);
    let n = 4096;
    while (n > 256 && n * n * 4 > maxBuf) n >>= 1;
    return Math.min(n, this.limits.maxTextureDimension2D);
  }

  buffer(size, usage, label = '') {
    return this.device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, label });
  }

  storage(size, label = '', extra = 0) {
    return this.buffer(size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extra, label);
  }

  uniform(size, label = '') {
    return this.buffer(Math.ceil(size / 16) * 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label);
  }

  texture(desc) { return this.device.createTexture(desc); }

  write(buffer, data, offset = 0) {
    this.device.queue.writeBuffer(buffer, offset, data.buffer || data, data.byteOffset || 0, data.byteLength);
  }

  async module(code, label) {
    const m = this.device.createShaderModule({ code, label });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter(x => x.type === 'error');
    if (errs.length) {
      const lines = code.split('\n');
      const msg = errs.map(e => `${label}:${e.lineNum}:${e.linePos} ${e.message}\n    ${lines[e.lineNum - 1] ?? ''}`).join('\n');
      console.error(msg);
      throw new Error('WGSL compile error in ' + label + '\n' + msg);
    }
    return m;
  }

  // Compute pipelines are cached by label+code so repeated builds never recompile.
  async compute(code, label, entryPoint = 'main', constants) {
    const key = label + '|' + entryPoint + '|' + hashString(code) + (constants ? JSON.stringify(constants) : '');
    let p = this.pipelines.get(key);
    if (!p) {
      p = (async () => {
        const module = await this.module(code, label);
        return this.device.createComputePipelineAsync({ label, layout: 'auto', compute: { module, entryPoint, constants } });
      })();
      this.pipelines.set(key, p);
      p.catch(() => this.pipelines.delete(key));
    }
    return p;
  }

  bind(pipeline, resources, group = 0, label) {
    const entries = resources.map((r, i) => {
      if (r === null || r === undefined) return null;
      if (r instanceof GPUBuffer) return { binding: i, resource: { buffer: r } };
      if (r.buffer instanceof GPUBuffer) return { binding: i, resource: r };
      return { binding: i, resource: r };
    }).filter(Boolean);
    return this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(group), entries, label });
  }

  async read(buffer, size, offset = 0) {
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(buffer, offset, staging, 0, size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = staging.getMappedRange().slice(0);
    staging.unmap();
    staging.destroy();
    return out;
  }

  async idle() { await this.device.queue.onSubmittedWorkDone(); }
}

export function hashString(s) {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// Packs named f32/u32 fields into a uniform-compatible ArrayBuffer following declaration order.
// Every field is 4 bytes; the struct is padded to 16 bytes.
export class StructPacker {
  constructor(fields) {
    this.fields = fields; // [{name, type:'f32'|'u32'|'i32'}]
    this.size = Math.ceil(fields.length / 4) * 16 || 16;
    this.ab = new ArrayBuffer(this.size);
    this.f = new Float32Array(this.ab);
    this.u = new Uint32Array(this.ab);
    this.i = new Int32Array(this.ab);
    this.index = Object.fromEntries(fields.map((f, k) => [f.name, k]));
  }
  wgsl(structName) {
    const n = Math.ceil(this.fields.length / 4) * 4;
    const lines = this.fields.map(f => `  ${f.name}: ${f.type},`);
    for (let k = this.fields.length; k < n; k++) lines.push(`  _pad${k}: f32,`);
    if (!this.fields.length) lines.push('  _pad0: f32,', '  _pad1: f32,', '  _pad2: f32,', '  _pad3: f32,');
    return `struct ${structName} {\n${lines.join('\n')}\n}`;
  }
  set(name, v) {
    const k = this.index[name];
    if (k === undefined) return this;
    const t = this.fields[k].type;
    if (t === 'u32') this.u[k] = v >>> 0; else if (t === 'i32') this.i[k] = v | 0; else this.f[k] = +v;
    return this;
  }
  setAll(obj) { for (const k in obj) this.set(k, obj[k]); return this; }
}

export const wg = (n, s = 8) => Math.ceil(n / s);

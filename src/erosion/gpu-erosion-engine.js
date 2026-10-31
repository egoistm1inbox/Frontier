import {
  DEFAULT_EROSION_PARAMS,
  EMITTER_MODES,
  EROSION_LANDSCAPES,
  getVegetationDefaultsForLandscape,
} from './erosion-presets.js';
import {
  FULLSCREEN_VERT,
  GRASS_INSTANCE_FRAG,
  GRASS_INSTANCE_VERT,
  INIT_PARTICLES_FRAG,
  INIT_SNOW_FRAG,
  INIT_TERRAIN_FRAG,
  PARTICLE_RENDER_FRAG,
  PARTICLE_RENDER_VERT,
  PARTICLE_SCATTER_FRAG,
  PARTICLE_SCATTER_VERT,
  PARTICLE_STEP_FRAG,
  PROCEDURAL_MODIFIER_FRAG,
  ROCK_INSTANCE_FRAG,
  ROCK_INSTANCE_VERT,
  SKY_BG_FRAG,
  SNOW_CRYO_FRAG,
  TERRAIN_INTEGRATE_FRAG,
  TERRAIN_RENDER_FRAG,
  TERRAIN_RENDER_VERT,
  THERMAL_TALUS_FRAG,
  WATER_FLUX_FRAG,
} from './erosion-shaders.js';
import { MAX_GRASS_TUFTS, buildGrassTuftMesh } from './grass-system.js';
import { RockCalvingSystem } from './rock-calving.js';
import { TerrainStackPipeline } from './terrain-stack-pipeline.js';

const PART_TEX_W = 256;
const PART_TEX_H = 128; // 256 * 128 = 32,768 GPU particle slots
export const MAX_GPU_PARTICLES = PART_TEX_W * PART_TEX_H;

const TELEMETRY_RES = 64;

const TELEMETRY_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
layout(location = 0) out vec4 outStats;
uniform sampler2D uTerrainTex;
uniform float uGridRes;
void main() {
  ivec2 tc = clamp(ivec2(vUv * uGridRes), ivec2(0), ivec2(int(uGridRes) - 1));
  outStats = texelFetch(uTerrainTex, tc, 0);
}
`;

function compileShader(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[GPU Erosion ${label}] Shader compile error:\n${log}`);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc, label) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, `${label}:VS`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}:FS`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`[GPU Erosion ${label}] Program link error:\n${log}`);
  }
  return prog;
}

function createDataTexture(gl, w, h, internalFormat, format, type) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function createFbo(gl, textures) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const drawBuffers = [];
  for (let i = 0; i < textures.length; i++) {
    const att = gl.COLOR_ATTACHMENT0 + i;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, att, gl.TEXTURE_2D, textures[i], 0);
    drawBuffers.push(att);
  }
  gl.drawBuffers(drawBuffers);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Incomplete WebGL2 FBO: 0x${status.toString(16)}`);
  }
  return fbo;
}

export class GpuErosionEngine {
  constructor(canvas, onTelemetry = null) {
    this.canvas = canvas;
    this.onTelemetry = onTelemetry;

    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error('WebGL2 is required for GPU Particle Erosion.');
    }
    this.gl = gl;

    const extColorFloat = gl.getExtension('EXT_color_buffer_float');
    if (!extColorFloat) {
      throw new Error('EXT_color_buffer_float is required for float32 GPGPU erosion.');
    }
    this.hasFloatBlend = Boolean(gl.getExtension('EXT_float_blend'));
    gl.getExtension('OES_texture_float_linear');

    this.params = { ...DEFAULT_EROSION_PARAMS };
    this.gridRes = this.params.gridSize; // 512

    this.active = false;   // Whether this viewport tab is visible
    this.playing = true;   // Whether simulation steps advance each frame
    this.stepCount = 0;
    this.startTimeMs = performance.now();
    this.fps = 60;
    this._fpsFrames = 0;
    this._fpsLastMs = performance.now();

    this.telemetry = {
      steps: 0,
      particles: this.params.particleCount,
      erodedVolumeM3: 0,
      coarseSedM3: 0,
      fineSedM3: 0,
      waterVolumeM3: 0,
      boulders: 0,
      fps: 60,
    };

    // Camera state (Unreal WASD + Q/E Free-Fly + RMB Free-Look + LMB Orbit)
    this.camera = {
      yaw: 0.42,
      pitch: 0.46,
      distance: 740.0,
      target: [0, 54, 0],
      fovDeg: 44,
      flySpeed: 175.0,
    };
    this._keysDown = new Set();
    this._rmbDown = false;
    this._lastFrameMs = performance.now();

    // Storm & Interactive Brush state in world XZ coordinates
    this.stormTarget = [0, 0];
    this.pointerWorldXZ = [0, 0];
    this.brushDown = false;

    this.rockCalving = new RockCalvingSystem();

    this._initPrograms();
    this._initBuffersAndTextures();
    this._initMeshVao();
    this._initRockInstanceVao();
    this._initGrassInstanceVao();
    this._bindEvents();

    Object.assign(this.params, getVegetationDefaultsForLandscape(this.params.landscape));

    // Non-Destructive Bottom-to-Top Terrain Stack Pipeline (Landforms + SDF Caves + Simulation + Placements)
    this.pipelineMode = true;
    this.playing = true;
    this.pipeline = new TerrainStackPipeline(this);
  }

  _initPrograms() {
    const gl = this.gl;
    this.progInitTerrain = createProgram(gl, FULLSCREEN_VERT, INIT_TERRAIN_FRAG, 'InitTerrain');
    this.progProceduralMod = createProgram(gl, FULLSCREEN_VERT, PROCEDURAL_MODIFIER_FRAG, 'ProceduralModifier');
    this.progInitSnow = createProgram(gl, FULLSCREEN_VERT, INIT_SNOW_FRAG, 'InitSnow');
    this.progInitParticles = createProgram(gl, FULLSCREEN_VERT, INIT_PARTICLES_FRAG, 'InitParticles');
    this.progParticleStep = createProgram(gl, FULLSCREEN_VERT, PARTICLE_STEP_FRAG, 'ParticleStep');
    this.progParticleScatter = createProgram(gl, PARTICLE_SCATTER_VERT, PARTICLE_SCATTER_FRAG, 'ParticleScatter');
    this.progWaterFlux = createProgram(gl, FULLSCREEN_VERT, WATER_FLUX_FRAG, 'WaterFlux');
    this.progTerrainIntegrate = createProgram(gl, FULLSCREEN_VERT, TERRAIN_INTEGRATE_FRAG, 'TerrainIntegrate');
    this.progSnowCryo = createProgram(gl, FULLSCREEN_VERT, SNOW_CRYO_FRAG, 'SnowCryo');
    this.progThermalTalus = createProgram(gl, FULLSCREEN_VERT, THERMAL_TALUS_FRAG, 'ThermalTalus');
    this.progTerrainRender = createProgram(gl, TERRAIN_RENDER_VERT, TERRAIN_RENDER_FRAG, 'TerrainRender');
    this.progRockInstance = createProgram(gl, ROCK_INSTANCE_VERT, ROCK_INSTANCE_FRAG, 'RockInstance');
    this.progGrassInstance = createProgram(gl, GRASS_INSTANCE_VERT, GRASS_INSTANCE_FRAG, 'GrassInstance');
    this.progParticleRender = createProgram(gl, PARTICLE_RENDER_VERT, PARTICLE_RENDER_FRAG, 'ParticleRender');
    this.progSkyBg = createProgram(gl, FULLSCREEN_VERT, SKY_BG_FRAG, 'SkyBg');
    this.progTelemetry = createProgram(gl, FULLSCREEN_VERT, TELEMETRY_FRAG, 'Telemetry');
  }

  _initBuffersAndTextures() {
    const gl = this.gl;
    const R = this.gridRes;

    this.emptyVao = gl.createVertexArray();

    // Terrain ping-pong (RGBA32F: bedrock, coarseSed, fineSed, water)
    this.terrainTex = [
      createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    this.terrainIdx = 0;

    // Initial un-eroded snapshot for cut/fill heatmap & cubic-meter telemetry
    this.initialTerrainTex = createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.fboInitialTerrain = createFbo(gl, [this.initialTerrainTex]);

    // Pipe flux ping-pong (RGBA32F)
    this.fluxTex = [
      createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    this.fluxIdx = 0;
    this.fboFlux = [
      createFbo(gl, [this.fluxTex[0]]),
      createFbo(gl, [this.fluxTex[1]]),
    ];

    // Eulerian velocity & discharge field (RGBA32F)
    this.velocityFieldTex = createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT);

    // Cryosphere ping-pong (RGBA32F: snowpack depth, glacier ice thickness, prev snow, ice melt)
    this.snowTex = [
      createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      createDataTexture(gl, R, R, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    this.snowIdx = 0;
    this.fboSnowClear = [
      createFbo(gl, [this.snowTex[0]]),
      createFbo(gl, [this.snowTex[1]]),
    ];

    // Terrain single & MRT FBOs
    this.fboTerrainSingle = [
      createFbo(gl, [this.terrainTex[0]]),
      createFbo(gl, [this.terrainTex[1]]),
    ];
    this.fboTerrainIntegrate = [
      createFbo(gl, [this.terrainTex[0], this.velocityFieldTex]),
      createFbo(gl, [this.terrainTex[1], this.velocityFieldTex]),
    ];

    // Additive particle scatter target: RGBA32F when EXT_float_blend is supported, RGBA16F fallback otherwise!
    const scatterInternal = this.hasFloatBlend ? gl.RGBA32F : gl.RGBA16F;
    const scatterType = this.hasFloatBlend ? gl.FLOAT : gl.HALF_FLOAT;
    this.deltaTex = createDataTexture(gl, R, R, scatterInternal, gl.RGBA, scatterType);
    this.snowDeltaTex = createDataTexture(gl, R, R, scatterInternal, gl.RGBA, scatterType);
    this.fboDelta = createFbo(gl, [this.deltaTex, this.snowDeltaTex]);

    // 32,768 GPU Particle Ping-Pong Textures (256 x 128 RGBA32F)
    this.partPosAge = [
      createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    this.partVelWater = [
      createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    this.partSediment = [
      createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    ];
    this.partExchange = createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.partExchange2 = createDataTexture(gl, PART_TEX_W, PART_TEX_H, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.partIdx = 0;

    this.fboInitParticles = [
      createFbo(gl, [this.partPosAge[0], this.partVelWater[0], this.partSediment[0]]),
      createFbo(gl, [this.partPosAge[1], this.partVelWater[1], this.partSediment[1]]),
    ];
    this.fboStepParticles = [
      createFbo(gl, [this.partPosAge[0], this.partVelWater[0], this.partSediment[0], this.partExchange, this.partExchange2]),
      createFbo(gl, [this.partPosAge[1], this.partVelWater[1], this.partSediment[1], this.partExchange, this.partExchange2]),
    ];

    // Tiny 64x64 telemetry downsample FBO (sampled only once every 36 steps -> zero frame stall!)
    this.telemetryTex = createDataTexture(gl, TELEMETRY_RES, TELEMETRY_RES, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.fboTelemetry = createFbo(gl, [this.telemetryTex]);
    this.telemetryBuf = new Float32Array(TELEMETRY_RES * TELEMETRY_RES * 4);
    this.initialSnap64 = new Float32Array(TELEMETRY_RES * TELEMETRY_RES * 4);
  }

  _initMeshVao() {
    const gl = this.gl;
    // Build a (R + 2) x (R + 2) grid where outer 1-vertex border has UV slightly outside [0, 1]
    // so TERRAIN_RENDER_VERT drops the outer ring cleanly to y = 0 as a solid geological block plinth!
    const N = this.gridRes;
    const M = N + 2;
    const uvs = new Float32Array(M * M * 2);
    let ptr = 0;
    for (let z = 0; z < M; z++) {
      const v = z === 0 ? -0.002 : z === M - 1 ? 1.002 : (z - 1) / (N - 1);
      for (let x = 0; x < M; x++) {
        const u = x === 0 ? -0.002 : x === M - 1 ? 1.002 : (x - 1) / (N - 1);
        uvs[ptr++] = u;
        uvs[ptr++] = v;
      }
    }

    const quadCount = (M - 1) * (M - 1);
    const indices = new Uint32Array(quadCount * 6);
    let ip = 0;
    for (let z = 0; z < M - 1; z++) {
      for (let x = 0; x < M - 1; x++) {
        const i00 = z * M + x;
        const i10 = i00 + 1;
        const i01 = i00 + M;
        const i11 = i01 + 1;
        indices[ip++] = i00;
        indices[ip++] = i01;
        indices[ip++] = i10;
        indices[ip++] = i10;
        indices[ip++] = i01;
        indices[ip++] = i11;
      }
    }

    this.terrainIndexCount = indices.length;
    this.terrainVao = gl.createVertexArray();
    gl.bindVertexArray(this.terrainVao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  _initRockInstanceVao() {
    const gl = this.gl;
    const atlas = this.rockCalving.atlas;
    this.rockVao = gl.createVertexArray();
    gl.bindVertexArray(this.rockVao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, atlas.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, atlas.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const mskBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mskBuf);
    gl.bufferData(gl.ARRAY_BUFFER, atlas.masks, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);

    this.rockInstVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rockInstVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 320 * 16 * 4, gl.DYNAMIC_DRAW);
    const stride = 16 * 4;
    for (let k = 0; k < 4; k++) {
      const loc = 3 + k;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, k * 16);
      gl.vertexAttribDivisor(loc, 1);
    }

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, atlas.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  _initGrassInstanceVao() {
    const gl = this.gl;
    const tuft = buildGrassTuftMesh();
    this.grassIndexCount = tuft.indexCount;
    this.grassVao = gl.createVertexArray();
    gl.bindVertexArray(this.grassVao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tuft.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tuft.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const metaBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tuft.bladeMeta, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tuft.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  triggerBoulderCalving(count = 24) {
    const spawned = this.rockCalving.calveCliffBoulders(count);
    this.rockCalving._rebuildInstanceBuckets();
    this.telemetry.boulders = this.rockCalving.rocks.length;
    if (this.onTelemetry) this.onTelemetry(this.telemetry);
    return spawned;
  }

  _bindEvents() {
    const el = this.canvas;
    let dragging = false;
    let button = 0;
    let lastX = 0;
    let lastY = 0;

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      dragging = true;
      button = e.button;
      if (button === 2) this._rmbDown = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);

      const hit = this._raycastPlaneXZ(e.clientX, e.clientY);
      if (hit) this.pointerWorldXZ = hit;

      const pipeTool = this.pipelineMode && this.pipeline ? this.pipeline.authorTool : 'navigate';
      const isPipeSculpt =
        button === 0 &&
        !e.altKey &&
        (pipeTool.startsWith('sculpt-') || pipeTool.startsWith('cave-'));

      if (isPipeSculpt && hit) {
        this.brushDown = true;
        this.pipeline.applySculptStroke(hit[0], hit[1], true);
        if (this.onStackMutated) this.onStackMutated();
        return;
      }

      const isToolStroke =
        button === 0 &&
        (e.shiftKey || (this.params.brushMode && this.params.brushMode !== 'orbit'));
      if (isToolStroke && hit) {
        this.brushDown = true;
        if (this.params.brushMode === 'cloudburst' || e.shiftKey) {
          this.stormTarget = [hit[0], hit[1]];
        }
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const hit = this._raycastPlaneXZ(e.clientX, e.clientY);
      if (hit) {
        this.pointerWorldXZ = hit;
        const pipeTool = this.pipelineMode && this.pipeline ? this.pipeline.authorTool : 'navigate';
        if (this.brushDown && (pipeTool.startsWith('sculpt-') || pipeTool.startsWith('cave-'))) {
          this.pipeline.applySculptStroke(hit[0], hit[1], false);
          return;
        }
        if (this.brushDown && (this.params.brushMode === 'cloudburst' || e.shiftKey)) {
          this.stormTarget = [hit[0], hit[1]];
        }
      }

      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (this.brushDown) return;

      if (button === 2) {
        // Unreal Engine RMB Free-Look Mouselook: rotate yaw & pitch around current eye!
        const { eye } = this._getCameraBasis();
        this.camera.yaw -= dx * 0.0046;
        this.camera.pitch = Math.max(-1.42, Math.min(1.48, this.camera.pitch + dy * 0.0044));
        const cp = Math.cos(this.camera.pitch);
        const sp = Math.sin(this.camera.pitch);
        const cy = Math.cos(this.camera.yaw);
        const sy = Math.sin(this.camera.yaw);
        const fx = -cp * sy;
        const fy = -sp;
        const fz = -cp * cy;
        this.camera.target[0] = eye[0] + fx * this.camera.distance;
        this.camera.target[1] = eye[1] + fy * this.camera.distance;
        this.camera.target[2] = eye[2] + fz * this.camera.distance;
      } else if (button === 1 || (button === 0 && e.altKey)) {
        const panScale = Math.max(40, this.camera.distance) * 0.0014;
        const { right, up } = this._getCameraBasis();
        this.camera.target[0] -= (right[0] * dx - up[0] * dy) * panScale;
        this.camera.target[1] -= (right[1] * dx - up[1] * dy) * panScale;
        this.camera.target[2] -= (right[2] * dx - up[2] * dy) * panScale;
      } else if (button === 0) {
        this.camera.yaw -= dx * 0.0065;
        this.camera.pitch = Math.max(-0.35, Math.min(1.48, this.camera.pitch + dy * 0.006));
      }
    });

    const endDrag = (e) => {
      dragging = false;
      if (!e || e.button === 2) this._rmbDown = false;
      this.brushDown = false;
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        if (this._rmbDown) {
          // Unreal Engine RMB + Scroll adjusts WASD fly speed!
          const speedMul = Math.exp(-e.deltaY * 0.0012);
          this.camera.flySpeed = Math.max(30, Math.min(900, this.camera.flySpeed * speedMul));
          return;
        }
        const factor = Math.exp(e.deltaY * 0.0011);
        this.camera.distance = Math.max(14, Math.min(1450, this.camera.distance * factor));
      },
      { passive: false }
    );

    // Unreal Engine WASD + Q/E + Shift Free-Fly Keyboard Navigation
    const flyCodes = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight',
    ]);
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.metaKey || e.ctrlKey) return;
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      const activeType = document.activeElement ? (document.activeElement.type || '') : '';
      if (activeTag === 'TEXTAREA' || (activeTag === 'INPUT' && activeType !== 'range' && activeType !== 'checkbox')) {
        return;
      }
      if (activeTag === 'SELECT' && e.code.startsWith('Arrow')) return;
      if (flyCodes.has(e.code)) {
        if (activeTag === 'INPUT' && activeType === 'range' && e.code.startsWith('Key')) {
          document.activeElement.blur();
        }
        this._keysDown.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this._keysDown.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this._keysDown.clear();
      this._rmbDown = false;
    });
  }

  _stepWasdCamera(dtSec) {
    if (this._keysDown.size === 0) return;
    const k = this._keysDown;
    let moveFwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let moveRight = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let moveUp = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (moveFwd === 0 && moveRight === 0 && moveUp === 0) return;

    const turbo = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 3.2 : 1.0;
    const speed = (this.camera.flySpeed || 175.0) * turbo * Math.min(0.08, Math.max(0.001, dtSec));
    const { forward, right } = this._getCameraBasis();

    let dx = forward[0] * moveFwd + right[0] * moveRight;
    let dy = forward[1] * moveFwd + right[1] * moveRight + moveUp;
    let dz = forward[2] * moveFwd + right[2] * moveRight;
    const mag = Math.hypot(dx, dy, dz);
    if (mag > 1.0) {
      dx /= mag; dy /= mag; dz /= mag;
    }

    this.camera.target[0] += dx * speed;
    this.camera.target[1] += dy * speed;
    this.camera.target[2] += dz * speed;

    // Prevent eye from dipping below y = 4m plinth base while allowing low-altitude canyon flight!
    const { eye } = this._getCameraBasis();
    if (eye[1] < 4.0) {
      this.camera.target[1] += (4.0 - eye[1]);
    }
  }

  _raycastPlaneXZ(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;

    const { eye, forward, right, up } = this._getCameraBasis();
    const aspect = rect.width / rect.height;
    const tanHalf = Math.tan((this.camera.fovDeg * Math.PI) / 360);

    let dirX = forward[0] + right[0] * ndcX * aspect * tanHalf + up[0] * ndcY * tanHalf;
    let dirY = forward[1] + right[1] * ndcX * aspect * tanHalf + up[1] * ndcY * tanHalf;
    let dirZ = forward[2] + right[2] * ndcX * aspect * tanHalf + up[2] * ndcY * tanHalf;
    const dl = Math.hypot(dirX, dirY, dirZ) || 1;
    dirX /= dl; dirY /= dl; dirZ /= dl;

    const half = this.params.worldSpan * 0.5;
    // Fast 24-step 3D terrain heightfield raymarch + binary refinement so sculpt/cave/spline hits exact cliff & ridge surfaces!
    if (this.rockCalving && this.rockCalving.snapGrid) {
      let prevT = 10.0;
      let prevDiff = 1.0;
      for (let s = 1; s <= 28; s++) {
        const t = 10.0 + (s / 28.0) * 1650.0;
        const rx = eye[0] + dirX * t;
        const ry = eye[1] + dirY * t;
        const rz = eye[2] + dirZ * t;
        if (Math.abs(rx) <= half * 1.15 && Math.abs(rz) <= half * 1.15) {
          const st = this.rockCalving.sampleTerrain(rx, rz);
          const diff = ry - st.surfaceH;
          if (diff <= 0.0 && prevDiff > 0.0) {
            const hitT = prevT + (t - prevT) * (prevDiff / Math.max(1e-4, prevDiff - diff));
            const wx = Math.max(-half, Math.min(half, eye[0] + dirX * hitT));
            const wz = Math.max(-half, Math.min(half, eye[2] + dirZ * hitT));
            return [wx, wz];
          }
          prevDiff = diff;
          prevT = t;
        }
      }
    }

    const refY = this.params.relief * 0.35;
    if (Math.abs(dirY) < 1e-4) return null;
    const t = (refY - eye[1]) / dirY;
    if (t < 0) return null;

    const wx = Math.max(-half, Math.min(half, eye[0] + dirX * t));
    const wz = Math.max(-half, Math.min(half, eye[2] + dirZ * t));
    return [wx, wz];
  }

  _getCameraBasis() {
    const { yaw, pitch, distance, target } = this.camera;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);

    const eye = [
      target[0] + distance * cp * sy,
      target[1] + distance * sp,
      target[2] + distance * cp * cy,
    ];
    let fx = target[0] - eye[0];
    let fy = target[1] - eye[1];
    let fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;

    // right = normalize(cross(forward, worldUp))
    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; rz /= rl;

    // up = cross(right, forward)
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    return {
      eye,
      forward: [fx, fy, fz],
      right: [rx, ry, rz],
      up: [ux, uy, uz],
    };
  }

  _buildViewProjMatrix(aspect) {
    const { eye, forward, right, up } = this._getCameraBasis();
    const f = 1.0 / Math.tan((this.camera.fovDeg * Math.PI) / 360);
    const near = 2.0;
    const far = 3200.0;
    const nf = 1.0 / (near - far);

    // View matrix (column-major)
    const v0 = right[0], v4 = right[1], v8 = right[2],  v12 = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
    const v1 = up[0],    v5 = up[1],    v9 = up[2],     v13 = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
    const v2 = -forward[0], v6 = -forward[1], v10 = -forward[2], v14 = (forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2]);

    const p0 = f / Math.max(aspect, 0.1);
    const p5 = f;
    const p10 = (far + near) * nf;
    const p14 = 2 * far * near * nf;

    const out = new Float32Array(16);
    out[0] = p0 * v0;  out[4] = p0 * v4;  out[8]  = p0 * v8;  out[12] = p0 * v12;
    out[1] = p5 * v1;  out[5] = p5 * v5;  out[9]  = p5 * v9;  out[13] = p5 * v13;
    out[2] = p10 * v2; out[6] = p10 * v6; out[10] = p10 * v10; out[14] = p10 * v14 + p14;
    out[3] = -v2;      out[7] = -v6;      out[11] = -v10;      out[15] = -v14;
    return { viewProj: out, eye };
  }

  _themeCode() {
    const theme = Number(this.params.materialTheme);
    return Number.isFinite(theme) ? Math.max(0, Math.min(9, Math.round(theme))) : 0;
  }

  _fabricCode() {
    const fab = Number(this.params.fabricMode);
    return Number.isFinite(fab) ? Math.max(0, Math.min(4, Math.round(fab))) : 0;
  }

  _getHardnessUniforms() {
    const p = this.params;
    const strikeRad = (p.strataStrike * Math.PI) / 180;
    const dipRad = (p.strataDip * Math.PI) / 180;
    const strataStr = p.strataLayerEnabled === false ? 0.0 : p.strataStrength;
    return {
      hardnessVec: [p.rockHardness, strataStr, p.strataFreq, p.faultWeakness],
      strataVec: [Math.sin(strikeRad), Math.cos(strikeRad), Math.tan(dipRad), Math.max(40, p.relief)],
    };
  }

  _getLayerVisUniforms() {
    const p = this.params;
    return [
      p.lithologyLayerEnabled === false ? 0.0 : (p.lithologyOpacity ?? 1.0),
      p.fabricLayerEnabled === false ? 0.0 : (p.fabricStrength ?? 1.0),
      p.snowLayerEnabled === false ? 0.0 : (p.snowVisOpacity ?? 1.0),
      (p.waterLayerEnabled === false || !p.showWater) ? 0.0 : (p.waterVisOpacity ?? 1.0),
    ];
  }

  /**
   * Derives the multi-agent particle species mix (rain / snow / wind / rockfall) plus the
   * wind vector from the active emitter mode and climate sliders.
   */
  _getClimateUniforms() {
    const p = this.params;
    const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    const snowPossible = clamp01(p.snowfallRate) * (1.0 - clamp01((p.snowline - 0.10) / 0.95));

    let rain = 1, snow = 0, wind = 0, rock = 0;
    if (p.emitterMode === 'glacial-blizzard') {
      rain = 0.20 + 0.25 * (1.0 - snowPossible);
      snow = 0.95 + 0.45 * snowPossible;
      wind = 0.22 + 0.30 * clamp01(p.windSpeed);
      rock = 0.05 + 0.14 * clamp01(p.rockfallRate);
    } else if (p.emitterMode === 'aeolian-wind') {
      rain = (p.dryAeolianMode || 0) > 0.35 ? 0.0 : 0.05;
      snow = 0.05 * snowPossible;
      wind = 1.05 + 0.45 * clamp01(p.windSpeed);
      rock = (p.rockfallRate || 0) > 0.28 ? (0.06 + 0.20 * clamp01(p.rockfallRate)) : 0.0;
    } else if (p.emitterMode === 'rockfall-avalanche') {
      rain = (p.dryAeolianMode || 0) > 0.5 ? 0.0 : 0.05;
      snow = 0.03 * snowPossible;
      wind = p.windSpeed > 0.02 ? 0.10 : 0.0;
      rock = 1.00 + 0.65 * clamp01(p.rockfallRate);
    } else if (p.emitterMode === 'storm-cell') {
      rain = 0.90;
      snow = 0.12 * snowPossible;
      wind = 0.14;
      rock = 0.03;
    } else if (p.emitterMode === 'sky-rain') {
      rain = 1.0;
      snow = 0.0;
      wind = 0.0;
      rock = 0.0;
    } else {
      // 'all-weather' multi-agent synchronized mix
      rain = 0.58;
      snow = 0.60 * snowPossible;
      wind = 0.22 + 0.34 * clamp01(p.windSpeed);
      rock = 0.14 + 0.30 * clamp01(p.rockfallRate);
    }

    // Independent Simulation Layer Play/Pause Gating: allows running all active simulations
    // simultaneously OR soloing/pausing Hydraulic, Cryo, Wind, or Rockfall one at a time!
    if (p.simHydraulicPlaying === false) rain = 0.0;
    if (p.simCryoPlaying === false) snow = 0.0;
    if (p.simWindPlaying === false) wind = 0.0;
    if (p.simRockfallPlaying === false) rock = 0.0;

    const rawSum = rain + snow + wind + rock;
    const sum = Math.max(1e-4, rawSum);
    const azRad = (p.windAzimuth * Math.PI) / 180;
    const windMag = 0.35 + 0.65 * clamp01(p.windSpeed);
    const activeWind = p.simWindPlaying === false ? 0.0 : clamp01(p.windSpeed);
    const activeSnow = p.simCryoPlaying === false ? 0.0 : clamp01(p.snowfallRate);
    return {
      anySimActive: rawSum > 1e-4 || p.simHydraulicPlaying !== false || p.simCryoPlaying !== false || p.simWindPlaying !== false || p.simRockfallPlaying !== false,
      anyParticleSpecies: rawSum > 1e-4,
      speciesVec: rawSum > 1e-4 ? [rain / sum, snow / sum, wind / sum, rock / sum] : [0, 0, 0, 0],
      snowVec: [p.snowline, activeSnow, p.simCryoPlaying === false ? 0.0 : clamp01(p.glacierStrength), 0.35 + 0.9 * activeSnow],
      windVec: [Math.cos(azRad) * windMag, Math.sin(azRad) * windMag, p.simWindPlaying === false ? 0.0 : (0.25 + 0.95 * activeWind), 0.35 + 0.65 * activeWind],
      materialTheme: Number.isFinite(p.materialTheme) ? p.materialTheme : 0,
    };
  }

  applyLandscapePreset(landscapeId) {
    const prevWasLunar = this.params.landscape === 'lunar-mare-craters';
    const preset = EROSION_LANDSCAPES[landscapeId] || EROSION_LANDSCAPES['layered-plateau'];
    const keep = {
      seed: this.params.seed,
      particleCount: this.params.particleCount,
      substepsPerFrame: this.params.substepsPerFrame,
      showParticles: this.params.showParticles,
      showWater: prevWasLunar ? true : this.params.showWater,
      showOutcrops: this.params.showOutcrops,
      viewMode: this.params.viewMode,
      brushMode: this.params.brushMode,
      brushRadius: this.params.brushRadius,
      simHydraulicPlaying: this.params.simHydraulicPlaying,
      simCryoPlaying: this.params.simCryoPlaying,
      simWindPlaying: this.params.simWindPlaying,
      simRockfallPlaying: this.params.simRockfallPlaying,
    };
    const vegDefaults = getVegetationDefaultsForLandscape(preset.id);
    Object.assign(this.params, DEFAULT_EROSION_PARAMS, vegDefaults, preset.defaults, keep);
    this.params.proceduralModifiers = [];
    this.params.materialTheme = preset.defaults.materialTheme ?? preset.materialTheme ?? 0;
    this.params.fabricMode = preset.defaults.fabricMode ?? preset.fabricMode ?? 0;
    if (preset.defaults.showWater !== undefined) {
      this.params.showWater = preset.defaults.showWater;
    }
    this.params.landscape = preset.id;
    this.resetSimulation();
  }

  resetCamera() {
    this.camera.yaw = 0.42;
    this.camera.pitch = 0.46;
    this.camera.distance = 740.0;
    this.camera.target = [0, this.params.relief * 0.30, 0];
  }

  resetSimulation() {
    const gl = this.gl;
    const R = this.gridRes;
    const p = this.params;
    const preset = EROSION_LANDSCAPES[p.landscape] || EROSION_LANDSCAPES['layered-plateau'];

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);

    // 1. Generate Initial Bedrock Terrain into terrainTex[0] AND initialTerrainTex
    gl.useProgram(this.progInitTerrain);
    gl.uniform4f(
      gl.getUniformLocation(this.progInitTerrain, 'uInitParams'),
      p.relief,
      p.roughness,
      preset.terrainType,
      p.seed
    );
    gl.uniform1f(gl.getUniformLocation(this.progInitTerrain, 'uWorldSpan'), p.worldSpan);

    gl.viewport(0, 0, R, R);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSingle[0]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.terrainIdx = 0;

    // 1B. Non-destructively evaluate any user-added Procedural Shape Modifier Layers!
    // When proceduralModifiers is empty (default for all 19 presets), zero passes run -> 100% bit-exact output!
    const mods = Array.isArray(p.proceduralModifiers) ? p.proceduralModifiers : [];
    for (let m = 0; m < mods.length; m++) {
      const mod = mods[m];
      if (!mod || mod.enabled === false || (mod.strength ?? 1.0) <= 0.001) continue;
      const nextT = 1 - this.terrainIdx;
      gl.useProgram(this.progProceduralMod);
      this._bindTex(this.progProceduralMod, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
      gl.uniform4f(
        gl.getUniformLocation(this.progProceduralMod, 'uModShape'),
        mod.amplitude ?? 48.0,
        mod.scale ?? 2.2,
        mod.detail ?? 0.55,
        mod.angle ?? 25.0
      );
      gl.uniform4f(
        gl.getUniformLocation(this.progProceduralMod, 'uModBlend'),
        mod.strength ?? 0.85,
        mod.blendMode ?? 0,
        mod.maskType ?? 0,
        mod.seed ?? 4029
      );
      gl.uniform4f(
        gl.getUniformLocation(this.progProceduralMod, 'uModMask'),
        mod.maskLow ?? 0.0,
        mod.maskHigh ?? 1.0,
        mod.maskInvert ? 1.0 : 0.0,
        mod.kind ?? 0
      );
      gl.uniform1f(gl.getUniformLocation(this.progProceduralMod, 'uWorldSpan'), p.worldSpan);
      gl.uniform1f(gl.getUniformLocation(this.progProceduralMod, 'uGridRes'), R);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSingle[nextT]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.terrainIdx = nextT;
    }

    // Copy final initial terrain into initialTerrainTex for Cut/Fill telemetry & view mode
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboTerrainSingle[this.terrainIdx]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboInitialTerrain);
    gl.blitFramebuffer(0, 0, R, R, 0, 0, R, R, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    // 2. Clear shallow-water flux & seed initial mountain snowpack + valley glaciers (`progInitSnow`)
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFlux[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.fluxIdx = 0;

    const { strataVec } = this._getHardnessUniforms();
    const climate = this._getClimateUniforms();
    const cellSize = p.worldSpan / R;
    gl.viewport(0, 0, R, R);
    gl.useProgram(this.progInitSnow);
    this._bindTex(this.progInitSnow, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
    gl.uniform4f(gl.getUniformLocation(this.progInitSnow, 'uCryoParams'), R, cellSize, 0.085, p.worldSpan);
    gl.uniform4fv(gl.getUniformLocation(this.progInitSnow, 'uClimate'), [p.snowline, Math.max(0, Math.min(1, p.snowfallRate || 0)), Math.max(0, Math.min(1, p.glacierStrength || 0)), 0.8]);
    gl.uniform4fv(gl.getUniformLocation(this.progInitSnow, 'uStrataOrient'), strataVec);
    gl.uniform1f(gl.getUniformLocation(this.progInitSnow, 'uSeed'), p.seed);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboSnowClear[0]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboSnowClear[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.snowIdx = 0;

    // 3. Spawn staggered sky raindrops across all 32,768 GPU particle slots
    const emitter = EMITTER_MODES[p.emitterMode] || EMITTER_MODES['sky-rain'];
    gl.viewport(0, 0, PART_TEX_W, PART_TEX_H);
    gl.useProgram(this.progInitParticles);
    gl.uniform4f(
      gl.getUniformLocation(this.progInitParticles, 'uSpawnBox'),
      p.worldSpan,
      p.cloudHeight,
      p.seed,
      emitter.code
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboInitParticles[0]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.partIdx = 0;

    // 4. Capture 64x64 initial terrain snapshot & seed 3D cliff outcrops + fallen boulders!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTelemetry);
    gl.viewport(0, 0, TELEMETRY_RES, TELEMETRY_RES);
    gl.useProgram(this.progTelemetry);
    this._bindTex(this.progTelemetry, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
    gl.uniform1f(gl.getUniformLocation(this.progTelemetry, 'uGridRes'), this.gridRes);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, TELEMETRY_RES, TELEMETRY_RES, gl.RGBA, gl.FLOAT, this.initialSnap64);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    this.rockCalving.updateTerrainSnapshot(this.initialSnap64, TELEMETRY_RES, p.worldSpan);
    this.rockCalving.seedForLandscape(p);

    let initWaterSum = 0;
    for (let i = 0; i < this.initialSnap64.length; i += 4) {
      initWaterSum += this.initialSnap64[i + 3];
    }
    const cellAreaSample = (p.worldSpan * p.worldSpan) / (TELEMETRY_RES * TELEMETRY_RES);

    this.stepCount = 0;
    this.telemetry.steps = 0;
    this.telemetry.erodedVolumeM3 = 0;
    this.telemetry.coarseSedM3 = 0;
    this.telemetry.fineSedM3 = 0;
    this.telemetry.waterVolumeM3 = Math.round(initWaterSum * cellAreaSample);
    this.telemetry.boulders = this.rockCalving.rocks.length;
    this.telemetry.particles = p.particleCount;
    if (this.onTelemetry) this.onTelemetry(this.telemetry);
  }

  /**
   * Seeds initial mountain snowpack & valley glaciers (`progInitSnow`) onto `snowTex[snowIdx]`.
   */
  seedInitialSnow() {
    const gl = this.gl;
    const R = this.gridRes;
    const p = this.params;
    const { strataVec } = this._getHardnessUniforms();
    const cellSize = p.worldSpan / R;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, R, R);
    gl.useProgram(this.progInitSnow);
    gl.bindVertexArray(this.emptyVao);
    this._bindTex(this.progInitSnow, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
    gl.uniform4f(gl.getUniformLocation(this.progInitSnow, 'uCryoParams'), R, cellSize, 0.085, p.worldSpan);
    gl.uniform4fv(
      gl.getUniformLocation(this.progInitSnow, 'uClimate'),
      [p.snowline, Math.max(0, Math.min(1, p.snowfallRate || 0)), Math.max(0, Math.min(1, p.glacierStrength || 0)), 0.8]
    );
    gl.uniform4fv(gl.getUniformLocation(this.progInitSnow, 'uStrataOrient'), strataVec);
    gl.uniform1f(gl.getUniformLocation(this.progInitSnow, 'uSeed'), p.seed);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboSnowClear[this.snowIdx]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Executes `passes` iterations of conservative `THERMAL_TALUS_FRAG` (`progThermalTalus`).
   */
  stepThermalTalusOnly(passes = 1) {
    const gl = this.gl;
    const R = this.gridRes;
    const p = this.params;
    const cellSize = p.worldSpan / R;
    const { hardnessVec, strataVec } = this._getHardnessUniforms();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, R, R);
    gl.useProgram(this.progThermalTalus);
    gl.bindVertexArray(this.emptyVao);
    gl.uniform4f(gl.getUniformLocation(this.progThermalTalus, 'uTalusParams'), R, cellSize, p.talusAngle, p.worldSpan);
    gl.uniform4fv(gl.getUniformLocation(this.progThermalTalus, 'uHardnessParams'), hardnessVec);
    gl.uniform4fv(gl.getUniformLocation(this.progThermalTalus, 'uStrataOrient'), strataVec);
    gl.uniform1f(gl.getUniformLocation(this.progThermalTalus, 'uDryAeolian'), p.dryAeolianMode || 0.0);
    gl.uniform1f(gl.getUniformLocation(this.progThermalTalus, 'uSeed'), p.seed);

    for (let i = 0; i < passes; i++) {
      const nextTalus = 1 - this.terrainIdx;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSingle[nextTalus]);
      this._bindTex(this.progThermalTalus, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.terrainIdx = nextTalus;
    }
  }

  /**
   * Executes `count` full GPU erosion + shallow-water + sedimentation + thermal talus substeps!
   */
  stepSimulation(count = 1, opts = {}) {
    const gl = this.gl;
    const R = this.gridRes;
    const p = this.params;
    const dt = 0.085;
    const cellSize = p.worldSpan / R;
    const activeCount = Math.min(MAX_GPU_PARTICLES, Math.max(1024, Math.floor(p.particleCount)));
    const emitter = EMITTER_MODES[p.emitterMode] || EMITTER_MODES['sky-rain'];
    const { hardnessVec, strataVec } = this._getHardnessUniforms();
    const climate = this._getClimateUniforms();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    for (let s = 0; s < count; s++) {
      this.stepCount++;
      const prevP = this.partIdx;
      const nextP = 1 - prevP;

      // ---------------------------------------------------------------------
      // PASS A & B: GPU Lagrangian Particle Kinematics & Scatter (only when >=1 particle sim layer is playing)
      // ---------------------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboDelta);
      gl.viewport(0, 0, R, R);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (climate.anyParticleSpecies) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboStepParticles[nextP]);
        gl.viewport(0, 0, PART_TEX_W, PART_TEX_H);
        gl.disable(gl.BLEND);
        gl.useProgram(this.progParticleStep);
        gl.bindVertexArray(this.emptyVao);

        this._bindTex(this.progParticleStep, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
        this._bindTex(this.progParticleStep, 'uPosAgeTex', this.partPosAge[prevP], 1);
        this._bindTex(this.progParticleStep, 'uVelWaterTex', this.partVelWater[prevP], 2);
        this._bindTex(this.progParticleStep, 'uSedimentTex', this.partSediment[prevP], 3);
        this._bindTex(this.progParticleStep, 'uVelocityFieldTex', this.velocityFieldTex, 4);
        this._bindTex(this.progParticleStep, 'uSnowTex', this.snowTex[this.snowIdx], 5);

        gl.uniform4f(gl.getUniformLocation(this.progParticleStep, 'uDomain'), p.worldSpan, R, dt, this.stepCount);
        gl.uniform4f(
          gl.getUniformLocation(this.progParticleStep, 'uRainEmitter'),
          p.cloudHeight,
          p.simHydraulicPlaying === false ? 0.0 : p.rainIntensity,
          emitter.code,
          activeCount
        );
        gl.uniform4f(
          gl.getUniformLocation(this.progParticleStep, 'uStormTarget'),
          this.stormTarget[0],
          this.stormTarget[1],
          Math.max(24.0, p.brushRadius * 1.8),
          0.35
        );
        gl.uniform4f(
          gl.getUniformLocation(this.progParticleStep, 'uHydraulics'),
          p.erosionStrength,
          p.sedimentCapacity,
          p.depositionRate,
          p.particleInertia
        );
        gl.uniform4f(
          gl.getUniformLocation(this.progParticleStep, 'uLifeEvap'),
          p.evaporation,
          p.gravity,
          38.0,
          p.pipeFlowBlend
        );
        gl.uniform4fv(gl.getUniformLocation(this.progParticleStep, 'uHardnessParams'), hardnessVec);
        gl.uniform4fv(gl.getUniformLocation(this.progParticleStep, 'uStrataOrient'), strataVec);
        gl.uniform4fv(gl.getUniformLocation(this.progParticleStep, 'uSpeciesMix'), climate.speciesVec);
        gl.uniform4fv(gl.getUniformLocation(this.progParticleStep, 'uSnowParams'), climate.snowVec);
        gl.uniform4fv(gl.getUniformLocation(this.progParticleStep, 'uWindParams'), climate.windVec);
        gl.uniform1f(gl.getUniformLocation(this.progParticleStep, 'uDryAeolian'), p.dryAeolianMode || 0.0);
        gl.uniform1f(gl.getUniformLocation(this.progParticleStep, 'uSeed'), p.seed);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.partIdx = nextP;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboDelta);
        gl.viewport(0, 0, R, R);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(this.progParticleScatter);

        this._bindTex(this.progParticleScatter, 'uPrevPosAgeTex', this.partPosAge[prevP], 0);
        this._bindTex(this.progParticleScatter, 'uNextPosAgeTex', this.partPosAge[nextP], 1);
        this._bindTex(this.progParticleScatter, 'uExchangeTex', this.partExchange, 2);
        this._bindTex(this.progParticleScatter, 'uExchange2Tex', this.partExchange2, 3);
        gl.uniform2f(gl.getUniformLocation(this.progParticleScatter, 'uDomainAndRes'), p.worldSpan, R);

        gl.drawArrays(gl.POINTS, 0, activeCount);
        gl.disable(gl.BLEND);
      }

      // ---------------------------------------------------------------------
      // PASS C: GPU Shallow-Water Pipe Flux (`uFluxTex`) — gated by Hydraulic Sim Layer!
      // ---------------------------------------------------------------------
      if (p.simHydraulicPlaying !== false) {
        const nextFlux = 1 - this.fluxIdx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFlux[nextFlux]);
        gl.viewport(0, 0, R, R);
        gl.useProgram(this.progWaterFlux);
        gl.bindVertexArray(this.emptyVao);

        this._bindTex(this.progWaterFlux, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
        this._bindTex(this.progWaterFlux, 'uFluxTex', this.fluxTex[this.fluxIdx], 1);
        gl.uniform4f(gl.getUniformLocation(this.progWaterFlux, 'uPipeParams'), R, cellSize, dt, p.gravity);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.fluxIdx = nextFlux;
      }

      // ---------------------------------------------------------------------
      // PASS D: Integrate Terrain + Water + Scattered Exchanges + Brush
      // ---------------------------------------------------------------------
      const nextTerr = 1 - this.terrainIdx;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainIntegrate[nextTerr]);
      gl.viewport(0, 0, R, R);
      gl.useProgram(this.progTerrainIntegrate);
      gl.bindVertexArray(this.emptyVao);

      this._bindTex(this.progTerrainIntegrate, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
      this._bindTex(this.progTerrainIntegrate, 'uDeltaTex', this.deltaTex, 1);
      this._bindTex(this.progTerrainIntegrate, 'uFluxTex', this.fluxTex[this.fluxIdx], 2);
      this._bindTex(this.progTerrainIntegrate, 'uSnowTex', this.snowTex[this.snowIdx], 3);

      gl.uniform4f(gl.getUniformLocation(this.progTerrainIntegrate, 'uIntParams'), R, cellSize, dt, p.simHydraulicPlaying === false ? 0.0 : p.evaporation);
      gl.uniform4f(
        gl.getUniformLocation(this.progTerrainIntegrate, 'uPipeErode'),
        p.simHydraulicPlaying === false ? 0.0 : p.pipeFlowBlend,
        p.erosionStrength,
        p.rockHardness,
        p.worldSpan
      );
      gl.uniform4fv(gl.getUniformLocation(this.progTerrainIntegrate, 'uHardnessParams'), hardnessVec);
      gl.uniform4fv(gl.getUniformLocation(this.progTerrainIntegrate, 'uStrataOrient'), strataVec);
      gl.uniform4fv(gl.getUniformLocation(this.progTerrainIntegrate, 'uClimate'), climate.snowVec);
      const riverSpring = p.simHydraulicPlaying === false
        ? 0.0
        : (p.oasisSpring ? -Math.max(0.05, p.headwaterFlow ?? 0.65) : (p.headwaterFlow ?? 0.0));
      gl.uniform4f(
        gl.getUniformLocation(this.progTerrainIntegrate, 'uHydrology'),
        p.simCryoPlaying === false ? 0.0 : (p.iceMeltRate ?? 0.22),
        riverSpring,
        p.lakeRetention ?? 0.40,
        p.dryAeolianMode ?? 0.0
      );
      gl.uniform4f(
        gl.getUniformLocation(this.progTerrainIntegrate, 'uWindField'),
        climate.windVec[0],
        climate.windVec[1],
        p.simWindPlaying === false ? 0.0 : (p.windSpeed ?? 0.0),
        p.erosionStrength ?? 0.70
      );

      let brushCode = 0;
      if (this.brushDown) {
        if (p.brushMode === 'cloudburst') brushCode = 1;
        else if (p.brushMode === 'raise') brushCode = 2;
        else if (p.brushMode === 'carve') brushCode = 3;
      }
      gl.uniform4f(
        gl.getUniformLocation(this.progTerrainIntegrate, 'uBrush'),
        this.pointerWorldXZ[0],
        this.pointerWorldXZ[1],
        p.brushRadius,
        brushCode
      );
      gl.uniform1f(gl.getUniformLocation(this.progTerrainIntegrate, 'uBrushStrength'), p.brushStrength);
      gl.uniform1f(gl.getUniformLocation(this.progTerrainIntegrate, 'uSeed'), p.seed);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.terrainIdx = nextTerr;

      // ---------------------------------------------------------------------
      // PASS E: GPU Differential Cliff Spalling & Talus Angle-of-Repose Pass — gated by Rockfall/Talus Sim Layer!
      // ---------------------------------------------------------------------
      if (p.simRockfallPlaying !== false) {
        const nextTalus = 1 - this.terrainIdx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSingle[nextTalus]);
        gl.viewport(0, 0, R, R);
        gl.useProgram(this.progThermalTalus);

        this._bindTex(this.progThermalTalus, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
        gl.uniform4f(
          gl.getUniformLocation(this.progThermalTalus, 'uTalusParams'),
          R,
          cellSize,
          p.talusAngle,
          p.worldSpan
        );
        gl.uniform4fv(gl.getUniformLocation(this.progThermalTalus, 'uHardnessParams'), hardnessVec);
        gl.uniform4fv(gl.getUniformLocation(this.progThermalTalus, 'uStrataOrient'), strataVec);
        gl.uniform1f(gl.getUniformLocation(this.progThermalTalus, 'uDryAeolian'), p.dryAeolianMode || 0.0);
        gl.uniform1f(gl.getUniformLocation(this.progThermalTalus, 'uSeed'), p.seed);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.terrainIdx = nextTalus;
      }

      // ---------------------------------------------------------------------
      // PASS F: GPU Cryosphere — Snowpack, Avalanche, Firn & Glacier Creep — gated by Cryo Sim Layer!
      // ---------------------------------------------------------------------
      if (p.simCryoPlaying !== false) {
        const nextSnow = 1 - this.snowIdx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboSnowClear[nextSnow]);
        gl.viewport(0, 0, R, R);
        gl.useProgram(this.progSnowCryo);

        this._bindTex(this.progSnowCryo, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
        this._bindTex(this.progSnowCryo, 'uSnowTex', this.snowTex[this.snowIdx], 1);
        this._bindTex(this.progSnowCryo, 'uSnowDeltaTex', this.snowDeltaTex, 2);
        gl.uniform4f(gl.getUniformLocation(this.progSnowCryo, 'uCryoParams'), R, cellSize, dt, p.worldSpan);
        gl.uniform4fv(gl.getUniformLocation(this.progSnowCryo, 'uClimate'), climate.snowVec);
        gl.uniform4fv(gl.getUniformLocation(this.progSnowCryo, 'uStrataOrient'), strataVec);
        gl.uniform4f(
          gl.getUniformLocation(this.progSnowCryo, 'uWindCryo'),
          climate.windVec[0],
          climate.windVec[1],
          p.simWindPlaying === false ? 0.0 : (p.windSpeed ?? 0.0),
          this.stepCount * dt
        );
        gl.uniform1f(gl.getUniformLocation(this.progSnowCryo, 'uIceMeltRate'), p.iceMeltRate ?? 0.22);
        gl.uniform1f(gl.getUniformLocation(this.progSnowCryo, 'uSeed'), p.seed);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.snowIdx = nextSnow;
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    if (opts.skipTelemetry) return;

    if (this.stepCount % 36 === 0) {
      this._sampleTelemetry();
    } else {
      this.telemetry.steps = this.stepCount;
      this.telemetry.particles = activeCount;
      this.telemetry.fps = this.fps;
      if (this.pipeline) {
        this.telemetry.layerCount = this.pipeline.layers.length;
        this.telemetry.evalMs = Number(this.pipeline.lastEvalMs.toFixed(1));
        this.telemetry.caveTris = Math.round(this.pipeline.caveSystem.vertexCount / 3);
      }
      if (this.onTelemetry && this.stepCount % 8 === 0) this.onTelemetry(this.telemetry);
    }
  }

  _sampleTelemetry() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTelemetry);
    gl.viewport(0, 0, TELEMETRY_RES, TELEMETRY_RES);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progTelemetry);
    gl.bindVertexArray(this.emptyVao);

    this._bindTex(this.progTelemetry, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
    gl.uniform1f(gl.getUniformLocation(this.progTelemetry, 'uGridRes'), this.gridRes);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.readPixels(0, 0, TELEMETRY_RES, TELEMETRY_RES, gl.RGBA, gl.FLOAT, this.telemetryBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let sumEroded = 0;
    let sumCoarse = 0;
    let sumFine = 0;
    let sumWater = 0;
    const buf = this.telemetryBuf;
    const ini = this.initialSnap64;
    for (let i = 0; i < buf.length; i += 4) {
      sumEroded += Math.max(0, ini[i] - buf[i]);
      sumCoarse += Math.max(0, buf[i + 1] - ini[i + 1]);
      sumFine += Math.max(0, buf[i + 2] - ini[i + 2]);
      sumWater += buf[i + 3];
    }

    // Feed live 64x64 terrain heightfield to 3D rock calving & undercut-boulder wake-up!
    this.rockCalving.updateTerrainSnapshot(buf, TELEMETRY_RES, this.params.worldSpan);
    if (this.playing && (this.params.rockfallRate || 0) > 0.25 && (this.params.boulderDensity ?? 0.65) > 0.05) {
      if (this.stepCount % 144 === 0) {
        this.rockCalving.calveCliffBoulders(Math.max(1, Math.round(this.params.rockfallRate * 3)));
      }
    }

    const cellAreaSample = (this.params.worldSpan * this.params.worldSpan) / (TELEMETRY_RES * TELEMETRY_RES);
    this.telemetry.steps = this.stepCount;
    this.telemetry.particles = this.params.particleCount;
    this.telemetry.erodedVolumeM3 = Math.round(sumEroded * cellAreaSample);
    this.telemetry.coarseSedM3 = Math.round(sumCoarse * cellAreaSample);
    this.telemetry.fineSedM3 = Math.round(sumFine * cellAreaSample);
    this.telemetry.waterVolumeM3 = Math.round(sumWater * cellAreaSample);
    this.telemetry.boulders = this.rockCalving.rocks.length;
    this.telemetry.fps = this.fps;
    if (this.pipeline) {
      this.telemetry.layerCount = this.pipeline.layers.length;
      this.telemetry.evalMs = Number(this.pipeline.lastEvalMs.toFixed(1));
      this.telemetry.caveTris = Math.round(this.pipeline.caveSystem.vertexCount / 3);
    }
    if (this.onTelemetry) this.onTelemetry(this.telemetry);
  }

  _bindTex(prog, name, tex, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  resizeIfNeeded() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  renderFrame() {
    const gl = this.gl;
    this.resizeIfNeeded();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const p = this.params;
    const { viewProj, eye } = this._buildViewProjMatrix(W / H);
    const az = (p.sunAzimuth * Math.PI) / 180;
    const el = (p.sunElevation * Math.PI) / 180;
    const sunDir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const timeSec = (performance.now() - this.startTimeMs) * 0.001;

    if (this.pipelineMode && this.pipeline) {
      this.pipeline.renderPipelineFrame(viewProj, eye, sunDir, timeSec);
      if (this.onFrameRendered) this.onFrameRendered();
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 1. Studio Sky Backdrop
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progSkyBg);
    gl.uniform1i(gl.getUniformLocation(this.progSkyBg, 'uMaterialTheme'), this._themeCode());
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. 3D Displaced Terrain + Stratigraphy + Sedimentation + Raymarched Sun Shadows
    const { hardnessVec, strataVec } = this._getHardnessUniforms();
    const layerVisVec = this._getLayerVisUniforms();
    const climate = this._getClimateUniforms();

    const viewCode =
      p.viewMode === 'sediment' ? 1 :
      p.viewMode === 'hardness' ? 2 :
      p.viewMode === 'flow'     ? 3 :
      p.viewMode === 'clay'     ? 4 :
      p.viewMode === 'cryo'     ? 5 :
      p.viewMode === 'hydro'    ? 6 : 0;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(this.progTerrainRender);
    gl.bindVertexArray(this.terrainVao);

    this._bindTex(this.progTerrainRender, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
    this._bindTex(this.progTerrainRender, 'uInitialTex', this.initialTerrainTex, 1);
    this._bindTex(this.progTerrainRender, 'uVelocityFieldTex', this.velocityFieldTex, 2);
    this._bindTex(this.progTerrainRender, 'uSnowTex', this.snowTex[this.snowIdx], 3);

    gl.uniformMatrix4fv(gl.getUniformLocation(this.progTerrainRender, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(this.progTerrainRender, 'uCameraPos'), eye);
    gl.uniform3fv(gl.getUniformLocation(this.progTerrainRender, 'uSunDir'), sunDir);
    gl.uniform4f(
      gl.getUniformLocation(this.progTerrainRender, 'uRenderDomain'),
      p.worldSpan,
      this.gridRes,
      (p.showWater && p.waterLayerEnabled !== false) ? 1.0 : 0.0,
      timeSec
    );
    gl.uniform4fv(gl.getUniformLocation(this.progTerrainRender, 'uLayerVis'), layerVisVec);
    gl.uniform4fv(gl.getUniformLocation(this.progTerrainRender, 'uHardnessParams'), hardnessVec);
    gl.uniform4fv(gl.getUniformLocation(this.progTerrainRender, 'uStrataOrient'), strataVec);

    const showCursorMode =
      p.brushMode === 'cloudburst' ? 1 :
      p.brushMode === 'raise'      ? 2 :
      p.brushMode === 'carve'      ? 3 :
      p.emitterMode === 'storm-cell' ? 1 : 0;
    const cursorXZ = p.emitterMode === 'storm-cell' && p.brushMode === 'orbit' ? this.stormTarget : this.pointerWorldXZ;
    gl.uniform4f(
      gl.getUniformLocation(this.progTerrainRender, 'uBrush'),
      cursorXZ[0],
      cursorXZ[1],
      p.emitterMode === 'storm-cell' && p.brushMode === 'orbit' ? Math.max(24, p.brushRadius * 1.8) : p.brushRadius,
      showCursorMode
    );
    gl.uniform1i(gl.getUniformLocation(this.progTerrainRender, 'uViewMode'), viewCode);
    gl.uniform1i(gl.getUniformLocation(this.progTerrainRender, 'uMaterialTheme'), this._themeCode());
    gl.uniform1i(gl.getUniformLocation(this.progTerrainRender, 'uFabricMode'), this._fabricCode());
    gl.uniform4fv(gl.getUniformLocation(this.progTerrainRender, 'uClimate'), climate.snowVec);
    gl.uniform4f(
      gl.getUniformLocation(this.progTerrainRender, 'uWindRender'),
      climate.windVec[0],
      climate.windVec[1],
      p.windSpeed || 0.0,
      p.dryAeolianMode || 0.0
    );
    gl.uniform1f(gl.getUniformLocation(this.progTerrainRender, 'uSeed'), p.seed);

    gl.drawElements(gl.TRIANGLES, this.terrainIndexCount, gl.UNSIGNED_INT, 0);

    // 2B. 3D Bedrock Outcrops & Gravity-Settled Cliff-Calved Boulders!
    if (p.showOutcrops !== false && this.rockCalving.rocks.length > 0) {
      gl.useProgram(this.progRockInstance);
      gl.bindVertexArray(this.rockVao);

      this._bindTex(this.progRockInstance, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
      this._bindTex(this.progRockInstance, 'uSnowTex', this.snowTex[this.snowIdx], 1);

      gl.uniformMatrix4fv(gl.getUniformLocation(this.progRockInstance, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.progRockInstance, 'uCameraPos'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.progRockInstance, 'uSunDir'), sunDir);
      gl.uniform4f(
        gl.getUniformLocation(this.progRockInstance, 'uRenderDomain'),
        p.worldSpan,
        this.gridRes,
        (p.showWater && p.waterLayerEnabled !== false) ? 1.0 : 0.0,
        timeSec
      );
      gl.uniform4fv(gl.getUniformLocation(this.progRockInstance, 'uLayerVis'), layerVisVec);
      gl.uniform4fv(gl.getUniformLocation(this.progRockInstance, 'uHardnessParams'), hardnessVec);
      gl.uniform4fv(gl.getUniformLocation(this.progRockInstance, 'uStrataOrient'), strataVec);
      gl.uniform4fv(gl.getUniformLocation(this.progRockInstance, 'uClimate'), climate.snowVec);
      gl.uniform1i(gl.getUniformLocation(this.progRockInstance, 'uViewMode'), viewCode);
      gl.uniform1i(gl.getUniformLocation(this.progRockInstance, 'uMaterialTheme'), this._themeCode());
      gl.uniform1i(gl.getUniformLocation(this.progRockInstance, 'uFabricMode'), this._fabricCode());
      gl.uniform1f(gl.getUniformLocation(this.progRockInstance, 'uSeed'), p.seed);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.rockInstVbo);
      const subs = this.rockCalving.atlas.submeshes;
      for (let b = 0; b < subs.length; b++) {
        const count = this.rockCalving.bucketCounts[b];
        if (count <= 0) continue;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.rockCalving.bucketData[b].subarray(0, count * 16));
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          subs[b].indexCount,
          gl.UNSIGNED_SHORT,
          subs[b].firstIndex * 2,
          count
        );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // 2C. Real 3D GPU-Instanced Grass Vegetation Layer (Green Grass / Dry Grass / Biome Auto-Blend)!
    if (p.grassEnabled && (p.grassDensity ?? 0.5) > 0.01 && (viewCode === 0 || viewCode === 4)) {
      const tuftCount = Math.max(512, Math.min(MAX_GRASS_TUFTS, Math.round((p.grassDensity ?? 0.55) * MAX_GRASS_TUFTS)));
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.progGrassInstance);
      gl.bindVertexArray(this.grassVao);

      this._bindTex(this.progGrassInstance, 'uTerrainTex', this.terrainTex[this.terrainIdx], 0);
      this._bindTex(this.progGrassInstance, 'uSnowTex', this.snowTex[this.snowIdx], 1);

      gl.uniformMatrix4fv(gl.getUniformLocation(this.progGrassInstance, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.progGrassInstance, 'uCameraPos'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.progGrassInstance, 'uSunDir'), sunDir);
      gl.uniform4f(
        gl.getUniformLocation(this.progGrassInstance, 'uRenderDomain'),
        p.worldSpan,
        this.gridRes,
        p.showWater ? 1.0 : 0.0,
        timeSec
      );
      gl.uniform4f(
        gl.getUniformLocation(this.progGrassInstance, 'uGrassParams'),
        tuftCount,
        p.grassHeight ?? 1.15,
        p.grassWindSway ?? 0.65,
        p.grassSlopeMax ?? 0.62
      );
      gl.uniform4f(
        gl.getUniformLocation(this.progGrassInstance, 'uGrassStyle'),
        p.grassMode ?? 0,
        p.grassDryBlend ?? 0.15,
        p.grassElevMax ?? 0.52,
        p.grassPatchiness ?? 0.58
      );
      gl.uniform4f(
        gl.getUniformLocation(this.progGrassInstance, 'uWindRender'),
        climate.windVec[0],
        climate.windVec[1],
        p.windSpeed || 0.25,
        p.dryAeolianMode || 0.0
      );
      gl.uniform4fv(gl.getUniformLocation(this.progGrassInstance, 'uStrataOrient'), strataVec);
      gl.uniform1i(gl.getUniformLocation(this.progGrassInstance, 'uViewMode'), viewCode);
      gl.uniform1i(gl.getUniformLocation(this.progGrassInstance, 'uMaterialTheme'), this._themeCode());
      gl.uniform1f(gl.getUniformLocation(this.progGrassInstance, 'uSeed'), p.seed);

      gl.drawElementsInstanced(gl.TRIANGLES, this.grassIndexCount, gl.UNSIGNED_SHORT, 0, tuftCount);
      gl.enable(gl.CULL_FACE);
    }

    // 3. 3D Falling Sky Raindrops & Sediment-Colored Surface Runoff Particles!
    if (p.showParticles && p.particleOpacity > 0.01 && climate.anyParticleSpecies) {
      const activeCount = Math.min(MAX_GPU_PARTICLES, Math.max(1024, Math.floor(p.particleCount)));
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(this.progParticleRender);
      gl.bindVertexArray(this.emptyVao);

      this._bindTex(this.progParticleRender, 'uPosAgeTex', this.partPosAge[this.partIdx], 0);
      this._bindTex(this.progParticleRender, 'uVelWaterTex', this.partVelWater[this.partIdx], 1);
      this._bindTex(this.progParticleRender, 'uSedimentTex', this.partSediment[this.partIdx], 2);
      this._bindTex(this.progParticleRender, 'uTerrainTex', this.terrainTex[this.terrainIdx], 3);

      gl.uniformMatrix4fv(gl.getUniformLocation(this.progParticleRender, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.progParticleRender, 'uCameraPos'), eye);
      gl.uniform4f(
        gl.getUniformLocation(this.progParticleRender, 'uPartVis'),
        p.worldSpan,
        this.gridRes,
        p.particleOpacity,
        activeCount
      );

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    gl.bindVertexArray(null);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._fpsLastMs = performance.now();
    this._fpsFrames = 0;

    const tick = () => {
      if (!this.active) return;
      this._rafId = requestAnimationFrame(tick);

      const now = performance.now();
      const frameDt = Math.min(0.08, Math.max(0.001, (now - this._lastFrameMs) * 0.001));
      this._lastFrameMs = now;
      this._stepWasdCamera(frameDt);

      this._fpsFrames++;
      if (now - this._fpsLastMs >= 500) {
        this.fps = Math.round((this._fpsFrames * 1000) / (now - this._fpsLastMs));
        this._fpsFrames = 0;
        this._fpsLastMs = now;
      }

      if (this.pipelineMode && this.pipeline) {
        this.playing = Boolean(this.pipeline.liveSimRunning);
        const anySimLayerOn =
          this.params.simHydraulicPlaying !== false ||
          this.params.simCryoPlaying !== false ||
          this.params.simWindPlaying !== false ||
          this.params.simRockfallPlaying !== false;
        if (this.playing && anySimLayerOn) {
          this.stepSimulation(this.params.substepsPerFrame);
        }
        if (this.params.simRockfallPlaying !== false && this.params.showOutcrops !== false) {
          this.rockCalving.stepPhysics(frameDt, false);
        }
        this.telemetry.fps = this.fps;
        this.telemetry.boulders = this.rockCalving.rocks.length;
        this.telemetry.layerCount = this.pipeline.layers.length;
        this.renderFrame();
        return;
      }

      const anySimLayerOn =
        this.params.simHydraulicPlaying !== false ||
        this.params.simCryoPlaying !== false ||
        this.params.simWindPlaying !== false ||
        this.params.simRockfallPlaying !== false;
      if (this.playing && anySimLayerOn) {
        this.stepSimulation(this.params.substepsPerFrame);
        if (this.params.simRockfallPlaying !== false) {
          this.rockCalving.stepPhysics(frameDt);
        }
      } else {
        if (this.params.simRockfallPlaying !== false) {
          this.rockCalving.stepPhysics(frameDt);
        }
        if (this.brushDown && this.params.brushMode !== 'orbit') {
          this.stepSimulation(1);
        }
      }

      this.renderFrame();
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.active = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Reads back the live GPU-eroded terrain heightfield on demand and builds a game-ready
   * 3D mesh (positions, normals, tangents, UVs, indices, and stratigraphic/sediment colors)
   * compatible with our `.GLB` and `.OBJ` exporters!
   */
  extractMeshForExport(exportStep = 2) {
    const gl = this.gl;
    const R = this.gridRes;
    const raw = new Float32Array(R * R * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSingle[this.terrainIdx]);
    gl.readPixels(0, 0, R, R, gl.RGBA, gl.FLOAT, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let rawVecDisp = null;
    if (this.pipelineMode && this.pipeline && this.pipeline.fboVecOnly) {
      rawVecDisp = new Float32Array(R * R * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pipeline.fboVecOnly[this.pipeline.vecIdx]);
      gl.readPixels(0, 0, R, R, gl.RGBA, gl.FLOAT, rawVecDisp);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    const stride = Math.max(1, exportStep);
    const M = Math.floor((R - 1) / stride) + 1;
    const vCount = M * M;
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const tangents = new Float32Array(vCount * 4);
    const uvs = new Float32Array(vCount * 2);
    const colors = new Float32Array(vCount * 4);

    const span = this.params.worldSpan;
    const cellWorld = span / (R - 1);

    const heightAt = (ix, iz) => {
      const cx = Math.max(0, Math.min(R - 1, ix));
      const cz = Math.max(0, Math.min(R - 1, iz));
      const idx = (cz * R + cx) * 4;
      return raw[idx] + raw[idx + 1] + raw[idx + 2];
    };

    for (let gz = 0; gz < M; gz++) {
      const iz = Math.min(R - 1, gz * stride);
      const v = iz / (R - 1);
      for (let gx = 0; gx < M; gx++) {
        const ix = Math.min(R - 1, gx * stride);
        const u = ix / (R - 1);
        const vi = gz * M + gx;
        const rawIdx = (iz * R + ix) * 4;

        const bed = raw[rawIdx];
        const coarse = raw[rawIdx + 1];
        const fine = raw[rawIdx + 2];
        const dx = rawVecDisp ? rawVecDisp[rawIdx] : 0;
        const dy = rawVecDisp ? rawVecDisp[rawIdx + 1] : 0;
        const dz = rawVecDisp ? rawVecDisp[rawIdx + 2] : 0;
        const h = bed + coarse + fine + dy;

        positions[vi * 3]     = (u - 0.5) * span + dx;
        positions[vi * 3 + 1] = h;
        positions[vi * 3 + 2] = (v - 0.5) * span + dz;

        uvs[vi * 2]     = u;
        uvs[vi * 2 + 1] = v;

        const hL = heightAt(ix - stride, iz);
        const hR = heightAt(ix + stride, iz);
        const hD = heightAt(ix, iz - stride);
        const hU = heightAt(ix, iz + stride);
        let nx = hL - hR;
        let ny = 2.0 * cellWorld * stride;
        let nz = hD - hU;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;

        normals[vi * 3]     = nx;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz;

        tangents[vi * 4]     = 1;
        tangents[vi * 4 + 1] = 0;
        tangents[vi * 4 + 2] = 0;
        tangents[vi * 4 + 3] = 1;

        // Bake rock vs coarse gravel vs fine ochre alluvial fan color into vertex colors!
        const fineW = Math.min(1, fine / 0.22);
        const coarseW = Math.min(1, coarse / 0.28) * (1 - fineW);
        const rockW = Math.max(0, 1 - fineW - coarseW);
        colors[vi * 4]     = rockW * 0.48 + coarseW * 0.52 + fineW * 0.72;
        colors[vi * 4 + 1] = rockW * 0.42 + coarseW * 0.47 + fineW * 0.58;
        colors[vi * 4 + 2] = rockW * 0.37 + coarseW * 0.40 + fineW * 0.36;
        colors[vi * 4 + 3] = 1.0;
      }
    }

    const qCount = (M - 1) * (M - 1);
    const indices = new Uint32Array(qCount * 6);
    let ip = 0;
    for (let gz = 0; gz < M - 1; gz++) {
      for (let gx = 0; gx < M - 1; gx++) {
        const i00 = gz * M + gx;
        const i10 = i00 + 1;
        const i01 = i00 + M;
        const i11 = i01 + 1;
        indices[ip++] = i00;
        indices[ip++] = i01;
        indices[ip++] = i10;
        indices[ip++] = i10;
        indices[ip++] = i01;
        indices[ip++] = i11;
      }
    }

    return { positions, normals, tangents, uvs, colors, indices };
  }
}

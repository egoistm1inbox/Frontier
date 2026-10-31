/**
 * Non-Destructive Bottom-to-Top GPU Terrain Stack Evaluator & Renderer.
 *
 * Evaluates an ordered stack of Landform, SDF Geometry, Sculpt, Spline, Simulation,
 * Rock-Placement, and Vegetation-Placement layers from bottom (last index) to top (index 0)
 * directly on `GpuErosionEngine`'s native textures (`terrainTex`, `snowTex`, `fluxTex`,
 * `velocityFieldTex`) using the exact `c5ae88b` / `2cc3d34` generators (`INIT_TERRAIN_FRAG`
 * `terrainType` 0..18, `seed: 4029`), conservative simulation shaders, and `TERRAIN_RENDER`
 * geological shading!
 */

import { DEFAULT_EROSION_PARAMS, EMITTER_MODES } from './erosion-presets.js';
import { FULLSCREEN_VERT } from './erosion-shaders.js';
import { MAX_GRASS_TUFTS } from './grass-system.js';
import {
  SCULPT_STAMP_FRAG,
  SDF_CAVE_FRAG,
  SDF_CAVE_VERT,
  STACK_COPY_VEC_FRAG,
  STACK_MASK_BAKE_FRAG,
  STACK_MASK_BLEND_FRAG,
  STACK_OP_FRAG,
} from './pipeline-shaders.js';
import { SdfCaveSystem } from './sdf-cave-mesher.js';
import {
  TERRAIN_STACK_PRESETS,
  createStackLayer,
} from './terrain-stack-presets.js';

const PART_TEX_W = 256;
const PART_TEX_H = 128;
const MAX_GPU_PARTICLES = PART_TEX_W * PART_TEX_H;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[Pipeline ${label}] ${info}`);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label}:VS`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}:FS`);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`[Pipeline ${label}] Link error: ${info}`);
  }
  return p;
}

function makeFloatTex(gl, w, h, linear = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function makeFbo(gl, colorAttachments) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const bufs = [];
  for (let i = 0; i < colorAttachments.length; i++) {
    const att = gl.COLOR_ATTACHMENT0 + i;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, att, gl.TEXTURE_2D, colorAttachments[i], 0);
    bufs.push(att);
  }
  gl.drawBuffers(bufs);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`[Pipeline FBO] Incomplete framebuffer: 0x${status.toString(16)}`);
  }
  return fbo;
}

const MASK_MODE_CODE = {
  height: 0,
  slope: 1,
  flow: 2,
  concavity: 3,
  radial: 4,
  noise: 5,
};

export class TerrainStackPipeline {
  constructor(engine) {
    this.engine = engine;
    this.gl = engine.gl;
    this.R = engine.gridRes;

    // Document state — defaults to `icelandic-highlands` (`seed: 4029`), matching `c5ae88b` / `2cc3d34`!
    this.activePresetId = 'icelandic-highlands';
    const initPreset = TERRAIN_STACK_PRESETS[this.activePresetId];
    this.projectTitle = initPreset.name;
    this.paletteId = initPreset.palette ?? 1;
    this.fabricMode = initPreset.fabricMode ?? 0;
    this.shadingMode = 0; // 0=Derived Geology, 1=AO & Protrusions, 2=Hardness, 3=Flow, 4=Sedimentation, 5=Active Mask B&W, 6=Clay, 7=Cryosphere, 8=Hydrology
    this.authorTool = 'navigate'; // 'navigate' | 'sculpt-add' | 'sculpt-remove' | 'sculpt-smooth' | 'cave-carve' | 'cave-fill' | 'spline-edit'
    this.layers = [];
    this.selectedLayerId = null;
    this.lastEvalMs = 0;
    this.liveSimRunning = true; // Live conservative GPU simulation ON by default!
    this.hasActiveVecDisp = false;

    // Per-sculpt-layer GPU delta textures: layerId -> { tex: [t0, t1], fbo: [f0, f1], idx: 0, caveStrokes: [] }
    this.sculptStore = new Map();

    // 3D SDF Cave & Undercut Volumetric System
    this.caveSystem = new SdfCaveSystem();

    this._initGpuResources();
    this.loadPreset(this.activePresetId);
  }

  _initGpuResources() {
    const gl = this.gl;
    const R = this.R;

    this.progStackOp = link(gl, FULLSCREEN_VERT, STACK_OP_FRAG, 'StackOp');
    this.progSculptStamp = link(gl, FULLSCREEN_VERT, SCULPT_STAMP_FRAG, 'SculptStamp');
    this.progMaskBake = link(gl, FULLSCREEN_VERT, STACK_MASK_BAKE_FRAG, 'StackMaskBake');
    this.progMaskBlend = link(gl, FULLSCREEN_VERT, STACK_MASK_BLEND_FRAG, 'StackMaskBlend');
    this.progCopyVec = link(gl, FULLSCREEN_VERT, STACK_COPY_VEC_FRAG, 'StackCopyVec');
    this.progCave = link(gl, SDF_CAVE_VERT, SDF_CAVE_FRAG, 'SdfCave');

    // 3D Lateral Overhang Vector Displacement ping-pong textures + scratch textures
    this.vecDispTex = [makeFloatTex(gl, R, R, false), makeFloatTex(gl, R, R, false)];
    this.vecIdx = 0;
    this.maskTex = makeFloatTex(gl, R, R, false);
    this.prevTerrainScratchTex = makeFloatTex(gl, R, R, false);
    this.emptySculptTex = makeFloatTex(gl, R, R, false);

    // 2-target MRT FBOs writing directly to `(engine.terrainTex[i], this.vecDispTex[i])`!
    this.fboStackOp = [
      makeFbo(gl, [this.engine.terrainTex[0], this.vecDispTex[0]]),
      makeFbo(gl, [this.engine.terrainTex[1], this.vecDispTex[1]]),
    ];
    this.fboVecOnly = [makeFbo(gl, [this.vecDispTex[0]]), makeFbo(gl, [this.vecDispTex[1]])];
    this.fboMask = makeFbo(gl, [this.maskTex]);
    this.fboPrevScratch = makeFbo(gl, [this.prevTerrainScratchTex]);

    // Clear emptySculptTex & vecDispTex once
    for (const f of [this.fboVecOnly[0], this.fboVecOnly[1], makeFbo(gl, [this.emptySculptTex])]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Downsampled 64x64 readback buffer
    this.snapN = 64;
    this.snapBuf = new Float32Array(this.snapN * this.snapN * 4);
    this.lastViewProj = null;

    // 128x128 Cave Portal Cutout Texture
    const P = this.caveSystem.portalMaskSize;
    this.cavePortalTex = makeFloatTex(gl, P, P, false);

    // 3D Volumetric SDF Cave VAO & dynamic buffers
    this.caveVao = gl.createVertexArray();
    gl.bindVertexArray(this.caveVao);
    this.cavePosBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cavePosBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.caveNrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.caveNrmBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    this.caveAttBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.caveAttBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  _bindTex(prog, name, tex, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  _copyTex(srcTex, dstFbo, w = this.R, h = this.R) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progCopyVec);
    gl.bindVertexArray(this.engine.emptyVao);
    this._bindTex(this.progCopyVec, 'uSrcTex', srcTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _getOrCreateSculptEntry(layerId) {
    if (this.sculptStore.has(layerId)) return this.sculptStore.get(layerId);
    const gl = this.gl;
    const R = this.R;
    const t0 = makeFloatTex(gl, R, R, false);
    const t1 = makeFloatTex(gl, R, R, false);
    const f0 = makeFbo(gl, [t0]);
    const f1 = makeFbo(gl, [t1]);
    for (const f of [f0, f1]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const entry = { tex: [t0, t1], fbo: [f0, f1], idx: 0, caveStrokes: [] };
    this.sculptStore.set(layerId, entry);
    return entry;
  }

  clearSculptLayer(layerId) {
    const entry = this.sculptStore.get(layerId);
    const layer = this.layers.find((l) => l.id === layerId);
    if (entry) {
      const gl = this.gl;
      for (const f of entry.fbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      entry.caveStrokes.length = 0;
    }
    if (layer) layer.params.strokeCount = 0;
    this.evaluateStack({ reseedPlacements: true });
  }

  loadPreset(presetId) {
    const preset = TERRAIN_STACK_PRESETS[presetId] || TERRAIN_STACK_PRESETS['icelandic-highlands'];
    this.activePresetId = preset.id;
    this.projectTitle = preset.name;
    this.paletteId = preset.palette ?? 0;
    this.fabricMode = preset.fabricMode ?? 0;

    // Apply preset's non-layer visual & emitter configuration cleanly
    const ep = this.engine.params;
    ep.landscape = preset.id;
    ep.materialTheme = this.paletteId;
    ep.fabricMode = this.fabricMode;
    ep.emitterMode = preset.emitterMode ?? DEFAULT_EROSION_PARAMS.emitterMode;
    ep.particleCount = preset.particleCount ?? DEFAULT_EROSION_PARAMS.particleCount;
    ep.particleInertia = preset.particleInertia ?? DEFAULT_EROSION_PARAMS.particleInertia;
    ep.pipeFlowBlend = preset.pipeFlowBlend ?? DEFAULT_EROSION_PARAMS.pipeFlowBlend;
    ep.sunAzimuth = preset.sunAzimuth ?? DEFAULT_EROSION_PARAMS.sunAzimuth;
    ep.sunElevation = preset.sunElevation ?? DEFAULT_EROSION_PARAMS.sunElevation;
    ep.showWater = preset.showWater ?? true;
    ep.showParticles = preset.showParticles ?? true;

    // Clear old sculpt buffers and populate fresh editable stack layers
    for (const [, entry] of this.sculptStore) {
      for (const t of entry.tex) this.gl.deleteTexture(t);
      for (const f of entry.fbo) this.gl.deleteFramebuffer(f);
    }
    this.sculptStore.clear();

    this.layers = preset.layers();
    // Select Base Landform or top meaningful layer
    this.selectedLayerId = this.layers[0]?.id || null;
    this.evaluateStack({ reseedPlacements: true });
    this.engine.camera.target[1] = (ep.relief || 168) * 0.30;
  }

  addLayer(type, overrides = {}) {
    const newLayer = createStackLayer(type, overrides);
    const selIdx = this.layers.findIndex((l) => l.id === this.selectedLayerId);
    const insertAt = selIdx >= 0 ? selIdx : 0;
    this.layers.splice(insertAt, 0, newLayer);
    this.selectedLayerId = newLayer.id;
    if (type === 'sculpt-layer') {
      this._getOrCreateSculptEntry(newLayer.id);
    }
    this.evaluateStack({ reseedPlacements: true });
    return newLayer;
  }

  duplicateLayer(layerId) {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return null;
    const src = this.layers[idx];
    const copy = createStackLayer(src.type, {
      name: `${src.name} copy`,
      enabled: src.enabled,
      mask: structuredClone(src.mask),
      params: structuredClone(src.params),
    });
    this.layers.splice(idx, 0, copy);
    this.selectedLayerId = copy.id;
    this.evaluateStack({ reseedPlacements: true });
    return copy;
  }

  deleteLayer(layerId) {
    if (this.layers.length <= 1) return false;
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx < 0 || this.layers[idx].locked) return false;
    this.layers.splice(idx, 1);
    const sc = this.sculptStore.get(layerId);
    if (sc) {
      for (const t of sc.tex) this.gl.deleteTexture(t);
      for (const f of sc.fbo) this.gl.deleteFramebuffer(f);
      this.sculptStore.delete(layerId);
    }
    if (this.selectedLayerId === layerId) {
      this.selectedLayerId = this.layers[Math.min(idx, this.layers.length - 1)]?.id || null;
    }
    this.evaluateStack({ reseedPlacements: true });
    return true;
  }

  moveLayer(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.layers.length) return;
    const clamped = Math.max(0, Math.min(this.layers.length - 1, toIdx));
    if (fromIdx === clamped) return;
    const [moved] = this.layers.splice(fromIdx, 1);
    this.layers.splice(clamped, 0, moved);
    this.evaluateStack({ reseedPlacements: true });
  }

  getSelectedLayer() {
    return this.layers.find((l) => l.id === this.selectedLayerId) || null;
  }

  _packMaskUniforms(mask) {
    if (!mask || !mask.enabled) {
      return {
        cfg1: [0, 0, 0, 1],
        cfg2: [0.15, 0, 2.0, 1337],
      };
    }
    return {
      cfg1: [1, MASK_MODE_CODE[mask.mode] ?? 0, mask.min ?? 0.2, mask.max ?? 0.85],
      cfg2: [mask.feather ?? 0.15, mask.invert ? 1 : 0, mask.scale ?? 2.2, mask.seed ?? 1337],
    };
  }

  _maxReliefEstimate() {
    let r = 150;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (!l.enabled) continue;
      if (l.type === 'base-landform') r = Math.max(55, l.params.relief || 150);
      else if (l.type === 'mountain-ridges' && l.params.combineMode === 0) r += (l.params.amplitude || 40) * 0.55;
      else if (l.type === 'rock-stacks') r += (l.params.height || 40) * 0.5;
    }
    return Math.min(280, r);
  }

  applySculptStroke(worldX, worldZ, isFirstSampleOfStroke = false) {
    let target = this.getSelectedLayer();
    if (!target || target.type !== 'sculpt-layer') {
      target = this.layers.find((l) => l.type === 'sculpt-layer' && l.enabled && !l.locked);
      if (!target) {
        target = this.addLayer('sculpt-layer', { name: 'SDF sculpt layer' });
      }
    }
    if (target.locked) return;

    const entry = this._getOrCreateSculptEntry(target.id);
    const tool = this.authorTool;
    const radius = target.params.brushRadius ?? 34;
    const strength = target.params.brushStrength ?? 0.72;

    if (tool === 'cave-carve' || tool === 'cave-fill') {
      const st = this.engine.rockCalving.sampleTerrain(worldX, worldZ);
      const centerY = Math.max(4, st.surfaceH - (target.params.caveHeightOffset ?? 8.0));
      const last = entry.caveStrokes[entry.caveStrokes.length - 1];
      if (!last || Math.hypot(last.x - worldX, last.z - worldZ) > radius * 0.32) {
        entry.caveStrokes.push({
          x: worldX,
          y: centerY,
          z: worldZ,
          radius: radius * 0.65,
          strength,
          op: tool,
        });
        target.params.strokeCount = (target.params.strokeCount || 0) + 1;
        this.evaluateStack({ reseedPlacements: false });
      }
      return;
    }

    const gl = this.gl;
    const R = this.R;
    const next = 1 - entry.idx;
    const opCode = tool === 'sculpt-remove' ? 1 : tool === 'sculpt-smooth' ? 2 : 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo[next]);
    gl.viewport(0, 0, R, R);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progSculptStamp);
    gl.bindVertexArray(this.engine.emptyVao);
    this._bindTex(this.progSculptStamp, 'uSculptTex', entry.tex[entry.idx], 0);
    gl.uniform4f(
      gl.getUniformLocation(this.progSculptStamp, 'uBrushPosRad'),
      worldX,
      worldZ,
      radius,
      this.engine.params.worldSpan
    );
    gl.uniform4f(
      gl.getUniformLocation(this.progSculptStamp, 'uBrushOpStr'),
      opCode,
      strength,
      0,
      0
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    entry.idx = next;

    if (isFirstSampleOfStroke) {
      target.params.strokeCount = (target.params.strokeCount || 0) + 1;
    }
    this.evaluateStack({ reseedPlacements: false });
  }

  _runStackOpPass(opKind, layer, u0, u1, u2, maxRelief) {
    const gl = this.gl;
    const R = this.R;
    const span = this.engine.params.worldSpan;
    const curT = this.engine.terrainIdx;
    const nextT = 1 - curT;

    if (this.vecIdx === nextT) {
      this._copyTex(this.vecDispTex[this.vecIdx], this.fboVecOnly[curT]);
      this.vecIdx = curT;
    }

    const { cfg1, cfg2 } = this._packMaskUniforms(layer.mask);
    let sculptTex = this.emptySculptTex;
    if (layer.type === 'sculpt-layer') {
      const entry = this._getOrCreateSculptEntry(layer.id);
      sculptTex = entry.tex[entry.idx];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboStackOp[nextT]);
    gl.viewport(0, 0, R, R);
    gl.useProgram(this.progStackOp);
    gl.bindVertexArray(this.engine.emptyVao);
    this._bindTex(this.progStackOp, 'uTerrainTex', this.engine.terrainTex[curT], 0);
    this._bindTex(this.progStackOp, 'uVecDispTex', this.vecDispTex[this.vecIdx], 1);
    this._bindTex(this.progStackOp, 'uSculptTex', sculptTex, 2);
    this._bindTex(this.progStackOp, 'uVelocityFieldTex', this.engine.velocityFieldTex, 3);

    gl.uniform4f(gl.getUniformLocation(this.progStackOp, 'uDomain'), span, R, maxRelief, opKind);
    gl.uniform4fv(gl.getUniformLocation(this.progStackOp, 'uParam0'), u0);
    gl.uniform4fv(gl.getUniformLocation(this.progStackOp, 'uParam1'), u1);
    gl.uniform4fv(gl.getUniformLocation(this.progStackOp, 'uParam2'), u2);
    gl.uniform4fv(gl.getUniformLocation(this.progStackOp, 'uMaskCfg1'), cfg1);
    gl.uniform4fv(gl.getUniformLocation(this.progStackOp, 'uMaskCfg2'), cfg2);

    if (opKind === 6) {
      const pts = Array.isArray(layer.params.points) ? layer.params.points : [];
      const count = Math.min(8, pts.length);
      const flat = new Float32Array(16);
      for (let k = 0; k < count; k++) {
        flat[k * 2 + 0] = pts[k][0];
        flat[k * 2 + 1] = pts[k][1];
      }
      gl.uniform4fv(gl.getUniformLocation(this.progStackOp, 'uSplinePts'), flat);
      gl.uniform1i(gl.getUniformLocation(this.progStackOp, 'uSplineCount'), count);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.engine.terrainIdx = nextT;
    this.vecIdx = nextT;
  }

  _bakeMaskTexture(mask, maxRelief) {
    const gl = this.gl;
    const R = this.R;
    const span = this.engine.params.worldSpan;
    const { cfg1, cfg2 } = this._packMaskUniforms(mask);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMask);
    gl.viewport(0, 0, R, R);
    gl.useProgram(this.progMaskBake);
    gl.bindVertexArray(this.engine.emptyVao);
    this._bindTex(this.progMaskBake, 'uTerrainTex', this.engine.terrainTex[this.engine.terrainIdx], 0);
    this._bindTex(this.progMaskBake, 'uVelocityFieldTex', this.engine.velocityFieldTex, 1);
    gl.uniform4f(gl.getUniformLocation(this.progMaskBake, 'uBakeDomain'), span, R, maxRelief, 0);
    gl.uniform4fv(gl.getUniformLocation(this.progMaskBake, 'uMaskCfg1'), cfg1);
    gl.uniform4fv(gl.getUniformLocation(this.progMaskBake, 'uMaskCfg2'), cfg2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _runMaskedSimulation(layer, maxRelief, runFn) {
    const hasMask = Boolean(layer.mask && layer.mask.enabled);
    if (hasMask) {
      this._copyTex(this.engine.terrainTex[this.engine.terrainIdx], this.fboPrevScratch);
      this._bakeMaskTexture(layer.mask, maxRelief);
    }

    runFn();

    if (hasMask) {
      const gl = this.gl;
      const curT = this.engine.terrainIdx;
      const nextT = 1 - curT;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.engine.fboTerrainSingle[nextT]);
      gl.viewport(0, 0, this.R, this.R);
      gl.useProgram(this.progMaskBlend);
      gl.bindVertexArray(this.engine.emptyVao);
      this._bindTex(this.progMaskBlend, 'uPrevTex', this.prevTerrainScratchTex, 0);
      this._bindTex(this.progMaskBlend, 'uNextTex', this.engine.terrainTex[curT], 1);
      this._bindTex(this.progMaskBlend, 'uMaskTex', this.maskTex, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.engine.terrainIdx = nextT;
    }
  }

  /**
   * FULL BOTTOM-TO-TOP PIPELINE EVALUATION!
   * Iterates from `layers.length - 1` (bottom) up to `0` (top), executing each enabled
   * Landform, Sculpt, Spline, Cave, Simulation, Rock-Placement, and Grass-Placement stage!
   */
  evaluateStack({ reseedPlacements = true, fastPreview = false } = {}) {
    const t0 = performance.now();
    const gl = this.gl;
    const R = this.R;
    const ep = this.engine.params;
    const span = ep.worldSpan;
    const maxRelief = this._maxReliefEstimate();

    ep.materialTheme = this.paletteId;
    ep.fabricMode = this.fabricMode;

    // Reset per-layer active simulation & placement flags before bottom-up walk
    ep.simHydraulicPlaying = false;
    ep.simCryoPlaying = false;
    ep.simWindPlaying = false;
    ep.simRockfallPlaying = false;
    ep.strataLayerEnabled = false;
    ep.snowLayerEnabled = false;
    ep.showOutcrops = false;
    ep.grassEnabled = false;
    ep.rainIntensity = 0.0;
    ep.headwaterFlow = 0.0;
    ep.oasisSpring = false;
    ep.snowfallRate = 0.0;
    ep.glacierStrength = 0.0;
    ep.windSpeed = 0.0;
    ep.dryAeolianMode = 0.0;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.engine.emptyVao);

    // 1. Clear working buffers at bottom of stack
    this.engine.terrainIdx = 0;
    this.engine.snowIdx = 0;
    this.engine.fluxIdx = 0;
    this.vecIdx = 0;
    this.hasActiveVecDisp = false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboStackOp[0]);
    gl.viewport(0, 0, R, R);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([8.0, 0.0, 0.0, 0.0]));
    gl.clearBufferfv(gl.COLOR, 1, new Float32Array([0.0, 0.0, 0.0, 0.0]));

    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.engine.fboFlux[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.engine.fboSnowClear[i]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Determine bottom seed early so particle cloud initializes deterministically
    const baseLayer = [...this.layers].reverse().find((l) => l.type === 'base-landform' && l.enabled);
    if (baseLayer) {
      ep.seed = baseLayer.params.seed ?? DEFAULT_EROSION_PARAMS.seed;
      ep.relief = baseLayer.params.relief ?? DEFAULT_EROSION_PARAMS.relief;
      ep.roughness = baseLayer.params.roughness ?? DEFAULT_EROSION_PARAMS.roughness;
    }

    const emitter = EMITTER_MODES[ep.emitterMode] || EMITTER_MODES['sky-rain'];
    gl.viewport(0, 0, PART_TEX_W, PART_TEX_H);
    gl.useProgram(this.engine.progInitParticles);
    gl.uniform4f(
      gl.getUniformLocation(this.engine.progInitParticles, 'uSpawnBox'),
      span,
      ep.cloudHeight,
      ep.seed,
      emitter.code
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.engine.fboInitParticles[0]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.engine.partIdx = 0;
    this.engine.stepCount = 0;

    const activeCaveLayers = [];
    const activeSculptCaveStrokes = [];
    let activeRockLayer = null;

    // 2. Walk strictly BOTTOM -> TOP (`i = layers.length - 1` down to `0`)!
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (!layer.enabled) continue;
      const p = layer.params;

      if (layer.type === 'base-landform') {
        ep.relief = p.relief ?? DEFAULT_EROSION_PARAMS.relief;
        ep.roughness = p.roughness ?? DEFAULT_EROSION_PARAMS.roughness;
        ep.seed = p.seed ?? DEFAULT_EROSION_PARAMS.seed;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.engine.fboTerrainSingle[this.engine.terrainIdx]);
        gl.viewport(0, 0, R, R);
        gl.useProgram(this.engine.progInitTerrain);
        gl.bindVertexArray(this.engine.emptyVao);
        gl.uniform4f(
          gl.getUniformLocation(this.engine.progInitTerrain, 'uInitParams'),
          ep.relief,
          ep.roughness,
          p.archetype ?? 6,
          ep.seed
        );
        gl.uniform1f(gl.getUniformLocation(this.engine.progInitTerrain, 'uWorldSpan'), span);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else if (layer.type === 'stratigraphic-beds') {
        ep.strataLayerEnabled = true;
        ep.rockHardness = p.rockHardness ?? DEFAULT_EROSION_PARAMS.rockHardness;
        ep.strataStrength = (p.strataStrength ?? DEFAULT_EROSION_PARAMS.strataStrength) * (p.opacity ?? 1.0);
        ep.strataFreq = p.strataFreq ?? DEFAULT_EROSION_PARAMS.strataFreq;
        ep.strataDip = p.strataDip ?? DEFAULT_EROSION_PARAMS.strataDip;
        ep.strataStrike = p.strataStrike ?? DEFAULT_EROSION_PARAMS.strataStrike;
        ep.faultWeakness = p.faultWeakness ?? DEFAULT_EROSION_PARAMS.faultWeakness;

        const terrace = p.terraceCarve ?? 0.0;
        const overhang = p.ledgeOverhang ?? 0.0;
        if (terrace > 0.001 || overhang > 0.001) {
          if (overhang > 0.005) this.hasActiveVecDisp = true;
          this._runStackOpPass(
            2,
            layer,
            [ep.strataFreq, terrace, ep.strataStrength, ep.strataDip],
            [ep.strataStrike, 0.25, overhang, p.opacity ?? 1.0],
            [p.seed ?? ep.seed, 0, 0, 0],
            maxRelief
          );
        }
      } else if (layer.type === 'mountain-ridges') {
        this._runStackOpPass(
          1,
          layer,
          [p.generator ?? 0, p.combineMode ?? 0, p.amplitude ?? 48, p.scale ?? 2.2],
          [p.sharpness ?? 0.60, p.azimuth ?? 28, p.opacity ?? 1.0, 0],
          [p.seed ?? ep.seed, 0, 0, 0],
          maxRelief
        );
      } else if (layer.type === 'rock-stacks') {
        if ((p.caprockOverhang ?? 0.45) > 0.005 || (p.lean ?? 0.28) > 0.005) {
          this.hasActiveVecDisp = true;
        }
        this._runStackOpPass(
          3,
          layer,
          [p.height ?? 48, p.spacing ?? 68, p.radius ?? 15, p.taper ?? 0.42],
          [p.tiers ?? 5, p.lean ?? 0.28, p.leanAzimuth ?? 35, p.caprockOverhang ?? 0.45],
          [p.opacity ?? 1.0, p.seed ?? ep.seed, 0, 0],
          maxRelief
        );
      } else if (layer.type === 'cliff-push-pull') {
        if ((p.displacement ?? 10.5) > 0.01) {
          this.hasActiveVecDisp = true;
        }
        this._runStackOpPass(
          4,
          layer,
          [p.displacement ?? 10.5, p.featureScale ?? 2.6, p.slopeThreshold ?? 28, p.ledgeStrength ?? 0.62],
          [p.overhangBias ?? 0.52, p.verticalCrease ?? 0.58, p.opacity ?? 1.0, p.seed ?? ep.seed],
          [0, 0, 0, 0],
          maxRelief
        );
      } else if (layer.type === 'sculpt-layer') {
        const entry = this.sculptStore.get(layer.id);
        if (entry) {
          for (const cs of entry.caveStrokes) activeSculptCaveStrokes.push(cs);
          if ((p.strokeCount ?? 0) > 0) {
            this._runStackOpPass(5, layer, [p.opacity ?? 1.0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], maxRelief);
          }
        }
      } else if (layer.type === 'spline-feature') {
        this._runStackOpPass(
          6,
          layer,
          [p.mode ?? 0, p.width ?? 44, p.depth ?? 48, p.wallSteepness ?? 0.74],
          [p.meanderAmp ?? 0.32, p.waterFill ?? 0.28, p.bankFalloff ?? 0.55, p.opacity ?? 1.0],
          [0, 0, 0, 0],
          maxRelief
        );
      } else if (layer.type === 'sdf-caves') {
        activeCaveLayers.push(layer);
      } else if (layer.type === 'river-incision') {
        const steps = Math.max(1, Math.min(80, Math.round((p.iterations ?? 20) * (fastPreview ? 0.5 : 1.0))));
        this._runMaskedSimulation(layer, maxRelief, () => {
          const prevFlags = {
            h: ep.simHydraulicPlaying,
            c: ep.simCryoPlaying,
            w: ep.simWindPlaying,
            r: ep.simRockfallPlaying,
            rain: ep.rainIntensity,
            erod: ep.erosionStrength,
            hw: ep.headwaterFlow,
            lake: ep.lakeRetention,
          };
          ep.simHydraulicPlaying = true;
          ep.simCryoPlaying = false;
          ep.simWindPlaying = false;
          ep.simRockfallPlaying = false;
          ep.rainIntensity = p.headwaterRain ?? 0.68;
          ep.erosionStrength = p.incisionStrength ?? 0.85;
          ep.headwaterFlow = Math.max(ep.headwaterFlow, (p.headwaterRain ?? 0.68) * 0.65);
          ep.lakeRetention = p.basinPooling ?? 0.45;
          this.engine.stepSimulation(steps, { skipTelemetry: true });
          ep.simHydraulicPlaying = prevFlags.h;
          ep.simCryoPlaying = prevFlags.c;
          ep.simWindPlaying = prevFlags.w;
          ep.simRockfallPlaying = prevFlags.r;
          ep.rainIntensity = prevFlags.rain;
          ep.erosionStrength = prevFlags.erod;
          ep.headwaterFlow = prevFlags.hw;
          ep.lakeRetention = prevFlags.lake;
        });
      } else if (layer.type === 'hydraulic-erosion') {
        ep.rainIntensity = p.rainIntensity ?? DEFAULT_EROSION_PARAMS.rainIntensity;
        ep.erosionStrength = p.erosionStrength ?? DEFAULT_EROSION_PARAMS.erosionStrength;
        ep.sedimentCapacity = p.sedimentCapacity ?? DEFAULT_EROSION_PARAMS.sedimentCapacity;
        ep.depositionRate = p.depositionRate ?? DEFAULT_EROSION_PARAMS.depositionRate;
        ep.evaporation = p.evaporation ?? DEFAULT_EROSION_PARAMS.evaporation;
        ep.headwaterFlow = p.headwaterFlow ?? 0;
        ep.lakeRetention = p.lakeRetention ?? 0.4;
        ep.oasisSpring = Boolean(p.oasisSpring);
        ep.simHydraulicPlaying = true;

        const bakeSteps = Math.max(0, Math.min(120, Math.round((p.bakeSteps ?? 0) * (fastPreview ? 0.5 : 1.0))));
        if (bakeSteps > 0) {
          this._runMaskedSimulation(layer, maxRelief, () => {
            const prevC = ep.simCryoPlaying, prevW = ep.simWindPlaying, prevR = ep.simRockfallPlaying;
            ep.simCryoPlaying = false;
            ep.simWindPlaying = false;
            ep.simRockfallPlaying = false;
            this.engine.stepSimulation(bakeSteps, { skipTelemetry: true });
            ep.simCryoPlaying = prevC;
            ep.simWindPlaying = prevW;
            ep.simRockfallPlaying = prevR;
          });
        }
      } else if (layer.type === 'thermal-talus') {
        ep.talusAngle = p.talusAngle ?? DEFAULT_EROSION_PARAMS.talusAngle;
        ep.rockfallRate = p.rockfallRate ?? DEFAULT_EROSION_PARAMS.rockfallRate;
        ep.simRockfallPlaying = true;

        const bakePasses = Math.max(0, Math.min(80, Math.round((p.bakePasses ?? 0) * (fastPreview ? 0.5 : 1.0))));
        if (bakePasses > 0) {
          this._runMaskedSimulation(layer, maxRelief, () => {
            this.engine.stepThermalTalusOnly(bakePasses);
          });
        }
      } else if (layer.type === 'aeolian-glacial') {
        ep.snowline = p.snowline ?? DEFAULT_EROSION_PARAMS.snowline;
        ep.snowfallRate = p.snowfallRate ?? 0.0;
        ep.glacierStrength = p.glacierStrength ?? 0.0;
        ep.iceMeltRate = p.iceMeltRate ?? DEFAULT_EROSION_PARAMS.iceMeltRate;
        ep.windSpeed = p.windSpeed ?? 0.0;
        ep.windAzimuth = p.windAzimuth ?? DEFAULT_EROSION_PARAMS.windAzimuth;
        ep.dryAeolianMode = p.dryAeolianMode ?? 0.0;
        ep.snowLayerEnabled = true;
        ep.simCryoPlaying = ep.snowfallRate > 0.015 || ep.glacierStrength > 0.015;
        ep.simWindPlaying = ep.windSpeed > 0.03;

        // Seed snowpack & valley glaciers (`progInitSnow`) on the terrain constructed up to this stage!
        this.engine.seedInitialSnow();

        const bakePasses = Math.max(0, Math.min(64, Math.round((p.bakePasses ?? 0) * (fastPreview ? 0.5 : 1.0))));
        if (bakePasses > 0) {
          this._runMaskedSimulation(layer, maxRelief, () => {
            const prevH = ep.simHydraulicPlaying, prevR = ep.simRockfallPlaying;
            ep.simHydraulicPlaying = false;
            ep.simRockfallPlaying = false;
            this.engine.stepSimulation(bakePasses, { skipTelemetry: true });
            ep.simHydraulicPlaying = prevH;
            ep.simRockfallPlaying = prevR;
          });
        }
      } else if (layer.type === 'rock-placement') {
        activeRockLayer = layer;
      } else if (layer.type === 'vegetation-placement') {
        ep.grassEnabled = true;
        ep.grassMode = p.species ?? 0;
        ep.grassDensity = p.density ?? 0.55;
        ep.grassHeight = p.bladeHeight ?? 1.15;
        ep.grassSlopeMax = p.slopeMax ?? 0.62;
        ep.grassElevMax = p.elevationMax ?? 0.52;
        ep.grassPatchiness = p.patchiness ?? 0.58;
        ep.grassWindSway = p.windSway ?? 0.65;
        ep.grassDryBlend = p.dryBlend ?? (p.species === 1 ? 0.85 : 0.14);
      }
    }

    // 3. Copy evaluated initial terrain into `engine.initialTerrainTex` (ANGLE-safe shader copy!)
    this._copyTex(this.engine.terrainTex[this.engine.terrainIdx], this.engine.fboInitialTerrain);

    // 4. Bake Selected Layer's B&W Mask Preview Texture (`uViewMode == 7`)
    const sel = this.getSelectedLayer();
    const previewMask = sel?.mask?.enabled
      ? sel.mask
      : { enabled: true, ...(sel?.mask || { mode: 'height', min: 0.2, max: 0.85, feather: 0.15 }) };
    this._bakeMaskTexture(previewMask, maxRelief);

    // 5. Read back fast 64x64 snapshot for 3D SDF Caves, Rock Placement & Telemetry!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.engine.fboTelemetry);
    gl.viewport(0, 0, this.snapN, this.snapN);
    gl.useProgram(this.engine.progTelemetry);
    gl.bindVertexArray(this.engine.emptyVao);
    this._bindTex(this.engine.progTelemetry, 'uTerrainTex', this.engine.terrainTex[this.engine.terrainIdx], 0);
    gl.uniform1f(gl.getUniformLocation(this.engine.progTelemetry, 'uGridRes'), R);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.snapN, this.snapN, gl.RGBA, gl.FLOAT, this.snapBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.engine.initialSnap64.set(this.snapBuf);

    // 6. Rebuild 3D Volumetric SDF Caves & Cliff Undercuts + Upload Portal Mask Texture
    const caveRes = this.caveSystem.rebuildCaveVolume({
      gridRgba: this.snapBuf,
      gridN: this.snapN,
      worldSpan: span,
      caveLayers: activeCaveLayers,
      sculptCaveStrokes: activeSculptCaveStrokes,
      maxRelief,
    });
    const P = this.caveSystem.portalMaskSize;
    gl.bindTexture(gl.TEXTURE_2D, this.cavePortalTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, P, P, 0, gl.RGBA, gl.FLOAT, this.caveSystem.portalTexData);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (caveRes.vertexCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cavePosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.caveSystem.positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.caveNrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.caveSystem.normals, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.caveAttBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.caveSystem.attribs, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // 7. Update Rock Placement Layer & Telemetry
    this.engine.rockCalving.updateTerrainSnapshot(this.snapBuf, this.snapN, span);
    if (activeRockLayer && reseedPlacements) {
      ep.showOutcrops = true;
      ep.boulderDensity = activeRockLayer.params.density ?? DEFAULT_EROSION_PARAMS.boulderDensity;
      ep.rockfallRate = activeRockLayer.params.talusAffinity ?? ep.rockfallRate;
      const prevSeed = ep.seed;
      ep.seed = activeRockLayer.params.seed ?? prevSeed;
      this.engine.rockCalving.seedForLandscape(ep);
      ep.seed = prevSeed;
      const settle = Math.max(0, Math.min(60, Math.round(activeRockLayer.params.settleSteps ?? 0)));
      for (let s = 0; s < settle; s++) {
        this.engine.rockCalving.stepPhysics(0.04, true);
      }
    } else if (activeRockLayer) {
      ep.showOutcrops = true;
    } else {
      ep.showOutcrops = false;
    }

    gl.bindVertexArray(null);
    this.lastEvalMs = Math.max(0.1, performance.now() - t0);
    this._publishTelemetry();
  }

  _publishTelemetry() {
    const cellArea = Math.pow(this.engine.params.worldSpan / this.snapN, 2);
    let coarseM3 = 0, fineM3 = 0, waterM3 = 0;
    for (let i = 0; i < this.snapBuf.length; i += 4) {
      coarseM3 += Math.max(0, this.snapBuf[i + 1]) * cellArea;
      fineM3 += Math.max(0, this.snapBuf[i + 2]) * cellArea;
      waterM3 += Math.max(0, this.snapBuf[i + 3]) * cellArea;
    }
    this.engine.telemetry.steps = this.engine.stepCount;
    this.engine.telemetry.erodedVolumeM3 = 0;
    this.engine.telemetry.coarseSedM3 = Math.round(coarseM3);
    this.engine.telemetry.fineSedM3 = Math.round(fineM3);
    this.engine.telemetry.waterVolumeM3 = Math.round(waterM3);
    this.engine.telemetry.boulders = this.engine.rockCalving.rocks.length;
    this.engine.telemetry.particles = this.engine.params.particleCount;
    this.engine.telemetry.evalMs = Number(this.lastEvalMs.toFixed(1));
    this.engine.telemetry.layerCount = this.layers.length;
    this.engine.telemetry.caveTris = Math.round(this.caveSystem.vertexCount / 3);
    if (this.engine.onTelemetry) this.engine.onTelemetry(this.engine.telemetry);
  }

  projectWorldToScreen(wx, wy, wz) {
    const m = this.lastViewProj;
    if (!m) return null;
    const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
    const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
    if (cw <= 0.1) return null;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      u: ndcX * 0.5 + 0.5,
      v: 0.5 - ndcY * 0.5,
    };
  }

  _resolveEngineViewCode() {
    // Maps toolbar shadingMode -> `TERRAIN_RENDER_FRAG` `uViewMode`
    switch (this.shadingMode) {
      case 0: return 0; // Derived Geology (Natural)
      case 1: return 8; // AO & Ridge Protrusions
      case 2: return 2; // 3D Rock Hardness & Strata
      case 3: return 3; // Drainage Flow & Velocity
      case 4: return 1; // Sedimentation & Cut/Fill
      case 5: return 7; // Selected Layer B&W Mask
      case 6: return 4; // Pure Sculptor Clay
      case 7: return 5; // Cryosphere (Snow & Glacier Ice)
      case 8: return 6; // 2.5D Hydrology & Basins
      default: return 0;
    }
  }

  /**
   * Renders the terrain using `c5ae88b` / `2cc3d34`'s exact `progSkyBg`, `progTerrainRender`,
   * `progRockInstance`, `progGrassInstance`, and `progParticleRender`, plus `progCave` when
   * 3D SDF Caves / Cliff Undercuts are active in the stack!
   */
  renderPipelineFrame(viewProj, eye, sunDir, timeSec) {
    this.lastViewProj = viewProj;
    const gl = this.gl;
    const R = this.R;
    const p = this.engine.params;
    p.materialTheme = this.paletteId;
    p.fabricMode = this.fabricMode;

    const maxRelief = this._maxReliefEstimate();
    const viewCode = this._resolveEngineViewCode();
    const hasCaves = this.caveSystem.vertexCount > 0;

    if (viewCode === 7) {
      const sel = this.getSelectedLayer();
      const previewMask = sel?.mask?.enabled
        ? sel.mask
        : { enabled: true, ...(sel?.mask || { mode: 'height', min: 0.2, max: 0.85, feather: 0.15 }) };
      this._bakeMaskTexture(previewMask, maxRelief);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.engine.canvas.width, this.engine.canvas.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // 1. Studio Sky Backdrop (`progSkyBg`)
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(this.engine.progSkyBg);
    gl.uniform1i(gl.getUniformLocation(this.engine.progSkyBg, 'uMaterialTheme'), this.engine._themeCode());
    gl.bindVertexArray(this.engine.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Proven Geological Terrain Renderer (`progTerrainRender` from `erosion-shaders.js`!)
    const { hardnessVec, strataVec } = this.engine._getHardnessUniforms();
    const layerVisVec = this.engine._getLayerVisUniforms();
    const climate = this.engine._getClimateUniforms();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    if (this.hasActiveVecDisp || hasCaves) {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    gl.useProgram(this.engine.progTerrainRender);
    gl.bindVertexArray(this.engine.terrainVao);

    this.engine._bindTex(this.engine.progTerrainRender, 'uTerrainTex', this.engine.terrainTex[this.engine.terrainIdx], 0);
    this.engine._bindTex(this.engine.progTerrainRender, 'uInitialTex', this.engine.initialTerrainTex, 1);
    this.engine._bindTex(this.engine.progTerrainRender, 'uVelocityFieldTex', this.engine.velocityFieldTex, 2);
    this.engine._bindTex(this.engine.progTerrainRender, 'uSnowTex', this.engine.snowTex[this.engine.snowIdx], 3);
    this.engine._bindTex(this.engine.progTerrainRender, 'uVecDispTex', this.vecDispTex[this.vecIdx], 4);
    this.engine._bindTex(this.engine.progTerrainRender, 'uCavePortalTex', this.cavePortalTex, 5);
    this.engine._bindTex(this.engine.progTerrainRender, 'uMaskPreviewTex', this.maskTex, 6);

    gl.uniformMatrix4fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uCameraPos'), eye);
    gl.uniform3fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uSunDir'), sunDir);
    gl.uniform4f(
      gl.getUniformLocation(this.engine.progTerrainRender, 'uRenderDomain'),
      p.worldSpan,
      R,
      (p.showWater && p.waterLayerEnabled !== false) ? 1.0 : 0.0,
      timeSec
    );
    gl.uniform4fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uLayerVis'), layerVisVec);
    gl.uniform4fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uHardnessParams'), hardnessVec);
    gl.uniform4fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uStrataOrient'), strataVec);

    const sel = this.getSelectedLayer();
    const isSculptTool = this.authorTool.startsWith('sculpt-') || this.authorTool.startsWith('cave-');
    const brushRad = sel?.type === 'sculpt-layer' ? (sel.params.brushRadius ?? 34) : p.brushRadius;
    const brushCode = isSculptTool ? (this.authorTool.startsWith('cave-') ? 3 : 2) : 0;
    gl.uniform4f(
      gl.getUniformLocation(this.engine.progTerrainRender, 'uBrush'),
      this.engine.pointerWorldXZ[0],
      this.engine.pointerWorldXZ[1],
      brushRad,
      brushCode
    );
    gl.uniform1i(gl.getUniformLocation(this.engine.progTerrainRender, 'uViewMode'), viewCode);
    gl.uniform1i(gl.getUniformLocation(this.engine.progTerrainRender, 'uMaterialTheme'), this.engine._themeCode());
    gl.uniform1i(gl.getUniformLocation(this.engine.progTerrainRender, 'uFabricMode'), this.engine._fabricCode());
    gl.uniform4fv(gl.getUniformLocation(this.engine.progTerrainRender, 'uClimate'), climate.snowVec);
    gl.uniform4f(
      gl.getUniformLocation(this.engine.progTerrainRender, 'uWindRender'),
      climate.windVec[0],
      climate.windVec[1],
      p.windSpeed || 0.0,
      p.dryAeolianMode || 0.0
    );
    gl.uniform1f(gl.getUniformLocation(this.engine.progTerrainRender, 'uSeed'), p.seed);
    gl.uniform1f(gl.getUniformLocation(this.engine.progTerrainRender, 'uUseVecDisp'), this.hasActiveVecDisp ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(this.engine.progTerrainRender, 'uHasCaves'), hasCaves ? 1.0 : 0.0);

    gl.drawElements(gl.TRIANGLES, this.engine.terrainIndexCount, gl.UNSIGNED_INT, 0);

    // 3. Real 3D Volumetric SDF Cave & Cliff-Undercut Interior Mesh (when active)
    if (hasCaves) {
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.progCave);
      gl.bindVertexArray(this.caveVao);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progCave, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.progCave, 'uCameraPos'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.progCave, 'uSunDir'), sunDir);
      gl.uniform4f(gl.getUniformLocation(this.progCave, 'uRenderDomain'), p.worldSpan, R, 1.0, maxRelief);
      gl.uniform2i(gl.getUniformLocation(this.progCave, 'uShadeConfig'), this.engine._themeCode(), viewCode);
      gl.drawArrays(gl.TRIANGLES, 0, this.caveSystem.vertexCount);
    }

    // 4. 3D Polyhedral Outcrops & Gravity-Settled Cliff-Calved Boulders (`progRockInstance`)
    if (p.showOutcrops !== false && this.engine.rockCalving.rocks.length > 0 && viewCode !== 7) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(this.engine.progRockInstance);
      gl.bindVertexArray(this.engine.rockVao);

      this.engine._bindTex(this.engine.progRockInstance, 'uTerrainTex', this.engine.terrainTex[this.engine.terrainIdx], 0);
      this.engine._bindTex(this.engine.progRockInstance, 'uSnowTex', this.engine.snowTex[this.engine.snowIdx], 1);

      gl.uniformMatrix4fv(gl.getUniformLocation(this.engine.progRockInstance, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.engine.progRockInstance, 'uCameraPos'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.engine.progRockInstance, 'uSunDir'), sunDir);
      gl.uniform4f(
        gl.getUniformLocation(this.engine.progRockInstance, 'uRenderDomain'),
        p.worldSpan,
        R,
        (p.showWater && p.waterLayerEnabled !== false) ? 1.0 : 0.0,
        timeSec
      );
      gl.uniform4fv(gl.getUniformLocation(this.engine.progRockInstance, 'uLayerVis'), layerVisVec);
      gl.uniform4fv(gl.getUniformLocation(this.engine.progRockInstance, 'uHardnessParams'), hardnessVec);
      gl.uniform4fv(gl.getUniformLocation(this.engine.progRockInstance, 'uStrataOrient'), strataVec);
      gl.uniform4fv(gl.getUniformLocation(this.engine.progRockInstance, 'uClimate'), climate.snowVec);
      gl.uniform1i(gl.getUniformLocation(this.engine.progRockInstance, 'uViewMode'), viewCode === 8 ? 0 : viewCode);
      gl.uniform1i(gl.getUniformLocation(this.engine.progRockInstance, 'uMaterialTheme'), this.engine._themeCode());
      gl.uniform1i(gl.getUniformLocation(this.engine.progRockInstance, 'uFabricMode'), this.engine._fabricCode());
      gl.uniform1f(gl.getUniformLocation(this.engine.progRockInstance, 'uSeed'), p.seed);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.engine.rockInstVbo);
      const subs = this.engine.rockCalving.atlas.submeshes;
      for (let b = 0; b < subs.length; b++) {
        const count = this.engine.rockCalving.bucketCounts[b];
        if (count <= 0) continue;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.engine.rockCalving.bucketData[b].subarray(0, count * 16));
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

    // 5. Real 3D GPU-Instanced Grass Vegetation Layer (`progGrassInstance`)
    if (p.grassEnabled && (p.grassDensity ?? 0.5) > 0.01 && (viewCode === 0 || viewCode === 4)) {
      const tuftCount = Math.max(512, Math.min(MAX_GRASS_TUFTS, Math.round((p.grassDensity ?? 0.55) * MAX_GRASS_TUFTS)));
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.engine.progGrassInstance);
      gl.bindVertexArray(this.engine.grassVao);

      this.engine._bindTex(this.engine.progGrassInstance, 'uTerrainTex', this.engine.terrainTex[this.engine.terrainIdx], 0);
      this.engine._bindTex(this.engine.progGrassInstance, 'uSnowTex', this.engine.snowTex[this.engine.snowIdx], 1);

      gl.uniformMatrix4fv(gl.getUniformLocation(this.engine.progGrassInstance, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.engine.progGrassInstance, 'uCameraPos'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.engine.progGrassInstance, 'uSunDir'), sunDir);
      gl.uniform4f(
        gl.getUniformLocation(this.engine.progGrassInstance, 'uRenderDomain'),
        p.worldSpan,
        R,
        p.showWater ? 1.0 : 0.0,
        timeSec
      );
      gl.uniform4f(
        gl.getUniformLocation(this.engine.progGrassInstance, 'uGrassParams'),
        tuftCount,
        p.grassHeight ?? 1.15,
        p.grassWindSway ?? 0.65,
        p.grassSlopeMax ?? 0.62
      );
      gl.uniform4f(
        gl.getUniformLocation(this.engine.progGrassInstance, 'uGrassStyle'),
        p.grassMode ?? 0,
        p.grassDryBlend ?? 0.15,
        p.grassElevMax ?? 0.52,
        p.grassPatchiness ?? 0.58
      );
      gl.uniform4f(
        gl.getUniformLocation(this.engine.progGrassInstance, 'uWindRender'),
        climate.windVec[0],
        climate.windVec[1],
        p.windSpeed || 0.25,
        p.dryAeolianMode || 0.0
      );
      gl.uniform4fv(gl.getUniformLocation(this.engine.progGrassInstance, 'uStrataOrient'), strataVec);
      gl.uniform1i(gl.getUniformLocation(this.engine.progGrassInstance, 'uViewMode'), viewCode);
      gl.uniform1i(gl.getUniformLocation(this.engine.progGrassInstance, 'uMaterialTheme'), this.engine._themeCode());
      gl.uniform1f(gl.getUniformLocation(this.engine.progGrassInstance, 'uSeed'), p.seed);

      gl.drawElementsInstanced(gl.TRIANGLES, this.engine.grassIndexCount, gl.UNSIGNED_SHORT, 0, tuftCount);
      gl.enable(gl.CULL_FACE);
    }

    // 6. 3D Falling Sky Raindrops, Snow, Wind Sand & Runoff Particles (`progParticleRender`)
    if (this.liveSimRunning && p.showParticles && p.particleOpacity > 0.01 && climate.anyParticleSpecies && viewCode !== 7) {
      const activeCount = Math.min(MAX_GPU_PARTICLES, Math.max(1024, Math.floor(p.particleCount)));
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(this.engine.progParticleRender);
      gl.bindVertexArray(this.engine.emptyVao);

      this.engine._bindTex(this.engine.progParticleRender, 'uPosAgeTex', this.engine.partPosAge[this.engine.partIdx], 0);
      this.engine._bindTex(this.engine.progParticleRender, 'uVelWaterTex', this.engine.partVelWater[this.engine.partIdx], 1);
      this.engine._bindTex(this.engine.progParticleRender, 'uSedimentTex', this.engine.partSediment[this.engine.partIdx], 2);
      this.engine._bindTex(this.engine.progParticleRender, 'uTerrainTex', this.engine.terrainTex[this.engine.terrainIdx], 3);

      gl.uniformMatrix4fv(gl.getUniformLocation(this.engine.progParticleRender, 'uViewProj'), false, viewProj);
      gl.uniform3fv(gl.getUniformLocation(this.engine.progParticleRender, 'uCameraPos'), eye);
      gl.uniform4f(
        gl.getUniformLocation(this.engine.progParticleRender, 'uPartVis'),
        p.worldSpan,
        R,
        p.particleOpacity,
        activeCount
      );

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    gl.bindVertexArray(null);
  }
}

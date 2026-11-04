// GPU side of the clipmap: the shared brick atlas, scratch buffer, page table and coastline texture,
// plus the passes that generate, upload, read back and sculpt bricks.
import { BRICK, POOL } from '../config.ts';
import type { ClipBackend, ClipmapResidency } from '../clipmap/residency.ts';
import { GRID, LEVELS, PAGE_DIMS, atlasDims, cellSize, posMod, slotOrigin, type V3 } from '../clipmap/layout.ts';
import type { CoastField } from '../world/coastField.ts';
import { Program } from './gl.ts';
import { COPY_FS, GEN_FS, SCULPT_FS } from './shaders/passes.ts';
import { MACRO } from '../world/macroParams.ts';

const T = BRICK.texels;

export interface SculptBrick {
  slot: number;
  level: number;
  /** Camera-relative metres of brick cell 0 (f64 → f32 here). */
  rel: V3;
}

export interface DabUniforms {
  tool: number;
  center: V3;
  normal: V3;
  radius: number;
  amount: number;
  flatY: number;
  smoothOff: number;
}

export class ClipAtlas implements ClipBackend {
  readonly gl: WebGL2RenderingContext;
  readonly atlas: WebGLTexture;
  readonly page: WebGLTexture;
  readonly coast: WebGLTexture;
  readonly gen: Program;
  readonly copy: Program;
  readonly sculpt: Program;
  private readonly scratch: WebGLTexture;
  private readonly fboAtlas: WebGLFramebuffer;
  private readonly fboScratch: WebGLFramebuffer;
  private readonly atlasDims: V3;
  readonly bytes: number;

  constructor(gl: WebGL2RenderingContext, coast: CoastField) {
    this.gl = gl;
    const [w, h, d] = atlasDims();
    this.atlasDims = [w, h, d];
    this.atlas = mustTex(gl);
    gl.bindTexture(gl.TEXTURE_3D, this.atlas);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, w, h, d);
    this.configureFilter(gl.TEXTURE_3D, gl.LINEAR);

    this.scratch = mustTex(gl);
    gl.bindTexture(gl.TEXTURE_3D, this.scratch);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, T, T, T * POOL.scratchBricks);
    this.configureFilter(gl.TEXTURE_3D, gl.NEAREST);

    this.page = mustTex(gl);
    gl.bindTexture(gl.TEXTURE_3D, this.page);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16I, PAGE_DIMS[0], PAGE_DIMS[1], PAGE_DIMS[2]);
    this.configureFilter(gl.TEXTURE_3D, gl.NEAREST);

    this.coast = mustTex(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.coast);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, coast.n, coast.n);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, coast.n, coast.n, gl.RED, gl.FLOAT, coast.data);
    this.configureFilter(gl.TEXTURE_2D, gl.LINEAR);

    this.fboAtlas = mustFbo(gl);
    this.fboScratch = mustFbo(gl);

    this.gen = new Program(gl, GEN_FS, 'gen');
    this.copy = new Program(gl, COPY_FS, 'copy');
    this.sculpt = new Program(gl, SCULPT_FS, 'sculpt');
    for (const p of [this.gen, this.sculpt]) {
      p.use();
      gl.uniform1i(gl.getUniformLocation(p.prog, 'uAtlas'), 0);
      gl.uniform1i(gl.getUniformLocation(p.prog, 'uPage'), 1);
      gl.uniform1i(gl.getUniformLocation(p.prog, 'uCoast'), 2);
    }
    this.copy.use();
    gl.uniform1i(gl.getUniformLocation(this.copy.prog, 'uScratch'), 3);

    this.bytes = w * h * d * 2 + T * T * T * POOL.scratchBricks * 2 + PAGE_DIMS.reduce((a, b) => a * b, 1) * 2
      + coast.n * coast.n * 2;
  }

  private configureFilter(target: number, filter: number): void {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  /** Bind the sampler units used by the clip-sampling chunk: 0 atlas, 1 page, 2 coast. */
  bindClipTextures(atlasUnit: boolean): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, atlasUnit ? this.atlas : null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.page);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.coast);
  }

  /** Camera-dependent level uniforms shared by the raymarcher and the sculpt pass. */
  applyClipUniforms(p: Program, res: ClipmapResidency, cam: V3): void {
    const origin = new Float32Array(LEVELS * 3);
    const cell = new Float32Array(LEVELS);
    const phase = new Int32Array(LEVELS * 3);
    for (let lv = 0; lv < LEVELS; lv++) {
      const b = res.base[lv];
      const bs = cellSize(lv) * BRICK.cells;
      const have = !Number.isNaN(b[0]);
      for (let a = 0; a < 3; a++) {
        const base = have ? b[a] : 0;
        origin[lv * 3 + a] = base * bs - cam[a];
        phase[lv * 3 + a] = posMod(base, GRID[a]);
      }
      cell[lv] = cellSize(lv);
    }
    p.fv3('uLevelOrigin[0]', origin);
    p.fv1('uLevelCell[0]', cell);
    p.iv3a('uLevelPhase[0]', phase);
    p.v3('uAtlasInvSize', 1 / this.atlasDims[0], 1 / this.atlasDims[1], 1 / this.atlasDims[2]);
    p.v3('uCamWorld', cam[0], cam[1], cam[2]);
  }

  // ------------------------------------------------------------ ClipBackend

  generate(slot: number, level: number, x: number, y: number, z: number): void {
    const gl = this.gl;
    const [ox, oy, oz] = slotOrigin(slot);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboAtlas);
    gl.viewport(ox, oy, T, T);
    this.bindClipTextures(false);
    this.gen.use();
    this.gen.iv3('uBaseCell', x * BRICK.cells, y * BRICK.cells, z * BRICK.cells);
    this.gen.f('uCell', cellSize(level));
    this.gen.f('uFineAmp', level <= 2 ? MACRO.fineAmpM : 0);
    this.gen.iv2('uOrigin', ox, oy);
    for (let z2 = 0; z2 < T; z2++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.atlas, 0, oz + z2);
      this.gen.i('uSlice', z2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  upload(slot: number, data: Float32Array): void {
    const gl = this.gl;
    const [ox, oy, oz] = slotOrigin(slot);
    gl.activeTexture(gl.TEXTURE7); // spare unit: never disturb the sampler bindings 0..3
    gl.bindTexture(gl.TEXTURE_3D, this.atlas);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, ox, oy, oz, T, T, T, gl.RED, gl.FLOAT, data);
  }

  readback(slot: number): Float32Array {
    const gl = this.gl;
    const [ox, oy, oz] = slotOrigin(slot);
    const out = new Float32Array(T * T * T);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboAtlas);
    for (let z = 0; z < T; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.atlas, 0, oz + z);
      gl.readPixels(ox, oy, T, T, gl.RED, gl.FLOAT, out, z * T * T);
    }
    return out;
  }

  writePage(codes: Int16Array): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_3D, this.page);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, PAGE_DIMS[0], PAGE_DIMS[1], PAGE_DIMS[2], gl.RED_INTEGER, gl.SHORT, codes);
  }

  // ------------------------------------------------------------ sculpting

  /**
   * Two-phase edit so every brick reads the same, pre-edit neighbourhood:
   *  A) each brick is evaluated into its own scratch block (reads the atlas, writes scratch)
   *  B) scratch blocks are copied back into their atlas slots.
   */
  sculptBricks(bricks: SculptBrick[], dab: DabUniforms, res: ClipmapResidency, cam: V3, cellM: number[]): void {
    if (bricks.length === 0) return;
    if (bricks.length > POOL.scratchBricks) throw new Error('sculpt batch exceeds scratch capacity');
    const gl = this.gl;
    const p = this.sculpt;

    gl.activeTexture(gl.TEXTURE3); // scratch is about to be rendered into: never leave it sampled
    gl.bindTexture(gl.TEXTURE_3D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScratch);
    gl.viewport(0, 0, T, T);
    this.bindClipTextures(true);
    p.use();
    this.applyClipUniforms(p, res, cam);
    p.i('uTool', dab.tool);
    p.v3('uBrushC', dab.center[0] - cam[0], dab.center[1] - cam[1], dab.center[2] - cam[2]);
    p.v3('uBrushN', dab.normal[0], dab.normal[1], dab.normal[2]);
    p.f('uBrushR', dab.radius);
    p.f('uAmount', dab.amount);
    p.f('uFlatY', dab.flatY);
    p.f('uSmoothOff', dab.smoothOff);

    bricks.forEach((b, k) => {
      const [ox, oy, oz] = slotOrigin(b.slot);
      p.iv3('uSrcOrigin', ox, oy, oz);
      p.v3('uBrickRel', b.rel[0], b.rel[1], b.rel[2]);
      p.f('uCell', cellM[b.level]);
      for (let z = 0; z < T; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.scratch, 0, k * T + z);
        p.i('uSlice', z);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboAtlas);
    this.bindClipTextures(false);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, this.scratch);
    this.copy.use();
    bricks.forEach((b, k) => {
      const [ox, oy, oz] = slotOrigin(b.slot);
      gl.viewport(ox, oy, T, T);
      this.copy.iv2('uDstXY', ox, oy);
      this.copy.iv3('uSrcOrigin', 0, 0, k * T);
      for (let z = 0; z < T; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.atlas, 0, oz + z);
        this.copy.i('uSlice', z);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function mustTex(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('createTexture failed');
  return t;
}

function mustFbo(gl: WebGL2RenderingContext): WebGLFramebuffer {
  const f = gl.createFramebuffer();
  if (!f) throw new Error('createFramebuffer failed');
  return f;
}

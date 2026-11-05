// Full-screen raymarcher over the clipmap (clip sampling only; no macro field at run time), plus a 1-pixel pick pass.
import { RAYMARCH_FS } from './shaders/passes.ts';
import { Program } from './gl.ts';
import type { ClipAtlas } from './atlas.ts';
import type { ClipmapResidency } from '../clipmap/residency.ts';
import type { V3 } from '../clipmap/layout.ts';

export interface Camera {
  pos: V3;
  right: V3;
  up: V3;
  fwd: V3;
  focal: number;
}

export interface FrameOptions {
  shadows: boolean;
  brush: { on: boolean; center: V3; radius: number };
  maxDist: number;
}

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: ClipAtlas;
  private readonly rm: Program;
  private readonly pickFbo: WebGLFramebuffer;
  private readonly pickTex: WebGLTexture;
  readonly sun: V3;
  width = 1;
  height = 1;

  constructor(atlas: ClipAtlas) {
    this.atlas = atlas;
    this.gl = atlas.gl;
    const gl = this.gl;
    this.rm = new Program(gl, RAYMARCH_FS, 'raymarch');
    this.rm.use();
    gl.uniform1i(gl.getUniformLocation(this.rm.prog, 'uAtlas'), 0);
    gl.uniform1i(gl.getUniformLocation(this.rm.prog, 'uPage'), 1);
    gl.uniform1i(gl.getUniformLocation(this.rm.prog, 'uCoast'), 2);
    // Late-afternoon sun, slightly off-vertical.
    this.sun = normalize([-0.45, 0.72, -0.52]);

    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('pick target allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pickFbo = fbo;
    this.pickTex = tex;
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  private setCommon(res: ClipmapResidency, cam: Camera, opts: FrameOptions): void {
    const p = this.rm;
    p.use();
    this.atlas.bindClipTextures(true);
    this.atlas.applyClipUniforms(p, res, cam.pos);
    p.v2('uRes', this.width, this.height);
    p.v3('uCamRight', ...cam.right);
    p.v3('uCamUp', ...cam.up);
    p.v3('uCamFwd', ...cam.fwd);
    p.f('uFocal', cam.focal);
    p.f('uSeaY', -cam.pos[1]);
    p.v3('uSunDir', ...this.sun);
    p.b('uShadows', opts.shadows);
    p.b('uBrushOn', opts.brush.on);
    p.v3('uBrushC', opts.brush.center[0] - cam.pos[0], opts.brush.center[1] - cam.pos[1], opts.brush.center[2] - cam.pos[2]);
    p.f('uBrushR', opts.brush.radius);
    p.f('uMaxDist', opts.maxDist);
  }

  draw(res: ClipmapResidency, cam: Camera, opts: FrameOptions): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    this.setCommon(res, cam, opts);
    this.rm.i('uPickMode', 0);
    this.rm.v2('uPickPixel', 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Surface hit under a canvas pixel (y down, as in DOM events). Position and normal are both
   * camera-relative metres from the same ray. Returns null when the ray misses the land.
   */
  pick(px: number, py: number, res: ClipmapResidency, cam: Camera, opts: FrameOptions): { pos: V3; normal: V3 } | null {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.viewport(0, 0, 1, 1);
    this.setCommon(res, cam, opts);
    this.rm.v2('uPickPixel', px, this.height - py);
    const out = new Float32Array(4);
    this.rm.i('uPickMode', 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    if (out[3] < 0.5) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      return null;
    }
    const pos: V3 = [out[0], out[1], out[2]];
    this.rm.i('uPickMode', 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    return { pos, normal: normalize([out[0], out[1], out[2]]) };
  }

  dispose(): void {
    this.gl.deleteTexture(this.pickTex);
    this.gl.deleteFramebuffer(this.pickFbo);
  }
}

export function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

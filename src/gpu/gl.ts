// Thin WebGL2 helpers: context setup, shader programs with cached uniform locations.
import { FULLSCREEN_VS } from './shaders/passes.ts';

export function createGl(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float is required (R16F render targets, float readback).');
  }
  return gl;
}

export function maxTexture3D(gl: WebGL2RenderingContext): number {
  return gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number;
}

export class Program {
  readonly prog: WebGLProgram;
  private readonly gl: WebGL2RenderingContext;
  private readonly locs = new Map<string, WebGLUniformLocation | null>();

  constructor(gl: WebGL2RenderingContext, fragmentSrc: string, name: string) {
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS, `${name}/vs`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${name}/fs`);
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`${name}: link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.prog = prog;
  }

  use(): void {
    this.gl.useProgram(this.prog);
  }

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }

  f(name: string, v: number): void { this.gl.uniform1f(this.loc(name), v); }
  i(name: string, v: number): void { this.gl.uniform1i(this.loc(name), v); }
  b(name: string, v: boolean): void { this.gl.uniform1i(this.loc(name), v ? 1 : 0); }
  v2(name: string, x: number, y: number): void { this.gl.uniform2f(this.loc(name), x, y); }
  v3(name: string, x: number, y: number, z: number): void { this.gl.uniform3f(this.loc(name), x, y, z); }
  iv2(name: string, x: number, y: number): void { this.gl.uniform2i(this.loc(name), x, y); }
  iv3(name: string, x: number, y: number, z: number): void { this.gl.uniform3i(this.loc(name), x, y, z); }
  fv3(name: string, a: Float32Array): void { this.gl.uniform3fv(this.loc(name), a); }
  fv1(name: string, a: Float32Array): void { this.gl.uniform1fv(this.loc(name), a); }
  iv3a(name: string, a: Int32Array): void { this.gl.uniform3iv(this.loc(name), a); }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    const lines = src.split('\n');
    const numbered = log.split('\n').map((l) => {
      const m = /ERROR: \d+:(\d+)/.exec(l);
      if (!m) return l;
      const n = Number(m[1]);
      return `${l}\n    > ${lines[n - 1] ?? ''}`;
    }).join('\n');
    throw new Error(`${name}: compile failed\n${numbered}`);
  }
  return sh;
}

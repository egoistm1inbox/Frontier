// Follow-up 68: a channel driven by a GLSL shader. The author writes `vec3 channel(vec2 uv)` (colour channels) or
// `float channel(vec2 uv)` (scalar channels, in the channel's own range); it is compiled with WebGL in a small off-screen canvas and
// drawn into a 128 × 128 image the shader ball samples like a texture (scalars are stored 0–255 across the channel's range). Slang /
// HLSL and C++ sources are kept for the native integration and preview with the stored fill.
const Size = 128;
const Baked = new Map(); // source key → { Pixels, Error, Log }
let Context = null;

const Vertex = `attribute vec2 Corner; varying vec2 vUv; void main() { vUv = Corner * 0.5 + 0.5; gl_Position = vec4(Corner, 0.0, 1.0); }`;
const Fragment = (Code, Colour, Low, High) => `precision highp float;
varying vec2 vUv;
uniform float time;
#line 1
${Code}
void main() {
  ${Colour ? "vec3 Result = clamp(channel(vUv), 0.0, 1.0);" : `float Result = clamp((channel(vUv) - (${Low.toFixed(6)})) / (${(High - Low).toFixed(6)}), 0.0, 1.0); `}
  gl_FragColor = vec4(${Colour ? "Result" : "vec3(Result)"}, 1.0);
}`;

function Surface() {
  if (Context) return Context;
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Size;
  const Gl = Canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false });
  if (!Gl) return null;
  const Corners = Gl.createBuffer();
  Gl.bindBuffer(Gl.ARRAY_BUFFER, Corners);
  Gl.bufferData(Gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), Gl.STATIC_DRAW);
  Context = { Gl, Corners };
  return Context;
}

// Compile and draw one channel. Returns { Pixels: Uint8ClampedArray (top row first) } or { Error: first message, Log: full log }.
export function BakeShaderChannel(Code, Field) {
  const Colour = Field.Kind === "Colour";
  const Key = [Field.Id, Colour, Field.Minimum, Field.Maximum, Code].join("\u0001");
  if (Baked.has(Key)) return Baked.get(Key);
  let Result;
  const Shared = Surface();
  if (!Shared) Result = { Error: "WebGL is not available in this browser, so the shader can't be previewed.", Log: "" };
  else {
    const { Gl, Corners } = Shared;
    const Build = (Kind, Text) => {
      const Shader = Gl.createShader(Kind);
      Gl.shaderSource(Shader, Text);
      Gl.compileShader(Shader);
      if (!Gl.getShaderParameter(Shader, Gl.COMPILE_STATUS)) {
        const Log = Gl.getShaderInfoLog(Shader) || "Compile failed";
        Gl.deleteShader(Shader);
        throw new Error(Log);
      }
      return Shader;
    };
    let Program = null, Front = null, Back = null;
    try {
      if (!/\bchannel\s*\(/.test(Code)) throw new Error(`ERROR: 0:1: define ${Colour ? "vec3" : "float"} channel(vec2 uv)`);
      Front = Build(Gl.VERTEX_SHADER, Vertex);
      Back = Build(Gl.FRAGMENT_SHADER, Fragment(Code, Colour, Field.Minimum, Field.Maximum));
      Program = Gl.createProgram();
      Gl.attachShader(Program, Front);
      Gl.attachShader(Program, Back);
      Gl.linkProgram(Program);
      if (!Gl.getProgramParameter(Program, Gl.LINK_STATUS)) throw new Error(Gl.getProgramInfoLog(Program) || "Link failed");
      Gl.viewport(0, 0, Size, Size);
      Gl.useProgram(Program);
      Gl.bindBuffer(Gl.ARRAY_BUFFER, Corners);
      const At = Gl.getAttribLocation(Program, "Corner");
      Gl.enableVertexAttribArray(At);
      Gl.vertexAttribPointer(At, 2, Gl.FLOAT, false, 0, 0);
      Gl.uniform1f(Gl.getUniformLocation(Program, "time"), 0);
      Gl.drawArrays(Gl.TRIANGLE_STRIP, 0, 4);
      const Raw = new Uint8Array(Size * Size * 4);
      Gl.readPixels(0, 0, Size, Size, Gl.RGBA, Gl.UNSIGNED_BYTE, Raw);
      // WebGL reads bottom row first; images run top row first (v = 1 at the top, like the texture source).
      const Pixels = new Uint8ClampedArray(Size * Size * 4);
      for (let Row = 0; Row < Size; Row++) Pixels.set(Raw.subarray(Row * Size * 4, (Row + 1) * Size * 4), (Size - 1 - Row) * Size * 4);
      Result = { Pixels };
    } catch (Problem) {
      const Log = String(Problem.message || Problem).trim();
      const First = Log.split("\n").find((Line) => Line.trim()) || Log;
      Result = { Error: First.replace(/^ERROR:\s*0:(\d+):/, "Line $1:"), Log };
    } finally {
      if (Program) Gl.deleteProgram(Program);
      if (Front) Gl.deleteShader(Front);
      if (Back) Gl.deleteShader(Back);
    }
  }
  if (Baked.size > 64) Baked.delete(Baked.keys().next().value);
  Baked.set(Key, Result);
  return Result;
}

// The baked image as a data URL, for the editor's thumbnail.
export function ShaderChannelPicture(Result) {
  if (!Result?.Pixels) return null;
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Size;
  Canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(Result.Pixels), Size, Size), 0, 0);
  return Canvas.toDataURL("image/png");
}

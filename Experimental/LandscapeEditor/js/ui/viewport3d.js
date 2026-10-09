import { downsample } from '../core/grid.js';

const MESH_MAX = 1024;
// Vertical field of view of the 3D camera, in degrees. Panning uses it too, so the pan matches the projection.
const FOV_DEG = 40;

// Mesh heights for a result: the working grid, averaged down to MESH_MAX cells a side if it is larger.
function meshGrid(result) {
  if (result.N <= MESH_MAX) return { N: result.N, height: result.height };
  return { N: MESH_MAX, height: downsample(result.height, result.N, MESH_MAX) };
}

// 3D view: the heightfield as a WebGL 2 mesh, textured with the satmap (or a height ramp when the satmap is
// off), lit by the view's sun, with a water plane at sea level. The mesh is rebuilt only when the result
// changes; camera and lighting changes just redraw.

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in float aH;
uniform mat4 uVP;
out vec3 vNrm;
out vec2 vUv;
out float vH;
out vec3 vPos;
void main() {
  vPos = aPos;
  vNrm = aNrm;
  vUv = aUv;
  vH = aH;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const FS_TERRAIN = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec2 vUv;
in float vH;
in vec3 vPos;
uniform sampler2D uSat;
uniform int uUseSat;
uniform float uSea;
uniform vec3 uSun;
uniform vec3 uCam;
uniform vec3 uHaze;
out vec4 o;
vec3 heightColour(float h) {
  vec3 deep = vec3(0.05, 0.16, 0.24);
  vec3 c = mix(deep, vec3(0.13, 0.34, 0.44), smoothstep(0.0, max(uSea, 0.001), h));
  c = mix(c, vec3(0.70, 0.66, 0.48), smoothstep(uSea, uSea + 0.015, h));
  c = mix(c, vec3(0.36, 0.50, 0.27), smoothstep(uSea + 0.03, uSea + 0.10, h));
  c = mix(c, vec3(0.48, 0.42, 0.30), smoothstep(0.42, 0.60, h));
  c = mix(c, vec3(0.56, 0.53, 0.50), smoothstep(0.62, 0.80, h));
  c = mix(c, vec3(0.94, 0.95, 0.96), smoothstep(0.84, 0.93, h));
  return c;
}
void main() {
  vec3 n = normalize(vNrm);
  vec3 base = uUseSat == 1 ? texture(uSat, vUv).rgb : heightColour(vH);
  float diff = max(dot(n, uSun), 0.0);
  vec3 lit = uUseSat == 1
    ? base * (0.70 + 0.44 * diff)
    : base * (0.24 + 0.84 * diff) * (0.85 + 0.15 * n.y);
  float d = length(vPos - uCam);
  float f = 1.0 - exp(-d * 0.45);
  o = vec4(mix(lit, uHaze, f * 0.6), 1.0);
}`;

const FS_WATER = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec2 vUv;
in float vH;
in vec3 vPos;
uniform vec3 uSun;
uniform vec3 uCam;
uniform vec3 uHaze;
out vec4 o;
void main() {
  vec3 v = normalize(uCam - vPos);
  vec3 hv = normalize(uSun + v);
  float spec = pow(max(dot(vec3(0.0, 1.0, 0.0), hv), 0.0), 90.0);
  vec3 col = vec3(0.09, 0.29, 0.39) + spec * vec3(1.0, 0.95, 0.82) * 0.55;
  float d = length(vPos - uCam);
  float f = 1.0 - exp(-d * 0.45);
  // The water plane fades out toward the map edges, so it does not read as a hard-edged tile.
  float edge = 1.0 - smoothstep(0.70, 1.0, max(abs(vPos.x), abs(vPos.z)) * 2.0);
  o = vec4(mix(col, uHaze, f * 0.5), 0.86 * edge);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aNrm');
  gl.bindAttribLocation(p, 2, 'aUv');
  gl.bindAttribLocation(p, 3, 'aH');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// Column-major 4×4 helpers.
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function lookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export class View3D {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL 2 is not available in this browser, so the 3D view cannot draw. The 2D views still work.');
    this.gl = gl;
    this.terrainProgram = program(gl, VS, FS_TERRAIN);
    this.waterProgram = program(gl, VS, FS_WATER);
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.waterVao = gl.createVertexArray();
    this.waterBuffer = gl.createBuffer();
    this.texture = gl.createTexture();
    this.result = null;
    this.terrain = null;
    this.lowest = -Infinity; // the lowest ground, as a fraction of the height range
    this.N = 0;
    this.indexCount = 0;
    this.hasSat = false;
    this.settings = { satmap: true, water: true, exaggeration: 1.6, sunAzimuth: 315, sunElevation: 42 };
    this.camera = { yaw: 0.55, pitch: 0.62, dist: 1.5, target: [0, 0.06, 0] };
    this.haze = [0.075, 0.08, 0.09];
    this.pending = false;
    this.setupWater();
    this.attachControls();
    this.resize();
  }

  // Vertical scale: metres of relief per metre of map, times the viewport exaggeration.
  verticalScale() {
    const t = this.terrain;
    return t ? (t.heightM / t.extentM) * this.settings.exaggeration : 0.2;
  }

  // result: worker output (N, height, colour, colourSize). terrain: the terrain settings it was made with.
  setTerrain(result, terrain) {
    const gl = this.gl;
    this.result = result;
    this.terrain = terrain;
    let low = Infinity;
    for (let i = 0; i < result.height.length; i++) if (result.height[i] < low) low = result.height[i];
    this.lowest = low;
    // The mesh is at most MESH_MAX cells a side. Larger working grids are averaged down for display only.
    this.mesh = meshGrid(result);
    const newGrid = this.mesh.N !== this.N;
    if (newGrid) {
      const N = this.mesh.N;
      this.N = N;
      const idx = new Uint32Array((N - 1) * (N - 1) * 6);
      let k = 0;
      for (let y = 0; y < N - 1; y++) {
        for (let x = 0; x < N - 1; x++) {
          const a = y * N + x;
          const b = a + 1;
          const c = a + N;
          const d = c + 1;
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      }
      this.indexCount = idx.length;
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
    this.uploadHeights();
    if (result.colour) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, result.colourSize, result.colourSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, result.colour);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.hasSat = true;
    } else {
      this.hasSat = false;
    }
    this.requestRender();
  }

  setSettings(patch) {
    const rebuild = patch.exaggeration !== undefined && patch.exaggeration !== this.settings.exaggeration;
    Object.assign(this.settings, patch);
    if (rebuild && this.result) this.uploadHeights();
    this.requestRender();
  }

  setupWater() {
    const gl = this.gl;
    gl.bindVertexArray(this.waterVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(4 * 9), gl.DYNAMIC_DRAW);
    this.bindAttributes();
    gl.bindVertexArray(null);
  }

  bindAttributes() {
    const gl = this.gl;
    const stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
  }

  // Interleaved vertices: position (3), normal (3), uv (2), normalised height (1).
  uploadHeights() {
    if (!this.result) return;
    const gl = this.gl;
    const { N, height: h } = this.mesh;
    const vs = this.verticalScale();
    const verts = new Float32Array(N * N * 9);
    const cell = 1 / (N - 1);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const xl = Math.max(0, x - 1);
        const xr = Math.min(N - 1, x + 1);
        const yu = Math.max(0, y - 1);
        const yd = Math.min(N - 1, y + 1);
        const dhdx = ((h[y * N + xr] - h[y * N + xl]) * vs) / ((xr - xl) * cell || cell);
        const dhdz = ((h[yd * N + x] - h[yu * N + x]) * vs) / ((yd - yu) * cell || cell);
        const nl = Math.hypot(dhdx, 1, dhdz);
        const o = i * 9;
        verts[o] = x * cell - 0.5;
        verts[o + 1] = h[i] * vs;
        verts[o + 2] = y * cell - 0.5;
        verts[o + 3] = -dhdx / nl;
        verts[o + 4] = 1 / nl;
        verts[o + 5] = -dhdz / nl;
        verts[o + 6] = x * cell;
        verts[o + 7] = y * cell;
        verts[o + 8] = h[i];
      }
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    this.bindAttributes();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);
    this.requestRender();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.requestRender();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  resetCamera() {
    this.camera = { yaw: 0.55, pitch: 0.62, dist: 1.5, target: [0, 0.06, 0] };
    this.requestRender();
  }

  eye() {
    const c = this.camera;
    const cp = Math.cos(c.pitch);
    return [
      c.target[0] + c.dist * cp * Math.sin(c.yaw),
      c.target[1] + c.dist * Math.sin(c.pitch),
      c.target[2] + c.dist * cp * Math.cos(c.yaw),
    ];
  }

  render() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.haze[0], this.haze[1], this.haze[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.result) return;

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const eye = this.eye();
    const view = lookAt(eye, this.camera.target, [0, 1, 0]);
    const proj = perspective((FOV_DEG * Math.PI) / 180, aspect, 0.01, 20);
    const vp = mul(proj, view);
    const az = (this.settings.sunAzimuth * Math.PI) / 180;
    const el = (this.settings.sunElevation * Math.PI) / 180;
    const sun = norm([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
    const sea = this.terrain.seaLevel;

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.terrainProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.terrainProgram, 'uVP'), false, vp);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProgram, 'uSun'), sun);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProgram, 'uCam'), eye);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProgram, 'uHaze'), this.haze);
    gl.uniform1f(gl.getUniformLocation(this.terrainProgram, 'uSea'), sea);
    gl.uniform1i(gl.getUniformLocation(this.terrainProgram, 'uUseSat'), this.hasSat && this.settings.satmap ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.terrainProgram, 'uSat'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // The sea plane is drawn only when the sea reaches the land. Below the lowest ground it would show only as a band
    // beyond the terrain's edges, so a desert with a low sea level has no plane.
    if (this.settings.water && sea >= this.lowest) {
      const y = sea * this.verticalScale();
      const quad = new Float32Array([
        -0.5, y, -0.5, 0, 1, 0, 0, 0, sea,
        0.5, y, -0.5, 0, 1, 0, 1, 0, sea,
        -0.5, y, 0.5, 0, 1, 0, 0, 1, sea,
        0.5, y, 0.5, 0, 1, 0, 1, 1, sea,
      ]);
      gl.bindVertexArray(this.waterVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.waterProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.waterProgram, 'uVP'), false, vp);
      gl.uniform3fv(gl.getUniformLocation(this.waterProgram, 'uSun'), sun);
      gl.uniform3fv(gl.getUniformLocation(this.waterProgram, 'uCam'), eye);
      gl.uniform3fv(gl.getUniformLocation(this.waterProgram, 'uHaze'), this.haze);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  attachControls() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Right button, middle button, or Shift with the left button pans. Plain left drag orbits.
    c.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // stops middle-click autoscroll
    });
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) {
        // Pan in the camera's own plane. The scene moves with the cursor: a drag right moves the target left,
        // a drag down moves it up in the view. One CSS pixel is the visible height divided by the pixel height.
        const cam = this.camera;
        const eye = this.eye();
        const f = norm(sub(cam.target, eye));
        const r = norm(cross(f, [0, 1, 0]));
        const u = cross(r, f);
        const perPx = (2 * cam.dist * Math.tan((FOV_DEG * Math.PI) / 360)) / Math.max(1, c.clientHeight);
        for (let k = 0; k < 3; k++) cam.target[k] += (-dx * r[k] + dy * u[k]) * perPx;
      } else {
        this.camera.yaw -= dx * 0.006;
        this.camera.pitch = Math.min(1.5, Math.max(0.08, this.camera.pitch + dy * 0.005));
      }
      this.requestRender();
    });
    const end = (e) => {
      drag = null;
      if (c.hasPointerCapture?.(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.dist = Math.min(6, Math.max(0.4, this.camera.dist * Math.exp(e.deltaY * 0.0012)));
      this.requestRender();
    }, { passive: false });
  }
}

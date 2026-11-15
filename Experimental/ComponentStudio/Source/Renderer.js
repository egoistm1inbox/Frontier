// WebGL2 viewport shared by the Component Viewer and the Geometry Compile window.
// One corner stream per mesh (position, normal, uv, material colour, debug colour, barycentric) so every view mode —
// lit, checker UV, chart / cluster colours, normals, wire — reads the same buffer. A procedural ground grid, line
// overlays, ID picking, a GPU sphere-traced SDF preview and a transparent icon capture path sit on top.
import { perspective, lookAt, multiply, invert, identity } from './MathUtils.js';

const STRIDE = 18; // floats per corner

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol; layout(location=4) in vec3 aDbg; layout(location=5) in vec3 aBary;
uniform mat4 uViewProj, uModel; uniform mat3 uNormalMat;
out vec3 vWorld, vNrm, vDbg, vBary; out vec2 vUv; out vec4 vCol;
void main(){ vec4 w = uModel * vec4(aPos,1.0); vWorld = w.xyz; vNrm = uNormalMat * aNrm; vUv = aUv; vCol = aCol; vDbg = aDbg; vBary = aBary; gl_Position = uViewProj * w; }`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vWorld, vNrm, vDbg, vBary; in vec2 vUv; in vec4 vCol;
uniform vec3 uEye, uTint, uHighlight; uniform int uMode; uniform float uWire, uSelected, uFlat, uAlpha, uGhost;
out vec4 outColor;
float edge(){ vec3 d = fwidth(vBary); vec3 a = smoothstep(vec3(0.0), d * 1.1, vBary); return 1.0 - min(min(a.x, a.y), a.z); }
void main(){
  vec3 n = normalize(vNrm);
  if (uFlat > 0.5 || dot(n,n) < 0.5) n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  vec3 base = vCol.rgb * uTint;
  if (uMode == 1) { vec2 c = floor(vUv * 16.0); float k = mod(c.x + c.y, 2.0); vec3 a = vec3(0.86,0.86,0.84), b = vec3(0.22,0.24,0.27); base = mix(a, b, k); if (vUv.x < 0.0 || vUv.y < 0.0) base = vec3(0.9,0.25,0.4); }
  else if (uMode == 2) base = vDbg * uTint;
  else if (uMode == 3) base = n * 0.5 + 0.5;
  vec3 L = normalize(vec3(0.55, 0.85, 0.35)), F = normalize(vec3(-0.6, 0.35, -0.5));
  float key = max(dot(n, L), 0.0), fill = max(dot(n, F), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 h = normalize(L + v); float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.35;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = base * (mix(vec3(0.10,0.10,0.11), vec3(0.42,0.45,0.50), hemi) + vec3(1.0,0.95,0.88) * key * 1.05 + vec3(0.45,0.55,0.75) * fill * 0.35) + spec + rim * 0.12;
  if (uMode == 3) col = base * (0.55 + 0.45 * key);
  if (vCol.a > 0.5 && uMode == 0) col = base * 1.6;
  col = mix(col, uHighlight, uSelected * (0.05 + 0.6 * rim * rim));
  float e = edge();
  if (uWire > 0.5) col = mix(col, vec3(0.03), e * 0.65);
  col = pow(col, vec3(1.0/2.2));
  outColor = vec4(mix(col, vec3(0.6), uGhost * 0.5), uAlpha);
}`;

const PICK_FS = `#version 300 es
precision highp float; uniform vec3 uId; out vec4 outColor; void main(){ outColor = vec4(uId, 1.0); }`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol; uniform mat4 uViewProj; out vec4 vCol;
void main(){ vCol = aCol; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const LINE_FS = `#version 300 es
precision highp float; in vec4 vCol; out vec4 outColor; void main(){ outColor = vCol; }`;

const GROUND_VS = `#version 300 es
layout(location=0) in vec2 aPos; uniform mat4 uViewProj; uniform float uSize, uLevel; out vec3 vWorld;
void main(){ vWorld = vec3(aPos.x * uSize, uLevel, aPos.y * uSize); gl_Position = uViewProj * vec4(vWorld, 1.0); }`;
const GROUND_FS = `#version 300 es
precision highp float; in vec3 vWorld; uniform vec3 uEye; uniform vec2 uOffset; uniform vec4 uShadow; uniform float uCell, uFade, uGridOn; out vec4 outColor;
float gridLine(vec2 p, float cell){ vec2 g = abs(fract(p / cell - 0.5) - 0.5) / fwidth(p / cell); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){
  vec2 p = vWorld.xz + uOffset;
  float d = length(vWorld.xz - uEye.xz);
  float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
  float minor = gridLine(p, uCell) * 0.35, major = gridLine(p, uCell * 5.0) * 0.7;
  vec3 col = vec3(0.075, 0.078, 0.082);
  col += vec3(0.20, 0.21, 0.22) * max(minor, major) * fade * uGridOn;
  vec2 q = (vWorld.xz - uShadow.xy) / uShadow.zw; float s = 1.0 - smoothstep(0.35, 1.0, length(q));
  col *= 1.0 - 0.55 * s;
  float axisX = 1.0 - smoothstep(0.0, fwidth(vWorld.z) * 1.5, abs(vWorld.z)), axisZ = 1.0 - smoothstep(0.0, fwidth(vWorld.x) * 1.5, abs(vWorld.x));
  col = mix(col, vec3(0.62, 0.22, 0.20), axisX * fade * 0.55 * uGridOn); col = mix(col, vec3(0.20, 0.38, 0.70), axisZ * fade * 0.55 * uGridOn);
  outColor = vec4(pow(col, vec3(1.0/2.2)), fade);
}`;

const SDF_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0)); out vec2 vNdc;
void main(){ vNdc = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;
const SDF_FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 vNdc; uniform mat4 uInvViewProj; uniform vec3 uEye, uOrigin, uSpan; uniform float uIso, uBand, uSlice, uShowSlice; uniform int uAxis; uniform sampler3D uField; uniform float uDims;
out vec4 outColor;
float field(vec3 p){ vec3 t = (p - uOrigin) / uSpan; t = (t * (uDims - 1.0) + 0.5) / uDims; return texture(uField, t).r - uIso; }
vec2 box(vec3 ro, vec3 rd){ vec3 lo = uOrigin, hi = uOrigin + uSpan; vec3 t0 = (lo - ro) / rd, t1 = (hi - ro) / rd; vec3 a = min(t0,t1), b = max(t0,t1); return vec2(max(max(a.x,a.y),a.z), min(min(b.x,b.y),b.z)); }
vec3 heat(float d){ float t = clamp(d / uBand, -1.0, 1.0); vec3 inside = mix(vec3(1.0,0.78,0.36), vec3(0.85,0.30,0.18), -t); vec3 outside = mix(vec3(0.30,0.70,0.85), vec3(0.08,0.16,0.36), t); return t < 0.0 ? inside : outside; }
void main(){
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0), b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w, rd = normalize(b.xyz / b.w - ro);
  vec2 hitBox = box(ro, rd);
  vec3 bg = vec3(0.0); float alpha = 0.0;
  if (hitBox.x > hitBox.y || hitBox.y < 0.0) { outColor = vec4(0.0); return; }
  float t = max(hitBox.x, 0.0), eps = length(uSpan) / uDims * 0.15; bool hit = false;
  for (int i = 0; i < 256; i++) { vec3 p = ro + rd * t; float d = field(p); if (d < eps) { hit = true; break; } t += max(d * 0.9, eps * 0.5); if (t > hitBox.y) break; }
  vec3 col = vec3(0.0);
  if (hit) {
    vec3 p = ro + rd * t; float e = length(uSpan) / uDims * 0.6;
    vec3 n = normalize(vec3(field(p+vec3(e,0,0))-field(p-vec3(e,0,0)), field(p+vec3(0,e,0))-field(p-vec3(0,e,0)), field(p+vec3(0,0,e))-field(p-vec3(0,0,e))));
    vec3 L = normalize(vec3(0.55, 0.85, 0.35)); float k = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.y;
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = vec3(0.86, 0.80, 0.70) * (0.18 + 0.32 * hemi + 0.85 * k) + rim * 0.15; alpha = 1.0;
  }
  if (uShowSlice > 0.5) {
    float plane = uOrigin[uAxis] + uSpan[uAxis] * uSlice; float tp = (plane - ro[uAxis]) / rd[uAxis];
    if (tp > hitBox.x && tp < hitBox.y && (!hit || tp < t)) {
      vec3 p = ro + rd * tp; float d = field(p);
      vec3 c = heat(d); float contour = abs(fract(d / (uBand * 0.25) + 0.5) - 0.5) / fwidth(d / (uBand * 0.25));
      c = mix(c * 0.55, c, smoothstep(0.0, 1.5, contour)); if (abs(d) < eps * 3.0) c = vec3(1.0);
      col = mix(col, c, 0.82); alpha = max(alpha, 0.9);
    }
  }
  outColor = vec4(pow(col, vec3(1.0/2.2)), alpha);
}`;

function compile(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function normalMatrix(m) {
  const inv = invert(m);
  return new Float32Array([inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]]);
}

const MODES = { lit: 0, checker: 1, debug: 2, normal: 3 };

export class Viewport {
  constructor(canvas, { ground = true, onPick = null, onCamera = null } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.meshProgram = compile(gl, MESH_VS, MESH_FS);
    this.pickProgram = compile(gl, MESH_VS, PICK_FS);
    this.lineProgram = compile(gl, LINE_VS, LINE_FS);
    this.groundProgram = compile(gl, GROUND_VS, GROUND_FS);
    this.sdfProgram = compile(gl, SDF_VS, SDF_FS);
    this.halfFloatLinear = !!gl.getExtension('OES_texture_float_linear') || true; // R16F is always filterable
    this.groundVao = gl.createVertexArray(); gl.bindVertexArray(this.groundVao);
    const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.emptyVao = gl.createVertexArray();
    gl.bindVertexArray(null);
    this.objects = [];
    this.lineSets = new Map();
    this.camera = { target: [0, 0.6, 0], yaw: 0.75, pitch: 0.32, distance: 6, fov: 38 };
    this.settings = { mode: 'lit', wire: false, flat: false, grid: true, ground, groundLevel: 0, groundOffset: [0, 0], shadow: null, background: [0.043, 0.043, 0.051, 1], cell: 0.5 };
    this.sdf = null; this.sdfView = { enabled: false, iso: 0, slice: 0.5, axis: 1, showSlice: true };
    this.onPick = onPick; this.onCamera = onCamera;
    this.dirty = true;
    this.bindControls();
    new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
    const loop = () => { requestAnimationFrame(loop); if (this.dirty || this.animating) { this.dirty = false; this.render(); } };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------------------------- meshes
  // data: positions (vertex xyz), indices, normals? (vertex), uvs? (per corner, tri*6), colors? (per triangle rgba),
  // debug? (per triangle rgb). Returns a handle with the triangle count.
  createMesh(data) {
    const gl = this.gl;
    const { positions: P, indices: I, normals: N, cornerNormals: CN, uvs: U, colors: C, debug: D } = data;
    const tris = I.length / 3, out = new Float32Array(tris * 3 * STRIDE);
    for (let t = 0; t < tris; t++) {
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k], o = (t * 3 + k) * STRIDE;
        out[o] = P[v * 3]; out[o + 1] = P[v * 3 + 1]; out[o + 2] = P[v * 3 + 2];
        if (CN) { const q = (t * 3 + k) * 3; out[o + 3] = CN[q]; out[o + 4] = CN[q + 1]; out[o + 5] = CN[q + 2]; }
        else if (N) { out[o + 3] = N[v * 3]; out[o + 4] = N[v * 3 + 1]; out[o + 5] = N[v * 3 + 2]; }
        if (U) { out[o + 6] = U[(t * 3 + k) * 2]; out[o + 7] = U[(t * 3 + k) * 2 + 1]; } else { out[o + 6] = -1; out[o + 7] = -1; }
        if (C) { out[o + 8] = C[t * 4]; out[o + 9] = C[t * 4 + 1]; out[o + 10] = C[t * 4 + 2]; out[o + 11] = C[t * 4 + 3]; }
        else { out[o + 8] = 0.72; out[o + 9] = 0.72; out[o + 10] = 0.7; out[o + 11] = 0; }
        if (D) { out[o + 12] = D[t * 3]; out[o + 13] = D[t * 3 + 1]; out[o + 14] = D[t * 3 + 2]; }
        else { out[o + 12] = 0.5; out[o + 13] = 0.55; out[o + 14] = 0.6; }
        out[o + 15 + k] = 1;
      }
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    const attr = (loc, size, offset) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4); };
    attr(0, 3, 0); attr(1, 3, 3); attr(2, 2, 6); attr(3, 4, 8); attr(4, 3, 12); attr(5, 3, 15);
    gl.bindVertexArray(null);
    this.dirty = true;
    return { vao, buffer, count: tris * 3, triangles: tris };
  }

  deleteMesh(handle) {
    if (!handle) return;
    this.gl.deleteBuffer(handle.buffer); this.gl.deleteVertexArray(handle.vao); this.dirty = true;
  }

  setObjects(list) { this.objects = list; this.dirty = true; }
  setLines(key, data, { depth = true } = {}) {
    const gl = this.gl;
    let set = this.lineSets.get(key);
    if (!data || !data.length) { if (set) { gl.deleteBuffer(set.buffer); gl.deleteVertexArray(set.vao); this.lineSets.delete(key); } this.dirty = true; return; }
    if (!set) {
      set = { vao: gl.createVertexArray(), buffer: gl.createBuffer() };
      gl.bindVertexArray(set.vao); gl.bindBuffer(gl.ARRAY_BUFFER, set.buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null); this.lineSets.set(key, set);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    set.count = data.length / 7; set.depth = depth; this.dirty = true;
  }

  setSdf(baked) {
    const gl = this.gl;
    if (this.sdf) gl.deleteTexture(this.sdf.texture);
    this.sdf = null;
    if (!baked) { this.dirty = true; return; }
    const n = baked.dims, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, texture);
    const half = new Uint16Array(baked.values.length);
    for (let i = 0; i < half.length; i++) half[i] = toHalf(baked.values[i]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, n, n, n, 0, gl.RED, gl.HALF_FLOAT, half);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    const span = (n - 1) * baked.voxel;
    this.sdf = { texture, dims: n, origin: baked.origin, span: [span, span, span], band: baked.band };
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------------------- camera
  eye() {
    const c = this.camera, cp = Math.cos(c.pitch);
    return [c.target[0] + c.distance * cp * Math.sin(c.yaw), c.target[1] + c.distance * Math.sin(c.pitch), c.target[2] + c.distance * cp * Math.cos(c.yaw)];
  }
  matrices(aspect, camera = this.camera, eyeOverride = null) {
    const eye = eyeOverride || this.eye();
    const near = Math.max(0.01, camera.distance * 0.01), far = camera.distance * 40 + 200;
    const proj = perspective((camera.fov * Math.PI) / 180, aspect, near, far);
    const view = lookAt(eye, camera.target);
    return { eye, viewProj: multiply(proj, view) };
  }
  frame(bounds, { keepAngles = true } = {}) {
    const c = this.camera;
    c.target = bounds.centre.slice();
    c.distance = Math.max(0.5, (bounds.radius / Math.sin((c.fov * Math.PI) / 360)) * 1.08);
    if (!keepAngles) { c.yaw = 0.75; c.pitch = 0.32; }
    this.dirty = true; this.onCamera?.();
  }

  bindControls() {
    const el = this.canvas;
    let drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      const c = this.camera;
      if (drag.pan) {
        const s = c.distance * 0.0016;
        const right = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
        const up = [-Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch), -Math.sin(c.pitch) * Math.cos(c.yaw)];
        for (let k = 0; k < 3; k++) c.target[k] += (-right[k] * dx + up[k] * dy) * s;
      } else {
        c.yaw -= dx * 0.008;
        c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch + dy * 0.008));
      }
      this.dirty = true; this.onCamera?.();
    });
    const end = (e) => {
      if (!drag) return;
      const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
      drag = null; el.classList.remove('dragging');
      if (moved < 4 && e.button === 0 && this.onPick) {
        const r = el.getBoundingClientRect();
        this.onPick(this.pick(e.clientX - r.left, e.clientY - r.top), e);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { drag = null; el.classList.remove('dragging'); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.distance = Math.max(0.2, Math.min(400, this.camera.distance * Math.exp(e.deltaY * 0.0012)));
      this.dirty = true; this.onCamera?.();
    }, { passive: false });
  }

  // ---------------------------------------------------------------------------------------------- drawing
  resize() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio)), h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return [w, h];
  }

  drawMeshes(viewProj, eye, { objects = this.objects, mode = this.settings.mode, wire = this.settings.wire, flat = this.settings.flat } = {}) {
    const gl = this.gl, { p, u } = this.meshProgram;
    gl.useProgram(p);
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    gl.uniform3fv(u.uEye, eye);
    gl.uniform3fv(u.uHighlight, [1.0, 0.70, 0.22]);
    gl.uniform1i(u.uMode, MODES[mode] ?? 0);
    gl.uniform1f(u.uWire, wire ? 1 : 0);
    gl.uniform1f(u.uFlat, flat ? 1 : 0);
    for (const o of objects) {
      if (!o.visible && o.visible !== undefined) continue;
      if (!o.mesh) continue;
      const m = o.matrix || identity();
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.uniformMatrix3fv(u.uNormalMat, false, normalMatrix(m));
      gl.uniform3fv(u.uTint, o.tint || [1, 1, 1]);
      gl.uniform1f(u.uSelected, o.selected ? 1 : 0);
      gl.uniform1f(u.uGhost, o.ghost ? 1 : 0);
      gl.uniform1f(u.uAlpha, 1);
      gl.uniform1i(u.uMode, MODES[o.mode || mode] ?? 0);
      gl.bindVertexArray(o.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
    }
    gl.bindVertexArray(null);
  }

  render() {
    const gl = this.gl, [w, h] = this.resize(), s = this.settings;
    gl.viewport(0, 0, w, h);
    gl.clearColor(...s.background); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { eye, viewProj } = this.matrices(w / h);
    this.lastViewProj = viewProj; this.lastEye = eye;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    if (s.ground) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const { p, u } = this.groundProgram; gl.useProgram(p);
      gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
      gl.uniform3fv(u.uEye, eye);
      gl.uniform1f(u.uSize, Math.max(60, this.camera.distance * 12));
      gl.uniform1f(u.uLevel, s.groundLevel);
      gl.uniform2fv(u.uOffset, s.groundOffset);
      gl.uniform1f(u.uCell, s.cell);
      gl.uniform1f(u.uFade, Math.max(20, this.camera.distance * 5));
      gl.uniform1f(u.uGridOn, s.grid ? 1 : 0);
      gl.uniform4fv(u.uShadow, s.shadow || [0, 0, 0.001, 0.001]);
      gl.depthMask(false);
      gl.bindVertexArray(this.groundVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    if (this.sdfView.enabled && this.sdf) this.drawSdf(viewProj, eye);
    else this.drawMeshes(viewProj, eye);
    this.drawLines(viewProj);
  }

  drawLines(viewProj) {
    const gl = this.gl;
    if (!this.lineSets.size) return;
    const { p, u } = this.lineProgram; gl.useProgram(p);
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const set of this.lineSets.values()) {
      if (set.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(set.vao); gl.drawArrays(gl.LINES, 0, set.count);
    }
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }

  drawSdf(viewProj, eye) {
    const gl = this.gl, { p, u } = this.sdfProgram, f = this.sdf, v = this.sdfView;
    gl.useProgram(p);
    gl.uniformMatrix4fv(u.uInvViewProj, false, invert(viewProj));
    gl.uniform3fv(u.uEye, eye); gl.uniform3fv(u.uOrigin, f.origin); gl.uniform3fv(u.uSpan, f.span);
    gl.uniform1f(u.uIso, v.iso); gl.uniform1f(u.uBand, f.band); gl.uniform1f(u.uDims, f.dims);
    gl.uniform1f(u.uSlice, v.slice); gl.uniform1f(u.uShowSlice, v.showSlice ? 1 : 0); gl.uniform1i(u.uAxis, v.axis);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, f.texture); gl.uniform1i(u.uField, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }

  // ---------------------------------------------------------------------------------------------- picking
  pick(x, y) {
    const gl = this.gl, [w, h] = this.resize();
    const ratio = w / this.canvas.clientWidth;
    if (!this.pickTarget || this.pickTarget.w !== w || this.pickTarget.h !== h) this.pickTarget = this.makeTarget(w, h, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget.fb);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const { viewProj } = this.matrices(w / h);
    const { p, u } = this.pickProgram; gl.useProgram(p);
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    const ids = [];
    this.objects.forEach((o) => {
      if ((!o.visible && o.visible !== undefined) || !o.mesh || o.pickId === undefined) return;
      ids.push(o.pickId);
      const n = ids.length;
      gl.uniform3fv(u.uId, [(n & 255) / 255, ((n >> 8) & 255) / 255, 0]);
      gl.uniformMatrix4fv(u.uModel, false, o.matrix || identity());
      gl.bindVertexArray(o.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, o.mesh.count);
    });
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(x * ratio), Math.round(h - y * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null);
    this.dirty = true;
    const n = px[0] + px[1] * 256;
    return n ? ids[n - 1] : null;
  }

  makeTarget(w, h, samples) {
    const gl = this.gl, fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const color = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    const depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, color, depth, w, h };
  }

  // ---------------------------------------------------------------------------------------------- icon capture
  // Renders the given objects alone, fitted into a square, on a transparent (or solid) background. Returns a canvas.
  capture({ objects, bounds, size = 256, yaw = 0.75, pitch = 0.4, mode = 'lit', background = null, fill = 0.86 }) {
    const gl = this.gl;
    const ms = this.makeTarget(size, size, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)));
    const resolve = this.makeTarget(size, size, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fb);
    gl.viewport(0, 0, size, size);
    gl.clearColor(...(background || [0, 0, 0, 0])); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const fov = 30;
    const distance = bounds.radius / Math.sin((fov * Math.PI) / 360) / fill;
    const camera = { target: bounds.centre, yaw, pitch, distance, fov };
    const cp = Math.cos(pitch);
    const eye = [bounds.centre[0] + distance * cp * Math.sin(yaw), bounds.centre[1] + distance * Math.sin(pitch), bounds.centre[2] + distance * cp * Math.cos(yaw)];
    const { viewProj } = this.matrices(1, camera, eye);
    this.drawMeshes(viewProj, eye, { objects, mode, wire: false });
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve.fb);
    gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolve.fb);
    const px = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const t of [ms, resolve]) { gl.deleteFramebuffer(t.fb); gl.deleteRenderbuffer(t.color); gl.deleteRenderbuffer(t.depth); }
    const out = document.createElement('canvas'); out.width = out.height = size;
    const g = out.getContext('2d'), img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    g.putImageData(img, 0, 0);
    this.dirty = true;
    return out;
  }
}

function toHalf(value) {
  const f = new Float32Array([value]), i = new Uint32Array(f.buffer)[0];
  const sign = (i >> 16) & 0x8000, exp = ((i >> 23) & 0xff) - 112, mant = i & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >> 13);
}

// ------------------------------------------------------------------------------------------------ line helpers
export class LineBuilder {
  constructor() { this.data = []; }
  line(a, b, c) { this.data.push(a[0], a[1], a[2], c[0], c[1], c[2], c[3] ?? 1, b[0], b[1], b[2], c[0], c[1], c[2], c[3] ?? 1); return this; }
  box(lo, hi, c, matrix = null, tp = null) {
    const P = [];
    for (let i = 0; i < 8; i++) P.push([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
    const Q = matrix && tp ? P.map((p) => tp(matrix, p)) : P;
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) this.line(Q[a], Q[b], c);
    return this;
  }
  circle(centre, radius, axis, c, segments = 48) {
    const [u, v] = axis === 'y' ? [[1, 0, 0], [0, 0, 1]] : axis === 'x' ? [[0, 1, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
    let prev = null;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2, p = [0, 1, 2].map((k) => centre[k] + (u[k] * Math.cos(a) + v[k] * Math.sin(a)) * radius);
      if (prev) this.line(prev, p, c);
      prev = p;
    }
    return this;
  }
  arrow(from, to, c) {
    this.line(from, to, c);
    const d = [0, 1, 2].map((k) => to[k] - from[k]), l = Math.hypot(...d) || 1, head = Math.min(0.18, l * 0.3);
    const n = d.map((x) => x / l), side = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const s = [n[1] * side[2] - n[2] * side[1], n[2] * side[0] - n[0] * side[2], n[0] * side[1] - n[1] * side[0]];
    const sl = Math.hypot(...s) || 1;
    for (const sign of [1, -1]) this.line(to, [0, 1, 2].map((k) => to[k] - n[k] * head + (s[k] / sl) * head * 0.5 * sign), c);
    return this;
  }
  build() { return new Float32Array(this.data); }
}

/**
 * Frontier Landscape Studio — WebGL2 terrain renderer.
 *
 * One indexed mesh rebuilt from the baked height field, a planar-projected
 * albedo texture, a tiled detail normal, a translucent water plane and a set of
 * diagnostic views that read the erosion maps the simulator produces.
 */

import { rampColor, RAMPS } from '../core/textures.js';

/* ------------------------------------------------------------- mat4 utils */

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4Ortho(l, r, b, t, n, f) {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
  return m;
}

export function mat4LookAt(eye, center, up) {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / len, z1 = zy / len, z2 = zz / len;
  const xx = up[1] * z2 - up[2] * z1, xy = up[2] * z0 - up[0] * z2, xz = up[0] * z1 - up[1] * z0;
  len = Math.hypot(xx, xy, xz);
  if (!len) return mat4Identity();
  len = 1 / len;
  const x0 = xx * len, x1 = xy * len, x2 = xz * len;
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  const m = new Float32Array(16);
  m[0] = x0; m[1] = y0; m[2] = z0;
  m[4] = x1; m[5] = y1; m[6] = z1;
  m[8] = x2; m[9] = y2; m[10] = z2;
  m[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  m[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  m[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ shaders */

const TERRAIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;   // x,z in [0,1]; y = normalized height
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;

uniform mat4 uViewProj;
uniform float uWorldSize;
uniform float uMaxHeight;
uniform float uHeightScale;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out float vHeight;

void main() {
  vec3 p = vec3((aPosition.x - 0.5) * uWorldSize, aPosition.y * uMaxHeight * uHeightScale, (aPosition.z - 0.5) * uWorldSize);
  vWorld = p;
  vNormal = normalize(vec3(aNormal.x, aNormal.y / max(uHeightScale, 0.0001), aNormal.z));
  vUV = aUV;
  vHeight = aPosition.y;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in float vHeight;

uniform sampler2D uAlbedo;
uniform sampler2D uDetail;
uniform sampler2D uRamp;
uniform sampler2D uSlope;
uniform sampler2D uFlow;
uniform sampler2D uErosion;
uniform sampler2D uWaterMask;
uniform sampler2D uTalus;

uniform int uMode;              // 0 shaded 1 height 2 slope 3 normal 4 flow 5 erosion 6 water 7 talus 8 aspect
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uAmbient;
uniform float uExposure;
uniform float uSunIntensity;
uniform float uDetailStrength;
uniform float uDetailScale;
uniform float uSeaLevel;
uniform float uMaxHeight;
uniform float uWorldSize;
uniform float uGrid;            // 0 off, 1 on
uniform float uGridStep;        // cells per minor line
uniform float uRes;
uniform float uContours;        // 0 off, else metres between lines
uniform float uContourMajor;    // every Nth line is an index contour
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uBrushPos;         // world XZ, Y unused
uniform float uBrushRadius;
uniform float uBrushActive;
uniform float uBrushFalloff;
uniform float uTime;
uniform float uShadows;

out vec4 fragColor;

vec3 srgbToLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

float rampSample(float t) { return texture(uRamp, vec2(clamp(t, 0.0, 1.0), 0.5)).r; }
vec4 rampColor(float t) { return texture(uRamp, vec2(clamp(t, 0.0, 1.0), 0.5)); }

// Distribution term for a compact specular highlight.
float ggx(float NoH, float roughness) {
  float a = max(roughness * roughness, 0.002);
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * d * d, 1e-6);
}
float schlick(float cosTheta, float f0) { return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0); }

// Contour lines with derivative-aware anti-aliasing.
float contourMask(float value, float interval, float major) {
  if (interval <= 0.0) return 0.0;
  float s = value / interval;
  float f = abs(fract(s - 0.5) - 0.5) / max(fwidth(s), 1e-5);
  float line = 1.0 - clamp(f, 0.0, 1.0);
  float ms = value / (interval * major);
  float mf = abs(fract(ms - 0.5) - 0.5) / max(fwidth(ms), 1e-5);
  float majorLine = 1.0 - clamp(mf, 0.0, 1.0);
  return clamp(line * 0.5 + majorLine * 0.9, 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float slope = texture(uSlope, vUV).r;
  float elevationMetres = vHeight * uMaxHeight;

  vec3 baseColor;
  float smoothness = 0.3;

  if (uMode == 0) {
    vec4 tex = texture(uAlbedo, vUV);
    baseColor = srgbToLinear(tex.rgb);
    smoothness = tex.a;

    // Tiled detail normal keeps the surface from looking plastic up close.
    vec3 dn = texture(uDetail, vUV * uDetailScale).xyz * 2.0 - 1.0;
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5, 0.0, 0.0));
    vec3 B = cross(N, T);
    vec3 perturbed = normalize(N + (T * dn.x + B * dn.y) * uDetailStrength * (0.4 + slope * 1.6));
    N = normalize(mix(N, perturbed, clamp(uDetailStrength, 0.0, 1.0)));
  } else if (uMode == 1) {
    baseColor = srgbToLinear(rampColor(vHeight).rgb);
    smoothness = 0.2;
  } else if (uMode == 2) {
    baseColor = srgbToLinear(rampColor(slope).rgb);
    smoothness = 0.2;
  } else if (uMode == 3) {
    baseColor = N * 0.5 + 0.5;
    smoothness = 0.0;
  } else if (uMode == 4) {
    baseColor = srgbToLinear(rampColor(texture(uFlow, vUV).r).rgb);
    smoothness = 0.1;
  } else if (uMode == 5) {
    // Signed: below 0.5 the ground was cut, above it material was deposited.
    baseColor = srgbToLinear(rampColor(texture(uErosion, vUV).r).rgb);
    smoothness = 0.15;
  } else if (uMode == 6) {
    float w = texture(uWaterMask, vUV).r;
    baseColor = mix(srgbToLinear(rampColor(vHeight).rgb), vec3(0.02, 0.10, 0.16), clamp(w, 0.0, 1.0));
    smoothness = mix(0.2, 0.9, w);
  } else if (uMode == 7) {
    baseColor = srgbToLinear(rampColor(texture(uTalus, vUV).r).rgb);
    smoothness = 0.2;
  } else {
    // Aspect: compass direction each face points, useful for reading form.
    float a = atan(N.z, N.x) / 6.2831853 + 0.5;
    baseColor = srgbToLinear(rampColor(a).rgb);
    smoothness = 0.2;
  }

  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);

  float NoL = max(dot(N, L), 0.0);
  float wrap = clamp((dot(N, L) + 0.35) / 1.35, 0.0, 1.0);
  float NoV = max(dot(N, V), 1e-4);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);

  // Sky / ground ambient from the normal's up-ness.
  float skyMix = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = mix(uGroundColor, uSkyColor, skyMix) * uAmbient;

  float roughness = clamp(1.0 - smoothness, 0.04, 1.0);
  float f0v = mix(0.03, 0.5, smoothness);
  vec3 F = vec3(schlick(VoH, f0v));
  float D = ggx(NoH, roughness);
  float vis = 0.25 / max(NoL * NoV, 1e-4);
  vec3 specular = D * F * vis * uSunColor * uSunIntensity * NoL;

  vec3 diffuse = baseColor * (1.0 - F * 0.4);
  vec3 color = diffuse * (uSunColor * uSunIntensity * wrap + ambient) + specular * uShadows;

  // Elevation fog against the horizon colour.
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity * 0.00045);
  color = mix(color, srgbToLinear(uFogColor), clamp(fog, 0.0, 0.85));

  // Shoreline darkening where the terrain meets the water plane.
  float shore = smoothstep(0.0, 0.02, vHeight - uSeaLevel) * (1.0 - smoothstep(0.02, 0.06, vHeight - uSeaLevel));
  color *= 1.0 - shore * 0.22;

  if (uContours > 0.0) {
    float c = contourMask(elevationMetres, uContours, uContourMajor);
    vec3 ink = mix(vec3(0.92, 0.88, 0.78), vec3(1.0), step(0.5, c));
    color = mix(color, srgbToLinear(ink) * 0.9 + color * 0.35, c * 0.65);
  }

  if (uGrid > 0.5) {
    vec2 g = vUV * (uRes - 1.0) / max(uGridStep, 1.0);
    vec2 f = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-5));
    float line = 1.0 - clamp(min(f.x, f.y), 0.0, 1.0);
    vec2 gm = vUV * (uRes - 1.0) / max(uGridStep * 8.0, 8.0);
    vec2 fm = abs(fract(gm - 0.5) - 0.5) / max(fwidth(gm), vec2(1e-5));
    float major = 1.0 - clamp(min(fm.x, fm.y), 0.0, 1.0);
    color = mix(color, vec3(0.75, 0.82, 0.9), line * 0.14);
    color = mix(color, vec3(0.85, 0.9, 0.98), major * 0.3);
  }

  if (uBrushActive > 0.5) {
    float d = length(vWorld.xz - uBrushPos.xz);
    float r = max(uBrushRadius, 0.001);
    float inside = 1.0 - smoothstep(r * (1.0 - uBrushFalloff), r, d);
    float ring = smoothstep(r * 0.97, r, d) * (1.0 - smoothstep(r, r * 1.04, d));
    float pulse = 0.6 + 0.4 * sin(uTime * 3.0);
    color = mix(color, color + vec3(0.10, 0.14, 0.18) * inside, inside * 0.55);
    color = mix(color, vec3(0.92, 0.95, 1.0) * pulse, ring * 0.85);
  }

  color *= uExposure;
  fragColor = vec4(linearToSrgb(color), 1.0);
}`;

const WATER_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
uniform mat4 uViewProj;
uniform float uWorldSize;
uniform float uLevel;
out vec3 vWorld;
void main() {
  vec3 p = vec3(aQuad.x * uWorldSize, uLevel, aQuad.y * uWorldSize);
  vWorld = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform sampler2D uHeightTex;   // R8 normalized height, used for shoreline fade
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uDeepColor;
uniform float uTime;
uniform float uMaxHeight;
uniform float uLevel;
uniform float uOpacity;
uniform float uRipple;
uniform float uFoam;
uniform float uExposure;
uniform float uWorldSize;
out vec4 fragColor;

vec3 srgbToLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

float wave(vec2 p, float t) {
  float s = 0.0;
  s += sin(p.x * 0.55 + t * 1.1) * 0.5;
  s += sin(p.y * 0.41 - t * 0.9) * 0.5;
  s += sin((p.x + p.y) * 1.7 + t * 1.7) * 0.22;
  s += sin((p.x - p.y) * 3.1 - t * 2.3) * 0.12;
  return s;
}

void main() {
  vec2 uv = (vWorld.xz / uWorldSize) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  float ground = texture(uHeightTex, uv).r;
  if (ground > uLevel) discard;

  float depth = (uLevel - ground) * uMaxHeight;
  float t = uTime * 0.7;
  vec2 p = vWorld.xz * 0.35;

  // Analytic ripple normal from the sum of travelling sine waves.
  float e = 0.35;
  float hL = wave(p - vec2(e, 0.0), t), hR = wave(p + vec2(e, 0.0), t);
  float hD = wave(p - vec2(0.0, e), t), hU = wave(p + vec2(0.0, e), t);
  vec3 N = normalize(vec3(-(hR - hL) * uRipple, 1.0, -(hU - hD) * uRipple));

  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 220.0) * 1.6;
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);

  vec3 deep = srgbToLinear(uDeepColor);
  vec3 sky = srgbToLinear(uSkyColor);
  float beer = 1.0 - exp(-depth * 0.06);
  vec3 color = mix(sky * 0.55 + deep * 0.45, deep, beer);
  color = mix(color, sky, fresnel * 0.72);
  color += srgbToLinear(uSunColor) * spec * clamp(uFoam + 0.4, 0.0, 2.0);

  // Foam where the water is thin and along the shoreline.
  float shallow = 1.0 - clamp(depth / max(0.5, uFoam * 12.0 + 1.0), 0.0, 1.0);
  float crest = smoothstep(0.55, 1.15, wave(p * 1.9, t * 1.4) * uRipple);
  color = mix(color, vec3(0.86, 0.92, 0.95), clamp(shallow * crest * uFoam * 1.5, 0.0, 0.85));

  float edge = smoothstep(0.0, 0.004, uLevel - ground);
  fragColor = vec4(linearToSrgb(color * uExposure), clamp(uOpacity * (0.35 + edge * 0.65), 0.0, 1.0));
}`;

const SKY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
out vec2 vUV;
void main() { vUV = aQuad * 0.5 + 0.5; gl_Position = vec4(aQuad, 0.9999, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGroundTint;
uniform float uExposure;
out vec4 fragColor;
vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
void main() {
  float t = clamp((vUV.y - 0.42) * 2.4, -1.0, 1.0);
  vec3 c = t >= 0.0
    ? mix(uHorizon, uTop, pow(t, 0.65))
    : mix(uHorizon, uGroundTint, pow(-t, 0.8));
  // Gentle vertical banding so the sky is not perfectly flat.
  c *= 1.0 + (vUV.y - 0.5) * 0.03;
  fragColor = vec4(linearToSrgb(c * uExposure), 1.0);
}`;

/* ------------------------------------------------------------------ helpers */

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, uniforms };
}

function makeRampTexture(gl, ramp) {
  const size = 256;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = rampColor(ramp, i / (size - 1));
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeFieldTexture(gl, field, res) {
  const data = new Uint8Array(res * res);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, field[i] * 255));
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, res, res, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const VIEW_MODES = {
  shaded: 0, height: 1, slope: 2, normal: 3, flow: 4, erosion: 5, water: 6, talus: 7, aspect: 8,
};

export const VIEW_MODE_LIST = [
  { id: 'shaded', name: 'Shaded', ramp: null },
  { id: 'height', name: 'Height', ramp: RAMPS.height },
  { id: 'slope', name: 'Slope', ramp: RAMPS.slope },
  { id: 'flow', name: 'Flow', ramp: RAMPS.flow },
  { id: 'erosion', name: 'Erosion', ramp: RAMPS.erosion },
  { id: 'talus', name: 'Talus', ramp: RAMPS.slope },
  { id: 'water', name: 'Water', ramp: RAMPS.height },
  { id: 'normal', name: 'Normals', ramp: null },
  { id: 'aspect', name: 'Aspect', ramp: RAMPS.aspect },
];

/* --------------------------------------------------------------- renderer */

export class TerrainRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');

    this.terrain = program(gl, TERRAIN_VS, TERRAIN_FS);
    this.water = program(gl, WATER_VS, WATER_FS);
    this.sky = program(gl, SKY_VS, SKY_FS);

    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.indexCount = 0;

    this.waterVao = gl.createVertexArray();
    this.waterBuffer = gl.createBuffer();
    gl.bindVertexArray(this.waterVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.55, -0.55, 0.55, -0.55, -0.55, 0.55,
      -0.55, 0.55, 0.55, -0.55, 0.55, 0.55,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.skyVao = gl.createVertexArray();
    this.skyBuffer = gl.createBuffer();
    gl.bindVertexArray(this.skyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.albedoTex = null;
    this.detailTex = null;
    this.fieldTextures = {};
    this.rampTextures = {};
    for (const [key, ramp] of Object.entries(RAMPS)) this.rampTextures[key] = makeRampTexture(gl, ramp);
    this.activeRamp = this.rampTextures.height;

    this.camera = { yaw: 0.72, pitch: 0.62, distance: 2600, target: [0, 0, 0], fov: 46 };
    this.resolution = 0;
    this.heightField = null;
    this.worldSize = 2048;
    this.maxHeight = 900;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.05, 0.055, 0.065, 1);
  }

  /** Rebuild the terrain mesh from a baked height field. */
  setHeight(height, res, worldSize, maxHeight) {
    const gl = this.gl;
    this.resolution = res;
    this.heightField = new Float32Array(height);
    this.worldSize = worldSize;
    this.maxHeight = maxHeight;

    const cellWorld = worldSize / (res - 1);
    const vCount = res * res;
    // Interleaved: position(3) normal(3) uv(2)
    const verts = new Float32Array(vCount * 8);
    const heightScale = maxHeight / cellWorld;

    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x;
        const o = i * 8;
        const u = x / (res - 1), v = y / (res - 1);
        verts[o] = u; verts[o + 1] = height[i]; verts[o + 2] = v;

        const xm = Math.max(0, x - 1), xp = Math.min(res - 1, x + 1);
        const ym = Math.max(0, y - 1), yp = Math.min(res - 1, y + 1);
        const gx = (height[yp * res + xp] === undefined ? 0 : height[y * res + xp] - height[y * res + xm]) / (xp - xm);
        const gy = (height[yp * res + x] - height[ym * res + x]) / (yp - ym);
        // Normal in normalized-height space; the shader rescales by heightScale.
        let nx = -gx * heightScale, ny = 1, nz = -gy * heightScale;
        const len = Math.hypot(nx, ny, nz) || 1;
        verts[o + 3] = nx / len; verts[o + 4] = ny / len; verts[o + 5] = nz / len;
        verts[o + 6] = u; verts[o + 7] = v;
      }
    }

    const useUint32 = vCount > 65535;
    const quads = (res - 1) * (res - 1);
    const indices = useUint32 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    let k = 0;
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        const a = y * res + x, b = a + 1, c = a + res, d = c + 1;
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      }
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    this.verts = verts;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.bindVertexArray(null);

    // The draw call must use the same component type the buffer was built with,
    // otherwise small grids (16-bit indices) are read as 32-bit garbage.
    this.indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.indexCount = indices.length;
    this.triangleCount = quads * 2;
    this.vertexCount = vCount;
    return { triangles: this.triangleCount, vertices: vCount };
  }

  /**
   * Re-upload only part of the vertex buffer after a sculpt stroke, so painting
   * stays at frame rate instead of rebuilding the whole mesh each move.
   */
  patchHeight(height, x0, y0, x1, y1) {
    const gl = this.gl;
    const res = this.resolution;
    if (!res || !this.verts) return;
    const cellWorld = this.worldSize / (res - 1);
    const heightScale = this.maxHeight / cellWorld;
    this.heightField.set(height);

    const xa = Math.max(0, x0 - 1), xb = Math.min(res - 1, x1 + 1);
    const ya = Math.max(0, y0 - 1), yb = Math.min(res - 1, y1 + 1);
    const verts = this.verts;

    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const i = y * res + x;
        const o = i * 8;
        verts[o + 1] = height[i];
        const xm = Math.max(0, x - 1), xp = Math.min(res - 1, x + 1);
        const ym = Math.max(0, y - 1), yp = Math.min(res - 1, y + 1);
        const gx = (height[y * res + xp] - height[y * res + xm]) / (xp - xm || 1);
        const gy = (height[yp * res + x] - height[ym * res + x]) / (yp - ym || 1);
        let nx = -gx * heightScale, ny = 1, nz = -gy * heightScale;
        const len = Math.hypot(nx, ny, nz) || 1;
        verts[o + 3] = nx / len; verts[o + 4] = ny / len; verts[o + 5] = nz / len;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    for (let y = ya; y <= yb; y++) {
      const start = (y * res + xa) * 8;
      const count = (xb - xa + 1) * 8;
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, verts.subarray(start, start + count));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  setAlbedo(data, size) {
    const gl = this.gl;
    if (!data || !size) return;
    if (this.albedoTex) gl.deleteTexture(this.albedoTex);
    this.albedoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.albedoTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) {
      const max = gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
  }

  setDetailNormal(data, size) {
    const gl = this.gl;
    if (!data || !size) return;
    if (this.detailTex) gl.deleteTexture(this.detailTex);
    this.detailTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.detailTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  setDiagnostics(fields) {
    const gl = this.gl;
    for (const [key, value] of Object.entries(fields || {})) {
      if (!value || !value.field) continue;
      if (this.fieldTextures[key]) gl.deleteTexture(this.fieldTextures[key]);
      this.fieldTextures[key] = makeFieldTexture(gl, value.field, value.res);
    }
  }

  setRamp(modeId) {
    const entry = VIEW_MODE_LIST.find((m) => m.id === modeId);
    if (entry && entry.ramp) {
      const key = Object.keys(RAMPS).find((k) => RAMPS[k] === entry.ramp);
      this.activeRamp = this.rampTextures[key] || this.rampTextures.height;
    }
  }

  /** Camera eye position derived from the orbit parameters. */
  eyePosition() {
    const c = this.camera;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    return [
      c.target[0] + Math.cos(c.yaw) * cp * c.distance,
      c.target[1] + sp * c.distance,
      c.target[2] + Math.sin(c.yaw) * cp * c.distance,
    ];
  }

  resize() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    return { width: w, height: h, aspect: w / h };
  }

  /** Build the view-projection matrix for the current camera. */
  viewProjection(aspect, ortho = false) {
    const c = this.camera;
    const eye = this.eyePosition();
    const view = mat4LookAt(eye, c.target, [0, 1, 0]);
    if (ortho) {
      const half = c.distance * 0.5;
      return { vp: mat4Multiply(mat4Ortho(-half * aspect, half * aspect, -half, half, -c.distance * 8, c.distance * 8), view), eye };
    }
    const proj = mat4Perspective((c.fov * Math.PI) / 180, aspect, 0.5, c.distance * 12 + this.maxHeight * 4);
    return { vp: mat4Multiply(proj, view), eye };
  }

  draw(state) {
    const gl = this.gl;
    const { width, height, aspect } = this.resize();
    if (!this.indexCount) { gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); return; }

    const ortho = !!state.ortho;
    const { vp, eye } = this.viewProjection(aspect, ortho);
    const time = (state.time || 0) / 1000;
    const modeIndex = VIEW_MODES[state.viewMode] ?? 0;
    this.setRamp(state.viewMode);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    /* ---- sky ---- */
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.sky.program);
    gl.bindVertexArray(this.skyVao);
    const su = this.sky.uniforms;
    gl.uniform3fv(su.uTop, state.sky.top);
    gl.uniform3fv(su.uHorizon, state.sky.horizon);
    gl.uniform3fv(su.uGroundTint, state.sky.ground);
    gl.uniform1f(su.uExposure, state.sun.exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    /* ---- terrain ---- */
    const t = this.terrain;
    gl.useProgram(t.program);
    gl.bindVertexArray(this.vao);
    const u = t.uniforms;
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform1f(u.uWorldSize, this.worldSize);
    gl.uniform1f(u.uMaxHeight, this.maxHeight);
    gl.uniform1f(u.uHeightScale, state.heightScale ?? 1);
    gl.uniform1i(u.uMode, modeIndex);
    gl.uniform3fv(u.uSunDir, state.sunDir);
    gl.uniform3fv(u.uSunColor, state.sun.color);
    gl.uniform3fv(u.uSkyColor, state.sun.skyColor);
    gl.uniform3fv(u.uGroundColor, state.sky.ground);
    gl.uniform1f(u.uAmbient, state.sun.ambient);
    gl.uniform1f(u.uExposure, state.sun.exposure);
    gl.uniform1f(u.uSunIntensity, state.sun.intensity);
    gl.uniform1f(u.uDetailStrength, state.detailStrength ?? 0.5);
    gl.uniform1f(u.uDetailScale, state.detailScale ?? 46);
    gl.uniform1f(u.uSeaLevel, state.seaLevel);
    gl.uniform1f(u.uGrid, state.grid ? 1 : 0);
    gl.uniform1f(u.uGridStep, state.gridStep ?? 8);
    gl.uniform1f(u.uRes, this.resolution);
    gl.uniform1f(u.uContours, state.contours ? state.contourInterval : 0);
    gl.uniform1f(u.uContourMajor, state.contourMajor ?? 5);
    gl.uniform3fv(u.uCamPos, eye);
    gl.uniform3fv(u.uFogColor, state.sun.fogColor);
    gl.uniform1f(u.uFogDensity, state.sun.fog);
    gl.uniform3fv(u.uBrushPos, state.brush ? state.brush.pos : [0, 0, 0]);
    gl.uniform1f(u.uBrushRadius, state.brush ? state.brush.radius : 0);
    gl.uniform1f(u.uBrushActive, state.brush && state.brush.active ? 1 : 0);
    gl.uniform1f(u.uBrushFalloff, state.brush ? state.brush.falloff : 0.5);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uShadows, state.specular === false ? 0 : 1);

    const bind = (uniformName, textureKey, fallback) => {
      gl.activeTexture(gl.TEXTURE0 + fallback.unit);
      gl.bindTexture(gl.TEXTURE_2D, fallback.texture);
      gl.uniform1i(u[uniformName], fallback.unit);
    };
    bind('uAlbedo', 'albedo', { unit: 0, texture: this.albedoTex || this.rampTextures.height });
    bind('uDetail', 'detail', { unit: 1, texture: this.detailTex || this.rampTextures.height });
    bind('uRamp', 'ramp', { unit: 2, texture: this.activeRamp });
    bind('uSlope', 'slope', { unit: 3, texture: this.fieldTextures.slope || this.rampTextures.height });
    bind('uFlow', 'flow', { unit: 4, texture: this.fieldTextures.flow || this.rampTextures.height });
    bind('uErosion', 'erosion', { unit: 5, texture: this.fieldTextures.erosion || this.rampTextures.height });
    bind('uWaterMask', 'waterMask', { unit: 6, texture: this.fieldTextures.water || this.rampTextures.height });
    bind('uTalus', 'talus', { unit: 7, texture: this.fieldTextures.talus || this.rampTextures.height });

    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType || gl.UNSIGNED_INT, 0);

    /* ---- water ---- */
    if (state.water && state.water.enabled) {
      const w = this.water;
      gl.useProgram(w.program);
      gl.bindVertexArray(this.waterVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const wu = w.uniforms;
      gl.uniformMatrix4fv(wu.uViewProj, false, vp);
      gl.uniform1f(wu.uWorldSize, this.worldSize);
      gl.uniform1f(wu.uLevel, state.water.level * this.maxHeight * (state.heightScale ?? 1));
      gl.uniform3fv(wu.uCamPos, eye);
      gl.uniform3fv(wu.uSunDir, state.sunDir);
      gl.uniform3fv(wu.uSunColor, state.sun.color);
      gl.uniform3fv(wu.uSkyColor, state.sun.skyColor);
      gl.uniform3fv(wu.uDeepColor, state.water.deepColor);
      gl.uniform1f(wu.uTime, time);
      gl.uniform1f(wu.uMaxHeight, this.maxHeight * (state.heightScale ?? 1));
      gl.uniform1f(wu.uOpacity, state.water.opacity);
      gl.uniform1f(wu.uRipple, state.water.ripple);
      gl.uniform1f(wu.uFoam, state.water.foam);
      gl.uniform1f(wu.uExposure, state.sun.exposure);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTextures.heightR8 || this.rampTextures.height);
      gl.uniform1i(wu.uHeightTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(null);
    return { triangles: this.triangleCount, width, height };
  }

  /**
   * Ray-march the screen ray against the height field to find where the cursor
   * touches the terrain. Returns world coordinates plus grid UV, or null.
   */
  pick(ndcX, ndcY) {
    if (!this.heightField) return null;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const { vp, eye } = this.viewProjection(aspect, false);
    const inv = invertMat4(vp);
    if (!inv) return null;
    const near = unproject(inv, ndcX, ndcY, -1);
    const far = unproject(inv, ndcX, ndcY, 1);
    const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const len = Math.hypot(...dir) || 1;
    dir[0] /= len; dir[1] /= len; dir[2] /= len;

    const res = this.resolution;
    const hs = this.worldSize / 2;
    const heightAt = (wx, wz) => {
      const u = (wx + hs) / this.worldSize;
      const v = (wz + hs) / this.worldSize;
      if (u < 0 || u > 1 || v < 0 || v > 1) return -Infinity;
      const x = u * (res - 1), y = v * (res - 1);
      const xi = Math.min(res - 2, Math.floor(x)), yi = Math.min(res - 2, Math.floor(y));
      const tx = x - xi, ty = y - yi;
      const i = yi * res + xi;
      const a = this.heightField[i], b = this.heightField[i + 1];
      const c = this.heightField[i + res], d = this.heightField[i + res + 1];
      return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * this.maxHeight;
    };

    // Coarse march then a bisection refine: robust and allocation-free.
    const maxDist = this.worldSize * 6;
    const steps = 512;
    let prevT = 0;
    let prevAbove = eye[1] > heightAt(eye[0], eye[2]);
    for (let s = 1; s <= steps; s++) {
      const t = (s / steps) * maxDist;
      const px = eye[0] + dir[0] * t, py = eye[1] + dir[1] * t, pz = eye[2] + dir[2] * t;
      const h = heightAt(px, pz);
      if (h === -Infinity) { prevT = t; continue; }
      const above = py > h;
      if (prevAbove && !above) {
        let lo = prevT, hi = t;
        for (let r = 0; r < 24; r++) {
          const mid = (lo + hi) / 2;
          const mx = eye[0] + dir[0] * mid, my = eye[1] + dir[1] * mid, mz = eye[2] + dir[2] * mid;
          if (my > heightAt(mx, mz)) lo = mid; else hi = mid;
        }
        const tHit = (lo + hi) / 2;
        const hx = eye[0] + dir[0] * tHit, hz = eye[2] + dir[2] * tHit;
        return {
          world: [hx, eye[1] + dir[1] * tHit, hz],
          uv: [(hx + hs) / this.worldSize, (hz + hs) / this.worldSize],
          distance: tHit,
        };
      }
      prevAbove = above;
      prevT = t;
    }
    return null;
  }
}

function unproject(inv, x, y, z) {
  const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
  return [
    (inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w,
    (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w,
    (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w,
  ];
}

function invertMat4(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

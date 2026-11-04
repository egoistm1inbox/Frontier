// Fragment programs. Every program is GLSL ES 3.00 and starts with COMMON_GLSL.
import { COMMON_GLSL } from './chunks.ts';

export const FULLSCREEN_VS = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Writes the analytic field (macro + fine octave) for one brick slice. */
export const GEN_FS = `#version 300 es
precision highp float;
precision highp int;
${COMMON_GLSL}
uniform ivec3 uBaseCell;   // brick base cell index (texel 1 maps to this cell)
uniform float uCell;
uniform int uSlice;
uniform ivec2 uOrigin;     // slot origin xy in atlas texels
uniform float uFineAmp;
out float oSdf;
void main() {
  ivec3 t = ivec3(ivec2(gl_FragCoord.xy) - uOrigin, uSlice);
  vec3 pw = vec3(uBaseCell + t - ivec3(1)) * uCell;   // exact: integer × power-of-two cell
  float d = macroSDF(pw, 8);
  if (uFineAmp > 0.0) d += uFineAmp * fbm3(pw * P_FINE_FREQ, 4);
  oSdf = clamp(d / uCell, -BAND, BAND);
}`;

/** Copies one scratch slice back into the atlas. */
export const COPY_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler3D uScratch;
uniform ivec2 uDstXY;
uniform ivec3 uSrcOrigin;
uniform int uSlice;
out float oVal;
void main() {
  ivec2 l = ivec2(gl_FragCoord.xy) - uDstXY;
  oVal = texelFetch(uScratch, uSrcOrigin + ivec3(l, uSlice), 0).r;
}`;

/**
 * Sculpt pass: reads the current brick (atlas, read-only this pass) and writes the edited value into
 * the scratch buffer. Smoothing reads neighbours through sceneSDF(), so bricks that share a face
 * compute identical values there (no seams). Brushes are 1-Lipschitz blends, not raw offsets.
 */
export const SCULPT_FS = `#version 300 es
precision highp float;
precision highp int;
${COMMON_GLSL}
uniform ivec3 uSrcOrigin;   // atlas origin of the brick being edited
uniform vec3 uBrickRel;     // camera-relative position of brick cell 0
uniform float uCell;
uniform int uSlice;
uniform int uTool;          // 0 raise, 1 lower, 2 smooth, 3 flatten
uniform vec3 uBrushC;       // brush centre (camera-relative)
uniform vec3 uBrushN;       // surface normal at the centre
uniform float uBrushR;
uniform float uAmount;      // blend strength for this dab (0..1)
uniform float uFlatY;       // target height for flatten (camera-relative)
uniform float uSmoothOff;   // neighbour offset for smoothing (m)
out float oVal;

float smin_(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax_(float a, float b, float k) { return -smin_(-a, -b, k); }

float sculptValue(vec3 p, float d) {
  float w = 1.0 - smoothstep(0.0, uBrushR, length(p - uBrushC));
  float a = uAmount * w;
  if (a <= 0.0) return d;
  float k = max(0.25, uBrushR * 0.35);
  if (uTool == 0) {
    float ball = length(p - (uBrushC + uBrushN * uBrushR * 0.4)) - uBrushR;
    return mix(d, smin_(d, ball, k), a);
  }
  if (uTool == 1) {
    float ball = length(p - (uBrushC - uBrushN * uBrushR * 0.4)) - uBrushR;
    return mix(d, smax_(d, -ball, k), a);
  }
  if (uTool == 2) {
    float o = uSmoothOff;
    float avg = (sceneSDF(p + vec3(o, 0.0, 0.0), 8) + sceneSDF(p - vec3(o, 0.0, 0.0), 8)
               + sceneSDF(p + vec3(0.0, o, 0.0), 8) + sceneSDF(p - vec3(0.0, o, 0.0), 8)
               + sceneSDF(p + vec3(0.0, 0.0, o), 8) + sceneSDF(p - vec3(0.0, 0.0, o), 8)) / 6.0;
    return mix(d, avg, a);
  }
  return mix(d, p.y - uFlatY, a);
}

void main() {
  ivec3 t = ivec3(gl_FragCoord.xy, uSlice);
  float cur = texelFetch(uAtlas, uSrcOrigin + t, 0).r;
  vec3 p = uBrickRel + vec3(t - ivec3(1)) * uCell;
  float nd = sculptValue(p, cur * uCell);
  oVal = clamp(nd / uCell, -BAND, BAND);
}`;

/** Raymarcher + shading. In pick mode it writes the hit point (camera-relative) for one pixel. */
export const RAYMARCH_FS = `#version 300 es
precision highp float;
precision highp int;
${COMMON_GLSL}
uniform vec2 uRes;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uFocal;
uniform int uPickMode;        // 0 = shade, 1 = pick position, 2 = pick normal
uniform vec2 uPickPixel;
uniform float uSeaY;          // sea level (y=0 world) in camera-relative metres
uniform vec3 uSunDir;
uniform bool uShadows;
uniform bool uBrushOn;
uniform vec3 uBrushC;
uniform float uBrushR;
uniform float uMaxDist;
out vec4 oColor;

bool castRay(vec3 ro, vec3 rd, out float tOut) {
  float t = 0.0;
  for (int i = 0; i < 260; i++) {
    vec3 p = ro + rd * t;
    int oct = t < 1500.0 ? 8 : (t < 9000.0 ? 4 : 2);   // distance-based LOD of the macro field
    float d = sceneSDF(p, oct);
    float eps = max(0.01, 0.0007 * t);
    if (d < eps) { tOut = t; return true; }
    t += max(d * 0.6, 0.02);
    if (t > uMaxDist) break;
  }
  return false;
}

vec3 calcNormal(vec3 p, float t) {
  float e = max(0.25, 0.0007 * t);
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * sceneSDF(p + k.xyy * e, 6) + k.yyx * sceneSDF(p + k.yyx * e, 6)
                 + k.yxy * sceneSDF(p + k.yxy * e, 6) + k.xxx * sceneSDF(p + k.xxx * e, 6));
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.5 * pow(2.0, float(i));
    float d = sceneSDF(p + n * h, 6);
    occ += (h - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 0.6 * occ / 4.0, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.5;
  for (int i = 0; i < 40; i++) {
    float h = sceneSDF(ro + rd * t, 6);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.5, 40.0);
    if (res < 0.01 || t > 600.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 skyColor(vec3 rd) {
  float s = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(vec3(0.80, 0.86, 0.94), vec3(0.22, 0.42, 0.82), pow(s, 0.45));
  float sun = pow(max(dot(rd, uSunDir), 0.0), 400.0);
  return c + vec3(1.0, 0.92, 0.75) * sun * 3.0;
}

vec3 terrainColor(vec3 pw, vec3 n, float cdM) {
  float lat = 1.2 - pw.z / 110574.0;
  float arid = smoothstep(12.0, 20.0, lat) + smoothstep(-22.0, -29.0, lat);
  float mottle = 0.5 + 0.5 * vnoise3(pw * 0.00065);
  vec3 grass = mix(vec3(0.27, 0.40, 0.15), vec3(0.50, 0.47, 0.22), mottle);
  vec3 desert = mix(vec3(0.84, 0.70, 0.46), vec3(0.72, 0.56, 0.36), mottle);
  vec3 base = mix(grass, desert, clamp(arid, 0.0, 1.0));
  vec3 rock = vec3(0.42, 0.37, 0.33) * (0.75 + 0.5 * (0.5 + 0.5 * vnoise3(pw * 0.09)));
  base = mix(base, rock, smoothstep(0.45, 0.7, 1.0 - n.y));
  base = mix(base, vec3(0.86, 0.78, 0.58), (1.0 - smoothstep(600.0, 2200.0, abs(cdM))) * (1.0 - smoothstep(12.0, 30.0, pw.y)));
  base = mix(base, vec3(0.95, 0.96, 0.98), smoothstep(3300.0, 3700.0, pw.y) * smoothstep(0.6, 0.85, n.y));
  return base;
}

void main() {
  vec2 fc = uPickMode > 0 ? uPickPixel : gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uCamFwd * uFocal + uCamRight * uv.x + uCamUp * uv.y);
  vec3 ro = vec3(0.0);

  float tT = 0.0;
  bool hitT = castRay(ro, rd, tT);
  float tW = (abs(rd.y) > 1e-5) ? uSeaY / rd.y : -1.0;
  bool hitW = tW > 0.0;

  if (uPickMode > 0) {
    bool onLand = hitT && (!hitW || tT < tW);
    if (!onLand) { oColor = vec4(0.0); return; }
    vec3 hp = ro + rd * tT;
    oColor = (uPickMode == 1) ? vec4(hp, 1.0) : vec4(calcNormal(hp, tT), 1.0);
    return;
  }

  vec3 col;
  if (hitT && (!hitW || tT < tW)) {
    vec3 p = ro + rd * tT;
    vec3 pw = p + uCamWorld;
    vec3 n = calcNormal(p, tT);
    float cdM = coastKm(pw.xz) * 1000.0;
    col = terrainColor(pw, n, cdM);
    float dif = clamp(dot(n, uSunDir), 0.0, 1.0);
    float sh = (uShadows && tT < 3000.0) ? softShadow(p + n * 0.5, uSunDir) : 1.0;
    float ao = calcAO(p, n);
    vec3 amb = mix(vec3(0.32, 0.36, 0.42), vec3(0.42, 0.52, 0.66), 0.5 + 0.5 * n.y) * ao;
    col = col * (vec3(1.0, 0.95, 0.84) * dif * sh * 1.05 + amb);
    if (uBrushOn) {
      float dr = abs(length(p - uBrushC) - uBrushR);
      float ring = 1.0 - smoothstep(0.0, max(0.03, 0.0015 * tT), dr);
      float disc = (1.0 - smoothstep(uBrushR - 0.05, uBrushR, length(p - uBrushC))) * 0.12;
      col = mix(col, vec3(1.0, 0.85, 0.25), ring * 0.9 + disc);
    }
    col = mix(col, skyColor(rd), 1.0 - exp(-tT * 0.000025));
  } else if (hitW) {
    vec3 p = rd * tW;
    vec3 n = vec3(0.0, 1.0, 0.0);
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
    vec3 deep = vec3(0.03, 0.22, 0.32);
    vec3 refl = skyColor(reflect(rd, n));
    col = mix(deep, refl, 0.25 + 0.6 * fres);
    col += vec3(1.0, 0.9, 0.7) * pow(max(dot(reflect(-uSunDir, n), -rd), 0.0), 300.0) * 2.0;
    col = mix(col, skyColor(rd), 1.0 - exp(-tW * 0.000025));
  } else {
    col = skyColor(rd);
  }
  oColor = vec4(col, 1.0);
}`;

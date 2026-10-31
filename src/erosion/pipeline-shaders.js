/**
 * Composable GPU Stack Shaders (WebGL2 GLSL ES 3.00, ANGLE D3D11 HLSL Strict Compliant).
 *
 * Operates directly on `GpuErosionEngine`'s native `terrainTex` (`RGBA32F`:
 *   .r = bedrock height, .g = coarse talus, .b = fine sand/alluvium, .a = water depth)
 * plus `vecDispTex` (`RGBA32F`: 3D lateral overhang vector displacement) and `SdfCaveSystem`.
 *
 * Iterative physical simulation passes (hydraulic rain/pipe flow, thermal talus, cryosphere
 * snow/glaciers, aeolian wind) run through `erosion-shaders.js`'s strictly mass-conserving
 * GPU shaders — eliminating any possibility of iterative mass blowup or terrain stretching.
 */

import { COMMON_GEOLOGY_GLSL } from './erosion-shaders.js';

const GLSL_PRECISION_HEADER = `precision highp float;
precision highp int;
precision highp sampler2D;`;

const PIPELINE_MASK_GLSL = `
float safeSmoothstep(float e0, float e1, float x) {
  float lo = min(e0, e1);
  float hi = max(e0 + 1e-4, e1);
  float t = clamp((x - lo) / (hi - lo), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Evaluates a composable Black-and-White Layer Mask in [0, 1].
// uMaskCfg1 = (enabled, mode, minVal, maxVal)
// uMaskCfg2 = (feather, invert, noiseScale, seed)
// mode: 0=Height, 1=Slope, 2=Flow, 3=Concavity, 4=RadialCenter, 5=ProceduralNoise
float evalLayerMask(
  vec2 uv,
  vec2 worldXZ,
  float totalH,
  float maxRelief,
  float slopeDeg,
  float flowVal,
  float concavity,
  float worldSpan,
  vec4 uMaskCfg1,
  vec4 uMaskCfg2
) {
  if (uMaskCfg1.x < 0.5) return 1.0;

  int mode = int(uMaskCfg1.y + 0.5);
  float lo = uMaskCfg1.z;
  float hi = max(lo + 0.005, uMaskCfg1.w);
  float feath = max(0.015, uMaskCfg2.x);

  float metric = 0.0;
  if (mode == 0) {
    metric = clamp(totalH / max(20.0, maxRelief), 0.0, 1.2);
  } else if (mode == 1) {
    metric = clamp(slopeDeg / 75.0, 0.0, 1.0);
  } else if (mode == 2) {
    metric = clamp(flowVal, 0.0, 1.0);
  } else if (mode == 3) {
    metric = clamp(0.5 + concavity * 0.25, 0.0, 1.0);
  } else if (mode == 4) {
    metric = clamp(length(worldXZ) / (worldSpan * 0.52), 0.0, 1.2);
  } else {
    vec2 np = (worldXZ / max(1.0, worldSpan)) * max(0.4, uMaskCfg2.z) * 3.2 + vec2(uMaskCfg2.w * 0.013, uMaskCfg2.w * 0.029);
    metric = fbm2D(np, 4, 0.52);
  }

  float rampIn = safeSmoothstep(lo - feath, lo + feath * 0.35, metric);
  float rampOut = 1.0 - safeSmoothstep(hi - feath * 0.35, hi + feath, metric);
  float m = clamp(rampIn * rampOut, 0.0, 1.0);
  return uMaskCfg2.y > 0.5 ? (1.0 - m) : m;
}
`;

// ============================================================================
// 1. UNIFIED LANDFORM / DISPLACEMENT / SCULPT / SPLINE STACK PASS
// ============================================================================

export const STACK_OP_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec2 vUv;
layout(location = 0) out vec4 outTerrain; // (bedrock, coarseSed, fineSed, water)
layout(location = 1) out vec4 outVecDisp; // (dispX, dispY, dispZ, 0)

uniform sampler2D uTerrainTex;
uniform sampler2D uVecDispTex;
uniform sampler2D uSculptTex;
uniform sampler2D uVelocityFieldTex;

uniform vec4 uDomain;    // (worldSpan, gridRes, maxRelief, opKind)
uniform vec4 uParam0;
uniform vec4 uParam1;
uniform vec4 uParam2;
uniform vec4 uMaskCfg1;
uniform vec4 uMaskCfg2;
uniform vec4 uSplinePts[4]; // up to 8 (x, z) points packed as 4 vec4s
uniform int uSplineCount;

${COMMON_GEOLOGY_GLSL}
${PIPELINE_MASK_GLSL}

void evalSplineDist(vec2 xz, out float minDist, out float alongT) {
  minDist = 1e6;
  alongT = 0.0;
  int n = clamp(uSplineCount, 0, 8);
  if (n < 2) return;

  vec2 pts[8];
  pts[0] = uSplinePts[0].xy; pts[1] = uSplinePts[0].zw;
  pts[2] = uSplinePts[1].xy; pts[3] = uSplinePts[1].zw;
  pts[4] = uSplinePts[2].xy; pts[5] = uSplinePts[2].zw;
  pts[6] = uSplinePts[3].xy; pts[7] = uSplinePts[3].zw;

  float invSegs = 1.0 / float(max(1, n - 1));
  for (int i = 0; i < 7; i++) {
    if (i >= n - 1) break;
    vec2 a = pts[i];
    vec2 b = pts[i + 1];
    vec2 ab = b - a;
    float len2 = max(1e-4, dot(ab, ab));
    float t = clamp(dot(xz - a, ab) / len2, 0.0, 1.0);
    vec2 proj = a + ab * t;
    float d = length(xz - proj);
    if (d < minDist) {
      minDist = d;
      alongT = (float(i) + t) * invSegs;
    }
  }
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uDomain.y) - 1;
  float span = uDomain.x;
  float res = uDomain.y;
  float cellSize = span / res;
  float maxRelief = max(40.0, uDomain.z);
  int opKind = int(uDomain.w + 0.5);

  vec4 tC = texelFetch(uTerrainTex, c, 0);
  vec4 vd = texelFetch(uVecDispTex, c, 0);
  vec4 velD = texelFetch(uVelocityFieldTex, c, 0);

  vec4 tR = texelFetch(uTerrainTex, ivec2(min(maxI, c.x + 1), c.y), 0);
  vec4 tL = texelFetch(uTerrainTex, ivec2(max(0, c.x - 1), c.y), 0);
  vec4 tU = texelFetch(uTerrainTex, ivec2(c.x, min(maxI, c.y + 1)), 0);
  vec4 tD = texelFetch(uTerrainTex, ivec2(c.x, max(0, c.y - 1)), 0);

  float hC = tC.r + tC.g + tC.b;
  float hR = tR.r + tR.g + tR.b;
  float hL = tL.r + tL.g + tL.b;
  float hU = tU.r + tU.g + tU.b;
  float hD = tD.r + tD.g + tD.b;

  vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * cellSize);
  float slopeTan = length(grad);
  float slopeDeg = atan(slopeTan) * 57.2957795;
  float concavity = (hR + hL + hU + hD) * 0.25 - hC;
  float flowVal = clamp(velD.w * 2.4 + tC.a * 2.5, 0.0, 1.0);

  vec2 worldXZ = (vUv - 0.5) * span;
  float maskW = evalLayerMask(vUv, worldXZ, hC, maxRelief, slopeDeg, flowVal, concavity, span, uMaskCfg1, uMaskCfg2);

  if (opKind == 1) {
    // 1. PROCEDURAL LANDFORM MODIFIER (Ridges / Mesa / Escarpment / Dunes / Craters)
    int gen = int(uParam0.x + 0.5);
    int mode = int(uParam0.y + 0.5);
    float amp = uParam0.z;
    float sc = uParam0.w;
    float sharp = uParam1.x;
    float azRad = uParam1.y * 0.01745329;
    float opacity = uParam1.z * maskW;
    float seed = uParam2.x;
    vec2 sv = vec2(fract(seed * 0.1031) * 37.0, fract(seed * 0.1733) * 53.0);

    vec2 dir = vec2(cos(azRad), sin(azRad));
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 np = (worldXZ / (span * 0.5)) * sc;
    vec2 warp = vec2(fbm2D(np * 1.4 + sv, 3, 0.5), fbm2D(np * 1.4 + sv + 11.3, 3, 0.5)) - 0.5;
    vec2 wp = np + warp * 0.42;

    float shape = 0.0;
    float addFine = 0.0;
    if (gen == 0) {
      float r = ridgedFbm2D(wp * 1.6 + sv, 6, 0.58);
      shape = pow(max(1e-4, r), mix(1.8, 0.72, sharp));
    } else if (gen == 1) {
      float m = fbm2D(wp * 1.25 + sv, 5, 0.5);
      shape = safeSmoothstep(0.44 - (1.0 - sharp) * 0.18, 0.52 + (1.0 - sharp) * 0.18, m);
    } else if (gen == 2) {
      float faultCoord = dot(worldXZ / (span * 0.5), perp) + warp.x * 0.35;
      shape = safeSmoothstep(-0.22 * (1.15 - sharp), 0.22 * (1.15 - sharp), faultCoord);
    } else if (gen == 3) {
      float ph = fract(dot(worldXZ / span, dir) * sc * 3.8 + warp.y * 0.55);
      float stoss = safeSmoothstep(0.0, 0.72, ph);
      float lee = 1.0 - safeSmoothstep(0.72, 0.96, ph);
      shape = stoss * lee;
      addFine = shape * amp * 0.26 * opacity;
    } else {
      vec2 cell = floor(wp * 1.4);
      vec2 f = fract(wp * 1.4) - 0.5;
      vec2 j = (hash22(cell + sv) - 0.5) * 0.45;
      float d = length(f - j) * 2.1;
      float bowl = -(1.0 - safeSmoothstep(0.0, 0.68, d)) * (1.0 - d * d * 0.85);
      float rim = exp(-pow(max(0.0, d - 0.72) * 5.2, 2.0)) * 0.36;
      shape = bowl + rim;
    }

    float delta = shape * amp;
    float targetH = tC.r;
    if (mode == 0) targetH = tC.r + delta;
    else if (mode == 1) targetH = max(1.0, tC.r - abs(delta));
    else if (mode == 2) targetH = max(tC.r, delta + 12.0);
    else if (mode == 3) targetH = min(tC.r, max(2.0, amp));
    else targetH = delta + 10.0;

    tC.r = max(1.0, mix(tC.r, targetH, clamp(opacity, 0.0, 1.0)));
    tC.b = max(0.0, tC.b + addFine);
    outTerrain = tC;
    outVecDisp = vd;
    return;
  }

  if (opKind == 2) {
    // 2. STRATIGRAPHIC BEDS GEOMETRIC BENCHING & CAPROCK OVERHANG
    float bedCount = max(2.0, uParam0.x);
    float terraceStr = uParam0.y;
    float dipRad = uParam0.w * 0.01745329;
    float strikeRad = uParam1.x * 0.01745329;
    float ledgeOverhang = uParam1.z;
    float opacity = uParam1.w * maskW;
    float seed = uParam2.x;

    if ((terraceStr <= 0.001 && ledgeOverhang <= 0.001) || opacity <= 0.001) {
      outTerrain = tC;
      outVecDisp = vd;
      return;
    }

    vec2 dipDir = vec2(-sin(strikeRad), cos(strikeRad));
    float warp = (fbm2D(worldXZ * 0.009 + seed * 0.013, 3, 0.5) - 0.5) * 14.0;
    float stratCoord = (tC.r + dot(worldXZ, dipDir) * tan(dipRad) + warp) / max(30.0, maxRelief);

    float ph = stratCoord * bedCount;
    float idx = floor(ph);
    float f = fract(ph);
    float bedHard = hash12(vec2(idx, seed * 0.071));
    float stepF = mix(f, safeSmoothstep(0.18, 0.82, f), clamp(terraceStr * (0.45 + 0.55 * bedHard), 0.0, 0.96));
    float newStrat = (idx + stepF) / bedCount;
    float steppedH = newStrat * max(30.0, maxRelief) - dot(worldXZ, dipDir) * tan(dipRad) - warp;

    float slopeGate = safeSmoothstep(8.0, 34.0, slopeDeg);
    tC.r = max(1.0, mix(tC.r, steppedH, clamp(opacity * terraceStr * (0.35 + 0.65 * slopeGate), 0.0, 1.0)));

    if (ledgeOverhang > 0.005 && slopeTan > 0.25) {
      vec2 outDir = -grad / max(1e-4, slopeTan);
      float capPulse = sin(f * 6.2831853) * smoothstep(0.55, 0.92, bedHard);
      float pushM = capPulse * ledgeOverhang * 4.2 * safeSmoothstep(22.0, 56.0, slopeDeg) * opacity;
      vd.xz += outDir * pushM;
      vd.y += max(0.0, capPulse) * ledgeOverhang * 0.9 * opacity;
    }

    outTerrain = tC;
    outVecDisp = vd;
    return;
  }

  if (opKind == 3) {
    // 3. ROCK STACKS / BOULDER TORS / HOODOOS (Slate-style tiered columns + 3D overhang/lean)
    float stackH = uParam0.x;
    float spacing = max(24.0, uParam0.y);
    float baseRad = max(4.0, uParam0.z);
    float taper = uParam0.w;
    float tiers = max(2.0, uParam1.x);
    float lean = uParam1.y;
    float leanAz = uParam1.z * 0.01745329;
    float capOverhang = uParam1.w;
    float opacity = uParam2.x * maskW;
    float seed = uParam2.y;

    vec2 cellUv = (worldXZ + span * 0.5) / spacing;
    vec2 cellId = floor(cellUv);
    vec2 local = (fract(cellUv) - 0.5) * spacing;

    float bestCol = 0.0;
    vec2 bestOffset = vec2(0.0);
    float bestTierFrac = 0.0;

    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cid = cellId + vec2(float(i), float(j));
        vec3 rnd = hash32(cid + vec2(seed * 0.031, seed * 0.077));
        if (rnd.z < 0.28) continue;
        vec2 center = (vec2(float(i), float(j)) + (rnd.xy - 0.5) * 0.58) * spacing;
        vec2 dVec = local - center;
        float ang = atan(dVec.y, dVec.x);
        float facet = 1.0 + 0.16 * cos(ang * 5.0 + rnd.x * 6.28) + 0.09 * sin(ang * 3.0 + rnd.y * 6.28);
        float rEff = baseRad * (0.68 + 0.55 * rnd.z) * facet;
        float rNorm = length(dVec) / max(1.0, rEff);
        if (rNorm < 1.18) {
          float profile = pow(max(1e-4, 1.0 - safeSmoothstep(0.0, 1.05, rNorm)), mix(0.45, 1.35, taper));
          float tierQuant = (floor(profile * tiers) + safeSmoothstep(0.12, 0.65, fract(profile * tiers))) / tiers;
          float colH = stackH * (0.55 + 0.60 * rnd.x) * mix(profile, tierQuant, 0.72);
          if (colH > bestCol) {
            bestCol = colH;
            bestOffset = dVec;
            bestTierFrac = clamp(colH / max(1.0, stackH), 0.0, 1.0);
          }
        }
      }
    }

    if (bestCol > 0.05) {
      tC.r += bestCol * opacity;
      vec2 leanDir = vec2(cos(leanAz), sin(leanAz));
      vec2 radDir = length(bestOffset) > 0.05 ? normalize(bestOffset) : vec2(0.0);
      float capRim = sin(bestTierFrac * tiers * 6.2831853) * 0.5 + 0.5;
      float overhangM = capOverhang * 4.6 * bestTierFrac * capRim;
      vd.xz += (leanDir * (lean * bestTierFrac * 6.5) + radDir * overhangM) * opacity;
    }

    outTerrain = tC;
    outVecDisp = vd;
    return;
  }

  if (opKind == 4) {
    // 4. RUGGED CLIFF 3D PUSH-PULL DISPLACEMENT
    float dispAmp = uParam0.x;
    float featScale = uParam0.y;
    float slopeMinDeg = uParam0.z;
    float ledgeStr = uParam0.w;
    float overhangBias = uParam1.x;
    float vertCrease = uParam1.y;
    float opacity = uParam1.z * maskW;
    float seed = uParam1.w;

    float cliffMask = safeSmoothstep(slopeMinDeg - 4.0, slopeMinDeg + 14.0, slopeDeg) * opacity;
    if (cliffMask > 0.002 && dispAmp > 0.01) {
      vec2 outDir = slopeTan > 1e-4 ? (-grad / slopeTan) : vec2(0.0);
      vec2 np = (worldXZ / 85.0) * featScale + vec2(seed * 0.019, seed * 0.041);
      float buttress = ridgedFbm2D(np, 4, 0.56) * 2.0 - 1.0;
      float chute = pow(max(1e-4, abs(sin(dot(worldXZ, vec2(-outDir.y, outDir.x)) * 0.065 * featScale + buttress * 1.4))), 1.6);
      float ledges = sin((tC.r / 9.5) * featScale * 2.2 + buttress * 1.8);

      float heightPush = (buttress * 0.55 - (1.0 - chute) * vertCrease * 0.48 + ledges * ledgeStr * 0.35) * dispAmp;
      tC.r = max(1.0, tC.r + heightPush * cliffMask * 0.55);

      float lateralPush = (overhangBias * 0.65 + ledges * ledgeStr * 0.55 + buttress * 0.40) * dispAmp * 0.62 * cliffMask;
      vd.xz += outDir * lateralPush;
      vd.y += max(0.0, ledges) * ledgeStr * dispAmp * 0.14 * cliffMask;
    }

    outTerrain = tC;
    outVecDisp = vd;
    return;
  }

  if (opKind == 5) {
    // 5. NON-DESTRUCTIVE GPU SCULPT LAYER (Height Add/Carve + Laplacian Smooth)
    float opacity = uParam0.x * maskW;
    vec4 sc = texelFetch(uSculptTex, c, 0);
    float avgBed = (tR.r + tL.r + tU.r + tD.r) * 0.25;
    float smoothed = mix(tC.r, avgBed, clamp(sc.g, 0.0, 0.92));
    tC.r = max(1.0, mix(tC.r, smoothed + sc.r, clamp(opacity, 0.0, 1.0)));
    outTerrain = tC;
    outVecDisp = vd;
    return;
  }

  if (opKind == 6) {
    // 6. SPATIAL SPLINE FEATURE (0=Canyon Gorge Cut, 1=Graded Road, 2=Hydrostatic Lake Basin)
    int mode = int(uParam0.x + 0.5);
    float width = max(6.0, uParam0.y);
    float depth = uParam0.z;
    float steep = uParam0.w;
    float meander = uParam1.x;
    float waterFill = uParam1.y;
    float bankFall = max(0.1, uParam1.z);
    float opacity = uParam1.w * maskW;

    float dSpline;
    float alongT;
    evalSplineDist(worldXZ, dSpline, alongT);

    float wallWarp = (fbm2D(worldXZ * 0.032, 3, 0.52) - 0.5) * width * 0.55 * meander;
    float dWarped = max(0.0, dSpline + wallWarp);
    float halfW = width * 0.5;

    if (mode == 0) {
      // Canyon Gorge Cut + optional river channel water
      float inner = 1.0 - safeSmoothstep(halfW * (0.25 + 0.55 * steep), halfW * (1.0 + bankFall), dWarped);
      float cut = depth * pow(max(1e-4, inner), mix(1.6, 0.65, steep));
      tC.r = max(1.5, tC.r - cut * opacity);
      if (waterFill > 0.01 && dWarped < halfW * 0.72) {
        float wDepth = waterFill * depth * 0.22 * (1.0 - safeSmoothstep(0.0, halfW * 0.72, dWarped));
        tC.a = max(tC.a, wDepth * opacity);
      }
    } else if (mode == 1) {
      // Graded Mountain Road / Bench Terrace
      float roadMask = 1.0 - safeSmoothstep(halfW * 0.65, halfW * (1.0 + bankFall), dWarped);
      float gradeElev = mix(maxRelief * 0.24, maxRelief * 0.56, alongT);
      tC.r = max(1.5, mix(tC.r, gradeElev, roadMask * opacity));
      tC.g *= (1.0 - roadMask * 0.85 * opacity);
    } else {
      // Hydrostatic Lake Basin Excavation
      float basinMask = 1.0 - safeSmoothstep(halfW * 0.45, halfW * (1.15 + bankFall), dWarped);
      float targetFloor = max(2.0, tC.r - depth * basinMask);
      tC.r = mix(tC.r, targetFloor, opacity);
      if (waterFill > 0.01 && basinMask > 0.05) {
        float waterSurf = targetFloor + depth * waterFill * 0.65;
        tC.a = max(tC.a, max(0.0, waterSurf - (tC.r + tC.g + tC.b)) * basinMask * opacity);
      }
    }

    outTerrain = tC;
    outVecDisp = vd;
    return;
  }

  outTerrain = tC;
  outVecDisp = vd;
}
`;

// ============================================================================
// 2. NON-DESTRUCTIVE GPU SCULPT BRUSH STAMP
// ============================================================================

export const SCULPT_STAMP_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec2 vUv;
layout(location = 0) out vec4 outSculpt; // (deltaH, smoothWeight, 0, 0)

uniform sampler2D uSculptTex;
uniform vec4 uBrushPosRad; // (worldX, worldZ, radius, worldSpan)
uniform vec4 uBrushOpStr;  // (opCode: 0=add, 1=remove, 2=smooth, strength, 0, 0)

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 cur = texelFetch(uSculptTex, c, 0);
  vec2 worldXZ = (vUv - 0.5) * uBrushPosRad.w;
  float r = max(2.0, uBrushPosRad.z);
  float d = length(worldXZ - uBrushPosRad.xy);
  if (d >= r) {
    outSculpt = cur;
    return;
  }
  float t = 1.0 - d / r;
  float falloff = t * t * (3.0 - 2.0 * t);
  int op = int(uBrushOpStr.x + 0.5);
  float str = uBrushOpStr.y;

  if (op == 0) {
    cur.r = clamp(cur.r + falloff * str * 2.2, -160.0, 160.0);
  } else if (op == 1) {
    cur.r = clamp(cur.r - falloff * str * 2.2, -160.0, 160.0);
  } else {
    cur.r = mix(cur.r, 0.0, falloff * str * 0.25);
    cur.g = clamp(cur.g + falloff * str * 0.22, 0.0, 0.95);
  }
  outSculpt = cur;
}
`;

// ============================================================================
// 3. B&W SPATIAL MASK BAKE & MASKED SIMULATION BLEND SHADERS
// ============================================================================

export const STACK_MASK_BAKE_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec2 vUv;
layout(location = 0) out vec4 outMask;

uniform sampler2D uTerrainTex;
uniform sampler2D uVelocityFieldTex;
uniform vec4 uBakeDomain; // (worldSpan, gridRes, maxRelief, 0)
uniform vec4 uMaskCfg1;
uniform vec4 uMaskCfg2;

${COMMON_GEOLOGY_GLSL}
${PIPELINE_MASK_GLSL}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uBakeDomain.y) - 1;
  float span = uBakeDomain.x;
  float cellSize = span / uBakeDomain.y;

  vec4 tC = texelFetch(uTerrainTex, c, 0);
  vec4 tR = texelFetch(uTerrainTex, ivec2(min(maxI, c.x + 1), c.y), 0);
  vec4 tL = texelFetch(uTerrainTex, ivec2(max(0, c.x - 1), c.y), 0);
  vec4 tU = texelFetch(uTerrainTex, ivec2(c.x, min(maxI, c.y + 1)), 0);
  vec4 tD = texelFetch(uTerrainTex, ivec2(c.x, max(0, c.y - 1)), 0);
  vec4 velD = texelFetch(uVelocityFieldTex, c, 0);

  float hC = tC.r + tC.g + tC.b;
  float hR = tR.r + tR.g + tR.b;
  float hL = tL.r + tL.g + tL.b;
  float hU = tU.r + tU.g + tU.b;
  float hD = tD.r + tD.g + tD.b;

  vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * cellSize);
  float slopeDeg = atan(length(grad)) * 57.2957795;
  float concavity = (hR + hL + hU + hD) * 0.25 - hC;
  float flowVal = clamp(velD.w * 2.4 + tC.a * 2.5, 0.0, 1.0);
  vec2 worldXZ = (vUv - 0.5) * span;

  float m = evalLayerMask(vUv, worldXZ, hC, uBakeDomain.z, slopeDeg, flowVal, concavity, span, uMaskCfg1, uMaskCfg2);
  outMask = vec4(m, m, m, 1.0);
}
`;

export const STACK_MASK_BLEND_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

layout(location = 0) out vec4 outTex;

uniform sampler2D uPrevTex;
uniform sampler2D uNextTex;
uniform sampler2D uMaskTex;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 prevV = texelFetch(uPrevTex, c, 0);
  vec4 nextV = texelFetch(uNextTex, c, 0);
  float m = clamp(texelFetch(uMaskTex, c, 0).r, 0.0, 1.0);
  outTex = mix(prevV, nextV, m);
}
`;

export const STACK_COPY_VEC_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
layout(location = 0) out vec4 outVec;
uniform sampler2D uSrcTex;
void main() {
  outVec = texelFetch(uSrcTex, ivec2(gl_FragCoord.xy), 0);
}
`;

// ============================================================================
// 4. 3D VOLUMETRIC SDF CAVE & CLIFF-UNDERCUT MESH SHADER
// ============================================================================

export const SDF_CAVE_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aAttribs; // (ao, strataPhase, hardness, moisture)

uniform mat4 uViewProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vAttribs;

void main() {
  vWorldPos = aPos;
  vNormal = aNormal;
  vAttribs = aAttribs;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const SDF_CAVE_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vAttribs;

layout(location = 0) out vec4 outColor;

uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec4 uRenderDomain; // (worldSpan, gridRes, 1.0, maxRelief)
uniform ivec2 uShadeConfig; // (materialTheme, viewMode)

${COMMON_GEOLOGY_GLSL}

void main() {
  vec3 N = safeNorm3(vNormal, vec3(0.0, 1.0, 0.0));
  vec3 L = safeNorm3(uSunDir, vec3(0.4, 0.8, 0.4));
  vec3 V = safeNorm3(uCameraPos - vWorldPos, vec3(0.0, 1.0, 0.0));

  float ao = clamp(vAttribs.x, 0.10, 1.0);
  float strata = vAttribs.y;
  float hardness = vAttribs.z;
  int theme = uShadeConfig.x;
  int viewMode = uShadeConfig.y;

  vec3 rockDark = vec3(0.14, 0.13, 0.12);
  vec3 rockLight = vec3(0.36, 0.33, 0.30);
  if (theme == 0 || theme == 3) {
    rockDark = vec3(0.28, 0.12, 0.08);
    rockLight = vec3(0.62, 0.34, 0.21);
  } else if (theme == 1 || theme == 4 || theme == 8) {
    rockDark = vec3(0.09, 0.095, 0.105);
    rockLight = vec3(0.24, 0.25, 0.27);
  } else if (theme == 5 || theme == 6 || theme == 9) {
    rockDark = vec3(0.30, 0.22, 0.15);
    rockLight = vec3(0.64, 0.50, 0.36);
  }

  float bedBand = 0.5 + 0.5 * sin(strata * 6.2831853 * 2.0);
  vec3 albedo = mix(rockDark, rockLight, clamp(hardness * 0.65 + bedBand * 0.35, 0.0, 1.0));
  if (viewMode == 4) albedo = vec3(0.28, 0.27, 0.26);
  else if (viewMode == 2) albedo = mix(vec3(0.07, 0.22, 0.36), vec3(0.72, 0.44, 0.12), hardness);

  float portalBounce = clamp(ao * 1.15 - 0.12, 0.04, 1.0);
  float ndotl = max(0.0, dot(N, L)) * portalBounce * 0.65;
  vec3 ambient = mix(vec3(0.04, 0.045, 0.055), vec3(0.18, 0.22, 0.28), 0.5 + 0.5 * N.y) * ao;
  float rim = pow(max(1e-4, 1.0 - max(0.0, dot(N, V))), 3.0) * ao * 0.12;

  vec3 lit = albedo * (vec3(2.2, 2.05, 1.88) * ndotl + ambient) + vec3(0.22, 0.26, 0.32) * rim;
  vec3 x = max(vec3(0.0), lit);
  vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  outColor = vec4(pow(max(vec3(1e-6), clamp(mapped, 0.0, 1.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

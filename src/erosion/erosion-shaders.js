/**
 * WebGL2 GLSL ES 3.00 Shaders for the Hybrid GPU Particle + Shallow-Water + 3D Stratigraphic Hardness
 * & Multi-Species Sedimentation Engine.
 *
 * Strict ANGLE / D3D11 / Metal / Vulkan WebGL2 compliance:
 * - Explicit `precision highp float; precision highp int; precision highp sampler2D;` in every stage
 * - Zero `pow(negative, ...)` or unguarded `normalize(0)` so NaN propagation is impossible
 * - Zero `OES_texture_float_linear` requirement (uses exact `texelFetch` bilinear interpolation)
 */

const GLSL_PRECISION_HEADER = `precision highp float;
precision highp int;
precision highp sampler2D;`;

export const FULLSCREEN_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COMMON_GEOLOGY_GLSL = `
float sq(float v) { return v * v; }

vec2 safeNorm2(vec2 v, vec2 fallback) {
  float l2 = dot(v, v);
  return l2 > 1e-8 ? v * inversesqrt(l2) : fallback;
}

vec3 safeNorm3(vec3 v, vec3 fallback) {
  float l2 = dot(v, v);
  return l2 > 1e-8 ? v * inversesqrt(l2) : fallback;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float noise2D(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, b - b + d, u.x), u.y);
}

float fbm2D(vec2 p, int octaves, float roughness) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * noise2D(p);
    norm += amp;
    p = rot * p * 2.03 + vec2(17.1, 31.7);
    amp *= clamp(roughness, 0.35, 0.72);
  }
  return sum / max(norm, 1e-4);
}

float ridgedFbm2D(vec2 p, int octaves, float roughness) {
  float sum = 0.0;
  float amp = 0.5;
  float weight = 1.0;
  float norm = 0.0;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(noise2D(p) * 2.0 - 1.0);
    n = n * n * weight;
    weight = clamp(n * 1.8, 0.15, 1.0);
    sum += n * amp;
    norm += amp;
    p = rot * p * 2.07 + vec2(11.3, 23.9);
    amp *= clamp(roughness, 0.35, 0.68);
  }
  return sum / max(norm, 1e-4);
}

// Exact texelFetch bilinear sampler (works on 100% of WebGL2 GPUs without OES_texture_float_linear!)
vec4 sampleGridBilinear(sampler2D tex, vec2 uv, float res) {
  vec2 st = clamp(uv, vec2(0.5 / res), vec2(1.0 - 0.5 / res)) * res - 0.5;
  ivec2 i0 = ivec2(floor(st));
  vec2 f = fract(st);
  int maxI = int(res) - 1;
  ivec2 p00 = clamp(i0, ivec2(0), ivec2(maxI));
  ivec2 p10 = clamp(i0 + ivec2(1, 0), ivec2(0), ivec2(maxI));
  ivec2 p01 = clamp(i0 + ivec2(0, 1), ivec2(0), ivec2(maxI));
  ivec2 p11 = clamp(i0 + ivec2(1, 1), ivec2(0), ivec2(maxI));
  vec4 c00 = texelFetch(tex, p00, 0);
  vec4 c10 = texelFetch(tex, p10, 0);
  vec4 c01 = texelFetch(tex, p01, 0);
  vec4 c11 = texelFetch(tex, p11, 0);
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

/**
 * Evaluates 3D Geological Bedrock Hardness in [0.04, 0.99] at world position (wx, wy, wz).
 * uHardnessParams = (baseHardness, strataStrength, strataFreq, faultWeakness)
 * uStrataOrient   = (sinStrike, cosStrike, tanDip, reliefScale)
 */
float evalRockHardness3D(vec3 worldPos, vec4 uHardnessParams, vec4 uStrataOrient, float seedOff) {
  float baseH = uHardnessParams.x;
  float strataStr = uHardnessParams.y;
  float strataFreq = uHardnessParams.z;
  float faultWeak = uHardnessParams.w;

  vec2 sHoriz = worldPos.xz / max(uStrataOrient.w, 1.0);
  float acrossStrike = worldPos.x * uStrataOrient.x + worldPos.z * uStrataOrient.y;
  float warp = (fbm2D(sHoriz * 2.2 + seedOff, 3, 0.55) - 0.5) * 14.0;
  float stratY = worldPos.y + acrossStrike * uStrataOrient.z + warp;

  float phase1 = (stratY / max(uStrataOrient.w, 1.0)) * strataFreq * 6.2831853;
  float phase2 = phase1 * 2.7 + 1.3;
  float squareLedge = smoothstep(-0.28, 0.28, sin(phase1));
  float minorRib = 0.5 + 0.5 * sin(phase2);
  float stratHard = mix(0.10, 0.96, 0.72 * squareLedge + 0.28 * minorRib);

  float h = mix(baseH, mix(baseH * 0.35 + 0.05, min(0.98, baseH * 0.55 + 0.46), stratHard), strataStr);

  if (faultWeak > 0.01) {
    vec2 fp = worldPos.xz * 0.011 + vec2(seedOff * 0.37, -seedOff * 0.23);
    vec2 warpF = vec2(noise2D(fp * 1.9), noise2D(fp * 1.9 + 19.3)) * 0.55;
    float fLine1 = abs(sin((fp.x * 0.86 + fp.y * 0.51 + warpF.x) * 3.14159));
    float fLine2 = abs(sin((fp.x * -0.48 + fp.y * 0.88 + warpF.y) * 2.65));
    float faultGroove1 = 1.0 - smoothstep(0.0, 0.11, fLine1);
    float faultGroove2 = 1.0 - smoothstep(0.0, 0.09, fLine2);
    float faultMask = clamp(max(faultGroove1, faultGroove2 * 0.85), 0.0, 1.0);
    h *= (1.0 - 0.78 * faultWeak * faultMask);
  }

  return clamp(h, 0.04, 0.99);
}
`;

export const INIT_TERRAIN_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outTerrain;

uniform vec4 uInitParams; // (relief, roughness, terrainType, seed)
uniform float uWorldSpan;

${COMMON_GEOLOGY_GLSL}

float evalAsymmetricDuneM(float u, float v, float uCenter, float ampFrac, float wStoss, float ph, float reliefM, float spanM) {
  float sBend = 0.145 * sin(v * 2.75 + ph) + 0.048 * sin(v * 5.50 - ph * 1.3 + 0.7);
  float uBrink = uCenter + sBend;
  float peakMod = 0.76 + 0.24 * sin(v * 2.9 + ph * 0.6) * cos(v * 1.5 - ph * 0.4);
  float hCrestM = ampFrac * peakMod * reliefM;
  float dM = (u - uBrink) * 0.5 * spanM;
  if (dM >= 0.0) {
    float rawLee = hCrestM - dM * 0.670;
    if (rawLee <= -2.5) return 0.0;
    float k = 2.2;
    float h = clamp(0.5 + 0.5 * rawLee / k, 0.0, 1.0);
    return max(0.0, mix(0.0, rawLee, h) + k * h * (1.0 - h));
  } else {
    float stossSpanM = wStoss * 0.5 * spanM;
    float t = clamp(-dM / max(stossSpanM, 1.0), 0.0, 1.0);
    float prof = sq(1.0 - t) * (1.0 + 1.25 * t);
    return hCrestM * prof;
  }
}

float evalStarArmDuneM(vec2 uvRot, vec2 origin, float armAng, float armLen, float ampFrac, float reliefM, float spanM) {
  vec2 d = uvRot - origin;
  vec2 aDir = vec2(cos(armAng), sin(armAng));
  vec2 pDir = vec2(-aDir.y, aDir.x);
  float along = dot(d, aDir);
  if (along < -0.08 || along > armLen) return 0.0;
  float env = smoothstep(-0.08, 0.06, along) * (1.0 - smoothstep(armLen * 0.35, armLen, along));
  float curveOff = 0.055 * sin(along * 6.2);
  float acrossM = (dot(d, pDir) - curveOff) * 0.5 * spanM;
  float hCrestM = ampFrac * env * reliefM;
  if (hCrestM <= 0.05) return 0.0;
  if (acrossM >= 0.0) {
    return max(0.0, hCrestM - acrossM * 0.670);
  } else {
    float wM = (0.34 * env + 0.08) * 0.5 * spanM;
    float t = clamp(-acrossM / wM, 0.0, 1.0);
    return hCrestM * sq(1.0 - t) * (1.0 + 1.15 * t);
  }
}

float evalLunarCraterElev(vec2 p, vec2 center, float rad, float depthFrac, bool hasPeak) {
  float d = length(p - center) / max(rad, 1e-4);
  if (d > 2.6) return 0.0;
  if (d < 1.0) {
    // Bowl cavity + raised rim lip at d -> 1.0 + optional central rebound peak!
    float bowl = -depthFrac * (1.0 - d * d * (0.72 + 0.28 * d * d));
    float rimLip = depthFrac * 0.30 * smoothstep(0.68, 1.0, d);
    float cPeak = hasPeak ? depthFrac * 0.38 * exp(-d * d * 24.0) : 0.0;
    return bowl + rimLip + cPeak;
  } else {
    // Raised overturned ejecta rim decaying exponentially onto surrounding lunar mare
    return depthFrac * 0.30 * exp(-(d - 1.0) * 3.4);
  }
}

void main() {
  float relief = uInitParams.x;
  float rough = uInitParams.y;
  int kind = int(uInitParams.z + 0.5);
  float seed = uInitParams.w;

  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec2 seedVec = vec2(fract(seed * 0.0137) * 53.0, fract(seed * 0.0293) * 71.0);
  float seedPh = fract(seed * 0.00731) * 6.2831853;

  vec2 warp = vec2(
    fbm2D(p * 1.6 + seedVec, 4, 0.55) - 0.5,
    fbm2D(p * 1.6 + seedVec + vec2(13.7, 29.1), 4, 0.55) - 0.5
  ) * 0.45;
  vec2 wp = p + warp;

  float baseElev = 0.0;
  float initCoarse = 0.0;
  float initFine = 0.0;
  float initWater = 0.0;

  if (kind == 1) {
    // 1. Stratified Canyon Plateau & Piedmont Basin:
    // High dissected cuesta plateau on the upper two-thirds with sharp ridged drainage divides,
    // dropping across stepped canyon rims onto a broad low-gradient piedmont basin where braided alluvial fans spread!
    float cuestaRamp = smoothstep(-0.62, 0.28, -wp.y + 0.16 * sin(wp.x * 2.8));
    float rimIndent = ridgedFbm2D(wp * 2.3 + seedVec, 6, rough);
    float canyonTrunk = exp(-sq((wp.x - 0.18 * sin(wp.y * 3.1)) * 3.2)) * smoothstep(-0.75, 0.55, -wp.y);
    float highMesa = cuestaRamp * (0.58 + 0.44 * rimIndent) * (1.0 - 0.36 * canyonTrunk);
    float lowBasin = (1.0 - cuestaRamp) * (0.04 + 0.07 * fbm2D(wp * 3.4 + seedVec, 4, 0.5));
    baseElev = 0.04 + highMesa + lowBasin;
  } else if (kind == 2) {
    // 2. Tilted Fault Escarpment
    float faultTrace = wp.y + 0.14 * sin(wp.x * 3.5) + 0.08;
    float upBlock = smoothstep(-0.18, 0.24, -faultTrace);
    float ridgeDetail = ridgedFbm2D(wp * 2.4 + seedVec, 6, rough);
    baseElev = 0.06 + upBlock * (0.58 + 0.42 * ridgeDetail) + (1.0 - upBlock) * 0.10 * fbm2D(wp * 3.0 + seedVec, 4, 0.5);
  } else if (kind == 3) {
    // 3. Volcanic Stratocone & Breached Caldera Rim
    float radWarp = length(p + warp * 0.35);
    float cone = exp(-radWarp * radWarp * 2.35) * 1.18;
    float crater = exp(-radWarp * radWarp * 24.0) * 0.52;
    float breach = exp(-sq((p.x - 0.12) * 5.0)) * step(0.0, p.y) * exp(-sq((radWarp - 0.24) * 5.5)) * 0.28;
    float gullies = ridgedFbm2D(wp * 3.1 + seedVec, 6, rough) * 0.24 * smoothstep(0.05, 0.65, radWarp);
    baseElev = max(0.05, 0.06 + cone - crater - breach + gullies);
  } else if (kind == 4) {
    // 4. Soft-Shale Badlands & Caprock Domes
    float domes = ridgedFbm2D(wp * 2.8 + seedVec, 6, rough) * 0.62 + fbm2D(wp * 1.7 + seedVec, 5, rough) * 0.42;
    float basin = 1.0 - smoothstep(0.55, 1.02, r);
    baseElev = 0.08 + domes * mix(0.28, 1.0, basin);
  } else if (kind == 5) {
    // 5. Twin Basin Island Massif
    float peakA = exp(-dot(wp - vec2(-0.28, -0.16), wp - vec2(-0.28, -0.16)) * 4.2);
    float peakB = exp(-dot(wp - vec2( 0.26,  0.18), wp - vec2( 0.26,  0.18)) * 4.8) * 0.86;
    float saddle = exp(-dot(wp, wp) * 2.6) * 0.42;
    float crags = ridgedFbm2D(wp * 3.0 + seedVec, 6, rough);
    float coast = 1.0 - smoothstep(0.62, 0.98, r);
    baseElev = max(0.03, (0.05 + (peakA + peakB + saddle) * (0.55 + 0.55 * crags)) * coast);
  } else if (kind == 6) {
    // 6. ICELANDIC GLACIAL HIGHLANDS:
    // A broad high basaltic plateau ringed by flat-topped table mountains (tuyas) and rhyolite ridges,
    // deeply scoured by broad U-shaped glacial troughs that open onto a low black-sand sandur outwash plain!
    vec2 q = wp * 1.06;
    float plateau = smoothstep(0.62, -0.34, length(q * vec2(0.92, 1.0)) + 0.10 * sin(q.x * 3.1));
    float tuyaA = exp(-dot(q - vec2(-0.52, 0.24), q - vec2(-0.52, 0.24)) * 5.2);
    float tuyaB = exp(-dot(q - vec2(0.46, 0.38), q - vec2(0.46, 0.38)) * 4.4) * 0.92;
    float tuyaC = exp(-dot(q - vec2(0.12, -0.46), q - vec2(0.12, -0.46)) * 6.0) * 0.78;
    // Flat-topped tuya summits with steep columnar flanks (smoothstep clamp, not a cone apex!)
    float tuya = clamp(tuyaA + tuyaB + tuyaC, 0.0, 1.0);
    float tuyaTop = smoothstep(0.12, 0.62, tuya) * (0.52 + 0.20 * fbm2D(q * 5.5 + seedVec, 3, 0.5));
    // Rhyolite ridge swarm cross-cutting the plateau
    float rhyoliteRidge = ridgedFbm2D(q * vec2(2.1, 1.3) + seedVec + vec2(7.3, 19.1), 4, 0.46);
    float ridgeSwarm = smoothstep(0.40, 0.84, rhyoliteRidge) * 0.22 * plateau;
    // Broad glacial troughs (U-shaped, flat floors) radiating out from the ice cap centre
    float ang = atan(q.y, q.x);
    float trough = pow(max(0.0, cos(ang * 3.0 + 1.1)), 6.0);
    float troughMask = trough * smoothstep(0.18, 1.15, length(q));
    float troughFloor = 0.15 * smoothstep(0.05, 0.72, length(q));
    // Level outwash sandur radial plain draining southward
    float sandur = smoothstep(0.05, -0.72, q.y) * (0.035 + 0.022 * fbm2D(q * 6.0 + seedVec, 4, 0.5));
    float highland = plateau * (0.40 + 0.30 * fbm2D(q * 2.4 + seedVec, 5, 0.55)) + tuyaTop + ridgeSwarm;
    baseElev = 0.045 + mix(highland, troughFloor, troughMask * 0.82) + sandur * (1.0 - plateau);
  } else if (kind == 7) {
    // 7. GREATER HIMALAYAN SNOW MOUNTAINS (Non-Periodic Asymmetric Sanctuary Massif):
    // Zero repeating fract() stripes! One towering asymmetric Monarch massif off-center with a
    // sheer fluted south-east cirque wall, distinct satellite peaks of varied heights & angles,
    // multi-scale domain-warped dendritic arête divides, and a winding U-shaped glacier gorge.
    vec2 q1 = p + warp * 0.52;
    vec2 q2 = q1 + vec2(
      fbm2D(q1 * 1.35 + seedVec * 1.4, 3, 0.52) - 0.5,
      fbm2D(q1 * 1.35 + seedVec * 1.9 + 11.7, 3, 0.52) - 0.5
    ) * 0.38;

    // 1. Asymmetric tectonic blocks of distinctly different heights, footprints & orientations:
    // - Monarch massif (NW-N, 1.06x): elongated WNW-ESE, steep south face, broad north snowfield
    vec2 dMon = q1 - vec2(-0.24, 0.28);
    vec2 rMon = vec2(dMon.x * 0.88 - dMon.y * 0.47, dMon.x * 0.47 + dMon.y * 0.88);
    float monAsymY = rMon.y < 0.0 ? rMon.y * 1.85 : rMon.y * 0.95;
    float monarch = exp(-(rMon.x * rMon.x * 2.1 + monAsymY * monAsymY * 3.4)) * 0.92;

    // - Eastern Kangchen-style shoulder ridge (NE-E, 0.78x)
    vec2 dEast = q1 - vec2(0.46, 0.16);
    vec2 rEast = vec2(dEast.x * 0.76 + dEast.y * 0.65, -dEast.x * 0.65 + dEast.y * 0.76);
    float eastPeak = exp(-(rEast.x * rEast.x * 2.8 + rEast.y * rEast.y * 4.8)) * 0.74;

    // - Southwestern jagged spur massif (SW, 0.64x) + SE foothill buttress (0.48x)
    vec2 dSW = q1 - vec2(-0.54, -0.26);
    float swSpur = exp(-(dSW.x * dSW.x * 3.6 + dSW.y * dSW.y * 2.4)) * 0.62;
    vec2 dSE = q1 - vec2(0.56, -0.38);
    float seButtress = exp(-(dSE.x * dSE.x * 3.8 + dSE.y * dSE.y * 3.2)) * 0.48;

    // High northern Tibetan/Himadri backdrop ramp so the horizon is a continuous mountain wall
    float northBackdrop = smoothstep(-0.45, 0.85, q1.y + 0.12 * q1.x) * 0.42;

    // 2. Non-periodic multi-scale dendritic arêtes & watershed ridges (wavelength ~420m -> zero repetition!)
    float macroRidges = ridgedFbm2D(q2 * 1.28 + seedVec, 5, 0.52);
    float mesoSpurs   = ridgedFbm2D(q1 * 2.65 + seedVec + vec2(17.3, 31.9), 5, rough);
    float rawMassif   = max(max(monarch, eastPeak), max(swSpur, max(seButtress, northBackdrop)));
    float ridgeSculpt = rawMassif * (0.58 + 0.56 * macroRidges + 0.26 * mesoSpurs) + 0.18 * macroRidges * smoothstep(0.05, 0.45, rawMassif);

    // Asymmetric steep-headwall snow flutes & gendarme crags ONLY on high steep walls
    float highWall = smoothstep(0.36, 0.84, ridgeSculpt);
    float snowFlutes = (ridgedFbm2D(q1 * vec2(6.4, 3.1) + warp * 1.8 + seedVec, 4, 0.50) - 0.46) * 0.11 * highWall;

    // 3. Winding U-shaped trunk glacier canyon + 1 western cirque tributary carving deep relief contrast
    float gorgeSpine = 0.08 + 0.26 * sin(p.y * 1.85 + 0.4) + warp.x * 0.28;
    float dGorge = abs(p.x - gorgeSpine);
    float uTrough = smoothstep(0.26, 0.045, dGorge) * smoothstep(0.36, -0.85, p.y);
    float cirqueBowl = exp(-length((q1 - vec2(0.05, 0.06)) * vec2(2.6, 2.9))) * 0.65;
    float carve = clamp(max(uTrough * 0.84, cirqueBowl), 0.0, 0.86);

    float valleyFloor = 0.085 + 0.030 * fbm2D(q1 * 3.8 + seedVec, 3, 0.5) + 0.04 * (0.5 + 0.5 * p.y);
    baseElev = mix(0.11 + ridgeSculpt + snowFlutes, valleyFloor, carve);
    initCoarse = carve * (1.0 - uTrough * 0.45) * 0.016 * relief;
  } else if (kind == 8) {
    // 8. Grand Canyon Gorge: sinuous entrenched Colorado inner gorge + 5 cliff-bench strata tiers + side amphitheaters
    float riverCenter = 0.24 * sin(p.y * 2.65 + seedPh) + 0.09 * sin(p.y * 5.4 - seedPh * 0.7) + warp.x * 0.22;
    float dRiver = abs(p.x - riverCenter);
    // Dendritic side-canyon tributatries & scalloped Redwall amphitheaters
    float sideSlot1 = abs(p.y - 0.22 * sign(p.x - riverCenter) * dRiver - 0.28 * sin(p.x * 4.2 + seedPh));
    float sideSlot2 = abs(p.y + 0.35 + 0.24 * sign(p.x - riverCenter) * dRiver + 0.22 * cos(p.x * 4.8 - seedPh));
    float sideCarve = (exp(-sq(sideSlot1 * 8.5)) + exp(-sq(sideSlot2 * 9.0))) * smoothstep(0.05, 0.55, dRiver);

    float gorgeWidth = 0.44 + 0.14 * fbm2D(wp * 2.6 + seedVec, 4, 0.55) + 0.26 * sideCarve;
    float wallT = clamp(dRiver / gorgeWidth, 0.0, 1.0);
    // Inner Vishnu Schist V-gorge + Tonto platform + stepped Redwall/Supai/Coconino/Kaibab staircase
    float innerV = smoothstep(0.025, 0.16, wallT) * 0.22;
    float upperT = clamp((wallT - 0.16) / 0.84, 0.0, 1.0);
    float steps = 4.0;
    float stPhase = upperT * steps;
    float stFloor = floor(stPhase);
    float stFrac = stPhase - stFloor;
    // Cliff-bench profile: steep vertical cliff (0..0.34) + gently sloping shale bench (0.34..1.0)
    float tierClimb = (stFloor + mix(smoothstep(0.0, 0.32, stFrac) * 0.74, 0.74 + (stFrac - 0.32) * 0.38, step(0.32, stFrac))) / steps;

    // Isolated flat-topped Shiva/Zoroaster temple buttes inside canyon amphitheaters
    float templeMask = smoothstep(0.66, 0.88, ridgedFbm2D(wp * 3.4 + seedVec * 1.3, 4, 0.55))
                     * smoothstep(0.18, 0.36, wallT) * (1.0 - smoothstep(0.52, 0.78, wallT));
    float rimDetail = fbm2D(wp * 3.8 + seedVec, 5, rough) * 0.09;
    float riverGrad = 0.035 + 0.025 * (0.5 - 0.5 * p.y);
    baseElev = riverGrad + innerV + tierClimb * 0.68 + templeMask * 0.18 + rimDetail * smoothstep(0.10, 0.45, wallT);
    if (dRiver < 0.032) {
      initWater = (1.0 - smoothstep(0.012, 0.032, dRiver)) * 2.35;
    }
  } else if (kind == 9) {
    // 9. Studlagil Columnar Basalt Canyon (Iceland): hexagonal colonnade gorge + glacial river
    float gorgeX = 0.22 * sin(p.y * 3.1 + seedPh) + 0.07 * cos(p.y * 6.3 - seedPh) + warp.x * 0.16;
    float dG = abs(p.x - gorgeX);
    // Stepped flood-basalt lava flow benches + vertical columnar inner walls
    float innerWall = smoothstep(0.038, 0.145, dG);
    float lavaSteps = floor(clamp((dG - 0.12) * 5.8 + fbm2D(wp * 2.2 + seedVec, 4, 0.5) * 0.9, 0.0, 4.0)) / 4.0;
    float lavaSmooth = smoothstep(0.12, 0.72, dG + 0.10 * fbm2D(wp * 2.8 + seedVec, 4, 0.5));
    float colonnadeRibs = sin(p.y * 38.0 + warp.y * 12.0) * 0.012 * (1.0 - smoothstep(0.05, 0.22, dG));
    float highlandCap = fbm2D(wp * 3.1 + seedVec, 5, rough) * 0.16 * smoothstep(0.20, 0.65, dG);
    float riverSlope = 0.05 + 0.035 * (0.5 - 0.5 * p.y);
    baseElev = riverSlope + innerWall * 0.34 + mix(lavaSteps, lavaSmooth, 0.42) * 0.38 + highlandCap + colonnadeRibs;
    if (dG < 0.042) {
      initWater = (1.0 - smoothstep(0.018, 0.042, dG)) * 2.60;
    }
  } else if (kind == 10) {
    // 10. Fjadrargljufur Serpentine Palagonite Canyon: tight winding meanders & overhanging spurs
    float serpX = 0.31 * sin(p.y * 3.85 + seedPh) + 0.08 * sin(p.y * 7.7 - seedPh * 0.5);
    float dS = abs(p.x - serpX + warp.x * 0.18);
    // Interlocking promontory spurs & hanging tributary gullies
    float trib = exp(-sq(sin(p.y * 5.6 + p.x * 2.2 + seedPh) * 3.8)) * smoothstep(0.05, 0.42, dS);
    float canyonCut = smoothstep(0.032, 0.20 + 0.14 * trib, dS);
    float palagoniteKnolls = ridgedFbm2D(wp * 2.9 + seedVec, 6, rough) * 0.30 + fbm2D(wp * 4.5 + seedVec, 4, 0.55) * 0.12;
    float floorSlope = 0.045 + 0.035 * (0.5 - 0.5 * p.y);
    baseElev = floorSlope + canyonCut * (0.42 + palagoniteKnolls * (1.0 - 0.45 * trib));
    if (dS < 0.036) {
      initWater = (1.0 - smoothstep(0.014, 0.036, dS)) * 1.95;
    }
  } else if (kind == 11) {
    // 11. Namib Sand Sea (Sossusvlei / Deadvlei): silky laminar windward stoss slopes + planar 34-deg
    // slipfaces + weathered desert quartzite inselbergs sculpted by active aeolian wind abrasion!
    float wAng = 28.0 * 0.01745329;
    vec2 wDir = vec2(cos(wAng), sin(wAng));
    vec2 cDir = vec2(-wDir.y, wDir.x);
    float u = dot(p, wDir);
    float v = dot(p, cDir);

    // Flat Deadvlei clay pan hollows (~4.5m) + two low wind-sculpted desert quartzite inselbergs
    // protruding into the interdune wind corridors so wind sandblasting & lee sand-tails are visible!
    float panSubtle = fbm2D(p * 1.8 + seedVec, 3, 0.45);
    float insel1 = max(0.0, 1.0 - smoothstep(0.03, 0.20, length((p - vec2(-0.34, 0.30)) * vec2(0.85, 1.55) + warp * 0.14)));
    float insel2 = max(0.0, 1.0 - smoothstep(0.03, 0.17, length((p - vec2(0.32, -0.32)) * vec2(0.95, 1.65) + warp * 0.12)));
    float inselRock = (insel1 * 0.28 + insel2 * 0.22) * (0.68 + 0.32 * ridgedFbm2D(wp * 4.5 + seedVec, 4, rough)) * relief;
    float bedrockFloorM = 4.5 + 3.8 * panSubtle + inselRock;

    // 3 sweeping S-curving transverse/barchanoid mega-dunes + 2 branching star-dune arms
    float d1 = evalAsymmetricDuneM(u, v, -0.56, 0.46, 0.52, seedPh + 0.4,  relief, uWorldSpan);
    float d2 = evalAsymmetricDuneM(u, v, -0.02, 0.68, 0.72, seedPh + 2.15, relief, uWorldSpan);
    float d3 = evalAsymmetricDuneM(u, v,  0.54, 0.54, 0.58, seedPh + 4.10, relief, uWorldSpan);

    vec2 uvRot = vec2(u, v);
    float arm1 = evalStarArmDuneM(uvRot, vec2(-0.04, -0.18), 0.72, 0.75, 0.44, relief, uWorldSpan);
    float arm2 = evalStarArmDuneM(uvRot, vec2(-0.54,  0.22), 0.58, 0.62, 0.34, relief, uWorldSpan);

    float sandDepthM = max(max(d1, d2), max(d3, max(arm1, arm2))) * (1.0 - clamp((insel1 + insel2) * 0.75, 0.0, 0.85));
    outTerrain = vec4(bedrockFloorM, 0.0, sandDepthM, 0.0);
    return;
  } else if (kind == 12) {
    // 12. Aeolian Yardang Wind Corridor: streamlined sandstone yardang prows + golden sand tails
    float wAng = 32.0 * 0.01745329;
    vec2 wDir = vec2(cos(wAng), sin(wAng));
    vec2 cDir = vec2(-wDir.y, wDir.x);
    float along = dot(p, wDir);
    float across = dot(p, cDir) + 0.06 * sin(along * 3.4 + seedPh);

    // Parallel wind-corridor yardang lanes
    float lanePhase = across * 3.6 + 0.35 * (fbm2D(p * 2.4 + seedVec, 3, 0.5) - 0.5);
    float laneDist = abs(fract(lanePhase) - 0.5) * 2.0; // 0 at yardang spine, 1 in deflation trough
    float laneId = floor(lanePhase + 4.0);
    float alongShift = fract(along * 0.85 + hash12(vec2(laneId, seed * 0.01)) + 0.25) - 0.5;
    // Teardrop yardang profile: steep blunt upwind prow (alongShift < 0), long tapered leeward tail (alongShift > 0)
    float prowEnv = smoothstep(-0.38, -0.14, alongShift) * (1.0 - smoothstep(-0.08, 0.44, alongShift));
    float yardangRidge = (1.0 - smoothstep(0.08, 0.56, laneDist)) * prowEnv;
    // Stratified horizontal caprock steps on yardangs
    float yardangSteps = yardangRidge * (0.72 + 0.28 * sin(yardangRidge * 18.0));
    float rockRough = ridgedFbm2D(wp * 4.2 + seedVec, 4, rough) * 0.08 * yardangRidge;
    baseElev = 0.045 + yardangSteps * 0.58 + rockRough + 0.03 * fbm2D(p * 3.0 + seedVec, 3, 0.5);

    // Crisp golden aeolian sand tails & barchan drifts in the deflation corridors!
    float leeDrift = smoothstep(-0.05, 0.28, alongShift) * (1.0 - smoothstep(0.28, 0.48, alongShift))
                   * (1.0 - smoothstep(0.18, 0.65, laneDist));
    float corridorDune = evalAsymmetricDuneM(along, across, 0.22, 0.16, 0.34, seedPh + 1.3, relief, uWorldSpan)
                       * smoothstep(0.42, 0.82, laneDist);
    initFine = leeDrift * 0.11 * relief + corridorDune;
  } else if (kind == 13) {
    // 13. Glacial Tarn & River Basin: high cirque icefield -> Upper Tarn -> Sill Gorge -> Lower Lake & River
    // High glaciated horseshoe cirque headwall in upper domain (p.y < -0.15)
    float cirqueArc = length(vec2(p.x * 1.15, p.y + 0.32));
    float headwall = smoothstep(0.26, 0.68, cirqueArc) * smoothstep(0.12, -0.58, p.y);
    float peaks = ridgedFbm2D(wp * 2.7 + seedVec, 7, rough);

    // Upper Glacial Tarn basin centered at (0.0, -0.24) behind rock moraine sill at y = -0.02
    float dUpperLake = length(vec2(p.x * 1.25, (p.y + 0.24) * 1.55)) + 0.06 * (fbm2D(p * 4.0 + seedVec, 3, 0.5) - 0.5);
    float upperBowl = 1.0 - smoothstep(0.10, 0.34, dUpperLake);

    // Lower Valley Lake basin centered at (-0.06, 0.38)
    float dLowerLake = length(vec2((p.x + 0.06) * 1.10, (p.y - 0.38) * 1.45)) + 0.07 * (fbm2D(p * 3.6 + seedVec + 7.1, 3, 0.5) - 0.5);
    float lowerBowl = 1.0 - smoothstep(0.12, 0.38, dLowerLake);

    // Connecting meandering spillway river channel from y = -0.24 -> +1.0
    float riverX = -0.06 * smoothstep(-0.15, 0.35, p.y) + 0.14 * sin(p.y * 4.6 + seedPh);
    float dChannel = abs(p.x - riverX);
    float spillway = (1.0 - smoothstep(0.022, 0.095, dChannel)) * smoothstep(-0.28, -0.02, p.y);

    float valleyRamp = mix(0.34, 0.11, smoothstep(-0.35, 0.85, p.y));
    float flankWalls = smoothstep(0.24, 0.88, abs(p.x - riverX * 0.5)) * (0.28 + 0.42 * peaks);
    baseElev = valleyRamp + headwall * (0.38 + 0.44 * peaks) + flankWalls;
    baseElev -= upperBowl * 0.145;
    baseElev -= lowerBowl * 0.085;
    baseElev -= spillway * 0.075;
    baseElev = max(0.035, baseElev);

    // Hydrostatic 2.5D lake fill up to natural rock sill levels!
    float bedM = max(2.0, baseElev * relief);
    float upperSillM = 0.295 * relief;
    float lowerSillM = 0.148 * relief;
    if (dUpperLake < 0.33 && bedM < upperSillM) {
      initWater = max(initWater, upperSillM - bedM);
    }
    if (dLowerLake < 0.37 && bedM < lowerSillM) {
      initWater = max(initWater, lowerSillM - bedM);
    }
    if (dChannel < 0.035 && p.y > -0.10) {
      initWater = max(initWater, (1.0 - smoothstep(0.015, 0.035, dChannel)) * 1.65);
    }
  } else if (kind == 14) {
    // 14. Sahara Grand Erg (Erg Chebbi / Grand Erg Oriental):
    // Pure, monumental Saharan multi-armed pyramidal Star Dunes (ghourds) + long sweeping linear
    // seif sword-dunes rising cleanly from dark wind-deflated desert reg corridors (ZERO terraced blobs!).
    float wAng = 34.0 * 0.01745329;
    vec2 wDir = vec2(cos(wAng), sin(wAng));
    vec2 cDir = vec2(-wDir.y, wDir.x);
    float u = dot(p, wDir);
    float v = dot(p, cDir);
    vec2 uvRot = vec2(u, v);

    float regSubtle = fbm2D(p * 1.7 + seedVec, 3, 0.45);
    float bedrockM = 4.2 + 3.4 * regSubtle;

    // Hero 4-armed Saharan Star Dune (ghourd) + secondary 3-armed Star Dune
    vec2 starA = vec2(-0.14, 0.10);
    float sa1 = evalStarArmDuneM(uvRot, starA,  0.32, 0.88, 0.68, relief, uWorldSpan);
    float sa2 = evalStarArmDuneM(uvRot, starA,  1.95, 0.78, 0.60, relief, uWorldSpan);
    float sa3 = evalStarArmDuneM(uvRot, starA, -1.35, 0.82, 0.58, relief, uWorldSpan);
    float sa4 = evalStarArmDuneM(uvRot, starA, -2.75, 0.66, 0.48, relief, uWorldSpan);
    float starDuneA = max(max(sa1, sa2), max(sa3, sa4));

    vec2 starB = vec2(0.42, -0.26);
    float sb1 = evalStarArmDuneM(uvRot, starB,  0.55, 0.74, 0.54, relief, uWorldSpan);
    float sb2 = evalStarArmDuneM(uvRot, starB,  2.35, 0.70, 0.48, relief, uWorldSpan);
    float sb3 = evalStarArmDuneM(uvRot, starB, -1.55, 0.68, 0.46, relief, uWorldSpan);
    float starDuneB = max(max(sb1, sb2), sb3);

    // Sweeping linear seif & barchanoid dune chains linking the star dunes
    float seif1 = evalAsymmetricDuneM(u, v, -0.52, 0.42, 0.46, seedPh + 0.8, relief, uWorldSpan);
    float seif2 = evalAsymmetricDuneM(u, v,  0.36, 0.48, 0.52, seedPh + 2.7, relief, uWorldSpan);

    float sandM = max(max(starDuneA, starDuneB), max(seif1, seif2));
    outTerrain = vec4(bedrockM, 0.0, sandM, 0.0);
    return;
  } else if (kind == 15) {
    // 15. Wadi Rum Rugged Desert & Crags (2nd Desert Type with Rugged Outcrops & Sand Dunes):
    // Steep, deeply joint-fissured desert sandstone/granite crag massifs (jebels) rising abruptly
    // from wide wind-swept terracotta sand corridors & climbing leeward sand dunes!
    float wAng = 26.0 * 0.01745329;
    vec2 wDir = vec2(cos(wAng), sin(wAng));
    vec2 cDir = vec2(-wDir.y, wDir.x);
    float u = dot(p, wDir);
    float v = dot(p, cDir);

    // 3 asymmetric rugged jebel massifs separated by wide open desert sand corridors
    vec2 qw = p + warp * 0.34;
    float dJ1 = length((qw - vec2(-0.46,  0.34)) * vec2(1.05, 1.45));
    float dJ2 = length((qw - vec2( 0.44,  0.22)) * vec2(1.25, 0.95));
    float dJ3 = length((qw - vec2(-0.12, -0.52)) * vec2(0.92, 1.55));
    float jebelEnv = max(
      smoothstep(0.46, 0.14, dJ1) * 0.96,
      max(smoothstep(0.44, 0.13, dJ2) * 0.84, smoothstep(0.42, 0.12, dJ3) * 0.76)
    );

    // Conjugate vertical joint slot canyons (siqs) & craggy weathered pinnacles cutting the jebels
    float jointSlots = ridgedFbm2D(wp * 4.4 + seedVec, 5, 0.56);
    float cragSpires = ridgedFbm2D(wp * 2.6 + seedVec + 19.3, 6, rough);
    float fissuredJebel = jebelEnv * (0.48 + 0.44 * cragSpires) * mix(0.42, 1.08, smoothstep(0.28, 0.72, jointSlots));

    float desertPlain = 0.042 + 0.024 * fbm2D(p * 2.2 + seedVec, 3, 0.48);
    baseElev = desertPlain + fissuredJebel * 0.78;
    // Scree talus skirts hugging the base of the rugged desert cliffs
    float cliffApron = smoothstep(0.04, 0.24, jebelEnv) * (1.0 - smoothstep(0.24, 0.56, jebelEnv));
    initCoarse = cliffApron * 0.026 * relief;

    // Sweeping desert dunes in the open corridor + wind-blown sand ramps banking against leeward cliffs!
    float openSandMask = 1.0 - smoothstep(0.08, 0.36, jebelEnv);
    float wd1 = evalAsymmetricDuneM(u, v, -0.18, 0.32, 0.44, seedPh + 1.1, relief, uWorldSpan);
    float wd2 = evalAsymmetricDuneM(u, v,  0.38, 0.38, 0.48, seedPh + 3.4, relief, uWorldSpan);
    float sandSheet = (1.2 + 2.4 * fbm2D(p * 1.9 + seedVec + 5.1, 3, 0.45)) * openSandMask;
    initFine = max(wd1, wd2) * openSandMask + sandSheet;
  } else if (kind == 16) {
    // 16. Moon Mare & Impact Craters (Apollo 15 Hadley-Apennine / Tycho Lunar Terrain):
    // Ancient anorthosite lunar highlands + flat basaltic Mare plain + multi-scale impact craters
    // (raised ejecta rims, complex central rebound peak) + meandering sinuous Hadley Rille!
    vec2 qm = p + warp * 0.22;
    // Montes Apenninus lunar highland massif rising in the NE quadrant
    float highlandMask = smoothstep(-0.10, 0.62, qm.x * 0.62 + qm.y * 0.78);
    float highlandMassif = highlandMask * (0.34 + 0.48 * ridgedFbm2D(wp * 2.1 + seedVec, 6, rough));
    float marePlain = 0.16 + 0.028 * fbm2D(p * 2.4 + seedVec, 4, 0.48);

    // Multi-scale analytical impact craters (1 complex crater with central peak + 6 crisp bowl craters)
    float craters = 0.0;
    craters += evalLunarCraterElev(p, vec2(-0.24, -0.14), 0.31, 0.145, true);
    craters += evalLunarCraterElev(p, vec2( 0.34, -0.34), 0.18, 0.095, false);
    craters += evalLunarCraterElev(p, vec2(-0.56,  0.38), 0.16, 0.085, false);
    craters += evalLunarCraterElev(p, vec2( 0.06,  0.44), 0.13, 0.072, false);
    craters += evalLunarCraterElev(p, vec2(-0.04, -0.58), 0.11, 0.062, false);
    craters += evalLunarCraterElev(p, vec2( 0.56,  0.10), 0.12, 0.068, false);
    craters += evalLunarCraterElev(p, vec2(-0.34,  0.08), 0.075, 0.044, false);

    // Secondary micro-crater regolith gardening across mare & highlands
    vec2 mc = p * 5.5 + seedVec;
    vec2 mcCell = floor(mc);
    vec2 mcFrac = fract(mc) - 0.5;
    vec3 mcRnd = hash32(mcCell);
    float microD = length(mcFrac - (mcRnd.xy - 0.5) * 0.45) / (0.18 + 0.16 * mcRnd.z);
    float microCrater = mcRnd.z > 0.42
      ? (microD < 1.0 ? -0.016 * (1.0 - microD * microD) : 0.004 * exp(-(microD - 1.0) * 3.5))
      : 0.0;

    // Sinuous volcanic Hadley Rille collapse canyon winding across the lunar mare!
    float rilleCenter = -0.32 + 0.18 * sin(p.y * 3.4 + seedPh) + 0.06 * cos(p.y * 7.1);
    float dRille = abs(p.x - rilleCenter);
    float rilleCut = (1.0 - smoothstep(0.014, 0.048, dRille)) * (1.0 - highlandMask) * 0.085;

    baseElev = clamp(marePlain + highlandMassif + craters + microCrater - rilleCut, 0.025, 1.15);
    initCoarse = (0.008 + 0.014 * highlandMask) * relief;
    initFine = 0.012 * (1.0 - highlandMask) * relief;
  } else if (kind == 17) {
    // 17. Icelandic Green Highlands & Basalt Cliffs (Thorsmork / Skaftafell):
    // Steep emerald-moss-draped volcanic ridges, sheer dark basalt cliff amphitheaters, incised
    // hanging waterfall gorges, and a lush green highland valley with braided meltwater streams!
    vec2 qi = p + warp * 0.36;
    float valleyX = 0.18 * sin(p.y * 2.4 + seedPh) + warp.x * 0.18;
    float dVal = abs(p.x - valleyX);

    // Broad lush highland valley floor + sheer glaciated volcanic valley walls & knife-edge spurs
    float sideGorge1 = exp(-sq((p.y - 0.18 - 0.35 * dVal) * 7.5)) * smoothstep(0.06, 0.55, dVal);
    float sideGorge2 = exp(-sq((p.y + 0.34 + 0.30 * dVal) * 8.0)) * smoothstep(0.06, 0.55, dVal);
    float wallRise = smoothstep(0.09, 0.38 + 0.18 * (sideGorge1 + sideGorge2), dVal);

    float knifeRidges = ridgedFbm2D(qi * 2.75 + seedVec, 6, rough);
    float basaltBenches = floor(clamp(wallRise * 3.6 + fbm2D(qi * 3.2 + seedVec, 3, 0.5) * 0.55, 0.0, 3.0)) / 3.0;
    float mountainWall = wallRise * (0.42 + 0.54 * knifeRidges) * 0.78 + basaltBenches * wallRise * 0.16;

    float valleyGrad = 0.048 + 0.032 * (0.5 + 0.5 * p.y) + 0.016 * fbm2D(p * 4.5 + seedVec, 3, 0.5);
    baseElev = valleyGrad + mountainWall;

    // Braided glacial-meltwater river threads weaving down the lush green Thorsmork valley floor!
    float braid1 = abs(p.x - valleyX - 0.032 * sin(p.y * 9.5 + seedPh));
    float braid2 = abs(p.x - valleyX + 0.028 * cos(p.y * 11.2 - seedPh));
    float inRiver = 1.0 - smoothstep(0.008, 0.026, min(braid1, braid2));
    if (dVal < 0.09 && inRiver > 0.05) {
      initWater = inRiver * 1.45;
    }
  } else if (kind == 18) {
    // 18. Desert Dunes & Lush Artesian Oasis (Ubari / Huacachina Sahara Oasis):
    // Sweeping golden-apricot 34-deg slipface Saharan sand dunes encircling a wind-deflated
    // artesian oasis depression with a crystal-emerald 2.5D hydrostatic lake & rocky rim!
    float wAng = 30.0 * 0.01745329;
    vec2 wDir = vec2(cos(wAng), sin(wAng));
    vec2 cDir = vec2(-wDir.y, wDir.x);
    float u = dot(p, wDir);
    float v = dot(p, cDir);

    // Crescent-shaped central oasis basin + weathered sandstone rocky rim on the NW flank
    vec2 oasisP = p - vec2(-0.04, -0.03);
    float crescentBend = oasisP.y + 0.22 * sq(oasisP.x * 1.8);
    float dOasis = length(vec2(oasisP.x * 1.15, crescentBend * 1.55)) + 0.045 * (fbm2D(p * 4.2 + seedVec, 3, 0.5) - 0.5);

    float basinDip = 1.0 - smoothstep(0.06, 0.34, dOasis);
    float nwRockyRim = smoothstep(0.28, 0.58, dOasis) * smoothstep(0.05, 0.55, -p.x * 0.6 + p.y * 0.8)
                     * (0.14 + 0.18 * ridgedFbm2D(wp * 3.4 + seedVec, 5, rough));
    float bedrockM = mix(11.5 + 3.2 * fbm2D(p * 2.0 + seedVec, 3, 0.45), 4.2, basinDip) + nwRockyRim * relief;

    // 4 sweeping golden Saharan dunes curving around (never burying!) the central oasis lagoon
    float duneMask = smoothstep(0.27, 0.46, dOasis);
    float od1 = evalAsymmetricDuneM(u, v, -0.54, 0.52, 0.50, seedPh + 0.5, relief, uWorldSpan);
    float od2 = evalAsymmetricDuneM(u, v,  0.04, 0.58, 0.54, seedPh + 2.2, relief, uWorldSpan);
    float od3 = evalAsymmetricDuneM(u, v,  0.56, 0.48, 0.50, seedPh + 4.0, relief, uWorldSpan);
    float odArm = evalStarArmDuneM(vec2(u, v), vec2(0.02, -0.44), 0.65, 0.78, 0.44, relief, uWorldSpan);
    float sandM = max(max(od1, od2), max(od3, odArm)) * duneMask;

    // Fill the oasis depression up to hydrostatic water surface elevation 9.8m!
    float groundM = bedrockM + sandM;
    float oasisWater = dOasis < 0.32 ? max(0.0, 9.8 - groundM) : 0.0;
    outTerrain = vec4(bedrockM, 0.0, sandM, oasisWater);
    return;
  } else {
    // 0. Tectonic Mountain Divide
    float spineDist = abs(wp.y * 0.85 + wp.x * 0.28 + 0.15 * sin(wp.x * 3.4));
    float rangeEnv = exp(-spineDist * spineDist * 2.8) * (1.0 - smoothstep(0.68, 1.02, abs(p.x)));
    float spurs = ridgedFbm2D(wp * 2.5 + seedVec, 7, rough);
    float foothills = fbm2D(wp * 3.6 + seedVec, 5, 0.55) * 0.22;
    baseElev = 0.07 + rangeEnv * (0.42 + 0.68 * spurs) + foothills * (1.0 - 0.5 * smoothstep(0.6, 1.0, r));
  }

  float bedrockH = max(2.0, baseElev * relief);
  outTerrain = vec4(bedrockH, initCoarse, initFine, initWater);
}
`;

export const INIT_SNOW_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outSnow;

uniform sampler2D uTerrainTex;
uniform vec4 uCryoParams;   // (gridRes, cellSize, dt, worldSpan)
uniform vec4 uClimate;      // (snowlineNorm, snowfallRate, glacierStrength, meltRate)
uniform vec4 uStrataOrient; // (sinStrike, cosStrike, tanDip, reliefScale)
uniform float uSeed;

${COMMON_GEOLOGY_GLSL}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uCryoParams.x) - 1;
  float cellSize = uCryoParams.y;
  float snowfallRate = uClimate.y;
  if (snowfallRate < 0.03) {
    outSnow = vec4(0.0);
    return;
  }

  vec4 tC = texelFetch(uTerrainTex, c, 0);
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
  float slope = length(grad);
  // Positive concavity in cirque bowls, couloirs, and U-shaped glacier troughs!
  float concavity = (hR + hL + hU + hD) * 0.25 - hC;

  float reliefScale = max(1.0, uStrataOrient.w);
  float elevN = hC / reliefScale;
  float snowline = clamp(uClimate.x, 0.02, 1.05);

  vec2 worldXZ = (vUv - 0.5) * uCryoParams.w;
  float driftNoise = fbm2D(worldXZ * 0.024 + uSeed * 0.017, 4, 0.52);

  // Full-domain mountain snowpack: covers ridges, shoulders, cirques & wind-drifted benches across
  // the ENTIRE terrain above snowline (and snow-drifted hollows slightly below snowline!), while
  // sheer 55-deg+ rock cliffs shed snow into couloir chutes & cliff-base snow aprons!
  float altFactor = smoothstep(snowline - 0.16 * snowfallRate, snowline + 0.14, elevN + (driftNoise - 0.5) * 0.09);
  float slopeHold = 1.0 - smoothstep(1.05, 1.95, slope);
  float couloirPool = clamp(concavity * 0.95, 0.0, 1.25);

  float initSnow = snowfallRate * (altFactor * slopeHold * (0.85 + 0.95 * driftNoise) + couloirPool * altFactor * 0.85);
  // Valley & cirque glaciers extend below the snowline down concave U-shaped troughs!
  float valleyGlacierZone = smoothstep(snowline - 0.28 * uClimate.z, snowline + 0.18, elevN)
                          * (1.0 - smoothstep(0.28, 0.82, slope))
                          * smoothstep(-0.04, 0.14, concavity + 0.06 * driftNoise);
  float initIce = uClimate.z * valleyGlacierZone * (1.2 + 2.6 * smoothstep(snowline - 0.05, snowline + 0.32, elevN));

  outSnow = vec4(clamp(initSnow, 0.0, 5.5), clamp(initIce, 0.0, 14.0), 0.0, 0.0);
}
`;

export const INIT_PARTICLES_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outPosAge;
layout(location = 1) out vec4 outVelWater;
layout(location = 2) out vec4 outSediment;

uniform vec4 uSpawnBox; // (worldSpan, cloudHeight, seed, emitterMode)

${COMMON_GEOLOGY_GLSL}

void main() {
  vec2 idSeed = gl_FragCoord.xy + vec2(uSpawnBox.z * 0.173, uSpawnBox.z * 0.319);
  vec3 rnd = hash32(idSeed);
  float halfSpan = uSpawnBox.x * 0.488;

  vec2 xz = (rnd.xy * 2.0 - 1.0) * halfSpan;
  float dropY = mix(18.0, uSpawnBox.y * 1.25, hash12(idSeed + 19.7));

  // Match initial particle species to emitterMode so blizzards snow across the ENTIRE sky from frame 0
  // and dry aeolian deserts start with pure saltating wind sand!
  int mode = int(uSpawnBox.w + 0.5);
  float speciesPick = floor(clamp(rnd.z * 4.0, 0.0, 3.0));
  if (mode == 1) speciesPick = rnd.z < 0.84 ? 1.0 : (rnd.z < 0.94 ? 2.0 : 0.0);
  else if (mode == 2 || mode == 5) speciesPick = 0.0;
  else if (mode == 3) speciesPick = 2.0;
  else if (mode == 4) speciesPick = 3.0;

  outPosAge = vec4(xz.x, dropY, xz.y, -0.02 - 0.95 * rnd.z);
  outVelWater = vec4(0.0, speciesPick == 1.0 ? (-3.2 - 1.5 * rnd.z) : (-7.5 - 2.5 * rnd.z), 0.0, 0.55);
  outSediment = vec4(0.0, 0.0, 0.0, speciesPick);
}
`;

export const PARTICLE_STEP_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;

layout(location = 0) out vec4 outPosAge;
layout(location = 1) out vec4 outVelWater;
layout(location = 2) out vec4 outSediment;
layout(location = 3) out vec4 outExchange;
layout(location = 4) out vec4 outExchange2;

uniform sampler2D uTerrainTex;
uniform sampler2D uPosAgeTex;
uniform sampler2D uVelWaterTex;
uniform sampler2D uSedimentTex;
uniform sampler2D uVelocityFieldTex;
uniform sampler2D uSnowTex;

uniform vec4 uDomain;         // (worldSpan, gridRes, dt, stepIndex)
uniform vec4 uRainEmitter;    // (cloudHeight, rainIntensity, emitterMode, activeCount)
uniform vec4 uStormTarget;    // (targetX, targetZ, stormRadius, windDriftX)
uniform vec4 uHydraulics;     // (erosionStrength, sedimentCapacity, depositionRate, inertia)
uniform vec4 uLifeEvap;       // (evaporation, gravity, maxRunoffAge, pipeFlowBlend)
uniform vec4 uHardnessParams; // (rockHardness, strataStrength, strataFreq, faultWeakness)
uniform vec4 uStrataOrient;   // (sinStrike, cosStrike, tanDip, reliefScale)
uniform vec4 uSpeciesMix;     // (rainFrac, snowFrac, windFrac, rockfallFrac)
uniform vec4 uSnowParams;     // (snowlineNorm, snowfallRate, glacierStrength, meltRate)
uniform vec4 uWindParams;     // (windX, windZ, saltationPower, duneRate)
uniform float uDryAeolian;
uniform float uSeed;

${COMMON_GEOLOGY_GLSL}

// Particle species codes:
// 0 = raindrop (hydraulic runoff)   1 = snowflake (snowpack / glacier feed)
// 2 = aeolian sand grain (saltation) 3 = rockfall boulder fragment
const int SP_RAIN = 0;
const int SP_SNOW = 1;
const int SP_WIND = 2;
const int SP_ROCK = 3;

vec2 worldToUv(vec2 xz, float span) {
  return xz / span + 0.5;
}

void spawnNewDrop(
  ivec2 coord,
  float stepIdx,
  out vec4 posAge,
  out vec4 velWater,
  out vec4 sed
) {
  vec2 rSeed = vec2(coord) * 1.37 + vec2(stepIdx * 0.713, stepIdx * 1.193 + uSeed * 0.031);
  vec3 r1 = hash32(rSeed);
  vec3 r2 = hash32(rSeed + vec2(41.3, 89.7));

  float span = uDomain.x;
  float res = uDomain.y;
  float halfSpan = span * 0.482;
  int mode = int(uRainEmitter.z + 0.5);

  // ---- Species lottery: weighted multi-agent population (rain / snow / wind / rockfall) ----
  float wR = max(0.0, uSpeciesMix.x);
  float wS = max(0.0, uSpeciesMix.y);
  float wW = max(0.0, uSpeciesMix.z);
  float totalW = max(1e-4, wR + wS + wW + max(0.0, uSpeciesMix.w));
  float pick = r1.z * totalW;
  int species = SP_RAIN;
  if (pick > wR + wS + wW) species = SP_ROCK;
  else if (pick > wR + wS) species = SP_WIND;
  else if (pick > wR) species = SP_SNOW;

  // Emission footprints:
  // - mode == 5 ('storm-cell') concentrates inside the steerable overhead storm disc.
  // - mode == 4 ('rockfall-avalanche') biases toward high steep cliffs across the domain.
  // - mode == 0, 1, 2 ('all-weather', 'glacial-blizzard', 'sky-rain') cover the ENTIRE terrain!
  vec2 xz;
  float baseCloudY = uRainEmitter.x;

  if (mode == 5) {
    float ang = r1.x * 6.2831853;
    float rad = sqrt(max(0.0, r1.y)) * uStormTarget.z * 1.45;
    xz = clamp(uStormTarget.xy + vec2(cos(ang), sin(ang)) * rad, vec2(-halfSpan), vec2(halfSpan));
  } else if (mode == 4 || species == SP_ROCK) {
    vec2 bestXZ = (r1.xy * 2.0 - 1.0) * halfSpan * 0.94;
    float bestH = sampleGridBilinear(uTerrainTex, worldToUv(bestXZ, span), res).r;
    for (int k = 0; k < 2; k++) {
      vec3 rk = hash32(rSeed + float(k + 1) * 27.9);
      vec2 cand = (rk.xy * 2.0 - 1.0) * halfSpan * 0.94;
      float ch = sampleGridBilinear(uTerrainTex, worldToUv(cand, span), res).r;
      if (ch > bestH) { bestH = ch; bestXZ = cand; }
    }
    xz = bestXZ;
  } else {
    // Full-sky uniform coverage across [-halfSpan, +halfSpan]^2!
    xz = (r1.xy * 2.0 - 1.0) * halfSpan;
    // Compensate for lateral wind drift while snowflakes descend from cloudHeight so upwind
    // mountain slopes receive the exact same snowfall density as downwind slopes!
    if (species == SP_SNOW) {
      vec2 wDir = safeNorm2(uWindParams.xy, vec2(1.0, 0.0));
      if (r2.z < 0.22) {
        xz = -wDir * halfSpan * (0.78 + 0.21 * r2.x) + vec2(-wDir.y, wDir.x) * (r1.x * 2.0 - 1.0) * halfSpan;
      }
      xz = clamp(xz, vec2(-halfSpan), vec2(halfSpan));
    }
  }

  if (species == SP_WIND) {
    // Saltating sand spawns both along the upwind margin AND across windward sand sheets & outcrops!
    vec2 windDir = safeNorm2(uWindParams.xy, vec2(1.0, 0.0));
    if (r2.z < 0.45) {
      xz = -windDir * halfSpan * 0.98 + vec2(-windDir.y, windDir.x) * (r1.x * 2.0 - 1.0) * halfSpan;
    } else {
      xz = (r1.xy * 2.0 - 1.0) * halfSpan;
    }
    xz = clamp(xz, vec2(-halfSpan), vec2(halfSpan));
  }

  vec4 terrSpawn = sampleGridBilinear(uTerrainTex, worldToUv(xz, span), res);
  float surfSpawn = terrSpawn.r + terrSpawn.g + terrSpawn.b;

  float startY;
  if (species == SP_SNOW || species == SP_RAIN) {
    startY = baseCloudY * (0.82 + 0.42 * r1.z);
  } else if (species == SP_WIND) {
    startY = surfSpawn + 1.2 + 14.0 * r2.z;
  } else {
    startY = surfSpawn + 0.6 + 2.5 * r2.z;
  }

  // Source water / material payload
  float rainPayload = (0.35 + 0.85 * uRainEmitter.y) * ((mode == 1 || mode == 2) ? 1.45 : 1.0);
  float payload = rainPayload;
  if (species == SP_SNOW) payload = 0.06 + 0.09 * uSnowParams.y;
  else if (species == SP_WIND) payload = 0.035 + 0.05 * uWindParams.z;
  else if (species == SP_ROCK) payload = 0.16 + 0.22 * uWindParams.z;

  vec3 initVel = vec3(uStormTarget.w * 1.8, -14.0 - 5.0 * r2.x, (r2.y - 0.5) * 1.2);
  if (species == SP_SNOW) {
    // Snowflakes have huge aerodynamic drag: slow terminal fall + strong lateral wind advection
    initVel = vec3(uWindParams.x * 5.4 + (r2.y - 0.5) * 2.2, -2.4 - 1.6 * r1.z, uWindParams.y * 5.4 + (r2.x - 0.5) * 2.2);
  } else if (species == SP_WIND) {
    initVel = vec3(uWindParams.x * (11.0 + 9.0 * r2.x), -1.2 - 1.6 * r2.y, uWindParams.y * (11.0 + 9.0 * r2.x));
  } else if (species == SP_ROCK) {
    initVel = vec3((r2.x - 0.5) * 3.0, -2.0 - 3.0 * r2.y, (r2.y - 0.5) * 3.0);
  }

  posAge = vec4(xz.x, startY, xz.y, -0.02);
  velWater = vec4(initVel, payload);
  sed = vec4(0.0, 0.0, 0.0, float(species));
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int slotId = coord.y * 256 + coord.x;

  vec4 posAge = texelFetch(uPosAgeTex, coord, 0);
  vec4 velWater = texelFetch(uVelWaterTex, coord, 0);
  vec4 sed = texelFetch(uSedimentTex, coord, 0);
  outExchange = vec4(0.0);
  outExchange2 = vec4(0.0);

  if (float(slotId) >= uRainEmitter.w) {
    outPosAge = posAge;
    outVelWater = velWater;
    outSediment = sed;
    return;
  }

  float span = uDomain.x;
  float res = uDomain.y;
  float dt = uDomain.z;
  float cellSize = span / res;
  float halfSpan = span * 0.492;

  int species = int(sed.w + 0.5);

  bool outOfBounds = abs(posAge.x) > halfSpan || abs(posAge.z) > halfSpan;
  if (outOfBounds || (posAge.w >= 0.0 && (velWater.w < 0.015 || posAge.w > uLifeEvap.z))) {
    if (!outOfBounds && (sed.x + sed.y) > 1e-5) {
      if (species == SP_SNOW) outExchange2 = vec4(sed.x, 0.0, 0.0, 0.0);
      else outExchange = vec4(0.0, sed.x, sed.y, 0.0);
    }
    spawnNewDrop(coord, uDomain.w, outPosAge, outVelWater, outSediment);
    return;
  }

  // PHASE A: Airborne descent (raindrops, snowflakes, wind-blown sand and detaching rockfall chunks)
  if (posAge.w < 0.0) {
    vec3 airVel = velWater.xyz;
    if (species == SP_SNOW) {
      // Blizzard aerodynamics: strong lateral advection + slow terminal velocity + turbulent flutter
      vec2 flutter = (hash32(vec2(coord) + uDomain.w * 0.37).xy * 2.0 - 1.0) * 2.4;
      airVel.x = uWindParams.x * 6.2 + flutter.x;
      airVel.z = uWindParams.y * 6.2 + flutter.y;
      airVel.y = max(airVel.y - uLifeEvap.y * 0.22 * dt, -4.2);
    } else if (species == SP_WIND) {
      airVel.x = uWindParams.x * (13.0 + 8.0 * hash12(vec2(coord) * 1.7));
      airVel.z = uWindParams.y * (13.0 + 8.0 * hash12(vec2(coord) * 2.1 + 7.3));
      airVel.y = max(airVel.y - uLifeEvap.y * 0.55 * dt, -7.0);
    } else if (species == SP_ROCK) {
      airVel.y = max(airVel.y - uLifeEvap.y * 2.4 * dt, -30.0);
    } else {
      airVel.y = max(airVel.y - uLifeEvap.y * 2.2 * dt, -26.0);
    }

    vec3 nextPos = posAge.xyz + airVel * dt;
    vec2 uvNext = worldToUv(nextPos.xz, span);
    vec4 terr = sampleGridBilinear(uTerrainTex, uvNext, res);
    float surfY = terr.r + terr.g + terr.b;

    if (nextPos.y <= surfY) {
      nextPos.y = surfY;
      float hardness = evalRockHardness3D(vec3(nextPos.x, terr.r, nextPos.z), uHardnessParams, uStrataOrient, uSeed);
      float impactSpeed = max(0.4, -airVel.y);

      if (species == SP_SNOW) {
        // Snowfall bonds onto the snowpack rather than detaching rock
        outPosAge = vec4(nextPos, 0.001);
        outVelWater = vec4(airVel.x * 0.10, 0.0, airVel.z * 0.10, velWater.w);
        outSediment = vec4(velWater.w * 0.55, 0.0, 0.0, sed.w);
        outExchange2 = vec4(velWater.w * 0.22, 0.0, 0.0, 0.0);
        return;
      }

      if (species == SP_ROCK) {
        // Boulder impact shatters and throws coarse debris into the talus apron
        float shatter = 0.0016 * impactSpeed * uWindParams.z / (0.35 + 1.6 * hardness);
        outPosAge = vec4(nextPos, 0.001);
        outVelWater = vec4(airVel.x * 0.45, 0.0, airVel.z * 0.45, 0.30);
        outSediment = vec4(sed.x + shatter * 1.6, 0.0, 0.0, sed.w);
        outExchange = vec4(-shatter * 0.5, 0.0, -shatter * 0.5, 0.0);
        return;
      }

      if (species == SP_WIND) {
        // Saltating sand grain rebounds; abrasive impact scours the windward rock face
        float scour = 0.0009 * uWindParams.z * impactSpeed / (0.30 + 1.8 * hardness);
        outPosAge = vec4(nextPos, 0.001);
        outVelWater = vec4(airVel.x * 0.55, 0.0, airVel.z * 0.55, 0.09);
        outSediment = vec4(sed.x + scour * 0.8, 0.0, 0.0, sed.w);
        outExchange = vec4(-scour * 0.25, 0.0, -scour * 0.75, 0.0);
        return;
      }

      // Raindrop splash: cushioned by any standing water film, hardness resists detachment
      float waterCushion = exp(-terr.a * 3.5);
      float splashPower = 0.0035 * uHydraulics.x * velWater.w * waterCushion / (0.20 + 2.8 * hardness * hardness);
      float splashLoose = min(terr.b, splashPower * 1.4);
      float splashBed = min(max(0.0, terr.r - 1.0), max(0.0, splashPower - splashLoose * 0.6));

      outPosAge = vec4(nextPos, 0.001);
      outVelWater = vec4(velWater.x * 0.25, 0.0, velWater.z * 0.25, velWater.w);
      outSediment = vec4(
        sed.x + splashBed * 0.35,
        sed.y + splashLoose + splashBed * 0.65,
        sed.z + splashBed,
        sed.w
      );
      outExchange = vec4(-splashBed, 0.0, -splashLoose, velWater.w * 0.032);
      return;
    }

    outPosAge = vec4(nextPos, posAge.w - dt);
    outVelWater = vec4(airVel, velWater.w);
    outSediment = sed;
    return;
  }

  // PHASE B: Surface interaction (hydraulic runoff, snow creep, sand saltation, boulder rolling)
  vec2 uv = worldToUv(posAge.xz, span);
  float eps = 1.0 / res;

  vec4 tC = sampleGridBilinear(uTerrainTex, uv, res);
  vec4 tR = sampleGridBilinear(uTerrainTex, uv + vec2(eps, 0.0), res);
  vec4 tL = sampleGridBilinear(uTerrainTex, uv - vec2(eps, 0.0), res);
  vec4 tU = sampleGridBilinear(uTerrainTex, uv + vec2(0.0, eps), res);
  vec4 tD = sampleGridBilinear(uTerrainTex, uv - vec2(0.0, eps), res);

  float hC = tC.r + tC.g + tC.b;
  float headR = tR.r + tR.g + tR.b + tR.a * 0.45;
  float headL = tL.r + tL.g + tL.b + tL.a * 0.45;
  float headU = tU.r + tU.g + tU.b + tU.a * 0.45;
  float headD = tD.r + tD.g + tD.b + tD.a * 0.45;

  vec2 grad = vec2(headR - headL, headU - headD) / (2.0 * cellSize);
  float gradMag = length(grad);
  float sinTheta = gradMag * inversesqrt(1.0 + gradMag * gradMag);

  vec2 jitterDir = safeNorm2(hash32(vec2(coord) + uDomain.w * 0.13).xy * 2.0 - 1.0, vec2(1.0, 0.0));
  vec2 downDir = gradMag > 1e-4 ? (-grad / gradMag) : jitterDir;

  vec4 snowCell = sampleGridBilinear(uSnowTex, uv, res);
  float elevFrac = clamp(tC.r / max(uStrataOrient.w, 1.0), 0.0, 1.25);
  // Thermal + wind exposure control how much snow can actually stick at this cell
  float snowStickCapacity = smoothstep(uSnowParams.x - 0.10, uSnowParams.x + 0.12, elevFrac)
                            * (1.0 - smoothstep(0.52, 0.86, sinTheta))
                            * (1.0 - smoothstep(0.55, 1.10, snowCell.g * 0.6));

  vec2 windDir = safeNorm2(uWindParams.xy, vec2(1.0, 0.0));

  // Species-dependent surface steering & locomotion laws
  vec2 steerDir;
  float speed;
  float water = velWater.w;

  if (species == SP_SNOW) {
    bool avalanche = sinTheta > 0.42 && snowCell.r > 0.22;
    vec2 snowSteer = safeNorm2(downDir * (avalanche ? 1.0 : 0.45) + windDir * 0.28 + jitterDir * 0.10, downDir);
    steerDir = snowSteer;
    float creep = avalanche ? (2.4 + 9.0 * (sinTheta - 0.36)) : (0.25 + 1.9 * sinTheta);
    speed = clamp(mix(length(velWater.xz), creep, 0.35), 0.06, 9.0);
  } else if (species == SP_WIND) {
    if (uDryAeolian > 0.35) {
      // Pure aeolian desert saltation: wind drives sand grains UP windward stoss slopes and across corridors!
      steerDir = safeNorm2(windDir * 0.94 + jitterDir * 0.05, windDir);
      speed = clamp(mix(length(velWater.xz), 7.5 + 8.0 * uWindParams.z, 0.28), 1.2, 18.0);
    } else {
      vec2 saltSteer = safeNorm2(windDir * 0.72 + downDir * 0.36 + jitterDir * 0.05, windDir);
      steerDir = saltSteer;
      speed = clamp(mix(length(velWater.xz), 6.0 + 20.0 * sinTheta, 0.22), 0.5, 22.0);
    }
  } else if (species == SP_ROCK) {
    vec2 rollSteer = safeNorm2(downDir * 0.90 + jitterDir * 0.06, downDir);
    steerDir = rollSteer;
    speed = clamp(max(length(velWater.xz) * 0.94, 1.4 + 22.0 * sinTheta), 0.8, 26.0);
  } else {
    vec2 eulerVel = sampleGridBilinear(uVelocityFieldTex, uv, res).xy;
    float inertia = clamp(uHydraulics.w, 0.02, 0.92);
    vec2 oldDir = safeNorm2(velWater.xz, downDir);
    steerDir = safeNorm2(mix(downDir, oldDir, inertia) + eulerVel * (0.12 * uLifeEvap.w) + jitterDir * 0.035, downDir);
    speed = clamp(length(velWater.xz) * 0.88 + uLifeEvap.y * max(sinTheta, 0.018) * dt * 2.8, 0.35, 11.5);
  }

  float stepDist = min(speed * dt, cellSize * 0.95);
  vec2 nextXZ = posAge.xz + steerDir * stepDist;
  vec2 uvNext = worldToUv(nextXZ, span);
  vec4 tNext = sampleGridBilinear(uTerrainTex, uvNext, res);
  float hNext = tNext.r + tNext.g + tNext.b;

  float dh = hNext - hC;
  float hardness = evalRockHardness3D(vec3(posAge.x, tC.r, posAge.z), uHardnessParams, uStrataOrient, uSeed);

  float coarseLoad = sed.x;
  float fineLoad = sed.y;
  float totalLoad = coarseLoad + fineLoad;

  float rawSlope = max(0.0, -dh) / max(stepDist, 0.15 * cellSize);
  float slopePower = rawSlope * sqrt(max(0.02, rawSlope));
  float streamBoost = 0.65 + clamp(sqrt(max(0.0, tC.a)) * 6.5, 0.0, 5.2);

  float dBedrock = 0.0;
  float dCoarse = 0.0;
  float dFine = 0.0;
  float dSnow = 0.0;
  float dIce = 0.0;

  if (species == SP_SNOW) {
    // ---------------- SNOWPACK ACCUMULATION, AVALANCHE & GLACIER ICE FORMATION ----------------
    float deposit = velWater.w * uSnowParams.y * 0.16 * (0.25 + snowStickCapacity);
    if (dh > 0.006) {
      // Snow fences into hollows & lee slopes: preferential drift accumulation
      deposit *= 1.35;
      speed *= 0.42;
    }
    float drift = min(coarseLoad, deposit * 0.85);
    coarseLoad -= drift;
    dSnow += drift + deposit * 0.55;

    // High cold cells compact deep snowpack into flowing glacier ice
    float iceFormation = snowCell.r * smoothstep(0.30, 0.80, snowStickCapacity) * uSnowParams.z * 0.020 * dt;
    if (tC.a > 0.01) {
      // Snowmelt feeds meltwater runoff which then behaves like rain
      dIce += min(snowCell.r * 0.02, tC.a * 0.004);
      outExchange = vec4(0.0, 0.0, 0.0, min(0.004, tC.a * 0.002 + snowCell.r * 0.0016));
    }
    dIce += iceFormation;
  } else if (species == SP_WIND) {
    // ---------------- AEOLIAN SALTATION, WINDWARD ABRASION & LEE-SLOPE DUNE BUILD ----------------
    if (uDryAeolian > 0.35) {
      // Werner (1995) wind-shadow dune dynamics:
      // grad points upslope; dot(grad, windDir) > 0 on windward stoss, < -0.18 in leeward slipface shadow!
      float slopeAlongWind = dot(grad, windDir);
      bool inLeeShadow = slopeAlongWind < -0.18;
      if (inLeeShadow && fineLoad > 1e-6) {
        // Flow separation bubble past the sharp dune brink: saltating grains drop onto upper slipface!
        float dropLee = fineLoad * 0.68;
        dFine += dropLee;
        fineLoad -= dropLee;
        speed *= 0.65;
      } else {
        float stossExpose = clamp(0.45 + 0.85 * slopeAlongWind, 0.0, 1.35);
        float capDry = uWindParams.z * 0.032 * stossExpose;
        if (fineLoad > capDry) {
          float sur = (fineLoad - capDry) * 0.45;
          dFine += sur;
          fineLoad -= sur;
        } else if (tC.b > 0.04) {
          // Gentle laminar saltation pickup from windward sand slope (preserves silky smooth stoss!)
          float pick = min(tC.b * 0.0035, (capDry - fineLoad) * 0.22 * dt * 18.0);
          dFine -= pick;
          fineLoad += pick;
        } else {
          // Windward bedrock abrasion on exposed yardangs
          float abr = min(max(0.0, tC.r - 1.0),
            uWindParams.z * 0.0035 * stossExpose / (0.35 + 2.4 * hardness) * dt * 20.0);
          dBedrock -= abr;
          fineLoad += abr;
        }
      }
    } else {
      float windAligned = clamp(-dot(downDir, windDir) * 0.5 + 0.5, 0.0, 1.0);
      float capacity = uWindParams.z * 0.055 * (0.35 + 0.65 * speed / 12.0) * (1.0 + 1.4 * max(0.0, rawSlope));
      if (totalLoad > capacity) {
        float surplus = totalLoad - capacity;
        dFine += surplus * (0.55 + 0.45 * uWindParams.w);
        fineLoad = max(0.0, fineLoad - surplus);
        speed *= 0.80;
      } else {
        // Sandblasting plucks fine dust from windward faces (hardness resists)
        float abrasion = min(max(0.0, tC.r - 1.0),
          uWindParams.z * 0.006 * windAligned * (1.0 + 2.2 * max(0.0, rawSlope)) / (0.30 + 2.2 * hardness) * dt * 24.0);
        float loose = min(tC.b, abrasion * 1.6 + tC.b * 0.012);
        dBedrock -= abrasion;
        dFine -= loose;
        fineLoad += abrasion + loose;
        fineLoad += coarseLoad * 0.02;
        coarseLoad *= 0.98;
      }
    }
    outExchange = vec4(dBedrock, dCoarse, dFine, 0.0);
    outExchange2 = vec4(0.0);
    outPosAge = vec4(nextXZ.x, hNext, nextXZ.y, posAge.w + dt);
    outVelWater = vec4(steerDir.x * speed, (hNext - hC) / max(dt, 1e-3), steerDir.y * speed, max(0.02, water * 0.995));
    outSediment = vec4(coarseLoad, fineLoad, sed.z - dBedrock, sed.w);
    return;
  } else if (species == SP_ROCK) {
    // ---------------- BOULDER ROLL, IMPACT SHATTER, COULOMB FRICTION & TALUS PILE-UP ----------------
    float kinetic = speed * speed;
    float frictionLoss = (0.35 + 1.6 * sinTheta) * 0.05;
    speed = max(1.2, speed * (1.0 - 0.22 * dt) - frictionLoss);
    float shatterChance = clamp((kinetic - 60.0) / 220.0, 0.0, 1.0) * (1.0 - 0.6 * hardness);
    if (shatterChance > 0.01) {
      float pulverize = min(max(0.0, tC.r - 1.0),
        shatterChance * 0.010 * dt * 26.0 / (0.30 + 2.4 * hardness));
      float dust = min(tC.b, shatterChance * 0.004 * dt * 26.0);
      dBedrock -= pulverize;
      dFine -= dust * 0.35;
      coarseLoad += pulverize * 0.72 + dust * 0.35;
      fineLoad += pulverize * 0.28;
      dCoarse -= min(tC.g, pulverize * 0.30);
    }
    // Pile up when the boulder runs out of momentum in hollows / at the base of the cliff face
    if (dh > 0.008 || speed < 2.4) {
      float dump = min(coarseLoad, (0.05 + max(0.0, dh) * 1.1) * dt * 26.0);
      coarseLoad -= dump;
      dCoarse += dump;
      speed *= 0.72;
    }
    outExchange = vec4(dBedrock, dCoarse, 0.0, 0.0);
    outExchange2 = vec4(0.0);
    outPosAge = vec4(nextXZ.x, hNext, nextXZ.y, posAge.w + dt);
    outVelWater = vec4(steerDir.x * speed, (hNext - hC) / max(dt, 1e-3), steerDir.y * speed, 0.30);
    outSediment = vec4(coarseLoad, fineLoad, sed.z - dBedrock, sed.w);
    return;
  } else {
    // ---------------- HYDRAULIC RUNOFF, HARDNESS-CONTROLLED CUTTING & TWO-SPECIES SEDIMENTATION ----------------
    float capacity = uHydraulics.y * 0.72 * water * (0.30 + 0.70 * (speed / 6.0)) * max(slopePower, 0.004) * streamBoost;

    if (dh > 0.002) {
      float fillNeed = min(totalLoad, dh * 0.85);
      if (totalLoad > 1e-6) {
        float coarseShare = clamp(coarseLoad / totalLoad * 1.25, 0.0, 1.0);
        float depC = min(coarseLoad, fillNeed * coarseShare);
        float depF = min(fineLoad, max(0.0, fillNeed - depC));
        coarseLoad -= depC;
        fineLoad -= depF;
        dCoarse += depC;
        dFine += depF;
      }
      speed *= 0.55;
    } else if (totalLoad > capacity) {
      float surplus = totalLoad - capacity;
      float depRate = clamp(uHydraulics.z * 0.44, 0.03, 0.88);

      // Coarse gravel drops out rapidly at canyon mouths (apex cones), fine silt travels far across alluvial fans!
      float depC = min(coarseLoad, surplus * depRate * 1.55);
      float remSurplus = max(0.0, surplus - depC);
      float depF = min(fineLoad, remSurplus * depRate * 0.36);

      coarseLoad -= depC;
      fineLoad -= depF;
      dCoarse += depC;
      dFine += depF;
    } else {
      float spareCap = capacity - totalLoad;
      float maxCutJump = min(max(0.0, -dh) * 0.92 + 0.015, 0.28);
      float rawDemand = min(spareCap * uHydraulics.x * 0.95, maxCutJump);

      float takeFine = min(tC.b * 0.55, rawDemand * 0.90);
      float remDemand = max(0.0, rawDemand - takeFine);

      float takeCoarse = min(tC.g * 0.42, remDemand * 0.72);
      remDemand = max(0.0, remDemand - takeCoarse * 1.15);

      float rockResistance = 0.12 + 3.85 * hardness * hardness;
      float bedCut = min(max(0.0, tC.r - 1.0), remDemand / rockResistance);

      // Meltwater pulses off warm snowpack super-charge erosive power on glaciated massifs
      float meltBoost = 1.0 + 1.8 * smoothstep(0.05, 0.55, snowCell.r) * uSnowParams.w;
      bedCut *= meltBoost;

      float coarseFrac = mix(0.24, 0.72, hardness);
      coarseLoad += takeCoarse + bedCut * coarseFrac;
      fineLoad += takeFine + bedCut * (1.0 - coarseFrac);

      dBedrock -= bedCut;
      dCoarse -= takeCoarse;
      dFine -= takeFine;
    }
  }

  float channelShelter = 1.0 / (1.0 + tC.a * 4.0);
  float nextWater = (species == SP_SNOW)
    ? velWater.w
    : water * (1.0 - uLifeEvap.x * 0.045 * channelShelter * dt);

  outPosAge = vec4(nextXZ.x, hNext, nextXZ.y, posAge.w + dt);
  outVelWater = vec4(steerDir.x * speed, (hNext - hC) / max(dt, 1e-3), steerDir.y * speed, nextWater);
  outSediment = vec4(coarseLoad, fineLoad, sed.z - dBedrock, sed.w);

  if (species == SP_SNOW) {
    outExchange = vec4(0.0, 0.0, 0.0, 0.0);
    outExchange2 = vec4(dSnow, dIce, 0.0, 0.0);
  } else {
    outExchange = vec4(dBedrock, dCoarse, dFine, 0.0);
    outExchange2 = vec4(0.0);
  }
}
`;

export const PARTICLE_SCATTER_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}

uniform sampler2D uPrevPosAgeTex;
uniform sampler2D uNextPosAgeTex;
uniform sampler2D uExchangeTex;
uniform sampler2D uExchange2Tex;
uniform vec2 uDomainAndRes; // (worldSpan, gridRes)

out vec4 vExchange;
out vec4 vExchange2;

void main() {
  ivec2 coord = ivec2(gl_VertexID % 256, gl_VertexID / 256);
  vec4 prevPA = texelFetch(uPrevPosAgeTex, coord, 0);
  vec4 nextPA = texelFetch(uNextPosAgeTex, coord, 0);
  vec4 exch = texelFetch(uExchangeTex, coord, 0);
  vec4 exch2 = texelFetch(uExchange2Tex, coord, 0);

  bool justLanded = (prevPA.w < 0.0) && (nextPA.w >= 0.0);
  bool wasSurface = (prevPA.w >= 0.0);

  float magnitude = dot(abs(exch), vec4(1.0)) + dot(abs(exch2), vec4(1.0));
  if ((!justLanded && !wasSurface) || magnitude < 1e-7) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vExchange = vec4(0.0);
    vExchange2 = vec4(0.0);
    return;
  }

  vec2 contactXZ = justLanded ? nextPA.xz : prevPA.xz;
  vec2 uv = contactXZ / uDomainAndRes.x + 0.5;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 3.0;
  vExchange = exch;
  vExchange2 = exch2;
}
`;

export const PARTICLE_SCATTER_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec4 vExchange;
in vec4 vExchange2;
layout(location = 0) out vec4 outDelta;
layout(location = 1) out vec4 outSnowDelta;

void main() {
  vec2 d = (gl_PointCoord - 0.5) * 3.0;
  float w = exp(-0.85 * dot(d, d)) * 0.242;
  outDelta = vExchange * w;
  outSnowDelta = vExchange2 * w;
}
`;

export const WATER_FLUX_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outFlux;

uniform sampler2D uTerrainTex;
uniform sampler2D uFluxTex;
uniform vec4 uPipeParams; // (gridRes, cellSize, dt, gravity)

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uPipeParams.x) - 1;

  vec4 tC = texelFetch(uTerrainTex, c, 0);
  vec4 fOld = texelFetch(uFluxTex, c, 0);

  float water = tC.a;
  if (water <= 1e-5) {
    outFlux = vec4(0.0);
    return;
  }

  float hTotalC = tC.r + tC.g + tC.b + water;

  vec4 tR = texelFetch(uTerrainTex, ivec2(min(maxI, c.x + 1), c.y), 0);
  vec4 tL = texelFetch(uTerrainTex, ivec2(max(0, c.x - 1), c.y), 0);
  vec4 tU = texelFetch(uTerrainTex, ivec2(c.x, min(maxI, c.y + 1)), 0);
  vec4 tD = texelFetch(uTerrainTex, ivec2(c.x, max(0, c.y - 1)), 0);

  vec4 dh = vec4(
    hTotalC - (tR.r + tR.g + tR.b + tR.a),
    hTotalC - (tL.r + tL.g + tL.b + tL.a),
    hTotalC - (tU.r + tU.g + tU.b + tU.a),
    hTotalC - (tD.r + tD.g + tD.b + tD.a)
  );

  float dt = uPipeParams.z;
  float accel = dt * uPipeParams.w / uPipeParams.y;
  vec4 flux = max(vec4(0.0), fOld * 0.96 + dh * accel);

  if (c.x == maxI) flux.x = water * uPipeParams.y * 0.35;
  if (c.x == 0)    flux.y = water * uPipeParams.y * 0.35;
  if (c.y == maxI) flux.z = water * uPipeParams.y * 0.35;
  if (c.y == 0)    flux.w = water * uPipeParams.y * 0.35;

  float sumFlux = flux.x + flux.y + flux.z + flux.w;
  float maxOut = (water * uPipeParams.y * uPipeParams.y) / max(dt, 1e-4);
  if (sumFlux > maxOut && sumFlux > 1e-7) {
    flux *= maxOut / sumFlux;
  }

  outFlux = flux;
}
`;

export const TERRAIN_INTEGRATE_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;

layout(location = 0) out vec4 outTerrain;
layout(location = 1) out vec4 outVelocity;

uniform sampler2D uTerrainTex;
uniform sampler2D uDeltaTex;
uniform sampler2D uFluxTex;
uniform sampler2D uSnowTex;

uniform vec4 uIntParams;      // (gridRes, cellSize, dt, evaporation)
uniform vec4 uPipeErode;      // (pipeFlowBlend, erosionStrength, rockHardness, worldSpan)
uniform vec4 uHardnessParams; // (rockHardness, strataStrength, strataFreq, faultWeakness)
uniform vec4 uStrataOrient;   // (sinStrike, cosStrike, tanDip, reliefScale)
uniform vec4 uBrush;          // (brushX, brushZ, brushRadius, brushMode)
uniform vec4 uClimate;        // (snowlineNorm, snowfallRate, glacierStrength, meltRate)
uniform vec4 uHydrology;      // (iceMeltRate, headwaterFlow, lakeRetention, dryAeolianMode)
uniform vec4 uWindField;      // (windDirX, windDirZ, windSpeed, erosionStrength)
uniform float uBrushStrength;
uniform float uSeed;

${COMMON_GEOLOGY_GLSL}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uIntParams.x) - 1;
  float cellSize = uIntParams.y;
  float dt = uIntParams.z;

  vec4 terr = texelFetch(uTerrainTex, c, 0);
  vec4 delta = texelFetch(uDeltaTex, c, 0);
  vec4 fC = texelFetch(uFluxTex, c, 0);

  float inFromL = c.x > 0    ? texelFetch(uFluxTex, ivec2(c.x - 1, c.y), 0).x : 0.0;
  float inFromR = c.x < maxI ? texelFetch(uFluxTex, ivec2(c.x + 1, c.y), 0).y : 0.0;
  float inFromD = c.y > 0    ? texelFetch(uFluxTex, ivec2(c.x, c.y - 1), 0).z : 0.0;
  float inFromU = c.y < maxI ? texelFetch(uFluxTex, ivec2(c.x, c.y + 1), 0).w : 0.0;

  float totalIn = inFromL + inFromR + inFromD + inFromU;
  float totalOut = fC.x + fC.y + fC.z + fC.w;
  float dWaterPipe = dt * (totalIn - totalOut) / (cellSize * cellSize);

  float qX = 0.5 * ((inFromL - fC.y) + (fC.x - inFromR)) / cellSize;
  float qZ = 0.5 * ((inFromD - fC.w) + (fC.z - inFromU)) / cellSize;
  float avgW = max(0.025, terr.a + 0.5 * dWaterPipe);
  vec2 flowVel = clamp(vec2(qX, qZ) / avgW, vec2(-12.0), vec2(12.0));
  float flowSpeed = length(flowVel);
  float discharge = length(vec2(qX, qZ));

  float dBed = clamp(delta.r, -0.22, 0.05);
  float dCoarse = clamp(delta.g, -0.25, 0.25);
  float dFine = clamp(delta.b, -0.25, 0.25);

  float bedrock = max(1.0, terr.r + dBed);
  float coarse = max(0.0, terr.g + dCoarse);
  float fine = max(0.0, terr.b + dFine);
  float water = max(0.0, terr.a + dWaterPipe + max(0.0, delta.a));

  vec2 worldXZ = (vUv - 0.5) * uPipeErode.w;
  if (uPipeErode.x > 0.01 && water > 0.004) {
    vec4 tR = texelFetch(uTerrainTex, ivec2(min(maxI, c.x + 1), c.y), 0);
    vec4 tL = texelFetch(uTerrainTex, ivec2(max(0, c.x - 1), c.y), 0);
    vec4 tU = texelFetch(uTerrainTex, ivec2(c.x, min(maxI, c.y + 1)), 0);
    vec4 tD = texelFetch(uTerrainTex, ivec2(c.x, max(0, c.y - 1)), 0);
    vec2 sGrad = vec2(
      (tR.r + tR.g + tR.b) - (tL.r + tL.g + tL.b),
      (tU.r + tU.g + tU.b) - (tD.r + tD.g + tD.b)
    ) / (2.0 * cellSize);
    float slope = length(sGrad);
    float hardness = evalRockHardness3D(vec3(worldXZ.x, bedrock, worldXZ.y), uHardnessParams, uStrataOrient, uSeed);

    float shear = discharge * (0.15 + slope) * 2.2;
    float critShear = 0.04 + 0.55 * hardness * hardness;
    if (shear > critShear && slope > 0.06) {
      float streamCut = min(0.035, (shear - critShear) * uPipeErode.y * uPipeErode.x * 0.018 * dt / (0.15 + 2.5 * hardness));
      bedrock = max(1.0, bedrock - streamCut);
      fine += streamCut * 0.18;
    } else if (flowSpeed < 0.85 && water > 0.012 && slope < 0.09) {
      fine += min(0.008, water * 0.012 * uPipeErode.x * dt);
    }
  }

  int bMode = int(abs(uBrush.w) + 0.5);
  if (bMode > 0 && uBrush.z > 0.5) {
    float dist = length(worldXZ - uBrush.xy);
    if (dist < uBrush.z) {
      float falloff = sq(max(0.0, 1.0 - dist / uBrush.z));
      if (bMode == 1) {
        water += falloff * uBrushStrength * 0.45 * dt * 8.0;
      } else if (bMode == 2) {
        bedrock += falloff * uBrushStrength * 28.0 * dt;
      } else if (bMode == 3) {
        float carveAmt = falloff * uBrushStrength * 28.0 * dt;
        float rmFine = min(fine, carveAmt);
        fine -= rmFine;
        float rmCoarse = min(coarse, carveAmt - rmFine);
        coarse -= rmCoarse;
        bedrock = max(1.0, bedrock - max(0.0, carveAmt - rmFine - rmCoarse));
      }
    }
  }

  // ==========================================================================
  // CRYOSPHERE COUPLING: GLACIER ABRASION, PLUCKING & SNOWMELT FEEDING THE RUNOFF
  // ==========================================================================
  vec4 snowC = texelFetch(uSnowTex, c, 0);
  float snowDepth = max(0.0, snowC.r);
  float iceDepth = max(0.0, snowC.g);

  float reliefScale = max(1.0, uStrataOrient.w);
  float elevN = (bedrock + coarse + fine) / reliefScale;
  float snowlineY = clamp(uClimate.x, 0.02, 1.05) * reliefScale;

  // Degree-day snowmelt & ice ablation (strictly below snowline + basal glacier snout ablation)
  // recharge the 2.5D shallow-water river & lake field!
  float subSnowWarmth = clamp((snowlineY - (bedrock + coarse + fine)) / max(0.18 * reliefScale, snowlineY), 0.0, 1.25);
  float meltWater = (snowDepth * 0.055 * subSnowWarmth + iceDepth * 0.045 * (subSnowWarmth + 0.12 * uHydrology.x))
                  * (0.35 + uHydrology.x) * dt;
  float cryoAblation = (snowC.b + snowC.a) * (0.55 + 1.45 * uHydrology.x);
  water += meltWater + cryoAblation;

  // Perennial upstream headwater river spring recharge into incised gorges & valley saddles
  if (uHydrology.y > 0.01) {
    float upstreamBand = smoothstep(0.32, 0.47, -vUv.y + 0.5) * (1.0 - smoothstep(0.47, 0.50, abs(vUv.y - 0.5)));
    float channelLow = 1.0 - smoothstep(0.06, 0.24, elevN);
    water += upstreamBand * channelLow * uHydrology.y * 0.16 * dt;
  } else if (uHydrology.y < -0.01) {
    // Artesian desert oasis groundwater spring: maintains crystal oasis lake at water-table 9.8m!
    vec2 oasisD = (vUv * 2.0 - 1.0) - vec2(-0.04, -0.03);
    float dO = length(vec2(oasisD.x * 1.15, (oasisD.y + 0.22 * sq(oasisD.x * 1.8)) * 1.55));
    float hSurfNow = bedrock + coarse + fine + water;
    if (dO < 0.28 && hSurfNow < 9.85) {
      water += min(9.85 - hSurfNow, (-uHydrology.y) * 0.18 * dt);
    }
  }

  // ==========================================================================
  // SNOW EROSION: NIVATION FROST-WEDGING, AVALANCHE COULOIR SCOUR & GLACIER GRINDING
  // ==========================================================================
  if ((snowDepth > 0.025 || iceDepth > 0.02) && c.x > 0 && c.x < maxI && c.y > 0 && c.y < maxI) {
    vec4 gR = texelFetch(uTerrainTex, ivec2(c.x + 1, c.y), 0);
    vec4 gL = texelFetch(uTerrainTex, ivec2(c.x - 1, c.y), 0);
    vec4 gU = texelFetch(uTerrainTex, ivec2(c.x, c.y + 1), 0);
    vec4 gD = texelFetch(uTerrainTex, ivec2(c.x, c.y - 1), 0);
    vec2 gSurf = vec2(
      (gR.r + gR.g + gR.b) - (gL.r + gL.g + gL.b),
      (gU.r + gU.g + gU.b) - (gD.r + gD.g + gD.b)
    ) / (2.0 * cellSize);
    float cryoSlope = length(gSurf);
    float cryoHardness = evalRockHardness3D(vec3(worldXZ.x, bedrock, worldXZ.y), uHardnessParams, uStrataOrient, uSeed);

    // 1. Glacier basal plucking & abrasion carves flat-floored U-shaped troughs & moraines
    if (iceDepth > 0.02) {
      float grind = clamp(iceDepth * (0.04 + cryoSlope * cryoSlope) * 0.52, 0.0, 0.055) * uClimate.z * dt;
      float pluck = min(max(0.0, bedrock - 1.0), grind / (0.25 + 2.2 * cryoHardness));
      bedrock = max(1.0, bedrock - pluck);
      fine += pluck * 0.52;
      coarse += pluck * 0.48;
    }

    // 2. Periglacial nivation & freeze-thaw frost-shattering + avalanche couloir scour!
    if (snowDepth > 0.025) {
      // Freeze-thaw peaks near snowpatch margins & steep cirque headwalls
      float marginFreezeThaw = exp(-sq((snowDepth - 0.38) * 1.9)) * (0.35 + 0.65 * smoothstep(0.25, 0.95, cryoSlope));
      float couloirAvalanche = smoothstep(0.10, 0.65, snowDepth) * smoothstep(0.58, 1.35, cryoSlope);
      float snowCutRate = (marginFreezeThaw * 0.0085 + couloirAvalanche * 0.015)
                        * (0.30 + 0.70 * uClimate.y) * uWindField.w * dt / (0.28 + 2.1 * cryoHardness);
      float snowCut = min(max(0.0, bedrock - 1.0), snowCutRate);
      bedrock = max(1.0, bedrock - snowCut);
      coarse += snowCut * 0.68;
      fine += snowCut * 0.32;
    }
  }

  // ==========================================================================
  // AEOLIAN WIND EROSION: STOSS-TO-LEE DUNE SALTATION & VENTIFACT ROCK SANDBLASTING!
  // ==========================================================================
  if (uWindField.z > 0.08 && water < 0.015 && snowDepth < 0.04 && c.x > 1 && c.x < maxI - 1 && c.y > 1 && c.y < maxI - 1) {
    vec2 wDir = safeNorm2(uWindField.xy, vec2(1.0, 0.0));
    float wPow = uWindField.z * (0.35 + 0.65 * uHydrology.w);

    vec4 aR = texelFetch(uTerrainTex, ivec2(c.x + 1, c.y), 0);
    vec4 aL = texelFetch(uTerrainTex, ivec2(c.x - 1, c.y), 0);
    vec4 aU = texelFetch(uTerrainTex, ivec2(c.x, c.y + 1), 0);
    vec4 aD = texelFetch(uTerrainTex, ivec2(c.x, c.y - 1), 0);
    vec2 hGrad = vec2(
      (aR.r + aR.g + aR.b) - (aL.r + aL.g + aL.b),
      (aU.r + aU.g + aU.b) - (aD.r + aD.g + aD.b)
    ) / (2.0 * cellSize);
    // hGrad points upslope: dot(hGrad, wDir) > 0 on windward stoss, < 0 on leeward slipface!
    float slopeAlongW = dot(hGrad, wDir);

    // Sample upwind & downwind cells for conservative saltation sand transport across dunes
    vec2 upUv = clamp(vUv - wDir * (1.35 / uIntParams.x), vec2(0.002), vec2(0.998));
    vec2 dnUv = clamp(vUv + wDir * (1.35 / uIntParams.x), vec2(0.002), vec2(0.998));
    vec4 tUp = sampleGridBilinear(uTerrainTex, upUv, uIntParams.x);
    vec4 tDn = sampleGridBilinear(uTerrainTex, dnUv, uIntParams.x);

    float hHere = bedrock + coarse + fine;
    float hUp = tUp.r + tUp.g + tUp.b;
    float hDn = tDn.r + tDn.g + tDn.b;
    float upSlopeW = (hHere - hUp) / (1.35 * cellSize);
    float dnSlopeW = (hDn - hHere) / (1.35 * cellSize);

    // Sauermann/Werner wind speed-up on windward stoss & flow separation drop in leeward shadow
    float emitUp   = smoothstep(-0.14, 0.32, upSlopeW) * min(tUp.b, 0.40);
    float emitHere = smoothstep(-0.14, 0.32, dnSlopeW) * min(fine, 0.40);
    float saltFluxRate = 0.055 * wPow * wPow * dt;
    float sandIn  = min(tUp.b * 0.16, emitUp * saltFluxRate);
    float sandOut = min(fine * 0.16, emitHere * saltFluxRate);
    fine = max(0.0, fine + sandIn - sandOut);

    // Kinetic windward sandblasting on exposed desert rock inselbergs, yardangs & Tassili cliffs!
    if (fine < 0.10 && slopeAlongW > 0.04) {
      float wHard = evalRockHardness3D(vec3(worldXZ.x, bedrock, worldXZ.y), uHardnessParams, uStrataOrient, uSeed);
      // Saltation curtain hits hardest 0.5m..28m above desert floor where sand grains bounce!
      float saltationCurtain = 1.0 - smoothstep(0.08, 0.48, elevN);
      float sandSupply = 0.35 + 0.65 * smoothstep(0.01, 0.25, tUp.b + aL.b + aR.b + aU.b + aD.b);
      float abrade = wPow * uWindField.w * slopeAlongW * (0.40 + 0.60 * saltationCurtain) * sandSupply
                   * 0.016 * dt / (0.28 + 2.3 * wHard);
      float rockLoss = min(max(0.0, bedrock - 1.0), abrade);
      bedrock = max(1.0, bedrock - rockLoss);
      fine += rockLoss * 0.85;
      coarse += rockLoss * 0.15;
    }
  }

  if (c.x == 0 || c.x == maxI || c.y == 0 || c.y == maxI) {
    water *= 0.65;
  } else {
    // Surface-area-limited evaporation: thin hillslope films evaporate cleanly while deep 2.5D
    // pooled lakes retain hydrostatic volume and spill naturally into downstream river channels!
    float poolShield = mix(1.0, 0.18, smoothstep(0.10, 0.65, water) * clamp(uHydrology.z, 0.0, 1.0));
    water = max(0.0, water * (1.0 - uIntParams.w * 0.035 * poolShield * dt) - 0.00015 * poolShield * dt);
  }

  outTerrain = vec4(bedrock, coarse, fine, water);
  outVelocity = vec4(flowVel.x, flowVel.y, flowSpeed * avgW, discharge);
}
`;

export const SNOW_CRYO_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outSnow;

uniform sampler2D uTerrainTex;
uniform sampler2D uSnowTex;
uniform sampler2D uSnowDeltaTex;
uniform vec4 uCryoParams;     // (gridRes, cellSize, dt, worldSpan)
uniform vec4 uClimate;        // (snowlineNorm, snowfallRate, glacierStrength, meltRate)
uniform vec4 uStrataOrient;   // (sinStrike, cosStrike, tanDip, reliefScale)
uniform vec4 uWindCryo;       // (windDirX, windDirZ, windSpeed, stepTime)
uniform float uIceMeltRate;
uniform float uSeed;

${COMMON_GEOLOGY_GLSL}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uCryoParams.x) - 1;
  float cellSize = uCryoParams.y;
  float dt = uCryoParams.z;

  vec4 snowC = texelFetch(uSnowTex, c, 0);
  vec4 snowDelta = texelFetch(uSnowDeltaTex, c, 0);
  vec4 terr = texelFetch(uTerrainTex, c, 0);

  float hBase = terr.r + terr.g + terr.b;
  float snowDepth = max(0.0, snowC.r + snowDelta.r);
  float iceDepth = max(0.0, snowC.g + snowDelta.g);

  float reliefScale = max(1.0, uStrataOrient.w);
  float elevN = hBase / reliefScale;
  float snowlineNorm = clamp(uClimate.x, 0.02, 1.05);
  vec2 worldXZ = (vUv - 0.5) * uCryoParams.w;

  // ==========================================================================
  // 1. FULL-DOMAIN OROGRAPHIC BLIZZARD SNOWFALL (Covers ENTIRE Terrain Smoothly!)
  // ==========================================================================
  if (uClimate.y > 0.01) {
    float stormSwirl = 0.72 + 0.56 * fbm2D(worldXZ * 0.016 + vec2(uWindCryo.w * 0.025, -uWindCryo.w * 0.018) + uSeed * 0.01, 3, 0.52);
    // Snow falls across the entire domain wherever temperature is near/below freezing!
    // Lowering snowline blankets all lower slopes & valleys too!
    float coldZone = smoothstep(snowlineNorm - 0.18 * uClimate.y, snowlineNorm + 0.12, elevN);
    float capSoft = max(0.0, 1.0 - snowDepth / 6.5);
    snowDepth += uClimate.y * coldZone * stormSwirl * capSoft * 0.085 * dt;
  }

  // ==========================================================================
  // 2. MASS-CONSERVING SLAB AVALANCHE, COULOIR CASCADE, WIND DRIFT & GLACIER CREEP
  // ==========================================================================
  if (c.x > 0 && c.x < maxI && c.y > 0 && c.y < maxI) {
    const ivec2 offs[8] = ivec2[8](
      ivec2( 1,  0), ivec2(-1,  0), ivec2( 0,  1), ivec2( 0, -1),
      ivec2( 1,  1), ivec2(-1, -1), ivec2( 1, -1), ivec2(-1,  1)
    );
    float hSnowHere = hBase + snowDepth;
    float snowReposeTan = 0.76; // ~37-deg alpine dry-snow repose: steeper cliffs shed into couloirs & snow cones!
    float netAvalanche = 0.0;

    for (int i = 0; i < 8; i++) {
      ivec2 nb = c + offs[i];
      float dist = (i < 4 ? 1.0 : 1.41421356) * cellSize;
      vec4 tN = texelFetch(uTerrainTex, nb, 0);
      vec4 sN = texelFetch(uSnowTex, nb, 0);
      float hSnowN = tN.r + tN.g + tN.b + sN.r;
      float diff = hSnowHere - hSnowN;
      float maxDiff = snowReposeTan * dist;

      if (diff > maxDiff && snowDepth > 0.01) {
        netAvalanche -= min(snowDepth * 0.095, (diff - maxDiff) * 0.070);
      } else if (-diff > maxDiff && sN.r > 0.01) {
        netAvalanche += min(sN.r * 0.095, (-diff - maxDiff) * 0.070);
      }
    }
    snowDepth = max(0.0, snowDepth + netAvalanche);

    // Wind-drifted snow redistribution: scours windward crests & loads leeward cirques/cornices!
    if (uWindCryo.z > 0.05) {
      vec2 wDir = safeNorm2(uWindCryo.xy, vec2(1.0, 0.0));
      vec2 upUv = clamp(vUv - wDir * (1.2 / uCryoParams.x), vec2(0.002), vec2(0.998));
      vec4 sUp = sampleGridBilinear(uSnowTex, upUv, uCryoParams.x);
      vec4 tR = texelFetch(uTerrainTex, ivec2(c.x + 1, c.y), 0);
      vec4 tL = texelFetch(uTerrainTex, ivec2(c.x - 1, c.y), 0);
      vec4 tU = texelFetch(uTerrainTex, ivec2(c.x, c.y + 1), 0);
      vec4 tD = texelFetch(uTerrainTex, ivec2(c.x, c.y - 1), 0);
      float hR = tR.r + tR.g + tR.b;
      float hL = tL.r + tL.g + tL.b;
      float hU = tU.r + tU.g + tU.b;
      float hD = tD.r + tD.g + tD.b;
      vec2 g = vec2(hR - hL, hU - hD) / (2.0 * cellSize);
      float leeTrap = clamp(-dot(g, wDir) * 0.8, -0.6, 0.8);
      float driftIn  = min(sUp.r * 0.05, sUp.r * max(0.0, 0.25 + leeTrap) * uWindCryo.z * 0.18 * dt);
      float driftOut = min(snowDepth * 0.05, snowDepth * max(0.0, 0.25 - leeTrap) * uWindCryo.z * 0.18 * dt);
      snowDepth = max(0.0, snowDepth + driftIn - driftOut);
    }

    // Downslope glacier creep: thick valley ice flows from high cirques down into warm U-valleys!
    if (uClimate.z > 0.02) {
      vec4 tR2 = texelFetch(uTerrainTex, ivec2(c.x + 1, c.y), 0);
      vec4 tL2 = texelFetch(uTerrainTex, ivec2(c.x - 1, c.y), 0);
      vec4 tU2 = texelFetch(uTerrainTex, ivec2(c.x, c.y + 1), 0);
      vec4 tD2 = texelFetch(uTerrainTex, ivec2(c.x, c.y - 1), 0);
      float hR2 = tR2.r + tR2.g + tR2.b;
      float hL2 = tL2.r + tL2.g + tL2.b;
      float hU2 = tU2.r + tU2.g + tU2.b;
      float hD2 = tD2.r + tD2.g + tD2.b;
      float sR = texelFetch(uSnowTex, ivec2(c.x + 1, c.y), 0).g;
      float sL = texelFetch(uSnowTex, ivec2(c.x - 1, c.y), 0).g;
      float sU = texelFetch(uSnowTex, ivec2(c.x, c.y + 1), 0).g;
      float sD = texelFetch(uSnowTex, ivec2(c.x, c.y - 1), 0).g;
      float hC0 = hBase + iceDepth;
      float creepRate = 0.055 * uClimate.z * dt;
      float inIce = max(0.0, hR2 + sR - hC0) * min(sR, 2.5)
                  + max(0.0, hL2 + sL - hC0) * min(sL, 2.5)
                  + max(0.0, hU2 + sU - hC0) * min(sU, 2.5)
                  + max(0.0, hD2 + sD - hC0) * min(sD, 2.5);
      float outIce = (max(0.0, hC0 - (hR2 + sR)) + max(0.0, hC0 - (hL2 + sL))
                    + max(0.0, hC0 - (hU2 + sU)) + max(0.0, hC0 - (hD2 + sD))) * min(iceDepth, 2.5);
      iceDepth = max(0.0, iceDepth + (inIce - outIce) * creepRate);
    }
  }

  // ==========================================================================
  // 3. FIRN COMPACTION ABOVE SNOWLINE & TRUE ALTITUDE-LAPSE MELT BELOW SNOWLINE!
  // ==========================================================================
  float aboveSnowline = smoothstep(snowlineNorm - 0.05, snowlineNorm + 0.18, elevN);
  float compaction = min(snowDepth * 0.16, max(0.0, snowDepth - 0.55) * aboveSnowline * uClimate.z * 0.38 * dt);
  snowDepth -= compaction;
  iceDepth += compaction;

  // Strictly elevation-controlled air warmth: ZERO solar melt above the snowline so peaks,
  // ridges, and high snowfields stay permanently snow-clad, while snow/glaciers creeping or
  // avalanching below snowlineNorm melt naturally into 2.5D rivers & alpine tarns!
  float subSnowDepth = max(0.0, snowlineNorm - elevN);
  float warmth = clamp(subSnowDepth / max(0.16, snowlineNorm), 0.0, 1.35);
  float meltMod = 0.35 + 1.35 * uIceMeltRate;
  float melt = min(snowDepth, snowDepth * 0.55 * meltMod * warmth * dt);
  snowDepth -= melt;
  // Valley glacier snouts also experience gentle basal/snout pressure-melting into rivers
  float iceMelt = min(iceDepth, iceDepth * (0.32 * warmth + 0.015 * uIceMeltRate) * meltMod * dt);
  iceDepth -= iceMelt;

  if (c.x == 0 || c.x == maxI || c.y == 0 || c.y == maxI) {
    snowDepth *= 0.96;
    iceDepth *= 0.96;
  }

  outSnow = vec4(min(snowDepth, 9.0), min(iceDepth, 22.0), melt, iceMelt);
}
`;

export const THERMAL_TALUS_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outTerrain;

uniform sampler2D uTerrainTex;
uniform vec4 uTalusParams;    // (gridRes, cellSize, talusControl, worldSpan)
uniform vec4 uHardnessParams; // (rockHardness, strataStrength, strataFreq, faultWeakness)
uniform vec4 uStrataOrient;   // (sinStrike, cosStrike, tanDip, reliefScale)
uniform float uDryAeolian;
uniform float uSeed;

${COMMON_GEOLOGY_GLSL}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uTalusParams.x) - 1;
  float cellSize = uTalusParams.y;

  vec4 tC = texelFetch(uTerrainTex, c, 0);
  if (c.x <= 0 || c.x >= maxI || c.y <= 0 || c.y >= maxI) {
    outTerrain = tC;
    return;
  }

  float hC = tC.r + tC.g + tC.b;
  vec2 worldXZ = (vUv - 0.5) * uTalusParams.w;
  float hardC = evalRockHardness3D(vec3(worldXZ.x, tC.r, worldXZ.y), uHardnessParams, uStrataOrient, uSeed);

  float drySandBlend = clamp(uDryAeolian, 0.0, 1.0) * (1.0 - smoothstep(0.005, 0.030, tC.a));
  float talusTan = 0.48 + 0.34 * uTalusParams.z;
  float fineTan  = mix(0.24 + 0.18 * uTalusParams.z, 0.672, drySandBlend);
  float cliffTan = 0.78 + 2.45 * hardC * hardC;

  float netCoarse = 0.0;
  float netFine = 0.0;
  float bedCalveLoss = 0.0;

  const ivec2 offs[8] = ivec2[8](
    ivec2( 1,  0), ivec2(-1,  0), ivec2( 0,  1), ivec2( 0, -1),
    ivec2( 1,  1), ivec2(-1, -1), ivec2( 1, -1), ivec2(-1,  1)
  );

  for (int i = 0; i < 8; i++) {
    ivec2 nb = c + offs[i];
    float dist = (i < 4 ? 1.0 : 1.41421356) * cellSize;
    vec4 tN = texelFetch(uTerrainTex, nb, 0);
    float hN = tN.r + tN.g + tN.b;
    float diff = hC - hN;

    float maxDiffFine = fineTan * dist;
    if (diff > maxDiffFine && tC.b > 1e-5) {
      netFine -= min(tC.b * 0.11, (diff - maxDiffFine) * 0.085);
    } else if (-diff > maxDiffFine && tN.b > 1e-5) {
      netFine += min(tN.b * 0.11, (-diff - maxDiffFine) * 0.085);
    }

    float maxDiffCoarse = talusTan * dist;
    if (diff > maxDiffCoarse && tC.g > 1e-5) {
      netCoarse -= min(tC.g * 0.10, (diff - maxDiffCoarse) * 0.075);
    } else if (-diff > maxDiffCoarse && tN.g > 1e-5) {
      netCoarse += min(tN.g * 0.10, (-diff - maxDiffCoarse) * 0.075);
    }

    float maxDiffCliff = cliffTan * dist;
    if (diff > maxDiffCliff && tC.g < 0.05) {
      float calve = min(max(0.0, tC.r - 1.0) * 0.04, (diff - maxDiffCliff) * 0.032);
      bedCalveLoss += calve;
    } else if (-diff > 0.78 * dist) {
      vec2 nbXZ = ((vec2(nb) + 0.5) / uTalusParams.x - 0.5) * uTalusParams.w;
      float hardN = evalRockHardness3D(vec3(nbXZ.x, tN.r, nbXZ.y), uHardnessParams, uStrataOrient, uSeed);
      float nbCliffMax = (0.78 + 2.45 * hardN * hardN) * dist;
      if (-diff > nbCliffMax && tN.g < 0.05) {
        netCoarse += min(max(0.0, tN.r - 1.0) * 0.04, (-diff - nbCliffMax) * 0.032);
      }
    }
  }

  outTerrain = vec4(
    max(1.0, tC.r - bedCalveLoss),
    max(0.0, tC.g + netCoarse),
    max(0.0, tC.b + netFine),
    tC.a
  );
}
`;

export const TERRAIN_RENDER_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}

layout(location = 0) in vec2 aGridUv;

uniform sampler2D uTerrainTex;
uniform sampler2D uSnowTex;
uniform sampler2D uVecDispTex;
uniform mat4 uViewProj;
uniform vec4 uRenderDomain; // (worldSpan, gridRes, showWater, timeSec)
uniform vec4 uLayerVis;     // (lithologyOpacity, fabricStrength, snowVisOpacity, waterVisOpacity)
uniform float uUseVecDisp;

out vec2 vUv;
out vec3 vWorldPos;
out vec4 vLayers;

void main() {
  vec2 clampedUv = clamp(aGridUv, vec2(0.0), vec2(1.0));
  ivec2 tc = clamp(ivec2(clampedUv * (uRenderDomain.y - 1.0) + 0.5), ivec2(0), ivec2(int(uRenderDomain.y) - 1));
  vec4 terr = texelFetch(uTerrainTex, tc, 0);
  vec4 cryo = texelFetch(uSnowTex, tc, 0);

  float waterLift = uRenderDomain.z > 0.5 ? terr.a * uLayerVis.w : 0.0;
  // Snowpack & glacier ice physically raise the visible surface (capped so drifts never balloon)
  float cryoLift = min(3.4, cryo.r * 0.85 + cryo.g * 0.62) * uLayerVis.z;
  float hSurf = terr.r + terr.g + terr.b + waterLift + cryoLift;

  vec2 xz = (clampedUv - 0.5) * uRenderDomain.x;
  bool isSkirt = aGridUv.x < -0.0001 || aGridUv.x > 1.0001 || aGridUv.y < -0.0001 || aGridUv.y > 1.0001;
  float y = isSkirt ? 0.0 : hSurf;

  vec3 wp = vec3(xz.x, y, xz.y);
  if (!isSkirt && uUseVecDisp > 0.5) {
    vec4 vd = texelFetch(uVecDispTex, tc, 0);
    wp += vd.xyz;
  }
  vUv = clampedUv;
  vWorldPos = wp;
  vLayers = isSkirt ? vec4(wp.y, 0.0, 0.0, 0.0) : terr;
  gl_Position = uViewProj * vec4(wp, 1.0);
}
`;

export const TERRAIN_RENDER_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec2 vUv;
in vec3 vWorldPos;
in vec4 vLayers;

layout(location = 0) out vec4 outColor;

uniform sampler2D uTerrainTex;
uniform sampler2D uInitialTex;
uniform sampler2D uVelocityFieldTex;

uniform sampler2D uSnowTex;
uniform sampler2D uCavePortalTex;
uniform sampler2D uMaskPreviewTex;

uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec4 uRenderDomain;   // (worldSpan, gridRes, showWater, timeSec)
uniform vec4 uHardnessParams; // (rockHardness, strataStrength, strataFreq, faultWeakness)
uniform vec4 uStrataOrient;   // (sinStrike, cosStrike, tanDip, reliefScale)
uniform vec4 uBrush;          // (brushX, brushZ, brushRadius, brushMode)
uniform vec4 uClimate;        // (snowlineNorm, snowfallRate, glacierStrength, meltRate)
uniform vec4 uWindRender;     // (windX, windZ, windSpeed, dryAeolianMode)
uniform vec4 uLayerVis;       // (lithologyOpacity, fabricStrength, snowVisOpacity, waterVisOpacity)
uniform int uViewMode;
uniform int uMaterialTheme;   // 0..2 = Baseline, 3 = Grand Canyon, 4 = Studlagil, 5 = Yardang, 6 = Namib Erg
uniform int uFabricMode;      // 0 = Baseline, 1 = Columnar, 2 = Cross-Bed/Ripples, 3 = Tafoni, 4 = Gneiss
uniform float uSeed;
uniform float uHasCaves;

${COMMON_GEOLOGY_GLSL}

float sampleTerrainShadow(vec2 startUv, float startH, vec3 sunDir, float span, float res) {
  float stepLenWorld = length(sunDir.xz);
  if (stepLenWorld < 1e-4) return 1.0;

  float shadow = 1.0;
  float t = (span / res) * 1.4;
  vec2 marchDir = sunDir.xz / stepLenWorld;
  for (int i = 0; i < 18; i++) {
    vec2 suv = startUv + marchDir * (t / span);
    if (suv.x <= 0.0 || suv.x >= 1.0 || suv.y <= 0.0 || suv.y >= 1.0) break;
    vec4 st = sampleGridBilinear(uTerrainTex, suv, res);
    float sh = st.r + st.g + st.b;
    float rayH = startH + (sunDir.y / stepLenWorld) * t;
    float diff = rayH - sh;
    if (diff < 0.0) return 0.14;
    shadow = min(shadow, clamp(3.2 * diff / max(t * 0.18, 0.5), 0.14, 1.0));
    t *= 1.24;
  }
  return shadow;
}

void main() {
  float span = uRenderDomain.x;
  float res = uRenderDomain.y;
  float cellSize = span / res;
  float eps = 1.0 / res;

  vec4 tC = sampleGridBilinear(uTerrainTex, vUv, res);
  vec4 tR = sampleGridBilinear(uTerrainTex, vUv + vec2(eps, 0.0), res);
  vec4 tL = sampleGridBilinear(uTerrainTex, vUv - vec2(eps, 0.0), res);
  vec4 tU = sampleGridBilinear(uTerrainTex, vUv + vec2(0.0, eps), res);
  vec4 tD = sampleGridBilinear(uTerrainTex, vUv - vec2(0.0, eps), res);

  float hC = tC.r + tC.g + tC.b;
  float hR = tR.r + tR.g + tR.b;
  float hL = tL.r + tL.g + tL.b;
  float hU = tU.r + tU.g + tU.b;
  float hD = tD.r + tD.g + tD.b;

  bool isSideSkirt = vWorldPos.y < hC - 0.6;
  if (!isSideSkirt && uHasCaves > 0.5) {
    float portalCut = sampleGridBilinear(uCavePortalTex, vUv, 128.0).r;
    if (portalCut > 0.52) discard;
  }
  vec3 bedNormal;
  if (isSideSkirt) {
    vec2 edgeD = vUv - 0.5;
    bedNormal = abs(edgeD.x) > abs(edgeD.y)
      ? vec3(sign(edgeD.x), 0.05, 0.0)
      : vec3(0.0, 0.05, sign(edgeD.y));
    bedNormal = safeNorm3(bedNormal, vec3(0.0, 1.0, 0.0));
  } else {
    bedNormal = safeNorm3(vec3(hL - hR, 2.0 * cellSize, hD - hU), vec3(0.0, 1.0, 0.0));
  }

  float lap1 = (hR + hL + hU + hD) * 0.25 - hC;
  float eps3 = 3.5 / res;
  float lap2 = (
    sampleGridBilinear(uTerrainTex, vUv + vec2(eps3, 0.0), res).r +
    sampleGridBilinear(uTerrainTex, vUv - vec2(eps3, 0.0), res).r +
    sampleGridBilinear(uTerrainTex, vUv + vec2(0.0, eps3), res).r +
    sampleGridBilinear(uTerrainTex, vUv - vec2(0.0, eps3), res).r
  ) * 0.25 - tC.r;
  float ao = isSideSkirt ? 0.72 : clamp(1.0 - clamp(lap1 * 0.22 + lap2 * 0.055, -0.25, 0.68), 0.30, 1.08);
  float ridgeConvex = clamp(-lap1 * 0.32, 0.0, 1.0);

  float rockY = isSideSkirt ? vWorldPos.y : tC.r;
  float hardness = evalRockHardness3D(vec3(vWorldPos.x, rockY, vWorldPos.z), uHardnessParams, uStrataOrient, uSeed);

  float grain = noise2D(vWorldPos.xz * 0.55 + rockY * 0.35) - 0.5;
  float patchN = fbm2D(vWorldPos.xz * 0.045, 3, 0.55) - 0.5;

  // ==========================================================================
  // REGIONAL LITHOLOGY PALETTES (Utah Desert / Icelandic Volcanic / Himalayan Gneiss)
  // ==========================================================================
  vec3 softRockCol;
  vec3 midRockCol;
  vec3 hardRockCol;
  vec3 summitCol;
  vec3 basinFloorCol;
  vec3 coarseGravelCol;
  vec3 fineAlluvialCol;
  vec3 mossCol = vec3(0.0);

  if (uMaterialTheme == 1) {
    // ICELANDIC VOLCANIC: black basalt columns, oxidised orange rhyolite, subarctic moss, black sand
    softRockCol    = vec3(0.048, 0.047, 0.050);
    midRockCol     = vec3(0.120, 0.064, 0.044); // Rhyolite / palagonite ridge bands
    hardRockCol    = vec3(0.198, 0.122, 0.082); // Weathered olivine basalt ledge
    summitCol      = vec3(0.270, 0.272, 0.288);
    basinFloorCol  = vec3(0.034, 0.034, 0.037);
    coarseGravelCol = vec3(0.092, 0.090, 0.094); // Basalt scree
    fineAlluvialCol = vec3(0.062, 0.058, 0.056); // Volcanic black-sand sandur
    mossCol         = vec3(0.098, 0.140, 0.052); // Woolly fringed moss & arctic thyme
  } else if (uMaterialTheme == 2) {
    // HIMALAYAN GNEISS: dark banded gneiss, leucogranite sills, moraine till, blue glacier ice
    softRockCol    = vec3(0.098, 0.094, 0.100); // Biotite gneiss
    midRockCol     = vec3(0.188, 0.180, 0.180); // Banded paragneiss
    hardRockCol    = vec3(0.330, 0.300, 0.290); // Leucogranite sill
    summitCol      = vec3(0.385, 0.380, 0.390);
    basinFloorCol  = vec3(0.112, 0.104, 0.098);
    coarseGravelCol = vec3(0.232, 0.212, 0.190); // Moraine till
    fineAlluvialCol = vec3(0.300, 0.262, 0.208); // Glaciofluvial outwash silt
  } else if (uMaterialTheme == 3) {
    // GRAND CANYON STRATA: dark Vishnu inner gorge -> crimson Redwall -> Supai terracotta -> Kaibab cream
    softRockCol    = vec3(0.245, 0.092, 0.064); // Hermit / Bright Angel recessed red shale
    midRockCol     = vec3(0.385, 0.155, 0.092); // Redwall / Supai crimson cliff-former
    hardRockCol    = vec3(0.495, 0.415, 0.305); // Coconino / Kaibab buff-cream caprock
    summitCol      = vec3(0.460, 0.405, 0.320); // Kaibab limestone rim
    basinFloorCol  = vec3(0.055, 0.052, 0.058); // Dark Precambrian Vishnu Schist inner gorge!
    coarseGravelCol = vec3(0.275, 0.165, 0.118); // Redwall talus cones
    fineAlluvialCol = vec3(0.380, 0.255, 0.158); // Colorado sandbars & debris fans
  } else if (uMaterialTheme == 4) {
    // STUDLAGIL COLUMNAR BASALT: blue-slate colonnades, rusty iron seams, chartreuse moss
    softRockCol    = vec3(0.055, 0.062, 0.072); // Dark entablature basalt
    midRockCol     = vec3(0.095, 0.108, 0.124); // Blue-grey hexagonal colonnade prisms
    hardRockCol    = vec3(0.235, 0.132, 0.078); // Iron-oxidized riverside basalt band!
    summitCol      = vec3(0.210, 0.205, 0.198);
    basinFloorCol  = vec3(0.042, 0.046, 0.052);
    coarseGravelCol = vec3(0.088, 0.092, 0.100);
    fineAlluvialCol = vec3(0.115, 0.122, 0.126);
    mossCol         = vec3(0.125, 0.185, 0.058); // Vivid Icelandic canyon moss
  } else if (uMaterialTheme == 5) {
    // SAHARAN VARNISHED YARDANG & GOLDEN DRIFT SAND
    softRockCol    = vec3(0.165, 0.105, 0.075); // Manganese desert-varnished shale
    midRockCol     = vec3(0.335, 0.205, 0.125); // Wind-fluted Nubian sandstone
    hardRockCol    = vec3(0.440, 0.315, 0.195); // Sun-bleached buff caprock
    summitCol      = vec3(0.195, 0.135, 0.108); // Dark desert varnish cap
    basinFloorCol  = vec3(0.145, 0.118, 0.096); // Deflation desert pavement (reg)
    coarseGravelCol = vec3(0.265, 0.210, 0.158);
    fineAlluvialCol = vec3(0.555, 0.345, 0.168); // Warm golden Saharan drift sand!
  } else if (uMaterialTheme == 6) {
    // NAMIB & SAHARA GOLDEN-APRICOT ERG: dark reg / pale Deadvlei pan + luminous burnt-apricot sand
    softRockCol    = vec3(0.135, 0.106, 0.092); // Dark bronze desert reg floor
    midRockCol     = vec3(0.175, 0.142, 0.122);
    hardRockCol    = vec3(0.365, 0.340, 0.312); // Pale sun-cracked clay pan (Deadvlei / vlei)
    summitCol      = vec3(0.210, 0.175, 0.148);
    basinFloorCol  = vec3(0.335, 0.315, 0.292); // Pale clay pan in lowest interdune hollows!
    coarseGravelCol = vec3(0.245, 0.178, 0.132);
    fineAlluvialCol = vec3(0.575, 0.295, 0.138); // Iconic Namib Sossusvlei burnt-apricot quartz sand!
  } else if (uMaterialTheme == 7) {
    // LUNAR MARE & ANORTHOSITE HIGHLANDS: dark ilmenite mare basalt, impact breccia & bright regolith
    softRockCol    = vec3(0.088, 0.090, 0.096); // Mare basalt regolith
    midRockCol     = vec3(0.168, 0.170, 0.178); // Fra Mauro impact breccia
    hardRockCol    = vec3(0.315, 0.318, 0.326); // Bright anorthosite highland & crater rim ejecta
    summitCol      = vec3(0.365, 0.368, 0.378); // Highland massif crests
    basinFloorCol  = vec3(0.070, 0.072, 0.078); // Dark flooded lunar mare floor
    coarseGravelCol = vec3(0.225, 0.228, 0.236); // Bright crater-rim ejecta blocks
    fineAlluvialCol = vec3(0.112, 0.115, 0.122); // Fine lunar mare regolith dust
  } else if (uMaterialTheme == 8) {
    // ICELANDIC GREEN HIGHLANDS (THORSMORK): dark basalt cliffs, palagonite tuff & lush emerald moss!
    softRockCol    = vec3(0.048, 0.050, 0.056); // Wet charcoal volcanic basalt cliff
    midRockCol     = vec3(0.118, 0.098, 0.078); // Hyaloclastite palagonite tuff
    hardRockCol    = vec3(0.175, 0.148, 0.122); // Columnar flood-basalt sill
    summitCol      = vec3(0.220, 0.215, 0.210);
    basinFloorCol  = vec3(0.042, 0.044, 0.046); // Braided black volcanic sandur
    coarseGravelCol = vec3(0.082, 0.084, 0.088);
    fineAlluvialCol = vec3(0.058, 0.056, 0.056);
    mossCol         = vec3(0.115, 0.245, 0.048); // Vivid Thorsmork emerald moss & birch carpet!
  } else if (uMaterialTheme == 9) {
    // SAHARAN GOLDEN ERG & ARTESIAN OASIS: luminous golden sand, ochre rim & verdant oasis fringe!
    softRockCol    = vec3(0.175, 0.132, 0.098);
    midRockCol     = vec3(0.335, 0.232, 0.148); // Weathered oasis sandstone ledge
    hardRockCol    = vec3(0.445, 0.355, 0.245); // Pale limestone/evaporite shoreline crust
    summitCol      = vec3(0.285, 0.215, 0.155);
    basinFloorCol  = vec3(0.395, 0.355, 0.285); // Wet oasis beach sand
    coarseGravelCol = vec3(0.275, 0.210, 0.152);
    fineAlluvialCol = vec3(0.595, 0.385, 0.178); // Warm golden Ubari Saharan dune sand!
    mossCol         = vec3(0.072, 0.215, 0.055); // Lush date-palm & reed oasis greenery!
  } else {
    // UTAH DESERT: Moenkopi shale, Wingate sandstone, Navajo caprock, ochre alluvial fans
    softRockCol    = vec3(0.115, 0.068, 0.062);
    midRockCol     = vec3(0.285, 0.148, 0.088);
    hardRockCol    = vec3(0.395, 0.305, 0.215);
    summitCol      = vec3(0.225, 0.218, 0.212);
    basinFloorCol  = vec3(0.095, 0.088, 0.082);
    coarseGravelCol = vec3(0.235, 0.215, 0.192);
    fineAlluvialCol = vec3(0.455, 0.335, 0.185);
  }

  vec3 rockAlbedo = hardness < 0.5
    ? mix(softRockCol, midRockCol, hardness * 2.0)
    : mix(midRockCol, hardRockCol, (hardness - 0.5) * 2.0);

  float elevFrac = clamp(rockY / max(uStrataOrient.w, 1.0), 0.0, 1.2);
  rockAlbedo = mix(rockAlbedo, summitCol, smoothstep(0.76, 1.08, elevFrac) * 0.48);
  rockAlbedo = mix(basinFloorCol, rockAlbedo, smoothstep(0.03, 0.20, elevFrac));
  rockAlbedo *= (1.0 + 0.12 * grain + 0.10 * patchN + 0.12 * ridgeConvex);

  // Icelandic subarctic vegetation belt: moss & lichen colonise gentle low & mid slopes
  if (uMaterialTheme == 1 || uMaterialTheme == 4) {
    float mossFlora = smoothstep(0.42, 0.90, bedNormal.y)
      * (1.0 - smoothstep(0.34, 0.68, elevFrac))
      * smoothstep(0.05, 0.42, fbm2D(vWorldPos.xz * 0.030 + 11.7, 3, 0.55));
    mossCol *= (0.85 + 0.30 * patchN + 0.20 * grain);
    rockAlbedo = mix(rockAlbedo, mossCol, mossFlora * 0.80);
  } else if (uMaterialTheme == 8) {
    // Thorsmork Green Highlands: lush emerald moss & arctic birch blanket valleys, benches & steep ridge shoulders!
    float floraNoise = fbm2D(vWorldPos.xz * 0.028 + 7.3, 4, 0.55);
    float mossFlora = smoothstep(0.26, 0.76, bedNormal.y)
      * (1.0 - smoothstep(0.52, 0.86, elevFrac))
      * smoothstep(0.02, 0.34, floraNoise + 0.14);
    vec3 lushGreen = mix(vec3(0.068, 0.165, 0.038), mossCol * vec3(1.18, 1.12, 0.95), clamp(floraNoise * 1.3, 0.0, 1.0));
    lushGreen *= (0.88 + 0.26 * grain);
    rockAlbedo = mix(rockAlbedo, lushGreen, mossFlora * 0.90);
  }

  // ==========================================================================
  // PROCEDURAL LITHOLOGY FABRIC TEXTURING (uFabricMode 1..4; 0 = untouched baseline!)
  // ==========================================================================
  vec3 preFabricAlbedo = rockAlbedo;
  vec3 preFabricNormal = bedNormal;
  if (uFabricMode > 0 && uLayerVis.y > 0.001 && (uMaterialTheme != 6 || tC.b < 0.08)) {
    float steepFace = smoothstep(0.18, 0.72, 1.0 - bedNormal.y);
    if (uFabricMode == 1) {
      // Hexagonal Columnar Basalt Colonnades + Chisel Cross-Joints
      vec2 hq = vWorldPos.xz * 0.52;
      vec2 hr = vec2(1.0, 1.7320508);
      vec2 hh = hr * 0.5;
      vec2 ha = mod(hq, hr) - hh;
      vec2 hb = mod(hq - hh, hr) - hh;
      vec2 hgv = dot(ha, ha) < dot(hb, hb) ? ha : hb;
      float hexDist = 0.5 - max(abs(hgv.x), abs(hgv.x) * 0.5 + abs(hgv.y) * 0.8660254);
      float colSeam = (1.0 - smoothstep(0.02, 0.10, hexDist)) * (0.35 + 0.65 * steepFace);
      float crossStep = (1.0 - smoothstep(0.03, 0.11, abs(fract(rockY * 0.28 + patchN * 0.4) - 0.5))) * steepFace;
      rockAlbedo *= (1.0 - 0.32 * colSeam - 0.15 * crossStep);
      rockAlbedo = mix(rockAlbedo, vec3(0.24, 0.13, 0.07), colSeam * 0.28);
      bedNormal = safeNorm3(bedNormal + vec3(hgv.x, 0.0, hgv.y) * (0.22 * steepFace), bedNormal);
    } else if (uFabricMode == 2) {
      // Aeolian Trough Cross-Bedding Foresets on Exposed Sandstone
      float foreset = sin(rockY * 1.45 + vWorldPos.x * 0.22 + sin(vWorldPos.z * 0.09) * 2.4 + patchN * 3.0);
      float lam = smoothstep(-0.65, 0.75, foreset);
      rockAlbedo *= mix(0.86, 1.12, lam);
    } else if (uFabricMode == 3) {
      // Tafoni Honeycomb & Palagonite Hyaloclastite Pitting
      float c1 = abs(noise2D(vWorldPos.xz * 0.48 + rockY * 0.36) - 0.5) * 2.0;
      float c2 = abs(noise2D(vWorldPos.xz * 1.05 - rockY * 0.62) - 0.5) * 2.0;
      float pit = (1.0 - smoothstep(0.08, 0.40, c1 * 0.68 + c2 * 0.32)) * steepFace;
      rockAlbedo *= (1.0 - 0.38 * pit);
    } else if (uFabricMode == 4) {
      // Folded Metamorphic Gneissic Banding & Conjugate Fractures
      float fold = rockY * 0.42 + sin(vWorldPos.x * 0.06 + patchN * 5.0) * 1.8;
      float gneissBand = smoothstep(-0.55, 0.55, sin(fold * 3.1));
      rockAlbedo = mix(rockAlbedo * 0.78, rockAlbedo * 1.22 + vec3(0.03), gneissBand);
    }
    if (uLayerVis.y < 0.999) {
      rockAlbedo = mix(preFabricAlbedo, rockAlbedo, uLayerVis.y);
      bedNormal = safeNorm3(mix(preFabricNormal, bedNormal, uLayerVis.y), preFabricNormal);
    }
  }
  if (uLayerVis.x < 0.999) {
    rockAlbedo = mix(vec3(0.24, 0.23, 0.22) * (1.0 + 0.08 * grain), rockAlbedo, uLayerVis.x);
  }

  // ==========================================================================
  // CRYOSPHERE: SNOWPACK, WIND-DRIFTED SNOW COVER, CREVASSED GLACIER ICE & FIRN
  // ==========================================================================
  vec4 snowCell = isSideSkirt ? vec4(0.0) : sampleGridBilinear(uSnowTex, vUv, res);
  float snowDepth = snowCell.r;
  float iceDepth = snowCell.g;
  float snowlineY = clamp(uClimate.x, 0.02, 1.05) * max(uStrataOrient.w, 1.0);

  // Snow bridges ledges, cirques & couloirs; only sheer 58-deg+ rock ribs shed snow to bare gneiss/basalt!
  float slopeHold = 1.0 - smoothstep(0.62, 0.88, 1.0 - bedNormal.y);
  // Subtle wind-fluted sastrugi & exposed rock ribs ONLY on steep walls; broad snowfields stay rich & continuous!
  float snowPatch = mix(1.0, 0.62 + 0.38 * ridgedFbm2D(vWorldPos.xz * 0.055 + 5.3, 3, 0.5), smoothstep(0.28, 0.65, 1.0 - bedNormal.y));
  float snowCover = isSideSkirt ? 0.0
    : clamp(smoothstep(0.018, 0.32, snowDepth) * mix(0.35, 1.0, slopeHold) * snowPatch, 0.0, 1.0) * uLayerVis.z;
  float iceCover = (isSideSkirt ? 0.0 : smoothstep(0.06, 0.70, iceDepth) * mix(0.45, 1.0, slopeHold)) * uLayerVis.z;

  // Fresh snow is high-albedo; shaded snow picks up cold Himalayan sky-blue subsurface bounce!
  vec3 snowAlbedo = mix(vec3(0.56, 0.64, 0.76), vec3(0.89, 0.92, 0.97), clamp(bedNormal.y, 0.0, 1.0));
  snowAlbedo *= (1.0 + 0.04 * grain - 0.04 * patchN);
  // Glacier ice: dense blue crevassed ice with wind-scoured firn bands
  float crevasse = smoothstep(0.55, 0.95, ridgedFbm2D(vWorldPos.xz * 0.085 + vWorldPos.y * 0.02, 4, 0.55));
  vec3 iceAlbedo = mix(vec3(0.255, 0.470, 0.610), vec3(0.520, 0.760, 0.860), 1.0 - crevasse * 0.55);
  iceAlbedo = mix(iceAlbedo, vec3(0.845, 0.900, 0.940), smoothstep(0.34, 0.90, elevFrac) * 0.42);

  vec3 surfaceAlbedo = rockAlbedo;
  surfaceAlbedo = mix(surfaceAlbedo, coarseGravelCol * (1.0 + 0.15 * grain), (isSideSkirt ? 0.0 : smoothstep(0.012, 0.24, tC.g)) * 0.88);
  surfaceAlbedo = mix(surfaceAlbedo, fineAlluvialCol * (1.0 + 0.10 * patchN + 0.08 * grain), (isSideSkirt ? 0.0 : smoothstep(0.008, 0.18, tC.b)) * 0.92);
  surfaceAlbedo = mix(surfaceAlbedo, iceAlbedo, iceCover * 0.94);
  surfaceAlbedo = mix(surfaceAlbedo, snowAlbedo, snowCover * 0.97);

  float coarseMask = isSideSkirt ? 0.0 : smoothstep(0.012, 0.24, tC.g);
  float fineMask   = isSideSkirt ? 0.0 : smoothstep(0.008, 0.18, tC.b);

  // ==========================================================================
  // JOURNEY / NAMIB SAND DUNE SURFACE SHADER (Asymmetric Windward Ripples + Silky Slipfaces!)
  // ==========================================================================
  float sandRippleMask = 0.0;
  float sandCover = (!isSideSkirt && (uMaterialTheme == 6 || uMaterialTheme == 5 || uMaterialTheme == 9))
    ? smoothstep(0.04, 0.45, tC.b) * (1.0 - snowCover)
    : 0.0;
  if (sandCover > 0.01) {
    vec2 wDir = safeNorm2(uWindRender.xy, vec2(0.88, 0.47));
    vec2 cDir = vec2(-wDir.y, wDir.x);
    vec2 horizN = bedNormal.xz;
    float slopeTan = length(horizN) / max(bedNormal.y, 0.08);
    // Leeward 34-deg avalanche slipface faces WITH the wind (dot(horizN, wDir) > 0) and is steep:
    // Real avalanche slipfaces are silky smooth (ZERO wind ripples!), while gentler windward stoss
    // slopes carry crisp asymmetric wind-sculpted ripples!
    float leeSlipMask = smoothstep(0.38, 0.60, slopeTan) * smoothstep(-0.05, 0.28, dot(safeNorm2(horizN, wDir), wDir));
    sandRippleMask = sandCover * (1.0 - leeSlipMask) * smoothstep(0.02, 0.12, slopeTan + 0.06);

    // Subtle wind-sorted mineral colour shift: slightly paler coarser quartz on windward crests,
    // deeper iron-oxide terracotta-apricot on smooth avalanche slipfaces!
    vec3 stossSand = fineAlluvialCol * vec3(1.06, 1.04, 0.98);
    vec3 slipSand  = fineAlluvialCol * vec3(0.94, 0.86, 0.82);
    surfaceAlbedo = mix(surfaceAlbedo, mix(stossSand, slipSand, leeSlipMask), sandCover * 0.96);

    if (sandRippleMask > 0.01) {
      float warpR = fbm2D(vWorldPos.xz * 0.085, 2, 0.5) * 2.2;
      float rCoord1 = dot(vWorldPos.xz, wDir) * 1.55 + sin(dot(vWorldPos.xz, cDir) * 0.35 + warpR) * 0.85;
      float rCoord2 = dot(vWorldPos.xz, wDir) * 3.10 + cos(dot(vWorldPos.xz, cDir) * 0.72 - warpR) * 0.55;
      // Asymmetric wind-ripple sawtooth derivative (gentle stoss, steeper lee micro-facet!)
      float f1 = fract(rCoord1);
      float f2 = fract(rCoord2);
      float dRip1 = f1 < 0.72 ? 0.38 : -1.05;
      float dRip2 = f2 < 0.72 ? 0.22 : -0.60;
      // Fade micro-ripples cleanly with camera distance to prevent aliasing shimmer!
      float distAtten = 1.0 - smoothstep(90.0, 420.0, length(uCameraPos - vWorldPos));
      float ripStrength = (dRip1 * 0.065 + dRip2 * 0.032) * sandRippleMask * distAtten * uLayerVis.y;
      bedNormal = safeNorm3(bedNormal - vec3(wDir.x * ripStrength, 0.0, wDir.y * ripStrength), bedNormal);
    }
  }

  float wetness = isSideSkirt ? 0.0 : smoothstep(0.001, 0.025, tC.a);
  surfaceAlbedo *= mix(1.0, 0.68, wetness * 0.55 * (1.0 - snowCover));

  // Verdant Oasis Date-Palm & Reed Vegetation Belt hugging the moist groundwater shoreline!
  if (!isSideSkirt && uMaterialTheme == 9) {
    vec2 oasisUv = (vUv * 2.0 - 1.0) - vec2(-0.04, -0.03);
    float dO = length(vec2(oasisUv.x * 1.15, (oasisUv.y + 0.22 * sq(oasisUv.x * 1.8)) * 1.55));
    float canopyPatch = fbm2D(vWorldPos.xz * 0.14 + 3.7, 3, 0.55);
    float shoreBand = smoothstep(9.75, 10.15, hC) * (1.0 - smoothstep(11.6, 13.8, hC))
                    * (1.0 - smoothstep(0.24, 0.42, dO))
                    * (1.0 - smoothstep(0.005, 0.05, tC.a))
                    * smoothstep(0.45, 0.85, bedNormal.y);
    float palmMask = clamp(shoreBand * smoothstep(0.22, 0.62, canopyPatch + 0.16), 0.0, 1.0);
    vec3 oasisFoliage = mix(vec3(0.045, 0.145, 0.038), mossCol * vec3(1.22, 1.15, 0.95), canopyPatch);
    surfaceAlbedo = mix(surfaceAlbedo, oasisFoliage, palmMask * 0.92);
  }

  if (uViewMode == 1) {
    float initB = sampleGridBilinear(uInitialTex, vUv, res).r;
    float cutDepth = max(0.0, initB - tC.r);
    float sedDepth = tC.g + tC.b;
    vec3 baseNeutral = vec3(0.16, 0.165, 0.175);
    vec3 cutCol = mix(vec3(0.55, 0.16, 0.08), vec3(0.88, 0.38, 0.12), clamp(cutDepth / 8.0, 0.0, 1.0));
    vec3 sedCol = mix(vec3(0.12, 0.48, 0.42), vec3(0.82, 0.62, 0.16), tC.b / max(sedDepth, 1e-4));
    surfaceAlbedo = baseNeutral;
    surfaceAlbedo = mix(surfaceAlbedo, cutCol, smoothstep(0.04, 2.2, cutDepth));
    surfaceAlbedo = mix(surfaceAlbedo, sedCol, smoothstep(0.02, 0.65, sedDepth));
  } else if (uViewMode == 2) {
    surfaceAlbedo = mix(vec3(0.07, 0.22, 0.36), vec3(0.72, 0.44, 0.12), hardness);
  } else if (uViewMode == 3) {
    vec4 velData = sampleGridBilinear(uVelocityFieldTex, vUv, res);
    float qNorm = clamp(velData.w * 2.4 + tC.a * 3.0, 0.0, 1.0);
    surfaceAlbedo = mix(vec3(0.12, 0.13, 0.15), mix(vec3(0.06, 0.42, 0.72), vec3(0.85, 0.92, 0.98), qNorm), smoothstep(0.01, 0.65, qNorm));
  } else if (uViewMode == 4) {
    surfaceAlbedo = vec3(0.28, 0.27, 0.26);
  } else if (uViewMode == 5) {
    // Cryosphere diagnostic: snowpack (white), glacier ice (cyan), exposed bedrock (charcoal)
    surfaceAlbedo = mix(vec3(0.10, 0.105, 0.115), vec3(0.88, 0.92, 0.985), smoothstep(0.01, 0.30, snowDepth));
    surfaceAlbedo = mix(surfaceAlbedo, vec3(0.12, 0.62, 0.90), smoothstep(0.02, 0.70, iceDepth) * 0.92);
  } else if (uViewMode == 6) {
    // 2.5D Shallow-Water Rivers, Hydrostatic Lakes & Ice-Melt Recharge Diagnostic
    vec4 velData = sampleGridBilinear(uVelocityFieldTex, vUv, res);
    vec3 dryBase = mix(vec3(0.14, 0.145, 0.155), vec3(0.26, 0.25, 0.24), clamp(elevFrac, 0.0, 1.0));
    vec3 meltZone = mix(dryBase, vec3(0.55, 0.78, 0.92), smoothstep(0.02, 0.45, snowDepth + iceDepth) * 0.55);
    vec3 shallowRiver = vec3(0.10, 0.68, 0.78);
    vec3 deepLake = vec3(0.03, 0.22, 0.58);
    float wMask = smoothstep(0.006, 0.06, tC.a);
    vec3 hydroCol = mix(shallowRiver, deepLake, smoothstep(0.12, 2.2, tC.a));
    hydroCol += vec3(0.35, 0.42, 0.45) * clamp(velData.z * 0.45, 0.0, 0.65);
    surfaceAlbedo = mix(meltZone, hydroCol, wMask);
  } else if (uViewMode == 7) {
    // Active Layer B&W Mask Diagnostic (0 = black unmasked, 1 = white active mask)
    float maskVal = clamp(sampleGridBilinear(uMaskPreviewTex, vUv, res).r, 0.0, 1.0);
    surfaceAlbedo = mix(vec3(0.030, 0.032, 0.036), vec3(0.95, 0.96, 0.98), maskVal);
  } else if (uViewMode == 8) {
    // Ambient Occlusion & Ridge Protrusion Diagnostic
    vec3 cavityCol = vec3(0.055, 0.060, 0.070) * ao;
    vec3 crestCol = vec3(0.86, 0.72, 0.46);
    surfaceAlbedo = mix(cavityCol + vec3(0.24) * ao, crestCol, clamp(ridgeConvex * 1.15, 0.0, 1.0));
  }

  vec3 L = safeNorm3(uSunDir, vec3(0.4, 0.8, 0.4));
  vec3 V = safeNorm3(uCameraPos - vWorldPos, vec3(0.0, 1.0, 0.0));
  float shadow = isSideSkirt ? 0.65 : sampleTerrainShadow(vUv, hC + 0.18, L, span, res);
  float ndotl = max(0.0, dot(bedNormal, L));

  // Warm Oren-Nayar backscatter + golden backlit rim-sheen on desert sand dunes!
  float diffuseTerm = sandCover > 0.02 ? mix(ndotl, pow(max(0.0, ndotl), 0.86) * 1.06, sandCover) : ndotl;
  vec3 sunColor = uMaterialTheme == 7
    ? vec3(2.65, 2.62, 2.58) // Unfiltered solar spectrum in lunar vacuum!
    : ((uMaterialTheme == 6 || uMaterialTheme == 9) ? vec3(2.48, 2.16, 1.82) : vec3(2.35, 2.20, 1.98));
  vec3 sunRadiance = sunColor * diffuseTerm * shadow;
  float skyHemi = 0.5 + 0.5 * bedNormal.y;
  vec3 groundBounce = (uMaterialTheme == 1 || uMaterialTheme == 4 || uMaterialTheme == 8)
    ? vec3(0.085, 0.095, 0.100)
    : (uMaterialTheme == 2 ? vec3(0.130, 0.150, 0.185)
    : ((uMaterialTheme == 6 || uMaterialTheme == 9) ? vec3(0.145, 0.095, 0.108) : vec3(0.18, 0.15, 0.13)));
  vec3 skyTopAmb = (uMaterialTheme == 6 || uMaterialTheme == 9) ? vec3(0.28, 0.33, 0.48) : vec3(0.36, 0.44, 0.56);
  vec3 ambient = mix(groundBounce, skyTopAmb, skyHemi) * (sandCover > 0.02 ? mix(ao, 1.0, sandCover * 0.55) : ao);
  if (uMaterialTheme == 7) {
    // Airless Moon: crisp high-contrast vacuum shadows with subtle regolith bounce & Earthshine!
    ambient = mix(vec3(0.024, 0.025, 0.030), vec3(0.048, 0.055, 0.072), skyHemi) * ao;
  } else {
    ambient = mix(ambient, vec3(0.42, 0.52, 0.68) * ao, max(snowCover * 0.72, iceCover * 0.55));
  }

  vec3 litColor = surfaceAlbedo * (sunRadiance + ambient);

  // Journey-style grazing warm sand sheen + subtle quartz micro-glitter on sunlit sand crests!
  if (sandCover > 0.02) {
    float graze = pow(max(0.0, 1.0 - clamp(dot(bedNormal, V), 0.0, 1.0)), 3.2);
    float forwardSun = pow(max(0.0, dot(-L, V) * 0.5 + 0.5), 2.0);
    litColor += vec3(0.32, 0.18, 0.08) * graze * (0.35 + 0.65 * forwardSun) * shadow * sandCover;
    float sparkHash = hash12(floor(vWorldPos.xz * 7.5));
    float spark = step(0.992, sparkHash) * shadow * ndotl * (1.0 - smoothstep(60.0, 240.0, length(uCameraPos - vWorldPos)));
    litColor += vec3(0.55, 0.44, 0.30) * spark * sandCover;
  }

  // Glossy specular sheen off glacier ice & wet snow surfaces
  if (iceCover > 0.02 || snowCover > 0.02) {
    vec3 Hs = safeNorm3(L + V, vec3(0.0, 1.0, 0.0));
    float specCryo = pow(max(1e-5, dot(bedNormal, Hs)), 42.0) * shadow;
    litColor += vec3(0.42, 0.58, 0.72) * specCryo * (iceCover * 0.55 + snowCover * 0.16);
  }

  if (!isSideSkirt && uRenderDomain.z > 0.5 && uViewMode == 0 && tC.a > 0.004) {
    float wDepth = tC.a;
    vec4 flowD = sampleGridBilinear(uVelocityFieldTex, vUv, res);
    float tSec = uRenderDomain.w;

    vec2 wUv = vWorldPos.xz * 0.42 - flowD.xy * tSec * 0.35;
    float ripX = noise2D(wUv * 2.1 + vec2(tSec * 0.6, 0.0)) - noise2D(wUv * 2.1 - vec2(tSec * 0.6, 0.0));
    float ripZ = noise2D(wUv * 2.3 + vec2(0.0, tSec * 0.5)) - noise2D(wUv * 2.3 - vec2(0.0, tSec * 0.5));

    float wH_R = hR + (tR.a > 0.003 ? tR.a : 0.0);
    float wH_L = hL + (tL.a > 0.003 ? tL.a : 0.0);
    float wH_U = hU + (tU.a > 0.003 ? tU.a : 0.0);
    float wH_D = hD + (tD.a > 0.003 ? tD.a : 0.0);
    vec3 waterN = safeNorm3(vec3(wH_L - wH_R + ripX * 0.08, 2.0 * cellSize, wH_D - wH_U + ripZ * 0.08), vec3(0.0, 1.0, 0.0));

    float turbidity = clamp(flowD.z * 0.35 + fineMask * 0.45, 0.0, 1.0);
    // Deep 2.5D hydrostatic lakes, Oasis emerald lagoons & Studlagil glacial-flour turquoise rivers!
    vec3 clearWaterCol = uMaterialTheme == 4
      ? vec3(0.05, 0.36, 0.40) // Studlagil milky glacial-flour turquoise!
      : (uMaterialTheme == 9
          ? mix(vec3(0.04, 0.38, 0.34), vec3(0.015, 0.18, 0.24), smoothstep(0.25, 2.8, wDepth)) // Crystal-emerald desert oasis!
          : mix(vec3(0.04, 0.24, 0.32), vec3(0.02, 0.14, 0.26), smoothstep(0.35, 3.0, wDepth)));
    vec3 waterTint = mix(clearWaterCol, vec3(0.24, 0.22, 0.15), turbidity * 0.55 * (1.0 - smoothstep(0.4, 2.0, wDepth)));

    float absorb = 1.0 - exp(-wDepth * 2.6);
    float waterAlpha = smoothstep(0.004, 0.045, wDepth) * uLayerVis.w;
    float oneMinusNdotV = max(0.0, 1.0 - clamp(dot(waterN, V), 0.0, 1.0));
    float fresnel = 0.04 + 0.62 * sq(sq(oneMinusNdotV));
    vec3 skyReflect = mix(vec3(0.22, 0.30, 0.40), vec3(0.55, 0.66, 0.80), clamp(waterN.y, 0.0, 1.0));

    vec3 H = safeNorm3(L + V, vec3(0.0, 1.0, 0.0));
    float spec = pow(max(1e-5, dot(waterN, H)), 96.0) * 1.35 * shadow;
    float shoreFoam = (1.0 - smoothstep(0.02, 0.16, wDepth)) * smoothstep(0.015, 0.05, wDepth) * 0.45;
    float foam = (smoothstep(0.55, 1.8, flowD.z) + shoreFoam) * (0.35 + 0.35 * noise2D(wUv * 4.5 + tSec));

    vec3 submerged = mix(litColor, waterTint * (sunRadiance * 0.55 + ambient * 1.15), clamp(absorb * 0.85 + 0.18, 0.0, 0.94));
    vec3 waterCol = mix(submerged, skyReflect, fresnel * 0.68) + vec3(spec) + vec3(0.55, 0.58, 0.60) * foam * 0.35;
    litColor = mix(litColor, waterCol, waterAlpha);
  }

  if (!isSideSkirt && uBrush.z > 0.5 && abs(uBrush.w) > 0.1) {
    float bDist = length(vWorldPos.xz - uBrush.xy);
    float ring = 1.0 - smoothstep(0.0, cellSize * 1.8, abs(bDist - uBrush.z));
    vec3 ringCol = abs(uBrush.w) < 1.5 ? vec3(0.25, 0.72, 1.0) : vec3(1.0, 0.62, 0.20);
    litColor = mix(litColor, ringCol, ring * 0.75);
  }

  float camDist = length(uCameraPos - vWorldPos);
  if (uMaterialTheme != 7) {
    float fog = 1.0 - exp(-max(0.0, camDist - span * 0.55) * 0.0009);
    litColor = mix(litColor, vec3(0.045, 0.055, 0.070), clamp(fog, 0.0, 0.45));
  }

  vec3 x = max(vec3(0.0), litColor);
  vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  outColor = vec4(pow(max(vec3(1e-6), clamp(mapped, 0.0, 1.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

export const PARTICLE_RENDER_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}

uniform sampler2D uPosAgeTex;
uniform sampler2D uVelWaterTex;
uniform sampler2D uSedimentTex;
uniform sampler2D uTerrainTex;

uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform vec4 uPartVis; // (worldSpan, gridRes, opacity, activeCount)

out vec2 vQuadUv;
out vec4 vColor;

void main() {
  int slotId = gl_InstanceID;
  if (float(slotId) >= uPartVis.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    vQuadUv = vec2(0.0);
    return;
  }

  const vec2 corners[6] = vec2[6](
    vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0),
    vec2(-1.0, -1.0), vec2( 1.0,  1.0), vec2(-1.0,  1.0)
  );
  vec2 corner = corners[gl_VertexID % 6];
  vQuadUv = corner;

  ivec2 coord = ivec2(slotId % 256, slotId / 256);
  vec4 posAge = texelFetch(uPosAgeTex, coord, 0);
  vec4 velW = texelFetch(uVelWaterTex, coord, 0);
  vec4 sed = texelFetch(uSedimentTex, coord, 0);

  vec3 pos = posAge.xyz;
  bool isAirborne = posAge.w < 0.0;

  // 0 = rain, 1 = snow, 2 = aeolian sand, 3 = rockfall boulder
  int species = int(sed.w + 0.5);

  if (!isAirborne) {
    vec2 uv = pos.xz / uPartVis.x + 0.5;
    ivec2 tc = clamp(ivec2(uv * (uPartVis.y - 1.0) + 0.5), ivec2(0), ivec2(int(uPartVis.y) - 1));
    vec4 terr = texelFetch(uTerrainTex, tc, 0);
    pos.y = terr.r + terr.g + terr.b + terr.a + (species == 1 ? 0.22 : 0.55);
  }

  vec3 diffCam = uCameraPos - pos;
  float dc2 = dot(diffCam, diffCam);
  vec3 toCam = dc2 > 1e-6 ? diffCam * inversesqrt(dc2) : vec3(0.0, 1.0, 0.0);

  float vl2 = dot(velW.xyz, velW.xyz);
  vec3 velDir = vl2 > 0.0025 ? velW.xyz * inversesqrt(vl2) : vec3(0.0, -1.0, 0.0);

  vec3 sideRaw = cross(toCam, velDir);
  float sl2 = dot(sideRaw, sideRaw);
  vec3 side = sl2 > 1e-6 ? sideRaw * inversesqrt(sl2) : vec3(1.0, 0.0, 0.0);

  vec3 upRaw = cross(side, toCam);
  float ul2 = dot(upRaw, upRaw);
  vec3 upAlong = ul2 > 1e-6 ? upRaw * inversesqrt(ul2) : vec3(0.0, 1.0, 0.0);

  float width;
  float lengthStretch;
  if (species == 1) {
    // Snowflakes: soft, near-spherical, slightly larger than raindrops, no velocity streaks
    width = isAirborne ? 0.58 : 0.40;
    lengthStretch = isAirborne ? 0.62 : 0.55;
  } else if (species == 2) {
    width = 0.26;
    lengthStretch = isAirborne ? 1.4 : 0.9;
  } else if (species == 3) {
    width = 0.72;
    lengthStretch = 0.85;
  } else {
    width = isAirborne ? 0.34 : (0.55 + 0.45 * clamp(velW.w, 0.0, 1.5));
    lengthStretch = isAirborne ? 3.4 : (0.85 + 0.22 * clamp(length(velW.xz), 0.0, 10.0));
  }

  vec3 worldVert = pos + side * (corner.x * width) + upAlong * (corner.y * lengthStretch);
  gl_Position = uViewProj * vec4(worldVert, 1.0);

  if (isAirborne) {
    vec3 airTint;
    float airAlpha;
    if (species == 1) {
      airTint = vec3(0.90, 0.95, 1.0);
      airAlpha = uPartVis.z * 0.72;
    } else if (species == 2) {
      airTint = vec3(0.72, 0.62, 0.48);
      airAlpha = uPartVis.z * 0.34;
    } else if (species == 3) {
      airTint = vec3(0.62, 0.60, 0.56);
      airAlpha = uPartVis.z * 0.66;
    } else {
      airTint = vec3(0.62, 0.84, 1.0);
      airAlpha = uPartVis.z * 0.52;
    }
    vColor = vec4(airTint, airAlpha);
  } else {
    vec3 c;
    float alpha;
    if (species == 1) {
      c = vec3(0.93, 0.96, 1.0);
      alpha = uPartVis.z * 0.62 * clamp(sed.x * 2.2 + 0.25, 0.25, 1.0);
    } else if (species == 2) {
      c = vec3(0.80, 0.68, 0.46);
      alpha = uPartVis.z * 0.42 * clamp(sed.x * 3.0 + 0.25, 0.2, 1.0);
    } else if (species == 3) {
      c = vec3(0.66, 0.62, 0.56);
      alpha = uPartVis.z * 0.80 * clamp(sed.x * 2.0 + 0.35, 0.3, 1.0);
    } else {
      float totalLoad = sed.x + sed.y;
      float sedRatio = clamp(totalLoad * 8.5, 0.0, 1.0);
      float fineShare = sed.y / max(totalLoad, 1e-5);
      vec3 sedTint = mix(vec3(0.86, 0.68, 0.38), vec3(0.95, 0.56, 0.22), fineShare);
      c = mix(vec3(0.24, 0.78, 1.0), sedTint, sedRatio);
      alpha = uPartVis.z * 0.78 * clamp(velW.w * 1.4, 0.15, 1.0);
    }
    vColor = vec4(c, alpha);
  }
}
`;

export const PARTICLE_RENDER_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec2 vQuadUv;
in vec4 vColor;
layout(location = 0) out vec4 outColor;

void main() {
  float r2 = dot(vQuadUv, vQuadUv);
  if (r2 > 1.0) discard;
  float soft = pow(max(1e-5, 1.0 - r2), 1.4);
  outColor = vec4(vColor.rgb, vColor.a * soft);
}
`;

export const SKY_BG_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outColor;

uniform int uMaterialTheme;

void main() {
  if (uMaterialTheme == 7) {
    // Airless Lunar vacuum sky: deep space black with subtle pinpoint starfield!
    vec2 starCell = floor(vUv * vec2(320.0, 180.0));
    vec2 starF = fract(vUv * vec2(320.0, 180.0)) - 0.5;
    float h = fract(sin(dot(starCell, vec2(127.1, 311.7))) * 43758.5453);
    float star = h > 0.991 ? exp(-dot(starF, starF) * 28.0) * (0.35 + 0.65 * fract(h * 97.3)) : 0.0;
    vec3 spaceCol = vec3(0.007, 0.009, 0.014) + vec3(0.88, 0.92, 1.0) * star;
    outColor = vec4(spaceCol, 1.0);
    return;
  }
  vec3 topCol = vec3(0.065, 0.082, 0.108);
  vec3 horCol = vec3(0.125, 0.145, 0.175);
  vec3 c = mix(horCol, topCol, pow(max(1e-5, clamp(vUv.y, 0.0, 1.0)), 0.75));
  outColor = vec4(c, 1.0);
}
`;

export const ROCK_INSTANCE_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aMask;        // (ao, cavity, edge, localY)
layout(location = 3) in vec4 aInstCol0;    // (rightScaled.xyz, seedHash)
layout(location = 4) in vec4 aInstCol1;    // (upScaled.xyz, wear)
layout(location = 5) in vec4 aInstCol2;    // (fwdScaled.xyz, radiusY)
layout(location = 6) in vec4 aInstPosMeta; // (worldX, airLift, worldZ, isOutcrop)

uniform sampler2D uTerrainTex;
uniform sampler2D uSnowTex;
uniform mat4 uViewProj;
uniform vec4 uRenderDomain; // (worldSpan, gridRes, showWater, timeSec)
uniform vec4 uLayerVis;     // (lithologyOpacity, fabricStrength, snowVisOpacity, waterVisOpacity)

out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec4 vMask;
out vec3 vInstMeta; // (seedHash, wear, isOutcrop)

float sampleSurfaceAtXZ(vec2 xz, float span, float res, float snowVis) {
  vec2 uv = clamp(xz / max(span, 1.0) + 0.5, vec2(0.001), vec2(0.999));
  vec2 grid = uv * (res - 1.0);
  ivec2 i0 = ivec2(floor(grid));
  vec2 f = fract(grid);
  int maxI = int(res) - 1;
  ivec2 i00 = clamp(i0, ivec2(0), ivec2(maxI));
  ivec2 i10 = clamp(i0 + ivec2(1, 0), ivec2(0), ivec2(maxI));
  ivec2 i01 = clamp(i0 + ivec2(0, 1), ivec2(0), ivec2(maxI));
  ivec2 i11 = clamp(i0 + ivec2(1, 1), ivec2(0), ivec2(maxI));

  vec4 t00 = texelFetch(uTerrainTex, i00, 0);
  vec4 t10 = texelFetch(uTerrainTex, i10, 0);
  vec4 t01 = texelFetch(uTerrainTex, i01, 0);
  vec4 t11 = texelFetch(uTerrainTex, i11, 0);
  vec4 terr = mix(mix(t00, t10, f.x), mix(t01, t11, f.x), f.y);

  vec4 s00 = texelFetch(uSnowTex, i00, 0);
  vec4 s10 = texelFetch(uSnowTex, i10, 0);
  vec4 s01 = texelFetch(uSnowTex, i01, 0);
  vec4 s11 = texelFetch(uSnowTex, i11, 0);
  vec4 cryo = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);

  float cryoLift = min(3.4, cryo.r * 0.85 + cryo.g * 0.62) * snowVis;
  return terr.r + terr.g + terr.b + cryoLift;
}

void main() {
  mat3 M = mat3(aInstCol0.xyz, aInstCol1.xyz, aInstCol2.xyz);
  float span = uRenderDomain.x;
  float res = uRenderDomain.y;
  vec2 centerXZ = aInstPosMeta.xz;
  float airLift = max(0.0, aInstPosMeta.y);
  float radiusY = max(0.25, aInstCol2.w);
  bool isOutcrop = aInstPosMeta.w > 0.5;

  // Sample exact 512x512 GPU terrain + snow across the rock footprint so rocks NEVER sink under
  // sub-8m ridges, dunes, or snowdrifts that were smoothed out in the 64x64 CPU telemetry grid!
  float rFoot = min(3.2, 0.50 * max(length(aInstCol0.xyz), length(aInstCol2.xyz)));
  float hC = sampleSurfaceAtXZ(centerXZ, span, res, uLayerVis.z);
  float hE = sampleSurfaceAtXZ(centerXZ + vec2(rFoot, 0.0), span, res, uLayerVis.z);
  float hW = sampleSurfaceAtXZ(centerXZ - vec2(rFoot, 0.0), span, res, uLayerVis.z);
  float hN = sampleSurfaceAtXZ(centerXZ + vec2(0.0, rFoot), span, res, uLayerVis.z);
  float hS = sampleSurfaceAtXZ(centerXZ - vec2(0.0, rFoot), span, res, uLayerVis.z);
  float hFoot = max(hC, 0.55 * hC + 0.45 * max(max(hE, hW), max(hN, hS)));

  float centerY = hFoot + radiusY * (isOutcrop ? 0.36 : 0.48) + airLift;
  vec3 wp = M * aPos + vec3(centerXZ.x, centerY, centerXZ.y);

  // Cofactor / inverse-transpose for non-uniform rock scaling so facet normals stay exact!
  vec3 nWorld = cross(M[1], M[2]) * aNormal.x
              + cross(M[2], M[0]) * aNormal.y
              + cross(M[0], M[1]) * aNormal.z;
  float nl = length(nWorld);
  vWorldNormal = nl > 1e-6 ? (nWorld / nl) : vec3(0.0, 1.0, 0.0);
  vWorldPos = wp;
  vMask = aMask;
  vInstMeta = vec3(aInstCol0.w, aInstCol1.w, aInstPosMeta.w);
  gl_Position = uViewProj * vec4(wp, 1.0);
}
`;

export const ROCK_INSTANCE_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec4 vMask;
in vec3 vInstMeta;

layout(location = 0) out vec4 outColor;

uniform sampler2D uTerrainTex;
uniform sampler2D uSnowTex;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec4 uRenderDomain;   // (worldSpan, gridRes, showWater, timeSec)
uniform vec4 uHardnessParams; // (rockHardness, strataStrength, strataFreq, faultWeakness)
uniform vec4 uStrataOrient;   // (sinStrike, cosStrike, tanDip, reliefScale)
uniform vec4 uClimate;        // (snowlineNorm, snowfallRate, glacierStrength, meltRate)
uniform int uViewMode;
uniform int uMaterialTheme;
uniform int uFabricMode;
uniform float uSeed;

${COMMON_GEOLOGY_GLSL}

void main() {
  float span = uRenderDomain.x;
  float res = uRenderDomain.y;
  vec3 N = safeNorm3(vWorldNormal, vec3(0.0, 1.0, 0.0));

  vec2 uv = clamp(vWorldPos.xz / span + 0.5, vec2(0.001), vec2(0.999));
  vec4 tCell = sampleGridBilinear(uTerrainTex, uv, res);
  vec4 snowCell = sampleGridBilinear(uSnowTex, uv, res);
  float groundH = tCell.r + tCell.g + tCell.b;

  float hardness = evalRockHardness3D(vWorldPos + vec3(vInstMeta.x * 19.0, 0.0, 0.0), uHardnessParams, uStrataOrient, uSeed);
  float grain = noise2D(vWorldPos.xz * 1.15 + vWorldPos.y * 0.85 + vInstMeta.x * 31.0) - 0.5;

  vec3 softCol;
  vec3 hardCol;
  vec3 mossCol = vec3(0.11, 0.16, 0.055);
  if (uMaterialTheme == 1 || uMaterialTheme == 4 || uMaterialTheme == 8) {
    softCol = vec3(0.058, 0.060, 0.066);
    hardCol = uMaterialTheme == 4 ? vec3(0.185, 0.125, 0.090) : vec3(0.165, 0.122, 0.092);
    if (uMaterialTheme == 8) mossCol = vec3(0.115, 0.245, 0.048);
  } else if (uMaterialTheme == 2) {
    softCol = vec3(0.125, 0.120, 0.126);
    hardCol = vec3(0.310, 0.286, 0.274);
  } else if (uMaterialTheme == 3) {
    softCol = vec3(0.285, 0.115, 0.078);
    hardCol = vec3(0.455, 0.365, 0.258);
  } else if (uMaterialTheme == 5 || uMaterialTheme == 6 || uMaterialTheme == 9) {
    softCol = vec3(0.185, 0.120, 0.088);
    hardCol = vec3(0.410, 0.285, 0.178);
  } else if (uMaterialTheme == 7) {
    // Lunar ejecta & anorthosite breccia boulders!
    softCol = vec3(0.125, 0.128, 0.136);
    hardCol = vec3(0.310, 0.314, 0.324);
  } else {
    softCol = vec3(0.165, 0.095, 0.075);
    hardCol = vec3(0.375, 0.285, 0.198);
  }

  vec3 albedo = mix(softCol, hardCol, clamp(hardness * 0.85 + vInstMeta.x * 0.25, 0.0, 1.0));
  albedo *= (1.0 + 0.14 * grain + 0.08 * vMask.z - 0.14 * vMask.y);

  if (uFabricMode == 1) {
    float seam = 1.0 - smoothstep(0.02, 0.12, abs(fract(vWorldPos.x * 0.55 + vWorldPos.z * 0.42) - 0.5));
    albedo *= (1.0 - 0.26 * seam);
  } else if (uFabricMode == 2) {
    float lam = smoothstep(-0.6, 0.75, sin(vWorldPos.y * 2.1 + vWorldPos.x * 0.35 + vInstMeta.x * 6.0));
    albedo *= mix(0.86, 1.12, lam);
  } else if (uFabricMode == 3) {
    float pit = 1.0 - smoothstep(0.08, 0.38, abs(noise2D(vWorldPos.xz * 0.9 + vWorldPos.y * 0.7) - 0.5) * 2.0);
    albedo *= (1.0 - 0.30 * pit);
  } else if (uFabricMode == 4) {
    float band = smoothstep(-0.5, 0.5, sin(vWorldPos.y * 1.4 + sin(vWorldPos.x * 0.25) * 2.0));
    albedo = mix(albedo * 0.80, albedo * 1.20, band);
  }

  // Icelandic moss on upward-facing settled boulders & damp outcrops
  if ((uMaterialTheme == 1 || uMaterialTheme == 4 || uMaterialTheme == 8) && N.y > 0.45) {
    float elevFrac = clamp(vWorldPos.y / max(uStrataOrient.w, 1.0), 0.0, 1.2);
    float moss = smoothstep(0.45, 0.85, N.y) * (1.0 - smoothstep(0.44, 0.78, elevFrac)) * (uMaterialTheme == 8 ? 0.78 : 0.55);
    albedo = mix(albedo, mossCol, moss);
  }

  // Snowpack frosting on upward-facing boulder crowns above snowline
  float snowlineY = clamp(uClimate.x, 0.02, 1.05) * max(uStrataOrient.w, 1.0);
  float snowCoat = smoothstep(0.48, 0.84, N.y)
    * smoothstep(0.05, 0.45, snowCell.r + max(0.0, vWorldPos.y - snowlineY) * 0.04);
  albedo = mix(albedo, vec3(0.84, 0.88, 0.94), snowCoat * 0.90);

  // Shoreline & rain wetness darkening near boulder base
  float hAboveGround = max(0.0, vWorldPos.y - groundH);
  float wetBase = smoothstep(0.01, 0.08, tCell.a) * (1.0 - smoothstep(0.0, 1.4, hAboveGround));
  albedo *= mix(1.0, 0.62, wetBase * (1.0 - snowCoat));

  if (uViewMode == 4) {
    albedo = vec3(0.28, 0.27, 0.26);
  } else if (uViewMode == 2) {
    albedo = mix(vec3(0.07, 0.22, 0.36), vec3(0.72, 0.44, 0.12), hardness);
  }

  // Ground-contact ambient occlusion at boulder-terrain interface + raymarched terrain sun shadow!
  float contactAo = mix(0.45, 1.0, smoothstep(0.0, 1.35, hAboveGround));
  float ao = vMask.x * contactAo;

  vec3 L = safeNorm3(uSunDir, vec3(0.4, 0.8, 0.4));
  vec3 V = safeNorm3(uCameraPos - vWorldPos, vec3(0.0, 1.0, 0.0));
  float ndotl = max(0.0, dot(N, L));

  // Raymarch terrain heightfield along sun ray so rocks inside gorges/shadows match cliff shadows!
  float rockShadow = 1.0;
  vec2 stepUv = L.xz / max(span, 1.0);
  float stepY = max(0.02, L.y);
  for (int i = 1; i <= 10; i++) {
    float distM = float(i * i) * 1.35;
    vec2 sUv = uv + stepUv * distM;
    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) break;
    vec4 ts = sampleGridBilinear(uTerrainTex, sUv, res);
    float occH = ts.r + ts.g + ts.b;
    float rayH = vWorldPos.y + 0.35 + stepY * distM;
    if (occH > rayH) {
      rockShadow = min(rockShadow, clamp(1.0 - (occH - rayH) * 0.14, 0.18, 1.0));
    }
  }

  vec3 H = safeNorm3(L + V, vec3(0.0, 1.0, 0.0));
  float spec = pow(max(1e-5, dot(N, H)), 28.0) * 0.08 * rockShadow * ndotl;

  vec3 sunRad = (uMaterialTheme == 7 ? vec3(2.65, 2.62, 2.58) : vec3(2.35, 2.20, 1.98)) * ndotl * rockShadow;
  vec3 amb = uMaterialTheme == 7
    ? mix(vec3(0.025, 0.026, 0.032), vec3(0.050, 0.056, 0.072), 0.5 + 0.5 * N.y) * ao
    : mix(vec3(0.14, 0.13, 0.13), vec3(0.36, 0.44, 0.56), 0.5 + 0.5 * N.y) * ao;
  vec3 lit = albedo * (sunRad + amb) + vec3(spec);

  float camDist = length(uCameraPos - vWorldPos);
  if (uMaterialTheme != 7) {
    float fog = 1.0 - exp(-max(0.0, camDist - span * 0.55) * 0.0009);
    lit = mix(lit, vec3(0.045, 0.055, 0.070), clamp(fog, 0.0, 0.45));
  }

  vec3 x = max(vec3(0.0), lit);
  vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  outColor = vec4(pow(max(vec3(1e-6), clamp(mapped, 0.0, 1.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

export const PROCEDURAL_MODIFIER_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}
in vec2 vUv;
layout(location = 0) out vec4 outTerrain;

uniform sampler2D uTerrainTex;
uniform vec4 uModShape;  // (amplitude, scale, detail, angleDeg)
uniform vec4 uModBlend;  // (strength, blendMode, maskType, seed)
uniform vec4 uModMask;   // (maskLow, maskHigh, maskInvert, reliefRef)
uniform float uWorldSpan;
uniform float uGridRes;

${COMMON_GEOLOGY_GLSL}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int maxI = int(uGridRes) - 1;
  vec4 tC = texelFetch(uTerrainTex, c, 0);

  int kind = int(uModMask.w + 0.5);
  int blendMode = int(uModBlend.y + 0.5);
  int maskType = int(uModBlend.z + 0.5);
  float strength = uModBlend.x;
  float seed = uModBlend.w;

  vec2 p = vUv * 2.0 - 1.0;
  vec2 seedVec = vec2(fract(seed * 0.0137) * 53.0, fract(seed * 0.0293) * 71.0);
  float amp = uModShape.x;
  float freq = max(0.35, uModShape.y);
  float detail = clamp(uModShape.z, 0.05, 0.98);
  float ang = uModShape.w * 0.01745329;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);

  vec2 warp = vec2(
    fbm2D(p * 1.6 + seedVec, 3, 0.52) - 0.5,
    fbm2D(p * 1.6 + seedVec + vec2(17.1, 31.4), 3, 0.52) - 0.5
  ) * 0.36;
  vec2 wp = p + warp;

  float deltaBed = 0.0;
  float deltaFine = 0.0;

  if (kind == 0) {
    // Ridge & Horn Uplift
    vec2 rotP = vec2(dot(wp, dir), dot(wp, perp));
    float spineA = ridgedFbm2D(rotP * vec2(freq * 0.85, freq * 1.35) + seedVec, 5, detail);
    float spineB = ridgedFbm2D(rotP.yx * (freq * 1.15) + seedVec + 11.4, 4, detail);
    deltaBed = pow(max(0.0, 0.62 * spineA + 0.38 * spineA * spineB), 1.35) * amp;
  } else if (kind == 1) {
    // Continental Massif & Plateau
    float raw = fbm2D(wp * freq + seedVec, 5, 0.54);
    float plat = 1.0 - pow(max(0.0, 1.0 - raw), 3.0);
    deltaBed = mix(raw, plat, detail) * amp;
  } else if (kind == 2) {
    // Tectonic Fault Escarpment
    float across = dot(p, dir) + 0.16 * (fbm2D(p * freq + seedVec, 3, 0.5) - 0.5);
    float stepUp = smoothstep(-0.22 * (1.15 - detail), 0.22 * (1.15 - detail), across);
    deltaBed = stepUp * (0.72 + 0.28 * ridgedFbm2D(wp * (freq * 1.4) + seedVec, 4, 0.52)) * amp;
  } else if (kind == 3) {
    // Strata Terrace Package
    float bedH = max(4.0, 48.0 / freq);
    float dipShift = dot(p * (0.5 * uWorldSpan), dir) * tan(detail * 0.45);
    float zStrat = (tC.r + dipShift) / bedH;
    float f = fract(zStrat);
    float stepped = (floor(zStrat) + smoothstep(0.5 - 0.35 * (1.0 - detail), 0.5 + 0.35 * (1.0 - detail), f)) * bedH - dipShift;
    deltaBed = (stepped - tC.r) * clamp(amp / 80.0, 0.0, 1.5);
  } else if (kind == 4) {
    // Aeolian Sand Dune Field (writes to fine sand layer!)
    float u = dot(p, dir) * freq * 2.2 + 0.28 * sin(dot(p, perp) * freq * 2.6 + seed * 0.01);
    float f = fract(u);
    float duneProf = f < 0.72 ? sq(f / 0.72) : max(0.0, 1.0 - (f - 0.72) / 0.28);
    deltaFine = duneProf * amp * 0.45;
  } else if (kind == 5) {
    // Impact Crater Field
    vec2 cell = floor((p * freq * 1.8) + seedVec);
    vec2 f = fract((p * freq * 1.8) + seedVec) - 0.5;
    vec3 rnd = hash32(cell);
    float d = length(f - (rnd.xy - 0.5) * 0.36) / max(0.14, 0.34 * detail);
    if (d < 1.0) {
      deltaBed = -amp * 0.55 * (1.0 - d * d) + amp * 0.14 * smoothstep(0.70, 1.0, d);
    } else if (d < 2.2) {
      deltaBed = amp * 0.14 * exp(-(d - 1.0) * 3.2);
    }
  }

  // Channel masking (0 = None, 1 = Normalized Height, 2 = Slope)
  float maskW = 1.0;
  if (maskType > 0) {
    float val = 0.0;
    if (maskType == 1) {
      val = clamp((tC.r + tC.g + tC.b) / 180.0, 0.0, 1.0);
    } else {
      vec4 tR = texelFetch(uTerrainTex, ivec2(min(maxI, c.x + 1), c.y), 0);
      vec4 tL = texelFetch(uTerrainTex, ivec2(max(0, c.x - 1), c.y), 0);
      vec4 tU = texelFetch(uTerrainTex, ivec2(c.x, min(maxI, c.y + 1)), 0);
      vec4 tD = texelFetch(uTerrainTex, ivec2(c.x, max(0, c.y - 1)), 0);
      float cellSz = uWorldSpan / max(1.0, uGridRes - 1.0);
      vec2 grad = vec2((tR.r - tL.r), (tU.r - tD.r)) / (2.0 * cellSz);
      val = clamp(length(grad) / 1.5, 0.0, 1.0);
    }
    maskW = smoothstep(uModMask.x, max(uModMask.x + 0.02, uModMask.y), val);
    if (uModMask.z > 0.5) maskW = 1.0 - maskW;
  }

  float w = clamp(strength * maskW, 0.0, 1.5);
  float nextBed = tC.r;
  if (blendMode == 0) {
    nextBed = max(1.0, tC.r + deltaBed * w);
  } else if (blendMode == 1) {
    nextBed = max(1.0, tC.r - abs(deltaBed) * w);
  } else if (blendMode == 2) {
    nextBed = mix(tC.r, max(tC.r, 8.0 + deltaBed), clamp(w, 0.0, 1.0));
  } else {
    nextBed = mix(tC.r, max(1.0, 8.0 + deltaBed), clamp(w, 0.0, 1.0));
  }
  float nextFine = max(0.0, tC.b + deltaFine * w);

  outTerrain = vec4(nextBed, tC.g, nextFine, tC.a);
}
`;

export const GRASS_INSTANCE_VERT = `#version 300 es
${GLSL_PRECISION_HEADER}

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aBladeMeta; // (tAlong [0..1], bladeHash [0..1])

uniform sampler2D uTerrainTex;
uniform sampler2D uSnowTex;
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform vec4 uRenderDomain; // (worldSpan, gridRes, showWater, timeSec)
uniform vec4 uGrassParams;  // (tuftCount, bladeHeight, windSway, slopeMaxTan)
uniform vec4 uGrassStyle;   // (grassMode, dryBlend, elevMax, patchiness)
uniform vec4 uWindRender;   // (windX, windZ, windSpeed, dryAeolianMode)
uniform vec4 uStrataOrient; // (sinStrike, cosStrike, tanDip, reliefScale)
uniform float uSeed;

out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vGrassFactors; // (bladeT, dryAmount, tuftVar)

${COMMON_GEOLOGY_GLSL}

void main() {
  int id = gl_InstanceID;
  float totalTufts = max(1.0, uGrassParams.x);
  if (float(id) >= totalTufts) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorldPos = vec3(0.0);
    vWorldNormal = vec3(0.0, 1.0, 0.0);
    vGrassFactors = vec3(0.0);
    return;
  }

  // Stratified jittered lattice across the 500m domain (zero grid artifacts, zero CPU overhead!)
  float side = ceil(sqrt(totalTufts));
  float ix = mod(float(id), side);
  float iz = floor(float(id) / side);
  vec3 rnd = hash32(vec2(ix, iz) + fract(uSeed * 0.0173) * 91.0);

  vec2 uv = (vec2(ix, iz) + rnd.xy) / side;
  uv = mix(vec2(0.025), vec2(0.975), clamp(uv, vec2(0.0), vec2(1.0)));

  float span = uRenderDomain.x;
  float res = uRenderDomain.y;
  vec2 worldXZ = (uv - 0.5) * span;

  // Distance cull / thin beyond 440m for blazing-fast GPU performance
  float camDist = length(uCameraPos.xz - worldXZ);
  if (camDist > 455.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorldPos = vec3(0.0);
    vWorldNormal = vec3(0.0, 1.0, 0.0);
    vGrassFactors = vec3(0.0);
    return;
  }

  vec4 terr = sampleGridBilinear(uTerrainTex, uv, res);
  vec4 cryo = sampleGridBilinear(uSnowTex, uv, res);
  float eps = 1.0 / res;
  vec4 tR = sampleGridBilinear(uTerrainTex, uv + vec2(eps, 0.0), res);
  vec4 tL = sampleGridBilinear(uTerrainTex, uv - vec2(eps, 0.0), res);
  vec4 tU = sampleGridBilinear(uTerrainTex, uv + vec2(0.0, eps), res);
  vec4 tD = sampleGridBilinear(uTerrainTex, uv - vec2(0.0, eps), res);

  float cellSz = span / max(1.0, res - 1.0);
  float hC = terr.r + terr.g + terr.b;
  vec2 grad = vec2((tR.r + tR.g + tR.b) - (tL.r + tL.g + tL.b), (tU.r + tU.g + tU.b) - (tD.r + tD.g + tD.b)) / (2.0 * cellSz);
  float slope = length(grad);
  float elevFrac = clamp(hC / max(1.0, uStrataOrient.w), 0.0, 1.3);

  // Nearby moisture boost along riverbanks & desert oasis shorelines!
  float nearWater = max(max(tR.a, tL.a), max(tU.a, tD.a));
  float moisture = smoothstep(0.002, 0.06, nearWater) * (1.0 - smoothstep(0.015, 0.055, terr.a));

  // Ecological suitability mask: reject open water, snow/glacier pack, steep cliffs, high summits & thick dry sand dunes
  float dryCheck = 1.0 - smoothstep(0.012, 0.045, terr.a);
  float snowCheck = 1.0 - smoothstep(0.04, 0.16, cryo.r + cryo.g);
  float slopeCheck = 1.0 - smoothstep(uGrassParams.w * 0.76, uGrassParams.w, slope);
  float elevCheck = 1.0 - smoothstep(max(0.08, uGrassStyle.z - 0.14), uGrassStyle.z + 0.04, elevFrac);
  float sandCheck = mix(1.0 - smoothstep(0.65, 1.55, terr.b), 1.0, moisture);

  // Natural meadow clumping / patchiness
  float meadowNoise = fbm2D(worldXZ * 0.038 + vec2(13.4, 7.9), 3, 0.55);
  float patchGate = mix(1.0, smoothstep(0.28, 0.62, meadowNoise + moisture * 0.32), uGrassStyle.w);

  float vitality = dryCheck * snowCheck * slopeCheck * elevCheck * sandCheck * patchGate;
  if (vitality < 0.16) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorldPos = vec3(0.0);
    vWorldNormal = vec3(0.0, 1.0, 0.0);
    vGrassFactors = vec3(0.0);
    return;
  }

  // Random tuft rotation & organic height variation
  float yaw = rnd.z * 6.2831853;
  float cy = cos(yaw);
  float sy = sin(yaw);
  float distFade = 1.0 - smoothstep(290.0, 450.0, camDist);
  float hScale = uGrassParams.y * (0.68 + 0.64 * fract(rnd.x * 13.7)) * vitality * (1.0 + 0.32 * moisture) * distFade;
  float wScale = (0.85 + 0.45 * fract(rnd.y * 19.3)) * max(0.65, vitality);

  vec3 localP = vec3(aPos.x * wScale, aPos.y * hScale, aPos.z * wScale);
  vec3 rotP = vec3(localP.x * cy - localP.z * sy, localP.y, localP.x * sy + localP.z * cy);
  vec3 rotN = vec3(aNormal.x * cy - aNormal.z * sy, aNormal.y, aNormal.x * sy + aNormal.z * cy);

  // Traveling wind-gust bend (quadratic from root t=0 to blade tip t=1!)
  float t = aBladeMeta.x;
  float tSec = uRenderDomain.w;
  vec2 wDir = safeNorm2(uWindRender.xy, vec2(0.85, 0.52));
  float gustPhase = dot(worldXZ, wDir) * 0.14 - tSec * (2.1 + 2.2 * uWindRender.z) + rnd.z * 3.1;
  float gust = (0.55 + 0.45 * sin(gustPhase) * cos(gustPhase * 0.47 + aBladeMeta.y * 2.5))
             * uGrassParams.z * (0.30 + 0.85 * uWindRender.z);
  float bend = gust * t * t * hScale * 0.48;
  rotP.xz += wDir * bend;
  rotP.y -= abs(bend) * 0.22 * t;

  float cryoLift = min(3.4, cryo.r * 0.85 + cryo.g * 0.62);
  vec3 wp = vec3(worldXZ.x, hC + cryoLift - 0.04, worldXZ.y) + rotP;

  // Compute dry vs green factor: 0 = lush green, 1 = golden dry grass!
  int gMode = int(uGrassStyle.x + 0.5);
  float dryFactor = clamp(uGrassStyle.y, 0.0, 1.0);
  if (gMode == 1) {
    dryFactor = clamp(0.78 + 0.22 * fract(rnd.y * 7.3) - moisture * 0.35, 0.0, 1.0);
  } else if (gMode == 2) {
    // Auto biome blend: lush green in moist valleys/shorelines, golden dry on high/steep/sunny slopes!
    float aridity = clamp(elevFrac * 0.75 + slope * 0.45 + (1.0 - meadowNoise) * 0.35 - moisture * 0.85, 0.0, 1.0);
    dryFactor = clamp(mix(aridity, uGrassStyle.y, 0.35), 0.0, 1.0);
  }

  vec3 surfN = safeNorm3(vec3(-grad.x, 1.0, -grad.y), vec3(0.0, 1.0, 0.0));
  vWorldNormal = safeNorm3(mix(rotN, surfN, 0.38), vec3(0.0, 1.0, 0.0));
  vWorldPos = wp;
  vGrassFactors = vec3(t, dryFactor, fract(rnd.x + aBladeMeta.y * 0.37));
  gl_Position = uViewProj * vec4(wp, 1.0);
}
`;

export const GRASS_INSTANCE_FRAG = `#version 300 es
${GLSL_PRECISION_HEADER}

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vGrassFactors; // (bladeT, dryFactor, tuftVar)

layout(location = 0) out vec4 outColor;

uniform sampler2D uTerrainTex;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec4 uRenderDomain; // (worldSpan, gridRes, showWater, timeSec)
uniform int uViewMode;
uniform int uMaterialTheme;

${COMMON_GEOLOGY_GLSL}

void main() {
  float span = uRenderDomain.x;
  float res = uRenderDomain.y;
  float bladeT = clamp(vGrassFactors.x, 0.0, 1.0);
  float dryF = clamp(vGrassFactors.y, 0.0, 1.0);
  float varH = vGrassFactors.z;

  // Lush Green Grass palette (rich mossy base -> sunlit emerald-chartreuse tip)
  vec3 greenRoot = vec3(0.048, 0.115, 0.028);
  vec3 greenTip  = mix(vec3(0.125, 0.285, 0.052), vec3(0.205, 0.340, 0.068), varH);
  vec3 greenCol  = mix(greenRoot, greenTip, pow(max(1e-4, bladeT), 0.78));

  // Dry Savanna / Steppe Grass palette (warm olive-straw base -> sun-bleached golden wheat tip)
  vec3 dryRoot = vec3(0.145, 0.112, 0.048);
  vec3 dryTip  = mix(vec3(0.395, 0.305, 0.135), vec3(0.475, 0.378, 0.182), varH);
  vec3 dryCol  = mix(dryRoot, dryTip, pow(max(1e-4, bladeT), 0.74));

  vec3 albedo = mix(greenCol, dryCol, dryF);
  if (uViewMode == 4) {
    albedo = vec3(0.28, 0.27, 0.26);
  }

  vec3 N = safeNorm3(vWorldNormal, vec3(0.0, 1.0, 0.0));
  if (!gl_FrontFacing) N = -N;
  vec3 L = safeNorm3(uSunDir, vec3(0.4, 0.8, 0.4));
  vec3 V = safeNorm3(uCameraPos - vWorldPos, vec3(0.0, 1.0, 0.0));

  // Terrain sun shadow raymarch so valley shadows fall naturally across meadows!
  vec2 uv = clamp(vWorldPos.xz / max(span, 1.0) + 0.5, vec2(0.001), vec2(0.999));
  float shadow = 1.0;
  vec2 stepUv = L.xz / max(span, 1.0);
  float stepY = max(0.02, L.y);
  for (int i = 1; i <= 7; i++) {
    float distM = float(i * i) * 1.9;
    vec2 sUv = uv + stepUv * distM;
    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) break;
    vec4 ts = sampleGridBilinear(uTerrainTex, sUv, res);
    float occH = ts.r + ts.g + ts.b;
    float rayH = vWorldPos.y + 0.25 + stepY * distM;
    if (occH > rayH) {
      shadow = min(shadow, 0.22);
      break;
    }
  }

  // Root-to-tip ambient occlusion + two-sided foliage wrap diffuse + backlit subsurface glow!
  float ao = mix(0.40, 1.08, bladeT);
  float wrapDiff = clamp((dot(N, L) + 0.42) / 1.42, 0.0, 1.0);
  float backlit = pow(max(0.0, dot(-L, V) * 0.5 + 0.5), 2.4) * bladeT;
  vec3 sssTint = mix(vec3(0.26, 0.42, 0.06), vec3(0.46, 0.34, 0.12), dryF);

  vec3 sunRad = vec3(2.35, 2.20, 1.96) * wrapDiff * shadow;
  vec3 amb = mix(vec3(0.12, 0.13, 0.11), vec3(0.34, 0.42, 0.52), 0.5 + 0.5 * N.y) * ao;
  vec3 lit = albedo * (sunRad + amb) + sssTint * backlit * shadow * 0.42;

  float camDist = length(uCameraPos - vWorldPos);
  if (uMaterialTheme != 7) {
    float fog = 1.0 - exp(-max(0.0, camDist - span * 0.55) * 0.0009);
    lit = mix(lit, vec3(0.045, 0.055, 0.070), clamp(fog, 0.0, 0.45));
  }

  vec3 x = max(vec3(0.0), lit);
  vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  outColor = vec4(pow(max(vec3(1e-6), clamp(mapped, 0.0, 1.0)), vec3(1.0 / 2.2)), 1.0);
}
`;


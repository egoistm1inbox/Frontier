/**
 * Custom GLSL Shaders for Ultra-Realistic Botanical Foliage, Real Bryophyte
 * Moss, Dual-Lobe Anisotropic Fur/Hair Grooms, and Studio Diagnostic Modes.
 */

import * as THREE from 'three';

export type DisplayMode = 'shaded' | 'clay' | 'wire' | 'anatomy' | 'detail' | 'wind';

export const DISPLAY_MODE_INDEX: Record<DisplayMode, number> = {
  shaded: 0,
  clay: 1,
  wire: 2,
  anatomy: 3,
  detail: 4,
  wind: 5,
};

const VERTEX_COMMON = /* glsl */ `
attribute vec3 aTangent;
attribute vec4 aWind;
attribute vec3 aPivot;
attribute vec4 aSurface;

uniform float uTime;
uniform float uWindStrength;
uniform float uWindGust;
uniform vec2 uWindDir;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vTangentW;
varying vec3 vColor;
varying vec2 vUv;
varying vec4 vWind;
varying vec4 vSurface;

vec3 rotAxisAngle(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

float softLimit(float x, float lim) {
  return (x * lim) / sqrt(lim * lim + x * x);
}

void applyProceduralWind(inout vec3 pos, inout vec3 nrm, inout vec3 tanV) {
  if (uWindStrength <= 0.0005) return;

  float limbFlex = aWind.y;
  float flutter = aWind.w;
  if (limbFlex <= 0.00001 && flutter <= 0.00001) return;

  vec3 rel = pos - aPivot;
  if (dot(rel, rel) <= 1e-12) return;

  float phase = aWind.z * 6.2831853;
  vec3 wDir = normalize(vec3(uWindDir.x, 0.0, uWindDir.y) + vec3(1e-5, 0.0, 0.0));
  // Cross-wind horizontal axis so positive pitchAngle bends +Y directly toward +wDir
  vec3 pitchAxis = vec3(wDir.z, 0.0, -wDir.x);
  vec3 rollAxis = wDir;

  // Coherent garden-scale breeze wavelength (~14 m) so multi-plant gardens & multi-stem clumps sway TOGETHER
  float downWave = dot(aPivot.xz, wDir.xz) * 0.45;
  float crossWave = dot(aPivot.xz, pitchAxis.xz) * 0.35;

  // Multi-scale turbulent gust envelope + steady carrier breeze
  float gustA = 0.5 + 0.5 * sin(uTime * 0.92 - downWave + crossWave * 0.35);
  float gustB = 0.5 + 0.5 * sin(uTime * 1.68 - downWave * 1.45 + phase * 0.18);
  float gustEnv = mix(1.0, 0.36 + 0.96 * (gustA * 0.65 + gustB * 0.35), clamp(uWindGust, 0.0, 1.0));
  float W = uWindStrength * gustEnv;

  // Mode 1: Isometric 3D Rodrigues cantilever pitch sway around aPivot (coherent phase so stems & plants move together!)
  float oscMain = 0.56 + 0.44 * sin(uTime * 2.15 - downWave * 1.1 + phase * 0.22);
  float oscSub  = 0.12 * sin(uTime * 4.35 - downWave * 1.8 + phase * 0.55);
  float pitchAngle = softLimit(limbFlex * W * (oscMain + oscSub) * 0.54, 0.88);

  // Mode 2: Coupled lateral cross-eddy roll for natural elliptical 3D sway trajectories
  float rollAngle = softLimit(limbFlex * W * 0.14 * sin(uTime * 1.62 - crossWave + phase * 0.28 + 1.1), 0.38);

  rel  = rotAxisAngle(rel, pitchAxis, pitchAngle);
  nrm  = rotAxisAngle(nrm, pitchAxis, pitchAngle);
  tanV = rotAxisAngle(tanV, pitchAxis, pitchAngle);

  rel  = rotAxisAngle(rel, rollAxis, rollAngle);
  nrm  = rotAxisAngle(nrm, rollAxis, rollAngle);
  tanV = rotAxisAngle(tanV, rollAxis, rollAngle);

  // Mode 3: Isometric torsional ribbon sail-flap & phyllid/pinna roll around bent spine tangent
  if (flutter > 0.0001) {
    vec3 safeTan = dot(tanV, tanV) > 1e-6 ? normalize(tanV) : vec3(0.0, 1.0, 0.0);
    float hiWave = sin(uTime * 6.8 - downWave * 2.3 + phase * 4.7)
                 + 0.45 * sin(uTime * 11.4 - crossWave * 2.1 + phase * 8.3);
    float flapAngle = softLimit(flutter * W * hiWave * 0.135, 0.36);
    rel = rotAxisAngle(rel, safeTan, flapAngle);
    nrm = rotAxisAngle(nrm, safeTan, flapAngle);
  }

  pos = aPivot + rel;
}
`;

export const SPECIMEN_VERT = /* glsl */ `
${VERTEX_COMMON}
void main() {
  vec3 p = position;
  vec3 n = normal;
  vec3 t = aTangent;
  applyProceduralWind(p, n, t);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vec3 nw = mat3(modelMatrix) * n;
  vNormalW = dot(nw, nw) > 1e-8 ? normalize(nw) : vec3(0.0, 1.0, 0.0);
  vec3 tw = mat3(modelMatrix) * t;
  vTangentW = dot(tw, tw) > 1e-8 ? normalize(tw) : vec3(0.0, 1.0, 0.0);
  vColor = color;
  vUv = uv;
  vWind = aWind;
  vSurface = aSurface;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SPECIMEN_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform vec3 uRimDir;
uniform float uExposure;
uniform int uMode;       // 0 shaded, 1 clay, 2 wire-ghost, 3 anatomy, 4 detail, 5 wind
uniform int uProfile;    // 0 botanical, 1 moss, 2 hair, 3 substrate
uniform float uDimFactor;    // 1.0 normal, <1.0 dimmed when another Outliner node is isolated/highlighted
uniform float uSelectPulse;  // >0.0 subtle cyan selection rim when selected in Outliner

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vTangentW;
varying vec3 vColor;
varying vec2 vUv;
varying vec4 vWind;
varying vec4 vSurface;

vec3 anatomyPalette(float lvl) {
  int k = int(floor(lvl + 0.5));
  if (k <= 0) return vec3(0.32, 0.30, 0.28); // Host substrate
  if (k == 1) return vec3(0.84, 0.44, 0.22); // Rhizome / Rhizoids / Guides
  if (k == 2) return vec3(0.92, 0.76, 0.24); // Crosiers / Stems / Undercoat
  if (k == 3) return vec3(0.18, 0.78, 0.44); // Primary Frond Pinnae / Phyllids / Guard Hairs
  if (k == 4) return vec3(0.20, 0.68, 0.92); // Bipinnate Pinnules / Setae / Whiskers
  return vec3(0.92, 0.30, 0.56);             // Sori Sporangia / Spore Capsules
}

vec3 viridis(float t) {
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.267, 0.004, 0.329);
  const vec3 c1 = vec3(0.229, 0.322, 0.545);
  const vec3 c2 = vec3(0.128, 0.566, 0.550);
  const vec3 c3 = vec3(0.369, 0.788, 0.382);
  const vec3 c4 = vec3(0.993, 0.906, 0.144);
  float s = t * 4.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  return mix(c3, c4, s - 3.0);
}

// Kajiya-Kay / Marschner shifted strand specular lobe
float strandSpec(vec3 T, vec3 V, vec3 L, float shift, float exponent) {
  vec3 H = normalize(L + V);
  // Shift tangent slightly along surface normal to mimic tilted keratin cuticle scales!
  vec3 Ts = normalize(T + vNormalW * shift);
  float dotTH = clamp(dot(Ts, H), -1.0, 1.0);
  float sinTH = sqrt(max(0.0, 1.0 - dotTH * dotTH));
  float dirAtten = smoothstep(-1.0, 0.0, dotTH);
  return dirAtten * pow(sinTH, exponent);
}

vec3 acesTonemap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;

  vec3 Lkey = normalize(uKeyDir);
  vec3 Lfill = normalize(uFillDir);
  vec3 Lrim = normalize(uRimDir);

  float rough = clamp(vSurface.x, 0.06, 0.96);
  float translucency = clamp(vSurface.y, 0.0, 1.0);
  float detailMetric = clamp(vSurface.z, 0.0, 1.0);
  float anatomyLvl = vSurface.w;

  // --- Diagnostic Studio Modes ---
  if (uMode == 1) {
    // Clay Sculpt Mode: reveals 3D venation ridges, serrations, sori & strand clumps cleanly!
    float ndl = max(dot(N, Lkey), 0.0);
    float fill = max(dot(N, Lfill), 0.0) * 0.35;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2) * 0.28;
    float hemi = 0.5 + 0.5 * N.y;
    vec3 clayBase = vec3(0.74, 0.72, 0.69);
    vec3 lit = clayBase * (0.24 + 0.22 * hemi + 0.68 * ndl + fill) + vec3(0.85, 0.88, 0.94) * rim;
    gl_FragColor = vec4(pow(acesTonemap(lit * uExposure * uDimFactor), vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uMode == 2) {
    // Ghosted Wire Backdrop
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    vec3 ghost = vec3(0.03, 0.04, 0.05) + vec3(0.08, 0.12, 0.15) * rim;
    gl_FragColor = vec4(ghost, 1.0);
    return;
  }
  if (uMode == 3) {
    // Structural Anatomy Mode
    vec3 pal = anatomyPalette(anatomyLvl);
    float ndl = 0.38 + 0.62 * max(dot(N, Lkey), 0.0);
    gl_FragColor = vec4(pow(pal * ndl * uDimFactor, vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uMode == 4) {
    // Detail Inspection Mode: Leaf Venation Relief /Phyllid Keels / Hair Lock Clump IDs!
    vec3 detCol;
    if (uProfile == 2) {
      // Distinct HSL-like lock palette per clump ID
      float h = detailMetric * 6.28318;
      detCol = 0.55 + 0.42 * vec3(cos(h), cos(h + 2.094), cos(h + 4.188));
    } else if (uProfile == 4) {
      // Vibrant floral petal venation & nectar-papilla relief heatmap
      detCol = mix(vec3(0.18, 0.04, 0.14), vec3(1.0, 0.48, 0.78), pow(detailMetric, 0.72));
    } else {
      detCol = mix(vec3(0.06, 0.15, 0.12), vec3(0.55, 0.98, 0.64), pow(detailMetric, 0.75));
    }
    float ndl = 0.35 + 0.65 * max(dot(N, Lkey), 0.0);
    gl_FragColor = vec4(pow(detCol * ndl * uDimFactor, vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uMode == 5) {
    // Wind Compliance Heatmap
    float wMetric = clamp(vWind.x * 0.45 + vWind.y * 0.45 + vWind.w * 0.25, 0.0, 1.0);
    vec3 wc = viridis(wMetric);
    float ndl = 0.45 + 0.55 * max(dot(N, Lkey), 0.0);
    gl_FragColor = vec4(pow(wc * ndl * uDimFactor, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  // --- Mode 0: Full Physically-Inspired Domain Shading ---
  vec3 albedo = vColor;
  float hemi = 0.5 + 0.5 * N.y;
  vec3 skyAmb = mix(vec3(0.09, 0.08, 0.07), vec3(0.24, 0.28, 0.34), hemi);
  vec3 keyCol = vec3(1.42, 1.36, 1.26);
  vec3 fillCol = vec3(0.32, 0.40, 0.52);
  vec3 rimCol = vec3(0.58, 0.66, 0.74);

  vec3 colorLinear = vec3(0.0);

  if (uProfile == 2) {
    // === STUDIO FUR & HAIR: Dual-Lobe Marschner / Kajiya-Kay Anisotropy ===
    vec3 T = normalize(vTangentW);
    // Multi-scatter wrap diffuse across cylindrical keratin shaft
    float wrapKey = clamp((dot(N, Lkey) + 0.55) / 1.55, 0.0, 1.0);
    float wrapFill = clamp((dot(N, Lfill) + 0.6) / 1.6, 0.0, 1.0);

    float specExpR = mix(140.0, 18.0, rough);
    float specExpTRT = mix(58.0, 10.0, rough);

    // Primary Cuticle R Lobe (shifted toward root, crisp neutral sky sheen)
    float specR = strandSpec(T, V, Lkey, -0.09, specExpR) * 0.26
                + strandSpec(T, V, Lrim, -0.09, specExpR * 0.7) * 0.14;

    // Secondary Internal-Reflection TRT Lobe (shifted toward tip, deeply tinted by melanin!)
    float specTRT = strandSpec(T, V, Lkey, 0.13, specExpTRT) * 0.52;
    vec3 trtTint = pow(max(albedo, vec3(0.02)), vec3(0.72)) * 1.65;

    // Forward-scattered golden rim glow through fine hair tips & flyaways
    float backScatter = pow(max(dot(V, -Lkey), 0.0), 3.0) * translucency * 0.42;
    float graze = pow(1.0 - abs(dot(N, V)), 3.0) * 0.14;

    colorLinear = albedo * (skyAmb * 0.95 + keyCol * wrapKey * 0.88 + fillCol * wrapFill * 0.55)
                + keyCol * specR
                + keyCol * trtTint * specTRT
                + albedo * keyCol * backScatter
                + rimCol * graze;

  } else if (uProfile == 0) {
    // === ULTRA-REALISTIC BOTANICAL LEAF & FROND LAMINA ===
    float ndlKey = max(dot(N, Lkey), 0.0);
    float wrapKey = clamp((dot(N, Lkey) + 0.25) / 1.25, 0.0, 1.0);
    float ndlFill = max(dot(N, Lfill), 0.0);

    // Waxy adaxial cuticle micro-specular (sharper on upper surface, softer on abaxial underside)
    vec3 H = normalize(Lkey + V);
    float shininess = mix(96.0, 12.0, rough);
    float fresnel = 0.035 + 0.965 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float spec = pow(max(dot(N, H), 0.0), shininess) * fresnel * mix(1.35, 0.25, rough);

    // Chlorophyll Subsurface Translucency:
    // Warm golden-green light transmits through thin mesophyll (translucency high),
    // while raised veins, midribs & sori (translucency low) attenuate light realistically!
    float backFacing = max(dot(-N, Lkey), 0.0);
    float viewForward = 0.35 + 0.65 * pow(max(dot(V, -Lkey), 0.0), 2.4);
    vec3 sssTint = mix(albedo, vec3(0.52, 0.88, 0.16), 0.48);
    vec3 sss = sssTint * keyCol * backFacing * viewForward * translucency * 0.82;

    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.6) * max(dot(N, Lrim), 0.0);

    colorLinear = albedo * (skyAmb + keyCol * mix(ndlKey, wrapKey, 0.35) + fillCol * ndlFill * 0.5)
                + sss
                + keyCol * spec * 0.62
                + rimCol * rim * 0.32;

  } else if (uProfile == 1) {
    // === REAL BRYOPHYTE & PILLOW MOSS: Deep Crevice Self-Occlusion + Asperity Velvet Rim ===
    float crevOcc = mix(0.08, 1.04, pow(clamp(detailMetric, 0.0, 1.0), 0.85));
    float ndlKey = max(dot(N, Lkey), 0.0);
    float wrapKey = clamp((dot(N, Lkey) + 0.22) / 1.22, 0.0, 1.0);
    float wrapFill = clamp((dot(N, Lfill) + 0.28) / 1.28, 0.0, 1.0);

    // Gate dew specular & asperity rim onto 3D gametophyte blades (rough < 0.86)
    // so the underlying sub-canopy cushion core (rough = 0.99) stays deep matte velvet!
    float bladeMask = 1.0 - smoothstep(0.86, 0.96, rough);
    vec3 H = normalize(Lkey + V);
    float dewSpec = pow(max(dot(N, H), 0.0), mix(64.0, 14.0, rough)) * 0.08 * crevOcc * bladeMask;

    // Hydrated chlorophyll dome & phyllid subsurface scatter
    float back = max(dot(-N, Lkey), 0.0) * (0.42 + 0.58 * pow(max(dot(V, -Lkey), 0.0), 2.0));
    vec3 mossSss = mix(albedo, vec3(0.55, 0.86, 0.12), 0.38) * keyCol * (back * 0.65 + wrapKey * 0.12) * translucency * crevOcc;

    // Characteristic bryophyte asperity velvet sheen along sunlit rounded pillow shoulders
    float graze = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    float velvet = graze * (0.12 + 0.88 * ndlKey) * crevOcc * 0.46 * bladeMask;

    colorLinear = albedo * (skyAmb * 0.52 * crevOcc + keyCol * mix(ndlKey, wrapKey, 0.34) * 1.12 * (0.35 + 0.65 * crevOcc) + fillCol * wrapFill * 0.28 * crevOcc)
                + mossSss
                + keyCol * dewSpec
                + mix(albedo * 1.28, vec3(0.68, 0.88, 0.18), 0.38) * velvet;

  } else if (uProfile == 4) {
    // === VIBRANT FLORAL COROLLA: Conical Epidermal Papillae, Silk Plisse & Chromatic Translucency ===
    // Real flower petals trap incident light inside conical epidermal cells, deepening pigment
    // chroma while transmitting pure anthocyanin/carotenoid glow (zero green chlorophyll shift!).
    float ndlKey = max(dot(N, Lkey), 0.0);
    float wrapKey = clamp((dot(N, Lkey) + 0.38) / 1.38, 0.0, 1.0);
    float wrapFill = clamp((dot(N, Lfill) + 0.34) / 1.34, 0.0, 1.0);

    // Preserve deep rich saturation in corolla throats while keeping sunlit limbs luminous
    float luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    vec3 vividAlbedo = max(mix(vec3(luma), albedo, 1.22), vec3(0.0));

    // Anisotropic silk sheen along radiating petal venation tangent T
    vec3 T = dot(vTangentW, vTangentW) > 1e-6 ? normalize(vTangentW) : vec3(0.0, 1.0, 0.0);
    vec3 H = normalize(Lkey + V);
    float tdoth = clamp(dot(T, H), -1.0, 1.0);
    float sinTH = sqrt(max(0.0, 1.0 - tdoth * tdoth));
    float silkSpec = pow(sinTH, mix(42.0, 10.0, rough)) * ndlKey * mix(0.26, 0.04, rough);
    float microSpec = pow(max(dot(N, H), 0.0), mix(72.0, 14.0, rough)) * mix(0.22, 0.03, rough);

    // Pure chromatic subsurface glow through delicate petal lamina (attenuated along thick veins)
    float backFacing = max(dot(-N, Lkey), 0.0);
    float viewForward = 0.38 + 0.62 * pow(max(dot(V, -Lkey), 0.0), 2.0);
    vec3 petalGlowTint = vividAlbedo * 1.32 + pow(max(vividAlbedo, vec3(0.001)), vec3(0.72)) * 0.22;
    vec3 sss = petalGlowTint * keyCol * (backFacing * viewForward * 0.92 + wrapKey * 0.18) * translucency;

    // Conical-papillae velvet rim highlight tinted by the petal's own vibrant chroma
    // (scaled by albedo intensity so deep-burgundy/indigo velvet throats stay dark & plush!)
    float darkGuard = clamp(max(vividAlbedo.r, max(vividAlbedo.g, vividAlbedo.b)) * 4.5, 0.06, 1.0);
    float velvetRim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * (0.25 + 0.75 * max(dot(N, Lrim), wrapKey)) * darkGuard;
    vec3 rimTint = mix(vividAlbedo * 1.35 + vec3(0.04) * darkGuard, rimCol, 0.22);

    colorLinear = vividAlbedo * (skyAmb * 0.88 + keyCol * mix(ndlKey, wrapKey, 0.52) * 1.06 + fillCol * wrapFill * 0.48)
                + sss
                + keyCol * (silkSpec + microSpec)
                + rimTint * velvetRim * 0.34;

  } else {
    // === HOST SUBSTRATE: Moist Granite / Furrowed Bark / Satin Bust ===
    float ndlKey = max(dot(N, Lkey), 0.0);
    float ndlFill = max(dot(N, Lfill), 0.0);
    vec3 H = normalize(Lkey + V);
    float spec = pow(max(dot(N, H), 0.0), mix(84.0, 10.0, rough)) * mix(0.38, 0.04, rough);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.4) * 0.18;

    colorLinear = albedo * (skyAmb * 0.95 + keyCol * ndlKey * 0.92 + fillCol * ndlFill * 0.48)
                + keyCol * spec
                + rimCol * rim;
  }

  // Subtle cyan-emerald selection rim when highlighted in Outliner!
  if (uSelectPulse > 0.01) {
    float selRim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    colorLinear += vec3(0.12, 0.72, 0.78) * selRim * uSelectPulse * 0.65;
  }

  vec3 mapped = acesTonemap(colorLinear * uExposure * uDimFactor);
  gl_FragColor = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}
`;

export const WIRE_VERT = /* glsl */ `
${VERTEX_COMMON}
void main() {
  vec3 p = position;
  vec3 n = normal;
  vec3 t = aTangent;
  applyProceduralWind(p, n, t);
  // Nudge wire slightly toward camera to prevent Z-fighting on dense quad meshes
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  wp.xyz += toCam * 0.00035;
  vColor = color;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WIRE_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uWireColor;
uniform float uWireOpacity;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(mix(uWireColor, vColor * 1.35 + 0.15, 0.35), uWireOpacity);
}
`;

export const SHADOW_DISC_FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.08, d);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * 0.52);
}
`;

export function createSpecimenMaterial(
  profileIndex: number,
  sharedUniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPECIMEN_VERT,
    fragmentShader: SPECIMEN_FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...sharedUniforms,
      uProfile: { value: profileIndex },
      uDimFactor: { value: 1.0 },
      uSelectPulse: { value: 0.0 },
    },
  });
}

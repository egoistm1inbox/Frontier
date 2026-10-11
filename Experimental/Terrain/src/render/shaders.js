// Render shaders: terrain (+ diorama walls), water (lakes, rivers, sea), sky.
import { ATMO_STRUCT, AP_SLICES } from './atmosphere.js';
import { PATCH_GRID } from './cdlod.js';

export const VIEW_MODES = [
  { id: 0, key: 'lit', label: 'Lit', icon: 'sun' },
  { id: 15, key: 'clay', label: 'Clay', icon: 'circle' },
  { id: 1, key: 'albedo', label: 'Albedo', icon: 'palette' },
  { id: 2, key: 'normals', label: 'Normals', icon: 'move-3d' },
  { id: 3, key: 'height', label: 'Height', icon: 'mountain' },
  { id: 4, key: 'slope', label: 'Slope', icon: 'triangle-right' },
  { id: 5, key: 'flow', label: 'Flow', icon: 'waves' },
  { id: 6, key: 'wear', label: 'Wear', icon: 'pickaxe' },
  { id: 7, key: 'deposit', label: 'Deposits', icon: 'layers' },
  { id: 13, key: 'talus', label: 'Talus', icon: 'mountain-snow' },
  { id: 8, key: 'snow', label: 'Snow', icon: 'snowflake' },
  { id: 9, key: 'water', label: 'Water', icon: 'droplets' },
  { id: 10, key: 'curvature', label: 'Curvature', icon: 'spline' },
  { id: 11, key: 'occlusion', label: 'Occlusion', icon: 'circle-dashed' },
  { id: 12, key: 'mask', label: 'Layer mask', icon: 'scan-line' },
  { id: 14, key: 'lod', label: 'LOD', icon: 'grid-3x3' },
];

export const FRAME_SIZE = 576;

const COMMON = /* wgsl */`
${ATMO_STRUCT}
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  camPos: vec3f, time: f32,
  sunDir: vec3f, exposure: f32,
  sunColor: vec3f, sunIllum: f32,
  world: vec4f,      // size, hscale, seaLevel (m), N
  viewport: vec4f,   // w, h, 1/w, 1/h
  mode: vec4u,       // viewMode, flags, surround, maxLevel
  params: vec4f,     // contour interval, grid spacing, detail strength, AP max km
  waterA: vec4f,     // absorption rgb (1/m), wave strength
  waterB: vec4f,     // scattering colour rgb, turbidity
  misc: vec4f,       // baseAltKm, fogDensity, fogHeight, displacement
  fogColor: vec4f,   // rgb, fog base (m)
  hstats: vec4f,     // minH, maxH, wall base, wind bearing (rad)
  morph: array<vec4f, 16>,
}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> A: Atmo;
@group(0) @binding(2) var heightT: texture_2d<f32>;
@group(0) @binding(3) var normalT: texture_2d<f32>;
@group(0) @binding(4) var albedoT: texture_2d<f32>;
@group(0) @binding(5) var detailWT: texture_2d<f32>;
@group(0) @binding(6) var surfT: texture_2d<f32>;
@group(0) @binding(7) var shadowT: texture_2d<f32>;
@group(0) @binding(8) var attrAT: texture_2d<f32>;
@group(0) @binding(9) var attrBT: texture_2d<f32>;
@group(0) @binding(10) var waterT: texture_2d<f32>;
@group(0) @binding(11) var transT: texture_2d<f32>;
@group(0) @binding(12) var skyT: texture_2d<f32>;
@group(0) @binding(13) var apT: texture_3d<f32>;
@group(0) @binding(14) var<storage, read> irr: array<vec4f, 8>;
@group(0) @binding(15) var detH: texture_2d<f32>;
@group(0) @binding(16) var detG1: texture_2d<f32>;
@group(0) @binding(17) var detG2: texture_2d<f32>;
@group(0) @binding(18) var sampM: sampler;
@group(0) @binding(19) var sampR: sampler;
@group(0) @binding(20) var sampC: sampler;

const PI = 3.14159265358979;
const FLAG_CONTOURS = 1u;
const FLAG_GRID = 2u;
const FLAG_MIRROR = 4u;
const FLAG_WATER = 8u;
const FLAG_SEA = 16u;
const FLAG_DETAIL = 64u;
const DET_TILE_A = 24.0;
const DET_TILE_B = 3.7;
const DET_TEX = 1024.0;

fn hasFlag(f: u32) -> bool { return (F.mode.y & f) != 0u; }
fn mirror1(x: f32) -> f32 { let t = x - 2.0 * floor(x * 0.5); return 1.0 - abs(t - 1.0); }
fn wrapUV(uv: vec2f) -> vec2f {
  if (hasFlag(FLAG_MIRROR)) { return vec2f(mirror1(uv.x), mirror1(uv.y)); }
  return clamp(uv, vec2f(0.0), vec2f(1.0));
}
fn worldUV(xz: vec2f) -> vec2f { return xz / F.world.x + 0.5; }
fn inside(xz: vec2f) -> bool { let h = F.world.x * 0.5; return abs(xz.x) <= h && abs(xz.y) <= h; }
fn loadT(t: vec2i) -> f32 { let n = i32(F.world.w) - 1; return textureLoad(heightT, clamp(t, vec2i(0), vec2i(n)), 0).r; }
fn loadW(t: vec2i) -> f32 { let n = i32(F.world.w) - 1; return textureLoad(waterT, clamp(t, vec2i(0), vec2i(n)), 0).r; }
fn heightUV(uv: vec2f) -> f32 {
  let p = uv * F.world.w - 0.5;
  let i = vec2i(floor(p)); let f = p - floor(p);
  return mix(mix(loadT(i), loadT(i + vec2i(1, 0)), f.x), mix(loadT(i + vec2i(0, 1)), loadT(i + vec2i(1, 1)), f.x), f.y) * F.world.y;
}
fn waterUV(uv: vec2f) -> f32 {
  let p = uv * F.world.w - 0.5;
  let i = vec2i(floor(p)); let f = p - floor(p);
  return mix(mix(loadW(i), loadW(i + vec2i(1, 0)), f.x), mix(loadW(i + vec2i(0, 1)), loadW(i + vec2i(1, 1)), f.x), f.y) * F.world.y;
}
fn terrainH(xz: vec2f) -> f32 { return heightUV(wrapUV(worldUV(xz))); }

// ── atmosphere helpers ──
fn transLUT(altKm: f32, cz: f32) -> vec3f {
  let r = A.bottomR + max(altKm, 0.001);
  return textureSampleLevel(transT, sampC, transUV(A, r, cz), 0.0).rgb;
}
fn skyUV(rd: vec3f) -> vec2f {
  let vh = A.bottomR + max(A.camAltKm, 0.002);
  let vHor = sqrt(max(vh * vh - A.bottomR * A.bottomR, 0.0));
  let beta = acos(clamp(vHor / vh, -1.0, 1.0));
  let zha = PI - beta;
  let vza = acos(clamp(rd.y, -1.0, 1.0));
  var v: f32;
  if (vza < zha) { var k = vza / zha; k = 1.0 - k; k = sqrt(max(k, 0.0)); k = 1.0 - k; v = k * 0.5; }
  else { var k = (vza - zha) / beta; k = sqrt(clamp(k, 0.0, 1.0)); v = k * 0.5 + 0.5; }
  var lvc = 1.0;
  let hz = vec2f(rd.x, rd.z);
  let sz = vec2f(A.sunDir.x, A.sunDir.z);
  if (dot(hz, hz) > 1e-10 && dot(sz, sz) > 1e-10) { lvc = dot(normalize(hz), normalize(sz)); }
  let u = sqrt(clamp(-lvc * 0.5 + 0.5, 0.0, 1.0));
  // keep away from the LUT border texels
  return vec2f(clamp(u, 0.5 / 192.0, 1.0 - 0.5 / 192.0), clamp(v, 0.5 / 108.0, 1.0 - 0.5 / 108.0));
}
fn skyLum(rd: vec3f) -> vec3f { return textureSampleLevel(skyT, sampC, skyUV(rd), 0.0).rgb; }
fn ambientCube(n: vec3f) -> vec3f {
  let n2 = n * n;
  let x = select(irr[1].rgb, irr[0].rgb, n.x >= 0.0);
  let y = select(irr[3].rgb, irr[2].rgb, n.y >= 0.0);
  let z = select(irr[5].rgb, irr[4].rgb, n.z >= 0.0);
  return n2.x * x + n2.y * y + n2.z * z;
}
fn aerial(col: vec3f, wpos: vec3f, fragXY: vec2f) -> vec3f {
  let dkm = distance(wpos, F.camPos) / 1000.0;
  let k = sqrt(dkm / F.params.w) * ${AP_SLICES}.0 - 1.0;
  let uv = fragXY * F.viewport.zw;
  var ap = textureSampleLevel(apT, sampC, vec3f(uv, clamp((k + 0.5) / ${AP_SLICES}.0, 0.5 / ${AP_SLICES}.0, 1.0 - 0.5 / ${AP_SLICES}.0)), 0.0);
  ap = mix(vec4f(0.0, 0.0, 0.0, 1.0), ap, clamp(k + 1.0, 0.0, 1.0));
  return col * ap.a + ap.rgb;
}
fn heightFog(col: vec3f, wpos: vec3f) -> vec3f {
  let d0 = F.misc.y;
  if (d0 <= 0.0) { return col; }
  let H = max(F.misc.z, 1.0);
  let y0 = F.camPos.y - F.fogColor.w;
  let y1 = wpos.y - F.fogColor.w;
  let dist = distance(wpos, F.camPos);
  var od: f32;
  if (abs(y1 - y0) > 0.5) { od = d0 * dist * H * (exp(-max(y0, -50.0) / H) - exp(-max(y1, -50.0) / H)) / (y1 - y0); }
  else { od = d0 * dist * exp(-max(y0, -50.0) / H); }
  let T = exp(-max(od, 0.0) * 0.001);
  let rd = normalize(wpos - F.camPos);
  let c = dot(rd, F.sunDir);
  let g = 0.55;
  let ph = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * c, 1.5));
  let sunE = F.sunIllum * F.sunColor * transLUT(A.baseAltKm + wpos.y / 1000.0, F.sunDir.y);
  let light = sunE * ph * 1.4 + ambientCube(vec3f(0.0, 1.0, 0.0)) / PI * 0.9;
  return col * T + F.fogColor.rgb * light * (1.0 - T);
}

// ── BRDF ──
fn D_GGX(nh: f32, a: f32) -> f32 { let a2 = a * a; let d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
fn V_SmithJoint(nv: f32, nl: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
  let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
fn F_Schlick(f0: vec3f, vh: f32) -> vec3f { return f0 + (vec3f(1.0) - f0) * pow(1.0 - vh, 5.0); }

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

// ── surface description ──
struct Surf {
  alb: vec3f, rough: f32, n: vec3f, ao: f32, shadow: f32, wet: f32, snow: f32, veg: f32, rockW: f32, f0: f32,
}

// Shared lighting: sun (GGX + diffuse with vegetation hotspot / snow wrap), sky ambient cube, bounce, sky reflection.
fn shade(s: Surf, p: vec3f, v: vec3f) -> vec3f {
  let L = F.sunDir;
  let n = s.n;
  let nl0 = dot(n, L);
  let nv = max(dot(n, v), 1e-3);
  let altKm = A.baseAltKm + p.y / 1000.0;
  let Tsun = transLUT(altKm, L.y);
  let sunE = F.sunIllum * F.sunColor * Tsun;
  // diffuse: wrap for snow (subsurface), hotspot for canopy/grass (opposition effect)
  let wrap = 0.25 * s.snow;
  let nl = clamp((nl0 + wrap) / (1.0 + wrap), 0.0, 1.0);
  let hot = 1.0 + s.veg * 0.55 * pow(max(dot(v, L), 0.0), 6.0);
  let h = normalize(L + v);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a = max(s.rough * s.rough, 0.002);
  let Fs = F_Schlick(vec3f(s.f0), vh);
  let spec = D_GGX(nh, a) * V_SmithJoint(nv, max(nl0, 0.0), a) * Fs;
  let diff = s.alb / PI * hot * (vec3f(1.0) - Fs);
  let direct = sunE * s.shadow * (diff * nl + spec * max(nl0, 0.0));
  // ambient
  let skyE = ambientCube(n);
  let aoSky = s.ao;
  // terrain inter-reflection: the occluded part of the hemisphere sees (mostly sunlit) terrain, plus a ground term for side-facing normals
  let groundSeen = clamp((1.0 - aoSky) + (1.0 - n.y) * 0.35, 0.0, 1.0);
  let bounceE = groundSeen * vec3f(0.19, 0.17, 0.145) * (sunE * max(L.y, 0.0) * 0.85 + irr[2].rgb * 0.6);
  let ambient = s.alb / PI * (skyE * aoSky + bounceE) * mix(1.0, 0.75, s.veg);
  // sky reflection (matters for wet ground, snow and water-like surfaces)
  let R = reflect(-v, n);
  let envSharp = skyLum(vec3f(R.x, max(R.y, 0.02), R.z));
  let env = mix(envSharp, ambientCube(R) / PI, clamp(s.rough * 1.2, 0.0, 1.0));
  let Fe = s.f0 + (1.0 - s.f0) * pow(1.0 - nv, 5.0) * (1.0 - s.rough) * (1.0 - s.rough);
  let refl = env * Fe * aoSky * mix(0.25, 1.0, s.wet);
  return direct + ambient + refl;
}

// Detail textures: macro tile A and micro tile B; heights and gradients for rock (triplanar) and others (top).
struct DetailOut { grad: vec3f, cav: f32, hgt: f32 }
fn detailTop(uvA: vec2f, dA: vec4f, uvB: vec2f, dB: vec4f) -> array<vec4f, 6> {
  return array<vec4f, 6>(
    textureSampleGrad(detH, sampR, uvA, dA.xy, dA.zw), textureSampleGrad(detG1, sampR, uvA, dA.xy, dA.zw), textureSampleGrad(detG2, sampR, uvA, dA.xy, dA.zw),
    textureSampleGrad(detH, sampR, uvB, dB.xy, dB.zw), textureSampleGrad(detG1, sampR, uvB, dB.xy, dB.zw), textureSampleGrad(detG2, sampR, uvB, dB.xy, dB.zw));
}
`;

const VS = /* wgsl */`
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) info: vec4u,   // x wall edge+1 (0 = surface), y level
  @location(3) misc: vec4f,                      // x detail fade, y top height (walls)
}
const G = ${PATCH_GRID}u;

fn detailDisp(xz: vec2f, n: vec3f, dw: vec4f, fade: f32) -> f32 {
  if (fade <= 0.0) { return 0.0; }
  let uvA = xz / DET_TILE_A;
  let hA = textureSampleLevel(detH, sampR, uvA, 0.0);
  let uvB = xz / DET_TILE_B;
  let hB = textureSampleLevel(detH, sampR, uvB, 0.0);
  let amp = dw.x * 1.1 + dw.y * 0.16 + dw.z * 0.22 + dw.w * 0.2;
  let hh = dot(dw, vec4f(hA.x, hA.y, hA.z, hA.w)) * amp + dot(dw, vec4f(hB.x, hB.y, hB.z, hB.w)) * amp * 0.12;
  return (hh - amp * 0.55) * fade;
}

fn vertexPos(vi: u32, node: vec4f, isWater: bool) -> VOut {
  var o: VOut;
  let lvl = u32(node.w);
  let spacing = node.z / f32(G);
  var gx: u32; var gz: u32;
  var skirtEdge = 0u; var skirtRow = 0u;
  let base = (G + 1u) * (G + 1u);
  if (vi < base) { gx = vi % (G + 1u); gz = vi / (G + 1u); }
  else {
    let j = vi - base;
    let e = j / (2u * (G + 1u));
    let r = (j / (G + 1u)) % 2u;
    let k = j % (G + 1u);
    skirtEdge = e + 1u; skirtRow = r;
    if (e == 0u) { gx = k; gz = 0u; } else if (e == 1u) { gx = k; gz = G; } else if (e == 2u) { gx = 0u; gz = k; } else { gx = G; gz = k; }
  }
  var g = vec2f(f32(gx), f32(gz));
  var xz = node.xy + g * spacing;
  let h0 = terrainH(xz);
  let d0 = distance(F.camPos, vec3f(xz.x, h0, xz.y));
  let m = F.morph[min(lvl, 15u)];
  let k = clamp((d0 - m.x) * m.z, 0.0, 1.0);
  g = g - (fract(g * 0.5) * 2.0) * k;
  xz = node.xy + g * spacing;
  let uvRaw = worldUV(xz);
  let uv = wrapUV(uvRaw);
  var y = heightUV(uv);
  let dw = textureSampleLevel(detailWT, sampM, uvRaw, 0.0);
  let nrm = textureSampleLevel(normalT, sampM, uvRaw, 0.0).xyz;
  let dist = distance(F.camPos, vec3f(xz.x, y, xz.y));
  let fade = (1.0 - smoothstep(60.0, 220.0, dist)) * F.misc.w * select(1.0, 0.0, isWater);
  var top = y;
  if (!isWater) {
    if (hasFlag(FLAG_DETAIL)) {
      let dsp = detailDisp(xz, nrm, dw, fade);
      y += dsp * max(nrm.y, 0.25);
    }
    top = y;
  } else {
    y = waterUV(uv);
    if (!inside(xz) && !hasFlag(FLAG_MIRROR)) { y = -1e4; }
  }
  var wall = 0u;
  if (skirtEdge > 0u && skirtRow == 1u) {
    let hw = F.world.x * 0.5;
    let onBorder = (skirtEdge == 1u && xz.y <= -hw + 0.01) || (skirtEdge == 2u && xz.y >= hw - 0.01) ||
                   (skirtEdge == 3u && xz.x <= -hw + 0.01) || (skirtEdge == 4u && xz.x >= hw - 0.01);
    if (onBorder && F.mode.z == 0u) { y = F.hstats.z; }
    else { y = y - max(1.5, spacing * 0.6); }
  }
  if (skirtEdge > 0u) {
    let hw = F.world.x * 0.5;
    let onBorder = (skirtEdge == 1u && xz.y <= -hw + 0.01) || (skirtEdge == 2u && xz.y >= hw - 0.01) ||
                   (skirtEdge == 3u && xz.x <= -hw + 0.01) || (skirtEdge == 4u && xz.x >= hw - 0.01);
    if (onBorder && F.mode.z == 0u) { wall = skirtEdge; }
  }
  let wp = vec3f(xz.x, y, xz.y);
  o.pos = F.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  o.uv = uvRaw;
  o.info = vec4u(wall, lvl, 0u, 0u);
  o.misc = vec4f(fade, top, k, 0.0);
  return o;
}

@vertex fn vsTerrain(@builtin(vertex_index) vi: u32, @location(0) node: vec4f) -> VOut { return vertexPos(vi, node, false); }
@vertex fn vsWater(@builtin(vertex_index) vi: u32, @location(0) node: vec4f) -> VOut { return vertexPos(vi, node, true); }
`;

const FS_TERRAIN = /* wgsl */`
fn heatmap(t: f32) -> vec3f {
  let c0 = vec3f(0.050, 0.030, 0.528); let c1 = vec3f(0.494, 0.012, 0.658); let c2 = vec3f(0.798, 0.280, 0.470);
  let c3 = vec3f(0.973, 0.585, 0.254); let c4 = vec3f(0.940, 0.975, 0.131);
  let x = clamp(t, 0.0, 1.0) * 4.0;
  if (x < 1.0) { return mix(c0, c1, x); } if (x < 2.0) { return mix(c1, c2, x - 1.0); }
  if (x < 3.0) { return mix(c2, c3, x - 2.0); } return mix(c3, c4, x - 3.0);
}
fn toLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
fn hypsometric(t: f32) -> vec3f {
  let a = vec3f(0.16, 0.30, 0.20); let b = vec3f(0.55, 0.62, 0.38); let c = vec3f(0.72, 0.60, 0.42); let d = vec3f(0.55, 0.42, 0.36); let e = vec3f(0.96, 0.96, 0.97);
  let x = clamp(t, 0.0, 1.0) * 4.0;
  var r: vec3f;
  if (x < 1.0) { r = mix(a, b, x); } else if (x < 2.0) { r = mix(b, c, x - 1.0); } else if (x < 3.0) { r = mix(c, d, x - 2.0); } else { r = mix(d, e, x - 3.0); }
  return r;
}
fn lodColor(l: u32) -> vec3f {
  var cols = array<vec3f, 8>(vec3f(0.85, 0.35, 0.3), vec3f(0.9, 0.6, 0.25), vec3f(0.85, 0.85, 0.3), vec3f(0.4, 0.8, 0.35), vec3f(0.3, 0.75, 0.8), vec3f(0.35, 0.45, 0.9), vec3f(0.65, 0.4, 0.9), vec3f(0.85, 0.85, 0.85));
  return cols[min(l, 7u)];
}

@fragment fn fsTerrain(in: VOut) -> @location(0) vec4f {
  let p = in.wpos;
  let uv = in.uv;
  let V = F.camPos - p;
  let dist = length(V);
  let v = V / dist;
  // derivatives for detail sampling (uniform control flow)
  let dpx = dpdx(p); let dpy = dpdy(p);
  let fw = fwidth(p);
  // macro maps (single mip → explicit LOD 0)
  let nr = textureSampleLevel(normalT, sampM, uv, 0.0);
  let albR = textureSampleLevel(albedoT, sampM, uv, 0.0);
  let dw = textureSampleLevel(detailWT, sampM, uv, 0.0);
  let sf = textureSampleLevel(surfT, sampM, uv, 0.0);
  let sh = textureSampleLevel(shadowT, sampM, uv, 0.0).r;
  let atA = textureSampleLevel(attrAT, sampM, uv, 0.0);
  let atB = textureSampleLevel(attrBT, sampM, uv, 0.0);
  var n = normalize(nr.xyz);
  // detail (top projection for all, triplanar side projections for rock)
  let dA = vec4f(dpx.xz, dpy.xz) / DET_TILE_A;
  let dB = vec4f(dpx.xz, dpy.xz) / DET_TILE_B;
  let top = detailTop(p.xz / DET_TILE_A, dA, p.xz / DET_TILE_B, dB);
  let sxA = vec4f(dpx.zy, dpy.zy) / DET_TILE_A; let szA = vec4f(dpx.xy, dpy.xy) / DET_TILE_A;
  let hX = textureSampleGrad(detH, sampR, p.zy / DET_TILE_A + 0.37, sxA.xy, sxA.zw).x;
  let gX = textureSampleGrad(detG1, sampR, p.zy / DET_TILE_A + 0.37, sxA.xy, sxA.zw).xy;
  let hZ = textureSampleGrad(detH, sampR, p.xy / DET_TILE_A + 0.71, szA.xy, szA.zw).x;
  let gZ = textureSampleGrad(detG1, sampR, p.xy / DET_TILE_A + 0.71, szA.xy, szA.zw).xy;
  let sxB = vec4f(dpx.zy, dpy.zy) / DET_TILE_B; let szB = vec4f(dpx.xy, dpy.xy) / DET_TILE_B;
  let gXb = textureSampleGrad(detG1, sampR, p.zy / DET_TILE_B + 0.13, sxB.xy, sxB.zw).xy;
  let gZb = textureSampleGrad(detG1, sampR, p.xy / DET_TILE_B + 0.53, szB.xy, szB.zw).xy;
  // forest canopy: tree crowns ~4–5 m, clumped (vegetation field sampled at a large tile)
  let tileC = 520.0;
  let dC = vec4f(dpx.xz, dpy.xz) / tileC;
  let cH = textureSampleGrad(detH, sampR, p.xz / tileC + 0.21, dC.xy, dC.zw).z;
  let cG = textureSampleGrad(detG2, sampR, p.xz / tileC + 0.21, dC.xy, dC.zw).xy;
  // contour/grid line widths need derivatives in uniform flow
  let ci = max(F.params.x, 0.5);
  let cf = p.y / ci;
  let cw = fwidth(cf);
  let gs = max(F.params.y, 1.0);
  let gf = p.xz / gs;
  let gw = fwidth(gf);

  // ── walls (diorama) ──
  if (in.info.x > 0u) {
    var wn = vec3f(0.0, 0.0, -1.0);
    if (in.info.x == 2u) { wn = vec3f(0.0, 0.0, 1.0); } else if (in.info.x == 3u) { wn = vec3f(-1.0, 0.0, 0.0); } else if (in.info.x == 4u) { wn = vec3f(1.0, 0.0, 0.0); }
    let topH = terrainH(p.xz);
    let depth = topH - p.y;
    let along = select(p.z, p.x, abs(wn.z) > 0.5);
    let wob = sin(along * 0.013) * 3.0 + sin(along * 0.051 + 1.7) * 1.2;
    let bandId = floor((p.y + wob) / 7.0);
    let bh = hash2(vec2f(bandId, 3.1));
    var wc = mix(vec3f(0.20, 0.17, 0.14), vec3f(0.33, 0.29, 0.24), bh);
    wc = mix(vec3f(0.07, 0.055, 0.04), wc, smoothstep(0.6, 2.5, depth));
    wc *= mix(0.55, 1.0, smoothstep(F.hstats.z, F.hstats.z + (F.hstats.y - F.hstats.z) * 0.6, p.y));
    var s: Surf;
    s.alb = wc; s.rough = 0.9; s.n = wn; s.ao = 0.85; s.shadow = 1.0; s.wet = 0.0; s.snow = 0.0; s.veg = 0.0; s.rockW = 1.0; s.f0 = 0.03;
    var col = shade(s, p, v);
    if (F.mode.x != 0u && F.mode.x != 15u) { col = wc * 0.6; }
    col = aerial(col, p, in.pos.xy);
    return vec4f(col, 1.0);
  }

  // ── detail normal & cavity ──
  let dstr = F.params.z * sf.g * 1.5;
  let fadeA = (1.0 - smoothstep(350.0, 1400.0, dist)) * dstr;
  let fadeB = (1.0 - smoothstep(25.0, 110.0, dist)) * dstr;
  let ampA = vec4f(1.1, 0.16, 0.22, 0.2);
  let kA = DET_TEX / DET_TILE_A;
  let kB = DET_TEX / DET_TILE_B;
  let tw = pow(abs(n), vec3f(6.0));
  let twn = tw / (tw.x + tw.y + tw.z);
  // rock: triplanar
  let rockGradA = (vec3f(top[1].x, 0.0, top[1].y) * twn.y + vec3f(0.0, gX.y, gX.x) * twn.x + vec3f(gZ.x, gZ.y, 0.0) * twn.z) * ampA.x * kA;
  let rockGradB = (vec3f(top[4].x, 0.0, top[4].y) * twn.y + vec3f(0.0, gXb.y, gXb.x) * twn.x + vec3f(gZb.x, gZb.y, 0.0) * twn.z) * ampA.x * 0.12 * kB;
  let rockH = top[0].x * twn.y + hX * twn.x + hZ * twn.z;
  let groundGrad = vec3f(top[1].z, 0.0, top[1].w) * ampA.y * kA + vec3f(top[4].z, 0.0, top[4].w) * ampA.y * 0.12 * kB;
  let vegGrad = vec3f(top[2].x, 0.0, top[2].y) * ampA.z * kA + vec3f(top[5].x, 0.0, top[5].y) * ampA.z * 0.12 * kB;
  let snowGrad = vec3f(top[2].z, 0.0, top[2].w) * ampA.w * kA + vec3f(top[5].z, 0.0, top[5].w) * ampA.w * 0.12 * kB;
  var grad = (rockGradA * dw.x + groundGrad * dw.y + vegGrad * dw.z + snowGrad * dw.w) * fadeA + rockGradB * dw.x * fadeB;
  let detOn = hasFlag(FLAG_DETAIL) && F.mode.x != 15u;
  let can = sf.a;
  let canFade = 1.0 - smoothstep(1800.0, 6000.0, dist);
  grad += vec3f(cG.x, 0.0, cG.y) * 7.0 * (DET_TEX / tileC) * can * canFade;
  if (!detOn) { grad = vec3f(0.0); }
  let sg = grad - n * dot(n, grad);
  n = normalize(n - sg);
  let hDet = dot(dw, vec4f(rockH, top[0].y, top[0].z, top[0].w));
  var cav = mix(1.0, smoothstep(0.05, 0.55, hDet) * 0.55 + 0.45, clamp(fadeA * 1.2, 0.0, 1.0) * select(0.0, 1.0, detOn));
  if (detOn) { cav = mix(cav, smoothstep(0.12, 0.8, cH) * 0.8 + 0.2, can * mix(0.55, 1.0, canFade)); }

  // ── surface ──
  var s: Surf;
  s.alb = albR.rgb;
  s.rough = albR.a;
  s.n = n;
  s.ao = clamp(nr.w, 0.0, 1.0) * cav;
  s.shadow = sh * mix(1.0, cav, 0.5);
  s.wet = sf.r;
  s.snow = dw.w;
  s.veg = dw.z;
  s.rockW = dw.x;
  s.f0 = 0.035;
  // strata line darkening and detail-driven albedo variation
  if (detOn) { s.alb *= mix(1.0, 0.82 + 0.36 * hDet, clamp(fadeA, 0.0, 1.0) * (1.0 - dw.w * 0.7)); }
  // wet darkening (porous surfaces get darker and smoother)
  s.alb *= mix(1.0, 0.45 + 0.35 * (1.0 - s.rough), s.wet);
  s.rough = mix(s.rough, 0.18, s.wet * 0.85);
  s.f0 = mix(s.f0, 0.02, s.wet);

  let mode = F.mode.x;
  if (mode == 15u) { s.alb = vec3f(0.42); s.rough = 0.75; s.wet = 0.0; s.snow = 0.0; s.veg = 0.0; }
  var col: vec3f;
  if (mode == 0u || mode == 15u) {
    col = shade(s, p, v);
  } else {
    let L = F.sunDir;
    let hs = clamp(dot(n, normalize(vec3f(L.x, max(L.y, 0.35), L.z))), 0.0, 1.0) * 0.6 + 0.4;
    var base = vec3f(0.5);
    let hr = (p.y - F.hstats.x) / max(F.hstats.y - F.hstats.x, 1.0);
    switch mode {
      case 1u: { base = albR.rgb; }
      case 2u: { base = toLinear(n * 0.5 + 0.5); }
      case 3u: { base = toLinear(hypsometric(hr)); }
      case 4u: { base = toLinear(heatmap(degrees(acos(clamp(nr.y, -1.0, 1.0))) / 60.0)); }
      case 5u: { base = toLinear(mix(vec3f(0.06, 0.07, 0.09), vec3f(0.55, 0.85, 1.0), pow(atA.x, 1.6))); }
      case 6u: { base = toLinear(heatmap(1.0 - exp(-atA.y / 12.0))); }
      case 7u: { base = toLinear(heatmap(1.0 - exp(-atA.z / 5.0))); }
      case 13u: { base = toLinear(heatmap(1.0 - exp(-atA.w / 3.0))); }
      case 8u: { base = toLinear(mix(vec3f(0.12, 0.13, 0.15), vec3f(0.95, 0.97, 1.0), 1.0 - exp(-atB.x / 0.4))); }
      case 9u: { base = toLinear(mix(vec3f(0.12, 0.11, 0.1), vec3f(0.15, 0.55, 0.95), clamp(atB.y / 6.0, 0.0, 1.0))); }
      case 10u: { let c = atB.w + 0.35 * atB.z; base = toLinear(mix(vec3f(0.25, 0.45, 0.85), vec3f(0.92, 0.55, 0.35), clamp(c / 12.0 * 0.5 + 0.5, 0.0, 1.0))); }
      case 11u: { base = vec3f(nr.w * nr.w); }
      case 12u: { base = toLinear(mix(vec3f(0.08, 0.08, 0.09), vec3f(0.95, 0.75, 0.45), sf.b)); }
      case 14u: { base = toLinear(lodColor(in.info.y)) * (0.75 + 0.25 * in.misc.z); }
      default: {}
    }
    col = base * hs * 0.9;
  }
  // overlays
  if (hasFlag(FLAG_CONTOURS)) {
    let l = 1.0 - smoothstep(0.0, cw * 1.25, abs(fract(cf + 0.5) - 0.5));
    let major = 1.0 - step(0.5, abs(fract(cf / 5.0 + 0.5) - 0.5) * 5.0);
    col = mix(col, col * 0.25 + vec3f(0.02), l * mix(0.55, 0.85, major));
  }
  if (hasFlag(FLAG_GRID)) {
    let gl = 1.0 - smoothstep(vec2f(0.0), gw * 1.25, abs(fract(gf + 0.5) - 0.5));
    col = mix(col, vec3f(0.9), max(gl.x, gl.y) * 0.5);
  }
  if (mode == 0u || mode == 15u) {
    col = heightFog(col, p);
    col = aerial(col, p, in.pos.xy);
  }
  return vec4f(col, 1.0);
}
`;

const FS_WATER = /* wgsl */`
fn waveGrad(xz: vec2f, strength: f32, flow: vec2f) -> vec2f {
  // sum of directional waves with dispersion; the wind bearing sets the main direction
  var g = vec2f(0.0);
  let wb = F.hstats.w;
  let t = F.time;
  var amp = 0.06 * strength;
  var wl = 9.0;
  for (var i = 0; i < 7; i++) {
    let a = wb + (f32(i) * 1.7 - 5.0) * 0.32;
    let d = vec2f(sin(a), -cos(a));
    let k = 6.2831853 / wl;
    let w = sqrt(9.81 * k);
    let ph = dot(d, xz) * k - w * t + f32(i) * 1.3;
    g += d * (amp * k * cos(ph));
    amp *= 0.72; wl *= 0.62;
  }
  return g + flow;
}

@fragment fn fsWater(in: VOut) -> @location(0) vec4f {
  let p = in.wpos;
  let V = F.camPos - p;
  let dist = length(V);
  let v = V / dist;
  let uvW = wrapUV(in.uv);
  let isSea = in.info.z == 1u;
  var hb = -1e4;
  if (inside(p.xz) || hasFlag(FLAG_MIRROR)) { hb = heightUV(uvW); }
  let depth = p.y - hb;
  // ripples from detail gradients, scrolled with time, plus waves
  let dpx = dpdx(p); let dpy = dpdy(p);
  let ruv = p.xz / 6.0 + vec2f(F.time * 0.02, F.time * 0.013);
  let rg = textureSampleGrad(detG2, sampR, ruv, dpx.xz / 6.0, dpy.xz / 6.0).zw;
  let ruv2 = p.xz / 1.7 - vec2f(F.time * 0.031, -F.time * 0.017);
  let rg2 = textureSampleGrad(detG2, sampR, ruv2, dpx.xz / 1.7, dpy.xz / 1.7).zw;
  if (depth < 0.015) { discard; }
  // river flow: slope of the water surface drives stretched ripples
  var flow = vec2f(0.0);
  if (!isSea) {
    let e = F.world.x / F.world.w;
    let wx = waterUV(wrapUV(worldUV(p.xz + vec2f(e, 0.0)))) - waterUV(wrapUV(worldUV(p.xz - vec2f(e, 0.0))));
    let wz = waterUV(wrapUV(worldUV(p.xz + vec2f(0.0, e)))) - waterUV(wrapUV(worldUV(p.xz - vec2f(0.0, e))));
    flow = vec2f(wx, wz) / (2.0 * e);
  }
  let strength = F.waterA.w * select(0.35, 1.0, isSea);
  let fadeN = 1.0 - smoothstep(200.0, 4000.0, dist);
  var g2 = waveGrad(p.xz, strength * fadeN, vec2f(0.0)) + (rg * 40.0 + rg2 * 16.0) * 0.6 * strength * (1.0 - smoothstep(30.0, 600.0, dist));
  let fl = min(length(flow), 0.25);
  g2 += flow / max(length(flow), 1e-5) * fl * 0.5;
  g2 *= 1.0 + fl * 6.0;
  let n = normalize(vec3f(-g2.x, 1.0, -g2.y));
  let nv = max(dot(n, v), 1e-3);
  // Fresnel (water F0 = 0.02)
  let Fr = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  // reflection: sky + sun glint
  let R = reflect(-v, n);
  let refl = skyLum(vec3f(R.x, max(R.y, 0.01), R.z));
  let L = F.sunDir;
  let Tsun = transLUT(A.baseAltKm + p.y / 1000.0, L.y);
  let sunE = F.sunIllum * F.sunColor * Tsun;
  let shadowW = textureSampleLevel(shadowT, sampM, in.uv, 0.0).r;
  let shadowS = select(shadowW, 1.0, !inside(p.xz) && !hasFlag(FLAG_MIRROR));
  let h = normalize(L + v);
  let a = 0.06 + 0.1 * (1.0 - fadeN) + fl * 1.2;
  let spec = D_GGX(max(dot(n, h), 0.0), a * a) * V_SmithJoint(nv, max(dot(n, L), 0.0), a * a) * F_Schlick(vec3f(0.02), max(dot(v, h), 0.0)) * max(dot(n, L), 0.0);
  // refraction into the water column
  let rdir = refract(-v, n, 1.0 / 1.333);
  let cosT = max(-rdir.y, 0.08);
  let pathV = min(depth / cosT, 400.0);
  let sunIn = refract(-L, vec3f(0.0, 1.0, 0.0), 1.0 / 1.333);
  let pathL = min(depth / max(-sunIn.y, 0.1), 400.0);
  let sigA = F.waterA.rgb;
  let sigS = F.waterB.w * vec3f(1.0);
  let sigT = sigA + sigS;
  // bottom: re-shade the terrain where the refracted ray lands
  let bp = p + rdir * pathV;
  let buv = worldUV(bp.xz);
  let bnr = textureSampleLevel(normalT, sampM, buv, 0.0);
  let balb = textureSampleLevel(albedoT, sampM, buv, 0.0);
  let bsh = textureSampleLevel(shadowT, sampM, buv, 0.0).r;
  var bottom = vec3f(0.0);
  if (hb > -1e3) {
    let bn = normalize(bnr.xyz);
    let ba = balb.rgb * 0.55; // wet bottom
    let Tl = exp(-sigT * pathL);
    let caust = 1.0 + 0.6 * (rg.x + rg2.y) * 30.0 * exp(-depth * 0.3);
    bottom = ba / PI * (sunE * bsh * shadowS * max(dot(bn, L), 0.0) * Tl * max(caust, 0.2) + ambientCube(bn) * bnr.w * exp(-sigT * depth));
  }
  let Tv = exp(-sigT * pathV);
  // single scattering in the column (isotropic-ish), lit by attenuated sun and sky
  let albS = sigS / max(sigT, vec3f(1e-4));
  let inLight = (sunE * shadowS * 0.35 * exp(-sigT * min(pathL, 30.0) * 0.5) + ambientCube(vec3f(0.0, 1.0, 0.0)) / PI * 0.8) * F.waterB.rgb;
  let column = inLight * albS * (vec3f(1.0) - Tv);
  let under = bottom * Tv + column;
  var col = mix(under, refl, Fr) + sunE * shadowS * spec;
  col = heightFog(col, p);
  col = aerial(col, p, in.pos.xy);
  return vec4f(col, 1.0);
}

// Sea: radial grid around the camera at sea level
struct SeaOut { @builtin(position) pos: vec4f, @location(0) wpos: vec3f }
@vertex fn vsSea(@location(0) off: vec2f) -> VOut {
  var o: VOut;
  let snap = 4.0;
  let c = floor(F.camPos.xz / snap) * snap;
  let xz = c + off;
  let wp = vec3f(xz.x, F.world.z, xz.y);
  o.pos = F.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  o.uv = worldUV(xz);
  o.info = vec4u(0u, 0u, 1u, 0u);
  o.misc = vec4f(0.0);
  return o;
}
`;

const SKY = /* wgsl */`
struct SkyOut { @builtin(position) pos: vec4f }
@vertex fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  var o: SkyOut;
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.pos = vec4f(xy, 0.0, 1.0);
  return o;
}
@fragment fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let uv = in.pos.xy * F.viewport.zw;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let wp = F.invViewProj * vec4f(ndc, 0.5, 1.0);
  let rd = normalize(wp.xyz / wp.w - F.camPos);
  var L = skyLum(rd);
  let vh = A.bottomR + max(A.camAltKm, 0.002);
  let ro = vec3f(0.0, vh, 0.0);
  let tG = raySphere(ro, rd, A.bottomR);
  // sun disk with limb darkening
  let c = dot(rd, F.sunDir);
  let ca = cos(A.sunAngular);
  if (c > ca && tG < 0.0) {
    let T = textureSampleLevel(transT, sampC, transUV(A, vh, rd.y), 0.0).rgb;
    let solid = 2.0 * PI * (1.0 - ca);
    let r = sqrt(clamp((1.0 - c) / (1.0 - ca), 0.0, 1.0));
    let mu = sqrt(max(1.0 - r * r, 0.0));
    let limb = pow(vec3f(mu), vec3f(0.397, 0.503, 0.652));
    L += F.sunIllum * F.sunColor * T / solid * limb * smoothstep(1.0, 0.92, r);
  }
  if (tG > 0.0) {
    let surround = F.mode.z;
    if (surround == 0u) {
      // diorama: neutral studio floor
      let fade = smoothstep(-0.25, 0.0, rd.y);
      L = mix(vec3f(0.006, 0.006, 0.0065), L * 0.35, fade) ;
    } else if (surround == 2u) {
      // ocean to the horizon: sky reflection with Fresnel over deep water
      let rr = vec3f(rd.x, -rd.y, rd.z);
      let fr = 0.02 + 0.98 * pow(1.0 - max(-rd.y, 0.0), 5.0);
      let deep = ambientCube(vec3f(0.0, 1.0, 0.0)) / PI * F.waterB.rgb * 0.06;
      L = mix(deep, skyLum(rr), fr) * 0.95 + L * 0.0;
    } else {
      // planet ground beyond the mirrored terrain
      let gp = ro + rd * tG;
      let up = normalize(gp);
      let sz = dot(up, F.sunDir);
      let Ts = textureSampleLevel(transT, sampC, transUV(A, A.bottomR + 0.001, sz), 0.0).rgb;
      let ga = vec3f(0.085, 0.08, 0.065);
      let Lg = ga / PI * (F.sunIllum * F.sunColor * Ts * max(sz, 0.0) + ambientCube(vec3f(0.0, 1.0, 0.0)));
      let Tv = exp(-tG * vec3f(0.012, 0.018, 0.03) * 0.6);
      L = L + Lg * Tv;
    }
  }
  return vec4f(L, 1.0);
}
`;

export const RENDER_WGSL = COMMON + VS + FS_TERRAIN + FS_WATER + SKY;

// ── post: bloom + tonemap ──
export const POST_WGSL = /* wgsl */`
struct Post {
  exposure: f32, bloom: f32, tonemap: u32, vignette: f32,
  contrast: f32, saturation: f32, grain: f32, time: f32,
  texel: vec2f, autoExp: f32, ev: f32,
}
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var bloomT: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> irr: array<vec4f, 8>;

struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> VO {
  var o: VO;
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  o.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(uv.x, 1.0 - uv.y);
  return o;
}
// 13-tap downsample (Jimenez 2014) with Karis average on the first level
@fragment fn fsDown(in: VO) -> @location(0) vec4f {
  let t = P.texel;
  let uv = in.uv;
  let a = textureSampleLevel(src, samp, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(src, samp, uv + t * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(src, samp, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(src, samp, uv + t * vec2f(-2.0, 0.0), 0.0).rgb;
  let e = textureSampleLevel(src, samp, uv, 0.0).rgb;
  let f = textureSampleLevel(src, samp, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(src, samp, uv + t * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(src, samp, uv + t * vec2f(0.0, 2.0), 0.0).rgb;
  let i = textureSampleLevel(src, samp, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(src, samp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(src, samp, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(src, samp, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  let m = textureSampleLevel(src, samp, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  var o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (P.autoExp > 0.5) {
    // first level: clamp fireflies (sun disk) so bloom stays stable
    let lum = dot(o, vec3f(0.2126, 0.7152, 0.0722));
    o = o / (1.0 + lum / 60.0);
  }
  return vec4f(o, 1.0);
}
@fragment fn fsUp(in: VO) -> @location(0) vec4f {
  let t = P.texel;
  let uv = in.uv;
  var s = textureSampleLevel(src, samp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + t * vec2f(0.0, -1.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + t * vec2f(-1.0, 0.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp, uv, 0.0).rgb * 4.0;
  s += textureSampleLevel(src, samp, uv + t * vec2f(1.0, 0.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + t * vec2f(0.0, 1.0), 0.0).rgb * 2.0;
  s += textureSampleLevel(src, samp, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  return vec4f(s / 16.0, 1.0);
}

// AgX (Troy Sobotka) — minimal polynomial fit by Benjamin Wrensch
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let m = mat3x3f(vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
                  vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
                  vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let minEv = -12.47393; let maxEv = 4.026069;
  var x = m * c;
  x = clamp(log2(max(x, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  x = (x - minEv) / (maxEv - minEv);
  x = agxContrast(x);
  let mi = mat3x3f(vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
                   vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
                   vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  x = mi * x;
  return pow(max(x, vec3f(0.0)), vec3f(2.2)); // back to linear for the shared output transform
}
fn aces(x: vec3f) -> vec3f {
  // Hill ACES fit (RRT+ODT)
  let i = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
  let o = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
  let v = i * x;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(o * (a / b), vec3f(0.0), vec3f(1.0));
}
fn neutral(c0: vec3f) -> vec3f {
  // Khronos PBR Neutral
  let startC = 0.8 - 0.04; let desat = 0.15;
  var c = c0;
  let x = min(c.r, min(c.g, c.b));
  let off = select(0.04, x - 6.25 * x * x, x < 0.08);
  c -= off;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startC) { return c; }
  let d = 1.0 - startC;
  let np = 1.0 - d * d / (peak + d - startC);
  c *= np / peak;
  let g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(c, vec3f(np), g);
}
fn oetf(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
@fragment fn fsTone(in: VO) -> @location(0) vec4f {
  var hdr = textureSampleLevel(src, samp, in.uv, 0.0).rgb;
  let bl = textureSampleLevel(bloomT, samp, in.uv, 0.0).rgb;
  hdr = mix(hdr, bl, P.bloom);
  // exposure: auto from horizontal irradiance (sky + sun) so a grey card sits at mid-grey
  var ex = P.exposure;
  if (P.autoExp > 0.5) {
    let E = dot(irr[2].rgb + irr[6].rgb * max(irr[7].x, 0.0), vec3f(0.2126, 0.7152, 0.0722));
    ex = 0.62 * 3.14159 / max(E, 1e-4) * exp2(P.ev);
  }
  var c = hdr * ex;
  if (P.tonemap == 0u) { c = agx(c); } else if (P.tonemap == 1u) { c = aces(c); } else if (P.tonemap == 2u) { c = neutral(c); } else { c = clamp(c, vec3f(0.0), vec3f(1.0)); }
  // grade
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(vec3f(lum), c, P.saturation);
  c = clamp((c - 0.18) * P.contrast + 0.18, vec3f(0.0), vec3f(1.0));
  // vignette
  let q = in.uv - 0.5;
  c *= 1.0 - P.vignette * smoothstep(0.25, 0.9, dot(q, q) * 2.2);
  var o = oetf(c);
  // blue-noise-ish dither + optional grain
  let n = fract(52.9829189 * fract(dot(in.pos.xy, vec2f(0.06711056, 0.00583715))));
  o += (n - 0.5) / 255.0;
  if (P.grain > 0.0) {
    let gn = fract(sin(dot(in.pos.xy + P.time * 61.0, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
    o += gn * P.grain * 0.08 * (1.0 - o * 0.6);
  }
  return vec4f(o, 1.0);
}
`;

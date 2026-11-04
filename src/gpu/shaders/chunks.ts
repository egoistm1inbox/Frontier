// GLSL ES 3.00 shared code. The macro constants are generated from src/world/macroParams.ts so the
// CPU reference and the GPU field cannot drift apart. Keep the noise & macro functions in sync with
// src/world/noise.ts and src/world/macroReference.ts.
import { BRICK, LOD, POOL, WORLD } from '../../config.ts';
import { HIGHLANDS_M, MACRO } from '../../world/macroParams.ts';

function f(v: number): string {
  if (Number.isInteger(v)) return v.toFixed(1);
  const s = String(v);
  if (s.includes('e')) return s.includes('.') ? s : s.replace('e', '.0e');
  return s.includes('.') ? s : s + '.0';
}

function macroConstants(): string {
  const hl = HIGHLANDS_M.map((h) => `vec4(${f(h.x)},${f(h.z)},${f(h.sigma)},${f(h.strength)})`).join(',');
  const defs = Object.entries(MACRO)
    .map(([k, v]) => `#define P_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()} ${f(v)}`)
    .join('\n');
  return `
const int NH = ${HIGHLANDS_M.length};
const vec4 HL[NH] = vec4[NH](${hl});
${defs}
`;
}

export const COMMON_GLSL = `
#define BRICK_CELLS ${BRICK.cells}
#define BRICK_TEX ${BRICK.texels}
#define BAND ${f(BRICK.bandCells)}
#define LEVELS ${LOD.levels}
#define GX ${LOD.grid[0]}
#define GY ${LOD.grid[1]}
#define GZ ${LOD.grid[2]}
#define SLOTS_XY ${POOL.slotsPerLayerXY}
#define CODE_AIR -1
#define CODE_SOLID -2
#define CODE_PENDING -3
#define WH ${f(WORLD.halfExtentM)}
${macroConstants()}

uniform highp sampler3D uAtlas;      // R16F: cell-normalised SDF, clamped to ±BAND
uniform highp isampler3D uPage;      // R16I: toroidal page table, one stacked block per level
uniform highp sampler2D uCoast;      // R16F: signed distance to coastline (km, negative inland)
uniform vec3 uAtlasInvSize;
uniform vec3 uLevelOrigin[LEVELS];   // camera-relative metres of brick (0,0,0) cell of each window
uniform float uLevelCell[LEVELS];
uniform ivec3 uLevelPhase[LEVELS];   // window base mod grid (toroidal phase)
uniform vec3 uCamWorld;              // camera position in world metres

// ------------------------------------------------------------------ noise (mirrors noise.ts)
uint hash3(ivec3 c) {
  uint h = uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ uint(c.z) * 0xcb1ab31fu;
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return h;
}
float lattice(ivec3 c) { return float(hash3(c)) * (2.0 / 4294967295.0) - 1.0; }

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float x00 = mix(lattice(c), lattice(c + ivec3(1, 0, 0)), u.x);
  float x10 = mix(lattice(c + ivec3(0, 1, 0)), lattice(c + ivec3(1, 1, 0)), u.x);
  float x01 = mix(lattice(c + ivec3(0, 0, 1)), lattice(c + ivec3(1, 0, 1)), u.x);
  float x11 = mix(lattice(c + ivec3(0, 1, 1)), lattice(c + ivec3(1, 1, 1)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
float vnoise2(vec2 p) { return vnoise3(vec3(p, 0.5)); }

float fbm3(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise3(p);
    n += a;
    p = p * 2.03 + vec3(17.1, 5.3, 9.7);
    a *= 0.5;
  }
  return s / n;
}
float fbm2(vec2 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise2(p);
    n += a;
    p = p * 2.03 + vec2(17.1, 5.3);
    a *= 0.5;
  }
  return s / n;
}
float ridged2(vec2 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(vnoise2(p)));
    n += a;
    p = p * 2.03 + vec2(17.1, 5.3);
    a *= 0.5;
  }
  return s / n;
}

// ------------------------------------------------------------------ macro continent SDF (world metres)
float coastKm(vec2 xz) { return textureLod(uCoast, (xz + WH) / (2.0 * WH), 0.0).r; }

float macroCoastM(vec2 xz, int oct) {
  vec2 w = xz + P_WARP_AMP_M * vec2(vnoise2(xz * P_WARP_FREQ), vnoise2(xz * P_WARP_FREQ + vec2(31.7, 11.3)));
  float cd = coastKm(w) * 1000.0;
  return cd + P_COAST_ROUGH_AMP_M * fbm2(xz * P_COAST_ROUGH_FREQ, oct);
}

float macroHeight(vec2 xz, int oct) {
  float h = P_PLATEAU_BASE_M + P_PLATEAU_AMP_M * fbm2(xz * P_PLATEAU_FREQ, 4);
  float m = 0.0;
  for (int i = 0; i < NH; i++) {
    vec4 H = HL[i];
    vec2 dd = xz - H.xy;
    m += H.w * exp(-dot(dd, dd) / (H.z * H.z));
  }
  float rid = ridged2(xz * P_RIDGE_FREQ, oct);
  h += min(m, 1.0) * P_HIGHLAND_AMP_M * (0.55 + 0.45 * rid);
  float cm = macroCoastM(xz, oct);
  float shelf = smoothstep(P_SHELF_NEAR_M, P_SHELF_FAR_M, cm);
  float ocean = P_OCEAN_FLOOR_M + 500.0 * fbm2(xz * P_OCEAN_FREQ, 2);
  return mix(h, ocean, shelf);
}

float macroSDF(vec3 pw, int oct) {
  float d = pw.y - macroHeight(pw.xz, oct);
  d += P_OVERHANG_AMP_M * fbm3(pw * P_OVERHANG_FREQ, min(oct, 3));
  d += P_DETAIL_AMP_M * fbm3(pw * P_DETAIL_FREQ, oct);
  return d;
}

// ------------------------------------------------------------------ clipmap sampling
ivec3 slotOrigin(int s) {
  return ivec3(s % SLOTS_XY, (s / SLOTS_XY) % SLOTS_XY, s / (SLOTS_XY * SLOTS_XY)) * BRICK_TEX;
}

// Samples level lv at camera-relative point p. Returns false if p is outside the window or the
// brick is not resident (pending). edge ∈ [0,1] is 1 on the window's outer rim (used for blending).
bool levelSample(int lv, vec3 p, out float dOut, out float edge) {
  float cell = uLevelCell[lv];
  vec3 q = (p - uLevelOrigin[lv]) / cell;
  vec3 ext = vec3(GX, GY, GZ) * float(BRICK_CELLS);
  if (any(lessThan(q, vec3(0.0))) || any(greaterThanEqual(q, ext))) return false;
  ivec3 bq = ivec3(floor(q / float(BRICK_CELLS)));
  ivec3 tp = (bq + uLevelPhase[lv]) % ivec3(GX, GY, GZ);
  tp.y += lv * GY;
  int code = texelFetch(uPage, tp, 0).r;
  if (code == CODE_PENDING) return false;
  vec3 lc = q - vec3(bq * BRICK_CELLS);
  if (code == CODE_AIR) {
    dOut = BAND * cell;
  } else if (code == CODE_SOLID) {
    dOut = -BAND * cell;
  } else {
    vec3 tc = (vec3(slotOrigin(code)) + lc + 1.5) * uAtlasInvSize;
    dOut = textureLod(uAtlas, tc, 0.0).r * cell;
  }
  vec3 f = min(q, ext - q) / ext;
  edge = 1.0 - smoothstep(0.0, 0.06, min(f.x, min(f.y, f.z)));
  return true;
}

// First resident level at or after "from" that contains p. No macro call here (keeps code size low).
bool levelFrom(vec3 p, int from, out float d, out float e, out int lv) {
  for (int i = 0; i < LEVELS; i++) {
    if (i < from) continue;
    if (levelSample(i, p, d, e)) { lv = i; return true; }
  }
  return false;
}

// Finest resident level wins; near its rim it blends into the next coarser level, so transitions
// are continuous while a finer brick is still streaming in. The analytic macro field is the final
// fallback. macroSDF() appears exactly once here to keep shader size bounded.
float sceneSDF(vec3 p, int oct) {
  float d = 0.0; float e = 0.0; int lv = 0;
  bool hit = levelFrom(p, 0, d, e, lv);
  bool blend = hit && e > 0.0;
  float mac = (!hit || blend) ? macroSDF(p + uCamWorld, oct) : 0.0;
  if (!hit) return mac;
  if (blend) {
    float dc = 0.0; float ec = 0.0; int lc = 0;
    bool hc = levelFrom(p, lv + 1, dc, ec, lc);
    return mix(d, hc ? dc : mac, e);
  }
  return d;
}
`;

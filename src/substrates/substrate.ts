/**
 * Procedural 3D Host Substrates & Groom Colliders.
 *
 * Provides both a clean quad PartMesh (selectable & toggleable in the Outliner)
 * and exact parametric surface queries + collision push-out for:
 *   - Forest Boulder (ridged stone with moisture crevices for real moss & ferns)
 *   - Fallen Nurse Log (furrowed bark cylinder for forest moss & epiphytic ferns)
 *   - Woodland Humus Mound (organic forest-floor soil mound)
 *   - Cranial Head & Neck Bust (scalp emitter mask + head/neck SDF collision for hair)
 *   - Mammal Pelt Saddle (spine-to-flank doubly curved hide for fur coats)
 *   - Groom Look-Dev Sphere (360° furball / shader orb)
 *   - Flat Studio Swatch (clean patch for macro inspection)
 */

import {
  RGB,
  TAU,
  UP,
  V3,
  add,
  addScaled,
  anyPerpendicular,
  clamp,
  cross,
  dot,
  hexToLinearRgb,
  length,
  lengthSq,
  mixRgb,
  normalize,
  projectOnPlane,
  saturate,
  smoothstep,
  sub,
  v3,
} from '../core/math';
import { PartMesh } from '../core/mesh';
import { fbm3, ridged3 } from '../core/noise';

export type SubstrateKind =
  | 'none'
  | 'wet_basalt_crag'
  | 'forest_carpet'
  | 'humus_mound'
  | 'boulder'
  | 'nurse_log'
  | 'scalp_bust'
  | 'pelt_saddle'
  | 'groom_sphere'
  | 'swatch_pad';

export const SUBSTRATE_NAMES: Record<SubstrateKind, string> = {
  none: 'None (Origin)',
  wet_basalt_crag: 'Wet Volcanic Basalt Crag',
  forest_carpet: 'Undulating Forest Carpet',
  humus_mound: 'Forest Humus Mound',
  boulder: 'Mossy Forest Boulder',
  nurse_log: 'Fallen Bark Nurse Log',
  scalp_bust: 'Cranial Head & Bust',
  pelt_saddle: 'Mammal Pelt Saddle',
  groom_sphere: '360° Groom Sphere',
  swatch_pad: 'Studio Swatch Pad',
};

export interface SubstrateParams {
  kind: SubstrateKind;
  /** Characteristic radius / half-width in metres. */
  size: number;
  /** Surface displacement roughness [0..1]. */
  roughness: number;
  /** Moisture retention [0..1] (darkens wet stone/bark & boosts moss vigor). */
  moisture: number;
  /** Grid resolution for the substrate mesh. */
  resolution: number;
}

export interface SurfaceSample {
  pos: V3;
  normal: V3;
  /** Primary tangent (e.g. spine-to-tail or crown-downward). */
  tangentU: V3;
  /** Secondary tangent = cross(normal, tangentU). */
  tangentV: V3;
  /** Crevice / furrow factor [0..1], high inside bark fissures & rock cracks. */
  crevice: number;
  /** Local micro-moisture [0..1]. */
  moisture: number;
  /** Valid growth/follicle mask [0..1] (e.g. scalp hairline mask on head bust). */
  emitterMask: number;
  u: number;
  v: number;
}

export class HostSubstrate {
  readonly params: SubstrateParams;
  readonly seed: number;

  constructor(params: SubstrateParams, seed: number) {
    this.params = params;
    this.seed = (seed ^ 0x2f91b37d) >>> 0;
  }

  /** Evaluate parametric point & micro-features at (u, v) in [0, 1] × [0, 1]. */
  evaluateRaw(u: number, v: number): { pos: V3; crevice: number; emitterMask: number } {
    const { kind, size, roughness } = this.params;
    const S = Math.max(0.04, size);

    if (kind === 'none') {
      return { pos: v3((u - 0.5) * S * 0.2, 0, (v - 0.5) * S * 0.2), crevice: 0, emitterMask: 1 };
    }

    if (kind === 'wet_basalt_crag') {
      // Organic sloped dark wet volcanic basalt crag outcrop for cascading cloud-forest pillow moss!
      const ang = Math.atan2(v - 0.5, u - 0.5);
      const rad = Math.hypot(u - 0.5, v - 0.5) * 2.0;
      const rockOutline = 0.94 + 0.08 * Math.sin(ang * 3 + 0.7) + 0.05 * Math.cos(ang * 5 - 1.1);
      const normR = rad / rockOutline;
      const clampedR = Math.min(1.06, normR);
      const x = Math.cos(ang) * clampedR * 1.12 * S;
      const z = Math.sin(ang) * clampedR * 1.12 * S;

      // Natural ~22 deg cascade slope rising toward upper-right + volcanic ledges + wet crag grain
      const cascadeSlope = ((u - 0.5) * 0.30 - (v - 0.5) * 0.50) * S;
      const terrace = Math.sin((v * 2.6 - u * 1.2) * Math.PI) * S * 0.032;
      const crag =
        ridged3(x * 2.9 / S, 0.6, z * 2.9 / S, this.seed, 3) * roughness * S * 0.052 +
        fbm3(x * 9.0 / S, 1.7, z * 9.0 / S, this.seed ^ 0x412, 3) * roughness * S * 0.018;
      const bevel = smoothstep(1.04, 0.78, normR);
      const y = (0.13 * S + cascadeSlope + terrace + crag) * bevel - (1 - bevel) * 0.05 * S;
      const crev = saturate(1.0 - crag / Math.max(1e-4, roughness * S * 0.06 + 0.005));
      return { pos: v3(x, y, z), crevice: crev, emitterMask: smoothstep(0.94, 0.76, normR) };
    }

    if (kind === 'forest_carpet') {
      // Wide undulating forest-floor / moss-garden carpet slab (2.4S × 2.4S)
      const x = (u - 0.5) * 2.4 * S;
      const z = (v - 0.5) * 2.4 * S;
      const edgeU = Math.max(Math.abs(u - 0.5) * 2, Math.abs(v - 0.5) * 2);
      // Soft organic rolling moss swells + micro-peat texture + rounded turf margin
      const swell =
        Math.sin(x * 3.8 / S + 0.5) * Math.cos(z * 3.4 / S - 0.3) * S * 0.048 +
        fbm3(x * 2.6 / S, 0.9, z * 2.6 / S, this.seed, 4) * roughness * S * 0.085;
      const bevel = smoothstep(1.01, 0.88, edgeU);
      const y = (0.028 * S + swell) * bevel - (1 - bevel) * 0.012 * S;
      const crev = saturate(0.45 - swell / Math.max(1e-4, S * 0.14));
      return { pos: v3(x, y, z), crevice: crev, emitterMask: smoothstep(0.99, 0.9, edgeU) };
    }

    if (kind === 'swatch_pad') {
      const x = (u - 0.5) * 2 * S;
      const z = (v - 0.5) * 2 * S;
      const r2 = (x * x + z * z) / (S * S);
      const dome = Math.max(0, 1 - r2 * 0.65) * S * 0.12;
      const n = fbm3(x * 8 / S, 1.3, z * 8 / S, this.seed, 3) * roughness * S * 0.03;
      const mask = smoothstep(1.02, 0.86, Math.max(Math.abs(u - 0.5) * 2, Math.abs(v - 0.5) * 2));
      return { pos: v3(x, dome + n, z), crevice: saturate(0.5 - n * 12), emitterMask: mask };
    }

    if (kind === 'humus_mound') {
      // Polar-mapped disc with organic woodland soil relief
      const a = 2 * u - 1;
      const b = 2 * v - 1;
      const ex = a * Math.sqrt(Math.max(0, 1 - 0.5 * b * b));
      const ez = b * Math.sqrt(Math.max(0, 1 - 0.5 * a * a));
      const r = Math.min(1, Math.hypot(ex, ez));
      const x = ex * S;
      const z = ez * S;
      const mound = (1 - Math.pow(r, 2.2)) * S * 0.24;
      const fbm = fbm3(x * 3.4 / S, 0.7, z * 3.4 / S, this.seed, 4);
      const disp = fbm * roughness * S * 0.08 * (1 - 0.5 * r * r);
      const y = Math.max(-0.015 * S, mound + disp - 0.01 * S);
      const crev = saturate(0.5 - fbm * 0.9);
      return { pos: v3(x, y, z), crevice: crev, emitterMask: smoothstep(0.98, 0.72, r) };
    }

    if (kind === 'boulder') {
      // Spherical angles theta (azimuth), phi (polar from top 0 to bottom PI)
      const theta = u * TAU;
      const phi = clamp(v * Math.PI, 0.001, Math.PI - 0.001);
      const sinP = Math.sin(phi);
      const dx = sinP * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = sinP * Math.sin(theta);
      // Asymmetric boulder proportions
      let rx = S * 1.12;
      let ry = S * 0.72;
      let rz = S * 0.94;
      const f1 = fbm3(dx * 2.1, dy * 2.1, dz * 2.1, this.seed, 4);
      const crack = ridged3(dx * 3.6 + 2.1, dy * 3.6, dz * 3.6, this.seed + 41, 4);
      const indent = (1 - crack) * roughness * 0.22 + f1 * roughness * 0.18;
      const scaleR = 1 + indent;
      const px = dx * rx * scaleR;
      // Sit naturally half-embedded in the forest floor
      const py = (dy * 0.85 + 0.34) * ry * scaleR;
      const pz = dz * rz * scaleR;
      const crev = saturate((1 - crack) * 1.15);
      // Moss prefers upper & angled rock faces above ground
      const upMask = smoothstep(-0.15, 0.28, dy) * smoothstep(-0.01, 0.04, py);
      return { pos: v3(px, Math.max(-0.02 * S, py), pz), crevice: crev, emitterMask: upMask };
    }

    if (kind === 'nurse_log') {
      // Horizontal fallen tree trunk along X axis, u along length, v around circumference
      const len = S * 2.35;
      const rad = S * 0.44;
      const x = (u - 0.5) * len;
      const ang = (v - 0.5) * TAU; // 0 = top of log!
      const cy = Math.cos(ang);
      const cz = Math.sin(ang);
      // Slight natural log bow + longitudinal bark ridges
      const bowZ = Math.sin((u - 0.5) * 2.4) * S * 0.08;
      const bowY = -Math.pow((u - 0.5) * 2, 2) * S * 0.03;
      const barkFurrow = Math.sin(ang * 26 + fbm3(x * 3.5 / S, cy * 2, cz * 2, this.seed, 3) * 4.5);
      const knot = fbm3(x * 2.2 / S, cy * 2.2, cz * 2.2, this.seed + 19, 4);
      const rLocal = rad * (1 + roughness * (0.045 * barkFurrow + 0.09 * knot));
      // Cap ends smoothly at u near 0 or 1
      const endCap = smoothstep(0, 0.045, u) * smoothstep(1, 0.955, u);
      const rr = rLocal * (0.12 + 0.88 * endCap);
      const py = rad * 0.72 + bowY + cy * rr;
      const pz = bowZ + cz * rr;
      const crev = saturate(0.5 - barkFurrow * 0.45 + (1 - cy) * 0.15);
      const topMask = smoothstep(-0.15, 0.35, cy) * smoothstep(0.03, 0.12, u) * smoothstep(0.97, 0.88, u);
      return { pos: v3(x, Math.max(-0.02 * S, py), pz), crevice: crev, emitterMask: topMask };
    }

    if (kind === 'pelt_saddle') {
      // Doubly curved mammalian back/shoulder saddle: u = head->tail (-Z to +Z), v = left->right flank
      const z = (u - 0.5) * 2.2 * S;
      const archAngle = (v - 0.5) * 2.15; // ±61° wrap over ribs/shoulders
      const ribR = S * (0.82 + 0.12 * Math.cos((u - 0.35) * 3.1) - 0.08 * u);
      const spineWave = Math.sin(u * Math.PI * 1.15) * S * 0.09;
      const muscle = fbm3(u * 3.2, Math.cos(archAngle) * 2, Math.sin(archAngle) * 2, this.seed, 3) * roughness * S * 0.035;
      const x = Math.sin(archAngle) * (ribR + muscle);
      const y = Math.cos(archAngle) * (ribR + muscle) - ribR * 0.42 + spineWave;
      const edgeFade = smoothstep(0.0, 0.07, u) * smoothstep(1.0, 0.93, u) * smoothstep(0.0, 0.06, v) * smoothstep(1.0, 0.94, v);
      return { pos: v3(x, y, z), crevice: 0.2, emitterMask: edgeFade };
    }

    if (kind === 'groom_sphere') {
      const theta = u * TAU;
      const phi = clamp(v * Math.PI, 0.002, Math.PI - 0.002);
      const sinP = Math.sin(phi);
      const dx = sinP * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = sinP * Math.sin(theta);
      const r = S * (1 + fbm3(dx * 2.5, dy * 2.5, dz * 2.5, this.seed, 3) * roughness * 0.04);
      return {
        pos: v3(dx * r, S * 1.08 + dy * r, dz * r),
        crevice: 0.15,
        emitterMask: smoothstep(-0.88, -0.45, dy),
      };
    }

    // 'scalp_bust': Sculpted anatomical cranial head + neck + upper shoulder bust (+Z = front face)
    const theta = (u - 0.5) * TAU; // 0 = front (+Z), ±PI = back of head (-Z)
    const t = saturate(v); // 0 = crown apex, 1 = shoulder base
    const headR = S;
    let radXZ = 0;
    let y = 0;
    let zOff = 0;
    let xScale = 0.86; // cranial width vs depth
    let zScale = 1.02;

    if (t < 0.62) {
      // Cranium + jaw/chin (0..0.62)
      const phi = (t / 0.62) * Math.PI * 0.82;
      radXZ = Math.sin(phi) * headR;
      y = headR * 1.55 + Math.cos(phi) * headR * 1.06;
      // Subtle facial/occipital contour
      const front = Math.max(0, Math.cos(theta));
      const back = Math.max(0, -Math.cos(theta));
      const jawT = smoothstep(0.32, 0.6, t);
      radXZ *= 1 - jawT * 0.22 * (0.4 + 0.6 * Math.abs(Math.sin(theta)));
      zOff = front * jawT * headR * 0.08 - back * (1 - jawT) * headR * 0.06;
    } else {
      // Neck (0.62..0.82) flaring into shoulders (0.82..1.0)
      const nt = (t - 0.62) / 0.38;
      const neckR = headR * 0.44;
      const shoulderFlare = Math.pow(smoothstep(0.32, 1.0, nt), 1.5) * headR * 0.95;
      radXZ = neckR + shoulderFlare;
      xScale = 0.88 + smoothstep(0.3, 1.0, nt) * 0.52;
      zScale = 0.92 - smoothstep(0.3, 1.0, nt) * 0.25;
      y = headR * (1.55 + Math.cos(Math.PI * 0.82) * 1.06) - nt * headR * 0.72;
      zOff = -headR * 0.06;
    }

    const px = Math.sin(theta) * radXZ * xScale;
    const pz = Math.cos(theta) * radXZ * zScale + zOff;

    // Anatomical hairline mask: covers crown, back/occiput down to nape, and temples/sides, leaving face clear!
    const cosFront = Math.cos(theta); // +1 at forehead/face, -1 at back of head
    // Hairline latitude varies from high on forehead (t ≈ 0.21) to low at nape (t ≈ 0.56), with temple curve
    const hairlineT = 0.205 + 0.355 * Math.pow((1 - cosFront) * 0.5, 0.85) - 0.03 * Math.cos(theta * 2);
    const mask = smoothstep(hairlineT + 0.035, hairlineT - 0.035, t);
    return { pos: v3(px, Math.max(0, y), pz), crevice: 0.1, emitterMask: mask };
  }

  sampleSurface(u: number, v: number): SurfaceSample {
    const eps = 0.0025;
    const u0 = clamp(u - eps, 0, 1);
    const u1 = clamp(u + eps, 0, 1);
    const v0 = clamp(v - eps, 0, 1);
    const v1 = clamp(v + eps, 0, 1);
    const c = this.evaluateRaw(u, v);
    const pu0 = this.evaluateRaw(u0, v).pos;
    const pu1 = this.evaluateRaw(u1, v).pos;
    const pv0 = this.evaluateRaw(u, v0).pos;
    const pv1 = this.evaluateRaw(u, v1).pos;

    const du = sub(pu1, pu0);
    const dv = sub(pv1, pv0);
    // Choose outward normal orientation depending on parametrization
    let n = cross(dv, du);
    if (lengthSq(n) < 1e-14) n = UP;
    else n = normalize(n);

    // Ensure outward normal points away from substrate interior centroid
    const interior = this.interiorAnchor(c.pos);
    const outward = sub(c.pos, interior);
    if (dot(n, outward) < 0) n = v3(-n.x, -n.y, -n.z);

    let tU = projectOnPlane(du, n);
    if (lengthSq(tU) < 1e-12) tU = anyPerpendicular(n);
    else tU = normalize(tU);
    const tV = normalize(cross(n, tU));

    const moist = saturate(
      this.params.moisture * 0.65 +
        c.crevice * 0.35 +
        smoothstep(-0.2, 0.8, n.y) * 0.15 -
        smoothstep(0.2, 0.9, c.pos.z / Math.max(0.05, this.params.size)) * 0.08,
    );

    return {
      pos: c.pos,
      normal: n,
      tangentU: tU,
      tangentV: tV,
      crevice: c.crevice,
      moisture: moist,
      emitterMask: c.emitterMask,
      u,
      v,
    };
  }

  private interiorAnchor(pos: V3): V3 {
    const S = Math.max(0.04, this.params.size);
    switch (this.params.kind) {
      case 'boulder':
        return v3(0, S * 0.18, 0);
      case 'nurse_log':
        return v3(pos.x * 0.92, S * 0.3, 0);
      case 'groom_sphere':
        return v3(0, S * 1.08, 0);
      case 'scalp_bust':
        return v3(0, clamp(pos.y, S * 0.25, S * 1.55), -S * 0.03);
      default:
        return v3(pos.x, -S * 1.5, pos.z);
    }
  }

  /**
   * Smooth analytical collision push-out so draping hair strands and low
   * fronds glide over the head, neck, shoulders, boulder, or log without clipping.
   */
  pushOutside(p: V3, clearance = 0.004): V3 {
    const { kind, size } = this.params;
    const S = Math.max(0.04, size);
    if (kind === 'none') return p.y < clearance ? v3(p.x, clearance, p.z) : p;

    if (kind === 'groom_sphere') {
      const c = v3(0, S * 1.08, 0);
      const d = sub(p, c);
      const l = length(d);
      const minR = S * 1.02 + clearance;
      if (l < minR && l > 1e-8) return addScaled(c, d, minR / l);
      return p.y < 0 ? v3(p.x, 0, p.z) : p;
    }

    if (kind === 'scalp_bust') {
      // Dual-capsule / ellipsoid proxy matching cranium + neck + shoulders
      let cur = { ...p };
      // 1. Cranium ellipsoid
      const hc = v3(0, S * 1.54, -S * 0.02);
      const rx = S * 0.89 + clearance;
      const ry = S * 1.08 + clearance;
      const rz = S * 1.05 + clearance;
      const dx = (cur.x - hc.x) / rx;
      const dy = (cur.y - hc.y) / ry;
      const dz = (cur.z - hc.z) / rz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1 && d2 > 1e-9) {
        const inv = 1 / Math.sqrt(d2);
        cur = v3(hc.x + dx * inv * rx, hc.y + dy * inv * ry, hc.z + dz * inv * rz);
      }
      // 2. Neck + shoulder cone-cylinder below cranium
      if (cur.y < S * 1.15 && cur.y >= 0) {
        const nt = saturate((S * 1.15 - cur.y) / (S * 1.15));
        const nrX = S * (0.42 + Math.pow(smoothstep(0.35, 1.0, nt), 1.4) * 0.95) + clearance;
        const nrZ = S * (0.44 + Math.pow(smoothstep(0.35, 1.0, nt), 1.4) * 0.45) + clearance;
        const nx = cur.x / nrX;
        const nz = (cur.z + S * 0.06) / nrZ;
        const r2 = nx * nx + nz * nz;
        if (r2 < 1 && r2 > 1e-9) {
          const inv = 1 / Math.sqrt(r2);
          cur.x = nx * inv * nrX;
          cur.z = -S * 0.06 + nz * inv * nrZ;
        }
      }
      if (cur.y < 0) cur.y = 0;
      return cur;
    }

    if (kind === 'pelt_saddle') {
      const ribR = S * 0.84 + clearance;
      const cy = -ribR * 0.42;
      const dx = p.x;
      const dy = p.y - cy;
      const r = Math.hypot(dx, dy);
      if (r < ribR && Math.abs(p.z) < S * 1.12 && r > 1e-8) {
        return v3((dx / r) * ribR, cy + (dy / r) * ribR, p.z);
      }
      return p;
    }

    if (kind === 'boulder') {
      const c = v3(0, S * 0.24, 0);
      const rx = S * 1.14 + clearance;
      const ry = S * 0.75 + clearance;
      const rz = S * 0.96 + clearance;
      const dx = (p.x - c.x) / rx;
      const dy = (p.y - c.y) / ry;
      const dz = (p.z - c.z) / rz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1 && d2 > 1e-9) {
        const inv = 1 / Math.sqrt(d2);
        return v3(c.x + dx * inv * rx, Math.max(0, c.y + dy * inv * ry), c.z + dz * inv * rz);
      }
      return p.y < 0 ? v3(p.x, 0, p.z) : p;
    }

    if (kind === 'nurse_log') {
      const rad = S * 0.46 + clearance;
      const cy = S * 0.31;
      const dy = p.y - cy;
      const dz = p.z;
      const r = Math.hypot(dy, dz);
      if (r < rad && Math.abs(p.x) < S * 1.18 && r > 1e-8) {
        return v3(p.x, Math.max(0, cy + (dy / r) * rad), (dz / r) * rad);
      }
      return p.y < 0 ? v3(p.x, 0, p.z) : p;
    }

    return p.y < 0 ? v3(p.x, 0, p.z) : p;
  }

  /** Build high-detail vertex-colored quad mesh for the Outliner & Viewport. */
  buildMesh(partId: string, parentId: string | null): PartMesh | null {
    const { kind, resolution } = this.params;
    if (kind === 'none') return null;

    const mesh = new PartMesh(partId, SUBSTRATE_NAMES[kind], 'substrate', parentId, 'ground', '#8c7f70');
    const NU = clamp(Math.round(resolution), 16, 128);
    const NV = clamp(Math.round(resolution * 0.8), 16, 112);

    const wrapU = kind === 'boulder' || kind === 'groom_sphere' || kind === 'scalp_bust';
    const wrapV = kind === 'nurse_log';

    const palette = this.substrateColors();
    const colsU = wrapU ? NU : NU + 1;
    const rowsV = wrapV ? NV : NV + 1;
    const grid: number[][] = [];

    for (let j = 0; j < rowsV; j++) {
      const v = wrapV ? j / NV : j / NV;
      const row: number[] = [];
      for (let i = 0; i < colsU; i++) {
        const u = wrapU ? i / NU : i / NU;
        const s = this.sampleSurface(u, v);
        // Color modulation by crevice, moisture, and height
        const wetDarken = 1 - s.moisture * 0.34 - s.crevice * 0.28;
        let col = mixRgb(palette.base, palette.crevice, saturate(s.crevice * 0.85));
        if (kind === 'scalp_bust' && s.emitterMask > 0.25) {
          col = mixRgb(col, palette.accent, s.emitterMask * 0.45);
        } else {
          col = mixRgb(col, palette.accent, saturate((1 - s.crevice) * 0.35));
        }
        col = { r: col.r * wetDarken, g: col.g * wetDarken, b: col.b * wetDarken };
        const rough =
          kind === 'wet_basalt_crag'
            ? clamp(0.46 - s.moisture * 0.24, 0.16, 0.55)
            : clamp(0.92 - s.moisture * 0.32, 0.35, 0.98);
        row.push(
          mesh.addVertex({
            x: s.pos.x,
            y: s.pos.y,
            z: s.pos.z,
            nx: s.normal.x,
            ny: s.normal.y,
            nz: s.normal.z,
            tx: s.tangentU.x,
            ty: s.tangentU.y,
            tz: s.tangentU.z,
            u,
            v,
            color: col,
            wind: [0, 0, 0, 0],
            roughness: rough,
            translucency: 0.02,
            detailMetric: s.moisture,
            anatomyLevel: 0,
          }),
        );
      }
      grid.push(row);
    }

    for (let j = 0; j < NV; j++) {
      const j1 = wrapV ? (j + 1) % NV : j + 1;
      for (let i = 0; i < NU; i++) {
        const i1 = wrapU ? (i + 1) % NU : i + 1;
        // Winding consistent with outward normal
        const a = grid[j][i];
        const b = grid[j1][i];
        const c = grid[j1][i1];
        const d = grid[j][i1];
        // Check first face winding against sample normal
        mesh.addQuad(a, b, c, d);
      }
    }

    // Ensure face normals agree with outward sampled normals (flip quads if inverted)
    if (mesh.quadCount > 0) {
      const p = mesh.positions;
      const n = mesh.normals;
      let dotSum = 0;
      const checkN = Math.min(mesh.quadCount, 24);
      for (let f = 0; f < checkN * 4; f += 4) {
        const ia = mesh.quads[f] * 3;
        const ib = mesh.quads[f + 1] * 3;
        const ic = mesh.quads[f + 2] * 3;
        const e1 = v3(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]);
        const e2 = v3(p[ic] - p[ia], p[ic + 1] - p[ia + 1], p[ic + 2] - p[ia + 2]);
        const fn = cross(e1, e2);
        dotSum += fn.x * n[ia] + fn.y * n[ia + 1] + fn.z * n[ia + 2];
      }
      if (dotSum < 0) {
        for (let f = 0; f < mesh.quads.length; f += 4) {
          const tmp = mesh.quads[f + 1];
          mesh.quads[f + 1] = mesh.quads[f + 3];
          mesh.quads[f + 3] = tmp;
        }
      }
    }

    mesh.hasExplicitNormals = false; // compute crisp smooth surface normals from the displaced mesh
    mesh.metaLabel = `${(mesh.renderedTriangles / 1000).toFixed(1)}k tris`;
    return mesh;
  }

  private substrateColors(): { base: RGB; crevice: RGB; accent: RGB } {
    switch (this.params.kind) {
      case 'wet_basalt_crag':
        return {
          base: hexToLinearRgb('#191d22'),
          crevice: hexToLinearRgb('#07090b'),
          accent: hexToLinearRgb('#303740'),
        };
      case 'forest_carpet':
        return {
          base: hexToLinearRgb('#26321e'),
          crevice: hexToLinearRgb('#141910'),
          accent: hexToLinearRgb('#384a28'),
        };
      case 'boulder':
        return {
          base: hexToLinearRgb('#595d62'),
          crevice: hexToLinearRgb('#2a2f2b'),
          accent: hexToLinearRgb('#767b7e'),
        };
      case 'nurse_log':
        return {
          base: hexToLinearRgb('#4f3a2c'),
          crevice: hexToLinearRgb('#241811'),
          accent: hexToLinearRgb('#6b523f'),
        };
      case 'scalp_bust':
        return {
          base: hexToLinearRgb('#3c3f46'),
          crevice: hexToLinearRgb('#26282e'),
          accent: hexToLinearRgb('#2b2d33'),
        };
      case 'pelt_saddle':
      case 'groom_sphere':
      case 'swatch_pad':
        return {
          base: hexToLinearRgb('#383432'),
          crevice: hexToLinearRgb('#221f1e'),
          accent: hexToLinearRgb('#4b4542'),
        };
      default:
        return {
          base: hexToLinearRgb('#382c22'),
          crevice: hexToLinearRgb('#1c1510'),
          accent: hexToLinearRgb('#4e3f30'),
        };
    }
  }
}

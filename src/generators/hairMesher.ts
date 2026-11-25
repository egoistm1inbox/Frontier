/**
 * Studio Fur & Hair Groom Mesher.
 *
 * Pipeline:
 *   1. Poisson-stratified Guide Follicles on the 3D Host Emitter Surface
 *   2. Tangent Flow Field (Center Part, Side Part, Crown Whorl, Mammal Spine->Flank, Swept Mane)
 *   3. Guide Strand Physics Integration + Smooth Analytical SDF Collision Deflection
 *   4. Multi-Coat Child Strand Synthesis:
 *        - Dense Undercoat (Lanugo / Down)
 *        - Primary Guard Hairs / Styled Locks (2-guide blend + Primary Clump + Sub-Lock Clump)
 *        - Tactile Whiskers / Stray Halo Strands
 *   5. Bishop Parallel-Transported Helical Curl, S-Wave, Coherent Frizz & Tapered 3D Shaft Tubes
 *   6. Physical Melanin + Agouti Sub-Apical Banding + Root AO + Cuticle Anisotropy Tangents
 */

import {
  CurveLine,
  RGB,
  TAU,
  UP,
  V3,
  add,
  addScaled,
  anyPerpendicular,
  clamp,
  cross,
  curveFromPoints,
  distance,
  dot,
  lerp,
  lerp1,
  lengthSq,
  melaninToLinearRgb,
  mixRgb,
  normalize,
  projectOnPlane,
  saturate,
  scale,
  smoothstep,
  sub,
  v3,
} from '../core/math';
import { PartMesh } from '../core/mesh';
import { fbm3 } from '../core/noise';
import { Random } from '../core/random';
import { HostSubstrate, SurfaceSample } from '../substrates/substrate';
import { HairParams } from './hairParams';

export interface HairStats {
  guides: number;
  guardStrands: number;
  undercoatStrands: number;
  whiskerStrands: number;
  totalStrands: number;
  height: number;
}

export interface HairBuildResult {
  parts: PartMesh[];
  stats: HairStats;
}

interface GuideStrand {
  id: number;
  sample: SurfaceSample;
  flowDir: V3;
  pts: V3[];
  curve: CurveLine;
  phase: number;
  length: number;
}

interface SubClumpAnchor {
  pos: V3;
  offsetDir: V3;
  phase: number;
}

export class HairMesher {
  private readonly p: HairParams;
  private readonly rng: Random;
  private readonly substrate: HostSubstrate;
  private stats: HairStats = {
    guides: 0,
    guardStrands: 0,
    undercoatStrands: 0,
    whiskerStrands: 0,
    totalStrands: 0,
    height: 0.25,
  };

  constructor(params: HairParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.rng = new Random((seed ^ 0xa49e217c) >>> 0);
    this.substrate = substrate;
  }

  build(layerId: string): HairBuildResult {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);
    const tierScale = tier === 1 ? 0.32 : tier === 2 ? 0.62 : tier === 3 ? 1.0 : 1.55;

    const guideMesh = new PartMesh(`${layerId}:guides`, 'Guide Strands', 'hair', layerId, 'wind', '#4fd8e0');
    const underMesh = new PartMesh(`${layerId}:undercoat`, 'Dense Undercoat (Down)', 'hair', layerId, 'layers', '#b48cff');
    const guardMesh = new PartMesh(`${layerId}:guard`, 'Primary Guard / Locks', 'hair', layerId, 'sparkles', '#ffb454');
    const whiskerMesh = new PartMesh(`${layerId}:whiskers`, 'Whiskers & Halo Strands', 'hair', layerId, 'grass', '#ffd875');

    const segs = clamp(Math.round(p.strandSegments * (tier === 1 ? 0.75 : 1)), 5, 28);
    const sides = p.shaftSides >= 4 ? 4 : 3;
    const baseLen = Math.max(0.008, p.lengthCm * 0.01);
    const rootR = Math.max(0.00012, p.rootRadiusMm * 0.001);
    const refH = Math.max(0.15, this.substrate.params.size * 1.8 + baseLen);

    // 1. Generate Master Guide Strands across the Emitter Surface
    const nGuides = clamp(Math.round(p.guideCount), 24, 360);
    const guides = this.buildGuides(nGuides, baseLen, segs);
    this.stats.guides = guides.length;

    // Emit guide polylines into `guideMesh` (plus ultra-slim visual guide ribbons so they're selectable!)
    const guideCol: RGB = { r: 0.14, g: 0.68, b: 0.82 };
    for (const g of guides) {
      let prevIdx = -1;
      for (let i = 0; i < g.pts.length; i++) {
        const pt = g.pts[i];
        const t = i / (g.pts.length - 1);
        const dir = g.curve.dirs[i];
        const idx = guideMesh.addVertex({
          x: pt.x, y: pt.y, z: pt.z,
          tx: dir.x, ty: dir.y, tz: dir.z,
          u: 0.5, v: t,
          color: guideCol,
          wind: [saturate(pt.y / refH), t * t, g.phase, t * 0.4],
          pivot: g.pts[0],
          roughness: 0.25,
          translucency: 0.2,
          detailMetric: g.id / Math.max(1, guides.length),
          anatomyLevel: 1,
        });
        if (prevIdx >= 0) guideMesh.addLine(prevIdx, idx);
        prevIdx = idx;
      }
    }
    guideMesh.metaLabel = `${guides.length} guides`;

    // Pre-build sub-clump anchors (~4 per guide) for natural secondary lock clustering
    const subAnchors: SubClumpAnchor[] = [];
    const subRng = this.rng.fork(0x4402);
    for (let i = 0; i < guides.length * 4; i++) {
      const s = this.sampleEmitterFollicle(subRng);
      if (!s) continue;
      const az = subRng.range(0, TAU);
      subAnchors.push({
        pos: s.pos,
        offsetDir: normalize(add(scale(s.tangentU, Math.cos(az)), scale(s.tangentV, Math.sin(az)))),
        phase: subRng.next(),
      });
    }

    // 2. Synthesize Dense Undercoat (Lanugo / Insulating Down)
    const nUnder = Math.round(p.undercoatCount * tierScale);
    if (nUnder > 0 && guides.length > 0) {
      const uRng = this.rng.fork(0x6610);
      const uSegs = Math.max(4, Math.round(segs * 0.68));
      for (let i = 0; i < nUnder; i++) {
        const fol = this.sampleEmitterFollicle(uRng);
        if (!fol) continue;
        this.synthesizeChildStrand(underMesh, fol, guides, subAnchors, {
          coat: 'undercoat',
          segs: uSegs,
          sides: 3,
          baseLen: baseLen * p.undercoatLengthRatio,
          rootR: rootR * 0.76,
          refH,
          rng: uRng,
        });
        this.stats.undercoatStrands++;
      }
    }

    // 3. Synthesize Primary Guard Hairs / Styled Locks
    const nGuard = Math.round(p.guardCount * tierScale);
    if (nGuard > 0 && guides.length > 0) {
      const gRng = this.rng.fork(0x7720);
      for (let i = 0; i < nGuard; i++) {
        const fol = this.sampleEmitterFollicle(gRng);
        if (!fol) continue;
        this.synthesizeChildStrand(guardMesh, fol, guides, subAnchors, {
          coat: 'guard',
          segs,
          sides,
          baseLen,
          rootR,
          refH,
          rng: gRng,
        });
        this.stats.guardStrands++;
      }
    }

    // 4. Synthesize Tactile Whiskers / Coarse Guard Halo Strands
    const nWhisk = Math.round(p.whiskerCount * Math.sqrt(tierScale));
    if (nWhisk > 0 && guides.length > 0) {
      const wRng = this.rng.fork(0x8830);
      for (let i = 0; i < nWhisk; i++) {
        const fol = this.sampleEmitterFollicle(wRng);
        if (!fol) continue;
        this.synthesizeChildStrand(whiskerMesh, fol, guides, subAnchors, {
          coat: 'whisker',
          segs: Math.max(6, segs),
          sides,
          baseLen: baseLen * wRng.range(1.18, 1.55),
          rootR: rootR * 1.55,
          refH,
          rng: wRng,
        });
        this.stats.whiskerStrands++;
      }
    }

    this.stats.totalStrands = this.stats.undercoatStrands + this.stats.guardStrands + this.stats.whiskerStrands;
    underMesh.metaLabel = `${this.stats.undercoatStrands.toLocaleString('en-US')} strands`;
    guardMesh.metaLabel = `${this.stats.guardStrands.toLocaleString('en-US')} strands`;
    whiskerMesh.metaLabel = `${this.stats.whiskerStrands.toLocaleString('en-US')} strands`;

    const parts: PartMesh[] = [];
    if (guideMesh.lines.length > 0) parts.push(guideMesh);
    if (underMesh.faceCount > 0) parts.push(underMesh);
    if (guardMesh.faceCount > 0) parts.push(guardMesh);
    if (whiskerMesh.faceCount > 0) parts.push(whiskerMesh);

    let maxY = 0.1;
    for (const part of parts) {
      const pos = part.positions;
      for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
    }
    this.stats.height = maxY;
    return { parts, stats: this.stats };
  }

  // ---------------------------------------------------------------------------
  // Surface Tangent Flow Field (Parting, Crown Whorl, Mammal Spine->Flank)
  // ---------------------------------------------------------------------------

  private computeFlowTangent(s: SurfaceSample): V3 {
    const p = this.p;
    const S = Math.max(0.05, this.substrate.params.size);
    const n = s.normal;

    let rawFlow: V3;
    if (p.flowMode === 'crown_part_center' || p.flowMode === 'crown_part_side') {
      const partX = p.flowMode === 'crown_part_side' ? -0.32 * S : 0;
      const dx = s.pos.x - partX;
      // Smoothly transition across the part line according to `partSharpness`
      const width = lerp1(0.28, 0.025, p.partSharpness) * S;
      const sideSign = Math.tanh(dx / Math.max(1e-4, width));
      // Away from the crown/part + downward + slightly backward away from face (+Z is face!)
      const backSweep = s.pos.z > 0 ? -0.38 : -0.18;
      rawFlow = v3(sideSign * 0.92, -0.78, backSweep);
    } else if (p.flowMode === 'crown_whorl') {
      // Spiral cowlick vortex around crown apex (0, maxY, -0.08*S)
      const cx = s.pos.x;
      const cz = s.pos.z + 0.08 * S;
      const r = Math.max(1e-4, Math.hypot(cx, cz));
      const radial = v3(cx / r, -0.55, cz / r);
      const swirl = v3(-cz / r, 0, cx / r);
      const swirlWeight = Math.exp(-r / (S * 0.65)) * 0.75;
      rawFlow = add(scale(radial, 1), scale(swirl, swirlWeight));
    } else if (p.flowMode === 'swept_back') {
      rawFlow = v3(s.pos.x * 0.25 / S, -0.45, -1.0);
    } else {
      // 'pelt_spine_flank': Classic mammalian coat flow — caudal (+Z head->tail) + lateral/ventral flank sweep!
      const flankSign = Math.tanh(s.pos.x / (0.18 * S));
      rawFlow = v3(flankSign * 0.68, -0.42, 0.95);
    }

    const proj = projectOnPlane(rawFlow, n);
    return lengthSq(proj) < 1e-10 ? s.tangentU : normalize(proj);
  }

  private sampleEmitterFollicle(rng: Random): SurfaceSample | null {
    for (let attempt = 0; attempt < 18; attempt++) {
      const u = rng.next();
      const v = rng.next();
      const s = this.substrate.sampleSurface(u, v);
      if (s.emitterMask > 0.12 && rng.next() < s.emitterMask) return s;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Master Guide Strand Physics & SDF Host Collision
  // ---------------------------------------------------------------------------

  private buildGuides(targetGuides: number, baseLen: number, segs: number): GuideStrand[] {
    const p = this.p;
    const rng = this.rng.fork(0x1105);
    const guides: GuideStrand[] = [];
    const minSpacing = (this.substrate.params.size * 1.45) / Math.sqrt(targetGuides);

    let guard = 0;
    while (guides.length < targetGuides && guard++ < targetGuides * 28) {
      const s = this.sampleEmitterFollicle(rng);
      if (!s) continue;
      // Approximate Poisson-disc spacing on the emitter surface so clumps are evenly distributed!
      let tooClose = false;
      for (let i = Math.max(0, guides.length - 60); i < guides.length; i++) {
        if (distance(s.pos, guides[i].sample.pos) < minSpacing * 0.68) {
          tooClose = true;
          break;
        }
      }
      if (tooClose && guard < targetGuides * 12) continue;

      const flowDir = this.computeFlowTangent(s);
      // Shorter bangs/napehair near hairline edge (`emitterMask < 0.6`) on cranial busts
      const hairlineScale = this.substrate.params.kind === 'scalp_bust' ? 0.58 + 0.42 * smoothstep(0.15, 0.7, s.emitterMask) : 1.0;
      const L = baseLen * hairlineScale * (1 + rng.vary(0, p.lengthVar * 0.65));
      const ds = L / segs;

      const pts: V3[] = [s.pos];
      let curPos = s.pos;
      // Initial emergence direction blends outward follicle normal (`rootLift`) with combed flow tangent!
      let curDir = normalize(add(scale(s.normal, p.rootLift), scale(flowDir, p.combStrength + 0.15)));

      for (let k = 1; k <= segs; k++) {
        const t = k / segs;
        // Progressive cantilever bend under gravity + comb alignment
        const gravWeight = p.gravity * Math.pow(t, p.stiffness) * (1.2 / segs);
        const combPull = p.combStrength * (1 - t * 0.55) * (0.65 / segs);
        curDir = normalize(
          add(
            addScaled(curDir, flowDir, combPull),
            v3(0, -gravWeight, 0),
          ),
        );
        let nextPos = addScaled(curPos, curDir, ds);
        // Smooth host collision push-out so guides drape naturally around head/shoulders/pelt!
        const pushed = this.substrate.pushOutside(nextPos, 0.003 + 0.004 * t);
        const stepVec = sub(pushed, curPos);
        if (lengthSq(stepVec) > 1e-12) {
          curDir = normalize(stepVec);
          nextPos = addScaled(curPos, curDir, ds);
        }
        pts.push(nextPos);
        curPos = nextPos;
      }

      guides.push({
        id: guides.length,
        sample: s,
        flowDir,
        pts,
        curve: curveFromPoints(pts, s.tangentV),
        phase: rng.next(),
        length: L,
      });
    }
    return guides;
  }

  // ---------------------------------------------------------------------------
  // Child Strand Interpolation, Clumping, Helical Curl, Frizz & 3D Tube Mesh
  // ---------------------------------------------------------------------------

  private synthesizeChildStrand(
    mesh: PartMesh,
    follicle: SurfaceSample,
    guides: GuideStrand[],
    subAnchors: SubClumpAnchor[],
    opts: {
      coat: 'undercoat' | 'guard' | 'whisker';
      segs: number;
      sides: number;
      baseLen: number;
      rootR: number;
      refH: number;
      rng: Random;
    },
  ): void {
    const p = this.p;
    const { coat, segs, sides, baseLen, rootR, refH, rng } = opts;

    // Find 2 closest guides whose flow is compatible (prevents strands crossing part lines!)
    const childFlow = this.computeFlowTangent(follicle);
    let g1 = guides[0];
    let g2 = guides[0];
    let d1 = 1e9;
    let d2 = 1e9;

    for (let i = 0; i < guides.length; i++) {
      const g = guides[i];
      let d = distance(follicle.pos, g.sample.pos);
      // Penalize guides on the opposite side of a sharp hair part!
      const flowAlign = dot(childFlow, g.flowDir);
      if (flowAlign < 0.15) d += this.substrate.params.size * 1.5 * (0.15 - flowAlign);
      if (d < d1) {
        d2 = d1; g2 = g1;
        d1 = d; g1 = g;
      } else if (d < d2) {
        d2 = d; g2 = g;
      }
    }

    //Nearest sub-clump anchor for secondary lock clustering
    let subAnchor: SubClumpAnchor | null = null;
    if (subAnchors.length > 0 && p.subClumpStrength > 0.02) {
      let bestSubD = 1e9;
      for (let i = 0; i < subAnchors.length; i++) {
        const d = distance(follicle.pos, subAnchors[i].pos);
        if (d < bestSubD) {
          bestSubD = d;
          subAnchor = subAnchors[i];
        }
      }
    }

    const wSum = 1 / Math.max(1e-4, d1) + 1 / Math.max(1e-4, d2);
    const w1 = (1 / Math.max(1e-4, d1)) / wSum;
    const w2 = 1 - w1;

    const isFlyaway = coat === 'whisker' || rng.next() < p.flyawayFraction;
    const lenScale = (g1.length / Math.max(1e-4, p.lengthCm * 0.01)) * (1 + rng.vary(0, p.lengthVar));
    const strandLen = Math.max(0.004, baseLen * clamp(lenScale, 0.45, 1.45));

    // Coat-specific modifier tuning
    const clumpGain = isFlyaway ? 0.08 : coat === 'undercoat' ? p.clumpStrength * 0.42 : p.clumpStrength;
    const subClumpGain = isFlyaway ? 0.0 : coat === 'undercoat' ? p.subClumpStrength * 0.3 : p.subClumpStrength;
    const curlR = (p.curlRadiusMm * 0.001) * (coat === 'undercoat' ? 1.25 : coat === 'whisker' ? 0.25 : 1.0);
    const curlTurns = p.curlTurns * (coat === 'undercoat' ? 1.4 : coat === 'whisker' ? 0.2 : 1.0);
    const waveAmp = (p.waveAmplitudeMm * 0.001) * (coat === 'whisker' ? 0.25 : 1.0);
    const frizzAmp = (p.frizzMm * 0.001) * (coat === 'undercoat' ? 1.55 : isFlyaway ? 2.1 : 1.0);

    const strandSeed = rng.int(100000);
    const curlPhase = g1.phase * TAU * (1 - (isFlyaway ? 0.8 : 0.12)) + rng.uniform() * (isFlyaway ? 3.1 : 0.45);
    const ratioL = strandLen / Math.max(1e-4, g1.length);

    // Build deformed 3D centreline points
    const pts: V3[] = [];
    const rootDelta1 = sub(follicle.pos, g1.pts[0]);
    const rootDelta2 = sub(follicle.pos, g2.pts[0]);

    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const tg = clamp(t * ratioL, 0, 1);
      const f1 = g1.curve.atT(tg);
      const f2 = g2.curve.atT(tg);

      // Parallel-translated child trajectory from 2 nearest guides
      const pInterp = lerp(add(f2.pos, rootDelta2), add(f1.pos, rootDelta1), w1);
      // Primary clump pulls trajectory toward primary guide `f1.pos`!
      const clumpT = clamp(clumpGain * Math.pow(t, p.clumpPower), 0, 0.96);
      let pos = lerp(pInterp, f1.pos, clumpT);

      // Secondary sub-clump cluster offset
      if (subAnchor && subClumpGain > 0.01) {
        const subPull = subClumpGain * Math.sin(t * Math.PI * 0.85) * 0.006;
        pos = addScaled(pos, subAnchor.offsetDir, subPull);
      }

      // Helical 3D curl + planar S-wave + coherent frizz in the guide's local Bishop frame (f1.right, f1.up)!
      const envRamp = smoothstep(0.02, 0.24, t); // roots emerge cleanly from follicle!
      if (curlR > 1e-5 && curlTurns > 0.02) {
        const theta = t * curlTurns * TAU + curlPhase;
        const cr = curlR * envRamp * (1 - 0.18 * t);
        pos = add(pos, add(scale(f1.right, Math.cos(theta) * cr), scale(f1.up, Math.sin(theta) * cr)));
      }
      if (waveAmp > 1e-5 && p.waveCycles > 0.05) {
        const w = Math.sin(t * p.waveCycles * TAU + curlPhase * 0.7) * waveAmp * envRamp;
        pos = addScaled(pos, f1.right, w);
      }
      if (frizzAmp > 1e-5) {
        const nx = fbm3(t * 6.5, strandSeed * 0.013, 1.7, strandSeed, 2);
        const ny = fbm3(t * 6.5 + 19.3, strandSeed * 0.013, 8.1, strandSeed + 37, 2);
        const fr = frizzAmp * Math.pow(t, 0.75);
        pos = add(pos, add(scale(f1.right, nx * fr), scale(f1.up, ny * fr)));
      }
      if (isFlyaway && t > 0.15) {
        pos = addScaled(pos, follicle.normal, strandLen * 0.06 * t);
      }

      if (k > 0) {
        pos = this.substrate.pushOutside(pos, 0.0018);
      }
      pts.push(pos);
    }

    const line = curveFromPoints(pts, follicle.tangentV);

    // Physical Melanin + Agouti Banding + Root-to-Tip Pigmentation
    const varEu = clamp(p.eumelanin * (1 + rng.vary(0, 0.12)) + (coat === 'undercoat' ? -p.undercoatWarmth * 0.42 : 0), 0.01, 1.8);
    const varPh = clamp(p.pheomelanin * (1 + rng.vary(0, 0.14)) + (coat === 'undercoat' ? p.undercoatWarmth * 0.28 : 0), 0.0, 1.8);
    const basePigment = melaninToLinearRgb(varEu, varPh, 0);
    const tipPigment = melaninToLinearRgb(varEu, varPh, p.tipBleach * (coat === 'undercoat' ? 0.35 : 1.0));
    const agoutiPigment = melaninToLinearRgb(varEu * 0.24, varPh * 1.15 + 0.18, 0.55);

    const anatomyLvl = coat === 'undercoat' ? 2 : coat === 'guard' ? 3 : 4;
    const clumpId01 = (g1.id * 0.6180339887) % 1;
    const rough = clamp(p.cuticleRoughness + (coat === 'undercoat' ? 0.18 : coat === 'whisker' ? -0.06 : 0), 0.08, 0.85);

    // Extrude 3D Tapered Prism/Quad Shaft Tube
    const rings: number[][] = [];
    for (let k = 0; k < line.count - 1; k++) {
      const fr = line.frameAtIndex(k);
      const t = fr.t;
      // Subtle root bulb, cylindrical mid-shaft, smooth parabolic taper to tip
      const taper = 1 - p.tipTaper * Math.pow(t, 1.65);
      const r = Math.max(0.00003, rootR * taper);

      // Pigmentation along shaft `t`:
      // 1) Follicle root darkening & undercoat self-occlusion
      // 2) Optional sub-apical wild mammal Agouti band (t in 0.64..0.86)
      // 3) Sun-bleached / frosted tips (t > 0.78)
      let col = mixRgb(basePigment, tipPigment, smoothstep(0.58, 0.98, t));
      if (p.agoutiBand > 0.02 && coat !== 'undercoat') {
        const band = Math.exp(-Math.pow((t - 0.74) / 0.11, 2)) * p.agoutiBand;
        col = mixRgb(col, agoutiPigment, saturate(band));
      }
      const rootAO = 1 - p.rootDarkening * Math.exp(-t * (coat === 'undercoat' ? 3.2 : 5.5));
      col = { r: col.r * rootAO, g: col.g * rootAO, b: col.b * rootAO };

      const wind: [number, number, number, number] = [
        saturate(fr.pos.y / refH),
        t * t * (coat === 'whisker' ? 0.45 : 0.95),
        g1.phase,
        t * (isFlyaway ? 0.95 : 0.45),
      ];

      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const nOut = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
        const pt = addScaled(fr.pos, nOut, r);
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: nOut.x, ny: nOut.y, nz: nOut.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z, // hair shaft tangent for Kajiya-Kay / Marschner dual specular!
            u: j / sides, v: t,
            color: col,
            wind,
            pivot: pts[0],
            roughness: rough,
            translucency: coat === 'undercoat' ? 0.58 : 0.42,
            detailMetric: clumpId01,
            anatomyLevel: anatomyLvl,
          }),
        );
      }
      rings.push(row);
    }

    //Sharp tapered tip vertex at k = line.count - 1
    const tipFr = line.frameAtIndex(line.count - 1);
    let tipCol = tipPigment;
    if (p.agoutiBand > 0.5 && p.tipBleach < 0.25 && coat === 'guard') {
      // Dark guard-hair tip above pale agouti band (classic wolf/husky guard hair!)
      tipCol = mixRgb(basePigment, tipPigment, 0.25);
    }
    const tipIdx = mesh.addVertex({
      x: tipFr.pos.x, y: tipFr.pos.y, z: tipFr.pos.z,
      nx: tipFr.dir.x, ny: tipFr.dir.y, nz: tipFr.dir.z,
      tx: tipFr.dir.x, ty: tipFr.dir.y, tz: tipFr.dir.z,
      u: 0.5, v: 1,
      color: tipCol,
      wind: [saturate(tipFr.pos.y / refH), 1.0, g1.phase, isFlyaway ? 1.0 : 0.65],
      pivot: pts[0],
      roughness: rough,
      translucency: 0.55,
      detailMetric: clumpId01,
      anatomyLevel: anatomyLvl,
    });

    for (let r = 0; r < rings.length - 1; r++) {
      const a = rings[r];
      const b = rings[r + 1];
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(a[j], a[j1], b[j1], b[j]);
      }
    }
    const lastRing = rings[rings.length - 1];
    for (let j = 0; j < sides; j++) {
      mesh.addTri(lastRing[j], lastRing[(j + 1) % sides], tipIdx);
    }
  }
}

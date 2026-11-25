/**
 * Real Bryophyte & Continuous Carpet Moss Mesher.
 *
 * Builds genuine micro-botanical moss carpets & cushions across 3D substrates:
 *   1. Basal Rhizoid & Creeping Stolon Felt (anchoring mat with zero wind drift)
 *   2. Gametophyte Shoots & Pleurocarp/Carpet Branchlets
 *   3. Spiraled 3D Keeled Phyllids (micro-leaves with V-costa, hydration splay,
 *      falcate carpet sweep, and optional silvery hyaline hair-points)
 *   4. Sporophyte Setae (slender wiry stalks with swan-neck cygneous crooks)
 *   5. Spore Capsules (sculpted 3D urns welded to seta tips)
 *
 * Wind Encoding Contract (Zero-Scaling Isometric Rotation):
 *   Every vertex on a shoot (stem, branchlet, phyllid, seta, capsule) shares the
 *   exact shoot `rootPos` as `pivot` and encodes continuous arc-length flex in
 *   `wind.y`, so our GLSL Rodrigues rotor sways shoots & travelling carpet waves
 *   smoothly without ANY stretching, detachment, or radial scaling!
 */

import {
  CurveLine,
  DEG2RAD,
  GOLDEN_ANGLE,
  RGB,
  TAU,
  UP,
  V3,
  add,
  addScaled,
  anyPerpendicular,
  clamp,
  cross,
  growCurve,
  hexToLinearRgb,
  lerp1,
  lengthSq,
  mixRgb,
  normalize,
  projectOnPlane,
  rotateAxis,
  saturate,
  scale,
  smoothstep,
  v3,
} from '../core/math';
import { PartMesh } from '../core/mesh';
import { fbm3, voronoiHummock2 } from '../core/noise';
import { Random } from '../core/random';
import { HostSubstrate, SurfaceSample } from '../substrates/substrate';
import { MossParams } from './mossParams';

export interface MossStats {
  shoots: number;
  branchlets: number;
  phyllids: number;
  sporophytes: number;
  rhizoids: number;
  height: number;
}

export interface MossBuildResult {
  parts: PartMesh[];
  stats: MossStats;
}

interface ShootSite {
  sample: SurfaceSample;
  pillow: number;
  vigor: number;
  cushionNormal: V3;
}

export class MossMesher {
  private readonly p: MossParams;
  private readonly rng: Random;
  private readonly substrate: HostSubstrate;
  private stats: MossStats = {
    shoots: 0,
    branchlets: 0,
    phyllids: 0,
    sporophytes: 0,
    rhizoids: 0,
    height: 0.08,
  };

  constructor(params: MossParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.rng = new Random((seed ^ 0x7bc291a5) >>> 0);
    this.substrate = substrate;
  }

  build(layerId: string): MossBuildResult {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);
    const tierMult = tier === 1 ? 0.38 : tier === 2 ? 0.68 : tier === 3 ? 1.0 : 1.48;

    const rhizoidMesh = new PartMesh(`${layerId}:rhizoids`, 'Rhizoid & Stolon Mat', 'moss', layerId, 'roots', '#7c5338');
    const stemMesh = new PartMesh(`${layerId}:stems`, 'Gametophyte Stems', 'moss', layerId, 'grass', '#688f44');
    const phyllidMesh = new PartMesh(`${layerId}:phyllids`, 'Phyllid Micro-Leaves', 'moss', layerId, 'leaf', '#4cd964');
    const setaMesh = new PartMesh(`${layerId}:setae`, 'Sporophyte Setae', 'moss', layerId, 'tussock', '#d97a36');
    const capsuleMesh = new PartMesh(`${layerId}:capsules`, 'Spore Capsules & Opercula', 'moss', layerId, 'sprout', '#e5a93c');

    const colCanopy = hexToLinearRgb(p.hueCanopy);
    const colTip = hexToLinearRgb(p.hueTip);
    const colBase = hexToLinearRgb(p.hueBase);
    const colStem = mixRgb(colBase, hexToLinearRgb('#6e3a20'), 0.45);
    const colCapsule = hexToLinearRgb(p.hueCapsule);
    const colSetaBase = mixRgb(colCapsule, hexToLinearRgb('#5c1e12'), 0.55);
    const colHyaline = hexToLinearRgb('#e4ece8');

    // 1. Stratified low-discrepancy shoot scattering so Carpet Moss covers evenly with zero bald holes!
    const targetShoots = clamp(Math.round(p.shootCount * tierMult), 40, 2400);
    const sites = this.scatterShootSites(targetShoots);

    const cushionH = p.cushionHeightMm * 0.001;
    const shootHBase = p.shootHeightMm * 0.001;
    const stemR = Math.max(0.00014, p.stemRadiusMm * 0.001);
    const phyllidL = p.phyllidLengthMm * 0.001;
    const phyllidW = p.phyllidWidthMm * 0.001;
    const windComp = clamp(p.windCompliance ?? 1.0, 0.15, 2.5);

    const isVelvetCarpet = p.habit === 'velvet_carpet';
    const isPleurocarp = p.habit === 'pleurocarp_feather';
    const isCushion = p.habit === 'cushion_leucobryum';
    const isSphagnum = p.habit === 'sphagnum_bog';

    // 2. Build Gametophytes, Rhizoids & Sporophytes at each site
    for (let sIdx = 0; sIdx < sites.length; sIdx++) {
      const site = sites[sIdx];
      const sRng = this.rng.fork(0x3100 + sIdx * 61);

      // Root base anchored cleanly on the substrate
      const humusLift = site.pillow * cushionH * (isVelvetCarpet ? 0.12 : 0.25);
      const rootPos = addScaled(site.sample.pos, site.sample.normal, humusLift * 0.25);

      // Spatially coherent wind phase across the carpet + small per-shoot organic jitter!
      const spatialWave = (rootPos.x * 1.65 + rootPos.z * 1.35) / Math.max(0.12, this.substrate.params.size * 1.5);
      const phase = (((spatialWave + sRng.vary(0, 0.09)) % 1) + 1) % 1;

      // Basal Rhizoid / creeping stolon filaments anchored firmly to ground (flex = 0!)
      if (p.rhizoidDensity > 0.02 && sRng.next() < p.rhizoidDensity) {
        this.addRhizoidFilament(rhizoidMesh, site.sample.pos, site.sample.normal, shootHBase * 0.42, stemR * 0.55, colBase, sRng);
        this.stats.rhizoids++;
      }

      // Coherent wind-swept carpet flow vector (flowing gently with organic swirl!)
      const swirlAngle = fbm3(rootPos.x * 3.2, 0.4, rootPos.z * 3.2, 701, 2) * 1.15 + 0.55;
      const sweepRaw = v3(Math.cos(swirlAngle), 0, Math.sin(swirlAngle));
      const sweepTan = projectOnPlane(sweepRaw, site.sample.normal);
      const carpetFlow = lengthSq(sweepTan) > 1e-8 ? normalize(sweepTan) : site.sample.tangentU;
      const sweepAmt = clamp(p.carpetSweep ?? 0.35, 0, 1);

      let shootDir: V3;
      if (isPleurocarp) {
        // Creeping/ascending interwoven feather carpet shoot!
        const randAng = sRng.range(0, TAU);
        const randTan = normalize(
          add(scale(site.sample.tangentU, Math.cos(randAng)), scale(site.sample.tangentV, Math.sin(randAng))),
        );
        const horizDir = normalize(add(scale(randTan, 1 - sweepAmt * 0.7), scale(carpetFlow, sweepAmt * 0.9)));
        shootDir = normalize(add(scale(horizDir, 0.72), scale(site.cushionNormal, 0.52)));
      } else if (isVelvetCarpet) {
        // Plush velvet sheet carpet: upright-ascending turf leaning softly into coherent flow!
        const upBlend = normalize(add(scale(UP, 0.78), scale(site.cushionNormal, 0.32)));
        shootDir = normalize(add(scale(upBlend, 1 - sweepAmt * 0.48), scale(carpetFlow, sweepAmt * 0.62)));
      } else if (isCushion) {
        shootDir = normalize(add(scale(site.cushionNormal, 0.78), scale(UP, 0.35)));
      } else {
        shootDir = normalize(
          add(
            add(scale(UP, 0.74), scale(site.cushionNormal, 0.38)),
            scale(carpetFlow, sweepAmt * 0.28),
          ),
        );
      }

      const right0 = anyPerpendicular(shootDir);
      const vigorLen = isVelvetCarpet
        ? 0.82 + 0.28 * site.vigor
        : (0.55 + 0.55 * site.vigor) * (0.65 + 0.5 * site.pillow);
      const L = Math.max(0.005, shootHBase * vigorLen * (1 + sRng.vary(0, p.shootHeightVar)));

      const stemSteps = isPleurocarp ? 7 : 5;
      const stemCurve = growCurve(rootPos, shootDir, right0, L, stemSteps, (t0, t1) => ({
        pitch: isPleurocarp
          ? (t1 - t0) * 0.24 // ascending tip!
          : isVelvetCarpet
            ? (t1 - t0) * (0.28 * sweepAmt + sRng.vary(0.05, 0.08))
            : (t1 - t0) * sRng.vary(0.08, 0.14),
        yaw: Math.sin(t1 * 4 + phase * TAU) * 0.05,
      }));

      // Stem flex function: 0 at rootPos (t=0) -> smooth cantilever curve up the shoot!
      const shootFlexAt = (tNorm: number): number => Math.pow(Math.max(0, tNorm), 1.45) * 0.85 * windComp;

      this.meshShootTube(stemMesh, stemCurve, stemR, stemR * 0.48, 4, colBase, colStem, rootPos, shootFlexAt, phase, 2);
      this.stats.shoots++;

      // Populate spiraled 3D Phyllids along main shoot
      const nPhyllids = clamp(
        Math.round(p.phyllidsPerShoot * (0.72 + 0.28 * site.vigor) * (tier === 1 ? 0.6 : 1)),
        6,
        56,
      );
      this.populateShootPhyllids(
        phyllidMesh,
        stemCurve,
        L,
        nPhyllids,
        phyllidL * (0.85 + 0.25 * site.vigor),
        phyllidW,
        stemR,
        colBase,
        colCanopy,
        colTip,
        colHyaline,
        rootPos,
        shootFlexAt,
        phase,
        sRng,
        tier,
      );

      // Lateral branchlets for Feather Carpet, Velvet Carpet tufts, or Sphagnum capitula!
      const nBranches = isPleurocarp
        ? Math.max(4, Math.round(5 + p.branching * 2))
        : isSphagnum
          ? Math.max(5, Math.round(6 + p.branching * 2))
          : Math.round(p.branching);

      if (nBranches > 0) {
        this.buildShootBranchlets(
          stemMesh,
          phyllidMesh,
          stemCurve,
          nBranches,
          L,
          stemR,
          phyllidL,
          phyllidW,
          colBase,
          colCanopy,
          colTip,
          colHyaline,
          rootPos,
          shootFlexAt,
          phase,
          sRng,
          tier,
        );
      }

      // 3. Sporophyte Generation (Seta Stalk + Swan-Neck + Welded 3D Capsule!)
      if (p.sporophyteDensity > 0.005 && site.vigor > 0.38 && sRng.next() < p.sporophyteDensity) {
        const attachT = isPleurocarp ? 0.45 : 0.96;
        const apexFrame = stemCurve.atT(attachT);
        const baseFlex = shootFlexAt(attachT);
        this.buildSporophyte(
          setaMesh,
          capsuleMesh,
          apexFrame.pos,
          rootPos, // welded to shoot root pivot!
          baseFlex,
          windComp,
          site.cushionNormal,
          colSetaBase,
          colCapsule,
          colTip,
          phase,
          sRng,
          tier,
        );
        this.stats.sporophytes++;
      }
    }

    rhizoidMesh.metaLabel = `${this.stats.rhizoids} threads`;
    stemMesh.metaLabel = `${this.stats.shoots} shoots`;
    phyllidMesh.metaLabel = `${(this.stats.phyllids / 1000).toFixed(1)}k leaves`;
    setaMesh.metaLabel = `${this.stats.sporophytes} setae`;
    capsuleMesh.metaLabel = `${this.stats.sporophytes} capsules`;

    const parts = [rhizoidMesh, stemMesh, phyllidMesh, setaMesh, capsuleMesh].filter((m) => m.faceCount > 0);
    let maxY = 0.04;
    for (const part of parts) {
      const pos = part.positions;
      for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
    }
    this.stats.height = maxY;
    return { parts, stats: this.stats };
  }

  // ---------------------------------------------------------------------------
  // Stratified Even Carpet + Cushion Site Scattering
  // ---------------------------------------------------------------------------

  private scatterShootSites(targetCount: number): ShootSite[] {
    const p = this.p;
    const rng = this.rng.fork(0x881);
    const out: ShootSite[] = [];
    const subSize = Math.max(0.05, this.substrate.params.size);
    const cushFreq = p.cushionScale / (subSize * 2);
    const isCarpet = p.habit === 'velvet_carpet' || p.habit === 'pleurocarp_feather';

    // Use jittered stratified grid cells first so Carpet Moss has lush uniform density with no bald patches!
    const gridN = Math.max(6, Math.ceil(Math.sqrt(targetCount * 1.45)));
    const totalCells = gridN * gridN;

    for (let idx = 0; idx < totalCells && out.length < targetCount; idx++) {
      // Permuted cell traversal
      const cell = (idx * 7919 + 17) % totalCells;
      const gx = cell % gridN;
      const gz = Math.floor(cell / gridN);
      const u = (gx + rng.range(0.08, 0.92)) / gridN;
      const v = (gz + rng.range(0.08, 0.92)) / gridN;

      const s = this.substrate.sampleSurface(u, v);
      if (s.emitterMask < 0.08) continue;

      const vor = voronoiHummock2(s.pos.x * cushFreq, s.pos.z * cushFreq, 409, 0.85);
      const macroNoise =
        0.5 + 0.5 * fbm3((s.pos.x * 2.1) / subSize, (s.pos.y * 2.1) / subSize, (s.pos.z * 2.1) / subSize, 911, 3);

      const creviceBoost = lerp1(1.0, 0.45 + 0.85 * s.crevice, p.creviceAffinity);
      const patchGate = lerp1(
        1.0,
        smoothstep(1 - p.colonyCoverage - 0.12, 1 - p.colonyCoverage + 0.25, macroNoise * 0.72 + vor.pillow * 0.38),
        p.patchiness,
      );
      const prob = saturate(s.emitterMask * patchGate * creviceBoost * (isCarpet ? 0.6 + 0.5 * p.colonyCoverage : 0.38 + 0.65 * p.colonyCoverage));
      if (rng.next() > prob) continue;

      const eps = 0.008 * subSize;
      const vorX = voronoiHummock2((s.pos.x + eps) * cushFreq, s.pos.z * cushFreq, 409, 0.85).pillow;
      const vorZ = voronoiHummock2(s.pos.x * cushFreq, (s.pos.z + eps) * cushFreq, 409, 0.85).pillow;
      const gradX = -(vorX - vor.pillow) / eps;
      const gradZ = -(vorZ - vor.pillow) / eps;
      const cushionTilt = clamp(p.cushionHeightMm * (isCarpet ? 0.008 : 0.022), 0, 0.85);
      const cushionNormal = normalize(add(s.normal, v3(gradX * cushionTilt * 0.04, 0, gradZ * cushionTilt * 0.04)));

      out.push({
        sample: s,
        pillow: vor.pillow,
        vigor: saturate(0.45 + 0.35 * vor.pillow + 0.25 * s.moisture),
        cushionNormal,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Spiraled 3D Keeled Phyllids (Welded to Stem Flex!)
  // ---------------------------------------------------------------------------

  private populateShootPhyllids(
    mesh: PartMesh,
    stem: CurveLine,
    shootL: number,
    count: number,
    baseLen: number,
    baseWid: number,
    stemR: number,
    colBase: RGB,
    colCanopy: RGB,
    colTip: RGB,
    colHyaline: RGB,
    rootPivot: V3,
    shootFlexAt: (tNorm: number) => number,
    phase: number,
    rng: Random,
    tier: number,
  ): void {
    const p = this.p;
    const isStar = p.habit === 'acrocarp_star';
    const isCushion = p.habit === 'cushion_leucobryum';
    const isFeather = p.habit === 'pleurocarp_feather' || p.habit === 'velvet_carpet';

    for (let i = 0; i < count; i++) {
      const rawT = (i + 0.5) / count;
      const tStem = isStar ? 0.12 + 0.88 * Math.pow(rawT, 0.78) : 0.05 + 0.93 * rawT;
      const fr = stem.atT(tStem);
      const az = i * GOLDEN_ANGLE + phase * TAU;

      const radial = normalize(add(scale(fr.right, Math.cos(az)), scale(fr.up, Math.sin(az))));
      const attach = addScaled(fr.pos, radial, stemR * (1 - 0.4 * tStem));

      let spreadDeg = lerp1(18, isStar ? 74 : isCushion ? 42 : p.habit === 'velvet_carpet' ? 48 : 56, p.hydration);
      if (isStar && tStem > 0.78) {
        spreadDeg = lerp1(spreadDeg, 82, (tStem - 0.78) / 0.22);
      } else if (tStem < 0.25) {
        spreadDeg *= 0.7;
      }
      const spreadRad = (spreadDeg + rng.vary(0, 5)) * DEG2RAD;

      const leafDir = normalize(add(scale(fr.dir, Math.cos(spreadRad)), scale(radial, Math.sin(spreadRad))));
      let leafRight = normalize(cross(fr.dir, radial));
      if (isFeather) {
        leafRight = rotateAxis(leafRight, leafDir, 0.28);
      }

      const sizeEnv = isStar
        ? smoothstep(0.0, 0.35, tStem) * (1 - 0.32 * smoothstep(0.88, 1.0, tStem))
        : Math.sin(Math.pow(tStem, 0.65) * Math.PI * 0.92) * 0.75 + 0.25;
      const pLen = Math.max(0.0008, baseLen * (0.45 + 0.68 * sizeEnv) * rng.range(0.88, 1.12));
      const pWid = Math.max(0.00025, baseWid * (0.52 + 0.58 * sizeEnv));

      let baseCol = mixRgb(colBase, colCanopy, smoothstep(0.06, 0.44, tStem));
      baseCol = mixRgb(baseCol, colTip, smoothstep(0.58, 1.0, tStem) * 0.88);

      const relLeafRatio = (pLen / Math.max(0.004, shootL)) * 0.55;

      this.addKeeledPhyllid(
        mesh,
        attach,
        leafDir,
        leafRight,
        pLen,
        pWid,
        p.phyllidCurl * (1.35 - 0.65 * p.hydration),
        p.hyalineHairPoint * smoothstep(0.35, 0.75, tStem),
        baseCol,
        mixRgb(baseCol, colTip, 0.48),
        colHyaline,
        rootPivot,
        tStem,
        relLeafRatio,
        shootFlexAt,
        phase,
        tier >= 3 ? 3 : 2,
      );
      this.stats.phyllids++;
    }
  }

  private addKeeledPhyllid(
    mesh: PartMesh,
    origin: V3,
    dir0: V3,
    right0: V3,
    len: number,
    wid: number,
    curl: number,
    hairPointFrac: number,
    colBase: RGB,
    colApex: RGB,
    colHyaline: RGB,
    rootPivot: V3,
    tStem: number,
    relLeafRatio: number,
    shootFlexAt: (tNorm: number) => number,
    phase: number,
    segs: number,
  ): void {
    const up0 = normalize(cross(dir0, right0));
    const hasAwn = hairPointFrac > 0.04;
    const bladeLen = len;

    let p = origin;
    let d = dir0;
    const r = right0;
    let u = up0;

    const rows: number[][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const hw = wid * 0.5 * Math.sin(Math.pow(t, 0.55) * Math.PI * 0.96) * (1 - t * 0.25);
      const keelDepth = hw * 0.42 * (1 - t * 0.5);
      const col = mixRgb(colBase, colApex, t * t);

      // Exact continuous flex welded to the stem at t = 0!
      const tEff = tStem + t * relLeafRatio;
      const flex = shootFlexAt(tEff);
      const wind: [number, number, number, number] = [saturate(tEff * 0.5), flex, phase, t * 0.08];

      if (s === segs && !hasAwn) {
        const tipV = mesh.addVertex({
          x: p.x, y: p.y, z: p.z, tx: d.x, ty: d.y, tz: d.z, u: 0.5, v: 1,
          color: colApex, wind, pivot: rootPivot, roughness: 0.42, translucency: 0.8, detailMetric: 0.95, anatomyLevel: 3,
        });
        rows.push([tipV]);
      } else {
        const leftPt = add(addScaled(p, r, -hw), scale(u, keelDepth));
        const midPt = addScaled(p, u, -keelDepth * 0.35);
        const rightPt = add(addScaled(p, r, hw), scale(u, keelDepth));

        const vL = mesh.addVertex({
          x: leftPt.x, y: leftPt.y, z: leftPt.z, tx: d.x, ty: d.y, tz: d.z, u: 0, v: t,
          color: col, wind, pivot: rootPivot, roughness: 0.45, translucency: 0.74, detailMetric: 0.35, anatomyLevel: 3,
        });
        const vM = mesh.addVertex({
          x: midPt.x, y: midPt.y, z: midPt.z, tx: d.x, ty: d.y, tz: d.z, u: 0.5, v: t,
          color: mixRgb(col, colApex, 0.3), wind, pivot: rootPivot, roughness: 0.4, translucency: 0.55, detailMetric: 0.9, anatomyLevel: 3,
        });
        const vR = mesh.addVertex({
          x: rightPt.x, y: rightPt.y, z: rightPt.z, tx: d.x, ty: d.y, tz: d.z, u: 1, v: t,
          color: col, wind, pivot: rootPivot, roughness: 0.45, translucency: 0.74, detailMetric: 0.35, anatomyLevel: 3,
        });
        rows.push([vL, vM, vR]);
      }

      if (s < segs) {
        const pitchStep = (curl * 0.85) / segs;
        d = normalize(rotateAxis(d, r, pitchStep));
        u = normalize(cross(d, r));
        p = addScaled(p, d, bladeLen / segs);
      }
    }

    for (let s = 0; s < segs - 1; s++) {
      const a = rows[s];
      const b = rows[s + 1];
      mesh.addQuad(a[0], a[1], b[1], b[0]);
      mesh.addQuad(a[1], a[2], b[2], b[1]);
    }

    if (hasAwn) {
      const awnTipPos = addScaled(p, normalize(add(d, scale(UP, 0.25))), bladeLen * hairPointFrac);
      const last = rows[segs];
      const tEffAwn = tStem + (1 + hairPointFrac) * relLeafRatio;
      const awnTip = mesh.addVertex({
        x: awnTipPos.x, y: awnTipPos.y, z: awnTipPos.z, tx: d.x, ty: d.y, tz: d.z, u: 0.5, v: 1,
        color: colHyaline,
        wind: [saturate(tEffAwn * 0.5), shootFlexAt(tEffAwn), phase, 0.12],
        pivot: rootPivot, roughness: 0.28, translucency: 0.92, detailMetric: 1.0, anatomyLevel: 3,
      });
      mesh.addQuad(rows[segs - 1][0], rows[segs - 1][1], last[1], last[0]);
      mesh.addQuad(rows[segs - 1][1], rows[segs - 1][2], last[2], last[1]);
      mesh.addTri(last[0], last[1], awnTip);
      mesh.addTri(last[1], last[2], awnTip);
    } else {
      const pre = rows[segs - 1];
      const tip = rows[segs][0];
      mesh.addTri(pre[0], pre[1], tip);
      mesh.addTri(pre[1], pre[2], tip);
    }
  }

  // ---------------------------------------------------------------------------
  // Pleurocarp / Velvet Branchlets & Sphagnum Capitula
  // ---------------------------------------------------------------------------

  private buildShootBranchlets(
    stemMesh: PartMesh,
    phyllidMesh: PartMesh,
    mainStem: CurveLine,
    nBranches: number,
    shootL: number,
    stemR: number,
    phyllidL: number,
    phyllidW: number,
    colBase: RGB,
    colCanopy: RGB,
    colTip: RGB,
    colHyaline: RGB,
    rootPivot: V3,
    shootFlexAt: (tNorm: number) => number,
    phase: number,
    rng: Random,
    tier: number,
  ): void {
    const isSphagnum = this.p.habit === 'sphagnum_bog';
    for (let b = 0; b < nBranches; b++) {
      const u = isSphagnum
        ? b < nBranches * 0.55
          ? 0.84 + 0.16 * (b / (nBranches * 0.55))
          : 0.25 + 0.58 * ((b - nBranches * 0.55) / Math.max(1, nBranches * 0.45))
        : 0.16 + 0.78 * (b / nBranches);

      const fr = mainStem.atT(u);
      const side = b % 2 === 0 ? 1 : -1;
      let brDir: V3;
      let brLen: number;

      if (isSphagnum && u > 0.82) {
        const az = b * GOLDEN_ANGLE;
        const rad = normalize(add(scale(fr.right, Math.cos(az)), scale(fr.up, Math.sin(az))));
        brDir = normalize(add(scale(fr.dir, 0.45), scale(rad, 0.89)));
        brLen = shootL * 0.22 * rng.range(0.8, 1.15);
      } else if (isSphagnum) {
        const az = b * GOLDEN_ANGLE;
        const rad = normalize(add(scale(fr.right, Math.cos(az)), scale(fr.up, Math.sin(az))));
        brDir = normalize(add(scale(rad, 0.78), scale(fr.dir, -0.35)));
        brLen = shootL * 0.34;
      } else {
        brDir = normalize(add(scale(fr.dir, 0.58), scale(fr.right, side * 0.81)));
        brLen = shootL * 0.38 * Math.sin(Math.pow(u, 0.7) * Math.PI * 0.92 + 0.15);
      }

      if (brLen < 0.0015) continue;
      const brLine = growCurve(fr.pos, brDir, fr.up, brLen, 4, (t0, t1) => ({
        gravity: (t1 - t0) * (isSphagnum && u <= 0.82 ? 0.55 : 0.18),
      }));

      // Continuous flex starting at parent stem station `u`!
      const brRatio = brLen / Math.max(0.004, shootL);
      const brFlexAt = (tb: number): number => shootFlexAt(u + tb * brRatio * 0.8);

      this.meshShootTube(stemMesh, brLine, stemR * 0.65, stemR * 0.3, 4, colBase, colCanopy, rootPivot, brFlexAt, phase, 2);
      this.stats.branchlets++;

      const leafN = clamp(Math.round((tier >= 3 ? 7 : 5) * (isSphagnum && u > 0.82 ? 1.3 : 1.0)), 4, 12);
      this.populateShootPhyllids(
        phyllidMesh,
        brLine,
        brLen,
        leafN,
        phyllidL * 0.68,
        phyllidW * 0.72,
        stemR * 0.55,
        colCanopy,
        isSphagnum && u > 0.82 ? colTip : colCanopy,
        colTip,
        colHyaline,
        rootPivot,
        brFlexAt,
        phase,
        rng,
        Math.max(1, tier - 1),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Sporophyte: Wiry Seta Stalk + Welded 3D Spore Capsule & Operculum
  // ---------------------------------------------------------------------------

  private buildSporophyte(
    setaMesh: PartMesh,
    capsuleMesh: PartMesh,
    attachPos: V3,
    rootPivot: V3,
    baseFlex: number,
    windComp: number,
    surfNormal: V3,
    colSetaBase: RGB,
    colCapsule: RGB,
    colOperculum: RGB,
    phase: number,
    rng: Random,
    tier: number,
  ): void {
    const p = this.p;
    const setaH = p.setaHeightMm * 0.001 * rng.range(0.84, 1.16);
    const capL = p.capsuleLengthMm * 0.001 * rng.range(0.9, 1.12);
    const nodRad = (p.capsuleNodDeg + rng.vary(0, 10)) * DEG2RAD;
    const setaR = Math.max(0.00014, capL * 0.055);

    const leanAz = rng.range(0, TAU);
    const horiz = v3(Math.cos(leanAz), 0, Math.sin(leanAz));
    const dir0 = normalize(add(scale(UP, 0.88), addScaled(scale(surfNormal, 0.18), horiz, 0.1)));
    const right0 = normalize(cross(UP, horiz));

    const steps = 12 + tier * 2;
    const hookAt = (t: number): number => 0.1 * t + nodRad * Math.pow(smoothstep(0.8, 1.0, t), 1.7);
    const setaLine = growCurve(attachPos, dir0, right0, setaH, steps, (t0, t1) => ({
      pitch: hookAt(t1) - hookAt(t0),
      yaw: Math.sin(t1 * 4 + phase * TAU) * 0.015,
    }));

    const setaFlexAt = (ts: number): number => baseFlex + Math.pow(ts, 1.55) * 1.05 * windComp;
    this.meshShootTube(setaMesh, setaLine, setaR * 1.15, setaR * 0.85, 5, colSetaBase, colCapsule, rootPivot, setaFlexAt, phase, 4);

    // Sculpted 3D Spore Capsule welded to seta tip (`ts = 1.0`, zero normal ballooning!)
    const tip = setaLine.atT(1.0);
    const tipFlex = setaFlexAt(1.0);
    const capSides = p.habit === 'acrocarp_star' ? 4 : 8 + tier * 2;
    const profile: [number, number, RGB, number][] = [
      [0.0, setaR * 0.9, colSetaBase, 0.45],
      [0.14, capL * 0.14, colCapsule, 0.42],
      [0.28, capL * 0.24, colCapsule, 0.38],
      [0.58, capL * 0.27, colCapsule, 0.36],
      [0.76, capL * 0.23, mixRgb(colCapsule, hexToLinearRgb('#7d2914'), 0.45), 0.32],
      [0.8, capL * 0.245, mixRgb(colCapsule, colOperculum, 0.45), 0.3],
      [0.92, capL * 0.11, mixRgb(colCapsule, colOperculum, 0.65), 0.35],
      [1.0, 0.00004, colOperculum, 0.35],
    ];

    const rings: number[][] = [];
    for (const [t, rad, col, rough] of profile) {
      const cPos = addScaled(tip.pos, tip.dir, t * capL);
      // Rigidly share tipFlex along the tiny rigid urn so the capsule never stretches or deforms!
      const row: number[] = [];
      for (let j = 0; j < capSides; j++) {
        const th = (j / capSides) * TAU + Math.PI * 0.25;
        const off = add(scale(tip.right, Math.cos(th) * rad), scale(tip.up, Math.sin(th) * rad));
        const pt = add(cPos, off);
        row.push(
          capsuleMesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: tip.dir.x, ty: tip.dir.y, tz: tip.dir.z,
            u: j / capSides, v: t,
            color: col,
            wind: [0.65, tipFlex, phase, 0.0],
            pivot: rootPivot,
            roughness: rough,
            translucency: 0.32,
            detailMetric: t,
            anatomyLevel: 5,
          }),
        );
      }
      rings.push(row);
    }

    for (let r = 0; r < rings.length - 1; r++) {
      for (let j = 0; j < capSides; j++) {
        const j1 = (j + 1) % capSides;
        capsuleMesh.addQuad(rings[r][j], rings[r][j1], rings[r + 1][j1], rings[r + 1][j]);
      }
    }
  }

  private addRhizoidFilament(
    mesh: PartMesh,
    pos: V3,
    surfNormal: V3,
    len: number,
    rad: number,
    col: RGB,
    rng: Random,
  ): void {
    const tan = anyPerpendicular(surfNormal);
    const tan2 = normalize(cross(surfNormal, tan));
    const az = rng.range(0, TAU);
    const crawl = normalize(
      add(addScaled(scale(tan, Math.cos(az)), tan2, Math.sin(az)), scale(surfNormal, -0.15)),
    );
    const line = growCurve(addScaled(pos, surfNormal, rad * 1.5), crawl, surfNormal, len, 4, (t0, t1) => ({
      yaw: rng.vary(0, 0.55) * (t1 - t0) * 3,
      pitch: (t1 - t0) * 0.25,
    }));
    // Anchored rhizoids have flex = 0 so they stay rooted to soil/rock!
    this.meshShootTube(mesh, line, rad, rad * 0.3, 3, col, mixRgb(col, hexToLinearRgb('#26170d'), 0.5), pos, () => 0, 0, 1);
  }

  private meshShootTube(
    mesh: PartMesh,
    line: CurveLine,
    r0: number,
    r1: number,
    sides: number,
    col0: RGB,
    col1: RGB,
    rootPivot: V3,
    flexAt: (t: number) => number,
    phase: number,
    anatomyLevel: number,
  ): void {
    const K = line.count;
    const rings: number[][] = [];
    for (let i = 0; i < K; i++) {
      const fr = line.frameAtIndex(i);
      const t = fr.t;
      const r = lerp1(r0, r1, t);
      const col = mixRgb(col0, col1, t);
      const flex = flexAt(t);
      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const pt = add(fr.pos, add(scale(fr.right, Math.cos(th) * r), scale(fr.up, Math.sin(th) * r)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
            u: j / sides, v: t,
            color: col,
            wind: [saturate(t * 0.5), flex, phase, 0.0],
            pivot: rootPivot,
            roughness: 0.45,
            translucency: 0.24,
            detailMetric: t,
            anatomyLevel,
          }),
        );
      }
      rings.push(row);
    }
    for (let i = 0; i < K - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
  }
}

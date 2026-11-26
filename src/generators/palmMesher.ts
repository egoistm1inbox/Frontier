/**
 * Anatomically Accurate Fruiting Palm Generator (`src/generators/palmMesher.ts`).
 *
 * Synthesizes 5 distinct botanical palm architectures:
 *  1. Medjool Date Palm (`Phoenix dactylifera`) — spiral diamond leaf-boots,
 *     dense glaucous V-ranked fountain crown, golden-orange spadices & weeping
 *     strands of plump 3D Medjool/Barhi dates.
 *  2. Coastal Coconut Palm (`Cocos nucifera`) — leaning S-curved ringed trunk
 *     with welded root bole, woven burlap sheaths, graceful drooping feather
 *     fronds, and axil bunches of large 3-angled 3D husked coconuts.
 *  3. Cuban Royal Palm (`Roystonea regia`) — smooth concrete-grey column,
 *     glossy emerald tubular crownshaft, multi-plane plumose fronds, and
 *     infrafoliar branched panicles of violet-crimson drupes.
 *  4. Desert Oasis Fan Palm (`Washingtonia`) — stout desert trunk, golden shag
 *     petticoat skirt, 3D accordion-pleated costapalmate fan blades with
 *     hastula & armed petioles, and long cascading black-berry stalks.
 *  5. Branching Doum Palm (`Hyphaene thebaica`) — true dichotomous Y-forking
 *     trunk (`1 -> 2 -> 4` aerial crowns welded into 1 closed quad manifold
 *     via `WeldedMesher`), costapalmate fans & glossy gingerbread Doum fruits.
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
  clone,
  cross,
  dot,
  growCurve,
  hexToLinearRgb,
  length,
  lengthSq,
  lerp,
  lerp1,
  mixRgb,
  normalize,
  projectOnPlane,
  rotateAxis,
  saturate,
  scale,
  smoothstep,
  sub,
  v3,
} from '../core/math';
import { PartMesh } from '../core/mesh';
import { fbm3 } from '../core/noise';
import { Random } from '../core/random';
import {
  WeldedMeshConfig,
  WeldedMesher,
  WeldedNode,
  WeldedStem,
  sampleWeldedStem,
  validateWeldedManifold,
} from '../core/weldedManifold';
import { HostSubstrate } from '../substrates/substrate';
import { PalmParams } from './palmParams';

export interface PalmStats {
  crowns: number;
  fronds: number;
  leaflets: number;
  fruitBunches: number;
  fruits: number;
  weldedJunctions: number;
  weldedForks: number;
  closedTrunkManifold: boolean;
  height: number;
}

export interface PalmBuildResult {
  parts: PartMesh[];
  stats: PalmStats;
}

interface CrownTip {
  stem: WeldedStem;
  scale: number;
}

export class PalmMesher {
  private readonly p: PalmParams;
  private readonly rng: Random;
  private readonly substrate: HostSubstrate;
  private stats: PalmStats = {
    crowns: 0,
    fronds: 0,
    leaflets: 0,
    fruitBunches: 0,
    fruits: 0,
    weldedJunctions: 0,
    weldedForks: 0,
    closedTrunkManifold: true,
    height: 8.0,
  };
  private nextId = 0;
  private lobePhase = 0;
  private palmPhase = 0.08;

  constructor(params: PalmParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.rng = new Random((seed ^ 0x9a1b5eed) >>> 0);
    this.substrate = substrate;
    this.lobePhase = ((seed % 360) * Math.PI) / 180;
    this.palmPhase = 0.08 + (((seed >>> 0) % 997) / 997) * 0.05;
  }

  build(layerId: string): PalmBuildResult {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);

    const trunkMesh = new PartMesh(
      `${layerId}:skeleton`,
      'Welded Trunk, Bole & Forks',
      'botanical',
      layerId,
      'tussock',
      '#b88b58',
    );
    const rachisMesh = new PartMesh(
      `${layerId}:rachises`,
      'Crown Boots, Petioles & Rachises',
      'botanical',
      layerId,
      'tussock',
      '#6ca13c',
    );
    const leafletMesh = new PartMesh(
      `${layerId}:leaflets`,
      p.species === 'fan_palm' || p.species === 'doum_palm'
        ? '3D Costapalmate Fan Blades'
        : '3D Pinnate Frond Leaflets',
      'botanical',
      layerId,
      'leaf',
      p.hueFrondTip,
    );
    const fruitMesh = new PartMesh(
      `${layerId}:fruits`,
      p.species === 'coconut_palm'
        ? '3D Husked Coconut Bunches'
        : p.species === 'date_palm'
          ? '3D Medjool Date Spadices'
          : '3D Palm Fruit Panicles',
      'botanical',
      layerId,
      'sparkles',
      p.hueFruit,
    );

    const groundSample = this.substrate.sampleSurface(0.5, 0.5);
    const groundOrigin = groundSample.pos;

    // 1. Build welded trunk + basal root buttresses + optional Y-forks (`Doum Palm`)
    const { trunkRoot, crownTips, trunkCfg } = this.buildWeldedTrunkHierarchy(groundOrigin, tier);
    const wStats = new WeldedMesher(trunkMesh, [trunkRoot], trunkCfg).build();
    const topo = validateWeldedManifold(trunkMesh);

    this.stats.weldedJunctions = wStats.junctions;
    this.stats.weldedForks = wStats.forks;
    this.stats.closedTrunkManifold = topo.closed && topo.manifold && topo.components === 1;
    this.stats.crowns = crownTips.length;

    // 2. Build spiral crown rosettes + 3D fruits on each terminal crown!
    const palmPhase = this.palmPhase;
    for (let cIdx = 0; cIdx < crownTips.length; cIdx++) {
      const tip = crownTips[cIdx];
      const cRng = this.rng.fork(0x4400 + cIdx * 131);
      this.buildPalmCrownAndFruits(
        tip,
        cIdx,
        groundOrigin,
        palmPhase,
        tier,
        rachisMesh,
        leafletMesh,
        fruitMesh,
        cRng,
      );
    }

    trunkMesh.metaLabel =
      wStats.forks > 0
        ? `${crownTips.length} crowns · ${wStats.forks} Y-forks`
        : `${wStats.junctions} welded roots`;
    rachisMesh.metaLabel = `${this.stats.fronds} fronds`;
    leafletMesh.metaLabel = `${this.stats.leaflets.toLocaleString('en-US')} ${
      p.species === 'fan_palm' || p.species === 'doum_palm' ? 'pleats' : 'pinnae'
    }`;
    fruitMesh.metaLabel = `${this.stats.fruits.toLocaleString('en-US')} fruits`;

    const parts = [trunkMesh, rachisMesh, leafletMesh, fruitMesh].filter((m) => m.faceCount > 0);
    let maxY = 1.0;
    for (const part of parts) {
      const pos = part.positions;
      for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
    }
    this.stats.height = maxY;

    return { parts, stats: this.stats };
  }

  // ---------------------------------------------------------------------------
  // 1. Welded Trunk, Basal Root Bole, Crownshaft & Dichotomous Y-Forks
  // ---------------------------------------------------------------------------

  private buildWeldedTrunkHierarchy(
    groundOrigin: V3,
    tier: number,
  ): { trunkRoot: WeldedStem; crownTips: CrownTip[]; trunkCfg: WeldedMeshConfig } {
    const p = this.p;
    const radialSegs = tier === 1 ? 18 : tier === 2 ? 24 : tier === 3 ? 30 : 36;
    const trunkCfg: WeldedMeshConfig = {
      trunkRadialSegments: radialSegs,
      minRadialSegments: tier >= 3 ? 8 : 6,
      collarScale: 1.25,
      collarLength: 1.15,
      collarRings: tier >= 3 ? 2 : 1,
      collarFillet: 0.78,
      collarMitre: 0.5,
      minRadius: 0.008,
      capTips: true,
    };

    const colBark = hexToLinearRgb(p.hueTrunk);
    const colBarkDark = mixRgb(colBark, hexToLinearRgb('#1c140d'), 0.52);
    const colBarkWeathered = mixRgb(colBark, hexToLinearRgb('#a89f91'), 0.38);
    const colSoilRoot = hexToLinearRgb('#524437');
    const colCrownshaft = hexToLinearRgb('#1f6120');
    const colCrownshaftHi = hexToLinearRgb('#3d852c');

    const forkLevels = clamp(Math.round(p.forkLevels), 0, 2);
    const baseLen = forkLevels === 0 ? p.trunkHeight : p.trunkHeight * (forkLevels === 1 ? 0.54 : 0.42);
    const leanAz = this.rng.range(0, TAU);
    const leanHoriz = v3(Math.cos(leanAz), 0, Math.sin(leanAz));
    const leanRad = p.trunkLeanDeg * DEG2RAD;
    const dir0 = normalize(add(scale(UP, Math.cos(leanRad)), scale(leanHoriz, Math.sin(leanRad))));
    const right0 = normalize(cross(UP, leanHoriz));
    const palmPhase = this.palmPhase;
    const totalEstH = Math.max(2.5, p.trunkHeight + p.frondLength * 0.65);

    const crownTips: CrownTip[] = [];
    const lobes = Math.max(4, Math.round(p.rootButtresses || 5));

    const makeTrunkSegment = (
      origin: V3,
      startDir: V3,
      startRight: V3,
      segLen: number,
      baseR: number,
      endR: number,
      level: number,
      parent: WeldedStem | null,
      attach: WeldedStem['attach'],
      zGlobal0: number,
      zGlobal1: number,
    ): WeldedStem => {
      const nSteps = Math.max(12, Math.round((segLen / 0.25) * (tier >= 3 ? 1.2 : 0.85)));
      const curveRad = (level === 0 ? p.trunkCurveDeg : 18) * DEG2RAD;
      const nodes: WeldedNode[] = [];
      let pos = clone(origin);
      let dir = normalize(startDir);
      let right = projectOnPlane(startRight, dir);
      if (lengthSq(right) < 1e-8) right = anyPerpendicular(dir);
      right = normalize(right);

      nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s: 0 });
      const stepLen = segLen / nSteps;
      let s = 0;

      for (let i = 1; i <= nSteps; i++) {
        const t = i / nSteps;
        if (level === 0) {
          // Graceful coastal S-curve sweeping back toward sun-vertical!
          const pitchUp = (curveRad / nSteps) * (0.4 + 1.2 * t);
          const rotAx = normalize(cross(dir, UP));
          if (lengthSq(rotAx) > 1e-8 && Math.abs(pitchUp) > 1e-5) {
            dir = normalize(rotateAxis(dir, rotAx, -pitchUp));
          }
        } else {
          // Forked aerial Doum stems curve gently upward into a wide candelabrum posture!
          const upPull = cross(dir, UP);
          const mag = length(upPull);
          if (mag > 1e-6) {
            dir = normalize(rotateAxis(dir, scale(upPull, 1 / mag), (15 * DEG2RAD * (1 - t * 0.4)) / nSteps));
          }
        }
        right = projectOnPlane(right, dir);
        if (lengthSq(right) < 1e-8) right = anyPerpendicular(dir);
        right = normalize(right);
        pos = addScaled(pos, dir, stepLen);
        s += stepLen;
        nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s });
      }

      const csRatio = forkLevels === 0 ? clamp(p.crownshaftRatio, 0, 0.26) : 0;
      const csStartZ = 1.0 - csRatio;

      const stem: WeldedStem = {
        id: this.nextId++,
        level,
        role: 'shoot',
        parent,
        attach,
        attachS: 0,
        attachDir: clone(startDir),
        nodes,
        length: s,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 1,
        ringSpacing: clamp(baseR * 0.22, 0.028, 0.068),
        baseRadiusAt: (sVal: number) => {
          const tLoc = clamp(sVal / Math.max(1e-5, s), 0, 1);
          const z = lerp1(zGlobal0, zGlobal1, tLoc);
          let r = lerp1(baseR, endR, Math.pow(tLoc, 0.88));
          if (level === 0) {
            // Basal adventitious root-bole swelling
            r *= 1 + p.basalBole * Math.exp(-Math.max(0, z) * 6.8);
            // Royal palm subtle mid-column entasis + smooth crownshaft collar bulge
            if (p.species === 'royal_palm') {
              r *= 1 + 0.12 * Math.sin(Math.PI * clamp(z / Math.max(0.4, csStartZ), 0, 1));
            }
            if (csRatio > 0.02 && z >= csStartZ - 0.03) {
              const csT = saturate((z - (csStartZ - 0.02)) / Math.max(0.02, csRatio));
              r *= 1 + 0.075 * Math.sin(Math.PI * Math.pow(csT, 0.75)) - 0.04 * smoothstep(0.85, 1.0, csT);
            }
          }
          return Math.max(trunkCfg.minRadius, r);
        },
        profileFactor: (sVal: number, th: number) => {
          const tLoc = clamp(sVal / Math.max(1e-5, s), 0, 1);
          const z = lerp1(zGlobal0, zGlobal1, tLoc);
          let mult = 1.0;

          // Root-aligned basal buttress fluting
          if (level === 0 && z < 0.14 && p.rootButtresses > 0) {
            const fall = clamp(1 - Math.max(0, z) / 0.14, 0, 1);
            mult *= 1 + 0.18 * fall * fall * (0.5 + 0.5 * Math.cos(lobes * th + this.lobePhase));
          }

          // Smooth tubular green crownshaft has no rough bark boots
          if (csRatio > 0.02 && z >= csStartZ) {
            return mult * (1 + 0.012 * Math.cos(th * 3));
          }

          const relief = clamp(p.trunkRelief, 0, 1);
          const barkWarp = fbm3(Math.cos(th) * 1.8, z * p.trunkHeight * 2.4, Math.sin(th) * 1.8, 311, 2);
          if (p.species === 'date_palm' || p.species === 'fan_palm') {
            // Imbricate phyllotactic 8 & 13 spiral diamond leaf-base boots with crisp cleft crevices!
            const uA = (8 * th) / TAU + z * p.trunkHeight * 2.65 + barkWarp * 0.12;
            const uB = (-5 * th) / TAU + z * p.trunkHeight * 2.65 - barkWarp * 0.12;
            const dA = Math.abs(uA - Math.floor(uA) - 0.5) * 2.0;
            const dB = Math.abs(uB - Math.floor(uB) - 0.5) * 2.0;
            const boot = clamp(1.0 - Math.max(dA, dB), 0, 1);
            const bootRidge = Math.pow(boot, 0.58);
            mult *= 1 + relief * 0.11 * bootRidge;
          } else {
            // Fine irregular 6-9 cm fibrous annular leaf-scar rings + vertical vascular striations (no wide candy stripes!)
            const ringDensity = p.species === 'royal_palm' ? 42.0 : 56.0;
            const ringPhase = z * p.trunkHeight * ringDensity + barkWarp * 2.6 + Math.sin(th * 3) * 0.35;
            const scar = Math.pow(0.5 + 0.5 * Math.cos(ringPhase), 3.2);
            const vertFibers = 0.5 + 0.5 * Math.cos(th * 28 + barkWarp * 5.0);
            mult *= 1 + relief * (p.species === 'royal_palm' ? 0.016 : 0.036) * scar + relief * 0.009 * vertFibers;
          }
          return mult;
        },
        styleAt: (sVal: number, th: number, pos: V3, _dir: V3, isJunc: boolean) => {
          const tLoc = clamp(sVal / Math.max(1e-5, s), 0, 1);
          const z = lerp1(zGlobal0, zGlobal1, tLoc);
          const h01 = saturate((pos.y - groundOrigin.y) / totalEstH);
          const rootAnchor = smoothstep(0.025, 0.12, h01);
          const trunkFlex = rootAnchor * Math.pow(h01, 1.55) * 0.15 * p.windSway;

          if (csRatio > 0.02 && z >= csStartZ) {
            const csT = saturate((z - csStartZ) / Math.max(0.01, csRatio));
            const sheen = 0.5 + 0.5 * Math.cos(th * 2 + csT * 3.0);
            return {
              color: mixRgb(colCrownshaft, colCrownshaftHi, sheen * 0.38 + csT * 0.18),
              roughness: 0.24,
              translucency: 0.18,
              detailMetric: isJunc ? 0.96 : 0.72,
              anatomyLevel: 2,
              wind: [h01, trunkFlex, palmPhase, 0],
              pivot: groundOrigin,
            };
          }

          const barkWarp = fbm3(Math.cos(th) * 1.8, z * p.trunkHeight * 2.4, Math.sin(th) * 1.8, 311, 3);
          const mottle = saturate(0.5 + 0.5 * fbm3(pos.x * 2.1, pos.y * 0.9, pos.z * 2.1, 709, 3));
          const vertFibers = 0.5 + 0.5 * Math.cos(th * 32 + barkWarp * 6.0);
          let barkCol: RGB;
          if (p.species === 'date_palm' || p.species === 'fan_palm') {
            const uA = (8 * th) / TAU + z * p.trunkHeight * 2.65 + barkWarp * 0.12;
            const uB = (-5 * th) / TAU + z * p.trunkHeight * 2.65 - barkWarp * 0.12;
            const dA = Math.abs(uA - Math.floor(uA) - 0.5) * 2.0;
            const dB = Math.abs(uB - Math.floor(uB) - 0.5) * 2.0;
            const boot = clamp(1.0 - Math.max(dA, dB), 0, 1);
            const body = mixRgb(colBark, colBarkWeathered, saturate(z * 0.35 + mottle * 0.32));
            barkCol = mixRgb(colBarkDark, body, smoothstep(0.06, 0.78, boot) * (0.82 + 0.18 * vertFibers));
          } else {
            const ringDensity = p.species === 'royal_palm' ? 42.0 : 56.0;
            const ringPhase = z * p.trunkHeight * ringDensity + barkWarp * 2.6 + Math.sin(th * 3) * 0.35;
            const scar = Math.pow(0.5 + 0.5 * Math.cos(ringPhase), 3.4);
            const fiberTone = mixRgb(colBark, colBarkDark, (1 - vertFibers) * 0.28 + (1 - mottle) * 0.22);
            barkCol = mixRgb(fiberTone, colBarkWeathered, scar * 0.42 + mottle * 0.22);
            const rootCollar = mixRgb(colBarkDark, colSoilRoot, 0.55);
            barkCol = mixRgb(rootCollar, barkCol, smoothstep(0.0, 0.12, Math.max(0, z)));
          }

          return {
            color: barkCol,
            roughness: p.species === 'royal_palm' ? 0.58 : 0.84,
            translucency: 0.03,
            detailMetric: isJunc ? 0.98 : 0.35 + 0.3 * vertFibers,
            anatomyLevel: 1,
            wind: [h01, trunkFlex, palmPhase, 0],
            pivot: groundOrigin,
          };
        },
      };

      // Dense axial stations around crownshaft transition & basal root flare
      if (level === 0 && csRatio > 0.02) {
        const sCs = csStartZ * s;
        stem.extraStations = [sCs - 0.06, sCs - 0.02, sCs, sCs + 0.03];
      }

      if (level < forkLevels) {
        const endNode = nodes[nodes.length - 1];
        const nextLen = p.trunkHeight * (forkLevels === 1 ? 0.48 : level === 0 ? 0.32 : 0.30);
        const childR0 = endR * 0.78;
        const childR1 = childR0 * 0.82;
        const spreadAz = level === 0 ? leanAz + 0.6 : leanAz + 0.6 + Math.PI * 0.5;
        const spreadAxis = normalize(v3(Math.cos(spreadAz), 0, Math.sin(spreadAz)));
        const halfSplit = (level === 0 ? 30 : 25) * DEG2RAD;

        for (const side of [-1, 1]) {
          const cDir = normalize(rotateAxis(endNode.dir, spreadAxis, side * halfSplit));
          const cRight = normalize(projectOnPlane(endNode.right, cDir));
          const fChild = makeTrunkSegment(
            endNode.pos,
            cDir,
            cRight,
            nextLen,
            childR0,
            childR1,
            level + 1,
            stem,
            'fork',
            zGlobal1,
            lerp1(zGlobal1, 1.0, 0.55),
          );
          stem.forks.push(fChild);
        }
      } else {
        crownTips.push({ stem, scale: forkLevels === 0 ? 1.0 : forkLevels === 1 ? 0.78 : 0.66 });
      }

      return stem;
    };

    const topR =
      p.species === 'coconut_palm'
        ? p.trunkRadius * 0.64
        : p.species === 'royal_palm'
          ? p.trunkRadius * 0.82
          : p.trunkRadius * 0.84;

    const trunkRoot = makeTrunkSegment(
      groundOrigin,
      dir0,
      right0,
      baseLen,
      p.trunkRadius,
      forkLevels > 0 ? p.trunkRadius * 0.82 : topR,
      0,
      null,
      'root',
      0,
      forkLevels === 0 ? 1.0 : 0.45,
    );

    // Attach welded anchoring root lobes at base of palm trunk!
    if (p.rootButtresses > 0) {
      this.attachWeldedPalmRoots(trunkRoot, groundOrigin, lobes, trunkCfg, colBarkDark, colBark);
    }

    return { trunkRoot, crownTips, trunkCfg };
  }

  private attachWeldedPalmRoots(
    trunk: WeldedStem,
    groundOrigin: V3,
    lobes: number,
    cfg: WeldedMeshConfig,
    colDark: RGB,
    colBark: RGB,
  ): void {
    const N = cfg.trunkRadialSegments;
    const colStep = TAU / N;
    const count = Math.min(lobes, Math.floor(N / 2) - 1);
    const rcBase = Math.max(0.035, this.p.trunkRadius * 0.24);
    const stubDepth = rcBase * 2.4 + 0.06;

    // Extend trunk base slightly below ground so root collars weld cleanly at soil level
    const n0 = trunk.nodes[0];
    const d0 = normalize(n0.dir);
    for (const nd of trunk.nodes) nd.s += stubDepth;
    const subBase = addScaled(n0.pos, d0, -stubDepth);
    trunk.nodes.unshift(
      { pos: subBase, dir: clone(d0), right: clone(n0.right), s: 0 },
      { pos: addScaled(subBase, d0, stubDepth * 0.5), dir: clone(d0), right: clone(n0.right), s: stubDepth * 0.5 },
    );
    trunk.length += stubDepth;

    for (let k = 0; k < count; k++) {
      const col = Math.round(((k / count) * N)) % N;
      const theta = (col + 1) * colStep;
      const attachS = stubDepth + rcBase * 0.55;
      const smp = sampleWeldedStem(trunk, attachS);
      const up = cross(smp.dir, smp.right);
      const radial = normalize(add(scale(smp.right, Math.cos(theta)), scale(up, Math.sin(theta))));
      const rSurf = trunk.baseRadiusAt(attachS) * (trunk.profileFactor ? trunk.profileFactor(attachS, theta) : 1);
      const origin = addScaled(smp.pos, radial, rSurf);
      const horizAx = normalize(cross(radial, UP));
      const emergeDir = normalize(rotateAxis(radial, horizAx, -28 * DEG2RAD));
      const rootLen = this.p.trunkRadius * 2.8 * this.rng.vary(1.0, 0.14);
      const r0 = rcBase * this.rng.vary(1.0, 0.1);

      const rStem: WeldedStem = {
        id: this.nextId++,
        level: 4,
        role: 'root',
        parent: trunk,
        attach: 'side',
        attachS,
        attachDir: emergeDir,
        nodes: [],
        length: 0,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 1,
        windowCols: 2,
        minRing: 6,
        ringSpacing: clamp(r0 * 0.55, 0.025, 0.09),
        baseRadiusAt: (sVal: number) => {
          const z = clamp(sVal / Math.max(1e-4, rootLen), 0, 1);
          return Math.max(cfg.minRadius, r0 * Math.pow(Math.max(0, 1 - z), 0.75));
        },
        styleAt: (sVal: number, _th: number, _pos: V3, _dir: V3, isJunc: boolean) => {
          const z = clamp(sVal / Math.max(1e-4, rootLen), 0, 1);
          const rootBase = mixRgb(colDark, hexToLinearRgb('#524437'), 0.62);
          return {
            color: mixRgb(rootBase, hexToLinearRgb('#3b2f24'), z * 0.55),
            roughness: 0.88,
            translucency: 0.02,
            detailMetric: isJunc ? 0.98 : 0.32,
            anatomyLevel: 0,
            wind: [0, 0, this.palmPhase, 0],
            pivot: groundOrigin,
          };
        },
      };

      const grow = (o: V3, d: V3): void => {
        rStem.nodes = [];
        const steps = 9;
        let pos = clone(o);
        let dir = normalize(d);
        let right = projectOnPlane(cross(UP, dir), dir);
        if (lengthSq(right) < 1e-8) right = anyPerpendicular(dir);
        right = normalize(right);
        rStem.nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s: 0 });
        let s = 0;
        const step = rootLen / steps;
        const hDir = normalize(v3(dir.x, 0, dir.z));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const nextX = pos.x + hDir.x * step;
          const nextZ = pos.z + hDir.z * step;
          const halfSpan = Math.max(0.3, this.substrate.params.size * 1.15);
          const gY =
            this.substrate.params.kind === 'none'
              ? groundOrigin.y
              : this.substrate.sampleSurface(
                  clamp(0.5 + nextX / (halfSpan * 2), 0.02, 0.98),
                  clamp(0.5 + nextZ / (halfSpan * 2), 0.02, 0.98),
                ).pos.y;
          const dive = smoothstep(0.65, 1.0, t) * (r0 * 2.0 + 0.08);
          const nextY = lerp1(pos.y + dir.y * step, gY + r0 * (1 - t) * 0.35 - dive, smoothstep(0.08, 0.4, t) * 0.65);
          const np = v3(nextX, nextY, nextZ);
          dir = normalize(sub(np, pos));
          right = normalize(projectOnPlane(right, dir));
          s += length(sub(np, pos));
          pos = np;
          rStem.nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s });
        }
        rStem.length = s;
      };
      rStem.regrow = grow;
      grow(origin, emergeDir);
      trunk.children.push(rStem);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Spiral Crown Rosette, Central Spear Cluster, Fronds & 3D Fruits
  // ---------------------------------------------------------------------------

  private buildPalmCrownAndFruits(
    tip: CrownTip,
    crownIdx: number,
    groundOrigin: V3,
    palmPhase: number,
    tier: number,
    rachisMesh: PartMesh,
    leafletMesh: PartMesh,
    fruitMesh: PartMesh,
    rng: Random,
  ): void {
    const p = this.p;
    const sc = tip.scale;
    const endSmp = sampleWeldedStem(tip.stem, tip.stem.length);
    const crownAxis = normalize(lerp(endSmp.dir, UP, 0.68));
    const crownRight = normalize(projectOnPlane(endSmp.right, crownAxis));
    const crownUp = normalize(cross(crownAxis, crownRight));
    const crownR = tip.stem.baseRadiusAt(tip.stem.length);
    const crownApex = endSmp.pos;

    const totalEstH = Math.max(2.5, p.trunkHeight + p.frondLength * 0.65);
    const crownH01 = saturate((crownApex.y - groundOrigin.y) / totalEstH);
    const trunkTopFlex = smoothstep(0.025, 0.12, crownH01) * Math.pow(crownH01, 1.55) * 0.15 * p.windSway;

    // Rich botanical chlorophyll palette (avoids harsh neon-chartreuse highlights!)
    const colFrond = mixRgb(hexToLinearRgb(p.hueFrond), hexToLinearRgb('#144218'), 0.24);
    const colTip = mixRgb(hexToLinearRgb(p.hueFrondTip), hexToLinearRgb('#2f6e28'), 0.30);
    const colYoung = mixRgb(colTip, hexToLinearRgb('#63a832'), 0.28);
    const colDrySkirt = hexToLinearRgb('#785f3c');
    const colSheathBurlap =
      p.species === 'royal_palm'
        ? hexToLinearRgb('#348c31')
        : mixRgb(hexToLinearRgb(p.hueTrunk), hexToLinearRgb('#4a331c'), 0.52);

    const isPalmate = p.species === 'fan_palm' || p.species === 'doum_palm';
    const nGreen = Math.max(10, Math.round(p.frondCount * (tip.scale < 0.9 ? 0.68 : 1.08)));
    const nSkirt = Math.round(nGreen * clamp(p.skirtFraction, 0, 0.5));
    const nTotal = nGreen + nSkirt;

    // A. Central Fibrous Crown Heart + Unopened Plicate Spear Leaves (fills the crown center lushly!)
    const nSpears = isPalmate ? 4 : 5;
    for (let sp = 0; sp < nSpears; sp++) {
      const spAz = sp * GOLDEN_ANGLE + crownIdx * 1.1;
      const radDir = add(scale(crownRight, Math.cos(spAz)), scale(crownUp, Math.sin(spAz)));
      const spDir = normalize(add(scale(crownAxis, 0.95), scale(radDir, 0.12 + sp * 0.065)));
      const spLen = p.frondLength * sc * lerp1(0.42, 0.66, sp / nSpears);
      const spBase = addScaled(crownApex, crownAxis, -crownR * 0.12);
      const spCurve = growCurve(spBase, spDir, normalize(cross(crownAxis, radDir)), spLen, 9, (t0, t1) => ({
        pitch: (t1 - t0) * 10 * DEG2RAD,
      }));
      this.emitTaperedTube(
        rachisMesh,
        spCurve,
        crownR * 0.16,
        0.004,
        6,
        colSheathBurlap,
        colYoung,
        groundOrigin,
        trunkTopFlex,
        0.16 * p.windSway,
        palmPhase,
      );
    }

    // B. Spiral Phyllotactic Fronds (`137.508°` golden angle from inner young to outer mature & skirt)
    for (let i = 0; i < nTotal; i++) {
      const fRng = rng.fork(0x700 + i * 37);
      const isSkirt = i >= nGreen;
      const age01 = isSkirt ? 1.0 : i / Math.max(1, nGreen - 1);
      const skirt01 = isSkirt ? (i - nGreen) / Math.max(1, nSkirt) : 0;

      const az = i * GOLDEN_ANGLE + crownIdx * 0.85 + fRng.vary(0, 0.035);
      const radDir = normalize(add(scale(crownRight, Math.cos(az)), scale(crownUp, Math.sin(az))));
      const frondRight0 = normalize(cross(crownAxis, radDir));

      // Axial stacking along compact crown bud (youngest highest, oldest lowest)
      const crownSpan =
        p.species === 'royal_palm'
          ? crownR * 0.55 // Royal palm fronds all emerge from top rim of green crownshaft!
          : crownR * (isPalmate ? 2.1 : 2.35);
      const axialDrop = isSkirt
        ? crownSpan + (0.12 + skirt01 * 0.55) * crownR * 2.2
        : age01 * crownSpan;
      const attachCenter = addScaled(crownApex, crownAxis, -axialDrop);

      // Emergence elevation angle from horizontal (-90..+90 deg):
      // Inner fronds ascend steeply (+74°), mid fronds spread (+38°..+8°), outer dip (-14°), skirt hangs (-68°)!
      let elevDeg: number;
      if (isSkirt) {
        elevDeg = lerp1(-58, -82, skirt01) + fRng.vary(0, 2.5);
      } else if (p.species === 'date_palm') {
        elevDeg = lerp1(75, -8, Math.pow(age01, 0.86)) + fRng.vary(0, 2.5);
      } else if (p.species === 'coconut_palm') {
        elevDeg = lerp1(68, -20, Math.pow(age01, 0.82)) + fRng.vary(0, 3.0);
      } else if (p.species === 'royal_palm') {
        elevDeg = lerp1(64, -14, Math.pow(age01, 0.85)) + fRng.vary(0, 2.5);
      } else {
        elevDeg = lerp1(70, -18, Math.pow(age01, 0.85)) + fRng.vary(0, 3.0);
      }
      const elevRad = elevDeg * DEG2RAD;
      const emergeDir = normalize(
        add(scale(radDir, Math.cos(elevRad)), scale(crownAxis, Math.sin(elevRad))),
      );

      const frondLen =
        p.frondLength *
        sc *
        (isSkirt ? lerp1(0.84, 0.68, skirt01) : lerp1(0.76, 1.04, Math.sin(Math.PI * (0.22 + 0.68 * age01)))) *
        fRng.vary(1.0, 0.04);

      const archDeg = isSkirt
        ? lerp1(6, 2, skirt01)
        : p.frondArchDeg * lerp1(0.45, 1.16, age01) * fRng.vary(1.0, 0.05);

      const baseCol = isSkirt
        ? colDrySkirt
        : mixRgb(colYoung, colFrond, smoothstep(0.0, 0.42, age01));
      const tipCol = isSkirt
        ? mixRgb(colDrySkirt, hexToLinearRgb('#5e4624'), 0.4)
        : mixRgb(colYoung, colTip, smoothstep(0.0, 0.5, age01));

      // Coherent crown wind phase locked tightly to `palmPhase` so trunk & all fronds sway TOGETHER!
      const frondPhase = (palmPhase + (((az / TAU) % 1 + 1) % 1) * 0.04) % 1;

      if (isPalmate) {
        this.buildCostapalmateFrond(
          rachisMesh,
          leafletMesh,
          attachCenter,
          crownAxis,
          radDir,
          emergeDir,
          frondRight0,
          crownR,
          frondLen,
          p.frondWidth * sc,
          archDeg,
          colSheathBurlap,
          baseCol,
          tipCol,
          isSkirt,
          groundOrigin,
          trunkTopFlex,
          frondPhase,
          tier,
          fRng,
        );
      } else {
        this.buildPinnateFrond(
          rachisMesh,
          leafletMesh,
          attachCenter,
          crownAxis,
          radDir,
          emergeDir,
          frondRight0,
          crownR,
          frondLen,
          p.frondWidth * sc,
          archDeg,
          age01,
          colSheathBurlap,
          baseCol,
          tipCol,
          isSkirt,
          groundOrigin,
          trunkTopFlex,
          frondPhase,
          tier,
          fRng,
        );
      }
      this.stats.fronds++;
    }

    // C. Detailed 3D Palm Fruits (Dates, Coconuts, Royal Drupes, Fan Berries, Doum Fruits)
    if (p.showFruits && p.fruitBunches > 0) {
      this.buildPalmInfructescences(
        fruitMesh,
        crownApex,
        crownAxis,
        crownRight,
        crownUp,
        crownR,
        sc,
        groundOrigin,
        trunkTopFlex,
        palmPhase,
        tier,
        rng.fork(0x9911),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Pinnate Feather Frond (Date V-Rank, Coconut Droop, Royal Plumose)
  // ---------------------------------------------------------------------------

  private buildPinnateFrond(
    rachisMesh: PartMesh,
    leafletMesh: PartMesh,
    attachCenter: V3,
    crownAxis: V3,
    radDir: V3,
    emergeDir: V3,
    right0: V3,
    crownR: number,
    frondLen: number,
    bladeW: number,
    archDeg: number,
    age01: number,
    colSheath: RGB,
    colBase: RGB,
    colTip: RGB,
    isSkirt: boolean,
    groundOrigin: V3,
    trunkTopFlex: number,
    frondPhase: number,
    tier: number,
    rng: Random,
  ): void {
    const p = this.p;
    const steps = tier >= 3 ? 22 : 15;
    const archRad = archDeg * DEG2RAD;
    // Coconut fronds gently twist near the distal half (~26°) for authentic trade-wind silhouette
    const distalRoll = p.species === 'coconut_palm' ? rng.vary(0, 1) * 26 * DEG2RAD : rng.vary(0, 1) * 8 * DEG2RAD;

    // Clasping boot starts embedded flush against the crown core and wraps smoothly outward!
    const bootOrigin = addScaled(attachCenter, radDir, crownR * 0.78);
    const rachis = growCurve(bootOrigin, emergeDir, right0, frondLen, steps, (t0, t1) => {
      const dt = t1 - t0;
      const w = 0.45 + 1.15 * t1;
      return {
        pitch: dt * archRad * w,
        roll: dt * distalRoll * smoothstep(0.25, 0.9, t1),
      };
    });

    // Emit clasping triangular leaf-sheath boot -> keeled petiole -> tapering rachis
    const baseR = Math.max(0.016, crownR * 0.22);
    const sides = tier >= 3 ? 8 : 6;
    const rachisExtraFlex = 0.22 * p.windSway;
    const rings: number[][] = [];
    for (let i = 0; i < rachis.count; i++) {
      const fr = rachis.frameAtIndex(i);
      const t = fr.t;
      // Wide clasping boot at t in [0..0.10] tapering into triangular keeled rachis
      const bootWide = 1 + 1.55 * Math.exp(-t * 24.0);
      const r = Math.max(0.0035, baseR * Math.pow(1 - t * 0.93, 0.82));
      const limbFlex = trunkTopFlex + Math.pow(t, 1.45) * rachisExtraFlex;
      const ringCol = mixRgb(colSheath, mixRgb(colBase, colTip, t * 0.55), smoothstep(0.02, 0.18, t));
      const row: number[] = [];

      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const rx = Math.cos(th) * r * bootWide;
        // Flat/concave adaxial top, V-keeled abaxial underside!
        const ry = Math.sin(th) * r * (Math.sin(th) > 0 ? 0.62 : 1.05);
        const pt = add(fr.pos, add(scale(fr.right, rx), scale(fr.up, ry)));
        row.push(
          rachisMesh.addVertex({
            x: pt.x,
            y: pt.y,
            z: pt.z,
            tx: fr.dir.x,
            ty: fr.dir.y,
            tz: fr.dir.z,
            u: j / sides,
            v: t,
            color: ringCol,
            wind: [clamp(trunkTopFlex * 2.5, 0, 1), limbFlex, frondPhase, 0],
            pivot: groundOrigin,
            roughness: t < 0.1 ? 0.78 : 0.46,
            translucency: 0.14,
            detailMetric: 1 - t * 0.5,
            anatomyLevel: 2,
          }),
        );
      }
      rings.push(row);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        rachisMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
    // Clean quad cap at rachis tip
    const lastRing = rings[rings.length - 1];
    for (let j = 0; 2 * j <= sides - 3; j++) {
      rachisMesh.addQuad(lastRing[j], lastRing[j + 1], lastRing[sides - 2 - j], lastRing[sides - 1 - j]);
    }

    // Emit 3D V-folded / Inverted-V Pinnate Leaflets (Pinnae) along rachis!
    const tierScale = tier === 1 ? 0.62 : tier === 2 ? 0.88 : tier === 3 ? 1.12 : 1.32;
    const nPairs = Math.max(18, Math.round(p.leafletPairs * tierScale));
    const petioleEnd = p.species === 'date_palm' ? 0.12 : 0.15;
    const maxPinnaLen = bladeW * 0.58;
    const uSegs = tier >= 3 ? 4 : 3;
    const isDate = p.species === 'date_palm';
    const isCoconut = p.species === 'coconut_palm';
    const plumose = clamp(p.plumoseSplay, 0, 1);

    for (let k = 0; k < nPairs; k++) {
      const uFrac = k / Math.max(1, nPairs - 1);
      const tRachis = lerp1(petioleEnd, 0.988, uFrac);
      const fr = rachis.atT(tRachis);
      const rachisR = Math.max(0.003, baseR * Math.pow(1 - tRachis * 0.93, 0.82));
      const rachisAttachFlex = trunkTopFlex + Math.pow(tRachis, 1.45) * rachisExtraFlex;

      // Date palms bear short sharp stiff acanthophyll spines on the lowest 11% of the blade!
      const isBasalSpine = isDate && uFrac < 0.11;
      const env = isBasalSpine
        ? lerp1(0.18, 0.42, uFrac / 0.11)
        : Math.sin(Math.PI * Math.pow(clamp((uFrac + 0.08) / 1.08, 0.04, 0.98), 0.72));
      const pinnaL = Math.max(0.07, maxPinnaLen * (0.24 + 0.84 * env));
      // Lush tropical ribbon width (fills out crown silhouette naturally without sparse fishbone gaps!)
      const pinnaHalfW = isBasalSpine
        ? 0.006
        : pinnaL * (isCoconut ? 0.074 : isDate ? 0.062 : 0.068);

      for (const side of [-1, 1] as const) {
        // Forward sweep angle along rachis (stiff ~42° near apex, ~64° mid-blade)
        const sweepRad = lerp1(64, 24, Math.pow(uFrac, 1.25)) * DEG2RAD;
        // Dihedral lift: Date palm = crisp upward V (+34°), Coconut = sleek outward/drooping sheet (+10°), Royal = alternating multi-plane!
        const plumoseAlt = ((k * 3 + (side > 0 ? 1 : 0)) % 3 - 1) * 34 * plumose;
        const baseLiftDeg = isBasalSpine
          ? 44
          : isDate
            ? 32 + plumoseAlt * 0.4
            : isCoconut
              ? 12 + plumoseAlt * 0.35
              : 18 + plumoseAlt;
        const liftRad = (isSkirt ? -18 : baseLiftDeg) * DEG2RAD;

        const latOut = scale(fr.right, side);
        let pDir = normalize(
          add(
            add(scale(latOut, Math.sin(sweepRad) * Math.cos(liftRad)), scale(fr.dir, Math.cos(sweepRad))),
            scale(fr.up, Math.sin(liftRad)),
          ),
        );
        let pWidthAx = normalize(cross(pDir, fr.up));
        if (lengthSq(pWidthAx) < 1e-6) pWidthAx = clone(fr.dir);
        let pUp = normalize(cross(pDir, pWidthAx));
        if (dot(pUp, fr.up) < 0) pUp = scale(pUp, -1);

        const basePt = add(addScaled(fr.pos, latOut, rachisR * 0.78), scale(fr.up, rachisR * 0.15));
        // Gravity droop along pinna: Coconut ribbons droop gracefully; Date sword-pinnae stay stiff!
        const pinnaDroop = isBasalSpine
          ? 0.02
          : isSkirt
            ? 0.46
            : isCoconut
              ? 0.44 + 0.14 * age01
              : isDate
                ? 0.12 + 0.06 * age01
                : 0.28;

        // V-fold cross section: +1 induplicate trough (Date), -1 reduplicate ridge (Coconut/Royal)
        const vFoldSign = isDate ? 1 : -1;

        const grid: number[][] = [];
        let curPos = clone(basePt);
        let curDir = clone(pDir);
        const segLen = pinnaL / uSegs;

        for (let sIdx = 0; sIdx <= uSegs; sIdx++) {
          const v01 = sIdx / uSegs;
          if (sIdx > 0) {
            curDir = normalize(add(curDir, v3(0, -pinnaDroop / uSegs, 0)));
            curPos = addScaled(curPos, curDir, segLen);
          }
          let locRight = projectOnPlane(pWidthAx, curDir);
          if (lengthSq(locRight) < 1e-8) locRight = anyPerpendicular(curDir);
          locRight = normalize(locRight);
          const locUp = normalize(cross(curDir, locRight));

          // Sword-lanceolate width taper to a crisp 1.5 mm apex point!
          const wProf = Math.sin(Math.PI * Math.pow(clamp(v01 * 0.84 + 0.08, 0.02, 0.99), 0.62)) * (1 - Math.pow(v01, 2.8));
          const hw = Math.max(0.001, pinnaHalfW * wProf);
          const foldH = hw * 0.36 * vFoldSign;

          const colV = isBasalSpine
            ? mixRgb(hexToLinearRgb('#c99a34'), colBase, 0.35)
            : mixRgb(colBase, colTip, smoothstep(0.08, 0.96, uFrac * 0.38 + v01 * 0.62));

          // At `v01 = 0`, `pinnaFlex === rachisAttachFlex` and `flutter === 0` -> 0.000 mm seam separation!
          const pinnaFlex = rachisAttachFlex + (isBasalSpine ? 0.004 : 0.036) * v01 * v01 * p.windSway;
          const pinnaFlutter = (isBasalSpine ? 0.0 : 0.22) * v01 * v01 * p.windSway;
          const pinnaWind: [number, number, number, number] = [
            clamp(trunkTopFlex * 2.5, 0, 1),
            pinnaFlex,
            frondPhase,
            pinnaFlutter,
          ];

          const row: number[] = [];
          for (const cSide of [-1, 0, 1]) {
            const pt = add(
              curPos,
              add(scale(locRight, cSide * hw), scale(locUp, Math.abs(cSide) * foldH)),
            );
            const nrm = normalize(add(locUp, scale(locRight, -cSide * vFoldSign * 0.38)));
            row.push(
              leafletMesh.addVertex({
                x: pt.x,
                y: pt.y,
                z: pt.z,
                nx: nrm.x,
                ny: nrm.y,
                nz: nrm.z,
                tx: curDir.x,
                ty: curDir.y,
                tz: curDir.z,
                u: cSide * 0.5 + 0.5,
                v: v01,
                color: cSide === 0 ? mixRgb(colV, colTip, 0.14) : colV,
                wind: pinnaWind,
                pivot: groundOrigin,
                roughness: isCoconut ? 0.28 : 0.38,
                translucency: isSkirt ? 0.20 : 0.48,
                detailMetric: cSide === 0 ? 0.92 : 0.42,
                anatomyLevel: 4,
              }),
            );
          }
          grid.push(row);
        }

        for (let sIdx = 0; sIdx < uSegs; sIdx++) {
          leafletMesh.addQuad(grid[sIdx][0], grid[sIdx][1], grid[sIdx + 1][1], grid[sIdx + 1][0]);
          leafletMesh.addQuad(grid[sIdx][1], grid[sIdx][2], grid[sIdx + 1][2], grid[sIdx + 1][1]);
        }
        this.stats.leaflets++;
      }
    }
    leafletMesh.hasExplicitNormals = true;
  }

  // ---------------------------------------------------------------------------
  // 4. Costapalmate 3D Accordion-Pleated Fan Frond (Washingtonia & Doum Palm)
  // ---------------------------------------------------------------------------

  private buildCostapalmateFrond(
    rachisMesh: PartMesh,
    leafletMesh: PartMesh,
    attachCenter: V3,
    _crownAxis: V3,
    radDir: V3,
    emergeDir: V3,
    right0: V3,
    crownR: number,
    frondLen: number,
    fanDiameter: number,
    archDeg: number,
    colSheath: RGB,
    colBase: RGB,
    colTip: RGB,
    isSkirt: boolean,
    groundOrigin: V3,
    trunkTopFlex: number,
    frondPhase: number,
    tier: number,
    rng: Random,
  ): void {
    const p = this.p;
    // Shorter armed petiole (`0.38`) so the crown heart stays lushly clothed instead of bare sticks!
    const petioleLen = frondLen * 0.38;
    const fanRadius = Math.max(0.44, fanDiameter * 0.58);
    const bootOrigin = addScaled(attachCenter, radDir, crownR * 0.72);
    const archRad = archDeg * DEG2RAD * 0.72;

    const petiole = growCurve(bootOrigin, emergeDir, right0, petioleLen, tier >= 3 ? 14 : 10, (t0, t1) => ({
      pitch: (t1 - t0) * archRad,
    }));

    const baseR = Math.max(0.016, crownR * 0.21);
    const petCol = isSkirt ? colBase : mixRgb(colBase, hexToLinearRgb('#a8742a'), 0.38);
    const petExtraFlex = 0.16 * p.windSway;
    this.emitTaperedTube(
      rachisMesh,
      petiole,
      baseR,
      baseR * 0.44,
      6,
      colSheath,
      petCol,
      groundOrigin,
      trunkTopFlex,
      petExtraFlex,
      frondPhase,
    );

    // Hastula origin at petiole tip (`t = 1.0`) — exact `hastulaFlex === trunkTopFlex + petExtraFlex`!
    const hastula = petiole.atT(1.0);
    const hastulaFlex = trunkTopFlex + petExtraFlex;

    const nRays = Math.max(24, Math.round(p.leafletPairs * (tier >= 3 ? 1.05 : 0.8)));
    const fanArcRad = 236 * DEG2RAD;
    const splitFrac = 0.36; // Deep costapalmate palmate clefts (36% fused pleated palm disk -> 64% arching fingers!)
    const radRings = 4;

    // Part 1: Continuous 3D Accordion-Pleated Inner Fan Disk with crisp V-fold normals!
    const diskCols = nRays * 2 + 1;
    const diskGrid: number[][] = [];
    for (let rIdx = 0; rIdx <= radRings; rIdx++) {
      const rFrac = (rIdx / radRings) * splitFrac;
      const diskFlex = hastulaFlex + 0.055 * Math.pow(rFrac, 1.45) * p.windSway;
      const diskFlutter = 0.18 * rFrac * rFrac * p.windSway;
      const diskWind: [number, number, number, number] = [
        clamp(trunkTopFlex * 2.5, 0, 1),
        diskFlex,
        frondPhase,
        diskFlutter,
      ];
      const row: number[] = [];
      for (let c = 0; c < diskCols; c++) {
        const u = c / (diskCols - 1) - 0.5; // -0.5 .. +0.5
        const ang = u * fanArcRad;
        // Costapalmate extension along central costa!
        const costaExt = 1 + 0.24 * Math.cos(ang);
        const rDist = Math.max(0.014, fanRadius * rFrac * costaExt);

        let rayDir = add(
          scale(hastula.dir, Math.cos(ang)),
          scale(hastula.right, Math.sin(ang)),
        );
        if (isSkirt) {
          // Thatched shag-skirt fans hang downward under gravity with slight outward flare (never curling inward into a ball!)
          rayDir = normalize(add(rayDir, add(v3(0, -0.35 * rFrac, 0), scale(radDir, 0.18 * rFrac))));
        } else {
          const cupLift = 0.16 * (1 - Math.cos(ang)) - 0.26 * rFrac * rFrac;
          rayDir = normalize(add(rayDir, scale(hastula.up, cupLift)));
        }
        const tang = normalize(cross(hastula.up, rayDir));

        // Crisp alternating ridge/valley accordion pleats!
        const isRidge = c % 2 === 1;
        const pleatAmp = fanRadius * 0.044 * Math.sin(Math.PI * clamp((rFrac / splitFrac) * 0.85, 0, 1));
        const pleatOff = rIdx === 0 ? 0 : (isRidge ? 1 : -1) * pleatAmp;
        const pt = add(addScaled(hastula.pos, rayDir, rDist), scale(hastula.up, pleatOff));

        // Explicit accordion V-pleat facet shading normal so sun-catching ribs pop in 3D!
        const tiltSide = c === 0 ? -0.45 : c === diskCols - 1 ? 0.45 : isRidge ? 0.0 : ((c % 4 === 0 ? 1 : -1) * 0.52);
        const nrm = normalize(add(hastula.up, add(scale(tang, tiltSide), scale(rayDir, -0.18 * rFrac))));

        const col =
          rIdx === 0
            ? mixRgb(petCol, colBase, 0.55)
            : mixRgb(colBase, colTip, rFrac * 0.65 + (isRidge ? 0.18 : -0.06));

        row.push(
          leafletMesh.addVertex({
            x: pt.x,
            y: pt.y,
            z: pt.z,
            nx: nrm.x,
            ny: nrm.y,
            nz: nrm.z,
            tx: rayDir.x,
            ty: rayDir.y,
            tz: rayDir.z,
            u: u + 0.5,
            v: rFrac,
            color: col,
            wind: diskWind,
            pivot: groundOrigin,
            roughness: isSkirt ? 0.72 : 0.36,
            translucency: isSkirt ? 0.16 : 0.44,
            detailMetric: isRidge ? 0.90 : 0.32,
            anatomyLevel: 4,
          }),
        );
      }
      diskGrid.push(row);
    }

    for (let rIdx = 0; rIdx < radRings; rIdx++) {
      for (let c = 0; c < diskCols - 1; c++) {
        leafletMesh.addQuad(
          diskGrid[rIdx][c],
          diskGrid[rIdx][c + 1],
          diskGrid[rIdx + 1][c + 1],
          diskGrid[rIdx + 1][c],
        );
      }
    }

    // Part 2: Multi-segment gracefully arching & drooping costapalmate ribbon fingers (`splitFrac .. 1.0`)!
    const splitRow = diskGrid[radRings];
    const fingerSegs = 3;
    for (let k = 0; k < nRays; k++) {
      const cLeft = k * 2;
      const cMid = k * 2 + 1;
      const cRight = k * 2 + 2;
      const uMid = cMid / (diskCols - 1) - 0.5;
      const ang = uMid * fanArcRad;
      const costaExt = 1 + 0.24 * Math.cos(ang);
      const rTip = fanRadius * costaExt * rng.vary(1.0, 0.045);

      const rayDir0 = normalize(add(scale(hastula.dir, Math.cos(ang)), scale(hastula.right, Math.sin(ang))));
      const tang = normalize(cross(hastula.up, rayDir0));
      const baseDroop = isSkirt ? 0.52 : 0.36 + 0.24 * Math.abs(uMid);

      let prevL = splitRow[cLeft];
      let prevM = splitRow[cMid];
      let prevR = splitRow[cRight];

      for (let s = 1; s <= fingerSegs; s++) {
        const sf = s / fingerSegs; // 0 -> 1 along free finger
        const rFrac = lerp1(splitFrac, 1.0, sf);
        const rHere = lerp1(fanRadius * splitFrac * costaExt, rTip, sf);
        let segDir: V3;
        if (isSkirt) {
          segDir = normalize(
            add(
              rayDir0,
              add(v3(0, -0.35 * splitFrac - 0.62 * Math.pow(sf, 1.35), 0), scale(radDir, 0.18 * rFrac)),
            ),
          );
        } else {
          const curDroop =
            0.16 * (1 - Math.cos(ang)) * (1 - sf * 0.6) -
            0.26 * splitFrac * splitFrac -
            baseDroop * Math.pow(sf, 1.55);
          segDir = normalize(add(rayDir0, scale(hastula.up, curDroop)));
        }
        const center = addScaled(hastula.pos, segDir, rHere);

        const fFlex = hastulaFlex + 0.055 * Math.pow(rFrac, 1.45) * p.windSway;
        const fFlut = 0.20 * rFrac * rFrac * p.windSway;
        const fWind: [number, number, number, number] = [
          clamp(trunkTopFlex * 2.5, 0, 1),
          fFlex,
          frondPhase,
          fFlut,
        ];
        const segCol = mixRgb(colBase, colTip, clamp(0.32 + 0.68 * rFrac, 0, 1));

        if (s === fingerSegs) {
          const nTip = normalize(add(hastula.up, scale(segDir, 0.35)));
          const vTip = leafletMesh.addVertex({
            x: center.x, y: center.y, z: center.z,
            nx: nTip.x, ny: nTip.y, nz: nTip.z,
            tx: segDir.x, ty: segDir.y, tz: segDir.z,
            color: colTip, wind: fWind, pivot: groundOrigin,
            roughness: isSkirt ? 0.74 : 0.38, translucency: isSkirt ? 0.18 : 0.50, detailMetric: 0.92, anatomyLevel: 4,
          });
          leafletMesh.addTri(prevL, prevM, vTip);
          leafletMesh.addTri(prevM, prevR, vTip);
        } else {
          const halfSegW = ((fanArcRad / nRays) * rHere) * 0.46 * (1 - 0.58 * Math.pow(sf, 1.35));
          const foldH = halfSegW * 0.48;
          const nL = normalize(add(hastula.up, scale(tang, -0.52)));
          const nM = normalize(hastula.up);
          const nR = normalize(add(hastula.up, scale(tang, 0.52)));

          const vL = leafletMesh.addVertex({
            x: center.x - tang.x * halfSegW - hastula.up.x * foldH * 0.35,
            y: center.y - tang.y * halfSegW - hastula.up.y * foldH * 0.35,
            z: center.z - tang.z * halfSegW - hastula.up.z * foldH * 0.35,
            nx: nL.x, ny: nL.y, nz: nL.z,
            tx: segDir.x, ty: segDir.y, tz: segDir.z,
            color: segCol, wind: fWind, pivot: groundOrigin,
            roughness: isSkirt ? 0.72 : 0.36, translucency: isSkirt ? 0.16 : 0.46, detailMetric: 0.35, anatomyLevel: 4,
          });
          const vM = leafletMesh.addVertex({
            x: center.x + hastula.up.x * foldH * 0.65,
            y: center.y + hastula.up.y * foldH * 0.65,
            z: center.z + hastula.up.z * foldH * 0.65,
            nx: nM.x, ny: nM.y, nz: nM.z,
            tx: segDir.x, ty: segDir.y, tz: segDir.z,
            color: mixRgb(segCol, colTip, 0.22), wind: fWind, pivot: groundOrigin,
            roughness: isSkirt ? 0.72 : 0.36, translucency: isSkirt ? 0.16 : 0.46, detailMetric: 0.90, anatomyLevel: 4,
          });
          const vR = leafletMesh.addVertex({
            x: center.x + tang.x * halfSegW - hastula.up.x * foldH * 0.35,
            y: center.y + tang.y * halfSegW - hastula.up.y * foldH * 0.35,
            z: center.z + tang.z * halfSegW - hastula.up.z * foldH * 0.35,
            nx: nR.x, ny: nR.y, nz: nR.z,
            tx: segDir.x, ty: segDir.y, tz: segDir.z,
            color: segCol, wind: fWind, pivot: groundOrigin,
            roughness: isSkirt ? 0.72 : 0.36, translucency: isSkirt ? 0.16 : 0.46, detailMetric: 0.35, anatomyLevel: 4,
          });
          leafletMesh.addQuad(prevL, prevM, vM, vL);
          leafletMesh.addQuad(prevM, prevR, vR, vM);
          prevL = vL;
          prevM = vM;
          prevR = vR;
        }
      }
      this.stats.leaflets++;
    }
    leafletMesh.hasExplicitNormals = true;
  }

  // ---------------------------------------------------------------------------
  // 5. Botanically Accurate 3D Palm Fruits: Dates, Coconuts, Royal/Fan/Doum Drupes
  // ---------------------------------------------------------------------------

  private buildPalmInfructescences(
    fruitMesh: PartMesh,
    crownApex: V3,
    crownAxis: V3,
    crownRight: V3,
    crownUp: V3,
    crownR: number,
    sc: number,
    groundOrigin: V3,
    trunkTopFlex: number,
    palmPhase: number,
    tier: number,
    rng: Random,
  ): void {
    const p = this.p;
    const nBunches = Math.max(1, Math.round(p.fruitBunches * (sc < 0.9 ? 0.65 : 1.0)));
    const colSpadix = hexToLinearRgb(p.hueSpadix);
    const colFruitUser = hexToLinearRgb(p.hueFruit);
    const ripeness = clamp(p.fruitRipeness, 0, 1);

    for (let b = 0; b < nBunches; b++) {
      const bRng = rng.fork(0x3100 + b * 73);
      const az = b * GOLDEN_ANGLE * 1.618 + 0.45 + bRng.vary(0, 0.08);
      const radDir = normalize(add(scale(crownRight, Math.cos(az)), scale(crownUp, Math.sin(az))));
      const right0 = normalize(cross(crownAxis, radDir));
      const bunchAge = b / Math.max(1, nBunches - 1); // 0 = youngest upper bunch, 1 = ripest lower bunch
      const bPhase = (palmPhase + (((az / TAU) % 1 + 1) % 1) * 0.03) % 1;
      this.stats.fruitBunches++;

      if (p.species === 'coconut_palm') {
        // === COASTAL COCONUT BUNCHES: Tight Heavy Axil Clusters of 3-Angled Husked Coconuts ===
        const axilOrigin = add(
          addScaled(crownApex, crownAxis, -crownR * (1.25 + bunchAge * 0.85)),
          scale(radDir, crownR * 0.82),
        );
        const stalkDir = normalize(add(scale(radDir, 0.88), scale(crownAxis, 0.15 - bunchAge * 0.35)));
        const stalkLen = (0.34 + 0.14 * bunchAge) * sc;
        const stalk = growCurve(axilOrigin, stalkDir, right0, stalkLen, 6, (t0, t1) => ({
          gravity: (t1 - t0) * 0.48,
        }));
        const stalkExtraFlex = 0.045 * p.windSway;
        this.emitTaperedTube(
          fruitMesh,
          stalk,
          0.026 * sc,
          0.014 * sc,
          6,
          mixRgb(colSpadix, hexToLinearRgb('#6e5c32'), 0.4),
          colSpadix,
          groundOrigin,
          trunkTopFlex,
          stalkExtraFlex,
          bPhase,
        );

        const clusterCenter = stalk.atT(0.88).pos;
        const nNuts = Math.max(4, Math.round(8 * p.fruitAbundance * bRng.vary(1.0, 0.15)));
        // Grade coconuts naturally from young green -> golden King -> mature fibrous brown!
        const localRipe = saturate(ripeness * 0.65 + bunchAge * 0.55);
        const colYoungNut = hexToLinearRgb('#58a322');
        const colKingNut = hexToLinearRgb('#d9881c');
        const colMatureNut = mixRgb(colFruitUser, hexToLinearRgb('#6e4720'), 0.55);
        const nutBaseCol =
          localRipe < 0.5
            ? mixRgb(colYoungNut, colKingNut, localRipe * 2)
            : mixRgb(colKingNut, colMatureNut, (localRipe - 0.5) * 2);
        const calyxCol = hexToLinearRgb('#3d2914');

        // Rigid SO(3) rotor around `groundOrigin` (`flutter = 0.0` -> 0.000000% radial stretch!)
        const nutWind: [number, number, number, number] = [
          clamp(trunkTopFlex * 2.5, 0, 1),
          trunkTopFlex + Math.pow(0.88, 1.45) * stalkExtraFlex,
          bPhase,
          0.0,
        ];

        for (let n = 0; n < nNuts; n++) {
          const nAz = n * GOLDEN_ANGLE + b * 0.9;
          const ringTier = Math.floor(n / 4);
          const spreadR = (0.095 + 0.035 * (n % 3)) * sc;
          const nutAttach = add(
            clusterCenter,
            add(
              scale(radDir, Math.cos(nAz) * spreadR * 0.75 + 0.04 * sc),
              add(
                scale(right0, Math.sin(nAz) * spreadR),
                v3(0, (-0.04 - ringTier * 0.085) * sc, 0),
              ),
            ),
          );
          const nutDir = normalize(
            add(
              v3(0, -0.72, 0),
              add(scale(radDir, Math.cos(nAz) * 0.48 + 0.22), scale(right0, Math.sin(nAz) * 0.48)),
            ),
          );
          const nutLen = 0.225 * sc * bRng.vary(1.0, 0.08);
          const nutRad = nutLen * 0.43;
          this.emitSculptedFruitOvoid(
            fruitMesh,
            nutAttach,
            nutDir,
            nutLen,
            nutRad,
            tier >= 3 ? 9 : 7,
            tier >= 3 ? 6 : 5,
            0.095, // Authentic 3-angled trigonal coconut husk!
            nutBaseCol,
            calyxCol,
            0.46 + localRipe * 0.28,
            0.08,
            nutWind,
            groundOrigin,
          );
          this.stats.fruits++;
        }
      } else if (p.species === 'date_palm') {
        // === MEDJOOL DATE SPADICES: Bright Golden-Orange Arching Peduncles + Weeping Date Strands ===
        const axilOrigin = add(
          addScaled(crownApex, crownAxis, -crownR * (1.15 + bunchAge * 0.95)),
          scale(radDir, crownR * 0.8),
        );
        const pedDir = normalize(add(scale(radDir, 0.86), scale(crownAxis, 0.46 - bunchAge * 0.2)));
        const pedLen = (0.95 + 0.28 * bunchAge) * sc;
        const peduncle = growCurve(axilOrigin, pedDir, right0, pedLen, 10, (t0, t1) => ({
          gravity: (t1 - t0) * 1.45 * (0.35 + t1),
        }));
        const goldenOrange = mixRgb(colSpadix, hexToLinearRgb('#eb8c15'), 0.55);
        const pedExtraFlex = 0.08 * p.windSway;
        this.emitTaperedTube(
          fruitMesh,
          peduncle,
          0.032 * sc,
          0.016 * sc,
          6,
          mixRgb(goldenOrange, hexToLinearRgb('#8c4e12'), 0.35),
          goldenOrange,
          groundOrigin,
          trunkTopFlex,
          pedExtraFlex,
          bPhase,
        );

        const broomTip = peduncle.atT(0.95);
        const broomFlex = trunkTopFlex + Math.pow(0.95, 1.45) * pedExtraFlex;
        const strandExtraFlex = 0.05 * p.windSway;
        const nStrands = Math.max(8, Math.round((tier >= 3 ? 18 : 11) * p.fruitAbundance));
        const datesPerStrand = Math.max(6, Math.round((tier >= 3 ? 11 : 7) * p.fruitAbundance));

        // Grade dates from bright golden Barhi -> glowing amber -> rich mahogany Medjool!
        const localRipe = saturate(ripeness * 0.72 + bunchAge * 0.38);
        const colBarhiGold = hexToLinearRgb('#ebb123');
        const colAmberDate = mixRgb(colFruitUser, hexToLinearRgb('#b84a12'), 0.5);
        const colMedjool = hexToLinearRgb('#59200c');
        const dateCol =
          localRipe < 0.5
            ? mixRgb(colBarhiGold, colAmberDate, localRipe * 2)
            : mixRgb(colAmberDate, colMedjool, (localRipe - 0.5) * 2);
        const capCol = hexToLinearRgb('#d9a336');

        for (let st = 0; st < nStrands; st++) {
          const sAz = st * GOLDEN_ANGLE + b * 0.5;
          const sRad = Math.sqrt((st + 0.4) / nStrands);
          const sSpread = normalize(
            add(
              scale(broomTip.dir, 0.55),
              add(
                scale(radDir, Math.cos(sAz) * sRad * 0.52),
                add(scale(right0, Math.sin(sAz) * sRad * 0.52), v3(0, -0.55, 0)),
              ),
            ),
          );
          const strandLen = (0.52 + 0.24 * bRng.next()) * sc;
          const strand = growCurve(broomTip.pos, sSpread, right0, strandLen, 6, (t0, t1) => ({
            gravity: (t1 - t0) * 1.65,
          }));
          this.emitTaperedTube(
            fruitMesh,
            strand,
            0.0045 * sc,
            0.0022 * sc,
            4,
            goldenOrange,
            capCol,
            groundOrigin,
            broomFlex,
            strandExtraFlex,
            bPhase,
          );

          for (let d = 0; d < datesPerStrand; d++) {
            const tS = lerp1(0.16, 0.97, d / Math.max(1, datesPerStrand - 1));
            const frS = strand.atT(tS);
            const dAz = d * GOLDEN_ANGLE + st;
            const dOut = add(scale(frS.right, Math.cos(dAz)), scale(frS.up, Math.sin(dAz)));
            const dateAttach = addScaled(frS.pos, dOut, 0.006 * sc);
            const dateDir = normalize(add(v3(0, -0.82, 0), scale(dOut, 0.35)));
            const dateLen = 0.048 * sc * bRng.vary(1.0, 0.09);
            const dateRad = dateLen * 0.31;
            const dCol = mixRgb(colBarhiGold, dateCol, clamp(0.45 + 0.55 * bRng.next(), 0, 1));
            const dateWind: [number, number, number, number] = [
              clamp(trunkTopFlex * 2.5, 0, 1),
              broomFlex + Math.pow(tS, 1.45) * strandExtraFlex,
              bPhase,
              0.0,
            ];

            this.emitSculptedFruitOvoid(
              fruitMesh,
              dateAttach,
              dateDir,
              dateLen,
              dateRad,
              tier >= 3 ? 6 : 5,
              4,
              0.0,
              dCol,
              capCol,
              0.28, // Glossy translucent Medjool date skin!
              0.32,
              dateWind,
              groundOrigin,
            );
            this.stats.fruits++;
          }
        }
      } else {
        // === ROYAL PALM (Infrafoliar Drupe Panicles), FAN PALM (Cascading Berry Stalks) & DOUM PALM ===
        const isRoyal = p.species === 'royal_palm';
        const isDoum = p.species === 'doum_palm';
        const csOffset = isRoyal
          ? p.trunkHeight * Math.max(0.14, p.crownshaftRatio) + crownR * 0.15
          : crownR * (1.45 + bunchAge * 0.75);
        const axilOrigin = add(
          addScaled(crownApex, crownAxis, -csOffset),
          scale(radDir, crownR * 0.88),
        );
        const pedLen = (isRoyal ? 0.78 : isDoum ? 0.72 : 1.75) * sc;
        const pedDir = normalize(
          add(scale(radDir, 0.92), scale(crownAxis, isRoyal ? -0.05 : 0.25)),
        );
        const peduncle = growCurve(axilOrigin, pedDir, right0, pedLen, 8, (t0, t1) => ({
          gravity: (t1 - t0) * (isRoyal ? 0.55 : 1.35),
        }));
        const pedExtraFlex = 0.08 * p.windSway;
        this.emitTaperedTube(
          fruitMesh,
          peduncle,
          0.022 * sc,
          0.009 * sc,
          5,
          colSpadix,
          mixRgb(colSpadix, hexToLinearRgb('#f0e2b6'), 0.35),
          groundOrigin,
          trunkTopFlex,
          pedExtraFlex,
          bPhase,
        );

        const nRachi = isDoum ? 6 : 12;
        const perRachi = Math.max(4, Math.round((isDoum ? 5 : 9) * p.fruitAbundance));
        const subExtraFlex = 0.04 * p.windSway;

        for (let r = 0; r < nRachi; r++) {
          const tP = lerp1(0.38, 0.96, r / Math.max(1, nRachi - 1));
          const frP = peduncle.atT(tP);
          const rAttachFlex = trunkTopFlex + Math.pow(tP, 1.45) * pedExtraFlex;
          const rAz = r * GOLDEN_ANGLE;
          const rDir = normalize(
            add(
              v3(0, -0.68, 0),
              add(scale(frP.right, Math.cos(rAz) * 0.55), scale(radDir, 0.35)),
            ),
          );
          const rLen = (isDoum ? 0.32 : 0.36) * sc;
          const subStrand = growCurve(frP.pos, rDir, right0, rLen, 4, (t0, t1) => ({
            gravity: (t1 - t0) * 0.85,
          }));
          this.emitTaperedTube(
            fruitMesh,
            subStrand,
            0.005 * sc,
            0.0025 * sc,
            4,
            colSpadix,
            colSpadix,
            groundOrigin,
            rAttachFlex,
            subExtraFlex,
            bPhase,
          );

          for (let f = 0; f < perRachi; f++) {
            const tF = lerp1(0.22, 0.96, f / Math.max(1, perRachi - 1));
            const frF = subStrand.atT(tF);
            const fAz = f * GOLDEN_ANGLE + r;
            const fOut = add(scale(frF.right, Math.cos(fAz)), scale(frF.up, Math.sin(fAz)));
            const fLen = (isDoum ? 0.076 : 0.022) * sc * bRng.vary(1.0, 0.08);
            const fRad = fLen * (isDoum ? 0.42 : 0.48);
            const fCol = isDoum
              ? mixRgb(hexToLinearRgb('#9c541c'), colFruitUser, ripeness)
              : isRoyal
                ? mixRgb(hexToLinearRgb('#a82846'), hexToLinearRgb('#2e0b24'), ripeness)
                : mixRgb(hexToLinearRgb('#594122'), hexToLinearRgb('#17110c'), ripeness);
            const drupeWind: [number, number, number, number] = [
              clamp(trunkTopFlex * 2.5, 0, 1),
              rAttachFlex + Math.pow(tF, 1.45) * subExtraFlex,
              bPhase,
              0.0,
            ];

            this.emitSculptedFruitOvoid(
              fruitMesh,
              addScaled(frF.pos, fOut, 0.006 * sc),
              normalize(add(v3(0, -0.75, 0), scale(fOut, 0.45))),
              fLen,
              fRad,
              isDoum ? 7 : 5,
              isDoum ? 5 : 4,
              isDoum ? 0.07 : 0.0,
              fCol,
              hexToLinearRgb('#4a3519'),
              isDoum ? 0.26 : 0.32,
              0.16,
              drupeWind,
              groundOrigin,
            );
            this.stats.fruits++;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Low-level Closed Tube & Sculpted 3D Fruit Ovoid Helpers
  // ---------------------------------------------------------------------------

  private emitTaperedTube(
    mesh: PartMesh,
    curve: CurveLine,
    r0: number,
    r1: number,
    sides: number,
    col0: RGB,
    col1: RGB,
    pivot: V3,
    baseLimbFlex: number,
    extraLimbFlex: number,
    phase: number,
  ): void {
    const rings: number[][] = [];
    for (let i = 0; i < curve.count; i++) {
      const fr = curve.frameAtIndex(i);
      const t = fr.t;
      const r = lerp1(r0, r1, Math.pow(t, 0.85));
      const col = mixRgb(col0, col1, t);
      const limb = baseLimbFlex + Math.pow(t, 1.45) * extraLimbFlex;
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
            wind: [clamp(baseLimbFlex * 2.5, 0, 1), limb, phase, 0],
            pivot,
            roughness: 0.46,
            translucency: 0.14,
            detailMetric: 0.65,
            anatomyLevel: 2,
          }),
        );
      }
      rings.push(row);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
    const top = rings[rings.length - 1];
    for (let j = 0; 2 * j <= sides - 3; j++) {
      mesh.addQuad(top[j], top[j + 1], top[sides - 2 - j], top[sides - 1 - j]);
    }
  }

  /**
   * Emit a closed 3D botanical fruit (Coconut with 3-angled husk & scalloped calyx cap,
   * glossy oblong Medjool Date with perianth cap, or Royal/Doum drupe).
   * Shares a single rigid `SO(3)` wind rotor across the entire fruit -> 0.00% scaling!
   */
  private emitSculptedFruitOvoid(
    mesh: PartMesh,
    attachPos: V3,
    axisDir: V3,
    len: number,
    maxR: number,
    radialSides: number,
    latRings: number,
    trigonalAmp: number,
    colBody: RGB,
    colCalyx: RGB,
    roughness: number,
    translucency: number,
    wind: [number, number, number, number],
    pivot: V3,
  ): void {
    const dir = normalize(axisDir);
    const right = anyPerpendicular(dir);
    const up = normalize(cross(dir, right));

    const basePole = mesh.addVertex({
      x: attachPos.x, y: attachPos.y, z: attachPos.z,
      nx: -dir.x, ny: -dir.y, nz: -dir.z,
      tx: dir.x, ty: dir.y, tz: dir.z,
      color: colCalyx, wind, pivot,
      roughness: 0.72, translucency: 0.04, detailMetric: 0.9, anatomyLevel: 3,
    });

    const rings: number[][] = [];
    for (let i = 1; i < latRings; i++) {
      const v = i / latRings;
      // Plump shoulder near calyx, slightly pointed stylar end (`v -> 1`)
      const prof = Math.sin(Math.PI * Math.pow(v, 0.84)) * (1 - 0.14 * v * v);
      const isCalyxRim = i === 1;
      const center = addScaled(attachPos, dir, v * len);
      const row: number[] = [];

      for (let j = 0; j < radialSides; j++) {
        const th = (j / radialSides) * TAU;
        const trig = trigonalAmp > 0 ? 1 + trigonalAmp * Math.cos(3 * th) : 1;
        const r = maxR * prof * trig * (isCalyxRim ? 1.04 : 1.0);
        const radVec = add(scale(right, Math.cos(th)), scale(up, Math.sin(th)));
        const pt = addScaled(center, radVec, r);
        const nrm = normalize(add(radVec, scale(dir, (v - 0.46) * 1.15)));
        const col = isCalyxRim ? colCalyx : mixRgb(colBody, colCalyx, (1 - v) * 0.14);

        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: nrm.x, ny: nrm.y, nz: nrm.z,
            tx: dir.x, ty: dir.y, tz: dir.z,
            u: j / radialSides, v,
            color: col, wind, pivot,
            roughness: isCalyxRim ? 0.74 : roughness,
            translucency: isCalyxRim ? 0.04 : translucency,
            detailMetric: isCalyxRim ? 0.88 : 0.62,
            anatomyLevel: 3,
          }),
        );
      }
      rings.push(row);
    }

    const tipPt = addScaled(attachPos, dir, len);
    const tipPole = mesh.addVertex({
      x: tipPt.x, y: tipPt.y, z: tipPt.z,
      nx: dir.x, ny: dir.y, nz: dir.z,
      tx: dir.x, ty: dir.y, tz: dir.z,
      color: mixRgb(colBody, colCalyx, 0.22), wind, pivot,
      roughness, translucency, detailMetric: 0.75, anatomyLevel: 3,
    });

    for (let j = 0; j < radialSides; j++) {
      const j1 = (j + 1) % radialSides;
      mesh.addTri(basePole, rings[0][j1], rings[0][j]);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < radialSides; j++) {
        const j1 = (j + 1) % radialSides;
        mesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
    const last = rings[rings.length - 1];
    for (let j = 0; j < radialSides; j++) {
      const j1 = (j + 1) % radialSides;
      mesh.addTri(last[j], last[j1], tipPole);
    }
    mesh.hasExplicitNormals = true;
  }
}

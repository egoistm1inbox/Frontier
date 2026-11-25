/**
 * Giant Tropical Megaphyll Plant Mesher.
 *
 * Synthesizes botanical showpiece tropicals engineered for proper wind physics:
 *   - Wild Fruiting Banana (Musa paradisiaca): clasping leaf-sheath pseudostem,
 *     basal sucker pup, rolled chartreuse cigar furl, arching U-grooved petioles,
 *     1.6m+ striated paddles torn by wind into independent fluttering ribbons,
 *     and a pendant burgundy Banana Bell + radial fruit hands!
 *   - Red Abyssinian Banana (Ensete ventricosum 'Maurelii'): stout crimson-wine
 *     pseudostem & ruby-keeled giant paddles.
 *   - Giant Traveller's Palm (Ravenala madagascariensis): planar distichous
 *     peacock-fan of long petioles & wind-split paddles.
 *   - Colossal Rainforest Elephant Ear (Alocasia macrorrhizos): succulent
 *     sheathing petioles & giant sagittate-cordate quilted blades with posterior
 *     basal ear lobes and raised primary ribs.
 *   - Giant Bird of Paradise (Strelitzia nicolai): clumping stems + glaucous
 *     paddles + sculpted crane-beak orange & cobalt spathe inflorescences.
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
  clamp,
  cross,
  dot,
  growCurve,
  hexToLinearRgb,
  lerp1,
  mixRgb,
  normalize,
  rotateAxis,
  saturate,
  scale,
  smoothstep,
  v3,
} from '../core/math';
import { PartMesh } from '../core/mesh';
import { fbm3 } from '../core/noise';
import { Random } from '../core/random';
import {
  DEFAULT_WELDED_CONFIG,
  WeldedMesher,
  WeldedNode,
  WeldedStem,
  validateWeldedManifold,
} from '../core/weldedManifold';
import { HostSubstrate } from '../substrates/substrate';
import { TropicalParams } from './tropicalParams';

export interface TropicalStats {
  stems: number;
  leaves: number;
  ribbons: number;
  fruitsOrFlowers: number;
  height: number;
  weldedJunctions?: number;
  closedStemManifold?: boolean;
}

export interface TropicalBuildResult {
  parts: PartMesh[];
  stats: TropicalStats;
}

export class TropicalMesher {
  private readonly p: TropicalParams;
  private readonly rng: Random;
  private readonly substrate: HostSubstrate;
  private stats: TropicalStats = {
    stems: 0,
    leaves: 0,
    ribbons: 0,
    fruitsOrFlowers: 0,
    height: 2.0,
  };

  constructor(params: TropicalParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.rng = new Random((seed ^ 0x51e9a4c3) >>> 0);
    this.substrate = substrate;
  }

  build(layerId: string): TropicalBuildResult {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);

    const stemMesh = new PartMesh(
      `${layerId}:pseudostem`,
      'Welded Pseudostem, Roots & Petioles',
      'botanical',
      layerId,
      'palm',
      '#7da844',
    );
    const cigarMesh = new PartMesh(`${layerId}:cigar`, 'Central Cigar Furl', 'botanical', layerId, 'sprout', '#a3e63d');
    const infloMesh = new PartMesh(
      `${layerId}:inflorescence`,
      p.architecture === 'bird_of_paradise' ? 'Crane-Beak Spathe Flowers' : 'Pendant Banana Bell & Hands',
      'botanical',
      layerId,
      'sparkles',
      '#d94862',
    );
    const crownGroup = new PartMesh(`${layerId}:leaves`, `Crown Paddles (${p.leafCount})`, 'botanical', layerId, 'palm', '#34c759');
    const leafMeshes: PartMesh[] = [];

    const colBlade = hexToLinearRgb(p.hueBlade);
    const colYoung = hexToLinearRgb(p.hueYoung);
    const colMidrib = hexToLinearRgb(p.hueMidrib);
    const colStem = hexToLinearRgb(p.hueStem);
    const colSheathDry = hexToLinearRgb('#4a311e');
    const colSenescent = hexToLinearRgb('#b88928');
    const colRoot = hexToLinearRgb('#614930');

    const baseSample = this.substrate.sampleSurface(0.5, 0.5);
    const rootOrigin = baseSample.pos;
    const totalHeightEst = Math.max(0.8, p.pseudostemHeight + p.leafLength * 0.85);
    const nStems = clamp(Math.round(p.stemCount), 1, 4);

    let globalLeafIdx = 0;
    let nextWeldedId = 1;
    let totalWeldedJunctions = 0;

    for (let stIdx = 0; stIdx < nStems; stIdx++) {
      const sRng = this.rng.fork(0x1200 + stIdx * 97);
      const isMain = stIdx === 0;
      const scaleSt = isMain ? 1.0 : lerp1(0.46, 0.72, (nStems - stIdx) / Math.max(1, nStems));

      // Offset sucker pups around main pseudostem
      const pupAz = stIdx * 2.25 + 0.6;
      const pupDist = isMain ? 0 : p.pseudostemRadius * 2.35 + 0.08 * stIdx;
      const uOff = clamp(0.5 + (Math.cos(pupAz) * pupDist) / Math.max(0.2, this.substrate.params.size * 2), 0.15, 0.85);
      const vOff = clamp(0.5 + (Math.sin(pupAz) * pupDist) / Math.max(0.2, this.substrate.params.size * 2), 0.15, 0.85);
      const stemSample = isMain ? baseSample : this.substrate.sampleSurface(uOff, vOff);
      // Sink pseudostem base slightly into corm soil so welded basal roots emerge right at ground line!
      const stemBase = addScaled(isMain ? rootOrigin : stemSample.pos, UP, -Math.max(0.025, p.pseudostemRadius * scaleSt * 0.35));

      const nLeaves = isMain ? Math.max(4, Math.round(p.leafCount)) : Math.max(3, Math.round(p.leafCount * 0.45));
      const isFan = p.architecture === 'travellers_palm' || p.architecture === 'bird_of_paradise';
      const isElephantEar = p.architecture === 'elephant_ear_alocasia';
      const isRed = p.architecture === 'red_abyssinian_banana';

      // Ensure pseudostem has sufficient height for clean non-overlapping welded petiole collars!
      const stemH = Math.max(isElephantEar ? 0.36 : 0.42, p.pseudostemHeight * scaleSt);
      const stemR = Math.max(0.028, p.pseudostemRadius * scaleSt);
      const stemLean = isMain ? 0.05 : 0.16;
      const leanDir = v3(Math.cos(pupAz), 0, Math.sin(pupAz));
      const stemDir0 = normalize(add(UP, scale(leanDir, stemLean)));
      const stemRight0 = normalize(cross(UP, isMain ? v3(1, 0, 0) : leanDir));
      const stemPhase = sRng.next();

      // 1. Build Pseudostem Centerline + WeldedStem Root
      const stemSteps = 22 + tier * 4;
      const stemCurve = growCurve(stemBase, stemDir0, stemRight0, stemH, stemSteps, (t0, t1) => ({
        pitch: (t1 - t0) * sRng.vary(0.04, 0.06),
        yaw: Math.sin(t1 * 2.5) * 0.015,
      }));
      const redFlush = hexToLinearRgb('#5c1622');
      const stemNodes: WeldedNode[] = [];
      for (let k = 0; k < stemCurve.count; k++) {
        const fr = stemCurve.frameAtIndex(k);
        stemNodes.push({ pos: fr.pos, dir: fr.dir, right: fr.right, s: fr.s });
      }

      const trunkWelded: WeldedStem = {
        id: nextWeldedId++,
        level: 0,
        role: 'shoot',
        parent: null,
        attach: 'root',
        attachS: 0,
        attachDir: stemDir0,
        nodes: stemNodes,
        length: stemCurve.length,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 1.0,
        ringSpacing: Math.max(0.022, stemH / (28 + tier * 6)),
        minRing: 24,
        baseRadiusAt: (s: number) => {
          const t = clamp(s / Math.max(1e-4, stemCurve.length), 0, 1);
          const bulb = 1 + (isRed ? 0.34 : 0.18) * Math.exp(-t * 5.2);
          const crownDome = lerp1(1.0, 0.42, smoothstep(0.93, 1.0, t));
          const taper = lerp1(1.0, 0.68, Math.pow(t, 0.85)) * crownDome;
          const sheathStep = 1 + 0.026 * Math.sin(t * 22.0);
          return stemR * bulb * taper * sheathStep;
        },
        profileFactor: (s: number, theta: number) => {
          const t = clamp(s / Math.max(1e-4, stemCurve.length), 0, 1);
          return 1 + 0.042 * Math.cos(theta * 3 + t * 7.0) + 0.016 * Math.cos(theta * 9);
        },
        styleAt: (s: number, theta: number, pos: V3, _dir: V3, isJunction: boolean) => {
          const t = clamp(s / Math.max(1e-4, stemCurve.length), 0, 1);
          let ringCol = mixRgb(colSheathDry, isRed ? mixRgb(colStem, redFlush, 0.65) : colStem, smoothstep(0.05, 0.42, t));
          ringCol = mixRgb(ringCol, colMidrib, smoothstep(0.75, 1.0, t) * 0.35);
          const sheathDark = 0.88 + 0.12 * Math.cos(theta * 3 + t * 7.0);
          return {
            color: { r: ringCol.r * sheathDark, g: ringCol.g * sheathDark, b: ringCol.b * sheathDark },
            roughness: 0.38,
            translucency: 0.14,
            detailMetric: isJunction ? 0.96 : t,
            anatomyLevel: 1,
            wind: [saturate(pos.y / totalHeightEst), Math.pow(t, 1.6) * 0.08 * p.windSail, stemPhase, 0.0],
            pivot: stemBase,
          };
        },
      };

      // 1b. Attach 5 Welded Basal Adventitious / Prop Roots into the Pseudostem Corm!
      const nRoots = isMain ? 5 : 3;
      const subSpan = Math.max(0.25, this.substrate.params.size * 2.0);
      for (let ri = 0; ri < nRoots; ri++) {
        const rRng = sRng.fork(0x900 + ri * 31);
        const rAz = pupAz + (ri / nRoots) * TAU + rRng.vary(0, 0.16);
        const rHoriz = v3(Math.cos(rAz), 0, Math.sin(rAz));
        const rAttachS = clamp(stemR * (0.52 + 0.16 * (ri % 2)), 0.018, stemCurve.length * 0.24);
        const rLen = Math.max(0.14, stemR * 3.4 * rRng.range(0.85, 1.2));
        const rootR0 = Math.max(0.008, stemR * 0.21);

        const buildRootNodes = (orig: V3, emDir: V3): WeldedNode[] => {
          const outDir = normalize(add(scale(v3(emDir.x, 0, emDir.z), 0.92), v3(0, -0.22, 0)));
          const rSteps = 8;
          const rNodes: WeldedNode[] = [];
          let cur = orig;
          let accS = 0;
          let prev = orig;
          for (let k = 0; k <= rSteps; k++) {
            const tr = k / rSteps;
            const reach = tr * rLen;
            const wx = orig.x + outDir.x * reach;
            const wz = orig.z + outDir.z * reach;
            const su = clamp(0.5 + (wx - rootOrigin.x) / subSpan, 0.04, 0.96);
            const sv = clamp(0.5 + (wz - rootOrigin.z) / subSpan, 0.04, 0.96);
            const groundY = this.substrate.sampleSurface(su, sv).pos.y;
            const archY = lerp1(orig.y, groundY - rootR0 * 0.45, smoothstep(0, 0.68, tr)) - smoothstep(0.75, 1.0, tr) * 0.018;
            cur = v3(wx, archY, wz);
            if (k > 0) accS += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
            prev = cur;
            rNodes.push({ pos: cur, dir: outDir, right: normalize(cross(outDir, UP)), s: accS });
          }
          for (let k = 0; k <= rSteps; k++) {
            const k0 = Math.max(0, k - 1);
            const k1 = Math.min(rSteps, k + 1);
            const d = normalize(v3(
              rNodes[k1].pos.x - rNodes[k0].pos.x,
              rNodes[k1].pos.y - rNodes[k0].pos.y,
              rNodes[k1].pos.z - rNodes[k0].pos.z,
            ));
            rNodes[k].dir = d;
            rNodes[k].right = normalize(cross(d, UP));
          }
          return rNodes;
        };

        const initOrigin = addScaled(stemCurve.atS(rAttachS).pos, rHoriz, stemR * 0.85);
        const initNodes = buildRootNodes(initOrigin, rHoriz);
        const rootStem: WeldedStem = {
          id: nextWeldedId++,
          level: 1,
          role: 'root',
          parent: trunkWelded,
          attach: 'side',
          attachS: rAttachS,
          attachDir: normalize(add(rHoriz, v3(0, -0.25, 0))),
          nodes: initNodes,
          length: initNodes[initNodes.length - 1].s,
          children: [],
          forks: [],
          dropped: false,
          radiusDrop: 1.0,
          ringSpacing: Math.max(0.018, rLen / 7),
          minRing: 6,
          windowCols: 2,
          baseRadiusAt: (s: number) => {
            const tr = clamp(s / Math.max(1e-4, rootStem.length), 0, 1);
            return Math.max(0.0045, rootR0 * lerp1(1.0, 0.30, Math.pow(tr, 0.82)));
          },
          styleAt: (s: number, _theta: number, _pos: V3, _dir: V3, isJunction: boolean) => {
            const tr = clamp(s / Math.max(1e-4, rootStem.length), 0, 1);
            const c = mixRgb(colSheathDry, colRoot, smoothstep(0.0, 0.55, tr));
            return {
              color: c,
              roughness: 0.72,
              translucency: 0.04,
              detailMetric: isJunction ? 0.96 : 0.25,
              anatomyLevel: 0,
              wind: [0, 0, stemPhase, 0],
              pivot: stemBase,
            };
          },
          regrow: (orig: V3, emDir: V3) => {
            const rebuilt = buildRootNodes(orig, emDir);
            rootStem.nodes = rebuilt;
            rootStem.length = rebuilt[rebuilt.length - 1].s;
          },
        };
        trunkWelded.children.push(rootStem);
      }

      this.stats.stems++;

      const crownApex = stemCurve.atT(1.0);
      const trunkTopFlex = 0.08 * p.windSail;

      // 2. Build Central Rolled Cigar Furl Leaf
      if (p.showCigarLeaf) {
        this.buildCigarFurl(
          cigarMesh,
          crownApex.pos,
          stemBase,
          crownApex.dir,
          crownApex.right,
          p.leafLength * 0.44 * scaleSt,
          stemR * 0.28,
          colYoung,
          colMidrib,
          totalHeightEst,
          stemPhase,
          trunkTopFlex,
          tier,
        );
      }

      // 3. Build Pendant Banana Bell + Fruit Hands OR Bird-of-Paradise Spathe Flowers!
      if (p.showInflorescence && (isMain || (p.architecture === 'bird_of_paradise' && stIdx <= 1))) {
        if (p.architecture === 'banana_musa' || p.architecture === 'red_abyssinian_banana') {
          this.buildBananaInflorescence(
            infloMesh,
            crownApex.pos,
            stemBase,
            crownApex.dir,
            stemR,
            scaleSt,
            totalHeightEst,
            stemPhase,
            trunkTopFlex,
            tier,
            sRng,
          );
        } else if (p.architecture === 'bird_of_paradise') {
          this.buildStrelitziaFlowers(
            infloMesh,
            crownApex.pos,
            stemBase,
            crownApex.dir,
            p.leafLength * 0.62 * scaleSt,
            totalHeightEst,
            stemPhase,
            trunkTopFlex,
            tier,
            sRng,
          );
        }
      }

      // 4. Plan Every Leaf's Canaliculate Petiole-Midrib as a Welded Child of `trunkWelded`!
      interface PendingLeafSpec {
        welded: WeldedStem;
        globalIdx: number;
        age01: number;
        trunkAttachFlex: number;
        leafPhase: number;
        L: number;
        maxHalfW: number;
        petioleFrac: number;
        petioleR0: number;
        lRng: Random;
      }
      const pendingLeaves: PendingLeafSpec[] = [];

      // Size petiole base radius so even dense distichous fans fit cleanly into upper-crown welded windows (`0` drops!)
      const maxColLeaves = isFan ? Math.ceil(nLeaves / 2) : Math.ceil(nLeaves / 3);
      const safePetioleMax = (stemH * 0.34) / Math.max(2, maxColLeaves * 3.1);
      const petioleR0Base = clamp(Math.min(stemR * 0.22, safePetioleMax), 0.0075, stemR * 0.28);
      const midribCol = isRed ? hexToLinearRgb('#7d1828') : colMidrib;
      const petBaseCol = mixRgb(colStem, midribCol, 0.5);

      for (let li = 0; li < nLeaves; li++) {
        globalLeafIdx++;
        const age01 = nLeaves <= 1 ? 0.3 : li / (nLeaves - 1);
        const lRng = sRng.fork(0x400 + li * 53);

        let az: number;
        let emergeDeg: number;
        let attachFrac: number;

        if (isFan) {
          const sideSign = li % 2 === 0 ? 1 : -1;
          const rankIdx = Math.floor(li / 2);
          const maxRanks = Math.max(1, Math.ceil(nLeaves / 2) - 1);
          const rank01 = rankIdx / maxRanks;
          az = (sideSign > 0 ? 0 : Math.PI) + pupAz * 0.25 + lRng.vary(0, 0.035);
          emergeDeg = lerp1(12, Math.min(82, p.crownSplayDeg * 1.65), rank01);
          attachFrac = lerp1(0.92, 0.62, rank01);
        } else {
          az = li * GOLDEN_ANGLE + pupAz + lRng.vary(0, 0.08);
          const isSenescentSkirt = p.senescence > 0.05 && age01 > 1 - p.senescence * 0.55;
          emergeDeg = isSenescentSkirt
            ? lerp1(72, 108, (age01 - (1 - p.senescence * 0.55)) / Math.max(0.05, p.senescence * 0.55))
            : lerp1(Math.max(12, p.crownSplayDeg * 0.42), Math.min(78, p.crownSplayDeg * 1.45), Math.pow(age01, 0.85));
          attachFrac = lerp1(0.92, 0.66, age01);
        }

        const attachS = attachFrac * stemCurve.length;
        const stemStation = stemCurve.atS(attachS);
        const trunkAttachFlex = Math.pow(attachFrac, 1.6) * 0.08 * p.windSail;
        const horiz = v3(Math.cos(az), 0, Math.sin(az));
        const leafOrigin = addScaled(stemStation.pos, horiz, trunkWelded.baseRadiusAt(attachS) * 0.85);

        const L = p.leafLength * scaleSt * lerp1(0.84, 1.08, Math.sin(age01 * Math.PI * 0.85 + 0.2)) * lRng.range(0.94, 1.06);
        const maxHalfW = p.leafWidth * 0.5 * scaleSt * lRng.range(0.93, 1.07);
        const petioleFrac = isElephantEar ? Math.max(0.42, p.petioleFraction) : clamp(p.petioleFraction, 0.1, 0.55);

        const tiltRad = emergeDeg * DEG2RAD;
        const dir0 = normalize(add(scale(UP, Math.cos(tiltRad)), scale(horiz, Math.sin(tiltRad))));
        const rawRight0 = normalize(cross(dir0, UP));
        const fixedRight0 = cross(dir0, rawRight0).y >= 0 ? rawRight0 : scale(rawRight0, -1);

        const droopTotal = (p.archDroopDeg * lerp1(0.48, 1.24, age01) + lRng.vary(0, 5)) * DEG2RAD;
        const spineSteps = 30 + tier * 8;
        const archAt = (t: number): number => droopTotal * Math.pow(t, isElephantEar ? 1.85 : 1.55);
        const leafPhase = (((az / TAU) + lRng.vary(0, 0.08)) % 1 + 1) % 1;

        const rawSpine = growCurve(leafOrigin, dir0, fixedRight0, L, spineSteps, (t0, t1) => ({
          pitch: archAt(t1) - archAt(t0),
          yaw: Math.sin(t1 * Math.PI * 1.5 + leafPhase * TAU) * 0.014,
          roll: (t1 - t0) * lRng.vary(0, 0.12),
        }));

        const lNodes: WeldedNode[] = [];
        for (let k = 0; k < rawSpine.count; k++) {
          const fr = rawSpine.frameAtIndex(k);
          lNodes.push({ pos: fr.pos, dir: fr.dir, right: fr.right, s: fr.s });
        }

        const petioleR0 = petioleR0Base * lerp1(0.88, 1.04, age01);
        const leafWelded: WeldedStem = {
          id: nextWeldedId++,
          level: 1,
          role: 'shoot',
          parent: trunkWelded,
          attach: 'side',
          attachS,
          attachDir: dir0,
          nodes: lNodes,
          length: rawSpine.length,
          children: [],
          forks: [],
          dropped: false,
          radiusDrop: 1.0,
          ringSpacing: Math.max(0.032, L / (24 + tier * 6)),
          minRing: 8,
          baseRadiusAt: (s: number) => {
            const t = clamp(s / Math.max(1e-4, leafWelded.length), 0, 1);
            return Math.max(0.0038, lerp1(petioleR0, Math.max(0.0038, petioleR0 * 0.22), Math.pow(t, 0.78)));
          },
          profileFactor: (s: number, theta: number) => {
            // Authentic canaliculate U-shaped adaxial channel (`sin(theta) > 0` = adaxial skyward side!)
            const t = clamp(s / Math.max(1e-4, leafWelded.length), 0, 1);
            const sinT = Math.sin(theta);
            const groove = sinT > 0 ? 1 - 0.34 * sinT * sinT * (1 - t * 0.72) : 1 + 0.14 * (-sinT);
            const lat = 1 + 0.12 * Math.cos(theta) * Math.cos(theta) * (1 - t * 0.5);
            return groove * lat;
          },
          styleAt: (s: number, _theta: number, pos: V3, _dir: V3, isJunction: boolean) => {
            const t = clamp(s / Math.max(1e-4, leafWelded.length), 0, 1);
            const c = mixRgb(petBaseCol, midribCol, smoothstep(0.0, 0.45, t));
            const h01 = saturate(pos.y / totalHeightEst);
            const limbFlex = trunkAttachFlex + Math.pow(t, 1.48) * 0.62 * p.windSail;
            const spinePhase = lerp1(stemPhase, leafPhase, smoothstep(0.0, 0.28, t));
            return {
              color: c,
              roughness: 0.32,
              translucency: 0.28,
              detailMetric: isJunction ? 0.96 : 0.90,
              anatomyLevel: 2,
              wind: [h01, limbFlex, spinePhase, 0.0],
              pivot: stemBase,
            };
          },
        };

        trunkWelded.children.push(leafWelded);
        pendingLeaves.push({
          welded: leafWelded,
          globalIdx: globalLeafIdx,
          age01,
          trunkAttachFlex,
          leafPhase,
          L,
          maxHalfW,
          petioleFrac,
          petioleR0,
          lRng,
        });
      }

      // 5. Mesh the ENTIRE Pseudostem + Basal Roots + All Canaliculate Petiole-Midrib Spines
      // as ONE Closed 2-Manifold (`V - E + F = 2`, `0` overlapping tubes)!
      const weldedStats = new WeldedMesher(stemMesh, [trunkWelded], {
        ...DEFAULT_WELDED_CONFIG,
        trunkRadialSegments: Math.max(24, 18 + tier * 4),
        minRadialSegments: 6,
        collarScale: 1.24,
        collarLength: 1.05,
        collarRings: 1,
        collarFillet: 0.72,
        collarMitre: 0.52,
        minRadius: 0.0035,
        capTips: true,
      }).build();
      totalWeldedJunctions += weldedStats.junctions;

      // 6. Emit Giant Megaphyll Laminas directly along each relocated Welded Midrib Spine!
      for (const spec of pendingLeaves) {
        if (spec.welded.dropped) continue;
        const relocatedSpine = new CurveLine();
        for (const nd of spec.welded.nodes) {
          relocatedSpine.push(nd.pos, nd.dir, nd.right);
        }

        const tag = spec.age01 < 0.3 ? 'Inner' : spec.age01 < 0.78 ? 'Canopy' : 'Outer';
        const lMesh = new PartMesh(
          `${layerId}:leaves:l${String(spec.globalIdx).padStart(2, '0')}`,
          `Leaf ${String(spec.globalIdx).padStart(2, '0')} · ${tag}`,
          'botanical',
          `${layerId}:leaves`,
          'leaf',
          spec.age01 < 0.3 ? '#7ee058' : '#34c759',
        );

        this.buildGiantTropicalLeafOnSpine(lMesh, relocatedSpine, {
          stemPivot: stemBase,
          stemPhase,
          trunkAttachFlex: spec.trunkAttachFlex,
          leafPhase: spec.leafPhase,
          age01: spec.age01,
          L: spec.L,
          maxHalfW: spec.maxHalfW,
          petioleFrac: spec.petioleFrac,
          petioleR0: spec.petioleR0,
          totalHeightEst,
          colBlade,
          colYoung,
          colMidrib,
          colSenescent,
          tier,
          rng: spec.lRng,
        });

        lMesh.metaLabel = `${(lMesh.renderedTriangles / 1000).toFixed(1)}k tris`;
        leafMeshes.push(lMesh);
        this.stats.leaves++;
      }
    }

    const manifoldRep = validateWeldedManifold(stemMesh);
    this.stats.weldedJunctions = totalWeldedJunctions;
    this.stats.closedStemManifold =
      manifoldRep.closed &&
      manifoldRep.manifold &&
      manifoldRep.eulerCharacteristic === 2 * manifoldRep.components;

    stemMesh.metaLabel = `${this.stats.stems} welded stem${this.stats.stems > 1 ? 's' : ''}`;
    cigarMesh.metaLabel = 'furl leaf';
    infloMesh.metaLabel = `${this.stats.fruitsOrFlowers} organs`;
    crownGroup.metaLabel = `${leafMeshes.length} paddles`;

    const parts: PartMesh[] = [stemMesh];
    if (cigarMesh.faceCount > 0) parts.push(cigarMesh);
    if (infloMesh.faceCount > 0) parts.push(infloMesh);
    if (leafMeshes.length > 0) {
      parts.push(crownGroup, ...leafMeshes);
    }

    let maxY = 0.5;
    for (const part of parts) {
      const pos = part.positions;
      for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
    }
    this.stats.height = maxY;
    return { parts, stats: this.stats };
  }

  // ---------------------------------------------------------------------------
  // 2. Central Rolled Cigar Furl Leaf
  // ---------------------------------------------------------------------------

  private buildCigarFurl(
    mesh: PartMesh,
    origin: V3,
    stemPivot: V3,
    dir0: V3,
    right0: V3,
    len: number,
    rad: number,
    colYoung: RGB,
    colMidrib: RGB,
    totalH: number,
    phase: number,
    baseFlex: number,
    tier: number,
  ): void {
    const steps = 14 + tier * 3;
    const sides = 10 + tier * 2;
    const curve = growCurve(origin, dir0, right0, len, steps, (t0, t1) => ({
      pitch: (t1 - t0) * 0.14,
    }));

    const rings: number[][] = [];
    for (let i = 0; i < curve.count; i++) {
      const fr = curve.frameAtIndex(i);
      const t = fr.t;
      const r = rad * Math.sin(Math.pow(t, 0.45) * Math.PI * 0.94 + 0.15) * (1 - 0.65 * Math.pow(t, 2.2));
      const col = mixRgb(colMidrib, colYoung, t);
      const flex = baseFlex + Math.pow(t, 1.5) * 0.42 * this.p.windSail;
      const row: number[] = [];

      for (let j = 0; j < sides; j++) {
        // Spiral overlap lip along the rolled cylinder!
        const th = (j / sides) * TAU;
        const spiralRidge = 1 + 0.08 * Math.exp(-Math.pow(((th - (t * 8.0) % TAU) + TAU) % TAU - Math.PI, 2) * 3.0);
        const rr = Math.max(0.001, r * spiralRidge);
        const pt = add(fr.pos, add(scale(fr.right, Math.cos(th) * rr), scale(fr.up, Math.sin(th) * rr)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
            u: j / sides, v: t,
            color: col,
            wind: [saturate(pt.y / totalH), flex, phase, t * 0.08],
            pivot: stemPivot,
            roughness: 0.24,
            translucency: 0.78,
            detailMetric: t,
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
  }

  // ---------------------------------------------------------------------------
  // 3. Giant Megaphyll Paddle / Sagittate Blade along Welded Petiole-Midrib Spine!
  // ---------------------------------------------------------------------------

  private buildGiantTropicalLeafOnSpine(
    mesh: PartMesh,
    spine: CurveLine,
    opts: {
      stemPivot: V3;
      stemPhase: number;
      trunkAttachFlex: number;
      leafPhase: number;
      age01: number;
      L: number;
      maxHalfW: number;
      petioleFrac: number;
      petioleR0: number;
      totalHeightEst: number;
      colBlade: RGB;
      colYoung: RGB;
      colMidrib: RGB;
      colSenescent: RGB;
      tier: number;
      rng: Random;
    },
  ): void {
    const p = this.p;
    const {
      stemPivot,
      stemPhase,
      trunkAttachFlex,
      leafPhase,
      age01,
      L,
      maxHalfW,
      petioleFrac,
      petioleR0,
      totalHeightEst,
      colBlade,
      colYoung,
      colMidrib,
      colSenescent,
      tier,
      rng,
    } = opts;

    const isElephantEar = p.architecture === 'elephant_ear_alocasia';
    const isRedBanana = p.architecture === 'red_abyssinian_banana';
    const midribCol = isRedBanana ? hexToLinearRgb('#7d1828') : colMidrib;

    // Leaf age pigmentation (luminous chartreuse young inner leaves -> deep tropical emerald -> golden senescent skirt!)
    let baseLeafCol = mixRgb(colYoung, colBlade, smoothstep(0.0, 0.42, age01));
    if (isRedBanana) {
      baseLeafCol = mixRgb(baseLeafCol, hexToLinearRgb('#42141e'), 0.22);
    }
    const senFactor = p.senescence * smoothstep(0.68, 1.0, age01);
    baseLeafCol = mixRgb(baseLeafCol, colSenescent, senFactor * 0.78);

    if (isElephantEar) {
      // Sculpted Colossal Sagittate-Cordate Blade (with swept-back basal posterior ear lobes!)
      this.meshSagittateElephantBlade(
        mesh,
        spine,
        petioleFrac,
        L * (1 - petioleFrac),
        maxHalfW,
        baseLeafCol,
        midribCol,
        colSenescent,
        senFactor,
        stemPivot,
        totalHeightEst,
        stemPhase,
        leafPhase,
        trunkAttachFlex,
        tier,
        rng,
      );
    } else {
      // Giant Striated Banana / Ravenala / Strelitzia Paddle with Authentic Wind-Split Ribbons!
      this.meshWindSplitBananaPaddle(
        mesh,
        spine,
        petioleFrac,
        maxHalfW,
        petioleR0,
        baseLeafCol,
        midribCol,
        colSenescent,
        senFactor,
        age01,
        stemPivot,
        totalHeightEst,
        stemPhase,
        leafPhase,
        trunkAttachFlex,
        tier,
        rng,
      );
    }
  }

  /**
   * Meshes the giant oblong-elliptic banana paddle (`uBlade` in `[0..1]`),
   * splitting each left/right half along parallel lateral veins into independent
   * aerodynamic ribbons separated by V-clefts reaching `tearDepth` toward the midrib!
   */
  private meshWindSplitBananaPaddle(
    mesh: PartMesh,
    spine: CurveLine,
    s0: number,
    maxHalfW: number,
    petioleR0: number,
    colBlade: RGB,
    colMidrib: RGB,
    colSenescent: RGB,
    senFactor: number,
    age01: number,
    stemPivot: V3,
    totalH: number,
    stemPhase: number,
    leafPhase: number,
    trunkAttachFlex: number,
    tier: number,
    rng: Random,
  ): void {
    const p = this.p;
    const isRed = p.architecture === 'red_abyssinian_banana';
    // Older outer leaves accumulate more wind tears than brand-new inner leaves!
    const tearBase = Math.round(p.windTears * lerp1(0.35, 1.2, age01));
    const colsAcross = tier === 1 ? 5 : tier === 2 ? 7 : tier === 3 ? 9 : 12;

    // Build Left & Right blade halves independently so wind tears are naturally asymmetric!
    for (const side of [-1, 1]) {
      const nTears = Math.max(0, tearBase + rng.int(3) - 1);
      // Partition u in [0.0, 1.0] into `nTears + 1` ribbon intervals [uA, uB]
      const cuts: number[] = [0.0];
      for (let c = 1; c <= nTears; c++) {
        const uCut = clamp((c + rng.vary(0, 0.24)) / (nTears + 1), 0.04, 0.96);
        cuts.push(uCut);
      }
      cuts.sort((a, b) => a - b);
      cuts.push(1.0);

      for (let rIdx = 0; rIdx < cuts.length - 1; rIdx++) {
        const uStart = cuts[rIdx];
        const uEnd = cuts[rIdx + 1];
        const span = uEnd - uStart;
        if (span < 0.012) continue;

        const rowsInRibbon = clamp(Math.round(span * (tier === 1 ? 30 : tier === 2 ? 44 : tier === 3 ? 62 : 84)), 3, 48);
        const ribbonPhase = (((leafPhase + rIdx * 0.17 + (side > 0 ? 0.09 : 0)) % 1) + 1) % 1;
        // Independent static gravity hang & slight twist per wind-torn ribbon!
        const ribbonHang = nTears > 0 ? rng.vary(0.04, 0.14) * (0.4 + 0.6 * age01) : 0;
        const tearPen = clamp(p.tearDepth * rng.range(0.75, 1.1), 0.15, 0.94);

        const grid: number[][] = [];
        for (let r = 0; r <= rowsInRibbon; r++) {
          const tr = r / rowsInRibbon; // 0..1 within this ribbon
          const uBlade = lerp1(uStart, uEnd, tr); // 0..1 along entire blade

          // Oblong-paddle width envelope: rounded cordate-auriculate base -> broad parallel middle -> blunt cucullate tip!
          const baseRound = smoothstep(0.0, 0.11, uBlade) * 0.78 + 0.22 * smoothstep(0.0, 0.02, uBlade);
          const tipRound = Math.pow(Math.max(0, 1 - Math.pow(uBlade, 2.8)), 0.58);
          const halfW = maxHalfW * baseRound * tipRound;

          // V-cleft notch at torn ribbon boundaries (`rIdx > 0` at `tr -> 0`, `rIdx < last` at `tr -> 1`)
          const hasBottomTear = rIdx > 0;
          const hasTopTear = rIdx < cuts.length - 2;
          let cleftWidthMult = 1.0;
          if (hasBottomTear && tr < 0.08) {
            cleftWidthMult = Math.min(cleftWidthMult, lerp1(1 - tearPen * 0.12, 1.0, tr / 0.08));
          }
          if (hasTopTear && tr > 0.92) {
            cleftWidthMult = Math.min(cleftWidthMult, lerp1(1.0, 1 - tearPen * 0.12, (tr - 0.92) / 0.08));
          }

          // Parallel-pinnate lateral vein sweep: banana lateral veins sweep forward slightly (~8°–12°) from midrib to margin!
          const rowIndices: number[] = [];
          for (let c = 0; c <= colsAcross; c++) {
            const sLat = c / colsAcross; // 0 at midrib -> 1 at outer margin!

            // Forward sweep along rachis proportional to sLat (follows real parallel-pinnate vein angle!)
            const uSwept = clamp(uBlade + sLat * 0.038 * (1 - 0.4 * uBlade), 0, 1);
            const tSpine = s0 + (1 - s0) * uSwept;
            const fr = spine.atT(tSpine);
            const midR = lerp1(petioleR0, petioleR0 * 0.14, tSpine);

            const yDist = Math.max(0.002, halfW * cleftWidthMult * sLat);

            // Transverse blade profile:
            // 1) Adaxial V-dihedral lift near midrib (`laminaVDih`) transitioning into graceful convex arch & droop near margin!
            const dihedralLift = p.laminaVDih * maxHalfW * 0.48 * Math.sin(sLat * Math.PI * 0.62);
            const marginDroop = -Math.pow(sLat, 2.15) * maxHalfW * (0.24 + ribbonHang + 0.18 * age01);
            // 2) Parallel striate secondary vein corrugation!
            const striaWave = Math.sin(uBlade * 165.0) * 0.5 + 0.5;
            const veinRidge = striaWave * p.veinRelief * 0.0022 * (1 - 0.35 * sLat);
            // 3) Margin undulation wave
            const edgeRuffle =
              Math.sin(uBlade * 19.0 + side * 1.4) * p.edgeWave * maxHalfW * 0.065 * Math.pow(sLat, 1.6);

            // If this ribbon is torn open (`sLat > 1 - tearPen`), give it slight aerodynamic separation along `fr.up`!
            const freeRibbon = smoothstep(1 - tearPen, 1.0, sLat);
            const tearSep = (hasBottomTear || hasTopTear ? 1 : 0) * freeRibbon * ribbonHang * maxHalfW * 0.25;

            const zOff = dihedralLift + marginDroop + veinRidge + edgeRuffle - tearSep;
            const pt = add(
              addScaled(fr.pos, fr.right, side * (midR * 0.55 + yDist)),
              scale(fr.up, zOff),
            );

            // Color: bright midrib transition -> rich striated emerald mesophyll -> wine/golden margin!
            let vCol = mixRgb(colMidrib, colBlade, smoothstep(0.0, 0.16, sLat));
            vCol = mixRgb(vCol, colMidrib, striaWave * 0.12 * p.veinRelief);
            if (isRed) {
              vCol = mixRgb(vCol, hexToLinearRgb('#591321'), smoothstep(0.72, 1.0, sLat) * 0.65);
            }
            if (senFactor > 0.02) {
              vCol = mixRgb(vCol, colSenescent, smoothstep(0.55, 1.0, sLat) * senFactor);
            }

            // Proper Wind Attributes (C0/C1 welded to midrib at sLat == 0 & pseudostem at tSpine == 0):
            //   wind.x = normalized world height for whole-plant crown sway
            //   wind.y = cantilever petiole/midrib flex around `stemPivot`
            //   wind.z = phase matching midrib at sLat == 0 -> independent per-ribbon phase on outer torn strips!
            //   wind.w = lateral ribbon flap weight (0 at midrib -> high on free torn margin!)
            const h01 = saturate(pt.y / totalH);
            const spinePhase = lerp1(stemPhase, leafPhase, smoothstep(0.0, 0.28, tSpine));
            const effPhase = lerp1(spinePhase, ribbonPhase, smoothstep(0.08, 0.58, sLat));
            const petioleFlex = trunkAttachFlex + Math.pow(tSpine, 1.48) * 0.62 * p.windSail;
            const ribbonFlap = Math.pow(sLat, 1.35) * (0.45 + 0.65 * freeRibbon) * p.windSail;

            rowIndices.push(
              mesh.addVertex({
                x: pt.x, y: pt.y, z: pt.z,
                tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z, // midrib tangent for aerodynamic torsional roll!
                u: 0.5 + side * 0.5 * sLat,
                v: uBlade,
                color: vCol,
                wind: [h01, petioleFlex, effPhase, ribbonFlap],
                pivot: stemPivot,
                roughness: 0.28 + 0.14 * senFactor,
                translucency: clamp(0.84 - 0.35 * (1 - sLat) * (1 - sLat) - striaWave * 0.12, 0.2, 0.9),
                detailMetric: saturate((1 - sLat) * 0.55 + striaWave * 0.45),
                anatomyLevel: 3,
              }),
            );
          }
          grid.push(rowIndices);
        }

        for (let r = 0; r < rowsInRibbon; r++) {
          for (let c = 0; c < colsAcross; c++) {
            const a = grid[r][c];
            const b = grid[r][c + 1];
            const d = grid[r + 1][c];
            const e = grid[r + 1][c + 1];
            if (side > 0) mesh.addQuad(a, d, e, b);
            else mesh.addQuad(a, b, e, d);
          }
        }
        this.stats.ribbons++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Colossal Rainforest Elephant Ear (Alocasia macrorrhizos) Sagittate Blade
  // ---------------------------------------------------------------------------

  private meshSagittateElephantBlade(
    mesh: PartMesh,
    spine: CurveLine,
    s0: number,
    bladeL: number,
    maxHalfW: number,
    colBlade: RGB,
    colVein: RGB,
    colSenescent: RGB,
    senFactor: number,
    stemPivot: V3,
    totalH: number,
    stemPhase: number,
    leafPhase: number,
    trunkAttachFlex: number,
    tier: number,
    _rng: Random,
  ): void {
    const p = this.p;
    const rows = tier === 1 ? 26 : tier === 2 ? 38 : tier === 3 ? 52 : 70;
    const colsHalf = tier === 1 ? 7 : tier === 2 ? 10 : tier === 3 ? 14 : 18;

    const junctionFr = spine.atT(s0);

    // Parameter `u` runs from `-0.28` (swept-back basal posterior ear lobes!) to `1.0` (pointed anterior apex!)
    const grid: number[][] = [];
    for (let r = 0; r <= rows; r++) {
      const ur = r / rows;
      const u = lerp1(-0.28, 1.0, ur);
      const row: number[] = [];

      for (let c = -colsHalf; c <= colsHalf; c++) {
        const sSigned = c / colsHalf;
        const sAbs = Math.abs(sSigned);

        // Sagittate-cordate width & posterior sinus cleft!
        let halfW: number;
        let sinusCut = 0;
        if (u >= 0) {
          halfW = maxHalfW * Math.pow(Math.max(0, Math.sin(Math.pow(u, 0.62) * Math.PI * 0.94 + 0.18)), 0.78);
        } else {
          // Two rounded basal ear lobes behind the petiole attachment (`u` in `-0.28..0`), split by a deep V-sinus at `sAbs -> 0`!
          const backT = -u / 0.28; // 0 at junction -> 1 at posterior lobe tips
          halfW = maxHalfW * 0.76 * Math.sin((1 - backT * 0.88) * Math.PI * 0.5);
          sinusCut = backT; // open V-sinus along the centerline behind petiole!
        }

        // Map `sAbs` outside the posterior V-sinus when `u < 0`
        const effS = u < 0 ? lerp1(sinusCut * 0.58, 1.0, sAbs) : sAbs;
        const marginalWave = 1 + 0.045 * p.edgeWave * Math.sin(ur * 22.0) * smoothstep(0.5, 1.0, sAbs);
        const yDist = halfW * effS * marginalWave;

        let basePos: V3;
        let frDir: V3;
        let frRight: V3;
        let frUp: V3;
        let tFlex: number;

        if (u >= 0) {
          const tSpine = s0 + (1 - s0) * u;
          const fr = spine.atT(tSpine);
          basePos = fr.pos;
          frDir = fr.dir;
          frRight = fr.right;
          frUp = fr.up;
          tFlex = Math.pow(tSpine, 1.48);
        } else {
          // Sweep backward & upward from petiole junction for the two sagittate ear lobes!
          basePos = addScaled(junctionFr.pos, junctionFr.dir, u * bladeL * 0.92);
          basePos = addScaled(basePos, junctionFr.up, (-u) * bladeL * 0.16);
          frDir = junctionFr.dir;
          frRight = junctionFr.right;
          frUp = junctionFr.up;
          tFlex = Math.pow(s0 + (-u) * 0.25, 1.48);
        }

        // Bold palmate-pinnate Alocasia primary veins + quilted bullate interveinal domes!
        const veinCoord = u * 7.5 - effS * 1.45;
        const nearVein = Math.exp(-Math.pow(Math.sin(veinCoord * Math.PI), 2) * 14.0);
        const midribMask = u >= 0 ? Math.exp(-sAbs * sAbs * 42.0) : 0;
        const veinMask = saturate(midribMask + nearVein * (1 - midribMask) * (1 - 0.25 * effS));
        const quilt = (1 - nearVein) * Math.sin(effS * Math.PI) * 0.014 * p.veinRelief;
        const veinLift = -veinMask * 0.0055 * p.veinRelief; // prominent abaxial rib & recessed adaxial channel
        const vFold = p.laminaVDih * maxHalfW * 0.52 * Math.sin(effS * Math.PI * 0.65) - Math.pow(effS, 2.2) * maxHalfW * 0.22;
        const ruffleZ = Math.sin(ur * 18.0 + (sSigned >= 0 ? 0 : 1.2)) * p.edgeWave * maxHalfW * 0.075 * Math.pow(effS, 1.7);

        const pt = add(
          addScaled(basePos, frRight, (sSigned >= 0 ? 1 : -1) * yDist),
          scale(frUp, vFold + quilt + veinLift + ruffleZ),
        );

        let col = mixRgb(colBlade, colVein, veinMask * 0.82);
        if (senFactor > 0.02) col = mixRgb(col, colSenescent, smoothstep(0.65, 1.0, effS) * senFactor);

        const tSpinePhase = u >= 0 ? s0 + (1 - s0) * u : s0;
        const spinePhase = lerp1(stemPhase, leafPhase, smoothstep(0.0, 0.28, tSpinePhase));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: frDir.x, ty: frDir.y, tz: frDir.z,
            u: 0.5 + 0.5 * sSigned, v: ur,
            color: col,
            wind: [
              saturate(pt.y / totalH),
              trunkAttachFlex + tFlex * 0.62 * p.windSail,
              spinePhase,
              Math.pow(effS, 1.4) * 0.62 * p.windSail,
            ],
            pivot: stemPivot,
            roughness: 0.22,
            translucency: clamp(0.82 - veinMask * 0.48, 0.22, 0.88),
            detailMetric: veinMask,
            anatomyLevel: 3,
          }),
        );
      }
      grid.push(row);
    }

    const totalCols = colsHalf * 2;
    for (let r = 0; r < rows; r++) {
      const ur = (r + 0.5) / rows;
      const u = lerp1(-0.28, 1.0, ur);
      for (let c = 0; c < totalCols; c++) {
        // Leave clean open V-sinus gap right along the center column behind the petiole (`u < -0.02`)!
        if (u < -0.02 && (c === colsHalf - 1 || c === colsHalf)) continue;
        mesh.addQuad(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]);
      }
    }
    this.stats.ribbons++;
  }

  // ---------------------------------------------------------------------------
  // 5. Pendant Banana Inflorescence (Peduncle + Banana Fruit Hands + Crimson Bell!)
  // ---------------------------------------------------------------------------

  private buildBananaInflorescence(
    mesh: PartMesh,
    crownPos: V3,
    stemPivot: V3,
    _crownDir: V3,
    stemR: number,
    scaleSt: number,
    totalH: number,
    phase: number,
    baseFlex: number,
    tier: number,
    rng: Random,
  ): void {
    const az = rng.range(0, TAU);
    const outDir = normalize(v3(Math.cos(az), 0.35, Math.sin(az)));
    const right0 = normalize(cross(outDir, UP));
    const pedLen = 0.68 * scaleSt;

    // Thick green peduncle arching out of the crown and curving straight down under fruit weight!
    const ped = growCurve(crownPos, outDir, right0, pedLen, 18, (t0, t1) => ({
      gravity: (t1 - t0) * 2.55,
    }));
    const greenPed = hexToLinearRgb('#5c8a28');
    const pedSpan = 0.26 * this.p.windSail;
    this.meshSimpleTube(mesh, ped, stemR * 0.28, stemR * 0.14, 8, greenPed, greenPed, stemPivot, totalH, phase, baseFlex, pedSpan, 4);

    // 4 Radial Hands of Curved 3D Banana Fingers along mid-peduncle!
    const colFruitGreen = hexToLinearRgb('#7dbf2e');
    const colFruitGold = hexToLinearRgb('#e0b928');
    const nHands = 4;
    for (let h = 0; h < nHands; h++) {
      const th = 0.32 + (h / nHands) * 0.42;
      const fr = ped.atT(th);
      const handFlex = baseFlex + Math.pow(th, 1.4) * pedSpan;
      const ripeness = 1 - h / nHands;
      const handCol = mixRgb(colFruitGreen, colFruitGold, ripeness * 0.65);
      const fingers = tier >= 3 ? 7 : 5;

      for (let f = 0; f < fingers; f++) {
        const ang = ((f - (fingers - 1) * 0.5) / fingers) * 1.45 + h * 1.65;
        const rad = normalize(add(scale(fr.right, Math.cos(ang)), scale(fr.up, Math.sin(ang))));
        // Real banana fingers curve UPWARD (negative gravitropism!) away from the hanging stalk!
        const fStart = addScaled(fr.pos, rad, stemR * 0.18);
        const fDir0 = normalize(add(scale(rad, 0.85), scale(UP, 0.35)));
        const fRight = normalize(cross(fDir0, UP));
        const fLine = growCurve(fStart, fDir0, fRight, 0.135 * scaleSt, 6, (a0, a1) => ({
          pitch: -(a1 - a0) * 0.85,
        }));
        this.meshSimpleTube(
          mesh,
          fLine,
          0.015 * scaleSt,
          0.006 * scaleSt,
          5,
          handCol,
          hexToLinearRgb('#3d2b14'),
          stemPivot,
          totalH,
          phase,
          handFlex,
          0.0,
          5,
        );
        this.stats.fruitsOrFlowers++;
      }
    }

    // Sculpted Teardrop Crimson-Burgundy Banana Flower Bell at peduncle tip (`t = 1.0`)!
    const tip = ped.atT(1.0);
    const bellBaseFlex = baseFlex + pedSpan;
    const bellL = 0.21 * scaleSt;
    const bellR = 0.058 * scaleSt;
    const colBellBase = hexToLinearRgb('#5e1124');
    const colBellTip = hexToLinearRgb('#9c2440');
    const sides = 10 + tier * 2;
    const prof: [number, number][] = [
      [0.0, 0.28],
      [0.18, 0.82],
      [0.42, 1.0],
      [0.68, 0.74],
      [0.88, 0.34],
      [1.0, 0.02],
    ];
    const rings: number[][] = [];
    for (const [tb, rm] of prof) {
      const cPos = addScaled(tip.pos, tip.dir, tb * bellL);
      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const pt = add(cPos, add(scale(tip.right, Math.cos(th) * bellR * rm), scale(tip.up, Math.sin(th) * bellR * rm)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: tip.dir.x, ty: tip.dir.y, tz: tip.dir.z,
            u: j / sides, v: tb,
            color: mixRgb(colBellBase, colBellTip, tb),
            wind: [saturate(pt.y / totalH), bellBaseFlex, phase, 0.0],
            pivot: stemPivot,
            roughness: 0.32,
            translucency: 0.28,
            detailMetric: tb,
            anatomyLevel: 5,
          }),
        );
      }
      rings.push(row);
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(rings[r][j], rings[r][j1], rings[r + 1][j1], rings[r + 1][j]);
      }
    }
    this.stats.fruitsOrFlowers++;
  }

  private buildStrelitziaFlowers(
    mesh: PartMesh,
    crownPos: V3,
    stemPivot: V3,
    _crownDir: V3,
    stalkLen: number,
    totalH: number,
    phase: number,
    baseFlex: number,
    _tier: number,
    rng: Random,
  ): void {
    const colStalk = hexToLinearRgb('#3d6e42');
    const colSpathe = hexToLinearRgb('#2e1f38');
    const colOrange = hexToLinearRgb('#ff6a14');
    const colCobalt = hexToLinearRgb('#1f45d6');
    const stalkSpan = 0.34 * this.p.windSail;

    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      const dir = normalize(v3(side * 0.62, 0.78, rng.vary(0, 0.14)));
      const right = normalize(cross(dir, UP));
      const stalk = growCurve(crownPos, dir, right, stalkLen, 10, (a0, a1) => ({
        pitch: (a1 - a0) * 0.28,
      }));
      this.meshSimpleTube(mesh, stalk, 0.011, 0.008, 6, colStalk, colSpathe, stemPivot, totalH, phase, baseFlex, stalkSpan, 4);

      // Horizontal Crane-Beak Boat Spathe
      const top = stalk.atT(1.0);
      const topFlex = baseFlex + stalkSpan;
      const beakDir = normalize(v3(side * 0.94, 0.15, 0));
      const beakRight = normalize(cross(beakDir, UP));
      const beakLine = growCurve(top.pos, beakDir, beakRight, 0.24, 7, (a0, a1) => ({
        pitch: -(a1 - a0) * 0.18,
      }));
      this.meshSimpleTube(mesh, beakLine, 0.022, 0.003, 6, colSpathe, colSpathe, stemPivot, totalH, phase, topFlex, 0.0, 5);

      // Vivid Orange & Cobalt Emerging Tepal Plumes!
      for (let t = 0; t < 4; t++) {
        const bf = beakLine.atT(0.25 + t * 0.14);
        const plumeAngle = 0.45 + t * 0.22;
        const pDir = normalize(add(scale(beakDir, Math.cos(plumeAngle)), scale(UP, Math.sin(plumeAngle))));
        const pLine = growCurve(bf.pos, pDir, beakRight, 0.12 - t * 0.012, 4, () => ({}));
        const col = t === 3 ? colCobalt : colOrange;
        this.meshSimpleTube(mesh, pLine, 0.007, 0.001, 4, col, col, stemPivot, totalH, phase, topFlex, 0.02, 5);
        this.stats.fruitsOrFlowers++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helper Tube for Inflorescence Peduncle & Flowers
  // ---------------------------------------------------------------------------

  private meshSimpleTube(
    mesh: PartMesh,
    line: CurveLine,
    r0: number,
    r1: number,
    sides: number,
    col0: RGB,
    col1: RGB,
    pivot: V3,
    totalH: number,
    phase: number,
    baseFlex: number,
    flexSpan: number,
    anatomyLevel: number,
  ): void {
    const K = line.count;
    const rings: number[][] = [];
    for (let i = 0; i < K; i++) {
      const fr = line.frameAtIndex(i);
      const t = fr.t;
      const r = lerp1(r0, r1, t);
      const col = mixRgb(col0, col1, t);
      const flex = baseFlex + Math.pow(t, 1.4) * flexSpan;
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
            wind: [saturate(pt.y / totalH), flex, phase, 0.0],
            pivot,
            roughness: 0.35,
            translucency: 0.25,
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

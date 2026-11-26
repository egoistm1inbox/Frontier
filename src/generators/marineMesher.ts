/**
 * Procedural 3D Sea Plants & Marine Benthic Species Mesher (`MarineMesher`).
 *
 * Synthesizes 10 anatomically distinct underwater flora & sessile reef fauna:
 *   1. `giant_kelp`          — Haptera holdfast, buoyant stipes, pyriform pneumatocysts & bullate/dentate blades
 *   2. `bull_kelp`           — Haptera dome, inflating hollow whip stipe, floating bulb & streaming ribbon crown
 *   3. `neptune_seagrass`    — Creeping scaly rhizomes, Posidonia fibrous sheaths, strap leaves & reef epiphytes
 *   4. `sargassum_weed`      — Zigzag thallus axes, serrated midribbed phylloids & stalked berry gas vesicles
 *   5. `sea_lettuce_ulva`    — Hyperbolic-ruffled translucent emerald-jade foliose rosette sheets
 *   6. `staghorn_coral`      — Watertight closed 2-manifold Acropora antler skeleton, radial corallites & polyps
 *   7. `gorgonian_sea_fan`   — Planar flabellate ribs, anastomosing reticulate meshwork & 8-rayed octocoral polyps
 *   8. `sea_anemone`         — Verrucose pedal column, pleated oral disc & 3D inflated bubble-tip tentacles
 *   9. `azure_tube_sponge`   — True double-walled hollow organ-pipe chimneys with spicule conules & oscular rims
 *  10. `feather_star_crinoid`— Grasping cirri, pentagonal calyx & overarching pinnate feathery crinoid arms
 *
 * All 10 species enforce C0-continuous isometric SO(3) underwater current sway around a unified
 * seabed `groundOrigin` and coherent `colonyPhase`, with `flutter = 0` at every organ attachment
 * (`0.000 mm` seam separation and `0.000%` radial bladder/polyp stretch).
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
  growCurve,
  hexToLinearRgb,
  lengthSq,
  lerp as lerpV3,
  lerp1,
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
import {
  WeldedMeshConfig,
  WeldedMesher,
  WeldedNode,
  WeldedStem,
  sampleWeldedStem,
  validateWeldedManifold,
} from '../core/weldedManifold';
import { HostSubstrate } from '../substrates/substrate';
import { MarineParams } from './marineParams';

export interface MarineStats {
  stemsOrTubes: number;
  bladesOrTentacles: number;
  vesiclesOrPolyps: number;
  weldedJunctions: number;
  closedManifold: boolean;
}

export interface BuiltMarine {
  parts: PartMesh[];
  stats: MarineStats;
}

export class MarineMesher {
  private readonly p: MarineParams;
  private readonly rng: Random;
  private readonly substrate: HostSubstrate;
  private readonly colonyPhase: number;
  private groundOrigin: V3 = v3(0, 0, 0);
  private nextStemId = 1;
  private stats: MarineStats = {
    stemsOrTubes: 0,
    bladesOrTentacles: 0,
    vesiclesOrPolyps: 0,
    weldedJunctions: 0,
    closedManifold: true,
  };

  constructor(params: MarineParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.rng = new Random((seed ^ 0x6c4b9e31) >>> 0);
    this.substrate = substrate;
    this.colonyPhase = this.rng.range(0.07, 0.14);
  }

  build(layerId: string): BuiltMarine {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);

    const isCoral = p.species === 'staghorn_coral';
    const isFan = p.species === 'gorgonian_sea_fan';
    const isAnemone = p.species === 'sea_anemone';
    const isSponge = p.species === 'azure_tube_sponge';
    const isCrinoid = p.species === 'feather_star_crinoid';

    const holdfastName = isCoral
      ? 'Welded Calcified Antler Skeleton'
      : isSponge
        ? 'Hollow Organ-Pipe Chimney Walls'
        : isAnemone
          ? 'Verrucose Column & Oral Disc'
          : isCrinoid
            ? 'Pentagonal Calyx & Grasping Cirri'
            : p.species === 'neptune_seagrass'
              ? 'Creeping Rhizomes & Posidonia Sheaths'
              : 'Haptera Holdfast & Basal Foot';

    const stipeName = isFan
      ? 'Flabellate Ribs & Reticulate Lattice'
      : isCrinoid
        ? 'Segmented Brachial Arms'
        : 'Buoyant Stipes & Thallus Axes';

    const frondsName = isAnemone
      ? '3D Bubble-Tip Tentacles'
      : isCrinoid
        ? 'Feathery Sensory Pinnules'
        : p.species === 'neptune_seagrass'
          ? 'Multi-Veined Seagrass Straps'
          : p.species === 'sea_lettuce_ulva'
            ? 'Hyperbolic-Ruffled Thallus Lobes'
            : 'Corrugated Marine Blades';

    const vesiclesName = isCoral || isFan
      ? '3D Corallite Cups & Reef Polyps'
      : isSponge
        ? 'Thorny Spicule Conules'
        : p.species === 'neptune_seagrass'
          ? 'Crustose Coralline Epiphytes'
          : 'Pneumatocyst Gas Bladders';

    const holdfastMesh = new PartMesh(
      `${layerId}:holdfast`,
      holdfastName,
      'botanical',
      layerId,
      'roots',
      p.hueHoldfast,
    );
    const stipeMesh = new PartMesh(
      `${layerId}:stipe`,
      stipeName,
      'botanical',
      layerId,
      'tussock',
      p.huePrimary,
    );
    const frondsMesh = new PartMesh(
      `${layerId}:fronds`,
      frondsName,
      'botanical',
      layerId,
      'leaf',
      p.hueSecondary,
    );
    const vesiclesMesh = new PartMesh(
      `${layerId}:vesicles`,
      vesiclesName,
      'botanical',
      layerId,
      'sparkles',
      p.hueAccent,
    );

    const groundSample = this.substrate.sampleSurface(0.5, 0.5);
    this.groundOrigin = clone(groundSample.pos);

    switch (p.species) {
      case 'giant_kelp':
        this.buildGiantKelp(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'bull_kelp':
        this.buildBullKelp(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'neptune_seagrass':
        this.buildNeptuneSeagrass(tier, holdfastMesh, frondsMesh, vesiclesMesh);
        break;
      case 'sargassum_weed':
        this.buildSargassum(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'sea_lettuce_ulva':
        this.buildSeaLettuce(tier, holdfastMesh, frondsMesh, vesiclesMesh);
        break;
      case 'staghorn_coral':
        this.buildStaghornCoral(tier, holdfastMesh, vesiclesMesh);
        break;
      case 'gorgonian_sea_fan':
        this.buildGorgonianSeaFan(tier, holdfastMesh, stipeMesh, vesiclesMesh);
        break;
      case 'sea_anemone':
        this.buildSeaAnemone(tier, holdfastMesh, frondsMesh);
        break;
      case 'azure_tube_sponge':
        this.buildAzureTubeSponge(tier, holdfastMesh, vesiclesMesh);
        break;
      case 'feather_star_crinoid':
        this.buildFeatherStarCrinoid(tier, holdfastMesh, stipeMesh, frondsMesh);
        break;
    }

    holdfastMesh.metaLabel = isCoral
      ? `${this.stats.weldedJunctions} welded collars`
      : isSponge
        ? `${this.stats.stemsOrTubes} hollow tubes`
        : 'anchored base';
    stipeMesh.metaLabel = `${this.stats.stemsOrTubes} axes`;
    frondsMesh.metaLabel = `${this.stats.bladesOrTentacles.toLocaleString('en-US')} organs`;
    vesiclesMesh.metaLabel = `${this.stats.vesiclesOrPolyps.toLocaleString('en-US')} bodies`;

    return {
      parts: [holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh],
      stats: this.stats,
    };
  }

  // ===========================================================================
  // 1. GIANT BLADDER KELP (Macrocystis pyrifera)
  // ===========================================================================
  private buildGiantKelp(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colStipe = mixRgb(hexToLinearRgb(p.huePrimary), colHoldfast, 0.28);
    const colBladeBase = hexToLinearRgb(p.huePrimary);
    const colBladeTip = hexToLinearRgb(p.hueSecondary);
    const colBladder = hexToLinearRgb(p.hueAccent);

    // 1. Gnarled interwoven Haptera holdfast cone gripping reef stone
    const holdfastR = Math.max(0.11, p.colonyHeight * 0.068);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, holdfastR, tier >= 3 ? 26 : 16, colHoldfast, tier);

    // 2. Buoyant ascending cylindrical stipes leaning into ocean current
    const nStipes = clamp(Math.round(p.colonyCount), 1, 14);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;

    for (let sIdx = 0; sIdx < nStipes; sIdx++) {
      const sRng = this.rng.fork(0x1100 + sIdx * 97);
      const az = sIdx * GOLDEN_ANGLE + sRng.range(-0.2, 0.2);
      const radOff = holdfastR * 0.28 * Math.sqrt((sIdx + 0.3) / nStipes);
      const basePos = add(
        this.groundOrigin,
        v3(Math.cos(az) * radOff, holdfastR * 0.36, Math.sin(az) * radOff),
      );
      const spreadDir = v3(Math.cos(az), 0, Math.sin(az));
      const stipeH = p.colonyHeight * sRng.vary(0.94, 0.14);
      const stipePhase = (this.colonyPhase + sIdx * 0.006) % 1;
      const stipeMaxFlex = 0.30 * p.currentSway;

      const startDir = normalize(
        add(
          scale(UP, Math.cos(leanRad * 0.45)),
          add(scale(currentDir, Math.sin(leanRad * 0.45)), scale(spreadDir, 0.14 * p.canopySpread)),
        ),
      );
      const right0 = anyPerpendicular(startDir);
      const stipeSegs = tier >= 3 ? 28 : 18;
      const stipe = growCurve(basePos, startDir, right0, stipeH, stipeSegs, (t0, t1) => {
        const dt = t1 - t0;
        const helixPitch = Math.sin(t1 * TAU * 1.65 + sIdx * 1.3) * 0.16 * dt;
        const helixYaw = Math.cos(t1 * TAU * 1.65 + sIdx * 1.3) * 0.22 * dt;
        const streamBend = leanRad * 1.15 * Math.pow(t1, 0.85) * dt;
        return { pitch: helixPitch + streamBend, yaw: helixYaw };
      });

      const baseR = Math.max(0.008, p.colonyHeight * 0.0052);
      this.emitClosedTube(
        stipeMesh,
        stipe,
        (t) => baseR * (1.25 - 0.58 * Math.pow(t, 0.85)),
        tier >= 3 ? 8 : 6,
        (t) => mixRgb(colHoldfast, colStipe, smoothstep(0.0, 0.22, t)),
        0,
        stipeMaxFlex,
        stipePhase,
        0.26,
        p.translucency * 0.35,
      );
      this.stats.stemsOrTubes++;

      // 3. Alternate Pyriform Pneumatocysts + Corrugated Ruffled Kelp Blades along stipe!
      const nBlades = Math.max(8, Math.round((tier >= 3 ? 22 : 14) * p.organDensity * (stipeH / p.colonyHeight)));
      for (let b = 0; b < nBlades; b++) {
        const bFrac = b / Math.max(1, nBlades - 1);
        const tNode = lerp1(0.11, 0.985, bFrac);
        const fr = stipe.atT(tNode);
        const nodeFlex = Math.pow(tNode, 1.45) * stipeMaxFlex;

        // Alternate phyllotaxis spiralling gently along stipe, swept downstream by ocean current
        const sideAz = b * 2.45 + sIdx * 1.1;
        const latOut = normalize(
          add(scale(fr.right, Math.cos(sideAz)), scale(fr.up, Math.sin(sideAz))),
        );
        const bladderDir = normalize(
          add(scale(latOut, 0.58), add(scale(currentDir, 0.56), scale(UP, 0.22 - 0.28 * bFrac))),
        );

        const sizeEnv = Math.sin(Math.PI * Math.pow(clamp(bFrac * 0.92 + 0.06, 0.04, 0.98), 0.72));
        const bladeL = p.organLength * (0.34 + 0.78 * sizeEnv) * sRng.vary(1.0, 0.08);
        const bladeHalfW = bladeL * clamp(p.organWidth, 0.06, 0.45) * 0.42;

        let bladeOrigin = addScaled(fr.pos, latOut, baseR * 0.9);
        if (p.vesicleAbundance > 0.04) {
          const bladderLen = clamp(bladeL * 0.095 * (0.65 + 0.35 * p.vesicleAbundance), 0.022, 0.078);
          const bladderRad = bladderLen * 0.38;
          this.emitClosedOvoid(
            vesiclesMesh,
            bladeOrigin,
            bladderDir,
            bladderLen,
            bladderRad,
            tier >= 3 ? 8 : 6,
            tier >= 3 ? 6 : 5,
            colStipe,
            colBladder,
            0.18, // Glossy mucilage-coated gas bladder!
            p.translucency * 0.65,
            [clamp(tNode, 0, 1), nodeFlex, stipePhase, 0.0],
          );
          bladeOrigin = addScaled(bladeOrigin, bladderDir, bladderLen * 0.94);
          this.stats.vesiclesOrPolyps++;
        }

        const bladeDir = normalize(
          add(
            scale(bladderDir, 0.52),
            add(scale(currentDir, 0.65 * p.canopySpread), v3(0, -0.36 - 0.22 * (1 - bFrac), 0)),
          ),
        );
        this.emitCorrugatedKelpBlade(
          frondsMesh,
          bladeOrigin,
          bladeDir,
          bladeL,
          bladeHalfW,
          tier >= 3 ? 16 : 10,
          tier >= 3 ? 6 : 4,
          p.ruffleWave,
          true,
          mixRgb(colBladeBase, colBladder, 0.16),
          mixRgb(colBladeTip, colBladder, bFrac * 0.28),
          nodeFlex,
          0.13 * p.currentSway,
          0.24 * p.currentSway,
          stipePhase,
          sRng.range(0, TAU),
        );
        this.stats.bladesOrTentacles++;
      }
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 2. PACIFIC BULL WHIP KELP (Nereocystis luetkeana)
  // ===========================================================================
  private buildBullKelp(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colStipe = hexToLinearRgb(p.huePrimary);
    const colRibbon = hexToLinearRgb(p.hueSecondary);
    const colBulb = hexToLinearRgb(p.hueAccent);

    const holdfastR = Math.max(0.10, p.colonyHeight * 0.058);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, holdfastR, tier >= 3 ? 22 : 14, colHoldfast, tier);

    const nWhips = clamp(Math.round(p.colonyCount), 1, 9);
    const currentDir = normalize(v3(0.86, 0, 0.51));
    const leanRad = Math.max(10, p.currentLeanDeg) * DEG2RAD;

    for (let w = 0; w < nWhips; w++) {
      const wRng = this.rng.fork(0x2200 + w * 131);
      const az = w * GOLDEN_ANGLE + 0.4;
      const radOff = holdfastR * 0.34 * Math.sqrt((w + 0.25) / nWhips);
      const basePos = add(this.groundOrigin, v3(Math.cos(az) * radOff, holdfastR * 0.32, Math.sin(az) * radOff));
      const whipH = p.colonyHeight * wRng.vary(0.95, 0.12);
      const whipPhase = (this.colonyPhase + w * 0.008) % 1;
      const whipMaxFlex = 0.32 * p.currentSway;

      const spread = v3(Math.cos(az) * 0.22 * p.canopySpread, 0, Math.sin(az) * 0.22 * p.canopySpread);
      const startDir = normalize(add(UP, spread));
      const whip = growCurve(basePos, startDir, anyPerpendicular(startDir), whipH, tier >= 3 ? 30 : 20, (t0, t1) => {
        const dt = t1 - t0;
        // Graceful S-arch rising steeply then bending downstream near the water surface!
        const bend = leanRad * 1.65 * Math.pow(t1, 1.4) * dt;
        return { pitch: bend, yaw: Math.sin(t1 * Math.PI + w) * 0.14 * dt };
      });

      const minR = Math.max(0.007, whipH * 0.0038);
      const neckR = Math.max(0.026, whipH * 0.015);
      this.emitClosedTube(
        stipeMesh,
        whip,
        (t) => lerp1(minR * 1.35, minR, smoothstep(0, 0.25, t)) + neckR * Math.pow(smoothstep(0.52, 1.0, t), 1.65),
        tier >= 3 ? 10 : 8,
        (t) => mixRgb(colHoldfast, mixRgb(colStipe, colBulb, smoothstep(0.65, 1.0, t) * 0.55), smoothstep(0, 0.2, t)),
        0,
        whipMaxFlex,
        whipPhase,
        0.22,
        p.translucency * 0.35,
      );
      this.stats.stemsOrTubes++;

      // Floating Spherical Pneumatocyst Bulb welded seamlessly to the hollow stipe apex!
      const tipFr = whip.atT(1.0);
      const bulbFlex = whipMaxFlex;
      const bulbLen = Math.max(0.14, whipH * 0.068) * (0.78 + 0.22 * p.vesicleAbundance);
      const bulbRad = bulbLen * 0.56;
      const bulbStart = addScaled(tipFr.pos, tipFr.dir, -bulbLen * 0.14);
      this.emitClosedOvoid(
        vesiclesMesh,
        bulbStart,
        tipFr.dir,
        bulbLen,
        bulbRad,
        tier >= 3 ? 14 : 10,
        tier >= 3 ? 10 : 7,
        mixRgb(colStipe, colBulb, 0.55),
        colBulb,
        0.14,
        p.translucency * 0.55,
        [1.0, bulbFlex, whipPhase, 0.0],
      );
      this.stats.vesiclesOrPolyps++;

      // Streaming Undulating Silk-Ribbon Crown from two symmetrical apical pads on the floating bulb!
      const bulbApex = addScaled(bulbStart, tipFr.dir, bulbLen * 0.94);
      const nRibbons = Math.max(14, Math.round((tier >= 3 ? 28 : 18) * p.organDensity));
      for (let r = 0; r < nRibbons; r++) {
        const padSide = r % 2 === 0 ? -1 : 1;
        const rFrac = r / Math.max(1, nRibbons - 1);
        const fanAng = (rFrac - 0.5) * 1.45 + wRng.range(-0.14, 0.14);
        const padOrigin = add(
          bulbApex,
          add(scale(tipFr.right, padSide * bulbRad * 0.28), scale(tipFr.up, (rFrac - 0.5) * bulbRad * 0.22)),
        );
        const streamDir = normalize(
          add(
            scale(currentDir, 0.86 * p.canopySpread),
            add(
              scale(tipFr.right, Math.sin(fanAng) * 0.46 + padSide * 0.12),
              v3(0, 0.14 - 0.36 * rFrac + wRng.range(-0.08, 0.08), 0),
            ),
          ),
        );
        const ribLen = p.organLength * wRng.vary(1.0, 0.20);
        const ribHalfW = ribLen * clamp(p.organWidth, 0.04, 0.32) * 0.24;

        this.emitCorrugatedKelpBlade(
          frondsMesh,
          padOrigin,
          streamDir,
          ribLen,
          ribHalfW,
          tier >= 3 ? 22 : 14,
          4,
          p.ruffleWave * 0.85,
          false,
          mixRgb(colStipe, colRibbon, 0.35),
          mixRgb(colRibbon, colBulb, 0.28),
          bulbFlex,
          0.18 * p.currentSway,
          0.30 * p.currentSway,
          whipPhase,
          wRng.range(0, TAU),
          1.45,
        );
        this.stats.bladesOrTentacles++;
      }
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 3. NEPTUNE SEAGRASS MEADOW (Posidonia oceanica)
  // ===========================================================================
  private buildNeptuneSeagrass(
    tier: number,
    holdfastMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colRhizome = hexToLinearRgb(p.hueHoldfast);
    const colSheath = mixRgb(colRhizome, hexToLinearRgb('#2e2318'), 0.42);
    const colBase = hexToLinearRgb(p.huePrimary);
    const colTip = hexToLinearRgb(p.hueSecondary);
    const colYoung = hexToLinearRgb(p.hueAccent);
    const colEpiphyte = hexToLinearRgb(p.huePolyp);

    const nShoots = clamp(Math.round(p.colonyCount), 3, 36);
    const patchRadius = Math.max(0.28, p.colonyHeight * 0.48 * p.canopySpread);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;

    // 1. Creeping horizontal rhizome runners hugging substrate contours + Shoot Fans!
    const shootCenters: { pos: V3; nrm: V3; az: number }[] = [];
    for (let k = 0; k < nShoots; k++) {
      const sRng = this.rng.fork(0x3300 + k * 73);
      const rNorm = k === 0 ? 0 : Math.sqrt(k / nShoots) * sRng.vary(0.95, 0.1);
      const az = k * GOLDEN_ANGLE + sRng.range(-0.18, 0.18);
      const u = clamp(0.5 + Math.cos(az) * rNorm * 0.36, 0.08, 0.92);
      const v = clamp(0.5 + Math.sin(az) * rNorm * 0.36, 0.08, 0.92);
      const smp = this.substrate.sampleSurface(u, v);
      shootCenters.push({ pos: smp.pos, nrm: smp.normal, az });
    }

    // Connect neighboring shoots with creeping scaly seabed rhizome stolons!
    for (let k = 1; k < shootCenters.length; k++) {
      let bestParent = 0;
      let bestD2 = Infinity;
      for (let j = 0; j < k; j++) {
        const d2 = lengthSq(sub(shootCenters[k].pos, shootCenters[j].pos));
        if (d2 < bestD2) {
          bestD2 = d2;
          bestParent = j;
        }
      }
      const pA = add(shootCenters[bestParent].pos, v3(0, 0.012, 0));
      const pB = add(shootCenters[k].pos, v3(0, 0.012, 0));
      const span = sub(pB, pA);
      const spanLen = Math.sqrt(lengthSq(span));
      if (spanLen > 0.03 && spanLen < patchRadius * 1.15) {
        const stolon = growCurve(pA, normalize(span), UP, spanLen, 5, () => ({}));
        this.emitClosedTube(
          holdfastMesh,
          stolon,
          (t) => 0.013 * (1 + 0.18 * Math.sin(t * Math.PI * 6)),
          6,
          () => colRhizome,
          0,
          0,
          this.colonyPhase,
          0.86,
          0.04,
        );
      }
    }

    // 2. Emit Fibrous Basal Posidonia Sheath + Distichous Fan of Multi-Veined Strap Leaves per shoot!
    for (let k = 0; k < shootCenters.length; k++) {
      const sc = shootCenters[k];
      const sRng = this.rng.fork(0x3900 + k * 89);
      const shootPhase = (this.colonyPhase + k * 0.003) % 1;

      // Fibrous basal sheath bundle
      const sheathH = Math.max(0.055, p.colonyHeight * 0.085) * sRng.vary(1.0, 0.12);
      const sheathDir = normalize(add(scale(UP, 0.85), scale(sc.nrm, 0.15)));
      const sheathCurve = growCurve(sc.pos, sheathDir, anyPerpendicular(sheathDir), sheathH, 4, () => ({}));
      const sheathTopFlex = 0.03 * p.currentSway;
      this.emitClosedTube(
        holdfastMesh,
        sheathCurve,
        (t) => lerp1(0.022, 0.015, t),
        6,
        (t) => mixRgb(colSheath, colRhizome, t * 0.45),
        0,
        sheathTopFlex,
        shootPhase,
        0.90,
        0.05,
      );
      this.stats.stemsOrTubes++;

      const fanRight = v3(Math.cos(sc.az), 0, Math.sin(sc.az));
      const nBlades = Math.max(5, Math.round((tier >= 3 ? 8 : 5) * p.organDensity));
      const sheathApex = sheathCurve.atT(0.92).pos;

      for (let b = 0; b < nBlades; b++) {
        // Symmetrical distichous fan from outer mature blades to central young emerald blades!
        const centered = b / Math.max(1, nBlades - 1) - 0.5; // -0.5 .. +0.5
        const age = Math.abs(centered) * 2.0; // 0 = young central leaf, 1 = outer mature leaf
        const bladeLen = p.organLength * (1.06 - 0.28 * age * age) * sRng.vary(1.0, 0.12);
        const strapHalfW = Math.max(0.007, p.organLength * clamp(p.organWidth, 0.04, 0.25) * 0.16);

        const splayRad = centered * 0.62 * p.canopySpread;
        const emergeDir = normalize(
          add(
            scale(UP, Math.cos(leanRad * 0.55)),
            add(scale(currentDir, Math.sin(leanRad * 0.55)), scale(fanRight, Math.sin(splayRad))),
          ),
        );
        const uSegs = tier >= 3 ? 13 : 8;
        const extraFlex = (0.28 + 0.08 * (1 - age)) * p.currentSway;

        const baseCol = mixRgb(colYoung, colBase, smoothstep(0.0, 0.65, age));
        const tipCol = mixRgb(colYoung, colTip, smoothstep(0.0, 0.85, age));

        const strapPts = this.emitSeagrassStrap(
          frondsMesh,
          addScaled(sheathApex, fanRight, centered * 0.014),
          emergeDir,
          fanRight,
          currentDir,
          bladeLen,
          strapHalfW,
          uSegs,
          leanRad + age * 0.34,
          p.ruffleWave,
          baseCol,
          tipCol,
          sheathTopFlex,
          extraFlex,
          0.22 * p.currentSway,
          shootPhase,
        );
        this.stats.bladesOrTentacles++;

        // Crustose pink/white calcareous reef epiphytes on older outer blades!
        if (age > 0.45 && p.vesicleAbundance > 0.08 && strapPts.length > 4) {
          const nEpi = Math.round(3 * p.vesicleAbundance * age);
          for (let e = 0; e < nEpi; e++) {
            const idx = clamp(Math.floor(sRng.range(0.35, 0.88) * strapPts.length), 1, strapPts.length - 1);
            const sp = strapPts[idx];
            const epiR = strapHalfW * sRng.range(0.28, 0.55);
            this.emitClosedOvoid(
              vesiclesMesh,
              addScaled(sp.pos, sp.nrm, 0.0008),
              sp.nrm,
              epiR * 0.45,
              epiR,
              6,
              4,
              colEpiphyte,
              mixRgb(colEpiphyte, hexToLinearRgb('#fff5fa'), 0.45),
              0.72,
              0.12,
              sp.wind,
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
      }
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 4. GOLDEN BERRY SARGASSUM (Sargassum horneri / S. natans)
  // ===========================================================================
  private buildSargassum(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colAxis = hexToLinearRgb(p.huePrimary);
    const colLeaf = hexToLinearRgb(p.hueSecondary);
    const colBerry = hexToLinearRgb(p.hueAccent);

    const holdfastR = Math.max(0.075, p.colonyHeight * 0.062);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, holdfastR, tier >= 3 ? 16 : 10, colHoldfast, tier);

    const nAxes = clamp(Math.round(p.colonyCount), 2, 14);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;

    for (let a = 0; a < nAxes; a++) {
      const aRng = this.rng.fork(0x4400 + a * 107);
      const az = a * GOLDEN_ANGLE;
      const rad = holdfastR * 0.3 * Math.sqrt((a + 0.2) / nAxes);
      const origin = add(this.groundOrigin, v3(Math.cos(az) * rad, holdfastR * 0.28, Math.sin(az) * rad));
      const axisH = p.colonyHeight * aRng.vary(0.92, 0.16);
      const axisPhase = (this.colonyPhase + a * 0.007) % 1;
      const axisMaxFlex = 0.28 * p.currentSway;

      const splay = v3(Math.cos(az) * 0.28 * p.canopySpread, 0, Math.sin(az) * 0.28 * p.canopySpread);
      const startDir = normalize(add(UP, add(splay, scale(currentDir, Math.sin(leanRad * 0.6)))));
      const mainCurve = growCurve(origin, startDir, anyPerpendicular(startDir), axisH, tier >= 3 ? 22 : 14, (t0, t1) => {
        const dt = t1 - t0;
        const zig = Math.sin(t1 * TAU * 4.5 + a) * 0.26 * dt;
        return { pitch: leanRad * 0.7 * dt + zig, yaw: Math.cos(t1 * TAU * 3.5 + a) * 0.24 * dt };
      });

      const axisR = Math.max(0.0045, axisH * 0.0045);
      this.emitClosedTube(
        stipeMesh,
        mainCurve,
        (t) => axisR * (1.2 - 0.65 * t),
        6,
        (t) => mixRgb(colHoldfast, colAxis, smoothstep(0, 0.25, t)),
        0,
        axisMaxFlex,
        axisPhase,
        0.38,
        p.translucency * 0.35,
      );
      this.stats.stemsOrTubes++;

      // Lateral branches + serrated lanceolate phylloids + clustered spherical berry vesicles!
      const nLaterals = Math.max(7, Math.round((tier >= 3 ? 15 : 10) * p.organDensity));
      for (let l = 0; l < nLaterals; l++) {
        const lFrac = l / Math.max(1, nLaterals - 1);
        const tM = lerp1(0.12, 0.96, lFrac);
        const frM = mainCurve.atT(tM);
        const attachFlex = Math.pow(tM, 1.45) * axisMaxFlex;

        const latAz = l * GOLDEN_ANGLE + a * 0.8;
        const latOut = normalize(add(scale(frM.right, Math.cos(latAz)), scale(frM.up, Math.sin(latAz))));
        const latDir = normalize(add(scale(latOut, 0.72 * p.canopySpread), add(scale(UP, 0.58), scale(currentDir, 0.25))));
        const env = Math.sin(Math.PI * clamp(lFrac * 0.88 + 0.08, 0.06, 0.96));
        const latLen = axisH * (0.14 + 0.26 * env) * aRng.vary(1.0, 0.14);
        const latExtraFlex = 0.08 * p.currentSway;

        const latCurve = growCurve(frM.pos, latDir, anyPerpendicular(latDir), latLen, tier >= 3 ? 8 : 5, (t0, t1) => ({
          pitch: (t1 - t0) * 0.28,
        }));
        this.emitClosedTube(
          stipeMesh,
          latCurve,
          (t) => axisR * 0.62 * (1 - 0.55 * t),
          5,
          () => colAxis,
          attachFlex,
          latExtraFlex,
          axisPhase,
          0.4,
          p.translucency * 0.4,
        );
        this.stats.stemsOrTubes++;

        const nodesOnLat = tier >= 3 ? 5 : 3;
        for (let n = 0; n < nodesOnLat; n++) {
          const tL = lerp1(0.18, 0.98, n / Math.max(1, nodesOnLat - 1));
          const frL = latCurve.atT(tL);
          const nFlex = attachFlex + Math.pow(tL, 1.45) * latExtraFlex;
          const leafAz = n * GOLDEN_ANGLE + l;
          const leafOut = normalize(add(scale(frL.right, Math.cos(leafAz)), scale(frL.up, Math.sin(leafAz))));
          const leafDir = normalize(add(scale(leafOut, 0.78), add(scale(frL.dir, 0.48), v3(0, 0.15, 0))));

          const leafL = p.organLength * (0.55 + 0.55 * (1 - tL * 0.4)) * aRng.vary(1.0, 0.12);
          const leafHalfW = leafL * clamp(p.organWidth, 0.08, 0.45) * 0.45;
          this.emitCorrugatedKelpBlade(
            frondsMesh,
            frL.pos,
            leafDir,
            leafL,
            leafHalfW,
            tier >= 3 ? 8 : 5,
            4,
            p.ruffleWave,
            true,
            colAxis,
            colLeaf,
            nFlex,
            0.05 * p.currentSway,
            0.16 * p.currentSway,
            axisPhase,
            aRng.range(0, TAU),
          );
          this.stats.bladesOrTentacles++;

          // Spherical golden berry pneumatocysts clustered in the phylloid axil!
          const nBerries = Math.round((1 + (n < 3 ? 1 : 0)) * p.vesicleAbundance);
          for (let vIdx = 0; vIdx < nBerries; vIdx++) {
            const bAz = leafAz + 1.1 + vIdx * 1.9;
            const bDir = normalize(
              add(scale(UP, 0.76), add(scale(frL.right, Math.cos(bAz) * 0.52), scale(frL.up, Math.sin(bAz) * 0.52))),
            );
            const berryR = clamp(leafL * 0.068, 0.006, 0.016) * aRng.vary(1.0, 0.12);
            const berryPos = addScaled(frL.pos, bDir, berryR * 0.9);
            this.emitClosedOvoid(
              vesiclesMesh,
              berryPos,
              bDir,
              berryR * 2.15,
              berryR,
              tier >= 3 ? 7 : 5,
              tier >= 3 ? 5 : 4,
              mixRgb(colAxis, colBerry, 0.55),
              colBerry,
              0.16,
              p.translucency * 0.72,
              [clamp(tM, 0, 1), nFlex, axisPhase, 0.0],
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
      }
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 5. RUFFLED SEA LETTUCE (Ulva lactuca)
  // ===========================================================================
  private buildSeaLettuce(
    tier: number,
    holdfastMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colBase = hexToLinearRgb(p.huePrimary);
    const colMid = hexToLinearRgb(p.hueSecondary);
    const colRim = hexToLinearRgb(p.hueAccent);
    const colPearl = hexToLinearRgb(p.huePolyp);

    const discR = Math.max(0.045, p.colonyHeight * 0.11);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, discR, 10, colHoldfast, tier);
    this.stats.stemsOrTubes = 1;

    const nLobes = clamp(Math.round(p.colonyCount * p.organDensity), 5, 26);
    const radRings = tier >= 3 ? 14 : 9;
    const angCols = tier >= 3 ? 32 : 20;

    for (let l = 0; l < nLobes; l++) {
      const lRng = this.rng.fork(0x5500 + l * 83);
      const tierFrac = l / Math.max(1, nLobes - 1); // 0 = inner upright lobes, 1 = outer spreading rosette lobes
      const az = l * GOLDEN_ANGLE + lRng.range(-0.14, 0.14);
      const lobePhase = (this.colonyPhase + l * 0.004) % 1;

      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const tangDir = v3(-Math.sin(az), 0, Math.cos(az));
      const elev = lerp1(68, 20, tierFrac) * DEG2RAD;
      const axisDir = normalize(add(scale(radDir, Math.cos(elev) * p.canopySpread), scale(UP, Math.sin(elev))));
      const lobeNormal0 = normalize(cross(tangDir, axisDir));

      const lobeLen = p.organLength * (0.72 + 0.42 * Math.sin(Math.PI * (0.25 + 0.65 * tierFrac))) * lRng.vary(1.0, 0.1);
      const fanSpanRad = (112 + 52 * clamp(p.organWidth, 0.2, 1.0)) * DEG2RAD;
      const waveSeed = lRng.range(0, TAU);
      const baseOrigin = add(this.groundOrigin, addScaled(v3(0, discR * 0.22, 0), radDir, discR * 0.28 * tierFrac));

      // Build 2D polar grid with smooth rounded petaloid lobes & hyperbolic circumference ruffling!
      const posGrid: V3[][] = [];
      const windGrid: [number, number, number, number][][] = [];
      const colGrid: RGB[][] = [];

      for (let rIdx = 0; rIdx <= radRings; rIdx++) {
        const u = rIdx / radRings; // 0 at holdfast stalk -> 1 at ruffled margin
        const rDist = Math.max(0.008, lobeLen * Math.pow(u, 0.92));
        const rowFlex = (0.04 + 0.20 * Math.pow(u, 1.45)) * p.currentSway;
        const rowFlut = 0.24 * u * u * p.currentSway;
        const rowWind: [number, number, number, number] = [u, rowFlex, lobePhase, rowFlut];

        const pRow: V3[] = [];
        const wRow: [number, number, number, number][] = [];
        const cRow: RGB[] = [];

        for (let cIdx = 0; cIdx <= angCols; cIdx++) {
          const v = cIdx / angCols - 0.5; // -0.5 .. +0.5
          const theta = v * fanSpanRad * (0.22 + 0.78 * smoothstep(0.0, 0.42, u));
          // Smooth rounded fan envelope so outer lobe corners curve naturally instead of sharp squares!
          const roundEnv = Math.pow(Math.max(0.08, Math.cos(v * Math.PI * 0.92)), 0.36);
          const marginLobe =
            roundEnv * (1 + 0.13 * Math.cos(theta * 3.5 + waveSeed) * smoothstep(0.25, 1.0, u));
          const localR = rDist * marginLobe;

          const dirInSheet = normalize(add(scale(axisDir, Math.cos(theta)), scale(tangDir, Math.sin(theta))));
          const ruffleWaveH =
            (Math.sin(theta * 6.0 + waveSeed) + 0.48 * Math.sin(theta * 12.0 - waveSeed * 1.4)) *
            lobeLen *
            0.14 *
            p.ruffleWave *
            Math.pow(u, 1.62) *
            roundEnv;
          const cupH = -0.09 * lobeLen * u * u;
          const pt = add(addScaled(baseOrigin, dirInSheet, localR), scale(lobeNormal0, ruffleWaveH + cupH));

          const baseToMid = mixRgb(colBase, colMid, smoothstep(0.10, 0.78, u));
          const col = mixRgb(baseToMid, colRim, smoothstep(0.74, 1.0, u) * 0.65);

          pRow.push(pt);
          wRow.push(rowWind);
          cRow.push(col);
        }
        posGrid.push(pRow);
        windGrid.push(wRow);
        colGrid.push(cRow);
      }

      // Compute analytical finite-difference normals on the hyperbolic sheet!
      const idxGrid: number[][] = [];
      for (let rIdx = 0; rIdx <= radRings; rIdx++) {
        const u = rIdx / radRings;
        const rowIds: number[] = [];
        for (let cIdx = 0; cIdx <= angCols; cIdx++) {
          const v01 = cIdx / angCols;
          const pU0 = posGrid[Math.max(0, rIdx - 1)][cIdx];
          const pU1 = posGrid[Math.min(radRings, rIdx + 1)][cIdx];
          const pV0 = posGrid[rIdx][Math.max(0, cIdx - 1)];
          const pV1 = posGrid[rIdx][Math.min(angCols, cIdx + 1)];
          const dU = sub(pU1, pU0);
          const dV = sub(pV1, pV0);
          let nrm = cross(dV, dU);
          nrm = lengthSq(nrm) > 1e-12 ? normalize(nrm) : lobeNormal0;
          const tang = lengthSq(dU) > 1e-12 ? normalize(dU) : axisDir;
          const pt = posGrid[rIdx][cIdx];

          rowIds.push(
            frondsMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nrm.x, ny: nrm.y, nz: nrm.z,
              tx: tang.x, ty: tang.y, tz: tang.z,
              u: v01, v: u,
              color: colGrid[rIdx][cIdx],
              wind: windGrid[rIdx][cIdx],
              pivot: this.groundOrigin,
              roughness: 0.22,
              translucency: p.translucency,
              detailMetric: smoothstep(0.5, 1.0, u),
              anatomyLevel: 3,
            }),
          );

          // Tiny oxygen micro-pearls along outer sunlit ruffled edge
          if (rIdx === radRings && p.vesicleAbundance > 0.12 && cIdx % 5 === 2) {
            const pearlR = 0.0045 * (0.7 + 0.6 * p.vesicleAbundance);
            this.emitClosedOvoid(
              vesiclesMesh,
              addScaled(pt, nrm, pearlR * 0.9),
              nrm,
              pearlR * 1.9,
              pearlR,
              6,
              4,
              colPearl,
              hexToLinearRgb('#f0fff8'),
              0.08,
              0.88,
              [u, windGrid[rIdx][cIdx][1], lobePhase, 0.0],
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
        idxGrid.push(rowIds);
      }

      for (let rIdx = 0; rIdx < radRings; rIdx++) {
        for (let cIdx = 0; cIdx < angCols; cIdx++) {
          frondsMesh.addQuad(
            idxGrid[rIdx][cIdx],
            idxGrid[rIdx][cIdx + 1],
            idxGrid[rIdx + 1][cIdx + 1],
            idxGrid[rIdx + 1][cIdx],
          );
        }
      }
      this.stats.bladesOrTentacles++;
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 6. BRANCHING STAGHORN CORAL (Acropora cervicornis) — Watertight 2-Manifold!
  // ===========================================================================
  private buildStaghornCoral(
    tier: number,
    skeletonMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast);
    const colCoenosarc = hexToLinearRgb(p.huePrimary);
    const colBranchHi = hexToLinearRgb(p.hueSecondary);
    const colAxialTip = hexToLinearRgb(p.hueAccent);
    const colPolyp = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.35, p.colonyHeight);
    const trunkR = Math.max(0.032, H * 0.048 * clamp(p.organWidth / 0.16, 0.65, 1.65));
    const cfg: WeldedMeshConfig = {
      trunkRadialSegments: tier >= 3 ? 16 : 12,
      minRadialSegments: tier >= 3 ? 8 : 6,
      collarScale: 1.2,
      collarLength: 1.1,
      collarRings: tier >= 3 ? 2 : 1,
      collarFillet: 0.78,
      collarMitre: 0.5,
      minRadius: 0.0055,
      capTips: true,
    };

    const coralFlexGain = 0.025 * p.currentSway; // Calcified aragonite skeleton has very stiff subtle sway!
    const allShootStems: WeldedStem[] = [];

    const evalCoralFlex = (pos: V3): number => {
      const h01 = saturate((pos.y - this.groundOrigin.y) / H);
      return smoothstep(0.04, 0.18, h01) * Math.pow(h01, 1.6) * coralFlexGain;
    };

    const buildCoralNodes = (origin: V3, dir0: V3, len: number, curveUp: number, seedOff: number): WeldedNode[] => {
      const steps = Math.max(5, Math.round(len / Math.max(0.025, trunkR * 0.55)));
      const bRng = this.rng.fork(seedOff);
      const nodes: WeldedNode[] = [];
      let pos = clone(origin);
      let dir = normalize(dir0);
      let right = anyPerpendicular(dir);
      let sAcc = 0;
      const ds = len / steps;
      for (let i = 0; i <= steps; i++) {
        nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s: sAcc });
        if (i < steps) {
          pos = addScaled(pos, dir, ds);
          sAcc += ds;
          // Phototropic upward arch characteristic of staghorn Acropora tines!
          const nextDir = normalize(
            add(
              dir,
              add(
                scale(UP, curveUp * (1 / steps)),
                scale(right, bRng.range(-0.06, 0.06)),
              ),
            ),
          );
          right = projectOnPlane(right, nextDir);
          right = lengthSq(right) > 1e-9 ? normalize(right) : anyPerpendicular(nextDir);
          dir = nextDir;
        }
      }
      return nodes;
    };

    const makeTine = (
      origin: V3,
      dir0: V3,
      len: number,
      r0: number,
      r1: number,
      level: number,
      parent: WeldedStem | null,
      attach: WeldedStem['attach'],
      attachS: number,
      isTerminal: boolean,
      seedOff: number,
    ): WeldedStem => {
      const nodes = buildCoralNodes(origin, dir0, len, level === 0 ? 0.12 : 0.42, seedOff);
      const realLen = nodes[nodes.length - 1].s;
      const stem: WeldedStem = {
        id: this.nextStemId++,
        level,
        role: 'shoot',
        parent,
        attach,
        attachS,
        attachDir: clone(nodes[0].dir),
        nodes,
        length: realLen,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 1,
        windowCols: 2,
        minRing: level === 0 ? cfg.trunkRadialSegments : tier >= 3 ? 10 : 8,
        ringSpacing: clamp(r0 * 0.48, 0.016, 0.045),
        baseRadiusAt: (sVal: number) => {
          const z = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          // Smooth staghorn cylinder tapering cleanly to rounded dome axial corallite tip!
          const tipRound = isTerminal && z > 0.88 ? Math.cos(((z - 0.88) / 0.12) * 0.72) : 1.0;
          return Math.max(cfg.minRadius, lerp1(r0, r1, Math.pow(z, 0.78)) * tipRound);
        },
        profileFactor: (sVal: number, th: number) => {
          const z = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          const rug = fbm3(Math.cos(th) * 2.4, z * realLen * 14.0, Math.sin(th) * 2.4, seedOff & 0xffff, 2);
          const coralliteBump = Math.pow(0.5 + 0.5 * Math.cos(th * 6 + z * realLen * 48.0), 3.0);
          return 1 + 0.035 * rug + 0.045 * p.ruffleWave * coralliteBump * (1 - 0.5 * smoothstep(0.85, 1.0, z));
        },
        styleAt: (sVal: number, _th: number, pos: V3, _dir: V3, isJunc: boolean) => {
          const z = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          const h01 = saturate((pos.y - this.groundOrigin.y) / H);
          let col = mixRgb(colBase, colCoenosarc, smoothstep(0.0, 0.24, h01));
          col = mixRgb(col, colBranchHi, smoothstep(0.32, 0.85, h01) * 0.68);
          if (isTerminal) {
            // Iconic pale / bioluminescent Acropora axial growth tip!
            col = mixRgb(col, colAxialTip, smoothstep(0.76, 0.96, z));
          }
          return {
            color: col,
            roughness: 0.52,
            translucency: isTerminal && z > 0.75 ? Math.max(0.38, p.translucency) : p.translucency * 0.65,
            detailMetric: isJunc ? 0.96 : isTerminal && z > 0.8 ? 0.92 : 0.38,
            anatomyLevel: level + 1,
            wind: [h01, evalCoralFlex(pos), this.colonyPhase, 0],
            pivot: this.groundOrigin,
          };
        },
        regrow: (newOrigin: V3, newDir: V3) => {
          const rebuilt = buildCoralNodes(newOrigin, newDir, len, level === 0 ? 0.12 : 0.42, seedOff);
          stem.nodes = rebuilt;
          stem.length = rebuilt[rebuilt.length - 1].s;
        },
      };
      allShootStems.push(stem);
      return stem;
    };

    // Build basal calcified pedestal + encrusting reef holdfast lobes
    const pedLen = H * 0.22;
    const subDepth = trunkR * 1.4;
    const pedStart = add(this.groundOrigin, v3(0, -subDepth, 0));
    const leanRad = p.currentLeanDeg * DEG2RAD * 0.4;
    const pedDir = normalize(v3(Math.sin(leanRad), Math.cos(leanRad), 0));
    const trunk = makeTine(
      pedStart,
      pedDir,
      pedLen + subDepth,
      trunkR * 1.24,
      trunkR * 0.92,
      0,
      null,
      'root',
      0,
      false,
      0x6100,
    );

    // 4 basal encrusting reef buttress lobes (evenly spaced around trunk ring -> zero window overlap!)
    const N = cfg.trunkRadialSegments;
    const nRoots = 4;
    for (let k = 0; k < nRoots; k++) {
      const col = Math.round((k / nRoots) * N) % N;
      const theta = (col + 1) * (TAU / N);
      const attachS = subDepth + trunkR * 0.55;
      const smp = sampleWeldedStem(trunk, attachS);
      const up = cross(smp.dir, smp.right);
      const radial = normalize(add(scale(smp.right, Math.cos(theta)), scale(up, Math.sin(theta))));
      const emerge = normalize(add(scale(radial, 0.86), v3(0, -0.46, 0)));
      const rLen = trunkR * 2.6;
      const r0 = trunkR * 0.42;
      const rNodes = buildCoralNodes(addScaled(smp.pos, radial, trunkR), emerge, rLen, -0.18, 0x6200 + k * 37);
      const rStem: WeldedStem = {
        id: this.nextStemId++,
        level: 4,
        role: 'root',
        parent: trunk,
        attach: 'side',
        attachS,
        attachDir: emerge,
        nodes: rNodes,
        length: rNodes[rNodes.length - 1].s,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 1,
        windowCols: 2,
        minRing: 6,
        ringSpacing: 0.022,
        baseRadiusAt: (sVal: number) => Math.max(cfg.minRadius, r0 * Math.pow(1 - clamp(sVal / rLen, 0, 1), 0.72)),
        styleAt: (_s, _th, pos, _d, isJunc) => ({
          color: colBase,
          roughness: 0.68,
          translucency: 0.12,
          detailMetric: isJunc ? 0.95 : 0.25,
          anatomyLevel: 0,
          wind: [0, evalCoralFlex(pos), this.colonyPhase, 0],
          pivot: this.groundOrigin,
        }),
        regrow: (o: V3, d: V3) => {
          const rn = buildCoralNodes(o, d, rLen, -0.18, 0x6200 + k * 37);
          rStem.nodes = rn;
          rStem.length = rn[rn.length - 1].s;
        },
      };
      trunk.children.push(rStem);
    }

    // Primary crown boughs via 3-way fork atop pedestal!
    const nPrimary = clamp(Math.round(p.colonyCount), 2, 3);
    const topNode = trunk.nodes[trunk.nodes.length - 1];
    const maxOrder = clamp(Math.round(p.branchOrder), 1, 3);

    for (let b = 0; b < nPrimary; b++) {
      const bAz = (b / nPrimary) * TAU + 0.35;
      const bOut = v3(Math.cos(bAz), 0, Math.sin(bAz));
      const bDir = normalize(add(scale(UP, 0.74), scale(bOut, 0.56 * p.canopySpread)));
      const bLen = H * 0.44 * this.rng.vary(1.0, 0.08);
      const rB0 = trunkR * 0.60;
      const rB1 = trunkR * 0.42;
      const bough = makeTine(
        topNode.pos,
        bDir,
        bLen,
        rB0,
        rB1,
        1,
        trunk,
        'fork',
        trunk.length,
        maxOrder === 1,
        0x6300 + b * 101,
      );
      trunk.forks.push(bough);

      if (maxOrder >= 2) {
        // 2 well-separated side staghorn tines along each primary bough!
        for (let c = 0; c < 2; c++) {
          const sFrac = c === 0 ? 0.34 : 0.66;
          const attS = bough.length * sFrac;
          const smp = sampleWeldedStem(bough, attS);
          const sideSign = c === 0 ? 1 : -1;
          const cOut = normalize(
            add(scale(bOut, 0.55), scale(v3(-bOut.z * sideSign, 0, bOut.x * sideSign), 0.72)),
          );
          const cDir = normalize(add(scale(UP, 0.68), scale(cOut, 0.64 * p.canopySpread)));
          const cLen = H * (c === 0 ? 0.42 : 0.34) * this.rng.vary(1.0, 0.1);
          const sideTine = makeTine(
            addScaled(smp.pos, cOut, rB0 * 0.8),
            cDir,
            cLen,
            rB0 * 0.58,
            rB0 * 0.42,
            2,
            bough,
            'side',
            attS,
            true,
            0x6500 + b * 53 + c * 19,
          );
          bough.children.push(sideTine);
        }

        // Terminal dichotomous 2-way antler fork at top of each primary bough!
        const bEnd = bough.nodes[bough.nodes.length - 1];
        const perp = v3(-bOut.z, 0, bOut.x);
        for (const fSign of [-1, 1]) {
          const fDir = normalize(
            add(scale(bEnd.dir, 0.76), add(scale(perp, fSign * 0.46 * p.canopySpread), scale(bOut, 0.22))),
          );
          const fLen = H * 0.38 * this.rng.vary(1.0, 0.09);
          const forkTine = makeTine(
            bEnd.pos,
            fDir,
            fLen,
            rB1 * 0.78,
            rB1 * 0.56,
            2,
            bough,
            'fork',
            bough.length,
            maxOrder < 3,
            0x6700 + b * 71 + (fSign > 0 ? 11 : 3),
          );
          bough.forks.push(forkTine);

          if (maxOrder >= 3) {
            // One clean side antler tine + terminal fork!
            const sMid = forkTine.length * 0.48;
            const smpM = sampleWeldedStem(forkTine, sMid);
            const subDir = normalize(add(scale(UP, 0.72), scale(add(bOut, scale(perp, fSign * 0.8)), 0.52)));
            const subTine = makeTine(
              smpM.pos,
              subDir,
              H * 0.25,
              rB1 * 0.48,
              rB1 * 0.34,
              3,
              forkTine,
              'side',
              sMid,
              true,
              0x6900 + b * 41 + (fSign > 0 ? 7 : 2),
            );
            forkTine.children.push(subTine);

            const fEnd = forkTine.nodes[forkTine.nodes.length - 1];
            for (const gSign of [-1, 1]) {
              const gDir = normalize(add(scale(fEnd.dir, 0.80), scale(perp, gSign * 0.38)));
              const tipTine = makeTine(
                fEnd.pos,
                gDir,
                H * 0.24 * this.rng.vary(1.0, 0.08),
                rB1 * 0.46,
                rB1 * 0.33,
                3,
                forkTine,
                'fork',
                forkTine.length,
                true,
                0x6b00 + b * 29 + (fSign > 0 ? 10 : 0) + (gSign > 0 ? 5 : 1),
              );
              forkTine.forks.push(tipTine);
            }
          }
        }
      }
    }

    const wStats = new WeldedMesher(skeletonMesh, [trunk], cfg).build();
    const topo = validateWeldedManifold(skeletonMesh);
    this.stats.weldedJunctions = wStats.junctions + wStats.forks;
    this.stats.closedManifold = topo.closed && topo.manifold && topo.components === 1;
    this.stats.stemsOrTubes = allShootStems.length;

    // Sculpt 3D Radial Tubular Corallites & Glowing Polyp Crowns along all staghorn tines!
    if (p.vesicleAbundance > 0.05) {
      const density = (tier >= 3 ? 46 : 24) * p.vesicleAbundance * p.organDensity;
      for (const st of allShootStems) {
        if (st.dropped || st.level === 0) continue;
        const nCorallites = Math.max(6, Math.round(st.length * density));
        for (let k = 0; k < nCorallites; k++) {
          const sFrac = lerp1(0.10, 0.91, k / Math.max(1, nCorallites - 1));
          const sPos = st.length * sFrac;
          const smp = sampleWeldedStem(st, sPos);
          const rStemHere = st.baseRadiusAt(sPos);
          const az = k * GOLDEN_ANGLE + st.id * 0.7;
          const up = cross(smp.dir, smp.right);
          const radial = normalize(add(scale(smp.right, Math.cos(az)), scale(up, Math.sin(az))));
          // Oblique 44-deg upward-cupped Acropora radial corallite!
          const cupDir = normalize(add(scale(radial, 0.74), scale(smp.dir, 0.67)));
          const basePt = addScaled(smp.pos, radial, rStemHere * 0.84);
          const cupLen = clamp(rStemHere * 0.76, 0.006, 0.018);
          const cupR = cupLen * 0.44;
          const flex = evalCoralFlex(basePt);
          const h01 = saturate((basePt.y - this.groundOrigin.y) / H);

          this.emitClosedOvoid(
            polypsMesh,
            basePt,
            cupDir,
            cupLen,
            cupR,
            6,
            4,
            colBranchHi,
            mixRgb(colAxialTip, colPolyp, 0.55),
            0.35,
            0.48,
            [h01, flex, this.colonyPhase, 0.0],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
  }

  // ===========================================================================
  // 7. RETICULATE GORGONIAN SEA FAN (Gorgonia ventalina)
  // ===========================================================================
  private buildGorgonianSeaFan(
    tier: number,
    holdfastMesh: PartMesh,
    latticeMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colMainRib = hexToLinearRgb(p.huePrimary);
    const colLattice = hexToLinearRgb(p.hueSecondary);
    const colRim = hexToLinearRgb(p.hueAccent);
    const colPolyp = hexToLinearRgb(p.huePolyp);

    const nFans = clamp(Math.round(p.colonyCount), 1, 5);
    const H = Math.max(0.45, p.colonyHeight);
    const holdfastR = Math.max(0.075, H * 0.068);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, holdfastR, 12, colHoldfast, tier);

    for (let f = 0; f < nFans; f++) {
      const fRng = this.rng.fork(0x7100 + f * 113);
      const fanScale = f === 0 ? 1.0 : fRng.range(0.68, 0.88);
      const fanH = H * fanScale;
      const fanW = fanH * 0.92 * p.canopySpread;
      const fanYaw = (f === 0 ? 0.18 : f * 1.15 - 0.55) + fRng.range(-0.12, 0.12);
      const fanRight = v3(Math.cos(fanYaw), 0, Math.sin(fanYaw));
      const fanNormal = v3(-Math.sin(fanYaw), 0, Math.cos(fanYaw));
      const fanPhase = (this.colonyPhase + f * 0.009) % 1;
      const fanMaxFlex = 0.22 * p.currentSway;

      const fanOrigin = add(
        this.groundOrigin,
        add(scale(fanNormal, (f - (nFans - 1) * 0.5) * 0.14), v3(0, holdfastR * 0.25, 0)),
      );

      // Short stout basal gorgonin stalk
      const stalkH = fanH * 0.13;
      const stalkCurve = growCurve(fanOrigin, UP, fanRight, stalkH, 5, (t0, t1) => ({
        pitch: (t1 - t0) * p.currentLeanDeg * DEG2RAD * 0.4,
      }));
      const stalkTopFlex = 0.025 * p.currentSway;
      this.emitClosedTube(
        holdfastMesh,
        stalkCurve,
        (t) => lerp1(fanH * 0.022, fanH * 0.014, t),
        8,
        (t) => mixRgb(colHoldfast, colMainRib, t),
        0,
        stalkTopFlex,
        fanPhase,
        0.55,
        0.15,
      );

      const hubPos = stalkCurve.atT(0.95).pos;

      // Map planar (uAngle in [-1..+1], rFrac in [0..1]) -> cupped/undulating 3D sea-fan surface!
      const evalFanPt = (uSigned: number, rFrac: number): { pos: V3; flex: number; h01: number } => {
        const theta = uSigned * 1.18; // ~ +/- 68 deg sweeping cordate fan arc
        const silhouette = 0.86 + 0.14 * Math.cos(theta * 2.2) - 0.08 * Math.pow(Math.abs(uSigned), 3.0);
        const rDist = (fanH - stalkH) * rFrac * silhouette;
        const xLocal = Math.sin(theta) * (fanW * 0.62) * Math.pow(rFrac, 0.88) * silhouette;
        const yLocal = Math.cos(theta) * rDist * 0.62 + rDist * 0.38;
        // Organic sinusoidal wave ripple across the planar sea fan!
        const zWave =
          (Math.sin(uSigned * 3.8 + f * 1.7) * 0.09 + Math.cos(rFrac * 4.2 - uSigned * 2.1) * 0.05) *
          fanW *
          p.ruffleWave *
          Math.pow(rFrac, 1.25) +
          Math.pow(rFrac, 1.7) * Math.sin(p.currentLeanDeg * DEG2RAD) * fanH * 0.22;
        const pos = add(
          hubPos,
          add(scale(fanRight, xLocal), add(scale(UP, Math.max(0.01, yLocal)), scale(fanNormal, zWave))),
        );
        const h01 = saturate((pos.y - this.groundOrigin.y) / H);
        const flex = stalkTopFlex + Math.pow(rFrac, 1.45) * fanMaxFlex;
        return { pos, flex, h01 };
      };

      // 1. Radiating Primary & Dichotomous Secondary Main Veins!
      const nMainRays = Math.max(13, Math.round((tier >= 3 ? 25 : 15) * p.organDensity));
      const rayGrid: { pos: V3; flex: number; h01: number }[][] = [];
      const rSteps = tier >= 3 ? 22 : 14;

      for (let i = 0; i < nMainRays; i++) {
        const u0 = (i / (nMainRays - 1)) * 2 - 1; // -1 .. +1
        // Odd rays fork dichotomously out of neighboring major veins at `rFrac = 0.32`!
        const isSecondaryVein = i % 2 === 1 && i < nMainRays - 1;
        const rStartIdx = isSecondaryVein ? Math.floor(rSteps * 0.28) : 0;
        const pts: V3[] = [];
        const samples: { pos: V3; flex: number; h01: number }[] = [];
        for (let r = 0; r <= rSteps; r++) {
          const rf = r / rSteps;
          const uMerged =
            isSecondaryVein && r <= rStartIdx
              ? ((i - 1) / (nMainRays - 1)) * 2 - 1
              : lerp1(
                  isSecondaryVein ? ((i - 1) / (nMainRays - 1)) * 2 - 1 : u0,
                  u0,
                  isSecondaryVein ? smoothstep(0.28, 0.44, rf) : 1.0,
                );
          const wiggle = Math.sin(rf * 9.0 + i * 1.9) * 0.012 * rf;
          const smp = evalFanPt(clamp(uMerged + wiggle, -1, 1), rf);
          if (r >= rStartIdx) pts.push(smp.pos);
          samples.push(smp);
        }
        rayGrid.push(samples);

        const isMajorRib = i % 4 === 0 || i === Math.floor(nMainRays / 2);
        const rBase =
          fanH *
          (isMajorRib ? 0.0082 : isSecondaryVein ? 0.0038 : 0.0052) *
          clamp(p.organWidth / 0.12, 0.65, 1.6);
        const curve = this.curveFromPoints(pts);
        const startFlex = isSecondaryVein ? samples[rStartIdx].flex : stalkTopFlex;
        this.emitClosedTube(
          latticeMesh,
          curve,
          (t) => Math.max(0.0014, rBase * Math.pow(1 - t * 0.76, 0.72)),
          isMajorRib ? 6 : 5,
          (t) => mixRgb(colMainRib, mixRgb(colLattice, colRim, smoothstep(0.65, 1.0, t)), t * 0.85),
          startFlex,
          fanMaxFlex - (startFlex - stalkTopFlex),
          fanPhase,
          0.42,
          p.translucency,
        );
        this.stats.stemsOrTubes++;
      }

      // 2. Fine Reticulate Cross-Bars / Anastomosing Meshlets bridging adjacent fan veins!
      for (let r = 2; r <= rSteps; r++) {
        const rf = r / rSteps;
        for (let i = 0; i < nMainRays - 1; i++) {
          if (rf < 0.30 && i % 2 === 0) continue;
          const rNext = clamp(r + ((r + i) % 2 === 0 ? 0 : -1), 1, rSteps);
          const a = rayGrid[i][r];
          const b = rayGrid[i + 1][rNext];
          const span = sub(b.pos, a.pos);
          const spanLen = Math.sqrt(lengthSq(span));
          if (spanLen < 0.004 || spanLen > fanW * 0.24) continue;

          const mid = add(lerpV3(a.pos, b.pos, 0.5), scale(UP, spanLen * 0.08));
          const strutCurve = this.curveFromPoints([a.pos, mid, b.pos]);
          const strutR = Math.max(0.0013, fanH * 0.0024 * (1.15 - 0.5 * rf));
          const colS = mixRgb(colLattice, colRim, smoothstep(0.55, 1.0, rf));
          this.emitClosedTubeInterpolatedFlex(
            latticeMesh,
            strutCurve,
            strutR,
            4,
            colS,
            a.flex,
            b.flex,
            fanPhase,
            0.44,
            p.translucency,
          );
          this.stats.bladesOrTentacles++;

          // Tiny golden 8-rayed octocoral polyps studding the reticulate mesh!
          if (p.vesicleAbundance > 0.08 && (i + r) % (tier >= 3 ? 2 : 3) === 0) {
            for (const sideS of [-1, 1]) {
              const pDir = normalize(add(scale(fanNormal, sideS * 0.85), scale(UP, 0.45)));
              const polypR = clamp(fanH * 0.0038, 0.0022, 0.0055);
              const midFlex = (a.flex + b.flex) * 0.5;
              this.emitClosedOvoid(
                polypsMesh,
                addScaled(mid, fanNormal, sideS * strutR * 0.9),
                pDir,
                polypR * 1.8,
                polypR,
                5,
                4,
                colRim,
                colPolyp,
                0.28,
                0.65,
                [rf, midFlex, fanPhase, 0.0],
              );
              this.stats.vesiclesOrPolyps++;
            }
          }
        }
      }
    }
  }

  // ===========================================================================
  // 8. BUBBLE-TIP SEA ANEMONE (Entacmaea quadricolor)
  // ===========================================================================
  private buildSeaAnemone(
    tier: number,
    columnMesh: PartMesh,
    tentaclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colColumnBase = hexToLinearRgb(p.hueHoldfast);
    const colTentBase = hexToLinearRgb(p.huePrimary);
    const colBubble = hexToLinearRgb(p.hueSecondary);
    const colAcrosphere = hexToLinearRgb(p.hueAccent);
    const colMouth = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.22, p.colonyHeight);
    const colH = H * 0.44;
    const discR = Math.max(0.14, H * 0.42 * p.canopySpread);
    const discFlex = 0.08 * p.currentSway;

    // 1. Verrucose Fleshy Pedal Disc -> Column -> Ruffled Oral Disc -> Recessed Central Mouth!
    const uCols = tier >= 3 ? 40 : 28;
    const vRows = tier >= 3 ? 20 : 14;
    const colGrid: number[][] = [];

    for (let rIdx = 0; rIdx <= vRows; rIdx++) {
      const v = rIdx / vRows; // 0 = pedal foot -> 0.62 = oral disc rim -> 1.0 = recessed central mouth!
      const row: number[] = [];
      const rowFlex = v <= 0.62 ? Math.pow(v / 0.62, 1.45) * discFlex : discFlex;

      for (let c = 0; c < uCols; c++) {
        const th = (c / uCols) * TAU;
        let rad: number;
        let y: number;
        let col: RGB;

        // Organic 5-lobed wavy oral-disc fold!
        const foldWave =
          (Math.sin(th * 5 + 0.4) * 0.11 + Math.cos(th * 9 - 1.1) * 0.05) * p.ruffleWave;

        if (v <= 0.62) {
          const tC = v / 0.62; // 0..1 up fleshy column to flaring oral-disc rim
          const flare = 0.56 - 0.10 * Math.sin(tC * Math.PI) + 0.54 * Math.pow(tC, 2.2);
          const verrucae = 0.025 * Math.pow(0.5 + 0.5 * Math.cos(th * 18 + tC * 28.0), 3.0) * (1 - tC * 0.5);
          rad = discR * (flare * (1 + foldWave * smoothstep(0.45, 1.0, tC)) + verrucae);
          y = colH * tC + discR * foldWave * 0.35 * smoothstep(0.55, 1.0, tC);
          col = mixRgb(colColumnBase, mixRgb(colColumnBase, colTentBase, 0.55), smoothstep(0.15, 0.95, tC));
        } else {
          const tD = (v - 0.62) / 0.38; // 0 at oral rim -> 1 at recessed central actinopharynx mouth
          rad = lerp1(discR * (1 + foldWave), discR * 0.035, Math.pow(tD, 0.88));
          // Slit-like oval mouth pinch near center
          const slitX = 1 + 0.45 * smoothstep(0.65, 1.0, tD) * Math.cos(th * 2);
          rad *= slitX;
          y =
            colH +
            discR * foldWave * 0.35 * (1 - tD) -
            colH * 0.16 * Math.pow(tD, 1.5) +
            0.008 * Math.sin(tD * 22.0) * (1 - tD);
          const discCol = mixRgb(colColumnBase, colTentBase, 0.68);
          col = mixRgb(discCol, colMouth, smoothstep(0.62, 0.96, tD));
        }

        const pt = add(this.groundOrigin, v3(Math.cos(th) * rad, Math.max(0, y), Math.sin(th) * rad));
        row.push(
          columnMesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: -Math.sin(th), ty: 0, tz: Math.cos(th),
            u: c / uCols, v,
            color: col,
            wind: [clamp(v, 0, 1), rowFlex, this.colonyPhase, 0],
            pivot: this.groundOrigin,
            roughness: 0.28,
            translucency: p.translucency * 0.55,
            detailMetric: v > 0.85 ? 0.92 : 0.4,
            anatomyLevel: 1,
          }),
        );
      }
      colGrid.push(row);
    }

    for (let rIdx = 0; rIdx < vRows; rIdx++) {
      for (let c = 0; c < uCols; c++) {
        const c1 = (c + 1) % uCols;
        columnMesh.addQuad(colGrid[rIdx][c], colGrid[rIdx + 1][c], colGrid[rIdx + 1][c1], colGrid[rIdx][c1]);
      }
    }
    this.stats.stemsOrTubes = 1;

    // 2. Concentric Rings of 3D Closed Tubular Bubble-Tip Tentacles!
    const nRings = clamp(Math.round(p.colonyCount), 3, 7);
    const totalTentacles = Math.max(42, Math.round((tier >= 3 ? 118 : 68) * p.organDensity * (nRings / 5)));
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanSin = Math.sin(p.currentLeanDeg * DEG2RAD);

    for (let tIdx = 0; tIdx < totalTentacles; tIdx++) {
      const tRng = this.rng.fork(0x8200 + tIdx * 67);
      const frac = (tIdx + 0.5) / totalTentacles; // 0 = inner oral tentacles -> 1 = outer marginal crown!
      const rDiscFrac = lerp1(0.24, 0.94, Math.sqrt(frac));
      const az = tIdx * GOLDEN_ANGLE + tRng.range(-0.07, 0.07);
      const foldWave = (Math.sin(az * 5 + 0.4) * 0.11 + Math.cos(az * 9 - 1.1) * 0.05) * p.ruffleWave;

      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const attachR = discR * rDiscFrac * (1 + foldWave * rDiscFrac);
      const attachY = colH + discR * foldWave * 0.35 * rDiscFrac - colH * 0.08 * Math.pow(1 - rDiscFrac, 1.5);
      const basePos = add(this.groundOrigin, addScaled(v3(0, attachY, 0), radDir, attachR));

      const tentLen = p.organLength * (0.68 + 0.44 * Math.sin(Math.PI * (0.18 + 0.72 * frac))) * tRng.vary(1.0, 0.12);
      const baseTentR = Math.max(0.008, tentLen * clamp(p.organWidth, 0.08, 0.48) * 0.22);

      // Inner tentacles arch gracefully skyward; outer tentacles splay outward over the reef!
      const elev = lerp1(78, 22, frac) * DEG2RAD + tRng.range(-0.1, 0.1);
      const emergeDir = normalize(
        add(
          scale(radDir, Math.cos(elev)),
          add(scale(UP, Math.sin(elev)), scale(currentDir, leanSin * 0.38)),
        ),
      );

      const uSegs = tier >= 3 ? 13 : 9;
      const sides = tier >= 3 ? 8 : 6;
      const curveBend = tRng.range(-0.35, 0.45);
      const swirlYaw = tRng.range(-0.38, 0.38);
      const tentCurve = growCurve(basePos, emergeDir, anyPerpendicular(emergeDir), tentLen, uSegs, (t0, t1) => {
        const dt = t1 - t0;
        return {
          pitch: (curveBend + 0.24 * frac) * dt,
          yaw: swirlYaw * Math.sin(t1 * Math.PI) * dt,
        };
      });

      // Emit sculpted 3D Bubble-Tip Tentacle with bulbous sub-terminal inflation & glowing acrosphere tip!
      const bubbleInflation = 1.0 + 1.18 * p.ruffleWave * tRng.vary(1.0, 0.14);
      const tentPhase = (this.colonyPhase + ((az / TAU) % 1) * 0.025) % 1;
      const tentExtraFlex = 0.18 * p.currentSway;
      const tentFlut = 0.22 * p.currentSway;

      const rings: number[][] = [];
      for (let i = 0; i < tentCurve.count; i++) {
        const fr = tentCurve.frameAtIndex(i);
        const u = fr.t;
        // Characteristic Entacmaea quadricolor profile: stalk -> bulbous bubble -> nippled acrosphere tip!
        const stalkTaper = 1 - 0.55 * Math.pow(u, 0.85);
        const bubbleBell = Math.exp(-Math.pow((u - 0.74) / 0.145, 2.0));
        const tipDome = u > 0.90 ? Math.sqrt(Math.max(0.02, 1 - Math.pow((u - 0.90) / 0.10, 2.0))) : 1.0;
        const r = Math.max(0.0012, baseTentR * (stalkTaper + (bubbleInflation - 1.0) * bubbleBell * 0.82) * tipDome);

        // Pale ring just below acrosphere + glowing neon/rose tip!
        let col = mixRgb(colTentBase, colBubble, smoothstep(0.25, 0.76, u));
        const paleBand = Math.exp(-Math.pow((u - 0.86) / 0.045, 2.0));
        col = mixRgb(col, hexToLinearRgb('#f5fffb'), paleBand * 0.42);
        col = mixRgb(col, colAcrosphere, smoothstep(0.84, 0.98, u));

        const flexHere = discFlex + Math.pow(u, 1.48) * tentExtraFlex;
        const flutHere = tentFlut * u * u; // 0.000 at oral-disc attachment (`u = 0`)!
        const rowWind: [number, number, number, number] = [u, flexHere, tentPhase, flutHere];

        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          const nLocal = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, nLocal, r);
          const nrm = normalize(add(nLocal, scale(fr.dir, u > 0.85 ? 0.45 : 0.08)));
          row.push(
            tentaclesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nrm.x, ny: nrm.y, nz: nrm.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: u,
              color: col,
              wind: rowWind,
              pivot: this.groundOrigin,
              roughness: 0.16,
              translucency: p.translucency,
              detailMetric: bubbleBell * 0.6 + smoothstep(0.82, 1.0, u) * 0.4,
              anatomyLevel: 3,
            }),
          );
        }
        rings.push(row);
      }

      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          tentaclesMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
        }
      }
      // Smooth rounded cap at acrosphere apex!
      const tipFr = tentCurve.atT(1.0);
      const tipApex = addScaled(tipFr.pos, tipFr.dir, baseTentR * 0.14);
      const tipIdx = tentaclesMesh.addVertex({
        x: tipApex.x, y: tipApex.y, z: tipApex.z,
        nx: tipFr.dir.x, ny: tipFr.dir.y, nz: tipFr.dir.z,
        tx: tipFr.dir.x, ty: tipFr.dir.y, tz: tipFr.dir.z,
        u: 0.5, v: 1.0,
        color: colAcrosphere,
        wind: [1.0, discFlex + tentExtraFlex, tentPhase, tentFlut],
        pivot: this.groundOrigin,
        roughness: 0.14,
        translucency: p.translucency,
        detailMetric: 1.0,
        anatomyLevel: 4,
      });
      const lastR = rings[rings.length - 1];
      for (let j = 0; j < sides; j++) {
        tentaclesMesh.addTri(lastR[j], lastR[(j + 1) % sides], tipIdx);
      }

      this.stats.bladesOrTentacles++;
    }
    tentaclesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 9. CARIBBEAN AZURE TUBE SPONGE (Callyspongia vaginalis) — Hollow Chimneys!
  // ===========================================================================
  private buildAzureTubeSponge(
    tier: number,
    tubesMesh: PartMesh,
    conulesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast);
    const colWall = hexToLinearRgb(p.huePrimary);
    const colAtrium = hexToLinearRgb(p.hueSecondary);
    const colRim = hexToLinearRgb(p.hueAccent);
    const colConule = hexToLinearRgb(p.huePolyp);

    const nTubes = clamp(Math.round(p.colonyCount), 2, 16);
    const H = Math.max(0.35, p.colonyHeight);
    const spongeMaxFlex = 0.065 * p.currentSway;

    for (let tIdx = 0; tIdx < nTubes; tIdx++) {
      const tRng = this.rng.fork(0x9300 + tIdx * 97);
      const frac = tIdx / Math.max(1, nTubes - 1);
      const az = tIdx * GOLDEN_ANGLE + tRng.range(-0.18, 0.18);
      const clusterR = H * 0.16 * p.canopySpread * Math.sqrt((tIdx + 0.15) / nTubes);

      const tubeH = H * (tIdx === 0 ? 1.0 : lerp1(0.92, 0.44, frac) * tRng.vary(1.0, 0.14));
      const outerR = Math.max(0.038, tubeH * clamp(p.organWidth, 0.10, 0.55) * 0.34 * tRng.vary(1.0, 0.1));
      const wallThick = outerR * 0.28;

      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const origin = add(this.groundOrigin, addScaled(v3(0, -0.015, 0), radDir, clusterR));
      const splayAng = (0.08 + 0.34 * Math.sqrt(frac) * p.canopySpread) + tRng.range(-0.04, 0.04);
      const startDir = normalize(add(scale(UP, Math.cos(splayAng)), scale(radDir, Math.sin(splayAng))));

      // Curve starts outward then phototropically curves upward like real organ-pipe Callyspongia!
      const spineSegs = tier >= 3 ? 18 : 12;
      const spine = growCurve(origin, startDir, anyPerpendicular(startDir), tubeH, spineSegs, (t0, t1) => {
        const dt = t1 - t0;
        return { pitch: -splayAng * 0.55 * dt + p.currentLeanDeg * DEG2RAD * 0.35 * dt };
      });

      const sides = tier >= 3 ? 22 : 14;
      const tubePhase = (this.colonyPhase + tIdx * 0.005) % 1;
      const tubeTopFlex = spongeMaxFlex * (tubeH / H);

      // Build a TRUE closed double-walled hollow chimney:
      //   Stations `0 .. spineSegs`     = Outer sculpted wall rising from base to rim
      //   Stations `spineSegs+1 .. +3`  = Rounded translucent oscular collar lip rolling 180 deg inward
      //   Stations `.. end`             = Smooth dark-turquoise inner spongocoel cavity descending to atrial floor!
      const rings: number[][] = [];

      // Basal closed center vertex at bottom of outer wall (`s = 0`)
      const baseFr = spine.frameAtIndex(0);
      const baseCapIdx = tubesMesh.addVertex({
        x: baseFr.pos.x, y: baseFr.pos.y, z: baseFr.pos.z,
        tx: baseFr.right.x, ty: baseFr.right.y, tz: baseFr.right.z,
        u: 0.5, v: 0,
        color: colBase,
        wind: [0, 0, tubePhase, 0],
        pivot: this.groundOrigin,
        roughness: 0.88,
        translucency: 0.05,
        detailMetric: 0.2,
        anatomyLevel: 0,
      });

      // A. Outer Wall Rings (`0 .. spineSegs`)
      for (let i = 0; i < spine.count; i++) {
        const fr = spine.frameAtIndex(i);
        const z = fr.t; // 0 .. 1
        // Gentle mid-belly swell + slight pre-oscular waist + crisp rim
        const profile = 0.84 + 0.24 * Math.sin(Math.PI * Math.pow(z, 0.72)) - 0.06 * smoothstep(0.82, 1.0, z);
        const rBase = outerR * profile;
        const flex = Math.pow(z, 1.5) * tubeTopFlex;
        const row: number[] = [];

        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          // Longitudinal ribs + conulose sponge bumps!
          const rib =
            (0.065 * Math.sin(th * 7 + z * 5.0 + tIdx) +
              0.045 * fbm3(Math.cos(th) * 2.2, z * 6.5, Math.sin(th) * 2.2, 401 + tIdx * 17, 2)) *
            p.ruffleWave *
            (1 - 0.65 * smoothstep(0.86, 1.0, z));
          const rHere = rBase * (1 + rib);
          const radVec = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, radVec, rHere);

          let col = mixRgb(colBase, colWall, smoothstep(0.0, 0.26, z));
          col = mixRgb(col, colAtrium, Math.max(0, rib * 4.5) * 0.38);
          col = mixRgb(col, colRim, smoothstep(0.82, 1.0, z) * 0.78);

          row.push(
            tubesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: z * 0.5,
              color: col,
              wind: [z, flex, tubePhase, 0],
              pivot: this.groundOrigin,
              roughness: 0.78 - smoothstep(0.85, 1.0, z) * 0.25,
              translucency: z > 0.85 ? Math.max(0.45, p.translucency) : p.translucency * 0.45,
              detailMetric: smoothstep(0.75, 1.0, z),
              anatomyLevel: 2,
            }),
          );

          // Thorny pointed spicule conules projecting radially from outer sponge wall!
          if (
            p.vesicleAbundance > 0.08 &&
            i >= 2 &&
            i <= spine.count - 3 &&
            (i + j * 2) % (tier >= 3 ? 5 : 8) === 0
          ) {
            const conuleLen = outerR * (0.14 + 0.12 * p.ruffleWave) * tRng.vary(1.0, 0.18);
            const conuleDir = normalize(add(scale(radVec, 0.88), scale(fr.dir, 0.46)));
            const conuleTipCol = mixRgb(colWall, mixRgb(colRim, colConule, 0.35), 0.52);
            this.emitClosedOvoid(
              conulesMesh,
              addScaled(pt, radVec, -conuleLen * 0.22),
              conuleDir,
              conuleLen,
              conuleLen * 0.38,
              5,
              4,
              colWall,
              conuleTipCol,
              0.72,
              p.translucency * 0.65,
              [z, flex, tubePhase, 0.0],
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
        rings.push(row);
      }

      // B. Rounded Thin Translucent Oscular Collar Lip (`lipSteps = 3`) rolling 180 deg into inner cavity!
      const rimFr = spine.atT(1.0);
      const rOuterRim = outerR * 0.78;
      const rInnerRim = outerR * 0.78 - wallThick * 0.72;
      const rLipMid = (rOuterRim + rInnerRim) * 0.5;
      const rLipHalf = (rOuterRim - rInnerRim) * 0.5;
      for (let lp = 1; lp <= 3; lp++) {
        const ang = (lp / 3) * Math.PI; // 60, 120, 180 deg over the oscular rim
        const rLip = rLipMid + Math.cos(ang) * rLipHalf;
        const yLip = Math.sin(ang) * rLipHalf * 1.15;
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          // Delicate wavy oscular rim crown!
          const rimWave = Math.sin(th * 6 + tIdx) * outerR * 0.038 * p.ruffleWave;
          const radVec = add(scale(rimFr.right, Math.cos(th)), scale(rimFr.up, Math.sin(th)));
          const pt = add(addScaled(rimFr.pos, radVec, rLip), scale(rimFr.dir, yLip + rimWave));
          const lipDark = lp === 3 ? 0.62 : 1.0;
          const rawLipCol = mixRgb(colRim, colWall, (lp - 1) * 0.38);
          const col: RGB = { r: rawLipCol.r * lipDark, g: rawLipCol.g * lipDark, b: rawLipCol.b * lipDark };
          row.push(
            tubesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              tx: rimFr.dir.x, ty: rimFr.dir.y, tz: rimFr.dir.z,
              u: j / sides, v: 0.5 + lp * 0.04,
              color: col,
              wind: [1.0, tubeTopFlex, tubePhase, 0],
              pivot: this.groundOrigin,
              roughness: 0.42,
              translucency: Math.max(0.55, p.translucency),
              detailMetric: 0.95,
              anatomyLevel: 3,
            }),
          );
        }
        rings.push(row);
      }

      // C. Inner Hollow Spongocoel Cavity descending cleanly to the atrial floor (`z = 0.88 -> 0.14`)!
      const innerSteps = Math.max(5, Math.floor(spineSegs * 0.55));
      for (let k = 1; k <= innerSteps; k++) {
        const kFrac = k / innerSteps;
        const z = lerp1(0.92, 0.14, kFrac);
        const fr = spine.atT(z);
        const rInner = Math.max(0.012, (outerR * 0.78 - wallThick * 0.72) * (1 - 0.35 * kFrac));
        const flex = Math.pow(z, 1.5) * tubeTopFlex;
        // Deep hollow spongocoel cavity ambient-occlusion darkening!
        const cavityShade = lerp1(0.42, 0.08, Math.pow(kFrac, 0.65));
        const innerBase = mixRgb(colBase, colAtrium, 0.32 * (1 - kFrac));
        const col: RGB = {
          r: innerBase.r * cavityShade,
          g: innerBase.g * cavityShade,
          b: innerBase.b * cavityShade,
        };
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          const radVec = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, radVec, rInner);
          row.push(
            tubesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              tx: -fr.dir.x, ty: -fr.dir.y, tz: -fr.dir.z,
              u: j / sides, v: 0.65 + 0.35 * kFrac,
              color: col,
              wind: [z, flex, tubePhase, 0],
              pivot: this.groundOrigin,
              roughness: 0.84,
              translucency: 0.12,
              detailMetric: 0.25,
              anatomyLevel: 2,
            }),
          );
        }
        rings.push(row);
      }

      // Stitch basal cap -> all outer/lip/inner rings -> inner atrial floor cap!
      const firstRing = rings[0];
      for (let j = 0; j < sides; j++) {
        tubesMesh.addTri(baseCapIdx, firstRing[(j + 1) % sides], firstRing[j]);
      }
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          tubesMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
        }
      }
      const floorFr = spine.atT(0.12);
      const floorIdx = tubesMesh.addVertex({
        x: floorFr.pos.x, y: floorFr.pos.y, z: floorFr.pos.z,
        tx: floorFr.right.x, ty: floorFr.right.y, tz: floorFr.right.z,
        u: 0.5, v: 1.0,
        color: { r: colBase.r * 0.2, g: colBase.g * 0.2, b: colBase.b * 0.2 },
        wind: [0.12, Math.pow(0.12, 1.5) * tubeTopFlex, tubePhase, 0],
        pivot: this.groundOrigin,
        roughness: 0.9,
        translucency: 0.04,
        detailMetric: 0.15,
        anatomyLevel: 1,
      });
      const lastInner = rings[rings.length - 1];
      for (let j = 0; j < sides; j++) {
        tubesMesh.addTri(lastInner[j], lastInner[(j + 1) % sides], floorIdx);
      }

      this.stats.stemsOrTubes++;
    }
  }

  // ===========================================================================
  // 10. REEF CRINOID FEATHER STAR (Comanthina schlegeli)
  // ===========================================================================
  private buildFeatherStarCrinoid(
    tier: number,
    calyxMesh: PartMesh,
    armsMesh: PartMesh,
    pinnulesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colCirri = hexToLinearRgb(p.hueHoldfast);
    const colArm = hexToLinearRgb(p.huePrimary);
    const colArmHi = hexToLinearRgb(p.hueSecondary);
    const colPinnuleTip = hexToLinearRgb(p.hueAccent);
    const colBand = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.32, p.colonyHeight);
    const perchH = H * 0.16;
    const calyxCenter = add(this.groundOrigin, v3(0, perchH, 0));
    const calyxR = Math.max(0.032, H * 0.055);
    const calyxFlex = 0.035 * p.currentSway;

    // 1. Pentagonal Centrodorsal Calyx Disc
    this.emitClosedOvoid(
      calyxMesh,
      add(calyxCenter, v3(0, -calyxR * 0.45, 0)),
      UP,
      calyxR * 0.95,
      calyxR,
      10,
      6,
      colCirri,
      colArm,
      0.38,
      0.22,
      [0.15, calyxFlex, this.colonyPhase, 0.0],
    );

    // 2. Downward-Grasping Segmented Cirri with Hooked Claws gripping reef stone!
    const nCirri = tier >= 3 ? 22 : 14;
    for (let c = 0; c < nCirri; c++) {
      const cRng = this.rng.fork(0xa100 + c * 59);
      const az = c * GOLDEN_ANGLE;
      const rad = v3(Math.cos(az), 0, Math.sin(az));
      const cOrigin = add(calyxCenter, addScaled(v3(0, -calyxR * 0.22, 0), rad, calyxR * 0.78));
      const cDir = normalize(add(scale(rad, 0.78), v3(0, -0.62, 0)));
      const cLen = perchH * cRng.vary(1.28, 0.14);
      const cirrus = growCurve(cOrigin, cDir, anyPerpendicular(cDir), cLen, 7, (t0, t1) => ({
        pitch: -(t1 - t0) * (0.95 + 0.85 * t1), // Inward claw curl gripping the coral perch!
      }));
      this.emitClosedTubeInterpolatedFlex(
        calyxMesh,
        cirrus,
        calyxR * 0.14,
        5,
        mixRgb(colCirri, colBand, 0.22),
        calyxFlex,
        0.0,
        this.colonyPhase,
        0.48,
        0.18,
      );
    }

    // 3. Radiating Overarching Segmented Brachial Arms + Alternating Feathery Pinnules!
    const nArms = clamp(Math.round(p.colonyCount), 8, 36);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanSin = Math.sin(p.currentLeanDeg * DEG2RAD);

    for (let a = 0; a < nArms; a++) {
      const aRng = this.rng.fork(0xa400 + a * 89);
      const isInner = a % 2 === 0;
      const az = (a / nArms) * TAU + (isInner ? 0 : TAU / (nArms * 2)) + aRng.range(-0.06, 0.06);
      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const armOrigin = add(calyxCenter, addScaled(v3(0, calyxR * 0.24, 0), radDir, calyxR * 0.82));

      const armLen = p.organLength * (isInner ? 0.92 : 1.06) * aRng.vary(1.0, 0.1);
      const elev = (isInner ? 68 : 42) * DEG2RAD;
      const startDir = normalize(
        add(
          scale(radDir, Math.cos(elev) * p.canopySpread),
          add(scale(UP, Math.sin(elev)), scale(currentDir, leanSin * 0.28)),
        ),
      );

      const armSegs = tier >= 3 ? 22 : 14;
      const tipCurl = (0.75 + 0.85 * p.ruffleWave) * (a % 3 === 0 ? -0.65 : 1.0); // Graceful distal spiral tip curl!
      const armCurve = growCurve(armOrigin, startDir, anyPerpendicular(startDir), armLen, armSegs, (t0, t1) => {
        const dt = t1 - t0;
        const arch = (isInner ? 0.85 : 1.05) * dt;
        const coil = tipCurl * Math.pow(smoothstep(0.62, 1.0, t1), 1.5) * 2.2 * dt;
        return { pitch: arch - coil, yaw: Math.sin(t1 * Math.PI * 1.5 + a) * 0.18 * dt };
      });

      const armBaseR = Math.max(0.0045, calyxR * 0.19 * clamp(p.organWidth / 0.16, 0.65, 1.5));
      const armPhase = (this.colonyPhase + ((az / TAU) % 1) * 0.03) % 1;
      const armExtraFlex = 0.24 * p.currentSway;

      this.emitClosedTube(
        armsMesh,
        armCurve,
        (t) => Math.max(0.0012, armBaseR * Math.pow(1 - t * 0.86, 0.78) * (1 + 0.12 * Math.sin(t * 64.0))),
        tier >= 3 ? 6 : 5,
        (t) => {
          const band = Math.pow(0.5 + 0.5 * Math.cos(t * 28.0), 4.0);
          return mixRgb(mixRgb(colArm, colArmHi, t * 0.75), colBand, band * 0.42);
        },
        calyxFlex,
        armExtraFlex,
        armPhase,
        0.34,
        p.translucency * 0.55,
      );
      this.stats.stemsOrTubes++;

      // Dense V-angled Feathery Pinnules along both sides of every crinoid arm!
      const nPairs = Math.max(14, Math.round((tier >= 3 ? 36 : 22) * p.organDensity));
      const outUp0 = normalize(add(UP, scale(radDir, -0.35)));
      for (let k = 0; k < nPairs; k++) {
        const uFrac = k / Math.max(1, nPairs - 1);
        const tArm = lerp1(0.07, 0.985, uFrac);
        const fr = armCurve.atT(tArm);
        const armFlexHere = calyxFlex + Math.pow(tArm, 1.45) * armExtraFlex;

        let localUp = projectOnPlane(outUp0, fr.dir);
        localUp = lengthSq(localUp) > 1e-8 ? normalize(localUp) : fr.up;
        const localLat = normalize(cross(fr.dir, localUp));

        const env = Math.sin(Math.PI * Math.pow(clamp(uFrac * 0.9 + 0.07, 0.04, 0.99), 0.68));
        const pinLen = armLen * (0.045 + 0.105 * env) * clamp(p.organWidth / 0.16, 0.6, 1.6);
        const pinW = Math.max(0.0018, pinLen * 0.085);

        for (const side of [-1, 1]) {
          const pDir = normalize(
            add(scale(localLat, side * 0.76), add(scale(localUp, 0.42), scale(fr.dir, 0.48))),
          );
          this.emitFeatheryPinnule(
            pinnulesMesh,
            addScaled(fr.pos, localLat, side * armBaseR * 0.55 * (1 - tArm * 0.7)),
            pDir,
            localUp,
            pinLen,
            pinW,
            mixRgb(colArm, colArmHi, uFrac * 0.6),
            colPinnuleTip,
            armFlexHere,
            0.045 * p.currentSway,
            0.20 * p.currentSway,
            armPhase,
          );
          this.stats.bladesOrTentacles++;
        }
      }
    }
    pinnulesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // Reusable Sculptural Underwater Organ Primitives
  // ===========================================================================

  private curveFromPoints(pts: V3[]): CurveLine {
    const c = new CurveLine();
    let right = v3(1, 0, 0);
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(pts.length - 1, i + 1)];
      const dRaw = sub(p1, p0);
      const dir = lengthSq(dRaw) > 1e-12 ? normalize(dRaw) : UP;
      let rProj = projectOnPlane(right, dir);
      rProj = lengthSq(rProj) > 1e-9 ? normalize(rProj) : anyPerpendicular(dir);
      right = rProj;
      c.push(pts[i], dir, right);
    }
    return c;
  }

  private emitHapteraHoldfast(
    mesh: PartMesh,
    center: V3,
    radius: number,
    nHaptera: number,
    colBase: RGB,
    tier: number,
  ): void {
    const colDark = mixRgb(colBase, hexToLinearRgb('#14100c'), 0.48);
    // Central conical root crown cushion
    this.emitClosedOvoid(
      mesh,
      add(center, v3(0, -radius * 0.12, 0)),
      UP,
      radius * 0.55,
      radius * 0.52,
      tier >= 3 ? 10 : 8,
      5,
      colDark,
      colBase,
      0.76,
      0.08,
      [0, 0, this.colonyPhase, 0],
    );

    // Interwoven gnarly haptera rootlets gripping substrate surface!
    for (let i = 0; i < nHaptera; i++) {
      const hRng = this.rng.fork(0xb100 + i * 43);
      const az = i * GOLDEN_ANGLE + hRng.range(-0.18, 0.18);
      const tierFrac = (i + 0.5) / nHaptera;
      const rReach = radius * lerp1(0.55, 1.22, Math.sqrt(tierFrac));
      const u = clamp(0.5 + Math.cos(az) * rReach * 0.25, 0.08, 0.92);
      const v = clamp(0.5 + Math.sin(az) * rReach * 0.25, 0.08, 0.92);
      const groundPt = this.substrate.sampleSurface(u, v).pos;

      const startPt = add(
        center,
        v3(Math.cos(az) * radius * 0.18, radius * lerp1(0.42, 0.16, tierFrac), Math.sin(az) * radius * 0.18),
      );
      const endPt = v3(
        center.x + Math.cos(az) * rReach,
        Math.min(startPt.y - 0.01, groundPt.y + 0.004),
        center.z + Math.sin(az) * rReach,
      );
      const midPt = add(
        lerpV3(startPt, endPt, 0.48),
        v3(hRng.range(-0.015, 0.015), radius * 0.16, hRng.range(-0.015, 0.015)),
      );
      const hapCurve = this.curveFromPoints([startPt, midPt, endPt]);
      const r0 = Math.max(0.005, radius * 0.095);
      this.emitClosedTube(
        mesh,
        hapCurve,
        (t) => Math.max(0.002, r0 * Math.pow(1 - t * 0.72, 0.75)),
        5,
        (t) => mixRgb(colBase, colDark, t * 0.65),
        0,
        0,
        this.colonyPhase,
        0.78,
        0.06,
      );
    }
  }

  private emitCorrugatedKelpBlade(
    mesh: PartMesh,
    origin: V3,
    dir0: V3,
    length: number,
    halfWidth: number,
    uSegs: number,
    vColsEven: number,
    ruffle: number,
    dentateMargin: boolean,
    colBase: RGB,
    colTip: RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
    waveSeed: number,
    silkUndulation = 0.55,
  ): void {
    const vCols = Math.max(4, vColsEven % 2 === 0 ? vColsEven : vColsEven + 1);
    let right = projectOnPlane(v3(-dir0.z, 0, dir0.x), dir0);
    if (lengthSq(right) < 1e-6) right = anyPerpendicular(dir0);
    right = normalize(right);

    const spine = growCurve(origin, dir0, right, length, uSegs, (t0, t1) => {
      const dt = t1 - t0;
      const swayWave = Math.sin(t1 * TAU * 1.45 + waveSeed) * silkUndulation * dt;
      const gentleDroop = (0.38 - 0.22 * t1) * silkUndulation * dt;
      return {
        pitch: gentleDroop + swayWave,
        yaw: Math.cos(t1 * Math.PI * 1.85 + waveSeed) * silkUndulation * 0.55 * dt,
      };
    });

    const posGrid: V3[][] = [];
    const windGrid: [number, number, number, number][][] = [];
    const colGrid: RGB[][] = [];

    for (let i = 0; i < spine.count; i++) {
      const fr = spine.frameAtIndex(i);
      const u = fr.t; // 0 .. 1
      // Lanceolate kelp profile tapering cleanly from petiole neck (`u = 0`) to streaming tip (`u = 1`)
      const env = Math.sin(Math.PI * Math.pow(clamp(u * 0.88 + 0.04, 0.02, 0.99), 0.62)) * (1 - 0.55 * Math.pow(u, 3.2));
      const serration = dentateMargin ? 1 + 0.085 * Math.sin(u * 38.0 + waveSeed) * smoothstep(0.08, 0.9, u) : 1.0;
      const hw = Math.max(0.0018, halfWidth * Math.max(0.06, env) * serration);

      // C0-continuous flex & zero flutter at `u = 0`!
      const flexHere = attachFlex + Math.pow(u, 1.45) * extraFlex;
      const flutHere = maxFlutter * u * u;
      const rowWind: [number, number, number, number] = [u, flexHere, phase, flutHere];

      const pRow: V3[] = [];
      const wRow: [number, number, number, number][] = [];
      const cRow: RGB[] = [];

      for (let c = 0; c <= vCols; c++) {
        const vSigned = (c / vCols) * 2 - 1; // -1 .. +1
        // Central bullate kelp corrugations + ruffled undulating edges!
        const bullation =
          Math.sin(u * 28.0 + waveSeed) * Math.cos(vSigned * Math.PI * 1.1) * (1 - Math.abs(vSigned)) * hw * 0.16 * ruffle;
        const edgeRuffle =
          Math.sin(u * 17.0 - waveSeed * 0.8 + (vSigned > 0 ? 0 : 1.7)) *
          vSigned *
          vSigned *
          hw *
          0.34 *
          ruffle *
          smoothstep(0.0, 0.18, u);
        const hOff = (bullation + edgeRuffle) * smoothstep(0.0, 0.12, u);

        const pt = add(fr.pos, add(scale(fr.right, vSigned * hw), scale(fr.up, hOff)));
        const midribGlow = Math.exp(-vSigned * vSigned * 8.0) * 0.22;
        const col = mixRgb(colBase, colTip, clamp(u * 0.82 + midribGlow, 0, 1));

        pRow.push(pt);
        wRow.push(rowWind);
        cRow.push(col);
      }
      posGrid.push(pRow);
      windGrid.push(wRow);
      colGrid.push(cRow);
    }

    const idxGrid: number[][] = [];
    for (let i = 0; i < spine.count; i++) {
      const fr = spine.frameAtIndex(i);
      const u = fr.t;
      const rowIds: number[] = [];
      for (let c = 0; c <= vCols; c++) {
        const pU0 = posGrid[Math.max(0, i - 1)][c];
        const pU1 = posGrid[Math.min(spine.count - 1, i + 1)][c];
        const pV0 = posGrid[i][Math.max(0, c - 1)];
        const pV1 = posGrid[i][Math.min(vCols, c + 1)];
        let nrm = cross(sub(pV1, pV0), sub(pU1, pU0));
        nrm = lengthSq(nrm) > 1e-12 ? normalize(nrm) : fr.up;
        const pt = posGrid[i][c];
        rowIds.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: nrm.x, ny: nrm.y, nz: nrm.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
            u: c / vCols, v: u,
            color: colGrid[i][c],
            wind: windGrid[i][c],
            pivot: this.groundOrigin,
            roughness: 0.22,
            translucency: this.p.translucency,
            detailMetric: c === vCols / 2 ? 0.92 : 0.42,
            anatomyLevel: 3,
          }),
        );
      }
      idxGrid.push(rowIds);
    }

    for (let i = 0; i < spine.count - 1; i++) {
      for (let c = 0; c < vCols; c++) {
        mesh.addQuad(idxGrid[i][c], idxGrid[i][c + 1], idxGrid[i + 1][c + 1], idxGrid[i + 1][c]);
      }
    }
  }

  private emitSeagrassStrap(
    mesh: PartMesh,
    origin: V3,
    emergeDir: V3,
    fanRight: V3,
    currentDir: V3,
    length: number,
    halfWidth: number,
    uSegs: number,
    archRad: number,
    wave: number,
    colBase: RGB,
    colTip: RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
  ): { pos: V3; nrm: V3; wind: [number, number, number, number] }[] {
    const outSamples: { pos: V3; nrm: V3; wind: [number, number, number, number] }[] = [];
    const grid: number[][] = [];
    let pos = clone(origin);
    let dir = clone(emergeDir);
    const ds = length / uSegs;

    for (let i = 0; i <= uSegs; i++) {
      const u = i / uSegs;
      if (i > 0) {
        // Graceful underwater buoyant ribbon arch into prevailing ocean current!
        const bendToStream = archRad * (1.2 / uSegs) * smoothstep(0.15, 0.9, u);
        const undul = Math.sin(u * Math.PI * 2.4) * wave * 0.14 * (1 / uSegs);
        dir = normalize(add(dir, add(scale(currentDir, bendToStream), v3(0, -bendToStream * 0.48 + undul, 0))));
        pos = addScaled(pos, dir, ds);
      }

      let locRight = projectOnPlane(fanRight, dir);
      locRight = lengthSq(locRight) > 1e-8 ? normalize(locRight) : anyPerpendicular(dir);
      const locUp = normalize(cross(dir, locRight));

      // Posidonia oceanica authentic parallel-sided strap with ROUNDED obtuse apex (`u > 0.90`)!
      const tipRound = u > 0.90 ? Math.sqrt(Math.max(0.06, 1 - Math.pow((u - 0.90) / 0.10, 2.0))) : 1.0;
      const hw = halfWidth * (0.86 + 0.14 * smoothstep(0, 0.2, u)) * tipRound;

      const flexHere = attachFlex + Math.pow(u, 1.48) * extraFlex;
      const flutHere = maxFlutter * u * u;
      const wRow: [number, number, number, number] = [u, flexHere, phase, flutHere];
      outSamples.push({ pos: clone(pos), nrm: locUp, wind: wRow });

      const baseCol = mixRgb(colBase, colTip, smoothstep(0.08, 0.94, u));
      const row: number[] = [];
      for (const cSide of [-1, 0, 1]) {
        const pt = add(pos, add(scale(locRight, cSide * hw), scale(locUp, (1 - Math.abs(cSide)) * hw * 0.14)));
        const nrm = normalize(add(locUp, scale(locRight, cSide * 0.18)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: nrm.x, ny: nrm.y, nz: nrm.z,
            tx: dir.x, ty: dir.y, tz: dir.z,
            u: cSide * 0.5 + 0.5, v: u,
            color: cSide === 0 ? mixRgb(baseCol, colTip, 0.18) : baseCol,
            wind: wRow,
            pivot: this.groundOrigin,
            roughness: 0.28,
            translucency: this.p.translucency,
            detailMetric: cSide === 0 ? 0.9 : 0.4,
            anatomyLevel: 3,
          }),
        );
      }
      grid.push(row);
    }

    for (let i = 0; i < uSegs; i++) {
      mesh.addQuad(grid[i][0], grid[i][1], grid[i + 1][1], grid[i + 1][0]);
      mesh.addQuad(grid[i][1], grid[i][2], grid[i + 1][2], grid[i + 1][1]);
    }
    return outSamples;
  }

  private emitFeatheryPinnule(
    mesh: PartMesh,
    origin: V3,
    dir0: V3,
    upHint: V3,
    len: number,
    halfW: number,
    colBase: RGB,
    colTip: RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
  ): void {
    let right = cross(dir0, upHint);
    right = lengthSq(right) > 1e-8 ? normalize(right) : anyPerpendicular(dir0);
    const up = normalize(cross(right, dir0));

    const midPos = add(addScaled(origin, dir0, len * 0.55), scale(up, len * 0.08));
    const tipPos = add(addScaled(origin, dir0, len), scale(up, -len * 0.06));

    const w0: [number, number, number, number] = [0.5, attachFlex, phase, 0];
    const wMid: [number, number, number, number] = [0.7, attachFlex + 0.35 * extraFlex, phase, 0.3 * maxFlutter];
    const wTip: [number, number, number, number] = [1.0, attachFlex + extraFlex, phase, maxFlutter];

    const v0L = mesh.addVertex({
      x: origin.x - right.x * halfW, y: origin.y - right.y * halfW, z: origin.z - right.z * halfW,
      nx: up.x, ny: up.y, nz: up.z, tx: dir0.x, ty: dir0.y, tz: dir0.z,
      u: 0, v: 0, color: colBase, wind: w0, pivot: this.groundOrigin,
      roughness: 0.32, translucency: this.p.translucency, detailMetric: 0.4, anatomyLevel: 4,
    });
    const v0R = mesh.addVertex({
      x: origin.x + right.x * halfW, y: origin.y + right.y * halfW, z: origin.z + right.z * halfW,
      nx: up.x, ny: up.y, nz: up.z, tx: dir0.x, ty: dir0.y, tz: dir0.z,
      u: 1, v: 0, color: colBase, wind: w0, pivot: this.groundOrigin,
      roughness: 0.32, translucency: this.p.translucency, detailMetric: 0.4, anatomyLevel: 4,
    });
    const colM = mixRgb(colBase, colTip, 0.55);
    const v1L = mesh.addVertex({
      x: midPos.x - right.x * halfW * 0.65, y: midPos.y - right.y * halfW * 0.65, z: midPos.z - right.z * halfW * 0.65,
      nx: up.x, ny: up.y, nz: up.z, tx: dir0.x, ty: dir0.y, tz: dir0.z,
      u: 0, v: 0.55, color: colM, wind: wMid, pivot: this.groundOrigin,
      roughness: 0.30, translucency: this.p.translucency, detailMetric: 0.65, anatomyLevel: 4,
    });
    const v1R = mesh.addVertex({
      x: midPos.x + right.x * halfW * 0.65, y: midPos.y + right.y * halfW * 0.65, z: midPos.z + right.z * halfW * 0.65,
      nx: up.x, ny: up.y, nz: up.z, tx: dir0.x, ty: dir0.y, tz: dir0.z,
      u: 1, v: 0.55, color: colM, wind: wMid, pivot: this.groundOrigin,
      roughness: 0.30, translucency: this.p.translucency, detailMetric: 0.65, anatomyLevel: 4,
    });
    const vTip = mesh.addVertex({
      x: tipPos.x, y: tipPos.y, z: tipPos.z,
      nx: up.x, ny: up.y, nz: up.z, tx: dir0.x, ty: dir0.y, tz: dir0.z,
      u: 0.5, v: 1.0, color: colTip, wind: wTip, pivot: this.groundOrigin,
      roughness: 0.28, translucency: this.p.translucency, detailMetric: 0.95, anatomyLevel: 4,
    });

    mesh.addQuad(v0L, v0R, v1R, v1L);
    mesh.addTri(v1L, v1R, vTip);
  }

  private emitClosedTube(
    mesh: PartMesh,
    curve: CurveLine,
    radiusAt: (t: number) => number,
    sides: number,
    colorAt: (t: number) => RGB,
    baseFlex: number,
    extraFlex: number,
    phase: number,
    roughness: number,
    translucency: number,
  ): void {
    const rings: number[][] = [];
    for (let i = 0; i < curve.count; i++) {
      const fr = curve.frameAtIndex(i);
      const t = fr.t;
      const r = Math.max(0.0008, radiusAt(t));
      const col = colorAt(t);
      const flex = baseFlex + Math.pow(t, 1.45) * extraFlex;
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
            wind: [t, flex, phase, 0],
            pivot: this.groundOrigin,
            roughness,
            translucency,
            detailMetric: 0.5,
            anatomyLevel: 2,
          }),
        );
      }
      rings.push(row);
    }

    const f0 = curve.frameAtIndex(0);
    const cap0 = mesh.addVertex({
      x: f0.pos.x, y: f0.pos.y, z: f0.pos.z,
      tx: f0.dir.x, ty: f0.dir.y, tz: f0.dir.z,
      u: 0.5, v: 0, color: colorAt(0), wind: [0, baseFlex, phase, 0], pivot: this.groundOrigin,
      roughness, translucency, detailMetric: 0.4, anatomyLevel: 2,
    });
    for (let j = 0; j < sides; j++) {
      mesh.addTri(cap0, rings[0][(j + 1) % sides], rings[0][j]);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
    const f1 = curve.atT(1.0);
    const cap1 = mesh.addVertex({
      x: f1.pos.x, y: f1.pos.y, z: f1.pos.z,
      tx: f1.dir.x, ty: f1.dir.y, tz: f1.dir.z,
      u: 0.5, v: 1, color: colorAt(1), wind: [1, baseFlex + extraFlex, phase, 0], pivot: this.groundOrigin,
      roughness, translucency, detailMetric: 0.8, anatomyLevel: 2,
    });
    const last = rings[rings.length - 1];
    for (let j = 0; j < sides; j++) {
      mesh.addTri(last[j], last[(j + 1) % sides], cap1);
    }
  }

  private emitClosedTubeInterpolatedFlex(
    mesh: PartMesh,
    curve: CurveLine,
    radius: number,
    sides: number,
    col: RGB,
    flexA: number,
    flexB: number,
    phase: number,
    roughness: number,
    translucency: number,
  ): void {
    const rings: number[][] = [];
    for (let i = 0; i < curve.count; i++) {
      const fr = curve.frameAtIndex(i);
      const t = fr.t;
      const flex = lerp1(flexA, flexB, t);
      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const pt = add(fr.pos, add(scale(fr.right, Math.cos(th) * radius), scale(fr.up, Math.sin(th) * radius)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
            u: j / sides, v: t,
            color: col,
            wind: [t, flex, phase, 0],
            pivot: this.groundOrigin,
            roughness,
            translucency,
            detailMetric: 0.65,
            anatomyLevel: 3,
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

  private emitClosedOvoid(
    mesh: PartMesh,
    basePos: V3,
    axisDir: V3,
    len: number,
    maxRad: number,
    uSegs: number,
    vRings: number,
    colBase: RGB,
    colApex: RGB,
    roughness: number,
    translucency: number,
    rigidWind: [number, number, number, number],
  ): void {
    const ax = normalize(axisDir);
    const right = anyPerpendicular(ax);
    const up = normalize(cross(ax, right));

    const vStart = mesh.addVertex({
      x: basePos.x, y: basePos.y, z: basePos.z,
      tx: ax.x, ty: ax.y, tz: ax.z,
      u: 0.5, v: 0,
      color: colBase,
      wind: rigidWind,
      pivot: this.groundOrigin,
      roughness,
      translucency,
      detailMetric: 0.5,
      anatomyLevel: 3,
    });

    const rings: number[][] = [];
    for (let r = 1; r < vRings; r++) {
      const t = r / vRings;
      // Pyriform bladder profile slightly fuller toward distal half
      const sinP = Math.sin(t * Math.PI) * (0.88 + 0.22 * t);
      const rad = maxRad * sinP;
      const center = addScaled(basePos, ax, len * t);
      const col = mixRgb(colBase, colApex, smoothstep(0.15, 0.9, t));
      const row: number[] = [];
      for (let j = 0; j < uSegs; j++) {
        const th = (j / uSegs) * TAU;
        const pt = add(center, add(scale(right, Math.cos(th) * rad), scale(up, Math.sin(th) * rad)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: ax.x, ty: ax.y, tz: ax.z,
            u: j / uSegs, v: t,
            color: col,
            wind: rigidWind,
            pivot: this.groundOrigin,
            roughness,
            translucency,
            detailMetric: 0.78,
            anatomyLevel: 3,
          }),
        );
      }
      rings.push(row);
    }

    const apexPt = addScaled(basePos, ax, len);
    const vEnd = mesh.addVertex({
      x: apexPt.x, y: apexPt.y, z: apexPt.z,
      tx: ax.x, ty: ax.y, tz: ax.z,
      u: 0.5, v: 1,
      color: colApex,
      wind: rigidWind,
      pivot: this.groundOrigin,
      roughness,
      translucency,
      detailMetric: 0.95,
      anatomyLevel: 3,
    });

    for (let j = 0; j < uSegs; j++) {
      mesh.addTri(vStart, rings[0][(j + 1) % uSegs], rings[0][j]);
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let j = 0; j < uSegs; j++) {
        const j1 = (j + 1) % uSegs;
        mesh.addQuad(rings[r][j], rings[r][j1], rings[r + 1][j1], rings[r + 1][j]);
      }
    }
    const last = rings[rings.length - 1];
    for (let j = 0; j < uSegs; j++) {
      mesh.addTri(last[j], last[(j + 1) % uSegs], vEnd);
    }
  }
}

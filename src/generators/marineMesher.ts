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
    const isCodium = p.species === 'codium_dead_mans_fingers';
    const isFan = p.species === 'gorgonian_sea_fan';
    const isAnemone = p.species === 'sea_anemone';
    const isSponge = p.species === 'azure_tube_sponge';
    const isCrinoid = p.species === 'feather_star_crinoid';

    const holdfastName = isCoral
      ? 'Welded Calcified Antler Skeleton'
      : isCodium
        ? 'Welded Dichotomous Velvet Thallus'
        : isSponge
          ? 'Hollow Organ-Pipe Chimney Walls'
          : isAnemone
            ? 'Verrucose Column & Oral Disc'
            : isCrinoid
              ? 'Pentagonal Calyx & Grasping Cirri'
              : p.species === 'neptune_seagrass' || p.species === 'eelgrass_zostera'
                ? 'Creeping Rhizomes & Basal Sheaths'
                : p.species === 'sea_grapes_caulerpa'
                  ? 'Creeping Emerald Stolons & Rhizoids'
                  : 'Haptera Holdfast & Basal Foot';

    const stipeName = isFan
      ? 'Flabellate Ribs & Reticulate Lattice'
      : isCrinoid
        ? 'Segmented Brachial Arms'
        : p.species === 'sea_palm_postelsia'
          ? 'Fluted Rubbery Sea-Palm Trunks'
          : p.species === 'mermaid_wineglass_acetabularia'
            ? 'Calcified Hair-Slender Stalks'
            : p.species === 'eelgrass_zostera'
              ? 'Fertile Flowering Spathe Shoots'
              : 'Buoyant Stipes & Thallus Axes';

    const frondsName = isAnemone
      ? '3D Bubble-Tip Tentacles'
      : isCrinoid
        ? 'Feathery Sensory Pinnules'
        : p.species === 'neptune_seagrass' || p.species === 'eelgrass_zostera'
          ? 'Multi-Veined Seagrass Ribbons'
          : p.species === 'sea_lettuce_ulva'
            ? 'Hyperbolic-Ruffled Thallus Lobes'
            : p.species === 'peacock_tail_padina'
              ? 'Concentric Calcified Fan Blades'
              : p.species === 'red_dulse_palmaria'
                ? 'Palmate Crimson-Ruby Lobes'
                : p.species === 'mermaid_wineglass_acetabularia'
                  ? 'Radially Pleated Wineglass Parasols'
                  : p.species === 'sea_grapes_caulerpa'
                    ? 'Constricted Grape Pedicel Stalks'
                    : 'Corrugated Marine Blades';

    const vesiclesName = isCoral || isFan
      ? '3D Corallite Cups & Reef Polyps'
      : isCodium
        ? 'Frosty Translucent Utricle Velvet'
        : isSponge
          ? 'Thorny Spicule Conules'
          : p.species === 'neptune_seagrass'
            ? 'Crustose Coralline Epiphytes'
            : p.species === 'eelgrass_zostera'
              ? 'Underwater Spadix Flowers & Seeds'
              : p.species === 'sea_grapes_caulerpa'
                ? 'Translucent Emerald Caviar Grapes'
                : p.species === 'knotted_wrack_ascophyllum'
                  ? 'Inline Air Bladders & Saffron Receptacles'
                  : p.species === 'red_dulse_palmaria'
                    ? 'Marginal Baby Bladelet Proliferations'
                    : p.species === 'mermaid_wineglass_acetabularia'
                      ? 'Superior Corona Rings'
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
      case 'sea_palm_postelsia':
        this.buildSeaPalmPostelsia(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'knotted_wrack_ascophyllum':
        this.buildKnottedWrackAscophyllum(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'neptune_seagrass':
        this.buildNeptuneSeagrass(tier, holdfastMesh, frondsMesh, vesiclesMesh);
        break;
      case 'eelgrass_zostera':
        this.buildEelgrassZostera(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'sargassum_weed':
        this.buildSargassum(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'peacock_tail_padina':
        this.buildPeacockTailPadina(tier, holdfastMesh, frondsMesh, vesiclesMesh);
        break;
      case 'red_dulse_palmaria':
        this.buildRedDulsePalmaria(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'sea_grapes_caulerpa':
        this.buildSeaGrapesCaulerpa(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'mermaid_wineglass_acetabularia':
        this.buildMermaidWineglassAcetabularia(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'codium_dead_mans_fingers':
        this.buildCodiumDeadMansFingers(tier, holdfastMesh, vesiclesMesh);
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

    holdfastMesh.metaLabel = isCoral || isCodium
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
  // 11. INTERTIDAL SEA PALM (Postelsia palmaeformis)
  // ===========================================================================
  private buildSeaPalmPostelsia(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colTrunkBase = mixRgb(hexToLinearRgb(p.huePrimary), colHoldfast, 0.35);
    const colTrunkTop = hexToLinearRgb(p.hueSecondary);
    const colBladeBase = hexToLinearRgb(p.huePrimary);
    const colBladeTip = mixRgb(hexToLinearRgb(p.hueSecondary), hexToLinearRgb(p.hueAccent), 0.35);
    const colSori = hexToLinearRgb(p.hueAccent);

    const nPalms = clamp(Math.round(p.colonyCount), 1, 10);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const groveRadius = nPalms === 1 ? 0 : Math.min(0.42, 0.14 + 0.055 * nPalms) * p.canopySpread;

    for (let idx = 0; idx < nPalms; idx++) {
      const pRng = this.rng.fork(0x9100 + idx * 107);
      const az = idx * GOLDEN_ANGLE + pRng.range(-0.18, 0.18);
      const dist = idx === 0 ? 0 : groveRadius * Math.sqrt((idx + 0.25) / nPalms) * pRng.vary(1.0, 0.14);
      const u = clamp(0.5 + Math.cos(az) * dist * 0.42, 0.12, 0.88);
      const v = clamp(0.5 + Math.sin(az) * dist * 0.42, 0.12, 0.88);
      const surf = this.substrate.sampleSurface(u, v);
      const baseOrigin = surf.pos;

      const heightScale = idx === 0 ? 1.04 : lerp1(0.96, 0.68, idx / Math.max(1, nPalms - 1)) * pRng.vary(1.0, 0.1);
      const palmH = Math.max(0.28, p.colonyHeight * heightScale);
      const palmPhase = (this.colonyPhase + idx * 0.005) % 1;
      const holdR = Math.max(0.055, palmH * 0.11);

      // 1. Interwoven finger-like haptera dome gripping wave-swept rock
      this.emitHapteraHoldfast(holdfastMesh, baseOrigin, holdR, tier >= 3 ? 16 : 10, colHoldfast, tier);

      // 2. Stout, rubbery, longitudinally fluted golden-olive sea-palm trunk
      const outDir = idx === 0 ? currentDir : v3(Math.cos(az), 0, Math.sin(az));
      const initDir = normalize(
        add(scale(UP, Math.cos(leanRad * 0.65)), add(scale(currentDir, Math.sin(leanRad * 0.65)), scale(outDir, 0.14))),
      );
      const trunkSegs = tier >= 3 ? 20 : 13;
      const trunkSides = tier >= 3 ? 16 : 12;
      const trunk = growCurve(
        add(baseOrigin, v3(0, holdR * 0.28, 0)),
        initDir,
        anyPerpendicular(initDir),
        palmH * 0.88,
        trunkSegs,
        (t0, t1) => {
          const dt = t1 - t0;
          return {
            pitch: (leanRad * 0.35 + Math.sin(t1 * Math.PI * 1.1) * 0.12) * dt,
            yaw: pRng.range(-0.12, 0.12) * dt,
          };
        },
      );

      const rBase = Math.max(0.022, palmH * 0.068 * clamp(p.organWidth / 0.18, 0.7, 1.5));
      const trunkTopFlex = 0.24 * p.currentSway;
      const trunkRings: number[][] = [];
      for (let i = 0; i < trunk.count; i++) {
        const fr = trunk.frameAtIndex(i);
        const t = fr.t;
        // Slight basal swell tapering to a muscular crown neck, then flaring at the blade meristem
        const taper = lerp1(1.06, 0.54, Math.pow(t, 0.72)) + 0.14 * smoothstep(0.86, 1.0, t);
        const flex = Math.pow(t, 1.55) * trunkTopFlex;
        const row: number[] = [];
        for (let j = 0; j < trunkSides; j++) {
          const th = (j / trunkSides) * TAU;
          // Rubbery longitudinal fluting characteristic of Postelsia trunks
          const flute = 1 + 0.065 * Math.cos(th * 8) * smoothstep(0.05, 0.85, t);
          const rHere = rBase * taper * flute;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere);
          const col = mixRgb(colTrunkBase, colTrunkTop, smoothstep(0.08, 0.92, t));
          row.push(
            stipeMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / trunkSides, v: t,
              color: col,
              wind: [t, flex, palmPhase, 0],
              pivot: this.groundOrigin,
              roughness: 0.32,
              translucency: p.translucency * 0.45,
              detailMetric: 0.45,
              anatomyLevel: 1,
            }),
          );
        }
        trunkRings.push(row);
      }
      for (let i = 0; i < trunkRings.length - 1; i++) {
        for (let j = 0; j < trunkSides; j++) {
          const j1 = (j + 1) % trunkSides;
          stipeMesh.addQuad(trunkRings[i][j], trunkRings[i][j1], trunkRings[i + 1][j1], trunkRings[i + 1][j]);
        }
      }
      const apexFr = trunk.atT(1.0);
      const apexCap = stipeMesh.addVertex({
        x: apexFr.pos.x + apexFr.dir.x * rBase * 0.25,
        y: apexFr.pos.y + apexFr.dir.y * rBase * 0.25,
        z: apexFr.pos.z + apexFr.dir.z * rBase * 0.25,
        nx: apexFr.dir.x, ny: apexFr.dir.y, nz: apexFr.dir.z,
        tx: apexFr.right.x, ty: apexFr.right.y, tz: apexFr.right.z,
        u: 0.5, v: 1,
        color: colTrunkTop,
        wind: [1, trunkTopFlex, palmPhase, 0],
        pivot: this.groundOrigin,
        roughness: 0.3,
        translucency: p.translucency * 0.5,
        detailMetric: 0.6,
        anatomyLevel: 1,
      });
      const topRow = trunkRings[trunkRings.length - 1];
      for (let j = 0; j < trunkSides; j++) {
        stipeMesh.addTri(topRow[j], topRow[(j + 1) % trunkSides], apexCap);
      }
      this.stats.stemsOrTubes++;

      // 3. Drooping 360-deg Umbrella Crown of Deeply Channeled Surf Blades & Spore Sori!
      const nBlades = Math.max(22, Math.round((tier >= 3 ? 44 : 28) * p.organDensity));
      const rCrown = rBase * 0.56;
      for (let b = 0; b < nBlades; b++) {
        const bFrac = b / Math.max(1, nBlades - 1); // 0 = upper inner crown, 1 = outer weeping skirt
        const bAz = b * GOLDEN_ANGLE + pRng.range(-0.09, 0.09);
        const radH = normalize(add(scale(apexFr.right, Math.cos(bAz)), scale(apexFr.up, Math.sin(bAz))));
        const launchElev = lerp1(0.62, 0.12, bFrac);
        const launchDir = normalize(
          add(
            scale(radH, Math.cos(launchElev) * p.canopySpread),
            add(scale(apexFr.dir, Math.sin(launchElev)), scale(currentDir, 0.22 * Math.sin(leanRad))),
          ),
        );
        const bladeOrigin = add(
          addScaled(apexFr.pos, apexFr.dir, lerp1(rBase * 0.18, -rBase * 0.16, bFrac)),
          scale(radH, rCrown * lerp1(0.38, 0.92, bFrac)),
        );
        const bladeLen = p.organLength * heightScale * lerp1(0.76, 1.12, Math.sin(Math.PI * (0.2 + 0.65 * bFrac))) * pRng.vary(1.0, 0.1);
        const bladeHalfW = bladeLen * clamp(p.organWidth, 0.06, 0.36) * 0.28;

        this.emitChanneledPostelsiaBlade(
          frondsMesh,
          vesiclesMesh,
          bladeOrigin,
          launchDir,
          bladeLen,
          bladeHalfW,
          tier >= 3 ? 16 : 10,
          p.ruffleWave,
          colBladeBase,
          colBladeTip,
          colSori,
          trunkTopFlex,
          0.16 * p.currentSway,
          0.22 * p.currentSway,
          palmPhase,
          pRng.range(0, TAU),
          p.vesicleAbundance > 0.2 && b % 2 === 0,
        );
        this.stats.bladesOrTentacles++;
      }
    }
    stipeMesh.hasExplicitNormals = true;
    frondsMesh.hasExplicitNormals = true;
  }

  private emitChanneledPostelsiaBlade(
    mesh: PartMesh,
    soriMesh: PartMesh,
    origin: V3,
    launchDir: V3,
    length: number,
    halfWidth: number,
    uSegs: number,
    ruffle: number,
    colBase: RGB,
    colTip: RGB,
    colSori: RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
    waveSeed: number,
    emitSoriRidge: boolean,
  ): void {
    let right = projectOnPlane(v3(-launchDir.z, 0, launchDir.x), launchDir);
    if (lengthSq(right) < 1e-6) right = anyPerpendicular(launchDir);
    right = normalize(right);

    // Signature umbrella-fountain arch pitching smoothly downward toward the rocky surf!
    const spine = growCurve(origin, launchDir, right, length, uSegs, (t0, t1) => {
      const dt = t1 - t0;
      const umbrellaArch = -(1.55 + 0.55 * t1) * dt;
      const surfRipple = Math.sin(t1 * TAU * 1.4 + waveSeed) * 0.28 * ruffle * dt;
      return { pitch: umbrellaArch + surfRipple, yaw: Math.cos(t1 * Math.PI * 1.5 + waveSeed) * 0.18 * dt };
    });

    const vCols = 4; // Deeply longitudinally grooved 5-vertex cross-section!
    const posGrid: V3[][] = [];
    const windGrid: [number, number, number, number][][] = [];
    const colGrid: RGB[][] = [];

    for (let i = 0; i <= uSegs; i++) {
      const fr = spine.frameAtIndex(i);
      const u = fr.t;
      const widthEnv = Math.sin(Math.pow(u, 0.55) * Math.PI) * (1 - 0.18 * u);
      const serrate = 1 + 0.08 * ruffle * Math.sin(u * 38 + waveSeed) * smoothstep(0.15, 0.9, u);
      const wHere = Math.max(0.0018, halfWidth * widthEnv * serrate);
      const flex = attachFlex + extraFlex * Math.pow(u, 1.35);
      const flut = maxFlutter * u * u;
      const wVec: [number, number, number, number] = [u, flex, phase, flut];

      const pRow: V3[] = [];
      const wRow: [number, number, number, number][] = [];
      const cRow: RGB[] = [];

      for (let c = 0; c <= vCols; c++) {
        const vSym = (c / vCols) * 2 - 1; // -1 .. +1
        // Parallel longitudinal corrugation grooves of Postelsia blades!
        const groove = Math.cos(vSym * Math.PI * 2.0) * wHere * (0.24 + 0.18 * ruffle);
        const vFold = Math.abs(vSym) * wHere * 0.22;
        const pt = add(addScaled(fr.pos, fr.right, vSym * wHere), scale(fr.up, groove + vFold));
        const col = mixRgb(colBase, colTip, smoothstep(0.1, 0.92, u) * (0.75 + 0.25 * Math.abs(vSym)));
        pRow.push(pt);
        wRow.push(wVec);
        cRow.push(col);
      }
      posGrid.push(pRow);
      windGrid.push(wRow);
      colGrid.push(cRow);

      // Raised fertile linear spore patch (sorus) along the central groove of mature blades
      if (emitSoriRidge && i >= Math.floor(uSegs * 0.35) && i <= Math.floor(uSegs * 0.75) && i % 3 === 0) {
        this.emitClosedOvoid(
          soriMesh,
          addScaled(fr.pos, fr.up, -wHere * 0.12),
          fr.dir,
          length / uSegs * 2.2,
          wHere * 0.18,
          5,
          4,
          colBase,
          colSori,
          0.42,
          0.35,
          [u, flex, phase, flut * 0.5],
        );
        this.stats.vesiclesOrPolyps++;
      }
    }

    const idxGrid: number[][] = [];
    for (let i = 0; i <= uSegs; i++) {
      const fr = spine.frameAtIndex(i);
      const rowIds: number[] = [];
      for (let c = 0; c <= vCols; c++) {
        const pU0 = posGrid[Math.max(0, i - 1)][c];
        const pU1 = posGrid[Math.min(uSegs, i + 1)][c];
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
            u: c / vCols, v: i / uSegs,
            color: colGrid[i][c],
            wind: windGrid[i][c],
            pivot: this.groundOrigin,
            roughness: 0.24,
            translucency: this.p.translucency,
            detailMetric: i / uSegs,
            anatomyLevel: 3,
          }),
        );
      }
      idxGrid.push(rowIds);
    }
    for (let i = 0; i < uSegs; i++) {
      for (let c = 0; c < vCols; c++) {
        mesh.addQuad(idxGrid[i][c], idxGrid[i][c + 1], idxGrid[i + 1][c + 1], idxGrid[i + 1][c]);
      }
    }
  }

  // ===========================================================================
  // 12. KNOTTED BLADDER WRACK (Ascophyllum nodosum)
  // ===========================================================================
  private buildKnottedWrackAscophyllum(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colStrapBase = hexToLinearRgb(p.huePrimary);
    const colStrapMid = hexToLinearRgb(p.hueSecondary);
    const colBladder = mixRgb(colStrapMid, hexToLinearRgb(p.hueAccent), 0.62);
    const colReceptacle = hexToLinearRgb(p.huePolyp);

    const discR = Math.max(0.08, p.colonyHeight * 0.085);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, discR, tier >= 3 ? 16 : 10, colHoldfast, tier);

    const nPrimary = clamp(Math.round(p.colonyCount), 2, 14);
    const maxOrder = clamp(Math.round(p.branchOrder), 2, 4);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const segStrapSteps = tier >= 3 ? 10 : 6;
    const baseHalfW = Math.max(0.018, p.organLength * clamp(p.organWidth, 0.10, 0.45) * 0.52);

    const buildWrackSegment = (
      startPos: V3,
      dir0: V3,
      right0: V3,
      segLen: number,
      w0: number,
      w1: number,
      flex0: number,
      flex1: number,
      order: number,
      phase: number,
      seedKey: number,
    ): void => {
      const sRng = this.rng.fork(seedKey);
      const curve = growCurve(startPos, dir0, right0, segLen, segStrapSteps, (t0, t1) => {
        const dt = t1 - t0;
        const organicWave = Math.sin(t1 * TAU * 0.85 + (seedKey % 17)) * 0.42;
        const gentleArch = -0.16 * order * t1;
        return {
          pitch: (organicWave + gentleArch) * dt,
          yaw: Math.cos(t1 * Math.PI * 1.2 + (seedKey % 13)) * 0.28 * dt,
        };
      });

      // Short basal cylindrical stipe on order-0 segments; flattened midribbed rockweed strap everywhere else!
      if (order === 0) {
        const shortBase = this.curveFromPoints([curve.pts[0], curve.pts[1], curve.pts[2]]);
        this.emitClosedTube(
          stipeMesh,
          shortBase,
          (t) => lerp1(w0 * 0.55, w0 * 0.36, t),
          6,
          (t) => mixRgb(colHoldfast, colStrapBase, t),
          flex0,
          (flex1 - flex0) * 0.25,
          phase,
          0.42,
          p.translucency * 0.35,
        );
        this.stats.stemsOrTubes++;
      }

      const vCols = 4; // Raised central midrib (`c = 2`) + flattened leathery thallus wings (`c = 0,1,3,4`)!
      const idxGrid: number[][] = [];
      for (let i = 0; i < curve.count; i++) {
        const fr = curve.frameAtIndex(i);
        const t = fr.t;
        const wHere = lerp1(w0, w1, t) * (1 + 0.08 * Math.sin(t * Math.PI));
        const flex = lerp1(flex0, flex1, t);
        const flut = order >= maxOrder ? 0.16 * p.currentSway * t * t : 0;
        const rowIds: number[] = [];
        for (let c = 0; c <= vCols; c++) {
          const vSym = (c / vCols) * 2 - 1;
          const midribBump = c === 2 ? wHere * 0.26 : c === 1 || c === 3 ? wHere * 0.08 : 0;
          const wingWave = Math.sin(t * TAU * 1.5 + seedKey * 0.1) * wHere * 0.12 * p.ruffleWave * vSym;
          const pt = add(addScaled(fr.pos, fr.right, vSym * wHere), scale(fr.up, midribBump + wingWave));
          const nrm = normalize(add(fr.up, scale(fr.right, -vSym * 0.18)));
          const col = mixRgb(
            colStrapBase,
            colStrapMid,
            clamp((order + t) / (maxOrder + 1), 0, 1) * (c === 2 ? 0.65 : 1.0),
          );
          rowIds.push(
            frondsMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nrm.x, ny: nrm.y, nz: nrm.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: c / vCols, v: t,
              color: col,
              wind: [t, flex, phase, flut],
              pivot: this.groundOrigin,
              roughness: 0.28,
              translucency: p.translucency,
              detailMetric: (order + t) / (maxOrder + 1),
              anatomyLevel: 2,
            }),
          );
        }
        idxGrid.push(rowIds);
      }
      for (let i = 0; i < idxGrid.length - 1; i++) {
        for (let c = 0; c < vCols; c++) {
          frondsMesh.addQuad(idxGrid[i][c], idxGrid[i][c + 1], idxGrid[i + 1][c + 1], idxGrid[i + 1][c]);
        }
      }
      this.stats.bladesOrTentacles++;

      // Inline lemon-ovoid air bladder (`pneumatocyst`) swelling smoothly along the strap mid-axis!
      if (order >= 1 && order < maxOrder && p.vesicleAbundance > 0.15) {
        const bT = 0.52;
        const bFr = curve.atT(bT);
        const bFlex = lerp1(flex0, flex1, bT);
        const blLen = segLen * 0.34 * clamp(p.vesicleAbundance, 0.5, 1.35);
        const blRad = Math.min(blLen * 0.34, w0 * 1.28);
        this.emitClosedOvoid(
          vesiclesMesh,
          addScaled(bFr.pos, bFr.dir, -blLen * 0.5),
          bFr.dir,
          blLen,
          blRad,
          tier >= 3 ? 10 : 7,
          tier >= 3 ? 8 : 5,
          colStrapBase,
          colBladder,
          0.18,
          p.translucency * 0.72,
          [bT, bFlex, phase, 0],
        );
        this.stats.vesiclesOrPolyps++;
      }

      const endFr = curve.atT(1.0);
      if (order < maxOrder) {
        // Dichotomous Y-fork in the flattened strap plane (`endFr.right`) with gentle 3D twist!
        const spreadAng = lerp1(26, 19, order / maxOrder) * DEG2RAD * p.canopySpread;
        for (const fSign of [-1, 1]) {
          const childDir = normalize(
            add(
              scale(endFr.dir, Math.cos(spreadAng)),
              add(scale(endFr.right, fSign * Math.sin(spreadAng)), scale(UP, 0.14)),
            ),
          );
          const twistAng = 0.36 * fSign;
          const childRight = normalize(
            projectOnPlane(
              add(scale(endFr.right, Math.cos(twistAng)), scale(endFr.up, Math.sin(twistAng))),
              childDir,
            ),
          );
          const childLen = segLen * lerp1(0.84, 0.74, order / maxOrder) * sRng.vary(1.0, 0.1);
          const childEndFlex = flex1 + (0.11 + 0.04 * order) * p.currentSway;
          buildWrackSegment(
            endFr.pos,
            childDir,
            childRight,
            childLen,
            w1 * 0.92,
            w1 * 0.76,
            flex1,
            childEndFlex,
            order + 1,
            phase,
            seedKey * 31 + (fSign > 0 ? 17 : 7),
          );
        }

        // Short stalked lateral saffron-gold receptacle clusters on upper nodes!
        if (order === maxOrder - 1 && p.vesicleAbundance > 0.35) {
          for (const rSign of [-1, 1]) {
            if (sRng.next() > 0.65 * p.vesicleAbundance) continue;
            const mFr = curve.atT(0.68);
            const mFlex = lerp1(flex0, flex1, 0.68);
            const recDir = normalize(add(scale(mFr.dir, 0.55), scale(mFr.right, rSign * 0.82)));
            const recLen = w1 * 2.6;
            const stalkEnd = addScaled(mFr.pos, recDir, w1 * 0.9);
            this.emitClosedOvoid(
              vesiclesMesh,
              stalkEnd,
              recDir,
              recLen,
              recLen * 0.44,
              tier >= 3 ? 8 : 6,
              tier >= 3 ? 6 : 4,
              colBladder,
              colReceptacle,
              0.34,
              p.translucency * 0.6,
              [0.68, mFlex, phase, 0],
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
      } else if (p.vesicleAbundance > 0.1) {
        // Swollen saffron-orange fertile terminal receptacle club at every forked strap apex!
        const recLen = Math.max(0.024, w1 * 2.4 * clamp(p.vesicleAbundance, 0.6, 1.35));
        this.emitClosedOvoid(
          vesiclesMesh,
          addScaled(endFr.pos, endFr.dir, -recLen * 0.18),
          endFr.dir,
          recLen,
          recLen * 0.36,
          tier >= 3 ? 9 : 6,
          tier >= 3 ? 7 : 5,
          colBladder,
          colReceptacle,
          0.32,
          p.translucency * 0.65,
          [1.0, flex1, phase, 0.08 * p.currentSway],
        );
        this.stats.vesiclesOrPolyps++;
      }
    };

    const seg0Len = (p.colonyHeight / (1 + 0.78 * maxOrder)) * 1.18;
    for (let k = 0; k < nPrimary; k++) {
      const kRng = this.rng.fork(0x9500 + k * 79);
      const az = k * GOLDEN_ANGLE + kRng.range(-0.2, 0.2);
      const out = v3(Math.cos(az), 0, Math.sin(az));
      const basePt = add(this.groundOrigin, v3(out.x * discR * 0.28, discR * 0.24, out.z * discR * 0.28));
      const dir0 = normalize(
        add(scale(UP, 0.82), add(scale(out, 0.38 * p.canopySpread), scale(currentDir, Math.sin(leanRad) * 0.55))),
      );
      const right0 = normalize(projectOnPlane(v3(-out.z, 0, out.x), dir0));
      const phase = (this.colonyPhase + k * 0.005) % 1;
      buildWrackSegment(
        basePt,
        dir0,
        right0,
        seg0Len * kRng.vary(1.0, 0.12),
        baseHalfW,
        baseHalfW * 0.88,
        0.02 * p.currentSway,
        0.10 * p.currentSway,
        0,
        phase,
        0xa100 + k * 131,
      );
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 13. PEACOCK'S TAIL CALCIFIED FAN ALGA (Padina pavonica)
  // ===========================================================================
  private buildPeacockTailPadina(
    tier: number,
    holdfastMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colOchre = hexToLinearRgb(p.huePrimary);
    const colTeal = hexToLinearRgb(p.hueSecondary);
    const colChalk = hexToLinearRgb(p.hueAccent);
    const colRimHair = hexToLinearRgb(p.huePolyp);

    const padR = Math.max(0.06, p.colonyHeight * 0.14);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, padR, tier >= 3 ? 12 : 8, colHoldfast, tier);

    const nFans = clamp(Math.round(p.colonyCount * p.organDensity), 6, 32);
    const radRings = tier >= 3 ? 18 : 12; // Extra rings for concentric calcified bands & rolled circinate rim!
    const angCols = tier >= 3 ? 28 : 18;
    const nCalcBands = Math.max(5, Math.round(6 + 4 * p.vesicleAbundance));

    for (let f = 0; f < nFans; f++) {
      const fRng = this.rng.fork(0xa500 + f * 89);
      const tierFrac = f / Math.max(1, nFans - 1);
      const az = f * GOLDEN_ANGLE + fRng.range(-0.15, 0.15);
      const fanPhase = (this.colonyPhase + f * 0.003) % 1;

      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const tangDir = v3(-Math.sin(az), 0, Math.cos(az));
      const elev = lerp1(68, 22, tierFrac) * DEG2RAD;
      const axisDir = normalize(add(scale(radDir, Math.cos(elev) * p.canopySpread), scale(UP, Math.sin(elev))));
      const normal0 = normalize(cross(tangDir, axisDir));

      const fanLen = p.organLength * lerp1(0.72, 1.14, Math.sin(Math.PI * (0.22 + 0.68 * tierFrac))) * fRng.vary(1.0, 0.12);
      const spanRad = (108 + 56 * clamp(p.organWidth, 0.25, 1.0)) * DEG2RAD;
      const origin = add(this.groundOrigin, addScaled(v3(0, padR * 0.24, 0), radDir, padR * 0.34 * tierFrac));
      const splitNotchFreq = f % 2 === 0 ? 2.0 : 3.0;
      const waveSeed = fRng.range(0, TAU);

      const posGrid: V3[][] = [];
      const colGrid: RGB[][] = [];
      const roughGrid: number[][] = [];
      const windGrid: [number, number, number, number][][] = [];

      for (let r = 0; r <= radRings; r++) {
        const uRaw = r / radRings;
        // Outer 10% (`uRaw > 0.90`) curls inward 165 deg into Padina's signature circinate scroll margin!
        const scrollT = smoothstep(0.88, 1.0, uRaw);
        const scrollAng = scrollT * 2.85;
        const u = Math.min(0.92, uRaw) + (1 - Math.cos(scrollAng)) * 0.032;
        const scrollLift = Math.sin(scrollAng) * fanLen * 0.042;

        const bandPhase = u * nCalcBands * TAU;
        const chalkMask = Math.pow(0.5 + 0.5 * Math.cos(bandPhase), 1.6);
        const tealMask = Math.pow(0.5 + 0.5 * Math.sin(bandPhase - 0.8), 1.8) * smoothstep(0.18, 0.85, u);
        const bandRidge = Math.cos(bandPhase) * fanLen * 0.008 * smoothstep(0.15, 0.9, u);

        const flex = (0.025 + 0.14 * Math.pow(u, 1.45)) * p.currentSway;
        const flut = 0.10 * u * u * p.currentSway;
        const rowW: [number, number, number, number] = [uRaw, flex, fanPhase, flut];

        const pRow: V3[] = [];
        const cRow: RGB[] = [];
        const rRow: number[] = [];
        const wRow: [number, number, number, number][] = [];

        for (let c = 0; c <= angCols; c++) {
          const v = c / angCols - 0.5;
          const theta = v * spanRad * (0.16 + 0.84 * smoothstep(0.0, 0.45, u));
          const roundEar = Math.pow(Math.max(0.10, Math.cos(v * Math.PI * 0.92)), 0.32);
          // Natural radial cleft indentations of split Padina flabellate fans
          const cleft = 1 - 0.11 * p.ruffleWave * Math.pow(Math.sin(Math.abs(v) * Math.PI * splitNotchFreq), 4) * smoothstep(0.45, 1.0, u);
          const rDist = Math.max(0.006, fanLen * Math.pow(u, 0.92) * roundEar * cleft);

          const dirSheet = normalize(add(scale(axisDir, Math.cos(theta)), scale(tangDir, Math.sin(theta))));
          // Funnel-ear cupping (`+v^2`) + gentle margin undulation + concentric band ridge + circinate lip scroll!
          const funnelCup = (v * v * 0.48 - 0.12 * u) * fanLen * u;
          const marginWave = Math.sin(theta * 4.5 + waveSeed) * fanLen * 0.045 * p.ruffleWave * u * u;
          const pt = add(
            addScaled(origin, dirSheet, rDist),
            scale(normal0, funnelCup + marginWave + bandRidge + scrollLift),
          );

          // Concentric alternating olive-ochre, iridescent peacock-turquoise & aragonite chalk-white bands!
          let col = mixRgb(colOchre, colTeal, tealMask * 0.82);
          col = mixRgb(col, colChalk, chalkMask * (0.48 + 0.34 * p.vesicleAbundance) * smoothstep(0.12, 0.95, u));
          if (scrollT > 0.1) {
            col = mixRgb(col, colRimHair, scrollT * 0.55);
          }

          pRow.push(pt);
          cRow.push(col);
          rRow.push(lerp1(0.24, 0.76, chalkMask));
          wRow.push(rowW);
        }
        posGrid.push(pRow);
        colGrid.push(cRow);
        roughGrid.push(rRow);
        windGrid.push(wRow);
      }

      const idxGrid: number[][] = [];
      for (let r = 0; r <= radRings; r++) {
        const rowIds: number[] = [];
        for (let c = 0; c <= angCols; c++) {
          const pU0 = posGrid[Math.max(0, r - 1)][c];
          const pU1 = posGrid[Math.min(radRings, r + 1)][c];
          const pV0 = posGrid[r][Math.max(0, c - 1)];
          const pV1 = posGrid[r][Math.min(angCols, c + 1)];
          let nrm = cross(sub(pV1, pV0), sub(pU1, pU0));
          nrm = lengthSq(nrm) > 1e-12 ? normalize(nrm) : normal0;
          const tang = lengthSq(sub(pU1, pU0)) > 1e-12 ? normalize(sub(pU1, pU0)) : axisDir;
          const pt = posGrid[r][c];

          rowIds.push(
            frondsMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nrm.x, ny: nrm.y, nz: nrm.z,
              tx: tang.x, ty: tang.y, tz: tang.z,
              u: c / angCols, v: r / radRings,
              color: colGrid[r][c],
              wind: windGrid[r][c],
              pivot: this.groundOrigin,
              roughness: roughGrid[r][c],
              translucency: p.translucency * (1 - 0.35 * (roughGrid[r][c] - 0.24)),
              detailMetric: r / radRings,
              anatomyLevel: 3,
            }),
          );
        }
        idxGrid.push(rowIds);
      }
      for (let r = 0; r < radRings; r++) {
        for (let c = 0; c < angCols; c++) {
          frondsMesh.addQuad(idxGrid[r][c], idxGrid[r][c + 1], idxGrid[r + 1][c + 1], idxGrid[r + 1][c]);
        }
      }
      this.stats.bladesOrTentacles++;

      // Concentric piliferous hair-band arc along the outer third of each Padina fan
      if (p.vesicleAbundance > 0.25) {
        const ringIdx = Math.floor(radRings * 0.72);
        const arcPts = posGrid[ringIdx].filter((_, k) => k % 2 === 0);
        if (arcPts.length >= 3) {
          const arcCurve = this.curveFromPoints(arcPts);
          const ringFlex = windGrid[ringIdx][0][1];
          this.emitClosedTube(
            vesiclesMesh,
            arcCurve,
            () => Math.max(0.0012, fanLen * 0.0055),
            4,
            () => mixRgb(colOchre, colRimHair, 0.5),
            ringFlex,
            0,
            fanPhase,
            0.78,
            0.35,
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 14. CRIMSON PALMATE DULSE (Palmaria palmata)
  // ===========================================================================
  private buildRedDulsePalmaria(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colBaseRuby = hexToLinearRgb(p.huePrimary);
    const colCrimson = hexToLinearRgb(p.hueSecondary);
    const colRoseTip = hexToLinearRgb(p.hueAccent);
    const colProlif = hexToLinearRgb(p.huePolyp);

    const discR = Math.max(0.065, p.colonyHeight * 0.08);
    this.emitHapteraHoldfast(holdfastMesh, this.groundOrigin, discR, tier >= 3 ? 14 : 9, colHoldfast, tier);

    const nFronds = clamp(Math.round(p.colonyCount), 3, 18);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const nFingers = clamp(Math.round(p.branchOrder) + 2, 3, 6);

    for (let f = 0; f < nFronds; f++) {
      const fRng = this.rng.fork(0xaf00 + f * 97);
      const tierFrac = f / Math.max(1, nFronds - 1);
      const az = f * GOLDEN_ANGLE + fRng.range(-0.16, 0.16);
      const phase = (this.colonyPhase + f * 0.004) % 1;
      const outDir = v3(Math.cos(az), 0, Math.sin(az));
      const tangDir = v3(-Math.sin(az), 0, Math.cos(az));

      // Short cuneate basal stipe expanding into the palmate blade base
      const stipeLen = p.colonyHeight * 0.15 * fRng.vary(1.0, 0.12);
      const elev = lerp1(74, 34, tierFrac) * DEG2RAD;
      const stipeDir = normalize(
        add(
          scale(UP, Math.sin(elev)),
          add(scale(outDir, Math.cos(elev) * p.canopySpread), scale(currentDir, Math.sin(leanRad) * 0.45)),
        ),
      );
      const stipeStart = add(this.groundOrigin, v3(outDir.x * discR * 0.25, discR * 0.22, outDir.z * discR * 0.25));
      const stipeEnd = addScaled(stipeStart, stipeDir, stipeLen);
      const stipeCurve = this.curveFromPoints([
        stipeStart,
        lerpV3(stipeStart, stipeEnd, 0.5),
        stipeEnd,
      ]);
      const stipeEndFlex = 0.06 * p.currentSway;
      this.emitClosedTube(
        stipeMesh,
        stipeCurve,
        (t) => lerp1(0.0045, 0.0085, t),
        6,
        (t) => mixRgb(colHoldfast, colBaseRuby, t),
        0.01 * p.currentSway,
        stipeEndFlex - 0.01 * p.currentSway,
        phase,
        0.34,
        p.translucency * 0.45,
      );
      this.stats.stemsOrTubes++;

      // Deeply palmate hand-shaped fan of broad undulating crimson-magenta lobes!
      const handSpan = lerp1(64, 96, clamp(p.organWidth, 0.15, 0.85)) * DEG2RAD;
      for (let d = 0; d < nFingers; d++) {
        const dFrac = nFingers === 1 ? 0 : (d / (nFingers - 1)) * 2 - 1; // -1 .. +1 across palmate hand
        const lobeAng = dFrac * handSpan * 0.5 + fRng.range(-0.06, 0.06);
        const lobeDir = normalize(
          add(scale(stipeDir, Math.cos(lobeAng)), scale(tangDir, Math.sin(lobeAng) * p.canopySpread)),
        );
        const centerBoost = 1.08 - 0.24 * dFrac * dFrac;
        const lobeLen = p.organLength * centerBoost * fRng.vary(1.0, 0.11);
        const lobeHalfW = lobeLen * clamp(p.organWidth, 0.12, 0.65) * 0.28;

        this.emitPalmateDulseLobe(
          frondsMesh,
          vesiclesMesh,
          stipeEnd,
          lobeDir,
          tangDir,
          lobeLen,
          lobeHalfW,
          tier >= 3 ? 16 : 10,
          p.ruffleWave,
          colBaseRuby,
          colCrimson,
          colRoseTip,
          colProlif,
          stipeEndFlex,
          0.20 * p.currentSway,
          0.24 * p.currentSway,
          phase,
          fRng.range(0, TAU),
          p.vesicleAbundance,
        );
        this.stats.bladesOrTentacles++;
      }
    }
    frondsMesh.hasExplicitNormals = true;
    vesiclesMesh.hasExplicitNormals = true;
  }

  private emitPalmateDulseLobe(
    mesh: PartMesh,
    prolifMesh: PartMesh,
    origin: V3,
    lobeDir: V3,
    sheetRightHint: V3,
    length: number,
    halfWidth: number,
    uSegs: number,
    ruffle: number,
    colBase: RGB,
    colMid: RGB,
    colTip: RGB,
    colProlif: RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
    waveSeed: number,
    prolifAbundance: number,
  ): void {
    let right = projectOnPlane(sheetRightHint, lobeDir);
    if (lengthSq(right) < 1e-6) right = anyPerpendicular(lobeDir);
    right = normalize(right);

    const spine = growCurve(origin, lobeDir, right, length, uSegs, (t0, t1) => {
      const dt = t1 - t0;
      const arch = (-0.42 - 0.28 * t1 + Math.sin(t1 * TAU * 1.15 + waveSeed) * 0.32 * ruffle) * dt;
      return { pitch: arch, yaw: Math.cos(t1 * Math.PI * 1.4 + waveSeed) * 0.18 * dt };
    });

    const vCols = 6; // Smooth broad obovate-spathulate red seaweed lobe with apical dichotomous notch!
    const posGrid: V3[][] = [];
    const colGrid: RGB[][] = [];
    const windGrid: [number, number, number, number][][] = [];

    for (let i = 0; i <= uSegs; i++) {
      const fr = spine.frameAtIndex(i);
      const u = fr.t;
      // Cuneate base -> broad obovate upper blade -> rounded bilobed apex!
      const obovate = Math.pow(Math.sin(Math.pow(u, 0.68) * Math.PI * 0.94), 0.62) * (0.28 + 0.85 * smoothstep(0.0, 0.55, u));
      const wHere = Math.max(0.003, halfWidth * obovate);
      const flex = attachFlex + extraFlex * Math.pow(u, 1.38);
      const flut = maxFlutter * u * u;
      const wVec: [number, number, number, number] = [u, flex, phase, flut];

      const pRow: V3[] = [];
      const cRow: RGB[] = [];
      const wRow: [number, number, number, number][] = [];

      for (let c = 0; c <= vCols; c++) {
        const vSym = (c / vCols) * 2 - 1;
        // Subtle apical dichotomous notch at tip (`u > 0.82` & `|vSym| < 0.35`)
        const tipNotch = -smoothstep(0.82, 1.0, u) * (1 - Math.min(1, Math.abs(vSym) * 2.2)) * length * 0.08;
        const marginFrill =
          Math.sin(u * TAU * 2.6 + vSym * 2.4 + waveSeed) *
          wHere *
          0.26 *
          ruffle *
          Math.pow(Math.abs(vSym), 1.35) *
          smoothstep(0.15, 0.9, u);
        const cup = (1 - vSym * vSym) * wHere * 0.09;
        const pt = add(
          addScaled(fr.pos, fr.dir, tipNotch),
          add(scale(fr.right, vSym * wHere), scale(fr.up, marginFrill + cup)),
        );

        let col = mixRgb(colBase, colMid, smoothstep(0.08, 0.68, u));
        col = mixRgb(col, colTip, smoothstep(0.62, 1.0, u) * (0.55 + 0.45 * Math.abs(vSym)));
        pRow.push(pt);
        cRow.push(col);
        wRow.push(wVec);
      }
      posGrid.push(pRow);
      colGrid.push(cRow);
      windGrid.push(wRow);

      // Marginal baby tongue-shaped dulse bladelets (`proliferations`) sprouting directly along mature edges!
      if (prolifAbundance > 0.25 && (i === Math.floor(uSegs * 0.45) || i === Math.floor(uSegs * 0.68))) {
        const sideSign = i % 2 === 0 ? 1 : -1;
        const edgePt = pRow[sideSign > 0 ? vCols : 0];
        const babyDir = normalize(add(scale(fr.dir, 0.62), scale(fr.right, sideSign * 0.78)));
        const babyLen = length * 0.24 * clamp(prolifAbundance, 0.5, 1.35);
        this.emitCorrugatedKelpBlade(
          prolifMesh,
          edgePt,
          babyDir,
          babyLen,
          babyLen * 0.28,
          6,
          4,
          ruffle * 0.6,
          false,
          colMid,
          colProlif,
          flex,
          0.06 * this.p.currentSway,
          flut + 0.08 * this.p.currentSway,
          phase,
          waveSeed + i,
          0.35,
        );
        this.stats.vesiclesOrPolyps++;
      }
    }

    const idxGrid: number[][] = [];
    for (let i = 0; i <= uSegs; i++) {
      const fr = spine.frameAtIndex(i);
      const rowIds: number[] = [];
      for (let c = 0; c <= vCols; c++) {
        const pU0 = posGrid[Math.max(0, i - 1)][c];
        const pU1 = posGrid[Math.min(uSegs, i + 1)][c];
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
            u: c / vCols, v: i / uSegs,
            color: colGrid[i][c],
            wind: windGrid[i][c],
            pivot: this.groundOrigin,
            roughness: 0.22,
            translucency: this.p.translucency,
            detailMetric: i / uSegs,
            anatomyLevel: 3,
          }),
        );
      }
      idxGrid.push(rowIds);
    }
    for (let i = 0; i < uSegs; i++) {
      for (let c = 0; c < vCols; c++) {
        mesh.addQuad(idxGrid[i][c], idxGrid[i][c + 1], idxGrid[i + 1][c + 1], idxGrid[i + 1][c]);
      }
    }
  }

  // ===========================================================================
  // 15. EMERALD SEA GRAPES / GREEN CAVIAR (Caulerpa lentillifera)
  // ===========================================================================
  private buildSeaGrapesCaulerpa(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colStolon = hexToLinearRgb(p.hueHoldfast);
    const colRhizoid = mixRgb(colStolon, hexToLinearRgb('#d8e6c3'), 0.58);
    const colStem = hexToLinearRgb(p.huePrimary);
    const colGrapeBase = hexToLinearRgb(p.hueSecondary);
    const colGrapePearl = hexToLinearRgb(p.hueAccent);

    const nShoots = clamp(Math.round(p.colonyCount), 4, 28);
    const patchR = Math.min(0.62, 0.22 + 0.025 * nShoots) * p.canopySpread;
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;

    const shootBases: V3[] = [];
    for (let s = 0; s < nShoots; s++) {
      const sRng = this.rng.fork(0xb300 + s * 67);
      const az = s * GOLDEN_ANGLE + sRng.range(-0.14, 0.14);
      const rad = patchR * Math.sqrt((s + 0.35) / nShoots);
      const u = clamp(0.5 + Math.cos(az) * rad * 0.45, 0.08, 0.92);
      const v = clamp(0.5 + Math.sin(az) * rad * 0.45, 0.08, 0.92);
      const ground = this.substrate.sampleSurface(u, v).pos;
      const nodePt = add(ground, v3(0, 0.008, 0));
      shootBases.push(nodePt);

      // Delicate pale descending siphonous rhizoid root tufts anchoring stolon nodes!
      for (let r = 0; r < 3; r++) {
        const rAz = az + r * 2.1;
        const rEnd = add(ground, v3(Math.cos(rAz) * 0.022, -0.008, Math.sin(rAz) * 0.022));
        this.emitClosedTube(
          holdfastMesh,
          this.curveFromPoints([nodePt, lerpV3(nodePt, rEnd, 0.5), rEnd]),
          (t) => lerp1(0.0032, 0.0012, t),
          4,
          () => colRhizoid,
          0,
          0,
          this.colonyPhase,
          0.55,
          0.4,
        );
      }
    }

    // Creeping emerald stolon network linking adjacent erect sea-grape shoots!
    for (let s = 1; s < shootBases.length; s++) {
      let best = 0;
      let bestD2 = Infinity;
      for (let j = 0; j < s; j++) {
        const d2 = lengthSq(sub(shootBases[s], shootBases[j]));
        if (d2 < bestD2) {
          bestD2 = d2;
          best = j;
        }
      }
      const a = shootBases[best];
      const b = shootBases[s];
      const mid = lerpV3(a, b, 0.5);
      const midSurf = this.substrate.sampleSurface(
        clamp(0.5 + (mid.x - this.groundOrigin.x) * 0.45, 0.08, 0.92),
        clamp(0.5 + (mid.z - this.groundOrigin.z) * 0.45, 0.08, 0.92),
      ).pos;
      const midPt = v3(mid.x, Math.max(midSurf.y + 0.008, (a.y + b.y) * 0.5), mid.z);
      this.emitClosedTube(
        holdfastMesh,
        this.curveFromPoints([a, midPt, b]),
        () => 0.0068,
        6,
        () => mixRgb(colStolon, colStem, 0.45),
        0,
        0,
        this.colonyPhase,
        0.24,
        p.translucency * 0.65,
      );
    }

    // Erect photosynthetic assimilator shoots densely packed with whorled translucent caviar spheres!
    for (let s = 0; s < nShoots; s++) {
      const sRng = this.rng.fork(0xb700 + s * 103);
      const basePt = shootBases[s];
      const shootH = p.colonyHeight * sRng.vary(0.92, 0.22);
      const shootPhase = (this.colonyPhase + s * 0.004) % 1;
      const stemSegs = tier >= 3 ? 18 : 12;

      const initDir = normalize(
        add(
          scale(UP, Math.cos(leanRad * 0.55)),
          add(
            scale(currentDir, Math.sin(leanRad * 0.55)),
            v3(sRng.range(-0.14, 0.14), 0, sRng.range(-0.14, 0.14)),
          ),
        ),
      );
      const stemCurve = growCurve(basePt, initDir, anyPerpendicular(initDir), shootH, stemSegs, (t0, t1) => {
        const dt = t1 - t0;
        return {
          pitch: (leanRad * 0.45 + Math.sin(t1 * Math.PI * 1.4 + s) * 0.16) * dt,
          yaw: Math.cos(t1 * Math.PI * 1.2 + s) * 0.14 * dt,
        };
      });

      const stemR = Math.max(0.0042, shootH * 0.012);
      const maxStemFlex = 0.24 * p.currentSway;
      this.emitClosedTube(
        stipeMesh,
        stemCurve,
        (t) => Math.max(0.0022, stemR * (1 - 0.42 * t)),
        6,
        (t) => mixRgb(colStem, colGrapeBase, t * 0.55),
        0.01,
        maxStemFlex,
        shootPhase,
        0.18,
        p.translucency * 0.75,
      );
      this.stats.stemsOrTubes++;

      // Dense cylindrical raceme of individual stalked jewel-emerald grape ramuli (`z = 0.14 .. 0.96`) + apical crown grape!
      const nWhorls = Math.max(8, Math.round((tier >= 3 ? 16 : 10) * p.organDensity * (shootH / p.colonyHeight)));
      const grapesPerWhorl = clamp(Math.round(4.6 * clamp(p.vesicleAbundance, 0.5, 1.4)), 4, 6);
      const baseGrapeR =
        Math.max(0.0085, shootH * 0.023 * clamp(p.organWidth / 0.24, 0.65, 1.5)) *
        (0.82 + 0.22 * p.vesicleAbundance);
      const colDeepEmerald = mixRgb(colStem, colGrapeBase, 0.48);

      for (let w = 0; w < nWhorls; w++) {
        const z = lerp1(0.14, 0.95, w / Math.max(1, nWhorls - 1));
        const fr = stemCurve.atT(z);
        const wFlex = 0.01 + maxStemFlex * z;
        const sizeEnv = 0.76 + 0.28 * Math.sin(Math.pow(z, 0.72) * Math.PI * 0.90);

        for (let g = 0; g < grapesPerWhorl; g++) {
          const gAz = (g / grapesPerWhorl) * TAU + w * GOLDEN_ANGLE + sRng.range(-0.12, 0.12);
          const radOut = add(scale(fr.right, Math.cos(gAz)), scale(fr.up, Math.sin(gAz)));
          const pedDir = normalize(add(scale(radOut, 0.90), scale(fr.dir, 0.42)));
          const grapeR = baseGrapeR * sizeEnv * sRng.vary(1.0, 0.08);
          const pedLen = grapeR * 1.28;

          const pedStart = addScaled(fr.pos, radOut, stemR * 0.6);
          const pedEnd = addScaled(pedStart, pedDir, pedLen);
          this.emitClosedTube(
            frondsMesh,
            this.curveFromPoints([pedStart, lerpV3(pedStart, pedEnd, 0.5), pedEnd]),
            (t) => lerp1(grapeR * 0.18, grapeR * 0.11, t),
            4,
            () => colStem,
            wFlex,
            0,
            shootPhase,
            0.18,
            p.translucency * 0.8,
          );
          this.stats.bladesOrTentacles++;

          // Glossy translucent spherical "umibudo" sea-grape pearl!
          this.emitClosedOvoid(
            vesiclesMesh,
            addScaled(pedEnd, pedDir, -grapeR * 0.08),
            pedDir,
            grapeR * 2.0,
            grapeR,
            tier >= 3 ? 8 : 6,
            tier >= 3 ? 6 : 4,
            colDeepEmerald,
            mixRgb(colGrapeBase, colGrapePearl, 0.62),
            0.09,
            Math.max(0.78, p.translucency),
            [z, wFlex, shootPhase, 0.02 * p.currentSway * z],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }

      // Terminal apical sea-grape pearl crowning the tip of each raceme!
      const tipFr = stemCurve.atT(1.0);
      const tipR = baseGrapeR * 0.82;
      this.emitClosedOvoid(
        vesiclesMesh,
        addScaled(tipFr.pos, tipFr.dir, -tipR * 0.2),
        tipFr.dir,
        tipR * 2.0,
        tipR,
        tier >= 3 ? 8 : 6,
        tier >= 3 ? 6 : 4,
        colDeepEmerald,
        colGrapePearl,
        0.09,
        Math.max(0.8, p.translucency),
        [1.0, 0.01 + maxStemFlex, shootPhase, 0.02 * p.currentSway],
      );
      this.stats.vesiclesOrPolyps++;
    }
  }

  // ===========================================================================
  // 16. MERMAID'S WINEGLASS (Acetabularia crenulata)
  // ===========================================================================
  private buildMermaidWineglassAcetabularia(
    tier: number,
    holdfastMesh: PartMesh,
    stipeMesh: PartMesh,
    frondsMesh: PartMesh,
    vesiclesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colStalk = hexToLinearRgb(p.hueAccent); // Calcified pearl-mint stalk
    const colCupInner = hexToLinearRgb(p.huePrimary);
    const colCupOuter = hexToLinearRgb(p.hueSecondary);
    const colCorona = hexToLinearRgb(p.huePolyp);

    const nParasols = clamp(Math.round(p.colonyCount), 6, 46);
    const colonyR = Math.min(0.48, 0.15 + 0.011 * nParasols) * p.canopySpread;
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const nRays = tier >= 3 ? 30 : 20; // Radially fused gametangial wedge-rays per wineglass cap!
    const colsTotal = nRays * 2; // Alternating ridge & radial groove!
    const radRings = tier >= 3 ? 7 : 5;

    for (let k = 0; k < nParasols; k++) {
      const kRng = this.rng.fork(0xbd00 + k * 73);
      const az = k * GOLDEN_ANGLE + kRng.range(-0.2, 0.2);
      const rPos = colonyR * Math.sqrt((k + 0.3) / nParasols) * kRng.vary(1.0, 0.14);
      const u = clamp(0.5 + Math.cos(az) * rPos * 0.45, 0.08, 0.92);
      const v = clamp(0.5 + Math.sin(az) * rPos * 0.45, 0.08, 0.92);
      const basePt = this.substrate.sampleSurface(u, v).pos;

      // Tiny calcified lobed rhizoid holdfast pad per single-celled Acetabularia stalk
      this.emitClosedOvoid(
        holdfastMesh,
        add(basePt, v3(0, -0.004, 0)),
        UP,
        0.014,
        0.012,
        6,
        4,
        colHoldfast,
        colStalk,
        0.68,
        0.25,
        [0, 0, this.colonyPhase, 0],
      );

      const stalkH = p.colonyHeight * kRng.vary(0.88, 0.24);
      const phase = (this.colonyPhase + k * 0.003) % 1;
      const outVec = v3(Math.cos(az), 0, Math.sin(az));
      const initDir = normalize(
        add(scale(UP, 0.94), add(scale(outVec, 0.18 * p.canopySpread), scale(currentDir, Math.sin(leanRad) * 0.35))),
      );
      const stalkCurve = growCurve(basePt, initDir, anyPerpendicular(initDir), stalkH, tier >= 3 ? 12 : 8, (t0, t1) => {
        const dt = t1 - t0;
        return {
          pitch: (leanRad * 0.38 + kRng.range(-0.14, 0.18)) * dt,
          yaw: kRng.range(-0.18, 0.18) * dt,
        };
      });

      const stalkR = Math.max(0.0018, stalkH * 0.0065);
      const topFlex = 0.22 * p.currentSway;
      this.emitClosedTube(
        stipeMesh,
        stalkCurve,
        (t) => lerp1(stalkR * 1.25, stalkR * 0.85, t),
        5,
        (t) => mixRgb(colStalk, colCupOuter, t * 0.32),
        0,
        topFlex,
        phase,
        0.38,
        p.translucency * 0.55,
      );
      this.stats.stemsOrTubes++;

      // Radially Pleated Shallowly Cupped Wineglass Parasol Disc (`Acetabularia` cap)!
      const tipFr = stalkCurve.atT(1.0);
      const capR = Math.max(0.028, p.organLength * 0.5 * clamp(p.organWidth / 0.55, 0.65, 1.5) * kRng.vary(1.0, 0.14));
      const cupDepth = capR * (0.24 + 0.24 * p.ruffleWave);

      const posGrid: V3[][] = [];
      const colGrid: RGB[][] = [];
      for (let r = 0; r <= radRings; r++) {
        const rf = r / radRings;
        const rowP: V3[] = [];
        const rowC: RGB[] = [];
        for (let c = 0; c <= colsTotal; c++) {
          const th = (c / colsTotal) * TAU;
          const isGroove = c % 2 === 1;
          // Crenulate notched outer margin + crisp radial wedge-ray pleats!
          const rimNotch = isGroove ? 1 - 0.055 * smoothstep(0.7, 1.0, rf) : 1.0;
          const localR = lerp1(stalkR * 0.9, capR * rimNotch, rf);
          const pleatH = (isGroove ? -1 : 1) * capR * 0.032 * smoothstep(0.12, 0.85, rf) * (1 - 0.35 * rf);
          // Shallow wineglass chalice concavity (`+rf^1.65 * cupDepth`)
          const cupLift = Math.pow(rf, 1.65) * cupDepth + pleatH;
          const radVec = add(scale(tipFr.right, Math.cos(th)), scale(tipFr.up, Math.sin(th)));
          const pt = add(addScaled(tipFr.pos, radVec, localR), scale(tipFr.dir, cupLift));

          let col = mixRgb(colStalk, colCupInner, smoothstep(0.05, 0.48, rf));
          col = mixRgb(col, colCupOuter, smoothstep(0.45, 0.95, rf));
          if (isGroove) col = mixRgb(col, colCupInner, 0.28);
          rowP.push(pt);
          rowC.push(col);
        }
        posGrid.push(rowP);
        colGrid.push(rowC);
      }

      const idxGrid: number[][] = [];
      for (let r = 0; r <= radRings; r++) {
        const rf = r / radRings;
        const rowIds: number[] = [];
        const capFlut = 0.06 * p.currentSway * rf * rf;
        for (let c = 0; c <= colsTotal; c++) {
          const pU0 = posGrid[Math.max(0, r - 1)][c];
          const pU1 = posGrid[Math.min(radRings, r + 1)][c];
          const pV0 = posGrid[r][(c - 1 + colsTotal) % colsTotal];
          const pV1 = posGrid[r][(c + 1) % colsTotal];
          let nrm = cross(sub(pV1, pV0), sub(pU1, pU0));
          nrm = lengthSq(nrm) > 1e-12 ? normalize(nrm) : tipFr.dir;
          const pt = posGrid[r][c];
          rowIds.push(
            frondsMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nrm.x, ny: nrm.y, nz: nrm.z,
              tx: tipFr.right.x, ty: tipFr.right.y, tz: tipFr.right.z,
              u: c / colsTotal, v: rf,
              color: colGrid[r][c],
              wind: [rf, topFlex, phase, capFlut],
              pivot: this.groundOrigin,
              roughness: 0.28,
              translucency: p.translucency,
              detailMetric: rf,
              anatomyLevel: 3,
            }),
          );
        }
        idxGrid.push(rowIds);
      }
      for (let r = 0; r < radRings; r++) {
        for (let c = 0; c < colsTotal; c++) {
          frondsMesh.addQuad(idxGrid[r][c], idxGrid[r][c + 1], idxGrid[r + 1][c + 1], idxGrid[r + 1][c]);
        }
      }
      this.stats.bladesOrTentacles++;

      // Tiny sculpted superior corona ring at the center of the wineglass cup!
      if (p.vesicleAbundance > 0.2) {
        this.emitClosedOvoid(
          vesiclesMesh,
          addScaled(tipFr.pos, tipFr.dir, stalkR * 0.4),
          tipFr.dir,
          capR * 0.14,
          capR * 0.13,
          8,
          5,
          colCupInner,
          colCorona,
          0.25,
          p.translucency * 0.8,
          [1.0, topFlex, phase, 0],
        );
        this.stats.vesiclesOrPolyps++;
      }
    }
    frondsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 17. VELVET STAGHORN WEED / DEAD MAN'S FINGERS (Codium fragile — 2-Manifold!)
  // ===========================================================================
  private buildCodiumDeadMansFingers(
    tier: number,
    thallusMesh: PartMesh,
    utricleMesh: PartMesh,
  ): void {
    const p = this.p;
    const colHoldfast = hexToLinearRgb(p.hueHoldfast);
    const colBottleGreen = hexToLinearRgb(p.huePrimary);
    const colEmeraldTip = hexToLinearRgb(p.hueSecondary);
    const colUtricle = hexToLinearRgb(p.hueAccent);

    const H = Math.max(0.32, p.colonyHeight);
    const baseR = Math.max(0.024, H * 0.044 * clamp(p.organWidth / 0.28, 0.7, 1.55));
    const cfg: WeldedMeshConfig = {
      trunkRadialSegments: tier >= 3 ? 16 : 12,
      minRadialSegments: tier >= 3 ? 8 : 6,
      collarScale: 1.18,
      collarLength: 1.08,
      collarRings: tier >= 3 ? 2 : 1,
      collarFillet: 0.82,
      collarMitre: 0.5,
      minRadius: 0.008,
      capTips: true,
    };

    let nextStemId = 0;
    const allStems: WeldedStem[] = [];
    const codiumFlexGain = 0.24 * p.currentSway;
    const evalCodiumFlex = (pos: V3): number => {
      const h01 = saturate((pos.y - this.groundOrigin.y) / H);
      return smoothstep(0.03, 0.16, h01) * Math.pow(h01, 1.45) * codiumFlexGain;
    };

    const buildCodiumNodes = (origin: V3, dir0: V3, len: number, level: number, seedKey: number): WeldedNode[] => {
      const fRng = this.rng.fork(seedKey);
      const nSegs = level === 0 ? 6 : 8;
      const nodes: WeldedNode[] = [];
      let curPos = clone(origin);
      let curDir = normalize(dir0);
      let right = anyPerpendicular(curDir);
      const step = len / nSegs;
      for (let i = 0; i <= nSegs; i++) {
        nodes.push({ pos: clone(curPos), dir: clone(curDir), right: clone(right), s: i * step });
        if (i < nSegs) {
          curPos = addScaled(curPos, curDir, step);
          if (level > 0) {
            curDir = normalize(
              add(
                curDir,
                v3(fRng.range(-0.04, 0.04), 0.048 * (1 - 0.3 * (i / nSegs)), fRng.range(-0.04, 0.04)),
              ),
            );
            let rProj = projectOnPlane(right, curDir);
            rProj = lengthSq(rProj) < 1e-8 ? anyPerpendicular(curDir) : normalize(rProj);
            right = rProj;
          }
        }
      }
      return nodes;
    };

    const makeCodiumFinger = (
      startPos: V3,
      dir0: V3,
      len: number,
      r0: number,
      r1: number,
      level: number,
      parent: WeldedStem | null,
      attach: WeldedStem['attach'],
      attachS: number,
      isTip: boolean,
      seedKey: number,
    ): WeldedStem => {
      const nodes = buildCodiumNodes(startPos, dir0, len, level, seedKey);
      const realLen = nodes[nodes.length - 1].s;
      const stem: WeldedStem = {
        id: nextStemId++,
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
        ringSpacing: clamp(r0 * 0.48, 0.014, 0.042),
        baseRadiusAt: (sVal: number) => {
          const t = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          // Plump cylindrical "finger" profile with rounded dome apex!
          const rFinger =
            isTip && t > 0.80
              ? r1 * Math.max(0.45, Math.cos(((t - 0.80) / 0.20) * (Math.PI * 0.40)))
              : lerp1(r0, r1, Math.pow(t, 0.75));
          return Math.max(cfg.minRadius, rFinger);
        },
        profileFactor: (sVal: number, th: number) => {
          const z = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          const spongyWave = fbm3(Math.cos(th) * 2.2, z * realLen * 11.0, Math.sin(th) * 2.2, seedKey & 0xffff, 2);
          return 1 + 0.04 * spongyWave;
        },
        styleAt: (sVal: number, _th: number, pos: V3, _dir: V3, isJunc: boolean) => {
          const t = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          const h01 = saturate((pos.y - this.groundOrigin.y) / H);
          const col =
            level === 0
              ? mixRgb(colHoldfast, colBottleGreen, smoothstep(0.1, 0.9, t))
              : mixRgb(colBottleGreen, colEmeraldTip, isTip ? smoothstep(0.42, 1.0, t) * 0.88 : t * 0.35);
          return {
            color: col,
            roughness: 0.84, // Plush matte spongy Codium velvet!
            translucency: p.translucency * 0.72,
            detailMetric: isJunc ? 0.94 : isTip && t > 0.78 ? 0.9 : 0.42,
            anatomyLevel: level + 1,
            wind: [h01, evalCodiumFlex(pos), this.colonyPhase, 0],
            pivot: this.groundOrigin,
          };
        },
        regrow: (newOrigin: V3, newDir: V3) => {
          const rebuilt = buildCodiumNodes(newOrigin, newDir, len, level, seedKey);
          stem.nodes = rebuilt;
          stem.length = rebuilt[rebuilt.length - 1].s;
        },
      };
      allStems.push(stem);
      return stem;
    };

    // Spongy cushion pedestal splitting into plump dichotomous bottle-green cylindrical fingers!
    const pedestalH = H * 0.18;
    const trunk = makeCodiumFinger(
      add(this.groundOrigin, v3(0, -0.015, 0)),
      UP,
      pedestalH,
      baseR * 1.15,
      baseR * 0.92,
      0,
      null,
      'root',
      0,
      false,
      0xc100,
    );

    const nLobes = clamp(Math.round(p.colonyCount), 2, 6);
    const maxOrder = clamp(Math.round(p.branchOrder), 2, 3);
    const topNode = trunk.nodes[trunk.nodes.length - 1];

    for (let b = 0; b < nLobes; b++) {
      const bAz = (b / nLobes) * TAU + this.rng.range(-0.15, 0.15);
      const bOut = v3(Math.cos(bAz), 0, Math.sin(bAz));
      const perp = v3(-bOut.z, 0, bOut.x);
      const bDir = normalize(add(scale(UP, 0.76), scale(bOut, 0.56 * p.canopySpread)));
      const bLen = H * 0.36 * this.rng.vary(1.0, 0.08);
      const rFinger = baseR * 0.56;

      const bough = makeCodiumFinger(
        topNode.pos,
        bDir,
        bLen,
        rFinger,
        rFinger * 0.88,
        1,
        trunk,
        'fork',
        trunk.length,
        false,
        0xc300 + b * 61,
      );
      trunk.forks.push(bough);

      const bEnd = bough.nodes[bough.nodes.length - 1];
      for (const fSign of [-1, 1]) {
        const fDir = normalize(
          add(scale(bEnd.dir, 0.80), add(scale(perp, fSign * 0.44 * p.canopySpread), scale(bOut, 0.18))),
        );
        const fork1 = makeCodiumFinger(
          bEnd.pos,
          fDir,
          H * 0.32 * this.rng.vary(1.0, 0.09),
          rFinger * 0.82,
          rFinger * 0.74,
          2,
          bough,
          'fork',
          bough.length,
          maxOrder < 3,
          0xc500 + b * 73 + (fSign > 0 ? 11 : 3),
        );
        bough.forks.push(fork1);

        if (maxOrder >= 3) {
          const fEnd = fork1.nodes[fork1.nodes.length - 1];
          for (const gSign of [-1, 1]) {
            const gDir = normalize(add(scale(fEnd.dir, 0.82), scale(perp, gSign * 0.38)));
            const tipFinger = makeCodiumFinger(
              fEnd.pos,
              gDir,
              H * 0.24 * this.rng.vary(1.0, 0.08),
              rFinger * 0.68,
              rFinger * 0.62,
              3,
              fork1,
              'fork',
              fork1.length,
              true,
              0xc700 + b * 37 + (fSign > 0 ? 10 : 0) + (gSign > 0 ? 5 : 1),
            );
            fork1.forks.push(tipFinger);
          }
        }
      }
    }

    const wStats = new WeldedMesher(thallusMesh, [trunk], cfg).build();
    const topo = validateWeldedManifold(thallusMesh);
    this.stats.weldedJunctions = wStats.junctions + wStats.forks;
    this.stats.closedManifold = topo.closed && topo.manifold && topo.components === 1;
    this.stats.stemsOrTubes = allStems.length;

    // Frosty translucent utricle velvet micro-clubs clothing the spongy Codium fingers!
    if (p.vesicleAbundance > 0.1) {
      const density = (tier >= 3 ? 68 : 34) * p.vesicleAbundance * p.organDensity;
      const colVelvetTip = mixRgb(colBottleGreen, colUtricle, 0.46);
      for (const st of allStems) {
        if (st.dropped || st.level === 0) continue;
        const nUtricles = Math.max(8, Math.round(st.length * density));
        for (let k = 0; k < nUtricles; k++) {
          const sFrac = lerp1(0.06, 0.95, k / Math.max(1, nUtricles - 1));
          const sPos = st.length * sFrac;
          const smp = sampleWeldedStem(st, sPos);
          const rHere = st.baseRadiusAt(sPos);
          const az = k * GOLDEN_ANGLE + st.id * 0.9;
          const up = cross(smp.dir, smp.right);
          const radVec = normalize(add(scale(smp.right, Math.cos(az)), scale(up, Math.sin(az))));
          const clubLen = clamp(rHere * 0.34, 0.0035, 0.0095);
          const localFlex = evalCodiumFlex(smp.pos);

          this.emitClosedOvoid(
            utricleMesh,
            addScaled(smp.pos, radVec, rHere * 0.88),
            radVec,
            clubLen,
            clubLen * 0.34,
            4,
            4,
            colBottleGreen,
            colVelvetTip,
            0.48,
            0.88,
            [sFrac, localFlex, this.colonyPhase, 0.03 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
  }

  // ===========================================================================
  // 18. FLOWERING COASTAL EELGRASS MEADOW (Zostera marina)
  // ===========================================================================
  private buildEelgrassZostera(
    tier: number,
    rhizomeMesh: PartMesh,
    fertileShootMesh: PartMesh,
    ribbonsMesh: PartMesh,
    spadixMesh: PartMesh,
  ): void {
    const p = this.p;
    const colRhizome = hexToLinearRgb(p.hueHoldfast);
    const colSheath = mixRgb(colRhizome, hexToLinearRgb(p.huePrimary), 0.55);
    const colRibbonBase = hexToLinearRgb(p.huePrimary);
    const colRibbonMid = hexToLinearRgb(p.hueSecondary);
    const colRibbonTip = hexToLinearRgb(p.hueAccent);
    const colSpadix = hexToLinearRgb(p.huePolyp);

    const nTurions = clamp(Math.round(p.colonyCount), 4, 34);
    const meadowR = Math.min(0.68, 0.26 + 0.022 * nTurions) * p.canopySpread;
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;

    const nodes: V3[] = [];
    for (let i = 0; i < nTurions; i++) {
      const tRng = this.rng.fork(0xd100 + i * 71);
      const az = i * GOLDEN_ANGLE + tRng.range(-0.15, 0.15);
      const rDist = meadowR * Math.sqrt((i + 0.35) / nTurions);
      const u = clamp(0.5 + Math.cos(az) * rDist * 0.45, 0.08, 0.92);
      const v = clamp(0.5 + Math.sin(az) * rDist * 0.45, 0.08, 0.92);
      const surf = this.substrate.sampleSurface(u, v).pos;
      const basePt = add(surf, v3(0, 0.008, 0));
      nodes.push(basePt);

      // Basal ligulate leaf sheath clasping each eelgrass shoot bundle
      const sheathH = Math.max(0.055, p.colonyHeight * 0.068);
      const sheathTop = add(basePt, addScaled(scale(UP, sheathH), currentDir, sheathH * 0.18));
      this.emitClosedTube(
        rhizomeMesh,
        this.curveFromPoints([basePt, lerpV3(basePt, sheathTop, 0.5), sheathTop]),
        (t) => lerp1(0.011, 0.0075, t),
        6,
        (t) => mixRgb(colRhizome, colSheath, t),
        0,
        0.02 * p.currentSway,
        this.colonyPhase,
        0.52,
        0.25,
      );
    }

    // Jointed creeping horizontal Zostera rhizomes across rippled sand!
    for (let i = 1; i < nodes.length; i++) {
      let best = 0;
      let bestD2 = Infinity;
      for (let j = 0; j < i; j++) {
        const d2 = lengthSq(sub(nodes[i], nodes[j]));
        if (d2 < bestD2) {
          bestD2 = d2;
          best = j;
        }
      }
      const a = nodes[best];
      const b = nodes[i];
      const mid = lerpV3(a, b, 0.5);
      const mSurf = this.substrate.sampleSurface(
        clamp(0.5 + (mid.x - this.groundOrigin.x) * 0.45, 0.08, 0.92),
        clamp(0.5 + (mid.z - this.groundOrigin.z) * 0.45, 0.08, 0.92),
      ).pos;
      this.emitClosedTube(
        rhizomeMesh,
        this.curveFromPoints([a, v3(mid.x, Math.max(mSurf.y + 0.007, (a.y + b.y) * 0.5), mid.z), b]),
        () => 0.0065,
        6,
        () => colRhizome,
        0,
        0,
        this.colonyPhase,
        0.62,
        0.15,
      );
    }

    // Long, ultra-supple jade-teal Zostera ribbon blades + fertile underwater flowering shoots!
    const bladesPerShoot = clamp(Math.round((tier >= 3 ? 6 : 4) * p.organDensity), 3, 9);
    for (let i = 0; i < nodes.length; i++) {
      const sRng = this.rng.fork(0xd500 + i * 89);
      const basePt = nodes[i];
      const shootPhase = (this.colonyPhase + i * 0.004) % 1;
      const sheathH = Math.max(0.055, p.colonyHeight * 0.068);
      const emergeOrigin = add(basePt, addScaled(scale(UP, sheathH * 0.92), currentDir, sheathH * 0.16));
      const sheathFlex = 0.02 * p.currentSway;

      for (let b = 0; b < bladesPerShoot; b++) {
        const bFrac = (b / Math.max(1, bladesPerShoot - 1)) * 2 - 1;
        const spreadSide = v3(-currentDir.z, 0, currentDir.x);
        const dir0 = normalize(
          add(
            scale(UP, Math.cos(leanRad * 0.78)),
            add(
              scale(currentDir, Math.sin(leanRad * 0.78) + 0.18 * Math.abs(bFrac)),
              scale(spreadSide, bFrac * 0.24 + sRng.range(-0.08, 0.08)),
            ),
          ),
        );
        const ribLen = p.organLength * (0.78 + 0.34 * (1 - 0.45 * Math.abs(bFrac))) * sRng.vary(1.0, 0.14);
        const ribHalfW = Math.max(0.0045, ribLen * clamp(p.organWidth, 0.03, 0.16) * 0.12);

        this.emitFlowingEelgrassRibbon(
          ribbonsMesh,
          emergeOrigin,
          dir0,
          ribLen,
          ribHalfW,
          tier >= 3 ? 18 : 11,
          colRibbonBase,
          colRibbonMid,
          colRibbonTip,
          sheathFlex,
          0.32 * p.currentSway,
          0.26 * p.currentSway,
          shootPhase,
          sRng.range(0, TAU),
          leanRad,
        );
        this.stats.bladesOrTentacles++;
      }

      // Erect fertile flowering reproductive stem with flattened spathes & underwater spadix seeds!
      if (p.vesicleAbundance > 0.2 && i % 3 === 1) {
        const shootH = p.colonyHeight * 0.78 * sRng.vary(1.0, 0.1);
        const fCurve = growCurve(
          emergeOrigin,
          normalize(add(scale(UP, 0.86), scale(currentDir, Math.sin(leanRad) * 0.65))),
          anyPerpendicular(UP),
          shootH,
          tier >= 3 ? 12 : 8,
          (t0, t1) => ({ pitch: leanRad * 0.55 * (t1 - t0), yaw: sRng.range(-0.15, 0.15) * (t1 - t0) }),
        );
        const fTopFlex = 0.26 * p.currentSway;
        this.emitClosedTube(
          fertileShootMesh,
          fCurve,
          (t) => lerp1(0.0042, 0.0022, t),
          5,
          (t) => mixRgb(colRibbonBase, colRibbonTip, t * 0.7),
          sheathFlex,
          fTopFlex,
          shootPhase,
          0.28,
          p.translucency * 0.6,
        );
        this.stats.stemsOrTubes++;

        // 3 fertile spathe clusters bearing rows of pale chartreuse-cream underwater Zostera seeds!
        for (const spT of [0.48, 0.72, 0.92]) {
          const spFr = fCurve.atT(spT);
          const spFlex = sheathFlex + fTopFlex * spT;
          for (let sd = 0; sd < 4; sd++) {
            const seedPos = add(
              addScaled(spFr.pos, spFr.dir, (sd - 1.5) * 0.014),
              scale(spFr.up, 0.005),
            );
            this.emitClosedOvoid(
              spadixMesh,
              seedPos,
              spFr.dir,
              0.013,
              0.0045,
              5,
              4,
              colRibbonTip,
              colSpadix,
              0.24,
              0.68,
              [spT, spFlex, shootPhase, 0],
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
      }
    }
    ribbonsMesh.hasExplicitNormals = true;
  }

  private emitFlowingEelgrassRibbon(
    mesh: PartMesh,
    origin: V3,
    dir0: V3,
    length: number,
    halfWidth: number,
    uSegs: number,
    colBase: RGB,
    colMid: RGB,
    colTip: RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
    waveSeed: number,
    leanRad: number,
  ): void {
    let right = projectOnPlane(v3(-dir0.z, 0, dir0.x), dir0);
    if (lengthSq(right) < 1e-6) right = anyPerpendicular(dir0);
    right = normalize(right);

    const spine = growCurve(origin, dir0, right, length, uSegs, (t0, t1) => {
      const dt = t1 - t0;
      const streamArch = (-(0.55 + 0.65 * Math.sin(leanRad)) * smoothstep(0.15, 0.85, t1) + Math.sin(t1 * TAU * 1.15 + waveSeed) * 0.28) * dt;
      return { pitch: streamArch, yaw: Math.cos(t1 * Math.PI * 1.4 + waveSeed) * 0.16 * dt };
    });

    const vCols = 2; // 3-column smooth parallel-veined ribbon with obtuse rounded Zostera apex!
    const idxGrid: number[][] = [];
    for (let i = 0; i <= uSegs; i++) {
      const fr = spine.frameAtIndex(i);
      const u = fr.t;
      // Uniform ribbon width rounding gently only at the obtuse Zostera leaf tip (`u > 0.88`)!
      const tipRound = u > 0.88 ? Math.cos(((u - 0.88) / 0.12) * (Math.PI * 0.44)) : 1.0;
      const wHere = Math.max(0.0015, halfWidth * tipRound);
      const flex = attachFlex + extraFlex * Math.pow(u, 1.38);
      const flut = maxFlutter * u * u;
      const rowIds: number[] = [];

      for (let c = 0; c <= vCols; c++) {
        const vSym = (c / vCols) * 2 - 1;
        const veinCrown = c === 1 ? wHere * 0.12 : 0;
        const pt = add(addScaled(fr.pos, fr.right, vSym * wHere), scale(fr.up, veinCrown));
        let col = mixRgb(colBase, colMid, smoothstep(0.08, 0.55, u));
        col = mixRgb(col, colTip, smoothstep(0.62, 1.0, u) * 0.72);
        rowIds.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: fr.up.x, ny: fr.up.y, nz: fr.up.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
            u: c / vCols, v: u,
            color: col,
            wind: [u, flex, phase, flut],
            pivot: this.groundOrigin,
            roughness: 0.24,
            translucency: this.p.translucency,
            detailMetric: u,
            anatomyLevel: 3,
          }),
        );
      }
      idxGrid.push(rowIds);
    }
    for (let i = 0; i < uSegs; i++) {
      for (let c = 0; c < vCols; c++) {
        mesh.addQuad(idxGrid[i][c], idxGrid[i][c + 1], idxGrid[i + 1][c + 1], idxGrid[i + 1][c]);
      }
    }
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

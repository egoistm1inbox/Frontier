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

    const isWeldedCoral = p.species === 'staghorn_coral' || p.species === 'elkhorn_coral_palmata';
    const isCoral =
      isWeldedCoral ||
      p.species === 'table_coral_acropora' ||
      p.species === 'brain_coral_diploria' ||
      p.species === 'whorled_scroll_montipora' ||
      p.species === 'pillar_coral_dendrogyra' ||
      p.species === 'bubble_coral_plerogyra' ||
      p.species === 'sun_cup_tubastraea' ||
      p.species === 'organ_pipe_tubipora' ||
      p.species === 'carnation_tree_dendronephthya' ||
      p.species === 'biolum_sea_pen_pennatula';
    const isCodium = p.species === 'codium_dead_mans_fingers';
    const isFan = p.species === 'gorgonian_sea_fan';
    const isAnyAnemone =
      p.species === 'sea_anemone' ||
      p.species === 'magnificent_ritteri_anemone' ||
      p.species === 'giant_carpet_anemone' ||
      p.species === 'tube_dwelling_cerianthus' ||
      p.species === 'corkscrew_anemone' ||
      p.species === 'rock_flower_anemone' ||
      p.species === 'plumose_frilled_anemone' ||
      p.species === 'strawberry_beadlet_anemone';
    const isSponge = p.species === 'azure_tube_sponge';
    const isCrinoid = p.species === 'feather_star_crinoid';

    const holdfastName = isWeldedCoral
      ? 'Welded Calcified Antler Skeleton'
      : p.species === 'brain_coral_diploria'
        ? 'Meandering Labyrinth Corallum Dome'
        : p.species === 'table_coral_acropora'
          ? 'Calcified Reef Table Pedestal'
          : p.species === 'whorled_scroll_montipora'
            ? 'Basal Coenosteum & Inner Chalice'
            : p.species === 'pillar_coral_dendrogyra'
              ? 'Encrusting Reef Pavement Base'
              : p.species === 'organ_pipe_tubipora'
                ? 'Crimson Calcified Organ-Pipe Tubes'
                : p.species === 'carnation_tree_dendronephthya'
                  ? 'Translucent Hydrostatic Coral Trunk'
                  : p.species === 'biolum_sea_pen_pennatula'
                    ? 'Muscular Sand-Anchored Peduncle'
                    : isCoral
                      ? 'Calcified Basal Corallum'
                      : isCodium
                        ? 'Welded Dichotomous Velvet Thallus'
                        : isSponge
                          ? 'Hollow Organ-Pipe Chimney Walls'
                          : p.species === 'tube_dwelling_cerianthus'
                            ? 'Parchment Mucous-Sand Dwelling Tubes'
                            : p.species === 'giant_carpet_anemone'
                              ? 'Saddle-Folded Oral Carpet & Pedal Foot'
                              : p.species === 'rock_flower_anemone'
                                ? 'Radially Striped Rainbow Oral Discs'
                                : p.species === 'strawberry_beadlet_anemone'
                                  ? 'Spotted Strawberry Barrel Columns'
                                  : isAnyAnemone
                                    ? 'Muscular Pedal Column & Oral Disc'
                                    : isCrinoid
                                      ? 'Pentagonal Calyx & Grasping Cirri'
                                      : p.species === 'neptune_seagrass' || p.species === 'eelgrass_zostera'
                                        ? 'Creeping Rhizomes & Basal Sheaths'
                                        : p.species === 'sea_grapes_caulerpa'
                                          ? 'Creeping Emerald Stolons & Rhizoids'
                                          : 'Haptera Holdfast & Basal Foot';

    const stipeName = isFan
      ? 'Flabellate Ribs & Reticulate Lattice'
      : p.species === 'table_coral_acropora'
        ? 'Cantilevered Tabulate Coral Plates'
        : p.species === 'pillar_coral_dendrogyra'
          ? 'Cathedral Cylindrical Coral Spires'
          : p.species === 'sun_cup_tubastraea' || p.species === 'bubble_coral_plerogyra'
            ? 'Septate Tubular Corallite Calyces'
            : p.species === 'organ_pipe_tubipora'
              ? 'Horizontal Crimson Stolon Decks'
              : p.species === 'carnation_tree_dendronephthya'
                ? 'Sclerite-Laced Soft Coral Branches'
                : p.species === 'biolum_sea_pen_pennatula'
                  ? 'Central Axial Rachis Quill'
                  : isCrinoid
                    ? 'Segmented Brachial Arms'
                    : p.species === 'plumose_frilled_anemone'
                      ? 'Ruffled Cauliflower Oral Crown Lobes'
                      : isAnyAnemone
                        ? 'Pleated Actinopharynx Oral Cone'
                        : p.species === 'sea_palm_postelsia'
                          ? 'Fluted Rubbery Sea-Palm Trunks'
                          : p.species === 'mermaid_wineglass_acetabularia'
                            ? 'Calcified Hair-Slender Stalks'
                            : p.species === 'eelgrass_zostera'
                              ? 'Fertile Flowering Spathe Shoots'
                              : 'Buoyant Stipes & Thallus Axes';

    const frondsName = p.species === 'whorled_scroll_montipora'
      ? 'Spiral Rose-Scroll Calcified Whorls'
      : p.species === 'pillar_coral_dendrogyra'
        ? 'Shaggy Daylight Polyp Tentacle Coat'
        : p.species === 'sun_cup_tubastraea'
          ? 'Solar Starburst Feeding Tentacles'
          : p.species === 'organ_pipe_tubipora'
            ? '8-Rayed Pinnate Starburst Tentacles'
            : p.species === 'carnation_tree_dendronephthya'
              ? 'Umbel Floret Branchlet Stalks'
              : p.species === 'bubble_coral_plerogyra'
                ? 'Sweeper Tentacles'
                : p.species === 'table_coral_acropora'
                  ? 'Anastomosing Plate Branchlets'
                  : p.species === 'biolum_sea_pen_pennatula'
                    ? 'Falcate Feather Polyp Pinnae'
                    : p.species === 'sea_anemone'
                      ? '3D Bubble-Tip Tentacles'
                      : p.species === 'magnificent_ritteri_anemone'
                        ? 'Digitiform Gold-Tipped Tentacles'
                        : p.species === 'giant_carpet_anemone'
                          ? 'Velvet Capitate Carpet Micro-Tentacles'
                          : p.species === 'tube_dwelling_cerianthus'
                            ? 'Cascading Firework Marginal Tentacles'
                            : p.species === 'corkscrew_anemone'
                              ? '3D Helical Corkscrew Tentacles'
                              : p.species === 'rock_flower_anemone'
                                ? 'Beaded Perimeter Fringe Skirt'
                                : p.species === 'plumose_frilled_anemone'
                                  ? 'Feathery Plumose Cloud Filaments'
                                  : p.species === 'strawberry_beadlet_anemone'
                                    ? 'Glossy Ruby Tapered Tentacles'
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

    const vesiclesName = p.species === 'bubble_coral_plerogyra'
      ? 'Opalescent Daytime Pearl Vesicles'
      : p.species === 'carnation_tree_dendronephthya'
        ? 'Glowing Floret Polyp Clusters & Sclerites'
        : p.species === 'biolum_sea_pen_pennatula'
          ? 'Bioluminescent Autozooid Polyp Fringe'
          : isCoral || isFan
            ? '3D Corallite Cups & Reef Polyps'
            : isCodium
              ? 'Frosty Translucent Utricle Velvet'
              : isSponge
                ? 'Thorny Spicule Conules'
                : p.species === 'tube_dwelling_cerianthus'
                  ? 'Central Labial Tentacle Tuft'
                  : p.species === 'strawberry_beadlet_anemone'
                    ? 'Sapphire Acrorhagi Fighting Beads'
                    : p.species === 'rock_flower_anemone'
                      ? 'Discal Beaded Flower Papillae'
                      : isAnyAnemone
                        ? 'Column Verrucae & Nematocyst Rings'
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
      case 'elkhorn_coral_palmata':
        this.buildElkhornCoralPalmata(tier, holdfastMesh, vesiclesMesh);
        break;
      case 'table_coral_acropora':
        this.buildTableCoralAcropora(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'brain_coral_diploria':
        this.buildBrainCoralDiploria(tier, holdfastMesh, stipeMesh, vesiclesMesh);
        break;
      case 'whorled_scroll_montipora':
        this.buildWhorledScrollMontipora(tier, holdfastMesh, frondsMesh, vesiclesMesh);
        break;
      case 'pillar_coral_dendrogyra':
        this.buildPillarCoralDendrogyra(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'bubble_coral_plerogyra':
        this.buildBubbleCoralPlerogyra(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'sun_cup_tubastraea':
        this.buildSunCupTubastraea(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'organ_pipe_tubipora':
        this.buildOrganPipeTubipora(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'carnation_tree_dendronephthya':
        this.buildCarnationTreeDendronephthya(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'gorgonian_sea_fan':
        this.buildGorgonianSeaFan(tier, holdfastMesh, stipeMesh, vesiclesMesh);
        break;
      case 'biolum_sea_pen_pennatula':
        this.buildBiolumSeaPenPennatula(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'sea_anemone':
        this.buildSeaAnemone(tier, holdfastMesh, frondsMesh);
        break;
      case 'magnificent_ritteri_anemone':
        this.buildMagnificentRitteriAnemone(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'giant_carpet_anemone':
        this.buildGiantCarpetAnemone(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'tube_dwelling_cerianthus':
        this.buildTubeDwellingCerianthus(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'corkscrew_anemone':
        this.buildCorkscrewAnemone(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'rock_flower_anemone':
        this.buildRockFlowerAnemone(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'plumose_frilled_anemone':
        this.buildPlumoseFrilledAnemone(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'strawberry_beadlet_anemone':
        this.buildStrawberryBeadletAnemone(tier, holdfastMesh, stipeMesh, frondsMesh, vesiclesMesh);
        break;
      case 'azure_tube_sponge':
        this.buildAzureTubeSponge(tier, holdfastMesh, vesiclesMesh);
        break;
      case 'feather_star_crinoid':
        this.buildFeatherStarCrinoid(tier, holdfastMesh, stipeMesh, frondsMesh);
        break;
    }

    holdfastMesh.metaLabel = isWeldedCoral || isCodium
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
      this.stats.vesiclesOrPolyps++;
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
  // 19. MAGNIFICENT RITTERI SEA ANEMONE (Radianthus / Heteractis magnifica)
  // ===========================================================================
  private buildMagnificentRitteriAnemone(
    tier: number,
    columnMesh: PartMesh,
    mouthMesh: PartMesh,
    tentaclesMesh: PartMesh,
    verrucaeMesh: PartMesh,
  ): void {
    const p = this.p;
    const colColumn = hexToLinearRgb(p.hueHoldfast); // Vivid magenta-violet column!
    const colTentBase = hexToLinearRgb(p.huePrimary);
    const colTentShaft = hexToLinearRgb(p.hueSecondary);
    const colGoldTip = hexToLinearRgb(p.hueAccent); // Glowing chartreuse/gold blunt tips!
    const colVerrucae = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.28, p.colonyHeight);
    const colH = H * 0.52;
    const discR = Math.max(0.16, H * 0.44 * p.canopySpread);
    const discFlex = 0.09 * p.currentSway;

    // 1. Tall Showpiece Flared Magenta Column + Undulating Lobed Oral Disc!
    const uCols = tier >= 3 ? 44 : 30;
    const vRows = tier >= 3 ? 22 : 15;
    const posGrid: V3[][] = [];
    const colGrid: RGB[][] = [];
    const windGrid: [number, number, number, number][][] = [];

    for (let r = 0; r <= vRows; r++) {
      const v = r / vRows;
      const rowFlex = v <= 0.68 ? Math.pow(v / 0.68, 1.4) * discFlex : discFlex;
      const pRow: V3[] = [];
      const cRow: RGB[] = [];
      const wRow: [number, number, number, number][] = [];

      for (let c = 0; c <= uCols; c++) {
        const th = (c / uCols) * TAU;
        const lobeWave = (Math.sin(th * 6 + 0.5) * 0.14 + Math.cos(th * 11 - 0.8) * 0.05) * p.ruffleWave;
        let rad: number;
        let y: number;
        let col: RGB;

        if (v <= 0.68) {
          const tC = v / 0.68;
          // Muscular chalice trunk narrow at waist, flaring dramatically to show off the magenta column!
          const chalice = 0.44 - 0.06 * Math.sin(tC * Math.PI) + 0.62 * Math.pow(tC, 2.0);
          const flute = 1 + 0.028 * Math.cos(th * 24) * smoothstep(0.15, 0.95, tC);
          rad = discR * chalice * flute * (1 + lobeWave * smoothstep(0.42, 1.0, tC));
          y = colH * tC + discR * lobeWave * 0.28 * smoothstep(0.5, 1.0, tC);
          col = mixRgb(
            mixRgb(colColumn, hexToLinearRgb('#2b0824'), 0.35),
            colColumn,
            smoothstep(0.08, 0.72, tC),
          );
          if (tC > 0.88) col = mixRgb(col, colTentBase, smoothstep(0.88, 1.0, tC) * 0.45);
        } else {
          const tD = (v - 0.68) / 0.32;
          rad = lerp1(discR * (1 + lobeWave), discR * 0.08, Math.pow(tD, 0.9));
          y = colH + discR * lobeWave * 0.28 * (1 - tD) - colH * 0.06 * tD;
          col = mixRgb(colTentBase, colColumn, 0.32 * (1 - tD));
        }

        pRow.push(add(this.groundOrigin, v3(Math.cos(th) * rad, Math.max(0, y), Math.sin(th) * rad)));
        cRow.push(col);
        wRow.push([v, rowFlex, this.colonyPhase, 0]);
      }
      posGrid.push(pRow);
      colGrid.push(cRow);
      windGrid.push(wRow);
    }

    this.emitSurfaceGrid(columnMesh, posGrid, colGrid, windGrid, 0.26, p.translucency * 0.55);
    this.stats.stemsOrTubes = 1;

    // Raised pleated central actinopharynx oral cone (`stipeMesh`)
    this.emitPleatedOralCone(
      mouthMesh,
      add(this.groundOrigin, v3(0, colH - colH * 0.05, 0)),
      discR * 0.11,
      colH * 0.08,
      mixRgb(colColumn, colGoldTip, 0.45),
      colVerrucae,
      discFlex,
      this.colonyPhase,
    );

    // Longitudinal rows of pearly pink adhesive verrucae dotting the upper magenta column!
    if (p.vesicleAbundance > 0.15) {
      const nColsV = 24;
      for (let vc = 0; vc < nColsV; vc++) {
        const th = (vc / nColsV) * TAU;
        const lobeWave = (Math.sin(th * 6 + 0.5) * 0.14 + Math.cos(th * 11 - 0.8) * 0.05) * p.ruffleWave;
        for (let vr = 0; vr < 5; vr++) {
          const tC = lerp1(0.46, 0.92, vr / 4);
          const chalice = 0.44 - 0.06 * Math.sin(tC * Math.PI) + 0.62 * Math.pow(tC, 2.0);
          const rad = discR * chalice * (1 + lobeWave * smoothstep(0.42, 1.0, tC));
          const y = colH * tC + discR * lobeWave * 0.28 * smoothstep(0.5, 1.0, tC);
          const normOut = normalize(v3(Math.cos(th), 0.25, Math.sin(th)));
          const pt = add(this.groundOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad));
          const flexV = Math.pow(tC, 1.4) * discFlex;
          this.emitClosedOvoid(
            verrucaeMesh,
            addScaled(pt, normOut, -0.002),
            normOut,
            discR * 0.028,
            discR * 0.018,
            5,
            4,
            colColumn,
            colVerrucae,
            0.22,
            0.65,
            [tC, flexV, this.colonyPhase, 0],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }

    // 2. Dense Crown of Uniform Digitiform (Finger-Shaped) Gold-Tipped Tentacles!
    const nRings = clamp(Math.round(p.colonyCount), 3, 9);
    const totalTent = Math.max(64, Math.round((tier >= 3 ? 168 : 96) * p.organDensity * (nRings / 6)));
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanSin = Math.sin(p.currentLeanDeg * DEG2RAD);

    for (let tIdx = 0; tIdx < totalTent; tIdx++) {
      const tRng = this.rng.fork(0xe100 + tIdx * 71);
      const frac = (tIdx + 0.5) / totalTent;
      const rDiscFrac = lerp1(0.16, 0.92, Math.sqrt(frac));
      const az = tIdx * GOLDEN_ANGLE + tRng.range(-0.06, 0.06);
      const lobeWave = (Math.sin(az * 6 + 0.5) * 0.14 + Math.cos(az * 11 - 0.8) * 0.05) * p.ruffleWave;

      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const attachR = discR * rDiscFrac * (1 + lobeWave * rDiscFrac);
      const attachY = colH + discR * lobeWave * 0.28 * rDiscFrac - colH * 0.04 * (1 - rDiscFrac);
      const basePos = add(this.groundOrigin, addScaled(v3(0, attachY, 0), radDir, attachR));

      const tentLen = p.organLength * (0.76 + 0.34 * Math.sin(Math.PI * (0.2 + 0.65 * frac))) * tRng.vary(1.0, 0.1);
      const fingerR = Math.max(0.0055, tentLen * clamp(p.organWidth, 0.06, 0.35) * 0.16);
      const elev = lerp1(84, 34, frac) * DEG2RAD + tRng.range(-0.08, 0.08);
      const emergeDir = normalize(
        add(scale(radDir, Math.cos(elev)), add(scale(UP, Math.sin(elev)), scale(currentDir, leanSin * 0.42))),
      );

      const waveBend = tRng.range(-0.28, 0.36);
      const swirl = tRng.range(-0.32, 0.32);
      const tentCurve = growCurve(basePos, emergeDir, anyPerpendicular(emergeDir), tentLen, tier >= 3 ? 12 : 8, (t0, t1) => {
        const dt = t1 - t0;
        return {
          pitch: (waveBend + Math.sin(t1 * Math.PI * 1.4) * 0.24) * dt,
          yaw: swirl * Math.cos(t1 * Math.PI) * dt,
        };
      });

      const tentPhase = (this.colonyPhase + ((az / TAU) % 1) * 0.02) % 1;
      this.emitCappedTentacleTube(
        tentaclesMesh,
        tentCurve,
        tier >= 3 ? 7 : 5,
        (u) => {
          // Uniform sleek cylindrical finger tapering only at the rounded blunt apex (`u > 0.86`)!
          const shaft = 1 - 0.16 * u;
          const dome = u > 0.86 ? Math.cos(((u - 0.86) / 0.14) * (Math.PI * 0.44)) : 1.0;
          return Math.max(0.0012, fingerR * shaft * dome);
        },
        (u) => {
          const shaftCol = mixRgb(colTentBase, colTentShaft, smoothstep(0.12, 0.78, u));
          return mixRgb(shaftCol, colGoldTip, smoothstep(0.80, 0.96, u));
        },
        discFlex,
        0.22 * p.currentSway,
        0.24 * p.currentSway,
        tentPhase,
        0.15,
        p.translucency,
      );
      this.stats.bladesOrTentacles++;
    }
    columnMesh.hasExplicitNormals = true;
    tentaclesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 20. GIANT SADDLE-FOLDED CARPET ANEMONE (Stichodactyla gigantea / haddoni)
  // ===========================================================================
  private buildGiantCarpetAnemone(
    tier: number,
    carpetMesh: PartMesh,
    mouthMesh: PartMesh,
    microTentMesh: PartMesh,
    verrucaeMesh: PartMesh,
  ): void {
    const p = this.p;
    const colFoot = hexToLinearRgb(p.hueHoldfast);
    const colDiscDeep = hexToLinearRgb(p.huePrimary);
    const colCapitate = hexToLinearRgb(p.hueSecondary);
    const colNeonTip = hexToLinearRgb(p.hueAccent);
    const colMouth = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.24, p.colonyHeight);
    const stalkH = H * 0.34;
    const carpetR = Math.max(0.28, p.organLength * 1.05 * p.canopySpread);
    const maxDiscFlex = 0.11 * p.currentSway;

    // Shared analytical saddle-fold field so disc & 1,000+ velvet micro-tentacles match to 0.000 mm!
    const evalCarpetFold = (rFrac: number, th: number): { rad: number; y: number; flex: number } => {
      const saddle =
        (Math.sin(th * 5 + 0.3) * 0.24 + Math.cos(th * 9 - 0.9) * 0.11 + Math.sin(th * 13 + 1.7) * 0.05) *
        p.ruffleWave;
      const radLobe = 1 + (Math.cos(th * 5 + 0.3) * 0.14 + Math.sin(th * 7) * 0.06) * p.ruffleWave * smoothstep(0.25, 1.0, rFrac);
      const rad = carpetR * rFrac * radLobe;
      const dish = -carpetR * 0.12 * (1 - rFrac * rFrac);
      const foldY = carpetR * saddle * Math.pow(rFrac, 1.55);
      const y = Math.max(0.015, stalkH + dish + foldY);
      const flex = (0.02 + 0.88 * Math.pow(rFrac, 1.5)) * maxDiscFlex;
      return { rad, y, flex };
    };

    // 1. Short flared pedal column + expansive hyperbolic saddle-folded oral carpet!
    const uCols = tier >= 3 ? 96 : 56;
    const vRows = tier >= 3 ? 28 : 18;
    const posGrid: V3[][] = [];
    const colGrid: RGB[][] = [];
    const windGrid: [number, number, number, number][][] = [];

    for (let r = 0; r <= vRows; r++) {
      const v = r / vRows;
      const pRow: V3[] = [];
      const cRow: RGB[] = [];
      const wRow: [number, number, number, number][] = [];

      for (let c = 0; c <= uCols; c++) {
        const th = (c / uCols) * TAU;
        if (v < 0.28) {
          // Short hidden muscular column supporting the broad saddle-folded oral disc
          const tC = v / 0.28;
          const rim = evalCarpetFold(1.0, th);
          const rad = lerp1(carpetR * 0.32, rim.rad, Math.pow(tC, 1.65));
          const y = lerp1(0, rim.y, tC);
          const flex = lerp1(0, rim.flex, tC);
          pRow.push(add(this.groundOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
          cRow.push(mixRgb(colFoot, colDiscDeep, smoothstep(0.2, 1.0, tC)));
          wRow.push([v, flex, this.colonyPhase, 0]);
        } else {
          // Oral disc surface from outer curtain rim (`v = 0.28 -> rFrac = 1`) inward to central mouth (`v = 1 -> rFrac = 0.04`)!
          const rFrac = lerp1(1.0, 0.04, (v - 0.28) / 0.72);
          const smp = evalCarpetFold(rFrac, th);
          const radStripe = 0.5 + 0.5 * Math.cos(th * 36);
          let col = mixRgb(colDiscDeep, colCapitate, 0.25 * radStripe);
          if (rFrac < 0.22) {
            col = mixRgb(col, colMouth, smoothstep(0.22, 0.05, rFrac) * 0.85);
          }
          pRow.push(add(this.groundOrigin, v3(Math.cos(th) * smp.rad, smp.y, Math.sin(th) * smp.rad)));
          cRow.push(col);
          wRow.push([rFrac, smp.flex, this.colonyPhase, 0]);
        }
      }
      posGrid.push(pRow);
      colGrid.push(cRow);
      windGrid.push(wRow);
    }

    this.emitSurfaceGrid(carpetMesh, posGrid, colGrid, windGrid, 0.30, p.translucency * 0.5);
    this.stats.stemsOrTubes = 1;

    // Bare pleated central mouth slit (`stipeMesh`)
    const centerSmp = evalCarpetFold(0.05, 0);
    this.emitPleatedOralCone(
      mouthMesh,
      add(this.groundOrigin, v3(0, centerSmp.y - 0.005, 0)),
      carpetR * 0.14,
      carpetR * 0.045,
      colDiscDeep,
      colMouth,
      centerSmp.flex,
      this.colonyPhase,
    );

    // 2. Dense Velvet Carpet of 1,000-1,400 Stubby Capitate Micro-Tentacles across every saddle fold!
    const nCarpetTent = Math.max(340, Math.round((tier >= 3 ? 1180 : 560) * p.organDensity));
    const beadLen = clamp(carpetR * 0.064 * (0.75 + 0.35 * (p.organWidth / 0.28)), 0.014, 0.040);
    const beadRad = beadLen * 0.37;

    for (let k = 0; k < nCarpetTent; k++) {
      const kRng = this.rng.fork(0xe500 + k * 41);
      const frac = (k + 0.5) / nCarpetTent;
      const rFrac = lerp1(0.20, 0.97, Math.sqrt(frac));
      const th = k * GOLDEN_ANGLE + kRng.range(-0.025, 0.025);

      const s0 = evalCarpetFold(rFrac, th);
      const sR = evalCarpetFold(Math.min(1, rFrac + 0.02), th);
      const sT = evalCarpetFold(rFrac, th + 0.03);
      const p0 = add(this.groundOrigin, v3(Math.cos(th) * s0.rad, s0.y, Math.sin(th) * s0.rad));
      const pR = add(this.groundOrigin, v3(Math.cos(th) * sR.rad, sR.y, Math.sin(th) * sR.rad));
      const pT = add(this.groundOrigin, v3(Math.cos(th + 0.03) * sT.rad, sT.y, Math.sin(th + 0.03) * sT.rad));

      let surfNrm = cross(sub(pT, p0), sub(pR, p0));
      surfNrm = lengthSq(surfNrm) > 1e-12 ? normalize(surfNrm) : UP;
      if (surfNrm.y < 0) surfNrm = scale(surfNrm, -1);
      const dir = normalize(add(scale(surfNrm, 0.85), scale(UP, 0.25)));

      const localLen = beadLen * kRng.vary(1.0, 0.14);
      const tipCol = k % 5 === 0 ? colNeonTip : mixRgb(colCapitate, colNeonTip, smoothstep(0.4, 0.98, rFrac) * 0.58);
      this.emitClosedOvoid(
        microTentMesh,
        addScaled(p0, dir, -localLen * 0.15),
        dir,
        localLen,
        beadRad * kRng.vary(1.0, 0.12),
        tier >= 3 ? 6 : 5,
        tier >= 3 ? 5 : 4,
        colDiscDeep,
        tipCol,
        0.18,
        p.translucency,
        [rFrac, s0.flex, this.colonyPhase, 0.04 * p.currentSway * rFrac],
      );
      this.stats.bladesOrTentacles++;
    }

    // Underside column verrucae warts along outer curtain folds (`vesiclesMesh`)
    if (p.vesicleAbundance > 0.2) {
      for (let m = 0; m < 32; m++) {
        const th = (m / 32) * TAU;
        const rim = evalCarpetFold(0.92, th);
        const pt = add(this.groundOrigin, v3(Math.cos(th) * rim.rad * 0.86, rim.y * 0.65, Math.sin(th) * rim.rad * 0.86));
        const out = normalize(v3(Math.cos(th), -0.25, Math.sin(th)));
        this.emitClosedOvoid(
          verrucaeMesh,
          pt,
          out,
          0.014,
          0.008,
          5,
          4,
          colFoot,
          colNeonTip,
          0.4,
          0.45,
          [0.65, rim.flex * 0.65, this.colonyPhase, 0],
        );
        this.stats.vesiclesOrPolyps++;
      }
    }
    carpetMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 21. SPIRAL TUBE-DWELLING FIREWORK ANEMONE (Cerianthus membranaceus)
  // ===========================================================================
  private buildTubeDwellingCerianthus(
    tier: number,
    tubeMesh: PartMesh,
    oralConeMesh: PartMesh,
    marginalMesh: PartMesh,
    labialMesh: PartMesh,
  ): void {
    const p = this.p;
    const colTubeBase = hexToLinearRgb(p.hueHoldfast);
    const colTubeRim = mixRgb(colTubeBase, hexToLinearRgb('#7a6258'), 0.48);
    const colOuterBase = hexToLinearRgb(p.huePrimary);
    const colOuterMid = hexToLinearRgb(p.hueSecondary);
    const colOuterTip = hexToLinearRgb(p.hueAccent);
    const colLabial = hexToLinearRgb(p.huePolyp);

    const nTubes = clamp(Math.round(p.colonyCount), 1, 6);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const patchR = nTubes === 1 ? 0 : Math.min(0.40, 0.15 + 0.05 * nTubes) * p.canopySpread;

    for (let idx = 0; idx < nTubes; idx++) {
      const cRng = this.rng.fork(0xe900 + idx * 113);
      const az = idx * GOLDEN_ANGLE + cRng.range(-0.2, 0.2);
      const dist = idx === 0 ? 0 : patchR * Math.sqrt((idx + 0.3) / nTubes);
      const u = clamp(0.5 + Math.cos(az) * dist * 0.45, 0.12, 0.88);
      const v = clamp(0.5 + Math.sin(az) * dist * 0.45, 0.12, 0.88);
      const surf = this.substrate.sampleSurface(u, v).pos;

      const scaleH = idx === 0 ? 1.05 : lerp1(0.92, 0.68, idx / Math.max(1, nTubes - 1));
      const tubeH = Math.max(0.24, p.colonyHeight * 0.52 * scaleH);
      const tubeR = Math.max(0.028, tubeH * 0.11);
      const phase = (this.colonyPhase + idx * 0.006) % 1;

      // 1. Curved Felted Parchment Mucous-Sand Dwelling Tube emerging from seabed!
      const outVec = idx === 0 ? currentDir : v3(Math.cos(az), 0, Math.sin(az));
      const tubeInit = normalize(
        add(scale(UP, 0.90), add(scale(outVec, 0.24), scale(currentDir, Math.sin(leanRad) * 0.35))),
      );
      const tubeCurve = growCurve(
        add(surf, v3(0, -0.02, 0)),
        tubeInit,
        anyPerpendicular(tubeInit),
        tubeH,
        tier >= 3 ? 16 : 11,
        (t0, t1) => ({
          pitch: (leanRad * 0.38 + Math.sin(t1 * Math.PI) * 0.16) * (t1 - t0),
          yaw: cRng.range(-0.15, 0.15) * (t1 - t0),
        }),
      );

      const tubeTopFlex = 0.08 * p.currentSway;
      const tubeSides = tier >= 3 ? 18 : 12;
      const tRings: number[][] = [];
      for (let i = 0; i < tubeCurve.count; i++) {
        const fr = tubeCurve.frameAtIndex(i);
        const t = fr.t;
        // Annulated felted parchment wrinkles + gracefully flared top collar!
        const flare = lerp1(1.14, 0.86, t) + 0.32 * smoothstep(0.82, 1.0, t);
        const annuli = 1 + 0.055 * Math.sin(t * 42.0);
        const rHere = tubeR * flare * annuli;
        const flex = Math.pow(t, 1.6) * tubeTopFlex;
        const row: number[] = [];
        for (let j = 0; j < tubeSides; j++) {
          const th = (j / tubeSides) * TAU;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere);
          row.push(
            tubeMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / tubeSides, v: t,
              color: mixRgb(colTubeBase, colTubeRim, smoothstep(0.15, 0.95, t)),
              wind: [t, flex, phase, 0],
              pivot: this.groundOrigin,
              roughness: 0.78, // Felted sand-mucus parchment texture!
              translucency: 0.12,
              detailMetric: 0.4,
              anatomyLevel: 1,
            }),
          );
        }
        tRings.push(row);
      }
      for (let i = 0; i < tRings.length - 1; i++) {
        for (let j = 0; j < tubeSides; j++) {
          const j1 = (j + 1) % tubeSides;
          tubeMesh.addQuad(tRings[i][j], tRings[i][j1], tRings[i + 1][j1], tRings[i + 1][j]);
        }
      }
      this.stats.stemsOrTubes++;

      const rimFr = tubeCurve.atT(1.0);
      this.emitPleatedOralCone(
        oralConeMesh,
        rimFr.pos,
        tubeR * 0.82,
        tubeR * 0.35,
        colOuterBase,
        colLabial,
        tubeTopFlex,
        phase,
      );

      // 2. Cascading "Underwater Fireworks" Fountain of Long Slender Marginal Tentacles (`frondsMesh`)!
      const nMarginal = Math.max(36, Math.round((tier >= 3 ? 68 : 44) * p.organDensity));
      const baseSpan = p.organLength * scaleH * p.canopySpread;
      for (let m = 0; m < nMarginal; m++) {
        const mRng = cRng.fork(0x300 + m * 59);
        const tierF = m / Math.max(1, nMarginal - 1); // 0 = high fountain arch -> 1 = wide weeping cascade!
        const mAz = m * GOLDEN_ANGLE + mRng.range(-0.07, 0.07);
        const radH = normalize(add(scale(rimFr.right, Math.cos(mAz)), scale(rimFr.up, Math.sin(mAz))));
        const startPt = addScaled(rimFr.pos, radH, tubeR * lerp1(0.76, 1.05, tierF));

        const launchElev = lerp1(76, 26, tierF) * DEG2RAD;
        const launchDir = normalize(
          add(
            scale(radH, Math.cos(launchElev)),
            add(scale(rimFr.dir, Math.sin(launchElev)), scale(currentDir, Math.sin(leanRad) * 0.32)),
          ),
        );
        const mLen = baseSpan * lerp1(0.84, 1.18, Math.sin(Math.PI * (0.2 + 0.65 * tierF))) * mRng.vary(1.0, 0.12);
        const mBaseR = Math.max(0.0032, mLen * clamp(p.organWidth, 0.04, 0.22) * 0.095);
        const swirlSign = m % 2 === 0 ? 1 : -1;

        const mCurve = growCurve(startPt, launchDir, anyPerpendicular(launchDir), mLen, tier >= 3 ? 18 : 11, (t0, t1) => {
          const dt = t1 - t0;
          // Parabolic firework fountain arch weeping into sinuous S-curls at the filament tips!
          const fountainDroop = (-(1.35 + 0.65 * tierF) + Math.sin(t1 * TAU * 1.15) * 0.42 * p.ruffleWave) * dt;
          const spiralCurl = swirlSign * (0.28 + 0.65 * t1 * p.ruffleWave) * dt;
          return { pitch: fountainDroop, yaw: spiralCurl };
        });

        this.emitCappedTentacleTube(
          marginalMesh,
          mCurve,
          tier >= 3 ? 6 : 5,
          (u) => Math.max(0.0007, mBaseR * Math.pow(1 - u * 0.88, 0.78)),
          (u) => {
            // Bioluminescent banded Cerianthus firework filament!
            const band = 0.5 + 0.5 * Math.sin(u * 26.0);
            let col = mixRgb(colOuterBase, colOuterMid, smoothstep(0.12, 0.68, u));
            col = mixRgb(col, colOuterTip, smoothstep(0.62, 0.98, u) * (0.68 + 0.32 * band));
            return col;
          },
          tubeTopFlex,
          0.28 * p.currentSway,
          0.30 * p.currentSway,
          phase,
          0.14,
          p.translucency,
        );
        this.stats.bladesOrTentacles++;
      }

      // 3. Contrasting Dense Central Bouquet of Short Curling Labial Tentacles (`vesiclesMesh`)!
      if (p.vesicleAbundance > 0.15) {
        const nLabial = Math.max(16, Math.round((tier >= 3 ? 32 : 20) * p.vesicleAbundance));
        for (let l = 0; l < nLabial; l++) {
          const lRng = cRng.fork(0x900 + l * 37);
          const lAz = l * GOLDEN_ANGLE;
          const radH = normalize(add(scale(rimFr.right, Math.cos(lAz)), scale(rimFr.up, Math.sin(lAz))));
          const lStart = add(addScaled(rimFr.pos, rimFr.dir, tubeR * 0.16), scale(radH, tubeR * 0.36 * Math.sqrt((l + 0.5) / nLabial)));
          const lDir = normalize(add(scale(rimFr.dir, 0.88), scale(radH, 0.45)));
          const lLen = baseSpan * 0.24 * lRng.vary(1.0, 0.15);
          const lCurve = growCurve(lStart, lDir, anyPerpendicular(lDir), lLen, 8, (t0, t1) => ({
            pitch: 0.85 * (t1 - t0),
            yaw: lRng.range(-0.6, 0.6) * (t1 - t0),
          }));
          this.emitCappedTentacleTube(
            labialMesh,
            lCurve,
            5,
            (u) => Math.max(0.0008, mBaseRadius(tubeR) * (1 - 0.72 * u)),
            (u) => mixRgb(colOuterMid, colLabial, smoothstep(0.15, 0.9, u)),
            tubeTopFlex,
            0.12 * p.currentSway,
            0.16 * p.currentSway,
            phase,
            0.18,
            p.translucency,
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    tubeMesh.hasExplicitNormals = true;
    marginalMesh.hasExplicitNormals = true;
    labialMesh.hasExplicitNormals = true;

    function mBaseRadius(tr: number): number {
      return Math.max(0.0022, tr * 0.085);
    }
  }

  // ===========================================================================
  // 22. SPIRAL CORKSCREW ANEMONE (Bartholomea annulata / Macrodactyla)
  // ===========================================================================
  private buildCorkscrewAnemone(
    tier: number,
    columnMesh: PartMesh,
    mouthMesh: PartMesh,
    corkscrewMesh: PartMesh,
    ringsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colColumn = hexToLinearRgb(p.hueHoldfast);
    const colDiscA = hexToLinearRgb(p.huePrimary);
    const colHelix = hexToLinearRgb(p.hueSecondary);
    const colTip = hexToLinearRgb(p.hueAccent);
    const colRingBand = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.24, p.colonyHeight);
    const colH = H * 0.36;
    const discR = Math.max(0.15, H * 0.44 * p.canopySpread);
    const discFlex = 0.08 * p.currentSway;

    // 1. Radially Star-Striped Oral Disc & Spotted Crevice Column!
    const uCols = tier >= 3 ? 44 : 30;
    const vRows = tier >= 3 ? 18 : 13;
    const posGrid: V3[][] = [];
    const colGrid: RGB[][] = [];
    const windGrid: [number, number, number, number][][] = [];

    for (let r = 0; r <= vRows; r++) {
      const v = r / vRows;
      const rowFlex = v <= 0.58 ? Math.pow(v / 0.58, 1.45) * discFlex : discFlex;
      const pRow: V3[] = [];
      const cRow: RGB[] = [];
      const wRow: [number, number, number, number][] = [];

      for (let c = 0; c <= uCols; c++) {
        const th = (c / uCols) * TAU;
        const wave = Math.sin(th * 6 + 0.3) * 0.09 * p.ruffleWave;
        if (v <= 0.58) {
          const tC = v / 0.58;
          const rad = discR * lerp1(0.48, 1.0 + wave, Math.pow(tC, 1.7));
          const y = colH * tC + discR * wave * 0.25 * tC;
          pRow.push(add(this.groundOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
          cRow.push(mixRgb(colColumn, colDiscA, smoothstep(0.2, 0.95, tC)));
          wRow.push([v, rowFlex, this.colonyPhase, 0]);
        } else {
          const tD = (v - 0.58) / 0.42;
          const rad = lerp1(discR * (1 + wave), discR * 0.06, tD);
          const y = colH + discR * wave * 0.25 * (1 - tD) - colH * 0.10 * tD;
          // 12-rayed star pattern radiating across oral disc!
          const star = Math.pow(0.5 + 0.5 * Math.cos(th * 12), 2.4);
          let col = mixRgb(colDiscA, colRingBand, star * 0.48 * (1 - 0.4 * tD));
          col = mixRgb(col, colTip, smoothstep(0.7, 1.0, tD) * 0.65);
          pRow.push(add(this.groundOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
          cRow.push(col);
          wRow.push([v, rowFlex, this.colonyPhase, 0]);
        }
      }
      posGrid.push(pRow);
      colGrid.push(cRow);
      windGrid.push(wRow);
    }
    this.emitSurfaceGrid(columnMesh, posGrid, colGrid, windGrid, 0.24, p.translucency * 0.55);
    this.stats.stemsOrTubes = 1;

    this.emitPleatedOralCone(
      mouthMesh,
      add(this.groundOrigin, v3(0, colH - colH * 0.08, 0)),
      discR * 0.11,
      colH * 0.08,
      colDiscA,
      colRingBand,
      discFlex,
      this.colonyPhase,
    );

    // 2. True 3D Helical Spiral-Coil Corkscrew Tentacles + Opalescent Nematocyst Rings!
    const nRings = clamp(Math.round(p.colonyCount), 3, 8);
    const nTent = Math.max(38, Math.round((tier >= 3 ? 72 : 46) * p.organDensity * (nRings / 5)));
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanSin = Math.sin(p.currentLeanDeg * DEG2RAD);
    const uSegs = tier >= 3 ? 48 : 28; // High axial resolution (~10 stations/turn) for silky-smooth 3D corkscrew coils!

    for (let k = 0; k < nTent; k++) {
      const tRng = this.rng.fork(0xed00 + k * 79);
      const frac = (k + 0.5) / nTent;
      const rDiscFrac = lerp1(0.24, 0.94, Math.sqrt(frac));
      const az = k * GOLDEN_ANGLE + tRng.range(-0.07, 0.07);
      const wave = Math.sin(az * 6 + 0.3) * 0.09 * p.ruffleWave;

      const radDir = v3(Math.cos(az), 0, Math.sin(az));
      const attachR = discR * rDiscFrac * (1 + wave * rDiscFrac);
      const attachY = colH + discR * wave * 0.25 * rDiscFrac - colH * 0.08 * (1 - rDiscFrac);
      const basePos = add(this.groundOrigin, addScaled(v3(0, attachY, 0), radDir, attachR));

      const tentLen = p.organLength * (0.74 + 0.40 * Math.sin(Math.PI * (0.2 + 0.68 * frac))) * tRng.vary(1.0, 0.12);
      const baseR = Math.max(0.0065, tentLen * clamp(p.organWidth, 0.08, 0.36) * 0.16);
      const elev = lerp1(78, 24, frac) * DEG2RAD;
      const emergeDir = normalize(
        add(scale(radDir, Math.cos(elev)), add(scale(UP, Math.sin(elev)), scale(currentDir, leanSin * 0.36))),
      );

      // Smooth guide axis onto which we superimpose a true 3D helical corkscrew coil!
      const guide = growCurve(basePos, emergeDir, anyPerpendicular(emergeDir), tentLen, uSegs, (t0, t1) => ({
        pitch: (-0.32 - 0.25 * frac) * (t1 - t0),
        yaw: tRng.range(-0.25, 0.25) * (t1 - t0),
      }));

      const helixTurns = (2.8 + 2.4 * p.ruffleWave) * (k % 2 === 0 ? 1 : -1);
      const helixPhase0 = tRng.range(0, TAU);
      const helixPts: V3[] = [];
      for (let i = 0; i < guide.count; i++) {
        const fr = guide.frameAtIndex(i);
        const u = fr.t;
        // Zero helix offset at `u = 0` so attachment to the oral disc is 100% seamless!
        const coilAmp = baseR * (0.4 + 1.85 * p.ruffleWave) * smoothstep(0.0, 0.22, u) * (1 - 0.45 * u);
        const ang = u * helixTurns * TAU + helixPhase0;
        const coilOff = add(scale(fr.right, Math.cos(ang) * coilAmp), scale(fr.up, Math.sin(ang) * coilAmp));
        helixPts.push(add(fr.pos, coilOff));
      }
      const corkscrewCurve = this.curveFromPoints(helixPts);
      const tentPhase = (this.colonyPhase + ((az / TAU) % 1) * 0.025) % 1;

      this.emitCappedTentacleTube(
        corkscrewMesh,
        corkscrewCurve,
        tier >= 3 ? 7 : 5,
        (u) => {
          // Raised opalescent nematocyst ring ridges (`annuli`) along the corkscrew spiral!
          const ringBump = 1 + 0.18 * p.vesicleAbundance * Math.pow(0.5 + 0.5 * Math.cos(u * 38.0), 4.0);
          return Math.max(0.001, baseR * Math.pow(1 - u * 0.78, 0.78) * ringBump);
        },
        (u) => {
          const ringMask = Math.pow(0.5 + 0.5 * Math.cos(u * 38.0), 5.0) * clamp(p.vesicleAbundance, 0, 1.3);
          let col = mixRgb(colDiscA, colHelix, smoothstep(0.1, 0.72, u));
          col = mixRgb(col, colRingBand, clamp(ringMask * 0.78, 0, 0.9));
          col = mixRgb(col, colTip, smoothstep(0.84, 0.99, u));
          return col;
        },
        discFlex,
        0.22 * p.currentSway,
        0.25 * p.currentSway,
        tentPhase,
        0.14,
        p.translucency,
      );
      this.stats.bladesOrTentacles++;

      // Sculpted 3D nematocyst collar beads on outer corkscrew turns (`vesiclesMesh`)
      if (p.vesicleAbundance > 0.35 && k % 2 === 0) {
        for (const uBand of [0.45, 0.72]) {
          const bFr = corkscrewCurve.atT(uBand);
          const bFlex = discFlex + Math.pow(uBand, 1.45) * 0.22 * p.currentSway;
          const bFlut = 0.25 * p.currentSway * uBand * uBand;
          const rBand = baseR * Math.pow(1 - uBand * 0.78, 0.78) * 1.28;
          this.emitClosedOvoid(
            ringsMesh,
            addScaled(bFr.pos, bFr.dir, -rBand * 0.6),
            bFr.dir,
            rBand * 1.2,
            rBand,
            6,
            4,
            colHelix,
            colRingBand,
            0.2,
            0.7,
            [uBand, bFlex, tentPhase, bFlut],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    columnMesh.hasExplicitNormals = true;
    corkscrewMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 23. CARIBBEAN ULTRA ROCK FLOWER ANEMONE (Phymanthus crucifer)
  // ===========================================================================
  private buildRockFlowerAnemone(
    tier: number,
    discMesh: PartMesh,
    mouthMesh: PartMesh,
    skirtMesh: PartMesh,
    papillaeMesh: PartMesh,
  ): void {
    const p = this.p;
    const colFoot = hexToLinearRgb(p.hueHoldfast);
    const colWedgeA = hexToLinearRgb(p.huePrimary); // Fiery scarlet-orange radial wedges!
    const colWedgeB = hexToLinearRgb(p.hueSecondary); // Electric emerald-jade radial wedges!
    const colGold = hexToLinearRgb(p.hueAccent); // Golden beaded papillae & rings!
    const colPinkMouth = hexToLinearRgb(p.huePolyp); // Neon magenta mouth & skirt tips!

    const nFlowers = clamp(Math.round(p.colonyCount), 1, 9);
    const clusterR = nFlowers === 1 ? 0 : Math.min(0.46, 0.22 + 0.045 * nFlowers) * p.canopySpread;
    const uvScale = 0.52 / Math.max(0.45, this.substrate.params.size);
    const uCols = tier >= 3 ? 52 : 34;
    const vRows = tier >= 3 ? 16 : 11;

    for (let f = 0; f < nFlowers; f++) {
      const fRng = this.rng.fork(0xf100 + f * 83);
      const az = f * GOLDEN_ANGLE + fRng.range(-0.14, 0.14);
      const dist = f === 0 ? 0 : clusterR * lerp1(0.68, 1.04, (f - 1) / Math.max(1, nFlowers - 2));
      const u = clamp(0.5 + Math.cos(az) * dist * uvScale, 0.12, 0.88);
      const v = clamp(0.5 + Math.sin(az) * dist * uvScale, 0.12, 0.88);
      const surf = this.substrate.sampleSurface(u, v);

      const scaleF = f === 0 ? 0.98 : lerp1(0.78, 0.56, f / Math.max(1, nFlowers - 1)) * fRng.vary(1.0, 0.08);
      const discR = Math.max(0.095, p.colonyHeight * 0.48 * scaleF * p.canopySpread);
      const cupH = discR * 0.30;
      const phase = (this.colonyPhase + f * 0.005) % 1;
      const discFlex = 0.06 * p.currentSway;

      // Slight natural reef-crevice tilt outward so the ornate radial flower disc faces the viewer!
      const tiltDir = f === 0 ? v3(0.2, 0, 0.2) : v3(Math.cos(az) * 0.28, 0, Math.sin(az) * 0.28);
      const discUp = normalize(add(UP, scale(surf.normal, 0.35)));
      const axisUp = normalize(add(discUp, tiltDir));
      const axisRight = anyPerpendicular(axisUp);
      const axisFwd = normalize(cross(axisUp, axisRight));
      const centerBase = add(surf.pos, scale(axisUp, 0.032));

      // 1. Wide-Open Radially Zebra-Striped Rainbow Flower Oral Disc (`0..84%` completely open to view!)
      const posGrid: V3[][] = [];
      const colGrid: RGB[][] = [];
      const windGrid: [number, number, number, number][][] = [];
      const nSectors = 12; // 12 alternating high-contrast radial flower sectors!

      const evalFlowerDisc = (rFrac: number, th: number): { pos: V3; flex: number } => {
        const ruffle = (Math.sin(th * 8 + f) * 0.11 + Math.cos(th * 14 - f) * 0.04) * p.ruffleWave;
        const rad = discR * rFrac * (1 + 0.08 * ruffle * rFrac);
        const saucer = cupH * (0.35 + 0.65 * Math.pow(rFrac, 1.6) + ruffle * rFrac * 0.55);
        const radialVec = add(scale(axisRight, Math.cos(th)), scale(axisFwd, Math.sin(th)));
        return {
          pos: add(addScaled(centerBase, radialVec, rad), scale(axisUp, saucer)),
          flex: discFlex * Math.pow(rFrac, 1.4),
        };
      };

      for (let r = 0; r <= vRows; r++) {
        const rv = r / vRows;
        const pRow: V3[] = [];
        const cRow: RGB[] = [];
        const wRow: [number, number, number, number][] = [];

        for (let c = 0; c <= uCols; c++) {
          const th = (c / uCols) * TAU;
          if (rv < 0.25) {
            const tC = rv / 0.25;
            const rim = evalFlowerDisc(1.0, th);
            const footPt = add(
              centerBase,
              add(scale(axisRight, Math.cos(th) * discR * 0.36), scale(axisFwd, Math.sin(th) * discR * 0.36)),
            );
            pRow.push(lerpV3(footPt, rim.pos, tC));
            cRow.push(mixRgb(colFoot, colWedgeA, tC * 0.5));
            wRow.push([rv, rim.flex * tC, phase, 0]);
          } else {
            const rFrac = lerp1(1.0, 0.05, (rv - 0.25) / 0.75);
            const smp = evalFlowerDisc(rFrac, th);
            // Crisp alternating radial zebra wedges + concentric ripple rings of Phymanthus crucifer!
            const sectorWave = 0.5 + 0.5 * Math.cos(th * nSectors);
            const concRipple = 0.5 + 0.5 * Math.sin(rFrac * 28.0);
            let col = mixRgb(colWedgeA, colWedgeB, smoothstep(0.28, 0.72, sectorWave));
            col = mixRgb(col, colGold, concRipple * 0.26 * smoothstep(0.18, 0.88, rFrac));
            col = mixRgb(col, colPinkMouth, smoothstep(0.24, 0.05, rFrac) * 0.85);
            pRow.push(smp.pos);
            cRow.push(col);
            wRow.push([rFrac, smp.flex, phase, 0]);
          }
        }
        posGrid.push(pRow);
        colGrid.push(cRow);
        windGrid.push(wRow);
      }

      this.emitSurfaceGrid(discMesh, posGrid, colGrid, windGrid, 0.22, p.translucency * 0.6);
      this.stats.stemsOrTubes++;

      const mouthCenter = evalFlowerDisc(0.06, 0);
      this.emitPleatedOralCone(
        mouthMesh,
        mouthCenter.pos,
        discR * 0.13,
        discR * 0.06,
        colWedgeA,
        colPinkMouth,
        mouthCenter.flex,
        phase,
      );

      // Radial rows of golden beaded discal papillae across the striped flower face (`vesiclesMesh`)!
      if (p.vesicleAbundance > 0.2) {
        for (let s = 0; s < nSectors * 2; s++) {
          const th = (s / (nSectors * 2)) * TAU;
          for (const rf of [0.34, 0.52, 0.70]) {
            const smp = evalFlowerDisc(rf, th);
            const papR = discR * 0.024 * clamp(p.vesicleAbundance, 0.6, 1.35);
            this.emitClosedOvoid(
              papillaeMesh,
              addScaled(smp.pos, axisUp, -papR * 0.3),
              axisUp,
              papR * 1.6,
              papR,
              5,
              4,
              colWedgeB,
              colGold,
              0.18,
              0.72,
              [rf, smp.flex, phase, 0],
            );
            this.stats.vesiclesOrPolyps++;
          }
        }
      }

      // 2. Beaded / Papillose Conical Perimeter Tentacle Fringe Skirt (`rFrac = 0.86..0.98`)!
      const nSkirt = Math.max(28, Math.round((tier >= 3 ? 46 : 32) * p.organDensity));
      for (let t = 0; t < nSkirt; t++) {
        const tRng = fRng.fork(0x500 + t * 43);
        const rFrac = t % 2 === 0 ? 0.96 : 0.88;
        const th = (t / nSkirt) * TAU + tRng.range(-0.04, 0.04);
        const smp = evalFlowerDisc(rFrac, th);
        const radOut = normalize(add(scale(axisRight, Math.cos(th)), scale(axisFwd, Math.sin(th))));
        const launch = normalize(add(scale(radOut, 0.86), scale(axisUp, t % 2 === 0 ? 0.28 : 0.52)));
        const tLen = p.organLength * scaleF * tRng.vary(1.0, 0.12);
        const tBaseR = Math.max(0.0048, tLen * clamp(p.organWidth, 0.12, 0.45) * 0.24);

        const skirtCurve = growCurve(smp.pos, launch, anyPerpendicular(launch), tLen, tier >= 3 ? 12 : 8, (t0, t1) => ({
          pitch: 0.35 * (t1 - t0),
          yaw: tRng.range(-0.2, 0.2) * (t1 - t0),
        }));

        this.emitCappedTentacleTube(
          skirtMesh,
          skirtCurve,
          tier >= 3 ? 7 : 5,
          (uTent) => {
            // Signature beaded/papillose Phymanthus tentacle swellings!
            const beads = 1 + 0.36 * p.ruffleWave * Math.pow(Math.sin(uTent * Math.PI * 5.0), 2.0);
            return Math.max(0.001, tBaseR * (1 - 0.72 * uTent) * beads);
          },
          (uTent) => {
            const beadHi = Math.pow(Math.sin(uTent * Math.PI * 5.0), 2.0);
            let col = mixRgb(t % 2 === 0 ? colWedgeA : colWedgeB, colGold, beadHi * 0.68);
            col = mixRgb(col, colPinkMouth, smoothstep(0.75, 0.98, uTent));
            return col;
          },
          smp.flex,
          0.12 * p.currentSway,
          0.16 * p.currentSway,
          phase,
          0.16,
          p.translucency,
        );
        this.stats.bladesOrTentacles++;
      }
    }
    discMesh.hasExplicitNormals = true;
    skirtMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 24. GIANT PLUMOSE / FRILLED CAULIFLOWER ANEMONE (Metridium farcimen)
  // ===========================================================================
  private buildPlumoseFrilledAnemone(
    tier: number,
    columnMesh: PartMesh,
    lobesMesh: PartMesh,
    plumeMesh: PartMesh,
    cinclidesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast); // Terracotta-salmon base
    const colTrunk = hexToLinearRgb(p.huePrimary); // Translucent warm salmon-peach column
    const colLobe = hexToLinearRgb(p.hueSecondary); // Soft peach-ivory ruffled cauliflower lobes
    const colPlume = hexToLinearRgb(p.hueAccent); // Luminous alabaster-white feathery cloud!
    const colCollar = hexToLinearRgb(p.huePolyp);

    const nStalks = clamp(Math.round(p.colonyCount), 1, 6);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const groupR = nStalks === 1 ? 0 : Math.min(0.38, 0.14 + 0.055 * nStalks) * p.canopySpread;

    for (let s = 0; s < nStalks; s++) {
      const sRng = this.rng.fork(0xf500 + s * 101);
      const az = s * GOLDEN_ANGLE + sRng.range(-0.2, 0.2);
      const dist = s === 0 ? 0 : groupR * Math.sqrt((s + 0.3) / nStalks);
      const u = clamp(0.5 + Math.cos(az) * dist * 0.45, 0.12, 0.88);
      const v = clamp(0.5 + Math.sin(az) * dist * 0.45, 0.12, 0.88);
      const surf = this.substrate.sampleSurface(u, v).pos;

      const scaleH = s === 0 ? 1.06 : lerp1(0.88, 0.58, s / Math.max(1, nStalks - 1));
      const stalkH = Math.max(0.28, p.colonyHeight * 0.68 * scaleH);
      const stalkR = Math.max(0.042, stalkH * 0.13);
      const phase = (this.colonyPhase + s * 0.005) % 1;

      // 1. Towering Smooth Translucent Cylindrical Trunk Column with Parapet Collar Ring!
      const outVec = s === 0 ? currentDir : v3(Math.cos(az), 0, Math.sin(az));
      const initDir = normalize(
        add(scale(UP, 0.92), add(scale(outVec, 0.18), scale(currentDir, Math.sin(leanRad) * 0.35))),
      );
      const colCurve = growCurve(
        add(surf, v3(0, -0.015, 0)),
        initDir,
        anyPerpendicular(initDir),
        stalkH,
        tier >= 3 ? 20 : 14,
        (t0, t1) => ({
          pitch: (leanRad * 0.32 + Math.sin(t1 * Math.PI * 0.9) * 0.12) * (t1 - t0),
          yaw: sRng.range(-0.12, 0.12) * (t1 - t0),
        }),
      );

      const topFlex = 0.16 * p.currentSway;
      const sides = tier >= 3 ? 26 : 18;
      const cRings: number[][] = [];
      for (let i = 0; i < colCurve.count; i++) {
        const fr = colCurve.frameAtIndex(i);
        const t = fr.t;
        // Pedal basal flare -> smooth stately column -> sharp parapet collar ring (`t ~ 0.86`) -> flaring capitulum!
        const baseFlare = 1.34 * Math.exp(-t * 6.0);
        const parapetRing = 0.20 * Math.exp(-Math.pow((t - 0.86) / 0.035, 2.0));
        const capFlare = 0.48 * smoothstep(0.88, 1.0, t);
        const rHere = stalkR * (0.82 + baseFlare + parapetRing + capFlare);
        const flex = Math.pow(t, 1.5) * topFlex;
        const row: number[] = [];

        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere);
          let col = mixRgb(colBase, colTrunk, smoothstep(0.05, 0.55, t));
          col = mixRgb(col, colLobe, smoothstep(0.68, 1.0, t));
          if (parapetRing > 0.06) col = mixRgb(col, colCollar, parapetRing * 2.5);
          row.push(
            columnMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: t,
              color: col,
              wind: [t, flex, phase, 0],
              pivot: this.groundOrigin,
              roughness: 0.20,
              translucency: Math.max(0.65, p.translucency), // Luminous translucent Metridium column!
              detailMetric: parapetRing > 0.05 ? 0.9 : 0.4,
              anatomyLevel: 1,
            }),
          );
        }
        cRings.push(row);
      }
      for (let i = 0; i < cRings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          columnMesh.addQuad(cRings[i][j], cRings[i][j1], cRings[i + 1][j1], cRings[i + 1][j]);
        }
      }
      this.stats.stemsOrTubes++;

      // Tiny scattered cinclides (acontia pore bumps) on column (`vesiclesMesh`)
      if (p.vesicleAbundance > 0.25) {
        for (let k = 0; k < 14; k++) {
          const z = lerp1(0.22, 0.78, k / 13);
          const fr = colCurve.atT(z);
          const th = k * GOLDEN_ANGLE;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const rCol = stalkR * 0.84;
          this.emitClosedOvoid(
            cinclidesMesh,
            addScaled(fr.pos, rad, rCol * 0.92),
            rad,
            0.007,
            0.0045,
            5,
            4,
            colTrunk,
            colCollar,
            0.25,
            0.75,
            [z, Math.pow(z, 1.5) * topFlex, phase, 0],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }

      // 2. Billowing Multi-Lobed Ruffled Cauliflower Oral Crown (`stipeMesh`) + Fluffy Cloud of Plumose Filaments (`frondsMesh`)!
      const apex = colCurve.atT(1.0);
      const nLobes = clamp(Math.round(p.branchOrder) + 4, 6, 8);
      const crownR = stalkR * 2.15 * p.canopySpread;
      const lobeRings = tier >= 3 ? 9 : 6;
      const lobeCols = tier >= 3 ? 22 : 14;

      for (let l = 0; l < nLobes; l++) {
        const lAz = (l / nLobes) * TAU + sRng.range(-0.08, 0.08);
        const radH = normalize(add(scale(apex.right, Math.cos(lAz)), scale(apex.up, Math.sin(lAz))));
        const tangH = normalize(cross(apex.dir, radH));
        // Wide billowing cauliflower lobes overhanging the parapet collar!
        const lobeDir = normalize(add(scale(radH, 0.90), scale(apex.dir, 0.44)));
        const lobeNrm = normalize(cross(tangH, lobeDir));
        const lobeOrigin = add(addScaled(apex.pos, radH, stalkR * 0.38), scale(apex.dir, stalkR * 0.08));
        const lobeLen = crownR * 0.96 * sRng.vary(1.0, 0.07);

        const posG: V3[][] = [];
        const colG: RGB[][] = [];
        const windG: [number, number, number, number][][] = [];

        for (let r = 0; r <= lobeRings; r++) {
          const rf = r / lobeRings;
          const lFlex = topFlex + 0.06 * p.currentSway * rf;
          const pR: V3[] = [];
          const cR: RGB[] = [];
          const wR: [number, number, number, number][] = [];

          for (let c = 0; c <= lobeCols; c++) {
            const vf = c / lobeCols - 0.5;
            const theta = vf * 2.35 * smoothstep(0.0, 0.42, rf);
            const round = Math.pow(Math.max(0.12, Math.cos(vf * Math.PI * 0.90)), 0.32);
            const dirInLobe = normalize(add(scale(lobeDir, Math.cos(theta)), scale(tangH, Math.sin(theta))));
            // Deep multi-harmonic cauliflower frilling along every oral lobe!
            const frill =
              (Math.sin(theta * 6.0 + l) + 0.65 * Math.cos(theta * 13.0 - l * 1.7)) *
              lobeLen *
              0.26 *
              p.ruffleWave *
              Math.pow(rf, 1.4) *
              round;
            const domeArch = Math.sin(rf * Math.PI * 0.85) * lobeLen * 0.22;
            const pt = add(addScaled(lobeOrigin, dirInLobe, lobeLen * rf * round), scale(lobeNrm, frill + domeArch));
            pR.push(pt);
            cR.push(mixRgb(colLobe, colPlume, smoothstep(0.32, 0.96, rf) * 0.78));
            wR.push([rf, lFlex, phase, 0.05 * p.currentSway * rf * rf]);

            // Lush domed puffball cloud of fine feathery alabaster micro-tentacles clothing every cauliflower fold!
            if (r >= 2 && (c + r) % (tier >= 3 ? 1 : 2) === 0) {
              const filLen = p.organLength * scaleH * lerp1(0.24, 0.36, rf) * sRng.vary(1.0, 0.22);
              const filR = Math.max(0.0019, filLen * clamp(p.organWidth, 0.05, 0.25) * 0.20);
              const filDir = normalize(
                add(
                  scale(apex.dir, lerp1(0.92, 0.48, rf)),
                  add(
                    scale(dirInLobe, lerp1(0.22, 0.72, rf)),
                    add(scale(lobeNrm, 0.35 + sRng.range(-0.22, 0.22)), scale(tangH, sRng.range(-0.28, 0.28))),
                  ),
                ),
              );
              const filCurve = growCurve(pt, filDir, anyPerpendicular(filDir), filLen, 4, (t0, t1) => ({
                pitch: (-0.42 + sRng.range(-0.32, 0.32)) * (t1 - t0),
                yaw: sRng.range(-0.45, 0.45) * (t1 - t0),
              }));
              this.emitCappedTentacleTube(
                plumeMesh,
                filCurve,
                4,
                (uF) => Math.max(0.0005, filR * (1 - 0.62 * uF)),
                (uF) => mixRgb(colLobe, colPlume, smoothstep(0.08, 0.75, uF)),
                lFlex,
                0.07 * p.currentSway,
                0.16 * p.currentSway,
                phase,
                0.24,
                Math.max(0.78, p.translucency),
              );
              this.stats.bladesOrTentacles++;
            }
          }
          posG.push(pR);
          colG.push(cR);
          windG.push(wR);
        }
        this.emitSurfaceGrid(lobesMesh, posG, colG, windG, 0.24, p.translucency);
      }
    }
    columnMesh.hasExplicitNormals = true;
    lobesMesh.hasExplicitNormals = true;
    plumeMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 25. STRAWBERRY BEADLET ANEMONE (Actinia fragacea)
  // ===========================================================================
  private buildStrawberryBeadletAnemone(
    tier: number,
    barrelMesh: PartMesh,
    mouthMesh: PartMesh,
    tentaclesMesh: PartMesh,
    acrorhagiMesh: PartMesh,
  ): void {
    const p = this.p;
    const colCrimsonDeep = hexToLinearRgb(p.hueHoldfast);
    const colCrimsonBody = hexToLinearRgb(p.huePrimary);
    const colRubyTent = hexToLinearRgb(p.hueSecondary);
    const colRoseTip = hexToLinearRgb(p.hueAccent);
    const colSapphireBead = hexToLinearRgb(p.huePolyp); // Vivid electric sapphire-blue acrorhagi pearls!
    const colGoldSeed = hexToLinearRgb('#d9e838'); // Golden-chartreuse strawberry spots!

    const nColony = clamp(Math.round(p.colonyCount), 1, 8);
    const clusterR = nColony === 1 ? 0 : Math.min(0.46, 0.22 + 0.045 * nColony) * p.canopySpread;
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanSin = Math.sin(p.currentLeanDeg * DEG2RAD);

    for (let idx = 0; idx < nColony; idx++) {
      const aRng = this.rng.fork(0xf900 + idx * 97);
      const az = idx * GOLDEN_ANGLE + aRng.range(-0.14, 0.14);
      const dist = idx === 0 ? 0 : clusterR * lerp1(0.72, 1.05, (idx - 1) / Math.max(1, nColony - 2));
      const u = clamp(0.5 + Math.cos(az) * dist * 0.80, 0.12, 0.88);
      const v = clamp(0.5 + Math.sin(az) * dist * 0.80, 0.12, 0.88);
      const baseOrigin = this.substrate.sampleSurface(u, v).pos;

      const scaleA = idx === 0 ? 1.04 : lerp1(0.80, 0.56, idx / Math.max(1, nColony - 1)) * aRng.vary(1.0, 0.08);
      const H = Math.max(0.18, p.colonyHeight * scaleA);
      const barrelH = H * 0.58;
      const barrelR = Math.max(0.075, H * 0.44 * p.canopySpread);
      const topFlex = 0.06 * p.currentSway;
      const phase = (this.colonyPhase + idx * 0.005) % 1;

      const evalBarrelRad = (tB: number): number =>
        barrelR * (0.82 + 0.28 * Math.sin(tB * Math.PI * 0.92) - 0.18 * Math.pow(tB, 3.0));

      // 1. Plump Glossy Crimson Dome-Barrel Column Polka-Dotted with Golden "Strawberry Seeds"!
      const uCols = tier >= 3 ? 48 : 32;
      const vRows = tier >= 3 ? 24 : 16;
      const posGrid: V3[][] = [];
      const colGrid: RGB[][] = [];
      const windGrid: [number, number, number, number][][] = [];

      for (let r = 0; r <= vRows; r++) {
        const rv = r / vRows;
        const pRow: V3[] = [];
        const cRow: RGB[] = [];
        const wRow: [number, number, number, number][] = [];

        for (let c = 0; c <= uCols; c++) {
          const th = (c / uCols) * TAU;
          if (rv <= 0.72) {
            const tB = rv / 0.72;
            const rad = evalBarrelRad(tB);
            const y = barrelH * tB;
            const flex = Math.pow(tB, 1.4) * topFlex;
            const col = mixRgb(colCrimsonDeep, colCrimsonBody, smoothstep(0.05, 0.68, tB));
            pRow.push(add(baseOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
            cRow.push(col);
            wRow.push([rv, flex, phase, 0]);
          } else {
            // Parapet fosse groove + smooth ruby oral disc!
            const tD = (rv - 0.72) / 0.28;
            const rad = lerp1(barrelR * 0.86, barrelR * 0.08, tD);
            const fosseDip = -barrelH * 0.05 * Math.sin(tD * Math.PI);
            const y = barrelH + fosseDip;
            pRow.push(add(baseOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
            cRow.push(mixRgb(colCrimsonBody, colRubyTent, tD * 0.65));
            wRow.push([rv, topFlex, phase, 0]);
          }
        }
        posGrid.push(pRow);
        colGrid.push(cRow);
        windGrid.push(wRow);
      }

      // Glossy wet intertidal cuticle (`roughness = 0.12`)!
      this.emitSurfaceGrid(barrelMesh, posGrid, colGrid, windGrid, 0.12, p.translucency * 0.55);
      this.stats.stemsOrTubes++;

      // Crisp 3D Golden-Chartreuse "Strawberry Seed" Speckles across the glossy crimson barrel!
      const nSeeds = tier >= 3 ? 84 : 48;
      for (let sIdx = 0; sIdx < nSeeds; sIdx++) {
        const tB = lerp1(0.10, 0.88, (sIdx + 0.5) / nSeeds);
        const sTh = sIdx * GOLDEN_ANGLE + idx * 0.7;
        const rad = evalBarrelRad(tB);
        const y = barrelH * tB;
        const nOut = normalize(v3(Math.cos(sTh), 0.14 * Math.cos(tB * Math.PI), Math.sin(sTh)));
        const seedR = barrelR * 0.026;
        const seedPt = add(baseOrigin, v3(Math.cos(sTh) * rad, y, Math.sin(sTh) * rad));
        this.emitClosedOvoid(
          acrorhagiMesh,
          addScaled(seedPt, nOut, -seedR * 0.55),
          nOut,
          seedR * 1.15,
          seedR,
          5,
          4,
          colGoldSeed,
          colGoldSeed,
          0.14,
          0.45,
          [tB * 0.72, Math.pow(tB, 1.4) * topFlex, phase, 0],
        );
        this.stats.vesiclesOrPolyps++;
      }

      this.emitPleatedOralCone(
        mouthMesh,
        add(baseOrigin, v3(0, barrelH - 0.004, 0)),
        barrelR * 0.14,
        barrelH * 0.08,
        colCrimsonBody,
        colRoseTip,
        topFlex,
        phase,
      );

      // 2. Necklace Ring of 24 Vivid Sapphire-Blue Spherical Acrorhagi ("Fighting Beads") on the Parapet Collar!
      if (p.vesicleAbundance > 0.15) {
        const nBeads = Math.max(16, Math.round(24 * clamp(p.vesicleAbundance, 0.6, 1.35)));
        const beadR = barrelR * 0.068;
        for (let b = 0; b < nBeads; b++) {
          const bTh = (b / nBeads) * TAU;
          const radH = v3(Math.cos(bTh), 0, Math.sin(bTh));
          const beadPos = add(baseOrigin, addScaled(v3(0, barrelH - beadR * 0.15, 0), radH, barrelR * 0.85));
          const beadDir = normalize(add(scale(radH, 0.62), scale(UP, 0.78)));
          this.emitClosedOvoid(
            acrorhagiMesh,
            addScaled(beadPos, beadDir, -beadR * 0.3),
            beadDir,
            beadR * 1.95,
            beadR,
            tier >= 3 ? 8 : 6,
            tier >= 3 ? 6 : 4,
            mixRgb(colCrimsonBody, colSapphireBead, 0.55),
            colSapphireBead,
            0.08, // Gleaming wet sapphire jewel sheen!
            0.78,
            [0.72, topFlex, phase, 0],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }

      // 3. Crown of Glossy Ruby-Crimson to Rose-Pink Tapered Tentacles!
      const nTent = Math.max(36, Math.round((tier >= 3 ? 68 : 44) * p.organDensity));
      for (let t = 0; t < nTent; t++) {
        const tRng = aRng.fork(0x600 + t * 53);
        const frac = (t + 0.5) / nTent;
        const rFrac = lerp1(0.24, 0.76, Math.sqrt(frac));
        const tAz = t * GOLDEN_ANGLE + tRng.range(-0.06, 0.06);
        const radH = v3(Math.cos(tAz), 0, Math.sin(tAz));
        const startPt = add(baseOrigin, addScaled(v3(0, barrelH, 0), radH, barrelR * rFrac));

        const elev = lerp1(80, 32, frac) * DEG2RAD;
        const emergeDir = normalize(
          add(scale(radH, Math.cos(elev)), add(scale(UP, Math.sin(elev)), scale(currentDir, leanSin * 0.32))),
        );
        const tLen = p.organLength * scaleA * lerp1(0.78, 1.08, Math.sin(Math.PI * (0.25 + 0.6 * frac))) * tRng.vary(1.0, 0.1);
        const tBaseR = Math.max(0.005, tLen * clamp(p.organWidth, 0.08, 0.38) * 0.18);

        const tCurve = growCurve(startPt, emergeDir, anyPerpendicular(emergeDir), tLen, tier >= 3 ? 11 : 7, (t0, t1) => ({
          pitch: (-0.52 - 0.34 * frac + tRng.range(-0.18, 0.18)) * (t1 - t0),
          yaw: tRng.range(-0.25, 0.25) * (t1 - t0),
        }));
        this.emitCappedTentacleTube(
          tentaclesMesh,
          tCurve,
          tier >= 3 ? 7 : 5,
          (uT) => Math.max(0.001, tBaseR * Math.pow(1 - uT * 0.78, 0.76)),
          (uT) => mixRgb(colRubyTent, colRoseTip, smoothstep(0.35, 0.96, uT)),
          topFlex,
          0.16 * p.currentSway,
          0.18 * p.currentSway,
          phase,
          0.11,
          p.translucency,
        );
        this.stats.bladesOrTentacles++;
      }
    }
    barrelMesh.hasExplicitNormals = true;
    tentaclesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 26. BROAD CARIBBEAN ELKHORN CORAL (Acropora palmata — Watertight 2-Manifold!)
  // ===========================================================================
  private buildElkhornCoralPalmata(
    tier: number,
    skeletonMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast);
    const colBody = hexToLinearRgb(p.huePrimary);
    const colBlade = hexToLinearRgb(p.hueSecondary);
    const colMargin = hexToLinearRgb(p.hueAccent); // Snow-white calcifying growth margin!
    const colPolyp = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.42, p.colonyHeight);
    const trunkR = Math.max(0.048, H * 0.068 * clamp(p.organWidth / 0.44, 0.7, 1.5));
    const cfg: WeldedMeshConfig = {
      trunkRadialSegments: tier >= 3 ? 20 : 14,
      minRadialSegments: tier >= 3 ? 12 : 8,
      collarScale: 1.16,
      collarLength: 1.05,
      collarRings: tier >= 3 ? 2 : 1,
      collarFillet: 0.78,
      collarMitre: 0.48,
      minRadius: 0.008,
      capTips: true,
    };

    const allStems: WeldedStem[] = [];
    const stonyFlexGain = 0.018 * p.currentSway;
    const evalElkFlex = (pos: V3): number => {
      const h01 = saturate((pos.y - this.groundOrigin.y) / H);
      return smoothstep(0.05, 0.25, h01) * Math.pow(h01, 1.6) * stonyFlexGain;
    };

    const buildElkNodes = (origin: V3, dir0: V3, len: number, upLift: number, seedKey: number): WeldedNode[] => {
      const eRng = this.rng.fork(seedKey);
      const nSegs = 8;
      const nodes: WeldedNode[] = [];
      let curPos = clone(origin);
      let curDir = normalize(dir0);
      // Keep `right` horizontal so `cos(th * 2)` compresses blades dorsoventrally into flat horizontal moose antlers!
      let right = projectOnPlane(v3(-curDir.z, 0, curDir.x), curDir);
      right = lengthSq(right) > 1e-6 ? normalize(right) : anyPerpendicular(curDir);
      const step = len / nSegs;
      for (let i = 0; i <= nSegs; i++) {
        nodes.push({ pos: clone(curPos), dir: clone(curDir), right: clone(right), s: i * step });
        if (i < nSegs) {
          curPos = addScaled(curPos, curDir, step);
          curDir = normalize(
            add(curDir, v3(eRng.range(-0.025, 0.025), upLift / nSegs, eRng.range(-0.025, 0.025))),
          );
          let rProj = projectOnPlane(v3(-curDir.z, 0, curDir.x), curDir);
          rProj = lengthSq(rProj) > 1e-6 ? normalize(rProj) : anyPerpendicular(curDir);
          right = rProj;
        }
      }
      return nodes;
    };

    const makeAntlerFrond = (
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
      const lift = level === 0 ? 0.04 : level === 1 ? 0.16 : 0.20;
      const nodes = buildElkNodes(startPos, dir0, len, lift, seedKey);
      const realLen = nodes[nodes.length - 1].s;
      const flattenGain = level === 0 ? 0.0 : level === 1 ? 0.56 : 0.72;
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
        minRing: level === 0 ? cfg.trunkRadialSegments : tier >= 3 ? 14 : 10,
        ringSpacing: clamp(r0 * 0.42, 0.014, 0.042),
        baseRadiusAt: (sVal: number) => {
          const t = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          // Palmate paddle expansion before rounding into blunt white calcifying elkhorn tip!
          const paddle = level >= 1 ? 1 + 0.26 * Math.sin(t * Math.PI * 0.85) : 1.0;
          const tipDome = isTip && t > 0.84 ? Math.max(0.42, Math.cos(((t - 0.84) / 0.16) * (Math.PI * 0.42))) : 1.0;
          return Math.max(cfg.minRadius, lerp1(r0, r1, Math.pow(t, 0.68)) * paddle * tipDome);
        },
        profileFactor: (sVal: number, th: number) => {
          const t = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          // Broad flattened surf-resistant moose-antler blade (`th = 0, PI` wide horizontal, `th = +/-PI/2` thin vertical)!
          const collarRamp = smoothstep(0.02, 0.28, t) * (isTip ? 1.0 : 1 - 0.55 * smoothstep(0.78, 1.0, t));
          const palmate = 1 + flattenGain * collarRamp * Math.cos(th * 2);
          const warty = 0.035 * p.ruffleWave * fbm3(Math.cos(th) * 2.5, t * realLen * 12.0, Math.sin(th) * 2.5, seedKey & 0xffff, 2);
          return Math.max(0.32, palmate + warty);
        },
        styleAt: (sVal: number, _th: number, pos: V3, _dir: V3, isJunc: boolean) => {
          const t = clamp(sVal / Math.max(1e-5, realLen), 0, 1);
          const h01 = saturate((pos.y - this.groundOrigin.y) / H);
          let col = level === 0 ? mixRgb(colBase, colBody, smoothstep(0.1, 0.9, t)) : mixRgb(colBody, colBlade, t * 0.78);
          if (isTip) {
            col = mixRgb(col, colMargin, smoothstep(0.74, 0.98, t) * 0.94);
          }
          return {
            color: col,
            roughness: isTip && t > 0.78 ? 0.36 : 0.62,
            translucency: isTip && t > 0.75 ? Math.max(0.38, p.translucency) : p.translucency,
            detailMetric: isJunc ? 0.94 : isTip && t > 0.75 ? 0.96 : 0.45,
            anatomyLevel: level + 1,
            wind: [h01, evalElkFlex(pos), this.colonyPhase, 0],
            pivot: this.groundOrigin,
          };
        },
        regrow: (newOrigin: V3, newDir: V3) => {
          const rebuilt = buildElkNodes(newOrigin, newDir, len, lift, seedKey);
          stem.nodes = rebuilt;
          stem.length = rebuilt[rebuilt.length - 1].s;
        },
      };
      allStems.push(stem);
      return stem;
    };

    // Stout surf-swept pedestal trunk splitting into sweeping palmate moose-antler fronds!
    const pedH = H * 0.24;
    const trunk = makeAntlerFrond(
      add(this.groundOrigin, v3(0, -0.025, 0)),
      normalize(add(UP, v3(Math.sin(p.currentLeanDeg * DEG2RAD) * 0.25, 0, 0))),
      pedH,
      trunkR * 1.32,
      trunkR * 0.96,
      0,
      null,
      'root',
      0,
      false,
      0x7100,
    );

    const nBoughs = clamp(Math.round(p.colonyCount), 2, 4);
    const maxOrder = clamp(Math.round(p.branchOrder), 2, 3);
    const topNode = trunk.nodes[trunk.nodes.length - 1];

    for (let b = 0; b < nBoughs; b++) {
      const bAz = (b / nBoughs) * TAU + 0.28;
      const bOut = v3(Math.cos(bAz), 0, Math.sin(bAz));
      const perp = v3(-bOut.z, 0, bOut.x);
      // Characteristic horizontal-to-35-deg sweeping Acropora palmata surf boughs!
      const bDir = normalize(add(scale(UP, 0.46), scale(bOut, 0.88 * p.canopySpread)));
      const bLen = H * 0.36 * this.rng.vary(1.0, 0.08);
      const rB = trunkR * 0.56;

      const bough = makeAntlerFrond(
        topNode.pos,
        bDir,
        bLen,
        rB,
        rB * 0.88,
        1,
        trunk,
        'fork',
        trunk.length,
        false,
        0x7300 + b * 79,
      );
      trunk.forks.push(bough);

      const bEnd = bough.nodes[bough.nodes.length - 1];
      for (const fSign of [-1, 1]) {
        const fDir = normalize(
          add(scale(bEnd.dir, 0.78), add(scale(perp, fSign * 0.48 * p.canopySpread), v3(0, 0.14, 0))),
        );
        const palmPad = makeAntlerFrond(
          bEnd.pos,
          fDir,
          H * 0.32 * this.rng.vary(1.0, 0.09),
          rB * 0.78,
          rB * 0.68,
          2,
          bough,
          'fork',
          bough.length,
          maxOrder < 3,
          0x7500 + b * 61 + (fSign > 0 ? 13 : 5),
        );
        bough.forks.push(palmPad);

        if (maxOrder >= 3) {
          const pEnd = palmPad.nodes[palmPad.nodes.length - 1];
          // Broad palmate finger-tines fanning along the leading surf edge!
          for (const gSign of [-1, 1]) {
            const gDir = normalize(
              add(scale(pEnd.dir, 0.82), add(scale(perp, gSign * 0.36 * p.canopySpread), v3(0, 0.10, 0))),
            );
            const finger = makeAntlerFrond(
              pEnd.pos,
              gDir,
              H * 0.24 * this.rng.vary(1.0, 0.1),
              rB * 0.56,
              rB * 0.46,
              3,
              palmPad,
              'fork',
              palmPad.length,
              true,
              0x7700 + b * 43 + (fSign > 0 ? 10 : 0) + (gSign > 0 ? 7 : 2),
            );
            palmPad.forks.push(finger);
          }
        }
      }
    }

    const wStats = new WeldedMesher(skeletonMesh, [trunk], cfg).build();
    const topo = validateWeldedManifold(skeletonMesh);
    this.stats.weldedJunctions = wStats.junctions + wStats.forks;
    this.stats.closedManifold = topo.closed && topo.manifold && topo.components === 1;
    this.stats.stemsOrTubes = allStems.length;

    // Crowded tubular radial corallites across the sunlit upper surfaces of every Elkhorn blade!
    if (p.vesicleAbundance > 0.1) {
      const density = (tier >= 3 ? 64 : 34) * p.vesicleAbundance * p.organDensity;
      for (const st of allStems) {
        if (st.dropped || st.level === 0) continue;
        const nCups = Math.max(8, Math.round(st.length * density));
        for (let k = 0; k < nCups; k++) {
          const sFrac = lerp1(0.10, 0.90, k / Math.max(1, nCups - 1));
          const sPos = st.length * sFrac;
          const smp = sampleWeldedStem(st, sPos);
          const rBase = st.baseRadiusAt(sPos);
          // Concentrate corallites on sunlit upper face & margins (`th` around `+PI/2` and `0 / PI`)!
          const th = (k * GOLDEN_ANGLE) % Math.PI; // [0 .. PI] -> upper hemisphere!
          const up = cross(smp.dir, smp.right);
          const radVec = normalize(add(scale(smp.right, Math.cos(th)), scale(up, Math.sin(th))));
          const pFac = st.profileFactor ? st.profileFactor(sPos, th) : 1.0;
          const surfPt = addScaled(smp.pos, radVec, rBase * pFac * 0.90);
          const cupDir = normalize(add(scale(radVec, 0.76), scale(smp.dir, 0.65)));
          const cupLen = clamp(rBase * 0.34, 0.005, 0.013);
          const flex = evalElkFlex(smp.pos);

          this.emitClosedOvoid(
            polypsMesh,
            surfPt,
            cupDir,
            cupLen,
            cupLen * 0.42,
            5,
            4,
            colBlade,
            mixRgb(colPolyp, colMargin, 0.35),
            0.42,
            0.35,
            [sFrac, flex, this.colonyPhase, 0.006 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
  }

  // ===========================================================================
  // 27. TIERED REEF TABLE CORAL (Acropora hyacinthus)
  // ===========================================================================
  private buildTableCoralAcropora(
    tier: number,
    pedestalMesh: PartMesh,
    platesMesh: PartMesh,
    branchletsMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast);
    const colPlate = hexToLinearRgb(p.huePrimary);
    const colBranchlet = hexToLinearRgb(p.hueSecondary);
    const colGrowthRim = hexToLinearRgb(p.hueAccent); // Electric violet/blue peripheral growth margin!
    const colPolyp = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.32, p.colonyHeight);
    const nTables = clamp(Math.round(p.colonyCount), 1, 5);
    const maxSpan = Math.max(0.28, p.organLength * p.canopySpread);
    const stonyFlex = 0.015 * p.currentSway;

    // 1. Stout furrowed calcified reef pedestal supporting cantilevered tabulate decks!
    const pedCurve = growCurve(
      add(this.groundOrigin, v3(0, -0.025, 0)),
      normalize(add(UP, v3(0.14, 0, 0.08))),
      v3(1, 0, 0),
      H * 0.78,
      tier >= 3 ? 16 : 11,
      (t0, t1) => ({ pitch: -0.10 * (t1 - t0), yaw: 0.12 * (t1 - t0) }),
    );
    const pedBaseR = Math.max(0.055, H * 0.14);
    this.emitClosedTube(
      pedestalMesh,
      pedCurve,
      (t) => pedBaseR * (1.35 * Math.exp(-t * 4.2) + lerp1(0.72, 0.36, t)),
      tier >= 3 ? 20 : 14,
      (t) => mixRgb(colBase, colPlate, smoothstep(0.15, 0.9, t)),
      0,
      stonyFlex * 0.6,
      this.colonyPhase,
      0.66,
      0.18,
    );
    this.stats.stemsOrTubes++;

    // 2. Multi-tiered horizontal cantilevered tabulate coral plates with scalloped violet rims!
    const uCols = tier >= 3 ? 76 : 48;
    const vHalf = tier >= 3 ? 12 : 8; // Total rows = 2 * vHalf (underside -> rounded rim -> upper table deck!)

    for (let tb = 0; tb < nTables; tb++) {
      const tRng = this.rng.fork(0x8100 + tb * 97);
      const hFrac = nTables === 1 ? 0.92 : lerp1(0.48, 0.98, tb / (nTables - 1));
      const anchor = pedCurve.atT(hFrac);
      const plateAz = tb * 2.25 + 0.4;
      const cantDir = v3(Math.cos(plateAz), 0, Math.sin(plateAz));
      const plateR = maxSpan * (tb === nTables - 1 ? 1.0 : lerp1(0.72, 0.94, tb / nTables)) * tRng.vary(1.0, 0.08);
      const plateThick = Math.max(0.022, plateR * 0.075);
      // Eccentric cantilever offset so tiered Acropora tables overhang the reef ledge dramatically!
      const center = add(anchor.pos, scale(cantDir, plateR * 0.28));
      const deckFlex = stonyFlex * hFrac;

      const evalRimR = (th: number): number => {
        const lobes =
          (Math.sin(th * 5 + tb * 1.3) * 0.11 +
            Math.cos(th * 9 - tb) * 0.055 +
            Math.sin(th * 17 + 0.7) * 0.025) *
          p.ruffleWave;
        // Kidney/fan eccentricity away from pedestal
        const fanBias = 1 + 0.16 * Math.cos(th - plateAz);
        return plateR * fanBias * (1 + lobes);
      };

      const posG: V3[][] = [];
      const colG: RGB[][] = [];
      const windG: [number, number, number, number][][] = [];
      const totalRows = vHalf * 2;

      for (let r = 0; r <= totalRows; r++) {
        const isUpper = r >= vHalf;
        const rFrac = isUpper ? lerp1(1.0, 0.0, (r - vHalf) / vHalf) : lerp1(0.04, 1.0, r / vHalf);
        const pRow: V3[] = [];
        const cRow: RGB[] = [];
        const wRow: [number, number, number, number][] = [];

        for (let c = 0; c <= uCols; c++) {
          const th = (c / uCols) * TAU;
          const maxR = evalRimR(th);
          const rad = maxR * rFrac;
          // Radial anastomosing reticulate skeletal ribs!
          const ribWave = Math.cos(th * 42 + rFrac * 12.0) * plateThick * 0.18 * smoothstep(0.15, 0.95, rFrac);
          // Slight shallow vase upturn at the growing outer margin (`rFrac > 0.75`)
          const saucerLift = plateR * 0.085 * Math.pow(rFrac, 2.4);
          let yOff: number;
          if (!isUpper) {
            // Underside buttressed cone tapering smoothly down into pedestal
            const coneDown = -plateThick * (0.65 + 1.8 * Math.pow(1 - rFrac, 1.8));
            yOff = saucerLift + coneDown * Math.sin((r / vHalf) * (Math.PI * 0.5)) + ribWave * 0.5;
          } else {
            const rimRound = r === vHalf ? 0 : plateThick * 0.45 * Math.pow(1 - Math.pow(rFrac, 6.0), 0.5);
            yOff = saucerLift + rimRound + ribWave;
          }

          const pt = add(center, v3(Math.cos(th) * rad, yOff, Math.sin(th) * rad));
          let col = isUpper ? mixRgb(colPlate, colBranchlet, 0.45 * (0.5 + 0.5 * Math.cos(th * 42))) : mixRgb(colBase, colPlate, rFrac * 0.7);
          // Vivid glowing violet-blue peripheral growth margin!
          col = mixRgb(col, colGrowthRim, smoothstep(0.84, 1.0, rFrac) * 0.92);

          pRow.push(pt);
          cRow.push(col);
          wRow.push([rFrac, deckFlex * (0.4 + 0.6 * rFrac), this.colonyPhase, 0]);
        }
        posG.push(pRow);
        colG.push(cRow);
        windG.push(wRow);
      }
      this.emitSurfaceGrid(platesMesh, posG, colG, windG, 0.48, p.translucency);
      this.stats.stemsOrTubes++;

      // 3. Crowded vertical short tabulate branchlet tines (`frondsMesh`) & vivid axial polyps (`vesiclesMesh`) across upper deck!
      const nTines = Math.max(90, Math.round((tier >= 3 ? 280 : 140) * p.organDensity));
      for (let k = 0; k < nTines; k++) {
        const kRng = tRng.fork(0x400 + k * 37);
        const rFrac = lerp1(0.04, 0.96, Math.sqrt((k + 0.5) / nTines));
        const th = k * GOLDEN_ANGLE + kRng.range(-0.04, 0.04);
        const rad = evalRimR(th) * rFrac;
        const saucerLift = plateR * 0.085 * Math.pow(rFrac, 2.4) + plateThick * 0.42;
        const basePt = add(center, v3(Math.cos(th) * rad, saucerLift, Math.sin(th) * rad));
        const outDir = v3(Math.cos(th), 0, Math.sin(th));
        const tineDir = normalize(add(scale(UP, 0.88), scale(outDir, 0.35 * rFrac)));
        const tineLen = clamp(plateR * 0.072, 0.016, 0.038) * kRng.vary(1.0, 0.16);
        const localFlex = deckFlex * (0.4 + 0.6 * rFrac);

        this.emitClosedOvoid(
          branchletsMesh,
          addScaled(basePt, UP, -0.004),
          tineDir,
          tineLen,
          tineLen * 0.28,
          5,
          4,
          colBranchlet,
          rFrac > 0.80 ? colGrowthRim : mixRgb(colBranchlet, colGrowthRim, 0.45),
          0.42,
          p.translucency * 0.9,
          [rFrac, localFlex, this.colonyPhase, 0],
        );
        this.stats.bladesOrTentacles++;

        if (p.vesicleAbundance > 0.15 && k % 2 === 0) {
          const tipPt = addScaled(basePt, tineDir, tineLen * 0.92);
          this.emitClosedOvoid(
            polypsMesh,
            tipPt,
            tineDir,
            0.0075,
            0.0045,
            5,
            4,
            colGrowthRim,
            colPolyp,
            0.22,
            0.72,
            [rFrac, localFlex, this.colonyPhase, 0.012 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    platesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 28. GROOVED LABYRINTH BRAIN CORAL (Diploria labyrinthiformis)
  // ===========================================================================
  private buildBrainCoralDiploria(
    tier: number,
    domeMesh: PartMesh,
    skirtMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colSkirt = hexToLinearRgb(p.hueHoldfast);
    const colWallDark = hexToLinearRgb(p.huePrimary);
    const colRidge = hexToLinearRgb(p.hueSecondary);
    const colValleyNeon = hexToLinearRgb(p.hueAccent); // Glowing neon-emerald/cyan ambulacral valleys!
    const colPolyp = hexToLinearRgb(p.huePolyp);

    const domeR = Math.max(0.24, p.colonyHeight * 0.56 * p.canopySpread);
    const domeH = Math.max(0.20, p.colonyHeight * 0.68);
    const stonyFlex = 0.01 * p.currentSway;
    const seedBase = (this.rng.next() * 4096) | 0;

    // Continuous 3D Domain-Warped Turing Labyrinth Field on the Coral Hemisphere!
    const evalLabyrinth = (ux: number, uy: number, uz: number): { heightOff: number; valleyMask: number; crestGroove: number } => {
      const freq = 7.8 * clamp(p.organDensity, 0.65, 1.65);
      const wx = fbm3(ux * 1.65 + 3.1, uy * 1.65, uz * 1.65, seedBase + 11, 2);
      const wy = fbm3(ux * 1.65, uy * 1.65 + 7.4, uz * 1.65, seedBase + 29, 2);
      const wz = fbm3(ux * 1.65, uy * 1.65, uz * 1.65 + 5.7, seedBase + 53, 2);
      const phase =
        (ux + wx * 0.85) * freq +
        (uz + wz * 0.85) * freq * 0.88 +
        (uy + wy * 0.65) * freq * 0.54 +
        2.4 * fbm3(ux * 2.1 + wx, uy * 2.1 + wy, uz * 2.1 + wz, seedBase + 97, 2);

      const s = Math.sin(phase);
      const absS = Math.abs(s); // 0 = deep meandering valley floor -> 1 = colline ridge crest!
      const valleyMask = 1 - smoothstep(0.08, 0.46, absS);
      // Signature Diploria labyrinthiformis ambulacral groove right along the top of every ridge (`absS -> 1`)!
      const crestGroove = smoothstep(0.76, 1.0, absS) * 0.22;
      const ridgeProfile = smoothstep(0.10, 0.76, absS) - crestGroove;
      const amp = domeR * (0.042 + 0.052 * p.ruffleWave);
      return { heightOff: (ridgeProfile - 0.35) * amp, valleyMask, crestGroove };
    };

    // 1. High-Resolution Sculpted Labyrinth Hemisphere (`uCols x vRows` -> ~28k crisp labyrinth triangles!)
    const uCols = tier >= 3 ? 168 : 104;
    const vRows = tier >= 3 ? 84 : 52;
    const posG: V3[][] = [];
    const colG: RGB[][] = [];
    const windG: [number, number, number, number][][] = [];

    for (let r = 0; r <= vRows; r++) {
      const vf = r / vRows; // 0 = basal rim -> 1 = zenith pole
      const elev = lerp1(-0.14, Math.PI * 0.495, vf); // Slight undercut tuck at base of boulder!
      const cosE = Math.cos(elev);
      const sinE = Math.sin(elev);
      const pRow: V3[] = [];
      const cRow: RGB[] = [];
      const wRow: [number, number, number, number][] = [];

      for (let c = 0; c <= uCols; c++) {
        const th = (c / uCols) * TAU;
        // Organic boulder asymmetry
        const boulderWobble = 1 + 0.07 * Math.sin(th * 3 + 0.6) + 0.04 * Math.cos(th * 5 - 0.9);
        const ux = cosE * Math.cos(th) * boulderWobble;
        const uz = cosE * Math.sin(th) * boulderWobble;
        const uy = Math.max(-0.15, sinE);

        const lab = evalLabyrinth(ux, uy + 0.35, uz);
        const skirtFade = smoothstep(0.04, 0.18, vf);
        const disp = lab.heightOff * skirtFade;
        const nDir = normalize(v3(ux, Math.max(0.05, uy * (domeR / domeH)), uz));
        const basePt = v3(ux * domeR, Math.max(-0.01, (sinE + 0.14) * domeH * 0.88), uz * domeR);
        const pt = add(this.groundOrigin, addScaled(basePt, nDir, disp));

        let col = mixRgb(colWallDark, colRidge, smoothstep(-0.01, 0.025, lab.heightOff));
        if (lab.crestGroove > 0.02) col = mixRgb(col, colWallDark, lab.crestGroove * 2.4);
        col = mixRgb(col, colValleyNeon, lab.valleyMask * skirtFade * 0.92);
        col = mixRgb(colSkirt, col, smoothstep(0.0, 0.14, vf));

        pRow.push(pt);
        cRow.push(col);
        wRow.push([vf, stonyFlex * vf, this.colonyPhase, 0]);
      }
      posG.push(pRow);
      colG.push(cRow);
      windG.push(wRow);
    }
    this.emitSurfaceGrid(domeMesh, posG, colG, windG, 0.52, p.translucency);
    this.stats.stemsOrTubes = 1;

    // 2. Calcified Epitheca Basal Pedestal Skirt (`stipeMesh`) anchoring boulder to reef rock!
    const skirtCurve = growCurve(
      add(this.groundOrigin, v3(0, -0.025, 0)),
      UP,
      v3(1, 0, 0),
      domeH * 0.16,
      5,
      () => ({}),
    );
    this.emitClosedTube(
      skirtMesh,
      skirtCurve,
      (t) => domeR * lerp1(1.04, 0.94, t),
      tier >= 3 ? 40 : 28,
      (t) => mixRgb(colSkirt, colWallDark, t * 0.6),
      0,
      stonyFlex * 0.15,
      this.colonyPhase,
      0.78,
      0.1,
    );

    // 3. Glowing Valley Polyps (`vesiclesMesh`) nestled along the meandering labyrinth troughs!
    if (p.vesicleAbundance > 0.15) {
      const nCandidates = tier >= 3 ? 520 : 280;
      for (let k = 0; k < nCandidates; k++) {
        const vf = lerp1(0.18, 0.94, Math.sqrt((k + 0.5) / nCandidates));
        const elev = lerp1(-0.14, Math.PI * 0.495, vf);
        const th = k * GOLDEN_ANGLE;
        const boulderWobble = 1 + 0.07 * Math.sin(th * 3 + 0.6) + 0.04 * Math.cos(th * 5 - 0.9);
        const ux = Math.cos(elev) * Math.cos(th) * boulderWobble;
        const uz = Math.cos(elev) * Math.sin(th) * boulderWobble;
        const uy = Math.sin(elev);
        const lab = evalLabyrinth(ux, uy + 0.35, uz);
        if (lab.valleyMask > 0.62) {
          const nDir = normalize(v3(ux, Math.max(0.1, uy * (domeR / domeH)), uz));
          const basePt = v3(ux * domeR, (uy + 0.14) * domeH * 0.88, uz * domeR);
          const pt = add(this.groundOrigin, addScaled(basePt, nDir, lab.heightOff));
          this.emitClosedOvoid(
            polypsMesh,
            pt,
            nDir,
            0.010,
            0.0055,
            5,
            4,
            colValleyNeon,
            colPolyp,
            0.22,
            0.75,
            [vf, stonyFlex * vf, this.colonyPhase, 0.01 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    domeMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 29. WHORLED ROSE-SCROLL / VASE CORAL (Montipora capricornis / Turbinaria)
  // ===========================================================================
  private buildWhorledScrollMontipora(
    tier: number,
    baseMesh: PartMesh,
    whorlsMesh: PartMesh,
    verrucaeMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast);
    const colCupDeep = hexToLinearRgb(p.huePrimary);
    const colScrollMid = hexToLinearRgb(p.hueSecondary);
    const colRimNeon = hexToLinearRgb(p.hueAccent); // Luminous electric cyan/white calcifying rim!
    const colPolyp = hexToLinearRgb(p.huePolyp); // Contrasting gold/yellow Montipora verrucae polyps!

    const H = Math.max(0.28, p.colonyHeight);
    const nWhorls = clamp(Math.round(p.colonyCount), 4, 16);
    const maxPetalR = Math.max(0.22, p.organLength * p.canopySpread);
    const stonyFlex = 0.016 * p.currentSway;

    // 1. Central calcified coenosteum pedestal & inner spiral core (`holdfastMesh`)!
    const coreCurve = growCurve(
      add(this.groundOrigin, v3(0, -0.02, 0)),
      UP,
      v3(1, 0, 0),
      H * 0.56,
      10,
      () => ({}),
    );
    this.emitClosedTube(
      baseMesh,
      coreCurve,
      (t) => maxPetalR * lerp1(0.32, 0.12, t),
      tier >= 3 ? 22 : 14,
      (t) => mixRgb(colBase, colCupDeep, t),
      0,
      stonyFlex * 0.5,
      this.colonyPhase,
      0.62,
      0.22,
    );
    this.stats.stemsOrTubes = 1;

    // 2. Ascending Phyllotactic Logarithmic Rose-Scroll Foliose Whorls (`frondsMesh`)!
    const rHalf = tier >= 3 ? 10 : 7; // Two-sided solid calcareous scroll plates (underside -> glowing rim -> upper face)!
    const uCols = tier >= 3 ? 38 : 26;

    for (let w = 0; w < nWhorls; w++) {
      const wRng = this.rng.fork(0x8500 + w * 73);
      const frac = w / Math.max(1, nWhorls - 1); // 0 = inner upright funnel scroll -> 1 = wide outer basal skirt!
      const azCenter = w * GOLDEN_ANGLE;
      // Wide 210-to-260 degree wrap-around rose-scroll arc per foliose lamina!
      const arcSpan = lerp1(2.2, 1.55, frac) * Math.PI * 0.72;
      const petalLen = maxPetalR * lerp1(0.46, 1.06, Math.pow(frac, 0.72)) * wRng.vary(1.0, 0.07);
      const baseY = H * lerp1(0.48, 0.12, frac);
      const cupPitch = lerp1(0.95, 0.34, frac); // Inner whorls cup steeply like a rose chalice; outer whorls flare wide!
      const thick = Math.max(0.011, petalLen * 0.042);

      const evalScrollPt = (rf: number, uf: number, sideSign: number): V3 => {
        const th = azCenter + (uf - 0.5) * arcSpan + rf * 0.32; // Gentle logarithmic spiral twist!
        const endTaper = Math.pow(Math.sin(uf * Math.PI), 0.38);
        const rimRuffle =
          (Math.sin(uf * Math.PI * 5 + w) * 0.11 + Math.cos(uf * Math.PI * 9 - w) * 0.05) *
          p.ruffleWave *
          Math.pow(rf, 1.5);
        const rLocal = petalLen * (0.12 + 0.88 * rf * endTaper) * (1 + rimRuffle * 0.45);
        const yLocal =
          baseY +
          petalLen * Math.pow(rf * endTaper, 1.35) * cupPitch +
          petalLen * rimRuffle * 0.52;
        const radVec = v3(Math.cos(th), 0, Math.sin(th));
        const nApprox = normalize(add(scale(UP, 0.84), scale(radVec, -0.45 * cupPitch)));
        const halfThick = thick * 0.5 * Math.sin(Math.acos(clamp(rf * 2 - 1, -1, 1)) * 0.35 + 0.55) * endTaper;
        return add(
          add(this.groundOrigin, addScaled(v3(0, yLocal, 0), radVec, rLocal)),
          scale(nApprox, sideSign * halfThick),
        );
      };

      const totalRows = rHalf * 2;
      const posG: V3[][] = [];
      const colG: RGB[][] = [];
      const windG: [number, number, number, number][][] = [];

      for (let r = 0; r <= totalRows; r++) {
        const isUpper = r >= rHalf;
        const rf = isUpper ? lerp1(1.0, 0.02, (r - rHalf) / rHalf) : lerp1(0.02, 1.0, r / rHalf);
        const sideSign = r === rHalf ? 0 : isUpper ? 1 : -1;
        const pRow: V3[] = [];
        const cRow: RGB[] = [];
        const wRow: [number, number, number, number][] = [];

        for (let c = 0; c <= uCols; c++) {
          const uf = c / uCols;
          const pt = evalScrollPt(rf, uf, sideSign);
          const ridgeTex = 0.5 + 0.5 * Math.cos(uf * 48.0);
          let col = isUpper
            ? mixRgb(colCupDeep, colScrollMid, smoothstep(0.15, 0.85, rf) * (0.72 + 0.28 * ridgeTex))
            : mixRgb(colBase, colCupDeep, rf * 0.65);
          // Iconic luminous white/cyan Montipora capricornis growth edge!
          const edgeDist = Math.max(rf, 1 - Math.sin(uf * Math.PI) * 0.85);
          col = mixRgb(col, colRimNeon, smoothstep(0.86, 1.0, Math.max(rf, edgeDist * rf)) * 0.94);

          pRow.push(pt);
          cRow.push(col);
          wRow.push([rf, stonyFlex * (0.3 + 0.7 * rf), this.colonyPhase, 0]);
        }
        posG.push(pRow);
        colG.push(cRow);
        windG.push(wRow);
      }
      this.emitSurfaceGrid(whorlsMesh, posG, colG, windG, 0.38, p.translucency);
      this.stats.bladesOrTentacles++;

      // 3. Peppered golden-yellow Montipora coenosteum verrucae & star polyps across the upper scroll face!
      if (p.vesicleAbundance > 0.15) {
        const nPolyps = Math.max(18, Math.round((tier >= 3 ? 44 : 24) * p.vesicleAbundance));
        for (let k = 0; k < nPolyps; k++) {
          const rf = lerp1(0.18, 0.88, Math.sqrt((k + 0.5) / nPolyps));
          const uf = lerp1(0.12, 0.88, ((k * 0.6180339887) % 1));
          const pt = evalScrollPt(rf, uf, 1.05);
          this.emitClosedOvoid(
            verrucaeMesh,
            addScaled(pt, UP, -0.002),
            UP,
            0.0085,
            0.0055,
            5,
            4,
            colScrollMid,
            colPolyp,
            0.26,
            0.65,
            [rf, stonyFlex * (0.3 + 0.7 * rf), this.colonyPhase, 0.008 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    whorlsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 30. CATHEDRAL PILLAR CORAL (Dendrogyra cylindricus — Furry Golden Spires!)
  // ===========================================================================
  private buildPillarCoralDendrogyra(
    tier: number,
    baseMesh: PartMesh,
    spiresMesh: PartMesh,
    tentaclesMesh: PartMesh,
    tipsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBase = hexToLinearRgb(p.hueHoldfast);
    const colSkeleton = hexToLinearRgb(p.huePrimary);
    const colFurShaft = hexToLinearRgb(p.hueSecondary);
    const colFurGold = hexToLinearRgb(p.hueAccent);
    const colTip = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.45, p.colonyHeight);
    const nSpires = clamp(Math.round(p.colonyCount), 2, 12);
    const baseSpreadR = Math.max(0.22, H * 0.28 * p.canopySpread);
    const spireStiffFlex = 0.022 * p.currentSway;

    // 1. Heavy Encrusting Reef Pavement Mound (`holdfastMesh`) anchoring the cathedral spires!
    const moundCols = tier >= 3 ? 44 : 28;
    const moundRows = tier >= 3 ? 12 : 8;
    const mPos: V3[][] = [];
    const mCol: RGB[][] = [];
    const mWind: [number, number, number, number][][] = [];
    for (let r = 0; r <= moundRows; r++) {
      const vf = r / moundRows;
      const elev = vf * Math.PI * 0.5;
      const pR: V3[] = [];
      const cR: RGB[] = [];
      const wR: [number, number, number, number][] = [];
      for (let c = 0; c <= moundCols; c++) {
        const th = (c / moundCols) * TAU;
        const lobe = 1 + 0.14 * Math.sin(th * 4 + 0.5) + 0.07 * Math.cos(th * 7);
        const rad = baseSpreadR * 1.18 * Math.cos(elev) * lobe;
        const y = H * 0.11 * Math.sin(elev) - 0.015;
        pR.push(add(this.groundOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
        cR.push(mixRgb(colBase, colSkeleton, vf));
        wR.push([vf, spireStiffFlex * 0.15 * vf, this.colonyPhase, 0]);
      }
      mPos.push(pR);
      mCol.push(cR);
      mWind.push(wR);
    }
    this.emitSurfaceGrid(baseMesh, mPos, mCol, mWind, 0.65, 0.2);

    // 2. Towering Vertical Cylindrical Cathedral Spires (`stipeMesh`) + Shaggy Daylight Polyp Coat (`frondsMesh`)!
    const currentDir = normalize(v3(0.84, 0, 0.54));

    for (let s = 0; s < nSpires; s++) {
      const sRng = this.rng.fork(0x8900 + s * 89);
      const frac = s / Math.max(1, nSpires - 1);
      const az = s * GOLDEN_ANGLE + sRng.range(-0.14, 0.14);
      const dist = s === 0 ? 0 : baseSpreadR * lerp1(0.38, 0.92, Math.sqrt(frac));
      const spireOrigin = add(
        this.groundOrigin,
        v3(Math.cos(az) * dist, H * 0.05 * (1 - 0.5 * frac), Math.sin(az) * dist),
      );

      const spireH = H * (s === 0 ? 0.96 : lerp1(0.86, 0.36, frac) * sRng.vary(1.0, 0.12));
      const spireR = Math.max(0.042, H * 0.068 * clamp(p.organWidth / 0.26, 0.7, 1.45) * (s === 0 ? 1.08 : lerp1(0.96, 0.72, frac)));
      const phase = (this.colonyPhase + s * 0.004) % 1;

      const spireCurve = growCurve(
        spireOrigin,
        normalize(add(UP, v3(sRng.range(-0.04, 0.04), 0, sRng.range(-0.04, 0.04)))),
        v3(1, 0, 0),
        spireH,
        tier >= 3 ? 18 : 12,
        (t0, t1) => ({ pitch: sRng.range(-0.04, 0.04) * (t1 - t0) }),
      );

      // Build rounded-summit stony pillar core
      const sides = tier >= 3 ? 20 : 14;
      const rings: number[][] = [];
      for (let i = 0; i < spireCurve.count; i++) {
        const fr = spireCurve.frameAtIndex(i);
        const t = fr.t;
        const baseButtress = 1 + 0.28 * Math.exp(-t * 7.0);
        const domeCap = t > 0.86 ? Math.cos(((t - 0.86) / 0.14) * (Math.PI * 0.46)) : 1.0;
        const taper = lerp1(1.0, 0.82, t);
        const flex = Math.pow(t, 1.5) * spireStiffFlex * (spireH / H);
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          const meander = 1 + 0.045 * Math.sin(th * 8 + t * 22.0) * p.ruffleWave;
          const rHere = spireR * baseButtress * taper * domeCap * meander;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere);
          row.push(
            spiresMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: t,
              color: mixRgb(colBase, colSkeleton, smoothstep(0.05, 0.75, t)),
              wind: [t, flex, phase, 0],
              pivot: this.groundOrigin,
              roughness: 0.58,
              translucency: 0.2,
              detailMetric: 0.45,
              anatomyLevel: 1,
            }),
          );
        }
        rings.push(row);
      }
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          spiresMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
        }
      }
      const topFr = spireCurve.atT(1.0);
      const capV = spiresMesh.addVertex({
        x: topFr.pos.x + topFr.dir.x * spireR * 0.14,
        y: topFr.pos.y + topFr.dir.y * spireR * 0.14,
        z: topFr.pos.z + topFr.dir.z * spireR * 0.14,
        nx: topFr.dir.x, ny: topFr.dir.y, nz: topFr.dir.z,
        tx: topFr.right.x, ty: topFr.right.y, tz: topFr.right.z,
        u: 0.5, v: 1,
        color: colSkeleton,
        wind: [1, spireStiffFlex * (spireH / H), phase, 0],
        pivot: this.groundOrigin,
        roughness: 0.55,
        translucency: 0.2,
        detailMetric: 0.6,
        anatomyLevel: 1,
      });
      const lastR = rings[rings.length - 1];
      for (let j = 0; j < sides; j++) {
        spiresMesh.addTri(lastR[j], lastR[(j + 1) % sides], capV);
      }
      this.stats.stemsOrTubes++;

      // Shaggy Coat of Swaying Daylight Golden-Brown Polyp Tentacles (`frondsMesh`) furring every spire!
      const nFur = Math.max(110, Math.round((tier >= 3 ? 380 : 195) * p.organDensity * (spireH / H)));
      const furBaseLen = clamp(p.organLength, 0.040, 0.13);
      for (let f = 0; f < nFur; f++) {
        const fRng = sRng.fork(0x300 + f * 31);
        const t = lerp1(0.05, 0.985, (f + 0.5) / nFur);
        const fr = spireCurve.atT(t);
        const domeCap = t > 0.86 ? Math.cos(((t - 0.86) / 0.14) * (Math.PI * 0.46)) : 1.0;
        const rSurf = spireR * (1 + 0.28 * Math.exp(-t * 7.0)) * lerp1(1.0, 0.82, t) * domeCap;
        const th = f * GOLDEN_ANGLE;
        const rad = normalize(add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th))));
        const startPt = addScaled(fr.pos, rad, rSurf * 0.92);
        const outDir = normalize(
          add(
            scale(rad, t > 0.9 ? 0.55 : 0.88),
            add(scale(fr.dir, t > 0.9 ? 0.82 : 0.28), scale(currentDir, 0.22)),
          ),
        );
        const fLen = furBaseLen * fRng.vary(1.0, 0.18);
        const fRad = Math.max(0.0032, fLen * 0.095);
        const attachFlex = Math.pow(t, 1.5) * spireStiffFlex * (spireH / H);

        const fCurve = growCurve(startPt, outDir, anyPerpendicular(outDir), fLen, 4, (t0, t1) => ({
          pitch: (-0.42 + fRng.range(-0.35, 0.35)) * (t1 - t0),
          yaw: fRng.range(-0.4, 0.4) * (t1 - t0),
        }));
        this.emitCappedTentacleTube(
          tentaclesMesh,
          fCurve,
          4,
          (uF) => Math.max(0.0008, fRad * (1 - 0.55 * uF)),
          (uF) => mixRgb(colFurShaft, colFurGold, smoothstep(0.15, 0.92, uF)),
          attachFlex,
          0.16 * p.currentSway,
          0.22 * p.currentSway,
          phase,
          0.26,
          p.translucency,
        );
        this.stats.bladesOrTentacles++;

        if (p.vesicleAbundance > 0.2 && f % 4 === 0) {
          const tipF = fCurve.atT(1.0);
          this.emitClosedOvoid(
            tipsMesh,
            addScaled(tipF.pos, tipF.dir, -0.002),
            tipF.dir,
            0.006,
            0.0038,
            4,
            4,
            colFurGold,
            colTip,
            0.22,
            0.7,
            [1, attachFlex + 0.16 * p.currentSway, phase, 0.22 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    }
    baseMesh.hasExplicitNormals = true;
    spiresMesh.hasExplicitNormals = true;
    tentaclesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 31. OPALESCENT PEARL BUBBLE CORAL (Plerogyra sinuosa)
  // ===========================================================================
  private buildBubbleCoralPlerogyra(
    tier: number,
    baseMesh: PartMesh,
    calycesMesh: PartMesh,
    sweepersMesh: PartMesh,
    bubblesMesh: PartMesh,
  ): void {
    const p = this.p;
    const colSkeleton = hexToLinearRgb(p.hueHoldfast);
    const colMintDeep = hexToLinearRgb(p.huePrimary);
    const colPearlMid = hexToLinearRgb(p.hueSecondary);
    const colPearlApex = hexToLinearRgb(p.hueAccent);
    const colSweeper = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.28, p.colonyHeight);
    const domeR = Math.max(0.22, H * 0.62 * p.canopySpread);
    const domeH = H * 0.68;
    const baseFlex = 0.025 * p.currentSway;

    // 1. Calcified Stony Corallum Base (`holdfastMesh`) + Septate Stony Corallite Cups (`stipeMesh`)!
    const pedCurve = growCurve(add(this.groundOrigin, v3(0, -0.02, 0)), UP, v3(1, 0, 0), domeH * 0.42, 6, () => ({}));
    this.emitClosedTube(
      baseMesh,
      pedCurve,
      (t) => domeR * lerp1(0.54, 0.78, Math.pow(t, 0.65)),
      tier >= 3 ? 28 : 18,
      () => colSkeleton,
      0,
      baseFlex * 0.4,
      this.colonyPhase,
      0.74,
      0.14,
    );
    this.stats.stemsOrTubes++;

    const nCalyces = clamp(Math.round(p.colonyCount), 6, 18);
    for (let c = 0; c < nCalyces; c++) {
      const az = (c / nCalyces) * TAU + 0.2;
      const out = normalize(v3(Math.cos(az) * 0.85, 0.52, Math.sin(az) * 0.85));
      const cOrigin = add(this.groundOrigin, v3(Math.cos(az) * domeR * 0.56, domeH * 0.24, Math.sin(az) * domeR * 0.56));
      const cCurve = growCurve(cOrigin, out, anyPerpendicular(out), domeR * 0.28, 4, () => ({}));
      // Fluted 12-septa stony Plerogyra calyx wall peeking out beneath the bubble vesicles!
      const sides = 24;
      const rings: number[][] = [];
      for (let i = 0; i < cCurve.count; i++) {
        const fr = cCurve.frameAtIndex(i);
        const t = fr.t;
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          const septa = 1 + 0.14 * Math.cos(th * 12) * smoothstep(0.3, 1.0, t);
          const rHere = domeR * 0.14 * lerp1(0.62, 1.08, t) * septa;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere);
          row.push(
            calycesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: t,
              color: mixRgb(colSkeleton, colMintDeep, t * 0.35),
              wind: [t, baseFlex * 0.5, this.colonyPhase, 0],
              pivot: this.groundOrigin,
              roughness: 0.68,
              translucency: 0.16,
              detailMetric: 0.6,
              anatomyLevel: 1,
            }),
          );
        }
        rings.push(row);
      }
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          calycesMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
        }
      }
      this.stats.stemsOrTubes++;
    }

    // 2. Tightly Packed Mound of Plump Opalescent Grape-Like Daytime Pearl Vesicles (`vesiclesMesh`)!
    const nBubbles = Math.max(55, Math.round((tier >= 3 ? 132 : 76) * p.organDensity));
    const baseVesicleLen = clamp(p.organLength, 0.06, 0.18);

    for (let b = 0; b < nBubbles; b++) {
      const bRng = this.rng.fork(0x9100 + b * 59);
      const frac = (b + 0.4) / nBubbles;
      const elev = lerp1(Math.PI * 0.49, 0.14, Math.sqrt(frac));
      const az = b * GOLDEN_ANGLE + bRng.range(-0.08, 0.08);

      const cosE = Math.cos(elev);
      const sinE = Math.sin(elev);
      const wobble = 1 + 0.10 * Math.sin(az * 3 + 0.5) + 0.06 * Math.cos(az * 5 - 0.8);
      const nDir = normalize(v3(cosE * Math.cos(az), Math.max(0.22, sinE), cosE * Math.sin(az)));
      const anchor = add(
        this.groundOrigin,
        v3(
          cosE * Math.cos(az) * domeR * 0.82 * wobble,
          domeH * 0.22 + sinE * domeH * 0.66,
          cosE * Math.sin(az) * domeR * 0.82 * wobble,
        ),
      );

      // Sculpted oblate/kidney-plump water-filled Plerogyra bubble vesicle!
      const vLen = baseVesicleLen * lerp1(1.08, 0.78, frac) * bRng.vary(1.0, 0.14);
      const vRadA = vLen * 0.64 * clamp(p.organWidth / 0.48, 0.75, 1.35);
      const vRadB = vRadA * bRng.range(0.68, 0.86); // Slight natural oval/kidney compression!
      const rotYaw = bRng.range(0, TAU);
      const axR = anyPerpendicular(nDir);
      const axU = cross(nDir, axR);
      const e1 = add(scale(axR, Math.cos(rotYaw)), scale(axU, Math.sin(rotYaw)));
      const e2 = cross(nDir, e1);

      const bFlex = baseFlex + (0.055 + 0.045 * (1 - frac)) * p.currentSway;
      const bFlut = 0.06 * p.currentSway;
      const bPhase = (this.colonyPhase + ((az / TAU) % 1) * 0.02) % 1;

      const uSeg = tier >= 3 ? 12 : 8;
      const vSeg = tier >= 3 ? 8 : 6;
      const vBot = bubblesMesh.addVertex({
        x: anchor.x, y: anchor.y, z: anchor.z,
        nx: -nDir.x, ny: -nDir.y, nz: -nDir.z,
        tx: e1.x, ty: e1.y, tz: e1.z,
        u: 0.5, v: 0,
        color: colMintDeep,
        wind: [0, bFlex * 0.6, bPhase, 0],
        pivot: this.groundOrigin,
        roughness: 0.12,
        translucency: p.translucency,
        detailMetric: 0.4,
        anatomyLevel: 3,
      });

      const vRings: number[][] = [];
      for (let r = 1; r < vSeg; r++) {
        const tv = r / vSeg;
        const phi = tv * Math.PI;
        // Plump top-heavy grape/teardrop bladder silhouette!
        const prof = Math.sin(phi) * (0.82 + 0.28 * Math.sin(tv * Math.PI * 0.85));
        const zAlong = (0.5 - 0.5 * Math.cos(phi)) * vLen;
        const rowFlex = lerp1(bFlex * 0.6, bFlex, tv);
        const row: number[] = [];

        for (let j = 0; j < uSeg; j++) {
          const th = (j / uSeg) * TAU;
          // Subtle kidney dimple + pale translucent internal Plerogyra finger-dapple striations!
          const dimple = 1 - 0.08 * p.ruffleWave * Math.sin(th) * smoothstep(0.35, 0.85, tv);
          const rx = Math.cos(th) * vRadA * prof * dimple;
          const ry = Math.sin(th) * vRadB * prof * dimple;
          const radOff = add(scale(e1, rx), scale(e2, ry));
          const pt = add(addScaled(anchor, nDir, zAlong), radOff);
          const nOut = normalize(add(scale(radOff, 1 / Math.max(1e-4, vRadA)), scale(nDir, -Math.cos(phi) * 0.85)));

          const striation = Math.pow(0.5 + 0.5 * Math.cos(th * 7 + tv * 4.0), 3.0) * smoothstep(0.35, 0.95, tv);
          let col = mixRgb(colMintDeep, colPearlMid, smoothstep(0.15, 0.72, tv));
          col = mixRgb(col, colPearlApex, smoothstep(0.68, 1.0, tv) * 0.75 + striation * 0.35);

          row.push(
            bubblesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nOut.x, ny: nOut.y, nz: nOut.z,
              tx: nDir.x, ty: nDir.y, tz: nDir.z,
              u: j / uSeg, v: tv,
              color: col,
              wind: [tv, rowFlex, bPhase, bFlut * tv * tv],
              pivot: this.groundOrigin,
              roughness: 0.08, // Wet translucent pearl sheen!
              translucency: Math.max(0.82, p.translucency),
              detailMetric: tv,
              anatomyLevel: 3,
            }),
          );
        }
        vRings.push(row);
      }

      const apexPt = addScaled(anchor, nDir, vLen);
      const vTop = bubblesMesh.addVertex({
        x: apexPt.x, y: apexPt.y, z: apexPt.z,
        nx: nDir.x, ny: nDir.y, nz: nDir.z,
        tx: e1.x, ty: e1.y, tz: e1.z,
        u: 0.5, v: 1,
        color: colPearlApex,
        wind: [1, bFlex, bPhase, bFlut],
        pivot: this.groundOrigin,
        roughness: 0.08,
        translucency: Math.max(0.85, p.translucency),
        detailMetric: 1,
        anatomyLevel: 3,
      });

      for (let j = 0; j < uSeg; j++) {
        bubblesMesh.addTri(vBot, vRings[0][(j + 1) % uSeg], vRings[0][j]);
      }
      for (let r = 0; r < vRings.length - 1; r++) {
        for (let j = 0; j < uSeg; j++) {
          const j1 = (j + 1) % uSeg;
          bubblesMesh.addQuad(vRings[r][j], vRings[r][j1], vRings[r + 1][j1], vRings[r + 1][j]);
        }
      }
      const last = vRings[vRings.length - 1];
      for (let j = 0; j < uSeg; j++) {
        bubblesMesh.addTri(last[j], last[(j + 1) % uSeg], vTop);
      }
      this.stats.vesiclesOrPolyps++;

      // Delicate streaming sweeper tentacles (`frondsMesh`) peeking out between Plerogyra bubbles!
      if (p.vesicleAbundance > 0.25 && b % 4 === 1) {
        const swLen = baseVesicleLen * 1.45 * bRng.vary(1.0, 0.2);
        const swCurve = growCurve(
          addScaled(anchor, nDir, vLen * 0.35),
          normalize(add(nDir, v3(0.28, 0.15, 0.18))),
          e1,
          swLen,
          7,
          (t0, t1) => ({
            pitch: (-0.55 + Math.sin(t1 * TAU) * 0.45) * (t1 - t0),
            yaw: bRng.range(-0.5, 0.5) * (t1 - t0),
          }),
        );
        this.emitCappedTentacleTube(
          sweepersMesh,
          swCurve,
          5,
          (uS) => Math.max(0.0008, 0.0042 * (1 - 0.72 * uS)),
          (uS) => mixRgb(colPearlMid, colSweeper, smoothstep(0.2, 0.95, uS)),
          bFlex * 0.7,
          0.18 * p.currentSway,
          0.22 * p.currentSway,
          bPhase,
          0.12,
          0.88,
        );
        this.stats.bladesOrTentacles++;
      }
    }
    calycesMesh.hasExplicitNormals = true;
    bubblesMesh.hasExplicitNormals = true;
    sweepersMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 32. ORANGE SUN CUP CORAL (Tubastraea faulkneri / coccinea)
  // ===========================================================================
  private buildSunCupTubastraea(
    tier: number,
    coenosteumMesh: PartMesh,
    cupsMesh: PartMesh,
    tentaclesMesh: PartMesh,
    mouthsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colBaseScarlet = hexToLinearRgb(p.hueHoldfast);
    const colCupOrange = hexToLinearRgb(p.huePrimary);
    const colRimTangerine = hexToLinearRgb(p.hueSecondary);
    const colGoldTent = hexToLinearRgb(p.hueAccent); // Blazing canary-gold starburst tentacles!
    const colTipYellow = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.24, p.colonyHeight);
    const moundR = Math.max(0.18, H * 0.56 * p.canopySpread);
    const moundH = H * 0.42;
    const cupStiffFlex = 0.025 * p.currentSway;

    // 1. Vivid Scarlet-Vermilion Coenosteum Cushion (`holdfastMesh`)!
    const mCols = tier >= 3 ? 40 : 28;
    const mRows = tier >= 3 ? 14 : 10;
    const posG: V3[][] = [];
    const colG: RGB[][] = [];
    const windG: [number, number, number, number][][] = [];
    for (let r = 0; r <= mRows; r++) {
      const vf = r / mRows;
      const elev = lerp1(-0.1, Math.PI * 0.5, vf);
      const pR: V3[] = [];
      const cR: RGB[] = [];
      const wR: [number, number, number, number][] = [];
      for (let c = 0; c <= mCols; c++) {
        const th = (c / mCols) * TAU;
        const bump = 1 + 0.12 * Math.sin(th * 5 + 0.4) + 0.06 * Math.cos(th * 8 - 1.1);
        const rad = moundR * Math.cos(elev) * bump;
        const y = Math.max(-0.015, (Math.sin(elev) + 0.1) * moundH);
        pR.push(add(this.groundOrigin, v3(Math.cos(th) * rad, y, Math.sin(th) * rad)));
        cR.push(mixRgb(colBaseScarlet, colCupOrange, smoothstep(0.1, 0.9, vf)));
        wR.push([vf, cupStiffFlex * 0.4 * vf, this.colonyPhase, 0]);
      }
      posG.push(pR);
      colG.push(cR);
      windG.push(wR);
    }
    this.emitSurfaceGrid(coenosteumMesh, posG, colG, windG, 0.46, 0.32);

    // 2. Bouquet of Tubular Scarlet Stony Corallite Cups (`stipeMesh`) + Blazing Gold Tentacle Crowns (`frondsMesh`)!
    const nCups = clamp(Math.round(p.colonyCount), 6, 40);
    const currentDir = normalize(v3(0.84, 0, 0.54));

    for (let k = 0; k < nCups; k++) {
      const cRng = this.rng.fork(0x9500 + k * 67);
      const frac = (k + 0.35) / nCups;
      const elev = lerp1(Math.PI * 0.48, 0.22, Math.sqrt(frac));
      const az = k * GOLDEN_ANGLE + cRng.range(-0.1, 0.1);
      const bump = 1 + 0.12 * Math.sin(az * 5 + 0.4) + 0.06 * Math.cos(az * 8 - 1.1);

      const cupDir = normalize(v3(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)));
      const cupOrigin = add(
        this.groundOrigin,
        v3(
          Math.cos(elev) * Math.cos(az) * moundR * 0.88 * bump,
          (Math.sin(elev) + 0.05) * moundH * 0.92,
          Math.cos(elev) * Math.sin(az) * moundR * 0.88 * bump,
        ),
      );

      const scaleC = lerp1(1.12, 0.74, frac) * cRng.vary(1.0, 0.12);
      const cupH = H * 0.26 * scaleC;
      const cupR = Math.max(0.020, cupH * 0.38 * clamp(p.organWidth / 0.24, 0.75, 1.4));
      const phase = (this.colonyPhase + ((az / TAU) % 1) * 0.02) % 1;
      const cupTopFlex = cupStiffFlex * (0.5 + 0.5 * (1 - frac));

      const right = anyPerpendicular(cupDir);
      const up = cross(cupDir, right);
      const sides = tier >= 3 ? 20 : 14;
      const rings: number[][] = [];

      // Outer volcanic corallite wall -> 12-septa notched rim -> recessed inner calyx crater!
      const stations: Array<{ h: number; rMul: number; inner: boolean }> = [
        { h: -0.01, rMul: 1.22, inner: false },
        { h: cupH * 0.45, rMul: 1.04, inner: false },
        { h: cupH * 0.92, rMul: 0.98, inner: false },
        { h: cupH * 1.0, rMul: 0.94, inner: false },
        { h: cupH * 0.96, rMul: 0.78, inner: true },
        { h: cupH * 0.68, rMul: 0.56, inner: true },
      ];

      for (let st = 0; st < stations.length; st++) {
        const sInfo = stations[st];
        const z = clamp(sInfo.h / cupH, 0, 1);
        const flex = cupTopFlex * z;
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          // 12 radial calcareous septa blades lining the Tubastraea calyx rim!
          const septa = sInfo.inner || st >= 2 ? 0.08 * Math.cos(th * 12) : 0.03 * Math.cos(th * 12);
          const rHere = cupR * (sInfo.rMul + septa);
          const rad = add(scale(right, Math.cos(th)), scale(up, Math.sin(th)));
          const pt = add(addScaled(cupOrigin, cupDir, sInfo.h), scale(rad, rHere));
          const nrm = sInfo.inner ? normalize(add(scale(rad, -0.8), scale(cupDir, 0.6))) : rad;
          const col = sInfo.inner
            ? mixRgb(colRimTangerine, colCupOrange, 0.5)
            : mixRgb(colCupOrange, colRimTangerine, smoothstep(0.4, 1.0, z));
          row.push(
            cupsMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: nrm.x, ny: nrm.y, nz: nrm.z,
              tx: cupDir.x, ty: cupDir.y, tz: cupDir.z,
              u: j / sides, v: st / (stations.length - 1),
              color: col,
              wind: [z, flex, phase, 0],
              pivot: this.groundOrigin,
              roughness: 0.42,
              translucency: 0.35,
              detailMetric: z,
              anatomyLevel: 2,
            }),
          );
        }
        rings.push(row);
      }
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          cupsMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
        }
      }
      this.stats.stemsOrTubes++;

      // Glowing Tangerine Oral Disc & Mouth Cone (`vesiclesMesh`) inside every cup!
      const rimCenter = addScaled(cupOrigin, cupDir, cupH * 0.84);
      this.emitClosedOvoid(
        mouthsMesh,
        rimCenter,
        cupDir,
        cupR * 0.55,
        cupR * 0.52,
        7,
        4,
        colRimTangerine,
        colGoldTent,
        0.2,
        0.72,
        [0.85, cupTopFlex, phase, 0],
      );
      this.stats.vesiclesOrPolyps++;

      // 2-Whorl Starburst Crown of Canary-Gold Translucent Feeding Tentacles (`frondsMesh`)!
      const nTent = tier >= 3 ? 20 : 14;
      const baseTentLen = p.organLength * scaleC;
      for (let t = 0; t < nTent; t++) {
        const isInner = t % 2 === 0;
        const tTh = (t / nTent) * TAU + cRng.range(-0.06, 0.06);
        const rad = add(scale(right, Math.cos(tTh)), scale(up, Math.sin(tTh)));
        const tStart = add(addScaled(cupOrigin, cupDir, cupH * 0.90), scale(rad, cupR * (isInner ? 0.56 : 0.74)));
        const tLaunch = normalize(
          add(
            scale(cupDir, isInner ? 0.82 : 0.48),
            add(scale(rad, isInner ? 0.56 : 0.86), scale(currentDir, 0.16)),
          ),
        );
        const tLen = baseTentLen * (isInner ? 0.86 : 1.08) * cRng.vary(1.0, 0.12);
        const tBaseR = Math.max(0.0028, cupR * 0.14);
        const tCurve = growCurve(tStart, tLaunch, anyPerpendicular(tLaunch), tLen, tier >= 3 ? 8 : 5, (t0, t1) => ({
          pitch: (-0.42 - (isInner ? 0.15 : 0.35)) * (t1 - t0),
          yaw: cRng.range(-0.22, 0.22) * (t1 - t0),
        }));
        this.emitCappedTentacleTube(
          tentaclesMesh,
          tCurve,
          5,
          (uT) => Math.max(0.0007, tBaseR * Math.pow(1 - uT * 0.78, 0.78)),
          (uT) => mixRgb(colRimTangerine, mixRgb(colGoldTent, colTipYellow, uT), smoothstep(0.05, 0.45, uT)),
          cupTopFlex,
          0.20 * p.currentSway,
          0.24 * p.currentSway,
          phase,
          0.14,
          Math.max(0.75, p.translucency),
        );
        this.stats.bladesOrTentacles++;
      }
    }
    coenosteumMesh.hasExplicitNormals = true;
    cupsMesh.hasExplicitNormals = true;
    tentaclesMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 33. CRIMSON ORGAN-PIPE CORAL (Tubipora musica)
  // ===========================================================================
  private buildOrganPipeTubipora(
    tier: number,
    pipesMesh: PartMesh,
    decksMesh: PartMesh,
    starPolypsMesh: PartMesh,
    centersMesh: PartMesh,
  ): void {
    const p = this.p;
    const colDeepRuby = hexToLinearRgb(p.hueHoldfast);
    const colCrimsonPipe = hexToLinearRgb(p.huePrimary);
    const colCrimsonDeck = hexToLinearRgb(p.hueSecondary);
    const colSnowStar = hexToLinearRgb(p.hueAccent); // Snow-white 8-pinnate octocoral star arms!
    const colMintCenter = hexToLinearRgb(p.huePolyp);

    const H = Math.max(0.28, p.colonyHeight);
    const nPipes = clamp(Math.round(p.colonyCount), 12, 68);
    const bundleR = Math.max(0.18, H * 0.44 * p.canopySpread);
    const pipeStiffFlex = 0.024 * p.currentSway;

    // 1. Horizontal Calcified Crimson Stoloniferous Platform Decks (`stipeMesh`) bridging the vertical organ-pipes!
    const nDecks = clamp(Math.round(p.branchOrder), 2, 4);
    const deckCols = tier >= 3 ? 44 : 28;
    const deckHalf = 4;
    for (let d = 0; d < nDecks; d++) {
      const dFrac = lerp1(0.22, 0.76, d / Math.max(1, nDecks - 1));
      const deckY = H * dFrac * 0.84;
      const deckR = bundleR * lerp1(0.98, 1.06, dFrac);
      const posG: V3[][] = [];
      const colG: RGB[][] = [];
      const windG: [number, number, number, number][][] = [];

      for (let r = 0; r <= deckHalf * 2; r++) {
        const isUp = r >= deckHalf;
        const rf = isUp ? lerp1(1.0, 0.05, (r - deckHalf) / deckHalf) : lerp1(0.05, 1.0, r / deckHalf);
        const yOff = r === deckHalf ? 0 : (isUp ? 1 : -1) * 0.0075;
        const pR: V3[] = [];
        const cR: RGB[] = [];
        const wR: [number, number, number, number][] = [];
        for (let c = 0; c <= deckCols; c++) {
          const th = (c / deckCols) * TAU;
          const scallop = 1 + 0.07 * Math.sin(th * 9 + d * 1.4) + 0.04 * Math.cos(th * 15);
          const rad = deckR * rf * scallop;
          pR.push(add(this.groundOrigin, v3(Math.cos(th) * rad, deckY + yOff, Math.sin(th) * rad)));
          cR.push(mixRgb(colDeepRuby, colCrimsonDeck, isUp ? 0.85 : 0.35));
          wR.push([dFrac, Math.pow(dFrac, 1.5) * pipeStiffFlex, this.colonyPhase, 0]);
        }
        posG.push(pR);
        colG.push(cR);
        windG.push(wR);
      }
      this.emitSurfaceGrid(decksMesh, posG, colG, windG, 0.52, 0.18);
    }

    // 2. Parallel Vertical Ruby-Crimson Calcified Organ-Pipes (`holdfastMesh`) + Snow-White 8-Rayed Star Polyps (`frondsMesh`)!
    const pipeR = clamp(bundleR / (Math.sqrt(nPipes) * 1.48), 0.011, 0.026) * clamp(p.organWidth / 0.22, 0.75, 1.35);

    for (let k = 0; k < nPipes; k++) {
      const pRng = this.rng.fork(0x9900 + k * 53);
      const frac = (k + 0.4) / nPipes;
      const rDist = bundleR * 0.92 * Math.sqrt(frac);
      const az = k * GOLDEN_ANGLE + pRng.range(-0.05, 0.05);
      const radOut = v3(Math.cos(az), 0, Math.sin(az));

      // Rounded cathedral dome profile across the organ-pipe colony!
      const domeProfile = 1 - 0.34 * Math.pow(frac, 1.35);
      const pipeH = H * 0.88 * domeProfile * pRng.vary(1.0, 0.05);
      const splay = 0.14 * Math.sqrt(frac);
      const pipeDir = normalize(add(scale(UP, Math.cos(splay)), scale(radOut, Math.sin(splay))));
      const basePt = add(this.groundOrigin, v3(radOut.x * rDist * 0.86, -0.02, radOut.z * rDist * 0.86));
      const phase = (this.colonyPhase + ((az / TAU) % 1) * 0.015) % 1;
      const topFlex = pipeStiffFlex * domeProfile;

      const pipeCurve = growCurve(basePt, pipeDir, anyPerpendicular(pipeDir), pipeH, tier >= 3 ? 10 : 7, () => ({}));
      const sides = tier >= 3 ? 12 : 8;
      const rings: number[][] = [];
      for (let i = 0; i < pipeCurve.count; i++) {
        const fr = pipeCurve.frameAtIndex(i);
        const t = fr.t;
        const ringBulge = 1 + 0.05 * Math.sin(t * 28.0);
        const rHere = pipeR * ringBulge;
        const flex = Math.pow(t, 1.5) * topFlex;
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere);
          row.push(
            pipesMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: t,
              color: mixRgb(colDeepRuby, colCrimsonPipe, smoothstep(0.1, 0.9, t)),
              wind: [t, flex, phase, 0],
              pivot: this.groundOrigin,
              roughness: 0.48,
              translucency: 0.22,
              detailMetric: 0.5,
              anatomyLevel: 1,
            }),
          );
        }
        rings.push(row);
      }
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < sides; j++) {
          const j1 = (j + 1) % sides;
          pipesMesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
        }
      }
      this.stats.stemsOrTubes++;

      // Delicate Translucent Polyp Stalk + 8-Rayed Snow-White Octocoral Starburst Crown emerging from every crimson pipe!
      if (p.vesicleAbundance > 0.15) {
        const topFr = pipeCurve.atT(1.0);
        const neckH = pipeR * 1.15;
        const polypCenter = addScaled(topFr.pos, topFr.dir, neckH);
        this.emitClosedOvoid(
          centersMesh,
          topFr.pos,
          topFr.dir,
          neckH * 1.25,
          pipeR * 0.56,
          6,
          4,
          colMintCenter,
          colSnowStar,
          0.22,
          0.78,
          [1, topFlex, phase, 0],
        );
        this.stats.vesiclesOrPolyps++;

        const armLen = p.organLength * lerp1(1.05, 0.85, frac) * pRng.vary(1.0, 0.1);
        const yaw0 = pRng.range(0, TAU);
        for (let a = 0; a < 8; a++) {
          const aTh = yaw0 + (a / 8) * TAU;
          const rad = normalize(add(scale(topFr.right, Math.cos(aTh)), scale(topFr.up, Math.sin(aTh))));
          const armDir = normalize(add(scale(rad, 0.92), scale(topFr.dir, 0.38)));
          const armCurve = growCurve(polypCenter, armDir, topFr.dir, armLen, 5, (t0, t1) => ({
            pitch: -0.62 * (t1 - t0),
          }));
          // Flattened feathery pinnate octocoral arm!
          this.emitCappedTentacleTube(
            starPolypsMesh,
            armCurve,
            4,
            (uA) => {
              // Feathery marginal pinnule serration along each of the 8 star rays!
              const feather = 1 + 0.35 * Math.sin(uA * Math.PI * 7.0);
              return Math.max(0.0008, armLen * 0.11 * Math.sin(Math.PI * clamp(uA * 0.88 + 0.1, 0.05, 0.98)) * feather);
            },
            (uA) => mixRgb(colMintCenter, colSnowStar, smoothstep(0.08, 0.55, uA)),
            topFlex,
            0.16 * p.currentSway,
            0.20 * p.currentSway,
            phase,
            0.18,
            0.84,
          );
          this.stats.bladesOrTentacles++;
        }
      }
    }
    decksMesh.hasExplicitNormals = true;
    pipesMesh.hasExplicitNormals = true;
    starPolypsMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 34. TRANSLUCENT CARNATION SOFT CORAL TREE (Dendronephthya hemprichi)
  // ===========================================================================
  private buildCarnationTreeDendronephthya(
    tier: number,
    trunkMesh: PartMesh,
    branchesMesh: PartMesh,
    floretStalksMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colFoot = hexToLinearRgb(p.hueHoldfast);
    const colStalkPeach = hexToLinearRgb(p.huePrimary); // Glowing translucent peach-alabaster stalk!
    const colSclerite = hexToLinearRgb(p.hueSecondary); // Luminous ivory/white calcareous spindle sclerites!
    const colHotPink = hexToLinearRgb(p.hueAccent); // Blazing hot-magenta umbel florets!
    const colTangerine = hexToLinearRgb(p.huePolyp); // Fiery tangerine-coral floret contrast!

    const H = Math.max(0.38, p.colonyHeight);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;
    const trunkTopFlex = 0.22 * p.currentSway;

    // 1. Plump Inflated Hydrostatic Translucent Main Trunk (`holdfastMesh`)!
    const trunkInit = normalize(add(scale(UP, Math.cos(leanRad * 0.65)), scale(currentDir, Math.sin(leanRad * 0.65))));
    const trunkH = H * 0.68;
    const baseR = Math.max(0.068, H * 0.13 * clamp(p.organWidth / 0.32, 0.75, 1.45));
    const trunkCurve = growCurve(
      add(this.groundOrigin, v3(0, -0.02, 0)),
      trunkInit,
      anyPerpendicular(trunkInit),
      trunkH,
      tier >= 3 ? 20 : 14,
      (t0, t1) => ({
        pitch: (leanRad * 0.35 + Math.sin(t1 * Math.PI * 1.15) * 0.22) * (t1 - t0),
        yaw: 0.18 * Math.cos(t1 * Math.PI) * (t1 - t0),
      }),
    );

    const emitHydrostaticAxis = (
      mesh: PartMesh,
      curve: CurveLine,
      r0: number,
      r1: number,
      sides: number,
      flex0: number,
      flex1: number,
      phase: number,
      emitSclerites: boolean,
    ): void => {
      const rings: number[][] = [];
      for (let i = 0; i < curve.count; i++) {
        const fr = curve.frameAtIndex(i);
        const t = fr.t;
        const plump = Math.sin(t * Math.PI) * 0.14 + 1.0;
        const rHere = lerp1(r0, r1, Math.pow(t, 0.82)) * plump;
        const flex = lerp1(flex0, flex1, Math.pow(t, 1.4));
        const row: number[] = [];
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * TAU;
          // Soft hydrostatic folds + diagonal sclerite ribbing!
          const rib = 1 + 0.055 * Math.sin(th * 6 + t * 14.0) * p.ruffleWave;
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const pt = addScaled(fr.pos, rad, rHere * rib);
          const scleriteStripe = Math.pow(0.5 + 0.5 * Math.cos(th * 9 + t * 22.0), 6.0);
          let col = mixRgb(colFoot, colStalkPeach, smoothstep(0.0, 0.35, t));
          col = mixRgb(col, colSclerite, 0.35 + 0.45 * scleriteStripe);
          row.push(
            mesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              nx: rad.x, ny: rad.y, nz: rad.z,
              tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
              u: j / sides, v: t,
              color: col,
              wind: [t, flex, phase, 0],
              pivot: this.groundOrigin,
              roughness: 0.24,
              translucency: Math.max(0.84, p.translucency), // Glowing backlit hydrostatic coral body!
              detailMetric: 0.45 + 0.4 * scleriteStripe,
              anatomyLevel: 1,
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
      const endFr = curve.atT(1.0);
      const capIdx = mesh.addVertex({
        x: endFr.pos.x + endFr.dir.x * r1 * 0.35,
        y: endFr.pos.y + endFr.dir.y * r1 * 0.35,
        z: endFr.pos.z + endFr.dir.z * r1 * 0.35,
        nx: endFr.dir.x, ny: endFr.dir.y, nz: endFr.dir.z,
        tx: endFr.right.x, ty: endFr.right.y, tz: endFr.right.z,
        u: 0.5, v: 1,
        color: colSclerite,
        wind: [1, flex1, phase, 0],
        pivot: this.groundOrigin,
        roughness: 0.24,
        translucency: 0.86,
        detailMetric: 0.6,
        anatomyLevel: 1,
      });
      const last = rings[rings.length - 1];
      for (let j = 0; j < sides; j++) {
        mesh.addTri(last[j], last[(j + 1) % sides], capIdx);
      }

      // Embedded calcareous spindle sclerites (`vesiclesMesh`) gleaming along the translucent hydrostatic wall!
      if (emitSclerites && p.vesicleAbundance > 0.2) {
        const nSpindles = tier >= 3 ? 28 : 16;
        for (let sp = 0; sp < nSpindles; sp++) {
          const z = lerp1(0.12, 0.88, sp / (nSpindles - 1));
          const fr = curve.atT(z);
          const th = sp * GOLDEN_ANGLE;
          const rHere = lerp1(r0, r1, Math.pow(z, 0.82)) * (Math.sin(z * Math.PI) * 0.14 + 1.0);
          const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
          const tang = normalize(add(scale(fr.dir, 0.72), scale(cross(rad, fr.dir), 0.68)));
          const spPt = addScaled(fr.pos, rad, rHere * 0.98);
          this.emitClosedOvoid(
            polypsMesh,
            addScaled(spPt, tang, -rHere * 0.22),
            tang,
            rHere * 0.44,
            rHere * 0.065,
            4,
            4,
            colTangerine,
            colSclerite,
            0.18,
            0.85,
            [z, lerp1(flex0, flex1, Math.pow(z, 1.4)), phase, 0],
          );
        }
      }
    };

    emitHydrostaticAxis(trunkMesh, trunkCurve, baseR * 1.18, baseR * 0.32, tier >= 3 ? 22 : 14, 0, trunkTopFlex, this.colonyPhase, true);
    this.stats.stemsOrTubes++;

    // Helper that blossoms a lush hot-pink & tangerine Dendronephthya cauliflower umbel floret!
    const emitUmbelFloret = (
      origin: V3,
      dir: V3,
      umbelR: number,
      attachFlex: number,
      phase: number,
      seedKey: number,
    ): void => {
      const uRng = this.rng.fork(seedKey);
      const nSub = tier >= 3 ? 16 : 10;
      const right = anyPerpendicular(dir);
      const up = cross(dir, right);

      for (let s = 0; s < nSub; s++) {
        const sf = s / Math.max(1, nSub - 1);
        const az = s * GOLDEN_ANGLE;
        const rad = add(scale(right, Math.cos(az)), scale(up, Math.sin(az)));
        const subDir = normalize(add(scale(dir, lerp1(0.96, 0.38, sf)), scale(rad, lerp1(0.18, 0.92, sf))));
        const subLen = umbelR * lerp1(0.62, 0.84, sf) * uRng.vary(1.0, 0.14);
        const subCurve = growCurve(origin, subDir, anyPerpendicular(subDir), subLen, 4, (t0, t1) => ({
          pitch: 0.22 * (t1 - t0),
        }));
        const subFlex = attachFlex + 0.06 * p.currentSway;

        this.emitCappedTentacleTube(
          floretStalksMesh,
          subCurve,
          5,
          (uS) => Math.max(0.004, umbelR * 0.14 * (1 - 0.30 * uS)),
          (uS) => mixRgb(colSclerite, colHotPink, smoothstep(0.35, 1.0, uS) * 0.65),
          attachFlex,
          0.06 * p.currentSway,
          0.08 * p.currentSway,
          phase,
          0.22,
          0.86,
        );
        this.stats.bladesOrTentacles++;

        // Dense pom-pom bouquet of glowing magenta & tangerine coral polyps atop every umbel branchlet!
        const tip = subCurve.atT(1.0);
        const tipRight = anyPerpendicular(tip.dir);
        const tipUp = cross(tip.dir, tipRight);
        const nBuds = tier >= 3 ? 11 : 7;
        for (let b = 0; b < nBuds; b++) {
          const bAz = b * GOLDEN_ANGLE;
          const bRad = add(scale(tipRight, Math.cos(bAz)), scale(tipUp, Math.sin(bAz)));
          const bDir = normalize(add(scale(tip.dir, b === 0 ? 1.0 : 0.58), scale(bRad, b === 0 ? 0.0 : 0.82)));
          const budCol = (s + b) % 3 === 0 ? colTangerine : colHotPink;
          const budLen = umbelR * 0.30 * uRng.vary(1.0, 0.15);
          this.emitClosedOvoid(
            polypsMesh,
            addScaled(tip.pos, tip.dir, -budLen * 0.15),
            bDir,
            budLen,
            budLen * 0.48,
            5,
            4,
             budCol,
            mixRgb(budCol, colSclerite, 0.28),
            0.20,
            0.78,
            [1, subFlex, phase, 0.14 * p.currentSway],
          );
          this.stats.vesiclesOrPolyps++;
        }
      }
    };

    // 2. Spiraling Hydrostatic Side Boughs (`stipeMesh`) & Terminal Cauliflower Umbels!
    const nBranches = clamp(Math.round(p.colonyCount) + 2, 4, 12);
    for (let b = 0; b < nBranches; b++) {
      const bRng = this.rng.fork(0x9d00 + b * 79);
      const tAttach = lerp1(0.28, 0.92, b / Math.max(1, nBranches - 1));
      const fr = trunkCurve.atT(tAttach);
      const bAz = b * GOLDEN_ANGLE + bRng.range(-0.14, 0.14);
      const radOut = normalize(add(scale(fr.right, Math.cos(bAz)), scale(fr.up, Math.sin(bAz))));
      const bDir = normalize(add(scale(radOut, 0.82 * p.canopySpread), scale(UP, 0.56)));
      const bLen = p.organLength * lerp1(1.05, 0.64, (tAttach - 0.28) / 0.64) * bRng.vary(1.0, 0.12);
      const rTrunkHere = lerp1(baseR * 1.18, baseR * 0.52, Math.pow(tAttach, 0.82));
      const bStart = addScaled(fr.pos, radOut, rTrunkHere * 0.65);

      const attachFlex = Math.pow(tAttach, 1.4) * trunkTopFlex;
      const bTopFlex = attachFlex + 0.14 * p.currentSway;
      const bPhase = (this.colonyPhase + b * 0.005) % 1;

      const bCurve = growCurve(bStart, bDir, anyPerpendicular(bDir), bLen, tier >= 3 ? 10 : 7, (t0, t1) => ({
        pitch: 0.68 * (t1 - t0),
        yaw: bRng.range(-0.2, 0.2) * (t1 - t0),
      }));
      emitHydrostaticAxis(
        branchesMesh,
        bCurve,
        rTrunkHere * 0.54,
        rTrunkHere * 0.28,
        tier >= 3 ? 14 : 10,
        attachFlex,
        bTopFlex,
        bPhase,
        false,
      );
      this.stats.stemsOrTubes++;

      const bEnd = bCurve.atT(1.0);
      emitUmbelFloret(bEnd.pos, bEnd.dir, bLen * 0.44, bTopFlex, bPhase, 0xa200 + b * 41);

      // Secondary lateral floret lobe on larger lower boughs!
      if (b < nBranches * 0.65) {
        const mid = bCurve.atT(0.55);
        const sideDir = normalize(add(scale(mid.right, b % 2 === 0 ? 0.75 : -0.75), scale(UP, 0.65)));
        emitUmbelFloret(
          addScaled(mid.pos, sideDir, rTrunkHere * 0.35),
          sideDir,
          bLen * 0.34,
          lerp1(attachFlex, bTopFlex, 0.55),
          bPhase,
          0xa600 + b * 59,
        );
      }
    }

    // Lush apical crown umbel atop the main trunk!
    const apex = trunkCurve.atT(1.0);
    emitUmbelFloret(apex.pos, apex.dir, p.organLength * 0.48, trunkTopFlex, this.colonyPhase, 0xaa11);

    trunkMesh.hasExplicitNormals = true;
    branchesMesh.hasExplicitNormals = true;
    floretStalksMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // 35. BIOLUMINESCENT FEATHER SEA PEN (Pennatula phosphorea / Pteroeides)
  // ===========================================================================
  private buildBiolumSeaPenPennatula(
    tier: number,
    peduncleMesh: PartMesh,
    rachisMesh: PartMesh,
    pinnaeMesh: PartMesh,
    polypsMesh: PartMesh,
  ): void {
    const p = this.p;
    const colPeduncle = hexToLinearRgb(p.hueHoldfast); // Fleshy amber-terracotta sand bulb
    const colRachis = hexToLinearRgb(p.huePrimary); // Deep rose-crimson central quill
    const colPinna = hexToLinearRgb(p.hueSecondary); // Translucent coral-pink feather leaves
    const colBiolum = hexToLinearRgb(p.hueAccent); // Glowing electric-cyan autozooid margin!
    const colPolypStar = hexToLinearRgb(p.huePolyp);

    const nPens = clamp(Math.round(p.colonyCount), 1, 6);
    const uvScale = 0.48 / Math.max(0.45, this.substrate.params.size);
    const currentDir = normalize(v3(0.84, 0, 0.54));
    const leanRad = p.currentLeanDeg * DEG2RAD;

    for (let idx = 0; idx < nPens; idx++) {
      const sRng = this.rng.fork(0xb100 + idx * 103);
      const az = idx * GOLDEN_ANGLE + sRng.range(-0.2, 0.2);
      const dist = idx === 0 ? 0 : (0.18 + 0.06 * idx) * p.canopySpread;
      const u = clamp(0.5 + Math.cos(az) * dist * uvScale, 0.12, 0.88);
      const v = clamp(0.5 + Math.sin(az) * dist * uvScale, 0.12, 0.88);
      const surf = this.substrate.sampleSurface(u, v).pos;

      const scaleP = idx === 0 ? 1.06 : lerp1(0.88, 0.62, idx / Math.max(1, nPens - 1)) * sRng.vary(1.0, 0.08);
      const penH = Math.max(0.32, p.colonyHeight * scaleP);
      const pedH = penH * 0.24;
      const rachisH = penH * 0.78;
      const maxWidth = p.organLength * scaleP * p.canopySpread;
      const baseR = Math.max(0.024, penH * 0.045);
      const phase = (this.colonyPhase + idx * 0.005) % 1;

      const yawDir = normalize(v3(Math.cos(az + 0.5), 0, Math.sin(az + 0.5)));
      const initDir = normalize(add(scale(UP, Math.cos(leanRad * 0.6)), scale(currentDir, Math.sin(leanRad * 0.6))));

      // 1. Bulbous Fleshy Sand-Anchored Peduncle (`holdfastMesh`)!
      const pedCurve = growCurve(add(surf, v3(0, -0.025, 0)), initDir, yawDir, pedH, 8, () => ({}));
      const pedTopFlex = 0.04 * p.currentSway;
      this.emitClosedTube(
        peduncleMesh,
        pedCurve,
        (t) => baseR * (1.15 + 0.42 * Math.sin(t * Math.PI) - 0.24 * Math.pow(t, 2.0)),
        tier >= 3 ? 18 : 12,
        (t) => mixRgb(colPeduncle, colRachis, smoothstep(0.55, 1.0, t)),
        0,
        pedTopFlex,
        phase,
        0.34,
        0.65,
      );

      // 2. Gracefully Arching Central Axial Rachis Quill (`stipeMesh`)!
      const pedEnd = pedCurve.atT(1.0);
      const rachisCurve = growCurve(
        pedEnd.pos,
        pedEnd.dir,
        yawDir,
        rachisH,
        tier >= 3 ? 24 : 16,
        (t0, t1) => ({
          pitch: (-leanRad * 0.55 - 0.36 * smoothstep(0.3, 1.0, t1)) * (t1 - t0),
          yaw: Math.sin(t1 * Math.PI) * 0.14 * (t1 - t0),
        }),
      );
      const rachisExtraFlex = 0.24 * p.currentSway;
      this.emitClosedTube(
        rachisMesh,
        rachisCurve,
        (t) => Math.max(0.003, baseR * 0.92 * Math.pow(1 - t * 0.88, 0.78)),
        tier >= 3 ? 14 : 10,
        (t) => mixRgb(colRachis, colPinna, t * 0.65),
        pedTopFlex,
        rachisExtraFlex,
        phase,
        0.28,
        Math.max(0.72, p.translucency),
      );
      this.stats.stemsOrTubes++;

      // 3. Paired Left & Right Sweeping Falcate Fleshy Polyp Leaves (`frondsMesh`) + Bioluminescent Autozooid Fringe (`vesiclesMesh`)!
      const nPairs = Math.max(14, Math.round((tier >= 3 ? 28 : 18) * p.organDensity));
      const leafU = tier >= 3 ? 10 : 7;
      const leafV = 4;

      for (let k = 0; k < nPairs; k++) {
        const kf = k / Math.max(1, nPairs - 1);
        const tR = lerp1(0.05, 0.97, kf);
        const fr = rachisCurve.atT(tR);
        // Classic ostrich-quill / sea-pen silhouette envelope!
        const quillEnv = Math.sin(Math.PI * Math.pow(clamp(kf * 0.92 + 0.05, 0.03, 0.98), 0.72));
        const leafSpan = maxWidth * (0.22 + 0.88 * quillEnv);
        const leafChord = leafSpan * clamp(p.organWidth, 0.14, 0.55) * 0.68;
        const attachFlex = pedTopFlex + Math.pow(tR, 1.45) * rachisExtraFlex;
        const rRachisHere = baseR * 0.92 * Math.pow(1 - tR * 0.88, 0.78);

        for (const side of [-1, 1]) {
          const lat = scale(fr.right, side);
          const leafRoot = addScaled(fr.pos, lat, rRachisHere * 0.65);
          const posG: V3[][] = [];
          const colG: RGB[][] = [];
          const windG: [number, number, number, number][][] = [];

          for (let r = 0; r <= leafU; r++) {
            const uf = r / leafU; // 0 at rachis -> 1 at sickle feather tip!
            // Falcate upward-and-backward sea-pen leaf sweep!
            const sweepUp = Math.pow(uf, 1.25) * leafSpan * 0.46;
            const curlBack = Math.pow(uf, 1.65) * leafSpan * 0.28 * (0.6 + 0.6 * p.ruffleWave);
            const spinePt = add(
              addScaled(leafRoot, lat, uf * leafSpan * 0.86),
              add(scale(fr.dir, sweepUp), scale(fr.up, -curlBack)),
            );
            const wChord = leafChord * Math.sin(Math.PI * clamp(uf * 0.88 + 0.08, 0.05, 0.98));
            const rowFlex = attachFlex + 0.07 * p.currentSway * uf;
            const rowFlut = 0.14 * p.currentSway * uf * uf;

            const pR: V3[] = [];
            const cR: RGB[] = [];
            const wR: [number, number, number, number][] = [];

            for (let c = 0; c <= leafV; c++) {
              const vf = c / leafV; // 0 = lower abaxial margin -> 1 = upper bioluminescent autozooid crest!
              // Ensure consistent right-handed winding on both left (`side = -1`) and right (`side = +1`) pinnae!
              const vSigned = side > 0 ? vf : 1 - vf;
              const isCrest = vSigned > 0.78;
              const ripple = Math.sin(uf * 14.0 + k) * wChord * 0.12 * p.ruffleWave * vSigned;
              const pt = add(
                addScaled(spinePt, fr.dir, (vSigned - 0.35) * wChord),
                scale(fr.up, ripple),
              );
              let col = mixRgb(colRachis, colPinna, smoothstep(0.05, 0.65, uf));
              col = mixRgb(col, colBiolum, smoothstep(0.68, 1.0, vSigned) * 0.92);

              pR.push(pt);
              cR.push(col);
              wR.push([uf, rowFlex, phase, rowFlut]);

              // Glowing bioluminescent autozooid tubular polyps serrating the upper crest of every feather leaf!
              if (
                p.vesicleAbundance > 0.2 &&
                isCrest &&
                ((side > 0 && c === leafV) || (side < 0 && c === 0)) &&
                r >= 1 &&
                r < leafU &&
                r % (tier >= 3 ? 1 : 2) === 0
              ) {
                const polDir = normalize(add(scale(fr.dir, 0.72), scale(lat, 0.68)));
                this.emitClosedOvoid(
                  polypsMesh,
                  addScaled(pt, polDir, -0.002),
                  polDir,
                  0.011 * scaleP,
                  0.0038 * scaleP,
                  4,
                  4,
                  colBiolum,
                  colPolypStar,
                  0.16,
                  0.88,
                  [uf, rowFlex, phase, rowFlut],
                );
                this.stats.vesiclesOrPolyps++;
              }
            }
            posG.push(pR);
            colG.push(cR);
            windG.push(wR);
          }
          this.emitSurfaceGrid(pinnaeMesh, posG, colG, windG, 0.22, Math.max(0.76, p.translucency));
          this.stats.bladesOrTentacles++;
        }
      }
    }
    pinnaeMesh.hasExplicitNormals = true;
  }

  // ===========================================================================
  // Shared Anemone & Coral Surface, Oral Cone & Capped Tentacle Helpers
  // ===========================================================================

  private emitSurfaceGrid(
    mesh: PartMesh,
    posGrid: V3[][],
    colGrid: RGB[][],
    windGrid: [number, number, number, number][][],
    roughness: number,
    translucency: number,
  ): void {
    const rows = posGrid.length - 1;
    const cols = posGrid[0].length - 1;
    const idxGrid: number[][] = [];

    for (let r = 0; r <= rows; r++) {
      const rowIds: number[] = [];
      for (let c = 0; c <= cols; c++) {
        const pU0 = posGrid[Math.max(0, r - 1)][c];
        const pU1 = posGrid[Math.min(rows, r + 1)][c];
        const pV0 = posGrid[r][Math.max(0, c - 1)];
        const pV1 = posGrid[r][Math.min(cols, c + 1)];
        let nrm = cross(sub(pU1, pU0), sub(pV1, pV0));
        nrm = lengthSq(nrm) > 1e-12 ? normalize(nrm) : UP;
        const tang = lengthSq(sub(pV1, pV0)) > 1e-12 ? normalize(sub(pV1, pV0)) : v3(1, 0, 0);
        const pt = posGrid[r][c];

        rowIds.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: nrm.x, ny: nrm.y, nz: nrm.z,
            tx: tang.x, ty: tang.y, tz: tang.z,
            u: c / cols, v: r / rows,
            color: colGrid[r][c],
            wind: windGrid[r][c],
            pivot: this.groundOrigin,
            roughness,
            translucency,
            detailMetric: r / rows,
            anatomyLevel: 1,
          }),
        );
      }
      idxGrid.push(rowIds);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        mesh.addQuad(idxGrid[r][c], idxGrid[r + 1][c], idxGrid[r + 1][c + 1], idxGrid[r][c + 1]);
      }
    }
  }

  private emitPleatedOralCone(
    mesh: PartMesh,
    center: V3,
    radius: number,
    height: number,
    colOuter: RGB,
    colLip: RGB,
    flex: number,
    phase: number,
  ): void {
    const cols = 20;
    const rows = 4;
    const rings: number[][] = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        const th = (c / cols) * TAU;
        // Oval siphonoglyph actinopharynx slit with radial mesentery pleats!
        const ovalX = 1 + 0.38 * smoothstep(0.3, 1.0, t) * Math.cos(th * 2);
        const pleat = 1 + 0.08 * Math.cos(th * 10);
        const rad = lerp1(radius, radius * 0.14, t) * ovalX * pleat;
        const y = Math.sin(t * Math.PI * 0.85) * height;
        const pt = add(center, v3(Math.cos(th) * rad, y, Math.sin(th) * rad));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: -Math.sin(th), ty: 0, tz: Math.cos(th),
            u: c / cols, v: t,
            color: mixRgb(colOuter, colLip, smoothstep(0.25, 0.95, t)),
            wind: [0.8, flex, phase, 0],
            pivot: this.groundOrigin,
            roughness: 0.22,
            translucency: 0.65,
            detailMetric: 0.9,
            anatomyLevel: 2,
          }),
        );
      }
      rings.push(row);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const c1 = (c + 1) % cols;
        mesh.addQuad(rings[r][c], rings[r + 1][c], rings[r + 1][c1], rings[r][c1]);
      }
    }
    const throat = mesh.addVertex({
      x: center.x, y: center.y - height * 0.35, z: center.z,
      tx: 1, ty: 0, tz: 0,
      u: 0.5, v: 1,
      color: mixRgb(colLip, hexToLinearRgb('#140814'), 0.55),
      wind: [1, flex, phase, 0],
      pivot: this.groundOrigin,
      roughness: 0.3,
      translucency: 0.4,
      detailMetric: 0.95,
      anatomyLevel: 2,
    });
    const inner = rings[rows];
    for (let c = 0; c < cols; c++) {
      mesh.addTri(inner[c], throat, inner[(c + 1) % cols]);
    }
  }

  private emitCappedTentacleTube(
    mesh: PartMesh,
    curve: CurveLine,
    sides: number,
    radiusAt: (u: number) => number,
    colorAt: (u: number) => RGB,
    attachFlex: number,
    extraFlex: number,
    maxFlutter: number,
    phase: number,
    roughness: number,
    translucency: number,
  ): void {
    const rings: number[][] = [];
    for (let i = 0; i < curve.count; i++) {
      const fr = curve.frameAtIndex(i);
      const u = fr.t;
      const r = radiusAt(u);
      const col = colorAt(u);
      const flex = attachFlex + Math.pow(u, 1.45) * extraFlex;
      const flut = maxFlutter * u * u; // Strictly 0 at oral-disc attachment (`u = 0`)!
      const wVec: [number, number, number, number] = [u, flex, phase, flut];

      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const rad = add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th)));
        const pt = addScaled(fr.pos, rad, r);
        const nrm = normalize(add(rad, scale(fr.dir, u > 0.85 ? 0.38 : 0.06)));
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            nx: nrm.x, ny: nrm.y, nz: nrm.z,
            tx: fr.dir.x, ty: fr.dir.y, tz: fr.dir.z,
            u: j / sides, v: u,
            color: col,
            wind: wVec,
            pivot: this.groundOrigin,
            roughness,
            translucency,
            detailMetric: smoothstep(0.6, 1.0, u),
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

    // Closed hemispherical acrosphere dome tip!
    const fEnd = curve.atT(1.0);
    const rEnd = radiusAt(1.0);
    const tipPt = addScaled(fEnd.pos, fEnd.dir, rEnd * 0.65);
    const vCap = mesh.addVertex({
      x: tipPt.x, y: tipPt.y, z: tipPt.z,
      nx: fEnd.dir.x, ny: fEnd.dir.y, nz: fEnd.dir.z,
      tx: fEnd.right.x, ty: fEnd.right.y, tz: fEnd.right.z,
      u: 0.5, v: 1.0,
      color: colorAt(1.0),
      wind: [1.0, attachFlex + extraFlex, phase, maxFlutter],
      pivot: this.groundOrigin,
      roughness,
      translucency,
      detailMetric: 1.0,
      anatomyLevel: 3,
    });
    const last = rings[rings.length - 1];
    for (let j = 0; j < sides; j++) {
      mesh.addTri(last[j], last[(j + 1) % sides], vCap);
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

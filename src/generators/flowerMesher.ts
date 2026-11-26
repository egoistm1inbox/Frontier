/**
 * Gigantic & Botanical Flowering Plant Generator (`src/generators/flowerMesher.ts`).
 *
 * Synthesizes 6 distinct flowering plant architectures scalable from garden size up to
 * 9.0 m colossal titan specimens:
 *   1. `tropical_hibiscus` — Ruffled 5-petal pinwheel corolla, embossed branching veins,
 *      deep nectar throat, arching monadelphous stamen column + 5 velvet stigma pads.
 *   2. `oriental_lily`     — Recurved 6-tepal Stargazer star, picotee rims, 3D raised
 *      throat papillae, 6 sweeping filaments with T-hinged bilobed cinnabar anthers.
 *   3. `sacred_lotus`      — Emergent cupped peltate umbrella leaves, multi-whorl boat-petal
 *      chalice, flat-topped pitted golden seed receptacle + 100+ golden stamens.
 *   4. `tree_peony`        — Gnarled welded woody stem, 34–48 goffered silk-ruffled double
 *      petals with bilobed notches, 110+ crimson-gold stamens + 5 velvet carpels.
 *   5. `passion_orchid`    — 10-part keeled star perianth, 72+ variegated corona filaments,
 *      central androgynophore column, 5 versatile paddle anthers + 3 club stigmas.
 *   6. `titan_sunflower`   — Ribbed colossal stalk, multi-tier involucral phyllaries,
 *      grooved ligulate ray florets + 320–520 Fibonacci-spiral 3D tubular disc florets.
 *
 * Stems, buttress roots, branching peduncles/pedicels, and leaf petiole-midrib spines
 * are welded into a closed 2-manifold (`WeldedMesher`, `V - E + F = 2C`, `0` open edges).
 */

import {
  DEG2RAD,
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
  lerp,
  lerp1,
  mixRgb,
  normalize,
  projectOnPlane,
  rgb,
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
   DEFAULT_WELDED_CONFIG,
  WeldedMesher,
  WeldedNode,
  WeldedStem,
  validateWeldedManifold,
} from '../core/weldedManifold';
import { HostSubstrate } from '../substrates/substrate';
import { FlowerParams } from './flowerParams';

export interface FlowerStats {
  blooms: number;
  buds: number;
  petals: number;
  stamensAndFlorets: number;
  leaves: number;
  weldedJunctions: number;
  closedStemManifold: boolean;
  eulerCharacteristic: number;
  height: number;
}

export interface FlowerBuildResult {
  parts: PartMesh[];
  stats: FlowerStats;
}

interface BloomMount {
  stem: WeldedStem;
  isBud: boolean;
  scaleMul: number;
  index: number;
  preferForwardTiltDeg: number;
  yawHint: number;
  /** Continuous `limbFlex` at the exact tip of `stem` (around `rootPivot`) so blooms & buds move 100% locked to their stem! */
  baseFlex: number;
}

interface LeafMount {
  stem: WeldedStem;
  isPeltatePad: boolean;
  bladeLen: number;
  bladeWidth: number;
  index: number;
  /** Continuous `limbFlex` at `stem` attachment collar on `mainStem`. */
  baseFlex: number;
  /** Additional `limbFlex` gained along `stem` from `u = 0` to `u = 1`. */
  extraFlex: number;
}

interface PetalSpec {
  azimuthRad: number;
  rBase: number;
  zBase: number;
  length: number;
  maxHalfWidth: number;
  clawRatio: number;
  /** Initial angle from `flowerAxis` at claw [rad]. */
  polarStartRad: number;
  /** Mid-limb angle from `flowerAxis` [rad]. */
  polarMidRad: number;
  /** Distal curl/reflex delta [rad] (+ = recurve outward/back, - = incurve cup). */
  curlDeltaRad: number;
  /** Imbricate pinwheel cant around spine [rad] to eliminate Z-fighting between neighbors. */
  rollRad: number;
  /** Transverse concave spoon/boat depth (fraction of halfWidth). */
  cupRatio: number;
  /** Margin harmonic ruffle amplitude (metres). */
  ruffleAmp: number;
  ruffleFreq: number;
  /** Apical notch cleft depth [0..0.28]. */
  apicalNotch: number;
  /** Number of radiating primary veins (odd: 5, 7, 9, 11). */
  veinCount: number;
  /** Physical 3D petal thickness at base/midrib (metres). */
  baseThickness: number;
  /** Whorl index (0 = outer, higher = inner) for subtle tonal/scale gradation. */
  whorl01: number;
  /** Raise 3D Stargazer-lily throat papillae? */
  hasPapillae: boolean;
  /** Sunflower 2-channel ray plication? */
  isRayFloret: boolean;
  /** Optional explicit petal planform override. */
  planform?: 'obovate' | 'pointed_boat' | 'acute_bract' | 'involute_quill' | 'orchid_wing' | 'bell_tepal';
  /** Optional custom pigment evaluator `(u, absS, veinRidge, isAbaxial) => RGB`. */
  colorOverride?: (u: number, absS: number, veinRidge: number, isAbaxial: boolean) => RGB;
  seedPhase: number;
}

const GOLDEN_ANGLE = 2.399963229728653; // 137.507764°

function mulRgb(c: RGB, k: number): RGB {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

function boostVibrancy(c: RGB, vibrancy: number): RGB {
  const luma = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const r = Math.max(0.001, luma + (c.r - luma) * vibrancy);
  const g = Math.max(0.001, luma + (c.g - luma) * vibrancy);
  const b = Math.max(0.001, luma + (c.b - luma) * vibrancy);
  const peak = Math.max(1.0, r, g, b);
  return { r: r / peak, g: g / peak, b: b / peak };
}

function buildPolylineNodes(pts: V3[], refRight?: V3): { nodes: WeldedNode[]; length: number } {
  const nodes: WeldedNode[] = [];
  let s = 0;
  let prevDir = v3(0, 1, 0);
  let prevRight = refRight ? normalize(refRight) : v3(1, 0, 0);

  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += length(sub(pts[i], pts[i - 1]));
    let dir: V3;
    if (i === 0) {
      dir = normalize(sub(pts[1], pts[0]));
    } else if (i === pts.length - 1) {
      dir = normalize(sub(pts[i], pts[i - 1]));
    } else {
      dir = normalize(add(normalize(sub(pts[i], pts[i - 1])), normalize(sub(pts[i + 1], pts[i]))));
    }
    if (i === 0) {
      const proj = projectOnPlane(prevRight, dir);
      prevRight = length(proj) > 1e-4 ? normalize(proj) : anyPerpendicular(dir);
    } else {
      const axis = cross(prevDir, dir);
      const axLen = length(axis);
      if (axLen > 1e-6) {
        const ang = Math.asin(clamp(axLen, -1, 1));
        prevRight = normalize(projectOnPlane(rotateAxis(prevRight, scale(axis, 1 / axLen), ang), dir));
      } else {
        prevRight = normalize(projectOnPlane(prevRight, dir));
      }
    }
    prevDir = dir;
    nodes.push({ pos: pts[i], dir, right: prevRight, s });
  }
  return { nodes, length: s };
}

export class FlowerMesher {
  private readonly p: FlowerParams;
  private readonly rng: Random;
  private readonly sub: HostSubstrate;
  private readonly seed: number;
  private nextStemId = 1;

  private stats: FlowerStats = {
    blooms: 0,
    buds: 0,
    petals: 0,
    stamensAndFlorets: 0,
    leaves: 0,
    weldedJunctions: 0,
    closedStemManifold: false,
    eulerCharacteristic: 0,
    height: 0,
  };

  // Precomputed linear vibrant pigments
  private colPrimary!: RGB;
  private colSecondary!: RGB;
  private colThroat!: RGB;
  private colVein!: RGB;
  private colPollen!: RGB;
  private colStem!: RGB;
  private colLeaf!: RGB;
  private colLeafTip!: RGB;
  private colSepal!: RGB;

  // Unified whole-plant wind anchor, coherent wind phase, and active bloom tip flex
  private rootPivot: V3 = v3(0, 0, 0);
  private plantPhase = 0.1;
  private activeBloomFlex = 0.08;

  constructor(params: FlowerParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.seed = seed;
    this.rng = new Random(seed + 4177);
    this.sub = substrate;
    // Keep plantPhase in a tight coherent band `[0.08..0.13]` so every organ of a plant shares
    // exact zero phase skew AND neighboring plants in multi-layer scenes sway together with the wind wave!
    this.plantPhase = 0.08 + (((seed * 0.6180339887) % 1 + 1) % 1) * 0.05;

    const vib = clamp(params.vibrancy, 0.55, 1.85);
    this.colPrimary = boostVibrancy(hexToLinearRgb(params.huePrimary), vib);
    this.colSecondary = boostVibrancy(hexToLinearRgb(params.hueSecondary), vib);
    this.colThroat = boostVibrancy(hexToLinearRgb(params.hueThroat), clamp(vib * 0.96, 0.6, 1.7));
    this.colVein = boostVibrancy(hexToLinearRgb(params.hueVein), vib);
    this.colPollen = boostVibrancy(hexToLinearRgb(params.huePollen), clamp(vib * 1.05, 0.7, 1.85));

    const baseGreen = hexToLinearRgb(params.hueStemLeaf);
    this.colLeaf = baseGreen;
    this.colLeafTip = mixRgb(baseGreen, rgb(0.32, 0.74, 0.12), 0.36);
    this.colStem =
      params.species === 'tree_peony'
        ? mixRgb(baseGreen, rgb(0.18, 0.10, 0.06), 0.68)
        : params.species === 'tropical_hibiscus'
          ? mixRgb(baseGreen, rgb(0.16, 0.12, 0.07), 0.42)
          : params.species === 'phalaenopsis_orchid'
            ? mixRgb(baseGreen, rgb(0.15, 0.19, 0.08), 0.46)
            : mixRgb(baseGreen, rgb(0.14, 0.34, 0.08), 0.28);
    this.colSepal = mixRgb(baseGreen, this.colLeafTip, 0.25);
  }

  build(layerId: string): FlowerBuildResult {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);

    const stemMesh = new PartMesh(
      `${layerId}:stem`,
      'Welded Stems, Roots & Receptacles',
      'botanical',
      layerId,
      'roots',
      '#46b868',
    );
    const foliageMesh = new PartMesh(
      `${layerId}:foliage`,
      '3D Veined Foliage & Pads',
      'botanical',
      layerId,
      'leaf',
      '#34c759',
    );
    const calyxMesh = new PartMesh(
      `${layerId}:calyx`,
      'Calyx Sepals, Bracts & Buds',
      'flower',
      layerId,
      'sprout',
      '#7ee058',
    );
    const corollaMesh = new PartMesh(
      `${layerId}:corolla`,
      'Sculpted 3D Vibrant Corolla Petals',
      'flower',
      layerId,
      'sparkles',
      p.huePrimary,
    );
    const reproMesh = new PartMesh(
      `${layerId}:reproductive`,
      '3D Stamens, Anthers, Stigmas & Florets',
      'flower',
      layerId,
      'sparkles',
      p.huePollen,
    );

    // -------------------------------------------------------------------------
    // 1. Build Closed 2-Manifold Welded Stem, Root, Pedicel & Petiole Skeleton
    // -------------------------------------------------------------------------
    const { rootStems, bloomMounts, leafMounts } = this.buildWeldedPlantSkeleton(tier);

    const trunkRadSegs = tier === 1 ? 16 : tier === 2 ? 20 : tier === 3 ? 24 : 28;
    const weldCfg = {
      ...DEFAULT_WELDED_CONFIG,
      trunkRadialSegments: trunkRadSegs,
      minRadialSegments: tier === 1 ? 6 : 8,
      collarScale: 1.24,
      collarLength: 1.05,
      collarRings: tier >= 3 ? 2 : 1,
      collarFillet: 0.76,
      collarMitre: 0.52,
      minRadius: 0.0018,
      capTips: true,
    };

    const welder = new WeldedMesher(stemMesh, rootStems, weldCfg);
    const wStats = welder.build();
    stemMesh.hasExplicitNormals = false;
    stemMesh.computeNormals();

    const manifoldRep = validateWeldedManifold(stemMesh);
    this.stats.weldedJunctions = wStats.junctions + wStats.forks;
    this.stats.closedStemManifold = manifoldRep.closed && manifoldRep.manifold;
    this.stats.eulerCharacteristic = manifoldRep.eulerCharacteristic;

    // -------------------------------------------------------------------------
    // 2. Mount 3D Veined Cauline / Peltate Leaves onto Welded Petiole Spines
    // -------------------------------------------------------------------------
    for (const lm of leafMounts) {
      if (lm.stem.dropped || lm.stem.nodes.length < 3) continue;
      if (lm.isPeltatePad) {
        this.buildLotusPeltatePad(foliageMesh, lm, tier);
      } else {
        this.buildCaulineLeafOnSpine(foliageMesh, lm, tier);
      }
      this.stats.leaves++;
    }

    // -------------------------------------------------------------------------
    // 3. Mount Giant Detailed Blooms & Sculpted Unopened Buds onto Welded Pedicels
    // -------------------------------------------------------------------------
    for (const bm of bloomMounts) {
      if (bm.stem.dropped || bm.stem.nodes.length < 2) continue;
      this.activeBloomFlex = bm.baseFlex;
      if (bm.isBud) {
        this.buildSculptedFloralBud(calyxMesh, corollaMesh, bm, tier);
        this.stats.buds++;
      } else {
        this.buildDetailedGiantBloom(calyxMesh, corollaMesh, reproMesh, bm, tier);
        this.stats.blooms++;
      }
    }

    for (const pm of [foliageMesh, calyxMesh, corollaMesh, reproMesh]) {
      if (pm.faceCount > 0) {
        pm.hasExplicitNormals = false;
        pm.computeNormals();
      }
    }

    stemMesh.metaLabel = `${this.stats.weldedJunctions} collars · ${this.stats.closedStemManifold ? 'closed' : 'open'}`;
    foliageMesh.metaLabel = `${this.stats.leaves} leaves`;
    calyxMesh.metaLabel = `${this.stats.buds} buds + calyx`;
    corollaMesh.metaLabel = `${this.stats.petals} 3D petals`;
    reproMesh.metaLabel = `${this.stats.stamensAndFlorets.toLocaleString('en-US')} organs`;

    const parts = [stemMesh, foliageMesh, calyxMesh, corollaMesh, reproMesh].filter(
      (m) => m.faceCount > 0,
    );

    let maxY = 0.25;
    for (const pm of parts) {
      const pos = pm.positions;
      for (let i = 1; i < pos.length; i += 3) {
        if (pos[i] > maxY) maxY = pos[i];
      }
    }
    this.stats.height = maxY;

    return { parts, stats: this.stats };
  }

  // ===========================================================================
  // Welded Shoot, Buttress Root, Pedicel & Petiole Skeleton Construction
  // ===========================================================================

  private buildWeldedPlantSkeleton(tier: number): {
    rootStems: WeldedStem[];
    bloomMounts: BloomMount[];
    leafMounts: LeafMount[];
  } {
    const p = this.p;
    const H = clamp(p.plantHeight, 0.5, 9.5);
    const bloomD = clamp(p.bloomDiameter, 0.2, 2.6);
    const bloomMounts: BloomMount[] = [];
    const leafMounts: LeafMount[] = [];

    const groundY = this.sub.sampleSurface(0, 0).pos.y;
    const rootPivot = v3(0, groundY, 0);
    this.rootPivot = rootPivot;
    const plantPhase = this.plantPhase;
    const windComp = clamp(p.windCompliance, 0.15, 2.2);
    const trunkRadSegs = tier === 1 ? 16 : tier === 2 ? 20 : tier === 3 ? 24 : 28;
    const isOrchid = p.species === 'phalaenopsis_orchid';
    const isPagodaBell = p.species === 'imperial_crown_bell';

    // Slender, botanically proportional primary stalk radii (graceful herbaceous scapes & wiry orchid spikes!)
    const baseStalkR = isOrchid
      ? clamp(H * 0.0048 + bloomD * 0.0042, 0.007, 0.028)
      : p.species === 'titan_sunflower'
        ? clamp(H * 0.0092 + bloomD * 0.0092, 0.012, 0.074)
        : p.species === 'tree_peony' || p.species === 'tropical_hibiscus'
          ? clamp(H * 0.0086 + bloomD * 0.0082, 0.010, 0.068)
          : p.species === 'sacred_lotus' ||
              p.species === 'passion_orchid' ||
              p.species === 'bearded_iris' ||
              p.species === 'bird_of_paradise' ||
              p.species === 'oriental_lily'
            ? clamp(H * 0.0066 + bloomD * 0.0068, 0.008, 0.048)
            : clamp(H * 0.0078 + bloomD * 0.0078, 0.009, 0.058);

    const stalkH = isPagodaBell
      ? H * 0.94
      : p.species === 'sacred_lotus'
        ? H * 0.88
        : p.species === 'titan_sunflower'
          ? H * 0.86
          : H * 0.74;

    // Build graceful organic primary stalk centerline (with sweeping weeping raceme bow for Phalaenopsis Orchid!)
    const nStalkPts = isOrchid ? 22 : 15;
    const leanAz = isOrchid ? 0.28 : this.rng.range(-0.35, 0.35);
    const leanAmp = isPagodaBell
      ? H * 0.018
      : p.species === 'titan_sunflower'
        ? H * 0.030
        : p.species === 'sacred_lotus'
          ? H * 0.042
          : H * 0.060;
    const stalkPts: V3[] = [];
    const sinkBase = baseStalkR * 0.65;
    for (let i = 0; i <= nStalkPts; i++) {
      const t = i / nStalkPts;
      if (isOrchid) {
        // Monopodial Phalaenopsis flower spike: rises cleanly out of the low basal rosette (`t < 0.35`),
        // then sweeps forward-and-over in a lush catenary waterfall arch (`t = 0.35 .. 1.0`)!
        const y =
          groundY -
          sinkBase * (1 - smoothstep(0, 0.08, t)) +
          H * (0.93 * Math.sin(t * Math.PI * 0.66));
        const reach = H * 0.56 * Math.pow(t, 1.58);
        const gentleS = Math.sin(t * Math.PI * 1.2) * H * 0.025;
        stalkPts.push(
          v3(
            Math.sin(leanAz) * reach + Math.cos(leanAz) * gentleS,
            y,
            Math.cos(leanAz) * reach - Math.sin(leanAz) * gentleS,
          ),
        );
      } else {
        const y = groundY - sinkBase * (1 - smoothstep(0, 0.14, t)) + stalkH * t;
        const curve = Math.sin(t * Math.PI * 0.85) * leanAmp;
        const sCurve = Math.sin(t * Math.PI * 1.65 + 0.5) * leanAmp * 0.28;
        stalkPts.push(
          v3(
            Math.cos(leanAz) * curve - Math.sin(leanAz) * sCurve,
            y,
            Math.sin(leanAz) * curve + Math.cos(leanAz) * sCurve,
          ),
        );
      }
    }

    const nBlooms = clamp(Math.round(p.bloomCount), 1, 8);
    const nBuds = clamp(Math.round(p.budCount), 0, 6);
    const torusR = isOrchid
      ? baseStalkR * 0.42
      : clamp(bloomD * 0.036, 0.008, 0.082);

    const { nodes: stalkNodes, length: stalkLen } = buildPolylineNodes(stalkPts);

    // Continuous whole-plant main-stalk flex curve (`0` at ground/roots -> `stalkBaseFlex` at apex)
    const stalkBaseFlex = (isOrchid ? 0.25 : 0.22) * windComp;
    const stalkFlexAt = (s: number): number => {
      const t = clamp(s / Math.max(1e-4, stalkLen), 0, 1);
      return stalkBaseFlex * Math.pow(t, 1.45);
    };

    const rootCount = clamp(Math.round(p.rootCount), 0, 8);
    const rootAzimuths: number[] = [];
    for (let r = 0; r < rootCount; r++) {
      rootAzimuths.push((r / Math.max(1, rootCount)) * TAU + this.rng.vary(0, 0.16));
    }

    const mainStem: WeldedStem = {
      id: this.nextStemId++,
      level: 0,
      role: 'shoot',
      parent: null,
      attach: 'root',
      attachS: 0,
      attachDir: v3(0, 1, 0),
      nodes: stalkNodes,
      length: stalkLen,
      children: [],
      forks: [],
      dropped: false,
      radiusDrop: 1,
      ringSpacing: Math.max(isOrchid ? 0.016 : 0.024, stalkLen / (isOrchid ? (tier >= 3 ? 64 : 48) : (tier >= 3 ? 40 : 28))),
      minRing: trunkRadSegs,
      baseRadiusAt: (s: number) => {
        const t = clamp(s / Math.max(1e-4, stalkLen), 0, 1);
        if (isOrchid) {
          // Slender tapering flower spike with subtle internodal bract rings and delicate distal tip
          const basal = 1 + 0.16 * Math.pow(1 - smoothstep(0, 0.12, t), 2.0);
          const nodal = 1 + 0.06 * Math.pow(Math.max(0, Math.cos(t * Math.PI * 14)), 10);
          return Math.max(0.0032, baseStalkR * lerp1(1.0, 0.36, Math.pow(t, 0.86)) * basal * nodal);
        }
        const basalFlare = 1 + 0.22 * Math.pow(1 - smoothstep(0, 0.16, t), 2.0);
        const tipTorus = isPagodaBell
          ? 0
          : smoothstep(0.92, 0.988, t) * (1 - 0.16 * smoothstep(0.988, 1.0, t));
        const taper = lerp1(1.0, 0.58, Math.pow(t, 0.82)) * basalFlare;
        return Math.max(0.0035, lerp1(baseStalkR * taper, torusR, tipTorus));
      },
      profileFactor: (s: number, theta: number) => {
        const t = clamp(s / Math.max(1e-4, stalkLen), 0, 1);
        let flute = 0;
        if (!isOrchid && t < 0.18 && rootAzimuths.length > 0) {
          const w = Math.pow(1 - t / 0.18, 1.8);
          for (const raz of rootAzimuths) {
            const d = Math.cos(theta - raz);
            if (d > 0) flute += 0.10 * w * Math.pow(d, 3);
          }
        }
        const ribs =
          p.species === 'titan_sunflower'
            ? 0.038 * Math.cos(theta * 8) * (1 - smoothstep(0.86, 0.96, t))
            : isOrchid
              ? 0.008 * Math.cos(theta * 4)
              : 0.015 * Math.cos(theta * 6) * (1 - smoothstep(0.86, 0.96, t));
        return 1 + flute + ribs;
      },
      styleAt: (s: number, _theta: number, _pos: V3, _dir: V3, isJunc: boolean) => {
        const t = clamp(s / Math.max(1e-4, stalkLen), 0, 1);
        const col = isOrchid
          ? mixRgb(this.colStem, this.colSepal, smoothstep(0.55, 1.0, t) * 0.45)
          : mixRgb(this.colStem, this.colSepal, smoothstep(0.35, 0.96, t));
        const flex = stalkFlexAt(s);
        return {
          color: col,
          roughness: p.species === 'tree_peony' ? 0.84 : isOrchid ? 0.34 : 0.56,
          translucency: 0.14 * smoothstep(0.4, 1.0, t),
          detailMetric: isJunc ? 0.95 : clamp(0.25 + 0.65 * t, 0, 1),
          anatomyLevel: 0,
          wind: [t, flex, plantPhase, 0],
          pivot: rootPivot,
        };
      },
    };

    const heroForwardTilt =
      p.species === 'sacred_lotus'
        ? 14
        : p.species === 'king_protea'
          ? 24
          : p.species === 'bearded_iris'
            ? 20
            : p.species === 'tree_peony'
              ? 30
              : p.species === 'oriental_lily' || p.species === 'tropical_hibiscus'
                ? 38
                : p.species === 'honeycomb_dahlia'
                  ? 44
                  : p.species === 'passion_orchid'
                    ? 50
                    : p.species === 'titan_sunflower'
                      ? 54
                      : p.species === 'bird_of_paradise'
                        ? 22
                        : isOrchid
                          ? 84
                          : 146; // imperial_crown_bell pendent nodding bell!

    // Terminal mount on `mainStem` apex:
    // - `imperial_crown_bell`: NO terminal bloom (pineapple foliar topknot sits at apex!)
    // - `phalaenopsis_orchid`: terminal apex of the weeping raceme carries the smallest distal unopened pearl bud
    //   (or smallest distal flower when `nBuds === 0`) — authentic indeterminate raceme phyllotaxy!
    // - All other species: primary Hero Bloom #0 sits at `mainStem` apex!
    if (isOrchid) {
      bloomMounts.push({
        stem: mainStem,
        isBud: nBuds >= 1,
        scaleMul: nBuds >= 1 ? 0.42 : 0.72,
        index: 0,
        preferForwardTiltDeg: 95,
        yawHint: leanAz,
        baseFlex: stalkFlexAt(stalkLen),
      });
    } else if (!isPagodaBell) {
      bloomMounts.push({
        stem: mainStem,
        isBud: false,
        scaleMul: 1.0,
        index: 0,
        preferForwardTiltDeg: heroForwardTilt,
        yawHint: 0.12,
        baseFlex: stalkFlexAt(stalkLen),
      });
    }

    // 1B. Welded Terrain-Hugging Buttress / Rhizome / Silvery Orchid Velamen Roots
    const rootAttachBase = isOrchid
      ? stalkLen * 0.014
      : Math.min(stalkLen * 0.065, Math.max(0.025, baseStalkR * 1.4));
    for (let r = 0; r < rootCount; r++) {
      const raz = rootAzimuths[r];
      const rootLen = isOrchid
        ? clamp(H * 0.22 * this.rng.range(0.85, 1.25), 0.22, 1.15)
        : clamp(H * 0.17 * this.rng.range(0.82, 1.20), 0.12, 1.25);
      const r0 = isOrchid ? Math.max(0.0085, baseStalkR * 0.62) : baseStalkR * 0.40;

      const buildRootPolyline = (origin: V3, emergeDir: V3): { nodes: WeldedNode[]; length: number } => {
        const horiz = normalize(v3(emergeDir.x, 0, emergeDir.z));
        const side = v3(-horiz.z, 0, horiz.x);
        const pts: V3[] = [origin];
        const nSeg = 10;
        const wigPh = this.rng.next() * TAU;
        for (let k = 1; k <= nSeg; k++) {
          const u = k / nSeg;
          const radDist = rootLen * u;
          const wig = Math.sin(u * Math.PI * (isOrchid ? 2.4 : 1.8) + wigPh) * rootLen * (isOrchid ? 0.15 : 0.09) * u;
          const wx = origin.x + horiz.x * radDist + side.x * wig;
          const wz = origin.z + horiz.z * radDist + side.z * wig;
          const surfY = this.sub.sampleSurface(wx, wz).pos.y;
          const sink = isOrchid ? 0 : smoothstep(0.68, 1.0, u) * r0 * 0.85;
          const archY = lerp1(
            origin.y,
            surfY + (isOrchid ? r0 * 1.55 + 0.024 * Math.sin(u * Math.PI * 0.92) : r0 * (1 - u) * 0.35) - sink,
            smoothstep(0, 0.24, u),
          );
          pts.push(v3(wx, archY, wz));
        }
        return buildPolylineNodes(pts);
      };

      const initOrigin = addScaled(stalkNodes[0].pos, UP, rootAttachBase);
      const initDir = normalize(v3(Math.cos(raz), -0.24, Math.sin(raz)));
      const builtR = buildRootPolyline(initOrigin, initDir);

      const rStem: WeldedStem = {
        id: this.nextStemId++,
        level: 1,
        role: 'root',
        parent: mainStem,
        attach: 'side',
        attachS: rootAttachBase + (r % 2) * baseStalkR * 0.25,
        attachDir: initDir,
        nodes: builtR.nodes,
        length: builtR.length,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 1,
        ringSpacing: Math.max(0.020, rootLen / 10),
        minRing: 8,
        baseRadiusAt: (s: number) => {
          const u = clamp(s / Math.max(1e-4, rStem.length), 0, 1);
          // Orchid velamen aerial roots stay plump & cylindrical all the way to their rounded green root-cap tip!
          return isOrchid
            ? Math.max(0.0038, r0 * (1 - 0.18 * u * u))
            : Math.max(0.0022, r0 * Math.pow(1 - u * 0.88, 0.95));
        },
        regrow: (origin: V3, emergeDir: V3) => {
          const reg = buildRootPolyline(origin, emergeDir);
          rStem.nodes = reg.nodes;
          rStem.length = reg.length;
        },
        styleAt: (s: number, _th: number, _pos: V3, _dir: V3, isJunc: boolean) => {
          const u = clamp(s / Math.max(1e-4, rStem.length), 0, 1);
          if (isOrchid) {
            // Iconic Phalaenopsis silvery-celadon spongy velamen root with glossy apple-green active growing tip!
            const velamen = rgb(0.54, 0.64, 0.52);
            const greenTip = mixRgb(this.colLeafTip, rgb(0.22, 0.64, 0.16), 0.55);
            const col = mixRgb(velamen, greenTip, smoothstep(0.78, 0.96, u));
            return {
              color: col,
              roughness: lerp1(0.62, 0.24, smoothstep(0.78, 0.96, u)),
              translucency: 0.15 * smoothstep(0.78, 1.0, u),
              detailMetric: isJunc ? 0.94 : 0.35,
              anatomyLevel: 0,
              wind: [0, 0, plantPhase, 0],
              pivot: rootPivot,
            };
          }
          return {
            color: mixRgb(this.colStem, rgb(0.11, 0.08, 0.05), 0.55 + 0.35 * u),
            roughness: 0.88,
            translucency: 0.0,
            detailMetric: isJunc ? 0.94 : 0.22,
            anatomyLevel: 0,
            wind: [0, 0, plantPhase, 0],
            pivot: rootPivot,
          };
        },
      };
      mainStem.children.push(rStem);
    }

    // 1C. Welded Lateral Bloom Peduncles / Pedicels + Unopened Bud Pedicels
    const sideOpenCount = isOrchid
      ? Math.max(3, nBlooms) - (nBuds === 0 ? 1 : 0)
      : isPagodaBell
        ? Math.max(4, nBlooms + 2)
        : nBlooms - 1;
    const sideBudCount = isOrchid ? Math.max(0, nBuds - 1) : nBuds;
    const totalSideFloral = sideOpenCount + sideBudCount;

    for (let bi = 0; bi < totalSideFloral; bi++) {
      const isBud = bi >= sideOpenCount;
      // Note: On `phalaenopsis_orchid` (indeterminate raceme), proximal lower-arch nodes open FIRST (`sFrac = 0.44..0.86`)
      // and unopened buds sit near the drooping distal tip (`sFrac = 0.92..0.94`)!
      const fracSpan = isOrchid
        ? lerp1(0.44, 0.92, bi / Math.max(1, totalSideFloral - 1))
        : isPagodaBell
          ? lerp1(0.84, 0.72, bi / Math.max(1, totalSideFloral - 1))
          : p.species === 'sacred_lotus'
            ? lerp1(0.38, 0.16, bi / Math.max(1, totalSideFloral - 1))
            : totalSideFloral <= 1
              ? 0.72
              : lerp1(0.84, 0.46, bi / Math.max(1, totalSideFloral - 1));
      const attachS = stalkLen * clamp(fracSpan, 0.14, 0.93);
      const pNode = this.evalNodeAtS(stalkNodes, attachS);

      // Two-ranked distichous cascade for Orchid; chandelier ring for Pagoda Bell; 3D bouquet for others
      const rawAz = (bi + 1) * GOLDEN_ANGLE + 0.45;
      const rankSide = bi % 2 === 0 ? 1 : -1;
      const az = isOrchid
        ? leanAz + rankSide * 0.62
        : isPagodaBell
          ? (bi / Math.max(1, totalSideFloral)) * TAU + 0.32
          : bi === 0
            ? 0.88
            : bi === 1
              ? -0.92
              : rawAz;
      const spreadOut = isOrchid
        ? 0.92
        : isPagodaBell
          ? 0.86
          : p.species === 'sacred_lotus'
            ? 0.36
            : isBud
              ? 0.56
              : 0.68;
      const emergeDir = normalize(
        v3(Math.sin(az) * spreadOut, isOrchid ? 0.16 : isPagodaBell ? 0.42 : 0.76, Math.cos(az) * spreadOut),
      );
      const pedLen = isOrchid
        ? clamp(bloomD * (isBud ? 0.15 : 0.23) * this.rng.range(0.92, 1.08), 0.07, 0.28)
        : isPagodaBell
          ? clamp(bloomD * 0.56 * this.rng.range(0.94, 1.06), 0.18, H * 0.28)
          : p.species === 'sacred_lotus'
            ? H * (isBud ? 0.44 : 0.54) * this.rng.range(0.9, 1.08)
            : clamp(
                H * (isBud ? 0.19 : 0.27) * this.rng.range(0.88, 1.14),
                bloomD * 0.34,
                H * 0.44,
              );
      const pedBaseR = isOrchid
        ? Math.max(0.0028, baseStalkR * (isBud ? 0.26 : 0.32))
        : Math.max(0.0034, baseStalkR * (isBud ? 0.34 : 0.42));
      const pedTorusR = isOrchid
        ? pedBaseR * 0.95
        : isBud
          ? torusR * 0.55
          : torusR * 0.84;

      const pts: V3[] = [];
      const nP = 9;
      const outHoriz = normalize(v3(Math.sin(az), 0, Math.cos(az)));
      for (let k = 0; k <= nP; k++) {
        const u = k / nP;
        if (isOrchid) {
          // Slender resupinate orchid pedicel-ovary arching outward-and-forward from the cascading spike!
          const rOut = pedLen * u;
          const archY = pedLen * (0.18 * Math.sin(u * Math.PI * 0.72) - 0.08 * u * u);
          pts.push(v3(pNode.pos.x + outHoriz.x * rOut, pNode.pos.y + archY, pNode.pos.z + outHoriz.z * rOut));
        } else if (isPagodaBell) {
          const rOut = pedLen * (0.88 * Math.sin(u * Math.PI * 0.58) + 0.12 * u);
          const archY = pedLen * (0.24 * Math.sin(u * Math.PI * 0.75) - 0.52 * u * u);
          pts.push(v3(pNode.pos.x + outHoriz.x * rOut, pNode.pos.y + archY, pNode.pos.z + outHoriz.z * rOut));
        } else {
          const rOut = pedLen * (0.72 * Math.sin(u * Math.PI * 0.56) + 0.18 * u);
          const riseY = pedLen * (0.42 * u + 0.46 * Math.pow(u, 1.65));
          pts.push(
            v3(
              pNode.pos.x + outHoriz.x * rOut,
              pNode.pos.y + riseY,
              pNode.pos.z + outHoriz.z * rOut,
            ),
          );
        }
      }
      const builtPed = buildPolylineNodes(pts);

      // Continuous whole-plant wind flex from `mainStem` collar (`u = 0`) to pedicel tip (`u = 1`)!
      const pedAttachFlex = stalkFlexAt(attachS);
      const pedExtraFlex = (isOrchid ? 0.042 : 0.068) * windComp;
      const pedFlexAt = (u: number): number => pedAttachFlex + pedExtraFlex * Math.pow(u, 1.35);

      const pedStem: WeldedStem = {
        id: this.nextStemId++,
        level: 1,
        role: 'shoot',
        parent: mainStem,
        attach: 'side',
        attachS,
        attachDir: emergeDir,
        nodes: builtPed.nodes,
        length: builtPed.length,
        children: [],
        forks: [],
        dropped: false,
        radiusDrop: 0.97,
        ringSpacing: Math.max(0.016, builtPed.length / 12),
        minRing: tier >= 3 ? 10 : 8,
        baseRadiusAt: (s: number) => {
          const u = clamp(s / Math.max(1e-4, pedStem.length), 0, 1);
          const shaft = lerp1(pedBaseR, pedBaseR * 0.72, u);
          const tipSwell = smoothstep(0.84, 0.98, u);
          return Math.max(0.0024, lerp1(shaft, pedTorusR, tipSwell));
        },
        styleAt: (s: number, _th: number, _pos: V3, _dir: V3, isJunc: boolean) => {
          const u = clamp(s / Math.max(1e-4, pedStem.length), 0, 1);
          // Orchid resupinate pedicel-ovaries flush from olive-green stem into pale pearl-blush near the bloom!
          const col = isOrchid
            ? mixRgb(this.colStem, this.colPrimary, smoothstep(0.35, 1.0, u) * 0.72)
            : mixRgb(this.colStem, this.colSepal, 0.35 + 0.65 * u);
          const h01 = clamp((attachS + s) / Math.max(1e-4, H), 0, 1);
          return {
            color: col,
            roughness: isOrchid ? 0.34 : 0.54,
            translucency: 0.22 * u,
            detailMetric: isJunc ? 0.95 : 0.45 + 0.4 * u,
            anatomyLevel: 1,
            wind: [h01, pedFlexAt(u), plantPhase, 0],
            pivot: rootPivot,
          };
        },
      };
      mainStem.children.push(pedStem);

      const orchidFrac = bi / Math.max(1, totalSideFloral - 1);
      bloomMounts.push({
        stem: pedStem,
        isBud,
        scaleMul: isOrchid
          ? isBud
            ? 0.52
            : lerp1(0.92, 0.72, orchidFrac)
          : isPagodaBell
            ? isBud
              ? 0.62
              : this.rng.range(0.88, 0.98)
            : isBud
              ? this.rng.range(0.55, 0.78)
              : this.rng.range(0.76, 0.92),
        index: bi + 1,
        preferForwardTiltDeg: isOrchid ? 82 : isPagodaBell ? 148 : heroForwardTilt + 10,
        yawHint: az,
        baseFlex: pedFlexAt(1.0),
      });
    }

    // 1D. Welded Cauline Leaves, Monopodial Orchid Rosette, OR Emergent Sacred Lotus Peltate Pads!
    const baseLeafTarget =
      p.species === 'oriental_lily' || p.species === 'king_protea'
        ? 14
        : p.species === 'sacred_lotus'
          ? 5
          : isOrchid
            ? 5
            : p.species === 'bearded_iris' || p.species === 'bird_of_paradise'
              ? 8
              : isPagodaBell
                ? 12
                : p.species === 'titan_sunflower'
                  ? 9
                  : 10;
    const nLeaves = Math.round(baseLeafTarget * clamp(p.foliageDensity, 0, 1.6));

    for (let li = 0; li < nLeaves; li++) {
      const tLeaf = nLeaves <= 1 ? 0.35 : li / (nLeaves - 1);
      const isLotusPad = p.species === 'sacred_lotus';
      const isBasalRosette =
        p.species === 'bearded_iris' || p.species === 'bird_of_paradise';
      const isTopknotLeaf = isPagodaBell && li >= Math.floor(nLeaves * 0.45);

      const attachFrac = isOrchid
        ? lerp1(0.022, 0.068, tLeaf)
        : isLotusPad
          ? lerp1(0.07, 0.24, tLeaf)
          : isBasalRosette
            ? lerp1(0.06, 0.30, tLeaf)
            : isTopknotLeaf
              ? lerp1(0.90, 0.985, (li - Math.floor(nLeaves * 0.45)) / Math.max(1, nLeaves - Math.floor(nLeaves * 0.45) - 1))
              : isPagodaBell
                ? lerp1(0.14, 0.56, tLeaf / 0.45)
                : lerp1(0.15, 0.76, tLeaf);
      const attachS = stalkLen * attachFrac;
      const pNode = this.evalNodeAtS(stalkNodes, attachS);
      // Orchid leaves grow in a low monopodial 2-ranked distichous fan perpendicular to the flower spike!
      const az = isOrchid
        ? leanAz + (li % 2 === 0 ? 1 : -1) * (Math.PI * 0.5) + ((Math.floor(li / 2) - 1) * 0.28)
        : li * GOLDEN_ANGLE + 1.15;
      const outH = v3(Math.sin(az), 0, Math.cos(az));

      const leafAttachFlex = stalkFlexAt(attachS);
      const leafExtraFlex = (isOrchid ? 0.030 : isLotusPad ? 0.095 : 0.075) * windComp;
      const leafFlexAt = (u: number): number => leafAttachFlex + leafExtraFlex * Math.pow(u, 1.35);

      if (isLotusPad) {
        const padH = H * lerp1(0.36, 0.66, (li * 0.618) % 1) * this.rng.range(0.9, 1.08);
        const spreadR = clamp(H * 0.24 * this.rng.range(0.75, 1.25), 0.22, 1.4);
        const pts: V3[] = [];
        for (let k = 0; k <= 10; k++) {
          const u = k / 10;
          const r = spreadR * Math.pow(u, 0.78);
          const y = pNode.pos.y + padH * Math.sin(u * Math.PI * 0.52);
          pts.push(v3(pNode.pos.x + outH.x * r, y, pNode.pos.z + outH.z * r));
        }
        const built = buildPolylineNodes(pts);
        const padR0 = Math.max(0.004, baseStalkR * 0.40);
        const lStem: WeldedStem = {
          id: this.nextStemId++,
          level: 1,
          role: 'shoot',
          parent: mainStem,
          attach: 'side',
          attachS,
          attachDir: normalize(v3(outH.x * 0.65, 0.76, outH.z * 0.65)),
          nodes: built.nodes,
          length: built.length,
          children: [],
          forks: [],
          dropped: false,
          radiusDrop: 1,
          ringSpacing: Math.max(0.024, built.length / 12),
          minRing: 8,
          baseRadiusAt: (s: number) => {
            const u = clamp(s / Math.max(1e-4, lStem.length), 0, 1);
            return Math.max(0.0025, padR0 * lerp1(1.0, 0.62, u));
          },
          styleAt: (s: number, _th: number, _pos: V3, _dir: V3, isJunc: boolean) => {
            const u = clamp(s / Math.max(1e-4, lStem.length), 0, 1);
            return {
              color: mixRgb(this.colStem, this.colLeaf, 0.3 + 0.55 * u),
              roughness: 0.56,
              translucency: 0.16,
              detailMetric: isJunc ? 0.94 : 0.4,
              anatomyLevel: 1,
              wind: [u * 0.65, leafFlexAt(u), plantPhase, 0],
              pivot: rootPivot,
            };
          },
        };
        mainStem.children.push(lStem);
        const padDiam = clamp(bloomD * this.rng.range(0.88, 1.28), 0.28, 1.95);
        leafMounts.push({
          stem: lStem,
          isPeltatePad: true,
          bladeLen: padDiam,
          bladeWidth: padDiam,
          index: li,
          baseFlex: leafAttachFlex,
          extraFlex: leafExtraFlex,
        });
      } else {
        const sizeBell = Math.sin(Math.PI * clamp(0.18 + 0.72 * (1 - tLeaf * 0.65), 0.15, 0.95));
        const isSwordLeaf = p.species === 'bearded_iris' || p.species === 'bird_of_paradise';
        const totalSpineLen = isTopknotLeaf
          ? clamp(bloomD * 0.68 * this.rng.range(0.88, 1.12), 0.16, 0.85)
          : isSwordLeaf
            ? clamp(H * 0.44 * (0.75 + 0.30 * sizeBell), 0.28, 2.2)
            : isOrchid
              ? clamp(H * 0.28 * (0.85 + 0.20 * sizeBell), 0.28, 1.25)
              : p.species === 'oriental_lily' || p.species === 'king_protea'
                ? clamp(H * 0.20 * (0.65 + 0.45 * sizeBell), 0.16, 1.35)
                : p.species === 'titan_sunflower'
                  ? clamp(H * 0.28 * (0.65 + 0.50 * sizeBell), 0.22, 1.85)
                  : clamp(H * 0.24 * (0.65 + 0.45 * sizeBell), 0.18, 1.55);

        const bladeW = isSwordLeaf
          ? totalSpineLen * (p.species === 'bearded_iris' ? 0.14 : 0.24)
          : isOrchid
            ? totalSpineLen * 0.52
            : isTopknotLeaf || p.species === 'oriental_lily' || isPagodaBell
              ? totalSpineLen * 0.22
              : p.species === 'king_protea'
                ? totalSpineLen * 0.34
                : p.species === 'titan_sunflower'
                  ? totalSpineLen * 0.74
                  : p.species === 'passion_orchid'
                    ? totalSpineLen * 0.78
                    : totalSpineLen * 0.58;

        const pts: V3[] = [];
        const nL = isSwordLeaf || isOrchid ? 16 : 12;
        const risePitch = isTopknotLeaf
          ? 0.88
          : isSwordLeaf
            ? lerp1(1.12, 1.42, tLeaf)
            : isOrchid
              ? lerp1(0.18, 0.32, tLeaf)
              : lerp1(0.32, 0.62, tLeaf);
        const droop = isSwordLeaf
          ? 0.06
          : isTopknotLeaf
            ? 0.24
            : isOrchid
              ? 0.24
              : p.species === 'oriental_lily'
                ? 0.42
                : 0.34;
        const horizShrink = isSwordLeaf ? 0.38 : isTopknotLeaf ? 0.68 : 0.94;
        for (let k = 0; k <= nL; k++) {
          const u = k / nL;
          const r = totalSpineLen * (horizShrink * Math.pow(u, isSwordLeaf ? 1.25 : 1.0));
          const y =
            pNode.pos.y +
            totalSpineLen * (risePitch * Math.sin(u * Math.PI * (isSwordLeaf ? 0.45 : 0.58)) - droop * u * u);
          pts.push(v3(pNode.pos.x + outH.x * r, y, pNode.pos.z + outH.z * r));
        }
        const leafRight0 = length(cross(UP, outH)) > 1e-4 ? normalize(cross(UP, outH)) : v3(1, 0, 0);
        const built = buildPolylineNodes(pts, leafRight0);
        const petR0 = Math.max(0.0022, baseStalkR * 0.25);

        const lStem: WeldedStem = {
          id: this.nextStemId++,
          level: 1,
          role: 'shoot',
          parent: mainStem,
          attach: 'side',
          attachS,
          attachDir: normalize(v3(outH.x * 0.82, risePitch + 0.25, outH.z * 0.82)),
          nodes: built.nodes,
          length: built.length,
          children: [],
          forks: [],
          dropped: false,
          radiusDrop: 1,
          ringSpacing: Math.max(0.018, built.length / 12),
          minRing: 6,
          baseRadiusAt: (s: number) => {
            const u = clamp(s / Math.max(1e-4, lStem.length), 0, 1);
            return Math.max(0.0014, petR0 * Math.pow(1 - u * 0.82, 0.85));
          },
          profileFactor: (_s: number, theta: number) => {
            const upDot = Math.sin(theta);
            return upDot > 0.2 ? 1 - 0.18 * Math.pow((upDot - 0.2) / 0.8, 2) : 1 + 0.08 * Math.max(0, -upDot);
          },
          styleAt: (s: number, _th: number, _pos: V3, _dir: V3, isJunc: boolean) => {
            const u = clamp(s / Math.max(1e-4, lStem.length), 0, 1);
            const h01 = clamp((attachS + s * 0.4) / Math.max(1e-4, H), 0, 1);
            return {
              color: mixRgb(this.colStem, this.colLeaf, 0.35 + 0.65 * u),
              roughness: isOrchid ? 0.26 : 0.48,
              translucency: 0.28 * u,
              detailMetric: isJunc ? 0.94 : 0.35 + 0.45 * u,
              anatomyLevel: 1,
              wind: [h01, leafFlexAt(u), plantPhase, 0],
              pivot: rootPivot,
            };
          },
        };
        mainStem.children.push(lStem);
        leafMounts.push({
          stem: lStem,
          isPeltatePad: false,
          bladeLen: totalSpineLen,
          bladeWidth: bladeW,
          index: li,
          baseFlex: leafAttachFlex,
          extraFlex: leafExtraFlex,
        });
      }
    }

    return { rootStems: [mainStem], bloomMounts, leafMounts };
  }

  private evalNodeAtS(nodes: WeldedNode[], targetS: number): WeldedNode {
    if (targetS <= 0 || nodes.length === 1) return nodes[0];
    const last = nodes[nodes.length - 1];
    if (targetS >= last.s) return last;
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (targetS <= b.s) {
        const f = (targetS - a.s) / Math.max(1e-6, b.s - a.s);
        return {
          pos: lerp(a.pos, b.pos, f),
          dir: normalize(lerp(a.dir, b.dir, f)),
          right: normalize(lerp(a.right, b.right, f)),
          s: targetS,
        };
      }
    }
    return last;
  }

  // ===========================================================================
  // Detailed Giant Bloom Assembly (Species-Specific Perianth + 3D Reproductive)
  // ===========================================================================

  private buildDetailedGiantBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    bm: BloomMount,
    tier: number,
  ): void {
    const p = this.p;
    const tipNode = bm.stem.nodes[bm.stem.nodes.length - 1];
    const bloomRadius = clamp(p.bloomDiameter * 0.5 * bm.scaleMul, 0.10, 1.35);

    // Orient flower axis gracefully outward/upward toward sunlit front hemisphere (`+Z`)
    const radialHoriz =
      length(v3(tipNode.pos.x, 0, tipNode.pos.z)) > 1e-3
        ? normalize(v3(tipNode.pos.x, 0, tipNode.pos.z))
        : v3(Math.sin(bm.yawHint), 0, Math.cos(bm.yawHint));
    const horizOut =
      bm.index === 0 || p.species === 'phalaenopsis_orchid'
        ? normalize(v3(Math.sin(bm.yawHint), 0, Math.cos(bm.yawHint)))
        : normalize(lerp(radialHoriz, v3(0, 0, 1), 0.42));

    const tiltRad = bm.preferForwardTiltDeg * DEG2RAD;
    const desiredAxis = normalize(
      add(scale(UP, Math.cos(tiltRad)), scale(horizOut, Math.sin(tiltRad))),
    );
    const flowerAxis = normalize(
      lerp(tipNode.dir, desiredAxis, p.species === 'phalaenopsis_orchid' ? 0.68 : 0.78),
    );
    const fRight = normalize(
      length(projectOnPlane(horizOut, flowerAxis)) > 1e-3
        ? projectOnPlane(horizOut, flowerAxis)
        : anyPerpendicular(flowerAxis),
    );
    const fFwd = normalize(cross(flowerAxis, fRight));

    // Place floral origin slightly forward of `tipNode.pos` so the green stalk cap stays
    // 100% enclosed inside the calyx/receptacle base and never pokes into the corolla heart!
    const origin = addScaled(tipNode.pos, flowerAxis, bloomRadius * 0.015);
    const bloomPivot = this.rootPivot;
    const bloomPhase = this.plantPhase;
    const openness = clamp(p.corollaOpenness, 0.30, 1.25);

    switch (p.species) {
      case 'tropical_hibiscus':
        this.buildHibiscusBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'oriental_lily':
        this.buildOrientalLilyBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'sacred_lotus':
        this.buildSacredLotusBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'tree_peony':
        this.buildTreePeonyBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'passion_orchid':
        this.buildPassionOrchidBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'titan_sunflower':
        this.buildTitanSunflowerBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'king_protea':
        this.buildKingProteaBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'honeycomb_dahlia':
        this.buildHoneycombDahliaBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'bearded_iris':
        this.buildBeardedIrisBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'phalaenopsis_orchid':
        this.buildPhalaenopsisOrchidBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'imperial_crown_bell':
        this.buildImperialCrownBellBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
      case 'bird_of_paradise':
        this.buildBirdOfParadiseBloom(
          calyxMesh, corollaMesh, reproMesh, origin, flowerAxis, fRight, fFwd,
          bloomRadius, openness, bloomPivot, bloomPhase, tier,
        );
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. COLOSSAL TROPICAL HIBISCUS (Hibiscus rosa-sinensis)
  // ---------------------------------------------------------------------------
  private buildHibiscusBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    const torusR = R * 0.11;

    // A. Epicalyx bractlets (7 narrow spreading green bracts) + 5-sepal fused calyx cup
    for (let i = 0; i < 7; i++) {
      const az = (i / 7) * TAU + 0.2;
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, az,
        torusR * 0.85, -R * 0.02, R * 0.24, R * 0.032,
        74 * DEG2RAD, 16 * DEG2RAD, bloomPivot, phase, tier,
      );
    }
    for (let i = 0; i < 5; i++) {
      const az = (i / 5) * TAU + 0.31;
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, az,
        torusR * 0.92, 0, R * 0.34, R * 0.088,
        36 * DEG2RAD, 14 * DEG2RAD, bloomPivot, phase, tier,
      );
    }

    // B. 5 Giant Asymmetric-Imbricate ("Pinwheel") Ruffled Veined Petals
    const nPetals = Math.max(5, Math.round(5 * p.petalCountScale));
    const uSegs = tier === 1 ? 16 : tier === 2 ? 22 : tier === 3 ? 30 : 38;
    const vSegs = tier === 1 ? 10 : tier === 2 ? 14 : tier === 3 ? 20 : 26;

    for (let i = 0; i < nPetals; i++) {
      const az = (i / nPetals) * TAU + this.rng.vary(0, 0.025);
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * 0.022,
          zBase: R * 0.018,
          length: R * 1.05 * this.rng.range(0.97, 1.03),
          maxHalfWidth: R * 0.58,
          clawRatio: 0.15,
          polarStartRad: 24 * DEG2RAD,
          polarMidRad: (72 * openness) * DEG2RAD,
          curlDeltaRad: (20 * p.petalCurl) * DEG2RAD,
          rollRad: 8.5 * DEG2RAD, // Contorted imbricate pinwheel overlap — zero Z-fighting!
          cupRatio: 0.15,
          ruffleAmp: R * 0.044 * p.petalRuffle,
          ruffleFreq: 14.0,
          apicalNotch: 0.028,
          veinCount: 11,
          baseThickness: R * 0.009,
          whorl01: 0,
          hasPapillae: false,
          isRayFloret: false,
          seedPhase: this.rng.next() * TAU,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // C. Iconic Exserted Monadelphous Staminal Column + 60 Reniform Anthers + 5 Velvet Stigmas!
    const colLen = R * 1.04;
    const colPts: V3[] = [];
    const nCol = 16;
    for (let k = 0; k <= nCol; k++) {
      const u = k / nCol;
      // Emerges seamlessly from inside the dark nectary floor (`-0.02 * R`) and sweeps upward!
      const arch = R * 0.13 * Math.sin(u * Math.PI * 0.92);
      const lift = R * 0.11 * u * u;
      colPts.push(
        add(
          addScaled(origin, fAxis, -R * 0.02 + colLen * u),
          scale(UP, lift - arch * 0.25),
        ),
      );
    }
    const { nodes: colNodes } = buildPolylineNodes(colPts, fRight);
    const colR0 = R * 0.036;
    this.buildSmoothOrganTube(
      reproMesh,
      colNodes,
      (u) => colR0 * lerp1(1.0, 0.34, Math.pow(u, 0.78)),
      (u) => mixRgb(mulRgb(this.colThroat, 0.65), this.colPrimary, smoothstep(0.16, 0.64, u)),
      tier >= 3 ? 12 : 8,
      bloomPivot,
      phase,
      0.16 * p.windCompliance,
    );

    // Secondary radiating filaments + 3D bilobed golden pollen anthers along upper 42% of column!
    const nStamens = Math.round(58 * clamp(p.stamenLushness, 0.4, 1.6));
    for (let si = 0; si < nStamens; si++) {
      const t = si / Math.max(1, nStamens - 1);
      const uCol = lerp1(0.52, 0.92, t);
      const idx = Math.min(colNodes.length - 1, Math.floor(uCol * (colNodes.length - 1)));
      const cNode = colNodes[idx];
      const az = si * GOLDEN_ANGLE;
      const cPerp2 = cross(cNode.dir, cNode.right);
      const radOut = add(scale(cNode.right, Math.cos(az)), scale(cPerp2, Math.sin(az)));
      const filLen = R * 0.11 * (1 - 0.28 * t) * this.rng.range(0.85, 1.15);
      const attach = addScaled(cNode.pos, radOut, colR0 * 0.45);
      const mid = add(addScaled(attach, radOut, filLen * 0.62), scale(cNode.dir, filLen * 0.24));
      const tip = add(addScaled(attach, radOut, filLen), scale(cNode.dir, filLen * 0.42));

      this.buildCurvedFilament(
        reproMesh,
        [attach, mid, tip],
        R * 0.0042,
        mixRgb(this.colPrimary, rgb(1, 0.9, 0.92), 0.45),
        bloomPivot,
        phase,
      );
      this.build3DBilobedAnther(
        reproMesh,
        tip,
        normalize(sub(tip, mid)),
        radOut,
        R * 0.021,
        this.colPollen,
        bloomPivot,
        phase,
        tier,
      );
      this.stats.stamensAndFlorets++;
    }

    // 5 Diverging Style Branches + Plush Crimson Velvet Capitate Stigma Pads at Column Apex!
    const apexNode = colNodes[colNodes.length - 1];
    const apexPerp = cross(apexNode.dir, apexNode.right);
    const stigmaCol = mixRgb(this.colThroat, rgb(0.75, 0.02, 0.14), 0.45);
    for (let k = 0; k < 5; k++) {
      const az = (k / 5) * TAU + 0.4;
      const rad = add(scale(apexNode.right, Math.cos(az)), scale(apexPerp, Math.sin(az)));
      const sLen = R * 0.105;
      const sMid = add(addScaled(apexNode.pos, apexNode.dir, sLen * 0.55), scale(rad, sLen * 0.36));
      const sTip = add(addScaled(apexNode.pos, apexNode.dir, sLen * 0.92), scale(rad, sLen * 0.72));
      this.buildCurvedFilament(reproMesh, [apexNode.pos, sMid, sTip], R * 0.0068, this.colPrimary, bloomPivot, phase);
      this.buildVelvetStigmaPad(reproMesh, sTip, normalize(sub(sTip, sMid)), R * 0.028, stigmaCol, bloomPivot, phase);
      this.stats.stamensAndFlorets++;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. GIANT STARGAZER / ORIENTAL LILY (Lilium orientalis)
  // ---------------------------------------------------------------------------
  private buildOrientalLilyBloom(
    _calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    const uSegs = tier === 1 ? 16 : tier === 2 ? 22 : tier === 3 ? 30 : 38;
    const vSegs = tier === 1 ? 10 : tier === 2 ? 14 : tier === 3 ? 18 : 24;

    // Lilies have 6 differentiated tepals: 3 narrower outer tepals + 3 broad ruffled inner tepals!
    const whorlPairs = Math.max(1, Math.round(p.petalCountScale));
    for (let w = 0; w < 2 * whorlPairs; w++) {
      const isInner = w % 2 === 1;
      const azOffset = isInner ? Math.PI / 3 : 0;
      for (let i = 0; i < 3; i++) {
        const az = (i / 3) * TAU + azOffset + this.rng.vary(0, 0.025);
        this.buildSculptedPetal(
          corollaMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          {
            azimuthRad: az,
            rBase: R * (isInner ? 0.052 : 0.068),
            zBase: R * (isInner ? 0.018 : 0.0),
            length: R * (isInner ? 1.06 : 1.02),
            maxHalfWidth: R * (isInner ? 0.34 : 0.23),
            clawRatio: 0.12,
            polarStartRad: 22 * DEG2RAD,
            polarMidRad: (66 * openness) * DEG2RAD,
            // Signature dramatic backward Stargazer reflex!
            curlDeltaRad: (54 * (0.45 + 0.65 * Math.max(0, p.petalCurl))) * DEG2RAD,
            rollRad: (isInner ? 3.5 : -3.5) * DEG2RAD,
            cupRatio: -0.08, // Gently arched keel with recurved wings
            ruffleAmp: R * (isInner ? 0.038 : 0.022) * p.petalRuffle,
            ruffleFreq: 18.0,
            apicalNotch: 0.0,
            veinCount: 7,
            baseThickness: R * 0.0095,
            whorl01: isInner ? 0.5 : 0.0,
            hasPapillae: true, // Raised 3D fleshy Stargazer throat papillae!
            isRayFloret: false,
            seedPhase: this.rng.next() * TAU,
          },
          uSegs,
          vSegs,
          bloomPivot,
          phase,
        );
        this.stats.petals++;
      }
    }

    // 6 Long Sweeping Arched Filaments + Large Versatile T-Hinged Bilobed Cinnabar Anthers!
    const nStam = Math.max(6, Math.round(6 * p.stamenLushness));
    const filCol = mixRgb(rgb(0.86, 0.96, 0.78), this.colSecondary, 0.45);
    for (let i = 0; i < nStam; i++) {
      const az = (i / nStam) * TAU + Math.PI / 6;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const sLen = R * 0.86;
      const pts: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        // Emerge tightly down the trumpet throat, then flare gracefully outward at the tip!
        const flare = R * (0.04 + 0.34 * Math.pow(u, 2.1));
        pts.push(add(addScaled(origin, fAxis, sLen * u), scale(rad, flare)));
      }
      this.buildCurvedFilament(reproMesh, pts, R * 0.011, filCol, bloomPivot, phase);
      const tip = pts[pts.length - 1];
      const tipDir = normalize(sub(tip, pts[pts.length - 2]));
      // Versatile T-mounted anther perpendicular to filament tip!
      const tMountDir = normalize(add(scale(fAxis, 0.35), scale(cross(rad, fAxis), 0.92)));
      this.build3DBilobedAnther(
        reproMesh,
        tip,
        tMountDir,
        rad,
        R * 0.085,
        this.colPollen,
        bloomPivot,
        phase,
        tier,
      );
      this.stats.stamensAndFlorets++;
    }

    // Thick Central Style + 3-Lobed Glistening Trilobate Stigma!
    const stylePts: V3[] = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      stylePts.push(
        add(addScaled(origin, fAxis, R * 0.92 * u), scale(UP, R * 0.06 * u * u)),
      );
    }
    this.buildCurvedFilament(
      reproMesh,
      stylePts,
      R * 0.016,
      mixRgb(filCol, this.colPrimary, 0.35),
      bloomPivot,
      phase,
    );
    const stTip = stylePts[stylePts.length - 1];
    const stDir = normalize(sub(stTip, stylePts[stylePts.length - 2]));
    const stP1 = anyPerpendicular(stDir);
    const stP2 = cross(stDir, stP1);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const lobePos = addScaled(
        addScaled(stTip, stDir, R * 0.014),
        add(scale(stP1, Math.cos(a)), scale(stP2, Math.sin(a))),
        R * 0.022,
      );
      this.buildVelvetStigmaPad(
        reproMesh,
        lobePos,
        stDir,
        R * 0.026,
        mixRgb(this.colThroat, this.colPrimary, 0.55),
        bloomPivot,
        phase,
      );
    }
    this.stats.stamensAndFlorets++;
  }

  // ---------------------------------------------------------------------------
  // 3. COLOSSAL SACRED LOTUS (Nelumbo nucifera)
  // ---------------------------------------------------------------------------
  private buildSacredLotusBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // 4 outer green-rose boat sepals
    for (let i = 0; i < 4; i++) {
      const az = (i / 4) * TAU + 0.35;
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, az,
        R * 0.09, -R * 0.015, R * 0.42, R * 0.14,
        62 * DEG2RAD, -10 * DEG2RAD, bloomPivot, phase, tier,
      );
    }

    // 3 Graduated Concentric Whorls of Plump Concave Striated Boat-Shaped Lotus Petals (~24 petals)
    const uSegs = tier === 1 ? 14 : tier === 2 ? 18 : tier === 3 ? 24 : 30;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 12 : tier === 3 ? 16 : 20;
    const whorls = [
      { n: Math.round(8 * p.petalCountScale), len: 1.00, hw: 0.34, pStart: 46, pMid: 76 * openness, curl: -10, rB: 0.14, zB: 0.0, w01: 0.0 },
      { n: Math.round(9 * p.petalCountScale), len: 1.02, hw: 0.32, pStart: 36, pMid: 58 * openness, curl: -14, rB: 0.13, zB: 0.025, w01: 0.48 },
      { n: Math.round(7 * p.petalCountScale), len: 0.86, hw: 0.26, pStart: 28, pMid: 44 * openness, curl: -16, rB: 0.12, zB: 0.045, w01: 0.92 },
    ];

    for (let wi = 0; wi < whorls.length; wi++) {
      const w = whorls[wi];
      for (let i = 0; i < w.n; i++) {
        const az = (i / Math.max(1, w.n)) * TAU + wi * 0.42 + this.rng.vary(0, 0.04);
        this.buildSculptedPetal(
          corollaMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          {
            azimuthRad: az,
            rBase: R * w.rB,
            zBase: R * w.zB,
            length: R * w.len * this.rng.range(0.95, 1.04),
            maxHalfWidth: R * w.hw,
            clawRatio: 0.10,
            polarStartRad: w.pStart * DEG2RAD,
            polarMidRad: w.pMid * DEG2RAD,
            curlDeltaRad: (w.curl + p.petalCurl * 18) * DEG2RAD,
            rollRad: 5.5 * DEG2RAD,
            cupRatio: 0.34, // Deep sacred boat cupping!
            ruffleAmp: R * 0.012 * p.petalRuffle,
            ruffleFreq: 10.0,
            apicalNotch: 0.0,
            veinCount: 11,
            baseThickness: R * 0.0085,
            whorl01: w.w01,
            hasPapillae: false,
            isRayFloret: false,
            seedPhase: this.rng.next() * TAU,
          },
          uSegs,
          vSegs,
          bloomPivot,
          phase,
        );
        this.stats.petals++;
      }
    }

    // Iconic Flat-Topped Obconical Golden Seed Receptacle (Torus) + Sunken Carpel Pits!
    this.buildLotusSeedTorus(reproMesh, addScaled(origin, fAxis, R * 0.055), fAxis, fRight, fFwd, R * 0.25, R * 0.25, bloomPivot, phase, tier);

    // Dense Halo Ring of 96–130 Golden Stamens + Linear Twin-Chambered Anthers!
    const nStam = Math.round((tier === 1 ? 56 : 112) * clamp(p.stamenLushness, 0.4, 1.6));
    for (let i = 0; i < nStam; i++) {
      const ring = i % 3;
      const az = i * GOLDEN_ANGLE;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const rAttach = R * (0.11 + 0.028 * ring);
      const sLen = R * (0.36 + 0.06 * ring) * this.rng.range(0.94, 1.08);
      const baseP = add(addScaled(origin, fAxis, R * 0.045), scale(rad, rAttach));
      const midP = add(addScaled(baseP, fAxis, sLen * 0.56), scale(rad, sLen * 0.32));
      const tipP = add(addScaled(baseP, fAxis, sLen * 0.96), scale(rad, sLen * 0.40));
      this.buildCurvedFilament(
        reproMesh,
        [baseP, midP, tipP],
        R * 0.0042,
        mixRgb(rgb(1, 0.95, 0.72), this.colPollen, 0.55),
        bloomPivot,
        phase,
      );
      this.build3DBilobedAnther(
        reproMesh,
        tipP,
        normalize(sub(tipP, midP)),
        rad,
        R * 0.032,
        this.colPollen,
        bloomPivot,
        phase,
        tier,
      );
      this.stats.stamensAndFlorets++;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. IMPERIAL GIANT TREE PEONY (Paeonia suffruticosa)
  // ---------------------------------------------------------------------------
  private buildTreePeonyBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // 5 Cupped Leafy Rounded Outer Sepals
    for (let i = 0; i < 5; i++) {
      const az = (i / 5) * TAU + 0.22;
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, az,
        R * 0.11, -R * 0.02, R * 0.44, R * 0.18,
        68 * DEG2RAD, -8 * DEG2RAD, bloomPivot, phase, tier,
      );
    }

    // 4 Lush Goffered Silk-Ruffled Concentric Petal Whorls (~36–46 double petals) framing a blazing golden stamen heart!
    const uSegs = tier === 1 ? 12 : tier === 2 ? 16 : tier === 3 ? 22 : 28;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 12 : tier === 3 ? 16 : 22;
    const totalPetals = Math.max(18, Math.round(36 * p.petalCountScale));

    for (let i = 0; i < totalPetals; i++) {
      const t = i / Math.max(1, totalPetals - 1); // 0 = outer saucer, 1 = inner crinkled ring around stamens
      const az = i * GOLDEN_ANGLE + this.rng.vary(0, 0.05);
      const pLen = R * lerp1(1.04, 0.58, Math.pow(t, 1.1)) * this.rng.range(0.94, 1.05);
      const pHW = R * lerp1(0.48, 0.28, t) * this.rng.range(0.92, 1.06);
      const polarMid = lerp1(82 * openness, 42 * openness, Math.pow(t, 0.85));

      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * lerp1(0.24, 0.14, t),
          zBase: R * lerp1(0.0, 0.055, t),
          length: pLen,
          maxHalfWidth: pHW,
          clawRatio: 0.15,
          polarStartRad: lerp1(44, 28, t) * DEG2RAD,
          polarMidRad: polarMid * DEG2RAD,
          curlDeltaRad: (lerp1(14, -10, t) + p.petalCurl * 14) * DEG2RAD,
          rollRad: (7.5 + 4.5 * Math.sin(i * 1.7)) * DEG2RAD,
          cupRatio: lerp1(0.18, 0.30, t),
          ruffleAmp: R * lerp1(0.052, 0.038, t) * (0.4 + 0.85 * p.petalRuffle),
          ruffleFreq: 14.0 + (i % 3) * 2.5,
          apicalNotch: 0.055 + 0.035 * ((i * 0.618) % 1),
          veinCount: 9,
          baseThickness: R * 0.0072,
          whorl01: t,
          hasPapillae: false,
          isRayFloret: false,
          seedPhase: this.rng.next() * TAU,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // Blazing Golden-Anther / Crimson-Filament Stamen Heart + 5 Plush Velvet Carpels!
    const nStam = Math.round((tier === 1 ? 58 : 116) * clamp(p.stamenLushness, 0.4, 1.6));
    for (let i = 0; i < nStam; i++) {
      const t = i / Math.max(1, nStam - 1);
      const az = i * GOLDEN_ANGLE;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const rB = R * lerp1(0.055, 0.145, t);
      const sLen = R * lerp1(0.32, 0.44, t) * this.rng.range(0.90, 1.10);
      const bP = add(addScaled(origin, fAxis, R * 0.06), scale(rad, rB));
      const mP = add(addScaled(bP, fAxis, sLen * 0.68), scale(rad, sLen * 0.28));
      const tP = add(addScaled(bP, fAxis, sLen), scale(rad, sLen * 0.48));
      this.buildCurvedFilament(reproMesh, [bP, mP, tP], R * 0.0052, this.colThroat, bloomPivot, phase);
      this.build3DBilobedAnther(
        reproMesh, tP, normalize(sub(tP, mP)), rad, R * 0.032, this.colPollen, bloomPivot, phase, tier,
      );
      this.stats.stamensAndFlorets++;
    }

    // 5 Central Plush Crimson-Velvet Carpels nestled inside the golden stamen crown!
    this.buildVelvetStigmaPad(reproMesh, addScaled(origin, fAxis, R * 0.05), fAxis, R * 0.09, this.colThroat, bloomPivot, phase);
    for (let k = 0; k < 5; k++) {
      const az = (k / 5) * TAU;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const cPos = add(addScaled(origin, fAxis, R * 0.14), scale(rad, R * 0.038));
      this.buildVelvetStigmaPad(
        reproMesh, cPos, normalize(add(fAxis, scale(rad, 0.35))), R * 0.042, this.colPrimary, bloomPivot, phase,
      );
      this.stats.stamensAndFlorets++;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. COLOSSAL CROWN PASSIONFLOWER / EXOTIC ORCHID (Passiflora caerulea)
  // ---------------------------------------------------------------------------
  private buildPassionOrchidBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // 3 Leafy Involucral Bracts beneath receptacle
    for (let i = 0; i < 3; i++) {
      const az = (i / 3) * TAU + 0.5;
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, az,
        R * 0.10, -R * 0.03, R * 0.36, R * 0.16,
        78 * DEG2RAD, 10 * DEG2RAD, bloomPivot, phase, tier,
      );
    }

    // 10-Part Radiant Star Perianth (5 Outer Keeled Sepaloid Tepals + 5 Inner Vivid Petals)
    const uSegs = tier === 1 ? 14 : tier === 2 ? 20 : tier === 3 ? 26 : 32;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 12 : tier === 3 ? 16 : 20;
    const nHalf = Math.max(5, Math.round(5 * p.petalCountScale));

    for (let w = 0; w < 2; w++) {
      const isInner = w === 1;
      for (let i = 0; i < nHalf; i++) {
        const az = (i / nHalf) * TAU + (isInner ? Math.PI / nHalf : 0);
        this.buildSculptedPetal(
          corollaMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          {
            azimuthRad: az,
            rBase: R * 0.11,
            zBase: R * (isInner ? 0.018 : 0.0),
            length: R * (isInner ? 0.98 : 1.02),
            maxHalfWidth: R * (isInner ? 0.21 : 0.22),
            clawRatio: 0.08,
            polarStartRad: 58 * DEG2RAD,
            polarMidRad: (84 * openness) * DEG2RAD,
            curlDeltaRad: (12 * p.petalCurl) * DEG2RAD,
            rollRad: (isInner ? 2.5 : -2.5) * DEG2RAD,
            cupRatio: 0.22,
            ruffleAmp: R * 0.014 * p.petalRuffle,
            ruffleFreq: 14.0,
            apicalNotch: 0.0,
            veinCount: 7,
            baseThickness: R * 0.009,
            whorl01: isInner ? 0.65 : 0.0,
            hasPapillae: false,
            isRayFloret: false,
            seedPhase: this.rng.next() * TAU,
          },
          uSegs,
          vSegs,
          bloomPivot,
          phase,
        );
        this.stats.petals++;
      }
    }

    // Extravagant 2-Ring Banded 3D Corona of 76–96 Undulating Radial Filaments sweeping ABOVE the perianth!
    const nCorona = Math.round((tier === 1 ? 52 : 84) * clamp(p.stamenLushness, 0.4, 1.6));
    for (let i = 0; i < nCorona; i++) {
      const isOuter = i % 2 === 0;
      const az = (i / nCorona) * TAU;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const cLen = R * (isOuter ? 0.72 : 0.48) * this.rng.range(0.95, 1.05);
      const pts: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        const wave = Math.sin(u * Math.PI * 2.6 + i * 0.35) * R * 0.024 * u;
        const archAbovePetals = R * (0.095 + 0.085 * Math.sin(u * Math.PI * 0.85) + (isOuter ? 0.0 : 0.035));
        pts.push(
          add(
            addScaled(origin, fAxis, archAbovePetals + wave),
            scale(rad, R * 0.09 + cLen * u),
          ),
        );
      }
      this.buildBandedCoronaFilament(reproMesh, pts, R * (isOuter ? 0.013 : 0.010), bloomPivot, phase);
      this.stats.stamensAndFlorets++;
    }

    // Central Elevated Androgynophore Column + Globose Ovary + 5 Versatile Paddle Anthers + 3 Club Stigmas!
    const colH = R * 0.42;
    const colNodes = buildPolylineNodes(
      [origin, addScaled(origin, fAxis, colH * 0.5), addScaled(origin, fAxis, colH)],
      fRight,
    ).nodes;
    this.buildSmoothOrganTube(
      reproMesh,
      colNodes,
      (u) => R * (0.045 * (1 - 0.35 * u) + 0.025 * Math.exp(-((u - 0.15) ** 2) / 0.02)),
      (u) => mixRgb(this.colSepal, this.colSecondary, u * 0.55),
      10,
      bloomPivot,
      phase,
      0.10 * p.windCompliance,
    );

    const gynTop = addScaled(origin, fAxis, colH * 0.72);
    // 5 Radially Splayed Filaments + Large Flat Versatile Paddle Anthers
    for (let k = 0; k < 5; k++) {
      const az = (k / 5) * TAU + 0.2;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const midP = add(addScaled(gynTop, rad, R * 0.13), scale(fAxis, R * 0.02));
      const tipP = add(addScaled(gynTop, rad, R * 0.24), scale(fAxis, -R * 0.03));
      this.buildCurvedFilament(reproMesh, [gynTop, midP, tipP], R * 0.0085, this.colSepal, bloomPivot, phase);
      const tang = cross(fAxis, rad);
      this.build3DBilobedAnther(reproMesh, tipP, tang, fAxis, R * 0.072, this.colPollen, bloomPivot, phase, tier);
      this.stats.stamensAndFlorets++;
    }

    // Globose Central Ovary + 3 Overarching Maroon Clubbed Stigmas!
    const ovaryCenter = addScaled(origin, fAxis, colH * 0.88);
    this.buildVelvetStigmaPad(reproMesh, ovaryCenter, fAxis, R * 0.068, this.colSepal, bloomPivot, phase);
    const ovaryApex = addScaled(origin, fAxis, colH * 1.02);
    for (let k = 0; k < 3; k++) {
      const az = (k / 3) * TAU + 0.6;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const sMid = add(addScaled(ovaryApex, fAxis, R * 0.11), scale(rad, R * 0.10));
      const sTip = add(addScaled(ovaryApex, fAxis, R * 0.08), scale(rad, R * 0.22));
      this.buildCurvedFilament(reproMesh, [ovaryApex, sMid, sTip], R * 0.0095, this.colThroat, bloomPivot, phase);
      this.buildVelvetStigmaPad(reproMesh, sTip, normalize(sub(sTip, sMid)), R * 0.036, this.colThroat, bloomPivot, phase);
      this.stats.stamensAndFlorets++;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. GIANT ROYAL HELIANTHUS / TITAN SUNFLOWER (Composite Capitulum)
  // ---------------------------------------------------------------------------
  private buildTitanSunflowerBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    const discR = R * 0.44;

    // A. 3 Staggered Whorls of Acuminate Green Involucral Phyllaries (Bracts) cradling the saucer!
    for (let w = 0; w < 3; w++) {
      const nBracts = 16 + w * 4;
      for (let i = 0; i < nBracts; i++) {
        const az = (i / nBracts) * TAU + w * 0.21;
        this.buildCalyxSepal(
          calyxMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          az,
          discR * (0.72 + 0.12 * w),
          -R * (0.04 - 0.015 * w),
          R * (0.30 - 0.03 * w),
          R * 0.068,
          (88 + w * 8) * DEG2RAD,
          20 * DEG2RAD,
          bloomPivot,
          phase,
          tier,
        );
      }
    }

    // B. 2 Staggered Outer Rings of 3D Grooved Ligulate Ray Florets ("Petals")!
    const nRays = Math.max(20, Math.round(42 * p.petalCountScale));
    const uSegs = tier === 1 ? 12 : tier === 2 ? 16 : tier === 3 ? 22 : 28;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 10 : tier === 3 ? 14 : 18;

    for (let i = 0; i < nRays; i++) {
      const ring = i % 2;
      const az = (i / nRays) * TAU + this.rng.vary(0, 0.018);
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: discR * (0.94 + 0.05 * ring),
          zBase: R * (0.025 - 0.014 * ring),
          length: R * (0.62 + 0.04 * ring) * this.rng.range(0.94, 1.06),
          maxHalfWidth: R * 0.098 * this.rng.range(0.92, 1.08),
          clawRatio: 0.11,
          polarStartRad: 76 * DEG2RAD,
          polarMidRad: (88 * openness) * DEG2RAD,
          curlDeltaRad: (18 * p.petalCurl) * DEG2RAD,
          rollRad: (ring === 0 ? 3.2 : -3.2) * DEG2RAD,
          cupRatio: -0.06,
          ruffleAmp: R * 0.008 * p.petalRuffle,
          ruffleFreq: 12.0,
          apicalNotch: 0.045,
          veinCount: 5,
          baseThickness: R * 0.0062,
          whorl01: ring * 0.35,
          hasPapillae: false,
          isRayFloret: true, // Signature twin longitudinal plication channels!
          seedPhase: this.rng.next() * TAU,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // C. Central Domed Receptacle Cushion + Fibonacci Golden-Angle Spiral (`137.50776°`) of 3D Tubular Disc Florets!
    this.buildFibonacciCapitulumDisc(
      reproMesh,
      origin,
      fAxis,
      fRight,
      fFwd,
      discR,
      R * 0.11,
      bloomPivot,
      phase,
      tier,
    );
  }

  // ---------------------------------------------------------------------------
  // 7. GIANT KING PROTEA (Protea cynaroides — South African Royal Goblet Crown)
  // ---------------------------------------------------------------------------
  private buildKingProteaBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // A. Basal Woody Imbricate Scaly Involucral Cup (2 staggered rings of short ruby-olive scales)
    for (let w = 0; w < 2; w++) {
      const nScales = 12 + w * 2;
      for (let i = 0; i < nScales; i++) {
        const az = (i / nScales) * TAU + w * 0.24;
        this.buildCalyxSepal(
          calyxMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          az,
          R * (0.18 + 0.04 * w),
          R * (-0.02 + 0.03 * w),
          R * (0.28 + 0.08 * w),
          R * 0.11,
          (66 - w * 12) * DEG2RAD,
          -6 * DEG2RAD,
          bloomPivot,
          phase,
          tier,
        );
      }
    }

    // B. 3 Royal Concentric Crowns of Pointed Velvet-Rimmed Carmine Involucral Bracts (~42 bracts)!
    const uSegs = tier === 1 ? 12 : tier === 2 ? 16 : tier === 3 ? 22 : 28;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 10 : tier === 3 ? 14 : 18;
    const rings = [
      { n: Math.round(13 * p.petalCountScale), rB: 0.24, zB: 0.04, len: 0.72, hw: 0.19, p0: 48, pM: 68 * openness, curl: -6, w01: 0.0 },
      { n: Math.round(15 * p.petalCountScale), rB: 0.28, zB: 0.07, len: 0.94, hw: 0.21, p0: 36, pM: 52 * openness, curl: -8, w01: 0.45 },
      { n: Math.round(14 * p.petalCountScale), rB: 0.30, zB: 0.10, len: 1.04, hw: 0.18, p0: 26, pM: 38 * openness, curl: -10, w01: 0.90 },
    ];

    for (let ri = 0; ri < rings.length; ri++) {
      const rg = rings[ri];
      for (let i = 0; i < rg.n; i++) {
        const az = (i / Math.max(1, rg.n)) * TAU + ri * 0.21 + this.rng.vary(0, 0.02);
        this.buildSculptedPetal(
          corollaMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          {
            azimuthRad: az,
            rBase: R * rg.rB,
            zBase: R * rg.zB,
            length: R * rg.len * this.rng.range(0.96, 1.04),
            maxHalfWidth: R * rg.hw,
            clawRatio: 0.10,
            polarStartRad: rg.p0 * DEG2RAD,
            polarMidRad: rg.pM * DEG2RAD,
            curlDeltaRad: (rg.curl + p.petalCurl * 10) * DEG2RAD,
            rollRad: 3.0 * DEG2RAD,
            cupRatio: 0.28,
            ruffleAmp: R * 0.004 * p.petalRuffle,
            ruffleFreq: 10.0,
            apicalNotch: 0.0,
            veinCount: 7,
            baseThickness: R * 0.012,
            whorl01: rg.w01,
            hasPapillae: false,
            isRayFloret: false,
            planform: 'acute_bract',
            colorOverride: (u, absS, veinRidge, isAbax) => {
              // Signature King Protea: rich carmine-rose body, deep ruby base, and frosted silvery-blush velvet margin!
              let c = mixRgb(this.colThroat, this.colPrimary, smoothstep(0.05, 0.45, u));
              const frostedMargin = smoothstep(0.68, 0.97, absS) * (0.55 + 0.45 * p.edgeBlend);
              const tipFrost = smoothstep(0.76, 0.99, u) * 0.65 * p.edgeBlend;
              c = mixRgb(c, this.colSecondary, clamp(frostedMargin + tipFrost, 0, 1));
              c = mixRgb(c, this.colVein, veinRidge * 0.35 * p.veinContrast);
              return isAbax ? mulRgb(c, 0.88) : c;
            },
            seedPhase: this.rng.next() * TAU,
          },
          uSegs,
          vSegs,
          bloomPivot,
          phase,
        );
        this.stats.petals++;
      }
    }

    // C. Colossal Plush Snowy-Blush Central Dome Cushion of ~240 Curved Silky Plumose Style Florets!
    const domeR = R * 0.36;
    const domeH = R * 0.34;
    this.buildVelvetStigmaPad(
      reproMesh,
      addScaled(origin, fAxis, R * 0.16),
      fAxis,
      domeR * 0.92,
      mixRgb(this.colPollen, this.colSecondary, 0.35),
      bloomPivot,
      phase,
    );

    const nStyles = Math.round((tier === 1 ? 110 : tier === 2 ? 170 : 250) * clamp(p.stamenLushness, 0.45, 1.5));
    const shaftSnow = mixRgb(this.colPollen, rgb(1.0, 0.97, 0.98), 0.65);
    const tipRuby = mixRgb(this.colPrimary, this.colSecondary, 0.25);

    for (let i = 0; i < nStyles; i++) {
      const rNorm = Math.sqrt((i + 0.5) / nStyles);
      const az = i * GOLDEN_ANGLE;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const rBase = domeR * 0.92 * rNorm;
      const zBase = R * 0.10 + domeH * 0.35 * (1 - rNorm * rNorm);
      const sLen = R * lerp1(0.46, 0.36, rNorm) * this.rng.range(0.93, 1.06);

      // Curve gracefully upward then inward so all 250 silky styles dome into a plush royal cushion!
      const b0 = add(addScaled(origin, fAxis, zBase), scale(rad, rBase));
      const b1 = add(addScaled(b0, fAxis, sLen * 0.56), scale(rad, sLen * 0.08 * (1 - rNorm)));
      const b2 = add(addScaled(b0, fAxis, sLen), scale(rad, -sLen * 0.26 * rNorm));

      this.buildCurvedFilament(reproMesh, [b0, b1, b2], R * 0.0078, shaftSnow, bloomPivot, phase);
      this.buildVelvetStigmaPad(
        reproMesh,
        b2,
        normalize(sub(b2, b1)),
        R * 0.016,
        tipRuby,
        bloomPivot,
        phase,
      );
      this.stats.stamensAndFlorets++;
    }
  }

  // ---------------------------------------------------------------------------
  // 8. COLOSSAL HONEYCOMB POMPON / DECORATIVE DAHLIA (Dahlia pinnata)
  // ---------------------------------------------------------------------------
  private buildHoneycombDahliaBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // 8 Leafy Green Outer Involucral Bracts beneath sphere
    for (let i = 0; i < 8; i++) {
      const az = (i / 8) * TAU + 0.2;
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, az,
        R * 0.12, -R * 0.03, R * 0.34, R * 0.10,
        96 * DEG2RAD, 18 * DEG2RAD, bloomPivot, phase, tier,
      );
    }

    // Geometric Fibonacci Parastichy Sphere/Dome of ~108 3D Involute Quilled Scoop-Florets!
    const totalQuills = Math.max(48, Math.round((tier === 1 ? 68 : tier === 2 ? 88 : 112) * p.petalCountScale));
    const uSegs = tier === 1 ? 10 : tier === 2 ? 12 : tier === 3 ? 16 : 20;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 10 : tier === 3 ? 12 : 16;

    for (let i = 0; i < totalQuills; i++) {
      // `t = 0` = outermost reflexed quills, `t = 1` = tight glowing central bud-eye!
      const t = i / Math.max(1, totalQuills - 1);
      const rNorm = Math.sqrt(1 - t); // Vogel uniform dome packing!
      const az = i * GOLDEN_ANGLE;

      const domeZ = R * 0.26 * (1 - rNorm * rNorm);
      const rAttach = R * 0.24 * rNorm;
      const pLen = R * lerp1(0.22, 0.78, Math.pow(rNorm, 0.72)) * this.rng.range(0.95, 1.05);
      const pHW = pLen * lerp1(0.32, 0.26, rNorm);
      const polarMid = lerp1(14, 98 * openness, Math.pow(rNorm, 0.86));

      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: rAttach,
          zBase: domeZ,
          length: pLen,
          maxHalfWidth: pHW,
          clawRatio: 0.12,
          polarStartRad: Math.max(8, polarMid * 0.62) * DEG2RAD,
          polarMidRad: polarMid * DEG2RAD,
          curlDeltaRad: (lerp1(-18, 16, rNorm) + p.petalCurl * 14) * DEG2RAD,
          rollRad: 2.0 * DEG2RAD,
          cupRatio: lerp1(0.88, 0.62, rNorm), // Deep 3D involute honeycomb quill scroll!
          ruffleAmp: R * 0.005 * p.petalRuffle,
          ruffleFreq: 10.0,
          apicalNotch: 0.0,
          veinCount: 5,
          baseThickness: R * 0.0052,
          whorl01: t,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'involute_quill',
          colorOverride: (u, absS, veinRidge, isAbax) => {
            // Dramatic radial Dahlia ombre: deep velvet heart (`t -> 1`) sweeping into blazing primary & glowing secondary tips!
            const heartGlow = smoothstep(0.45, 0.98, t);
            let c = mixRgb(this.colPrimary, this.colThroat, heartGlow * 0.78);
            const tipFlame = smoothstep(0.42, 0.96, u) * p.edgeBlend * (1 - 0.55 * heartGlow);
            c = mixRgb(c, this.colSecondary, tipFlame + 0.18 * absS * p.edgeBlend);
            c = mixRgb(c, this.colVein, veinRidge * 0.35 * p.veinContrast);
            return isAbax ? mixRgb(c, this.colSecondary, 0.28) : c;
          },
          seedPhase: (i * 0.618) * TAU,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // Tight Golden Micro-Floret Eye right at the Dahlia apex!
    const eyeOrigin = addScaled(origin, fAxis, R * 0.28);
    for (let k = 0; k < 24; k++) {
      const rk = R * 0.055 * Math.sqrt((k + 0.5) / 24);
      const az = k * GOLDEN_ANGLE;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const pt = add(eyeOrigin, scale(rad, rk));
      this.buildVelvetStigmaPad(reproMesh, pt, fAxis, R * 0.012, this.colPollen, bloomPivot, phase);
      this.stats.stamensAndFlorets++;
    }
  }

  // ---------------------------------------------------------------------------
  // 9. GIANT CATHEDRAL BEARDED IRIS (Iris germanica)
  // ---------------------------------------------------------------------------
  private buildBeardedIrisBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // Papery green-violet spathe bract valves cradling the perianth tube
    for (let i = 0; i < 2; i++) {
      this.buildCalyxSepal(
        calyxMesh, origin, fAxis, fRight, fFwd, i * Math.PI + 0.4,
        R * 0.08, -R * 0.06, R * 0.38, R * 0.13,
        24 * DEG2RAD, -6 * DEG2RAD, bloomPivot, phase, tier,
      );
    }

    const uSegs = tier === 1 ? 16 : tier === 2 ? 22 : tier === 3 ? 28 : 36;
    const vSegs = tier === 1 ? 10 : tier === 2 ? 14 : tier === 3 ? 18 : 24;
    const symmetryCount = Math.max(3, Math.round(3 * p.petalCountScale));

    // A. 3 Towering Incurved Ruffled Silk "Standards" (forming the vaulted upper cathedral dome!)
    for (let i = 0; i < symmetryCount; i++) {
      const az = (i / symmetryCount) * TAU + Math.PI / 6;
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * 0.06,
          zBase: R * 0.08,
          length: R * 0.96,
          maxHalfWidth: R * 0.44,
          clawRatio: 0.18,
          polarStartRad: 48 * DEG2RAD,
          polarMidRad: 36 * DEG2RAD,
          curlDeltaRad: -54 * DEG2RAD, // Sweeps inward at the summit so the 3 Standards kiss overhead!
          rollRad: 6.0 * DEG2RAD,
          cupRatio: 0.26,
          ruffleAmp: R * 0.056 * (0.4 + 0.85 * p.petalRuffle),
          ruffleFreq: 16.0,
          apicalNotch: 0.04,
          veinCount: 9,
          baseThickness: R * 0.0075,
          whorl01: 0.0,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'obovate',
          colorOverride: (u, absS, veinRidge) => {
            let c = mixRgb(this.colPrimary, this.colSecondary, smoothstep(0.25, 0.95, u * 0.65 + absS * 0.45) * (0.45 + 0.55 * p.edgeBlend));
            c = mixRgb(c, this.colVein, veinRidge * 0.28 * p.veinContrast * (1 - 0.5 * u));
            return c;
          },
          seedPhase: this.rng.next() * TAU,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // B. 3 Cascading Velvet "Falls" + White-Striated Haft + Plush 3D Fuzzy Tangerine "Caterpillar Beards" + 3 Bifid Style Arms!
    for (let i = 0; i < symmetryCount; i++) {
      const az = (i / symmetryCount) * TAU + Math.PI / 6 + Math.PI / symmetryCount;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const tan = add(scale(fRight, -Math.sin(az)), scale(fFwd, Math.cos(az)));

      const fallLen = R * 1.06;
      const fallPolarStart = 64 * DEG2RAD;
      const fallPolarMid = (114 * clamp(openness, 0.65, 1.18)) * DEG2RAD;
      const fallCurl = (22 + p.petalCurl * 16) * DEG2RAD;

      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * 0.07,
          zBase: R * 0.04,
          length: fallLen,
          maxHalfWidth: R * 0.46,
          clawRatio: 0.24,
          polarStartRad: fallPolarStart,
          polarMidRad: fallPolarMid,
          curlDeltaRad: fallCurl,
          rollRad: 0.0,
          cupRatio: -0.14, // Convex cascading waterfall tongue!
          ruffleAmp: R * 0.052 * (0.4 + 0.85 * p.petalRuffle),
          ruffleFreq: 15.0,
          apicalNotch: 0.03,
          veinCount: 11,
          baseThickness: R * 0.0085,
          whorl01: 0.6,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'obovate',
          colorOverride: (u, absS, veinRidge, isAbax) => {
            // Deep royal-indigo velvet Fall skirt (`colThroat`), pale lavender rim (`colSecondary`),
            // and crisp white/ivory haft tiger-striations (`colVein`) around the tangerine beard!
            let c = mixRgb(this.colThroat, this.colPrimary, smoothstep(0.68, 0.98, absS) * p.edgeBlend);
            c = mixRgb(c, this.colSecondary, smoothstep(0.82, 0.99, absS) * 0.65 * p.edgeBlend);
            if (u < 0.46) {
              const haftZone = 1 - smoothstep(0.24, 0.46, u);
              const haftBase = mixRgb(this.colVein, rgb(1, 0.98, 0.94), 0.55);
              const tigerStripe = smoothstep(0.35, 0.85, veinRidge);
              const haftCol = mixRgb(haftBase, this.colThroat, tigerStripe * 0.78);
              c = mixRgb(c, haftCol, haftZone * 0.92);
            }
            return isAbax ? mixRgb(c, this.colPrimary, 0.35) : c;
          },
          seedPhase: this.rng.next() * TAU,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;

      // Overarching Petaloid Style Arm with Upturned Bifid Crest right above the Beard!
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * 0.04,
          zBase: R * 0.10,
          length: R * 0.48,
          maxHalfWidth: R * 0.11,
          clawRatio: 0.10,
          polarStartRad: 44 * DEG2RAD,
          polarMidRad: 68 * DEG2RAD,
          curlDeltaRad: -34 * DEG2RAD,
          rollRad: 0,
          cupRatio: -0.22,
          ruffleAmp: R * 0.012,
          ruffleFreq: 12.0,
          apicalNotch: 0.22, // Bifid 2-lobed style crest!
          veinCount: 5,
          baseThickness: R * 0.006,
          whorl01: 0.3,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'obovate',
          colorOverride: () => mixRgb(this.colSecondary, this.colVein, 0.35),
          seedPhase: i * 1.7,
        },
        12,
        10,
        bloomPivot,
        phase,
      );
      this.stats.petals++;

      // Iconic 3D Plush Fuzzy Tangerine "Caterpillar Beard" (~88 upright 3D filaments along Fall midrib!)
      const nBeardHairs = Math.round((tier === 1 ? 45 : 88) * clamp(p.stamenLushness, 0.5, 1.6));
      let spineCur = add(addScaled(origin, rad, R * 0.07), scale(fAxis, R * 0.04));
      const beardSteps = 16;
      const fallSpinePts: V3[] = [spineCur];
      const fallSpineNrms: V3[] = [];
      for (let ks = 0; ks <= beardSteps; ks++) {
        const u = ks / beardSteps;
        const pol = lerp1(fallPolarStart, fallPolarMid, smoothstep(0.0, 0.58, u)) + fallCurl * Math.pow(u, 1.85);
        const T = add(scale(fAxis, Math.cos(pol)), scale(rad, Math.sin(pol)));
        const N = add(scale(fAxis, Math.sin(pol)), scale(rad, -Math.cos(pol)));
        fallSpineNrms.push(N);
        if (ks < beardSteps) {
          spineCur = addScaled(spineCur, T, (fallLen * 0.48) / beardSteps);
          fallSpinePts.push(spineCur);
        }
      }

      for (let bh = 0; bh < nBeardHairs; bh++) {
        const uB = bh / Math.max(1, nBeardHairs - 1); // [0..1] along beard strip (`u = 0.06..0.46` of Fall)
        const sIdx = Math.min(beardSteps, Math.floor(uB * beardSteps));
        const spP = fallSpinePts[sIdx];
        const spN = fallSpineNrms[sIdx];
        const latSpread = (this.rng.next() * 2 - 1) * R * 0.042 * Math.sin(Math.PI * (0.15 + 0.75 * uB));
        const bBase = add(addScaled(spP, tan, latSpread), scale(spN, R * 0.006));
        const hLen = R * 0.068 * Math.sin(Math.PI * (0.18 + 0.72 * uB)) * this.rng.range(0.82, 1.18);
        const hDir = normalize(add(spN, scale(tan, (this.rng.next() - 0.5) * 0.35)));
        const bMid = addScaled(bBase, hDir, hLen * 0.55);
        const bTip = addScaled(bBase, hDir, hLen);
        this.buildCurvedFilament(
          reproMesh,
          [bBase, bMid, bTip],
          R * 0.0046,
          mixRgb(rgb(1.0, 0.88, 0.35), this.colPollen, 0.65),
          bloomPivot,
          phase,
        );
        this.buildVelvetStigmaPad(reproMesh, bTip, hDir, R * 0.0095, this.colPollen, bloomPivot, phase);
        this.stats.stamensAndFlorets++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 10. EXOTIC MOTH ORCHID SPRAY (Phalaenopsis grandiflora — Bilateral Zygomorphic Jewel)
  // ---------------------------------------------------------------------------
  private buildPhalaenopsisOrchidBloom(
    _calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    _fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // Construct gravity-referenced bilateral orchid frame so Dorsal Sepal is always at 12 o'clock
    // and the sculpted Trilobed Labellum (Lip) sits at 6 o'clock!
    const upProj = projectOnPlane(UP, fAxis);
    const oUp = length(upProj) > 1e-3 ? normalize(upProj) : normalize(cross(fRight, fAxis));
    const oRight = normalize(cross(oUp, fAxis));
    // Note: in `buildSculptedPetal(..., fAxis, B1, B2)`, `az = 0` points along `B1` (`oUp` = 12 o'clock)
    // and `az = +PI/2` points along `B2` (`oRight` = 3 o'clock), `az = PI` = `-oUp` (6 o'clock Lip)!

    const uSegs = tier === 1 ? 14 : tier === 2 ? 20 : tier === 3 ? 26 : 34;
    const vSegs = tier === 1 ? 10 : tier === 2 ? 14 : tier === 3 ? 18 : 24;

    // A. 3 Sculpted Sepals (1 Upright Dorsal Sepal at `0°` + 2 Angled Keeled Lateral Sepals at `±136°`)
    const sepalAzimuths = [0, 136 * DEG2RAD, -136 * DEG2RAD];
    for (let si = 0; si < 3; si++) {
      const isDorsal = si === 0;
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        oUp,
        oRight,
        {
          azimuthRad: sepalAzimuths[si],
          rBase: R * 0.05,
          zBase: -R * 0.015,
          length: R * (isDorsal ? 0.94 : 0.90),
          maxHalfWidth: R * (isDorsal ? 0.34 : 0.29),
          clawRatio: 0.12,
          polarStartRad: 72 * DEG2RAD,
          polarMidRad: (86 * openness) * DEG2RAD,
          curlDeltaRad: (8 * p.petalCurl) * DEG2RAD,
          rollRad: si === 1 ? 4 * DEG2RAD : si === 2 ? -4 * DEG2RAD : 0,
          cupRatio: 0.14,
          ruffleAmp: R * 0.008 * p.petalRuffle,
          ruffleFreq: 10.0,
          apicalNotch: 0.0,
          veinCount: 7,
          baseThickness: R * 0.010,
          whorl01: 0.15,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'pointed_boat',
          colorOverride: (u, absS, veinRidge, isAbax) => {
            const flush = (1 - smoothstep(0.0, 0.72, u)) * p.edgeBlend * 0.55;
            let c = mixRgb(this.colPrimary, this.colSecondary, flush);
            c = mixRgb(c, this.colVein, veinRidge * 0.42 * p.veinContrast * (1 - 0.35 * u));
            return isAbax ? mixRgb(c, this.colSepal, 0.22) : c;
          },
          seedPhase: si * 1.1,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // B. 2 Huge Plush Diamond-Round Lateral "Moth Wing" Petals (`±74°`)!
    for (const sign of [-1, 1]) {
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        oUp,
        oRight,
        {
          azimuthRad: sign * 74 * DEG2RAD,
          rBase: R * 0.05,
          zBase: R * 0.012,
          length: R * 1.02,
          maxHalfWidth: R * 0.56,
          clawRatio: 0.14,
          polarStartRad: 66 * DEG2RAD,
          polarMidRad: (80 * openness) * DEG2RAD,
          curlDeltaRad: (-8 + p.petalCurl * 10) * DEG2RAD,
          rollRad: sign * -3.5 * DEG2RAD,
          cupRatio: 0.16,
          ruffleAmp: R * 0.018 * p.petalRuffle,
          ruffleFreq: 12.0,
          apicalNotch: 0.02,
          veinCount: 9,
          baseThickness: R * 0.0095,
          whorl01: 0.0,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'orchid_wing',
          colorOverride: (u, absS, veinRidge) => {
            // Radiant fuchsia nectar-flush radiating from center into luminous pearl-blush moth wings!
            const centerFlush = (1 - smoothstep(0.08, 0.68, u * 0.85 + absS * 0.35)) * (0.45 + 0.55 * p.edgeBlend);
            let c = mixRgb(this.colPrimary, this.colSecondary, centerFlush);
            c = mixRgb(c, this.colVein, veinRidge * 0.52 * p.veinContrast * (1 - 0.3 * u));
            return c;
          },
          seedPhase: sign * 2.1,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // C. Intricate 3D Trilobed Labellum (Lip) at 6 o'clock (`az = PI`):
    //    - 2 Upturned Tiger-Spotted Lateral Side-Lobes cradling the Gynostemium Column
    //    - 1 Vivid Ruby-Magenta Hastate Mid-Lobe + 2 Curling 3D Apical Cirrhi Whiskers!
    for (const sign of [-1, 1]) {
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        oUp,
        oRight,
        {
          azimuthRad: Math.PI + sign * 0.52,
          rBase: R * 0.04,
          zBase: R * 0.04,
          length: R * 0.42,
          maxHalfWidth: R * 0.16,
          clawRatio: 0.14,
          polarStartRad: 56 * DEG2RAD,
          polarMidRad: 34 * DEG2RAD,
          curlDeltaRad: -38 * DEG2RAD, // Curves upward like twin protective wings around the column!
          rollRad: sign * 18 * DEG2RAD,
          cupRatio: 0.34,
          ruffleAmp: R * 0.008,
          ruffleFreq: 10.0,
          apicalNotch: 0.0,
          veinCount: 5,
          baseThickness: R * 0.008,
          whorl01: 0.8,
          hasPapillae: true, // Raised crimson-leopard spots inside the golden side-lobes!
          isRayFloret: false,
          planform: 'obovate',
          colorOverride: (u, _absS, veinRidge) => {
            const goldZone = 1 - smoothstep(0.15, 0.72, u);
            let c = mixRgb(this.colSecondary, this.colThroat, goldZone);
            c = mixRgb(c, this.colVein, veinRidge * 0.65);
            return c;
          },
          seedPhase: sign * 0.9,
        },
        16,
        12,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // Central Projecting Mid-Lobe of Labellum (`6 o'clock`)
    this.buildSculptedPetal(
      corollaMesh,
      origin,
      fAxis,
      oUp,
      oRight,
      {
        azimuthRad: Math.PI,
        rBase: R * 0.05,
        zBase: R * 0.03,
        length: R * 0.56,
        maxHalfWidth: R * 0.22,
        clawRatio: 0.22,
        polarStartRad: 42 * DEG2RAD,
        polarMidRad: 58 * DEG2RAD,
        curlDeltaRad: -16 * DEG2RAD,
        rollRad: 0,
        cupRatio: 0.24,
        ruffleAmp: R * 0.010,
        ruffleFreq: 12.0,
        apicalNotch: 0.0,
        veinCount: 7,
        baseThickness: R * 0.009,
        whorl01: 1.0,
        hasPapillae: false,
        isRayFloret: false,
        planform: 'acute_bract',
        colorOverride: (u, _absS, veinRidge) => {
          let c = mixRgb(this.colThroat, this.colSecondary, smoothstep(0.08, 0.42, u));
          c = mixRgb(c, this.colVein, smoothstep(0.35, 0.88, u) * 0.65 + veinRidge * 0.35);
          return c;
        },
        seedPhase: 3.14,
      },
      18,
      14,
      bloomPivot,
      phase,
    );
    this.stats.petals++;

    // Twin Curling 3D Apical Cirrhi (Orchid Lip Whisker Tendrils!) + Speckled Golden Callus + Ivory Gynostemium Column!
    const lipTipBase = add(addScaled(origin, fAxis, R * 0.34), scale(oUp, -R * 0.44));
    for (const sign of [-1, 1]) {
      const cPts: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        cPts.push(
          add(
            addScaled(lipTipBase, fAxis, R * 0.20 * Math.sin(u * Math.PI * 0.85)),
            add(
              scale(oRight, sign * R * (0.02 + 0.12 * Math.sin(u * Math.PI * 0.75))),
              scale(oUp, R * (-0.06 * u + 0.16 * u * u)),
            ),
          ),
        );
      }
      this.buildCurvedFilament(
        reproMesh,
        cPts,
        R * 0.0085,
        mixRgb(this.colSecondary, rgb(1, 0.95, 0.98), 0.45),
        bloomPivot,
        phase,
      );
      this.stats.stamensAndFlorets++;
    }

    // Raised Bilobed Golden Callus Pad in Lip Throat
    for (const sign of [-1, 1]) {
      const calPos = add(
        addScaled(origin, fAxis, R * 0.12),
        add(scale(oUp, -R * 0.085), scale(oRight, sign * R * 0.028)),
      );
      this.buildVelvetStigmaPad(reproMesh, calPos, fAxis, R * 0.042, this.colThroat, bloomPivot, phase);
      this.stats.stamensAndFlorets++;
    }

    // Fleshy Arching Ivory Gynostemium Column + Beaked Anther Cap at Center!
    const colNodes = buildPolylineNodes(
      [
        addScaled(origin, oUp, R * 0.02),
        add(addScaled(origin, fAxis, R * 0.11), scale(oUp, R * 0.035)),
        add(addScaled(origin, fAxis, R * 0.21), scale(oUp, R * 0.015)),
      ],
      oRight,
    ).nodes;
    this.buildSmoothOrganTube(
      reproMesh,
      colNodes,
      (u) => R * (0.048 + 0.012 * Math.sin(u * Math.PI)),
      () => this.colPollen,
      10,
      bloomPivot,
      phase,
      0.08 * p.windCompliance,
    );
    this.buildVelvetStigmaPad(
      reproMesh,
      add(addScaled(origin, fAxis, R * 0.22), scale(oUp, R * 0.01)),
      fAxis,
      R * 0.046,
      mixRgb(this.colPollen, this.colThroat, 0.25),
      bloomPivot,
      phase,
    );
    this.stats.stamensAndFlorets++;
  }

  // ---------------------------------------------------------------------------
  // 11. IMPERIAL PAGODA CROWN BELL (Fritillaria imperialis — Nodding Bell Chandelier)
  // ---------------------------------------------------------------------------
  private buildImperialCrownBellBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    const uSegs = tier === 1 ? 14 : tier === 2 ? 20 : tier === 3 ? 26 : 34;
    const vSegs = tier === 1 ? 10 : tier === 2 ? 12 : tier === 3 ? 16 : 22;

    // Seamless bronze-burgundy perianth shoulder dome bridging the green pedicel into the 6 bell tepals!
    this.buildVelvetStigmaPad(
      calyxMesh,
      addScaled(origin, fAxis, R * 0.02),
      scale(fAxis, -1),
      R * 0.16,
      mixRgb(this.colThroat, this.colPrimary, 0.45),
      bloomPivot,
      phase,
    );

    // A. 6 Deeply Cupped, Strongly Ribbed Campanulate Bell Tepals (3 outer + 3 inner interlocking lantern walls!)
    const nTepals = Math.max(6, Math.round(6 * p.petalCountScale));
    const bellLen = R * 1.18;
    for (let i = 0; i < nTepals; i++) {
      const isInner = i % 2 === 1;
      const az = (i / nTepals) * TAU;
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * (isInner ? 0.068 : 0.082),
          zBase: R * (isInner ? 0.008 : 0.0),
          length: bellLen,
          maxHalfWidth: R * (isInner ? 0.38 : 0.40),
          clawRatio: 0.12,
          // Rounded shoulder swelling out from pedicel, hanging down as a deep royal lantern, then flaring at rim!
          polarStartRad: 40 * DEG2RAD,
          polarMidRad: (19 * clamp(openness, 0.55, 1.25)) * DEG2RAD,
          curlDeltaRad: (18 + p.petalCurl * 14) * DEG2RAD,
          rollRad: (isInner ? 2.0 : -2.0) * DEG2RAD,
          cupRatio: 0.34,
          ruffleAmp: R * 0.012 * p.petalRuffle,
          ruffleFreq: 12.0,
          apicalNotch: 0.0,
          veinCount: 9,
          baseThickness: R * 0.010,
          whorl01: isInner ? 0.4 : 0.0,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'bell_tepal',
          colorOverride: (u, _absS, veinRidge, isAbax) => {
            let c = mixRgb(this.colPrimary, this.colSecondary, smoothstep(0.45, 0.98, u) * p.edgeBlend);
            const maroonShoulder = 1 - smoothstep(0.05, 0.28, u);
            c = mixRgb(c, this.colThroat, maroonShoulder * 0.85);
            c = mixRgb(c, this.colVein, veinRidge * 0.58 * p.veinContrast);
            return isAbax ? c : mixRgb(c, this.colSecondary, 0.25);
          },
          seedPhase: i * 0.9,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;

      // B. Iconic Glistening Spherical Mother-of-Pearl Nectary Droplet at the interior base of EVERY tepal!
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const pearlPos = add(addScaled(origin, fAxis, R * 0.14), scale(rad, R * 0.14));
      this.buildVelvetStigmaPad(
        reproMesh,
        pearlPos,
        scale(rad, -1),
        R * 0.044,
        rgb(1.0, 0.99, 0.96),
        bloomPivot,
        phase,
      );
      this.stats.stamensAndFlorets++;
    }

    // C. 6 Long Pendulous Cream Filaments + Golden Anthers + Central 3-Cleft Style hanging out past the bell mouth!
    const nStam = Math.max(6, Math.round(6 * p.stamenLushness));
    for (let i = 0; i < nStam; i++) {
      const az = (i / nStam) * TAU + Math.PI / 6;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const sLen = bellLen * 1.08;
      const b0 = add(addScaled(origin, fAxis, R * 0.08), scale(rad, R * 0.06));
      const b1 = add(addScaled(origin, fAxis, sLen * 0.58), scale(rad, R * 0.14));
      const b2 = add(addScaled(origin, fAxis, sLen), scale(rad, R * 0.18));
      this.buildCurvedFilament(reproMesh, [b0, b1, b2], R * 0.0095, this.colPollen, bloomPivot, phase);
      this.build3DBilobedAnther(
        reproMesh,
        b2,
        fAxis,
        rad,
        R * 0.068,
        mixRgb(this.colPollen, this.colSecondary, 0.45),
        bloomPivot,
        phase,
        tier,
      );
      this.stats.stamensAndFlorets++;
    }

    // Longer Exserted Central Clapper Style + 3 Spreading Stigma Lobes!
    const clapperTip = addScaled(origin, fAxis, bellLen * 1.20);
    this.buildCurvedFilament(
      reproMesh,
      [origin, addScaled(origin, fAxis, bellLen * 0.6), clapperTip],
      R * 0.014,
      this.colPollen,
      bloomPivot,
      phase,
    );
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const rVec = add(scale(fRight, Math.cos(a)), scale(fFwd, Math.sin(a)));
      const stP = add(addScaled(clapperTip, fAxis, R * 0.03), scale(rVec, R * 0.032));
      this.buildVelvetStigmaPad(reproMesh, stP, fAxis, R * 0.022, this.colSecondary, bloomPivot, phase);
    }
    this.stats.stamensAndFlorets++;
  }

  // ---------------------------------------------------------------------------
  // 12. ROYAL CRANE FLOWER / BIRD-OF-PARADISE (Strelitzia reginae)
  // ---------------------------------------------------------------------------
  private buildBirdOfParadiseBloom(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    reproMesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    _fFwd: V3,
    R: number,
    openness: number,
    bloomPivot: V3,
    phase: number,
    tier: number,
  ): void {
    const p = this.p;
    // Construct crisp profile plane: `beakDir` points horizontally forward-right like a poised crane's head,
    // `crestUp` points skyward perpendicular to the beak!
    const horiz = length(v3(fRight.x, 0, fRight.z)) > 1e-3 ? normalize(v3(fRight.x, 0, fRight.z)) : v3(0.88, 0, 0.47);
    const beakDir = normalize(add(scale(horiz, 0.94), scale(UP, 0.22)));
    const crestUp = normalize(projectOnPlane(UP, beakDir));
    const beakSide = normalize(cross(crestUp, beakDir));
    const beakBase = addScaled(origin, beakDir, -R * 0.28);

    // A. Iconic Sculpted Boat-Keel Spathe ("Crane Beak", length `1.55 * R`) with Glowing Crimson Lip!
    const beakLen = R * 1.58;
    const uB = tier >= 3 ? 26 : 18;
    const vB = tier >= 3 ? 12 : 8;
    const nVB = vB + 1;
    const bOut: number[] = [];
    const bIn: number[] = [];

    for (let iu = 0; iu <= uB; iu++) {
      const u = iu / uB;
      const archY = R * 0.06 * Math.sin(u * Math.PI) - R * 0.08 * Math.pow(u, 2.2);
      const spineP = add(addScaled(beakBase, beakDir, beakLen * u), scale(crestUp, archY));
      const hProfile = R * 0.24 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.52)), 0.72);
      const wProfile = R * 0.11 * Math.sin(Math.PI * Math.pow(u, 0.56));

      for (let iv = 0; iv <= vB; iv++) {
        // `s` sweeps from `-1` (left upper lip) through `0` (bottom boat keel) to `+1` (right upper lip)!
        const s = (iv / vB) * 2 - 1;
        const absS = Math.abs(s);
        const yOff = hProfile * (absS * 0.55 - (1 - absS) * 0.65);
        const xOff = s * wProfile;
        const pt = add(addScaled(spineP, crestUp, yOff), scale(beakSide, xOff));
        const outN = normalize(add(scale(beakSide, s * 0.85), scale(crestUp, -0.55)));
        const pO = addScaled(pt, outN, R * 0.006);
        const pI = addScaled(pt, outN, -R * 0.004);

        // Glaucous jade-slate boat body melting into a vivid crimson-magenta glowing upper slit lip (`absS > 0.68`)!
        const lipGlow = smoothstep(0.62, 0.96, absS);
        const baseJade = mixRgb(this.colLeaf, rgb(0.14, 0.38, 0.34), 0.45);
        const col = mixRgb(baseJade, this.colThroat, lipGlow * 0.92);
        const w4: [number, number, number, number] = [
          0.7,
          this.activeBloomFlex + 0.006 * p.windCompliance * u * u,
          phase,
          0.0,
        ];
        bOut.push(
          calyxMesh.addVertex({
            x: pO.x, y: pO.y, z: pO.z,
            tx: beakDir.x, ty: beakDir.y, tz: beakDir.z,
            color: col, wind: w4, pivot: bloomPivot, roughness: 0.36, translucency: 0.22, detailMetric: 0.6 + 0.35 * lipGlow, anatomyLevel: 2,
          }),
        );
        bIn.push(
          calyxMesh.addVertex({
            x: pI.x, y: pI.y, z: pI.z,
            tx: beakDir.x, ty: beakDir.y, tz: beakDir.z,
            color: mulRgb(col, 0.72), wind: w4, pivot: bloomPivot, roughness: 0.48, translucency: 0.18, detailMetric: 0.5, anatomyLevel: 2,
          }),
        );
      }
    }
    for (let iu = 0; iu < uB; iu++) {
      for (let iv = 0; iv < vB; iv++) {
        const a = iu * nVB + iv, b = (iu + 1) * nVB + iv, c = (iu + 1) * nVB + iv + 1, d = iu * nVB + iv + 1;
        calyxMesh.addQuad(bOut[a], bOut[b], bOut[c], bOut[d]);
        calyxMesh.addQuad(bIn[a], bIn[d], bIn[c], bIn[b]);
      }
    }

    // B. Erupting Fan Crest of 5–7 Blazing Flame-Orange 3D Keeled Sepals!
    const nCrest = Math.max(4, Math.round(5 * p.petalCountScale));
    const uSegs = tier === 1 ? 14 : tier === 2 ? 18 : tier === 3 ? 24 : 30;
    const vSegs = tier === 1 ? 8 : tier === 2 ? 10 : tier === 3 ? 14 : 18;

    for (let i = 0; i < nCrest; i++) {
      const t = i / Math.max(1, nCrest - 1);
      const emergeSlot = addScaled(beakBase, beakDir, beakLen * lerp1(0.28, 0.56, t));
      // `fAxis = crestUp`, `fRight = beakDir`: `polar` angles forward from `crestUp` (`16° .. 64°`)!
      const fanPolar = lerp1(14, 62 * openness, t);
      const fanSideCant = ((i % 2 === 0 ? 1 : -1) * (4 + i * 2.5)) * DEG2RAD;

      this.buildSculptedPetal(
        corollaMesh,
        emergeSlot,
        crestUp,
        beakDir,
        beakSide,
        {
          azimuthRad: fanSideCant,
          rBase: 0,
          zBase: R * 0.02,
          length: R * lerp1(1.16, 0.94, t),
          maxHalfWidth: R * 0.15,
          clawRatio: 0.14,
          polarStartRad: (fanPolar * 0.55) * DEG2RAD,
          polarMidRad: fanPolar * DEG2RAD,
          curlDeltaRad: (-8 + p.petalCurl * 12) * DEG2RAD,
          rollRad: fanSideCant * 0.6,
          cupRatio: -0.36, // Crisp sculptural longitudinal crane-plume keel!
          ruffleAmp: R * 0.006 * p.petalRuffle,
          ruffleFreq: 10.0,
          apicalNotch: 0.0,
          veinCount: 7,
          baseThickness: R * 0.0095,
          whorl01: t,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'acute_bract',
          colorOverride: (u, _absS, veinRidge) => {
            let c = mixRgb(this.colPrimary, this.colVein, smoothstep(0.55, 0.98, u) * p.edgeBlend);
            c = mixRgb(c, rgb(1.0, 0.92, 0.35), (1 - smoothstep(0.0, 0.22, u)) * 0.45);
            c = mixRgb(c, this.colVein, veinRidge * 0.28);
            return c;
          },
          seedPhase: i * 0.8,
        },
        uSegs,
        vSegs,
        bloomPivot,
        phase,
      );
      this.stats.petals++;
    }

    // C. 2 Electric Cobalt-Blue Fused Arrow-Shaped Hastate Nectar Tongues + Glistening White Stigma Tip!
    for (let ti = 0; ti < 2; ti++) {
      const emergeP = addScaled(beakBase, beakDir, beakLen * (0.44 + ti * 0.10));
      const tonguePitch = (58 + ti * 9) * DEG2RAD;
      const tongueLen = R * (0.98 - ti * 0.12);

      this.buildSculptedPetal(
        reproMesh,
        emergeP,
        crestUp,
        beakDir,
        beakSide,
        {
          azimuthRad: (ti === 0 ? 2 : -2) * DEG2RAD,
          rBase: 0,
          zBase: R * 0.015,
          length: tongueLen,
          maxHalfWidth: R * 0.13,
          clawRatio: 0.28,
          polarStartRad: tonguePitch * 0.85,
          polarMidRad: tonguePitch,
          curlDeltaRad: 6 * DEG2RAD,
          rollRad: 0,
          cupRatio: 0.38, // Central pollen-enclosing nectar channel!
          ruffleAmp: 0,
          ruffleFreq: 8.0,
          apicalNotch: 0.0,
          veinCount: 5,
          baseThickness: R * 0.0085,
          whorl01: 0,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'acute_bract',
          // `colSecondary` = Electric Cobalt-Sapphire `#0b3dff`!
          colorOverride: (u) =>
            u > 0.88
              ? mixRgb(this.colSecondary, this.colPollen, smoothstep(0.88, 0.99, u))
              : this.colSecondary,
          seedPhase: ti * 1.5,
        },
        20,
        12,
        bloomPivot,
        phase,
      );
      this.stats.stamensAndFlorets++;

      // Glistening Ivory-White Exserted Stigma Tip jutting out of the primary arrow tongue!
      if (ti === 0) {
        const tDir = add(scale(crestUp, Math.cos(tonguePitch)), scale(beakDir, Math.sin(tonguePitch)));
        const stBase = addScaled(emergeP, tDir, tongueLen * 0.92);
        const stTip = addScaled(emergeP, tDir, tongueLen * 1.12);
        this.buildCurvedFilament(
          reproMesh,
          [stBase, lerp(stBase, stTip, 0.5), stTip],
          R * 0.011,
          this.colPollen,
          bloomPivot,
          phase,
        );
        this.stats.stamensAndFlorets++;
      }
    }
    void fAxis;
  }

  // ===========================================================================
  // Master Double-Sided 3D Sculpted Petal Surface Builder
  // ===========================================================================

  private buildSculptedPetal(
    mesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    spec: PetalSpec,
    uSegs: number,
    vSegs: number,
    bloomPivot: V3,
    bloomPhase: number,
  ): void {
    const p = this.p;
    const radDir = add(scale(fRight, Math.cos(spec.azimuthRad)), scale(fFwd, Math.sin(spec.azimuthRad)));
    const tanAz = add(scale(fRight, -Math.sin(spec.azimuthRad)), scale(fFwd, Math.cos(spec.azimuthRad)));

    // 1. Integrate smooth petal centerline spine & orthonormal right-handed frames `(T_s, W_s, N_adax)`
    const spinePos: V3[] = [];
    const spineTan: V3[] = [];
    const spineWid: V3[] = [];
    const spineNrm: V3[] = [];

    let curP = add(addScaled(origin, radDir, spec.rBase), scale(fAxis, spec.zBase));
    const du = 1 / uSegs;
    const cosRoll = Math.cos(spec.rollRad);
    const sinRoll = Math.sin(spec.rollRad);

    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const polar =
        lerp1(spec.polarStartRad, spec.polarMidRad, smoothstep(0.0, 0.58, u)) +
        spec.curlDeltaRad * Math.pow(u, 1.85);
      const cp = Math.cos(polar);
      const sp = Math.sin(polar);

      const T = add(scale(fAxis, cp), scale(radDir, sp));
      // Exact analytical identity: `T × tanAz = sin(polar)*fAxis - cos(polar)*radDir`!
      const N0 = add(scale(fAxis, sp), scale(radDir, -cp));
      const W = add(scale(tanAz, cosRoll), scale(N0, sinRoll));
      const N = add(scale(tanAz, -sinRoll), scale(N0, cosRoll));

      spinePos.push(curP);
      spineTan.push(T);
      spineWid.push(W);
      spineNrm.push(N);

      if (iu < uSegs) {
        curP = addScaled(curP, T, spec.length * du);
      }
    }

    const nU = uSegs + 1;
    const nV = vSegs + 1;
    const adaxIdx = new Int32Array(nU * nV);
    const abaxIdx = new Int32Array(nU * nV);

    const veinDepthScale = clamp(p.veinRelief, 0, 1.6);
    const nHalfVeins = Math.max(2, Math.floor(spec.veinCount / 2));

    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const P0 = spinePos[iu];
      const T = spineTan[iu];
      const W = spineWid[iu];
      const N = spineNrm[iu];

      // Species-authentic planform half-width envelope (`isObovateFan` keeps a wide semicircular
      // distal fan at `u = 1` instead of pinching to a point — zero pleats or jagged teeth!)
      const plan =
        spec.planform ??
        (spec.isRayFloret
          ? 'pointed_boat'
          : p.species === 'oriental_lily' || p.species === 'sacred_lotus'
            ? 'pointed_boat'
            : 'obovate');
      const isObovateFan = plan === 'obovate' && p.species !== 'passion_orchid';

      let env = 0;
      if (spec.isRayFloret) {
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.68)), 0.62) * (0.22 + 0.78 * smoothstep(0, 0.14, u));
      } else if (plan === 'acute_bract') {
        // Crisp pointed diamond-lanceolate bract / crane plume (`King Protea`, `Bird of Paradise`)
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.48)), 0.80) * (0.34 + 0.66 * smoothstep(0, spec.clawRatio, u));
      } else if (plan === 'involute_quill') {
        // Rolled tubular Dahlia scoop-floret — plump rounded-pointed spoon!
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.56)), 0.52) * (0.30 + 0.70 * smoothstep(0, 0.14, u));
      } else if (plan === 'orchid_wing') {
        // Narrow claw exploding into a huge rounded-rhomboid Phalaenopsis moth wing!
        const claw = 0.14 + 0.86 * smoothstep(0.02, 0.24, u);
        env = claw * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.60)), 0.46);
      } else if (plan === 'bell_tepal') {
        // Overlapping campanulate lantern wall (`Imperial Crown Bell`)
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.52)), 0.48) * (0.42 + 0.58 * smoothstep(0, 0.18, u));
      } else if (p.species === 'oriental_lily') {
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.58)), 0.86) * (0.24 + 0.76 * smoothstep(0, spec.clawRatio, u));
      } else if (p.species === 'sacred_lotus') {
        // Plump sacred boat spoon — broad upper belly tapering cleanly to a soft mucronate tip!
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.54)), 0.70) * (0.28 + 0.72 * smoothstep(0, spec.clawRatio, u));
      } else if (plan === 'pointed_boat') {
        // Smooth ovate-elliptic pointed sepal / bud petal (`Phalaenopsis Orchid`, `Bearded Iris` style arms, floral buds)
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.54)), 0.66) * (0.28 + 0.72 * smoothstep(0, spec.clawRatio, u));
      } else if (p.species === 'passion_orchid') {
        // Smooth rounded-oblong star tepal
        env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.56)), 0.58) * (0.38 + 0.62 * smoothstep(0, 0.12, u));
      } else {
        // Broad obovate silk fan (`Hibiscus`, `Tree Peony`, `Bearded Iris`) — stays plushly wide at `u = 1`
        // while `arcDrop` curves the outer margin into a smooth semicircular scalloped arc!
        const clawRamp = 0.16 + 0.84 * smoothstep(0.0, spec.clawRatio + 0.24, u);
        env = clawRamp * (1.0 - 0.14 * Math.pow(u, 3.0));
      }
      const halfW = Math.max(spec.maxHalfWidth * 0.03 * (1 - u * 0.85), spec.maxHalfWidth * env);

      // Continuous whole-plant wind: at `u = 0` (claw attachment to receptacle / sunflower disc),
      // `windFlex === this.activeBloomFlex` and `flutter === 0` with identical `bloomPivot` (`rootPivot`)
      // and `bloomPhase` (`plantPhase`), so petals NEVER detach from the seed disc or stem!
      const isWaxyStiffPerianth =
        p.species === 'king_protea' ||
        p.species === 'phalaenopsis_orchid' ||
        p.species === 'bird_of_paradise' ||
        p.species === 'imperial_crown_bell' ||
        p.species === 'sacred_lotus';
      const windFlex = this.activeBloomFlex + 0.026 * p.windCompliance * Math.pow(u, 1.85);
      const baseFlutter = (isWaxyStiffPerianth ? 0.0 : 0.012) * p.windCompliance * Math.pow(u, 1.85);

      for (let iv = 0; iv <= vSegs; iv++) {
        const s = (iv / vSegs) * 2 - 1; // [-1 .. +1]
        const absS = Math.abs(s);
        const pWind: [number, number, number, number] = [
          clamp(0.55 + 0.45 * u, 0, 1),
          windFlex,
          bloomPhase,
          baseFlutter * absS,
        ];

        // Smooth semicircular obovate tip arc + gentle organic silk scallops (`Peony` / `Hibiscus`)
        let uRetract = 0;
        if (isObovateFan && p.species !== 'passion_orchid') {
          const arcDrop = (1 - Math.sqrt(Math.max(0.04, 1 - s * s * 0.92))) * 0.24 * smoothstep(0.52, 1.0, u);
          const notchWave =
            spec.apicalNotch *
            smoothstep(0.68, 1.0, u) *
            (0.55 * Math.exp(-(s * s) / 0.09) + 0.35 * (0.5 - 0.5 * Math.cos(s * Math.PI * 2.5 + spec.seedPhase)));
          uRetract = spec.length * (arcDrop + notchWave);
        } else if (spec.apicalNotch > 0.002 && u > 0.76) {
          const tipProx = smoothstep(0.76, 1.0, u);
          uRetract = spec.length * spec.apicalNotch * tipProx * Math.exp(-(s * s) / 0.08);
        }

        // 3D Radiating Branching Venation + Satin Plisse Bullation
        let minVeinDist = 9.0;
        for (let vk = -nHalfVeins; vk <= nHalfVeins; vk++) {
          const vS = (vk / nHalfVeins) * (0.16 + 0.82 * Math.pow(u, 0.38));
          const d = Math.abs(s - vS);
          if (d < minVeinDist) minVeinDist = d;
          if (u > 0.36 && vk !== 0) {
            const forkOff = Math.sign(vk) * 0.085 * smoothstep(0.36, 0.92, u);
            const df = Math.abs(s - (vS + forkOff));
            if (df < minVeinDist) minVeinDist = df;
          }
        }
        const veinW = 0.046;
        const veinRidge = Math.exp(-(minVeinDist * minVeinDist) / (veinW * veinW)) * (1 - 0.28 * u);
        const plisse = Math.sin(s * Math.PI * spec.veinCount) * (1 - absS * 0.30) * smoothstep(0.06, 0.92, u);

        // Sunflower ray floret signature twin longitudinal plication grooves!
        let rayGroove = 0;
        if (spec.isRayFloret) {
          const g1 = Math.exp(-((absS - 0.38) ** 2) / 0.012);
          rayGroove = -spec.maxHalfWidth * 0.16 * g1 * Math.sin(Math.PI * u);
        }

        // Oriental Stargazer Lily raised 3D fleshy nectariferous throat papilla droplets!
        let papillaH = 0;
        let papillaSpot = 0;
        if (spec.hasPapillae && u > 0.14 && u < 0.66 && absS < 0.62 && absS > 0.05) {
          const pEnv = Math.sin(Math.PI * ((u - 0.14) / 0.52)) * (1 - Math.pow(absS / 0.62, 2.2));
          const warp = fbm3(u * 14.0, s * 9.0, spec.seedPhase, this.seed, 2) * 2.2;
          const grid =
            (0.5 + 0.5 * Math.cos(u * 78.0 + warp + spec.seedPhase)) *
            (0.5 + 0.5 * Math.cos(s * 34.0 - warp * 0.8));
          const bump = smoothstep(0.68, 0.90, grid);
          papillaSpot = bump * (0.45 + 0.55 * pEnv);
          papillaH = spec.baseThickness * 3.2 * papillaSpot;
        }

        // Transverse boat/spoon cupping OR true 3D cylindrical involute quill scroll (`Honeycomb Dahlia`)!
        let latOffsetW = s * halfW;
        let cupZ =
          spec.maxHalfWidth *
          spec.cupRatio *
          (1 - Math.cos(s * Math.PI * 0.5)) *
          Math.sin(Math.PI * Math.pow(u, 0.72));
        if (plan === 'involute_quill') {
          const rollMax = clamp(spec.cupRatio * 2.15, 0.35, 2.25) * Math.sin(Math.PI * Math.pow(u, 0.62));
          if (rollMax > 0.05) {
            latOffsetW = halfW * (Math.sin(s * rollMax) / rollMax);
            cupZ = halfW * ((1 - Math.cos(s * rollMax)) / rollMax) * 0.92;
          }
        }

        const edgeMask = Math.pow(absS, 2.0) * smoothstep(0.14, 0.56, u);
        const ruffleZ =
          spec.ruffleAmp *
          edgeMask *
          (Math.sin(u * spec.ruffleFreq + s * 2.2 + spec.seedPhase) +
            0.38 * Math.sin(u * spec.ruffleFreq * 1.75 - s * 3.4 + spec.seedPhase * 1.7));

        const bullationZ = spec.baseThickness * 0.85 * veinDepthScale * plisse;

        // Physical 3D mesophyll half-thickness tapering smoothly to a crisp silky margin!
        const marginTaper = Math.sqrt(Math.max(0.02, 1 - absS * absS * 0.96)) * (1 - 0.76 * Math.pow(u, 1.6));
        const halfThick = Math.max(0.00018, spec.baseThickness * 0.5 * marginTaper);

        const zCenter = cupZ + ruffleZ + bullationZ + rayGroove;
        const zAdax = zCenter + halfThick - halfThick * 0.55 * veinDepthScale * veinRidge + papillaH;
        const zAbax = zCenter - halfThick - spec.baseThickness * 1.05 * veinDepthScale * veinRidge;

        const basePt = add(addScaled(P0, T, -uRetract), scale(W, latOffsetW));
        const pAdax = addScaled(basePt, N, zAdax);
        const pAbax = addScaled(basePt, N, zAbax);

        // Vibrant Multi-Zone Floral Pigmentation!
        const adaxCol = spec.colorOverride
          ? spec.colorOverride(u, absS, veinRidge, false)
          : this.evalPetalPigment(u, absS, veinRidge, papillaSpot, spec.whorl01, false);
        const abaxCol = spec.colorOverride
          ? spec.colorOverride(u, absS, veinRidge, true)
          : this.evalPetalPigment(u, absS, veinRidge, 0, spec.whorl01, true);

        // Attenuate translucency inside thick fleshy nectar throat so dark velvet eyes stay deep & rich!
        const throatMask = smoothstep(p.throatSize * 0.4, p.throatSize * 1.3 + 0.08, u);
        const translucency = clamp((0.60 - 0.36 * veinRidge) * (0.12 + 0.88 * throatMask) * (0.45 + 0.55 * u), 0.04, 0.74);
        const detailVal = clamp(0.28 + 0.58 * veinRidge + 0.35 * papillaSpot, 0.05, 1.0);

        const k = iu * nV + iv;
        adaxIdx[k] = mesh.addVertex({
          x: pAdax.x,
          y: pAdax.y,
          z: pAdax.z,
          tx: T.x,
          ty: T.y,
          tz: T.z,
          u,
          v: iv / vSegs,
          color: adaxCol,
          wind: pWind,
          pivot: bloomPivot,
          roughness: 0.44 - 0.08 * veinRidge,
          translucency,
          detailMetric: detailVal,
          anatomyLevel: 3,
        });

        abaxIdx[k] = mesh.addVertex({
          x: pAbax.x,
          y: pAbax.y,
          z: pAbax.z,
          tx: T.x,
          ty: T.y,
          tz: T.z,
          u,
          v: iv / vSegs,
          color: abaxCol,
          wind: pWind,
          pivot: bloomPivot,
          roughness: 0.52,
          translucency: translucency * 0.92,
          detailMetric: detailVal,
          anatomyLevel: 3,
        });
      }
    }

    // Emit outward-facing quads on both Adaxial (+N) and Abaxial (-N) petal epidermises
    for (let iu = 0; iu < uSegs; iu++) {
      for (let iv = 0; iv < vSegs; iv++) {
        const a = iu * nV + iv;
        const b = (iu + 1) * nV + iv;
        const c = (iu + 1) * nV + (iv + 1);
        const d = iu * nV + (iv + 1);
        mesh.addQuad(adaxIdx[a], adaxIdx[b], adaxIdx[c], adaxIdx[d]);
        mesh.addQuad(abaxIdx[a], abaxIdx[d], abaxIdx[c], abaxIdx[b]);
      }
    }

    // Stitch the delicate outer petal rim (`iv = 0`, `iv = vSegs`, and `iu = uSegs`) into a solid 3D petal volume!
    for (let iu = 0; iu < uSegs; iu++) {
      const l0 = iu * nV;
      const l1 = (iu + 1) * nV;
      mesh.addQuad(adaxIdx[l1], adaxIdx[l0], abaxIdx[l0], abaxIdx[l1]);

      const r0 = iu * nV + vSegs;
      const r1 = (iu + 1) * nV + vSegs;
      mesh.addQuad(adaxIdx[r0], adaxIdx[r1], abaxIdx[r1], abaxIdx[r0]);
    }
    for (let iv = 0; iv < vSegs; iv++) {
      const t0 = uSegs * nV + iv;
      const t1 = uSegs * nV + iv + 1;
      mesh.addQuad(adaxIdx[t1], adaxIdx[t0], abaxIdx[t0], abaxIdx[t1]);
    }
    void bloomPivot;
  }

  private evalPetalPigment(
    u: number,
    absS: number,
    veinRidge: number,
    papillaSpot: number,
    whorl01: number,
    isAbaxial: boolean,
  ): RGB {
    const p = this.p;
    let col = this.colPrimary;

    // 1. Margin / Tip / Picotee Secondary Blend
    if (p.species === 'oriental_lily') {
      // Crisp radiant picotee border + pale star halo!
      const picotee = smoothstep(0.64, 0.92, absS) * p.edgeBlend;
      const tipGlow = smoothstep(0.78, 0.99, u) * p.edgeBlend * 0.75;
      col = mixRgb(col, this.colSecondary, clamp(picotee + tipGlow, 0, 1));
    } else if (p.species === 'sacred_lotus') {
      // Soft cream-rose center sweeping into luminous glowing ruby-magenta tips!
      const innerSoft = mixRgb(this.colSecondary, rgb(1.0, 0.93, 0.88), 0.55);
      col = mixRgb(innerSoft, this.colPrimary, smoothstep(0.18, 0.70, u));
      col = mixRgb(col, this.colSecondary, smoothstep(0.66, 0.98, u) * p.edgeBlend);
    } else {
      const rim = smoothstep(0.32, 0.96, u * 0.68 + absS * 0.42) * p.edgeBlend;
      col = mixRgb(col, this.colSecondary, rim);
    }

    // Subtle tonal depth across inner vs outer double-peony / lotus whorls
    if (whorl01 > 0.01) {
      col = mixRgb(col, this.colSecondary, whorl01 * 0.22 * p.edgeBlend);
    }

    // 2. Deep Velvet Nectar-Eye Throat (`hueThroat`) with feathered vein fingers & rich corolla self-occlusion!
    if (p.throatSize > 0.01) {
      const veinStretch = u - veinRidge * p.throatSize * 0.34;
      const eyeMask = 1 - smoothstep(p.throatSize * 0.36, p.throatSize * 1.22 + 0.03, veinStretch);
      const deepThroatCol =
        p.species === 'oriental_lily' || p.species === 'sacred_lotus'
          ? this.colThroat
          : mulRgb(this.colThroat, 0.58 + 0.42 * smoothstep(0.0, p.throatSize, u));
      col = mixRgb(col, deepThroatCol, clamp(eyeMask, 0, 1));
    }

    // 3. Embossed 3D Vein Nectar-Guide Striations (`hueVein`)
    if (p.veinContrast > 0.01 && veinRidge > 0.02) {
      const vWeight = veinRidge * p.veinContrast * (0.92 - 0.32 * u);
      col = mixRgb(col, this.colVein, clamp(vWeight, 0, 0.88));
    }

    // 4. Raised 3D Stargazer Lily Nectariferous Papilla Spots!
    if (papillaSpot > 0.08) {
      col = mixRgb(col, mulRgb(this.colVein, 0.55), clamp(papillaSpot * 1.75, 0, 0.96));
    }

    // 5. Silky Pearlescent Abaxial Underside
    if (isAbaxial) {
      col = mixRgb(col, mixRgb(this.colSecondary, rgb(0.95, 0.94, 0.92), 0.35), 0.22);
    }

    return col;
  }

  // ===========================================================================
  // Calyx Sepals, Unopened Sculpted Floral Buds & 3D Reproductive Organs
  // ===========================================================================

  private buildCalyxSepal(
    mesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    az: number,
    rBase: number,
    zBase: number,
    len: number,
    halfW: number,
    polarRad: number,
    curlRad: number,
    pivot: V3,
    phase: number,
    tier: number,
  ): void {
    const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
    const tan = add(scale(fRight, -Math.sin(az)), scale(fFwd, Math.cos(az)));
    const uSegs = tier >= 3 ? 10 : 7;
    const vSegs = 6;
    const nV = vSegs + 1;
    const topIdx: number[] = [];
    const botIdx: number[] = [];

    let cur = add(addScaled(origin, rad, rBase), scale(fAxis, zBase));
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const pol = polarRad + curlRad * u * u;
      const T = add(scale(fAxis, Math.cos(pol)), scale(rad, Math.sin(pol)));
      const N = add(scale(fAxis, Math.sin(pol)), scale(rad, -Math.cos(pol)));
      const wEnv = Math.sin(Math.PI * Math.pow(u, 0.58)) * (1 - 0.18 * u);
      const hw = Math.max(halfW * 0.05 * (1 - u), halfW * wEnv);
      const thick = Math.max(0.0003, len * 0.022 * (1 - 0.75 * u));
      const c = mixRgb(this.colStem, this.colSepal, 0.35 + 0.65 * u);

      for (let iv = 0; iv <= vSegs; iv++) {
        const s = (iv / vSegs) * 2 - 1;
        const cup = hw * 0.22 * (1 - Math.cos(s * Math.PI * 0.5));
        const base = add(cur, scale(tan, s * hw));
        const pTop = addScaled(base, N, cup + thick);
        const pBot = addScaled(base, N, cup - thick);
        const w4: [number, number, number, number] = [
          0.5,
          this.activeBloomFlex + 0.005 * this.p.windCompliance * u * u,
          phase,
          0.015 * u * this.p.windCompliance,
        ];
        topIdx.push(
          mesh.addVertex({
            x: pTop.x, y: pTop.y, z: pTop.z,
            tx: T.x, ty: T.y, tz: T.z,
            color: c, wind: w4, pivot, roughness: 0.52, translucency: 0.28, detailMetric: 0.4, anatomyLevel: 2,
          }),
        );
        botIdx.push(
          mesh.addVertex({
            x: pBot.x, y: pBot.y, z: pBot.z,
            tx: T.x, ty: T.y, tz: T.z,
            color: mulRgb(c, 0.85), wind: w4, pivot, roughness: 0.58, translucency: 0.22, detailMetric: 0.4, anatomyLevel: 2,
          }),
        );
      }
      if (iu < uSegs) cur = addScaled(cur, T, len / uSegs);
    }
    for (let iu = 0; iu < uSegs; iu++) {
      for (let iv = 0; iv < vSegs; iv++) {
        const a = iu * nV + iv, b = (iu + 1) * nV + iv, c = (iu + 1) * nV + iv + 1, d = iu * nV + iv + 1;
        mesh.addQuad(topIdx[a], topIdx[b], topIdx[c], topIdx[d]);
        mesh.addQuad(botIdx[a], botIdx[d], botIdx[c], botIdx[b]);
      }
    }
  }

  private buildSculptedFloralBud(
    calyxMesh: PartMesh,
    corollaMesh: PartMesh,
    bm: BloomMount,
    tier: number,
  ): void {
    const tipNode = bm.stem.nodes[bm.stem.nodes.length - 1];
    const R = clamp(this.p.bloomDiameter * 0.28 * bm.scaleMul, 0.05, 0.45);
    const fAxis = tipNode.dir;
    const fRight = tipNode.right;
    const fFwd = normalize(cross(fAxis, fRight));
    const origin = addScaled(tipNode.pos, fAxis, -R * 0.05);
    const pivot = this.rootPivot;
    const phase = this.plantPhase;
    const uSegs = tier >= 3 ? 14 : 10;
    const vSegs = tier >= 3 ? 10 : 6;

    if (this.p.species === 'phalaenopsis_orchid') {
      // Smooth, plump, glossy 3-valvate rounded-obovoid Phalaenopsis bud!
      const nLat = tier >= 3 ? 10 : 7;
      const nLon = tier >= 3 ? 18 : 12;
      const budLen = R * 1.45;
      const budRad = R * 0.62;
      const w4: [number, number, number, number] = [0.78, this.activeBloomFlex, phase, 0.0];
      const rings: number[][] = [];
      for (let i = 0; i <= nLat; i++) {
        const u = i / nLat;
        // Rounded obovoid profile: narrow pedicel neck -> plump rounded-triangular pearl orb!
        const rBase = Math.max(R * 0.03, budRad * Math.sin(Math.PI * Math.pow(u, 0.64)));
        const z = budLen * u;
        const baseFlush = mixRgb(this.colSepal, this.colPrimary, smoothstep(0.0, 0.42, u));
        const col = mixRgb(baseFlush, this.colSecondary, smoothstep(0.35, 0.92, u) * 0.35);
        const ring: number[] = [];
        for (let j = 0; j < nLon; j++) {
          const th = (j / nLon) * TAU;
          // Subtle 3-lobed orchid sepal valvate seam ribs!
          const triLobe = 1 + 0.07 * Math.cos(th * 3) * Math.sin(u * Math.PI);
          const rr = rBase * triLobe;
          const pt = add(
            addScaled(origin, fAxis, z),
            add(scale(fRight, Math.cos(th) * rr), scale(fFwd, Math.sin(th) * rr)),
          );
          ring.push(
            corollaMesh.addVertex({
              x: pt.x, y: pt.y, z: pt.z,
              tx: fAxis.x, ty: fAxis.y, tz: fAxis.z,
              color: col, wind: w4, pivot, roughness: 0.26, translucency: 0.42, detailMetric: 0.55, anatomyLevel: 3,
            }),
          );
        }
        rings.push(ring);
      }
      for (let i = 0; i < nLat; i++) {
        for (let j = 0; j < nLon; j++) {
          const jn = (j + 1) % nLon;
          corollaMesh.addQuad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]);
        }
      }
      this.stats.petals += 3;
      return;
    }

    if (this.p.species === 'bird_of_paradise') {
      // Unopened Strelitzia bud: sleek angled jade-and-crimson closed beak spathe + 1 peeping flame-orange spear tip!
      const horiz = length(v3(fRight.x, 0, fRight.z)) > 1e-3 ? normalize(v3(fRight.x, 0, fRight.z)) : v3(0.88, 0, 0.47);
      const beakDir = normalize(add(scale(horiz, 0.72), scale(UP, 0.69)));
      const crestUp = normalize(projectOnPlane(UP, beakDir));
      const beakSide = normalize(cross(crestUp, beakDir));
      const baseJade = mixRgb(this.colLeaf, rgb(0.14, 0.38, 0.34), 0.45);

      for (const side of [-1, 1]) {
        this.buildSculptedPetal(
          calyxMesh,
          origin,
          beakDir,
          crestUp,
          beakSide,
          {
            azimuthRad: side * 0.5 * Math.PI,
            rBase: R * 0.04,
            zBase: -R * 0.10,
            length: R * 2.15,
            maxHalfWidth: R * 0.26,
            clawRatio: 0.10,
            polarStartRad: 12 * DEG2RAD,
            polarMidRad: 6 * DEG2RAD,
            curlDeltaRad: -10 * DEG2RAD,
            rollRad: 0,
            cupRatio: 0.52,
            ruffleAmp: 0,
            ruffleFreq: 8,
            apicalNotch: 0,
            veinCount: 5,
            baseThickness: R * 0.012,
            whorl01: 0,
            hasPapillae: false,
            isRayFloret: false,
            planform: 'acute_bract',
            colorOverride: (_u, absS) => mixRgb(baseJade, this.colThroat, smoothstep(0.62, 0.96, absS) * 0.92),
            seedPhase: side,
          },
          uSegs,
          vSegs,
          pivot,
          phase,
        );
      }
      // Single emerging flame-orange crest spear tip peeking out of the upper beak slit!
      this.buildSculptedPetal(
        corollaMesh,
        addScaled(origin, beakDir, R * 0.55),
        beakDir,
        crestUp,
        beakSide,
        {
          azimuthRad: 0,
          rBase: 0,
          zBase: 0,
          length: R * 1.45,
          maxHalfWidth: R * 0.16,
          clawRatio: 0.12,
          polarStartRad: 16 * DEG2RAD,
          polarMidRad: 22 * DEG2RAD,
          curlDeltaRad: -8 * DEG2RAD,
          rollRad: 0,
          cupRatio: -0.32,
          ruffleAmp: 0,
          ruffleFreq: 8,
          apicalNotch: 0,
          veinCount: 5,
          baseThickness: R * 0.009,
          whorl01: 0,
          hasPapillae: false,
          isRayFloret: false,
          planform: 'acute_bract',
          colorOverride: (u) => mixRgb(this.colPrimary, this.colVein, smoothstep(0.5, 1.0, u)),
          seedPhase: 0.4,
        },
        uSegs,
        vSegs,
        pivot,
        phase,
      );
      this.stats.petals += 3;
      return;
    }

    if (this.p.species === 'king_protea') {
      // Conical artichoke bud of 9 overlapping frosted-margin crimson bracts!
      for (let i = 0; i < 6; i++) {
        this.buildCalyxSepal(
          calyxMesh, origin, fAxis, fRight, fFwd, (i / 6) * TAU,
          R * 0.24, 0, R * 0.62, R * 0.22,
          32 * DEG2RAD, -16 * DEG2RAD, pivot, phase, tier,
        );
      }
      for (let i = 0; i < 9; i++) {
        const az = i * GOLDEN_ANGLE;
        this.buildSculptedPetal(
          corollaMesh,
          origin,
          fAxis,
          fRight,
          fFwd,
          {
            azimuthRad: az,
            rBase: R * 0.20,
            zBase: R * 0.05 * (i / 9),
            length: R * 1.28,
            maxHalfWidth: R * 0.30,
            clawRatio: 0.10,
            polarStartRad: 24 * DEG2RAD,
            polarMidRad: 14 * DEG2RAD,
            curlDeltaRad: -22 * DEG2RAD,
            rollRad: 6 * DEG2RAD,
            cupRatio: 0.34,
            ruffleAmp: 0,
            ruffleFreq: 8,
            apicalNotch: 0,
            veinCount: 7,
            baseThickness: R * 0.014,
            whorl01: i / 9,
            hasPapillae: false,
            isRayFloret: false,
            planform: 'acute_bract',
            colorOverride: (u, absS) => {
              const body = mixRgb(this.colThroat, this.colPrimary, smoothstep(0.05, 0.45, u));
              return mixRgb(body, this.colSecondary, smoothstep(0.66, 0.98, absS) * 0.85);
            },
            seedPhase: i * 0.8,
          },
          uSegs,
          vSegs,
          pivot,
          phase,
        );
        this.stats.petals++;
      }
      return;
    }

    // Clasping Calyx Sepals (omitted on naked-perianth Crown Imperial buds)
    if (this.p.species !== 'imperial_crown_bell') {
      for (let i = 0; i < 4; i++) {
        const az = (i / 4) * TAU;
        this.buildCalyxSepal(
          calyxMesh, origin, fAxis, fRight, fFwd, az,
          R * 0.22, 0, R * 0.86, R * 0.26,
          24 * DEG2RAD, -22 * DEG2RAD, pivot, phase, tier,
        );
      }
    }

    // Tightly Spiraled / Convolute Vibrant Pointed Bud Petals!
    const nBudPetals = this.p.species === 'imperial_crown_bell' ? 6 : 5;
    for (let i = 0; i < nBudPetals; i++) {
      const az = (i / nBudPetals) * TAU + 0.35;
      this.buildSculptedPetal(
        corollaMesh,
        origin,
        fAxis,
        fRight,
        fFwd,
        {
          azimuthRad: az,
          rBase: R * 0.16,
          zBase: R * 0.06,
          length: R * 1.18,
          maxHalfWidth: R * 0.36,
          clawRatio: 0.12,
          polarStartRad: 26 * DEG2RAD,
          polarMidRad: 14 * DEG2RAD,
          curlDeltaRad: -28 * DEG2RAD, // Closes inward into a pointed spiraled tear-drop bud!
          rollRad: 16 * DEG2RAD,
          cupRatio: 0.42,
          ruffleAmp: R * 0.004,
          ruffleFreq: 10.0,
          apicalNotch: 0,
          veinCount: 7,
          baseThickness: R * 0.014,
          whorl01: 0.15,
          hasPapillae: false,
          isRayFloret: false,
          planform: this.p.species === 'imperial_crown_bell' ? 'bell_tepal' : 'pointed_boat',
          seedPhase: i * 1.1,
        },
        uSegs,
        vSegs,
        pivot,
        phase,
      );
      this.stats.petals++;
    }
  }

  private buildSmoothOrganTube(
    mesh: PartMesh,
    nodes: WeldedNode[],
    radiusFn: (u: number) => number,
    colorFn: (u: number) => RGB,
    radSegs: number,
    pivot: V3,
    phase: number,
    _flexScale: number,
  ): void {
    const rings: number[][] = [];
    for (let i = 0; i < nodes.length; i++) {
      const u = i / Math.max(1, nodes.length - 1);
      const nd = nodes[i];
      const perp = cross(nd.dir, nd.right);
      const r = Math.max(0.0005, radiusFn(u));
      const c = colorFn(u);
      const w4: [number, number, number, number] = [0.6 + 0.4 * u, this.activeBloomFlex, phase, 0.012 * u];
      const ring: number[] = [];
      for (let j = 0; j < radSegs; j++) {
        const th = (j / radSegs) * TAU;
        const off = add(scale(nd.right, Math.cos(th) * r), scale(perp, Math.sin(th) * r));
        const vp = add(nd.pos, off);
        ring.push(
          mesh.addVertex({
            x: vp.x, y: vp.y, z: vp.z,
            tx: nd.dir.x, ty: nd.dir.y, tz: nd.dir.z,
            color: c, wind: w4, pivot, roughness: 0.46, translucency: 0.34, detailMetric: 0.65, anatomyLevel: 4,
          }),
        );
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i], r1 = rings[i + 1];
      for (let j = 0; j < radSegs; j++) {
        const jn = (j + 1) % radSegs;
        mesh.addQuad(r0[j], r0[jn], r1[jn], r1[j]);
      }
    }
    const last = rings[rings.length - 1];
    const tipNd = nodes[nodes.length - 1];
    const tipCenter = mesh.addVertex({
      x: tipNd.pos.x, y: tipNd.pos.y, z: tipNd.pos.z,
      tx: tipNd.dir.x, ty: tipNd.dir.y, tz: tipNd.dir.z,
      color: colorFn(1), wind: [1, this.activeBloomFlex, phase, 0.012], pivot, roughness: 0.45, translucency: 0.3, detailMetric: 0.7, anatomyLevel: 4,
    });
    for (let j = 0; j < radSegs; j++) {
      mesh.addTri(last[j], last[(j + 1) % radSegs], tipCenter);
    }
  }

  private buildCurvedFilament(
    mesh: PartMesh,
    pts: V3[],
    baseR: number,
    col: RGB,
    pivot: V3,
    phase: number,
  ): void {
    const { nodes } = buildPolylineNodes(pts);
    this.buildSmoothOrganTube(
      mesh,
      nodes,
      (u) => baseR * lerp1(1.0, 0.36, u),
      (u) => mixRgb(col, this.colPollen, u * 0.25),
      5,
      pivot,
      phase,
      0.14 * this.p.windCompliance,
    );
  }

  private buildBandedCoronaFilament(
    mesh: PartMesh,
    pts: V3[],
    baseR: number,
    pivot: V3,
    phase: number,
  ): void {
    const { nodes } = buildPolylineNodes(pts);
    const snow: RGB = rgb(0.96, 0.96, 0.99);
    this.buildSmoothOrganTube(
      mesh,
      nodes,
      (u) => baseR * lerp1(1.0, 0.28, Math.pow(u, 0.85)),
      (u) => {
        // Signature Passiflora concentric banding: deep throat -> snow ring -> vivid vein/cobalt -> bright tips!
        if (u < 0.24) return this.colThroat;
        if (u < 0.42) return snow;
        if (u < 0.72) return this.colVein;
        return mixRgb(this.colSecondary, snow, smoothstep(0.75, 1.0, u) * 0.55);
      },
      5,
      pivot,
      phase,
      0.16 * this.p.windCompliance,
    );
  }

  /** Sculpted 3D Bilobed Anther (two parallel pollen thecae with a real longitudinal groove!). */
  private build3DBilobedAnther(
    mesh: PartMesh,
    center: V3,
    longAxis: V3,
    outDir: V3,
    len: number,
    pollenCol: RGB,
    pivot: V3,
    phase: number,
    tier: number,
  ): void {
    const L = normalize(longAxis);
    const U = normalize(projectOnPlane(outDir, L));
    const S = normalize(cross(L, U));
    const uSegs = tier >= 3 ? 6 : 4;
    const rSegs = tier >= 3 ? 8 : 6;
    const w4: [number, number, number, number] = [0.85, this.activeBloomFlex, phase, 0.012];

    const rings: number[][] = [];
    for (let i = 0; i <= uSegs; i++) {
      const u = i / uSegs;
      const z = (u - 0.5) * len;
      const env = Math.sin(Math.PI * clamp(u, 0.04, 0.96));
      const rx = len * 0.22 * env;
      const ry = len * 0.15 * env;
      const ring: number[] = [];
      for (let j = 0; j < rSegs; j++) {
        const th = (j / rSegs) * TAU;
        // Bilobed figure-8 cross-section (two distinct pollen sacs!)
        const bilobe = 1 - 0.34 * Math.pow(Math.sin(th), 4);
        const px = Math.cos(th) * rx;
        const py = Math.sin(th) * ry * bilobe;
        const pt = add(addScaled(center, L, z), add(scale(S, px), scale(U, py)));
        const col = mixRgb(mulRgb(pollenCol, 0.68), pollenCol, 0.4 + 0.6 * Math.abs(Math.cos(th)));
        ring.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: L.x, ty: L.y, tz: L.z,
            color: col, wind: w4, pivot, roughness: 0.68, translucency: 0.18, detailMetric: 0.85, anatomyLevel: 5,
          }),
        );
      }
      rings.push(ring);
    }
    for (let i = 0; i < uSegs; i++) {
      for (let j = 0; j < rSegs; j++) {
        const jn = (j + 1) % rSegs;
        mesh.addQuad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]);
      }
    }
  }

  private buildVelvetStigmaPad(
    mesh: PartMesh,
    center: V3,
    axis: V3,
    rad: number,
    col: RGB,
    pivot: V3,
    phase: number,
  ): void {
    const A = normalize(axis);
    const P1 = anyPerpendicular(A);
    const P2 = cross(A, P1);
    const rings: number[][] = [];
    const nLat = 4;
    const nLon = 8;
    const w4: [number, number, number, number] = [0.9, this.activeBloomFlex, phase, 0.01];

    for (let i = 0; i <= nLat; i++) {
      const v = i / nLat;
      const phi = (v - 0.35) * Math.PI * 0.72;
      const rRing = Math.max(rad * 0.06, Math.cos(phi) * rad);
      const y = Math.sin(phi) * rad * 0.78;
      const ring: number[] = [];
      for (let j = 0; j < nLon; j++) {
        const th = (j / nLon) * TAU;
        const pt = add(
          addScaled(center, A, y),
          add(scale(P1, Math.cos(th) * rRing), scale(P2, Math.sin(th) * rRing)),
        );
        ring.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: A.x, ty: A.y, tz: A.z,
            color: mixRgb(col, rgb(1, 0.85, 0.85), v * 0.18),
            wind: w4, pivot, roughness: 0.82, translucency: 0.22, detailMetric: 0.9, anatomyLevel: 5,
          }),
        );
      }
      rings.push(ring);
    }
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const jn = (j + 1) % nLon;
        mesh.addQuad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]);
      }
    }
  }

  /** Sacred Lotus flat-topped obconical golden seed-pod receptacle + sculpted carpellary pits! */
  private buildLotusSeedTorus(
    mesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    topR: number,
    height: number,
    pivot: V3,
    phase: number,
    tier: number,
  ): void {
    const nRad = tier >= 3 ? 24 : 16;
    const podGold = mixRgb(this.colPollen, rgb(0.58, 0.72, 0.14), 0.32);
    const w4: [number, number, number, number] = [0.75, this.activeBloomFlex, phase, 0.0];

    // Cone wall + beveled lip + flat top disc
    const prof = [
      { r: topR * 0.32, z: 0.0, c: this.colSepal },
      { r: topR * 0.78, z: height * 0.58, c: mixRgb(this.colSepal, podGold, 0.55) },
      { r: topR * 1.0, z: height * 0.94, c: podGold },
      { r: topR * 0.92, z: height, c: podGold },
      { r: topR * 0.04, z: height * 0.98, c: podGold },
    ];
    const rings: number[][] = [];
    for (const pr of prof) {
      const ring: number[] = [];
      for (let j = 0; j < nRad; j++) {
        const th = (j / nRad) * TAU;
        const rad = add(scale(fRight, Math.cos(th)), scale(fFwd, Math.sin(th)));
        const pt = add(addScaled(origin, fAxis, pr.z), scale(rad, pr.r));
        ring.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: fAxis.x, ty: fAxis.y, tz: fAxis.z,
            color: pr.c, wind: w4, pivot, roughness: 0.62, translucency: 0.24, detailMetric: 0.75, anatomyLevel: 4,
          }),
        );
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < nRad; j++) {
        const jn = (j + 1) % nRad;
        mesh.addQuad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]);
      }
    }

    // 20 Sunken Circular Carpellary Pits + Protruding Golden Styles on the Flat Torus Face!
    const nPits = 20;
    for (let i = 0; i < nPits; i++) {
      const rr = topR * 0.78 * Math.sqrt((i + 0.5) / nPits);
      const az = i * GOLDEN_ANGLE;
      const pCenter = add(
        addScaled(origin, fAxis, height * 1.005),
        add(scale(fRight, Math.cos(az) * rr), scale(fFwd, Math.sin(az) * rr)),
      );
      this.buildVelvetStigmaPad(
        mesh, pCenter, fAxis, topR * 0.075, mixRgb(this.colSepal, rgb(0.18, 0.34, 0.06), 0.5), pivot, phase,
      );
      this.stats.stamensAndFlorets++;
    }
  }

  /** Fibonacci Golden-Angle (`137.50776°`) Vogel Spiral Capitulum of 3D 5-Starred Tubular Disc Florets! */
  private buildFibonacciCapitulumDisc(
    mesh: PartMesh,
    origin: V3,
    fAxis: V3,
    fRight: V3,
    fFwd: V3,
    discR: number,
    domeH: number,
    pivot: V3,
    phase: number,
    tier: number,
  ): void {
    // 1. Underlying Fleshy Domed Receptacle Cushion
    const nRings = 6;
    const nSeg = 24;
    const w4: [number, number, number, number] = [0.72, this.activeBloomFlex, phase, 0.0];
    const dRings: number[][] = [];
    const baseDark = mulRgb(this.colPollen, 0.38);

    for (let i = 0; i <= nRings; i++) {
      const t = i / nRings;
      const r = Math.max(discR * 0.02, discR * (1 - t * 0.98));
      const z = domeH * 0.18 + domeH * Math.cos(Math.asin(clamp(1 - t, 0, 1)) * 0.85) * (0.25 + 0.75 * t);
      const ring: number[] = [];
      for (let j = 0; j < nSeg; j++) {
        const th = (j / nSeg) * TAU;
        const pt = add(
          addScaled(origin, fAxis, z),
          add(scale(fRight, Math.cos(th) * r), scale(fFwd, Math.sin(th) * r)),
        );
        ring.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: fAxis.x, ty: fAxis.y, tz: fAxis.z,
            color: baseDark, wind: w4, pivot, roughness: 0.85, translucency: 0.08, detailMetric: 0.5, anatomyLevel: 4,
          }),
        );
      }
      dRings.push(ring);
    }
    for (let i = 0; i < nRings; i++) {
      for (let j = 0; j < nSeg; j++) {
        const jn = (j + 1) % nSeg;
        mesh.addQuad(dRings[i][j], dRings[i][jn], dRings[i + 1][jn], dRings[i + 1][j]);
      }
    }
    // Seal central disc cushion apex (`r = 0`) so zero background or stalk ever shows through!
    const apexPt = addScaled(origin, fAxis, domeH * 1.18);
    const apexIdx = mesh.addVertex({
      x: apexPt.x, y: apexPt.y, z: apexPt.z,
      tx: fAxis.x, ty: fAxis.y, tz: fAxis.z,
      color: baseDark, wind: w4, pivot, roughness: 0.85, translucency: 0.08, detailMetric: 0.5, anatomyLevel: 4,
    });
    const innerRing = dRings[nRings];
    for (let j = 0; j < nSeg; j++) {
      mesh.addTri(innerRing[j], innerRing[(j + 1) % nSeg], apexIdx);
    }

    // 2. Individual 3D 5-Sided Tubular Disc Florets in Exact Parastichy Vogel Spirals!
    const nFlorets = Math.round(
      (tier === 1 ? 180 : tier === 2 ? 280 : tier === 3 ? 420 : 560) *
        clamp(this.p.stamenLushness, 0.45, 1.5),
    );
    const floretSpacing = discR / Math.sqrt(nFlorets);
    const budChartreuse: RGB = rgb(0.36, 0.52, 0.08);

    for (let i = 0; i < nFlorets; i++) {
      const rNorm = Math.sqrt((i + 0.5) / nFlorets); // 0 = center bud, 1 = outer open floret!
      const r = discR * 0.95 * rNorm;
      const az = i * GOLDEN_ANGLE;
      const rad = add(scale(fRight, Math.cos(az)), scale(fFwd, Math.sin(az)));
      const zSurf = domeH * 0.18 + domeH * (1 - rNorm * rNorm * 0.78);
      const basePos = add(addScaled(origin, fAxis, zSurf), scale(rad, r));
      const fDir = normalize(add(fAxis, scale(rad, 0.28 * rNorm)));
      const p1 = anyPerpendicular(fDir);
      const p2 = cross(fDir, p1);

      // Outer ring (`rNorm > 0.56`) is in active golden-pollen anthesis; inner core is tight spiral buds!
      const anthesis = smoothstep(0.48, 0.78, rNorm);
      const fH = floretSpacing * (1.35 + 1.15 * anthesis);
      const r0 = floretSpacing * 0.44;
      const rTop = floretSpacing * (0.38 + 0.34 * anthesis);

      const baseCol = mixRgb(baseDark, this.colPollen, 0.35);
      const tipCol = mixRgb(
        mixRgb(budChartreuse, this.colPollen, 0.45),
        mixRgb(this.colPrimary, this.colPollen, 0.42),
        anthesis,
      );

      const botRing: number[] = [];
      const topRing: number[] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + az;
        const dVec = add(scale(p1, Math.cos(a)), scale(p2, Math.sin(a)));
        const pb = add(basePos, scale(dVec, r0));
        const pt = add(addScaled(basePos, fDir, fH), scale(dVec, rTop));
        botRing.push(
          mesh.addVertex({
            x: pb.x, y: pb.y, z: pb.z,
            tx: fDir.x, ty: fDir.y, tz: fDir.z,
            color: baseCol, wind: w4, pivot, roughness: 0.76, translucency: 0.10, detailMetric: 0.4, anatomyLevel: 5,
          }),
        );
        topRing.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            tx: fDir.x, ty: fDir.y, tz: fDir.z,
            color: tipCol, wind: w4, pivot, roughness: 0.58, translucency: 0.26, detailMetric: 0.92, anatomyLevel: 5,
          }),
        );
      }
      const apexPt = addScaled(basePos, fDir, fH * (1.18 - 0.28 * anthesis));
      const vApex = mesh.addVertex({
        x: apexPt.x, y: apexPt.y, z: apexPt.z,
        tx: fDir.x, ty: fDir.y, tz: fDir.z,
        color: anthesis > 0.5 ? this.colPollen : budChartreuse,
        wind: w4, pivot, roughness: 0.62, translucency: 0.20, detailMetric: 0.95, anatomyLevel: 5,
      });

      for (let k = 0; k < 5; k++) {
        const kn = (k + 1) % 5;
        mesh.addQuad(botRing[k], botRing[kn], topRing[kn], topRing[k]);
        mesh.addTri(topRing[k], topRing[kn], vApex);
      }
      this.stats.stamensAndFlorets++;
    }
  }

  // ===========================================================================
  // 3D Veined Cauline Leaves & Sacred Lotus Peltate Umbrella Pads
  // ===========================================================================

  private buildCaulineLeafOnSpine(mesh: PartMesh, lm: LeafMount, tier: number): void {
    const nodes = lm.stem.nodes;
    const isOrchid = this.p.species === 'phalaenopsis_orchid';
    const isEntireSessile =
      isOrchid ||
      this.p.species === 'oriental_lily' ||
      this.p.species === 'bearded_iris' ||
      this.p.species === 'imperial_crown_bell' ||
      this.p.species === 'king_protea';
    const petioleFrac = isOrchid ? 0.03 : isEntireSessile ? 0.05 : 0.24;
    const startIdx = Math.min(nodes.length - 2, Math.max(1, Math.floor(nodes.length * petioleFrac)));
    const uSegs = nodes.length - 1 - startIdx;
    if (uSegs < 2) return;

    const vSegs = tier >= 3 ? 12 : 8; // [-1 .. +1] across midrib!
    const nV = vSegs + 1;
    const maxHW = lm.bladeWidth * 0.5;
    const pivot = this.rootPivot;
    const phase = this.plantPhase;
    const topIdx: number[] = [];
    const botIdx: number[] = [];

    // Anchor leaf-blade width frame once at `startIdx` and parallel-transport smoothly along `nd.right`
    // so upright sword/paddle leaves never suffer a `180°` `cross(UP, T)` gimbal flip when arching across `+Y`!
    const nd0 = nodes[startIdx];
    const T0 = nd0.dir;
    const B0 = normalize(cross(T0, nd0.right));
    let W0 = projectOnPlane(cross(UP, T0), T0);
    W0 = length(W0) > 1e-3 ? normalize(W0) : nd0.right;
    const cR = dot(W0, nd0.right);
    const cB = dot(W0, B0);

    for (let iu = 0; iu <= uSegs; iu++) {
      const idx = startIdx + iu;
      const nd = nodes[idx];
      const u = iu / uSegs;
      const uSpine = idx / Math.max(1, nodes.length - 1);
      const T = nd.dir;
      const B = normalize(cross(T, nd.right));
      const W = normalize(add(scale(nd.right, cR), scale(B, cB)));
      const N = normalize(cross(T, W));

      // Species leaf silhouette: broad rounded-obtuse fleshy strap leaf on Phalaenopsis, 3-lobed palmate on Passiflora,
      // cordate on Sunflower, serrated ovate on Hibiscus/Peony/Dahlia, entire sword/elliptic on Iris/Protea/Lily!
      let wEnv = isOrchid
        ? (0.44 + 0.56 * smoothstep(0.0, 0.16, u)) * Math.sqrt(Math.max(0.015, 1 - Math.pow(Math.max(0, (u - 0.58) / 0.42), 2.1)))
        : Math.sin(Math.PI * Math.pow(u, 0.58));
      if (this.p.species === 'titan_sunflower' && u < 0.25) {
        wEnv = Math.max(wEnv, smoothstep(0.0, 0.16, u) * 0.92);
      }
      const serrate =
        isEntireSessile || this.p.species === 'bird_of_paradise'
          ? 1.0
          : 1.0 + 0.065 * Math.sin(u * Math.PI * 18.0) * smoothstep(0.1, 0.9, u);
      const hw = Math.max(maxHW * 0.02 * (1 - u), maxHW * wEnv * serrate);
      const spineFlex = lm.baseFlex + lm.extraFlex * Math.pow(uSpine, 1.35);

      for (let iv = 0; iv <= vSegs; iv++) {
        const s = (iv / vSegs) * 2 - 1;
        const absS = Math.abs(s);

        let lobeScale = 1.0;
        if (this.p.species === 'passion_orchid') {
          const cleft = Math.exp(-((u - 0.46) ** 2) / 0.028) * smoothstep(0.35, 0.95, absS);
          lobeScale = 1 - 0.46 * cleft;
        }

        // 3D pinnate lateral veins (or smooth succulent parallel-keeled lamina on Phalaenopsis!)
        const veinCoord = (u - absS * 0.34) * 9.0;
        const latVein = isOrchid
          ? Math.pow(Math.max(0, Math.cos(absS * Math.PI * 4.0)), 6) * 0.35
          : Math.pow(Math.max(0, Math.cos(veinCoord * Math.PI)), 8) * (1 - absS * 0.3);
        const bullation = isOrchid
          ? 0
          : Math.sin(veinCoord * Math.PI) * hw * 0.045 * absS * (1 - absS * 0.5);
        const vFold = isOrchid ? hw * 0.09 * absS * absS : hw * 0.14 * absS;
        const thick = isOrchid
          ? Math.max(0.0006, 0.0028 * (1 - 0.55 * absS))
          : Math.max(0.00025, 0.0016 * (1 - 0.7 * absS));

        const pt = add(
          addScaled(nd.pos, W, s * hw * lobeScale),
          scale(N, vFold + bullation),
        );
        const pTop = addScaled(pt, N, thick);
        const pBot = addScaled(pt, N, -thick - (isOrchid ? 0.0005 : 0.0018) * latVein);

        const col = isOrchid
          ? mixRgb(
              mixRgb(this.colLeaf, rgb(0.06, 0.26, 0.10), 0.38),
              this.colLeafTip,
              clamp(0.14 * u + 0.18 * latVein, 0, 1),
            )
          : mixRgb(
              this.colLeaf,
              this.colLeafTip,
              clamp(0.22 * u + 0.38 * latVein + 0.25 * absS, 0, 1),
            );
        const w4: [number, number, number, number] = [
          clamp(0.35 + 0.65 * uSpine, 0, 1),
          spineFlex,
          phase,
          (isOrchid ? 0.004 : 0.014) * absS * u * this.p.windCompliance,
        ];
        topIdx.push(
          mesh.addVertex({
            x: pTop.x, y: pTop.y, z: pTop.z,
            tx: T.x, ty: T.y, tz: T.z,
            color: col, wind: w4, pivot, roughness: isOrchid ? 0.22 : 0.40, translucency: isOrchid ? 0.26 : 0.46, detailMetric: 0.3 + 0.6 * latVein, anatomyLevel: 2,
          }),
        );
        botIdx.push(
          mesh.addVertex({
            x: pBot.x, y: pBot.y, z: pBot.z,
            tx: T.x, ty: T.y, tz: T.z,
            color: isOrchid ? mixRgb(col, rgb(0.22, 0.12, 0.20), 0.22) : mixRgb(col, rgb(0.35, 0.52, 0.25), 0.25),
            wind: w4, pivot, roughness: isOrchid ? 0.34 : 0.54, translucency: isOrchid ? 0.22 : 0.42, detailMetric: 0.3 + 0.6 * latVein, anatomyLevel: 2,
          }),
        );
      }
    }

    for (let iu = 0; iu < uSegs; iu++) {
      for (let iv = 0; iv < vSegs; iv++) {
        const a = iu * nV + iv, b = (iu + 1) * nV + iv, c = (iu + 1) * nV + iv + 1, d = iu * nV + iv + 1;
        mesh.addQuad(topIdx[a], topIdx[b], topIdx[c], topIdx[d]);
        mesh.addQuad(botIdx[a], botIdx[d], botIdx[c], botIdx[b]);
      }
    }
  }

  /** Colossal Circular Cupped Peltate Lotus Umbrella Leaf with 20 Radiating 3D Veins & Wavy Rim! */
  private buildLotusPeltatePad(mesh: PartMesh, lm: LeafMount, tier: number): void {
    const tip = lm.stem.nodes[lm.stem.nodes.length - 1];
    const padR = lm.bladeLen * 0.5;
    const nRad = tier >= 3 ? 40 : 28;
    const nRings = tier >= 3 ? 10 : 7;
    const pivot = this.rootPivot;
    const phase = this.plantPhase;
    const padTipFlex = lm.baseFlex + lm.extraFlex;

    const upAxis = normalize(lerp(tip.dir, UP, 0.72));
    const p1 = anyPerpendicular(upAxis);
    const p2 = cross(upAxis, p1);

    const topRings: number[][] = [];
    const botRings: number[][] = [];

    for (let ir = 0; ir <= nRings; ir++) {
      const u = ir / nRings;
      const rBase = Math.max(padR * 0.025, padR * u);
      const topRIdx: number[] = [];
      const botRIdx: number[] = [];

      for (let j = 0; j < nRad; j++) {
        const th = (j / nRad) * TAU;
        // 20 radiating peltate lotus veins + undulating wavy lotus margin!
        const vein = Math.pow(Math.max(0, Math.cos(th * 10)), 6) * (1 - 0.25 * u);
        const rMod = rBase * (1 + 0.045 * Math.sin(th * 9 + lm.index) * u);
        const cupY =
          padR * 0.15 * Math.pow(u, 1.45) +
          padR * 0.042 * Math.sin(th * 7.0 + lm.index * 1.7) * Math.pow(u, 2.2);
        const radVec = add(scale(p1, Math.cos(th)), scale(p2, Math.sin(th)));
        const base = add(addScaled(tip.pos, upAxis, cupY), scale(radVec, rMod));
        const thick = 0.0018 * (1 - 0.65 * u);
        const pTop = addScaled(base, upAxis, thick);
        const pBot = addScaled(base, upAxis, -thick - 0.0028 * vein);

        const navelGlow = (1 - smoothstep(0.0, 0.14, u)) * 0.65;
        const col = mixRgb(
          mixRgb(this.colLeaf, rgb(0.14, 0.45, 0.32), 0.28),
          mixRgb(this.colLeafTip, rgb(0.78, 0.88, 0.42), navelGlow),
          clamp(navelGlow + 0.42 * vein + 0.18 * u, 0, 1),
        );
        const w4: [number, number, number, number] = [
          0.6,
          padTipFlex + 0.012 * this.p.windCompliance * Math.pow(u, 1.6),
          phase,
          0.03 * u * u * this.p.windCompliance,
        ];
        topRIdx.push(
          mesh.addVertex({
            x: pTop.x, y: pTop.y, z: pTop.z,
            tx: radVec.x, ty: radVec.y, tz: radVec.z,
            color: col, wind: w4, pivot, roughness: 0.64, translucency: 0.38, detailMetric: 0.3 + 0.65 * vein, anatomyLevel: 2,
          }),
        );
        botRIdx.push(
          mesh.addVertex({
            x: pBot.x, y: pBot.y, z: pBot.z,
            tx: radVec.x, ty: radVec.y, tz: radVec.z,
            color: mixRgb(col, rgb(0.42, 0.58, 0.44), 0.3), wind: w4, pivot, roughness: 0.56, translucency: 0.34, detailMetric: 0.3 + 0.65 * vein, anatomyLevel: 2,
          }),
        );
      }
      topRings.push(topRIdx);
      botRings.push(botRIdx);
    }

    for (let ir = 0; ir < nRings; ir++) {
      for (let j = 0; j < nRad; j++) {
        const jn = (j + 1) % nRad;
        // `radVec × tanVec`: at th=0, radVec=p1, tanVec=p2, p1 × p2 = +upAxis -> `(r0[j], r1[j], r1[jn], r0[jn])`!
        mesh.addQuad(topRings[ir][j], topRings[ir + 1][j], topRings[ir + 1][jn], topRings[ir][jn]);
        mesh.addQuad(botRings[ir][j], botRings[ir][jn], botRings[ir + 1][jn], botRings[ir + 1][j]);
      }
    }
  }
}

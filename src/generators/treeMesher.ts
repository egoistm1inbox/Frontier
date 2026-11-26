/**
 * Welded Woody Tree Generator (`src/generators/treeMesher.ts`).
 *
 * Implements Weber & Penn (SIGGRAPH 1995) recursive shoot skeletons +
 * terrain-following buttress/surface root systems welded into ONE single
 * closed genus-0 quad manifold (`V - E + F = 2`, `0` open boundary edges)
 * via `WeldedMesher` (`Frontier-OLD` `arena/01a096f8-frontier`), paired with
 * sculpted 3D botanical foliage driven by zero-scaling `SO(3)` wind.
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
  clone,
  cross,
  dot,
  hexToLinearRgb,
  length,
  lengthSq,
  lerp,
  lerp1,
  mixRgb,
  normalize,
  projectOnPlane,
  rotateAxis,
  rotateTowards,
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
import { TreeGeneratorParams } from './treeParams';

export interface TreeStats {
  stems: number;
  rootStems: number;
  weldedJunctions: number;
  weldedForks: number;
  droppedStems: number;
  leaves: number;
  closedManifold: boolean;
  eulerCharacteristic: number;
  height: number;
}

export interface TreeBuildResult {
  parts: PartMesh[];
  stats: TreeStats;
}

interface Turtle {
  pos: V3;
  dir: V3;
  right: V3;
}

interface ShootMeta {
  logicalLength: number;
  logicalStart: number;
  logicalRadius: number;
  radiusFactor: number;
  taper: number;
  lengthChildMax: number;
  offset: number;
  phase: number;
  limbRoot: WeldedStem;
  distFromLimb: number;
  limbReach: number;
}

interface LeafPlacement {
  stem: WeldedStem;
  sLocal: number;
  rAngleDeg: number;
  dAngleDeg: number;
  leafScale: number;
  hueJitter: number;
}

interface SpeciesProfile {
  shape: 'hemispherical' | 'umbrella' | 'layered_dome' | 'baobab_crown';
  baseSize0: number;
  length: [number, number, number, number];
  taper: [number, number, number, number];
  curveRes: [number, number, number, number];
  curve: [number, number, number, number];
  curveBack: [number, number, number, number];
  curveV: [number, number, number, number];
  bendV: [number, number, number, number];
  splitAngle: [number, number, number, number];
  downAngle: [number, number, number, number];
  downAngleV: [number, number, number, number];
  rotate: [number, number, number, number];
  branches: [number, number, number, number];
  attractionUp: number;
  leavesPerTwig: number;
  leafAspect: number;
  bottleSwelling: number;
}

const MAX_SIDE_RATIO = 0.66;
const MAX_EMERGE_DEG = 40;
const MIN_FORK_DEG = 16;
const SUBSTEPS = [6, 4, 3, 2];

function copyTurtle(t: Turtle): Turtle {
  return { pos: clone(t.pos), dir: clone(t.dir), right: clone(t.right) };
}

function angleBetween(a: V3, b: V3): number {
  const d = clamp(dot(a, b) / (length(a) * length(b) || 1), -1, 1);
  return Math.acos(d);
}

function declinationDeg(d: V3): number {
  return Math.acos(clamp(d.y, -1, 1)) * (180 / Math.PI);
}

function pitchDown(t: Turtle, deg: number): void {
  t.dir = normalize(rotateAxis(t.dir, t.right, -deg * DEG2RAD));
}

function turnLeft(t: Turtle, deg: number): void {
  const axis = normalize(cross(t.dir, t.right));
  t.dir = normalize(rotateAxis(t.dir, axis, -deg * DEG2RAD));
  t.right = normalize(rotateAxis(t.right, axis, -deg * DEG2RAD));
}

function rollRight(t: Turtle, deg: number): void {
  t.right = normalize(rotateAxis(t.right, t.dir, deg * DEG2RAD));
}

function rotateAroundUp(t: Turtle, deg: number): void {
  t.dir = normalize(rotateAxis(t.dir, UP, deg * DEG2RAD));
  t.right = normalize(rotateAxis(t.right, UP, deg * DEG2RAD));
}

function setDirection(t: Turtle, newDir: V3): void {
  const axis = cross(t.dir, newDir);
  const s = length(axis);
  const c = clamp(dot(t.dir, newDir), -1, 1);
  if (s < 1e-9) {
    t.dir = clone(newDir);
    t.right = normalize(projectOnPlane(t.right, t.dir));
    return;
  }
  const ang = Math.atan2(s, c);
  const k = scale(axis, 1 / s);
  t.dir = normalize(rotateAxis(t.dir, k, ang));
  t.right = normalize(projectOnPlane(rotateAxis(t.right, k, ang), t.dir));
}

function speciesProfile(p: TreeGeneratorParams): SpeciesProfile {
  switch (p.species) {
    case 'tropical_banyan':
      return {
        shape: 'umbrella',
        baseSize0: 0.34,
        length: [1.0, 0.64, 0.48, 0.32],
        taper: [0.92, 0.95, 1.0, 1.0],
        curveRes: [9, 9, 6, 3],
        curve: [0, 32, 16, -8],
        curveBack: [0, -24, 0, 0],
        curveV: [35, 95, 90, 50],
        bendV: [18, 70, 55, 0],
        splitAngle: [44, 42, 36, 0],
        downAngle: [0, p.branchAngleDeg, 48, 42],
        downAngleV: [0, -24, 16, 16],
        rotate: [0, 132, 138, 137.5],
        branches: [1, p.limbCount, 14, 9],
        attractionUp: 0.24,
        leavesPerTwig: 22,
        leafAspect: 0.65,
        bottleSwelling: 0,
      };
    case 'japanese_maple':
      return {
        shape: 'layered_dome',
        baseSize0: 0.24,
        length: [1.0, 0.56, 0.48, 0.34],
        taper: [0.96, 1.0, 1.0, 1.0],
        curveRes: [9, 8, 6, 3],
        curve: [14, 24, -18, -10],
        curveBack: [-12, -22, 0, 0],
        curveV: [48, 110, 95, 60],
        bendV: [28, 85, 60, 0],
        splitAngle: [40, 38, 34, 0],
        downAngle: [0, p.branchAngleDeg, 52, 46],
        downAngleV: [0, -22, 18, 14],
        rotate: [0, 137.5, 137.5, 137.5],
        branches: [1, p.limbCount, 13, 9],
        attractionUp: 0.18,
        leavesPerTwig: 24,
        leafAspect: 0.94,
        bottleSwelling: 0,
      };
    case 'african_baobab':
      return {
        shape: 'baobab_crown',
        baseSize0: 0.56,
        length: [0.76, 0.52, 0.46, 0.32],
        taper: [0.28, 0.86, 0.95, 1.0],
        curveRes: [8, 8, 5, 3],
        curve: [0, 28, -18, 0],
        curveBack: [0, -32, 0, 0],
        curveV: [18, 95, 90, 50],
        bendV: [10, 75, 50, 0],
        splitAngle: [52, 44, 38, 0],
        downAngle: [0, 58, 48, 42],
        downAngleV: [0, -14, 18, 15],
        rotate: [0, 135, 140, 137.5],
        branches: [1, Math.max(12, p.limbCount), 12, 8],
        attractionUp: 0.28,
        leavesPerTwig: 20,
        leafAspect: 0.74,
        bottleSwelling: 0.42,
      };
    case 'english_oak':
    default:
      return {
        shape: 'hemispherical',
        baseSize0: 0.25,
        length: [1.0, 0.56, 0.46, 0.32],
        taper: [0.96, 1.0, 1.0, 1.0],
        curveRes: [9, 9, 6, 3],
        curve: [0, 24, 10, 0],
        curveBack: [0, -32, 0, 0],
        curveV: [50, 125, 110, 70],
        bendV: [18, 82, 55, 0],
        splitAngle: [38, 40, 38, 0],
        downAngle: [0, p.branchAngleDeg, 45, 44],
        downAngleV: [0, -28, 18, 16],
        rotate: [0, 126, 138, 137.5],
        branches: [1, p.limbCount, 14, 9],
        attractionUp: 0.34,
        leavesPerTwig: 22,
        leafAspect: 0.74,
        bottleSwelling: 0,
      };
  }
}

function crownEnvelope(shape: SpeciesProfile['shape'], ratio: number): number {
  switch (shape) {
    case 'umbrella':
      return 0.38 + 0.62 * Math.sin(0.55 * Math.PI * clamp(ratio, 0, 1));
    case 'layered_dome':
      return 0.32 + 0.68 * Math.sin(Math.PI * (0.15 + 0.72 * clamp(ratio, 0, 1)));
    case 'baobab_crown':
      return 0.55 + 0.45 * Math.sin(0.5 * Math.PI * clamp(ratio, 0, 1));
    case 'hemispherical':
    default:
      return 0.25 + 0.75 * Math.sin(0.5 * Math.PI * clamp(ratio, 0, 1));
  }
}

export class TreeMesher {
  private readonly p: TreeGeneratorParams;
  private readonly prof: SpeciesProfile;
  private readonly rng: Random;
  private readonly leafRng: Random;
  private readonly substrate: HostSubstrate;
  private nextId = 0;
  private meta = new Map<number, ShootMeta>();
  private allShootStems: WeldedStem[] = [];
  private leafPlacements: LeafPlacement[] = [];
  private splitError = [0, 0, 0, 0, 0];
  private lobePhase = 0;
  private treePhase = 0.08;
  private groundOrigin: V3 = { x: 0, y: 0, z: 0 };
  private lobes = 5;
  private treeHeightEst = 12;
  private colBark: RGB;
  private colBarkDeep: RGB;
  private colBarkUpper: RGB;
  private meshCfg: WeldedMeshConfig;

  constructor(params: TreeGeneratorParams, seed: number, substrate: HostSubstrate) {
    this.p = params;
    this.prof = speciesProfile(params);
    this.rng = new Random((seed ^ 0x77ee5eed) >>> 0);
    this.leafRng = new Random((seed ^ 0x1eafc0de) >>> 0);
    this.substrate = substrate;
    this.lobePhase = ((seed % 360) * Math.PI) / 180;
    this.treePhase = 0.08 + (((seed >>> 0) % 997) / 997) * 0.05;
    this.lobes = Math.max(3, Math.round(params.rootCount > 0 ? params.rootCount : 5));
    this.treeHeightEst = Math.max(2.5, params.height);
    this.colBark = hexToLinearRgb(params.hueBark);
    this.colBarkDeep = mixRgb(this.colBark, hexToLinearRgb('#140d08'), 0.48);
    this.colBarkUpper = mixRgb(this.colBark, hexToLinearRgb('#7d6b56'), 0.28);

    const tier = clamp(Math.round(params.detailTier), 1, 4);
    const trunkSegs = tier === 1 ? 18 : tier === 2 ? 22 : tier === 3 ? 28 : 34;
    this.meshCfg = {
      trunkRadialSegments: trunkSegs,
      minRadialSegments: tier >= 3 ? 6 : 4,
      collarScale: 1.28,
      collarLength: 1.18,
      collarRings: tier >= 3 ? 2 : 1,
      collarFillet: clamp(params.collarFillet, 0.2, 0.98),
      collarMitre: 0.52,
      minRadius: tier >= 3 ? 0.0045 : 0.007,
      capTips: true,
    };
  }

  build(layerId: string): TreeBuildResult {
    const p = this.p;
    const tier = clamp(Math.round(p.detailTier), 1, 4);
    const levels = clamp(Math.round(p.branchLevels), 2, tier === 1 ? 3 : 4);

    const woodMesh = new PartMesh(
      `${layerId}:wood`,
      'Welded Roots, Trunk & Crown',
      'botanical',
      layerId,
      'tussock',
      '#b8895a',
    );
    const leafMesh = new PartMesh(
      `${layerId}:leaves`,
      'Canopy Foliage Blades',
      'botanical',
      layerId,
      'leaf',
      p.hueLeafTip,
    );

    const groundSample = this.substrate.sampleSurface(0.5, 0.5);
    const groundOrigin = groundSample.pos;
    this.groundOrigin = groundOrigin;

    // 1. Build Weber-Penn shoot hierarchy (trunk + limbs + branches + twigs + forks)
    const turtle: Turtle = {
      pos: clone(groundOrigin),
      dir: clone(UP),
      right: { x: 1, y: 0, z: 0 },
    };
    rollRight(turtle, this.rng.range(0, 360));

    const trunk = this.createShootStem(0, null, 'root');
    const trunkMeta = this.meta.get(trunk.id)!;
    trunkMeta.lengthChildMax = this.prof.length[1];
    trunkMeta.logicalLength = Math.max(1.5, p.height);
    trunkMeta.logicalRadius = trunkMeta.logicalLength * p.trunkRatio;
    trunkMeta.taper = this.prof.taper[0];

    this.growShootStem(turtle, trunk, 0, 0, 1.0, 1.0, levels);

    // Compute limbReach & true shoot height
    let shootMaxY = groundOrigin.y + 1.0;
    for (const st of this.allShootStems) {
      const m = this.meta.get(st.id)!;
      for (const nd of st.nodes) if (nd.pos.y > shootMaxY) shootMaxY = nd.pos.y;
      const reach = m.distFromLimb + st.length;
      const rootMeta = this.meta.get(m.limbRoot.id)!;
      if (reach > rootMeta.limbReach) rootMeta.limbReach = reach;
    }
    for (const st of this.allShootStems) {
      const m = this.meta.get(st.id)!;
      const rootMeta = this.meta.get(m.limbRoot.id)!;
      m.limbReach = Math.max(1e-4, rootMeta.limbReach);
    }
    this.treeHeightEst = Math.max(1.5, shootMaxY - groundOrigin.y);

    // 2. Build terrain-hugging buttress & surface root system welded into trunk base!
    if (p.rootCount > 0) {
      this.buildWeldedRoots(trunk, groundOrigin);
    }

    // 3. Emit single closed watertight quad manifold via `WeldedMesher`!
    const buildStats = new WeldedMesher(woodMesh, [trunk], this.meshCfg).build();
    const topo = validateWeldedManifold(woodMesh);

    // 4. Emit sculpted 3D foliage leaves directly on the final post-relocation twigs!
    let emittedLeaves = 0;
    if (p.showLeaves && p.leafDensity > 0.02) {
      emittedLeaves = this.emitCanopyLeaves(leafMesh, tier);
    }

    woodMesh.metaLabel = `${buildStats.stems} stems · ${buildStats.junctions} collars · ${buildStats.forks} forks`;
    leafMesh.metaLabel = `${emittedLeaves.toLocaleString('en-US')} leaves`;

    const parts = [woodMesh, leafMesh].filter((m) => m.faceCount > 0);
    let maxY = 0.5;
    for (const part of parts) {
      const pos = part.positions;
      for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
    }

    return {
      parts,
      stats: {
        stems: buildStats.stems,
        rootStems: buildStats.rootStems,
        weldedJunctions: buildStats.junctions,
        weldedForks: buildStats.forks,
        droppedStems: buildStats.droppedStems,
        leaves: emittedLeaves,
        closedManifold: topo.closed && topo.manifold && topo.components === 1,
        eulerCharacteristic: topo.eulerCharacteristic,
        height: maxY,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Shoot Stem Factory & Radius / Bark / Wind Styling
  // ---------------------------------------------------------------------------

  private createShootStem(
    level: number,
    parent: WeldedStem | null,
    attach: WeldedStem['attach'],
  ): WeldedStem {
    const id = this.nextId++;
    const p = this.p;
    const prof = this.prof;
    const tier = clamp(Math.round(p.detailTier), 1, 4);
    const stem: WeldedStem = {
      id,
      level,
      role: 'shoot',
      parent,
      attach,
      attachS: 0,
      attachDir: clone(UP),
      nodes: [],
      length: 0,
      children: [],
      forks: [],
      dropped: false,
      radiusDrop: 1,
      baseRadiusAt: (s: number) => this.evalShootRadius(stem, s),
      profileFactor: (s: number, th: number) => this.evalTrunkButtressProfile(stem, s, th),
      styleAt: (s: number, th: number, pos: V3, _dir: V3, isJunc: boolean) => {
        const m = this.meta.get(stem.id)!;
        const furrow =
          0.86 +
          0.14 *
            Math.sin(
              th * (stem.level === 0 ? 11 : 6) +
                s * 4.5 +
                fbm3(pos.x * 2.2, pos.y * 2.2, pos.z * 2.2, 2) * 3.0,
            );
        const colBase = mixRgb(this.colBarkDeep, this.colBark, furrow);
        const col = mixRgb(colBase, this.colBarkUpper, clamp(stem.level * 0.25, 0, 0.72));
        const h01 = clamp((pos.y - this.groundOrigin.y) / this.treeHeightEst, 0, 1);
        const woodFlex = this.evalWoodFlex(stem, s, pos);
        return {
          color: col,
          roughness: lerp1(0.84, 0.66, clamp(stem.level * 0.3, 0, 1)),
          translucency: 0.04,
          detailMetric: isJunc ? 0.98 : clamp(0.25 + stem.level * 0.2, 0, 0.85),
          anatomyLevel: Math.min(4, stem.level + 1),
          wind: [h01, woodFlex, this.treePhase, 0],
          pivot: this.groundOrigin,
        };
      },
    };

    const meta: ShootMeta = {
      logicalLength: 1,
      logicalStart: 0,
      logicalRadius: 0.1,
      radiusFactor: 1,
      taper: prof.taper[Math.min(level, 3)],
      lengthChildMax: 0,
      offset: 0,
      phase: this.rng.next(),
      limbRoot: stem,
      distFromLimb: 0,
      limbReach: 1,
    };
    this.meta.set(id, meta);
    if (level > 0) {
      const rps = tier >= 3 ? [3, 2, 2, 1] : [2, 2, 1, 1];
      const cr = prof.curveRes[Math.min(level, 3)];
      stem.ringSpacing = Math.max(0.035, 1 / Math.max(1, cr * rps[Math.min(level, 3)]));
    }
    this.allShootStems.push(stem);
    return stem;
  }

  private evalShootRadius(stem: WeldedStem, s: number): number {
    const m = this.meta.get(stem.id);
    if (!m) return this.meshCfg.minRadius;
    const z = clamp(m.logicalStart + s / Math.max(1e-6, m.logicalLength), 0, 1);
    const unitTaper = clamp(m.taper, 0.1, 1.0);
    let r = m.logicalRadius * (1 - unitTaper * z * 0.94);

    if (stem.level === 0) {
      // Exponential basal root flare
      const yFlare = Math.max(0, 1 - 7.5 * Math.max(0, z));
      const flareMult = 1 + this.p.basalFlare * ((Math.pow(80, yFlare) - 1) / 80);
      r *= flareMult;

      // Optional bottle swelling (Baobab succulent water-storage trunk tapering cleanly across forked crown boughs!)
      if (this.prof.bottleSwelling > 0) {
        const bottle =
          1 +
          this.prof.bottleSwelling *
            Math.sin(Math.PI * Math.pow(clamp(z / 0.72, 0, 1), 0.72)) *
            (1 - smoothstep(0.58, 0.82, z));
        const crownNeck = lerp1(1.0, 0.16, smoothstep(0.66, 1.0, z));
        r *= bottle * crownNeck;
      }
    }
    r *= m.radiusFactor;
    return Math.max(this.meshCfg.minRadius, r);
  }

  private evalTrunkButtressProfile(stem: WeldedStem, s: number, theta: number): number {
    if (
      stem.level !== 0 ||
      stem.role === 'root' ||
      stem.parent !== null ||
      this.lobes <= 0 ||
      this.p.buttressRelief <= 0
    ) {
      return 1;
    }
    const m = this.meta.get(stem.id)!;
    const lobeSpan = (this.p.species === 'tropical_banyan' ? 0.24 : 0.12) * m.logicalLength;
    const sAbove = s + m.logicalStart * m.logicalLength;
    const fall = clamp(1 - sAbove / Math.max(1e-6, lobeSpan), 0, 1);
    if (fall <= 0) return 1;
    const f = fall * fall;
    // Sharper plank-buttress fin profile on tropical banyan, rounded buttress on oak/baobab
    const wave = 0.5 + 0.5 * Math.cos(this.lobes * theta + this.lobePhase);
    const fin = this.p.species === 'tropical_banyan' ? Math.pow(wave, 1.85) : wave;
    return 1 + this.p.buttressRelief * f * fin;
  }

  // ---------------------------------------------------------------------------
  // Weber-Penn Recursive Stem & Fork Growth
  // ---------------------------------------------------------------------------

  private growShootStem(
    turtle: Turtle,
    stem: WeldedStem,
    startSeg: number,
    splitCorrAngle: number,
    branchesFactor: number,
    cloneProb: number,
    maxLevels: number,
    emergeTarget?: V3,
  ): void {
    const p = this.p;
    const prof = this.prof;
    const m = this.meta.get(stem.id)!;
    const level = stem.level;
    const lp = Math.min(level + 1, 3);
    const curveRes = Math.max(2, Math.round(prof.curveRes[Math.min(level, 3)]));
    const segLength = m.logicalLength / curveRes;
    const baseSegIndex = Math.ceil(prof.baseSize0 * Math.max(1, curveRes));
    const substeps = SUBSTEPS[Math.min(level, 3)];
    const isLastLevel = level >= maxLevels - 1;

    const rps = clamp(Math.round(p.detailTier), 1, 4) >= 3 ? [3, 2, 2, 1] : [2, 2, 1, 1];
    stem.ringSpacing = Math.max(0.03, m.logicalLength / curveRes / rps[Math.min(level, 3)]);

    // Fork split probability per segment
    const segSplits =
      level === 0
        ? p.forkTendency * 0.65
        : level === 1
          ? p.forkTendency * 0.85
          : level === 2
            ? p.forkTendency * 0.45
            : 0;

    let branchCount = 0;
    let leafCount = 0;
    if (isLastLevel) {
      leafCount = prof.leavesPerTwig * p.leafDensity * (1 - startSeg / curveRes);
    } else {
      branchCount = this.calcBranchCount(stem) * (1 - startSeg / curveRes) * branchesFactor;
    }
    let perSegBranches = branchCount / curveRes;
    const perSegLeaves = leafCount / curveRes;
    let branchErr = 0;
    let leafErr = 0;
    const prevRot = { v: this.rng.range(0, 360) };

    stem.nodes.push({
      pos: clone(turtle.pos),
      dir: clone(turtle.dir),
      right: clone(turtle.right),
      s: 0,
    });
    let s = 0;
    let pendingPitch = 0;
    let pendingTurn = 0;
    const emergeAngle = emergeTarget ? angleBetween(turtle.dir, emergeTarget) : 0;

    for (let seg = startSeg + 1; seg <= curveRes; seg++) {
      const remainingSegs = curveRes + 1 - seg;
      const stepLen = segLength / substeps;

      for (let k = 0; k < substeps; k++) {
        if (pendingPitch !== 0) pitchDown(turtle, pendingPitch / substeps);
        if (pendingTurn !== 0) turnLeft(turtle, pendingTurn / substeps);
        if (emergeTarget && emergeAngle > 1e-4 && seg === startSeg + 1) {
          const nd = rotateTowards(turtle.dir, emergeTarget, emergeAngle / substeps);
          setDirection(turtle, nd);
        }
        if (level >= 1) {
          // Upward phototropism + optional canopy flattening
          const hxt = cross(turtle.dir, v3(0, prof.attractionUp, 0));
          const mag = length(hxt);
          if (mag > 1e-8) {
            const alpha = (10 * mag * DEG2RAD) / substeps;
            const ax = scale(hxt, 1 / mag);
            turtle.dir = normalize(rotateAxis(turtle.dir, ax, alpha));
            turtle.right = normalize(rotateAxis(turtle.right, ax, alpha));
          }
          if (p.canopyFlatten > 0.02 && level >= 1) {
            const horiz = v3(turtle.dir.x, 0, turtle.dir.z);
            const hl = length(horiz);
            if (hl > 1e-5) {
              const targetH = scale(horiz, 1 / hl);
              const ang = angleBetween(turtle.dir, targetH);
              if (ang > 1e-4) {
                const stp = Math.min(ang, (12 * p.canopyFlatten * DEG2RAD * Math.sin(ang)) / substeps);
                setDirection(turtle, rotateTowards(turtle.dir, targetH, stp));
              }
            }
          }
        }
        turtle.pos = addScaled(turtle.pos, turtle.dir, stepLen);
        s += stepLen;
        stem.nodes.push({
          pos: clone(turtle.pos),
          dir: clone(turtle.dir),
          right: clone(turtle.right),
          s,
        });
      }
      stem.length = s;

      // Check for true Y-fork split on this segment
      let numSplits = 0;
      if (this.p.species === 'african_baobab' && level === 0 && seg === Math.max(3, curveRes - 3)) {
        // Iconic Baobab crown: stout bottle trunk divides into 3 gnarled boughs that branch out!
        numSplits = 2;
      } else if (seg < curveRes && segSplits > 0 && (level > 0 || seg > baseSegIndex)) {
        if (this.rng.next() <= cloneProb) {
          numSplits = Math.floor(segSplits + this.splitError[level]);
          this.splitError[level] -= numSplits - segSplits;
          if (numSplits > 0) {
            cloneProb /= numSplits + 1;
            branchesFactor = Math.max(0.78, branchesFactor / (numSplits + 1));
            branchCount *= branchesFactor;
            perSegBranches = branchCount / curveRes;
          }
        }
      }

      if (branchCount > 0 && !isLastLevel) {
        const onSeg = Math.floor(perSegBranches + branchErr);
        branchErr -= onSeg - perSegBranches;
        if (onSeg > 0) {
          this.spawnSideBranches(stem, seg, curveRes, segLength, startSeg, onSeg, prevRot, maxLevels);
        }
        // Sub-terminal branches also carry outer foliage sprays for lush crowns
        if (level === maxLevels - 2 && seg >= Math.ceil(curveRes * 0.45)) {
          const subLeaves = Math.max(2, Math.round((prof.leavesPerTwig * p.leafDensity) / curveRes * 0.65));
          this.recordLeavesOnSeg(stem, seg, curveRes, segLength, startSeg, subLeaves, prevRot);
        }
      } else if (leafCount > 0) {
        const onSeg = Math.floor(perSegLeaves + leafErr);
        leafErr -= onSeg - perSegLeaves;
        if (onSeg > 0) {
          this.recordLeavesOnSeg(stem, seg, curveRes, segLength, startSeg, onSeg, prevRot);
        }
      }

      if (numSplits > 0) {
        this.spawnFork(
          turtle,
          stem,
          seg,
          curveRes,
          remainingSegs,
          numSplits,
          branchesFactor,
          cloneProb,
          maxLevels,
        );
        return;
      }

      if (seg < curveRes) {
        pendingTurn = (this.rng.uniform() * prof.bendV[Math.min(level, 3)]) / curveRes;
        const c0 = prof.curve[Math.min(level, 3)];
        const cb = prof.curveBack[Math.min(level, 3)];
        const cv = prof.curveV[Math.min(level, 3)];
        const baseAng = cb === 0 ? c0 / curveRes : seg < curveRes / 2 ? c0 / (curveRes / 2) : cb / (curveRes / 2);
        pendingPitch = baseAng + (this.rng.uniform() * cv) / curveRes - splitCorrAngle;
      }
    }
    stem.length = s;

    // Crown apex tuft: never leave bare leader tips sticking out of the canopy!
    if (!isLastLevel && stem.forks.length === 0) {
      const tipSegs = Math.max(1, Math.min(2, curveRes - startSeg));
      for (let seg = curveRes - tipSegs + 1; seg <= curveRes; seg++) {
        this.recordLeavesOnSeg(
          stem,
          seg,
          curveRes,
          segLength,
          startSeg,
          Math.max(4, Math.round(prof.leavesPerTwig * p.leafDensity * 0.5)),
          prevRot,
        );
      }
    }
  }

  private spawnFork(
    turtle: Turtle,
    stem: WeldedStem,
    seg: number,
    curveRes: number,
    remainingSegs: number,
    numSplits: number,
    branchesFactor: number,
    cloneProb: number,
    maxLevels: number,
  ): void {
    const prof = this.prof;
    const m = this.meta.get(stem.id)!;
    const level = stem.level;
    const decl = declinationDeg(turtle.dir);
    const splAngle = Math.max(
      14,
      Math.abs(prof.splitAngle[Math.min(level, 3)]) + this.rng.uniform() * 8 - decl * 0.45,
    );
    const splitCorr = splAngle / Math.max(1, remainingSegs);
    const sprAngle = -(24 + 0.65 * (28 + Math.abs(decl - 90) * this.rng.next()));

    const turtles: Turtle[] = [];
    for (let i = 0; i < numSplits; i++) {
      const t = copyTurtle(turtle);
      pitchDown(t, splAngle * 0.5);
      rotateAroundUp(t, i === 0 ? sprAngle * 0.5 : -sprAngle * 0.5);
      turtles.push(t);
    }
    const orig = copyTurtle(turtle);
    pitchDown(orig, splAngle * 0.5);
    if (numSplits === 1) rotateAroundUp(orig, -sprAngle * 0.5);
    turtles.unshift(orig);

    // Enforce minimum fork sibling separation so D-ring crotches stay crisp!
    const minAng = MIN_FORK_DEG * DEG2RAD;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < turtles.length; i++) {
        for (let j = i + 1; j < turtles.length; j++) {
          const a = turtles[i];
          const b = turtles[j];
          const ang = angleBetween(a.dir, b.dir);
          if (ang >= minAng) continue;
          let ax = cross(a.dir, b.dir);
          if (lengthSq(ax) < 1e-10) ax = anyPerpendicular(a.dir);
          ax = normalize(ax);
          const delta = (minAng - ang) * 0.5 + 1e-3;
          setDirection(a, normalize(rotateAxis(a.dir, ax, -delta)));
          setDirection(b, normalize(rotateAxis(b.dir, ax, delta)));
          moved = true;
        }
      }
      if (!moved) break;
    }

    const k = turtles.length;
    const conserve = clamp(this.p.pipeConservation, 0, 1);
    const factor = Math.pow(1 / k, 0.5 * conserve);

    for (const t of turtles) {
      const child = this.createShootStem(level, stem, 'fork');
      const cm = this.meta.get(child.id)!;
      cm.logicalLength = m.logicalLength;
      cm.logicalStart = seg / curveRes;
      cm.logicalRadius = m.logicalRadius;
      cm.radiusFactor = m.radiusFactor * factor;
      cm.taper = m.taper;
      cm.lengthChildMax = m.lengthChildMax;
      cm.offset = m.offset;
      cm.limbRoot = m.limbRoot;
      cm.distFromLimb = m.distFromLimb + stem.length;
      child.attachDir = clone(t.dir);
      stem.forks.push(child);
      this.growShootStem(t, child, seg, splitCorr, branchesFactor, cloneProb, maxLevels);
    }
  }

  private spawnSideBranches(
    stem: WeldedStem,
    seg: number,
    curveRes: number,
    segLength: number,
    startSeg: number,
    count: number,
    prevRot: { v: number },
    maxLevels: number,
  ): void {
    const prof = this.prof;
    const m = this.meta.get(stem.id)!;
    const lp = Math.min(stem.level + 1, 3);
    const baseLen = stem.level === 0 ? m.logicalLength * prof.baseSize0 : m.logicalLength * 0.05;
    const startOffset = startSeg * segLength;

    for (let b = 0; b < count; b++) {
      const offset = 0.10 + (b / Math.max(1, count)) * 0.80;
      const stemOffset = ((seg - 1 + offset) / curveRes) * m.logicalLength;
      if (stemOffset <= baseLen) continue;
      prevRot.v = (prevRot.v + prof.rotate[lp] + this.rng.uniform() * 24 + 360) % 360;
      this.attachSideBranch(stem, stemOffset - startOffset, stemOffset, prevRot.v, maxLevels);
    }
  }

  private attachSideBranch(
    stem: WeldedStem,
    sLocal: number,
    stemOffset: number,
    rAngleDeg: number,
    maxLevels: number,
  ): void {
    if (sLocal <= 0 || sLocal >= stem.length) return;
    const prof = this.prof;
    const parentMeta = this.meta.get(stem.id)!;
    const level = stem.level + 1;
    const lp = Math.min(level, 3);

    const sample = sampleWeldedStem(stem, sLocal);
    const childRight = normalize(rotateAxis(sample.right, sample.dir, rAngleDeg * DEG2RAD));
    const dAngle = this.calcDownAngle(stem, stemOffset);
    const childDir = normalize(rotateAxis(sample.dir, childRight, -dAngle * DEG2RAD));

    const baseLen = stem.level === 0 ? parentMeta.logicalLength * prof.baseSize0 : 0;
    const ratio = clamp(
      (parentMeta.logicalLength - stemOffset) / Math.max(1e-5, parentMeta.logicalLength - baseLen),
      0,
      1,
    );
    const childLen =
      level === 1
        ? parentMeta.logicalLength * parentMeta.lengthChildMax * crownEnvelope(prof.shape, ratio)
        : parentMeta.lengthChildMax * (parentMeta.logicalLength - 0.65 * stemOffset);

    if (childLen < this.meshCfg.minRadius * 6) return;

    const radiusLimit = stem.baseRadiusAt(sLocal);
    let childRad =
      parentMeta.logicalRadius * Math.pow(childLen / Math.max(1e-5, parentMeta.logicalLength), 1.28);
    childRad = clamp(childRad, this.meshCfg.minRadius * 1.35, radiusLimit * MAX_SIDE_RATIO);

    const child = this.createShootStem(level, stem, 'side');
    const cm = this.meta.get(child.id)!;
    cm.offset = stemOffset;
    cm.lengthChildMax = prof.length[Math.min(level + 1, 3)] * this.rng.vary(1, 0.08);
    cm.logicalLength = childLen;
    cm.logicalRadius = childRad;
    cm.limbRoot = level <= 1 ? child : parentMeta.limbRoot;
    cm.distFromLimb = level <= 1 ? 0 : parentMeta.distFromLimb + sLocal;

    const conserve = clamp(this.p.pipeConservation, 0, 1);
    const share = (childRad / Math.max(1e-6, radiusLimit)) ** 2;
    child.radiusDrop = clamp(Math.sqrt(Math.max(0, 1 - conserve * share)), 0.56, 1);
    child.attachS = sLocal;
    child.attachDir = childDir;

    let radial = projectOnPlane(childDir, sample.dir);
    if (lengthSq(radial) < 1e-8) radial = childRight;
    radial = normalize(radial);
    const origin = addScaled(sample.pos, radial, radiusLimit);
    const emergeDir = rotateTowards(radial, childDir, MAX_EMERGE_DEG * DEG2RAD);
    let right = projectOnPlane(childRight, emergeDir);
    if (lengthSq(right) < 1e-8) right = anyPerpendicular(emergeDir);
    const turtle: Turtle = { pos: origin, dir: emergeDir, right: normalize(right) };

    stem.children.push(child);
    this.growShootStem(turtle, child, 0, 0, 1.0, 1.0, maxLevels, childDir);
  }

  private calcDownAngle(stem: WeldedStem, stemOffset: number): number {
    const prof = this.prof;
    const m = this.meta.get(stem.id)!;
    const lp = Math.min(stem.level + 1, 3);
    const d = prof.downAngle[lp];
    const dv = prof.downAngleV[lp];
    if (dv >= 0) return d + this.rng.uniform() * dv;
    const base = stem.level === 0 ? prof.baseSize0 : 0.04;
    const denom = Math.max(1e-5, m.logicalLength * (1 - base));
    const ratio = clamp((m.logicalLength - stemOffset) / denom, 0, 1);
    return d + dv * (1 - 2 * (0.2 + 0.8 * ratio));
  }

  private calcBranchCount(stem: WeldedStem): number {
    const prof = this.prof;
    const m = this.meta.get(stem.id)!;
    const lp = Math.min(stem.level + 1, 3);
    const n = prof.branches[lp];
    if (stem.level === 0) return n;
    return n * (0.55 + 0.45 * clamp(m.logicalLength / 4.0, 0.2, 1.2));
  }

  // ---------------------------------------------------------------------------
  // Terrain-Following Welded Primary, Lateral & Forked Root System
  // ---------------------------------------------------------------------------

  private buildWeldedRoots(trunk: WeldedStem, groundOrigin: V3): void {
    const p = this.p;
    const trunkMeta = this.meta.get(trunk.id)!;
    const count = Math.max(1, Math.round(p.rootCount));
    const N = Math.max(6, Math.round(this.meshCfg.trunkRadialSegments));
    const colStep = TAU / N;
    const rNom = trunkMeta.logicalRadius * (1 + p.basalFlare * 0.45);
    const rng = this.rng.fork(0x726f6f74);

    // Lay out ground-level windows around the trunk ring with >= 1 free column between roots!
    type RootSlot = {
      k: number;
      c: number;
      w: number;
      u: number;
      radius: number;
      len: number;
      seed: number;
      theta: number;
    };
    const slots: RootSlot[] = [];
    const maxSlots = Math.min(count, Math.floor(N / 2) - 1);
    for (let k = 0; k < maxSlots; k++) {
      const jitter = rng.uniform() * 0.1 * (TAU / maxSlots);
      const theta = (TAU * k) / maxSlots + jitter;
      const radius = Math.max(
        this.meshCfg.minRadius * 4,
        rNom * (p.species === 'tropical_banyan' ? 0.36 : 0.32) * rng.vary(1, 0.12),
      );
      const len = Math.max(radius * 6.5, p.height * p.rootReach * rng.vary(1, 0.16));
      let c = (theta / colStep) % N;
      if (c < 0) c += N;
      const chord = (TAU * trunk.baseRadiusAt(0.05)) / N;
      const wEst = clamp(Math.round((2 * radius * this.meshCfg.collarScale) / chord), 1, 3);
      slots.push({ k, c, w: wEst, u: 0, radius, len, seed: rng.nextUint32(), theta });
    }

    slots.sort((a, b) => a.c - b.c);
    let need = slots.reduce((acc, s) => acc + s.w + 1, 0);
    while (need > N) {
      let widest = slots[0];
      for (const sl of slots) if (sl.w > widest.w) widest = sl;
      if (widest.w <= 1) break;
      widest.w--;
      need--;
    }
    const K = slots.length;
    const uArr = slots.map((sl) => Math.round(sl.c - sl.w / 2));
    for (let i = 1; i < K; i++) uArr[i] = Math.max(uArr[i], uArr[i - 1] + slots[i - 1].w + 1);
    let bound = uArr[0] + N;
    for (let i = K - 1; i >= 1; i--) {
      uArr[i] = Math.min(uArr[i], bound - slots[i].w - 1);
      bound = uArr[i];
    }
    for (let i = 0; i < K; i++) {
      let v = uArr[i] % N;
      if (v < 0) v += N;
      slots[i].u = v;
      slots[i].theta = (v + slots[i].w * 0.5) * colStep;
    }

    // Align trunk buttress lobes directly onto the primary root exits!
    let sx = 0;
    let sy = 0;
    for (const sl of slots) {
      sx += Math.cos(this.lobes * sl.theta);
      sy += Math.sin(this.lobes * sl.theta);
    }
    if (sx * sx + sy * sy > 1e-8) {
      this.lobePhase = -Math.atan2(sy, sx);
    }

    // Extend trunk cleanly below ground so ground-level root collars sit flush with soil!
    const maxRc = Math.max(...slots.map((s) => s.radius));
    const depth = Math.min(trunk.length * 0.25, maxRc * 2.8 + 0.08);
    this.extendTrunkBelowGround(trunk, depth);
    // Add dense flare stations near ground level (`Frontier-OLD` invariant)
    trunk.extraStations = [
      depth * 0.45,
      depth,
      depth + 0.02 * trunkMeta.logicalLength,
      depth + 0.05 * trunkMeta.logicalLength,
      depth + 0.09 * trunkMeta.logicalLength,
      depth + 0.15 * trunkMeta.logicalLength,
    ];

    for (const sl of slots) {
      const attachS = depth + sl.radius * (p.species === 'tropical_banyan' ? 1.15 : 0.62);
      const smp = sampleWeldedStem(trunk, attachS);
      const up = cross(smp.dir, smp.right);
      const radial = normalize(add(scale(smp.right, Math.cos(sl.theta)), scale(up, Math.sin(sl.theta))));
      const rSurf = trunk.baseRadiusAt(attachS) * this.evalTrunkButtressProfile(trunk, attachS, sl.theta);
      const origin = addScaled(smp.pos, radial, rSurf);
      const descentRad = (p.species === 'tropical_banyan' ? 32 : 24) * DEG2RAD;
      const horizAxis = normalize(cross(radial, UP));
      const emergeDir = normalize(rotateAxis(radial, horizAxis, -descentRad));

      const rootStem = this.createRootStem(trunk, sl.radius, sl.len, sl.w);
      rootStem.attachS = attachS;
      rootStem.attachDir = emergeDir;

      const grow = (o: V3, d: V3): void => {
        rootStem.children = [];
        rootStem.forks = [];
        rootStem.nodes = [];
        rootStem.length = 0;
        this.growTerrainRoot(rootStem, o, d, sl.radius, sl.len, sl.seed, groundOrigin, true);
      };
      rootStem.regrow = grow;
      grow(origin, emergeDir);
      trunk.children.push(rootStem);
    }
  }

  private extendTrunkBelowGround(trunk: WeldedStem, depth: number): void {
    const m = this.meta.get(trunk.id)!;
    const n0 = trunk.nodes[0];
    const dir = normalize(n0.dir);
    for (const n of trunk.nodes) n.s += depth;
    for (const c of trunk.children) c.attachS += depth;
    const base = addScaled(n0.pos, dir, -depth);
    const k = Math.max(2, Math.ceil(depth / Math.max(0.05, 0.35 * m.logicalRadius)));
    const stub: WeldedNode[] = [];
    for (let i = 0; i < k; i++) {
      const s = (i / k) * depth;
      stub.push({ pos: addScaled(base, dir, s), dir: clone(dir), right: clone(n0.right), s });
    }
    trunk.nodes.unshift(...stub);
    trunk.length += depth;
    m.logicalStart = -depth / m.logicalLength;
  }

  private createRootStem(
    parent: WeldedStem,
    baseRadius: number,
    totalLen: number,
    windowCols?: number,
  ): WeldedStem {
    const id = this.nextId++;
    const tier = clamp(Math.round(this.p.detailTier), 1, 4);
    const stem: WeldedStem = {
      id,
      level: 4,
      role: 'root',
      parent,
      attach: 'side',
      attachS: 0,
      attachDir: clone(UP),
      nodes: [],
      length: 0,
      children: [],
      forks: [],
      dropped: false,
      radiusDrop: 1,
      windowCols,
      minRing: tier >= 3 ? 10 : 8,
      ringSpacing: clamp(0.55 * baseRadius, 0.025, 0.18),
      baseRadiusAt: (s: number) => {
        const z = clamp(s / Math.max(1e-5, totalLen), 0, 1);
        return Math.max(this.meshCfg.minRadius, baseRadius * Math.pow(Math.max(0, 1 - z), 0.78));
      },
      styleAt: (s: number, th: number, pos: V3, _dir: V3, isJunc: boolean) => {
        const furrow = 0.84 + 0.16 * Math.sin(th * 7 + s * 5.0);
        const dampMoss = smoothstep(0.35, -0.05, pos.y);
        const bark = mixRgb(this.colBarkDeep, this.colBark, furrow);
        const col = mixRgb(bark, hexToLinearRgb('#2a361b'), dampMoss * 0.25);
        return {
          color: col,
          roughness: 0.86,
          translucency: 0.02,
          detailMetric: isJunc ? 0.98 : 0.35,
          anatomyLevel: 0,
          // Roots are anchored solidly into the earth: zero wind sway/scaling!
          wind: [0, 0, this.treePhase, 0],
          pivot: this.groundOrigin,
        };
      },
    };
    return stem;
  }

  /**
   * Continuous C^0 whole-tree cantilever flex: 0 at buttress roots -> progressive trunk bend ->
   * primary limb bend -> outer twig whip, all around a single `this.groundOrigin` + `this.treePhase`!
   */
  private evalWoodFlex(stem: WeldedStem, s: number, posHint?: V3): number {
    const m = this.meta.get(stem.id);
    const trunkY =
      stem.level === 0
        ? (posHint ?? sampleWeldedStem(stem, s).pos).y
        : (m?.limbRoot.nodes[0]?.pos.y ?? (posHint ?? sampleWeldedStem(stem, s).pos).y);
    const h01 = clamp((trunkY - this.groundOrigin.y) / this.treeHeightEst, 0, 1);
    const rootAnchor = smoothstep(0.06, 0.20, h01);
    const trunkFlex = rootAnchor * Math.pow(h01, 1.48) * 0.14 * this.p.windCompliance;
    if (stem.level === 0 || !m) return trunkFlex;
    const limbFrac = clamp((m.distFromLimb + s) / Math.max(1e-4, m.limbReach), 0, 1);
    const extraLimbFlex = Math.pow(limbFrac, 1.38) * 0.20 * this.p.windCompliance;
    return trunkFlex + extraLimbFlex;
  }

  private sampleGroundHeightAt(x: number, z: number, fallbackY: number): number {
    if (this.substrate.params.kind === 'none') return fallbackY;
    const halfSpan = Math.max(0.25, this.substrate.params.size * 1.15);
    const u = clamp(0.5 + x / (halfSpan * 2), 0.02, 0.98);
    const v = clamp(0.5 + z / (halfSpan * 2), 0.02, 0.98);
    return this.substrate.sampleSurface(u, v).pos.y;
  }

  private growTerrainRoot(
    stem: WeldedStem,
    origin: V3,
    dir0: V3,
    r0: number,
    totalLen: number,
    seed: number,
    groundOrigin: V3,
    isPrimary: boolean,
  ): void {
    const rng = new Random(seed);
    const nSteps = Math.max(8, Math.ceil(totalLen / clamp(0.24 * r0, 0.03, 0.14)));
    const stepLen = totalLen / nSteps;

    let pos = clone(origin);
    let dir = normalize(dir0);
    let right = projectOnPlane(cross(UP, dir), dir);
    if (lengthSq(right) < 1e-8) right = anyPerpendicular(dir);
    right = normalize(right);

    let horiz = normalize(v3(dir.x, 0, dir.z));
    if (lengthSq(horiz) < 1e-8) horiz = v3(1, 0, 0);
    const goalHoriz = clone(horiz);

    stem.nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s: 0 });
    let s = 0;

    // Optional dichotomous root fork at ~52% reach on primary roots
    const willFork = isPrimary && rng.next() < 0.42;
    const forkStep = willFork ? Math.floor(nSteps * rng.range(0.46, 0.60)) : -1;

    for (let i = 1; i <= nSteps; i++) {
      const t = i / nSteps;
      const rLocal = r0 * Math.pow(Math.max(0.02, 1 - t), 0.78);
      // Organic horizontal meander with gentle restoring spring toward radial sector (prevents neighbour cross-overs!)
      const wanderYaw = fbm3(pos.x * 1.4 + seed * 0.001, 0, pos.z * 1.4, 2) * 0.095;
      horiz = normalize(rotateAxis(horiz, UP, wanderYaw));
      horiz = normalize(lerp(horiz, goalHoriz, 0.16));

      const nextX = pos.x + horiz.x * stepLen;
      const nextZ = pos.z + horiz.z * stepLen;
      const gY = this.sampleGroundHeightAt(nextX, nextZ, groundOrigin.y);
      // Root emerges from trunk flare, rides half-exposed along ground, then dives underground after t = 0.76!
      const dive = smoothstep(0.74, 1.0, t) * (r0 * 2.2 + 0.12);
      const targetGroundY = gY + rLocal * 0.36 - dive;
      const blendToGround = smoothstep(0.06, 0.34, t);
      const nextY = lerp1(pos.y + dir.y * stepLen, targetGroundY, blendToGround * 0.55);

      const nextPos = v3(nextX, nextY, nextZ);
      const newDir = normalize(sub(nextPos, pos));
      right = projectOnPlane(right, newDir);
      if (lengthSq(right) < 1e-8) right = anyPerpendicular(newDir);
      right = normalize(right);

      s += length(sub(nextPos, pos));
      pos = nextPos;
      dir = newDir;
      stem.nodes.push({ pos: clone(pos), dir: clone(dir), right: clone(right), s });
      stem.length = s;

      if (i === forkStep && nSteps - i >= 4) {
        const remLen = totalLen - s;
        for (const side of [-1, 1]) {
          const yaw = side * rng.range(20, 32) * DEG2RAD;
          const fDir = normalize(rotateAxis(dir, UP, yaw));
          const fRad = rLocal * 0.76;
          const fChild = this.createRootStem(stem, fRad, remLen);
          fChild.attach = 'fork';
          fChild.attachDir = fDir;
          this.growTerrainRoot(fChild, pos, fDir, fRad, remLen, rng.nextUint32(), groundOrigin, false);
          stem.forks.push(fChild);
        }
        break;
      }
    }

    // Sprout welded lateral secondary roots along primary root
    if (isPrimary && this.p.rootLaterals > 0) {
      const nLat = Math.round(this.p.rootLaterals);
      for (let l = 0; l < nLat; l++) {
        const frac = 0.24 + ((l + 0.4) / Math.max(1, nLat)) * 0.44;
        const sLat = frac * stem.length;
        if (sLat <= r0 * 1.4 || sLat >= stem.length * 0.82) continue;
        const smp = sampleWeldedStem(stem, sLat);
        const rParent = stem.baseRadiusAt(sLat);
        const rLat = Math.max(this.meshCfg.minRadius * 2.2, rParent * 0.48);
        const side = l % 2 === 0 ? 1 : -1;
        const latHoriz = normalize(rotateAxis(v3(smp.dir.x, 0, smp.dir.z), UP, side * rng.range(48, 68) * DEG2RAD));
        const latDir = normalize(add(latHoriz, v3(0, -0.18, 0)));
        const latOrigin = addScaled(smp.pos, latHoriz, rParent);
        const latLen = Math.max(rLat * 7, (totalLen - sLat) * 0.58);

        const latStem = this.createRootStem(stem, rLat, latLen);
        latStem.minRing = 6;
        latStem.attachS = sLat;
        latStem.attachDir = latDir;
        latStem.regrow = (o: V3, d: V3) => {
          latStem.nodes = [];
          latStem.children = [];
          latStem.forks = [];
          latStem.length = 0;
          this.growTerrainRoot(latStem, o, d, rLat, latLen, rng.nextUint32(), groundOrigin, false);
        };
        latStem.regrow(latOrigin, latDir);
        stem.children.push(latStem);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sculpted 3D Cupped & Veined Botanical Canopy Leaves (Zero-Scaling Wind)
  // ---------------------------------------------------------------------------

  private recordLeavesOnSeg(
    stem: WeldedStem,
    seg: number,
    curveRes: number,
    segLength: number,
    startSeg: number,
    count: number,
    prevRot: { v: number },
  ): void {
    const m = this.meta.get(stem.id)!;
    const startOffset = startSeg * segLength;
    for (let b = 0; b < count; b++) {
      const offset = (b + 0.5) / Math.max(1, count);
      const stemOffset = ((seg - 1 + offset) / curveRes) * m.logicalLength;
      const sLocal = stemOffset - startOffset;
      if (sLocal <= 0 || sLocal > stem.length) continue;
      prevRot.v = (prevRot.v + 137.5 + this.leafRng.uniform() * 18) % 360;
      const dAngle = 38 + this.leafRng.uniform() * 22;
      this.leafPlacements.push({
        stem,
        sLocal,
        rAngleDeg: prevRot.v,
        dAngleDeg: dAngle,
        leafScale: this.p.leafSize * this.leafRng.range(0.82, 1.18),
        hueJitter: this.leafRng.uniform(),
      });
    }
  }

  private emitCanopyLeaves(mesh: PartMesh, tier: number): number {
    const colBase = hexToLinearRgb(this.p.hueLeaf);
    const colTip = hexToLinearRgb(this.p.hueLeafTip);
    const colPetiole = mixRgb(colBase, this.colBarkUpper, 0.45);
    const aspect = this.prof.leafAspect;
    const isOak = this.p.species === 'english_oak';
    const isMaple = this.p.species === 'japanese_maple';
    const uRows = tier >= 3 ? 4 : 3;

    let count = 0;
    const isDroppedChain = (st: WeldedStem): boolean => {
      let c: WeldedStem | null = st;
      while (c) {
        if (c.dropped) return true;
        c = c.parent;
      }
      return false;
    };

    for (const lp of this.leafPlacements) {
      if (isDroppedChain(lp.stem)) continue;
      const s = clamp(lp.sLocal, 0, lp.stem.length);
      const smp = sampleWeldedStem(lp.stem, s);
      const right = normalize(rotateAxis(smp.right, smp.dir, lp.rAngleDeg * DEG2RAD));
      const dir = normalize(rotateAxis(smp.dir, right, -lp.dAngleDeg * DEG2RAD));
      let radial = projectOnPlane(dir, smp.dir);
      if (lengthSq(radial) < 1e-8) radial = right;
      radial = normalize(radial);

      const rTwig = lp.stem.baseRadiusAt(s);
      const basePos = addScaled(smp.pos, radial, rTwig * 0.88);
      let leafRight = cross(UP, dir);
      if (lengthSq(leafRight) < 1e-6) leafRight = right;
      leafRight = normalize(leafRight);
      const normal = normalize(cross(dir, leafRight));

      // Evaluate exact parent wood flex at attachment (`u = 0` matches the twig vertex with 0.000 mm drift!)
      const h01 = clamp((basePos.y - this.groundOrigin.y) / this.treeHeightEst, 0, 1);
      const attachFlex = this.evalWoodFlex(lp.stem, s, smp.pos);
      const pivot = this.groundOrigin;

      const L = lp.leafScale;
      const W = L * aspect * 0.5;
      const leafTint = mixRgb(colBase, colTip, clamp(0.5 + lp.hueJitter * 0.35, 0.1, 0.95));

      // Build a sculpted 3-column x (uRows+1) cupped & lobed 3D leaf quad strip!
      const grid: number[][] = [];
      for (let i = 0; i <= uRows; i++) {
        const u = i / uRows;
        const rowFlex = attachFlex + 0.028 * u * u * this.p.windCompliance;
        const rowFlutter = 0.20 * u * u * this.p.windCompliance;
        const leafWind: [number, number, number, number] = [h01, rowFlex, this.treePhase, rowFlutter];
        const arch = -Math.pow(u, 1.65) * L * 0.16;
        const spinePt = add(addScaled(basePos, dir, u * L), scale(normal, arch));
        let wProfile = Math.sin(Math.PI * Math.pow(u, 0.72));
        if (isOak) {
          wProfile *= 0.76 + 0.24 * Math.abs(Math.sin(u * Math.PI * 3.5));
        } else if (isMaple) {
          wProfile *= 0.68 + 0.36 * Math.abs(Math.sin(u * Math.PI * 2.5));
        }
        const hw = Math.max(L * 0.03, W * wProfile);
        const cup = hw * 0.18;

        const rowCol = u < 0.12 ? colPetiole : mixRgb(colBase, leafTint, smoothstep(0.08, 0.88, u));
        const row: number[] = [];
        for (const side of [-1, 0, 1]) {
          const p = add(
            spinePt,
            add(scale(leafRight, side * hw), scale(normal, Math.abs(side) * cup)),
          );
          const n = normalize(add(normal, scale(leafRight, -side * 0.24)));
          row.push(
            mesh.addVertex({
              x: p.x,
              y: p.y,
              z: p.z,
              nx: n.x,
              ny: n.y,
              nz: n.z,
              tx: dir.x,
              ty: dir.y,
              tz: dir.z,
              u: side * 0.5 + 0.5,
              v: u,
              color: side === 0 ? mixRgb(rowCol, colTip, 0.18) : rowCol,
              wind: leafWind,
              pivot,
              roughness: 0.42,
              translucency: 0.62,
              detailMetric: side === 0 ? 0.9 : 0.38,
              anatomyLevel: 5,
            }),
          );
        }
        grid.push(row);
      }

      for (let i = 0; i < uRows; i++) {
        mesh.addQuad(grid[i][0], grid[i][1], grid[i + 1][1], grid[i + 1][0]);
        mesh.addQuad(grid[i][1], grid[i][2], grid[i + 1][2], grid[i + 1][1]);
      }
      count++;
    }
    mesh.hasExplicitNormals = true;
    return count;
  }
}

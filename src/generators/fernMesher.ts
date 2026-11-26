/**
 * Ultra-Realistic High-Poly 3D Fern & Vascular Plant Mesher.
 *
 * Every organ is true 3D geometry (never alpha-textured billboard cards):
 *   - Sculpted rhizome / tree-fern caudex clothed in 3D papery ramenta scales
 *   - Circinate coiled crosiers (fiddleheads) with logarithmic spiral curvature
 *   - Grooved stipes & arching rachises (adaxial U-sulcus cross-section)
 *   - High-resolution 3D veined laminae with:
 *       * True double-sided physical thickness on hero blades & sword pinnae
 *       * Extruded abaxial costa (midrib) & adaxial groove
 *       * Herringbone, arched, or dichotomous 3D lateral secondary veins
 *       * Inter-vein mesophyll bullation (quilted living tissue)
 *       * True serrated / auricled / lobed / fenestrated margins
 *   - 3D hemispherical abaxial sori (sporangia clusters) on fertile fronds
 *
 * Emits structured Outliner sub-parts so individual Fronds, Crosiers, Rhizome,
 * and Sori can be inspected, hidden, or soloed in the 3D Viewport.
 */

import {
  CurveFrame,
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
import { HostSubstrate } from '../substrates/substrate';
import { FernParams } from './fernParams';

export interface FernStats {
  fronds: number;
  crosiers: number;
  leaflets: number;
  soriClusters: number;
  scales: number;
  height: number;
}

export interface FernBuildResult {
  parts: PartMesh[];
  stats: FernStats;
}

interface LaminaSpec {
  origin: V3;
  dir: V3;
  right: V3;
  up: V3;
  length: number;
  halfWidth: number;
  /** +1 or -1 side on rachis (controls acroscopic auricle lobe). */
  rachisSide: number;
  colsHalf: number;
  rows: number;
  thick: boolean;
  thickness: number;
  auricle: number;
  serrationDepth: number;
  serrationCount: number;
  midribRelief: number;
  veinRelief: number;
  veinCount: number;
  bullation: number;
  camber: number;
  undulation: number;
  tipCurl: number;
  droopRad: number;
  falcateRad: number;
  fanMode: boolean;
  fenestrated: boolean;
  hostaMode: boolean;
  calatheaMode: boolean;
  ageFactor: number; // 0 = young inner, 1 = old outer
  phase: number;
  pivot: V3;
  baseFlex?: number;
  flexSpan?: number;
  plantHeightEst: number;
  colBase: RGB;
  colYoung: RGB;
  colVein: RGB;
  colSenescent: RGB;
  senescence: number;
  soriMesh: PartMesh | null;
  soriCoverage: number;
  soriRadius: number;
  soriColor: RGB;
  rng: Random;
}

export class FernMesher {
  private readonly p: FernParams;
  private readonly rng: Random;
  private readonly substrate: HostSubstrate | null;
  private readonly plantPhase: number;
  private crownPivot: V3 = v3(0, 0, 0);
  private caudexTopFlex = 0.03;
  private stats: FernStats = { fronds: 0, crosiers: 0, leaflets: 0, soriClusters: 0, scales: 0, height: 0.5 };

  constructor(params: FernParams, seed: number, substrate: HostSubstrate | null = null) {
    this.p = params;
    this.rng = new Random((seed ^ 0x4f3ea913) >>> 0);
    this.substrate = substrate;
    this.plantPhase = 0.08 + (((seed >>> 0) % 997) / 997) * 0.05;
  }

  build(layerId: string): FernBuildResult {
    const p = this.p;
    const parts: PartMesh[] = [];

    const colBase = hexToLinearRgb(p.hueBase);
    const colYoung = hexToLinearRgb(p.hueYoung);
    const colStipe = hexToLinearRgb(p.hueStipe);
    const colVein = mixRgb(colYoung, hexToLinearRgb('#bfd876'), 0.36);
    const colSenescent = hexToLinearRgb('#7a5b28');
    const colSori = hexToLinearRgb('#6e3616');
    const colScale = hexToLinearRgb('#5c381f');

    // Find anchor on substrate top
    let crownBase = v3(0, 0, 0);
    if (this.substrate && this.substrate.params.kind !== 'none') {
      const topSample = this.findSubstrateCrownPoint();
      crownBase = addScaled(topSample.pos, topSample.normal, -0.008);
    }
    this.crownPivot = crownBase;
    this.caudexTopFlex = p.architecture === 'tree_fern' ? 0.14 : 0.025;

    const tier = clamp(Math.round(p.detailTier), 1, 4);
    const plantHeightEst = Math.max(0.18, p.caudexHeight + p.frondLength * 0.85);

    // 1. Rhizome / Caudex & Ramenta Scales
    const rhizomeMesh = new PartMesh(
      `${layerId}:rhizome`,
      p.architecture === 'tree_fern' ? 'Fibrous Caudex & Mantle' : 'Rhizome Crown & Ramenta',
      'botanical',
      layerId,
      'roots',
      '#a87446',
    );
    const crownApex = this.buildRhizomeAndScales(rhizomeMesh, crownBase, colStipe, colScale, plantHeightEst, tier);
    parts.push(rhizomeMesh);

    // 2. Coiled Crosiers (Fiddleheads) at Crown Apex
    if (p.crosierCount > 0 && p.architecture !== 'broadleaf_rosette') {
      const crosierMesh = new PartMesh(
        `${layerId}:crosiers`,
        `Crosier Fiddleheads (${Math.round(p.crosierCount)})`,
        'botanical',
        layerId,
        'sprout',
        '#8fd15a',
      );
      this.buildCrosiers(crosierMesh, crownApex, colYoung, colStipe, colScale, plantHeightEst, tier);
      crosierMesh.metaLabel = `${Math.round(p.crosierCount)} coils`;
      parts.push(crosierMesh);
    }

    // 3. Optional Central Fertile Spore Fronds (Ostrich Fern Matteuccia dimorphism!)
    const soriMesh = new PartMesh(
      `${layerId}:sori`,
      'Abaxial Sori (Sporangia)',
      'botanical',
      layerId,
      'scatter',
      '#d47b39',
    );

    if (p.architecture === 'shuttlecock_ostrich') {
      const fertileMesh = new PartMesh(
        `${layerId}:fertile_fronds`,
        'Fertile Spore Plumes',
        'botanical',
        layerId,
        'wheat',
        '#9c5d32',
      );
      this.buildOstrichFertilePlumes(fertileMesh, crownApex, colSori, colStipe, plantHeightEst, tier);
      fertileMesh.metaLabel = `4 plumes`;
      parts.push(fertileMesh);
    }

    // 4. Mature & Young Fronds / Broadleaf Blades (each individual frond or cohort is a real Outliner node!)
    const frondGroupId = `${layerId}:fronds`;
    const frondGroupHeader = new PartMesh(
      frondGroupId,
      p.architecture === 'broadleaf_rosette' ? `Foliage Rosette (${Math.round(p.frondCount)})` : `Fronds (${Math.round(p.frondCount)})`,
      'botanical',
      layerId,
      'leaf',
      '#34c759',
    );
    frondGroupHeader.metaLabel = `${Math.round(p.frondCount)} stems`;
    parts.push(frondGroupHeader);

    const nFronds = Math.max(1, Math.round(p.frondCount));
    const azOffset = this.rng.range(0, TAU);

    for (let fIdx = 0; fIdx < nFronds; fIdx++) {
      // fIdx = 0 is innermost youngest frond, fIdx = nFronds-1 is outermost mature frond
      const age01 = nFronds === 1 ? 0.35 : fIdx / (nFronds - 1);
      const frondRng = this.rng.fork(0x1700 + fIdx * 97);
      const frondNum = String(fIdx + 1).padStart(2, '0');
      const cohortTag = age01 < 0.28 ? 'Inner' : age01 < 0.72 ? 'Mid' : 'Outer';
      const fMesh = new PartMesh(
        `${frondGroupId}:f${frondNum}`,
        p.architecture === 'broadleaf_rosette' ? `Blade ${frondNum} · ${cohortTag}` : `Frond ${frondNum} · ${cohortTag}`,
        'botanical',
        frondGroupId,
        'leaf',
        age01 < 0.28 ? '#8fd15a' : '#34c759',
      );

      const az = azOffset + fIdx * GOLDEN_ANGLE + frondRng.uniform() * 0.14;
      const radialR = p.crownRadius * (0.28 + 0.72 * Math.sqrt(age01));
      const startPos = v3(
        crownApex.x + Math.cos(az) * radialR,
        crownApex.y - age01 * Math.min(0.028, p.caudexHeight * 0.18),
        crownApex.z + Math.sin(az) * radialR,
      );

      if (p.architecture === 'broadleaf_rosette') {
        this.buildBroadleafStemAndBlade(
          fMesh,
          startPos,
          az,
          age01,
          frondRng,
          colBase,
          colYoung,
          colVein,
          colStipe,
          colSenescent,
          plantHeightEst,
          tier,
        );
      } else if (p.architecture === 'maidenhair_fan') {
        this.buildMaidenhairFrond(
          fMesh,
          soriMesh,
          startPos,
          az,
          age01,
          frondRng,
          colBase,
          colYoung,
          colVein,
          colStipe,
          colSenescent,
          colSori,
          plantHeightEst,
          tier,
        );
      } else {
        this.buildPinnateOrBipinnateFrond(
          fMesh,
          soriMesh,
          startPos,
          az,
          age01,
          frondRng,
          colBase,
          colYoung,
          colVein,
          colStipe,
          colSenescent,
          colSori,
          colScale,
          plantHeightEst,
          tier,
        );
      }

      fMesh.metaLabel = `${(fMesh.renderedTriangles / 1000).toFixed(1)}k tris`;
      parts.push(fMesh);
      this.stats.fronds++;
    }

    if (soriMesh.faceCount > 0) {
      soriMesh.metaLabel = `${this.stats.soriClusters} sori`;
      parts.push(soriMesh);
    }

    rhizomeMesh.metaLabel = `${this.stats.scales} scales`;

    // Normalise height & wind across all parts
    let maxY = 0.05;
    let minY = Infinity;
    for (const part of parts) {
      const pos = part.positions;
      for (let i = 1; i < pos.length; i += 3) {
        if (pos[i] > maxY) maxY = pos[i];
        if (pos[i] < minY) minY = pos[i];
      }
    }
    const spanY = Math.max(0.08, maxY - Math.min(0, minY));
    for (const part of parts) {
      const pos = part.positions;
      const w = part.wind;
      for (let i = 0, vi = 0; i < pos.length; i += 3, vi += 4) {
        w[vi] = saturate(pos[i + 1] / spanY);
      }
    }
    this.stats.height = maxY;
    return { parts, stats: this.stats };
  }

  private findSubstrateCrownPoint(): { pos: V3; normal: V3 } {
    const sub = this.substrate!;
    const kind = sub.params.kind;
    if (kind === 'boulder') return sub.sampleSurface(0.22, 0.16);
    if (kind === 'nurse_log') return sub.sampleSurface(0.48, 0.5);
    return sub.sampleSurface(0.5, 0.5);
  }

  // ---------------------------------------------------------------------------
  // Rhizome / Caudex + Chaffy Ramenta Scales
  // ---------------------------------------------------------------------------

  private buildRhizomeAndScales(
    mesh: PartMesh,
    base: V3,
    colStipe: RGB,
    colScale: RGB,
    plantH: number,
    tier: number,
  ): V3 {
    const p = this.p;
    const rng = this.rng.fork(0x991);
    const H = Math.max(0.025, p.caudexHeight);
    const R0 = Math.max(0.018, p.crownRadius * (p.architecture === 'tree_fern' ? 1.35 : 1.05));
    const rings = p.architecture === 'tree_fern' ? 16 + tier * 6 : 8 + tier * 2;
    const sides = p.architecture === 'tree_fern' ? 18 + tier * 4 : 14 + tier * 2;
    const sink = 0.018;

    const ringIndices: number[][] = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const y = base.y - sink + t * (H + sink);
      const flare = p.architecture === 'tree_fern' ? 1.28 - 0.32 * Math.sin(t * 2.3) : 1.15 - 0.25 * t * t;
      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const n = fbm3(Math.cos(th) * 2.5, t * 5.2, Math.sin(th) * 2.5, 713, 3);
        const rad = R0 * flare * (1 + 0.18 * n);
        const px = base.x + Math.cos(th) * rad;
        const pz = base.z + Math.sin(th) * rad;
        const col = mixRgb(colStipe, colScale, saturate(0.3 + 0.5 * n + 0.25 * t));
        row.push(
          mesh.addVertex({
            x: px,
            y,
            z: pz,
            u: j / sides,
            v: t,
            color: col,
            wind: [saturate(y / plantH), this.caudexTopFlex * t * t, this.plantPhase, 0],
            pivot: base,
            roughness: 0.9,
            translucency: 0.04,
            detailMetric: saturate(0.5 + n * 0.5),
            anatomyLevel: 0,
          }),
        );
      }
      ringIndices.push(row);
    }

    for (let r = 0; r < rings; r++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(ringIndices[r][j], ringIndices[r][j1], ringIndices[r + 1][j1], ringIndices[r + 1][j]);
      }
    }
    // Cap top of crown dome
    const apex = v3(base.x, base.y + H, base.z);
    const topCenter = mesh.addVertex({
      x: apex.x,
      y: apex.y + R0 * 0.12,
      z: apex.z,
      u: 0.5,
      v: 1,
      color: colStipe,
      wind: [saturate(apex.y / plantH), this.caudexTopFlex, this.plantPhase, 0],
      pivot: base,
      roughness: 0.92,
      translucency: 0.02,
      detailMetric: 0.2,
      anatomyLevel: 0,
    });
    const topRing = ringIndices[rings];
    for (let j = 0; j < sides; j++) {
      mesh.addTri(topRing[j], topRing[(j + 1) % sides], topCenter);
    }

    // Add 3D papery ramenta scales around crown & caudex
    const nScales = Math.round(p.ramentaDensity * (p.architecture === 'tree_fern' ? 140 : 52) * (0.6 + 0.25 * tier));
    for (let k = 0; k < nScales; k++) {
      const t = p.architecture === 'tree_fern' ? Math.pow(rng.next(), 0.7) : 0.35 + 0.65 * rng.next();
      const az = k * GOLDEN_ANGLE + rng.uniform() * 0.2;
      const rad = R0 * (1.05 - 0.12 * t);
      const pos = v3(base.x + Math.cos(az) * rad, base.y + t * H, base.z + Math.sin(az) * rad);
      const outDir = v3(Math.cos(az), 0.55 + rng.range(0, 0.5), Math.sin(az));
      const d = normalize(outDir);
      const rAxis = normalize(cross(UP, d));
      const sLen = (p.architecture === 'tree_fern' ? 0.028 : 0.016) * rng.range(0.7, 1.35);
      const sWid = sLen * 0.26;
      this.addScaleStrip(
        mesh,
        pos,
        d,
        rAxis,
        sLen,
        sWid,
        mixRgb(colScale, hexToLinearRgb('#9c6938'), rng.range(0, 0.55)),
        base,
        plantH,
        this.caudexTopFlex * t * t,
        this.plantPhase,
      );
      this.stats.scales++;
    }

    return apex;
  }

  private addScaleStrip(
    mesh: PartMesh,
    origin: V3,
    dir: V3,
    right: V3,
    len: number,
    halfWid: number,
    col: RGB,
    pivot: V3,
    plantH: number,
    baseFlex = 0.04,
    phase = 0.1,
  ): void {
    const up = normalize(cross(dir, right));
    const segs = 3;
    const rows: number[][] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = halfWid * (1 - t * t) * (1 - 0.25 * t);
      const curl = t * t * len * 0.28;
      const cPos = add(addScaled(origin, dir, t * len), scale(up, curl));
      const flex = baseFlex + 0.015 * t * t;
      if (i === segs) {
        const tip = mesh.addVertex({
          x: cPos.x, y: cPos.y, z: cPos.z,
          u: 0.5, v: 1, color: mixRgb(col, hexToLinearRgb('#c9935b'), 0.35),
          wind: [saturate(cPos.y / plantH), flex, phase, 0.06 * t * t],
          pivot, roughness: 0.72, translucency: 0.35, detailMetric: t, anatomyLevel: 0,
        });
        rows.push([tip]);
      } else {
        const l = mesh.addVertex({
          x: cPos.x - right.x * w, y: cPos.y - right.y * w, z: cPos.z - right.z * w,
          u: 0, v: t, color: col,
          wind: [saturate(cPos.y / plantH), flex, phase, 0.04 * t * t],
          pivot, roughness: 0.75, translucency: 0.3, detailMetric: t, anatomyLevel: 0,
        });
        const r = mesh.addVertex({
          x: cPos.x + right.x * w, y: cPos.y + right.y * w, z: cPos.z + right.z * w,
          u: 1, v: t, color: col,
          wind: [saturate(cPos.y / plantH), flex, phase, 0.04 * t * t],
          pivot, roughness: 0.75, translucency: 0.3, detailMetric: t, anatomyLevel: 0,
        });
        rows.push([l, r]);
      }
    }
    for (let i = 0; i < segs - 1; i++) {
      mesh.addQuad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
    }
    mesh.addTri(rows[segs - 1][0], rows[segs - 1][1], rows[segs][0]);
  }

  // ---------------------------------------------------------------------------
  // Coiled Crosiers (Fiddleheads — Circinate Vernation)
  // ---------------------------------------------------------------------------

  private buildCrosiers(
    mesh: PartMesh,
    crownApex: V3,
    colYoung: RGB,
    colStipe: RGB,
    colScale: RGB,
    plantH: number,
    tier: number,
  ): void {
    const p = this.p;
    const rng = this.rng.fork(0x2277);
    const n = Math.round(p.crosierCount);
    for (let c = 0; c < n; c++) {
      const az = c * GOLDEN_ANGLE + 0.9 + rng.uniform() * 0.25;
      const radOff = p.crownRadius * 0.22 * Math.sqrt((c + 0.4) / n);
      const origin = v3(crownApex.x + Math.cos(az) * radOff, crownApex.y, crownApex.z + Math.sin(az) * radOff);
      const outHoriz = v3(Math.cos(az), 0, Math.sin(az));
      const right0 = normalize(cross(UP, outHoriz));
      const dir0 = normalize(addScaled(UP, outHoriz, 0.16 + 0.08 * rng.next()));

      const L = p.crosierHeight * rng.range(0.75, 1.2) * (0.7 + 0.3 * (c / Math.max(1, n)));
      const totalCoilRad = p.crosierTurns * TAU;
      const steps = 38 + tier * 12;

      // Integrate progressive circinate spiral pitch!
      const angleAt = (t: number): number => {
        const stemBend = 0.22 * t;
        const coilT = smoothstep(0.34, 1.0, t);
        return stemBend + totalCoilRad * Math.pow(coilT, 2.25);
      };

      const line = growCurve(origin, dir0, right0, L, steps, (t0, t1) => ({
        pitch: angleAt(t1) - angleAt(t0),
        yaw: Math.sin(t1 * 6) * 0.004,
      }));

      const rBase = p.stipeRadius * 0.92;
      const cPhase = (this.plantPhase + c * 0.015) % 1;
      const cPivot = this.crownPivot;
      this.meshGroovedRachis(mesh, line, rBase, rBase * 0.22, 8 + tier * 2, colStipe, colYoung, cPivot, plantH, cPhase, 3, this.caudexTopFlex, 0.36);

      // Add tiny folded embryonic pinna buds & golden ramenta along the coiled head!
      const budCount = 16 + tier * 6;
      for (let b = 0; b < budCount; b++) {
        const tb = 0.36 + 0.62 * (b / budCount);
        const fr = line.atT(tb);
        const side = b % 2 === 0 ? 1 : -1;
        const budDir = normalize(add(addScaled(fr.dir, fr.right, side * 0.48), scale(fr.up, -0.35)));
        const bLen = p.stipeRadius * (4.2 - 2.6 * tb);
        this.addScaleStrip(
          mesh,
          addScaled(fr.pos, fr.right, side * rBase * (1 - 0.6 * tb)),
          budDir,
          fr.up,
          bLen,
          bLen * 0.38,
          mixRgb(colYoung, colScale, 0.28 * (1 - tb)),
          cPivot,
          plantH,
          this.caudexTopFlex + Math.pow(tb, 1.45) * 0.36,
          cPhase,
        );
      }
      this.stats.crosiers++;
    }
  }

  // ---------------------------------------------------------------------------
  // Ostrich Fern Central Fertile Spore Plumes (Matteuccia dimorphism)
  // ---------------------------------------------------------------------------

  private buildOstrichFertilePlumes(
    mesh: PartMesh,
    crownApex: V3,
    colSori: RGB,
    colStipe: RGB,
    plantH: number,
    tier: number,
  ): void {
    const p = this.p;
    const rng = this.rng.fork(0x5512);
    const count = 4;
    for (let k = 0; k < count; k++) {
      const az = k * GOLDEN_ANGLE + 0.42;
      const origin = v3(crownApex.x + Math.cos(az) * p.crownRadius * 0.28, crownApex.y, crownApex.z + Math.sin(az) * p.crownRadius * 0.28);
      const out = v3(Math.cos(az), 0, Math.sin(az));
      const right = normalize(cross(UP, out));
      const dir = normalize(addScaled(UP, out, 0.14 + rng.range(0, 0.08)));
      const L = p.frondLength * 0.52 * rng.range(0.9, 1.08);
      const line = growCurve(origin, dir, right, L, 24, (t0, t1) => ({
        gravity: (t1 - t0) * 0.18,
        yaw: Math.sin(t1 * 7 + k) * 0.008,
      }));
      const plumePhase = (this.plantPhase + k * 0.015) % 1;
      const cPivot = this.crownPivot;
      this.meshGroovedRachis(mesh, line, p.stipeRadius * 0.85, p.stipeRadius * 0.25, 8, colStipe, colSori, cPivot, plantH, plumePhase, 4, this.caudexTopFlex, 0.42);
      // Erect beaded spore-bearing pinnae tightly ascending along upper 60% of plume
      const pairs = 22 + tier * 4;
      for (let i = 0; i < pairs; i++) {
        const u = 0.35 + 0.63 * (i / pairs);
        const env = Math.sin(Math.pow((u - 0.35) / 0.65, 0.75) * Math.PI);
        const attachFlex = this.caudexTopFlex + Math.pow(u, 1.45) * 0.42;
        for (const side of [-1, 1]) {
          const fr = line.atT(u);
          const pDir = normalize(add(scale(fr.dir, 0.84), addScaled(scale(fr.right, side * 0.48), fr.up, 0.22)));
          const pLen = p.frondWidth * 0.36 * (0.25 + 0.75 * env);
          const subLine = growCurve(fr.pos, pDir, fr.up, pLen, 6, (a0, a1) => ({ pitch: (a1 - a0) * 0.22 }));
          this.meshBeadedSporePinna(mesh, subLine, p.stipeRadius * 0.55, colSori, cPivot, plantH, attachFlex, plumePhase);
        }
      }
    }
  }

  private meshBeadedSporePinna(
    mesh: PartMesh,
    line: CurveLine,
    r0: number,
    col: RGB,
    pivot: V3,
    plantH: number,
    baseFlex = 0.2,
    phase = 0.1,
  ): void {
    const sides = 6;
    const steps = 7;
    const rings: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const fr = line.atT(t);
      const bead = 1 + 0.38 * Math.sin(t * Math.PI * 6);
      const r = r0 * bead * (1 - 0.65 * t * t);
      const row: number[] = [];
      for (let j = 0; j < sides; j++) {
        const th = (j / sides) * TAU;
        const off = add(scale(fr.right, Math.cos(th) * r), scale(fr.up, Math.sin(th) * r));
        const pt = add(fr.pos, off);
        row.push(
          mesh.addVertex({
            x: pt.x, y: pt.y, z: pt.z,
            u: j / sides, v: t,
            color: mixRgb(col, hexToLinearRgb('#3d1c0a'), 0.35 * (1 - bead * 0.5)),
            wind: [saturate(pt.y / plantH), baseFlex + 0.10 * Math.pow(t, 1.45), phase, 0.08 * t * t],
            pivot, roughness: 0.68, translucency: 0.08, detailMetric: bead * 0.5, anatomyLevel: 4,
          }),
        );
      }
      rings.push(row);
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        mesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 1-Pinnate, 2-Pinnate Lacy, Shuttlecock & Tree Fern Fronds
  // ---------------------------------------------------------------------------

  private buildPinnateOrBipinnateFrond(
    mesh: PartMesh,
    soriMesh: PartMesh,
    origin: V3,
    az: number,
    age01: number,
    rng: Random,
    colBase: RGB,
    colYoung: RGB,
    colVein: RGB,
    colStipe: RGB,
    colSenescent: RGB,
    colSori: RGB,
    colScale: RGB,
    plantH: number,
    tier: number,
  ): void {
    const p = this.p;
    const outHoriz = v3(Math.cos(az), 0, Math.sin(az));
    // right0 is horizontal perpendicular to radial plane -> `up = cross(dir, right)` is the adaxial upper frond face!
    const right0 = normalize(cross(UP, outHoriz));

    // Inner fronds stand steeper, outer fronds arch wider
    const tiltDeg = p.rosetteAngle * lerp1(0.52, 1.28, age01) + rng.vary(0, 4.5);
    const tiltRad = clamp(tiltDeg, 6, 84) * DEG2RAD;
    const dir0 = normalize(add(scale(UP, Math.cos(tiltRad)), scale(outHoriz, Math.sin(tiltRad))));

    const L = p.frondLength * lerp1(0.76, 1.06, Math.sin(age01 * Math.PI * 0.72 + 0.25)) * (1 + rng.vary(0, p.frondLengthVar));
    const droopRad = (p.archDroop * lerp1(0.58, 1.24, age01) + rng.vary(0, 7)) * DEG2RAD;
    const twistRad = rng.vary(0, p.rachisTwist) * DEG2RAD;
    const waveRad = p.rachisWave * DEG2RAD;
    const waveSeed = rng.next();
    const phase = (this.plantPhase + (((az / TAU) % 1 + 1) % 1) * 0.06) % 1;
    const fPivot = this.crownPivot;
    const fBaseFlex = this.caudexTopFlex;
    const rachisFlexSpan = 0.62;
    const evalRachisFlex = (t: number): number => fBaseFlex + Math.pow(t, 1.45) * rachisFlexSpan;

    const rachisSteps = 32 + tier * 8;
    const archAt = (t: number): number => droopRad * Math.pow(t, p.archPower);

    const rachis = growCurve(origin, dir0, right0, L, rachisSteps, (t0, t1, _curD, curP) => {
      let extraPitch = archAt(t1) - archAt(t0);
      // Gentle substrate clearance lift near ground
      if (curP.y < 0.04 && t0 > 0.4) extraPitch *= 0.35;
      return {
        pitch: extraPitch,
        yaw: (Math.sin(t1 * Math.PI * 2.2 + waveSeed * TAU) - Math.sin(t0 * Math.PI * 2.2 + waveSeed * TAU)) * waveRad,
        roll: (t1 - t0) * twistRad,
      };
    });

    // Mesh grooved stipe + rachis with adaxial sulcus!
    const stipeR = p.stipeRadius * lerp1(0.82, 1.1, age01);
    const rachisColTop = mixRgb(colYoung, colBase, saturate(age01 * 0.75));
    this.meshGroovedRachis(mesh, rachis, stipeR, stipeR * 0.16, 8 + tier * 2, colStipe, rachisColTop, fPivot, plantH, phase, 1, fBaseFlex, rachisFlexSpan);

    // Chaffy ramenta scales along the lower stipe!
    const stipeScales = Math.round(p.ramentaDensity * 18);
    for (let sc = 0; sc < stipeScales; sc++) {
      const ts = (sc / Math.max(1, stipeScales)) * p.stipeFraction * 1.15;
      const fr = rachis.atT(ts);
      const th = sc * GOLDEN_ANGLE;
      const radDir = normalize(add(scale(fr.right, Math.cos(th)), scale(fr.up, Math.sin(th))));
      const scDir = normalize(add(scale(fr.dir, 0.75), scale(radDir, 0.65)));
      const sLen = stipeR * rng.range(2.2, 4.2) * (1 - ts);
      this.addScaleStrip(
        mesh,
        addScaled(fr.pos, radDir, stipeR * 0.9),
        scDir,
        normalize(cross(fr.dir, radDir)),
        sLen,
        sLen * 0.28,
        colScale,
        fPivot,
        plantH,
        evalRachisFlex(ts),
        phase,
      );
      this.stats.scales++;
    }

    // Frond silhouette envelope along [stipeFraction .. 1.0]
    const s0 = clamp(p.stipeFraction, 0.05, 0.55);
    const nPairs = Math.max(4, Math.round(p.pinnaPairs * (tier === 1 ? 0.72 : 1)));
    const bipinnate = p.architecture === 'bipinnate_lacy' || p.architecture === 'tree_fern';
    const shuttlecock = p.architecture === 'shuttlecock_ostrich';

    const frondEnvelope = (u: number): number => {
      // u in [0, 1] along leafy portion of rachis
      if (shuttlecock) {
        // Ostrich fern: narrow tapered base, broad obovate-oblanceolate upper 72%, sudden acuminate tip!
        const rise = Math.pow(smoothstep(0, 0.76, u), 1.35);
        const fall = Math.pow(1 - smoothstep(0.72, 1.0, u), 0.78);
        return Math.max(0.06, 0.12 + 0.88 * rise * fall);
      }
      if (bipinnate) {
        // Elliptic-lanceolate lacy frond: widest around u = 0.32
        return Math.max(0.05, Math.pow(Math.sin(Math.pow(u, 0.68) * Math.PI), 0.78));
      }
      // Sword / Boston fern: linear-lanceolate, gentle basal taper, long graceful tip taper
      const baseTap = 0.42 + 0.58 * smoothstep(0.0, 0.22, u);
      const tipTap = Math.pow(1 - Math.pow(u, 1.65), 0.68);
      return Math.max(0.05, baseTap * tipTap);
    };

    //Tessellation resolution per leaflet
    const swordColsHalf = tier === 1 ? 3 : tier === 2 ? 4 : tier === 3 ? 5 : 8;
    const swordRows = tier === 1 ? 8 : tier === 2 ? 12 : tier === 3 ? 16 : 26;
    const pinnuleColsHalf = tier === 1 ? 2 : tier === 2 ? 2 : tier === 3 ? 3 : 4;
    const pinnuleRows = tier === 1 ? 5 : tier === 2 ? 7 : tier === 3 ? 9 : 13;

    const fertileFrond = p.soriCoverage > 0.02 && age01 > 0.22;

    for (let i = 0; i < nPairs; i++) {
      for (const side of [-1, 1]) {
        // Sub-opposite / alternate offset along rachis
        const altShift = side > 0 ? 0.22 / nPairs : -0.22 / nPairs;
        const uLeaf = clamp((i + 0.45) / nPairs + altShift, 0.005, 0.992);
        const tRachis = s0 + (1 - s0) * uLeaf;
        const fr = rachis.atT(tRachis);
        const rHere = lerp1(stipeR, stipeR * 0.16, tRachis);
        const env = frondEnvelope(uLeaf);
        const pinnaLen = Math.max(0.008, p.frondWidth * 0.5 * env * (1 + rng.vary(0, 0.06)));

        // Insertion angle sweeps more forward toward frond apex
        const insAngle = (p.pinnaAngle * lerp1(1.06, 0.56, uLeaf) + rng.vary(0, 3.5)) * DEG2RAD;
        const dihedral = (10 - 16 * age01 + 8 * (1 - uLeaf)) * DEG2RAD; // subtle V-lift of pinnae above rachis
        let pinnaDir = normalize(
          add(scale(fr.dir, Math.cos(insAngle)), scale(fr.right, side * Math.sin(insAngle))),
        );
        pinnaDir = rotateAxis(pinnaDir, fr.dir, side * dihedral);
        let pinnaRight = normalize(cross(fr.up, pinnaDir));
        // Ensure pinnaUp (`cross(pinnaDir, pinnaRight)`) points toward frond adaxial `fr.up`
        if (dot(cross(pinnaDir, pinnaRight), fr.up) < 0) pinnaRight = scale(pinnaRight, -1);
        const pinnaUp = normalize(cross(pinnaDir, pinnaRight));

        const attachPos = add(addScaled(fr.pos, fr.right, side * rHere * 0.78), scale(fr.up, rHere * 0.25));

        if (bipinnate && pinnaLen > 0.024 && uLeaf < 0.9) {
          // 2-Pinnate Architecture: Secondary Costa + High-Poly Serrated Pinnules!
          const costaDroop = (14 + 22 * age01) * DEG2RAD;
          const costa = growCurve(attachPos, pinnaDir, pinnaRight, pinnaLen, 12 + tier * 3, (a0, a1) => ({
            pitch: (a1 - a0) * costaDroop,
            yaw: side * (a1 - a0) * -0.14, // subtle forward falcate sweep of pinna!
          }));
          const costaR = Math.max(0.00045, rHere * 0.42);
          const rachisFlexHere = evalRachisFlex(tRachis);
          this.meshGroovedRachis(mesh, costa, costaR, costaR * 0.22, 6, rachisColTop, colYoung, fPivot, plantH, phase, 1, rachisFlexHere, 0.14);

          const subPairs = Math.max(4, Math.round(p.pinnulePairs * (0.45 + 0.65 * env) * (tier === 1 ? 0.7 : 1)));
          for (let sp = 0; sp < subPairs; sp++) {
            for (const subSide of [-1, 1]) {
              const uSub = clamp((sp + 0.4 + (subSide > 0 ? 0.18 : -0.18)) / subPairs, 0.03, 0.96);
              const cFr = costa.atT(uSub);
              const subEnv = Math.pow(Math.sin(Math.pow(uSub, 0.65) * Math.PI), 0.72);
              const pLen = Math.max(0.004, (pinnaLen / Math.max(4, subPairs)) * 2.25 * (0.35 + 0.75 * subEnv));
              const pHalfW = pLen * 0.34;
              const subAng = lerp1(66, 38, uSub) * DEG2RAD;
              const sDir = normalize(add(scale(cFr.dir, Math.cos(subAng)), scale(cFr.right, subSide * Math.sin(subAng))));
              let sRight = normalize(cross(cFr.up, sDir));
              if (dot(cross(sDir, sRight), cFr.up) < 0) sRight = scale(sRight, -1);
              const sUp = normalize(cross(sDir, sRight));

              this.meshVeinedLamina(mesh, {
                origin: addScaled(cFr.pos, cFr.right, subSide * costaR * 0.65),
                dir: sDir,
                right: sRight,
                up: sUp,
                length: pLen,
                halfWidth: pHalfW,
                rachisSide: subSide,
                colsHalf: pinnuleColsHalf,
                rows: pinnuleRows,
                thick: tier >= 4,
                thickness: p.laminaThicknessMm * 0.0005,
                auricle: p.auricle * 0.35,
                serrationDepth: p.serrationDepth * 1.35,
                serrationCount: Math.max(5, Math.round(p.serrationCount * 0.55)),
                midribRelief: p.midribRelief,
                veinRelief: p.veinRelief,
                veinCount: Math.max(4, Math.round(p.veinCount * 0.5)),
                bullation: p.bullation,
                camber: p.laminaCamber,
                undulation: p.edgeUndulation,
                tipCurl: p.tipCurl,
                droopRad: 0.22,
                falcateRad: -subSide * 0.14,
                fanMode: false,
                fenestrated: false,
                hostaMode: false,
                calatheaMode: false,
                ageFactor: saturate(age01 * 0.8 + uLeaf * 0.2),
                phase,
                pivot: fPivot,
                baseFlex: rachisFlexHere + Math.pow(uSub, 1.45) * 0.14,
                flexSpan: 0.05,
                plantHeightEst: plantH,
                colBase,
                colYoung,
                colVein,
                colSenescent,
                senescence: p.senescence,
                soriMesh: fertileFrond && uLeaf > 0.25 && uSub < 0.78 && sp % 2 === 0 ? soriMesh : null,
                soriCoverage: p.soriCoverage,
                soriRadius: p.soriSizeMm * 0.00045,
                soriColor: colSori,
                rng,
              });
            }
          }
          // Terminal pinna tip lobe
          const tipFr = costa.atT(0.96);
          this.meshVeinedLamina(mesh, {
            origin: tipFr.pos,
            dir: tipFr.dir,
            right: tipFr.right,
            up: tipFr.up,
            length: pinnaLen * 0.18,
            halfWidth: pinnaLen * 0.055,
            rachisSide: 1,
            colsHalf: pinnuleColsHalf,
            rows: pinnuleRows,
            thick: false,
            thickness: p.laminaThicknessMm * 0.0004,
            auricle: 0,
            serrationDepth: p.serrationDepth,
            serrationCount: 6,
            midribRelief: p.midribRelief,
            veinRelief: p.veinRelief,
            veinCount: 5,
            bullation: p.bullation,
            camber: p.laminaCamber,
            undulation: p.edgeUndulation,
            tipCurl: p.tipCurl,
            droopRad: 0.18,
            falcateRad: 0,
            fanMode: false,
            fenestrated: false,
            hostaMode: false,
            calatheaMode: false,
            ageFactor: age01 * 0.6,
            phase,
            pivot: fPivot,
            baseFlex: rachisFlexHere + Math.pow(0.96, 1.45) * 0.14,
            flexSpan: 0.05,
            plantHeightEst: plantH,
            colBase,
            colYoung,
            colVein,
            colSenescent,
            senescence: p.senescence,
            soriMesh: null,
            soriCoverage: 0,
            soriRadius: 0,
            soriColor: colSori,
            rng,
          });
        } else {
          // 1-Pinnate Sword / Boston / Ostrich Pinna: High-Poly Thick 3D Sculpted Pinna with Auricle & Sori!
          const pHalfW = Math.max(0.0025, (L * (1 - s0) / nPairs) * (shuttlecock ? 0.66 : 0.72) * (0.45 + 0.55 * env));
          const rachisFlexHere = evalRachisFlex(tRachis);
          this.meshVeinedLamina(mesh, {
            origin: attachPos,
            dir: pinnaDir,
            right: pinnaRight,
            up: pinnaUp,
            length: pinnaLen,
            halfWidth: pHalfW,
            rachisSide: side,
            colsHalf: swordColsHalf,
            rows: swordRows,
            thick: p.laminaThicknessMm > 0.08 && tier >= 2,
            thickness: p.laminaThicknessMm * 0.001,
            auricle: shuttlecock ? 0.05 : p.auricle,
            serrationDepth: shuttlecock ? Math.max(0.26, p.serrationDepth * 2.2) : p.serrationDepth,
            serrationCount: p.serrationCount,
            midribRelief: p.midribRelief,
            veinRelief: p.veinRelief,
            veinCount: p.veinCount,
            bullation: p.bullation,
            camber: p.laminaCamber,
            undulation: p.edgeUndulation,
            tipCurl: p.tipCurl,
            droopRad: (12 + 22 * age01) * DEG2RAD,
            falcateRad: -side * 0.18, // forward sword-like falcate curve!
            fanMode: false,
            fenestrated: false,
            hostaMode: false,
            calatheaMode: false,
            ageFactor: saturate(age01 * 0.8 + uLeaf * 0.2),
            phase,
            pivot: fPivot,
            baseFlex: rachisFlexHere,
            flexSpan: 0.12,
            plantHeightEst: plantH,
            colBase,
            colYoung,
            colVein,
            colSenescent,
            senescence: p.senescence,
            soriMesh: fertileFrond && !shuttlecock && uLeaf > 0.22 && uLeaf < 0.88 ? soriMesh : null,
            soriCoverage: p.soriCoverage,
            soriRadius: p.soriSizeMm * 0.0006,
            soriColor: colSori,
            rng,
          });
        }
      }
    }

    // Terminal apical pinna at tip of rachis — shares `fPivot` + `evalRachisFlex(0.985)` so frond tips whip fluidly!
    const tipF = rachis.atT(0.985);
    this.meshVeinedLamina(mesh, {
      origin: tipF.pos,
      dir: tipF.dir,
      right: tipF.right,
      up: tipF.up,
      length: Math.max(0.014, p.frondWidth * 0.18),
      halfWidth: Math.max(0.003, p.frondWidth * 0.042),
      rachisSide: 1,
      colsHalf: Math.max(3, swordColsHalf - 2),
      rows: Math.max(10, swordRows - 6),
      thick: tier >= 3,
      thickness: p.laminaThicknessMm * 0.0008,
      auricle: 0,
      serrationDepth: p.serrationDepth,
      serrationCount: 8,
      midribRelief: p.midribRelief,
      veinRelief: p.veinRelief,
      veinCount: 7,
      bullation: p.bullation,
      camber: p.laminaCamber,
      undulation: p.edgeUndulation,
      tipCurl: p.tipCurl,
      droopRad: 0.25,
      falcateRad: 0,
      fanMode: false,
      fenestrated: false,
      hostaMode: false,
      calatheaMode: false,
      ageFactor: age01 * 0.45,
      phase,
      pivot: fPivot,
      baseFlex: evalRachisFlex(0.985),
      flexSpan: 0.12,
      plantHeightEst: plantH,
      colBase,
      colYoung,
      colVein,
      colSenescent,
      senescence: p.senescence,
      soriMesh: null,
      soriCoverage: 0,
      soriRadius: 0,
      soriColor: colSori,
      rng,
    });
  }

  // ---------------------------------------------------------------------------
  // Maidenhair Fern (Adiantum — Glossy Ebony Stipes + Flabellate Fan Pinnules)
  // ---------------------------------------------------------------------------

  private buildMaidenhairFrond(
    mesh: PartMesh,
    soriMesh: PartMesh,
    origin: V3,
    az: number,
    age01: number,
    rng: Random,
    colBase: RGB,
    colYoung: RGB,
    colVein: RGB,
    colStipe: RGB,
    colSenescent: RGB,
    colSori: RGB,
    plantH: number,
    tier: number,
  ): void {
    const p = this.p;
    const out = v3(Math.cos(az), 0, Math.sin(az));
    const right0 = normalize(cross(UP, out));
    const tilt = (p.rosetteAngle * lerp1(0.6, 1.25, age01) + rng.vary(0, 6)) * DEG2RAD;
    const dir0 = normalize(add(scale(UP, Math.cos(tilt)), scale(out, Math.sin(tilt))));
    const L = p.frondLength * lerp1(0.72, 1.08, age01) * (1 + rng.vary(0, p.frondLengthVar));
    const droop = p.archDroop * DEG2RAD * lerp1(0.7, 1.2, age01);
    const phase = (this.plantPhase + (((az / TAU) % 1 + 1) % 1) * 0.06) % 1;
    const fPivot = this.crownPivot;
    const fBaseFlex = this.caudexTopFlex;
    const mainFlexSpan = 0.58;

    // Wiry zig-zagging glossy ebony rachis
    const rachis = growCurve(origin, dir0, right0, L, 28 + tier * 6, (t0, t1) => ({
      pitch: droop * (Math.pow(t1, p.archPower) - Math.pow(t0, p.archPower)),
      yaw: Math.sin(t1 * Math.PI * 9) * 0.045,
    }));
    this.meshGroovedRachis(mesh, rachis, p.stipeRadius * 0.72, p.stipeRadius * 0.15, 6 + tier * 2, colStipe, colStipe, fPivot, plantH, phase, 1, fBaseFlex, mainFlexSpan);

    const s0 = clamp(p.stipeFraction, 0.2, 0.55);
    const branches = Math.max(5, Math.round(p.pinnaPairs * 0.45));
    const colsHalf = tier === 1 ? 5 : tier === 2 ? 7 : tier === 3 ? 10 : 14;
    const rows = tier === 1 ? 8 : tier === 2 ? 12 : tier === 3 ? 16 : 22;

    for (let b = 0; b < branches; b++) {
      for (const side of [-1, 1]) {
        if (b % 2 === 0 && side < 0 && b > 0) continue; // alternate zig-zag pinnae!
        const u = clamp((b + (side > 0 ? 0.25 : 0.75)) / branches, 0.04, 0.96);
        const tMain = s0 + (1 - s0) * u;
        const fr = rachis.atT(tMain);
        const mainFlexHere = fBaseFlex + Math.pow(tMain, 1.45) * mainFlexSpan;
        const env = Math.sin(Math.pow(u, 0.65) * Math.PI);
        const brLen = p.frondWidth * 0.58 * (0.3 + 0.7 * env);
        const brDir = normalize(add(scale(fr.dir, 0.62), scale(fr.right, side * 0.78)));
        const brRight = normalize(cross(fr.up, brDir));
        const brLine = growCurve(fr.pos, brDir, brRight, brLen, 10, (a0, a1) => ({
          gravity: (a1 - a0) * 0.35,
          yaw: Math.sin(a1 * 12 + b) * 0.06,
        }));
        this.meshGroovedRachis(mesh, brLine, p.stipeRadius * 0.35, p.stipeRadius * 0.12, 6, colStipe, colStipe, fPivot, plantH, phase, 1, mainFlexHere, 0.14);

        const fans = Math.max(3, Math.round(p.pinnulePairs * 0.65 * (0.4 + 0.6 * env)));
        for (let k = 0; k <= fans; k++) {
          const uf = k / fans;
          const tBr = 0.16 + 0.84 * uf;
          const bf = brLine.atT(tBr);
          const fSide = k === fans ? 0 : k % 2 === 0 ? 1 : -1;
          const petDir =
            fSide === 0
              ? bf.dir
              : normalize(add(scale(bf.dir, 0.58), addScaled(scale(bf.right, fSide * 0.75), bf.up, -0.12)));
          let fRight = normalize(cross(bf.up, petDir));
          if (dot(cross(petDir, fRight), bf.up) < 0) fRight = scale(fRight, -1);
          const fUp = normalize(cross(petDir, fRight));
          // Delicate hair-thin black petiolule stalk
          const stalkLen = 0.006 + 0.005 * (1 - uf);
          const stalkEnd = addScaled(bf.pos, petDir, stalkLen);
          const fanLen = Math.max(0.011, 0.022 * (1 - 0.35 * uf) * rng.range(0.85, 1.18));

          this.meshVeinedLamina(mesh, {
            origin: stalkEnd,
            dir: petDir,
            right: fRight,
            up: fUp,
            length: fanLen,
            halfWidth: fanLen * 0.78,
            rachisSide: fSide || 1,
            colsHalf,
            rows,
            thick: tier >= 3,
            thickness: p.laminaThicknessMm * 0.0006,
            auricle: 0,
            serrationDepth: Math.max(0.11, p.serrationDepth),
            serrationCount: 6,
            midribRelief: p.midribRelief * 0.35,
            veinRelief: p.veinRelief * 1.15,
            veinCount: 12,
            bullation: p.bullation * 0.6,
            camber: 0.14,
            undulation: p.edgeUndulation * 1.2,
            tipCurl: p.tipCurl,
            droopRad: 0.28,
            falcateRad: 0,
            fanMode: true,
            fenestrated: false,
            hostaMode: false,
            calatheaMode: false,
            ageFactor: age01,
            phase,
            pivot: fPivot,
            baseFlex: mainFlexHere + Math.pow(tBr, 1.45) * 0.14,
            flexSpan: 0.07,
            plantHeightEst: plantH,
            colBase,
            colYoung,
            colVein,
            colSenescent,
            senescence: p.senescence,
            soriMesh: p.soriCoverage > 0.05 && age01 > 0.3 ? soriMesh : null,
            soriCoverage: p.soriCoverage,
            soriRadius: p.soriSizeMm * 0.0005,
            soriColor: colSori,
            rng,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sculpted Broadleaf Forest Plants (Hosta, Monstera, Calathea)
  // ---------------------------------------------------------------------------

  private buildBroadleafStemAndBlade(
    mesh: PartMesh,
    origin: V3,
    az: number,
    age01: number,
    rng: Random,
    colBase: RGB,
    colYoung: RGB,
    colVein: RGB,
    colStipe: RGB,
    colSenescent: RGB,
    plantH: number,
    tier: number,
  ): void {
    const p = this.p;
    const out = v3(Math.cos(az), 0, Math.sin(az));
    const right0 = normalize(cross(UP, out));
    const tilt = (p.rosetteAngle * lerp1(0.45, 1.28, age01) + rng.vary(0, 5)) * DEG2RAD;
    const dir0 = normalize(add(scale(UP, Math.cos(tilt)), scale(out, Math.sin(tilt))));
    const petioleL = p.frondLength * p.stipeFraction * lerp1(0.68, 1.15, age01);
    const bladeL = p.frondLength * (1 - p.stipeFraction) * lerp1(0.75, 1.08, age01) * (1 + rng.vary(0, p.frondLengthVar));
    const waveSeed = rng.next();
    const phase = (this.plantPhase + (((az / TAU) % 1 + 1) % 1) * 0.05) % 1;
    const fPivot = this.crownPivot;
    const petFlexStart = this.caudexTopFlex;
    const petFlexRange = 0.34;

    const petiole = growCurve(origin, dir0, right0, Math.max(0.04, petioleL), 18, (t0, t1) => ({
      pitch: (t1 - t0) * p.archDroop * 0.45 * DEG2RAD,
      yaw: Math.sin(t1 * 4 + waveSeed * TAU) * 0.02,
    }));
    const rPet = p.stipeRadius * 1.45;
    this.meshGroovedRachis(mesh, petiole, rPet, rPet * 0.65, 10 + tier * 2, colStipe, mixRgb(colBase, colYoung, 0.45), fPivot, plantH, phase, 1, petFlexStart, petFlexRange);

    const tip = petiole.atT(1.0);
    // Geniculum bend where petiole meets leaf lamina!
    const genicRad = p.archDroop * 0.55 * DEG2RAD;
    const bladeDir = rotateAxis(tip.dir, tip.right, genicRad);
    const bladeUp = normalize(cross(bladeDir, tip.right));

    const colsHalf = tier === 1 ? 12 : tier === 2 ? 18 : tier === 3 ? 26 : 36;
    const rows = tier === 1 ? 22 : tier === 2 ? 34 : tier === 3 ? 48 : 68;

    const fenestrated = p.broadleafPlaced === 'monstera_fenestrated' && age01 > 0.16;
    const hostaMode = p.broadleafPlaced === 'hosta_bullate';
    const calatheaMode = p.broadleafPlaced === 'calathea_pleated';

    this.meshVeinedLamina(mesh, {
      origin: tip.pos,
      dir: bladeDir,
      right: tip.right,
      up: bladeUp,
      length: bladeL,
      halfWidth: p.frondWidth * 0.5 * lerp1(0.78, 1.08, age01),
      rachisSide: 1,
      colsHalf,
      rows,
      thick: p.laminaThicknessMm > 0.05,
      thickness: Math.max(0.0005, p.laminaThicknessMm * 0.0012),
      auricle: 0,
      serrationDepth: fenestrated ? p.serrationDepth : p.serrationDepth * 0.3,
      serrationCount: p.serrationCount,
      midribRelief: p.midribRelief * 1.25,
      veinRelief: p.veinRelief * 1.2,
      veinCount: p.veinCount,
      bullation: p.bullation,
      camber: p.laminaCamber,
      undulation: p.edgeUndulation,
      tipCurl: p.tipCurl,
      droopRad: p.archDroop * 0.45 * DEG2RAD,
      falcateRad: rng.vary(0, 0.08),
      fanMode: false,
      fenestrated,
      hostaMode,
      calatheaMode,
      ageFactor: age01,
      phase,
      pivot: fPivot,
      baseFlex: petFlexStart + petFlexRange,
      flexSpan: 0.28,
      plantHeightEst: plantH,
      colBase,
      colYoung,
      colVein,
      colSenescent,
      senescence: p.senescence,
      soriMesh: null,
      soriCoverage: 0,
      soriRadius: 0,
      soriColor: colSenescent,
      rng,
    });
  }

  // ---------------------------------------------------------------------------
  // Grooved Stipe / Rachis Tube Mesher (Adaxial U-Sulcus Cross-Section)
  // ---------------------------------------------------------------------------

  private meshGroovedRachis(
    mesh: PartMesh,
    line: CurveLine,
    rBase: number,
    rTip: number,
    sides: number,
    colBase: RGB,
    colTop: RGB,
    pivot: V3,
    plantH: number,
    phase: number,
    anatomyLevel: number,
    flexStart = 0.0,
    flexRange = 0.85,
  ): void {
    const N = Math.max(6, Math.round(sides));
    const K = line.count;
    const rings: number[][] = [];

    for (let i = 0; i < K; i++) {
      const fr = line.frameAtIndex(i);
      const t = fr.t;
      // Slight pulvinus swelling right at base (t < 0.06)
      const swell = 1 + 0.26 * Math.exp(-t * 32);
      const r = lerp1(rBase, rTip, Math.pow(t, 0.85)) * swell;
      const col = mixRgb(colBase, colTop, smoothstep(0.03, 0.42, t));
      const row: number[] = [];

      for (let j = 0; j < N; j++) {
        const th = (j / N) * TAU; // sin(th) > 0 is +up (adaxial groove side!)
        const sinT = Math.sin(th);
        const cosT = Math.cos(th);
        // Adaxial U-sulcus indentation at sin(th) near +1
        const groove = sinT > 0.25 ? 0.28 * Math.pow((sinT - 0.25) / 0.75, 2) : 0;
        const radLocal = r * (1 - groove);
        const off = add(scale(fr.right, cosT * radLocal), scale(fr.up, sinT * radLocal));
        const pt = add(fr.pos, off);

        row.push(
          mesh.addVertex({
            x: pt.x,
            y: pt.y,
            z: pt.z,
            tx: fr.dir.x,
            ty: fr.dir.y,
            tz: fr.dir.z,
            u: j / N,
            v: t,
            color: groove > 0.05 ? mixRgb(col, colTop, 0.25) : col,
            wind: [saturate(pt.y / plantH), flexStart + Math.pow(t, 1.45) * flexRange, phase, 0.0],
            pivot,
            roughness: lerp1(0.42, 0.58, t),
            translucency: 0.14 + 0.18 * t,
            detailMetric: groove * 2.2,
            anatomyLevel,
          }),
        );
      }
      rings.push(row);
    }

    for (let i = 0; i < K - 1; i++) {
      for (let j = 0; j < N; j++) {
        const j1 = (j + 1) % N;
        mesh.addQuad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
      }
    }
    // Cap tip
    const lastFr = line.frameAtIndex(K - 1);
    const tipCap = mesh.addVertex({
      x: lastFr.pos.x + lastFr.dir.x * rTip,
      y: lastFr.pos.y + lastFr.dir.y * rTip,
      z: lastFr.pos.z + lastFr.dir.z * rTip,
      tx: lastFr.dir.x, ty: lastFr.dir.y, tz: lastFr.dir.z,
      u: 0.5, v: 1,
      color: colTop,
      wind: [saturate(lastFr.pos.y / plantH), flexStart + flexRange, phase, 0.0],
      pivot, roughness: 0.55, translucency: 0.25, detailMetric: 0.5, anatomyLevel,
    });
    const topR = rings[K - 1];
    for (let j = 0; j < N; j++) {
      mesh.addTri(topR[j], topR[(j + 1) % N], tipCap);
    }
  }

  // ---------------------------------------------------------------------------
  // High-Poly 3D Veined Lamina Mesher (Pinnae, Pinnules, Fan Blades & Broadleaves)
  // ---------------------------------------------------------------------------

  private meshVeinedLamina(mesh: PartMesh, s: LaminaSpec): void {
    this.stats.leaflets++;
    const M = Math.max(2, s.colsHalf); // total columns = 2*M + 1 (exact center midrib column at u = 0!)
    const R = Math.max(5, s.rows);
    const cols = 2 * M + 1;

    // Grow midrib spine curve so leaflet droops, twists, and curves (falcate) in 3D
    const spine = growCurve(s.origin, s.dir, s.right, s.length, R, (t0, t1) => ({
      pitch: (t1 - t0) * s.droopRad + (Math.pow(t1, 2.8) - Math.pow(t0, 2.8)) * s.tipCurl * 1.15,
      yaw: (t1 - t0) * s.falcateRad,
      roll: Math.sin(t1 * Math.PI) * 0.04 * (t1 - t0) * 6,
    }));

    // Evaluate leaflet silhouette width & 3D relief at normalized (u in [-1, 1], v in [0, 1])
    const silhouetteHalfW = (v: number, sideSign: number): number => {
      if (s.fanMode) {
        // Flabellate wedge fan (Adiantum maidenhair): narrow cuneate base widening into lobed outer fan arc!
        const wedge = Math.pow(smoothstep(0.0, 0.85, v), 0.72);
        const outerArc = smoothstep(1.0, 0.78, v);
        const lobes = 1 + s.serrationDepth * 0.75 * Math.cos(v * Math.PI * s.serrationCount);
        return s.halfWidth * (0.06 + 0.94 * wedge * outerArc) * lobes;
      }

      if (s.hostaMode || s.fenestrated || s.calatheaMode) {
        // Cordate / ovate broadleaf silhouette
        const cordateBase = s.calatheaMode
          ? Math.pow(smoothstep(0.0, 0.25, v), 0.55)
          : Math.pow(smoothstep(0.0, 0.18, v), 0.42);
        const dripTip = Math.pow(1 - Math.pow(v, s.calatheaMode ? 2.2 : 1.45), s.calatheaMode ? 0.55 : 0.72);
        let cleftFactor = 1.0;
        if (s.fenestrated) {
          // Deep Monstera pinna sinuses cut inward between primary lateral veins!
          const sinusWave = Math.sin(v * Math.PI * s.veinCount * 0.85 + (sideSign > 0 ? 0.4 : 1.9));
          const cut = smoothstep(0.52, 0.92, sinusWave) * smoothstep(0.12, 0.28, v) * smoothstep(0.95, 0.8, v);
          cleftFactor = 1 - cut * clamp(0.45 + s.serrationDepth * 1.8, 0.25, 0.78);
        }
        return s.halfWidth * cordateBase * dripTip * cleftFactor;
      }

      // Fern Pinna / Pinnule Silhouette:
      // Rounded-truncate base + optional asymmetric acroscopic auricle lobe ("sword hilt") + acuminate tip + serrations!
      const baseRise = smoothstep(0.0, 0.075, v);
      const tipFall = Math.pow(1 - Math.pow(v, 1.55), 0.68);
      // Acroscopic auricle lobe on the forward (+rachisSide) basal margin (v in 0.03..0.24)
      const isAcroscopic = sideSign === s.rachisSide;
      const auricleBell = isAcroscopic ? s.auricle * 0.72 * Math.exp(-Math.pow((v - 0.105) / 0.068, 2)) : -s.auricle * 0.14 * Math.exp(-Math.pow((v - 0.06) / 0.05, 2));

      // Forward-pointing marginal serrations / pinnatifid lobes aligned with secondary veins!
      const toothPhase = v * s.serrationCount;
      const frac = toothPhase - Math.floor(toothPhase);
      // Asymmetric sawtooth: gentle ramp up to tooth apex at frac=0.72, crisp notch down to 1.0
      const saw = frac < 0.72 ? frac / 0.72 : 1 - (frac - 0.72) / 0.28;
      const toothEnv = smoothstep(0.06, 0.18, v) * smoothstep(0.99, 0.88, v);
      const teeth = 1 + s.serrationDepth * (saw * 2 - 0.7) * toothEnv;

      return Math.max(0.0002, s.halfWidth * baseRise * (tipFall + auricleBell) * teeth);
    };

    // Venation + Bullation + Camber 3D surface displacement evaluator
    const evalRelief = (
      u: number,
      v: number,
    ): {
      zTop: number;
      zBot: number;
      veinSignal: number;
      cordatePullBack: number;
      fenestrationHole: boolean;
    } => {
      const absU = Math.abs(u);
      const scaleRef = Math.max(0.002, s.halfWidth);

      if (s.fanMode) {
        // Dichotomous radiating fan veins from base (0, 0)!
        const fanAngle = Math.atan2(u * 0.9, v + 0.08);
        const veinWave = Math.pow(0.5 + 0.5 * Math.cos(fanAngle * s.veinCount * 2.2), 4.0);
        const dichotomSplit = Math.pow(0.5 + 0.5 * Math.cos(fanAngle * s.veinCount * 4.4), 5.0) * smoothstep(0.35, 0.75, v);
        const vSig = saturate(Math.max(veinWave, dichotomSplit * 0.85));
        const camberZ = -s.camber * scaleRef * 0.25 * u * u + Math.sin(u * 5.2 + v * 4.0) * s.undulation * scaleRef * 0.08 * v;
        const veinH = vSig * s.veinRelief * scaleRef * 0.035;
        return {
          zTop: camberZ + veinH * 0.45,
          zBot: camberZ - s.thickness - veinH * 0.9,
          veinSignal: vSig,
          cordatePullBack: 0,
          fenestrationHole: false,
        };
      }

      // 1. Primary Costa / Midrib (u = 0): sunken adaxial groove + prominent rounded abaxial keel!
      const midribWidth = s.hostaMode || s.fenestrated ? 0.075 : 0.095;
      const midribMask = Math.exp(-Math.pow(absU / midribWidth, 2)) * Math.pow(1 - v * 0.88, 0.85);

      // 2. Secondary Lateral Veins
      let secMask = 0;
      let bullatePillow = 0;
      if (s.hostaMode) {
        // Arched parallel-campylodromous Hosta veins curving from base to apex!
        const archCoord = absU * s.veinCount * 0.65;
        const distToVein = Math.abs(archCoord - Math.round(archCoord));
        secMask = Math.exp(-Math.pow(distToVein / 0.14, 2)) * (1 - midribMask * 0.7);
        bullatePillow = Math.sin(Math.min(1, distToVein * 2) * Math.PI) * (0.65 + 0.35 * Math.sin(v * Math.PI * 14));
      } else {
        // Pinnate herringbone secondary veins sweeping outward & forward at ~46°!
        const sweep = v * s.veinCount - Math.pow(absU, 0.92) * (s.calatheaMode ? 2.8 : 1.55);
        const fracV = sweep - Math.floor(sweep);
        const distV = Math.min(fracV, 1 - fracV);
        secMask = Math.exp(-Math.pow(distV / 0.13, 2)) * smoothstep(0.02, 0.1, absU) * smoothstep(1.0, 0.86, absU) * (1 - v * 0.35);
        bullatePillow = Math.sin(fracV * Math.PI) * smoothstep(0.05, 0.22, absU) * smoothstep(1.0, 0.78, absU);
      }

      const veinSignal = saturate(midribMask * 1.15 + secMask * 0.85);

      // Transverse V-keel / arch camber + marginal undulation ruffle
      const vKeel = s.camber * scaleRef * (0.28 * absU - 0.22 * u * u);
      const ruffle =
        Math.sin(v * Math.PI * (s.calatheaMode ? 9 : 6.5) + s.phase * TAU + (u > 0 ? 0 : 1.2)) *
        Math.pow(absU, 1.8) *
        s.undulation *
        scaleRef *
        0.13;
      const bullateZ = bullatePillow * s.bullation * scaleRef * 0.068 * (1 - v * 0.3);

      // Midrib & secondary vein physical relief:
      // Adaxial (top): midrib slightly grooved or raised rib, secondary veins subtly impressed in bullate leaves or crisp ridges
      const midTop = -midribMask * s.midribRelief * scaleRef * 0.028;
      const midBot = -midribMask * s.midribRelief * scaleRef * 0.145; // strong protruding underside costa!
      const secTop = (s.hostaMode || s.bullation > 0.45 ? -0.35 : 0.45) * secMask * s.veinRelief * scaleRef * 0.032;
      const secBot = -secMask * s.veinRelief * scaleRef * 0.065; // protruding underside secondary veins!

      const baseZ = vKeel + ruffle + bullateZ;
      const localThick = s.thickness * (0.55 + 0.45 * (1 - absU * 0.75));

      // Cordate basal lobes pull slightly backward (-dir) near v=0 on Hosta/Monstera
      const cordatePullBack =
        s.hostaMode || s.fenestrated
          ? -Math.sin(absU * Math.PI) * Math.exp(-v * 11) * s.length * 0.13
          : 0;

      // Interior Monstera oval fenestration holes mid-lamina!
      let fenestrationHole = false;
      if (s.fenestrated && absU > 0.22 && absU < 0.62 && v > 0.22 && v < 0.78) {
        const holeCell = v * s.veinCount * 0.42 + (u > 0 ? 0.15 : 0.65);
        const hf = holeCell - Math.floor(holeCell);
        const du = (absU - 0.41) / 0.14;
        const dv = (hf - 0.5) / 0.24;
        if (du * du + dv * dv < 0.85) fenestrationHole = true;
      }

      return {
        zTop: baseZ + midTop + secTop,
        zBot: baseZ - localThick + midBot + secBot,
        veinSignal,
        cordatePullBack,
        fenestrationHole,
      };
    };

    // Build vertex grid(s)
    const topGrid: number[][] = [];
    const botGrid: number[][] = [];
    const holeMask: boolean[][] = [];

    for (let r = 0; r <= R; r++) {
      const v = r / R;
      const fr = spine.frameAtIndex(r);
      const wLeft = silhouetteHalfW(v, -1);
      const wRight = silhouetteHalfW(v, 1);

      const tRow: number[] = [];
      const bRow: number[] = [];
      const hRow: boolean[] = [];

      for (let c = 0; c < cols; c++) {
        const u = (c - M) / M; // [-1 .. +1], exact 0 at c === M!
        const absU = Math.abs(u);
        const hw = u < 0 ? wLeft : wRight;
        // Tip converges cleanly at r === R
        const tipPinch = r === R ? 0 : 1;
        const lateralX = u * hw * tipPinch;
        const rel = evalRelief(u, v);
        hRow.push(rel.fenestrationHole);

        // Physiological leaf pigmentation:
        // Base-to-tip fresh gradient + bright chlorophyll/pale veins + variegation + outer senescence!
        let leafCol = mixRgb(s.colBase, s.colYoung, saturate((1 - s.ageFactor) * 0.62 + v * 0.28));
        if (s.calatheaMode) {
          // Silver-sage feathered stripes along lateral veins (Calathea orbifolia)!
          const stripe = Math.pow(0.5 + 0.5 * Math.cos((v * 9 - absU * 2.4) * Math.PI * 2), 2.2) * (1 - absU * 0.25);
          leafCol = mixRgb(leafCol, hexToLinearRgb('#9ab892'), stripe * 0.58);
        } else if (s.hostaMode) {
          // Glaucous blue-green center with creamy-chartreuse margin variegation!
          const marginBand = smoothstep(0.66, 0.88, absU);
          leafCol = mixRgb(leafCol, s.colYoung, marginBand * 0.68);
        }
        // Highlight raised midrib & secondary veins
        leafCol = mixRgb(leafCol, s.colVein, saturate(rel.veinSignal * 0.58));
        // Subtle bronze-olive tip/margin senescence on older outer fronds
        const senAmt = s.senescence * s.ageFactor * smoothstep(0.68, 1.0, Math.max(v, absU * 0.92));
        if (senAmt > 0.01) leafCol = mixRgb(leafCol, s.colSenescent, saturate(senAmt));

        // Seal zBot to zTop right at outer perimeter (|u| == 1 or v == 1 or v == 0) so thick leaves are watertight!
        const edgeSeal = r === R ? 0 : smoothstep(1.0, 0.86, absU) * smoothstep(0.0, 0.04, v);
        const zTop = rel.zTop * (r === R ? 0.15 : 1);
        const zBot = lerp1(zTop, rel.zBot, edgeSeal);

        const basePt = add(
          addScaled(fr.pos, fr.dir, rel.cordatePullBack),
          scale(fr.right, lateralX),
        );
        const pTop = addScaled(basePt, fr.up, zTop);

        const baseFlex = s.baseFlex ?? 0.25;
        const flexSpan = s.flexSpan ?? 0.35;
        const localFlex = clamp(baseFlex + flexSpan * Math.pow(v, 1.45), 0, 1.35);
        const aeroRoll = clamp(0.24 * v * v * (0.35 + 0.65 * absU), 0, 0.45);
        const windData: [number, number, number, number] = [
          saturate(pTop.y / s.plantHeightEst),
          localFlex,
          s.phase,
          aeroRoll,
        ];

        // Spine tangent direction for torsional leaf roll & anisotropic sheen
        const veinTan = fr.dir;
        const roughTop = clamp(0.34 + 0.18 * (1 - rel.veinSignal) + 0.16 * senAmt, 0.22, 0.82);
        // Veins are denser vascular bundles -> slightly lower translucency than thin mesophyll (casts real vein silhouettes when backlit!)
        const trans = clamp((0.68 - 0.36 * rel.veinSignal) * (1 - senAmt * 0.5), 0.08, 0.85);

        tRow.push(
          mesh.addVertex({
            x: pTop.x,
            y: pTop.y,
            z: pTop.z,
            tx: veinTan.x,
            ty: veinTan.y,
            tz: veinTan.z,
            u: (u + 1) * 0.5,
            v,
            color: leafCol,
            wind: windData,
            pivot: s.pivot,
            roughness: roughTop,
            translucency: trans,
            detailMetric: rel.veinSignal,
            anatomyLevel: rel.veinSignal > 0.55 ? 3 : 2,
          }),
        );

        if (s.thick) {
          const pBot = addScaled(basePt, fr.up, zBot);
          // Underside (abaxial) of real fern fronds & leaves is slightly paler/glaucous matte green with brighter costa!
          const abaxCol = mixRgb(
            mixRgb(leafCol, hexToLinearRgb('#7ea36f'), 0.24),
            s.colVein,
            saturate(rel.veinSignal * 0.42),
          );
          bRow.push(
            mesh.addVertex({
              x: pBot.x,
              y: pBot.y,
              z: pBot.z,
              tx: veinTan.x,
              ty: veinTan.y,
              tz: veinTan.z,
              u: (u + 1) * 0.5,
              v,
              color: abaxCol,
              wind: windData,
              pivot: s.pivot,
              roughness: clamp(roughTop + 0.16, 0.35, 0.9),
              translucency: trans,
              detailMetric: rel.veinSignal,
              anatomyLevel: rel.veinSignal > 0.55 ? 3 : 2,
            }),
          );
        }
      }
      topGrid.push(tRow);
      if (s.thick) botGrid.push(bRow);
      holeMask.push(hRow);
    }

    // Emit quads for upper (adaxial) surface (+up normal) and optional lower (abaxial) surface (-up normal)
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (holeMask[r][c] && holeMask[r + 1][c + 1]) continue;
        // Check winding: right increases with c, dir increases with r -> cross(right, dir) = -up, so (a, d, c1, b) gives +up!
        const a = topGrid[r][c];
        const b = topGrid[r][c + 1];
        const c1 = topGrid[r + 1][c + 1];
        const d = topGrid[r + 1][c];
        mesh.addQuad(a, d, c1, b);

        if (s.thick) {
          const ba = botGrid[r][c];
          const bb = botGrid[r][c + 1];
          const bc1 = botGrid[r + 1][c + 1];
          const bd = botGrid[r + 1][c];
          mesh.addQuad(ba, bb, bc1, bd);
        }
      }
    }

    // Seal basal edge at r = 0 when thick
    if (s.thick) {
      for (let c = 0; c < cols - 1; c++) {
        mesh.addQuad(topGrid[0][c], topGrid[0][c + 1], botGrid[0][c + 1], botGrid[0][c]);
      }
    }

    // Emit 3D Abaxial Sori (Spore Clusters) on the underside!
    if (s.soriMesh && s.soriRadius > 1e-5) {
      const nSoriPairs = s.fanMode ? 3 : clamp(Math.round(s.veinCount * 0.55 * s.soriCoverage), 2, 9);
      for (let k = 0; k < nSoriPairs; k++) {
        const vs = s.fanMode ? 0.88 : 0.16 + 0.68 * ((k + 0.5) / nSoriPairs);
        const fr = spine.atT(vs);
        for (const side of [-1, 1]) {
          if (s.rng.next() > s.soriCoverage * 1.15) continue;
          const uPos = s.fanMode ? side * (0.25 + 0.5 * (k / Math.max(1, nSoriPairs - 1))) : side * 0.48;
          const hw = silhouetteHalfW(vs, side);
          const rel = evalRelief(uPos, vs);
          const center = add(
            addScaled(fr.pos, fr.right, uPos * hw),
            scale(fr.up, (s.thick ? rel.zBot : rel.zTop) - s.soriRadius * 0.12),
          );
          const rad = s.soriRadius * lerp1(1.05, 0.65, vs) * s.rng.range(0.85, 1.15);
          const sorusFlex = clamp((s.baseFlex ?? 0.25) + (s.flexSpan ?? 0.35) * Math.pow(vs, 1.45), 0, 1.35);
          const sorusRoll = clamp(0.24 * vs * vs * (0.35 + 0.65 * Math.abs(uPos)), 0, 0.45);
          this.addSorusDome(s.soriMesh, center, scale(fr.up, -1), fr.right, rad, s.soriColor, s.pivot, s.plantHeightEst, sorusFlex, s.phase, sorusRoll);
          this.stats.soriClusters++;
        }
      }
    }
  }

  /** Sculpted 3D hemispherical/reniform sporangia sorus dome on the underside of a fertile pinna. */
  private addSorusDome(
    soriMesh: PartMesh,
    center: V3,
    downNormal: V3,
    rightAxis: V3,
    radius: number,
    col: RGB,
    pivot: V3,
    plantH: number,
    sorusFlex: number,
    phase: number,
    sorusRoll = 0.0,
  ): void {
    const fwdAxis = normalize(cross(rightAxis, downNormal));
    const sides = 6;
    const baseRing: number[] = [];
    const midRing: number[] = [];
    const wind: [number, number, number, number] = [saturate(center.y / plantH), sorusFlex, phase, sorusRoll];
    const rimCol = mixRgb(col, hexToLinearRgb('#a86c34'), 0.38);

    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * TAU;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const radial = add(scale(rightAxis, c), scale(fwdAxis, sn));
      const p0 = addScaled(center, radial, radius);
      const p1 = add(addScaled(center, radial, radius * 0.62), scale(downNormal, radius * 0.48));
      baseRing.push(
        soriMesh.addVertex({
          x: p0.x, y: p0.y, z: p0.z, u: 0.5 + 0.5 * c, v: 0.5 + 0.5 * sn,
          color: rimCol, wind, pivot, roughness: 0.78, translucency: 0.1, detailMetric: 0.85, anatomyLevel: 4,
        }),
      );
      midRing.push(
        soriMesh.addVertex({
          x: p1.x, y: p1.y, z: p1.z, u: 0.5 + 0.3 * c, v: 0.5 + 0.3 * sn,
          color: col, wind, pivot, roughness: 0.72, translucency: 0.08, detailMetric: 0.95, anatomyLevel: 4,
        }),
      );
    }
    const apexPt = addScaled(center, downNormal, radius * 0.68);
    const apex = soriMesh.addVertex({
      x: apexPt.x, y: apexPt.y, z: apexPt.z, u: 0.5, v: 0.5,
      color: mixRgb(col, hexToLinearRgb('#421d09'), 0.3), wind, pivot, roughness: 0.68, translucency: 0.06, detailMetric: 1.0, anatomyLevel: 4,
    });

    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      soriMesh.addQuad(baseRing[j], baseRing[j1], midRing[j1], midRing[j]);
      soriMesh.addTri(midRing[j], midRing[j1], apex);
    }
  }
}

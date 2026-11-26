import { describe, expect, it } from 'vitest';
import { partsToGLB, partsToOBJ } from '../src/core/mesh';
import { validateWeldedManifold } from '../src/core/weldedManifold';
import { buildSceneRaw, buildSceneResponse } from '../src/generators/buildScene';
import {
  applyFlowerPalette,
  FLOWER_PALETTE_NAMES,
  FLOWER_SPECIES_NAMES,
  FlowerColorPalette,
  FlowerSpecies,
} from '../src/generators/flowerParams';
import {
  applyMarinePalette,
  applyMarineSpeciesDefaults,
  DEFAULT_MARINE_PARAMS,
  MARINE_PALETTE_NAMES,
  MARINE_SPECIES_NAMES,
  MarineColorPalette,
  MarineSpecies,
} from '../src/generators/marineParams';
import { PRESETS } from '../src/generators/presets';
import { cloneScene } from '../src/generators/types';
import {
  SHADOW_DISC_FRAG,
  SPECIMEN_FRAG,
  SPECIMEN_VERT,
  WIRE_FRAG,
  WIRE_VERT,
} from '../src/viewer/shaders';

/** Exact CPU mirror of the GLSL isometric 3D Rodrigues wind kernel in `src/viewer/shaders.ts`. */
function evalWindVertex(
  pos: [number, number, number],
  tan: [number, number, number],
  wind: [number, number, number, number],
  piv: [number, number, number],
  uTime: number,
  uWindStrength: number,
  uWindGust = 0.52,
): [number, number, number] {
  if (uWindStrength <= 0.0005) return [...pos];
  const limbFlex = wind[1];
  const flutter = wind[3];
  if (limbFlex <= 1e-5 && flutter <= 1e-5) return [...pos];

  let rx = pos[0] - piv[0];
  let ry = pos[1] - piv[1];
  let rz = pos[2] - piv[2];
  if (rx * rx + ry * ry + rz * rz <= 1e-12) return [...pos];

  const rot = (
    v: [number, number, number],
    ax: [number, number, number],
    ang: number,
  ): [number, number, number] => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2];
    const cx = ax[1] * v[2] - ax[2] * v[1];
    const cy = ax[2] * v[0] - ax[0] * v[2];
    const cz = ax[0] * v[1] - ax[1] * v[0];
    return [
      v[0] * c + cx * s + ax[0] * d * (1 - c),
      v[1] * c + cy * s + ax[1] * d * (1 - c),
      v[2] * c + cz * s + ax[2] * d * (1 - c),
    ];
  };
  const softLimit = (x: number, lim: number) => (x * lim) / Math.sqrt(lim * lim + x * x);

  const phase = wind[2] * Math.PI * 2;
  const wx = 0.82 / Math.hypot(0.82, 0.57);
  const wz = 0.57 / Math.hypot(0.82, 0.57);
  const pitchAxis: [number, number, number] = [wz, 0, -wx];
  const rollAxis: [number, number, number] = [wx, 0, wz];

  const downWave = (piv[0] * wx + piv[2] * wz) * 0.45;
  const crossWave = (piv[0] * pitchAxis[0] + piv[2] * pitchAxis[2]) * 0.35;

  const gustA = 0.5 + 0.5 * Math.sin(uTime * 0.92 - downWave + crossWave * 0.35);
  const gustB = 0.5 + 0.5 * Math.sin(uTime * 1.68 - downWave * 1.45 + phase * 0.18);
  const gustEnv = 1 + (0.36 + 0.96 * (gustA * 0.65 + gustB * 0.35) - 1) * uWindGust;
  const W = uWindStrength * gustEnv;

  const oscMain = 0.56 + 0.44 * Math.sin(uTime * 2.15 - downWave * 1.1 + phase * 0.22);
  const oscSub = 0.12 * Math.sin(uTime * 4.35 - downWave * 1.8 + phase * 0.55);
  const pitchAngle = softLimit(limbFlex * W * (oscMain + oscSub) * 0.54, 0.88);
  const rollAngle = softLimit(
    limbFlex * W * 0.14 * Math.sin(uTime * 1.62 - crossWave + phase * 0.28 + 1.1),
    0.38,
  );

  let rel: [number, number, number] = [rx, ry, rz];
  void tan;
  rel = rot(rel, pitchAxis, pitchAngle);
  rel = rot(rel, rollAxis, rollAngle);

  if (flutter > 0.0001) {
    const rLen = Math.max(0.20, Math.hypot(rel[0], rel[1], rel[2]));
    const hiWave =
      Math.sin(uTime * 5.2 - downWave * 1.9 + phase * 3.1) +
      0.42 * Math.sin(uTime * 8.4 - crossWave * 1.7 + phase * 5.3);
    const disp = softLimit(flutter * W * hiWave * 0.026, 0.045);
    const fPitch = disp / rLen;
    const fRoll = (disp * 0.38) / rLen;
    rel = rot(rel, pitchAxis, fPitch);
    rel = rot(rel, rollAxis, fRoll);
  }

  return [piv[0] + rel[0], piv[1] + rel[1], piv[2] + rel[2]];
}

describe('Frontier Procedural Generators — Welded Trees, Fruiting Palms, Gigantic Flowers, Sea Plants & Marine Species, Pillow Moss, Giant Tropicals, Ferns & Fur', () => {
  it('exposes all 82 curated presets across all 11 studio groups', () => {
    expect(PRESETS.length).toBe(82);
    const groups = new Set(PRESETS.map((p) => p.group));
    expect(groups.has('Trees · Welded Manifold')).toBe(true);
    expect(groups.has('Palms · Fruiting & Branching')).toBe(true);
    expect(groups.has('Flowers · Gigantic 3D Blooms')).toBe(true);
    expect(groups.has('Sea Plants · Kelp & Vegetation')).toBe(true);
    expect(groups.has('Sea & Reef · Marine Species')).toBe(true);
    expect(groups.has('Real Moss · Bryophytes')).toBe(true);
    expect(groups.has('Giant Tropical · Megaphylls')).toBe(true);
    expect(groups.has('Ferns · Woodland & Tropical')).toBe(true);
    expect(groups.has('Plants · Sculpted Broadleaf')).toBe(true);
    expect(groups.has('Fur & Hair · Studio Grooms')).toBe(true);
    expect(groups.has('Ecosystems · Multi-Layer')).toBe(true);
  });

  it('builds every preset cleanly at preview tier with zero NaN vertices and complete Outliner hierarchy', () => {
    for (const preset of PRESETS) {
      const scene = cloneScene(preset.scene);
      for (const l of scene.layers) {
        if (l.tree) l.tree.detailTier = 1;
        if (l.palm) l.palm.detailTier = 1;
        if (l.flower) l.flower.detailTier = 1;
        if (l.marine) l.marine.detailTier = 1;
        if (l.fern) l.fern.detailTier = 1;
        if (l.tropical) l.tropical.detailTier = 1;
        if (l.moss) l.moss.detailTier = 1;
        if (l.hair) l.hair.detailTier = 1;
      }

      const res = buildSceneResponse(scene);
      expect(res.topology.nanVertices, `${preset.name} NaN check`).toBe(0);
      expect(res.topology.degenerateFaces, `${preset.name} degenerate check`).toBe(0);
      expect(res.topology.renderedTriangles, `${preset.name} triangle count`).toBeGreaterThan(1500);
      expect(res.parts.length, `${preset.name} GPU packets`).toBeGreaterThan(1);

      const ids = new Set(res.outliner.map((n) => n.id));
      expect(ids.has('scene:root')).toBe(true);
      expect(ids.has('substrate:host')).toBe(true);
      for (const l of scene.layers) {
        expect(ids.has(l.id), `${preset.name} layer ${l.id} in Outliner`).toBe(true);
      }
    }
  });

  it('proves watertight closed 2-manifold Euler topology (V - E + F = 2C, 0 boundary/non-manifold edges) across all Welded Trees, Palms & Tropicals', () => {
    const weldedPresets = [
      'Ancient English Oak',
      'Tropical Buttress Banyan',
      'Sculpted Japanese Maple',
      'Monumental African Baobab',
      'Medjool Date Palm',
      'Coastal Coconut Palm',
      'Cuban Royal Palm',
      'Desert Oasis Fan Palm',
      'Branching Doum Palm',
      'Giant Banana Plant',
      'Red Abyssinian Banana',
      "Traveller's Palm",
      'Colossal Elephant Ear',
      'Giant Bird of Paradise',
    ];

    for (const name of weldedPresets) {
      const preset = PRESETS.find((p) => p.name === name)!;
      expect(preset, `Preset ${name} exists`).toBeDefined();
      const scene = cloneScene(preset.scene);
      for (const l of scene.layers) {
        if (l.tree) l.tree.detailTier = 2;
        if (l.palm) l.palm.detailTier = 2;
        if (l.tropical) l.tropical.detailTier = 2;
      }
      const raw = buildSceneRaw(scene);
      const skeletonMesh = raw.rawParts.find(
        (m) =>
          m.id.endsWith(':wood') ||
          m.id.endsWith(':skeleton') ||
          m.id.endsWith(':pseudostem'),
      )!;
      expect(skeletonMesh, `${name} welded skeleton mesh`).toBeDefined();

      const rep = validateWeldedManifold(skeletonMesh);
      expect(rep.boundaryEdges, `${name} boundaryEdges`).toBe(0);
      expect(rep.nonManifoldEdges, `${name} nonManifoldEdges`).toBe(0);
      expect(rep.inconsistentEdges, `${name} inconsistentEdges`).toBe(0);
      expect(rep.degenerateFaces, `${name} degenerateFaces`).toBe(0);
      expect(rep.closed, `${name} closed`).toBe(true);
      expect(rep.manifold, `${name} manifold`).toBe(true);
      expect(rep.eulerCharacteristic, `${name} Euler V-E+F=2C`).toBe(2 * rep.components);
      expect(rep.quadRatio, `${name} quad dominance`).toBeGreaterThan(0.99);
    }
  });

  it('synthesizes anatomically accurate Fruiting & Branching Palms (Date spadices, 3-angled Coconuts, Doum 4-crown Y-forks) with zero wind scaling', () => {
    const datePreset = PRESETS.find((p) => p.name === 'Medjool Date Palm')!;
    const dateRes = buildSceneResponse(cloneScene(datePreset.scene));
    const dStats = dateRes.layerReports[0].palm!;
    expect(dStats.closedTrunkManifold).toBe(true);
    expect(dStats.fronds).toBeGreaterThanOrEqual(40);
    expect(dStats.fruitBunches).toBe(8);
    expect(dStats.fruits).toBeGreaterThan(1500);

    const cocoPreset = PRESETS.find((p) => p.name === 'Coastal Coconut Palm')!;
    const cocoRes = buildSceneResponse(cloneScene(cocoPreset.scene));
    const cStats = cocoRes.layerReports[0].palm!;
    expect(cStats.closedTrunkManifold).toBe(true);
    expect(cStats.fruitBunches).toBe(5);
    expect(cStats.fruits).toBeGreaterThanOrEqual(35);

    const doumPreset = PRESETS.find((p) => p.name === 'Branching Doum Palm')!;
    const doumRes = buildSceneResponse(cloneScene(doumPreset.scene));
    const dmStats = doumRes.layerReports[0].palm!;
    expect(dmStats.closedTrunkManifold).toBe(true);
    expect(dmStats.crowns).toBe(4);
    expect(dmStats.weldedForks).toBe(3);
    expect(dmStats.fruits).toBeGreaterThan(300);

    // Verify 3D coconut drupes deform under strong trade winds with zero radial pivot stretch!
    const fruitsPkt = cocoRes.parts.find((p) => p.id === 'layer-1:fruits')!;
    let maxDrift = 0;
    for (let i = 0; i < fruitsPkt.position.length / 3; i++) {
      const p0: [number, number, number] = [
        fruitsPkt.position[i * 3],
        fruitsPkt.position[i * 3 + 1],
        fruitsPkt.position[i * 3 + 2],
      ];
      const t0: [number, number, number] = [
        fruitsPkt.tangent[i * 3],
        fruitsPkt.tangent[i * 3 + 1],
        fruitsPkt.tangent[i * 3 + 2],
      ];
      const w0: [number, number, number, number] = [
        fruitsPkt.wind[i * 4],
        fruitsPkt.wind[i * 4 + 1],
        fruitsPkt.wind[i * 4 + 2],
        fruitsPkt.wind[i * 4 + 3],
      ];
      const pv: [number, number, number] = [
        fruitsPkt.pivot[i * 3],
        fruitsPkt.pivot[i * 3 + 1],
        fruitsPkt.pivot[i * 3 + 2],
      ];
      const pW = evalWindVertex(p0, t0, w0, pv, 2.1, 1.2);
      const r0 = Math.hypot(p0[0] - pv[0], p0[1] - pv[1], p0[2] - pv[2]);
      const rW = Math.hypot(pW[0] - pv[0], pW[1] - pv[1], pW[2] - pv[2]);
      maxDrift = Math.max(maxDrift, Math.abs(rW - r0));
    }
    expect(maxDrift).toBeLessThan(1e-5);
  });

  it('synthesizes Cloud-Forest Pillow Moss on Wet Volcanic Basalt Crag with anchored cushion lobes and rigid SO(3) star-tuft velvet', () => {
    const preset = PRESETS.find((p) => p.name === 'Cloud-Forest Pillow Moss')!;
    const scene = cloneScene(preset.scene);
    scene.layers[0].moss!.detailTier = 2;
    const res = buildSceneResponse(scene);

    expect(res.topology.nanVertices).toBe(0);
    expect(res.topology.degenerateFaces).toBe(0);
    const mStats = res.layerReports[0].moss!;
    expect(mStats.shoots).toBeGreaterThan(25000);
    expect(mStats.phyllids).toBeGreaterThan(75000);
    expect(mStats.sporophytes).toBe(0);

    const cushions = res.parts.find((p) => p.id === 'layer-1:stems')!;
    const velvet = res.parts.find((p) => p.id === 'layer-1:phyllids')!;
    expect(cushions).toBeDefined();
    expect(velvet).toBeDefined();

    // Cushion lobes stay 100% anchored to wet basalt rock (0.000 mm wind bounce/stretch)
    let maxCushionMove = 0;
    for (let i = 0; i < cushions.position.length / 3; i += 17) {
      const p0: [number, number, number] = [
        cushions.position[i * 3],
        cushions.position[i * 3 + 1],
        cushions.position[i * 3 + 2],
      ];
      const pW = evalWindVertex(
        p0,
        [cushions.tangent[i * 3], cushions.tangent[i * 3 + 1], cushions.tangent[i * 3 + 2]],
        [cushions.wind[i * 4], cushions.wind[i * 4 + 1], cushions.wind[i * 4 + 2], cushions.wind[i * 4 + 3]],
        [cushions.pivot[i * 3], cushions.pivot[i * 3 + 1], cushions.pivot[i * 3 + 2]],
        1.75,
        1.4,
      );
      maxCushionMove = Math.max(
        maxCushionMove,
        Math.hypot(pW[0] - p0[0], pW[1] - p0[1], pW[2] - p0[2]),
      );
    }
    expect(maxCushionMove).toBe(0);

    // Every 3D star-tuft triangle preserves 100.000% exact edge length under storm wind!
    let maxEdgeScaleErr = 0;
    for (let f = 0; f < Math.min(velvet.index.length, 9000); f += 3) {
      const ia = velvet.index[f];
      const ib = velvet.index[f + 2];
      const getRest = (k: number): [number, number, number] => [
        velvet.position[k * 3],
        velvet.position[k * 3 + 1],
        velvet.position[k * 3 + 2],
      ];
      const getDef = (k: number) =>
        evalWindVertex(
          getRest(k),
          [velvet.tangent[k * 3], velvet.tangent[k * 3 + 1], velvet.tangent[k * 3 + 2]],
          [velvet.wind[k * 4], velvet.wind[k * 4 + 1], velvet.wind[k * 4 + 2], velvet.wind[k * 4 + 3]],
          [velvet.pivot[k * 3], velvet.pivot[k * 3 + 1], velvet.pivot[k * 3 + 2]],
          1.75,
          1.4,
        );
      const a0 = getRest(ia);
      const b0 = getRest(ib);
      const aW = getDef(ia);
      const bW = getDef(ib);
      const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]);
      const dW = Math.hypot(bW[0] - aW[0], bW[1] - aW[1], bW[2] - aW[2]);
      if (d0 > 1e-6) maxEdgeScaleErr = Math.max(maxEdgeScaleErr, Math.abs(dW / d0 - 1));
    }
    expect(maxEdgeScaleErr).toBeLessThan(1e-6);
  });

  it('synthesizes continuous Lush Velvet Carpet Moss across an undulating forest carpet with zero wind scaling', () => {
    const preset = PRESETS.find((p) => p.name === 'Lush Velvet Carpet Moss')!;
    const scene = cloneScene(preset.scene);
    scene.layers[0].moss!.detailTier = 2;
    const res = buildSceneResponse(scene);

    expect(res.topology.nanVertices).toBe(0);
    const mStats = res.layerReports[0].moss!;
    expect(mStats.shoots).toBeGreaterThan(950);
    expect(mStats.phyllids).toBeGreaterThan(10000);

    const phyllids = res.parts.find((p) => p.id === 'layer-1:phyllids')!;
    const capsules = res.parts.find((p) => p.id === 'layer-1:capsules')!;
    // Wide continuous carpet footprint (> 0.85 m across X and Z!)
    expect(phyllids.bounds[3] - phyllids.bounds[0]).toBeGreaterThan(0.85);
    expect(phyllids.bounds[5] - phyllids.bounds[2]).toBeGreaterThan(0.85);

    // Prove zero radial scaling / stretching under strong wind (uWindStrength = 1.35)!
    for (const pkt of [phyllids, capsules]) {
      const nVerts = pkt.position.length / 3;
      let maxPivotRadiusDrift = 0;
      let movedCount = 0;
      for (let i = 0; i < nVerts; i++) {
        const p0: [number, number, number] = [
          pkt.position[i * 3],
          pkt.position[i * 3 + 1],
          pkt.position[i * 3 + 2],
        ];
        const t0: [number, number, number] = [
          pkt.tangent[i * 3],
          pkt.tangent[i * 3 + 1],
          pkt.tangent[i * 3 + 2],
        ];
        const w0: [number, number, number, number] = [
          pkt.wind[i * 4],
          pkt.wind[i * 4 + 1],
          pkt.wind[i * 4 + 2],
          pkt.wind[i * 4 + 3],
        ];
        const pv: [number, number, number] = [
          pkt.pivot[i * 3],
          pkt.pivot[i * 3 + 1],
          pkt.pivot[i * 3 + 2],
        ];
        const pWind = evalWindVertex(p0, t0, w0, pv, 2.35, 1.35);

        const rRest = Math.hypot(p0[0] - pv[0], p0[1] - pv[1], p0[2] - pv[2]);
        const rWind = Math.hypot(pWind[0] - pv[0], pWind[1] - pv[1], pWind[2] - pv[2]);
        maxPivotRadiusDrift = Math.max(maxPivotRadiusDrift, Math.abs(rWind - rRest));
        if (Math.hypot(pWind[0] - p0[0], pWind[1] - p0[1], pWind[2] - p0[2]) > 0.0005) {
          movedCount++;
        }
      }
      expect(maxPivotRadiusDrift).toBeLessThan(1e-6);
      expect(movedCount).toBeGreaterThan(nVerts * 0.65);
    }

    // Also verify rigid spore capsule triangle edge lengths stay 100% invariant (zero capsule inflation!)
    let maxCapsuleEdgeScaleErr = 0;
    for (let f = 0; f < capsules.index.length; f += 3) {
      const ia = capsules.index[f];
      const ib = capsules.index[f + 1];
      const getRest = (k: number): [number, number, number] => [
        capsules.position[k * 3],
        capsules.position[k * 3 + 1],
        capsules.position[k * 3 + 2],
      ];
      const getDeformed = (k: number) =>
        evalWindVertex(
          getRest(k),
          [capsules.tangent[k * 3], capsules.tangent[k * 3 + 1], capsules.tangent[k * 3 + 2]],
          [
            capsules.wind[k * 4],
            capsules.wind[k * 4 + 1],
            capsules.wind[k * 4 + 2],
            capsules.wind[k * 4 + 3],
          ],
          [capsules.pivot[k * 3], capsules.pivot[k * 3 + 1], capsules.pivot[k * 3 + 2]],
          2.35,
          1.35,
        );
      const a0 = getRest(ia);
      const b0 = getRest(ib);
      const aW = getDeformed(ia);
      const bW = getDeformed(ib);
      const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]);
      const dW = Math.hypot(bW[0] - aW[0], bW[1] - aW[1], bW[2] - aW[2]);
      if (d0 > 1e-6) {
        maxCapsuleEdgeScaleErr = Math.max(maxCapsuleEdgeScaleErr, Math.abs(dW / d0 - 1));
      }
    }
    expect(maxCapsuleEdgeScaleErr).toBeLessThan(1e-6);
  });

  it('synthesizes Giant Banana Plant (Musa acuminata) with clasping pseudostems, cigar furl, fruit hands, crimson bell, and wind-split paddles', () => {
    const preset = PRESETS.find((p) => p.name === 'Giant Banana Plant')!;
    const scene = cloneScene(preset.scene);
    const res = buildSceneResponse(scene);

    expect(res.topology.nanVertices).toBe(0);
    expect(res.sceneHeight).toBeGreaterThan(2.5);
    expect(res.topology.renderedTriangles).toBeGreaterThan(40000);

    const outlinerIds = res.outliner.map((n) => n.id);
    expect(outlinerIds).toContain('layer-1:pseudostem');
    expect(outlinerIds).toContain('layer-1:cigar');
    expect(outlinerIds).toContain('layer-1:inflorescence');
    expect(outlinerIds).toContain('layer-1:leaves');
    expect(outlinerIds).toContain('layer-1:leaves:l01');

    const tStats = res.layerReports[0].tropical!;
    expect(tStats.stems).toBe(2);
    expect(tStats.leaves).toBeGreaterThanOrEqual(14);
    expect(tStats.ribbons).toBeGreaterThan(100);
    expect(tStats.fruitsOrFlowers).toBeGreaterThan(15);

    // Verify isometric wind sway on banana paddles (zero pivot-chord stretching + active ribbon motion!)
    const paddle = res.parts.find((p) => p.id === 'layer-1:leaves:l06')!;
    let maxDrift = 0;
    let maxTipDisp = 0;
    for (let i = 0; i < paddle.position.length / 3; i++) {
      const p0: [number, number, number] = [
        paddle.position[i * 3],
        paddle.position[i * 3 + 1],
        paddle.position[i * 3 + 2],
      ];
      const t0: [number, number, number] = [
        paddle.tangent[i * 3],
        paddle.tangent[i * 3 + 1],
        paddle.tangent[i * 3 + 2],
      ];
      const w0: [number, number, number, number] = [
        paddle.wind[i * 4],
        paddle.wind[i * 4 + 1],
        paddle.wind[i * 4 + 2],
        paddle.wind[i * 4 + 3],
      ];
      const pv: [number, number, number] = [
        paddle.pivot[i * 3],
        paddle.pivot[i * 3 + 1],
        paddle.pivot[i * 3 + 2],
      ];
      const pW = evalWindVertex(p0, t0, w0, pv, 1.8, 0.85);
      const r0 = Math.hypot(p0[0] - pv[0], p0[1] - pv[1], p0[2] - pv[2]);
      const rW = Math.hypot(pW[0] - pv[0], pW[1] - pv[1], pW[2] - pv[2]);
      maxDrift = Math.max(maxDrift, Math.abs(rW - r0));
      maxTipDisp = Math.max(
        maxTipDisp,
        Math.hypot(pW[0] - p0[0], pW[1] - p0[1], pW[2] - p0[2]),
      );
    }
    expect(maxDrift).toBeLessThan(1e-5);
    expect(maxTipDisp).toBeGreaterThan(0.25); // > 25 cm majestic wind arc on giant banana paddle!
  });

  it('synthesizes ultra-realistic high-poly Western Sword Fern with 3D veined pinnae, crosiers, and abaxial sori', () => {
    const preset = PRESETS.find((p) => p.name === 'Western Sword Fern')!;
    const scene = cloneScene(preset.scene);
    const res = buildSceneResponse(scene);

    expect(res.topology.nanVertices).toBe(0);
    expect(res.topology.renderedTriangles).toBeGreaterThan(120000);

    const outlinerIds = res.outliner.map((n) => n.id);
    expect(outlinerIds).toContain('layer-1:rhizome');
    expect(outlinerIds).toContain('layer-1:crosiers');
    expect(outlinerIds).toContain('layer-1:fronds');
    expect(outlinerIds).toContain('layer-1:fronds:f01');
    expect(outlinerIds).toContain('layer-1:sori');

    const rep = res.layerReports[0].fern!;
    expect(rep.fronds).toBe(16);
    expect(rep.crosiers).toBe(4);
    expect(rep.leaflets).toBeGreaterThan(800);
    expect(rep.soriClusters).toBeGreaterThan(150);
  });

  it('synthesizes Studio Fur & Hair Grooms with guides, dense undercoat, clumped guard hairs & deterministic seeds', () => {
    const wolf = PRESETS.find((p) => p.name === 'Arctic Wolf Guard Pelt')!;
    const sceneA = cloneScene(wolf.scene);
    sceneA.layers[0].hair!.detailTier = 2;
    const sceneB = cloneScene(sceneA);

    const resA = buildSceneResponse(sceneA);
    const resB = buildSceneResponse(sceneB);

    expect(resA.topology.nanVertices).toBe(0);
    expect(resA.topology.renderedTriangles).toBe(resB.topology.renderedTriangles);
    expect(resA.parts[1].position[17]).toBe(resB.parts[1].position[17]);

    const outlinerIds = resA.outliner.map((n) => n.id);
    expect(outlinerIds).toContain('layer-1:guides');
    expect(outlinerIds).toContain('layer-1:undercoat');
    expect(outlinerIds).toContain('layer-1:guard');
    expect(outlinerIds).toContain('layer-1:whiskers');
  });

  it('exports valid quad-preserving Wavefront OBJ and multi-node binary glTF 2.0 (.glb)', () => {
    const preset = PRESETS.find((p) => p.name === 'Banana Grove & Moss Carpet')!;
    const scene = cloneScene(preset.scene);
    for (const l of scene.layers) {
      if (l.moss) l.moss.detailTier = 1;
      if (l.tropical) l.tropical.detailTier = 1;
    }
    const raw = buildSceneRaw(scene);

    const obj = partsToOBJ(raw.rawParts, 'banana_moss_test');
    expect(obj).toContain('o Welded_Pseudostem_Roots_Petioles');
    expect(obj).toContain('o Undulating_Forest_Carpet');
    expect(obj).toContain('\nv ');
    expect(obj).toContain('\nvn ');
    expect(obj).toContain('\nf ');

    const glb = partsToGLB(raw.rawParts, 'banana_moss_test');
    expect(glb.byteLength).toBeGreaterThan(1024);
    expect(glb.byteLength % 4).toBe(0);
    const dv = new DataView(glb);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    expect(dv.getUint32(4, true)).toBe(2); // version 2
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  });

  it('synthesizes Gigantic 3D Sculpted Flowers across all 12 species and 18 presets with closed 2-manifold welded stems, 14 vibrant colorways, and SO(3) wind', () => {
    const flowerPresets = PRESETS.filter((p) => p.group === 'Flowers · Gigantic 3D Blooms');
    expect(flowerPresets.length).toBe(18);
    expect(Object.keys(FLOWER_SPECIES_NAMES).length).toBe(12);
    expect(Object.keys(FLOWER_PALETTE_NAMES).length).toBe(14);

    const coveredSpecies = new Set<FlowerSpecies>();

    for (const preset of flowerPresets) {
      const scene = cloneScene(preset.scene);
      for (const l of scene.layers) {
        if (l.flower) {
          l.flower.detailTier = 2;
          coveredSpecies.add(l.flower.species);
        }
      }
      const raw = buildSceneRaw(scene);

      for (const l of scene.layers) {
        if (l.kind !== 'flower') continue;
        const stemMesh = raw.rawParts.find((m) => m.id === `${l.id}:stem`)!;
        expect(stemMesh, `${preset.name} (${l.id}) welded stem mesh`).toBeDefined();
        const val = validateWeldedManifold(stemMesh);
        expect(val.closed, `${preset.name} (${l.id}) closed stem manifold`).toBe(true);
        expect(val.manifold, `${preset.name} (${l.id}) 2-manifold edges`).toBe(true);
        expect(val.boundaryEdges, `${preset.name} (${l.id}) 0 boundary edges`).toBe(0);
        expect(val.nonManifoldEdges, `${preset.name} (${l.id}) 0 non-manifold edges`).toBe(0);
        expect(val.inconsistentEdges, `${preset.name} (${l.id}) consistent winding`).toBe(0);
        expect(val.eulerCharacteristic, `${preset.name} (${l.id}) Euler V - E + F = 2 * C`).toBe(
          2 * val.components,
        );

        const corollaMesh = raw.rawParts.find((m) => m.id === `${l.id}:corolla`)!;
        const reproMesh = raw.rawParts.find((m) => m.id === `${l.id}:reproductive`)!;
        expect(corollaMesh.shading).toBe('flower');
        expect(corollaMesh.renderedTriangles, `${preset.name} corolla tris`).toBeGreaterThan(1500);
        expect(reproMesh.renderedTriangles, `${preset.name} reproductive tris`).toBeGreaterThan(180);

        // Verify vibrant high-chroma petal colors (non-NaN, high channel saturation)
        let maxChroma = 0;
        for (let i = 0; i < corollaMesh.vertexCount; i++) {
          const r = corollaMesh.colors[i * 3];
          const g = corollaMesh.colors[i * 3 + 1];
          const b = corollaMesh.colors[i * 3 + 2];
          expect(Number.isFinite(r + g + b)).toBe(true);
          const hi = Math.max(r, g, b);
          const lo = Math.min(r, g, b);
          maxChroma = Math.max(maxChroma, hi - lo);
        }
        expect(maxChroma, `${preset.name} vibrant petal chroma`).toBeGreaterThan(0.35);
      }
    }

    // Every single one of the 12 botanical species must have a dedicated preset!
    for (const sp of Object.keys(FLOWER_SPECIES_NAMES) as FlowerSpecies[]) {
      expect(coveredSpecies.has(sp), `Preset coverage for species ${sp}`).toBe(true);
    }

    // Verify all non-custom colorways apply valid `#rrggbb` hexes
    const sampleFlp = { ...cloneScene(flowerPresets[0].scene).layers[0].flower! };
    for (const pal of Object.keys(FLOWER_PALETTE_NAMES) as FlowerColorPalette[]) {
      if (pal === 'custom') continue;
      applyFlowerPalette(sampleFlp, pal);
      expect(sampleFlp.huePrimary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(sampleFlp.hueSecondary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(sampleFlp.hueThroat).toMatch(/^#[0-9a-f]{6}$/i);
    }

    // Verify colorway switching + zero-scaling SO(3) Rodrigues petal wind + OBJ/GLB export
    const hibScene = cloneScene(flowerPresets[0].scene);
    applyFlowerPalette(hibScene.layers[0].flower!, 'bioluminescent_aurora');
    const res = buildSceneResponse(hibScene);
    expect(res.topology.nanVertices).toBe(0);
    expect(res.sceneHeight).toBeGreaterThan(3.0);

    const corollaPkt = res.parts.find((p) => p.id === 'layer-1:corolla')!;
    let maxDrift = 0;
    let maxPetalSway = 0;
    const vCount = corollaPkt.position.length / 3;
    for (let i = 0; i < vCount; i += 7) {
      const p0: [number, number, number] = [
        corollaPkt.position[i * 3],
        corollaPkt.position[i * 3 + 1],
        corollaPkt.position[i * 3 + 2],
      ];
      const t0: [number, number, number] = [
        corollaPkt.tangent[i * 3],
        corollaPkt.tangent[i * 3 + 1],
        corollaPkt.tangent[i * 3 + 2],
      ];
      const w0: [number, number, number, number] = [
        corollaPkt.wind[i * 4],
        corollaPkt.wind[i * 4 + 1],
        corollaPkt.wind[i * 4 + 2],
        corollaPkt.wind[i * 4 + 3],
      ];
      const pv: [number, number, number] = [
        corollaPkt.pivot[i * 3],
        corollaPkt.pivot[i * 3 + 1],
        corollaPkt.pivot[i * 3 + 2],
      ];
      const pW = evalWindVertex(p0, t0, w0, pv, 2.1, 0.9);
      const r0 = Math.hypot(p0[0] - pv[0], p0[1] - pv[1], p0[2] - pv[2]);
      const rW = Math.hypot(pW[0] - pv[0], pW[1] - pv[1], pW[2] - pv[2]);
      maxDrift = Math.max(maxDrift, Math.abs(rW - r0));
      maxPetalSway = Math.max(
        maxPetalSway,
        Math.hypot(pW[0] - p0[0], pW[1] - p0[1], pW[2] - p0[2]),
      );
    }
    expect(maxDrift).toBeLessThan(1e-5);
    expect(maxPetalSway).toBeGreaterThan(0.02);

    const rawHib = buildSceneRaw(hibScene);
    const glb = partsToGLB(rawHib.rawParts, 'colossal_hibiscus');
    expect(glb.byteLength).toBeGreaterThan(10000);
  });

  it('proves unified whole-plant & multi-plant kinematic wind synchronization, slender stems, and monopodial Moth Orchid habit', () => {
    const wLen = Math.hypot(0.82, 0.57);
    const wx = 0.82 / wLen;
    const wz = 0.57 / wLen;

    // 1. Titan Royal Sunflower: stem, branches, leaves, seed disc & yellow ray petals share 1 rootPivot/phase and sway together!
    const sunPreset = PRESETS.find((p) => p.name === 'Titan Royal Sunflower')!;
    const sunScene = cloneScene(sunPreset.scene);
    sunScene.layers[0].flower!.detailTier = 2;
    const sunRes = buildSceneResponse(sunScene);
    const sunPackets = sunRes.parts.filter((p) => p.id.startsWith('layer-1:'));
    expect(sunPackets.length).toBe(5);

    const refPiv: [number, number, number] = [
      sunPackets[0].pivot[0],
      sunPackets[0].pivot[1],
      sunPackets[0].pivot[2],
    ];
    const refPhase = sunPackets[0].wind[2];

    const partWindDisplacement = new Map<string, number>();
    for (const pkt of sunPackets) {
      const vc = pkt.position.length / 3;
      let sumDownwind = 0;
      let counted = 0;
      for (let i = 0; i < vc; i += 5) {
        expect(Math.abs(pkt.pivot[i * 3] - refPiv[0])).toBeLessThan(1e-5);
        expect(Math.abs(pkt.pivot[i * 3 + 1] - refPiv[1])).toBeLessThan(1e-5);
        expect(Math.abs(pkt.pivot[i * 3 + 2] - refPiv[2])).toBeLessThan(1e-5);
        expect(Math.abs(pkt.wind[i * 4 + 2] - refPhase)).toBeLessThan(1e-5);

        const p0: [number, number, number] = [
          pkt.position[i * 3],
          pkt.position[i * 3 + 1],
          pkt.position[i * 3 + 2],
        ];
        if (p0[1] < refPiv[1] + 1.8) continue; // upper plant crown (main stalk top, branches, buds, petals, seed disc)
        const t0: [number, number, number] = [
          pkt.tangent[i * 3],
          pkt.tangent[i * 3 + 1],
          pkt.tangent[i * 3 + 2],
        ];
        const w0: [number, number, number, number] = [
          pkt.wind[i * 4],
          pkt.wind[i * 4 + 1],
          pkt.wind[i * 4 + 2],
          pkt.wind[i * 4 + 3],
        ];
        const pW = evalWindVertex(p0, t0, w0, refPiv, 0.75, 1.35);
        sumDownwind += (pW[0] - p0[0]) * wx + (pW[2] - p0[2]) * wz;
        counted++;
      }
      if (counted > 0) {
        partWindDisplacement.set(pkt.id, sumDownwind / counted);
      }
    }

    // Upper stem/branches, calyx, yellow ray petals (corolla), Fibonacci seed disc (reproductive), and upper leaves ALL sway downwind together!
    for (const partId of [
      'layer-1:stem',
      'layer-1:calyx',
      'layer-1:corolla',
      'layer-1:reproductive',
      'layer-1:foliage',
    ]) {
      expect(partWindDisplacement.get(partId) ?? 0, `${partId} sways with plant`).toBeGreaterThan(0.05);
    }
    // Yellow ray petals (`corolla`) and Fibonacci seed disc (`reproductive`) move by nearly identical downwind displacement!
    const corollaDisp = partWindDisplacement.get('layer-1:corolla')!;
    const seedDisp = partWindDisplacement.get('layer-1:reproductive')!;
    expect(Math.abs(corollaDisp - seedDisp)).toBeLessThan(0.035);

    // 2. Grand Moth Orchid: low monopodial basal rosette, overarching raceme, and slender stem
    const orchidPreset = PRESETS.find((p) => p.name === 'Grand Moth Orchid')!;
    const orchidScene = cloneScene(orchidPreset.scene);
    orchidScene.layers[0].flower!.detailTier = 2;
    const orchidRes = buildSceneResponse(orchidScene);
    const orchidStem = orchidRes.parts.find((p) => p.id === 'layer-1:stem')!;
    const orchidFoliage = orchidRes.parts.find((p) => p.id === 'layer-1:foliage')!;
    const orchidCorolla = orchidRes.parts.find((p) => p.id === 'layer-1:corolla')!;

    const baseY = orchidStem.pivot[1];
    let maxFoliageY = -Infinity;
    for (let i = 0; i < orchidFoliage.position.length / 3; i++) {
      maxFoliageY = Math.max(maxFoliageY, orchidFoliage.position[i * 3 + 1]);
    }
    // Basal Phalaenopsis strap leaves stay nestled low in the monopodial crown (< 26% of plant height)
    expect(maxFoliageY - baseY).toBeLessThan(orchidScene.layers[0].flower!.plantHeight * 0.26);

    let maxCorollaReach = 0;
    for (let i = 0; i < orchidCorolla.position.length / 3; i++) {
      const dx = orchidCorolla.position[i * 3] - orchidStem.pivot[0];
      const dz = orchidCorolla.position[i * 3 + 2] - orchidStem.pivot[2];
      maxCorollaReach = Math.max(maxCorollaReach, Math.hypot(dx, dz));
    }
    // Cascading raceme sweeps gracefully outward horizontally (> 42% of plant height)
    expect(maxCorollaReach).toBeGreaterThan(orchidScene.layers[0].flower!.plantHeight * 0.42);

    // 3. Exotic Conservatory Trio: all 3 neighboring flower plants sway coherently in the SAME wind direction!
    const trioPreset = PRESETS.find((p) => p.name === 'Exotic Conservatory Trio')!;
    const trioScene = cloneScene(trioPreset.scene);
    for (const l of trioScene.layers) if (l.flower) l.flower.detailTier = 1;
    const trioRes = buildSceneResponse(trioScene);

    for (const layerId of ['layer-1', 'layer-2', 'layer-3']) {
      const cor = trioRes.parts.find((p) => p.id === `${layerId}:corolla`)!;
      let sumDown = 0;
      const n = cor.position.length / 3;
      for (let i = 0; i < n; i += 9) {
        const p0: [number, number, number] = [cor.position[i * 3], cor.position[i * 3 + 1], cor.position[i * 3 + 2]];
        const t0: [number, number, number] = [cor.tangent[i * 3], cor.tangent[i * 3 + 1], cor.tangent[i * 3 + 2]];
        const w0: [number, number, number, number] = [cor.wind[i * 4], cor.wind[i * 4 + 1], cor.wind[i * 4 + 2], cor.wind[i * 4 + 3]];
        const pv: [number, number, number] = [cor.pivot[i * 3], cor.pivot[i * 3 + 1], cor.pivot[i * 3 + 2]];
        const pW = evalWindVertex(p0, t0, w0, pv, 0.75, 1.25);
        sumDown += (pW[0] - p0[0]) * wx + (pW[2] - p0[2]) * wz;
      }
      expect(sumDown / Math.ceil(n / 9), `${layerId} sways positively with shared garden breeze`).toBeGreaterThan(0.06);
    }
  });

  it('validates all WebGL GLSL shaders have matching vertex/fragment varyings and zero undeclared v* / u* symbols', () => {
    const extractDecls = (glsl: string, qual: string): Set<string> => {
      const out = new Set<string>();
      const re = new RegExp(`\\b${qual}\\s+\\w+\\s+(\\w+)\\s*;`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(glsl)) !== null) out.add(m[1]);
      return out;
    };

    const vertVaryings = extractDecls(SPECIMEN_VERT, 'varying');
    const fragVaryings = extractDecls(SPECIMEN_FRAG, 'varying');
    for (const v of fragVaryings) {
      expect(vertVaryings.has(v), `Fragment varying ${v} declared in SPECIMEN_VERT`).toBe(true);
    }

    for (const [label, src] of [
      ['SPECIMEN_VERT', SPECIMEN_VERT],
      ['SPECIMEN_FRAG', SPECIMEN_FRAG],
      ['WIRE_VERT', WIRE_VERT],
      ['WIRE_FRAG', WIRE_FRAG],
      ['SHADOW_DISC_FRAG', SHADOW_DISC_FRAG],
    ] as const) {
      const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const declaredV = extractDecls(stripped, 'varying');
      const declaredU = extractDecls(stripped, 'uniform');
      const declaredA = extractDecls(stripped, 'attribute');
      const usedV = stripped.match(/\bv[A-Z]\w*\b/g) ?? [];
      const usedU = stripped.match(/\bu[A-Z]\w*\b/g) ?? [];
      const usedA = stripped.match(/\ba[A-Z]\w*\b/g) ?? [];

      for (const id of usedV) {
        expect(declaredV.has(id), `${label}: undeclared varying ${id}`).toBe(true);
      }
      for (const id of usedU) {
        expect(declaredU.has(id), `${label}: undeclared uniform ${id}`).toBe(true);
      }
      for (const id of usedA) {
        expect(declaredA.has(id), `${label}: undeclared attribute ${id}`).toBe(true);
      }
    }
  });

  it('guarantees unified C0 wind sway on Ferns & Broadleaf plants (zero left/right frond splitting, active terminal frond-tip sway, and welded sori)', () => {
    // 1. Western Sword Fern: verify every frond's terminal tip moves MORE than its mid-span & base,
    //    every part shares the unified crownPivot, and left/right pinnae never scissor apart!
    const fernPreset = PRESETS.find((p) => p.name === 'Western Sword Fern')!;
    const fernScene = cloneScene(fernPreset.scene);
    fernScene.layers[0].fern!.detailTier = 2;
    const fernRes = buildSceneResponse(fernScene);

    const frond1 = fernRes.parts.find((p) => p.id === 'layer-1:fronds:f01')!;
    const sori = fernRes.parts.find((p) => p.id === 'layer-1:sori')!;
    const crownPiv: [number, number, number] = [frond1.pivot[0], frond1.pivot[1], frond1.pivot[2]];

    let maxRadiusReach = 0;
    const vc = frond1.position.length / 3;
    for (let i = 0; i < vc; i++) {
      // Every vertex on the frond pivots around the shared crownPivot
      expect(Math.abs(frond1.pivot[i * 3] - crownPiv[0])).toBeLessThan(1e-5);
      expect(Math.abs(frond1.pivot[i * 3 + 1] - crownPiv[1])).toBeLessThan(1e-5);
      expect(Math.abs(frond1.pivot[i * 3 + 2] - crownPiv[2])).toBeLessThan(1e-5);
      const r = Math.hypot(
        frond1.position[i * 3] - crownPiv[0],
        frond1.position[i * 3 + 1] - crownPiv[1],
        frond1.position[i * 3 + 2] - crownPiv[2],
      );
      maxRadiusReach = Math.max(maxRadiusReach, r);
    }

    // Compare displacement in basal third, middle third, and terminal 12% frond tip under strong wind (1.35)
    let sumBaseDisp = 0, cntBase = 0;
    let sumMidDisp = 0, cntMid = 0;
    let sumTipDisp = 0, cntTip = 0;
    let maxChordStretch = 0;

    for (let i = 0; i < vc; i++) {
      const p0: [number, number, number] = [
        frond1.position[i * 3],
        frond1.position[i * 3 + 1],
        frond1.position[i * 3 + 2],
      ];
      const t0: [number, number, number] = [
        frond1.tangent[i * 3],
        frond1.tangent[i * 3 + 1],
        frond1.tangent[i * 3 + 2],
      ];
      const w0: [number, number, number, number] = [
        frond1.wind[i * 4],
        frond1.wind[i * 4 + 1],
        frond1.wind[i * 4 + 2],
        frond1.wind[i * 4 + 3],
      ];
      const pW = evalWindVertex(p0, t0, w0, crownPiv, 0.65, 1.35);
      const r0 = Math.hypot(p0[0] - crownPiv[0], p0[1] - crownPiv[1], p0[2] - crownPiv[2]);
      const rW = Math.hypot(pW[0] - crownPiv[0], pW[1] - crownPiv[1], pW[2] - crownPiv[2]);
      maxChordStretch = Math.max(maxChordStretch, Math.abs(rW - r0));

      const disp = Math.hypot(pW[0] - p0[0], pW[1] - p0[1], pW[2] - p0[2]);
      const rFrac = r0 / maxRadiusReach;
      if (rFrac < 0.30) {
        sumBaseDisp += disp;
        cntBase++;
      } else if (rFrac > 0.45 && rFrac < 0.65) {
        sumMidDisp += disp;
        cntMid++;
      } else if (rFrac > 0.88) {
        sumTipDisp += disp;
        cntTip++;
      }
    }

    expect(maxChordStretch).toBeLessThan(1e-6);
    const avgBase = sumBaseDisp / Math.max(1, cntBase);
    const avgMid = sumMidDisp / Math.max(1, cntMid);
    const avgTip = sumTipDisp / Math.max(1, cntTip);
    // Terminal frond tip MUST move significantly more than mid-frond and base (never frozen at tip!)
    expect(avgTip).toBeGreaterThan(avgMid * 1.35);
    expect(avgMid).toBeGreaterThan(avgBase * 1.8);
    expect(avgTip).toBeGreaterThan(0.18);

    // Every sorus dome also pivots around `crownPiv` so sori stay welded to pinna undersides
    for (let i = 0; i < sori.position.length / 3; i += 7) {
      expect(Math.abs(sori.pivot[i * 3] - crownPiv[0])).toBeLessThan(1e-5);
      expect(Math.abs(sori.pivot[i * 3 + 1] - crownPiv[1])).toBeLessThan(1e-5);
      expect(Math.abs(sori.pivot[i * 3 + 2] - crownPiv[2])).toBeLessThan(1e-5);
    }

    // 2. Swiss Cheese Monstera: petiole tip and leaf-blade base share identical crownPivot, phase, and flex
    const monsteraPreset = PRESETS.find((p) => p.name === 'Swiss Cheese Monstera')!;
    const mScene = cloneScene(monsteraPreset.scene);
    mScene.layers[0].fern!.detailTier = 2;
    const mRes = buildSceneResponse(mScene);
    const mLeaf = mRes.parts.find((p) => p.id === 'layer-1:fronds:f01')!;
    const mPiv: [number, number, number] = [mLeaf.pivot[0], mLeaf.pivot[1], mLeaf.pivot[2]];
    let maxTriangleEdgeStretch = 0;
    for (let f = 0; f < mLeaf.index.length; f += 9) {
      const ia = mLeaf.index[f];
      const ib = mLeaf.index[f + 1];
      const pa0: [number, number, number] = [mLeaf.position[ia * 3], mLeaf.position[ia * 3 + 1], mLeaf.position[ia * 3 + 2]];
      const pb0: [number, number, number] = [mLeaf.position[ib * 3], mLeaf.position[ib * 3 + 1], mLeaf.position[ib * 3 + 2]];
      const paW = evalWindVertex(
        pa0,
        [mLeaf.tangent[ia * 3], mLeaf.tangent[ia * 3 + 1], mLeaf.tangent[ia * 3 + 2]],
        [mLeaf.wind[ia * 4], mLeaf.wind[ia * 4 + 1], mLeaf.wind[ia * 4 + 2], mLeaf.wind[ia * 4 + 3]],
        mPiv,
        0.75,
        1.35,
      );
      const pbW = evalWindVertex(
        pb0,
        [mLeaf.tangent[ib * 3], mLeaf.tangent[ib * 3 + 1], mLeaf.tangent[ib * 3 + 2]],
        [mLeaf.wind[ib * 4], mLeaf.wind[ib * 4 + 1], mLeaf.wind[ib * 4 + 2], mLeaf.wind[ib * 4 + 3]],
        mPiv,
        0.75,
        1.35,
      );
      const d0 = Math.hypot(pb0[0] - pa0[0], pb0[1] - pa0[1], pb0[2] - pa0[2]);
      const dW = Math.hypot(pbW[0] - paW[0], pbW[1] - paW[1], pbW[2] - paW[2]);
      if (d0 > 0.002) {
        maxTriangleEdgeStretch = Math.max(maxTriangleEdgeStretch, Math.abs(dW - d0));
      }
    }
    // Zero seam tearing across petiole-to-blade junction (< 4 mm across entire 1.35x gale!)
    expect(maxTriangleEdgeStretch).toBeLessThan(0.004);
  });

  it('guarantees unified C0 wind sway across Trees & Palms (swaying trunks/branches, zero detached leaf shuffle, and sculpted costapalmate fans)', () => {
    // 1. Ancient English Oak: trunk, branches, and canopy leaves share groundOrigin + treePhase,
    //    canopy wood sways actively (`limbFlex > 0`), and leaf bases stay welded to twigs!
    const oakPreset = PRESETS.find((p) => p.name === 'Ancient English Oak')!;
    const oakScene = cloneScene(oakPreset.scene);
    oakScene.layers[0].tree!.detailTier = 2;
    const oakRes = buildSceneResponse(oakScene);

    const oakWood = oakRes.parts.find((p) => p.id === 'layer-1:wood')!;
    const oakLeaves = oakRes.parts.find((p) => p.id === 'layer-1:leaves')!;

    const treePiv: [number, number, number] = [oakWood.pivot[0], oakWood.pivot[1], oakWood.pivot[2]];
    const treePhase = oakWood.wind[2];

    let maxWoodFlex = 0;
    let maxWoodDisp = 0;
    for (let i = 0; i < oakWood.position.length / 3; i += 7) {
      maxWoodFlex = Math.max(maxWoodFlex, oakWood.wind[i * 4 + 1]);
      const p0: [number, number, number] = [oakWood.position[i * 3], oakWood.position[i * 3 + 1], oakWood.position[i * 3 + 2]];
      const pW = evalWindVertex(
        p0,
        [oakWood.tangent[i * 3], oakWood.tangent[i * 3 + 1], oakWood.tangent[i * 3 + 2]],
        [oakWood.wind[i * 4], oakWood.wind[i * 4 + 1], oakWood.wind[i * 4 + 2], oakWood.wind[i * 4 + 3]],
        treePiv,
        0.75,
        1.35,
      );
      maxWoodDisp = Math.max(maxWoodDisp, Math.hypot(pW[0] - p0[0], pW[1] - p0[1], pW[2] - p0[2]));
    }
    expect(maxWoodFlex).toBeGreaterThan(0.12); // Trunk & canopy limbs sway smoothly in wind!
    expect(maxWoodDisp).toBeGreaterThan(0.25);

    // Every leaf shares exact `treePiv` and `treePhase`, and leaf base vertices (`v == 0`) have `flutter === 0`!
    let leafBaseChecked = 0;
    for (let i = 0; i < oakLeaves.position.length / 3; i++) {
      expect(Math.abs(oakLeaves.pivot[i * 3] - treePiv[0])).toBeLessThan(1e-5);
      expect(Math.abs(oakLeaves.pivot[i * 3 + 1] - treePiv[1])).toBeLessThan(1e-5);
      expect(Math.abs(oakLeaves.pivot[i * 3 + 2] - treePiv[2])).toBeLessThan(1e-5);
      expect(Math.abs(oakLeaves.wind[i * 4 + 2] - treePhase)).toBeLessThan(1e-5);
      if (oakLeaves.uv[i * 2 + 1] < 1e-4) {
        expect(oakLeaves.wind[i * 4 + 3]).toBe(0);
        leafBaseChecked++;
      }
    }
    expect(leafBaseChecked).toBeGreaterThan(200);

    // 2. Desert Oasis Fan Palm & Coastal Coconut Palm: unified groundOrigin pivot across trunk, rachis, leaflets & fruits!
    for (const palmName of ['Coastal Coconut Palm', 'Desert Oasis Fan Palm'] as const) {
      const palmPreset = PRESETS.find((p) => p.name === palmName)!;
      const palmScene = cloneScene(palmPreset.scene);
      palmScene.layers[0].palm!.detailTier = 2;
      const raw = buildSceneRaw(palmScene);
      const leafletRaw = raw.rawParts.find((pm) => pm.id === 'layer-1:leaflets')!;
      expect(leafletRaw.hasExplicitNormals).toBe(true);

      const palmRes = buildSceneResponse(palmScene);
      const pTrunk = palmRes.parts.find((p) => p.id === 'layer-1:skeleton')!;
      const pRachis = palmRes.parts.find((p) => p.id === 'layer-1:rachises')!;
      const pLeaflets = palmRes.parts.find((p) => p.id === 'layer-1:leaflets')!;
      const pFruits = palmRes.parts.find((p) => p.id === 'layer-1:fruits')!;

      const gPiv: [number, number, number] = [pTrunk.pivot[0], pTrunk.pivot[1], pTrunk.pivot[2]];
      for (const pkt of [pTrunk, pRachis, pLeaflets, pFruits]) {
        for (let i = 0; i < pkt.position.length / 3; i += 11) {
          expect(Math.abs(pkt.pivot[i * 3] - gPiv[0]), `${palmName} ${pkt.id} pivot.x`).toBeLessThan(1e-5);
          expect(Math.abs(pkt.pivot[i * 3 + 1] - gPiv[1]), `${palmName} ${pkt.id} pivot.y`).toBeLessThan(1e-5);
          expect(Math.abs(pkt.pivot[i * 3 + 2] - gPiv[2]), `${palmName} ${pkt.id} pivot.z`).toBeLessThan(1e-5);
        }
      }
    }
  });

  it('synthesizes all 18 Sea Plants, Sea Vegetation & Marine Species with watertight Staghorn Coral & Velvet Codium manifolds, 16 marine palettes, seabed substrates, and C0 ocean-current SO(3) continuity', () => {
    const speciesIds = Object.keys(MARINE_SPECIES_NAMES) as MarineSpecies[];
    const paletteIds = (Object.keys(MARINE_PALETTE_NAMES) as MarineColorPalette[]).filter(
      (k) => k !== 'custom',
    );
    expect(speciesIds.length).toBe(18);
    expect(paletteIds.length).toBe(16);

    // 1. Verify all 18 marine species + all 16 palettes build cleanly with populated MarineStats!
    const basePreset = PRESETS.find((p) => p.name === 'Pacific Giant Bladder Kelp')!;
    for (let idx = 0; idx < speciesIds.length; idx++) {
      const spId = speciesIds[idx];
      const palId = paletteIds[idx % paletteIds.length];
      const scene = cloneScene(basePreset.scene);
      scene.substrate.kind = idx % 2 === 0 ? 'coral_reef_ledge' : 'rippled_seabed_sand';
      const mp = { ...DEFAULT_MARINE_PARAMS };
      applyMarineSpeciesDefaults(mp, spId);
      applyMarinePalette(mp, palId);
      mp.detailTier = 2;
      scene.layers[0].marine = mp;

      const res = buildSceneResponse(scene);
      expect(res.topology.nanVertices, `${spId} NaN check`).toBe(0);
      expect(res.topology.degenerateFaces, `${spId} degenerate check`).toBe(0);
      expect(res.topology.renderedTriangles, `${spId} triangle count`).toBeGreaterThan(2500);

      const mStats = res.layerReports[0].marine!;
      expect(mStats, `${spId} marine report`).toBeDefined();
      expect(
        mStats.stemsOrTubes + mStats.bladesOrTentacles + mStats.vesiclesOrPolyps,
        `${spId} organ count`,
      ).toBeGreaterThan(0);

      // Verify unified groundOrigin pivot across all emitted marine parts + isometric SO(3) current deformation!
      const marinePkts = res.parts.filter((pk) => pk.id.startsWith('layer-1:'));
      expect(marinePkts.length).toBeGreaterThanOrEqual(2);
      const gPiv: [number, number, number] = [
        marinePkts[0].pivot[0],
        marinePkts[0].pivot[1],
        marinePkts[0].pivot[2],
      ];
      let maxPivotChordDrift = 0;
      let maxCurrentDisp = 0;
      for (const pkt of marinePkts) {
        for (let i = 0; i < pkt.position.length / 3; i += 9) {
          expect(Math.abs(pkt.pivot[i * 3] - gPiv[0]), `${spId} ${pkt.id} pivot.x`).toBeLessThan(1e-5);
          expect(Math.abs(pkt.pivot[i * 3 + 1] - gPiv[1]), `${spId} ${pkt.id} pivot.y`).toBeLessThan(1e-5);
          expect(Math.abs(pkt.pivot[i * 3 + 2] - gPiv[2]), `${spId} ${pkt.id} pivot.z`).toBeLessThan(1e-5);

          const p0: [number, number, number] = [pkt.position[i * 3], pkt.position[i * 3 + 1], pkt.position[i * 3 + 2]];
          const pW = evalWindVertex(
            p0,
            [pkt.tangent[i * 3], pkt.tangent[i * 3 + 1], pkt.tangent[i * 3 + 2]],
            [pkt.wind[i * 4], pkt.wind[i * 4 + 1], pkt.wind[i * 4 + 2], pkt.wind[i * 4 + 3]],
            gPiv,
            1.15,
            0.85,
          );
          const r0 = Math.hypot(p0[0] - gPiv[0], p0[1] - gPiv[1], p0[2] - gPiv[2]);
          const rW = Math.hypot(pW[0] - gPiv[0], pW[1] - gPiv[1], pW[2] - gPiv[2]);
          maxPivotChordDrift = Math.max(maxPivotChordDrift, Math.abs(rW - r0));
          maxCurrentDisp = Math.max(maxCurrentDisp, Math.hypot(pW[0] - p0[0], pW[1] - p0[1], pW[2] - p0[2]));
        }
      }
      expect(maxPivotChordDrift, `${spId} isometric SO(3) chord preservation`).toBeLessThan(1e-5);
      if (spId === 'staghorn_coral' || spId === 'azure_tube_sponge') {
        // Calcified stony coral & spicule-reinforced sponge stay structurally stiff with subtle polyp/osculum micro-quiver!
        expect(maxCurrentDisp, `${spId} subtle polyp/osculum micro-motion`).toBeGreaterThan(0.001);
        expect(maxCurrentDisp, `${spId} stony skeleton stiffness`).toBeLessThan(0.06);
      } else {
        // Flexible kelps, macroalgae, seagrasses, gorgonian fans, anemones & crinoids sway gracefully in ocean surge!
        expect(maxCurrentDisp, `${spId} ocean current sway`).toBeGreaterThan(0.015);
      }
    }

    // 2. Prove watertight closed 2-manifold Euler topology (V - E + F = 2) on BOTH Staghorn Coral & Velvet Codium!
    for (const manifoldPresetName of ['Rose-Gold Staghorn Coral', 'Velvet Staghorn Sponge-Weed'] as const) {
      const mPreset = PRESETS.find((p) => p.name === manifoldPresetName)!;
      const mRaw = buildSceneRaw(cloneScene(mPreset.scene));
      const mThallus = mRaw.rawParts.find((pm) => pm.id === 'layer-1:holdfast')!;
      const mTopo = validateWeldedManifold(mThallus);
      expect(mTopo.closed, `${manifoldPresetName} closed`).toBe(true);
      expect(mTopo.manifold, `${manifoldPresetName} manifold`).toBe(true);
      expect(mTopo.boundaryEdges, `${manifoldPresetName} boundaryEdges`).toBe(0);
      expect(mTopo.nonManifoldEdges, `${manifoldPresetName} nonManifoldEdges`).toBe(0);
      expect(mTopo.components, `${manifoldPresetName} components`).toBe(1);
      expect(mTopo.eulerCharacteristic, `${manifoldPresetName} V-E+F`).toBe(2);
      expect(mRaw.layerReports[0].marine!.closedManifold).toBe(true);
    }

    // 3. Verify all 4 multi-layer underwater flora & reef ecosystems compose cleanly!
    for (const ecoName of [
      'Living Coral Reef Sanctuary',
      'Pacific Kelp & Seagrass Lagoon',
      'Intertidal Tidepool Seaweed Garden',
      'Tropical Lagoon Sea-Grape & Wineglass Meadow',
    ] as const) {
      const eco = PRESETS.find((p) => p.name === ecoName)!;
      const ecoRes = buildSceneResponse(cloneScene(eco.scene));
      expect(ecoRes.topology.nanVertices, `${ecoName} NaN`).toBe(0);
      expect(ecoRes.layerReports.length).toBeGreaterThanOrEqual(4);
      expect(ecoRes.topology.renderedTriangles).toBeGreaterThan(25000);
    }
  });
});

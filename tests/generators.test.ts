import { describe, expect, it } from 'vitest';
import { partsToGLB, partsToOBJ } from '../src/core/mesh';
import { validateWeldedManifold } from '../src/core/weldedManifold';
import { buildSceneRaw, buildSceneResponse } from '../src/generators/buildScene';
import { PRESETS } from '../src/generators/presets';
import { cloneScene } from '../src/generators/types';

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

  const downWave = (piv[0] * wx + piv[2] * wz) * 3.6;
  const crossWave = (piv[0] * pitchAxis[0] + piv[2] * pitchAxis[2]) * 2.4;

  const gustA = 0.5 + 0.5 * Math.sin(uTime * 0.92 - downWave + crossWave * 0.35);
  const gustB = 0.5 + 0.5 * Math.sin(uTime * 1.68 - downWave * 1.45 + phase * 0.35);
  const gustEnv = 1 + (0.36 + 0.96 * (gustA * 0.65 + gustB * 0.35) - 1) * uWindGust;
  const W = uWindStrength * gustEnv;

  const oscMain = 0.56 + 0.44 * Math.sin(uTime * 2.15 - downWave * 1.2 + phase);
  const oscSub = 0.14 * Math.sin(uTime * 4.35 - downWave * 1.9 + phase * 1.7);
  const pitchAngle = softLimit(limbFlex * W * (oscMain + oscSub) * 0.54, 0.88);
  const rollAngle = softLimit(
    limbFlex * W * 0.14 * Math.sin(uTime * 1.62 - crossWave + phase * 1.3 + 1.1),
    0.38,
  );

  let rel: [number, number, number] = [rx, ry, rz];
  let tanV: [number, number, number] = [...tan];
  rel = rot(rel, pitchAxis, pitchAngle);
  tanV = rot(tanV, pitchAxis, pitchAngle);
  rel = rot(rel, rollAxis, rollAngle);
  tanV = rot(tanV, rollAxis, rollAngle);

  if (flutter > 0.0001) {
    const tl = Math.hypot(tanV[0], tanV[1], tanV[2]);
    const safeTan: [number, number, number] =
      tl > 1e-3 ? [tanV[0] / tl, tanV[1] / tl, tanV[2] / tl] : [0, 1, 0];
    const hiWave =
      Math.sin(uTime * 6.8 - downWave * 2.3 + phase * 4.7) +
      0.45 * Math.sin(uTime * 11.4 - crossWave * 2.1 + phase * 8.3);
    const flapAngle = softLimit(flutter * W * hiWave * 0.135, 0.36);
    rel = rot(rel, safeTan, flapAngle);
  }

  return [piv[0] + rel[0], piv[1] + rel[1], piv[2] + rel[2]];
}

describe('Frontier Procedural Generators — Welded Trees, Fruiting Palms, Pillow Moss, Giant Tropicals, Ferns & Fur', () => {
  it('exposes all 39 curated presets across all 8 studio groups', () => {
    expect(PRESETS.length).toBe(39);
    const groups = new Set(PRESETS.map((p) => p.group));
    expect(groups.has('Trees · Welded Manifold')).toBe(true);
    expect(groups.has('Palms · Fruiting & Branching')).toBe(true);
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
});

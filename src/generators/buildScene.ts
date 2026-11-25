/**
 * Unified Scene Builder: runs HostSubstrate + every active GeneratorLayer,
 * constructs the complete hierarchical Scene Outliner tree, computes macro
 * inspection focus coordinates, and packs zero-copy GPU buffers or OBJ/GLB exports.
 */

import { PartMesh, PartPacket, auditParts } from '../core/mesh';
import { HostSubstrate, SUBSTRATE_NAMES } from '../substrates/substrate';
import { DEFAULT_FERN_PARAMS } from './fernParams';
import { FernMesher } from './fernMesher';
import { DEFAULT_HAIR_PARAMS } from './hairParams';
import { HairMesher } from './hairMesher';
import { DEFAULT_MOSS_PARAMS } from './mossParams';
import { MossMesher } from './mossMesher';
import { DEFAULT_PALM_PARAMS } from './palmParams';
import { PalmMesher } from './palmMesher';
import { DEFAULT_TREE_PARAMS } from './treeParams';
import { TreeMesher } from './treeMesher';
import { DEFAULT_TROPICAL_PARAMS } from './tropicalParams';
import { TropicalMesher } from './tropicalMesher';
import { LayerRuntimeReport, OutlinerNode, SceneBuildResponse, SceneSpec } from './types';

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface BuiltSceneRaw {
  rawParts: PartMesh[];
  outliner: OutlinerNode[];
  layerReports: LayerRuntimeReport[];
  substrateMs: number;
  generatorsMs: number;
  macroTarget: [number, number, number, number];
}

export function buildSceneRaw(scene: SceneSpec): BuiltSceneRaw {
  const t0 = nowMs();
  const rawParts: PartMesh[] = [];
  const layerReports: LayerRuntimeReport[] = [];

  const rootSeed = scene.layers[0]?.seed ?? 42;
  const substrate = new HostSubstrate(scene.substrate, rootSeed + 203);
  const subMesh = substrate.buildMesh('substrate:host', 'scene:root');
  if (subMesh) {
    rawParts.push(subMesh);
  }
  const t1 = nowMs();

  let macroTarget: [number, number, number, number] = [0, 0.25, 0, 0.14];

  for (const layer of scene.layers) {
    const { x, y, z, yaw, scale } = layer.transform;
    const needsTransform = x !== 0 || y !== 0 || z !== 0 || yaw !== 0 || scale !== 1;

    if (layer.kind === 'tree') {
      const trp = layer.tree ?? { ...DEFAULT_TREE_PARAMS };
      const built = new TreeMesher(trp, layer.seed, substrate).build(layer.id);
      let lTris = 0;
      let lVerts = 0;
      for (const pm of built.parts) {
        if (needsTransform) pm.applyTransform(x, y, z, yaw, scale);
        lTris += pm.renderedTriangles;
        lVerts += pm.vertexCount;
        rawParts.push(pm);
      }
      layerReports.push({
        layerId: layer.id,
        kind: 'tree',
        tree: built.stats,
        triangles: lTris,
        vertices: lVerts,
      });
      // Aim macro target onto the main welded bough collar zone!
      macroTarget = [x, y + trp.height * 0.28, z, Math.max(0.85, trp.height * trp.trunkRatio * 2.8)];
    } else if (layer.kind === 'palm') {
      const pp = layer.palm ?? { ...DEFAULT_PALM_PARAMS };
      const built = new PalmMesher(pp, layer.seed, substrate).build(layer.id);
      let lTris = 0;
      let lVerts = 0;
      for (const pm of built.parts) {
        if (needsTransform) pm.applyTransform(x, y, z, yaw, scale);
        lTris += pm.renderedTriangles;
        lVerts += pm.vertexCount;
        rawParts.push(pm);
      }
      layerReports.push({
        layerId: layer.id,
        kind: 'palm',
        palm: built.stats,
        triangles: lTris,
        vertices: lVerts,
      });
      // Aim macro target onto the fruiting crown / spadix zone!
      const fruitMesh = built.parts.find((m) => m.id.endsWith(':fruits') && m.vertexCount > 12);
      if (fruitMesh) {
        const mid = Math.floor(fruitMesh.vertexCount * 0.5) * 3;
        macroTarget = [
          fruitMesh.positions[mid],
          fruitMesh.positions[mid + 1],
          fruitMesh.positions[mid + 2],
          Math.max(1.1, pp.trunkRadius * 5.0),
        ];
      } else {
        macroTarget = [x, y + pp.trunkHeight * 0.88, z, Math.max(1.2, pp.frondLength * 0.45)];
      }
    } else if (layer.kind === 'fern') {
      const fp = layer.fern ?? { ...DEFAULT_FERN_PARAMS };
      const built = new FernMesher(fp, layer.seed, substrate).build(layer.id);
      let lTris = 0;
      let lVerts = 0;
      for (const pm of built.parts) {
        if (needsTransform) pm.applyTransform(x, y, z, yaw, scale);
        lTris += pm.renderedTriangles;
        lVerts += pm.vertexCount;
        rawParts.push(pm);
      }
      layerReports.push({
        layerId: layer.id,
        kind: 'fern',
        fern: built.stats,
        triangles: lTris,
        vertices: lVerts,
      });
      // Aim macro target onto a mid-canopy frond pinna!
      const sampleFrond = built.parts.find((m) => m.id.includes(':fronds:f') && m.vertexCount > 30);
      if (sampleFrond) {
        const mid = Math.floor(sampleFrond.vertexCount * 0.55) * 3;
        macroTarget = [
          sampleFrond.positions[mid],
          sampleFrond.positions[mid + 1],
          sampleFrond.positions[mid + 2],
          Math.max(0.06, fp.frondWidth * 0.55),
        ];
      }
    } else if (layer.kind === 'tropical') {
      const tp = layer.tropical ?? { ...DEFAULT_TROPICAL_PARAMS };
      const built = new TropicalMesher(tp, layer.seed, substrate).build(layer.id);
      let lTris = 0;
      let lVerts = 0;
      for (const pm of built.parts) {
        if (needsTransform) pm.applyTransform(x, y, z, yaw, scale);
        lTris += pm.renderedTriangles;
        lVerts += pm.vertexCount;
        rawParts.push(pm);
      }
      layerReports.push({
        layerId: layer.id,
        kind: 'tropical',
        tropical: built.stats,
        triangles: lTris,
        vertices: lVerts,
      });
      // Aim macro target onto a mid-canopy wind-split tropical paddle or inflorescence!
      const sampleLeaf = built.parts.find((m) => m.id.includes(':leaves:l') && m.vertexCount > 40);
      if (sampleLeaf) {
        const mid = Math.floor(sampleLeaf.vertexCount * 0.5) * 3;
        macroTarget = [
          sampleLeaf.positions[mid],
          sampleLeaf.positions[mid + 1],
          sampleLeaf.positions[mid + 2],
          Math.max(0.22, tp.leafWidth * 0.85),
        ];
      }
    } else if (layer.kind === 'moss') {
      const mp = layer.moss ?? { ...DEFAULT_MOSS_PARAMS };
      const built = new MossMesher(mp, layer.seed, substrate).build(layer.id);
      let lTris = 0;
      let lVerts = 0;
      for (const pm of built.parts) {
        if (needsTransform) pm.applyTransform(x, y, z, yaw, scale);
        lTris += pm.renderedTriangles;
        lVerts += pm.vertexCount;
        rawParts.push(pm);
      }
      layerReports.push({
        layerId: layer.id,
        kind: 'moss',
        moss: built.stats,
        triangles: lTris,
        vertices: lVerts,
      });
      const phyl = built.parts.find((m) => m.id.endsWith(':phyllids') && m.vertexCount > 12);
      if (phyl && scene.layers.length === 1) {
        if (mp.habit === 'billowing_pillow') {
          macroTarget = [x - 0.02, y + 0.035, z + 0.01, 0.14];
        } else {
          const mid = Math.floor(phyl.vertexCount * 0.35) * 3;
          macroTarget = [phyl.positions[mid], phyl.positions[mid + 1], phyl.positions[mid + 2], Math.max(0.035, mp.shootHeightMm * 0.0018)];
        }
      }
    } else if (layer.kind === 'hair') {
      const hp = layer.hair ?? { ...DEFAULT_HAIR_PARAMS };
      const built = new HairMesher(hp, layer.seed, substrate).build(layer.id);
      let lTris = 0;
      let lVerts = 0;
      for (const pm of built.parts) {
        if (needsTransform) pm.applyTransform(x, y, z, yaw, scale);
        lTris += pm.renderedTriangles;
        lVerts += pm.vertexCount;
        rawParts.push(pm);
      }
      layerReports.push({
        layerId: layer.id,
        kind: 'hair',
        hair: built.stats,
        triangles: lTris,
        vertices: lVerts,
      });
      const guard = built.parts.find((m) => m.id.endsWith(':guard') && m.vertexCount > 12);
      if (guard && scene.layers.length === 1) {
        const mid = Math.floor(guard.vertexCount * 0.35) * 3;
        macroTarget = [guard.positions[mid], guard.positions[mid + 1], guard.positions[mid + 2], Math.max(0.06, hp.lengthCm * 0.008)];
      }
    }
  }
  const t2 = nowMs();

  // Construct hierarchical Scene Outliner tree
  const outliner = buildOutlinerTree(scene, rawParts, layerReports);

  return {
    rawParts,
    outliner,
    layerReports,
    substrateMs: t1 - t0,
    generatorsMs: t2 - t1,
    macroTarget,
  };
}

function buildOutlinerTree(
  scene: SceneSpec,
  rawParts: PartMesh[],
  layerReports: LayerRuntimeReport[],
): OutlinerNode[] {
  const nodes: OutlinerNode[] = [];
  const allPartIds = rawParts.filter((p) => p.faceCount > 0 || p.lines.length > 0).map((p) => p.id);
  const totalTris = rawParts.reduce((s, p) => s + p.renderedTriangles, 0);
  const totalVerts = rawParts.reduce((s, p) => s + p.vertexCount, 0);

  // 1. Scene Root
  nodes.push({
    id: 'scene:root',
    parentId: null,
    name: scene.presetName || 'Frontier Scene',
    kind: 'scene',
    layerId: null,
    partIds: allPartIds,
    icon: 'layers',
    accent: '#4fd8e0',
    meta: `${scene.layers.length} layer${scene.layers.length === 1 ? '' : 's'}`,
    triangles: totalTris,
    vertices: totalVerts,
  });

  // 2. Host Substrate Node
  const subPart = rawParts.find((p) => p.id === 'substrate:host');
  if (subPart) {
    nodes.push({
      id: 'substrate:host',
      parentId: 'scene:root',
      name: `Host · ${SUBSTRATE_NAMES[scene.substrate.kind]}`,
      kind: 'substrate',
      layerId: null,
      partIds: ['substrate:host'],
      icon: 'ground',
      accent: '#9a8c7e',
      meta: subPart.metaLabel,
      triangles: subPart.renderedTriangles,
      vertices: subPart.vertexCount,
      shading: 'substrate',
    });
  }

  // 3. Each Generator Layer + its Anatomical / Groom Sub-Parts
  for (const layer of scene.layers) {
    const rep = layerReports.find((r) => r.layerId === layer.id);
    const layerParts = rawParts.filter((p) => p.id.startsWith(layer.id + ':'));
    const renderableLayerPartIds = layerParts.filter((p) => p.faceCount > 0 || p.lines.length > 0).map((p) => p.id);

    const layerIcon =
      layer.kind === 'tree'
        ? 'tree'
        : layer.kind === 'palm'
          ? 'palm'
          : layer.kind === 'fern'
            ? 'fern'
            : layer.kind === 'tropical'
              ? 'tropical'
              : layer.kind === 'moss'
                ? 'moss'
                : 'fur';
    const layerAccent =
      layer.kind === 'tree'
        ? '#52d17c'
        : layer.kind === 'palm'
          ? '#eab308'
          : layer.kind === 'fern'
            ? '#34c759'
            : layer.kind === 'tropical'
              ? '#7ee058'
              : layer.kind === 'moss'
                ? '#86c232'
                : '#ffb454';
    const layerMeta =
      layer.kind === 'tree' && rep?.tree
        ? `${rep.tree.weldedJunctions} collars · ${rep.tree.leaves.toLocaleString('en-US')} leaves`
        : layer.kind === 'palm' && rep?.palm
          ? `${rep.palm.fronds} fronds · ${rep.palm.fruits} fruits`
          : layer.kind === 'fern' && rep?.fern
            ? `${rep.fern.fronds} fronds · ${rep.fern.leaflets} leaflets`
            : layer.kind === 'tropical' && rep?.tropical
              ? `${rep.tropical.leaves} paddles · ${rep.tropical.weldedJunctions ?? 0} collars`
              : layer.kind === 'moss' && rep?.moss
                ? `${rep.moss.shoots.toLocaleString('en-US')} shoots · ${rep.moss.sporophytes} caps`
                : layer.kind === 'hair' && rep?.hair
                  ? `${rep.hair.totalStrands.toLocaleString('en-US')} strands`
                  : '';

    nodes.push({
      id: layer.id,
      parentId: 'scene:root',
      name: layer.name,
      kind: 'layer',
      layerId: layer.id,
      partIds: renderableLayerPartIds,
      icon: layerIcon,
      accent: layerAccent,
      meta: layerMeta,
      triangles: rep?.triangles ?? 0,
      vertices: rep?.vertices ?? 0,
    });

    // Add direct child parts & group headers (e.g., `layer-1:fronds` -> `layer-1:fronds:f01`)
    for (const pm of layerParts) {
      const childMeshes = layerParts.filter((c) => c.parentId === pm.id);
      if (childMeshes.length > 0) {
        const subIds = childMeshes.filter((c) => c.faceCount > 0 || c.lines.length > 0).map((c) => c.id);
        const grpTris = childMeshes.reduce((s, c) => s + c.renderedTriangles, 0);
        const grpVerts = childMeshes.reduce((s, c) => s + c.vertexCount, 0);
        nodes.push({
          id: pm.id,
          parentId: pm.parentId ?? layer.id,
          name: pm.name,
          kind: 'group',
          layerId: layer.id,
          partIds: subIds,
          icon: pm.groupIcon,
          accent: pm.accent,
          meta: pm.metaLabel,
          triangles: grpTris,
          vertices: grpVerts,
          shading: pm.shading,
        });
      } else if (pm.faceCount > 0 || pm.lines.length > 0) {
        nodes.push({
          id: pm.id,
          parentId: pm.parentId ?? layer.id,
          name: pm.name,
          kind: 'part',
          layerId: layer.id,
          partIds: [pm.id],
          icon: pm.groupIcon,
          accent: pm.accent,
          meta: pm.metaLabel,
          triangles: pm.renderedTriangles,
          vertices: pm.vertexCount,
          shading: pm.shading,
        });
      }
    }
  }

  return nodes;
}

export function buildSceneResponse(scene: SceneSpec): SceneBuildResponse {
  const tStart = nowMs();
  const raw = buildSceneRaw(scene);
  const tAudit0 = nowMs();
  const topology = auditParts(raw.rawParts);
  const tPack0 = nowMs();

  // Only generate heavy wireframe edge buffers when total triangle count is <= 650k so Cinema 1M+ stays snappy
  const includeFullWireEdges = topology.renderedTriangles <= 650000;
  const parts: PartPacket[] = [];
  for (const pm of raw.rawParts) {
    if (pm.faceCount === 0 && pm.lines.length === 0) continue;
    parts.push(pm.toPacket(includeFullWireEdges));
  }
  const tEnd = nowMs();

  return {
    parts,
    outliner: raw.outliner,
    topology,
    layerReports: raw.layerReports,
    timings: {
      substrateMs: raw.substrateMs,
      generatorsMs: raw.generatorsMs,
      auditMs: tPack0 - tAudit0,
      packMs: tEnd - tPack0,
      totalMs: tEnd - tStart,
    },
    sceneHeight: Math.max(0.08, topology.boundsHeight),
    macroTarget: raw.macroTarget,
  };
}

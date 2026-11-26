/**
 * Unified Scene, Outliner Hierarchy, Layer & Generator types.
 */

import { PartPacket, ShadingProfile, TopologySummary } from '../core/mesh';
import { SubstrateParams } from '../substrates/substrate';
import { FernParams } from './fernParams';
import { FernStats } from './fernMesher';
import { FlowerParams } from './flowerParams';
import { FlowerStats } from './flowerMesher';
import { HairParams } from './hairParams';
import { HairStats } from './hairMesher';
import { MarineParams } from './marineParams';
import { MarineStats } from './marineMesher';
import { MossParams } from './mossParams';
import { MossStats } from './mossMesher';
import { PalmParams } from './palmParams';
import { PalmStats } from './palmMesher';
import { TreeParams } from './treeParams';
import { TreeStats } from './treeMesher';
import { TropicalParams } from './tropicalParams';
import { TropicalStats } from './tropicalMesher';

export type GeneratorKind = 'tree' | 'palm' | 'flower' | 'marine' | 'tropical' | 'fern' | 'moss' | 'hair';

export interface LayerTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface GeneratorLayer {
  id: string;
  name: string;
  kind: GeneratorKind;
  seed: number;
  visible: boolean;
  locked: boolean;
  transform: LayerTransform;
  tree?: TreeParams;
  palm?: PalmParams;
  flower?: FlowerParams;
  marine?: MarineParams;
  fern?: FernParams;
  tropical?: TropicalParams;
  moss?: MossParams;
  hair?: HairParams;
}

export interface SceneSpec {
  presetName: string;
  groupLabel: string;
  substrate: SubstrateParams;
  substrateVisible: boolean;
  layers: GeneratorLayer[];
}

export interface PresetDefinition {
  name: string;
  group: string;
  subtitle: string;
  accent: string;
  icon: string;
  scene: SceneSpec;
}

export type OutlinerNodeKind = 'scene' | 'substrate' | 'layer' | 'group' | 'part';

export interface OutlinerNode {
  id: string;
  parentId: string | null;
  name: string;
  kind: OutlinerNodeKind;
  /** Associated GeneratorLayer id if inside a layer. */
  layerId: string | null;
  /** Associated rendered PartPacket ids controlled by this node (includes descendants). */
  partIds: string[];
  icon: string;
  accent: string;
  meta: string;
  triangles: number;
  vertices: number;
  shading?: ShadingProfile;
}

export interface LayerRuntimeReport {
  layerId: string;
  kind: GeneratorKind;
  tree?: TreeStats;
  palm?: PalmStats;
  flower?: FlowerStats;
  marine?: MarineStats;
  fern?: FernStats;
  tropical?: TropicalStats;
  moss?: MossStats;
  hair?: HairStats;
  triangles: number;
  vertices: number;
}

export interface SceneBuildResponse {
  parts: PartPacket[];
  outliner: OutlinerNode[];
  topology: TopologySummary;
  layerReports: LayerRuntimeReport[];
  timings: {
    substrateMs: number;
    generatorsMs: number;
    auditMs: number;
    packMs: number;
    totalMs: number;
  };
  /** Overall scene vertical height in metres for camera framing. */
  sceneHeight: number;
  /** Recommended macro inspection target [posX, posY, posZ, radius]. */
  macroTarget: [number, number, number, number];
}

export function cloneScene(s: SceneSpec): SceneSpec {
  return JSON.parse(JSON.stringify(s)) as SceneSpec;
}

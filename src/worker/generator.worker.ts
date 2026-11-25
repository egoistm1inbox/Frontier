/**
 * Off-main-thread Web Worker for high-poly Fern, Plant, Real Moss, and
 * Fur/Hair Groom generation & OBJ/GLB export.
 */

import { partsToGLB, partsToOBJ } from '../core/mesh';
import { buildSceneRaw, buildSceneResponse } from '../generators/buildScene';
import { SceneBuildResponse, SceneSpec } from '../generators/types';

export interface GenerateWorkerReq {
  type: 'generate';
  id: number;
  scene: SceneSpec;
}

export interface ExportWorkerReq {
  type: 'export';
  id: number;
  scene: SceneSpec;
  format: 'obj' | 'glb';
  visiblePartIds: string[] | null;
}

export type WorkerReq = GenerateWorkerReq | ExportWorkerReq;

export interface GeneratedWorkerRes {
  type: 'generated';
  id: number;
  data: SceneBuildResponse;
}

export interface ExportedWorkerRes {
  type: 'exported';
  id: number;
  format: 'obj' | 'glb';
  buffer: ArrayBuffer;
}

export interface ErrorWorkerRes {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerRes = GeneratedWorkerRes | ExportedWorkerRes | ErrorWorkerRes;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerReq>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'generate') {
      const data = buildSceneResponse(msg.scene);
      const transfer: Transferable[] = [];
      for (const p of data.parts) {
        transfer.push(
          p.position.buffer,
          p.normal.buffer,
          p.tangent.buffer,
          p.uv.buffer,
          p.color.buffer,
          p.wind.buffer,
          p.pivot.buffer,
          p.surface.buffer,
          p.index.buffer,
          p.edgeIndex.buffer,
        );
      }
      const res: GeneratedWorkerRes = { type: 'generated', id: msg.id, data };
      ctx.postMessage(res, transfer);
    } else if (msg.type === 'export') {
      const raw = buildSceneRaw(msg.scene);
      const allow = msg.visiblePartIds ? new Set(msg.visiblePartIds) : null;
      const parts = allow ? raw.rawParts.filter((p) => allow.has(p.id)) : raw.rawParts;
      let buffer: ArrayBuffer;
      if (msg.format === 'obj') {
        const str = partsToOBJ(parts, msg.scene.presetName || 'frontier_specimen');
        buffer = new TextEncoder().encode(str).buffer as ArrayBuffer;
      } else {
        buffer = partsToGLB(parts, msg.scene.presetName || 'frontier_specimen');
      }
      const res: ExportedWorkerRes = { type: 'exported', id: msg.id, format: msg.format, buffer };
      ctx.postMessage(res, [buffer]);
    }
  } catch (err) {
    const res: ErrorWorkerRes = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    };
    ctx.postMessage(res);
  }
};

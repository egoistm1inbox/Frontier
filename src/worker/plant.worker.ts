/**
 * Generation worker: grows the welded mesh, validates its topology and packs
 * GPU buffers off the main thread so slider drags stay fluid.
 */

import { PlantParams } from '../tropical/params';
import { generatePlant } from '../tropical/generate';
import { validateTopology, TopologyReport } from '../tropical/validate';
import { toGpuBuffers, toOBJ, toGLB, GpuBuffers } from '../tropical/export';
import { atlasPngBytes } from '../tropical/textures';
import type { BuilderStats } from '../tropical/welder';

export type WorkerRequest =
  | { type: 'generate'; id: number; params: PlantParams }
  | { type: 'export'; id: number; params: PlantParams; format: 'obj' | 'glb' };

export interface GenerateResponse {
  type: 'generated';
  id: number;
  buffers: GpuBuffers;
  report: TopologyReport;
  stats: BuilderStats;
  summary: { height: number };
  timings: { build: number; validate: number; buffers: number; total: number };
}

export type WorkerResponse =
  | GenerateResponse
  | { type: 'exported'; id: number; format: 'obj' | 'glb'; data: ArrayBuffer }
  | { type: 'error'; id: number; message: string };

interface WorkerScope {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
}

function bufferTransfers(b: GpuBuffers): ArrayBuffer[] {
  return [b.position.buffer, b.normal.buffer, b.uv.buffer, b.color.buffer, b.wind.buffer, b.pivot.buffer, b.organ.buffer, b.junction.buffer, b.tile.buffer, b.index.buffer, b.edgeIndex.buffer] as ArrayBuffer[];
}

async function handle(msg: WorkerRequest): Promise<void> {
  try {
    if (msg.type === 'generate') {
      const t0 = performance.now();
      const r = generatePlant(msg.params);
      const t1 = performance.now();
      const report = validateTopology(r.mesh);
      const t2 = performance.now();
      const buffers = toGpuBuffers(r.mesh);
      const t3 = performance.now();
      const res: GenerateResponse = {
        type: 'generated',
        id: msg.id,
        buffers,
        report,
        stats: r.stats,
        summary: { height: r.height },
        timings: { build: r.timings.build, validate: t2 - t1, buffers: t3 - t2, total: t3 - t0 },
      };
      (self as unknown as WorkerScope).postMessage(res, bufferTransfers(buffers));
      return;
    }
    if (msg.type === 'export') {
      const r = generatePlant(msg.params);
      let data: ArrayBuffer;
      if (msg.format === 'obj') {
        data = new TextEncoder().encode(toOBJ(r.mesh, msg.params.name)).buffer as ArrayBuffer;
      } else {
        const png = await atlasPngBytes();
        data = toGLB(r.mesh, msg.params.name, png);
      }
      const res: WorkerResponse = { type: 'exported', id: msg.id, format: msg.format, data };
      (self as unknown as WorkerScope).postMessage(res, [data]);
      return;
    }
  } catch (err) {
    const res: WorkerResponse = { type: 'error', id: msg.id, message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
    (self as unknown as WorkerScope).postMessage(res);
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  void handle(ev.data);
};

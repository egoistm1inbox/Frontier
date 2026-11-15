// Builds the Nanite-style cluster hierarchy for the Geometry Compile "Cluster LOD" step off the main thread.
import { buildClusterHierarchy } from './ClusterHierarchy.js';

self.onmessage = (event) => {
  const { ticket, request } = event.data;
  try {
    const report = (fraction, label) => self.postMessage({ ticket, type: 'progress', fraction, label });
    const h = buildClusterHierarchy(request.positions, request.indices, { ...request.build, families: request.families }, report);
    const result = {
      levels: h.levels, clusterCount: h.clusterCount, groupCount: h.groupCount, stalled: h.stalled, buildMs: h.buildMs,
      cornerVertex: h.cornerVertex, clusterFirst: h.clusterFirst, clusterSize: h.clusterSize, clusterLevel: h.clusterLevel,
      groupError: h.groupError, config: h.config,
      triangleFamily: h.triangleFamily, preserveMaterials: h.preserveMaterials, seamBlocked: h.seamBlocked,
    };
    const transfer = [h.cornerVertex.buffer, h.clusterFirst.buffer, h.clusterSize.buffer, h.clusterLevel.buffer, h.groupError.buffer];
    if (h.triangleFamily) transfer.push(h.triangleFamily.buffer);
    self.postMessage({ ticket, type: 'done', result }, transfer);
  } catch (error) {
    self.postMessage({ ticket, type: 'error', message: String((error && error.message) || error) });
  }
};

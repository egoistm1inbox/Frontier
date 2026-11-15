// Builds the Nanite-style cluster hierarchy for the Geometry Compile "Cluster LOD" step off the main thread.
import { buildClusterHierarchy } from './ClusterHierarchy.js';

self.onmessage = (event) => {
  const { ticket, request } = event.data;
  try {
    const report = (fraction, label) => self.postMessage({ ticket, type: 'progress', fraction, label });
    const h = buildClusterHierarchy(request.positions, request.indices, request.build, report);
    const result = {
      levels: h.levels, clusterCount: h.clusterCount, groupCount: h.groupCount, stalled: h.stalled, buildMs: h.buildMs,
      cornerVertex: h.cornerVertex, clusterFirst: h.clusterFirst, clusterSize: h.clusterSize, clusterLevel: h.clusterLevel,
      groupError: h.groupError, config: h.config,
    };
    self.postMessage({ ticket, type: 'done', result }, [h.cornerVertex.buffer, h.clusterFirst.buffer, h.clusterSize.buffer, h.clusterLevel.buffer, h.groupError.buffer]);
  } catch (error) {
    self.postMessage({ ticket, type: 'error', message: String((error && error.message) || error) });
  }
};

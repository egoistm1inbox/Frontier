// Full evaluation of a project: the layer stack, then drainage routing, then the satmap.
// Used by the worker in the browser and directly by the Node tests.

import { evaluateStack, CancelledError } from './stack.js';
import { routeFlow, accumulate, flowIntensity } from './flow.js';
import { buildSatmap } from './satmap.js';
import { fnv1a } from './random.js';
import { slopeDegrees, minMax } from './grid.js';

export { CancelledError };

function layerKind(project, index) {
  return project.layers[index]?.kind;
}

export async function evaluateProject(project, options = {}) {
  const { cache, force, checkpoint, onLayer, satmapCache } = options;
  const stack = await evaluateStack(project, { cache, force, checkpoint, onLayer });
  const { heights, size, cellMetres, erosionDelta } = stack;
  const { settings, satmap } = project;

  const routed = routeFlow(heights, size);
  const area = accumulate(routed.order, routed.receiver, size * size);
  const flow = flowIntensity(area);

  const satKey = fnv1a(`${stack.key}|${JSON.stringify(satmap)}|${settings.seaLevel}`);
  let texture;
  if (satmapCache && satmapCache.key === satKey) {
    texture = satmapCache.texture;
  } else {
    await checkpoint?.(1, null, 'satmap');
    texture = buildSatmap({
      heights,
      size,
      cellMetres,
      maxHeight: settings.maxHeight,
      flow,
      erosionDelta,
      settings,
      satmap,
    });
    if (satmapCache) {
      satmapCache.key = satKey;
      satmapCache.texture = texture;
    }
  }

  const slope = slopeDegrees(heights, size, cellMetres, settings.maxHeight);
  const { min, max } = minMax(heights);
  let meanSlope = 0;
  let water = 0;
  for (let i = 0; i < heights.length; i += 1) {
    meanSlope += slope[i];
    if (heights[i] * settings.maxHeight < settings.seaLevel) water += 1;
  }
  const total = heights.length;
  const erosionResults = stack.results.filter((r) => layerKind(project, r.index) === 'erosion');
  return {
    key: stack.key,
    size,
    heights,
    flow,
    erosionDelta,
    texture,
    textureSize: satmap.resolution,
    layers: stack.results,
    cacheHits: stack.cacheHits,
    stats: {
      minMetres: min * settings.maxHeight,
      maxMetres: max * settings.maxHeight,
      meanSlope: meanSlope / total,
      waterFraction: water / total,
      // Only erosion layers move material. Generator layers also change heights, which is not erosion.
      erodedVolume: erosionResults.reduce((sum, r) => sum + (r.metrics?.removedVolume ?? 0), 0),
      depositedVolume: erosionResults.reduce((sum, r) => sum + (r.metrics?.depositedVolume ?? 0), 0),
      milliseconds: stack.milliseconds,
    },
  };
}


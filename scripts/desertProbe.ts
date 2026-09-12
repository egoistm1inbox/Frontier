import { DESERT_PRESETS } from '../src/plant/desertParams';
import { DesertMesher } from '../src/plant/desertMesher';
import { validateTopology } from '../src/tree/validate';

for (const preset of DESERT_PRESETS) {
  for (const seed of [1, 7, 42]) {
    const started = performance.now();
    const built = new DesertMesher(preset.desert, seed).build();
    const report = validateTopology(built.mesh);
    console.log(JSON.stringify({
      name: preset.name,
      seed,
      vertices: report.vertices,
      faces: report.faces,
      quads: report.quads,
      tris: report.tris,
      boundary: report.boundaryEdges,
      nonManifold: report.nonManifoldEdges,
      winding: report.inconsistentEdges,
      components: report.components,
      chi: report.eulerCharacteristic,
      genus: report.genus,
      ms: Math.round(performance.now() - started),
    }));
  }
}

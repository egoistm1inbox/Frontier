import { DESERT_PRESETS } from '../src/plant/desertParams';
import { DesertMesher } from '../src/plant/desertMesher';
import { validateTopology } from '../src/tree/validate';

for (const preset of DESERT_PRESETS) {
  const built = new DesertMesher(preset.desert, 1).build();
  const report = validateTopology(built.mesh);
  console.log(JSON.stringify({
    name: preset.name,
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
    ms: Math.round(performance.now()),
  }));
}

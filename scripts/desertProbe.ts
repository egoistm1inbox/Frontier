import { DEFAULT_DESERT, DESERT_PRESETS } from '../src/plant/desertParams';
import { DesertMesher } from '../src/plant/desertMesher';
import { validateTopology } from '../src/tree/validate';

const argv: string[] = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const only = argv[2];
const seeds = (argv[3] ?? '1,7,42').split(',').map(Number);

for (const preset of DESERT_PRESETS) {
  if (only && !preset.name.toLowerCase().includes(only.toLowerCase())) continue;
  for (const seed of seeds) {
    const d = { ...DEFAULT_DESERT, ...preset.desert };
    const t0 = performance.now();
    const built = new DesertMesher(d, seed).build();
    const report = validateTopology(built.mesh);
    const t1 = performance.now();
    console.log(
      `${preset.name.padEnd(22)} seed=${seed} organs=${built.stats.organs} arms=${built.stats.arms} pads=${built.stats.pads} ` +
        `rosette=${built.stats.rosetteLeaves} details=${built.stats.details} spines=${built.stats.spines} ` +
        `V=${report.vertices} F=${report.faces} quads=${(report.quadRatio * 100).toFixed(1)}% ` +
        `bnd=${report.boundaryEdges} nm=${report.nonManifoldEdges} inc=${report.inconsistentEdges} ` +
        `deg=${report.degenerateFaces} chi=${report.eulerCharacteristic} comp=${report.components} genus=${report.genus} ` +
        `dropped=${built.stats.dropped} ${JSON.stringify(built.stats.dropReasons)} t=${(t1 - t0).toFixed(0)}ms`,
    );
  }
}

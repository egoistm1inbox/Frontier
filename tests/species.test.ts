import { describe, expect, it } from 'vitest';
import { PRESETS, cloneParams } from '../src/tropical/params';
import { generatePlant } from '../src/tropical/generate';
import { validateTopology } from '../src/tropical/validate';

describe('species presets generate a single welded mesh', () => {
  for (const preset of PRESETS) {
    it(preset.name, () => {
      const p = cloneParams(preset);
      const t0 = performance.now();
      const r = generatePlant(p);
      const rep = validateTopology(r.mesh);
      const ms = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(
        `${preset.name.padEnd(26)} faces=${String(rep.faces).padStart(7)} verts=${String(rep.vertices).padStart(7)} ` +
          `junctions=${String(r.stats.junctions).padStart(5)} dropped=${String(r.stats.dropped).padStart(4)} height=${r.height.toFixed(1).padStart(5)}m ${ms.toFixed(0)}ms`,
      );
      expect(rep.components, 'single connected piece').toBe(1);
      expect(rep.boundaryEdges, 'closed surface').toBe(0);
      expect(rep.nonManifoldEdges, '2-manifold').toBe(0);
      expect(rep.inconsistentEdges, 'consistent winding').toBe(0);
      expect(rep.degenerateFaces, 'no degenerate faces').toBe(0);
      expect(rep.isolatedVertices, 'no isolated vertices').toBe(0);
      expect(rep.eulerCharacteristic, 'V−E+F=2').toBe(2);
      expect(rep.genus).toBe(0);
      expect(r.mesh.signedVolume()).toBeGreaterThan(0);
      expect(rep.faces).toBeGreaterThan(500);
    });
  }
});

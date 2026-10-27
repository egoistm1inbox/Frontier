import { describe, expect, it } from 'vitest';
import { PlantBuilder, TubeSpec, circleProfile, evenRings } from '../src/tropical/welder';
import { validateTopology } from '../src/tropical/validate';
import { v3 } from '../src/core/math';

function cyl(spine: ReturnType<typeof v3>[], sides: number, r: number, rings: number, organ = 0): TubeSpec {
  return {
    spine,
    ringTs: evenRings(rings),
    sides,
    profileAt: (_t, out) => circleProfile(sides, r, r, out),
    colorAt: () => [0.5, 0.5, 0.5],
    upHint: v3(0, 0, 1),
    tile: 0,
    vPerMeter: 1,
    organ,
    wind: { pivot: v3(0, 0, 0), phase: 0, limb0: 0, limb1: 0, detail0: 0, detail1: 0 },
    capStart: true,
    capEnd: true,
  };
}

describe('welder', () => {
  it('a lone capped tube is a closed genus-0 manifold', () => {
    const b = new PlantBuilder();
    b.tube(cyl([v3(0, 0, 0), v3(0, 2, 0)], 10, 0.2, 8));
    const { mesh } = b.finalize();
    const rep = validateTopology(mesh);
    expect(rep.components).toBe(1);
    expect(rep.boundaryEdges).toBe(0);
    expect(rep.nonManifoldEdges).toBe(0);
    expect(rep.inconsistentEdges).toBe(0);
    expect(rep.genus).toBe(0);
    expect(mesh.signedVolume()).toBeGreaterThan(0);
  });

  it('a welded child keeps the mesh one closed genus-0 piece', () => {
    const b = new PlantBuilder();
    const parent = b.tube(cyl([v3(0, 0, 0), v3(0, 3, 0)], 16, 0.3, 20));
    // Child: 8 sides → window 2(w+h)=8 → w=2,h=2; exits at ~50° elevation.
    const childSpec = cyl([v3(0.28, 1.5, 0), v3(0.9, 2.2, 0.2), v3(1.5, 2.6, 0.3)], 8, 0.1, 10, 1);
    childSpec.capStart = false;
    const child = b.weld(parent, 0.5, v3(1, 0.2, 0.1), 2, 2, childSpec);
    expect(child).not.toBeNull();
    const { mesh } = b.finalize();
    const rep = validateTopology(mesh);
    expect(rep.components).toBe(1);
    expect(rep.boundaryEdges).toBe(0);
    expect(rep.nonManifoldEdges).toBe(0);
    expect(rep.inconsistentEdges).toBe(0);
    expect(rep.eulerCharacteristic).toBe(2);
    expect(rep.genus).toBe(0);
    expect(mesh.signedVolume()).toBeGreaterThan(0);
  });

  it('many children around a crown stay manifold', () => {
    const b = new PlantBuilder();
    const parent = b.tube(cyl([v3(0, 0, 0), v3(0, 3, 0), v3(0.2, 4, 0)], 24, 0.3, 60));
    let welded = 0;
    for (let i = 0; i < 24; i++) {
      const az = i * 2.39996; // golden angle
      const el = 1.2 - i * 0.045;
      const dir = v3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const t = 0.97 - i * 0.008;
      const start = v3(dir.x * 0.3, 3 * t + 0.85, dir.z * 0.3);
      const spec = cyl([start, v3(start.x + dir.x, start.y + dir.y, start.z + dir.z)], 8, 0.07, 8, 1);
      spec.capStart = false;
      if (b.weld(parent, t, dir, 2, 2, spec)) welded++;
    }
    const { mesh } = b.finalize();
    const rep = validateTopology(mesh);
    expect(welded).toBeGreaterThan(15);
    expect(rep.components).toBe(1);
    expect(rep.boundaryEdges).toBe(0);
    expect(rep.nonManifoldEdges).toBe(0);
    expect(rep.inconsistentEdges).toBe(0);
    expect(rep.genus).toBe(0);
  });
});

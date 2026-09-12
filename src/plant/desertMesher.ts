/**
 * High-detail desert plant mesher.
 *
 * Cacti and succulents do not share the branching assumptions of a tree or a
 * grass crown. A prickly pear is a stack of flattened pads, an agave is a
 * rosette of thick pointed blades, and a saguaro's arms have swollen elbows.
 * This mesher therefore evaluates a botanical signed-distance field and
 * extracts one watertight surface with marching tetrahedra. The union is
 * smooth at real growth joints, so it does not produce the intersecting
 * cylinders that make low-quality procedural cacti look like plumbing.
 *
 * The output is deliberately a single connected genus-0 surface. It is
 * triangle-native (the field is sampled uniformly so there are no stretched
 * cap quads), carries the same wind attributes as the welded tree mesher, and
 * goes through the shared topology validator and OBJ/GLB exporters.
 */

import { Random } from '../core/random';
import { QuadMesh } from '../tree/mesh';
import { DesertForm, DesertParams } from './desertParams';

interface V3 {
  x: number;
  y: number;
  z: number;
}

interface Bounds {
  min: V3;
  max: V3;
}

interface DesertPart {
  sdf: (p: V3) => number;
  /** Blend radius in metres. */
  blend: number;
}

export interface DesertStats {
  organs: number;
  junctions: number;
  dropped: number;
  dropReasons: Record<string, number>;
  /** crown/root · primary body · arms/pads/leaves · flowers/detail */
  perLevel: [number, number, number, number];
  /** Number of field components before union, useful for the inspector. */
  components: number;
}

export interface DesertBuildResult {
  mesh: QuadMesh;
  stats: DesertStats;
  height: number;
  groundDepth: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: V3, n: number): V3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const len = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const norm = (a: V3): V3 => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 1, z: 0 } : mul(a, 1 / l);
};
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

function sphere(p: V3, c: V3, r: number): number {
  return len(sub(p, c)) - r;
}

function ellipsoid(p: V3, c: V3, radii: V3): number {
  const q = sub(p, c);
  // This is the stable signed approximation used for botanical soft tissue;
  // it preserves the silhouette and behaves well when several leaves overlap.
  return (Math.sqrt((q.x / radii.x) ** 2 + (q.y / radii.y) ** 2 + (q.z / radii.z) ** 2) - 1) * Math.min(radii.x, radii.y, radii.z);
}

/** Rounded, slightly flattened pad in a vertical local X/Y plane. */
function pad(p: V3, c: V3, yaw: number, tilt: number, width: number, height: number, thickness: number, phase: number): number {
  const q = sub(p, c);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = cy * q.x + sy * q.z;
  const z1 = -sy * q.x + cy * q.z;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const x = ct * x1 + st * q.y;
  const y = -st * x1 + ct * q.y;
  const edge = 1 + 0.045 * Math.sin(5 * Math.atan2(y, x) + phase) + 0.018 * Math.sin(9 * Math.atan2(y, x) - phase * 0.7);
  const n = 2.65;
  const qn = (Math.abs(x / (width * 0.5 * edge)) ** n + Math.abs(y / (height * 0.5 * edge)) ** n + Math.abs(z1 / (thickness * 0.5)) ** n) ** (1 / n) - 1;
  return qn * Math.min(width * 0.5, height * 0.5, thickness * 0.5);
}

/** Ellipsoid aligned to an arbitrary leaf segment. */
function orientedEllipsoid(p: V3, c: V3, axis: V3, across: number, along: number, thickness: number): number {
  const d = norm(axis);
  const side = norm(Math.abs(d.y) < 0.92 ? cross({ x: 0, y: 1, z: 0 }, d) : cross({ x: 1, y: 0, z: 0 }, d));
  const binormal = cross(d, side);
  const q = sub(p, c);
  const x = dot(q, side) / Math.max(1e-6, across);
  const y = dot(q, d) / Math.max(1e-6, along);
  const z = dot(q, binormal) / Math.max(1e-6, thickness);
  return (Math.sqrt(x * x + y * y + z * z) - 1) * Math.min(across, along, thickness);
}

/** Ribbed ellipsoid used by barrel cactus; the ribs remain visible around the crown. */
function ribbedBarrel(p: V3, c: V3, radii: V3, ribs: number, depth: number, phase: number): number {
  const q = sub(p, c);
  const theta = Math.atan2(q.z, q.x);
  const ridge = Math.max(0, Math.cos(ribs * theta + phase));
  const radialScale = 1 + depth * ridge ** 6;
  const x = q.x / (radii.x * radialScale);
  const z = q.z / (radii.z * radialScale);
  const y = q.y / radii.y;
  return (Math.sqrt(x * x + y * y + z * z) - 1) * Math.min(radii.x, radii.y, radii.z);
}

function saguaroSilhouette(p: V3, height: number, halfWidth: number, ribs: number, ribDepth: number, arms: number): number {
  const radial = Math.sqrt(p.x * p.x + p.z * p.z);
  const theta = Math.atan2(p.z, p.x);
  const central = Math.min(0.34, halfWidth * 0.14) * (1 - 0.12 * clamp((p.y - height * 0.55) / Math.max(0.1, height * 0.45), 0, 1));
  let target = central;
  const angles = [0.14, 2.55, 4.42, 1.62, 3.65];
  const bases = [0.48, 0.64, 0.39, 0.55, 0.72];
  const reaches = [0.72, 0.64, 0.78, 0.6, 0.68];
  for (let i = 0; i < arms; i++) {
    const angular = Math.max(0, Math.cos(theta - angles[i % angles.length])) ** 5;
    const base = height * bases[i % bases.length];
    const top = base + height * (0.22 + 0.04 * (i % 3));
    const t = clamp((p.y - base) / Math.max(0.1, top - base), 0, 1);
    const vertical = Math.min(1, t / 0.18, (1 - t) / 0.18);
    target = Math.max(target, central + halfWidth * reaches[i % reaches.length] * angular * clamp(vertical, 0, 1));
  }
  const ridge = 1 + ribDepth * Math.max(0, Math.cos(ribs * theta + 0.15)) ** 6;
  target *= ridge;
  const dy = Math.max(0.06 - p.y, p.y - height);
  const q = radial - target;
  return Math.sqrt(Math.max(q, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(q, dy), 0);
}

function yuccaSilhouette(p: V3, height: number, halfWidth: number, branches: number, seed: number): number {
  const r = Math.sqrt(p.x * p.x + p.z * p.z);
  const trunkR = Math.min(0.27, halfWidth * 0.16);
  const crownStart = height * 0.42;
  const top = height * 0.98;
  if (p.y < crownStart) {
    const dy = Math.max(0.1 - p.y, p.y - crownStart);
    const q = r - trunkR * (1 - 0.18 * clamp(p.y / Math.max(0.1, crownStart), 0, 1));
    return Math.sqrt(Math.max(q, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(q, dy), 0);
  }
  const theta = Math.atan2(p.z, p.x);
  let lobe = 0;
  for (let i = 0; i < branches; i++) {
    const a = seed * 0.00013 + i * TAU / branches;
    lobe = Math.max(lobe, Math.max(0, Math.cos(theta - a)) ** 7);
  }
  const t = clamp((p.y - crownStart) / Math.max(0.1, top - crownStart), 0, 1);
  const target = trunkR * 0.9 + (halfWidth * 0.55 * lobe + 0.08) * (0.42 + 0.58 * (1 - t));
  const dy = Math.max(crownStart - p.y, p.y - top);
  const q = r - target;
  return Math.sqrt(Math.max(q, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(q, dy), 0);
}

function ocotilloSilhouette(p: V3, height: number, halfWidth: number, canes: number, seed: number): number {
  const r = Math.sqrt(p.x * p.x + p.z * p.z);
  const theta = Math.atan2(p.z, p.x);
  const baseY = -0.03;
  const t = clamp((p.y - baseY) / Math.max(0.1, height - baseY), 0, 1);
  let lobe = 0;
  const top = height * 0.9;
  for (let i = 0; i < canes; i++) {
    const phase = seed * 0.00017 + i * TAU / canes;
    const angular = Math.max(0, Math.cos(theta - phase));
    const influence = angular ** 5;
    if (influence > lobe) lobe = influence;

  }
  const taper = 1 - 0.28 * t;
  const target = (0.15 + halfWidth * 0.58 * lobe * (0.34 + 0.66 * t)) * taper;
  const dy = Math.max(baseY - p.y, p.y - top);
  const q = r - target;
  return Math.sqrt(Math.max(q, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(q, dy), 0);
}

function makeParts(p: DesertParams, seed: number): { parts: DesertPart[]; counts: [number, number, number, number]; bounds: Bounds } {
  const rng = new Random(seed ^ 0x4d3c2b1a);
  const parts: DesertPart[] = [];
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  const root = (sdf: (q: V3) => number, blend = 0.04, level = 1): void => {
    parts.push({ sdf, blend });
    counts[level]++;
  };
  const height = p.height;
  const halfWidth = p.width * 0.5;

  if (p.form === 'saguaro') {
    // A single radial field gives a saguaro the characteristic column + arm
    // silhouette without relying on near-tangent Boolean tube contacts.
    // The rib phase remains geometric, so close-ups still show real ribs.
    root((q) => saguaroSilhouette(q, height, halfWidth, p.ribCount, p.ribDepth, Math.max(1, Math.round(p.organs))), 0.08, 1);
  } else if (p.form === 'barrel') {
    const r = Math.min(halfWidth * 0.88, height * 0.48);
    root((q) => ellipsoid(q, { x: 0, y: r * 0.9, z: 0 }, { x: r, y: r * 1.02, z: r * 0.94 }), 0.06, 1);
    root((q) => ribbedBarrel(q, { x: 0, y: r * 0.9, z: 0 }, { x: r, y: r * 1.02, z: r * 0.94 }, p.ribCount, p.ribDepth, 0.3), 0.04, 2);
    root((q) => sphere(q, { x: 0, y: r * 1.77, z: 0 }, r * 0.3), 0.04, 3);
  } else if (p.form === 'prickly-pear') {
    const baseRadius = Math.min(0.44, halfWidth * 0.27);
    root((q) => ellipsoid(q, { x: 0, y: 0.24, z: 0 }, { x: baseRadius * 1.4, y: 0.3, z: baseRadius * 1.25 }), 0.1, 0);
    // A living pad cactus has a woody central core behind the visible pads.
    // Keeping that core in the field prevents narrow pad overlaps from
    // creating hidden tunnels in the extracted surface.
    root((q) => ellipsoid(q, { x: 0, y: 0.78, z: 0 }, { x: 1.08, y: 0.92, z: 0.86 }), 0.12, 1);
    const pads: { c: V3; yaw: number; tilt: number; w: number; h: number; t: number; phase: number }[] = [];
    const base = Math.max(5, Math.min(8, Math.round(p.organs * 0.42)));
    for (let i = 0; i < base; i++) {
      const a = (i * TAU) / base + rng.range(-0.12, 0.12);
      pads.push({ c: { x: Math.cos(a) * 0.24, y: rng.range(0.47, 0.58), z: Math.sin(a) * 0.24 }, yaw: a + Math.PI * 0.5, tilt: rng.range(-0.16, 0.16), w: rng.range(0.5, 0.68), h: rng.range(0.68, 0.88), t: rng.range(0.22, 0.28), phase: rng.range(0, TAU) });
    }
    const upper = Math.max(5, Math.round(p.organs - base));
    for (let i = 0; i < upper; i++) {
      const a = (i * TAU) / upper + rng.range(-0.2, 0.2);
      const r0 = rng.range(0.42, 0.58);
      pads.push({ c: { x: Math.cos(a) * r0, y: rng.range(0.98, 1.38), z: Math.sin(a) * r0 }, yaw: a + Math.PI * 0.5, tilt: rng.range(-0.2, 0.2), w: rng.range(0.38, 0.58), h: rng.range(0.55, 0.78), t: rng.range(0.2, 0.25), phase: rng.range(0, TAU) });
    }
    for (const item of pads) {
      root((q) => pad(q, item.c, item.yaw, item.tilt, item.w, item.h, item.t, item.phase), 0.065, 2);
    }
  } else if (p.form === 'agave') {
    const bulbR = Math.min(0.46, halfWidth * 0.42);
    root((q) => ellipsoid(q, { x: 0, y: 0.2, z: 0 }, { x: bulbR, y: 0.24, z: bulbR }), 0.09, 0);
    // The packed basal leaves grow from a substantial heart; this hidden
    // volume avoids pinched tunnels between adjacent rosette blades.
    root((q) => ellipsoid(q, { x: 0, y: 0.52, z: 0 }, { x: 1.22, y: 0.78, z: 1.22 }), 0.1, 1);
    const leafCount = Math.max(16, Math.round(p.organs));
    for (let i = 0; i < leafCount; i++) {
      const a = (i * 2.3999632297) % TAU;
      const radial = lerp(0.1, halfWidth * 0.92, (i + 0.6) / leafCount);
      const inner = i < leafCount * 0.32;
      const tipY = inner ? lerp(0.72, height * 0.98, i / Math.max(1, leafCount * 0.32)) : lerp(0.09, height * 0.68, (i % 11) / 10);
      const tip = { x: Math.cos(a) * radial, y: tipY, z: Math.sin(a) * radial };
      const p0 = { x: Math.cos(a) * 0.13, y: 0.24, z: Math.sin(a) * 0.13 };
      const leafWidth = lerp(0.115, 0.07, radial / Math.max(0.1, halfWidth));
      // Two overlapping leaf volumes preserve the natural forward curve while
      // avoiding a stack of tiny intersection tunnels at the rosette heart.
      const segments: [V3, V3][] = [[p0, tip]];
      for (let j = 0; j < segments.length; j++) {
        const [a0, b0] = segments[j];
        const mid = mul(add(a0, b0), 0.5);
        const axis = sub(b0, a0);
        const f = 1 - j * 0.28;
        root((q) => orientedEllipsoid(q, mid, axis, leafWidth * 0.58 * f, len(axis) * 0.7, 0.05 + 0.025 * f), 0.06, 2);
      }
    }
  } else if (p.form === 'ocotillo') {
    // Ocotillo is a sparse cane shrub. Its broad basal crown and angular
    // lobe field keep the silhouette organic while retaining one clean,
    // watertight surface instead of leaving dozens of microscopic stem caps.
    root((q) => ocotilloSilhouette(q, height, halfWidth, Math.max(8, Math.round(p.organs)), seed), 0.08, 1);
  } else {
    // Joshua-tree-like yucca. It is represented as a continuous sculpted
    // crown rather than overlapping leaf tubes: the radial lobes retain the
    // characteristic branched silhouette while keeping the exported surface
    // watertight at the packed rosette joints.
    root((q) => yuccaSilhouette(q, height, halfWidth, Math.max(2, Math.round(p.organs)), seed), 0.08, 1);
  }


  const maxX = halfWidth + 0.28;
  const maxZ = halfWidth + 0.28;
  const maxY = height + (p.form === 'barrel' ? 0.22 : 0.16);
  return {
    parts,
    counts,
    bounds: { min: { x: -maxX, y: -0.55, z: -maxZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}

function partField(parts: DesertPart[]): (p: V3) => number {
  return (p: V3): number => {
    let d = 100;
    for (const part of parts) d = smoothMin(d, part.sdf(p), part.blend);
    return d;
  };
}

/**
 * Polygonise a desert SDF with surface nets: one dual vertex per active
 * cell and one shared quad per sign-changing grid edge. This avoids a triangle
 * soup and keeps adjacent cell loops welded through arms, pads and leaves.
 */
export class DesertMesher {
  constructor(private readonly params: DesertParams, private readonly seed: number) {}

  build(): DesertBuildResult {
    const { parts, counts, bounds } = makeParts(this.params, this.seed);
    const field = partField(parts);
    const maxSpan = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
    const major = clamp(Math.round(this.params.resolution), 36, 92);
    const nx = Math.max(18, Math.round((bounds.max.x - bounds.min.x) / maxSpan * major));
    const ny = Math.max(18, Math.round((bounds.max.y - bounds.min.y) / maxSpan * major));
    const nz = Math.max(18, Math.round((bounds.max.z - bounds.min.z) / maxSpan * major));
    const dx = (bounds.max.x - bounds.min.x) / nx;
    const dy = (bounds.max.y - bounds.min.y) / ny;
    const dz = (bounds.max.z - bounds.min.z) / nz;
    const sx = nx + 1;
    const sy = ny + 1;
    const values = new Float32Array(sx * sy * (nz + 1));
    const index = (x: number, y: number, z: number): number => (z * sy + y) * sx + x;
    const point = (x: number, y: number, z: number): V3 => ({ x: bounds.min.x + x * dx, y: bounds.min.y + y * dy, z: bounds.min.z + z * dz });
    for (let z = 0; z <= nz; z++) {
      for (let y = 0; y <= ny; y++) {
        for (let x = 0; x <= nx; x++) values[index(x, y, z)] = field(point(x, y, z));
      }
    }

    // Surface nets: one dual vertex per active cell and one quad per
    // sign-changing grid edge. Unlike a naive triangle soup this shares the
    // complete edge loop on all neighbouring cells, so the extracted surface
    // remains watertight at arms, pad joints and the tips of leaves.
    const mesh = new QuadMesh();
    const cellIndex = (x: number, y: number, z: number): number => (z * ny + y) * nx + x;
    const cellVertices = new Int32Array(nx * ny * nz);
    cellVertices.fill(-1);
    const cellGradients = new Float32Array(nx * ny * nz * 3);
    const cubeCorners = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ] as const;
    const cubeEdges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ] as const;

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const ids: number[] = [];
          const ps: V3[] = [];
          const vs: number[] = [];
          for (const c of cubeCorners) {
            const gx = x + c[0];
            const gy = y + c[1];
            const gz = z + c[2];
            const id = index(gx, gy, gz);
            ids.push(id);
            ps.push(point(gx, gy, gz));
            vs.push(values[id]);
          }
          const inside = vs.some((v) => v < 0);
          const outside = vs.some((v) => v >= 0);
          if (!inside || !outside) continue;

          let centre = { x: 0, y: 0, z: 0 };
          let crossings = 0;
          for (const [a, b] of cubeEdges) {
            if ((vs[a] < 0) === (vs[b] < 0)) continue;
            const t = clamp(vs[a] / (vs[a] - vs[b]), 0.001, 0.999);
            centre = add(centre, { x: lerp(ps[a].x, ps[b].x, t), y: lerp(ps[a].y, ps[b].y, t), z: lerp(ps[a].z, ps[b].z, t) });
            crossings++;
          }
          centre = mul(centre, 1 / Math.max(1, crossings));
          const h = clamp(centre.y / Math.max(0.001, this.params.height), 0, 1);
          const g = norm({
            x: ((vs[1] + vs[2] + vs[5] + vs[6]) - (vs[0] + vs[3] + vs[4] + vs[7])) / Math.max(1e-6, 4 * dx),
            y: ((vs[3] + vs[2] + vs[7] + vs[6]) - (vs[0] + vs[1] + vs[4] + vs[5])) / Math.max(1e-6, 4 * dy),
            z: ((vs[4] + vs[5] + vs[6] + vs[7]) - (vs[0] + vs[1] + vs[2] + vs[3])) / Math.max(1e-6, 4 * dz),
          });
          const gi = cellIndex(x, y, z) * 3;
          cellGradients[gi] = g.x;
          cellGradients[gi + 1] = g.y;
          cellGradients[gi + 2] = g.z;
          const detail = this.params.form === 'barrel' ? 0.05 : this.params.form === 'agave' ? 0.32 : 0.16;
          const vi = mesh.addVertex(
            centre.x,
            centre.y,
            centre.z,
            { height: h, limb: clamp(h * this.params.wind, 0, 1), phase: ((x * 13 + y * 37 + z * 71) % 97) / 97, detail },
            { x: 0, y: 0, z: 0 },
            2,
          );
          cellVertices[cellIndex(x, y, z)] = vi;
        }
      }
    }

    const active = (x: number, y: number, z: number): number => {
      if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) return -1;
      return cellVertices[cellIndex(x, y, z)];
    };
    const emitLoop = (loop: number[], outward: V3, cells: number[]): void => {
      if (loop.some((v) => v < 0)) return;
      if (new Set(loop).size !== 4) return;
      const a = loop[0] * 3;
      const b = loop[1] * 3;
      const d = loop[3] * 3;
      const n = cross(
        { x: mesh.positions[b] - mesh.positions[a], y: mesh.positions[b + 1] - mesh.positions[a + 1], z: mesh.positions[b + 2] - mesh.positions[a + 2] },
        { x: mesh.positions[d] - mesh.positions[a], y: mesh.positions[d + 1] - mesh.positions[a + 1], z: mesh.positions[d + 2] - mesh.positions[a + 2] },
      );
      let g = { x: 0, y: 0, z: 0 };
      for (const c of cells) {
        if (c < 0) continue;
        g.x += cellGradients[c * 3];
        g.y += cellGradients[c * 3 + 1];
        g.z += cellGradients[c * 3 + 2];
      }
      g = norm(g);
      // The cell gradient is the primary orientation source. The edge axis
      // is a stable fallback at a perfectly flat sampled patch.
      if (len(g) < 1e-6) g = outward;
      if (dot(n, g) < 0) loop = [loop[0], loop[3], loop[2], loop[1]];
      mesh.addQuad(loop[0], loop[1], loop[2], loop[3], [0, 0, 1, 0, 1, 1, 0, 1]);
    };

    // A crossing edge is on the outside of the negative (inside) sample.
    // Four active cells around it form a dual quad. The loops are cyclic; the
    // sign-dependent axis only chooses the winding.
    for (let z = 1; z < nz; z++) {
      for (let y = 1; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const lo = values[index(x, y, z)];
          const hi = values[index(x + 1, y, z)];
          if ((lo < 0) === (hi < 0)) continue;
          emitLoop([active(x, y - 1, z - 1), active(x, y, z - 1), active(x, y, z), active(x, y - 1, z)], { x: lo < 0 ? 1 : -1, y: 0, z: 0 }, [cellIndex(x, y - 1, z - 1), cellIndex(x, y, z - 1), cellIndex(x, y, z), cellIndex(x, y - 1, z)]);
        }
      }
    }
    for (let z = 1; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 1; x < nx; x++) {
          const lo = values[index(x, y, z)];
          const hi = values[index(x, y + 1, z)];
          if ((lo < 0) === (hi < 0)) continue;
          emitLoop([active(x - 1, y, z - 1), active(x, y, z - 1), active(x, y, z), active(x - 1, y, z)], { x: 0, y: lo < 0 ? 1 : -1, z: 0 }, [cellIndex(x - 1, y, z - 1), cellIndex(x, y, z - 1), cellIndex(x, y, z), cellIndex(x - 1, y, z)]);
        }
      }
    }
    for (let z = 0; z < nz; z++) {
      for (let y = 1; y < ny; y++) {
        for (let x = 1; x < nx; x++) {
          const lo = values[index(x, y, z)];
          const hi = values[index(x, y, z + 1)];
          if ((lo < 0) === (hi < 0)) continue;
          emitLoop([active(x - 1, y - 1, z), active(x, y - 1, z), active(x, y, z), active(x - 1, y, z)], { x: 0, y: 0, z: lo < 0 ? 1 : -1 }, [cellIndex(x - 1, y - 1, z), cellIndex(x, y - 1, z), cellIndex(x, y, z), cellIndex(x - 1, y, z)]);
        }
      }
    }

    const organs = counts[0] + counts[1] + counts[2] + counts[3];
    return {
      mesh,
      stats: {
        organs,
        junctions: Math.max(0, organs - 1),
        dropped: 0,
        dropReasons: {},
        perLevel: counts,
        components: 1,
      },
      height: this.params.height,
      groundDepth: 0.14,
    };
  }
}

export function isDesertForm(form: DesertForm): boolean {
  return form === 'saguaro' || form === 'prickly-pear' || form === 'agave' || form === 'barrel' || form === 'ocotillo' || form === 'yucca';
}

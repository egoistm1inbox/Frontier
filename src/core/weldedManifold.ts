/**
 * Watertight Welded Quad Manifold Engine (`WeldedMesher` + `validateWeldedManifold`).
 *
 * Implements the closed-manifold tree/plant topology from Frontier-OLD
 * (`arena/01a096f8-frontier`):
 *  - Every stem is a tube of rings bridged by quads.
 *  - Side stems (branches, limbs, twigs, buttress/surface roots, petiole boots)
 *    never intersect or float inside their parent: `planHoles` cuts a
 *    non-overlapping `w x rows` rectangular window in the parent ring grid,
 *    shifts/rotates the child subtree (`rotateSubtree` + `translateSubtree` or
 *    `regrow`) so the child exits dead-center through its window, aligns the
 *    child's mitred first ring (`collarMitre` + `fitPhase`), and bridges the
 *    `2(w + rows)` window loop with tangent-continuous quadratic Bezier collar
 *    rings (`buildCollar`).
 *  - Forks (`forks.length > 0`) partition the parent's end ring into
 *    radius-weighted outer arcs + an outward-bulged crotch hub (`meshFork`),
 *    forming true Y/k-way D-rings with zero overlapping geometry.
 *  - Stem tips and root bases close with all-quad ladder caps (`cap`), so a
 *    single genus-0 stem hierarchy satisfies Euler's formula `V - E + F = 2`,
 *    `boundaryEdges === 0`, `nonManifoldEdges === 0`, `components === 1`.
 */

import {
  RGB,
  TAU,
  V3,
  add,
  addScaled,
  anyPerpendicular,
  clamp,
  clone,
  cross,
  dot,
  lengthSq,
  lerp,
  mod,
  normalize,
  projectOnPlane,
  rotateAxis,
  rotateTowards,
  scale as vscale,
  sub,
} from './math';
import { PartMesh } from './mesh';

export interface WeldedNode {
  pos: V3;
  dir: V3;
  right: V3;
  /** Arc length from physical stem base. */
  s: number;
}

export type WeldedStemRole = 'shoot' | 'root';
export type WeldedAttachKind = 'root' | 'side' | 'fork';

export interface WeldedVertexStyle {
  color: RGB;
  roughness: number;
  translucency: number;
  detailMetric: number;
  anatomyLevel: number;
  wind: [number, number, number, number];
  pivot: V3;
}

export interface WeldedStem {
  id: number;
  level: number;
  role: WeldedStemRole;
  parent: WeldedStem | null;
  attach: WeldedAttachKind;
  /** Side attachment arc length along parent polyline. */
  attachS: number;
  /** Intended emergence direction. */
  attachDir: V3;
  nodes: WeldedNode[];
  length: number;
  children: WeldedStem[];
  forks: WeldedStem[];
  dropped: boolean;
  dropReason?: string;
  /** Pipe-model cross-section drop factor applied to parent beyond this child (`1` = none). */
  radiusDrop: number;
  /** Explicit ring station spacing in metres. */
  ringSpacing?: number;
  /** Minimum vertices in this stem's first ring (even, >= 4). */
  minRing?: number;
  /** Optional explicit window column count on parent ring (e.g. ground-level primary roots). */
  windowCols?: number;
  /** Optional mandatory interior arc-length stations (e.g. bamboo/palm nodes). */
  extraStations?: number[];
  /** Base nominal radius of this stem (without pipe drop or angular lobes). */
  baseRadiusAt: (s: number) => number;
  /** Optional angular profile factor `(s, thetaInStemFrame, isTrunk) => multiplier` (lobes, U-grooves, etc.). */
  profileFactor?: (s: number, theta: number) => number;
  /** Per-vertex shading, wind & pivot callback. */
  styleAt: (s: number, theta: number, pos: V3, dir: V3, isJunction: boolean) => WeldedVertexStyle;
  /** Optional environment-aware regrowth callback when `planHoles` relocates a root exit. */
  regrow?: (origin: V3, emergeDir: V3) => void;
  /** Optional hook invoked when `planHoles` rigidly rotates/translates a shoot subtree (keeps leaves/ribbons aligned). */
  onTransform?: (mapPos: (p: V3) => V3, mapDir: (d: V3) => V3) => void;
}

export interface WeldedMeshConfig {
  trunkRadialSegments: number;
  minRadialSegments: number;
  collarScale: number;
  collarLength: number;
  collarRings: number;
  collarFillet: number;
  collarMitre: number;
  minRadius: number;
  capTips: boolean;
}

export const DEFAULT_WELDED_CONFIG: WeldedMeshConfig = {
  trunkRadialSegments: 24,
  minRadialSegments: 6,
  collarScale: 1.3,
  collarLength: 1.2,
  collarRings: 1,
  collarFillet: 0.72,
  collarMitre: 0.5,
  minRadius: 0.004,
  capTips: true,
};

export interface WeldedBuildStats {
  stems: number;
  droppedStems: number;
  dropReasons: Record<string, number>;
  junctions: number;
  forks: number;
  maxDepth: number;
  rootStems: number;
  droppedRoots: number;
}

export interface WeldedManifoldReport {
  vertices: number;
  edges: number;
  faces: number;
  quads: number;
  tris: number;
  quadRatio: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  isolatedVertices: number;
  eulerCharacteristic: number;
  components: number;
  closed: boolean;
  manifold: boolean;
  degenerateFaces: number;
}

interface Ring {
  idx: number[];
  s: number;
  center: V3;
  dir: V3;
  radius: number;
}

interface HolePlan {
  child: WeldedStem;
  s: number;
  sLow: number;
  sHigh: number;
  j0: number;
  w: number;
  hh: number;
  rows: number;
  row0: number;
  row1: number;
  along: number;
}

type BaseInfo =
  | { kind: 'root' }
  | { kind: 'side'; loop: number[]; radial: V3; parentDir: V3 }
  | { kind: 'fork'; dRing: number[]; t1: number };

/** Sample position and parallel-transported frame of a stem polyline at arc length `s` (clamped). */
export function sampleWeldedStem(stem: WeldedStem, s: number): { pos: V3; dir: V3; right: V3 } {
  const nodes = stem.nodes;
  if (s <= 0 || nodes.length === 1) {
    const n = nodes[0];
    return { pos: clone(n.pos), dir: clone(n.dir), right: clone(n.right) };
  }
  const last = nodes[nodes.length - 1];
  if (s >= last.s) return { pos: clone(last.pos), dir: clone(last.dir), right: clone(last.right) };
  let lo = 0;
  let hi = nodes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = nodes[lo];
  const b = nodes[hi];
  const t = (s - a.s) / Math.max(1e-9, b.s - a.s);
  const pos = {
    x: a.pos.x + (b.pos.x - a.pos.x) * t,
    y: a.pos.y + (b.pos.y - a.pos.y) * t,
    z: a.pos.z + (b.pos.z - a.pos.z) * t,
  };
  const dir = normalize({
    x: a.dir.x + (b.dir.x - a.dir.x) * t,
    y: a.dir.y + (b.dir.y - a.dir.y) * t,
    z: a.dir.z + (b.dir.z - a.dir.z) * t,
  });
  let right = projectOnPlane(
    {
      x: a.right.x + (b.right.x - a.right.x) * t,
      y: a.right.y + (b.right.y - a.right.y) * t,
      z: a.right.z + (b.right.z - a.right.z) * t,
    },
    dir,
  );
  if (lengthSq(right) < 1e-10) right = anyPerpendicular(dir);
  else right = normalize(right);
  return { pos, dir, right };
}

/** Da Vinci pipe-model cross-section reduction factor along a parent stem. */
export function weldedPipeFactor(stem: WeldedStem, s: number, collarScale: number): number {
  let f = 1;
  for (const c of stem.children) {
    if (c.dropped || c.radiusDrop >= 1) continue;
    const rc0 = c.baseRadiusAt(0);
    const hh = Math.max(1e-6, rc0 * collarScale);
    const t = clamp((s - (c.attachS - hh)) / (2 * hh), 0, 1);
    if (t <= 0) continue;
    const k = t * t * (3 - 2 * t);
    f *= 1 + (c.radiusDrop - 1) * k;
  }
  return f;
}

/** Effective nominal stem radius (with pipe-model reduction, clamped to `minRadius`). */
export function weldedRadiusAt(stem: WeldedStem, s: number, cfg: WeldedMeshConfig): number {
  let r = stem.baseRadiusAt(s);
  if (stem.children.length > 0) r *= weldedPipeFactor(stem, s, cfg.collarScale);
  return Math.max(cfg.minRadius, r);
}

/** Rigidly transform a stem and its whole subtree (plus any `onTransform` foliage). */
export function transformWeldedSubtree(
  stem: WeldedStem,
  mapPos: (p: V3) => V3,
  mapDir: (d: V3) => V3,
): void {
  const stack: WeldedStem[] = [stem];
  while (stack.length) {
    const s = stack.pop()!;
    for (const n of s.nodes) {
      n.pos = mapPos(n.pos);
      n.dir = mapDir(n.dir);
      n.right = mapDir(n.right);
    }
    s.attachDir = mapDir(s.attachDir);
    if (s.onTransform) s.onTransform(mapPos, mapDir);
    for (const c of s.children) stack.push(c);
    for (const f of s.forks) stack.push(f);
  }
}

export function translateWeldedSubtree(stem: WeldedStem, delta: V3): void {
  transformWeldedSubtree(stem, (p) => add(p, delta), (d) => d);
}

export function rotateWeldedSubtree(stem: WeldedStem, origin: V3, axis: V3, angle: number): void {
  transformWeldedSubtree(
    stem,
    (p) => add(origin, rotateAxis(sub(p, origin), axis, angle)),
    (d) => normalize(rotateAxis(d, axis, angle)),
  );
}

function collarStart(stem: WeldedStem, cfg: WeldedMeshConfig): number {
  const r0 = weldedRadiusAt(stem, 0, cfg);
  return Math.min(cfg.collarLength * r0, 0.5 * stem.length);
}

function nearestIndex(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo] - v) <= Math.abs(sorted[hi] - v) ? lo : hi;
}

function circularOverlap(a: number, wa: number, b: number, wb: number, N: number): boolean {
  if (wa >= N || wb >= N) return true;
  a = mod(a, N);
  b = mod(b, N);
  const d = mod(b - a, N);
  if (d < wa) return true;
  const d2 = mod(a - b, N);
  return d2 < wb;
}

export class WeldedMesher {
  private stats: WeldedBuildStats = {
    stems: 0,
    droppedStems: 0,
    dropReasons: {},
    junctions: 0,
    forks: 0,
    maxDepth: 0,
    rootStems: 0,
    droppedRoots: 0,
  };

  constructor(
    private readonly mesh: PartMesh,
    private readonly roots: WeldedStem[],
    private readonly cfg: WeldedMeshConfig = DEFAULT_WELDED_CONFIG,
  ) {}

  build(): WeldedBuildStats {
    for (const root of this.roots) {
      this.meshStem(root, { kind: 'root' }, 0);
    }
    return this.stats;
  }

  private surfaceRadius(stem: WeldedStem, s: number, theta: number): number {
    const base = weldedRadiusAt(stem, s, this.cfg);
    return stem.profileFactor ? base * stem.profileFactor(s, theta) : base;
  }

  private emitVertex(
    p: V3,
    stem: WeldedStem,
    s: number,
    theta: number,
    dir: V3,
    u: number,
    isJunction: boolean,
  ): number {
    const L = Math.max(1e-6, stem.length);
    const st = stem.styleAt(s, theta, p, dir, isJunction);
    return this.mesh.addVertex({
      x: p.x,
      y: p.y,
      z: p.z,
      tx: dir.x,
      ty: dir.y,
      tz: dir.z,
      u,
      v: s / L,
      color: st.color,
      wind: st.wind,
      pivot: st.pivot,
      roughness: st.roughness,
      translucency: st.translucency,
      detailMetric: isJunction ? Math.max(0.95, st.detailMetric) : st.detailMetric,
      anatomyLevel: st.anatomyLevel,
    });
  }

  private markJunction(vIdx: number): void {
    const sOff = vIdx * 4 + 2;
    if (sOff < this.mesh.surface.length) {
      this.mesh.surface[sOff] = Math.max(0.95, this.mesh.surface[sOff]);
    }
  }

  private pos(i: number): V3 {
    const p = this.mesh.positions;
    return { x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] };
  }

  private drop(stem: WeldedStem, reason: string): void {
    stem.dropped = true;
    stem.dropReason = reason;
    this.stats.droppedStems++;
    if (stem.role === 'root') this.stats.droppedRoots++;
    this.stats.dropReasons[reason] = (this.stats.dropReasons[reason] ?? 0) + 1;
  }

  private meshStem(stem: WeldedStem, base: BaseInfo, depth: number): void {
    const cfg = this.cfg;
    this.stats.stems++;
    if (stem.role === 'root') this.stats.rootStems++;
    if (depth > this.stats.maxDepth) this.stats.maxDepth = depth;

    const N =
      base.kind === 'root'
        ? Math.max(4, Math.round((stem.minRing ?? cfg.trunkRadialSegments) / 2) * 2)
        : base.kind === 'side'
          ? base.loop.length
          : base.dRing.length;
    const L = stem.length;
    const r0 = weldedRadiusAt(stem, 0, cfg);

    let sStart = 0;
    if (base.kind === 'side') sStart = collarStart(stem, cfg);
    else if (base.kind === 'fork') sStart = Math.min(base.t1, 0.7 * L);

    // Mitre: tilt child ring 0 toward parent surface normal for balanced collar quads
    let tilt: V3 | undefined;
    if (base.kind === 'side') {
      const a0 = stem.nodes[0].dir;
      const theta = Math.acos(clamp(dot(a0, base.radial), -1, 1));
      const dScale = clamp(sStart / Math.max(1e-6, cfg.collarLength * r0), 0, 1);
      const alpha = theta * clamp(cfg.collarMitre, 0, 0.9) * dScale;
      if (alpha > 1e-3) tilt = rotateTowards(a0, base.radial, alpha);
    }

    // Fit angular phase to parent hole loop or fork D-ring
    let phase = 0;
    let loop: number[] | null = null;
    if (base.kind === 'side') loop = base.loop.slice();
    else if (base.kind === 'fork') loop = base.dRing.slice();
    if (loop) {
      const smp = sampleWeldedStem(stem, sStart);
      phase = this.fitPhase(loop, smp.pos, smp.dir, smp.right);
    }

    // Plan side-branch / root windows
    const holes = this.planHoles(stem, N, phase, sStart, L);

    // Build merged axial stations
    const stations = this.buildStations(stem, holes, sStart, L, base.kind);
    const K = stations.length;

    // Map hole windows onto station rows and verify non-overlap
    const occupied = new Uint8Array(Math.max(1, K - 1) * N);
    const accepted: HolePlan[] = [];
    for (const h of holes) {
      let row0 = nearestIndex(stations, h.sLow);
      let row1 = nearestIndex(stations, h.sHigh);
      if (row1 - row0 < h.rows) row1 = row0 + h.rows;
      if (row1 > K - 1) {
        row1 = K - 1;
        row0 = Math.max(0, row1 - h.rows);
      }
      if (row1 <= row0 || row0 < 0) {
        this.drop(h.child, 'no room on parent');
        continue;
      }
      let free = true;
      for (let i = row0; i < row1 && free; i++) {
        for (let j = 0; j < h.w; j++) {
          if (occupied[i * N + mod(h.j0 + j, N)]) free = false;
        }
      }
      if (!free) {
        this.drop(h.child, 'window conflict');
        continue;
      }
      for (let i = row0; i < row1; i++) {
        for (let j = 0; j < h.w; j++) {
          occupied[i * N + mod(h.j0 + j, N)] = 1;
        }
      }
      h.row0 = row0;
      h.row1 = row1;
      accepted.push(h);
    }

    const cellOcc = (i: number, j: number): boolean =>
      i >= 0 && i < K - 1 && occupied[i * N + mod(j, N)] === 1;
    const interior = (i: number, j: number): boolean =>
      cellOcc(i - 1, j - 1) && cellOcc(i - 1, j) && cellOcc(i, j - 1) && cellOcc(i, j);

    const rings: Ring[] = [];
    for (let i = 0; i < K; i++) {
      rings.push(
        this.buildRing(stem, stations[i], N, phase, i === 0 ? tilt : undefined, (j) => interior(i, j)),
      );
    }

    // Base cap / collar / fork bridge
    if (base.kind === 'root') {
      this.cap(rings[0].idx, true);
    } else if (base.kind === 'side' && loop) {
      this.buildCollar(stem, loop, rings[0], base.radial, r0);
      this.stats.junctions++;
    } else if (base.kind === 'fork' && loop) {
      const first = rings[0];
      const mid: number[] = [];
      const M = loop.length;
      const forkPt = stem.nodes[0].pos;
      const chordMid = lerp(forkPt, first.center, 0.5);
      for (let k = 0; k < M; k++) {
        const a = this.pos(loop[k]);
        const b = this.pos(first.idx[k]);
        let p = lerp(a, b, 0.5);
        let out = projectOnPlane(sub(p, chordMid), first.dir);
        if (lengthSq(out) > 1e-12) {
          out = normalize(out);
          p = addScaled(p, out, first.radius * 0.1);
        }
        mid.push(this.emitVertex(p, stem, sStart * 0.5, (TAU * k) / M, first.dir, k / M, true));
      }
      this.bridgeLoops(loop, mid, true);
      this.bridgeLoops(mid, first.idx, true);
    }

    // Tube quads (skipping window cells)
    for (let i = 0; i < K - 1; i++) {
      const a = rings[i].idx;
      const b = rings[i + 1].idx;
      for (let j = 0; j < N; j++) {
        if (occupied[i * N + j]) continue;
        const j1 = (j + 1) % N;
        this.mesh.addQuad(a[j], a[j1], b[j1], b[j]);
      }
    }

    // End: fork or tip cap
    if (stem.forks.length > 0 && K >= 1) {
      this.meshFork(stem, rings[K - 1], depth);
    } else if (K >= 1) {
      this.cap(rings[K - 1].idx, false);
    }

    // Recurse into accepted side children
    for (const h of accepted) {
      const loopIdx = this.holeLoop(rings, h, N);
      const ps = sampleWeldedStem(stem, h.child.attachS);
      let radial = projectOnPlane(sub(h.child.nodes[0].pos, ps.pos), ps.dir);
      radial = lengthSq(radial) < 1e-12 ? anyPerpendicular(ps.dir) : normalize(radial);
      this.meshStem(h.child, { kind: 'side', loop: loopIdx, radial, parentDir: ps.dir }, depth + 1);
    }
  }

  private buildRing(
    stem: WeldedStem,
    s: number,
    N: number,
    phase: number,
    tiltNormal?: V3,
    skip?: (j: number) => boolean,
  ): Ring {
    const smp = sampleWeldedStem(stem, s);
    const r = weldedRadiusAt(stem, s, this.cfg);
    const up = cross(smp.dir, smp.right);
    const idx: number[] = new Array(N);
    const an = tiltNormal ? dot(smp.dir, tiltNormal) : 1;
    for (let j = 0; j < N; j++) {
      if (skip && skip(j)) {
        idx[j] = -1;
        continue;
      }
      const th = phase + (TAU * j) / N;
      const rr = stem.profileFactor ? r * stem.profileFactor(s, th) : r;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const off = {
        x: rr * (c * smp.right.x + sn * up.x),
        y: rr * (c * smp.right.y + sn * up.y),
        z: rr * (c * smp.right.z + sn * up.z),
      };
      if (tiltNormal && an > 0.3) {
        const lambda = -dot(off, tiltNormal) / an;
        off.x += smp.dir.x * lambda;
        off.y += smp.dir.y * lambda;
        off.z += smp.dir.z * lambda;
      }
      idx[j] = this.emitVertex(
        { x: smp.pos.x + off.x, y: smp.pos.y + off.y, z: smp.pos.z + off.z },
        stem,
        s,
        th,
        smp.dir,
        j / N,
        false,
      );
    }
    return { idx, s, center: smp.pos, dir: smp.dir, radius: r };
  }

  private fitPhase(loop: number[], center: V3, dir: V3, right: V3): number {
    const up = cross(dir, right);
    const M = loop.length;
    const xs: number[] = new Array(M);
    const ys: number[] = new Array(M);
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < M; k++) {
      const v = sub(this.pos(loop[k]), center);
      xs[k] = dot(v, right);
      ys[k] = dot(v, up);
      cx += xs[k];
      cy += ys[k];
    }
    cx /= M;
    cy /= M;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < M; k++) {
      const a = Math.atan2(ys[k] - cy, xs[k] - cx) - (TAU * k) / M;
      sx += Math.cos(a);
      sy += Math.sin(a);
    }
    return Math.atan2(sy, sx);
  }

  private buildCollar(stem: WeldedStem, loop: number[], first: Ring, radial: V3, r0: number): void {
    const cfg = this.cfg;
    const n = Math.max(0, Math.round(cfg.collarRings));
    const M = loop.length;
    const a0 = stem.nodes[0].dir;
    const cosT = Math.max(0.2, dot(a0, radial));
    const fillet = clamp(cfg.collarFillet, 0, 1);
    let prev = loop;
    for (let q = 0; q < n; q++) {
      const k = (q + 1) / (n + 1);
      const mid: number[] = [];
      for (let i = 0; i < M; i++) {
        const a = this.pos(loop[i]);
        const b = this.pos(first.idx[i]);
        const chord = lerp(a, b, k);
        let mu = dot(sub(b, a), radial) / cosT;
        mu = clamp(mu, 0, 4 * r0);
        const c = addScaled(b, a0, -mu);
        const w0 = (1 - k) * (1 - k);
        const w1 = 2 * k * (1 - k);
        const w2 = k * k;
        const bez = {
          x: a.x * w0 + c.x * w1 + b.x * w2,
          y: a.y * w0 + c.y * w1 + b.y * w2,
          z: a.z * w0 + c.z * w1 + b.z * w2,
        };
        const p = lerp(chord, bez, fillet);
        mid.push(this.emitVertex(p, stem, first.s * k, (TAU * i) / M, first.dir, i / M, true));
      }
      this.bridgeLoops(prev, mid, true);
      prev = mid;
    }
    this.bridgeLoops(prev, first.idx, true);
  }

  private bridgeLoops(a: number[], b: number[], junction: boolean): void {
    const M = a.length;
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M;
      this.mesh.addQuad(a[k], a[k1], b[k1], b[k]);
      if (junction) {
        this.markJunction(a[k]);
        this.markJunction(b[k]);
      }
    }
  }

  private cap(ring: number[], flip: boolean): void {
    if (!this.cfg.capTips && !flip) return;
    const M = ring.length;
    const r = flip ? [...ring].reverse() : ring;
    for (let i = 0; 2 * i <= M - 3; i++) {
      const a = r[i];
      const b = r[i + 1];
      const c = r[M - 2 - i];
      const d = r[M - 1 - i];
      this.mesh.addQuad(a, b, c, d);
    }
  }

  private planHoles(stem: WeldedStem, N: number, phase: number, sStart: number, L: number): HolePlan[] {
    const cfg = this.cfg;
    const cands: HolePlan[] = [];
    const children = stem.children.filter((c) => !c.dropped);
    children.sort((a, b) => weldedRadiusAt(b, 0, cfg) - weldedRadiusAt(a, 0, cfg));

    const colStep = TAU / N;
    const wMax = Math.max(1, Math.floor(N / 2) - 1);

    for (const child of children) {
      const minRing = Math.max(4, Math.round((child.minRing ?? cfg.minRadialSegments) / 2) * 2);
      const sAttach = child.attachS;
      const smp = sampleWeldedStem(stem, sAttach);
      const rp = weldedRadiusAt(stem, sAttach, cfg);
      const rc = weldedRadiusAt(child, 0, cfg);
      const rho = rc * cfg.collarScale;
      const chord = (TAU * rp) / N;

      const a0 = child.nodes[0].dir;
      const d0 = collarStart(child, cfg);
      const along = d0 * dot(a0, smp.dir);
      const sinT = Math.sqrt(Math.max(0, 1 - dot(a0, smp.dir) ** 2));
      const extentHalf = rc * Math.max(0.6, 1 / Math.max(0.35, sinT)) * 0.5 + rc * 0.5;

      let w = child.windowCols
        ? clamp(Math.round(child.windowCols), 1, wMax)
        : clamp(Math.round((2 * rho) / chord), 1, wMax);
      const hMin = Math.max(1, Math.ceil(minRing / 2 - w));
      if (hMin > 2 && w < wMax && !child.windowCols) {
        w = Math.min(wMax, Math.max(w, Math.ceil(minRing / 2) - 2));
      }
      const W = w * chord;
      const hRows = Math.max(1, Math.ceil(minRing / 2 - w));
      const hh = Math.max(rho, extentHalf * cfg.collarScale, W * 0.5, ((hRows * W) / (2 * w)) * 0.9);
      const s = sAttach + along;
      const up = cross(smp.dir, smp.right);
      let radial = projectOnPlane(sub(child.nodes[0].pos, smp.pos), smp.dir);
      if (lengthSq(radial) < 1e-12) radial = projectOnPlane(child.attachDir, smp.dir);
      if (lengthSq(radial) < 1e-12) radial = smp.right;
      radial = normalize(radial);
      const phi = Math.atan2(dot(radial, up), dot(radial, smp.right)) - phase;
      const jc = phi / colStep;
      const j0 = Math.round(jc - w / 2);
      cands.push({ child, s, sLow: s - hh, sHigh: s + hh, j0, w, hh, rows: hRows, row0: 0, row1: 0, along });
    }

    const accepted: HolePlan[] = [];
    const r0 = weldedRadiusAt(stem, 0, cfg);
    const sMin = sStart + (stem.attach === 'side' ? 0.45 * r0 : 1e-4);
    const maxTurn = Math.PI / 4;

    for (const c of cands) {
      const eps = c.hh * 0.6;
      const conflicts = (sLow: number, sHigh: number, j0: number): boolean => {
        for (const a of accepted) {
          const sOverlap = sLow < a.sHigh + eps && a.sLow < sHigh + eps;
          if (!sOverlap) continue;
          if (circularOverlap(j0 - 1, c.w + 2, a.j0, a.w, N)) return true;
        }
        return false;
      };
      const fits = (sLow: number, sHigh: number): boolean =>
        sLow >= sMin + c.hh * 0.15 && sHigh <= L + 1e-6 && sLow + c.hh - c.along > 1e-4;

      let placed: { ds: number; dj: number } | null = null;
      const options: { ds: number; dj: number; cost: number }[] = [];
      const maxDj = Math.max(1, Math.min(c.w + 1, Math.floor(maxTurn / colStep)));
      const isRoot = c.child.role === 'root';
      for (let dj = -maxDj; dj <= maxDj; dj++) {
        for (let ks = -6; ks <= 6; ks++) {
          const ds = ks * c.hh;
          const cost = isRoot
            ? (ks < 0 ? -ks * 2.0 : ks * 6.0) + Math.abs(dj) * 1.0
            : Math.abs(ks) * 1.0 + Math.abs(dj) * 1.5;
          options.push({ ds, dj, cost });
        }
      }
      options.sort((a, b) => a.cost - b.cost);
      const groundLevel = !!c.child.windowCols;
      const attempts: { narrow: boolean; anyDs: boolean }[] = groundLevel
        ? [
            { narrow: false, anyDs: false },
            { narrow: true, anyDs: false },
            { narrow: false, anyDs: true },
          ]
        : [
            { narrow: false, anyDs: true },
            { narrow: true, anyDs: true },
          ];
      for (const a of attempts) {
        if (placed) break;
        if (a.narrow) {
          if (c.w <= 1) continue;
          c.w -= 1;
          c.rows += 1;
        }
        for (const o of options) {
          if (!a.anyDs && o.ds !== 0) continue;
          const sLow = c.sLow + o.ds;
          const sHigh = c.sHigh + o.ds;
          if (!fits(sLow, sHigh)) continue;
          if (conflicts(sLow, sHigh, c.j0 + o.dj)) continue;
          placed = o;
          break;
        }
      }
      if (!placed) {
        this.drop(c.child, 'window conflict');
        continue;
      }

      // Relocate child subtree so it exits dead-center through its assigned window!
      const oldSmp = sampleWeldedStem(stem, c.child.attachS);
      const newS = c.s + placed.ds;
      const newAttach = newS - c.along;
      const newJ0 = c.j0 + placed.dj;
      const newCenterCol = newJ0 + c.w / 2;
      const oldUp = cross(oldSmp.dir, oldSmp.right);
      let oldRadialProj = projectOnPlane(sub(c.child.nodes[0].pos, oldSmp.pos), oldSmp.dir);
      if (lengthSq(oldRadialProj) < 1e-12) oldRadialProj = projectOnPlane(c.child.attachDir, oldSmp.dir);
      if (lengthSq(oldRadialProj) < 1e-12) oldRadialProj = oldSmp.right;
      const oldRadial = normalize(oldRadialProj);
      const oldAz = Math.atan2(dot(oldRadial, oldUp), dot(oldRadial, oldSmp.right));
      const newAz = phase + newCenterCol * colStep;
      let dAz = newAz - oldAz;
      while (dAz > Math.PI) dAz -= TAU;
      while (dAz < -Math.PI) dAz += TAU;

      const newSmp = sampleWeldedStem(stem, newAttach);
      const newUp = cross(newSmp.dir, newSmp.right);
      const rpNew = this.surfaceRadius(stem, newAttach, newAz);
      const radialNew = add(vscale(newSmp.right, Math.cos(newAz)), vscale(newUp, Math.sin(newAz)));
      const target = addScaled(newSmp.pos, radialNew, rpNew);

      if (c.child.regrow) {
        const delta = sub(target, c.child.nodes[0].pos);
        if (Math.abs(dAz) > 1e-6 || lengthSq(delta) > 1e-14) {
          const newDir = normalize(rotateAxis(c.child.attachDir, oldSmp.dir, dAz));
          c.child.attachDir = newDir;
          c.child.attachS = newAttach;
          c.child.regrow(target, newDir);
        }
      } else {
        if (Math.abs(dAz) > 1e-6) rotateWeldedSubtree(c.child, oldSmp.pos, oldSmp.dir, dAz);
        const delta = sub(target, c.child.nodes[0].pos);
        if (lengthSq(delta) > 1e-14) translateWeldedSubtree(c.child, delta);
      }

      c.child.attachS = newAttach;
      c.s = newS;
      c.sLow += placed.ds;
      c.sHigh += placed.ds;
      c.j0 = mod(newJ0, N);
      accepted.push(c);
    }
    return accepted;
  }

  private buildStations(
    stem: WeldedStem,
    holes: HolePlan[],
    sStart: number,
    L: number,
    kind: BaseInfo['kind'],
  ): number[] {
    const spacing = stem.ringSpacing ?? Math.max(0.03, L / 18);
    if (L - sStart < 1e-6) return [sStart];

    type St = { s: number; pri: number };
    const mand: St[] = [
      { s: sStart, pri: 3 },
      { s: L, pri: 3 },
    ];
    let minHole = Infinity;
    for (const h of holes) {
      mand.push({ s: h.sLow, pri: 2 }, { s: h.sHigh, pri: 2 });
      for (let r = 1; r < h.rows; r++) {
        mand.push({ s: h.sLow + ((h.sHigh - h.sLow) * r) / h.rows, pri: 2 });
      }
      const cell = (h.hh * 2) / h.rows;
      if (cell < minHole) minHole = cell;
    }
    if (stem.extraStations) {
      for (const es of stem.extraStations) {
        if (es > sStart && es < L) mand.push({ s: es, pri: 1 });
      }
    }
    if (kind === 'side' && stem.role !== 'root') {
      const emergeSpan = Math.min(L * 0.35, Math.max(spacing * 3, collarStart(stem, this.cfg) * 2.5));
      for (const nd of stem.nodes) {
        if (nd.s <= sStart + 1e-6) continue;
        if (nd.s > emergeSpan + 1e-6 || nd.s >= L) break;
        mand.push({ s: nd.s, pri: 1 });
      }
    }

    const eps = Math.min(spacing * 0.3, Number.isFinite(minHole) ? minHole * 0.3 : Infinity);
    mand.sort((a, b) => a.s - b.s || b.pri - a.pri);
    const kept: St[] = [];
    for (const st of mand) {
      const last = kept[kept.length - 1];
      if (last && st.s - last.s < eps) {
        if (st.pri > last.pri) kept[kept.length - 1] = st;
        continue;
      }
      kept.push(st);
    }
    kept[kept.length - 1] = { s: L, pri: 3 };
    if (kept.length >= 2 && kept[kept.length - 1].s - kept[kept.length - 2].s < eps * 0.5) {
      kept.splice(kept.length - 2, 1);
    }

    const out: number[] = [];
    for (let i = 0; i < kept.length; i++) {
      out.push(kept[i].s);
      if (i === kept.length - 1) break;
      const gap = kept[i + 1].s - kept[i].s;
      const n = Math.floor(gap / spacing);
      if (n >= 1) {
        const step = gap / (n + 1);
        for (let k = 1; k <= n; k++) out.push(kept[i].s + k * step);
      }
    }
    return out;
  }

  private holeLoop(rings: Ring[], h: HolePlan, N: number): number[] {
    const loop: number[] = [];
    const { row0, row1, j0, w } = h;
    for (let j = 0; j <= w; j++) loop.push(rings[row0].idx[mod(j0 + j, N)]);
    for (let i = row0 + 1; i <= row1; i++) loop.push(rings[i].idx[mod(j0 + w, N)]);
    for (let j = w - 1; j >= 0; j--) loop.push(rings[row1].idx[mod(j0 + j, N)]);
    for (let i = row1 - 1; i >= row0 + 1; i--) loop.push(rings[i].idx[mod(j0, N)]);
    for (const v of loop) this.markJunction(v);
    return loop;
  }

  private meshFork(stem: WeldedStem, E: Ring, depth: number): void {
    const cfg = this.cfg;
    const N = E.idx.length;
    const kids = stem.forks.filter((k) => !k.dropped);
    if (kids.length === 0) {
      this.cap(E.idx, false);
      return;
    }
    this.stats.forks++;
    const F = E.center;
    const dirP = E.dir;
    const right = E.idx.length
      ? normalize(projectOnPlane(sub(this.pos(E.idx[0]), F), dirP))
      : anyPerpendicular(dirP);
    const up = cross(dirP, right);
    const colStep = TAU / N;

    let meanDir = { x: 0, y: 0, z: 0 };
    for (const k of kids) meanDir = add(meanDir, k.nodes[0].dir);
    meanDir = lengthSq(meanDir) < 1e-10 ? dirP : normalize(meanDir);

    type KidInfo = { stem: WeldedStem; col: number; r: number; theta: number; t1: number; proj: V3 };
    const infos: KidInfo[] = [];
    for (const k of kids) {
      const d = k.nodes[0].dir;
      let proj = projectOnPlane(d, dirP);
      const r = weldedRadiusAt(k, 0, cfg);
      const theta = Math.max(0.05, Math.acos(clamp(dot(d, meanDir), -1, 1)));
      const sep = Math.sin(Math.min(Math.PI / 2, 2 * theta));
      const t1 = clamp((2 * r) / Math.max(0.05, sep), 1.5 * r, 6 * r);
      if (lengthSq(proj) < 1e-10) proj = { x: 0, y: 0, z: 0 };
      infos.push({ stem: k, col: 0, r, theta, t1, proj });
    }
    for (const info of infos) {
      if (lengthSq(info.proj) > 1e-10) {
        const az = Math.atan2(dot(info.proj, up), dot(info.proj, right));
        info.col = mod(az / colStep, N);
      } else {
        info.col = NaN;
      }
    }
    for (const info of infos) {
      if (!Number.isNaN(info.col)) continue;
      let sx = 0;
      let sy = 0;
      for (const o of infos) {
        if (Number.isNaN(o.col)) continue;
        sx += Math.cos(o.col * colStep);
        sy += Math.sin(o.col * colStep);
      }
      const az = Math.atan2(-sy, -sx);
      info.col = mod(az / colStep, N);
    }
    infos.sort((a, b) => a.col - b.col);
    const k = infos.length;

    const splits: number[] = new Array(k);
    for (let i = 0; i < k; i++) {
      const a = infos[i];
      const b = infos[(i + 1) % k];
      let gap = b.col - a.col;
      if (i === k - 1) gap += N;
      if (k === 1) gap = N;
      const t = a.r / (a.r + b.r);
      splits[i] = mod(Math.round(a.col + gap * t), N);
    }
    if (k > 1) {
      for (let iter = 0; iter < N; iter++) {
        let ok = true;
        for (let i = 0; i < k; i++) {
          const a = splits[(i + k - 1) % k];
          const b = splits[i];
          if (mod(b - a, N) === 0) {
            splits[i] = mod(b + 1, N);
            ok = false;
          }
        }
        if (ok) break;
      }
    }

    const arcLen: number[] = new Array(k);
    let aMin = N;
    for (let i = 0; i < k; i++) {
      const a = splits[(i + k - 1) % k];
      const b = splits[i];
      arcLen[i] = k === 1 ? N : mod(b - a, N);
      if (arcLen[i] < aMin) aMin = arcLen[i];
    }

    if (k === 1) {
      const child = infos[0].stem;
      this.meshStem(
        child,
        { kind: 'fork', dRing: E.idx.slice(), t1: Math.min(infos[0].t1, child.length * 0.5) },
        depth + 1,
      );
      return;
    }

    let hc = 0;
    for (const info of infos) hc += info.t1 * Math.cos(info.theta);
    hc /= k;
    hc = clamp(hc, 0.5 * E.radius, 4 * E.radius);
    const H = addScaled(F, meanDir, hc);
    const m = Math.max(0, Math.floor((aMin + 1) / 2) - 1);
    const hub = this.emitVertex(H, stem, stem.length, 0, meanDir, 0.5, true);
    const half: number[][] = new Array(k);
    for (let i = 0; i < k; i++) {
      const S = this.pos(E.idx[splits[i]]);
      const arr: number[] = [];
      const outward = normalize(projectOnPlane(sub(S, F), meanDir));
      for (let q = 0; q < m; q++) {
        const u = (q + 1) / (m + 1);
        let p = lerp(S, H, u);
        p = addScaled(p, outward, Math.sin(Math.PI * u) * E.radius * 0.12);
        arr.push(this.emitVertex(p, stem, stem.length, (splits[i] / N) * TAU, meanDir, u, true));
      }
      half[i] = arr;
    }
    for (const v of E.idx) this.markJunction(v);

    for (let i = 0; i < k; i++) {
      const sA = splits[(i + k - 1) % k];
      const ring: number[] = [];
      for (let j = 0; j <= arcLen[i]; j++) ring.push(E.idx[mod(sA + j, N)]);
      for (const v of half[i]) ring.push(v);
      ring.push(hub);
      const back = half[(i + k - 1) % k];
      for (let q = back.length - 1; q >= 0; q--) ring.push(back[q]);
      const child = infos[i].stem;
      const t1 = Math.min(infos[i].t1, child.length * 0.7);
      this.meshStem(child, { kind: 'fork', dRing: ring, t1 }, depth + 1);
    }
  }
}

/**
 * Exact 2-manifold & Euler characteristic validator on a `PartMesh` (`quads` + `tris`).
 * Mirrors `validateTopology` in Frontier-OLD (`arena/01a096f8-frontier`).
 */
export function validateWeldedManifold(mesh: PartMesh): WeldedManifoldReport {
  const V = mesh.vertexCount;
  const edgeCount = new Map<string, number>();
  const edgeDir = new Map<string, number>();
  const used = new Uint8Array(V);
  let degenerate = 0;

  const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

  const parent = new Int32Array(V);
  for (let i = 0; i < V; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const processFace = (ids: number[]): void => {
    const n = ids.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) if (ids[i] === ids[j]) degenerate++;
    }
    for (let i = 0; i < n; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % n];
      used[a] = 1;
      unite(a, b);
      const k = key(a, b);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      edgeDir.set(k, (edgeDir.get(k) ?? 0) + (a < b ? 1 : -1));
    }
  };

  const q = mesh.quads;
  for (let f = 0; f < q.length; f += 4) processFace([q[f], q[f + 1], q[f + 2], q[f + 3]]);
  const t = mesh.tris;
  for (let f = 0; f < t.length; f += 3) processFace([t[f], t[f + 1], t[f + 2]]);

  let boundary = 0;
  let nonManifold = 0;
  let inconsistent = 0;
  for (const [k, c] of edgeCount) {
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
    else if (edgeDir.get(k) !== 0) inconsistent++;
  }

  let isolated = 0;
  const compRoots = new Set<number>();
  for (let i = 0; i < V; i++) {
    if (!used[i]) isolated++;
    else compRoots.add(find(i));
  }

  const E = edgeCount.size;
  const F = mesh.quadCount + mesh.triCount;
  const chi = V - isolated - E + F;

  return {
    vertices: V,
    edges: E,
    faces: F,
    quads: mesh.quadCount,
    tris: mesh.triCount,
    quadRatio: F > 0 ? mesh.quadCount / F : 1,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    isolatedVertices: isolated,
    eulerCharacteristic: chi,
    components: compRoots.size,
    closed: boundary === 0,
    manifold: nonManifold === 0 && inconsistent === 0 && degenerate === 0,
    degenerateFaces: degenerate,
  };
}

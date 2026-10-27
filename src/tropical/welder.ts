/**
 * Window-welding tube builder — the heart of the generator.
 *
 * Every organ (trunk, rachis, petiole, leaflet, blade, nut, root) is a tube:
 * rings of N profile points swept along a spine. A child organ is never
 * placed *on* its parent and never intersects it. Instead a rectangular
 * window of cells (w columns × h rows) is cut out of the parent's ring grid;
 * the resulting closed edge loop has exactly 2(w+h) vertices, and the child's
 * base ring is built with exactly that many points, so the two loops stitch
 * together with a collar of quads — the same "select faces, extrude a branch"
 * topology a modeller builds by hand.
 *
 * Because every junction is welded this way and every tube is capped, the
 * finished plant is ONE closed 2-manifold surface: a single connected piece
 * with V − E + F = 2 (genus 0), which the topology report verifies.
 */

import { V3, TAU, add, addScaled, cross, dot, frameFromUp, length, lengthSq, lerp, lerpV, mod, normalize, rotateAxis, scale, sub, clamp } from '../core/math';
import { QuadMesh, VertexWind } from './mesh';

export interface ProfilePt {
  x: number;
  y: number;
  /** Tile-local u coordinate of this profile point (0..1 around the organ). */
  u: number;
}

export interface WindSpec {
  pivot: V3;
  phase: number;
  /** Limb-bend weight at t=0 and t=1. */
  limb0: number;
  limb1: number;
  /** Detail-flutter weight at t=0 and t=1. */
  detail0: number;
  detail1: number;
}

export interface TubeSpec {
  /** Spine polyline (world space, base → tip). Resampled by arclength. */
  spine: V3[];
  /** Ring positions as arclength fractions 0..1, ascending, ≥ 2 entries. */
  ringTs: number[];
  /** Vertices per ring. For welded children must equal 2(w+h) of the window. */
  sides: number;
  /** Fill `sides` CCW profile points (metres, local frame) at arclength t. */
  profileAt: (t: number, out: ProfilePt[]) => void;
  /** Vertex colour (sRGB 0..1) at ring t, profile point i. */
  colorAt: (t: number, i: number) => [number, number, number];
  /** Profile +y reference direction at the base. */
  upHint: V3;
  /** Extra roll around the tangent (radians) per t. */
  rollAt?: (t: number) => number;
  tile: number;
  /** Texture v repeats per metre of spine. */
  vPerMeter: number;
  vOffset?: number;
  organ: number;
  wind: WindSpec;
  capStart?: boolean;
  capEnd?: boolean;
  /** Apex distance beyond the end ring, in units of the end ring radius. */
  capScale?: number;
}

export interface TubeGrid {
  spec: TubeSpec;
  sides: number;
  /** Vertex indices per ring. */
  rings: number[][];
  ringT: number[];
  centers: V3[];
  tangents: V3[];
  Us: V3[];
  Vs: V3[];
  /** Average profile radius per ring. */
  radii: number[];
  /** Per-ring texture v (continuous, tile-local). */
  ringV: number[];
  /** Per-ring profile-point u values. */
  ringUs: number[][];
  /** Angle (radians, unwrapped ascending) of each profile point at mid-length. */
  pointAngles: number[];
  /** Cells removed by windows: key = ring * sides + col. */
  windowCells: Set<number>;
  /** Window cells plus their safety margin — nothing new may claim these. */
  blocked: Set<number>;
  length: number;
}

export interface Window {
  ring0: number;
  col0: number;
  w: number;
  h: number;
}

export interface BuilderStats {
  tubes: number;
  tubesByOrgan: number[];
  junctions: number;
  dropped: number;
  dropReasons: Record<string, number>;
}

/** Precomputed spiral-search offsets for window claiming (ring-first order). */
const SEARCH_OFFSETS = new Map<number, [number, number][]>();
function searchOffsets(search: number): [number, number][] {
  let offs = SEARCH_OFFSETS.get(search);
  if (!offs) {
    offs = [];
    for (let dr = -search; dr <= search; dr++) for (let dc = -search - 2; dc <= search + 2; dc++) offs.push([dr, dc]);
    offs.sort((a, b) => a[0] * a[0] * 4 + a[1] * a[1] - (b[0] * b[0] * 4 + b[1] * b[1]));
    SEARCH_OFFSETS.set(search, offs);
  }
  return offs;
}

export class PlantBuilder {
  readonly mesh = new QuadMesh();
  private grids: TubeGrid[] = [];
  readonly stats: BuilderStats = { tubes: 0, tubesByOrgan: [0, 0, 0, 0, 0], junctions: 0, dropped: 0, dropReasons: {} };

  drop(reason: string): null {
    this.stats.dropped++;
    this.stats.dropReasons[reason] = (this.stats.dropReasons[reason] ?? 0) + 1;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Tube construction (vertices only; faces are emitted at finalize so windows
  // claimed later can remove parent cells)
  // ---------------------------------------------------------------------------

  tube(spec: TubeSpec): TubeGrid {
    const mesh = this.mesh;
    const pts = spec.spine;
    // Arclength table of the spine polyline.
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + length(sub(pts[i], pts[i - 1])));
    const total = Math.max(1e-6, cum[cum.length - 1]);

    const sampleAt = (t: number): { pos: V3; tan: V3 } => {
      const d = clamp(t, 0, 1) * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const segLen = Math.max(1e-9, cum[i] - cum[i - 1]);
      const s = (d - cum[i - 1]) / segLen;
      const pos = lerpV(pts[i - 1], pts[i], s);
      // Smoothed tangent: average of neighbouring segment directions.
      const d0 = normalize(sub(pts[Math.min(i, pts.length - 1)], pts[i - 1]));
      const dPrev = i >= 2 ? normalize(sub(pts[i - 1], pts[i - 2])) : d0;
      const dNext = i + 1 < pts.length ? normalize(sub(pts[i + 1], pts[i])) : d0;
      const tan = normalize(add(addScaled(dPrev, d0, 2), dNext));
      return { pos, tan };
    };

    const ringTs = spec.ringTs;
    const sides = spec.sides;
    const grid: TubeGrid = {
      spec,
      sides,
      rings: [],
      ringT: [...ringTs],
      centers: [],
      tangents: [],
      Us: [],
      Vs: [],
      radii: [],
      ringV: [],
      ringUs: [],
      pointAngles: [],
      windowCells: new Set(),
      blocked: new Set(),
      length: total,
    };

    const profile: ProfilePt[] = Array.from({ length: sides }, () => ({ x: 0, y: 0, u: 0 }));
    let U: V3 | null = null;
    let V: V3 | null = null;
    let Tprev: V3 | null = null;

    for (let ri = 0; ri < ringTs.length; ri++) {
      const t = ringTs[ri];
      const { pos, tan } = sampleAt(t);
      if (!U || !V || !Tprev) {
        const f = frameFromUp(tan, spec.upHint);
        U = f.U;
        V = f.V;
      } else {
        // Parallel transport: rotate the previous frame onto the new tangent.
        const axis = cross(Tprev, tan);
        const al = length(axis);
        if (al > 1e-7) {
          const ang = Math.asin(clamp(al, -1, 1));
          const ax = scale(axis, 1 / al);
          U = rotateAxis(U, ax, ang);
          V = rotateAxis(V, ax, ang);
        } else if (dot(Tprev, tan) < 0) {
          const f = frameFromUp(tan, V);
          U = f.U;
          V = f.V;
        }
        // Re-orthogonalise against drift.
        V = normalize(sub(V, scale(tan, dot(V, tan))));
        U = cross(V, tan);
      }
      Tprev = tan;

      // Optional roll (twist) around the tangent.
      let Ur = U;
      let Vr = V;
      const roll = spec.rollAt ? spec.rollAt(t) : 0;
      if (roll !== 0) {
        const c = Math.cos(roll);
        const s = Math.sin(roll);
        Ur = addScaled(scale(U, c), V, s);
        Vr = addScaled(scale(V, c), U, -s);
      }

      spec.profileAt(t, profile);
      const ring: number[] = new Array(sides);
      const us: number[] = new Array(sides);
      let radiusSum = 0;
      const wnd: VertexWind = {
        height: 0,
        limb: lerp(spec.wind.limb0, spec.wind.limb1, t),
        phase: spec.wind.phase,
        detail: lerp(spec.wind.detail0, spec.wind.detail1, t),
      };
      for (let j = 0; j < sides; j++) {
        const p = profile[j];
        radiusSum += Math.sqrt(p.x * p.x + p.y * p.y);
        const wx = pos.x + p.x * Ur.x + p.y * Vr.x;
        const wy = pos.y + p.x * Ur.y + p.y * Vr.y;
        const wz = pos.z + p.x * Ur.z + p.y * Vr.z;
        ring[j] = mesh.addVertex(wx, wy, wz, spec.colorAt(t, j), wnd, spec.wind.pivot, spec.organ);
        us[j] = p.u;
      }
      if (ri === Math.floor(ringTs.length / 2)) {
        // Profile point angles (for direction → column lookup), unwrapped.
        const angs: number[] = [];
        let prev = -Infinity;
        for (let j = 0; j < sides; j++) {
          let a = Math.atan2(profile[j].y, profile[j].x);
          while (a < prev - 1e-6) a += TAU;
          if (j === 0) {
            // Start from the raw angle of point 0.
          }
          prev = a;
          angs.push(a);
        }
        grid.pointAngles = angs;
      }
      grid.rings.push(ring);
      grid.centers.push(pos);
      grid.tangents.push(tan);
      grid.Us.push(Ur);
      grid.Vs.push(Vr);
      grid.radii.push(radiusSum / sides);
      grid.ringV.push((spec.vOffset ?? 0) + t * total * spec.vPerMeter);
      grid.ringUs.push(us);
    }

    this.grids.push(grid);
    this.stats.tubes++;
    this.stats.tubesByOrgan[spec.organ] = (this.stats.tubesByOrgan[spec.organ] ?? 0) + 1;
    return grid;
  }

  // ---------------------------------------------------------------------------
  // Windows
  // ---------------------------------------------------------------------------

  /** Fractional ring index for arclength t. */
  ringAt(grid: TubeGrid, t: number): number {
    const ts = grid.ringT;
    if (t <= ts[0]) return 0;
    if (t >= ts[ts.length - 1]) return ts.length - 1;
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = Math.max(1e-9, ts[hi] - ts[lo]);
    return lo + (t - ts[lo]) / span;
  }

  /** Frame at arclength t (interpolated between rings). */
  frameAt(grid: TubeGrid, t: number): { center: V3; T: V3; U: V3; V: V3; radius: number } {
    const rf = this.ringAt(grid, t);
    const i0 = Math.floor(rf);
    const i1 = Math.min(grid.rings.length - 1, i0 + 1);
    const s = rf - i0;
    const nlerp = (a: V3, b: V3): V3 => normalize(lerpV(a, b, s));
    const T = nlerp(grid.tangents[i0], grid.tangents[i1]);
    let V = nlerp(grid.Vs[i0], grid.Vs[i1]);
    V = normalize(sub(V, scale(T, dot(V, T))));
    const U = cross(V, T);
    return {
      center: lerpV(grid.centers[i0], grid.centers[i1], s),
      T,
      U,
      V,
      radius: lerp(grid.radii[i0], grid.radii[i1], s),
    };
  }

  /** Fractional column index for a world direction out of the ring at t. */
  colForDirection(grid: TubeGrid, t: number, dir: V3): number {
    const f = this.frameAt(grid, t);
    const dx = dot(dir, f.U);
    const dy = dot(dir, f.V);
    let ang = Math.atan2(dy, dx);
    const angs = grid.pointAngles;
    // Bring ang into the unwrapped range of pointAngles.
    const a0 = angs[0] ?? 0;
    while (ang < a0) ang += TAU;
    while (ang >= a0 + TAU) ang -= TAU;
    // Find segment of pointAngles containing ang (wrapping to angs[0]+TAU).
    for (let j = 0; j < angs.length; j++) {
      const lo = angs[j];
      const hi = j + 1 < angs.length ? angs[j + 1] : a0 + TAU;
      if (ang >= lo && ang <= hi) {
        const s = hi - lo > 1e-9 ? (ang - lo) / (hi - lo) : 0;
        return j + s;
      }
    }
    return 0;
  }

  /**
   * Claim a w×h window of cells centred near (ringF, colF). Searches outward
   * for free space; returns null when the neighbourhood is full.
   */
  claimWindow(grid: TubeGrid, ringF: number, colF: number, w: number, h: number, margin = 1, search = 5): Window | null {
    const sides = grid.sides;
    const maxRing0 = grid.rings.length - 1 - h;
    if (maxRing0 < 0) return null;
    const baseRing0 = Math.round(ringF - h / 2);
    const baseCol0 = Math.round(colF - w / 2);
    const offsets = searchOffsets(search);

    for (const [dr, dc] of offsets) {
      const ring0 = clamp(baseRing0 + dr, 0, maxRing0);
      if (dr !== 0 && ring0 - baseRing0 !== dr && !(dr < 0 && ring0 === 0) && !(dr > 0 && ring0 === maxRing0)) continue;
      const col0 = mod(baseCol0 + dc, sides);
      let ok = true;
      for (let r = ring0; r < ring0 + h && ok; r++) {
        for (let c = 0; c < w; c++) {
          if (grid.blocked.has(r * sides + mod(col0 + c, sides))) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      // Claim: mark the cells + safety margin as blocked.
      for (let r = ring0; r < ring0 + h; r++) for (let c = 0; c < w; c++) grid.windowCells.add(r * sides + mod(col0 + c, sides));
      for (let r = Math.max(0, ring0 - margin); r < Math.min(grid.rings.length - 1, ring0 + h + margin); r++) {
        for (let c = -margin; c < w + margin; c++) grid.blocked.add(r * sides + mod(col0 + c, sides));
      }
      return { ring0, col0, w, h };
    }
    return null;
  }

  /** Ordered boundary loop of a window (CCW seen from outside the parent). */
  private windowLoop(grid: TubeGrid, win: Window): number[] {
    const { ring0, col0, w, h } = win;
    const sides = grid.sides;
    const at = (r: number, c: number): number => grid.rings[r][mod(c, sides)];
    const loop: number[] = [];
    for (let c = 0; c < w; c++) loop.push(at(ring0, col0 + c));
    for (let r = 0; r < h; r++) loop.push(at(ring0 + r, col0 + w));
    for (let c = 0; c < w; c++) loop.push(at(ring0 + h, col0 + w - c));
    for (let r = 0; r < h; r++) loop.push(at(ring0 + h - r, col0));
    return loop;
  }

  /**
   * Weld a child tube into a claimed window. The child's spine[0] is snapped
   * to (window centre + child axis · collar distance); the collar of quads
   * bridges the window loop to the child's first ring.
   */
  weldChild(parent: TubeGrid, win: Window, spec: TubeSpec, collarRings = 1, collarScale = 0.85): TubeGrid {
    const mesh = this.mesh;
    const loop = this.windowLoop(parent, win);
    const N = loop.length;
    if (spec.sides !== N) throw new Error(`weldChild: child sides ${spec.sides} ≠ window loop ${N} (2(w+h)=${2 * (win.w + win.h)})`);

    // Window centre and child axis.
    let C = { x: 0, y: 0, z: 0 };
    for (const v of loop) C = add(C, mesh.pos(v));
    C = scale(C, 1 / N);
    const A = normalize(sub(spec.spine[Math.min(1, spec.spine.length - 1)], spec.spine[0]));

    // Child base radius (for collar distance).
    const probe: ProfilePt[] = Array.from({ length: spec.sides }, () => ({ x: 0, y: 0, u: 0 }));
    spec.profileAt(0, probe);
    let rChild = 0;
    for (const p of probe) rChild += Math.sqrt(p.x * p.x + p.y * p.y);
    rChild = Math.max(1e-4, rChild / spec.sides);
    const collarDist = collarScale * rChild;

    // Translate the child spine so its base sits one collar outside the window.
    const target = addScaled(C, A, collarDist);
    const delta = sub(target, spec.spine[0]);
    const shifted: TubeSpec = { ...spec, spine: spec.spine.map((p) => add(p, delta)) };
    const child = this.tube(shifted);
    const ring0 = child.rings[0];

    // Best rotational correspondence between loop and child ring.
    const loopPos = loop.map((v) => mesh.pos(v));
    const ringPos = ring0.map((v) => mesh.pos(v));
    let bestK = 0;
    let bestCost = Infinity;
    for (let k = 0; k < N; k++) {
      let cost = 0;
      for (let i = 0; i < N; i++) cost += lengthSq(sub(loopPos[i], ringPos[(i + k) % N]));
      if (cost < bestCost) {
        bestCost = cost;
        bestK = k;
      }
    }
    const cAt = (i: number): number => ring0[(i + bestK) % N];

    // Build the loop sequence: window loop → collar rings → child ring 0.
    const loops: number[][] = [loop];
    const childV0 = child.ringV[0];
    const vOf = (vi: number): [number, number, number] => [mesh.colors[vi * 3], mesh.colors[vi * 3 + 1], mesh.colors[vi * 3 + 2]];
    for (let r = 1; r <= collarRings; r++) {
      const s = r / (collarRings + 1);
      const mid: number[] = new Array(N);
      const axisPt = addScaled(C, A, collarDist * s);
      for (let i = 0; i < N; i++) {
        const cp = ringPos[(i + bestK) % N];
        let p = lerpV(loopPos[i], cp, s);
        // Slight outward bulge so the collar reads as a fillet, not a cone.
        const radial = sub(p, axisPt);
        const rl = length(radial);
        if (rl > 1e-6) p = addScaled(p, radial, (Math.sin(s * Math.PI) * rChild * 0.12) / rl);
        const cA = vOf(loop[i]);
        const cB = vOf(cAt(i));
        const col: [number, number, number] = [lerp(cA[0], cB[0], s), lerp(cA[1], cB[1], s), lerp(cA[2], cB[2], s)];
        mid[i] = mesh.addVertex(
          p.x, p.y, p.z, col,
          { height: 0, limb: spec.wind.limb0, phase: spec.wind.phase, detail: spec.wind.detail0 },
          spec.wind.pivot, spec.organ, 1,
        );
      }
      loops.push(mid);
    }
    loops.push(ring0.map((_, i) => cAt(i)));

    // Bridge quads between consecutive loops.
    const steps = loops.length - 1;
    for (let li = 0; li < steps; li++) {
      const A0 = loops[li];
      const B0 = loops[li + 1];
      const vA = childV0 - collarDist * spec.vPerMeter * (1 - li / steps);
      const vB = childV0 - collarDist * spec.vPerMeter * (1 - (li + 1) / steps);
      for (let i = 0; i < N; i++) {
        const i2 = (i + 1) % N;
        const uA = child.ringUs[0][(i + bestK) % N];
        const uB = child.ringUs[0][(i2 + bestK) % N];
        mesh.addQuad(A0[i], A0[i2], B0[i2], B0[i], [uA, vA, uB, vA, uB, vB, uA, vB], spec.tile);
      }
    }

    // Mark weld loops for the Junctions view.
    for (const v of loop) mesh.junction[v] = 1;
    for (const v of ring0) mesh.junction[v] = 1;

    this.stats.junctions++;
    return child;
  }

  /**
   * Convenience: claim a window around (t, direction) on the parent and weld
   * the child into it. Returns null (and counts a drop) when no window fits.
   */
  weld(
    parent: TubeGrid,
    t: number,
    dir: V3,
    w: number,
    h: number,
    spec: TubeSpec,
    opts: { margin?: number; collarRings?: number; collarScale?: number; search?: number } = {},
  ): TubeGrid | null {
    const ringF = this.ringAt(parent, t);
    const colF = this.colForDirection(parent, t, dir);
    const win = this.claimWindow(parent, ringF, colF, w, h, opts.margin ?? 1, opts.search ?? 5);
    if (!win) return this.drop('no window');
    return this.weldChild(parent, win, spec, opts.collarRings ?? 1, opts.collarScale ?? 0.85);
  }

  // ---------------------------------------------------------------------------
  // Face emission + finalize
  // ---------------------------------------------------------------------------

  private emitFaces(grid: TubeGrid): void {
    const mesh = this.mesh;
    const sides = grid.sides;
    const rings = grid.rings;
    const spec = grid.spec;
    for (let i = 0; i < rings.length - 1; i++) {
      const rA = rings[i];
      const rB = rings[i + 1];
      const uA = grid.ringUs[i];
      const uB = grid.ringUs[i + 1];
      const vA = grid.ringV[i];
      const vB = grid.ringV[i + 1];
      for (let j = 0; j < sides; j++) {
        if (grid.windowCells.has(i * sides + j)) continue;
        const j2 = (j + 1) % sides;
        mesh.addQuad(rA[j], rA[j2], rB[j2], rB[j], [uA[j], vA, uA[j2], vA, uB[j2], vB, uB[j], vB], spec.tile);
      }
    }
    const capScale = spec.capScale ?? 0.9;
    if (spec.capStart) {
      const c = grid.centers[0];
      const T = grid.tangents[0];
      const apexPos = addScaled(c, T, -grid.radii[0] * capScale);
      const wnd: VertexWind = { height: 0, limb: spec.wind.limb0, phase: spec.wind.phase, detail: spec.wind.detail0 };
      const apex = mesh.addVertex(apexPos.x, apexPos.y, apexPos.z, spec.colorAt(0, 0), wnd, spec.wind.pivot, spec.organ);
      const ring = rings[0];
      const us = grid.ringUs[0];
      const v = grid.ringV[0];
      for (let j = 0; j < sides; j++) {
        const j2 = (j + 1) % sides;
        mesh.addTri(ring[j2], ring[j], apex, [us[j2], v, us[j], v, 0.5, v - 0.05], spec.tile);
      }
    }
    if (spec.capEnd) {
      const li = rings.length - 1;
      const c = grid.centers[li];
      const T = grid.tangents[li];
      const apexPos = addScaled(c, T, grid.radii[li] * capScale);
      const wnd: VertexWind = { height: 0, limb: spec.wind.limb1, phase: spec.wind.phase, detail: spec.wind.detail1 };
      const apex = mesh.addVertex(apexPos.x, apexPos.y, apexPos.z, spec.colorAt(1, 0), wnd, spec.wind.pivot, spec.organ);
      const ring = rings[li];
      const us = grid.ringUs[li];
      const v = grid.ringV[li];
      for (let j = 0; j < sides; j++) {
        const j2 = (j + 1) % sides;
        mesh.addTri(ring[j], ring[j2], apex, [us[j], v, us[j2], v, 0.5, v + 0.05], spec.tile);
      }
    }
  }

  /**
   * Remove vertices no face references (window interiors: the ring-grid
   * vertices inside a cut window, off its boundary loop) and remap indices.
   */
  private compact(): void {
    const mesh = this.mesh;
    const used = new Uint8Array(mesh.vertexCount);
    for (let f = 0; f < mesh.quads.length; f++) used[mesh.quads[f]] = 1;
    for (let f = 0; f < mesh.tris.length; f++) used[mesh.tris[f]] = 1;
    const remap = new Int32Array(mesh.vertexCount);
    const positions: number[] = [];
    const colors: number[] = [];
    const wind: number[] = [];
    const pivots: number[] = [];
    const organs: number[] = [];
    const junction: number[] = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (!used[i]) {
        remap[i] = -1;
        continue;
      }
      remap[i] = positions.length / 3;
      positions.push(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
      colors.push(mesh.colors[i * 3], mesh.colors[i * 3 + 1], mesh.colors[i * 3 + 2]);
      wind.push(mesh.wind[i * 4], mesh.wind[i * 4 + 1], mesh.wind[i * 4 + 2], mesh.wind[i * 4 + 3]);
      pivots.push(mesh.pivots[i * 3], mesh.pivots[i * 3 + 1], mesh.pivots[i * 3 + 2]);
      organs.push(mesh.organs[i]);
      junction.push(mesh.junction[i]);
    }
    for (let f = 0; f < mesh.quads.length; f++) mesh.quads[f] = remap[mesh.quads[f]];
    for (let f = 0; f < mesh.tris.length; f++) mesh.tris[f] = remap[mesh.tris[f]];
    mesh.positions = positions;
    mesh.colors = colors;
    mesh.wind = wind;
    mesh.pivots = pivots;
    mesh.organs = organs;
    mesh.junction = junction;
  }

  /** Emit all faces, bake normalised wind height, ensure outward winding. */
  finalize(): { mesh: QuadMesh; height: number; minY: number; stats: BuilderStats } {
    for (const g of this.grids) this.emitFaces(g);
    this.compact();
    const mesh = this.mesh;
    let maxY = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i + 1];
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    const height = Math.max(1e-3, maxY);
    for (let i = 0; i < mesh.vertexCount; i++) {
      mesh.wind[i * 4] = clamp(mesh.positions[i * 3 + 1] / height, 0, 1);
    }
    if (mesh.signedVolume() < 0) mesh.flipAll();
    return { mesh, height: maxY, minY, stats: this.stats };
  }
}

// -----------------------------------------------------------------------------
// Profile helpers (points CCW in the local frame, point 0 at angle 0 = +x)
// -----------------------------------------------------------------------------

/** Regular polygon (circle/ellipse) profile of `sides` points. */
export function circleProfile(sides: number, rx: number, ry: number, out: ProfilePt[]): void {
  for (let j = 0; j < sides; j++) {
    const a = (j / sides) * TAU;
    out[j].x = Math.cos(a) * rx;
    out[j].y = Math.sin(a) * ry;
    out[j].u = j / sides;
  }
}

/** Even ring parameters 0..1. */
export function evenRings(n: number): number[] {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) ts.push(i / (n - 1));
  return ts;
}

/** Ring parameters with extra density where it matters (sorted, deduped). */
export function ringParams(base: number, extra: number[] = []): number[] {
  const ts = new Set<number>(evenRings(base));
  for (const t of extra) ts.add(clamp(t, 0, 1));
  return [...ts].sort((a, b) => a - b);
}

import { QuadMesh, LeafMesh, VertexWind } from '../tree/mesh';
import { Random } from '../core/random';
import { V3, UP, TAU, DEG2RAD, add, addScaled, cross, dot, normalize, lengthSq, projectOnPlane, scale, clamp, sub } from '../core/math';
import { Line, Frame } from './line';
import { DesertParams, desertHeight } from './desertParams';

/**
 * The cactus body is a real surface, not a stack of intersecting primitives.
 * Each arm removes a rectangular patch from the parent ring grid and is
 * bridged to that patch with collar loops.  This is deliberately the same
 * window-and-collar construction used by the tree and grass meshers, so an
 * exported Saguaro remains one closed genus-0 surface.
 */

export interface DesertStats {
  organs: number;
  junctions: number;
  dropped: number;
  dropReasons: Record<string, number>;
  /** core · arms / pads · rosette leaves · surface details */
  perLevel: [number, number, number, number];
  arms: number;
  pads: number;
  rosetteLeaves: number;
  spines: number;
  flowers: number;
  details: number;
}

export interface DesertBuildResult {
  mesh: QuadMesh;
  /** Separate instanced-style detail geometry: spines, areoles, flowers and succulent leaves. */
  details: LeafMesh;
  stats: DesertStats;
  height: number;
  groundDepth: number;
}

interface Exit {
  pos: V3;
  normal: V3;
  dir: V3;
  size: number;
  N: number;
}

interface Attachment {
  s: number;
  az: number;
  w: number;
  h: number;
  hh: number;
  make: (exit: Exit) => Organ;
  j0: number;
  row0: number;
  row1: number;
}

interface Organ {
  level: number;
  line: Line;
  N: number;
  sStart: number;
  spacing: number;
  children: Attachment[];
  /** Radius at a station before the angular rib profile is applied. */
  baseRadius: (s: number) => number;
  /** Cross-section profile; x/y are in the line's right/up frame. */
  profile: (s: number, j: number, N: number) => { x: number; y: number };
  wind: (s: number, y: number) => VertexWind;
  pivot: V3;
  phase: number;
  detail: boolean;
  /** Body, round cactus arm, or flattened pad. */
  kind: 'round' | 'pad';
}

interface Ring {
  idx: number[];
  s: number;
  f: Frame;
}

interface DetailSource {
  organ: Organ;
  phase: number;
}

const GOLDEN = 2.399963229728653;
const OFFSETS: [number, number][] = [
  [0, 0],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 1],
  [-2, 1],
  [2, -1],
  [-2, -1],
];

export class DesertMesher {
  readonly mesh = new QuadMesh();
  readonly details = new LeafMesh();
  private readonly d: DesertParams;
  private readonly rng: Random;
  private readonly armRng: Random;
  private readonly detailRng: Random;
  private readonly sources: DetailSource[] = [];
  private stats: DesertStats = {
    organs: 0,
    junctions: 0,
    dropped: 0,
    dropReasons: {},
    perLevel: [0, 0, 0, 0],
    arms: 0,
    pads: 0,
    rosetteLeaves: 0,
    spines: 0,
    flowers: 0,
    details: 0,
  };
  private plantH = 1;
  private groundDepth = 0.08;

  constructor(d: DesertParams, seed: number) {
    this.d = d;
    this.rng = new Random((seed ^ 0x9e3779b9) >>> 0);
    this.armRng = this.rng.fork();
    this.detailRng = this.rng.fork();
  }

  build(): DesertBuildResult {
    const d = this.d;
    this.plantH = Math.max(0.05, desertHeight(d));
    if (d.form === 'agave' || d.form === 'aloe') this.buildRosettePlant();
    else if (d.form === 'prickly-pear') this.buildPricklyPear();
    else this.buildCactus();

    this.buildSurfaceDetails();
    this.normaliseWind();
    return {
      mesh: this.mesh,
      details: this.details,
      stats: this.stats,
      height: this.visibleHeight(),
      groundDepth: this.groundDepth,
    };
  }

  // -------------------------------------------------------------------------
  // Species forms
  // -------------------------------------------------------------------------

  private buildCactus(): void {
    const d = this.d;
    const randomHeight = d.height * (1 + d.heightV * this.rng.uniform());
    const isOcotillo = d.form === 'ocotillo';
    const coreHeight = isOcotillo ? Math.max(0.48, d.radius * 2.6) : randomHeight;
    const startY = -Math.max(0.04, d.radius * 0.3);
    const coreLine = verticalLine({ x: 0, y: startY, z: 0 }, coreHeight + -startY, d.lean * DEG2RAD, d.curve * DEG2RAD, Math.max(8, d.bodyRings));
    const coreR = Math.max(0.025, d.radius * (1 + d.radiusV * 0.15 * this.rng.uniform()));
    const core = this.makeRoundOrgan(coreLine, coreR, d.bodyRings, 0, d.form === 'barrel' ? 'round' : 'round', true, 0);
    const attachments: Attachment[] = [];

    if (!isOcotillo && d.form !== 'barrel') {
      const count = Math.max(0, Math.round(d.arms));
      for (let i = 0; i < count; i++) {
        const az = d.form === 'organ-pipe' ? (i * TAU) / Math.max(1, count) : (i * TAU) / Math.max(1, count) + this.armRng.uniform() * d.armSpread * 0.7 - d.armSpread * 0.35;
        const t = d.form === 'organ-pipe' ? 0.04 + 0.18 * this.armRng.uniform() : d.armHeight + d.armHeightV * this.armRng.uniform();
        const s = Math.max(0.1, (coreLine.length - startY) * clamp(t, 0.02, 0.88));
        const len = Math.max(0.18, d.armLength * (1 + d.armLengthV * this.armRng.uniform()));
        const rr = Math.max(0.018, d.armRadius * (1 + d.armRadiusV * this.armRng.uniform()));
        const vals = { az, length: len, radius: rr, phase: this.armRng.next(), index: i };
        const w = d.form === 'organ-pipe' ? 1 : 3;
        const h = d.form === 'organ-pipe' ? 3 : 3;
        attachments.push({
          s,
          az,
          w,
          h,
          hh: Math.max(rr * 1.15, coreR * 0.25),
          j0: 0,
          row0: 0,
          row1: 0,
          make: (exit) => this.makeArm(exit, vals, 1),
        });
      }
    } else if (isOcotillo) {
      const count = Math.max(1, Math.round(d.arms));
      for (let i = 0; i < count; i++) {
        const az = (i * TAU) / count + this.armRng.uniform() * 0.12;
        const vals = {
          az,
          length: d.armLength * (1 + d.armLengthV * this.armRng.uniform()),
          radius: Math.max(0.012, d.armRadius * (1 + d.armRadiusV * this.armRng.uniform())),
          phase: this.armRng.next(),
          index: i,
        };
        attachments.push({
          s: Math.max(0.04, coreLine.length * (0.12 + 0.76 * ((i + 0.5) / count))),
          az,
          w: 1,
          h: 1,
          hh: Math.max(vals.radius * 0.9, coreR * 0.08),
          j0: 0,
          row0: 0,
          row1: 0,
          make: (exit) => this.makeArm(exit, vals, 1),
        });
      }
    }

    // Secondary Saguaro arms attach to the upper half of a primary arm.  They
    // are planned by the arm's own window grid, so they are welded too.
    for (const a of attachments) {
      const original = a.make;
      if (d.secondaryArms > 0 && d.form === 'saguaro') {
        a.make = (exit) => {
          const arm = original(exit);
          const secondaryCount = Math.min(2, Math.max(0, Math.round(d.secondaryArms)));
          for (let k = 0; k < secondaryCount; k++) {
            const az2 = (k === 0 ? 1 : -1) * (0.35 + 0.15 * this.armRng.uniform());
            const rr = Math.max(0.025, d.armRadius * 0.78);
            const vals = {
              az: az2,
              length: d.armLength * (0.56 + 0.12 * this.armRng.uniform()),
              radius: rr,
              phase: this.armRng.next(),
              index: k,
            };
            arm.children.push({
              s: arm.line.length * (0.56 + 0.08 * k),
              az: az2,
              w: 1,
              h: 3,
              hh: Math.max(rr * 1.2, rr * 0.85),
              j0: 0,
              row0: 0,
              row1: 0,
              make: (ex) => this.makeArm(ex, vals, 2),
            });
          }
          return arm;
        };
      }
    }
    core.children = attachments;
    this.meshTube(core, null, 0);
  }

  private buildPricklyPear(): void {
    const d = this.d;
    const startY = -Math.max(0.04, d.radius * 0.25);
    const coreLine = verticalLine({ x: 0, y: startY, z: 0 }, Math.max(0.36, d.height * 0.38) - startY, 0, 0, Math.max(8, d.bodyRings));
    const core = this.makeRoundOrgan(coreLine, Math.max(0.06, d.radius), d.bodyRings, 0, 'round', false, 0);
    // Seven pads need enough angular room around the short basal cladode.
    // Keep the body ring denser than the species default so every pad gets a
    // clean, non-overlapping collar instead of silently disappearing.
    core.N = Math.max(core.N, 32);
    const pads = Math.max(1, Math.round(d.padCount));
    const makePadAttachment = (i: number, parentHeight: number): Attachment => {
      const az = (i * GOLDEN) % TAU;
      const rr = Math.max(0.06, d.padThickness * (1 + d.armRadiusV * 0.2 * this.armRng.uniform()));
      const vals = {
        az,
        length: d.padWidth * (0.9 + 0.2 * this.armRng.uniform()),
        radius: rr,
        phase: this.armRng.next(),
        index: i,
      };
      return {
        s: parentHeight * (0.34 + 0.55 * this.armRng.uniform()),
        az,
        w: 1,
        h: 2,
        hh: Math.max(rr * 1.1, 0.035),
        j0: 0,
        row0: 0,
        row1: 0,
        make: (ex) => this.makePad(ex, vals, 0),
      };
    };
    for (let i = 0; i < pads; i++) core.children.push(makePadAttachment(i, core.line.length));
    this.meshTube(core, null, 0);
  }

  private buildRosettePlant(): void {
    const d = this.d;
    const startY = -Math.max(0.04, d.radius * 0.2);
    const bodyH = Math.max(0.18, d.height * 0.42);
    const line = verticalLine({ x: 0, y: startY, z: 0 }, bodyH - startY, 0, 0, Math.max(8, d.bodyRings));
    const core = this.makeRoundOrgan(line, Math.max(0.08, d.radius), d.bodyRings, 0, 'round', false, 0);
    this.meshTube(core, null, 0);
    this.addRosetteLeaves(line, bodyH, d.form === 'agave');
    if (d.form === 'aloe' && d.flower) this.addFlower(line.at(line.length).pos, d.flowerScale * 1.2, true);
  }

  // -------------------------------------------------------------------------
  // Organ construction
  // -------------------------------------------------------------------------

  private makeRoundOrgan(line: Line, radius: number, rings: number, level: number, kind: 'round' | 'pad', detail: boolean, phase: number, taperOverride?: number): Organ {
    const d = this.d;
    const L = Math.max(0.03, line.length);
    const taper = kind === 'pad' ? 0.2 : clamp(taperOverride ?? d.taper, 0, 0.85);
    const baseRadius = (s: number): number => {
      const t = clamp(s / L, 0, 1);
      // Leave a small terminal disc for a clean quad cap while rounding the
      // silhouette into a shoulder rather than ending in a saw-cut cylinder.
      const shoulder = t > 0.78 ? 1 - d.shoulder * Math.pow((t - 0.78) / 0.22, 1.35) : 1;
      return Math.max(0.004, radius * (1 - taper * t) * shoulder);
    };
    const profile = (s: number, j: number, N: number): { x: number; y: number } => {
      const a = (TAU * j) / N;
      const rr = baseRadius(s);
      if (kind === 'pad') {
        const topBottom = Math.max(0.015, rr * (d.padThickness / Math.max(0.03, d.padWidth)));
        return { x: rr * Math.cos(a), y: topBottom * Math.sin(a) };
      }
      const ribPhase = 0.5 + 0.5 * Math.cos(d.ribs * a);
      const rib = d.ribs > 0 ? 1 + d.ribDepth * Math.pow(ribPhase, Math.max(0.5, d.ribSharpness)) : 1;
      return { x: rr * rib * Math.cos(a), y: rr * rib * Math.sin(a) };
    };
    const pivot = line.pts[0] ?? { x: 0, y: 0, z: 0 };
    const wind = (s: number, y: number): VertexWind => ({
      height: clamp((y + 0.05) / this.plantH, 0, 1),
      limb: level === 0 ? 0 : clamp(s / L, 0, 1),
      phase,
      detail: level >= 1 ? clamp(0.2 + 0.8 * (s / L), 0, 1) : 0,
    });
    const organ: Organ = {
      level,
      line,
      N: 0,
      sStart: level === 0 ? 0 : Math.min(0.18 * L, Math.max(0.025, radius * 1.6)),
      spacing: Math.max(0.004, L / Math.max(4, Math.round(rings))),
      children: [],
      baseRadius,
      profile,
      wind,
      pivot,
      phase,
      detail,
      kind,
    };
    // N is filled by meshTube from the root/parent window.  For a root use
    // the requested high-resolution radial ring.
    organ.N = level === 0 ? Math.max(8, Math.round(d.radialSegments / 2) * 2) : 8;
    return organ;
  }

  private makeArm(exit: Exit, v: { az: number; length: number; radius: number; phase: number; index: number }, level: number): Organ {
    const d = this.d;
    const outward = normalize(projectOnPlane(exit.normal, UP));
    const rise = d.form === 'organ-pipe' ? d.height * (0.58 + 0.12 * this.armRng.uniform()) : d.form === 'ocotillo' ? d.height * (0.82 + 0.18 * this.armRng.uniform()) : v.length * (0.62 + 0.18 * this.armRng.uniform());
    const horizontal = d.form === 'organ-pipe' ? v.length * 0.22 : d.form === 'ocotillo' ? v.length * 0.13 : v.length * 0.62;
    const line = elbowLine(exit.pos, outward, horizontal, rise, d.armLean * DEG2RAD, d.armCurve * DEG2RAD, Math.max(8, d.armRings));
    const organ = this.makeRoundOrgan(line, v.radius, d.armRings, level, 'round', true, v.phase, d.armTaper);
    return organ;
  }

  private makePad(exit: Exit, v: { az: number; length: number; radius: number; phase: number; index: number }, level: number): Organ {
    const outward = normalize(projectOnPlane(exit.normal, UP));
    const line = padLine(exit.pos, outward, v.length, this.d.padTilt * DEG2RAD, Math.max(6, this.d.armRings));
    const organ = this.makeRoundOrgan(line, Math.max(0.045, this.d.padHeight * 0.5), this.d.armRings, level + 1, 'pad', true, v.phase);
    // Pad colonies branch through a second generation of daughter pads.  They
    // are planned on this pad's own ring lattice and therefore do not float.
    if (level < 1 && this.d.secondaryArms > 0) {
      const n = Math.min(2, Math.round(this.d.secondaryArms));
      for (let i = 0; i < n; i++) {
        const az = (i === 0 ? 1 : -1) * (0.65 + 0.18 * this.armRng.uniform());
        const vals = { az, length: this.d.padWidth * 0.78, radius: this.d.padThickness, phase: this.armRng.next(), index: i };
        organ.children.push({
          s: organ.line.length * (0.55 + i * 0.08),
          az,
          w: 1,
          h: 2,
          hh: Math.max(0.035, this.d.padThickness * 0.72),
          j0: 0,
          row0: 0,
          row1: 0,
          make: (ex) => this.makePad(ex, vals, level + 1),
        });
      }
    }
    return organ;
  }

  // -------------------------------------------------------------------------
  // Welded tube mesher
  // -------------------------------------------------------------------------

  private meshTube(o: Organ, parentLoop: number[] | null, depth: number): void {
    const mesh = this.mesh;
    const N = parentLoop ? parentLoop.length : Math.max(8, o.N);
    o.N = N;
    const L = o.line.length;
    if (L < 0.02) {
      this.drop('organ too short');
      return;
    }
    const children = o.children.slice();
    const stations = this.planAttachments(o, children, N, L);
    const occupied = new Uint8Array(Math.max(1, stations.values.length - 1) * N);
    const accepted: Attachment[] = [];
    for (const a of stations.attachments) {
      const row0 = nearestIndex(stations.values, a.s - a.hh);
      let row1 = nearestIndex(stations.values, a.s + a.hh);
      if (row1 - row0 < a.h) row1 = row0 + a.h;
      if (row1 > stations.values.length - 1) row1 = stations.values.length - 1;
      if (row0 < 1 || row1 <= row0) {
        this.drop('no room on parent');
        continue;
      }
      let free = true;
      for (let i = row0; i < row1 && free; i++) for (let j = 0; j < a.w; j++) if (occupied[i * N + mod(a.j0 + j, N)]) free = false;
      if (!free) {
        this.drop('window conflict');
        continue;
      }
      for (let i = row0; i < row1; i++) for (let j = 0; j < a.w; j++) occupied[i * N + mod(a.j0 + j, N)] = 1;
      a.row0 = row0;
      a.row1 = row1;
      accepted.push(a);
    }

    const cellOcc = (i: number, j: number): boolean => i >= 0 && i < stations.values.length - 1 && occupied[i * N + mod(j, N)] === 1;
    const interior = (i: number, j: number): boolean => cellOcc(i - 1, j - 1) && cellOcc(i - 1, j) && cellOcc(i, j - 1) && cellOcc(i, j);
    const rings: Ring[] = [];
    for (let i = 0; i < stations.values.length; i++) rings.push(this.buildRing(o, stations.values[i], i === 0 && parentLoop !== null ? this.mitre(parentLoop, o, stations.values[i]) : undefined, (j) => interior(i, j)));

    if (!parentLoop) this.cap(rings[0].idx, true);
    else {
      this.collar(parentLoop, rings[0], o);
      this.stats.junctions++;
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i].idx;
      const b = rings[i + 1].idx;
      for (let j = 0; j < N; j++) {
        if (occupied[i * N + j]) continue;
        const j1 = (j + 1) % N;
        mesh.addQuad(a[j], a[j1], b[j1], b[j], [j / N, stations.values[i] / L, (j + 1) / N, stations.values[i] / L, (j + 1) / N, stations.values[i + 1] / L, j / N, stations.values[i + 1] / L]);
      }
    }
    this.cap(rings[rings.length - 1].idx, false);

    this.stats.organs++;
    this.stats.perLevel[Math.min(3, o.level)]++;
    if (o.kind === 'pad') this.stats.pads++;
    else if (o.level > 0) this.stats.arms++;
    if (o.detail) this.sources.push({ organ: o, phase: o.phase });

    for (const a of accepted) {
      const loop = this.holeLoop(rings, a, N);
      const f = o.line.at(a.s);
      const radial = normalize(add(scale(f.right, Math.cos(a.az)), scale(f.up, Math.sin(a.az))));
      const pos = addScaled(f.pos, radial, this.surfaceRadius(o, a.s, a.az));
      const exit: Exit = { pos, normal: radial, dir: f.dir, size: Math.max(2 * a.hh, a.w * (TAU * o.baseRadius(a.s)) / N), N: loop.length };
      const child = a.make(exit);
      this.meshTube(child, loop, depth + 1);
    }
  }

  private planAttachments(o: Organ, children: Attachment[], N: number, L: number): { values: number[]; attachments: Attachment[] } {
    const colStep = TAU / N;
    const accepted: Attachment[] = [];
    const sMin = o.sStart + Math.max(0.01, o.baseRadius(0) * 0.18);
    const candidates = children.slice().sort((a, b) => a.s - b.s);
    for (const a of candidates) {
      a.w = Math.max(1, Math.min(Math.floor(N / 2) - 1, Math.round(a.w)));
      a.h = Math.max(1, Math.round(a.h));
      const desired = a.az / colStep;
      const jBase = Math.round(desired - a.w * 0.5);
      let placed: { s: number; j: number } | null = null;
      for (const [ds, dj] of candidateOffsets()) {
        const s = a.s + ds * a.hh * 1.2;
        const j = mod(jBase + dj, N);
        if (s - a.hh < sMin || s + a.hh > L - Math.max(0.01, a.hh * 0.25)) continue;
        let conflict = false;
        for (const p of accepted) {
          const axial = s - a.hh < p.s + p.hh * 0.85 && p.s - p.hh * 0.85 < s + a.hh;
          if (axial && circularOverlap(j - 1, a.w + 2, p.j0, p.w, N)) {
            conflict = true;
            break;
          }
        }
        if (!conflict) {
          placed = { s, j };
          break;
        }
      }
      if (!placed) {
        this.drop('window conflict');
        continue;
      }
      a.s = placed.s;
      a.j0 = placed.j;
      accepted.push(a);
    }

    const mand: { s: number; pri: number }[] = [
      { s: o.sStart, pri: 3 },
      { s: L, pri: 3 },
    ];
    let minSpan = Infinity;
    for (const a of accepted) {
      mand.push({ s: a.s - a.hh, pri: 2 }, { s: a.s + a.hh, pri: 2 });
      for (let k = 1; k < a.h; k++) mand.push({ s: a.s - a.hh + (2 * a.hh * k) / a.h, pri: 2 });
      minSpan = Math.min(minSpan, (2 * a.hh) / a.h);
    }
    const inside = (s: number): boolean => accepted.some((a) => s > a.s - a.hh + 1e-7 && s < a.s + a.hh - 1e-7);
    mand.sort((a, b) => a.s - b.s || b.pri - a.pri);
    const kept: { s: number; pri: number }[] = [];
    const spacing = o.spacing;
    const eps = Math.min(spacing * 0.28, isFinite(minSpan) ? minSpan * 0.28 : Infinity);
    for (const a of mand) {
      const prev = kept[kept.length - 1];
      if (prev && a.s - prev.s < eps) {
        if (a.pri > prev.pri) kept[kept.length - 1] = a;
      } else kept.push(a);
    }
    kept[kept.length - 1] = { s: L, pri: 3 };
    const values: number[] = [];
    for (let i = 0; i < kept.length; i++) {
      values.push(kept[i].s);
      if (i === kept.length - 1) continue;
      const gap = kept[i + 1].s - kept[i].s;
      if (inside(kept[i].s + gap * 0.5)) continue;
      const n = Math.floor(gap / spacing);
      for (let k = 1; k <= n; k++) values.push(kept[i].s + (gap * k) / (n + 1));
    }
    return { values, attachments: accepted };
  }

  private buildRing(o: Organ, s: number, tilt: V3 | undefined, skip: (j: number) => boolean): Ring {
    const f = o.line.at(s);
    const idx: number[] = new Array(o.N);
    const an = tilt ? dot(f.dir, tilt) : 1;
    for (let j = 0; j < o.N; j++) {
      if (skip(j)) {
        idx[j] = -1;
        continue;
      }
      const q = o.profile(s, j, o.N);
      const off = add(scale(f.right, q.x), scale(f.up, q.y));
      let finalOff = off;
      if (tilt && an > 0.3) finalOff = add(off, scale(f.dir, -dot(off, tilt) / an));
      const p = add(f.pos, finalOff);
      idx[j] = this.mesh.addVertex(p.x, p.y, p.z, o.wind(s, p.y), o.pivot, o.level, 0);
    }
    return { idx, s, f };
  }

  private mitre(loop: number[], o: Organ, s: number): V3 | undefined {
    if (!loop.length) return undefined;
    const f = o.line.at(s);
    const p = this.mesh.positions;
    let n = { x: 0, y: 0, z: 0 };
    for (const i of loop) {
      n.x += p[i * 3] - f.pos.x;
      n.y += p[i * 3 + 1] - f.pos.y;
      n.z += p[i * 3 + 2] - f.pos.z;
    }
    return lengthSq(n) < 1e-10 ? undefined : normalize(n);
  }

  private collar(loop: number[], first: Ring, o: Organ): void {
    const M = loop.length;
    const shift = this.bestShift(loop, first.idx);
    const aligned = loop.map((_, i) => loop[(i + shift) % M]);
    const n = Math.max(0, Math.round(this.d.collarRings));
    let prev = aligned;
    for (let q = 0; q < n; q++) {
      const t = (q + 1) / (n + 1);
      const mid: number[] = [];
      for (let i = 0; i < M; i++) {
        const a = this.pos(aligned[i]);
        const b = this.pos(first.idx[i]);
        // A restrained quadratic bulge avoids a pinched, paper-thin collar on
        // the highly inclined arms of a prickly pear.
        const c = addScaled(b, o.line.dirs[0], -Math.min(o.baseRadius(0) * 2, 0.18 * o.line.length));
        const w0 = (1 - t) * (1 - t);
        const w1 = 2 * t * (1 - t);
        const w2 = t * t;
        const p = {
          x: a.x * w0 + c.x * w1 + b.x * w2,
          y: a.y * w0 + c.y * w1 + b.y * w2,
          z: a.z * w0 + c.z * w1 + b.z * w2,
        };
        mid.push(this.mesh.addVertex(p.x, p.y, p.z, o.wind(first.s * t, p.y), o.pivot, o.level, 1));
      }
      this.bridge(prev, mid);
      prev = mid;
    }
    this.bridge(prev, first.idx);
    for (const v of loop) this.mesh.junction[v] = 1;
    for (const v of first.idx) this.mesh.junction[v] = 1;
  }

  private bestShift(loop: number[], ring: number[]): number {
    let best = 0;
    let bestCost = Infinity;
    const M = loop.length;
    for (let shift = 0; shift < M; shift++) {
      let cost = 0;
      for (let i = 0; i < M; i++) {
        const a = this.pos(loop[(i + shift) % M]);
        const b = this.pos(ring[i]);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        cost += dx * dx + dy * dy + dz * dz;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = shift;
      }
    }
    return best;
  }

  private holeLoop(rings: Ring[], a: Attachment, N: number): number[] {
    const loop: number[] = [];
    const { row0, row1, j0, w } = a;
    for (let j = 0; j <= w; j++) loop.push(rings[row0].idx[mod(j0 + j, N)]);
    for (let i = row0 + 1; i <= row1; i++) loop.push(rings[i].idx[mod(j0 + w, N)]);
    for (let j = w - 1; j >= 0; j--) loop.push(rings[row1].idx[mod(j0 + j, N)]);
    for (let i = row1 - 1; i >= row0 + 1; i--) loop.push(rings[i].idx[mod(j0, N)]);
    for (const v of loop) if (v < 0) throw new Error('desert window touches an interior ring vertex');
    return loop;
  }

  private bridge(a: number[], b: number[]): void {
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      this.mesh.addQuad(a[i], a[j], b[j], b[i], [i / a.length, 0, (i + 1) / a.length, 0, (i + 1) / a.length, 1, i / a.length, 1]);
    }
  }

  private cap(ring: number[], reverse: boolean): void {
    const r = reverse ? [...ring].reverse() : ring;
    for (let i = 0; 2 * i <= r.length - 3; i++) this.mesh.addQuad(r[i], r[i + 1], r[r.length - 2 - i], r[r.length - 1 - i], [0, 0, 1, 0, 1, 1, 0, 1]);
  }

  private surfaceRadius(o: Organ, s: number, az: number): number {
    const a = az;
    const rr = o.baseRadius(s);
    if (o.kind === 'pad') {
      // A cladode is an ellipse in its local right/up frame.  Using the round
      // radius here would put every areole on the broad face several pad
      // thicknesses above the surface.
      const thin = Math.max(0.08, this.d.padThickness / Math.max(0.03, this.d.padWidth));
      return rr / Math.sqrt(Math.cos(a) ** 2 + Math.sin(a) ** 2 / (thin * thin));
    }
    const ribPhase = 0.5 + 0.5 * Math.cos(this.d.ribs * a);
    const rib = this.d.ribs > 0 ? 1 + this.d.ribDepth * Math.pow(ribPhase, Math.max(0.5, this.d.ribSharpness)) : 1;
    return rr * rib;
  }

  private pos(i: number): V3 {
    return { x: this.mesh.positions[i * 3], y: this.mesh.positions[i * 3 + 1], z: this.mesh.positions[i * 3 + 2] };
  }

  private drop(reason: string, n = 1): void {
    this.stats.dropped += n;
    this.stats.dropReasons[reason] = (this.stats.dropReasons[reason] ?? 0) + n;
  }

  // -------------------------------------------------------------------------
  // Surface detail layer
  // -------------------------------------------------------------------------

  private buildSurfaceDetails(): void {
    const d = this.d;
    if (d.form !== 'agave' && d.form !== 'aloe') {
      for (const source of this.sources) this.addSpines(source.organ, source.phase);
      if (d.form === 'ocotillo') {
        for (const source of this.sources) {
          if (source.organ.level > 0) this.addOcotilloLeaves(source.organ, source.phase);
        }
        if (d.flower) {
          for (const source of this.sources) {
            if (source.organ.level > 0) this.addFlower(source.organ.line.at(source.organ.line.length).pos, d.flowerScale * 0.82, false);
          }
        }
      } else if (d.form === 'barrel' || d.form === 'saguaro' || d.form === 'prickly-pear') {
        const eligible = this.sources.filter((s) => s.organ.level === 0 || s.organ.line.length > 0.4);
        if (d.flower && eligible.length) {
          const source = eligible[eligible.length - 1].organ;
          this.addFlower(source.line.at(source.line.length).pos, d.flowerScale, false);
        }
      }
    }
  }

  private addSpines(o: Organ, phase: number): void {
    const d = this.d;
    if (d.spinesPerAreole <= 0 || d.areoleRows <= 0 || (o.kind !== 'round' && o.kind !== 'pad')) return;
    const rows = Math.max(1, Math.round(d.areoleRows * clamp(o.line.length / Math.max(0.1, d.height), 0.18, 1)));
    const cols = Math.max(2, Math.min(d.areoleColumns || d.ribs || 8, Math.max(4, Math.floor(o.N * 0.72))));
    const start = Math.min(o.line.length * 0.08, o.sStart + 0.03);
    const end = Math.max(start + 0.01, o.line.length * 0.93);
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows;
      const s = start + (end - start) * t;
      // Align areoles to ribs when present, with a half-step stagger to avoid
      // the mechanical grid that makes procedural cactus models look printed.
      const stagger = (r & 1) ? 0.5 : 0;
      for (let c = 0; c < cols; c++) {
        const az = ((c + stagger) / cols) * TAU + phase * 0.17;
        const f = o.line.at(s);
        const normal = normalize(add(scale(f.right, Math.cos(az)), scale(f.up, Math.sin(az))));
        const pos = addScaled(f.pos, normal, this.surfaceRadius(o, s, az) * 1.01);
        this.addAreole(pos, normal, f, d.spinesPerAreole, d.spineLength * (1 + d.spineLengthV * this.detailRng.uniform()), d.spineSpread * (0.75 + 0.5 * this.detailRng.uniform()), d.spineClusterScale);
      }
    }
  }

  private addAreole(pos: V3, normal: V3, f: Frame, count: number, length: number, spread: number, scale0: number): void {
    const tan = normalize(cross(normal, f.dir));
    const areoleR = Math.max(0.002, length * 0.2 * scale0);
    this.addDisk(pos, normal, tan, f.dir, areoleR, [0.62, 0.48, 0.29]);
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * TAU + this.detailRng.uniform() * 0.4;
      const tangent = add(scale(tan, Math.cos(a) * spread), scale(f.dir, Math.sin(a) * spread * 0.55));
      const dir = normalize(add(normal, tangent));
      this.addSpike(pos, dir, length * (0.72 + 0.38 * this.detailRng.uniform()), areoleR * 0.55, [0.92, 0.84, 0.61]);
      this.stats.spines++;
    }
    this.stats.details++;
  }

  private addDisk(pos: V3, normal: V3, right: V3, up: V3, r: number, color: [number, number, number]): void {
    const n = 6;
    const ids: number[] = [];
    const center = this.addDetailVertex(addScaled(pos, normal, 0.001), normal, color);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const p = add(pos, add(scale(right, Math.cos(a) * r), scale(up, Math.sin(a) * r)));
      ids.push(this.addDetailVertex(p, normal, color));
    }
    for (let i = 0; i < n; i++) this.details.indices.push(center, ids[i], ids[(i + 1) % n]);
  }

  private addSpike(base: V3, dir: V3, length: number, radius: number, color: [number, number, number]): void {
    const a = normalize(projectOnPlane(dir, UP));
    const side = lengthSq(a) < 1e-10 ? { x: 1, y: 0, z: 0 } : normalize(cross(UP, a));
    const up = normalize(cross(a, side));
    const n = 4;
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const p = add(base, add(scale(side, Math.cos(t) * radius), scale(up, Math.sin(t) * radius)));
      ring.push(this.addDetailVertex(p, dir, color));
    }
    const tip = this.addDetailVertex(addScaled(base, dir, Math.max(0.001, length)), dir, color);
    for (let i = 0; i < n; i++) this.details.indices.push(ring[i], ring[(i + 1) % n], tip);
  }

  private addOcotilloLeaves(o: Organ, phase: number): void {
    const d = this.d;
    const count = Math.max(3, Math.round(o.line.length / Math.max(0.22, d.height * 0.13)));
    const width = Math.min(0.055, Math.max(0.018, d.leafWidth * 0.32));
    const length = Math.min(0.22, Math.max(0.08, d.leafLength * 0.2));
    for (let i = 0; i < count; i++) {
      const t = 0.2 + 0.64 * ((i + 0.5) / count);
      const s = o.line.length * t;
      const f = o.line.at(s);
      const az = ((i + (phase % 1)) * GOLDEN) % TAU;
      const radial = normalize(add(scale(f.right, Math.cos(az)), scale(f.up, Math.sin(az))));
      const base = addScaled(f.pos, radial, this.surfaceRadius(o, s, az) * 1.015);
      const dir = normalize(add(scale(radial, 0.82), add(scale(f.dir, 0.28), { x: 0, y: 0.1, z: 0 })));
      const tip = addScaled(base, dir, length * (0.85 + 0.3 * this.detailRng.uniform()));
      const mid = addScaled(base, dir, length * 0.48);
      this.addLeafRibbon([base, mid, tip], radial, width, d.leafThickness * 0.65, [0.24, 0.48, 0.2]);
      this.stats.details++;
    }
  }

  private addRosetteLeaves(line: Line, bodyH: number, agave: boolean): void {
    const d = this.d;
    const count = Math.max(4, Math.round(d.rosetteLeaves));
    const base = line.at(line.length * 0.8).pos;
    for (let i = 0; i < count; i++) {
      const az = (i * GOLDEN) % TAU + this.detailRng.uniform() * 0.12;
      const len = d.leafLength * (1 + d.leafLengthV * this.detailRng.uniform());
      const width = d.leafWidth * (1 + d.leafWidthV * this.detailRng.uniform());
      const lean = (d.leafLean + (agave ? 8 : 0) + this.detailRng.uniform() * 8) * DEG2RAD;
      const radial = { x: Math.cos(az), y: 0, z: Math.sin(az) };
      const start = add(base, scale(radial, d.radius * 0.22));
      const endHeight = Math.cos(lean) * len;
      const endRadial = Math.sin(lean) * len;
      const pts: V3[] = [];
      const steps = 7;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const sag = d.leafDroop * DEG2RAD * Math.pow(t, 1.7);
        const p = {
          x: start.x + radial.x * endRadial * t,
          y: start.y + endHeight * t - Math.sin(sag) * len * 0.16 * t,
          z: start.z + radial.z * endRadial * t,
        };
        pts.push(p);
      }
      this.addLeafRibbon(pts, radial, width, d.leafThickness, agave ? [0.24, 0.43, 0.28] : [0.34, 0.56, 0.29]);
      if (d.leafSerration > 0) {
        for (let k = 1; k < steps; k += 2) {
          const p = pts[k];
          const dir = normalize(add(radial, { x: 0, y: 0.35, z: 0 }));
          this.addSpike(addScaled(p, radial, width * 0.48), dir, width * 0.12 * d.leafSerration, width * 0.028, [0.78, 0.76, 0.56]);
          this.addSpike(addScaled(p, radial, -width * 0.48), dir, width * 0.12 * d.leafSerration, width * 0.028, [0.78, 0.76, 0.56]);
        }
      }
      this.stats.rosetteLeaves++;
      this.stats.details++;
    }
    if (d.flower && agave) this.addFlower({ x: base.x, y: base.y + d.leafLength * 0.55, z: base.z }, d.flowerScale * 1.8, true);
  }

  private addLeafRibbon(points: V3[], radial: V3, width: number, thickness: number, color: [number, number, number]): void {
    const ids: number[][] = [];
    const up = UP;
    const normal = normalize(cross(radial, up));
    for (let i = 0; i < points.length; i++) {
      const t = i / Math.max(1, points.length - 1);
      const w = Math.max(width * 0.035, width * (1 - Math.pow(t, 1.55)));
      const tangent = i < points.length - 1 ? normalize(sub(points[i + 1], points[i])) : normalize(sub(points[i], points[i - 1]));
      const across = normalize(cross(tangent, normal));
      const left = add(points[i], add(scale(across, -w), scale(normal, thickness * 0.5)));
      const right = add(points[i], add(scale(across, w), scale(normal, thickness * 0.5)));
      ids.push([this.addDetailVertex(left, normal, color), this.addDetailVertex(points[i], normal, color), this.addDetailVertex(right, normal, color)]);
    }
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i];
      const b = ids[i + 1];
      this.details.indices.push(a[0], a[1], b[1], a[0], b[1], b[0], a[1], a[2], b[2], a[1], b[2], b[1]);
    }
  }

  private addFlower(top: V3, size: number, upright: boolean): void {
    const count = upright ? 9 : 12;
    const stemBase = { x: top.x, y: top.y - size * 0.55, z: top.z };
    this.addSpike(stemBase, { x: 0, y: 1, z: 0 }, size * 0.65, size * 0.055, [0.23, 0.42, 0.2]);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const radial = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      const base = addScaled(top, radial, size * 0.08);
      const tip = add(addScaled(top, radial, size * 0.58), { x: 0, y: size * (upright ? 0.2 : 0.05), z: 0 });
      const tangent = normalize(cross(radial, UP));
      const w = size * 0.2;
      const a0 = this.addDetailVertex(add(base, scale(tangent, -w)), UP, [0.94, 0.66, 0.7]);
      const a1 = this.addDetailVertex(add(base, scale(tangent, w)), UP, [0.98, 0.78, 0.48]);
      const a2 = this.addDetailVertex(add(tip, scale(tangent, w * 0.18)), UP, [0.92, 0.4, 0.52]);
      const a3 = this.addDetailVertex(add(tip, scale(tangent, -w * 0.18)), UP, [0.93, 0.48, 0.63]);
      this.details.indices.push(a0, a1, a2, a0, a2, a3);
    }
    this.stats.flowers++;
    this.stats.details++;
  }

  private addDetailVertex(p: V3, normal: V3, color: [number, number, number]): number {
    const idx = this.details.positions.length / 3;
    this.details.positions.push(p.x, p.y, p.z);
    this.details.normals.push(normal.x, normal.y, normal.z);
    this.details.uvs.push(0.5, 0.5);
    this.details.wind.push(clamp(p.y / this.plantH, 0, 1), 1, this.detailRng.next(), 1);
    this.details.pivots.push(0, 0, 0);
    this.details.colors.push(color[0], color[1], color[2]);
    return idx;
  }

  private normaliseWind(): void {
    let maxY = 1e-3;
    for (let i = 1; i < this.mesh.positions.length; i += 3) maxY = Math.max(maxY, this.mesh.positions[i]);
    for (let i = 0; i < this.mesh.wind.length; i += 4) this.mesh.wind[i] = clamp(this.mesh.positions[(i / 4) * 3 + 1] / maxY, 0, 1);
    for (let i = 0; i < this.details.wind.length; i += 4) this.details.wind[i] = clamp(this.details.positions[(i / 4) * 3 + 1] / maxY, 0, 1);
  }

  private visibleHeight(): number {
    let h = 0;
    for (let i = 1; i < this.mesh.positions.length; i += 3) h = Math.max(h, this.mesh.positions[i]);
    for (let i = 1; i < this.details.positions.length; i += 3) h = Math.max(h, this.details.positions[i]);
    return Math.max(0.05, h);
  }
}

// -----------------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------------

function verticalLine(start: V3, length: number, lean: number, curve: number, steps: number): Line {
  const line = new Line();
  const n = Math.max(2, Math.round(steps));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend = Math.sin(Math.PI * t) * curve * 0.02;
    const p = { x: start.x + Math.sin(lean) * length * t + bend, y: start.y + Math.cos(lean) * length * t, z: start.z };
    const deriv = { x: Math.sin(lean) + Math.cos(Math.PI * t) * curve * 0.02 / Math.max(0.01, length), y: Math.cos(lean), z: 0 };
    const dir = normalize(deriv);
    const right = normalize(cross(UP, dir));
    line.push(p, dir, lengthSq(right) < 1e-10 ? { x: 1, y: 0, z: 0 } : right);
  }
  return line;
}

/** Path with a horizontal run followed by a raised elbow, like a Saguaro arm. */
function elbowLine(start: V3, outward: V3, horizontal: number, rise: number, lean: number, curve: number, steps: number): Line {
  const line = new Line();
  const n = Math.max(4, Math.round(steps));
  const h = normalize(projectOnPlane(outward, UP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend = smoothstep(clamp(t / 0.48, 0, 1));
    const x = horizontal * bend;
    const y = rise * smoothstep(clamp((t - 0.25) / 0.75, 0, 1));
    const side = Math.sin(Math.PI * t) * curve * 0.018;
    const p = add(start, add(scale(h, x + side), { x: 0, y, z: 0 }));
    const dt = 1 / n;
    const t2 = Math.min(1, t + dt);
    const b2 = smoothstep(clamp(t2 / 0.48, 0, 1));
    const y2 = smoothstep(clamp((t2 - 0.25) / 0.75, 0, 1));
    const deriv = add(scale(h, (horizontal * (b2 - bend)) / dt), { x: 0, y: (rise * (y2 - smoothstep(clamp((t - 0.25) / 0.75, 0, 1)))) / dt, z: 0 });
    let dir = normalize(deriv);
    if (lengthSq(dir) < 1e-10) dir = UP;
    dir = normalize(add(dir, scale(h, Math.sin(Math.PI * t) * Math.sin(lean) * 0.18)));
    let right = normalize(cross(UP, dir));
    if (lengthSq(right) < 1e-10) right = { x: 1, y: 0, z: 0 };
    line.push(p, dir, right);
  }
  return line;
}

function padLine(start: V3, outward: V3, length: number, tilt: number, steps: number): Line {
  const line = new Line();
  const h = normalize(projectOnPlane(outward, UP));
  const n = Math.max(4, Math.round(steps));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const sway = Math.sin(Math.PI * t) * length * 0.1;
    const p = add(start, add(scale(h, length * t + sway), { x: 0, y: Math.sin(tilt) * length * t, z: 0 }));
    const deriv = normalize(add(scale(h, 1 + Math.cos(Math.PI * t) * 0.1), { x: 0, y: Math.sin(tilt), z: 0 }));
    let right = normalize(cross(UP, deriv));
    if (lengthSq(right) < 1e-10) right = { x: 1, y: 0, z: 0 };
    line.push(p, deriv, right);
  }
  return line;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function candidateOffsets(): [number, number][] {
  return OFFSETS.map(([ds, dj]) => [ds, dj]);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function circularOverlap(a: number, wa: number, b: number, wb: number, N: number): boolean {
  if (wa >= N || wb >= N) return true;
  a = mod(a, N);
  b = mod(b, N);
  const d = mod(b - a, N);
  return d < wa || mod(a - b, N) < wb;
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

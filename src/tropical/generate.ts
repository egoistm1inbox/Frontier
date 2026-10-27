/**
 * Tropical plant generators.
 *
 * Four growth habits (palm, paddle-leaf, rosette, branching tree) grow plants
 * out of welded tubes: every frond is extruded from a window cut in the
 * trunk, every leaflet from a window in the rachis, every nut, root and petal
 * the same way — so the result is always a single closed manifold mesh.
 */

import {
  DEG, TAU, V3, add, addScaled, clamp, cross, dirFromAzEl, hexToRgb, length, lerp, mixRgb, normalize, rotateAxis, scale, smoothstep, sub, v3,
} from '../core/math';
import { Random } from '../core/random';
import { fbm3, noise3 } from '../core/noise';
import { ORGAN, QuadMesh, TILE } from './mesh';
import { PlantBuilder, ProfilePt, TubeGrid, TubeSpec, WindSpec, evenRings } from './welder';
import { PlantParams } from './params';

export interface GenerateResult {
  mesh: QuadMesh;
  height: number;
  stats: PlantBuilder['stats'];
  timings: { build: number; total: number };
}

type RGB = [number, number, number];
const col = (hex: string): RGB => hexToRgb(hex);
const tint = (c: RGB, f: number): RGB => [clamp(c[0] * f, 0, 1), clamp(c[1] * f, 0, 1), clamp(c[2] * f, 0, 1)];

const UP = v3(0, 1, 0);

// -----------------------------------------------------------------------------
// Spine helpers
// -----------------------------------------------------------------------------

/** Integrate a spine: start in `dir`, pitch rotating by `bendAt(s)` rad/m (negative = droop down). */
function bendSpine(origin: V3, dir: V3, len: number, steps: number, bendAt: (s: number) => number, sideAt?: (s: number) => number): V3[] {
  const pts: V3[] = [origin];
  let d = normalize(dir);
  let p = origin;
  const step = len / steps;
  // Pitch axis: horizontal axis perpendicular to d.
  for (let i = 1; i <= steps; i++) {
    const s = (i - 0.5) / steps;
    const bend = bendAt(s) * step;
    if (bend !== 0) {
      let axis = cross(d, UP);
      if (length(axis) < 1e-5) axis = v3(1, 0, 0);
      axis = normalize(axis);
      d = rotateAxis(d, axis, bend);
    }
    if (sideAt) {
      const sway = sideAt(s) * step;
      if (sway !== 0) d = rotateAxis(d, UP, sway);
    }
    d = normalize(d);
    p = addScaled(p, d, step);
    pts.push(p);
  }
  return pts;
}

function wind(pivot: V3, phase: number, limb0: number, limb1: number, detail0: number, detail1: number): WindSpec {
  return { pivot, phase, limb0, limb1, detail0, detail1 };
}

const NO_WIND = (at: V3): WindSpec => wind(at, 0, 0, 0, 0, 0);

// -----------------------------------------------------------------------------
// Profiles
// -----------------------------------------------------------------------------

function circleInto(out: ProfilePt[], sides: number, rx: number, ry: number): void {
  for (let j = 0; j < sides; j++) {
    const a = (j / sides) * TAU;
    out[j].x = Math.cos(a) * rx;
    out[j].y = Math.sin(a) * ry;
    out[j].u = j / sides;
  }
}

/**
 * Leaflet lens profile (6 points): Λ-folded blade with a top midrib ridge and
 * a bottom keel. x scaled by half-width, y by fold height.
 */
const LEAFLET_PTS: [number, number, number][] = [
  // x, y, u
  [1, 0, 0.5],
  [0.5, 0.55, 0.625],
  [0, 1, 0.75],
  [-0.5, 0.55, 0.875],
  [-1, 0, 0],
  [0, -0.45, 0.25],
];
const LEAFLET_SHADE = [0.92, 1.0, 1.16, 1.0, 0.92, 0.78];

function leafletInto(out: ProfilePt[], halfW: number, fold: number, keel: number): void {
  for (let j = 0; j < 6; j++) {
    const [x, y, u] = LEAFLET_PTS[j];
    out[j].x = x * halfW;
    out[j].y = y * (y >= 0 ? fold : keel);
    out[j].u = u;
  }
}

/**
 * Simple-blade profile (10 points): arched lamina with a grooved top midrib
 * and a keeled underside. Morphs from a round petiole by `blade` 0..1.
 * halfWL / halfWR allow asymmetric (notched) margins.
 */
const BLADE_PTS: [number, number, number][] = [
  [1, 0, 0.5],
  [0.72, 0.62, 0.6],
  [0.38, 0.95, 0.69],
  [0, 0.82, 0.75],
  [-0.38, 0.95, 0.81],
  [-0.72, 0.62, 0.9],
  [-1, 0, 0],
  [-0.55, -0.5, 0.1],
  [0, -1, 0.25],
  [0.55, -0.5, 0.4],
];
const BLADE_SHADE = [0.94, 1.0, 1.02, 1.14, 1.02, 1.0, 0.94, 0.8, 0.9, 0.8];

function bladeInto(out: ProfilePt[], halfWL: number, halfWR: number, archH: number, keelH: number, petR: number, blade: number, marginWave: number): void {
  for (let j = 0; j < 10; j++) {
    const [bx, by, u] = BLADE_PTS[j];
    const a = (j / 10) * TAU;
    const cx = Math.cos(a) * petR;
    const cy = Math.sin(a) * petR * 0.9;
    const hw = bx >= 0 ? halfWR : halfWL;
    let px = bx * hw;
    let py = by * (by >= 0 ? archH : keelH);
    if (Math.abs(bx) === 1) py += marginWave;
    out[j].x = lerp(cx, px, blade);
    out[j].y = lerp(cy, py, blade);
    out[j].u = u;
  }
}

/** Width envelope of a leaflet along its length (0..1 → 0..1). */
function leafletWidthAt(t: number): number {
  const grow = 0.22 + 0.78 * smoothstep(0, 0.14, t);
  const taper = Math.pow(1 - t, 0.5) * (1 - smoothstep(0.9, 1, t) * 0.85);
  return grow * Math.max(0.02, taper + 0.12 * (1 - t));
}

/** Width envelope of a simple blade (tb = 0 at blade base, 1 at tip). */
function bladeWidthAt(tb: number, lobes: number): number {
  const peak = 0.34 + lobes * 0.08;
  let w: number;
  if (tb < peak) w = Math.pow(smoothstep(0, peak, tb), 0.75);
  else w = Math.pow(1 - smoothstep(peak, 1, tb), 0.65);
  // Heart-shaped basal lobes: a bump of width right at the base.
  if (lobes > 0) w += lobes * 0.38 * Math.exp(-Math.pow((tb - 0.07) / 0.075, 2));
  return clamp(w, 0.01, 1.05);
}

// -----------------------------------------------------------------------------
// Trunk / stem
// -----------------------------------------------------------------------------

interface TrunkOpts {
  crownBand: number; // arclength fraction at the top packed with crown windows
  crownWindows: number; // expected number of organs welded into the crown band
  /** Fraction of the trunk over which branches attach (branching trees). */
  branchBand?: [number, number];
}

function buildTrunk(bd: PlantBuilder, p: PlantParams, rng: Random, base: V3, leanAz: number, heightScale: number, sides: number, opts: TrunkOpts): TubeGrid {
  const b = p.botany;
  const H = Math.max(0.12, b.trunkHeight * heightScale);
  const lean = v3(Math.cos(leanAz), 0, Math.sin(leanAz));
  const curveAmt = b.trunkCurve * H * 0.16;
  const swayPhase = rng.range(0, TAU);
  const spine: V3[] = [];
  const STEPS = 20;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const y = -0.18 + t * (H + 0.18);
    const off = curveAmt * t * t + Math.sin(t * 2.6 + swayPhase) * b.trunkCurve * H * 0.012;
    spine.push(v3(base.x + lean.x * off, y, base.z + lean.z * off));
  }

  // Ring layout: sparse shaft, dense crown band (plus branch band if needed).
  const q = p.mesh.quality;
  const ringSet = new Set<number>();
  const shaftRings = Math.max(8, Math.round(20 * q));
  const crownStart = 1 - opts.crownBand;
  for (let i = 0; i <= shaftRings; i++) ringSet.add((i / shaftRings) * crownStart);
  const crownRings = Math.max(10, opts.crownWindows * 2 + 8);
  for (let i = 0; i <= crownRings; i++) ringSet.add(crownStart + (i / crownRings) * opts.crownBand);
  if (opts.branchBand) {
    const [lo, hi] = opts.branchBand;
    const n = Math.round(28 * q);
    for (let i = 0; i <= n; i++) ringSet.add(lo + (i / n) * (hi - lo));
  }
  ringSet.add(0.02); ringSet.add(0.05); ringSet.add(0.1); // flare curvature
  const ringTs = [...ringSet].sort((a, c) => a - c);

  const trunkLen = H + 0.18;
  const cBase = col(b.trunkColor);
  const cTop = col(b.trunkColor2);
  const noiseSeed = rng.range(0, 40);
  const lobeCount = 5;
  const lobePhase = rng.range(0, TAU);
  const flare = p.roots.flare;

  const radiusAt = (t: number, ang: number): number => {
    const dist = t * trunkLen;
    let r = b.trunkRadius * (1 - 0.22 * smoothstep(0.05, 1, t)); // gentle taper
    // Basal flare / palm root bulge.
    r *= 1 + flare * 0.85 * Math.exp(-dist * 1.9);
    // Buttress fluting near the ground.
    r *= 1 + flare * 0.16 * Math.cos(lobeCount * ang + lobePhase) * Math.exp(-dist * 1.4);
    // Crownshaft: smooth slight bulge, no scars.
    const shaft = b.crownshaft > 0 ? smoothstep(1 - b.crownshaft * 1.6, 1 - b.crownshaft * 0.4, t) : 0;
    if (shaft > 0) r *= 1 + shaft * 0.13;
    // Ring scars (old frond bases).
    if (b.ringFrequency > 0) {
      const ph = 0.5 + 0.5 * Math.cos(dist * b.ringFrequency * TAU);
      r *= 1 - b.ringDepth * 0.055 * Math.pow(1 - ph, 1.6) * (1 - shaft) * smoothstep(0, 0.35, dist);
    }
    // Organic wobble.
    r *= 1 + 0.022 * noise3(Math.cos(ang) * 1.6 + noiseSeed, dist * 2.4, Math.sin(ang) * 1.6);
    // Gather to the apex dome.
    r *= 1 - smoothstep(0.985, 1.0, t) * 0.55;
    return Math.max(0.008, r);
  };

  const spec: TubeSpec = {
    spine,
    ringTs,
    sides,
    profileAt: (t, out) => {
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const r = radiusAt(t, a);
        out[j].x = Math.cos(a) * r;
        out[j].y = Math.sin(a) * r;
        out[j].u = j / sides;
      }
    },
    colorAt: (t, j) => {
      const dist = t * trunkLen;
      const a = (j / sides) * TAU;
      let c = mixRgb(cBase, cTop, smoothstep(0.55, 1, t));
      if (b.ringFrequency > 0) {
        const ph = 0.5 + 0.5 * Math.cos(dist * b.ringFrequency * TAU);
        c = tint(c, 1 - b.ringDepth * 0.34 * Math.pow(1 - ph, 1.5) * smoothstep(0, 0.35, dist));
      }
      const mott = fbm3(Math.cos(a) * 2.2 + noiseSeed, dist * 3.1, Math.sin(a) * 2.2, 2);
      c = tint(c, 1 + mott * 0.16);
      // Weathered dark foot.
      c = tint(c, 0.72 + 0.28 * smoothstep(0, 0.5, dist));
      return c;
    },
    upHint: v3(1, 0, 0),
    tile: TILE.bark,
    vPerMeter: 0.55,
    vOffset: rng.next(),
    organ: ORGAN.trunk,
    wind: NO_WIND(v3(base.x, 0, base.z)),
    capStart: true,
    capEnd: true,
    capScale: 0.55,
  };
  return bd.tube(spec);
}

/** Squashed root-crown blob that clustering stems / rosette leaves weld into. */
function buildCrownBlob(bd: PlantBuilder, p: PlantParams, rng: Random, radius: number, height: number): TubeGrid {
  const b = p.botany;
  const sides = 20;
  const spine = [v3(0, -0.14, 0), v3(0, height * 0.4, 0), v3(0, height, 0)];
  const cA = col(b.trunkColor);
  const seed = rng.range(0, 30);
  const spec: TubeSpec = {
    spine,
    ringTs: evenRings(24),
    sides,
    profileAt: (t, out) => {
      const bulge = Math.sin(Math.PI * (0.12 + 0.8 * t));
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const r = radius * Math.max(0.25, bulge) * (1 + 0.05 * noise3(Math.cos(a) * 2 + seed, t * 4, Math.sin(a) * 2));
        out[j].x = Math.cos(a) * r;
        out[j].y = Math.sin(a) * r;
        out[j].u = j / sides;
      }
    },
    colorAt: (t, j) => {
      const a = (j / sides) * TAU;
      return tint(cA, 0.8 + 0.2 * t + 0.12 * noise3(Math.cos(a) * 2.5 + seed, t * 5, Math.sin(a) * 2.5));
    },
    upHint: v3(1, 0, 0),
    tile: TILE.bark,
    vPerMeter: 1.4,
    organ: ORGAN.trunk,
    wind: NO_WIND(v3(0, 0, 0)),
    capStart: true,
    capEnd: true,
    capScale: 0.7,
  };
  return bd.tube(spec);
}

// -----------------------------------------------------------------------------
// Leaflets & fronds
// -----------------------------------------------------------------------------

interface LeafletOpts {
  len: number;
  width: number;
  droop: number;
  twistRad: number;
  colorA: RGB;
  colorB: RGB;
  windPhase: number;
  pivot: V3;
  limbBase: number;
  rings: number;
  /** Fold height factor (0 = flat lens, 1 = deep V). */
  fold: number;
  organ: number;
  tile: number;
}

function leafletSpec(origin: V3, dir: V3, up: V3, o: LeafletOpts, rng: Random): TubeSpec {
  const droopTotal = o.droop * 0.85; // radians of pitch-down over the length
  const spine = bendSpine(origin, dir, o.len, 8, (s) => -(droopTotal / o.len) * (0.25 + 1.5 * s * s), () => rng.bell() * 0.02 / o.len);
  const jitter = rng.range(0.9, 1.08);
  const cA = tint(o.colorA, jitter);
  const cB = tint(o.colorB, jitter);
  return {
    spine,
    ringTs: evenRings(Math.max(4, o.rings)),
    sides: 6,
    profileAt: (t, out) => {
      const halfW = (o.width / 2) * leafletWidthAt(t);
      const fold = Math.max(0.0008, halfW * 0.85 * o.fold * (1 - t * 0.45) + 0.0006);
      leafletInto(out, Math.max(0.0006, halfW), fold, fold * 0.5);
    },
    colorAt: (t, j) => tint(mixRgb(cA, cB, t * 0.8), LEAFLET_SHADE[j] * (1 - 0.25 * (1 - t) * (1 - t))),
    upHint: up,
    rollAt: (t) => o.twistRad * Math.pow(t, 1.25),
    tile: o.tile,
    vPerMeter: 1.6,
    vOffset: rng.next(),
    organ: o.organ,
    wind: wind(o.pivot, o.windPhase, o.limbBase, o.limbBase + 0.3, 0.2, 1),
    capEnd: true,
    capScale: 1.6,
  };
}

interface FrondResult {
  grid: TubeGrid;
}

/** Grow one palm frond (pinnate or palmate) welded into the trunk crown. */
function buildFrond(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid, age: number, az: number, elevation: number, dead: boolean): FrondResult | null {
  const b = p.botany;
  const palmate = b.frondType === 'palmate';
  const young = smoothstep(0, 0.22, age);
  const len = b.frondLength * (dead ? 0.85 : 0.5 + 0.5 * young) * rng.range(0.92, 1.06);
  const arc = b.frondArc * (dead ? 1.5 : lerp(0.35, 1.15, age));
  const dir0 = dirFromAzEl(az, elevation);

  const attachT = dead ? 0.88 - (age - 1) * 0.14 : 0.995 - age * 0.115;
  const frame = bd.frameAt(trunk, clamp(attachT, 0.5, 0.999));
  const origin = addScaled(frame.center, dir0, frame.radius * 0.9);

  // Rachis spine: rises, then arcs over. Pitch-down rate grows along length.
  const totalBend = dead ? 0.38 : arc * 1.15;
  const spine = bendSpine(origin, dir0, len, 26, (s) => -(totalBend / len) * (0.12 + 1.7 * s * s), (s) => Math.sin(s * 5 + az) * 0.012 / len);

  // Ring layout: sparse petiole, then 3 rings per leaflet pair in the blade.
  const perSide = Math.max(4, Math.round(b.leafletsPerSide * (dead ? 0.8 : 1)));
  const ringTs: number[] = [];
  const pet = b.petioleRatio;
  const petRings = 8;
  for (let i = 0; i <= petRings; i++) ringTs.push((i / petRings) * pet);
  const bladeRings = perSide * 3 + 3;
  for (let i = 1; i <= bladeRings; i++) ringTs.push(pet + (i / bladeRings) * (0.992 - pet));
  ringTs.push(1);

  const r0 = clamp(len * 0.0115, 0.018, 0.075) * (palmate ? 1.2 : 1);
  const cRachis = dead ? col(b.deadColor) : col(b.rachisColor);
  const cRachisTip = tint(cRachis, 1.25);
  const phase = rng.next();
  const spec: TubeSpec = {
    spine,
    ringTs,
    sides: 8,
    profileAt: (t, out) => {
      const boot = 1 + 0.85 * Math.exp(-t * 26); // sheath / boot flare at base
      const r = Math.max(0.0022, r0 * Math.pow(1 - t, 0.62) * boot);
      circleInto(out, 8, r, r * 0.84);
    },
    colorAt: (t) => tint(mixRgb(cRachis, cRachisTip, t), 0.82 + 0.18 * smoothstep(0, 0.2, t)),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.1,
    vOffset: rng.next(),
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0, dead ? 0.25 : 0.8, 0, 0.3),
    capEnd: true,
    capScale: 1.4,
  };
  const grid = bd.weld(trunk, attachT, dir0, 2, 2, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale });
  if (!grid) return null;

  // ── leaflets / segments ───────────────────────────────────────────────────
  const leafA = dead ? col(b.deadColor) : mixRgb(col(b.leafColor), col(b.leafColor2), (1 - age) * 0.45);
  const leafB = dead ? tint(col(b.deadColor), 1.2) : mixRgb(col(b.leafColor), [0.72, 0.66, 0.24], age * age * 0.5);
  const ringsPerLeaflet = Math.max(4, Math.round(p.mesh.leafletRings * p.mesh.quality));

  for (let sideI = 0; sideI < 2; sideI++) {
    const side = sideI === 0 ? 1 : -1;
    for (let k = 0; k < perSide; k++) {
      const tB = (k + 0.5) / perSide; // 0 at blade base → 1 at tip
      const t = pet + tB * (0.985 - pet) + (sideI === 1 ? (0.985 - pet) / bladeRings : 0);
      const f = bd.frameAt(grid, t);

      let dir: V3;
      let segLen: number;
      let upHint: V3;
      if (!palmate) {
        // Rank tilt (V formation), flattened by plumose scatter.
        const baseTilt = lerp(38, 16, tB) * DEG;
        const tilt = baseTilt + rng.bell() * b.plume * 55 * DEG;
        const sideDir = normalize(addScaled(scale(f.U, side * Math.cos(tilt)), f.V, Math.sin(tilt)));
        const ang = (b.leafletAngle + rng.bell() * 6 + tB * 10) * DEG;
        dir = normalize(addScaled(scale(sideDir, Math.sin(ang)), f.T, Math.cos(ang)));
        const shape = 0.35 + 0.65 * Math.sin(Math.PI * (0.1 + 0.78 * tB));
        segLen = b.leafletLength * shape * (0.45 + 0.55 * young) * rng.range(0.9, 1.08) * (dead ? 0.78 : 1);
        upHint = f.V;
      } else {
        // Fan: segments aim at a circular arc centred where the blade begins.
        const J = bd.frameAt(grid, pet).center;
        const maxFan = 96 * DEG;
        const phi = maxFan * Math.pow(1 - tB, 0.8) * rng.range(0.96, 1.02);
        const dirJ = normalize(addScaled(scale(f.T, Math.cos(phi)), f.U, side * Math.sin(phi)));
        const R = b.leafletLength * 1.18;
        const target = addScaled(J, dirJ, R);
        const from = addScaled(f.center, f.U, side * f.radius);
        dir = normalize(sub(target, from));
        segLen = clamp(length(sub(target, from)), b.leafletLength * 0.3, b.leafletLength * 1.25) * rng.range(0.94, 1.04);
        upHint = f.V;
      }
      const lo: LeafletOpts = {
        len: segLen,
        width: b.leafletWidth * (palmate ? 1.15 : 1) * rng.range(0.9, 1.1),
        droop: (dead ? 1.6 : b.leafletDroop) * (0.6 + 0.7 * tB),
        twistRad: side * b.leafletTwist * DEG * (dead ? 0.4 : 1),
        colorA: leafA,
        colorB: leafB,
        windPhase: phase,
        pivot: origin,
        limbBase: 0.12 + 0.55 * t,
        rings: ringsPerLeaflet,
        fold: 1,
        organ: ORGAN.leaf,
        tile: TILE.leafLong,
      };
      const lo2 = leafletSpec(addScaled(f.center, dir, f.radius * 0.85), dir, upHint, lo, rng.fork());
      bd.weld(grid, t, dir, 1, 2, lo2, { collarRings: Math.min(1, p.mesh.collarRings), collarScale: 0.7 });
    }
  }
  return { grid };
}

/** Weld the nut cluster under a palm crown. */
function buildNuts(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  if (b.nutCount <= 0) return;
  const cA = col(b.nutColor);
  const cB = col(b.nutColor2);
  for (let i = 0; i < b.nutCount; i++) {
    const az = rng.range(0, TAU);
    const t = 0.855 + rng.next() * 0.035;
    const dir = dirFromAzEl(az, rng.range(-0.95, -0.5));
    const f = bd.frameAt(trunk, t);
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const R = b.nutSize * rng.range(0.85, 1.12);
    const len = R * 2.5;
    const spine = [origin, addScaled(origin, dir, len * 0.55), addScaled(origin, dir, len)];
    const ripe = rng.next();
    const cN = mixRgb(cA, cB, ripe);
    const spec: TubeSpec = {
      spine,
      ringTs: evenRings(9),
      sides: 10,
      profileAt: (tt, out) => {
        const egg = Math.pow(Math.sin(Math.PI * (0.1 + 0.82 * tt)), 0.75);
        const r = Math.max(0.004, R * egg * (0.3 + 0.7 * smoothstep(0, 0.25, tt)));
        circleInto(out, 10, r, r * 0.94);
      },
      colorAt: (tt, j) => tint(cN, (0.85 + 0.15 * tt) * (1 + 0.08 * noise3(j * 1.7, tt * 6 + i * 9, i))),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2.2,
      organ: ORGAN.fruit,
      wind: wind(origin, rng.next(), 0.15, 0.3, 0.05, 0.15),
      capEnd: true,
      capScale: 0.5,
    };
    bd.weld(trunk, t, dir, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: 0.6, margin: 0 });
  }
}

/** Stilt / aerial roots welded into the trunk, diving below ground. */
function buildStiltRoots(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const n = Math.round(p.roots.stiltCount);
  if (n <= 0) return;
  const cRoot = tint(col(b.trunkColor), 0.62);
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TAU + rng.range(-0.2, 0.2);
    const t = clamp(p.roots.stiltHeight * rng.range(0.8, 1.2), 0.03, 0.6);
    const f = bd.frameAt(trunk, t);
    const out = v3(Math.cos(az), 0, Math.sin(az));
    const dir = normalize(v3(out.x * 0.9, -1.15, out.z * 0.9));
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const reach = (f.center.y + 0.35) / 1.05;
    const spine = bendSpine(origin, dir, reach * 1.35, 7, (s) => -(0.5 / reach) * s);
    const r0 = Math.max(0.012, b.trunkRadius * 0.28);
    const spec: TubeSpec = {
      spine,
      ringTs: evenRings(9),
      sides: 8,
      profileAt: (tt, outP) => {
        const r = Math.max(0.003, r0 * Math.pow(1 - tt, 0.55) * (1 + 0.5 * Math.exp(-tt * 9)));
        circleInto(outP, 8, r, r);
      },
      colorAt: (tt) => tint(cRoot, 0.8 + 0.2 * tt),
      upHint: v3(1, 0, 0),
      tile: TILE.bark,
      vPerMeter: 1.2,
      organ: ORGAN.root,
      wind: NO_WIND(origin),
      capEnd: true,
      capScale: 1.2,
    };
    bd.weld(trunk, t, dir, 2, 2, spec, { collarRings: p.mesh.collarRings, collarScale: 0.7 });
  }
}

// -----------------------------------------------------------------------------
// Simple blade leaves (banana paddle, rosette leaf, tree leaf)
// -----------------------------------------------------------------------------

interface BladeLeafOpts {
  len: number;
  width: number;
  /** Arclength fraction where petiole becomes blade. */
  petioleRatio: number;
  /** Droop of the whole leaf (radians-ish factor). */
  arc: number;
  /** Midrib elevation in the blade section, radians. */
  bladeEl: number;
  notch: number;
  lobes: number;
  /** 0 = rolled cigar leaf, 1 = fully unfurled blade. */
  unfurl: number;
  colorA: RGB;
  colorB: RGB;
  petioleColor: RGB;
  pivot: V3;
  phase: number;
  limbBase: number;
  rings: number;
  petioleR: number;
}

function bladeLeafSpec(origin: V3, dir0: V3, o: BladeLeafOpts, rng: Random): TubeSpec {
  // Spine: petiole rises along dir0, blade section bends toward bladeEl and droops.
  const startEl = Math.asin(clamp(dir0.y, -1, 1));
  const spine = bendSpine(origin, dir0, o.len, 22, (s) => {
    const target = o.bladeEl - o.arc * 0.55 * smoothstep(0.45, 1, s);
    const cur = lerp(startEl, target, smoothstep(o.petioleRatio * 0.6, o.petioleRatio + 0.25, s));
    const nxt = lerp(startEl, o.bladeEl - o.arc * 0.55 * smoothstep(0.45, 1, s + 0.05), smoothstep(o.petioleRatio * 0.6, o.petioleRatio + 0.25, s + 0.05));
    return ((nxt - cur) / 0.05) / o.len;
  });
  // Marginal notches (monstera splits): precomputed centres per side.
  const notchesL: number[] = [];
  const notchesR: number[] = [];
  if (o.notch > 0.02) {
    const count = 4 + Math.floor(rng.next() * 2);
    for (let i = 0; i < count; i++) {
      notchesL.push(0.14 + (i / count) * 0.72 + rng.range(-0.02, 0.02));
      notchesR.push(0.14 + ((i + 0.5) / count) * 0.72 + rng.range(-0.02, 0.02));
    }
  }
  const notchDepth = (tb: number, list: number[]): number => {
    let d = 0;
    for (const c of list) d = Math.max(d, Math.exp(-Math.pow((tb - c) / 0.052, 2)));
    return d * o.notch * 0.9 * smoothstep(0.06, 0.28, tb) * (1 - smoothstep(0.85, 1, tb));
  };
  const waveFreq = rng.range(9, 14);
  const wavePhase = rng.range(0, TAU);
  const cA = o.colorA;
  const cB = o.colorB;
  const cP = o.petioleColor;
  const ringTs: number[] = [];
  {
    const nP = Math.max(3, Math.round(o.rings * 0.28));
    const nB = Math.max(6, o.rings - nP);
    for (let i = 0; i <= nP; i++) ringTs.push((i / nP) * o.petioleRatio);
    for (let i = 1; i <= nB; i++) ringTs.push(o.petioleRatio + (i / nB) * (1 - o.petioleRatio));
  }
  return {
    spine,
    ringTs,
    sides: 10,
    profileAt: (t, out) => {
      const tb = clamp((t - o.petioleRatio) / Math.max(1e-4, 1 - o.petioleRatio), 0, 1);
      const blade = smoothstep(o.petioleRatio * 0.92, o.petioleRatio + 0.1, t) * o.unfurl;
      const wShape = bladeWidthAt(tb, o.lobes);
      const halfW = (o.width / 2) * wShape * (0.12 + 0.88 * o.unfurl);
      const halfWL = halfW * (1 - notchDepth(tb, notchesL));
      const halfWR = halfW * (1 - notchDepth(tb, notchesR));
      const archH = Math.max(0.0012, halfW * 0.16 + 0.001);
      const keelH = Math.max(0.0012, o.petioleR * (1 - tb * 0.75) + halfW * 0.05);
      const petR = o.petioleR * (1 - t * 0.45) * (1 + 0.5 * Math.exp(-t * 14));
      const wave = Math.sin(tb * waveFreq * TAU * 0.5 + wavePhase) * halfW * 0.06 * blade;
      bladeInto(out, Math.max(0.0012, halfWL), Math.max(0.0012, halfWR), archH, keelH, petR, blade, wave);
    },
    colorAt: (t, j) => {
      const tb = clamp((t - o.petioleRatio) / Math.max(1e-4, 1 - o.petioleRatio), 0, 1);
      const bladeC = tint(mixRgb(cA, cB, tb * 0.7), BLADE_SHADE[j]);
      const m = smoothstep(o.petioleRatio * 0.7, o.petioleRatio + 0.08, t);
      return mixRgb(tint(cP, 0.9 + 0.1 * t), bladeC, m);
    },
    upHint: UP,
    tile: TILE.leafCross,
    vPerMeter: 1.5,
    vOffset: rng.next(),
    organ: ORGAN.leaf,
    wind: wind(o.pivot, o.phase, o.limbBase, o.limbBase + 0.45, 0.08, 0.8),
    capEnd: true,
    capScale: 1.8,
  };
}

// -----------------------------------------------------------------------------
// Habit: palm
// -----------------------------------------------------------------------------

function buildPalm(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const stems: TubeGrid[] = [];
  if (b.stemCount > 1) {
    const blob = buildCrownBlob(bd, p, rng, b.trunkRadius * 4.2, 0.3);
    for (let i = 0; i < b.stemCount; i++) {
      const az = (i / b.stemCount) * TAU + rng.range(-0.3, 0.3);
      const off = i === 0 ? 0 : rng.range(0.08, 0.22);
      const base = v3(Math.cos(az) * off, 0, Math.sin(az) * off);
      const sub = clonePlant(p);
      sub.botany.trunkHeight = b.trunkHeight * (i === 0 ? 1 : rng.range(0.55, 0.9));
      // Stems are root tubes rising out of the blob's silhouette; weld them in
      // by claiming windows in the blob and bridging their bases manually via
      // a short collar tube — simplest robust route: grow each stem as a tube
      // welded into the blob using weld() with a 12-sided trunk spec.
      const stemGrid = weldStemIntoBlob(bd, sub, rng.fork(), blob, base, az);
      if (stemGrid) stems.push(stemGrid);
    }
  } else {
    stems.push(buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), {
      crownBand: 0.14,
      crownWindows: b.frondCount + b.skirtFronds + b.nutCount,
    }));
  }

  for (const trunk of stems) {
    const total = b.frondCount + b.skirtFronds;
    for (let i = 0; i < total; i++) {
      const dead = i >= b.frondCount;
      const age = dead ? 1 + (i - b.frondCount + 1) / Math.max(1, b.skirtFronds) : b.frondCount <= 1 ? 0 : i / (b.frondCount - 1);
      const az = i * b.phyllotaxis * DEG + rng.bell() * 0.06;
      let elevation: number;
      if (dead) elevation = rng.range(-1.45, -1.22);
      else {
        const topEl = 80 * DEG;
        elevation = topEl - b.crownSpread * DEG * Math.pow(age, 0.8);
      }
      buildFrond(bd, p, rng.fork(), trunk, age, az, elevation, dead);
    }
    buildNuts(bd, p, rng.fork(), trunk);
    buildStiltRoots(bd, p, rng.fork(), trunk);
  }
}

function clonePlant(p: PlantParams): PlantParams {
  return JSON.parse(JSON.stringify(p)) as PlantParams;
}

/** Weld a 12-sided clustering stem (full palm trunk) into the root crown. */
function weldStemIntoBlob(bd: PlantBuilder, p: PlantParams, rng: Random, blob: TubeGrid, base: V3, az: number): TubeGrid | null {
  const b = p.botany;
  const H = Math.max(0.4, b.trunkHeight);
  const lean = v3(Math.cos(az), 0, Math.sin(az));
  const dir0 = normalize(v3(lean.x * 0.22, 1, lean.z * 0.22));
  const origin = addScaled(base, dir0, 0.1);
  origin.y = 0.16;
  const spine: V3[] = [];
  const curveAmt = b.trunkCurve * H * 0.14;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    spine.push(v3(origin.x + lean.x * curveAmt * t * t, origin.y + t * H, origin.z + lean.z * curveAmt * t * t));
  }
  // Ring layout mirrors buildTrunk.
  const ringSet = new Set<number>();
  for (let i = 0; i <= 16; i++) ringSet.add((i / 16) * 0.86);
  const crownRings = (b.frondCount + b.skirtFronds + b.nutCount) * 2 + 8;
  for (let i = 0; i <= crownRings; i++) ringSet.add(0.86 + (i / crownRings) * 0.14);
  const ringTs = [...ringSet].sort((a, c) => a - c);
  const cA = col(b.trunkColor);
  const cB = col(b.trunkColor2);
  const seed = rng.range(0, 30);
  const sides = 12;
  const spec: TubeSpec = {
    spine,
    ringTs,
    sides,
    profileAt: (t, out) => {
      const dist = t * H;
      let r = b.trunkRadius * (1 - 0.2 * t) * (1 + 0.5 * Math.exp(-t * 10));
      if (b.ringFrequency > 0) {
        const ph = 0.5 + 0.5 * Math.cos(dist * b.ringFrequency * TAU);
        r *= 1 - b.ringDepth * 0.05 * Math.pow(1 - ph, 1.6);
      }
      r *= 1 - smoothstep(0.985, 1, t) * 0.5;
      circleInto(out, sides, Math.max(0.01, r), Math.max(0.01, r));
    },
    colorAt: (t, j) => {
      const dist = t * H;
      let c = mixRgb(cA, cB, smoothstep(0.5, 1, t));
      if (b.ringFrequency > 0) {
        const ph = 0.5 + 0.5 * Math.cos(dist * b.ringFrequency * TAU);
        c = tint(c, 1 - b.ringDepth * 0.3 * Math.pow(1 - ph, 1.5));
      }
      return tint(c, 1 + 0.14 * noise3(j * 1.3 + seed, dist * 3, seed));
    },
    upHint: v3(1, 0, 0),
    tile: TILE.bark,
    vPerMeter: 0.7,
    organ: ORGAN.trunk,
    wind: NO_WIND(base),
    capEnd: true,
    capScale: 0.55,
  };
  // 12 sides → window 2(w+h)=12 → w=3, h=3 on the 20-sided blob.
  return bd.weld(blob, 0.62, dir0, 3, 3, spec, { collarRings: 2, collarScale: 0.5, margin: 0, search: 6 });
}

// -----------------------------------------------------------------------------
// Habit: paddle (banana family)
// -----------------------------------------------------------------------------

function buildPaddle(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const isBanana = b.bladeWidth > 0.5 && b.trunkHeight > 1;
  const trunks: TubeGrid[] = [];
  if (b.stemCount > 1) {
    const blob = buildCrownBlob(bd, p, rng, b.trunkRadius * 2.6, 0.26);
    for (let i = 0; i < b.stemCount; i++) {
      const az = (i / b.stemCount) * TAU + rng.range(-0.35, 0.35);
      const off = i === 0 ? 0 : rng.range(0.1, 0.3);
      const base = v3(Math.cos(az) * off, 0, Math.sin(az) * off);
      const sub = clonePlant(p);
      sub.botany.trunkHeight = b.trunkHeight * (i === 0 ? 1 : rng.range(0.45, 0.85));
      const g = weldStemIntoBlob(bd, sub, rng.fork(), blob, base, az);
      if (g) trunks.push(g);
    }
  } else if (b.trunkHeight > 0.35) {
    trunks.push(buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), {
      crownBand: 0.12,
      crownWindows: b.frondCount + 2,
    }));
  } else {
    trunks.push(buildCrownBlob(bd, p, rng, b.trunkRadius * 1.5, Math.max(0.18, b.trunkHeight)));
  }

  for (const trunk of trunks) {
    for (let i = 0; i < b.frondCount; i++) {
      const age = b.frondCount <= 1 ? 0.5 : i / (b.frondCount - 1);
      const az = i * b.phyllotaxis * DEG + rng.bell() * 0.05;
      const attachT = 0.99 - age * 0.09;
      const el = (82 - b.crownSpread * Math.pow(age, 0.85)) * DEG;
      const dir0 = dirFromAzEl(az, el);
      const f = bd.frameAt(trunk, clamp(attachT, 0.4, 0.999));
      const origin = addScaled(f.center, dir0, f.radius * 0.85);
      const fresh = mixRgb(col(b.leafColor), col(b.leafColor2), (1 - age) * 0.5);
      const spec = bladeLeafSpec(origin, dir0, {
        len: b.leafLength * (0.55 + 0.45 * smoothstep(0, 0.3, age)) * rng.range(0.92, 1.05),
        width: b.bladeWidth * rng.range(0.92, 1.06),
        petioleRatio: b.petioleRatio,
        arc: b.bladeArc * lerp(0.4, 1.2, age),
        bladeEl: (90 - b.bladePitch) * DEG * 0.55 + el * 0.45,
        notch: b.bladeNotch,
        lobes: b.bladeLobes,
        unfurl: i === 0 ? 0.12 : smoothstep(0.02, 0.18, age), // youngest = rolled cigar
        colorA: fresh,
        colorB: mixRgb(fresh, [0.7, 0.64, 0.22], age * age * 0.45),
        petioleColor: col(b.rachisColor),
        pivot: origin,
        phase: rng.next(),
        limbBase: 0,
        rings: Math.round(p.mesh.bladeRings * p.mesh.quality),
        petioleR: clamp(b.leafLength * 0.012, 0.012, 0.045),
      }, rng.fork());
      bd.weld(trunk, attachT, dir0, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale });
    }
    buildStiltRoots(bd, p, rng.fork(), trunk);
  }

  if (b.nutCount > 0 && trunks.length) {
    if (isBanana) buildBananaBunch(bd, p, rng.fork(), trunks[0]);
    else for (let i = 0; i < b.nutCount; i++) buildCraneFlower(bd, p, rng.fork(), trunks[0]);
  }
}

/** Hanging banana bunch + heart as one welded organ. */
function buildBananaBunch(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const az = rng.range(0, TAU);
  const dir0 = dirFromAzEl(az, 0.5);
  const f = bd.frameAt(trunk, 0.97);
  const origin = addScaled(f.center, dir0, f.radius * 0.8);
  // Arch out, then hang straight down.
  const spine = bendSpine(origin, dir0, 1.15, 14, (s) => -(2.0 / 1.15) * smoothstep(0.05, 0.5, s));
  const cFruit = col(b.nutColor);
  const cBell = col(b.nutColor2);
  const cStalk = col(b.rachisColor);
  const spec: TubeSpec = {
    spine,
    ringTs: evenRings(30),
    sides: 10,
    profileAt: (t, out) => {
      let r = 0.022;
      if (t > 0.42 && t < 0.8) {
        // Tiered bunch of fingers: stacked bulges.
        const bt = (t - 0.42) / 0.38;
        r = b.nutSize * 0.62 * Math.pow(Math.sin(Math.PI * (0.15 + 0.7 * bt)), 0.6) * (1 + 0.16 * Math.sin(bt * 9 * TAU * 0.5));
      } else if (t >= 0.8) {
        const ht = (t - 0.8) / 0.2;
        r = b.nutSize * 0.5 * Math.pow(Math.sin(Math.PI * (0.2 + 0.62 * ht)), 0.8); // heart / bell
      }
      r *= 1 + 0.5 * Math.exp(-t * 16);
      circleInto(out, 10, Math.max(0.005, r), Math.max(0.005, r));
    },
    colorAt: (t) => {
      if (t < 0.4) return cStalk;
      if (t < 0.8) return tint(cFruit, 0.9 + 0.1 * Math.sin(t * 40));
      return tint(cBell, 0.85 + 0.3 * (t - 0.8) * 5);
    },
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.6,
    organ: ORGAN.fruit,
    wind: wind(origin, rng.next(), 0.1, 0.35, 0.02, 0.1),
    capEnd: true,
    capScale: 0.8,
  };
  bd.weld(trunk, 0.97, dir0, 2, 3, spec, { collarRings: 1, collarScale: 0.6, margin: 0 });
}

/** Bird-of-paradise crane flower (or heliconia bract stalk): stalk + boat bract + crest spikes. */
function buildCraneFlower(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const az = rng.range(0, TAU);
  const dir0 = dirFromAzEl(az, rng.range(0.9, 1.25));
  const f = bd.frameAt(trunk, 0.85);
  const origin = addScaled(f.center, dir0, f.radius * 0.8);
  const stalkLen = b.leafLength * rng.range(0.55, 0.75);
  const spine = bendSpine(origin, dir0, stalkLen, 8, () => 0.02 / stalkLen);
  const cStalk = col(b.rachisColor);
  const stalk = bd.weld(trunk, 0.85, dir0, 2, 2, {
    spine,
    ringTs: evenRings(10),
    sides: 8,
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.006, 0.014 * (1 - t * 0.4)), Math.max(0.006, 0.014 * (1 - t * 0.4))),
    colorAt: () => cStalk,
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.2,
    organ: ORGAN.rachis,
    wind: wind(origin, rng.next(), 0, 0.3, 0, 0.2),
    capEnd: true,
  }, { collarRings: 1, collarScale: 0.6, margin: 0 });
  if (!stalk) return;
  const tip = bd.frameAt(stalk, 1);
  // Boat bract: a blade-lens held up at an angle.
  const bractDir = normalize(addScaled(tip.T, tip.U, 0.5));
  const cSepal = col(b.nutColor);
  const cPetal = col(b.nutColor2);
  const bractC = mixRgb(col(b.leafColor), cSepal, 0.45);
  const bract = leafletSpec(tip.center, bractDir, tip.V, {
    len: b.nutSize * 1.5, width: b.nutSize * 0.5, droop: 0.12, twistRad: 0,
    colorA: bractC, colorB: cSepal, windPhase: rng.next(), pivot: origin, limbBase: 0.3, rings: 7, fold: 0.8, organ: ORGAN.fruit, tile: TILE.leafLong,
  }, rng.fork());
  bd.weld(stalk, 0.93, bractDir, 1, 2, bract, { collarRings: 0, collarScale: 0.5, margin: 0 });
  // Crest: three orange sepals + one blue petal tongue.
  for (let i = 0; i < 4; i++) {
    const spread = (i - 1.5) * 0.3;
    const dir = normalize(add(addScaled(tip.T, tip.V, 1.1), scale(tip.U, spread)));
    const isPetal = i === 3;
    const sp = leafletSpec(tip.center, dir, tip.U, {
      len: b.nutSize * (isPetal ? 0.85 : 1.05), width: b.nutSize * 0.3, droop: 0.3, twistRad: 0.4,
      colorA: isPetal ? cPetal : cSepal, colorB: isPetal ? tint(cPetal, 1.2) : tint(cSepal, 1.15),
      windPhase: rng.next(), pivot: origin, limbBase: 0.35, rings: 6, fold: 0.5, organ: ORGAN.fruit, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(stalk, 0.97, dir, 1, 2, sp, { collarRings: 0, collarScale: 0.5, margin: 0 });
  }
}

// -----------------------------------------------------------------------------
// Habit: rosette (big-leaf plants, optional climbing stem)
// -----------------------------------------------------------------------------

function buildRosette(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  let stem: TubeGrid;
  const climbing = b.stemClimb > 0.05 && b.trunkHeight > 0.6;
  if (climbing) {
    // Winding monstera stem: zig-zag nodes climbing up.
    const H = b.trunkHeight;
    const nodes = Math.max(6, b.frondCount + 2);
    const spine: V3[] = [v3(0, -0.1, 0)];
    let az = rng.range(0, TAU);
    for (let i = 1; i <= nodes; i++) {
      az += Math.PI + rng.bell() * 0.5;
      const t = i / nodes;
      spine.push(v3(Math.cos(az) * 0.09 * (1 - t * 0.4), t * H, Math.sin(az) * 0.09 * (1 - t * 0.4)));
    }
    const ringSet = new Set<number>(evenRings(14));
    for (let i = 0; i < b.frondCount; i++) {
      const t = 0.14 + (i / Math.max(1, b.frondCount - 1)) * 0.82;
      ringSet.add(t - 0.012); ringSet.add(t); ringSet.add(t + 0.012);
    }
    const cS = col(b.trunkColor);
    stem = bd.tube({
      spine,
      ringTs: [...ringSet].sort((a, c) => a - c),
      sides: Math.max(10, p.mesh.trunkSides),
      profileAt: (t, out) => {
        const node = 1 + 0.3 * Math.pow(0.5 + 0.5 * Math.cos(t * nodes * TAU), 2);
        circleInto(out, Math.max(10, p.mesh.trunkSides), b.trunkRadius * node * (1 - t * 0.25), b.trunkRadius * node * (1 - t * 0.25));
      },
      colorAt: (t) => tint(cS, 0.8 + 0.25 * t),
      upHint: v3(1, 0, 0),
      tile: TILE.stem,
      vPerMeter: 1,
      organ: ORGAN.trunk,
      wind: NO_WIND(v3(0, 0, 0)),
      capStart: true,
      capEnd: true,
    });
  } else {
    stem = b.trunkHeight > 0.35
      ? buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), { crownBand: 0.35, crownWindows: b.frondCount })
      : buildCrownBlob(bd, p, rng, b.trunkRadius * 1.6, Math.max(0.16, b.trunkHeight));
  }

  for (let i = 0; i < b.frondCount; i++) {
    const age = b.frondCount <= 1 ? 0.5 : i / (b.frondCount - 1);
    const az = i * b.phyllotaxis * DEG + rng.bell() * 0.12;
    const attachT = climbing ? 0.14 + age * 0.82 : 0.6 + (1 - age) * 0.3;
    const el = lerp(0.5, 1.25, 1 - age) * (climbing ? 0.75 : 1);
    const dir0 = dirFromAzEl(az, el);
    const f = bd.frameAt(stem, clamp(attachT, 0.05, 0.999));
    const origin = addScaled(f.center, dir0, f.radius * 0.8);
    const fresh = mixRgb(col(b.leafColor), col(b.leafColor2), (1 - age) * 0.4);
    const spec = bladeLeafSpec(origin, dir0, {
      len: b.leafLength * (0.5 + 0.5 * smoothstep(0, 0.35, age) + (climbing ? age * 0.25 : 0)) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc,
      bladeEl: (90 - b.bladePitch) * DEG,
      notch: b.bladeNotch * smoothstep(0.15, 0.45, age), // juvenile leaves un-notched
      lobes: b.bladeLobes,
      unfurl: smoothstep(0, 0.1, age),
      colorA: fresh,
      colorB: mixRgb(fresh, [0.68, 0.6, 0.2], Math.pow(1 - age, 2) * 0.3),
      petioleColor: col(b.rachisColor),
      pivot: origin,
      phase: rng.next(),
      limbBase: climbing ? 0.1 : 0,
      rings: Math.round(p.mesh.bladeRings * p.mesh.quality),
      petioleR: clamp(b.leafLength * 0.011, 0.008, 0.03),
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(stem, attachT, dir0, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale });
  }
  buildStiltRoots(bd, p, rng.fork(), stem);
}

// -----------------------------------------------------------------------------
// Habit: branching tree
// -----------------------------------------------------------------------------

interface BranchCtx {
  len: number;
  radius: number;
  level: number;
}

function buildBranching(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const trunk = buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), {
    crownBand: 0.1,
    crownWindows: Math.round(b.branchCount) + 2,
    branchBand: [0.55, 0.98],
  });
  const tips: { grid: TubeGrid; phase: number }[] = [];
  growBranches(bd, p, rng, trunk, { len: b.trunkHeight * 0.85, radius: b.trunkRadius, level: 0 }, tips, true);
  buildStiltRoots(bd, p, rng.fork(), trunk);

  // Frangipani flower clusters on some tips.
  if (b.nutCount > 0) {
    const cPetal = col(b.nutColor);
    const cHeart = col(b.nutColor2);
    const chosen = tips.filter((_, i) => i % Math.max(1, Math.floor(tips.length / Math.max(1, b.nutCount))) === 0).slice(0, b.nutCount * 2);
    for (const tip of chosen) {
      const f = bd.frameAt(tip.grid, 0.99);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        const radial = normalize(addScaled(scale(f.U, Math.cos(a)), f.V, Math.sin(a)));
        const dir = normalize(addScaled(scale(radial, 0.95), f.T, 0.4));
        const sp = leafletSpec(f.center, dir, radial, {
          len: b.nutSize, width: b.nutSize * 0.55, droop: 0.25, twistRad: 0.5,
          colorA: cHeart, colorB: cPetal, windPhase: tip.phase, pivot: f.center, limbBase: 0.5, rings: 6, fold: 0.35, organ: ORGAN.fruit, tile: TILE.leafLong,
        }, rng.fork());
        bd.weld(tip.grid, 0.99, dir, 1, 2, sp, { collarRings: 0, collarScale: 0.4, margin: 0 });
      }
    }
  }
}

function growBranches(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, ctx: BranchCtx, tips: { grid: TubeGrid; phase: number }[], isTrunk: boolean): void {
  const b = p.botany;
  if (ctx.level >= b.branchLevels) {
    placeLeaves(bd, p, rng, parent, true);
    tips.push({ grid: parent, phase: rng.next() });
    return;
  }
  const count = Math.max(2, Math.round(b.branchCount * rng.range(0.75, 1.25)));
  const lo = isTrunk ? 0.6 : 0.35;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.97 : lerp(lo, 0.98, Math.pow(i / (count - 1), 0.8)) + rng.bell() * 0.02;
    const f = bd.frameAt(parent, clamp(t, 0.05, 0.99));
    const az = rng.range(0, TAU);
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const spread = b.branchAngle * DEG * rng.range(0.8, 1.2);
    const dir = normalize(addScaled(scale(f.T, Math.cos(spread)), radial, Math.sin(spread)));
    const len = ctx.len * rng.range(0.62, 0.8);
    const radius = Math.max(0.008, ctx.radius * b.branchTaper * rng.range(0.85, 1.05));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const child = buildBranch(bd, p, rng.fork(), parent, origin, dir, len, radius, ctx.level + 1, t);
    if (child) growBranches(bd, p, rng.fork(), child, { len, radius, level: ctx.level + 1 }, tips, false);
  }
  // Leaves along the outer half of mid-level branches too (ficus-like fullness).
  if (ctx.level >= b.branchLevels - 1 && !isTrunk) placeLeaves(bd, p, rng, parent, false);
  if (isTrunk && b.branchLevels <= 2) placeLeaves(bd, p, rng, parent, false);
}

function buildBranch(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, origin: V3, dir: V3, len: number, radius: number, level: number, attachT: number): TubeGrid | null {
  const b = p.botany;
  // Branches curve upward a little (gravitropism), tips sweep out.
  const spine = bendSpine(origin, dir, len, 14, (s) => (0.22 / len) * (1 - s) - 0.1 / len * s, () => rng.bell() * 0.05 / len);
  const sides = level === 1 ? 10 : 8;
  // Dense enough rings for child windows + leaf windows.
  const wantRings = Math.round((level < b.branchLevels ? 40 : 26) * p.mesh.quality);
  const cA = tint(col(b.trunkColor), 1 - level * 0.04);
  const cB = tint(col(b.trunkColor2), 1.05);
  const phase = rng.next();
  const spec: TubeSpec = {
    spine,
    ringTs: evenRings(Math.max(10, wantRings)),
    sides,
    profileAt: (t, out) => {
      const r = Math.max(0.004, radius * Math.pow(1 - t, 0.5) * (1 + 0.4 * Math.exp(-t * 8)));
      circleInto(out, sides, r, r * 0.96);
    },
    colorAt: (t, j) => tint(mixRgb(cA, cB, t), 1 + 0.1 * noise3(j * 1.4, t * len * 6, level * 7)),
    upHint: UP,
    tile: TILE.bark,
    vPerMeter: 0.9,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.08 * level, 0.12 + 0.22 * level, 0, 0.12 * level),
    capEnd: true,
    capScale: 0.8,
  };
  const w = sides === 10 ? 2 : 2;
  const h = sides === 10 ? 3 : 2;
  return bd.weld(parent, attachT, dir, w, h, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale });
}

/** Cluster leaves at a branch tip (or scattered along it). */
function placeLeaves(bd: PlantBuilder, p: PlantParams, rng: Random, branch: TubeGrid, atTip: boolean): void {
  const b = p.botany;
  const n = Math.round(b.leavesPerTip * (atTip ? 1 : 0.7));
  for (let i = 0; i < n; i++) {
    const t = atTip ? rng.range(0.76, 0.99) : rng.range(0.45, 0.95);
    const f = bd.frameAt(branch, t);
    const az = rng.range(0, TAU);
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const dir = normalize(addScaled(scale(f.T, rng.range(0.3, 0.7)), radial, 1));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const cA = mixRgb(col(b.leafColor), col(b.leafColor2), rng.next() * 0.5);
    if (b.compoundLeaf === 'palmate') buildUmbrellaLeaf(bd, p, rng.fork(), branch, origin, dir, t, cA);
    else {
      const spec = bladeLeafSpec(origin, dir, {
        len: b.leafLength * rng.range(0.85, 1.1),
        width: b.bladeWidth * rng.range(0.9, 1.08),
        petioleRatio: b.petioleRatio,
        arc: b.bladeArc,
        bladeEl: (90 - b.bladePitch) * DEG,
        notch: b.bladeNotch,
        lobes: b.bladeLobes,
        unfurl: 1,
        colorA: cA,
        colorB: tint(cA, 1.12),
        petioleColor: col(b.rachisColor),
        pivot: origin,
        phase: rng.next(),
        limbBase: 0.35,
        rings: Math.round(p.mesh.bladeRings * 0.7 * p.mesh.quality),
        petioleR: clamp(b.leafLength * 0.014, 0.004, 0.012),
      }, rng.fork());
      spec.tile = TILE.leafLong;
      // Blade tubes are 10-sided → window 2×3.
      bd.weld(branch, t, dir, 2, 3, spec, { collarRings: Math.min(1, p.mesh.collarRings), collarScale: 0.6, margin: 0 });
    }
  }
}

/** Schefflera umbrella: long petiole with leaflets radiating from its tip. */
function buildUmbrellaLeaf(bd: PlantBuilder, p: PlantParams, rng: Random, branch: TubeGrid, origin: V3, dir: V3, attachT: number, cA: RGB): void {
  const b = p.botany;
  const petLen = b.leafLength * b.petioleRatio;
  const spine = bendSpine(origin, dir, petLen, 6, () => 0.05 / petLen);
  const phase = rng.next();
  const pet = bd.weld(branch, attachT, dir, 2, 2, {
    spine,
    ringTs: evenRings(9),
    sides: 8,
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.003, 0.006 * (1 - t * 0.3)), Math.max(0.003, 0.006 * (1 - t * 0.3))),
    colorAt: () => col(b.rachisColor),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.2,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.3, 0.5, 0.05, 0.2),
    capEnd: true,
    capScale: 0.6,
  }, { collarRings: 0, collarScale: 0.5, margin: 0 });
  if (!pet) return;
  const tip = bd.frameAt(pet, 1);
  const count = 7 + Math.floor(rng.next() * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng.bell() * 0.15;
    const radial = normalize(addScaled(scale(tip.U, Math.cos(a)), tip.V, Math.sin(a)));
    const ldir = normalize(addScaled(scale(radial, 1), tip.T, rng.range(0.05, 0.4)));
    const cL = mixRgb(cA, col(b.leafColor2), rng.next() * 0.4);
    const sp = leafletSpec(tip.center, ldir, tip.T, {
      len: b.leafLength * (1 - b.petioleRatio) * rng.range(0.85, 1.1),
      width: b.bladeWidth * 0.24,
      droop: b.bladeArc * 0.8,
      twistRad: 0.3,
      colorA: cL, colorB: tint(cL, 1.1),
      windPhase: phase, pivot: origin, limbBase: 0.5, rings: 8, fold: 0.55, organ: ORGAN.leaf, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(pet, i % 2 === 0 ? 0.9 : 0.99, ldir, 2, 1, sp, { collarRings: 0, collarScale: 0.5, margin: 0 });
  }
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

export function generatePlant(params: PlantParams): GenerateResult {
  const t0 = performance.now();
  const rng = new Random(params.seed * 2654435761 + 12345);
  const bd = new PlantBuilder();
  switch (params.habit) {
    case 'palm':
      buildPalm(bd, params, rng);
      break;
    case 'paddle':
      buildPaddle(bd, params, rng);
      break;
    case 'rosette':
      buildRosette(bd, params, rng);
      break;
    case 'branching':
      buildBranching(bd, params, rng);
      break;
  }
  const t1 = performance.now();
  const { mesh, height, stats } = bd.finalize();
  const t2 = performance.now();
  return { mesh, height, stats, timings: { build: t1 - t0, total: t2 - t0 } };
}

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

function bladeInto(out: ProfilePt[], halfWL: number, halfWR: number, archH: number, keelH: number, petR: number, blade: number, marginWave: number, hang: number): void {
  for (let j = 0; j < 10; j++) {
    const [bx, by, u] = BLADE_PTS[j];
    const a = (j / 10) * TAU;
    const cx = Math.cos(a) * petR;
    const cy = Math.sin(a) * petR * 0.9;
    const hw = bx >= 0 ? halfWR : halfWL;
    let px = bx * hw;
    let py = by * (by >= 0 ? archH : keelH);
    // Banana vee: lamina halves hang down either side of the midrib.
    py -= by >= 0 ? hang * Math.pow(Math.abs(bx), 1.6) * hw : hang * Math.abs(bx) * hw * 0.35;
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
function bladeWidthAt(tb: number, lobes: number, peakIn = 0.38): number {
  const peak = clamp(peakIn, 0.15, 0.8);
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

/** Ripeness colour ramp for dates: green -> gold -> orange -> deep brown-red. */
function dateColor(ripe: number, cOrange: RGB, cBrown: RGB): RGB {
  const green: RGB = [0.32, 0.42, 0.12];
  const gold: RGB = [0.85, 0.62, 0.16];
  if (ripe < 0.4) return mixRgb(green, gold, ripe / 0.4);
  if (ripe < 0.75) return mixRgb(gold, cOrange, (ripe - 0.4) / 0.35);
  return mixRgb(cOrange, cBrown, (ripe - 0.75) / 0.25);
}

/**
 * Hanging date bunches: a thick stalk arcs out from the frond axils and
 * branches into dozens of strands, each strand carrying a row of individual
 * welded dates in mixed ripeness. Used by date / queen / foxtail palms.
 */
function buildDateBunches(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const bunches = clamp(Math.round(b.nutCount), 0, 6);
  if (bunches <= 0) return;
  const cOrange = col(b.nutColor);
  const cBrown = col(b.nutColor2);
  const cStalk = mixRgb(col(b.rachisColor), cOrange, 0.35);
  const fruitLen = Math.max(0.02, b.nutSize);
  const strandCount = Math.round(30 * clamp(p.mesh.quality, 0.7, 1.3));

  for (let bi = 0; bi < bunches; bi++) {
    const az = (bi / bunches) * TAU + rng.range(0, 1.2);
    const attachT = 0.865 + rng.next() * 0.03;
    const dir0 = dirFromAzEl(az, rng.range(-0.5, -0.22));
    const f = bd.frameAt(trunk, attachT);
    const origin = addScaled(f.center, dir0, f.radius * 0.8);
    const stalkLen = clamp(0.5 + fruitLen * 10, 0.65, 1.3) * rng.range(0.9, 1.1);
    // Arc outward, then hang under gravity.
    const spine = bendSpine(origin, dir0, stalkLen, 16, (s) => -(1.9 / stalkLen) * smoothstep(0.08, 0.55, s));
    // Ring layout: sparse neck, dense fruiting section (strand windows live there).
    const ringTs: number[] = [];
    for (let i = 0; i <= 6; i++) ringTs.push((i / 6) * 0.35);
    const nDense = 38;
    for (let i = 1; i <= nDense; i++) ringTs.push(0.35 + (i / nDense) * 0.65);
    const stalk = bd.weld(trunk, attachT, dir0, 2, 3, {
      spine,
      ringTs,
      sides: 10,
      profileAt: (t, out) => {
        const r = Math.max(0.005, 0.02 * (1 - t * 0.55) * (1 + 0.9 * Math.exp(-t * 12)));
        circleInto(out, 10, r, r * 0.95);
      },
      colorAt: (t, j) => tint(mixRgb(cStalk, tint(cOrange, 0.85), smoothstep(0.3, 1, t)), 1 + 0.1 * noise3(j * 1.9, t * 14 + bi * 7, bi)),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 1.4,
      organ: ORGAN.fruit,
      wind: wind(origin, rng.next(), 0.08, 0.3, 0.02, 0.12),
      capEnd: true,
      capScale: 0.7,
    }, { collarRings: 1, collarScale: 0.6, margin: 0 });
    if (!stalk) continue;

    const phase = rng.next();
    for (let si = 0; si < strandCount; si++) {
      const st = 0.4 + (si / Math.max(1, strandCount - 1)) * 0.57 + rng.bell() * 0.01;
      const sf = bd.frameAt(stalk, clamp(st, 0.05, 0.99));
      // Strands pour downward/outward around the bunch axis.
      const sang = rng.range(0, TAU);
      const radial = normalize(addScaled(scale(sf.U, Math.cos(sang)), sf.V, Math.sin(sang)));
      const sdir = normalize(add(addScaled(sf.T, radial, rng.range(0.35, 0.85)), v3(0, -rng.range(0.25, 0.6), 0)));
      const sOrigin = addScaled(sf.center, sdir, sf.radius * 0.85);
      // Middle strands longest -> classic pear-shaped bunch.
      const bunchShape = 0.55 + 0.6 * Math.sin(Math.PI * clamp((st - 0.35) / 0.65, 0, 1));
      const sLen = stalkLen * 0.42 * bunchShape * rng.range(0.85, 1.15);
      const sSpine = bendSpine(sOrigin, sdir, sLen, 7, (s) => -(0.8 / sLen) * s);
      const strand = bd.weld(stalk, st, sdir, 1, 2, {
        spine: sSpine,
        ringTs: evenRings(20),
        sides: 6,
        profileAt: (t, out) => {
          const r = Math.max(0.0016, 0.0035 * (1 - t * 0.5) * (1 + 0.6 * Math.exp(-t * 10)));
          circleInto(out, 6, r, r);
        },
        colorAt: (t) => tint(mixRgb(cStalk, cOrange, 0.4 + 0.4 * t), 0.9 + 0.15 * t),
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 2,
        organ: ORGAN.fruit,
        wind: wind(origin, phase, 0.3, 0.5, 0.08, 0.3),
        capEnd: true,
        capScale: 0.8,
      }, { collarRings: 0, collarScale: 0.5, margin: 0 });
      if (!strand) continue;

      // A row of individual dates down each strand, ripening unevenly.
      const dates = 6 + Math.floor(rng.next() * 3);
      for (let di = 0; di < dates; di++) {
        const dt = 0.18 + (di / dates) * 0.8 + rng.bell() * 0.015;
        const df = bd.frameAt(strand, clamp(dt, 0.05, 0.99));
        const dang = di * 2.4 + rng.range(0, TAU) * 0.3 + si;
        const dradial = normalize(addScaled(scale(df.U, Math.cos(dang)), df.V, Math.sin(dang)));
        const ddir = normalize(add(addScaled(df.T, dradial, 0.9), v3(0, -0.55, 0)));
        const dOrigin = addScaled(df.center, ddir, df.radius * 0.8);
        const dLen = fruitLen * rng.range(0.85, 1.15);
        const dRad = dLen * 0.23;
        const ripe = clamp(rng.next() * 0.85 + dt * 0.18 + (rng.next() < 0.18 ? 0.35 : 0), 0, 1);
        const cD = dateColor(ripe, cOrange, cBrown);
        const dSpine = [dOrigin, addScaled(dOrigin, ddir, dLen * 0.55), addScaled(addScaled(dOrigin, ddir, dLen), v3(0, -1, 0), dLen * 0.08)];
        bd.weld(strand, dt, ddir, 1, 2, {
          spine: dSpine,
          ringTs: evenRings(5),
          sides: 6,
          profileAt: (t, out) => {
            // Elongated berry: plump shoulder, gentle point at the blossom end.
            const egg = Math.pow(Math.sin(Math.PI * (0.12 + 0.8 * t)), 0.55) * (0.35 + 0.65 * smoothstep(0, 0.18, t));
            circleInto(out, 6, Math.max(0.0012, dRad * egg), Math.max(0.0012, dRad * egg * 0.96));
          },
          colorAt: (t, j) => tint(cD, (0.82 + 0.18 * t) * (1 + 0.07 * noise3(j * 2.1, t * 5 + di * 3 + si, si * 2))),
          upHint: UP,
          tile: TILE.stem,
          vPerMeter: 3,
          organ: ORGAN.fruit,
          wind: wind(origin, phase, 0.5, 0.62, 0.15, 0.4),
          capEnd: true,
          capScale: 0.45,
        }, { collarRings: 0, collarScale: 0.45, margin: 0 });
      }
    }
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
    const t = clamp(p.roots.stiltHeight * (0.25 + 1.35 * (n <= 1 ? 0.5 : i / (n - 1))) * rng.range(0.9, 1.1), 0.03, 0.85);
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
  /** Widest point of the blade, 0..1 along the blade. */
  peak?: number;
  /** Blade halves hang from the midrib (banana), 0..1. */
  vee?: number;
  /** Perpendicular wind-tears to the midrib (banana/traveller's), 0..1. */
  tears?: number;
  /** Marginal split count per side (monstera / philodendron). */
  notchCount?: number;
  /** Wrinkled geniculum joint where petiole meets blade (monstera). */
  geniculum?: boolean;
  /** Frame up hint; default world up. Fan plants pass the fan-plane normal. */
  upHint?: V3;
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
    const count = o.notchCount ?? 4 + Math.floor(rng.next() * 2);
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
  // Banana wind-tears: many narrow cuts running from margin to midrib.
  const tearsL: number[] = [];
  const tearsR: number[] = [];
  const tears = o.tears ?? 0;
  if (tears > 0.02) {
    const count = Math.round(6 + tears * 12);
    for (let i = 0; i < count; i++) {
      tearsL.push(0.08 + ((i + rng.range(0.1, 0.9)) / count) * 0.86);
      tearsR.push(0.08 + ((i + rng.range(0.1, 0.9)) / count) * 0.86);
    }
  }
  const tearDepth = (tb: number, list: number[]): number => {
    if (!list.length) return 0;
    let d = 0;
    for (const c of list) d = Math.max(d, Math.exp(-Math.pow((tb - c) / 0.02, 2)));
    return d * (0.5 + 0.45 * tears) * smoothstep(0.04, 0.18, tb) * (1 - smoothstep(0.88, 1, tb));
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
      const wShape = bladeWidthAt(tb, o.lobes, o.peak ?? 0.38);
      const halfW = (o.width / 2) * wShape * (0.12 + 0.88 * o.unfurl);
      const halfWL = halfW * (1 - clamp(notchDepth(tb, notchesL) + tearDepth(tb, tearsL), 0, 0.96));
      const halfWR = halfW * (1 - clamp(notchDepth(tb, notchesR) + tearDepth(tb, tearsR), 0, 0.96));
      const archH = Math.max(0.0012, halfW * 0.16 + 0.001);
      const keelH = Math.max(0.0012, o.petioleR * (1 - tb * 0.75) + halfW * 0.05);
      let petR = o.petioleR * (1 - t * 0.45) * (1 + 0.5 * Math.exp(-t * 14));
      if (o.geniculum) petR *= 1 + 0.4 * Math.exp(-Math.pow((t - o.petioleRatio) / 0.018, 2));
      const wave = Math.sin(tb * waveFreq * TAU * 0.5 + wavePhase) * halfW * 0.06 * blade;
      const hang = (o.vee ?? 0) * 0.55 * blade;
      bladeInto(out, Math.max(0.0012, halfWL), Math.max(0.0012, halfWR), archH, keelH, petR, blade, wave, hang);
    },
    colorAt: (t, j) => {
      const tb = clamp((t - o.petioleRatio) / Math.max(1e-4, 1 - o.petioleRatio), 0, 1);
      const bladeC = tint(mixRgb(cA, cB, tb * 0.7), BLADE_SHADE[j]);
      const m = smoothstep(o.petioleRatio * 0.7, o.petioleRatio + 0.08, t);
      return mixRgb(tint(cP, 0.9 + 0.1 * t), bladeC, m);
    },
    upHint: o.upHint ?? UP,
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
    if (b.fruitStyle === 'dates') buildDateBunches(bd, p, rng.fork(), trunk);
    else buildNuts(bd, p, rng.fork(), trunk);
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
  const crownRings = (b.frondCount + b.skirtFronds + b.nutCount + 7) * 2 + 8;
  for (let i = 0; i <= crownRings; i++) ringSet.add(0.86 + (i / crownRings) * 0.14);
  const ringTs = [...ringSet].sort((a, c) => a - c);
  const cA = col(b.trunkColor);
  const cB = col(b.trunkColor2);
  const seed = rng.range(0, 30);
  const sides = 12;
  // Banana-family pseudostems are not wood: they are tight rolls of leaf
  // sheaths — smooth, waxy green, vertically striped, browning at the foot.
  const pseudo = p.habit === 'paddle';
  const cDead = col(b.deadColor);
  const spec: TubeSpec = {
    spine,
    ringTs,
    sides,
    profileAt: (t, out) => {
      const dist = t * H;
      let r = b.trunkRadius * (1 - 0.2 * t) * (1 + 0.5 * Math.exp(-t * 10));
      if (pseudo) r = b.trunkRadius * (1 - 0.1 * t) * (1 + 0.45 * Math.exp(-t * 7));
      else if (b.ringFrequency > 0) {
        const ph = 0.5 + 0.5 * Math.cos(dist * b.ringFrequency * TAU);
        r *= 1 - b.ringDepth * 0.05 * Math.pow(1 - ph, 1.6);
      }
      r *= 1 - smoothstep(0.985, 1, t) * 0.5;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const rib = pseudo ? 1 + 0.03 * Math.cos(a * 7 + seed) : 1;
        out[j].x = Math.cos(a) * Math.max(0.01, r * rib);
        out[j].y = Math.sin(a) * Math.max(0.01, r * rib);
        out[j].u = j / sides;
      }
    },
    colorAt: (t, j) => {
      const dist = t * H;
      const a = (j / sides) * TAU;
      let c = mixRgb(cA, cB, smoothstep(0.5, 1, t));
      if (pseudo) {
        const stripe = 0.5 + 0.5 * Math.cos(a * 7 + seed);
        c = tint(mixRgb(cA, cB, stripe * 0.7), 0.94 + 0.12 * stripe);
        const dry = Math.exp(-dist * 1.1) * clamp(0.4 + noise3(Math.cos(a) * 2 + seed, dist * 4, Math.sin(a) * 2), 0, 1);
        c = mixRgb(c, cDead, dry * 0.55);
      } else if (b.ringFrequency > 0) {
        const ph = 0.5 + 0.5 * Math.cos(dist * b.ringFrequency * TAU);
        c = tint(c, 1 - b.ringDepth * 0.3 * Math.pow(1 - ph, 1.5));
      }
      return tint(c, 1 + 0.14 * noise3(j * 1.3 + seed, dist * 3, seed));
    },
    upHint: v3(1, 0, 0),
    tile: pseudo ? TILE.stem : TILE.bark,
    vPerMeter: 0.7,
    organ: ORGAN.trunk,
    wind: NO_WIND(base),
    capEnd: true,
    capScale: 0.55,
  };
  // 12 sides → window 2(w+h)=12 → w=3, h=3 on the 20-sided blob.
  return bd.weld(blob, 0.62, dir0, 3, 3, spec, { collarRings: 2, collarScale: 0.5, margin: 0, search: 6 });
}


/** Single banana-family pseudostem: rolled leaf sheaths, not a woody trunk. */
function buildPseudostem(bd: PlantBuilder, p: PlantParams, rng: Random, base: V3): TubeGrid {
  const b = p.botany;
  const H = Math.max(0.3, b.trunkHeight);
  const leanAz = rng.range(0, TAU);
  const lean = v3(Math.cos(leanAz), 0, Math.sin(leanAz));
  const spine: V3[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const off = b.trunkCurve * H * 0.1 * t * t;
    spine.push(v3(base.x + lean.x * off, -0.15 + t * (H + 0.15), base.z + lean.z * off));
  }
  const ringSet = new Set<number>();
  for (let i = 0; i <= 14; i++) ringSet.add((i / 14) * 0.86);
  const crownRings = (b.frondCount + 4) * 2 + 8;
  for (let i = 0; i <= crownRings; i++) ringSet.add(0.86 + (i / crownRings) * 0.14);
  const sides = Math.max(14, p.mesh.trunkSides);
  const cA = col(b.trunkColor);
  const cB = col(b.trunkColor2);
  const cDead = col(b.deadColor);
  const seed = rng.range(0, 30);
  return bd.tube({
    spine,
    ringTs: [...ringSet].sort((a, c) => a - c),
    sides,
    profileAt: (t, out) => {
      const dist = t * H;
      let r = b.trunkRadius * (1 - 0.1 * t) * (1 + 0.55 * Math.exp(-dist * 1.5));
      r *= 1 - smoothstep(0.985, 1, t) * 0.5;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const rib = 1 + 0.03 * Math.cos(a * 7 + seed) + 0.015 * noise3(Math.cos(a) * 2 + seed, dist * 2, Math.sin(a) * 2);
        out[j].x = Math.cos(a) * Math.max(0.01, r * rib);
        out[j].y = Math.sin(a) * Math.max(0.01, r * rib);
        out[j].u = j / sides;
      }
    },
    colorAt: (t, j) => {
      const dist = t * H;
      const a = (j / sides) * TAU;
      const stripe = 0.5 + 0.5 * Math.cos(a * 7 + seed);
      let c = tint(mixRgb(cA, cB, stripe * 0.7), 0.94 + 0.12 * stripe);
      const dry = Math.exp(-dist * 1.1) * clamp(0.4 + noise3(Math.cos(a) * 2 + seed, dist * 4, Math.sin(a) * 2), 0, 1);
      c = mixRgb(c, cDead, dry * 0.55);
      return tint(c, 1 + 0.12 * noise3(j * 1.3 + seed, dist * 3, seed));
    },
    upHint: v3(1, 0, 0),
    tile: TILE.stem,
    vPerMeter: 0.35,
    organ: ORGAN.trunk,
    wind: NO_WIND(base),
    capStart: true,
    capEnd: true,
    capScale: 0.55,
  });
}

// -----------------------------------------------------------------------------
// Habit: paddle (banana family)
// -----------------------------------------------------------------------------

function buildPaddle(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const distichous = b.phyllotaxis > 170; // two-ranked fan: traveller's palm, BoP, heliconia
  const isBanana = !distichous && b.bladeWidth > 0.5;
  interface Stem { grid: TubeGrid; scale: number; fanAz: number }
  const stems: Stem[] = [];

  if (b.stemCount > 1) {
    // Rhizome mat: a mother pseudostem with suckers of decreasing size.
    const blob = buildCrownBlob(bd, p, rng, b.trunkRadius * 2.6, 0.26);
    for (let i = 0; i < b.stemCount; i++) {
      const az = (i / b.stemCount) * TAU + rng.range(-0.35, 0.35);
      const off = i === 0 ? 0 : rng.range(0.1, 0.32);
      const base = v3(Math.cos(az) * off, 0, Math.sin(az) * off);
      const scale = i === 0 ? 1 : rng.range(0.4, 0.85);
      const sub = clonePlant(p);
      sub.botany.trunkHeight = b.trunkHeight * scale;
      const g = weldStemIntoBlob(bd, sub, rng.fork(), blob, base, az);
      if (g) stems.push({ grid: g, scale, fanAz: rng.range(0, TAU) });
    }
  } else if (b.trunkHeight > 0.35 && b.ringFrequency > 0) {
    // Woody ringed trunk (traveller's palm).
    stems.push({
      grid: buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), {
        crownBand: 0.12,
        crownWindows: b.frondCount + 2,
      }),
      scale: 1, fanAz: rng.range(0, TAU),
    });
  } else if (b.trunkHeight > 0.35) {
    stems.push({ grid: buildPseudostem(bd, p, rng, v3(0, 0, 0)), scale: 1, fanAz: rng.range(0, TAU) });
  } else {
    // Stemless fan rising from a rhizome crown (bird of paradise).
    stems.push({ grid: buildCrownBlob(bd, p, rng, b.trunkRadius * 1.5, Math.max(0.18, b.trunkHeight)), scale: 1, fanAz: rng.range(0, TAU) });
  }

  for (const stem of stems) {
    const trunk = stem.grid;
    const leafScale = 0.5 + 0.5 * stem.scale; // suckers carry smaller leaves
    const fanNormal = v3(-Math.sin(stem.fanAz), 0, Math.cos(stem.fanAz));
    const leafCount = Math.max(3, Math.round(b.frondCount * (stem.scale < 0.6 ? 0.65 : 1)));
    for (let i = 0; i < leafCount; i++) {
      const age = leafCount <= 1 ? 0.5 : i / (leafCount - 1);
      const az = distichous
        ? stem.fanAz + (i % 2) * Math.PI + rng.bell() * 0.05
        : i * b.phyllotaxis * DEG + rng.bell() * 0.05;
      const attachT = 0.995 - age * (distichous ? 0.1 : 0.06);
      const el = (84 - b.crownSpread * Math.pow(age, 0.8)) * DEG;
      const dir0 = dirFromAzEl(az, el);
      const f = bd.frameAt(trunk, clamp(attachT, 0.4, 0.999));
      const origin = addScaled(f.center, dir0, f.radius * 0.85);
      const fresh = mixRgb(col(b.leafColor), col(b.leafColor2), (1 - age) * 0.5);
      const spec = bladeLeafSpec(origin, dir0, {
        len: b.leafLength * leafScale * (0.5 + 0.5 * smoothstep(0, 0.25, age)) * rng.range(0.92, 1.05),
        width: b.bladeWidth * (0.6 + 0.4 * leafScale) * rng.range(0.92, 1.06),
        petioleRatio: b.petioleRatio * rng.range(0.9, 1.1),
        arc: b.bladeArc * lerp(0.35, 1.25, age),
        // Fan blades continue the petiole line; banana blades roll out then droop.
        bladeEl: distichous ? el * 0.88 : (90 - b.bladePitch) * DEG * 0.4 + el * 0.6 - age * 0.3,
        notch: b.bladeNotch,
        lobes: b.bladeLobes,
        peak: b.bladePeak,
        vee: b.bladeVee,
        tears: b.bladeTears * smoothstep(0.15, 0.5, age), // young leaves still entire
        upHint: distichous ? fanNormal : undefined,
        unfurl: i === 0 ? 0.1 : smoothstep(0.02, 0.18, age), // youngest = rolled cigar
        colorA: fresh,
        colorB: mixRgb(fresh, [0.7, 0.64, 0.22], age * age * 0.5),
        petioleColor: col(b.rachisColor),
        pivot: origin,
        phase: rng.next(),
        limbBase: 0,
        rings: Math.round(p.mesh.bladeRings * p.mesh.quality * (b.bladeTears > 0.1 ? 1.7 : 1.15)),
        petioleR: clamp(b.leafLength * 0.014, 0.012, 0.05),
      }, rng.fork());
      bd.weld(trunk, attachT, dir0, 2, 3, spec, {
        collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale,
        margin: distichous ? 0 : 1, search: 8,
      });
    }

    // Senescent banana leaves collapse at the crown and hang brown along the stem.
    if (isBanana) {
      const dead = 2 + Math.floor(rng.next() * 2);
      for (let i = 0; i < dead; i++) {
        const az = rng.range(0, TAU);
        const dir0 = dirFromAzEl(az, rng.range(-0.45, -0.2));
        const attachT = rng.range(0.88, 0.94);
        const f = bd.frameAt(trunk, attachT);
        const origin = addScaled(f.center, dir0, f.radius * 0.85);
        const cDead = mixRgb(col(b.deadColor), col(b.leafColor), rng.range(0.1, 0.3));
        const spec = bladeLeafSpec(origin, dir0, {
          len: b.leafLength * leafScale * rng.range(0.55, 0.75),
          width: b.bladeWidth * 0.8,
          petioleRatio: b.petioleRatio,
          arc: 0.35,
          bladeEl: -1.3,
          notch: 0, lobes: 0,
          peak: b.bladePeak, vee: b.bladeVee * 0.7, tears: b.bladeTears,
          unfurl: 1,
          colorA: cDead, colorB: tint(cDead, 0.78),
          petioleColor: tint(col(b.deadColor), 0.85),
          pivot: origin, phase: rng.next(), limbBase: 0,
          rings: Math.round(p.mesh.bladeRings * p.mesh.quality),
          petioleR: clamp(b.leafLength * 0.012, 0.01, 0.04),
        }, rng.fork());
        bd.weld(trunk, attachT, dir0, 2, 3, spec, { collarRings: 0, collarScale: 0.5, margin: 0, search: 8 });
      }
    }
    buildStiltRoots(bd, p, rng.fork(), trunk);
  }

  if (b.nutCount > 0 && stems.length) {
    if (!distichous) buildBananaBunch(bd, p, rng.fork(), stems[0].grid);
    else if (b.stemCount > 1) {
      // Heliconia: lobster-claw inflorescences terminal on the tallest shoots.
      for (let i = 0; i < Math.min(Math.round(b.nutCount), stems.length); i++) buildLobsterClaw(bd, p, rng.fork(), stems[i].grid);
    } else {
      for (let i = 0; i < b.nutCount; i++) buildCraneFlower(bd, p, rng.fork(), stems[0].grid);
    }
  }
}

/**
 * Banana inflorescence: a stalk arches out of the crown and hangs, carrying
 * tiers ("hands") of individual fingers that curve upward as they grow, with
 * the purple heart (bell) at the tip. Every finger is its own welded organ.
 */
function buildBananaBunch(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const az = rng.range(0, TAU);
  const dir0 = dirFromAzEl(az, 0.5);
  const f = bd.frameAt(trunk, 0.95);
  const origin = addScaled(f.center, dir0, f.radius * 0.8);
  const axisLen = 1.3;
  const spine = bendSpine(origin, dir0, axisLen, 16, (s) => -(2.2 / axisLen) * smoothstep(0.04, 0.45, s));
  // Dense rings through the fruiting zone so every finger finds a window.
  const ringTs: number[] = [];
  for (let i = 0; i <= 5; i++) ringTs.push((i / 5) * 0.3);
  for (let i = 1; i <= 26; i++) ringTs.push(0.3 + (i / 26) * 0.56);
  for (let i = 1; i <= 3; i++) ringTs.push(0.86 + (i / 3) * 0.14);
  const cStalk = col(b.rachisColor);
  const axis = bd.weld(trunk, 0.95, dir0, 2, 3, {
    spine,
    ringTs,
    sides: 10,
    profileAt: (t, out) => {
      const r = Math.max(0.006, 0.026 * (1 - t * 0.45) * (1 + 0.7 * Math.exp(-t * 14)));
      circleInto(out, 10, r, r);
    },
    colorAt: (t) => tint(cStalk, 0.9 + 0.18 * t),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.2,
    organ: ORGAN.fruit,
    wind: wind(origin, rng.next(), 0.08, 0.3, 0.02, 0.1),
    capEnd: true,
    capScale: 0.7,
  }, { collarRings: 1, collarScale: 0.6, margin: 0, search: 12 });
  if (!axis) return;

  // Hands of fingers. Fingers emerge pointing down the axis, then curve up.
  const cYellow = col(b.nutColor);
  const cGreen: RGB = [0.38, 0.52, 0.16];
  const phase = rng.next();
  const tiers = 6;
  const fingerScale = clamp(b.nutSize / 0.16, 0.6, 1.6);
  for (let tier = 0; tier < tiers; tier++) {
    const count = tier >= tiers - 1 ? 7 : 9 + Math.floor(rng.next() * 3);
    for (let k = 0; k < count; k++) {
      const tt = clamp(0.4 + tier * 0.072 + rng.bell() * 0.012, 0.05, 0.9);
      const fr = bd.frameAt(axis, tt);
      const ang = (k / count) * TAU + tier * 0.37 + rng.bell() * 0.1;
      const radial = normalize(addScaled(scale(fr.U, Math.cos(ang)), fr.V, Math.sin(ang)));
      const dir = normalize(addScaled(radial, fr.T, rng.range(0.45, 0.7)));
      const o = addScaled(fr.center, dir, fr.radius * 0.85);
      const len = 0.2 * fingerScale * rng.range(0.85, 1.12) * (1 - tier * 0.04);
      const R = 0.021 * fingerScale;
      const ripe = clamp(0.25 + (tiers - tier) * 0.06 + rng.next() * 0.35, 0, 1);
      const cF = mixRgb(cGreen, cYellow, ripe);
      // Negative geotropism: the finger curves up toward the light.
      const fSpine = bendSpine(o, dir, len, 9, (s) => (1.9 / len) * (0.25 + 0.75 * s), () => rng.bell() * 0.03 / len);
      bd.weld(axis, tt, dir, 1, 2, {
        spine: fSpine,
        ringTs: evenRings(9),
        sides: 6,
        profileAt: (t, out) => {
          const env = Math.pow(Math.sin(Math.PI * (0.1 + 0.8 * t)), 0.5) * (0.35 + 0.65 * smoothstep(0, 0.16, t));
          const r = Math.max(0.002, R * env);
          for (let j = 0; j < 6; j++) {
            const a = (j / 6) * TAU;
            const ridge = 1 + 0.13 * Math.cos(3 * a + 0.5); // banana ridges
            out[j].x = Math.cos(a) * r * ridge;
            out[j].y = Math.sin(a) * r * ridge;
            out[j].u = j / 6;
          }
        },
        colorAt: (t, j) => {
          const a = (j / 6) * TAU;
          return tint(cF, (0.88 + 0.14 * t) * (1 + 0.05 * Math.cos(3 * a + 0.5)) * (1 - 0.25 * smoothstep(0.92, 1, t)));
        },
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 2.4,
        organ: ORGAN.fruit,
        wind: wind(origin, phase, 0.3, 0.42, 0.05, 0.16),
        capEnd: true,
        capScale: 0.5,
      }, { collarRings: 0, collarScale: 0.5, margin: 0 });
    }
  }

  // The heart: a purple teardrop bell below the last hand.
  const hf = bd.frameAt(axis, 0.88);
  const hOrigin = addScaled(hf.center, hf.T, hf.radius * 0.7);
  const hLen = 0.26 * fingerScale + 0.08;
  const hSpine = bendSpine(hOrigin, hf.T, hLen, 8, (s) => -(0.25 / hLen) * s);
  const cBell = col(b.nutColor2);
  bd.weld(axis, 0.88, hf.T, 2, 3, {
    spine: hSpine,
    ringTs: evenRings(12),
    sides: 10,
    profileAt: (t, out) => {
      const r = Math.max(0.004, b.nutSize * 0.42 * Math.pow(Math.sin(Math.PI * (0.22 + 0.62 * t)), 0.75) * (0.3 + 0.7 * smoothstep(0, 0.2, t)));
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * TAU;
        const rib = 1 + 0.05 * Math.cos(a * 5);
        out[j].x = Math.cos(a) * r * rib;
        out[j].y = Math.sin(a) * r * rib;
        out[j].u = j / 10;
      }
    },
    colorAt: (t, j) => tint(cBell, (0.8 + 0.35 * t) * (j % 2 === 0 ? 1 : 0.86)),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.6,
    organ: ORGAN.fruit,
    wind: wind(origin, phase, 0.3, 0.45, 0.03, 0.12),
    capEnd: true,
    capScale: 0.5,
  }, { collarRings: 0, collarScale: 0.5, margin: 0 });
}

/** Bird-of-paradise crane flower (or heliconia bract stalk): stalk + boat bract + crest spikes. */
function buildCraneFlower(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const az = rng.range(0, TAU);
  const dir0 = dirFromAzEl(az, rng.range(0.9, 1.25));
  const f = bd.frameAt(trunk, 0.85);
  const origin = addScaled(f.center, dir0, f.radius * 0.8);
  const stalkLen = b.leafLength * rng.range(0.82, 1.02);
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
  // Boat bract: a horizontal beak; the crest erupts from its top side.
  const horiz = normalize(v3(dir0.x, 0, dir0.z));
  const sideV = normalize(cross(UP, horiz));
  const bractDir = normalize(addScaled(horiz, UP, 0.14));
  const cSepal = col(b.nutColor);
  const cPetal = col(b.nutColor2);
  const bractC = mixRgb(col(b.leafColor), cSepal, 0.45);
  const bract = leafletSpec(tip.center, bractDir, sideV, {
    len: b.nutSize * 1.6, width: b.nutSize * 0.55, droop: 0.06, twistRad: 0,
    colorA: bractC, colorB: cSepal, windPhase: rng.next(), pivot: origin, limbBase: 0.3, rings: 7, fold: 1.15, organ: ORGAN.fruit, tile: TILE.leafLong,
  }, rng.fork());
  bd.weld(stalk, 0.93, bractDir, 1, 2, bract, { collarRings: 0, collarScale: 0.5, margin: 0 });
  // Crest: three orange sepals + one blue petal tongue, standing upright.
  for (let i = 0; i < 4; i++) {
    const spread = (i - 1.5) * 0.28;
    const dir = normalize(add(addScaled(UP, sideV, spread), scale(horiz, 0.3)));
    const isPetal = i === 3;
    const sp = leafletSpec(tip.center, dir, tip.U, {
      len: b.nutSize * (isPetal ? 0.85 : 1.05), width: b.nutSize * 0.3, droop: 0.3, twistRad: 0.4,
      colorA: isPetal ? cPetal : cSepal, colorB: isPetal ? tint(cPetal, 1.2) : tint(cSepal, 1.15),
      windPhase: rng.next(), pivot: origin, limbBase: 0.35, rings: 6, fold: 0.5, organ: ORGAN.fruit, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(stalk, 0.97, dir, 1, 2, sp, { collarRings: 0, collarScale: 0.5, margin: 0 });
  }
}


/**
 * Heliconia lobster-claw: a terminal rachis arches over and hangs, carrying a
 * chain of alternating waxy boat bracts graded red -> orange -> gold.
 */
function buildLobsterClaw(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid): void {
  const b = p.botany;
  const az = rng.range(0, TAU);
  const dir0 = dirFromAzEl(az, rng.range(0.75, 1.05));
  const f = bd.frameAt(trunk, 0.96);
  const origin = addScaled(f.center, dir0, f.radius * 0.8);
  const len = clamp(b.nutSize * 8, 0.55, 1.1) * rng.range(0.9, 1.1);
  const spine = bendSpine(origin, dir0, len, 18,
    (s) => -(2.3 / len) * smoothstep(0.12, 0.55, s),
    (s) => Math.sin(s * 20) * (0.3 / len) * smoothstep(0.15, 0.45, s));
  const cA = col(b.nutColor);
  const cB = col(b.nutColor2);
  const phase = rng.next();
  const rachis = bd.weld(trunk, 0.96, dir0, 2, 2, {
    spine,
    ringTs: evenRings(30),
    sides: 8,
    profileAt: (t, out) => {
      const r = Math.max(0.003, 0.008 * (1 - t * 0.45) * (1 + 0.6 * Math.exp(-t * 12)));
      circleInto(out, 8, r, r);
    },
    colorAt: (t) => mixRgb(col(b.rachisColor), cA, smoothstep(0.15, 0.5, t)),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.4,
    organ: ORGAN.fruit,
    wind: wind(origin, phase, 0.05, 0.3, 0.02, 0.15),
    capEnd: true,
    capScale: 0.6,
  }, { collarRings: 1, collarScale: 0.6, margin: 0 });
  if (!rachis) return;

  const bracts = 8 + Math.floor(rng.next() * 3);
  for (let i = 0; i < bracts; i++) {
    const t = 0.3 + (i / bracts) * 0.68;
    const fr = bd.frameAt(rachis, t);
    // Bracts alternate sides and cup upward like lobster claws.
    const radial = scale(fr.U, i % 2 === 0 ? 1 : -1);
    const dir = normalize(add(addScaled(radial, UP, 1.05), scale(fr.T, 0.3)));
    const cBr = mixRgb(cA, cB, Math.pow(i / Math.max(1, bracts - 1), 1.4));
    const sp = leafletSpec(fr.center, dir, fr.T, {
      len: b.nutSize * rng.range(1.5, 1.8), width: b.nutSize * 0.85, droop: 0.3, twistRad: 0.25,
      colorA: tint(cBr, 0.9), colorB: tint(cBr, 1.18), windPhase: phase, pivot: origin, limbBase: 0.3,
      rings: 7, fold: 1.15, organ: ORGAN.fruit, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(rachis, t, dir, 1, 2, sp, { collarRings: 0, collarScale: 0.5, margin: 0 });
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
    // Youth runs opposite ways: a ground rosette's youngest leaf is first out
    // of the crown centre; a climbing stem's youngest leaf is at its tip.
    const youth = climbing ? age : 1 - age;
    const az = i * b.phyllotaxis * DEG + rng.bell() * 0.12;
    const attachT = climbing ? 0.14 + age * 0.82 : 0.6 + (1 - age) * 0.3;
    const el = lerp(0.5, 1.25, youth) * (climbing ? 0.75 : 1);
    const dir0 = dirFromAzEl(az, el);
    const f = bd.frameAt(stem, clamp(attachT, 0.05, 0.999));
    const origin = addScaled(f.center, dir0, f.radius * 0.8);
    const fresh = mixRgb(col(b.leafColor), col(b.leafColor2), youth * 0.45);
    const spec = bladeLeafSpec(origin, dir0, {
      len: b.leafLength * (0.45 + 0.55 * smoothstep(0, 0.4, 1 - youth) + (climbing ? age * 0.2 : 0)) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: clamp(b.petioleRatio * rng.range(0.82, 1.18), 0.05, 0.75), // tiered canopy heights
      arc: b.bladeArc * rng.range(0.85, 1.15),
      bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.07,
      notch: b.bladeNotch * smoothstep(0.35, 0.75, 1 - youth), // only mature leaves fenestrate
      lobes: b.bladeLobes,
      peak: b.bladePeak,
      vee: b.bladeVee,
      tears: b.bladeTears,
      notchCount: b.bladeNotch > 0.02 ? Math.round(4 + b.bladeNotch * 3) : undefined,
      geniculum: b.bladeNotch > 0.4, // monstera / philodendron wrist joint
      unfurl: 1 - smoothstep(0.86, 1, youth) * 0.88,
      colorA: fresh,
      colorB: mixRgb(fresh, [0.68, 0.6, 0.2], Math.pow(1 - youth, 2) * 0.35),
      petioleColor: col(b.rachisColor),
      pivot: origin,
      phase: rng.next(),
      limbBase: climbing ? 0.1 : 0,
      rings: Math.round(p.mesh.bladeRings * p.mesh.quality * (b.bladeNotch > 0.1 ? 1.45 : 1.1)),
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
  const style = b.branchStyle;
  const trunk = buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), {
    crownBand: 0.1,
    crownWindows: Math.round(b.branchCount) + 3,
    branchBand: style === 'leader' ? [0.28, 0.98] : style === 'fork' ? [0.82, 0.99] : [0.5, 0.98],
  });
  const tips: { grid: TubeGrid; phase: number }[] = [];
  if (style === 'fork') growFork(bd, p, rng, trunk, b.trunkHeight * 0.8, b.trunkRadius * 0.92, 0, tips);
  else if (style === 'leader') growLeader(bd, p, rng, trunk, tips);
  else growBranches(bd, p, rng, trunk, { len: b.trunkHeight * 0.85, radius: b.trunkRadius, level: 0 }, tips, true);
  buildStiltRoots(bd, p, rng.fork(), trunk);

  // Frangipani flower clusters nestled in some leaf rosettes.
  if (b.nutCount > 0 && tips.length) {
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
        bd.weld(tip.grid, 0.99, dir, 1, 2, sp, { collarRings: 0, collarScale: 0.4, margin: 0, search: 8 });
      }
    }
  }
}

/**
 * Frangipani architecture: every axis ends in a blunt tip that forks into 2-3
 * daughter axes (terminal dichotomy); leaves live only in spiral rosettes at
 * the final tips. Succulent, candelabra-like.
 */
function growFork(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, len: number, radius: number, level: number, tips: { grid: TubeGrid; phase: number }[]): void {
  const b = p.botany;
  if (level >= b.branchLevels) {
    placeLeaves(bd, p, rng, parent, true);
    tips.push({ grid: parent, phase: rng.next() });
    return;
  }
  const forks = Math.max(2, Math.round(b.branchCount * rng.range(0.8, 1.2)));
  const baseAz = rng.range(0, TAU);
  for (let i = 0; i < forks; i++) {
    const t = rng.range(0.93, 0.99);
    const f = bd.frameAt(parent, t);
    const az = baseAz + (i / forks) * TAU + rng.bell() * 0.35;
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const spread = b.branchAngle * DEG * rng.range(0.75, 1.2);
    const dir = normalize(addScaled(scale(f.T, Math.cos(spread)), radial, Math.sin(spread)));
    const childLen = len * rng.range(0.66, 0.84);
    const childRad = Math.max(0.012, radius * b.branchTaper * rng.range(0.9, 1.05));
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const child = buildBranch(bd, p, rng.fork(), parent, origin, dir, childLen, childRad, level + 1, t, true);
    if (child) growFork(bd, p, rng.fork(), child, childLen, childRad, level + 1, tips);
  }
}

/**
 * Fiddle-leaf architecture: one upright leader carrying leaves in a spiral
 * along its upper length, with a few sparse laterals that leaf the same way.
 */
function growLeader(bd: PlantBuilder, p: PlantParams, rng: Random, trunk: TubeGrid, tips: { grid: TubeGrid; phase: number }[]): void {
  const b = p.botany;
  // Laterals first (so leaves can fill around them), upper trunk only.
  const branches: TubeGrid[] = [];
  const count = Math.max(1, Math.round(b.branchCount));
  for (let i = 0; i < count; i++) {
    const t = lerp(0.52, 0.9, count <= 1 ? 0.5 : i / (count - 1)) + rng.bell() * 0.02;
    const f = bd.frameAt(trunk, clamp(t, 0.05, 0.99));
    const az = i * 137.5 * DEG + rng.bell() * 0.2;
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const spread = b.branchAngle * DEG * rng.range(0.85, 1.15);
    const dir = normalize(addScaled(scale(f.T, Math.cos(spread)), radial, Math.sin(spread)));
    const len = b.trunkHeight * rng.range(0.3, 0.42) * (1.15 - t * 0.35);
    const radius = Math.max(0.008, b.trunkRadius * b.branchTaper * (1.1 - t * 0.3));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const child = buildBranch(bd, p, rng.fork(), trunk, origin, dir, len, radius, 1, t, false);
    if (child) branches.push(child);
  }
  // Spiral of leaves up the leader, young small leaves near the tip.
  const nLeaves = Math.round(b.leavesPerTip * 4);
  for (let i = 0; i < nLeaves; i++) {
    const t = lerp(0.32, 0.985, Math.pow(i / Math.max(1, nLeaves - 1), 0.9));
    placeOneLeaf(bd, p, rng.fork(), trunk, t, i * 137.5 * DEG, rng.range(0.85, 1.05));
  }
  for (const br of branches) {
    placeLeaves(bd, p, rng, br, false, 1.3);
    placeLeaves(bd, p, rng, br, true, 0.55);
    tips.push({ grid: br, phase: rng.next() });
  }
  tips.push({ grid: trunk, phase: rng.next() });
}

function growBranches(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, ctx: BranchCtx, tips: { grid: TubeGrid; phase: number }[], isTrunk: boolean): void {
  const b = p.botany;
  if (ctx.level >= b.branchLevels) {
    placeLeaves(bd, p, rng, parent, true);
    tips.push({ grid: parent, phase: rng.next() });
    return;
  }
  const count = Math.max(2, Math.round(b.branchCount * rng.range(0.75, 1.25)));
  const lo = isTrunk ? 0.55 : 0.35;
  const baseAz = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    // Schefflera-style tiers: trunk branches leave in loose whorls.
    let t = count === 1 ? 0.97 : lerp(lo, 0.98, Math.pow(i / (count - 1), 0.8)) + rng.bell() * 0.02;
    if (isTrunk) t = clamp(Math.round((t - lo) / 0.14) * 0.14 + lo + rng.bell() * 0.015, lo, 0.98);
    const f = bd.frameAt(parent, clamp(t, 0.05, 0.99));
    const az = baseAz + i * 137.5 * DEG + rng.bell() * 0.25;
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const spread = b.branchAngle * DEG * rng.range(0.8, 1.2);
    const dir = normalize(addScaled(scale(f.T, Math.cos(spread)), radial, Math.sin(spread)));
    const len = ctx.len * rng.range(0.62, 0.8);
    const radius = Math.max(0.008, ctx.radius * b.branchTaper * rng.range(0.85, 1.05));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const child = buildBranch(bd, p, rng.fork(), parent, origin, dir, len, radius, ctx.level + 1, t, false);
    if (child) growBranches(bd, p, rng.fork(), child, { len, radius, level: ctx.level + 1 }, tips, false);
  }
  // Foliage along the outer reaches too, not only at the very tips.
  if (ctx.level >= b.branchLevels - 1 && !isTrunk) placeLeaves(bd, p, rng, parent, false);
  if (isTrunk) placeLeaves(bd, p, rng, parent, false, 1.6);
}

function buildBranch(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, origin: V3, dir: V3, len: number, radius: number, level: number, attachT: number, blunt: boolean): TubeGrid | null {
  const b = p.botany;
  // Branches curve upward (gravitropism); frangipani forks sweep up harder.
  const upCurve = blunt ? 0.4 : 0.22;
  const spine = bendSpine(origin, dir, len, 14, (s) => (upCurve / len) * (1 - s) - 0.08 / len * s, () => rng.bell() * 0.05 / len);
  const sides = level === 1 ? 10 : 8;
  // Dense enough rings for child windows + leaf windows.
  const terminal = level >= b.branchLevels;
  const wantRings = Math.round((terminal ? (blunt ? 38 : 28) : 40) * p.mesh.quality);
  const cA = tint(col(b.trunkColor), 1 - level * 0.04);
  const cB = tint(col(b.trunkColor2), 1.05);
  const phase = rng.next();
  const scarSeed = rng.range(0, 40);
  const spec: TubeSpec = {
    spine,
    ringTs: evenRings(Math.max(10, wantRings)),
    sides,
    profileAt: (t, out) => {
      // Blunt succulent axes keep their thickness to a rounded end; woody
      // branches taper more conventionally.
      const shape = blunt
        ? (1 - 0.3 * t) * (1 - smoothstep(0.97, 1, t) * 0.35)
        : Math.pow(1 - t, 0.45) * 0.82 + 0.18 * (1 - t);
      const r = Math.max(blunt ? 0.008 : 0.004, radius * shape * (1 + 0.4 * Math.exp(-t * 8)));
      circleInto(out, sides, r, r * 0.96);
    },
    colorAt: (t, j) => {
      let c = tint(mixRgb(cA, cB, t), 1 + 0.1 * noise3(j * 1.4, t * len * 6, level * 7));
      // Frangipani leaf-scar bumps speckle the grey-green bark.
      if (blunt) c = tint(c, 1 + 0.13 * noise3(Math.cos(j * 2.2) * 2 + scarSeed, t * len * 14, Math.sin(j * 2.2) * 2));
      return c;
    },
    upHint: UP,
    tile: TILE.bark,
    vPerMeter: 0.9,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.08 * level, 0.12 + 0.22 * level, 0, 0.12 * level),
    capEnd: true,
    capScale: blunt ? 0.45 : 0.8,
  };
  const w = 2;
  const h = sides === 10 ? 3 : 2;
  return bd.weld(parent, attachT, dir, w, h, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale, search: 7 });
}

/** Weld one leaf (simple blade or palmate umbrella) onto a branch at (t, azimuth). */
function placeOneLeaf(bd: PlantBuilder, p: PlantParams, rng: Random, branch: TubeGrid, t: number, az: number, sizeScale = 1): void {
  const b = p.botany;
  const f = bd.frameAt(branch, clamp(t, 0.03, 0.995));
  const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
  const dir = normalize(addScaled(scale(f.T, rng.range(0.25, 0.65)), radial, 1));
  const origin = addScaled(f.center, dir, f.radius * 0.85);
  const cA = mixRgb(col(b.leafColor), col(b.leafColor2), rng.next() * 0.5);
  if (b.compoundLeaf === 'palmate') buildUmbrellaLeaf(bd, p, rng.fork(), branch, origin, dir, t, cA);
  else {
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * sizeScale * rng.range(0.85, 1.1),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc,
      bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.06,
      notch: b.bladeNotch,
      lobes: b.bladeLobes,
      peak: b.bladePeak,
      vee: b.bladeVee,
      tears: b.bladeTears,
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
    bd.weld(branch, t, dir, 2, 3, spec, { collarRings: Math.min(1, p.mesh.collarRings), collarScale: 0.6, margin: 0, search: 7 });
  }
}

/** Cluster leaves at a branch tip (spiral rosette) or scattered along it. */
function placeLeaves(bd: PlantBuilder, p: PlantParams, rng: Random, branch: TubeGrid, atTip: boolean, countScale = 1): void {
  const b = p.botany;
  const n = Math.max(1, Math.round(b.leavesPerTip * (atTip ? 1 : 0.7) * countScale));
  const baseAz = rng.range(0, TAU);
  for (let i = 0; i < n; i++) {
    const t = atTip ? rng.range(0.88, 0.995) : rng.range(0.42, 0.95);
    placeOneLeaf(bd, p, rng.fork(), branch, t, baseAz + i * 137.5 * DEG + rng.bell() * 0.2);
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
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.003, 0.0075 * (1 - t * 0.3)), Math.max(0.003, 0.0075 * (1 - t * 0.3))),
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
      width: b.bladeWidth * 0.3,
      droop: b.bladeArc * 0.85,
      twistRad: 0.3,
      colorA: cL, colorB: tint(cL, 1.1),
      windPhase: phase, pivot: origin, limbBase: 0.5, rings: 9, fold: 0.65, organ: ORGAN.leaf, tile: TILE.leafLong,
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

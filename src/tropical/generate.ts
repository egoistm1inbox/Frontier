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
  /** Wrinkled geniculum joint where petiole meets blade (monstera); also the grass leaf collar. */
  geniculum?: boolean;
  /** Pale midrib stripe strength 0..1 (maize, sugarcane, sorghum). */
  midribPale?: number;
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
      let bladeC = tint(mixRgb(cA, cB, tb * 0.7), BLADE_SHADE[j]);
      if (o.midribPale) {
        // j=3 is the top midrib groove, j=8 the keel underside.
        const mp = o.midribPale * (j === 3 ? 0.85 : j === 8 ? 0.45 : (j === 2 || j === 4) ? 0.28 : 0);
        if (mp > 0) bladeC = mixRgb(bladeC, [0.84, 0.87, 0.63], mp * smoothstep(0, 0.12, tb));
      }
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
// Habit: vegetable crops
//
// Garden plants built from the same welded tubes: tomato vines with pinnate
// compound leaves and fruit trusses, strawberry crowns with trifoliate
// leaves, runners and berries, pepper bushes, a sunflower with a ray-petal
// head, pumpkin vines and a headed cabbage.
// -----------------------------------------------------------------------------

function ripenColor(ripe: number, cGreen: RGB, cRipe: RGB): RGB {
  const orange: RGB = [0.86, 0.46, 0.13];
  return ripe < 0.5 ? mixRgb(cGreen, orange, ripe * 2) : mixRgb(orange, cRipe, (ripe - 0.5) * 2);
}

interface Shoot { grid: TubeGrid; level: number }

/** Tomato/pepper style branching: collect every shoot for leaves + fruit. */
function growShoots(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, len: number, radius: number, level: number, shoots: Shoot[]): void {
  const b = p.botany;
  shoots.push({ grid: parent, level });
  if (level >= b.branchLevels) return;
  const count = Math.max(2, Math.round(b.branchCount * rng.range(0.8, 1.2)));
  const baseAz = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.9 : lerp(0.42, 0.96, i / (count - 1)) + rng.bell() * 0.02;
    const f = bd.frameAt(parent, clamp(t, 0.05, 0.99));
    const az = baseAz + i * 137.5 * DEG + rng.bell() * 0.25;
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const spread = b.branchAngle * DEG * rng.range(0.85, 1.15);
    const dir = normalize(addScaled(scale(f.T, Math.cos(spread)), radial, Math.sin(spread)));
    const childLen = len * rng.range(0.6, 0.78);
    const childRad = Math.max(0.004, radius * b.branchTaper * rng.range(0.9, 1.05));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const child = buildBranch(bd, p, rng.fork(), parent, origin, dir, childLen, childRad, level + 1, t, false);
    if (child) growShoots(bd, p, rng.fork(), child, childLen, childRad, level + 1, shoots);
  }
}

/** Five-petal star flower on its own stalk (tomato, strawberry, pepper...). */
function buildStarFlower(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, attachT: number, dir: V3, origin: V3, size: number, stalkLen: number, petalColor: RGB, centerColor: RGB): void {
  const b = p.botany;
  const phase = rng.next();
  const stalk = bd.weld(parent, attachT, dir, 1, 2, {
    spine: bendSpine(origin, dir, stalkLen, 6, (s) => -(0.3 / stalkLen) * s),
    ringTs: evenRings(9),
    sides: 6,
    profileAt: (t, out) => circleInto(out, 6, Math.max(0.0012, size * 0.09 * (1 - t * 0.3)), Math.max(0.0012, size * 0.09 * (1 - t * 0.3))),
    colorAt: () => col(b.rachisColor),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 2,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.15, 0.4, 0.05, 0.25),
    capEnd: true,
  }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  if (!stalk) return;
  const tip = bd.frameAt(stalk, 0.97);
  // Central cone of anthers.
  bd.weld(stalk, 0.97, tip.T, 1, 2, {
    spine: [tip.center, addScaled(tip.center, tip.T, size * 0.3), addScaled(tip.center, tip.T, size * 0.5)],
    ringTs: evenRings(3),
    sides: 6,
    profileAt: (t, out) => circleInto(out, 6, Math.max(0.0008, size * 0.16 * Math.sin(Math.PI * (0.2 + 0.65 * t))), Math.max(0.0008, size * 0.16 * Math.sin(Math.PI * (0.2 + 0.65 * t)))),
    colorAt: () => centerColor,
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 3,
    organ: ORGAN.fruit,
    wind: wind(origin, phase, 0.4, 0.5, 0.1, 0.3),
    capEnd: true,
  }, { collarRings: 0, collarScale: 0.4, margin: 0 });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + rng.bell() * 0.1;
    const radial = normalize(addScaled(scale(tip.U, Math.cos(a)), tip.V, Math.sin(a)));
    const pdir = normalize(addScaled(scale(radial, 1), tip.T, 0.35));
    const sp = leafletSpec(tip.center, pdir, radial, {
      len: size * rng.range(0.9, 1.1), width: size * 0.42, droop: 0.4, twistRad: 0.2,
      colorA: tint(petalColor, 0.95), colorB: tint(petalColor, 1.08),
      windPhase: phase, pivot: origin, limbBase: 0.4, rings: 5, fold: 0.22, organ: ORGAN.fruit, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(stalk, 0.94, pdir, 1, 2, sp, { collarRings: 0, collarScale: 0.4, margin: 0 });
  }
}

/** Tomato compound leaf: rachis with paired leaflets, interstitials, terminal. */
function buildCompoundLeaf(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, attachT: number, dir: V3, origin: V3, sizeF: number): void {
  const b = p.botany;
  const len = b.leafLength * sizeF * rng.range(0.9, 1.1);
  const phase = rng.next();
  const rachis = bd.weld(parent, attachT, dir, 2, 2, {
    spine: bendSpine(origin, dir, len, 8, (s) => -(0.55 / len) * s, () => rng.bell() * 0.02 / len),
    ringTs: evenRings(22),
    sides: 8,
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.0012, 0.0032 * (1 - t * 0.55)), Math.max(0.0012, 0.0032 * (1 - t * 0.55))),
    colorAt: () => col(b.rachisColor),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.6,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.2, 0.5, 0.04, 0.2),
    capEnd: true,
  }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  if (!rachis) return;
  const cA = mixRgb(col(b.leafColor), col(b.leafColor2), rng.next() * 0.4);
  const leafletAt = (t: number, sideSign: number, lf: number): void => {
    const f = bd.frameAt(rachis, clamp(t, 0.05, 0.99));
    const dir2 = sideSign === 0
      ? normalize(addScaled(f.T, f.V, 0.25))
      : normalize(addScaled(scale(f.T, 0.55), f.U, sideSign));
    const sp = leafletSpec(f.center, dir2, f.V, {
      len: len * 0.36 * lf, width: b.bladeWidth * 0.4 * lf, droop: 0.6, twistRad: 0.35,
      colorA: cA, colorB: tint(cA, 1.1), windPhase: phase, pivot: origin, limbBase: 0.45,
      rings: 7, fold: 0.32, organ: ORGAN.leaf, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(rachis, t, dir2, 1, 2, sp, { collarRings: 0, collarScale: 0.45, margin: 0 });
  };
  for (let pr = 0; pr < 3; pr++) {
    const t = 0.42 + pr * 0.17;
    leafletAt(t, 1, 0.85 + pr * 0.12);
    leafletAt(t + 0.015, -1, 0.85 + pr * 0.12);
    if (pr < 2) { leafletAt(t + 0.085, 1, 0.3); leafletAt(t + 0.1, -1, 0.3); } // interstitial leaflets
  }
  leafletAt(0.97, 0, 1.15);
}

/** Tomato truss: a hooked stalk carrying a cluster of ripening fruit. */
function buildTomatoTruss(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, attachT: number): void {
  const b = p.botany;
  const f0 = bd.frameAt(parent, attachT);
  const az = rng.range(0, TAU);
  const radial = normalize(addScaled(scale(f0.U, Math.cos(az)), f0.V, Math.sin(az)));
  const dir0 = normalize(add(addScaled(radial, f0.T, 0.3), v3(0, -0.25, 0)));
  const origin = addScaled(f0.center, dir0, f0.radius * 0.85);
  const phase = rng.next();
  const axis = bd.weld(parent, attachT, dir0, 1, 2, {
    spine: bendSpine(origin, dir0, 0.11, 7, (s) => -(1.1 / 0.11) * s),
    ringTs: evenRings(16),
    sides: 6,
    profileAt: (t, out) => circleInto(out, 6, Math.max(0.0012, 0.0028 * (1 - t * 0.4)), Math.max(0.0012, 0.0028 * (1 - t * 0.4))),
    colorAt: () => col(b.rachisColor),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 2,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.25, 0.4, 0.04, 0.15),
    capEnd: true,
  }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  if (!axis) return;
  const fruits = 4 + Math.floor(rng.next() * 3);
  const cRed = col(b.nutColor);
  const cGreen = col(b.nutColor2);
  for (let i = 0; i < fruits; i++) {
    const t = 0.3 + (i / Math.max(1, fruits - 1)) * 0.66;
    const f = bd.frameAt(axis, t);
    const ang = i * 2.4 + rng.bell() * 0.3;
    const fradial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
    const dir = normalize(add(addScaled(f.T, fradial, 0.5), v3(0, -1, 0)));
    const o = addScaled(f.center, dir, f.radius * 0.7);
    const R = Math.max(0.014, b.nutSize) * rng.range(0.8, 1.15);
    const ripe = clamp(0.25 + rng.next() * 0.85 - t * 0.15, 0, 1);
    const cT = ripenColor(ripe, cGreen, cRed);
    const tom = bd.weld(axis, t, dir, 2, 3, {
      spine: [o, addScaled(o, dir, R * 0.95), addScaled(o, dir, R * 1.8)],
      ringTs: evenRings(10),
      sides: 10,
      profileAt: (tt, out) => {
        let r = R * Math.pow(Math.sin(Math.PI * (0.1 + 0.8 * tt)), 0.75) * (0.3 + 0.7 * smoothstep(0, 0.15, tt));
        r *= 1 - 0.16 * Math.exp(-Math.pow((tt - 0.03) / 0.045, 2)); // stem dimple
        for (let j = 0; j < 10; j++) {
          const a = (j / 10) * TAU;
          const rr = Math.max(0.002, r * (1 + 0.03 * Math.cos(a * 8)));
          out[j].x = Math.cos(a) * rr; out[j].y = Math.sin(a) * rr; out[j].u = j / 10;
        }
      },
      colorAt: (tt, j) => tint(mixRgb(cT, cGreen, Math.exp(-tt * 7) * 0.55), 0.94 + 0.07 * noise3(j * 2.2, tt * 8 + i * 5, i)),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2.4,
      organ: ORGAN.fruit,
      wind: wind(origin, phase, 0.4, 0.5, 0.05, 0.15),
      capEnd: true,
      capScale: 0.45,
    }, { collarRings: 0, collarScale: 0.5, margin: 0 });
    if (!tom) continue;
    // Star calyx hugging the top of each tomato.
    const tf = bd.frameAt(tom, 0.1);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const cradial = normalize(addScaled(scale(tf.U, Math.cos(a)), tf.V, Math.sin(a)));
      const cdir = normalize(addScaled(scale(cradial, 1), tf.T, -0.55));
      const sp = leafletSpec(tf.center, cdir, cradial, {
        len: R * 0.85, width: R * 0.26, droop: 0.15, twistRad: 0,
        colorA: col(b.rachisColor), colorB: tint(col(b.rachisColor), 1.1),
        windPhase: phase, pivot: origin, limbBase: 0.45, rings: 4, fold: 0.4, organ: ORGAN.rachis, tile: TILE.leafLong,
      }, rng.fork());
      bd.weld(tom, 0.08, cdir, 1, 2, sp, { collarRings: 0, collarScale: 0.4, margin: 0 });
    }
  }
}

function buildTomato(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const trunk = buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(10, p.mesh.trunkSides), {
    crownBand: 0.08, crownWindows: 6, branchBand: [0.3, 0.98],
  });
  const shoots: Shoot[] = [];
  growShoots(bd, p, rng, trunk, b.trunkHeight * 0.7, b.trunkRadius, 0, shoots);
  for (const sh of shoots) {
    const leafCount = sh.level === 0 ? 4 : 3;
    for (let i = 0; i < leafCount; i++) {
      const t = lerp(0.3, 0.92, leafCount <= 1 ? 0.5 : i / (leafCount - 1)) + rng.bell() * 0.03;
      const f = bd.frameAt(sh.grid, clamp(t, 0.05, 0.97));
      const az = rng.range(0, TAU);
      const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
      const dir = normalize(addScaled(scale(f.T, 0.5), radial, 1));
      buildCompoundLeaf(bd, p, rng.fork(), sh.grid, t, dir, addScaled(f.center, dir, f.radius * 0.85), sh.level === 0 ? 1 : 0.85);
    }
  }
  const fruiting = shoots.filter((s) => s.level >= 1);
  const trusses = clamp(Math.round(b.nutCount), 0, 10);
  for (let i = 0; i < trusses && fruiting.length; i++) {
    const sh = fruiting[i % fruiting.length];
    buildTomatoTruss(bd, p, rng.fork(), sh.grid, rng.range(0.45, 0.8));
  }
  for (let i = 0; i < 3 && fruiting.length; i++) {
    const sh = fruiting[Math.floor(rng.next() * fruiting.length)];
    const t = rng.range(0.7, 0.95);
    const f = bd.frameAt(sh.grid, t);
    const dir = normalize(addScaled(scale(f.T, 0.6), f.U, 0.8));
    buildStarFlower(bd, p, rng.fork(), sh.grid, t, dir, addScaled(f.center, dir, f.radius * 0.85), 0.014, 0.035, col('#f0c832'), col('#d8a41e'));
  }
  buildStiltRoots(bd, p, rng.fork(), trunk);
}

/** Strawberry trifoliate leaf: petiole ending in three broad leaflets. */
function buildTrifoliate(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, attachT: number, dir: V3, origin: V3, petLen: number, leafletLen: number, cA: RGB): void {
  const b = p.botany;
  const phase = rng.next();
  const pet = bd.weld(parent, attachT, dir, 2, 2, {
    spine: bendSpine(origin, dir, petLen, 6, (s) => -(0.3 / petLen) * s),
    ringTs: evenRings(10),
    sides: 8,
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.0012, 0.0032 * (1 - t * 0.35)), Math.max(0.0012, 0.0032 * (1 - t * 0.35))),
    colorAt: () => col(b.rachisColor),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 2,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.05, 0.35, 0.03, 0.2),
    capEnd: true,
  }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  if (!pet) return;
  const tip = bd.frameAt(pet, 0.97);
  for (let k = -1; k <= 1; k++) {
    const dir2 = normalize(add(addScaled(tip.T, tip.U, k * 0.85), v3(0, 0.3, 0)));
    const sp = leafletSpec(tip.center, dir2, tip.V, {
      len: leafletLen * rng.range(0.9, 1.08), width: b.bladeWidth * 0.55, droop: 0.55, twistRad: 0.25,
      colorA: cA, colorB: tint(cA, 1.1), windPhase: phase, pivot: origin, limbBase: 0.35,
      rings: 7, fold: 0.42, organ: ORGAN.leaf, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(pet, k === 0 ? 0.97 : 0.9, dir2, 1, 2, sp, { collarRings: 0, collarScale: 0.45, margin: 0 });
  }
}

function buildStrawberry(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.04, b.trunkRadius * 1.2), Math.max(0.06, b.trunkHeight));
  const cA = col(b.leafColor);
  for (let i = 0; i < b.frondCount; i++) {
    const age = b.frondCount <= 1 ? 0.5 : i / (b.frondCount - 1);
    const az = i * 137.5 * DEG + rng.bell() * 0.15;
    const t = rng.range(0.5, 0.72);
    const dir = dirFromAzEl(az, lerp(0.55, 1.15, age));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const cL = mixRgb(cA, col(b.leafColor2), age * 0.45);
    buildTrifoliate(bd, p, rng.fork(), crown, t, dir, origin,
      b.leafLength * b.petioleRatio * rng.range(0.8, 1.2), b.leafLength * 0.45 * (1.1 - age * 0.25), cL);
  }
  // Berries dangle at the plant's edge on arched stalks; a few white flowers.
  const cRed = col(b.nutColor);
  const nFruit = clamp(Math.round(b.nutCount), 0, 12);
  for (let i = 0; i < nFruit; i++) {
    const az = rng.range(0, TAU);
    const t = rng.range(0.42, 0.6);
    const f = bd.frameAt(crown, t);
    if (i >= nFruit - 2) {
      const dir = dirFromAzEl(az, rng.range(0.7, 1.0));
      buildStarFlower(bd, p, rng.fork(), crown, t, dir, addScaled(f.center, dir, f.radius * 0.8), 0.017, 0.13, col(b.nutColor2), col('#f0c832'));
      continue;
    }
    const dir0 = dirFromAzEl(az, 0.55);
    const so = addScaled(f.center, dir0, f.radius * 0.8);
    const stalkLen = rng.range(0.13, 0.19);
    const stalk = bd.weld(crown, t, dir0, 1, 2, {
      spine: bendSpine(so, dir0, stalkLen, 7, (s) => -(1.5 / stalkLen) * smoothstep(0.3, 0.9, s)),
      ringTs: evenRings(10),
      sides: 6,
      profileAt: (tt, out) => circleInto(out, 6, Math.max(0.001, 0.0022 * (1 - tt * 0.35)), Math.max(0.001, 0.0022 * (1 - tt * 0.35))),
      colorAt: () => col(b.rachisColor),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: wind(so, rng.next(), 0.05, 0.3, 0.03, 0.15),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
    if (!stalk) continue;
    const tip = bd.frameAt(stalk, 0.96);
    const dir = normalize(add(tip.T, v3(0, -0.85, 0)));
    const o = addScaled(tip.center, dir, tip.radius * 0.7);
    const R = Math.max(0.008, b.nutSize) * rng.range(0.85, 1.2);
    const ripe = clamp(0.2 + rng.next() * 0.95, 0, 1);
    const cB = mixRgb(mixRgb([0.78, 0.84, 0.58], [0.92, 0.6, 0.55], clamp(ripe * 1.6 - 0.3, 0, 1)), cRed, clamp(ripe * 1.5 - 0.45, 0, 1));
    const berry = bd.weld(stalk, 0.96, dir, 2, 3, {
      spine: [o, addScaled(o, dir, R * 1.1), addScaled(o, dir, R * 2.05)],
      ringTs: evenRings(11),
      sides: 10,
      profileAt: (tt, out) => {
        // Plump shoulder under the calyx, tapering to the point.
        const r = Math.max(0.0018, R * Math.pow(1 - tt, 0.5) * (0.28 + 0.72 * smoothstep(0, 0.16, tt)) * (1 - smoothstep(0.9, 1, tt) * 0.35));
        circleInto(out, 10, r, r * 0.97);
      },
      colorAt: (tt, j) => {
        // Achene speckle: tiny pale seeds in darker pits.
        const pit = noise3(j * 3.7, tt * 34 + i * 7, j * 1.3 + i) > 0.32 ? 0.82 : 1.18;
        return tint(mixRgb(cB, [0.9, 0.88, 0.7], Math.exp(-tt * 6) * 0.35), pit * (0.92 + 0.1 * tt));
      },
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 3,
      organ: ORGAN.fruit,
      wind: wind(so, rng.next(), 0.3, 0.45, 0.06, 0.2),
      capEnd: true,
      capScale: 0.6,
    }, { collarRings: 0, collarScale: 0.5, margin: 0 });
    if (!berry) continue;
    const bf = bd.frameAt(berry, 0.08);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const cradial = normalize(addScaled(scale(bf.U, Math.cos(a)), bf.V, Math.sin(a)));
      const cdir = normalize(addScaled(scale(cradial, 1), bf.T, -0.7));
      const sp = leafletSpec(bf.center, cdir, cradial, {
        len: R * 0.95, width: R * 0.3, droop: 0.1, twistRad: 0,
        colorA: col(b.rachisColor), colorB: tint(col(b.rachisColor), 1.1),
        windPhase: rng.next(), pivot: so, limbBase: 0.4, rings: 4, fold: 0.4, organ: ORGAN.rachis, tile: TILE.leafLong,
      }, rng.fork());
      bd.weld(berry, 0.07, cdir, 1, 2, sp, { collarRings: 0, collarScale: 0.4, margin: 0 });
    }
  }
  // Runners (stolons) creep out and root a daughter rosette.
  for (let r = 0; r < 2; r++) {
    const az = rng.range(0, TAU);
    const t = rng.range(0.35, 0.5);
    const f = bd.frameAt(crown, t);
    const dir0 = dirFromAzEl(az, 0.3);
    const so = addScaled(f.center, dir0, f.radius * 0.8);
    const rLen = rng.range(0.32, 0.45);
    const runner = bd.weld(crown, t, dir0, 1, 2, {
      spine: bendSpine(so, dir0, rLen, 9, (s) => -(1.05 / rLen) * smoothstep(0.15, 0.75, s)),
      ringTs: evenRings(12),
      sides: 6,
      profileAt: (tt, out) => circleInto(out, 6, Math.max(0.001, 0.0024 * (1 - tt * 0.3)), Math.max(0.001, 0.0024 * (1 - tt * 0.3))),
      colorAt: (tt) => mixRgb(col(b.rachisColor), [0.72, 0.42, 0.32], 0.35 + 0.3 * tt),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: NO_WIND(so),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
    if (!runner) continue;
    const tip = bd.frameAt(runner, 0.97);
    buildTrifoliate(bd, p, rng.fork(), runner, 0.97, normalize(add(tip.T, v3(0, 0.9, 0))), tip.center, 0.05, b.leafLength * 0.26, tint(cA, 1.05));
  }
}

function buildPepper(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const trunk = buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(10, p.mesh.trunkSides), {
    crownBand: 0.08, crownWindows: 5, branchBand: [0.45, 0.98],
  });
  const shoots: Shoot[] = [];
  growShoots(bd, p, rng, trunk, b.trunkHeight * 0.9, b.trunkRadius, 0, shoots);
  for (const sh of shoots) {
    const n = Math.round(b.leavesPerTip * (sh.level === 0 ? 0.7 : 1));
    for (let i = 0; i < n; i++) placeOneLeaf(bd, p, rng.fork(), sh.grid, rng.range(0.35, 0.97), rng.range(0, TAU));
  }
  // Pendent pods at the branch nodes, ripening green -> orange -> red.
  const cRed = col(b.nutColor);
  const cGreen = col(b.nutColor2);
  const fruiting = shoots.filter((s) => s.level >= 1);
  const pods = clamp(Math.round(b.nutCount), 0, 40);
  for (let i = 0; i < pods && fruiting.length; i++) {
    const sh = fruiting[Math.floor(rng.next() * fruiting.length)];
    const t = rng.range(0.3, 0.92);
    const f = bd.frameAt(sh.grid, t);
    const az = rng.range(0, TAU);
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const dir = normalize(add(addScaled(radial, f.T, 0.2), v3(0, -1.05, 0)));
    const o = addScaled(f.center, dir, f.radius * 0.85);
    const len = Math.max(0.03, b.nutSize) * rng.range(0.9, 1.5);
    const R = len * 0.17;
    const cP = ripenColor(clamp(rng.next() * 1.15 - 0.1, 0, 1), cGreen, cRed);
    bd.weld(sh.grid, t, dir, 2, 2, {
      spine: bendSpine(o, dir, len, 8, (s) => -(0.35 / len) * s, () => rng.bell() * 0.06 / len),
      ringTs: evenRings(10),
      sides: 8,
      profileAt: (tt, out) => {
        const r = Math.max(0.0012, R * Math.pow(1 - tt, 0.62) * (0.35 + 0.65 * smoothstep(0, 0.14, tt)));
        circleInto(out, 8, r, r * 0.95);
      },
      colorAt: (tt, j) => tint(tt < 0.09 ? col(b.rachisColor) : cP, (0.9 + 0.12 * tt) * (1 + 0.06 * noise3(j * 2.4, tt * 9 + i, i))),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2.4,
      organ: ORGAN.fruit,
      wind: wind(o, rng.next(), 0.3, 0.45, 0.06, 0.2),
      capEnd: true,
      capScale: 0.5,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  }
  for (let i = 0; i < 3 && fruiting.length; i++) {
    const sh = fruiting[Math.floor(rng.next() * fruiting.length)];
    const t = rng.range(0.6, 0.95);
    const f = bd.frameAt(sh.grid, t);
    const dir = normalize(addScaled(scale(f.T, 0.5), f.U, 0.9));
    buildStarFlower(bd, p, rng.fork(), sh.grid, t, dir, addScaled(f.center, dir, f.radius * 0.85), 0.009, 0.025, col('#f4f1e4'), col('#e8d88a'));
  }
  buildStiltRoots(bd, p, rng.fork(), trunk);
}

/** Sunflower head: domed seed disk ringed with ray petals. */
function buildSunflowerHead(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, attachT: number, sizeF: number): void {
  const b = p.botany;
  const f0 = bd.frameAt(parent, attachT);
  const az = rng.range(0, TAU);
  const radial0 = normalize(addScaled(scale(f0.U, Math.cos(az)), f0.V, Math.sin(az)));
  // Heads nod: the disk faces sideways and a little down.
  const dir = normalize(add(addScaled(f0.T, radial0, 1.05), v3(0, -0.4, 0)));
  const origin = addScaled(f0.center, dir, f0.radius * 0.8);
  const R = Math.max(0.03, b.nutSize) * sizeF;
  const thick = R * 0.42;
  const phase = rng.next();
  const cDisk = col(b.nutColor2);
  const disk = bd.weld(parent, attachT, dir, 4, 4, {
    spine: [origin, addScaled(origin, dir, thick * 0.55), addScaled(origin, dir, thick)],
    ringTs: evenRings(9),
    sides: 16,
    profileAt: (t, out) => {
      let r: number;
      if (t < 0.3) r = R * lerp(0.35, 1, smoothstep(0, 0.3, t));
      else r = R * Math.pow(Math.max(0.02, 1 - Math.pow((t - 0.3) / 0.75, 2)), 0.42); // domed face
      circleInto(out, 16, Math.max(0.003, r), Math.max(0.003, r));
    },
    colorAt: (t, j) => {
      if (t < 0.3) return tint(mixRgb(col(b.leafColor), cDisk, t / 0.3 * 0.4), 0.9);
      // Ring of orange disk florets around the dark seed centre.
      const ring = Math.exp(-Math.pow((t - 0.52) / 0.07, 2));
      const chk = 0.88 + 0.22 * (0.5 + 0.5 * noise3(j * 4.1, Math.floor(t * 14) * 2.7, j));
      return tint(mixRgb(cDisk, [0.8, 0.48, 0.12], ring * 0.8), chk);
    },
    upHint: Math.abs(dir.y) > 0.9 ? v3(1, 0, 0) : UP,
    tile: TILE.stem,
    vPerMeter: 2,
    organ: ORGAN.fruit,
    wind: wind(origin, phase, 0.18, 0.3, 0.02, 0.08),
    capEnd: true,
    capScale: 0.35,
  }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
  if (!disk) return;
  const cRay = col(b.nutColor);
  const rays = 21;
  for (let i = 0; i < rays; i++) {
    const t = i % 2 === 0 ? 0.4 : 0.47;
    const f = bd.frameAt(disk, t);
    const a = (i / rays) * TAU + rng.bell() * 0.08;
    const radial = normalize(addScaled(scale(f.U, Math.cos(a)), f.V, Math.sin(a)));
    const pdir = normalize(addScaled(radial, f.T, rng.range(0.15, 0.4)));
    const sp = leafletSpec(f.center, pdir, f.T, {
      len: R * rng.range(0.8, 1.0), width: R * 0.34, droop: 0.3, twistRad: 0.2,
      colorA: mixRgb(cRay, [0.85, 0.45, 0.1], 0.35), colorB: cRay,
      windPhase: phase, pivot: origin, limbBase: 0.3, rings: 6, fold: 0.3, organ: ORGAN.fruit, tile: TILE.leafLong,
    }, rng.fork());
    bd.weld(disk, t, pdir, 1, 2, sp, { collarRings: 0, collarScale: 0.45, margin: 0 });
  }
}

function buildSunflower(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const trunk = buildTrunk(bd, p, rng, v3(0, 0, 0), rng.range(0, TAU), 1, Math.max(12, p.mesh.trunkSides), {
    crownBand: 0.05, crownWindows: 4, branchBand: [0.12, 0.92],
  });
  const n = Math.max(3, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const h01 = i / Math.max(1, n - 1);
    const t = lerp(0.16, 0.88, h01);
    const sizeF = 0.55 + 0.6 * Math.sin(Math.PI * (0.12 + 0.7 * h01)); // biggest leaves low-mid stem
    placeOneLeaf(bd, p, rng.fork(), trunk, t, i * b.phyllotaxis * DEG, sizeF);
  }
  buildSunflowerHead(bd, p, rng.fork(), trunk, 0.99, 1);
  // Optional smaller side heads on short upper branches.
  const extra = clamp(Math.round(b.nutCount) - 1, 0, 3);
  for (let i = 0; i < extra; i++) {
    const t = rng.range(0.72, 0.86);
    const f = bd.frameAt(trunk, t);
    const az = rng.range(0, TAU);
    const radial = normalize(addScaled(scale(f.U, Math.cos(az)), f.V, Math.sin(az)));
    const dir = normalize(addScaled(scale(f.T, 0.7), radial, 0.8));
    const br = buildBranch(bd, p, rng.fork(), trunk, addScaled(f.center, dir, f.radius * 0.85), dir, 0.3, 0.009, 1, t, false);
    if (br) buildSunflowerHead(bd, p, rng.fork(), br, 0.97, 0.55);
  }
  buildStiltRoots(bd, p, rng.fork(), trunk);
}

function buildPumpkin(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.05, b.trunkRadius * 2), Math.max(0.12, b.trunkHeight * 0.65));
  const cA = col(b.leafColor);
  for (let i = 0; i < b.frondCount; i++) {
    const age = b.frondCount <= 1 ? 0.5 : i / (b.frondCount - 1);
    const az = i * 137.5 * DEG + rng.bell() * 0.15;
    const t = rng.range(0.55, 0.82);
    const dir = dirFromAzEl(az, lerp(0.45, 1.05, age));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const fresh = mixRgb(cA, col(b.leafColor2), age * 0.4);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * (0.65 + 0.45 * (1 - age)) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: b.petioleRatio * rng.range(0.85, 1.15),
      arc: b.bladeArc, bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.06,
      notch: b.bladeNotch, notchCount: 5, lobes: b.bladeLobes, peak: b.bladePeak, vee: b.bladeVee,
      unfurl: 1 - smoothstep(0.85, 1, age) * 0.7,
      colorA: fresh, colorB: tint(fresh, 1.08), petioleColor: col(b.rachisColor),
      pivot: origin, phase: rng.next(), limbBase: 0.05,
      rings: Math.round(p.mesh.bladeRings * 1.1 * p.mesh.quality), petioleR: 0.015,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(crown, t, dir, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale, margin: 0, search: 7 });
  }
  // Trailing vines along the ground, each swelling into a ribbed pumpkin.
  const fruits = clamp(Math.round(b.nutCount), 0, 4);
  const cSkin = col(b.nutColor);
  const cSkin2 = col(b.nutColor2);
  for (let i = 0; i < fruits; i++) {
    const az = rng.range(0, TAU);
    const t = rng.range(0.35, 0.5);
    const f = bd.frameAt(crown, t);
    const dirH = v3(Math.cos(az), 0, Math.sin(az));
    const vo = addScaled(f.center, dirH, f.radius * 0.8);
    const vineLen = rng.range(0.45, 0.75);
    const vine = bd.weld(crown, t, dirFromAzEl(az, 0.1), 2, 2, {
      spine: [vo, v3(vo.x + dirH.x * vineLen * 0.5, Math.max(0.03, vo.y - 0.05), vo.z + dirH.z * vineLen * 0.5), v3(vo.x + dirH.x * vineLen, 0.035, vo.z + dirH.z * vineLen)],
      ringTs: evenRings(12),
      sides: 8,
      profileAt: (tt, out) => circleInto(out, 8, Math.max(0.004, 0.013 * (1 - tt * 0.35)), Math.max(0.004, 0.013 * (1 - tt * 0.35))),
      colorAt: () => col(b.rachisColor),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 1.4,
      organ: ORGAN.rachis,
      wind: NO_WIND(vo),
      capEnd: true,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 7 });
    if (!vine) continue;
    const pf = bd.frameAt(vine, 0.78);
    const R = Math.max(0.05, b.nutSize) * rng.range(0.9, 1.15);
    const po = v3(pf.center.x, Math.max(0.015, pf.center.y - 0.01), pf.center.z);
    bd.weld(vine, 0.78, UP, 3, 4, {
      spine: [po, v3(po.x, po.y + R * 0.65, po.z), v3(po.x, po.y + R * 1.28, po.z)],
      ringTs: evenRings(14),
      sides: 14,
      profileAt: (tt, out) => {
        const env = Math.pow(Math.sin(Math.PI * (0.1 + 0.8 * tt)), 0.55) * (1 - 0.22 * smoothstep(0.92, 1, tt));
        for (let j = 0; j < 14; j++) {
          const a = (j / 14) * TAU;
          const r = Math.max(0.004, R * env * (1 + 0.07 * Math.cos(a * 10)));
          out[j].x = Math.cos(a) * r; out[j].y = Math.sin(a) * r; out[j].u = j / 14;
        }
      },
      colorAt: (tt, j) => {
        const a = (j / 14) * TAU;
        let c = tint(mixRgb(cSkin, cSkin2, 0.3 + 0.3 * tt), 0.92 + 0.1 * Math.cos(a * 10));
        if (tt > 0.93) c = mixRgb(c, [0.42, 0.46, 0.26], smoothstep(0.93, 1, tt)); // woody stem end
        return c;
      },
      upHint: v3(1, 0, 0),
      tile: TILE.stem,
      vPerMeter: 1.6,
      organ: ORGAN.fruit,
      wind: NO_WIND(po),
      capEnd: true,
      capScale: 0.3,
    }, { collarRings: 1, collarScale: 0.45, margin: 0, search: 6 });
  }
  // Golden trumpet flowers tucked among the leaves.
  for (let i = 0; i < 2; i++) {
    const t = rng.range(0.5, 0.7);
    const f = bd.frameAt(crown, t);
    const dir = dirFromAzEl(rng.range(0, TAU), 0.8);
    buildStarFlower(bd, p, rng.fork(), crown, t, dir, addScaled(f.center, dir, f.radius * 0.8), 0.045, 0.13, col('#f4bc22'), col('#e08a1e'));
  }
}

function buildCabbage(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.045, b.trunkRadius * 1.3), Math.max(0.09, b.trunkHeight));
  // The head: a tight pale ball of wrapped leaves in the centre.
  const R = Math.max(0.04, b.nutSize);
  const hf = bd.frameAt(crown, 0.7);
  const ho = addScaled(hf.center, UP, hf.radius * 0.5);
  const cHead = col(b.nutColor);
  const cHead2 = col(b.nutColor2);
  const hSeed = rng.range(0, 30);
  bd.weld(crown, 0.7, UP, 4, 4, {
    spine: [ho, v3(ho.x, ho.y + R * 0.85, ho.z), v3(ho.x, ho.y + R * 1.62, ho.z)],
    ringTs: evenRings(14),
    sides: 16,
    profileAt: (t, out) => {
      const r = Math.max(0.004, R * Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * t)), 0.6) * (0.35 + 0.65 * smoothstep(0, 0.14, t)));
      circleInto(out, 16, r, r);
    },
    colorAt: (t, j) => {
      const a = (j / 16) * TAU;
      // Overlapping wrap-leaf seams spiralling over the head.
      const seam = 0.92 + 0.11 * Math.cos(a * 5 + t * 4 + hSeed) + 0.05 * noise3(Math.cos(a) * 2 + hSeed, t * 6, Math.sin(a) * 2);
      return tint(mixRgb(cHead2, cHead, 0.35 + 0.55 * t), seam);
    },
    upHint: v3(1, 0, 0),
    tile: TILE.leafCross,
    vPerMeter: 1.6,
    organ: ORGAN.leaf,
    wind: NO_WIND(ho),
    capEnd: true,
    capScale: 0.4,
  }, { collarRings: 1, collarScale: 0.45, margin: 0, search: 7 });
  // Wrapper leaves: flat and open outside, cupping upright toward the head.
  const cA = col(b.leafColor);
  for (let i = 0; i < b.frondCount; i++) {
    const age = b.frondCount <= 1 ? 0.5 : i / (b.frondCount - 1); // 0 outer .. 1 inner
    const az = i * 137.5 * DEG + rng.bell() * 0.12;
    const t = rng.range(0.42, 0.62);
    const dir = dirFromAzEl(az, lerp(0.32, 1.02, age));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const cL = mixRgb(cA, cHead, age * 0.55);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1.05, 0.55, age) * rng.range(0.92, 1.06),
      width: b.bladeWidth * rng.range(0.9, 1.06),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc * (1 - age * 0.5),
      bladeEl: (90 - b.bladePitch) * DEG + age * 0.45,
      notch: 0, lobes: b.bladeLobes, peak: b.bladePeak, vee: b.bladeVee,
      unfurl: 1,
      colorA: cL, colorB: tint(cL, 1.06), petioleColor: mixRgb(col(b.rachisColor), cHead, 0.4),
      pivot: origin, phase: rng.next(), limbBase: 0.03,
      rings: Math.round(p.mesh.bladeRings * 0.9 * p.mesh.quality), petioleR: 0.011,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(crown, t, dir, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale, margin: 0, search: 7 });
  }
}

function buildVegetable(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  switch (p.botany.cropType) {
    case 'tomato': buildTomato(bd, p, rng); break;
    case 'strawberry': buildStrawberry(bd, p, rng); break;
    case 'pepper': buildPepper(bd, p, rng); break;
    case 'sunflower': buildSunflower(bd, p, rng); break;
    case 'pumpkin': buildPumpkin(bd, p, rng); break;
    case 'cabbage': buildCabbage(bd, p, rng); break;
  }
}

// -----------------------------------------------------------------------------
// Habit: fruit (pineapple, papaya, citrus, mango, grape, watermelon)
//
// One shared trick: every fruit is a single tube whose first stretch is a
// thin stalk and whose profile then swells into the fruit body — stalk,
// skin and blossom end are one welded surface, never a sphere parked on a
// stick. Ripeness is painted per fruit, so a plant carries green and ripe
// fruit at once, like the real thing.
// -----------------------------------------------------------------------------

interface BlobOpts {
  len: number;
  R: number;
  sides: number;
  rings: number;
  /** Position of maximum girth along the fruit body, 0..1. */
  peak: number;
  /** Fraction of length that stays a thin stalk before the fruit swells. */
  stalk: number;
  /** Spine bend for kidney-shaped fruit (mango). */
  bend?: number;
  colorAt: (t: number, a: number) => RGB;
  profileMod?: (t: number, a: number) => number;
  pivot: V3;
  phase: number;
}

/** Stalk + fruit body as one tube. `t` in colorAt runs over the whole tube. */
function blobSpec(origin: V3, dir: V3, up: V3, o: BlobOpts): TubeSpec {
  const sides = o.sides;
  return {
    spine: bendSpine(origin, dir, o.len, 10, o.bend ? (s) => (o.bend! / o.len) * s : () => 0),
    ringTs: evenRings(o.rings),
    sides,
    profileAt: (t, out) => {
      let r: number;
      if (t < o.stalk) {
        r = o.R * lerp(0.09, 0.3, t / Math.max(1e-4, o.stalk));
      } else {
        const tf = (t - o.stalk) / (1 - o.stalk);
        const pk = clamp(o.peak, 0.15, 0.85);
        const tw = tf < pk ? 0.5 * (tf / pk) : 0.5 + 0.5 * ((tf - pk) / (1 - pk));
        const env = Math.pow(Math.max(0.001, Math.sin(Math.PI * tw)), 0.72);
        r = o.R * env * (0.3 + 0.7 * smoothstep(0, 0.1, tf));
      }
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const rr = Math.max(0.0008, r * (o.profileMod ? o.profileMod(t, a) : 1));
        out[j].x = Math.cos(a) * rr;
        out[j].y = Math.sin(a) * rr;
        out[j].u = j / sides;
      }
    },
    colorAt: (t, j) => o.colorAt(t, (j / sides) * TAU),
    upHint: up,
    tile: TILE.stem,
    vPerMeter: 2,
    organ: ORGAN.fruit,
    wind: wind(o.pivot, o.phase, 0.18, 0.3, 0.03, 0.08),
    capEnd: true,
    capScale: 0.35,
  };
}

/** Weld a blob fruit onto a parent at (t, dir). */
function weldFruit(bd: PlantBuilder, parent: TubeGrid, t: number, dir: V3, o: BlobOpts): TubeGrid | null {
  const f = bd.frameAt(parent, clamp(t, 0.03, 0.985));
  const origin = addScaled(f.center, dir, f.radius * 0.7);
  const [w, h] = windowF(o.sides);
  return bd.weld(parent, t, dir, w, h, blobSpec(origin, dir, UP, o), { collarRings: 1, collarScale: 0.5, margin: 0, search: 10 });
}

/** Local window lookup (defined again for the grain section below). */
function windowF(sides: number): [number, number] {
  if (sides <= 6) return [1, 2];
  if (sides <= 8) return [2, 2];
  if (sides <= 10) return [2, 3];
  if (sides <= 12) return [3, 3];
  if (sides <= 14) return [3, 4];
  return [4, 4];
}

/** Serrated sword-leaf rosette, diamond-scaled fruit, leafy crown on top. */
function buildPineapple(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.07, b.trunkRadius * 1.7), Math.max(0.22, b.trunkHeight * 1.4));
  const cA = col(b.leafColor);
  const n = Math.max(8, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = (i + 0.5) / n; // 0 oldest outer .. 1 youngest inner
    const az = i * 137.5 * DEG + rng.bell() * 0.12;
    const t = rng.range(0.42, 0.8);
    const dir = dirFromAzEl(az, lerp(0.12, 1.3, Math.pow(age, 1.3)));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const fresh = mixRgb(mixRgb(cA, [0.74, 0.79, 0.7], 0.18), col(b.leafColor2), age * 0.45);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1.05, 0.55, age) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.1),
      petioleRatio: Math.max(0.04, b.petioleRatio),
      arc: b.bladeArc * lerp(1.25, 0.35, age), // outer leaves recurve, heart leaves stand up
      bladeEl: (90 - b.bladePitch) * DEG * lerp(0.4, 1.15, age) + rng.bell() * 0.05,
      notch: b.bladeNotch, notchCount: 16, lobes: 0, peak: b.bladePeak, vee: b.bladeVee,
      unfurl: 1 - smoothstep(0.88, 1, age) * 0.55,
      colorA: fresh, colorB: tint(fresh, 1.1), petioleColor: tint(fresh, 0.85),
      pivot: origin, phase: rng.next(), limbBase: 0.06,
      rings: Math.round(p.mesh.bladeRings * p.mesh.quality), petioleR: 0.011,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(crown, t, dir, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale, margin: 0, search: 7 });
  }

  if (b.nutCount < 1) return;
  // Stout fruit stalk out of the rosette heart.
  const tf = bd.frameAt(crown, 0.86);
  const stalkO = addScaled(tf.center, UP, tf.radius * 0.6);
  const cStalk = col(b.rachisColor);
  const stalk = bd.weld(crown, 0.86, UP, 2, 3, {
    spine: bendSpine(stalkO, UP, 0.14, 6, () => 0),
    ringTs: evenRings(6),
    sides: 10,
    profileAt: (tt, out) => circleInto(out, 10, 0.024 * (1 - tt * 0.15), 0.024 * (1 - tt * 0.15)),
    colorAt: () => cStalk,
    upHint: v3(1, 0, 0),
    tile: TILE.stem,
    vPerMeter: 1.4,
    organ: ORGAN.rachis,
    wind: wind(stalkO, rng.next(), 0.05, 0.12, 0, 0.03),
    capEnd: true,
  }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
  if (!stalk) return;

  // The fruit: barrel of diamond scales, ripening gold from the bottom up.
  const R = Math.max(0.045, b.nutSize);
  const seed = rng.range(0, 30);
  const cGold = col(b.nutColor);
  const cGreen = col(b.nutColor2);
  const fruit = weldFruit(bd, stalk, 0.9, UP, {
    len: R * 2.15, R, sides: 14, rings: 18, peak: 0.42, stalk: 0.02,
    profileMod: (tt, a) => (1 - 0.16 * smoothstep(0.6, 1, tt)) * (1 + 0.05 * Math.cos(a * 7 + Math.floor(tt * 13) * 0.45) + 0.028 * Math.sin(tt * 13 * TAU)),
    colorAt: (tt, a) => {
      const row = Math.floor(tt * 13);
      const colI = Math.floor((a / TAU) * 14 + row * 0.5);
      const v = 0.86 + 0.24 * (0.5 + 0.5 * noise3(colI * 2.7 + seed, row * 3.1, seed));
      const ripe = clamp(0.95 - tt * 0.6 + (noise3(colI * 1.3, row * 1.7 + seed, seed)) * 0.22, 0, 1);
      return tint(ripenColor(ripe, cGreen, cGold), v);
    },
    pivot: stalkO, phase: rng.next(),
  });
  if (!fruit) return;

  // Crown of stiff leaves on the fruit top + a couple of basal slips.
  const crownLeaf = (parent: TubeGrid, t: number, az: number, el: number, lenF: number): void => {
    const f = bd.frameAt(parent, t);
    const dir = dirFromAzEl(az, el);
    const origin = addScaled(f.center, dir, f.radius * 0.65);
    const cL = mixRgb(cA, col(b.leafColor2), rng.range(0.4, 0.7));
    const spec = bladeLeafSpec(origin, dir, {
      len: lenF * rng.range(0.9, 1.15), width: b.bladeWidth * 0.55,
      petioleRatio: 0.08, arc: rng.range(0.3, 0.6), bladeEl: (90 - b.bladePitch) * DEG,
      notch: b.bladeNotch * 0.7, notchCount: 10, lobes: 0, peak: 0.35, vee: 0.4,
      unfurl: 1, colorA: cL, colorB: tint(cL, 1.1), petioleColor: tint(cL, 0.85),
      pivot: origin, phase: rng.next(), limbBase: 0.1,
      rings: 14, petioleR: 0.007,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(parent, t, dir, 2, 3, spec, { collarRings: 0, collarScale: 0.5, margin: 0, search: 7 });
  };
  const cn = 13;
  for (let i = 0; i < cn; i++) {
    const age = (i + 0.5) / cn;
    crownLeaf(fruit, rng.range(0.93, 0.99), i * 137.5 * DEG, lerp(0.5, 1.35, age), R * lerp(2.2, 1.2, age));
  }
  for (let s = 0; s < 2; s++) {
    const az = rng.range(0, TAU);
    for (let i = 0; i < 3; i++) crownLeaf(fruit, rng.range(0.05, 0.14), az + i * 2.1, rng.range(0.7, 1.1), R * 0.8);
  }
}

/** Soft single trunk, huge lobed leaves, fruit welded straight onto the trunk. */
function buildPapaya(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const sides = Math.max(12, p.mesh.trunkSides);
  const trunk = buildTrunk(bd, p, rng.fork(), v3(0, -0.15, 0), rng.range(0, TAU), 1, sides, {
    crownBand: 0.14, crownWindows: Math.round(b.frondCount) + 5, branchBand: [0.4, 0.88],
  });
  const cA = col(b.leafColor);
  const n = Math.max(5, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = n <= 1 ? 0.5 : i / (n - 1); // 0 oldest .. 1 youngest spear
    const az = i * 137.5 * DEG + rng.bell() * 0.12;
    const t = 0.995 - (1 - age) * 0.085;
    const dir = dirFromAzEl(az, lerp(0.12, 1.2, Math.pow(age, 1.4)));
    const f = bd.frameAt(trunk, clamp(t, 0.9, 0.995));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const fresh = mixRgb(cA, col(b.leafColor2), 0.25 + age * 0.4);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1, 0.5, age) * rng.range(0.92, 1.08),
      width: b.bladeWidth * lerp(1, 0.6, age) * rng.range(0.9, 1.08),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc * lerp(1.1, 0.5, age),
      bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.05,
      notch: b.bladeNotch, notchCount: 7, lobes: b.bladeLobes, peak: b.bladePeak, vee: b.bladeVee,
      unfurl: 1 - smoothstep(0.85, 1, age) * 0.65,
      colorA: fresh, colorB: tint(fresh, 1.1), petioleColor: col(b.rachisColor),
      pivot: origin, phase: rng.next(), limbBase: 0.25,
      rings: Math.round(p.mesh.bladeRings * 1.1 * p.mesh.quality), petioleR: 0.019,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(trunk, clamp(t, 0.9, 0.995), dir, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale, margin: 0, search: 8 });
  }
  // Cauliflorous fruit column: big ripe fruit low, small green ones up top.
  const cRipe = col(b.nutColor);
  const cGreen = col(b.nutColor2);
  const nf = clamp(Math.round(b.nutCount), 0, 14);
  for (let i = 0; i < nf; i++) {
    const u = nf <= 1 ? 0.5 : i / (nf - 1);
    const t = lerp(0.46, 0.86, u) + rng.bell() * 0.012;
    const az = i * 137.5 * DEG + rng.bell() * 0.3;
    const dir = dirFromAzEl(az, rng.range(-0.75, -0.4));
    const sizeF = lerp(1.12, 0.42, u) * rng.range(0.9, 1.08);
    const ripe = clamp(1.1 - u * 1.15 + rng.bell() * 0.12, 0, 1);
    weldFruit(bd, trunk, clamp(t, 0.42, 0.88), dir, {
      len: b.nutSize * 2.35 * sizeF, R: b.nutSize * 0.64 * sizeF, sides: 12, rings: 14, peak: 0.55, stalk: 0.07,
      colorAt: (tt, a) => tint(ripenColor(clamp(ripe - tt * 0.12, 0, 1), cGreen, cRipe), 0.95 + 0.07 * Math.cos(a * 10)),
      pivot: v3(0, (b.trunkHeight * t), 0), phase: rng.next(),
    });
  }
  // Waxy white flowers in the upper leaf axils.
  for (let i = 0; i < 3; i++) {
    const t = rng.range(0.8, 0.88);
    const dir = dirFromAzEl(rng.range(0, TAU), 0.15);
    const f = bd.frameAt(trunk, t);
    buildStarFlower(bd, p, rng.fork(), trunk, t, dir, addScaled(f.center, dir, f.radius * 0.8), 0.017, 0.045, col('#f6f2df'), col('#ecd27a'));
  }
  buildStiltRoots(bd, p, rng.fork(), trunk);
}

/** Shared scaffold for the branching fruit trees (citrus, mango). */
function fruitTreeScaffold(bd: PlantBuilder, p: PlantParams, rng: Random, tipCluster: boolean): Shoot[] {
  const b = p.botany;
  const sides = Math.max(12, p.mesh.trunkSides);
  const trunk = buildTrunk(bd, p, rng.fork(), v3(0, -0.15, 0), rng.range(0, TAU), 1, sides, {
    crownBand: 0.2, crownWindows: 8, branchBand: [0.38, 0.97],
  });
  const shoots: Shoot[] = [];
  growShoots(bd, p, rng.fork(), trunk, b.trunkHeight * 0.95, b.trunkRadius * 0.62, 0, shoots);
  const maxLevel = Math.max(...shoots.map((s) => s.level), 0);
  for (const s of shoots) {
    if (s.level === 0) continue;
    if (tipCluster && s.level >= maxLevel) placeLeaves(bd, p, rng.fork(), s.grid, true, rng.range(0.85, 1.05));
    else placeLeaves(bd, p, rng.fork(), s.grid, false, s.level >= maxLevel ? 1 : 0.55);
  }
  buildStiltRoots(bd, p, rng.fork(), trunk);
  return shoots;
}

/** Glossy evergreen canopy, round oranges with navels, white blossom. */
function buildCitrus(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const shoots = fruitTreeScaffold(bd, p, rng, false);
  const outer = shoots.filter((s) => s.level >= 1);
  if (outer.length === 0) return;
  const cRipe = col(b.nutColor);
  const cGreen = col(b.nutColor2);
  const nf = clamp(Math.round(b.nutCount), 0, 24);
  for (let i = 0; i < nf; i++) {
    const s = outer[Math.floor(rng.next() * outer.length)];
    const t = rng.range(0.3, 0.85);
    const f = bd.frameAt(s.grid, t);
    const dir = normalize(add(addScaled(scale(f.U, Math.cos(rng.range(0, TAU))), f.V, Math.sin(rng.range(0, TAU))), v3(0, -0.75, 0)));
    const ripe = rng.next() < 0.78 ? rng.range(0.85, 1) : rng.range(0.05, 0.5);
    const R = Math.max(0.02, b.nutSize) * rng.range(0.85, 1.08);
    const seed = rng.range(0, 30);
    weldFruit(bd, s.grid, t, dir, {
      len: R * 2.15, R, sides: 12, rings: 13, peak: 0.48, stalk: 0.16,
      profileMod: (tt) => 1 - 0.17 * Math.exp(-Math.pow((tt - 0.99) / 0.035, 2)), // navel dimple
      colorAt: (tt) => tint(ripenColor(ripe, cGreen, cRipe), (tt < 0.16 ? 0.72 : 1) * (0.94 + 0.1 * noise3(seed, tt * 22, seed))),
      pivot: f.center, phase: rng.next(),
    });
  }
  for (let i = 0; i < 4; i++) {
    const s = outer[Math.floor(rng.next() * outer.length)];
    const t = rng.range(0.4, 0.9);
    const f = bd.frameAt(s.grid, t);
    const dir = normalize(add(f.T, v3(rng.bell() * 0.4, 0.7, rng.bell() * 0.4)));
    buildStarFlower(bd, p, rng.fork(), s.grid, t, dir, addScaled(f.center, dir, f.radius * 0.8), 0.013, 0.03, col('#f8f6ee'), col('#f2d574'));
  }
}

/** Dense canopy with bronze flush; mangoes hanging on strings at the tips. */
function buildMango(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const shoots = fruitTreeScaffold(bd, p, rng, true);
  const maxLevel = Math.max(...shoots.map((s) => s.level), 0);
  const tips = shoots.filter((s) => s.level >= maxLevel);
  if (tips.length === 0) return;
  const cGold = col(b.nutColor);
  const cBlush = col(b.nutColor2);
  const cUnripe: RGB = [0.5, 0.62, 0.28];
  const clusters = clamp(Math.round(b.nutCount), 0, 14);
  const cString = tint(col(b.rachisColor), 0.9);
  for (let ci = 0; ci < clusters; ci++) {
    const s = tips[Math.floor(rng.next() * tips.length)];
    const t = rng.range(0.42, 0.72);
    const f = bd.frameAt(s.grid, t);
    const dir = normalize(add(addScaled(scale(f.U, rng.bell() * 0.5), f.V, rng.bell() * 0.5), v3(0, -1, 0)));
    const origin = addScaled(f.center, dir, f.radius * 0.75);
    const strLen = rng.range(0.11, 0.17);
    const string = bd.weld(s.grid, t, dir, 1, 2, {
      spine: bendSpine(origin, dir, strLen, 6, (sv) => -(0.5 / strLen) * sv),
      ringTs: evenRings(12),
      sides: 6,
      profileAt: (tt, out) => circleInto(out, 6, 0.0028 * (1 - tt * 0.3), 0.0028 * (1 - tt * 0.3)),
      colorAt: () => cString,
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: wind(origin, rng.next(), 0.2, 0.35, 0.05, 0.12),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 10 });
    if (!string) continue;
    const nm = 1 + Math.floor(rng.next() * 3);
    for (let mi = 0; mi < nm; mi++) {
      const mt = 0.68 + mi * 0.15 + rng.bell() * 0.02;
      const mf = bd.frameAt(string, clamp(mt, 0.6, 0.98));
      const mdir = normalize(add(addScaled(scale(mf.U, rng.bell() * 0.45), mf.V, rng.bell() * 0.45), v3(0, -1, 0)));
      const R = Math.max(0.024, b.nutSize * 0.85) * rng.range(0.85, 1.1);
      const blushAz = rng.range(0, TAU);
      const ripe = rng.range(0.4, 1);
      weldFruit(bd, string, clamp(mt, 0.6, 0.985), mdir, {
        len: b.nutSize * 2.3 * rng.range(0.9, 1.1), R, sides: 10, rings: 13, peak: 0.58, stalk: 0.1, bend: 0.38,
        colorAt: (tt, a) => {
          let c = ripenColor(clamp(ripe * (0.35 + tt * 0.75), 0, 1), cUnripe, cGold);
          const blush = Math.pow(0.5 + 0.5 * Math.cos(a - blushAz), 2.5) * smoothstep(0.25, 0.85, tt) * ripe;
          c = mixRgb(c, cBlush, blush * 0.75);
          return tint(c, tt < 0.1 ? 0.75 : 1);
        },
        pivot: origin, phase: rng.next(),
      });
    }
  }
}

/** Gnarled trunk, cordons, drooping shoots with tendrils and grape bunches. */
function buildGrape(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const sides = Math.max(12, p.mesh.trunkSides);
  const trunk = buildTrunk(bd, p, rng.fork(), v3(0, -0.15, 0), rng.range(0, TAU), 1, sides, {
    crownBand: 0.3, crownWindows: 10, branchBand: [0.55, 0.98],
  });
  const shoots: Shoot[] = [{ grid: trunk, level: 0 }];
  const cordons = 3;
  for (let i = 0; i < cordons; i++) {
    const t = 0.8 + i * 0.07;
    const az = (i / cordons) * TAU + rng.bell() * 0.4;
    const f = bd.frameAt(trunk, t);
    const dir = dirFromAzEl(az, rng.range(0.02, 0.32));
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const len = rng.range(0.6, 0.85);
    const arm = buildBranch(bd, p, rng.fork(), trunk, origin, dir, len, 0.026, 1, t, false);
    if (arm) growShoots(bd, p, rng.fork(), arm, len, 0.026, 1, shoots);
  }
  for (const s of shoots) {
    if (s.level === 0) continue;
    placeLeaves(bd, p, rng.fork(), s.grid, false, s.level >= 2 ? 1.15 : 0.5);
  }
  // Curly tendrils feeling for support.
  const leafy = shoots.filter((s) => s.level >= 2);
  const cTendril = tint(col(b.rachisColor), 1.05);
  for (let i = 0; i < 5 && leafy.length > 0; i++) {
    const s = leafy[Math.floor(rng.next() * leafy.length)];
    const t = rng.range(0.3, 0.85);
    const f = bd.frameAt(s.grid, t);
    const ang = rng.range(0, TAU);
    const dir = normalize(add(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)), v3(0, -0.25, 0)));
    const origin = addScaled(f.center, dir, f.radius * 0.75);
    const tl = rng.range(0.1, 0.15);
    bd.weld(s.grid, t, dir, 1, 2, {
      spine: bendSpine(origin, dir, tl, 16, (sv) => -(0.4 / tl) * sv, (sv) => Math.sin(sv * TAU * 3.2) * 2.4 / tl * 0.16),
      ringTs: evenRings(14),
      sides: 6,
      profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0005, 0.0013 * (1 - tt * 0.5)), Math.max(0.0005, 0.0013 * (1 - tt * 0.5))),
      colorAt: () => cTendril,
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: wind(origin, rng.next(), 0.25, 0.4, 0.1, 0.25),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.4, margin: 0, search: 6 });
  }
  // Conical bunches: berries on a little branched framework, dusted with bloom.
  const cBerry = col(b.nutColor);
  const cBloom = col(b.nutColor2);
  const cRachis = col(b.rachisColor);
  const bunches = clamp(Math.round(b.nutCount), 0, 8);
  for (let bi = 0; bi < bunches && leafy.length > 0; bi++) {
    const s = leafy[Math.floor(rng.next() * leafy.length)];
    const t = rng.range(0.14, 0.38);
    const f = bd.frameAt(s.grid, t);
    const dir = normalize(add(addScaled(scale(f.U, rng.bell() * 0.4), f.V, rng.bell() * 0.4), v3(0, -1, 0)));
    const origin = addScaled(f.center, dir, f.radius * 0.75);
    const axisLen = rng.range(0.15, 0.19);
    const axis = bd.weld(s.grid, t, dir, 2, 2, {
      spine: bendSpine(origin, dir, axisLen, 8, (sv) => -(0.3 / axisLen) * sv),
      ringTs: evenRings(20),
      sides: 8,
      profileAt: (tt, out) => circleInto(out, 8, Math.max(0.0012, 0.0038 * (1 - tt * 0.55)), Math.max(0.0012, 0.0038 * (1 - tt * 0.55))),
      colorAt: () => cRachis,
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: wind(origin, rng.next(), 0.2, 0.32, 0.04, 0.1),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
    if (!axis) continue;
    const berry = (parent: TubeGrid, bt: number, coneT: number): void => {
      const bf = bd.frameAt(parent, clamp(bt, 0.05, 0.98));
      const ang = rng.range(0, TAU);
      const bdir = normalize(addScaled(scale(bf.U, Math.cos(ang)), bf.V, Math.sin(ang)));
      const dir2 = normalize(add(addScaled(bf.T, bdir, 1.15), v3(0, -0.3, 0)));
      const R = Math.max(0.007, b.nutSize) * rng.range(0.85, 1.15) * (1.12 - 0.4 * coneT);
      const bloom = rng.range(0.15, 0.6);
      const cB = tint(mixRgb(cBerry, cBloom, bloom), rng.range(0.85, 1.08));
      weldFruit(bd, parent, clamp(bt, 0.05, 0.985), dir2, {
        len: R * 2.1, R, sides: 10, rings: 8, peak: 0.48, stalk: 0.24,
        colorAt: (tt) => tt < 0.24 ? cRachis : cB,
        pivot: origin, phase: rng.next(),
      });
    };
    for (let i = 0; i < 9; i++) berry(axis, 0.1 + (i / 9) * 0.88 + rng.bell() * 0.02, i / 9);
    const branchlets = 7;
    for (let i = 0; i < branchlets; i++) {
      const bt = 0.08 + (i / branchlets) * 0.62;
      const bf = bd.frameAt(axis, bt);
      const ang = i * 137.5 * DEG;
      const bdir = normalize(addScaled(scale(bf.U, Math.cos(ang)), bf.V, Math.sin(ang)));
      const dir2 = normalize(addScaled(bf.T, bdir, 0.9));
      const bo = addScaled(bf.center, dir2, bf.radius * 0.7);
      const bl = rng.range(0.04, 0.06) * (1 - bt * 0.4);
      const br = bd.weld(axis, bt, dir2, 1, 2, {
        spine: bendSpine(bo, dir2, bl, 5, (sv) => -(0.5 / bl) * sv),
        ringTs: evenRings(8),
        sides: 6,
        profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0008, 0.002 * (1 - tt * 0.4)), Math.max(0.0008, 0.002 * (1 - tt * 0.4))),
        colorAt: () => cRachis,
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 2,
        organ: ORGAN.rachis,
        wind: wind(origin, rng.next(), 0.2, 0.32, 0.05, 0.12),
        capEnd: true,
      }, { collarRings: 0, collarScale: 0.45, margin: 0 });
      if (!br) continue;
      const nb = 4;
      for (let k = 0; k < nb; k++) berry(br, 0.25 + (k / Math.max(1, nb - 1)) * 0.72, bt + k * 0.03);
    }
  }
  buildStiltRoots(bd, p, rng.fork(), trunk);
}

/** Trailing vine, deeply lobed grey-green leaves, striped melons on the ground. */
function buildWatermelon(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.045, b.trunkRadius * 2), Math.max(0.12, b.trunkHeight * 0.8));
  const cA = col(b.leafColor);
  const nl = Math.max(4, Math.round(b.frondCount));
  for (let i = 0; i < nl; i++) {
    const age = (i + 0.5) / nl;
    const az = i * 137.5 * DEG + rng.bell() * 0.15;
    const t = rng.range(0.55, 0.82);
    const dir = dirFromAzEl(az, lerp(0.35, 1.0, age));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const fresh = mixRgb(cA, col(b.leafColor2), 0.2 + age * 0.35);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1.05, 0.6, age) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc, bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.06,
      notch: b.bladeNotch, notchCount: 6, lobes: b.bladeLobes, peak: b.bladePeak, vee: b.bladeVee,
      unfurl: 1 - smoothstep(0.88, 1, age) * 0.6,
      colorA: fresh, colorB: tint(fresh, 1.08), petioleColor: col(b.rachisColor),
      pivot: origin, phase: rng.next(), limbBase: 0.05,
      rings: Math.round(p.mesh.bladeRings * 1.1 * p.mesh.quality), petioleR: 0.011,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(crown, t, dir, 2, 3, spec, { collarRings: p.mesh.collarRings, collarScale: p.mesh.collarScale, margin: 0, search: 7 });
  }
  const cDark = col(b.nutColor);
  const cLight = col(b.nutColor2);
  const melons = clamp(Math.round(b.nutCount), 0, 4);
  const vines = melons + 1;
  for (let i = 0; i < vines; i++) {
    const az = rng.range(0, TAU);
    const t = rng.range(0.35, 0.5);
    const f = bd.frameAt(crown, t);
    const dirH = v3(Math.cos(az), 0, Math.sin(az));
    const vo = addScaled(f.center, dirH, f.radius * 0.8);
    const vineLen = rng.range(0.6, 0.95);
    const side = v3(-dirH.z, 0, dirH.x);
    const wiggle = rng.range(-0.12, 0.12);
    const vine = bd.weld(crown, t, dirFromAzEl(az, 0.1), 2, 2, {
      spine: [
        vo,
        v3(vo.x + dirH.x * vineLen * 0.45 + side.x * wiggle, Math.max(0.03, vo.y - 0.04), vo.z + dirH.z * vineLen * 0.45 + side.z * wiggle),
        v3(vo.x + dirH.x * vineLen + side.x * wiggle * 1.6, 0.035, vo.z + dirH.z * vineLen + side.z * wiggle * 1.6),
      ],
      ringTs: evenRings(14),
      sides: 8,
      profileAt: (tt, out) => circleInto(out, 8, Math.max(0.004, 0.011 * (1 - tt * 0.35)), Math.max(0.004, 0.011 * (1 - tt * 0.35))),
      colorAt: () => col(b.rachisColor),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 1.4,
      organ: ORGAN.rachis,
      wind: NO_WIND(vo),
      capEnd: true,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 7 });
    if (!vine) continue;
    // A leaf or two out along the vine.
    placeOneLeaf(bd, p, rng.fork(), vine, rng.range(0.35, 0.55), rng.range(0, TAU), 0.75);
    if (i >= melons) continue;
    const pf = bd.frameAt(vine, 0.72);
    const R = Math.max(0.06, b.nutSize) * rng.range(0.9, 1.12);
    const po = v3(pf.center.x, Math.max(0.012, pf.center.y - 0.015), pf.center.z);
    bd.weld(vine, 0.72, UP, 4, 4, {
      spine: [po, v3(po.x, po.y + R * 0.75, po.z), v3(po.x, po.y + R * 1.5, po.z)],
      ringTs: evenRings(15),
      sides: 16,
      profileAt: (tt, out) => {
        const env = Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * tt)), 0.5);
        const ea = 1.32, eb = 0.94; // elongated footprint: melons lie on their side
        for (let j = 0; j < 16; j++) {
          const a = (j / 16) * TAU;
          const re = (ea * eb) / Math.sqrt(Math.pow(eb * Math.cos(a), 2) + Math.pow(ea * Math.sin(a), 2));
          const r = Math.max(0.004, R * env * re);
          out[j].x = Math.cos(a) * r; out[j].y = Math.sin(a) * r; out[j].u = j / 16;
        }
      },
      colorAt: (tt, j) => {
        const a = (j / 16) * TAU;
        const stripe = smoothstep(0.22, 0.58, 0.5 + 0.5 * Math.cos(a * 9 + 1.3 * Math.sin(tt * 3.4)));
        let c = mixRgb(cLight, cDark, stripe);
        c = mixRgb(c, [0.85, 0.79, 0.52], smoothstep(0.22, 0.04, tt) * 0.55); // pale field spot underneath
        if (tt > 0.94) c = mixRgb(c, [0.42, 0.46, 0.26], smoothstep(0.94, 1, tt)); // stem scar
        return c;
      },
      upHint: v3(1, 0, 0),
      tile: TILE.stem,
      vPerMeter: 1.6,
      organ: ORGAN.fruit,
      wind: NO_WIND(po),
      capEnd: true,
      capScale: 0.3,
    }, { collarRings: 1, collarScale: 0.45, margin: 0, search: 6 });
  }
  for (let i = 0; i < 2; i++) {
    const t = rng.range(0.5, 0.7);
    const f = bd.frameAt(crown, t);
    const dir = dirFromAzEl(rng.range(0, TAU), 0.8);
    buildStarFlower(bd, p, rng.fork(), crown, t, dir, addScaled(f.center, dir, f.radius * 0.8), 0.03, 0.1, col('#f4d03a'), col('#e8a81e'));
  }
}

function buildFruit(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  switch (p.botany.fruitType) {
    case 'pineapple': buildPineapple(bd, p, rng); break;
    case 'papaya': buildPapaya(bd, p, rng); break;
    case 'citrus': buildCitrus(bd, p, rng); break;
    case 'mango': buildMango(bd, p, rng); break;
    case 'grape': buildGrape(bd, p, rng); break;
    case 'watermelon': buildWatermelon(bd, p, rng); break;
  }
}

// -----------------------------------------------------------------------------
// Habit: carnivore (flytrap, nepenthes, sarracenia, cobra lily, sundew,
// butterwort)
//
// The hard constraint is the same as everywhere: one closed genus-0 mesh.
// So no pitcher is a real open tube — mouths are faked with a flared,
// striped peristome ring shading into a dark "throat" cap, and lids /
// hoods arch over them. The flytrap reuses the folded-leaflet profile
// upside-down, so the Λ fold becomes the trap's open V valley.
// -----------------------------------------------------------------------------

/** Smooth radius envelope through [t, value] control points. */
function profileCurve(pts: [number, number][], t: number): number {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      return lerp(v0, v1, smoothstep(t0, t1, t));
    }
  }
  return pts[pts.length - 1][1];
}

/** Smallest signed angular difference a-b in [-π, π]. */
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/* ------------------------------- Venus flytrap ------------------------------ */

function buildFlytrap(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.026, b.trunkRadius * 1.2), Math.max(0.035, b.trunkHeight));
  const cLeaf = col(b.leafColor);
  const cLeaf2 = col(b.leafColor2);
  const cRed = col(b.nutColor);
  const n = Math.max(4, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = (i + 0.5) / n; // 0 outer flat leaves .. 1 upright centre
    const az = i * 137.5 * DEG + rng.bell() * 0.2;
    const t = rng.range(0.48, 0.78);
    const dir = dirFromAzEl(az, lerp(0.06, 0.9, Math.pow(age, 1.5)));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const phase = rng.next();
    // Flat winged petiole lying on the ground.
    const petLen = b.leafLength * clamp(b.petioleRatio, 0.2, 0.8) * rng.range(0.85, 1.1);
    const pet = bd.weld(crown, t, dir, 1, 2, leafletSpec(origin, dir, UP, {
      len: petLen, width: 0.016, droop: b.bladeArc * 0.5, twistRad: rng.bell() * 0.2,
      colorA: mixRgb(cLeaf, cLeaf2, rng.next() * 0.4), colorB: cLeaf2,
      windPhase: phase, pivot: origin, limbBase: 0.05, rings: 8, fold: 0.35,
      organ: ORGAN.leaf, tile: TILE.leafLong,
    }, rng.fork()), { collarRings: 0, collarScale: 0.5, margin: 0, search: 7 });
    if (!pet) continue;
    // The trap: folded leaflet profile flipped so the ridge points down and
    // the two lobes form an open V valley, crimson inside, green outside.
    const closed = i === 1 || i === 4; // a couple of sprung traps digesting
    const tf = bd.frameAt(pet, 0.96);
    const tdir = normalize(add(tf.T, v3(0, closed ? 0.25 : 0.5, 0)));
    const torigin = addScaled(tf.center, tdir, tf.radius * 0.5);
    const trapLen = Math.max(0.016, b.nutSize) * rng.range(0.85, 1.15);
    const trapW = trapLen * 0.88;
    const trap = bd.weld(pet, 0.96, tdir, 1, 2, {
      spine: bendSpine(torigin, tdir, trapLen, 6, (s) => (0.3 / trapLen) * s),
      ringTs: evenRings(9),
      sides: 6,
      profileAt: (tt, out) => {
        const halfW = (trapW / 2) * Math.pow(Math.max(0.01, Math.sin(Math.PI * (0.08 + 0.84 * tt))), 0.55) * (0.35 + 0.65 * smoothstep(0, 0.15, tt));
        const fold = Math.max(0.0008, halfW * (closed ? 0.55 : 1.05));
        leafletInto(out, Math.max(0.0008, halfW), fold, halfW * (closed ? 1.0 : 0.55));
      },
      colorAt: (tt, j) => {
        const mid = Math.exp(-Math.pow((tt - 0.5) / 0.36, 2));
        const green = mixRgb(cLeaf, cLeaf2, 0.3 + 0.3 * tt);
        if (j === 5) return tint(green, 0.92); // outer keel
        const inner = j === 2 ? 0.55 + 0.45 * mid : (j === 1 || j === 3) ? 0.38 + 0.48 * mid : 0.2 + 0.3 * mid;
        return mixRgb(green, cRed, closed ? inner * 0.45 : inner);
      },
      upHint: v3(0, -1, 0), // ridge down → valley opens to the sky
      tile: TILE.leafLong,
      vPerMeter: 2,
      organ: ORGAN.leaf,
      wind: wind(origin, phase, 0.05, 0.12, 0.02, 0.08),
      capEnd: true,
      capScale: 0.8,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
    if (!trap) continue;
    // Cilia: the interlocking eyelash teeth along both lobe margins.
    const cTooth = mixRgb(cLeaf2, cRed, 0.35);
    for (let k = 0; k < 5; k++) {
      const tt = 0.2 + k * 0.155;
      const gf = bd.frameAt(trap, tt);
      for (const sd of [-1, 1]) {
        const toothDir = normalize(add(addScaled(scale(gf.U, sd * 0.85), gf.V, -1.0), scale(gf.T, 0.08)));
        const toothLen = trapLen * 0.24 * (closed ? 0.75 : 1) * (1 - Math.abs(tt - 0.52) * 0.55) * rng.range(0.9, 1.1);
        bd.weld(trap, tt, toothDir, 1, 2, {
          spine: bendSpine(addScaled(gf.center, toothDir, gf.radius * 0.55), toothDir, toothLen, 3, (s) => -(0.35 / toothLen) * s),
          ringTs: evenRings(3),
          sides: 6,
          profileAt: (t2, out) => circleInto(out, 6, Math.max(0.0003, 0.00055 * (1 - t2 * 0.65)), Math.max(0.0003, 0.00055 * (1 - t2 * 0.65))),
          colorAt: () => cTooth,
          upHint: UP,
          tile: TILE.stem,
          vPerMeter: 3,
          organ: ORGAN.leaf,
          wind: wind(origin, phase, 0.08, 0.15, 0.05, 0.15),
          capEnd: true,
        }, { collarRings: 0, collarScale: 0.35, margin: 0 });
      }
    }
  }
  // White flowers held high above the traps so pollinators survive.
  const nf = clamp(Math.round(b.nutCount), 0, 3);
  for (let i = 0; i < nf; i++) {
    const t = rng.range(0.6, 0.8);
    const f = bd.frameAt(crown, t);
    const dir = dirFromAzEl(rng.range(0, TAU), rng.range(1.1, 1.4));
    buildStarFlower(bd, p, rng.fork(), crown, t, dir, addScaled(f.center, dir, f.radius * 0.75), 0.008, 0.2, col(b.nutColor2), col('#e8e2c8'));
  }
}

/* -------------------------------- Nepenthes --------------------------------- */

function buildNepenthes(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const nodes = Math.max(6, Math.round(b.frondCount));
  const H = Math.max(0.4, b.trunkHeight);
  // Winding climbing stem with a leaf (and usually a pitcher) at every node.
  const spinePts: V3[] = [v3(0, -0.08, 0)];
  let px = 0, pz = 0;
  for (let i = 1; i <= nodes; i++) {
    px += rng.bell() * 0.02;
    pz += rng.bell() * 0.02;
    spinePts.push(v3(px, -0.08 + (H + 0.08) * (i / nodes), pz));
  }
  const cStem = col(b.trunkColor);
  const stem = bd.tube({
    spine: spinePts,
    ringTs: evenRings(nodes * 3),
    sides: 10,
    profileAt: (t, out) => {
      const nodePulse = 1 + 0.18 * Math.pow(0.5 + 0.5 * Math.cos(t * nodes * TAU), 2);
      const r = Math.max(0.004, b.trunkRadius * (1.25 - 0.5 * t) * nodePulse * (1 + 0.6 * Math.exp(-t * 10)));
      circleInto(out, 10, r, r);
    },
    colorAt: (t) => tint(mixRgb(cStem, col(b.rachisColor), t * 0.6), 0.9 + 0.15 * t),
    upHint: v3(1, 0, 0),
    tile: TILE.stem,
    vPerMeter: 1.2,
    organ: ORGAN.trunk,
    wind: wind(v3(0, 0, 0), rng.next(), 0, 0.25, 0, 0.1),
    capStart: true,
    capEnd: true,
    capScale: 0.6,
  });
  const cA = col(b.leafColor);
  const cRed = col(b.nutColor);
  const cCream = col(b.nutColor2);
  const pitcherTotal = clamp(Math.round(b.nutCount), 0, nodes);
  const firstPitcher = Math.max(0, nodes - pitcherTotal - 1);
  for (let i = 0; i < nodes; i++) {
    const h01 = nodes <= 1 ? 0.5 : i / (nodes - 1);
    const t = (i + 0.55) / (nodes + 0.4);
    const f = bd.frameAt(stem, clamp(t, 0.04, 0.985));
    const az = i * b.phyllotaxis * DEG + rng.bell() * 0.1;
    const dir = dirFromAzEl(az, lerp(0.42, 0.85, h01) + rng.bell() * 0.08);
    const origin = addScaled(f.center, dir, f.radius * 0.85);
    const phase = rng.next();
    const fresh = mixRgb(cA, col(b.leafColor2), 0.2 + h01 * 0.35);
    const leafSpec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1.05, 0.8, h01) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc * rng.range(0.85, 1.1),
      bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.05,
      notch: 0, lobes: 0, peak: b.bladePeak, vee: b.bladeVee,
      midribPale: 0.25,
      unfurl: 1 - smoothstep(0.92, 1, h01) * 0.6,
      colorA: fresh, colorB: tint(fresh, 1.1), petioleColor: mixRgb(col(b.rachisColor), cRed, 0.25),
      pivot: origin, phase, limbBase: 0.25,
      rings: Math.round(p.mesh.bladeRings * 0.9 * p.mesh.quality), petioleR: 0.005,
    }, rng.fork());
    leafSpec.tile = TILE.leafLong;
    const leaf = bd.weld(stem, clamp(t, 0.04, 0.985), dir, 2, 3, leafSpec, { collarRings: 1, collarScale: 0.55, margin: 0, search: 8 });
    if (!leaf || i < firstPitcher) continue;
    // The midrib runs on past the blade as a tendril, then inflates.
    const lf = bd.frameAt(leaf, 0.985);
    const ground = h01 < 0.3;
    const tendrilLen = lerp(0.07, 0.17, h01) * rng.range(0.85, 1.15);
    const cTendril = mixRgb(col(b.rachisColor), cRed, 0.45);
    const tendril = bd.weld(leaf, 0.985, lf.T, 1, 2, {
      spine: bendSpine(addScaled(lf.center, lf.T, lf.radius * 0.5), lf.T, tendrilLen, 8, (s) => -((ground ? 2.3 : 1.55) / tendrilLen) * s),
      ringTs: evenRings(8),
      sides: 6,
      profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0008, 0.0016 * (1 - tt * 0.25)), Math.max(0.0008, 0.0016 * (1 - tt * 0.25))),
      colorAt: () => cTendril,
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: wind(origin, phase, 0.3, 0.45, 0.08, 0.2),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.45, margin: 0, search: 6 });
    if (!tendril) continue;
    // Pitcher: hanging tube, striped peristome + dark throat fake the mouth.
    const pf = bd.frameAt(tendril, 0.96);
    const pdir = normalize(add(scale(pf.T, 0.35), v3(0, -1, 0)));
    const R = Math.max(0.02, b.nutSize) * lerp(1.22, 0.72, h01) * rng.range(0.9, 1.1);
    const pLen = R * lerp(2.5, 3.7, h01) * rng.range(0.92, 1.08);
    const seed = rng.range(0, 30);
    const wingAmt = ground ? 1 : 0.4;
    const porigin = addScaled(pf.center, pdir, pf.radius * 0.5);
    const pitcher = bd.weld(tendril, 0.96, pdir, 3, 3, {
      spine: bendSpine(porigin, pdir, pLen, 10, (s) => (0.22 / pLen) * s),
      ringTs: evenRings(20),
      sides: 12,
      profileAt: (tt, out) => {
        const env = profileCurve([[0, 0.3], [0.05, 1.06], [0.12, 0.94], [0.26, 0.78], [0.5, 0.9], [0.66, 1], [0.85, 0.7], [1, 0.2]], tt);
        const wingEnv = smoothstep(0.08, 0.22, tt) * (1 - smoothstep(0.78, 0.98, tt)) * wingAmt;
        for (let j = 0; j < 12; j++) {
          const a = (j / 12) * TAU;
          let r = R * env;
          // Two fringed wings run down the front (a = π).
          r *= 1 + 0.3 * wingEnv * (Math.exp(-Math.pow(angDiff(a, Math.PI - 0.38) / 0.17, 2)) + Math.exp(-Math.pow(angDiff(a, Math.PI + 0.38) / 0.17, 2)));
          out[j].x = Math.cos(a) * Math.max(0.0012, r);
          out[j].y = Math.sin(a) * Math.max(0.0012, r);
          out[j].u = j / 12;
        }
      },
      colorAt: (tt, j) => {
        const a = (j / 12) * TAU;
        let c = mixRgb(cCream, tint(col(b.leafColor2), 1.05), 0.25 + h01 * 0.4);
        const sp = noise3(Math.cos(a) * 3 + seed, tt * 9, Math.sin(a) * 3);
        c = mixRgb(c, cRed, smoothstep(0.3, 0.52, sp) * 0.85); // maroon speckles
        c = mixRgb(c, cRed, (1 - h01) * smoothstep(0.45, 0.92, tt) * 0.45); // ground pitchers flush red
        if (tt < 0.15) {
          const stripe = 0.5 + 0.5 * Math.cos(a * 20);
          c = mixRgb(c, mixRgb(cRed, cCream, stripe * 0.75), smoothstep(0.15, 0.1, tt) * 0.95); // peristome
        }
        if (tt < 0.05) c = mixRgb(c, [0.13, 0.05, 0.07], smoothstep(0.05, 0.015, tt) * 0.9); // throat
        return c;
      },
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.fruit,
      wind: wind(origin, phase, 0.32, 0.5, 0.06, 0.18),
      capEnd: true,
      capScale: 0.45,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
    if (!pitcher) continue;
    // Lid (operculum) held over the mouth on the back rim.
    const mf = bd.frameAt(pitcher, 0.05);
    const lidDir = normalize(add(addScaled(scale(mf.T, -0.8), mf.U, 0.5), v3(0, 0.25, 0)));
    const lidOrigin = addScaled(mf.center, lidDir, mf.radius * 0.55);
    bd.weld(pitcher, 0.05, lidDir, 1, 2, leafletSpec(lidOrigin, lidDir, mf.V, {
      len: R * 1.75, width: R * 1.4, droop: 0.85, twistRad: 0,
      colorA: mixRgb(cRed, cCream, 0.35), colorB: mixRgb(cRed, cCream, 0.55),
      windPhase: phase, pivot: origin, limbBase: 0.35, rings: 7, fold: 0.45,
      organ: ORGAN.leaf, tile: TILE.leafLong,
    }, rng.fork()), { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  }
  buildStiltRoots(bd, p, rng.fork(), stem);
}

/* --------------------- Sarracenia & cobra lily pitchers --------------------- */

/** Nodding umbrella flower shared by sarracenia (and cobra lily). */
function buildPitcherFlower(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, height: number): void {
  const b = p.botany;
  const t = rng.range(0.55, 0.75);
  const f = bd.frameAt(parent, t);
  const dir = dirFromAzEl(rng.range(0, TAU), rng.range(1.15, 1.4));
  const origin = addScaled(f.center, dir, f.radius * 0.75);
  const stalkLen = height * rng.range(1.05, 1.2);
  const stalk = bd.weld(parent, t, dir, 1, 2, {
    spine: bendSpine(origin, dir, stalkLen, 12, (s) => -(2.3 / stalkLen) * Math.pow(smoothstep(0.72, 1, s), 1.5)),
    ringTs: evenRings(12),
    sides: 6,
    profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0012, 0.0032 * (1 - tt * 0.3)), Math.max(0.0012, 0.0032 * (1 - tt * 0.3))),
    colorAt: () => tint(col(b.rachisColor), 1.05),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.6,
    organ: ORGAN.rachis,
    wind: wind(origin, rng.next(), 0.1, 0.3, 0.03, 0.1),
    capEnd: true,
  }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  if (!stalk) return;
  const hf = bd.frameAt(stalk, 0.97);
  // Pale umbrella style disk facing the ground.
  const ddir = normalize(add(hf.T, v3(0, -0.5, 0)));
  weldFruit(bd, stalk, 0.97, ddir, {
    len: 0.02, R: 0.021, sides: 10, rings: 6, peak: 0.8, stalk: 0.15,
    colorAt: () => [0.78, 0.8, 0.58],
    pivot: origin, phase: rng.next(),
  });
  // Five deep-red petals hanging around the disk like a skirt.
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * TAU + rng.bell() * 0.15;
    const radial = normalize(addScaled(scale(hf.U, Math.cos(ang)), hf.V, Math.sin(ang)));
    const pdir = normalize(add(addScaled(hf.T, radial, 0.55), v3(0, -0.55, 0)));
    const porigin = addScaled(hf.center, pdir, hf.radius * 0.6);
    bd.weld(stalk, 0.95, pdir, 1, 2, leafletSpec(porigin, pdir, UP, {
      len: rng.range(0.045, 0.06), width: 0.021, droop: 0.55, twistRad: rng.bell() * 0.3,
      colorA: tint(col(b.nutColor), 0.8), colorB: tint(col(b.nutColor), 1.05),
      windPhase: rng.next(), pivot: origin, limbBase: 0.4, rings: 6, fold: 0.5,
      organ: ORGAN.fruit, tile: TILE.leafLong,
    }, rng.fork()), { collarRings: 0, collarScale: 0.45, margin: 0 });
  }
}

function buildSarracenia(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.045, b.trunkRadius * 1.3), 0.07);
  const cLeaf = col(b.leafColor);
  const cRed = col(b.nutColor);
  const cWhite = col(b.nutColor2);
  const n = Math.max(3, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = (i + 0.5) / n;
    const az = i * 137.5 * DEG + rng.bell() * 0.18;
    const t = rng.range(0.5, 0.76);
    const dir = dirFromAzEl(az, lerp(1.02, 1.42, age));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const phase = rng.next();
    const len = Math.max(0.15, b.trunkHeight) * lerp(0.72, 1.08, rng.next()) * lerp(1, 0.62, Math.pow(age, 2));
    const R = Math.max(0.014, b.nutSize) * rng.range(0.9, 1.1);
    const seed = rng.range(0, 30);
    // Upright trumpet: narrow waist flaring to the mouth, wing down the front.
    const pitcher = bd.weld(crown, t, dir, 3, 3, {
      spine: bendSpine(origin, dir, len, 12, (s) => -(0.14 / len) * s),
      ringTs: evenRings(18),
      sides: 12,
      profileAt: (tt, out) => {
        const base = R * (0.3 + 0.8 * Math.pow(tt, 1.3)) * (0.35 + 0.65 * smoothstep(0, 0.05, tt));
        for (let j = 0; j < 12; j++) {
          const a = (j / 12) * TAU;
          const wing = 1 + 0.52 * Math.exp(-Math.pow(angDiff(a, 0) / 0.24, 2)) * (0.3 + 0.7 * tt);
          const r = Math.max(0.001, base * wing);
          out[j].x = Math.cos(a) * r; out[j].y = Math.sin(a) * r; out[j].u = j / 12;
        }
      },
      colorAt: (tt, j) => {
        const a = (j / 12) * TAU;
        let c = mixRgb(cLeaf, col(b.leafColor2), 0.2 + 0.5 * tt);
        c = mixRgb(c, cWhite, smoothstep(0.74, 0.98, tt) * (0.4 + 0.55 * (0.5 + 0.5 * noise3(Math.cos(a) * 3 + seed, tt * 6, Math.sin(a) * 3)))); // white top
        const vn = noise3(Math.cos(a) * 2.4 + seed + 7, tt * 15, Math.sin(a) * 2.4);
        c = mixRgb(c, cRed, smoothstep(0.45, 0.9, tt) * smoothstep(0.24, 0.5, vn) * 0.9); // red vein net
        if (tt > 0.96) c = mixRgb(c, [0.14, 0.07, 0.08], smoothstep(0.96, 1, tt) * 0.85); // throat
        return c;
      },
      upHint: normalize(v3(Math.cos(az), 0.25, Math.sin(az))), // wing (profile +x) faces outward
      tile: TILE.stem,
      vPerMeter: 1.6,
      organ: ORGAN.leaf,
      wind: wind(origin, phase, 0.08, 0.28, 0.02, 0.1),
      capEnd: true,
      capScale: 0.25,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
    if (!pitcher) continue;
    // Hood: explicit spine arcing from the back rim over the mouth.
    const mf = bd.frameAt(pitcher, 0.96);
    const c0 = mf.center;
    const hoodSpine = [
      add(addScaled(c0, mf.U, -R * 0.75), scale(mf.T, -R * 0.2)),
      add(addScaled(c0, mf.U, -R * 0.62), scale(mf.T, R * 1.15)),
      add(c0, scale(mf.T, R * 1.75)),
      add(addScaled(c0, mf.U, R * 1.15), scale(mf.T, R * 1.05)),
    ];
    const hoodDir = normalize(sub(hoodSpine[1], hoodSpine[0]));
    bd.weld(pitcher, 0.96, hoodDir, 1, 2, {
      spine: hoodSpine,
      ringTs: evenRings(8),
      sides: 6,
      profileAt: (tt, out) => {
        const halfW = R * 1.08 * Math.pow(Math.max(0.01, Math.sin(Math.PI * (0.1 + 0.82 * tt))), 0.6) * (0.35 + 0.65 * smoothstep(0, 0.18, tt));
        leafletInto(out, Math.max(0.001, halfW), Math.max(0.0008, halfW * 0.42), Math.max(0.0006, halfW * 0.25));
      },
      colorAt: (tt, j) => {
        let c = mixRgb(cWhite, cLeaf, 0.25);
        const vn = noise3(j * 2.1 + seed + 7, tt * 8, seed);
        c = mixRgb(c, cRed, smoothstep(0.22, 0.5, vn) * 0.8);
        return tint(c, LEAFLET_SHADE[j]);
      },
      upHint: mf.V,
      tile: TILE.leafLong,
      vPerMeter: 2,
      organ: ORGAN.leaf,
      wind: wind(origin, phase, 0.15, 0.35, 0.05, 0.18),
      capEnd: true,
      capScale: 0.9,
    }, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
  }
  // A few flat non-carnivorous phyllode leaves for winter photosynthesis.
  for (let i = 0; i < 3; i++) {
    const az = rng.range(0, TAU);
    const t = rng.range(0.5, 0.7);
    const dir = dirFromAzEl(az, rng.range(0.75, 1.0));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * rng.range(0.7, 0.9), width: 0.035,
      petioleRatio: 0.12, arc: 0.7, bladeEl: 0.5,
      notch: 0, lobes: 0, peak: 0.4, vee: 0.2,
      unfurl: 1, colorA: cLeaf, colorB: tint(cLeaf, 1.12), petioleColor: col(b.rachisColor),
      pivot: origin, phase: rng.next(), limbBase: 0.1, rings: 14, petioleR: 0.005,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(crown, t, dir, 2, 3, spec, { collarRings: 0, collarScale: 0.5, margin: 0, search: 7 });
  }
  if (b.nutCount >= 1) buildPitcherFlower(bd, p, rng.fork(), crown, Math.max(0.2, b.trunkHeight));
}

function buildCobra(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.04, b.trunkRadius * 1.3), 0.06);
  const cLeaf = col(b.leafColor);
  const cPale = col(b.nutColor); // pale fenestration windows
  const cTongue = col(b.nutColor2);
  const n = Math.max(3, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = (i + 0.5) / n;
    const az = i * 137.5 * DEG + rng.bell() * 0.2;
    const t = rng.range(0.5, 0.75);
    const dir = dirFromAzEl(az, lerp(1.1, 1.45, age));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const phase = rng.next();
    const len = Math.max(0.12, b.trunkHeight) * lerp(0.7, 1.05, rng.next()) * lerp(1, 0.6, Math.pow(age, 2));
    const R = Math.max(0.013, b.nutSize) * rng.range(0.9, 1.1);
    const seed = rng.range(0, 30);
    // The tube rears up then inflates and bows into a cobra hood.
    const pitcher = bd.weld(crown, t, dir, 3, 3, {
      spine: bendSpine(origin, dir, len, 16, (s) => -(0.25 + 3.4 * smoothstep(0.55, 0.97, s)) / len),
      ringTs: evenRings(20),
      sides: 12,
      profileAt: (tt, out) => {
        const env = profileCurve([[0, 0.32], [0.3, 0.6], [0.58, 0.78], [0.76, 1.14], [0.9, 0.98], [1, 0.5]], tt);
        const r = Math.max(0.001, R * env * (0.35 + 0.65 * smoothstep(0, 0.05, tt)));
        circleInto(out, 12, r, r);
      },
      colorAt: (tt, j) => {
        const a = (j / 12) * TAU;
        let c = mixRgb(cLeaf, col(b.leafColor2), 0.25 + 0.45 * tt);
        c = mixRgb(c, [0.55, 0.3, 0.36], smoothstep(0.5, 1, tt) * 0.28); // purple flush on the hood
        const win = noise3(Math.cos(a) * 3.2 + seed, tt * 10, Math.sin(a) * 3.2);
        c = mixRgb(c, cPale, smoothstep(0.32, 0.52, win) * smoothstep(0.66, 0.85, tt) * 0.85); // light windows
        if (tt > 0.93) c = mixRgb(c, [0.15, 0.08, 0.09], smoothstep(0.93, 1, tt) * 0.8); // mouth under the hood
        return c;
      },
      upHint: normalize(v3(Math.cos(az), 0.25, Math.sin(az))),
      tile: TILE.stem,
      vPerMeter: 1.6,
      organ: ORGAN.leaf,
      wind: wind(origin, phase, 0.08, 0.26, 0.02, 0.1),
      capEnd: true,
      capScale: 0.35,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
    if (!pitcher) continue;
    // Forked fishtail tongue hanging from the front of the hood.
    const hf = bd.frameAt(pitcher, 0.98);
    for (const sd of [-1, 1]) {
      const tdir = normalize(add(addScaled(scale(hf.V, sd * 0.28), hf.T, 0.85), v3(0, -0.45, 0)));
      const torigin = addScaled(hf.center, tdir, hf.radius * 0.55);
      bd.weld(pitcher, 0.98, tdir, 1, 2, leafletSpec(torigin, tdir, UP, {
        len: rng.range(0.045, 0.06), width: 0.009, droop: 0.8, twistRad: sd * 0.3,
        colorA: tint(cTongue, 0.85), colorB: cTongue,
        windPhase: phase, pivot: origin, limbBase: 0.3, rings: 5, fold: 0.4,
        organ: ORGAN.leaf, tile: TILE.leafLong,
      }, rng.fork()), { collarRings: 0, collarScale: 0.45, margin: 0 });
    }
  }
  if (b.nutCount >= 1) buildPitcherFlower(bd, p, rng.fork(), crown, Math.max(0.18, b.trunkHeight));
}

/* ------------------------------ Sundew -------------------------------------- */

function buildSundew(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.022, b.trunkRadius), Math.max(0.03, b.trunkHeight));
  const cLeaf = col(b.leafColor);
  const cRed = col(b.nutColor);
  const cDrop = col(b.nutColor2);
  const n = Math.max(5, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = (i + 0.5) / n;
    const az = i * 137.5 * DEG + rng.bell() * 0.15;
    const t = rng.range(0.5, 0.8);
    const dir = dirFromAzEl(az, lerp(0.18, 1.05, Math.pow(age, 1.4)));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const phase = rng.next();
    const curled = i === 2 || i === 6; // two leaves wrapped around prey
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1.05, 0.6, age) * rng.range(0.9, 1.08),
      width: Math.max(0.008, b.bladeWidth),
      petioleRatio: b.petioleRatio,
      arc: b.bladeArc * (curled ? 2.4 : lerp(1.15, 0.55, age)),
      bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.05,
      notch: 0, lobes: 0, peak: b.bladePeak, vee: b.bladeVee,
      unfurl: 1 - smoothstep(0.9, 1, age) * 0.5,
      colorA: cLeaf, colorB: mixRgb(cLeaf, col(b.leafColor2), 0.55), petioleColor: col(b.rachisColor),
      pivot: origin, phase, limbBase: 0.05,
      rings: 30, petioleR: 0.0022,
    }, rng.fork());
    spec.tile = TILE.leafLong;
    const leaf = bd.weld(crown, t, dir, 2, 3, spec, { collarRings: 0, collarScale: 0.5, margin: 0, search: 7 });
    if (!leaf) continue;
    // Gland tentacles ranked along the blade top, each tipped with a dew drop.
    const rows = 14;
    for (let k = 0; k < rows; k++) {
      const tb = 0.1 + (k / (rows - 1)) * 0.86;
      const tLeaf = b.petioleRatio + tb * (1 - b.petioleRatio);
      const gf = bd.frameAt(leaf, clamp(tLeaf, 0.05, 0.98));
      const side = k % 2 === 0 ? -1 : 1;
      const tdir = normalize(add(addScaled(gf.V, gf.U, side * 0.55), scale(gf.T, 0.14)));
      const tLen = Math.max(0.003, b.nutSize) * (1.05 + 0.45 * tb) * rng.range(0.8, 1.25);
      bd.weld(leaf, clamp(tLeaf, 0.05, 0.985), tdir, 1, 2, {
        spine: bendSpine(addScaled(gf.center, tdir, gf.radius * 0.4), tdir, tLen, 4, (s) => (0.3 / tLen) * s),
        ringTs: evenRings(4),
        sides: 6,
        profileAt: (tt, out) => {
          const r = tt < 0.62 ? 0.00042 : Math.max(0.0005, 0.00115 * Math.sin(Math.PI * (0.15 + 0.7 * (tt - 0.62) / 0.38)));
          circleInto(out, 6, r, r);
        },
        colorAt: (tt) => tt < 0.68 ? cRed : mixRgb(cRed, cDrop, smoothstep(0.68, 0.88, tt)),
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 3,
        organ: ORGAN.leaf,
        wind: wind(origin, phase, 0.1, 0.2, 0.08, 0.25),
        capEnd: true,
        capScale: 0.5,
      }, { collarRings: 0, collarScale: 0.35, margin: 0, search: 5 });
    }
  }
  // Wiry flower scape uncurling well above the sticky leaves.
  const nf = clamp(Math.round(b.nutCount), 0, 2);
  for (let i = 0; i < nf; i++) {
    const t = rng.range(0.6, 0.8);
    const f = bd.frameAt(crown, t);
    const dir = dirFromAzEl(rng.range(0, TAU), rng.range(1.15, 1.4));
    buildStarFlower(bd, p, rng.fork(), crown, t, dir, addScaled(f.center, dir, f.radius * 0.75), 0.006, 0.17, cDrop, col('#f8f4ea'));
  }
}

/* ----------------------------- Butterwort ----------------------------------- */

function buildButterwort(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const crown = buildCrownBlob(bd, p, rng, Math.max(0.024, b.trunkRadius), Math.max(0.025, b.trunkHeight));
  const cA = col(b.leafColor);
  const n = Math.max(5, Math.round(b.frondCount));
  for (let i = 0; i < n; i++) {
    const age = (i + 0.5) / n; // flat outer leaves .. upright heart
    const az = i * 137.5 * DEG + rng.bell() * 0.15;
    const t = rng.range(0.5, 0.8);
    const dir = dirFromAzEl(az, lerp(0.05, 0.65, Math.pow(age, 1.6)));
    const f = bd.frameAt(crown, t);
    const origin = addScaled(f.center, dir, f.radius * 0.8);
    const fresh = mixRgb(cA, col(b.leafColor2), 0.2 + age * 0.4);
    const spec = bladeLeafSpec(origin, dir, {
      len: b.leafLength * lerp(1.05, 0.55, age) * rng.range(0.9, 1.08),
      width: b.bladeWidth * rng.range(0.9, 1.08),
      petioleRatio: Math.max(0.05, b.petioleRatio),
      arc: b.bladeArc * lerp(1.3, 0.5, age),
      bladeEl: (90 - b.bladePitch) * DEG + rng.bell() * 0.04,
      notch: 0, lobes: 0, peak: b.bladePeak, vee: 0.12,
      unfurl: 1 - smoothstep(0.85, 1, age) * 0.5,
      colorA: fresh, colorB: tint(fresh, 1.1), petioleColor: tint(fresh, 0.9),
      pivot: origin, phase: rng.next(), limbBase: 0.04,
      rings: 16, petioleR: 0.0068, // fleshy keel: the leaf is a greasy tongue
    }, rng.fork());
    spec.tile = TILE.leafLong;
    bd.weld(crown, t, dir, 2, 3, spec, { collarRings: 0, collarScale: 0.5, margin: 0, search: 7 });
  }
  // Single violet flowers nodding on long naked stalks.
  const nf = clamp(Math.round(b.nutCount), 0, 4);
  for (let i = 0; i < nf; i++) {
    const t = rng.range(0.6, 0.82);
    const f = bd.frameAt(crown, t);
    const dir = dirFromAzEl(rng.range(0, TAU), rng.range(1.05, 1.35));
    buildStarFlower(bd, p, rng.fork(), crown, t, dir, addScaled(f.center, dir, f.radius * 0.75), Math.max(0.008, b.nutSize), 0.13, col(b.nutColor), col(b.nutColor2));
  }
}

function buildCarnivore(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  switch (p.botany.carnType) {
    case 'flytrap': buildFlytrap(bd, p, rng); break;
    case 'nepenthes': buildNepenthes(bd, p, rng); break;
    case 'sarracenia': buildSarracenia(bd, p, rng); break;
    case 'cobra': buildCobra(bd, p, rng); break;
    case 'sundew': buildSundew(bd, p, rng); break;
    case 'butterwort': buildButterwort(bd, p, rng); break;
  }
}

// -----------------------------------------------------------------------------
// Habit: grain (cereals & sugarcane)
//
// A grass culm is a jointed stalk: swollen nodes carry two-ranked strap
// leaves (sheath hugging the stem, then a long arching blade), and the top
// ends in the inflorescence — corn tassel + husked ears, a dense millet /
// wheat spike, or a branched rice / sorghum panicle. Tillers weld into a
// shared crown like other clumping plants.
// -----------------------------------------------------------------------------

function windowForSides(sides: number): [number, number] {
  if (sides <= 6) return [1, 2];
  if (sides <= 8) return [2, 2];
  if (sides <= 10) return [2, 3];
  if (sides <= 12) return [3, 3];
  if (sides <= 14) return [3, 4];
  return [4, 4];
}

interface CulmResult { grid: TubeGrid; nodeTs: number[]; topY: number }

function buildCulm(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid | null, base: V3, az: number, heightScale: number): CulmResult | null {
  const b = p.botany;
  const H = Math.max(0.25, b.trunkHeight * heightScale);
  const sides = Math.max(8, p.mesh.trunkSides);
  const lean = v3(Math.cos(az), 0, Math.sin(az));
  const dir0 = normalize(v3(lean.x * (0.1 + b.trunkCurve * 0.25), 1, lean.z * (0.1 + b.trunkCurve * 0.25)));
  const origin = parent ? v3(base.x, 0.1, base.z) : v3(base.x, -0.12, base.z);
  const spine = bendSpine(origin, dir0, H, 14, (s) => (b.trunkCurve * 0.22 / H) * s, () => rng.bell() * 0.008 / H);
  // Leaf nodes run up most of the culm; the head sits above the top node.
  const nodes = Math.max(3, Math.round(b.frondCount));
  const nodeTs: number[] = [];
  for (let i = 0; i < nodes; i++) nodeTs.push(lerp(0.14, 0.9, nodes <= 1 ? 0.5 : i / (nodes - 1)));
  const ringSet = new Set<number>(evenRings(16));
  for (const t of nodeTs) { ringSet.add(t - 0.01); ringSet.add(t); ringSet.add(t + 0.01); }
  for (let i = 0; i <= 5; i++) ringSet.add(0.93 + (i / 5) * 0.07);
  const nodePulse = (t: number): number => {
    let m = 0;
    for (const tn of nodeTs) m = Math.max(m, Math.exp(-Math.pow((t - tn) / 0.011, 2)));
    return m;
  };
  const cane = b.grainType === 'cane';
  const cA = col(b.trunkColor);
  const cB = col(b.trunkColor2);
  const seed = rng.range(0, 30);
  const spec: TubeSpec = {
    spine,
    ringTs: [...ringSet].sort((a, c) => a - c),
    sides,
    profileAt: (t, out) => {
      let r = b.trunkRadius * (1 - 0.38 * smoothstep(0.08, 1, t)) * (1 + (cane ? 0.16 : 0.24) * nodePulse(t));
      r *= 1 + 0.5 * Math.exp(-t * 9);
      r *= 1 - smoothstep(0.985, 1, t) * 0.45;
      circleInto(out, sides, Math.max(0.0025, r), Math.max(0.0025, r));
    },
    colorAt: (t, j) => {
      let c = mixRgb(cA, cB, smoothstep(0.3, 1, t));
      const pulse = nodePulse(t);
      const ja = (j / sides) * TAU;
      if (cane) {
        // Dusty wax bloom in patches over the internodes, pale growth-ring at joints.
        const wax = clamp(0.5 + fbm3(Math.cos(ja) * 2 + seed, t * H * 2.2, Math.sin(ja) * 2, 2), 0, 1);
        c = mixRgb(c, [0.83, 0.85, 0.8], wax * 0.3 + pulse * 0.38);
      } else {
        c = tint(c, 1 - pulse * 0.16);
        // Maize nodes often flush purple-brown.
        if (b.grainType === 'corn') c = mixRgb(c, [0.5, 0.36, 0.42], pulse * 0.38);
      }
      return tint(c, 1 + 0.1 * noise3(j * 1.5 + seed, t * H * 4, seed));
    },
    upHint: v3(1, 0, 0),
    tile: TILE.stem,
    vPerMeter: 0.7,
    organ: ORGAN.trunk,
    wind: wind(base, rng.next(), 0, 0.22, 0, 0.08),
    capStart: !parent,
    capEnd: true,
    capScale: 0.5,
  };
  const topY = origin.y + H;
  if (!parent) return { grid: bd.tube(spec), nodeTs, topY };
  const [w, h] = windowForSides(sides);
  const grid = bd.weld(parent, 0.6, dir0, w, h, spec, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
  return grid ? { grid, nodeTs, topY } : null;
}

function buildCulmLeaves(bd: PlantBuilder, p: PlantParams, rng: Random, culm: CulmResult, scale: number): void {
  const b = p.botany;
  const cane = b.grainType === 'cane';
  const baseAz = rng.range(0, TAU);
  const n = culm.nodeTs.length;
  for (let i = 0; i < n; i++) {
    const t = culm.nodeTs[i];
    const h01 = n <= 1 ? 0.5 : i / (n - 1);
    const az = baseAz + i * b.phyllotaxis * DEG + rng.bell() * 0.06;
    const f = bd.frameAt(culm.grid, t);
    // Sugarcane sheds its lower leaves: they hang dead against the stalk.
    const dead = cane && h01 < 0.52;
    const el = dead ? rng.range(-0.5, -0.25) : lerp(0.55, 1.25, h01);
    const dir0 = dirFromAzEl(az, el);
    const origin = addScaled(f.center, dir0, f.radius * 0.8);
    const lenFactor = 0.5 + 0.58 * Math.sin(Math.PI * (0.12 + 0.76 * h01));
    const fresh = mixRgb(col(b.leafColor), col(b.leafColor2), 0.25 + 0.45 * h01);
    const cA = dead ? col(b.deadColor) : fresh;
    const spec = bladeLeafSpec(origin, dir0, {
      len: b.leafLength * scale * lenFactor * rng.range(0.9, 1.08) * (dead ? 0.75 : 1),
      width: b.bladeWidth * rng.range(0.9, 1.06),
      petioleRatio: b.petioleRatio, // the sheath section
      arc: b.bladeArc * (dead ? 0.4 : lerp(1.25, 0.65, h01)),
      bladeEl: dead ? -1.25 : lerp(-0.2, 0.45, h01),
      notch: 0, lobes: 0,
      peak: b.bladePeak, vee: b.bladeVee,
      geniculum: true, // the pale collar where blade leaves the sheath
      midribPale: b.grainType === 'corn' || cane ? 0.85 : 0.4,
      unfurl: i === n - 1 && !dead ? 0.5 : 1,
      colorA: cA,
      colorB: dead ? tint(cA, 0.8) : mixRgb(fresh, [0.66, 0.58, 0.22], Math.pow(1 - h01, 2) * 0.35),
      petioleColor: dead ? tint(col(b.deadColor), 0.9) : col(b.rachisColor),
      pivot: origin, phase: rng.next(), limbBase: 0.22,
      rings: Math.round(p.mesh.bladeRings * 0.8 * p.mesh.quality),
      petioleR: Math.max(0.004, b.trunkRadius * 0.8),
    }, rng.fork());
    bd.weld(culm.grid, t, dir0, 2, 3, spec, { collarRings: Math.min(1, p.mesh.collarRings), collarScale: 0.55, margin: 0, search: 6 });
  }
}

interface GrainOpts {
  awnScale?: number;
  lenScale?: number;
  /** Mix toward pale straw (glumes / husks). */
  pale?: number;
  /** Pure bristle: no grain bulge (pearl-millet involucre). */
  bristle?: boolean;
  tintC?: RGB;
}

/** One grain (kernel) welded onto a head axis/branchlet, optionally awned. */
function weldGrain(bd: PlantBuilder, p: PlantParams, rng: Random, parent: TubeGrid, t: number, dir: V3, origin: V3, pivot: V3, plump: number, o2?: GrainOpts): void {
  const b = p.botany;
  const grainLen = Math.max(0.012, b.nutSize * 2.3) * (o2?.lenScale ?? 1) * rng.range(0.88, 1.12);
  const awn = b.awnLength * (o2?.awnScale ?? 1) * rng.range(0.8, 1.2);
  const totalLen = grainLen + awn;
  const R = o2?.bristle ? 0.0007 : Math.max(0.002, b.nutSize * 0.5 * plump);
  let cG = mixRgb(col(b.nutColor), col(b.nutColor2), rng.next());
  if (o2?.pale) cG = mixRgb(cG, [0.86, 0.8, 0.6], o2.pale);
  if (o2?.tintC) cG = tint(o2.tintC, rng.range(0.85, 1.1));
  const spine = bendSpine(origin, dir, totalLen, 6, (s) => (0.25 / totalLen) * s, () => rng.bell() * 0.02 / totalLen);
  bd.weld(parent, t, dir, 1, 2, {
    spine,
    ringTs: evenRings(7),
    sides: 6,
    profileAt: (tt, out) => {
      const d = tt * totalLen;
      let r: number;
      if (o2?.bristle) r = 0.0007;
      else if (d < grainLen) {
        const tg = d / grainLen;
        // Plump grain with a shallow crease shading built into colour below.
        r = R * Math.pow(Math.sin(Math.PI * (0.14 + 0.72 * tg)), 0.6) * (0.35 + 0.65 * smoothstep(0, 0.2, tg));
      } else r = 0.00055; // hair awn
      circleInto(out, 6, Math.max(0.0005, r), Math.max(0.0005, r));
    },
    colorAt: (tt, j) => tint(cG, (0.85 + 0.2 * tt) * (j === 0 ? 0.9 : 1)),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 3,
    organ: ORGAN.fruit,
    wind: wind(pivot, rng.next(), 0.3, 0.5, 0.1, 0.35),
    capEnd: true,
    capScale: 0.4,
  }, { collarRings: 0, collarScale: 0.45, margin: 0 });
}

/**
 * Dense spike heads grown as spikelets on a segmented rachis:
 * wheat = two-ranked spikelets (2 pale glumes + 3 fanned grains, long awns,
 * nodding when ripe); pearl millet = a candle of grains erupting through a
 * purple-brown bristle involucre.
 */
function buildSpikeHead(bd: PlantBuilder, p: PlantParams, rng: Random, culm: CulmResult, hs: number): void {
  const b = p.botany;
  const top = bd.frameAt(culm.grid, 0.985);
  const origin = addScaled(top.center, top.T, top.radius * 0.5);
  const headLen = clamp(0.09 + b.trunkRadius * 14, 0.1, 0.34) * hs;
  const headRad = clamp(b.trunkRadius * 1.15 + 0.004, 0.008, 0.02) * hs;
  const wheat = b.awnLength > 0.04;
  const grainTarget = Math.max(12, Math.round(b.nutCount * clamp(p.mesh.quality, 0.7, 1.3)));
  const nodes = wheat ? clamp(Math.round(grainTarget / 3), 8, 18) : 0;
  const spine = bendSpine(origin, top.T, headLen, 12, (s) => -((wheat ? 0.75 : 0.3) / headLen) * s * s);
  const cAxis = wheat ? tint(col(b.rachisColor), 1.15) : tint(col(b.rachisColor), 0.95);
  const axis = bd.weld(culm.grid, 0.97, top.T, 2, 2, {
    spine,
    ringTs: evenRings(wheat ? 44 : 34),
    sides: 8,
    profileAt: (t, out) => {
      const env = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * t)), 0.35);
      // Segmented rachis: a subtle swell at every spikelet node.
      const seg = wheat ? 1 + 0.16 * Math.pow(0.5 + 0.5 * Math.cos(t * nodes * TAU), 1.5) : 1;
      const r = Math.max(0.002, headRad * (wheat ? 0.42 : 0.58) * env * seg);
      circleInto(out, 8, r, r);
    },
    colorAt: () => cAxis,
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.5,
    organ: ORGAN.rachis,
    wind: wind(origin, rng.next(), 0.22, 0.4, 0.05, 0.15),
    capEnd: true,
    capScale: 0.6,
  }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
  if (!axis) return;
  const az0 = rng.range(0, TAU);

  if (wheat) {
    for (let i = 0; i < nodes; i++) {
      const t = 0.05 + (i / Math.max(1, nodes - 1)) * 0.93;
      const f = bd.frameAt(axis, clamp(t, 0.03, 0.98));
      const ang = az0 + (i % 2) * Math.PI + rng.bell() * 0.1;
      const radial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
      const side = normalize(cross(f.T, radial));
      // Two boat-shaped glumes cupping the spikelet base.
      for (const gs of [-1, 1]) {
        const gd = normalize(add(addScaled(f.T, radial, 0.34), scale(side, gs * 0.22)));
        weldGrain(bd, p, rng.fork(), axis, Math.max(0.03, t - 0.012), gd, addScaled(f.center, gd, f.radius * 0.6), origin, 0.85, { awnScale: 0.12, lenScale: 0.85, pale: 0.55 });
      }
      // Three grains fanned out of the spikelet, awns streaming upward.
      for (let g = -1; g <= 1; g++) {
        const gd = normalize(add(addScaled(f.T, radial, g === 0 ? 0.42 : 0.62), scale(side, g * 0.38)));
        weldGrain(bd, p, rng.fork(), axis, t, gd, addScaled(f.center, gd, f.radius * 0.6), origin, g === 0 ? 1.2 : 1.05);
      }
    }
    return;
  }

  // Pearl millet: grains spiralled tight, bristles bristling between them.
  const cBristle = mixRgb(col(b.nutColor2), [0.42, 0.3, 0.38], 0.55);
  for (let i = 0; i < grainTarget; i++) {
    const t = 0.04 + (i / Math.max(1, grainTarget - 1)) * 0.93 + rng.bell() * 0.006;
    const f = bd.frameAt(axis, clamp(t, 0.03, 0.98));
    const ang = az0 + i * 137.5 * DEG;
    const radial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
    const dir = normalize(addScaled(f.T, radial, 0.75));
    weldGrain(bd, p, rng.fork(), axis, t, dir, addScaled(f.center, dir, f.radius * 0.55), origin, 0.95, { awnScale: 0.55 });
    if (i % 2 === 0) {
      const bang = ang + 0.8;
      const bradial = normalize(addScaled(scale(f.U, Math.cos(bang)), f.V, Math.sin(bang)));
      const bdir = normalize(addScaled(f.T, bradial, 1.05));
      weldGrain(bd, p, rng.fork(), axis, t, bdir, addScaled(f.center, bdir, f.radius * 0.55), origin, 1, { bristle: true, lenScale: 1.6, awnScale: 0, tintC: cBristle });
    }
  }
}

/** Branched head: drooping rice panicle or compact upright sorghum. */
function buildPanicleHead(bd: PlantBuilder, p: PlantParams, rng: Random, culm: CulmResult, hs: number): void {
  const b = p.botany;
  const compact = b.trunkRadius > 0.011; // sorghum vs rice
  const top = bd.frameAt(culm.grid, 0.985);
  const origin = addScaled(top.center, top.T, top.radius * 0.5);
  const headLen = clamp(0.14 + b.trunkRadius * 9, 0.18, 0.36) * hs;
  const droop = compact ? 0.5 : 1.6;
  const spine = bendSpine(origin, top.T, headLen, 12, (s) => -(droop / headLen) * smoothstep(0.15, 0.8, s));
  const axis = bd.weld(culm.grid, 0.97, top.T, 2, 2, {
    spine,
    ringTs: evenRings(30),
    sides: 8,
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.0015, 0.004 * hs * (1 - t * 0.6)), Math.max(0.0015, 0.004 * hs * (1 - t * 0.6))),
    colorAt: () => tint(col(b.rachisColor), 1.08),
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.5,
    organ: ORGAN.rachis,
    wind: wind(origin, rng.next(), 0.22, 0.42, 0.05, 0.18),
    capEnd: true,
    capScale: 0.6,
  }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
  if (!axis) return;
  const branchlets = clamp(Math.round(b.nutCount / 6), 6, 14);
  const perBranch = Math.max(3, Math.round(b.nutCount / branchlets));
  const az0 = rng.range(0, TAU);
  for (let i = 0; i < branchlets; i++) {
    const t = 0.12 + (i / Math.max(1, branchlets - 1)) * 0.83;
    const f = bd.frameAt(axis, t);
    const ang = az0 + i * 137.5 * DEG + rng.bell() * 0.15;
    const radial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
    const dir = normalize(addScaled(f.T, radial, compact ? 0.55 : 0.95));
    const bOrigin = addScaled(f.center, dir, f.radius * 0.7);
    const bLen = headLen * (compact ? 0.34 : 0.5) * (1 - t * 0.45) * rng.range(0.85, 1.15);
    const bSpine = bendSpine(bOrigin, dir, bLen, 7, (s) => ((compact ? 0.3 : -0.5) / bLen) * s);
    const br = bd.weld(axis, t, dir, 1, 2, {
      spine: bSpine,
      ringTs: evenRings(14),
      sides: 6,
      profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0008, 0.0018 * (1 - tt * 0.5)), Math.max(0.0008, 0.0018 * (1 - tt * 0.5))),
      colorAt: () => tint(col(b.rachisColor), 1.05),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.rachis,
      wind: wind(origin, rng.next(), 0.4, 0.55, 0.08, 0.25),
      capEnd: true,
    }, { collarRings: 0, collarScale: 0.5, margin: 0 });
    if (!br) continue;
    for (let k = 0; k < perBranch; k++) {
      const gt = 0.25 + (k / Math.max(1, perBranch - 1)) * 0.72 + rng.bell() * 0.02;
      const gf = bd.frameAt(br, clamp(gt, 0.05, 0.98));
      const gang = rng.range(0, TAU);
      const gradial = normalize(addScaled(scale(gf.U, Math.cos(gang)), gf.V, Math.sin(gang)));
      // Rice grains dangle; sorghum grains sit upright and round.
      const gdir = compact
        ? normalize(addScaled(gf.T, gradial, 0.7))
        : normalize(add(addScaled(gf.T, gradial, 0.55), v3(0, -0.5, 0)));
      weldGrain(bd, p, rng.fork(), br, gt, gdir, addScaled(gf.center, gdir, gf.radius * 0.7), origin, compact ? 1.35 : 0.9, compact ? { lenScale: 0.78 } : undefined);
    }
  }
  // Rice carries a few grains directly on the main axis near the tip.
  if (!compact) {
    for (let i = 0; i < 5; i++) {
      const t = 0.78 + i * 0.05;
      const f = bd.frameAt(axis, t);
      const ang = rng.range(0, TAU);
      const radial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
      const dir = normalize(add(addScaled(f.T, radial, 0.55), v3(0, -0.45, 0)));
      weldGrain(bd, p, rng.fork(), axis, t, dir, addScaled(f.center, dir, f.radius * 0.7), origin, 0.9);
    }
  }
}

/** Corn: branched tassel on top, husked ears hugging the mid-stalk nodes. */
function buildCornHead(bd: PlantBuilder, p: PlantParams, rng: Random, culm: CulmResult, hs: number): void {
  const b = p.botany;
  const top = bd.frameAt(culm.grid, 0.985);
  const origin = addScaled(top.center, top.T, top.radius * 0.5);
  const cTassel = mixRgb(col(b.nutColor2), col(b.rachisColor), 0.4);
  const phase = rng.next();
  // Tassel main axis + whorled branchlets with tiny spikelets.
  const tLen = 0.32 * hs;
  const tassel = bd.weld(culm.grid, 0.97, top.T, 2, 2, {
    spine: bendSpine(origin, top.T, tLen, 8, (s) => -(0.18 / tLen) * s),
    ringTs: evenRings(18),
    sides: 8,
    profileAt: (t, out) => circleInto(out, 8, Math.max(0.0012, 0.005 * hs * (1 - t * 0.75)), Math.max(0.0012, 0.005 * hs * (1 - t * 0.75))),
    colorAt: () => cTassel,
    upHint: UP,
    tile: TILE.stem,
    vPerMeter: 1.5,
    organ: ORGAN.rachis,
    wind: wind(origin, phase, 0.22, 0.45, 0.05, 0.2),
    capEnd: true,
  }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
  if (tassel) {
    const spikelet = (parent: TubeGrid, t: number, dir: V3, o: V3): void => {
      const sg = bd.weld(parent, t, dir, 1, 2, {
        spine: [o, addScaled(o, dir, 0.011), addScaled(o, dir, 0.02)],
        ringTs: evenRings(3),
        sides: 6,
        profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0008, 0.0022 * Math.sin(Math.PI * (0.15 + 0.7 * tt))), Math.max(0.0008, 0.0022 * Math.sin(Math.PI * (0.15 + 0.7 * tt)))),
        colorAt: () => tint(mixRgb(cTassel, [0.85, 0.68, 0.3], 0.5), rng.range(0.85, 1.1)),
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 3,
        organ: ORGAN.fruit,
        wind: wind(origin, phase, 0.45, 0.6, 0.12, 0.35),
        capEnd: true,
      }, { collarRings: 0, collarScale: 0.4, margin: 0 });
      // Pollen anthers dangle from many spikelets on hair filaments.
      if (sg && rng.next() < 0.5) {
        const af = bd.frameAt(sg, 0.85);
        const adir = normalize(add(af.T, v3(0, -1.4, 0)));
        const ao = addScaled(af.center, adir, af.radius * 0.6);
        const al = rng.range(0.01, 0.016);
        const cAnth = mixRgb([0.86, 0.8, 0.46], [0.62, 0.42, 0.52], rng.next() * 0.7);
        bd.weld(sg, 0.85, adir, 1, 2, {
          spine: bendSpine(ao, adir, al, 4, (sv) => -(0.8 / al) * sv),
          ringTs: evenRings(4),
          sides: 6,
          profileAt: (tt, out) => {
            const r = tt < 0.55 ? 0.00045 : Math.max(0.0006, 0.0016 * Math.sin(Math.PI * (0.2 + 0.65 * (tt - 0.55) / 0.45)));
            circleInto(out, 6, r, r);
          },
          colorAt: () => cAnth,
          upHint: UP,
          tile: TILE.stem,
          vPerMeter: 3,
          organ: ORGAN.fruit,
          wind: wind(origin, phase, 0.5, 0.7, 0.2, 0.5),
          capEnd: true,
        }, { collarRings: 0, collarScale: 0.35, margin: 0 });
      }
    };
    for (let i = 0; i < 14; i++) {
      const t = 0.36 + (i / 13) * 0.62;
      const f = bd.frameAt(tassel, t);
      const ang = rng.range(0, TAU);
      const radial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
      const dir = normalize(addScaled(f.T, radial, 0.65));
      spikelet(tassel, t, dir, addScaled(f.center, dir, f.radius * 0.7));
    }
    const branches = 9 + Math.floor(rng.next() * 3);
    for (let i = 0; i < branches; i++) {
      const t = 0.06 + (i / branches) * 0.3;
      const f = bd.frameAt(tassel, t);
      const ang = i * 137.5 * DEG + rng.bell() * 0.2;
      const radial = normalize(addScaled(scale(f.U, Math.cos(ang)), f.V, Math.sin(ang)));
      const dir = normalize(addScaled(f.T, radial, 0.9));
      const bo = addScaled(f.center, dir, f.radius * 0.7);
      const bl = tLen * rng.range(0.4, 0.55);
      const br = bd.weld(tassel, t, dir, 1, 2, {
        spine: bendSpine(bo, dir, bl, 6, (s) => (0.35 / bl) * s),
        ringTs: evenRings(10),
        sides: 6,
        profileAt: (tt, out) => circleInto(out, 6, Math.max(0.0007, 0.0016 * (1 - tt * 0.5)), Math.max(0.0007, 0.0016 * (1 - tt * 0.5))),
        colorAt: () => cTassel,
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 2,
        organ: ORGAN.rachis,
        wind: wind(origin, phase, 0.4, 0.55, 0.08, 0.25),
        capEnd: true,
      }, { collarRings: 0, collarScale: 0.5, margin: 0 });
      if (!br) continue;
      for (let k = 0; k < 3; k++) {
        const gt = 0.35 + k * 0.28;
        const gf = bd.frameAt(br, gt);
        const gd = normalize(addScaled(gf.T, gf.U, 0.6));
        spikelet(br, gt, gd, addScaled(gf.center, gd, gf.radius * 0.7));
      }
    }
  }

  // Ears at mid-stalk leaf axils.
  const ears = clamp(Math.round(b.nutCount), 0, 3);
  const midNodes = culm.nodeTs.filter((t) => t > 0.38 && t < 0.66);
  const cKernel = col(b.nutColor);
  const cHusk = mixRgb(col(b.leafColor), [0.72, 0.76, 0.52], 0.45);
  for (let e = 0; e < ears && midNodes.length; e++) {
    const nodeT = midNodes[Math.floor((e / Math.max(1, ears)) * midNodes.length)] ?? midNodes[0];
    const nf = bd.frameAt(culm.grid, nodeT);
    const eAz = rng.range(0, TAU);
    const outDir = dirFromAzEl(eAz, 0.65);
    const shankO = addScaled(nf.center, outDir, nf.radius * 0.8);
    const shank = bd.weld(culm.grid, nodeT, outDir, 2, 2, {
      spine: bendSpine(shankO, outDir, 0.07 * hs, 5, (s) => (0.5 / (0.07 * hs)) * s),
      ringTs: evenRings(8),
      sides: 8,
      profileAt: (t, out) => circleInto(out, 8, Math.max(0.004, 0.011 * hs * (1 - t * 0.3)), Math.max(0.004, 0.011 * hs * (1 - t * 0.3))),
      colorAt: () => tint(cHusk, 0.95),
      upHint: UP,
      tile: TILE.stem,
      vPerMeter: 1.5,
      organ: ORGAN.rachis,
      wind: wind(shankO, phase, 0.15, 0.25, 0.02, 0.08),
      capEnd: true,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 8 });
    if (!shank) continue;
    const cf = bd.frameAt(shank, 0.92);
    const cobDir = normalize(addScaled(UP, outDir, 0.35));
    const cobO = addScaled(cf.center, cobDir, cf.radius * 0.6);
    const cobLen = 0.19 * hs;
    const cobRad = Math.max(0.014, b.nutSize * 0.42);
    const kSeed = rng.range(0, 40);
    const cob = bd.weld(shank, 0.92, cobDir, 3, 3, {
      spine: bendSpine(cobO, cobDir, cobLen, 6, () => 0),
      ringTs: evenRings(20),
      sides: 12,
      profileAt: (t, out) => {
        const env = Math.pow(Math.sin(Math.PI * (0.07 + 0.86 * t)), 0.4) * (0.45 + 0.55 * smoothstep(0, 0.12, t));
        for (let j = 0; j < 12; j++) {
          const a = (j / 12) * TAU;
          // Kernel rows: 14 files of bumps, staggered in a checkerboard.
          const bump = 1 + 0.09 * Math.cos(a * 7 + Math.floor(t * 26) * 0.45) + 0.05 * Math.sin(t * 165);
          const r = Math.max(0.003, cobRad * env * bump);
          out[j].x = Math.cos(a) * r;
          out[j].y = Math.sin(a) * r;
          out[j].u = j / 12;
        }
      },
      colorAt: (t, j) => {
        // Per-kernel tint variation (quantised noise) + paler tip kernels.
        const kx = Math.floor(j * 1.2), ky = Math.floor(t * 26);
        const v = 0.88 + 0.2 * (0.5 + 0.5 * noise3(kx * 3.1 + kSeed, ky * 2.3, kSeed));
        return tint(mixRgb(cKernel, [0.92, 0.85, 0.55], smoothstep(0.8, 1, t) * 0.5), v);
      },
      upHint: normalize(cross(cobDir, v3(1, 0, 0))),
      tile: TILE.stem,
      vPerMeter: 2,
      organ: ORGAN.fruit,
      wind: wind(shankO, phase, 0.2, 0.3, 0.02, 0.08),
      capEnd: true,
      capScale: 0.5,
    }, { collarRings: 1, collarScale: 0.5, margin: 0, search: 6 });
    if (!cob) continue;
    // Husk leaves wrap the cob, one peeling open to show the kernels.
    const husks = 5;
    for (let hi = 0; hi < husks; hi++) {
      const peeled = hi === 0;
      const ht = rng.range(0.04, 0.22);
      const hf = bd.frameAt(cob, ht);
      const hang2 = (hi / husks) * TAU + rng.bell() * 0.2;
      const hradial = normalize(addScaled(scale(hf.U, Math.cos(hang2)), hf.V, Math.sin(hang2)));
      const hdir = normalize(addScaled(hf.T, hradial, peeled ? 0.65 : 0.18));
      const ho = addScaled(hf.center, hdir, hf.radius * 0.75);
      const spec = bladeLeafSpec(ho, hdir, {
        len: cobLen * rng.range(0.95, 1.25), width: 0.05 * hs,
        petioleRatio: 0.5, arc: peeled ? 1.5 : 0.55,
        bladeEl: Math.asin(clamp(cobDir.y, -1, 1)),
        notch: 0, lobes: 0.1, peak: 0.4, vee: 0.3,
        unfurl: 1,
        colorA: tint(cHusk, rng.range(0.9, 1.05)), colorB: mixRgb(cHusk, col(b.leafColor2), 0.4),
        petioleColor: tint(cHusk, 0.92),
        pivot: shankO, phase, limbBase: 0.25,
        rings: 16, petioleR: 0.008,
      }, rng.fork());
      bd.weld(cob, ht, hdir, 2, 3, spec, { collarRings: 0, collarScale: 0.5, margin: 0, search: 6 });
    }
    // Silk strands spilling from the cob tip.
    for (let si = 0; si < 5; si++) {
      const sf = bd.frameAt(cob, 0.96);
      const sang = rng.range(0, TAU);
      const sradial = normalize(addScaled(scale(sf.U, Math.cos(sang)), sf.V, Math.sin(sang)));
      const sdir = normalize(addScaled(sf.T, sradial, 0.5));
      const so = addScaled(sf.center, sdir, sf.radius * 0.6);
      const sl = rng.range(0.08, 0.15);
      bd.weld(cob, 0.96, sdir, 1, 2, {
        spine: bendSpine(so, sdir, sl, 6, (s) => -(1.6 / sl) * s),
        ringTs: evenRings(6),
        sides: 6,
        profileAt: (tt, out) => circleInto(out, 6, 0.0011, 0.0011),
        colorAt: (tt) => mixRgb(tint(col(b.nutColor2), 1.3), [0.52, 0.36, 0.2], smoothstep(0.35, 1, tt)), // silk browns as it dries
        upHint: UP,
        tile: TILE.stem,
        vPerMeter: 3,
        organ: ORGAN.fruit,
        wind: wind(shankO, phase, 0.3, 0.5, 0.15, 0.45),
        capEnd: true,
      }, { collarRings: 0, collarScale: 0.4, margin: 0 });
    }
  }
}

function buildGrain(bd: PlantBuilder, p: PlantParams, rng: Random): void {
  const b = p.botany;
  const culms: { c: CulmResult; scale: number }[] = [];
  if (b.stemCount > 1) {
    const blob = buildCrownBlob(bd, p, rng, Math.max(0.03, b.trunkRadius * 5), 0.1);
    for (let i = 0; i < b.stemCount; i++) {
      const az = (i / b.stemCount) * TAU + rng.range(-0.3, 0.3);
      const off = i === 0 ? 0 : rng.range(0.015, 0.05);
      const scale = i === 0 ? 1 : rng.range(0.7, 0.95);
      const c = buildCulm(bd, p, rng.fork(), blob, v3(Math.cos(az) * off, 0, Math.sin(az) * off), az, scale);
      if (c) culms.push({ c, scale });
    }
  } else {
    const c = buildCulm(bd, p, rng.fork(), null, v3(0, 0, 0), rng.range(0, TAU), 1);
    if (c) culms.push({ c, scale: 1 });
  }
  for (const { c, scale } of culms) {
    buildCulmLeaves(bd, p, rng.fork(), c, 0.6 + 0.4 * scale);
    if (b.grainType === 'corn') buildCornHead(bd, p, rng.fork(), c, scale);
    else if (b.grainType === 'spike') buildSpikeHead(bd, p, rng.fork(), c, scale);
    else if (b.grainType === 'panicle') buildPanicleHead(bd, p, rng.fork(), c, scale);
    buildStiltRoots(bd, p, rng.fork(), c.grid);
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
    case 'grain':
      buildGrain(bd, params, rng);
      break;
    case 'vegetable':
      buildVegetable(bd, params, rng);
      break;
    case 'fruit':
      buildFruit(bd, params, rng);
      break;
    case 'carnivore':
      buildCarnivore(bd, params, rng);
      break;
  }
  const t1 = performance.now();
  const { mesh, height, stats } = bd.finalize();
  const t2 = performance.now();
  return { mesh, height, stats, timings: { build: t1 - t0, total: t2 - t0 } };
}

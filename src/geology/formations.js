/**
 * Procedural 3D Structural Block Assemblers for 18 Geological Formation Archetypes.
 *
 * Uses exact convex polyhedron half-space sculpting, 3D cubic Bézier arch curve sweeping,
 * recursive geological BSP fracture splitting with shear/frost-wedge kinematics,
 * multi-order stratigraphic bedding, and gravity-settled talus cones + fallen boulders.
 */

import {
  DEG2RAD,
  buildStrikeDipFrame,
  rotateAroundAxis,
  perturbNormal,
  vnorm,
  vdot,
  vcross,
  clamp,
} from '../core/vec3.js';
import { scalarField3D } from '../core/spatial-noise.js';
import {
  createBoxPoly,
  clipPolyByHalfSpace,
  splitPolyByPlane,
  measurePoly,
  transformPoly,
  sculptGeologicalParentPoly,
  compilePolyBlock,
  compileEllipsoidBlock,
} from './polyhedron.js';
import {
  compileCurvedArchRib,
  evalCubicBezier3D,
  evalCubicBezierDeriv3D,
  buildDesertArch,
  buildDoubleArch,
  buildSeaArch,
} from './arch-curves.js';
import {
  buildSedimentaryCliff,
  buildSlotCanyon,
  buildHoodooColumns,
  buildBalancedRock,
  buildLimestoneKarst,
  buildExfoliationDome,
} from './sedimentary-formations.js';
import { buildCrackedMonolith } from './cracks-demo.js';
import {
  buildGrandCanyonTemple,
  buildStudlagilColonnade,
  buildIcelandicTuyaCrag,
  buildSaharanYardangFin,
  buildCalvedCliffBoulders,
} from './frontier-formations.js';
import { buildCustomUserSplineArch } from './custom-arch-spline.js';
import { buildArchEncampment } from './encampment.js';

function recursiveGeologicalFracture(poly, frame, tectonics, rng, opts, depth = 0, outPolys = []) {
  const m = measurePoly(poly);
  if (!m) return outPolys;

  const maxDepth = opts.maxDepth ?? 3;
  const minSpan = opts.minSpan ?? 0.45;
  const minVol = opts.minVolume ?? 0.08;

  if (depth >= maxDepth || m.minSpan < minSpan || m.volume < minVol) {
    outPolys.push(poly);
    return outPolys;
  }

  let minS = Infinity, maxS = -Infinity;
  let minN = Infinity, maxN = -Infinity;
  let minD = Infinity, maxD = -Infinity;
  for (let i = 0; i < m.verts.length; i++) {
    const v = m.verts[i];
    const ps = vdot(v, frame.strikeVec);
    const pn = vdot(v, frame.normal);
    const pd = vdot(v, frame.dipVec);
    if (ps < minS) minS = ps; if (ps > maxS) maxS = ps;
    if (pn < minN) minN = pn; if (pn > maxN) maxN = pn;
    if (pd < minD) minD = pd; if (pd > maxD) maxD = pd;
  }

  const spanS = maxS - minS;
  const spanN = maxN - minN;
  const spanD = maxD - minD;

  let baseNormal;
  if (spanN > Math.max(spanS, spanD) * (opts.bedSplitBias ?? 0.95)) {
    baseNormal = frame.normal;
  } else if (spanS >= spanD) {
    baseNormal = rng.chance(0.55)
      ? frame.strikeVec
      : rotateAroundAxis(frame.dipVec, frame.normal, (rng.chance(0.5) ? 1 : -1) * 0.95);
  } else {
    baseNormal = rng.chance(0.6)
      ? frame.dipVec
      : rotateAroundAxis(frame.dipVec, frame.normal, (rng.chance(0.5) ? 1 : -1) * 0.95);
  }

  const splitNormal = perturbNormal(baseNormal, rng, opts.angleDispersion ?? 0.14);

  let pMin = Infinity, pMax = -Infinity;
  for (let i = 0; i < m.verts.length; i++) {
    const d = vdot(m.verts[i], splitNormal);
    if (d < pMin) pMin = d;
    if (d > pMax) pMax = d;
  }
  const pSpan = pMax - pMin;
  if (pSpan < minSpan * 1.45) {
    outPolys.push(poly);
    return outPolys;
  }

  const frac = rng.range(0.32, 0.68);
  const splitOffset = pMin + pSpan * frac;

  const openChance = opts.openCleftChance ?? 0.25;
  const isOpenCleft = rng.chance(openChance);
  const gap = isOpenCleft
    ? (opts.openGap ?? 0.06) * rng.range(0.65, 1.45)
    : -(opts.overlapDepth ?? 0.08);

  let [childA, childB] = splitPolyByPlane(poly, splitNormal, splitOffset, gap, 'joint');
  if (!childA || !childB) {
    outPolys.push(poly);
    return outPolys;
  }

  const slipMag = (opts.shearSlip ?? 0.12) * pSpan * rng.range(0.35, 1.0);
  const arb = Math.abs(splitNormal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangent1 = vnorm(vcross(splitNormal, arb));
  const tangent2 = vcross(splitNormal, tangent1);
  const slipAngle = rng.float() * Math.PI * 2;
  const slipDir = [
    tangent1[0] * Math.cos(slipAngle) + tangent2[0] * Math.sin(slipAngle),
    -Math.abs(tangent1[1] * Math.cos(slipAngle) + tangent2[1] * Math.sin(slipAngle)) * 0.65,
    tangent1[2] * Math.cos(slipAngle) + tangent2[2] * Math.sin(slipAngle),
  ];

  const tiltAngle = isOpenCleft ? rng.signed() * (opts.openTilt ?? 0.06) : rng.signed() * 0.025;
  childB = transformPoly(
    childB,
    [slipDir[0] * slipMag, slipDir[1] * slipMag, slipDir[2] * slipMag],
    tangent1,
    tiltAngle
  );

  if (opts.groundY !== undefined && opts.groundY !== null) {
    childA = clipPolyByHalfSpace(childA, [0, -1, 0], -opts.groundY, 'base') || childA;
    childB = clipPolyByHalfSpace(childB, [0, -1, 0], -opts.groundY, 'base') || childB;
  }

  const pluckProb = depth >= 1 ? (opts.pluckChance ?? 0.16) : 0;
  const mA = measurePoly(childA);
  const mB = measurePoly(childB);

  if (mA && mB && rng.chance(pluckProb)) {
    const keepPoly = mA.volume >= mB.volume ? childA : childB;
    recursiveGeologicalFracture(keepPoly, frame, tectonics, rng, opts, depth + 1, outPolys);
    return outPolys;
  }

  if (rng.chance(0.82)) {
    recursiveGeologicalFracture(childA, frame, tectonics, rng, opts, depth + 1, outPolys);
  } else {
    outPolys.push(childA);
  }

  if (rng.chance(0.82)) {
    recursiveGeologicalFracture(childB, frame, tectonics, rng, opts, depth + 1, outPolys);
  } else {
    outPolys.push(childB);
  }

  return outPolys;
}

function addTalusAndFallenBoulders(blocks, frame, rng, config) {
  const {
    talusAmount,
    scale,
    spanX,
    frontZFn,
    groundY = 0,
    edgeBevel = 0.025,
    mode = 'cliff',
  } = config;

  if (talusAmount <= 0.04) return;

  if (mode === 'cliff') {
    const numCones = Math.round(4 + talusAmount * 6);
    for (let i = 0; i < numCones; i++) {
      const u = (i + rng.range(0.18, 0.82)) / numCones - 0.5;
      const tx = u * spanX * 0.84;
      const baseZ = frontZFn ? frontZFn(tx) : 0;
      const coneH = scale * rng.range(0.08, 0.19) * (0.55 + 0.70 * talusAmount);
      const coneW = coneH * rng.range(1.15, 1.75);
      const coneRun = coneH * rng.range(1.25, 1.60);

      let wedge = createBoxPoly(
        tx - coneW, groundY, baseZ - coneRun * 0.65,
        tx + coneW, groundY + coneH * 1.15, baseZ + coneRun,
        'talus'
      );
      const reposeAngle = rng.range(33, 39) * DEG2RAD;
      const slopeN = vnorm([rng.signed() * 0.16, Math.cos(reposeAngle), Math.sin(reposeAngle)]);
      const anchor = [tx, groundY + coneH * 0.50, baseZ + coneRun * 0.20];
      wedge = clipPolyByHalfSpace(wedge, slopeN, vdot(slopeN, anchor), 'talusSlope');

      const sideL = vnorm([-0.68, 0.52, 0.50 + rng.signed() * 0.12]);
      const sideR = vnorm([0.68, 0.52, 0.50 + rng.signed() * 0.12]);
      wedge = clipPolyByHalfSpace(wedge, sideL, vdot(sideL, [tx - coneW * 0.35, groundY + coneH * 0.55, baseZ + coneRun * 0.2]), 'talusSide');
      wedge = clipPolyByHalfSpace(wedge, sideR, vdot(sideR, [tx + coneW * 0.35, groundY + coneH * 0.55, baseZ + coneRun * 0.2]), 'talusSide');

      if (wedge) {
        const compiled = compilePolyBlock(wedge, frame, {
          edgeBevel: edgeBevel * 1.3,
          detailScale: 0.55,
          isTalus: true,
          seedSalt: rng.int(1, 999999),
        });
        if (compiled) blocks.push(compiled);
      }
    }
  }

  const numBoulders = Math.round((mode === 'cliff' ? 9 : 6) + talusAmount * (mode === 'cliff' ? 18 : 11));
  for (let i = 0; i < numBoulders; i++) {
    const rMed = scale * (mode === 'cliff' ? 0.042 : 0.058);
    const bSize = clamp(rng.logNormal(rMed, 0.42), scale * 0.025, scale * 0.105);

    let bx, bz, by;
    if (mode === 'cliff') {
      bx = rng.range(-0.43, 0.43) * spanX;
      const fz = frontZFn ? frontZFn(bx) : 0;
      const distOut = bSize * rng.range(0.5, 3.2) + scale * rng.range(0.01, 0.10) * talusAmount;
      bz = fz + distOut;
      by = groundY + bSize * rng.range(0.32, 0.58);
    } else {
      const ang = rng.float() * Math.PI * 2;
      const rad = spanX * rng.range(0.38, 0.66);
      bx = Math.cos(ang) * rad;
      bz = Math.sin(ang) * rad;
      by = groundY + bSize * rng.range(0.28, 0.52);
    }

    const bFrame = buildStrikeDipFrame(rng.float() * Math.PI * 2, rng.range(10, 58) * DEG2RAD);
    const radii = [
      bSize * rng.range(0.88, 1.48),
      bSize * rng.range(0.58, 0.92),
      bSize * rng.range(0.82, 1.32),
    ];

    const poly = sculptGeologicalParentPoly([bx, by, bz], radii, bFrame, rng, {
      jointDispersion: 0.24,
      cornerBlunt: 0.82,
      flatBaseY: groundY,
      extraBevelCuts: 5,
    });

    const compiled = compilePolyBlock(poly, bFrame, {
      edgeBevel: edgeBevel * 0.85,
      detailScale: 0.72,
      isBoulder: true, // Protected from bedrock alcove/arch subtraction cuts!
      seedSalt: rng.int(1, 999999),
    });
    if (compiled) blocks.push(compiled);
  }
}

/**
 * 1. MASSIVE JOINTED CLIFF ESCARPMENT (`cliff-wall`)
 * Monumental buttress-and-gully escarpment with deterministic load-bearing shoulders
 * (zero unsupported end-cantilevers!), fault-stepped beds, overhanging brows & talus apron.
 */
function buildCliffWall(params, tectonics, rng) {
  const S = params.scale;
  const width = S;
  const height = S * 0.66;
  const depth = S * 0.38;
  const groundY = 0;

  const blocks = [];
  const cuts = [];

  const spineSalt = rng.int(1, 99999);
  function spineZ(x) {
    const u = x / width;
    const headland = scalarField3D(u * 2.8, 0.5, 0.5, spineSalt) * depth * 0.34;
    const buttress = scalarField3D(u * 6.2, 1.7, 0.5, spineSalt + 31) * depth * 0.14;
    return headland + buttress;
  }

  // Deterministic bottom-up crestline envelope: tallest on asymmetric main headland, tapering cleanly at shoulders!
  const peakShift = rng.range(-0.18, 0.18);
  function crestHeightAt(x) {
    const u = x / (width * 0.5); // -1 .. +1
    const shoulderTaper = Math.max(0.28, 1.0 - Math.max(0, Math.abs(u) - 0.62) * 1.55);
    const crestWave = 0.88 + 0.18 * scalarField3D((u - peakShift) * 1.9, 2.3, 0.5, spineSalt + 99);
    return height * shoulderTaper * crestWave;
  }

  const tiers = [];
  let curY = groundY;
  const numTargetTiers = Math.round(5 + params.jointDensity * 5);
  const avgH = height / numTargetTiers;

  while (curY < height * 0.98) {
    const isMassive = rng.chance(0.60);
    const h = clamp(
      avgH * (isMassive ? rng.range(1.10, 1.75) : rng.range(0.50, 0.88)),
      height * 0.08,
      height * 0.30
    );
    const competency = isMassive ? rng.range(0.68, 1.0) : rng.range(0.14, 0.46);
    tiers.push({ y0: curY, y1: Math.min(height * 1.08, curY + h), competency });
    curY += h * 0.88;
  }

  const overhangAmt = params.overhangStrength ?? 0.68;
  const aperture = params.jointAperture ?? 0.46;
  const bevel = S * (0.0018 + 0.005 * (params.edgeWear ?? 0.34));

  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti];
    const yMid = 0.5 * (tier.y0 + tier.y1);
    const tierH = tier.y1 - tier.y0;
    const heightFrac = yMid / height;

    const overhangBias = (tier.competency - 0.42) * depth * 0.36 * overhangAmt +
      (heightFrac - 0.32) * depth * 0.16 * overhangAmt;

    const avgSegW = clamp((width / (4 + params.jointDensity * 5.5)) * (0.72 + 0.55 * tier.competency), width * 0.08, width * 0.26);
    let curX = -width * 0.47;

    while (curX < width * 0.47) {
      const segW = clamp(avgSegW * rng.range(0.72, 1.38), width * 0.08, width * 0.28);
      const xMid = curX + segW * 0.5;
      const nextX = curX + segW;

      const localCrest = crestHeightAt(xMid);
      if (tier.y0 > localCrest) {
        curX = nextX;
        continue;
      }

      const faultDmg = tectonics.evalFaultDamage(xMid, yMid, 0);
      const shift = tectonics.evalTectonicShift(xMid, yMid, 0);

      // Recess blocks in fault gullies instead of deleting whole columns on end shoulders
      const isInterior = Math.abs(xMid) < width * 0.34;
      const pluckRecess = (isInterior && ti > 0 && ti < tiers.length - 1 && rng.chance((params.pluckingAmount ?? 0.5) * 0.28))
        ? depth * rng.range(0.14, 0.28)
        : 0;

      const fz = spineZ(xMid) + overhangBias - faultDmg * depth * 0.20 - pluckRecess + shift[2];
      const backZ = -depth * rng.range(0.46, 0.62);
      const zMid = 0.5 * (fz + backZ);
      const segD = Math.max(depth * 0.24, (fz - backZ) * 0.56);

      const localFrame = tectonics.localFrameAt(xMid, yMid, zMid);
      const by0 = Math.max(groundY, tier.y0 + shift[1]);
      const by1 = Math.min(localCrest + tierH * 0.25, Math.max(by0 + tierH * 0.55, tier.y1 + shift[1]));

      const parent = sculptGeologicalParentPoly(
        [xMid + shift[0] * 0.35, 0.5 * (by0 + by1), zMid],
        [segW * 0.62, (by1 - by0) * 0.64, segD],
        localFrame,
        rng,
        {
          jointDispersion: 0.16 + faultDmg * 0.12,
          cornerBlunt: 0.76,
          flatBaseY: ti === 0 ? groundY : null,
          extraBevelCuts: 4,
        }
      );

      const subPolys = recursiveGeologicalFracture(parent, localFrame, tectonics, rng, {
        maxDepth: faultDmg > 0.35 ? 3 : 2,
        minSpan: S * 0.048,
        minVolume: (S * 0.04) ** 3,
        openCleftChance: 0.16 * aperture,
        openGap: S * 0.007 * (0.5 + aperture),
        overlapDepth: S * 0.018,
        shearSlip: 0.11 + 0.09 * overhangAmt,
        pluckChance: isInterior ? 0.18 * (params.pluckingAmount ?? 0.5) : 0,
        groundY: ti === 0 ? groundY : null,
      });

      for (let k = 0; k < subPolys.length; k++) {
        const comp = compilePolyBlock(subPolys[k], localFrame, {
          edgeBevel: bevel,
          detailScale: 0.85 + 0.28 * tier.competency,
          seedSalt: rng.int(1, 999999),
        });
        if (comp) blocks.push(comp);
      }

      curX = nextX - segW * rng.range(0.08, 0.18);
    }
  }

  // Carve 2-3 concave plucked niches strictly on the central front face
  const numCuts = Math.round(2 + (params.pluckingAmount ?? 0.5) * 3);
  for (let i = 0; i < numCuts; i++) {
    const cx = rng.range(-0.28, 0.28) * width;
    const cy = rng.range(0.18, 0.62) * crestHeightAt(cx);
    const cz = spineZ(cx) + depth * rng.range(0.10, 0.24);
    const cFrame = tectonics.localFrameAt(cx, cy, cz);
    const cutPoly = sculptGeologicalParentPoly(
      [cx, cy, cz],
      [width * rng.range(0.05, 0.10), height * rng.range(0.06, 0.13), depth * rng.range(0.12, 0.22)],
      cFrame,
      rng,
      { jointDispersion: 0.18, cornerBlunt: 0.74, extraBevelCuts: 2 }
    );
    const compCut = compilePolyBlock(cutPoly, cFrame, {
      edgeBevel: bevel * 0.6,
      seedSalt: rng.int(1, 999999),
    });
    if (compCut) cuts.push(compCut);
  }

  addTalusAndFallenBoulders(blocks, tectonics.baseFrame, rng, {
    talusAmount: params.talusAmount ?? 0.62,
    scale: S,
    spanX: width,
    frontZFn: (x) => spineZ(x) + depth * 0.08,
    groundY,
    edgeBevel: bevel,
    mode: 'cliff',
  });

  return { blocks, cuts, groundY };
}

/**
 * 2. FROST-SHATTERED ALPINE CRAG & SPIRE (`alpine-crag`)
 * Chamonix Aiguille / Tre Cime / Matterhorn jagged monolithic alpine horn & arête ridge:
 * - Every spire, gendarme needle, arête fin, and stepped buttress rib extends CONTINUOUSLY
 *   down to `groundY` (ZERO horizontal bandsaw masonry slices and ZERO stacked Cairn blocks!)
 * - Overlapping inner towering aiguille horns + mid-height snow-ledge buttress shoulders +
 *   flared lower dihedral spurs separated by a deep V-couloir gully!
 */
function buildAlpineCrag(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0012 + 0.0030 * (params.edgeWear ?? 0.24));

  const mainDip = clamp((params.dipAngle ?? 64), 48, 82) * DEG2RAD;
  const mainStrike = (params.strikeAngle ?? 18) * DEG2RAD;
  const mainFrame = buildStrikeDipFrame(mainStrike, mainDip);
  const overhang = params.overhangStrength ?? 0.58;
  const aperture = params.jointAperture ?? 0.44;
  const cosR = Math.cos(mainStrike), sinR = Math.sin(mainStrike);

  // Monolithic grounded alpine needles & arête gendarmes: each tower has a soaring inner needle
  // PLUS 1-2 lower projecting grounded buttress spurs so ledges step outward naturally without horizontal cuts!
  const spires = [
    { u: -0.04, v: -0.02, h: 1.06, ru: 0.145, rv: 0.125, lean:  0.11, spurs: 2 }, // Primary soaring Matterhorn/Dru horn
    { u:  0.15, v:  0.03, h: 0.86, ru: 0.125, rv: 0.112, lean: -0.08, spurs: 2 }, // Leaning twin needle across V-couloir!
    { u: -0.19, v: -0.01, h: 0.78, ru: 0.130, rv: 0.115, lean:  0.09, spurs: 2 }, // West arête shoulder spire
    { u:  0.30, v: -0.02, h: 0.64, ru: 0.118, rv: 0.105, lean: -0.07, spurs: 1 }, // East arête gendarme
    { u: -0.33, v:  0.03, h: 0.56, ru: 0.115, rv: 0.102, lean:  0.07, spurs: 1 }, // Lower west saw-tooth gendarme
    { u: -0.09, v:  0.15, h: 0.58, ru: 0.105, rv: 0.115, lean:  0.06, spurs: 1 }, // South couloir buttress rib W
    { u:  0.12, v:  0.15, h: 0.46, ru: 0.098, rv: 0.108, lean: -0.05, spurs: 1 }, // South couloir buttress rib E
    { u:  0.02, v: -0.17, h: 0.70, ru: 0.122, rv: 0.115, lean:  0.08, spurs: 1 }, // North-wall sheer buttress
    { u: -0.44, v:  0.06, h: 0.36, ru: 0.098, rv: 0.090, lean:  0.05, spurs: 0 }, // Outer west arête tooth
    { u:  0.42, v: -0.04, h: 0.38, ru: 0.096, rv: 0.090, lean: -0.05, spurs: 0 }, // Outer east arête tooth
  ];

  function addMonolithicNeedle(cx, cz, h, ru, rv, leanVec, isHorn, seedIdx) {
    const [lx, lz] = leanVec;
    const maxR = Math.max(ru, rv) * 1.9 + Math.hypot(lx, lz);
    let poly = createBoxPoly(
      cx - maxR, groundY, cz - maxR,
      cx + maxR, groundY + h * 1.14, cz + maxR,
      'aiguille'
    );

    // 6-to-7 steep dihedral rock walls leaning along [lx, lz] from groundY to peak!
    // Outer buttresses lean INWARD toward the summit massif so the mountain base flares naturally!
    const nFaces = 6 + (seedIdx & 1);
    const az0 = mainStrike + seedIdx * 0.59;
    const dxdy = lx / Math.max(S * 0.1, h);
    const dzdy = lz / Math.max(S * 0.1, h);

    for (let f = 0; f < nFaces; f++) {
      const a = az0 + (f * Math.PI * 2) / nFaces + rng.signed() * 0.18;
      const hx = Math.cos(a), hz = Math.sin(a);
      const da = a - mainStrike;
      const rad = (1.0 / Math.hypot(Math.cos(da) / ru, Math.sin(da) / rv)) * rng.range(0.80, 1.02);
      const taper = rng.range(0.14, 0.28);
      // Wall normal tilts with the spire's lean axis + upward taper!
      const ny = taper - (hx * dxdy + hz * dzdy);
      const fn = vnorm([hx, ny, hz]);
      const midPt = [
        cx + lx * 0.42,
        groundY + h * 0.42,
        cz + lz * 0.42,
      ];
      poly = clipPolyByHalfSpace(poly, fn, vdot(fn, midPt) + rad, 'alpineWall') || poly;
    }

    const apexPt = [
      cx + lx * 0.94,
      groundY + h * 0.97,
      cz + lz * 0.94,
    ];
    if (isHorn) {
      const cAz = mainStrike + Math.PI * 0.5 + rng.signed() * 0.24;
      const pN1 = vnorm([Math.cos(cAz) * 0.78, 0.62, Math.sin(cAz) * 0.78]);
      const pN2 = vnorm([-Math.cos(cAz + 0.36) * 0.76, 0.65, -Math.sin(cAz + 0.36) * 0.76]);
      const pN3 = vnorm([Math.cos(mainStrike) * (seedIdx % 2 === 0 ? 0.68 : -0.68), 0.73, Math.sin(mainStrike) * (seedIdx % 2 === 0 ? 0.68 : -0.68)]);
      poly = clipPolyByHalfSpace(poly, pN1, vdot(pN1, apexPt), 'hornCrest') || poly;
      poly = clipPolyByHalfSpace(poly, pN2, vdot(pN2, apexPt) + rv * 0.14, 'hornCrest') || poly;
      poly = clipPolyByHalfSpace(poly, pN3, vdot(pN3, apexPt) + ru * 0.20, 'hornEnd') || poly;
    } else {
      const sAz = Math.atan2(-lz, -lx) + rng.signed() * 0.35;
      const shelfN = vnorm([Math.cos(sAz) * 0.72, 0.69, Math.sin(sAz) * 0.72]);
      poly = clipPolyByHalfSpace(poly, shelfN, vdot(shelfN, apexPt), 'shoulderLedge') || poly;
    }
    poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

    const localF = buildStrikeDipFrame(mainStrike + rng.signed() * 0.10, mainDip + rng.signed() * 0.08);
    const comp = compilePolyBlock(poly, localF, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.005,
      detailScale: 1.06,
      seedSalt: rng.int(1, 999999),
    });
    if (comp) blocks.push(comp);
  }

  let seedCounter = 1;
  for (let i = 0; i < spires.length; i++) {
    const sp = spires[i];
    const bx = (sp.u * cosR - sp.v * sinR) * S + rng.signed() * S * 0.010;
    const bz = (sp.u * sinR + sp.v * cosR) * S + rng.signed() * S * 0.010;
    const h = sp.h * S * rng.range(0.94, 1.06);
    const ru = sp.ru * S * rng.range(0.92, 1.12);
    const rv = sp.rv * S * rng.range(0.88, 1.06);

    // Central horn overhangs forward; flanking buttresses lean inward toward the summit pyramid!
    const headwallLean = sp.lean * S * (0.7 + 0.5 * overhang);
    const inwardPull = i === 0 ? 0 : 0.36;
    const leanVec = [
      (-sinR) * headwallLean - bx * inwardPull,
      cosR * headwallLean - bz * inwardPull,
    ];

    addMonolithicNeedle(bx, bz, h, ru, rv, leanVec, true, seedCounter++);

    // Splayed basal buttress ridges flaring outward onto the mountain apron (eliminates vertical organ-pipe look!)
    for (let s = 0; s < sp.spurs; s++) {
      const outDirAng = (i === 0 ? mainStrike + (s === 0 ? 1.45 : -1.45) : Math.atan2(bz, bx)) + rng.signed() * 0.42;
      const baseOutDist = (0.62 + 0.34 * s) * Math.max(ru, rv);
      const spurBx = bx + Math.cos(outDirAng) * baseOutDist;
      const spurBz = bz + Math.sin(outDirAng) * baseOutDist;
      const spurH = h * (s === 0 ? rng.range(0.52, 0.65) : rng.range(0.28, 0.42));
      const spurLean = [
        (bx - spurBx) * 0.68,
        (bz - spurBz) * 0.68,
      ];
      addMonolithicNeedle(
        spurBx,
        spurBz,
        spurH,
        ru * rng.range(0.78, 0.98),
        rv * rng.range(0.72, 0.92),
        spurLean,
        s === 0 && rng.chance(0.45),
        seedCounter++
      );
    }
  }

  // Deep frost-riven couloir slot cleft slicing cleanly between main horn and right gendarme!
  const couloirW = S * (0.010 + 0.014 * aperture);
  const couloirPoly = sculptGeologicalParentPoly(
    [(0.055 * cosR) * S, groundY + 0.58 * S, (0.055 * sinR) * S],
    [couloirW, 0.38 * S, 0.24 * S],
    mainFrame,
    rng,
    { jointDispersion: 0.05, cornerBlunt: 0.78 }
  );
  const compCouloir = compilePolyBlock(couloirPoly, mainFrame, { edgeBevel: S * 0.002 });
  if (compCouloir) cuts.push(compCouloir);

  addTalusAndFallenBoulders(blocks, mainFrame, rng, {
    talusAmount: (params.talusAmount ?? 0.48) * 0.95,
    scale: S * 0.90,
    spanX: S * 0.72,
    groundY,
    edgeBevel: bevel,
    mode: 'outcrop',
  });

  return { blocks, cuts, groundY };
}

/**
 * 3. COLUMNAR BASALT ESCARPMENT (`basalt-columns`)
 */
function buildBasaltColumns(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const colSpacing = S * clamp(0.118 - 0.042 * (params.jointDensity ?? 0.7), 0.062, 0.115);
  const openGap = colSpacing * (0.025 + 0.060 * (params.jointAperture ?? 0.38));
  const bevel = colSpacing * (0.03 + 0.07 * (params.edgeWear ?? 0.2));

  const nx = Math.round((S * 0.84) / colSpacing);
  const nz = Math.round((S * 0.54) / (colSpacing * 0.866));
  const sites = [];

  for (let iz = -1; iz <= nz + 1; iz++) {
    for (let ix = -1; ix <= nx + 1; ix++) {
      const rowShift = (iz & 1) ? 0.5 : 0.0;
      const sx = ((ix + rowShift) - nx * 0.5) * colSpacing + rng.signed() * colSpacing * 0.24;
      const sz = (iz - nz * 0.5) * colSpacing * 0.866 + rng.signed() * colSpacing * 0.24;
      sites.push({ x: sx, z: sz, ix, iz, active: ix >= 0 && ix <= nx && iz >= 0 && iz <= nz });
    }
  }

  const tiltRad = clamp((params.dipAngle ?? 6) * DEG2RAD, 0, 0.32);
  const colFrame = buildStrikeDipFrame((params.strikeAngle ?? 0) * DEG2RAD, tiltRad);
  const profSalt = rng.int(1, 99999);

  for (let si = 0; si < sites.length; si++) {
    const site = sites[si];
    if (!site.active) continue;

    const ux = site.x / (S * 0.44);
    const uz = site.z / (S * 0.27);
    const radialMask = 1.0 - 0.52 * ux * ux - 0.22 * Math.max(0, uz);
    const bayCurve = scalarField3D(ux * 1.9, 0.5, uz * 1.9, profSalt) * 0.34;
    const rawHeightFrac = radialMask - uz * 0.44 + bayCurve;

    if (rawHeightFrac < 0.09) continue;

    const stepUnit = colSpacing * rng.range(0.75, 1.35);
    const colTop = Math.max(
      colSpacing * 0.85,
      Math.round((clamp(rawHeightFrac, 0.1, 1.0) * S * 0.62) / stepUnit) * stepUnit + rng.signed() * stepUnit * 0.14
    );

    const isFrontBrow = uz > -0.10 && uz < 0.35 && colTop > S * 0.30;
    const pluckBottom = isFrontBrow && rng.chance(0.32 * (params.overhangStrength ?? 0.5) + 0.22 * (params.pluckingAmount ?? 0.5));
    const colBase = pluckBottom ? clamp(colTop * rng.range(0.30, 0.56), colSpacing, colTop - colSpacing * 1.2) : groundY;

    // Deep interior columns fuse slightly below top tier to eliminate hidden internal faces (2x faster & cleaner!)
    const isDeepInterior = uz < -0.25 && Math.abs(ux) < 0.55;
    const localGap = isDeepInterior ? -colSpacing * 0.015 : openGap;

    const maxR = colSpacing * 0.95;
    let prism = createBoxPoly(
      site.x - maxR, colBase, site.z - maxR,
      site.x + maxR, colTop, site.z + maxR,
      'column'
    );

    for (let nj = 0; nj < sites.length; nj++) {
      if (nj === si) continue;
      const nb = sites[nj];
      const dx = nb.x - site.x;
      const dz = nb.z - site.z;
      const dist = Math.hypot(dx, dz);
      if (dist > colSpacing * 2.25 || dist < 1e-5) continue;

      const wnx = dx / dist;
      const wnz = dz / dist;
      const midX = 0.5 * (site.x + nb.x) - wnx * localGap * 0.5;
      const midZ = 0.5 * (site.z + nb.z) - wnz * localGap * 0.5;
      const wallN = tiltRad > 1e-3
        ? rotateAroundAxis([wnx, 0, wnz], colFrame.strikeVec, tiltRad)
        : [wnx, 0, wnz];
      const off = wallN[0] * midX + wallN[1] * (0.5 * (colBase + colTop)) + wallN[2] * midZ;
      prism = clipPolyByHalfSpace(prism, wallN, off, 'colFace');
      if (!prism) break;
    }
    if (!prism) continue;

    const topN = perturbNormal([0, 1, 0], rng, 0.16);
    prism = clipPolyByHalfSpace(prism, topN, topN[0] * site.x + topN[1] * colTop + topN[2] * site.z, 'crossJoint');
    if (pluckBottom && prism) {
      const botN = perturbNormal([0, -1, 0], rng, 0.18);
      prism = clipPolyByHalfSpace(prism, botN, botN[0] * site.x + botN[1] * colBase + botN[2] * site.z, 'crossJoint');
    }
    if (!prism) continue;

    const totalH = colTop - colBase;
    const numSegs = isDeepInterior ? 1 : Math.max(1, Math.min(3, Math.floor(totalH / (colSpacing * 2.0))));
    let current = prism;
    const segPolys = [];

    for (let s = 1; s < numSegs && current; s++) {
      const splitY = colBase + (totalH * s) / numSegs + rng.signed() * colSpacing * 0.2;
      const cjNormal = perturbNormal([0, 1, 0], rng, 0.12);
      const cjOffset = cjNormal[0] * site.x + cjNormal[1] * splitY + cjNormal[2] * site.z;
      const [lower, upper] = splitPolyByPlane(current, cjNormal, cjOffset, -colSpacing * 0.04, 'crossJoint');
      if (lower) segPolys.push(lower);
      current = upper
        ? transformPoly(upper, [rng.signed() * colSpacing * 0.06, 0, rng.signed() * colSpacing * 0.06])
        : null;
    }
    if (current) segPolys.push(current);

    for (let k = 0; k < segPolys.length; k++) {
      const comp = compilePolyBlock(segPolys[k], colFrame, {
        edgeBevel: bevel,
        detailScale: 0.45,
        seedSalt: rng.int(1, 999999),
      });
      if (comp) blocks.push(comp);
    }
  }

  const numDrums = Math.round(6 + (params.talusAmount ?? 0.55) * 14);
  for (let i = 0; i < numDrums; i++) {
    const drumR = colSpacing * rng.range(0.42, 0.56);
    const drumLen = colSpacing * rng.range(0.55, 1.25);
    const dx = rng.range(-0.38, 0.38) * S;
    const dz = S * rng.range(0.14, 0.33);
    const dy = groundY + drumR * rng.range(0.55, 0.85);

    let drum = createBoxPoly(-drumR * 1.4, -drumLen, -drumR * 1.4, drumR * 1.4, drumLen, drumR * 1.4, 'drum');
    const sides = rng.pick([5, 6, 6, 6, 7]);
    const phase = rng.float() * Math.PI * 2;
    for (let s = 0; s < sides; s++) {
      const a = phase + (s * Math.PI * 2) / sides + rng.signed() * 0.08;
      drum = clipPolyByHalfSpace(drum, [Math.cos(a), 0, Math.sin(a)], drumR * rng.range(0.92, 1.06), 'colFace');
    }
    drum = clipPolyByHalfSpace(drum, perturbNormal([0, 1, 0], rng, 0.16), drumLen * 0.5, 'crossJoint');
    drum = clipPolyByHalfSpace(drum, perturbNormal([0, -1, 0], rng, 0.16), drumLen * 0.5, 'crossJoint');

    if (drum) {
      const axis = rng.unitVec3();
      drum = transformPoly(drum, [dx, dy, dz], axis, rng.range(0.8, 1.65), [0, 0, 0]);
      drum = clipPolyByHalfSpace(drum, [0, -1, 0], -groundY, 'base') || drum;
      const dFrame = buildStrikeDipFrame(rng.float() * Math.PI * 2, rng.range(20, 75) * DEG2RAD);
      const comp = compilePolyBlock(drum, dFrame, {
        edgeBevel: bevel,
        detailScale: 0.45,
        isBoulder: true,
        seedSalt: rng.int(1, 999999),
      });
      if (comp) blocks.push(comp);
    }
  }

  return { blocks, cuts, groundY };
}

/**
 * 4. WEATHERED GRANITE TOR & CORESTONES (`granite-tor`)
 */
function buildGraniteTor(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const bevel = S * (0.004 + 0.011 * (params.edgeWear ?? 0.58));
  const numStacks = 3;

  for (let st = 0; st < numStacks; st++) {
    const isPrimary = st === 0;
    const sx = isPrimary ? rng.signed() * S * 0.04 : (st === 1 ? -1 : 1) * S * rng.range(0.18, 0.28);
    const sz = isPrimary ? -S * 0.03 : rng.range(-0.14, 0.16) * S;
    const stackW = isPrimary ? S * 0.30 : S * rng.range(0.18, 0.24);
    const stackD = isPrimary ? S * 0.24 : S * rng.range(0.16, 0.22);
    const numTiers = isPrimary ? rng.int(3, 4) : rng.int(2, 3);

    let curY = groundY;
    for (let t = 0; t < numTiers; t++) {
      const tierH = S * (t === 0 ? rng.range(0.16, 0.23) : rng.range(0.11, 0.18));
      const shrink = 1.0 - t * 0.12 + (t === numTiers - 1 ? 0.08 * (params.overhangStrength ?? 0.6) : 0);
      const cx = sx + rng.signed() * stackW * 0.14;
      const cz = sz + rng.signed() * stackD * 0.14;
      const cy = curY + tierH * 0.5;

      const localFrame = tectonics.localFrameAt(cx, cy, cz);
      const poly = sculptGeologicalParentPoly(
        [cx, cy, cz],
        [stackW * shrink, tierH * 0.58, stackD * shrink],
        localFrame,
        rng,
        {
          jointDispersion: 0.14,
          cornerBlunt: 0.84,
          flatBaseY: t === 0 ? groundY : null,
          extraBevelCuts: 4,
        }
      );

      const corestones = recursiveGeologicalFracture(poly, localFrame, tectonics, rng, {
        maxDepth: 2,
        minSpan: S * 0.07,
        minVolume: (S * 0.05) ** 3,
        bedSplitBias: 1.5,
        openCleftChance: 0.48 * (params.jointAperture ?? 0.6),
        openGap: S * 0.014 * (0.5 + (params.jointAperture ?? 0.6)),
        overlapDepth: S * 0.012,
        shearSlip: 0.06,
        pluckChance: t > 0 ? 0.24 * (params.pluckingAmount ?? 0.48) : 0,
        groundY: t === 0 ? groundY : null,
      });

      for (let k = 0; k < corestones.length; k++) {
        const comp = compilePolyBlock(corestones[k], localFrame, {
          edgeBevel: bevel * rng.range(0.75, 1.25),
          detailScale: 0.85,
          seedSalt: rng.int(1, 999999),
        });
        if (comp) blocks.push(comp);
      }

      curY += tierH * 0.88;
    }
  }

  addTalusAndFallenBoulders(blocks, tectonics.baseFrame, rng, {
    talusAmount: params.talusAmount ?? 0.45,
    scale: S,
    spanX: S * 0.66,
    groundY,
    edgeBevel: bevel * 0.75,
    mode: 'outcrop',
  });

  return { blocks, cuts, groundY };
}

/**
 * 5. FOLIATED METAMORPHIC HOGBACK / THRUST SLABS (`metamorphic-outcrop`)
 * Flatirons / Vasquez Rocks / Highland Schist monumental steeply-dipping hogback blades:
 * - 8 long, sweeping, parallel steeply-dipping (`48-58°`) foliated stone fin ridges
 *   (ZERO tiny dragon-scale shingles and ZERO rectangular floorboard tiles!)
 * - Each fin ridge rises to a jagged saw-toothed cuesta crest with overhanging anti-dip
 *   scarp faces, carved cleanly by 2 oblique cross-joint gullies!
 */
function buildMetamorphicOutcrop(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const dipRad = clamp((params.dipAngle ?? 50), 38, 66) * DEG2RAD;
  const strikeRad = (params.strikeAngle ?? -24) * DEG2RAD;
  const baseFrame = buildStrikeDipFrame(strikeRad, dipRad);
  const overhang = params.overhangStrength ?? 0.78;
  const aperture = params.jointAperture ?? 0.44;
  const bevel = S * (0.0010 + 0.0028 * (params.edgeWear ?? 0.22));

  const upDip = [-baseFrame.dipVec[0], -baseFrame.dipVec[1], -baseFrame.dipVec[2]];
  const strikeV = baseFrame.strikeVec;
  const normV = baseFrame.normal;

  // 8 Monumental Parallel Foliation Fin Blades stacked across foliation normal,
  // each divided into 2-3 long asymmetric Flatirons-style strike teeth!
  const numSheets = 8;
  const stackSpan = S * 0.54;
  const ridgeSpan = S * 0.90;

  for (let s = 0; s < numSheets; s++) {
    const vNorm = (s / (numSheets - 1)) - 0.5; // -0.5 .. +0.5 across foliation
    const sheetBell = Math.exp(-vNorm * vNorm * 2.8);
    const sheetThick = S * rng.range(0.046, 0.076);
    const finFrame = buildStrikeDipFrame(strikeRad + rng.signed() * 0.04, dipRad + rng.signed() * 0.05);

    // 2 to 3 long sweeping hogback teeth along strike per foliation sheet!
    const nTeeth = s % 2 === 0 ? 3 : 2;
    for (let t = 0; t < nTeeth; t++) {
      const uCenter = nTeeth === 3 ? (t - 1) * 0.30 : (t - 0.5) * 0.36;
      const toothSpan = (ridgeSpan / nTeeth) * rng.range(0.88, 1.08);
      const uEnv = 1.0 - 0.55 * uCenter * uCenter;
      const reach = S * (0.28 + 0.46 * sheetBell * uEnv) * (0.78 + 0.38 * overhang) * rng.range(0.90, 1.12);

      const posAcross = vNorm * stackSpan;
      const posStrike = (uCenter + rng.signed() * 0.04) * ridgeSpan;
      const thrust = reach * 0.52;

      const cx = normV[0] * posAcross + strikeV[0] * posStrike + upDip[0] * thrust;
      const cy = groundY + Math.max(sheetThick * 0.6, upDip[1] * thrust * 0.72);
      const cz = normV[2] * posAcross + strikeV[2] * posStrike + upDip[2] * thrust;

      let poly = sculptGeologicalParentPoly(
        [cx, cy, cz],
        [toothSpan * 0.54, sheetThick * 0.64, reach * 0.62],
        finFrame,
        rng,
        {
          jointDispersion: 0.08,
          cornerBlunt: 0.74,
          flatBaseY: groundY,
          extraBevelCuts: 4,
        }
      );

      // Sharp asymmetric Flatirons-style pointed cuesta crest along the up-dip edge!
      const tipPt = [
        cx + upDip[0] * reach * 0.46,
        cy + upDip[1] * reach * 0.46,
        cz + upDip[2] * reach * 0.46,
      ];
      const angL = rng.range(0.32, 0.58);
      const angR = rng.range(0.32, 0.58);
      const prowL = vnorm([
        upDip[0] * Math.cos(angL) - strikeV[0] * Math.sin(angL),
        upDip[1] * Math.cos(angL) + 0.16,
        upDip[2] * Math.cos(angL) - strikeV[2] * Math.sin(angL),
      ]);
      const prowR = vnorm([
        upDip[0] * Math.cos(angR) + strikeV[0] * Math.sin(angR),
        upDip[1] * Math.cos(angR) + 0.14,
        upDip[2] * Math.cos(angR) + strikeV[2] * Math.sin(angR),
      ]);
      poly = clipPolyByHalfSpace(poly, prowL, vdot(prowL, tipPt) + toothSpan * 0.10, 'flatironProw') || poly;
      poly = clipPolyByHalfSpace(poly, prowR, vdot(prowR, tipPt) + toothSpan * 0.10, 'flatironProw') || poly;

      // Steep anti-dip overhanging scarp face!
      const scarpN = vnorm([
        upDip[0] * 0.86 - normV[0] * 0.50,
        upDip[1] * 0.52 - 0.22,
        upDip[2] * 0.86 - normV[2] * 0.50,
      ]);
      poly = clipPolyByHalfSpace(poly, scarpN, vdot(scarpN, tipPt) + sheetThick * 0.28, 'antiDipScarp') || poly;
      poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

      const comp = compilePolyBlock(poly, finFrame, {
        edgeBevel: bevel,
        smoothUnionR: S * 0.0032,
        detailScale: 1.05,
        seedSalt: rng.int(1, 999999),
      });
      if (comp) blocks.push(comp);
    }
  }

  // Subordinate stepped exfoliation slabs along the lower dip-slope apron (adds rich multi-tiered Flatirons relief!)
  for (let sub = 0; sub < 5; sub++) {
    const su = -0.34 + sub * 0.17 + rng.signed() * 0.04;
    const sv = -0.56 - rng.range(0.02, 0.09);
    const sReach = S * rng.range(0.18, 0.32);
    const sThick = S * rng.range(0.036, 0.056);
    const scx = normV[0] * sv * stackSpan + strikeV[0] * su * ridgeSpan + upDip[0] * sReach * 0.42;
    const scy = groundY + Math.max(sThick * 0.55, upDip[1] * sReach * 0.34);
    const scz = normV[2] * sv * stackSpan + strikeV[2] * su * ridgeSpan + upDip[2] * sReach * 0.42;

    let subPoly = sculptGeologicalParentPoly(
      [scx, scy, scz],
      [S * rng.range(0.11, 0.17), sThick * 0.60, sReach * 0.56],
      baseFrame,
      rng,
      { jointDispersion: 0.09, cornerBlunt: 0.74, flatBaseY: groundY, extraBevelCuts: 5 }
    );
    const tipSub = [scx + upDip[0] * sReach * 0.42, scy + upDip[1] * sReach * 0.42, scz + upDip[2] * sReach * 0.42];
    const pSubL = vnorm([upDip[0] * 0.82 - strikeV[0] * 0.52, upDip[1] * 0.82 + 0.15, upDip[2] * 0.82 - strikeV[2] * 0.52]);
    const pSubR = vnorm([upDip[0] * 0.82 + strikeV[0] * 0.52, upDip[1] * 0.82 + 0.15, upDip[2] * 0.82 + strikeV[2] * 0.52]);
    subPoly = clipPolyByHalfSpace(subPoly, pSubL, vdot(pSubL, tipSub) + S * 0.03, 'subProw') || subPoly;
    subPoly = clipPolyByHalfSpace(subPoly, pSubR, vdot(pSubR, tipSub) + S * 0.03, 'subProw') || subPoly;
    subPoly = clipPolyByHalfSpace(subPoly, [0, -1, 0], -groundY, 'base') || subPoly;

    const compSub = compilePolyBlock(subPoly, baseFrame, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.003,
      detailScale: 1.05,
      seedSalt: rng.int(1, 999999),
    });
    if (compSub) blocks.push(compSub);
  }

  addTalusAndFallenBoulders(blocks, baseFrame, rng, {
    talusAmount: (params.talusAmount ?? 0.48) * 0.90,
    scale: S * 0.88,
    spanX: S * 0.76,
    groundY,
    edgeBevel: bevel,
    mode: 'outcrop',
  });

  return { blocks, cuts, groundY };
}

/**
 * 6. CAPROCK SANDSTONE BUTTE & UNDERCUT ALCOVE (`sandstone-butte`)
 * Sweeping monumental mesa caprock slabs + deep clean overhanging canyon alcove (no hanging pillars!).
 */
function buildSandstoneButte(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0025 + 0.007 * (params.edgeWear ?? 0.46));

  const height = S * 0.66;
  const radX = S * 0.44;
  const radZ = S * 0.30;
  const overhang = params.overhangStrength ?? 0.82;

  // Broad horizontal mechanical rock units with irregular headland buttress prows (no regular comb slots!)
  const unitSpecs = [
    { y0: 0.00, y1: 0.24, zFront: 0.88, wScale: 1.06, comp: 0.55 },
    { y0: 0.20, y1: 0.50, zFront: 0.72, wScale: 0.94, comp: 0.30 }, // Recessive alcove horizon
    { y0: 0.45, y1: 0.78, zFront: 1.04, wScale: 1.02, comp: 0.88 }, // Massive cliff-former
    { y0: 0.73, y1: 0.94, zFront: 1.15, wScale: 1.05, comp: 1.00 }, // Overhanging caprock!
    { y0: 0.88, y1: 1.06, zFront: 0.82, wScale: 0.65, comp: 0.90 }, // Asymmetric summit mesa crown
  ];

  const crownOffset = rng.range(-0.14, 0.14) * S;

  for (let ui = 0; ui < unitSpecs.length; ui++) {
    const u = unitSpecs[ui];
    const y0 = u.y0 * height;
    const y1 = u.y1 * height;
    const yMid = 0.5 * (y0 + y1);
    const zProj = radZ * (1.0 + (u.zFront - 1.0) * (0.5 + 0.65 * overhang));
    const totalW = radX * 2.0 * u.wScale;

    // 3-4 irregular broad interlocked slabs per horizon
    const numSlabs = ui === 4 ? 2 : 3 + (rng.chance(0.5) ? 1 : 0);
    let curX = -totalW * 0.5 + (ui === 4 ? crownOffset : 0);

    for (let si = 0; si < numSlabs; si++) {
      const rem = (totalW * 0.5 + (ui === 4 ? crownOffset : 0)) - curX;
      const slabW = si === numSlabs - 1 ? rem : (totalW / numSlabs) * rng.range(0.78, 1.25);
      const xMid = curX + slabW * 0.5;
      const prowCurve = (1.0 - 0.55 * (xMid / (radX + 1e-4)) ** 2);
      const frontZ = zProj * prowCurve;
      const backZ = -radZ * 0.85;

      const shift = tectonics.evalTectonicShift(xMid, yMid, 0);
      const frame = tectonics.localFrameAt(xMid, yMid, 0);

      const poly = sculptGeologicalParentPoly(
        [xMid + shift[0] * 0.25, yMid + shift[1] * 0.45, 0.5 * (frontZ + backZ)],
        [slabW * 0.60, (y1 - y0) * 0.64, (frontZ - backZ) * 0.56],
        frame,
        rng,
        {
          jointDispersion: 0.12,
          cornerBlunt: 0.82,
          flatBaseY: ui === 0 ? groundY : null,
          extraBevelCuts: 4,
        }
      );

      const parts = recursiveGeologicalFracture(poly, frame, tectonics, rng, {
        maxDepth: 2,
        minSpan: S * 0.065,
        minVolume: (S * 0.05) ** 3,
        bedSplitBias: 1.3,
        openCleftChance: 0.18 * (params.jointAperture ?? 0.5),
        openGap: S * 0.008,
        overlapDepth: S * 0.022, // Strong overlap prevents isolated hanging pillars!
        shearSlip: 0.08,
        pluckChance: ui < 4 ? 0.14 * (params.pluckingAmount ?? 0.6) : 0,
        groundY: ui === 0 ? groundY : null,
      });

      for (let k = 0; k < parts.length; k++) {
        const comp = compilePolyBlock(parts[k], frame, {
          edgeBevel: bevel,
          detailScale: 0.72 + 0.32 * u.comp,
          seedSalt: rng.int(1, 999999),
        });
        if (comp) blocks.push(comp);
      }

      curX += slabW * 0.92;
    }
  }

  // Single broad, continuous vaulted canyon alcove undercut beneath the overhanging caprock
  const alcoveX = rng.signed() * S * 0.08;
  const alcoveY = height * 0.30;
  const alcoveZ = radZ * 0.88;
  const cFrame = tectonics.localFrameAt(alcoveX, alcoveY, alcoveZ);
  const mainAlcove = sculptGeologicalParentPoly(
    [alcoveX, alcoveY, alcoveZ],
    [radX * 0.62, height * 0.20, radZ * 0.58],
    cFrame,
    rng,
    { jointDispersion: 0.14, cornerBlunt: 0.86, extraBevelCuts: 5 }
  );
  const compAlcove = compilePolyBlock(mainAlcove, cFrame, {
    edgeBevel: bevel * 1.6,
    seedSalt: rng.int(1, 999999),
  });
  if (compAlcove) cuts.push(compAlcove);

  addTalusAndFallenBoulders(blocks, tectonics.baseFrame, rng, {
    talusAmount: params.talusAmount ?? 0.66,
    scale: S,
    spanX: radX * 2.0,
    frontZFn: (x) => (1 - 0.6 * (x / (radX + 1e-4)) ** 2) * radZ * 0.78,
    groundY,
    edgeBevel: bevel,
    mode: 'cliff',
  });

  return { blocks, cuts, groundY };
}

/**
 * 8. FROST-SPLIT HERO BOULDER & ERRATIC CLUSTER (`hero-boulder`)
 * AAA multi-lobed glacial erratic boulder cluster (God of War / Horizon / Witcher 3 style):
 * - Assembles the primary erratic from 5 interlocking stepped rock slabs & craggy boulder lobes
 *   so the silhouette has authentic re-entrant rock steps, overhanging ledges & layered ridges
 *   (ZERO smooth single-convex-hull facets and ZERO flat cube tops!)
 * - Sliced cleanly by a deep open frost-wedged master fissure + rotationally calved flank slab
 *   + angular frost-shattered satellite boulders!
 */
function buildHeroBoulder(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0018 + 0.0045 * (params.edgeWear ?? 0.38));

  const bDip = clamp((params.dipAngle ?? 32), 24, 52) * DEG2RAD;
  const bStrike = ((params.strikeAngle ?? 26) * DEG2RAD) + rng.signed() * 0.16;
  const aperture = params.jointAperture ?? 0.56;
  const overhang = params.overhangStrength ?? 0.58;

  // Frost-wedge master fracture plane slicing diagonally through the multi-lobed erratic massif!
  const cleftGap = S * (0.015 + 0.025 * aperture);
  const frostN = perturbNormal(vnorm([0.82, 0.16, -0.55]), rng, 0.08);
  const frostOff = vdot(frostN, [S * 0.02, groundY + S * 0.25, 0]);

  // 5 Interlocking Stepped Glacial Erratic Lobes (creates rich re-entrant shelves & overhanging prow!)
  const lobeSpecs = [
    { x: -0.14, y: 0.28, z:  0.03, rx: 0.30, ry: 0.31, rz: 0.27, prow: true,  crestAng: 0.2 },
    { x: -0.06, y: 0.42, z: -0.04, rx: 0.23, ry: 0.23, rz: 0.22, prow: true,  crestAng: 0.9 },
    { x:  0.14, y: 0.24, z:  0.02, rx: 0.28, ry: 0.26, rz: 0.26, prow: false, crestAng: -0.5 },
    { x:  0.05, y: 0.16, z:  0.17, rx: 0.22, ry: 0.17, rz: 0.19, prow: true,  crestAng: 1.4 },
    { x: -0.22, y: 0.15, z: -0.12, rx: 0.20, ry: 0.16, rz: 0.20, prow: false, crestAng: 2.2 },
  ];

  for (let i = 0; i < lobeSpecs.length; i++) {
    const lb = lobeSpecs[i];
    const localF = buildStrikeDipFrame(bStrike + rng.signed() * 0.14, bDip + rng.signed() * 0.10);
    let poly = sculptGeologicalParentPoly(
      [lb.x * S, groundY + lb.y * S, lb.z * S],
      [lb.rx * S, lb.ry * S, lb.rz * S],
      localF,
      rng,
      {
        jointDispersion: 0.20,
        cornerBlunt: 0.73,
        flatBaseY: lb.y - lb.ry <= 0.04 ? groundY : undefined,
        extraBevelCuts: 7,
      }
    );

    const cAz = bStrike + lb.crestAng;
    const cN1 = vnorm([Math.cos(cAz) * 0.66, 0.75, Math.sin(cAz) * 0.66]);
    const cN2 = vnorm([-Math.cos(cAz + 0.5) * 0.62, 0.78, -Math.sin(cAz + 0.5) * 0.62]);
    const topRef = [lb.x * S, groundY + (lb.y + lb.ry * 0.72) * S, lb.z * S];
    poly = clipPolyByHalfSpace(poly, cN1, vdot(cN1, topRef), 'erraticCrest') || poly;
    poly = clipPolyByHalfSpace(poly, cN2, vdot(cN2, topRef) + lb.rx * 0.22 * S, 'erraticCrest') || poly;

    if (lb.prow) {
      const underN = vnorm([-0.38, -0.58 * (0.6 + 0.5 * overhang), 0.72]);
      poly = clipPolyByHalfSpace(poly, underN, vdot(underN, [lb.x * S, groundY + S * 0.10, (lb.z + lb.rz * 0.72) * S]), 'undercut') || poly;
    }

    const [leftHalf, rightHalf] = splitPolyByPlane(poly, frostN, frostOff, -cleftGap, 'frostCleft');
    if (leftHalf) {
      const gl = clipPolyByHalfSpace(leftHalf, [0, -1, 0], -groundY, 'base') || leftHalf;
      const compL = compilePolyBlock(gl, localF, {
        edgeBevel: bevel,
        smoothUnionR: S * 0.0055,
        detailScale: 1.08,
        seedSalt: rng.int(1, 999999),
      });
      if (compL) blocks.push(compL);
    }
    if (rightHalf) {
      let heaved = transformPoly(
        rightHalf,
        [frostN[0] * S * (0.022 + 0.025 * aperture), -S * 0.014, frostN[2] * S * (0.022 + 0.025 * aperture)],
        [0.35, 0, 0.94],
        0.14 + 0.10 * aperture,
        [S * 0.14, groundY, 0]
      );
      heaved = clipPolyByHalfSpace(heaved, [0, -1, 0], -groundY, 'base') || heaved;
      const compR = compilePolyBlock(heaved, buildStrikeDipFrame(bStrike - 0.18, bDip + 0.14), {
        edgeBevel: bevel,
        smoothUnionR: S * 0.0055,
        detailScale: 1.08,
        seedSalt: rng.int(1, 999999),
      });
      if (compR) blocks.push(compR);
    }
  }

  // Rotationally Calved Flank Slab resting at ~28° against the right shoulder!
  const slabFrame = buildStrikeDipFrame(bStrike - 0.42, 54 * DEG2RAD);
  let flankSlab = sculptGeologicalParentPoly(
    [0.36 * S, groundY + 0.16 * S, 0.08 * S],
    [0.18 * S, 0.095 * S, 0.24 * S],
    slabFrame,
    rng,
    { jointDispersion: 0.18, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 6 }
  );
  flankSlab = clipPolyByHalfSpace(flankSlab, [0, -1, 0], -groundY, 'base') || flankSlab;
  const compSlab = compilePolyBlock(flankSlab, slabFrame, {
    edgeBevel: bevel * 0.9,
    smoothUnionR: S * 0.003,
    detailScale: 1.06,
    seedSalt: rng.int(1, 999999),
  });
  if (compSlab) blocks.push(compSlab);

  const numSats = Math.round(6 + (params.talusAmount ?? 0.36) * 8);
  for (let s = 0; s < numSats; s++) {
    const sa = (s / numSats) * Math.PI * 2 + rng.signed() * 0.30;
    const dist = S * rng.range(0.38, 0.56);
    const rSat = S * rng.range(0.045, 0.105);
    const satF = buildStrikeDipFrame(rng.float() * Math.PI * 2, rng.range(22, 58) * DEG2RAD);
    let satP = sculptGeologicalParentPoly(
      [Math.cos(sa) * dist, groundY + rSat * 0.56, Math.sin(sa) * dist * 0.85],
      [rSat * rng.range(0.95, 1.35), rSat * rng.range(0.62, 0.88), rSat * rng.range(0.85, 1.25)],
      satF,
      rng,
      { jointDispersion: 0.22, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 6 }
    );
    satP = clipPolyByHalfSpace(satP, [0, -1, 0], -groundY, 'base') || satP;
    const compS = compilePolyBlock(satP, satF, {
      edgeBevel: bevel * 0.85,
      detailScale: 0.98,
      isBoulder: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compS) blocks.push(compS);
  }

  return { blocks, cuts, groundY };
}

/**
 * 10. MONUMENT SPIRES & PINNACLES (`desert-spires`)
 * Fisher Towers (The Titan & Kingfisher) / Courthouse Organ / Monument Valley Totem Complex:
 * - Asymmetric flared Cutler/Moenkopi badlands ridge & radiating buttress spurs
 * - Soaring cathedral sandstone fin-walls built from bundled vertical organ-pipe ribs,
 *   staggered flanking spirelets/needles, and pitched jagged dihedral turret crowns
 *   (ZERO stacked marshmallow cubes or flat floating square caps!)
 * - Correlated thin horizontal Cutler/Wingate sandstone bedding shelves wrapping across the ribs
 * - Deep sky-lit vertical joint clefts separating the main Titan tower from flanking needles
 */
function buildDesertSpires(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const frame = tectonics.baseFrame;
  const overhang = params.overhangStrength ?? 0.72;
  const bevel = S * (0.0014 + 0.0026 * (params.edgeWear ?? 0.42));
  const finStrike = (params.strikeAngle ?? 8) * DEG2RAD;

  const ridgeZ = (xFrac) =>
    S * (0.024 * Math.sin(xFrac * 5.2 + 0.4) - 0.016 * Math.cos(xFrac * 3.1));

  // 1. Stepped Flared Badlands Pedestal Ridge + Radiating Transverse Buttress Spurs
  const pedNodes = 9;
  for (let i = 0; i < pedNodes; i++) {
    const u = i / (pedNodes - 1) - 0.5; // -0.5 .. +0.5
    const env = Math.max(0.28, 1.0 - 2.1 * u * u);
    const px = u * 0.90 * S + rng.signed() * S * 0.012;
    const pz = ridgeZ(u);
    const pH = S * (0.09 + 0.13 * env) * rng.range(0.92, 1.08);
    const pRx = S * 0.095 * rng.range(0.92, 1.15);
    const pRz = S * (0.12 + 0.13 * env) * rng.range(0.90, 1.12);

    const pf = buildStrikeDipFrame(finStrike + rng.signed() * 0.14, rng.range(2, 7) * DEG2RAD);
    let pPoly = sculptGeologicalParentPoly(
      [px, groundY + pH * 0.46, pz],
      [pRx, pH * 0.54, pRz],
      pf,
      rng,
      { jointDispersion: 0.14, cornerBlunt: 0.74, flatBaseY: groundY, extraBevelCuts: 6 }
    );
    pPoly = clipPolyByHalfSpace(pPoly, [0, -1, 0], -groundY, 'base') || pPoly;
    const compP = compilePolyBlock(pPoly, pf, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.0085,
      detailScale: 0.95,
      isEolian: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compP) blocks.push(compP);

    // Radiating transverse sandstone buttress spurs jutting out from the pedestal ridge!
    if (i >= 1 && i <= pedNodes - 2 && i % 2 === 1) {
      for (const side of [-1, 1]) {
        const spurLen = pRz * rng.range(0.75, 1.15);
        const spurH = pH * rng.range(0.55, 0.82);
        const sf = buildStrikeDipFrame(finStrike + Math.PI * 0.5 + rng.signed() * 0.18, rng.range(8, 22) * DEG2RAD);
        let spurP = sculptGeologicalParentPoly(
          [px + rng.signed() * S * 0.015, groundY + spurH * 0.44, pz + side * spurLen * 0.72],
          [S * rng.range(0.032, 0.052), spurH * 0.52, spurLen * 0.62],
          sf,
          rng,
          { jointDispersion: 0.16, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 5 }
        );
        const pitchN = vnorm([rng.signed() * 0.15, 0.80, side * 0.58]);
        spurP = clipPolyByHalfSpace(spurP, pitchN, vdot(pitchN, [px, groundY + spurH * 0.82, pz + side * spurLen * 0.6]), 'spurSlope') || spurP;
        spurP = clipPolyByHalfSpace(spurP, [0, -1, 0], -groundY, 'base') || spurP;
        const compSpur = compilePolyBlock(spurP, sf, {
          edgeBevel: bevel,
          smoothUnionR: S * 0.0075,
          detailScale: 0.94,
          isEolian: true,
          seedSalt: rng.int(1, 999999),
        });
        if (compSpur) blocks.push(compSpur);
      }
    }
  }

  // 2. Nine Cathedral Fin-Towers & Soaring Organ-Pipe Pinnacles
  // Each tower consists of a tall blade-fin core + 4 bundled vertical organ-pipe buttress ribs
  // terminating in staggered jagged turret needles + fine correlated sandstone strata shelves!
  const towers = [
    { x: -0.055, zOff:  0.000, h: 0.98, rx: 0.068, rz: 0.098, leanX: -0.010, ribs: 5, turret: 1.06 }, // Central Titan Spire
    { x:  0.095, zOff:  0.012, h: 0.86, rx: 0.056, rz: 0.086, leanX:  0.014, ribs: 4, turret: 1.10 }, // Ancient-Art Needle across sky-slot!
    { x: -0.195, zOff: -0.010, h: 0.78, rx: 0.064, rz: 0.090, leanX: -0.008, ribs: 5, turret: 0.96 }, // Kingfisher Cathedral Buttress
    { x:  0.225, zOff: -0.008, h: 0.68, rx: 0.058, rz: 0.082, leanX:  0.008, ribs: 4, turret: 1.08 }, // Right Organ-Pipe Tower
    { x: -0.320, zOff:  0.008, h: 0.56, rx: 0.056, rz: 0.076, leanX: -0.012, ribs: 4, turret: 0.92 }, // Left Wing Pinnacle
    { x:  0.345, zOff:  0.010, h: 0.48, rx: 0.050, rz: 0.070, leanX:  0.010, ribs: 3, turret: 1.04 }, // Right Outer Sentinel Needle
    { x: -0.415, zOff: -0.006, h: 0.36, rx: 0.046, rz: 0.062, leanX: -0.008, ribs: 3, turret: 0.90 }, // Far-left badlands gendarme
    { x:  0.018, zOff:  0.092, h: 0.52, rx: 0.044, rz: 0.058, leanX:  0.006, ribs: 3, turret: 1.02 }, // Foreground cathedral flying buttress spire!
    { x: -0.130, zOff: -0.082, h: 0.49, rx: 0.044, rz: 0.056, leanX: -0.006, ribs: 3, turret: 0.95 }, // Rear flanking needle
  ];

  // Shared master Cutler/Wingate horizontal sandstone shelf elevations across all spires!
  const ledgeLevels = [0.20, 0.27, 0.34, 0.41, 0.48, 0.55, 0.62, 0.69, 0.76, 0.83, 0.90];

  for (let t = 0; t < towers.length; t++) {
    const tw = towers[t];
    const bx = tw.x * S + rng.signed() * S * 0.006;
    const bz = ridgeZ(tw.x) + tw.zOff * S + rng.signed() * S * 0.006;
    const topY = groundY + tw.h * S * rng.range(0.96, 1.03);
    const towerH = topY - groundY;
    const tf = buildStrikeDipFrame(finStrike + rng.signed() * 0.08, rng.range(1.5, 4.5) * DEG2RAD);

    // 2A. Three-Stage Gothic Tapered Sandstone Spire Core (Wide Fluted Base -> Mid Shaft -> Sharp Pinnacle Needle!)
    const stageSpecs = [
      { y0f: 0.00, y1f: 0.48, radScale: 1.18, leanF: 0.20, peakClip: false },
      { y0f: 0.36, y1f: 0.78, radScale: 0.80, leanF: 0.58, peakClip: false },
      { y0f: 0.66, y1f: 1.00, radScale: 0.52, leanF: 0.95, peakClip: true  },
    ];
    for (let st = 0; st < stageSpecs.length; st++) {
      const ss = stageSpecs[st];
      const sy0 = groundY + towerH * ss.y0f;
      const sy1 = groundY + towerH * ss.y1f;
      const sh = sy1 - sy0;
      const scx = bx + tw.leanX * ss.leanF * S;
      let stPoly = sculptGeologicalParentPoly(
        [scx, sy0 + sh * 0.50, bz],
        [tw.rx * ss.radScale * S, sh * 0.53, tw.rz * ss.radScale * S],
        tf,
        rng,
        {
          jointDispersion: 0.09,
          cornerBlunt: 0.74,
          flatBaseY: st === 0 ? groundY : undefined,
          extraBevelCuts: 6,
        }
      );
      if (st === 0) {
        stPoly = clipPolyByHalfSpace(stPoly, [0, -1, 0], -groundY, 'base') || stPoly;
      }
      if (ss.peakClip) {
        // Four steep converging dihedral facets around the summit -> authentic craggy pinnacle needle!
        const baseAz = finStrike + rng.signed() * 0.5;
        for (let k = 0; k < 4; k++) {
          const az = baseAz + k * Math.PI * 0.5 + rng.signed() * 0.22;
          const pN = vnorm([Math.cos(az) * 0.82, 0.57, Math.sin(az) * 0.82]);
          stPoly = clipPolyByHalfSpace(
            stPoly,
            pN,
            vdot(pN, [scx, topY - S * 0.008, bz]) + tw.rx * 0.14 * S,
            'pinnacleTip'
          ) || stPoly;
        }
      }
      const compSt = compilePolyBlock(stPoly, tf, {
        edgeBevel: bevel * (ss.peakClip ? 0.72 : 0.92),
        smoothUnionR: S * 0.0065,
        detailScale: 0.98,
        isEolian: true,
        seedSalt: rng.int(1, 999999),
      });
      if (compSt) blocks.push(compSt);
    }

    // 2B. Bundled Vertical Organ-Pipe Buttress Ribs & Staggered Flanking Needles!
    // Each rib tapers upward into a sharp secondary spirelet clinging to the main tower (NO bracket-fungus ledges!)
    for (let r = 0; r < tw.ribs + 1; r++) {
      const ang = (r / (tw.ribs + 1)) * Math.PI * 2 + t * 0.73 + rng.signed() * 0.20;
      const ribHFrac = clamp(0.36 + (r / (tw.ribs + 1)) * 0.52 + rng.signed() * 0.06, 0.32, 0.90);
      const ribTopY = groundY + towerH * ribHFrac;
      const ribStartY = groundY + S * 0.04;
      const ribH = ribTopY - ribStartY;
      if (ribH < S * 0.12) continue;

      const radPlace = 1.02 - 0.30 * ribHFrac;
      const offX = Math.cos(ang) * tw.rx * 0.76 * radPlace * S + tw.leanX * ribHFrac * 0.45 * S;
      const offZ = Math.sin(ang) * tw.rz * 0.82 * radPlace * S;
      const ribRx = tw.rx * rng.range(0.34, 0.48) * S;
      const ribRz = tw.rz * rng.range(0.36, 0.52) * S;

      const rf = buildStrikeDipFrame(ang, rng.range(2, 6) * DEG2RAD);
      let ribPoly = sculptGeologicalParentPoly(
        [bx + offX, ribStartY + ribH * 0.48, bz + offZ],
        [ribRx, ribH * 0.51, ribRz],
        rf,
        rng,
        { jointDispersion: 0.08, cornerBlunt: 0.72, extraBevelCuts: 6 }
      );
      // Converging 3-plane Gothic needle tip on every flanking organ-pipe spirelet!
      for (let k = -1; k <= 1; k++) {
        const tipAz = ang + k * 0.95;
        const tipN = vnorm([Math.cos(tipAz) * 0.78, 0.62, Math.sin(tipAz) * 0.78]);
        ribPoly = clipPolyByHalfSpace(
          ribPoly,
          tipN,
          vdot(tipN, [bx + offX * 0.78, ribTopY - S * 0.006, bz + offZ * 0.78]) + ribRx * 0.22,
          'ribNeedle'
        ) || ribPoly;
      }

      const compRib = compilePolyBlock(ribPoly, rf, {
        edgeBevel: bevel * 0.78,
        smoothUnionR: S * 0.0055,
        detailScale: 0.96,
        isEolian: true,
        seedSalt: rng.int(1, 999999),
      });
      if (compRib) blocks.push(compRib);
    }
  }

  // 3. Narrow Vertical Joint Clefts Between Cathedral Spire Groups so Desert Sky Shines Cleanly Through!
  const cleftXs = [-0.128, 0.028, 0.164, -0.262, 0.290];
  for (let i = 0; i < cleftXs.length; i++) {
    const cx = cleftXs[i] * S;
    const cleftCut = sculptGeologicalParentPoly(
      [cx, groundY + 0.56 * S, ridgeZ(cleftXs[i])],
      [S * rng.range(0.011, 0.018), S * 0.36, S * 0.18],
      frame,
      rng,
      { jointDispersion: 0.05, cornerBlunt: 0.74 }
    );
    const compSlot = compilePolyBlock(cleftCut, frame, { edgeBevel: S * 0.0018 });
    if (compSlot) cuts.push(compSlot);
  }

  // 4. Angular Calved Sandstone Slab Talus Around the Badlands Skirt
  const numTalus = Math.round(10 + (params.talusAmount ?? 0.46) * 14);
  for (let i = 0; i < numTalus; i++) {
    const u = rng.range(-0.46, 0.46);
    const side = rng.chance(0.55) ? 1 : -1;
    const bx = u * S;
    const bz = ridgeZ(u) + side * S * rng.range(0.16, 0.34);
    const rB = S * rng.range(0.018, 0.045);
    const bf = buildStrikeDipFrame(rng.float() * Math.PI * 2, rng.range(10, 42) * DEG2RAD);
    let bPoly = sculptGeologicalParentPoly(
      [bx, groundY + rB * 0.48, bz],
      [rB * rng.range(1.0, 1.55), rB * rng.range(0.48, 0.78), rB * rng.range(0.90, 1.35)],
      bf,
      rng,
      { jointDispersion: 0.22, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 5 }
    );
    bPoly = clipPolyByHalfSpace(bPoly, [0, -1, 0], -groundY, 'base') || bPoly;
    const compB = compilePolyBlock(bPoly, bf, {
      edgeBevel: bevel * 0.85,
      detailScale: 0.90,
      isBoulder: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compB) blocks.push(compB);
  }

  return { blocks, cuts, groundY };
}

/**
 * 11. UTAH CANYON WALL & SLICKROCK ALCOVE (`utah-canyon`)
 * Zion Great Arch / Escalante Coyote Gulch / Mesa Verde Cliff Palace canyon amphitheater:
 * - Sweeping crescent horseshoe Navajo sandstone canyon wall built from continuous stepped
 *   sandstone cliff units & tapering cross-bedded slickrock wings (ZERO rectangular toast-wall
 *   and ZERO vertical piano-key columns!)
 * - Deep recessed vaulted blind alcove carved beneath the towering sheer upper cliff face via
 *   stepped exfoliation fracture vaults + horizontal seepage ledges + fallen alcove roof slabs!
 */
function buildUtahCanyon(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const dipRad = clamp((params.dipAngle ?? 10), 3, 22) * 0.55 * DEG2RAD;
  const strikeRad = (params.strikeAngle ?? -14) * DEG2RAD;
  const bedFrame = buildStrikeDipFrame(strikeRad, dipRad);
  const overhang = params.overhangStrength ?? 0.84;
  const aperture = params.jointAperture ?? 0.48;
  const bevel = S * (0.0020 + 0.0030 * (params.edgeWear ?? 0.50));
  const smoothR = S * 0.0095;

  const width = S * 1.18;
  const height = S * 0.74;
  const depth = S * 0.46;
  const baySalt = rng.int(1, 99999);

  function cliffFrontZ(x) {
    const u = x / (width * 0.5);
    const leftHeadland = Math.exp(-((u + 0.52) * (u + 0.52)) / 0.14) * 0.34;
    const rightHeadland = Math.exp(-((u - 0.50) * (u - 0.50)) / 0.14) * 0.30;
    const bayCurve = -Math.exp(-(u * u) / 0.24) * 0.14;
    const wingSweep = -0.34 * Math.pow(Math.abs(u), 2.4);
    const undul = scalarField3D(u * 2.8, 0.5, 0.7, baySalt) * 0.06;
    return (leftHeadland + rightHeadland + bayCurve + wingSweep + undul) * depth;
  }

  function cliffBackZ(x) {
    const u = x / (width * 0.5);
    return (-0.52 + 0.28 * Math.pow(Math.abs(u), 2.2)) * depth;
  }

  function rimCrestAt(x) {
    const u = x / (width * 0.5);
    const wingEnv = clamp(1.08 - 0.88 * Math.pow(Math.abs(u), 2.45), 0.14, 1.0);
    const rimSwell = 0.96 + 0.09 * Math.cos(u * 3.1 + 0.3) + 0.05 * scalarField3D(u * 3.5, 1.4, 0.6, baySalt + 31);
    return height * wingEnv * rimSwell;
  }

  const wallUnits = [
    { y0: 0.00, y1: 0.18, proj:  0.18, smooth: 1.2 },
    { y0: 0.14, y1: 0.36, proj:  0.04, smooth: 1.0 },
    { y0: 0.32, y1: 0.56, proj:  0.06, smooth: 1.0 },
    { y0: 0.52, y1: 0.74, proj:  0.14, smooth: 1.0 },
    { y0: 0.70, y1: 0.88, proj:  0.09, smooth: 1.1 },
    { y0: 0.84, y1: 1.02, proj: -0.04, smooth: 1.3 },
  ];

  const nSegs = 16;
  const xSpan = width * 0.98;
  const dxSeg = xSpan / nSegs;

  for (let uIdx = 0; uIdx < wallUnits.length; uIdx++) {
    const wu = wallUnits[uIdx];
    const refY0 = groundY + wu.y0 * height;
    const refY1 = groundY + wu.y1 * height;
    const unitH = refY1 - refY0;

    for (let i = 0; i < nSegs; i++) {
      const cx = -xSpan * 0.5 + (i + 0.5) * dxSeg;
      const localCrest = rimCrestAt(cx);
      if (refY0 > localCrest - unitH * 0.25) continue;

      const actualTop = Math.min(localCrest, refY1);
      const browWave = scalarField3D((cx / width) * 4.2, uIdx * 1.7, 0.5, baySalt + uIdx * 47) * depth * 0.045;
      const fz0 = cliffFrontZ(cx - dxSeg * 0.5) + wu.proj * depth * (0.65 + 0.45 * overhang) + browWave;
      const fz1 = cliffFrontZ(cx + dxSeg * 0.5) + wu.proj * depth * (0.65 + 0.45 * overhang) + browWave;
      const fzMid = 0.5 * (fz0 + fz1);
      const bzMid = Math.min(fzMid - S * 0.10, cliffBackZ(cx));

      const halfW = dxSeg * 0.74;
      let poly = createBoxPoly(
        cx - halfW * 1.15,
        uIdx === 0 ? groundY : refY0 - unitH * 0.08,
        bzMid - depth * 0.15,
        cx + halfW * 1.15,
        actualTop + unitH * 0.12,
        fzMid + depth * 0.20,
        'canyonUnit'
      );

      const topSlope = actualTop < refY1 - 0.01 ? vnorm([Math.sign(cx) * 0.42, 0.88, 0.18]) : bedFrame.normal;
      const botN = uIdx === 0 ? [0, -1, 0] : [-bedFrame.normal[0], -bedFrame.normal[1], -bedFrame.normal[2]];
      poly = clipPolyByHalfSpace(poly, topSlope, vdot(topSlope, [cx, actualTop, 0]), 'unitTop') || poly;
      poly = clipPolyByHalfSpace(poly, botN, vdot(botN, [cx, uIdx === 0 ? groundY : refY0, 0]), 'unitBot') || poly;
      if (!poly) continue;

      const midY = 0.5 * (refY0 + actualTop);
      const dzdx = clamp((fz1 - fz0) / dxSeg, -1.1, 1.1);
      const batter = uIdx === 0 ? 0.34 : (uIdx === 3 ? -0.10 : (uIdx >= 4 ? 0.22 : 0.03));
      const frontN = vnorm([-dzdx, batter, 1.0]);
      poly = clipPolyByHalfSpace(poly, frontN, vdot(frontN, [cx, midY, fzMid]), 'canyonFace') || poly;

      const jL = vnorm([-0.58, 0.06, 0.81]);
      const jR = vnorm([ 0.58, 0.06, 0.81]);
      poly = clipPolyByHalfSpace(poly, jL, vdot(jL, [cx - halfW * 0.88, midY, fzMid - dxSeg * 0.08]), 'jointL') || poly;
      poly = clipPolyByHalfSpace(poly, jR, vdot(jR, [cx + halfW * 0.88, midY, fzMid - dxSeg * 0.08]), 'jointR') || poly;

      const backN = vnorm([0, 0.22, -1.0]);
      poly = clipPolyByHalfSpace(poly, backN, vdot(backN, [cx, midY, bzMid]), 'canyonBack') || poly;
      poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

      const comp = compilePolyBlock(poly, bedFrame, {
        edgeBevel: bevel,
        smoothUnionR: smoothR * wu.smooth,
        detailScale: 0.98,
        isEolian: true,
        seedSalt: (baySalt + uIdx * 101 + i * 23) & 0x7fffffff,
      });
      if (comp) blocks.push(comp);
    }
  }

  // Stepped Multi-Ring Exfoliation Blind Alcove Beneath the Towering Upper Cliff Brow!
  const alcX = rng.signed() * width * 0.03;
  const alcBaseZ = cliffFrontZ(alcX);
  const vaultRings = [
    { x:  0.00, y: 0.25, z:  0.14, rx: 0.30, ry: 0.26, rz: 0.15 },
    { x: -0.01, y: 0.22, z:  0.04, rx: 0.26, ry: 0.22, rz: 0.19 },
    { x:  0.01, y: 0.18, z: -0.06, rx: 0.21, ry: 0.17, rz: 0.20 },
    { x: -0.11, y: 0.15, z: -0.02, rx: 0.14, ry: 0.12, rz: 0.17 },
  ];

  for (let v = 0; v < vaultRings.length; v++) {
    const vr = vaultRings[v];
    const vx = alcX + vr.x * width;
    const vy = groundY + vr.y * height;
    const vz = alcBaseZ + vr.z * depth;
    const vFrame = buildStrikeDipFrame(strikeRad + rng.signed() * 0.08, rng.range(4, 12) * DEG2RAD);

    let vPoly = createBoxPoly(
      vx - vr.rx * 1.3 * width, groundY + 0.055 * height, vz - vr.rz * 1.3 * depth,
      vx + vr.rx * 1.3 * width, vy + vr.ry * 1.25 * height, vz + vr.rz * 1.6 * depth,
      'alcoveVault'
    );
    for (let aIdx = 0; aIdx < 9; aIdx++) {
      const theta = -Math.PI * 0.48 + (aIdx / 8) * Math.PI * 0.96 + rng.signed() * 0.06;
      const nx = Math.sin(theta) / (vr.rx * width);
      const ny = Math.cos(theta) / (vr.ry * height * (0.82 + 0.25 * overhang));
      const nz = -0.22 / (vr.rz * depth);
      const vn = vnorm([nx, ny, nz]);
      const px = vx + Math.sin(theta) * vr.rx * width;
      const py = vy + Math.cos(theta) * vr.ry * height * (0.82 + 0.25 * overhang);
      vPoly = clipPolyByHalfSpace(vPoly, vn, vdot(vn, [px, py, vz]), 'exfolArch') || vPoly;
    }
    const backAlcN = perturbNormal(vnorm([rng.signed() * 0.14, -0.18, -0.97]), rng, 0.06);
    vPoly = clipPolyByHalfSpace(vPoly, backAlcN, vdot(backAlcN, [vx, vy, vz - vr.rz * depth]), 'alcoveBack') || vPoly;

    const compV = compilePolyBlock(vPoly, vFrame, { edgeBevel: S * 0.003 });
    if (compV) cuts.push(compV);
  }

  const grottoLedges = [
    { x: -0.10, y: 0.042, z: -0.06, rx: 0.13, ry: 0.045, rz: 0.10 },
    { x:  0.09, y: 0.038, z: -0.05, rx: 0.14, ry: 0.040, rz: 0.11 },
    { x: -0.01, y: 0.078, z: -0.14, rx: 0.16, ry: 0.036, rz: 0.08 },
  ];
  for (const gl of grottoLedges) {
    let lPoly = sculptGeologicalParentPoly(
      [alcX + gl.x * width, groundY + gl.y * height, alcBaseZ + gl.z * depth],
      [gl.rx * width, gl.ry * height, gl.rz * depth],
      bedFrame,
      rng,
      { jointDispersion: 0.12, cornerBlunt: 0.78, flatBaseY: groundY, extraBevelCuts: 5 }
    );
    lPoly = clipPolyByHalfSpace(lPoly, [0, -1, 0], -groundY, 'base') || lPoly;
    const compL = compilePolyBlock(lPoly, bedFrame, {
      edgeBevel: bevel,
      smoothUnionR: smoothR * 0.7,
      detailScale: 0.92,
      isEolian: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compL) blocks.push(compL);
  }

  for (const jxFrac of [-0.36, 0.35]) {
    const jx = jxFrac * width;
    const slotW = S * (0.010 + 0.012 * aperture);
    const chimney = sculptGeologicalParentPoly(
      [jx, groundY + height * 0.56, cliffFrontZ(jx) + depth * 0.08],
      [slotW, height * 0.32, depth * 0.20],
      bedFrame,
      rng,
      { jointDispersion: 0.05, cornerBlunt: 0.78 }
    );
    const compChim = compilePolyBlock(chimney, bedFrame, { edgeBevel: S * 0.002 });
    if (compChim) cuts.push(compChim);
  }

  addTalusAndFallenBoulders(blocks, bedFrame, rng, {
    talusAmount: (params.talusAmount ?? 0.48) * 0.90,
    scale: S * 0.88,
    spanX: width * 0.86,
    frontZFn: cliffFrontZ,
    groundY,
    edgeBevel: bevel * 0.85,
    mode: 'cliff',
  });

  return { blocks, cuts, groundY };
}

export function buildMacroFormation(params, tectonics, rng) {
  if (Array.isArray(params.customArchCurves) && params.customArchCurves.length > 0) {
    return buildCustomUserSplineArch(params, tectonics, rng, addTalusAndFallenBoulders);
  }
  switch (params.archetype) {
    case "arch-encampment":
      return buildArchEncampment(params, tectonics, rng, addTalusAndFallenBoulders);
    case "desert-arch":
      return buildDesertArch(params, tectonics, rng, addTalusAndFallenBoulders);
    case "double-arch":
      return buildDoubleArch(params, tectonics, rng, addTalusAndFallenBoulders);
    case "sea-arch":
      return buildSeaArch(params, tectonics, rng, recursiveGeologicalFracture, addTalusAndFallenBoulders);
    case "sedimentary-cliff":
      return buildSedimentaryCliff(params, tectonics, rng, recursiveGeologicalFracture, addTalusAndFallenBoulders);
    case "slot-canyon":
      return buildSlotCanyon(params, tectonics, rng);
    case "hoodoo-columns":
      return buildHoodooColumns(params, tectonics, rng, addTalusAndFallenBoulders);
    case "balanced-rock":
      return buildBalancedRock(params, tectonics, rng, recursiveGeologicalFracture, addTalusAndFallenBoulders);
    case "limestone-karst":
      return buildLimestoneKarst(params, tectonics, rng, addTalusAndFallenBoulders);
    case "exfoliation-dome":
      return buildExfoliationDome(params, tectonics, rng, addTalusAndFallenBoulders);
    case "desert-spires":
      return buildDesertSpires(params, tectonics, rng);
    case "utah-canyon":
      return buildUtahCanyon(params, tectonics, rng);
    case "alpine-crag":
      return buildAlpineCrag(params, tectonics, rng);
    case "basalt-columns":
      return buildBasaltColumns(params, tectonics, rng);
    case "granite-tor":
      return buildGraniteTor(params, tectonics, rng);
    case "metamorphic-outcrop":
      return buildMetamorphicOutcrop(params, tectonics, rng);
    case "sandstone-butte":
      return buildSandstoneButte(params, tectonics, rng);
    case "hero-boulder":
      return buildHeroBoulder(params, tectonics, rng);
    case "cracked-monolith":
      return buildCrackedMonolith(params, tectonics, rng);
    case "grand-canyon-temple":
      return buildGrandCanyonTemple(params, tectonics, rng, addTalusAndFallenBoulders);
    case "studlagil-colonnade":
      return buildStudlagilColonnade(params, tectonics, rng);
    case "icelandic-tuya-crag":
      return buildIcelandicTuyaCrag(params, tectonics, rng);
    case "saharan-yardang-fin":
      return buildSaharanYardangFin(params, tectonics, rng);
    case "calved-cliff-boulders":
      return buildCalvedCliffBoulders(params, tectonics, rng);
    case "cliff-wall":
    default:
      return buildCliffWall(params, tectonics, rng);
  }
}

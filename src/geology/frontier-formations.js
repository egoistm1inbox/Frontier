/**
 * Additive 3D Geological Formation Builders for Canyon, Icelandic, Aeolian Yardang,
 * and Calved Cliff-Boulder Outcrops.
 *
 * Strictly additive: leaves all 19 baseline non-crack presets untouched.
 */

import {
  DEG2RAD,
  buildStrikeDipFrame,
  vnorm,
  vdot,
  clamp,
} from '../core/vec3.js';
import {
  clipPolyByHalfSpace,
  splitPolyByPlane,
  transformPoly,
  sculptGeologicalParentPoly,
  compilePolyBlock,
} from './polyhedron.js';

/**
 * 1. Grand Canyon Cliff-Bench Temple (`grand-canyon-temple`):
 *    Alternating cliff-forming hard limestone/sandstone units (Redwall, Coconino, Kaibab)
 *    and recessed slope-forming shales (Bright Angel, Supai, Hermit) with talus aprons.
 */
export function buildGrandCanyonTemple(params, tectonics, rng, addTalusAndFallenBoulders) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0014 + 0.0022 * (params.edgeWear ?? 0.26));

  const strikeRad = (params.strikeAngle ?? 6) * DEG2RAD;
  const dipRad = clamp((params.dipAngle ?? 4) * 0.35, 0, 14) * DEG2RAD;
  const frame = buildStrikeDipFrame(strikeRad, dipRad);

  // 5-tier Grand Canyon cliff-slope stratigraphic temple staircase
  const tiers = [
    { y0: 0.00, y1: 0.16, rx: 0.50, rz: 0.38, hard: 0.42, nSeg: 4 }, // Bright Angel / lower Supai apron
    { y0: 0.14, y1: 0.34, rx: 0.42, rz: 0.31, hard: 0.90, nSeg: 4 }, // Redwall vertical cliff
    { y0: 0.32, y1: 0.48, rx: 0.33, rz: 0.24, hard: 0.48, nSeg: 3 }, // Hermit recessed bench
    { y0: 0.46, y1: 0.65, rx: 0.26, rz: 0.18, hard: 0.92, nSeg: 3 }, // Coconino sheer sandstone cliff
    { y0: 0.63, y1: 0.76, rx: 0.19, rz: 0.13, hard: 0.88, nSeg: 2 }, // Kaibab caprock turret
  ];

  for (let t = 0; t < tiers.length; t++) {
    const tr = tiers[t];
    const yc = groundY + 0.5 * (tr.y0 + tr.y1) * S;
    const ry = 0.5 * (tr.y1 - tr.y0) * S * 1.12;

    for (let s = 0; s < tr.nSeg; s++) {
      const frac = tr.nSeg > 1 ? (s / (tr.nSeg - 1) - 0.5) : 0;
      const cx = frac * tr.rx * S * 0.92 + rng.signed() * S * 0.02;
      const cz = Math.sin(frac * 2.4 + t * 0.7) * S * 0.035 + rng.signed() * S * 0.018;
      const subRx = (tr.rx * S * (tr.nSeg > 1 ? 0.56 : 0.92)) * rng.range(0.90, 1.12);
      const subRz = tr.rz * S * rng.range(0.88, 1.12);

      let poly = sculptGeologicalParentPoly(
        [cx, yc, cz],
        [subRx, Math.max(ry, S * 0.06), subRz],
        frame,
        rng,
        {
          jointDispersion: tr.hard > 0.75 ? 0.11 : 0.22,
          cornerBlunt: tr.hard > 0.75 ? 0.84 : 0.68,
          flatBaseY: t === 0 ? groundY : null,
          extraBevelCuts: 6,
        }
      );
      if (!poly) continue;
      if (t === 0) poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

      const comp = compilePolyBlock(poly, frame, {
        edgeBevel: bevel * (tr.hard > 0.75 ? 0.8 : 1.25),
        smoothUnionR: tr.hard < 0.55 ? S * 0.016 : S * 0.004,
        detailScale: 1.0,
        hardness: tr.hard,
        isSedimentary: true,
        seedSalt: rng.int(1, 999999),
      });
      if (comp) blocks.push(comp);
    }
  }

  if (addTalusAndFallenBoulders) {
    addTalusAndFallenBoulders(blocks, frame, rng, {
      scale: S,
      groundY,
      talusAmount: Math.max(0.42, params.talusAmount ?? 0.50),
      bevel,
      footprintX: S * 0.52,
      footprintZ: S * 0.40,
    });
  }

  return { blocks, cuts, groundY };
}

/**
 * 2. Stuðlagil Icelandic Columnar Basalt Gorge Wall (`studlagil-colonnade`):
 *    Stepped hexagonal basalt colonnade tiers with overhanging entablature brow
 *    and plunged riverside column steps.
 */
export function buildStudlagilColonnade(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0009 + 0.0014 * (params.edgeWear ?? 0.16));
  const overhang = params.overhangStrength ?? 0.78;
  const frame = buildStrikeDipFrame((params.strikeAngle ?? 4) * DEG2RAD, (params.dipAngle ?? 6) * DEG2RAD);

  // Back massive entablature cliff + overhanging upper basalt brow
  for (let seg = -2; seg <= 2; seg++) {
    const x = seg * S * 0.18 + rng.signed() * S * 0.015;
    const zBack = -S * 0.14 + Math.abs(seg) * S * 0.025;
    let upper = sculptGeologicalParentPoly(
      [x, groundY + S * 0.52, zBack + S * 0.03 * overhang],
      [S * 0.13, S * 0.22, S * 0.15],
      frame,
      rng,
      { jointDispersion: 0.14, cornerBlunt: 0.80, extraBevelCuts: 6 }
    );
    if (upper) {
      const compU = compilePolyBlock(upper, frame, {
        edgeBevel: bevel * 1.15,
        smoothUnionR: S * 0.006,
        detailScale: 1.05,
        seedSalt: rng.int(1, 999999),
      });
      if (compU) blocks.push(compU);
    }
  }

  // Tightly packed hexagonal prismatic basalt columns stepping down toward the river front
  const colRadius = S * 0.044;
  const dxHex = colRadius * 1.82;
  const dzHex = colRadius * 1.58;
  for (let row = 0; row < 5; row++) {
    const colsInRow = 9 - Math.floor(row * 0.5);
    for (let col = 0; col < colsInRow; col++) {
      const cx = (col - (colsInRow - 1) * 0.5) * dxHex + (row % 2 ? dxHex * 0.5 : 0);
      const cz = -S * 0.16 + row * dzHex + Math.sin(cx / (S * 0.22)) * S * 0.03;
      const tierFactor = 1.0 - row * 0.165;
      const colTop = S * clamp(tierFactor * rng.range(0.76, 1.04), 0.11, 0.62);
      if (row === 4 && rng.chance(0.28)) continue;

      // Exact 6-sided hexagonal prism clipped cleanly at top chisel joint & base
      let hexPoly = sculptGeologicalParentPoly(
        [cx, groundY + colTop * 0.5, cz],
        [colRadius * 1.06, colTop * 0.52, colRadius * 1.06],
        frame,
        rng,
        { jointDispersion: 0.04, cornerBlunt: 0.92, flatBaseY: groundY, extraBevelCuts: 2 }
      );
      if (!hexPoly) continue;
      const az0 = 0.12 + rng.signed() * 0.03;
      for (let k = 0; k < 6; k++) {
        const a = az0 + (k * Math.PI) / 3;
        const hn = [Math.cos(a), rng.signed() * 0.025, Math.sin(a)];
        hexPoly = clipPolyByHalfSpace(hexPoly, hn, cx * hn[0] + cz * hn[2] + colRadius * 0.94, 'hex') || hexPoly;
      }
      const topN = vnorm([rng.signed() * 0.14, 1.0, rng.signed() * 0.14]);
      hexPoly = clipPolyByHalfSpace(hexPoly, topN, cx * topN[0] + (groundY + colTop) * topN[1] + cz * topN[2], 'cap') || hexPoly;
      hexPoly = clipPolyByHalfSpace(hexPoly, [0, -1, 0], -groundY, 'base') || hexPoly;

      const comp = compilePolyBlock(hexPoly, frame, {
        edgeBevel: bevel * 0.72,
        detailScale: 0.82,
        seedSalt: rng.int(1, 999999),
      });
      if (comp) blocks.push(comp);
    }
  }

  return { blocks, cuts, groundY };
}

/**
 * 3. Icelandic Subglacial Palagonite Tuya Crag (`icelandic-tuya-crag`):
 *    Steep hyaloclastite/palagonite ridge intruded by a resistant feeder-dike spine
 *    and flanked by frost-riven scree blocks.
 */
export function buildIcelandicTuyaCrag(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0014 + 0.0020 * (params.edgeWear ?? 0.30));
  const strikeRad = (params.strikeAngle ?? 22) * DEG2RAD;
  const dipRad = clamp(params.dipAngle ?? 42, 18, 68) * DEG2RAD;
  const frame = buildStrikeDipFrame(strikeRad, dipRad);

  const cragMasses = [
    { x:  0.00, y: 0.36, z:  0.00, rx: 0.26, ry: 0.42, rz: 0.22, dike: true },
    { x: -0.19, y: 0.26, z:  0.05, rx: 0.22, ry: 0.30, rz: 0.19, dike: false },
    { x:  0.20, y: 0.24, z: -0.04, rx: 0.21, ry: 0.28, rz: 0.18, dike: false },
    { x:  0.03, y: 0.18, z:  0.17, rx: 0.20, ry: 0.20, rz: 0.16, dike: false },
  ];

  for (const cm of cragMasses) {
    let poly = sculptGeologicalParentPoly(
      [cm.x * S, groundY + cm.y * S, cm.z * S],
      [cm.rx * S, cm.ry * S, cm.rz * S],
      frame,
      rng,
      { jointDispersion: 0.22, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 7 }
    );
    if (!poly) continue;
    poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;
    const comp = compilePolyBlock(poly, frame, {
      edgeBevel: bevel * (cm.dike ? 0.75 : 1.15),
      smoothUnionR: cm.dike ? S * 0.004 : S * 0.012,
      detailScale: cm.dike ? 1.12 : 0.96,
      seedSalt: rng.int(1, 999999),
    });
    if (comp) blocks.push(comp);
  }

  // Frost-riven basaltic spall boulders settled around crag skirt
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng.signed() * 0.22;
    const rad = S * rng.range(0.24, 0.40);
    const rB = S * rng.range(0.042, 0.072);
    const bf = buildStrikeDipFrame(a, rng.range(18, 56) * DEG2RAD);
    let bPoly = sculptGeologicalParentPoly(
      [Math.cos(a) * rad, groundY + rB * 0.48, Math.sin(a) * rad * 0.85],
      [rB * 1.25, rB * 0.65, rB * 0.95],
      bf,
      rng,
      { jointDispersion: 0.24, cornerBlunt: 0.68, flatBaseY: groundY, extraBevelCuts: 5 }
    );
    if (!bPoly) continue;
    bPoly = clipPolyByHalfSpace(bPoly, [0, -1, 0], -groundY, 'base') || bPoly;
    const compB = compilePolyBlock(bPoly, bf, {
      edgeBevel: bevel * 0.85,
      detailScale: 0.95,
      isBoulder: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compB) blocks.push(compB);
  }

  return { blocks, cuts, groundY };
}

/**
 * 4. Saharan Wind-Carved Yardang Fin (`saharan-yardang-fin`):
 *    Aerodynamic desert sandstone prow with sandblasted windward basal undercut
 *    and streamlined leeward ridge tail.
 */
export function buildSaharanYardangFin(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0018 + 0.0028 * (params.edgeWear ?? 0.46));
  const overhang = params.overhangStrength ?? 0.82;
  const frame = buildStrikeDipFrame((params.strikeAngle ?? -8) * DEG2RAD, (params.dipAngle ?? 7) * DEG2RAD);

  // Streamlined yardang spine segments tapering from tall steep windward prow (+Z) to low leeward tail (-Z)
  const spineSegs = [
    { z:  0.22, y: 0.30, rx: 0.16, ry: 0.34, rz: 0.17, prow: true },
    { z:  0.06, y: 0.27, rx: 0.18, ry: 0.31, rz: 0.19, prow: false },
    { z: -0.11, y: 0.21, rx: 0.15, ry: 0.24, rz: 0.18, prow: false },
    { z: -0.26, y: 0.13, rx: 0.11, ry: 0.15, rz: 0.16, prow: false },
  ];

  for (const sg of spineSegs) {
    let poly = sculptGeologicalParentPoly(
      [rng.signed() * S * 0.015, groundY + sg.y * S, sg.z * S],
      [sg.rx * S, sg.ry * S, sg.rz * S],
      frame,
      rng,
      { jointDispersion: 0.15, cornerBlunt: 0.78, flatBaseY: groundY, extraBevelCuts: 6 }
    );
    if (!poly) continue;

    // Saltation abrasion zone (0..1.5m above desert floor): undercuts lower flanks into a mushroom/yardang waist!
    if (sg.prow || sg.z > -0.05) {
      const underL = vnorm([-0.88, -0.34 * (0.5 + 0.6 * overhang), 0.18]);
      const underR = vnorm([ 0.88, -0.34 * (0.5 + 0.6 * overhang), 0.18]);
      poly = clipPolyByHalfSpace(poly, underL, sg.rx * 0.82 * S, 'aeolianUnderL') || poly;
      poly = clipPolyByHalfSpace(poly, underR, sg.rx * 0.82 * S, 'aeolianUnderR') || poly;
    }
    poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

    const comp = compilePolyBlock(poly, frame, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.014,
      detailScale: 1.0,
      isEolian: true,
      seedSalt: rng.int(1, 999999),
    });
    if (comp) blocks.push(comp);
  }

  // Parallel flanking miniature yardang whaleback ridge
  let flank = sculptGeologicalParentPoly(
    [S * 0.28, groundY + S * 0.11, S * 0.04],
    [S * 0.09, S * 0.13, S * 0.22],
    frame,
    rng,
    { jointDispersion: 0.16, cornerBlunt: 0.76, flatBaseY: groundY, extraBevelCuts: 5 }
  );
  if (flank) {
    flank = clipPolyByHalfSpace(flank, [0, -1, 0], -groundY, 'base') || flank;
    const compF = compilePolyBlock(flank, frame, {
      edgeBevel: bevel * 1.1,
      smoothUnionR: S * 0.012,
      detailScale: 0.92,
      isEolian: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compF) blocks.push(compF);
  }

  return { blocks, cuts, groundY };
}

/**
 * 5. Calved Escarpment Outcrop & Fallen Megaboulders (`calved-cliff-boulders`):
 *    Fractured parent outcrop nose from which large angular blocks have detached,
 *    tumbled downslope, and settled naturally across the toe apron.
 */
export function buildCalvedCliffBoulders(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];
  const bevel = S * (0.0012 + 0.0020 * (params.edgeWear ?? 0.26));
  const strikeRad = (params.strikeAngle ?? 14) * DEG2RAD;
  const dipRad = clamp(params.dipAngle ?? 26, 10, 54) * DEG2RAD;
  const frame = buildStrikeDipFrame(strikeRad, dipRad);

  // Rear fractured parent outcrop nose with fresh detachment scar
  let parent = sculptGeologicalParentPoly(
    [-S * 0.10, groundY + S * 0.30, -S * 0.12],
    [S * 0.28, S * 0.34, S * 0.24],
    frame,
    rng,
    { jointDispersion: 0.20, cornerBlunt: 0.76, flatBaseY: groundY, extraBevelCuts: 7 }
  );
  if (parent) {
    const scarN = vnorm([0.42, 0.24, 0.87]);
    const [rearMass, detachedSlab] = splitPolyByPlane(parent, scarN, -S * 0.02, S * 0.022, 'calveScar');
    if (rearMass) {
      const gp = clipPolyByHalfSpace(rearMass, [0, -1, 0], -groundY, 'base') || rearMass;
      const compP = compilePolyBlock(gp, frame, {
        edgeBevel: bevel,
        smoothUnionR: S * 0.005,
        detailScale: 1.05,
        seedSalt: rng.int(1, 999999),
      });
      if (compP) blocks.push(compP);
    }
    if (detachedSlab) {
      // Slide & tilt the freshly calved block down to rest against the base of the scar!
      let fallen = transformPoly(
        detachedSlab,
        [S * 0.12, -S * 0.14, S * 0.18],
        [1, 0, -0.4],
        0.42,
        [0, groundY + S * 0.12, 0]
      );
      fallen = clipPolyByHalfSpace(fallen, [0, -1, 0], -groundY, 'base') || fallen;
      const compD = compilePolyBlock(fallen, frame, {
        edgeBevel: bevel * 0.85,
        detailScale: 1.04,
        isBoulder: true,
        seedSalt: rng.int(1, 999999),
      });
      if (compD) blocks.push(compD);
    }
  }

  // Gravity-settled megaboulders & tabular spall blocks fanned downslope in front (+X/+Z)
  const boulderSpecs = [
    { x:  0.18, z:  0.16, rx: 0.14, ry: 0.11, rz: 0.12, tilt: 28 },
    { x: -0.08, z:  0.22, rx: 0.11, ry: 0.085, rz: 0.10, tilt: 36 },
    { x:  0.29, z: -0.02, rx: 0.10, ry: 0.080, rz: 0.09, tilt: 22 },
    { x:  0.06, z:  0.31, rx: 0.085, ry: 0.062, rz: 0.08, tilt: 41 },
    { x: -0.24, z:  0.14, rx: 0.090, ry: 0.070, rz: 0.085, tilt: 32 },
    { x:  0.24, z:  0.29, rx: 0.072, ry: 0.052, rz: 0.068, tilt: 19 },
  ];
  for (const bs of boulderSpecs) {
    const bf = buildStrikeDipFrame(rng.float() * Math.PI * 2, bs.tilt * DEG2RAD);
    let bPoly = sculptGeologicalParentPoly(
      [bs.x * S, groundY + bs.ry * S * 0.72, bs.z * S],
      [bs.rx * S, bs.ry * S, bs.rz * S],
      bf,
      rng,
      { jointDispersion: 0.22, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 6 }
    );
    if (!bPoly) continue;
    bPoly = clipPolyByHalfSpace(bPoly, [0, -1, 0], -groundY, 'base') || bPoly;
    const compB = compilePolyBlock(bPoly, bf, {
      edgeBevel: bevel * 0.90,
      detailScale: 1.0,
      isBoulder: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compB) blocks.push(compB);
  }

  return { blocks, cuts, groundY };
}

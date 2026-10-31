/**
 * Detailed Stratigraphic, Desert Canyon, Badlands Hoodoo, Balanced Rock,
 * Dissolution Karst & Granite Exfoliation Dome Builders.
 */

import {
  DEG2RAD,
  buildStrikeDipFrame,
  perturbNormal,
  vnorm,
  vdot,
  clamp,
} from '../core/vec3.js';
import { scalarField3D } from '../core/spatial-noise.js';
import {
  createBoxPoly,
  clipPolyByHalfSpace,
  sculptGeologicalParentPoly,
  compilePolyBlock,
} from './polyhedron.js';
import { compileCurvedArchRib } from './arch-curves.js';

/**
 * STRATIFIED SEDIMENTARY CLIFF & FORESHORE HEADLAND (`sedimentary-cliff`)
 * Modeled directly after coastal/canyon stratified headland cliffs (`images (1).jpg`):
 * - Broad, gently sloping, layered & iron-stained bedrock foreshore platform at the base
 *   with a crisp dark wave-undercut basal notch (ZERO smooth melted sand-cones hiding the cliff!)
 * - Asymmetric coastal headland silhouette: high craggy stair-stepped bluff on the left/center
 *   stepping down into a long, bold, flat-topped seaward bedrock ledge/spit jutting out to the right!
 * - Crisp vertically-jointed blocky lower & middle strata (rust-ochre lower beds, pale buff middle-lower
 *   beds, finely laminated purplish-maroon siltstone/shale middle-upper beds) with sharp vertical
 *   joint seams & plucked rectangular block recesses
 * - Ragged, boulder-strewn upper terraces crowned with dozens of angular weathered outcrop boulders!
 */
export function buildSedimentaryCliff(params, tectonics, rng, recursiveFractureFn, addTalusFn) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const width = S * 1.24;
  const height = S * 0.66;
  const depth = S * 0.48;

  const dipRad = clamp((params.dipAngle ?? 5), 0, 18) * 0.38 * DEG2RAD;
  const strikeRad = (params.strikeAngle ?? -8) * DEG2RAD;
  const bedFrame = buildStrikeDipFrame(strikeRad, dipRad);
  const dipSlopeX = -bedFrame.normal[0] / Math.max(0.25, bedFrame.normal[1]);

  const overhang = params.overhangStrength ?? 0.82;
  const pluck = params.pluckingAmount ?? 0.58;
  const aperture = params.jointAperture ?? 0.42;
  const bevel = S * (0.0009 + 0.0016 * (params.edgeWear ?? 0.26)); // Crisp blocky joint arrises!
  const planSalt = rng.int(1, 99999);

  // Asymmetric coastal headland cliff planform: bold left-center cliff face + jutting right seaward spit!
  function cliffFrontZ(x) {
    const u = x / (width * 0.5); // -1 .. +1
    const mainHeadland = Math.exp(-((u + 0.28) * (u + 0.28)) / 0.22) * 0.22;
    const rightSpitProj = Math.exp(-((u - 0.52) * (u - 0.52)) / 0.18) * 0.28;
    const midBight = -Math.exp(-((u - 0.12) * (u - 0.12)) / 0.09) * 0.14;
    const endTrim = -0.26 * Math.pow(Math.abs(u), 3.0);
    const jag = scalarField3D(u * 5.2, 0.5, 0.8, planSalt) * 0.055;
    return (mainHeadland + rightSpitProj + midBight + endTrim + jag) * depth;
  }

  function cliffBackZ(x) {
    const u = x / (width * 0.5);
    // Right seaward spit narrows into a true projecting coastal promontory fin!
    const spitNarrow = u > 0.12 ? 0.36 * Math.pow((u - 0.12) / 0.88, 1.35) : 0.18 * Math.pow(-u, 2.4);
    const backJag = scalarField3D(u * 3.0, 1.7, 0.4, planSalt + 37) * 0.06;
    return (-0.52 + spitNarrow + backJag) * depth;
  }

  // Asymmetric stepped coastal bluff profile (high craggy bluff on left -> long low seaward ledge on right!)
  function bluffHeightAt(x) {
    const u = x / (width * 0.5); // -1 .. +1
    let hProfile;
    if (u < -0.10) {
      // High left bluff tapering slightly only at far-left edge
      const leftEdge = u < -0.74 ? 1.0 - 0.58 * Math.pow((-u - 0.74) / 0.26, 1.8) : 1.0;
      hProfile = (0.94 + 0.08 * Math.cos((u + 0.35) * 3.2)) * leftEdge;
    } else if (u < 0.34) {
      // Stepped descent from upper bluff down toward the projecting seaward ledge!
      const t = (u + 0.10) / 0.44;
      hProfile = 0.94 * (1 - t) + 0.31 * t + 0.05 * Math.sin(t * Math.PI * 2.5);
    } else {
      // Long, low, flat-topped seaward rock spit jutting out on the right (`images (1).jpg`!)
      const tipDrop = u > 0.84 ? 1.0 - 0.48 * Math.pow((u - 0.84) / 0.16, 1.6) : 1.0;
      hProfile = (0.31 - 0.05 * (u - 0.34)) * tipDrop;
    }
    const localStep = 1.0 + 0.045 * scalarField3D(u * 4.5, 2.1, 0.9, planSalt + 71);
    return height * clamp(hProfile * localStep, 0.14, 1.04);
  }

  // 1. Continuous Stepped Coastal Bedrock Foreshore Platform (NO hexagon stepping-stones & NO wax cones!)
  const nPlatCols = 11;
  const platSpanX = width * 1.00;
  const platStepX = platSpanX / nPlatCols;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < nPlatCols; i++) {
      const cx = -platSpanX * 0.5 + (i + 0.5) * platStepX;
      const fzCliff = cliffFrontZ(cx);
      const z0 = row === 0 ? fzCliff - depth * 0.16 : fzCliff + depth * 0.12;
      const z1 = row === 0 ? fzCliff + depth * 0.22 : fzCliff + depth * (0.44 - 0.12 * Math.abs(cx / (width * 0.5)));
      if (z1 <= z0 + S * 0.03) continue;

      const platH = height * (row === 0 ? rng.range(0.062, 0.082) : rng.range(0.034, 0.052));
      let poly = sculptGeologicalParentPoly(
        [cx + rng.signed() * S * 0.005, groundY + platH * 0.46, 0.5 * (z0 + z1)],
        [platStepX * 0.78, platH * 0.54, (z1 - z0) * 0.68],
        bedFrame,
        rng,
        { jointDispersion: 0.05, cornerBlunt: 0.58, flatBaseY: groundY, extraBevelCuts: 3 }
      );
      const waveRampN = vnorm([rng.signed() * 0.03, 0.994, 0.09]);
      poly = clipPolyByHalfSpace(poly, waveRampN, vdot(waveRampN, [cx, groundY + platH * 0.88, 0.5 * (z0 + z1)]), 'foreshore') || poly;
      poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

      const compP = compilePolyBlock(poly, bedFrame, {
        edgeBevel: bevel * 1.1,
        smoothUnionR: S * 0.0040,
        detailScale: 0.88,
        hardness: 0.85,
        isSedimentary: true,
        seedSalt: (planSalt + row * 97 + i * 13) & 0x7fffffff,
      });
      if (compP) blocks.push(compP);
    }
  }

  // 1B. Solid Recessed Interior Headland Spine across ALL X (including right seaward spit!)
  // Ensures vertical cross-joints are realistic 0.35m-0.55m deep shadow-filled rock clefts — NEVER bread-slice air slots!
  const nSpine = 14;
  const spineSpan = width * 0.94;
  const spineStep = spineSpan / nSpine;
  for (let i = 0; i < nSpine; i++) {
    const cx = -spineSpan * 0.5 + (i + 0.5) * spineStep;
    const isRightSpit = cx > width * 0.14;
    const hLocal = bluffHeightAt(cx) * (isRightSpit ? 0.99 : 0.94);
    const fzCore = cliffFrontZ(cx) - S * (isRightSpit ? 0.016 : 0.022);
    const bzCore = Math.min(fzCore - S * 0.075, cliffBackZ(cx) + S * 0.010);
    let cPoly = sculptGeologicalParentPoly(
      [cx, groundY + (height * 0.07 + hLocal) * 0.5, 0.5 * (fzCore + bzCore)],
      [spineStep * 0.86, (hLocal - height * 0.07) * 0.53, Math.max(S * 0.045, (fzCore - bzCore) * 0.64)],
      bedFrame,
      rng,
      { jointDispersion: 0.06, cornerBlunt: 0.62, flatBaseY: groundY, extraBevelCuts: 4 }
    );
    const topN = bedFrame.normal;
    cPoly = clipPolyByHalfSpace(cPoly, topN, vdot(topN, [cx, groundY + hLocal, 0]), 'spineTop') || cPoly;
    cPoly = clipPolyByHalfSpace(cPoly, [0, -1, 0], -groundY, 'base') || cPoly;
    const compCore = compilePolyBlock(cPoly, bedFrame, {
      edgeBevel: bevel * 1.15,
      smoothUnionR: S * 0.0065,
      detailScale: 0.92,
      hardness: 0.80,
      isSedimentary: true,
      seedSalt: (planSalt + 901 + i * 19) & 0x7fffffff,
    });
    if (compCore) blocks.push(compCore);
  }

  // 2. Vertically-Jointed Blocky Stratigraphic Beds (Crisp vertical fracture seams & plucked blocks!)
  function addJointedBlockStratum(refY0, bedH, projFrac, hardness, opts = {}) {
    const {
      x0 = -width * 0.48,
      x1 = width * 0.49,
      nBlocks = 24,
      stepSalt = 1,
      upperRetreat = 0.0,
    } = opts;

    const span = x1 - x0;
    const baseStepX = span / nBlocks;
    const jointGap = S * (0.0018 + 0.0045 * aperture);

    for (let i = 0; i < nBlocks; i++) {
      // Irregular block joint spacing along strike (so vertical joints stagger naturally across beds!)
      const jitter0 = i === 0 ? 0 : scalarField3D(i * 1.37, stepSalt * 2.1, 0.4, planSalt + stepSalt * 31) * baseStepX * 0.24;
      const jitter1 = i === nBlocks - 1 ? 0 : scalarField3D((i + 1) * 1.37, stepSalt * 2.1, 0.4, planSalt + stepSalt * 31) * baseStepX * 0.24;
      const bx0 = x0 + i * baseStepX + jitter0;
      const bx1 = x0 + (i + 1) * baseStepX + jitter1;
      const cx = 0.5 * (bx0 + bx1);
      const blkW = Math.max(S * 0.024, (bx1 - bx0) - jointGap);

      const wy0 = refY0 - cx * dipSlopeX;
      const wy1 = wy0 + bedH;
      const localBluff = bluffHeightAt(cx);
      if (wy0 > localBluff - bedH * 0.28) continue;

      // Occasional plucked/recessed rectangular joint block (`images (1).jpg` vertical block steps!)
      const pluckHash = scalarField3D(i * 1.9, stepSalt * 3.3, 0.7, planSalt + 503);
      const isPluckedBlock = pluckHash > (0.64 - 0.22 * pluck) && i > 1 && i < nBlocks - 2;
      const blockStepZ = (
        projFrac * (0.62 + 0.50 * overhang)
        - upperRetreat
        - (isPluckedBlock ? rng.range(0.06, 0.13) : 0)
        + scalarField3D((cx / width) * 6.5, stepSalt * 1.9, 0.5, planSalt + stepSalt * 17) * 0.035
      ) * depth;

      const fzMid = cliffFrontZ(cx) + blockStepZ;
      const bzMid = Math.min(fzMid - S * 0.075, cliffBackZ(cx));

      const vPad = hardness < 0.45 ? bedH * 0.22 : bedH * 0.04;
      const topRef = refY0 + bedH + vPad;
      const botRef = Math.max(groundY + height * 0.055, refY0 - vPad);

      let poly = createBoxPoly(
        cx - blkW * 0.62,
        groundY,
        bzMid - depth * 0.12,
        cx + blkW * 0.62,
        height * 1.25,
        fzMid + depth * 0.15,
        'jointedBedBlock'
      );

      const topN = bedFrame.normal;
      const botN = [-bedFrame.normal[0], -bedFrame.normal[1], -bedFrame.normal[2]];
      poly = clipPolyByHalfSpace(poly, topN, vdot(topN, [0, topRef, 0]), 'bedTop') || poly;
      poly = clipPolyByHalfSpace(poly, botN, vdot(botN, [0, botRef, 0]), 'bedBot') || poly;
      if (!poly) continue;

      const midY = 0.5 * (wy0 + wy1);
      const dzdx = clamp((cliffFrontZ(bx1) - cliffFrontZ(bx0)) / Math.max(0.04, bx1 - bx0), -0.95, 0.95);
      // Sheer vertical/slightly overhanging block face!
      const batter = hardness > 0.7 ? rng.range(-0.06, 0.05) : rng.range(0.08, 0.18);
      const frontN = vnorm([-dzdx + rng.signed() * 0.08, batter, 1.0]);
      poly = clipPolyByHalfSpace(poly, frontN, vdot(frontN, [cx, midY, fzMid]), 'blockFace') || poly;

      // Crisp sub-vertical cross-joint planes on left & right of each block (`images (1).jpg` columnar jointing!)
      const jTiltL = rng.signed() * 0.09;
      const jTiltR = rng.signed() * 0.09;
      const jYawL = rng.signed() * 0.22;
      const jYawR = rng.signed() * 0.22;
      const leftJ = vnorm([-Math.cos(jYawL), jTiltL, Math.sin(jYawL)]);
      const rightJ = vnorm([Math.cos(jYawR), jTiltR, Math.sin(jYawR)]);
      poly = clipPolyByHalfSpace(poly, leftJ, vdot(leftJ, [cx - blkW * 0.49, midY, fzMid - blkW * 0.12]), 'vJointL') || poly;
      poly = clipPolyByHalfSpace(poly, rightJ, vdot(rightJ, [cx + blkW * 0.49, midY, fzMid - blkW * 0.12]), 'vJointR') || poly;

      const backN = vnorm([rng.signed() * 0.12, 0.18, -1.0]);
      poly = clipPolyByHalfSpace(poly, backN, vdot(backN, [cx, midY, bzMid]), 'backSlope') || poly;
      poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;
      if (!poly) continue;

      const comp = compilePolyBlock(poly, bedFrame, {
        edgeBevel: hardness > 0.65 ? bevel : bevel * 1.45,
        smoothUnionR: S * 0.0020, // Preserves sharp vertical joint cracks between adjacent blocks!
        detailScale: hardness > 0.65 ? 0.90 : 1.08,
        hardness,
        isSedimentary: true,
        seedSalt: (planSalt + stepSalt * 131 + i * 29) & 0x7fffffff,
      });
      if (comp) blocks.push(comp);
    }
  }

  // 16-Horizon Coastal Headland Stratigraphic Column (`images (1).jpg` proportions!)
  // - Dark basal wave-undercut notch (y ~ 0.06..0.10) right above the foreshore platform!
  // - Massive blocky ochre-rust lower beds (y ~ 0.10..0.30) — extends all the way out onto the right seaward spit!
  // - Blocky pale cream-buff middle-lower beds (y ~ 0.30..0.46)
  // - Thinly laminated purplish-maroon middle-upper beds (y ~ 0.46..0.67)
  // - Stepped upper bluff ledges & broken outcrop boulders (y ~ 0.67..1.00)
  const strataSpec = [
    { h: 0.042, proj: -0.14, hard: 0.22, n: 18, ret: 0.00 }, // 1. Deep dark basal wave-cut overhang notch!
    { h: 0.095, proj:  0.08, hard: 0.94, n: 26, ret: 0.00 }, // 2. Massive blocky rust-ochre lower cliff bed A
    { h: 0.088, proj:  0.10, hard: 0.92, n: 25, ret: 0.00 }, // 3. Massive blocky rust-ochre lower cliff bed B (caps right spit!)
    { h: 0.028, proj: -0.05, hard: 0.32, n: 22, ret: 0.01 }, // 4. Sharp recessed bedding parting
    { h: 0.078, proj:  0.07, hard: 0.88, n: 26, ret: 0.02 }, // 5. Vertically-jointed pale buff quartzose bed A
    { h: 0.068, proj:  0.06, hard: 0.86, n: 26, ret: 0.03 }, // 6. Vertically-jointed pale buff quartzose bed B
    { h: 0.030, proj: -0.06, hard: 0.30, n: 22, ret: 0.04 }, // 7. Recessed shale parting
    { h: 0.046, proj:  0.05, hard: 0.78, n: 28, ret: 0.05 }, // 8. Laminated purplish-maroon siltstone packet 1
    { h: 0.042, proj:  0.02, hard: 0.72, n: 28, ret: 0.06 }, // 9. Laminated purplish-maroon siltstone packet 2
    { h: 0.048, proj:  0.06, hard: 0.82, n: 26, ret: 0.07 }, // 10. Projecting maroon-violet rib bed
    { h: 0.038, proj: -0.02, hard: 0.65, n: 26, ret: 0.09 }, // 11. Thin maroon flagstone packet
    { h: 0.052, proj:  0.04, hard: 0.84, n: 22, ret: 0.13 }, // 12. Upper-mid terraced ledge bed
    { h: 0.064, proj:  0.02, hard: 0.88, n: 18, ret: 0.20, x1: 0.22 }, // 13. Upper retreating bluff bench 1
    { h: 0.072, proj:  0.00, hard: 0.90, n: 15, ret: 0.29, x1: 0.08 }, // 14. Upper retreating bluff bench 2
    { h: 0.076, proj: -0.02, hard: 0.92, n: 12, ret: 0.38, x1: -0.04 }, // 15. High left crag bluff wall
  ];

  let refY = groundY + height * 0.058;
  for (let s = 0; s < strataSpec.length; s++) {
    const sp = strataSpec[s];
    const bedH = sp.h * height;
    addJointedBlockStratum(refY, bedH, sp.proj, sp.hard, {
      x0: -0.48 * width,
      x1: (sp.x1 ?? 0.49) * width,
      nBlocks: sp.n,
      stepSalt: s + 1,
      upperRetreat: sp.ret,
    });
    refY += bedH * 0.96;
  }

  // 3. Craggy Angular Outcrop Blocks & Fractured Caprock Slabs Across the Upper Bluff Terraces (`images (1).jpg`!)
  const numBluffBoulders = 38;
  for (let b = 0; b < numBluffBoulders; b++) {
    const u = rng.range(-0.90, 0.34);
    const bx = u * width * 0.48;
    const localTop = bluffHeightAt(bx);
    if (localTop < height * 0.36) continue;

    const terraceFrac = rng.range(0.68, 0.98);
    const by = groundY + localTop * terraceFrac;
    const retreatZ = -(terraceFrac - 0.62) * depth * 0.52;
    const bz = cliffFrontZ(bx) + retreatZ + rng.range(-0.14, 0.03) * depth;

    const rB = S * rng.range(0.030, 0.066);
    const bFrame = buildStrikeDipFrame(
      strikeRad + rng.signed() * 0.24,
      dipRad + rng.range(-5, 14) * DEG2RAD
    );
    let bPoly = sculptGeologicalParentPoly(
      [bx, by, bz],
      [rB * rng.range(1.10, 1.65), rB * rng.range(0.42, 0.68), rB * rng.range(0.95, 1.35)],
      bFrame,
      rng,
      { jointDispersion: 0.14, cornerBlunt: 0.56, extraBevelCuts: 4 }
    );
    const crestAz = strikeRad + rng.signed() * 0.8;
    const crestN = vnorm([Math.cos(crestAz) * 0.36, 0.93, Math.sin(crestAz) * 0.36]);
    bPoly = clipPolyByHalfSpace(bPoly, crestN, vdot(crestN, [bx, by + rB * 0.54, bz]), 'bluffBoulder') || bPoly;
    bPoly = clipPolyByHalfSpace(bPoly, [0, -1, 0], -groundY, 'base') || bPoly;

    const compB = compilePolyBlock(bPoly, bFrame, {
      edgeBevel: bevel * 0.95,
      smoothUnionR: S * 0.0022,
      detailScale: 0.98,
      hardness: 0.92,
      isSedimentary: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compB) blocks.push(compB);
  }

  // Sparse angular fallen rock blocks resting directly on the bedrock foreshore (NO melted sand cones!)
  const numToeBlocks = Math.round(6 + (params.talusAmount ?? 0.52) * 8);
  for (let t = 0; t < numToeBlocks; t++) {
    const tx = rng.range(-0.44, 0.38) * width;
    const rT = S * rng.range(0.026, 0.054);
    const tz = cliffFrontZ(tx) + depth * rng.range(0.06, 0.24);
    const tf = buildStrikeDipFrame(rng.float() * Math.PI * 2, rng.range(12, 38) * DEG2RAD);
    let tPoly = sculptGeologicalParentPoly(
      [tx, groundY + height * 0.065 + rT * 0.45, tz],
      [rT * 1.25, rT * 0.65, rT * 1.05],
      tf,
      rng,
      { jointDispersion: 0.16, cornerBlunt: 0.72, flatBaseY: groundY, extraBevelCuts: 5 }
    );
    tPoly = clipPolyByHalfSpace(tPoly, [0, -1, 0], -groundY, 'base') || tPoly;
    const compT = compilePolyBlock(tPoly, tf, {
      edgeBevel: bevel,
      detailScale: 0.92,
      hardness: 0.90,
      isSedimentary: true,
      isBoulder: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compT) blocks.push(compT);
  }

  return { blocks, cuts, groundY };
}

/**
 * SCULPTED NARROW SLOT CANYON (`slot-canyon`)
 * Antelope Canyon / Buckskin Gulch water-sculpted Navajo sandstone corkscrew gorge:
 * - Synthesizes C0-continuous, boundary-matched 3D corkscrewing flash-flood wave walls along
 *   both sides of a sinuous canyon floor (`nTiers = 9` x `nSegsZ = 14` smooth-melded eolian
 *   sandstone blocks — ZERO cut-log tube ends, ZERO pancake/louver gaps, ZERO bread-loaf blocks!)
 * - Crowned with natural stepped cross-bedded Navajo slickrock rim domes & wedged chockstones!
 */
export function buildSlotCanyon(params, tectonics, rng) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const dipRad = clamp((params.dipAngle ?? 6), 2, 16) * 0.50 * DEG2RAD;
  const strikeRad = (params.strikeAngle ?? -8) * DEG2RAD;
  const bedFrame = buildStrikeDipFrame(strikeRad, dipRad);
  const overhang = params.overhangStrength ?? 0.80;
  const bevel = S * (0.0020 + 0.0030 * (params.edgeWear ?? 0.56));
  const smoothR = S * 0.015;

  const lengthZ = S * 1.04;
  const height = S * 0.68;
  const maxOuterX = S * 0.48;
  const phase = rng.float() * Math.PI * 2;
  const waveSalt = rng.int(1, 99999);

  function slotCenterX(zf) {
    return S * 0.105 * Math.sin(zf * Math.PI * 1.65 + phase) +
           S * 0.032 * Math.cos(zf * Math.PI * 2.8 - phase * 0.5);
  }

  // Smooth C1 analytical 3D flash-flood corkscrew inner canyon wall X(zf, yf, side)
  function innerWallX(zf, yf, side) {
    const mouthFlare = 1.0 + 0.58 * Math.pow(Math.abs(zf) * 2.0, 2.5);
    const halfGap = S * (0.058 + 0.034 * Math.pow(yf - 0.44, 2) * 2.4) * mouthFlare;
    // Sweeping Antelope-Canyon flood-vortex corkscrew ribs!
    const vortexWave1 = Math.sin(yf * Math.PI * 2.7 + zf * Math.PI * 2.2 + side * 0.45) * S * (0.052 + 0.036 * overhang);
    const vortexWave2 = Math.cos(yf * Math.PI * 4.6 - zf * Math.PI * 2.9 + side * 1.1) * S * 0.022;
    const fineUndul = scalarField3D(zf * 3.2, yf * 3.2, side * 1.7, waveSalt) * S * 0.014;
    return slotCenterX(zf) + side * halfGap + vortexWave1 + vortexWave2 + fineUndul;
  }

  // Smoothly domed exterior Navajo slickrock fin profile on both sides & portal ends!
  function outerFlankX(zf, yf, side) {
    const portalTaper = clamp(1.06 - 0.50 * Math.pow(Math.abs(zf) * 2.0, 2.3), 0.36, 1.0);
    const domeTaper = 1.0 - 0.34 * Math.pow(yf, 1.45);
    const embay = 1.0 + 0.12 * scalarField3D(zf * 2.4, yf * 1.2, side * 2.3, waveSalt + 41);
    return slotCenterX(zf) * 0.35 + side * maxOuterX * portalTaper * domeTaper * embay;
  }

  function wallCrestH(zf, side) {
    const portalEnv = clamp(1.08 - 0.58 * Math.pow(Math.abs(zf) * 2.0, 2.4), 0.28, 1.0);
    const slickrockDomes = 0.92 + 0.12 * Math.cos(zf * Math.PI * 3.0 + side * 0.8) +
                           0.07 * scalarField3D(zf * 3.0, side * 1.9, 0.5, waveSalt + 83);
    return height * portalEnv * slickrockDomes;
  }

  const nTiers = 9;
  const nSegsZ = 14;
  const dzSeg = lengthZ / nSegsZ;
  const tierStepY = height / nTiers;

  for (const side of [-1, 1]) {
    for (let b = 0; b < nTiers; b++) {
      const yf0 = b / nTiers;
      const yf1 = (b + 1) / nTiers;
      const yfMid = 0.5 * (yf0 + yf1);
      const y0 = groundY + yf0 * height;
      const y1 = groundY + yf1 * height;
      const midY = 0.5 * (y0 + y1);

      for (let iz = 0; iz < nSegsZ; iz++) {
        const zfMid = (iz + 0.5) / nSegsZ - 0.5;
        const zf0 = iz / nSegsZ - 0.5;
        const zf1 = (iz + 1) / nSegsZ - 0.5;
        const cz = zfMid * lengthZ;

        const localCrest = wallCrestH(zfMid, side);
        if (y0 > localCrest - tierStepY * 0.18) continue;
        const actualTopY = Math.min(localCrest, y1);
        const actualTopYf = (actualTopY - groundY) / height;

        // Exact boundary-matched evaluations so tier b and tier b+1 meet FLUSH with zero louver steps!
        const inXBot = innerWallX(zfMid, yf0, side);
        const inXTop = innerWallX(zfMid, actualTopYf, side);
        const inXMid = 0.5 * (inXBot + inXTop);
        const inXZ0 = innerWallX(zf0, yfMid, side);
        const inXZ1 = innerWallX(zf1, yfMid, side);

        const outXBot = outerFlankX(zfMid, yf0, side);
        const outXTop = outerFlankX(zfMid, actualTopYf, side);
        const outXMid = 0.5 * (outXBot + outXTop);
        const outXZ0 = outerFlankX(zf0, yfMid, side);
        const outXZ1 = outerFlankX(zf1, yfMid, side);

        if (side * (outXMid - inXMid) < S * 0.055) continue;

        const spanY = Math.max(S * 0.03, actualTopY - y0);
        const overlapY = tierStepY * 0.24;
        const halfZ = dzSeg * 0.72;
        const xMin = Math.min(inXBot, inXTop, outXBot, outXTop) - S * 0.08;
        const xMax = Math.max(inXBot, inXTop, outXBot, outXTop) + S * 0.08;

        let poly = createBoxPoly(
          xMin,
          b === 0 ? groundY : y0 - overlapY,
          cz - halfZ,
          xMax,
          actualTopY + (actualTopY < localCrest - 1e-3 ? overlapY : tierStepY * 0.05),
          cz + halfZ,
          'slotWaveWall'
        );

        // Gently sloped slickrock rim cap ONLY on the topmost tier at this Z; internal tiers overlap smoothly!
        if (actualTopY >= localCrest - tierStepY * 0.25) {
          const rimN = vnorm([side * 0.34, 0.92, rng.signed() * 0.16]);
          poly = clipPolyByHalfSpace(poly, rimN, vdot(rimN, [0.5 * (inXTop + outXTop), localCrest, cz]), 'slickrockRim') || poly;
        }

        const segMidY = 0.5 * (y0 + actualTopY);

        // Exact boundary-matched inner corkscrew gorge wave plane!
        const dxdyIn = clamp((inXTop - inXBot) / spanY, -1.25, 1.25);
        const dxdzIn = clamp((inXZ1 - inXZ0) / dzSeg, -1.25, 1.25);
        const gorgeN = vnorm([-side, side * dxdyIn, side * dxdzIn]);
        poly = clipPolyByHalfSpace(poly, gorgeN, vdot(gorgeN, [inXMid, segMidY, cz]), 'gorgeWave') || poly;

        // Exact boundary-matched exterior slickrock flank plane!
        const dxdyOut = clamp((outXTop - outXBot) / spanY, -1.1, 1.1);
        const dxdzOut = clamp((outXZ1 - outXZ0) / dzSeg, -1.1, 1.1);
        const outerN = vnorm([side, -side * dxdyOut, -side * dxdzOut]);
        poly = clipPolyByHalfSpace(poly, outerN, vdot(outerN, [outXMid, segMidY, cz]), 'outerSlickrock') || poly;

        // Tapered sandstone prows at entrance (-Z) and exit (+Z) portals
        if (iz === 0 || iz === nSegsZ - 1) {
          const zSign = iz === 0 ? -1 : 1;
          const prowN = vnorm([side * 0.42, 0.26, zSign * 0.87]);
          poly = clipPolyByHalfSpace(poly, prowN, vdot(prowN, [0.5 * (inXMid + outXMid), segMidY, cz + zSign * halfZ * 0.58]), 'portalProw') || poly;
        }

        poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;
        if (!poly) continue;

        const comp = compilePolyBlock(poly, bedFrame, {
          edgeBevel: bevel,
          smoothUnionR: smoothR,
          detailScale: 1.0,
          isEolian: true,
          seedSalt: (waveSalt + b * 73 + iz * 19 + (side > 0 ? 401 : 0)) & 0x7fffffff,
        });
        if (comp) blocks.push(comp);
      }
    }

    // Natural stepped cross-bedded slickrock benches wrapping the outer desert flanks!
    for (let sb = 0; sb < 4; sb++) {
      const zf = -0.34 + sb * 0.23 + rng.signed() * 0.04;
      const bh = height * rng.range(0.16, 0.34);
      const bx = outerFlankX(zf, 0.12, side) + side * S * rng.range(0.02, 0.06);
      let benchP = sculptGeologicalParentPoly(
        [bx, groundY + bh * 0.46, zf * lengthZ],
        [S * rng.range(0.09, 0.14), bh * 0.52, S * rng.range(0.13, 0.20)],
        bedFrame,
        rng,
        { jointDispersion: 0.14, cornerBlunt: 0.78, flatBaseY: groundY, extraBevelCuts: 6 }
      );
      benchP = clipPolyByHalfSpace(benchP, [0, -1, 0], -groundY, 'base') || benchP;
      const compSB = compilePolyBlock(benchP, bedFrame, {
        edgeBevel: bevel,
        smoothUnionR: smoothR * 0.85,
        detailScale: 0.96,
        isEolian: true,
        seedSalt: rng.int(1, 999999),
      });
      if (compSB) blocks.push(compSB);
    }
  }

  // Wedged flash-flood canyon-floor chockstones & portal boulders
  for (const zf of [-0.44, -0.15, 0.19, 0.45]) {
    const bx = slotCenterX(zf) + rng.signed() * S * 0.025;
    const bz = zf * lengthZ;
    const rChock = S * rng.range(0.032, 0.055);
    const bFrame = buildStrikeDipFrame(rng.float() * Math.PI * 2, rng.range(18, 46) * DEG2RAD);
    let bPoly = sculptGeologicalParentPoly(
      [bx, groundY + rChock * 0.68, bz],
      [rChock * 1.15, rChock * 0.78, rChock * 1.25],
      bFrame,
      rng,
      { jointDispersion: 0.18, cornerBlunt: 0.74, flatBaseY: groundY, extraBevelCuts: 6 }
    );
    bPoly = clipPolyByHalfSpace(bPoly, [0, -1, 0], -groundY, 'base') || bPoly;
    const compB = compilePolyBlock(bPoly, bFrame, {
      edgeBevel: bevel * 0.85,
      detailScale: 0.90,
      isEolian: true,
      isBoulder: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compB) blocks.push(compB);
  }

  return { blocks, cuts, groundY };
}

/**
 * BRYCE BADLANDS HOODOO RIDGE (`hoodoo-columns`)
 * Bryce Canyon Silent City / Queen's Garden corrugated badlands fin & turret wall:
 * - Continuous, fused badlands fin-ridges dissecting into closely-spaced corrugated Claron
 *   limestone/marl spires & bulbous-necked totems (ZERO floating square graduation caps!)
 * - Rhythmic horizontal hard/soft Claron beds modulate every fluted fin smoothly from flared
 *   badlands apron to weathered turret/dome crests!
 */
export function buildHoodooColumns(params, tectonics, rng, addTalusFn) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const dipRad = clamp((params.dipAngle ?? 4), 0, 14) * DEG2RAD;
  const strikeRad = (params.strikeAngle ?? 6) * DEG2RAD;
  const bedFrame = buildStrikeDipFrame(strikeRad, dipRad);
  const overhang = params.overhangStrength ?? 0.82;
  const bevel = S * (0.0016 + 0.0028 * (params.edgeWear ?? 0.44));

  // 1. Flared Badlands Marl Ridge Pedestal & Buttress Ribs (anchors the entire Silent City fin!)
  const finSpineNodes = 9;
  for (let i = 0; i < finSpineNodes; i++) {
    const u = (i / (finSpineNodes - 1)) - 0.5;
    const cx = u * 0.88 * S;
    const cz = Math.sin(u * 2.8) * S * 0.035;
    const baseH = S * (0.26 - 0.14 * Math.abs(u)) * rng.range(0.90, 1.12);

    let ped = sculptGeologicalParentPoly(
      [cx, groundY + baseH * 0.45, cz],
      [S * 0.105, baseH * 0.54, S * (0.20 - 0.08 * Math.abs(u))],
      bedFrame,
      rng,
      { jointDispersion: 0.09, cornerBlunt: 0.78, flatBaseY: groundY, extraBevelCuts: 6 }
    );
    ped = clipPolyByHalfSpace(ped, [0, -1, 0], -groundY, 'base') || ped;
    const compP = compilePolyBlock(ped, bedFrame, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.012,
      detailScale: 0.96,
      isSedimentary: true,
      hardness: 0.48,
      seedSalt: rng.int(1, 999999),
    });
    if (compP) blocks.push(compP);
  }

  // 2. Corrugated Parallel Hoodoo Spires & Fluted Badlands Buttress Ribs (continuous, zero floating squares!)
  const spires = [
    { x: -0.05, z: -0.01, h: 0.95, rx: 0.082, rz: 0.115, style: 'bulbCap' },
    { x:  0.07, z:  0.01, h: 0.87, rx: 0.076, rz: 0.108, style: 'turret' },
    { x: -0.17, z: -0.02, h: 0.80, rx: 0.078, rz: 0.105, style: 'spire' },
    { x:  0.19, z: -0.01, h: 0.74, rx: 0.074, rz: 0.100, style: 'bulbCap' },
    { x: -0.29, z:  0.01, h: 0.65, rx: 0.072, rz: 0.095, style: 'turret' },
    { x:  0.31, z:  0.01, h: 0.57, rx: 0.068, rz: 0.090, style: 'spire' },
    { x: -0.40, z:  0.02, h: 0.44, rx: 0.064, rz: 0.082, style: 'spire' },
    { x:  0.41, z:  0.02, h: 0.40, rx: 0.060, rz: 0.078, style: 'turret' },
    // Secondary foreground parallel fin hoodoos (Bryce amphitheater depth!)
    { x: -0.11, z:  0.13, h: 0.60, rx: 0.064, rz: 0.078, style: 'bulbCap' },
    { x:  0.02, z:  0.14, h: 0.52, rx: 0.060, rz: 0.074, style: 'spire' },
    { x:  0.14, z:  0.12, h: 0.47, rx: 0.058, rz: 0.072, style: 'turret' },
    { x: -0.24, z:  0.12, h: 0.39, rx: 0.055, rz: 0.068, style: 'spire' },
  ];

  // Shared master stratigraphic pinch-and-swell profile across the entire badlands amphitheater!
  const nZones = 11;
  const ribSalt = rng.int(1, 99999);
  function masterSwellAt(yf) {
    const wave = 0.88 + 0.18 * Math.sin(yf * Math.PI * 7.2 + 0.5) + 0.08 * Math.cos(yf * Math.PI * 13.0);
    return wave;
  }

  for (let hi = 0; hi < spires.length; hi++) {
    const hd = spires[hi];
    const hx = hd.x * S + rng.signed() * S * 0.005;
    const hz = hd.z * S + rng.signed() * S * 0.005;
    const topY = hd.h * S * rng.range(0.96, 1.04);

    // Continuous fluted badlands fin core from groundY to topY (guarantees 0 floating caps!)
    let shaft = createBoxPoly(
      hx - hd.rx * 1.3 * S, groundY, hz - hd.rz * 1.3 * S,
      hx + hd.rx * 1.3 * S, topY, hz + hd.rz * 1.3 * S,
      'hoodooCore'
    );
    for (let f = 0; f < 8; f++) {
      const a = (f / 8) * Math.PI * 2 + hi * 0.37;
      const rad = 1.0 / Math.hypot(Math.cos(a) / (hd.rx * S * 0.76), Math.sin(a) / (hd.rz * S * 0.78));
      const fn = vnorm([Math.cos(a), rng.range(0.10, 0.16), Math.sin(a)]);
      shaft = clipPolyByHalfSpace(shaft, fn, vdot(fn, [hx, groundY + topY * 0.42, hz]) + rad, 'flute') || shaft;
    }
    const peakAz = rng.float() * Math.PI * 2;
    const peakN = vnorm([Math.cos(peakAz) * 0.58, 0.81, Math.sin(peakAz) * 0.58]);
    shaft = clipPolyByHalfSpace(shaft, peakN, vdot(peakN, [hx, topY - S * 0.015, hz]), 'corePeak') || shaft;
    const compShaft = compilePolyBlock(shaft, bedFrame, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.011,
      detailScale: 0.96,
      isSedimentary: true,
      hardness: 0.55,
      seedSalt: (ribSalt + hi * 53) & 0x7fffffff,
    });
    if (compShaft) blocks.push(compShaft);

    // Smoothly melded stratigraphic pinch-and-swell ribs along the column (melded with smoothUnionR so they form
    // organic bulbous Claron rings rather than separate stacked blocks!)
    for (let zIdx = 0; zIdx < nZones; zIdx++) {
      const y0 = groundY + 0.12 * S + (zIdx / nZones) * (S * 0.85);
      const y1 = groundY + 0.12 * S + ((zIdx + 1) / nZones) * (S * 0.85);
      if (y0 >= topY - S * 0.03) break;

      const actualY1 = Math.min(topY, y1);
      const cy = 0.5 * (y0 + actualY1);
      const yf = cy / (S * 0.96);
      const hFrac = clamp((cy - groundY) / topY, 0, 1);
      const isCrown = actualY1 >= topY - S * 0.035;
      const isSubCrownNeck = !isCrown && actualY1 >= topY - S * 0.10;

      let taper = 1.14 - 0.46 * Math.pow(hFrac, 1.15);
      let swell = masterSwellAt(yf);
      if (hd.style === 'bulbCap') {
        if (isCrown) swell = 1.06 + 0.10 * overhang; // Rounded weathered dolomite bulb, NOT a square plate!
        else if (isSubCrownNeck) swell = 0.72;
      } else if (hd.style === 'spire' && isCrown) {
        swell = 0.68;
      }

      let ringPoly = sculptGeologicalParentPoly(
        [hx + rng.signed() * S * 0.003, cy, hz + rng.signed() * S * 0.003],
        [
          hd.rx * taper * swell * S * rng.range(0.92, 1.06),
          (actualY1 - y0) * 0.66,
          hd.rz * taper * swell * S * rng.range(0.92, 1.06),
        ],
        bedFrame,
        rng,
        {
          jointDispersion: 0.12,
          cornerBlunt: 0.74, // Multi-faceted rounded polygon, never a 4-sided square mortarboard!
          extraBevelCuts: 7,
        }
      );

      if (isCrown) {
        // Domed / pitched weathered hoodoo crown (eliminates flat horizontal tabletop caps!)
        const cAz = rng.float() * Math.PI * 2;
        const cN1 = vnorm([Math.cos(cAz) * 0.52, 0.85, Math.sin(cAz) * 0.52]);
        const cN2 = vnorm([-Math.cos(cAz + 0.8) * 0.56, 0.83, -Math.sin(cAz + 0.8) * 0.56]);
        ringPoly = clipPolyByHalfSpace(ringPoly, cN1, vdot(cN1, [hx, actualY1 - S * 0.008, hz]), 'hoodooDome') || ringPoly;
        ringPoly = clipPolyByHalfSpace(ringPoly, cN2, vdot(cN2, [hx, actualY1 - S * 0.008, hz]) + hd.rx * S * 0.16, 'hoodooDome') || ringPoly;
      }

      const compRing = compilePolyBlock(ringPoly, bedFrame, {
        edgeBevel: bevel * 1.15,
        smoothUnionR: S * 0.017, // Smoothly melds bulbous Claron rings into organic frost-sculpted totems!
        detailScale: 0.94,
        hardness: swell > 0.95 ? 0.86 : 0.45,
        isSedimentary: true,
        seedSalt: rng.int(1, 999999),
      });
      if (compRing) blocks.push(compRing);
    }
  }

  if (addTalusFn) {
    addTalusFn(blocks, bedFrame, rng, {
      talusAmount: (params.talusAmount ?? 0.44) * 0.80,
      scale: S * 0.84,
      spanX: S * 0.84,
      groundY,
      edgeBevel: bevel,
      mode: 'outcrop',
    });
  }

  return { blocks, cuts, groundY };
}

/**
 * PEDESTAL BALANCED ROCK (`balanced-rock`)
 * Moab Balanced Rock / Mushroom Rock formation!
 */
export function buildBalancedRock(params, tectonics, rng, recursiveFractureFn, addTalusFn) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const overhang = params.overhangStrength ?? 0.86;
  const bevel = S * (0.0022 + 0.004 * (params.edgeWear ?? 0.44));
  const baseFrame = buildStrikeDipFrame((params.strikeAngle ?? -18) * DEG2RAD, 5 * DEG2RAD);

  const plinthSteps = [
    { x:  0.00, z:  0.00, y: 0.055, rx: 0.36, ry: 0.06, rz: 0.32 },
    { x: -0.14, z:  0.08, y: 0.045, rx: 0.24, ry: 0.05, rz: 0.22 },
    { x:  0.16, z: -0.06, y: 0.050, rx: 0.23, ry: 0.055, rz: 0.22 },
    { x:  0.01, z:  0.00, y: 0.125, rx: 0.25, ry: 0.055, rz: 0.23 },
  ];
  for (let i = 0; i < plinthSteps.length; i++) {
    const ps = plinthSteps[i];
    const poly = sculptGeologicalParentPoly(
      [ps.x * S, groundY + ps.y * S, ps.z * S],
      [ps.rx * S, ps.ry * S, ps.rz * S],
      baseFrame,
      rng,
      { jointDispersion: 0.08, cornerBlunt: 0.82, flatBaseY: i < 3 ? groundY : undefined, extraBevelCuts: 6 }
    );
    const comp = compilePolyBlock(poly, baseFrame, {
      edgeBevel: bevel * 1.1,
      smoothUnionR: S * 0.016,
      detailScale: 0.95,
      isEolian: true,
      seedSalt: rng.int(1, 999999),
    });
    if (comp) blocks.push(comp);
  }

  const pedBands = 7;
  const pedStartY = groundY + 0.13 * S;
  const pedEndY = groundY + 0.48 * S;
  for (let b = 0; b < pedBands; b++) {
    const f = b / (pedBands - 1);
    const y0 = pedStartY + (b / pedBands) * (pedEndY - pedStartY);
    const y1 = pedStartY + ((b + 1) / pedBands) * (pedEndY - pedStartY);
    const cy = 0.5 * (y0 + y1);

    const baseTaper = 0.076 + 0.128 * Math.pow(1 - f, 1.75);
    const ribMod = (b % 2 === 0) ? 1.06 : 0.92;
    const rBand = baseTaper * ribMod * S;

    const bandPoly = sculptGeologicalParentPoly(
      [rng.signed() * S * 0.006, cy, rng.signed() * S * 0.006],
      [rBand * 1.05, (y1 - y0) * 0.62, rBand * 0.98],
      baseFrame,
      rng,
      { jointDispersion: 0.08, cornerBlunt: 0.80, extraBevelCuts: 5 }
    );
    const compBand = compilePolyBlock(bandPoly, baseFrame, {
      edgeBevel: bevel * 1.15,
      smoothUnionR: S * 0.012,
      detailScale: 1.05,
      hardness: 0.35,
      isSedimentary: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compBand) blocks.push(compBand);
  }

  const capTilt = clamp((params.dipAngle ?? 16), 12, 26) * DEG2RAD;
  const capStrike = ((params.strikeAngle ?? -18) * DEG2RAD) + rng.signed() * 0.2;
  const capFrame = buildStrikeDipFrame(capStrike, capTilt);

  const capRx = S * (0.185 + 0.038 * overhang);
  const capRy = S * 0.235;
  const capRz = S * (0.155 + 0.025 * overhang);
  const capCx = S * 0.022;
  const capCy = groundY + 0.665 * S;

  let capPoly = sculptGeologicalParentPoly(
    [capCx, capCy, 0],
    [capRx, capRy, capRz],
    capFrame,
    rng,
    { jointDispersion: 0.16, cornerBlunt: 0.76, extraBevelCuts: 7 }
  );

  const prowN1 = perturbNormal(vnorm([-capFrame.dipVec[0] * 0.62, 0.78, -capFrame.dipVec[2] * 0.62]), rng, 0.12);
  const prowN2 = perturbNormal(vnorm([capFrame.strikeVec[0] * 0.56, 0.82, capFrame.strikeVec[2] * 0.56]), rng, 0.12);
  capPoly = clipPolyByHalfSpace(capPoly, prowN1, vdot(prowN1, [capCx, capCy + capRy * 0.42, 0]) + capRy * 0.38, 'crest') || capPoly;
  capPoly = clipPolyByHalfSpace(capPoly, prowN2, vdot(prowN2, [capCx, capCy + capRy * 0.42, 0]) + capRx * 0.42, 'crest') || capPoly;

  const capParts = recursiveFractureFn
    ? recursiveFractureFn(capPoly, capFrame, tectonics, rng, {
        maxDepth: 1,
        minSpan: S * 0.12,
        minVolume: (S * 0.08) ** 3,
        bedSplitBias: 1.3,
        openCleftChance: 0.0,
        overlapDepth: S * 0.020,
        shearSlip: 0.05,
        pluckChance: 0,
        groundY: null,
      })
    : [capPoly];

  for (const cp of capParts) {
    const compCap = compilePolyBlock(cp, capFrame, {
      edgeBevel: bevel * 0.80,
      smoothUnionR: S * 0.004,
      detailScale: 0.82,
      hardness: 0.95,
      isEolian: true,
      seedSalt: rng.int(1, 999999),
    });
    if (compCap) blocks.push(compCap);
  }

  if (addTalusFn) {
    addTalusFn(blocks, baseFrame, rng, {
      talusAmount: (params.talusAmount ?? 0.44) * 0.85,
      scale: S * 0.80,
      spanX: S * 0.64,
      groundY,
      edgeBevel: bevel * 0.85,
      mode: 'outcrop',
    });
  }

  return { blocks, cuts, groundY };
}

/**
 * LIMESTONE KARST & SOLUTION GRIKES (`limestone-karst`)
 * Tsingy de Bemaraha / Malham Cove dissolution limestone formation:
 * - Broad, irregular weathered limestone pavement tables (`Clints`) dissected by deep conjugate
 *   `Grike` corridors (ZERO tiny square marshmallow cubes!)
 * - 14 continuous, unbroken, upward-tapering razor-edged Tsingy limestone fins & fluted pinnacles
 *   rising straight from the karst plinth to sharp knife-edge crests (ZERO gnome-hat caps!)
 */
export function buildLimestoneKarst(params, tectonics, rng, addTalusFn) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const dipRad = clamp((params.dipAngle ?? 5), 0, 18) * DEG2RAD;
  const strikeRad = (params.strikeAngle ?? 14) * DEG2RAD;
  const bedFrame = buildStrikeDipFrame(strikeRad, dipRad);
  const aperture = params.jointAperture ?? 0.50;
  const bevel = S * (0.0013 + 0.0024 * (params.edgeWear ?? 0.34));
  const cosS = Math.cos(strikeRad), sinS = Math.sin(strikeRad);

  // 1. Six Broad Irregular Polygonal Limestone Clint Pavement Tables Separated by Deep Grike Fissures!
  // Thin shadowed karst floor ensures grike corridors stay grounded without piercing bottom mesh
  const subFloor = sculptGeologicalParentPoly(
    [0, groundY + 0.020 * S, 0],
    [0.44 * S, 0.024 * S, 0.36 * S],
    bedFrame,
    rng,
    { jointDispersion: 0.14, cornerBlunt: 0.78, flatBaseY: groundY, extraBevelCuts: 6 }
  );
  const compFloor = compilePolyBlock(subFloor, bedFrame, {
    edgeBevel: bevel,
    smoothUnionR: S * 0.005,
    detailScale: 0.90,
    seedSalt: rng.int(1, 999999),
  });
  if (compFloor) blocks.push(compFloor);

  const clintTables = [
    { u: -0.24, v:  0.18, ru: 0.18, rv: 0.13, h: 0.13 },
    { u:  0.19, v:  0.19, ru: 0.19, rv: 0.13, h: 0.12 },
    { u: -0.26, v: -0.11, ru: 0.18, rv: 0.14, h: 0.19 },
    { u:  0.04, v: -0.06, ru: 0.16, rv: 0.14, h: 0.22 },
    { u:  0.30, v: -0.09, ru: 0.16, rv: 0.14, h: 0.18 },
    { u: -0.02, v:  0.24, ru: 0.14, rv: 0.10, h: 0.09 },
  ];
  const grikeTrim = S * (0.008 + 0.014 * aperture);

  for (const ct of clintTables) {
    const wx = (ct.u * cosS - ct.v * sinS) * S;
    const wz = (ct.u * sinS + ct.v * cosS) * S;
    const ch = ct.h * S * rng.range(0.90, 1.10);
    const localF = buildStrikeDipFrame(strikeRad + rng.signed() * 0.08, dipRad);

    let poly = sculptGeologicalParentPoly(
      [wx, groundY + ch * 0.48, wz],
      [ct.ru * S - grikeTrim, ch * 0.54, ct.rv * S - grikeTrim],
      localF,
      rng,
      { jointDispersion: 0.12, cornerBlunt: 0.76, flatBaseY: groundY, extraBevelCuts: 7 }
    );
    poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;
    const comp = compilePolyBlock(poly, bedFrame, {
      edgeBevel: bevel * 1.4,
      smoothUnionR: S * 0.004,
      detailScale: 1.0,
      seedSalt: rng.int(1, 999999),
    });
    if (comp) blocks.push(comp);
  }

  // 2. Fourteen Continuous, Elongated Tsingy Razor-Blade Limestone Fins & Stepped Shoulders!
  // Strongly elongated along strike (`ru ~ 2.4x rv`) so they read as true tectonic karst blades, never cones!
  const tsingyFins = [
    { u: -0.02, v: -0.05, h: 0.94, ru: 0.195, rv: 0.072, step: true },
    { u:  0.19, v: -0.03, h: 0.80, ru: 0.165, rv: 0.068, step: true },
    { u: -0.22, v: -0.02, h: 0.76, ru: 0.175, rv: 0.070, step: true },
    { u:  0.06, v: -0.19, h: 0.72, ru: 0.165, rv: 0.068, step: false },
    { u: -0.15, v: -0.18, h: 0.64, ru: 0.150, rv: 0.064, step: false },
    { u: -0.11, v:  0.10, h: 0.58, ru: 0.150, rv: 0.062, step: true },
    { u:  0.10, v:  0.09, h: 0.52, ru: 0.145, rv: 0.060, step: true },
    { u:  0.32, v: -0.07, h: 0.56, ru: 0.145, rv: 0.064, step: false },
    { u: -0.35, v: -0.08, h: 0.50, ru: 0.140, rv: 0.064, step: false },
    { u:  0.25, v:  0.12, h: 0.40, ru: 0.130, rv: 0.058, step: false },
    { u: -0.27, v:  0.13, h: 0.38, ru: 0.130, rv: 0.058, step: false },
    { u: -0.01, v:  0.21, h: 0.31, ru: 0.120, rv: 0.054, step: false },
    { u:  0.39, v:  0.03, h: 0.33, ru: 0.115, rv: 0.054, step: false },
    { u: -0.42, v:  0.03, h: 0.30, ru: 0.115, rv: 0.054, step: false },
  ];

  function buildKarstBlade(tx, tz, th, ru, rv, seedIdx) {
    const maxR = Math.max(ru, rv) * 1.55;
    let poly = createBoxPoly(
      tx - maxR, groundY, tz - maxR,
      tx + maxR, groundY + th * 1.12, tz + maxR,
      'tsingyFin'
    );

    const nFaces = 8;
    const az0 = strikeRad + seedIdx * 0.41;
    for (let f = 0; f < nFaces; f++) {
      const a = az0 + (f * Math.PI * 2) / nFaces + rng.signed() * 0.14;
      const da = a - strikeRad;
      const rad = 1.0 / Math.hypot(Math.cos(da) / ru, Math.sin(da) / rv) * rng.range(0.84, 1.02);
      // Broad blade faces taper gently (0.09..0.16), narrow fin ends taper more sharply (0.20..0.32)!
      const isEndFace = Math.abs(Math.cos(da)) > 0.65;
      const taperSlope = isEndFace ? rng.range(0.20, 0.32) : rng.range(0.09, 0.16);
      const fn = vnorm([Math.cos(a), taperSlope, Math.sin(a)]);
      poly = clipPolyByHalfSpace(poly, fn, vdot(fn, [tx, groundY + th * 0.38, tz]) + rad, 'karstWall') || poly;
    }

    const crestAz = strikeRad + Math.PI * 0.5 + rng.signed() * 0.18;
    const pN1 = vnorm([Math.cos(crestAz) * 0.84, 0.54, Math.sin(crestAz) * 0.84]);
    const pN2 = vnorm([-Math.cos(crestAz + 0.18) * 0.82, 0.57, -Math.sin(crestAz + 0.18) * 0.82]);
    const endSign = seedIdx % 2 === 0 ? 1 : -1;
    const endN = vnorm([Math.cos(strikeRad) * endSign * 0.72, 0.69, Math.sin(strikeRad) * endSign * 0.72]);
    poly = clipPolyByHalfSpace(poly, pN1, vdot(pN1, [tx, groundY + th * 0.96, tz]), 'knifePeak') || poly;
    poly = clipPolyByHalfSpace(poly, pN2, vdot(pN2, [tx, groundY + th * 0.96, tz]) + rv * 0.12, 'knifePeak') || poly;
    poly = clipPolyByHalfSpace(poly, endN, vdot(endN, [tx, groundY + th * 0.93, tz]) + ru * 0.12, 'knifeEnd') || poly;
    poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;

    const comp = compilePolyBlock(poly, bedFrame, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.0045,
      detailScale: 1.16,
      seedSalt: rng.int(1, 999999),
    });
    if (comp) blocks.push(comp);
  }

  for (let i = 0; i < tsingyFins.length; i++) {
    const tf = tsingyFins[i];
    const tx = (tf.u * cosS - tf.v * sinS) * S + rng.signed() * S * 0.008;
    const tz = (tf.u * sinS + tf.v * cosS) * S + rng.signed() * S * 0.008;
    const th = tf.h * S * rng.range(0.93, 1.06);
    const ru = tf.ru * S * rng.range(0.90, 1.12);
    const rv = tf.rv * S * rng.range(0.88, 1.10);

    buildKarstBlade(tx, tz, th, ru, rv, i * 2);

    // Secondary stepped karst fin shoulder along the same strike blade (breaks cone symmetry!)
    if (tf.step) {
      const dir = i % 2 === 0 ? 1 : -1;
      const offU = dir * ru * 0.56;
      buildKarstBlade(
        tx + cosS * offU,
        tz + sinS * offU,
        th * rng.range(0.58, 0.74),
        ru * 0.72,
        rv * 0.88,
        i * 2 + 1
      );
    }
  }

  if (addTalusFn) {
    addTalusFn(blocks, bedFrame, rng, {
      talusAmount: (params.talusAmount ?? 0.42) * 0.75,
      scale: S * 0.84,
      spanX: S * 0.80,
      groundY,
      edgeBevel: bevel,
      mode: 'outcrop',
    });
  }

  return { blocks, cuts, groundY };
}

/**
 * GRANITE HALF-DOME & ONION-SKIN SHEETING (`exfoliation-dome`)
 * Yosemite Half Dome / Tuolumne exfoliation granite massif:
 * Curved 3D granite dome wrapped in 4 concentric onion-skin exfoliation shells, sheared
 * cleanly across the front by a steep glacial headwall with overhanging visor brow & plucked
 * angular spall scars (zero artificial straight coin-slots!).
 */
export function buildExfoliationDome(params, tectonics, rng, addTalusFn) {
  const S = params.scale;
  const groundY = 0;
  const blocks = [];
  const cuts = [];

  const overhang = params.overhangStrength ?? 0.68;
  const pluck = params.pluckingAmount ?? 0.50;
  const bevel = S * (0.0022 + 0.004 * (params.edgeWear ?? 0.44));
  const strikeRad = (params.strikeAngle ?? 10) * DEG2RAD;
  const baseFrame = buildStrikeDipFrame(strikeRad, 10 * DEG2RAD);

  const domeRx = S * 0.47;
  const domeRy = S * 0.70;
  const domeRz = S * 0.38;

  // Sheer ~80° planar glacial headwall slicing the front (+Z) of the granite dome
  const faceAz = strikeRad * 0.30;
  const headwallN = vnorm([Math.sin(faceAz) * 0.98, 0.16 - 0.11 * overhang, Math.cos(faceAz) * 0.98]);
  const headwallPlaneOff = S * 0.095;

  function buildDomeShell(scaleMul, trimFront, minShellY, maxShellX, shellSmoothR, detailSc) {
    const rx = domeRx * scaleMul;
    const ry = domeRy * scaleMul;
    const rz = domeRz * scaleMul;
    let poly = createBoxPoly(-rx * 1.15, groundY, -rz * 1.25, rx * 1.15, groundY + ry * 1.08, rz * 1.15, 'dome');

    // Smooth curved granite dome crown & back via 44 tangent planes (high angular resolution -> silky dome curve!)
    const latRings = [
      { elev: 0.14, nAz: 12 },
      { elev: 0.44, nAz: 12 },
      { elev: 0.76, nAz: 10 },
      { elev: 1.08, nAz: 8 },
      { elev: 1.38, nAz: 5 },
    ];
    for (const ring of latRings) {
      const ce = Math.cos(ring.elev);
      const se = Math.sin(ring.elev);
      for (let k = 0; k < ring.nAz; k++) {
        const az = (k / ring.nAz) * Math.PI * 2 + ring.elev * 0.6;
        const ux = Math.cos(az) * ce;
        const uy = se;
        const uz = Math.sin(az) * ce;
        const px = ux * rx;
        const py = groundY + uy * ry;
        const pz = uz * rz - S * 0.04;
        const nrm = vnorm([ux / rx, uy / ry, uz / rz]);
        poly = clipPolyByHalfSpace(poly, nrm, vdot(nrm, [px, py, pz]), 'sheeting') || poly;
      }
    }

    poly = clipPolyByHalfSpace(poly, headwallN, headwallPlaneOff + trimFront, 'glacialFace') || poly;

    if (minShellY > groundY + 0.01 && poly) {
      const spallN = perturbNormal(vnorm([rng.signed() * 0.28, -0.93, 0.22]), rng, 0.07);
      poly = clipPolyByHalfSpace(poly, spallN, vdot(spallN, [0, minShellY, 0]), 'exfolStep') || poly;
    }
    if (maxShellX !== null && poly) {
      const sideSign = maxShellX > 0 ? 1 : -1;
      const sideN = perturbNormal(vnorm([sideSign * 0.90, -0.32, 0.28]), rng, 0.07);
      poly = clipPolyByHalfSpace(poly, sideN, vdot(sideN, [maxShellX, groundY + ry * 0.52, 0]), 'exfolSide') || poly;
    }

    poly = clipPolyByHalfSpace(poly, [0, -1, 0], -groundY, 'base') || poly;
    return compilePolyBlock(poly, baseFrame, {
      edgeBevel: bevel,
      smoothUnionR: shellSmoothR,
      detailScale: detailSc,
      seedSalt: rng.int(1, 999999),
    });
  }

  // 1. Monolithic Inner Granite Dome Core
  const coreComp = buildDomeShell(0.915, 0.0, groundY, null, S * 0.012, 0.85);
  if (coreComp) blocks.push(coreComp);

  // 2. Four Nested Concentric Onion-Skin Sheeting Shells (including iconic Half-Dome summit visor!)
  const shells = [
    buildDomeShell(0.955, S * 0.012 * overhang, groundY + domeRy * 0.20,  domeRx * 0.80, S * 0.004, 0.74),
    buildDomeShell(0.990, S * 0.022 * overhang, groundY + domeRy * 0.38, -domeRx * 0.74, S * 0.003, 0.70),
    buildDomeShell(1.022, S * 0.032 * overhang, groundY + domeRy * 0.56,  domeRx * 0.58, S * 0.003, 0.66),
    buildDomeShell(1.050, S * 0.044 * overhang, groundY + domeRy * 0.74, -domeRx * 0.44, S * 0.003, 0.62), // Overhanging summit visor!
  ];
  for (const sh of shells) {
    if (sh) blocks.push(sh);
  }

  // 3. Stepped Glacial Buttress Shoulders flanking the sheer face
  for (const side of [-1, 1]) {
    const bx = side * domeRx * (side < 0 ? 0.74 : 0.78);
    const bh = domeRy * (side < 0 ? 0.46 : 0.32);
    const bz = S * (side < 0 ? 0.08 : 0.04);
    const bPoly = sculptGeologicalParentPoly(
      [bx, groundY + bh * 0.48, bz],
      [S * 0.15, bh * 0.52, S * 0.16],
      baseFrame,
      rng,
      { jointDispersion: 0.14, cornerBlunt: 0.76, flatBaseY: groundY, extraBevelCuts: 5 }
    );
    const compB = compilePolyBlock(bPoly, baseFrame, {
      edgeBevel: bevel,
      smoothUnionR: S * 0.008,
      detailScale: 0.90,
      seedSalt: rng.int(1, 999999),
    });
    if (compB) blocks.push(compB);
  }

  // 4. Broad Angular Glacial Plucking Scars on the sheer face (breaks flatness naturally, zero artificial coin-slot!)
  const spallScars = [
    { x:  0.14 * domeRx, y: 0.36 * domeRy, rx: 0.22 * domeRx, ry: 0.22 * domeRy, rz: S * 0.045 * (0.6 + 0.6 * pluck) },
    { x: -0.22 * domeRx, y: 0.56 * domeRy, rx: 0.16 * domeRx, ry: 0.15 * domeRy, rz: S * 0.036 * (0.6 + 0.6 * pluck) },
  ];
  for (const sc of spallScars) {
    const scFrame = buildStrikeDipFrame(strikeRad + rng.signed() * 0.25, rng.range(18, 42) * DEG2RAD);
    const scPoly = sculptGeologicalParentPoly(
      [sc.x, groundY + sc.y, headwallPlaneOff + S * 0.025],
      [sc.rx, sc.ry, sc.rz],
      scFrame,
      rng,
      { jointDispersion: 0.12, cornerBlunt: 0.80, extraBevelCuts: 5 }
    );
    const compSc = compilePolyBlock(scPoly, scFrame, { edgeBevel: S * 0.003 });
    if (compSc) cuts.push(compSc);
  }

  if (addTalusFn) {
    addTalusFn(blocks, baseFrame, rng, {
      talusAmount: params.talusAmount ?? 0.48,
      scale: S * 0.92,
      spanX: domeRx * 1.85,
      frontZFn: () => headwallPlaneOff,
      groundY,
      edgeBevel: bevel,
      mode: 'cliff',
    });
  }

  return { blocks, cuts, groundY };
}

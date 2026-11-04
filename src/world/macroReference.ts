// CPU reference of the macro continent SDF. Must mirror macroSDF() in the GLSL chunk.
// Used for: brick classification (is a brick uniform air/solid?), spawn placement, tests.
import { HIGHLANDS_M, MACRO } from './macroParams.ts';
import { fbm2, fbm3, ridged2, vnoise2 } from './noise.ts';
import { type CoastField, sampleCoastKm } from './coastField.ts';

export interface MacroField {
  coast: CoastField;
}

/** Signed coastal distance in metres (negative on land), with warped and roughened coastline. */
export function macroCoastM(f: MacroField, x: number, z: number, oct: number): number {
  const wx = x + MACRO.warpAmpM * vnoise2(x * MACRO.warpFreq, z * MACRO.warpFreq);
  const wz = z + MACRO.warpAmpM * vnoise2(x * MACRO.warpFreq + 31.7, z * MACRO.warpFreq + 11.3);
  const cd = sampleCoastKm(f.coast, wx, wz) * 1000;
  return cd + MACRO.coastRoughAmpM * fbm2(x * MACRO.coastRoughFreq, z * MACRO.coastRoughFreq, oct);
}

/** Terrain envelope in metres (the 2D "shape" term; the solid itself is the 3D SDF below). */
export function macroHeight(f: MacroField, x: number, z: number, oct: number): number {
  let h = MACRO.plateauBaseM + MACRO.plateauAmpM * fbm2(x * MACRO.plateauFreq, z * MACRO.plateauFreq, 4);
  let m = 0;
  for (const H of HIGHLANDS_M) {
    const dx = x - H.x, dz = z - H.z;
    m += H.strength * Math.exp(-(dx * dx + dz * dz) / (H.sigma * H.sigma));
  }
  const rid = ridged2(x * MACRO.ridgeFreq, z * MACRO.ridgeFreq, oct);
  h += Math.min(m, 1) * MACRO.highlandAmpM * (0.55 + 0.45 * rid);
  const cm = macroCoastM(f, x, z, oct);
  const shelf = smoothstep(MACRO.shelfNearM, MACRO.shelfFarM, cm);
  const ocean = MACRO.oceanFloorM + 500 * fbm2(x * MACRO.oceanFreq, z * MACRO.oceanFreq, 2);
  return h + (ocean - h) * shelf;
}

/** Macro continent SDF in metres at world position (x, y, z). Positive in air. */
export function macroSDF(f: MacroField, x: number, y: number, z: number, oct = 8): number {
  const h = macroHeight(f, x, z, oct);
  let d = y - h;
  d += MACRO.overhangAmpM * fbm3(x * MACRO.overhangFreq, y * MACRO.overhangFreq, z * MACRO.overhangFreq, Math.min(oct, 3));
  d += MACRO.detailAmpM * fbm3(x * MACRO.detailFreq, y * MACRO.detailFreq, z * MACRO.detailFreq, oct);
  return d;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

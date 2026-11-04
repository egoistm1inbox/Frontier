// Macro-scale description of the continent. Consumed by:
//  - the CPU reference (src/world/macroReference.ts) used for brick classification and tests
//  - the GLSL generator (src/gpu/shaders/chunks.ts), which emits these as constants
import { WORLD } from '../config.ts';

/** Reference meridian/parallel placing the continent's origin near the Gulf of Guinea. */
export const LON0 = 17.0;
export const LAT0 = 1.2;
const KM_PER_DEG_LON = 111.32;
const KM_PER_DEG_LAT = 110.574;

/** Equirectangular projection (lon/lat → world x/z in metres). North is −z. */
export function lonLatToWorld(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KM_PER_DEG_LON * 1000, -(lat - LAT0) * KM_PER_DEG_LAT * 1000];
}

export interface Highland {
  name: string;
  lon: number;
  lat: number;
  sigmaKm: number;
  strength: number;
}

/** Stylised uplands that shape the continent's relief (Gaussian mounds, strength 0..1). */
export const HIGHLANDS: Highland[] = [
  { name: 'Ethiopian Highlands', lon: 38.5, lat: 9.5, sigmaKm: 450, strength: 0.9 },
  { name: 'East African Rift', lon: 37.0, lat: 0.0, sigmaKm: 350, strength: 0.6 },
  { name: 'Kilimanjaro', lon: 37.35, lat: -3.07, sigmaKm: 120, strength: 0.7 },
  { name: 'Highveld / Drakensberg', lon: 28.5, lat: -28.5, sigmaKm: 500, strength: 0.6 },
  { name: 'Atlas', lon: -5.0, lat: 32.0, sigmaKm: 350, strength: 0.7 },
  { name: 'Cameroon Mountains', lon: 13.5, lat: 5.0, sigmaKm: 280, strength: 0.6 },
  { name: 'Angolan Plateau', lon: 16.0, lat: -12.0, sigmaKm: 400, strength: 0.4 },
];

/** Highlands in world metres: [x, z, sigma(m), strength]. */
export const HIGHLANDS_M = HIGHLANDS.map((h) => {
  const [x, z] = lonLatToWorld(h.lon, h.lat);
  return { x, z, sigma: h.sigmaKm * 1000, strength: h.strength };
});

/** Scalar constants of the macro field. Metres. */
export const MACRO = {
  domainHalfM: WORLD.halfExtentM,
  plateauBaseM: 320,
  plateauAmpM: 380,
  plateauFreq: 1 / 700_000,
  highlandAmpM: 2600,
  ridgeFreq: 1 / 90_000,
  warpAmpM: 60_000,
  warpFreq: 1 / 400_000,
  coastRoughAmpM: 350,
  coastRoughFreq: 1 / 12_000,
  shelfNearM: -2000,
  shelfFarM: 30_000,
  oceanFloorM: -3200,
  oceanFreq: 1 / 150_000,
  overhangAmpM: 60,
  overhangFreq: 1 / 500,
  detailAmpM: 12,
  detailFreq: 1 / 40,
  /** Extra fine octave only generated for the finest clipmap levels. */
  fineAmpM: 1.2,
  fineFreq: 1 / 3,
} as const;

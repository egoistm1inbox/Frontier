// Noise projections: 2D simplex noise, fractal sums, ridged sums, domain warp
// and cellular (Worley) distance. All return values in the natural range of
// the underlying function (simplex ~[-1, 1], cellular distance ~[0, 1.4]).

import { CreateRandom, HashUnit } from "./SeededRandom.js";

const SkewFactor = 0.5 * (Math.sqrt(3) - 1);
const UnskewFactor = (3 - Math.sqrt(3)) / 6;
const GradientTable = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1],
];

// Gustavson 2D simplex noise with a seeded permutation table.
export function CreateSimplex(Seed) {
  const NextUnit = CreateRandom(Seed ^ 0x5bd1e995);
  const Source = Array.from({ length: 256 }, (_, Index) => Index);
  for (let Index = 255; Index > 0; Index--) {
    const Swap = Math.floor(NextUnit() * (Index + 1));
    [Source[Index], Source[Swap]] = [Source[Swap], Source[Index]];
  }
  const Perm = new Uint8Array(512);
  const PermMod12 = new Uint8Array(512);
  for (let Index = 0; Index < 512; Index++) {
    Perm[Index] = Source[Index & 255];
    PermMod12[Index] = Perm[Index] % 12;
  }
  return function Simplex(X, Y) {
    const Skew = (X + Y) * SkewFactor;
    const CellX = Math.floor(X + Skew);
    const CellY = Math.floor(Y + Skew);
    const Unskew = (CellX + CellY) * UnskewFactor;
    const X0 = X - (CellX - Unskew);
    const Y0 = Y - (CellY - Unskew);
    const Step1 = X0 > Y0 ? 1 : 0;
    const Step2 = 1 - Step1;
    const X1 = X0 - Step1 + UnskewFactor;
    const Y1 = Y0 - Step2 + UnskewFactor;
    const X2 = X0 - 1 + 2 * UnskewFactor;
    const Y2 = Y0 - 1 + 2 * UnskewFactor;
    const II = CellX & 255;
    const JJ = CellY & 255;
    let Contribution = 0;
    let Falloff = 0.5 - X0 * X0 - Y0 * Y0;
    if (Falloff > 0) {
      const G = GradientTable[PermMod12[II + Perm[JJ]]];
      Falloff *= Falloff;
      Contribution += Falloff * Falloff * (G[0] * X0 + G[1] * Y0);
    }
    Falloff = 0.5 - X1 * X1 - Y1 * Y1;
    if (Falloff > 0) {
      const G = GradientTable[PermMod12[II + Step1 + Perm[JJ + Step2]]];
      Falloff *= Falloff;
      Contribution += Falloff * Falloff * (G[0] * X1 + G[1] * Y1);
    }
    Falloff = 0.5 - X2 * X2 - Y2 * Y2;
    if (Falloff > 0) {
      const G = GradientTable[PermMod12[II + 1 + Perm[JJ + 1]]];
      Falloff *= Falloff;
      Contribution += Falloff * Falloff * (G[0] * X2 + G[1] * Y2);
    }
    return 70 * Contribution;
  };
}

// Fractional Brownian motion, normalised to ~[-1, 1].
export function Fractal(Sampler, X, Y, Octaves, Lacunarity = 2, Gain = 0.5) {
  let Sum = 0;
  let Amplitude = 1;
  let Frequency = 1;
  let Norm = 0;
  for (let Octave = 0; Octave < Octaves; Octave++) {
    Sum += Amplitude * Sampler(X * Frequency, Y * Frequency);
    Norm += Amplitude;
    Amplitude *= Gain;
    Frequency *= Lacunarity;
  }
  return Norm > 0 ? Sum / Norm : 0;
}

// Ridged multifractal: sharp crests where simplex crosses zero. Returns ~[0, 1].
export function RidgedFractal(Sampler, X, Y, Octaves, Lacunarity = 2, Gain = 0.5) {
  let Sum = 0;
  let Amplitude = 1;
  let Frequency = 1;
  let Weight = 1;
  let Norm = 0;
  for (let Octave = 0; Octave < Octaves; Octave++) {
    let Crest = 1 - Math.abs(Sampler(X * Frequency, Y * Frequency));
    Crest *= Crest;
    Crest *= Weight;
    Weight = Math.min(1, Math.max(0, Crest * 1.6));
    Sum += Crest * Amplitude;
    Norm += Amplitude;
    Amplitude *= Gain;
    Frequency *= Lacunarity;
  }
  return Norm > 0 ? Sum / Norm : 0;
}

// Worley / cellular noise. Returns the distance to the nearest jittered feature
// point, plus that feature's cell hash, written into Out = [F1, Hash].
export function CellularSample(X, Y, Seed, Out) {
  const CellX = Math.floor(X);
  const CellY = Math.floor(Y);
  let Nearest = 1e9;
  let NearestHash = 0;
  for (let OffsetY = -1; OffsetY <= 1; OffsetY++) {
    for (let OffsetX = -1; OffsetX <= 1; OffsetX++) {
      const Cx = CellX + OffsetX;
      const Cy = CellY + OffsetY;
      const PointX = Cx + HashUnit(Cx, Cy, Seed);
      const PointY = Cy + HashUnit(Cx, Cy, Seed + 17);
      const Dx = PointX - X;
      const Dy = PointY - Y;
      const Distance = Math.sqrt(Dx * Dx + Dy * Dy);
      if (Distance < Nearest) {
        Nearest = Distance;
        NearestHash = HashUnit(Cx, Cy, Seed + 31);
      }
    }
  }
  Out[0] = Nearest;
  Out[1] = NearestHash;
  return Out;
}

// Domain warp: returns the displaced coordinates for (X, Y) using two offset fields.
export function WarpCoordinate(WarpX, WarpY, X, Y, Amount) {
  return [X + Amount * WarpX(X, Y), Y + Amount * WarpY(X, Y)];
}

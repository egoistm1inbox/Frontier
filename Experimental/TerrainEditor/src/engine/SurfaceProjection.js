// Surface projections: rock and structure operations that act on the terrain
// surface (bedding, push-pull ruggedness, cliff steepening, roughening and
// boulder outcrops). Bedding also writes the hardness field that erosion and
// texturing read.

import { CreateSimplex, Fractal } from "./NoiseProjection.js";
import {
  Blur, SampleBilinear, SlopeDegrees, SmoothStep, Mix, Clamp01,
} from "./HeightfieldSpace.js";
import { HashUnit } from "./SeededRandom.js";
import { SampleRaster } from "./ReliefProjection.js";

const ToRadians = (Degrees) => (Degrees * Math.PI) / 180;

export const SurfaceOperations = {
  // Bedding: quantise height into beds. Hard beds form ledges, soft beds slope.
  // The dip tilts the bed frame so layers run diagonally across the map.
  Bedding: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Count = S.N * S.N;
    const Height = new Float32Array(Count);
    const Hardness = new Float32Array(Count);
    const DipRadians = ToRadians(P.Dip);
    const Direction = ToRadians(P.DipDirection);
    const DipX = Math.cos(Direction) * Math.tan(DipRadians);
    const DipY = Math.sin(Direction) * Math.tan(DipRadians);
    for (let Row = 0; Row < S.N; Row++) {
      for (let Column = 0; Column < S.N; Column++) {
        const Index = Row * S.N + Column;
        const X = Column * S.Cell;
        const Y = Row * S.Cell;
        const Wobble = P.Variation * P.Thickness * Fractal(Simplex, X / 900, Y / 900, 3);
        const Tilt = X * DipX + Y * DipY;
        // Position counts beds from the dipping frame. Soft beds reproduce the input exactly.
        const Position = (S.Height[Index] + Wobble + Tilt) / P.Thickness;
        const Bed = Math.floor(Position);
        const Within = Position - Bed;
        const IsHard = HashUnit(Bed, 11, C.Seed) < P.HardShare;
        const Profile = IsHard ? SmoothStep(0.45, 1.0, Within) * P.Ledge + Within * (1 - P.Ledge) : Within;
        const Stepped = (Bed + Profile) * P.Thickness - Tilt - Wobble;
        Height[Index] = Mix(S.Height[Index], Stepped, P.Strength);
        Hardness[Index] = IsHard ? 0.85 : 0.25;
      }
    }
    return { Height, Hardness };
  },

  // Push-pull: displace sampling along the uphill direction using blocky noise,
  // which breaks long slopes into buttresses and recesses.
  Rugged: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Slope = SlopeDegrees(S.Height, S.N, S.Cell);
    const Height = SampleRaster(S.N, (Column, Row, Index) => {
      const Xl = Math.max(0, Column - 1), Xr = Math.min(S.N - 1, Column + 1);
      const Yd = Math.max(0, Row - 1), Yu = Math.min(S.N - 1, Row + 1);
      const Dx = (S.Height[Row * S.N + Xr] - S.Height[Row * S.N + Xl]) / ((Xr - Xl) * S.Cell);
      const Dy = (S.Height[Yu * S.N + Column] - S.Height[Yd * S.N + Column]) / ((Yu - Yd) * S.Cell);
      const Length = Math.sqrt(Dx * Dx + Dy * Dy) || 1;
      const Blocky = 0.5 + 0.5 * Simplex((Column * S.Cell) / P.Scale, (Row * S.Cell) / P.Scale);
      const Weight = SmoothStep(P.SlopeThreshold, P.SlopeThreshold + 10, Slope[Index]);
      const Push = (P.Amount / S.Cell) * (Blocky * 2 - 1) * Weight;
      return SampleBilinear(S.Height, S.N, Column + (Dx / Length) * Push, Row + (Dy / Length) * Push);
    });
    return { Height };
  },

  // Cliffs: sharpen steep hard rock. Hard beds keep their faces as the soft
  // surroundings erode away.
  Cliffs: (P, S) => {
    const Slope = SlopeDegrees(S.Height, S.N, S.Cell);
    const Smoothed = Blur(S.Height, S.N, 2, 1);
    const Height = new Float32Array(S.N * S.N);
    for (let Index = 0; Index < Height.length; Index++) {
      const Steep = SmoothStep(P.Slope - 5, P.Slope + 5, Slope[Index]);
      const Rock = SmoothStep(0.4, 0.7, S.Hardness[Index]);
      Height[Index] = S.Height[Index] + P.Strength * 3 * Steep * Rock * (S.Height[Index] - Smoothed[Index]);
    }
    return { Height };
  },

  Roughen: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Slope = SlopeDegrees(S.Height, S.N, S.Cell);
    const Span = S.N - 1;
    const Height = SampleRaster(S.N, (Column, Row, Index) => {
      const Noise = Fractal(Simplex, (Column / Span) * (S.Size / P.Scale), (Row / Span) * (S.Size / P.Scale), 4);
      const SlopeWeight = 1 - P.SlopeInfluence + P.SlopeInfluence * Clamp01(Slope[Index] / 35);
      return S.Height[Index] + P.Amount * Noise * SlopeWeight;
    });
    return { Height };
  },

  // Outcrops: a jittered grid places rock bumps in a fraction of the cells.
  Outcrops: (P, S, C) => {
    const Spacing = Math.max(S.Cell, P.Spacing);
    const Radius = Math.max(S.Cell, P.Radius);
    const Height = Float32Array.from(S.Height);
    const Cells = Math.ceil(S.Size / Spacing);
    for (let Gy = 0; Gy < Cells; Gy++) {
      for (let Gx = 0; Gx < Cells; Gx++) {
        if (HashUnit(Gx, Gy, C.Seed) > P.Density) continue;
        const CentreX = (Gx + 0.2 + 0.6 * HashUnit(Gx, Gy, C.Seed + 1)) * Spacing;
        const CentreY = (Gy + 0.2 + 0.6 * HashUnit(Gx, Gy, C.Seed + 2)) * Spacing;
        const Peak = P.Height * (0.6 + 0.4 * HashUnit(Gx, Gy, C.Seed + 3));
        const Reach = Math.ceil(Radius / S.Cell);
        const Cx = Math.round(CentreX / S.Cell);
        const Cy = Math.round(CentreY / S.Cell);
        for (let Y = Math.max(0, Cy - Reach); Y <= Math.min(S.N - 1, Cy + Reach); Y++) {
          for (let X = Math.max(0, Cx - Reach); X <= Math.min(S.N - 1, Cx + Reach); X++) {
            const Distance = Math.hypot((X - Cx) * S.Cell, (Y - Cy) * S.Cell) / Radius;
            if (Distance >= 1) continue;
            Height[Y * S.N + X] += Peak * (1 - Distance) * (1 - Distance);
          }
        }
      }
    }
    return { Height };
  },
};

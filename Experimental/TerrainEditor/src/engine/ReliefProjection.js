// Relief projections: terrain generators that build height from noise and
// geometric primitives, and height modifiers that reshape the existing field.
// Every distance parameter is in metres, so a stack looks the same at any
// resolution.

import { CreateSimplex, Fractal, RidgedFractal } from "./NoiseProjection.js";
import {
  Blur, Clamp01, SampleBilinear, SlopeDegrees, SmoothStep, Mix, Normalise, MinMax,
} from "./HeightfieldSpace.js";

// Build an N x N raster from a sampler called with (column, row, index).
export function SampleRaster(N, Sampler) {
  const Out = new Float32Array(N * N);
  for (let Row = 0; Row < N; Row++) {
    for (let Column = 0; Column < N; Column++) {
      const Index = Row * N + Column;
      Out[Index] = Sampler(Column, Row, Index);
    }
  }
  return Out;
}

const ToRadians = (Degrees) => (Degrees * Math.PI) / 180;
const Radius = (Metres, Cell) => Math.max(1, Math.round(Metres / Cell));

export const GeneratorOperations = {
  Ground: (P, S) => ({ Height: SampleRaster(S.N, () => P.Height) }),

  Noise: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return {
      Height: SampleRaster(S.N, (X, Y) =>
        P.Offset + P.Amplitude * Fractal(Simplex, (X / Span) * P.Frequency, (Y / Span) * P.Frequency, P.Octaves, P.Lacunarity, P.Gain)),
    };
  },

  Ridged: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const Crest = RidgedFractal(Simplex, (X / Span) * P.Frequency, (Y / Span) * P.Frequency, P.Octaves);
        return P.Offset + P.Amplitude * Math.pow(Crest, P.Sharpness);
      }),
    };
  },

  // Elongated crests along RidgeAngle, confined to a coverage zone so ranges
  // sit between lowland, with a fine detail octave on top.
  Mountain: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Zone = CreateSimplex(C.Seed + 211);
    const Detail = CreateSimplex(C.Seed + 419);
    const Span = S.N - 1;
    const Cos = Math.cos(ToRadians(P.RidgeAngle));
    const Sin = Math.sin(ToRadians(P.RidgeAngle));
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const U = X / Span;
        const V = Y / Span;
        const Along = U * Cos + V * Sin;
        const Across = -U * Sin + V * Cos;
        const Crest = RidgedFractal(Simplex, Along * P.Frequency * 0.6, Across * P.Frequency * 2.4, P.Octaves);
        const Coverage = SmoothStep(P.Coverage - 0.12, P.Coverage + 0.12, 0.5 + 0.5 * Fractal(Zone, U * 2, V * 2, 4));
        const Ground = P.BaseGround * (0.6 + 0.4 * (0.5 + 0.5 * Fractal(Detail, U * 5, V * 5, 3)));
        return Ground + P.Amplitude * Coverage * Math.pow(Crest, P.Sharpness) + 0.03 * P.Amplitude * Fractal(Detail, U * 40, V * 40, 2);
      }),
    };
  },

  // Flat-topped mesas: noise is thresholded at Level with a soft edge.
  Plateau: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const Field = 0.5 + 0.5 * Fractal(Simplex, (X / Span) * P.Frequency, (Y / Span) * P.Frequency, P.Octaves);
        const Top = SmoothStep(P.Level - P.Edge, P.Level + P.Edge, Field);
        return P.Offset + P.Amplitude * (0.82 * Top + 0.18 * Field);
      }),
    };
  },

  Island: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const U = X / Span;
        const V = Y / Span;
        const Distance = Math.sqrt((U - 0.5) ** 2 + (V - 0.5) ** 2) / 0.5;
        const Falloff = 1 - SmoothStep(P.Radius, P.Radius + P.Softness, Distance);
        const Coast = 0.35 + 0.65 * (0.5 + 0.5 * Fractal(Simplex, U * P.Frequency, V * P.Frequency, P.Octaves));
        return P.Amplitude * Falloff * Coast + 0.3 * P.Amplitude * Math.exp(-Distance * Distance * 6) * Falloff;
      }),
    };
  },

  Volcano: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const U = X / Span;
        const V = Y / Span;
        const Distance = Math.sqrt((U - 0.5) ** 2 + (V - 0.5) ** 2);
        const Cone = P.Height * Math.pow(Math.max(0, 1 - Distance / P.Radius), 1.6);
        const Crater = P.CraterDepth * Math.exp(-((Distance / P.CraterRadius) ** 2));
        const Rough = P.Amplitude * Fractal(Simplex, U * P.Frequency, V * P.Frequency, 6);
        return Cone - Crater + Rough * Clamp01(Cone / Math.max(1, P.Height));
      }),
    };
  },

  Canyon: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const U = X / Span;
        const V = Y / Span;
        const Centre = 0.5 + P.Meander * (0.2 * Math.sin(2 * Math.PI * P.Frequency * U) + 0.08 * Math.sin(2 * Math.PI * 2.3 * P.Frequency * U + 1.3));
        const Gap = Math.abs(V - Centre);
        const Plateau = P.PlateauHeight * (0.85 + 0.15 * (0.5 + 0.5 * Fractal(Simplex, U * 3, V * 3, P.Octaves)));
        return Plateau - P.Depth * Math.exp(-((Gap / P.Width) ** 2));
      }),
    };
  },

  Dunes: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const Warp = CreateSimplex(C.Seed + 97);
    const Span = S.N - 1;
    const Cos = Math.cos(ToRadians(P.Angle));
    const Sin = Math.sin(ToRadians(P.Angle));
    return {
      Height: SampleRaster(S.N, (X, Y) => {
        const U = X / Span;
        const V = Y / Span;
        const Phase = (U * Cos + V * Sin) * P.Frequency * Math.PI * 2 + P.Warp * Fractal(Warp, U * 3, V * 3, 3);
        const Ridge = Math.pow(0.5 + 0.5 * Math.sin(Phase), 1.6);
        const Envelope = SmoothStep(0.3, 0.7, 0.5 + 0.5 * Fractal(Simplex, U * 2, V * 2, 4)) * P.Envelope + (1 - P.Envelope);
        return P.Amplitude * Ridge * Envelope;
      }),
    };
  },

  Gradient: (P, S) => {
    const Span = S.N - 1;
    const Cos = Math.cos(ToRadians(P.Angle));
    const Sin = Math.sin(ToRadians(P.Angle));
    return {
      Height: SampleRaster(S.N, (X, Y) => P.Offset + P.Amplitude * 2 * ((X / Span - 0.5) * Cos + (Y / Span - 0.5) * Sin)),
    };
  },
};

export const ModifierOperations = {
  // Domain warp: resample the field at coordinates displaced by two noise fields.
  Warp: (P, S, C) => {
    const WarpX = CreateSimplex(C.Seed + 3);
    const WarpY = CreateSimplex(C.Seed + 5);
    const Span = S.N - 1;
    const Amount = P.Amount / S.Cell;
    const Out = SampleRaster(S.N, (X, Y) => {
      const U = (X / Span) * P.Scale;
      const V = (Y / Span) * P.Scale;
      const Dx = Fractal(WarpX, U, V, 4);
      const Dy = Fractal(WarpY, U, V, 4);
      return SampleBilinear(S.Height, S.N, X + Amount * Dx, Y + Amount * Dy);
    });
    return { Height: Out };
  },

  Blur: (P, S) => ({ Height: Blur(S.Height, S.N, Radius(P.Radius, S.Cell), P.Passes) }),

  SlopeBlur: (P, S) => {
    const Slope = SlopeDegrees(S.Height, S.N, S.Cell);
    const Smoothed = Blur(S.Height, S.N, Radius(P.Radius, S.Cell), 1);
    const Out = new Float32Array(S.N * S.N);
    for (let Index = 0; Index < Out.length; Index++) {
      const Weight = SmoothStep(P.SlopeStart, P.SlopeStart + P.SlopeSpan, Slope[Index]);
      Out[Index] = Mix(S.Height[Index], Smoothed[Index], Weight);
    }
    return { Height: Out };
  },

  // Terraces: each step rises late in its interval, leaving flat benches.
  Terrace: (P, S) => {
    const Out = new Float32Array(S.N * S.N);
    const Step = Math.max(1, P.Step);
    for (let Index = 0; Index < Out.length; Index++) {
      const Position = S.Height[Index] / Step;
      const Whole = Math.floor(Position);
      const Fraction = Position - Whole;
      const Stepped = (Whole + Math.pow(Fraction, P.Sharpness)) * Step;
      Out[Index] = Mix(S.Height[Index], Stepped, P.Strength);
    }
    return { Height: Out };
  },

  Curve: (P, S) => {
    const { Min, Max } = MinMax(S.Height);
    const Span = Max - Min || 1;
    const Out = new Float32Array(S.N * S.N);
    for (let Index = 0; Index < Out.length; Index++) {
      const Unit = Clamp01((S.Height[Index] - Min) / Span);
      const Powered = Math.pow(Unit, P.Power);
      Out[Index] = Min + Mix(Powered, SmoothStep(0, 1, Powered), P.Contrast) * Span;
    }
    return { Height: Out };
  },

  Clamp: (P, S) => ({ Height: S.Height.map((Here) => Math.min(P.Maximum, Math.max(P.Minimum, Here))) }),

  Autolevel: (P, S) => {
    const Unit = Normalise(S.Height);
    return { Height: Unit.map((Here) => P.Low + Here * (P.High - P.Low)) };
  },

  Sharpen: (P, S) => {
    const Smoothed = Blur(S.Height, S.N, Radius(P.Radius, S.Cell), 1);
    return { Height: S.Height.map((Here, Index) => Here + P.Amount * (Here - Smoothed[Index])) };
  },

  ClipPeaks: (P, S) => ({ Height: S.Height.map((Here) => Math.min(P.Cap, Here)) }),
};

export { Normalise };

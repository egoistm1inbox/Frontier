// Texture projections: the texturing stack. Generators (Speckle, Altitude tint,
// Bedding colour, Rock, Soil, Alluvium, Gravel, Vegetation, Snow) return a new
// sRGB colour raster. Modifiers (Wetness, Cavity, Hue shift) reshape the colour
// already built below them. Colours are 0..1 floats, RGB interleaved.

import { CreateSimplex, Fractal } from "./NoiseProjection.js";
import { Clamp01, Mix, SmoothStep } from "./HeightfieldSpace.js";
import { DerivedField } from "./MaskClassifier.js";
import { HashUnit } from "./SeededRandom.js";

export function ParseColour(Text) {
  const Hex = Text.replace("#", "");
  return [0, 2, 4].map((Offset) => parseInt(Hex.slice(Offset, Offset + 2), 16) / 255);
}

// Build a colour raster from a sampler called with (index, column, row).
function ColourRaster(N, Sampler) {
  const Out = new Float32Array(N * N * 3);
  for (let Row = 0; Row < N; Row++) {
    for (let Column = 0; Column < N; Column++) {
      const Index = Row * N + Column;
      const Colour = Sampler(Index, Column, Row);
      Out[Index * 3] = Colour[0];
      Out[Index * 3 + 1] = Colour[1];
      Out[Index * 3 + 2] = Colour[2];
    }
  }
  return Out;
}

function Scale(Colour, Factor) {
  return [Clamp01(Colour[0] * Factor), Clamp01(Colour[1] * Factor), Clamp01(Colour[2] * Factor)];
}

function Tint(Base, Fine, Variation) {
  return Scale(Base, 1 + Variation * (Fine - 0.5) * 0.8);
}

function Rgb(Source, Index) {
  return [Source[Index * 3], Source[Index * 3 + 1], Source[Index * 3 + 2]];
}

// RGB to HSL and back, used by the hue shift modifier.
function RgbToHsl([R, G, B]) {
  const Max = Math.max(R, G, B), Min = Math.min(R, G, B);
  const Lightness = (Max + Min) / 2;
  if (Max === Min) return [0, 0, Lightness];
  const Span = Max - Min;
  const Saturation = Lightness > 0.5 ? Span / (2 - Max - Min) : Span / (Max + Min);
  let Hue;
  if (Max === R) Hue = (G - B) / Span + (G < B ? 6 : 0);
  else if (Max === G) Hue = (B - R) / Span + 2;
  else Hue = (R - G) / Span + 4;
  return [Hue / 6, Saturation, Lightness];
}

function HslToRgb([Hue, Saturation, Lightness]) {
  if (Saturation === 0) return [Lightness, Lightness, Lightness];
  const Q = Lightness < 0.5 ? Lightness * (1 + Saturation) : Lightness + Saturation - Lightness * Saturation;
  const P = 2 * Lightness - Q;
  const Channel = (T) => {
    let Wrapped = T < 0 ? T + 1 : T > 1 ? T - 1 : T;
    if (Wrapped < 1 / 6) return P + (Q - P) * 6 * Wrapped;
    if (Wrapped < 1 / 2) return Q;
    if (Wrapped < 2 / 3) return P + (Q - P) * (2 / 3 - Wrapped) * 6;
    return P;
  };
  return [Channel(Hue + 1 / 3), Channel(Hue), Channel(Hue - 1 / 3)];
}

export const TextureOperations = {
  Fill: (P, S) => ColourRaster(S.N, () => ParseColour(P.Colour)),

  Speckle: (P, S, C) => {
    const Simplex = CreateSimplex(C.Seed);
    const A = ParseColour(P.ColourA), B = ParseColour(P.ColourB);
    const Scaled = S.Size / P.Scale;
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => {
      const Field = Fractal(Simplex, (Column / Span) * Scaled, (Row / Span) * Scaled, 4);
      const T = Clamp01(0.5 + 0.5 * Field * (1 + P.Contrast));
      return [0, 1, 2].map((Channel) => Mix(A[Channel], B[Channel], T));
    });
  },

  AltitudeTint: (P, S) => {
    const Altitude = DerivedField(S, "Altitude");
    const Low = ParseColour(P.Low), Middle = ParseColour(P.Middle), High = ParseColour(P.High);
    return ColourRaster(S.N, (Index) => {
      const T = Altitude[Index];
      const Lower = T < P.Balance ? Low : Middle;
      const Upper = T < P.Balance ? Middle : High;
      const Local = T < P.Balance ? (P.Balance > 0 ? T / P.Balance : 1) : (1 - P.Balance > 0 ? (T - P.Balance) / (1 - P.Balance) : 1);
      return [0, 1, 2].map((Channel) => Mix(Lower[Channel], Upper[Channel], SmoothStep(0, 1, Clamp01(Local))));
    });
  },

  BeddingColour: (P, S, C) => {
    const Hard = ParseColour(P.HardColour), Soft = ParseColour(P.SoftColour);
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => {
      const Fine = 0.5 + 0.5 * Fractal(Simplex, (Column / Span) * 90, (Row / Span) * 90, 3);
      const Mixing = S.Hardness[Index];
      return [0, 1, 2].map((Channel) => Mix(Soft[Channel], Hard[Channel], Mixing) * (1 + P.Variation * (Fine - 0.5) * 0.5));
    });
  },

  Rock: (P, S, C) => {
    const Base = ParseColour(P.Colour);
    const Simplex = CreateSimplex(C.Seed);
    const Cavity = DerivedField(S, "Cavity");
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => {
      const Fine = 0.5 + 0.5 * Fractal(Simplex, (Column / Span) * 140, (Row / Span) * 140, 4);
      const Shade = (1 - P.Cavity * 0.6 * Cavity[Index]) * (1 + P.Variation * (Fine - 0.5) * 0.9);
      return Scale(Base, Shade);
    });
  },

  Soil: (P, S, C) => {
    const Base = ParseColour(P.Colour);
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => Tint(Base, 0.5 + 0.5 * Fractal(Simplex, (Column / Span) * 60, (Row / Span) * 60, 4), P.Variation));
  },

  Alluvium: (P, S, C) => {
    const Base = ParseColour(P.Colour);
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => Tint(Base, 0.5 + 0.5 * Fractal(Simplex, (Column / Span) * 45, (Row / Span) * 45, 3), P.Variation));
  },

  Gravel: (P, S, C) => {
    const Base = ParseColour(P.Colour);
    return ColourRaster(S.N, (Index, Column, Row) => {
      const Stone = HashUnit(Column, Row, C.Seed);
      return Tint(Base, 0.35 + 0.65 * Stone, P.Variation);
    });
  },

  Vegetation: (P, S, C) => {
    const Base = ParseColour(P.Colour);
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => Tint(Base, 0.5 + 0.5 * Fractal(Simplex, (Column / Span) * 110, (Row / Span) * 110, 4), P.Variation));
  },

  Snow: (P, S, C) => {
    const Base = ParseColour(P.Colour);
    const Simplex = CreateSimplex(C.Seed);
    const Span = S.N - 1;
    return ColourRaster(S.N, (Index, Column, Row) => Tint(Base, 0.5 + 0.5 * Fractal(Simplex, (Column / Span) * 80, (Row / Span) * 80, 3), P.Variation));
  },

  // Modifiers: take the colour built below and return the adjusted colour.
  Wetness: (P, S, C, Previous) => {
    const Distance = DerivedField(S, "Distance");
    return ColourRaster(S.N, (Index) => {
      const Wet = Math.exp(-Distance[Index] / Math.max(1, P.Radius));
      return Scale(Rgb(Previous, Index), 1 - P.Darkening * Wet);
    });
  },

  Cavity: (P, S, C, Previous) => {
    const Cavity = DerivedField(S, "Cavity");
    return ColourRaster(S.N, (Index) => Scale(Rgb(Previous, Index), 1 - P.Strength * Cavity[Index] * 0.7));
  },

  HueShift: (P, S, C, Previous) => ColourRaster(S.N, (Index) => {
    const [Hue, Saturation, Lightness] = RgbToHsl(Rgb(Previous, Index));
    const Shifted = (Hue + P.Hue / 360 + 1) % 1;
    const Adjusted = [Shifted, Clamp01(Saturation * (1 + P.Saturation)), Clamp01(Lightness + P.Lightness * 0.5)];
    return HslToRgb(Adjusted);
  }),
};

export const TextureModifierNames = new Set(["Wetness", "Cavity", "HueShift"]);

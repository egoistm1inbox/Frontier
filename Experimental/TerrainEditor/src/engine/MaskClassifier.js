// Mask classifier: Gaea-style masks. Each mask measures one property of the
// surface (steepness, altitude, curvature, aspect, drainage, wetness, cavity,
// ridge, noise, hardness, sediment), maps it through Low / High / Softness,
// optionally inverts it, and combines it with the masks above it.

import { AnalyseDrainage } from "./DrainageSolver.js";
import {
  AspectRadians, BoxBlur, Clamp01, Curvature, Mix, Normalise, SlopeDegrees, SmoothStep, MinMax,
} from "./HeightfieldSpace.js";
import { NearestSeedField } from "./WaterStructure.js";
import { CreateSimplex, Fractal } from "./NoiseProjection.js";

// Derived fields are computed once per surface and shared by every mask and texture layer.
export function DerivedField(Surface, Name) {
  if (Surface.Derived[Name]) return Surface.Derived[Name];
  const { N, Cell, Height } = Surface;
  let Field;
  switch (Name) {
    case "Slope":
      Field = SlopeDegrees(Height, N, Cell);
      break;
    case "Aspect":
      Field = AspectRadians(Height, N, Cell);
      break;
    case "Curvature":
      Field = Normalise(Curvature(Height, N, Cell));
      break;
    case "Altitude": {
      const { Min, Max } = MinMax(Height);
      const Span = Max - Min || 1;
      Field = Height.map((Here) => Clamp01((Here - Min) / Span));
      break;
    }
    case "Drainage": {
      const { Area } = AnalyseDrainage(Height, N, Cell, 1, 0.02);
      Field = Normalise(Area.map((Here) => Math.log(Here + 1)));
      break;
    }
    case "Distance": {
      const Seeds = Uint8Array.from(Surface.Water.Source, (Source) => (Source > 0 ? 1 : 0));
      const Nearest = NearestSeedField(Seeds, N, Cell);
      Field = Float32Array.from(Nearest.Distance, (Here) => (Number.isFinite(Here) ? Here : 1e6));
      break;
    }
    case "Cavity":
      Field = Normalise(Float32Array.from(BoxBlur(Height, N, 4), (Here, Index) => Here - Height[Index]));
      break;
    case "Ridge":
      Field = Normalise(Float32Array.from(BoxBlur(Height, N, 4), (Here, Index) => Height[Index] - Here));
      break;
    case "Hardness":
      Field = Surface.Hardness;
      break;
    case "Sediment":
      Field = Surface.Sediment;
      break;
    default:
      Field = new Float32Array(N * N);
  }
  Surface.Derived[Name] = Field;
  return Field;
}

// Raw measurement for one mask method, before the Low / High window is applied.
function MeasureMethod(Mask, Surface, Context) {
  const { N, Cell } = Surface;
  const Count = N * N;
  const Params = Mask.Parameters;
  switch (Mask.Method) {
    case "Steepness": {
      const Slope = DerivedField(Surface, "Slope");
      return Float32Array.from(Slope, (Degrees) => Clamp01(Degrees / 60));
    }
    case "Altitude":
      return DerivedField(Surface, "Altitude");
    case "Curvature":
      return DerivedField(Surface, "Curvature");
    case "Aspect": {
      const Aspect = DerivedField(Surface, "Aspect");
      const Azimuth = (Params.Azimuth * Math.PI) / 180;
      return Float32Array.from(Aspect, (Radians) => 0.5 + 0.5 * Math.cos(Radians - Azimuth));
    }
    case "Drainage":
      return DerivedField(Surface, "Drainage");
    case "Wetness": {
      const Distance = DerivedField(Surface, "Distance");
      return Float32Array.from(Distance, (Metres) => Math.exp(-Metres / Math.max(1, Params.Radius)));
    }
    case "Cavity":
    case "Ridge": {
      // Cavity is positive in hollows (blur above ground); Ridge is positive on crests.
      const Cells = Math.max(1, Math.round(Params.Radius / Cell));
      const Smoothed = BoxBlur(Surface.Height, N, Cells);
      const Sign = Mask.Method === "Cavity" ? 1 : -1;
      return Normalise(Float32Array.from(Smoothed, (Here, Index) => Sign * (Here - Surface.Height[Index])));
    }
    case "Hardness":
      return DerivedField(Surface, "Hardness");
    case "Sediment":
      return DerivedField(Surface, "Sediment");
    case "Noise": {
      const Simplex = CreateSimplex(Mask.Seed + (Context.Seed | 0));
      const Out = new Float32Array(Count);
      for (let Row = 0; Row < N; Row++) {
        for (let Column = 0; Column < N; Column++) {
          const Index = Row * N + Column;
          const X = (Column * Cell) / Params.Scale;
          const Y = (Row * Cell) / Params.Scale;
          Out[Index] = 0.5 + 0.5 * Fractal(Simplex, X, Y, Params.Octaves);
        }
      }
      return Out;
    }
    default:
      return new Float32Array(Count).fill(1);
  }
}

// Low / High window with Softness at both edges, then optional inversion.
export function WindowMask(Raw, Mask) {
  const Low = Mask.Parameters.Low;
  const High = Mask.Parameters.High;
  const Soft = Mask.Parameters.Softness;
  const Out = new Float32Array(Raw.length);
  for (let Index = 0; Index < Raw.length; Index++) {
    const Inside = SmoothStep(Low - Soft, Low + Soft, Raw[Index]) * (1 - SmoothStep(High - Soft, High + Soft, Raw[Index]));
    Out[Index] = Mask.Invert ? 1 - Inside : Inside;
  }
  return Out;
}

// Identity value of a combine mode: where an opacity-scaled mask is neutral.
export function MaskIdentity(Combine) {
  return Combine === "Multiply" || Combine === "Min" ? 1 : 0;
}

export function CombineMaskValue(Combine, Current, Incoming) {
  switch (Combine) {
    case "Add": return Math.min(1, Current + Incoming);
    case "Subtract": return Math.max(0, Current - Incoming);
    case "Max": return Math.max(Current, Incoming);
    case "Min": return Math.min(Current, Incoming);
    default: return Current * Incoming;
  }
}

// Combines the masks of one layer into a single 0..1 weight per cell.
// Returns null when the layer has no enabled masks, meaning full weight everywhere.
export function CombineMasks(Masks, Surface, Context) {
  const Enabled = (Masks || []).filter((Mask) => Mask.Enabled !== false);
  if (Enabled.length === 0) return null;
  const Count = Surface.N * Surface.N;
  const Result = new Float32Array(Count).fill(MaskIdentity(Enabled[0].Combine));
  for (const Mask of Enabled) {
    const Window = WindowMask(MeasureMethod(Mask, Surface, Context), Mask);
    const Identity = MaskIdentity(Mask.Combine);
    for (let Index = 0; Index < Count; Index++) {
      const Scaled = Mix(Identity, Window[Index], Mask.Opacity);
      Result[Index] = CombineMaskValue(Mask.Combine, Result[Index], Scaled);
    }
  }
  return Result;
}

// Single mask preview for the viewport (used when a mask is isolated).
export function PreviewMask(Mask, Surface, Context) {
  return WindowMask(MeasureMethod(Mask, Surface, Context), Mask);
}

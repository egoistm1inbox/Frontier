// Heightfield space: the raster that every layer reads and writes. A surface
// is a square of N x N cells that spans Size metres, so Cell = Size / (N - 1).
// Water is stored as a source code per cell plus a surface level.

export const WaterSource = Object.freeze({ None: 0, River: 1, Lake: 2, Sea: 3 });

export function CreateSurface(Heightfield) {
  const N = Heightfield.Resolution;
  const Count = N * N;
  const Surface = {
    N,
    Size: Heightfield.Size,
    Cell: Heightfield.Size / (N - 1),
    Height: new Float32Array(Count),
    Hardness: new Float32Array(Count).fill(0.5),
    Sediment: new Float32Array(Count),
    Water: { Source: new Uint8Array(Count), Level: new Float32Array(Count) },
    Derived: {},
  };
  return Surface;
}

export function CloneSurface(Surface) {
  return {
    N: Surface.N,
    Size: Surface.Size,
    Cell: Surface.Cell,
    Height: Float32Array.from(Surface.Height),
    Hardness: Float32Array.from(Surface.Hardness),
    Sediment: Float32Array.from(Surface.Sediment),
    Water: {
      Source: Uint8Array.from(Surface.Water.Source),
      Level: Float32Array.from(Surface.Water.Level),
    },
    Derived: {},
  };
}

export function Clamp01(Value) {
  return Value < 0 ? 0 : Value > 1 ? 1 : Value;
}

export function SmoothStep(Edge0, Edge1, Position) {
  if (Edge0 === Edge1) return Position < Edge0 ? 0 : 1;
  const T = Clamp01((Position - Edge0) / (Edge1 - Edge0));
  return T * T * (3 - 2 * T);
}

export function Mix(From, To, Amount) {
  return From + (To - From) * Amount;
}

// Separable box blur with clamped edges, computed with running sums.
export function BoxBlur(Source, N, Radius) {
  const R = Math.max(0, Math.round(Radius));
  if (R === 0) return Float32Array.from(Source);
  const Temp = new Float32Array(N * N);
  const Out = new Float32Array(N * N);
  const Span = 2 * R + 1;
  for (let Y = 0; Y < N; Y++) {
    let Sum = 0;
    for (let X = -R; X <= R; X++) Sum += Source[Y * N + Math.min(N - 1, Math.max(0, X))];
    for (let X = 0; X < N; X++) {
      Temp[Y * N + X] = Sum / Span;
      Sum += Source[Y * N + Math.min(N - 1, X + R + 1)] - Source[Y * N + Math.max(0, X - R)];
    }
  }
  for (let X = 0; X < N; X++) {
    let Sum = 0;
    for (let Y = -R; Y <= R; Y++) Sum += Temp[Math.min(N - 1, Math.max(0, Y)) * N + X];
    for (let Y = 0; Y < N; Y++) {
      Out[Y * N + X] = Sum / Span;
      Sum += Temp[Math.min(N - 1, Y + R + 1) * N + X] - Temp[Math.max(0, Y - R) * N + X];
    }
  }
  return Out;
}

export function Blur(Source, N, Radius, Passes = 1) {
  let Current = Source;
  for (let Pass = 0; Pass < Passes; Pass++) Current = BoxBlur(Current, N, Radius);
  return Current === Source ? Float32Array.from(Source) : Current;
}

// Slope in degrees from central differences.
export function SlopeDegrees(Height, N, Cell) {
  const Out = new Float32Array(N * N);
  for (let Y = 0; Y < N; Y++) {
    for (let X = 0; X < N; X++) {
      const Xl = Math.max(0, X - 1), Xr = Math.min(N - 1, X + 1);
      const Yd = Math.max(0, Y - 1), Yu = Math.min(N - 1, Y + 1);
      const Dx = (Height[Y * N + Xr] - Height[Y * N + Xl]) / ((Xr - Xl) * Cell);
      const Dy = (Height[Yu * N + X] - Height[Yd * N + X]) / ((Yu - Yd) * Cell);
      Out[Y * N + X] = (Math.atan(Math.sqrt(Dx * Dx + Dy * Dy)) * 180) / Math.PI;
    }
  }
  return Out;
}

// Downslope aspect in radians, measured from +X toward +Y.
export function AspectRadians(Height, N, Cell) {
  const Out = new Float32Array(N * N);
  for (let Y = 0; Y < N; Y++) {
    for (let X = 0; X < N; X++) {
      const Xl = Math.max(0, X - 1), Xr = Math.min(N - 1, X + 1);
      const Yd = Math.max(0, Y - 1), Yu = Math.min(N - 1, Y + 1);
      const Dx = (Height[Y * N + Xr] - Height[Y * N + Xl]) / ((Xr - Xl) * Cell);
      const Dy = (Height[Yu * N + X] - Height[Yd * N + X]) / ((Yu - Yd) * Cell);
      Out[Y * N + X] = Math.atan2(-Dy, -Dx);
    }
  }
  return Out;
}

// Discrete Laplacian per metre squared: positive on crests, negative in hollows.
export function Curvature(Height, N, Cell) {
  const Out = new Float32Array(N * N);
  const Inverse = 1 / (Cell * Cell);
  for (let Y = 0; Y < N; Y++) {
    for (let X = 0; X < N; X++) {
      const Xl = Math.max(0, X - 1), Xr = Math.min(N - 1, X + 1);
      const Yd = Math.max(0, Y - 1), Yu = Math.min(N - 1, Y + 1);
      const Here = Height[Y * N + X];
      const Sum = Height[Y * N + Xl] + Height[Y * N + Xr] + Height[Yd * N + X] + Height[Yu * N + X];
      Out[Y * N + X] = (Sum - 4 * Here) * Inverse;
    }
  }
  return Out;
}

// Value at the given percentile (0..1) of a field, estimated from a strided sample.
export function Percentile(Source, Fraction) {
  const Stride = Math.max(1, Math.floor(Source.length / 20000));
  const Sample = [];
  for (let Index = 0; Index < Source.length; Index += Stride) Sample.push(Source[Index]);
  Sample.sort((A, B) => A - B);
  const Position = Math.min(Sample.length - 1, Math.max(0, Math.round(Fraction * (Sample.length - 1))));
  return Sample[Position];
}

// Robust 0..1 normalisation between the 0.5 and 99.5 percentiles.
export function Normalise(Source, Low = 0.005, High = 0.995) {
  const Min = Percentile(Source, Low);
  const Max = Percentile(Source, High);
  const Out = new Float32Array(Source.length);
  const Span = Max - Min || 1;
  for (let Index = 0; Index < Source.length; Index++) Out[Index] = Clamp01((Source[Index] - Min) / Span);
  return Out;
}

// Bilinear sample at fractional cell coordinates (clamped to the raster).
export function SampleBilinear(Source, N, X, Y) {
  const Xc = Math.min(N - 1.001, Math.max(0, X));
  const Yc = Math.min(N - 1.001, Math.max(0, Y));
  const X0 = Math.floor(Xc);
  const Y0 = Math.floor(Yc);
  const Fx = Xc - X0;
  const Fy = Yc - Y0;
  const Top = Source[Y0 * N + X0] * (1 - Fx) + Source[Y0 * N + X0 + 1] * Fx;
  const Bottom = Source[(Y0 + 1) * N + X0] * (1 - Fx) + Source[(Y0 + 1) * N + X0 + 1] * Fx;
  return Top * (1 - Fy) + Bottom * Fy;
}

export function MinMax(Source) {
  let Min = Infinity;
  let Max = -Infinity;
  for (let Index = 0; Index < Source.length; Index++) {
    const Here = Source[Index];
    if (Here < Min) Min = Here;
    if (Here > Max) Max = Here;
  }
  return { Min, Max };
}

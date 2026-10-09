// Erosion integrators: thermal talus relaxation, hydraulic droplet erosion
// and stream-power incision. Each returns new arrays and never mutates input.

import { AnalyseDrainage } from "./DrainageSolver.js";
import { CreateRandom } from "./SeededRandom.js";
import { SampleBilinear, Normalise, Clamp01 } from "./HeightfieldSpace.js";

// Material slides from a cell to lower 4-neighbours when the drop exceeds the
// talus limit. Harder rock holds a steeper slope.
export function ThermalErosion(Height, Hardness, N, Cell, Options) {
  const Out = Float32Array.from(Height);
  const Delta = new Float32Array(N * N);
  const TanTalus = Math.tan((Options.Talus * Math.PI) / 180);
  for (let Iteration = 0; Iteration < Options.Iterations; Iteration++) {
    Delta.fill(0);
    for (let Y = 1; Y < N - 1; Y++) {
      for (let X = 1; X < N - 1; X++) {
        const Here = Y * N + X;
        const Limit = TanTalus * Cell * (0.6 + 0.8 * Hardness[Here]);
        const Around = [Here - 1, Here + 1, Here - N, Here + N];
        let Total = 0;
        const Moves = [0, 0, 0, 0];
        for (let Slot = 0; Slot < 4; Slot++) {
          const Excess = Out[Here] - Out[Around[Slot]] - Limit;
          if (Excess > 0) {
            Moves[Slot] = Excess * 0.5 * Options.Rate;
            Total += Moves[Slot];
          }
        }
        if (Total > 0) {
          Delta[Here] -= Total;
          for (let Slot = 0; Slot < 4; Slot++) Delta[Around[Slot]] += Moves[Slot];
        }
      }
    }
    for (let Index = 0; Index < Out.length; Index++) Out[Index] += Delta[Index];
  }
  return { Height: Out };
}

// Droplet erosion: each droplet rolls downhill, picks up sediment while it is
// faster than it can carry, and drops it where it slows. Deposits are returned
// as a 0..1 field that the texture layers read as alluvium.
export function HydraulicErosion(Height, Hardness, N, Cell, Options, Seed) {
  const Out = Float32Array.from(Height);
  const Deposit = new Float32Array(N * N);
  const NextUnit = CreateRandom(Seed);
  const Droplets = Math.round(Options.Droplets * ((N * N) / 65536));
  const Limit = N - 2;
  const Splat = (X, Y, Amount, Target) => {
    const Xi = Math.floor(X), Yi = Math.floor(Y);
    const Fx = X - Xi, Fy = Y - Yi;
    const Weights = [(1 - Fx) * (1 - Fy), Fx * (1 - Fy), (1 - Fx) * Fy, Fx * Fy];
    const Cells = [Yi * N + Xi, Yi * N + Xi + 1, (Yi + 1) * N + Xi, (Yi + 1) * N + Xi + 1];
    for (let Slot = 0; Slot < 4; Slot++) {
      if (Target === Out) Out[Cells[Slot]] += Amount * Weights[Slot];
      else Target[Cells[Slot]] += Amount * Weights[Slot];
    }
  };
  for (let Drop = 0; Drop < Droplets; Drop++) {
    let X = 1 + NextUnit() * (N - 3);
    let Y = 1 + NextUnit() * (N - 3);
    let Dx = 0, Dy = 0, Speed = 1, Water = 1, Carried = 0;
    for (let Step = 0; Step < Options.MaxSteps; Step++) {
      const Xi = Math.floor(X), Yi = Math.floor(Y);
      const Fx = X - Xi, Fy = Y - Yi;
      const Index = Yi * N + Xi;
      const H00 = Out[Index], H10 = Out[Index + 1], H01 = Out[Index + N], H11 = Out[Index + N + 1];
      const GradX = (H10 - H00) * (1 - Fy) + (H11 - H01) * Fy;
      const GradY = (H01 - H00) * (1 - Fx) + (H11 - H10) * Fx;
      Dx = Dx * Options.Inertia - GradX * (1 - Options.Inertia);
      Dy = Dy * Options.Inertia - GradY * (1 - Options.Inertia);
      const Length = Math.sqrt(Dx * Dx + Dy * Dy);
      if (Length < 1e-6) {
        const Angle = NextUnit() * Math.PI * 2;
        Dx = Math.cos(Angle);
        Dy = Math.sin(Angle);
      } else {
        Dx /= Length;
        Dy /= Length;
      }
      const NextX = X + Dx;
      const NextY = Y + Dy;
      if (NextX < 1 || NextY < 1 || NextX >= Limit || NextY >= Limit) break;
      const HeightHere = SampleBilinear(Out, N, X, Y);
      const HeightNext = SampleBilinear(Out, N, NextX, NextY);
      const Change = HeightNext - HeightHere;
      const Capacity = Math.max(-Change, 0.01 * Cell) * Speed * Water * Options.Capacity;
      const Resist = 1 - 0.7 * SampleBilinear(Hardness, N, X, Y);
      if (Carried > Capacity || Change >= 0) {
        const Amount = Change > 0 ? Math.min(Change, Carried) : (Carried - Capacity) * Options.Deposition;
        Carried -= Amount;
        Splat(X, Y, Amount, Out);
        Splat(X, Y, Amount, Deposit);
      } else {
        const Amount = Math.min((Capacity - Carried) * Options.Erosion * Resist, -Change);
        Carried += Amount;
        Splat(X, Y, -Amount, Out);
      }
      Speed = Math.sqrt(Math.max(0, Speed * Speed + Change * Options.Gravity));
      Water *= 1 - Options.Evaporation;
      X = NextX;
      Y = NextY;
      if (Water < 0.01) break;
    }
  }
  return { Height: Out, Deposit: Normalise(Deposit, 0, 0.99) };
}

// Stream-power incision: E = K * A^m * S^n with hardness resistance. Each
// iteration uses fresh drainage so valleys follow the current routing.
export function StreamPowerErosion(Height, Hardness, N, Cell, Options, Seed) {
  let Current = Float32Array.from(Height);
  const Sediment = new Float32Array(N * N);
  for (let Iteration = 0; Iteration < Options.Iterations; Iteration++) {
    const { Direction, Area } = AnalyseDrainage(Current, N, Cell, Seed + Iteration);
    const Incision = new Float32Array(N * N);
    const Slope = new Float32Array(N * N);
    let Peak = 1e-9;
    for (let Index = 0; Index < N * N; Index++) {
      const Downslope = Direction[Index];
      if (Downslope < 0) continue;
      const Length = Math.abs(Downslope - Index) === 1 || Math.abs(Downslope - Index) === N ? Cell : Cell * Math.SQRT2;
      const Drop = Math.max(0, Current[Index] - Current[Downslope]);
      const Gradient = Drop / Length;
      Slope[Index] = Gradient;
      const Power = Options.Coefficient * Math.pow(Area[Index], Options.AreaExponent) * Math.pow(Gradient, Options.SlopeExponent);
      Incision[Index] = Power * (1 - Options.Resistance * Hardness[Index]);
      if (Incision[Index] > Peak) Peak = Incision[Index];
    }
    const Scale = Math.min(1, 1.5 / Peak);
    const Next = Float32Array.from(Current);
    for (let Index = 0; Index < N * N; Index++) {
      const Downslope = Direction[Index];
      if (Downslope < 0) continue;
      const Cut = Incision[Index] * Scale;
      Next[Index] = Math.max(Current[Downslope], Current[Index] - Cut);
      const Gentle = 1 - Clamp01(Slope[Index] / 0.05);
      Sediment[Index] += Cut * Gentle;
    }
    Current = Next;
  }
  return { Height: Current, Deposit: Normalise(Sediment, 0, 0.99) };
}

// Uniform operation table used by the layer sequence.
export const ErosionOperations = {
  Thermal: (P, S) => ({
    Height: ThermalErosion(S.Height, S.Hardness, S.N, S.Cell, { Iterations: P.Iterations, Talus: P.Talus, Rate: P.Rate }).Height,
  }),
  Hydraulic: (P, S, C) => {
    const Result = HydraulicErosion(S.Height, S.Hardness, S.N, S.Cell, {
      Droplets: P.Droplets, Erosion: P.Erosion, Deposition: P.Deposition, Capacity: P.Capacity,
      Inertia: P.Inertia, Evaporation: P.Evaporation, Gravity: P.Gravity, MaxSteps: P.Lifetime,
    }, C.Seed);
    return { Height: Result.Height, Sediment: Result.Deposit };
  },
  StreamPower: (P, S, C) => {
    const Result = StreamPowerErosion(S.Height, S.Hardness, S.N, S.Cell, {
      Iterations: P.Iterations, Coefficient: P.Coefficient, AreaExponent: P.AreaExponent,
      SlopeExponent: P.SlopeExponent, Resistance: P.Resistance,
    }, C.Seed);
    return { Height: Result.Height, Sediment: Result.Deposit };
  },
};

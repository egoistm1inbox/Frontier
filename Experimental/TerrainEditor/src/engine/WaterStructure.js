// Water structures: rivers, lakes and sea.
//
// Rivers are carved into the ground, not painted onto it. The network is
// routed on the depression-filled surface, each channel cell gets a width and
// depth from its catchment area, and the bed is cut down to a monotone
// downstream water level. Cross-sections rise to bank crests and blend back
// into the original ground across the valley reach. Water exists only where a
// carved channel or basin holds it, so dry land never tints blue.

import { AnalyseDrainage } from "./DrainageSolver.js";
import { WaterSource, SmoothStep, Percentile } from "./HeightfieldSpace.js";

// Chamfer distance (metres) to the nearest seed cell, propagating the seed index.
export function NearestSeedField(Seeds, N, Cell) {
  const Count = N * N;
  const SeedIndex = new Int32Array(Count).fill(-1);
  const Distance = new Float32Array(Count).fill(Infinity);
  for (let Index = 0; Index < Count; Index++) {
    if (Seeds[Index]) {
      SeedIndex[Index] = Index;
      Distance[Index] = 0;
    }
  }
  const Relax = (Here, Neighbour, Weight) => {
    if (SeedIndex[Neighbour] < 0) return;
    const Candidate = Distance[Neighbour] + Weight * Cell;
    if (Candidate < Distance[Here]) {
      Distance[Here] = Candidate;
      SeedIndex[Here] = SeedIndex[Neighbour];
    }
  };
  for (let Y = 0; Y < N; Y++) {
    for (let X = 0; X < N; X++) {
      const Here = Y * N + X;
      if (X > 0) Relax(Here, Here - 1, 1);
      if (Y > 0) Relax(Here, Here - N, 1);
      if (X > 0 && Y > 0) Relax(Here, Here - N - 1, Math.SQRT2);
      if (X < N - 1 && Y > 0) Relax(Here, Here - N + 1, Math.SQRT2);
    }
  }
  for (let Y = N - 1; Y >= 0; Y--) {
    for (let X = N - 1; X >= 0; X--) {
      const Here = Y * N + X;
      if (X < N - 1) Relax(Here, Here + 1, 1);
      if (Y < N - 1) Relax(Here, Here + N, 1);
      if (X < N - 1 && Y < N - 1) Relax(Here, Here + N + 1, Math.SQRT2);
      if (X > 0 && Y < N - 1) Relax(Here, Here + N - 1, Math.SQRT2);
    }
  }
  return { SeedIndex, Distance };
}

// Parameter keys: Headwaters (% of cells carrying channels), Width (m), Depth (m),
// Downcutting (0..1), RiverValleyWidth (-4..4), Seed. Mask (optional) confines
// channel heads to cells where the layer mask is at least 0.5.
export function CarveRivers(Params, Surface, Context) {
  const N = Surface.N;
  const Cell = Surface.Cell;
  const Count = N * N;
  const Analysis = AnalyseDrainage(Surface.Height, N, Cell, Context.Seed + Params.Seed, 0.02);
  const { Filled, Order, Area, Direction } = Analysis;
  const Share = Math.max(0.5, Params.Headwaters) / 100;
  const Threshold = Percentile(Area, 1 - Share);
  let AreaPeak = 1;
  for (let Index = 0; Index < Count; Index++) if (Area[Index] > AreaPeak) AreaPeak = Area[Index];
  const Channel = new Uint8Array(Count);
  const HalfWidth = new Float32Array(Count);
  const Depth = new Float32Array(Count);
  const Level = new Float32Array(Count);
  for (let Index = 0; Index < Count; Index++) {
    if (Area[Index] < Threshold) continue;
    if (Context.Mask && Context.Mask[Index] < 0.5) continue;
    const Relative = Area[Index] / AreaPeak;
    const Width = Params.Width * (0.35 + 0.65 * Math.sqrt(Relative));
    const ChannelDepth = Params.Depth * (0.3 + 0.7 * Math.pow(Relative, 0.4));
    Channel[Index] = 1;
    HalfWidth[Index] = Width / 2;
    Depth[Index] = ChannelDepth;
    Level[Index] = Filled[Index] - 0.3 * ChannelDepth;
  }
  // Downstream monotone water level: a reach never sits above the reach that feeds it.
  for (let Index = 0; Index < Order.length; Index++) {
    const Here = Order[Index];
    if (!Channel[Here]) continue;
    const Downslope = Direction[Here];
    if (Downslope >= 0 && Channel[Downslope] && Level[Downslope] > Level[Here]) Level[Downslope] = Level[Here];
  }
  const { SeedIndex, Distance } = NearestSeedField(Channel, N, Cell);
  const ValleyExtra = Math.max(0, Params.RiverValleyWidth) * 5;
  const BankSlope = 0.7;
  const Height = Float32Array.from(Surface.Height);
  const WaterSourceField = new Uint8Array(Count);
  const WaterLevelField = new Float32Array(Count);
  for (let Index = 0; Index < Count; Index++) {
    const Seed = SeedIndex[Index];
    if (Seed < 0) continue;
    const Lateral = Distance[Index];
    const HalfChannel = HalfWidth[Seed];
    const Reach = HalfChannel + ValleyExtra + 2;
    if (Lateral > Reach) continue;
    const ReachLevel = Level[Seed];
    const Deep = Depth[Seed];
    const Bed = ReachLevel - Deep * (1 + 1.5 * Params.Downcutting);
    const BankTop = ReachLevel + 0.25 * Deep;
    let Target;
    if (Lateral <= HalfChannel) {
      const Position = Lateral / Math.max(HalfChannel, 1e-3);
      Target = Bed + (BankTop - Bed) * (0.1 + 0.9 * Position * Position);
    } else {
      Target = BankTop + (Lateral - HalfChannel) * BankSlope;
    }
    const Fade = SmoothStep(Reach - Math.max(2, 0.3 * Reach), Reach, Lateral);
    const Cut = Math.min(Height[Index], Target);
    Height[Index] = Height[Index] + (Cut - Height[Index]) * (1 - Fade);
    if (Lateral <= HalfChannel && Height[Index] < ReachLevel - 0.02) {
      WaterSourceField[Index] = WaterSource.River;
      WaterLevelField[Index] = ReachLevel;
    }
  }
  // Dry cells carry their final ground height as their water level, so depth is zero.
  for (let Index = 0; Index < Count; Index++) {
    if (!WaterSourceField[Index]) WaterLevelField[Index] = Height[Index];
  }
  let ChannelCells = 0;
  for (let Index = 0; Index < Count; Index++) ChannelCells += Channel[Index];
  return {
    Partial: { Height, Water: { Source: WaterSourceField, Level: WaterLevelField } },
    Report: { Channels: ChannelCells },
  };
}

// Labels 4-connected regions of a boolean field. Returns the label per cell (0 = none) and the area per label.
export function LabelRegions(Member, N) {
  const Labels = new Int32Array(N * N);
  const Areas = [0];
  const Stack = [];
  let Next = 0;
  for (let Start = 0; Start < N * N; Start++) {
    if (!Member[Start] || Labels[Start]) continue;
    Next += 1;
    let Area = 0;
    Stack.push(Start);
    Labels[Start] = Next;
    while (Stack.length) {
      const Here = Stack.pop();
      Area += 1;
      const X = Here % N;
      const Y = (Here - X) / N;
      const Around = [];
      if (X > 0) Around.push(Here - 1);
      if (X < N - 1) Around.push(Here + 1);
      if (Y > 0) Around.push(Here - N);
      if (Y < N - 1) Around.push(Here + N);
      for (const Neighbour of Around) {
        if (Member[Neighbour] && !Labels[Neighbour]) {
          Labels[Neighbour] = Next;
          Stack.push(Neighbour);
        }
      }
    }
    Areas.push(Area);
  }
  return { Labels, Areas };
}

// Closed basins deeper than MinimumDepth become lakes, but only when the basin
// is large enough to read as a lake. Puddles from noise pits are left dry.
export function FillLakes(Params, Surface, Context) {
  const N = Surface.N;
  const Count = N * N;
  const Analysis = AnalyseDrainage(Surface.Height, N, Surface.Cell, Context.Seed, 0);
  const Height = Surface.Height;
  const Basin = new Uint8Array(Count);
  for (let Index = 0; Index < Count; Index++) {
    if (Analysis.Filled[Index] - Height[Index] > Params.MinimumDepth) Basin[Index] = 1;
  }
  const { Labels, Areas } = LabelRegions(Basin, N);
  const MinimumCells = Params.MinimumArea / (Surface.Cell * Surface.Cell);
  const Source = new Uint8Array(Count);
  const Level = new Float32Array(Count);
  for (let Index = 0; Index < Count; Index++) {
    Level[Index] = Height[Index];
    const Label = Labels[Index];
    if (Label && Areas[Label] >= MinimumCells) {
      Source[Index] = WaterSource.Lake;
      Level[Index] = Analysis.Filled[Index];
    }
  }
  return { Partial: { Water: { Source, Level } }, Report: {} };
}

// Sea: every cell below the sea level is covered by one flat plane.
export function FillSea(Params, Surface) {
  const Count = Surface.N * Surface.N;
  const Source = new Uint8Array(Count);
  const Level = new Float32Array(Count);
  for (let Index = 0; Index < Count; Index++) {
    Level[Index] = Math.max(Surface.Height[Index], Params.Level);
    if (Surface.Height[Index] < Params.Level) Source[Index] = WaterSource.Sea;
  }
  return { Partial: { Water: { Source, Level } }, Report: {} };
}

export const WaterOperations = {
  Rivers: (Params, Surface, Context) => CarveRivers(Params, Surface, Context),
  Lakes: (Params, Surface, Context) => FillLakes(Params, Surface, Context),
  Sea: (Params, Surface, Context) => FillSea(Params, Surface, Context),
};

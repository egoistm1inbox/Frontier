// Evaluation worker: integrates the stack off the main thread and returns the
// arrays the viewport needs. Preview requests also return the selected layer's
// mask and effect, so the viewport can isolate what a layer is doing.

import { IntegrateStack, IntegrateTerrain } from "../engine/LayerSequence.js";
import { CombineMasks } from "../engine/MaskClassifier.js";
import { WaterSource } from "../engine/HeightfieldSpace.js";

function StatisticsOf(Surface) {
  const Count = Surface.N * Surface.N;
  let Minimum = Infinity, Maximum = -Infinity, Wet = 0, Rivers = 0, Lakes = 0, Seas = 0;
  for (let Index = 0; Index < Count; Index++) {
    const Here = Surface.Height[Index];
    if (Here < Minimum) Minimum = Here;
    if (Here > Maximum) Maximum = Here;
    const Source = Surface.Water.Source[Index];
    if (Source) Wet += 1;
    if (Source === WaterSource.River) Rivers += 1;
    if (Source === WaterSource.Lake) Lakes += 1;
    if (Source === WaterSource.Sea) Seas += 1;
  }
  return {
    MinimumHeight: Minimum, MaximumHeight: Maximum,
    WetShare: Wet / Count, RiverShare: Rivers / Count, LakeShare: Lakes / Count, SeaShare: Seas / Count,
  };
}

function LayerSeedOf(Layer, Stack) {
  return (Layer.Seed + 7919 * Stack.Heightfield.Seed) >>> 0;
}

function PreviewFor(Stack, Target, Surface) {
  if (!Target) return null;
  if (Target.Stack === "Texture") {
    const Layer = Stack.Texture.find((Entry) => Entry.Id === Target.Id);
    if (!Layer) return null;
    const Context = { N: Surface.N, Size: Surface.Size, Cell: Surface.Cell, Seed: LayerSeedOf(Layer, Stack), Mask: null };
    const Mask = CombineMasks(Layer.Masks, Surface, Context) || new Float32Array(Surface.N * Surface.N).fill(1);
    return { Mask, Effect: null };
  }
  const Index = Stack.Terrain.findIndex((Entry) => Entry.Id === Target.Id);
  if (Index < 0) return null;
  const Layer = Stack.Terrain[Index];
  const Before = IntegrateTerrain({ ...Stack, Terrain: Stack.Terrain.slice(0, Index) }).Surface;
  const After = IntegrateTerrain({ ...Stack, Terrain: Stack.Terrain.slice(0, Index + 1) }).Surface;
  const Context = { N: Before.N, Size: Before.Size, Cell: Before.Cell, Seed: LayerSeedOf(Layer, Stack), Mask: null };
  const Mask = CombineMasks(Layer.Masks, Before, Context) || new Float32Array(Before.N * Before.N).fill(1);
  const Difference = Float32Array.from(After.Height, (Here, Slot) => Here - Before.Height[Slot]);
  let Peak = 1e-6;
  for (const Value of Difference) Peak = Math.max(Peak, Math.abs(Value));
  return { Mask, Effect: Difference.map((Value) => Value / Peak) };
}

self.onmessage = (Event) => {
  const { Id, Stack, Preview } = Event.data;
  try {
    const Result = IntegrateStack(Stack, {
      OnProgress: (Index, Count, Name) => self.postMessage({ Id, Progress: { Index, Count, Name } }),
    });
    const Surface = Result.Surface;
    self.postMessage({
      Id,
      Ok: true,
      N: Surface.N,
      Size: Surface.Size,
      Cell: Surface.Cell,
      Height: Surface.Height,
      WaterSource: Surface.Water.Source,
      WaterLevel: Surface.Water.Level,
      Colour: Result.Colour,
      Reports: Result.Reports,
      Milliseconds: Result.Milliseconds,
      Stats: StatisticsOf(Surface),
      Preview: PreviewFor(Stack, Preview, Surface),
    });
  } catch (Failure) {
    self.postMessage({ Id, Ok: false, Message: String(Failure && Failure.stack ? Failure.stack : Failure) });
  }
};

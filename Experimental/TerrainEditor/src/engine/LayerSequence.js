// Layer sequence: integrates the terrain stack bottom to top, then the
// texturing stack over the finished surface. Each layer is weighted by its
// opacity and its combined masks, combined with the layer below using its
// blend mode, and cached in the depot under a content key that covers the
// layer and everything beneath it.

import { CloneSurface, CreateSurface, Mix, WaterSource } from "./HeightfieldSpace.js";
import { CombineMasks } from "./MaskClassifier.js";
import { GeneratorOperations, ModifierOperations } from "./ReliefProjection.js";
import { SurfaceOperations } from "./SurfaceProjection.js";
import { ErosionOperations } from "./ErosionIntegrator.js";
import { WaterOperations } from "./WaterStructure.js";
import { TextureOperations } from "./TextureProjection.js";
import { CreateLayerDepot } from "./LayerDepot.js";
import { TextHash } from "./SeededRandom.js";

export const TerrainOperationTable = {
  ...GeneratorOperations,
  ...ModifierOperations,
  ...SurfaceOperations,
  ...ErosionOperations,
  ...WaterOperations,
};

const Depot = CreateLayerDepot(24);
const TextureBase = 0.55;

// Height blend. Multiply treats the layer as a scale in hundreds of metres.
export function CombineHeight(Mode, Below, Above) {
  switch (Mode) {
    case "Add": return Below + Above;
    case "Subtract": return Below - Above;
    case "Multiply": return Below * (Above / 100);
    case "Insert": return Math.max(Below, Above);
    case "Embed": return Math.min(Below, Above);
    default: return Above;
  }
}

// Colour blend on 0..1 channels.
export function CombineChannel(Mode, Below, Above) {
  switch (Mode) {
    case "Multiply": return Below * Above;
    case "Screen": return 1 - (1 - Below) * (1 - Above);
    case "Overlay": return Below < 0.5 ? 2 * Below * Above : 1 - 2 * (1 - Below) * (1 - Above);
    case "Add": return Math.min(1, Below + Above);
    case "Subtract": return Math.max(0, Below - Above);
    case "Insert": return Math.max(Below, Above);
    case "Embed": return Math.min(Below, Above);
    default: return Above;
  }
}

function LayerSeed(Layer, Heightfield) {
  return (Layer.Seed + 7919 * Heightfield.Seed) >>> 0;
}

function LayerKey(PreviousKey, Layer) {
  const Core = {
    Operation: Layer.Operation,
    Parameters: Layer.Parameters,
    Seed: Layer.Seed,
    Combine: Layer.Combine,
    Opacity: Layer.Opacity,
    Masks: (Layer.Masks || []).map((Mask) => ({
      Method: Mask.Method, Parameters: Mask.Parameters, Invert: Mask.Invert,
      Opacity: Mask.Opacity, Combine: Mask.Combine, Enabled: Mask.Enabled, Seed: Mask.Seed,
    })),
  };
  return `${PreviousKey}:${TextHash(JSON.stringify(Core))}`;
}

// Applies one terrain layer to its input surface and returns the new surface.
function RunTerrainLayer(Layer, Input, Heightfield) {
  const Context = { N: Input.N, Size: Input.Size, Cell: Input.Cell, Seed: LayerSeed(Layer, Heightfield), Mask: null };
  const Mask = CombineMasks(Layer.Masks, Input, Context);
  Context.Mask = Mask;
  const Raw = TerrainOperationTable[Layer.Operation](Layer.Parameters, Input, Context);
  const Partial = Raw.Partial ? { ...Raw.Partial } : { ...Raw };
  if (Partial.Water && Layer.Parameters.RenderSurface === false) delete Partial.Water;
  const Output = CloneSurface(Input);
  const Count = Input.N * Input.N;
  for (let Index = 0; Index < Count; Index++) {
    const Weight = Layer.Opacity * (Mask ? Mask[Index] : 1);
    if (Weight <= 0) continue;
    if (Partial.Height) {
      Output.Height[Index] = Mix(Input.Height[Index], CombineHeight(Layer.Combine, Input.Height[Index], Partial.Height[Index]), Weight);
    }
    if (Partial.Hardness) Output.Hardness[Index] = Mix(Input.Hardness[Index], Partial.Hardness[Index], Weight);
    if (Partial.Sediment) Output.Sediment[Index] = Mix(Input.Sediment[Index], Partial.Sediment[Index], Weight);
    if (Partial.Water && Partial.Water.Source[Index] && Weight >= 0.5) {
      Output.Water.Source[Index] = Partial.Water.Source[Index];
      Output.Water.Level[Index] = Partial.Water.Level[Index];
    }
  }
  return { Surface: Output, Carved: Partial.Water ? Partial.Water.Source.reduce((Sum, Source) => Sum + (Source ? 1 : 0), 0) : 0 };
}

// Water shows only where the level stands above the ground. Later layers can
// raise ground above a river, so those cells are dropped from the water mask.
// Dry cells carry their ground height as their level so depth is zero.
function FinaliseWater(Surface) {
  for (let Index = 0; Index < Surface.Height.length; Index++) {
    if (Surface.Water.Source[Index] && Surface.Water.Level[Index] <= Surface.Height[Index] + 0.02) {
      Surface.Water.Source[Index] = WaterSource.None;
    }
    if (Surface.Water.Source[Index] === WaterSource.None) Surface.Water.Level[Index] = Surface.Height[Index];
  }
  return Surface;
}

function SummariseLayer(Layer, Surface, Previous, Milliseconds, Extra = {}) {
  let Minimum = Infinity;
  let Maximum = -Infinity;
  let Changed = 0;
  let Wet = 0;
  for (let Index = 0; Index < Surface.Height.length; Index++) {
    const Here = Surface.Height[Index];
    if (Here < Minimum) Minimum = Here;
    if (Here > Maximum) Maximum = Here;
    if (Math.abs(Here - Previous.Height[Index]) > 0.01) Changed += 1;
    if (Surface.Water.Source[Index]) Wet += 1;
  }
  return {
    Id: Layer.Id,
    Name: Layer.Name,
    Operation: Layer.Operation,
    Milliseconds,
    MinimumHeight: Minimum,
    MaximumHeight: Maximum,
    ChangedShare: Changed / Surface.Height.length,
    WaterShare: Wet / Surface.Height.length,
    ...Extra,
  };
}

// Integrates the terrain stack. Options.OnProgress receives (Index, Count, Name).
export function IntegrateTerrain(Stack, Options = {}) {
  const Heightfield = Stack.Heightfield;
  const Base = CreateSurface(Heightfield);
  let Surface = Base;
  let Key = `${Heightfield.Resolution}:${Heightfield.Size}:${Heightfield.Seed}`;
  const Reports = [];
  const Layers = Stack.Terrain;
  Layers.forEach((Layer, Index) => {
    Options.OnProgress?.(Index, Layers.length, Layer.Name);
    if (!Layer.Enabled || !TerrainOperationTable[Layer.Operation]) {
      Reports.push({ Id: Layer.Id, Name: Layer.Name, Operation: Layer.Operation, Skipped: true, Milliseconds: 0 });
      return;
    }
    Key = LayerKey(Key, Layer);
    const Found = Depot.Fetch(Key);
    if (Found) {
      Surface = Found.Surface;
      Reports.push({ ...Found.Report, Cached: true, Milliseconds: 0 });
      return;
    }
    const Started = performance.now();
    const Result = RunTerrainLayer(Layer, Surface, Heightfield);
    const Milliseconds = performance.now() - Started;
    const Report = SummariseLayer(Layer, Result.Surface, Surface, Milliseconds, { Carved: Result.Carved });
    Depot.Store(Key, { Surface: Result.Surface, Report });
    Surface = Result.Surface;
    Reports.push({ ...Report, Cached: false });
  });
  return { Surface: FinaliseWater(CloneSurface(Surface)), Reports, Key };
}

// Texturing stack: builds the colour raster over the finished terrain.
export function IntegrateTexture(Stack, Surface) {
  const N = Surface.N;
  const Count = N * N;
  let Colour = new Float32Array(Count * 3).fill(TextureBase);
  for (const Layer of Stack.Texture) {
    const Operation = TextureOperations[Layer.Operation];
    if (!Layer.Enabled || !Operation) continue;
    const Context = { N, Size: Surface.Size, Cell: Surface.Cell, Seed: LayerSeed(Layer, Stack.Heightfield), Mask: null };
    const Mask = CombineMasks(Layer.Masks, Surface, Context);
    const Output = Operation(Layer.Parameters, Surface, Context, Colour);
    const Next = new Float32Array(Colour.length);
    for (let Index = 0; Index < Count; Index++) {
      const Weight = Layer.Opacity * (Mask ? Mask[Index] : 1);
      for (let Channel = 0; Channel < 3; Channel++) {
        const Slot = Index * 3 + Channel;
        const Blended = CombineChannel(Layer.Combine, Colour[Slot], Output[Slot]);
        Next[Slot] = Mix(Colour[Slot], Blended, Weight);
      }
    }
    Colour = Next;
  }
  return Colour;
}

// Full evaluation: terrain, then texture. Returns everything the viewport and exporters read.
export function IntegrateStack(Stack, Options = {}) {
  const Started = performance.now();
  const Terrain = IntegrateTerrain(Stack, Options);
  const TextureStarted = performance.now();
  const Colour = IntegrateTexture(Stack, Terrain.Surface);
  return {
    Surface: Terrain.Surface,
    Colour,
    Reports: Terrain.Reports,
    Milliseconds: { Total: performance.now() - Started, Texture: performance.now() - TextureStarted },
  };
}

export function DepotStatistics() {
  return { Entries: Depot.Count() };
}

export function ClearDepot() {
  Depot.Clear();
}

// Preset specification: builds layers and masks with schema defaults, and
// holds the starter stacks. A stack is plain JSON so it can be saved and loaded.

import { TerrainOperations, TextureOperations, MaskMethods, MaskCommonParameters, DefaultParameters, FindMaskMethod } from "./LayerSpecification.js";

let Counter = 0;
export function CreateIdentifier(Prefix) {
  Counter += 1;
  return `${Prefix}-${Date.now().toString(36)}${Counter.toString(36)}`;
}

export function CreateLayer(Stack, OperationId, Overrides = {}) {
  const List = Stack === "Texture" ? TextureOperations : TerrainOperations;
  const Operation = List.find((Entry) => Entry.Id === OperationId);
  if (!Operation) throw new Error(`Unknown ${Stack} operation: ${OperationId}`);
  return {
    Id: CreateIdentifier("layer"),
    Name: Overrides.Name || Operation.Name,
    Operation: OperationId,
    Enabled: true,
    Opacity: 1,
    Combine: Overrides.Combine || "Normal",
    Seed: Overrides.Seed ?? 1,
    Parameters: { ...DefaultParameters(Operation.Parameters), ...(Overrides.Parameters || {}) },
    Masks: (Overrides.Masks || []).map((Mask) => ({ ...Mask })),
  };
}

export function CreateMask(MethodId, Overrides = {}) {
  const Method = FindMaskMethod(MethodId) || MaskMethods[0];
  return {
    Id: CreateIdentifier("mask"),
    Name: Overrides.Name || Method.Name,
    Method: Method.Id,
    Enabled: true,
    Invert: false,
    Opacity: 1,
    Combine: Overrides.Combine || "Multiply",
    Seed: Overrides.Seed ?? 1,
    Parameters: {
      ...DefaultParameters(MaskCommonParameters),
      ...DefaultParameters(Method.Parameters),
      ...(Overrides.Parameters || {}),
    },
  };
}

export function CreateHeightfield(Overrides = {}) {
  return { Size: 1024, Resolution: 256, Seed: 7, ...Overrides };
}

// Starter stacks. Each one touches every layer category so presets double as a smoke test.
export const StackPresetNames = ["Ridge country", "Mesa canyons", "Coastal island", "Dune sea", "Blank ground"];

export function CreatePreset(Name) {
  const Heightfield = CreateHeightfield({ Seed: Name === "Mesa canyons" ? 21 : 7 });
  const Terrain = [];
  const Texture = [];
  const Add = (List, Stack, OperationId, Overrides) => List.push(CreateLayer(Stack, OperationId, Overrides));
  const Slope = (Low, High, Combine = "Multiply") => CreateMask("Steepness", { Parameters: { Low, High, Softness: 0.06 }, Combine });
  const Height = (Low, High, Combine = "Multiply") => CreateMask("Altitude", { Parameters: { Low, High, Softness: 0.06 }, Combine });
  const Valley = (Low, High) => CreateMask("Drainage", { Parameters: { Low, High, Softness: 0.05 } });

  if (Name === "Ridge country") {
    Add(Terrain, "Terrain", "Mountain", { Seed: 11, Name: "Mountain range", Parameters: { Amplitude: 720, Coverage: 0.6, BaseGround: 90, RidgeAngle: 35, Sharpness: 1.15 } });
    Add(Terrain, "Terrain", "Noise", { Seed: 12, Name: "Breakup noise", Combine: "Add", Parameters: { Frequency: 5, Amplitude: 26, Offset: 0, Octaves: 4 } });
    Add(Terrain, "Terrain", "Bedding", { Seed: 13, Name: "Sedimentary bedding", Parameters: { Thickness: 30, HardShare: 0.45, Dip: 6, DipDirection: 40, Strength: 0.8 } });
    Add(Terrain, "Terrain", "Rugged", { Seed: 14, Name: "Push-pull rugged", Parameters: { Amount: 6, Scale: 90, SlopeThreshold: 16 } });
    Add(Terrain, "Terrain", "Thermal", { Seed: 15, Name: "Talus relaxation", Parameters: { Iterations: 40, Talus: 36 } });
    Add(Terrain, "Terrain", "StreamPower", { Seed: 16, Name: "Stream power incision", Parameters: { Iterations: 6, Coefficient: 0.6 } });
    Add(Terrain, "Terrain", "Rivers", { Seed: 17, Name: "Rivers", Parameters: { Headwaters: 5, Width: 16, Depth: 4, Downcutting: 0.4, RiverValleyWidth: 1 } });
    Add(Terrain, "Terrain", "Lakes", { Seed: 18, Name: "Lakes", Parameters: { MinimumDepth: 5, MinimumArea: 3000 } });
    Add(Terrain, "Terrain", "VoxelCliffs", { Seed: 19, Name: "Voxel cliffs (deferred)" });
    Add(Texture, "Texture", "Soil", { Seed: 31, Name: "Soil base" });
    Add(Texture, "Texture", "BeddingColour", { Seed: 32, Name: "Exposed bedding", Parameters: { Variation: 0.4 }, Masks: [Slope(0.42, 1)] });
    Add(Texture, "Texture", "Vegetation", { Seed: 33, Name: "Grass and moss", Masks: [Slope(0, 0.3), Height(0, 0.5)] });
    Add(Texture, "Texture", "Alluvium", { Seed: 34, Name: "Valley alluvium", Masks: [Valley(0.72, 1)] });
    Add(Texture, "Texture", "Snow", { Seed: 35, Name: "Snow cover", Masks: [Height(0.8, 1, "Multiply"), Slope(0, 0.5)] });
    Add(Texture, "Texture", "Wetness", { Seed: 36, Name: "Wet ground", Parameters: { Darkening: 0.45, Radius: 36 } });
    Add(Texture, "Texture", "Cavity", { Seed: 37, Name: "Cavity shading", Parameters: { Strength: 0.4 } });
  } else if (Name === "Mesa canyons") {
    Add(Terrain, "Terrain", "Plateau", { Seed: 41, Name: "Mesa plateau", Parameters: { Amplitude: 460, Level: 0.52, Frequency: 2.4, Offset: 60 } });
    Add(Terrain, "Terrain", "Bedding", { Seed: 42, Name: "Strata bedding", Parameters: { Thickness: 22, HardShare: 0.5, Dip: 2, DipDirection: 10, Ledge: 0.9, Strength: 1 } });
    Add(Terrain, "Terrain", "Cliffs", { Seed: 43, Name: "Cliff faces", Parameters: { Slope: 28, Strength: 0.7 } });
    Add(Terrain, "Terrain", "Hydraulic", { Seed: 44, Name: "Droplet erosion", Parameters: { Droplets: 40000, Erosion: 0.35, Deposition: 0.3 } });
    Add(Terrain, "Terrain", "Rivers", { Seed: 45, Name: "Canyon river", Parameters: { Headwaters: 5, Width: 14, Depth: 5, Downcutting: 0.8, RiverValleyWidth: 2 } });
    Add(Terrain, "Terrain", "Outcrops", { Seed: 46, Name: "Mesa boulders", Parameters: { Density: 0.25, Spacing: 80, Radius: 22, Height: 30 } });
    Add(Texture, "Texture", "Soil", { Seed: 51, Name: "Desert soil", Parameters: { Colour: "#8f6a46" } });
    Add(Texture, "Texture", "BeddingColour", { Seed: 52, Name: "Banded strata", Parameters: { HardColour: "#d7b68b", SoftColour: "#9a5c3a" }, Masks: [Slope(0.2, 1)] });
    Add(Texture, "Texture", "Gravel", { Seed: 53, Name: "Canyon gravel", Masks: [Valley(0.7, 1)] });
    Add(Texture, "Texture", "Wetness", { Seed: 54, Name: "River wetness", Parameters: { Darkening: 0.5, Radius: 24 } });
  } else if (Name === "Coastal island") {
    Add(Terrain, "Terrain", "Island", { Seed: 61, Name: "Island", Parameters: { Radius: 0.42, Amplitude: 280, Softness: 0.26 } });
    Add(Terrain, "Terrain", "Ridged", { Seed: 62, Name: "Island ridges", Combine: "Add", Parameters: { Amplitude: 140, Frequency: 3.2, Offset: 0 } });
    Add(Terrain, "Terrain", "Thermal", { Seed: 63, Name: "Coastal talus", Parameters: { Iterations: 30 } });
    Add(Terrain, "Terrain", "Hydraulic", { Seed: 64, Name: "Coastal erosion", Parameters: { Droplets: 30000 } });
    Add(Terrain, "Terrain", "Rivers", { Seed: 65, Name: "Island streams", Parameters: { Headwaters: 4, Width: 9, Depth: 2.5, Downcutting: 0.2 } });
    Add(Terrain, "Terrain", "Sea", { Seed: 66, Name: "Sea", Parameters: { Level: 4 } });
    Add(Texture, "Texture", "Soil", { Seed: 71, Name: "Island soil" });
    Add(Texture, "Texture", "Alluvium", { Seed: 72, Name: "Beach sand", Masks: [Height(0, 0.08, "Multiply")] });
    Add(Texture, "Texture", "Rock", { Seed: 73, Name: "Cliff rock", Masks: [Slope(0.42, 1)] });
    Add(Texture, "Texture", "Vegetation", { Seed: 74, Name: "Tropical canopy", Masks: [Slope(0, 0.42), Height(0.1, 1)] });
    Add(Texture, "Texture", "HueShift", { Seed: 75, Name: "Warm grade", Parameters: { Hue: 4, Saturation: 0.1, Lightness: 0.03 } });
  } else if (Name === "Dune sea") {
    Add(Terrain, "Terrain", "Dunes", { Seed: 81, Name: "Dune sea", Parameters: { Frequency: 8, Angle: 35, Amplitude: 90 } });
    Add(Terrain, "Terrain", "Noise", { Seed: 82, Name: "Dune breakup", Combine: "Add", Parameters: { Frequency: 9, Amplitude: 16, Offset: 0 } });
    Add(Terrain, "Terrain", "Thermal", { Seed: 83, Name: "Slip faces", Parameters: { Iterations: 25, Talus: 30 } });
    Add(Terrain, "Terrain", "Autolevel", { Seed: 84, Name: "Autolevel", Parameters: { Low: 0, High: 180 } });
    Add(Texture, "Texture", "Alluvium", { Seed: 91, Name: "Sand", Parameters: { Colour: "#d2b27e" } });
    Add(Texture, "Texture", "Speckle", { Seed: 92, Name: "Sand grain", Combine: "Multiply", Parameters: { ColourA: "#efe2c3", ColourB: "#c79f6d", Scale: 12, Contrast: 0.3 } });
  } else if (Name === "Blank ground") {
    Add(Terrain, "Terrain", "Ground", { Seed: 101, Name: "Ground" });
    Add(Texture, "Texture", "Soil", { Seed: 111, Name: "Soil" });
  }
  return { Format: "frontier-terrain-stack", Version: 1, Name, Heightfield, Terrain, Texture };
}


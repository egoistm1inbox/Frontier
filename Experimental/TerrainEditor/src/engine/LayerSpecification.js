// Layer specification: the parametric schema for every terrain operation,
// texture operation, mask method and combine mode. The Inspector builds its
// controls from these descriptors, and the sequence reads the same keys.
//
// Gaea families are used as group names: Primitive and Terrain become
// Generators, Modify becomes Modify, Surface stays Surface, Simulate splits
// into Erosion and Water, and Colorize plus Derive become Texturing and Masks.

const Slider = (Key, Label, Minimum, Maximum, Default, Unit = "", Decimals = 2) => ({
  Key, Label, Control: "Slider", Minimum, Maximum, Default, Unit, Decimals,
});
const Switch = (Key, Label, Default) => ({ Key, Label, Control: "Switch", Default });
const Colour = (Key, Label, Default) => ({ Key, Label, Control: "Colour", Default });
const Select = (Key, Label, Options, Default) => ({ Key, Label, Control: "Select", Options, Default });

export const TerrainCombineModes = ["Normal", "Add", "Subtract", "Multiply", "Insert", "Embed"];
export const TextureCombineModes = ["Normal", "Multiply", "Screen", "Overlay", "Add", "Subtract", "Insert", "Embed"];
export const MaskCombineModes = ["Multiply", "Add", "Subtract", "Max", "Min"];

export const CombineHelp = {
  Normal: "Replaces what is below with this layer.",
  Add: "Sums this layer onto what is below.",
  Subtract: "Removes this layer from what is below.",
  Multiply: "Scales what is below by this layer.",
  Screen: "Lightens by combining both layers as inverse products.",
  Overlay: "Multiplies dark areas and screens light areas.",
  Insert: "Keeps the higher of the two (ridges and peaks rise in).",
  Embed: "Keeps the lower of the two (sinks this layer into the ground).",
};

// Terrain operations. Group decides where the Construct dialog lists them.
export const TerrainOperations = [
  { Id: "Ground", Group: "Generators", Name: "Ground", Gaea: "Constant", Summary: "Flat base at a chosen height.", Parameters: [Slider("Height", "Height", -500, 1500, 0, "m", 0)] },
  { Id: "Noise", Group: "Generators", Name: "Noise", Gaea: "Perlin", Summary: "Fractal Perlin relief.", Parameters: [
    Slider("Frequency", "Frequency", 0.5, 12, 3), Slider("Octaves", "Octaves", 1, 10, 6, "", 0),
    Slider("Amplitude", "Amplitude", 0, 1500, 420, "m", 0), Slider("Lacunarity", "Lacunarity", 1.2, 3.5, 2.05),
    Slider("Gain", "Gain", 0.2, 0.8, 0.5), Slider("Offset", "Offset", -500, 1000, 120, "m", 0),
  ] },
  { Id: "Ridged", Group: "Generators", Name: "Ridged Noise", Gaea: "Ridge", Summary: "Sharp fractal crests.", Parameters: [
    Slider("Frequency", "Frequency", 0.5, 12, 2.5), Slider("Octaves", "Octaves", 1, 10, 6, "", 0),
    Slider("Amplitude", "Amplitude", 0, 1500, 600, "m", 0), Slider("Sharpness", "Sharpness", 0.3, 3, 1.6),
    Slider("Offset", "Offset", -500, 1000, 80, "m", 0),
  ] },
  { Id: "Mountain", Group: "Generators", Name: "Mountain Range", Gaea: "MountainRange", Summary: "Crests aligned along a ridge angle, confined to a coverage zone.", Parameters: [
    Slider("Frequency", "Frequency", 0.5, 6, 1.4), Slider("Octaves", "Octaves", 2, 10, 7, "", 0),
    Slider("Amplitude", "Amplitude", 0, 2000, 900, "m", 0), Slider("RidgeAngle", "Ridge Angle", 0, 180, 35, "°", 0),
    Slider("Coverage", "Coverage", 0, 1, 0.6), Slider("BaseGround", "Base Ground", 0, 400, 90, "m", 0),
    Slider("Sharpness", "Sharpness", 0.3, 3, 1.5),
  ] },
  { Id: "Plateau", Group: "Generators", Name: "Plateau", Gaea: "Plates", Summary: "Flat-topped mesas with cliff edges.", Parameters: [
    Slider("Frequency", "Frequency", 0.5, 8, 2.2), Slider("Octaves", "Octaves", 1, 10, 6, "", 0),
    Slider("Amplitude", "Amplitude", 0, 1500, 420, "m", 0), Slider("Level", "Level", 0, 1, 0.55),
    Slider("Edge", "Edge", 0.01, 0.3, 0.08), Slider("Offset", "Offset", -200, 800, 40, "m", 0),
  ] },
  { Id: "Island", Group: "Generators", Name: "Island", Gaea: "Island", Summary: "Radial island with a ragged coast.", Parameters: [
    Slider("Radius", "Radius", 0.1, 0.5, 0.42), Slider("Softness", "Coast Softness", 0.02, 0.5, 0.28),
    Slider("Amplitude", "Amplitude", 0, 1200, 260, "m", 0), Slider("Frequency", "Frequency", 1, 10, 4),
    Slider("Octaves", "Octaves", 1, 10, 6, "", 0),
  ] },
  { Id: "Volcano", Group: "Generators", Name: "Volcano", Gaea: "Volcano", Summary: "Cone with a crater.", Parameters: [
    Slider("Radius", "Radius", 0.1, 0.5, 0.32), Slider("Height", "Height", 0, 2000, 700, "m", 0),
    Slider("CraterDepth", "Crater Depth", 0, 600, 160, "m", 0), Slider("CraterRadius", "Crater Radius", 0.02, 0.3, 0.07),
    Slider("Frequency", "Frequency", 1, 8, 3), Slider("Amplitude", "Roughness", 0, 200, 60, "m", 0),
  ] },
  { Id: "Canyon", Group: "Generators", Name: "Canyon", Gaea: "Canyon", Summary: "Meandering canyon cut into a plateau.", Parameters: [
    Slider("PlateauHeight", "Plateau Height", 0, 1200, 320, "m", 0), Slider("Depth", "Depth", 0, 900, 260, "m", 0),
    Slider("Width", "Width", 0.005, 0.2, 0.035), Slider("Meander", "Meander", 0, 1, 0.6),
    Slider("Frequency", "Frequency", 0.5, 4, 1.6), Slider("Octaves", "Octaves", 1, 8, 5, "", 0),
  ] },
  { Id: "Dunes", Group: "Generators", Name: "Dune Sea", Gaea: "DuneSea", Summary: "Transverse dune ridges under a patchy envelope.", Parameters: [
    Slider("Frequency", "Frequency", 1, 20, 7), Slider("Angle", "Angle", 0, 180, 20, "°", 0),
    Slider("Amplitude", "Amplitude", 0, 300, 60, "m", 0), Slider("Warp", "Warp", 0, 3, 0.6),
    Slider("Envelope", "Envelope", 0, 1, 0.5),
  ] },
  { Id: "Gradient", Group: "Generators", Name: "Tilt", Gaea: "LinearGradient", Summary: "Linear slope across the map.", Parameters: [
    Slider("Angle", "Direction", 0, 360, 30, "°", 0), Slider("Amplitude", "Amplitude", 0, 2000, 200, "m", 0),
    Slider("Offset", "Offset", -500, 1000, 0, "m", 0),
  ] },

  { Id: "Warp", Group: "Modify", Name: "Warp", Gaea: "Warp", Summary: "Displaces the field with two noise fields.", Parameters: [
    Slider("Amount", "Amount", 0, 400, 60, "m", 0), Slider("Scale", "Scale", 0.5, 12, 2.2),
  ] },
  { Id: "Blur", Group: "Modify", Name: "Blur", Gaea: "Blur", Summary: "Box blur, repeatable.", Parameters: [
    Slider("Radius", "Radius", 0, 200, 12, "m", 0), Slider("Passes", "Passes", 1, 6, 1, "", 0),
  ] },
  { Id: "SlopeBlur", Group: "Modify", Name: "Slope Blur", Gaea: "SlopeBlur", Summary: "Smooths only the steep ground.", Parameters: [
    Slider("Radius", "Radius", 0, 200, 16, "m", 0), Slider("SlopeStart", "Slope Start", 0, 60, 18, "°", 0),
    Slider("SlopeSpan", "Slope Span", 1, 60, 30, "°", 0),
  ] },
  { Id: "Terrace", Group: "Modify", Name: "Terrace", Gaea: "Terraces", Summary: "Stepped benches of a chosen height.", Parameters: [
    Slider("Step", "Step", 2, 300, 45, "m", 0), Slider("Sharpness", "Sharpness", 0.3, 4, 1.6), Slider("Strength", "Strength", 0, 1, 1),
  ] },
  { Id: "Curve", Group: "Modify", Name: "Curve", Gaea: "Curve", Summary: "Power curve and contrast on the height range.", Parameters: [
    Slider("Power", "Power", 0.2, 4, 1.3), Slider("Contrast", "Contrast", 0, 1, 0.3),
  ] },
  { Id: "Clamp", Group: "Modify", Name: "Clamp", Gaea: "Clamp", Summary: "Hard limits on the height.", Parameters: [
    Slider("Minimum", "Minimum", -500, 1000, -50, "m", 0), Slider("Maximum", "Maximum", 0, 3000, 1200, "m", 0),
  ] },
  { Id: "Autolevel", Group: "Modify", Name: "Autolevel", Gaea: "Autolevel", Summary: "Stretches the height to a range.", Parameters: [
    Slider("Low", "Low", -500, 1000, 0, "m", 0), Slider("High", "High", 0, 3000, 900, "m", 0),
  ] },
  { Id: "Sharpen", Group: "Modify", Name: "Sharpen", Gaea: "Sharpen", Summary: "Unsharp mask on the height.", Parameters: [
    Slider("Radius", "Radius", 1, 100, 20, "m", 0), Slider("Amount", "Amount", 0, 3, 0.6),
  ] },
  { Id: "ClipPeaks", Group: "Modify", Name: "Clip Peaks", Gaea: "Clip", Summary: "Flattens everything above a cap.", Parameters: [
    Slider("Cap", "Cap", 0, 3000, 1000, "m", 0),
  ] },

  { Id: "Bedding", Group: "Surface", Name: "Bedding", Gaea: "Stratify", Summary: "Sedimentary beds with hard ledges and soft slopes.", Parameters: [
    Slider("Thickness", "Bed Thickness", 2, 200, 26, "m", 0), Slider("HardShare", "Hard Share", 0, 1, 0.4),
    Slider("Dip", "Dip", 0, 45, 8, "°", 0), Slider("DipDirection", "Dip Direction", 0, 360, 30, "°", 0),
    Slider("Variation", "Variation", 0, 1, 0.35), Slider("Ledge", "Ledge", 0, 1, 0.7), Slider("Strength", "Strength", 0, 1, 1),
  ] },
  { Id: "Rugged", Group: "Surface", Name: "Rugged", Gaea: "Rugged", Summary: "Push-pull buttresses and recesses on slopes.", Parameters: [
    Slider("Amount", "Amount", 0, 60, 14, "m", 0), Slider("Scale", "Scale", 10, 400, 70, "m", 0),
    Slider("SlopeThreshold", "Slope Threshold", 0, 60, 18, "°", 0),
  ] },
  { Id: "Cliffs", Group: "Surface", Name: "Cliffs", Gaea: "Craggy", Summary: "Steepens hard rock faces.", Parameters: [
    Slider("Slope", "Slope", 10, 70, 32, "°", 0), Slider("Strength", "Strength", 0, 1, 0.6),
  ] },
  { Id: "Roughen", Group: "Surface", Name: "Roughen", Gaea: "Roughen", Summary: "Fine relief that favours slopes.", Parameters: [
    Slider("Amount", "Amount", 0, 60, 6, "m", 0), Slider("Scale", "Scale", 5, 300, 40, "m", 0),
    Slider("SlopeInfluence", "Slope Influence", 0, 1, 0.6),
  ] },
  { Id: "Outcrops", Group: "Surface", Name: "Outcrops", Gaea: "Outcrops", Summary: "Scattered rock bumps on a jittered grid.", Parameters: [
    Slider("Density", "Density", 0, 1, 0.35), Slider("Spacing", "Spacing", 10, 300, 70, "m", 0),
    Slider("Radius", "Radius", 4, 120, 26, "m", 0), Slider("Height", "Height", 0, 300, 60, "m", 0),
  ] },

  { Id: "Thermal", Group: "Erosion", Name: "Thermal", Gaea: "Thermal", Summary: "Talus slides on slopes above the angle of rest.", Parameters: [
    Slider("Iterations", "Iterations", 1, 300, 60, "", 0), Slider("Talus", "Talus Angle", 10, 60, 34, "°", 0),
    Slider("Rate", "Rate", 0.05, 0.5, 0.4),
  ] },
  { Id: "Hydraulic", Group: "Erosion", Name: "Hydraulic", Gaea: "Erosion", Summary: "Droplet erosion with sediment transport.", Parameters: [
    Slider("Droplets", "Droplets", 0, 400000, 60000, "", 0), Slider("Erosion", "Erosion", 0, 1, 0.35),
    Slider("Deposition", "Deposition", 0, 1, 0.3), Slider("Capacity", "Capacity", 0, 20, 6),
    Slider("Inertia", "Inertia", 0, 0.5, 0.05), Slider("Evaporation", "Evaporation", 0, 0.2, 0.02),
    Slider("Gravity", "Gravity", 0, 20, 4), Slider("Lifetime", "Lifetime", 5, 200, 60, "", 0),
  ] },
  { Id: "StreamPower", Group: "Erosion", Name: "Stream Power", Gaea: "Erosion2", Summary: "Incision from drainage area and slope.", Parameters: [
    Slider("Iterations", "Iterations", 1, 40, 8, "", 0), Slider("Coefficient", "Coefficient", 0, 5, 1),
    Slider("AreaExponent", "Area Exponent", 0, 1, 0.45), Slider("SlopeExponent", "Slope Exponent", 0.2, 2, 1),
    Slider("Resistance", "Hardness Resistance", 0, 1, 0.7),
  ] },

  { Id: "Rivers", Group: "Water", Name: "Rivers", Gaea: "Rivers", Summary: "Carves channels and valleys; water only inside the cut.", Parameters: [
    Slider("Headwaters", "Headwaters", 0.5, 30, 6, "%"), Slider("Width", "Width", 2, 120, 18, "m", 0),
    Slider("Depth", "Depth", 0.2, 30, 4, "m"), Slider("Downcutting", "Downcutting", 0, 1, 0.35),
    Slider("RiverValleyWidth", "River Valley Width", -4, 4, 0, "", 1), Slider("Seed", "Seed", 0, 999, 3, "", 0),
    Switch("RenderSurface", "Render Surface", true),
  ] },
  { Id: "Lakes", Group: "Water", Name: "Lakes", Gaea: "Lake", Summary: "Fills closed basins to a flat spill level.", Parameters: [
    Slider("MinimumDepth", "Minimum Depth", 0.1, 60, 4, "m"), Slider("MinimumArea", "Minimum Area", 0, 20000, 2500, "m²", 0),
    Switch("RenderSurface", "Render Surface", true),
  ] },
  { Id: "Sea", Group: "Water", Name: "Sea", Gaea: "Sea", Summary: "One flat sea plane below a chosen level.", Parameters: [
    Slider("Level", "Sea Level", -200, 800, 0, "m", 0), Switch("RenderSurface", "Render Surface", true),
  ] },

  { Id: "VoxelCliffs", Group: "Voxel", Name: "Voxel Cliffs", Gaea: "Voxel slot", Summary: "Deferred. Keeps the voxel slot in the stack; does not change the heightfield yet.", Status: "Deferred", Parameters: [] },
];

// Gaea nodes not yet covered by a layer. Shown in the Construct dialog so the gap stays visible.
export const PlannedTerrainNodes = [
  "Cracks", "Cellular", "Voronoi", "Lichtenberg", "Crumble", "Debris", "Scree", "Glacier", "Snow", "Snowfield",
  "Anastomosis", "Hillify", "Thermal2", "Sediments", "Wizard", "Lake (Gaea 1.3)", "Sea (sediment)", "Contours",
  "Stacks", "Sandstone", "Terraces (fractal)", "Steps", "Pockmarks", "Stones", "Shatter", "Bomber", "Distress",
  "Denoise", "Median", "SlopeWarp", "DirectionalWarp", "Curvature mask", "Peaks", "Heal", "Meshify", "Seamless",
];

// Texture operations. Generators build colour; modifiers reshape what is below them.
export const TextureOperations = [
  { Id: "Fill", Group: "Generators", Name: "Fill", Gaea: "Constant colour", Summary: "Solid colour fill.", Parameters: [Colour("Colour", "Colour", "#8a7d64")] },
  { Id: "Speckle", Group: "Generators", Name: "Speckle", Gaea: "Synth", Summary: "Two-colour procedural noise.", Parameters: [
    Colour("ColourA", "Colour A", "#5f5444"), Colour("ColourB", "Colour B", "#a89878"),
    Slider("Scale", "Scale", 1, 200, 30, "m", 0), Slider("Contrast", "Contrast", 0, 1, 0.6),
  ] },
  { Id: "AltitudeTint", Group: "Generators", Name: "Altitude Tint", Gaea: "Tint", Summary: "Three-stop colour ramp on altitude.", Parameters: [
    Colour("Low", "Low", "#3d4d2e"), Colour("Middle", "Middle", "#7d7150"), Colour("High", "High", "#d8d2c2"),
    Slider("Balance", "Balance", 0.05, 0.95, 0.5),
  ] },
  { Id: "BeddingColour", Group: "Generators", Name: "Bedding Colour", Gaea: "Stratify colour", Summary: "Hard and soft bed colours from hardness.", Parameters: [
    Colour("HardColour", "Hard Rock", "#c2b59c"), Colour("SoftColour", "Soft Rock", "#8b5e3c"),
    Slider("Variation", "Variation", 0, 1, 0.35),
  ] },
  { Id: "Rock", Group: "Generators", Name: "Rock", Gaea: "RockMap", Summary: "Bare rock with cavity darkening.", Parameters: [
    Colour("Colour", "Colour", "#6f6a63"), Slider("Variation", "Variation", 0, 1, 0.5), Slider("Cavity", "Cavity", 0, 1, 0.5),
  ] },
  { Id: "Soil", Group: "Generators", Name: "Soil", Gaea: "Soil", Summary: "Earth and regolith.", Parameters: [
    Colour("Colour", "Colour", "#6b5a3f"), Slider("Variation", "Variation", 0, 1, 0.5),
  ] },
  { Id: "Alluvium", Group: "Generators", Name: "Alluvium", Gaea: "Sediments", Summary: "Sand and silt deposits.", Parameters: [
    Colour("Colour", "Colour", "#c9b58b"), Slider("Variation", "Variation", 0, 1, 0.3),
  ] },
  { Id: "Gravel", Group: "Generators", Name: "Gravel", Gaea: "Scree", Summary: "Stony ground and river bars.", Parameters: [
    Colour("Colour", "Colour", "#9b968c"), Slider("Variation", "Variation", 0, 1, 0.6),
  ] },
  { Id: "Vegetation", Group: "Generators", Name: "Vegetation", Gaea: "Trees (ground)", Summary: "Grass and moss.", Parameters: [
    Colour("Colour", "Colour", "#4e6d34"), Slider("Variation", "Variation", 0, 1, 0.5),
  ] },
  { Id: "Snow", Group: "Generators", Name: "Snow", Gaea: "Snow", Summary: "Snow cover (mask it by altitude and steepness).", Parameters: [
    Colour("Colour", "Colour", "#f1f4f6"), Slider("Variation", "Variation", 0, 1, 0.15),
  ] },
  { Id: "Wetness", Group: "Modify", Name: "Wetness", Gaea: "WaterColor", Summary: "Darkens ground near water.", Parameters: [
    Slider("Darkening", "Darkening", 0, 1, 0.45), Slider("Radius", "Radius", 1, 300, 30, "m", 0),
  ] },
  { Id: "Cavity", Group: "Modify", Name: "Cavity", Gaea: "Occlusion", Summary: "Darkens hollows.", Parameters: [
    Slider("Strength", "Strength", 0, 1, 0.5),
  ] },
  { Id: "HueShift", Group: "Modify", Name: "Hue, Saturation, Lightness", Gaea: "HSL", Summary: "Colour adjustment of the layers below.", Parameters: [
    Slider("Hue", "Hue", -180, 180, 0, "°", 0), Slider("Saturation", "Saturation", -1, 1, 0),
    Slider("Lightness", "Lightness", -1, 1, 0),
  ] },
];

// Mask methods: the properties a mask can read from the surface.
export const MaskMethods = [
  { Id: "Steepness", Name: "Steepness", Gaea: "Angle", Summary: "Slope. 1.0 = 60°.", Parameters: [] },
  { Id: "Altitude", Name: "Altitude", Gaea: "Height", Summary: "Height across the map range.", Parameters: [] },
  { Id: "Curvature", Name: "Curvature", Gaea: "Curvature", Summary: "0 = hollow, 1 = crest.", Parameters: [] },
  { Id: "Aspect", Name: "Aspect", Gaea: "Angle (aspect)", Summary: "Faces toward an azimuth.", Parameters: [Slider("Azimuth", "Azimuth", 0, 360, 135, "°", 0)] },
  { Id: "Drainage", Name: "Drainage", Gaea: "FlowMap", Summary: "Upslope catchment area.", Parameters: [] },
  { Id: "Wetness", Name: "Wetness", Gaea: "Distance (water)", Summary: "Closeness to rivers, lakes and sea.", Parameters: [Slider("Radius", "Radius", 1, 400, 60, "m", 0)] },
  { Id: "Cavity", Name: "Cavity", Gaea: "Occlusion", Summary: "Hollows relative to their surroundings.", Parameters: [Slider("Radius", "Radius", 1, 200, 20, "m", 0)] },
  { Id: "Ridge", Name: "Ridge", Gaea: "Peaks", Summary: "Crests relative to their surroundings.", Parameters: [Slider("Radius", "Radius", 1, 200, 20, "m", 0)] },
  { Id: "Noise", Name: "Noise", Gaea: "Perlin", Summary: "Fractal noise for breakup.", Parameters: [Slider("Scale", "Scale", 5, 400, 60, "m", 0), Slider("Octaves", "Octaves", 1, 8, 4, "", 0)] },
  { Id: "Hardness", Name: "Hardness", Gaea: "Strata", Summary: "Rock hardness from bedding.", Parameters: [] },
  { Id: "Sediment", Name: "Sediment", Gaea: "Sediments", Summary: "Deposited sediment from erosion.", Parameters: [] },
];

// Parameters every mask carries. Low and High set the window; Softness feathers both edges.
export const MaskCommonParameters = [
  Slider("Low", "Low", 0, 1, 0), Slider("High", "High", 0, 1, 1), Slider("Softness", "Softness", 0, 0.5, 0.05),
];

export const LayerGroupOrder = ["Generators", "Modify", "Surface", "Erosion", "Water", "Voxel"];
export const TextureGroupOrder = ["Generators", "Modify"];

export function FindOperation(Stack, Operation) {
  const List = Stack === "Texture" ? TextureOperations : TerrainOperations;
  return List.find((Entry) => Entry.Id === Operation) || null;
}

export function FindMaskMethod(Method) {
  return MaskMethods.find((Entry) => Entry.Id === Method) || null;
}

export function DefaultParameters(Parameters) {
  const Values = {};
  for (const Field of Parameters) Values[Field.Key] = Field.Default;
  return Values;
}

export function CombineModesFor(Stack) {
  return Stack === "Texture" ? TextureCombineModes : TerrainCombineModes;
}

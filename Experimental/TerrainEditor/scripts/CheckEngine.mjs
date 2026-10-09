// Engine check: runs every starter stack in Node, asserts the water and
// texture invariants, and writes PNG previews to out/engine for review.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IntegrateStack } from "../src/engine/LayerSequence.js";
import { CreatePreset, StackPresetNames } from "../src/engine/PresetSpecification.js";
import { ColourSamples, EncodePng, HeightSamples, UnitSamples } from "../src/engine/ImageCodec.js";
import { TerrainOperations } from "../src/engine/LayerSpecification.js";

const Here = dirname(fileURLToPath(import.meta.url));
const OutputDirectory = join(Here, "..", "out", "engine");
mkdirSync(OutputDirectory, { recursive: true });

const Failures = [];
const Expect = (Condition, Message) => {
  if (!Condition) Failures.push(Message);
  return Condition;
};

// Shaded relief from the height raster, used as a backdrop for the water overlay.
function Hillshade(Height, N, Cell) {
  const Out = new Float32Array(N * N);
  const Light = [-0.6, 0.6, 0.55];
  const Length = Math.hypot(...Light);
  for (let Row = 0; Row < N; Row++) {
    for (let Column = 0; Column < N; Column++) {
      const Xl = Math.max(0, Column - 1), Xr = Math.min(N - 1, Column + 1);
      const Yd = Math.max(0, Row - 1), Yu = Math.min(N - 1, Row + 1);
      const Dx = (Height[Row * N + Xr] - Height[Row * N + Xl]) / ((Xr - Xl) * Cell);
      const Dy = (Height[Yu * N + Column] - Height[Yd * N + Column]) / ((Yu - Yd) * Cell);
      const Normal = [-Dx, -Dy, 1];
      const Norm = Math.hypot(...Normal);
      const Dot = (Normal[0] * Light[0] + Normal[1] * Light[1] + Normal[2] * Light[2]) / (Norm * Length);
      Out[Row * N + Column] = Math.max(0, Dot) * 0.85 + 0.15;
    }
  }
  return Out;
}

const Summary = [];
for (const Name of StackPresetNames) {
  const Slug = Name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const Stack = CreatePreset(Name);
  const Result = IntegrateStack(Stack, {});
  const { Surface, Colour } = Result;
  const N = Surface.N;
  const Count = N * N;
  const Water = Surface.Water;

  Expect(Surface.Height.every(Number.isFinite), `${Name}: heights must be finite`);
  Expect(Colour.every((Channel) => Number.isFinite(Channel) && Channel >= 0 && Channel <= 1), `${Name}: colour must be finite in 0..1`);

  let Wet = 0, Rivers = 0, Lakes = 0, Seas = 0, Mislevelled = 0, DryLevelWrong = 0;
  for (let Index = 0; Index < Count; Index++) {
    const Source = Water.Source[Index];
    if (Source) {
      Wet += 1;
      if (Source === 1) Rivers += 1;
      if (Source === 2) Lakes += 1;
      if (Source === 3) Seas += 1;
      if (Water.Level[Index] <= Surface.Height[Index] + 0.02) Mislevelled += 1;
    } else if (Math.abs(Water.Level[Index] - Surface.Height[Index]) > 1e-3) {
      DryLevelWrong += 1;
    }
  }
  Expect(Mislevelled === 0, `${Name}: wet cells must have water above the ground`);
  Expect(DryLevelWrong === 0, `${Name}: dry cells must carry their ground height as level`);
  // No global water: channels, lakes and sea together stay a minority of the map.
  Expect(Wet / Count < 0.2, `${Name}: water covers ${(100 * Wet / Count).toFixed(1)}% of the map, expected under 20%`);

  // Dry ground must not read as blue. Blue dominance counted only where there is no water.
  let BlueDry = 0, DryCount = 0;
  for (let Index = 0; Index < Count; Index++) {
    if (Water.Source[Index]) continue;
    DryCount += 1;
    const R = Colour[Index * 3], G = Colour[Index * 3 + 1], B = Colour[Index * 3 + 2];
    if (B > R + 0.04 && B > G) BlueDry += 1;
  }
  Expect(BlueDry / Math.max(1, DryCount) < 0.01, `${Name}: ${(100 * BlueDry / DryCount).toFixed(2)}% of dry cells read as blue`);

  const Riverine = Result.Reports.find((Report) => Report.Operation === "Rivers");
  if (Riverine) Expect(Riverine.Carved > 0, `${Name}: rivers must carve channel cells`);

  const Ms = Math.round(Result.Milliseconds.Total);
  Expect(Ms < 6000, `${Name}: integration took ${Ms} ms`);

  writeFileSync(join(OutputDirectory, `${Slug}-height.png`), EncodePng(N, N, HeightSamples(Surface.Height, -50, 900), 1, 16));
  writeFileSync(join(OutputDirectory, `${Slug}-colour.png`), EncodePng(N, N, ColourSamples(Colour), 3, 8));
  const Shade = Hillshade(Surface.Height, N, Surface.Cell);
  const Overlay = new Uint8Array(Count * 3);
  for (let Index = 0; Index < Count; Index++) {
    const Shaded = Shade[Index];
    const Wetness = Water.Source[Index];
    const Tint = Wetness === 1 ? [0.2, 0.7, 0.9] : Wetness === 2 ? [0.25, 0.85, 0.7] : Wetness === 3 ? [0.1, 0.4, 0.8] : [1, 1, 1];
    for (let Channel = 0; Channel < 3; Channel++) Overlay[Index * 3 + Channel] = Math.round(255 * Shaded * Tint[Channel]);
  }
  writeFileSync(join(OutputDirectory, `${Slug}-water.png`), EncodePng(N, N, Overlay, 3, 8));

  Summary.push({
    Name, Milliseconds: Ms, WetPercent: +(100 * Wet / Count).toFixed(2), Rivers, Lakes, Seas,
    Carved: Riverine?.Carved ?? 0,
    HeightRange: [Math.round(Math.min(...Surface.Height)), Math.round(Math.max(...Surface.Height))],
    Steps: Result.Reports.map((Report) => `${Report.Name}${Report.Skipped ? " (skipped)" : ""}:${Math.round(Report.Milliseconds)}ms`),
  });
}

// Every operation in the catalogue must have an implementation entry.
const { TerrainOperationTable } = await import("../src/engine/LayerSequence.js");
for (const Operation of TerrainOperations) {
  if (Operation.Status === "Deferred") continue;
  Expect(typeof TerrainOperationTable[Operation.Id] === "function", `Catalogue operation ${Operation.Id} has no implementation`);
}

console.log(JSON.stringify(Summary, null, 2));
console.log(`Wrote previews to ${OutputDirectory}`);
if (Failures.length) {
  console.error(`FAILED ${Failures.length} checks:\n- ${Failures.join("\n- ")}`);
  process.exit(1);
}
console.log("All engine checks passed.");

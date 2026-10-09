# Terrain Editor

A layer-based terrain and texturing editor. There is no node graph. Two stacks are
evaluated in order:

- **Terrain stack** (heightfield): generators, modifiers, surface, erosion, water and a voxel slot.
- **Texturing stack**: colour generators and modifiers, evaluated over the finished terrain.

Each layer carries a Gaea-style mask stack, opacity, a combine mode and a seed. Layer
categories follow the Gaea families. Texture generators follow the Substance Painter style
of layer-stacked fills and procedural generators.

The UI is the Frontier Editor shell from `Experimental/ProjectZeroEditor` (the latest editor
per that repo's `CLAUDE.md`). The older `Experimental/FrontierEditor` is not used.

## Run

```bash
cd Experimental/TerrainEditor
npm install
npm run dev          # http://localhost:5173 (binds 0.0.0.0)
npm run build        # production bundle in dist/
npm run check:engine # Node engine invariants; PNG previews to out/engine
CHROME_PATH=/usr/bin/chromium npm run check:browser  # headless UI check; screenshots to out/browser
```

Three.js is bundled from npm (`three@0.170.0`), so no CDN is needed. `out/`, `dist/` and
`node_modules/` are git-ignored.

## Layout

| Path | Role |
| --- | --- |
| `src/engine/` | Pure JavaScript engine. Runs in Node and in the Web Worker. |
| `src/workers/TerrainWorker.js` | Evaluates the stack off the main thread, returns arrays and layer previews. |
| `src/render/ReliefScene.js` | Three.js relief and water surface. |
| `src/ui/` | Outliner, Inspector, Viewport and Construct panels, plus glyphs. |
| `src/TerrainHost.jsx` | Owns the stack, undo history, selection and worker. Lays out the three docks. |
| `src/styles/Editor.css` | Copied unchanged from `ProjectZeroEditor/Editor.css` (the Frontier design system). |
| `src/styles/TerrainEditor.css` | Additions for the terrain panels, Construct dialog and map views. |
| `public/fonts/` | DM Sans (OFL, see `OFL.txt`), from `EngineContent/Fonts/SunReference`. |
| `scripts/CheckEngine.mjs` | Engine invariants and PNG output. |
| `scripts/CheckBrowser.mjs` | Headless Chromium check of the built UI. |

Engine modules use the closed Frontier role suffixes where they fit: `LayerSequence`,
`LayerDepot`, `DrainageSolver`, `ErosionIntegrator`, `WaterStructure`, `MaskClassifier`,
`*Projection`, `*Specification`, `ImageCodec`, `HeightfieldSpace` and `TerrainHost`.

## Stack model

A stack is plain JSON (`Format: "frontier-terrain-stack"`):

- `Heightfield`: `Size` (m), `Resolution` (cells per side), `Seed`.
- `Terrain` and `Texture`: layers, bottom to top.

Each layer has `Operation`, `Name`, `Enabled`, `Opacity`, `Combine`, `Seed`, `Parameters`
and `Masks`. A layer's result is `lerp(below, combined(below, layer), opacity * mask)`.

Terrain combine modes: Normal, Add, Subtract, Multiply, Insert (keep higher), Embed (keep
lower). Texture combine modes add Screen, Overlay, Multiply and the same Insert and Embed.

Masks are Gaea-style. Each measures one property of the surface (Steepness, Altitude,
Curvature, Aspect, Drainage, Wetness, Cavity, Ridge, Noise, Hardness, Sediment), then applies
Low, High, Softness, Invert, Opacity and a combine mode (Multiply, Add, Subtract, Max, Min).

Layer outputs are cached in `LayerDepot` under a content hash of the layer and everything
beneath it. Editing one layer re-runs only that layer and the ones above it.

## Water rule (rivers and lakes)

Water is carved, not painted.

- **Rivers** (`WaterStructure.CarveRivers`) route flow on the depression-filled surface and
  pick channel cells from the top `Headwaters` % by catchment area. Width and depth grow
  with catchment. The bed is cut below a monotone downstream water level, banks rise to a
  crest and blend into the original ground across the valley reach. Gaea-style parameters:
  Headwaters, Width, Depth, Downcutting, River Valley Width, Seed, Render Surface. A mask on
  the layer confines channel heads.
- **Lakes** fill closed basins deeper than `Minimum Depth` and larger than `Minimum Area`
  to a flat spill level. Noise pits stay dry.
- **Sea** is one plane below a level.
- Water exists only where a level stands above the ground. `FinaliseWater` drops any cell
  where the level is not above the ground. Dry cells carry their ground height, so there is
  no painted global water term. The texture stack is never tinted blue over dry land.

The engine check asserts that water covers under 20% of each starter map, that wet cells
have positive depth, that dry cells have level equal to height, and that under 1% of dry
cells read as blue.

## Gaea coverage

Gaea families map to layer groups. Status is per simple node: "Implemented" means a layer
exists, and "Planned" means the node is listed in the Construct dialog.

| Gaea family | Layer group | Implemented layers | Planned (examples) |
| --- | --- | --- | --- |
| Primitive, Terrain | Generators | Ground, Noise, Ridged, Mountain Range, Plateau, Island, Volcano, Canyon, Dune Sea, Tilt | Cracks, Cellular, Voronoi, Lichtenberg, Mountain-side variants |
| Modify | Modify | Warp, Blur, Slope Blur, Terrace, Curve, Clamp, Autolevel, Sharpen, Clip Peaks | Median, Denoise, Shaper, Fold, Distance, Slope Warp |
| Surface | Surface | Bedding (Stratify), Rugged, Cliffs (Craggy), Roughen, Outcrops | Shatter, Bomber, Pockmarks, Stones, Sandstone, Stacks, Contours |
| Simulate: erosion | Erosion | Thermal, Hydraulic, Stream Power (Erosion2) | Thermal2, Crumble, Hillify, Sediments, Wizard, Debris, Scree |
| Simulate: water | Water | Rivers, Lakes, Sea | Anastomosis, Glacier, Snow, Trees, Shrubs |
| Output, Voxel | Voxel | Voxel Cliffs (deferred slot, no effect yet) | Voxel cliff SDF chunks |
| Colorize | Texturing | Fill, Speckle, Altitude Tint, Bedding Colour, Rock, Soil, Alluvium, Gravel, Vegetation, Snow, Wetness, Cavity, Hue/Saturation/Lightness | Splat, Weathering, Gamma, CLUTer |
| Derive | Masks | Steepness, Altitude, Curvature, Aspect, Drainage, Wetness, Cavity, Ridge, Noise, Hardness, Sediment | Peaks, Occlusion, Soil, FlowMap variants |

The Construct dialog lists every planned node in its "Planned" group, so the gap stays
visible. Not every Gaea node is covered yet. This increment covers the simple core.

## Limitations

- Heightfield first. Voxel cliffs are a deferred slot and do not change the terrain yet.
- Textures are procedural colour layers. They are not yet material or PBR maps, and they are not exported to an engine.
- The default resolution is 256 cells (1024 m). Hydraulic and stream-power erosion are the slowest steps (about 1 s in Node for the starter stacks). Resolution 512 takes several times longer.
- Lake and river shapes are a practical approximation of Gaea's Rivers and Lake nodes, not a port.
- Water is flat per reach and per lake, with a depth-based shader and no shadows.

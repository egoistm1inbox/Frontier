# Frontier Terrain

A WebGPU terrain generator and texturing tool. You **generate** a terrain with a layer stack, **texture** it with a second layer stack, and look at the result in a physically based viewport. There is no node graph: every operation is a layer with switches and sliders, shown in an inspector styled after `Experimental/FrontierEditor`.

Everything runs on the GPU in the browser. There is no build step and nothing to install.

```
node tools/serve.mjs          # → http://localhost:5180  (binds 0.0.0.0, any static server works)
```

You need a browser with WebGPU turned on: current Chrome or Edge, or another WebGPU-enabled browser with hardware acceleration. A discrete GPU is recommended for 2K/4K builds.

## Workflow

| Step | Where | What happens |
|---|---|---|
| 1. Terrain | **Terrain** tab | Layers evaluate bottom → top. Primitives create elevation, modifiers reshape it, erosion layers simulate on everything below them. |
| 2. Texture | **Texture** tab | Material layers composite bottom → top. Each is placed by rules that read the terrain's simulation maps. |
| 3. Scene | **Scene** tab | Sun, atmosphere, water, world size/resolution, viewport presentation, exposure and grade. |
| 4. Export | **Export** menu | Heightmaps, maps, masks, a textured GLB mesh, screenshots or a ZIP of everything. |

While you drag a slider, builds run at a 512² preview resolution. When you release, the terrain rebuilds at the selected resolution (512 / 1K / 2K / 4K). Builds can be cancelled midway, and everything below the last simulation is cached, so editing layers above an erosion pass is cheap. You can also turn **Auto** off and build by hand (Ctrl+B).

## Terrain layers

| Category | Layers |
|---|---|
| Primitives | Mountains (massif / range / field of ridged peaks), Noise (fBm, ridged, billow, Swiss, erosive, cells, cracks), Volcano, Crater, Canyonlands (mesas), Dunes, Shape (island, edge, gradient, cone, plateau) |
| Modifiers | Warp, Terrace (strata with dip), Height Curve (levels, gamma, free monotone curve), Smoothen / sharpen / fill valleys / soften peaks |
| Erosion | **Fluvial**: stream-power river incision with an implicit solver, MFD drainage, channel initiation, hillslope talus and soil creep, optional tectonic uplift. **Hydraulic**: GPU droplet erosion in physical units, with sediment as volume, per-metre rates and terminal velocity. **Thermal**: angle-of-repose slides. |
| Water | **Hydrology**: Priority-Flood rivers and lakes with carved channels and valleys. **Snowfall**: altitude, aspect and wind-driven snow with avalanching. |

Every generator has eight blend modes (add, max, min, subtract, multiply, replace, smooth max, smooth min) plus opacity. Every layer can be masked by height, slope, noise or radius.

The simulations write attribute maps used later by texturing: flow, wear, deposits, talus, snow and water.

## Texture layers

A material layer has a two-tone albedo with procedural variation, roughness, a surface-detail type (rock, ground, vegetation, snow, forest canopy) and optional sedimentary strata. It is placed by any combination of these rules:

**height · slope · curvature · flow · wear · deposits · talus · snow · shoreline · aspect · occlusion · noise**

Each rule has a range and a falloff. On top of that, coverage, edge noise and sharpness break up the transitions. Blend modes are Normal, Multiply, Overlay, Recolor and Wetness. Presets come with plausible real-world albedos.

## Viewport

- **Terrain:** CDLOD quadtree (Strugar 2010) with continuous morphing, skirts and diorama walls. Close-range micro-displacement comes from the material detail maps.
- **Sky and atmosphere:** after Hillaire 2020. Transmittance, multiple-scattering, sky-view and froxel aerial-perspective LUTs; an ambient-cube sky irradiance; a sun disk with limb darkening; analytic valley fog.
- **Shading:**
  - GGX specular plus diffuse, with wrap lighting for snow and an opposition hotspot for vegetation.
  - Horizon-based sky occlusion and soft terrain sun shadows.
  - Terrain inter-reflection.
  - Wet surfaces get darker and smoother.
  - Triplanar rock detail and a forest-canopy crown pattern.
- **Water:** rivers, lakes and sea. Refraction re-shades the river or lake bed. Beer–Lambert absorption, in-water scattering, Fresnel with F₀ = 0.02, sky reflection, sun glint and procedural waves.
- **Image:** HDR with 4× MSAA, physically based bloom, AgX / ACES / Khronos Neutral display transforms, auto exposure, vignette and grain.
- **Surroundings:** Diorama (walls on a studio floor), Mirror (the terrain mirrored out to the horizon) or Ocean.
- **View modes:** lit, clay, albedo, normals, height, slope, flow, wear, deposits, talus, snow, water, curvature, occlusion, selected layer mask and LOD. Contour and grid overlays are available on top.
- **Rendering cost:** frames render only when something changes or the camera moves.

### Camera (Unreal-style)

| Input | Action |
|---|---|
| Right mouse drag | Look |
| W A S D / Q E (while hovering the viewport) | Fly / down–up |
| Shift | Boost |
| Wheel | Dolly. Hold the right mouse button to change fly speed instead. |
| Left mouse drag | Move forward/back and turn |
| Middle mouse drag | Pan |
| Alt + left drag | Orbit around the point under the view centre |
| L + left drag | Move the sun |
| F | Frame the terrain |

### Shortcuts

`Shift+A` add layer · `Del` delete · `Ctrl+D` duplicate · `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo · `Ctrl+B` build · `Ctrl+S` save project · `Ctrl+O` open project · `P` screenshot · `1 2 3` switch tabs

Double-click a slider to reset it. Click a value to type a number. Hold Shift while dragging for fine control.

## Export

- **Heightmap:**
  - 16-bit PNG (normalised; the min/max height in metres is in the file name).
  - RAW R16 little-endian.
  - RAW 32-bit float in metres.
- **Maps:**
  - albedo (sRGB);
  - normal map (OpenGL convention);
  - splat weights (R rock, G ground, B vegetation, A snow);
  - 16-bit masks: flow, wear, deposits, talus, snow, water, occlusion, slope.
- **Mesh:** GLB, up to a 1025² grid, with normals, UVs and the albedo embedded.
- **Package:** all of the above in a ZIP, with a README of the scale values.
- **Project:** the project file (JSON). The project also autosaves to localStorage.

## Presets

Alpine Range (default), Desert Mesa, Volcanic Island, Highland Fjords, Dune Sea and Blank. Open them from **Projects**.

## URL parameters

`?preset=alpine|mesa|island|fjords|dunes|blank` · `?fresh=1` (ignore the autosave) · `?res=512…4096` · `?test=1` (low-cost mode: 256² build and half render scale, for headless or software adapters) · `?tab=terrain|texture|scene` · `?view=<mode id>` · `?cam=x,y,z,yaw,pitch`

## Code map

```
index.html, styles/app.css      UI shell and design system (FrontierEditor tokens: DM Sans, graphite cards, switch tiles)
src/main.js                     orchestration: build → derive → composite → render pipeline, top bar, viewport overlays, keys
src/app/                        project store (undo/redo, autosave), presets
src/core/                       WebGPU context and helpers, math
src/wgsl/noise.js               shared noise library (gradient noise, fBm, ridged, erosive, Voronoi, warps)
src/terrain/layer-types.js      terrain layer registry: inspector schema + WGSL per layer
src/terrain/engine.js           stack evaluation, caching, thumbnails
src/terrain/sims.js             fluvial, hydraulic, thermal, snow simulations (+ hydrology worker)
src/terrain/derived.js          normals + sky occlusion, attribute packing, shadows, LOD bounds, CPU height queries
src/texture/                    material registry and the single-pass GPU compositor
src/render/                     camera, CDLOD, atmosphere, detail maps, shaders, renderer + post
src/ui/                         inspector, layer stack, construct modal, controls, icons (Lucide, ISC)
src/io/export.js                PNG/ZIP/GLB writers, project files
tools/serve.mjs                 zero-dependency static server
```

## Credits

- DM Sans (SIL OFL 1.1): `assets/fonts/OFL.txt`.
- Lucide icons (ISC): `assets/LUCIDE-LICENSE.txt`.
- Techniques after:
  - Strugar, *Continuous Distance-Dependent Level of Detail for Rendering Heightmaps* (2010);
  - Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering Technique* (2020);
  - Braun & Willett (2013) and Cordonnier et al. (2016) on stream-power erosion;
  - Barnes et al., *Priority-Flood* (2014);
  - Mei et al. / Lague on droplet erosion;
  - Jimenez (2014) on bloom;
  - Sobotka's AgX.

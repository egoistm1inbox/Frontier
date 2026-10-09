# Landscape Editor

A heightmap editor whose terrain comes from an ordered layer stack. Erosion is simulated on the stack, and a procedural satellite-style colour map (the "satmap") is draped over the result.

Location: `Experimental/LandscapeEditor/`. Plain ES modules with no build step and no dependencies. The UI follows the layout of `Experimental/ProjectZeroEditor`: top bar, layer stack on the left, viewport in the centre, inspector on the right, status bar along the bottom.

## Run

```sh
cd Experimental/LandscapeEditor
python3 -m http.server 8080
```

Open http://localhost:8080/. Any static server works. The 3D view needs WebGL2. Without it, the viewport shows a message and the 2D views still work.

## Tests

```sh
cd Experimental/LandscapeEditor
npm test
```

Runs three Node checks with no installs (tested on Node 22):

- `CheckRng.mjs`: the PRNG, hashes and noise are deterministic and in range.
- `CheckErosion.mjs`: hydraulic mass balance (the change in total height equals minus the reported lost sediment); thermal mass balance and steepest slope at or below the talus angle; every interior cell drains to the border, and outlet areas sum to N²; pure fluvial incision never raises the ground; cancellation stops the solvers.
- `CheckPipeline.mjs`: the default project evaluates; editing the top layer reuses the cached lower layers; the same seed gives identical output; blend modes, project normalisation, satmap determinism and the 16-bit encoding.

## Layout

- **Layers (left).** Height layers run bottom to top in evaluation order. Texture layers come last. Drag a row above or below another row of the same kind to reorder it. The eye toggle bypasses a layer, which keeps its thumbnail and clears its stats. The "+ Add layer" menu lists the layer types, grouped by kind.
- **Viewport (centre).** A 3D view (drag to orbit, Shift or right-drag to pan, wheel to zoom) and five 2D views: Satmap, Height, Slope, Flow (drainage, log scale) and Sediment. Hovering over a 2D view shows a readout of position, altitude, slope and drainage area. "Satmap texture" and "Water" toggle the 3D surface; "Recompute" forces an update.
- **Inspector (right).** Shows the selected layer: name, description, enable toggle, move, duplicate, reset and delete buttons, then its parameter cards. The Map row shows the terrain settings: grid, extent, height range, sea level and seed (with a randomise button). Viewport settings are kept apart from the undo history.
- **Top bar.** Project name, undo and redo, New, Open, Save JSON, Export .r16 and Export satmap.
- **Status bar.** Compute state and time, elevation range, share of the map under water and mean slope.

Keyboard: Ctrl+Z undo; Ctrl+Y or Ctrl+Shift+Z redo; Delete or Backspace removes the selected layer; R recomputes; Escape closes the add menu.

## Model

A project is the terrain settings plus an ordered list of layers. Layer and terrain edits are undoable with Ctrl+Z. Viewport settings are not.

**Terrain settings.** Grid (128, 256, 384 or 512 cells per side), extent in metres (default 6144), height range in metres (default 1000), sea level in metres (default 180) and seed (default 1337). Heights are stored normalised to 0–1 and scaled by the height range.

**Layer kinds.**

| Kind | Types |
| --- | --- |
| Generators | Fractal noise, Ridged mountains, Island falloff, Base level, Tilt ramp |
| Erosion | Erosion (choose hydraulic, thermal or fluvial in its dropdown) |
| Shaping | Terrace, Smooth, Levels |
| Texture | Satellite (the satmap) |

Each layer has a name, an enable toggle, an opacity (labelled Strength for erosion and shaping layers), a blend mode and its own parameters. Blend modes combine a layer with the terrain below it:

- Normal: replace, weighted by opacity.
- Add and Subtract: shift the terrain by the layer's offset from a mid level of 0.5.
- Multiply: scale the terrain by the layer.
- Max and Min: keep the higher or lower value.

**Caching.** Each layer's result is cached. The cache key is a hash of the terrain settings, the layer's parameters and the key of the layer below. Editing the top layer therefore reuses everything beneath it. Changing the satmap palette recomputes only the satmap.

**Default stack**, bottom to top: Continental hills (fractal noise), Mountain ridges (ridged, Add at 50%), Coastline mask (island falloff, Multiply), Fluvial valleys (fluvial erosion), Thermal scree (thermal erosion, 70%), Hydraulic gullies (hydraulic erosion, 80%), Satellite · temperate (satmap).

## Erosion

Each erosion layer has a process dropdown. Each process keeps its own parameter set, so switching the type and back does not lose settings. The layer's Strength blends the eroded surface with its input. Each erosion layer reports the volume it removed and the volume it added.

**Hydraulic (droplets).** Rain droplets run downhill, pick up sediment on steep faces, and drop it where the flow slows. This carves gullies and fans. Based on the droplet model of Mei et al. (2007), with the parameterisation of Št'ava et al. (2008) and Beyer (2015).

| Slider | Default | Meaning |
| --- | --- | --- |
| Droplets | 0.50 per cell | Droplets released per cell |
| Lifetime | 50 steps | Steps before a droplet evaporates |
| Inertia | 0.05 | How much a droplet keeps its heading |
| Capacity | 4.0× | Sediment a droplet can carry |
| Erosion | 0.15 | Share of spare capacity picked up per step |
| Deposition | 0.15 | Share of excess sediment dropped per step |
| Evaporation | 0.010 | Water lost per step |
| Gravity | 4.0 | Speed gained per unit of drop |
| Min slope | 0.010 | Floor on capacity, so flats still erode slightly |
| Brush radius | 3 cells | Radius over which erosion is spread |
| Droplet seed | 7 | Which droplets are released |

**Thermal (talus).** Frost wedging, rockfall and creep. Slopes steeper than the talus angle slump until they settle at it, and scree gathers at the foot. Based on Musgrave, Kolb and Mace (1989). Material is conserved, except what leaves through the open border.

| Slider | Default | Meaning |
| --- | --- | --- |
| Talus angle | 34° | Steepest slope the material can hold |
| Transfer | 0.35 | Fraction of the excess moved per pass |
| Iterations | 30 | Relaxation passes |

**Fluvial (rivers).** Stream-power erosion: rivers cut in proportion to the area they drain and to their slope, E = K·A^m·S^n. Hillslope diffusion rounds the ridges and uplift keeps the relief alive. Depressions are filled with Priority-Flood, and water is routed with D8. Uplift is capped so heights stay at or below 1.

| Slider | Default | Meaning |
| --- | --- | --- |
| Erodibility (K) | 0.040 | How easily the rock is cut |
| Area exponent (m) | 0.50 | Weight of drainage area |
| Slope exponent (n) | 1.00 | Weight of slope |
| Uplift | 0.0005 | Rock raised per iteration |
| Diffusion | 0.030 | Hillslope creep per iteration |
| Time step | 1.00 | Scale of each iteration |
| Iterations | 60 | Number of landform steps |

## Satmap

The satmap is a procedural, satellite-imagery-style colour map. It is not built from photographs and has no real-world georeferencing. Colours follow rules driven by the terrain:

- Water is coloured by depth below sea level.
- Sand forms a ring on the beach.
- Rock covers steep faces and ridges, and scree sits at their foot.
- Alluvium is laid down where the erosion deposited material.
- Vegetation thins with slope and altitude, and forest grows in wet valleys.
- Snow lies above the snowline.
- Hillshade and cavity shading give relief, and field patches and grain break up the surface.

Palettes: Temperate (default), Arid, Alpine, Tropical, Boreal, Autumn. Resolution: 512, 1024 (default) or 2048 px. Parameters: vegetation (0.70), wetness (0.60), rock slope (34°), snowline (900 m), hillshade (0.60), detail (0.50), saturation, contrast, sun azimuth (315°) and sun elevation (38°).

## Export and save

- **Save JSON** downloads `<name>.landscape.json`. It holds the parameters only, not the height arrays. **Open** reads it back. Missing or invalid fields fall back to defaults.
- **Export .r16** downloads `<name>-<N>x<N>.r16`: N×N unsigned 16-bit little-endian samples, row 0 at the north edge. Each value is the normalised height × 65535. The file is 2·N² bytes. Multiply by the height range to recover metres.
- **Export satmap** downloads `<name>-satmap-<px>.png`.
- The editor also autosaves to `localStorage` under `Frontier.LandscapeEditor.v1`. The autosave is per browser and holds parameters only. Clearing site data removes it.

## Performance

Recomputes run in a module worker, so the UI stays responsive, and a new job cancels the one in progress. Times below were measured in headless Chromium on a two-core sandbox with software WebGL:

- Default stack at 256²: about 2.5 s for a full compute.
- 512²: about 7.4 s for a full compute after a grid change.

Node, without the UI, takes about 6.5 s at 512².

## Limitations

- **The satmap is procedural.** It imitates satellite colour using rules. It does not show real places.
- **Erosion is an approximation.** It is tuned for plausible results, not calibrated to real rock, rainfall or time. Results depend on grid size, because droplet density and flow areas are counted per cell. Retune when you change the grid.
- **The height map is softer than ideal.** Hydraulic density and speeds were lowered to stop bright streaks, which gives softer relief.
- **The fluvial "Added" stat includes uplift.** It is not net deposition.
- **WebGL2 is required for the 3D view.** The 2D views work without it.
- **Testing is limited.** Checks ran in headless Chromium with software WebGL (SwiftShader). There was no real-GPU test, and Firefox and Safari were not tested.

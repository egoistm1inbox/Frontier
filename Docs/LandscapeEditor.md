# Landscape Editor

A heightmap editor whose terrain comes from an ordered layer stack. Erosion is simulated on the stack, and a procedural satellite-style colour map (the "satmap") is draped over the result.

The layer stack includes the 28 primitive types from Section 1 of the node list. Each one is its own layer type. It also includes six geological landform nodes, inspired by Hesiod's Primitive/Geological group, and a falloff that limits any generator to a region.

The Mesa country work adds a mesa field, a stratigraphic column, a lake and a playa. It also adds a desert palette for the satmap, with strata, desert varnish, sand, playa cracks, shrubs and cast shadows. New starts from either the default continental stack or the Mesa country template. The other categories are still to come.

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

Runs seven Node checks with no installs (tested on Node 22):

- `CheckRng.mjs`: the PRNG, hashes and noise are deterministic and in range.
- `CheckErosion.mjs`: hydraulic mass balance; thermal mass balance and steepest slope at or below the talus angle; every interior cell drains to the border and outlet areas sum to N²; pure fluvial incision never raises the ground; cancellation stops the solvers.
- `CheckPipeline.mjs`: the default stack (eight layers, 1k grid) evaluates; editing the top layer reuses the cached layers beneath it; blend modes; project normalisation, including the version 1 migrations (`noise` becomes `fbm`, `base` becomes `constant`); the working-grid cap; satmap determinism; the 16-bit encoding.
- `CheckPrimitives.mjs`: the 28 types match Section 1. Each is finite, in [0, 1], has relief and is deterministic. Seeded types respond to the seed, and the fixed patterns ignore it. No two types are near duplicates (|r| ≤ 0.9).
- `CheckExport.mjs`: at the working size the heightmap is an exact copy. The upscale reproduces the working samples and follows the terrain between them. The synthesised detail is capped at 0.02 of the height range and is deterministic for a seed.
- `CheckGeological.mjs`: each landform is finite, deterministic and in range, sits at the zero level outside its footprint, and has its defining feature (the summit, the crater rim, the rift shoulders, the flat mesa top). The falloff mask is 1 inside its region and 0 outside, and respects its shape, softness and strength.
- `CheckMesa.mjs`: the mesa profile is flat on top, steep at the cliff and falls monotonically over the talus. The mesa field is in range, is deterministic, and its mesas differ in size. The stratigraphy is monotonic and continuous at every unit boundary, and it steps only ground steeper than its gate. A lake bed lies below its water level, a playa floor is flat, and a basin never raises low ground. Cast shadows fall away from the sun. The desert satmap is opaque, varied and deterministic. Its desert features do nothing on temperate palettes. The Mesa country template evaluates, survives a save and open, and the default stack still matches its recorded hashes.

Browser checks (menus, filter, drag and drop, undo, erosion dropdowns, export files, open and save, a 512 recompute) were run ad hoc in headless Chromium. They are not part of `npm test`. The mesa work was also checked in headless Chromium, with no page errors: the Add menu (45 entries in 13 sections), the New menu, the Mesa country template, undo and redo of New, the four new layer types added by hand, and the satmap and stratigraphy inspectors.

## Layout

- **Layers (left).** Height layers run bottom to top in evaluation order. Texture layers come last. Drag a row above or below another row of the same kind to reorder it. The eye toggle bypasses a layer, which keeps its thumbnail and clears its stats.
- **Add menu.** "+ Add layer" opens a list grouped into Primitives (basic, noise, cells, fractals, patterns, waves), Shapes, Geological · landforms, Stratigraphy, Water · basins, Erosion, Shaping and Texture (13 sections, 45 entries). The filter field at the top narrows the list as you type. Each entry has a one-line description. Adding a layer closes the menu. The Geological section lists the six landform nodes and the mesa field. Stratigraphy holds the stratigraphic column. Water · basins holds the lake and the playa.
- **Viewport (centre).** A 3D view (drag to orbit; right-drag, middle-drag or Shift-drag to pan, so the scene follows the cursor; wheel to zoom) and five 2D views: Satmap, Height, Slope, Flow (drainage, log scale) and Sediment. The 3D mesh has at most 1024 cells a side. Larger grids are averaged down for display only. Hovering over a 2D view shows a readout of position, altitude, slope and drainage area. "Satmap texture" and "Water" toggle the 3D surface. "Recompute" forces an update.
- **Inspector (right).** Shows the selected layer: name, description, enable toggle, move, duplicate, reset and delete buttons, then its parameter cards. Generator layers (primitives, shapes and geological landforms) also have a Falloff card (see Falloff). The Map row shows the terrain settings: grid, extent, height range, sea level and seed (with a randomise button). Viewport settings are kept apart from the undo history.
- **Top bar.** Project name, undo and redo, New, Open, Save JSON, Export .r16 and Export satmap. New opens a menu of two starting stacks, Default · continental and Mesa country. Choosing one replaces the project. Ctrl+Z brings the previous project back, name included.
- **Status bar.** Compute state and time, elevation range, share of the map under water and mean slope. During an export it shows "Exporting heightmap" or "Exporting satmap" with progress.

Keyboard: Ctrl+Z undo; Ctrl+Y or Ctrl+Shift+Z redo; Delete or Backspace removes the selected layer; R recomputes; Escape closes the add menu and the New menu. The undo, delete and R keys do nothing while focus is in a text field, such as the filter.

## Resolution

Three sizes are involved, and they differ:

| Setting | Options | Default | Meaning |
| --- | --- | --- | --- |
| Grid (output) | 512, 1024, 2048, 4096, 8192, 16384 | 1024 | Cells per side of the terrain you export |
| Working grid | the smaller of the grid and 2048 | follows the grid | The grid erosion and the satmap analysis run on |
| Satmap export | 1024, 2048, 4096, 8192, 16384 px | 1024 | Pixels per side of the satmap PNG |

- Above 2048 the output is not simulated at that resolution. The 2048 result is interpolated with a Catmull-Rom bicubic filter, and detail is then added: 1 to 4 octaves of noise, scaled by the local slope and capped at 2% of the height range. The landforms are the 2048 ones. The finest detail is texture, not a finer simulation. Say so when you quote a 4k to 16k export.
- The satmap preview in the viewport is capped at 1024 px. The 3D mesh is capped at 1024 cells.
- The default 1024 grid is the working grid, so the default has no upscaling.

## Model

A project is the terrain settings plus an ordered list of layers. Layer and terrain edits are undoable with Ctrl+Z. Viewport settings are not.

**Terrain settings.** Grid (default 1024, see Resolution), extent in metres (default 6144), height range in metres (default 1000), sea level in metres (default 180) and seed (default 1337). Heights are stored normalised to 0–1 and scaled by the height range.

**Layer kinds.**

| Kind | Types |
| --- | --- |
| Primitives | The 28 types in the Primitives section below. Each is one algorithm. |
| Geological | Mountain cone, Radial mountain range, Mesa, Inselberg, Crater, Rift valley (see Geological landforms), Mesa field (see Mesas, strata and water) |
| Stratigraphy | Stratigraphy: rock units laid in beds, which step the steep ground (see Mesas, strata and water) |
| Water | Lake, Playa (see Mesas, strata and water) |
| Shapes | Island falloff, Tilt ramp |
| Erosion | Erosion (choose hydraulic, thermal or fluvial in its process dropdown) |
| Shaping | Terrace, Smooth, Levels |
| Texture | Satellite (the satmap) |

Each layer has a name, an enable toggle, an opacity (labelled Strength for erosion and shaping layers), a blend mode and its own parameters. Blend modes combine a layer with the terrain below it:

- Normal: replace, weighted by opacity.
- Add and Subtract: shift the terrain by the layer's offset from a mid level of 0.5.
- Multiply: scale the terrain by the layer.
- Max and Min: keep the higher or lower value.

**Caching.** Each layer's result is cached. The cache key is a hash of the terrain settings, the layer's parameters and the key of the layer below. Editing the top layer therefore reuses everything beneath it. Changing the satmap palette recomputes only the satmap.

**Default stack**, bottom to top:

1. Continental hills: fBm, 7 octaves, domain warp 0.45, relief 1.3.
2. Mountain ridges: ridged multifractal, Add at 50%.
3. Foothills: billow, Add at 20%, relief 0.8.
4. Coastline mask: island falloff, Multiply.
5. Fluvial valleys: fluvial erosion.
6. Thermal scree: thermal erosion, 70%.
7. Hydraulic gullies: hydraulic erosion, 80%.
8. Satellite · temperate: satmap.

Falloff is off in the default stack, so the default terrain is unchanged.

The **Mesa country** template is the second starting point. See Mesas, strata and water.

## Primitives

Each primitive is a separate layer type with its own controls. None of them is a catch-all layer. Each one also has a Falloff card (see Falloff).

Every raw field is standardised to 2.5 standard deviations and clamped to ±1. Relief (the fraction of the height range) and Offset then place it on the common 0–1 scale. Constant is the only exception: it is a flat level. Frequency is the number of features across the map. Resolution does not change the look.

| # | Type | Family | Algorithm | Main controls | Source |
| --- | --- | --- | --- | --- | --- |
| 1 | Constant | Basic | A flat level | Value | — |
| 2 | Perlin noise | Noise | Classic gradient noise, quintic fade | Frequency, Relief, Offset, Seed | Perlin 2002 |
| 3 | Simplex noise | Noise | Simplex gradient noise on a triangular lattice | Frequency, Relief, Offset, Seed | Gustavson 2005 |
| 4 | Value noise | Noise | Random values on a lattice, interpolated | Frequency, Curve (linear or smooth) | Standard lattice noise |
| 5 | Wavelet noise | Noise | Periodic band-pass random tile, sampled bicubically. Simplified; not isotropic | Frequency | Cook & DeRose 2005 (simplified) |
| 6 | Gabor noise | Noise | Oriented band-limited cosine kernels, scattered one per cell | Frequency, Bandwidth, Carrier, Direction, Impulses per cell | Lagae et al. 2009 |
| 7 | Sparse convolution | Noise | Isotropic Gaussian kernels, scattered one per cell | Frequency, Bandwidth, Impulses per cell | Lagae et al. 2009 |
| 8 | Random cells | Cells | A random height for each block of cells | Cell size, Relief, Seed | — |
| 9 | Voronoi F1 | Cells | Distance to the nearest feature point | Frequency, Jitter | Worley 1996 |
| 10 | Voronoi F2 | Cells | Distance to the second-nearest feature point | Frequency, Jitter | Worley 1996 |
| 11 | Voronoi F3 | Cells | Distance to the third-nearest feature point | Frequency, Jitter | Worley 1996 |
| 12 | Voronoi F4 | Cells | Distance to the fourth-nearest feature point | Frequency, Jitter | Worley 1996 |
| 13 | Voronoi crackle | Cells | F2 minus F1: cracks along cell edges | Frequency, Jitter, Width | Worley 1996 (crackle form) |
| 14 | Worley cells | Cells | A random height per feature point, blended by inverse distance | Frequency, Jitter, Sharpness | Worley 1996 |
| 15 | Cellular automaton | Cells | Random seed cells run through a cave rule on a coarse periodic grid, then resampled | Frequency, Fill, Steps | Standard cave rule |
| 16 | Fractal Brownian motion | Fractals | Summed octaves of gradient noise, with optional domain warp | Frequency, Octaves, Lacunarity, Gain, Warp | Musgrave 1994 |
| 17 | Ridged multifractal | Fractals | Folded octaves that give sharp crests and valleys | Frequency, Octaves, Sharpness, Warp | Musgrave 1994 |
| 18 | Billow | Fractals | Folded octaves that give rounded, pillow-like bumps | Frequency, Octaves | Musgrave 1994 |
| 19 | Swiss turbulence | Fractals | Squared distance to zero crossings of each octave, fed back on itself. Ridged channels with holes | Frequency, Octaves, Warp | Interpretation, not a published formula |
| 20 | Jordan turbulence | Fractals | Two domain-warp stages, then fBm. Swirled, eroded-looking masses | Frequency, Octaves, Warp | Interpretation, not a published formula |
| 21 | Grid lines | Patterns | Straight lines on a regular grid | Frequency, Width, Softness | — |
| 22 | Hexagonal tiles | Patterns | Hexagonal cells with bevelled edges | Frequency, Bevel | — |
| 23 | Brick bond | Patterns | Running-bond brickwork with mortar joints and per-brick variation | Frequency, Aspect, Mortar, Variation | — |
| 24 | Checkerboard | Patterns | Alternating squares with soft or sharp edges | Frequency, Softness | — |
| 25 | Stripes | Patterns | Straight stripes at any angle | Frequency, Angle, Duty, Softness, Phase | — |
| 26 | Sine wave | Waves | A sine undulation across the map at any angle | Frequency, Angle, Phase | — |
| 27 | Sawtooth | Waves | A ramp that climbs and drops sharply each period | Frequency, Angle, Phase | — |
| 28 | Triangle wave | Waves | A linear rise and fall each period | Frequency, Angle, Phase | — |

Shapes, which are not primitives but generate heights: **Island falloff** (a radial mask with a wobbly coastline, to be multiplied into the stack) and **Tilt ramp** (a linear slope across the map).

**Sources.** Perlin (2002) for classic noise; Gustavson (2005) for simplex noise; Worley (1996) for the F_n distances, the crackle form and the distance-weighted cell values; Lagae et al. (2009, 2010) for Gabor and sparse convolution noise; Cook and DeRose (2005) for wavelet noise, here simplified to a band-pass tile; Musgrave (1994) for fBm, ridged multifractal and billow.

**Interpretations.** Swiss and Jordan turbulence are written for this editor, in the style of the published forms. They are not published definitions, and the names describe a family rather than a standard formula.

**How these compare with Gaea.** They are not Gaea's algorithms. QuadSpinner's node internals are proprietary. Its public documentation lists parameters (for example, the Voronoi Form, Function, Dual and Perturb options) but not the formulas behind them. These primitives use standard published methods. They belong to the same families as some Gaea nodes, but they are not the same code, they do not reproduce Gaea's parameters, and the same settings will not give the same output.

## Falloff

A falloff limits a generator layer to a region, so noise does not run on to the edges of the map. Each generator layer has a Falloff card with a switch, "Limit to a region". The card applies to all 28 primitives, the island and tilt shapes, and the six geological landforms. It is off by default.

- **Shape:** circle, square or diamond.
- **Centre X and Y:** the centre of the region, in percent of the map (50 is the middle).
- **Radius:** the edge of the region, in percent of the half-width. 100 reaches the middle of each edge of the map.
- **Softness:** the width of the fade inside the edge, as a share of the radius. 0 gives a hard edge.
- **Strength:** how far the region limits the layer. 100 removes the layer completely outside the region.

The falloff multiplies the layer's opacity cell by cell. Where it is zero, the layer has no effect in any blend mode, so the terrain below shows through. Erosion and shaping layers have no falloff, because they act on the stack below them.

In the default stack, turning the falloff on for Continental hills (radius 80, softness 40) keeps the hills near the middle of the map. The water share rises from 36% to 64%. Undo restores the default.

## Geological landforms

Six nodes, inspired by the Primitive/Geological group of Hesiod, a node-based terrain generator licensed under GPL-3.0. Each is a finite landform with a centre and a radius, so it stays where it is placed and needs no falloff. They blend in Add mode by default. Outside the landform the ground is at the zero level, so nothing else changes.

The mesa field, which places many mesas at once, is a separate node. See Mesas, strata and water.

| Node | What it makes | Main controls |
| --- | --- | --- |
| Mountain cone | A single conical massif with a sharp summit | Summit sharpness, Rugosity |
| Radial mountain range | Ridges that radiate from a centre, like spokes, around a central massif | Ridges, Ridge sharpness, Roughness |
| Mesa | A mountain with a flat top and steep sides | Steepness, Top height, Rugosity |
| Inselberg | An isolated, rounded rock hill with steep sides | Roundness, Rugosity |
| Crater | A bowl inside a raised rim, with an optional central peak and ejecta outside the rim | Rim height, Rim width, Floor depth, Central peak, Rugosity |
| Rift valley | An elongated depression along an axis, with raised shoulders | Direction, Valley width, Valley depth, Shoulders, Rugosity |

Every node also has Centre X and Y, Radius (percent of the half-width), Height (the tallest feature; 1 is half the height range above the base), Offset, Detail scale, Octaves and Seed.

**Attribution and licence.** Hesiod is licensed under GPL-3.0. The Frontier repository has no licence file, so Hesiod's code cannot be copied in without changing the terms. These nodes are independent implementations of the kinds of landform that Hesiod's documentation describes, written for this editor. No code from Hesiod is used. Reusing Hesiod's code itself would bring in the GPL terms.

## Mesas, strata and water

These layers make the Mesa country template. Each one can also be added to any stack. The mesa field and the stratigraphy shape the ground. The lake and the playa are basins at a set level, and they add water to the satmap.

**Mesa field (Geological).** Many mesas and buttes at once. The map is divided into cells, and each cell may hold one mesa. A mesa has a flat caprock top, a steep cliff band, and a talus apron that falls away at its foot. Each outline is a noisy circle, so no two mesas match. Sizes and top heights vary from mesa to mesa. The cliff profile is a closed-form curve, so it is smooth and monotonic, with no stray peaks. The mesas are added in Add mode, and the Falloff card applies, so a field can be limited to a region.

| Control | Default | Meaning |
| --- | --- | --- |
| Mesas across | 6 | Grid cells across the map (2 to 14) |
| Coverage | 0.60 | Share of the cells that hold a mesa |
| Mesa size | 0.85 | Radius of each caprock top, as a share of its cell |
| Size variation | 0.45 | How much sizes and top heights differ from one mesa to the next |
| Placement jitter | 0.70 | How far each mesa moves from its cell centre. 0 centres them |
| Top height | 260 m | Height of the caprock above the plain |
| Cliff width | 0.22 | Width of the steep band, as a share of the radius. Smaller is steeper |
| Talus apron | 0.70 | Width of the sloping apron at the foot of each cliff |
| Outline | 0.35 | How far each outline strays from a circle. 0 gives round mesas |
| Rugosity | 0.12 | Roughness of the cliffs and talus. The caprock stays flatter |
| Detail scale, Octaves, Seed | 6 cyc, 4, 31 | Scale and detail of the roughness |

**Stratigraphy (Stratigraphy).** A column of rock units laid in beds, between a base altitude and a top. Hard units form flat benches with steep risers, and soft units slope. Only ground steeper than Applies above (default 45°) is stepped, so gentle ground stays smooth. The layer reshapes the terrain below it, inside the column, so erosion layers above it cut through the beds. The satmap colours the rock by the unit it lies in. The mapping is monotonic and continuous at every boundary, so the beds never fold or tear. The beds can dip, and an undulation adds slow waviness.

| Control | Default | Meaning |
| --- | --- | --- |
| Units | 10 | Rock units in the column (2 to 16). The top unit is always hard, as a caprock |
| Unit thickness | 45 m | Average thickness of each unit. Each varies by about 20% |
| Base | 150 m | Altitude of the bottom of the column. Ground below it is not touched |
| Hard units | 0.50 | Share of the units that are hard. Hard units form benches and cliffs |
| Riser sharpness | 0.60 | How steep the risers of the hard units are |
| Applies above | 45° | Only ground steeper than this is stepped. 0 steps all the ground |
| Dip, Dip direction | 3°, 90° | Tilt of the beds, and the compass direction they rise toward |
| Undulation | 12 m | How much the beds wave up and down |

**Lake (Water).** A basin with a flat water surface at the level you set. The bed lies Depth below the surface. A bank rises from the bed across the shore width, and the shoreline is wobbled so it is not a circle. A lake never raises low ground. The satmap paints the water by depth: pale teal on the shallows, deeper teal in the middle, and a muddy rim.

**Playa (Water).** A dry lake bed: a flat clay floor at the floor level. Ground above that level is cut down, and ground below it is filled. The edge blends into the surrounding ground across the shore width. The satmap paints the floor pale, with a crack network.

Both basins take Centre X and Y, Radius (percent of the half-width), Stretch (1 is round), Direction, a level, shore width, edge wobble and Seed. The lake adds Depth. The playa's level is its Floor level.

**Mesa country template.** New, then Mesa country, builds this stack, bottom to top:

1. Plateau base: fBm, a low plain.
2. Mesa field: five cells across, coverage 0.5, caprock 300 m.
3. Butte field: eleven cells across, caprock 150 m, steeper talus. Smaller buttes sit between the mesas.
4. Stratigraphy: 12 units, 40 m each, base 120 m, beds dipping 3° and rising toward the east, undulation 20 m.
5. Fluvial canyons: fluvial erosion, 80 iterations, erodibility 0.05.
6. Thermal talus: thermal erosion at 60% strength, talus 50°.
7. Playa: floor at 240 m, centred at 66%, 64%.
8. Reservoir: lake at 190 m, centred at 24%, 72%.
9. Mesa country texture: the desert satmap, with strata 0.6, varnish 0.35, sand 0.8 and cast shadows 0.85.

The terrain is 1k (1024 cells), 6144 m across, with a 1000 m height range, sea level 0 and seed 1337. Sea level is 0 because the basins are the only water. The stack computes in about 12 s in Node, and 12.8 s in headless Chromium. Fluvial takes about 5 s of that, and the satmap about 2 s. The result has caprock mesas on banded cliffs, talus at their feet, sand and wash on the plain, a cracked playa and a flat reservoir. Its quality is stylised and procedural. The weaknesses are listed under Limitations. Its parameters were tuned by eye, so they are a starting point.

## Erosion

Each erosion layer has a process dropdown. Each process keeps its own parameter set, so switching the type and back does not lose settings. The layer's Strength blends the eroded surface with its input. Each erosion layer reports the volume it removed and the volume it added.

**Hydraulic (droplets).** Rain droplets run downhill, pick up sediment on steep faces, and drop it where the flow slows. This carves gullies and fans. Based on the droplet model of Mei et al. (2007), with the parameterisation of Št'ava et al. (2008) and Beyer (2015). It is the slowest stage: its cost is per droplet step, and about 4.5 s at 1024².

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

**Thermal (talus).** Frost wedging, rockfall and creep. Slopes steeper than the talus angle slump until they settle at it, and scree gathers at the foot. Based on Musgrave, Kolb and Mace (1989). The solver runs in-place alternating sweeps, which settle to the talus angle. Material is conserved, except what leaves through the open border. About 0.6 s at 1024².

| Slider | Default | Meaning |
| --- | --- | --- |
| Talus angle | 34° | Steepest slope the material can hold |
| Transfer | 0.35 | Fraction of the excess moved per pass |
| Iterations | 30 | Relaxation passes |

**Fluvial (rivers).** Stream-power erosion: rivers cut in proportion to the area they drain and to their slope, E = K·A^m·S^n. Hillslope diffusion rounds the ridges and uplift keeps the relief alive. Depressions are filled with Priority-Flood (Barnes et al. 2014) and water is routed with D8 (O'Callaghan and Mark 1984). The router uses a bucket queue and accumulates drainage area in topological order. Its routing is recomputed every 3 iterations (`routeEvery`). In a 384² test this changed heights by an RMS of 0.00051 of the height range (maximum 0.0155) and changed total incision by 0.3%, against routing every iteration. Uplift applies to border cells too, so there is no step at the map edge. Uplift is capped so heights stay at or below 1. About 5.1 s at 1024².

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

Palettes: Temperate (default), Arid, Alpine, Tropical, Boreal, Autumn, and Mesa country. Export size: 1024 (default), 2048, 4096, 8192 or 16384 px. The viewport preview is capped at 1024 px. Parameters: vegetation (0.70), wetness (0.60), rock slope (34°), snowline (900 m), hillshade (0.60), detail (0.50), saturation, contrast, sun azimuth (315°) and sun elevation (38°).

**Mesa country palette.** This palette turns on the desert features. Each one is off at zero, and the temperate palettes ignore them, so their output is unchanged.

- **Strata** colours the bedrock by the unit it lies in, so cliffs show bands. It needs a Stratigraphy layer below.
- **Desert varnish** adds dark mineral streaks, on the cliff faces only.
- **Sand and wash** puts pale sand on gentle ground and in the dry channels.
- The playa floor is pale, with a crack network. Shrubs and juniper grow on the caprock, and wind ripples mark the sand. Lake water is pale teal on the shallows, deeper teal in the middle, with a muddy rim.
- **Cast shadows** (any palette) darken the ground that a ridge or cliff shades from the sun. Its strength is the control's value, and it uses the same sun as hillshade.

## Export and save

- **Export .r16** downloads `<name>-<N>x<N>.r16`, where N is the output grid (512 to 16384). The file holds N×N unsigned 16-bit little-endian samples, row 0 at the north edge. Each value is the normalised height × 65535. The file is 2·N² bytes: 2,097,152 bytes at 1024, 536,870,912 bytes at 16384. Multiply by the height range to recover metres.
- **Export satmap** downloads `<name>-satmap-<px>.png` for the top-most enabled satmap layer, at its export size. If the stack has no satmap layer, the export says so.
- Exports run in the worker. The worker evaluates the current stack (cached when the preview is up to date), writes the file at full size, and transfers it back. One export runs at a time. The status line shows progress.
- **Save JSON** downloads `<name>.landscape.json`. It holds the parameters only, not the height arrays. **Open** reads it back. Missing or invalid fields fall back to defaults. Projects saved by the first version still open: `noise` becomes `fbm`, and `base` becomes `constant`.
- The editor also autosaves to `localStorage` under `Frontier.LandscapeEditor.v1`. The autosave is per browser and holds parameters only. Clearing site data removes it.

## Performance

Recomputes run in a module worker, so the UI stays responsive, and a new job cancels the one in progress. Measured in this sandbox, which has two cores. Node figures are single runs of single-threaded JavaScript. Browser figures are headless Chromium with software WebGL.

| Case | Where | Time | Peak memory |
| --- | --- | --- | --- |
| Default stack, 1024² | Node | 12.2 s (12.6–13.4 s in other runs) | — |
| Default stack, 1024², first compute | Headless Chromium | 14.5–15.5 s | — |
| Grid change to 512² | Headless Chromium | 4.5 s | — |
| Grid change to 2048² (3D mesh decimated to 1024) | Headless Chromium | 53 s (one run) | — |
| Erosion at 1024²: fluvial, hydraulic, thermal | Node | 5.1 s, 4.5 s, 0.6–0.9 s | — |
| Flow routing, 1M cells | Node | 175 ms (the heap version took 290 ms) | — |
| Delivered code (ca56ae1), 1024² | Node | 23.3 s | — |
| 4096² output, 2048² working grid | Node | 50.6 s evaluate, 2.2 s heightmap, 11.4 s satmap | 464 MB |
| 16384² output, 2048² working grid | Node | 55.3 s evaluate, 49.4 s heightmap, 149 s satmap (268 M px) | 0.9 GB heightmap, 2.0 GB satmap |
| 16384² output | Browser | Not tested | — |
| Geological landform, 1024² (each of the six nodes) | Node | 0.14–0.34 s | — |
| Falloff mask, 1024² | Node | 0.04 s | — |
| Mesa country stack, 1024² | Node | 12.0 s (11–15 s over several runs). Fluvial about 5 s, satmap about 2 s, thermal 0.5–0.7 s, playa and reservoir about 0.06 s each | — |
| Mesa country stack, 1024², first compute after New | Headless Chromium | 12.8 s (one run) | — |
| Mesa country satmap, 2048 px | Node | 5.2 s | — |
| Mesa country satmap, 4096 px | Node | 19.6 s | — |
| Mesa country satmap, 16384 px | Node | Not run. About 5 min, estimated as 16 times the 4096 time | — |
| Mesa country satmap, 16384 px | Browser | Not tested | — |

## What changed for "looks basic"

The delivered default was 256². The new default is 1024², which has 16 times as many cells. The numbers below compare the delivered code and the new default at the same 1024² grid, so the change in stack and erosion is separated from the change in resolution. Each measurement uses a single run.

| Measure (both at 1024²) | Delivered (ca56ae1) | Now (default) |
| --- | --- | --- |
| Elevation range | 0–975 m | 25–955 m |
| Under water | 33.9% | 36.0% |
| Mean slope | 27.9° | 27.4° |
| 90th-percentile slope | 49.5° | 49.9° |
| Worst border step, relative to interior variation | 3.43 | 1.13 |
| Cells in channels (drainage area ≥ 0.5% of the map) | 0.70% | 0.74% |
| Fine-scale share (24 m residual) | 0.012 | 0.011 |
| Compute in Node | 23.3 s | 12.2 s |

The delivered default at 256² was 0–905 m, 34.5% under water, mean slope 22.1°, 90th-percentile slope 41.3°, and took 2.1 s.

Definitions: the border step is the mean height change across each outer edge, relative to the same measure 10 cells inside, and the worst of the four edges is shown. Channel share is the fraction of cells whose D8 drainage area is at least 0.5% of the map. The fine-scale share is the standard deviation of the height minus a box blur of radius 24 m (4 cells at 1024²), divided by the standard deviation of the height.

What the numbers show: the aggregate statistics barely move at matched resolution. The border frame is gone. Looking at the hillshades, the ridges and valleys are more clearly separated, but I did not find a measure that shows a large gain in texture. The fine grain on slopes is still visible and is the next thing to fix.

## Limitations

- **Not Gaea's algorithms.** See "How these compare with Gaea" above.
- **Only Section 1 is in.** The primitives are the first category. The other categories are still to come.
- **16k has not been tested in a browser.** The Node figures above show the work. The 16384² satmap is 1 GB of RGBA data, and its PNG needs a 16384² canvas. Browser canvas or memory limits may stop it. If it fails, export a smaller satmap.
- **Above 2048 the detail is synthesised.** See Resolution.
- **The geological nodes are simpler than Hesiod's.** Each landform is one formula with fBm detail. They do not have Hesiod's envelope input or its post-processing controls (Gain, Gamma, Invert output, Remap, Saturation, Smoothing). The shaping layers (Terrace, Smooth, Levels) cover part of that.
- **Other Hesiod generators are not added yet.** Dunes, tectonic plates, basalt fields, shattered peaks, dendritic patterns and island chains are still to come.
- **The falloff has circle, square and diamond shapes.** Hesiod's Euclidean-Chebyshev blend is not included.
- **Fine grain remains.** Speckle on the slopes is still visible in the hillshade. I have not yet traced its source.
- **At 512 the peaks clip at the height range.** The default stack reaches the 1000 m ceiling on a 512 grid, while the 1024 grid peaks at 955 m. Raise the height range, or lower the relief of the layers that drive the peaks.
- **The satmap is procedural.** It imitates satellite colour using rules. It does not show real places.
- **Erosion is an approximation.** It is tuned for plausible results, not calibrated to real rock, rainfall or time. Results depend on grid size, because droplet density and flow areas are counted per cell. Retune when you change the grid.
- **The fluvial "Added" stat includes uplift.** It is not net deposition.
- **Closed depressions fill with water.** A closed depression below sea level is filled and coloured as a lake in the satmap. The Lake and Playa layers make deliberate basins, which are not tied to sea level.
- **Water is not simulated.** A lake or playa is a fixed basin at the level you set. It has no inflow, outflow or evaporation. The 3D water plane is drawn at sea level only, and only when the sea reaches the land (sea level above the lowest ground). A lake or playa shows as a coloured floor in 3D.
- **The mesa look is stylised.** The caprock tops are plain, the cliff bands are fairly regular, and the shorelines have little detail. The output is procedural. It has not been compared with photographs or with professional terrain.
- **The desert satmap is slower.** Desert palettes paint more per pixel than temperate ones. A 16384 px Mesa country satmap is estimated at about 5 minutes in Node, and it has not been run.
- **WebGL2 is required for the 3D view.** The 2D views work without it.
- **Testing is limited.** Checks ran in headless Chromium with software WebGL (SwiftShader). There was no real-GPU test, and Firefox and Safari were not tested.

# Landscape Editor

A heightmap landscape editor built on a layer stack, with physical erosion simulation and satmap texturing. The shell uses the latest Frontier editor UI from `Experimental/ProjectZeroEditor`: `src/styles/Editor.css` is a byte-identical copy of that file, and the dock, tab strip, outliner rows, inspector cards, slider pills, popup menus and toasts reuse its classes.

## Run

```sh
npm install
npm run dev          # http://localhost:5173, listening on 0.0.0.0
npm run build        # production bundle in dist/
npm run preview      # serves dist/ on port 4173
npm test             # engine unit tests (node --test)
npm run check:browser -- http://localhost:5173/   # browser smoke test, needs Chrome
```

Tested with Node 22. `check:browser` uses `CHROME_PATH` if set, otherwise it looks for Chrome in the usual install locations.

## Layout

- **Layers** (left dock): the stack, top first, with enabled and disabled counts, a search box and the Add layer menu (generators, shape operators and erosion processes). Drag a row to reorder it. Alt+↑ and Alt+↓ move the selected layer. The landscape row is pinned at the top, and the satmap texture row sits under **Surface** below the stack.
- **Viewport** (centre): the terrain in 3D (three.js), with view modes Shaded, Satmap, Height, Slope, Drainage and Erosion, Perspective or Top projection, relief exaggeration, and Run simulation or Cancel. While a simulation runs, a progress card shows the current layer.
- **Inspector** (right dock): the selected layer's name, type, opacity, seed and mask, the erosion process dropdown, and the sliders for that process. The landscape view holds terrain size, grid resolution, relief, sea level and the project file and export buttons. The satmap view holds the source, texture resolution and the satmap colour controls.

## Terrain model

The terrain is a stack of layers. Each layer reads the heights produced by the layers below it and writes a new field in metres, then blends it in with an opacity and a mask.

| Layer | What it does |
| --- | --- |
| fBm noise | Continental base shape from fractal gradient noise, with domain warp and contrast |
| Ridged mountains | Ridged multifractal ranges, masked to an altitude band |
| Island falloff | Radial falloff that turns the landmass into an island |
| Offset | Raises or lowers the surface by a fixed number of metres |
| Terraces, Smooth, Levels | Shape operators on the heights below |
| Erosion | One of four processes (below) |

Blend modes: add, subtract, multiply, max, min and replace. A layer's mask weight is its mask multiplied by its opacity.

## Erosion

An erosion layer runs one of four solvers. Choose it in the **Erosion process** card; the sliders below the dropdown are that process's own, so switching the process swaps the slider set.

- **Rain droplets**: particle hydraulic erosion in the style of Lague. Each droplet has inertia, a sediment capacity, and erodes or deposits as it flows downhill, until it evaporates or its lifetime ends.
- **Stream power**: river incision, `E = K · A^m · S^n`, on a drainage network. Depressions are filled with Priority-Flood, cells route along the steepest D8 neighbour, and hillslope diffusion smooths the banks.
- **Thermal talus**: slope failure. Material above the talus angle slides to lower neighbours, so the removed and deposited volumes match.
- **Wind dunes**: saltation flux driven by the wind direction, with speed-up over slopes, a transport threshold and mobility. The upwind edge supplies sand and the downwind edge carries it off the map.

Each run reports the eroded and deposited volume in the viewport footer and in the layer's Output card. Rain droplets report progress only. Stream power, thermal and wind also stream a live height preview while they run.

## Satmap texturing

The satmap colours every cell from altitude, slope, drainage, erosion and the coastal band. Forest patches sit on gentle ground, bare rock covers steep faces, snow sits above the snowline, beaches line the coast, and rivers follow the routed flow. Controls cover the source (procedural classes or an imported image), texture resolution, vegetation, rock slope, snowline, treeline, beach width, river density, wetness, variation, detail, shade, sun direction and altitude, and a seven-colour palette. An imported image is used for the current session only and is not written to the project file.

## Evaluation, caching and the worker

Evaluation runs in a Web Worker, so the UI stays responsive. Each layer's result is cached under a key that chains its parameters with everything below it. Editing one layer recomputes that layer and the layers above it. Run simulation (Ctrl+R) replays only the erosion layers, because generator layers do not change. Cancel stops the job at its next checkpoint, and only the latest job is applied.

## Files and export

- The editor autosaves to browser storage.
- Save and Open use `landscape.frontier.json`, a JSON document with `format: "frontier-landscape"` and `version: 1`.
- Export heightmap writes a 16-bit greyscale PNG, scaled to the maximum relief: `heightmap-<resolution>.png`.
- Export satmap writes `satmap-<resolution>.png`.

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+Z | Undo (slider drags coalesce into one step; 120 steps kept) |
| Ctrl+Shift+Z, Ctrl+Y | Redo |
| Ctrl+R | Replay erosion |
| Ctrl+S | Save project |
| Ctrl+D | Duplicate layer |
| Del, Backspace | Delete layer |
| Alt+↑, Alt+↓ | Move layer |
| F | Frame terrain |

## Tests

`npm test` runs 21 engine tests. They cover noise and random determinism, drainage routing, each solver's bounds and effect, thermal mass conservation, the wind edge exchange, cache reuse and force replay, cancellation, project normalisation and round trips, PNG encoding, and the UI colour and format helpers.

`npm run check:browser` loads the running editor in Chrome. It checks the six-layer stack, swaps the erosion process and checks the slider set and the rename, switches to the satmap view, checks the footer readouts, and fails on any console error. It writes a satmap screenshot to `check-output/`, which is git-ignored.

## Known limits

- Rain droplets show progress only, with no live preview.
- Stream power, rain droplets and wind exchange material with the map edges, so their eroded and deposited totals can differ. Thermal conserves material exactly.
- The imported satmap image is session-only.
- Ctrl+R replays erosion instead of reloading the page.
- A default 256² evaluation takes roughly 5 to 7 seconds in a software-rendered browser (shown as EVAL in the footer). Hardware WebGL does not change the simulation time.

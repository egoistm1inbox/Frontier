# Frontier Editor — experimental HTML prototype

This folder contains the browser editor and its companion design studies:

- `index.html`: the React outliner/inspector and Construct menu (requires Vite).
- `icons.html`: standalone SVG icon gallery.
- `collection-icon-options.html`: standalone collection-icon design options.

```sh
# Run from this directory
npm ci
npm run dev -- --port 5173
npm run build
```

Visit `/`, `/icons.html` or `/collection-icon-options.html` on the dev server.
The build places all three pages and required SVGs in `dist/`.

The existing Construct creation bridge remains a separate native process. Start
it from the **repository root**, not this directory:

```sh
python3 Exhibits/Workbench/Construct/Build.py
python3 Exhibits/Workbench/Construct/Serve.py
```

Vite still proxies `/api/construct` to port 5191. Without that service, native
creation reports an error; the editor and standalone galleries still load.
Native C++ panel integration is documented in
[Native.md](../../Exhibits/Workbench/Construct/Native.md).

Browser scripts are in `scripts/`; run them from this directory. For example:

```sh
python3 scripts/serve-icons.py --port 5174
```

Keep approved SVG sources in `custom-icons/` and `ui-icons/`, and preserve vendor
notices in `vendor/`. Native runtime copies remain in `EngineContent/Icons/` at
the repository root. This move does not expand the engine's supported entities.

## Terrain workspace

`/terrain.html` is a layer-based terrain generator. It has no node graph.

- **Terrain stack** shapes the heightfield. Layers run in order, and each one can
  add or subtract a contribution (generators) or cut and fill (effects, with min and
  max blend modes). Layers are grouped by category: Base, Shaping, Rugged outcrops,
  Cliffs & strata, Erosion and Water.
- **Texturing stack** paints the albedo and roughness, Substance-style. Layers are
  grouped as Fills, Surfaces, Detail and Water, and blend with normal, multiply,
  overlay, screen, add, darken or lighten.
- **Masks** belong to any layer. Each mask is a 0–1 field (height, slope,
  curvature, drainage, distance to water, water, rock hardness, noise), combined
  with multiply, add, subtract, max, min or replace. Masks can be inverted and
  switched off, and the same catalogue serves both stacks.
- Every layer has an enable toggle, a blend mode and an opacity.

The heightfield is the working representation. The viewport, the heightmap and the
texture all come from the same evaluation. Voxel (SDF) output is not started.

```sh
npm run dev -- --port 5173   # then open /terrain.html
npm run check:terrain        # engine checks, no browser needed
npm run build
```

### Files

- `terrain.html`, `terrain.jsx`, `terrain.css`: the page, the document state (undo,
  persistence, job queue), exports and the three-column shell.
- `terrain/ui.jsx`: outliner, layer picker, layer and mask inspectors, World panel.
- `terrain/view.js`: three.js viewport (terrain mesh, albedo and roughness maps,
  water surface, debug views, shadows).
- `terrain/worker.js`: evaluates terrain and texture off the UI thread, with an
  incremental cache of the layer prefix.
- `terrain/stack.js`, `terrain/texturing.js`: the evaluators and mask combination.
- `terrain/catalog-terrain.js`, `terrain/catalog-texture.js`, `terrain/catalog-mask.js`:
  the layer and mask catalogues (categories, parameters, blend modes).
- `terrain/presets.js`: the three starting stacks (Alpine valley, Coastal cliffs,
  Canyon lakes).
- `terrain/document.js`: the version-1 document format and its normalisation, so
  older or hand-edited files load safely.
- `terrain/rivers.js`, `terrain/water.js`, `terrain/routing.js`: river carving,
  lake filling, sea level and flow routing.
- `terrain/mesh.js`: terrain and water geometry. Water is flood-filled from the
  simulated wet cells and clipped to the ground contour, so shorelines are
  continuous at sub-cell resolution.
- `terrain/png.js`: 16-bit grayscale and 8-bit RGBA PNG encoders.
- `scripts/check-terrain.mjs`: the engine checks. They cover document round trips,
  mask flags, albedo thresholds, dry ground never blue, the water contour, river
  channels below their banks, sea levels, cache equivalence and PNG headers.

### Exports and shortcuts

- Heightmap: 16-bit grayscale PNG, normalised from the minimum to the maximum height.
  Row 0 is the lowest z. The file name carries the height range.
- Albedo: 8-bit RGBA PNG of the texturing stack.
- Stacks: the document as JSON (version 1).
- Undo and redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or Ctrl+Y. Slider drags within
  900 ms share one undo step, and the history holds 100 steps.
- The document and the view mode persist in this browser under
  `frontier-terrain-v1` and `frontier-terrain-view`.

### Known limits

- The layer set is a first draft and is still to be confirmed before the layer
  catalogue grows further.
- Where a simulated river's level sits above low ground beside it, the water
  fill stops 2 m below the level, so a few notches can remain on those banks.
  The durable fix is in `rivers.js`: keep the banks above the water level.
- The viewport needs WebGL.

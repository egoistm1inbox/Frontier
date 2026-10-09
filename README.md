# Frontier — Landscape Studio

A heightmap landscape editor built on the Frontier editor UI, driven entirely by a
non-destructive **layer stack**. Stack generators, modifiers, physical erosion
passes and sculpt strokes on the left; a WebGL2 viewport in the middle; the
Frontier inspector on the right, where every layer exposes the controls that
actually drive it.

```
npm install
npm run dev          # http://localhost:5173
```

Production build: `npm run build`, preview with `npm run preview`.

---

## The three columns

| Column | What it is |
| --- | --- |
| **Layer stack** (left) | The document. Height layers and surface layers, Photoshop-ordered — the top row bakes last. Drag to reorder, eye to disable, `+` for the add menu. |
| **Viewport** (centre) | Live WebGL2 terrain with orbit / pan / zoom, nine diagnostic view modes, contour and grid overlays, a water plane and the sculpt brush. |
| **Inspector** (right) | Frontier cards, metrics and sliders generated from each layer's parameter schema. Ends in the bake report and the export panel. |

Selecting **Landscape document** (the first row) shows grid, sun, water,
render-quality and import/export settings for the whole scene.

## Layer model

Every layer produces a field that is combined into the accumulator with a
**blend mode**, an **opacity** and an optional **mask** (radial, linear,
fractal, or derived from the incoming height / slope / flow). Nothing is ever
edited in place, so any layer can be muted, faded, re-masked, reordered or
deleted and the stack re-bakes.

* **Generators** — base plane, fractal noise (fBm / ridged / billow / domain-warped),
  cellular mesas, island falloff, volcanic cone, directional ramp, imported heightmap.
* **Modifiers** — terraces, Gaussian smooth, unsharp detail, flatten / plateau,
  range remap, erosion, sculpt strokes.
* **Surface layers** — splat materials and the satellite drape (below).

Sculpting never touches the baked terrain: each brush layer owns a delta field,
and strokes accumulate into it. While you paint, the viewport patches only the
affected mesh region; a full re-bake follows when the stroke ends.

## Erosion

The `Erosion` layer exposes a **process dropdown**, and each process reveals its
own sliders — a process can never show a control it does not use.

| Process | Method |
| --- | --- |
| Hydraulic erosion | Particle transport (Mei et al. 2007): droplets carry sediment up to a speed-dependent capacity, cut when under capacity, fill when over capacity or forced uphill, and sink-fill on exit so the surface always drains. |
| Rainfall & sheet wash | Cellular runoff on a virtual water layer with velocity/slope transport capacity, detachment, and deposition on infiltration. |
| Thermal (talus) | Angle-of-repose relaxation; excess above the talus angle slides to neighbours and fans out as a scree apron. Mass-conserving and stable for any pass count. |
| Wind (aeolian) | Semi-Lagrangian sediment advection along the bearing; abrasion scales with the square of wind speed and with exposure above the upwind relief. |
| Glacial | Accumulation-driven sliding ice: abrasion of the bed, plucking on lee steps, valley widening into U-profiles, and till deposited where the ice thins. |
| Coastal (wave) | A chamfer distance transform defines the wave band; cliffs retreat and the debris is graded into a beach profile so mass is conserved. |

Because the terrain field is normalized, angle-of-repose thresholds are
converted through the grid's real aspect ratio (`cellSize / maxHeight`) and the
layer's **vertical scale**, so a 34° talus angle means 34° on the landscape you
are looking at.

Every pass reports cut / fill / flow / talus maps. Switch the viewport to
**Erosion**, **Flow** or **Talus** to read them, or let the texture rules use
them: riverbeds sit on flow accumulation, scree sits on the talus map.

## Surface texturing

Two cooperating systems, both in the stack:

* **Splat materials** — albedo, roughness and micro-variation blended by rules
  over height band, slope band, flow accumulation, talus, fractal noise and
  cellular patches. Seventeen presets from deep water to glacier ice.
* **Satellite drape** — a top-down projected texture. Either generated
  procedurally *from the terrain itself* (farmland parcels on flat ground,
  rivers on the real drainage network, coastal shallows, snow above the
  snowline, rock on steep faces), or a real imported satellite image with
  tiling, rotation, offset and a full grade. A **rock guard** keeps procedural
  rock on cliffs so the drape never smears over them.

The bake writes one RGBA texture: RGB is albedo, A is smoothness.

## Export

Heightmap PNG (8-bit), raw little-endian **16-bit `.r16`**, tangent-space normal
map, the baked albedo, Wavefront **OBJ**, and the project document as JSON.
Import goes the other way for heightmaps and satellite imagery. Imported images
never enter localStorage — the saved document stays small and portable.

## Keyboard

`1–5` view modes · `G` grid · `C` contours · `W` water · `F` frame · `T` top ·
`Ctrl/⌘ S` save · `Esc` back to the document. In the viewport: drag orbits,
Shift- or right-drag pans, wheel zooms; with a sculpt layer selected, drag paints.

## Architecture

```
src/core/      simulation: noise, layer stack, erosion, textures, brushes,
               exporters — pure typed-array code, no DOM
src/core/      pipeline.worker.js  runs the whole bake off the main thread
src/render/    WebGL2 terrain renderer (mesh, lighting, water, diagnostics)
src/ui/        the three columns and the Frontier control primitives
src/styles/    the ported Frontier design system + editor chrome
scripts/       verification suites
```

Baking happens in a Web Worker; the main thread only uploads the result.
Erosion at 100k+ droplets takes well over a second, which is exactly why.

## Verification

Two suites, both runnable headlessly:

```
node scripts/verify-core.mjs     # 136 checks on the simulation, writes PNGs to .verify/
node scripts/verify-ui.mjs       # 63 checks driving the real React UI under jsdom
QUICK=1 node scripts/verify-ui.mjs
```

The core suite asserts physical behaviour, not just that code runs: hydraulic
erosion must incise channels deeper and stop shattering the surface into sinks;
thermal erosion must reduce mean and maximum slope; wind must migrate its
deposition centroid downwind; coastal attack must stay inside its wave band;
every process must conserve mass within tolerance; blends must be exactly
correct; and the satellite drape must differ from the splat result while a
zero-opacity drape must be a no-op.

The UI suite bundles the app with esbuild, mounts it in jsdom against stubbed
GL/2D contexts, and runs the *real* worker in-process — then selects layers,
switches all six erosion processes and asserts each shows its own sliders and
hides everyone else's, adds and deletes layers, toggles visibility, and saves.

---

Built against the Frontier editor UI in
[`Experimental/FrontierEditor`](https://github.com/SultanAladin/Frontier-/tree/arena/5c85f535-frontier/Experimental/FrontierEditor):
the graphite surfaces, card geometry, metrics and control metrics are ported
from that design system; semantic colour stays on icons and inside the
visualizations.

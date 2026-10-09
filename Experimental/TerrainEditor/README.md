# Frontier Terrain Editor — heightmap layerstack

A browser landscape editor built on the current Frontier Editor UI
(`Experimental/FrontierEditor`): **Layerstack** on the left, **viewport** in
the centre, **inspector** on the right.

```sh
npm --prefix Experimental/TerrainEditor ci
npm --prefix Experimental/TerrainEditor run dev -- --port 5173
npm --prefix Experimental/TerrainEditor run build
node Experimental/TerrainEditor/scripts/check-terrain.mjs   # engine checks
```

## Layers

- **Shape layers** add height from a generator (Perlin, multifractal, ridged,
  mountain, Voronoi, domain-warped, strata, rifted, dunes, island), blended
  Add / Subtract / Max / Min / Replace, with an optional mask.
- **Erosion layers** run one of four simulations, each with its own sliders:
  - *Hydraulic* — droplet rainfall runoff, sediment capacity, deposition.
  - *Thermal* — talus relaxation against a repose angle (scree on cliffs).
  - *Fluvial* — D8 flow accumulation carves meandering river channels.
  - *Aeolian* — wind-transported sand builds asymmetric dunes with ripples.
  An erosion layer can be driven by a noise field and gated by a mask.

## Masks

Every shape and erosion layer can use a mask:
Coastal falloff, Mountain ranges (smooth falloff, so ranges don't merge into
one mass), Stratify (tilted, warped stacks), Rifts, and Cliffs (steep faces only).

## Satmap

The satmap is a stylized paint, not a literal photo. Its channels come from
the stack: height, rivers (flow accumulation), sedimentation, and strata
bands. Six palettes: Temperate, Desert, Sandstone, Alpine, Volcanic, Arctic.
Map modes: satmap, hillshade, height, slope, rivers, sediment, strata.

## Presets

Sandstone Canyons · Sandstone Cliffs · Coastal Cliffs · Himalayan Mountains ·
Icelandic · Alps · Snowy Mountains · Rugged Outcrops · Desert Dunes · Rocky Desert.

## Layout

- `src/terrain/` — pure engine (noise, generators, masks, erosion, pipeline,
  satmap, presets). Runs in a Web Worker (`worker.js`).
- `src/LayerStack.jsx`, `src/Viewport.jsx`, `src/Inspector.jsx` — UI.
- `src/terrain/render3d.js` — WebGL relief preview.
- `style.css` — ported from the Frontier Editor design system.

## Limits

Erosion runs in JavaScript on a CPU grid (default 256²). Simulation cost scales
with grid size × droplet count; large maps take noticeably longer.

# Frontier — Foliage Forge

A no-build, browser-first desert plant generator for the Frontier botanical systems toolkit.

## Run locally

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open `http://localhost:4173`.

## What is included

- Procedural SVG specimens for six desert species: saguaro, barrel cactus, ocotillo, agave, desert aloe, and Joshua tree.
- Seeded generation so the exact shape can be reproduced.
- Form controls for height, spread, density, maturity, spines, and weathering.
- Render, wireframe, and silhouette inspection views.
- Live asset QC checks and a curated species library.
- Local-only save feedback and preview fullscreen mode.

The plant shapes are generated in `app.js` rather than relying on low-quality placeholder imagery. The two photographic references in `assets/` are used only as verified library thumbnails for saguaro and ocotillo.

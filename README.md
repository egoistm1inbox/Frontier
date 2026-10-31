# Frontier — AAA Procedural 3D Rock & Cliff Studio

**Frontier** is a structural-geology-first procedural 3D rock and cliff generator for AAA game production. Every overhang, stratified sedimentary bench, curve-swept sandstone arch, hexagonal basalt column, exfoliation sheeting visor, razor-fluted karst spire, and balanced caprock pedestal is synthesized in **true 3D geometry** — never faked with sedimentation stripe textures or displaced spheres.

---

## Core Architecture

1. **Analytical 3D Curve-Swept Arches (`src/geology/arch-curves.js`)**
   - Natural arches (`desert-arch`, `double-arch`, `sea-arch`) are sculpted directly along **true 3D cubic Bézier curves** with parallel-transported Frenet frames, slender crown taper, polygonal sandstone fin cross-sections, and stepped bedding pedestals — **zero hole-punching boolean cuts**.
2. **Real 3D Sedimentary Stratigraphy & Differential Weathering (`src/geology/sedimentary-formations.js`)**
   - `sedimentary-cliff` builds 17 continuous dipping stratigraphic horizons alternating between massive overhanging caprock cornices, rhythmically interbedded flagstone wafer packets, deeply undercut fissile shale recesses, lenticular paleochannel pinch-outs, oblique fault throws, and angular fallen caprock slabs.
3. **18 Distinct Procedural Formation Archetypes (`src/geology/presets.js`, `src/geology/formations.js`)**
   - **Arch**: *Utah Sandstone Arch*, *Double Sandstone Arch*, *Coastal Sea Arch*
   - **Sedimentary**: *Sedimentary Cliff*
   - **Desert**: *Utah Canyon Wall*, *Utah Slot Canyon*, *Desert Spires*, *Hoodoo Columns*, *Sandstone Butte*, *Balanced Pedestal Rock*
   - **Cliff**: *Jointed Cliff Face*, *Granite Exfoliation Dome*, *Columnar Basalt Cliff*
   - **Outcrop**: *Limestone Karst Tower*, *Alpine Crag Spire*, *Weathered Granite Tor*, *Dipping Slate Outcrop*
   - **Boulder**: *Fractured Hero Boulder*
4. **Sparse Narrow-Band SDF + QEF Dual Contouring (`src/core/sparse-sdf.js`, `src/core/dual-contour.js`, `src/core/qef.js`)**
   - Evaluates a narrow-band brick-sparse signed distance field and solves per-cell 3×3 Quadric Error Functions with Tikhonov regularization, preserving razor-sharp bedding ledges and fracture dihedrals while keeping rock faces organic and clean.
5. **AAA Game Engine Mesh Export (`src/io/glb-exporter.js`, `src/io/obj-exporter.js`)**
   - Exports binary **glTF 2.0 (`.glb`)** and **Wavefront `.obj`** with crease-split normals, triplanar-ready UVs, adaptive QEM LOD decimation, and baked RGBA vertex masks (`R = Volumetric AO`, `G = Concave Cavity`, `B = Convex Edge`, `A = Upward Slope`).

---

## Quick Start

```bash
npm install
npm run dev      # Launch interactive WebGL2 studio on 0.0.0.0:5173
npm test         # Run unit & integration suite across all 18 archetypes
npm run build    # Production Vite bundle
```

### Headless CLI Asset Baker

```bash
npm run generate -- --archetype desert-arch --seed 4029 --quality high --out exports/arch.glb
npm run generate -- --archetype sedimentary-cliff --seed 4029 --lods --out exports/cliff.glb
```

---

## Terrain Studio & Rock Studio — Simulation Update

### Flat, palette-true terrain colours
The procedural colour textures are gone by default. `TERRAIN_RENDER_FRAG` now exposes
`uSurfaceDetail`:

* `0.0` — **Flat colours** (default): rock grain, patch mottling, sastrugi, ice crevasses,
  sand ripples and the repeating hexagonal / cross-bedded "micro-fabric" patterns are all
  suppressed, leaving clean uniform palettes per lithology zone (hardness, elevation,
  sediment and AO still shade the terrain, because those are geometry-derived).
* `0.5` / `1.0` — subtle / full procedural detail, selectable from the **Surface** dropdown
  in the viewport toolbar and the *Derived Surface Shading* inspector card.

Landscape presets no longer force a repeating `fabricMode`; the "Rock Micro-Fabric" pattern
selector was removed from the studio UI.

### Hydrology (water flow)
`WATER_FLUX_FRAG` was rewritten as a conservative virtual-pipe shallow-water solver:

* Flow is driven by the free water-surface gradient (bed + sediment + water), not the bare bed.
* Each pipe accelerates through its own wetted cross-section and is damped by turbulent friction.
* The domain edge is a closed wall instead of a unit-inconsistent drain, so mass is conserved.
* Outflow is CFL-limited per step and deep water gets a hydrostatic levelling term, removing the
  checkerboard oscillation that made rivers behave strangely.
* The velocity field now uses the correct signed unit-width discharge, so flow direction,
  foam and ripple advection follow the actual current.

### Cryosphere (snow)
`SNOW_CRYO_FRAG` and `INIT_SNOW_FRAG` were rebuilt:

* Snow only accumulates where the bed can hold it (steep faces shed instantly).
* Avalanching is symmetric, donor-limited and CFL-clamped — genuinely mass conserving.
* Wind transport is an availability-limited upwind flux that builds cornices and fills lee gullies.
* Degree-day melt depends on altitude warmth **and** solar exposure of the local slope, and returns
  meltwater to the 2.5D river network.
* Glacier creep and firn compaction are conservative; the initial snowpack is smooth and settled.

### Visibility toggles
Terrain Studio toolbar **Show → Water / Snow / Rain** toggle rendering only (simulations keep
running, so hiding rain never changes the terrain). Rock Studio has its own *Falling Rain* toggle.

### Particle Rain Erosion in the Rock & Cliff Studio
`src/erosion/rock-rain-erosion.js` brings the Terrain Studio raindrop idea to real 3D meshes:

* Drops are ray-cast onto the topmost triangle (arches, ledges and overhangs work), then run down
  the steepest-descent direction of the surface, carrying sediment.
* Contacted vertices are dissolved along their welded normals; sediment is redeposited where the
  flow pools or dries up, and a Laplacian relaxation rounds the rills.
* Controls: **Start/Pause**, **Reset Surface**, rain intensity, erosion strength, sediment
  deposition, gully rounding, runoff evaporation and a falling-rain toggle.
* In-place GPU buffer refresh (`RockStudioViewport.updateRockGeometry`) keeps it real-time, and the
  original surface is byte-exact restorable.

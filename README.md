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

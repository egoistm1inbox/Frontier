# Frontier Geological WebGPU Terrain Studio

A high-fidelity AAA browser-based geological terrain generator designed to match and rival **QuadSpinner Gaea**, running in real time on **WebGPU** (with WebGL2 fallback).

Styled with the dark graphite workstation UI from [`SultanAladin/Frontier`](https://github.com/SultanAladin/Frontier-) (`Experimental / FrontierEditor` / `Project-Zero`).

---

## Key Highlights

- **WebGPU Real-Time 3D Viewport**:
  - High-performance WebGPU rendering pipeline using Three.js WebGPU (`three/webgpu`) with WebGL2 fallback.
  - Physically Based Rendering (PBR) Cook-Torrance specular, micro-detail normal mapping, and analytical surface slope calculations.
  - Procedural atmospheric sky dome with Rayleigh and Mie scattering, interactive 3D solar orbit gizmo, and dynamic shadows.
  - Physically based water plane with refraction, depth absorption ($#0e283d \to #286380$), animated surface ripples, and shoreline foam fringe.
  - Multi-channel Viewport modes: `PBR Lit`, `Clay Sculptor`, `Heightmap (Raw)`, `Hydraulic Flow`, `Sediment Fan`, `Slope Distribution`, and `Wireframe Overlay`.

- **Dual Layerstack Architecture (No Node Spaghetti)**:
  - **Terrain Generation Layerstack**:
    - Primitives: *Alpine Massif Peaks* (knife-edge aretes), *Swiss Multi-fractal* (fBm), *Basalt Voronoi Crags*, *Fault Line Canyons*, *Volcanic Caldera*, *Desert Wind Dunes*.
    - Geological Modifiers: *Hydraulic Fluvial Erosion* (rain droplets, bedrock dissolution, sediment transport, dendritic gullies), *Thermal Scree & Talus* (angle-of-repose rockfall relaxation), *Sedimentary Strata & Terracing* (Grand Canyon step shelves), *Tectonic Domain Warp* (folding and metamorphic shear), *Arete Sharpener*, and *Valley Infill*.
    - Layer compositing: Opacity ($0-100\%$), visibility toggle, bypass, and blend modes (`Replace`, `Add`, `Max`, `Min`, `Multiply`, `Subtract`).
  - **Surface Texturing Layerstack**:
    - Procedural rule-based multi-layer biomes: *Deep Granite Bedrock*, *Scree & Rockfall Cones*, *Valley Loam & Humus*, *Alpine Meadow Grass*, *Subalpine Moss & Lichen*, *Alluvial Riverbed Sand*, *Wet Rock Flow Glaze*, and *Glacial Ice & High Snow*.
    - Procedural placement masks per material: Altitude range & falloff, Slope angle & falloff, Hydraulic Flow mask weight, Alluvial Sediment weight, Talus Scree weight, Cavity/Curvature concavity, and Organic fractal noise breakup.

- **Frontier / ProjectZero UI & Interactive SVG Visualizers**:
  - `SunGizmo`: Interactive 3D orbital sun compass with azimuth and elevation tracks.
  - `TerrainContours`: Topographic elevation contour rings with live interval metrics.
  - `RoughnessProfile`: Multi-octave surface frequency profile curve.
  - `ErosionChannels`: Dendritic drainage channel tree diagram.
  - `SlopeGauge`: Angular gauge displaying slope angle and critical angle of repose ($35^\circ - 42^\circ$).
  - `StrataDiagram`: Sedimentary rock strata banding diagram showing ledge hardness and banding frequency.
  - `MaskRamp`: Visual distribution curve showing min/max boundaries and transition falloff.

- **Bake & Export Suite**:
  - **16-bit RAW / PNG Heightmap**: Standard uncompressed high-precision displacement for Unreal Engine 5 Landscape, Unity Terrain, and Blender.
  - **8-bit PNG Heightmap**: Standard grayscale heightmap.
  - **PBR Albedo Map**: Full-resolution composite diffuse color map.
  - **Normal Map**: Tangent/world space normal map combining macro-slope normals with micro-crag bumps.
  - **Hydraulic Flow Mask**: Grayscale river and gully mask for river spline placement in game engines.
  - **Alluvial Sediment Mask**: Grayscale sand/gravel deposition fan mask.
  - **3D Mesh (Wavefront .OBJ)**: Export terrain geometry with UVs and normals ready for Blender, Maya, or Unreal.
  - **Project Configuration (.gaea.json)**: Save and restore entire layerstacks.

---

## Getting Started

```bash
# Install dependencies
npm install

# Start Vite dev server on 0.0.0.0:5173
npm run dev

# Production build
npm run build
```

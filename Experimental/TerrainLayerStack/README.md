# Terrain Layer Stack — Interactive Prototype

Browser prototype of the Terrain Workspace (see `Documentation/Plans/Ongoing/TerrainDensityField-Plan.md`,
Phase 3). It proves the **interaction model** and the **field mathematics** live: a layer stack with
operation dropdowns, blend modes, opacity, and per-layer mask stacks, evaluating into one density
field ρ(x, y, z) that is extracted to polygons in the viewport.

Run: `python3 -m http.server 8000 --bind 0.0.0.0` in this folder, open `http://localhost:8000/`.
(Three.js is vendored under `vendor/` with its licence — no network needed.)

## What to try

- **Cross-section slider** (bottom-left): drag left to slice the mountain open along the mine tunnel.
- **Mine through-route layer**: change tube radius / height; the cave re-routes live.
- **North-face overhang**: raise the lean amplitude; watch the multi-interval column counter climb.
- **Mature drainage**: raise iterations; switch the viewport to *Flow / wear* to see the channels.
- **Lakes + ocean**: raise sea level; shorelines and wet banding follow.
- Toggle any layer off (eye), drag layers to reorder, add masks (mask icon on the selected row),
  swap a layer's operation from the inspector dropdown, or export the document as JSON.

## Fidelity to the production design

- UI tokens (colours, radii, control heights) are copied from `Engine/Interface/ControlKit.h`;
  layout mirrors `EditorWorkspace` (52 px top bar) and `TexturePaintWorkspacePanel` (three docks).
- Inspector rows are **generated from operation descriptors**, exactly like
  `StratumOperationRegistry` will drive the C++ panel. No parameter is hardcoded in UI code.
- Field semantics match `Exhibits/TerrainDensityValidation`: ρ > 0 solid, outward normal = −∇ρ.
- Simplifications (stated in the UI): Surface Nets instead of Dual Contouring; erosion writes back
  by column shift instead of along ∇ρ; one uniform grid instead of sparse tiers. These are the
  Phase 2/4 production upgrades and change none of the authoring semantics.

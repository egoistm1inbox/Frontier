# Terrain Density Field — Implementation Plan

TL;DR — Six phases, field first, editor second, polish last. Each phase ends in runnable evidence
retained under `Exhibits/`; no phase is "done" on compilation alone (per `CLAUDE.md` verification
rules). Research basis: `TerrainDensityField-Research.md` in this folder.

## 1. Architecture (one diagram)

```text
                         Terrain document  (.terrain.toml + .terrainbricks)
                         ┌───────────────────────────────────────────────┐
                         │ TerrainWorldConfiguration  (extents, tiers)   │
                         │ StratumSequence            (the layer stack)  │
                         │ FieldChannelAtlas          (named channels)   │
                         └───────────────┬───────────────────────────────┘
                                         │ EvaluateDensity( position, tier )
              ┌──────────────────────────┼──────────────────────────────┐
        analytic path              baked path                    simulate path
   strata evaluated in-stack   DensityBrickAtlas lookup    ShallowWater / Thermal solvers
   (Slang compute, per brick)  (narrow-band 32³ bricks)    write Δρ back into bricks
              └──────────────────────────┬──────────────────────────────┘
                                         ▼
                    DualContourExtraction ──▶ PolygonSurface (+ normals, material weights)
                                         │
        ┌────────────────────┬───────────┼────────────────────┬───────────────────┐
        ▼                    ▼           ▼                    ▼                   ▼
   editor viewport     collision    navigation         water surfaces      cooked streaming
   (Vulkan)            extraction   projection         (equilibrium)       bricks per tier
```

## 2. File map (ownership per `Documentation/FolderStructure.md`)

| Path | Responsibility | Status this delivery |
| ---  | ---              | ---                   |
| `Engine/Terrain/TerrainWorldConfiguration.h` | world extents, resolution tiers, physical constants (all user values) | ✔️ specified |
| `Engine/Terrain/DensityBrickAtlas.h` | sparse 32³ brick store, narrow band, material payload | ✔️ specified |
| `Engine/Terrain/StratumSequence.h` | layer-stack document: strata, mask stacks, folders, blend modes | ✔️ specified |
| `Engine/Terrain/StratumOperationRegistry.h` | operation catalogue; parameter descriptors drive the inspector | ✔️ specified |
| `Engine/Terrain/DensityFieldEvaluation.h` | stack evaluation, gradients, named channels, invalidation | ✔️ specified |
| `Engine/Terrain/DualContourExtraction.h` | QEF surface extraction, skirts, LOD tiers | ✔️ specified |
| `Engine/Terrain/ShallowWaterSimulation.h` | 2.5D fluid: erosion, rivers, lakes, ocean equilibrium | ✔️ specified |
| `Engine/Terrain/Shaders/*.slang` | GPU field evaluation + fluid step | ✔️ skeleton |
| `Engine/Terrain/TerrainDocumentCodec.*` | TOML document + brick sidecar (toml++) | Phase 1 |
| `UI/Editor/TerrainWorkspacePanel.h` | editor panel (stack / viewport / inspector docks) | ✔️ specified |
| `UI/Editor/TerrainWorkspacePanel.cpp` | panel implementation on ControlKit + PanelDockspace | Phase 3 |
| `Exhibits/TerrainDensityValidation/` | runnable proof of the field mathematics + results | ✔️ executed |
| `Experimental/TerrainLayerStack/` | interactive layer-stack prototype (UI proof) | ✔️ live |

## 3. Phases

### Phase 0 — Research + field mathematics proof  🏁 (this delivery)

- ✔️ Representation, extraction, erosion, and UI decisions researched and tabulated.
- ✔️ Reference implementation proves: multi-interval columns (caves/overhangs), spline carve,
  domain-warp overhang, arch/spire union, erosion drainage, lake equilibrium.
- ✔️ C++20 API specified in Frontier naming/formatting rules; headers pass standalone syntax check.
- ✔️ Layer-stack UX proven interactively against `ControlKit` tokens.

### Phase 1 — Field substrate (Engine/Terrain, CPU)

- Implement `DensityBrickAtlas` (hash directory, brick categories, narrow-band rebuild) and
  `TerrainDocumentCodec` (TOML schema below) with round-trip validation.
- Implement analytic strata: Primitive + Combine + Warp groups; gradient via analytic-where-cheap,
  central differences otherwise.
- Evidence: `Exhibits/TerrainSubstrate/` — brick memory vs the §3.1 table measured on the 8 km
  fixture world; evaluation throughput (samples/s) per operation; codec round-trip report.

### Phase 2 — Extraction + viewport (Vulkan/Slang)

- Dual Contouring on CPU thread pool first (correctness), then Slang compute
  (`DensityFieldEvaluation.slang` fills brick Hermite data; extraction consumes it).
- QEF clamp + fallback, skirts, tiered streaming rings around the camera, dirty-brick re-extraction.
- Evidence: cliff-edge sharpness fixture (90° dihedral preserved vs Marching Cubes rounding),
  crack test across tier boundary (pixel-diff at seam), extraction ms/brick table.

### Phase 3 — Editor workspace (UI/Editor)

- `TerrainWorkspacePanel`: layer stack (reorder, folders, mask sub-stacks, operation dropdown,
  channel dropdowns), generated inspector, viewport with sculpt/carve/stamp brushes, snapshot
  undo/redo — mirroring `TexturePaintWorkspacePanel`'s composition and document behaviour.
- Register docks in `EditorWorkspace` (`terrain` panel set) exactly as Content Browser does.
- Evidence: rendered captures from the actual C++ panel; interaction validation (add/mute/reorder/
  carve/undo) — the HTML prototype is explicitly *not* accepted as this evidence.

### Phase 4 — Simulation strata

- `ShallowWaterSimulation`: pipe flux, velocity, erosion/deposition, sediment advection,
  evaporation; thermal talus; surface-column binding (§6.2 of research); Wear/Deposition/Flow
  channel publication; `WaterBodySolve` equilibrium (rivers/lakes/ocean shore).
- Mass-conservation assertion per step; unstable configuration refusal.
- Evidence: alpine fixture eroded to drainage maturity (images + sediment budget numbers),
  lake/ocean fixtures, solver ms/iteration at 1024² and 4096².

### Phase 5 — Materials, texturing, cooking

- Triplanar PBR terrain shading in Slang; voxel-borne weights (8 materials); strata folding +
  differential hardness loop with erosion; macro modulation from derived channels.
- Cook: flatten stack to per-tier bricks; collision + navigation extractions; top-surface
  projection for gameplay systems.
- Evidence: cliff/cave material continuity captures; texel-density measurement on vertical faces;
  cooked world size vs §3.1 budget.

### Phase 6 — Runtime gates (game-team decisions, not editor work)

- Runtime field editing (digging) policy: replication, collision refresh, save format.
- Live local water simulation tiles around gameplay vs baked equilibrium only.
- Virtual-texture terrain shading if 8-material triplanar measures over budget.

## 4. Document schema (TOML — the layer stack on disk)

```toml
# AlpineRange.terrain.toml — parameters only; baked bricks live in AlpineRange.terrainbricks
schema = "frontier.terrain/1"
revision = 42

[world]
extent_m = [8192.0, 1024.0, 8192.0]
brick_extent_cells = 32
narrow_band_half_width_cells = 3
sea_level_m = 128.0

[[world.tiers]]
cell_size_m = 2.0     # whole-world base
[[world.tiers]]
cell_size_m = 0.5     # camera ring
ring_radius_m = 1024.0

[[strata]]
name = "Continental base"
operation = "ElevationProfile"
blend = "Replace"
opacity = 1.0
seed = 1337
[strata.parameters]
profile = "RidgedFractal"
frequency_per_m = 0.00035
octaves = 7
amplitude_m = 420.0

[[strata]]
name = "North face overhang"
operation = "DomainWarpCurve"
blend = "MaskedBlend"
[strata.parameters]
lean_amplitude_m = 26.0
[[strata.masks]]
operation = "SlopeSelect"
[strata.masks.parameters]
slope_min_deg = 55.0

[[strata]]
name = "Mine through-route"
operation = "SplineTube"
blend = "SmoothCarve"
publish = "MineField"
[strata.parameters]
radius_m = 4.5
smooth_radius_m = 2.0
points_m = [[1200.0, 210.0, 900.0], [1450.0, 196.0, 1180.0], [1780.0, 224.0, 1520.0]]

[[strata]]
name = "Mature drainage"
operation = "ShallowWaterErosion"
[strata.parameters]
iterations = 4000
rain_rate_m_per_s = 0.002
sediment_capacity = 1.0
publish_wear = "Wear"
publish_flow = "Flow"

[[strata]]
name = "Cliff rock"
operation = "MaterialAssign"
material = "EngineContent/MaterialArchives/Rock/GraniteStrata.material"
[[strata.masks]]
operation = "SlopeSelect"
[strata.masks.parameters]
slope_min_deg = 48.0
```

## 5. Verification matrix

| Claim | Required evidence | Where |
| ---   | ---               | ---   |
| Heightmap-class memory | measured brick bytes vs heightfield bytes, same world | Phase 1 exhibit |
| Caves / arches / overhangs are native | multi-interval column census + slices | ✔️ `Exhibits/TerrainDensityValidation/` |
| Cliffs stay sharp | dihedral-angle histogram, DC vs MC on the same field | Phase 2 exhibit |
| No LOD cracks | seam pixel-diff across tier boundary | Phase 2 exhibit |
| Erosion is physical | sediment mass budget conserved; drainage reaches sea/lakes | ✔️ reference run; re-prove Phase 4 |
| UI matches Frontier editor | captures from the C++ panel itself | Phase 3 exhibit |
| No hardcoded physics/geometry | audit: every constant traced to a configuration field | per-phase review |

## 6. Blockers recorded honestly

| Check | Status |
| ---   | ---    |
| Full editor build (Windows/Vulkan/dependencies) | 🏴 blocked in this checkout — `egoistm1inbox/Frontier` holds only the initial commit; reference editor lives on `SultanAladin/Frontier` `arena/4014756b-frontier`. Headers here are written against the inspected APIs and pass standalone C++20 syntax checks; link/integration evidence belongs to Phase 3 on the reference tree. |
| Slang compilation | 🏴 no Slang compiler in this environment; shaders delivered as reviewed skeletons, compilation is a Phase 2 gate. |
| GPU timings | 🏴 no GPU in this environment; all timings in the exhibit are CPU reference numbers, labelled as such. |

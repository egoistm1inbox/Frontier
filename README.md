# Frontier

## Terrain Density Field — voxel terrain with a layer stack (this branch)

Research, plan, engine specification, and runnable proof for replacing heightfield terrain with a
**sparse signed-density field** authored by a **layer stack** (operation dropdowns + blend modes +
mask stacks instead of a node graph): true cliffs, caves, arches, spires and overhangs, shallow-water
(2.5D) erosion / rivers / lakes / ocean, and heightmap-class memory via narrow-band bricks.

| Deliverable | Location |
| ---         | ---      |
| Research report (decisions, memory proof, Frontier fit) | `Documentation/Plans/Ongoing/TerrainDensityField-Research.md` |
| Implementation plan (6 phases, file map, TOML schema) | `Documentation/Plans/Ongoing/TerrainDensityField-Plan.md` |
| Engine API specification (C++20, Frontier naming/formatting) | `Engine/Terrain/*.h`, `Engine/Terrain/Shaders/*.slang` |
| Editor panel specification (PanelDockspace / ActivationSequence) | `UI/Editor/TerrainWorkspacePanel.h` |
| Executed validation + evidence images + results | `Exhibits/TerrainDensityValidation/` |
| Interactive layer-stack prototype (live preview) | `Experimental/TerrainLayerStack/index.html` |

Reference editor inspected for UI/API conventions: `SultanAladin/Frontier`, branch
`arena/4014756b-frontier` (commit `02c948d7`) — `EditorWorkspace`, `PanelDockspace`, `ControlKit`,
`TexturePaintWorkspacePanel`, `PaintStampEngine`, `MaterialLibrary`, and the four agent skill
documents under `EngineDocs/AgenticInstuctions/`.

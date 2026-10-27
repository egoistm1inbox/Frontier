# Terrain Density Validation — Results

Reproduction: `python3 Exhibits/TerrainDensityValidation/Code/TerrainDensityValidation.py`
Environment: Python 3.11.2, NumPy 2.4.6, matplotlib 3.11.2, Debian 12 sandbox (no GPU).
C++ checks: `g++ 12.2 -std=c++20 -fsyntax-only` (see bottom). Source revision: branch
`arena/dc971a1c-frontier`, working tree of this delivery.

## Field topology (96 × 48 × 96 density grid, 1 cell = 1 unit)

| Measurement | Result | Reading |
| ---         | ---    | ---     |
| Columns with > 1 solid interval | **411 / 9 216 (4.46 %)** | 🟢 caves + arch + overhangs exist; any heightfield scores 0 |
| Most solid intervals in one column | 2 at (x, z) = (20, 17) | arch ring over its own footing |
| Near-vertical surface samples | **930 / 16 333 (5.7 %)** of the \|ρ\| < 0.75 band | 🟢 true cliff faces (normal within 15° of horizontal) |

Evidence: `Images/FieldSlices.png` — the z = 48 section shows the tunnel void enclosed inside the
ridge (yellow ρ = 0 contour), x = 22 shows air enclosed by the arch ring.

## Extraction (Surface Nets reference)

| Measurement | Result |
| ---         | ---    |
| Vertices / triangles | 18 622 / 36 832 |
| Time (single-thread Python) | 1.39 s |
| Output | `ExtractedSurface.obj` (1 147 897 B), renders in `Images/ExtractedSurface.png` |

The SE view shows the arch standing on the flank and the tunnel mouth; the NW view shows the spire.
Production extraction is Dual Contouring (sharp QEF features) — Surface Nets is its degenerate case
and is used here only because it is the simplest correct extractor.

## Erosion + water (128 × 128 columns, 8 m cells, 1.024 km fixture, 900 steps, 2.13 s)

| Measurement | Result |
| ---         | ---    |
| Eroded / deposited / still suspended | 55 471 / 31 872 / 100 cell·m |
| Thermal (talus) transport | 6 817 cell·m, mass-conserving by construction |
| Bed change | −24.93 m … +8.07 m, mean \|Δ\| 2.52 m, **0 NaN cells** |
| Budget remainder | 23 499 cell·m (42 % of eroded) — boundary export off the 1 km tile + semi-Lagrangian advection diffusion; reported, not hidden. Phase 4 switches to flux-form advection to close this exactly |
| Lakes (priority-flood) | 3 428 cells = 0.22 km², max depth 26.09 m |
| Rivers (top 2.5 % discharge) | 410 cells, continuous dendritic network (`Images/Erosion.png`, flow channel) |

⚠️ The fixture is intentionally over-eroded (young relief, 900 steps of heavy rain) to make drainage
unmistakable at 128². It demonstrates solver behaviour, not production art tuning.

## Memory model (research §3.1, recomputed — one figure corrected by this run)

| Layout (8 km × 8 km × 1 km world, half precision) | Bytes |
| ---                                                | ---   |
| Dense grid, 0.5 m cells | 1.024 TB (the draft research table said 1 024 TB — this run caught and corrected it) |
| Dense grid, 2 m cells | 16.0 GB |
| Heightfield, 0.5 m / 1 m | 512 MB / 128 MB |
| **Narrow-band bricks, 2 m base tier (whole world)** | **288 MB** |
| **Punch-in ring, 0.5 m within r = 512 m** | **100.7 MB resident** |

## C++ specification checks

| File | `g++ -std=c++20 -Wall -Wextra -fsyntax-only` |
| ---  | --- |
| `Engine/Terrain/TerrainWorldConfiguration.h` | 🟢 exit 0 |
| `Engine/Terrain/DensityBrickAtlas.h` | 🟢 exit 0 |
| `Engine/Terrain/StratumSequence.h` | 🟢 exit 0 |
| `Engine/Terrain/StratumOperationRegistry.h` | 🟢 exit 0 |
| `Engine/Terrain/DensityFieldEvaluation.h` | 🟢 exit 0 |
| `Engine/Terrain/DualContourExtraction.h` | 🟢 exit 0 |
| `Engine/Terrain/ShallowWaterSimulation.h` | 🟢 exit 0 |
| `UI/Editor/TerrainWorkspacePanel.h` | 🟢 exit 0 against stub host headers (PanelDockspace / PixelSpace / ActivationSequence minimal stand-ins) |

🏴 Blocked (not run, not claimed): full editor build and link (this checkout holds only the initial
commit; the reference editor is `SultanAladin/Frontier` `arena/4014756b-frontier`), Slang shader
compilation (no Slang toolchain here), GPU timings (no GPU here). These are Phase 2–4 gates in the
plan.

## Checks (script exit 0 requires all)

- 🟢 `multi_interval_columns_exist` · `vertical_cliff_samples_exist` · `extraction_produced_triangles`
- 🟢 `erosion_no_nan` · `erosion_carved_and_deposited` · `drainage_channel_exists` · `lakes_exist`

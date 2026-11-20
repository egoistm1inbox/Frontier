# 📝 Recovered GI & Shadow Candidate Sources (Provenance Archive)

**Status:** Read-only archive. **Not compiled, not registered with `frontier_register_exhibit()`.**
**Recovered from:** `SultanAladin/Frontier` commit history — files deleted by `63db120` ("Remove GI and SDF subsystems and unify direct OpenPBR/MatCap world rendering").

---

## 🧩 1. Why these files live here

The validation suites below were authored on 2026-11-19, measured, committed, and then deleted the next day together with the `Engine/DistanceFieldSpace/` and voxel-GI subsystems they depended on. The work was lost from the working tree twice; this archive keeps the exact sources in Git so the port described in [../../WorldGiShadowPathTracerPlan.md](../../WorldGiShadowPathTracerPlan.md) never has to re-derive them from chat history.

| File | Origin commit | Lines | Byte-identical to origin |
| :--- | :--- | ---: | :---: |
| `CleanEmissiveGiCandidates.h` | `2d6f15e` | 2 472 | ✅ |
| `CleanEmissiveGiValidation.cpp` | `2d6f15e` | 1 245 | ✅ |
| `CleanShadowAndGiCandidates.h` | `536cfe1` | 605 | ✅ |
| `CleanEmissiveShadowValidation.cpp` | `536cfe1` | 1 077 | ✅ |

No edits, no reformatting, no renaming — including identifiers that the current [BannedWordsVocabulary.md](../../../BannedWordsVocabulary.md) would reject (`GlyphPattern`, `DrawBitmapLabel`). The port renames those; the archive must stay faithful.

---

## 🧩 2. Why they do not compile on this branch

| Missing symbol | Deleted by | Port replacement |
| :--- | :--- | :--- |
| `DistanceFieldSpace::VoxelSdfClipmapVolume` | `63db120` | `SolarShadowSequence::EvaluateSolarShadowFieldWithAlgorithm(WideTreeRayQuery, …)` |
| `DistanceFieldSpace::ClosedBox`, `LocalGeometrySdfAsset` | `63db120` | `RigidClusterInstance` clusters + `WideBoundingTree` bounds |
| `DistanceFieldSpace::DynamicLocalSdfInstance` | `63db120` | `RigidClusterInstance` world-transformed triangles |
| `SceneGeometryBridge::SampleDynamicAssetSmoothDistance` | `63db120` | `WideBoundingTree::TraceClosestRay` |
| `GeometricRaster::Sobol02Sample`, `LaineKarrasPermutation`, `SampleSphericalCapGgxVndfLocal` | `63db120` | re-authored `GlobalIllumination/DeterministicQuadrature.h` |
| `ParticleSpace::QueryControlVehicleGeometrySet` | `daed305` | `.GeometrySpace` / `IndexedTriangleStreamInterchange` triangle streams |

Do **not** re-add a `#include "Engine/DistanceFieldSpace/…"` to make these compile — that subsystem is intentionally gone (see plan §4).

---

## 🧩 3. Measured results preserved with the sources

`536cfe1` (`Exhibits/Images/CleanEmissiveShadows/shadow_validation_summary.json`):

| Metric | Value |
| :--- | ---: |
| Shadow RMSE — `before_engine_sdf` | 0.417013 |
| Shadow RMSE — `cand2_surfel_disks_capsules` | 0.297254 |
| Shadow RMSE — `cand1_hybrid_cone_capsules` | 0.298272 |
| Shadow RMSE — `cand3_clipmap_cones_capsules` | 0.306751 |
| Lit HDR RMSE — `cand1_hybrid_stokes` | 0.133973 |
| Deforming rig update | 0.080977 ms |
| Verified / failed checks | 11 / 0 |

`2d6f15e` (`Exhibits/Images/CleanEmissiveGi/validation_summary.json`):

| Metric | Value |
| :--- | ---: |
| GI RMSE — `cand1_stokes_normal_gi` | 0.2238 |
| GI RMSE — `cand2_surfel_normal_gi` | 0.2239 |
| GI RMSE — `cand3_l1field_normal_gi` | 0.2259 |
| GI RMSE — `engine_clipmap` | 0.2402 |
| GI RMSE — `engine_ddgi` | 0.5361 |
| Scene | 25 068 vehicle triangles, 42 emissive triangles, 560×315 |
| Verified / failed checks | 9 / 0 |

---

## 🧩 4. How to use this archive

1. Copy the kernel math (`EvaluateClippedTriangleFormFactor`, the Stokes contour sum, `EvaluateBunnellDiskFormFactor`, the dual octahedral cascade layout) into the port.
2. Replace every SDF query with the real-triangle provider listed in §2.
3. Rename to the current vocabulary while porting; never ship the archived identifiers.
4. Re-render the comparison sheets under `Exhibits/Images/…` from the *new* exhibits — the originals were deleted with the code and are not restored here.

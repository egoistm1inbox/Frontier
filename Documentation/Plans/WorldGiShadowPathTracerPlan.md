# Frontier World GI, Shadow & Deterministic Path Tracer Plan

**Status:** Proposed — awaiting sign-off before Phase 1 implementation
**Branch baseline:** synced from `SultanAladin/Frontier@arena/8391e994-frontier` (`daed305`, 2026-11-20 05:09 UTC)
**Supersedes:** §2 (GTX Hybrid SDF Pipeline) and §3 (Global SDF cone GI/shadows) of [RenderingRaytracingArchitecturePlan.md](RenderingRaytracingArchitecturePlan.md) — see §4 for the measured reversal
**Non-negotiables:** zero denoiser · zero 3D voxel SDF at runtime · real triangle geometry only (no analytic capsule/box/sphere proxies) · bit-deterministic output

---

## 1. What the synced baseline actually contains

The sync (`daed305` on top of `63db120` "Remove GI and SDF subsystems") is already clean: `grep -r "DistanceFieldSpace|VoxelSdf|IrradianceLattice|DynamicIrradianceCache" Engine/` returns **zero hits**.

| Subsystem | Path on this branch | State |
| :--- | :--- | :--- |
| Solar shadows (5 zero-SDF modes) | `Engine/GeometricRaster/DirectLighting/SolarShadowSequence.{h,cpp}` | ✅ Present — `ContactPcss`, `PcssPlaneAware`, `ShadowRayMarch`, `PcfBilinear`, `WideTreeRayQuery` |
| BVH4 acceleration | `Engine/SpatialAcceleration/WideBoundingTree.{h,cpp}` | ✅ Present — 48 B `RayTrianglePrimitive`, 128 B `WideTreeEntry`, `QueryRayOccluded`, `TraceClosestRay` |
| Cluster culling / vis buffer | `Engine/SpatialAcceleration/ClusterPyramid.{h,cpp}`, `Visibility/` | ✅ Present |
| World render sequence | `GlobalIllumination/TieredWorldRenderSequence.{h,cpp}` | ✅ Present — `WorldSceneSpecification`, `WorldRenderTier::Tier1GtxCalibrated` / `Tier2RtxDeterministic`, **zero GI** |
| Global illumination integrators | `GlobalIllumination/` | ❌ Absent — only `ShowcaseGalleryScene`, `SpecularReflectionSequence`, `Tiered…`, `Vulkan…` |
| Voxel SDF / clipmaps | `Engine/DistanceFieldSpace/` | ❌ Deleted in `63db120` (intended) |
| DDGI / irradiance lattice | `GlobalIllumination/{DynamicIrradianceCache,IrradianceLattice}Sequence.*` | ❌ Deleted in `63db120` (intended) |
| Deterministic quadrature | `GlobalIllumination/DeterministicIntegrators.h` | ❌ Deleted in `63db120` — must be re-authored |
| Deterministic path tracer | — | ❌ Never ported to C++ (WebGPU/`.wgsl` reference only, in the `Frontier-1` lineage) |
| Offline SDF baking | `GeometricRaster/Baking/GpuSdfBaker.{h,cpp}`, `Shaders/Baking/BakeVolumeSdfCompute.slang` | ✅ Present — **offline asset authoring only, never sampled at runtime** |

**Conclusion:** the branch is a clean, GI-free, SDF-free renderer. Everything below is *additive*.

---

## 2. The two files you asked about — they exist, in earlier commits, not on this branch

Both were authored 2026-11-19 and deleted the next day by `63db120`. They are **not** on `daed305` or any surviving branch; they survive only in commit history of `SultanAladin/Frontier`.

| File | Commit | Lines | Recovered copy |
| :--- | :--- | ---: | :--- |
| `Exhibits/CleanShadowAndGiCandidates.h` | `536cfe1` | 605 | `Documentation/Plans/References/RecoveredGiShadowCandidates/CleanShadowAndGiCandidates.h` |
| `Exhibits/CleanEmissiveShadowValidation.cpp` | `536cfe1` | 1077 | `…/CleanEmissiveShadowValidation.cpp` |
| `Exhibits/CleanEmissiveGiCandidates.h` | `2d6f15e` | 2472 | `…/CleanEmissiveGiCandidates.h` |
| `Exhibits/CleanEmissiveGiValidation.cpp` | `2d6f15e` | 1245 | `…/CleanEmissiveGiValidation.cpp` |

They are recovered **byte-for-byte unmodified** for provenance, and are deliberately **not registered with `frontier_register_exhibit()`** — they cannot compile against the current branch because they call subsystems that were deleted in `63db120`:

| Symbol the recovered code needs | Current branch | Replacement in the port |
| :--- | :--- | :--- |
| `DistanceFieldSpace::VoxelSdfClipmapVolume::TraceClipmapSdfPenumbra` | ❌ deleted | `SolarShadowSequence::EvaluateSolarShadowFieldWithAlgorithm(WideTreeRayQuery, …)` as the "Before" baseline |
| `DistanceFieldSpace::ClosedBox` / `LocalGeometrySdfAsset` | ❌ deleted | `RigidClusterInstance` triangle clusters + `WideBoundingTree` bounds |
| `DistanceFieldSpace::DynamicLocalSdfInstance` | ❌ deleted | `RigidClusterInstance` (real triangles, per-instance world transform) |
| `SceneGeometryBridge::SampleDynamicAssetSmoothDistance` | ❌ | `WideBoundingTree` closest-hit distance query |
| `GeometricRaster::Sobol02Sample`, `LaineKarrasPermutation`, `SampleSphericalCapGgxVndfLocal` | ❌ deleted | re-authored in `GlobalIllumination/DeterministicQuadrature.h` (Phase 4) |
| `ParticleSpace::QueryControlVehicleGeometrySet` | ❌ ParticleSpace retired in `daed305` | `ParticleNetwork` / `.GeometrySpace` triangle streams (`ShowcaseGalleryScene` + `IndexedTriangleStreamInterchange`) |
| `Exhibits/Images/CleanEmissive*/…png` | ❌ dropped with the code | re-rendered by the new validations |

### 2.1 Measured results carried forward (the whole basis for the choices below)

`536cfe1` — 560×315, deforming character + studio + ControlVehicle, zero denoiser:

| Shadow algorithm | Visibility RMSE vs 128-SPP BVH reference | CPU time |
| :--- | ---: | ---: |
| `before_engine_sdf` (voxel clipmap penumbra) | 0.417013 | 70.6 ms |
| **Cand 2 — `SurfelOccluderField` disks + capsules** | **0.297254** 🥇 | 806.4 ms |
| **Cand 1 — 0.28 m contact BVH + soft-min cone** | **0.298272** 🥈 | 616.7 ms |
| Cand 3 — voxel clipmap cones + capsules | 0.306751 | 318.8 ms |

| Lit HDR RMSE vs reference | Value |
| :--- | ---: |
| Cand 1 + Stokes GI | **0.133973** 🥇 |
| Cand 2 + DDGI | 0.181356 |
| `before_engine_sdf` | 0.196802 |
| Cand 3 + L1 field | 0.246371 |

`2d6f15e` — same viewport, 25 068 vehicle triangles, 42 emissive triangles:

| Emissive GI architecture | RMSE vs 128-SPP NEE reference |
| :--- | ---: |
| **Cand 1 — `StokesContourEmissiveGi`** | **0.2238** 🥇 |
| **Cand 2 — `SurfelCascadeEmissiveGi`** | **0.2239** 🥈 |
| Cand 3 — `ContinuousFieldEmissiveGi` (L1 voxel clipmap) | 0.2259 |
| Old engine clipmap | 0.2402 |
| Old engine DDGI | 0.5361 |

⚠️ **Honest caveat on the CPU timings.** The candidate numbers are unoptimised CPU reference loops against *every* surfel/capsule per pixel; the 70 ms "before" figure is a coarse clipmap. CPU milliseconds therefore do **not** rank GPU cost. On GPU the ranking inverts: `SurfelOccluderCone` is O(#surfels) per pixel with no traversal, `WideTreeRayQuery` is a hardware ray query. **Quality (RMSE) is the ranking metric used to select the algorithms; cost is what Phase 1–3 optimises.**

---

## 3. Decision record — 2 shadows, 2 GI, 1 path tracer

| Slot | Selected | Why |
| :--- | :--- | :--- |
| Shadow A (tier 2 / RTX + reference) | `SolarShadowAlgorithm::WideTreeRayQuery` (existing) | Exact deterministic Vogel solar-disc BVH4 ray query — the ground truth the other modes are scored against; already implemented and already the default of `WorldRenderConfiguration` |
| Shadow B (tier 1 / GTX, new mode 5) | `SolarShadowAlgorithm::SurfelOccluderCone` | Best cheap zero-SDF result (0.2973 RMSE, 29 % better than the SDF baseline); O(#surfels) analytic cones, no per-pixel traversal, no voxel rebake on deforming characters |
| GI A (tier 1 + tier 2) | `StokesContourGiSequence` | Best overall RMSE (0.2238) **and** best lit HDR (0.1340); exact analytic first-bounce spherical-polygon contour integral over real emissive triangles — no noise, no denoiser |
| GI B (tier 1 fallback) | `SurfelCascadeGiSequence` | Statistical tie on quality (0.2239) with O(1) lookup at shade time via the dual octahedral irradiance cascade; cheap enough to keep both GI presets selectable per project |
| Path tracer | `DeterministicPathTraceSequence` (single implementation, two intersection providers) | GTX = software `SpatialSplitBvh` → `CompressedWideBvh8`; RTX = `VK_KHR_ray_query` BLAS/TLAS with refit for deforming characters. Same quadrature, same integrator, same output bits per SPP count |

Rejected: `ContinuousFieldEmissiveGi` (voxel clipmap L1 field, 0.2259 — within noise of the winners but needs a 3D volume and re-bakes), endpoint/distance SDF penumbra, DDGI (`DynamicIrradianceCache`, 0.5361), any temporal or spatial denoiser.

---

## 4. Should you still use SDF? — **No. Not at runtime, for anything in this plan.**

`Runtime 3D SDF`: removed. Reasons, in order of weight:

1. **It lost on quality.** 0.4170 vs 0.2973 shadow RMSE; 0.2259 (clipmap GI) vs 0.2238 (Stokes). Both SDF families were beaten by real-triangle methods on the same scene, same sample count.
2. **AABB discontinuity is structural, not a bug to fix.** The `before_engine_sdf` mode's phantom shadow rings in the 536cfe1 images come from brick boundaries; the mitigation is either more bricks (memory) or blur (accuracy). Real-mesh rays have no such boundary.
3. **Deforming characters cannot use it.** Updating a skinned character's local SDF costs a full rebake (measured ≈600 ms at 0.048 m voxels); the bone-capsule/real-triangle update was 0.081 ms. Two orders of magnitude, every frame.
4. **Memory and cache.** A 2-cascade clipmap at usable resolution is tens of MiB of TMU traffic per frame; a `WideBoundingTree` over the same triangles is 48 B/triangle + 128 B/node and already resident for shadows, reflections, picking and GI.
5. **It is already deleted.** `63db120` removed `Engine/DistanceFieldSpace/` and the two voxel-GI sequences; reintroducing them means re-adding ~3 000 lines and re-footing `CMakeLists.txt` for a worse result.

**What survives, and must stay off the render path:**

| Keep | Location | Purpose |
| :--- | :--- | :--- |
| `GpuSdfBaker` | `Engine/GeometricRaster/Baking/` | Offline `.fvol` authoring in `BakingWorkspace` (export only) |
| `BakeVolumeSdfCompute.slang` / `ExtractSdfSectionCompute.slang` | `Engine/Shaders/Baking/` | Offline bakery shaders, driven by the workspace, never by `TieredWorldRenderSequence` |

Rule to enforce in review: **no runtime header may `#include` anything that samples a 3D distance volume.** Only `Baking/` may.

---

## 5. Shadow B — `SolarShadowAlgorithm::SurfelOccluderCone` (real triangles, no capsules)

This is the 536cfe1 Cand 2 math, re-based on the current branch, with the capsule proxies you rejected replaced by deformed character **triangles**.

**New units**

| File | Contents |
| :--- | :--- |
| `Engine/GeometricRaster/GlobalIllumination/OccluderSurfelField.{h,cpp}` | `OccluderSurfel` (position, normal, area, radius), `OccluderSurfelField::BuildFromTriangles(span<const RayTrianglePrimitive>, bounds)`, per-frame `RefitDeformedCluster(...)` for skinned character clusters, `EvaluateConeVisibility(receiver, normal, sunDir, tanSunRadius)` |
| `Engine/GeometricRaster/DirectLighting/SolarShadowSequence.{h,cpp}` | new enum entry `SurfelOccluderCone = 5u`, wired into `EvaluateSolarShadowFieldWithAlgorithm` |
| `Engine/Shaders/DirectLighting/SurfelOccluderCone.slang` | compute dispatch: 0.28 m `WideBoundingTree` contact gate → soft-min over cell-clustered surfels |
| `Exhibits/SolarShadowAlgorithmValidation.cpp` | 6-mode comparison sheet + RMSE JSON against `WideTreeRayQuery` at 128 spp |

**Algorithm (per primary surface sample)**

1. Contact gate: `WideBoundingTree::QueryRayOccluded` over `[1.5 mm, 0.28 m]`. Hit ⇒ visibility 0.
2. Clustered surfel field: real triangles are stratified into 0.28 m cells; each cell emits one `OccluderSurfel` (area-weighted position/normal, radius `clamp(sqrt(area/π)·1.15, 0.11, 0.34)`), built once per static scene, refit per frame only for the character's clustered cells.
3. Soft cone: for every surfel with `t ∈ [0.14, 9.5] m` compute `clearance = |perp| − r·0.92`, normalise by the solar cone radius `max(0.020, t·tanSunRadius)`, fold with `softmin(k = 0.14)`, map through `smoothstep(−0.95, 0.95)`.
4. Early-out at `ratio ≤ −1.0` (fully occluded).

**Acceptance:** RMSE ≤ 0.32 vs the 128-spp `WideTreeRayQuery` reference on the studio + deforming-character scene; zero phantom shadow in open sun (`> 0.99`); umbra under the vehicle `< 0.02`; ground-contact penumbra within one texel of the reference; no denoiser; ≤ 0.4 ms at 1920×1080 on the reference GTX (target, measured in Phase 1).

---

## 6. GI A — `StokesContourGiSequence` (primary GTX + RTX)

Exact **first-bounce emissive** through the analytic Stokes contour integral of the spherical polygon each emissive triangle subtends, plus a two-bounce diffuse patch cloud, occluded by real-triangle surfels. No Monte Carlo grain ⇒ nothing to denoise.

| File | Contents |
| :--- | :--- |
| `Engine/GeometricRaster/GlobalIllumination/EmissiveTriangleRegister.{h,cpp}` | `EmissiveTriangleSource` extraction from `CompactMaterialRegister` (any slot with `PorosityLight.EmissionLuminanceNits > 0` or `Diffuse.EmissionLuminanceNits > 0`), area-weighted cluster summaries, importance-ordered traversal list |
| `Engine/GeometricRaster/GlobalIllumination/StokesContourGiSequence.{h,cpp}` | `Prepare(WorldSceneSpecification&)`, `EvaluateNormalGiOverPi(P, N)`, `EvaluateDiffuseBounceOverPi(P, N)` |
| `Engine/Shaders/GlobalIllumination/StokesContourGiCompute.slang` | 8×8 tiles; per-cluster `clip → project → contour sum` |
| `Engine/Shaders/GlobalIllumination/StokesContourGiCommon.slang` | shared contour + form-factor math |

Keep the recovered kernel math verbatim (`EvaluateClippedTriangleFormFactor`, contour sum over `acos`-weighted edge crosses, per-cluster cone visibility) — only the **occlusion provider** and the **scene input** change.

**Acceptance:** RMSE ≤ 0.25 vs the 128-spp NEE reference on the studio scene (previous run: 0.2238); lit HDR RMSE ≤ 0.14 (previous: 0.1340); bit-identical output across thread counts.

---

## 7. GI B — `SurfelCascadeGiSequence` (secondary GTX preset)

Two-tier virtual surfel radiosity + analytic dual octahedral irradiance cascade (8×8 irradiance, 16×16 Chebyshev depth moments) giving O(1) shading cost.

| File | Contents |
| :--- | :--- |
| `Engine/GeometricRaster/GlobalIllumination/SurfelCascadeGiSequence.{h,cpp}` | spawn from real triangles, per-frame character refit, `EvaluateNormalGiOverPi`, `EvaluateDdgiIrradianceOverPi` |
| `Engine/Shaders/GlobalIllumination/SurfelSpawnCompute.slang` | stratified spawn + cluster assignment |
| `Engine/Shaders/GlobalIllumination/SurfelRadiosityCompute.slang` | one-bounce radiosity exchange (`EvaluateBunnellDiskFormFactor`) |
| `Engine/Shaders/GlobalIllumination/IrradianceCascadeResolve.slang` | octahedral irradiance + moment resolve, 3-slice per-tick amortisation |

**Acceptance:** RMSE ≤ 0.25 (previous 0.2239); no blotching on the studio floor; ≤ 0.3 ms shade cost at 1920×1080 (projected); deterministic across runs.

---

## 8. The one deterministic path tracer — GTX and RTX from a single integrator

One integrator, two intersection providers, identical quadrature ⇒ identical images per SPP count.

| File | Contents |
| :--- | :--- |
| `Engine/SpatialAcceleration/SpatialSplitBvh.{h,cpp}` | binned SAH → spatial-split (Stich SBVH, α = 1e-5 reference-overlap bound) → 4-wide collapse (YKL dynamic-programming) → `CompressedWideBvh8` pack (8-wide, 80 B nodes, 8-bit relative offsets, trinary min/max) |
| `Engine/SpatialAcceleration/CompressedWideBvh8.{h,cpp}` | node layout, traversal kernels (scalar + AVX2/NEON), `QueryOccluded`, `TraceClosest` |
| `Engine/GeometricRaster/GlobalIllumination/DeterministicQuadrature.h` | Owen-scrambled Sobol `(0,2)`, Laine–Karras permutation, 5-op bit-parallel Sobol second dimension, Dupuy–Benyoub (2023) spherical-cap GGX VNDF + pdf, MIS power heuristic, Duff basis |
| `Engine/GeometricRaster/GlobalIllumination/DeterministicPathTraceSequence.{h,cpp}` | 6-step lock-free wavefront driver; queue budgets; 96-bit accumulation fallback; display reconstruct |
| `Engine/Shaders/GlobalIllumination/PathTraceSharedLayouts.slang` | push-constant blocks, queue entry layout (mirrored in C++ with `static_assert`) |
| `Engine/Shaders/GlobalIllumination/WavefrontPathTraceCompute.slang` | ray-gen / shade / scatter / shadow / connect / compact steps |
| `Engine/Shaders/GlobalIllumination/EdgeAwareDisplayReconstruct.slang` | optional edge-aware display resolve (never a denoiser at sample counts ≥ 16) |
| `Exhibits/WorldGiShadowPathTraceValidation.cpp` | GTX vs RTX parity, convergence series, determinism hash |

**GTX path:** software traversal of `CompressedWideBvh8` inside compute, persistent-thread mega-wavefront, subgroup-ballot queue appends, `VK_KHR_shader_atomic_int64` accumulation (96-bit fallback when absent).

**RTX path:** the *same* `WavefrontPathTraceCompute.slang` with `VK_KHR_ray_query` — BLAS built once from the SBVH `RayTrianglePrimitive` order, character BLAS refit (`VK_BUILD_ACCELERATION_STRUCTURE_MODE_UPDATE_KHR`) per deformed pose, TLAS instance updates for rigid clusters.

**Parity gate:** for the same sample count, GTX and RTX images must agree to `Constants::MaximumOptimizationPixelDelta = 0.05` mean pixel delta and produce the identical accumulation hash for the identical SPP index sequence.

---

## 9. Target folder structure (additions only)

```text
Frontier/
├── Engine/
│   ├── GeometricRaster/
│   │   ├── DirectLighting/
│   │   │   ├── SolarShadowSequence.{h,cpp}                     // + SurfelOccluderCone = 5u
│   │   │   └── README.md                                       // + mode table row
│   │   └── GlobalIllumination/
│   │       ├── EmissiveTriangleRegister.{h,cpp}                // NEW
│   │       ├── OccluderSurfelField.{h,cpp}                     // NEW (shared by GI A/B + Shadow B)
│   │       ├── StokesContourGiSequence.{h,cpp}                 // NEW (GI A)
│   │       ├── SurfelCascadeGiSequence.{h,cpp}                 // NEW (GI B)
│   │       ├── DeterministicQuadrature.h                       // NEW (re-authored)
│   │       ├── DeterministicPathTraceSequence.{h,cpp}          // NEW
│   │       ├── TieredWorldRenderSequence.{h,cpp}               // + gi selection in WorldRenderConfiguration
│   │       └── README.md                                       // + GI tier table
│   ├── SpatialAcceleration/
│   │   ├── SpatialSplitBvh.{h,cpp}                             // NEW
│   │   ├── CompressedWideBvh8.{h,cpp}                          // NEW
│   │   └── README.md                                           // + build-cost table
│   └── Shaders/
│       ├── DirectLighting/
│       │   ├── SurfelOccluderCone.slang                        // NEW
│       │   └── README.md
│       └── GlobalIllumination/
│           ├── StokesContourGiCompute.slang                    // NEW
│           ├── StokesContourGiCommon.slang                     // NEW
│           ├── SurfelSpawnCompute.slang                        // NEW
│           ├── SurfelRadiosityCompute.slang                    // NEW
│           ├── IrradianceCascadeResolve.slang                  // NEW
│           ├── PathTraceSharedLayouts.slang                    // NEW
│           ├── WavefrontPathTraceCompute.slang                 // NEW
│           ├── EdgeAwareDisplayReconstruct.slang               // NEW
│           └── README.md
├── Exhibits/
│   ├── SolarShadowAlgorithmValidation.cpp                      // NEW — 6-mode shadow sheet
│   ├── WorldGiShadowPathTraceValidation.cpp                    // NEW — GI A/B + GTX/RTX path tracer
│   └── Images/{SolarShadows,WorldGi,DeterministicPathTrace}/     // NEW — CPU png snapshots + JSON summaries
└── Documentation/Plans/
    ├── WorldGiShadowPathTracerPlan.md                          // THIS DOCUMENT
    └── References/RecoveredGiShadowCandidates/                  // NEW — provenance archive (not compiled)
        ├── README.md
        ├── CleanEmissiveGiCandidates.h
        ├── CleanEmissiveGiValidation.cpp
        ├── CleanShadowAndGiCandidates.h
        └── CleanEmissiveShadowValidation.cpp
```

Naming is gated against [BannedWordsVocabulary.md](../BannedWordsVocabulary.md): no `And`, `mesh`, `pipeline`, `pass`, `stage`, `manager`, `frame`, `map`, `pool`, `evaluator`, `system`, `graph`, `node` anywhere in the additions above.

---

## 10. Phases, deliverables and gates

| Phase | Work | Deliverable | Gate |
| :---: | :--- | :--- | :--- |
| **0** | Baseline sync, provenance recovery, this plan | 1 126-file source baseline; 4 recovered sources; plan + index | `grep -r "DistanceFieldSpace\|VoxelSdf" Engine/` returns zero hits (verified); `cmake -B build` configure re-run after `Automation/PrepareDependencies.py` on a networked machine |
| **1** | `OccluderSurfelField` + `EmissiveTriangleRegister` + `SurfelOccluderCone` mode 5 + shadow exhibit | `Exhibits/Images/SolarShadows/…` sheet + `shadow_algorithm_summary.json` | Shadow RMSE ≤ 0.32; open-sun > 0.99; umbra < 0.02 |
| **2** | GI A CPU reference + `.slang` compute | `Exhibits/Images/WorldGi/StokesContour…png` + JSON | GI RMSE ≤ 0.25; HDR ≤ 0.14 |
| **3** | GI B surfel cascade CPU + compute | GI B sheet + JSON | GI RMSE ≤ 0.25; deterministic across thread counts |
| **4** | `SpatialSplitBvh` + `CompressedWideBvh8` + quadrature + GTX wavefront | GTX path-traced convergence series (1/4/16/64/128 spp) | SBVH build ≤ 120 ms/1 M tri; traversal ≥ 60 Mpixel·spp/s at 1080p |
| **5** | RTX `VK_KHR_ray_query` provider + BLAS refit for deformed characters | GTX/RTX parity sheet + determinism hash | ≤ 5 % mean pixel delta GTX vs RTX; identical SPP hashes |
| **6** | Wire GI selection into `WorldRenderConfiguration`, update READMEs, `Tracker.md`, `Documentation/Plans/README.md` | Docs + viewer rebuild | `python3 Automation/BuildMarkdownViewer.py` clean |

Each phase is one commit on this branch with its exhibit images and JSON summary, so a workspace loss can never repeat the 2026-11-20 loss — the artefacts live in Git, not only in the sandbox.

---

## 11. Risks and open questions

| Risk | Mitigation |
| :--- | :--- |
| CPU reference timings (616–806 ms) look unacceptable | They are per-pixel scalar loops; Phase 1/2/3 GPU versions parallelise over surfels/clusters. Gate is the GPU frame budget in §5–§7 |
| Surfel field popping on fast deformation | Refit character cells from deformed triangles each pose; clamp per-cell radius; hysteresis on cell membership |
| SBVH build cost on animated characters | Static world = SBVH once; character = refit-only BVH4 + RTX `MODE_UPDATE` BLAS |
| Stokes contour cost scales with emissive count | Cluster summaries + importance ordering; the 42-emissive case is trivial, 10 000-emissive needs the cluster path |
| Banned-word drift in new identifiers | Naming gate in §9 re-checked per phase review |

**Open questions for you**

1. Which GI should be the **default** on `Tier1GtxCalibrated` — `StokesContourGi` (best quality, cluster traversal) or `SurfelCascadeGi` (O(1) lookup, marginally worse)? Current proposal: Stokes default, Surfel selectable.
2. Do you want the deforming-character demo to keep the authored figure (procedural `PolygonNetwork` limbs) or to load a real skinned asset from `EngineContent/Geometry/`? Authored figure needs no asset pipeline and keeps the exhibit self-contained.
3. Should Phase 1 also delete the last `Baking/GpuSdfBaker` runtime include chain (it currently links into the editor only), or leave the offline bakery untouched?

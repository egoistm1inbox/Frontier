# World Lighting & Deterministic Trace Plan

> **Review draft — no lighting implementation approved or completed.** Restore the source snapshot, then compare two provisional GTX GI designs and two real-triangle shadow designs before choosing production defaults. Use one deterministic path tracer with software traversal on GTX and optional hardware traversal where supported. No SDF volume is required by the proposed production paths.

## 1. Decisions for review

| Decision | Recommendation | Qualification |
| :--- | :--- | :--- |
| Geometry | Authored vehicle, environment and animated character triangles; actual skinned/deformed vertices drive every visibility path. | No capsule, box or disk stand-ins for character or scene occlusion. Point/surface samples for GI are a lighting approximation, not replacement geometry; visibility uses triangles. |
| GTX GI 1 | Triangle-emitter contour integration with triangle-ray visibility and a diffuse surface-sample bounce cache. | Provisional port of the old Stokes concept, not its old SDF visibility implementation. Contour integration is analytic *lighting math*, not analytic scene geometry. |
| GTX GI 2 | Triangle-derived surface-sample radiosity with an irradiance probe cache and triangle-ray visibility. | Provisional alternative; probe interpolation and visibility can leak or lag, so measure memory, update cost and quality. |
| Shadows 1 | Contact PCSS from real triangle shadow maps plus triangle BVH contact queries. | Provisional GTX performance option; shadow-map filtering is part of the shadow algorithm, not a temporal denoiser. |
| Shadows 2 | Deterministic multi-sample solar-disc rays against real triangles. | Quality option; software BVH works without RT cores, hardware ray query is optional. Cost rises with samples. |
| SDF | Do not introduce a voxel SDF for these GI, shadow or path-tracing routes initially. | This is an architectural choice, not a proof that the historical two GI prototypes were SDF-free or that alternatives will be faster. Keep the separate existing SDF baking workspace intact. |
| Path tracer | One estimator, shared materials and deterministic sampling; select software BVH or feature-gated hardware traversal. | RTX is not a guarantee of Vulkan ray-query support; validate extensions, features, drivers and triangle-update capabilities. |

**Decision gate:** the two GI and two shadow entries are candidates, not certified winners. Rank against equal-quality, real-mesh tests on the user's target GPU(s) before adopting them. No analytic geometry substitutes, including capsules or surfel disks, are used for shadow/occlusion geometry.

## 2. What is recovered and what the evidence actually says

| Source | Finding |
| :--- | :--- |
| `SultanAladin/Frontier` `daed3058c274694020c6e34e4f4f2e6b5d8bd9e6` | Source tree imported to this session branch. `63db120` previously removed the GI/SDF runtime and exhibits; `daed305` still has active world direct rendering and reflections under `Engine/GeometricRaster/GlobalIllumination/`. Despite its folder name, deleting this directory would break current rendering. |
| `536cfe1`, [`CleanShadowAndGiCandidates.h`](https://github.com/SultanAladin/Frontier/blob/536cfe1/Exhibits/CleanShadowAndGiCandidates.h) and [`CleanEmissiveShadowValidation.cpp`](https://github.com/SultanAladin/Frontier/blob/536cfe1/Exhibits/CleanEmissiveShadowValidation.cpp) | Both existed in that commit and were deleted by `63db120`; they are not in the restored tree. The user-pasted header/test differ in places from the committed versions. They depend on retired `DistanceFieldSpace` types, hard-coded studio boxes and character capsules, so cannot be dropped into today's engine unchanged. |
| `2d6f15e`, [`CleanEmissiveGiCandidates.h`](https://github.com/SultanAladin/Frontier/blob/2d6f15e/Exhibits/CleanEmissiveGiCandidates.h), [`validation_summary.json`](https://github.com/SultanAladin/Frontier/blob/2d6f15e/Exhibits/Images/CleanEmissiveGi/validation_summary.json) | Reported full-lit clamped linear RGB RMSE: Stokes `0.2238`, surfel normal `0.2239`, field normal `0.2259`; reference was 128-spp emissive NEE in one scene. The first two prototypes use `SceneGeometryBridge` SDF/box occlusion; changing visibility invalidates any claim that their recorded scores demonstrate an SDF-free implementation. The very small difference does not establish a robust ranking. |
| `536cfe1`, [`shadow_validation_summary.json`](https://github.com/SultanAladin/Frontier/blob/536cfe1/Exhibits/Images/CleanEmissiveShadows/shadow_validation_summary.json) | Reported visibility RMSE against a 128-ray reference: hybrid `0.298272`, surfel/capsules `0.297254`, clipmap/capsules `0.306751`, old baseline `0.417013`. Those are one CPU scene with proxies, not a benchmark of real animated characters or GPU frame time. Recorded 560×315 timings were `616.655`, `806.37`, and `318.792` ms respectively. |
| `536cfe1` test | `RenderShadowField` captures `GBufA` even when used for pose B, then combines that visibility with `GBufB`; the pose comparison cannot validate the rendered pose B. The baseline omits character capsules, while candidates include them; examine clipmap initialization and all scene inputs before treating the baseline as fair. The `0.080977 ms` result times construction of a capsule rig plus mesh, not an animated-character GPU update. |
| [`Frontier-1@d5bbb81`](https://github.com/SultanAladin/Frontier-1/tree/d5bbb81bddd320242d1de95a36bf6cafa83dca7f) | The cited branch has a WebGPU path tracer prototype and `DeterministicIntegrators.h`; they are not a completed native Vulkan path tracer in this restored tree. Its `SolarShadowAlgorithm` enum lists five non-SDF and three SDF modes; the restored snapshot has five non-SDF enum modes. The lab UI lists seven choices, including two legacy SDF modes. Verify any claimed sixth non-SDF mode rather than inventing one. |

**Historical comparisons are directional evidence only.** Do not restore removed exhibits as production code or report their outputs as new measurements. Original commits remain accessible in the source repository. Offline baking files `Engine/GeometricRaster/Baking/GpuSdfBaker.{h,cpp}` and `Engine/Shaders/Baking/*Sdf*.slang` belong to the existing baking workspace, not the proposed lighting pipeline. Preserve them. No other SDF-named runtime files were found under `Engine/` in `daed305`.

## 3. Current tree and proposed additions

`[existing]` is present in the imported snapshot; `[proposed]` is a planning location/name, not implemented. Reuse existing modules and naming rules before creating files.

```text
Engine/
  GeometrySpace/Network/PolygonNetwork.*                   [existing triangles]
  SpatialAcceleration/WideBoundingTree.{h,cpp}             [existing CPU BVH4; no public refit API]
  GeometricRaster/
    DirectLighting/SolarShadowSequence.{h,cpp}             [existing five shadow modes]
    GlobalIllumination/
      TieredWorldRenderSequence.{h,cpp}                    [existing direct world render]
      VulkanWorldRenderSequence.{h,cpp}                    [existing Vulkan world render]
      SpecularReflectionSequence.{h,cpp}                    [existing reflections]
      TriangleContourGiSequence.{h,cpp}                    [proposed GI 1]
      SurfaceSampleGiSequence.{h,cpp}                      [proposed GI 2]
      DeterministicTraceSequence.{h,cpp}                   [proposed shared path tracer]
    Baking/GpuSdfBaker.{h,cpp}                             [existing, separate]
  Shaders/
    DirectLighting/                                        [existing]
    GlobalIllumination/                                    [existing; add GI/trace .slang only as needed]
    Baking/                                                [existing, separate]
Exhibits/                                                  [add real-scene C++ validation after approval]
Documentation/Plans/WorldLightingTracePlan.md              [this plan]
Experimental/ShadowAlgorithmLab/                           [existing JS lab]
```

The `Experimental/DeterministicPathTracer/` JS/WGSL prototype is also present in this snapshot; it is not a native Vulkan module. Compare it with `Frontier-1` and port selectively into C++20 and Slang instead of copying the retired SDF-dependent engine. Evaluate whether an animation/skinning input already exists elsewhere before introducing one: `WideBoundingTree` itself exposes build/query but no refit in its public interface. Define versioned current-frame triangle positions, material identifiers, transform and ownership; avoid silently using the previous pose. Preserve shadow, GI and trace modes independently in renderer configuration.

## 4. Implementation milestones after approval

| Phase | Deliverable and exit gate |
| :--- | :--- |
| 0 — Reproducible baseline | Inventory current CPU/Vulkan shader dispatch and capability probes; select real, licensed animated character asset, vehicle and environments. Lock camera paths, material/light setup, target GPU, resolution and frame budget. Record existing five shadow modes, no denoising, and report missing features. |
| 1 — Triangle visibility | Supply current deformed triangles to raster shadow maps and software BVH; measure rebuild first, then implement/test refit and rebuild fallback if justified. Add explicit synchronization, stable triangle IDs, normal/bias handling, alpha/transmission policy, topology-change rebuilds and hardware AS update when supported. Validate moving characters and rigid instances against brute-force intersections. |
| 2 — Two shadow candidates | Exercise existing ContactPcss and WideTreeRayQuery, verify their actual CPU/GPU dispatch and filtering; add missing GPU paths only as needed. Compare them with PCSS plane-aware, SMRT and PCF plus the lab implementations. Use identical pose, lighting, bias policy and sample conditions; choose two based on quality/cost, not their labels. |
| 3 — GI 1 | Extract actual emissive triangles and materials; implement contour integration with visibility against current triangles, plus a bounded secondary diffuse sample cache. Handle partial occlusion, small emitters, moving emissive surfaces, energy units and temporal invalidation. Compare isolated first/second bounce to the reference before integration. |
| 4 — GI 2 | Sample actual diffuse/emissive triangle surfaces, construct bounded radiosity updates and interpolate probe irradiance; trace visibility against current triangles. Define update budgets, probe placement, dynamic invalidation, leakage handling and cache memory. Compare against GI 1 with the same lighting and no denoiser. |
| 5 — Unified path tracer | Port and verify Sobol/quadrature and BSDF/material/light sampling against source tests. Start with bounded software BVH compute; add capability-gated `VK_KHR_acceleration_structure`/`VK_KHR_ray_query` route sharing the estimator and accumulation. Keep optional denoising/reprojection separately disabled for reference and GI evaluation. Benchmark simple versus wavefront dispatch before committing to queue layout, atomics or specialized compressed BVHs. |
| 6 — Product integration | Connect world renderer, Slang compilation, resource lifetime, scene changes and independent user selectors; preserve existing modes and behavior. Run C++/shader tests, GPU validation and platform builds; add exhibit captures and measured results. Mark only validated capabilities as shipped. |

**Path tracer determinism:** fixed sample indices and accumulation order for repeated runs on the same device/configuration; test batch-size changes, resize, camera/geometry/material/light invalidation and BVH versus hardware hit tolerances. Cross-device bit identity is not promised because floating point and traversal can differ. No universal real-time FPS claim: measure GTX and RTX hardware separately. A path tracer can operate without a denoiser, but low-sample images may remain noisy; denoising is optional and never part of the reference.

## 5. Validation and selection protocol

| Test | Required checks |
| :--- | :--- |
| Scenes | Real triangle vehicle + rigged character at multiple poses, moving character/vehicle, thin spokes, overlapping/deforming limbs, interior/exterior, small/large emitters, many lights, moving light and emissive surface. Include closed, open and alpha/transmissive surfaces where supported. |
| Reference | High-sample deterministic triangle path trace / solar-disc rays with convergence checks (increase spp until error stabilizes); save independent references and identical inputs per pose. Avoid using an unverified estimator as ground truth. |
| Quality | Linear HDR GI-only RMSE/relative error with explicit masks and exposure; direct shadow visibility RMSE plus contact, thin-geometry and leak crops; full-lit comparison separately. Measure pose A and B from their own primary buffers, then compare fixed world-space receiver samples to isolate motion. |
| Performance | Actual GPU timestamps: skinning, shadow-map rendering, BVH/AS build or update, GI preparation/update, per-frame shading and total frame; report resolution, GPU, driver, API, sample count, memory, warm-up and median/p95. CPU setup is separate. Include static vs moving workloads and 1/many characters/lights. |
| Correctness | No stale animation, light leaks through thin geometry beyond agreed limits, lost occluders, temporal ghosts, unstable silhouettes or unbounded queue/stack overflow. Test determinism, triangle occlusion, energy conservation and CPU/GPU agreement within stated tolerances. |
| Promotion | Select only after quality and performance budgets are agreed, candidate results are reproducible and both target hardware classes are measured. Log failures and tradeoffs; retain fallback if a candidate fails. |

## 6. Decisions needed before implementation

1. Which GTX and RTX models, target resolution and frame-time budget (including number of animated characters/lights)?
2. Which rigged character asset and animation may be used for validation? Does an existing runtime supply its deformed triangle stream?
3. Confirm the two provisional GI approaches and shadow candidates; should optional path-tracer display denoising be allowed, or must all outputs remain denoiser-free?
4. Is the plan-only review the next gate? No renderer changes are made by this document.

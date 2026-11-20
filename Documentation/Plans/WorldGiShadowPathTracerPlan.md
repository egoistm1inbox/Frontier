# Real-mesh world lighting implementation plan

**Decision: no runtime SDF for shadows, GI, or path tracing.** Keep offline `GpuSdfBaker` and its shaders for baking. Render the actual rigid and skinned triangles. No capsule, sphere, or box substitutes for casters or receivers. BVH bounds are acceleration metadata, not geometry. Surfels are lighting samples derived from triangles, not replacement visibility geometry.

## Verified starting point

- `daed305` is the clean engine baseline. `63db120` retired the runtime GI/SDF implementation. The requested `CleanShadowAndGiCandidates.h` and `CleanEmissiveShadowValidation.cpp` are recoverable from `536cfe1`; GI sources and results are in `2d6f15e`. Read them with `git show <commit>:<path>`; do not restore them wholesale to the build.
- The archived GI run measured normal-GI RMSE of **0.2238 Stokes**, **0.2239 surfel**, **0.2259 voxel field**. Surfel DDGI specifically measured **0.2269**. The 0.0001 separation does not establish a durable winner. The old shadow run measured **0.2973 surfel/capsule**, **0.2983 hybrid SDF/capsule**, and **0.4170 engine baseline**; none establishes a ranking for skinned meshes. Its paired lit score also changed GI and shadow simultaneously. In the pasted validator, the pose-B shadow pass captures the pose-A hit buffer; the replacement must explicitly take the matching hit buffer.
- Frontier-1 `d5bbb81` has eight native enum entries: five non-SDF and three SDF. The synced tree already has the five non-SDF entries. Its experimental deterministic tracer is a reference, not proof of native Vulkan support; Frontier-1 also has `DeterministicIntegrators.h`, which is absent from the synced engine.

## Candidates to implement and measure

| Feature | First choice | Second choice / fallback | Selection gate |
| --- | --- | --- | --- |
| Interactive solar shadows | Contact PCSS on mesh depth cascades with bounded triangle contact queries | Deterministic solar-disc BVH queries over triangles; lower sample budget for interactive use | Compare quality and GPU cost against a converged disc reference; PCF remains a low-cost fallback |
| GTX diffuse GI | Stokes contour integration of emissive mesh triangles, with triangle visibility and a bounded diffuse relay pass | Mesh-sampled surfel radiance cached in two probe cascades, with triangle visibility and depth moments for leakage control | Compare linear irradiance error, thin-wall leaks, motion stability, GPU time, memory, and scene-update cost |
| Path tracing | One deterministic integrator with software compute traversal on GTX | Same integrator with optional Vulkan ray queries on supported RTX devices; keep software fallback | Match hit/occlusion results and converged radiance across backends; profile before adding traversal optimizations |

Keep all five current shadow algorithms selectable during benchmarking. If six modes are wanted, add a budgeted triangle-disc mode with a separately measured early-exit/sampling policy only if it earns its place against `WideTreeRayQuery`; do not count a renamed duplicate. Stokes is an analytic lighting integral, not an analytic geometry proxy: the contour term only handles the geometric integral; sampled visibility, relay transport and any emitter grouping introduce approximation. Probe lookup has a bounded per-pixel budget, but updates scale with probes, rays and scene changes. Neither GI method requires a denoiser.

## Proposed repository layout

```text
Engine/
  SpatialAcceleration/                     # reuse WideBoundingTree; shared mesh traversal and updates
  GeometricRaster/
    DirectLighting/SolarShadowSequence.*   # existing selector, depth and visibility paths
    GlobalIllumination/
      StokesContourGiSequence.{h,cpp}
      SurfelCascadeGiSequence.{h,cpp}
      DeterministicPathTraceSequence.{h,cpp}
      DeterministicIntegrators.h            # audited sampling reference port
      VulkanWorldRenderSequence.*          # existing integration point
    Baking/GpuSdfBaker.*                    # unchanged; offline only
  Shaders/
    DirectLighting/                        # existing Slang passes
    GlobalIllumination/
      StokesContourGiCompute.slang
      SurfelCascadeGiCompute.slang
      WavefrontPathTraceCompute.slang
Exhibits/
  SolarShadowValidation.cpp                # extend existing comparisons
  MeshLightingValidation.cpp               # new shared fixture with deterministic visual proofs
Experimental/DeterministicPathTracer/      # existing reference; not a runtime dependency
```

## Implementation order

1. **Mesh visibility contract and validation.** Feed the same material-tagged triangles and transforms to raster, CPU reference, and GPU traversal. Update skinned vertices before lighting; refit or rebuild dynamic geometry and measure both costs. Keep rigid geometry reusable. Validate closest-hit and any-hit parity, normal bias, thin occluders and pose-specific hit buffers on a real car and skinned character. Compare contact PCSS and triangle-disc visibility with fixed camera/lighting and a converged reference. Do not substitute a generated capsule rig if a licensed skinned test mesh is missing.
2. **Stokes GTX path.** Extract emissive triangles, clip contours to the receiver hemisphere, evaluate the geometric form factor and estimate partial occlusion with mesh rays. Start with direct emissive transport; add one diffuse relay separately and compare each against a reference with matching bounce depth. Add a bounded cluster budget only after correctness is measured.
3. **Surfel GTX path.** Sample actual triangles with stable IDs; update moved surfaces and invalidate stale probe regions. Use triangle rays for transport and octahedral irradiance/depth probes for resolve. Compare against Stokes independently of solar shadows. Measure update time separately from resolve; report warm and cold cache results.
4. **Unified tracer.** Port and test deterministic quadrature against known sequences, then implement software BVH traversal and a minimal wavefront with fixed-capacity queues and overflow diagnostics. Share BSDF, emissive next-event estimation, MIS, sampling dimensions and accumulation across backends; add RTX BLAS/TLAS and ray-query dispatch only after querying the required Vulkan features. Reset accumulation when scene/camera state changes. No mandatory 64-bit atomics, compressed wide BVH, or denoiser for the first release. Determinism means fixed sample identities and repeatability per backend, not bitwise equality between GPU vendors.

**Acceptance:** build native C++ and Slang targets; generate raw visibility, linear GI and final-lit comparisons for static and animated scenes; report per-stage GPU timings, update/refit costs, peak memory and error on a named GTX and RTX device at the same resolution. Do not label a method “best” on a device without measuring it there. This is the review checkpoint before renderer implementation.

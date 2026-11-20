# Mesh lighting: two GTX GI modes and one GTX/RTX path tracer

**Decision for review:** Use the same indexed world triangles, rigid instance transforms, skinned vertices and material slots for visibility, shadows and emission. Do not restore runtime voxel SDFs, capsule rigs, or analytic stand-ins. Analytic *integration over mesh triangles* does not replace those triangles. Offline volume baking is a separate feature; leave it intact.

## Recovery and evidence

Starting tree: `SultanAladin/Frontier@daed305`. The old files are **historical, not build inputs**. [536cfe1](https://github.com/SultanAladin/Frontier/commit/536cfe1) contains `Exhibits/CleanShadowAndGiCandidates.h` and `Exhibits/CleanEmissiveShadowValidation.cpp`; [2d6f15e](https://github.com/SultanAladin/Frontier/commit/2d6f15e) contains their GI counterparts. [63db120](https://github.com/SultanAladin/Frontier/commit/63db120) removed the runtime GI/SDF subsystem. Copying the exhibits verbatim would restore dependencies on the deleted distance-field API.

| GTX GI shortlist | Historical normal GI RMSE | Proposed mesh-only visibility |
|---|---:|---|
| Stokes contour | 0.2238 | Integrate real emissive triangle contours; test visibility to emitter samples with the triangle tree; accumulate a second diffuse bounce from lit surface patches. |
| Surfel cascade | 0.2239 (probe lookup: 0.2269) | Attach area-weighted samples to triangles by index and barycentrics; inject radiance into directional probes. Interpolate irradiance with depth moments to limit wall leaks. |

These are 560×315 studio results, not GTX timings. The voxel candidate scored 0.2259 on normal GI. The tiny difference between the first two does not establish a universal quality winner. Benchmark probe update cost separately from lookup cost.

## Direct shadows

Keep the five values of `SolarShadowAlgorithm`: ContactPcss, PcssPlaneAware, ShadowRayMarch, PcfBilinear and WideTreeRayQuery. Trial **WideTreeRayQuery** for triangle-accurate silhouettes and **SurfelMeshShadow** as a sixth, approximate option: combine a short (initially 0.28 m) triangle contact query with projected coverage of triangle-derived blockers further away. Update moving blocker samples after skinning; use no character exclusion sphere. Compare both with PCSS before selecting a default. Historic capsule/surfel shadow RMSE was 0.2973 versus hybrid/SDF 0.2983 and old SDF 0.4170; those scores do not rank the new mesh-only versions.

## Proposed file layout (new unless marked existing)

```text
Engine/
  SpatialAcceleration/WideBoundingTree.{h,cpp}                 existing triangle traversal
  GeometricRaster/DirectLighting/SolarShadowSequence.{h,cpp}  extend existing mode switch
  GeometricRaster/GlobalIllumination/
    StokesContourGiSequence.{h,cpp}
    SurfelCascadeGiSequence.{h,cpp}
    DeterministicPathTraceSequence.{h,cpp}
  Shaders/DirectLighting/SurfelMeshShadow.slang
  Shaders/GlobalIllumination/
    StokesContourGiCompute.slang
    SurfelCascadeGiCompute.slang
    WavefrontPathTraceCompute.slang
Exhibits/WorldGiShadowPathTraceValidation.cpp
Experimental/DeterministicPathTracer/                         existing prototype
```

## Implementation and acceptance order

1. **Shared scene first.** Use an imported skinned character and ControlVehicle. After skinning, update triangle positions, normals, emissive areas and bounds before any visibility pass. Refit the software BVH on deformation, rebuild on topology change; rigid motion updates instance transforms. Keep triangle IDs stable for surfel attachment. Validate closest hits and occlusion against brute-force rays at rest and in motion.
2. **Shadow and GI passes.** Port the two GI estimators independently of the shadow selector. Start with a C++ reference, then Slang compute and Vulkan bindings. Dirty moving emitters and affected probes when geometry or materials change. Compare visibility, GI-only linear radiance and combined lighting separately; use each pose's own primary-hit buffer. Include thin limbs, disoccluded floor, moving headlights and a dark room behind a thin wall.
3. **One path integrator, two traversal implementations.** Port deterministic sampling from the [pinned Frontier-1 prototype](https://github.com/SultanAladin/Frontier-1/tree/d5bbb81/Experimental/DeterministicPathTracer) and compare with its `DeterministicIntegrators.h`. Share Sobol sample dimensions, material evaluation, emitter sampling, MIS and bounce termination. Start with GTX software BVH4 compute. Select inline RTX ray queries only when acceleration structures and ray query features are enabled; otherwise use the software pipeline without RT descriptors or extensions. Update skinned BLAS before TLAS and tracing. Invalidate accumulation on pose, camera, light or material changes.
4. **Promotion gate.** Use identical cameras, materials and fixed sample indices. Save isolated visibility versus a 128-sample disc reference, linear GI RMSE versus a BVH/NEE reference, temporal error on moving receivers, and repeated-run checksums. Compare traversal backends within a numeric tolerance, not bitwise across devices. Record GPU name, resolution, samples, update/shading milliseconds and peak memory on actual GTX and RTX hardware. Choose defaults from the quality/cost measurements rather than the historical still frame. No denoiser in the comparison.

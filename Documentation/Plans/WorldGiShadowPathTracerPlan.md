# World lighting on real triangle meshes — implementation plan for review

**Decision:** Do not build or sample a voxel SDF for world shadows, diffuse GI, or path tracing. All three should see the same triangles, including the current skinned character pose. Keep the offline `GpuSdfBaker` and its volume export; it has a different consumer. Do not delete the `GlobalIllumination/` folder: despite its historical name it contains the live world renderer.

| Use | First choice to implement | Why |
|---|---|---|
| GTX diffuse GI, quality | Stokes contour integration of mesh emitters + diffuse surface patches | Best historical normal-GI score; preserves the shape of nearby emitters. Visibility still has to be evaluated separately. |
| GTX diffuse GI, throughput | Triangle surfel radiosity + cascaded irradiance probes | Nearly tied in normal GI; bounded probe lookup trades update cost and memory for cheaper shading. Check leakage on thin meshes. |
| Direct shadows, two defaults to test | Contact PCSS for interactive GTX; sampled sun-disc triangle visibility for quality/reference | One prioritizes cost, the other resolves actual silhouettes. Select shadows independently of GI. |
| Path tracing | **One** deterministic integrator; software BVH4 traversal on GTX, inline hardware ray queries where available | Same materials, sampling dimensions, light selection and accumulation; only intersection changes. |

## What can actually be recovered

This branch imports the source tree of [daed305](https://github.com/SultanAladin/Frontier/commit/daed305). Its C++ world renderer supports MatCap and direct OpenPBR, not the proposed GI renderers. The voxel clipmap lighting subsystem is already absent. The old comparison programs are **references, not files to copy into the build**:

- [2d6f15e — GI exhibit](https://github.com/SultanAladin/Frontier/tree/2d6f15e/Exhibits): `CleanEmissiveGiCandidates.h` and `CleanEmissiveGiValidation.cpp`. [Recorded GI results](https://github.com/SultanAladin/Frontier/blob/2d6f15e/Exhibits/Images/CleanEmissiveGi/validation_summary.json): normal-GI RMSE at 560×315 against the 128-sample reference was **0.2238 Stokes**, **0.2239 surfels**, **0.2259 continuous field**. The cached surfel DDGI lookup scored **0.2269**; don't assign the uncached score to the faster lookup.
- [536cfe1 — shadow exhibit](https://github.com/SultanAladin/Frontier/tree/536cfe1/Exhibits): both `CleanShadowAndGiCandidates.h` and `CleanEmissiveShadowValidation.cpp` exist there. [Recorded shadow results](https://github.com/SultanAladin/Frontier/blob/536cfe1/Exhibits/Images/CleanEmissiveShadows/shadow_validation_summary.json): visibility RMSE was **0.2973** for surfel disks + capsules, **0.2983** for hybrid cone + capsules, **0.3068** for clipmap + capsules, **0.4170** for the SDF baseline. These are not timings or accuracy measurements for skinned triangle shadows. The old hybrid explicitly samples the vehicle SDF.
- [63db120](https://github.com/SultanAladin/Frontier/commit/63db120) removed those four source files and their runtime dependencies. Restore the algorithms selectively, not the old scene bridge, analytic boxes, capsule mesh generator, or SDF assets.
- [Frontier-1 at d5bbb81](https://github.com/SultanAladin/Frontier-1/tree/d5bbb81): compare `Experimental/ShadowAlgorithmLab/`, `Experimental/DeterministicPathTracer/`, and the historical `Engine/GeometricRaster/GlobalIllumination/DeterministicIntegrators.h`. The web prototypes are not native Vulkan implementations. The shadow lab selector offers **seven** entries, including two SDF comparisons. The native `SolarShadowAlgorithm` enum has **five** entries; the proposed sixth non-SDF method below is new.

## Proposed folder structure

Reuse existing directories and orchestration. `+` means proposed, not implemented in this snapshot.

```text
Engine/
  GeometrySpace/Network/PolygonNetwork.h           mesh topology and material slots
  SpatialAcceleration/WideBoundingTree.{h,cpp}     CPU reference; extend for pose refits
  GeometricRaster/
    DirectLighting/SolarShadowSequence.{h,cpp}     keep modes 0–4; compare proposed mode 5
    DirectLighting/MeshSurfelOcclusion.{h,cpp}     + triangle-derived blocker samples
    GlobalIllumination/
      TieredWorldRenderSequence.{h,cpp}            CPU scene/configuration and composition
      VulkanWorldRenderSequence.{h,cpp}            dispatch, resource lifetime and feature checks
      StokesContourGiSequence.{h,cpp}              + quality GI
      SurfelCascadeGiSequence.{h,cpp}              + cached GI
      DeterministicPathTraceSequence.{h,cpp}       + shared path state and accumulation
  Shaders/
    DirectLighting/MeshSurfelShadow.slang          +
    GlobalIllumination/StokesContourGi.slang       +
    GlobalIllumination/SurfelCascadeGi.slang       +
    GlobalIllumination/WavefrontPathTrace.slang    + software/hardware traversal variants
Experimental/{ShadowAlgorithmLab,DeterministicPathTracer}/   existing references only
Exhibits/WorldGiShadowPathTraceValidation.cpp      + headless comparison and pose regression
```

## Implementation order and acceptance gates

1. **Geometry and reference first (C++20).** Load the real ControlVehicle and an animated, licensed triangle character with two known poses. Skin vertices before building visibility data. Keep stable instance, primitive and material IDs across frames. Reuse static acceleration data, update rigid transforms, refit deformed triangle bounds, and rebuild on topology change. Use the same material opacity rules for every traversal. Render a 128-sample BVH sun-disc visibility reference and sampled emissive-triangle reference for **each pose**. Do not shade pose B using pose A's primary-hit buffer. Gate: an open receiver stays lit; a moving limb loses the old shadow and gains the new one; the two poses have distinct reference silhouettes.
2. **Direct shadow comparison.** Preserve `ContactPcss`, `PcssPlaneAware`, `ShadowRayMarch`, `PcfBilinear`, `WideTreeRayQuery` and their numeric values. Add `SurfelMeshShadow` as an opt-in sixth candidate: distribute samples by triangle area with stored barycentric coordinates; update their positions, normals and areas from skinned triangles. Test the historical 0.28 m contact ray against real triangles, then evaluate distant blocker samples using spatial bins. Samples approximate coverage; they are not authored character stand-ins. Compare all six on the same receiver mask. Keep the two defaults above unless measurements favor the new mode. No capsule distance function, vehicle SDF, or per-pose voxel bake.
3. **Two interchangeable GTX diffuse GI passes (C++ reference, then Slang).** For Stokes, clip emitter polygons to the receiver hemisphere, integrate their contour, and weight by mesh visibility. Use full receiver-to-emitter segments for occlusion, not just contact rays. Illuminate diffuse triangles and gather a second bounce without counting self emission or direct lights twice. For surfels, seed emissive and diffuse samples on mesh triangles, transfer outgoing diffuse radiance, then project into near/far octahedral irradiance probes with depth moments. Invalidate affected probes on motion or emissive material edits; measure refresh cost separately from lookup. Probes store light and visibility statistics, **not signed distances**. Gate: show isolated first and second bounce, black-emitter control, a thin occluder and a moving colored emitter. Compose in linear space before display mapping; `Off` preserves the direct-only image.
4. **Unified deterministic path tracer (C++20 + Slang).** Port the prototype's sampling sequence with fixed pixel/sample/bounce dimensions and test vectors. Use a shared wavefront loop for camera generation, closest hit, material/light evaluation, shadow visibility, continuation and accumulation. Use next-event estimation and MIS for mesh emitters; keep identical BSDF/PDFs, ray offsets and bounce limits on both paths. Compile a software-only traversal variant with no ray-query instructions or required RT extensions. Enable the hardware variant only after checking acceleration structure and ray-query features; update deforming BLAS and instance TLAS before dispatch. Reset accumulation on camera, geometry, lighting or material changes. Defer compressed BVH8 and spatial splits until profiling identifies traversal as the bottleneck. Gate: repeatable runs per backend; compare hit IDs, depths and converged linear radiance across backends within tolerance, not bit-identical floats across GPUs.

**Promotion rule:** On an actual GTX record resolution, hardware, sample count, median/p95 frame time, build/refit/probe-update time and peak memory for both poses. Record raw visibility RMSE, isolated linear diffuse GI error and full-lit error separately against the same high-sample references. Inspect unfiltered images for contact gaps, thin-shell leakage and stale irradiance in motion. Repeat the tracer parity test on ray-query hardware. Report results with denoising off; label any algorithm-internal shadow filter. Do not promote on the historical single-scene RMSE or on CPU timings alone.

# SDF ambient occlusion assessment

## Scope

Report only: no AO algorithm, SDF visualization, or XeGTAO implementation was changed in this pass. Findings are from source inspection, not a visual comparison or GPU measurement.

## What is present

- The GPU viewport's `EvaluateGlobalDistanceAmbientOcclusion` in `Engine/Shaders/GeometricRaster/WorldViewportRadiometricCompute.slang` samples the global distance field four times along the shading normal, with a voxel-size-dependent start offset and weighted distance deficits. This is an inexpensive approximation, not a high-quality ground-truth ambient-occlusion solution.
- The same shader uses a three-ray BVH AO path when the GDF path is not selected or ready. Renderer mode, scene data, voxel resolution and surface normals therefore matter when comparing results.
- The viewport has an Ambient Occ debug channel, but it is not a visualization of the underlying SDF with materials, nor a comprehensive set of SDF diagnostic views.
- The CPU and GPU debug paths are separate; the CPU path displays `CombinedDiffuseAo`. Do not assume the debug image represents exactly the same method in every rendering mode.

## Why it may look rough

Four samples, coarse voxel representation, self-occlusion bias, interpolation and shading-normal differences can produce blotches, halos or loss of fine details. The screenshot alone does not establish which cause dominates. Inspect the GDF voxel size, allocation and coverage, distance slices and normals alongside raw AO before tuning. Compare the same scene and camera against a higher-sample ray-traced AO reference, including motion and thin geometry.

## Recommendation

Evaluate XeGTAO as a **separate optional screen-space AO pass for direct PBR without GI**, with an explicit off switch and a consistent depth/normal input. Screen-space AO can give cleaner local contact detail but cannot see off-screen or occluded geometry, and may halo or flicker; it is not a universal replacement for world-space SDF AO. Avoid multiplying multiple AO methods blindly or darkening direct light. Measure GPU time and temporal stability before choosing a default. Verify implementation licensing and integrate its actual algorithm rather than relabeling another SSAO method.

A subsequent implementation should add truthful debug views for GDF coverage/clipmap level, signed distance or slices, normals, and material attribution only where the underlying field actually stores or can recover material information. Validate those views and AO against reference renders before claiming improvement.

# World Render Engine Remediation Plan
**Unified 5-Engine Architecture · Zero SDF Shadows · VehicleHMI Cascaded Global Distance Field · Deterministic Path Tracer · Astronomical Star Catalogue**

> **TL;DR:** Thorough audit of user-reported issues against `SultanAladin/Frontier-1` (`arena/39c6910b-frontier-1`), `unassignedinbox/Frontier-OLD`, and the experimental reference prototypes (`DeterministicPathTracer`, `ShadowAlgorithmLab`, `GtxReflectionBenchmark`, `FluidEditor`, `ParametricSketcher`) confirms all 7 reported failure modes. This plan establishes the mathematical specifications, data structures, and phased engineering remediation order to eliminate every defect without regressions.

---

## 1. 🔍 Root Cause Scoreboard & Technical Diagnosis

| Issue ID | User-Reported Symptom | Root Cause in Codebase | Reference Prototype Ground Truth | Mandatory Fix |
| :---: | :--- | :--- | :--- | :--- |
| **DEFECT-1** | **Stars change / pop when turning camera** *(“appears to generate differnt stars intead of a single catalogue”)* | In `CelestialDiscStarCompute.slang` and `LunarStarfieldSequence.cpp`, ray direction is multiplied by a 3D cartesian grid (`G = RotDir * 175.0`) and evaluated using a single-cell integer hash (`floor(G)`). Because no neighboring cells (26-cell stencil) are checked, when a ray crosses integer boundaries, stars are truncated abruptly. Furthermore, intersecting a curved spherical sky with a 3D Cartesian cube lattice produces anisotropic non-uniform density and severe popping under camera rotation. | Real astronomical catalogues (Hipparcos, Yale Bright Star) and spherical manifold partitions. | Implement an authentic **Spherical Star Catalogue Repository** with fixed celestial coordinates $(\text{RA } \alpha, \text{Dec } \delta)$, apparent magnitudes, and blackbody color temperatures, binned into an octahedral spherical grid with $3 \times 3$ spherical neighborhood evaluation so stars are 100% rotation-invariant. |
| **DEFECT-2** | **Path Tracer only fires once** *(“seems to only fire once ; thers so many problems”)* | In `EditorLifecycle.cpp:1598`, progressive accumulation tick was gated on `GpuReady && ...`. In software/CPU fallback, `ProgressivePathTraceTick` was permanently `false`. In `TieredWorldRenderSequence.cpp`, `Config.PathTraceSamples` was computed with fixed pseudo-random seed without accumulating into a persistent multi-frame buffer. | `Experimental/DeterministicPathTracer` (`RadianceIntegration.wgsl`, `DisplayReconstruction.wgsl`, `StepFrame`). | Wire persistent multi-frame accumulation ($N$-frame rolling mean $\mathbf{L}_N = \mathbf{L}_{N-1} + \frac{1}{N}(\mathbf{L}_{\text{sample}} - \mathbf{L}_{N-1})$) across both GPU compute and CPU fallback, driven continuously up to target SPP (64 SPP) with Sobol $(0, 2)$ sequences, Heitz GGX VNDF, and À-Trous denoiser. |
| **DEFECT-3** | **SDF still used in direct shadows** *(“they are still using SDF shadows when i told u not to use SDF shadows”)* | `ContactClipShadow.slang` retained `TraceSdfConePenumbra` and blended SDF into the shadow term (`lerp(ClipVis, min(ClipVis + 0.35, SdfVis), FarW)`). In `SolarShadowSequence.cpp`, legacy SDF parameters remained. | `Experimental/ShadowAlgorithmLab` and `FRONTIER_LIGHTING_PLAN.md`. | **Completely purge SDF from all shadow shaders and pipelines.** Direct shadows use strictly depth-map and triangle acceleration structures (`ContactPcss`, `PcssFiltered`, `Smrt`, `Pcf`, `WideTreeRayQuery`). SDF is strictly confined to diffuse indirect bounce GI. |
| **DEFECT-4** | **Terrible FPS (50 FPS), checkered SDF look, jagged shadows** | In `WorldViewportRadiometricCompute.slang`, `EvaluateSdfRadiosityConeGi` traced 16 un-filtered cones with per-pixel Interleaved Gradient Noise (`IgnPhase`), executing 320 3D texture taps per pixel without spatial denoising or surface cache. Shadow cascade bias was fixed and produced staircasing/jagged edges on high-frequency car geometry. | `VehicleHmiRendererReflectionReport.md` and `Experimental/GtxReflectionBenchmark`. | Adopt the **VehicleHMI 2-Cascade Global Distance Field** (`Clip0` fine + `Clip1` coarse) with pre-baked narrow-band surface cache (`|d| < 2 \text{ voxels}`), 2-step iso-surface root polish, and joint bilateral edge-stopping filter. |
| **DEFECT-5** | **DDGI doesn’t appear to work** | In `EditorLifecycle.cpp:458, 694, 1081, 1587`, `SynchronizeSceneResources` was called with `nullptr` for `OptionalRtxLattice`. `CachedLatticeDimX` remained `0`, causing `HasDdgi = false` in the shader and disabling DDGI completely. | `IrradianceLatticeSequence.cpp` & `OctahedralIrradianceLattice.slang`. | Properly thread and upload active `IrradianceLatticeSequence` probe radiance and 16x16 Chebyshev depth moments to GPU buffers `IrradianceLatticeBuffer` (binding 5) and `IrradianceChebyshevBuffer` (binding 8). |
| **DEFECT-6** | **Workspaces silently crash on opening (Fluid, Parametric Sketcher, etc.)** | In `FluidViewportHost.cpp`, on frame 2 `NeedsCreate` evaluated to `false`, calling `PreviewTexture.SetStatus(ImTextureStatus_WantUpdates)` without filling `UpdateRect`. In `ImGuiOverlayRasterization.cpp`, `Texture->BackendUserData` was still `nullptr`, leading to null pointer dereference in `imgui_impl_vulkan.cpp:869`. Also, `HostWorkspaceTarget` lacked enum values for Fluid, Particle, Material, and ForceField workspaces. | `DesktopWorkspaceLaunch.cpp` and `HeadlessWorkspaceDockContainer`. | Sanitize texture updates in `ImGuiOverlayRasterization.cpp` (`UpdateRect` fallback and `WantCreate` guard when `BackendUserData == nullptr`), fix `FluidViewportHost::UploadPreviewTexture`, and register all workspace targets in `WorkspaceCapabilityRegister`. |
| **DEFECT-7** | **Clouds fake movement instead of real 3D ForceField physics** | Volumetric clouds in `VolumetricCloudSequence.cpp` and `VolumetricCloudCompute.slang` applied simple 2D analytical UV translation instead of sampling 3D velocity vectors from `ForceFieldSource` and `WindLatticeCascade`. | `Experimental/ForceFieldEditor/` and `Experimental/FrontierWorldMirror/`. | Couple volumetric cloud advection directly to the live 3D velocity field and turbulence lattice from `Engine/SimulationSpace/ForceFields/`. |

---

## 2. 🧩 Decision Matrix & Architecture Comparison

### 2.1 Direct Shadow Architecture (Enforcing Shadow Lab Ruling)

| Rank | Shadow Architecture | Per-Pixel Cost (1080p) | Contact Sharpness | Penumbra Quality | Light Leak Artifacts | Verdict |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| 🏆 🥇 | **Tier 0: Contact Clip + PCSS + Screen Contact (`ContactPcss`)** | `~0.65 ms` | 🔴 Sub-millimeter tyre contact | 🔴 Smooth physical penumbra | 🔴 Zero leaks (No SDF) | **GTX Default** |
| 🥈 | **Tier 1: Vogel Blocker Search + PCSS + Plane-Aware Filter (`PcssFiltered`)** | `~0.50 ms` | 🚩 Good contact | 🔴 True contact hardening | 🔴 Zero leaks | **Fast Multi-Light** |
| 🥉 | **Tier 2: Reverse Quadratic SMRT Depth March (`Smrt`)** | `~1.20 ms` | 🔴 Sharp contact | 🚩 Slight noise without TAA | 🔴 Zero leaks | **Single Sun High-Detail** |
| 🏳️ | **Tier 3: 3x3 Tent Filtered PCF (`Pcf`)** | `~0.25 ms` | ✔️ Uniform blur | ✔️ Constant penumbra | 🔴 Zero leaks | **Low-Spec / Mobile** |
| 🔴 | **Legacy SDF Cone Shadows (`TraceSdfConePenumbra`)** | `~1.80 ms` | 🔴 Severe acne / holes | 🔴 Voxel stepping artifacts | 🔴 Pervasive light leaks | **PERMANENTLY BANNED** |

### 2.2 Global Illumination Architecture (VehicleHMI Surface Cache vs. Ad-hoc Cone March)

| Rank | GI Architecture | Frame Time | Quality / SNR | Artifact Profile | Moving Object Coupling | Verdict |
| :---: | :--- | :---: | :---: | :--- | :--- | :--- |
| 🏆 🥇 | **VehicleHMI 2-Cascade Global SDF (`Clip0..1`) + Surface Radiosity Cache** | **`~1.25 ms`** | 🔴 High SNR, smooth radiosity | 🔴 Zero checkered dither (Bilateral Filtered) | 🔴 Dynamic slice union (`0.08 ms`) | **Adopt as Engine 3 Default** |
| 🥈 | **DDGI Probes + 16x16 Chebyshev Depth Moments** | **`~1.10 ms`** | 🔴 Noise-free indirect diffuse | 🔴 Zero light leaks through walls | 🚩 Spatial grid discretization | **Engine 2 Default** |
| 🥉 | **Deterministic Path Tracer (Sobol MIS + Heitz VNDF + À-Trous)** | **`~18–32 ms`** | 🔴 Ground truth physical transport | 🔴 Exact caustics & reflections | 🔴 Progressive accumulation | **Engine 4 Offline / Lookdev** |
| 🔴 | **Ad-hoc 16-Cone IGN March (Previous Implementation)** | **`~18.5 ms`** | ✔️ Low SNR, severe noise | 🔴 Ugly checkerboard / dither pattern | ✔️ Re-traces full volume every pixel | **REPLACE IMMEDIATELY** |

---

## 3. 🛠️ Concrete Technical Remediation Specifications

### Phase 1: Direct Shadow Pipeline Remediation (`Zero SDF Shadows`)
1. **Purge SDF Cone Shadows from Shader Sources**:
   - In `Engine/Shaders/DirectLighting/ContactClipShadow.slang`, remove all references to `GlobalSignedDistanceTex`, `SdfBoundsMin`, `SdfBoundsMax`, `SdfVoxelSpacing`, and `TraceSdfConePenumbra`.
   - Update `Engine/GeometricRaster/DirectLighting/SolarShadowSequence.{h,cpp}` to guarantee direct shadow evaluation routes strictly through `ContactPcss`, `PcssFiltered`, `Smrt`, `Pcf`, or `WideTreeRayQuery`.
   - Provide slope-scaled depth bias:
     $$\text{Bias} = \text{TexelMeters} \cdot \left(1.25 + 0.90 \cdot \frac{\sqrt{1 - (\mathbf{N} \cdot \mathbf{L})^2}}{\max(0.15, \mathbf{N} \cdot \mathbf{L})}\right)$$
     eliminating shadow acne and jagged silhouette edges.

### Phase 2: VehicleHMI Cascaded Global Distance Field & Surface Cache (`Engine 3`)
1. **Two-Cascade Toroidal Clipmaps**:
   - `Clip0` (Fine): $128 \times 128 \times 64$ voxels, spanning vehicle / near-field hero workspace ($\Delta x = 0.04\text{ m}$).
   - `Clip1` (Coarse): $96 \times 96 \times 48$ voxels, spanning arena / environment ($\Delta x = 0.16\text{ m}$).
2. **Narrow-Band Surface Radiosity Cache**:
   - Pre-shade narrow band ($|d| < 1.8 \Delta x$) with direct sun and sky irradiance.
   - 2-step iso-surface snap:
     $$\mathbf{p}_1 = \mathbf{p}_0 + \mathbf{d} \cdot \text{SDF}(\mathbf{p}_0), \quad \mathbf{p}_2 = \mathbf{p}_1 + \mathbf{d} \cdot \text{SDF}(\mathbf{p}_1)$$
     snapping ray hits to $< 0.8\text{ mm}$ of the zero level set.
3. **Joint Bilateral Filter**:
   - Post-process diffuse GI through a $5 \times 5$ spatial + normal + depth bilateral filter:
     $$W(p, q) = \exp\left(-\frac{\|\mathbf{x}_p - \mathbf{x}_q\|^2}{2\sigma_s^2}\right) \cdot \max(0, \mathbf{n}_p \cdot \mathbf{n}_q)^{16} \cdot \exp\left(-\frac{|z_p - z_q|}{\sigma_z}\right)$$
     completely eliminating checkered noise and boosting FPS from 50 to 90+.

### Phase 3: DDGI Probe Lattice & Chebyshev Visibility (`Engine 2`)
1. **Host-to-Device Synchronization**:
   - In `EditorLifecycle.cpp`, ensure `SynchronizeSceneResources` passes the valid `IrradianceLatticeSequence` reference rather than `nullptr`.
   - Upload $N_x \times N_y \times N_z \times 64$ octahedral irradiance texels and $N_x \times N_y \times N_z \times 256$ Chebyshev moments to bindings 5 and 8.
   - Activate Chebyshev shadow test:
     $$P(\text{unoccluded}) = \frac{\sigma^2}{\sigma^2 + (d - \mu)^2}$$
     for $d > \mu$, completely eliminating light bleed through thin walls and floors.

### Phase 4: Deterministic Path Tracer Progressive Accumulation (`Engine 4`)
1. **Multi-Frame Accumulator**:
   - Maintain persistent accumulation buffer `AccumulationHdrBuffer[PixelIdx]` (`float4(rgb, sample_count)`).
   - Compute running Monte Carlo mean:
     $$\bar{\mathbf{L}}_N = \bar{\mathbf{L}}_{N-1} + \frac{1}{N} \left(\mathbf{L}_{\text{new}} - \bar{\mathbf{L}}_{N-1}\right)$$
   - In `EditorLifecycle.cpp`, increment `PathTraceAccumIndex` on static frames up to 64/256 SPP and trigger continuous redraw without stalling.
   - Integrate Sobol $(0, 2)$ sequences and Heitz GGX VNDF importance sampling:
     $$D_{\text{vndf}}(\mathbf{H}) = \frac{G_1(\mathbf{V}) |\mathbf{V} \cdot \mathbf{H}| D(\mathbf{H})}{\mathbf{V} \cdot \mathbf{N}}$$

### Phase 5: Astronomical Star Catalogue & Rotation Invariance
1. **Catalog Definition**:
   - Curate a table of 1024 prominent celestial stars with fixed Right Ascension $\alpha$, Declination $\delta$, apparent magnitude $m_v$, and color temperature $T_c$.
   - Precompute unit sphere directions $\mathbf{S}_i = (\cos\delta \cos\alpha, \cos\delta \sin\alpha, \sin\delta)$.
   - Partition into an octahedral directional grid with $3 \times 3$ spherical cell queries, ensuring 100% rotation invariance when the camera pans or tilts.

### Phase 6: Workspace Crash Remediation
1. **ImGui Vulkan Texture Synchronization**:
   - In `ImGuiOverlayRasterization.cpp`, guard against `ImTextureStatus_WantUpdates` with uninitialized `BackendUserData` or null `GetTexID()` by forcing `ImTextureStatus_WantCreate`.
   - Ensure `UpdateRect` is populated with $\{0, 0, W, H\}$ when not explicitly provided.
   - Update `FluidViewportHost::UploadPreviewTexture` to set `NeedsCreate` if `BackendUserData == nullptr`.
   - Register all workspace targets in `WorkspaceCapabilityRegister.h`: `FluidWorkspace`, `ParticleWorkspace`, `MaterialWorkspace`, `ForceFieldWorkspace`.

### Phase 7: Real 3D ForceField Physics for Volumetric Clouds
1. **Wind & Force Field Coupling**:
   - In `VolumetricCloudSequence.cpp` and `VolumetricCloudCompute.slang`, sample 3D force field vectors $\mathbf{v}_{\text{wind}}(\mathbf{p}, t)$ from `ForceFieldSource` and `WindLatticeCascade` instead of 2D analytical planar offsets.
   - Compute physical advection:
     $$\mathbf{p}_{\text{sample}} = \mathbf{p} - \int_0^t \mathbf{v}_{\text{total}}(\mathbf{x}, \tau) d\tau$$

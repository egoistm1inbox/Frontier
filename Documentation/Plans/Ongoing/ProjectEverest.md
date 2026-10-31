# Project Everest — Remaining UI Components & Dual-Tier Vulkan 1.3 GPU Porting Plan

## 1. Completed Foundation (Phase 1 — UI, RAII Outliner & Modular Inspectors)

- **Mainline Baseline & Sync Contract**: Merged onto `SultanAladin/Frontier` (`arena/11f31835-frontier`) with upstream sync and 3-branch audit pinned in `CLAUDE.md`.
- **Project Browser -> Project Everest Hand-Off**: `ProjectBrowserPanel::DiscoverProjects` discovers `Frontier/Projects/Project-Everest/ProjectEverest.projectspace` (`identity = "project-everest-v1"`), displays the `Project Everest` card in the library, and routes `Open in Frontier` into `EverestWorkspace` (`WindowsFrontier.cpp` + `ProjectEverestValidation.cpp`).
- **RAII `RecordEntry` Outliner + 3-Tier `InspectorCatalogue`**:
  - `RecordEntry` constructor issues a `RecordToken`, inserts into `RecordStore`, registers in `SceneDirectory` (Outliner), and registers a default inspector in `InspectorCatalogue`; `~RecordEntry()` automatically reverses all three (`FRONTIER_SHIPPING_PROFILE` compiles directory and inspector catalogue to zero symbols).
  - **Tier 1 (`EngineReusable`)**: 18 reusable built-in engine inspectors (`RenderSettings`, `AccelerationAndDistance`, `SurfaceCache`, `Sun`, `Atmosphere`, `Clouds`, `LocalCloud`, `HeightFog`, `AtmosphericFog`, `LocalVolumetricFog`, `Stars`, `Moons`, `LensFlare`, `Lightning`, `Wind`, `GeometryClusters`, `Diagnostics`, `TransformOnly`).
  - **Tier 2 (`ProjectCustom`)**: User-authored `ControlVehicle` 8-division inspector (`Overview`, `Chassis`, `Engine`, `Tyres` [4 corners x 5 sub-tabs], `Suspension`, `Lights`, `HMI`, `Mirrors`), breakable course props, and proving-grounds level records.
  - **Tier 3 (`DedicatedStudio`)**: `ParticleStudio`, `FractureStudio`, and `FluidPlumeStudio` workbenches with live centre-pane switching + Inspector pairing.
- **Reusable Host Integration**: Hosted on `PanelDockspace` (3-column `Outliner | Scene + LogStream | Inspector`), `LogStreamPanel` (from `egoistm1inbox/Frontier` `arena/9ce908bc-frontier`), and `ControlCentrePanel` (live theme/accent/typography switching).

---

## 2. Remaining UI Components to Port (Phase 2 — Interactive Viewport & Diegetic HMI Surfaces)

| Component | VehicleHMI Source Reference | Target Frontier Location | Scope & Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **1. Diegetic Cabin Centre Touch Tablet** | `FrontierEditor.js` HMI canvas (`#hmi-screen`: Media, Navigation, Tyre Thermal Map, ReSTIR Debug, Suspension Telemetry) | `Frontier/Projects/Project-Everest/Source/EverestCabinHmiSurface.{h,cpp}` | Off-screen `1024x640` RGBA8/RGBA16F ImGui/PixelSpace surface rendered both in the `HMI` inspector preview card and mapped onto the cabin dashboard quad with UV cursor hit-testing. |
| **2. Diegetic Hexagonal Driver Instrument Cluster** | `FrontierEditor.js` cockpit cluster (`RPM` arc, digital km/h, gear indicator, boost bar, tyre pressure warnings) | `Frontier/Projects/Project-Everest/Source/EverestDriverClusterSurface.{h,cpp}` | Off-screen `1280x480` vector instrument surface driven by `EverestVehicleParameters`, bound to the steering-column emissive quad and `HMI` inspector live thumbnail. |
| **3. Interactive 3D Viewport Gizmos & Picking** | `index.html` transform gizmo + click-to-select Outliner sync + `Chase / Free · F8` fly-cam | `Frontier/Engine/Interface/ViewportGizmoControls.{h,cpp}` | Ray-pick `RecordToken` selection in the `Scene` viewport, translate/rotate/scale handles synced with `EngineSpatialParameters`, and `WASD + RMB` free camera + `F8` chase toggle. |
| **4. Studio Dedicated 3D Preview Viewports** | `ParticleStudio` / `FractureStudio` / `FluidPlumeStudio` isolated orbit preview canvases | `Frontier/Projects/Project-Everest/Source/EverestStudioPreviewHost.{h,cpp}` | Turntable orbit camera per Studio (`Particle Studio` emitter cone, `Fracture Studio` exploded Voronoi/convex slabs with `PreviewSeparation`, `Fluid Studio` `160x160x96` slice volume). |
| **5. Photometric IES & Color-Grading Drawers** | Street-lamp / headlight IES polar lobe widget + ACES tonemapper / bloom / vignette curve card | `Frontier/Engine/Interface/PhotometricControls.{h,cpp}` | Polar candela distribution plot for `Lights` & `Sun`, plus `RenderSettings` post-process exposure/tonemapper curve widget. |
| **6. `.scene` TOML Round-Trip Serialization** | `Proving Grounds.scene` save/load + snapshot diffing + undo/redo command stack | `Frontier/Projects/Project-Everest/Source/EverestSceneCodec.{h,cpp}` | Deterministic TOML encode/decode of all 30 `RecordEntry` parameter blocks into `Content/Scenes/ProvingGrounds.scene` with `Ctrl+Z` / `Ctrl+Y` transaction history. |

---

## 3. Dual-Tier Vulkan 1.3 GPU Porting Plan (Phase 3 — Synthesized from 3-Branch Audit)

### 3.1 Audited Reference Branches — Proven Keepers vs Rejected Regressions

| Branch | Adopted Subsystems (Verified Working) | Do-Not-Repeat Regressions (Verified Failing) |
| :--- | :--- | :--- |
| **`streamlinkinbox/Frontier`** `arena/08e7de48-frontier` (`7bc60250`) | Slang -> SPIR-V pipeline (`vkGetBufferDeviceAddress`, scalar layout); **GPU fence-published emissive facet prefix-sum CDF** (`O(log N)` binary search: `25.6M -> 466` facet evaluations/pixel, `0.000000` RMSE delta, `16/16` CTests). | Do **not** replace luminance ReSTIR target with RGB-norm target without specular lobe compensation (`GlassPrism` regressed `+7.99%` RMSE on holdouts). |
| **`streamlinkinbox/Frontier`** `arena/5ec53579-frontier` (`56059b39`) | **`PathReplayRayQuery`** (`VK_KHR_ray_query` + 16-bin SAH-2 ordered BVH), **SVGF** spatial-temporal filter, **thin-glass dielectric split + MIS**, **multi-stratum PDF** (`p_bsdf + p_light + p_guide`), **blocked-visibility NEE guard**, and **0.0001 ReSTIR target floor**. | Do **not** lower ReSTIR target floor below `0.0001` (`+1.5%` RMSE), do **not** add unconditional spatial address guard (`+3.0%` RMSE), and do **not** enable `Fresh4` refresh (`+2.2%` RMSE). |
| **`egoistm1inbox/Frontier`** `arena/9ce908bc-frontier` (`4be51f2e`) | **Dual-tier RTX + GTX architecture**, **3-cascade toroidal clipmap SDF** (`8^3` bricks, `12,288` pool), **6-face oriented Surface Cache atlas** (`4096x4096 RGBA16F`), **Hillaire Sky LUT + volumetric clouds/froxel fog**, **128-tri cluster culling**, **3D Hex8 Neo-Hookean FEM tyres**, **160x160x96 pyro smoke**, and **convex impact fracture**. | Replaced all banned identifier names (`SKILL-Naming.md`) and replaced prototype layout deviations with the 1:1 VehicleHMI `EverestWorkspace` + 3-tier `InspectorCatalogue`. |

### 3.2 Dual-Tier Illumination Execution Sequence

1. **Runtime Capability Selection (`IlluminationCapabilityProbe`)**:
   - **RTX Tier (`ArchitectureTierIndex == 0`)**: Activated when `VkPhysicalDeviceAccelerationStructureFeaturesKHR::accelerationStructure` and `VkPhysicalDeviceRayQueryFeaturesKHR::rayQuery` are supported. Executes `PathReplayRayQuery` (`1–4` GI bounces, `1–4` reflection bounces, `M=1..8` RIS candidates, `0.0001` target floor, fence-published emissive facet CDF, blocked-visibility NEE, thin-glass MIS, and SVGF).
   - **GTX / Lower-End Fallback Tier (`ArchitectureTierIndex == 1`)**: Activated automatically on GTX 10/16-series, integrated GPUs, or whenever toggled live in `Render settings`. Executes **3-cascade toroidal clipmap SDF cone-traced diffuse GI & soft shadows** + **6-face Surface Cache irradiance injection** + **compute 16-bin SAH-2 ordered BVH specular reflections** (zero RT-core dependency) feeding the shared SVGF denoiser.
2. **Shared Simulation & Atmosphere Stages**:
   - **Geometry**: 128-triangle spatial clusters -> compute frustum + Hi-Z occlusion culling -> `vkCmdDrawIndexedIndirectCount`.
   - **Atmosphere**: Hillaire transmittance/multi-scatter/sky-view LUTs + dual-layer raymarched cloudscape + `160x90x64` froxel volumetric fog + `16x16x4` 64-bit clustered lighting bitmask (`firstTrailingBit`).
   - **Physics & Destruction**: Vehicle chassis + 3D Hex8 Neo-Hookean FEM tyres -> toroidal `160x160x96` smoke & buoyant flame lattice + depth-sorted GPU ribbon/spark particles + dynamic convex-cut fracture updating both TLAS/SAH-2 BVH and dynamic SDF brick pool.

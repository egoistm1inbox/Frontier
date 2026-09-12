# Celestial port status

This is the implementation status for the Project Zero port of the reference at
`SultanAladin/Frontier-` (`Diagnostics/CelestialPanel.html`). The reference is a WebGL
panel; it is not copied into the renderer. Project Zero is the one dedicated open
celestial material-test scene, and its Editor mode is the native home of the ported
controls.

## Ported and wired into Project Zero

| Reference feature | Project Zero seam |
| --- | --- |
| One open material-test scene | `RayTracingSolver::ConstructCelestialTestScene`, `ProjectZeroCelestial.gltf`, `GameExecution` |
| Sun, time of day, moon ephemeris | `CelestialSequence`, `CelestialSolver`, `SkyRecords.slang` |
| Rayleigh/Mie/ozone atmosphere and twilight | `AtmosphereModel`, `SkyConstantRecord`, `SkyRecords.slang` |
| Stars and Milky Way gating | `StarCatalogueIndex`, binding 23, `PostRecords.slang` |
| Moon atlas, phase and linked Luna | `MoonConstantRecord`, binding 22, `EngineContent/CelestialTextures` |
| Height, aerial and local volumetric fog | `VolumetricMedia`, the unified sky/cloud record at binding 21 |
| Cloud layer, local cloud and wind advection | `VolumetricMedia`, `WindField`, `SkyRecords.slang` |
| Rain, drizzle, hail, snow and sleet | `Precipitation`, cloud-fed world-space particle system |
| Rainbow and Alexander's band | `AtmosphericOptics`, `PostRecords.slang` |
| Lens flare, ghosts, halo and streaks | `AtmosphericOptics`, `PostRecords.slang` |
| God rays from cloud transmittance | unified cloud march and post integration |
| Fidelity tiers and Auto | `CelestialTier` as the single tier translation |
| Render path and GI controls | `ControlCentreSettings::RenderPath`, persisted `render_path`, strict Swapchain branch |
| Bounded visible sun disc | shared `SkySunDirect.w` / `kSunDiscGain`, CPU `VisibilityRaster` and `SkyRecords.slang` |
| Editor integration | `CelestialSequence`, `GameExecution`, outliner sheets and volume markers |

The per-frame path is shared: `CelestialSequence::Tick` updates the authoritative state,
`ApplyTo` feeds the CPU Visibility Raster, and `PackSkyRecord`, `PackMoonRecord` and
`PackPostRecord` feed the GPU records. The strict Visibility Raster shadow resolve
borrows the same binding 21–25 records/table as ReSTIR, so GI-off cannot silently lose
clouds, sky, moon or stars through a second weather state. When Visibility Raster is
selected in the live Project Zero loop, `VisibilityRaster::Render` is the producer and
`SwapchainExchange::UploadSoftwareRasterFrame` copies that RGBA8 frame to the storage
image; no GPU visibility or ReSTIR dispatch substitutes for it.

## Current proof boundary

`Scratchpad/ProjectZeroShowcase.cpp` loads the dedicated scene through SceneCodec and
uses the same material records, sequence, packed weather state and CPU Visibility
Raster equations as the application. Its filenames identify scene, path, GI state and
tier. In a no-GPU sandbox it emits only explicitly labelled Visibility Raster / GI-off
CPU images; it does not mislabel those images as ReSTIR captures. ReSTIR shader/record
parity is structurally gated, while GPU/ReSTIR image captures require a Vulkan-capable
runner. No painted or disconnected proof image is acceptable.

## Checks

From the repository root:

```sh
bash Scratchpad/CheckCelestialScene.sh
bash Scratchpad/CheckProofFidelity.sh
bash Scratchpad/CheckPrecipitation.sh
bash Scratchpad/CheckPostKernel.sh
bash Scratchpad/CheckSkyKernel.sh
bash Scratchpad/CheckCelestialTiers.sh
bash Scratchpad/CheckStarCatalogue.sh
```

# Celestial port status

This is the implementation status for the `Project-Zero` port of the reference at
`SultanAladin/Frontier-` (`Diagnostics/CelestialPanel.html`). The reference is a WebGL
panel; it is not copied into the renderer. Its simulation is split between the CPU
sequence, the visibility raster, and the ReSTIR kernel so both render paths receive the
same weather state.

## Ported and wired into Project Zero

| Reference feature | Project Zero seam |
| --- | --- |
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
| Project Zero/editor integration | `CelestialSequence`, `GameExecution`, outliner sheets and volume markers |

The per-frame path is deliberately shared: `CelestialSequence::Tick` updates the
authoritative state, `ApplyTo` feeds the CPU visibility raster, and the three packers
(`PackSkyRecord`, `PackMoonRecord`, `PackPostRecord`) feed the GPU path. Visibility
toggles and inspector edits therefore affect both paths instead of only changing the
preview UI.

## What is intentionally still separate

These are not silently missing from the port:

* The reference's **Height Field** is an external scene/geometry entity. Project Zero
  currently uses its generated outdoor ground and glTF scene geometry; a procedural
  height-field scene is the next terrain task.
* **Post Process** exposure and tone mapping are owned by the renderer's exposure and
  colour-transfer pipeline rather than by `CelestialSequence`; the celestial post
  record contains the reference's star/rainbow/flare effects.
* The reference's **Cine Camera** rig and its G/R/S gizmo workflow remain deferred.
* The reference's CSS bespoke widget catalogue is represented by the existing native
  inspector sheet types. A pixel-identical HTML panel is not a rendering requirement.

## Checks

From the repository root:

```sh
bash Scratchpad/CheckCelestialScene.sh
bash Scratchpad/CheckPrecipitation.sh
bash Scratchpad/CheckPostKernel.sh
bash Scratchpad/CheckSkyKernel.sh
bash Scratchpad/CheckCelestialTiers.sh
bash Scratchpad/CheckStarCatalogue.sh
```

The checks compile the CPU proofs and assert the production wiring; generated PNG
captures are intentionally not build inputs.

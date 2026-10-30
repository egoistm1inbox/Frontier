# Project-Drive — Unified VehicleHMI & Frontier Engine Showcase

`Project-Drive` produces a single unified executable (`Binaries/ProjectDrive`) in this project folder reusing the
native Frontier UI (`ControlCentrePanel`, `ThemeStructure`, `PanelDockspace`, `SceneDirectoryPanel` Outliner,
`SceneInspectorPanel`, and `LogStreamPanel`) over the `VehicleHMI` proving-grounds simulation.

## Highlights

- **Play / Pause / Simulate Header**: Top transport bar controlling runtime driving, paused live scene editing, and
  editor-camera simulation, alongside `GTX / RTX / Blinn` tier selection and 7 camera viewpoints.
- **25 Live `RecordEntry` Components Across 8 Groups**: Every component constructs its 1:1 `VehicleHMI` controls or
  `SourceImages/General UI` statistical infographic inside `#if defined(FRONTIER_EDITOR_PROFILE)` in its constructor,
  compiling to `0` editor UI symbols in `FRONTIER_SHIPPING_PROFILE=1`.
- **Full Stage A–I Engine Coupling**: Jolt `v5.6.0` (240 Hz) + GRIT propulsion/tyres, dual-tier `GTX` (SDF ReSTIR GI +
  BVH RT) & `RTX` (RayQuery) + low-res `BlinnRenderer`, glass-isolated Nanite `ClusterHierarchy`, 3D `VehicleCabinHmi`
  with dark-cabin exposure guard, circular & rectangular `PortalMechanics` + planar mirror, `5.13x` `PlumeFluid` pyro,
  coupled Rain/Snow/Hail `SkyPrecipitation`, single-mesh `SnowSurface` mound (`CC == 1`), smooth 2.5D `ShallowWater`
  puddles (`0` foam, `0` splash), `SparkParticles`, Griffith `SolidFracture`, and `48 B` `StateReplication`.

## Build & Run

```bash
cmake -S Frontier/Projects/Project-Drive -B .local/build/project-drive -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build .local/build/project-drive -j 4
Frontier/Projects/Project-Drive/Binaries/ProjectDrive --verify-and-capture Frontier/Projects/Project-Drive/Captures
Frontier/Projects/Project-Drive/Binaries/ProjectDrive --serve 5174
```

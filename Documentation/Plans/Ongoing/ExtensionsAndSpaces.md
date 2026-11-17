# Extensions and Spaces

Approved 2026-11-04 (20th request). The goals: a modular clean-up where every workspace (Frontier, SolidArc, Texture
Workspace, games) reuses one bridge instead of its own copy, plus the Space concept, Jolt physics, a networking scaffold
and the remaining Particle and Force Field work.

## Decisions

| Question            | Answer                                                                                  |
|---------------------|-----------------------------------------------------------------------------------------|
| Extension location  | `Frontier/Extensions/<Name>/` beside `Frontier/Engine/`, files named `<Name>Extension`   |
| Space concept       | Each simulation domain owns its world, `<Domain>Space`; the level is `WorldSpace`        |
| Jolt                | Set up now: pinned JoltPhysics, Linux and Windows, scene colliders and dynamic bodies    |
| Clean-up depth      | Bridges, the shared gizmo and the texture bridge now; one Vulkan device/host later       |
| Networking          | Scaffold now (`NetworkingSpace`, loopback transport); `EOSExtension`/`EpicAdapter` later |
| Particle space file | `.particlespace` TOML beside the level, linked from the Particles record                 |

## Duplicates found

| Duplicate                    | Copies                                              | Outcome                                 |
|------------------------------|-----------------------------------------------------|-----------------------------------------|
| Image to UI texture          | Twice in `WindowsFrontier.cpp`                      | `Interface/ViewportTexture`             |
| Gizmo                        | `PlacementGizmo` and `SolidArcGizmo`                | `Interface/GizmoSpace`, one look        |
| Bridges inside a project     | `EverestSceneViewport`, `EverestParticleViewport`   | `Rendering/` and `Particle/` extensions |
| Vulkan device                | `DeviceExchange` and `SolidArcDevice`               | Later: one device                       |
| Window and swapchain host    | `WindowsApplication` and `SolidArcApplication`      | Later: one host                         |

## Steps

| Step | Work                                                                                              | Status |
|------|---------------------------------------------------------------------------------------------------|--------|
| 1    | CLAUDE.md rule, folder map, naming skill                                                          | ✔️     |
| 2    | `ParticleScene` → `ParticleSpace`, `SceneWorld` → `WorldSpace`                                    | ✔️     |
| 3    | `Particle/ParticleExtension`, `Rendering/RenderingExtension`, `SceneViewportPresentation.h`       | ✔️     |
| 4    | `Interface/ViewportTexture`, `GizmoSpace`, `GizmoRasterization`; `PlacementGizmo` on GizmoSpace   | ✔️     |
| 5    | `.particlespace` codec; the Particles record links its file; the editor loads and saves it       | ✔️     |
| 6    | `Networking/` scaffold and its validation                                                         | ✔️     |
| 7    | `Physics/`: pinned Jolt, `JoltExtension`, `PhysicsSpace`, `PhysicsExtension`, Simulate, capture   | ✔️     |
| 8    | Remaining Particle and Force Field points (plan `ForceFieldParticleIntegration.md` §7)            | ✔️     |
| 9    | Builds, tests, captures, Windows package, Tracker                                                 | ✔️     |

## Later

- One Vulkan device (`DeviceExchange`) and one window host (`WindowsApplication`) for SolidArc as well.
- `InterfaceSpace` for game UI and `SimulationSpace` for fluid, gas and water simulations.
- `EOSExtension` or `EpicAdapter` from `Frontier/Projects/Project-Networking/Source` behind `NetworkingExtension`.

# Particle editor (C++): evidence

The approved Particle editor prototype (`Experimental/ParticleEditor`) is now in the C++ Frontier editor. It runs the
eos engine (`549c477`), ported to C++, Vulkan and Slang without changing its behaviour. The editor opens from a
**Particles** record in the Everest workspace: *Construct* (Ctrl+A) → *Solver · GPU Particles*, then the Inspector's
*Particle Editor* button. It fills the workspace as a modal window, and *Close Editor* returns to the scene.

| Part | Content |
|---|---|
| Outliner | Environment: the **Force Field** (master), **Wind** (its guest), the forces, **Lightning**; the effects |
| Viewport | The engine's image, HUD, probe, minimap, and the Force Field editor's visualization over the particles |
| Inspector | Force Field, Wind, force, Lightning and effect pages, in the Render settings look |
| Library | The same 52 presets in 14 groups, as a sheet with search and group chips |
| Log Stream | Engine start, presets added, forces added, strikes, overlay changes |

The field overlay is the Force Field editor's `ForceFieldVisualization` in its Camera projection, given a sampler of
the particle scene: Flow reads the GPU wind lattice back (trilinear), Accelerate evaluates `fieldAccel`, Damp
evaluates the taxonomy. The eos taxonomy's 12 force types (4 flows, 6 accelerations such as the attractor and the
repulsor, a drag volume and a current) are added from the Force Field page and drawn with their reach.

## Results

| Check | Program | Result |
|---|---|---|
| Library, packing, lightning, taxonomy against the prototype | `ParticleLibraryValidation` (ctest) | 🟢 343 of 343 |
| Slang port by the pinned slangc; stored archives | `StoreShaderArchives.py --verify` | 🟢 30 archives, 0 failures |
| The engine on Vulkan: 15 original scenes | `ParticleSimulationCapture` | 🟢 15 of 15 in the existing baseline; targeted `SharedForceField` GPU case also passed on SwiftShader (73 refreshes) |
| The editor in the workspace: 8 captures, open and close | `ParticleEditorCapture` | 🟢 8 of 8, 107 s |

`ParticleLibraryValidation` compares with `Results/PackingReference.toml`, written from the prototype's own modules by
`Code/ExportPackingReference.mjs`:

| Part | Agreement |
|---|---|
| Effect uniforms (`fillSys`), 52 presets | 3,008 of 3,008 exact |
| Light fibre uniforms | 640 of 640 exact |
| Light fibre paths | 7,150 of 7,168 exact; the rest within 2.2e-14 m |
| Refresh constants, wind components, acceleration fields, lensing | exact |
| Force taxonomy, 72 readings × 14 fields | worst error 0 |
| Lightning bolts | exact |

`ParticleEditorCapture` asserts:

- the record's editor opens through `InspectorRuntime`, the library decodes (52 presets), and the default scene holds 4
  effects and 4 fields;
- every capture has the engine's image with no failure. The opening capture has more than 500 particles alive and
  the wind lattice read back;
- `add-force:attract` adds the attractor, the library sheet opens, and `add:tornado` adds the preset and closes the
  sheet;
- closing (`CloseActiveEditor`, what *Close Editor* calls) clears the active editor; the workspace runs on.

## Editor captures

1920 × 1080, SwiftShader. The viewport image is 1124 × 744.

| Image | Shows | Alive | Refresh |
|---|---|---|---|
| `EditorOpening.jpg` | Default scene at 2.5 s; Force Field page; overlay (flow speed, arrows, names) | 2,267 | 208 ms |
| `EditorEffectPage.jpg` | The Sparks effect's page: census tiles, Release section | 2,280 | 199 ms |
| `EditorWindPage.jpg` | The Wind guest's page: probe, flow components, lattice and display sections | 2,288 | 198 ms |
| `EditorAttractorPage.jpg` | An attractor added at the centre; the overlay in Accelerate (m/s²) | 2,303 | 193 ms |
| `EditorLightningPage.jpg` | A strike: the bolt, its sparks, the Lightning page | 2,312 | 189 ms |
| `EditorPresetLibrary.jpg` | The library sheet: 52 presets in 14 groups | 2,313 | 192 ms |
| `EditorTornadoPreset.jpg` | Tornado debris from the library; its wind link turns the Tornado on | 2,639 | 216 ms |
| `EditorWindArrows.jpg` | The lattice arrows rastered on the GPU, the overlay off | 2,709 | 270 ms |

![Particle editor](Images/EditorOpening.jpg)

![Attractor in Accelerate](Images/EditorAttractorPage.jpg)

![Preset library](Images/EditorPresetLibrary.jpg)

## Everest main Scene Viewport overlay

These captures are also kept in this folder so the particle evidence view includes the C++ main-viewport integration. The
level's default Particles record drives a transparent particle image over the live Everest scene; camera pose, field of view
and render extent follow the Scene Viewport. The full implementation and validation details are in
`Exhibits/SceneViewport/README.md`.

![Everest Scene Viewport with particles alpha-composited over the scene](Images/EverestParticleOverlay.png)

[Normals inspection](Images/EverestParticleOverlay-Normals.png) · [Direct shading](Images/EverestParticleOverlay-Direct.png)

## Engine captures

960 × 540, SwiftShader, 1/60 s refreshes; figures from `Results/EngineCaptures.tsv`. The prototype's default scene
showed 2,241 of 6,248 alive at the same time.

| Image | Presets | Alive / capacity | Mean refresh |
|---|---|---|---|
| `EngineDefaultScene.jpg` | sparks, leaves, atoms, chemicals | 2,270 / 6,248 | 158 ms |
| `EngineWindArrows.jpg` | default, lattice arrows | 2,273 / 6,248 | 228 ms |
| `EngineTornadoDebris.jpg` | tornado | 360 / 1,500 | 48 ms |
| `EngineFireworks.jpg` | fireworks | 180 / 3,000 | 71 ms |
| `EngineFireAndSmoke.jpg` | fire, smoke | 520 / 4,000 | 94 ms |
| `EngineLightStreaks.jpg` | light streaks (fibres) | — | 153 ms |
| `EngineWeaveTrails.jpg` | weave trails (fibres) | — | 153 ms |
| `EngineDerezCube.jpg` | derez cube | 91 / 1,536 | 143 ms |
| `EngineDissolveButterflies.jpg` | dissolve into butterflies | 1,536 / 1,536 | 90 ms |
| `EngineCoinStack.jpg` | coin stack | 40 / 64 | 27 ms |
| `EngineBlackHole.jpg` | black hole (lensing) | 1,003 / 3,000 | 80 ms |
| `EngineFireflies.jpg` | fireflies | 36 / 256 | 30 ms |
| `EngineBubbles.jpg` | bubbles | 75 / 400 | 33 ms |
| `EngineMagneticLines.jpg` | magnetic lines, particles | 549 / 1,200 | 85 ms |
| `EngineLightning.jpg` | a strike and its sparks | 160 / 2,000 | 54 ms |

## Reproduce

| Item | Value |
|---|---|
| Platform | Linux x64 sandbox, Debug host build in `_ClaudeScratch/build/UI` |
| GPU | SwiftShader Vulkan (CPU); the times above are SwiftShader's, not a GPU's |
| Pages | Rasterized from the ImGui draw lists by `Exhibits/ControlCentre/Code/CpuRasterization` |

```bash
export VK_ICD_FILENAMES="$PWD/ExternalPackages/VulkanCompute/SwiftShader/vk_swiftshader_icd.json"
export LD_LIBRARY_PATH="$PWD/ExternalPackages/VulkanCompute/SwiftShader${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
_ClaudeScratch/build/UI/ParticleLibraryValidation "$PWD"
_ClaudeScratch/build/UI/ParticleSimulationCapture . _ClaudeScratch/build/UI/ShaderArchives/ParticleSimulation \
  <OutputFolder> [Capture]
_ClaudeScratch/build/UI/ParticleEditorCapture EngineContent Projects/Everest _ClaudeScratch/build/UI/ShaderArchives \
  <OutputFolder> [Capture]
```

`Capture` picks one image by name (`DefaultScene`, `EditorOpening` …); the editor capture still walks every step.

## Code

| File | Role |
|---|---|
| `Code/ExportPackingReference.mjs` | The prototype's packing, taxonomy and lightning written as TOML |
| `Code/ParticleLibraryValidation.cpp` | The C++ port against that reference |
| `Code/ParticleSimulationCapture.cpp` | The engine alone: one scene per capture |
| `Code/ParticleEditorCapture.cpp` | The editor in the Everest workspace |
| `Code/ParticleSpaceValidation.cpp` | The `.particlespace` file, shared native field lattice, and box volumes |
| `Code/FluidSpaceValidation.cpp` | Fluid source queue, native-field handoff, and Fluid-to-Particle burst routing |
| `../FluidEditor/Code/FluidSimulationGpuValidation.cpp` | Slang/Vulkan Fluid execution, readback, pressure projection, preview, and burst validation |

## ParticleSpace in the level and shared native ForceField (2026-11-09)

- **File:** a Particles record keeps its ParticleSpace in `<level>.<record>.particlespace` beside the level.
  - It is TOML in the preset library's own spelling, with the level key `space_file`.
  - The editor creates the file from the library's opening space the first time it opens the record.
  - The title shows the file and `UNSAVED`. Close and the level's Ctrl+S write it back.
  - The record's Inspector shows the space's figures; the six unused sliders are gone.
- **Native level field:** Wind page › Level. With **Follow the level's Force Field** enabled, Everest snapshots the level's
  native `ForceFieldSpace` from its ForceField, Wind, and ForceSource records and samples it at all 6,912 texel centres of
  Particle's 24 × 12 × 24 lattice. The configured anchor is transformed from level Z-up coordinates into ForceField axes;
  Particle acceleration fields remain local, while Particle-local flow generators are bypassed to avoid double-counting
  environmental wind and authored sources. If no sampler is available or Follow is off, the standalone Particle lattice remains.
  The default Particle sidecar enables Follow.
- **Fluid access:** `InspectorRuntime::AcquireLevelFieldSampler()` provides the same native sampler snapshot to any level tool.
  `FluidSimulationSequence::Advance` samples the enabled native field at each Fluid cell centre into a GPU-readable 3D input;
  Slang compute then applies it alongside queued sources, advection, diffusion, buoyancy, and pressure projection. Fluid state
  evolves on Vulkan compute, not in a CPU fallback. `FluidSpace` holds authored inputs and the last explicit readback;
  `FluidSimulationSequence::Readback` is a separate telemetry step. The existing Fluid editor UI remains a shell and is not
  wired to this native simulation path.
- **Burst routing:** Fluid's `CollectBurstTriggers` events continue through `ParticleTriggerRouter::DispatchFluidBurst`, which
  deposits bursts into the same `ParticleSpace`; `FluidSpaceValidation` exercises this route.
- **Box volumes:** the drag volume (type 4) and the current (type 5) run in the Particle acceleration program. The prototype
  parity check covers eos's entries and checks the box volumes separately.
- **Tornado funnels:** authored tornado ForceSource records raise condensation funnels in the GPU clouds.
- **Default level:** `Projects/Everest/Content/Levels/Default.levelspace` has an enabled **Particles** record; its shipped
  `Default.Particle_Effects.particlespace` is the library's four opening presets. The same space is visible as a transparent
  layer in Everest's main Scene Viewport, using the live camera and actual scene-image extent (see
  `Exhibits/SceneViewport/README.md#transparent-main-viewport-particle-layer`).
- **Tests:** `ParticleSpaceValidation` passes 161/161 assertions, including coordinate conversion, per-cell centre sampling,
  flow de-duplication, disabled-sampler fallback, and preservation of Particle acceleration fields. `FluidSpaceValidation`
  checks source queuing and Fluid-to-Particle routing; `FluidSimulationGpuValidation` runs the native Slang solver. The selected
  Particle/Fluid/ForceField and stored-shader archive CTests pass 5/5.
- **GPU captures:** `ParticleSimulationCapture`'s `SharedForceField` scene passed on `SwiftShader Device (Subzero)` (73
  refreshes; native lattice readback verified and duplicate local flows absent). `FluidSimulationGpuValidation` also passed on
  SwiftShader, including pressure projection and preview. SwiftShader is software Vulkan; physical hardware GPU execution has
  not been run.

## Limits

- Captured offscreen on Linux with SwiftShader. The Windows build is cross-compiled and was not run on Windows.
- The shared native ForceField now supplies full 3D velocities across Particle's lattice. The legacy standalone Particle flow
  generators remain available when the level sampler is unavailable or Follow is off; the UI shell for the Fluid workspace is
  not yet wired to a live Fluid simulation.
- The prototype's thunder sound is not ported: the engine has no audio output yet.

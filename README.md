# Frontier

Frontier is a Vulkan/C++ renderer with Project Zero as its integration scene.

## Project Zero celestial workflow

Project Zero intentionally loads **one** dedicated open scene:
`Projects/Project-Zero/Content/Scenes/ProjectZeroCelestial.gltf`. When the transport
file is absent, `RayTracingSolver` generates it from the authored celestial material
test scene and the production SceneCodec imports it. It is not a Cornell Box,
Showroom, Sponza or a scene-selector workflow. The scene contains deliberately placed
primitives, colour/material tests and an emissive response panel against a real open
sky; the ground is only the horizon/shadow substrate.

The native celestial sequence drives sun, moon, stars, atmosphere, clouds, fog, wind,
precipitation, rainbow, lens flare and god-ray inputs. Its outliner and inspectors are
fed into Frontier Editor mode, including the time/date controls and weather entities.

### Independent render controls

The Editor Control Centre exposes:

- **Render Path**: Visibility Raster / Software Raster or ReSTIR;
- **Global Illumination**: on/off for ReSTIR, without changing the path selection;
- quality/tier, AA and the existing shadow controls.

Visibility Raster is the deterministic software/quick-look path, not a low-end quality
tier. ReSTIR receives the same packed sky/weather record (including GI-off frames), and
the strict runtime branch never silently substitutes ReSTIR for an unavailable
Visibility Raster frame. The spare `SkySunDirect.w` lane carries the shared bounded
sun-disc gain; the CPU and shader disc/aureole equations therefore use one controlled,
angularly bounded source rather than frame-filling glare.

The HUD includes scene, path, GI state, quality tier, resolution and frame timing.
Settings persist in `[render].render_path` in `Slate.config.toml` when the file is
present.

## Proofs and correctness gates

The sandbox may not have Vulkan drivers. CPU proof generation is therefore explicit
about its path: `Scratchpad/ProjectZeroShowcase.cpp` loads the same generated
`ProjectZeroCelestial` scene through SceneCodec, runs the live `CelestialSequence`,
uses `ApplyTo` and the production `VisibilityRaster`, and writes filenames containing
scene, path, GI state and quality tier. It never labels those CPU images as ReSTIR.
The packed-record and shader gates cover the corresponding ReSTIR celestial inputs;
GPU/ReSTIR captures must be generated on a GPU rather than painted or substituted.

Useful correctness gates (they do not require a GPU) are:

```sh
bash Scratchpad/CheckCelestialScene.sh
bash Scratchpad/CheckProofFidelity.sh
bash Scratchpad/CheckPrecipitation.sh
bash Scratchpad/CheckPostKernel.sh
bash Scratchpad/CheckSkyKernel.sh
bash Scratchpad/CheckCelestialTiers.sh
bash Scratchpad/CheckStarCatalogue.sh
```

Generated captures belong in `Diagnostics/` and are not source inputs.

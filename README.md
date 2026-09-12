# Frontier

Frontier is a Vulkan/C++ renderer with Project Zero as its integration scene.

## Project Zero celestial world

The reference celestial demo is implemented natively rather than embedded as HTML.
Run the project with the generated outdoor scene to see the sky and weather path:

```sh
# after initializing the submodules and configuring the toolchain
./Project-Zero --scene outdoor --silent
```

The implementation is assembled in
`Projects/Project-Zero/Source/CelestialSequence.*`. It drives the sun, moon atlas,
atmosphere, stars, clouds, fog, wind, precipitation, rainbow, lens flare and cloud
god rays. CPU visibility and GPU ReSTIR use the same packed state:

- binding 21: sky, atmosphere and volumetric weather;
- binding 22: textured moon roster;
- binding 23: binned bright-star catalogue;
- binding 24: stars, rainbow and lens-flare post effects.

The inspector/outliner is fed by the same sequence, so hiding or editing an entity
changes the simulation and both render paths. `References/Backlog/CelestialPortStatus.md`
records the parity matrix and the deliberately deferred terrain/cinematic-camera work.

Useful correctness gates (they do not require a GPU) are:

```sh
bash Scratchpad/CheckCelestialScene.sh
bash Scratchpad/CheckPrecipitation.sh
bash Scratchpad/CheckPostKernel.sh
bash Scratchpad/CheckSkyKernel.sh
bash Scratchpad/CheckCelestialTiers.sh
bash Scratchpad/CheckStarCatalogue.sh
```

Generated captures belong in `Diagnostics/` and are not required to build the
renderer.

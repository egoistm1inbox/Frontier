# Experimental Remastered

Unified **Sun Inspector + Fluid Editor** studio interface across Frontier's interactive simulation tools. For shared component/layout patterns, see the [Experimental Remastered UI Component Guidelines](./UI_COMPONENT_GUIDELINES.md); `CLAUDE.md` points contributors there and uses Vehicle Lab as the Outliner / Stage / Inspector reference.

- **Particle Studio (`Experimental Remastered/ParticleEditor/`)** — Remastered Particle workspace wrapping the unmodified `eos` WebGPU particle, light fibre, molecular physics, lightning, and 3D force-field engine (`ForceFieldVisualization` + `ParticleFieldReadback` + `SoftwarePreviewEngine`).
- **Fluid Editor (`Experimental/Fluid/`)** — Gas-only WebGL2/WebGPU authoring prototype with plume, blast/detonation, wildfire and dust tornado presets, TOML samples, and a non-node workspace. Source provenance and limits are documented in `Experimental/Fluid/README.md`.
- **FractureEditor (`Experimental Remastered/FractureEditor/`)** — Redesigned **Fracture Studio** wrapping all 6 `eb353da2` fracture engines (`EngineeringBakedFracture`, `FastRuntimeFracture`, `ConvexPartitioning` Griffith/LEFM/Voronoi/Dendritic, `Piece SDF`, `RigidBodyDynamics`, and `CelestialAtmosphereModel` Sun/Atmosphere/Clouds) under the identical Sun + Fluid studio system.
- **PhotometricEditor (`Experimental Remastered/PhotometricEditor/`)** — Unified **Photometric & Light Studio** combining Project Zero's 7 physical light inspectors (`pointlight`, `spotlight`, `ieslight`, `arealight`, `tubelight`, `ledlight`, `ledstrip`), real LM-63 Type-C `.ies` candela profiles & custom import/export, Environment Lights (`envdome`, `sun`, `moon`, `stars`, `lensflare`, `atmosphere`, `post`), and a Three.js WebGL2 ACES / False-Colour Isolux 3D calibration stage.
- **ForceFieldEditor (`Experimental Remastered/ForceFieldEditor/`)** — Unified **Force Field & Wind Studio** supporting direct scene placement of **Wind Generators** and 16 bounded forcefield classes, strict finite spatial influence envelopes (`Sphere`, `Column`, `Box` + falloff), anti-clutter **RK2 Flow Lines** + **sparse Vector Field** visualization, and a **3D Field Stage** alongside `Map 2D` (no Oblique view).
- **Vehicle Lab (`Experimental Remastered/AssetInspector/`)** — A standalone vehicle studio with a prominent WebGL viewport showing the actual Vehicle HMI `ControlVehicle` body, tyre and rim FCT1 assets; a component Outliner, categorized Inspector, engine/turbo/Pacejka curves with selectable interpolation, ten exterior debug channels, addable vehicle components, and a throttle/brake drive-simulation preview.

## Studio screenshots

These are genuine captures of the five Remastered studio apps in this branch, included as visual version references.

### Particle Studio

![Particle Studio — Remastered UI](./screenshots/particle.png)

### Fracture Studio

![Fracture Studio — Remastered UI](./screenshots/fracture.png)

### Photometric & Light Studio

![Photometric & Light Studio — Remastered UI](./screenshots/photometric.png)

### Force Field & Wind Studio

![Force Field & Wind Studio — Remastered UI](./screenshots/force-field.png)

### Vehicle Lab

![Vehicle Lab — Remastered UI](./screenshots/vehicle-lab.png)

## Quick start

```bash
# Particle Studio (port 8083)
python3 "Experimental Remastered/ParticleEditor/Serve.py"

# Fluid Editor (port 5173)
cd Experimental/Fluid
npm ci
npm run dev -- --host 0.0.0.0

# Fracture Studio (port 8082)
python3 "Experimental Remastered/FractureEditor/Serve.py"

# Photometric & Light Studio (port 8084)
python3 "Experimental Remastered/PhotometricEditor/Serve.py"

# Force Field & Wind Studio (port 8085)
python3 "Experimental Remastered/ForceFieldEditor/Serve.py"

# Vehicle Lab (port 8086)
python3 "Experimental Remastered/AssetInspector/Serve.py"
```

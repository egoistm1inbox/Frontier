# Experimental

Contains interactive WebGPU experimental tools and demos:

- **VehicleProvingGrounds** — WebGPU + Jolt Physics VehicleHMI demo (`?level=everest` / `?level=dday`), extracted from `https://github.com/c7egoist/Frontier/tree/arena%2Fd3dbcc83-frontier` (commit `6e8005cf`) and extended with the **D-Day Assault (`dday`)** combat level.
- **ParticleEditor** — Frontier Particle Studio pairing the unmodified **eos** WebGPU compute particle, light fibre, molecular physics, lightning, and 3D force-field engine with the unified **Sun Inspector + Fluid Editor** studio UI (plus an interactive software 3D preview fallback for non-WebGPU browsers).
- **ForceFieldVisualization** — Shared 2D + 3D scalar/vector field heatmap, slice arrows, tracers, and lattice minimap module used by the editors.

## Quick start

### Vehicle Proving Grounds (port 8080)
```bash
cd Experimental/VehicleProvingGrounds
npm install
npm run serve
```
Then open `http://localhost:8080/` (or `http://localhost:8080/?level=dday`).

### Particle Studio (port 8081)
```bash
python3 Experimental/ParticleEditor/Serve.py
```
Then open `http://localhost:8081/Experimental/ParticleEditor/`.

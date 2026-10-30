# 🧩 VehicleHMI Proving Grounds, FrontierPlumeFluid, 3-Mode Tyre Continuum & Weather Effects

Retained validation and benchmark record for Milestone 3 on `arena/9ce908bc-frontier`.

## 🏁 Component Summary

| Domain | Engine / Project Substrate | Verified Mechanism | Status |
|---|---|---|---|
| **3D Fluid Smoke & Fire** | `FrontierPlumeFluid` + `PlumeFluid{Transport,March}.slang` | Toroidal MAC face-flux + RB-SOR pressure, Clamped MacCormack thermo, aperiodic $SO(3)$ + flow-warped detail, reaction-sheet blackbody fire | ✔️ `PASS` |
| **Tyre Continuum** | `FrontierTyreMechanics` + `TyreVisualBridge` | Analytical `Spring`, `160`-particle `XPBD` (`TyreCarcassProjection`), and `128`-cell `Hex8` Neo-Hookean FEM (`TyreCarcassSolid`) + integrated reaction/patch/bulge queries | ✔️ `PASS` |
| **Precipitation & Grip** | `WeatherEffects` + `PrecipitationOptics.slang` | `Rain`, `Snow`, and `Hail` terminal-velocity hydrometeors, slope-gated surface snow cover, and monotonic road-grip scaling | ✔️ `PASS` |
| **VehicleHMI Scene** | `Frontier/Projects/Project-Drive/Source/VehicleHmiScene.{h,cpp}` | `ControlVehicle{Body,Rim,Tyre}.facet` (`8,460` base facets -> `34,048` scene tris), Hangar, Tunnel, Tower, Materials Garden, Streetlamps, Signals, Jolt `5.6.0` cones & ramp | ✔️ `PASS` |

## 🔍 Quantitative Benchmarks (`Release` & `SANITIZE=1`)

| Metric | Legacy HTML Reference | Engine Upgraded | Measured Improvement |
|---|---:|---:|---:|
| **Checkerboard Divergence Residual ($L_2$)** | `4.6609 s^-1` | `0.3143 s^-1` | **`14.83x` lower** |
| **Repeating `32^3` Tile Autocorrelation** | `1.0000` (exact repeat) | `0.2641` (aperiodic) | **`3.79x` breakup** |
| **Flame Reaction-Sheet Edge Sharpness** | `0.0060` | `0.0143` | **`2.38x` sharper** |
| **Mid-Plume Smoke Transmittance** | `0.0025` (opaque brick) | `0.0071`–`0.42` (layered wisps) | **Cured saturation** |
| **`Hex8` Tyre Reaction / Patch / Bulge (`220 kPa`)** | Prescribed spring only | `47.4 kN` / `0.0460 m^2` / `34.87 mm` | **Full 3D continuum telemetry** |
| **Hydrometeor Speed (`Snow` / `Rain` / `Hail`)** | Rain streaks only | `1.78` / `10.82` / `19.05 m/s` | **3 physical species + grip (`1.00 -> 0.48`)** |

## 📝 Reproduction Commands

```bash
bash Exhibits/VehicleHmiShowcase/Run.sh --render-showcase build/showcase-ppm
SANITIZE=1 bash Exhibits/VehicleHmiShowcase/Run.sh
PYTHON=python3 BUILD="$PWD/build/tyre-proj-dev" bash Exhibits/VehiclePhysics/RunTyreProjectionDevice.sh
PYTHON=python3 BUILD="$PWD/build/tyre-solid-dev" bash Exhibits/VehiclePhysics/RunTyreSolidDevice.sh
bash Exhibits/VehiclePhysics/RunProjectDriveValidation.sh
BUILD="$PWD/build/pd-jolt-val" bash Exhibits/VehiclePhysics/RunProjectDriveJoltValidation.sh
```

# 🧩 Engine Systems End-to-End Physical & Architectural Verification

Retained quantitative verification across Frontier's fluid/plume physics, calibrated `.tyrx` tyre thermodynamics,
thermochemical fuels & additives, forced induction (`Turbocharger` + `Supercharger`), `BEV` & Hybrid propulsion,
cloud-gated weather particles & 3D wind/force-field coupling, reusable Engine Networking (`FP1` + GRIT 48-byte P2P),
multi-threaded `TaskGraphSchedule`, `CompiledFrameGraphPlan` + `DedicatedRenderThreadExtension`, and `AudioFoundation`.

Run command:

```bash
Exhibits/EngineSystemsValidation/RunEngineSystemsValidation.sh
SANITIZE=1 Exhibits/EngineSystemsValidation/RunEngineSystemsValidation.sh
```

---

## 1. Plume & Smoke Fluid Physics (`FrontierPlumeFluid`)

| Invariant / Physical Test | Measured Result | Status |
|---|---|---|
| Smoke mass conservation (`24` steps) | `6.14897 -> 6.15641` (`100.12%`), `min = 0.000000` | ✅ PASS |
| Archimedean buoyancy (`300 K` vs `1150 K`) | `cold_z = 1.570 m`, `hot_z = 2.332 m` (`+0.763 m`) | ✅ PASS |
| MacCormack vs semi-Lagrangian sharpness | `mac_peak = 32.7499` vs `leg_peak = 27.8303` (`+17.7%`) | ✅ PASS |
| Staggered MAC pressure projection | `html_div = 4.6609 -> upgr_div = 0.3143` (`14.83x`) | ✅ PASS |
| Toroidal window shift (`7.0 m` translation) | `3` lossless two-cell shifts, finite field | ✅ PASS |

---

## 2. Diagnosis & Fix of Premature `VehicleHMI` Tyre Ignition + `.tyrx` Compounds

### Root-Cause Diagnosis
Under a stationary RWD line-lock burnout (`~115 kW` frictional slip per rear tyre, `Airspeed = 0 m/s`), the legacy demo
configuration injected `0.75 * 115 kW = 86.25 kW` into a thin `1800 J/K` tread thermal node (`+47.9 K/s` heating rate)
while cooling against `Airspeed = 0 m/s` (`12 W/K` static convection, ignoring spinning peripheral tread speed
$|\omega R| \approx 41.5\,\text{m/s}$), `28 W/K` carcass coupling, zero $\varepsilon \sigma A T^4$ radiation, zero
endothermic rubber pyrolysis cooling, disabled hot-grip fade, and a low `623.15 K` / `4.0 s` trigger — igniting tyres
in **`14.0 s`** (`~11 s` at peak torque).

### Physical Fix (`CalibratedTyreThermodynamics` & `VehicleRigidBodyAssembly`)
1. **Rotational Boundary-Layer Forced Convection**: Uses $v_{\text{eff}} = \sqrt{v_c^2 + (0.82\,\omega R)^2}$,
   matching GRIT `.tyrx` `42–55 W/(m^2*K)` convection (`~260–420 W/K` during stationary wheelspin).
2. **Jaeger Contact-Patch Flash Pyrolysis + Endothermic Vaporization**: Contact-patch flash temperature triggers dense
   white burnout smoke at **`2.9 s`** while latent vaporization (`320 kJ/kg`), $\varepsilon \sigma A T^4$ radiation,
   and thermal grip fade stabilize bulk belt temperature below open auto-ignition (`683.15 K` Arrhenius gate).
3. **5 GRIT `.tyrx` Presets + NASA Horne Wet Aquaplaning**: `Gt3SlickDry` (`3.0 mm`), `StreetSport`, `DriftCompound`,
   `DragRadialSoft`, and `RallyGravelSoft` (`11.5 mm` lugs: `0.860` wet grip vs `0.103` slick hydroplaning at `38 m/s`
   in `4.5 mm` standing water).
4. **Live Coupled Jolt `5.6.0` Verification**: `3,600` physics steps (`15.0 s` full-throttle powerslide) reach
   `460.8 K` (`187.7 °C`) rear tread temperature with **`0` premature tyre fires**, while preserving `0.000e+00` error
   on legacy `TyreOracle.mjs` parity tests.

---

## 3. Fuels, Synergistic Blends, Additives, Forced Induction & EV / Hybrid Topologies

- **Thermochemical Fuels (`PropulsionThermochemistry`)**: `PumpGasoline93`, `RaceGasolineC16` (`118 AKI`), `EthanolE85`,
  `PureMethanolM100`, `NitromethaneTopFuel` (`LHV = 11.3 MJ/kg`, `AFR = 1.70`, **`6.647 MJ/kg_air` = `2.21x` Gas93!**),
  `HydrogenGas`, `SustainableSyntheticEFuel`, plus custom game-authored fuels (`ValidateCustomFuelChemistry`).
  Non-linear synergistic alcohol octane blending yields `E50 AKI = 97.62` (above `96.50` linear average).
- **Additives**: Wet vs Dry `N2O` (`36.35 wt%` oxygen; Wet `100 hp` shot delivers **`1.66x` torque** at safe
  $\lambda = 0.92$, whereas uncompensated Dry `N2O` leans to $\lambda = 1.33$), `50/50` Water-Methanol injection
  (`-35.1 K` latent intake charge cooling, restoring knock factor `0.521 -> 1.000`), and MMT/Toluene octane boosters.
- **Forced Induction & Lubrication (`HybridElectricPropulsion`)**:
  - `TwinScrew` Supercharger produces **`0.98 bar` instant low-RPM boost at `2200 RPM`** while deducting **`70.2 Nm`**
    parasitic crank belt drag.
  - Exhaust-enthalpy `Turbocharger` enforces GRIT's octane-gated wastegate (`1.20 bar` on `93 AKI` -> **`1.60 bar`
    automatically unlocked on `C16` `118 AKI`**) and detects compressor surge upon WOT throttle snap-close.
  - GRIT `5W-40` Walther oil viscosity (`90.0 cSt @ 40 °C -> 14.0 cSt @ 100 °C`, `537 kPa` regulated gallery) and
    `85–95 °C` wax-thermostat coolant loop.
- **BEV & Hybrids**: `PureBatteryElectric` (`QuadMotorTorqueVectoring`, `9840 Nm` launch torque, `895 Nm` yaw vectoring
  differential, `1661 Nm` / `157.8 kW` regenerative braking recharging SoC `0.74967 -> 0.74984`) and
  `ThroughTheRoadAxleSplitHybrid` (`4396 Nm` front e-axle + `5662 Nm` rear ICE+P2 axle, plus `0.000000 kg/s` fuel in
  pure-EV stealth mode).

---

## 4. Cloud-Gated Budgeted Weather Particles & Shared 3D Wind / Force-Field

- **`WindField`**: `32x32x16` (`192 KB` L2-resident) 3D atmospheric boundary-layer log-profile + 3D curl
  turbulence + force primitives (`VortexColumnUpdraft` `vy = 10.30 m/s`, `VehicleSlipstreamWake`, `RadialImpulseWave`,
  `DirectionalGustCorridor`) synchronously driving `CloudField`, `FogMedium`, `PlumeFluid`, Vehicle Aero, and
  falling weather/debris particles.
- **`CloudGatedWeatherSpawner`**: Evaluates wind-slanted `CloudDensity` optical depth across a `32x32` overhead grid and
  builds an $O(1)$ **Vose Alias Table**:
  - Clear sky (`Coverage = 0.0`): **`0 / 2048` active particles** (`0%` wasted particle budget).
  - Patchy cumulus (`Coverage = 0.54`, `640 / 1024` cloudy columns): **`1440 / 2048` active particles**, with
    **`100.00%` (`1.0000`) spawned strictly beneath verified cloud columns** and `26,095` ballistic hail ground bounces.

---

## 5. Engine Networking, TaskGraph, FrameGraph, RenderThread & Audio Foundation

- **`FrontierNetworking` (`StateReplication`)**:
  - Byte-exact `'FP1'` (`0x315046`) big-endian wire compatibility with `Project-Networking` / upstream `Slate`.
  - `SequenceAckTracker` (`AckSequence + 32-bit AckBitfield`), per-peer baseline delta compression (`40` objects:
    `2107 B` keyframe -> **`183 B` delta = `91.3%` bandwidth reduction**), `HermitePoseInterpolator`, and
    `ClientPredictionReconciler` deterministic input replay.
  - GRIT P2P **`48-byte` `CompactVehicleWireRecord`** (`sizeof == 48`: `50` cars @ `30 Hz` = **`72.0 KB/s`**) with
    `32-bit` smallest-three quaternion (`0.0000 deg` identity error, `< 0.08 deg` arbitrary orientation error).
- **`FrontierThreading` (`TaskGraphExtension`)**: Multi-threaded Kahn topological wavefront scheduler over `WorkerPool`
  with deterministic cycle rejection (`cycle_rejected = 1`) and zero-leak dynamic dependency unlocking (verified under
  `ASan + LSan + UBSan`).
- **`FrontierFrameGraphRuntime` (`FrameGraphExecution`)**: Unifies `SubmissionOrder`, `BarrierDerivation` (`12` barriers
  across `5` units), `TransientTargetAtlas` (**`22.2%` VRAM saved** via lifetime-disjoint aliasing), parallel command
  recording, and `DedicatedRenderThreadExtension` (`12` frames over lock-free `SnapshotExchange`).
- **`FrontierAudioFoundation` (`AudioFoundation.h`)**: Headless spatial acoustic emitter/listener substrate (`Doppler`
  approaching `1.127x` vs receding `0.899x`, stereo pan `+0.51`, air HF rolloff, occlusion LP filter, and lock-free
  `SnapshotExchange<AcousticFrameSnapshot>` bridge).

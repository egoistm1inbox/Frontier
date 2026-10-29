# 🧩 Engine Jolt Physics (`v5.6.0`) & Decoupled `Project-Drive` Validation

**TL;DR**: Reusable Jolt Physics (`RigidBodySolver`, `VehiclePhysicsThread`) and coupled vehicle assembly
(`VehicleRigidBodyAssembly`, `VehicleSpawnSolver`, `DriverInputIntegrator`, `ChaseCameraProjection`) are integrated in
`Frontier/Engine/Physics/`, while course authoring, `ControlVehicle` deployment, possession (`F8`), respawn (`R`), and
the v3 `ProjectDrive.dll` code image live in `Frontier/Projects/Project-Drive/`. All **`364/364`** assertions pass in
both **Release** and **`SANITIZE=1` (ASan + UBSan + LSan)** alongside full non-regression of
`RunProjectDriveValidation.sh`.

## ⭐ Measured Verification Summary

| Phase | Scope | Key Metrics | Status |
|---|---|---|---|
| `PHASE_1`  | `RigidBodySolver` (`Jolt 5.6.0`)    | Free-fall `15.0746 m`, field `1.9004 m`, `wz=1.0000` | 🟢 PASS |
| `PHASE_2`  | `VehicleSpawnSolver` + Input/Cam    | `18` spawns, `min_clear=0.02000 m`, FOV `69.00 deg`  | 🟢 PASS |
| `PHASE_3A` | Jolt Rest Equilibrium (`2.0 s`)     | `4/4` contacts, drift `0.00016 m`, `12.28 kN` load   | 🟢 PASS |
| `PHASE_3B` | WOT Accel, Shift, Aero & ABS Stop   | `28.88 m/s` (`gear=4`), aero `1159.8 N`, ABS `0 m/s` | 🟢 PASS |
| `PHASE_3C` | Ramp Jump, Kerb, Cones & Respawn    | Crest `2.472 m` -> `4/4` (`up_z=1.000`), cones `1->0`| 🟢 PASS |
| `PHASE_4A` | `240 Hz` `VehiclePhysicsThread`     | `44` async steps, `F8` cuts throttle & holds camera  | 🟢 PASS |
| `PHASE_4B` | `ProjectDrive.dll` v3 `dlopen`/Host | ABI v3 negotiated, `Frontier --headless` exit `0`    | 🟢 PASS |

## 🔍 Reproduction

```bash
bash Automation/BuildJolt.sh
bash Exhibits/VehiclePhysics/RunProjectDriveJoltValidation.sh
SANITIZE=1 bash Exhibits/VehiclePhysics/RunProjectDriveJoltValidation.sh
bash Exhibits/VehiclePhysics/RunProjectDriveValidation.sh
```

Retained logs:
- `Exhibits/VehiclePhysics/Results/ProjectDriveJolt-release.txt`
- `Exhibits/VehiclePhysics/Results/ProjectDriveJolt-sanitized.txt`

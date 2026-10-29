# 🧩 Project-Drive — Decoupled Automotive Proving Ground

`Project-Drive` is a decoupled Frontier project (`ProjectDrive.frontier`) opened by `Frontier` alongside `Project-Zero`,
`Project-ProvingGrounds`, `Project-Networking`, and `Project-VehicleHmiDemo`. Reusable Jolt Physics and vehicle
dynamics stay in `Frontier/Engine/Physics/`; `Project-Drive` owns only the proving-ground course, `ControlVehicle`
deployment scenario, possession/camera flow, and v3 `CodeInterchange` code image.

## ⭐ Ownership Boundary

- **Shared Jolt substrate (`Frontier/Engine/Physics/`)**:
  `RigidBodySolver` (Jolt `5.6.0`), `VehiclePhysicsThread`, `PhysicsChannel<T>`, `FrontierTyreContinuum`.
- **Shared vehicle dynamics (`Frontier/Engine/Physics/ProjectDrive/`)**:
  `VehicleSolver`, `Drivetrain`, `Aerodynamics`, `PacejkaMagicFormula`, `TyreSlipDynamics`, `VehicleGeometry`,
  `VehicleSpawnSolver`, `DriverInputIntegrator`, `ChaseCameraProjection`, `VehicleRigidBodyAssembly`,
  `TyreVisualBridge`.
- **Project-owned scenario (`Frontier/Projects/Project-Drive/`)**:
  `ProjectDrive.frontier`, `Source/DriveCourse.h`, `Source/DriveSimulation.{h,cpp}`,
  `Source/ProjectDriveInterchange.cpp`.

## ✔️ Controls & Session Flow

- `W` / `S`: Throttle / brake. `A` / `D`: Steering. `Space`: Rear mechanical handbrake.
- `R` (while possessed): Respawns `ControlVehicle` onto `[DeploymentPoint]` via `ResolveVehicleSpawn` and restores the
  8 dynamic Jolt slalom cones.
- `F8`: Ejects into the free-flight camera and cuts driving input immediately while Jolt + `VehicleSolver` continue
  stepping; pressing `F8` again repossesses the vehicle and snaps `ChaseCameraProjection`.

## 🔍 Build & Validation

```bash
bash Automation/BuildJolt.sh
bash Exhibits/VehiclePhysics/RunProjectDriveJoltValidation.sh
SANITIZE=1 bash Exhibits/VehiclePhysics/RunProjectDriveJoltValidation.sh
```

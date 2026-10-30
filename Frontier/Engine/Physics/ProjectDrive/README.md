# 🧩 Project Drive Vehicle Physics & Jolt Assembly (`Frontier/Engine/Physics/`)

This directory holds the reusable `Frontier::Vehicle` dynamics and Jolt rigid-body assembly imported from
`SultanAladin/Frontier-` (`3f14808a` core + `f2cfc57d` Jolt/spawn/camera/input runtime), separated cleanly from the
project-specific course and scenario in `Frontier/Projects/Project-Drive/`.

## ⭐ CMake Targets & Layers

- **`FrontierProjectDrivePhysics`** (self-contained C++17):
  Unmodified hook-based core (`VehicleSolver`, `Drivetrain`, `Aerodynamics`, `PacejkaMagicFormula`, `TyreSlipDynamics`,
  `VehicleGeometry`) + `TyreVisualBridge` (`FrontierTyreMechanics`). Preprocesses byte-for-byte identically to
  `Experimental/ProjectDriveReference/`.
- **`FrontierRigidBodyPhysics`** (`Frontier/Engine/Physics/`, Jolt Physics `5.6.0` via `Automation/BuildJolt.sh`):
  `RigidBodySolver.{h,cpp}` (opaque PIMPL `JoltWorld` with `Plane`, `Box`, `Sphere`, `Capsule`, `Cylinder`,
  `ConvexHull`, +Z-up `Heightfield`, forces/torques, `CastRay`/`CastSphere`/`CastCylinder`, distance-spring
  constraints) + `VehiclePhysicsThread.{h,cpp}` (`PhysicsChannel<T>` + fixed-rate worker).
- **`FrontierProjectDriveJolt`** (`FrontierProjectDrivePhysics` + `FrontierRigidBodyPhysics`):
  `VehicleSpawnSolver.h`, `DriverInputIntegrator.h`, `ChaseCameraProjection.{h,cpp}`, and
  `VehicleRigidBodyAssembly.{h,cpp}` binding `VehicleSolver` + `TyreVisualBridge` directly onto a dynamic Jolt chassis
  body with principal-inertia parity (`Geometry.Inertia()`).

## ✔️ Validation Suites

1. `bash Exhibits/VehiclePhysics/RunProjectDriveValidation.sh`:
   Verifies `Experimental/ProjectDriveReference` blob hashes, preprocessor byte-identity across all six core units,
   eight equation/invariant suites, and `ProjectDriveVisualValidation`.
2. `bash Exhibits/VehiclePhysics/RunProjectDriveJoltValidation.sh` (plus `SANITIZE=1`):
   Verifies `RigidBodySolver` (`Jolt 5.6.0`), `VehicleSpawnSolver`, `VehicleRigidBodyAssembly`, `VehiclePhysicsThread`
   (`240 Hz` async channel stepping), `Frontier/Projects/Project-Drive/` (`ProjectDrive.dll` v3 `CodeInterchange`
   `dlopen` negotiation, ramp jump, lateral kerb wall contact, dynamic slalom cone collisions, `F8` eject/repossess,
   `R` respawn), and `Frontier --project=.../ProjectDrive.frontier --headless`.

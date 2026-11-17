# Modular C++20 Engine & Extension Foundation Plan

## Purpose & Scope Boundaries

This plan defines the full modular rewrite and C++20 generic architecture for **Frontier** and **Project Everest**
from the `56279e1` baseline on branch `arena/bfba53e1-frontier`.

**Execution update (2026-11-09):** The Fluid browser authoring UI is present at `Experimental/Fluid/`, restored from the
latest inspected Frontier- source and browser-verified. Separately, the native C++ `FluidSimulationSequence` now executes its
Eulerian solver with Vulkan compute and `.slang` shaders; pinned SwiftShader GPU validation passes. `FluidSpace` is the host-side
input/readback snapshot, not a CPU solver. The browser prototype and native sequence are not connected, and the current C++
Fluid UI shell does not launch the GPU sequence. Preserve the existing browser UI; do not claim live native UI integration.

- **No Editor or UI work in this phase:** Do not modify `UI/`, ImGui panels, inspectors, docking chrome, or modal
  windows until the engine, simulation spaces, codecs, and extensions rest on a verified C++20 foundation.
- **Preserved untouched domains:** Keep `SolidArc`, `TextureStudio` / `TextureWorkspace`, and
  `Experimental/VehicleProvingGrounds/` intact and passing.
- **Strict naming & file-extension discipline (`EngineDocs/AgenticInstuctions/SKILL-Naming.md`):**
  - Ban and eliminate `Occupant` / `Occupancy`, `Frame`, `Component`, `Pass`, `Stage`, `Buffer`, `Model`, `Cache`,
    `Manager`, `Handler`, `Helper`, `Dispatcher`, `Processor`, `Controller`, `Service`, `Worker`, `Provider`,
    `Parent`, `Child`, `Sibling`, `Emit` / `Emission`, `Node`, `Entity`, `Element`, `Item`, `Data`, `Info`,
    `Object`, `Base`, `Common`, `Util`, `Shared`, and `system` (coordinator suffix).
  - Use `Profile`, `Entry`, `RecordEntry`, `RecordToken`, `EnclosureToken`, `NestedToken`, `Span`, `Atlas`, `Store`,
    `Table`, `Basis`, `Cycle`, `Interval`, `Subject`, `Placement`, `Rasterization`, `Submission`, `Sequence`,
    `Evaluation`, `Substrate`, `Division`, `Space`, and `Extension`.
  - All Frontier container/specification files use `*space` extensions (TOML internally, **never** `.toml`).
  - Keep existing C++ file names consistent where clean (`WorldSpace`, `PhysicsSpace`, `NetworkingSpace`,
    `ParticleSpace`, `ForceField`, etc.), rewrite bloated or unmodular implementations cleanly, and rename files
    whose names themselves contain banned words (legacy `SceneGeometryOccupancy`, `OccupantDistanceSpace`, etc.).
- **Modular translation units:** Keep every `.cpp` unit focused (< ~450 lines) to eliminate MSVC/ClangCL compiler
  bottlenecks and optimization ICEs.

---

## C++20 Generic Architecture ("One Function for Many Types")

Every rewritten subsystem shares four C++20 mechanisms so new domains or fields do not require copy-pasted code:

1. **Concepts (`requires`):** Constrain spatial entries, profile holders, TOML schemas, physics shape descriptors,
   transport substrates, and visual-effect units at compile time (`SpatialProfileAccess`, `MassProfileAccess`,
   `ReplicationCapable`, `SpaceSchema`, `PhysicsShapeVariant`, `TransportSubstrate`, `VisualEffectEvaluation`).
2. **Function & Schema Templates (`SpaceCodec`):** One set of template functions (`DecodeSpaceValue<T>`,
   `EncodeSpaceValue<T>`, `DecodeSpaceFile<T>`, `EncodeSpaceFile<T>`) parses and writes every `*space` TOML file
   from a declarative `constexpr` field table (`FieldBinding`) via `std::apply` fold expressions.
3. **Variadic Profile Composition (`ComposedSceneEntry<Profiles...>`):** Replace hand-written multi-config classes
   (`SpatialNodeRecord`, `RigidBodyRecord`, `ThermalBodyRecord`, `ChemicalVesselRecord`, and future records) with
   one variadic template owning `std::tuple<Profiles...>`, typed `Access<ProfileT>()` / `TryQuery<ProfileT>()`, and
   fold-expression serialization, stepping, and dirty-revision checks.
4. **Type-Safe Variant Dispatch (`std::variant` + `std::visit`):** Replace raw `dynamic_cast` chains and `enum`-tag
   switches across physics shapes, curve evaluators, network messages, particle triggers, and visual effects.

---

## Dedicated `*space` File Layout (TOML Internally, Never `.toml`)

Each simulation domain and unified profile pack gets its own dedicated `*space` container file sharing the owning
asset/level stem, parsed by the single generic `SpaceCodec`:

| Domain / Asset | Dedicated Extension | Replaces / Covers |
|---|---|---|
| Project & Level | `.projectspace`, `.levelspace` | `Everest.projectspace`, `Default.levelspace` (links domain files) |
| Unified Profiles | `.profilespace` | Reusable `SpatialProfile`, `MassProfile`, `ReplicationProfile` presets |
| Physics World | `.physicsspace` | Solver cadence, gravity, collision matrix, per-body overrides |
| Force Field & Wind | `.forcespace` | `ForceField`, `Wind`, and `ForceSource` catalogue entries |
| Particle Effects | `.particlespace` | `ParticleLibrary.particlespace` (~52 presets) + level `.particlespace` |
| Fluid Continuum | `.fluidspace` | Grid bounds, thermo/buoyancy, burst schedules, boundary profiles |
| Curve Packs | `.curvespace` | Bounded monotonic curves & baked LUTs (physics, fluid, particle, optics) |
| Visual Effects | `.effectspace` | Lens flare, heat distortion/lensing, motion blur, glare, optical shake |
| Fracture Profiles | `.fracturespace` | Voronoi cell seeding, impulse thresholds, fragment budgets |
| Networking Session | `.networkspace` | Peer roster, transport substrate, replication rates & channel policy |
| Primitive Shapes | `.shapespace` + `.sdfspace` | Migrates `EngineContent/ShapeArchives/*.toml` to `*.shapespace` |

---

## Execution Phases & What Runs First

### Phase 0 — Baseline Fixes in `56279e1` (Do First)

Fix concrete bugs already present in the current tree before rewriting subsystems:

1. **Vulkan teardown synchronization (`SceneViewport::~SceneViewport`):** Call `Exchange_->AwaitIdle()` before
   releasing `PresentedView_`, `Pick_`, `Overlay_`, and `Host_` so quality changes or shutdown never destroy active
   device resources (matching `ParticleExtension`).
2. **Two-sweep enclosure resolution (`WorldSpace::LoadLevelSpace`):** Resolve `EnclosureToken` links in a second
   sweep after all entries are constructed so forward-referenced enclosure IDs in `.levelspace` files are never
   dropped.
3. **Null-termination bug (`TypedSceneRecord` in `WorldSpace.h`):** Supply stored `TypeIdentifier.c_str()` instead of
   `std::string_view::data()` to C-string APIs.
4. **Cross-platform build hygiene:** Verify every `Frontier` engine/extension library compiles cleanly under both
   Linux GCC/Clang (`g++ -std=c++20`) and Windows ClangCL without `#ifdef _WIN32` leaking into portable logic.

---

### Phase 1 — One Unified Math Folder & One Unified Constants Location

Eliminate the 40+ duplicated definitions of `Pi`, `π`, `DegreesToRadian`, `Vector`, `Matrix`, and `Quat` across
`Frontier/` and `Engine/` by consolidating everything into one location:

- **`Frontier/Engine/Foundation/Constants.h`:**
  - `template <std::floating_point ScalarT> struct MathematicalConstants` (`Pi`, `TwoPi`, `HalfPi`, `Tau`,
    `DegreesToRadians`, `RadiansToDegrees`, `Epsilon`, `GoldenRatio`).
  - `template <std::floating_point ScalarT> struct PhysicalConstants` (`StandardGravityMps2`,
    `StandardSeaLevelDensityKgM3`, `UniversalGasConstant`, `StefanBoltzmann`, `SpeedOfLightMps`, `KelvinOffset`).
  - `inline constexpr` aliases (`MathConstantsF`, `MathConstantsD`, `PhysicsConstantsF`, `PhysicsConstantsD`).
- **`Frontier/Engine/Foundation/Math/`:**
  - `VectorTypes.h`: `template <std::floating_point ScalarT, size_t Lanes> struct Vector` with `Vector2<T>`,
    `Vector3<T>`, `Vector4<T>`, plus concept-constrained `Dot`, `Cross`, `Length`, `Normalise`, `Lerp`, `Clamp`.
  - `Quaternion.h`: `template <std::floating_point ScalarT> struct Quaternion` (ZYX Euler <-> quaternion, axis-angle,
    conjugate, slerp, vector rotation) — replacing duplicated quaternion code in `PhysicsSpace.cpp`,
    `PlacementGizmo.cpp`, and `Vehicle`.
  - `Matrix4.h`: column-major `template <std::floating_point ScalarT> struct Matrix4` (Vulkan clip space `[0,1]`,
    look-at, perspective, TRS matrix assembly, bounds transform).
  - `SpatialBounds.h`: `template <std::floating_point ScalarT> struct IntervalBounds3` and ray/plane/skew-line
    projection math used identically by `GizmoSpace`, `SceneSubjectPlacement`, `PhysicsExtension`, and `ForceField`.

---

### Phase 2 — Unified Profiles, Generic `*space` Codec, Opt-In Replication & `WorldSpace` Rewrite

Build the unified composition and serialization backbone used across Particle, ForceField, Fluid, Physics, Networking,
and Visual Effects:

1. **Unified Property Profiles (`Frontier/Engine/Scene/Profiles/`):**
   - `SpatialProfile.h`: world position (`Vector3<double>`), orientation (`EulerDegrees` + derived quaternion),
     non-uniform scale, and `RevisionCounter` (used by Geometry, Physics bodies, Force sources, Particle effects,
     Fluid domains, Visual-effect volumes, and future Vehicles).
   - `MassProfile.h`: mass (`kg`), density (`kg/m³`), volume (`m³`), inertia tensor override, restitution,
     static/kinematic friction, linear/angular damping.
   - `KinematicsProfile.h`: linear velocity, angular velocity, gravity coupling, motion classification (`Fixed`,
     `Kinematic`, `Dynamic`), and sleeping thresholds.
   - `ThermalChemicalProfiles.h`: temperature (`K`), thermal conductivity/heat capacity, stoichiometry/kinetics.
   - `SurfaceOpticsProfile.h`: albedo, roughness, metallic, emissive radiance, shadow/GI participation.
   - `ReplicationProfile.h`: opt-in network replication settings (`ReplicationMode`: `Disabled`, `HostAuthoritative`,
     `InterpolatedProxy`, `OwnerInput`; `ReplicationFrequencyHz`, `ChannelMask`, `OwnerPeerToken`,
     `InterpolateTransforms`, `DirtyFieldMask`, `LastReplicatedRevision`).
2. **Generic `SpaceCodec` (`Frontier/Engine/Scene/SpaceCodec.h`):**
   - `FieldBinding<OwnerT, MemberT>` descriptors + `SpaceSchema<OwnerT>` trait.
   - One templated `DecodeSpaceTable` / `EncodeSpaceTable` pair plus `DecodeSpaceFile` / `EncodeSpaceFile` handling
     `.levelspace`, `.physicsspace`, `.forcespace`, `.particlespace`, `.fluidspace`, `.curvespace`, `.effectspace`,
     `.fracturespace`, and `.networkspace`.
   - Split per-domain schemas into small files (`EnvironmentSpaceCodecs.cpp`, `DynamicsSpaceCodecs.cpp`, etc.) so
     `WorldSpace.cpp` stays concise and modular.
3. **`WorldSpace` Rewrite (`Frontier/Engine/Scene/WorldSpace.{h,cpp}`):**
   - Replace manual `dynamic_cast` lookups with `FindFirst<EntryT>()`, `FindAll<EntryT>()`,
     `ForEachWithProfile<ProfileT>()`, and `CloneEntry(RecordToken)`.
   - Replace hand-coded `SpatialNodeRecord`, `RigidBodyRecord`, `ThermalBodyRecord`, `ChemicalVesselRecord` with
     `ComposedSceneEntry<SpatialProfile, ...>`.
   - Support linking external domain files (`source_space = "Simulations/Plumes.fluidspace"`) or inline profile
     tables transparently.

---

### Phase 3 — Solid Foundation for Core Domains & Replication

Rewrite and harden each foundational space and extension over Phases 1–2 (and purge banned `Occupant`/`Frame` names):

1. **Networking & Replication Foundation (`Frontier/Extensions/Networking/` + `.networkspace`):**
   - Split cleanly into:
     - `NetworkingSpace.{h,cpp}`: peer table, roles (`Host`/`Client`), relay peer identities, channel statistics.
     - `NetworkTransport.h` + `NetworkingTransport.cpp`: wire envelope codec (24-byte header + chunked fragmentation &
       reassembly) + `INetworkTransport` interface.
     - `LoopbackTransport`, `EosRelayAdapter`, `PhotonRelayAdapter` implementing `INetworkTransport` so
       `Project-Networking` consumes the exact same transport contract without duplicated stubs.
     - **Templated `DomainReplicator<SpaceT>` (`ReplicationExchange.h`):** One generic replication engine driven by
       each entry's `ReplicationProfile` and `SpaceSchema` — diffs revisions, encodes only dirty fields/profiles
       (binary or compact TOML delta), broadcasts by `ReplicationFrequencyHz`, and applies incoming snapshots with
       optional Hermite/linear interpolation on clients for **World, Physics, Particle, ForceField, Fluid, Effects**.
2. **Physics Foundation (`Frontier/Extensions/Physics/` + `.physicsspace`):**
   - Separate `PhysicsSpace` cleanly behind `IPhysicsSubstrate` -> `JoltSubstrate` (`JoltPhysics 5.6.0`), keeping Jolt
     headers strictly internal.
   - Variant shape descriptors (`PhysicsShapeSpecification` using `std::variant<BoxShape, SphereShape, CylinderShape,
     ConeShape, TorusShape, CapsuleShape, ConvexHullShape, TriangleSurfaceShape>`) constructed via `std::visit`.
   - Generic profile-driven `PhysicsExtension`: binds **any** `WorldSpace` entry holding `SpatialProfile` +
     (`MassProfile` / `KinematicsProfile` / `GeometryConfiguration`) via concepts, uses signature hashing for
     incremental updates, exposes `PhysicsExecutionThread` over `SnapshotExchange`, and replicates dynamic transforms
     when `ReplicationProfile` is enabled.
   - **Decoupled `PhysicsImpactTelemetry` stream:** Jolt `ContactListener` records typed contact events (world point,
     normal, impulse magnitude `N·s`, relative speed, resolved `SurfaceMaterialClass`) into a bounded ring queue
     readable by Particle, Fluid, Effects, Fracture, and Audio without coupling Physics to any of them.
3. **ForceField Foundation (`Frontier/Engine/PhysicalDynamics/ForceField*` + `.forcespace`):**
   - Consolidate `ForceField`, `Wind`, and `ForceSource` into a modular `ForceFieldSpace` backed by unified
     `SpatialProfile`, `CurveSpace` falloff/envelope profiles, and `ReplicationProfile`.
   - Separate the 16 source evaluators into focused category units (`FlowEvaluators`, `AccelerationEvaluators`,
     `DampingEvaluators`) invoked through one templated accumulator (`EvaluateContributionBucket<ContributionT>()`).
   - Provide one unified `IFieldSampler` interface sampled identically by `ParticleSpace`, `FluidSpace`,
     `PhysicsExtension` (aerodynamic drag/wind forces), and `VolumetricClouds`.
4. **Particle Foundation — Full ~52-Preset Engine + Physics/Fluid Triggers (`.particlespace`):**
   - Migrate `EngineContent/ParticleArchives/ParticleLibrary.toml` -> `ParticleLibrary.particlespace` using
     `SpaceCodec` (retaining all ~52 presets across `Ballistic`, `WindDriven`, `LennardJones`, `Reactive`,
     `VisualEffect`, `Flocking`, and `LightFibre`). **Done:** the exporter writes a
     `format = "frontier.particlelibrary"` / `version = 1` banner, `ParticleEffectLibrary::Decode` resolves the
     `.particlespace` path first with a same-stem `.toml` fallback, and integral-float readings (eos `assemble`)
     decode through `ReadIntegral`.
   - Refactor `ParticleSpace` entries to embed `SpatialProfile`, `MassProfile` (for ballistic/drag scaling), and
     `ReplicationProfile` (replicating trigger seeds, burst timestamps, and authored parameter deltas rather than raw
     per-particle GPU state). **Done:** `ParticleSpace` and each `ParticleEffectInstance` carry the three profiles,
     the `.particlespace` codec persists domain-level `[spatial]` / `[mass]` / `[replication]` plus per-effect
     sub-tables, `SampleLevelForceField(const IFieldSampler&)` couples the level wind, and
     `DomainReplicator<ParticleSpace>` round-trips the whole space over `LoopbackTransport`.
   - **Replace the 1-off `ImpactSpark` concept with `ParticleTriggerRouter`:**
     - Data-driven mapping table in `.particlespace` / `.physicsspace` binding `(PhysicsImpactSurface, ImpulseRange)`
       or `FluidBurstEvent` to **any** preset(s) in `ParticleLibrary.particlespace` — exact identifiers `"sparks"`,
       `"strikeSparks"`, `"debris"`, `"glass"`, `"smoke"`, `"embers"`, `"heat-shimmer"`, `"watermist"`, `"splash"`,
       `"sand"`, `"steam"`, `"leaves"` — scaled by impulse energy and contact normal. **Done:**
       `ParticleTriggerRouter.{h,cpp}` persists `ParticleTriggerRule` entries (`SpaceSchema<ParticleTriggerRule>`
       -> `[[rule]]` tables) and dispatches `PhysicsImpactEvent` / `PhysicsImpactRing` telemetry and
       `FluidBurstTriggerEvent` (thermal / vapor / smoke channels) into preset-scaled bursts — zero bespoke
       `ImpactSpark.slang` shader needed!
5. **Fluid Foundation (`Frontier/Engine/PhysicalDynamics/FluidDynamics/` + `.fluidspace`):**
   - **Native GPU baseline (2026-11-09):** `FluidSpace` owns a validated lattice descriptor, host-authored radial-source
     queue, and initial/latest-readback snapshot. `FluidSimulationSequence` dispatches Slang compute for field/source input,
     semi-Lagrangian advection, stable smoke/vapor diffusion, buoyancy, Jacobi pressure projection, and a 3D volume preview.
     No CPU state-evolution fallback is used. The native `IFieldSampler` is sampled into a GPU-readable input texture, and
     the explicit readback feeds `FluidBurstTriggerEvent` extraction. `FluidSimulationGpuValidation` passed on pinned
     SwiftShader Vulkan; this is software Vulkan validation, not physical-hardware testing.
   - **Existing authoring UI:** the full gas/smoke browser editor and its WebGL2/experimental WebGPU engines are in
     `Experimental/Fluid/`. Preserve that UI and its effect authoring model; it is a separate prototype, not a node editor,
     and does not call into the C++ solver. The C++ native Fluid UI shell likewise does not launch the GPU sequence. Its
     source and browser verification are documented in `Documentation/Plans/Completed/RemasteredEditorSourceRestoration.md`.
   - **Remaining engine/UI work:** define a deliberate browser/native interchange or native editor bridge; complete boundary
     profiles, richer thermal transport, replication of authored/release state and simulation clock, and wire the native
     sequence into a future Fluid workspace. Fluid bursts continue through `ParticleTriggerRouter`; do not replace the
     existing browser UI with another editor.
6. **Rendering & Unified `GizmoSpace` Cleanup (Purging Banned Vocabulary):**
   - **Checkpoint (2026-11-09):** renamed `SceneGeometryOccupancy.{h,cpp}` to `SceneSubjectPlacement.{h,cpp}`;
     renamed the distance-space and relocation source/classes to `SubjectDistanceSpace` / `SubjectRelocation`, plus the
     placement and pick result types to `SubjectPlacement` / `SubjectPick` and the viewport query to `PickSubjects`. Added the
     `SpatialEditable` concept and generic `PlacementGizmo` profile adapters, with compile-time API checks in the geometry
     validation source. Syntax checks cover the renamed translation units and geometry/pick validation sources. The wider
     vocabulary cleanup is still open for legacy `OccupantEntry`/`Occupants` records, GPU interface names, and `Frame` identifiers;
     active record/workspace wiring of the new gizmo adapter is also pending.
   - Resolve `<ArchiveStem>.facetspace` dynamically and export bounded `TriangleSurfaceShape` collision triangles from
     `SceneSubjectPlacement` to `PhysicsExtension`.
   - Generalize `GizmoSpace` / `PlacementGizmo` via a C++20 `SpatialEditable` concept so one gizmo binds to any entry
     carrying `SpatialProfile` (`Geometry`, `Particle`, `ForceField`, `Fluid`, `Effect`, `Physics`).

---

### Phase 4 — Curve Engine (`CurveSpace`) & Unified Visual Effects Architecture (`EffectSpace`)

**Checkpoint (2026-11-09):** Added scalar `CurveProfile<double>` / `CurveSpace` evaluation (linear, clamped Hermite, and
monotonic PCHIP), baked fixed-size LUTs, transactional validation, and `.curvespace` codec; its validation passes 26 checks.
Added `VisualEffectProfile` / `EffectSpace` data, spatial/replication metadata, semantic checks, and `.effectspace` codec; its
validation passes 19 checks. These remain data foundations only—not complete integration into Physics/ForceField/Particle/Fluid
or the planned GPU `VisualEffects` sequence. The first shared `CurvePlot` UI control now precedes domain integration; full curve
authoring remains deferred until the shared Editor foundation is complete.

1. **Curve Engine & `.curvespace` Foundation (`Frontier/Engine/Foundation/Curves/`):**
   - **Note:** Engine/data/math layer only (ImGui curve-drawing UI waits for the post-foundation Editor phase).
   - `template <CurveValueConcept ValueT> class CurveProfile`: supports piecewise linear, clamped cubic Hermite, and
     monotonic PCHIP interpolation, finite/domain/monotonicity transactional validation, and pre-baked uniform `Lut<N>`
     tables for zero-branch GPU/solver evaluation.
   - `CurveSpace` + `.curvespace` TOML codec (`SpaceCodec`) serving Physics (suspension/tyre/drag curves),
     ForceField (radial falloff & gust envelopes), Particle (size/alpha/temperature over age), Fluid (buoyancy/burn
     ramps), and Visual Effects (exposure/vignette/glare response curves).
2. **Modular Visual Effects Architecture (`Frontier/Engine/Rendering/VisualEffects/` + `.effectspace`):**
   - Replace scattered effect hacks (`PresentationControl` bit-packing, ad-hoc flare coupling, particle-only lensing)
     with a single composable pipeline driven by `EffectSpace` and `.effectspace`:
     - **`VisualEffectProfile` + `IVisualEffectEvaluation`:** Concept/interface unit where each effect owns its GPU
       program/layout once and evaluates over unified scene targets (`HdrRadianceTarget`, `SceneDepthTarget`,
       `DualVelocityTarget`, `DistortionFieldTarget`).
     - **Dual-Velocity Motion Atlas (`Rgba16Float`):** Cleanly separates camera-only velocity (`RG`) from full
       camera + dynamic-subject velocity (`BA`) — feeding Temporal AA and configurable `MotionBlurEvaluation`
       (`Disabled`, `CameraOnly`, `FullScene`) without scalar bit-packing.
     - **Refractive Heat Distortion & Lensing Evaluation:** One unified screen/world displacement evaluation consuming
       heat-shimmer volumes from `FluidSpace` plumes, `ParticleSpace` lensing/heat-shimmer presets (`Heat shimmer`,
       `Black hole`), and standalone `EffectSpace` distortion volumes.
     - **Optical Lens Flare & Glare Evaluation:** Decouple `OpticalLensFlare` cleanly into `VisualEffectSequence`
       so solar and dynamic point/fire luminaires consume one optical flare, starburst, and chromatic halo pipeline.
     - **Optical Camera Impulse Shake:** Engine-side seeded spring-damper modifier consuming `PhysicsImpactTelemetry`
       and kinematics velocity profiles (`SpatialProfile` / `KinematicsProfile`).
     - **Replication support:** Every `EffectSpace` entry carries optional `ReplicationProfile` for synchronized
       triggering of flares, distortion bursts, and cinematic camera impulses across peers.

---

### Phase 5 — Downstream Redo Consumers (Built on Phases 0–4)

Once Phases 0–4 are compiled, verified, and green:
1. **Voronoi Fracture Engine (`Frontier/Engine/PhysicalDynamics/FractureDynamics/` + `.fracturespace`):** Clean CPU
   3D half-space clipper + optional Jolt debris body release driven by `PhysicsImpactTelemetry` and mapped to
   `ParticleTriggerRouter` dust/shard presets.
2. **Vehicle & Tyre Physics Foundation (`Frontier/Engine/PhysicalDynamics/Vehicle/`):** Concept-driven tyre
   carcass formulations + `CurveSpace` curves + `PhysicsVehicle` using unified Math/Constants and `PhysicsSpace`.
3. **Standalone Session & Runtime (`Frontier/Engine/Session/` + `Projects/Everest`):** Unified `SessionSpace`,
   `SessionPolicy`, and `ReplicationExchange` without per-level special-casing.
4. **Deferred Editor / UI Layer (Separate Approval Required):** Wire UI panels, `CurveEditor` widgetry, and domain
   inspectors only after the engine/extension foundation above is signed off.

---

## Validation Strategy (Non-UI, Headless Engine & Shader Verification)

- **Unified Math & Constants check:** Compile-time `static_assert` and unit checks verifying single-source constants
  and quaternion/matrix identities.
- **Codec & Profile round-trip checks:** Every `*space` file format (`.levelspace`, `.physicsspace`, `.forcespace`,
  `.particlespace`, `.fluidspace`, `.curvespace`, `.effectspace`, `.networkspace`, `.shapespace`) completes
  deterministic encode -> decode -> semantic equality verification.
- **Cross-domain physics/particle/force/fluid/replication checks:**
  - `PhysicsSpaceValidation`: multi-shape Jolt bodies + `PhysicsImpactTelemetry` -> `ParticleTriggerRouter` selecting
    multiple `ParticleLibrary.particlespace` presets (`"sparks"`, `"strikeSparks"`, `"debris"`, `"watermist"`).
  - `NetworkingSpaceValidation`: `DomainReplicator` replicating dirty `SpatialProfile`, `MassProfile`,
    `ForceFieldSpace`, `ParticleSpace`, `FluidSpace`, and `EffectSpace` records over `LoopbackTransport`.
  - `VisualEffectsValidation`: SwiftShader offscreen verification of `OpticalLensFlare`, `HeatDistortion`, and
    `MotionBlur` (`DualVelocityTarget`), plus `StoreShaderArchives.py --verify`.
- **No regressions:** Keep `SolidArc`, `TextureStudio`, and `Experimental/VehicleProvingGrounds/` (`90/90` tests and
  `:8080` live server) green at every checkpoint.

# Folder Structure

## Target ownership

```text
Frontier/
├── CMakeLists.txt             # UI-only build and local verification
├── Automation/                # Existing tooling plus pinned UI setup and patches
├── ExternalPackages/          # Ignored downloaded dependency trees
├── README.md
├── AGENTS.md
├── CLAUDE.md
├── Documentation/
│   ├── Tracker.md
│   ├── FolderStructure.md
│   ├── Rules/
│   └── Plans/
│       ├── Ongoing/
│       ├── Completed/
│       └── References/        # Retained reference documents (InheritedEngine/)
├── Engine/                    # Shared production code
│   ├── Audio/                 # Spatial acoustics, Doppler kinematics, and mix-bus routing
│   ├── Diagnostics/           # Structured log categories, ring stores, and streams
│   ├── Environment/           # 3D wind, snowpack, lightning/thunder, stars, moons, ringed planets & atmospheres
│   ├── Fluid/                 # 3D smoke/fire plumes and 2.5D shallow-water & Bingham-plastic mud
│   ├── Foundation/            # Math, deterministic RNG, and memory/value primitives
│   ├── Geometry/              # Glass-aware virtualized cluster DAG, quadric tiers, Hi-Z, and 64 KB pages
│   ├── Interface/             # Selectively ported UI foundations and native Vehicle Cabin/HUD HMI
│   ├── Lifecycle/             # Shared activation sequence
│   ├── Networking/            # Deterministic bitpacking, delta snapshots, and vehicle replication
│   ├── Physics/               # ProjectDrive, Propulsion, SolidFracture, and BallisticSparks
│   ├── Render/                # Blank; Git retention marker only
│   ├── Rendering/             # Pure optical/GPU rendering (GTX SDF GI + BVH Refl, RTX Full RT, Portals, Mirrors)
│   ├── Scene/                 # Scene records and spatial organization
│   └── Threading/             # Work-stealing task DAGs and lock-free snapshot exchanges
├── UI/
│   └── Editor/                # Lifecycle-owned production editor UI
├── EngineContent/             # Shared content archives (icons, fonts, materials, environments)
├── Exhibits/
│   ├── <ValidationName>/
│   │   ├── README.md
│   │   ├── Code/
│   │   ├── Images/
│   │   └── Results/
│   └── EditorMirror/           # Comparison mirror of the C++ editor
├── Experimental/              # Prototypes and experimental HTML
├── EngineDocs/AgenticInstuctions/  # Four retained authoritative skills
└── _ClaudeScratch/            # Ignored logs/, build/, tmp/
```

This is a target map, not a claim that source migration is complete.
Create meaningful folders as their contents are needed; do not add empty placeholder trees.
Use technical validation names under Exhibits, not the banned naming placeholder from earlier discussion.
No new top-level ownership categories without approval. Update this map after approved structural changes.

## Inherited layout — migration review outcome (2026-10-22)

`Internal/`, `Executables/`, `Applications/`, and `memory/` were reclaimed from this branch; the
complete trees remain on `master` and in this branch's history. Their documents, together with
`Documentation/Prototypes/`, `Documentation/Research/`, and the inherited root-level plan and
reference notes, are retained under `Documentation/Plans/References/InheritedEngine/`.
`Automation/` is current tooling (see the target map). Existing diagnostics remain in
`Exhibits/Diagnostics/`. `EngineDocs/` retains existing governance references until separately
reconciled.
The linked source also has `Docs/`, `Editor/`, `Projects/`, `Tools/`, and dependency/content folders;
map their ownership and build dependencies before any import or relocation.

## Selective port boundary

`Exhibits/UIFoundation/` retains verification code, results, and actual SVG raster evidence.
`Automation/Patches/` owns the six inherited ImGui patches. Dependency pins live in
`Automation/UIDependencies.json`. No scene renderer is ported or built by the new CMake target.
No inherited `Internal/` code is linked into this target.

`Exhibits/ControlCentre/` owns current appearance interaction tests, native CPU images, and build evidence.
`Automation/FontSources.json`, `PrepareFonts.py`, and `FontRequirements.txt` define open-font recovery.
`Automation/WindowsToolchain.cmake` supports Windows cross-compilation on the editing host.
`Automation/PackageWindows.py` packages only Windows binaries and their runtime assets under ignored `Binaries/`.

## Shared content and dependencies

```text
EngineContent/
├── Icons/                     # Tracked original/compatibility SVGs
├── MaterialArchives/          # Tracked Texture Studio material library (.material + baked maps)
├── PatternArchives/           # Tracked Texture Studio pattern presets
├── EnvironmentArchives/       # Tracked baked equirect studio environments (+ user imports)
├── Defaults/                  # Tracked blank project space
└── FontArchives/<font name>/  # Ignored font downloads, OFL notices, TOML descriptors
ExternalPackages/
├── glfw/                      # GLFW 3.4 platform windows/input
├── tomlpp/                    # Native TOML formats
├── imgui/                     # Pinned UI + approved patches
└── thorvg/                    # SVG rasterization
```

ContentDirectory resolves bundled content from the executable independently of the launch working directory.
The font catalogue has a native TOML form; JSON remains only an automation/report interchange.


## Bounded path replay ownership — 2026-10-27

- `Frontier/Engine/Rendering/PathReplayFootprint.h` owns shared C++17-compatible GPU input footprints;
  `PathReplayDomain.{h,cpp}` owns C++20 bounded domain guards, emissive-facet indices and history-cap tracking;
  `FrontierPathReplayDomain` is their reusable CMake library.
- `Frontier/Engine/Rendering/Shaders/PathReplayReservoir.slang` owns the corresponding bounded shader.
  `Exhibits/LightCompute/` retains fixture generation, an isolated Vulkan submission host and verification.
- The root editor target does not yet submit this shader; the shared location is not a production-integration claim.

## Replay submission and validation ownership — 2026-10-29

- `Frontier/Engine/Rendering/PathReplaySubmissionSequence.{h,cpp}` owns optional completion-gated replay history;
  `FrontierPathReplaySubmission` links the bounded domain and Vulkan recorder. Callers own GPU resources and fences.
- `Exhibits/LightCompute/Code/Replay{Transmission,Segment,SubmissionSequence}Validation.*` owns focused checks;
  `RunReplayTransmission.sh`, `RunReplaySubmissionSequence.sh`, `Results/` and `Images/` retain reproducible evidence.
- `ReplayMaterialSamplingValidation.{h,slang}` owns the actual-sampler and independent hemisphere checks;
  `ReplayMaterialPathValidation.h` checks recorded material/diffuse paths against separate integrals.
  `ReplayMaterialReuseValidation.h` checks bounded temporal/spatial materials and C++ revision resets;
  `ReplayMaterialFloorValidation.h` compares two accepted target floors and tests floor-revision invalidation;
  `ReplayMixedMaterialValidation.h` and `ReplayMixedMaterialLinks.slang` stress different material/visibility
  donors and audit accepted spatial links; `ReplayMaterialGuardValidation.h` holds the failed, test-only
  material-boundary holdout; `ReplayFreshDonorValidation.h` tests a different test-only fresh-neighbor policy.
  Their reports, scripts and images/logs preserve scope and results.
- `ReplayBranchComparison.md` records the compared peer revision and non-equivalent benchmark boundaries. None of
  these files connects the renderer to the editor viewport.

## Shared radiant-facet distribution — 2026-10-27

- `Frontier/Engine/Rendering/RadiantFacetDistribution.{h,cpp}` and CMake target
  `FrontierRadiantFacetDistribution` own area/luminance sampling and encoded-distribution validation.
- `Exhibits/LightCompute/` retains archive offsets, independent comparisons and the isolated Vulkan submission;
  this extraction does not connect the root editor to the GPU shader.

## VehicleHMI reference and celestial content — 2026-10-27

- `Experimental/VehicleHmiReference/`: selected immutable full-demo sources, blob manifest and original tyre tests.
- `EngineContent/CelestialMaps/`: retained demo lunar JPEG and provenance; generated runtime PPM stays ignored.
- `Exhibits/VehiclePhysics/Continuation.md`: source audit, renderer comparison, validation and remaining scope.

## Glass-aware cluster geometry, celestial sky, and dual-tier GI — 2026-10-30

- `Frontier/Engine/Geometry/` (`FrontierClusteredGeometry`): owns `FacetTierBuild`, `QuadricTierBuild`,
  `GlassAwareClusterExtension`, and `Shaders/GlassAwareClusterCull.slang` for class-pure `<= 128`-triangle
  clusters, monotonic quadric simplification DAGs, optical IOR error magnification, two-phase non-opaque Hi-Z
  culling, `64 KB` streaming pages, and two-layer dielectric glass peeling.
- `Frontier/Engine/Environment/CelestialPlanetaryExtension.{h,cpp}` (`FrontierCelestialPlanetary`): owns the
  41,360-star `Hipparcos8.csv` `32x32` octahedral index, custom user-defined stars with Kelvin chromaticity and
  6-blade diffraction spikes, `2048x1024` textured Moon + 6 lunar presets, and 3D ringed planets with simulated
  spherical Rayleigh/Mie/absorption atmospheres and mutual planet/ring shadows.
- `Frontier/Engine/Rendering/SdfRestirPortalExtension.{h,cpp}` & `Shaders/SdfRestirPortalMirror.slang`: enforces
  the exact dual-tier split where `SignedDistanceFieldGtx` pairs SDF + `OrientedSurfaceCard` ReSTIR GI with
  software triangle-BVH reflections, while `HardwareRayTracingRtx` uses full triangle raytracing for both GI and
  reflections, coupled with solid-angle area luminaires, closed-dielectric glass, portals, mirrors, spatial reuse,
  and 3-step edge-stopping À-Trous denoising.
- `Exhibits/CelestialGlassLightingShowcase/`: owns the 13-suite validation executable and 5 rendered `960x540`
  visual showcase PNGs under `Images/`.


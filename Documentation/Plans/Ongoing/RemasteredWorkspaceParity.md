# Remastered workspace parity

**Status:** ongoing. The source-restoration subtask for the Fluid Editor and Particle Studio location is complete; the wider
Remastered workspace parity work and shared UI foundation are not complete.

## Completed source-restoration slice

- Located and copied the latest inspected non-node gas Fluid Editor into `Experimental/Fluid/`. It authors plumes, blasts,
  wildfire/dust tornadoes, and other effects. This is the upstream prototype, not a newly written node editor.
- Moved the Remastered Particle Studio to `Experimental Remastered/ParticleEditor/` and updated its suite links and launcher
  references. The distinct `Experimental/ParticleEditor/` reference tree remains for existing validation/export consumers.
- Build, Node tests, browser checks, interaction checks, and route checks passed. The detailed source research, commands, caveats,
  and captured browser evidence are recorded in
  [`RemasteredEditorSourceRestoration.md`](../Completed/RemasteredEditorSourceRestoration.md) and
  [`Exhibits/FluidEditor/README.md`](../../../Exhibits/FluidEditor/README.md).

## Fracture parity audit — 2026-11-09

Compared `Experimental Remastered/FractureEditor/Engine/` with the linked `c7egoist/Frontier` source at commit
`acb0502e56e9781e1f78f9b7e6b3e97e810dd3be` (2026-11-02; fetched from `arena/eb353da2-frontier`). The six core
fracture, engineering, diagram, rigid-body, and celestial modules are byte-identical:

| Module | SHA-256 on both sides |
|---|---|
| `CelestialAtmosphereModel.js` | `7d1bfe91949fbba710be4a4cd9945373af3f946147d1afb72eb3d69756ee6b05` |
| `ConvexPartitioning.js` | `21f2baf0f15cf748a37cb83231336faa4e981fa2245bb70eb71cc772295a06f2` |
| `EngineeringBakedFracture.js` | `fb7febef7b78b3731f9aba78135c4d29412e2325444f7d009d78541877df805e` |
| `FastRuntimeFracture.js` | `18feb4772f038f18002ba5569721f6d092848eb711b29d27e606fa2a93b41f02` |
| `InfographicDiagrams.js` | `1f39760e14284786fe8fa2932beb59623499a737e3449fb01d653933de818a77` |
| `RigidBodyDynamics.js` | `f5c517be69a0604e8a5424caa151a745c75496952be96329a9ec4de2e660a047` |

`ViewportRasterization.js` is the only differing engine module (linked SHA-256 `24e0de82af721b0bb6633e451607cc6838a2d945723406fdc14c7af062a5e578`; Remastered `6163bb5cf87994b851b54fc2529c6068976c56182ecad04c6b1e8ec407404f34`). The Remastered version adds pointer-up cleanup for fallback orbit controls; top/front/side camera presets when OrbitControls are unavailable; and a fuller software fallback with sun-tinted sky, ground grid, depth-sorted/projection-culled faces, lens-specific shading, selected-fragment highlighting, and bond overlays in plexus/hybrid modes. The linked fallback instead uses a static gradient and basic fragment fills without the bond overlay. The diff is limited to these viewport interaction/fallback blocks; the six algorithm modules remain identical. **Do not replace the newer Remastered viewport with the older linked file.**

The Remastered `FractureValidation.mjs` passed: 83 DOM IDs, six representative solver/solid partitions (volume drift `<0.02`), one engineering FEM report, SDF footprint, baked timeline, and celestial defaults. The linked `FractureWorkspaceValidation.mjs` has broader coverage: six solvers × seven solids with manifold/volume checks; runtime kernel, buffers, raycast and performance; eigensolver and six engineering materials; SDF slices/footprints; realtime/baked/hybrid timelines; solar/atmosphere/cloud behavior; and JSDOM UI. **The linked validator was inspected, not run.**

### Fracture follow-up

- No core solver/partition module needs copying from this reference revision.
- Keep the Remastered viewport improvements; add explicit regression coverage for fallback pointer cleanup, camera presets, lens/fragment shading and plexus/hybrid bond lines.
- Broaden the Remastered validation matrix toward the linked suite's six-by-seven solver/solid coverage and runtime/engineering/SDF/timeline/celestial checks. Report upstream source comparison separately from tests actually executed.

## Remaining workspace scope

- Finish and verify the shared UI foundation before further editor-specific UI integration.
- Continue workspace parity work within its approved scope. Keep Vehicle Lab and AssetInspector out of scope.
- Do not present the restored browser Fluid Editor as integrated with the native C++ engine. `FluidSpace` integration,
  replication/release-state transport, boundary profiles, richer thermal transport, extension/editor integration, GPU execution,
  broader numerical validation, and Phase 3 Rendering/Gizmo cleanup remain outstanding.
- Preserve the user's 1:1 C++ porting expectation for engine behavior; the existing C++ Particle Editor is not evidence of full
  parity with the newer Remastered Particle Studio.

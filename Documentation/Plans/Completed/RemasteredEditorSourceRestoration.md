# Remastered editor source restoration

**Status:** source restoration and browser verification complete on 2026-11-09. A later change adds a separate native C++ Slang/Vulkan solver; it remains unconnected to this browser prototype.

## Scope

- Find and copy the latest non-node Fluid Editor with plume, detonation, and tornado presets into `Experimental/`.
- Move the Remastered Particle Studio from `EditorInterface/` to `Experimental Remastered/ParticleEditor/`.
- Preserve the older `Experimental/ParticleEditor/` reference copy used by validators and the preset exporter.
- Do not modify Vehicle Lab/AssetInspector or integrate Fluid with the C++ solver in this source-restoration task.

## Source discovery

The newest complete non-node Fluid Editor found in the inspected Frontier-/Slate refs is from
[SultanAladin/Frontier-](https://github.com/SultanAladin/Frontier-), branch `arena/b5d061d9-frontier`.
Its tip is `7ff19ee57e11d649aff94d8f0195a4333cfe1a88`, dated 2026-10-14. The `Experimental/Fluid/` directory is the Vite
smoke/gas editor, not the inherited `FluidNodeEditor`. It includes WebGL2, experimental WebGPU, an Outliner, inspector,
preset library, transport, TOML scene codec, and eight authored sample files. Presets include Pyro Plume + Blast, Tactical
Detonation, Wildfire Tornado, and Dust Tornado.

Fluid-specific changes in this lineage include `65dbededa56edb520550787c1b418e53103fd0a0` (2026-10-08, more presets
and blast bounds) and `f1dfdcf998dfc2831d3ff84bead659a85ddf7f1f` (2026-10-08, sample scenes and TOML). The copied tip
preserves the complete directory and its package lock.

The inspected `SultanAladin/Frontier` Fluid editor source is the existing illustrative `FluidPlumeEditor.cpp`, byte-identical
to this checkout. The inspected Slate branches contain plume/smoke experiments, not a later complete editor. The default
`unassignedinbox/Frontier` branch contains only its README.

## Changes

- Copied upstream `Experimental/Fluid/` into this checkout and added provenance/run notes in
  `Experimental/Fluid/README.md`.
- Repointed the copied editor's font paths to the existing licensed DM Sans assets in the Remastered Particle Studio; added
  that font directory to Vite's development-server allowlist.
- Moved `Experimental Remastered/EditorInterface/` to `Experimental Remastered/ParticleEditor/`. Updated the suite hub,
  Particle links, server redirect, suite README, and folder map. Kept the older `Experimental/ParticleEditor/` copy intact for
  its existing consumers.
- Did not modify the Fluid C++ implementation or connect the browser editor to `FluidSpace`/`FluidSimulationSequence`.

## Verification and evidence

| Check | Result |
|---|---|
| `npm ci --no-audit --no-fund` | Pass, Node 22.22.3 / npm 10.9.8 |
| `npm run build` | Pass, Vite 7.3.6; local font assets bundled |
| `npm test` | Pass, 22/22 scene/preset/TOML checks |
| `npm run verify:browser` | Pass, 18/18 browser/WebGL2/render/UI checks |
| `npm run verify:interactions` | Pass, 9/9 source, camera, document, rendering, and lifecycle checks |
| Remastered/Fluid static routes | Pass, 7/7 HTTP 200 checks |
| Browser capture | `Exhibits/FluidEditor/Images/Verification-2026-11-09/VerifiedWorkspace.png` |

The browser checks used Chromium 153 and SwiftShader software WebGL. Optional WebGPU selection fell back to WebGL2; this is
not native-GPU verification. Reproduction details and the tested local revision are in `Exhibits/FluidEditor/README.md`.

## Deferred

- Connect the restored browser authoring UI to the native C++ `FluidSimulationSequence`, or wire the native GPU sequence into a production Fluid workspace. The existing native Fluid shell remains unwired.
- The native C++ Slang/Vulkan compute path has since passed on software SwiftShader; physical hardware GPU and Windows/MSVC execution remain untested. Browser WebGPU selection in the earlier browser checks still fell back to WebGL2.
- Continue the separate non-asset-editor workspace parity effort under its existing project scope.

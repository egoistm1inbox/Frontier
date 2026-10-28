# Frontier Hydro Lab

A runnable **hybrid water reference implementation** for Frontier:

- **Large-area 2.5D water** — an unbounded world-space swell function combined with three camera-following shallow-water clipmaps for wakes, waves and ripples.
- **Localized 3D splashes** — a sparse, chunked particle/grid volume that only allocates voxels where droplets are active.
- **Explicit coupling** — every emitter and returning droplet creates an `ImpactRecord` in world space. Its momentum and foam are injected into the resident surface-grid cell(s), while the record retains its sparse-volume voxel address for debugging or replication.
- **Frontier-style editor UI** — a three-pane experimental editor with inspector sliders, render/debug tabs, transport controls, active-grid telemetry and an interactive viewport.

> This is a transparent CPU reference / editor prototype, not a claim that Canvas 2D is a production Navier–Stokes renderer. The data model and hand-off points are intentionally separated from rendering so the update passes can be moved to WebGPU/Vulkan compute without changing scene data or tooling.

## Run

```bash
npm test
npm run serve
```

Then open [http://localhost:4173](http://localhost:4173). In Arena's preview, use the provided live-preview link instead.

### Controls

- **Click water** — create a coupled splash at the selected world-space position.
- **Shift/right drag** — orbit the reference viewport.
- **Mouse wheel** — dolly.
- **Space** — play/pause; **I** — impact; **R** — reset; **G** — grid overlay.
- The inspector controls real surface response, splash budget/cell size, coupling and foam values. The `Debug` tab exposes the latest surface-cascade and sparse-volume address for each contact.

## Why this combines both systems

| Job | Representation | Why it scales |
| --- | --- | --- |
| Ocean, lakes, broad waves | Analytic world swell + 2.5D clipmap height fields | The swell has no finite edge. Only the nearby, interactive disturbance field is simulated at high resolution. |
| Ripples / wake / foam sheet | `HeightFieldLevel` cascades + bounded remote tiles | Each level has a different cell size, so the near field stays detailed while outer cascades cover a much larger area. An impact outside the current rings is routed into a world-keyed remote tile instead of being dropped. |
| Crowns, droplets, falling water | Sparse `SparseVolumeGrid` + particles | Chunks are allocated only around active droplets instead of filling the ocean with a 3D voxel texture. |
| System boundary | `ImpactRecord` / `OceanSurface.registerImpact` | Positions are always world-space first, then mapped to the currently resident surface grids and the volume grid. |

See [`docs/HYBRID_FLUID_ARCHITECTURE.md`](docs/HYBRID_FLUID_ARCHITECTURE.md) for the runtime contract and a GPU migration plan.

## Source/UI provenance

The UI is a clean implementation in this repository, styled after the supplied **SultanAladin/Frontier** `arena/4014756b-frontier` Experimental Frontier / Project Browser language: fixed pane headers, three-column editor workspace, compact inspector controls, dark palette and fine dividers. No source files or binaries are copied from that branch.

## Verification

```text
npm test
```

The tests cover affine grid conversion, sparse allocation, clipmap impulse/re-centering, initial cross-system registration and falling-particle return transfer.

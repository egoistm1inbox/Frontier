# Hybrid surface + volume water architecture

## Goal

Use a fast 2.5D representation for the water body that can cover an ocean, while retaining a truly local 3D representation where a height field cannot describe the motion: crowns, falling sheets, droplets and impact cavities.

The reference implementation exposes the same separation a production Frontier system should retain:

```text
World-space emitter / collision
        │
        ▼
   ImpactRecord
   { x, z, normal momentum, foam, time, source }
        │
  ┌─────┴────────────────────┐
  ▼                          ▼
Sparse 3D splash grid   Surface clipmap resolver
particle → grid (P2G)   world x/z → one or more 2.5D cells
  ▼                          ▼
volume pressure / FLIP      height, velocity and foam injection
  ▼                          ▼
falling-particle contact ────┘
```

The important constraint is that the hand-off never uses screen coordinates, a level-local coordinate, or an object-local coordinate as its canonical location. `ImpactRecord` begins with world space. Both solvers derive their own grid address from it.

## Included reference pieces

### 1. General grid frame

`GridTransform` owns an origin and three affine basis vectors. It can convert world positions to grid coordinates and back, including a rotated or non-uniform grid.

```js
const splashGrid = new SparseVolumeGrid({
  transform: new GridTransform({
    origin: [worldX, worldY, worldZ],
    basis: [axisX, axisY, axisZ],
  }),
});
```

This avoids baking an axis-aligned world origin into the fluid logic. A ship-local simulation grid, a streamed world tile, and a rotated basin can all publish the same `ImpactRecord` shape.

### 2. Infinite-looking surface with finite work

`OceanSurface` composes:

1. **World-space procedural swell.** Four directional components are evaluated from absolute `x`, `z`, and time. It has no simulation texture edge, so the visible horizon remains continuous.
2. **Height-field clipmaps.** `HeightFieldLevel` stores disturbance height, vertical velocity and foam. Higher cascades have larger cells and coverage. They slide in integer cell increments as the focus moves.

The demo default is three `96 × 96` fields. At a 0.45 m near-cell size, the near interactive field covers about 43 m. The outer cascades scale cell size by `2^(1.5 * level)`, covering roughly 122 m and 345 m. Those values are sliders in the editor and represent a runtime quality/coverage decision rather than an ocean-world limit.

For a production ocean, preserve more levels (for example 5–7), and stream only the needed clipmap rings. The reference also keeps a bounded set of coarse **remote surface tiles**: an impact outside the viewer's rings is routed by world coordinate into its tile instead of being dropped. A production world partition can back that same key with persistent streamed state; it does not require a unique full-ocean texture.

### 3. Sparse volumetric splash domain

`SparseVolumeGrid` uses 8³ chunks keyed by grid coordinates. Particle-to-grid deposit collects mass, momentum and foam only into touched cells. Empty chunks age out after a few frames.

The compact CPU update includes a local relaxation term to make an editor demonstration cohesive. Its purpose is to show the data shape and working handoff, not to substitute for a high-resolution pressure solver.

### 4. Two-way coupling

At source creation, `spawnImpact()` performs these actions:

1. Creates an initial `ImpactRecord`, mapping the source into every resident surface cascade that contains it.
2. Injects normal momentum / local depression / foam into the shallow-water cells.
3. Emits a downward carrier and a crown of actual particles into the sparse 3D volume.

At return contact, each particle:

1. samples the displaced surface at its world `x/z`,
2. computes downward normal speed and a transfer energy,
3. registers a new world-space `ImpactRecord`,
4. injects the corresponding 2.5D momentum and foam, and
5. is removed from the airborne volume.

This means the visual splash is not detached from the ripple system: falling droplets generate real secondary wave/foam activity in the reference surface solver.

## Production GPU plan

Replace implementation details, not the public data contract:

| Reference component | Production implementation |
| --- | --- |
| `HeightFieldLevel.update` | compute dispatch on ping-pong R16F/RG16F height/velocity and R8 foam textures; use finite differences or a Boussinesq / shallow-water solve. |
| Procedural swell | FFT ocean spectrum or a directional wave set evaluated in the water vertex/domain stage. |
| `SparseVolumeGrid` | sparse-brick allocator / page table plus MAC velocity faces, pressure, occupancy and level-set/SDF fields. |
| Particle integration | APIC/FLIP particles, P2G → pressure projection → G2P, adaptive substeps and solid SDF boundary conditions. |
| `ImpactRecord` resolver | GPU append buffer binned by clipmap level and sparse brick; deterministic event IDs can be retained on CPU/network. |
| Canvas rendering | water mesh clipmap plus volume raymarch / particle splats, temporal foam advection, SSR/refraction and physically based shading. |

### Recommended quality ladder

1. **Low/console:** 3 surface cascades, 128² or 256² each; a capped particle budget; no active sparse pressure solve beyond impact vicinity.
2. **Desktop:** 5 cascades; 512² near field; sparse 8³ or 16³ bricks within a few metres of contact; APIC/FLIP with 2–5 pressure iterations.
3. **Cinematic:** adaptive sparse level-set plus FLIP/APIC, collision SDFs, mesh reconstruction or volume rendering, temporal foam/thin-film advection.

## Important limits of this demo

- The 3D solver is a CPU-readable particle/grid reference, not a full incompressible FLIP pressure projection.
- The visible water surface uses Canvas 2D for portability. It visualizes data from the same simulation, but does not include refraction, caustics or mesh reconstruction.
- The reference keeps a small, aging remote-tile cache. A production implementation should replace its bounded in-memory cache with persistent streamed world tiles.
- Surface/volume time steps must use CFL-aware substepping in the GPU implementation, especially at very small volume cells or high impact speeds.

Those limits are explicit so the editor and data path can be evaluated honestly while still providing a functional, interactive starting point.

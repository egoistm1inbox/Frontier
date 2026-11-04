# Frontier — continent-scale SDF terrain with clipmap LOD and sculpting

Target: an Africa-sized continent (8000 km × 8000 km, flat/planar with a floating origin), represented
entirely as signed distance fields, rendered by sphere tracing in WebGL2, with a hard budget of
**≤ 1 GB of VRAM**, streaming driven by the camera, and sculpting that edits the SDF in place.

## 1. The core problem

| Requirement | Consequence |
|---|---|
| 8000 km of continent | A uniform voxel grid is impossible: at 0.5 m cells that is 1.6·10¹⁶ voxels. Most of the world must be analytic. |
| Detail near the camera | Fine cells (0.5 m) are needed only where the camera is. → sparse, camera-centred **clipmap**. |
| Sculpting | Edits must modify the *stored* field locally, and survive the bricks being evicted. |
| Distance → lower quality | Coarser levels, fewer noise octaves, and the analytic field beyond the clipmap. |
| No rebaking every frame | Bricks are generated **on demand**, budgeted per frame, and only when the window changes or an edit occurs. |
| 1 GB VRAM | One shared atlas of fixed-size bricks, with a page table for indirection. Everything else is small. |

## 2. Layers of the field

```
            camera
              │
 ┌────────────┴───────────────────────────────────────────────┐
 │ L0  0.5 m cells   window 256 m × 128 m    (sculpt + detail) │  ← sparse bricks in the atlas
 │ L1  1 m           window 512 m × 256 m                      │
 │ …                                                           │
 │ L7 64 m           window 32 km × 16 km                      │
 └──────────────────────────────┬──────────────────────────────┘
                                │ fallback when no resident brick covers the point
                    ┌───────────┴────────────┐
                    │ Macro continent SDF    │  analytic, zero VRAM
                    │  + coastline 2D SDF    │  (2048² R16F, 8 MB)
                    └────────────────────────┘
```

### 2.1 Macro continent SDF (the "global" SDF)
`src/world/macroParams.ts`, `src/world/macroReference.ts` (CPU), `chunks.ts` (GLSL, generated from the same constants).

* **Coastline**: a 2D signed-distance texture baked once from a hand-placed Africa polygon
  (`src/world/africa.ts`, `src/world/coastField.ts`). Stored in km, truncated to ±64 km, so R16F keeps
  ~1 m precision near the coast.
* **Solid**: `d(p) = y − h(x,z) + overhang(p) + detail(p)`, a 3D SDF.
  * `h` is an analytic envelope: plateau fBm + Gaussian highlands with ridged noise + an ocean shelf
    driven by the coast distance.
  * `overhang` (60 m amplitude, 500 m period) and `detail` (12 m amplitude, 40 m period) are 3D
    value-noise displacements. These allow cliffs, overhangs and caves; the surface is not a stored
    heightmap.
* **Quality by distance**: the raymarcher passes `oct = 8 / 4 / 2` depending on ray distance
  (< 1.5 km, < 9 km, beyond).

> Honesty note: the envelope `h(x,z)` is still height-shaped. The solid is a true 3D SDF, but the
> large-scale shape is a 2D envelope. Replacing the envelope with a 3D density is a clean next step.

### 2.2 Clipmap bricks (the detail SDF)
`src/clipmap/layout.ts`, `src/clipmap/residency.ts`, `src/gpu/atlas.ts`, `src/gpu/shaders/chunks.ts`.

* **Brick**: 32³ cells, stored as 34³ samples (one-cell border on each side, so trilinear sampling never
  leaves the brick). Samples are the SDF in cell units, clamped to ±4 cells (`BRICK.bandCells`), and
  stored as **R16F**. A 34³ brick takes 78.6 KB.
* **Levels**: 8 levels, cell = 0.5·2ⁱ m, brick = 16·2ⁱ m.
* **Window**: each level keeps a camera-centred window of 16 × 8 × 16 bricks (2048 bricks per level).
  The window moves in whole bricks. Only the entering face is rebuilt.
* **Toroidal page table**: a texel holds the brick whose index ≡ texel (mod grid). Moving the camera
  therefore never re-indexes the window. The page table is an R16I 3D texture (16 × 64 × 16) with one
  stacked block per level. Codes: `≥0` slot, `−1` uniform air, `−2` uniform solid, `−3` pending.
* **Sparse residency**: a brick is classified on the CPU as uniform air, uniform solid or mixed. Uniform
  bricks take **no slot**. Only mixed (shell) bricks are generated on the GPU into the shared atlas.
* **Atlas**: one R16F 3D texture of 16×16 slots per z-block, 8192 slots total (544 × 544 × 1088 texels,
  **644 MB**). A free-list `SlotPool` hands out slots.
* **Blending**: the finest resident level wins. Within the outer 6% of its window it blends into the next
  coarser level, so streaming in a finer brick causes no pop.
* **Fallback chain**: finest resident → coarser resident → analytic macro SDF.

### 2.3 Streaming (realtime reconstruction, not continuous rebaking)
`src/clipmap/residency.ts` → `update()`:

1. Recompute each level's window base from the camera. If it changed, walk the texels and retire or
   create only the bricks whose index changed (usually one face).
2. Classify up to `STREAM.classifyPerFrame` (256) pending bricks, nearest first.
3. Generate or upload up to `STREAM.generatePerFrame` (24) bricks, nearest first.
   * Edited bricks are restored from the CPU cache instead of being regenerated.
   * If the atlas is full, the farthest resident brick is evicted, but only when the candidate is
     `evictHysteresis` (1.5×) closer.
4. Upload the page table only when it changed.

Nothing is baked per frame unless the camera crosses a brick boundary or an edit happens.

## 3. Precision

* Generation positions are `integer cell index × cell size`. The cell size is a power of two, so
  these are **exact** in float32 (below 2²⁴ cells). Two bricks that share a face evaluate the same
  world point to bit-identical values, so there are no seams.
* Rendering is camera-relative. `uLevelOrigin = brickBase·size − camera` is computed in float64 on the
  CPU and only then cast to float32.
* The macro fallback uses world coordinates in float32. The error is ~0.5 m at 4000 km, acceptable
  for a far field.

## 4. Sculpting (`src/sculpt/brush.ts`, `SCULPT_FS` in `passes.ts`)

Four tools, all written as 1-Lipschitz blends so the field stays usable for sphere tracing:

| Tool | Operation |
|---|---|
| Raise (1) | `mix(d, smin(d, ball), w·a)`, where the ball sits slightly above the surface |
| Lower (2) | `mix(d, smax(d, −ball), w·a)`, where the ball sits slightly below the surface |
| Smooth (3) | `mix(d, avg of sceneSDF at ±offset on 6 axes, w·a)` |
| Flatten (4) | `mix(d, y − targetY, w·a)`, with the target height latched at stroke start |

`w` is a smooth radial falloff. `a` is per-dab strength, `1 − exp(−10·s·dt)`.

**Edit pipeline (two-phase, seam-free):**
1. Every resident brick overlapping the brush is *materialised* at each level whose cell is ≤ 2·radius.
   Uniform bricks in the footprint are promoted to slots.
2. **Phase A**: each brick is evaluated into its own scratch block. It reads the atlas, which is not
   written during this phase, and smoothing reads neighbours through `sceneSDF`, so neighbouring bricks
   compute identical values on their shared faces.
3. **Phase B**: scratch blocks are copied into the atlas slots.
4. The bricks are marked `edited`. When they leave the window or are evicted, their samples are read
   back into a CPU cache (`Map`, about 157 KB per brick as float32). They are restored on return.

Limits: brush radius 1–12 m (so the finest footprint is at most 27 bricks, one scratch batch). Edits
are only allowed inside the finest window minus one brick of margin, which guarantees every level that
contains the edit is resident.

## 5. VRAM budget

| Item | Size |
|---|---|
| Atlas R16F 544 × 544 × 1088 (8192 slots) | 644.0 MB |
| Scratch 34 × 34 × (34·32) R16F | 2.5 MB |
| Page table R16I 16 × 64 × 16 | 32 KB |
| Coastline R16F 2048² | 8.0 MB |
| **Total GPU** | **≈ 655 MB (64 % of 1 GB)** |

CPU RAM: the edit cache holds about 157 KB per edited brick (float32). A few thousand edited bricks fit
comfortably.

Pool sizing is in `src/config.ts`. Raise `POOL.slots` (and `slotsZBlocks`) only while the atlas stays under the 2048-texel
limit of `MAX_3D_TEXTURE_SIZE`.

## 6. Verification status

* `npm run typecheck` (TypeScript, strict): passes.
* `npm test`: 20 Node tests. They cover layout math, the slot pool, the coastline SDF, the macro SDF
  (sign, gradient bound), and the residency manager against a fake GPU. The fake GPU exercises
  toroidal window shifts, budgets, pressure eviction, and edit caching.
* `npm run check:glsl`: compiles all four fragment programs with glslang. It catches syntax, type and
  reserved-word errors.
* **Not verified here**: runtime rendering. The sandbox has no GPU or browser, so the WebGL2 path has
  not been executed. Open the live preview in a browser with WebGL2 and `EXT_color_buffer_float` to test it.

## 7. Known limitations and tuning

* `STREAM.uniformLipschitz` (1.5) is a conservative assumption. If the field's true gradient is steeper,
  thin features can be wrongly classified as uniform. Raise it if you see holes.
* The macro envelope is height-shaped (see §2.1). Heights are stylised: the Highveld and Kilimanjaro are
  lower than reality.
* Readback of edited bricks is synchronous (a GPU stall per evicted edited brick). Picking uses one
  synchronous readPixels per frame while sculpting.
* Edits are held in RAM only. They are not saved to disk.
* Water is a flat, opaque sea plane at y = 0.
* Requires `EXT_color_buffer_float`, `MAX_3D_TEXTURE_SIZE ≥ 2048`, and WebGL2.

## 8. Next steps

1. Measure resident-brick counts on a real GPU, then tune `POOL.slots` and the window size.
2. Replace the 2D envelope with a 3D density, to remove the last height-like term.
3. Persist edits to IndexedDB (the cache already has the right shape).
4. Move the uniform test and the generation to a worker-side GPU queue, or to WebGPU compute, to remove
   the per-slice draw overhead (34 draws per brick).

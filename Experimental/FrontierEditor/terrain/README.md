# Terrain editor (layer stacks)

A terrain editor built on the Frontier Editor UI (`Experimental/FrontierEditor`), open at `/terrain.html`
on the dev server. There is no node graph: the work is done in two **layer stacks**, the way Substance
stacks paint layers.

- **Terrain stack** — heights and water. Categories: *Generators* (fractal noise, ridged mountains),
  *Rugged* (blocky outcrops, strata terraces, sharpened edges), *Erosion* (thermal talus collapse),
  *Water* (rivers, lakes).
- **Texture stack** — colour. Categories: *Base*, *Rock*, *Soil*, *Wetness*, *Snow*, *Detail*.

Every layer has the same settings: enable, opacity, move up/down, delete, its own parameters and a **mask**
(slope range, height range, distance to water for textures, noise breakup, invert). Height layers blend as
`h' = h + (candidate(h) − h) · mask · opacity`, evaluated top to bottom.

## Rivers and lakes

Rivers used to be a painted blue shading over the ground. They are now hydrology:

1. The ground is depression-filled (priority flood), so every cell drains.
2. D8 flow routing and flow accumulation give each cell its catchment.
3. Cells whose catchment is above the river threshold are channels. Each channel bed sits `Channel depth`
   below the ground and never above the downstream bed, so the water grades toward the outlet.
4. Each bank cell takes its nearest channel's bed and width (widths grow with √catchment), and the ground
   is cut down to that bed with a flat floor and feathered banks.
5. Water is drawn **only** where the cut ground sits below the water level. Dry land never takes a water
   tint; the texture stack has no blue on dry cells (checked in `check-terrain.mjs`).

Lakes fill closed basins deeper than *Minimum depth* up to their spill level, with one flat surface per basin.

## Checks

`node terrain/check-terrain.mjs` — pins the behaviour above: rivers lower the ground by about the channel
depth, every wet cell sits below its level, dry cells carry no water, no dry cell is shaded blue, and
disabled layers are fully excluded.

## Not done yet

- Voxel (3-D) representation: the terrain is still a heightfield; the voxel stage comes after the stacks.
- Erosion beyond thermal (hydraulic/stream-power erosion on the stacks) and texture export.
- Evaluation runs on the main thread (about 0.6 s at 160², rises with resolution); a worker is next.

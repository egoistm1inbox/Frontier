# SDF cliff lab (experiment — not part of the Cliff Generator)

Static test bed for **heightfield + local SDF chunks**: the answer to "heightmaps cannot do
overhangs, SDF can, but it must be seamless". Open `index.html` (works via raw.githack).

- `hybrid.js` — pure JS, no Three: procedural heightfield, cliff weight, chunk selection, the
  3D field, marching tetrahedra, heightfield mesh with holes.
- `lab.js` / `index.html` — Three viewer with sliders, compare toggle, chunk tint / bounds.
- `check-seams.mjs` — Node proof: `node check-seams.mjs [key=value …]` reports border
  vertices off the heightfield (must be 0) and unmatched vertices between neighbour chunks.

How the seam is guaranteed (see the header of `hybrid.js`): the field is
`mix(y − h, trueDistance + carve, W)` with a cliff weight `W` that is exactly 0 on every face
towards a non‑chunked cell, so there the field is linear along every voxel edge and marching
tetrahedra puts every iso‑crossing exactly on the heightfield's own piecewise‑linear boundary.
Neighbour chunks share node planes, field and tetra split, so they are watertight as well.

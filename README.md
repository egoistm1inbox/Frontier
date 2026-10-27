# Frontier · Tropical Plant Generator

A procedural tropical plant studio. Every plant — trunk, fronds, each
individual leaflet, blades, nuts, flowers and roots — is generated as **one
single welded quad mesh**: a closed 2-manifold surface with a single
connected component and genus 0 (`V − E + F = 2`). Nothing is intersected,
stacked from separate pieces, or boolean-merged.

![status](https://img.shields.io/badge/mesh-single%20welded%20manifold-34c759)

## How the welding works

Every organ is a tube of rings swept along a spine. When a child organ
(frond, leaflet, nut…) grows from a parent, a rectangular **window** of
`w × h` cells is cut out of the parent's ring grid. The window's boundary
loop has exactly `2(w+h)` vertices, and the child's first ring is built with
exactly that many points, so the two loops stitch together with a collar of
quads — the topology a modeller would build by hand with "extrude branch
from face". The **Topology** tab proves it on every generation: boundary
edges, non-manifold edges, winding consistency, connected components, Euler
characteristic, genus, valence histogram.

## Species library (21)

- **Palms · feather** — Coconut, Royal, Date, Queen, Foxtail, Areca (clumping)
- **Palms · fan** — Mexican Fan (with dead skirt), Chinese Fan, Bismarck (silver), Dwarf Palmetto
- **Banana family** — Banana (with bunch & heart), Bird of Paradise (crane flowers), Traveler's Palm (two-ranked fan), Heliconia
- **Big-leaf plants** — Elephant Ear, Monstera (climbing, split blades), Split-leaf Philodendron, Giant Taro
- **Tropical trees** — Frangipani (with flowers), Umbrella Tree (palmate leaves), Fiddle-leaf Fig

## Features

- Same three-card editor UI as the Frontier tree generator (Library · Viewport · Inspector)
- Botanical controls per habit: trunk form and ring scars, crownshaft, phyllotaxis,
  frond arc, leaflet fold/twist/plume, blade splits and heart lobes, branching, stilt roots
- Flat vertex colour **and** a procedural texture atlas (bark, two leaf-vein systems,
  stem fibre) — toggle between them; both are generated, no image assets
- Display modes: Shaded · Clay (matcap) · Wire (true quad edges) · Organs · Junctions · Wind weights
- Three-tier vertex wind (trunk sway, frond bending about baked pivots, leaflet flutter),
  continuous across every weld because the surface is one piece
- Export **OBJ** (quads preserved + vertex colours) and **GLB** (single primitive,
  colours, atlas UVs, `_WIND`/`_PIVOT` attributes, embedded atlas PNG)
- Deterministic: same species + seed → same plant, every time
- Generation runs in a Web Worker; the heaviest palms are ~350k quad faces

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # topology proof for all 21 species + welder unit tests
npm run typecheck
npm run build
```

## Layout

```
src/core/      math, seeded RNG, value noise
src/tropical/  mesh container · window welder · species params · generators
               topology validator · OBJ/GLB/GPU export · procedural atlas
src/viewer/    three.js viewport, wind shader chunks
src/worker/    generation worker
src/ui/        SolidArc panel CSS + imperative control toolkit
tests/         welder + per-species single-manifold assertions
```

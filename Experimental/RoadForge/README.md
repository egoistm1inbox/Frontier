# RoadForge

A standalone, single-page **WebGPU** procedural **road network generator** — curves in,
one welded quad-dominant road surface out, then textured through a layer stack.

No build step, no dependencies, no node editor. Open `index.html` from any static
server in a WebGPU browser (Chrome/Edge 121+, Safari 18+).

```bash
cd Experimental/RoadForge
python3 -m http.server 8080 --bind 0.0.0.0
# http://localhost:8080
```

---

## Why it is not a "typical" road generator

| Typical generator | RoadForge |
|---|---|
| Road strips laid on top of each other at crossings | One **merged junction surface**: arms are trimmed back, corner fillets are swept between neighbouring kerb stacks, the middle is closed with a quad fan, and every arm end **welds by shared vertices** |
| Triangle soup | **Quad-first topology** — a 90 k–150 k quad mesh with ~0 loose triangles, triangulated only at upload on the shorter diagonal |
| A 150-ray pole in the middle of every intersection | All-quad **2:1 ring reduction bands** step the boundary ring down so the centre pole stays ≤ 34 valence |
| Flat ribbons | Real cross sections: crown/camber, channel, 6-position **kerb stack** (verge → footway → kerb back → kerb top → chamfer → face), hard shoulder, raised median, cycle lanes, parking bays |
| Decals for everything | Modelled speed humps, tables and cushions, excavated construction zones, displaced potholes and rutting |

---

## Workflow

**01 Network** → **02 Texture**, switched from the top bar.

* **Layer stack (top right)** — carriageway classes, topology, surface features,
  furniture, simulation and world layers. Every row has an eye toggle; selecting a
  row fills the inspector.
* **Inspector (bottom right)** — toggles, sliders and segmented choices only.
* **Viewport** — drag to orbit, right-drag to pan, wheel to zoom.
  **Click an intersection** to select it; a translate **gizmo** (X / Y / Z + a planar
  handle) moves the *whole* junction. The affected arms ghost live while you drag and
  the welded mesh rebuilds on release.
* **Texture stage** — each surface (asphalt, footway paving, kerb stone, concrete,
  verge, ballast, setts, metal) owns an ordered stack of procedural layers (base,
  grain, aggregate, cracking, patches, oil, paving pattern, moss, weathering, loose
  stone, brushing, traffic polish) with blend modes, opacity, tint and reordering.
  Layers bake on the GPU to a 512² albedo + packed normal/roughness/AO pair with mips.

Keys: `F` frame · `T` quad topology overlay · `L` lane graph · `M` markings ·
`P` traffic · `G` regenerate · `Esc` deselect.

---

## What is in the scene

* **Roads** — motorway, arterial, city street, residential, service lane, ramp, railway.
* **Junctions** — true `Y`, `+` and multi-arm merges, auto corner radii by class,
  welded two-arm joins, end caps and cul-de-sacs.
* **Markings** — analytically antialiased in the shader: centre lines (single/double/
  dashed), lane dashes, edge lines, stop bars, zebra crossings, turn arrows, chevron
  hatching, cycle lanes, parking bays, yellow waiting lines.
* **Structures** — box-girder viaducts with fascia, soffit, tapered piers, pier caps,
  footings and abutments; trenches with retaining walls; bored tunnels with segmental
  arch bores and portal headwalls; railway trackwork (1435 mm gauge, 620 mm sleeper
  spacing, swept rail sections).
* **Furniture** — swan-neck and twin-mast lighting columns, heritage lanterns,
  mast-arm and post traffic signals with backboards/visors, pedestrian signals,
  four bollard designs, W-beam guardrails and concrete parapets, lit billboards,
  signs, trees, planters, benches, bins, hydrants, parking meters, cones, jersey
  barriers, mesh fencing, works boards, site huts, pipe stacks.
* **Traffic** — up to **25** vehicles on a real lane graph with intelligent-driver-model
  following, spline junction connectors, two-phase signal obedience and a junction
  reservation lock. Trains run the rail alignment on bogies.
* **City blocks** — faces of the planar road graph filled as plazas, verges and courts,
  each edge offset by *that* road's own section. No buildings, by design.

---

## Rendering

Forward renderer, 2 sun-shadow cascades (2048² depth array, texel-snapped) →
4× MSAA `rgba16float` HDR → resolve → tonemap/vignette/grain to the swap chain.

* Clustered punctual lights (64×64 ground grid, 8 slots/cell) — every lamp, signal,
  bollard light, works beacon and (at night) vehicle headlight is a real light.
* PBR surfaces with baked albedo + normal/rough/AO arrays, wetness, fog, sky model.
* Instanced props from a single packed atlas; one contiguous index range per prop type.
* CPU raycast picking (nodes, then edges) — no GPU readback stalls.

---

## Source map

```
index.html            shell markup
styles.css            Frontier design-language stylesheet
src/core/             math, noise, quad-first MeshBuilder + primitives
src/road/             network, classes, profiles, curves, junction solver,
                      sweeper, structures, blocks, generator presets
src/props/            prop library (34 modelled props) + placement rules
src/traffic/          lane graph, signal controller, IDM traffic, trains
src/texture/          layer-stack model + packing
src/gpu/              WGSL shaders, texture baker, WebGPU renderer
src/app/              scene assembly, camera, picking, gizmo
src/ui/               layer stack + inspector, icon set
src/main.js           boot, input, frame loop
```

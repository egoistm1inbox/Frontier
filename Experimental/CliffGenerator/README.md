# Frontier Editor — Terrain generator (experimental, browser)

Procedural terrain generator (mountains, cliffs, river plains, dunes) in the Frontier Editor UI (outliner · viewport ·
inspector cards). It is a plain static page: no bundler, no JSX, Three.js resolves from a CDN
import map, so it runs straight from GitHub via raw.githack, GitHub Pages or any static server.

```
https://raw.githack.com/<owner>/Slate/<branch>/Frontier/Experimental/CliffGenerator/index.html
```

Local preview:

```sh
cd Frontier/Experimental/CliffGenerator
python3 -m http.server 5173 --bind 0.0.0.0     # or: npm install && npm run dev
```

## Representation

The terrain is **heightfield‑based**: a 2‑D grid of heights (128²–2048²) is what the noise,
strata, erosion and river simulation operate on, and what the heightmap / satmap / mask exports
describe. The *rendered mesh* goes further: steep parts are replaced by **true‑3D SDF chunks**
(`src/sdf-chunks.js`, meshed in `src/sdf.worker.js`) — a 3‑D field made of the heightfield
distance plus strata carving (soft beds undercut, hard beds left as lips), polygonised with
marching cubes. The chunk field fades to the plain heightfield over a blend margin and is exactly
`y − h` on every face shared with the heightfield mesh, so iso‑crossings sit on the heightfield's
own border polyline: **no seams, no stitching**. Elsewhere the heightfield mesh is displaced
horizontally (overhangs) and along the normal (detail). The chunks give real undercuts,
overhangs, notches and shelters; caves and arches are possible wherever the carve breaks
through. The isolated proof of the technique lives in `../SdfCliffLab`.

## Pipeline — base shape → noise → erosion → rocks → surface

1. **Base relief** (`src/heightfield.js`) — domain‑warped ridged multifractal with a continental
   mask, optional mesa soft‑clamp and a meandering canyon incision. **Dunes**: transverse ridges
   across the wind with a concave windward slope steepening to a sharp brink, a straight slip
   face at the angle of repose, interdune flats and smaller compound dunes climbing the big ones.
   **Boulder outcrops** (`src/outcrops.js`) — clusters of large core‑stones (tors, woolsacks,
   "encampments") are unioned into the relief *before* strata and erosion: superellipsoid stones
   with a plan rotation, a low‑frequency bulge and a burial depth, in clusters on a site grid
   filtered by slope and biased to ridges / hill tops. They come out as a landform the rest of the
   pipeline weathers — pinned hard, no bedding terraces, no scree skin, no bedding undercuts in
   the 3‑D chunks — and distinct from the scattered rock props.
2. **Strata** (`src/strata-model.js`, Gaea *Stratify*‑style) — one stratigraphic column is shared
   by the terracing, the erosion hardness, the 3‑D cliff carving and the shader, so the beds you
   see are the beds that were carved. The column is a sequence of *packages*: thin‑bedded (mostly
   soft, the odd hard ledge), massive (mostly hard, the odd soft parting) and mixed, each bed with
   its own log‑normal thickness, hardness, tint and optional gradational base; beds thicken and
   thin laterally (an expression evaluated identically in JS and GLSL). The heightfield is terraced
   in the tilted (dip) frame — thin beds step less — and hardness is kept as a map that drives
   everything downstream. **Broken plates**: the column can be cut into Voronoi fault blocks, each
   shifting the frame vertically so beds end at scarps instead of wrapping the tile; the shift
   blends symmetrically at borders so heightfield, chunks and shader always agree on the fault
   line. **Substrata**: secondary bedding inside each bed (fine terraces, lips in the carve, seams
   in the paint). **Lateral drift**: long‑wavelength warp so packages swell, pinch and drift
   across the tile (Gaea *Lateral* mode). All three are pure functions of plan position evaluated
   identically in JS and GLSL (see *Topology* below). In the 3‑D chunks soft beds recede into a
   notch deepest just under the caprock (thin partings a groove, thick soft beds a deep undercut),
   hard beds break along joint sets spaced like their thickness into blocky columns with the
   occasional fallen block, and the shader paints each bed from the same table (hard = pale/clean,
   soft = darker/warmer, plus the bed's tint, laminae and seams).
3. **Rugged outcrops** (`src/rugged.js`, Gaea *Rugged* / *Outcrops* / *Rocky* in one node) —
   shattered Voronoi plates with per‑plate uplift, V crevices along the plate borders, small‑rock
   pockets when fused, and ridged fragmentation detail — masked by patchy coverage, a slope window
   and the erosion hardness (hard caprock by default), then high‑passed so the broad landform keeps
   its shape. It runs *before* erosion, so thermal settling removes spikes, droplets weather the
   plates and drainage adapts to them; exposed plates are pinned hard (like caprock) and shed scree.
   The same plate field is re‑evaluated in the 3‑D chunks (crisp sub‑cell crevice slots the grid
   couldn't hold) and in the shader (crevice shading), so geometry and colour agree.
4. **Erosion** (`src/erosion.js`) — thermal pre‑settle, Lagrangian droplet hydraulic erosion
   (cutting scaled by hardness so cliff bands survive, deposition builds fans), then talus
   slumping with a hardness‑dependent repose angle → scree aprons beneath the faces.
   Outputs: height, deposit, flow (log accumulation), hardness, cavity, slope.
   **Rivers** (`src/hydrology.js`, Gaea‑style): priority‑flood depression filling (sea and tile
   border as outlets), D8 flow routing and accumulation on the eroded surface, channels where the
   catchment exceeds a threshold with width ∝ √catchment, a monotone bed / water profile from the
   outlets upstream, concave beds with sloped banks (chamfer distance from the nearest channel
   cell, the cut fading out towards the bank height instead of leaving a wall), braided gravel
   bars on wide gentle reaches, and lakes where basins fill (partial fill, area cap — the
   biggest/deepest basins first; over the cap a river that ends in a hollow keeps a small pond).
   The bed and water of the nearest channel cell are interpolated along the channel direction
   and the floor smoothed, so a steep river is a ramp, not a staircase of treads. Reaches steeper
   than *Dry above grade* show the carved gully (wet rock, gravel) with no standing water — a
   mountain torrent does not read as flat water — unless the river is big; lake shores are eased
   into a shelving beach. Steep reaches are wide shallow V gullies; inside closed depressions water runs down the
   real floor into the lake instead of in straight lines across the filled flat; a little noise on
   the routing surface breaks the dead‑straight D8 lines smooth slopes produce. The water mesh is
   one continuous sheet with per‑vertex levels (relaxed along the channel) so it follows the
   river's grade. Drawn rivers are *guides*: carved first and injected as flow so the network
   passes through them. Flow and deposit maps pick the network up for shading (wet gullies, gravel
   beds).
5. **Mesh** (`src/terrain-geometry.js`) — indexed grid with alternating diagonals, per‑vertex
   normals and an `aux` attribute `(deposit, flow, hardness, cavity)`; a skirt turns the tile
   into a cut block of ground. **Cliff depth**: steep vertices are displaced horizontally along
   the face normal — hard beds out, soft beds in, plus buttress/alcove noise — so the mesh has
   genuine overhangs, ledges and recesses that the heightfield itself cannot represent.
   **Mesh detail**: the mesh can carry 1–4× the heightfield's vertices (bicubic upsample, side
   capped at 2049) plus fine relief pushed along the surface normal (knobs on steep rock,
   hummocks on flat ground) and **rocky facets** (Gaea *Rocky*‑style: a cellular field of
   joint‑bounded blocks, wider than tall, pushed out of steep *hard* rock while soft beds stay
   smooth; blockiness blends cones into sharp‑edged blocks) — cheap detail on top of the
   expensive erosion. Rocks are seated on
   the final displaced surface. **True‑3D cliffs**: cells steeper than the cliff angle are grouped
   into chunks (16 cells, budgeted), the heightfield mesh skips their quads and masks its
   displacement around them, and a small pool of workers streams marching‑cubes meshes back in
   batches; the chunks use the same world‑space surface shader with `aux` sampled by XZ and hardness
   from the 3‑D strata model (boosted on rugged plates) so beds read correctly on undercut faces.
   Chunks also carve crisp rugged crevice slots along the same plates the heightfield broke, plus
   fine sub‑bed lips from the substrata profile, and sample packed nodal gradients so neighbouring
   chunks evaluate identical fields on shared faces (twin‑matched, watertight). Only the band of
   voxels around the surface is sampled and polygonised; the fine roughness noise and the rugged
   slots are band‑limited to ≥ 5 voxels so they cannot alias into stair‑steps / "pancake" layers;
   the voxel size is either set explicitly or chosen automatically as the finest that fits a voxel
   budget (the HUD shows it).
6. **Rocks** (`src/rock-geometry.js`, `src/rock-placement.js`) — eight archetypes per seed
   (boulder / block / slab / shard): displaced icosphere, anisotropic stretch, then clipped by
   bedding + joint‑set planes, crease‑aware normals. Placement is a plain scatter: jittered
   grid × density × slope window × clustering mask, power‑law sizes, slope‑following tilt and
   embed depth. A second, denser pass scatters up to 40 000 small rounded **stones** on scree
   aprons and river beds (slope‑limited, never on roads or under water) so gravel is real
   geometry up close. Rendered as `InstancedMesh` with per‑instance tone variation and the same
   surface shader.
7. **Surface** (`src/surface-shader.js`) — analytic, world‑space, texture‑free material injected
   into `MeshStandardMaterial` so Three's PBR, shadows, sky environment and fog still apply:
   - strata colour bands with dip, fault‑block offsets, lateral drift, bed + sub‑bed seams,
     rugged crevice shading (same Voronoi plates as the geometry), oxide pockets, aggregate grain
     (3D value noise with analytic gradient);
   - **mineral flakes** — three stacked plate layers composited top‑over‑bottom, each with its
     **own colour** (filled from the rock type, then editable), size (3 cm – 8 m), density,
     plate height (mm; drives tilt + rim bevel in the normal), shape (angular chips → rounded
     grains), tint variation and a **crystal share**: crystal plates are brighter, glossy,
     slightly metallic and carry a view‑dependent sun glint. Each layer can be revealed only on
     hard caprock or only on soft eroded beds (the *hardness* channel), and plates take the
     oxide colour where the *flow* channel and oxide pockets say the rock is weathering;
   - **spalling (“peeling rock”)** — modelled on exfoliating sandstone: irregular fbm‑threshold
     patches where a thin sheet has flaked off, each a shallow step (sheet thickness in metres,
     height + analytic normal) with a bevelled rim, paler fresh rock inside, a second generation
     of smaller spalls and sparse weathering pits. Patches are stretched along bedding on
     vertical faces; no cell networks or concentric contours;
   - cover: runoff staining from the flow map + face streaks, **pebble gravel** on deposits and
     river beds (two generations of domed stones in a sandy matrix, each with its own tone),
     vegetation on gentle ground, moss in concavities, slope‑limited snow above the snow line.
   All layers contribute height **and** an analytic gradient, combined triplanarly into one
   perturbed normal — no finite differences, no texture reads.
8. **Drawn features** (`src/features.js`) — splines and points drawn in the viewport:
   - **rivers** (terrain stage): Catmull‑Rom line → meander → smoothed, monotone‑downhill bed
     profile (flowing from the higher end) → channel carved with sloped banks up to a bank
     height, gorge walls above that. Carved before hydraulic erosion, and a share of the droplets
     start *in* the river carrying extra water, so the water erodes its own bed and the slopes
     drain into it; carved again after slumping so the final bed matches. Outputs a bed mask
     and a water level. Water can be switched off for dried beds (cobbles → silt).
   - **roads** (mesh stage, instant): smoothed grade profile along the spline, flat carriageway,
     cut slopes above / fill embankments below, shoulder verge; proper widths (3.5 m track …
     30 m), computed on the refined mesh grid so a 6 m road is resolved.
   - **lakes** (mesh stage, instant): flood fill from the clicked point up to a level (adjustable
     per lake), flat silt bed below, water surface; off = dried lake bed.
   River / lake water is a mesh built from the water‑level map; the sea is the live level plane.
9. **Lighting** — `Sky` with PMREM environment, shadowed directional sun, exponential fog,
   ACES tone mapping, water plane.

## Topology — keeping the SDF↔heightfield hybrid watertight

Rugged plates and broken strata deliberately push the hybrid hard (fault scarps, crevice slots,
sub‑cell detail), so every operator obeys one contract:

1. **One frame everywhere.** Fault offsets, lateral warp, substrata phase and the rugged plates
   are pure functions of plan position (`plateField`, `lateralWarp`, `subTerrace` in
   `src/strata-model.js`; `ruggedPlates`, `ruggedWarp` in `src/rugged.js`) evaluated identically by
   the heightfield terracing, the SDF carve and the shader. The Voronoi hash is bit‑exact in JS and
   GLSL (`plateHash` / `voronoi2`, mirrored in `surface-shader.js`), plate values blend
   symmetrically so a float‑vs‑double tie‑break cannot tear them, and warp phases use small sine
   arguments so both precisions agree.
2. **The heightfield stays single‑valued.** Terracing (main + sub) is a monotone remap, fault
   offsets are smoothed over ≥1 cell, rugged deltas are bounded and continuous — the grid can hold
   scarps and slots, never folds or tears. Rugged/breaks run *before* erosion and river simulation,
   so thermal settling, droplets and priority‑flood drainage all adapt to them.
3. **The SDF stays continuous and covered.** The carve field is C⁰ everywhere (sub‑bed lip pulses
   are 0 at both wrap ends; plates blend at borders), exactly `y − h` on every outer face (W = 0
   enforced per node), band‑limited to ≥ 5 voxels (rugged slots widen and fade instead of
   aliasing), and every carve term is accounted in `carveReach` so the voxel band covers the
   surface. Neighbouring chunks sample identical nodal gradients, so shared faces twin‑match.
4. **No floating components by construction.** Carve depths are clamped relative to the relief that
   hosts them; the band test (`check-seams-rugged.mjs`) fails the build if any vertex escapes it.

`node scripts/check-seams-rugged.mjs ["Rugged escarpment"] [192] [voxels] [k=v …]` verifies all of
it headlessly: shared‑field continuity/monotonicity, the exact W = 0 outer‑face invariant, border
vertices on the heightfield polyline (≤ 5 mm on a 2 km tile), shared‑face twin matching, and band
coverage — including under extreme settings.

## Controls

Outliner rows map to inspector groups: **Landform / Strata / Rugged / Erosion** rebuild the
heightfield (press *Generate* or Ctrl+Enter; the worker reports progress), **Rocks** re‑scatter automatically,
**Cliff depth** (true‑3D cliffs, displacement, mesh detail) rebuilds the mesh live, and everything
under **Rock material / Mineral flakes / Spalling / Ground cover / Sun & atmosphere / Viewport** is
live. Presets: Alpine granite, Sandstone mesa, Canyon, Sea cliffs, Limestone escarpment, Fjord,
Badlands, Dolomite towers, Desert buttes, Volcanic island, Highland glens, Boulder field, Scree
slopes, Granite domes, Granite tors, Rocky coast, Talus canyon, Rocky mountains, Sand dunes,
Icelandic highlands, Icelandic river plains, Karst pinnacles, Rugged escarpment. **Landform → Dunes** adds transverse
dune fields (height, spacing, wind direction, asymmetry, coverage) to any preset. **Landform →
Boulder outcrops** adds embedded core‑stone clusters (density, boulder size, boulders per cluster,
spread, spacing, height/width, burial, rounding, prefer‑high‑ground, max ground slope) — on by
default in Granite tors, Granite domes, Boulder field and Icelandic highlands.
**Strata → Broken plates / Substrata & lateral** adds fault‑block offsets (offset, block size,
fault width), within‑bed substrata (strength, sub‑beds per bed) and lateral package drift.
**Rugged** shatters the relief into outcrops (amount, plate scale/relief, breakage, coverage,
crevice depth, density, detail octaves, sweep, warp, reverse, seed, slope window, hard‑rock bias) —
all off at 0, so every older preset renders exactly as before. **Cliff depth → Rugged carve** sets
how crisply the 3‑D chunks slot the plate borders.

**Rivers** (*Roads, rivers & lakes → Simulated rivers*): simulate drainage on/off, minimum
catchment, width per √km², max width, depth scale, water fill, braiding, lakes in depressions,
lake fill, lake area cap, minimum lake area, guide flow for drawn rivers. The drawn‑river card still shapes the
guide channels (width, depth, bank angle, bank height, meander, water erosion).

Every texture layer is fully exposed: each has an **enable** toggle, its own **scale**,
**strength** and **colour** controls —

| Group | Layers | Controls |
| --- | --- | --- |
| Rock material | palette → nine editable colour swatches (beds, fresh, oxide, three flake layers, stones); strata; grain; oxide; cavity | bed contrast, band scale, laminae, bed shading, seam darkness/width, caprock tint, grain size/relief/mottle/fineness, oxide amount/scale, cavity shading, bump strength, base roughness |
| Mineral flakes | three plate layers | global: coverage, rim highlight, sheen, crystal glitter, oxidise‑with‑runoff; per layer: enable, colour, plate size, density, plate height (mm), tint variation, shape, crystals, reveal by hardness |
| Spalling | flaked‑off sheets | amount, coverage, patch size, sheet thickness (m), small spalls, weathering pits, follow bedding, fresh contrast, rim shadow |
| Rocks → Gravel stones | instanced small stones | enable, density, largest stone |
| Ground cover | runoff; pebble gravel; vegetation; moss; snow | wetness, face streaks + scale; gravel amount, stone size/relief/variation/colour; vegetation amount, slope limit, patch scale, patchiness, dry grass + three colours; moss amount/scale/colour; snow line, slope limit, transition, roughness, colour |

Picking a rock type fills the colour swatches; they can be edited freely afterwards.

**Drawing**: the toolbar over the viewport (or *Roads, rivers & lakes → Draw*) has Road / River /
Lake. Click points on the terrain; Enter or double‑click finishes a spline, Backspace removes the
last point, Esc cancels; a lake is one click. Drawn features are listed in the inspector with
delete buttons and per‑lake level sliders, persist with the settings, and survive preset changes.
**Water** (own outliner row) has the live sea‑level slider, colour, opacity, shoreline wetness and
the dried‑bed toggles.

**Viewport → Isolate layer** renders a single layer on its own (Strata / Grain / Flakes / Spalls /
Pebbles / Cover / Masks / Features) so each pattern and its scale can be judged before tuning it.

Exports (all maps share the heightmap's top‑down frame): OBJ / GLB (displaced terrain block +
all rock instances), 16‑bit packed heightmap PNG, **satmap** PNG (top‑down lit colour render at
2048², rocks and shadows included, same exposure/ACES chain as the viewport), splat masks PNG
(R rock · G scree · B wetness · A hardness), normal map PNG, viewport screenshot. Settings persist
in `localStorage`.

## Checks

```sh
node scripts/check-generate.mjs "Sandstone mesa" 256   # headless pipeline run + ASCII preview
node scripts/check-params.mjs                          # inspector wiring: controls ↔ defaults ↔ icons ↔ presets
node scripts/check-seams-rugged.mjs "Rugged escarpment" 192  # hybrid topology: W invariant, border
                                                       # polylines, shared-face twins, band coverage
node scripts/check-shader.mjs /path/to/glslangValidator # assembles the injected shader exactly as
                                                        # Three does and validates GLSL ES 3.00
```

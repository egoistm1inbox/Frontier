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
   **Rugged outcrops** (`src/rugged.js`, Gaea *Rugged / Outcrops*‑style) — a heightfield can only
   move up and down, so the steep faces of the base shape are also pushed and pulled **sideways**:
   every steep cell re‑samples the terrain from a point displaced along the face's own horizontal
   normal by a blocky multi‑octave noise (3‑D coarse blocks turned into plateaus and risers, finer
   blocks on top), so buttresses stand proud of the face where the noise is positive and recesses
   / chimneys are cut back where it is negative, with a vertical share so the blocks also step
   up and down as ledges. The slope mask is blurred so a whole buttress moves as one piece and
   flat ground (valleys, rivers, plains) is never displaced. Applied to the base shape and again,
   finer, after erosion (which smears lateral structure) — the hardness and boulder maps ride along
   with the faces. Controls: push–pull distance, block scale, blockiness, levels, ledges, slope
   threshold, after‑erosion share. The 3‑D cliff chunks carry the same idea into true 3‑D
   (*Cliff depth → 3D push–pull*): a blocky noise that varies with height pushes buttresses out
   of the carved face and cuts recesses back into it, so a block can overhang the recess below it
   — real XZ push–pull with overhangs, not just contour wiggles. **Escarpment** (*Landform →
   Mesa & canyon → Escarpment*): a near‑vertical cliff line along the edge of the massif — the
   high side is lifted onto a bench within a cell or two along a smoothed version of the
   continental mask (long headlands and bays), with optional *Stacks* — pillars of the former cliff left standing just off the line — then pushed and pulled in plan by the rugged stage;
   this is the base of the *Coastal cliffs* and *Quarry walls* presets. In the 3‑D chunks
   (*Cliff depth → True‑3D cliffs*) **Vertical wall** shears such a face in the SDF: the height
   sample of every point is taken at a plan position shifted along the local uphill direction by
   (t − ½)·W·vertical, t = position between the local foot and crest, W = plan width of the
   face in the heightfield (crest − foot over the face slope) — so the crest moves out, the foot
   moves in, and at 1 a back‑leaning / slope becomes a | wall, above 1 it overhangs ( \ / ). The
   strata are still looked up at the true position, so the beds stay horizontal across the sheared
   wall, and the shear fades to nothing where the chunk weight fades, so the seam to the heightfield
   is untouched. The band is wider (the whole foot…crest column is polygonised) so it costs more
   voxels. *Lean* additionally cuts the face back progressively from crest to foot (undercut).
   **Rock blocks** (*Cliff depth → True‑3D cliffs → Rock blocks / Rock block size / Missing
   blocks*) turn the face into a wall of discrete rock blocks in the SDF itself: the bed rows of
   the strata model × two vertical joint families (world‑aligned planes, resized and staggered
   bed to bed like brickwork). Every block stands proud of or sits back from the face by its own
   amount, with its own slight tilt and its own rounding of the rim, every block boundary is a
   crack groove and a share of the blocks have fallen out, leaving deep recesses; soft beds
   weather smooth, hard beds break into blocks; a joint family parallel to the face is blended
   away (it would only show as spurious lines). This is geometry — rocks and cracks you can look
   along, not a shading trick — so blocks have to be at least ~3 voxels wide: the cliff presets use
   a 1 km world (1 m voxels at 512²); raise *Voxel budget* or lower the world size for finer
   blocks. **Cliff protection** (*Erosion → Fluvial incision → Cliff protection*): faces steeper
   than the protection angle keep their pre‑erosion shape through every erosion stage, so the
   plateau above a sea cliff or quarry wall can be eroded into a real landscape — valleys, rills,
   streams that simply hang at the crest — while the wall stays a wall.
   **Rock stacks** (*Landform → Rock stacks (Gaea Stacks)*): tiered rock towers in the manner of
   Gaea's Stacks node — a mask (a smooth union of warped discs around jittered feature points) is
   thresholded at a rising level per tier, so every tier sits inside the one below; each tier has
   its own thickness, edge width and, under *Chaos*, its own plan offset and outline wobble, so
   the pile leans and steps irregularly instead of a wedding cake. *Spires* shrinks the cells and
   discs towards isolated hoodoos, *Taper* goes from straight towers to stepped pyramids, a talus
   *Pedestal* ramps up to the lowest tier. Three controls keep the *scatter* organic instead of a grid: *Size spread* draws
   size and height from a heavy‑tailed distribution (a few anchor towers among many small ones), *Elongation*
   stretches each stack's plan along its own direction into ridges and fins, *Clustering* lets a cell hold a tight
   group of stacks and leaves others bare, so neighbours touch and fuse into compounds — and every stack gets its
   own height, taper, outline roundness and lean direction, with the whole mask warped at two scales. Two experimental presets: *Desert stacks* (red sandstone
   buttes and spires under normal erosion — fluted walls, talus skirts) and *Stack cliffs* (the
   same towers treated like the quarry / coastal walls: cliff protection, vertical sheared walls,
   rock blocks). **Joint‑set domains** keep the walls from reading as one pattern: the face is split into coarse
   panels and each panel gets its own block size, block depth and grid phase, the way a real cliff shows patches of
   massive slabs beside closely jointed ones instead of one wallpaper over every wall in the world. **Jointing** (*Rock material → Jointing*, shader): two vertical joint sets (families
   of warped planes spaced like the bed thickness, staggered bed to bed like brickwork) and the
   bedding planes break the face into blocks — each joint with its own width, some missing, each
   block with its own slight tilt and tone, grooves with normal and occlusion — the cracked, blocky
   rock face of a quarry wall or a sea cliff; a joint family parallel to the face is invisible.
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
   everything downstream. In the 3‑D chunks soft beds recede into a notch deepest just under the
   caprock (thin partings a groove, thick soft beds a deep undercut), hard beds break along joint
   sets spaced like their thickness into blocky columns with the occasional fallen block, and the
   shader paints each bed from the same table (hard = pale/clean, soft = darker/warmer, plus the
   bed's tint, laminae and seams).
3. **Fluvial incision** (`src/fluvial.js`) — the stream‑power model ∂h/∂t = U − K·A^m·S + D∇²h
   that gives real terrain its dendritic valleys. Rivers cut down in proportion to the water they
   gather (drainage area A) and their slope, resistant beds lower K (knickpoints, benches),
   hillslopes diffuse towards the channels and the massifs are uplifted a little so the relief
   stays high while the valleys deepen. Solved with the Braun–Willett implicit scheme (cells
   processed from the outlets upwards, closed form per cell, unconditionally stable) over a few
   dozen long steps, re‑routing the water (priority‑flood fill + D8) every step. **Sedimentation**:
   what the rivers cut is carried downstream (donors before receivers) and dropped wherever the
   flux exceeds the transport capacity ∝ A^m·S — alluvial fans where slopes flatten, valley
   fills, deltas and basin floors; the deposited thickness becomes an *alluvium* map: the
   surface paints it as silt / sand with some gravel, and the rivers widen and braid on it
   (shifting bars in a gravel belt) the way a loaded river does on its own fan. Closed basins
   silt up towards their spill level (*Basin fill*) so they become valley floors drained by a
   river — standing‑water lakes are off by default (*Lakes in depressions* turns them back on); after the droplet erosion, hollows shallower than
   *Silt up pits* are filled so the sediment fans do not dam the valleys into chains of ponds.
   The simulated rivers then run in valleys they shaped themselves instead of being carved into an
   unrelated surface. After the droplet erosion a **rill** pass (same solver, low area exponent,
   noisy routing, no fill) cuts the fine converging flow lines that cover eroded slopes — the
   flow texture of Gaea's Erosion node — and its drainage area is the wet‑line flow map; the
   strata are then **re‑cut** (lighter) on the eroded surface so the ledges stay crisp.
4. **Erosion** (`src/erosion.js`) — thermal pre‑settle, Lagrangian droplet hydraulic erosion
   (cutting scaled by hardness so cliff bands survive, deposition builds fans), then talus
   slumping with a hardness‑dependent repose angle → scree aprons beneath the faces.
   Outputs: height, deposit, flow (log accumulation), hardness, cavity, slope.
   **Rivers** (`src/hydrology.js`, Gaea‑style): priority‑flood depression filling (sea and tile
   border as outlets), D8 flow routing and accumulation on the eroded surface, channels where the
   catchment exceeds a threshold with width ∝ √catchment, a monotone bed / water profile from the
   outlets upstream, concave beds with sloped banks, braided gravel bars on wide gentle reaches,
   and lakes where basins fill. The channel is cut around a **smoothed centreline**: the D8 path
   is a staircase of cell centres, so each channel cell's position is averaged along its stream
   (main donor ← cell → receivers, stopping where it joins a much bigger river) and the bed is
   rasterised segment by segment as distance to that polyline — meanders are smooth curves,
   junctions are owned by the trunk, and a dry gully can never punch a hole in the water beside
   its mouth. Channels are narrow (≈ 22 m per √km² by default, capped at 80 m); the braid belt
   only widens a loaded reach by half. Beside a stream of any size a **floodplain** (*Floodplain*,
   in channel widths) planes ground that is not much higher than the water down to a gently
   rising flat — the river valley of a mature stream — while mountainsides above it are left
   alone. Water that is flowing stays wet downstream; only the ephemeral headwater gullies are
   dry. **Water is painted, not meshed, by default** (*Water as meshes* off, Gaea‑style): the
   surface shader colours everything under the water line with the river colour (clear tint over
   the bed in the shallows, full colour where it is deep), flattens the normal and lowers the
   roughness, so the terrain stays dry geometry with the water as a mask — exactly what the
   mask/satmap exports carry. The painted level is a *continuous* per‑vertex field (extrapolated
   outwards from the wet cells, falling away with distance) rather than the simulation's dry
   sentinel, so the shoreline is a clean line through the triangles instead of a cell‑by‑cell
   checkerboard. Turning *Water as meshes* on brings back the sea plane and the river / lake
   sheets. Painted water also follows the *Sea* switch: with it off the terrain stays dry even where a
   basin closed or a lake was drawn, so a desert landform cannot inherit water from an earlier wet setting. **Bank gullying** (*Rivers → Bank gullying*): after the channels are cut, runoff off
   the valley sides converges on the river and erodes small gullies into the soft bank material
   (fine‑scale rills masked to the banks, never below the water line) — the soil erosion a river
   valley shows on its flanks. Lakes are where basins fill (partial fill, area cap — the
   biggest/deepest basins first; over the cap a river that ends in a hollow keeps a small pond).
   Lakes are judged on the real surface, only basins large *and* deep enough qualify, the basin
   floor and the rim outside the water line are smoothed (sediment floor, wave‑worked shore) and
   the water area is morphologically opened, so the outline is a clean curve rather than the
   cell‑by‑cell contour of droplet deposits. River and lake water has its own material
   (`src/water-material.js`): per‑vertex depth makes the shallows clear (bed and gravel bars show
   through) and only deeper water takes the water colour, so shores fade in instead of ending in
   a hard dark edge; where the water surface drops steeply (rapids, falls) it turns to white water.
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
   smooth; blockiness blends cones into sharp‑edged blocks) and **crags** (larger joint‑bounded
   blocks, each protruding or set back by its own amount, so a face is a stack of rugged masses
   rather than a plane) — cheap detail on top of the expensive erosion. The same detail functions
   (`src/detail.js`) are evaluated in 3‑D on the SDF chunk faces (feature size clamped to
   ≥ 2.5 voxels), so cliffs are as rugged as the mesh around them and the seam stays continuous.
   Rocks are seated on
   the final displaced surface. **True‑3D cliffs**: cells steeper than the cliff angle are grouped
   into chunks (16 cells, budgeted), the heightfield mesh skips their quads and masks its
   displacement around them, and a small pool of workers streams marching‑cubes meshes back in
   batches; the chunks use the same world‑space surface shader with `aux` sampled by XZ and hardness
   from the 3‑D strata model so beds read correctly on undercut faces. Only the band of voxels
   around the surface is sampled and polygonised; the fine roughness noise is band‑limited to ≥ 5
   voxels so it cannot alias into stair‑steps / "pancake" layers; the voxel size is either set
   The face is a *sheet*, so a wall has to be sampled from its foot to its crest — that, not the
   triangulation, is what costs: per chunk most of the time goes into the carving of each voxel
   (bedding, joints, blocks, relief). Two things keep it down: the sampled y‑band of a column is
   limited to where a carve can actually flip the sign, and everything that depends only on the
   plan position and the bed (joint lattice, block offsets, hashes) is computed once per bed and
   reused for every voxel of that bed. Chunks are built in a pool of workers (up to 8, one less
   than `hardwareConcurrency`) and streamed into the scene as they finish, so the terrain is
   interactive while the walls come in.
   explicitly or chosen automatically as the finest that fits a voxel budget (the HUD shows it).
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
   - strata colour bands with dip, bed seams, oxide pockets, aggregate grain (3D value noise
     with analytic gradient);
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
     **soil** — the regolith between the outcrops: gathers on gentle, soft, concave ground and on
     every deposit while hard convex knolls and ribs stay rock; clods and grit give it its own
     grain and micro‑relief, it darkens where it is damp (flow lines, the ground just above the
     water) and in hollows, and fluvial alluvium (floodplains, fans, silted basins) is painted on
     it as paler silt / sand — vegetation on gentle ground, moss in concavities, slope‑limited
     snow above the snow line.
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
   Water is painted onto the surface by default (see *Rivers* above); with *Water → Water as
   meshes* on, river / lake water is a mesh built from the water‑level map and the sea is the
   live level plane.
8. **Lighting** — `Sky` with PMREM environment, shadowed directional sun, exponential fog,
   ACES tone mapping, water plane.

## Controls

Outliner rows map to inspector groups: **Landform / Strata / Erosion** rebuild the heightfield
(press *Generate* or Ctrl+Enter; the worker reports progress), **Rocks** re‑scatter automatically,
**Cliff depth** (true‑3D cliffs, displacement, mesh detail) rebuilds the mesh live, and everything
under **Rock material / Mineral flakes / Spalling / Ground cover / Sun & atmosphere / Viewport** is
live. Presets: Alpine granite, Sandstone mesa, Canyon, Sea cliffs, Coastal cliffs, Quarry walls, Desert stacks, Stack cliffs, Limestone escarpment, Fjord,
Badlands, Dolomite towers, Desert buttes, Volcanic island, Highland glens, Boulder field, Scree
slopes, Granite domes, Granite tors, Rocky coast, Talus canyon, Rocky mountains, Sand dunes,
Icelandic highlands, Icelandic river plains, Himalayan peaks, Alpine peaks, Karst pinnacles. **Landform → Dunes** adds transverse
dune fields (height, spacing, wind direction, asymmetry, coverage) to any preset. **Landform →
Boulder outcrops** adds embedded core‑stone clusters (density, boulder size, boulders per cluster,
spread, spacing, height/width, burial, rounding, prefer‑high‑ground, max ground slope) — on by
default in Granite tors, Granite domes, Boulder field and Icelandic highlands.

**Rivers** (*Roads, rivers & lakes → Simulated rivers*): simulate drainage on/off, minimum
catchment, width per √km², max width, floodplain, bank gullying (+ steps), depth scale, water
fill, braiding, lakes in depressions, lake fill, lake area cap, minimum lake area, guide flow for
drawn rivers. The drawn‑river card still shapes the
guide channels (width, depth, bank angle, bank height, meander, water erosion).

Every texture layer is fully exposed: each has an **enable** toggle, its own **scale**,
**strength** and **colour** controls —

| Group | Layers | Controls |
| --- | --- | --- |
| Rock material | palette → nine editable colour swatches (beds, fresh, oxide, three flake layers, stones); strata; grain; oxide; cavity | bed contrast, band scale, laminae, bed shading, seam darkness/width, caprock tint, grain size/relief/mottle/fineness, oxide amount/scale, cavity shading, bump strength, base roughness |
| Mineral flakes | three plate layers | global: coverage, rim highlight, sheen, crystal glitter, oxidise‑with‑runoff; per layer: enable, colour, plate size, density, plate height (mm), tint variation, shape, crystals, reveal by hardness |
| Spalling | flaked‑off sheets | amount, coverage, patch size, sheet thickness (m), small spalls, weathering pits, follow bedding, fresh contrast, rim shadow |
| Rocks → Gravel stones | instanced small stones | enable, density, largest stone |
| Ground cover | runoff; pebble gravel; soil; vegetation; moss; snow | wetness, face streaks + scale; gravel amount, stone size/relief/variation/colour; soil cover, slope limit, clods & grit, moisture, alluvium + two colours; vegetation amount, slope limit, patch scale, patchiness, dry grass + three colours; moss amount/scale/colour; snow line, slope limit, transition, roughness, colour |

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
node scripts/check-shader.mjs /path/to/glslangValidator # assembles the injected shader exactly as
                                                        # Three does and validates GLSL ES 3.00
```

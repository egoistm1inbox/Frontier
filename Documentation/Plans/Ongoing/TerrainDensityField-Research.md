# Terrain Density Field — Research

TL;DR — Replace the heightfield with a **sparse signed-density field** (one scalar ρ per point in 3D,
ρ > 0 solid). Author it with a **layer stack** (ordered strata, each with blend mode + mask stack —
the node graph linearized, exactly as requested). Extract the surface with **Dual Contouring**
(sharp cliffs) and store the field as **NanoVDB narrow-band bricks** (heightmap-class memory, not
dense-voxel memory). Erode and flood with **2.5D shallow-water simulation** projected onto the
extracted surface. Every heightmap workflow (fractal ranges, erosion masks, splats) survives as a
special case of the field; caves, arches, spires, overhangs and true vertical cliffs become native.

- Status: research complete, validation executed — see `Exhibits/TerrainDensityValidation/`
- Companion plan: `Documentation/Plans/Ongoing/TerrainDensityField-Plan.md`
- API specification: `Engine/Terrain/` (C++20 headers) + `UI/Editor/TerrainWorkspacePanel.h`
- Working prototype: `Experimental/TerrainLayerStack/` (live preview)

## 1. Why the heightfield cannot do this job

A heightfield stores one elevation H(x, z) per plan position. The surface is the graph of a function,
so every vertical column crosses it **exactly once**. That single fact forbids, by construction:

| Required feature (AAA brief) | Heightfield               | 3D density field ρ(x, y, z) |
| ---                          | ---                       | ---                         |
| Cave / tunnel / mine path    | 🔴 impossible             | ✔️ carve ρ < 0 along a spline |
| Rock arch / natural bridge   | 🔴 impossible             | ✔️ union a torus/tube field |
| Overhanging cliff            | 🔴 impossible             | ✔️ domain-warp the field in y |
| True vertical cliff          | 🚩 stretched texels only  | ✔️ surface normal ⊥ gravity is normal geometry |
| Spire / hoodoo / outcrop     | 🚩 cone artifact          | ✔️ stamp primitive fields     |
| Multiple surfaces per column | 🔴 impossible             | ✔️ any number of ρ = 0 crossings |
| Alpine ridges, valleys       | ✔️ native                 | ✔️ H(x, z) − y is one layer |
| Erosion (hydraulic/thermal)  | ✔️ native (2D grid)        | ✔️ same solvers, projected (§6) |
| Memory at world scale        | ✔️ O(n²)                  | ✔️ O(surface) sparse (§3)     |

📝 The migration is one line of mathematics. A heightfield **is** a density field:

```text
ρ(x, y, z) = H(x, z) − y        ρ > 0 below the surface (solid), ρ < 0 above (air), ρ = 0 on it
```

Every existing heightmap tool (Gaea / World Machine style fractals, filters, erosion, masks) keeps
working by authoring H and folding it into ρ. The volumetric layers (carves, warps, stamps) then
add what H alone cannot say. This is the established "density function" formulation of GPU terrain
(NVIDIA GPU Gems 3, ch. 1) and the SDF formulation used by production smooth-voxel engines
[12](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-1-generating-complex-procedural-terrains-using-gpu)
[5](https://voxel-tools.readthedocs.io/en/latest/smooth_terrain/).

## 2. Decision — field representation

Ratings per `SKILL-Emoji.md` §5. **Accuracy: 🔴 = best** (for Cost/VRAM, 🔴 = most).

| Option                      | Overhangs | Sharp cliffs | VRAM | Edit cost | Quality   | Rank   |
| ---                         | ---       | ---          | ---  | ---       | ---       | ---    |
| Sparse SDF/density (chosen) | ✔️        | ✔️           | 🚩   | 🚩        | ⭐⭐⭐⭐⭐ | 🥇 🏆  |
| Heightfield + SDF insets    | 🚩 inset only | ✔️ inset  | ✔️   | 🚩        | ⭐⭐⭐⭐  | 🥈     |
| Dense voxel grid            | ✔️        | 🚩           | 🔴   | ✔️        | ⭐⭐⭐    | 🥉     |
| Heightfield only            | 🔴        | 🔴           | ✔️   | ✔️        | ⭐⭐      | 🏁     |
| Direct polygon sculpting    | ✔️        | ✔️           | 🚩   | 🔴        | ⭐⭐⭐    | 🏁     |

⭐ **Recommendation: sparse signed-density** — the only row that satisfies caves + cliffs + erosion +
world scale simultaneously. Heightfield+SDF-inset hybrids are the usual fallback
[3](https://app.cinevva.com/guides/landscape-generation-browser); a pure field subsumes them, because
a chunk whose field is exactly H − y costs and behaves like a heightfield chunk (§3.4).

💡 Independent confirmation: Unreal Engine 5.8's experimental Mesh Terrain abandons heightfields for
a **non-destructive modifier (layer) stack** over partitioned geometry to get caves, overhangs and
sheer cliffs [6](https://dev.epicgames.com/documentation/unreal-engine/mesh-terrain-in-unreal-engine?lang=en-US)
[1](https://www.projprod.com/post/mesh-terrain-unreal-engine-5-8). The Frontier design below follows
the same conclusion, but keeps the **field** (not raw polygons) as the document of truth — which is
what makes erosion, re-extraction at any LOD, and robust CSG possible. Epic itself marks Mesh
Terrain experimental and not production-ready in 5.8
[4](https://daily.dev/posts/how-to-use-unreal-engine-s-new-landscape-system---mesh-terrain-tutorial-mwizhzoiq);
a field document avoids its topology-editing failure modes.

## 3. Storage — why "voxel" does not mean dense, and the memory proof

### 3.1 The numbers that force sparsity

Reference world: 8 km × 8 km plan, 1 km vertical extent. Sizes are density samples only,
half precision (2 B), no materials, no mips.

| Layout                        | Cell size | Samples        | Bytes      | Verdict              |
| ---                           | ---       | ---            | ---        | ---                  |
| Dense grid                    | 0.5 m     | 5.12 × 10¹¹    | ≈ 1.0 TB   | 🔴 40× a flagship GPU's VRAM |
| Dense grid                    | 2 m       | 8.0 × 10⁹      | 16 GB      | 🔴 no detail, still huge |
| Dense grid                    | 8 m       | 1.25 × 10⁸     | 250 MB     | 🔴 unusable fidelity |
| Heightfield (16-bit)          | 0.5 m     | 2.56 × 10⁸     | 512 MB     | 🚩 the bar to match  |
| Heightfield (16-bit)          | 1 m       | 6.4 × 10⁷      | 128 MB     | ✔️ shipped standard  |
| **Narrow-band sparse bricks** | **2 m base** | **≈ 9.6 × 10⁷** | **≈ 290 MB** | 🟢 whole world, streamable |
| **Punch-in ring (resident)**  | **0.5 m, r = 512 m** | **≈ 2.5 × 10⁷** | **≈ 100 MB** | 🟢 near-field fidelity |

Narrow-band estimate: terrain surface cells ≈ (8000 / 2)² = 1.6 × 10⁷; store a ±3-cell band around
the ρ = 0 surface (6 samples per surface cell) at 3 B average (half density + packed material index),
plus brick-directory overhead. Air far above and rock far below store **nothing** — tile values
carry them. The field is a surface-hugging shell, so cost scales with surface area O(n²), exactly
like a heightmap, with a constant factor of roughly 2–4×. That is the "same fidelity as heightmap"
property: at equal memory you get equal-or-better surface resolution, plus arbitrary topology.

### 3.2 The container: VDB topology, bricks of 32³

- OpenVDB's B+tree (root → internal 32³/16³ → leaf 8³) is the production-proven sparse volume
  structure; inactive voxels cost one bit, constant regions collapse to tile values
  [2](https://www.openvdb.org/documentation/doxygen/overview.html).
- NanoVDB is its pointer-free, GPU-resident snapshot: one contiguous buffer, random access from
  compute shaders, 4–6× in-core compression by quantised values with dithering
  [12](https://dl.acm.org/doi/fullHtml/10.1145/3450623.3464653)
  [3](https://developer.nvidia.com/blog/accelerating-openvdb-on-gpus-with-nanovdb/).
- Frontier authoring form: `DensityBrickAtlas` — a hash directory of 32³ bricks (the same
  topology, Frontier-owned code, no external dependency), each brick one of
  `ConstantAir`, `ConstantSolid`, `NarrowBand` (dense 32³ half + packed material), or
  `Analytic` (re-evaluate the layer stack on demand, §5.3). Cooked form: the identical directory
  flattened into one GPU buffer in the NanoVDB manner.
- Material identity rides with the field: one packed `MaterialIndex`+weight set per narrow-band
  sample (top-2 materials + blend), so caves and cliff faces carry their own rock, not a projection.

### 3.3 Resolution policy (fidelity is a setting, never a constant)

| Tier | Cell size | Extent              | Purpose                                   |
| ---  | ---       | ---                 | ---                                       |
| 0    | 8 m       | whole world         | far silhouette, minimap, water solve grid |
| 1    | 2 m       | whole world         | base playable surface, physics proxy      |
| 2    | 0.5 m     | camera ring ≈ 1 km  | gameplay-fidelity cliffs/caves            |
| 3    | 0.125 m   | hero insets (painted) | sculpted outcrops, cave dressing        |

Cell sizes are `TerrainWorldConfiguration` values in the document (TOML), not literals — the brief's
"no hardcoded values" is satisfied by construction: every physical and geometric quantity in
`Engine/Terrain/` is a named, unit-tagged, user-editable configuration field (§7).

### 3.4 Heightfield degenerate case

A brick whose strata contain no volumetric operation is flagged `HeightfieldEquivalent`: it stores
H only (2 B/cell in plan), evaluates ρ = H − y analytically, and extracts through the fast 2.5D path.
Flat plains therefore never pay volumetric cost; cost appears exactly where topology appears.

## 4. Surface extraction — getting polygons out of ρ

| Algorithm        | Sharp features        | Watertight | LOD stitching        | Cost | Rank  |
| ---              | ---                   | ---        | ---                  | ---  | ---   |
| Dual Contouring  | ✔️ Hermite + QEF       | ⚠️ needs care | octree-native + skirts | 🚩 | 🥇 🏆 |
| Transvoxel (MC+) | 🔴 rounds cliffs       | ✔️         | ✔️ transition cells  | ✔️   | 🥈    |
| Marching Cubes   | 🔴 rounds cliffs       | ✔️         | 🔴 cracks            | ✔️   | 🥉    |
| Surface Nets     | 🔴 rounds cliffs       | ✔️         | 🚩                   | ✔️   | 🏁    |

⭐ **Recommendation: Dual Contouring of Hermite data** (Ju et al., SIGGRAPH 2002). One vertex per
sign-changing cell, placed by minimising a Quadratic Error Function over the edge-crossing points
and their normals (∇ρ). It is the standard choice where cliff edges and rock corners must survive —
Marching Cubes places vertices on grid edges and rounds every sharp feature
[2](https://app.cinevva.com/guides/terrain-sculpting-brushes)
[6](https://app.cinevva.com/guides/landscape-generation-browser)
[19](https://gamedev.stackexchange.com/questions/66711/marching-cubes-and-lod).

- Normals come free: analytic layers supply ∇ρ; baked bricks use central differences.
- QEF solve: 3×3 SVD per cell, clamped to the cell (the clamp is a configuration tolerance).
- Non-manifold guard: cells whose QEF is near-singular fall back to the mass point (Surface Nets
  position); ambiguous sign configurations use the asymptotic decider. Known Dual Contouring
  hazards (non-manifold output, inter-cell dependency) are documented trade-offs
  [7](https://github.com/Zylann/godot_voxel/issues/24); both are contained by the clamp + fallback.
- LOD: octree Dual Contouring generates crack-free seams between neighbouring resolutions when seam
  cells are evaluated jointly [3](http://ngildea.blogspot.com/2014/09/dual-contouring-chunked-terrain.html);
  Frontier additionally drops a one-cell skirt ring per chunk as insurance. Transvoxel transition
  cells remain the fallback if a future chunk must interop with Marching Cubes output
  [5](https://transvoxel.org/).
- Extraction runs **per dirty brick** on the GPU (Slang compute) or CPU thread pool; only edited
  regions re-extract. The document (field) is never destroyed by extraction — any LOD can be
  regenerated at any time, which polygon-document systems cannot do.

## 5. Authoring — the layer stack (node graph, linearized)

### 5.1 Why a stack is *the same thing* as the node graph

A Gaea/World Machine graph is a DAG of field operations
[3](https://www.tripo3d.ai/blog/best-3d-terrain-generators-for-game-development)
[20](https://docs.gaea.app/reference/index.html). Terrain DAGs are in practice near-linear: a main
spine (primitive → modify → erode → derive → texture) with side branches that exist only to be
consumed as **masks** or **secondary inputs**. The stack keeps the spine and renames the branches:

| Node-graph concept              | Layer-stack equivalent (this design)              |
| ---                             | ---                                               |
| Node on the main spine          | One **stratum** (layer row), evaluated top → bottom |
| Node type                       | **Operation dropdown** on the row (§5.2 catalogue) |
| Wire from a side branch         | **Named channel** published by an earlier stratum, picked from a dropdown |
| Mask input pin                  | The stratum's **mask stack** (sub-rows, each its own operation + invert + strength) |
| Node parameters                 | Inspector fields (all data-driven, unit-tagged)   |
| Mute / bypass                   | Stratum visibility toggle                         |
| Group / frame                   | Stratum folder (collapsible, opacity of its own)  |
| Output node                     | Output stratum (extraction / bake / export)       |

Evaluation rule (the whole semantics in one paragraph): strata evaluate in stack order over the
running field ρ. Each stratum computes its own candidate field (or channel), combines it into ρ
through its **blend mode** (Replace, Add, Subtract, Minimum, Maximum, SmoothUnion, SmoothCarve,
MaskedBlend), modulated by **Opacity × Mask**, where Mask is itself a mini-stack of mask strata.
Any stratum may **publish** its result (or a derived quantity) under a name; later strata reference
that name from a dropdown wherever a field/mask input is expected. Nothing is lost versus the DAG;
cycles were never legal there either.

### 5.2 Operation catalogue (the dropdown contents)

Grouped exactly as the UI dropdown groups them. Every operation declares its parameters, the channel
types it reads, and the channel it writes; the inspector is generated from these declarations —
adding an operation never touches UI code.

| Group     | Operations (dropdown entries) |
| ---       | --- |
| Primitive | ElevationProfile (2D fractal → H − y) · FractalField3D · RidgedField · BillowField · CellularField (Voronoi F1/F2) · DistancePrimitive (sphere/box/capsule/torus/cone) · SplineTube (cave/river/path tube) · PolygonSurfaceImport (mesh → narrow-band field) · HeightTextureImport · ConstantField |
| Combine   | SmoothUnion · SmoothIntersection · SmoothCarve · MaskedBlend · AddField · SubtractField · ScaleField · MinimumField · MaximumField · CurveRemap · TerraceQuantize |
| Warp      | DomainWarpNoise · DomainWarpCurve (overhang lean profile) · DomainOffset · DomainRotateScale · StrataFolding (fold field for real geology, §8) |
| Mask      | ElevationSelect · SlopeSelect · CurvatureSelect · FlowSelect · DistanceToWaterSelect · TextureMask · PaintedMask · ChannelMask · InvertMask · BlurMask · ErodeDilateMask |
| Simulate  | ShallowWaterErosion · DropletErosion (offline quality) · ThermalWeathering (talus) · WindDeposition · SnowAccumulation · WaterBodySolve (§6) |
| Sculpt    | SculptStroke (raise/lower/smooth/flatten on ρ) · CarveStroke (tunnel brush) · StampPlacement (arch/spire/outcrop field stamp) · MaterialPaintStroke |
| Derive    | DrainageAccumulation · CavityCurvature · AmbientOcclusionField · SunExposure · StratumExposure (geology at surface) |
| Material  | MaterialAssign · MaterialBlend · StrataMaterial (folded rock layers) · TextureSetBinding (§8) |
| Output    | SurfaceExtraction · CollisionExtraction · NavigationExtraction · BakeDensityTiles · ProjectTopSurface |

Sculpt strokes are **strata**, not baked edits: a CarveStroke stores its polyline + radius profile +
falloff, so a cave can be re-routed months later and every downstream stratum (erosion, materials)
re-evaluates. Stroke strata generalise Frontier's own precedent — `TexturePaintWorkspacePanel`
already treats dabs as the document/undo truth over a preview canvas, and `PaintStampEngine` already
evaluates physical stamp instruments against hit frames; the terrain brushes reuse both patterns in
3D (hit = ray ∩ extracted surface, stamp = field primitive).

### 5.3 Evaluation strategy — analytic first, bake on demand

- Each stratum is a pure function (position, channels, configuration) → ρ. While editing, bricks in
  the camera ring evaluate **analytically** in Slang compute: resolution-independent, zero bake
  latency, exact gradients.
- Simulate strata (erosion, water) are stateful: they run iteratively over brick buffers and
  **bake** their result into the brick atlas, invalidating only downstream strata in the touched
  region (`InvalidatedRegion` propagation through the stack).
- Cooking for the game flattens the whole stack into baked bricks per streaming tier (§3.3); the
  runtime never evaluates the stack.

## 6. Water and erosion — 2.5D simulation on a 3D field

### 6.1 The model

Shallow-water (2.5D) simulation is the right physics at terrain scale: water is a height column
h_w(x, z) over a bed, flowing by the virtual-pipe approximation of the shallow-water equations
(Mei, Decaudin & Hu, Pacific Graphics 2007). Each step is five phases — water increment (rain /
sources), pipe flux + velocity field, erosion–deposition by sediment capacity
C = K_c · sin(α) · |v|, sediment advection, evaporation
[4](http://www-evasion.imag.fr/Publications/2007/MDH07/FastErosion_PG07.pdf)
[3](https://github.com/bshishov/UnityTerrainErosionGPU). Thermal weathering adds talus relaxation:
material moves downhill wherever the slope exceeds the angle of repose T = d · tan(θ_talus),
conserving mass into scree aprons at cliff feet
[1](https://old.cescg.org/CESCG-2011/papers/TUBudapest-Jako-Balazs.pdf)
[8](https://github.com/daveaddams91-dev/terrain-erosion-engine). These solvers are why eroded
terrain reads as real: pure fractal noise cannot produce continuous downhill drainage, V-shaped
valleys, or alluvial fans [8](https://github.com/daveaddams91-dev/terrain-erosion-engine).

### 6.2 Running 2D solvers against a 3D field (the part everyone gets wrong)

A (x, z) column may meet the surface several times (arch over a gully). The solver therefore does
not run on "the heightmap" but on **surface columns**: for each (x, z) at solver resolution, march
ρ vertically and record every solid→air crossing as a solver cell, tagged with its height and the
brick coordinate of the surface sample beneath it. Atmospheric processes (rain, rivers, lakes) bind
to the **topmost** crossing; cave floors bind only if a water stratum explicitly targets them
(underground streams). Erosion writes back as Δρ along the local ∇ρ direction at the bound sample —
carving into the actual 3D surface (including cliff faces and cave mouths), not into a 2D proxy.

### 6.3 One solver, four products

| Product | How it falls out of the same simulation |
| ---     | --- |
| Eroded terrain | run hydraulic + thermal phases, bake Δρ (§6.2) |
| Rivers | cells whose discharge (accumulated flux) exceeds a configured threshold → river water surface + carved bed |
| Lakes | equilibrium phase: fill depressions to spill height (priority-flood over surface columns) → flat water surface per basin |
| Ocean / shore | global sea level (configuration); shore = the ρ bed within a configured depth band of the water surface; the same flux field drives shore wetness masks |

All four publish named channels (WaterSurface, WaterDepth, FlowAccumulation, SedimentThickness) that
masks and materials consume — wet rock below the waterline, sand at deposition, no vegetation in the
flow. Erosion also emits the industry-standard **Wear / Deposition / Flow** masks used for texturing
in Gaea and World Machine [12](https://help.world-machine.com/topic/device-erosion/)
[5](https://docs.quadspinner.com/Guide/Using-Gaea/Erosion.html). Runtime option: the equilibrium
water surfaces ship as static geometry + flow channels; the full pipe solver can also run live in a
local simulation tile around gameplay (dambreaks, digging) — same code, smaller grid.

## 7. No hardcoded values — where every number lives

| Quantity class | Owner | Examples |
| ---            | ---   | ---      |
| World geometry | `TerrainWorldConfiguration` (TOML in the document) | world extent [m], tier cell sizes [m], brick extent [cells], narrow-band half-width [cells] |
| Per-operation  | stratum parameter block (inspector-generated) | fractal frequency [1/m], octaves, lacunarity, warp amplitude [m], tube radius [m], smooth-blend radius [m] |
| Physics        | `ShallowWaterConfiguration` / `ThermalWeatheringConfiguration` | gravity [m/s²], Δτ [s], rain rate [m/s], K_c / K_s / K_d, evaporation, θ_talus [°], sediment capacity ceiling |
| Extraction     | `ExtractionConfiguration` | QEF clamp tolerance [m], skirt depth [cells], normal mode, target tier |
| Materials      | material strata + texture-set bindings | triplanar scale [1/m], blend sharpness, strata thickness [m], fold wavelength [m] |

Defaults exist (a preset is a document, e.g. "Alpine range"), but no simulation or geometry constant
is compiled in. Seeds are stored per stratum, so a world is reproducible from its document alone.

## 8. Materials and texturing without UVs, and *real* cliff geology

- Extracted polygons have no usable UVs (arbitrary topology). Texturing is **triplanar**: project the
  texture set along world X/Y/Z, blend by |normal| weights — cliff faces sample the side projections
  at full texel density with zero stretching, cave ceilings texture correctly, and no unwrap exists
  to break on re-extraction [13](https://voxel-tools.readthedocs.io/en/latest/smooth_terrain/)
  [2](https://craftpbr.com/guides/triplanar-mapping).
- Material weights are **voxel-borne** (§3.2), authored by Material strata reading the same masks as
  everything else (slope, flow, wear, painted), normalised sum-to-one exactly like splat weightmaps
  [6](https://www.world-machine.com/features.php). Eight materials per chunk via two RGBA weight
  sets; the set lives in the document.
- 🔴 **Cliff strata are geometry, not texture banding.** A `StrataFolding` warp bends a 3D strata
  coordinate s(x, y, z) = y + fold(x, z) through the volume; `StrataMaterial` assigns rock type by
  quantised s with per-stratum thickness/hardness, and hardness feeds back into erosion rates — hard
  strata resist, soft strata undercut, producing real differential-erosion cliffs, benches and
  hoodoos. The banding seen on a cliff is the intersection of folded 3D rock layers with the
  surface, and it continues correctly through cave walls and arch undersides. Texture detail (via
  triplanar PBR sets) is layered on top for micro-surface only.
- Macro variation (the other half of "not fake"): per-stratum albedo/roughness modulation from the
  Wear/Deposition/Flow channels, cavity AO from the field, and slope-aspect tinting — all derived
  channels, all maskable.

## 9. Frontier fit (inspected, not assumed)

Inspected at `SultanAladin/Frontier` branch `arena/4014756b-frontier` (commit `02c948d7`).

| Frontier fact | Terrain consequence |
| ---           | ---                 |
| Vulkan primary, Slang `.slang` primary shader language, GLFW windows/input | field evaluation + extraction + erosion are Slang compute (`Engine/Terrain/Shaders/`) |
| TOML (toml++) for all engine-authored formats | terrain document = `.terrain.toml` + binary brick sidecar, `TerrainDocumentCodec` |
| Panels register into `PanelDockspace` by key/caption/callback; `EditorWorkspace` owns the 52 px top bar | `TerrainWorkspacePanel` registers `terrain-layers`, `terrain-viewport`, `terrain-inspector` the same way |
| `ControlKit` tokens: panel #121212, inset #1A1A1A, raised #222, text #F0F0F0, dim #888, accent #3B82F6; radius 24/18, control 40 px, row 36 px | layer-stack UI and the HTML prototype use these exact tokens |
| Panels derive from `ActivationSequence` (InitializeContent / IntegrateContent / FinalizeContent) | terrain panel follows the identical lifecycle |
| `TexturePaintWorkspacePanel`: three-dock composition (stack left, viewport centre, inspector right), layer document with folders/masks/blend/opacity, snapshot undo | terrain workspace mirrors this composition and document behaviour in 3D |
| `PaintStampEngine`: physical stamps over hit frames, deterministic validation | sculpt/carve/stamp brushes reuse the stamp discipline; validation style copied |
| `MaterialLibrary`: catalogue + recipe parameters + revision counter | terrain material sets reference catalogue entries by path; document carries a revision |
| Naming skill: PascalCase, approved verbs (Query/Configure/Evaluate/Integrate…), banned nouns (`Node`, `Mesh`, `Manager`, `System`…) | identifiers built by the §0 procedure (`DensityBrickAtlas`, `PolygonSurface`, `StratumOperationRegistry`…); "layer" survives only as UI caption text |
| Folder ownership map | `Engine/Terrain/` (shared code), `UI/Editor/` (panel), `Exhibits/` (validation), `Experimental/` (prototype) — no new top-level categories |

⚠️ The current checkout of `egoistm1inbox/Frontier` contains only the initial commit, so the
specification headers in this delivery are written against the inspected reference APIs but cannot be
linked into the full editor here. Verification status is reported exactly in the plan and in
`Exhibits/TerrainDensityValidation/Results/RESULTS.md` — nothing is claimed beyond what ran.

## 10. Validation performed (summary — full record in the exhibit)

Executed in this environment (Python/NumPy reference implementation of the exact field mathematics,
`Exhibits/TerrainDensityValidation/Code/TerrainDensityValidation.py`):

| Check | Method | Result |
| ---   | ---    | ---    |
| Heightfield impossibility proof | count (x, z) columns with > 1 solid interval in the composed field | recorded in RESULTS.md |
| Cave through alpine ridge | spline-tube smooth-carve; cross-section slice through the tube axis | recorded, with image |
| Overhanging cliff | y-dependent domain warp; profile slice | recorded, with image |
| Arch + spire | torus/cone field union | recorded, with image |
| Surface extraction | Surface Nets over the composed field (Dual Contouring's degenerate case) → OBJ + shaded render | recorded, with image |
| Hydraulic erosion | Mei pipe model on the surface-column projection; before/after + flow mask | recorded, with image |
| Lakes | priority-flood equilibrium on the eroded surface | recorded, with image |
| C++ API compiles | `g++ -std=c++20 -fsyntax-only` over `Engine/Terrain/*.h` | recorded in RESULTS.md |
| Layer-stack interaction | live HTML prototype (this preview) | interactive |

📝 Surface Nets stands in for Dual Contouring in the CPU validation deliberately: it proves field
topology with the simplest correct extractor. Sharp-feature fidelity of the production extractor is a
property of Dual Contouring + QEF (§4), to be re-proven on the Slang path in Phase 2 of the plan.

## 11. Risks and open questions

| Risk | Mitigation in design |
| ---  | ---                  |
| Dual Contouring non-manifold cells | QEF clamp + mass-point fallback + ambiguous-case decider (§4) |
| Analytic stack cost at high tier | dirty-brick evaluation only; bake-on-idle; heightfield-equivalent fast path (§3.4) |
| Erosion stability (pipe model CFL) | Δτ and flux clamps are configuration; solver validates mass conservation per step and refuses unstable settings |
| Multi-crossing columns confusing gameplay systems | `ProjectTopSurface` output gives AI/physics a heightfield projection; caves opt-in explicitly |
| Document size with many stroke strata | strokes are polylines (bytes), fields bake to the brick sidecar; TOML stores parameters only |
| Triplanar cost ×8 materials | weight-major early-out: sample only materials with weight > ε (ε in configuration); virtual-texture path is Phase 5 |

- Open: whether runtime digging (gameplay field edits) is in scope for the AAA title — the design
  supports it (field edits + brick re-extraction), but replication/collision policy is a game-team
  decision, flagged in the plan as a Phase 6 gate.

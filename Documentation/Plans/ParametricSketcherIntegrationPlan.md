# ParametricSketcher Integration Plan

> **TL;DR:** Port SolidArc capability into `SultanAladin/Frontier-1` as **Parametric Sketcher**, a native Frontier Editor workspace. Retain SolidArc computational methods only where target equivalents do not exist. Reuse Frontier-1 math, viewport projection, GPU picking, transform gizmo, MatCap shading, docking, revision history, codecs, content browser, plus the `Experimental/FrontierEditor/cad.*` visual reference. Do not import SolidArc UI, Vulkan host, browser hand-off, package scripts, legacy document format, or duplicate render code.

## 1. Decision

**Ratings:** Reuse / target conformity / testability: 🔴 = highest. Migration cost: ✔️ = lowest.

| Rank | Route | Reuse | Target conformity | Testability | Migration cost | Decision |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 🏆 🥇 | **Native Parametric Sketcher domain port** | 🔴 | 🔴 | 🔴 | 🚩 | **Selected**. Retain CAD algorithms, rebuild integration at Frontier-1 boundaries. |
| 🥈 | SolidArc library wrapped by a thin Frontier-1 workspace | 🚩 | 🚩 | 🚩 | 🚩 | Retains incompatible document, UI, renderer assumptions. |
| 🥉 | Full SolidArc workspace transplant | ✔️ | ✔️ | ✔️ | 🔴 | Rejected. Duplicates UI, viewport, MatCap, Vulkan host, lifecycle. |

### Locked product identity

| Surface | Required result |
| :--- | :--- |
| Workspace title | **Parametric Sketcher** |
| Capability identifier | `ParametricSketcher` |
| Native save suffix | `.Sketch` |
| Legacy suffix | `.solidarc` remains **import-only** during migration |
| UI reference | `Experimental/FrontierEditor/cad.html`, `cad.jsx`, `cad.css` |
| Full editor route | Existing single-window `FrontierEditor` workspace route |
| Standalone route | Future `FrontierParametricSketcher` target, after shared workspace proof succeeds |

`SolidArc` remains visible only in source provenance, migration diagnostics, license notices, plus legacy import compatibility. It must not remain in product titles, active workspace labels, save defaults, executable names, or user-facing commands.

## 2. Audit basis

| Source evidence | Finding | Plan effect |
| :--- | :--- | :--- |
| SolidArc audit at pinned `30728d450f6a97e4d4e7b7f4a8f0016e3fa1ebc8` | SolidArc contains exact solid construction, feature replay, constraints, NURBS, booleans, blends, document persistence, viewport code. | Extract domain algorithms only after baseline tests pass. |
| SolidArc W94 | Twisted-NURBS blend reaches `4.94 s` per edge, `9.55 s` for a pair. | No blind port. Establish a bounded Parametric Sketcher performance gate before UI work. |
| SolidArc W97 | Oversized blend limit search takes `6.12 s`, above its `3.0 s` goal. | Retain one-rebuild discipline, add target cancellation plus cache limits before preview exposure. |
| SolidArc W89 | Split viewport scripted target resolution remains red. | Do not port split UI. Use Frontier-1 `ViewportProjection` plus existing pane conventions. |
| Frontier-1 `Documentation/ImportantNotes.md` | GPU-only overlays, Vulkan 1.3, Slang, right-hand coordinates, Editor profile discipline. | Parametric Sketcher overlays use target `.slang` rasterization only. |
| Frontier-1 UV workspace | Mature reference for session, host, interactor, rasterizer, GPU pick, MatCap, revision, visual validation. | Use as the primary integration template. |
| Frontier-1 `cad.*` | Existing CAD visual contract: 244 px outliner, 278 px inspector, 45 px viewport strip, tool rail, status rail. | Capture it first, then require native pixel-parity proof. |
| Frontier-1 `.Sketch` suffix category | Native suffix category already exists; no `SketchCodec` exists. | Add native `.Sketch` persistence instead of carrying `.solidarc` as the primary format. |

## 3. Boundary map

### 3.1 Reuse map

| Concern | Frontier-1 reuse point | Parametric Sketcher responsibility |
| :--- | :--- | :--- |
| Scalar math, matrices, curves | `Engine/Mathematics/` | Use target scalar types plus solvers; add no competing math library. |
| Coordinates, tolerances, rays | `Engine/MetricSpace/`, `ViewportProjection` | Convert imported geometry into target right-hand `+X` forward, `+Y` left, `+Z` up convention. |
| Polygon render payload | `Engine/GeometrySpace/Network/PolygonNetwork` | Tessellate exact CAD bodies into render-only polygon payloads. Never demote exact body data into polygon-only editing. |
| Primitive preview | `Engine/GeometrySpace/Primitives/AnalyticPrimitives` | Reuse only where primitive output meets Parametric Sketcher feature semantics. |
| Camera, split view | `Engine/Components/Camera/ViewportProjection` | Store Parametric Sketcher camera settings through existing workspace document support. |
| Manipulation | `Engine/GeometricRaster/Gizmo/TransformGizmo` | Bind body, face, edge, vertex, sketch-point selections to target GPU gizmo identifiers. |
| GPU picking | `Engine/GeometricRaster/Picking/ViewportPickQuery` | Encode body/sub-object/persistent-reference identifiers in target pick payloads. |
| MatCap plus PBR | `MatCapEvaluation.slang`, `UVWorkspaceRasterizer`, `FaceShadingAssignment`, `ContentBrowserPanel` MatCap slots | Render CAD face/body MatCaps through existing target slots; retain per-face override semantics. |
| UI chrome | `WorkspaceDockContainer`, `OutlinerPanel`, `InspectorPanel`, `ViewportProjectionPane`, existing controls | Recreate the CAD HTML contract with target components. No SolidArc ImGui shell. |
| History | `RevisionTracker`, `OperationRecorder`, `RevisionCodec` | Record compact parametric operations, never copy whole document snapshots per edit. |
| Workspace routing | `WorkspaceCapabilityRegister`, `EditorLifecycle`, `WorkspaceExtension` | Add `ParametricSketcher` capability plus project-browser opening path. |
| Native containers | `SpaceContainerCodec`, `SpaceSuffixCategory::Sketch` | Implement `SketchCodec` for `.Sketch`; create a separate import reader for `.solidarc`. |

### 3.2 Explicit non-reuse

| SolidArc area | Decision | Reason |
| :--- | :--- | :--- |
| `UI/SolidArc/Interface/` | Do not port | Frontier-1 owns UI components plus a CAD HTML reference. |
| `UI/SolidArc/Viewport/SolidArcDevice.*` | Do not port | Frontier-1 owns Vulkan device lifetime, raster encoding, GPU pick paths. |
| `Experimental/SolidArc/Native/SolidArcApplication.cpp` | Do not port | Frontier-1 owns platform windows, lifecycle, Editor profile routing. |
| `UI/SolidArc/Browser/*` | Do not port | Frontier-1 uses in-window workspace capability routing, not a companion process. |
| `.solidarc` TOML writer | Do not port as writer | Native `.Sketch` becomes the canonical authoring container. |
| Legacy custom gizmo/grid paths | Do not port | Target `TransformGizmo`, target Slang overlays already exist. |
| Legacy MatCap raster code | Do not port | Target `MatCapEvaluation.slang` plus existing MatCap content slots already exist. |

## 4. Target architecture

```text
ParametricSketcherDocument (.Sketch)
        |
        +--> ParametricSketcher feature sequence
        |        |
        |        +--> exact curves / constraints / surfaces / solid bodies
        |        +--> persistent face / edge / vertex references
        |        +--> RevisionTracker compact operation stream
        |
        +--> CAD tessellation boundary
        |        |
        |        +--> GeometrySpace::PolygonNetwork
        |        +--> FaceShadingAssignment MatCap / PBR fields
        |        +--> GPU streams
        |
        +--> ParametricSketcherRasterization (.slang)
                 |
                 +--> R32G32B32A32_UINT pick target
                 +--> MatCapEvaluation.slang
                 +--> TransformGizmo GPU overlay
                 +--> curve / sketch / dimension GPU overlay

ParametricSketcherWorkspaceHost
        |
        +--> Outliner pane
        +--> CAD viewport pane
        +--> Inspector pane
        +--> ContentBrowser MatCap registration
        +--> WorkspaceCapabilityRegister
```

### 4.1 Proposed source layout

| Target folder | Responsibility |
| :--- | :--- |
| `Engine/ParametricSketcher/Sketching/` | planes, points, curves, dimensions, constraints, solve reports |
| `Engine/ParametricSketcher/Geometry/` | analytic carriers, NURBS carriers, intersections, surface evaluation |
| `Engine/ParametricSketcher/Solids/` | exact body partition, face loops, boolean results, body measurement |
| `Engine/ParametricSketcher/Features/` | primitives, extrude, revolve, sweep, boolean, fillet, chamfer, local reshape, replay |
| `Engine/ParametricSketcher/Selection/` | persistent body/face/edge/vertex references plus target pick translation |
| `Engine/ParametricSketcher/Inspection/` | soundness, volume, clearance, section, drawing-sheet measurements |
| `Engine/Workspaces/ParametricSketcher/` | session, host, outliner, inspector, viewport host, input interactor |
| `Engine/GeometricRaster/ParametricSketcher/` | GPU upload, exact-body tessellation intake, CAD viewport raster encoding |
| `Engine/Shaders/ParametricSketcher/` | surface, edge, grid, curve, dimension, pick Slang units |
| `Engine/Codecs/SketchCodec.*` | native `.Sketch` encode/decode plus revision payload routing |
| `Engine/Interchange/GeometryInterchange.*` | existing external boundary extended for STEP/STL after core CAD proof |
| `Exhibits/ParametricSketcher*Validation.cpp` | deterministic proof executables plus PNG evidence |

The exact CAD body remains owned by `Engine/ParametricSketcher/`. `PolygonNetwork` is a tessellated display, picking, export bridge only.

## 5. Delivery sequence

### Phase 0 — Readiness gate

| Deliverable | Work | Exit gate |
| :--- | :--- | :--- |
| Provenance register | Reconcile SolidArc source ancestry, explicit license grant, third-party notices, permitted redistribution scope. | Written approval before source migration. |
| Import baseline | Pin upstream commit plus hash manifest. Record imported file lineage at function granularity. | Reproducible source manifest. |
| CAD HTML capture | Render `Experimental/FrontierEditor/cad.*`; archive reference PNGs before C++ UI work. | Reviewed reference images. |
| Performance baseline | Reproduce W94/W97 fixtures in a standalone benchmark branch. | Known time, allocation, memory readings; no unresolved unbounded loop. |
| Compatibility study | Compare units, right-hand coordinates, tolerance policy, material/MatCap semantics, thread ownership. | Written conversion matrix. |

**Stop condition:** missing license grant, unknown coordinate conversion, or unresolved upstream freeze case blocks Phase 1.

### Phase 1 — Exact geometry foundation

| Scope | First capability | Excluded from first slice |
| :--- | :--- | :--- |
| Sketching | points, lines, arcs, circles, rectangles, dimensional constraints, deterministic solve | imported vehicle curves, surface attachment |
| Solids | box, cylinder, cone, sphere, prism, extrusion, revolve | NURBS, variable blend, complex booleans |
| Feature replay | compact feature sequence, undo/redo, persistent body reference | old document byte parity |
| Verification | closed-form volume, constraint convergence, refusal leaves document unchanged | interactive UI |

**Exit gate:** Parametric Sketcher can create a constrained rectangle, extrude a solid, edit a driving dimension, undo/redo, save/load `.Sketch`, plus reproduce expected analytic volume within declared tolerance.

### Phase 2 — Exact body operations

| Scope | Required work | Guard |
| :--- | :--- | :--- |
| Boundary bodies | Port the minimum exact body partition, face loops, edge continuity, body soundness inspection. | Stable persistent identifiers through replay. |
| Features | boolean union/difference/intersection, shell, local face reshape, edge chamfer, constant-radius fillet. | Refusal keeps body plus history unchanged. |
| Curves | Bézier, Hermite, NURBS plus curve-on-plane input. | Bound iteration count, residual plus time telemetry. |
| Surfaces | analytic plus NURBS surface evaluation, ray pick, tessellation cache. | Target coordinate tolerance only; no hidden unit conversion. |
| Measurements | volume, area, perimeter, distance, section. | Exact primitive cases plus tessellated comparison cases. |

**Exit gate:** body, face, edge, vertex sub-selection maps through edit, undo, redo, save/load without changing unrelated bodies.

### Phase 3 — Native persistence plus import bridge

| Work | Requirement |
| :--- | :--- |
| `.Sketch` container | Use `SpaceContainerCodec`, canonical PascalCase suffix, 64 B aligned binary sections, checksums, `RevisionCodec`. |
| Parametric history | Use `RevisionTracker` budget policy: 215 MiB per document, 750 MiB global session ceiling, redo purge plus prefix fold. |
| Legacy import | Decode `.solidarc` read-only into Parametric Sketcher feature sequence. Produce explicit conversion diagnostics for unsupported features. |
| External interchange | Add STEP/STL only after exact core body proof. Reuse `GeometryInterchange` boundary rather than direct UI file parsing. |
| Migration fixture set | Maintain known legacy input files: primitives, sketches, extrusions, booleans, blends, invalid payloads. |

**Exit gate:** `.Sketch` write/read reaches a semantic fixed point; supported `.solidarc` fixtures import into equivalent body counts, measurements, feature order, MatCap assignments.

### Phase 4 — GPU viewport plus MatCap

| GPU concern | Target reuse | Parametric Sketcher addition |
| :--- | :--- | :--- |
| Surface shading | `MatCapEvaluation.slang`, existing material surface rendering | CAD body/face material lookup, body-level default plus face override. |
| Edge display | Existing Slang raster conventions | CAD edge classes: selected, hidden, tangent, seam, silhouette. |
| Grid plus axes | Target GPU overlay convention | CAD plane grid, named plane, unit scale, section indicator. |
| Manipulation | `TransformGizmo` | body/face/edge/vertex/sketch-point targets; no ownership-wide transform for sub-object edits. |
| Picking | `ViewportPickQuery` | stable body key, selection category, persistent sub-object key, gizmo ordinal. |
| Async work | `ComputeDispatchEncoder`, `TimelineTransferRegister` | tessellation, selection mask, expensive preview result transfer with no UI wait. |

**Performance requirements:**

| Metric | Gate |
| :--- | :--- |
| Extreme zoom curve overlay | four UI frames below 50 ms, bounded vertex count |
| NURBS single-edge blend | below 2.5 s on reference fixture |
| NURBS paired blend | below 3.0 s on reference fixture |
| Oversized blend limit search | no more than one exact rebuild per UI frame, eight-frame settlement below 3.0 s |
| Pick readback | existing target asynchronous 1×1 path; zero synchronous device wait |

**Exit gate:** deterministic offscreen Vulkan or SwiftShader PNGs prove MatCap, selection, edge overlay, grid, gizmo, x-ray, split-view rendering. CPU or ImGui viewport overlays are prohibited.

### Phase 5 — Parametric Sketcher workspace

| Pane | Existing pattern | Parametric Sketcher result |
| :--- | :--- | :--- |
| Outliner | `UVOutlinerPanel` plus `OutlinerPanel` | bodies, sketches, curves, construction planes, feature sequence, visibility, lock, search. |
| Viewport | `UVViewportHost`, `ViewportProjectionPane` | 3D CAD camera, orthographic presets, perspective, tool rail, status rail, CAD view controls. |
| Inspector | `UVInspectorPanel` plus target controls | Sketch, Solid, Surface, Transform, Appearance, Inspection tabs. |
| History | `RevisionTracker` UI exposure | undo/redo plus current feature inspection; no duplicate legacy history panel. |
| Content browser | `ContentBrowserPanel` MatCap registration | MatCap drag/drop to body or face selection, target slot update, revision entry. |
| Project browser | `WorkspaceCapabilityRegister` | `Open with Parametric Sketcher` for `.Sketch` plus supported import extensions. |

The native layout follows the CAD HTML reference: 52 px application bar, 244 px outliner, 278 px inspector, 45 px viewport strip, floating tool rail, 28 px status rail. Native controls come from existing Frontier components only.

**Exit gate:** a `FrontierEditor --workspace=parametricsketcher --frames=4 --capture-png=...` smoke target produces a visual proof matching reviewed CAD reference images within the repository pixel-delta policy.

### Phase 6 — Advanced CAD

| Capability | Prerequisite | Acceptance gate |
| :--- | :--- | :--- |
| NURBS surfacing | Phase 2 body plus curve proof | loft, sweep, patch continuity tests plus bounded iterations |
| Surface-attached sketches | NURBS evaluation plus projection | normal-plane placement plus persistent reference replay |
| Variable blends | W94 performance repair | mixed-radius body remains sound within time budget |
| Drawing sheets | exact section plus measurement | SVG/DXF results match numeric section dimensions |
| Assemblies, joints | stable body identities | constraints survive save/load plus revision replay |
| Vehicle curve input | curve codec plus NURBS proof | imported curves preserve tolerance plus editability |

## 6. Test plan

| Validation target | Main proof | Visual proof |
| :--- | :--- | :--- |
| `ParametricSketcherGeometryValidation` | primitive volumes, sketch solve, extrusion, revolve, persistent selection | primitive plus selected-face PNG |
| `ParametricSketcherFeatureValidation` | boolean, chamfer, fillet, reshape, refusal preservation | before/after body PNG |
| `ParametricSketcherCodecValidation` | `.Sketch` fixed point, revision compaction, malformed input refusal | document summary PNG |
| `ParametricSketcherMigrationValidation` | `.solidarc` import conversion subset plus diagnostics | source/result comparison PNG |
| `ParametricSketcherViewportValidation` | GPU pick, MatCap, grid, x-ray, gizmo, split viewport | deterministic viewport PNG set |
| `ParametricSketcherPerformanceValidation` | W94/W97 fixture budget plus allocation ceiling | timing chart PNG |
| `ParametricSketcherWorkspaceValidation` | CAD HTML parity, outliner/inspector/viewport controls, workspace routing | full desktop capture PNG |
| `ParametricSketcherInterchangeValidation` | STEP/STL import/export after core acceptance | imported/exported body PNG |

Run each applicable target in Editor, Development, Shipping profiles. Editor validates workspace UI. Development plus Shipping validate codec, geometry, interchange, replay without editor linkage. Do not run GitHub Actions without explicit approval.

## 7. Risk register

| Risk | Severity | Containment |
| :--- | :---: | :--- |
| Unclear source license | 🔴 | Stop before source port; obtain written authorization plus notices. |
| W94/W97 freeze regression | 🔴 | Port only bounded algorithm variants; enforce target performance validation before interactive preview. |
| Duplicate renderer or MatCap | 🔴 | Reuse target MatCap shader, raster conventions, GPU pick, transform gizmo. |
| Exact-body / PolygonNetwork confusion | 🔴 | Exact CAD bodies own authoring truth; polygon payload remains derived display data. |
| Legacy document mismatch | 🚩 | One-way importer with explicit unsupported feature diagnostics; canonical write uses `.Sketch`. |
| UI drift from existing CAD reference | 🚩 | Capture HTML first; require deterministic native PNG comparison. |
| Cross-platform drift | 🚩 | Keep OS APIs out of domain code; test Windows, Linux, Android-compatible compile paths plus headless Vulkan. |
| Long merge | 🚩 | Land isolated phases behind `FRONTIER_PROFILE_EDITOR` guards plus narrow CMake targets. |

## 8. First implementation slice after approval

1. Record license plus upstream source manifest.
2. Capture `Experimental/FrontierEditor/cad.*` reference PNGs.
3. Create `ParametricSketcherGeometryValidation` with exact primitive plus sketch/extrude closed-form checks.
4. Add minimal exact sketch, rectangle constraint, extrusion, `.Sketch` codec payload, revision record.
5. Feed derived tessellation into existing target MatCap viewport.
6. Add native workspace host only after geometry, codec, GPU proof gates are green.

No SolidArc source file moves into the target tree until Phase 0 approval plus an accepted file-by-file port map.

## 9. Approval checklist

| Decision | Required owner response |
| :--- | :--- |
| License plus provenance | Confirm approved source use plus redistribution scope. |
| Native suffix | Confirm `.Sketch` as canonical authoring output. |
| Migration | Confirm `.solidarc` import-only policy. |
| Scope | Confirm Phase 1 primitive/sketch/extrude slice before NURBS plus advanced blends. |
| UI | Confirm `cad.*` is the authoritative Parametric Sketcher visual reference. |
| Delivery | Confirm single-window workspace first; standalone executable follows proof. |

# Component Studio

One HTML demo with two workspaces in the Project Zero UI (the visual language of the Frontier-1 Cluster LOD Studio, branch `arena/453e172d-frontier-1`):

| Workspace | What it is | Came from |
|---|---|---|
| **Component Viewer** | A Blueprint-class style editor and previewer for a component class, here `BP_ControlVehicle` | **Vehicle Lab** (Frontier-OLD, `Experimental Remastered/AssetInspector`), renamed and rebuilt |
| **Geometry Compile** | The import inspector. Any imported object opens here first and goes through Source → Geometry → UV Charts → SDF Bake → Cluster LOD → Icon → Metadata | Frontier-1 Cluster LOD Studio "Hero Workspace" (geometry editor, UV charts, SDF baker, icon capture, cluster LOD) |

![Component Viewer](Screenshots/component-viewer.png)
![Geometry Compile](Screenshots/geometry-compile.png)

## Run

```
python3 Serve.py          # http://localhost:8090/
```

Pure ES modules with a raw WebGL2 renderer. There is no build step and nothing is vendored. Serve the folder over HTTP: modules and workers do not load from `file://`.

URL helpers: `?sample=vase|braid|torus|knot|asteroid|planet|terrain` opens Geometry Compile on a procedural sample. `?drawer` opens the Content drawer.

## Component Viewer (formerly Vehicle Lab)

- **Components dock**: a search box and the scene component tree.
  - Rows show icons, or the compiled mesh thumbnail for Static Mesh components. Each row has a visibility eye and a triangle count.
  - Drag a row onto another row to re-parent it (the world transform is kept). Drag a Content card onto a row to add a mesh under it.
  - Below the tree: **Class components** (`VehicleMovement`) and the **Inspection channels** carried over from Vehicle Lab: wheel load, centre of mass, suspension travel, contact patches, slip vectors, component bounds and distance-field collision.
- **Viewport**:
  - View modes: Lit, Checker UV, Clusters and Normals.
  - Camera presets: Persp, Side, Front and Top. Wire and Grid toggles.
  - **LOD**: Auto picks a level per mesh from its screen size (about one triangle per 6 px²). You can also force LOD 0–4 or the coarsest level.
  - Click to select. Gizmos are drawn for cameras, lights, sensors, ballast, aero surfaces and wheels.
  - **Simulate** runs a longitudinal drive preview. It uses the torque curve × turbo multiplier × gearing against drag, rolling resistance and brakes. Wheels spin and steer, and the floor scrolls.
- **Details** changes with the type of the selected component:
  - Component: name and parent. Transform: scrub fields.
  - Static Mesh: mesh picker, baked-data chips, the cluster LOD level list (click a level to force it), material slots and a per-component tint.
  - Wheel, Camera, Light, Sensor, Ballast and Aero Surface each get their own controls.
  - Vehicle Movement holds every Vehicle Lab tuning value, seeded from the Vehicle HMI ControlVehicle sheets.
  - The root shows a class summary with bake coverage, Reset and Export JSON.
- **Content drawer**: the compiled meshes, each with UV / SDF / LOD / icon dots.
  - Drag a card into the viewport, or click **+ Add**.
  - Double-click a card to re-open it in Geometry Compile.
- **Curves drawer**: editable Torque and Turbo curves with linear, smooth or step interpolation.
  - Double-click adds a point, right-click removes one.
  - The redline is marked, and the live rpm is shown while simulating.
- **Add component** dialog: Static Mesh, Wheel, Camera, Light, Sensor, Ballast or Aero Surface. Choose the parent and a mount point (roof, nose, tail, left, right).
- Keys: `F` frame, `G` grid, `Z` wire, `Space` simulate, `Del` delete, `Ctrl+D` duplicate, `Ctrl+I` import.
- Storage:
  - The class is saved in `localStorage` (`frontier.componentStudio.class.v1`).
  - Compiled imports are saved in IndexedDB (`frontier-component-studio`).
  - The three ControlVehicle meshes are rebuilt from the FCT1 facet streams on every load.

## Geometry Compile (import inspector)

There are three ways to open it: **Import…** (OBJ / STL / FCT1, or a procedural sample), dropping a file anywhere, or **Open in Geometry Compile** on an existing mesh.

| Step | Bakes | Inspector |
|---|---|---|
| 1 Source | read, weld, drop degenerates | units (keep / fit 1 m / fit 2 m), import scale, up axis, material slots |
| 2 Geometry | transform + normals | scale (uniform lock), mirror, rotate, centre, flip, smoothing angle |
| 3 UV Charts | planar island unwrap + pack | island normal limit, merge thresholds, UV sheet preview, OBJ / SVG export |
| 4 SDF Bake | signed distance field (worker) | resolution 32³–80³, narrow band, slice preview, iso surface |
| 5 Cluster LOD | Nanite-style cluster DAG (worker) | cluster size, group size, simplify ratio, level list + preview slider |
| 6 Icon | thumbnail capture | ¾ / front / side / top, yaw, pitch, size, background, live icon frame |
| 7 Metadata | `SM_*` name, category, tags, notes | compile summary |

- UV, SDF, Cluster LOD and Icon are optional; each has its own include checkbox.
- Changing a step marks the steps after it stale.
- Under 150k triangles, UV and Icon re-run automatically.
- **Compile & add to BP_ControlVehicle** saves the mesh to Content and adds a Static Mesh component.
- When re-opened from an existing mesh, the button becomes **Compile & update**. The update applies everywhere the mesh is used.
- Keys: `1`–`7` steps, `F` frame, `Esc` close.

## Layout

```
index.html, Studio.css      shell + Project Zero styles
Source/App.js               boot, Content library (IndexedDB), import menu / drop, built-in vehicle meshes
Source/ComponentViewer.js   Blueprint-class viewer (tree, details, channels, simulate, drawers)
Source/GeometryCompile.js   Geometry Compile window controller
Source/Compile.js           headless pipeline (also used to pre-compile the vehicle parts)
Source/Renderer.js          WebGL2 viewport: lit / checker / debug / normal, picking, lines, SDF raymarch, icon capture
Source/MeshData.js          OBJ / STL / FCT1 readers, topology, corner normals, material slots
Source/Kit.js, Icons.js     inspector building blocks, icon set (StudioIconSet definitions + component glyphs)
Engine/                     Cluster LOD Studio engine (cluster hierarchy, QEM, UV charts, SDF bake, transforms) + workers
Vehicle/                    FCT1 codec, material + vehicle specification sheets, ControlVehicle facet archive
```

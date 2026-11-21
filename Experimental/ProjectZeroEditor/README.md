# 🧩 Project-Zero Editor UI (`Experimental/ProjectZeroEditor`)

> **TL;DR**: Canonical HTML/JS reference specification for the native C++20 shared UI components (`Engine/Components/` + `Engine/Workspaces/` + `Engine/Editor/`). Defines the trapezoidal dockable tab bars (`Outliner`, `Viewport`, `Inspector` + adjacent `+` tab button), top `Project-Zero` trapezoidal Notch, bottom `Asset Browser` trapezoidal drawer tab, Outliner entity cards, and shared Environment/Light/Material/Fog/Wind inspector cards.

![Project-Zero Editor UI Render](Images/ProjectZeroEditorOverview.png)

---

## 🏷️ Key UI Surfaces & Shared Component Targets

| Surface in `ProjectZeroEditor` | Visual & Interactive Mechanics | Target Shared C++20 Unit |
| :--- | :--- | :--- |
| **Trapezoidal Dock Tabs** (`Outliner ×`, `Viewport ×`, `Inspector ×`, `+`) | Sloped side bevels, active bottom join into panel background, circular `×` close button, adjacent circular `+` button; dockable across any application window, tears off into an OS window when undocked, and restricts docking strictly within the application. | `Engine/Components/Docking/{TrapezoidalTabGeometry,DockingPanel}.{h,cpp}` |
| **Top Trapezoidal Notch & Bottom Drawer Tab** | Top-center pull-down `Project-Zero` Control Centre notch and bottom-center pull-up `Asset Browser` drawer handle. | `Engine/Components/Overlays/` & `Engine/Editor/Explorer/ContentBrowser` |
| **Scene Outliner** | `Visible` / `Hidden` summary counters, search/filter pills, collapsible collection hierarchy (`Showcase`, `Cameras`, `World`), per-classification SVG icons, and status toggles. | `Engine/Editor/Explorer/SceneOutliner.{h,cpp}` |
| **Property Inspector** | Hero preview banner (`Low sun` sky gradient), 2×2 metric readout cards (`07:52`, `+14°`, `ESE 118°`, `5.4 kK`), status tiles (`Enabled`, `Day cycle`), and shared scalar/color controls. | `Engine/Components/PropertyPanels/` & `Engine/Components/Controls/` |

---

## 🔍 Local Preview

```bash
python3 Experimental/ProjectZeroEditor/Serve.py 8097
```

---

## 📦 Provenance (this copy)

Copied unchanged (after the 2026-11-20 sync below) from `unassignedinbox/Frontier`, `Experimental/ProjectZeroEditor`, at branch `arena/ad7fa01c-frontier` commit `e4966e4`.
This folder was last synced there on 2026-11-20 (`718bdd2`), and every recent branch has the same copy (tree `f188f1d`). This is the UI-only build.
The integrated-render variant (`arena/f810ccd5-frontier`, with `Shader/`, `Source/` and `Tools/`) was deliberately not used. It is the
starting point for the UI redesign.

- `index.html` is the prebuilt, self-contained bundle (scripts, styles, icons and the shader ball are inlined). The only outside requests are three
  Fontshare web fonts (`InspectorDepot/Fontshare.css`). Without internet the page falls back to system fonts.
- Preview here: `python3 Experimental/ProjectZeroEditor/Serve.py 8097` (serves the repository root; `/` opens the editor).
- Rebuilding from the `.jsx` / `.js` sources:

  ```bash
  cd Experimental/ProjectZeroEditor
  npm install        # react, react-dom, esbuild (node_modules is git-ignored)
  node Build.mjs     # rewrites index.html
  ```

  `Inspectors.jsx` imports six files from `Experimental/FrontierEditor/` (copied from the same source branch). When any of the source assets
  (`EngineContent/Fonts/SunReference`, celestial textures, `VectorCodec.cpp`, `ShaderBall.mesh`) is missing, `Build.mjs` reuses the icons, fonts,
  moon textures and shader ball already embedded in `index.html`. Missing `../FractureEditor/*` imports fall back to a bridge plugin.

---

## 🧱 Showcase Primitive Inspector

Cube, Sphere, Cylinder, Torus and Cone (Outliner folder **Showcase**) use `PrimitiveInspector.jsx` instead of the generic geometry layout.
Other geometry and every other panel are unchanged. Below the header there is one category carousel, which opens on **Overview** each
time an object is selected. It has pill tabs (inactive pills show only an icon; the active one adds its label), ‹ › buttons, arrow keys,
horizontal swipe and page dots. Everything uses the same dark theme.

- **Overview**: an editable Purpose card ("What it does" / "Why it's here") with a default per shape, summary chips, Checks passed /
  Warnings counters, Footprint (volume, world width / height / depth), a checks list, Tags, Notes (the same `Notes` as the header) and,
  last, **Quick controls**. These are six dark square tiles (Visible, Dynamic, Shadows, GI, Physics, Locked), each with a small round badge
  like the Checks passed / Warnings icons: green when on, grey when off. Physics on also turns Dynamic on; Dynamic off also turns
  Physics off.
- **Physics**: simulate switch, body type, mass (from density presets or manual), dial gauges for friction, bounciness and damping,
  collider shape, gravity scale, continuous collision and start asleep.
- **Geometry**: the shared `TransformPanel` first, then per-shape parameters, triangle and vertex counts, a 3 × 3 origin picker with
  offset readout, origin / world-origin / drop-to-floor actions, shading and UV projection.
- **Material**: the existing `MaterialPanel`.
- **Rendering**: shadows, GI, shadow detail, draw distance, LOD bias, reflections, motion vectors and a cost summary.
- **Fracture**: the existing `FracturePanel`.

All values are browser drafts in the same per-object store as before. The quick controls keep their old keys (`DYNAMIC`, `Cast shadows`, `GI`,
`PHYSICS`, `LOCKED`). New keys are prefixed `Physics …` / `Geometry …`, plus `Purpose`, `Reason`, `Tags`, `Origin` and the rendering labels.
Nothing reaches a native scene.

The generic "Live parameter map" bar chart (`PropertyGraph`), which was appended to cards across the editor, has been removed
everywhere. Cards keep their purpose-built visuals (solar plots, fog spectra, cloud bounds, lens / iris graphics and so on). Stars, Moons,
Lens Flare, Precipitation, Rainbow and Editor Camera had only the bar map, so they have no data graphic until proper ones are designed.

---

## 🎥 Camera Effects & Post-Process Effects

The **Cameras** Outliner group now holds Editor Camera, Cine Camera, **Motion Blur** (new), **Lens Flare** (moved from under Sun)
and **Post Process**. Post Process has seven children: **Heat Shimmer**, **Glitch**, **Chromatic Aberration**, **Film Grain**,
**Lens Distortion**, **Scanlines** and **Sharpen**. Each effect has its own gradient icon (`PostEffectIcons.jsx`).

The sheets, rows and preview live in `PostEffects.jsx` / `PostEffects.css`. Each effect inspector shows:

- **Effect preview**: a procedural dusk-road scene with a moving car. It is run through that effect with the current values, so
  the picture changes as you move a slider. It has Effect / Split / Original modes, a draggable divider and Pause, plus three readouts.
  Some effects add overlays: the shutter dial (Motion Blur), the line where shimmer starts (Heat Shimmer) and the grain-vs-brightness
  curve (Film Grain).
- **Quick controls**: Enabled plus the effect's switches, as dark tiles.
- Grouped property cards.

Saved scenes from before this change are rearranged once when loaded (`ArrangeCameraEffects`, `CameraEffectsRevision: 1`). Lens Flare
moves to Cameras and missing effects are added. After that, deleted effects stay deleted. The construct menu lists every camera effect
under **Cameras**, so a deleted one can be added again. The Outliner **Camera** filter shows these effects and Lens Flare; **Lights** no
longer shows Lens Flare.

The previews run in the browser only. Values are drafts and nothing reaches the native renderer.

The Wind inspector's "Composite flow · Wind field" card has been removed. The WindEditor opens from the **Open WindEditor** button
in the Wind controls card.

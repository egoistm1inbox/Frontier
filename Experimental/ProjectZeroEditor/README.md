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
  last, **Quick controls**. These are six dark square tiles (Visible, Dynamic, Shadows, GI, Physics, Locked). There is no On/Off text:
  the round icon badge is lit green when on and dimmed when off. Physics on also turns Dynamic on; Dynamic off also turns Physics off.
- **Physics**, in the Cine Camera card style (title, big figure, a diagram that redraws from the values, caption, controls):
  - **Simulation**: impact speed, a 3 m drop study (height over 2 s with rebounds, from gravity scale, linear damping and bounciness;
    a dashed "if simulated as dynamic" path while simulation is off), Rebound / Comes to rest / Gravity, then simulate, body type,
    gravity scale, collides, continuous collision and start asleep.
  - **Mass**: the mass in kg on a log ruler from 10 g to 10 t with everyday objects (phone, brick, person, car …) and a comparison
    caption, from density presets or manual.
  - **Surface response**: dial gauges for friction, bounciness and damping.
- **Geometry**: the shared `TransformPanel` first, then **Shape** (per-shape parameters, caps, triangle and vertex counts),
  **Shading** (a cross-section with its normals and the lit band it produces; Smooth / Auto / Flat and the smoothing angle) and
  **Normals** (weighted, double-sided, flip). There is no collision shape, origin picker or UV card any more.
- **Material**: the existing `MaterialPanel`.
- **Fracture**: the existing `FracturePanel`.

There is no Rendering tab for now.

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

The sheets, rows and studies live in `PostEffects.jsx` / `PostEffects.css`. Each effect inspector shows:

- **Effect study**: an infographic in the camera-card style, with a big reading, a diagram that redraws from the values and three
  readouts. Dragging across the diagram sets the effect's main value.

  | Effect | Diagram | Drag sets |
  |---|---|---|
  | Motion Blur | shutter disc, exposure in each frame, streak with its samples | Shutter angle |
  | Heat Shimmer | displacement against distance over shimmering air layers | Start distance |
  | Glitch | two seconds of bursts and one corrupted frame with RGB split | Frequency |
  | Chromatic Aberration | red / blue shift from centre to corner and split dots in a frame | Strength |
  | Film Grain | grain strength across a shadows → highlights strip | Amount |
  | Lens Distortion | straight grid against the warped grid, corner arrows | Distortion |
  | Scanlines | curved tube and a magnified brightness profile | Line count |
  | Sharpen | brightness across one edge before / after, with the overshoot | Amount |
- **Quick controls**: Enabled plus the effect's switches, as dark tiles.
- Grouped property cards.

Saved scenes from before this change are rearranged once when loaded (`ArrangeCameraEffects`, `CameraEffectsRevision: 1`). Lens Flare
moves to Cameras and missing effects are added. After that, deleted effects stay deleted. The construct menu lists every camera effect
under **Cameras**, so a deleted one can be added again. The Outliner **Camera** filter shows these effects and Lens Flare; **Lights** no
longer shows Lens Flare.

The studies are diagrams of the authored values. Values are drafts and nothing reaches the native renderer.

The Wind inspector's "Composite flow · Wind field" card has been removed. The WindEditor opens from the **Open WindEditor** button
in the Wind controls card.

---

## 💡 Lighting

- **Environment Light** (`EnvironmentLight.jsx`, first child of **Lighting**): image-based light from the whole sky. Source (sky atmosphere,
  HDRI studio / overcast / sunset presets, uniform colour), colour, rotation, intensity, exposure, saturation, ground bounce, and the
  Diffuse / Specular / Ambient occlusion / Visible to camera switches as quick controls. Its **Sky dome** study shows a side view of the
  dome lighting a ball and a top view of where the brightest light comes from, with illuminance in lux. Dragging rotates the environment.
  Saved scenes get it once (`EnsureEnvironmentLight`, `EnvironmentLightRevision: 1`); after that a deleted one stays deleted and can be
  added again from the construct menu.
- **Rim Point**, **Fill Point**, **LED Emitter** and the Environment Light have their own drawn icons (`LightGlyphs.js`). These are used in the
  Outliner, the construct menu and the light inspector's source badge.
- The light inspector (`LightPanel.css`) now uses the main theme. Cards use the `property-card` gradient, border and 22px corners.
  Green-tinted greys were replaced with neutral greys, and readings, buttons and pills have 12px corners. The switch green matches
  the editor toggles.

Clouds, Local Cloud and the three fogs no longer have a wind binding: the Wind binding card, wind-field picker and Follow Wind tile
were removed (`WindBinding` deleted). Precipitation keeps its Follow Wind tile.

Generic quick-control tiles across the inspector no longer print ON / OFF. The icon is lit or dimmed, and only an unavailable action
is labelled.

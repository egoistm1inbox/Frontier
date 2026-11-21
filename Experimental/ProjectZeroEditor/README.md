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
python3 Experimental/ProjectZeroEditor/Serve.py 8092
```

---

## 📦 Provenance (this copy)

Copied unchanged on 2026-11-16 from `unassignedinbox/Frontier`, `Experimental/ProjectZeroEditor`, at branch `arena/ad7fa01c-frontier` commit `e4966e4`.
This folder was last synced there on 2026-11-20 (`718bdd2`), and every recent branch has the same copy (tree `f188f1d`). This is the UI-only build.
The integrated-render variant (`arena/f810ccd5-frontier`, with `Shader/`, `Source/` and `Tools/`) was deliberately not used. It is the
starting point for the UI redesign.

- `index.html` is the prebuilt, self-contained bundle (scripts, styles, icons and the shader ball are inlined). The only outside requests are three
  Fontshare web fonts (`InspectorDepot/Fontshare.css`). Without internet the page falls back to system fonts.
- Preview here: `python3 Experimental/ProjectZeroEditor/Serve.py 8097` (serves the repository root; `/` opens the editor).
- Rebuilding from the `.jsx` / `.js` sources (`node Build.mjs`) needs `Experimental/FrontierEditor/package.json` (esbuild, @napi-rs/canvas) and
  `EngineContent/Icons`, `EngineContent/Fonts/SunReference`, `Exhibits/DistanceFieldGI/ShaderBall.mesh` from the source repository. None of these is in this repository yet.

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

## Follow-up 43: unique Sun and Atmosphere card previews

Every Sun and Atmosphere card had the same shape (a big number, a generic line chart, a slider). Each now has its own kind of picture,
and each picture edits the same field as the control under it (`SunStudies.jsx`, `AtmosphereStudies.jsx`, `SkyStudies.css`):

- **Sun direction → shadow plate.** The sky folded flat onto a ground plate (zenith centre, horizon rim) with a pole: the day's sun path,
  the pole's shadow and the sundial trace of its tip, plus a side view of the elevation angle and shadow length. Drag the sun or the
  shadow to set Local Hours. The disabled azimuth / elevation sliders are now three readouts.
- **Sunlight intensity → lit ball.** A white ball at a fixed exposure lit by Intensity × Direct in the sun colour; clipped highlights get
  zebra stripes. A gauge in photographic stops edits Intensity.
- **Temperature → cube under this light vs 6500 K**, over a blackbody ribbon marked with candle / tungsten / sunrise / noon / overcast /
  shade / blue sky. Dragging the ribbon switches the colour source to Temperature.
- **Daylight cycle → 24-hour dial.** Midnight at the bottom, noon at the top; the ring is coloured day / golden / civil / nautical / astro /
  night, the inner curve is the sun's height. Drag round the dial to set the time.
- **Sun disc → magnified disc** with limb darkening against the Moon's 0.52° (dashed), and the shadow-edge softness it causes
  (e.g. 9.3 cm at 10 m for 0.53°). Drag the rim to resize.
- **Dynamic settings → analemma** (the sun at this clock time on every day of 2026) and a daylight-through-the-year strip; drag either to
  set the date.
- **Atmospheric scattering → beam through air.** White sunlight crossing one path of air: blue scatters out sideways (the glow), the far
  end is the reddened sun. A probe reads the side glow and what gets through.
- **Aerosol haze → five ridges** washed toward the haze colour with distance, plus the Henyey-Greenstein phase lobe (log radius). Mie
  Anisotropy moved here from the native list; drag the lobe to change it.
- **Ozone absorption → twilight skies with and without ozone** (sun 3° below the horizon) over a spectrum with the Chappuis band taken
  out. Drag the dip to set Ozone.
- **Density falloff → altitude column** (square-root scale) for molecules and aerosols with landmarks (Everest, airliner, ozone layer,
  stratopause); drag the handles to set both scale heights.
- **Ground reflectance → bounce light** on a white ball from the ground colour, with a reflectance scale of familiar surfaces for
  reference only (no presets).
- **Native atmosphere controls → dusk horizon** showing Horizon Glow, White Line, Sky Tint and Sky Brightness.

All are illustrative browser drawings; solar geometry still comes from `Solar.mjs`. `CheckSkyStudies.mjs` (5) covers the previews.

## Follow-up 42: one Render Engine component, per-renderer shadows; Rigid Body and Mass redesigned

- **One render component per camera.** The MatCap, Shadow Maps, SDF Tracing and Ray Tracing rows are gone; each camera keeps a single
  **Render Engine** row. Its inspector has five tabs: **Engine · PBR · SDF · Ray traced · MatCap**. A green dot marks the renderer drawing.
  - **Engine**: a decluttered summary card (renderer, engine line, a Renderer segment, a Tracer segment when ray traced, three summary
    lines for shadows / GI / reflections, and a link to that renderer's tab). The **Quality** card (samples/pixel bar, tier pills) and the
    **Output** card (exposure, render scale, edge AA) are unchanged, then Reset.
  - Each renderer tab has **its own shadow algorithm and settings**, stored under its own keys (`Pbr*`, `Sdf*`, `Ray*`, `Matcap*` in
    `RenderSettings.js`), so switching renderer keeps every other renderer's setup:
    - **PBR** (OpenPBR direct): raster shadow maps (Contact + PCSS, PCSS + filter, SMRT depth trace, 3 × 3 PCF), map resolution, tier,
      half-res, plane filter; a penumbra card; direct lighting (LTC area lights, ambient fill).
    - **SDF** (GTX GI): the six distance-field penumbra modes, march steps, softness, tier; the cone GI card.
    - **Ray traced** (BVH4 / PT game / PT final): the tracer, traced shadows (Vogel disk or rectangular area), traced GI, traced reflections.
    - **MatCap**: the studio sphere, a new studio shadow (None, Cavity occlusion, Studio drop, Screen contact; strength and softness) and
      the studio light.
  - Each tab opens with a Rendering / Not rendering strip and a "Use …" button. The global tier sets every renderer's counts.
  - Saved settings from Follow-ups 37–41 (one shared set of shadow / GI / reflection keys) are read into the renderer that used them.
    `ComponentRevision` 3 removes the four retired rows from saved scenes once. The four retired icons are deleted, and `Build.mjs` now
    lets repository icons replace the embedded copies and drops retired ones.
- **Rigid Body** redesigned: a **Body** card with Static / Dynamic / Kinematic tiles (each with a drawing), and for dynamic bodies three
  facts (gravity, time to fall 1 m, top speed from damping), the gravity scale and Start asleep. A **Contact** card shows friction as the
  steepest slope the body rests on (atan μ) and bounciness as a ladder of rebound heights. A **Damping** card shows speed and spin decay
  curves with half-lives. The drop study and the four dials are gone.
- **Mass**: new kettlebell icon (`editor-mass`). Mass comes from a material or is **set directly** as a number in a chosen unit
  (g, kg, t, lb, oz). It is stored in kilograms (`Physics Mass Manual`); the unit (`Physics Mass Unit`) also sets how the figure, balance
  and outliner line read.
- Checks: `CheckRenderSettings.mjs` rewritten (9); EntityContext (70 rows), ObjectComponents (2 camera rows) and InspectorOrder (141)
  updated and passing.

## Follow-up 41: render settings as camera components

- Render settings are no longer a section inside the camera inspector. Every camera (Editor, Cine and any placed from Construct) has
  five **render components** as outliner children, split by render path. They all edit the camera's one `Values["Render Settings"]`
  record (`RenderSettings.js`, unchanged source rules):
  - **Render Engine**: engines grouped by family (MatCap · Raster · SDF · Ray traced), chips showing which components the engine uses
    (each selects that component), the quality tier as pills with the per-pass sample bar, and Output (exposure, scale pills, edge AA)
    with Reset.
  - **MatCap**: a studio sphere shaded in the browser; drag around it to move the light. Channel pills (Shaded / Normals / Roughness /
    Cavity), rim, cavity, clay tint and wire overlay. These six `Matcap*` fields are editor additions: the source engine has no settings.
  - **Shadow Maps**: a texel-grid study with the filter footprint (3 × 3 PCF, Vogel-disk PCSS taps with the blocker search, contact rays,
    SMRT march steps), algorithm tiles, map-resolution pills, tier and filtering; then a penumbra card.
  - **SDF Tracing**: a sphere-tracing study that changes with the penumbra mode, the six modes as a rail, and the cone GI card.
  - **Ray Tracing**: the ray budget, then one switch each for shadows, GI and reflections; each traced pass gets its own card.
- Every component opens with an **In use / Not used** strip for the current engine, with a button that switches to the engine that runs it.
- New files: `RenderComponents.jsx`, `RenderStudies.jsx` (the earlier studies moved here). Icons: `render-matcap`, `render-shadow-maps`,
  `render-sdf`, `render-ray-tracing`. `RenderSettingsCards.jsx` is removed. Cameras use the same component rows as objects
  (`ObjectComponents.jsx`); `ComponentRevision` 2 adds the camera components to older saved scenes once.
- Checks: `CheckRenderSettings.mjs` rewritten (9); InspectorOrder (157), EntityContext (78 rows) and ObjectComponents (7) updated and passing.

## Follow-up 40: editable vehicle curves, one page per workspace, object components

- **Editable curves** (`VehicleComponents.jsx`): the three Vehicle Movement charts take drags and write the fields behind them.
  - **Suspension**: the handle on the first peak sets the damping ratio (height = overshoot) and the natural frequency (when the peak
    arrives).
  - **Powertrain**: each of the 18 torque points drags (rpm between its neighbours, 0–600 N·m); the idle and redline bars drag sideways.
  - **Aerodynamics**: one handle per line at 250 km/h sets the drag area (CdA) and the downforce area (ClA).
  - Every edit is clamped to the Blueprint.js field range and step, so the sliders and the chart always agree.
- **Workspace pages**: the primitive carousel is now Overview · Geometry · Material · **UV** · Fracture · **SDF** · **LOD**. The UV preview moved
  off Geometry onto its own page; new **SDF preview** (centre slice, bricks, memory, bake status) and **LOD preview** (triangles per level,
  cluster settings, bake status) cards (`WorkspacePreviews.jsx`) read the same data as the SDF Bake and LOD Clusters workspaces. Each card
  opens its workspace.
- **Object components** (`ObjectComponents.jsx`, `ObjectComponents.css`, icon `EngineContent/Icons/editor-mass.svg`): every showcase object has
  **Mass**, **Rigid Body** and **Collision** as outliner children, the way post effects sit under Post Process. Each has its own inspector.
  - The values stay on the owning object (`Values[owner]`), so the viewport, checks and quick controls are unchanged. Notes are kept per
    component.
  - The old Physics page is split up: Mass gets the mass card; Rigid Body gets the simulation and surface-response cards; Collision gets a
    new collision-shape card. Collision offers Automatic, Box, Sphere, Capsule, Convex hull and Distance field (SDF); the torus defaults to
    SDF. It shows the proxy's fit and margin, plus filtering (collides, CCD, overlap events, layer).
  - The Overview lists the components as links and can add back any that were removed. New objects from Construct get all three.
    Component rows can't be duplicated.
  - Saved scenes gain the components once (`ComponentRevision`), so a removed component stays removed.
- Checks: new `CheckObjectComponents.mjs` (7); InspectorOrder (137), EntityContext (68 rows) and VolumeWorkspaces (4, now including the SDF and
  LOD page cards) updated and passing.

## Follow-up 39: no presets, no car drawings

- **Atmosphere**: the sky preset tiles are gone. A plain **Sky colour** card shows the current sky at noon and sunset from the
  scattering settings; the cards below it edit those settings.
- **Vehicle folder**: **Bumper Trigger** removed (saved scenes drop it on load). **Vehicle Movement** no longer draws the car:
  each card is its headline figure, its fields and plain readouts (axle loads, wheelbase, steering lock, track, tyre circumference),
  with the suspension response, torque curve and drag curves kept as data plots. **Chassis Collision** draws only its box.

## Follow-up 37: render settings per camera, preview cards, SDF Bake and LOD Clusters

- **Render settings** (`RenderSettings.js`, `RenderSettingsCards.jsx`, `RenderSettings.css`, icon `EngineContent/Icons/render-settings.svg`):
  every camera (Editor, Cine, and any placed from Construct) carries its own copy of the render settings ported from
  unassignedinbox/Frontier `arena/28ada475-frontier`. The section has summary chips, a Reset button and three tabs:
  - **Quality**: engine (OpenPBR / GTX / BVH4 / path tracer), master quality ladder, sample budget.
  - **Lighting**: shadows (algorithm, preset, map size, PCSS taps, contact rays), GI, reflections, each with a small study drawing.
  - **Output**: exposure gain, resolution scale, edge anti-aliasing.
  The source rules are kept: the engine pick sets the GI algorithm, the shadow preset sets rays / taps / map size, and reflection quality sets bounces.
- **UV preview** and **Fracture preview** cards (`WorkspacePreviews.jsx`) sit in the primitive inspector: the UDIM tile with islands and
  usage, or the fracture summary (pieces, energy, sizes, storage). Each has a button that opens the full workspace.
- **SDF Bake** workspace (`SdfWorkspace.jsx`): bakes the primitive with the Geometry Compiler's `SparseSdfBaker` (resolution, padding,
  narrow band), shows a slice you can move and probe, the brick count, pruning and size, and exports `.fvol`.
- **LOD Clusters** workspace (`ClusterWorkspace.jsx`): Nanite-style cluster DAG from `ClusterHierarchy.js`, a level table with errors,
  a camera-distance cut that shows which clusters draw, and welded OBJ export per level.
- Checks: `CheckRenderSettings.mjs` (6) and `CheckVolumeWorkspaces.mjs` (4).

## Follow-up 35: edit workspaces, Vehicle folder, IES authoring

- **Edit workspaces** (`Workspaces.jsx`, `WorkspaceGeometry.js`, `Workspaces.css`): showcase primitives now have **UV** and **Fracture**
  buttons at the top of the inspector. Each opens a workspace **in place**: the viewport shows only the selected object, an "Edit"
  bar names it, and Leave / Esc / Done return to the scene. The inspector shows a switcher between the two workspaces and that
  workspace's cards. This replaces the old pop-out fracture editor window (`window.open`).
  - **UV**: on the left, the object with a checker drawn through its current UVs; on the right, UV space with its islands. Drag
    islands to move them; there are also Rotate 90°, Mirror U, Pack, Reset and an unwrap angle. Edits are saved to `Values["UV Layout"]`.
  - **Fracture**: the shattered object with an explode slider. Click the object to place the impact. Recipe cards cover material,
    impact energy (joules, on a cubic slider; presets Tap, Strike, Impact, Blast), piece ceiling, minimum size and seed, plus a
    piece-size histogram. Uses `FractureEditor/FractureModel.js`.
- **Vehicle folder** (`VehicleComponents.jsx`): a new outliner folder with nine components from the Component Viewer's
  `Blueprint.js` / `Sockets.js`, plus a **Vehicle** construct category. A one-time migration (`VehicleRevision`) adds it to saved scenes.
  - **Vehicle Movement**: chassis and centre of mass (axle loads, rollover threshold), wheels and steering (turning radius),
    suspension (overshoot and settle time from a bump), powertrain (torque / power curve, top gear speed), and aerodynamics
    (drag-limited top speed, downforce).
  - Other inspectors: the **Front Suspension / Steering / Tow Hitch** sockets (diagram plus kind picker), **Chassis Collision** and
    **Bumper Trigger** (shape over the car), **Headlights** and **Brake Lights** (beam plus an illuminance estimate), and **Body** (LOD chain).
  - These are browser drafts: nothing drives a physics simulation.
- **Socket inspectors** (Front Suspension, Steering, Tow Hitch; any of the eight kinds) are four static cards (reworked in Follow-up 38;
  the animated test drive, trace and vehicle side view were removed):
  - **<Kind> socket**: the joint drawn at its pose from the settings. Drag it to set the pose / preload / starting swing; click a
    Dock to connect or release it.
  - **Socket type**: drawn glyph per kind; switching keeps every number.
  - **Range card** per kind (range strip, the sliders from `Sockets.js`, derived figures such as spring period and overshoot).
  - **Attached to**: the asset the socket hangs from, shown as its name. Clicking the name selects that asset; **Attach to** picks
    another asset in the same folder (saved as `attach`). Offset along X and the joint axis are plain fields.
  `CheckVehicleSockets.mjs` (8 checks) covers the card order, no animation, the drag, the asset link, type switching and the dock toggle.
- **IES authoring** (`IesProfile.js`): you can edit the candela curve directly. It is symmetric by default, with an optional separate
  C90 plane. Profiles can be saved to a library in the editor (`Frontier.IesProfiles.v1`), exported as LM-63-2002 Type C and imported.
- **Light inspector layout**: one Preview card holds the visual, the readings rail and the source sliders. The analytical study now
  sits inside the optics card's visual.
- **Other cards**:
  - Rounded diagnostics icons.
  - A camera **Sensor** card with format outlines (`SensorFormats.jsx`).
  - A **Mass** card: density × volume, weight and spin resistance per shape.
- The shared slider `Control` accepts an optional `Curve` power (for example 3) so a wide range gives most of its travel to the
  low end.

## Follow-up 34 inspector cards

- **Sun**: the imported sky picture and stat tiles are replaced by a **Sun now** card (`SunNow.jsx`). It has the local time and
  daylight name, a 360° horizon panorama centred on the noon sun with the whole day's path, hour marks, the sun disc in its apparent
  colour and compass points (drag it to change Local Hours), then six figures: sunrise, sunset, daylight length, light colour,
  clear-sky ground light (an estimate) and shadow length. It uses the same `Solar.mjs` solver as the Sun direction card.
- **Atmosphere**: the scatter-map atlas is replaced by **Sky presets**. It shows the current sky at noon and at sunset, then one tile
  per preset (a noon / sunset sky drawn from that preset's Rayleigh, Mie, ozone, scale heights, tint and albedo), then the standard
  Rayleigh and Mie pill sliders. Colours are an illustrative single-scatter estimate, not the native sky.
- **Height Fog** now has its own cards. **Fog layer** shows a valley cut-away with the fog thinning with altitude, the visibility at
  ground and higher up, and a dashed falloff line you can drag. **Density by altitude** has the interactive profile and visibility
  readouts. **Light in the fog** shows the view towards and away from the sun, with Sun Scatter and Colour.
- **Atmospheric Fog** now has its own cards. **Aerial perspective** shows ridges fading into haze, each labelled with its distance and
  how much light survives, with a distance probe. **Spectral transmission** has the spectrum with Mie Blend.
- **Local Fog** keeps the shared cards: Fog settings, Visibility through fog, Medium with Beam Chamber, and Fog volume shape.
- **Glitch** effect study: "Signal break-up". It shows one second of signal with its bursts and an SMPTE-style test frame. Rows one
  block tall are displaced and split into red / green / blue. Dragging sets Intensity.

## 🧱 Showcase Primitive Inspector

Cube, Sphere, Cylinder, Torus and Cone (Outliner folder **Showcase**) use `PrimitiveInspector.jsx` instead of the generic geometry layout.
Other geometry and every other panel are unchanged. Below the header there is one category carousel, which opens on **Overview** each
time an object is selected. It has pill tabs (inactive pills show only an icon; the active one adds its label), ‹ › buttons, arrow keys,
horizontal swipe and page dots. Everything uses the same dark theme.

- **Overview**: summary chips, Checks passed / Warnings counters, Footprint (volume, world width / height / depth), a checks list,
  Tags, then **Quick controls**, then **Notes**. Quick controls are six dark square tiles (Visible, Dynamic, Shadows, GI, Physics,
  Locked). There is no On/Off text: the round icon badge is lit green when on and dimmed when off. Physics on also turns Dynamic on;
  Dynamic off also turns Physics off. The Notes card holds the **Purpose** block first ("What it does" / "Why it's here", with a
  default per shape), then the free notes (the same `Notes` as the header).
- **Physics**, in the Cine Camera card style (title, big figure, a diagram that redraws from the values, caption, controls):
  - **Simulation**: impact speed, a 3 m drop study (height over 2 s with rebounds, from gravity scale, linear damping and bounciness;
    a dashed "if simulated as dynamic" path while simulation is off), Rebound / Comes to rest / Gravity, then simulate, body type,
    gravity scale, collides, continuous collision and start asleep.
  - **Mass**: the mass in kg on a log ruler from 10 g to 10 t with everyday objects (phone, brick, person, car …) and a comparison
    caption, from density presets or manual.
  - **Surface response**: dial gauges for friction, bounciness and damping.
- **Geometry** is built from the editor's own property cards, split-value pill sliders, switches and readout rows (passed in as
  `Kit` from `Inspectors.jsx`): the shared `TransformPanel`, then **Shape** (the lead dimension as a big figure, a three-quarter wireframe
  drawn from the real segment / ring / side counts and bevel with W / D / H dimension lines, and the size sliders), **Resolution**
  (triangle count, segment sliders, caps, area and volume), **Shading** (a cross-section with its normals and the lit band it produces;
  shading select and smoothing angle) and **Normals** (smoothing groups, hard edges, weighted, double-sided, flip).
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

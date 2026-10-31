# Project Everest

Native C++ / Vulkan port of the **VehicleHMI Proving Grounds** application (`Experimental/VehicleHmiPrototype/`), hosted on Frontier's shared `ProjectBrowserPanel`, `PanelDockspace`, `ControlCentrePanel`, `LogStreamPanel`, `SceneDirectory`, and modular `InspectorCatalogue`.

## Highlights

- **1:1 VehicleHMI Workspace Chrome:** `288 px` Outliner | `1fr` Viewport + docked `Log Stream` | `380 px` Modular Inspector + `28 px` `#status` bar + top-edge `ControlCentrePanel` theme drawer.
- **Dual-Tier GPU Architecture:**
  - **RTX Tier:** Hardware `VK_KHR_acceleration_structure` + `VK_KHR_ray_query` full ReSTIR GI + multi-bounce reflections + GPU emissive facet CDF + SVGF.
  - **GTX Tier (Fallback):** Toroidal **SDF Distance-Field GI** + **Surface Cache** multi-bounce radiosity + **16-bin SAH-2 ordered software BVH reflections**.
- **RAII Scene Records & Three-Tier Modular Inspectors:**
  1. `EngineReusable` — built-in engine inspectors (`Sun`, `Atmosphere`, `Clouds`, `Fog`, `Wind`, `Render settings`, `BVH & distance field`, `Surface cache`, `Geometry clusters`, `Diagnostics`).
  2. `ProjectCustom` — custom project inspectors (`ControlVehicle` with 8 system tabs + 4 wheel selectors + 5 tyre sub-tabs, plus course items).
  3. `DedicatedStudio` — specialized authoring studios (`Particle Studio`, `Fracture Studio`, `Fluid & Plume Studio`).

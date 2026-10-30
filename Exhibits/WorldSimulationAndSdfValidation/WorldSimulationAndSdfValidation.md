# 🌍 Frontier World Simulation, Fluid, Precipitation, Single-Mesh Snow Mound, Nanite, Portals & 3D HMI

## 📋 Clean Engine Domain Architecture

All simulation, geometry, particle, gameplay, and rendering modules live under clean, intuitive `Frontier/Engine/`
domain directories with zero `*Extension` or `RtxBvh` naming artifacts:

| Domain Folder | Engine Modules | Responsibility |
| :--- | :--- | :--- |
| `Engine/Fluid/` | `PlumeFluid`, `ShallowWater` | 3D pyro explosions/soot + 2.5D water/mud |
| `Engine/VisualEffects/` | `WindField`, `SnowSurface`, `LightningStorm` | Wind, single-mesh snow mound & lightning |
| `Engine/Particles/` | `SparkParticles`, `SkyPrecipitation` | Crisp sparks + coupled snow, rain & hail |
| `Engine/GeometryProcessing/` | `FacetTierBuild`, `ClusterHierarchy` | Glass-aware Karis Nanite DAG |
| `Engine/Gameplay/GameMechanics/` | `Propulsion/*`, `PortalMechanics`, `VehicleCabinHmi` | Portals & 3D Cabin HMI |
| `Engine/Rendering/` | `SceneRenderer`, `BlinnRenderer`, `CloudField` | GTX/RTX GI, Blinn, exposure & clouds |
| `Engine/Physics/` | `FrontierTyreMechanics`, `SolidFracture`, `ProjectDrive` | Tyres, fracture & Jolt `v5.6.0` |
| `Engine/Networking/` | `StateReplication` | `FP1` / `48 B` wire codec & Hermite replay |

---

## 🖼️ Rendered HD Visual Evidence (`14` PNGs)

1. **Falling Snow Accumulating Into ONE Single-Mesh 3D Snow Mound (`Images/SnowfallMoundAccumulation960x540.png`)**:
   `9,600` wind-advected `SkyPrecipitation` dendritic snowflakes falling through `WindField` and converging in the lee
   of cleaved granite boulders to build **one single continuous 3D snow mound mesh (`ConnectedComponents = 1`, `13,624`
   triangles, `0.949 m` peak, `0` pre-sculpting)** with `36.5°` angle-of-repose slumping, wind-carved sastrugi,
   feathered powder apron, Oren-Nayar retro-reflection, glacier-blue subsurface scatter, and crystal sun sparkles.
2. **4-Stage Progressive Snowfall Accumulation (`Images/SnowfallProgressiveAccumulation960x540.png`, `960x540`)**:
   4-panel progressive storm time-lapse (`0.00 m -> 0.059 m -> 0.354 m -> 0.734 m -> 0.949 m`, `4,295` fused flake
   touchdowns) proving falling snowflakes physically grow the single-mesh snow mound from bare ground.
3. **Simulated Torrential Rainfall & Smooth 2.5D Puddles (`Images/TorrentialRainfallAndPuddles960x540.png`)**:
   `9,800` wind-sheared specular-refractive rain streaks (`8.79 m/s`) + storm rain shafts physically filling smooth
   2.5D `ShallowWater` asphalt puddles (`6.487 m^3`, `0` foam, `0` splash) with concentric capillary raindrop ripples.
4. **Simulated Ballistic Hailstorm & Multi-Bounce Rebounds (`Images/HailstormBounceAndIce960x540.png`, `960x540`)**:
   `8,600` layered rime-ice hailstones executing up to `3` parabolic rebounds (`29,479` elastic bounces, `3,815`
   mid-air rebounding stones) off the `ControlVehicle` hood/roof, rocks, and plaza before settling into granular ice.
5. **RTX Hardware Ray-Tracing Pyro Plume & Water (`Images/RtxPortalMirrorPlumeWater.png`, `960x540`)**:
   Upgraded `PlumeFluid` detonation fireball + baroclinic/combustion-expanded dark soot billows with directional
   cauliflower lobe relief (`51.52 ms` step vs `281.83 ms` `de61677` baseline = **`5.47x` faster**), crisp sparks,
   64-step clouds, planar mirror, portal, and smooth 2.5D water (`0` foam, `0` splash).
6. **GTX SDF + Software BVH Reflection Tier (`Images/GtxSdfPortalMirrorPlumeWater.png`, `640x360`)**:
   Sphere-traced `DistanceField` + `OrientedSurfaceCard` SDF ReSTIR GI + software BVH triangle reflections.
7. **Single-Mesh Snow Mound + Tyre Ruts + Crisp Sparks (`Images/SnowPitFallingSnowAndSparks960x540.png`, `960x540`)**:
   Curved dual-track Wong-Bekker tyre ruts carved across the snowfall-accumulated single-mesh snow mound (`13,552`
   triangles, `ConnectedComponents = 1`), cleaved concrete barrier, falling snow, and crisp swept ballistic sparks.
8. **Real 3D `ControlVehicle` Cockpit HMI (`Images/ControlVehicle3DCockpitHmi960x540.png`, `960x540`)**:
   Mounted inside `ControlVehicle` with 3D steering wheel, chamfered hexagonal `KINETIK` cluster, tilted 3D centre
   tablet (`12` SVG icons + live 3D `ControlVehicle` turntable), windshield reflection, and cabin exposure lock.
9. **High-Resolution Cabin Cluster & Garage Screen (`Images/VehicleCabinHmiComposite.png`, `960x780`)**:
   `960x240` hexagonal `KINETIK` race cluster + `960x540` central screen (`GarageBay` 3D `ControlVehicle` turntable).
10. **Circular Portals & Blocking (`Images/CircularPortalDuplicateAndBlocking960x540.png`, `960x540`)**:
    Circular cyan/amber portals duplicating allowed `ControlVehicle` (`101`) while blocking hazard cube (`202`).
11. **Split-Vehicle Rectangular Portal Transit (`Images/PortalSplitVehicleTransit960x540.png`, `960x540`)**:
    `ControlVehicle` entering Portal 1 (`0` chassis behind Portal 1) and emerging cleanly from Portal 2 (`+5.8 m`).
12. **Low-Resolution Blinn-Phong Renderer (`Images/BlinnLowResProvingGround960x540.png`, `960x540`)**:
    `0.42x` (`403x227 -> 960x540`) internal z-buffered `BlinnRenderer` with translucent glazing and planar shadows.
13. **Glass-Aware Nanite Cluster-DAG Showcase (`Images/NaniteClusterLodShowcase960x540.png`, `960x540`)**:
    4-panel diagnostic proving Karis group-atomic monotonic triangle reduction (`14,136 -> 12,497 -> 11,992 -> 1,109`).
14. **Solar Disc & Multi-Element Optical Lens Flare (`Images/SolarDiscAndOpticalLensFlare960x540.png`, `960x540`)**:
    Eddington limb-darkened solar disc, starburst diffraction, coated hexagonal aperture ghosts, halo, and streak.

---

## ✅ Quantitative & Sanitizer Verification (`35/35 PASS` Release, `34/34 PASS` `ASan+LSan+UBSan`)

| # | Check | Measured Result | OK |
| ---: | :--- | :--- | :---: |
| 1–3 | `PlumeFluid` OBB Neumann, shadow & fire light | `max_spd = 0`, `T = 0.0000`, `near_rgb = 525.82` | ✅ |
| 4–8 | 2.5D Saint-Venant water, puddles, mud & link | `rest_v = 1e-7 m/s`, `mud_v = 0.031`, `buoy = 46.7 kN` | ✅ |
| 9–12 | 3D `SnowSurface`, blow-off, ruts & hail melt | `lingering = 0`, `0.451 -> 0.142 m`, `3505.1 N` | ✅ |
| 13 | Branched lightning, cloud glow & thunder | `55` segs, `glow = 48.09`, `c = 340.4 m/s` | ✅ |
| 14–16 | 6-material Griffith fracture & Jolt `v5.6.0` | `6/6` presets, `vol_err = 0.000000`, `28` hulls | ✅ |
| 17 | Swept `SparkParticles` & shadowed lighting | `96` bounces, `28` splits, `occ_irr = 0.00000` | ✅ |
| 18–21 | GTX SDF & RTX ReSTIR, Mirrors, Portals & Water | `gtx_W = 4.397`, `rtx_W = 4.852`, `plume = 0.993` | ✅ |
| 22 | `VehicleCabinHmi` 12 SVG icons & 3D Garage | `12` SVG apps, `car_3d = 1`, `shift_leds = 10` | ✅ |
| 23 | `PlumeFluid` benchmark vs `de61677` (`<= 1.05x`) | `51.52 ms` vs `281.83 ms` (`0.183x` = `5.47x` faster) | ✅ |
| 24–25 | Falling snow -> single-mesh 3D snow mound | `0 kg -> 0.949 m`, `components = 1`, `13,624` tris | ✅ |
| 26–32 | Portals, lens flare, Blinn, 3D HMI & Nanite | `dup_exit = 12,695`, `prot = 0.85x`, `14136 -> 1109` | ✅ |
| 33 | Simulated `Rainfall` filling 2.5D puddles | `touchdowns = 9,417`, `vol = 6.487 m^3`, `8.79 m/s` | ✅ |
| 34 | Simulated `Hailstorm` rebounds & granular ice | `bounces = 29,479`, `airborne = 3,815`, `5,320` ice | ✅ |
| 35 | Rendered `14/14` HD Stage I visual proof PNGs | `png_ok = (1,1,1,1,1,1,1,1,1,1,1,1,1,1)` | ✅ |

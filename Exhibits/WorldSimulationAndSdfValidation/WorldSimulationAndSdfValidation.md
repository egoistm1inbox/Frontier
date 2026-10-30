# 🌍 Frontier World Simulation, Fluid, Snow, Particles, Nanite, Portals, GI & 3D Cabin HMI

## 📋 Clean Engine Domain Architecture

All simulation, geometry, particle, gameplay, and rendering modules live under clean, intuitive `Frontier/Engine/`
domain directories with zero `*Extension` or `RtxBvh` naming artifacts:

| Domain Folder | Engine Modules & CMake Targets | Responsibility |
| :--- | :--- | :--- |
| `Engine/Fluid/` | `PlumeFluid`, `ShallowWater` | 3D pyro explosions/fire/soot + 2.5D water/mud |
| `Engine/VisualEffects/` | `WindField`, `SnowSurface`, `LightningStorm`, `CelestialSky` | 3D wind, 3D snow surface, lightning, celestial |
| `Engine/Particles/` | `SparkParticles`, `SkyPrecipitation` | Shutter-streaked sparks + 3D sky snow/rain |
| `Engine/GeometryProcessing/` | `FacetTierBuild`, `QuadricTierBuild`, `ClusterHierarchy` | Glass-aware Karis group-atomic Nanite DAG |
| `Engine/Gameplay/GameMechanics/` | `Propulsion/*`, `PortalMechanics`, `CabinIconDepot`, `VehicleCabinHmi` | Propulsion, portal mechanics, 3D `ControlVehicle` HMI |
| `Engine/Rendering/` | `SceneRenderer`, `BlinnRenderer`, `ExposureAdaptation`, `CloudField`, `PhotometricLights`, `SkyRadiance` | GTX/RTX GI, low-res Blinn, cabin exposure, clouds |
| `Engine/Physics/` | `FrontierTyreMechanics`, `Fracture/SolidFracture`, `ProjectDrive` | Calibrated tyres, 6-material fracture, Jolt `v5.6.0` |
| `Engine/Networking/` | `StateReplication` | `FP1` / `48 B` wire codec & Hermite replay |

---

## 🖼️ Rendered HD Visual Evidence (`10` PNGs)

1. **RTX Hardware Ray-Tracing Tier (`Images/RtxPortalMirrorPlumeWater.png`, `960x540`)**:
   Roaring `PlumeFluid` detonation fireball + billowing dark carbonaceous soot column, incandescent spark streaks,
   zero-banding 64-step volumetric clouds, planar mirror, portal, and smooth 2.5D water puddle (`0` foam, `0` splash).
2. **GTX SDF + Software BVH Reflection Tier (`Images/GtxSdfPortalMirrorPlumeWater.png`, `640x360`)**:
   Sphere-traced `DistanceField` + `OrientedSurfaceCard` SDF ReSTIR GI + software BVH triangle reflections over the
   identical explosion/mirror/portal/puddle scene.
3. **Settled 3D Snow + Falling Sky Snow + Crisp Sparks (`Images/SnowPitFallingSnowAndSparks960x540.png`, `960x540`)**:
   Smooth Marching-Squares 3D `SnowSurface` (`0` floor texture whitening) with curved Wong-Bekker dual tyre ruts,
   `5,200` wind-advected `SkyPrecipitation` snowflakes, cleaved monument shards, and shutter-integrated spark streaks.
4. **Real 3D `ControlVehicle` Cockpit HMI (`Images/ControlVehicle3DCockpitHmi960x540.png`, `960x540`)**:
   Mounted inside `ControlVehicle` with 3D steering wheel, chamfered hexagonal `KINETIK` cluster, tilted 3D centre
   tablet (`12` SVG icons + live 3D `ControlVehicle` turntable), windshield reflection, and cabin exposure lock.
5. **High-Resolution Cabin Cluster & Garage Screen (`Images/VehicleCabinHmiComposite.png`, `960x780`)**:
   `960x240` hexagonal `KINETIK` race cluster + `960x540` central screen (`GarageBay` 3D `ControlVehicle` turntable,
   6 paint swatches, 4-wheel thermal cards, G-meter, and multicolour vector SVG app dock).
6. **Circular Portals & Blocking (`Images/CircularPortalDuplicateAndBlocking960x540.png`, `960x540`)**:
   Circular cyan/amber portals automatically clipping & duplicating allowed `ControlVehicle` (`101`) onto the exit side
   while blocking and halting the crimson hazard cube (`202`, `0` exit duplicate triangles).
7. **Split-Vehicle Rectangular Portal Transit (`Images/PortalSplitVehicleTransit960x540.png`, `960x540`)**:
   `ControlVehicle` entering Portal 1 (`0` chassis behind Portal 1) and emerging cleanly from Portal 2 (`+5.8 m` away).
8. **Low-Resolution Blinn-Phong Renderer (`Images/BlinnLowResProvingGround960x540.png`, `960x540`)**:
   `0.42x` (`403x227 -> 960x540`) internal z-buffered `BlinnRenderer` with translucent glazing and planar shadows.
9. **Glass-Aware Nanite Cluster-DAG Showcase (`Images/NaniteClusterLodShowcase960x540.png`, `960x540`)**:
   4-panel diagnostic (per-cluster IDs + crisp wireframe, Tier LOD heatmap, two-phase Hi-Z + 2-layer glass peel, and
   deferred Snell/Beer-Lambert refraction) proving Karis group-atomic monotonic triangle reduction (`14,136 -> 1,109`).
10. **Solar Disc & Multi-Element Optical Lens Flare (`Images/SolarDiscAndOpticalLensFlare960x540.png`, `960x540`)**:
    Eddington limb-darkened solar disc, starburst diffraction, coated hexagonal aperture ghosts, halo, and streak.

---

## ✅ Quantitative & Sanitizer Verification (`31/31 PASS`, Release + `ASan+LSan+UBSan`)

| # | Physical / Rendering Check | Measured Result | Status |
| ---: | :--- | :--- | :---: |
| 1–3 | `PlumeFluid` OBB Neumann, Beer-Lambert shadow & fire light | `max_spd = 0`, `T = 0.0000`, `near_rgb = 560.98` | ✅ |
| 4–8 | 2.5D Saint-Venant water, rain puddles, Bingham mud & link | `rest_v = 1e-7 m/s`, `mud_v = 0.031 m/s`, `buoy = 46.7 kN` | ✅ |
| 9–12 | 3D `SnowSurface`, vehicle blow-off, Wong-Bekker ruts & hail | `lingering = 0`, `0.451 -> 0.142 m`, `3505.1 N` | ✅ |
| 13 | Branched lightning, `680 m` cloud glow & delayed thunder | `55` segs, `glow = 48.09`, `c = 340.4 m/s` | ✅ |
| 14–16 | 6-material Griffith fracture & Jolt `v5.6.0` convex hulls | `6/6` presets, `max_vol_err = 0.000000`, `28` hulls | ✅ |
| 17 | Swept colliding `SparkParticles` & shadowed scene lighting | `96` bounces, `28` splits, `occ_irr = 0.00000` | ✅ |
| 18–21 | Dual-tier GTX SDF & RTX ReSTIR, Mirrors, Portals & Water | `gtx_W = 4.363`, `rtx_W = 4.821`, `water_plume = 0.997` | ✅ |
| 22–23 | `VehicleCabinHmi` 12 SVG icons, 3D Garage & smooth snow | `12` SVG apps, `car_3d = 1`, `19,002` smooth snow tris | ✅ |
| 24 | Split-vehicle two-portal transit & rear clipping | `src = 25,068`, `behind_P1 = 0`, `behind_P2 = 0` | ✅ |
| 25 | Limb-darkened Sun disc & multi-element optical lens flare | `sun_R = 211.6`, `ghost_boost = +6.77 srgb8` | ✅ |
| 26 | Low-resolution `BlinnRenderer` (`0.42x` + planar shadows) | `403x227 -> 960x540`, `25,092` tris, `24,937` shadows | ✅ |
| 27–28 | Protected cabin/dark-room exposure & 3D `ControlVehicle` HMI | `unprot = 5.94x -> prot = 0.85x (clamped)`, `cabin = 1.00` | ✅ |
| 29 | Circular portals, automatic exit duplicate & object blocking | `dup_exit = 12,695`, `blocked_dup = 0`, `stop = 0.420 m` | ✅ |
| 30 | Glass-aware Nanite `ClusterHierarchy` group-atomic DAG cut | `14,136 -> 12,497 -> 11,992 -> 1,109 tris`, `35` glass | ✅ |
| 31 | Rendered `10/10` HD Stage H visual proof PNGs | `png_ok = (1,1,1,1,1,1,1,1,1,1)` | ✅ |

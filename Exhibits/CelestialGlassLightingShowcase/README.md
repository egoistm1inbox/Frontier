# Celestial, Glass-Aware Nanite, Dual-Tier GI & Area-Luminaire Showcase

## Scope

`CelestialGlassLightingShowcase` validates and renders the Stage F Engine substrates across four verification suites
(`13/13 PASS`) and five `960x540` showcase PNGs:

1. **Glass-Aware Virtualized Cluster Geometry (`FrontierGeometryProcessing`)**:
   - Class-pure `<= 128`-triangle cluster partitioning (`FacetTierBuild`) and monotonic Garland-Heckbert quadric DAGs
     (`QuadricTierBuild`) with `UV`/material seam locks.
   - Optical IOR error magnification (`1 + 4.5 * (eta - 1) * sin(theta_cone)`) keeping curved transmissive glass at
     finer tiers than equal-distance opaque clusters, backface-exempt glass cone culling, two-phase opaque-only Hi-Z
     that never culls geometry behind glass, `64 KB` streaming pages with pinned root fallback, and two-layer glass
     entry/exit peeling.
2. **Celestial Catalogue, Custom Stars, Textured Moon, Ringed Planets & Simulated Atmospheres
   (`FrontierCelestialSky`)**:
   - 41,360-star `Hipparcos8.csv` `32x32` octahedral star index (`46,690` overlap-binned entries) + structured Milky
     Way and central dust rift.
   - Custom user-defined stars with Planckian chromaticity, 6-blade constant-thickness needle diffraction spikes, and
     scene bounce irradiance.
   - Equirectangular `2048x1024` `MoonAlbedo2048.ppm` selenographic Luna with Lommel-Seeliger phase, earthshine, star
     occultation, and 6 lunar presets (`Luna`, `Ember`, `Glacier/Europa`, `Sulfur/Io`, `Shroud/Titan`, `Shard`).
   - 3D ringed planets (`SaturnianGasGiant`, `OceanicTerrestrial`, `MethaneIceGiant`, `RustyDesertWorld`) with C/B/
     Cassini/A/Encke/F radial ring profiles, spherical Rayleigh/Mie/absorption atmospheres, and mutual planet/ring
     shadows with red-refracted atmospheric limb penumbrae.
3. **Exact Dual-Tier GTX vs RTX ReSTIR GI, Reflections, Portals, Mirrors & Area Luminaires
   (`FrontierSceneRenderer`)**:
   - **GTX (`SignedDistanceFieldGtx`)**: SDF + `3x3`-quadrature `OrientedSurfaceCard` ReSTIR GI paired with exact
     software triangle-BVH reflections (never coarse SDF reflection boxes).
   - **RTX (`HardwareRayTracingRtx`)**: Full hardware triangle raytracing for both ReSTIR GI and reflections.
   - Nonsingular solid-angle rectangular area luminaires, Karis representative-point specular, closed-dielectric Snell/
     Fresnel glass refraction, unrolled portal/mirror/glass screen-space spatial reuse, 3-step edge-stopping À-Trous
     wavelet denoising (`86.6%` Laplacian speckle reduction), multi-scale HDR bloom, and chromatic AgX/ACES tonemapping.

## Rendered Showcase Artifacts (`960x540`)

- `Images/CelestialObservatoryRingedPlanetMoonStars.png` — Night observatory over a calm rain lagoon reflecting the
  41k Hipparcos sky, custom diffraction-spiked stars, cratered Moon, and ringed Saturnian gas giant with blue limb
  atmosphere.
- `Images/EmissiveGalleryGtxSdfGiBvhReflections.png` — Architectural gallery on **GTX** (`SDF + SurfaceCards GI` +
  `Software BVH Triangle Reflections`) with area luminaires, refracting crown glass sphere, gold/chrome spheres,
  planar mirror, seamless portal, and colliding `PlumeFluid` fire/sparks.
- `Images/EmissiveGalleryRtxFullRayTracing.png` — Identical architectural gallery on **RTX** (`Full Hardware RT` for
  both GI and reflections).
- `Images/GlassAwareVirtualizedGeometryShowcase.png` — 4-panel Nanite glass diagnostic (`Cluster ID`, `Selected Tier
  Heatmap`, `Opaque-Only Hi-Z`, and `Two-Layer Glass Refraction Resolve`).
- `Images/LunarAndPlanetaryAtmosphereAtlas.png` — 6-tile astronomical atlas (`Luna`, `Io/Europa/Titan`, `Saturn`,
  `Oceanic Exoplanet + Ring`, `Methane Ice Giant + Desert Mars`, and `Binary Custom Star Cluster`).

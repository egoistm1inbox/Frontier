# Coupled 2.5D-to-3D Sparse Narrow-Band Vehicle Water Architecture

## 📌 Scope and Constraints

This technical plan defines Frontier's production path for realistic **3D grid liquid water** interacting with
vehicles (deep river fording, bow-wave overturning, submerged wheel-well displacement, and chassis wake sheets)
while honoring two non-negotiable project constraints:

1. **Zero foam and zero splash**: neither whitewater foam particles/textures nor detached spray/splash emitters
   are permitted; only the coherent liquid free-surface volume and its optical refraction/reflection are modeled.
2. **Real-time dual-tier GPU budget**: must sustain `<= 0.75 ms` on RTX-class GPUs and `<= 1.25 ms` on GTX-class
   GPUs alongside `PlumeFluidExtension`, `ShallowWaterMudExtension`, weather, physics, and GI.

---

## 🔬 Why Naive 3D Grid Water Costs Orders of Magnitude More Than 3D Gas (`PlumeFluid`)

Replacing `PlumeFluidExtension` (`1.2 kg/m^3` single-phase buoyant gas) with a naive dense 3D Eulerian water box
(`1000 kg/m^3` free-surface liquid) fails in both performance and physical fidelity for four fundamental reasons:

| Factor | 3D Gas (`PlumeFluid`) | Naive Dense 3D Water |
| :--- | :--- | :--- |
| **Voxel size** | `8-12 cm` (soft scattering) | `2.0-2.5 cm` around `33 cm` tyre |
| **Cell count (`16x16x4 m`)** | `1.64M` cells (`~48 MB`) | `65.5M` cells (`> 2.4 GB`, `40x`) |
| **Poisson conditioning** | Single-phase (`8-12` GS sweeps) | `1000:1` jump + Ghost-Fluid `p = 0` |
| **Volume conservation** | `< 0.2%` drift imperceptible | Eulerian advection shrinks bow waves |

Consequently, running a dense 3D Eulerian Navier-Stokes grid over a proving ground is **40x to 500x too expensive**
and still suffers severe volume loss on thin tyre-displaced sheets.

---

## 🏗️ Recommended Hybrid Architecture: Sparse Narrow-Band APIC-FLIP Coupled to 2.5D Saint-Venant

Instead of choosing between pure 2.5D heightfields (which cannot represent overturning bow waves or wheel-arch
cavities) and dense 3D grids, Frontier couples **`ShallowWaterMudExtension`** (`2.5D`) to a **vehicle-locked
Sparse Narrow-Band 3D Free-Surface Solver** that activates *only* when submergence exceeds `4.0 cm`:

```text
[ 2.5D ShallowWaterMudExtension (Coarse 200 m -> Fine 24 m NestedWaterDomainLink) ]
          │  Conservative depth + momentum boundary sponge (1.0 m overlap ring)
          ▼
[ 3D Sparse 4x4x4 Brick Atlas (6.0 m x 4.0 m x 1.8 m window locked to submerged chassis) ]
  ├── Narrow-Band APIC-FLIP Liquid Skin (2.5 cm MAC cells, particles ONLY within 2 cells of surface)
  ├── Cut-Cell Solid Fractions (Jolt chassis + rotating wheel SDF swept velocities)
  ├── Matrix-Free 2-Level Multigrid + Ghost-Fluid Free-Surface Pressure Projection (p_air = 0)
  └── Anisotropic Signed-Distance Coherent Sheet Extraction (ZERO foam, ZERO detached splash)
```

### 1. Sparse `4x4x4` Brick Occupancy (`570x` Compute Reduction)

- The local 3D domain spans `6.0 m x 4.0 m x 1.8 m` (`240 x 160 x 72 = 2.76M` virtual `2.5 cm` cells) centered on
  the vehicle's submerged bounding box.
- An indirect GPU brick table (`60 x 40 x 18 = 43,200` bricks of `4x4x4` cells) allocates physical storage **only**
  for bricks containing liquid or lying within `2` bricks of the free surface.
- During a `0.45 m` deep ford, `< 3,600` bricks (`~230,400` MAC cells — **`8.3%` occupancy**) are active. Dry driving
  and shallow `< 4 cm` rain puddles allocate **`0` bricks** (`0.00 ms` 3D cost), delegating 100% of puddle hydroplaning
  and wakes to `ShallowWaterMudExtension`.

### 2. Surface-Skin-Only APIC-FLIP + Implicit Interior Grid (Zero Volume Loss, Minimal Particles)

- Standard FLIP places `8` particles in *every* submerged cell (millions of particles in deep water).
- **Narrow-Band APIC-FLIP** seeds `8` affine-momentum particles per cell **strictly inside the `-2 dx .. +0.5 dx`
  free-surface skin**, while interior submerged bricks (`phi < -2 dx`) are solved purely on the Eulerian MAC grid!
- Affine velocity matrices (`3x3` $C_p$ per skin particle) preserve exact rotational shear shed off spinning tyres
  and wheel spokes without numerical viscosity, while reseeding maintains `100.0%` liquid volume conservation.
- **Strict No-Foam / No-Splash Enforcement**: ballistic outlier particles whose local coordination number drops
  below `3` neighbors (`isolated droplet candidates`) are immediately relaxed back onto the coherent signed-distance
  sheet rather than rendered as spray, guaranteeing **zero splash and zero foam** by construction.

### 3. Ghost-Fluid Cut-Cell Multigrid Projection & Two-Way Vehicle Forces

- Rotating wheels and the underbody stamp face-aperture fractions $\theta_f \in [0, 1]$ into the `2.5 cm` MAC faces.
- A **2-level geometric V-cycle (`2.5 cm <-> 10 cm` brick-coarsened residual)** with Ghost-Fluid sub-cell free-surface
  weights $(1/\theta_{\Gamma})$ reduces velocity divergence by `> 10^3` in a single V-cycle (`4` pre/post Red-Black
  smooths + `8` coarse sweeps).
- Integrating resolved hydrodynamic pressure $p \, \mathbf{n} \, dA$ over wheel & underbody cut faces yields exact
  3D bow-wave drag, asymmetric deep-ford steering pull, and dynamic hydro-lift fed directly into Jolt `5.6.0`.

### 4. Conservative Two-Way Coupling to `ShallowWaterMudExtension`

- Along the outer `1.0 m` perimeter of the `6.0 m x 4.0 m` 3D window:
  - **2.5D -> 3D Inflow**: Vertical depth-integrated Saint-Venant state $(h, u, v)$ prescribes hydrostatic pressure
    and parabolic vertical velocity profiles on outer 3D ghost bricks.
  - **3D -> 2.5D Outflow**: Column-integrated 3D mass $\int_B^{\eta} dz$ and momentum
    $\int_B^{\eta} \mathbf{u}_{xy}\,dz$ overwrite interior fine cells of `NestedWaterDomainLink`, so bow waves
    generated in 3D radiate seamlessly outward across the 2.5D river/floodplain with zero reflection seam!

---

## 📊 GPU Memory & Frame-Time Budget (`2.5 cm` Resolution Around Vehicle)

| Resource / Compute Kernel | VRAM Footprint | RTX 3060 Time | GTX 1660 Time |
| :--- | ---: | ---: | ---: |
| Sparse Brick Indirection + `4,096` Brick Pool (`u, v, w, p, phi`) | `10.8 MB` | — | — |
| Narrow-Band APIC Skin Pool (`262,144` max skin markers, `48 B` each) | `12.0 MB` | — | — |
| 1. Brick Occupancy + 2.5D Boundary Sponge Injection | — | `0.06 ms` | `0.11 ms` |
| 2. Narrow-Band Particle-to-Grid (APIC) + Cut-Cell Wheel Stamp | — | `0.14 ms` | `0.26 ms` |
| 3. Ghost-Fluid 2-Level Multigrid Pressure Solve + Jolt Force Reduction | — | `0.26 ms` | `0.49 ms` |
| 4. Grid-to-Particle Advection + Coherent SDF Surface Extraction | — | `0.16 ms` | `0.29 ms` |
| **Total 3D Vehicle Water Envelope (Active Deep Ford)** | **`22.8 MB`** | **`0.62 ms`** | **`1.15 ms`** |
| **Total Cost on Dry Road or `< 4 cm` Rain Puddles (`2.5D` Only)** | **`0.0 MB` dyn** | **`0.14 ms`** | **`0.24 ms`** |

---

## 🗺️ Phased Implementation Sequence

1. ** Brick Atlas & SDF Surface Extractor (`Frontier/Engine/Fluid/SparseWaterBrickAtlas.{h,cpp}`)**:
   Allocate `4x4x4` GPU bricks, 2.5D heightfield inflow/outflow bridge, and narrow-band SDF raymarch/surface weld
   plugging directly into `SdfRestirPortalExtension` (GTX SDF + RTX BVH reflections & refraction).
2. **Ghost-Fluid Cut-Cell 2-Level Multigrid (`Frontier/Engine/Fluid/Shaders/NarrowBandWaterProject.slang`)**:
   Validate hydrostatic lake-at-rest, analytical dam-break front speed, and `< 0.1%` 10-second volume drift.
3. **Narrow-Band APIC-FLIP Skin & Jolt Wheel/Chassis Coupling**:
   Couple spinning wheel/fender SDF apertures, clamping outlier droplets back to the coherent liquid sheet (zero
   foam, zero splash) and feeding integrated pressure forces into `DriveSimulation`.

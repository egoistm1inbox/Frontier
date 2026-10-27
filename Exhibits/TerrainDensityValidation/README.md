# Terrain Density Validation

Runnable proof of the Terrain Density Field mathematics specified in `Engine/Terrain/` and planned in
`Documentation/Plans/Ongoing/TerrainDensityField-Plan.md`. The reference implementation is CPU/NumPy
and deliberately mirrors the production evaluation rules term for term (ρ > 0 solid; strata composed
in stack order through blend categories; outward normal = −∇ρ).

## What it proves

- One density field holds alpine terrain **and** a spline-carved through-cave, a domain-warped
  overhanging face, a rock arch, and a spire — verified by counting vertical columns with more than
  one solid interval (a heightfield scores exactly zero there, by construction).
- The field extracts to a watertight polygon surface (Surface Nets here — Dual Contouring's
  mass-point degenerate case; production uses Dual Contouring + QEF for sharp features).
- The Mei–Decaudin–Hu shallow-water pipe model (the `ShallowWaterSimulation` design) carves
  dendritic drainage, deposits sediment downstream, relaxes talus, and produces the Flow / Wear /
  Deposition channels; priority-flood then yields lake equilibrium surfaces.
- The memory model of the research document (§3.1) recomputes exactly.

## Run

```bash
pip install numpy matplotlib pillow
python3 Exhibits/TerrainDensityValidation/Code/TerrainDensityValidation.py
```

Exit code 0 = every check passed. Outputs: `Images/` (slices, extracted surface, erosion, water),
`Results/Metrics.json`, `Results/ExtractedSurface.obj`.

## Scope limits (stated, not hidden)

- Value noise stands in for OpenSimplex; the algebra under proof is noise-agnostic.
- Erosion runs on the top-surface projection of a heightfield fixture, not yet on multi-crossing
  surface columns — that binding is `SurfaceColumnIndex` in the production design (Phase 4).
- Semi-Lagrangian sediment advection is not exactly mass-conservative; the budget remainder is
  reported, not concealed (see `Results/RESULTS.md`). Production uses a flux-form advection.
- All timings are single-thread CPU reference numbers. No GPU claims are made.

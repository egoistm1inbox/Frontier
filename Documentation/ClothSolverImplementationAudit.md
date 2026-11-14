# Cloth Solver Implementation Audit

**Audited source:** [`SultanAladin/Frontier-1`](https://github.com/SultanAladin/Frontier-1), branch `arena/56d5516e-frontier-1`, commit [`125891240113df9a94b6ed892d49176f460bb`](https://github.com/SultanAladin/Frontier-1/commit/125891240113df9a94b6ed892d49176f460bb)  
**Audit date:** 2026-11-14  
**Scope:** `Experimental/ClothEditor/`, the supplied Stable Cosserat Rods, FPB, PIE, and Nature links, plus the six solver modes A–F.

## Executive conclusion

**No — the project should not claim that all of the supplied research papers have been implemented correctly or faithfully.** It is a working, deterministic browser cloth **prototype** with several research-inspired solvers, and it has useful pieces of A, B, and PIE. However, several labels overstate what the code does:

- **B / XPBD** is the most recognizable implementation of its named method and is the sensible runtime choice.
- **A / AVBD** is a credible custom vertex-block Newton/VBD-style baseline, but it has not been verified against a reference AVBD implementation or published benchmarks.
- **C / SCR** is visually useful, but it is a **hybrid sheet solver inspired by Stable Cosserat Rods**, not a faithful Stable Cosserat Rod implementation. Its attractive folds come primarily from the shared patch and hinge projections.
- **D / FPB** is **not an implementation of Guo et al.'s knot-and-tie system**. The code contains simple Bézier data and a generic contact-enhanced solver, but omits the paper's template tessellation, mapping, initialization, CCD, contour-minimization collision resolution, PCG solve, and fallback.
- **E / JGS2** is an experimental, hand-tuned Schur-like block solver. Its off-diagonal coupling is heuristic rather than assembled from the model, so it cannot honestly be presented as a verified reproduction of the cited paper.
- **F / KES-AA** is a custom orthotropic shell with an Anderson step. It uses a few KES-like parameters, but it is not calibrated from a KES-FB measurement set and is not a reproducible implementation of a KES cloth model.
- **PIE** correctly carries over the scalar polynomial and its constants, but only turns its scalar result into one uniform mesh spacing. The paper's core sizing map, local sources, transitions, anisotropic mesh generation, Poisson sampling, and Delaunay generation are absent.
- The supplied **Nature** paper is represented only by a code comment and two hard-coded aerodynamic constants. It is not validated as a reproduction of that work.

So the app is suitable for **side-by-side visual exploration**, but not for research claims, calibrated garment prediction, or a paper-comparison ranking until the missing reference tests and paper-specific pipelines exist.

## What was run

I cloned the supplied branch at the commit above and ran:

```bash
cd Experimental/ClothEditor
node ClothValidation.mjs
```

**Result:** passed after **6 minutes 26 seconds**.

The run checks local files/DOM wiring, repeats identical CPU runs for all six modes, runs four preset garments for 180 frames, asserts finite positions, loose seam/penetration/stretch limits, wind/drag wake-up, PIE scalar ranges, knot-template sample ranges, and export buffer sizes.

Observed final RMS speeds for the two garments relevant to the report were:

| Mode | Couture dress | Tailored tee |
|---|---:|---:|
| A `avbd` | 39.1 mm/s | 4.8 mm/s |
| B `xpbd` | 8.4 mm/s | 6.7 mm/s |
| C `scr` | **3.1 mm/s** | **3.8 mm/s** |
| D `gn_knot` | 36.8 mm/s | 11.0 mm/s |
| E `jgs2` | 39.8 mm/s | **57.9 mm/s** |
| F `kes_aa` | 24.7 mm/s | 8.2 mm/s |

This supports the narrow observation that C is the quietest of these **particular CPU scenes** and that E remains comparatively noisy on the tee. It does **not** establish real-cloth accuracy or fidelity to the papers.

### Important limits of the passing validation

1. **Determinism is same-process determinism only.** The test constructs two identical CPU solvers and compares them after 24 frames. It does not test different browsers, CPUs, operating systems, GPU adapters, or WebGPU-vs-CPU agreement.
2. **The WebGPU path is not executed.** The test checks WGSL source strings and exported functions, but never creates a GPU device or compares GPU positions. C–F explicitly fall back to CPU in [`WebGpuClothAccelerator.js`](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/WebGpuClothAccelerator.js#L824-L833).
3. **There is no image/visual regression, drape reference, or material-calibration test.** A no-NaN and low-penetration result cannot prove that folds or “hand” are correct.
4. **The reported puff/jacket metric is not tested.** The checked-in validation never computes garment bounding-box volume. The comparison report says values came from `/tmp/bench.mjs`, but no benchmark script or captured raw benchmark data is checked into the branch.
5. **The checks are mostly invariant checks authored beside the implementation.** They are worthwhile smoke tests, not independent validation against paper equations, reference code, or published figures.

## Audit by option

| Option | Verdict | Evidence and assessment |
|---|---|---|
| **A — AVBD** | **Partial / plausible custom baseline** | It does perform a color-batched local 3×3 position solve with a hand-authored membrane, seam, collision, and step-bound model in [`_stepSubstepAVBD`](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/OrthotropicClothSolver.js#L457-L879). This is reasonably described as AVBD/VBD-inspired. It still needs a documented derivation, parameter units, convergence tests, and numerical comparison to an independent AVBD implementation before claiming faithful AVBD. |
| **B — XPBD** | **Partial / closest solver match** | It uses the characteristic XPBD compliance term `alphaTilde = 1 / (k h²)`, constraint multipliers, repeated projections, and color batches in [`_stepSubstepOrthotropicXPBD`](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/OrthotropicClothSolver.js#L880-L1120). The constraints and constitutive law are custom, so it is not a reference implementation, but the XPBD label is substantially more defensible than the research-paper labels below. |
| **C — Stable Cosserat Rods** | **No — rod-inspired hybrid, not faithful SCR** | SCR needs material-frame/orientation dynamics, bending/twist strain, rod topology, and a coupled position/orientation energy. Here the solver assigns a quaternion to every structural edge of a triangular sheet, allocates `edgeTwist` but never uses it, ignores the director in its positional force (`void d3`), then obtains sheet behavior through the shared `_clothPatchProjection` and `_hingeBendingProjection` passes ([C implementation](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/OrthotropicClothSolver.js#L1227-L1425)). The nice folds are real output of this hybrid, but not evidence that the Stable Cosserat Rods algorithm was ported. |
| **D — Guo et al. FPB** | **No — key paper pipeline is missing** | The FPB paper's feature is a pipe template with tessellation, selected-region-to-pipe mapping, penetration-free initialization, collision handling, and quasistatic simulation. The app only stores three short, hand-written Bézier span lists and samples them ([templates](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/PatternDraftNetwork.js#L15-L77)). `sampleKnotTemplate` is imported only by the validation script; the interactive runtime does not map fabric onto a knot template or create its pipe collider. D borrows the lifetime weight and has a contact-oriented local GN pass, but does not reproduce FPB's algorithm. |
| **E — JGS2** | **No / unverified heuristic** | The code calls this an Eq. 12 Schur solve, but it invents an off-diagonal coupling as `0.25 / degree × local-diagonal-scale` instead of assembling `H_ij` from the membrane/hinge/seam/contact model ([coupling](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/OrthotropicClothSolver.js#L2229-L2302)). Its allocated `jgsSchur` buffer is also unused. Treat E as a useful experimental block solver, not a verified JGS2 implementation. The 57.9 mm/s tee residual warrants caution. |
| **F — KES-AA** | **No — KES-inspired shell only** | The solver has an orthotropic local shell solve plus a guarded Anderson(2) acceleration. The six textiles are hard-coded values, with no KES-FB test curves, measurement provenance, fitting procedure, or validation dataset. 2HB/2HG are converted into ad-hoc damping and several custom caps/projections. It can be a good experimental drape mode, but “measured hand-feel fidelity” is unsupported. |

## Supplied papers: direct check

### Stable Cosserat Rods

The official project describes a CPU codebase for rod examples and points to a separate yarn-cloth project for parallel yarn cloth. The audited mode is not constructed from rod chains with twist/bend rest data. In particular, an unused `edgeTwist` field and the generic cloth patch/hinge post-passes make the difference visible in the source. Rename it to **“Cosserat-inspired edge-frame hybrid”** until a real rod network and coupled material-frame energy are implemented.

### Guo et al. 2025 — *Fast Physics-Based Modeling of Knots and Ties Using Templates* (FPB)

The paper uses a parametric pipe template, template tessellation, continuous collision detection/radius adjustment, rectangular/circular fabric mapping, penetration-free initialization, a unified quasistatic GN system, and an intersection-detection fallback. None of the template tessellation, mapping, pipe collision, initialization, CCD/radius adjustment, block-Jacobi PCG, or fallback path is present in the app.

The current D solver does share a few **ideas** with the paper—persistent contact ages, a GN-flavored local block, point-triangle/edge-edge handling in the generic post-pass—but that is insufficient to call it FPB. The reported “cool drapes” are valid visual feedback, not proof that the paper is implemented.

### Zhang et al. 2025 — *Physics-inspired Estimation of Optimal Cloth Mesh Resolution* (PIE)

This is the strongest paper-specific partial implementation:

- The `c1 r⁶ + c2 r⁴ = B/E` scalar equation and paper constants `c1 = 32.08`, `c2 = -1.876e-4` are present in [`estimateClothResolutionPIE`](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/TextileCatalog.js#L258-L319).
- It calculates warp and weft radii.

But the result is reduced to one scalar `authoringSpacingMm`, then applied as a uniform structured mesh spacing ([network generation](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/PatternDraftNetwork.js#L234-L269)). Thus it misses the paper's main practical contribution: the continuous spatial sizing map, local sources for shirring/folds/stitching/down fill/predicted collision zones, transition rules, anisotropic spacing, Poisson-disk sampling, and constrained Delaunay triangulation.

Call it **“PIE global spacing estimate”**, not “PIE auto-resolution,” until that sizing-map pipeline exists.

### Nature DOI `s41567-022-01788-5`

The code has only one attribution to this link: a comment above an aerodynamic force with hard-coded `cNormal = 0.62` and `cFriction = 0.048` ([source](https://github.com/SultanAladin/Frontier-1/blob/125891240113df9a94b6ed892d49176f460bb/Experimental/ClothEditor/Engine/OrthotropicClothSolver.js#L1122-L1183)). There is no derivation, unit conversion, parameter fitting, validation scene, or citation entry. It should be described as a **heuristic quadratic drag / skin-friction model**, not as an implemented result from that paper.

## Your observations: C, AVBD, XPBD, D, E, F

| Your observation | Audit result |
|---|---|
| **C makes the most pleasing folds** | Agree as a **visual prototype result**. It also had the lowest residual speed in the supplied CPU test. The cause is the hybrid edge-frame plus shared hinge/patch behavior, not a verified SCR implementation. Keep it as an art-directed authoring preview, but rename it honestly. |
| **AVBD has better collision and drape** | A is a reasonable quality baseline: it has the most developed local solve, seams, body SDF contact, and a GPU path. Its body collision accuracy still needs a reference dataset; do not infer correctness from visual closeness alone. |
| **XPBD is likely best for games** | Agree. B is the most portable, understandable, GPU-friendly option. Use it for runtime, with mesh LOD and limited self-collision. It is the only recommendation here that is both technically conventional and practical today. |
| **D has cool drapes but can freeze after switching** | The branch contains a memory-reset attempt for solver switching, and the validation drag test now moves D after relaxation. But D remains neither FPB nor robustly verified. The reported switch fix is a regression test, not a full interactive/GPU switch test. |
| **E/F looked like puffed jackets** | Both now advect toward an inertial target before their local solve, so the apparent root cause has been addressed in code. However, there is no checked-in volume/puff regression or browser visual baseline. E is still noisy in the tee test; F remains a hand-tuned shell. Treat both as experimental until image and volume tests pass. |

## Recommendation

### What to use now

1. **Game runtime:** **B / XPBD.** Keep it simple, clearly named, and GPU-tested.
2. **Quality authoring baseline:** **A / AVBD-style block solve**, after adding real calibration and collision regression tests.
3. **Most attractive visual folds today:** **C**, but market it as a **Cosserat-inspired hybrid preview**, not Stable Cosserat Rods.
4. **Do not rank D, E, or F as paper-backed alternatives yet.** Keep them behind an Experimental label.
5. **Use PIE as preprocessing, not as a sixth simulation solver.** Finish its sizing-map pipeline once and feed the generated mesh to A/B/C rather than treating it as a competing drape algorithm.

### Required work before the research claims are made

1. Add an explicit provenance table: paper, exact equation/algorithm section, code function, approximation, omitted component, test scene.
2. Build a paper-reference test suite: cantilever/rod/twist for SCR; knot mapping and penetration-free template cases for FPB; PIE meshes against the paper's spacing-map scenes; timestep/iteration/mesh-resolution sweeps for A/B/E/F.
3. Add browser WebGPU tests and CPU–GPU tolerance comparisons for A/B. Do not call the system cross-platform or bit-exact until that exists.
4. Check in the benchmark driver, raw CSV/JSON, hardware/browser metadata, seeds, and generated images. The current `/tmp/bench.mjs` numbers are not reproducible from the repository.
5. Add bbox-volume, body-clearance, fold-spectrum, seam-error, energy/constraint-residual, and visual-image regressions. This directly tests the puffed-jacket and premature-freeze reports.
6. Either implement the omitted FPB/PIE pipelines or relabel their current helpers as **inspired by** rather than **implemented from** those papers.
7. Replace hand-authored textile numbers with documented measurements or explicitly label them as artistic presets. KES-FB claims require KES test curves and a fitting/validation protocol.

## Bottom line

**Best current product split:** XPBD for gameplay, AVBD-style local solve for the dependable authoring baseline, and C only as an experimental visual-fold mode. Your preference for C's appearance is valid; the implementation claim behind its label is not. D and PIE especially should be corrected in the UI/docs before they are presented as implementations of the supplied research.

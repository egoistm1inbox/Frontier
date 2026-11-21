# Fluid Editor checks

Evidence for the combined fluid editor (`Experimental/FluidEditor/`): the c7egoist Fluid Studio solver with the lighting and
pressure ideas taken from the other Fluid Editor.

## Run
```
python3 Experimental/FluidEditor/Serve.py 8100
cd Experimental/FluidEditor && node FluidValidation.mjs
node Exhibits/FluidEditor/Code/ProjectionCompare.mjs
cd <folder with playwright-core and @sparticuz/chromium>
AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node Exhibits/FluidEditor/Code/FluidCapture.cjs http://localhost:8100/ out.png preset-campfire 150 32
```
`FluidCapture.cjs` loads a preset, runs the solver for N fixed 1/60 s steps without drawing, hides overlays and saves the viewport.
The images use a 32-cell grid because the software renderer needs about 4 s per step at full resolution.

## Images
| File | Shows |
|---|---|
| `FluidEditor-1-CampfireBefore` | Campfire, 2.5 s, original Fluid Studio |
| `FluidEditor-2-CampfireCombined` | Same frame, combined: the plume shadows the floor and the flame lights it orange |
| `FluidEditor-3-SmokeBefore` | Smoke Plume, 3 s, original |
| `FluidEditor-4-SmokeCombined` | Same frame, combined: floor shadow, darker underside, same lit-side brightness |
| `FluidEditor-5-InfiniteGrid` | Infinite Grid · Plume (sparse tiles) running the new passes |

## Results (2026-11-16)
- `FluidValidation.mjs`: 349 checks pass, and every changed shader compiles with glslang in both fixed and sparse forms (`ValidationResults.txt`).
- Browser: Campfire, Smoke Plume and Infinite Grid · Plume run with `errors []`.
- Divergence left inside the domain after projection, same 48³ plume (`ProjectionResults.txt`):

| Scheme | Step 1 | Step 10 | Step 30 |
|---|---|---|---|
| Original Fluid Studio (cleared, 36 Jacobi) | 45.2% | 67.2% | 72.2% |
| Other Fluid Editor (warm start, 22 Jacobi) | 57.8% | 50.4% | 59.5% |
| **Combined (warm start, 36 Jacobi)** | **45.2%** | **43.8%** | **59.1%** |

  A fully converged solve leaves 6–9%, so this is still a visual solver, not an incompressible one. The test models the warm start
  without the editor's 0.96 retain factor.
- ⚠️ Headless Chromium with the software renderer (SwiftShader) only; looks are not judged on a real GPU.

# Particle editor checks

Evidence for the standalone particle editor (`Experimental/ParticleEditor/`).

## Run
```
python3 Experimental/ParticleEditor/ServeParticleEditor.py 8097
cd <folder with playwright-core and @sparticuz/chromium>
AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node Exhibits/ParticleEditor/Code/ParticleEditorCheck.cjs http://localhost:8097/ <outdir> [only]
```
The script loads each case with `fresh=1&capture=1` (no animation loop, one frame per seek) and saves a screenshot. It then clicks every outliner
row, toggles a layer, swaps a palette and round-trips a recipe, and reports console errors.

## Images
| File | Shows |
|---|---|
| `ParticleEditor-1-LaunchRecipe` | Launch reveal stack (Vehicle transition + Light speed) at 9.2 s with the layer inspector |
| `ParticleEditor-2-AeroRecipe` | Aero study (Airflow + Digital twin) |
| `ParticleEditor-3-ChargingRecipe` | Charging bay (Charging + Clone field) |
| `ParticleEditor-4-OrbitGarden` | Orbit garden (Orbits + Flora) |
| `ParticleEditor-5-FibreWaveSolo` | Fibre wave on its own |
| `ParticleEditor-6-CameraPage` | Particular on its own, Camera inspector page |
| `ParticleEditor-7-RecipePage` | Recipe page (built-in stacks, export / import) |

## Results (2026-11-16)
- 7 captures, 16 outliner rows clicked, recipe round trip correct, `errors []`.
- When served from its own folder, every request (page, styles, fonts, modules, facets, three.js) resolved inside `Experimental/ParticleEditor/`, with no 404s.
- The CabinHmi Filament showroom, which now imports the engine from the app, renders byte-identical to its committed images.
- ⚠️ Headless Chromium with the software renderer (swiftshader) only.

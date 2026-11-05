# Frontier

An Africa-sized continent (8000 km × 8000 km) built entirely from signed distance fields. It renders in
WebGL2 with sphere tracing, uses a camera-centred sparse clipmap for detail, stays within a **1 GB VRAM**
budget, and has in-place sculpting tools.

Read **[docs/DESIGN.md](docs/DESIGN.md)** for the architecture, the memory budget, and the known limits.

## Quick start

```bash
npm install
npm run dev        # opens on http://localhost:5173 (also exposed on 0.0.0.0 for the preview)
```

Requires a browser with WebGL2 and `EXT_color_buffer_float` (any current desktop Chrome, Edge or Firefox).

## Controls

| Key | Action |
|---|---|
| Click | capture mouse (pointer lock) |
| W A S D | move (speed scales with height above ground; Shift ×4, Ctrl slow) |
| Space / E, Ctrl / Q | up / down |
| B | toggle sculpt mode |
| 1 / 2 / 3 / 4 | Raise / Lower / Smooth / Flatten (enables sculpt mode) |
| [ / ] | brush radius (1–12 m) |
| − / = | brush strength |
| Hold LMB | sculpt at the crosshair |
| F | toggle soft shadows |
| P | pause streaming (for debugging) |
| Esc | release the mouse |

The camera starts near Benoni, Gauteng.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck + production build |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Node unit tests (layout, slot pool, coastline SDF, macro SDF, residency, pool budget) |
| `npm run check:glsl` | Compiles every fragment program with glslang (catches GLSL errors without a GPU) |

## Layout

```
src/config.ts              all sizes and budgets (single source of truth)
src/world/                 continent: outline, coastline 2D SDF, macro SDF (CPU reference), noise
src/clipmap/               layout math, slot pool, residency / streaming manager (GPU-agnostic)
src/gpu/                   WebGL2 helpers, atlas + passes (generate / copy / sculpt), raymarch renderer
src/gpu/shaders/           GLSL: GEN chunk (noise, macro SDF; generation only), CLIP chunk (clipmap sampling), pass programs
src/sculpt/brush.ts        sculpt tools and the dab pipeline
src/app/                   fly camera, styles
src/main.ts                app shell, input, HUD
tests/                     Node tests (run with npm test)
scripts/check-glsl.mjs     GLSL validation
```

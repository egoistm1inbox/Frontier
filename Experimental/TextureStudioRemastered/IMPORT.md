# Texture Studio (remastered) — import note

Copied unchanged from `unassignedinbox/Frontier`, branch `arena/5922d41b-frontier` (commit `1828eae`), folder `Experimental/TextureStudio`
(tree `6d910eb`). That version carries the dynamic material collection added in `c20034f` (2026-11-15): Derez Lattice Dissolve,
Molten Magma Crust (lava) and eleven other animated materials in `Engine/Materials/animatedVfxCatalog.js` / `animatedVfxKernels.js`.

It sits beside the older Vite/React `Experimental/TextureStudio`, which ProjectZeroEditor still imports (Pattern, Stamp and Baking).
Only paths were changed: `Serve.py` and `TextureStudioValidation.mjs` point at `/Experimental/TextureStudioRemastered/`.
It imports `../Shared/UvTextureBridge.js`, which is identical in this repository.

## Run

```bash
python3 Experimental/TextureStudioRemastered/Serve.py 8120
```

Open `http://<host>:8120/` (redirects to `/Experimental/TextureStudioRemastered/`).

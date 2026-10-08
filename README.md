# Frontier

Browser experiments for the Frontier terrain work — no bundler, no build step. Open any of them
straight from GitHub Pages (or `python3 -m http.server` in the experiment's folder):

- **[Terrain generator](Experimental/CliffGenerator/index.html)** — procedural terrain in a
  Frontier‑Editor‑style UI (outliner · viewport · inspector): domain‑warped relief, Gaea‑style
  broken stratification with substrata, **rugged outcrops** (shattered plates + crevices),
  droplet/thermal erosion, simulated river networks with lakes, drawn roads/rivers/lakes, rock
  scatter, an analytic world‑space surface shader — and true‑3D SDF cliff chunks that stay
  watertight with the heightfield mesh. See
  [Experimental/CliffGenerator/README.md](Experimental/CliffGenerator/README.md) for the pipeline,
  the SDF↔heightfield topology contract and the headless checks.
- **[SDF cliff lab](Experimental/SdfCliffLab/index.html)** — the isolated proof of the hybrid
  heightfield ↔ SDF technique (marching tetrahedra, bed undercuts/overhangs, seam checks).

Deployed to GitHub Pages from `main` by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

# Viewer Redesign — Evidence

Actual headless-Chromium captures of the imported viewers and each card prototype.
Brief: `Documentation/Rules/ViewerRedesignBrief.md`.

## Captures (2026-11-16)

| Image                                             | Shows                                                       |
|---------------------------------------------------|-------------------------------------------------------------|
| `Images/Baseline-ComponentViewer.png`             | Imported Component Viewer, unchanged, port 8095             |
| `Images/Baseline-AssetViewer.png`                 | Imported Asset Viewer, unchanged, port 8096                 |
| `Images/Prototype01-TierDescent-Default.png`      | Tier Descent, Body, seams slide, budget-elected tier 1      |
| `Images/Prototype01-TierDescent-ForcedHover.png`  | Tier 3 forced over budget, Materials shading, cluster pin   |
| `Images/Prototype01-TierDescent-RimPinned.png`    | Rim, seams pinned, budget dragged down to tier 0            |
| `Images/Prototype01-TierDescent-SideClay.png`     | Orientation check: side view, clay shading                  |

## Verification

| Check                                   | Result                       |
|-----------------------------------------|------------------------------|
| `CheckComponentViewer.mjs`              | 20 checks passed             |
| `SmokeComponentViewer.mjs` (jsdom)      | 0 errors                     |
| `SmokeAssetViewer.mjs` (jsdom)          | 0 errors                     |
| `SmokeGeometryCompile.mjs` (jsdom)      | 0 errors                     |
| Tier Descent page console               | 0 errors across all captures |
| Tier per-level triangle sums            | equal `levels[].triangles` for Body, Tyre, Rim |

## Reproduce

Platform: Linux sandbox, Node 22, Chromium 131 (`@sparticuz/chromium`) with SwiftShader WebGL.

```bash
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright-core@1.49 @sparticuz/chromium@131
cp <repo>/Exhibits/ViewerRedesign/Scripts/*.cjs /tmp/pw/
export AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x   # makes the package unpack its NSS libraries
node CapturePage.cjs http://localhost:8095/ out.png 1600 900 6000
node CaptureTierDescent.cjs http://localhost:8095/Experimental/ComponentViewer/Prototypes/TierDescent/TierDescent.html out
```

⚠️ Software WebGL in a headless browser; this is not a Windows desktop or physical-GPU capture, and the browser
prototype does not prove the C++ editor renders the same result.

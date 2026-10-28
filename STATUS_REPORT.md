# 🛰️ Frontier — Status Report — Branch `arena/7c640a4d-frontier` vs `arena/672a179a-frontier` (2026-10-28)

> Context: you asked the AI to **port everything from VehicleHMI into C++** — UI + clouds + fog + RESTIR + other systems — with a *verify-then-port* discipline that shows visual proofs. The previous agent verified a lot (especially RESTIR) with heavy mathematical analysis and tuned magic numbers, but **ReSTIR GI is still incomplete**. The next priority remains: **finish RESTIR + rendering**, then other systems.

> Canonical reference branch: [`eosclient0001-rgb/Frontier@arena/672a179a-frontier`](https://github.com/eosclient0001-rgb/Frontier/tree/arena/672a179a-frontier) — 50 commits beyond `bf2c4c48`. Your current session branch `arena/7c640a4d-frontier` is **empty** (only `bf2c4c48 Initial commit`), so the work below is **not yet on this branch** and needs to be cherry-picked / merged in.

---

## 0️⃣ Branch map — where is the work?

* `main` (`bf2c4c48`) — empty scaffold.
* `arena/7c640a4d-frontier` (this session) — **no ported systems yet**; `git status` clean; `git log bf2c4c48..HEAD` empty.
* `arena/672a179a-frontier` (previous agent, `eosclient0001-rgb`) — **all verified work lives there**. 1999 exhibit files, 312 Engine-owned files (`Frontier/Engine/*` + `Engine/*`). All evidence on **SwiftShader CPU Vulkan (Subzero, type 4)**, not a physical GPU.
* Other `egoistm1inbox/Frontier` arena branches (`984077cd`, `88c493dd`, `e784e651`, …) are **WebGPU terrain / landscape-studio / foliage / VFX / terrain-editor** experiments — unrelated to the RESTIR core and not merged.

**Bottom line from `Documentation/Tracker.md` (1166 lines) and `Exhibits/RecoveryAudit/RendererStatus.md`:**

> *ReSTIR GI is not complete or connected to the editor. Current repo has a bounded SwiftShader software-traced research path with temporal/spatial replay, dynamic-light/blocker fixtures and readbacks. No production scene/render loop, no general dynamic/deforming reprojection, no converged denoising, no physical GPU path.*

---

## 1️⃣ Emoji legend

* ✅ **Proven + tested + ported to C++ Engine**
* 🧪 **Proven/tested with visual proof, but NOT editor-integrated / not production pipeline**
* 🚧 **Partial — bounded fixtures pass, but major gaps remain**
* 🔴 **Not established / deferred**
* ⚠️ **Caveat / scale-dependent / statistical limit**

---

## 2️⃣ System-by-system — what has been proven, what is actually in C++

### ☁️ Clouds — 🧪 ✅ (tested & payload ported, but not editor-rendered)

* **Tested:** 32 vs 64 sample working preset; 32 cloud view/cube/surface-shadow steps, 6 self-shadow, 32 fog-shadow per fog sample. Full-image linear RGB RMSE `0.00187–0.00207` vs finite 64-step reference; native/Vulkan max discrepancy `1.78e-5`. Historical 4-octave density preserved, 320×200 captures, 160×100 comparison images (`CloudBudgetComparison.png`, `CloudPreview`).
* **Ported:** `Frontier/Engine/Rendering/CloudField.{h,cpp}`, `MediumRadiancePayload.{h,cpp}` (7×float4 ABI, 64 cloud cases byte-identical SHA-256 `34dbcaa68…`), `Shaders/LightInfluence.slang` marching. Builders guarded in `Exhibits/LightCompute/MediumRadiancePayload.md` — 37 invalid-input rejections pass release + ASan/UBSan.
* **Still missing:** ❌ Full GPU atmosphere LUT, scene/editor linkage, measured sky calibration, cloud noise/advection, cloud shadows beyond single-scatter. `RunCloudPreview.sh`, `RunClouds.sh` are exhibit hosts, not editor viewport.

### 🌫️ Fog / Volumetrics — 🧪 ✅ (payload ported, but not production volume renderer)

* **Tested:** Shadowed single-scattering fog (extinction `0.0015/m`, `450 m` height — corrected from old `0.0007/650 m` docs). 654 camera rays + 270 surface arrivals (max RGB error `5.2e-5`), 936 native+Vulkan probes (max `1.01e-5`), cloud-shadowed shafts (`FogSkyComparison.png`, `FogComparison.png`), emissive-triangle-in-volume single scattering (4×160×100 frames, `FogFacets.json`, max `1.59e-5`).
* **Ported:** `FogMedium.{h,cpp}`, `MediumRadiancePayload.{h,cpp}` (4×float4 fog ABI, colour deliberately not packed), `Shaders/LightInfluence.slang` `IntegrateFogScattering` with exact `expm1` optical depth, HG phase, BVH occlusion.
* **Still missing:** ❌ Regular view marching beyond 32 midpoints, temporal fog, multiple scattering, production scheduling, editor integration. `--fog-checks` fixture is small sky-only, homogeneous density, no geometry/direct-light stress.

### 💡 Lights — Analytic + Emissive — 🧪 ✅ (bounded, global CDF ported)

* **Tested:** Clustered point/spot/synthetic IES cells — non-overflow lists match exhaustive summation (`ClusterSpotIes.md`, `Results/ClusterSpotIes-*.txt`). 2,016 area-emitter quadrature probes (max `1.54e-8`), 922 volumetric fog probes (max `7.09e-7`). Bright-blocked vs unblocked variance studies (uniform vs power vs 50/50 mixture: `0.181×` unblocked, `18.26×` blocked).
* **Ported:** `LightInfluenceSpace.h`, `CandelaDistribution.h`, `RadiantFacetDistribution.{h,cpp}` — global two-sided area/luminance CDF (4,096 facets byte-identical, 18 guard cases), `IlluminationUnits`, `ClusterNesting`. Old builder removed, Engine CDF consumed by LightCompute.
* **Still missing:** ❌ **Clustered emissive triangles** (global CDF only), broad IES/scene coverage, production submission, editor linkage.

### 🔄 ReSTIR GI — Core port (the current agent's heavy-lifting) — 🚧 (most verified, but *not finished*)

**What the agent actually did — mathematical + engineering:**

* moved intake to **single authoritative Engine home:** `PathReplayFootprint.h` (144-byte receiver/facet records), `PathReplayDomain.{h,cpp}` (BVH/material/receiver guards, emissive-index compiler, exact-input snapshots), `PathReplayVulkan.{h,cpp}` (Vulkan recorder, does **not** submit/present — caller owns buffers/sync/history), `LightComputeFootprint.h` (128-byte push ABI), `Shaders/PathReplayReservoir.slang`, `PathReplaySampleHistory.slang`, `PathReplayReconstruction.slang`.
* added **bounded initial candidates** (1–4 fresh paths, single-candidate default, history cap `64→1` on candidate change, colour reset) — 20 default-mode images bit-identical to `b0cf5c9` shader.
* added **strict diffuse camera reprojection** (static, untextured, exact world-point/normal/material match; `PathReplayHistoryDomain` camera-only decision; snapshots BVH bounds/corners). `32×32` fixture: `290` retained, `734` fresh, red RMSE `0.03290→0.01055` after 8 frames; half-pixel shift accepts zero (deliberately narrow).
* added **bounded temporal colour reconstruction** (gather/finalize stages, `32×32` half-blocked emitter: RGB RMSE `0.3193→0.07184` diffuse, `0.3740→0.08401` rough-opaque; 11 malformed-guide rejections pass).
* added **GGX/cosine mixture proposals, uniform/power emitter mixture, area/luminance-weighted facet replay** — measured SD ratios `0.138×` cosine → GGX (rough-metal env), `0.671–0.799` mixture vs uniform (floor), but `1.515` worse in object-green; per-sample second-moment bound `2×` uniform is **not** a variance guarantee.
* added **rough GGX + albedo-texture replay** (single-stratum, atlas Pyramid) — hemisphere quadrature, 4-hit room refs, 33 invalid-input cases, 2-hit relighting; 14 raw/preview PNGs byte-identical after reserved-optics fix.
* added **multibounce camera/blocker replay** (`ReplayDynamicCamera.md`, `ReplayCameraReprojection.md#four-bounce`): 4-bounce, 4-candidate SwiftShader fixture, `835,584` CPU paths over 816 points, `1,187,840` CPU paths over 290 exact points; raw/reprojected red RMSE `0.2986/0.1012` (latter uses 8 prior frames, **not equal-time**).
* **new opt-in subpixel mode (2afe88d → 3de9061):** retains up to 3 *unselected* fresh seeds, retraces them at current diffuse surface, averages with 1 current fresh path. Does **not** reuse old radiance, cannot combine with reservoir reuse or colour reconstruction. `32×32` half-pixel (`0.03125` world units) fixture: `970` banks accepted, `54` rejected, `22` changed-token disocclusions **all rejected to fresh**, `10` changed-visibility paths recomputed correctly (per-seed oracle, max RGB error `0`, 11 edge-ambiguous excluded, `0.00028 m` SwiftShader direction shift acknowledged). One-bounce red RMSE `0.29229→0.15494`; 4-bounce half-pixel: **`813,056` CPU paths, 16 GPU batches — red RMSE `0.1530` (four fresh) vs `0.1517` (four current paths including 3 retraced seeds)**. Paired mean diff `−2.6e-5 ± 0.00261` batch SE. **Explicit caveat: equal path count ≠ equal time/total work; not a speedup claim** — retraced needs prior frames + bank traffic. 7 corrupt-bank + 7 invalid-request controls pass, `0.25` world-unit cap is scale-dependent.

**Verification bar the agent held:**

* **5/5 CTests pass** in Release *and* Host ASan/UBSan (`PathReplayDomainValidation`, `PathReplayVulkanValidation`, `RadiantFacetValidation`, `MediumRadianceValidation`, `PathReplayArchiveValidation`). Shader/driver not sanitized.
* Independent double-precision CPU references (Brute-force triangle intersection, `mt19937_64`, different cosine frame), numerical `128×128` vs `64×64` quadrature (`0.00029` RMSE), 20-image default-mode float-bit comparison, source-off/relighting black resets, revision/corrupt-guard checks, `RunReplaySampleHistory.sh` logs (`Results/ReplaySampleHistory-release.txt`, `-sanitized.txt`, `-regression.txt`).
* Diagnostic readbacks: `ReplaySampleFresh.png`, `ReplaySampleFourFresh.png`, `ReplaySampleRetraced.png`, `ReplaySampleAcceptance.png` (green=full 3-seed bank, red=rejected; `3,990` retained, `106` rejected in `64×64` 4-bounce capture).

**Why it is still 🚧 Partial (per `RendererStatus.md`):**

* No hardware RT (`VK_KHR_ray_tracing` / `ray_query` search found nothing), no **non-ray-traced ReSTIR GI** alternative (distance-field marching is still ray-based), no production scene/render loop, no general animated/deforming-geometry reprojection, no converged denoising, no physical-GPU validation, no Windows/editor viewport. **New subpixel mode does not yet combine with reservoir reuse**. Scene changes reset history; token+position match is not a general disocclusion proof.

### 🪞 Reflections — 🚧

* Sampled rough-lobe reflections with cosine/GGX + screen-proposal verification (triangle BVH fallback): `14,941` accepted screen rays / `204,392` fallbacks, same-seed BVH-only HDR bit-exact. Limited specular history, static rough-opaque colour accumulation (`ReplayReconstruction.md`). No general motion/disocclusion safety, no roughness-mip history, no full temporal specular reconstruction, no hardware RT, no editor linkage.

### 🎨 PBR / Materials — 🚧

* Offscreen authored opaque/coating pipelines (`Engine/Render/*`, `ReferenceRenderer`, `ScatteringSequence`), VectorSurface `rgba32f` Float32 maps (14 GPU-readback PFM fixtures, `NativeSurfaceEvidence.html`), but **no unified transmission/refraction, no SSS, no complex-IOR/multiple-scattering, no converged GI, no authoring-document assignment in editor, no native preview integration**. Smooth-glass fixtures (camera/mirror/rough/window/compact diffuse) share one bounded volume-trace site with shared-edge/TIR corrections — but isolated, not a unified scene.

### 🌌 Atmosphere / Celestial / Optics — 🧪 ✅ + 🚧

* CPU `AtmosphereModel`, `CelestialModel` (Meeus series, topocentric parallax), `SolarDiscFilter` (limb-darkened flux `1.00001`), `LensFlareModel` (6-blade→6-spike verified, 5-blade→5-spike, mixed warm/anamorphic flares), star catalogue (6,228 Astropy/ERFA diffs ≤ bounded). Finite-pixel Sun + flare now on isolated Vulkan (`SolarOptics.slang`). CPU reference supports atmospheric extinction + planet/triangle visibility, opt-in lunar bounce + static SDF reservoir.
* Ported: `CelestialModel`, `SolarOpticsPayload`, `LunarDiscProjection`, `LunarBounceReservoir`, `WeatherEffects`.
* Still missing: ❌ GPU/editor Moon, star integration, Moon occlusion/indirect coverage, lens licence/calibration, measured sky validation. `EngineContent/CelestialMaps/LunarAlbedo` licence not reviewed.

### 🛞 Vehicle / Tyres / Physics — 🧪 (standalone) + 🔴 (vehicle deferred)

* **Standalone tyre work IS ported:** `TyreContinuum` (160-particle XPBD projection), `TyreCarcassSolid` (Hex8, 128-cell), `TyreMembraneDevice` (curved-shell), `TyreSurfaceProjection`, `TyreProjectionVulkan`/`TyreSolidDevice` — all with SwiftShader CPU Vulkan checks: byte-identical to prior Engine header, `0.097 mm` / `5.73e-5` normal vs demo WGSL, 22,528 sampled projections.
* **Vehicle dynamics remain explicitly deferred:** Project Drive `VehicleSolver`/`PacejkaMagicFormula`/`Aerodynamics`/`ProjectDriveReference` imported but not driven through Jolt loop — solver owns 480 Hz, Jolt 5.2.0 WASM owns loose bodies + chassis proxy only. Demo's 84-particle `TyreCarcassLattice` is distinct from 160-particle port; spring-contact dynamics hard-drop 720-step test **fails**, timestep not converged, measured-tyre validation open, no physical-GPU/mesh/editor integration.

### 🌊 Gas / Fluids — 🚧

* Engine footprints `GasProjectionFootprint.h`, `PlumeLatticeFootprint.h`, demo WGSL transport (`PlumeTransport`) and matched face-flux pressure prototype (`GasPressureProjection.slang`, analytic/matrix checks) pass bounded fixtures.
* Still missing: ❌ Original plume pressure defect unresolved, compatible advection, moving/open boundaries, production scheduling, scene/editor rendering, liquid solver, physical validation.

### 🖥️ Editor / UI — 🧪 (foundation) + 🔴 (renderer integration)

* Ported UI foundation: `Engine/Interface/*` (`PanelDockspace`, `AppearanceCodec`, `FontCodec`, `VulkanPresentation`, `WindowsApplication`), `Frontier/Engine/Interface/*` (`LogStreamPanel`, `SceneDirectoryPanel`, `ProjectDescriptor`), `UI/Editor/*` (`ControlCentrePanel`, `EditorWorkspace`), validation + captures (`ControlCentre`, `Docking`, `ContentBrowser`, `ProjectBrowser`).
* Still missing: ❌ Actual editor viewport — both inspected routes (`Frontier/Applications/Editor/FrontierMain.cpp`, `UI/Editor/EditorWorkspace.cpp`) display a **scene-canvas placeholder**. `EditorSceneInspection.md` plan saved, not implemented. No host-sanitizer Windows GPU run.

---

## 3️⃣ Cloud / Fog / Lights — your "I didn't see it ported" observation is half-right

You are correct they **have been tested with proofs**, but they **have been ported** — just not where you expected:

* **Tested with proof:** `Exhibits/LightCompute/Results/` has `Cloud*.txt`, `Fog*.txt`, `ClusterSpotIes-*.txt`, `MediumRadiancePayload` logs, plus rendered comparisons (`CloudBudgetComparison.png`, `FogSkyComparison.png`, `FogComparison.png`, `FogFacets.png`).
* **Ported to C++ Engine:** payload compilers (`MediumRadiancePayload`, `RadiantFacetDistribution`) live in `Frontier/Engine/Rendering/` and are *the* source of truth (old exhibit-local builders removed). Shaders are shared Slang, executed on SwiftShader.
* **Not ported to editor:** the LightCompute exhibit still owns Vulkan resource creation, submission, fixture generation, and image presentation. Pointing the editor at a `*.slang` file does not prove it builds/uses it (`RendererStatus.md` warning).

So: **✅ Engine library = yes, ✅ SwiftShader validation = yes, ❌ Editor integration = no.**

---

## 4️⃣ RESTIR — what the agent improved mathematically

* Replaced hand-tuned constants with bounded, validated policy: candidate count `1–4` (canonical) → history cap `1` on change, `64` otherwise; camera-reprojection radius `0.25` (scale-dependent, disclosed), world-space distance + normal + token exact-match guards, 16-bit half seed storage (not NaN-prone float bitcast), `CounterWords`/`OutputRecords(N)` ABI checks.
* Introduced proper uncertainty reporting: per-point CPU RMS SE `0.009526`, batch SE `0.00156–0.00292`, paired SE `0.00261`, quadrature RMSE `0.00029`, chart bars `±2 SE`, `±1 SE` in print — with disclaimer that finite-sample corrections are nominal, correlations/rare tails unresolved, and rare bright paths dominate tails (bounce-audit: 3 largest uniform paths hit same bright emissive at bounce 2, mirrored breakdown shares shader helpers).
* Separated concerns: domain (CPU validation), footprint (ABI), Vulkan recorder (records + inter-stage barriers only), exhibit (fixtures/references/captures) — avoids "everything in one demo WGSL" anti-pattern.
* Fixed `f5d99d4` negative control, reserved-optics atlas guard, `expm1` stability near horizontal, shadow-64→128 subset diagnostic, scale-height prose correction (`0.0015/m, 450 m`).

---

## 5️⃣ What is still incomplete before finishing RESTIR + rendering

Per `Documentation/Tracker.md` and `RendererStatus.md`, ordered by your priority ("finish RESTIR and rendering first"):

1. **Combine subpixel retracing with reservoir reuse** — currently mutually exclusive (opt-in flag incompatibility validated by recorder).
2. **General animated reconstruction / disocclusion-safe colour history** — current colour history resets globally on scene revisions; only certified camera-only static diffuse transitions pass.
3. **Hardware RT + non-ray-traced GI alternative** — no `accelerationStructure`/`RayQuery`/`vkCmdTraceRays` implementation; distance-field marching is still ray-based; decide and prove one.
4. **Converged denoising / reconstruction** — bounded temporal moments + edge-aware gather exist, but no validated denoiser for motion/rough.
5. **Unified PBR** — transmission/refraction, SSS, multiple-scattering acceptance, authoring→editor linkage.
6. **Physical-GPU + Windows + editor viewport** — all captures are SwiftShader CPU Vulkan; no MSVC/Windows runtime/GPU evidence, no Linux product binary, no GitHub Actions.
7. **Then:** vehicle/Jolt, full gas/liquid, editor scene inspection, material assignment.

---

## 6️⃣ Checkpoint evidence (from `arena/672a179a-frontier`)

* **Latest validated checkpoint:** `3de9061 Validate subpixel path retracing against equal-path references` + `2afe88d Retrace unselected path seeds through subpixel camera motion` — pushed to session branch; `Exhibits/LightCompute/ReplaySampleHistory.md` + `Images/ReplaySample*.png` + `Results/ReplaySampleHistory-{release,sanitized,regression}.txt`.
* **Release + ASan/UBSan (host) pass, 5/5 CTests pass.** External Vulkan driver/shaders not sanitized. `2afe88d` + working changes hashes listed in release log.
* **Four-bounce checkRed RMSE vs CPU reference (794 plane points, 813,056 CPU paths, 16 batches):**
  * Four fresh paths: `0.1530`
  * Four paths including retraced seeds: `0.1517`
  * Both use **four current paths** at retained points; retracing also uses prior frames → **not a speedup claim**. `970` histories retained, all `22` changed-surface donors rejected.

---

## 7️⃣ Immediate recommendation — how to continue from here

1. **Merge `arena/672a179a-frontier` into this `arena/7c640a4d-frontier`** (or cherry-pick `aef52bf..3de9061`) so this session inherits the verified Engine library and exhibits — currently this branch has zero Engine code.
2. **Implement combined subpixel + reservoir reuse** (the stated next phase) — the agent already left the flag-incompatibility guard; next is to design the joint gather/finalize that retraces retained seeds inside the reservoir weighting, with matching MIS and revised revision policy, plus equal-path vs equal-time reporting.
3. **Keep `RendererStatus.md` / `Tracker.md` as the single source of truth** — no competing progress reports — and keep every new mode default-off with paired fresh control and statistical bounds.
4. Keep SwiftShader as the correctness host; add physical-GPU, Windows and editor-viewport milestones only after the software path is complete.

If you confirm, I will start from step 1 and finish the combined mode under the same bounded, exhibit-verified contract.

*Generated by tracing `eosclient0001-rgb/Frontier@arena/672a179a-frontier` (50 commits, `bf2c4c48..3de9061`) and the empty state of `egoistm1inbox/Frontier@arena/7c640a4d-frontier` on 2026-10-28.*

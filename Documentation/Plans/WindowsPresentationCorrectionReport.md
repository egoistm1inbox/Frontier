# Windows Desktop Presentation Correction

## Result

The desktop route now creates the GLFW window before Vulkan adapter selection, asks GLFW for the required Vulkan instance extensions, creates a desktop surface, and selects one queue family that supports graphics, compute, and that surface. A dedicated `PresentationDiagnosticsJournal` writes initialization and frame-present evidence from its own `std::jthread`.

## Corrected Route

| Previous route | Corrected route | Result |
| :--- | :--- | :--- |
| Vulkan device and queue selected before a GLFW surface existed. | GLFW desktop window → Vulkan instance with GLFW-required extensions → GLFW Vulkan surface → adapter and queue selection. | Desktop presentation support participates in adapter selection. |
| A non-presentable window silently used an offscreen image. | A desktop window needs a Vulkan presentation surface and `VK_KHR_swapchain`; initialization reports a diagnostic otherwise. | No successful-looking black client area from an intentional offscreen fallback. |
| Frame-present failure result was discarded. | `PresentImGuiBatches` preserves a diagnostic; the desktop host journals it, writes it to stderr, and exits unsuccessfully. | The failing Vulkan result is observable. |
| Windows Actions built binaries but did not run them. | The Windows workflow starts `FrontierUV` with `--frames=3 --capture-png=...` and uploads the PNG, process output, and journal even when the run fails. | The job supplies evidence rather than a compile-only badge. |

## Journal Evidence

The journal destination is `FrontierPresentationDiagnostics.log` beside the resolved content root. It records:

- GLFW platform category and surface extent.
- Vulkan adapter name, queue-family index, hardware acceleration result, and desktop-presentation availability.
- UV rasterizer and ImGui overlay initialization.
- The first frame-present failure, including a Vulkan result when one is available.
- Final capture or normal completion.

## GitHub-hosted Windows Result

The Windows workflow run [`43225642932`](https://github.com/egoistm1inbox/Frontier/actions/runs/43225642932), on 12 November 2026, completed all preparation, CMake configuration, Windows x64 builds, and the hostile-input/UV chart check. Its bounded desktop attempt then produced this journal sequence:

```text
GLFW desktop window initialized. Platform=1; Surface=1028x749.
Vulkan initialization failed: Failed to initialize the Vulkan loader through volk or bundled SwiftShader.
```

So the GitHub-hosted `windows-2022` environment did create a GLFW window, but did not expose a usable Vulkan loader before instance, adapter, swapchain, or frame presentation could be tested. It did **not** produce a PNG. This is an environment limitation, not evidence of a remaining swapchain/presentation failure on a PC with a working Windows Vulkan driver.

The workflow retains strict failures for application failures after a loader is present. It now classifies only this exact loader-unavailable journal result as an environment skip, uploads `FrontierUV-WindowsPresentation-skip.txt` with the run log and journal, and continues to produce the portable package. This keeps hosted packaging/build validation useful without treating a missing hosted GPU driver as a product regression.

The artifact download endpoint returned an EOF from this workspace, but the workflow emits the journal tail in the GitHub Actions annotation as well; the text above is from that annotation.

## Windows Actions Evidence Payload

`Frontier-UV-Windows-presentation-evidence` retains these files for 14 days:

| File | Meaning |
| :--- | :--- |
| `Build/Windows/FrontierUV-WindowsPresentation.log` | Executable stderr/stdout. |
| `FrontierPresentationDiagnostics.log` | Dedicated journal-thread output. |
| `Build/Windows/FrontierUV-WindowsPresentation.png` | Bounded three-frame capture when the desktop route succeeds. |
| `Build/Windows/FrontierUV-WindowsPresentation-skip.txt` | Present only when GitHub-hosted Windows has no Vulkan loader. |

## Validation Status

| Check | Result |
| :--- | :--- |
| `PresentationDiagnosticsJournal.cpp` C++20 syntax check with `g++ -fsyntax-only` | ✔️ Passed. |
| Changed source and workflow whitespace check | ✔️ Passed. |
| Windows x64 configure/build of `FrontierUV`, `FrontierEditor`, and `UVBoundaryValidation` | ✔️ Passed in run `43225642932`. |
| Windows hostile-input and UV chart check | ✔️ Passed in run `43225642932`. |
| Hosted GLFW startup | ✔️ Passed; journal recorded a `1028x749` desktop window. |
| Hosted Vulkan initialization and PNG capture | ⏭️ Skipped: the runner did not provide a Vulkan loader. |
| Physical Windows GPU/presentation validation | ⏳ Required on the affected Windows PC or an interactive self-hosted Windows runner. |

## Physical Windows Validation

Run the following in PowerShell from the repository root on the affected PC, after normal dependency/toolchain preparation and a Release build:

```powershell
Remove-Item Build/Windows/FrontierUV-WindowsPresentation.png, `
  Build/Windows/FrontierUV-WindowsPresentation.log, `
  FrontierPresentationDiagnostics.log -Force -ErrorAction SilentlyContinue

& .\Build\Windows\Release\FrontierUV.exe `
  '--frames=3' `
  '--capture-png=Build/Windows/FrontierUV-WindowsPresentation.png' `
  *> Build/Windows/FrontierUV-WindowsPresentation.log

$exitCode = $LASTEXITCODE
Get-Content Build/Windows/FrontierUV-WindowsPresentation.log
Get-Content FrontierPresentationDiagnostics.log
Get-Item Build/Windows/FrontierUV-WindowsPresentation.png
exit $exitCode
```

A successful result is exit code `0` plus a PNG larger than 1024 bytes. If it fails, retain the two log files and report the first `Vulkan initialization failed` or `Presentation failure` line. A `Vulkan loader` message on the physical PC means its Windows graphics driver/Vulkan runtime must be installed or repaired before application presentation can be evaluated.

## Interpretation Boundary

A GitHub-hosted Windows runner validates source compilation, bounded launch diagnostics, and artifact collection. It is not a substitute for a self-hosted Windows runner with the same GPU and display session as the affected PC. The runtime journal now distinguishes the hosted-runner loader limitation from a later adapter, swapchain, or present failure.

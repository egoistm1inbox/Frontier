# Windows Desktop Presentation Correction

## Result

The desktop launch path now creates the GLFW window before Vulkan adapter selection, asks GLFW for the required Vulkan instance extensions, creates a desktop surface, and selects one queue family that supports graphics, compute, and that surface. A dedicated `PresentationDiagnosticsJournal` writes initialization and frame-present evidence from its own `std::jthread`.

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

## Windows Actions Evidence Payload

`Frontier-UV-Windows-presentation-evidence` retains these files for 14 days:

| File | Meaning |
| :--- | :--- |
| `Build/Windows/FrontierUV-WindowsPresentation.log` | Executable stderr/stdout. |
| `FrontierPresentationDiagnostics.log` | Dedicated journal-thread output. |
| `Build/Windows/FrontierUV-WindowsPresentation.png` | Bounded three-frame capture when the desktop route succeeds. |

## Validation Status

| Check | Result |
| :--- | :--- |
| `PresentationDiagnosticsJournal.cpp` C++20 syntax check with `g++ -fsyntax-only` | ✔️ Passed. |
| Changed source and workflow whitespace check | ✔️ Passed. |
| Full Windows build, bounded executable run, journal, and captured image | 🚧 Pending the explicitly approved GitHub Actions dispatch. |

## Interpretation Boundary

A GitHub-hosted Windows runner can validate compilation and collect the journal/capture route. It is not a substitute for a self-hosted Windows runner with the same physical GPU and display session as the affected PC. If the hosted runner lacks a Vulkan desktop adapter, the uploaded journal will identify that fact; the same binary can then be tested locally with the exact log file requested.

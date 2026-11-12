# UV Workspace Audit and Windows Presentation Diagnosis

## Result

🔴 **No implementation files were altered.** The Windows Actions run compiled and packaged the applications, but it did **not** prove that a Win32 Vulkan surface can present a frame. The black client area in the supplied image is consistent with the current code silently selecting an offscreen target, or with a presentation failure whose return result is discarded.

## Evidence Captured

| Check | Result | Evidence |
| :--- | :--- | :--- |
| Imported source revision | ✔️ | `91f0bfa9439c84bacf884603d8fca6a233c43231` from `SultanAladin/Frontier` branch `arena/4c9015d5-frontier`. |
| Latest Windows Actions run | ✔️ compilation and package creation | Run [`43194947285`](https://github.com/SultanAladin/Frontier/actions/runs/43194947285), job `131103381674`, completed successfully on 2026-11-12. |
| Windows runtime check | 🔴 absent | The workflow builds `FrontierUV`, `FrontierEditor`, and `UVBoundaryValidation`, then invokes only `ctest ... -R '^UVBoundaryValidation$'`. It never starts either desktop executable. |
| Windows presentation capture | 🔴 absent | No workflow step invokes `FrontierUV --frames=... --capture-png=...`; no Windows image is uploaded. |
| Existing Exhibit images | ⚠️ not independent Windows proof | All 47 `Exhibits/Images/` PNGs, including eight UV images, are tracked in the imported revision. Their presence in the folder does not show that this Windows machine displayed a swapchain frame. |
| Authenticode signing | 🔴 absent | `windows-uv-build.yml` copies the executables into a ZIP and uploads it. It contains no certificate retrieval, `signtool`, Azure Trusted Signing, signature verification, or timestamp step. |

## Most Likely Reason for the Black Window

| Rank | Finding | Code evidence | Consequence |
| :---: | :--- | :--- | :--- |
| 🥇 | A graphics/compute queue is selected **before** a Win32 surface exists. | `DesktopWorkspaceLaunch.cpp:322` initializes `VulkanInterchange`; the GLFW desktop window appears later at line 338. `VulkanInterchange.cpp:141-158` chooses the first graphics-plus-compute queue without checking whether it can present to that window. | On a hybrid GPU, virtual machine, Remote Desktop session, or driver with separate presentation support, the chosen queue can be unable to present. |
| 🥇 | A non-presentable surface intentionally falls back to offscreen rendering. | `ImGuiOverlayRasterization.cpp:117-131` checks surface support only after device/queue selection. If it is unavailable, `LiveWindowSwapchain` remains false; lines 502 onward construct an offscreen image instead. | The application continues successfully while the GLFW client area receives no rendered pixels: a black window matching the report. |
| 🥈 | Presentation failures are ignored by the host loop. | `DesktopWorkspaceLaunch.cpp:586` discards the result from `PresentImGuiBatches(...)`. That renderer can return false after image acquisition, swapchain creation, queue submission, or presentation failure. | A failed live presentation has no visible diagnostic and the loop remains alive. |
| 🥈 | The Windows workflow does not exercise this route. | `.github/workflows/windows-uv-build.yml:69-72` limits CTest to `UVBoundaryValidation`. The desktop smoke checks exist in `CMakeLists.txt:400-405` but are not selected by the workflow. | A green Windows Actions badge is a compile/package result, not desktop presentation confirmation. |

The Windows activation watermark in the supplied image is unrelated to Frontier and does not cause a black Vulkan client area.

## Exact Runtime Checks Needed on the Affected Windows PC

| Check | Expected useful result | Why it isolates the defect |
| :--- | :--- | :--- |
| Run `vulkaninfo --summary` in PowerShell | Reports a Vulkan 1.2-capable adapter and driver. | Confirms that the active local adapter, rather than the Actions runner, can provide Vulkan. |
| Start from PowerShell and capture both exit code and stderr: `./FrontierUV.exe`; then `$LASTEXITCODE` | The current build may remain alive without emitting an error because the presentation return result is ignored. | Distinguishes an initialization exit from a silent frame-present failure. |
| Repeat outside Remote Desktop and after updating the GPU driver. | A physical display session should expose Win32 surface presentation if the driver supports it. | Remote/virtual display drivers frequently differ from the discrete GPU's Vulkan WSI support. |
| Record the adapter name and driver version from `Get-CimInstance Win32_VideoController`. | Identifies hybrid, virtual, or Microsoft Basic Display Adapter selection. | Connects the observed PC to the queue/presentation selection defect. |

A corrective implementation, deliberately **not applied in this audit**, needs to create the GLFW surface first, select a queue family that supports both graphics and that surface, require `VK_KHR_swapchain`, and stop with the Vulkan result/diagnostic when presentation cannot occur. The Windows workflow also needs a bounded desktop smoke capture plus a non-black image check; physical Win32 presentation needs a self-hosted Windows runner with a real GPU and display session.

## Banned Vocabulary Audit

### Scope and Reading Rule

The audit inspected the UV workspace, its geometry/raster/lifecycle dependencies, UV validation exhibits, and the CMake build definition. It distinguishes Frontier-authored names/comments from fixed Vulkan, Slang, ImGui, CMake, and glTF tokens. A literal all-text rule also catches such external API tokens, so the governance policy needs an explicit external-API exception before a zero-hit gate can be realistic.

No files or folders in the audited UV path use an independently banned path segment. The following Frontier-authored names/comments remain non-compliant with the repository vocabulary documents.

| Category | Term(s) | Location(s) | Audit note |
| :--- | :--- | :--- | :--- |
| Comment | `adjacency` | `Engine/GeometrySpace/Selection/GeometrySelection.cpp:226` | Direct hard-blacklist hit. |
| Comment | `state`, `binding` | `Engine/Workspaces/UV/UVWorkspaceSession.h:4`; `Engine/Workspaces/UV/UVViewportInteractor.cpp:118` | Direct hard-blacklist hits in UV descriptions. |
| Comment | `table` | `Engine/Workspaces/UV/UVWorkspaceSession.h:53` | Direct hard-blacklist hit. |
| Comment | `traversal` | `Engine/GeometrySpace/Selection/GeometrySelection.h:4` | The only documented exemption is `SelectionTraversal.{h,cpp}`, not this file. |
| Comment | `flag` | `Engine/Workspaces/UV/Operations/UVAuthoringOperations.cpp:267` | Direct hard-blacklist hit. |
| Comment | `compose`, `composite` | `Exhibits/UVParameterizationValidation.cpp:222`; `Exhibits/UVRasterPickingGizmoValidation.cpp:322`; `Exhibits/UVInteractiveAuthoringValidation.cpp:348` | Direct hard-blacklist hits in UV exhibit descriptions. |
| Names | `TextureCache`, `CachedImGuiTexture`, `CacheMutex`, `CachePopulated` | `Engine/GeometricRaster/Rasterization/ImGuiOverlayRasterization.{h,cpp}`; `Engine/GeometrySpace/Primitives/AnalyticPrimitives.cpp:320-422` | `cache` is prohibited by the naming skill. |
| Names | `EvaluatedOnVulkanGPU`, `SeamOverlayOn`, `PinOverlayOn` | `Engine/Workspaces/UV/Solvers/ConcaveSkylinePacker.{h,cpp}`; `Engine/GeometricRaster/Shaders/UVTileRasterization.slang:104-105` | `*On*` boolean form is prohibited. |
| Names | `OverlapFlag` | `Engine/GeometricRaster/Shaders/UVTileRasterization.slang:9` | `flag` is prohibited. |
| Names | `GroundGridPass` | `Engine/GeometricRaster/Shaders/SurfaceShading.slang:25` | `pass` is prohibited. |
| Names/comments | `BaseAlpha` | `Engine/GeometricRaster/Shaders/GizmoRasterization.slang:8`; `Engine/Editor/Viewports/TransformGizmo.h:56` | `Base` is prohibited by the naming skill. |
| Names/comments | `ComputeProgram`, `ComputeDispatchEncoder` description | `Engine/GeometricRaster/Compute/ComputeDispatchEncoder.{h,cpp}` | `pipeline` appears in Frontier-authored labels/comments; this domain also necessarily references Vulkan `VkPipeline` API types. |
| Comment | `value` | `Engine/GeometricRaster/Compute/TimelineTransferRegister.h:93` | Direct hard-blacklist hit. |

### External API Tokens Requiring a Governance Decision

The audit also finds `VK_*` and `Vk*` names containing terms such as `Assembly`, `Binding`, `Pipeline`, `Stage`, `State`, `Store`, `Topology`, and `Update`, plus Slang's required `[[vk::binding(...)]]` annotation. These are names owned by the Vulkan/Slang interfaces, not Frontier naming decisions. Renaming them would make the code invalid. They should be recorded as an external-interface exception, not treated as Frontier rename work.

## Chrome and Windows Download Warning

The current workflow creates an unsigned ZIP and neither GitHub Actions nor a “signed preview” setting can confer download reputation. The exact remediation path, intentionally not configured in this audit, is:

1. Obtain a trusted Authenticode identity: an established EV code-signing certificate or Azure Trusted Signing profile.
2. Keep the certificate private: use GitHub Actions secrets/OIDC; never commit a PFX or password.
3. Sign every distributed executable and native DLL after the Release build and before ZIP creation; add an RFC 3161 timestamp.
4. Verify every signature in the job using `Get-AuthenticodeSignature` or `signtool verify /pa /tw` and fail packaging on an invalid result.
5. Distribute signed release assets rather than relying only on short-retention Actions artifacts.

A trusted signature helps Windows SmartScreen. Chrome Safe Browsing can still mark a newly published executable or ZIP as uncommon until download reputation develops; GitHub Actions configuration alone cannot guarantee removal of that warning.

## No-Change Boundary

✔️ This audit changed no implementation, shader, workflow, or vocabulary violation. It only records the evidence and the unimplemented remediation boundaries requested for later approval.

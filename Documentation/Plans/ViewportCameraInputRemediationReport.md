# Viewport Camera Input Remediation — One Unreal Model, `LMB` Returned to the Gizmo

**Date:** 2026-11-21 · **Branch:** `arena/b93b4914-frontier` · **Scope:** `Engine/Lifecycle/EditorLifecycle.cpp`,
`Exhibits/ProjectBrowserValidation.cpp`, `Documentation/ImportantNotes.md`

---

## 1. Reported Defect

> "I told it to put Unreal WASD camera, but it did 2 camera models at the same time; right click and
> left click — now I cannot use the gizmo."

Commit `4cb1481` (*"Implement Unreal Engine viewport camera controls"*) added the authentic `RMB` fly
model **and** kept a brand-new plain-`LMB` model ("Drag Yaw/Horizontal-Walk + `WASD` + `Q`/`E` + `Shift`").
Two navigation models ran simultaneously, and both fought `TransformGizmo`.

---

## 2. Root Cause Chain

| # | Mechanism | Effect |
| :- | :--- | :--- |
| 1 | `FlyKeysPossible = ... \|\| (LeftHeld && !AltHeld && !MiddleHeld)` | `WASD`/`Q`/`E` translated the camera while `LMB` was held — i.e. while authoring |
| 2 | `else if (LeftHeld && !RightHeld && !MiddleHeld && !AltHeld && !Pressed)` branch | A plain `LMB` drag yawed the view and walked it along the ground plane (second camera model) |
| 3 | `AnyNavButtonHeld = RightHeld \|\| MiddleHeld \|\| LeftHeld` | Plain `LMB` fed pointer deltas into the navigation accumulator |
| 4 | `CameraInteractiveDrag = ... \|\| CameraMoved` and `LMB`-set `CameraInteractiveDrag` | `RequestPickPatch = !CameraInteractiveDrag && ...` in the GPU overlay request, so a `LMB` drag **disabled the `TransformGizmo` GPU pick patch** |
| 5 | Gizmo press only starts a drag when the GPU pick resolves a handle | With the pick patch starved, hover stayed `None`, the press fell through to entity picking, and the handle drag never began — the view drifted instead |

Net user-visible behaviour: dragging a Gizmo handle moved the **camera**, not the object. The Gizmo
appeared completely broken.

---

## 3. Remediation (delivered)

**`Engine/Lifecycle/EditorLifecycle.cpp` — `ProcessShowcaseViewportInteraction`:**

| Change | Before | After |
| :--- | :--- | :--- |
| Plain-`LMB` camera walk branch | Present (yaw + ground-plane walk) | **Removed**; comment records why it must never return |
| `FlyKeysPossible` | `RightHeld \|\| (LeftHeld && …)` | `RightHeld && !AltHeld && !LeftHeld && !MiddleHeld` — fly keys exist only inside the `RMB` model |
| Navigation delta source | `RightHeld \|\| MiddleHeld \|\| LeftHeld` | `RightHeld \|\| MiddleHeld \|\| (AltHeld && LeftHeld)` — only `Alt`+`LMB` orbit may use `LMB` deltas |
| `CameraInteractiveDrag` | Included any plain-`LMB` movement | `RightHeld \|\| MiddleHeld \|\| (AltHeld && (LeftHeld \|\| RightHeld \|\| MiddleHeld)) \|\| QueryDragging() \|\| CameraMoved` |
| Gizmo ownership | Comment: "preempt LMB camera walk" | Gizmo handle drag now exclusively owns the `LMB` press |

**Resulting single model (unchanged, verified):**

| Gesture | Action |
| :--- | :--- |
| `RMB` + mouse | 6-DOF look (relative cursor lock while held) |
| `RMB` + `WASD` / `Q` / `E` | Fly, descend/ascend |
| `RMB` + `Shift` | 3x sprint (never re-routed into pan) |
| `RMB` + wheel | Fly-speed scalar (no dolly-zoom) |
| `MMB`, `LMB`+`RMB` | Truck / pedestal pan |
| `Alt`+`LMB` | Orbit around target |
| `Alt`+`RMB` | Smooth dolly |
| `Alt`+`MMB` | Pan |
| Arrow keys / `PageUp` / `PageDown` | Keyboard flight |
| **`LMB`** | **Gizmo handle drag · entity pick · force-probe placement — never navigation** |

---

## 4. Verification

**`Exhibits/ProjectBrowserValidation.cpp` §(f)** now gates the invariant:

- Existing `RMB` assertions retained: forward `W`, `Shift`+`W` ≈ 3x sprint, `E`/`Q` vertical, `D` strafe
  with the pointer dragged outside the viewport bounds, and wheel speed change with **zero** camera/target drift.
- **New §(f.2) `(Single-camera-model gate)`**: a 9-sample `LMB` drag inside the live viewport canvas
  (bottom-left quadrant, away from the Gizmo pivot) plus a second `LMB`+`W` drag. Both must leave
  `EditorCamera.CameraOrigin` and `CameraTargetPoint` unchanged (`≤ 1e-6` squared drift), which fails
  loudly if any future change reintroduces an `LMB` camera model.

**Sandbox limitation (stated honestly):** this environment has no `cmake`, no `ExternalPackages/`
(ImGui/Vulkan/GLFW pins are fetched by `Automation/PrepareDependencies.py`) and no GPU, so the native
`FrontierEditor` / `ProjectBrowserValidation` binaries could not be compiled or executed here. The edits
were validated by full-function review plus brace/paren balance and depend only on already-used symbols.

---

## 5. Follow-Ups (not part of this fix)

| Item | Note |
| :--- | :--- |
| `Experimental/FrontierWorldMirror/GtxWorldViewport.jsx` | The HTML mirror still maps plain `LMB` drag to `orbit` (`Kind = "orbit"`) with `RMB` = `fly`, i.e. the same two-model shape. It needs `Alt`+`LMB` orbit added **before** plain `LMB` is demoted to select-only, then a `Build.mjs` rebuild. Not touched here to avoid an unverifiable prototype change. |
| `EngineContent/Input/UnrealNavigation.InputSpace` | The data preset (`PanPointerButton = 2`, `AltPanModifierMask = 5`) is **not yet consumed** by any controller — the viewport is hardcoded ImGui. When it is wired, align it with §3's table. |

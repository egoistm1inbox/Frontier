# Frontier / Project Zero — standing requirements

This document records the requirements that must not be lost between AI sessions.
It is the source of truth for the Project Zero celestial demonstration.

## Purpose

Project Zero is **one dedicated celestial test scene**, not a collection of sample
levels. It exists to demonstrate the reference celestial system and to make lighting,
materials, GI, clouds, god rays and colour easy to judge on a real GPU.

The reference is the celestial demo at:

- https://sultanaladin.github.io/Frontier-/
- https://sultanaladin.github.io/Frontier-/celestial/
- https://github.com/streamlinkinbox/Frontier/tree/arena/01a09335-frontier

The WebGL celestial page is the visual and behaviour reference. Its controls must be
ported into Frontier's **Editor mode**. Do not embed the HTML and do not invent a
second, simplified UI.

## Scene rules

- Project Zero loads **one scene only**: the celestial demonstration scene.
- Do not use the Cornell Box, Showroom, Sponza or a scene selector as the Project Zero
  workflow. Old scene generators may remain as tools, but they are not the demo.
- The scene must be open to the sky and must not use a featureless ground plane as its
  main subject.
- Populate the scene with a small, deliberate material/light test set: primitives with
  diffuse, rough/specular, metallic, emissive and translucent/alpha materials. The
  objects must make night lighting, sunlight, moonlight, god rays, shadows and colour
  response visible.
- The default camera must frame the objects and a large portion of the sky. The sun
  must be reachable in the view without a wall or ceiling occluding it.
- The scene must demonstrate: day, noon/zenith, sunset, dusk, night, dawn and sunrise;
  stars; the moon; clouds; fog; precipitation; rainbow; lens flare; and god rays.

## Render-path rules

There are two explicit, user-selectable render paths:

1. **Visibility Raster / Software Raster** — the quick, deterministic editor preview
   for level design. This is not a low-end quality mode. It must use the CPU/software
   visibility raster and the same celestial inputs as the GPU path.
2. **ReSTIR** — the GPU path, with a separate GI toggle. Disabling GI must not silently
   leave the user unable to choose ReSTIR; the UI must expose both independent controls:
   - Render Path: Visibility Raster or ReSTIR
   - Global Illumination: on or off (when ReSTIR is selected)

The selected path must be visible in the HUD and in Editor settings. Switching it must
reset temporal accumulation and must not change the celestial time/weather state.

Clouds, sky, moon and stars must work on both paths. The ReSTIR path must receive the
same cloud/weather record as the visibility raster; it is not acceptable for ReSTIR to
fall back to a clear sky while GI-off appears correct. A path difference must be
reported as a bug, not hidden by fake proof imagery.

## Sun and sky correctness

- The sun is a visible **disc** with an analytic angular radius and a bounded aureole,
  not a white/blinding light that blooms across the whole frame.
- The disc, cloud illumination, atmosphere, shadows and lens flare use the same solved
  sun direction and visibility.
- A sun-facing proof must show the disc shoulder and surrounding sky detail. Exposure
  must not clip the entire sun test frame.
- CPU proof renders must execute the same formulas and packed records as production
  shaders. They may be a scalar/reference implementation, but they must not be
  screenshots painted by hand or a separate approximation.

## Proof-render rules

The sandbox may not have Vulkan drivers or a usable GPU. That does not permit fake
proofs.

Every proof image must be produced by a CPU renderer that is a line-by-line or
algorithmically locked reference of the production shader/code, using the same:

- celestial records and time/date state;
- atmosphere/cloud/fog/weather parameters;
- sun disc/aureole and post-effect equations;
- material/light records for the Project Zero test scene;
- render-path selection semantics.

Proofs must be labelled with scene, time-of-day, render path, GI state and quality tier.
The proof source and command that generated each image must be committed beside the
image. If CPU and GPU intentionally differ, the comparison must quantify and explain
the difference; never replace a failed GPU feature with a nicer-looking fake CPU frame.

Required proof set:

- dawn, sunrise, noon/zenith, sunset, dusk and night;
- sun-disc close view; the showcase now includes a clear-sky, 18-degree-FOV inspection
  frame with the weather entities hidden and production exposure explicitly labelled;
- moon and stars at night;
- clouds in Visibility Raster and ReSTIR, with GI on and off where valid;
- cloud/fog god rays;
- precipitation types;
- rainbow and lens flare;
- material/object lighting in day, sunset and night;
- a path comparison sheet showing Visibility Raster vs ReSTIR with identical inputs.

## Editor/UI rules

The celestial demo UI must be ported into Frontier Editor mode, not deferred.
The editor should expose the reference's outliner and inspectors for atmosphere, sun,
sky, stars, moons, fog, clouds, wind, precipitation, rainbow, lens flare, render path,
GI and quality/tier. The controls must edit the live Project Zero sequence.

At minimum the Editor must provide:

- time/date/latitude controls and a timeline scrubber;
- render-path selector: Visibility Raster / ReSTIR;
- independent GI switch;
- cloud/fog/weather controls;
- sun-disc size/intensity/softness controls;
- moon/stars/night controls;
- reset accumulation feedback when a visual setting changes;
- a HUD showing path, GI state, time of day, tier and frame timing.

## Implementation decisions already made

- `RayTracingSolver::ConstructCelestialTestScene` is now the only Project Zero scene
  source. `GameExecution` always uses `ProjectZeroCelestial.gltf`, generated through
  the production SceneCodec when absent; command-line scene selection and showroom
  world-space panel/proxy-light branches are not part of this workflow.
- `ControlCentreSettings::RenderPath` is persisted as `[render].render_path` and is
  separate from the quality ladder. The Swapchain host carries the selection outside
  the fixed 128-byte dispatch push block. Visibility Raster never falls through to
  ReSTIR; if its strict stage cannot record, the frame reports a deterministic
  diagnostic colour rather than changing renderer semantics.
- The spare `SkySunDirect.w` lane is the packed shared sun-disc gain. `kSunDiscGain`
  is consumed by the CPU Visibility Raster equation and the SkyRecords disc equation;
  the disc remains bounded by the common angular radius and the physical Mie aureole.
  The old shader/CPU aureole remap (5 degree gate, 0.06 shoulder slope) was removed:
  it was the source of the dark shoulder/apparent disappearance around the sun. The
  reference composes the bounded disc after weather and lets display transfer roll off
  the physical HDR aureole.
- Cloud streaking was traced to two production-path issues rather than to a god-ray
  blur: cloud samples used a fixed midpoint comb, and the cloud direct-light term was
  overdriven relative to the normalized HG/extinction march. Both CPU and GPU now use
  the same deterministic view-stable ray jitter, the same clamped wind/shear drift,
  and one `kCloudDirectLightScale` calibration packed through `CloudControl.w`.
  Cloud self-shadow taps remain the source of cloud shafts; no screen-space radial
  blur or temporal cloud reprojection was added.
- ShadowResolve now consumes the same sparse celestial records and resident texture
  table as ReSTIR, including `CloudAlong` for camera segments and `SkyAlong` for
  misses. This is the production parity seam for GI-off weather, not a painted proof.
- CPU showcase generation loads the generated Project Zero scene through SceneCodec,
  uses the live CelestialSequence and ApplyTo, and labels outputs by scene, path, GI
  state and tier. It deliberately does not call a CPU image a ReSTIR/GPU capture.
- `FRONTIER_RESTIR_CAPTURE` is an opt-in production harness in `GameExecution.cpp`.
  `Scratchpad/RenderProjectZeroRestirCapture.sh` forces the actual ReSTIR path,
  independently selects GI on/off, applies the solved Project Zero celestial/weather,
  camera and exposure states, settles accumulation, and captures the storage image
  before the UI blit through `RecordAndPresent`. Clear-sky and cloud-present output
  names include scene, path, GI state and tier. The CPU evidence in `Diagnostics/`
  remains Visibility Raster evidence and is labelled as such; it must not be renamed
  as ReSTIR when the GPU runtime is unavailable.

## Assumption policy

Do not make silent assumptions about the demo scene, render path, proof fidelity or
which existing sample level is used. If a design decision is needed, record it in this
file and in the implementation comments. Prefer one small, testable implementation
that is wired to Project Zero over adding another disconnected proof harness.

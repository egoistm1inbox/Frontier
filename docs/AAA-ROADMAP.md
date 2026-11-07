# From prototype → AAA: production roadmap

This document is deliberately blunt. A browser prototype proves the **feel** and the **pillars**;
it does not scale to AAA. Below is the shortest credible path, what it costs, and what to keep.

---

## 1. Decide what "AAA" means for this game

AAA racing is one of the most expensive genres per player-hour because content (tracks, ships,
audio, VFX) scales linearly while polish cost scales super-linearly. Be realistic with scope:

| Scope target | Budget | Team | Timeline | Comparable |
| --- | --- | --- | --- | --- |
| **A: Premium indie "AAA-feel"** (recommended) | $0.8–2.5M | 8–14 | 18–24 mo | BallisticNG, Redout, Pacer, Art of Rally |
| B: Mid-budget AA | $4–9M | 25–45 | 24–30 mo | WipEout Omega-tier content, GRIP: Combat Racing |
| C: Full AAA | $40–120M+ | 150–400 | 36–60 mo | Wipeout 2048 successor, Forza Horizon-scale |

**Recommendation:** aim at **A** first. A 12-person team shipping 8 tracks, 6 ships, 3 modes at
$19.99–24.99 is the realistic path from this prototype; the anti-grav niche is under-served and
reviews well when the feel is right. Use revenue to fund B.

The single biggest mistake would be trying to build C from this codebase. The prototype's job is
to sell the feel — to yourself, to a publisher, or to a store page audience.

---

## 2. Engine decision

**Recommendation: Unreal Engine 5.**

| Need | UE5 | Unity 6 | Custom (Three.js/WebGPU, Bevy, Godot) |
| --- | --- | --- | --- |
| Anti-grav vehicle physics | `Chaos Vehicles` can be adapted, but most anti-grav racers (Wipeout, Redout) use **custom raycast hover physics** — 1–2 weeks, well documented | same, custom C# | full control, zero support |
| Visual ceiling (Lumen/Nanite, volumetrics, post) | Best-in-class, matches the neon look | Very good, more work for the same look | You are the renderer team |
| Console certification (PS5/Xbox/Switch2) | Native, battle-tested | Native, battle-tested | Practically disqualifying |
| Store/marketplace, hiring pool | Deepest for stylised sci-fi art | Deepest overall | Thin |
| Iteration speed (this prototype's lesson) | Slower than a browser, but 60 Hz deterministic sim is fine | Good | Fastest |

Concretely for UE5:

* **Vehicle:** custom `AAntiGravPawn` with a downward raycast/path-projected hover, applying
  spring-damper force, plus a "grip" force that removes lateral velocity toward the surface's
  projected forward vector — this is exactly the model in `src/ships.js`, translated.
  Keep the **separation of heading vs. lateral velocity**; it's what makes drift feel physical.
* **Track:** spline-driven `USplineComponent` + `USplineMeshComponent` for surface ribbons (same
  approach as `src/track.js`), so designers reshape the circuit in-editor and banking/width update
  automatically.
* **Speed feel:** UE's `PostProcessVolume` for chromatic aberration/radial blur driven by speed,
  Niagara for particle trails, a per-camera FOV curve and a camera shake track — all present in
  the prototype as a reference implementation to match.
* **Fixed-step physics at 120 Hz** decoupled from render, with input buffering. Non-negotiable for
  fair racing; the prototype already runs a fixed 1/120 step in `tools/sim.mjs`.

Keep this web build alive as a **"playable pitch"** — a browser demo on the Steam page converts
wishlists far better than a video, and it costs nothing once built.

---

## 3. Production plan (24 months, team of ~12)

### Phase 0 — Vertical slice (months 0–3)
* Port handling model to UE5; one ship, one track (the current circuit, rebuilt).
* Lock the **feel checklist**: 360 km/h reads as 360 km/h, drift is learnable in 3 laps,
  barrier scrape punishes without stopping, boost economy creates decisions.
* Playtest with 20+ external players; instrument with the metrics in §6.

### Phase 1 — Pre-production (months 3–8)
* Content pipeline proven: track kit (modular gantries, barriers, city blocks, skyboxes),
  ship kit, VFX kit, audio kit.
* Ship classes (4), 2 tracks in "final quality", full HUD/UI graybox.
* Multiplayer prototype validated (see §5) — decide netcode before content scales.
* **Greenlight gate:** slice must be fun with a placeholder soundtrack and no art heroics.

### Phase 2 — Production (months 8–18)
* 8 tracks × 3 layouts = 24 circuits; 6 ships × 4 classes; 4 game modes.
* Career + progression + unlock economy tuned with telemetry.
* Audio pass: engine synthesis per class, doppler, positional crowd/pads, music system.
* Accessibility pass (see §7) — plan it here, not at the end.

### Phase 3 — Alpha/Beta/Cert (months 18–24)
* Alpha = feature complete; Beta = content complete; then polish, localisation (10 languages),
  console cert, Steam Deck verification, store page, demo.
* Marketing beat: announce → demo (this prototype) → Steam Next Fest → launch.

### Team shape (~12)
2 gameplay eng · 1 engine/tools · 1 rendering/VFX tech · 1 network eng (if MP) · 1 tech artist ·
2 environment artists · 1 vehicle/character artist · 1 UI/UX · 1 audio designer/composer ·
1 designer/level designer · 0.5 producer · 0.5 QA (outsourced + community later).

### Budget sketch (Scope A)
* Salaries 24 mo × 12 FTE (blended $80k): **~$1.9M**
* Outsourcing (art/audio/QA/localisation): **~$250k**
* Tools, engines, cert, devkits, travel, marketing (indie-adequate): **~$250k**
* Contingency 15%: **~$350k** → **≈ $2.7M** at full peak staffing;
  a leaner 8-person/18-month version lands around **$0.9–1.2M**.
* Funding routes: publisher advance (typical 30–50% of budget as milestone payments),
  regional/creative funds (e.g. Screen Australia, Creative Europe MEDIA, Ontario Creates),
  platform funds (ID@Xbox, PlayStation Indies, Nintendo), equity/crowdfund for the remainder.

---

## 4. Art direction (what to keep from the prototype)

Keep, and scale up:

* **Neon on near-black.** One accent colour per opposing ship/team; readable at speed.
* **Silhouette-first ships.** Wide wedge, bright engine rings, underglow. Readability beats detail
  in a racing game — the player must identify a rival at 400 m.
* **Light as track language.** Edge strips = lane; gates = progress; pads = reward. The prototype
  already encodes rules into colour; a AAA pass should make this a formal palette bible.
* **Motion layers.** Trails, speed lines, FOV kick, drift roll, sparks. Racing feel is 60% motion.

Add: hero city environments (megacity, orbital ring, canyon solar farm), volumetric fog, weather
per track, destructible light props, a pilot/cockpit layer for the "B" camera, and an
ESRB-T-appropriate soundtrack (synthwave/breakbeat) with an adaptive mix (duck music under boost peak).

---

## 5. Multiplayer (decide early, it changes everything)

Anti-grav racers live or die on time trials and ghosts; online is the retention engine.

* **Deterministic lockstep** with fixed 120 Hz sim + input delay (Wipeout-style) is the right call
  for 8–12 ships: tiny bandwidth, drift-free. Requires strict float determinism — start writing
  the sim with fixed-point or determinism-safe math now if MP is planned.
* Fallback: server-authoritative state sync at 30 Hz with client prediction + reconciliation.
* Ship **ghost downloads + leaderboards** first (cheap, huge retention), then 8-player lobbies.

---

## 6. What to instrument (start now, it's free)

The prototype's `tools/sim.mjs` is the seed of a telemetry harness. Track per session:

* Lap time distribution per track/layout and **first-lap vs. best-lap delta** (learning curve).
* Drift time %, boost spend %, average speed × top speed ratio (target ~65–75%).
* Wall hits per lap (target < 2 experienced, < 8 first-time).
* Corner-specific "dirty" rate — where players leave the track (level design signal).
* Session length, mode split, quit points.

Ship a debug overlay (already in the HUD: FPS, lap, position, speed) and a CSV exporter.

---

## 7. Accessibility & comfort (mandatory for a speed game)

* Motion: camera shake slider, drift-roll toggle, speed-line intensity, FOV kick amount,
  optional fixed camera. A slider from 0–100 for "motion intensity" is a store-page feature.
* Photosensitivity: no more than 3 flashes/sec, a "reduce flashing" mode that dims gates/pads.
* Colour-blind palettes (the current cyan/magenta pair fails deuteranopia — ship 3 palette options).
* Full remapping, hold-vs-toggle for drift/boost, adjustable steering sensitivity + deadzones,
  one-handed layout, subtitles for all radio banter, and screen-reader-friendly menus.

---

## 8. Engine-port checklist (concrete work items)

1. `AntiGravPawn`: hover spring + lateral grip filter (port `Ship.update`), fixed 120 Hz.
2. Spline track builder with curvature→width/banking (port `Track._buildSamples`).
3. Race director: grid, 3-2-1 countdown, lap validation (`lapProgress` guard), standings,
   results — port `main.js` state machine.
4. AI: corner-speed model `v = sqrt(latAccel / curvature)` with lookahead braking + rubber banding;
   upgrade to a learned racing line + overtake personality later (port `AIDriver`).
5. Camera rig with speed FOV, drift roll, shake, 3 modes (port `CameraRig`).
6. Energy gates, boost pads, particles (Niagara), speed lines (post-process).
7. Procedural→sampled audio: keep a synth layer for engine character, add recorded layers.
8. UI: the HUD layout in `index.html`/`style.css` is a usable spec for the final HUD.
9. Netcode layer (§5) and telemetry (§6).
10. Tools: track editor validation ("is this circuit driveable?") built from `tools/sim.mjs`.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Feel doesn't survive the port | Keep the 120 Hz model numbers identical; A/B the web build against UE constantly. |
| Content cost explodes | Modular track kit; 8 tracks × 3 layouts reuses geometry, players perceive 24 circuits. |
| MP scope creep | Ghosts + leaderboards first; online only after feel is locked. |
| Anti-grav niche is small | Scope A budget, strong demo, wishlist-first marketing, Steam Deck verified. |
| Motion sickness complaints | Accessibility sliders from day one (§7). |

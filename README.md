# TACHYON FLOW — Neon Circuit (Prototype v0.9)

A **playable anti-gravity circuit-racing prototype** built as a concept for a AAA racing game.
It takes the *look and energy* of the Steam page reference (stylised, futuristic, third-person,
motion-first) but is **not a runner**: you hold a real vehicle, you steer with full lateral
freedom, you drift, you boost, you fight five rivals over three laps.

**▶ Play:** `npm install && npm run dev` → open the printed URL (default <http://localhost:5173>).

---

## What makes this a racing game and not a runner

| Runner (reference) | This prototype |
| --- | --- |
| Lateral position is snapped to lanes | Free 2D steering; lateral velocity is simulated separately from heading |
| Camera follows a spline | Chase cam with speed-FOV, drift roll, shake, 3 modes |
| Collision = fail state | Barriers are physics: scrapes bleed speed, hull damage, sparks |
| No opponents | 5 AI ships with racing lines, corner-speed braking, drift and boost |
| Speed is scripted | Torque curve, drag, slip angle, drift grip loss, boost drain/regen |
| No race structure | 3 laps, lap timing, best lap, live position, results screen |

### Core loop
1. **Throttle** to build speed; the ship is fastest on a straight.
2. **Drift** (Shift) breaks grip — the hull points into the corner while momentum carries you wide.
   Drifting **recharges boost**, so the fastest way around a corner is also the way to earn the next straight.
3. **Boost** (Space) spends that energy for +40 m/s.
4. **Collect shards** (green rings) for instant boost top-up.
5. **Overtake five rivals** across 3 laps; you start P6.

That feedback triangle (speed → drift → energy → speed) is the entire design thesis and is what a
AAA version should build every system around.

---

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle | `W` / `↑` | RT / A |
| Brake | `S` / `↓` | LT / B |
| Steer | `A` `D` / `←` `→` | Left stick |
| Drift | `Shift` | RB |
| Boost | `Space` | LB / X |
| Camera | `C` | — |
| Mute | `M` | — |
| Restart | `R` | — |
| Pause | `Esc` | — |

---

## Project structure

```
index.html            HUD + menu markup (all UI is DOM, styled like a cockpit)
src/
  main.js             game state machine, race logic, standings, effects wiring
  track.js            spline circuit: sampling, banking, width, meshes, boost pads
  ships.js            handling model (the important file), AI driver, ship mesh, trails
  effects.js          particle system, speed lines, camera rig, energy gates
  audio.js            fully procedural engine/wind/impact synth (no audio assets)
  hud.js              HUD, minimap, results
  input.js            keyboard + gamepad abstraction
  style.css           neon HUD styling
tools/
  sim.mjs             headless physics + 3-lap race simulation with assertions
  dom-smoke.mjs       markup/HUD wiring test (no browser needed)
```

`npm test` runs both. The sim prints lap times, top speed, drift-vs-grip slip and a 3-lap race
result, and **fails the build** if handling or the race breaks.

---

## Handling model (how to tune it)

Everything lives in `TUNING` in `src/ships.js`:

```js
maxSpeed: 100,      // m/s ≈ 360 km/h
boostSpeed: 142,    // m/s ≈ 510 km/h
accel: 46,          // m/s²  (0→90% in ~5 s)
latAccel: 44,       // m/s² usable cornering grip — drives AI corner speeds
steerRate: 1.85,    // rad/s at low speed
steerAtSpeed: 0.72, // authority falloff at top speed (1 = none)
gripNormal: 8.0,    // lateral velocity convergence (higher = more "on rails")
gripDrift: 1.25,    // drift grip — lower = more slide
driftYawBonus: 1.62,// steering multiplier while drifting
boostDrain: 0.42,   // energy per second
boostRegenDrift: 0.19, // energy earned per second while drifting
```

The two knobs that matter most:

* **`gripNormal` vs `gripDrift`** — the ratio *is* the drift feel. 8.0/1.25 gives a clear, readable
  slide (measured: 7.3 m/s of lateral slip gripping vs 29.8 m/s drifting).
* **`latAccel`** — set the corner speeds for both the AI and your expectations. Raising it makes
  the game faster and less forgiving of the circuit's tight corners.

Track shape is defined by `CONTROL_POINTS` in `src/track.js` (metres, y = elevation).
Width and banking are derived from curvature automatically, so a new layout is usually just a
new point list — the sim will tell you if it became undriveable.

---

## Read the next two docs

* **[docs/AAA-ROADMAP.md](docs/AAA-ROADMAP.md)** — how to take this from prototype to a shipping
  title: engine choice, scope, production plan, budget/milestones, art and audio direction,
  Steam/go-to-market, and what specifically must change in this codebase to get there.
* **[docs/DESIGN.md](docs/DESIGN.md)** — the game design document: pillars, race structure,
  progression, ship classes, tracks, modes and the systems to add.

---

## Known prototype limits

* Ships are procedural meshes, not modelled assets; no skeletal animation or pilot model.
* No netcode, no save/progression, no track selection (one circuit).
* Physics is arcade: a single rigid body on a spline-projected surface, no suspension or wheel model.
* Rendering is tuned for a single neon circuit; there is no LOD/streaming system yet.

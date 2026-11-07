# TACHYON FLOW — Game Design Document (prototype-anchored)

Version 0.9 · the numbers in this doc are the ones actually implemented where marked ✅

---

## 1. Concept

**One line:** an anti-gravity circuit racer where the fastest line is also the riskiest — drifting
charges your boost, and boost is the only way to hold a lead.

**Reference tone:** stylised, futuristic, third-person, motion-first (the *Tachyon Flow* Steam page
energy) — but the verbs are racing verbs: steer, drift, boost, overtake.

**Player fantasy:** "I am threading a 400 km/h needle through a city of light, and I never braked
for the corner — I drifted it."

**Not this game:** a lane-based runner, an endless distance score, a parkour platformer.

---

## 2. Design pillars

1. **Flow over friction.** Every input should feel like it compounds. Drifting does not slow you
   down much; it earns you the next boost. ✅ (`boostRegenDrift`)
2. **Readable speed.** Colour, light and motion tell you everything: edge strips = the lane,
   gates = progress, pads = reward, engine rings = throttle state. ✅
3. **Mastery in the drift.** Beginner: brake, then turn. Intermediate: drift the apex.
   Expert: chain drifts so boost never empties. ✅ (`gripDrift` / `driftYawBonus`)
4. **Races you can watch.** Five rival ships with personalities, names and distinct silhouettes,
   visible on the minimap and the leaderboard. ✅

---

## 3. Core systems (implemented)

### 3.1 Ship handling
| Property | Value ✅ | Notes |
| --- | --- | --- |
| Top speed | 100 m/s (360 km/h) | 0→90% in ~5.1 s |
| Boost speed | 142 m/s (511 km/h) | bleeds back after release |
| Acceleration | 46 m/s² | torque curve flattens near top speed |
| Cornering grip (`latAccel`) | 44 m/s² | sets AI apex speeds |
| Grip (normal) | 8.0 | lateral slip ≈ 7 m/s mid-corner |
| Grip (drift) | 1.25 | lateral slip ≈ 30 m/s |
| Drift steering bonus | ×1.62 | plus visual counter-steer |
| Boost capacity | 1.0 | drains 0.42/s, refills 0.19/s drifting |

**Heading vs. velocity are separate.** Steering rotates the hull; grip pulls the velocity vector
toward it. Drifting lowers that pull. This single decision is what separates the game from a
runner and must survive any port.

**Damage:** hull 100. Barrier hits bleed hull proportional to impact normal velocity; hull does not
currently destroy you (prototype) — proposed: below 20 hull you lose top speed 8% and spark.

### 3.2 Track
* Spline circuit, **2019 m**, 16 control points, elevation −2…+22 m.
* Width auto-derives from curvature (17.5 m straights → 12 m in the tightest corner) ✅
* Banking auto-derives from curvature (±9.2°) ✅
* 6 boost pads, 28 energy shards, 190 light pylons, 34 floating arches, void grid + starfield ✅
* Proposed for AAA: 8 biomes, 3 layouts each, weather, destructible props, shortcuts (risk/reward).

### 3.3 Race structure
* 3 laps, 6 ships, player starts **P6** ✅
* Live position from accumulated spline progress ✅
* Lap validation via progress accumulation (no shortcut lap) ✅
* Lap timer, best lap, race total, results screen with position ✅
* AI personality: skill 0.94–1.00, lane bias, aggression → corner speed multiplier ✅
* Rubber banding: ±7% speed based on gap to player (kept subtle) ✅

### 3.4 Energy economy
* Shards: +0.28 boost, +5 m/s instant, 14 s respawn ✅
* Boost pads: +0.18 boost, +14 m/s, 1.5 s cooldown ✅
* Drift: +0.19 boost/s ✅
This creates the pillar loop: *spend boost on straights, earn it in corners.*

---

## 4. Proposed progression (for the AAA build)

**Career ladder** of 5 tiers, each unlocking ships + circuits:
Rookie → Circuit → Pro → Elite → Tachyon Class.

* **Ship classes** (4): *Sprite* (nimble, low top speed), *Vector* (balanced — the prototype ship),
  *Hammer* (top speed, poor drift), *Ghost* (drift/energy specialist, fragile hull).
  Each class changes three numbers in `TUNING`, so tuning stays designer-friendly.
* **Currency:** Flow Credits from races/medals for cosmetics only (never performance — keeps MP fair).
* **Medals** per circuit: bronze/silver/gold/platinum by lap time; ghosts unlock per medal.
* **Ship skins:** palette + decal + trail/engine colour; the prototype's emissive materials make
  recolouring cheap (see `makeShipMesh`).

## 5. Modes

| Mode | Status | Notes |
| --- | --- | --- |
| Circuit Race (6 ships, 3 laps) | ✅ implemented | the core |
| Time Trial + ghost | proposed | reuse race director; store a 120 Hz input recording |
| Elimination | proposed | last place each 20 s is out |
| Endurance / Flow Run | proposed | infinite procedural circuit, distance + combo score |
| Online 8–12 player | proposed | see roadmap §5 |
| Split-screen 2P | proposed | trivial in-engine, big couch-appeal win |

## 6. Levels (proposed slate)

1. **Neon Circuit** — ✅ the prototype track. Night megacity, cyan/magenta.
2. **Solar Spine** — desert solar farm, long sightlines, high top speeds, dust VFX.
3. **Orbital Ring** — low gravity variant (grip −20%), banking exaggerated, Earth below.
4. **Deep Canyon** — tight, technical, rock walls, warm amber palette.
5. **Glacier Line** — low grip, longer drifts, blizzard visibility events.
6. **Foundry** — industrial, hazards (steam vents, moving arms), orange/steel.
7. **Skyline Descent** — downhill, gravity adds speed, biggest risk/reward.
8. **Tachyon Core** — finale, "impossible" banking, Tron-white palette, music peaks.

## 7. Audio direction

* **Engine:** layered synth (saw + square through resonant lowpass) mapped to speed and throttle; ✅
  add recorded turbine layers per ship class in production.
* **Wind:** filtered noise with Q rise while drifting (the prototype's "hiss" cue). ✅
* **Music:** 128–140 BPM breakbeat/synthwave, adaptive stems (duck on boost, layer on final lap).
* **Feedback:** boost whoosh ✅, shard arpeggio ✅, impact thump ✅, countdown beeps ✅.

## 8. UI/UX

* Cockpit-style HUD: speed + tacho, boost/hull bars, lap, position, race & best time, shard count.
* Rival leaderboard, minimap with per-ship colours.
* Splash for countdown/laps/finish; toasts for best lap and camera changes.
* All HUD is DOM/CSS → easy to localise, scale, and port 1:1 to UMG.

## 9. Difficulty & onboarding

* Countdown with a free "hold throttle" start; no penalty for early throttle (prototype). Proposed:
  a **perfect-start boost** if throttle is pressed within 120 ms of GO.
* First lap has a wider racing line guide (subtle edge-strip pulse). Proposed.
* Assist sliders: steering sensitivity, drift assist (auto-counter-steer), brake assist,
  rubber-band strength (off/normal/hero).

## 10. Success metrics (for the vertical slice)

* 80% of new players complete a 3-lap race without quitting.
* Median lap 1 → lap 3 improvement ≥ 6%.
* Players report "fast" and "in control" in the top-2 survey words.
* Drift used on ≥ 35% of corners by lap 3.
* No motion-sickness reports at default settings in a 20-person test.

# SEAMBREAK: Racing Game Brainstorm & Plan

> Working title. A high-adrenaline team racing game with **no tracks, no circuits, no grids and no laps**.
> The world between start and finish is a living, reshapeable volume. The finish line itself moves, resists you, and can
> only be crossed by a team working together.

---

## 0. Ground rules (from the brief)

| Rule | How this plan meets it |
| --- | --- |
| No copying from games | No item boxes, boost pads, nitro bars, homing projectiles, drafting, checkpoints, ghost laps or shrinking safe zones. Every mechanic below comes from a world rule, not a weapon pickup. |
| No copying from films, shows or the internet | The goal is the *feeling* of a giant shared virtual world where anything can happen. No scenes, creatures, set pieces or tricks are borrowed. Nothing runs "backwards to win", and there are no famous monsters. |
| Unique and creative | The core ideas are a drifting finish that must be *pried open*, terrain with its own physics, a team-carried Thread, and speed that becomes a liability. |
| Mechanics that slow or prevent finishing | Section 4 (world rules) and Section 5 (team plays against rivals). Each one has counterplay. |
| Team mechanics and coordination | Section 3 (roles) and Section 6 (team plays). Finishing is impossible solo. |
| No tracks | The route is created live by players and world events. Section 2. |
| High adrenaline, interactive | Section 7 (adrenaline design) and Section 8 (a minute-by-minute match). |

**Originality check before anything ships:** each new mechanic goes through a one-line test: *"Can I name a shipped game
or film where this exact rule is the core of a moment?"* If yes, change it or cut it. Keep a log of the changes in
`Design/RacingGame/ORIGINALITY_LOG.md`.

---

## 1. The core idea in one paragraph

The world is a **Patchwork**: biomes stitched together like fabric, each patch with its own physics. Somewhere in it
drifts **the Seam**, a tear in the sky that is the only way out. It is closed. A team opens it by **pinning** it, with
teammates holding three Stakes around it at once. Only one car can go through: the one carrying the team's **Thread**,
a physical object the team passes between its cars. While all this happens, every other team is folding, cracking,
flooding and twisting the world to stop you. A match is three Seams (three stages), each opening onto a new Patchwork.
There is no lap and no fixed road. The route is whatever your team builds, finds or steals.

---

## 2. Replacing the track: world formats

The world itself is the opponent. These are the building blocks the engine assembles into a Patchwork for each match.

### 2.1 Patch types (each patch = one physics rule)

| Patch | Rule | Why it's exciting | Engine system |
| --- | --- | --- | --- |
| **Hinge Patch** | The ground is hinged slabs. Hitting a **Hinge Lever** folds a slab 90° or 180°, turning a plain into a wall or flipping a far region on top of a near one. | Distances change live. A shortcut can be folded away or created just as you arrive. | Fracture plane cuts + rigid slabs |
| **Tide Patch** | The solid ground rolls in slow, huge waves (10–40 m swells). | Riding *down* the face of a ground-wave is the fastest thing in the game. Mistiming it launches you into the sky. | Displacement driven by an Accelerate zone |
| **Glass Patch** | A crystalline plain with pre-computed fracture lines. Stress shows as glowing cracks. | Spotters can read where it will break. Heavy cars or impacts shatter it into falling islands. | Fracture (baked Voronoi, realtime impact) |
| **Loom Patch** | The ground is a stretched membrane. Heavy cars sag it into pits that roll lighter cars toward them. | Positional warfare: an Anchor can create a "gravity well" that traps pursuers. | Cloth & rigging solver at terrain scale |
| **Lull Patch** | Pools of **Silt**, where local time runs at 40–70 %. | Silt is visible as a shimmer. Driving the edge is fast; drifting in costs seconds. | Damp zones |
| **Updraft Canyon** | Deep rifts with vertical wind. Cars deploy fins and glide. | Three-dimensional racing: dive, climb, ride thermals. | Wind lattice, Jet Corridor, Vortex Column |
| **Ferro Plain** | Iron sand that rises in spikes toward **fast, metallic objects**. | Speed is a liability: go too fast and the ground reaches for you. | Ferrofluid & fields |
| **Void Patch** | No ground at all, only what a Shaper builds, and it decays. | The team that coordinates builds best crosses fastest, and rivals can use your road. | Shaper build pieces (Component Studio geometry) |
| **Bloom Patch** | Vegetation that grows toward noise (engine RPM). | A silent, coasting team slips through. A loud team carves a tunnel the vines close behind. | Foliage & flora growth fields |

### 2.2 The Seam (the finish, re-imagined)

- **It drifts.** The Seam moves slowly across the Patchwork along a path that responds to the world (it is pushed by wind
  storms and pulled toward broken ground). No one can memorise where it ends up.
- **It resists speed.** Around the Seam is a **Pressure Shell**, a repulsor field that pushes harder the *faster* you
  approach. Ramming it at full speed bounces you away. Arriving controlled is faster than arriving reckless.
- **It must be pinned.** Three **Stakes** hover around the Seam. A team opens the Seam while any three of its members
  touch all three Stakes at the same moment (a 2-second "pin window"). With four players, one is free to escort the
  Thread.
- **Only the Thread passes.** Only the car carrying the team's Thread can go through the open Seam. The rest of the team
  follows through automatically 5 seconds later, if the Seam stays pinned.
- **Pinning is contested.** Rivals can knock a pinner off a Stake. That breaks the pin and the window restarts.

### 2.3 Stage structure (no laps)

A match is **three Seams**. Going through one drops the whole lobby into a **new, different Patchwork**, so every stage
is fresh terrain. Team score = placement at each Seam (weighted 1× / 1.5× / 2.5×). A team that loses the first two
Seams can still win the third, so no match is decided early.

---

## 3. Team roles (four players per team)

Every vehicle can drive, but each player picks a role that changes their kit. A team works like a squad, not four
racers who happen to share a colour.

| Role | Vehicle | Unique abilities | What they do |
| --- | --- | --- | --- |
| **Pilot** | Light, fastest | Carries the Thread best (no speed penalty); **Slip**, a short sideways burst through narrow gaps | Finishes. Protected by everyone else. |
| **Spotter** | Agile, can fly briefly | **Lens**: sees fracture lines, Silt pools, Seam drift prediction and hidden folds through the world, and **pings** them to teammates | Navigates and reads the world. Makes the calls. |
| **Shaper** | Medium, utility arms | **Lay**: places temporary ramps, bridges and walls (they decay after ~12 s). **Prise**: pulls Hinge Levers from range | Builds the route and breaks rivals' routes. |
| **Anchor** | Heavy, slow | **Mass Shift**: becomes extremely heavy (sags Loom, cracks Glass, can't be pushed). **Tow**: tethers to a teammate | Blocks, escorts, holds Stakes, recovers fallen allies. |

Teams can field any mix. A double-Shaper team builds monster roads, a double-Anchor team is a fortress, and a
no-Spotter team is fast but blind.

---

## 4. World rules that slow or stop you from finishing

These happen whatever the players do. They are the environment fighting everyone.

1. **Pressure Shell (at the Seam):** the faster you approach, the harder you're pushed back. Players have to make a
   last-second decision: brake into control, or have the Anchor body-block the shell for you.
2. **Fold Shock:** when a Hinge slab folds, everything on it is flung. If you're on it you get launched; if you're
   under it, you're buried until a teammate digs you out (the Anchor's Tow or the Shaper's Prise).
3. **Silt Drift:** Silt pools slowly migrate toward the Seam, so the closer you get the more of the ground is slow-time.
4. **Speed Reach (Ferro):** above 70 % top speed on a Ferro Plain, spikes rise in your predicted path. They're telegraphed
   by a ripple 1 s ahead.
5. **Wake Noise (Bloom):** engine RPM grows vines in your wake *and ahead of the loudest team*. The team leading the race
   is usually the loudest, so the world slows it the most. This is a natural catch-up, not artificial rubber-banding.
6. **Unstitching:** 60 s after the first team goes through a Seam, the Patchwork starts to come apart at its edges
   (fracture plus fall). Late teams race the collapse, but the collapse also opens new short drops toward the Seam.
7. **Storm Fronts:** weather cells (wind vortices, debris particles) sweep the map. They push the Seam and push cars.
   Reading storms is a Spotter skill.

---

## 5. Player plays that slow rivals (no guns, no items)

Every interference comes from **reshaping the world or physics**, never from shooting. Each one has a clear tell and a
counter.

| Play | Who | What it does | Tell | Counter |
| --- | --- | --- | --- | --- |
| **Crack Charge** | Shaper | Marks a structure (bridge, Glass, pillar) to shatter after 3 s | Red crack glow spreads over the target | Spotter sees it early; reroute or speed through |
| **Hinge Steal** | Shaper | Folds a slab while rivals are on it | Hinge creaks, slab edge lights up | Pilot Slip off the edge; Anchor Mass Shift pins the slab |
| **Silt Seed** | Spotter | Drops a small Silt pool (6 s slow-time) | Shimmer bubble | Glide over it; Anchor drags through with Tow |
| **Mass Dump** | Anchor | Sags Loom terrain into a pit right behind the team | Ground dimples, rings of tension | Read the ring; go around |
| **Wind Lean** | Spotter | Briefly bends a nearby storm cell or updraft toward rivals | Particle streamers swing | Fins in to drop out of the wind |
| **False Fold** | Spotter | Paints a fake "safe route" ping into rivals' Lens for 5 s | The fake ping flickers at a different rate (learnable) | Experienced Spotters spot it; trust your own eyes |
| **Stake Shove** | Anyone | Shoulder-checks a pinner off a Stake | Pin ring flashes | Anchor guards the Stake; pinners rotate |
| **Thread Snatch** | Anyone | Intercepts a Thread mid-pass and holds it for 4 s, then it returns to its team | Thread trail turns your colour | Short passes; pass behind the Anchor |
| **Road Hijack** | Anyone | Drives on a rival Shaper's road. Roads are usable by everyone | n/a | Shaper can **Retract** their own road (cooldown), dropping hijackers |

**Interference limits:** each team has a shared **Disruption Budget** that refills over time. That keeps any one team
from locking another out, and makes each interference a team decision.

---

## 6. Team coordination mechanics

These turn teammates into one machine. They are the reason to play with friends.

1. **The Thread.** A glowing physical object, the team's "key". It is passed by **throwing** it between cars (physics
   arc, catchable). The holder is slightly slower unless they're the Pilot. Passing it in mid-air between two cars
   gliding over a canyon is the hero moment of the game.
2. **Tethers.** Any two teammates can link with a cable (cloth/rope physics):
   - **Swing**: one car anchors and the other swings across a gap.
   - **Slingshot**: the Anchor brakes and the tethered Pilot is whipped forward.
   - **Clothesline**: stretch a tether between two cars as a barrier that trips rivals.
   - Rivals can cut a tether with a hard pass. It snaps with a whip effect.
3. **Formations ("Chords").** When teammates hold a shape for 2 seconds they get a shared effect:
   - **Line (3 in a row): Lance.** The front car pierces Pressure Shells and Bloom vines.
   - **Triangle: Bulwark.** A shared dome absorbs a Crack Charge or wind shove.
   - **Pair side-by-side: Span.** The road the Shaper lays between them doesn't decay while they hold the shape.
4. **Momentum Gift.** A trailing teammate can beam their stored momentum to a teammate ahead. The giver nearly stalls and
   the receiver surges. It is a sacrifice play.
5. **The Pin.** Opening the Seam needs three teammates on three Stakes at once (Section 2.2). It's the climax of every
   stage: arrive together, protect each other, time it.
6. **Callouts.** One-button contextual pings ("fold here", "crack ahead", "pass now", "pin in 3"). Each role has its
   own ping set, so even players without voice chat can coordinate.

---

## 7. Adrenaline design

What keeps the heart rate high, every ~20 seconds:

- **The Drop.** Every stage starts with the whole lobby falling from the sky into the new Patchwork. Players steer the
  fall and pick a landing patch. The race begins before anyone touches the ground.
- **Ground-wave surfing (Tide Patch).** The fastest line is the most dangerous one.
- **Live folds.** The world shifts under you; continents swing past overhead.
- **Mid-air Thread passes** across Updraft Canyons.
- **Glass collapse.** The plain shatters into falling islands and you jump from island to island.
- **The Pin.** The final 10 seconds of every stage is a brawl around three Stakes, with the Seam pulsing open and shut.
- **Unstitching.** The world disintegrating behind the trailing teams.
- **Audio and visual intensity rises with proximity to the Seam:** music layers build, the sky tears wider, the
  Pressure Shell hums.

**Readability rule:** every threat has a tell at least 1 second ahead (glow, ripple, creak, shimmer). Adrenaline should
come from reacting fast, not from cheap deaths.

---

## 8. Example match timeline (4 teams × 4 players, ~12 minutes)

| Time | Moment |
| --- | --- |
| 0:00 | **Drop 1.** All 16 cars fall into Patchwork A (Tide + Glass + Hinge). Spotters call the Seam's drift. |
| 0:40 | Team Red's Shaper lays a bridge across a Void gap. Team Blue hijacks it; Red retracts the bridge mid-crossing. |
| 1:30 | A storm front pushes the Seam over the Glass Patch. Every team turns. |
| 2:10 | Team Green's Anchor Mass Shifts on the Glass, shattering it under two rivals. |
| 3:05 | **Pin brawl.** Red pins, Blue shoves a pinner off, Red's Anchor guards the Stake, Red re-pins and the Pilot dives through. |
| 3:05–4:05 | Unstitching starts. The other three teams race the collapse. |
| 4:30 | **Drop 2** into Patchwork B (Updraft + Loom + Bloom). |
| 6:00 | Blue throws its Thread across an updraft canyon. Green snatches it and holds it for 4 s; Blue loses the lead. |
| 7:40 | Green forms a Lance and pierces the Pressure Shell; Green takes Seam 2. |
| 8:30 | **Drop 3** into Patchwork C (Ferro + Lull + Hinge + Void). Worth 2.5×. |
| 11:50 | Final pin. Red uses a Momentum Gift and a tether Slingshot to get the Pilot to the Seam the instant it opens. |

---

## 9. Vehicles

- **Modular chassis** built from parts (Component Studio): core, wheels/tracks, fins, utility arms, mass plates. Each
  role has a starting chassis; cosmetics and *side-grades* (never straight upgrades) unlock with play.
- **Three driving modes, switched instantly:** **Grip** (ground), **Glide** (fins out, wind-driven) and **Mass** (Anchor
  heavy mode; other roles get a 1 s version).
- **No health bar.** Damage is **mass loss and parts shedding**: hits knock off fins or plates, which changes how the car
  handles. Allies can reattach dropped parts by driving over them.

---

## 10. Game modes (all trackless)

1. **Seambreak (core):** 4 teams × 4 players, three Seams.
2. **Escort:** one team carries a giant, slow Thread (a rolling sphere) to the Seam. The other team reshapes the world to
   stop it. Swap sides at half time.
3. **Shaper Duel:** 2v2. Each team has one Pilot and one Shaper, in an all-Void map. Pure build-and-break.
4. **Drift Hunt:** several small Seams appear and vanish across a huge Patchwork. Teams claim as many as possible in
   10 minutes.
5. **Architect Night (event):** one player per lobby is the *World*, controlling storms, folds and Silt from above, with a
   Disruption Budget. Everyone else races.

---

## 11. How it maps onto our engine

| Game system | Existing work to build from |
| --- | --- |
| Glass Patch, Crack Charges, Unstitching, Hinge crumble | **Fracture Editor**: Voronoi/plane cuts, impactors, Baked (pre-computed fracture lines a Spotter can read) vs Realtime (impact shatter) |
| Updraft Canyons, Storm Fronts, Wind Lean | **Particle Studio force fields**: Wind Generator, Vortex Column, Jet Corridor, lattice readback for car aerodynamics |
| Pressure Shell, Stake Shove impulse | Repulsor field, Impulse Shell |
| Silt / Lull Patch | Damp zones (local time scaling) |
| Tide Patch ground-waves | Accelerate zones plus terrain displacement |
| Tethers, Loom Patch | Cloth & Rigging solver |
| Ferro Plain | Ferrofluid & Fields |
| Bloom Patch | Foliage & Flora growth |
| Thread passing | Particle Studio's Throw Ball tool (physics arc and catch) is a direct prototype |
| Modular vehicles, Shaper build pieces | **Component Studio**: Component Viewer, Geometry Compile, Material Workspace |
| Patch surface stitching visuals | **UV Editor**: UV layers / UDIM for stitched patch seams |

---

## 12. Prototype plan (gray-box first, fun before features)

| Phase | Build | Question it must answer |
| --- | --- | --- |
| **P0: One car, one patch** (2 wks) | Grip/Glide/Mass driving on a Tide Patch | Is ground-wave surfing fun on its own for 5 minutes? |
| **P1: The Seam** (2 wks) | Drifting Seam, Pressure Shell, 3 Stakes, Thread | Does the pin create a tense finish? Is "slow down to finish" satisfying or frustrating? |
| **P2: Two teams** (3 wks) | 2v2, Thread throwing, Stake Shove, Thread Snatch | Do players naturally coordinate? Is interception readable? |
| **P3: Roles** (3 wks) | Spotter Lens, Shaper Lay/Prise, Anchor Mass/Tow | Does each role feel essential? Is any role boring? |
| **P4: Patchwork** (4 wks) | Hinge + Glass + Void + Updraft, procedural stitching | Do stitched patches produce varied, readable routes with no track? |
| **P5: Full match** (4 wks) | 4×4, three Seams, Unstitching, Disruption Budget | Is a 12-minute match high-energy start to finish? Comeback rate ≥ 30 %? |

**Metrics to watch:** seconds between "adrenaline moments" (target ≤ 20), Thread pass success rate (target 60–75 %),
pin attempts per Seam (target 2–4), share of finishes decided in the final stage (target ≥ 35 %).

---

## 13. Open questions

1. Team size: 4 per team, or 3 (drop the free escort and make the pin need everyone)?
2. Should rivals be able to *use* your Stakes (steal your pin progress)?
3. Perspective: third-person chase cam only, or a first-person cockpit for immersion?
4. VR or full-body support for the "inside the virtual world" fantasy?
5. Persistent world between matches (patches that remember damage), or a fresh Patchwork every time?
6. Should the Architect Night mode become a permanent role?

---

## 14. Idea parking lot (raw, not yet filtered)

- **Echo Stones:** terrain that replays the last car that touched it as a brief solid impression, which a teammate can
  ride off like a ramp.
- **Gravity Tithe:** whoever leads a stage pays a "tithe": gravity bends very slightly toward the chasers.
- **Weathervane Seam:** the Seam always faces the strongest wind, so steering the storms steers the finish.
- **Patch Auction:** before a stage, teams secretly bid Disruption Budget on which patches appear in the next Patchwork.
- **Sleeping Ground:** huge dormant terrain forms that wake at a noise threshold and rearrange a region.
- **Mirror Stake:** a fourth decoy Stake. Pinning it by mistake reverses the Seam's drift.

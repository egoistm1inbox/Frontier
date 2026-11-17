# Cabin HMI evidence

Headless Chromium captures of the three HMIs and three dashboard clusters in `Experimental/CabinHmi/`.
Each step file clicks through every menu and its main interactions; every run reported **0 console errors**.

| File | Shows |
|---|---|
| `Contour-1…6` | Amethyst/verdant recolour: Terrain (Trail), Rock + X-ray, Tyres (front-right trimmed), Tilt (dragged pose), Sensors (fans), Vehicle (underbody lamps) |
| `Afterglow-1…6` | Horizon (dune dusk), Star camp preset, Drive (Flow glide), Climate (split zones, airflow, seat warmth), Rest (ring timer), Media (spectrum) |
| `Nocturne-1…6`, `3b`, `5b` | Home, Assistant, Drive power current (City cruise: electric), `3b` Sport (engine plus e-boost), Charge (aurora), Comfort (seats, A/C), `5b` seat set (driver Memory 2, passenger slid by drag, back angle 124°), Media |
| `Contour-7`, `Afterglow-7`, `Nocturne-7` | Lights (high beam, fogs, extras) for each HMI |
| `Dash-{Ridge,Halo,Tide}-{Cruise,Eco,Sport,Race}` | Dashboard clusters in each mode, demo drive running (`Scripts/ClusterSteps.json`) |
| `Visor-1…8` | HUD demo (`Scripts/VisorSteps.json`): cruise, teammate ping + beacon, porcupine tag then BRAKE, signal green → amber → red countdown, engine overheat, station suggestion, routed chevrons into the bay, oxygen low, looking around the cockpit |
| `Visor-9…14` | Follow-up 6: steering into the far lane (both lanes' guides blend), back again, ping wheel open on DANGER, ping placed, slow car ahead with ACC + OVERTAKE CLEAR, the overtake and OVERTAKE COMPLETE, oncoming car in your lane (red box, banner, braking), autopilot auto-return, rear-end collision, oncoming traffic platoon |
| `Lobby-1…7` | Garage lobby (`Scripts/LobbySteps.json`): the seven procedural sets with their Garage options, from Canopy Grove to Pit Box |
| `Lobby-8…14` | Car tab (red paint, gunmetal rims, yellow calipers, rear wing), Light tab with the light plot (key swung to 320°, cyan, Ember lamps), Grove at Night from the Low preset, Moss Stage in Autumn (seed 77), Monolith at Dusk with 8 slabs and Pit Box Night race (both with the interface hidden), and a real mouse drag orbiting the Lightbox (Night walls, lime accent) |
| `Lobby-15…24` | Configurator (Follow-up 9): Photo Studio set view, Front ¾ with the hotspot dots (black cyc), Wheels close-up (bronze rims, tan tyres, yellow calipers), Tail lights close-up (purple, wing), Workshop with the lift at 1.2 m, Night tuning underglow close-up (magenta, splitter, skirts, light bar), drivetrain cutaways V8 AWD automatic, Inline-6 FWD manual and Electric dual-motor AWD, Workshop Old school with the door open |
| `Acoustics-1…6` | Sound bench (`Scripts/AcousticsCheck.cjs`): woken bench, LaFerrari launch in 3rd at 128 km/h with KERS assist, gravel + cabin mic + cornering squeal with the xenon cue ringing and the indicator looping, GT-R NISMO pulling 3rd on full boost, GT-R ABS stop (ABS chip lit) after a kerb strike, impact pads ringing (explosion, window shatter, metal crash) |
| `Acoustics-7-Weapons` | Weapons and Bullets panels mid-burst: energy LMG trigger lit (firing) with the Turbocharger hop-up on; bullet pass-by, ricochet and 8 impact pads |
| `Acoustics-8-Power` | Forced induction and Electric panels: twin-screw supercharger picked, the Demon's blower pad, the Turbo lag slider and tip-in stopwatch, sport sound on, aircraft pads |
| `Acoustics-9-Shells` | Shells panel with three casing cues ringing (brass rain, steel floor, 120 mm stub) under the Weapons and Bullets panels |
| `Audio-*.png` | Spectrogram + waveform plates for every reel file in `Audio/` (cyan dots on engine plates = predicted firing frequency: rpm/10 for the V12, rpm/20 for the V6; on supercharger plates the predicted blower whine, rpm × drive ratio × lobes; on EV plates a predicted motor order) |
| `Lucent-1…6` | Rejected first HMI C attempt (kept for reference) |

## Vehicle sound reel (`Audio/`)
All synthesized in code — no recordings or samples anywhere. 192 kbps stereo MP3 at 44.1 kHz (lamejs), rendered by
`Experimental/CabinHmi/Acoustics/Offline/RenderReel.mjs` (deterministic seeds; `--wav` also writes WAV). 63 files, 16 MB in total (the
Follow-up 10 WAVs, 22 MB, were replaced). Peak is measured before encoding.

| File | Length | Peak dBFS | RMS dBFS | Content |
|---|---|---|---|---|
| `LaFerrari-ColdStart.mp3` | 10.0 s | −1.2 | −20.1 | Starter with compression load, catch, flare to ~3000, cold idle, three blips in neutral |
| `LaFerrari-Launch.mp3` | 13.5 s | −2.8 | −16.0 | Chase mic, launch, ignition-cut upshifts with gearbox clunks (0–100 3.2 s, 0–200 6.7 s), lift with overrun |
| `LaFerrari-Onboard.mp3` | 14.0 s | −6.2 | −17.0 | Cabin mic, pull 3-4-5, hard braking (ABS, brakes, suspension) with blipped downshifts, corner, exit |
| `LaFerrari-Limiter.mp3` | 7.5 s | −1.6 | −18.1 | Neutral on the 9250 rpm limiter, lift with pops, two sharp blips |
| `LaFerrari-FlyBy.mp3` | 8.0 s | −1.0 | −18.4 | Trackside at 12 m, 262 km/h in 6th: Doppler, distance, air absorption, ground bounce, exhaust directivity |
| `GtrNismo-ColdStart.mp3` | 10.0 s | −1.0 | −20.1 | VR38DETT: starter, catch, fast cold idle ~1150, three blips with turbo whistle and flutter |
| `GtrNismo-Launch.mp3` | 13.5 s | −2.6 | −16.0 | Launch-control boost build, AWD launch (0–100 2.9 s), 6-speed DCT upshifts with clunks, lift with blow-off |
| `GtrNismo-Onboard.mp3` | 14.0 s | −3.2 | −17.0 | Cabin mic, pull 3-4-5 on boost, ABS stop with blipped downshifts, corner, spool back up on exit |
| `GtrNismo-FlyBy.mp3` | 8.0 s | −1.1 | −18.1 | Trackside at 12 m, 225 km/h in 5th on full boost |
| `Tyres-Screech.mp3` | 12.0 s | −3.5 | −17.0 | Cornering squeal at the limit, panic stop with lock-up, standing burnout |
| `Surfaces-Tour.mp3` | 28.0 s | −5.8 | −19.0 | 60 km/h over asphalt, wet, gravel, dirt, grass, cobbles, rumble strip (4 s each) |
| `Chassis-Brakes.mp3` | 12.0 s | −1.4 | −20.0 | 130 km/h ABS stop (pump buzz, valve clicks, pad roar), light braking into squeal, creep groan to a halt |
| `Chassis-Suspension.mp3` | 16.0 s | −5.6 | −20.0 | Cabin mic at 40 km/h: kerb strike, cobbles, pothole, rutted dirt, rumble strip (dampers, bump stops, bushings, rattles) |
| `Lights-Cues.mp3` | 10.5 s | −1.0 | −26.6 | Headlamp switch, lamp relay, xenon ignition, LED welcome with levelling, indicator relay |
| `Cabin-Cues.mp3` | 25.0 s | −1.0 | −26.6 | Unlock, butterfly door open and close, seatbelt, belt chime, start button, paddle, window, wipers, climate fan |
| `Impact-Explosion.mp3` | 6.5 s | −0.5 | −22.4 | 60 m: blast overpressure, sub thump, fireball roar, debris falling back, echoes off distant surfaces |
| `Impact-ExplosionFar.mp3` | 6.5 s | −0.5 | −19.6 | Same blast at 450 m: the crack is absorbed by the air, the boom and echoes carry |
| `Impact-Shockwave.mp3` | 4.0 s | −0.9 | −20.3 | N-wave double crack, air rush sweeping past, glass and panels rattling |
| `Impact-EmpPulse.mp3` | 6.0 s | −0.9 | −20.9 | Capacitor charge whine, discharge slap and sub drop, arcing, electronics winding down, ears ringing |
| `Impact-SonicBlast.mp3` | 4.5 s | −0.9 | −14.8 | Spin-up, beating pressure beam over an infrasonic body, cut-off into a rush |
| `Impact-WindowShatter.mp3` | 2.4 s | −1.4 | −30.6 | Tempered side glass: tap, pop, crazing hiss, cubes pouring and tinkling |
| `Impact-GlassBreak.mp3` | 2.6 s | −1.4 | −31.8 | Annealed pane: crack, ringing shards breaking away, landing, scattering, bouncing |
| `Impact-MetalCrash.mp3` | 6.0 s | −0.5 | −28.9 | Impact, sheet buckling, lamps bursting, scrape, lurch, hubcap, settling creaks, coolant hiss |
| `Weapon-EnergyLmg.mp3` | 5.6 s | −0.9 | −19.5 | Energy LMG voiced as a real full-power LMG (Follow-up 14), full 44-round magazine: 5 → 15 rounds/s over 1.75 s; heavy report with low-mid boom and supersonic crack, geared drive and barrel clatter, rolling outdoor tail, brass landing on concrete |
| `Weapon-EnergyLmgTurbo.mp3` | 4.8 s | −0.9 | −19.3 | Same with the Turbocharger: 6.8 → 15 rounds/s over 0.85 s, turbine whistle and charge hiss on the pull |
| `Weapon-Lmg.mp3` | 5.5 s | −0.9 | −15.4 | Belt-fed LMG, 640/min: long burst and two short, links and brass, outdoor slap-back |
| `Weapon-Smg.mp3` | 4.5 s | −0.9 | −21.2 | SMG, 900/min: two short bursts, then the rest of a 30-round magazine |
| `Weapon-Sniper.mp3` | 5.5 s | −0.5 | −25.5 | Heavy blast and thump, report rolling off the valley, bolt cycle, casing landing |
| `Weapon-Turret.mp3` | 6.0 s | −0.9 | −17.9 | Servo traverse, lock-on pips, 720/min burst with feed motor, spin-down |
| `Weapon-Cannon.mp3` | 7.0 s | −0.5 | −22.5 | 120 mm: blast wave, chest thump, fireball roar, hull ring, echoes, breech clank, case clang |
| `Weapon-AutoCannon.mp3` | 5.0 s | −0.7 | −18.0 | 30 mm, 210/min: two bursts, heavy action, big cases ringing |
| `Bullets-Supersonic.mp3` | 4.5 s | −0.9 | −30.1 | Downrange of a rifle 400 m away: crack first, muzzle report 0.67 s later |
| `Bullets-Whizz.mp3` | 2.6 s | −1.4 | −24.4 | Three subsonic fly-bys: Doppler drop, vortex tone, panning across |
| `Bullets-Ricochet.mp3` | 3.0 s | −1.4 | −22.9 | Glancing off rock, steel and concrete: strike then tumbling whine |
| `Bullets-Impacts.mp3` | 11.0 s | −1.4 | −29.5 | Sand, dirt, rock, concrete, wood, metal, glass, water, 1.2 s apart |
| `Shells-Floors.mp3` | 16.6 s | −1.4 | −28.1 | Spent cases (`Casings.js`): 7.62 mm on concrete, 5.56 mm on a wooden deck, 7.62 mm on a steel floor, 7.62 mm on dirt — ring, bounce series, roll |
| `Shells-Calibres.mp3` | 20.4 s | −1.4 | −26.9 | 9 mm pistol, 12-gauge shotgun, .50 BMG on steel, 30 mm cannon on steel, 120 mm case stub on the turret floor |
| `Shells-BrassRain.mp3` | 5.5 s | −1.4 | −26.7 | 32 cases and belt links from a 3 s LMG burst raining onto concrete, clinking on the pile, last ones rolling |
| `Demon-ColdStart.mp3` | 10.5 s | −1.0 | −19.1 | Dodge Challenger SRT Demon (Follow-up 15): starter, catch and flare, lumpy cross-plane idle (each bank fires unevenly, firing order 1-8-4-3-6-5-7-2), three blips with the stock 2.7 L blower's scream, overrun pops |
| `Demon-Launch.mp3` | 15.5 s | −2.4 | −16.0 | Staged on the TransBrake at 2350 rpm, released: 1.8 g, 8-speed upshifts, quarter mile in about 9.8 s at 142 mph, lift. Cyan dots: predicted blower whine (rpm × 0.157) |
| `Demon-RollOn.mp3` | 16.5 s | −2.0 | −17.0 | Third gear from 2600 rpm, floored three times: the belt-driven blower makes boost the instant the throttle opens (no lag) |
| `TurboLag-Compare.mp3` | 16.5 s | −1.7 | −17.0 | GT-R with parallel twin turbos, the same 3rd-gear roll-on from 2600 rpm with lag off, real lag and 2.5× lag; cyan dots: whistle pitch predicted from the simulated shaft speed |
| `Induction-SmallSingle.mp3` | 11.0 s | −3.2 | −17.0 | Every `Induction-*` scene: GT-R NISMO with the inducer swapped in, chase mic: two blips, pull from rest, lift, back on, lift. Small single turbo: quick spool, bright whistle, soft blow-off |
| `Induction-BigSingle.mp3` | 11.0 s | −2.4 | −17.0 | Big single turbo: late, violent boost, deep whoosh, loud blow-off |
| `Induction-TwinTurbo.mp3` | 11.0 s | −2.9 | −17.0 | Parallel twins: two detuned whistles beating, blow-off with a little flutter |
| `Induction-Flutter.mp3` | 11.0 s | −2.4 | −17.0 | Turbo with no blow-off valve: compressor surge chatter on every lift |
| `Induction-Vgt.mp3` | 11.0 s | −3.1 | −17.0 | Variable-geometry turbo: early boost, whistle sweeping with the vanes, no valve |
| `Induction-ElectricTurbo.mp3` | 11.0 s | −2.8 | −17.0 | Electric-assist turbo: no lag, motor whine on the shaft, harvest whine on lift |
| `Induction-Roots.mp3` | 11.0 s | −3.9 | −17.0 | Roots blower: gear-driven whine with a chugging pocket pulse |
| `Induction-TwistedLobe.mp3` | 11.0 s | −3.6 | −17.0 | Twisted 4-lobe supercharger: high smooth scream, bypass valve on the cruise |
| `Induction-TwinScrew.mp3` | 11.0 s | −3.2 | −17.0 | Twin-screw supercharger: raspy harmonic-rich scream, timing-gear whine |
| `Induction-Centrifugal.mp3` | 11.0 s | −3.2 | −17.0 | Centrifugal supercharger: whine and boost climbing with rpm squared, blow-off on lift |
| `Taycan-Launch.mp3` | 14.0 s | −6.6 | −18.0 | Porsche Taycan Turbo S, chase mic: ready chime, launch 0–200 km/h, both motors whining, rear 2-speed shift near 100 km/h, coast |
| `Taycan-Onboard.mp3` | 15.0 s | −5.3 | −20.0 | Cabin mic: gentle pull-away, cruise, floor it (stays in 2nd above 60 km/h), regenerative braking to a stop |
| `Taycan-SportSound.mp3` | 11.5 s | −4.9 | −18.0 | Same car with the synthetic sport-sound layer on |
| `Taycan-FlyBy.mp3` | 8.0 s | −1.1 | −20.1 | Trackside at 12 m, 200 km/h in 2nd: motor whine, tyres and wind |
| `NextGen-Launch.mp3` | 14.0 s | −4.7 | −17.0 | Next-Gen racer (original, Jackson Storm style), chase mic: whir locked to the motor, V8 undertone, sequential upshifts dropping the pitch |
| `NextGen-Onboard.mp3` | 14.0 s | −3.7 | −17.0 | Cabin mic: pull 3-4-5, brake with downshifts (8.06 s to 4th, 8.77 s to 3rd), corner with squeal, exit |
| `NextGen-FlyBy.mp3` | 8.0 s | −1.0 | −18.6 | Trackside at 12 m, 290 km/h in 6th: whir and undertone with Doppler |
| `Aircraft-TrainerRunUp.mp3` | 10.0 s | −0.9 | −20.3 | Electric trainer on the apron: 2-blade prop spin-up, full-power run-up, idle, stop |
| `Aircraft-TrainerTakeoff.mp3` | 18.0 s | −0.9 | −20.7 | 25 m beside the runway: roll, rotation, climb-out past and away |
| `Aircraft-RacerFlyover.mp3` | 10.0 s | −0.7 | −23.4 | Electric racer at 430 km/h, 35 m up: buzzy near-Mach tips, strong Doppler drop |
| `Aircraft-AirTaxi.mp3` | 18.0 s | −0.9 | −19.9 | eVTOL: six rotors spin up, lift-off, hover with beating rotor tones, transition away |

**"Less flat" LaFerrari (Follow-up 11).** `_ClaudeScratch/tmp/audio/flat.mjs` measures the firing order against the strongest half/low
order (gap: smaller = more audible chatter), the cycle-to-cycle level variation (CV) and the crest factor, on the chase mic:

| Point | Gap before → after | Cycle CV before → after | Crest before → after |
|---|---|---|---|
| 1000 rpm idle | 32 → 22 dB | 10 → 34 % | 8.9 → 13.5 dB |
| 3000 rpm, half throttle | 27 → 14 dB | 11 → 28 % | 6.7 → 10.7 dB |
| 6000 rpm, full | 30 → 16 dB | 17 → 19 % | 6.9 → 8.9 dB |
| 9000 rpm, full | 19 → 10 dB | 13 → 17 % | 7.8 → 10.2 dB |

Firing order still lands on the prediction: V12 300.1 / 600.2 / 900.4 Hz at 3000 / 6000 / 9000 rpm (rpm/10). GT-R V6: 149.4 / 300.1 Hz at
3000 / 6000 rpm (rpm/20); its idle is deliberately lumpy (gap 0 dB, CV 44 %). Browser path (`Bench.RenderOffline(6)` in headless Chromium,
OfflineAudioContext + worklet, start then floor it in neutral): LaFerrari ends on the limiter at 9154 rpm, peak −0.1 dBFS, RMS −12.4;
GT-R ends on its 7100 limiter at 7087 rpm with boost 1.0, peak −0.2, RMS −19.1; 0 non-finite samples. Live run: LaFerrari idle 1346 rpm →
128 km/h in 3rd → corner → ABS stop (lock-up 0.08 with ABS on); switched to the GT-R: idle 1114 rpm (cold) → 131 km/h in 3rd on full boost
after 4.5 s → ABS stop (ABS chip lit) with a kerb strike → pothole, explosion, window shatter and crash cues all playing. Console errors: 0.

**Weapons (Follow-up 12).** `_ClaudeScratch/tmp/audio/ballistic.mjs` renders all 19 `Ballistics` cues: 0 non-finite samples, 30–410 ms
each. Energy LMG timing from `FireRate`: the top rate (15 rounds/s) is reached after 17 rounds without the Turbocharger and 9 with it; the full
44-round magazine empties in 3.56 s vs 3.19 s. Live trigger in headless Chromium (`Bench.Fire`, `Acoustics-7-Weapons.png`): a 1.75 s hold
fired 19 rounds bare and 24 with the Turbocharger; SMG 1 s → 17 rounds; 8 weapon pads and 11 bullet pads; console errors 0.

**Turbos, superchargers, EVs, aircraft (Follow-up 13).** Browser path (`Bench.RenderOffline` in headless Chromium, `Scripts/AcousticsCheck.cjs`),
0 non-finite samples in every render: Taycan in 1st → 110 km/h in 2nd, peak −3.7 dBFS, RMS −17.5; Next-Gen racer → 99 km/h in 1st at
15 898 rpm, peak −2.1, RMS −14.5; GT-R + Roots on the limiter (7065 rpm), peak −0.1, RMS −16.5; LaFerrari + big single (9204 rpm), peak 0,
RMS −12.5. Live: Taycan 156 km/h in 2nd, both motors 9297 rpm, then regen to 112 km/h with motor torque −0.35; Next-Gen racer 146 km/h in
2nd at 17 040 rpm; GT-R with a twin-screw swapped for the no-blow-off turbo while driving: 130 km/h in 3rd, boost 0.87; `Fly('RacerFlyover')`
10.03 s; 11 induction and 7 electric pads; console errors 0. Model launches (`_ClaudeScratch/tmp/audio/launch.mjs`): Taycan 0–100 2.83 s,
0–200 9.86 s, top 259 km/h; Next-Gen racer 3.43 / 7.27 s, 338 km/h; GT-R with each inducer 0–100 2.75–3.48 s. Supercharger whine
lands on the predicted rpm × ratio line on every blower plate.

**Real-gun Energy LMG and shells (Follow-up 14).** The old Energy LMG put 24 % of its energy at 1–6 kHz (a pitched "pew" zap falling
2.6 kHz → 420 Hz and a sine-stack motor whine) and almost none at 150–400 Hz, where a real report has its weight. Now (`_ClaudeScratch/tmp/audio/gunbands.mjs`,
full-magazine cue, share of energy): 0–150 Hz 44 %, 150–400 10 %, 400–1000 18 %, 1–2.5 k 15 %, 2.5–6 k 9 %, 6 k+ 4 % (before: 61 / 2 / 9 / 15 / 9 / 3).
The zap is gone (only a faint arc crackle about 40 dB under the shot), the motor is a geared drive (mesh grind gated at the tooth rate), and a
live shot peaks at −11.1 dBFS next to the LMG's −12.6 (`Level` 0.6). Brass now lands about 29 dB under each live shot's peak (`layers.mjs`; the
old bounce sat about 50 dB under, inaudible). Shell plates show the case ring falling with calibre (9 mm ≈ 9.4 kHz, 7.62 mm ≈ 4.6 kHz,
.50 ≈ 2.5 kHz, 30 mm ≈ 1.25 kHz, 120 mm ≈ 520 Hz), the shrinking bounce gaps, the steel floor's 740 Hz plate mode and dirt killing the
ring. Headless check: 10 shell pads, three ringing at once, the three shell clips served (200); every earlier check unchanged; console errors 0.

**Dodge Demon and turbo lag (Follow-up 15).** The Demon is supercharged, not turbocharged: a 2.7 L twin-screw blower at 14.5 psi on
the 6.2 L HEMI (Dodge press kit). `Demon` in `PulseTrainEngine.js` is a cross-plane V8: `BankAngles` gives each bank its real uneven
firing gaps, so the side signal (L−R, chase mic) at 1800 rpm carries the 1.5× and 0.5× orders at −5 and −19 dB against the 4th
(firing) order, while the summed signal stays even (`_ClaudeScratch/tmp/audio/demon.mjs`). Torque table: 1044 Nm at 4500, 840 hp at 6300,
6500 limiter, the 8HP90's ratios, `TransBrake` input, `Drive.Grip` 2.9 (drag radials, 1.8 g). Model run (`lag.mjs`): 0–60 mph 2.16 s,
quarter mile 9.77 s at 142 mph (Dodge: 2.3 s, 9.65 s at 140.09 mph). Turbo lag is now a shaft model in `TractionIntegrator.Turbo`
(exhaust energy grows with rpm^1.7 × load × boost, shaft inertia from each turbo's `Lag`, pressure ∝ shaft speed², a slow coast-down
so a quick re-apply comes back fast); the engine and inducer whistles follow the same shaft (`Spool`). Time to 90 % of the steady boost:
GT-R stock 1.19 s at 2500 rpm, 0.62 s at 3500, 0.34 s at 5500; big single 1.23 s at 5500 and no boost below its 3600 rpm onset;
electric-assist turbo 0.15–0.19 s; re-applying after a 0.4 s lift 0.22–0.37 s. Superchargers have no lag (boost follows throttle and rpm).
Headless check: Demon staged at 2350 rpm, 0 km/h, boost 1; 106 km/h 2.5 s after release; stock blower voice confirmed (`Stock:
DemonScrew`); the bench's lag stopwatch reads 0.10 s (lag off), 1.69 s (real lag) and 2.78 s (2.5×) for the same tip-in; build tag
"build 15" shown; console errors 0. The nine turbo clips (GT-R and `Induction-*` turbos) were re-rendered with the new lag.

## Reproduce
```
cd /tmp/pw   # playwright-core@1.49 + @sparticuz/chromium@131
AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node <repo>/Exhibits/CabinHmi/Scripts/CaptureHmi.cjs \
  http://localhost:8097/Experimental/CabinHmi/Nocturne/Nocturne.html <repo>/Exhibits/CabinHmi/Scripts/NocturneSteps.json <outdir>
```
📝 Headless WebGL runs at about 3 fps, so frame-delta motion looks slow in captures. Palette and colour easing use wall time.

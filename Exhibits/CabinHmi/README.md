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
| `Audio-*.png` | Spectrogram + waveform plates for every reel file in `Audio/` (cyan dots on engine plates = predicted firing frequency: rpm/10 for the V12, rpm/20 for the V6) |
| `Lucent-1…6` | Rejected first HMI C attempt (kept for reference) |

## Vehicle sound reel (`Audio/`)
All synthesized in code — no recordings or samples anywhere. 192 kbps stereo MP3 at 44.1 kHz (lamejs), rendered by
`Experimental/CabinHmi/Acoustics/Offline/RenderReel.mjs` (deterministic seeds; `--wav` also writes WAV). 35 files, 7.1 MB in total (the
Follow-up 10 WAVs, 22 MB, were replaced). Peak is measured before encoding.

| File | Length | Peak dBFS | RMS dBFS | Content |
|---|---|---|---|---|
| `LaFerrari-ColdStart.mp3` | 10.0 s | −1.2 | −20.1 | Starter with compression load, catch, flare to ~3000, cold idle, three blips in neutral |
| `LaFerrari-Launch.mp3` | 13.5 s | −2.8 | −16.0 | Chase mic, launch, ignition-cut upshifts with gearbox clunks (0–100 3.2 s, 0–200 6.7 s), lift with overrun |
| `LaFerrari-Onboard.mp3` | 14.0 s | −6.2 | −17.0 | Cabin mic, pull 3-4-5, hard braking (ABS, brakes, suspension) with blipped downshifts, corner, exit |
| `LaFerrari-Limiter.mp3` | 7.5 s | −1.6 | −18.1 | Neutral on the 9250 rpm limiter, lift with pops, two sharp blips |
| `LaFerrari-FlyBy.mp3` | 8.0 s | −1.0 | −18.4 | Trackside at 12 m, 262 km/h in 6th: Doppler, distance, air absorption, ground bounce, exhaust directivity |
| `GtrNismo-ColdStart.mp3` | 10.0 s | −1.0 | −20.2 | VR38DETT: starter, catch, fast cold idle ~1150, three blips with turbo whistle and flutter |
| `GtrNismo-Launch.mp3` | 13.5 s | −3.4 | −16.0 | Launch-control boost build, AWD launch (0–100 2.9 s), 6-speed DCT upshifts with clunks, lift with blow-off |
| `GtrNismo-Onboard.mp3` | 14.0 s | −2.7 | −17.0 | Cabin mic, pull 3-4-5 on boost, ABS stop with blipped downshifts, corner, spool back up on exit |
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
| `Weapon-EnergyLmg.mp3` | 5.6 s | −0.9 | −19.3 | Devotion-style energy LMG, full 44-round magazine: 5 → 15 rounds/s over 1.75 s, zap + blast per shot, spin whine and barrel clatter climbing, spin-down, dry click |
| `Weapon-EnergyLmgTurbo.mp3` | 4.8 s | −0.9 | −17.7 | Same with the Turbocharger: 6.8 → 15 rounds/s over 0.85 s, turbine whistle and charge hiss on the pull |
| `Weapon-Lmg.mp3` | 5.5 s | −0.9 | −15.4 | Belt-fed LMG, 640/min: long burst and two short, links and brass, outdoor slap-back |
| `Weapon-Smg.mp3` | 4.5 s | −0.9 | −21.1 | SMG, 900/min: two short bursts, then the rest of a 30-round magazine |
| `Weapon-Sniper.mp3` | 5.5 s | −0.5 | −25.5 | Heavy blast and thump, report rolling off the valley, bolt cycle, casing landing |
| `Weapon-Turret.mp3` | 6.0 s | −0.9 | −18.0 | Servo traverse, lock-on pips, 720/min burst with feed motor, spin-down |
| `Weapon-Cannon.mp3` | 7.0 s | −0.5 | −22.5 | 120 mm: blast wave, chest thump, fireball roar, hull ring, echoes, breech clank, case clang |
| `Weapon-AutoCannon.mp3` | 5.0 s | −0.7 | −18.2 | 30 mm, 210/min: two bursts, heavy action, big cases ringing |
| `Bullets-Supersonic.mp3` | 4.5 s | −0.9 | −30.1 | Downrange of a rifle 400 m away: crack first, muzzle report 0.67 s later |
| `Bullets-Whizz.mp3` | 2.6 s | −1.4 | −24.4 | Three subsonic fly-bys: Doppler drop, vortex tone, panning across |
| `Bullets-Ricochet.mp3` | 3.0 s | −1.4 | −22.9 | Glancing off rock, steel and concrete: strike then tumbling whine |
| `Bullets-Impacts.mp3` | 11.0 s | −1.4 | −29.5 | Sand, dirt, rock, concrete, wood, metal, glass, water, 1.2 s apart |

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

## Reproduce
```
cd /tmp/pw   # playwright-core@1.49 + @sparticuz/chromium@131
AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node <repo>/Exhibits/CabinHmi/Scripts/CaptureHmi.cjs \
  http://localhost:8097/Experimental/CabinHmi/Nocturne/Nocturne.html <repo>/Exhibits/CabinHmi/Scripts/NocturneSteps.json <outdir>
```
📝 Headless WebGL runs at about 3 fps, so frame-delta motion looks slow in captures. Palette and colour easing use wall time.

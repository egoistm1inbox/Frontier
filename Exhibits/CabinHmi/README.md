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
| `Acoustics-10-Factory` | Factory and Sparks and electronics panels: conveyor looping, grinder, beam creak, spark shower and relay bank ringing |
| `Acoustics-12-War` | War panel (Follow-up 19): 12 pads, eight playing at once (sand blast, incoming mortar, grenade, helicopter, siren, tank, shell shock, battlefield); the eight new guns on the Weapons shelf above |
| `Acoustics-11-Mix` | Mix panel: road noise switch (M), Road roar at 40 %, separate Wind at 80 %, the note on what the roar is |
| `Audio-*.png` | Spectrogram + waveform plates for every reel file in `Audio/` (cyan dots on engine plates = predicted firing frequency: rpm/10 for the V12, rpm/20 for the V6; on supercharger plates the predicted blower whine, rpm × drive ratio × lobes; on EV plates a predicted motor order) |
| `Lucent-1…6` | Rejected first HMI C attempt (kept for reference) |

## Vehicle sound reel (`Audio/`)
All synthesized in code — no recordings or samples anywhere. 192 kbps stereo MP3 at 44.1 kHz (lamejs), rendered by
`Experimental/CabinHmi/Acoustics/Offline/RenderReel.mjs` (deterministic seeds; `--wav` also writes WAV). 100 files, 26 MB in total (the
Follow-up 10 WAVs, 22 MB, were replaced). Peak is measured before encoding.

| File | Length | Peak dBFS | RMS dBFS | Content |
|---|---|---|---|---|
| `LaFerrari-ColdStart.mp3` | 10.0 s | −1.2 | −20.1 | Starter with compression load, catch, flare to ~3000, cold idle, three blips in neutral |
| `LaFerrari-Launch.mp3` | 13.5 s | −2.8 | −16.0 | Chase mic, launch, ignition-cut upshifts with gearbox clunks (0–100 3.2 s, 0–200 6.7 s), lift with overrun |
| `LaFerrari-Onboard.mp3` | 14.0 s | −6.2 | −17.0 | Cabin mic, pull 3-4-5, hard braking (ABS, brakes, suspension) with blipped downshifts, corner, exit |
| `LaFerrari-Limiter.mp3` | 7.5 s | −1.6 | −18.1 | Neutral on the 9250 rpm limiter, lift with pops, two sharp blips |
| `LaFerrari-FlyBy.mp3` | 8.0 s | −1.0 | −18.4 | Trackside at 12 m, 262 km/h in 6th: Doppler, distance, air absorption, ground bounce, exhaust directivity |
| `GtrNismo-ColdStart.mp3` | 10.0 s | −1.0 | −20.1 | VR38DETT: starter, catch, fast cold idle ~1150, three blips with turbo whistle and flutter |
| `GtrNismo-Launch.mp3` | 13.5 s | −2.7 | −16.0 | Launch-control boost build, AWD launch (0–100 2.9 s), 6-speed DCT upshifts with clunks, lift with blow-off |
| `GtrNismo-Onboard.mp3` | 14.0 s | −2.5 | −17.0 | Cabin mic, pull 3-4-5 on boost, ABS stop with blipped downshifts, corner, spool back up on exit |
| `GtrNismo-FlyBy.mp3` | 8.0 s | −1.1 | −18.1 | Trackside at 12 m, 225 km/h in 5th on full boost |
| `Tyres-Screech.mp3` | 12.0 s | −3.5 | −17.0 | Cornering squeal at the limit, panic stop with lock-up, standing burnout (Follow-up 22: rubber squeal, not scrub) |
| `Tyres-Drift.mp3` | 20.0 s | −4.6 | −18.0 | Follow-up 22: drift at 70 km/h on asphalt, smooth concrete, wet asphalt, cobbles and gravel: turn-in chirps, sustained warbling wail bending with the angle; concrete shrillest, wet only chirps, cobbles chop it, gravel sprays instead |
| `Surfaces-Tour.mp3` | 32.0 s | −5.4 | −19.0 | 60 km/h over asphalt, wet, gravel, dirt, grass, cobbles, rumble strip, smooth concrete (4 s each) |
| `Chassis-Brakes.mp3` | 12.0 s | −1.4 | −20.0 | 130 km/h ABS stop (pump buzz, valve clicks, pad roar), light braking into squeal, creep groan to a halt |
| `Chassis-Suspension.mp3` | 16.0 s | −7.2 | −20.0 | Cabin mic at 40 km/h: kerb strike, cobbles, pothole, rutted dirt, rumble strip (dampers, bump stops, bushings, rattles) |
| `Lights-Cues.mp3` | 10.5 s | −1.0 | −26.6 | Headlamp switch, lamp relay, xenon ignition, LED welcome with levelling, indicator relay |
| `Cabin-Cues.mp3` | 25.0 s | −1.0 | −26.6 | Unlock, butterfly door open and close, seatbelt, belt chime, start button, paddle, window, wipers, climate fan |
| `Impact-Explosion.mp3` | 6.5 s | −0.5 | −23.0 | 60 m: blast overpressure, sub thump, fireball roar, debris falling back, echoes off distant surfaces |
| `Impact-ExplosionFar.mp3` | 6.5 s | −0.5 | −23.5 | Same blast at 450 m: the crack is absorbed by the air, the boom and echoes carry |
| `Impact-Shockwave.mp3` | 4.0 s | −0.9 | −20.3 | N-wave double crack, air rush sweeping past, glass and panels rattling |
| `Impact-EmpPulse.mp3` | 6.0 s | −0.9 | −20.9 | Capacitor charge whine, discharge slap and sub drop, arcing, electronics winding down, ears ringing |
| `Impact-SonicBlast.mp3` | 4.5 s | −0.9 | −14.8 | Spin-up, beating pressure beam over an infrasonic body, cut-off into a rush |
| `Impact-WindowShatter.mp3` | 2.4 s | −1.4 | −30.6 | Tempered side glass: tap, pop, crazing hiss, cubes pouring and tinkling |
| `Impact-GlassBreak.mp3` | 2.6 s | −1.4 | −31.8 | Annealed pane: crack, ringing shards breaking away, landing, scattering, bouncing |
| `Impact-MetalCrash.mp3` | 6.0 s | −0.5 | −28.9 | Impact, sheet buckling, lamps bursting, scrape, lurch, hubcap, settling creaks, coolant hiss |
| `Weapon-EnergyLmg.mp3` | 5.6 s | −0.9 | −14.1 | Energy LMG voiced as a real full-power LMG (Follow-up 14), full 44-round magazine: 5 → 15 rounds/s over 1.75 s; heavy report with low-mid boom and supersonic crack, geared drive and barrel clatter, rolling outdoor tail, brass landing on concrete |
| `Weapon-EnergyLmgTurbo.mp3` | 4.8 s | −0.9 | −13.5 | Same with the Turbocharger: 6.8 → 15 rounds/s over 0.85 s, turbine whistle and charge hiss on the pull |
| `Weapon-Lmg.mp3` | 5.5 s | −0.9 | −14.0 | Belt-fed LMG, 640/min: long burst and two short, links and brass, outdoor slap-back |
| `Weapon-Smg.mp3` | 4.5 s | −0.9 | −19.6 | SMG, 900/min: two short bursts, then the rest of a 30-round magazine |
| `Weapon-Sniper.mp3` | 5.5 s | −0.5 | −16.9 | Heavy blast and thump, report rolling off the valley, bolt cycle, casing landing |
| `Weapon-Turret.mp3` | 6.0 s | −0.9 | −14.5 | Servo traverse, lock-on pips, 720/min burst with feed motor, spin-down |
| `Weapon-Cannon.mp3` | 7.0 s | −0.5 | −16.7 | 120 mm: blast wave, chest thump, fireball roar, hull ring, echoes, breech clank, case clang |
| `Weapon-AutoCannon.mp3` | 5.0 s | −0.7 | −13.7 | 30 mm, 210/min: two bursts, heavy action, big cases ringing |
| `Weapon-Fifty.mp3` | 6.0 s | −0.7 | −13.3 | Follow-up 19: .50 cal heavy machine gun (M2-style), 550 rounds/min in bursts of 8–10: long blast, deep boom, wide bullet crack, recoiling bolt, belt links, .50 cases |
| `Weapon-Ak47.mp3` | 6.0 s | −0.9 | −15.8 | AK-47 (an assault rifle): three single shots, a short burst, then the rest of the 30-round magazine at 600 rounds/min, heavy bolt clack, dry click |
| `Weapon-M4.mp3` | 5.0 s | −0.9 | −16.8 | M4 carbine, 5.56 mm at 800 rounds/min: bursts, brighter and snappier than the AK, buffer-spring twang |
| `Weapon-Minigun.mp3` | 5.5 s | −0.9 | −14.2 | M134-style minigun: electric drive spins up in 0.5 s to 3000 rounds/min, one tearing roar, motor whine, cases raining, spin-down |
| `Weapon-Mg42.mp3` | 5.0 s | −0.9 | −16.5 | MG 42 at 1200 rounds/min: the ripping buzzsaw, two short bursts and a long one |
| `Weapon-Shotgun.mp3` | 5.0 s | −0.7 | −17.6 | 12-gauge pump shotgun: wide deep boom, no bullet crack, pump back (hull ejected, landing), pump forward; three shots |
| `Weapon-Pistol.mp3` | 4.5 s | −0.9 | −23.5 | 9 mm pistol: single shots and double taps, slide slam, pistol cases |
| `Weapon-AntiMateriel.mp3` | 6.0 s | −0.5 | −18.1 | .50 anti-materiel rifle: muzzle brake throws the blast sideways, chest-deep boom, wide crack, barrel slamming home |
| `War-SandBlast.mp3` | 7.5 s | −0.5 | −20.5 | Follow-up 19 (`WarFoley.js`): explosion in sand 30 m away: dull crack, big low whump, sand column tearing up, then sand raining back (hiss, grains, clods, stones on a vehicle) |
| `War-SandBlastFar.mp3` | 7.0 s | −5.2 | −28.2 | Same charge 350 m away: grains lost, crack absorbed, whump, dull roar and dune echoes carry |
| `War-MortarLaunch.mp3` | 7.5 s | −0.7 | −22.3 | Mortar: three rounds dropped down the tube (scrape, clink), hollow thoonk, whoosh away |
| `War-MortarIncoming.mp3` | 7.0 s | −0.5 | −25.9 | Incoming mortar: 760 Hz fin whistle Doppler-shifted along a real path (about 2 kHz falling to 600 Hz as it passes over), impact 47 m away |
| `War-Grenade.mp3` | 9.0 s | −0.5 | −26.2 | Frag grenade: pin, throw, lever flying off (4.5 s fuse), thud and roll on dirt, blast, fragments whizzing, earth falling |
| `War-RpgRocket.mp3` | 7.0 s | −0.5 | −32.6 | RPG: booster pop and back-blast, rocket motor screaming away (Doppler, darkening), impact on a vehicle 300 m off |
| `War-Barrage.mp3` | 15.0 s | −0.9 | −21.8 | Artillery barrage: 15 heavy shells 1.2–5 km away, rolling echoes, constant low rumble |
| `War-Helicopter.mp3` | 16.0 s | −0.9 | −24.8 | Military helicopter fly-over: 4-blade main rotor (17.2 passes/s), 79 Hz tail rotor, turbines, blade slap on the approach, Doppler |
| `War-AirRaidSiren.mp3` | 18.0 s | −0.9 | −17.4 | Air-raid siren: two-rotor mechanical siren (480 / 576 Hz), wind-up and fall from rotor inertia, turning head, echoing across a town |
| `War-TankDriveBy.mp3` | 14.0 s | −0.9 | −28.5 | Tank passing at 29 km/h, 14 m away: track links (53 clanks/s), slack slaps, road-wheel squeal, V12 diesel, ground rumble |
| `War-Deafened.mp3` | 14.0 s | −0.5 | −25.8 | Shell shock: fighting, a shell lands 10 m away, then muffled (low-pass from 180 Hz), ringing ears, heartbeat, hearing returns over ~10 s |
| `War-Battlefield.mp3` | 20.0 s | −1.4 | −26.2 | Battlefield bed: AK, M4, MG 42, .50 cal and LMG bursts 120–750 m away, far explosions, rounds cracking overhead |
| `Bullets-Supersonic.mp3` | 4.5 s | −0.9 | −35.3 | Downrange of a rifle 400 m away: crack first, muzzle report 0.67 s later |
| `Bullets-Whizz.mp3` | 2.6 s | −1.4 | −31.4 | Three subsonic fly-bys: Doppler drop, vortex tone, panning across |
| `Bullets-Ricochet.mp3` | 4.4 s | −1.4 | −20.5 | Glancing off rock, steel and concrete: strike then tumbling whine |
| `Bullets-Impacts.mp3` | 14.0 s | −1.4 | −30.3 | Sand, dirt, rock, concrete, wood, metal, glass, water, 1.2 s apart |
| `Shells-Floors.mp3` | 16.6 s | −1.4 | −31.3 | Spent cases (`Casings.js`): 7.62 mm on concrete, 5.56 mm on a wooden deck, 7.62 mm on a steel floor, 7.62 mm on dirt — ring, bounce series, roll |
| `Shells-Calibres.mp3` | 20.4 s | −1.4 | −29.0 | 9 mm pistol, 12-gauge shotgun, .50 BMG on steel, 30 mm cannon on steel, 120 mm case stub on the turret floor |
| `Shells-BrassRain.mp3` | 5.5 s | −1.4 | −28.0 | 32 cases and belt links from a 3 s LMG burst raining onto concrete, clinking on the pile, last ones rolling |
| `Factory-Line.mp3` | 14.0 s | −4.9 | −18.0 | Follow-up 17 (`FactoryFoley.js`): factory hall bed (rumble, mains hum, far motor, clanks, air blasts, forklift beeps), conveyor (24 Hz motor, 552 Hz reducer mesh, rollers, chain, belt splice, boxes), stamping press, impact wrench |
| `Factory-MetalWorks.mp3` | 22.2 s | −0.9 | −24.7 | Blacksmith on the anvil and quench, angle grinder cutting steel (spin-up, load sag, screech, sparks, wind-down), MIG welding two beads, steel pipes dropped |
| `Factory-Creaks.mp3` | 18.6 s | −0.9 | −17.4 | Steel beam under load, heavy steel door on a dry hinge and slam, wooden floorboards, chain hoist ratchet |
| `Sparks-Arcs.mp3` | 18.6 s | −0.9 | −23.6 | Spark shower, short circuit with breaker trip, high-voltage climbing arc, loose wire making and breaking |
| `Electronics-Bench.mp3` | 25.2 s | −0.9 | −17.2 | Transformer hum, contactor and relay bank, robot arm servos and gripper, fluorescent tube starting, coil whine under a changing load |
| `Demon-ColdStart.mp3` | 10.5 s | −1.0 | −19.1 | Dodge Challenger SRT Demon (Follow-up 15): starter, catch and flare, lumpy cross-plane idle (each bank fires unevenly, firing order 1-8-4-3-6-5-7-2), three blips with the stock 2.7 L blower's scream, overrun pops |
| `Demon-Launch.mp3` | 15.5 s | −2.1 | −16.0 | Staged on the TransBrake at 2350 rpm, released: 1.8 g, 8-speed upshifts, quarter mile in about 9.8 s at 142 mph, lift. Cyan dots: predicted blower whine (rpm × 0.157) |
| `Demon-RollOn.mp3` | 16.5 s | −2.0 | −17.0 | Third gear from 2600 rpm, floored three times: the belt-driven blower makes boost the instant the throttle opens (no lag) |
| `TurboLag-Compare.mp3` | 16.5 s | −1.2 | −17.0 | GT-R with parallel twin turbos, the same 3rd-gear roll-on from 2600 rpm with lag off, real lag and 2.5× lag; cyan dots: whistle pitch predicted from the simulated shaft speed |
| `Spyder918-Launch.mp3` | 16.0 s | −2.3 | −16.0 | Porsche 918 Spyder (Follow-up 16, the hybrid from Porsche's 2020 Super Bowl advert "The Heist"): launch control, both e-motors whining under the flat-plane V8, scream to 9150 rpm through the top pipes, PDK upshifts, front motor decoupling at 235 km/h, lift |
| `Spyder918-FlyBy.mp3` | 8.0 s | −1.0 | −18.4 | 918 Spyder at 250 km/h in 5th past a trackside mic 12 m away: Doppler drop, exhaust pointing away after the pass |
| `AgeraRs-Launch.mp3` | 16.0 s | −1.7 | −16.0 | Follow-up 22: Koenigsegg Agera RS: boost build at about 3800 rpm, launch, twin-turbo cross-plane V8 (90° crank) through 7 gears, dump-valve chirps, lift with the big blow-off |
| `AgeraRs-FlyBy.mp3` | 8.0 s | −1.0 | −18.5 | Agera RS at 300 km/h in 5th on full boost: deep cross-plane bellow and turbo whistle, Doppler drop |
| `Road-NoiseSwitch.mp3` | 15.0 s | −4.6 | −18.0 | Follow-up 17: Agera R flat out in 6th from 220 km/h, chase mic, road roar at 100 %, then the bench default (road 40 %, wind 80 %), then road switched off (wind only) |
| `MustangGt-StartLaunch.mp3` | 16.5 s | −1.3 | −17.0 | Follow-up 18: 2024 Mustang GT, chase mic: start, idle burble, launch, cross-plane Coyote V8 through the 6-speed manual, lift |
| `Gt350-Launch.mp3` | 16.0 s | −1.3 | −16.0 | Shelby GT350: revs held, launch, flat-plane Voodoo scream to 8250 rpm, no burble (each bank fires evenly) |
| `MustangGt3-Onboard.mp3` | 14.0 s | −4.8 | −17.0 | Mustang GT3 (LMGT3), cockpit: sequential upshifts, straight-cut whine, downshift blips and overrun pops |
| `MustangGt3-FlyBy.mp3` | 8.0 s | −1.0 | −18.5 | Mustang GT3 at 265 km/h in 6th, side pipes, Doppler drop |
| `Mustang-Compare.mp3` | 15.0 s | −2.3 | −17.0 | The three Mustangs back to back: 3rd-gear pulls from 60 km/h, GT, then GT350, then GT3 |
| `LigierJsP320-Onboard.mp3` | 14.0 s | −4.2 | −17.0 | Ligier JS P320 LMP3, cockpit: Nissan VK56 V8, paddle upshifts, gear whine, braking downshifts |
| `LigierJsP320-FlyBy.mp3` | 8.0 s | −1.0 | −18.5 | Ligier JS P320 at 260 km/h in 6th, Doppler drop |
| `Induction-SmallSingle.mp3` | 11.0 s | −3.1 | −17.0 | Every `Induction-*` scene: GT-R NISMO with the inducer swapped in, chase mic: two blips, pull from rest, lift, back on, lift. Small single turbo: quick spool, bright whistle, soft blow-off |
| `Induction-BigSingle.mp3` | 11.0 s | −2.5 | −17.0 | Big single turbo: late, violent boost, deep whoosh, loud blow-off |
| `Induction-TwinTurbo.mp3` | 11.0 s | −3.5 | −17.0 | Parallel twins: two detuned whistles beating, blow-off with a little flutter |
| `Induction-Flutter.mp3` | 11.0 s | −2.2 | −17.0 | Turbo with no blow-off valve: compressor surge chatter on every lift |
| `Induction-Vgt.mp3` | 11.0 s | −3.2 | −17.0 | Variable-geometry turbo: early boost, whistle sweeping with the vanes, no valve |
| `Induction-ElectricTurbo.mp3` | 11.0 s | −2.5 | −17.0 | Electric-assist turbo: no lag, motor whine on the shaft, harvest whine on lift |
| `Induction-Roots.mp3` | 11.0 s | −2.9 | −17.0 | Roots blower: gear-driven whine with a chugging pocket pulse |
| `Induction-TwistedLobe.mp3` | 11.0 s | −3.3 | −17.0 | Twisted 4-lobe supercharger: high smooth scream, bypass valve on the cruise |
| `Induction-TwinScrew.mp3` | 11.0 s | −3.9 | −17.0 | Twin-screw supercharger: raspy harmonic-rich scream, timing-gear whine |
| `Induction-Centrifugal.mp3` | 11.0 s | −3.7 | −17.0 | Centrifugal supercharger: whine and boost climbing with rpm squared, blow-off on lift |
| `Taycan-Launch.mp3` | 14.0 s | −6.1 | −18.0 | Porsche Taycan Turbo S, chase mic: ready chime, launch 0–200 km/h, both motors whining, rear 2-speed shift near 100 km/h, coast |
| `Taycan-Onboard.mp3` | 15.0 s | −4.9 | −20.0 | Cabin mic: gentle pull-away, cruise, floor it (stays in 2nd above 60 km/h), regenerative braking to a stop |
| `Taycan-SportSound.mp3` | 11.5 s | −5.0 | −18.0 | Same car with the synthetic sport-sound layer on |
| `Taycan-FlyBy.mp3` | 8.0 s | −1.0 | −20.1 | Trackside at 12 m, 200 km/h in 2nd: motor whine, tyres and wind |
| `NextGen-Launch.mp3` | 14.0 s | −3.7 | −17.0 | Next-Gen racer (original, Jackson Storm style), chase mic: whir locked to the motor, V8 undertone, sequential upshifts dropping the pitch |
| `NextGen-Onboard.mp3` | 14.0 s | −3.1 | −17.0 | Cabin mic: pull 3-4-5, brake with downshifts (8.06 s to 4th, 8.77 s to 3rd), corner with squeal, exit |
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

**Porsche 918 Spyder and Koenigsegg Agera R (Follow-up 16).** The Spyder in Porsche's 2020 Super Bowl advert "The Heist" is the
918 Spyder (Porsche Newsroom); the Need for Speed (2014) car is the Agera R (the Agera RS came later; the film's crash cars were
replicas). Both are flat-plane V8s: each bank fires evenly every 180°, so the chase mic's side signal at 3000 rpm is led by the 2nd
order with the half orders 18–31 dB down, against the cross-plane Demon whose side signal is led by 1.5× (0.5× 7 dB down)
(`_ClaudeScratch/tmp/audio/cars.mjs`). `Spyder918`: 4.6 L, 608 hp at 8600, 530 Nm at 6600, 9150 limiter, short top-exit pipes,
the press-kit PDK ratios and 3.09 final drive, rear hybrid motor on the crank and a new front-axle motor (`Motor.Front`: its own
gear, 95 kW limit, decoupled at 235 km/h, a whine locked to wheel speed). Model: 0–100 2.46 s, 0–200 6.43 s, quarter mile 9.65 s at
152 mph, top 351 km/h (Porsche: 2.6 s, 7.2 s, about 9.8 s, 345 km/h). `AgeraR`: 5.0 L twin turbo, 1200 Nm at 4100, 1140 hp at 7100,
7500 limiter, 7-speed DCT, 3.364 final drive, loud dump valve. Model: 0–100 3.04 s, quarter mile 9.56 s at 169 mph, top 435 km/h
(published 2.8–2.9 s, 9.5 s at 164 mph, about 440 km/h); its 0–300 km/h, 11.4 s, is quicker than the measured 14.53 s because the
tyre model has no traction losses in the middle gears. Headless check: 918 live in 2nd at 126 km/h with the motors driving (0.99),
Agera R 96 km/h in 2nd on full boost, both offline renders finite; earlier checks unchanged; console errors 0. `AcousticsCheck.cjs`
now loads either export style of `@sparticuz/chromium`.

**Road noise switch, factory, sparks and electronics (Follow-up 17).** The loud noise at speed was road/tyre roar, not wind: on a
full-throttle run (`_ClaudeScratch/tmp/audio/noisefloor.mjs`, chase mic) the road layer alone measured −32/−19/−13/−9/−7 dBFS in the
0–60/60–120/120–200/200–300/300–450 km/h windows and the wind alone −64/−45/−33/−25/−20, so wind is 13–30 dB quieter. The road
matched the LaFerrari's engine (−8 dBFS) from 200 km/h and was louder than the Agera R's engine (−14 dBFS) above 300. Changes:
`SurfaceRoll` now has separate `RoadLevel` and `WindLevel`; the roar still grows ~8 dB per doubling of speed up to 150 km/h but
only ~3 dB per doubling above that (a listening choice, not physics); the bench Mix has a Road noise on/off switch (key M), a Road
roar slider (default 40 %) and a separate Wind slider (default 80 %). At the defaults the engine leads the road by 12–19 dB below
200 km/h and 2–8 dB above it on the chase mic (15–25 dB in the cabin). Headless check: the road layer alone (engine, tyres and
chassis muted), Agera R in 2nd to 148 km/h, renders at −20.8 dBFS RMS at 100 %, −28.4 at the default and −46.4 with road off (wind
only); the switch and the M key flip it off and on (row dims, level sent 0 then 0.4); the Wind slider moves on its own. New
`FactoryFoley.js` (21 cues, a Freeverb-style factory-hall reverb, loops cross-folded so they repeat seamlessly): factory
(conveyor and factory-floor loops, blacksmith hammering, angle grinder, hydraulic stamping press, MIG welding, air impact wrench,
pipes dropped), creaks (steel beam, steel door, wooden floor, chain hoist), sparks and electronics (spark shower, short circuit,
high-voltage arc, transformer hum loop, relay bank, robot arm servos, fluorescent tube, coil whine, loose wire). All 21 render
with no NaN; 12 factory and 9 sparks pads on the bench; conveyor loop toggles on and off; console errors 0. Build tag "build 17".
Clips rendered before Follow-up 17 keep the old road level (full, no high-speed easing).

**Mustang GT, Shelby GT350, Mustang GT3 and Ligier JS P320 (Follow-up 18).** The Nissan-engined Ligier is the JS P320, an **LMP3**
prototype (Nissan VK56 5.6 L V8, ~460 hp, 950 kg); the LMGT3 class car in this batch is the Mustang GT3. New profiles in
`PulseTrainEngine.js`: `MustangGt` (Coyote 5.0 cross-plane, 486 hp, 567 Nm, 7500 rpm, MT82 manual), `Gt350` (Voodoo 5.2 flat-plane,
526 hp, 582 Nm, 8250 rpm, TR-3160), `MustangGt3` (race Coyote 5.4, ~550 hp, 7800 rpm, Xtrac sequential, side pipes) and
`LigierJsP320` (VK56, 7500 rpm, Xtrac sequential). Firing check (`_ClaudeScratch/tmp/audio/cars.mjs`, side-channel spectrum): the
cross-plane cars carry a strong 1.5× firing component (GT 0 dB, GT3 0 dB, Ligier −6 dB against the firing line), the flat-plane
GT350 −22 dB, so the burble and the scream come from firing order, not EQ. `TractionIntegrator` gained an opt-in rotating-mass factor
(`Drive.Rotating`, only these four cars; it is skipped for electric cars, which share `Road()` and have no ratios). Sprints, model
[real]: Mustang GT 0–100 km/h 4.90 s [0–60 mph 4.3 s], quarter mile 12.89 s at 116 mph [12.6 s at 113]; GT350 4.77 s, 12.61 s at
122 mph; Mustang GT3 3.65 s, top 287 km/h [about 300]; Ligier 3.65 s [about 3.8], top 294 km/h [285–290]. Agera R and Demon sprints
unchanged. The Mustang GT tops out at the 7500 limiter in 6th (278 km/h); the 155 mph governor is not modelled, and the manual cars
shift quickly, like a magazine test. Headless check: every new car switches in with the V key, renders offline with no NaN (peaks
−0.1 to −0.2 dBFS) and pulls live (GT 75 km/h at 6628 rpm, GT350 74 at 6943, GT3 92 at 7340, Ligier 89 at 6306 in 1st); Taycan and
Next-Gen still drive; console errors 0. Build tag "build 18". Typical values stand in for the GT3 and Ligier gear ratios and torque
curves and the race VK56 limiter.

**More guns and war sounds (Follow-up 19).** Eight new hold-to-fire guns in `Ballistics.js`, voiced from published cyclic rates and
calibres (Wikipedia, NavWeaps, Soviet Army field data, weaponsystems.net): `Fifty` (M2HB-style .50 BMG, 450–600 rounds/min; 550
here), `Ak47` (7.62×39, 600 rounds/min, 30 rounds, 715 m/s; it is an assault rifle, not a submachine gun), `M4` (5.56 mm, about
800 rounds/min), `Minigun` (M134-style, six barrels, 3000 rounds/min after a 0.5 s spin-up, the published M134D figure), `Mg42`
(1200 rounds/min), `Shotgun` (12-gauge pump; new `PumpCycle`), `Pistol` (9 mm semi-auto) and `AntiMateriel` (.50 semi-auto rifle;
new `Brake` layer for the muzzle brake's side blasts). New `WarFoley.js` (12 cues): explosions in sand at 30 and 350 m, mortar
launch, incoming mortar, frag grenade, RPG, artillery barrage, helicopter fly-over, air-raid siren, tank passing, shell shock and a
battlefield bed. Moving sources (mortar round, rocket, helicopter, tank) go through `Flight()`, which steps the listener's clock and
advances the source's emission time by 1 / (1 + radial speed / c), so Doppler and 1 / range come from the geometry: the mortar's
760 Hz fin whistle arrives near 2 kHz while the round closes at 210 m/s and falls through 760 to about 600 Hz as it passes over (see
the plate). Distant sounds use `Afar()` (air absorption by range and a (30 / metres)^0.75 level law, a listening compromise). Headless
check: the eight guns fire at their rates (`.50` 11 rounds in 1.2 s, AK 12, M4 16, minigun 58 in 1.34 s with spin-up, MG 42 22 in
1.1 s, shotgun 3 in 2.1 s, pistol 5, .50 rifle 2); the War shelf shows 12 pads; eight War cues render and start together in 5.7 s;
all 20 new reel renders are finite; console errors 0. Build tag "build 19".

**Weapons, explosions, shells, turbos, superchargers, Taycan and racer redone (Follow-up 20).** Diagnosis: every gun ran one shared
chain (same blast, same thump, same echo taps), every explosion was the same overpressure plus a pitched sine thump, and the turbo
whistle, supercharger whine and EV orders were pure sines, which is what read as "electric whine". Changes:
- `SignalKit.js`: `NarrowTone` (a narrow band of noise with pitch drift and amplitude flutter: a tone that breathes like air or
  steel instead of a test oscillator), `Blep` / `PolySaw` (band-limited saw, no aliasing).
- New `Detonation.js`: `Fft`, `Convolve`, generated impulse responses per place (`Spaces`: Range, Urban, Forest, Field, Valley,
  Desert, Indoor; `SpaceIr`, `Place`), a look-ahead `Limit`, the muzzle/blast `Pulse` (Friedlander-shaped overpressure with a ground
  reflection), turbulent `Rumble`, and `Detonate`, which scales the blast by charge mass (positive-phase length grows with the cube
  root of the charge, so a 180 g grenade cracks while a 10 kg shell booms) and by ground (Open, Sand, Rock, Air).
- `Ballistics.js`: each gun is now a recipe of separate layers (Muzzle, Gas, Punch, Crack, Ring, Action, Rattle, Spring, Links, Zap,
  Arc) placed in its own space; the brass lands on dirt outdoors and concrete in streets and on ranges. The Energy LMG keeps a
  full-power 7.62-class report with a falling discharge zing and arc crackle on top, instead of a toy zap.
- `Casings.js` rewritten: tube modes with split (detuned) pairs and a hoop mode per case, end-over-end double hits, floor thuds,
  rolling with rim ticks and rocking to rest; plastic shotgun hulls.
- `WarFoley.js` / `ImpactFoley.js`: every blast goes through `Detonate` with a charge and ground (grenade 0.18 kg, mortar 1 kg, RPG
  1.5 kg on rock, sand blast 5 kg in sand, artillery 7–15 kg) and `Place` instead of the shared echo taps.
- `ForcedInduction.js`: turbo = `Compressor` (blade-pass narrow band, half and double orders, shaft-rate wobble, inlet rush through
  duct formants) + `BlowOff` ("ch" then a falling "pssshh" with piston flutter) + `Surge` (stu-tu-tu chuffs); displacement blowers are
  pressure pulses per rotor pocket with rotor-rate modulation and a rasp. `PulseTrainEngine.js` built-in turbos (GT-R, Agera, Demon)
  use the same parts.
- `ElectricDrive.js`: motor orders, inverter sidebands and gear mesh are `NarrowTone`s with rotor-eccentricity and gear run-out
  modulation, torque-ripple orders that grow with load, and a spread-spectrum hiss band at the inverter carrier; the racer's whir is
  band-limited saws through pitch-tracking formants, roughened by its V8 undertone's firing pulses.
Checks: every gun shot renders finite in 85–270 ms, peaks −13 to −20 dBFS, octave profiles distinct (Energy LMG peaks at 8 kHz,
shotgun at 63 Hz; closest pair Turret / AK-47 1.6 dB apart); 64 reel scenes re-rendered, all finite; headless bench: guns fire at
their rates, 12 War pads, eight War cues render and start in 22.5 s (slower than build 19's 5.7 s: the convolution reverbs), console
errors 0. Build tag "build 20". Limits: nothing is matched against recordings; impulse responses are generated; inducer and case
frequencies are typical published figures, not measurements.

**Ricochets and bullets into glass and metal (Follow-up 21).** The old ricochet was a clean sine sweeping down (a cartoon
"peeew"); metal was six bell-like partials; glass was tinkles starting the instant the round hit. Now:
- `Ricochet`: a tumbling fragment flown through 3-D space. It sheds a narrow band of turbulent noise (pitch roughly proportional
  to its speed), chopped and wobbled at the tumble rate (100–500 Hz) as an edge swings into the flow twice a turn, so it is buzzy
  and ragged. Quadratic drag slows it hard, and emission time is stepped on the listener's clock, so the Doppler drop, the
  1 / range fade and air absorption come from the flight path. Off a steel plate it zings past the listener's head; off rock and
  concrete it flies away. A smaller, higher chip often peels off as well.
- `MetalHit`: the jacket splatters (sharp tick and a short "tss"), the panel dents (a dull "pank"), then the plate rings with
  dense plate modes (`PlateModes`: f ∝ m² + (n / aspect)², weighted by the strike point) for about a second, with spall crackles.
- `GlassHit`: a sharp crack and a few milliseconds of fracture clicks, one short damped "chink" from the cracked pane, a brittle
  crunch as pieces break away, then the shards land about 0.4 s later (a metre's fall): a bright crash thinning into tinkles,
  small shards higher and shorter than big ones, some snapping again, the last ones settling.
Impacts reel now spaces the materials 1.6 s apart so glass shards and the metal ring are not cut off. Build tag "build 21".

**Agera RS, tyre squeal, ricochet and whizz (Follow-up 22).**
- The Koenigsegg was modelled with a flat-plane crank, which made it shriek like a Ferrari or the 918. Koenigsegg's own engine
  notes say the Agera's V8 has a 90° (cross-plane) crank; the Jesko was the first to go flat-plane (Top Gear, Carscoops). It is now
  `AgeraRs` (the RS, as asked: 1160 hp at 7800 rpm, 1280 Nm at 4100, redline 8250, 1395 kg kerb, Koenigsegg spec sheet) with uneven
  per-bank firing (the deep, burbling bellow), longer turbo manifolds into a merge collector and single exit, deeper formants, a
  louder spool whistle, bigger whoosh, dump-valve flutter and more overrun crackle. The film car was the Agera R; the engine family
  and crank are the same. Firing order and gear ratios are typical values (not published).
- `TyreSqueal` is now the rubber singing rather than a scrub: three sliding tyres (`Singer`), each a near-pure tone 700–1400 Hz
  with overtones through belt resonances near 1.1 and 2.6 kHz, warbling at 5–12 Hz, drifting and beating against each other, with
  chirps at the grip limit. Each surface has a `Squeal` recipe (Tone, Pitch): new `Concrete` (smooth garage floor, shrillest),
  asphalt wails, wet only chirps over the hiss, cobbles and rumble strips chop it, gravel, dirt and grass spray instead.
- `Ricochet` warbles at the fragment's tumble rate (25–70 Hz) instead of buzzing, and starts brighter (heard about 3.5 kHz falling
  to under 2 kHz).
- `Whizz` is now a subsonic round flown past the ear on a straight line, with emission time solved per sample: the approach
  arrives squeezed into a sudden high "zz" and the departing wake drops in pitch and trails off ("zzziu"), not a symmetric sweep.
Build tag "build 22".


## Reproduce
```
cd /tmp/pw   # playwright-core@1.49 + @sparticuz/chromium@131
AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node <repo>/Exhibits/CabinHmi/Scripts/CaptureHmi.cjs \
  http://localhost:8097/Experimental/CabinHmi/Nocturne/Nocturne.html <repo>/Exhibits/CabinHmi/Scripts/NocturneSteps.json <outdir>
```
📝 Headless WebGL runs at about 3 fps, so frame-delta motion looks slow in captures. Palette and colour easing use wall time.

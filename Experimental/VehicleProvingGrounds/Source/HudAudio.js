//============================================================================================================================================
//                                                                HUDAUDIO.JS
//============================================================================================================================================
// 🧩 Procedural WebAudio UI & ADAS Warning Sound Synthesizer for the 2D + 3D Augmented-Reality Driving HUD:
//    tactile UI micro-clicks, camera-mode collimator sweeps, proximity target-lock blips, forward-collision BRAKE alerts, and low-fuel chimes.

export class HudAudioSynthesizer
{
    constructor()
    {
        this.Enabled      = true;
        this.MasterVolume = 0.34;
        this.Context      = null;
        this.MasterGain   = null;
        this.Cooldowns    = new Map();
        this.Counts       = {
            UiClick:     0,
            ModeSwitch:  0,
            TargetLock:  0,
            BrakeAlert:  0,
            LowFuel:     0,
            PoliceAlert: 0,
            MachineGun:  0,
            Cannon:      0,
            BombWhistle: 0,
            Explosion:   0,
            CarCrash:    0,
            BreachVictory: 0
        };
        this.SirenOsc     = null;
        this.SirenGain    = null;
    }

    EnsureContext()
    {
        if (!this.Enabled)
            return null;
        if (!this.Context)
        {
            const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!AudioCtor)
                return null;
            try
            {
                this.Context    = new AudioCtor();
                this.MasterGain = this.Context.createGain();
                this.MasterGain.gain.value = this.MasterVolume;
                this.MasterGain.connect(this.Context.destination);
            }
            catch (_Err)
            {
                this.Context = null;
                return null;
            }
        }
        if (this.Context && this.Context.state === "suspended")
        {
            try { this.Context.resume(); } catch (_Err) { /* awaits user gesture */ }
        }
        if (this.MasterGain)
            this.MasterGain.gain.value = this.Enabled ? this.MasterVolume : 0.0;
        return this.Context;
    }

    SetEnabled(On)
    {
        this.Enabled = Boolean(On);
        if (this.MasterGain && this.Context)
            this.MasterGain.gain.setTargetAtTime(this.Enabled ? this.MasterVolume : 0.0, this.Context.currentTime, 0.03);
        if (!this.Enabled)
            this.StopSiren();
    }

    CheckCooldown(Key, MinIntervalSeconds, NowSeconds)
    {
        const Last = this.Cooldowns.get(Key) ?? -1.0e6;
        if (NowSeconds - Last < MinIntervalSeconds)
            return false;
        this.Cooldowns.set(Key, NowSeconds);
        return true;
    }

    ScheduleTone(Ctx, FreqStart, FreqEnd, StartTime, Duration, PeakGain, Type = "sine")
    {
        const Osc  = Ctx.createOscillator();
        const Gain = Ctx.createGain();
        Osc.type = Type;
        Osc.frequency.setValueAtTime(Math.max(40.0, FreqStart), StartTime);
        if (Math.abs(FreqEnd - FreqStart) > 1.0)
            Osc.frequency.exponentialRampToValueAtTime(Math.max(40.0, FreqEnd), StartTime + Duration);
        Gain.gain.setValueAtTime(0.0001, StartTime);
        Gain.gain.linearRampToValueAtTime(PeakGain, StartTime + Math.min(0.012, Duration * 0.25));
        Gain.gain.exponentialRampToValueAtTime(0.0001, StartTime + Duration);
        Osc.connect(Gain);
        Gain.connect(this.MasterGain);
        Osc.start(StartTime);
        Osc.stop(StartTime + Duration + 0.015);
    }

    // 📝 Crisp tactile UI micro-click when pressing interactive HUD pills or pinning a 3D target reticle.
    PlayUiClick(PitchScale = 1.0)
    {
        if (!this.Enabled)
            return false;
        this.Counts.UiClick++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 1860.0 * PitchScale, 920.0 * PitchScale, T0, 0.026, 0.16, "triangle");
        this.ScheduleTone(Ctx, 620.0 * PitchScale, 420.0 * PitchScale, T0 + 0.008, 0.032, 0.08, "sine");
        return true;
    }

    // 📝 Subtle collimator harmonic sweep when transitioning between Chase Dual-Wing HUD and Cockpit Windshield AR-HUD.
    PlayModeSwitch(ToCockpit = false, NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("mode", 0.20, NowSeconds))
            return false;
        this.Counts.ModeSwitch++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        if (ToCockpit)
        {
            this.ScheduleTone(Ctx, 587.33, 880.0,  T0,        0.075, 0.11, "sine");
            this.ScheduleTone(Ctx, 880.0,  1174.66, T0 + 0.06, 0.095, 0.12, "triangle");
        }
        else
        {
            this.ScheduleTone(Ctx, 987.77, 739.99, T0,        0.070, 0.10, "sine");
            this.ScheduleTone(Ctx, 739.99, 587.33, T0 + 0.055, 0.085, 0.10, "sine");
        }
        return true;
    }

    // 📝 Proximity-triggered ADAS radar acquisition ping ("rail" | "hazard" | "station").
    PlayTargetLock(Kind = "hazard", NowSeconds = 0.0)
    {
        const Cooldown = Kind === "station" ? 2.4 : (Kind === "rail" ? 2.0 : 1.55);
        if (!this.Enabled || !this.CheckCooldown(`lock:${Kind}`, Cooldown, NowSeconds))
            return false;
        this.Counts.TargetLock++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        if (Kind === "rail")
        {
            // Distinct dual-harmonic rail corridor radar lock
            this.ScheduleTone(Ctx, 783.99, 783.99,  T0,        0.065, 0.13, "triangle");
            this.ScheduleTone(Ctx, 1174.66, 1318.5, T0 + 0.065, 0.095, 0.15, "sine");
        }
        else if (Kind === "station")
        {
            // Warm emerald/cyan guidance lock arpeggio
            this.ScheduleTone(Ctx, 523.25, 659.25, T0,        0.07, 0.11, "sine");
            this.ScheduleTone(Ctx, 783.99, 1046.5, T0 + 0.065, 0.11, 0.13, "sine");
        }
        else
        {
            // Crisp automotive obstacle lock blip
            this.ScheduleTone(Ctx, 1244.5, 1661.2, T0, 0.052, 0.12, "sine");
        }
        return true;
    }

    // 📝 Urgent Forward-Collision Warning (FCW) double-pulse synchronized with the flashing red "BRAKE" HUD alert.
    PlayBrakeWarning(NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("brake", 2.15, NowSeconds))
            return false;
        this.Counts.BrakeAlert++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 932.33, 880.0, T0,        0.095, 0.22, "sawtooth");
        this.ScheduleTone(Ctx, 932.33, 880.0, T0 + 0.125, 0.115, 0.24, "sawtooth");
        return true;
    }

    // 📝 Automotive low-fuel / low-800V-battery reserve advisory chime.
    PlayLowFuelWarning(Critical = false, NowSeconds = 0.0)
    {
        const Key = Critical ? "fuel:crit" : "fuel:low";
        if (!this.Enabled || !this.CheckCooldown(Key, 8.0, NowSeconds))
            return false;
        this.Counts.LowFuel++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        if (Critical)
        {
            this.ScheduleTone(Ctx, 783.99, 783.99, T0,        0.09, 0.18, "triangle");
            this.ScheduleTone(Ctx, 659.25, 659.25, T0 + 0.11, 0.09, 0.18, "triangle");
            this.ScheduleTone(Ctx, 523.25, 493.88, T0 + 0.22, 0.16, 0.20, "triangle");
        }
        else
        {
            this.ScheduleTone(Ctx, 659.25, 659.25, T0,        0.11, 0.15, "sine");
            this.ScheduleTone(Ctx, 523.25, 523.25, T0 + 0.13, 0.16, 0.16, "sine");
        }
        return true;
    }

    // 📝 Police pursuit dispatch chirp + short yelp when traffic law violation triggers a chase.
    PlayPoliceAlert(NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("police:dispatch", 2.0, NowSeconds))
            return false;
        this.Counts.PoliceAlert++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 680.0,  1480.0, T0,        0.14, 0.18, "sawtooth");
        this.ScheduleTone(Ctx, 1480.0, 680.0,  T0 + 0.14, 0.14, 0.16, "sawtooth");
        this.ScheduleTone(Ctx, 720.0,  1520.0, T0 + 0.28, 0.16, 0.18, "triangle");
        return true;
    }

    // 📝 Continuous distance-attenuated police wail/yelp siren oscillator during active pursuits.
    UpdatePoliceSiren(Active, DistanceMeters = 25.0, ClockSeconds = 0.0, Yelp = false)
    {
        if (!Active || !this.Enabled)
        {
            this.StopSiren();
            return;
        }
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return;
        if (!this.SirenOsc)
        {
            try
            {
                this.SirenOsc  = Ctx.createOscillator();
                this.SirenGain = Ctx.createGain();
                this.SirenOsc.type = "triangle";
                this.SirenGain.gain.value = 0.0001;
                this.SirenOsc.connect(this.SirenGain);
                this.SirenGain.connect(this.MasterGain);
                this.SirenOsc.start();
            }
            catch (_Err)
            {
                this.SirenOsc = null;
                return;
            }
        }
        const Rate = Yelp ? 4.4 : 0.42;
        const Mod  = 0.5 + 0.5 * Math.sin(ClockSeconds * Math.PI * 2.0 * Rate);
        const Freq = 630.0 + Mod * 740.0;
        const Atten = Math.max(0.0, Math.min(1.0, 1.0 / (1.0 + (DistanceMeters / 36.0) ** 2)));
        const GainVal = 0.085 * Atten;
        this.SirenOsc.frequency.setTargetAtTime(Freq, Ctx.currentTime, 0.025);
        this.SirenGain.gain.setTargetAtTime(GainVal, Ctx.currentTime, 0.05);
    }

    StopSiren()
    {
        if (this.SirenOsc)
        {
            try { this.SirenOsc.stop(); this.SirenOsc.disconnect(); } catch (_E) { /* ignore */ }
            this.SirenOsc = null;
            this.SirenGain = null;
        }
    }

    // 📝 Rapid staccato heavy machine gun shot burst (distance-attenuated).
    PlayMachineGunShot(DistanceMeters = 35.0, NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("dday:mg", 0.075, NowSeconds))
            return false;
        this.Counts.MachineGun++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const Atten = Math.max(0.08, Math.min(1.0, 1.0 / (1.0 + (DistanceMeters / 45.0) ** 2)));
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 520.0, 145.0, T0, 0.045, 0.16 * Atten, "sawtooth");
        return true;
    }

    // 📝 Heavy coastal cannon / tank main gun firing thump.
    PlayCannonFire(DistanceMeters = 45.0, NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("dday:cannon", 0.25, NowSeconds))
            return false;
        this.Counts.Cannon++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const Atten = Math.max(0.12, Math.min(1.0, 1.0 / (1.0 + (DistanceMeters / 68.0) ** 2)));
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 185.0, 38.0, T0, 0.26, 0.28 * Atten, "sawtooth");
        this.ScheduleTone(Ctx, 110.0, 32.0, T0, 0.34, 0.24 * Atten, "triangle");
        return true;
    }

    // 📝 Falling aerial bomb whistle before impact.
    PlayBombWhistle(NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("dday:whistle", 0.9, NowSeconds))
            return false;
        this.Counts.BombWhistle++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        this.ScheduleTone(Ctx, 980.0, 270.0, Ctx.currentTime, 0.95, 0.12, "sine");
        return true;
    }

    // 📝 Deep sub-bass explosion blast (bombs, shells, landmines, exploding tanks/cars).
    PlayExplosion(Strength = 1.0, DistanceMeters = 30.0, NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("dday:boom", 0.12, NowSeconds))
            return false;
        this.Counts.Explosion++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const Atten = Math.max(0.14, Math.min(1.0, 1.0 / (1.0 + (DistanceMeters / 65.0) ** 2)));
        const Amp = Math.min(0.42, 0.28 * Strength * Atten);
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 138.0, 26.0, T0,        0.55, Amp,        "sawtooth");
        this.ScheduleTone(Ctx,  92.0, 22.0, T0 + 0.03, 0.65, Amp * 0.9,  "triangle");
        return true;
    }

    // 📝 Heavy steel crunch when smashing into enemy patrol cars or tanks.
    PlayCarCrash(ImpactSpeed = 12.0, NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("dday:crash", 0.18, NowSeconds))
            return false;
        this.Counts.CarCrash++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const Gain = Math.min(0.32, 0.12 + ImpactSpeed * 0.012);
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 280.0, 62.0, T0,        0.18, Gain,       "square");
        this.ScheduleTone(Ctx, 145.0, 44.0, T0 + 0.02, 0.24, Gain * 0.8, "sawtooth");
        return true;
    }

    // 📝 Triadic fanfare upon breaching the Atlantic Wall.
    PlayBreachVictory(NowSeconds = 0.0)
    {
        if (!this.Enabled || !this.CheckCooldown("dday:victory", 4.0, NowSeconds))
            return false;
        this.Counts.BreachVictory++;
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return true;
        const T0 = Ctx.currentTime;
        this.ScheduleTone(Ctx, 523.25, 523.25, T0,        0.16, 0.18, "triangle");
        this.ScheduleTone(Ctx, 659.25, 659.25, T0 + 0.15, 0.16, 0.19, "triangle");
        this.ScheduleTone(Ctx, 783.99, 783.99, T0 + 0.30, 0.20, 0.20, "triangle");
        this.ScheduleTone(Ctx,1046.50,1046.50, T0 + 0.48, 0.46, 0.22, "triangle");
        return true;
    }
}

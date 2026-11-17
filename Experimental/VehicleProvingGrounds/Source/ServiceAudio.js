//============================================================================================================================================
//                                                           SERVICEAUDIO.JS
//============================================================================================================================================
// 🧩 Procedural Web Audio synthesizer for the Automatic Fuel & 800V Electric Charging Stations:
//    station arrival chimes, butler-robot wheel servo whir, nozzle latch click, liquid fuel pump / 800V inverter hum, and completion fanfare.

export class ServiceAudio
{
    constructor()
    {
        this.Enabled     = true;
        this.Volume      = 0.35;
        this.Context     = null;
        this.ActiveLoop  = null;
        this.BindUnlock();
    }

    BindUnlock()
    {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function")
            return;
        const Unlock = () =>
        {
            this.EnsureContext();
            if (this.Context && this.Context.state === "suspended")
                this.Context.resume().catch(() => {});
        };
        window.addEventListener("keydown", Unlock, { passive: true });
        window.addEventListener("pointerdown", Unlock, { passive: true });
    }

    get MasterVolume()
    {
        return this.Volume;
    }

    set MasterVolume(Value)
    {
        this.Volume = Math.max(0.0, Math.min(1.0, Number(Value) || 0.0));
    }

    SetEnabled(On)
    {
        this.Enabled = !!On;
        if (!this.Enabled)
            this.StopDispensing();
    }

    Unlock()
    {
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return false;
        if (Ctx.state === "suspended" && typeof Ctx.resume === "function")
            Ctx.resume().catch(() => {});
        return true;
    }

    EnsureContext()
    {
        if (!this.Enabled)
            return null;
        if (this.Context)
            return this.Context;
        const Ctor = (typeof globalThis !== "undefined" && globalThis.AudioContext) ||
                     (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext));
        if (!Ctor)
            return null;
        try
        {
            this.Context = new Ctor();
        }
        catch
        {
            this.Context = null;
        }
        return this.Context;
    }

    PlayTone(FrequencyStart, FrequencyEnd, Duration, Type = "sine", GainScale = 0.25, DelaySeconds = 0.0)
    {
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return;
        const Now = Ctx.currentTime + DelaySeconds;
        const Osc = Ctx.createOscillator();
        const Gain = Ctx.createGain();
        Osc.type = Type;
        Osc.frequency.setValueAtTime(Math.max(30.0, FrequencyStart), Now);
        if (Math.abs(FrequencyEnd - FrequencyStart) > 0.5)
            Osc.frequency.exponentialRampToValueAtTime(Math.max(30.0, FrequencyEnd), Now + Duration);

        const Peak = Math.max(0.0005, this.Volume * GainScale);
        Gain.gain.setValueAtTime(0.0001, Now);
        Gain.gain.linearRampToValueAtTime(Peak, Now + Math.min(0.025, 0.25 * Duration));
        Gain.gain.exponentialRampToValueAtTime(0.0001, Now + Duration);

        Osc.connect(Gain);
        Gain.connect(Ctx.destination);
        Osc.start(Now);
        Osc.stop(Now + Duration + 0.02);
    }

    PlayStationWelcome(Kind)
    {
        if (Kind === "electric")
        {
            this.PlayTone(587.33, 587.33, 0.16, "sine", 0.28, 0.00);
            this.PlayTone(880.00, 880.00, 0.24, "triangle", 0.26, 0.12);
        }
        else
        {
            this.PlayTone(440.00, 440.00, 0.16, "triangle", 0.28, 0.00);
            this.PlayTone(659.25, 659.25, 0.24, "triangle", 0.26, 0.12);
        }
        // Butler service robot wheel-servo rollout whir
        this.PlayTone(165.0, 310.0, 0.45, "sawtooth", 0.09, 0.10);
    }

    PlayCouplerLatch(Kind)
    {
        // Mechanical pneumatic/magnetic nozzle lock onto the car's tank port
        this.PlayTone(190.0, 75.0, 0.09, "square", 0.22, 0.00);
        this.PlayTone(Kind === "electric" ? 1480.0 : 1120.0, Kind === "electric" ? 1960.0 : 920.0, 0.08, "triangle", 0.18, 0.05);
    }

    StartDispensing(Kind)
    {
        this.StopDispensing();
        const Ctx = this.EnsureContext();
        if (!Ctx)
            return;
        const Now = Ctx.currentTime;
        const Master = Ctx.createGain();
        Master.gain.setValueAtTime(0.0001, Now);
        Master.gain.linearRampToValueAtTime(Math.max(0.001, this.Volume * 0.22), Now + 0.12);
        Master.connect(Ctx.destination);

        const OscA = Ctx.createOscillator();
        const OscB = Ctx.createOscillator();
        if (Kind === "electric")
        {
            // 800V DC Fast-Charger inverter harmonic hum
            OscA.type = "sine";
            OscB.type = "triangle";
            OscA.frequency.setValueAtTime(220.0, Now);
            OscB.frequency.setValueAtTime(330.0, Now);
        }
        else
        {
            // Fuel station rotary vane pump + fluid flow harmonic
            OscA.type = "sawtooth";
            OscB.type = "triangle";
            OscA.frequency.setValueAtTime(98.0, Now);
            OscB.frequency.setValueAtTime(196.0, Now);
        }

        const Filter = Ctx.createBiquadFilter();
        Filter.type = "lowpass";
        Filter.frequency.setValueAtTime(Kind === "electric" ? 950.0 : 480.0, Now);

        OscA.connect(Filter);
        OscB.connect(Filter);
        Filter.connect(Master);
        OscA.start(Now);
        OscB.start(Now);

        this.ActiveLoop = { Ctx, Master, OscA, OscB, Filter, Kind, LastPipStep: -1 };
    }

    UpdateDispensing(Progress)
    {
        if (!this.ActiveLoop)
            return;
        const { Ctx, OscA, OscB, Filter, Kind } = this.ActiveLoop;
        const Now = Ctx.currentTime;
        const Clamped = Math.max(0.0, Math.min(1.0, Progress));
        if (Kind === "electric")
        {
            OscA.frequency.setTargetAtTime(220.0 + 160.0 * Clamped, Now, 0.05);
            OscB.frequency.setTargetAtTime(330.0 + 240.0 * Clamped, Now, 0.05);
            Filter.frequency.setTargetAtTime(900.0 + 900.0 * Clamped, Now, 0.05);
        }
        else
        {
            OscA.frequency.setTargetAtTime(96.0 + 28.0 * Clamped, Now, 0.05);
            OscB.frequency.setTargetAtTime(192.0 + 84.0 * Clamped, Now, 0.05);
            Filter.frequency.setTargetAtTime(420.0 + 360.0 * Clamped, Now, 0.05);
        }

        // Meter progress pips at 25%, 50%, 75%
        const PipStep = Math.floor(Clamped * 4.0);
        if (PipStep > this.ActiveLoop.LastPipStep && PipStep >= 1 && PipStep <= 3)
        {
            this.ActiveLoop.LastPipStep = PipStep;
            const Base = Kind === "electric" ? 660.0 : 520.0;
            this.PlayTone(Base + PipStep * 95.0, Base + PipStep * 110.0, 0.07, "sine", 0.16, 0.0);
        }
    }

    StopDispensing()
    {
        if (!this.ActiveLoop)
            return;
        const { Ctx, Master, OscA, OscB } = this.ActiveLoop;
        this.ActiveLoop = null;
        try
        {
            const Now = Ctx.currentTime;
            Master.gain.setTargetAtTime(0.0001, Now, 0.04);
            OscA.stop(Now + 0.12);
            OscB.stop(Now + 0.12);
        }
        catch
        {
            // Ignore already-stopped nodes
        }
    }

    PlayCompletionChime(Kind)
    {
        this.StopDispensing();
        const Notes = Kind === "electric"
            ? [587.33, 739.99, 880.00, 1174.66]
            : [523.25, 659.25, 783.99, 1046.50];
        for (let Index = 0; Index < Notes.length; ++Index)
            this.PlayTone(Notes[Index], Notes[Index], 0.18, "triangle", 0.26, Index * 0.09);
    }

    PlayAbortRelease()
    {
        this.StopDispensing();
        this.PlayTone(420.0, 140.0, 0.20, "sawtooth", 0.18, 0.0);
    }
}

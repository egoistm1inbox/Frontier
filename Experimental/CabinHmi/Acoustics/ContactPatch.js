// CONTACT PATCH
// 🧩 Everything the tyres make: the rolling sound over seven surfaces (asphalt, wet, gravel, dirt, grass, cobbles,
//    rumble strip), wind over the body, and tyre squeal (cornering), lock-up skid and wheelspin howl.
// 📝 Like PulseTrainEngine these are live voices: Feed() the speed and slip each block, Render() adds stereo samples.
//    Surfaces are built from their physics: tread-block impacts and air pumping (asphalt), water film and spray (wet),
//    discrete stone hits and underbody pings (gravel), periodic stone or strip impacts through the suspension (cobbles,
//    rumble strip). Squeal is a stick-slip relaxation oscillator plus tread resonances with wandering pitch.

import { Tau, Clamp, Mix, Smoothstep, SeededNoise, OnePole, Biquad, Resonator, Slew, Wander, PanGains, SoftClip } from './SignalKit.js';

/** Surface recipes. Gain trims overall loudness; Roll is the tread/texture band; the rest drive each layer. */
export const Surfaces = {
    Asphalt:     { Label: 'Asphalt', Roll: [700, 1.1], Rumble: 0.55, Hiss: 0.18, Stones: 0, Water: 0, Spacing: 0, Thump: 0, Grip: 1, Gain: 1 },
    Wet:         { Label: 'Wet asphalt', Roll: [620, 0.9], Rumble: 0.45, Hiss: 0.45, Stones: 0, Water: 1, Spacing: 0, Thump: 0, Grip: 0.7, Gain: 1 },
    Gravel:      { Label: 'Gravel', Roll: [900, 0.6], Rumble: 0.9, Hiss: 0.25, Stones: 1, Water: 0, Spacing: 0, Thump: 0.2, Grip: 0.55, Gain: 1.35 },
    Dirt:        { Label: 'Dirt track', Roll: [320, 0.7], Rumble: 1.1, Hiss: 0.08, Stones: 0.18, Water: 0, Spacing: 0, Thump: 0.55, Grip: 0.65, Gain: 1.1 },
    Grass:       { Label: 'Grass', Roll: [1800, 0.5], Rumble: 0.7, Hiss: 0.35, Stones: 0, Water: 0.15, Spacing: 0, Thump: 0.35, Grip: 0.45, Gain: 0.5 },
    Cobbles:     { Label: 'Cobblestones', Roll: [550, 0.9], Rumble: 0.8, Hiss: 0.15, Stones: 0, Water: 0, Spacing: 0.115, Thump: 1, Grip: 0.85, Gain: 0.8 },
    RumbleStrip: { Label: 'Rumble strip', Roll: [700, 1.1], Rumble: 0.6, Hiss: 0.18, Stones: 0, Water: 0, Spacing: 0.32, Thump: 1.4, Grip: 1, Gain: 0.9 },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROLLING
//------------------------------------------------------------------------------------------------------------------------

/** Rolling, road texture and wind for one surface at a time; changing Surface crossfades over ~0.25 s. */
export class SurfaceRoll
{
    constructor(Rate, { Seed = 21, Pickup = 'Chase' } = {})
    {
        this.Rate = Rate;
        this.Pickup = Pickup;
        this.Noise = new SeededNoise(Seed);
        this.Speed = new Slew(Rate, 0.05, 0);
        // Separate levels (bench Mix): Road = tyres on the surface (roar, hiss, tread, stones, water, knocks), Wind = air.
        this.RoadLevel = 1; this.WindLevel = 1;
        this.Weights = Object.fromEntries(Object.keys(Surfaces).map((Name) => [Name, new Slew(Rate, 0.12, Name === 'Asphalt' ? 1 : 0)]));
        this.Surface = 'Asphalt';

        // Shared layers, re-tuned per surface by weight.
        this.RollBands = Object.fromEntries(Object.entries(Surfaces).map(([Name, S]) => [Name, [new Biquad(Rate).Shape('Band', S.Roll[0], S.Roll[1]), new Biquad(Rate).Shape('Band', S.Roll[0], S.Roll[1])]]));
        this.Rumble = [new Biquad(Rate).Shape('Low', 160, 0.8), new Biquad(Rate).Shape('Low', 160, 0.8)];
        this.Hiss = [new Biquad(Rate).Shape('High', 2600, 0.7), new Biquad(Rate).Shape('High', 2600, 0.7)];
        this.Wind = [new Biquad(Rate).Shape('Band', 380, 0.5), new Biquad(Rate).Shape('Band', 420, 0.5)];
        this.Gust = new Wander(Rate, 0.7, Seed + 1);
        this.TreadPhase = 0;

        // Wet: water film sizzle and spray bursts.
        this.Spray = [new Biquad(Rate).Shape('Band', 4200, 0.6), new Biquad(Rate).Shape('Band', 4600, 0.6)];
        this.Splash = 0; this.SplashBand = new Biquad(Rate).Shape('Band', 1400, 0.8);

        // Gravel: a pool of stone resonators re-tuned on each hit; underbody pings ring longer.
        this.StonePool = Array.from({ length: 24 }, () => ({ Ring: new Resonator(Rate, 3000, 0.01), Side: 0, Hit: 0 }));
        this.StoneNext = 0;
        this.Ping = Array.from({ length: 4 }, () => ({ Ring: new Resonator(Rate, 2600, 0.25), Side: 0, Hit: 0 }));
        this.PingNext = 0;
        this.Crunch = [new Biquad(Rate).Shape('Band', 1900, 0.8), new Biquad(Rate).Shape('Band', 2100, 0.8)];
        this.CrunchEnv = 0;

        // Periodic impacts (cobbles, strip): suspension and body modes struck at the spacing rate.
        this.Impact = 0;
        this.Distance = 0; this.LastStone = 0;
        this.Body = [new Resonator(Rate, 68, 0.12), new Resonator(Rate, 140, 0.08), new Resonator(Rate, 310, 0.05)];
        this.Tread = [new Resonator(Rate, 900, 0.015), new Resonator(Rate, 1500, 0.01)];
        this.Bump = new Resonator(Rate, 32, 0.3);                     // tyre sidewall / unsprung mass hop, struck only

        // Cabin colouring: the car body passes lows and cuts highs.
        this.Cabin = [new Biquad(Rate).Shape('HighShelf', 900, 0.7, -14), new Biquad(Rate).Shape('HighShelf', 900, 0.7, -14)];
        this.CabinBoom = [new Biquad(Rate).Shape('Peak', 55, 1, 6), new Biquad(Rate).Shape('Peak', 55, 1, 6)];
    }

    Feed({ Speed = 0, Surface = this.Surface })
    {
        this.Speed.Target = Math.max(0, Speed);
        if (Surfaces[Surface]) this.Surface = Surface;
        for (const [Name, Weight] of Object.entries(this.Weights)) Weight.Target = Name === this.Surface ? 1 : 0;
    }

    Render(Left, Right, Offset = 0, Count = Left.length - Offset)
    {
        const Rate = this.Rate, Noise = this.Noise;
        const Names = Object.keys(Surfaces);
        for (let Index = Offset; Index < Offset + Count; Index++)
        {
            const Speed = this.Speed.Run();
            const Kmh = Speed * 3.6;
            const Moving = Smoothstep(0.3, 3, Speed);
            // Tyre roar grows ~8 dB per doubling of speed up to 150 km/h; above that it is eased to ~3 dB per doubling
            // (a listening choice, not physics: at 300+ km/h the real roar buries the engine, which wears on the ear).
            const Level = (Kmh <= 150 ? Math.pow(Kmh / 100, 1.4) : 1.763 * Math.pow(Kmh / 150, 0.5)) * Moving;
            this.Distance += Speed / Rate;

            // Blend surface recipes into a working set.
            let Rumble = 0, Hiss = 0, Stones = 0, Water = 0, Thump = 0, Spacing = 0, Spaced = 0, Loudness = 0;
            const Rolls = [0, 0];
            const White = [Noise.White(), Noise.White()];
            for (const Name of Names)
            {
                const Weight = this.Weights[Name].Run();
                if (Weight < 1e-4) continue;
                const S = Surfaces[Name];
                Loudness += S.Gain * Weight;
                Rumble += S.Rumble * Weight; Hiss += S.Hiss * Weight; Stones += S.Stones * Weight; Water += S.Water * Weight; Thump += S.Thump * Weight;
                if (S.Spacing) { Spacing += S.Spacing * Weight; Spaced += Weight; }
                Rolls[0] += this.RollBands[Name][0].Run(White[0]) * Weight;
                Rolls[1] += this.RollBands[Name][1].Run(White[1]) * Weight;
            }
            if (Spaced > 0) Spacing /= Spaced;

            // Tread pattern tone: blocks hitting the road at Speed / pitch (≈ 30 mm), randomized pitch sequence.
            this.TreadPhase += Speed / 0.031 / Rate;
            let Tread = 0;
            if (this.TreadPhase >= 1) { this.TreadPhase -= 1 + (Noise.Next() - 0.5) * 0.3; Tread = 1; }
            const TreadRing = (this.Tread[0].Run(Tread) + this.Tread[1].Run(Tread) * 0.6) * 0.5;

            let OutL = (Rolls[0] * 2.2 + TreadRing * 0.5) * Level;
            let OutR = (Rolls[1] * 2.2 + TreadRing * 0.5) * Level;
            OutL += this.Rumble[0].Run(Noise.White()) * Rumble * Level * 1.4;
            OutR += this.Rumble[1].Run(Noise.White()) * Rumble * Level * 1.4;
            OutL += this.Hiss[0].Run(White[0]) * Hiss * Level * 0.5;
            OutR += this.Hiss[1].Run(White[1]) * Hiss * Level * 0.5;

            // Wind: rises with speed squared, gusting.
            const Wind = Math.pow(Kmh / 200, 2.2) * (0.8 + 0.25 * this.Gust.Run());
            const WindL = this.Wind[0].Run(Noise.Pink()) * Wind * 0.9;
            const WindR = this.Wind[1].Run(Noise.Pink()) * Wind * 0.9;

            // Wet: continuous sizzle and spray, irregular splashes from standing water.
            if (Water > 0.01)
            {
                const Sizzle = (Noise.Next() < 0.004 * (1 + Kmh / 40) ? Noise.Range(1, 3) : 0) * Noise.White();
                OutL += (this.Spray[0].Run(Noise.White()) * 0.55 + Sizzle * 0.15) * Water * Level * 1.2;
                OutR += (this.Spray[1].Run(Noise.White()) * 0.55 + Sizzle * 0.15) * Water * Level * 1.2;
                if (Noise.Next() < 0.6 / Rate * Kmh / 30 * Water) this.Splash = Noise.Range(0.5, 1.2);
                this.Splash *= 1 - 9 / Rate;
                const Splash = this.SplashBand.Run(Noise.White()) * this.Splash * Water * Moving;
                OutL += Splash * 0.35; OutR += Splash * 0.3;
            }

            // Gravel: discrete stone hits (density ∝ speed), crunch bed, and stones pinging the underbody.
            if (Stones > 0.01 && Moving > 0)
            {
                const Density = Stones * (60 + Kmh * 18);
                if (Noise.Next() < Density / Rate)
                {
                    const Stone = this.StonePool[this.StoneNext]; this.StoneNext = (this.StoneNext + 1) % this.StonePool.length;
                    Stone.Ring.Tune(Noise.Range(1300, 6500), Noise.Range(0.004, 0.02));
                    Stone.Side = Noise.Next(); Stone.Hit = Noise.Range(0.3, 1) * (0.6 + Level);
                }
                let Hits = [0, 0];
                for (const Stone of this.StonePool)
                {
                    const Ring = Stone.Ring.Run(Stone.Hit); Stone.Hit = 0;
                    Hits[0] += Ring * (1 - Stone.Side); Hits[1] += Ring * Stone.Side;
                }
                if (Noise.Next() < Stones * Kmh * 0.03 / Rate)
                {
                    const Ping = this.Ping[this.PingNext]; this.PingNext = (this.PingNext + 1) % this.Ping.length;
                    Ping.Ring.Tune(Noise.Range(1800, 4200), Noise.Range(0.08, 0.3)); Ping.Side = Noise.Next(); Ping.Hit = Noise.Range(1, 2.2);
                }
                for (const Ping of this.Ping) { const Ring = Ping.Ring.Run(Ping.Hit); Ping.Hit = 0; Hits[0] += Ring * (1 - Ping.Side) * 0.6; Hits[1] += Ring * Ping.Side * 0.6; }
                this.CrunchEnv += ((0.4 + Noise.Next()) - this.CrunchEnv) * 0.002;
                OutL += Hits[0] * 1.8 * Stones + this.Crunch[0].Run(Noise.White()) * this.CrunchEnv * Stones * Level * 0.9;
                OutR += Hits[1] * 1.8 * Stones + this.Crunch[1].Run(Noise.White()) * this.CrunchEnv * Stones * Level * 0.9;
            }

            // Thumps: periodic (cobbles, strip) or random (dirt, grass) impacts into the suspension and body modes.
            let Strike = 0;
            if (Spacing > 0 && this.Distance - this.LastStone >= Spacing * (Spaced > 0.5 ? 1 : 1e9))
            {
                this.LastStone = this.Distance + (Noise.Next() - 0.5) * Spacing * (Thump > 1.2 ? 0.02 : 0.35);
                Strike = (Thump > 1.2 ? 1 : Noise.Range(0.45, 1.1)) * Moving;
            }
            else if (Spacing === 0 && Thump > 0.01 && Noise.Next() < Thump * (4 + Kmh * 0.25) / Rate) Strike = Noise.Range(0.2, 1) * Thump * Moving;
            let Body = 0;
            if (Strike || this.Impact)
            {
                this.Impact = Strike;
                Body = this.Body[0].Run(this.Impact) * 1.0 + this.Body[1].Run(this.Impact) * 0.8 + this.Body[2].Run(this.Impact * Noise.Range(0.5, 1)) * 0.45;
            }
            else Body = this.Body[0].Run(0) + this.Body[1].Run(0) * 0.8 + this.Body[2].Run(0) * 0.45;
            const Bump = this.Bump.Run(Strike * 0.4) * Thump * Moving;
            const Knock = (Body * 6 + Bump * 3) * Math.min(1, 0.45 + Kmh / 80);
            OutL += Knock; OutR += Knock;
            OutL = OutL * this.RoadLevel + WindL * this.WindLevel;
            OutR = OutR * this.RoadLevel + WindR * this.WindLevel;

            if (this.Pickup === 'Cabin')
            {
                OutL = this.CabinBoom[0].Run(this.Cabin[0].Run(OutL));
                OutR = this.CabinBoom[1].Run(this.Cabin[1].Run(OutR));
            }
            Left[Index] += SoftClip(OutL * 0.5 * Loudness, 1.4);
            Right[Index] += SoftClip(OutR * 0.5 * Loudness, 1.4);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SQUEAL
//------------------------------------------------------------------------------------------------------------------------

/**
 * Tyre squeal, skid and wheelspin. Feed: { Speed m/s, Corner 0–1 (lateral slip), LockUp 0–1 (braked slide),
 * Wheelspin 0–1 (driven slip), Grip 0–1 (surface; loose surfaces scrub instead of squealing) }.
 * Squeal: a stick-slip relaxation oscillator (tread blocks catching and letting go) whose pitch wanders around
 * 700–1300 Hz, mixed with noise ringing a set of tread resonances. Lock-up adds a lower, rougher scrub; wheelspin adds a
 * howl whose pitch follows the slip speed and a smoke-hiss bed.
 */
export class TyreSqueal
{
    constructor(Rate, { Seed = 31, Pickup = 'Chase' } = {})
    {
        this.Rate = Rate; this.Pickup = Pickup;
        this.Noise = new SeededNoise(Seed);
        this.Speed = new Slew(Rate, 0.05, 0);
        this.Corner = new Slew(Rate, 0.06, 0); this.LockUp = new Slew(Rate, 0.03, 0); this.Wheelspin = new Slew(Rate, 0.05, 0);
        this.Grip = new Slew(Rate, 0.2, 1);
        this.Wanders = [new Wander(Rate, 1.8, Seed + 1), new Wander(Rate, 5.5, Seed + 2), new Wander(Rate, 0.6, Seed + 3), new Wander(Rate, 11, Seed + 4)];
        this.Phases = [0, 0.37];                                       // left and right tyre oscillators
        this.Modes = [[1, 0.11], [2.02, 0.07], [2.97, 0.05], [4.1, 0.03]].map(([Ratio, Decay]) => [new Resonator(Rate, 900 * Ratio, Decay), new Resonator(Rate, 905 * Ratio, Decay), Ratio]);
        this.Scrub = [new Biquad(Rate).Shape('Band', 520, 1.2), new Biquad(Rate).Shape('Band', 560, 1.2)];
        this.Smoke = [new Biquad(Rate).Shape('High', 1500, 0.6), new Biquad(Rate).Shape('High', 1500, 0.6)];
        this.Loose = [new Biquad(Rate).Shape('Band', 1100, 0.5), new Biquad(Rate).Shape('Band', 1200, 0.5)];
        this.Chatter = 0;
        this.Cabin = [new Biquad(Rate).Shape('HighShelf', 1200, 0.7, -9), new Biquad(Rate).Shape('HighShelf', 1200, 0.7, -9)];
    }

    Feed({ Speed = 0, Corner = 0, LockUp = 0, Wheelspin = 0, Grip = 1 })
    {
        this.Speed.Target = Speed; this.Corner.Target = Clamp(Corner, 0, 1); this.LockUp.Target = Clamp(LockUp, 0, 1);
        this.Wheelspin.Target = Clamp(Wheelspin, 0, 1); this.Grip.Target = Clamp(Grip, 0, 1);
    }

    Render(Left, Right, Offset = 0, Count = Left.length - Offset)
    {
        const Rate = this.Rate, Noise = this.Noise;
        let Retune = 0;
        for (let Index = Offset; Index < Offset + Count; Index++)
        {
            const Speed = this.Speed.Run(), Corner = this.Corner.Run(), LockUp = this.LockUp.Run(), Spin = this.Wheelspin.Run(), Grip = this.Grip.Run();
            const Slide = Math.max(Corner, LockUp);
            const Drive = Math.max(Slide * Smoothstep(1, 6, Speed), Spin);
            if (Drive < 1e-4 && this.Chatter < 1e-4) { this.Chatter = 0; continue; }
            const Sticky = Smoothstep(0.55, 0.9, Grip);                // squeal needs grip; loose surfaces scrub
            const [Slow, Fast, Drift, Jitter] = this.Wanders.map((Walk) => Walk.Run());

            // Pitch: higher with more slip and on high-grip surfaces; lock-up is lower.
            const SlidePitch = Mix(780, 1150, Smoothstep(0.2, 1, Drive)) * (1 - 0.18 * LockUp) * (1 + 0.06 * Slow + 0.025 * Fast + 0.04 * Drift);
            const SpinPitch = Mix(520, 1450, Smoothstep(0, 1, Spin)) * (1 + 0.05 * Fast);
            const Pitch = Spin > Slide ? Mix(SlidePitch, SpinPitch, Smoothstep(0.1, 0.6, Spin)) : SlidePitch;
            if (++Retune % 32 === 0) for (const [L, R, Ratio] of this.Modes) { L.Tune(Pitch * Ratio, 0.09 / Ratio); R.Tune(Pitch * Ratio * 1.012, 0.09 / Ratio); }

            // Stick-slip: a relaxation pulse per cycle with timing jitter; amplitude chatters as blocks grab.
            this.Chatter += ((0.55 + 0.45 * Math.abs(Jitter)) * Drive - this.Chatter) * 0.004;
            const Pulses = [0, 0];
            for (let Side = 0; Side < 2; Side++)
            {
                this.Phases[Side] += Pitch * (Side ? 1.007 : 1) * (1 + Noise.Gauss() * 0.012) / Rate;
                if (this.Phases[Side] >= 1) { this.Phases[Side] -= 1; Pulses[Side] = 1; }
            }
            const Saw = [this.Phases[0] * 2 - 1, this.Phases[1] * 2 - 1];
            let SquealL = 0, SquealR = 0;
            const Excite = Noise.White() * 0.25;
            for (const [L, R] of this.Modes) { SquealL += L.Run(Pulses[0] + Excite); SquealR += R.Run(Pulses[1] + Excite); }
            SquealL = SquealL * 3.2 + Saw[0] * 0.08; SquealR = SquealR * 3.2 + Saw[1] * 0.08;
            const Squeal = this.Chatter * Sticky;

            // Scrub (lock-up), smoke hiss (wheelspin), loose-surface spray.
            const Scrub = LockUp * Smoothstep(1, 8, Speed);
            const ScrubL = this.Scrub[0].Run(Noise.White()) * Scrub * (0.7 + 0.3 * Fast), ScrubR = this.Scrub[1].Run(Noise.White()) * Scrub * (0.7 + 0.3 * Fast);
            const Smoke = Spin * (0.4 + 0.6 * Sticky);
            const SmokeL = this.Smoke[0].Run(Noise.White()) * Smoke, SmokeR = this.Smoke[1].Run(Noise.White()) * Smoke;
            const LooseL = this.Loose[0].Run(Noise.White()) * Drive * (1 - Sticky), LooseR = this.Loose[1].Run(Noise.White()) * Drive * (1 - Sticky);

            let OutL = SquealL * Squeal * 1.8 + ScrubL * 2.6 + SmokeL * 0.3 + LooseL * 2.6;
            let OutR = SquealR * Squeal * 1.8 + ScrubR * 2.6 + SmokeR * 0.3 + LooseR * 2.6;
            if (this.Pickup === 'Cabin') { OutL = this.Cabin[0].Run(OutL); OutR = this.Cabin[1].Run(OutR); }
            Left[Index] += SoftClip(OutL * 0.6, 1.3);
            Right[Index] += SoftClip(OutR * 0.6, 1.3);
        }
    }
}

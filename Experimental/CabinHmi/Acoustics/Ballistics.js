// BALLISTICS
// 🧩 Synthesized weapon sounds: an energy LMG that spins up as you hold the trigger (Devotion-style, with or without the
//    Turbocharger hop-up), a belt-fed LMG, an SMG, a bolt-action sniper rifle, an automated turret, a tank cannon and an
//    autocannon; bullets passing by (supersonic crack with the distant report arriving later, subsonic whizz,
//    ricochet whine); and bullets hitting sand, dirt, rock, concrete, wood, metal, glass and water.
// 📝 Every shot is layered from physics-shaped pieces (ImpactFoley helpers): the muzzle blast (Friedlander
//    overpressure), propellant gas (shaped noise), the weapon's body thump, the action's struck modes (bolt, belt
//    links, breech), brass landing, and for the energy weapon an electric zap plus the spin motor. Fire rates follow
//    FireRate(): Devotion-style 5 → 15 rounds/s over 1.75 s, 6.8 → 15 over 0.85 s with the Turbocharger, 44 rounds.
//    Same contract as CabinFoley: Cues + RenderCue; plus RenderShot / RenderMotor for the live bench's hold-to-fire.
//    Original designs: nothing is copied or sampled from any game or recording.

import { Tau, Clamp, Mix, Smoothstep, SeededNoise, OnePole, Biquad, Resonator, PanGains, Strike } from './SignalKit.js';
import { Overpressure, Thump, Roar, Scatter, Bounce, Whine, Echoes, Distant, Settle } from './ImpactFoley.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    WEAPONS
//------------------------------------------------------------------------------------------------------------------------

/**
 * Weapon recipes. Rate: [first, top] rounds per second; Spin: seconds to reach the top rate (0 = constant). Turbo
 * overrides for the hop-up. Shot layers: Blast (overpressure), Gas (noise roar), Body (thump), Action ([modes, gain,
 * delay]), Brass (casing bounce modes or null), Zap (energy discharge), Tail (long rolling echo).
 */
export const Weapons = {
    EnergyLmg: {
        Label: 'Energy LMG', Note: 'Devotion-style spin-up', Rate: [5, 15], Spin: 1.75, Magazine: 44, Motor: { Hz: 46, Barrels: 3, Gain: 0.06 },
        Turbo: { Rate: [6.8, 15], Spin: 0.85 },
        Blast: { Lasts: 0.0012, Gain: 0.8, Low: 7000 }, Gas: { Seconds: 0.09, From: 9000, To: 1500, Floor: 400, Gain: 0.35, Grit: 0.5 },
        Body: { Hz: 115, EndHz: 60, Decay: 0.14, Gain: 0.45, Drive: 1.6 },
        Action: [[[1900, 0.03, 1], [3300, 0.02, 0.6], [5200, 0.012, 0.4]], 3, 0.006],
        Zap: { From: 2600, To: 420, Seconds: 0.07, Gain: 0.2 }, Brass: null,
    },
    Lmg: {
        Label: 'LMG', Note: 'belt-fed, 640 rounds/min', Rate: [10.7, 10.7], Spin: 0, Magazine: 100,
        Blast: { Lasts: 0.0022, Gain: 1.1, Low: 6000 }, Gas: { Seconds: 0.16, From: 7000, To: 700, Floor: 150, Gain: 0.45, Grit: 0.6 },
        Body: { Hz: 85, EndHz: 45, Decay: 0.25, Gain: 0.75, Drive: 2 },
        Action: [[[1250, 0.04, 1], [2600, 0.025, 0.6], [480, 0.05, 0.5]], 4, 0.012], Links: [[3100, 0.012, 1], [4700, 0.01, 0.6]],
        Brass: [[4300, 0.05, 1], [7900, 0.03, 0.5]],
    },
    Smg: {
        Label: 'SMG', Note: '900 rounds/min', Rate: [15, 15], Spin: 0, Magazine: 30,
        Blast: { Lasts: 0.0011, Gain: 0.8, Low: 9000 }, Gas: { Seconds: 0.08, From: 10000, To: 1800, Floor: 500, Gain: 0.32, Grit: 0.4 },
        Body: { Hz: 140, EndHz: 80, Decay: 0.08, Gain: 0.32, Drive: 1.4 },
        Action: [[[2100, 0.025, 1], [3800, 0.015, 0.6], [900, 0.03, 0.5]], 3, 0.008],
        Brass: [[5200, 0.04, 1], [9100, 0.025, 0.5]],
    },
    Turret: {
        Label: 'Turret', Note: 'automated, 720 rounds/min', Rate: [12, 12], Spin: 0, Magazine: 200, Motor: { Hz: 38, Barrels: 0, Gain: 0.05 },
        Blast: { Lasts: 0.0018, Gain: 1.0, Low: 6500 }, Gas: { Seconds: 0.13, From: 8000, To: 900, Floor: 200, Gain: 0.4, Grit: 0.55 },
        Body: { Hz: 95, EndHz: 50, Decay: 0.2, Gain: 0.6, Drive: 1.8 },
        Action: [[[1500, 0.035, 1], [2900, 0.022, 0.6], [620, 0.045, 0.5]], 4, 0.01], Links: [[3600, 0.01, 1], [5400, 0.008, 0.5]],
        Brass: [[4100, 0.05, 1], [7600, 0.03, 0.5]],
    },
    AutoCannon: {
        Label: 'Autocannon', Note: '30 mm, 210 rounds/min', Rate: [3.5, 3.5], Spin: 0, Magazine: 40,
        Blast: { Lasts: 0.008, Gain: 1.4, Low: 3000 }, Gas: { Seconds: 0.6, From: 4000, To: 200, Floor: 40, Gain: 0.55, Grit: 0.6 },
        Body: { Hz: 60, EndHz: 30, Decay: 0.6, Gain: 1.0, Drive: 2.4 },
        Action: [[[420, 0.08, 1], [980, 0.05, 0.7], [2200, 0.03, 0.4]], 6, 0.05],
        Brass: [[1250, 0.25, 1], [3300, 0.15, 0.6], [5600, 0.08, 0.3]],
    },
};

/** Rounds per second after the trigger has been held for Held seconds (linear spin-up to the top rate). */
export function FireRate(Name, Held, Turbo = false)
{
    const Weapon = Weapons[Name], Spec = Turbo && Weapon.Turbo ? { ...Weapon, ...Weapon.Turbo } : Weapon;
    const [First, Top] = Spec.Rate;
    return Spec.Spin ? First + (Top - First) * Clamp(Held / Spec.Spin, 0, 1) : First;
}

/** Draws one shot of a weapon at Time (no room echo; callers add Echoes once over the whole scene). */
function DrawShot(Left, Right, Rate, Time, Name, Seed, { Pan = 0, Gain = 1 } = {})
{
    const W = Weapons[Name], Noise = new SeededNoise(Seed), Vary = () => 1 + Noise.Gauss() * 0.06;
    Overpressure(Left, Right, Rate, Time, { Lasts: W.Blast.Lasts * Vary(), Gain: W.Blast.Gain * Gain * Vary(), Low: W.Blast.Low, Pan });
    Roar(Left, Right, Rate, Time, W.Gas.Seconds, { From: W.Gas.From * Vary(), To: W.Gas.To, Floor: W.Gas.Floor, Gain: W.Gas.Gain * Gain, Attack: 0.0015, Curve: 2.6, Grit: W.Gas.Grit, Seed: Seed + 1 });
    Thump(Left, Right, Rate, Time, { Hz: W.Body.Hz * Vary(), EndHz: W.Body.EndHz, Decay: W.Body.Decay, Gain: W.Body.Gain * Gain, Drive: W.Body.Drive, Attack: 0.0015, Pan });
    const [Modes, Level, Delay] = W.Action;
    Strike(Left, Right, Rate, Time + Delay, { Modes: Modes.map(([Hz, Decay, Part]) => [Hz * Vary(), Decay, Part]), Burst: 0.0008, Gain: Level * Gain * Vary(), Pan, Seed: Seed + 2 });
    if (W.Links) Strike(Left, Right, Rate, Time + Delay * 2.6, { Modes: W.Links, Burst: 0.0004, Gain: 2.2 * Gain * Vary(), Pan: Pan + 0.2, Seed: Seed + 3 });
    if (W.Zap)
    {
        // Energy discharge: a fast falling electric tone with a buzzy harmonic stack and a high capacitor tick.
        Whine(Left, Right, Rate, Time, W.Zap.Seconds, { From: W.Zap.From * Vary(), To: W.Zap.To, Gain: W.Zap.Gain * Gain, Curve: 0.45, Harmonics: [1, 0.65, 0.45, 0.3, 0.22, 0.15], Shape: (P) => Math.pow(1 - P, 2) * Smoothstep(0, 0.02, P), Wobble: 0.02, Pan });
        Strike(Left, Right, Rate, Time + 0.002, { Modes: [[7400, 0.004, 1], [10200, 0.003, 0.6]], Burst: 0.0002, Gain: 1.2 * Gain, Pan, Seed: Seed + 4 });
    }
    if (W.Brass) Bounce(Left, Right, Rate, Time + Noise.Range(0.32, 0.55), { Modes: W.Brass, Hits: 3, First: Noise.Range(0.06, 0.1), Ratio: 0.55, Gain: 0.9 * Gain, Pan: Pan + Noise.Range(0.3, 0.7), Seed: Seed + 5 });
}

/**
 * The spin motor of the energy LMG and the turret: a whine whose pitch tracks the fire rate (Motor.Hz per round per
 * second), barrel clatter at Barrels × rate, a spin-down after the trigger is released, and for the Turbocharger a
 * turbine whistle riding up with it plus a charge hiss on the trigger pull.
 */
function DrawMotor(Left, Right, Rate, Start, Stop, Name, Turbo)
{
    const W = Weapons[Name], Motor = W.Motor, Noise = new SeededNoise(97);
    const From = Math.max(0, Start - 0.06), Count = Math.min(Left.length, Math.round((Stop + 1.0) * Rate)) - Math.round(From * Rate);
    const Clatter = new Resonator(Rate, 2600, 0.01), Clatter2 = new Resonator(Rate, 4100, 0.008);
    let Phase = 0, Turn = 0, Whistle = 0;
    for (let Index = 0; Index < Count; Index++)
    {
        const Time = From + Index / Rate, Sample = Math.round(From * Rate) + Index;
        const Firing = Time < Stop;
        const Held = Math.max(0, Time - Start);
        let Spin = Time < Start ? (Time - From) / 0.06 * FireRate(Name, 0, Turbo) : FireRate(Name, Held, Turbo);
        if (!Firing) Spin = FireRate(Name, Stop - Start, Turbo) * Math.exp(-(Time - Stop) / 0.32);
        const Level = Motor.Gain * Smoothstep(0, 0.05, Time - From) * (Firing ? 1 : Math.exp(-(Time - Stop) / 0.45));
        Phase += Spin * Motor.Hz / Rate;
        let Out = (Math.sin(Tau * Phase) * 0.6 + Math.sin(Tau * Phase * 2) * 0.35 + Math.sin(Tau * Phase * 3) * 0.2 + Math.sin(Tau * Phase * 5) * 0.1) * Level;
        if (Motor.Barrels)
        {
            Turn += Spin * Motor.Barrels / Rate;
            const Kick = Turn >= 1 ? (Turn -= 1, Noise.Range(0.6, 1)) : 0;
            Out += (Clatter.Run(Kick) + Clatter2.Run(Kick) * 0.6) / Clatter.Norm * 0.0045 * Level / Motor.Gain;
        }
        if (Turbo && W.Turbo)
        {
            Whistle += (2800 + Spin * 360) / Rate;
            Out += Math.sin(Tau * Whistle) * 0.022 * Level / Motor.Gain * Smoothstep(0, 0.2, Held + (Firing ? 0 : 1));
        }
        Left[Sample] += Out; Right[Sample] += Out * 0.92;
    }
    if (Turbo && W.Turbo) Roar(Left, Right, Rate, From, 0.3, { From: 3000, To: 9000, Floor: 1500, Gain: 0.12, Attack: 0.01, Curve: 1, Seed: 98, Shape: (P) => Math.sin(Math.PI * P) });
}

/** Holds the trigger for Seconds (or until the magazine empties). Returns the shot times. */
function Burst(Left, Right, Rate, Start, Name, { Seconds = 3, Turbo = false, Seed = 300, Pan = 0 } = {})
{
    const W = Weapons[Name], Times = [];
    let Held = 0;
    while (Held < Seconds && Times.length < W.Magazine) { Times.push(Held); Held += 1 / FireRate(Name, Held, Turbo); }
    Times.forEach((At, Index) => DrawShot(Left, Right, Rate, Start + At, Name, Seed + Index * 11, { Pan }));
    const Stop = Start + (Times.at(-1) ?? 0) + 0.04;
    if (W.Motor) DrawMotor(Left, Right, Rate, Start, Stop, Name, Turbo);
    if (Times.length >= W.Magazine) Strike(Left, Right, Rate, Stop + 0.06, { Modes: [[2400, 0.02, 1], [4100, 0.012, 0.5]], Burst: 0.0004, Gain: 1.5, Pan, Seed: Seed + 999 });   // empty: dry click
    return { Times, Stop };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    BULLET PIECES
//------------------------------------------------------------------------------------------------------------------------

/** Supersonic bullet N-wave: a sudden compression, a linear fall through suction and a sudden return, Lasts long. */
function Snap(Left, Right, Rate, Time, { Lasts = 0.0003, Gain = 1, Pan = 0 } = {})
{
    const Start = Math.round(Time * Rate), Length = Math.max(3, Math.round(Lasts * Rate)), [GainL, GainR] = PanGains(Pan);
    const Soften = new OnePole(Rate, 15000);
    for (let Index = 0; Index < Length + 24 && Start + Index < Left.length; Index++)
    {
        const Wave = Index < Length ? 1 - 2 * Index / Length : 0;
        const Out = Soften.Run(Wave) * Gain;
        Left[Start + Index] += Out * GainL; Right[Start + Index] += Out * GainR;
    }
}

/** Air bubble (water impacts): a decaying sine whose pitch rises as the bubble rises and shrinks. */
function Bubble(Left, Right, Rate, Time, { Hz = 900, Rise = 0.8, Decay = 0.06, Gain = 0.3, Pan = 0 } = {})
{
    const Start = Math.round(Time * Rate), Count = Math.min(Left.length - Start, Math.round(Decay * Rate)), [GainL, GainR] = PanGains(Pan);
    let Phase = 0;
    for (let Index = 0; Index < Count; Index++)
    {
        const Progress = Index / Count;
        Phase += Hz * (1 + Rise * Progress) / Rate;
        const Out = Math.sin(Tau * Phase) * Math.exp(-Progress * 6.9) * Math.min(1, Index / (Rate * 0.0008)) * Gain;
        Left[Start + Index] += Out * GainL; Right[Start + Index] += Out * GainR;
    }
}

/** Ricochet: the bullet tumbling away, a falling, warbling whine with turbulent hiss, fading and panning off. */
function Ricochet(Left, Right, Rate, Time, { From = 3800, To = 1300, Seconds = 0.75, Gain = 0.25, Pan = 0, Away = 0.8, Seed = 71 } = {})
{
    const Start = Math.round(Time * Rate), Count = Math.min(Left.length - Start, Math.round(Seconds * Rate));
    const Noise = new SeededNoise(Seed), Band = new Biquad(Rate);
    let Phase = 0;
    for (let Index = 0; Index < Count; Index++)
    {
        const Progress = Index / Count, Age = Index / Rate;
        const Hz = From * Math.pow(To / From, Progress) * (1 + 0.035 * Math.sin(Tau * 17 * Age));
        if ((Index & 31) === 0) Band.Shape('Band', Hz, 4);
        Phase += Hz / Rate;
        const Envelope = Smoothstep(0, 0.03, Progress) * Math.pow(1 - Progress, 1.4);
        const Out = (Math.sin(Tau * Phase) * 0.8 + Band.Run(Noise.White()) * 1.5) * Envelope * Gain;
        const [GainL, GainR] = PanGains(Pan + (Away - Pan) * Progress);
        Left[Start + Index] += Out * GainL; Right[Start + Index] += Out * GainR;
    }
}

/** Subsonic whizz: band noise and a vortex tone sweeping down as the projectile passes (Doppler), panning across. */
function Whizz(Left, Right, Rate, Time, { From = 2800, To = 1000, Seconds = 0.22, Gain = 0.4, Pan = -1, EndPan = 1, Seed = 81 } = {})
{
    const Start = Math.round(Time * Rate), Count = Math.min(Left.length - Start, Math.round(Seconds * Rate));
    const Noise = new SeededNoise(Seed), Band = new Biquad(Rate);
    let Phase = 0;
    for (let Index = 0; Index < Count; Index++)
    {
        const Progress = Index / Count;
        const Hz = Mix(From, To, Smoothstep(0.3, 0.7, Progress));                 // pitch drops as it goes past
        if ((Index & 31) === 0) Band.Shape('Band', Hz, 2.5);
        Phase += Hz / Rate;
        const Envelope = Math.exp(-Math.pow((Progress - 0.5) / 0.17, 2));
        const Out = (Band.Run(Noise.White()) * 1.4 + Math.sin(Tau * Phase) * 0.35) * Envelope * Gain;
        const [GainL, GainR] = PanGains(Mix(Pan, EndPan, Progress));
        Left[Start + Index] += Out * GainL; Right[Start + Index] += Out * GainR;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    IMPACTS
//------------------------------------------------------------------------------------------------------------------------

/** One bullet strike on a material at Time. Materials: Sand, Dirt, Rock, Concrete, Wood, Metal, Glass, Water. */
export function DrawHit(Left, Right, Rate, Time, Material, Seed = 400, { Pan = 0, Gain = 1, Bounce: Glance = false } = {})
{
    const Noise = new SeededNoise(Seed), R = (Low, High) => Noise.Range(Low, High);
    switch (Material)
    {
        case 'Sand':
            // Soft thud, a puff, then the spray of grains pattering down with a dry hiss.
            Strike(Left, Right, Rate, Time, { Modes: [[R(160, 210), 0.03, 1], [R(380, 460), 0.02, 0.6]], Burst: 0.003, Gain: 3 * Gain, Pan, Seed });
            Roar(Left, Right, Rate, Time, 0.14, { From: 2600, To: 500, Floor: 120, Gain: 0.5 * Gain, Attack: 0.002, Curve: 2, Seed: Seed + 1 });
            Roar(Left, Right, Rate, Time + 0.02, 0.6, { From: 9000, To: 4500, Floor: 2500, Gain: 0.08 * Gain, Attack: 0.03, Curve: 1.6, Grit: 0.95, Seed: Seed + 2 });
            Scatter(Left, Right, Rate, Time + 0.03, 0.6, 140, (N, P) => ({ Modes: [[N.Range(5000, 11000), 0.002, 1]], Burst: 0.0002, Gain: N.Range(0.1, 0.6) * Gain * (1 - P * 0.6), Pan: Pan + N.Range(-0.4, 0.4) }), { Seed: Seed + 3, Bunch: 1.4 });
            break;
        case 'Dirt':
            Strike(Left, Right, Rate, Time, { Modes: [[R(120, 160), 0.04, 1], [R(300, 380), 0.025, 0.7], [R(800, 1000), 0.012, 0.3]], Burst: 0.0025, Gain: 3.4 * Gain, Pan, Seed });
            Roar(Left, Right, Rate, Time, 0.18, { From: 2200, To: 350, Floor: 90, Gain: 0.55 * Gain, Attack: 0.002, Curve: 2, Grit: 0.5, Seed: Seed + 1 });
            Scatter(Left, Right, Rate, Time + 0.12, 0.45, 16, (N) => ({ Modes: [[N.Range(220, 600), 0.02, 1], [N.Range(900, 1800), 0.01, 0.5]], Burst: 0.0015, Gain: N.Range(0.4, 1.4) * Gain, Pan: Pan + N.Range(-0.5, 0.5) }), { Seed: Seed + 2, Bunch: 1.2 });
            Roar(Left, Right, Rate, Time + 0.05, 0.5, { From: 7000, To: 3500, Floor: 2000, Gain: 0.04 * Gain, Attack: 0.05, Curve: 1.5, Grit: 0.9, Seed: Seed + 3 });
            break;
        case 'Rock':
            // Hard crack (stone rings briefly, high), a sharp snap, chips flying, a little dust; sometimes a ricochet.
            Strike(Left, Right, Rate, Time, { Modes: [[R(2200, 3200), 0.012, 1], [R(4500, 6500), 0.008, 0.7], [R(900, 1400), 0.015, 0.6], [R(8000, 10000), 0.004, 0.4]], Burst: 0.0004, Gain: 4 * Gain, Pan, Seed });
            Overpressure(Left, Right, Rate, Time, { Lasts: 0.00035, Gain: 0.25 * Gain, Low: 14000, Pan });
            Scatter(Left, Right, Rate, Time + 0.01, 0.5, 26, (N) => ({ Modes: [[N.Range(1800, 4500), N.Range(0.004, 0.012), 1], [N.Range(5000, 9000), 0.004, 0.5]], Burst: 0.0002, Gain: N.Range(0.3, 1.2) * Gain, Pan: Pan + N.Range(-0.6, 0.6) }), { Seed: Seed + 1, Bunch: 1.8 });
            Roar(Left, Right, Rate, Time + 0.01, 0.35, { From: 8000, To: 3000, Floor: 1500, Gain: 0.06 * Gain, Attack: 0.01, Curve: 2, Grit: 0.8, Seed: Seed + 2 });
            if (Glance) Ricochet(Left, Right, Rate, Time + 0.01, { From: R(3400, 4400), To: R(1100, 1600), Seconds: R(0.55, 0.85), Gain: 0.22 * Gain, Pan, Away: Pan > 0 ? -0.8 : 0.8, Seed: Seed + 3 });
            break;
        case 'Concrete':
            Strike(Left, Right, Rate, Time, { Modes: [[R(1500, 1900), 0.014, 1], [R(3200, 3800), 0.009, 0.6], [R(650, 800), 0.02, 0.6]], Burst: 0.0006, Gain: 3.6 * Gain, Pan, Seed });
            Overpressure(Left, Right, Rate, Time, { Lasts: 0.0005, Gain: 0.3 * Gain, Low: 11000, Pan });
            Roar(Left, Right, Rate, Time + 0.005, 0.7, { From: 7000, To: 1800, Floor: 600, Gain: 0.16 * Gain, Attack: 0.008, Curve: 2.2, Grit: 0.85, Seed: Seed + 1 });   // dust and grit
            Scatter(Left, Right, Rate, Time + 0.02, 0.6, 30, (N) => ({ Modes: [[N.Range(1200, 3200), N.Range(0.005, 0.015), 1]], Burst: 0.0004, Gain: N.Range(0.3, 1) * Gain, Pan: Pan + N.Range(-0.6, 0.6) }), { Seed: Seed + 2, Bunch: 1.6 });
            if (Glance) Ricochet(Left, Right, Rate, Time + 0.01, { From: R(3000, 3800), To: R(1000, 1400), Seconds: R(0.5, 0.7), Gain: 0.18 * Gain, Pan, Seed: Seed + 3 });
            break;
        case 'Wood':
            // Hollow thunk (plank modes), a low knock through the post, splinters crackling.
            Strike(Left, Right, Rate, Time, { Modes: [[R(320, 420), 0.06, 1], [R(780, 950), 0.04, 0.8], [R(1500, 1900), 0.025, 0.5], [R(2800, 3200), 0.015, 0.3], [R(130, 160), 0.08, 0.7]], Burst: 0.0009, Gain: 4.2 * Gain, Pan, Seed });
            Scatter(Left, Right, Rate, Time + 0.002, 0.14, 22, (N) => ({ Modes: [[N.Range(2800, 7000), 0.003, 1]], Burst: 0.0003, Gain: N.Range(0.4, 1.4) * Gain, Pan: Pan + N.Range(-0.3, 0.3) }), { Seed: Seed + 1, Bunch: 2.2 });
            Scatter(Left, Right, Rate, Time + 0.15, 0.4, 6, (N) => ({ Modes: [[N.Range(600, 1400), 0.02, 1], [N.Range(1800, 3000), 0.01, 0.5]], Burst: 0.0006, Gain: N.Range(0.4, 1) * Gain, Pan: Pan + N.Range(-0.5, 0.5) }), { Seed: Seed + 2 });
            break;
        case 'Metal':
        {
            // Steel plate: a bright inharmonic clang that rings on, a spark crackle; sometimes the round glances off.
            const Root = R(850, 1250);
            Strike(Left, Right, Rate, Time, { Modes: [[Root, 0.95, 1], [Root * 2.32, 0.7, 0.8], [Root * 3.71, 0.5, 0.6], [Root * 5.13, 0.32, 0.45], [Root * 7.29, 0.2, 0.3], [Root * 0.47, 0.6, 0.5]], Burst: 0.0004, Gain: 7 * Gain, Pan, Seed });
            Overpressure(Left, Right, Rate, Time, { Lasts: 0.0003, Gain: 0.15 * Gain, Low: 15000, Pan });
            Scatter(Left, Right, Rate, Time + 0.003, 0.2, 14, (N) => ({ Modes: [[N.Range(6000, 11000), 0.002, 1]], Burst: 0.0002, Gain: N.Range(0.2, 0.7) * Gain, Pan: Pan + N.Range(-0.3, 0.3) }), { Seed: Seed + 1, Bunch: 2 });
            if (Glance) Ricochet(Left, Right, Rate, Time + 0.005, { From: R(3800, 4800), To: R(1400, 1900), Seconds: R(0.6, 0.9), Gain: 0.25 * Gain, Pan, Away: Pan > 0 ? -0.9 : 0.9, Seed: Seed + 2 });
            break;
        }
        case 'Glass':
            Strike(Left, Right, Rate, Time, { Modes: [[R(2400, 3000), 0.04, 1], [R(5200, 6400), 0.03, 0.7], [R(9000, 11000), 0.015, 0.4]], Burst: 0.0004, Gain: 3 * Gain, Pan, Seed });
            Overpressure(Left, Right, Rate, Time, { Lasts: 0.0003, Gain: 0.2 * Gain, Low: 15000, Pan });
            Scatter(Left, Right, Rate, Time + 0.005, 0.7, 70, (N, P) => ({ Modes: [[N.Range(2600, 4800), N.Range(0.03, 0.09), 1], [N.Range(5600, 9000), N.Range(0.02, 0.05), 0.6]], Burst: 0.0004, Gain: N.Range(0.3, 1.4) * Gain * (1 - P * 0.5), Pan: Pan + N.Range(-0.5, 0.5) }), { Seed: Seed + 1, Bunch: 1.7 });
            break;
        case 'Water':
            // Splash: a slap and spray, the cavity's big bubble rising in pitch, then droplets plinking back.
            Roar(Left, Right, Rate, Time, 0.3, { From: 6000, To: 1400, Floor: 300, Gain: 0.45 * Gain, Attack: 0.003, Curve: 2, Grit: 0.5, Seed });
            Strike(Left, Right, Rate, Time, { Modes: [[R(170, 210), 0.03, 1]], Burst: 0.002, Gain: 2.2 * Gain, Pan, Seed: Seed + 1 });
            Bubble(Left, Right, Rate, Time + 0.025, { Hz: R(520, 700), Rise: 1.1, Decay: 0.09, Gain: 0.35 * Gain, Pan });
            {
                let At = Time + 0.12;
                for (let Drop = 0; Drop < 28; Drop++)
                {
                    At += Noise.Range(0.005, 0.045) * (1 + Drop / 14);
                    Bubble(Left, Right, Rate, At, { Hz: R(1300, 3800), Rise: R(0.5, 1.4), Decay: R(0.015, 0.04), Gain: R(0.03, 0.14) * Gain, Pan: Pan + R(-0.6, 0.6) });
                }
            }
            break;
        default: throw new Error(`Unknown material ${Material}`);
    }
}

export const Materials = ['Sand', 'Dirt', 'Rock', 'Concrete', 'Wood', 'Metal', 'Glass', 'Water'];

//------------------------------------------------------------------------------------------------------------------------
//                                                    CUES
//------------------------------------------------------------------------------------------------------------------------

const Outdoor = { Taps: [[0.11, 0.24, -0.6], [0.29, 0.17, 0.6], [0.62, 0.1, -0.2], [1.1, 0.06, 0.4]], Dark: 3500, Wash: 0.25 };

/** The sniper's bolt: lift, draw back (scrape), casing flies out, push forward, lock down, casing lands. */
function BoltCycle(Left, Right, Rate, Time)
{
    Strike(Left, Right, Rate, Time, { Modes: [[1450, 0.03, 1], [3100, 0.02, 0.6]], Burst: 0.0006, Gain: 2.5, Pan: 0.3, Seed: 501 });
    Roar(Left, Right, Rate, Time + 0.05, 0.16, { From: 5000, To: 3000, Floor: 1500, Gain: 0.12, Attack: 0.02, Curve: 0.6, Grit: 0.7, Seed: 502 });
    Strike(Left, Right, Rate, Time + 0.21, { Modes: [[980, 0.04, 1], [2200, 0.03, 0.7], [4300, 0.015, 0.4]], Burst: 0.0008, Gain: 3, Pan: 0.3, Seed: 503 });
    Roar(Left, Right, Rate, Time + 0.42, 0.13, { From: 5200, To: 3200, Floor: 1500, Gain: 0.11, Attack: 0.02, Curve: 0.6, Grit: 0.7, Seed: 504 });
    Strike(Left, Right, Rate, Time + 0.56, { Modes: [[1250, 0.035, 1], [2700, 0.025, 0.6]], Burst: 0.0008, Gain: 3, Pan: 0.3, Seed: 505 });
    Strike(Left, Right, Rate, Time + 0.66, { Modes: [[1650, 0.03, 1], [3500, 0.02, 0.5]], Burst: 0.0006, Gain: 2.4, Pan: 0.3, Seed: 506 });
    Bounce(Left, Right, Rate, Time + 0.75, { Modes: [[3600, 0.08, 1], [6900, 0.05, 0.5], [1900, 0.05, 0.3]], Hits: 4, First: 0.11, Ratio: 0.58, Gain: 1.2, Pan: 0.7, Seed: 507 });
}

export const Cues = {
    // ── Weapons ─────────────────────────────────────────────────────────────────────────────────────────────────────
    EnergyLmg: {
        Group: 'Weapons', Label: 'Energy LMG · full mag', Seconds: 5.6, Peak: 0.9,
        Draw(Left, Right, Rate) { Burst(Left, Right, Rate, 0.15, 'EnergyLmg', { Seconds: 10, Seed: 300 }); Echoes(Left, Right, Rate, Outdoor); Settle(Left, Right, Rate); },
    },
    EnergyLmgTurbo: {
        Group: 'Weapons', Label: 'Energy LMG + Turbocharger', Seconds: 4.8, Peak: 0.9,
        Draw(Left, Right, Rate) { Burst(Left, Right, Rate, 0.15, 'EnergyLmg', { Seconds: 10, Turbo: true, Seed: 700 }); Echoes(Left, Right, Rate, Outdoor); Settle(Left, Right, Rate); },
    },
    Lmg: {
        Group: 'Weapons', Label: 'LMG bursts', Seconds: 5.5, Peak: 0.9,
        Draw(Left, Right, Rate)
        {
            Burst(Left, Right, Rate, 0.1, 'Lmg', { Seconds: 1.9, Seed: 900 });
            Burst(Left, Right, Rate, 2.6, 'Lmg', { Seconds: 0.5, Seed: 1300 });
            Burst(Left, Right, Rate, 3.5, 'Lmg', { Seconds: 0.7, Seed: 1500 });
            Echoes(Left, Right, Rate, Outdoor); Settle(Left, Right, Rate);
        },
    },
    Smg: {
        Group: 'Weapons', Label: 'SMG bursts', Seconds: 4.5, Peak: 0.9,
        Draw(Left, Right, Rate)
        {
            Burst(Left, Right, Rate, 0.1, 'Smg', { Seconds: 0.25, Seed: 1700 });
            Burst(Left, Right, Rate, 0.75, 'Smg', { Seconds: 0.25, Seed: 1800 });
            Burst(Left, Right, Rate, 1.5, 'Smg', { Seconds: 2.0, Seed: 1900 });     // the rest of the 30-round magazine
            Echoes(Left, Right, Rate, Outdoor); Settle(Left, Right, Rate);
        },
    },
    Sniper: {
        Group: 'Weapons', Label: 'Sniper rifle + bolt', Seconds: 5.5, Peak: 0.94,
        Draw(Left, Right, Rate)
        {
            // .338-class rifle: a long, heavy blast, a deep thump, then the report rolling back off the valley for seconds.
            Overpressure(Left, Right, Rate, 0.1, { Lasts: 0.0045, Gain: 1.6, Low: 5000 });
            Roar(Left, Right, Rate, 0.1, 0.5, { From: 6500, To: 250, Floor: 60, Gain: 0.8, Attack: 0.0015, Curve: 2.4, Grit: 0.5, Seed: 2001 });
            Thump(Left, Right, Rate, 0.1, { Hz: 62, EndHz: 28, Decay: 0.9, Gain: 1.0, Drive: 2.4, Attack: 0.0015 });
            Roar(Left, Right, Rate, 0.25, 3.2, { From: 1100, To: 120, Floor: 40, Gain: 0.32, Attack: 0.08, Curve: 1.3, Width: 1, Grit: 0.35, Seed: 2002 });
            Echoes(Left, Right, Rate, { Taps: [[0.34, 0.32, -0.7], [0.78, 0.22, 0.6], [1.3, 0.14, -0.2], [2.1, 0.08, 0.5]], Dark: 2200, Wash: 0.4 });
            BoltCycle(Left, Right, Rate, 2.6);
            Settle(Left, Right, Rate);
        },
    },
    Turret: {
        Group: 'Weapons', Label: 'Turret: wake, track, fire', Seconds: 6.0, Peak: 0.9,
        Draw(Left, Right, Rate)
        {
            // Wake: servo traverse whir, three lock-on pips, then a 2.4 s burst with the feed motor and a spin-down.
            Whine(Left, Right, Rate, 0.1, 0.9, { From: 160, To: 420, Gain: 0.12, Curve: 0.8, Harmonics: [1, 0.5, 0.35, 0.2, 0.12], Shape: (P) => Smoothstep(0, 0.15, P) * (1 - Smoothstep(0.8, 1, P)), Wobble: 0.01 });
            Strike(Left, Right, Rate, 1.0, { Modes: [[620, 0.03, 1], [1450, 0.02, 0.6]], Burst: 0.001, Gain: 2.5, Seed: 2101 });
            for (let Pip = 0; Pip < 3; Pip++) Whine(Left, Right, Rate, 1.15 + Pip * 0.16, 0.07, { From: 2400, To: 2400, Gain: 0.08, Curve: 1, Harmonics: [1, 0.2], Wobble: 0 });
            Whine(Left, Right, Rate, 1.63, 0.2, { From: 3200, To: 3200, Gain: 0.08, Curve: 1, Harmonics: [1, 0.2], Wobble: 0 });
            Burst(Left, Right, Rate, 1.95, 'Turret', { Seconds: 2.4, Seed: 2200 });
            Echoes(Left, Right, Rate, Outdoor); Settle(Left, Right, Rate);
        },
    },
    Cannon: {
        Group: 'Weapons', Label: 'Tank cannon', Seconds: 7.0, Peak: 0.94,
        Draw(Left, Right, Rate)
        {
            // 120 mm: a long blast wave, a chest-deep thump, the fireball roar, echoes for seconds; then the breech
            // opens with a heavy clank and the spent case stub clangs onto the turret floor.
            Overpressure(Left, Right, Rate, 0.1, { Lasts: 0.022, Gain: 2.0, Low: 2200 });
            Thump(Left, Right, Rate, 0.1, { Hz: 48, EndHz: 18, Decay: 3.0, Gain: 1.3, Drive: 2.8, Attack: 0.003 });
            Roar(Left, Right, Rate, 0.1, 3.6, { From: 3200, To: 80, Floor: 20, Gain: 0.9, Attack: 0.004, Curve: 2.2, Grit: 0.6, Seed: 2301 });
            Strike(Left, Right, Rate, 0.12, { Modes: [[85, 0.4, 1], [190, 0.3, 0.7], [410, 0.2, 0.4]], Burst: 0.01, Gain: 2.5, Seed: 2302 });   // the hull rings
            Echoes(Left, Right, Rate, { Taps: [[0.42, 0.4, -0.7], [0.95, 0.28, 0.6], [1.6, 0.18, -0.3], [2.5, 0.1, 0.5]], Dark: 1300, Wash: 0.5 });
            Strike(Left, Right, Rate, 4.2, { Modes: [[260, 0.15, 1], [640, 0.09, 0.7], [1500, 0.05, 0.4]], Burst: 0.002, Gain: 4, Pan: 0.2, Seed: 2303 });
            Bounce(Left, Right, Rate, 4.55, { Modes: [[520, 0.35, 1], [1380, 0.25, 0.6], [2650, 0.15, 0.4]], Hits: 4, First: 0.22, Ratio: 0.55, Gain: 3.2, Pan: 0.4, Seed: 2304 });
            Settle(Left, Right, Rate);
        },
    },
    AutoCannon: {
        Group: 'Weapons', Label: 'Autocannon', Seconds: 5.0, Peak: 0.92,
        Draw(Left, Right, Rate)
        {
            Burst(Left, Right, Rate, 0.1, 'AutoCannon', { Seconds: 1.4, Seed: 2400 });
            Burst(Left, Right, Rate, 2.2, 'AutoCannon', { Seconds: 0.6, Seed: 2500 });
            Echoes(Left, Right, Rate, { Taps: [[0.3, 0.32, -0.6], [0.7, 0.2, 0.6], [1.3, 0.12, 0]], Dark: 1800, Wash: 0.4 }); Settle(Left, Right, Rate);
        },
    },

    // ── Bullets ─────────────────────────────────────────────────────────────────────────────────────────────────────
    Supersonic: {
        Group: 'Bullets', Label: 'Supersonic crack + far report', Seconds: 4.5, Peak: 0.9,
        Draw(Left, Right, Rate, { Distance = 400 } = {})
        {
            // Downrange of a rifle: each round's shock wave cracks past first; the muzzle report, slower than the
            // bullet, arrives later (Distance / 343 − Distance / 800 s), dull and echoing.
            const Lag = Distance / 343 - Distance / 800;
            const Rounds = [[0.15, 0.00028, 1, -0.4], [1.3, 0.00034, 0.8, 0.5], [1.75, 0.00024, 1, 0.1]];
            for (const [Time, Lasts, Gain, Pan] of Rounds)
            {
                Snap(Left, Right, Rate, Time, { Lasts, Gain, Pan });
                Roar(Left, Right, Rate, Time + 0.0005, 0.05, { From: 9000, To: 3500, Floor: 2000, Gain: 0.15 * Gain, Attack: 0.0005, Curve: 2, Grit: 0.8, Seed: Math.round(Time * 100) });
                Overpressure(Left, Right, Rate, Time + Lag, { Lasts: 0.004, Gain: 0.35, Low: 1500, Pan: Pan * 0.3 });
                Thump(Left, Right, Rate, Time + Lag, { Hz: 70, EndHz: 35, Decay: 0.5, Gain: 0.25, Drive: 1.5 });
                Roar(Left, Right, Rate, Time + Lag, 1.4, { From: 1200, To: 150, Floor: 50, Gain: 0.15, Attack: 0.01, Curve: 1.6, Seed: Math.round(Time * 100) + 7 });
            }
            Echoes(Left, Right, Rate, { Taps: [[0.4, 0.15, 0.6], [0.9, 0.09, -0.6]], Dark: 1500, Wash: 0.2 });
            Settle(Left, Right, Rate);
        },
    },
    Whizz: {
        Group: 'Bullets', Label: 'Subsonic whizz-by', Seconds: 2.6, Peak: 0.85,
        Draw(Left, Right, Rate)
        {
            Whizz(Left, Right, Rate, 0.1, { From: 3000, To: 1100, Seconds: 0.24, Gain: 0.5, Pan: -1, EndPan: 1, Seed: 2601 });
            Whizz(Left, Right, Rate, 0.85, { From: 2500, To: 950, Seconds: 0.3, Gain: 0.35, Pan: 1, EndPan: -0.6, Seed: 2602 });
            Whizz(Left, Right, Rate, 1.4, { From: 3400, To: 1300, Seconds: 0.18, Gain: 0.6, Pan: -0.7, EndPan: 1, Seed: 2603 });
            Settle(Left, Right, Rate);
        },
    },
    Ricochet: {
        Group: 'Bullets', Label: 'Ricochets', Seconds: 3.0, Peak: 0.85,
        Draw(Left, Right, Rate)
        {
            DrawHit(Left, Right, Rate, 0.1, 'Rock', 2701, { Pan: -0.3, Bounce: true });
            DrawHit(Left, Right, Rate, 1.2, 'Metal', 2702, { Pan: 0.4, Bounce: true, Gain: 0.8 });
            DrawHit(Left, Right, Rate, 2.0, 'Concrete', 2703, { Pan: 0, Bounce: true });
            Echoes(Left, Right, Rate, { Taps: [[0.12, 0.18, 0.6], [0.31, 0.1, -0.6]], Dark: 4000, Wash: 0.15 });
            Settle(Left, Right, Rate);
        },
    },
    ...Object.fromEntries(Materials.map((Material, Index) => [`Hit${Material}`, {
        Group: 'Impacts', Label: `Bullet into ${Material.toLowerCase()}`, Seconds: Material === 'Metal' ? 1.6 : 1.2, Peak: 0.85,
        Draw(Left, Right, Rate) { DrawHit(Left, Right, Rate, 0.03, Material, 3000 + Index * 37); Settle(Left, Right, Rate); },
    }])),
};

/** Renders one cue into fresh stereo buffers, normalized so its loudest sample sits at the cue's Peak. */
export function RenderCue(Name, Rate, Options = {})
{
    const Cue = Cues[Name];
    if (!Cue) throw new Error(`Unknown cue ${Name}`);
    const Seconds = Options.Seconds ?? Cue.Seconds;
    const Left = new Float32Array(Math.ceil(Seconds * Rate)), Right = new Float32Array(Left.length);
    Cue.Draw(Left, Right, Rate, { ...Options, Seconds });
    return Finish(Left, Right, Rate, Options.Peak ?? Cue.Peak ?? 0.9, Seconds);
}

function Finish(Left, Right, Rate, Peak, Seconds)
{
    let Loudest = 0;
    for (let Index = 0; Index < Left.length; Index++) Loudest = Math.max(Loudest, Math.abs(Left[Index]), Math.abs(Right[Index]));
    const Scale = Loudest > 0 ? Peak / Loudest : 1, Fade = Math.round(0.06 * Rate);
    for (let Index = 0; Index < Left.length; Index++)
    {
        const Tail = Math.min(1, (Left.length - 1 - Index) / Fade);
        Left[Index] *= Scale * Tail; Right[Index] *= Scale * Tail;
    }
    return { Left, Right, Seconds, Scale };
}

/**
 * One shot with its own short outdoor tail, for the live bench's hold-to-fire scheduler. All shots of a weapon share
 * one gain (Level) so variants match; returns { Left, Right }.
 */
export function RenderShot(Name, Rate, Seed = 1)
{
    const Seconds = Weapons[Name].Brass ? 1.1 : 0.8;
    const Left = new Float32Array(Math.ceil(Seconds * Rate)), Right = new Float32Array(Left.length);
    DrawShot(Left, Right, Rate, 0.005, Name, 5000 + Seed * 13);
    Echoes(Left, Right, Rate, { ...Outdoor, Taps: Outdoor.Taps.slice(0, 3), Wash: 0.18 });
    Settle(Left, Right, Rate);
    for (let Index = 0; Index < Left.length; Index++) { Left[Index] *= 0.32; Right[Index] *= 0.32; }
    return { Left, Right };
}

/**
 * A one-second seamless loop of the weapon's spin motor at its top fire rate (every partial completes whole cycles),
 * so the bench can loop it and set playbackRate = rate / top rate as the spin builds and decays.
 */
export function RenderMotor(Name, Rate, Turbo = false)
{
    const W = Weapons[Name], Motor = W.Motor, Top = (Turbo && W.Turbo ? W.Turbo.Rate : W.Rate)[1];
    const Left = new Float32Array(Rate), Right = new Float32Array(Rate);
    const Fundamental = Math.round(Top * Motor.Hz), Barrels = Math.round(Top * Motor.Barrels), Whistle = Math.round(2800 + Top * 360);
    const Clatter = new Resonator(Rate, 2600, 0.01), Clatter2 = new Resonator(Rate, 4100, 0.008);
    // Run the clatter resonators one lap first so the loop seam carries their ringing.
    for (let Lap = 0; Lap < 2; Lap++)
        for (let Index = 0; Index < Rate; Index++)
        {
            const Time = Index / Rate;
            let Out = (Math.sin(Tau * Fundamental * Time) * 0.6 + Math.sin(Tau * 2 * Fundamental * Time) * 0.35 + Math.sin(Tau * 3 * Fundamental * Time) * 0.2 + Math.sin(Tau * 5 * Fundamental * Time) * 0.1) * Motor.Gain;
            if (Barrels)
            {
                const Kick = Math.floor(Time * Barrels) !== Math.floor((Index - 1) / Rate * Barrels) ? 0.8 : 0;
                Out += (Clatter.Run(Kick) + Clatter2.Run(Kick) * 0.6) / Clatter.Norm * 0.0045;
            }
            if (Turbo && W.Turbo) Out += Math.sin(Tau * Whistle * Time) * 0.022;
            if (Lap === 1) { Left[Index] = Out * 0.32; Right[Index] = Out * 0.3; }
        }
    return { Left, Right, Top };
}

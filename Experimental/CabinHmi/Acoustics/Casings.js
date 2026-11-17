// CASINGS
// 🧩 Spent shell casings falling: each case is a thin brass (or plastic, or steel) tube that rings its own modes when it
//    hits, bounces with the floor's restitution (flight times from real drop physics, so the gaps shrink like a real
//    bounce series), lands mouth-first (rings) or head-first (dull click) at random, then rolls with a rim tick per turn
//    and a rough-surface rattle until it stops. The floor answers too: concrete thock, hollow wooden deck, ringing steel
//    plate, soft dirt that kills the ring and crunches.
// 📝 Case and floor figures are typical values, not measurements (smaller cases ring higher: a 9 mm case near 9 kHz, a
//    .50 BMG case near 2.5 kHz, a 120 mm stub near 500 Hz). Used by Ballistics for the brass after every shot and by the
//    Shells cues. Original synthesis: nothing is sampled.

import { Tau, Clamp, SeededNoise, Biquad, Resonator, PanGains, Strike } from './SignalKit.js';

const Gravity = 9.81;

/**
 * Case recipes. Modes: [Hz, decay s, level] for a mouth-end strike; Mass scales the floor's answer; Diameter (m) sets
 * the roll rate; Roll is the roll time in seconds on a hard floor (0 = it does not roll); Gain balances the cases.
 */
export const Shells = {
    Pistol:   { Label: '9 mm pistol case',   Modes: [[9400, 0.045, 1], [13800, 0.03, 0.5], [6100, 0.03, 0.35]], Mass: 0.25, Diameter: 0.0099, Roll: 0.55, Gain: 1.0 },
    Rifle556: { Label: '5.56 mm rifle case', Modes: [[6400, 0.07, 1], [10100, 0.05, 0.5], [4200, 0.04, 0.3]], Mass: 0.4, Diameter: 0.0096, Roll: 0.7, Gain: 1.0 },
    Rifle762: { Label: '7.62 mm rifle case', Modes: [[4600, 0.09, 1], [8300, 0.06, 0.5], [2900, 0.05, 0.35]], Mass: 0.6, Diameter: 0.012, Roll: 0.8, Gain: 1.0 },
    Fifty:    { Label: '.50 BMG case',       Modes: [[2500, 0.18, 1], [4900, 0.11, 0.6], [7700, 0.06, 0.3], [1350, 0.08, 0.25]], Mass: 1.2, Diameter: 0.0204, Roll: 1.0, Gain: 1.1 },
    Shotgun:  { Label: '12-gauge shell',     Modes: [[1700, 0.01, 1], [3100, 0.008, 0.6], [5800, 0.015, 0.35]], Mass: 0.5, Diameter: 0.0207, Roll: 0.6, Gain: 1.6, Hollow: true },
    Cannon30: { Label: '30 mm cannon case',  Modes: [[1250, 0.35, 1], [3300, 0.2, 0.6], [5600, 0.1, 0.3], [620, 0.15, 0.3]], Mass: 3, Diameter: 0.044, Roll: 0.9, Gain: 1.2 },
    TankStub: { Label: '120 mm case stub',   Modes: [[520, 0.5, 1], [1380, 0.3, 0.6], [2650, 0.18, 0.4], [3900, 0.1, 0.2]], Mass: 6, Diameter: 0.15, Roll: 0.6, Gain: 1.4 },
    Link:     { Label: 'Belt link',          Modes: [[3100, 0.02, 1], [4700, 0.015, 0.6], [7300, 0.01, 0.3]], Mass: 0.3, Diameter: 0.01, Roll: 0, Gain: 0.7 },
};

/**
 * Floors. Bounce: restitution (rebound speed ÷ impact speed); Ring: how much of the case's ring survives the contact;
 * Contact: contact time in seconds (soft floors are slower, so duller); Thud: the floor's own modes; Grit: crunch noise
 * level (loose ground); Rough: rolling rattle level (0 = the case does not roll).
 */
export const Floors = {
    Concrete: { Label: 'Concrete', Bounce: 0.3, Ring: 1, Contact: 0.00012, Thud: [[160, 0.012, 1], [700, 0.006, 0.5]], ThudGain: 0.35, Grit: 0, Rough: 1 },
    Wood:     { Label: 'Wooden deck', Bounce: 0.24, Ring: 0.55, Contact: 0.0003, Thud: [[230, 0.05, 1], [610, 0.03, 0.6], [1180, 0.018, 0.35]], ThudGain: 2.6, Grit: 0, Rough: 0.55 },
    Metal:    { Label: 'Steel floor', Bounce: 0.34, Ring: 1.1, Contact: 0.0001, Thud: [[740, 0.3, 1], [1630, 0.2, 0.6], [2920, 0.14, 0.4], [4470, 0.09, 0.25]], ThudGain: 1.5, Grit: 0, Rough: 0.9 },
    Dirt:     { Label: 'Dirt', Bounce: 0.08, Ring: 0.08, Contact: 0.0025, Thud: [[110, 0.02, 1], [380, 0.012, 0.4]], ThudGain: 1.6, Grit: 0.5, Rough: 0 },
};

/**
 * Drops one case onto a floor at Time from Height metres. Returns the time it comes to rest. Gain is the level of the
 * first impact; Seed varies the tumble (which end lands, flight times, roll length).
 */
export function DropCasing(Left, Right, Rate, Time, ShellName, FloorName = 'Concrete', { Seed = 1, Gain = 1, Pan = 0, Height = 1.2 } = {})
{
    const Shell = Shells[ShellName], Floor = Floors[FloorName], Noise = new SeededNoise(Seed);
    const Impact = Math.sqrt(2 * Gravity * Height);
    let Speed = Impact * Noise.Range(0.85, 1.1), When = Time;
    for (let Hit = 0; Hit < 9; Hit++)
    {
        const Energy = Gain * Shell.Gain * Math.pow(Speed / Impact, 0.8);
        const Mouth = Noise.Next() < 0.55;                              // the thin mouth rings; the thick head clicks
        const Modes = Shell.Modes.map(([Hz, Decay, Level], Order) => [
            Hz * (1 + Noise.Gauss() * 0.006), Decay * Floor.Ring * (Mouth ? 1 : 0.5), Level * (Mouth ? 1 : Order === 0 ? 0.55 : 0.3)]);
        Strike(Left, Right, Rate, When, { Modes, Burst: Floor.Contact * (Shell.Hollow ? 3 : 1), Gain: Energy * 9, Pan, Seed: Seed * 31 + Hit });
        Strike(Left, Right, Rate, When, {
            Modes: Floor.Thud, Burst: Floor.Contact * 2, Gain: Energy * Floor.ThudGain * Shell.Mass * (Shell.Hollow ? 2.5 : 1) * 2.4, Pan, Seed: Seed * 37 + Hit,
            Breath: Floor.Grit ? { Low: 500, High: 4500, Decay: 0.04, Gain: Floor.Grit * 0.4 } : null,
        });
        const Flight = 2 * Floor.Bounce * Speed / Gravity * Noise.Range(0.6, 1.2);
        Speed *= Floor.Bounce * Noise.Range(0.85, 1.15);
        if (Flight < 0.01 || Speed < 0.15) { When += Flight; break; }
        When += Flight;
    }
    if (Shell.Roll && Floor.Rough) When = RollCasing(Left, Right, Rate, When, Shell, Floor, Gain * Shell.Gain, Pan, Noise);
    return When;
}

/**
 * Rolling: the case turns about its axis at speed ÷ (π × diameter) while it slows to a stop; every turn the rim (or a
 * flat spot) knocks once, and the rough floor excites the case modes continuously in between. A tapered case rolls in
 * an arc, so the pan drifts a little.
 */
function RollCasing(Left, Right, Rate, Time, Shell, Floor, Gain, Pan, Noise)
{
    const Seconds = Shell.Roll * Floor.Rough * Noise.Range(0.6, 1.25), Start = Math.round(Time * Rate);
    const Count = Math.min(Left.length - Start, Math.round(Seconds * Rate));
    if (Count <= 0) return Time;
    const Rings = Shell.Modes.map(([Hz, Decay]) => new Resonator(Rate, Hz, Decay * 0.35 * Floor.Ring));
    const Levels = Shell.Modes.map((Mode) => Mode[2]);
    const Rough = new Biquad(Rate).Shape('High', 1200, 0.7), Rolling = Noise.Range(0.35, 0.6), Drift = Noise.Range(-0.3, 0.3);
    let Turn = Noise.Next();
    for (let Index = 0; Index < Count; Index++)
    {
        const Progress = Index / Count, Speed = Rolling * (1 - Progress);
        Turn += Speed / (Math.PI * Shell.Diameter) / Rate;
        const Knock = Turn >= 1 ? (Turn -= 1, Noise.Range(0.5, 1) * 18) : 0;
        const Excite = (Rough.Run(Noise.White()) * 1.4 * (0.6 + 0.4 * Math.sin(Tau * Turn)) + Knock) * Speed;
        let Out = 0;
        for (let Mode = 0; Mode < Rings.length; Mode++) Out += Rings[Mode].Run(Excite) * Levels[Mode];
        Out *= Gain * 0.9 * Clamp(Index / (0.01 * Rate), 0, 1);
        const [GainL, GainR] = PanGains(Clamp(Pan + Drift * Progress, -1, 1));
        Left[Start + Index] += Out * GainL; Right[Start + Index] += Out * GainR;
    }
    return Time + Seconds;
}

/**
 * A stream of cases from a burst (Times = ejection times), landing around the shooter; later cases fall onto the pile
 * and clink off the cases already there. Belt-fed guns drop a link with every case. Returns the last rest time.
 */
export function CasingRain(Left, Right, Rate, Times, ShellName, FloorName = 'Concrete', { Seed = 1, Gain = 1, Pan = 0.5, Links = false, Fall = 0.45 } = {})
{
    const Noise = new SeededNoise(Seed);
    let Rest = 0;
    Times.forEach((At, Index) =>
    {
        const Land = At + Fall * Noise.Range(0.8, 1.2), Spot = Clamp(Pan + Noise.Gauss() * 0.25, -1, 1);
        const Level = Gain * Noise.Range(0.6, 1);
        Rest = Math.max(Rest, DropCasing(Left, Right, Rate, Land, ShellName, FloorName, { Seed: Seed + Index * 7, Gain: Level, Pan: Spot, Height: Noise.Range(0.9, 1.4) }));
        if (Index > 4 && Noise.Next() < 0.4)                               // glances off a case already lying there
            Strike(Left, Right, Rate, Land + Noise.Range(0.003, 0.02), { Modes: Shells[ShellName].Modes.map(([Hz, Decay, Part]) => [Hz * Noise.Range(0.97, 1.03), Decay * 0.6, Part]), Burst: 0.0002, Gain: Level * 4, Pan: Spot, Seed: Seed + Index * 13 });
        if (Links) DropCasing(Left, Right, Rate, Land + Noise.Range(-0.05, 0.08), 'Link', FloorName, { Seed: Seed + Index * 11 + 5, Gain: Level * 0.8, Pan: Clamp(Spot - 0.3, -1, 1), Height: 0.9 });
    });
    return Rest;
}

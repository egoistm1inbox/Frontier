// PULSE TRAIN ENGINE
// 🧩 Engine sound from first principles: a crank angle advances with engine speed, every cylinder that fires drops an
//    exhaust blowdown pulse into its bank's header, and each bank's pulse train rings through a header pipe (or a
//    turbine), a cross-feed, a tail pipe, the muffler (with bypass valves) and the body's formants. Intake pulses ring an
//    airbox and runner resonance; valvetrain and injector ticks, gear whine and shift clunks, turbo spool, whistle,
//    blow-off and surge flutter, the hybrid motor and the starter are added on top, then a few early reflections.
// 📝 The engine order content is not drawn: it falls out of the firing pattern. A 65° V12 with shared crank pins fires
//    with uneven 65° / 55° gaps (6th order plus a 3rd-order bank rasp); an even-fire 60° V6 alternates banks every 120°
//    (3rd order, each bank at 1.5). Every cylinder has its own strength, timing and pulse shape (its header runner), and
//    each combustion varies cycle to cycle, so the half orders that make an engine sound alive are present.

import { Tau, Clamp, Mix, Smoothstep, SeededNoise, OnePole, Biquad, ModeBank, DcBlock, DelayLine, PipeSection, Slew, PanGains, SoftClip } from './SignalKit.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    PROFILES
//------------------------------------------------------------------------------------------------------------------------

/**
 * Ferrari LaFerrari: F140FE 6.3 L naturally aspirated 65° V12, direct injection, HY-KERS motor on the gearbox, 7-speed
 * dual-clutch. Idle about 1000 rpm, limiter 9250 rpm, 800 cv at 9000 rpm, 700 Nm at 6750 rpm, ~270 Nm electric.
 * Pipe lengths, formants and runner spread are tuned by ear and measurement to a high, clean but raspy wail.
 */
export const LaFerrari = {
    Name: 'Ferrari LaFerrari', Code: 'F140FE V12 + HY-KERS',
    Cylinders: 12, BankOffset: 65, Idle: 1000, ColdIdle: 1320, Limiter: 9250, Redline: 9000,
    Header: [0.62, 0.66], Tail: [1.85, 1.98], GasSpeed: 560, CrossFeed: 0.18,
    Formants: [[170, 1.1, 2.5], [560, 1.6, 1.5], [1350, 2.2, 3.5], [2650, 2.6, 4.5], [4300, 3, 1.5]],
    ValveRpm: 3300, Intake: { Box: 118, Runner: 780, Howl: 1700 },
    Spread: 0.17, Lean: 2.6, Shape: 0.22, Jitter: [0.26, 0.08], Burble: 0.75,
    Valvetrain: 0.055, Injector: 0.03, Space: 0.24,
    Torque: [[800, 380], [2000, 470], [3000, 550], [4000, 600], [5000, 645], [6000, 685], [6750, 700], [8000, 690], [9000, 650], [9400, 560]],
    Motor: { Order: 8, Carrier: 9100, Torque: 270 }, Turbo: null,
    Gearbox: { Teeth: [31, 28, 26, 24, 23, 22, 21], Whine: 0.005, Clunk: 0.35, Cut: 0.045, Swap: 0.07 },
    Ratios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], Final: 4.44, TyreRadius: 0.357, Mass: 1585 + 75, DragArea: 0.82,
    Drive: { Share: 0.6, Launch: 4300 }, Pops: 1,
};

/**
 * Nissan GT-R NISMO (R35): VR38DETT 3.8 L 60° V6, twin IHI turbos, port injection, GR6 6-speed dual-clutch rear
 * transaxle, ATTESA E-TS all-wheel drive. 600 PS at 6800 rpm, 652 Nm from 3600 to 5600 rpm, redline 7100 rpm
 * (Nissan spec sheet). Even firing every 120°, banks alternate; turbines soften the pulses; the titanium NISMO exhaust
 * merges both banks (strong cross-feed). The transaxle's gear whine and shift clunks are part of the character.
 */
export const GtrNismo = {
    Name: 'Nissan GT-R NISMO', Code: 'VR38DETT twin-turbo V6',
    Cylinders: 6, BankOffset: 120, Idle: 780, ColdIdle: 1150, Limiter: 7100, Redline: 6900,
    Header: [0.42, 0.45], Tail: [2.25, 2.32], GasSpeed: 520, CrossFeed: 0.55,
    Formants: [[105, 1.0, 3.5], [330, 1.3, 3], [820, 1.8, 2.5], [1750, 2.4, 2.5], [3300, 3, 1]],
    ValveRpm: 2900, Intake: { Box: 92, Runner: 540, Howl: 1250 },
    Spread: 0.2, Lean: 3.2, Shape: 0.25, Jitter: [0.3, 0.14], Burble: 0.6,
    Valvetrain: 0.05, Injector: 0, Space: 0.24,
    Torque: [[750, 300], [1500, 400], [2500, 560], [3300, 640], [3600, 652], [5600, 652], [6200, 640], [6800, 618], [7200, 540]],
    Motor: null,
    Turbo: { Onset: 1700, Full: 3300, Lag: 0.5, Unboosted: 0.55, Whistle: [4200, 8600], Tone: 0.02, Spool: 0.07, Vent: 0.75, Flutter: 0.4, Muffle: 2400 },
    Gearbox: { Teeth: [29, 25, 23, 21, 19, 18], Whine: 0.016, Clunk: 1, Cut: 0.06, Swap: 0.12 },
    Ratios: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796], Final: 3.7, TyreRadius: 0.354, Mass: 1740 + 75, DragArea: 0.6,
    Drive: { Share: 0.95, Launch: 3900 }, Pops: 0.4, Level: 0.5,
};

/**
 * Dodge Challenger SRT Demon (2018): supercharged 6.2 L HEMI V8 with a 2.7 L twin-screw blower at 14.5 psi, 840 hp at
 * 6300 rpm and 770 lb-ft (1044 Nm) at 4500 rpm on high-octane fuel, 6500 rpm limit, TorqueFlite 8HP90 eight-speed
 * automatic with TransBrake (launch held at up to 2350 rpm), 0–60 mph 2.3 s, quarter mile 9.65 s at 140 mph (Dodge press
 * kit). Cross-plane crank, firing order 1-8-4-3-6-5-7-2: each bank fires unevenly (90/180/270° gaps), which is the V8
 * burble; long headers, little cross-feed. Stock names the blower voice (ForcedInduction), which the torque table includes.
 * Gear ratios are the 8HP90's; final drive, drag area and pipe lengths are typical values.
 */
export const Demon = {
    Name: 'Dodge Challenger SRT Demon', Code: '6.2 L supercharged HEMI V8',
    Cylinders: 8, BankOffset: 0, BankAngles: [[0, 270, 450, 540], [90, 180, 360, 630]], Idle: 760, ColdIdle: 1150, Limiter: 6500, Redline: 6300,
    Header: [0.82, 0.86], Tail: [2.7, 2.8], GasSpeed: 500, CrossFeed: 0.08,
    Formants: [[85, 1.0, 4], [240, 1.2, 3.2], [600, 1.6, 2.5], [1300, 2.2, 2], [2700, 2.8, 1]],
    ValveRpm: 2200, Intake: { Box: 80, Runner: 400, Howl: 900 },
    Spread: 0.24, Lean: 3.8, Shape: 0.27, Jitter: [0.34, 0.12], Burble: 0.95,
    Valvetrain: 0.04, Injector: 0.015, Space: 0.24,
    Torque: [[760, 430], [1500, 640], [2500, 840], [3500, 975], [4500, 1044], [5500, 1010], [6300, 949], [6600, 820]],
    Motor: null, Turbo: null, Stock: 'DemonScrew',
    Gearbox: { Teeth: [37, 33, 30, 28, 26, 24, 23, 21], Whine: 0.004, Clunk: 0.5, Cut: 0.05, Swap: 0.11 },
    Ratios: [4.71, 3.14, 2.10, 1.67, 1.29, 1.0, 0.84, 0.67], Final: 3.09, TyreRadius: 0.355, Mass: 1938 + 75, DragArea: 0.9,
    Drive: { Share: 0.62, Launch: 2350, Grip: 2.9 }, Pops: 0.5, Level: 0.55,   // Grip: drag radials + weight transfer (1.8 g launch)
};

/**
 * Porsche 918 Spyder (2013–2015), the hybrid in Porsche's 2020 Super Bowl advert "The Heist": 4.6 L naturally aspirated
 * V8 derived from the RS Spyder race engine, flat-plane crank (each bank fires evenly every 180°, the scream of two
 * racing four-cylinders), 608 hp at 8600 rpm, 530 Nm at 6600 rpm, 9150 rpm limit, top-exit exhaust straight out of the
 * engine deck (short pipes, bright and loud), 115 kW hybrid module between engine and the 7-speed PDK, 95 kW front-axle
 * motor through its own gear, decoupled above 235 km/h; 887 hp combined (Porsche press kit; PDK ratios and 3.09 final
 * drive from it). Front gear ratio, motor orders, pipe lengths and drag area are typical values.
 */
export const Spyder918 = {
    Name: 'Porsche 918 Spyder', Code: '4.6 L flat-plane V8 + 2 motors',
    Cylinders: 8, BankOffset: 90, Idle: 950, ColdIdle: 1350, Limiter: 9150, Redline: 9000,
    Header: [0.46, 0.48], Tail: [0.95, 1.0], GasSpeed: 580, CrossFeed: 0.25,
    Formants: [[150, 1.1, 2.5], [480, 1.5, 2], [1150, 2.0, 3.5], [2400, 2.6, 4], [4600, 3, 2]],
    ValveRpm: 3600, Intake: { Box: 125, Runner: 820, Howl: 1800 },
    Spread: 0.15, Lean: 2.4, Shape: 0.2, Jitter: [0.24, 0.07], Burble: 0.65,
    Valvetrain: 0.06, Injector: 0.03, Space: 0.24,
    Torque: [[900, 300], [2000, 380], [3000, 430], [4000, 470], [5000, 500], [6600, 530], [7500, 522], [8600, 496], [9300, 420]],
    Motor: { Order: 8, Carrier: 10000, Torque: 230, Front: { Torque: 210, Ratio: 8.7, Power: 95000, Cutoff: 65.3, Order: 6 } }, Turbo: null,
    Gearbox: { Teeth: [33, 29, 27, 25, 23, 22, 21], Whine: 0.005, Clunk: 0.3, Cut: 0.04, Swap: 0.065 },
    Ratios: [3.91, 2.29, 1.58, 1.19, 0.97, 0.83, 0.67], Final: 3.09, TyreRadius: 0.355, Mass: 1674 + 75, DragArea: 0.92,
    Drive: { Share: 0.95, Launch: 4200, Grip: 1.4 }, Pops: 0.7, Level: 0.6,
};

/**
 * Koenigsegg Agera R (2011–2014), the car of the 2014 Need for Speed film (the hero's silver car and the De Leon racers;
 * the crash cars were replicas): 5.0 L twin-turbo flat-plane V8, 1140 hp at 7100 rpm on E85, 1200 Nm at 4100 rpm,
 * 7-speed paddle-shift dual-clutch, rear drive, 1435 kg, final drive 3.364 (spec sheets). Big dump valves chirp on every
 * lift. Gear ratios are chosen to reach its ~440 km/h (Koenigsegg does not publish them); pipe lengths typical.
 */
export const AgeraR = {
    Name: 'Koenigsegg Agera R', Code: '5.0 L twin-turbo flat-plane V8',
    Cylinders: 8, BankOffset: 90, Idle: 900, ColdIdle: 1300, Limiter: 7500, Redline: 7250,
    Header: [0.5, 0.53], Tail: [1.5, 1.56], GasSpeed: 540, CrossFeed: 0.4,
    Formants: [[120, 1.0, 3.5], [380, 1.4, 3], [900, 1.9, 3], [1900, 2.5, 3], [3800, 3, 1.5]],
    ValveRpm: 3000, Intake: { Box: 100, Runner: 600, Howl: 1400 },
    Spread: 0.18, Lean: 3, Shape: 0.24, Jitter: [0.28, 0.1], Burble: 0.7,
    Valvetrain: 0.05, Injector: 0.02, Space: 0.24,
    Torque: [[850, 380], [1500, 560], [2500, 1000], [3400, 1150], [4100, 1200], [5800, 1200], [7100, 1143], [7600, 980]],
    Motor: null,
    Turbo: { Onset: 2000, Full: 3500, Lag: 0.55, Unboosted: 0.42, Whistle: [3800, 9200], Tone: 0.024, Spool: 0.08, Vent: 1.0, Flutter: 0.2, Muffle: 2600 },
    Gearbox: { Teeth: [31, 28, 26, 24, 23, 22, 21], Whine: 0.008, Clunk: 0.6, Cut: 0.05, Swap: 0.09 },
    Ratios: [2.92, 1.98, 1.50, 1.18, 0.95, 0.79, 0.65], Final: 3.364, TyreRadius: 0.35, Mass: 1435 + 75, DragArea: 0.72,
    Drive: { Share: 0.6, Launch: 3800, Grip: 1.6 }, Pops: 0.6, Level: 0.5,
};

export const Profiles = { LaFerrari, GtrNismo, Demon, Spyder918, AgeraR };

/** Engine torque (Nm) at full throttle (and full boost) for an engine speed, from the profile's table. */
export function FullTorque(Profile, Rpm)
{
    const Table = Profile.Torque;
    if (Rpm <= Table[0][0]) return Table[0][1] * Rpm / Table[0][0];
    for (let Index = 1; Index < Table.length; Index++)
        if (Rpm <= Table[Index][0])
        {
            const [R0, T0] = Table[Index - 1], [R1, T1] = Table[Index];
            return T0 + (T1 - T0) * (Rpm - R0) / (R1 - R0);
        }
    return Table[Table.length - 1][1];
}

/** Boost (0–1) a turbo engine settles at for a throttle and engine speed. */
export const BoostTarget = (Profile, Rpm, Throttle) => Profile.Turbo ? Math.pow(Clamp(Throttle, 0, 1), 1.5) * Smoothstep(Profile.Turbo.Onset, Profile.Turbo.Full, Rpm) : 0;

//------------------------------------------------------------------------------------------------------------------------
//                                                    PIECES
//------------------------------------------------------------------------------------------------------------------------

/** One cylinder bank: its firing slots, live pulses, header and tail pipes, per-cylinder character and pops. */
class Bank
{
    constructor(Rate, Profile, Side, Noise)
    {
        this.Slots = Profile.Cylinders / 2;
        this.SlotAngle = 720 / this.Slots;
        this.Offset = Side * Profile.BankOffset;
        // Uneven firing (cross-plane V8): explicit slot angles per bank within the 720° cycle; else evenly spaced.
        this.Angles = Profile.BankAngles ? Profile.BankAngles[Side] : Array.from({ length: this.Slots }, (_, Slot) => Slot * this.SlotAngle);
        this.Gaps = this.Angles.map((Angle, Slot) => ((Angle - this.Angles[(Slot + this.Slots - 1) % this.Slots]) % 720 + 720) % 720 || 720);
        this.Slot = -1;
        this.Pulse = { Amp: 0, Shift: 0, Attack: 10, Decay: 30, Rough: 0 };
        this.Tail = { Amp: 0, Shift: 0, Attack: 10, Decay: 30, Rough: 0 };
        this.Pop = { Amp: 0, At: 999, Crackle: 0, Age: 0 };
        this.Header = new PipeSection(Rate, Profile.Header[Side], { Speed: Profile.GasSpeed, Reflect: -0.5, Loss: 5200 });
        this.Pipe = new PipeSection(Rate, Profile.Tail[Side], { Speed: Profile.GasSpeed * 0.82, Reflect: -0.38, Loss: 2600 });
        this.Turbine = new OnePole(Rate, 6000);
        // Each cylinder: strength, timing lean (degrees) and pulse shape from its own runner length.
        this.Spread = Array.from({ length: this.Slots }, () => Math.max(0.4, 1 + Noise.Gauss() * Profile.Spread));
        this.Leans = Array.from({ length: this.Slots }, () => Noise.Gauss() * Profile.Lean);
        this.Shapes = Array.from({ length: this.Slots }, () => Math.max(0.55, 1 + Noise.Gauss() * Profile.Shape));
        this.Crack = 0;
    }
}

/** Pressure of one blowdown pulse at Phase degrees after its slot (raised-cosine rise, exponential fall, combustion noise). */
function PulseAt(Pulse, Phase, Noise)
{
    const Angle = Phase - Pulse.Shift;
    if (Angle <= 0 || Pulse.Amp === 0) return 0;
    let Shape;
    if (Angle < Pulse.Attack) Shape = 0.5 - 0.5 * Math.cos(Math.PI * Angle / Pulse.Attack);
    else
    {
        const Fall = (Angle - Pulse.Attack) / Pulse.Decay;
        if (Fall > 7) return 0;
        Shape = Math.exp(-Fall) - 0.22 * Math.exp(-Fall * 0.35) * (1 - Math.exp(-Fall * 3));   // the scavenging dip
    }
    return Pulse.Amp * (Shape + Pulse.Rough * Noise.White() * Math.exp(-Angle / (Pulse.Attack * 2.5)));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ENGINE
//------------------------------------------------------------------------------------------------------------------------

/**
 * Live engine voice. Set the drive inputs with Feed(), then Render() adds stereo samples into the given buffers.
 * Feed: { Rpm, Throttle 0–1, Load 0–1 (delivered torque share), Ignition 0–1 (0 = cut), Motor −1–1 (electric torque,
 * negative = regeneration), Starter 0–1, Boost 0–1 (turbo; estimated here when absent), Spool 0–1 (turbo shaft speed from
 * the integrator, so the whistle carries the real lag), Gear (for whine), Clunk (a
 * counter that steps on every gear change) }. Pickup: 'Chase' (microphone behind the car), 'Cabin' (driver seat) or
 * 'Dry' (point source for the trackside fly-by, both channels equal, no reflections).
 */
export class PulseTrainEngine
{
    constructor(Rate, Profile = LaFerrari, { Seed = 11, Pickup = 'Chase' } = {})
    {
        this.Rate = Rate;
        this.Profile = Profile;
        this.Pickup = Pickup;
        this.Noise = new SeededNoise(Seed);
        this.Crank = 0;
        this.Rpm = new Slew(Rate, 0.012, 0);
        this.Throttle = new Slew(Rate, 0.02, 0);
        this.Held = new Slew(Rate, 0.15, 0);                          // slow throttle follower, detects a sharp lift
        this.Load = new Slew(Rate, 0.03, 0);
        this.Ignition = 1;
        this.Motor = new Slew(Rate, 0.05, 0);
        this.Starter = new Slew(Rate, 0.02, 0);
        this.Valve = new Slew(Rate, 0.18, 0);
        this.Overrun = 0;                                              // unburnt-fuel energy left after a lift, drives pops
        this.Banks = [0, 1].map((Side) => new Bank(Rate, Profile, Side, this.Noise));
        this.Blocks = [new DcBlock(Rate, 18), new DcBlock(Rate, 18)];
        this.Gear = 0; this.Clunk = 0; this.ClunkHit = 0; this.ExternalBoost = null; this.ExternalSpool = null;

        // Muffler: two paths blended by the bypass valve, then the body formants.
        this.Quiet = [0, 1].map(() => [new Biquad(Rate).Shape('Low', 1100, 0.6), new Biquad(Rate).Shape('Peak', 95, 1.2, 5)]);
        this.Loud = [0, 1].map(() => [new Biquad(Rate).Shape('Low', 8200, 0.6)]);
        this.Formants = [0, 1].map(() => Profile.Formants.map(([Hz, Q, Gain]) => new Biquad(Rate).Shape('Peak', Hz, Q, Gain)));

        // Intake: airbox Helmholtz, runner resonance and the high howl, plus turbulent hiss.
        const { Box, Runner, Howl } = Profile.Intake;
        this.Airbox = new Biquad(Rate).Shape('Band', Box, 2.5);
        this.Runner = new Biquad(Rate).Shape('Band', Runner, 5);
        this.Howl = new Biquad(Rate).Shape('Band', Howl, 6);
        this.Hiss = [new Biquad(Rate).Shape('High', 900, 0.7), new Biquad(Rate).Shape('Low', 5200, 0.7)];

        // Mechanical: valve closing ticks, injector ticks, high shimmer, whines, shift clunk.
        this.ValveSlot = -1; this.ValveHit = 0; this.InjectorHit = 0;
        this.ValveRing = new ModeBank(Rate, [[2300, 0.005], [3900, 0.0035, 0.7], [6100, 0.0025, 0.45]]);
        this.InjectorRing = new ModeBank(Rate, [[7600, 0.002], [11200, 0.0014, 0.6]]);
        this.ClunkRing = new ModeBank(Rate, [[165, 0.07], [540, 0.045, 0.7], [1350, 0.03, 0.5], [2900, 0.014, 0.3]]);
        this.Shimmer = [new Biquad(Rate).Shape('High', 4200, 0.7), new Biquad(Rate).Shape('Low', 9500, 0.7)];
        this.WhinePhase = 0; this.GearPhase = 0; this.MotorPhase = 0; this.CarrierPhase = 0; this.StarterPhase = 0;

        // Turbos: shaft speed, whistle per turbo, spool whoosh, blow-off vent and compressor surge flutter.
        if (Profile.Turbo)
        {
            this.Boost = new Slew(Rate, Profile.Turbo.Lag, 0);
            this.Shaft = new Slew(Rate, 0.25, 0);
            this.WhistlePhase = [0, 0.3];
            this.SpoolBand = [new Biquad(Rate), new Biquad(Rate)];
            this.VentBand = [new Biquad(Rate).Shape('High', 1800, 0.7), new Biquad(Rate).Shape('Low', 6500, 0.7)];
            this.SurgeBand = new Biquad(Rate).Shape('Band', 950, 1.1);
            this.GateBand = new Biquad(Rate).Shape('Band', 3200, 0.9);
            this.Vent = 0; this.Surge = 0; this.SurgePhase = 0; this.SpoolTune = 0;
        }

        // Pickup colouring and space.
        this.CabinExhaust = [0, 1].map(() => [new Biquad(Rate).Shape('Low', 1100, 0.7), new Biquad(Rate).Shape('LowShelf', 140, 0.8, 5)]);
        this.CabinIntake = new Biquad(Rate).Shape('Peak', 420, 0.9, 4);
        this.Air = [new OnePole(Rate, 15000), new OnePole(Rate, 15000)];
        this.Echo = new DelayLine(Math.ceil(Rate * 0.04));
        this.EchoTone = [new OnePole(Rate, 4800), new OnePole(Rate, 4800)];
        this.Taps = [[0.0071, 0.0173, 0.0299], [0.0097, 0.0211, 0.0337]].map((Side) => Side.map((Seconds) => Seconds * Rate));
    }

    Feed({ Rpm = 0, Throttle = 0, Load = Throttle, Ignition = 1, Motor = 0, Starter = 0, Boost, Spool, Gear, Clunk, FrontRpm = 0 })
    {
        this.Rpm.Target = Math.max(0, Rpm);
        this.Throttle.Target = Clamp(Throttle, 0, 1);
        this.Load.Target = Clamp(Load, 0, 1);
        this.Ignition = Clamp(Ignition, 0, 1);
        this.Motor.Target = Clamp(Motor, -1, 1);
        this.Starter.Target = Clamp(Starter, 0, 1);
        this.ExternalBoost = Boost ?? null;
        this.ExternalSpool = Spool ?? null;
        this.FrontRpm = FrontRpm;
        if (Gear !== undefined) this.Gear = Gear;
        if (Clunk !== undefined && Clunk !== this.Clunk) { this.ClunkHit = 1; this.Clunk = Clunk; }
    }

    /** Starts a new firing in a bank: amplitude, timing scatter, edge sharpness, and maybe an afterfire pop. */
    Fire(Bank, Slot, Rpm, Throttle, Load, Shaft)
    {
        const P = this.Profile, Noise = this.Noise;
        Object.assign(Bank.Tail, Bank.Pulse);
        const Spin = Clamp(Rpm / P.Redline, 0, 1.1);
        const Cranking = Rpm < 500;
        const Lifted = Throttle < 0.03 && Rpm > P.Idle + 450;
        let Strength = Cranking ? 0.3 : Lifted ? 0.085 : 0.13 + 0.87 * Math.pow(Load, 0.85);
        const Burnt = this.Ignition;
        if (!Cranking && Noise.Next() > Burnt) Strength *= 0.06;     // ignition cut: the charge passes unburnt
        const Pulse = Bank.Pulse;
        const Jitter = Mix(P.Jitter[0], P.Jitter[1], Smoothstep(0, 0.8, Spin)) * (Load < 0.15 ? 1.25 : 1);
        // Tuned headers even the cylinders out near the top of the range: lumpy low down, a clean scream up high.
        const Evening = Smoothstep(0.3, 1, Spin), Spread = 1 + (Bank.Spread[Slot] - 1) * Mix(1, 0.4, Evening), Shape = 1 + (Bank.Shapes[Slot] - 1) * Mix(1, 0.5, Evening);
        let Amp = Strength * Spread * Math.max(0.05, 1 + Noise.Gauss() * Jitter) * (0.45 + 0.55 * Spin + 0.2 * Load);
        if (Lifted) Amp *= Mix(1, Noise.Range(0.1, 1.9), P.Burble);  // lean overrun: lumpy, uneven burble
        Pulse.Amp = Amp * (P.Turbo ? 1 - 0.3 * Shaft : 1);
        Pulse.Shift = Bank.Leans[Slot] * Mix(1, 0.5, Evening) + Noise.Gauss() * Mix(3.2, 0.7, Spin);
        const AttackMs = Mix(0.95, 0.24, Load) * (Lifted ? 1.4 : 1) * Shape;
        Pulse.Attack = Clamp(AttackMs * Rpm * 0.006, 2.5, 60);
        Pulse.Decay = Mix(0.2, 0.33, Load) * Bank.SlotAngle * Shape;
        Pulse.Rough = Mix(0.12, 0.32, Load * Spin) + (Lifted ? 0.2 : 0);
        this.InjectorHit = Cranking ? 0 : Noise.Range(0.6, 1);

        // Afterfire: unburnt fuel lighting in the hot exhaust on overrun or during an ignition cut.
        const Cut = Burnt < 0.5 && !Cranking;
        const Chance = (Lifted ? 0.0045 * this.Overrun * Smoothstep(2600, 7200, Rpm) : 0) + (Cut ? 0.045 * Smoothstep(3500, 8000, Rpm) : 0);
        if (Noise.Next() < Chance * P.Pops)
        {
            Bank.Pop.Amp = Noise.Range(1.6, 3.6) * (Cut ? 1 : 0.85);
            Bank.Pop.At = Noise.Range(8, 95);
            Bank.Pop.Crackle = Noise.Range(0.6, 1.4);
            Bank.Pop.Age = 0;
        }
    }

    /** Adds Count stereo samples starting at Offset. */
    Render(Left, Right, Offset = 0, Count = Left.length - Offset)
    {
        const P = this.Profile, Noise = this.Noise, Rate = this.Rate, Turbo = P.Turbo;
        const [Bank0, Bank1] = this.Banks;
        const Pickup = this.Pickup;
        const [PanL0, PanR0] = PanGains(Pickup === 'Dry' ? 0 : -0.38), [PanL1, PanR1] = PanGains(Pickup === 'Dry' ? 0 : 0.38);
        const FiringAngle = 720 / P.Cylinders, ValveAngle = 720 / (P.Cylinders * 2), ShimmerAngle = 720 / (P.Cylinders * 4);
        for (let Index = Offset; Index < Offset + Count; Index++)
        {
            const Rpm = this.Rpm.Run(), Throttle = this.Throttle.Run(), Load = this.Load.Run(), Motor = this.Motor.Run(), Starter = this.Starter.Run();
            const Held = this.Held.Run(); this.Held.Target = Throttle;
            const Spin = Rpm / P.Redline;
            const Step = Rpm * 6 / Rate;                                // crank degrees per sample
            this.Crank = (this.Crank + Step) % 720;
            if (Throttle > 0.5 && Rpm > 3000) this.Overrun = 1; else this.Overrun *= 1 - 1 / (1.4 * Rate);
            this.Valve.Target = (Rpm > P.ValveRpm && Load > 0.25) || Rpm > P.Redline * 0.58 ? 1 : 0;
            const Valve = this.Valve.Run();

            // Turbo: boost (fed or estimated), shaft speed, wastegate, lift detection.
            let Shaft = 0, Gate = 0;
            if (Turbo)
            {
                this.Boost.Target = this.ExternalBoost ?? BoostTarget(P, Rpm, Throttle);
                const Boost = this.ExternalBoost ?? this.Boost.Run();
                if (this.ExternalSpool !== null) Shaft = this.Shaft.Current += (Clamp(this.ExternalSpool, 0, 1.1) - this.Shaft.Current) * 0.002;   // the integrator's shaft (real lag)
                else { this.Shaft.Target = Math.sqrt(Clamp(Boost, 0, 1)) * 0.85 + 0.15 * Smoothstep(800, 6000, Rpm); Shaft = this.Shaft.Run(); }
                Gate = Smoothstep(0.85, 1, Boost) * Smoothstep(4500, 6500, Rpm);
                if (Held - Throttle > 0.35 && Boost > 0.3 && this.Vent < 0.15) { this.Vent = Boost; this.Surge = Boost; this.SurgePhase = 0; }
                const Cutoff = Mix(Mix(5500, Turbo.Muffle, Shaft), 7500, Gate * 0.5);
                Bank0.Turbine.Set(Cutoff); Bank1.Turbine.Set(Cutoff);
            }

            // Exhaust: two banks.
            let Out0 = 0, Out1 = 0;
            for (let Side = 0; Side < 2; Side++)
            {
                const Bank = this.Banks[Side];
                const Local = ((this.Crank - Bank.Offset) % 720 + 720) % 720;
                let Slot = Bank.Slots - 1;
                while (Slot > 0 && Local < Bank.Angles[Slot]) Slot--;
                if (Local < Bank.Angles[0]) Slot = Bank.Slots - 1;
                const Phase = ((Local - Bank.Angles[Slot]) % 720 + 720) % 720;
                if (Slot !== Bank.Slot) { if (Rpm > 30) this.Fire(Bank, Slot, Rpm, Throttle, Load, Shaft); Bank.Slot = Slot; }
                let Excite = PulseAt(Bank.Pulse, Phase, Noise) + PulseAt(Bank.Tail, Phase + Bank.Gaps[Slot], Noise);
                if (Turbo) Excite = Bank.Turbine.Run(Excite) * 1.15;
                let Crack = 0;
                const Pop = Bank.Pop;
                if (Pop.Amp > 0)
                {
                    Pop.Age += Step;
                    const Since = (Pop.Age - Pop.At) / Math.max(Step, 1e-6) / Rate * 1000;     // ms since the pop lit
                    if (Since > 0)
                    {
                        Excite += Pop.Amp * (Since < 0.09 ? Since / 0.09 : Math.exp(-(Since - 0.09) / 0.7));
                        Crack = Pop.Crackle * Noise.White() * Math.exp(-Since / 3.5) * (Noise.Next() < 0.35 ? 2.2 : 0.6);
                        if (Since > 12) Pop.Amp = 0;
                    }
                }
                const Out = Bank.Header.Run(Excite);
                if (Side === 0) Out0 = Out; else Out1 = Out;
                Bank.Crack = Crack;
            }
            const Feed = P.CrossFeed;
            const Pipe0 = Bank0.Pipe.Run(Out0 + Out1 * Feed + Bank0.Crack);
            const Pipe1 = Bank1.Pipe.Run(Out1 + Out0 * Feed + Bank1.Crack);
            const Exhaust = [Pipe0, Pipe1].map((Signal, Side) =>
            {
                let Quiet = Signal;
                for (const Filter of this.Quiet[Side]) Quiet = Filter.Run(Quiet);
                let Loud = Signal;
                for (const Filter of this.Loud[Side]) Loud = Filter.Run(Loud);
                let Mixed = Quiet * (1 - Valve) * 0.75 + Loud * Valve * 1.1;
                for (const Filter of this.Formants[Side]) Mixed = Filter.Run(Mixed);
                return this.Blocks[Side].Run(Mixed) * (P.Level ?? 1);
            });

            // Intake: suction pulses after each firing, through airbox, runners and howl, plus airflow hiss.
            const Airflow = Math.pow(Clamp(Throttle, 0.04, 1), 0.7) * Math.pow(Clamp(Spin, 0, 1.05), 1.3) * (Turbo ? 0.7 + 0.5 * Shaft : 1);
            const IntakePhase = ((this.Crank + 250) % FiringAngle) / FiringAngle;
            const Suction = Math.pow(Math.sin(Math.PI * IntakePhase), 6) * (0.4 + Throttle) * (Turbo ? 1 - 0.5 * Shaft : 1);
            const Turbulence = Noise.Pink() * (0.35 + Suction) * Airflow;
            const Hiss = this.Hiss[1].Run(this.Hiss[0].Run(Turbulence));
            const Intake = (this.Airbox.Run(Suction) * 1.6 + this.Runner.Run(Suction) * 1.2 + this.Howl.Run(Suction + Turbulence * 0.6) * (0.5 + 1.5 * Airflow)) * (0.25 + Airflow) + Hiss * 0.5;

            // Mechanical chatter: a tick per valve closing (random strength), injector ticks, high shimmer, whines.
            const ValveSlot = Math.floor(this.Crank / ValveAngle);
            if (ValveSlot !== this.ValveSlot) { this.ValveSlot = ValveSlot; this.ValveHit = Rpm > 200 ? Noise.Range(0.35, 1) : 0; }
            const Valves = this.ValveRing.Run(this.ValveHit) * P.Valvetrain * (0.55 + 0.8 * Spin);
            const Injectors = this.InjectorRing.Run(this.InjectorHit) * P.Injector * (1 - 0.6 * Clamp(Spin, 0, 1));
            this.ValveHit = 0; this.InjectorHit = 0;
            const Valvetrain = Math.exp(-((this.Crank % ShimmerAngle) / ShimmerAngle) * 6) * Noise.White();
            const Shimmer = this.Shimmer[1].Run(this.Shimmer[0].Run(Valvetrain)) * (0.012 + 0.04 * Spin * Spin);
            this.WhinePhase = (this.WhinePhase + Rpm / 60 * 24 / Rate) % 1;
            const Whine = Math.sin(Tau * this.WhinePhase) * 0.006 * Spin * Spin;
            let Gearing = 0;
            if (this.Gear > 0 && P.Gearbox)
            {
                this.GearPhase = (this.GearPhase + Rpm / 60 * P.Gearbox.Teeth[this.Gear - 1] / Rate) % 1;
                Gearing = (Math.sin(Tau * this.GearPhase) + 0.3 * Math.sin(Tau * this.GearPhase * 2)) * P.Gearbox.Whine * (0.3 + 0.7 * Math.max(Load, Throttle < 0.05 ? 0.6 : 0)) * Smoothstep(1200, 5000, Rpm);
            }
            let Clunk = 0;
            if (P.Gearbox)
            {
                const Hit = this.ClunkHit > 0 ? Noise.White() * this.ClunkHit : 0;
                this.ClunkHit = Math.max(0, this.ClunkHit - 1 / (0.003 * Rate));
                Clunk = this.ClunkRing.Run(Hit * 0.25) * P.Gearbox.Clunk;
            }
            const Mechanical = Valves + Injectors + Shimmer + Whine + Gearing + Clunk;

            // Hybrid motor: electrical order tone and harmonics, inverter carrier with side-bands; louder under torque.
            let Electric = 0;
            if (P.Motor)
            {
                const Drive = Math.abs(Motor);
                this.MotorPhase = (this.MotorPhase + Rpm / 60 * P.Motor.Order / Rate) % 1;
                this.CarrierPhase = (this.CarrierPhase + P.Motor.Carrier / Rate) % 1;
                Electric = Drive * (Math.sin(Tau * this.MotorPhase) * 0.05 + Math.sin(Tau * this.MotorPhase * 3) * 0.02
                    + Math.sin(Tau * this.CarrierPhase) * Math.sin(Tau * this.MotorPhase) * 0.012) * (Motor < 0 ? 0.7 : 1);
                // Front-axle motor (918): its own whine locked to wheel speed through its gear, silent once decoupled.
                if (P.Motor.Front && this.FrontRpm > 1)
                {
                    this.FrontPhase = ((this.FrontPhase ?? 0) + this.FrontRpm / 60 * P.Motor.Front.Order / Rate) % 1;
                    Electric += Drive * Math.sin(Tau * this.FrontPhase) * 0.035 * Math.min(1, (Rate * 0.4) / Math.max(1, this.FrontRpm / 60 * P.Motor.Front.Order));
                }
            }

            // Turbo sounds: twin whistles (slightly detuned, beating), spool whoosh, blow-off vent, surge flutter, wastegate.
            let Forced = 0;
            if (Turbo)
            {
                const Pitch = Mix(Turbo.Whistle[0], Turbo.Whistle[1], Shaft);
                this.WhistlePhase[0] = (this.WhistlePhase[0] + Pitch / Rate) % 1;
                this.WhistlePhase[1] = (this.WhistlePhase[1] + Pitch * 1.013 / Rate) % 1;
                const Whistle = (Math.sin(Tau * this.WhistlePhase[0]) + Math.sin(Tau * this.WhistlePhase[1])) * 0.5 * Turbo.Tone * Shaft * Shaft * (0.35 + 0.65 * Throttle);
                if ((this.SpoolTune = (this.SpoolTune + 1) % 64) === 0) { const Hz = Mix(900, 3400, Shaft); this.SpoolBand[0].Shape('Band', Hz, 1.3); this.SpoolBand[1].Shape('Band', Hz * 1.9, 1.6); }
                const Air = Noise.White();
                const Spool = (this.SpoolBand[0].Run(Air) + this.SpoolBand[1].Run(Air) * 0.5) * Turbo.Spool * Shaft * (0.25 + 0.75 * Throttle) * 3;
                this.Vent *= 1 - 1 / (0.3 * Rate);
                const Vent = this.VentBand[1].Run(this.VentBand[0].Run(Noise.White())) * this.Vent * Turbo.Vent;
                this.Surge *= 1 - 1 / (0.5 * Rate);
                this.SurgePhase += Mix(9, 21, this.Surge) / Rate;
                const Chop = Math.pow(Math.max(0, Math.sin(Tau * this.SurgePhase)), 3);
                const Surge = this.SurgeBand.Run(Noise.White()) * Chop * this.Surge * Turbo.Flutter * 3;
                const Wastegate = this.GateBand.Run(Noise.White()) * Gate * 0.05;
                Forced = Whistle + Spool + Vent + Surge + Wastegate;
            }

            // Starter: pinion whine with brush noise; each compression stroke loads it (speed and level dip).
            let Crank = 0;
            if (Starter > 0.001)
            {
                const Compression = 0.5 - 0.5 * Math.cos(this.Crank * (P.Cylinders / 2) * Math.PI / 180);
                this.StarterPhase = (this.StarterPhase + (1350 + Rpm * 1.3) * (1 - 0.18 * Compression) / Rate) % 1;
                Crank = Starter * (0.55 + 0.45 * (1 - Compression)) * (Math.sin(Tau * this.StarterPhase) * 0.05 + Math.sin(Tau * this.StarterPhase * 2.01) * 0.025 + Noise.White() * 0.02);
            }

            // Pickup mix.
            let Left0, Right0;
            if (Pickup === 'Cabin')
            {
                let E0 = Exhaust[0], E1 = Exhaust[1];
                for (const Filter of this.CabinExhaust[0]) E0 = Filter.Run(E0);
                for (const Filter of this.CabinExhaust[1]) E1 = Filter.Run(E1);
                const Induction = this.CabinIntake.Run(Intake);
                const Centre = Induction * 0.9 + Mechanical * 0.55 + Electric * 0.6 + Crank * 0.7 + Forced * 0.9;
                Left0 = E0 * 0.36 + E1 * 0.21 + Centre;
                Right0 = E1 * 0.36 + E0 * 0.21 + Centre;
            }
            else
            {
                const Centre = Intake * 0.22 + Mechanical * 0.3 + Electric * 0.45 + Crank * 0.5 + Forced * 0.55;
                Left0 = Exhaust[0] * PanL0 + Exhaust[1] * PanL1 + Centre;
                Right0 = Exhaust[0] * PanR0 + Exhaust[1] * PanR1 + Centre;
                if (Pickup === 'Chase' && P.Space)
                {
                    // Early reflections off the road and nearby surfaces: depth instead of a dry, flat point source.
                    this.Echo.Write((Left0 + Right0) * 0.5);
                    const [TapsL, TapsR] = this.Taps;
                    const ReflectL = this.Echo.Read(TapsL[0]) * 0.34 + this.Echo.Read(TapsL[1]) * 0.22 + this.Echo.Read(TapsL[2]) * 0.14;
                    const ReflectR = this.Echo.Read(TapsR[0]) * 0.34 + this.Echo.Read(TapsR[1]) * 0.22 + this.Echo.Read(TapsR[2]) * 0.14;
                    Left0 += this.EchoTone[0].Run(ReflectL) * P.Space * 2;
                    Right0 += this.EchoTone[1].Run(ReflectR) * P.Space * 2;
                }
            }
            Left[Index] += SoftClip(this.Air[0].Run(Left0) * 0.9, 0.7);
            Right[Index] += SoftClip(this.Air[1].Run(Right0) * 0.9, 0.7);
        }
    }
}

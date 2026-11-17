// VOICE RACK WORKLET
// 🧩 AudioWorklet that runs the live car on the audio thread: TractionIntegrator steps every 128-sample block and feeds
//    PulseTrainEngine (LaFerrari or GT-R NISMO), SurfaceRoll, TyreSqueal, BrakeRotor and SuspensionTravel, the same
//    classes the offline reel renders with.
// 📝 The page posts { Controls }, { Command }, { Mix } and { Car } messages (processorOptions { Start, Throttle, Car }
//    preset them); the worklet posts a telemetry readout ~30 times a second. Registered as 'voice-rack'.

import { PulseTrainEngine, Profiles } from './PulseTrainEngine.js';
import { TractionIntegrator } from './TractionIntegrator.js';
import { SurfaceRoll, TyreSqueal, Surfaces } from './ContactPatch.js';
import { BrakeRotor, SuspensionTravel } from './ChassisVoices.js';

const Knee = (Sample) => { const Size = Math.abs(Sample); return Size <= 0.6 ? Sample : Math.sign(Sample) * (0.6 + 0.4 * Math.tanh((Size - 0.6) / 0.4)); };

class VoiceRack extends AudioWorkletProcessor
{
    constructor({ processorOptions = {} } = {})
    {
        super();
        const Rate = sampleRate;
        this.Pickup = 'Chase';
        this.Choose(processorOptions.Car ?? 'LaFerrari');
        this.Roll = new SurfaceRoll(Rate, { Pickup: 'Chase' });
        this.Squeal = new TyreSqueal(Rate, { Pickup: 'Chase' });
        this.Brakes = new BrakeRotor(Rate, { Pickup: 'Chase' });
        this.Springs = new SuspensionTravel(Rate, { Pickup: 'Chase' });
        this.Surface = 'Asphalt'; this.Kick = 0;
        this.Levels = { Engine: 1, Road: 1, Tyres: 1, Chassis: 1 };
        this.Scratch = [new Float32Array(128), new Float32Array(128)];
        this.Clock = 0;
        this.port.onmessage = (Message) => this.Receive(Message.data);
        // Start-up inputs arrive with construction (offline renders cannot rely on port timing).
        if (processorOptions.Throttle) this.Car.Throttle = processorOptions.Throttle;
        if (processorOptions.Start) this.Car.Start();
    }

    /** Swaps the car (engine voice and integrator); the new one waits switched off, like walking up to it. */
    Choose(Name)
    {
        const Profile = Profiles[Name] ?? Profiles.LaFerrari;
        this.CarName = Profiles[Name] ? Name : 'LaFerrari';
        this.Car = new TractionIntegrator(Profile);
        this.Engine = new PulseTrainEngine(sampleRate, Profile, { Pickup: this.Pickup });
    }

    Receive({ Controls, Command, Mix, Car: Chosen })
    {
        if (Chosen) this.Choose(Chosen);
        const Car = this.Car;
        if (Controls)
        {
            for (const Key of ['Throttle', 'Brake', 'Steer', 'Handbrake', 'Automatic', 'Traction']) if (Key in Controls) Car[Key] = Controls[Key];
            if (Controls.Surface && Surfaces[Controls.Surface]) this.Surface = Controls.Surface;
            if (Controls.Pickup) this.Pickup = this.Engine.Pickup = this.Roll.Pickup = this.Squeal.Pickup = this.Brakes.Pickup = this.Springs.Pickup = Controls.Pickup;
        }
        if (Mix) Object.assign(this.Levels, Mix);
        if (Command === 'Start') Car.Running ? Car.Stop() : Car.Start();
        if (Command === 'ShiftUp') Car.ShiftUp();
        if (Command === 'ShiftDown') Car.ShiftDown();
        if (Command === 'Neutral') Car.Gear = 0;
        if (Command === 'Kerb') this.Kick = 0.09;
        if (Command === 'Pothole') this.Kick = -0.08;
    }

    process(Inputs, Outputs)
    {
        const [Left, Right = Left] = Outputs[0];
        const Size = Left.length;
        const Car = this.Car, Levels = this.Levels, [ScratchL, ScratchR] = this.Scratch;
        const Feed = Car.Step(Size / sampleRate);
        this.Engine.Feed(Feed);
        this.Roll.Feed({ Speed: Car.Speed, Surface: this.Surface });
        this.Squeal.Feed({ Speed: Car.Speed, Corner: Car.Corner, LockUp: Car.LockUp, Wheelspin: Car.Wheelspin, Grip: Surfaces[this.Surface].Grip });
        this.Brakes.Feed({ Speed: Car.Speed, Brake: Car.Brake, Abs: Car.AbsActive, Handbrake: Car.Handbrake });
        this.Springs.Feed({ Speed: Car.Speed, Surface: this.Surface, Accel: Car.Accel, Lateral: Car.Lateral, Kick: this.Kick });
        this.Kick = 0;
        Left.fill(0); Right.fill(0);
        for (const [Voice, Level] of [[this.Engine, Levels.Engine], [this.Roll, Levels.Road], [this.Squeal, Levels.Tyres], [this.Brakes, Levels.Chassis], [this.Springs, Levels.Chassis]])
        {
            ScratchL.fill(0); ScratchR.fill(0);
            Voice.Render(ScratchL, ScratchR, 0, Size);
            for (let Index = 0; Index < Size; Index++) { Left[Index] += ScratchL[Index] * Level; Right[Index] += ScratchR[Index] * Level; }
        }
        // Safety knee: pops and the limiter can spike past full scale; above 0.6 the peaks fold softly towards 1.
        for (let Index = 0; Index < Size; Index++) { Left[Index] = Knee(Left[Index]); Right[Index] = Knee(Right[Index]); }
        if ((this.Clock += Size) >= sampleRate / 30) { this.Clock = 0; this.port.postMessage(Car.Readout()); }
        return true;
    }
}

registerProcessor('voice-rack', VoiceRack);

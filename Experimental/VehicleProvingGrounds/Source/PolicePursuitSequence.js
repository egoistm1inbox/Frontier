//============================================================================================================================================
//                                                       POLICEPURSUITSEQUENCE.JS
//============================================================================================================================================
// 🧩 Police Pursuit & Fast Self-Play Reinforcement Learning System:
//    • Same ControlVehicle Police Interceptor Cruiser (full 480 Hz VehicleSolver physics + Red/Blue roof lightbar + PIT chassis collisions)
//    • Immediate Combined Aerial Support: Police Pursuit Helicopter (rotors + searchlight cone + alley LOS occlusion) + 3 Police Drones
//    • Traffic Law Enforcement in Player Mode: Speeding (> posted limit), Running Red Signals, and Reckless Impact trigger pursuit
//    • Hands-Free Fast RL Self-Training Mode ("selfplay"): Dual 16->20->3 Tanh Neural Policies (EvaderNet vs PoliceNet) trained live via
//      Elitist Cross-Entropy Policy Gradient (CEM-RL) with 9-ray 2D Lidar, 1x..40x Turbo Time-Warp, and zero-black-box holographic telemetry.

import { VehicleSolver } from "./VehicleSolver.js";
import { VehicleGeometry } from "./VehicleSpecification.js";
import { LightType } from "./LightingSystem.js";
import { QueryCitySpeedLimitKmh, QueryNearestCityRoadFrame, IsPointOccludedFromHelicopter } from "./CityPursuitStructure.js";
import { ConstructRigidTransform, ConstructAxisQuaternion, MultiplyQuaternion, RotateVector, ClampScalar } from "./TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                          LIGHTWEIGHT DETERMINISTIC PRNG & 16->20->3 TANH NEURAL POLICY
//------------------------------------------------------------------------------------------------------------------------

function CreateRng(Seed = 1337)
{
    let State = (Seed >>> 0) || 1;
    return () =>
    {
        State = (Math.imul(State, 1664525) + 1013904223) >>> 0;
        return State / 4294967296.0;
    };
}

function SampleGaussian(Rng)
{
    const U1 = Math.max(1.0e-7, Rng());
    const U2 = Rng();
    return Math.sqrt(-2.0 * Math.log(U1)) * Math.cos(2.0 * Math.PI * U2);
}

const InputDim  = 16;
const HiddenDim = 20;
const OutputDim = 3;
// Parameter count: (16*20 + 20) + (20*3 + 3) = 340 + 63 = 403 floats
export const PolicyParameterCount = (InputDim * HiddenDim + HiddenDim) + (HiddenDim * OutputDim + OutputDim);

const LidarAngles = [-1.48, -0.96, -0.52, -0.21, 0.0, 0.21, 0.52, 0.96, 1.48]; // 9 rays across [-85°..+85°]
const LidarMaxRange = 46.0;

export class NeuralDrivingPolicy
{
    constructor(Role = "evader", Seed = 42)
    {
        this.Role           = Role;
        this.Rng            = CreateRng(Seed);
        this.PopSize        = 6;
        this.MeanWeights    = new Float32Array(PolicyParameterCount);
        this.ActiveWeights  = new Float32Array(PolicyParameterCount);
        this.HiddenBuf      = new Float32Array(HiddenDim);
        this.Sigma          = 0.34;
        this.Generation     = 1;
        this.CandidateIndex = 0;
        this.Candidates     = [];
        this.Returns        = new Float32Array(this.PopSize);
        this.RewardHistory  = [];
        this.LastBestReturn = 0.0;

        this.ResetUntrained();
    }

    ResetUntrained()
    {
        this.Generation     = 1;
        this.Sigma          = 0.34;
        this.CandidateIndex = 0;
        this.RewardHistory  = [];
        this.MeanWeights.fill(0.0);

        // Minimal untrained symmetry-breaking noise + gentle forward throttle bias so Gen 1 rolls off the line clumsily
        for (let I = 0; I < PolicyParameterCount; ++I)
            this.MeanWeights[I] = (this.Rng() - 0.5) * 0.08;

        const OutBiasOffset = (InputDim * HiddenDim + HiddenDim) + (HiddenDim * OutputDim);
        this.MeanWeights[OutBiasOffset + 0] = 0.48; // initial raw forward throttle reflex

        // Weak untrained sense of front obstacle difference (left ray #2 vs right ray #6) -> learns sharp steering via RL!
        // Make sure we wire tiny seed synapses through hidden neurons 0 & 1 so policy gradients amplify road/lidar cues rapidly:
        // Hidden 0 watches road heading error (input 12) & cross-track (input 13); Hidden 1 watches Lidar asymmetry & opponent bearing (input 14)
        const W1 = 0;
        const W2 = InputDim * HiddenDim + HiddenDim;
        this.MeanWeights[W1 + 0 * InputDim + 12] = 0.22;
        this.MeanWeights[W1 + 0 * InputDim + 13] = -0.18;
        this.MeanWeights[W1 + 1 * InputDim + 2]  = -0.20;
        this.MeanWeights[W1 + 1 * InputDim + 6]  = 0.20;
        if (this.Role === "police")
            this.MeanWeights[W1 + 2 * InputDim + 14] = 0.28; // weak initial attraction toward suspect bearing
        else
            this.MeanWeights[W1 + 2 * InputDim + 4]  = 0.22; // center lidar ray clearance -> speed confidence

        this.MeanWeights[W2 + 1 * HiddenDim + 0] = 0.25;
        this.MeanWeights[W2 + 1 * HiddenDim + 1] = 0.25;
        if (this.Role === "police")
            this.MeanWeights[W2 + 1 * HiddenDim + 2] = 0.25;
        else
            this.MeanWeights[W2 + 0 * HiddenDim + 2] = 0.20;

        this.SamplePopulation();
        this.ActivateCandidate(0);
    }

    SamplePopulation()
    {
        this.Candidates = [];
        // Candidate 0 is always the current clean elite mean (zero-noise evaluation rollout)
        this.Candidates.push(new Float32Array(this.MeanWeights));
        for (let K = 1; K < this.PopSize; ++K)
        {
            const W = new Float32Array(PolicyParameterCount);
            for (let I = 0; I < PolicyParameterCount; ++I)
                W[I] = this.MeanWeights[I] + SampleGaussian(this.Rng) * this.Sigma;
            this.Candidates.push(W);
        }
        this.Returns.fill(0.0);
    }

    ActivateCandidate(Index)
    {
        this.CandidateIndex = Index % this.PopSize;
        this.ActiveWeights.set(this.Candidates[this.CandidateIndex]);
    }

    Forward(Inputs)
    {
        const W = this.ActiveWeights;
        const H = this.HiddenBuf;
        const B1Offset = InputDim * HiddenDim;
        for (let J = 0; J < HiddenDim; ++J)
        {
            let Sum = W[B1Offset + J];
            const Row = J * InputDim;
            for (let I = 0; I < InputDim; ++I)
                Sum += W[Row + I] * Inputs[I];
            H[J] = Math.tanh(Sum);
        }

        const W2Offset = B1Offset + HiddenDim;
        const B2Offset = W2Offset + HiddenDim * OutputDim;
        const Out = [0.0, 0.0, 0.0];
        for (let K = 0; K < OutputDim; ++K)
        {
            let Sum = W[B2Offset + K];
            const Row = W2Offset + K * HiddenDim;
            for (let J = 0; J < HiddenDim; ++J)
                Sum += W[Row + J] * H[J];
            Out[K] = Math.tanh(Sum);
        }

        const AccelCmd = Out[0];
        const SteerCmd = ClampScalar(Out[1], -1.0, 1.0);
        return {
            Throttle:  AccelCmd > -0.15 ? ClampScalar(0.25 + AccelCmd * 0.75, 0.0, 1.0) : 0.0,
            Brake:     AccelCmd < -0.20 ? ClampScalar(-AccelCmd, 0.0, 1.0) : 0.0,
            Steer:     SteerCmd,
            Handbrake: Out[2] > 0.68 && Math.abs(SteerCmd) > 0.52
        };
    }

    RecordEpisodeReturn(EpisodeReturn)
    {
        this.Returns[this.CandidateIndex] = EpisodeReturn;
        this.CandidateIndex++;
        if (this.CandidateIndex >= this.PopSize)
        {
            // Cross-Entropy Method (CEM) + Elite Policy Gradient Update!
            const Order = Array.from({ length: this.PopSize }, (_, I) => I)
                .sort((A, B) => this.Returns[B] - this.Returns[A]);
            const EliteWeights = [0.54, 0.30, 0.16];
            const NewMean = new Float32Array(PolicyParameterCount);
            for (let E = 0; E < EliteWeights.length; ++E)
            {
                const Cand = this.Candidates[Order[E]];
                const Wt   = EliteWeights[E];
                for (let I = 0; I < PolicyParameterCount; ++I)
                    NewMean[I] += Cand[I] * Wt;
            }
            // Smooth trust-region step (α = 0.72) keeps policy improvement monotonic and stable
            for (let I = 0; I < PolicyParameterCount; ++I)
                this.MeanWeights[I] = this.MeanWeights[I] * 0.28 + NewMean[I] * 0.72;

            const BestRet = this.Returns[Order[0]];
            const MeanRet = Array.from(this.Returns).reduce((S, V) => S + V, 0.0) / this.PopSize;
            this.LastBestReturn = BestRet;
            this.RewardHistory.push(MeanRet);
            if (this.RewardHistory.length > 48)
                this.RewardHistory.shift();

            this.Generation++;
            this.Sigma = Math.max(0.075, this.Sigma * 0.94);
            this.CandidateIndex = 0;
            this.SamplePopulation();
        }
        this.ActivateCandidate(this.CandidateIndex);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                           SPAWN SCENARIOS FOR FAST MULTI-SITUATION CITY RL TRAINING
//------------------------------------------------------------------------------------------------------------------------

const SelfPlayScenarios = Object.freeze([
    // 0: Central Ave Downtown Drag -> Midtown Crossroads & Escape Alleys
    { Evader: [-126.0,   0.0, 0.63,  0.0],          Police: [-148.0,   0.0, 0.63,  0.0] },
    // 1: Covered NW Alley Sprint -> Midtown Street Break-Out
    { Evader: [-130.0,  47.0, 0.63,  0.0],          Police: [-148.0,  47.0, 0.63,  0.0] },
    // 2: North Boulevard -> Highway Interchange Ramp Merge
    { Evader: [ -22.0,  90.0, 0.63,  0.0],          Police: [ -48.0,  90.0, 0.63,  0.0] },
    // 3: South Boulevard -> Frontage Corner & SE Alley Cut
    { Evader: [ -95.0, -90.0, 0.63,  0.0],          Police: [-124.0, -90.0, 0.63,  0.0] },
    // 4: Midtown North-South Avenue High-Speed Intercept
    { Evader: [ -55.0, -58.0, 0.63,  Math.PI * 0.5], Police: [ -55.0, -84.0, 0.63, Math.PI * 0.5] },
    // 5: East Clover Beltway High-Speed Highway Chase
    { Evader: [ 132.0,  86.0, 0.63, -0.95],         Police: [ 112.0, 114.0, 0.63, -0.95] }
]);

//------------------------------------------------------------------------------------------------------------------------
//                                            POLICE PURSUIT & RL SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

export class PolicePursuitSequence
{
    constructor(Host)
    {
        this.Host                  = Host;
        this.Scene                 = Host.Scene;
        this.LevelKey              = Host.LevelKey || "proving";
        this.Enabled               = this.LevelKey !== "dday";
        this.LawEnforcementEnabled = this.LevelKey !== "dday";

        // Modes: "player" (you drive; police chases if you speed/break traffic laws) | "selfplay" (hands-free RL training!)
        this.ControlMode           = "player";
        this.TimeWarp              = 1;          // [1, 8, 20, 40] physics steps per frame during RL training
        this.SpectatorTarget       = "evader";   // "evader" | "police" | "helicopter"
        this.ShowLidarRays         = true;

        this.PursuitActive         = false;
        this.ViolationReason       = "";
        this.SpeedingTimer         = 0.0;
        this.BustedTimer           = 0.0;
        this.EscapeTimer           = 0.0;
        this.BannerTimer           = 0.0;
        this.BannerMessage         = "";
        this.LastConeHits          = 0;
        this.LastFractureBreaks    = 0;

        this.Clock                 = 0.0;
        this.StrobePhase           = 0.0;
        this.HeliRotorAngle        = 0.0;
        this.HeliTailAngle         = 0.0;
        this.HeliPosition          = [-110.0, 0.0, 25.0];
        this.HeliVelocity          = [0.0, 0.0, 0.0];
        this.HeliSpotTarget        = [-90.0, 0.0, 0.0];
        this.HeliLosClear          = true;
        this.DroneStates           = [
            { Pos: [-115.0,  6.0, 3.2], Vel: [0, 0, 0], Yaw: 0 },
            { Pos: [-115.0, -6.0, 3.2], Vel: [0, 0, 0], Yaw: 0 },
            { Pos: [-105.0,  0.0, 3.5], Vel: [0, 0, 0], Yaw: 0 }
        ];
        this.DroneLockActive       = false;

        // Second real ControlVehicle physics instance for the Police Interceptor Cruiser!
        this.PoliceVehicle         = new VehicleSolver(this.Scene.QueryObstacleBounds());
        this.PoliceVehicle.Surfaces = Host.Vehicle.Surfaces;
        this.PoliceVehicle.Support  = Host.Bodies;
        this.PoliceVehicle.AeroGripScale = Host.Vehicle.AeroGripScale;

        // Flat 2D obstacle AABB cache [MinX, MinY, MaxX, MaxY, ...] for <4 µs 9-ray Lidar sweeps
        this.FlatObstacleBoxes     = new Float32Array(0);
        this.RebuildLidarObstacles();

        // Dual Neural Policies (EvaderNet vs PoliceNet) + Lidar visualization buffers
        this.EvaderBrain           = new NeuralDrivingPolicy("evader", 202611);
        this.PoliceBrain           = new NeuralDrivingPolicy("police", 884213);
        this.EvaderInputs          = new Float32Array(InputDim);
        this.PoliceInputs          = new Float32Array(InputDim);
        this.EvaderLidarHits       = new Float32Array(LidarAngles.length * 3); // [endX, endY, frac]
        this.PoliceLidarHits       = new Float32Array(LidarAngles.length * 3);

        // RL Episode bookkeeping
        this.EpisodeIndex          = 1;
        this.EpisodeClock          = 0.0;
        this.EpisodeMaxSeconds     = 6.8;
        this.EvaderEpReturn        = 0.0;
        this.PoliceEpReturn        = 0.0;
        this.PrevSeparation        = 22.0;
        this.TotalBusts            = 0;
        this.TotalEscapes          = 0;
        this.ScenarioCursor        = 0;

        this.MountQuickControls();
        this.PlaceInitialUnits();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                    LIDAR AABB CACHE & INITIAL UNIT PLACEMENT
    //--------------------------------------------------------------------------------------------------------------------

    RebuildLidarObstacles()
    {
        const Boxes = this.Scene?.QueryObstacleBounds ? this.Scene.QueryObstacleBounds() : [];
        const Coords = [];
        for (const B of Boxes)
        {
            if (!B || B.DynamicTram)
                continue;
            // Include walls, buildings, barriers & props projecting above axle height (Z > 0.25 m) and below Z = 3.5 m
            if (B.Maximum[2] < 0.25 || B.Minimum[2] > 3.2)
                continue;
            Coords.push(B.Minimum[0] - 0.35, B.Minimum[1] - 0.35, B.Maximum[0] + 0.35, B.Maximum[1] + 0.35);
        }
        this.FlatObstacleBoxes = new Float32Array(Coords);
    }

    PlaceInitialUnits()
    {
        this.PoliceVehicle.Surfaces = this.Host.Vehicle.Surfaces;
        if (this.LevelKey === "city")
        {
            // Place Police Interceptor on patrol along Central Ave ahead of Downtown spawn so speeding / red-light triggers right in view!
            this.PoliceVehicle.Respawn([-84.0, -3.5, VehicleGeometry.CoMHeight + 0.05], 0.0);
            const EvPos = this.Host.Vehicle.Position;
            this.HeliPosition = [EvPos[0] - 18.0, EvPos[1], 25.0];
            for (let I = 0; I < 3; ++I)
                this.DroneStates[I].Pos = [ -86.0 - I * 3.0, (I - 1) * 4.5, 3.2 ];
            this.SetUnitsVisible(true);
        }
        else
        {
            // Parked cleanly out of sight on Proving Grounds / Inversion Arena until player breaks traffic laws or clicks Deploy!
            this.PoliceVehicle.Respawn([0.0, 0.0, -45.0], 0.0);
            this.SetUnitsVisible(false);
        }
        this.SyncGpuOccupants(true);
    }

    SetUnitsVisible(Visible)
    {
        const Block = this.Scene?.PoliceBlock;
        if (!Block)
            return;
        let Changed = false;
        const All = [Block.CruiserBody, ...Block.CruiserWheels, Block.HeliBody, Block.HeliMainRotor, Block.HeliTailRotor, ...Block.Drones];
        for (const Idx of All)
        {
            if (Idx >= 0 && this.Scene.Occupants[Idx])
            {
                const NextInactive = !Visible;
                if (Boolean(this.Scene.Occupants[Idx].Inactive) !== NextInactive)
                {
                    this.Scene.Occupants[Idx].Inactive = NextInactive;
                    Changed = true;
                }
            }
        }
        if (Changed)
        {
            this.Scene.ConstructDrawRuns?.();
            this.Host?.Cards?.RebuildTileLists?.(this.Scene);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                           INTERACTIVE QUICK-CONTROLS IN VIEWPORT HUD STRIP
    //--------------------------------------------------------------------------------------------------------------------

    MountQuickControls()
    {
        if (typeof document === "undefined")
            return;
        const Stage = document.getElementById("stage");
        if (!Stage)
            return;

        let Strip = document.getElementById("pursuit-rl-controls");
        if (!Strip)
        {
            Strip = document.createElement("div");
            Strip.id = "pursuit-rl-controls";
            Strip.className = "pursuit-rl-controls";

            const MakeBtn = (Key, Label, Title, Handler) =>
            {
                const B = document.createElement("button");
                B.type = "button";
                B.className = "ar-hud-pill";
                B.dataset.pursuitAction = Key;
                B.title = Title;
                B.textContent = Label;
                B.addEventListener("click", (E) => { E.stopPropagation(); Handler(); });
                Strip.appendChild(B);
                return B;
            };

            this.DomBtns = {
                chase: MakeBtn("chase", "🚨 PURSUIT",      "Start / clear active Police Cruiser + Helicopter + Drone pursuit", () => this.ToggleManualPursuit()),
                rl:    MakeBtn("rl",    "🧠 AI SELF-TRAIN","Hands-free RL Self-Play: Watch AI Evader & AI Police train themselves!", () => this.ToggleSelfPlayMode()),
                warp:  MakeBtn("warp",  "⚡ 20× SPEED",    "Cycle RL training physics speed (1× · 8× · 20× · 40×)", () => this.CycleTimeWarp()),
                boost: MakeBtn("boost", "+12 GENS",        "Instantly train +12 RL generations", () => this.FastTrainGenerations(12)),
                cam:   MakeBtn("cam",   "🎥 EVADER",       "Cycle AI spectator camera (Evader · Police Cruiser · Helicopter)", () => this.CycleSpectatorTarget())
            };
            Stage.appendChild(Strip);
        }
        this.ControlStrip = Strip;
        this.RefreshControlStrip();
    }

    RefreshControlStrip()
    {
        if (!this.ControlStrip || !this.DomBtns)
            return;
        const Hidden = !this.Enabled || Boolean(this.Host?.FreeCamera) || this.Host?.RoadEditor?.ActiveWorkspace === "roadstudio" || Boolean(this.Host?.Dock?.Clean);
        this.ControlStrip.classList.toggle("hidden", Hidden);

        const IsRL = this.ControlMode === "selfplay";
        this.DomBtns.chase.textContent = this.PursuitActive ? "🚨 WANTED · CLEAR" : "🚨 TRIGGER CHASE";
        this.DomBtns.chase.classList.toggle("crit", this.PursuitActive && !IsRL);
        this.DomBtns.chase.style.display = IsRL ? "none" : "";

        this.DomBtns.rl.textContent = IsRL ? "🎮 DRIVE YOURSELF" : "🧠 WATCH AI TRAIN";
        this.DomBtns.rl.classList.toggle("active", IsRL);

        this.DomBtns.warp.style.display  = IsRL ? "" : "none";
        this.DomBtns.boost.style.display = IsRL ? "" : "none";
        this.DomBtns.cam.style.display   = IsRL ? "" : "none";

        this.DomBtns.warp.textContent = `⚡ ${this.TimeWarp}× SPEED`;
        this.DomBtns.warp.classList.toggle("warn", this.TimeWarp >= 20);
        this.DomBtns.cam.textContent  = `🎥 ${this.SpectatorTarget.toUpperCase()}`;
    }

    ToggleManualPursuit()
    {
        if (!this.Enabled)
            return;
        this.Host?.DrivingHud?.Audio?.PlayUiClick(1.1);
        if (this.PursuitActive)
            this.ClearPursuit("DISPATCH STAND DOWN — HEAT CLEARED");
        else
            this.StartPursuit("MANUAL PURSUIT DISPATCH — ALL UNITS ENGAGED!");
        this.RefreshControlStrip();
    }

    ToggleSelfPlayMode(ForceState = null)
    {
        if (!this.Enabled)
            return;
        const NextRL = ForceState !== null ? Boolean(ForceState) : (this.ControlMode !== "selfplay");
        this.Host?.DrivingHud?.Audio?.PlayUiClick(NextRL ? 1.25 : 0.92);
        if (NextRL)
        {
            this.ControlMode   = "selfplay";
            this.TimeWarp      = 20; // default fast-training speed so user immediately sees rapid generation progress!
            this.PursuitActive = true;
            this.SetUnitsVisible(true);
            this.ResetSelfPlayEpisode();
            this.Host?.Shell?.Announce("RL Self-Play Active (20× Turbo): AI Evader vs AI Police + Helicopter + 3 Drones!");
        }
        else
        {
            this.ControlMode    = "player";
            this.TimeWarp       = 1;
            this.SpectatorTarget = "evader";
            this.Host.Vehicle.SubstepOverride = undefined;
            this.PoliceVehicle.SubstepOverride = undefined;
            this.ClearPursuit("PLAYER DRIVING RESTORED — TRAINED POLICE AI ON PATROL");
        }
        this.RefreshControlStrip();
    }

    CycleTimeWarp()
    {
        const Speeds = [1, 8, 20, 40];
        this.TimeWarp = Speeds[(Speeds.indexOf(this.TimeWarp) + 1) % Speeds.length];
        this.Host?.DrivingHud?.Audio?.PlayUiClick(1.08);
        this.RefreshControlStrip();
    }

    CycleSpectatorTarget()
    {
        const Order = ["evader", "police", "helicopter"];
        this.SpectatorTarget = Order[(Order.indexOf(this.SpectatorTarget) + 1) % Order.length];
        this.Host?.DrivingHud?.Audio?.PlayUiClick(1.05);
        this.RefreshControlStrip();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                              TRAFFIC LAW ENFORCEMENT & PURSUIT TRIGGERS
    //--------------------------------------------------------------------------------------------------------------------

    QueryPostedSpeedLimitKmh()
    {
        const Pos = this.Host?.Vehicle?.Position || [0, 0, 0];
        if (this.LevelKey === "city")
            return QueryCitySpeedLimitKmh(Pos);
        return 90;
    }

    StartPursuit(Reason = "TRAFFIC VIOLATION")
    {
        const WasActive = this.PursuitActive;
        this.PursuitActive   = true;
        this.ViolationReason = Reason;
        this.BannerMessage   = `🚨 ${Reason}`;
        this.BannerTimer     = 4.5;
        this.BustedTimer     = 0.0;
        this.EscapeTimer     = 0.0;
        this.SetUnitsVisible(true);

        // Spawn/reposition units within tactical pursuit range if cruiser was parked underground or > 130 m away
        const Ev = this.Host.Vehicle;
        const Fwd = Ev.QueryForward();
        const Dist = Math.hypot(this.PoliceVehicle.Position[0] - Ev.Position[0], this.PoliceVehicle.Position[1] - Ev.Position[1]);
        if (this.PoliceVehicle.Position[2] < -10.0 || Dist > 125.0)
        {
            const SpawnX = Ev.Position[0] - Fwd[0] * 22.0;
            const SpawnY = Ev.Position[1] - Fwd[1] * 22.0;
            const Yaw    = Math.atan2(Fwd[1], Fwd[0]);
            this.PoliceVehicle.Respawn([SpawnX, SpawnY, Math.max(0.65, Ev.Position[2] + 0.05)], Yaw);
            this.PoliceVehicle.LinearVelocity = [Fwd[0] * 18.0, Fwd[1] * 18.0, 0.0];
        }
        if (!WasActive)
        {
            this.HeliPosition = [Ev.Position[0] - Fwd[0] * 16.0, Ev.Position[1] - Fwd[1] * 16.0, Ev.Position[2] + 24.5];
            for (let I = 0; I < 3; ++I)
            {
                this.DroneStates[I].Pos = [
                    Ev.Position[0] - Fwd[0] * (12.0 + I * 4.0) + (I - 1) * 5.0,
                    Ev.Position[1] - Fwd[1] * (12.0 + I * 4.0) - (I - 1) * 5.0,
                    Ev.Position[2] + 3.2
                ];
                this.DroneStates[I].Vel = [Fwd[0] * 16.0, Fwd[1] * 16.0, 0.0];
            }
            this.Host?.DrivingHud?.Audio?.PlayPoliceAlert(this.Clock);
            this.Host?.Shell?.Announce(`🚨 ${Reason} — Police Cruiser, Helicopter & 3 Interceptor Drones deployed!`);
        }
        this.RefreshControlStrip();
    }

    ClearPursuit(Message = "ESCAPED — PURSUIT CLEARED")
    {
        this.PursuitActive   = false;
        this.ViolationReason = "";
        this.SpeedingTimer   = 0.0;
        this.BustedTimer     = 0.0;
        this.EscapeTimer     = 0.0;
        this.BannerMessage   = Message;
        this.BannerTimer     = 3.4;
        this.Host?.DrivingHud?.Audio?.StopSiren();
        if (this.LevelKey !== "city")
        {
            this.PoliceVehicle.Respawn([0.0, 0.0, -45.0], 0.0);
            this.SetUnitsVisible(false);
        }
        this.RefreshControlStrip();
    }

    CheckTrafficViolations(Step)
    {
        if (!this.LawEnforcementEnabled || this.PursuitActive || this.ControlMode !== "player")
            return;
        const Ev = this.Host?.Vehicle;
        if (!Ev || Ev.Hidden)
            return;

        const SpeedMps = Math.hypot(Ev.LinearVelocity[0], Ev.LinearVelocity[1]);
        const SpeedKmh = SpeedMps * 3.6;
        const LimitKmh = this.QueryPostedSpeedLimitKmh();

        // ① Speeding (> posted limit + 14 km/h sustained for 0.85 s)
        if (SpeedKmh > LimitKmh + 14.0)
        {
            this.SpeedingTimer += Step;
            if (this.SpeedingTimer >= 0.85)
            {
                this.StartPursuit(`SPEEDING (${Math.round(SpeedKmh)} IN ${LimitKmh} KM/H ZONE)`);
                return;
            }
        }
        else
        {
            this.SpeedingTimer = Math.max(0.0, this.SpeedingTimer - Step * 1.5);
        }

        // ② Running a RED Hovering Intersection Traffic Light
        if (this.Host.TrafficLights && SpeedMps > 6.5)
        {
            const Sig = this.Host.TrafficLights.QueryNearestSignal(Ev.Position);
            if (Sig && Sig.Aspect === "RED" && Sig.Distance < 13.0)
            {
                this.StartPursuit(`RAN RED SIGNAL AT ${Sig.Name.toUpperCase()}`);
                return;
            }
        }

        // ③ Reckless Property Damage (cones knocked or crates smashed)
        const ConeHits = this.Host.Cones?.Metrics?.Hits || 0;
        const Breaks   = this.Host.Fracture?.Metrics?.Breaks || 0;
        if (ConeHits > this.LastConeHits || Breaks > this.LastFractureBreaks)
        {
            this.LastConeHits       = ConeHits;
            this.LastFractureBreaks = Breaks;
            if (this.LevelKey === "city")
            {
                this.StartPursuit("RECKLESS PROPERTY DAMAGE");
                return;
            }
        }
        this.LastConeHits       = ConeHits;
        this.LastFractureBreaks = Breaks;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                         9-RAY 2D LIDAR & STATE OBSERVATION FOR NEURAL POLICIES
    //--------------------------------------------------------------------------------------------------------------------

    CastLidar2D(OriginX, OriginY, BaseYaw, OutHitBuffer = null)
    {
        const Boxes = this.FlatObstacleBoxes;
        const NBox  = Boxes.length;
        const Clearances = new Float32Array(LidarAngles.length);

        for (let R = 0; R < LidarAngles.length; ++R)
        {
            const Ang = BaseYaw + LidarAngles[R];
            const DX  = Math.cos(Ang);
            const DY  = Math.sin(Ang);
            const InvX = Math.abs(DX) > 1.0e-6 ? (1.0 / DX) : 1.0e6;
            const InvY = Math.abs(DY) > 1.0e-6 ? (1.0 / DY) : 1.0e6;

            let BestT = LidarMaxRange;
            for (let B = 0; B < NBox; B += 4)
            {
                const T1 = (Boxes[B]     - OriginX) * InvX;
                const T2 = (Boxes[B + 2] - OriginX) * InvX;
                const T3 = (Boxes[B + 1] - OriginY) * InvY;
                const T4 = (Boxes[B + 3] - OriginY) * InvY;

                const TMin = Math.max(Math.min(T1, T2), Math.min(T3, T4));
                const TMax = Math.min(Math.max(T1, T2), Math.max(T3, T4));
                if (TMax >= 0.0 && TMin <= TMax && TMin >= 0.0 && TMin < BestT)
                    BestT = TMin;
            }

            Clearances[R] = BestT / LidarMaxRange;
            if (OutHitBuffer)
            {
                OutHitBuffer[R * 3 + 0] = OriginX + DX * BestT;
                OutHitBuffer[R * 3 + 1] = OriginY + DY * BestT;
                OutHitBuffer[R * 3 + 2] = Clearances[R];
            }
        }
        return Clearances;
    }

    ComposePolicyInputs(SelfVehicle, OpponentPos, OutBuffer, OutLidarHits = null)
    {
        const Pos  = SelfVehicle.Position;
        const Fwd  = SelfVehicle.QueryForward();
        const Yaw  = Math.atan2(Fwd[1], Fwd[0]);
        const Right = [Fwd[1], -Fwd[0]];

        const Rays = this.CastLidar2D(Pos[0], Pos[1], Yaw, OutLidarHits);
        for (let I = 0; I < 9; ++I)
            OutBuffer[I] = Rays[I] * 2.0 - 1.0; // [-1..+1]

        const Vel = SelfVehicle.LinearVelocity;
        const VFwd = Vel[0] * Fwd[0]   + Vel[1] * Fwd[1];
        const VLat = Vel[0] * Right[0] + Vel[1] * Right[1];
        const YawRate = SelfVehicle.AngularVelocity ? SelfVehicle.AngularVelocity[2] : 0.0;

        OutBuffer[9]  = ClampScalar(VFwd / 32.0, -1.0, 1.5);
        OutBuffer[10] = ClampScalar(VLat / 14.0, -1.0, 1.0);
        OutBuffer[11] = ClampScalar(YawRate / 2.5, -1.0, 1.0);

        const Road = QueryNearestCityRoadFrame(Pos[0], Pos[1]);
        // Pick road tangent direction aligned with current car heading
        const DotT = Road.Tangent[0] * Fwd[0] + Road.Tangent[1] * Fwd[1];
        const Sign = DotT >= 0.0 ? 1.0 : -1.0;
        const TX = Road.Tangent[0] * Sign, TY = Road.Tangent[1] * Sign;
        const SinErr = Fwd[0] * TY - Fwd[1] * TX; // + means road tangent is to the left (+Y)
        OutBuffer[12] = ClampScalar(SinErr * 1.6, -1.0, 1.0);
        OutBuffer[13] = ClampScalar((Road.LateralOffset * Sign) / 8.0, -1.0, 1.0);

        const OX = OpponentPos[0] - Pos[0];
        const OY = OpponentPos[1] - Pos[1];
        const ODist = Math.hypot(OX, OY) || 1.0;
        // Bearing in vehicle frame: +Left (+Y local) = positive steering!
        const LocalLeft = (OX * (-Fwd[1]) + OY * Fwd[0]) / ODist;
        OutBuffer[14] = ClampScalar(LocalLeft * 1.4, -1.0, 1.0);
        OutBuffer[15] = ClampScalar(ODist / 85.0, 0.0, 1.2);
        return { Rays, VFwd, RoadDist: Road.Distance, ODist };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                      CHASSIS-TO-CHASSIS VEHICLE COLLISION & PIT MANEUVER PHYSICS
    //--------------------------------------------------------------------------------------------------------------------

    ResolveVehicleCollision(Evader, Police, Sparks = null)
    {
        const EFwd = Evader.QueryForward();
        const PFwd = Police.QueryForward();
        const Offsets = [-1.48, 0.0, 1.48];
        const Radius  = 0.96;
        const MinSumR = Radius * 2.0;

        let HitImpulse = 0.0;
        let HitPoint   = null;

        for (let I = 0; I < 3; ++I)
        {
            const EX = Evader.Position[0] + EFwd[0] * Offsets[I];
            const EY = Evader.Position[1] + EFwd[1] * Offsets[I];
            const EZ = Evader.Position[2];
            for (let J = 0; J < 3; ++J)
            {
                const PX = Police.Position[0] + PFwd[0] * Offsets[J];
                const PY = Police.Position[1] + PFwd[1] * Offsets[J];
                const PZ = Police.Position[2];
                if (Math.abs(EZ - PZ) > 1.35)
                    continue;

                const DX = EX - PX;
                const DY = EY - PY;
                const Dist = Math.hypot(DX, DY);
                if (Dist >= MinSumR || Dist < 1.0e-5)
                    continue;

                const NX = DX / Dist;
                const NY = DY / Dist;
                const Pen = MinSumR - Dist;

                // Separate chassis cleanly
                Evader.Position[0] += NX * Pen * 0.52;
                Evader.Position[1] += NY * Pen * 0.52;
                Police.Position[0] -= NX * Pen * 0.48;
                Police.Position[1] -= NY * Pen * 0.48;

                const RVX = Evader.LinearVelocity[0] - Police.LinearVelocity[0];
                const RVY = Evader.LinearVelocity[1] - Police.LinearVelocity[1];
                const RelNormal = RVX * NX + RVY * NY;
                if (RelNormal < 0.0)
                {
                    const Restitution = 0.28;
                    const DeltaV = -(1.0 + Restitution) * RelNormal * 0.5;
                    Evader.LinearVelocity[0] += NX * DeltaV;
                    Evader.LinearVelocity[1] += NY * DeltaV;
                    Police.LinearVelocity[0] -= NX * DeltaV;
                    Police.LinearVelocity[1] -= NY * DeltaV;

                    // PIT Maneuver Yaw Torque: lever arm r × J spins rear-clipped car realistically!
                    const LeverE = (EX - Evader.Position[0]) * NY - (EY - Evader.Position[1]) * NX;
                    const LeverP = (PX - Police.Position[0]) * (-NY) - (PY - Police.Position[1]) * (-NX);
                    Evader.AngularVelocity[2] += ClampScalar(LeverE * DeltaV * 0.22, -2.4, 2.4);
                    Police.AngularVelocity[2] += ClampScalar(LeverP * DeltaV * 0.16, -1.8, 1.8);

                    HitImpulse = Math.max(HitImpulse, DeltaV);
                    HitPoint   = [0.5 * (EX + PX), 0.5 * (EY + PY), 0.5 * (EZ + PZ) + 0.15];
                }
            }
        }

        if (HitImpulse > 1.2 && HitPoint && Sparks?.Emit)
        {
            Sparks.Emit([{
                Point:    HitPoint,
                Velocity: [Evader.LinearVelocity[0] * 0.5, Evader.LinearVelocity[1] * 0.5, 3.2],
                Normal:   [0.0, 0.0, 1.0],
                Strength: ClampScalar(HitImpulse * 0.35, 1.2, 5.0),
                Rim:      null
            }], 1.0 / 60.0);
        }
        return HitImpulse;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                       HELICOPTER & 3 POLICE INTERCEPTOR DRONE AERIAL PURSUIT SOLVER
    //--------------------------------------------------------------------------------------------------------------------

    AdvanceAerialUnits(Step, Evader)
    {
        const EvPos = Evader.Position;
        const EvVel = Evader.LinearVelocity;
        const Fwd   = Evader.QueryForward();

        // ① Police Pursuit Helicopter: overhead tracking + alley/bridge LOS occlusion check!
        this.HeliRotorAngle = (this.HeliRotorAngle + Step * 44.0) % (Math.PI * 2.0);
        this.HeliTailAngle  = (this.HeliTailAngle  + Step * 76.0) % (Math.PI * 2.0);

        const RawOccluded = this.LevelKey === "city" && IsPointOccludedFromHelicopter(EvPos);
        this.HeliLosClear = !RawOccluded || this.DroneLockActive;

        let DesiredHeliX, DesiredHeliY;
        if (this.PursuitActive)
        {
            if (this.HeliLosClear)
            {
                this.HeliSpotTarget[0] = EvPos[0] + EvVel[0] * 0.25;
                this.HeliSpotTarget[1] = EvPos[1] + EvVel[1] * 0.25;
                this.HeliSpotTarget[2] = EvPos[2];
                DesiredHeliX = EvPos[0] - Fwd[0] * 14.0 + Math.cos(this.Clock * 0.55) * 10.0;
                DesiredHeliY = EvPos[1] - Fwd[1] * 14.0 + Math.sin(this.Clock * 0.55) * 10.0;
            }
            else
            {
                // Lost visual inside covered alley -> sweep search pattern around last known coordinates!
                DesiredHeliX = this.HeliSpotTarget[0] + Math.cos(this.Clock * 1.4) * 18.0;
                DesiredHeliY = this.HeliSpotTarget[1] + Math.sin(this.Clock * 1.4) * 18.0;
            }
        }
        else
        {
            // Routine high-altitude city patrol orbit
            DesiredHeliX = -45.0 + Math.cos(this.Clock * 0.22) * 75.0;
            DesiredHeliY = Math.sin(this.Clock * 0.22) * 65.0;
            this.HeliSpotTarget = [DesiredHeliX + 18.0, DesiredHeliY, 0.0];
        }

        const DesiredHeliZ = Math.max(EvPos[2] + 22.0, 24.5);
        const HX = (DesiredHeliX - this.HeliPosition[0]) * 2.4;
        const HY = (DesiredHeliY - this.HeliPosition[1]) * 2.4;
        const HZ = (DesiredHeliZ - this.HeliPosition[2]) * 2.0;
        this.HeliVelocity[0] += (HX - this.HeliVelocity[0]) * Math.min(1.0, Step * 3.5);
        this.HeliVelocity[1] += (HY - this.HeliVelocity[1]) * Math.min(1.0, Step * 3.5);
        this.HeliVelocity[2] += (HZ - this.HeliVelocity[2]) * Math.min(1.0, Step * 3.5);

        this.HeliPosition[0] += this.HeliVelocity[0] * Step;
        this.HeliPosition[1] += this.HeliVelocity[1] * Step;
        this.HeliPosition[2] += this.HeliVelocity[2] * Step;

        // ② 3 Fast Police Interceptor Drones: low-altitude street & alley pursuit formation!
        let AnyDroneClose = false;
        const Formation = [
            [-6.5,  4.2, 2.8],  // Left flank pursuit drone
            [-6.5, -4.2, 2.8],  // Right flank pursuit drone
            [ 9.5,  0.0, 3.2]   // Forward cut-off interceptor drone!
        ];
        const Right = [Fwd[1], -Fwd[0]];

        for (let I = 0; I < 3; ++I)
        {
            const D = this.DroneStates[I];
            let GoalX, GoalY, GoalZ;
            if (this.PursuitActive)
            {
                const [FOff, ROff, ZOff] = Formation[I];
                const Weave = Math.sin(this.Clock * 3.2 + I * 2.1) * 1.4;
                GoalX = EvPos[0] + Fwd[0] * FOff + Right[0] * (ROff + Weave);
                GoalY = EvPos[1] + Fwd[1] * FOff + Right[1] * (ROff + Weave);
                GoalZ = Math.max(2.4, EvPos[2] + ZOff);
            }
            else
            {
                // Escort patrol above Police Cruiser when not in active chase
                const PPos = this.PoliceVehicle.Position;
                GoalX = PPos[0] + Math.cos(this.Clock * 1.2 + I * 2.09) * 6.0;
                GoalY = PPos[1] + Math.sin(this.Clock * 1.2 + I * 2.09) * 6.0;
                GoalZ = PPos[2] + 3.8;
            }

            const MaxDroneSpd = 34.0;
            let VX = (GoalX - D.Pos[0]) * 3.4;
            let VY = (GoalY - D.Pos[1]) * 3.4;
            const VLen = Math.hypot(VX, VY);
            if (VLen > MaxDroneSpd)
            {
                VX = (VX / VLen) * MaxDroneSpd;
                VY = (VY / VLen) * MaxDroneSpd;
            }
            D.Vel[0] += (VX - D.Vel[0]) * Math.min(1.0, Step * 6.0);
            D.Vel[1] += (VY - D.Vel[1]) * Math.min(1.0, Step * 6.0);
            D.Vel[2]  = (GoalZ - D.Pos[2]) * 4.0;

            D.Pos[0] += D.Vel[0] * Step;
            D.Pos[1] += D.Vel[1] * Step;
            D.Pos[2] += D.Vel[2] * Step;
            if (Math.hypot(D.Vel[0], D.Vel[1]) > 0.5)
                D.Yaw = Math.atan2(D.Vel[1], D.Vel[0]);

            const DistToEv = Math.hypot(D.Pos[0] - EvPos[0], D.Pos[1] - EvPos[1]);
            if (this.PursuitActive && DistToEv < 15.0)
                AnyDroneClose = true;
            // Mild tactical EMP drag pulse when lead interceptor drone holds tight < 5.2 m lock
            if (this.PursuitActive && DistToEv < 5.2)
            {
                const Drag = Math.max(0.96, 1.0 - Step * 0.35);
                Evader.LinearVelocity[0] *= Drag;
                Evader.LinearVelocity[1] *= Drag;
            }
        }
        this.DroneLockActive = AnyDroneClose;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                       SELF-PLAY RL EPISODE STEPPING & INSTANT HEADLESS BOOST
    //--------------------------------------------------------------------------------------------------------------------

    ResetSelfPlayEpisode()
    {
        const Scen = SelfPlayScenarios[this.ScenarioCursor % SelfPlayScenarios.length];
        this.ScenarioCursor++;

        const Ev = this.Host.Vehicle;
        const Po = this.PoliceVehicle;
        Ev.Respawn([Scen.Evader[0], Scen.Evader[1], Scen.Evader[2]], Scen.Evader[3]);
        Po.Respawn([Scen.Police[0], Scen.Police[1], Scen.Police[2]], Scen.Police[3]);

        // Give both vehicles a clean rolling start (11 m/s) so episodes jump straight into dynamic cornering & pursuit!
        const EF = Ev.QueryForward();
        const PF = Po.QueryForward();
        Ev.LinearVelocity = [EF[0] * 11.0, EF[1] * 11.0, 0.0];
        Po.LinearVelocity = [PF[0] * 12.0, PF[1] * 12.0, 0.0];

        this.EpisodeClock   = 0.0;
        this.EvaderEpReturn = 0.0;
        this.PoliceEpReturn = 0.0;
        this.BustedTimer    = 0.0;
        this.PrevSeparation = Math.hypot(Ev.Position[0] - Po.Position[0], Ev.Position[1] - Po.Position[1]);
    }

    StepSelfPlayPhysics(SubStep, RecordSparks = true)
    {
        const Ev = this.Host.Vehicle;
        const Po = this.PoliceVehicle;

        // ① Evaluate 16-input Lidar + Road + Opponent sensors & Neural Policies for BOTH cars!
        const EvObs = this.ComposePolicyInputs(Ev, Po.Position, this.EvaderInputs, this.EvaderLidarHits);
        const LeadTarget = [
            Ev.Position[0] + Ev.LinearVelocity[0] * 0.45,
            Ev.Position[1] + Ev.LinearVelocity[1] * 0.45,
            Ev.Position[2]
        ];
        const PoObs = this.ComposePolicyInputs(Po, LeadTarget, this.PoliceInputs, this.PoliceLidarHits);

        const EvCtrl = this.EvaderBrain.Forward(this.EvaderInputs);
        const PoCtrl = this.PoliceBrain.Forward(this.PoliceInputs);

        Ev.Advance(EvCtrl, SubStep);
        Po.Advance(PoCtrl, SubStep);

        const Impact = this.ResolveVehicleCollision(Ev, Po, RecordSparks ? this.Host.Sparks : null);

        // ② Compute Dense RL Step Rewards
        const Sep = Math.hypot(Ev.Position[0] - Po.Position[0], Ev.Position[1] - Po.Position[1]);
        const SepDelta = Sep - this.PrevSeparation;
        this.PrevSeparation = Sep;

        const EvMinRay = Math.min(EvObs.Rays[3], EvObs.Rays[4], EvObs.Rays[5]);
        const PoMinRay = Math.min(PoObs.Rays[3], PoObs.Rays[4], PoObs.Rays[5]);
        const InAlleyCover = IsPointOccludedFromHelicopter(Ev.Position);

        // Evader wants high clean forward road speed, wide Lidar clearance, alley cover, and growing distance from Police!
        let R_Ev = (EvObs.VFwd * 0.11 + SepDelta * 1.8) * SubStep;
        if (EvObs.RoadDist < 9.5)  R_Ev += 1.4 * SubStep;
        else                       R_Ev -= 2.2 * SubStep;
        if (InAlleyCover)          R_Ev += 2.0 * SubStep;
        if (EvMinRay < 0.075)      R_Ev -= 6.5 * SubStep; // scraped/hit building wall!
        if (EvObs.VFwd < 2.0)      R_Ev -= 3.2 * SubStep; // stalled!

        // Police Pursuer wants rapid closing rate, tight proximity lock, clean road cornering, and PIT contact!
        let R_Po = (-SepDelta * 2.2 + Math.max(0.0, 1.0 - Sep / 75.0) * 2.4) * SubStep;
        if (PoObs.RoadDist < 10.5) R_Po += 0.9 * SubStep;
        if (PoMinRay < 0.075)      R_Po -= 5.8 * SubStep;
        if (PoObs.VFwd < 2.0)      R_Po -= 2.8 * SubStep;
        if (Impact > 1.0)          R_Po += 4.5;

        this.EvaderEpReturn += R_Ev;
        this.PoliceEpReturn += R_Po;
        this.EpisodeClock   += SubStep;

        // Check terminal BUSTED condition (Police pins Evader < 3.0 m/s within 7.5 m)
        if (Sep < 7.5 && Math.hypot(Ev.LinearVelocity[0], Ev.LinearVelocity[1]) < 3.2)
            this.BustedTimer += SubStep;
        else
            this.BustedTimer = Math.max(0.0, this.BustedTimer - SubStep);

        if (this.BustedTimer >= 0.85)
        {
            this.EvaderEpReturn -= 16.0;
            this.PoliceEpReturn += 20.0;
            this.TotalBusts++;
            this.FinishSelfPlayEpisode();
        }
        else if (this.EpisodeClock >= this.EpisodeMaxSeconds)
        {
            if (Sep > 22.0)
            {
                this.EvaderEpReturn += 12.0;
                this.TotalEscapes++;
            }
            this.FinishSelfPlayEpisode();
        }
    }

    FinishSelfPlayEpisode()
    {
        this.EvaderBrain.RecordEpisodeReturn(this.EvaderEpReturn);
        this.PoliceBrain.RecordEpisodeReturn(this.PoliceEpReturn);
        this.EpisodeIndex++;
        this.ResetSelfPlayEpisode();
    }

    // 📝 Instantly runs N full RL generations (N * 6 episodes) synchronously for rapid training & unit-test verification!
    FastTrainGenerations(GenCount = 12)
    {
        this.RebuildLidarObstacles();
        this.PoliceVehicle.Surfaces = this.Host.Vehicle.Surfaces;
        const PriorEv = this.Host.Vehicle.SubstepOverride;
        const PriorPo = this.PoliceVehicle.SubstepOverride;
        this.Host.Vehicle.SubstepOverride  = 1.0 / 160.0;
        this.PoliceVehicle.SubstepOverride = 1.0 / 160.0;
        try
        {
            const TargetGen = this.EvaderBrain.Generation + GenCount;
            const SubStep   = 1.0 / 25.0;
            let Guard = 0;
            while (this.EvaderBrain.Generation < TargetGen && Guard++ < GenCount * 6 * 240)
                this.StepSelfPlayPhysics(SubStep, false);
        }
        finally
        {
            this.Host.Vehicle.SubstepOverride  = PriorEv;
            this.PoliceVehicle.SubstepOverride = PriorPo;
        }
        this.AdvanceAerialUnits(0.05, this.Host.Vehicle);
        this.SyncGpuOccupants(false);
        this.Host?.Shell?.Announce(`⚡ Trained to Generation ${this.EvaderBrain.Generation} (Busts: ${this.TotalBusts} · Escapes: ${this.TotalEscapes})`);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                  PER-FRAME UPDATE & GPU OCCUPANT SYNC
    //--------------------------------------------------------------------------------------------------------------------

    Advance(StepSeconds)
    {
        if (!this.Enabled)
            return false;
        const Step = ClampScalar(StepSeconds, 0.0, 0.05);
        if (Step <= 0.0)
            return false;

        this.Clock       += Step;
        this.StrobePhase  = (this.Clock * 7.5) % 1.0;
        this.BannerTimer  = Math.max(0.0, this.BannerTimer - Step);
        this.PoliceVehicle.Surfaces = this.Host.Vehicle.Surfaces;

        if (this.ControlMode === "selfplay")
        {
            const SubSteps = ClampScalar(Math.round(this.TimeWarp), 1, 40);
            const TurboStep = SubSteps >= 8 ? (1.0 / 180.0) : undefined;
            this.Host.Vehicle.SubstepOverride  = TurboStep;
            this.PoliceVehicle.SubstepOverride = TurboStep;
            for (let S = 0; S < SubSteps; ++S)
                this.StepSelfPlayPhysics(Step, S === SubSteps - 1);
            this.AdvanceAerialUnits(Step, this.Host.Vehicle);
            this.Host?.DrivingHud?.Audio?.UpdatePoliceSiren(
                true,
                Math.hypot(this.PoliceVehicle.Position[0] - this.Host.Vehicle.Position[0],
                           this.PoliceVehicle.Position[1] - this.Host.Vehicle.Position[1]),
                this.Clock,
                false
            );
            this.SyncGpuOccupants(false);
            return true;
        }

        // Player Driving Mode: monitor traffic laws & run trained Police AI when Wanted (or calm patrol on "city")!
        this.CheckTrafficViolations(Step);

        const Visible = this.PursuitActive || this.LevelKey === "city";
        if (!Visible)
            return false;

        const Ev = this.Host.Vehicle;
        if (this.PursuitActive)
        {
            // Drive Police Interceptor using the RL-trained PoliceBrain + tactical intercept lead!
            const TargetPos = this.HeliLosClear
                ? [Ev.Position[0] + Ev.LinearVelocity[0] * 0.40, Ev.Position[1] + Ev.LinearVelocity[1] * 0.40, Ev.Position[2]]
                : this.HeliSpotTarget;
            this.ComposePolicyInputs(this.PoliceVehicle, TargetPos, this.PoliceInputs, this.PoliceLidarHits);
            const Ctrl = this.PoliceBrain.Forward(this.PoliceInputs);
            // Supplement untrained Gen-1 steering with direct pursuit proportional assist in Player Mode so chases feel sharp even before training!
            const BlendLearned = ClampScalar((this.PoliceBrain.Generation - 1) / 8.0, 0.0, 1.0);
            const DirectSteer  = ClampScalar(this.PoliceInputs[14] * 1.35 + this.PoliceInputs[12] * 0.35, -1.0, 1.0);
            Ctrl.Steer = Ctrl.Steer * BlendLearned + DirectSteer * (1.0 - BlendLearned);
            Ctrl.Throttle = Math.max(Ctrl.Throttle, 0.82);

            this.PoliceVehicle.Advance(Ctrl, Step);
            this.ResolveVehicleCollision(Ev, this.PoliceVehicle, this.Host.Sparks);

            const Dist = Math.hypot(this.PoliceVehicle.Position[0] - Ev.Position[0], this.PoliceVehicle.Position[1] - Ev.Position[1]);
            const EvSpd = Math.hypot(Ev.LinearVelocity[0], Ev.LinearVelocity[1]);
            this.Host?.DrivingHud?.Audio?.UpdatePoliceSiren(true, Dist, this.Clock, Dist < 18.0);

            if (Dist < 7.8 && EvSpd < 2.2)
            {
                this.BustedTimer += Step;
                if (this.BustedTimer >= 2.6)
                {
                    this.TotalBusts++;
                    this.ClearPursuit("🚔 BUSTED! POLICE INTERCEPTOR PINNED VEHICLE");
                }
            }
            else
            {
                this.BustedTimer = Math.max(0.0, this.BustedTimer - Step * 0.8);
            }

            if (Dist > 92.0 && !this.HeliLosClear)
            {
                this.EscapeTimer += Step;
                if (this.EscapeTimer >= 9.0)
                {
                    this.TotalEscapes++;
                    this.ClearPursuit("🏁 ESCAPED PURSUIT IN ALLEY COVER!");
                }
            }
            else
            {
                this.EscapeTimer = Math.max(0.0, this.EscapeTimer - Step * 0.5);
            }
        }
        else
        {
            // Calm legal patrol cruise on City Pursuit streets until player breaks a traffic law!
            this.ComposePolicyInputs(this.PoliceVehicle, [40.0, 0.0, 0.0], this.PoliceInputs, null);
            const PatrolSteer = ClampScalar(this.PoliceInputs[12] * 1.2 - this.PoliceInputs[13] * 0.6, -0.8, 0.8);
            const Spd = Math.hypot(this.PoliceVehicle.LinearVelocity[0], this.PoliceVehicle.LinearVelocity[1]);
            this.PoliceVehicle.Advance({ Throttle: Spd < 13.5 ? 0.45 : 0.05, Brake: 0.0, Steer: PatrolSteer, Handbrake: false }, Step);
            const Impact = this.ResolveVehicleCollision(Ev, this.PoliceVehicle, this.Host.Sparks);
            if (Impact > 1.2)
                this.StartPursuit("HIT POLICE INTERCEPTOR — ASSAULT ON CRUISER!");
        }

        this.AdvanceAerialUnits(Step, Ev);
        this.SyncGpuOccupants(false);
        return true;
    }

    SyncGpuOccupants(ResetHistory = false)
    {
        const Block = this.Scene?.PoliceBlock;
        if (!Block)
            return;

        const UpdateOcc = (Idx, Xform) =>
        {
            if (Idx < 0 || !this.Scene.Occupants[Idx])
                return;
            const Occ = this.Scene.Occupants[Idx];
            if (ResetHistory)
                Occ.PreviousTransform.set(Xform);
            else
                Occ.PreviousTransform.set(Occ.Transform);
            Occ.Transform = Xform;
            Occ.Moving = !Occ.Inactive;
            if (Occ.LocalBounds)
                Occ.Bounds = this.Scene.ComputeOccupantBounds ? Occ.Bounds : Occ.Bounds;
        };

        // ① Police ControlVehicle Body + 4 Wheels
        UpdateOcc(Block.CruiserBody, this.PoliceVehicle.QueryBodyTransform());
        for (let W = 0; W < 4; ++W)
            UpdateOcc(Block.CruiserWheels[W], this.PoliceVehicle.QueryWheelTransform(W));

        // ② Police Helicopter Body + Spinning Main Rotor + Spinning Tail Rotor
        const HV = this.HeliVelocity;
        const HYaw = Math.hypot(HV[0], HV[1]) > 0.8
            ? Math.atan2(HV[1], HV[0])
            : Math.atan2(this.HeliSpotTarget[1] - this.HeliPosition[1], this.HeliSpotTarget[0] - this.HeliPosition[0]);
        const HPitch = ClampScalar(Math.hypot(HV[0], HV[1]) * 0.012, -0.22, 0.22);
        const QHeli  = MultiplyQuaternion(ConstructAxisQuaternion([0, 0, 1], HYaw), ConstructAxisQuaternion([0, 1, 0], HPitch));
        UpdateOcc(Block.HeliBody, ConstructRigidTransform(this.HeliPosition, QHeli));

        const MastWorld = [
            this.HeliPosition[0] + RotateVector(QHeli, [0.10, 0.0, 2.16])[0],
            this.HeliPosition[1] + RotateVector(QHeli, [0.10, 0.0, 2.16])[1],
            this.HeliPosition[2] + RotateVector(QHeli, [0.10, 0.0, 2.16])[2]
        ];
        const QMain = MultiplyQuaternion(QHeli, ConstructAxisQuaternion([0, 0, 1], this.HeliRotorAngle));
        UpdateOcc(Block.HeliMainRotor, ConstructRigidTransform(MastWorld, QMain));

        const TailOff = RotateVector(QHeli, [-4.18, 0.12, 1.72]);
        const TailWorld = [this.HeliPosition[0] + TailOff[0], this.HeliPosition[1] + TailOff[1], this.HeliPosition[2] + TailOff[2]];
        const QTail = MultiplyQuaternion(QHeli, ConstructAxisQuaternion([0, 1, 0], this.HeliTailAngle));
        UpdateOcc(Block.HeliTailRotor, ConstructRigidTransform(TailWorld, QTail));

        // ③ 3 Police Interceptor Drones
        for (let I = 0; I < 3; ++I)
        {
            const D = this.DroneStates[I];
            const QD = MultiplyQuaternion(
                ConstructAxisQuaternion([0, 0, 1], D.Yaw),
                ConstructAxisQuaternion([0, 1, 0], ClampScalar(Math.hypot(D.Vel[0], D.Vel[1]) * 0.014, 0.0, 0.28))
            );
            UpdateOcc(Block.Drones[I], ConstructRigidTransform(D.Pos, QD));
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                       REAL-TIME CLUSTERED RED/BLUE STROBES & HELICOPTER SPOTLIGHT
    //--------------------------------------------------------------------------------------------------------------------

    QueryDynamicLightRecords()
    {
        if (!this.Enabled || (!this.PursuitActive && this.LevelKey !== "city"))
            return [];

        const Out = [];
        const PPos = this.PoliceVehicle.Position;
        const PFwd = this.PoliceVehicle.QueryForward();
        const RedOn = this.StrobePhase < 0.5;

        if (this.PursuitActive)
        {
            // High-intensity alternating Crimson Red & Sapphire Blue Roof Lightbar Strobes
            Out.push({
                X: PPos[0], Y: PPos[1], Z: PPos[2] + 1.25,
                Type:      LightType.StreetLamp,
                Direction: [0.0, 0.0, -1.0],
                Colour:    RedOn ? [1.0, 0.06, 0.12] : [0.08, 0.38, 1.0],
                Intensity: 95.0,
                Reach:     36.0,
                Params:    [0.15, -0.45, 0.0, 1.0]
            });

            // Helicopter Overhead Gimbal Searchlight Spotlight Cone!
            const SX = this.HeliSpotTarget[0] - this.HeliPosition[0];
            const SY = this.HeliSpotTarget[1] - this.HeliPosition[1];
            const SZ = (this.HeliSpotTarget[2] || 0.0) - this.HeliPosition[2];
            const SL = Math.hypot(SX, SY, SZ) || 1.0;
            Out.push({
                X: this.HeliPosition[0], Y: this.HeliPosition[1], Z: this.HeliPosition[2] - 0.3,
                Type:      LightType.Floodlight,
                Direction: [SX / SL, SY / SL, SZ / SL],
                Colour:    this.HeliLosClear ? [0.95, 0.98, 1.0] : [1.0, 0.72, 0.32],
                Intensity: 135.0,
                Reach:     64.0,
                Params:    [Math.cos(16 * Math.PI / 180), Math.cos(28 * Math.PI / 180), 0.0, 1.0]
            });

            // Lead Police Drone Strobe
            const D0 = this.DroneStates[2];
            Out.push({
                X: D0.Pos[0], Y: D0.Pos[1], Z: D0.Pos[2],
                Type:      LightType.StreetLamp,
                Direction: [0.0, 0.0, -1.0],
                Colour:    RedOn ? [0.10, 0.45, 1.0] : [1.0, 0.08, 0.15],
                Intensity: 48.0,
                Reach:     18.0,
                Params:    [0.2, -0.4, 0.0, 1.0]
            });
        }

        // Police Cruiser High-Beam Pursuit Headlights
        Out.push({
            X: PPos[0] + PFwd[0] * 2.1, Y: PPos[1] + PFwd[1] * 2.1, Z: PPos[2] + 0.2,
            Type:      LightType.LowBeam,
            Direction: PFwd,
            Colour:    [0.92, 0.96, 1.0],
            Intensity: 45.0,
            Reach:     54.0,
            Params:    [0.88, 0.58, 0.0, 1.0]
        });

        return Out;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                           SPECTATOR CAMERA OVERRIDE FOR HANDS-FREE AI SELF-PLAY
    //--------------------------------------------------------------------------------------------------------------------

    QuerySpectatorPose()
    {
        if (this.ControlMode !== "selfplay")
            return null;
        if (this.SpectatorTarget === "police")
            return { Position: this.PoliceVehicle.Position, Forward: this.PoliceVehicle.QueryForward(), Speed: Math.hypot(this.PoliceVehicle.LinearVelocity[0], this.PoliceVehicle.LinearVelocity[1]) };
        if (this.SpectatorTarget === "helicopter")
        {
            return {
                Eye:    [this.HeliPosition[0], this.HeliPosition[1], this.HeliPosition[2] - 1.2],
                Target: this.Host.Vehicle.Position.slice(),
                Up:     [0.0, 0.0, 1.0],
                Fov:    56.0
            };
        }
        return null; // "evader" uses default Host.Vehicle camera rig
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                  ZERO-BLACK-BOX 3D + 2D HOLOGRAPHIC PURSUIT & RL TRAINING OVERLAY
    //--------------------------------------------------------------------------------------------------------------------

    RenderHudOverlay(Ctx, W, H, Cam, _Mode)
    {
        if (!this.Enabled)
            return;
        const Hud = this.Host.DrivingHud;
        if (!Hud)
            return;

        // ① 3D World Callouts on Police Cruiser, Helicopter Searchlight Ring & Police Drones
        if (this.PursuitActive || this.LevelKey === "city")
        {
            const PPos = this.PoliceVehicle.Position;
            const TopP = Hud.ProjectWorld([PPos[0], PPos[1], PPos[2] + 1.65], W, H, Cam);
            if (TopP)
            {
                const Dist = Math.round(Math.hypot(PPos[0] - this.Host.Vehicle.Position[0], PPos[1] - this.Host.Vehicle.Position[1]));
                const Col  = (this.StrobePhase < 0.5) ? "#ff4658" : "#4ca6ff";
                Ctx.save();
                Ctx.shadowColor = "rgba(0, 0, 0, 0.80)";
                Ctx.shadowBlur  = 6;
                Ctx.strokeStyle = Col;
                Ctx.lineWidth   = 2.4;
                Ctx.beginPath();
                Ctx.moveTo(TopP[0] - 8, TopP[1] - 8);
                Ctx.lineTo(TopP[0],     TopP[1]);
                Ctx.lineTo(TopP[0] + 8, TopP[1] - 8);
                Ctx.stroke();

                Ctx.fillStyle = Col;
                Ctx.font = "700 12px 'DM Sans', system-ui, sans-serif";
                Ctx.textAlign = "center";
                Ctx.fillText(`POLICE INTERCEPTOR · ${Dist}m`, TopP[0], TopP[1] - 16);
                Ctx.restore();
            }

            // 3D Helicopter Searchlight Ground Ring
            if (this.PursuitActive)
            {
                Ctx.beginPath();
                let Started = false;
                for (let I = 0; I <= 20; ++I)
                {
                    const A = (I / 20) * Math.PI * 2.0;
                    const R = 5.2;
                    const GP = Hud.ProjectWorld([
                        this.HeliSpotTarget[0] + Math.cos(A) * R,
                        this.HeliSpotTarget[1] + Math.sin(A) * R,
                        (this.HeliSpotTarget[2] || 0.0) + 0.12
                    ], W, H, Cam);
                    if (!GP) continue;
                    if (!Started) { Ctx.moveTo(GP[0], GP[1]); Started = true; }
                    else Ctx.lineTo(GP[0], GP[1]);
                }
                if (Started)
                {
                    Ctx.strokeStyle = this.HeliLosClear ? "rgba(220, 248, 255, 0.55)" : "rgba(255, 184, 72, 0.45)";
                    Ctx.lineWidth = 1.6;
                    Ctx.setLineDash?.([6, 4]);
                    Ctx.stroke();
                    Ctx.setLineDash?.([]);
                }
            }
        }

        // ② 3D Lidar Ray Fan Visualization in Self-Play RL Mode
        if (this.ControlMode === "selfplay" && this.ShowLidarRays)
        {
            const DrawLidarFan = (Car, HitBuf, BaseRGB) =>
            {
                const Orig = Hud.ProjectWorld([Car.Position[0], Car.Position[1], Car.Position[2] - 0.15], W, H, Cam);
                if (!Orig)
                    return;
                for (let R = 0; R < LidarAngles.length; ++R)
                {
                    const EndX = HitBuf[R * 3 + 0];
                    const EndY = HitBuf[R * 3 + 1];
                    const Frac = HitBuf[R * 3 + 2];
                    const EndP = Hud.ProjectWorld([EndX, EndY, Car.Position[2] - 0.15], W, H, Cam);
                    if (!EndP)
                        continue;
                    Ctx.beginPath();
                    Ctx.moveTo(Orig[0], Orig[1]);
                    Ctx.lineTo(EndP[0], EndP[1]);
                    Ctx.strokeStyle = Frac < 0.25 ? "rgba(255, 68, 82, 0.65)" : `rgba(${BaseRGB}, 0.36)`;
                    Ctx.lineWidth   = Frac < 0.25 ? 1.8 : 1.1;
                    Ctx.stroke();
                }
            };
            DrawLidarFan(this.Host.Vehicle,  this.EvaderLidarHits, "82, 242, 188");
            DrawLidarFan(this.PoliceVehicle, this.PoliceLidarHits, "92, 168, 255");
        }

        // ③ Pure Optical Floating Pursuit / RL Training Status Header (ZERO black background boxes!)
        Ctx.save();
        Ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
        Ctx.shadowBlur  = 7;
        Ctx.textAlign   = "center";

        if (this.ControlMode === "selfplay")
        {
            const Gen  = this.EvaderBrain.Generation;
            const Cand = this.EvaderBrain.CandidateIndex + 1;
            const Pop  = this.EvaderBrain.PopSize;
            const TopY = 22;

            Ctx.fillStyle = "#6ef7c8";
            Ctx.font = "700 14px 'DM Sans', system-ui, sans-serif";
            Ctx.fillText(`🧠 RL SELF-TRAINING · GEN ${Gen} (ROLLOUT ${Cand}/${Pop}) · ${this.TimeWarp}× TURBO`, W * 0.5, TopY);

            Ctx.fillStyle = "#e8f8f5";
            Ctx.font = "600 11px 'JetBrains Mono', monospace";
            Ctx.fillText(
                `EVADER R: ${this.EvaderEpReturn.toFixed(1)}   |   POLICE R: ${this.PoliceEpReturn.toFixed(1)}   |   ESCAPES ${this.TotalEscapes} · BUSTS ${this.TotalBusts}   |   σ=${this.EvaderBrain.Sigma.toFixed(2)}`,
                W * 0.5, TopY + 17
            );

            // Live Floating Optical Reward Learning Curve Sparkline (no black box — pure glowing lines!)
            const HistE = this.EvaderBrain.RewardHistory;
            const HistP = this.PoliceBrain.RewardHistory;
            if (HistE.length >= 2)
            {
                const GX = W * 0.5 - 120, GY = TopY + 26, GW = 240, GH = 26;
                const All = [...HistE, ...HistP];
                const MinR = Math.min(...All, -5.0);
                const MaxR = Math.max(...All,  5.0);
                const Span = Math.max(1.0, MaxR - MinR);

                const DrawCurve = (Arr, Color) =>
                {
                    Ctx.beginPath();
                    for (let I = 0; I < Arr.length; ++I)
                    {
                        const X = GX + (I / Math.max(1, Arr.length - 1)) * GW;
                        const Y = GY + GH - ((Arr[I] - MinR) / Span) * GH;
                        if (I === 0) Ctx.moveTo(X, Y);
                        else         Ctx.lineTo(X, Y);
                    }
                    Ctx.strokeStyle = Color;
                    Ctx.lineWidth = 2.0;
                    Ctx.stroke();
                };
                DrawCurve(HistE, "#5ef2b4");
                DrawCurve(HistP, "#ff5c70");
            }
        }
        else if (this.PursuitActive || this.BannerTimer > 0.0)
        {
            const FlashCol = this.PursuitActive
                ? (this.StrobePhase < 0.5 ? "#ff4e60" : "#58aeff")
                : "#6ef7c8";
            Ctx.fillStyle = FlashCol;
            Ctx.font = "800 15px 'DM Sans', system-ui, sans-serif";
            const Header = this.PursuitActive
                ? `🚨 WANTED · ${this.ViolationReason}`
                : this.BannerMessage;
            Ctx.fillText(Header, W * 0.5, 24);

            if (this.PursuitActive)
            {
                const LosTxt = this.HeliLosClear ? "HELI SPOTLIGHT: LOCKED" : "HELI LOS: OCCLUDED (ALLEY COVER)";
                const DroneTxt = this.DroneLockActive ? "3 DRONES: IN RANGE" : "3 DRONES: INTERCEPTING";
                Ctx.fillStyle = "#eef8ff";
                Ctx.font = "600 10.5px 'JetBrains Mono', monospace";
                Ctx.fillText(`${LosTxt}  ·  ${DroneTxt}`, W * 0.5, 41);
            }
        }
        Ctx.restore();
    }

    QuerySummary()
    {
        return {
            ControlMode:      this.ControlMode,
            PursuitActive:    this.PursuitActive,
            ViolationReason:  this.ViolationReason || "NONE",
            Generation:       this.EvaderBrain.Generation,
            TimeWarp:         this.TimeWarp,
            TotalBusts:       this.TotalBusts,
            TotalEscapes:     this.TotalEscapes,
            HeliLosClear:     this.HeliLosClear,
            DroneLockActive:  this.DroneLockActive,
            SpeedLimitKmh:    this.QueryPostedSpeedLimitKmh()
        };
    }
}

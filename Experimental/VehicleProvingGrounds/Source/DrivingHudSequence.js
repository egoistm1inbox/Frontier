//============================================================================================================================================
//                                                          DRIVINGHUDSEQUENCE.JS
//============================================================================================================================================
// 🧩 Interactive 2D + 3D Augmented-Reality Driving HUD (AR-HUD):
//    • Spatial-hash & proximity-triggered 3D obstacle/train/bollard/pit/collapse detection (O(1) cell neighborhood, 15 Hz broadphase)
//    • Real 3D world-projected object silhouette highlights, warning triangles (▽), downward chevrons (∨), and perspective ADAS lane carpet
//    • Fuel tank & 800V EV battery telemetry with low-resource warnings + proximity-triggered 3D nearest-station beacon & ground chevrons
//    • Two distinct camera-adapted designs:
//        1. Chase / Exterior Driving HUD — Curved Dual-Wing ADAS Telemetry + 3D Radar Carpet
//        2. Cockpit / Interior Windshield AR-HUD — Collimated Trapezoidal Windshield Combiner + Vector Mini-Map + BRAKE Alert
//    • Automatically hidden in FreeCamera (F8) and Road Studio editor mode; interactive quick-strip + click-to-lock 3D reticles + WebAudio UI.

import { HudAudioSynthesizer } from "./HudAudio.js";
import { ConeVariantSpecs } from "./SignageBuilder.js";
import { ClampScalar, RotateVector } from "./TransformProjection.js";

const SpatialCellSize        = 32.0;   // [m] 2D spatial hash cell size for O(1) static obstacle lookup
const CoarseScanInterval     = 0.065;  // [s] ~15 Hz proximity trigger broadphase tick
const StationNearRadius      = 235.0;  // [m] proximity radius within which low-fuel/EV projects a 3D station beacon
const LowResourceThreshold   = 0.25;   // [-] <= 25% triggers amber low-fuel / low-battery warning + station locator
const CritResourceThreshold  = 0.14;   // [-] <= 14% triggers critical crimson fuel/battery alert

function Lerp(A, B, T)
{
    return A + (B - A) * T;
}

function Damp(Current, Target, Lambda, Dt)
{
    return Lerp(Current, Target, 1.0 - Math.exp(-Lambda * Dt));
}

function HashCell(CX, CY)
{
    return (((CX + 2048) & 0xFFF) << 12) | ((CY + 2048) & 0xFFF);
}

// 📝 Monotone-chain 2D convex hull for clean 3D bounding-box X-ray silhouette fills on screen.
function ComputeScreenConvexHull(Points)
{
    if (Points.length <= 2)
        return Points;
    const Sorted = Points.slice().sort((A, B) => (A[0] !== B[0] ? A[0] - B[0] : A[1] - B[1]));
    const Cross = (O, A, B) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
    const Lower = [];
    for (const P of Sorted)
    {
        while (Lower.length >= 2 && Cross(Lower[Lower.length - 2], Lower[Lower.length - 1], P) <= 0.0)
            Lower.pop();
        Lower.push(P);
    }
    const Upper = [];
    for (let I = Sorted.length - 1; I >= 0; --I)
    {
        const P = Sorted[I];
        while (Upper.length >= 2 && Cross(Upper[Upper.length - 2], Upper[Upper.length - 1], P) <= 0.0)
            Upper.pop();
        Upper.push(P);
    }
    Upper.pop();
    Lower.pop();
    return Lower.concat(Upper);
}

const BoxEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0], // bottom loop
    [4, 5], [5, 6], [6, 7], [7, 4], // top loop
    [0, 4], [1, 5], [2, 6], [3, 7]  // verticals
];

export class DrivingHudSequence
{
    constructor(Host)
    {
        this.Host                  = Host;
        this.Audio                 = new HudAudioSynthesizer();
        this.Enabled               = true;
        this.DisplayStyle          = "full";     // "full" | "minimal" | "off"
        this.SpeedUnit             = "kmh";      // "kmh" | "mph"
        this.Sensitivity           = "auto";     // "auto" | "high" | "warnings"
        this.PinnedStationKind     = null;       // null | "fuel" | "electric"
        this.PinnedTargetId        = null;

        this.Clock                 = 0.0;
        this.ScanAccumulator       = 99.0;
        this.LastScanPosition      = [1.0e6, 1.0e6, 0.0];
        this.LastActiveMode        = "hidden";
        this.ModeTransition        = 1.0;        // [0..1] micro-spring entrance when switching camera HUDs
        this.UiPulse               = 0.0;

        // Smoothly damped telemetry & G-force micro-animation states
        this.SmoothSpeedMps        = 0.0;
        this.SmoothRpmNorm         = 0.0;
        this.SmoothFuel            = 0.34;
        this.SmoothBattery         = 0.28;
        this.FallbackFuel          = 0.34;
        this.FallbackBattery       = 0.28;
        this.PrevVelocity          = [0.0, 0.0, 0.0];
        this.SmoothShiftX          = 0.0;
        this.SmoothShiftY          = 0.0;
        this.SmoothBrakeUrgency    = 0.0;
        this.BrakeAlertActive      = false;
        this.LowFuelStage          = 0;          // 0 nominal, 1 <=25%, 2 <=14%
        this.LowBatteryStage       = 0;

        // Spatial grid + active proximity-locked target map (keyed by id for spring pop-in animation)
        this.SpatialGrid           = new Map();
        this.StaticCutouts         = [];
        this.TrackedTargets        = new Map();  // Id -> TrackedTarget with spring PopScale/Alpha
        this.SortedTargets         = [];
        this.ScreenHitBoxes        = [];         // Interactive clickable 3D reticle screen boxes
        this.LeadCorridorDist      = 60.0;
        this.LeftFlankThreat       = 0.0;
        this.RightFlankThreat      = 0.0;
        this.ActiveSectorName      = "PROVING GROUNDS";
        this.StationGuidance       = null;       // { Station, Dist, BearingRad, RelSide,RelFwd, IsClose, AutoTriggered }

        this.Canvas                = null;
        this.ControlBar            = null;
        this.Buttons               = {};

        this.BuildSpatialIndex();
        this.MountDom();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                    SPATIAL HASH GRID & PROXIMITY INDEXING
    //--------------------------------------------------------------------------------------------------------------------

    InsertSpatialEntry(X, Y, Entry)
    {
        const CX  = Math.floor(X / SpatialCellSize);
        const CY  = Math.floor(Y / SpatialCellSize);
        const Key = HashCell(CX, CY);
        let Bucket = this.SpatialGrid.get(Key);
        if (!Bucket)
        {
            Bucket = [];
            this.SpatialGrid.set(Key, Bucket);
        }
        Bucket.push(Entry);
    }

    BuildSpatialIndex()
    {
        this.SpatialGrid.clear();
        this.StaticCutouts = [];
        const Host  = this.Host;
        const Scene = Host?.Scene;
        if (!Scene)
            return;

        // ① Index all cones & construction drums by rest cell (dynamic wake checked only when cell is queried!)
        if (Host.Cones?.Cones)
        {
            for (const Cone of Host.Cones.Cones)
            {
                const Spec = ConeVariantSpecs[Cone.Shape] || ConeVariantSpecs.Cone;
                const R    = Spec ? 0.34 : 0.28;
                const H    = Spec ? Spec.CentreHeight : 0.38;
                this.InsertSpatialEntry(Cone.Rest.Position[0], Cone.Rest.Position[1], {
                    Kind:       "cone",
                    Id:         `cone:${Cone.Index}`,
                    Label:      Cone.Shape === "ConstructionDrum" ? "WORK DRUM" : "ROAD OBSTACLE",
                    ConeRef:    Cone,
                    HalfExtent: [R, R, H]
                });
            }
        }

        // ② Index all breakable props (crates, concrete barriers, pillars) by world cell
        if (Host.Fracture?.Props)
        {
            for (const Prop of Host.Fracture.Props)
            {
                const OccIdx = Prop.Definition?.Occupant;
                const Occ    = OccIdx !== undefined ? Scene.Occupants[OccIdx] : null;
                if (!Occ || !Occ.Bounds)
                    continue;
                const Min = Occ.Bounds.Minimum;
                const Max = Occ.Bounds.Maximum;
                const Center = [0.5 * (Min[0] + Max[0]), 0.5 * (Min[1] + Max[1]), 0.5 * (Min[2] + Max[2])];
                const Half   = [
                    Math.max(0.25, 0.5 * (Max[0] - Min[0])),
                    Math.max(0.25, 0.5 * (Max[1] - Min[1])),
                    Math.max(0.25, 0.5 * (Max[2] - Min[2]))
                ];
                // Skip giant overhead bridge arches (> 12 m tall); index road-level obstacles & crates
                if (Half[2] > 5.5 || Min[2] > 2.4)
                    continue;
                const MatLabel = Prop.Definition.Material === "wood" ? "CARGO CRATE" : "BARRIER BLOCK";
                this.InsertSpatialEntry(Center[0], Center[1], {
                    Kind:       "prop",
                    Id:         `prop:${Prop.Index}`,
                    Label:      MatLabel,
                    PropRef:    Prop,
                    Center,
                    HalfExtent: Half
                });
            }
        }

        // ③ Index open excavation pits & subway portals for drop-hazard proximity warnings
        const Cutouts = Host.LevelDescriptor?.PhysicsCutouts || [];
        for (let I = 0; I < Cutouts.length; ++I)
        {
            const C = Cutouts[I];
            if ((C.MaxX - C.MinX) < 3.0 && (C.MaxY - C.MinY) < 3.0)
                continue; // skip tiny bollard socket cutouts; bollard posts have their own dynamic trigger
            const CX = 0.5 * (C.MinX + C.MaxX);
            const CY = 0.5 * (C.MinY + C.MaxY);
            this.StaticCutouts.push({
                Id:         `pit:${I}`,
                Label:      (C.MaxY < -350.0) ? "OPEN TRENCH" : "PORTAL DROP",
                Center:     [CX, CY, 0.05],
                HalfExtent: [0.5 * (C.MaxX - C.MinX), 0.5 * (C.MaxY - C.MinY), 0.35],
                MinX: C.MinX, MaxX: C.MaxX, MinY: C.MinY, MaxY: C.MaxY
            });
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                     DOM OVERLAY & INTERACTIVE QUICK-STRIP
    //--------------------------------------------------------------------------------------------------------------------

    MountDom()
    {
        if (typeof document === "undefined")
            return;
        const Stage = document.getElementById("stage");
        if (!Stage)
            return;

        let Canvas = document.getElementById("ar-hud-canvas");
        if (!Canvas)
        {
            Canvas = document.createElement("canvas");
            Canvas.id = "ar-hud-canvas";
            Canvas.className = "ar-hud-canvas";
            Stage.appendChild(Canvas);
        }
        this.Canvas = Canvas;

        let Bar = document.getElementById("ar-hud-controls");
        if (!Bar)
        {
            Bar = document.createElement("div");
            Bar.id = "ar-hud-controls";
            Bar.className = "ar-hud-controls";
            Bar.setAttribute("aria-label", "Interactive AR-HUD Controls");

            const MakeBtn = (Key, Text, Title, OnClick) =>
            {
                const Btn = document.createElement("button");
                Btn.type = "button";
                Btn.className = "ar-hud-pill";
                Btn.dataset.hudAction = Key;
                Btn.title = Title;
                Btn.textContent = Text;
                Btn.addEventListener("click", (Ev) =>
                {
                    Ev.stopPropagation();
                    OnClick();
                });
                Bar.appendChild(Btn);
                this.Buttons[Key] = Btn;
                return Btn;
            };

            MakeBtn("mode",  "AR HUD · FULL", "Cycle AR-HUD mode (U): Full · Minimal · Off", () => this.CycleDisplayStyle());
            MakeBtn("units", "KM/H",          "Toggle speed units (KM/H ⇄ MPH)",             () => this.ToggleSpeedUnits());
            MakeBtn("fuel",  "⛽ 34%",        "Locate nearest Auto-Fuel Robot Bay in 3D AR", () => this.ToggleStationPin("fuel"));
            MakeBtn("ev",    "⚡ 28%",        "Locate nearest 800V EV Robot Bay in 3D AR",   () => this.ToggleStationPin("electric"));
            MakeBtn("audio", "🔊 UI",         "Toggle AR-HUD UI & collision warning sounds", () => this.ToggleAudio());

            Stage.appendChild(Bar);
        }
        this.ControlBar = Bar;

        // Click-to-lock on 3D highlighted world reticles without blocking steering/tablet clicks!
        Stage.addEventListener("pointerdown", (Event) =>
        {
            if (Event.button !== 0 || this.QueryDisplayMode() === "hidden")
                return;
            if (Event.target && Event.target.closest && Event.target.closest("#ar-hud-controls, #pursuit-rl-controls"))
                return;
            const Rect = Stage.getBoundingClientRect();
            const SX = Event.clientX - Rect.left;
            const SY = Event.clientY - Rect.top;
            for (const Box of this.ScreenHitBoxes)
            {
                if (SX >= Box.X && SX <= Box.X + Box.W && SY >= Box.Y && SY <= Box.Y + Box.H)
                {
                    this.PinnedTargetId = (this.PinnedTargetId === Box.Id) ? null : Box.Id;
                    this.UiPulse = 1.0;
                    this.Audio.PlayUiClick(this.PinnedTargetId ? 1.22 : 0.86);
                    break;
                }
            }
        });

        this.SyncControlBarButtons();
    }

    CycleDisplayStyle()
    {
        const Order = ["full", "minimal", "off"];
        const Next  = Order[(Order.indexOf(this.DisplayStyle) + 1) % Order.length];
        this.DisplayStyle = Next;
        this.UiPulse = 1.0;
        this.Audio.PlayUiClick(Next === "off" ? 0.78 : 1.12);
        this.SyncControlBarButtons();
        this.Host?.Shell?.Announce(`AR-HUD: ${Next.toUpperCase()}`);
    }

    ToggleSpeedUnits()
    {
        this.SpeedUnit = this.SpeedUnit === "kmh" ? "mph" : "kmh";
        this.UiPulse = 1.0;
        this.Audio.PlayUiClick(1.06);
        this.SyncControlBarButtons();
    }

    ToggleStationPin(Kind)
    {
        this.PinnedStationKind = (this.PinnedStationKind === Kind) ? null : Kind;
        this.ScanAccumulator = 99.0; // force immediate station beacon refresh
        this.UiPulse = 1.0;
        if (this.PinnedStationKind)
            this.Audio.PlayTargetLock("station", this.Clock);
        else
            this.Audio.PlayUiClick(0.88);
        this.SyncControlBarButtons();
    }

    ToggleAudio()
    {
        const Next = !this.Audio.Enabled;
        if (Next)
        {
            this.Audio.SetEnabled(true);
            this.Audio.PlayUiClick(1.15);
        }
        else
        {
            this.Audio.SetEnabled(false);
        }
        this.SyncControlBarButtons();
    }

    TriggerLowFuelDemo()
    {
        if (this.Host?.ServiceStations)
        {
            this.Host.ServiceStations.FuelLevel   = 0.18;
            this.Host.ServiceStations.BatteryLevel = 0.19;
        }
        this.FallbackFuel    = 0.18;
        this.FallbackBattery = 0.19;
        this.LowFuelStage    = 0;
        this.LowBatteryStage = 0;
        this.ScanAccumulator = 99.0;
        this.Audio.PlayLowFuelWarning(false, this.Clock);
    }

    SyncControlBarButtons()
    {
        this.Host?.Police?.RefreshControlStrip?.();
        this.Host?.DDay?.RefreshControlStrip?.();
        if (!this.ControlBar)
            return;
        const B = this.Buttons;
        if (B.mode)
        {
            B.mode.textContent = `AR HUD · ${this.DisplayStyle.toUpperCase()}`;
            B.mode.classList.toggle("active", this.DisplayStyle !== "off");
        }
        if (B.units)
            B.units.textContent = this.SpeedUnit === "mph" ? "MPH" : "KM/H";
        const FuelPct = Math.round(this.QueryFuelLevel() * 100);
        const EvPct   = Math.round(this.QueryBatteryLevel() * 100);
        if (B.fuel)
        {
            B.fuel.textContent = `⛽ ${FuelPct}%`;
            B.fuel.classList.toggle("warn", FuelPct <= 25);
            B.fuel.classList.toggle("crit", FuelPct <= 14);
            B.fuel.classList.toggle("active", this.PinnedStationKind === "fuel");
        }
        if (B.ev)
        {
            B.ev.textContent = `⚡ ${EvPct}%`;
            B.ev.classList.toggle("warn", EvPct <= 25);
            B.ev.classList.toggle("crit", EvPct <= 14);
            B.ev.classList.toggle("active", this.PinnedStationKind === "electric");
        }
        if (B.audio)
        {
            B.audio.textContent = this.Audio.Enabled ? "🔊 UI" : "🔇 MUTE";
            B.audio.classList.toggle("active", this.Audio.Enabled);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                        CAMERA MODE & VISIBILITY POLICY
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Shown in Chase/Exterior and Cockpit/Interior cameras; strictly hidden in FreeCamera (F8) & Road Studio editor!
    QueryDisplayMode()
    {
        const Host = this.Host;
        if (!Host || !this.Enabled)
            return "hidden";
        if (Host.FreeCamera)
            return "hidden";
        if (Host.RoadEditor?.ActiveWorkspace === "roadstudio")
            return "hidden";
        if (Host.Dock?.Clean)
            return "hidden";
        if (Host.Vehicle?.Hidden)
            return "hidden";
        const CamMode = Host.Settings?.CameraMode || "Chase";
        if (CamMode === "HMI" || CamMode === "Tyre FL" || CamMode === "Tyre RL")
            return "hidden";
        if (CamMode === "Cockpit" || CamMode === "Passenger")
            return "cockpit";
        return "chase";
    }

    QueryFuelLevel()
    {
        return this.Host?.ServiceStations ? this.Host.ServiceStations.FuelLevel : this.FallbackFuel;
    }

    QueryBatteryLevel()
    {
        return this.Host?.ServiceStations ? this.Host.ServiceStations.BatteryLevel : this.FallbackBattery;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                              PROXIMITY TRIGGER SCANNER & THREAT CLASSIFIER (15 HZ)
    //--------------------------------------------------------------------------------------------------------------------

    Advance(DeltaSeconds)
    {
        const Step = ClampScalar(Number(DeltaSeconds) || 0.0, 0.0, 0.1);
        this.Clock += Step;
        this.UiPulse = Math.max(0.0, this.UiPulse - Step * 3.2);

        const Mode = this.QueryDisplayMode();
        const EffectiveVisible = Mode !== "hidden" && this.DisplayStyle !== "off";

        const ShowControls = Mode !== "hidden";
        if (this.ControlBar)
            this.ControlBar.classList.toggle("hidden", !ShowControls);
        if (this.Host?.Police?.ControlStrip)
            this.Host.Police.ControlStrip.classList.toggle("hidden", !ShowControls || this.Host.LevelKey === "dday");
        if (this.Host?.DDay?.ControlStrip)
            this.Host.DDay.ControlStrip.classList.toggle("hidden", !ShowControls || !this.Host.DDay.Active);

        if (Mode !== this.LastActiveMode)
        {
            if (Mode !== "hidden" && this.LastActiveMode !== "hidden")
            {
                this.ModeTransition = 0.0;
                this.Audio.PlayModeSwitch(Mode === "cockpit", this.Clock);
            }
            else if (Mode !== "hidden")
            {
                this.ModeTransition = 0.0;
            }
            this.LastActiveMode = Mode;
        }
        this.ModeTransition = Damp(this.ModeTransition, 1.0, 11.0, Math.max(Step, 1.0 / 120.0));

        const Vehicle = this.Host?.Vehicle;
        if (!Vehicle)
            return;

        // Smooth vehicle speed, G-load HUD inertia, and fuel/battery bars
        const Vel   = Vehicle.LinearVelocity || [0.0, 0.0, 0.0];
        const Speed = Math.hypot(Vel[0], Vel[1], Vel[2]);
        this.SmoothSpeedMps = Damp(this.SmoothSpeedMps, Speed, 14.0, Math.max(Step, 0.008));

        if (!this.Host?.ServiceStations && Speed > 3.0)
        {
            this.FallbackFuel    = Math.max(0.04, this.FallbackFuel    - Step * Speed * 0.00018);
            this.FallbackBattery = Math.max(0.04, this.FallbackBattery - Step * Speed * 0.00022);
        }

        const RawFuel = this.QueryFuelLevel();
        const RawBatt = this.QueryBatteryLevel();
        this.SmoothFuel    = Damp(this.SmoothFuel,    RawFuel, 10.0, Math.max(Step, 0.008));
        this.SmoothBattery = Damp(this.SmoothBattery, RawBatt, 10.0, Math.max(Step, 0.008));

        // Low-resource threshold chimes (fires cleanly on transition even before rendering)
        const NewFuelStage = RawFuel <= CritResourceThreshold ? 2 : (RawFuel <= LowResourceThreshold ? 1 : 0);
        if (NewFuelStage > this.LowFuelStage && EffectiveVisible)
            this.Audio.PlayLowFuelWarning(NewFuelStage === 2, this.Clock);
        this.LowFuelStage = NewFuelStage;

        const NewBattStage = RawBatt <= CritResourceThreshold ? 2 : (RawBatt <= LowResourceThreshold ? 1 : 0);
        if (NewBattStage > this.LowBatteryStage && EffectiveVisible)
            this.Audio.PlayLowFuelWarning(NewBattStage === 2, this.Clock);
        this.LowBatteryStage = NewBattStage;

        // Compute G-force micro-parallax shift for HUD widgets
        if (Step > 1.0e-4)
        {
            const AccWorld = [
                (Vel[0] - this.PrevVelocity[0]) / Step,
                (Vel[1] - this.PrevVelocity[1]) / Step,
                (Vel[2] - this.PrevVelocity[2]) / Step
            ];
            const Fwd   = Vehicle.QueryForward ? Vehicle.QueryForward() : RotateVector(Vehicle.Orientation, [1.0, 0.0, 0.0]);
            const Up    = RotateVector(Vehicle.Orientation, [0.0, 0.0, 1.0]);
            const Right = [Fwd[1] * Up[2] - Fwd[2] * Up[1], Fwd[2] * Up[0] - Fwd[0] * Up[2], Fwd[0] * Up[1] - Fwd[1] * Up[0]];
            const LatG  = ClampScalar((AccWorld[0] * Right[0] + AccWorld[1] * Right[1]) / 9.81, -1.8, 1.8);
            const LongG = ClampScalar((AccWorld[0] * Fwd[0]   + AccWorld[1] * Fwd[1])   / 9.81, -2.0, 2.0);
            this.SmoothShiftX = Damp(this.SmoothShiftX, -LatG * 5.5, 10.0, Step);
            this.SmoothShiftY = Damp(this.SmoothShiftY, LongG * 4.0, 10.0, Step);
        }
        this.PrevVelocity[0] = Vel[0];
        this.PrevVelocity[1] = Vel[1];
        this.PrevVelocity[2] = Vel[2];

        const Telemetry = Vehicle.QueryTelemetry ? Vehicle.QueryTelemetry() : { EngineRPM: 1000 };
        this.SmoothRpmNorm = Damp(this.SmoothRpmNorm, ClampScalar((Telemetry.EngineRPM || 900) / 7200.0, 0.08, 1.0), 12.0, Math.max(Step, 0.008));

        if (!EffectiveVisible)
        {
            this.BrakeAlertActive = false;
            return;
        }

        // Proximity broadphase scan at 15 Hz or >= 1.4 m vehicle travel
        this.ScanAccumulator += Step;
        const Pos = Vehicle.Position;
        const MovedSq = (Pos[0] - this.LastScanPosition[0]) ** 2 + (Pos[1] - this.LastScanPosition[1]) ** 2;
        if (this.ScanAccumulator >= CoarseScanInterval || MovedSq >= 1.96)
        {
            this.ScanAccumulator = 0.0;
            this.LastScanPosition[0] = Pos[0];
            this.LastScanPosition[1] = Pos[1];
            this.LastScanPosition[2] = Pos[2];
            this.ScanProximityTriggers();
            this.SyncControlBarButtons();
        }

        // Advance micro-animations on tracked targets (spring pop-in & fade-out)
        this.UpdateTargetAnimations(Step);
    }

    ScanProximityTriggers()
    {
        const Host    = this.Host;
        const Vehicle = Host.Vehicle;
        const CarPos  = Vehicle.Position;
        const CarVel  = Vehicle.LinearVelocity || [0.0, 0.0, 0.0];
        const Speed   = Math.hypot(CarVel[0], CarVel[1], CarVel[2]);
        const Fwd     = Vehicle.QueryForward ? Vehicle.QueryForward() : RotateVector(Vehicle.Orientation, [1.0, 0.0, 0.0]);
        const Right   = [Fwd[1], -Fwd[0], 0.0];
        const RightL  = Math.hypot(Right[0], Right[1]) || 1.0;
        Right[0] /= RightL; Right[1] /= RightL;

        // Resolve current named track/sector from LevelDescriptor.Zones
        this.ResolveActiveSector(CarPos);

        // Evaluate nearest Fuel / 800V EV Station proximity trigger
        this.EvaluateStationGuidance(CarPos, Fwd, Right);

        const SeenIds = new Set();
        let MinLeadDist = 56.0;
        let MaxBrakeUrgency = 0.0;
        let LeftThreat = 0.0;
        let RightThreat = 0.0;

        const MaxRange = this.Sensitivity === "high" ? 98.0 : 78.0;

        const RegisterCandidate = (Spec) =>
        {
            const DX = Spec.Position[0] - CarPos[0];
            const DY = Spec.Position[1] - CarPos[1];
            const DZ = Spec.Position[2] - CarPos[2];
            const Dist = Math.hypot(DX, DY, DZ);
            if (Dist > (Spec.MaxDist || MaxRange) || Dist < 0.8)
                return;

            const FwdDist = DX * Fwd[0] + DY * Fwd[1] + DZ * Fwd[2];
            const LatOff  = DX * Right[0] + DY * Right[1];
            // Only lock objects in front of or flanking the windshield/chase view (unless manually pinned)
            if (FwdDist < -3.5 && this.PinnedTargetId !== Spec.Id)
                return;

            const ObjVel = Spec.Velocity || [0.0, 0.0, 0.0];
            const InvD = 1.0 / Math.max(Dist, 0.01);
            const ClosingVel = ((CarVel[0] - ObjVel[0]) * DX + (CarVel[1] - ObjVel[1]) * DY + (CarVel[2] - ObjVel[2]) * DZ) * InvD;
            const TTC = ClosingVel > 0.6 ? (Dist / ClosingVel) : 99.0;

            const ObjHalfW = Math.max(Spec.HalfExtent[0], Spec.HalfExtent[1]);
            const InLaneCorridor = FwdDist > 1.2 && Math.abs(LatOff) < (ObjHalfW + 1.55) && Math.abs(DZ) < 3.6;
            const NearCorridor   = FwdDist > 0.5 && Math.abs(LatOff) < (ObjHalfW + 4.40) && Math.abs(DZ) < 4.5;

            if (InLaneCorridor && Spec.BlocksLane !== false)
                MinLeadDist = Math.min(MinLeadDist, Math.max(4.0, FwdDist - ObjHalfW));

            // Adjacent-lane flank warning glow (Screenshot 3 left/right red radar wedge)
            if (Spec.BlocksLane !== false && FwdDist > -2.0 && FwdDist < 42.0 && Math.abs(DZ) < 3.5)
            {
                const AbsLat = Math.abs(LatOff) - ObjHalfW;
                if (AbsLat > 0.6 && AbsLat < 5.8)
                {
                    const FlankWeight = ClampScalar((1.0 - FwdDist / 42.0) * (1.0 - AbsLat / 5.8) * 1.4, 0.0, 1.0);
                    if (LatOff < 0.0) LeftThreat  = Math.max(LeftThreat, FlankWeight);
                    else              RightThreat = Math.max(RightThreat, FlankWeight);
                }
            }

            let Severity = Spec.ForceSeverity || "info";
            if (!Spec.ForceSeverity)
            {
                if (InLaneCorridor && ((TTC < 2.55 && ClosingVel > 4.2) || (FwdDist < 16.0 && Speed > 5.5)))
                {
                    Severity = "critical";
                    const Urgency = ClampScalar(1.35 - Math.min(TTC / 2.55, FwdDist / 22.0), 0.35, 1.0);
                    MaxBrakeUrgency = Math.max(MaxBrakeUrgency, Urgency);
                }
                else if (Spec.Kind === "rail" || NearCorridor || TTC < 4.2)
                {
                    Severity = (InLaneCorridor || Spec.HighlightRed) ? "critical" : "caution";
                }
            }
            else if (Spec.ForceSeverity === "critical" && InLaneCorridor && Speed > 4.5 && FwdDist < 28.0)
            {
                MaxBrakeUrgency = Math.max(MaxBrakeUrgency, 0.85);
            }

            if (this.Sensitivity === "warnings" && Severity === "info" && this.PinnedTargetId !== Spec.Id)
                return;

            SeenIds.add(Spec.Id);
            let Existing = this.TrackedTargets.get(Spec.Id);
            if (!Existing)
            {
                Existing = {
                    Id:          Spec.Id,
                    PopScale:    1.38,
                    Alpha:       0.0,
                    BornAt:      this.Clock,
                    Retiring:    false
                };
                this.TrackedTargets.set(Spec.Id, Existing);
                if (Severity === "critical" || Spec.Kind === "rail")
                    this.Audio.PlayTargetLock(Spec.Kind === "rail" ? "rail" : "hazard", this.Clock);
            }
            Existing.Retiring    = false;
            Existing.Kind        = Spec.Kind;
            Existing.Label       = Spec.Label;
            Existing.SubLabel    = Spec.SubLabel || "";
            Existing.Position    = Spec.Position;
            Existing.HalfExtent  = Spec.HalfExtent;
            Existing.Yaw         = Spec.Yaw || 0.0;
            Existing.Dist        = Dist;
            Existing.FwdDist     = FwdDist;
            Existing.ClosingVel  = ClosingVel;
            Existing.TTC         = TTC;
            Existing.Severity    = Severity;
            Existing.Priority    = (Severity === "critical" ? 300 : (Severity === "caution" ? 200 : 100)) - Dist;
        };

        // ① Query 3×3 Spatial Hash Grid around forward-biased sensor probe (O(1) static obstacle & crate lookup!)
        const ProbeX = CarPos[0] + Fwd[0] * ClampScalar(Speed * 1.1, 14.0, 38.0);
        const ProbeY = CarPos[1] + Fwd[1] * ClampScalar(Speed * 1.1, 14.0, 38.0);
        const BaseCX = Math.floor(ProbeX / SpatialCellSize);
        const BaseCY = Math.floor(ProbeY / SpatialCellSize);

        for (let DX = -1; DX <= 1; ++DX)
        {
            for (let DY = -1; DY <= 1; ++DY)
            {
                const Bucket = this.SpatialGrid.get(HashCell(BaseCX + DX, BaseCY + DY));
                if (!Bucket)
                    continue;
                for (const Entry of Bucket)
                {
                    if (Entry.Kind === "cone")
                    {
                        const Cone = Entry.ConeRef;
                        if (!Cone || Cone.HiddenUntil > Cone.Clock)
                            continue;
                        const Pos = Cone.Body ? Cone.Body.Position : Cone.Rest.Position;
                        const Vel = Cone.Body?.LinearVelocity || [0.0, 0.0, 0.0];
                        // Only highlight cones directly near/on our trajectory so slalom sidelines stay crisp & uncluttered!
                        const RelX = Pos[0] - CarPos[0], RelY = Pos[1] - CarPos[1];
                        const Lat  = Math.abs(RelX * Right[0] + RelY * Right[1]);
                        const FwdD = RelX * Fwd[0] + RelY * Fwd[1];
                        if (FwdD > 1.0 && FwdD < 44.0 && Lat < 3.1)
                        {
                            RegisterCandidate({
                                Id:           Entry.Id,
                                Kind:         "obstacle",
                                Label:        Entry.Label,
                                Position:     Pos,
                                Velocity:     Vel,
                                HalfExtent:   Entry.HalfExtent,
                                HighlightRed: Lat < 1.85,
                                MaxDist:      46.0
                            });
                        }
                    }
                    else if (Entry.Kind === "prop")
                    {
                        const Prop = Entry.PropRef;
                        if (!Prop || Prop.State !== "intact")
                            continue;
                        RegisterCandidate({
                            Id:           Entry.Id,
                            Kind:         "obstacle",
                            Label:        Entry.Label,
                            Position:     Entry.Center,
                            HalfExtent:   Entry.HalfExtent,
                            HighlightRed: true,
                            MaxDist:      62.0
                        });
                    }
                }
            }
        }

        // ② Commuter Rail Trains & Streetcar Trams (Track F — full 3D bounding highlight + speed telemetry!)
        if (Host.Trams?.Enabled && Host.Trams.Consists)
        {
            for (const Consist of Host.Trams.Consists)
            {
                // Highlight the nearest car of each nearby consist (plus lead car) so multi-car trains read cleanly
                let ClosestCar = null;
                let ClosestDist = 96.0;
                for (const Car of Consist.Cars)
                {
                    const D = Math.hypot(Car.WorldPosition[0] - CarPos[0], Car.WorldPosition[1] - CarPos[1], Car.WorldPosition[2] - CarPos[2]);
                    if (D < ClosestDist)
                    {
                        ClosestDist = D;
                        ClosestCar = Car;
                    }
                }
                if (ClosestCar)
                {
                    const TrainKmh = Math.round(Math.hypot(ClosestCar.WorldVelocity[0], ClosestCar.WorldVelocity[1]) * 3.6);
                    RegisterCandidate({
                        Id:           `rail:${Consist.Id}`,
                        Kind:         "rail",
                        Label:        Consist.Kind === "train" ? "COMMUTER TRAIN" : "STREETCAR TRAM",
                        SubLabel:     `${TrainKmh} KM/H`,
                        Position:     [ClosestCar.WorldPosition[0], ClosestCar.WorldPosition[1], ClosestCar.WorldPosition[2] + ClosestCar.HalfExtent[2]],
                        Velocity:     ClosestCar.WorldVelocity,
                        HalfExtent:   ClosestCar.HalfExtent,
                        HighlightRed: ClosestDist < 32.0,
                        MaxDist:      94.0
                    });
                }
            }
        }

        // ③ Proximity-Triggered Kinetic Bollards (highlight raised solid bollards ahead)
        if (Host.Bollards?.Zones)
        {
            for (let ZIdx = 0; ZIdx < Host.Bollards.Zones.length; ++ZIdx)
            {
                const Zone = Host.Bollards.Zones[ZIdx];
                let BestPost = null;
                let BestD = 54.0;
                for (const Post of Zone.Posts)
                {
                    if (!Post.Solid || Post.Extension < 0.30)
                        continue;
                    const D = Math.hypot(Post.Position[0] - CarPos[0], Post.Position[1] - CarPos[1]);
                    const Lat = Math.abs((Post.Position[0] - CarPos[0]) * Right[0] + (Post.Position[1] - CarPos[1]) * Right[1]);
                    if (D < BestD && Lat < 3.4)
                    {
                        BestD = D;
                        BestPost = Post;
                    }
                }
                if (BestPost)
                {
                    RegisterCandidate({
                        Id:           `bollard:${ZIdx}`,
                        Kind:         "bollard",
                        Label:        "RAISED BOLLARD",
                        Position:     [BestPost.Position[0], BestPost.Position[1], 0.45 * BestPost.Extension],
                        HalfExtent:   [0.35, 0.35, 0.48 * BestPost.Extension],
                        HighlightRed: true,
                        MaxDist:      54.0
                    });
                }
            }
        }

        // ④ Collapsing Sky-Bridge & Sinkhole Spans (Track D)
        if (Host.Collapse?.Spans)
        {
            for (let SIdx = 0; SIdx < Host.Collapse.Spans.length; ++SIdx)
            {
                const Span = Host.Collapse.Spans[SIdx];
                if (!Span.Origin)
                    continue;
                const D = Math.hypot(Span.Origin[0] - CarPos[0], Span.Origin[1] - CarPos[1], (Span.Origin[2] || 0) - CarPos[2]);
                if (D < 74.0)
                {
                    RegisterCandidate({
                        Id:            `collapse:${SIdx}`,
                        Kind:          "collapse",
                        Label:         Span.Triggered ? "DECK COLLAPSING" : "FRACTURE ZONE",
                        Position:      [Span.Origin[0], Span.Origin[1], (Span.Origin[2] || 0.0) + 0.4],
                        HalfExtent:    [4.5, 4.2, 0.6],
                        ForceSeverity: Span.Triggered ? "critical" : "caution",
                        BlocksLane:    Span.Triggered,
                        MaxDist:       74.0
                    });
                }
            }
        }

        // ⑤ Open Excavation Pits & Trench Portals (when at surface Z > -1.2 m approaching an open drop)
        if (CarPos[2] > -1.2)
        {
            for (const Pit of this.StaticCutouts)
            {
                const D = Math.hypot(Pit.Center[0] - CarPos[0], Pit.Center[1] - CarPos[1]);
                if (D < 58.0)
                {
                    const Lat = Math.abs((Pit.Center[0] - CarPos[0]) * Right[0] + (Pit.Center[1] - CarPos[1]) * Right[1]);
                    if (Lat < Pit.HalfExtent[1] + 2.5)
                    {
                        RegisterCandidate({
                            Id:            Pit.Id,
                            Kind:          "pit",
                            Label:         Pit.Label,
                            Position:      Pit.Center,
                            HalfExtent:    [Math.min(6.0, Pit.HalfExtent[0]), Math.min(5.2, Pit.HalfExtent[1]), 0.45],
                            ForceSeverity: D < 32.0 ? "critical" : "caution",
                            BlocksLane:    false,
                            MaxDist:       58.0
                        });
                    }
                }
            }
        }

        // ⑥ Hovering Robotic 4-Lamp Intersection Signals
        if (Host.TrafficLights)
        {
            const Sig = Host.TrafficLights.QueryNearestSignal(CarPos);
            if (Sig && Sig.Distance < 78.0 && Sig.Position)
            {
                const IsStop = Sig.Aspect === "RED" || Sig.Aspect === "ORANGE";
                RegisterCandidate({
                    Id:            `sig:${Sig.Name}`,
                    Kind:          "signal",
                    Label:         `${Sig.Aspect} SIGNAL`,
                    SubLabel:      `${Sig.RemainingSeconds.toFixed(1)}S`,
                    Position:      [Sig.Position[0], Sig.Position[1], Sig.Position[2] ?? 5.4],
                    HalfExtent:    [0.55, 0.55, 1.15],
                    ForceSeverity: Sig.Aspect === "RED" ? "critical" : (Sig.Aspect === "GREEN" ? "info" : "caution"),
                    BlocksLane:    IsStop && Sig.Distance < 28.0,
                    MaxDist:       78.0
                });
            }
        }

        // ⑦ Nearest Fuel / 800V EV Industrial Robot Bay (when close + low resource, or within 95 m, or pinned!)
        if (this.StationGuidance && (this.StationGuidance.Show3DBeacon || this.StationGuidance.Dist < 90.0))
        {
            const St = this.StationGuidance.Station;
            RegisterCandidate({
                Id:            `station:${St.Id}`,
                Kind:          "station",
                Label:         St.Kind === "electric" ? "⚡ 800V ROBOT BAY" : "⛽ AUTO-FUEL BAY",
                SubLabel:      this.StationGuidance.AutoTriggered ? "LOW TANK · STOP IN BAY" : "6-AXIS ROBOT READY",
                Position:      [St.BayCenter[0], St.BayCenter[1], 1.35],
                HalfExtent:    [St.BayHalfExtent[0] * 0.82, St.BayHalfExtent[1] * 0.82, 1.25],
                ForceSeverity: "info",
                BlocksLane:    false,
                MaxDist:       360.0
            });
        }

        // Mark unseen targets for smooth spring fade-out
        for (const [Id, Target] of this.TrackedTargets)
        {
            if (!SeenIds.has(Id))
                Target.Retiring = true;
        }

        this.LeadCorridorDist = MinLeadDist;
        this.LeftFlankThreat  = LeftThreat;
        this.RightFlankThreat = RightThreat;

        const WasBraking = this.BrakeAlertActive;
        this.BrakeAlertActive = MaxBrakeUrgency > 0.32;
        this.SmoothBrakeUrgency = MaxBrakeUrgency;
        if (this.BrakeAlertActive && !WasBraking)
            this.Audio.PlayBrakeWarning(this.Clock);
    }

    ResolveActiveSector(CarPos)
    {
        const Zones = this.Host?.LevelDescriptor?.Zones;
        if (!Zones || Zones.length === 0)
        {
            this.ActiveSectorName = this.Host?.LevelDescriptor?.Title?.toUpperCase() || "PROVING GROUNDS";
            return;
        }
        let Best = null;
        let BestD = Infinity;
        for (const Z of Zones)
        {
            if (!Z.Position)
                continue;
            const D = Math.hypot(Z.Position[0] - CarPos[0], Z.Position[1] - CarPos[1]);
            if (D < BestD)
            {
                BestD = D;
                Best = Z;
            }
        }
        this.ActiveSectorName = Best ? Best.Name.toUpperCase() : "INVERSION ARENA";
    }

    EvaluateStationGuidance(CarPos, Fwd, Right)
    {
        const Stations = this.Host?.ServiceStations?.Stations;
        if (!Stations || Stations.length === 0)
        {
            this.StationGuidance = null;
            return;
        }

        const FuelLow = this.QueryFuelLevel() <= LowResourceThreshold;
        const BattLow = this.QueryBatteryLevel() <= LowResourceThreshold;

        let WantedKind = this.PinnedStationKind;
        let AutoTriggered = false;
        if (!WantedKind)
        {
            if (FuelLow && BattLow)
                WantedKind = this.QueryFuelLevel() <= this.QueryBatteryLevel() ? "fuel" : "electric";
            else if (FuelLow)
                WantedKind = "fuel";
            else if (BattLow)
                WantedKind = "electric";
            if (WantedKind)
                AutoTriggered = true;
        }

        // Even when not low, keep nearest station info available when driving right past Track H (< 95 m)
        let TargetStation = null;
        let BestDist = Infinity;
        for (const St of Stations)
        {
            if (WantedKind && St.Kind !== WantedKind)
                continue;
            const D = Math.hypot(St.BayCenter[0] - CarPos[0], St.BayCenter[1] - CarPos[1]);
            if (D < BestDist)
            {
                BestDist = D;
                TargetStation = St;
            }
        }
        if (!TargetStation)
        {
            this.StationGuidance = null;
            return;
        }

        const DX = TargetStation.BayCenter[0] - CarPos[0];
        const DY = TargetStation.BayCenter[1] - CarPos[1];
        const RelFwd  = DX * Fwd[0]   + DY * Fwd[1];
        const RelSide = DX * Right[0] + DY * Right[1];
        const Bearing = Math.atan2(RelSide, RelFwd); // 0 = dead ahead, + = right, - = left
        const IsClose = BestDist <= StationNearRadius;

        this.StationGuidance = {
            Station:       TargetStation,
            Kind:          TargetStation.Kind,
            Dist:          BestDist,
            BearingRad:    Bearing,
            RelFwd,
            RelSide,
            IsClose,
            AutoTriggered,
            Pinned:        Boolean(this.PinnedStationKind),
            Show3DBeacon:  Boolean(this.PinnedStationKind) || (AutoTriggered && IsClose)
        };
    }

    UpdateTargetAnimations(Step)
    {
        const Dt = Math.max(Step, 1.0 / 120.0);
        const Sorted = [];
        for (const [Id, T] of this.TrackedTargets)
        {
            if (T.Retiring)
            {
                T.Alpha = Damp(T.Alpha, 0.0, 14.0, Dt);
                T.PopScale = Damp(T.PopScale, 0.92, 12.0, Dt);
                if (T.Alpha < 0.03)
                {
                    if (this.PinnedTargetId === Id)
                        this.PinnedTargetId = null;
                    this.TrackedTargets.delete(Id);
                    continue;
                }
            }
            else
            {
                T.Alpha    = Damp(T.Alpha, 1.0, 16.0, Dt);
                T.PopScale = Damp(T.PopScale, 1.0, 14.0, Dt);
            }
            Sorted.push(T);
        }
        Sorted.sort((A, B) => B.Priority - A.Priority);
        // Cap rendered 3D callouts to top 8 so the windshield stays ultra-clean and 60 fps fast
        this.SortedTargets = Sorted.slice(0, 8);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                    3D WORLD -> VIEWPORT PROJECTION MATH
    //--------------------------------------------------------------------------------------------------------------------

    ProjectWorld(WorldPt, Width, Height, Cam)
    {
        const RX = WorldPt[0] - Cam.Position[0];
        const RY = WorldPt[1] - Cam.Position[1];
        const RZ = WorldPt[2] - Cam.Position[2];
        const Depth = RX * Cam.Forward[0] + RY * Cam.Forward[1] + RZ * Cam.Forward[2];
        if (Depth <= 0.25)
            return null;
        const RightProj = RX * Cam.Right[0] + RY * Cam.Right[1] + RZ * Cam.Right[2];
        const UpProj    = RX * Cam.Up[0]    + RY * Cam.Up[1]    + RZ * Cam.Up[2];
        const NdcX = RightProj / (Depth * Cam.TanY * Cam.Aspect);
        const NdcY = UpProj    / (Depth * Cam.TanY);
        return [
            (NdcX * 0.5 + 0.5) * Width,
            (0.5 - NdcY * 0.5) * Height,
            Depth
        ];
    }

    FormatSpeed(SpeedMps)
    {
        return Math.round(Math.abs(SpeedMps) * (this.SpeedUnit === "mph" ? 2.23694 : 3.6));
    }

    FormatDistance(Meters)
    {
        if (this.SpeedUnit === "mph")
        {
            if (Meters >= 400.0)
                return { Value: (Meters / 1609.34).toFixed(1), Unit: "mi" };
            return { Value: String(Math.round(Meters)), Unit: "m" };
        }
        if (Meters >= 1000.0)
            return { Value: (Meters / 1000.0).toFixed(1), Unit: "km" };
        return { Value: String(Math.round(Meters)), Unit: "m" };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                   MAIN 2D + 3D AR-HUD CANVAS RENDER PASS
    //--------------------------------------------------------------------------------------------------------------------

    Render(CameraState = this.Host?.CameraState)
    {
        if (!this.Canvas)
            return;

        const Mode = this.QueryDisplayMode();
        const Ctx  = this.Canvas.getContext("2d");
        if (!Ctx || !Ctx.clearRect)
            return;

        const Dpr = Math.min(2.0, globalThis.devicePixelRatio || 1.0);
        const W   = Math.max(1, this.Canvas.clientWidth  || this.Host?.ScreenExtent?.[0] || 1280);
        const H   = Math.max(1, this.Canvas.clientHeight || this.Host?.ScreenExtent?.[1] || 720);
        if (this.Canvas.width !== Math.round(W * Dpr) || this.Canvas.height !== Math.round(H * Dpr))
        {
            this.Canvas.width  = Math.round(W * Dpr);
            this.Canvas.height = Math.round(H * Dpr);
        }
        Ctx.setTransform(Dpr, 0, 0, Dpr, 0, 0);
        Ctx.clearRect(0, 0, W, H);
        this.ScreenHitBoxes.length = 0;

        if (Mode === "hidden" || this.DisplayStyle === "off" || !CameraState)
            return;

        // ① Smart Context-Aware 3D Trajectory Ribbon (only appears when closing on a target, navigating, or in active pursuit — never stuck straight ahead!)
        if (this.DisplayStyle === "full")
        {
            this.Render3DGroundRadarCarpet(Ctx, W, H, CameraState, Mode);
            if (this.StationGuidance?.Show3DBeacon)
                this.Render3DStationGuidancePath(Ctx, W, H, CameraState);
        }

        // ② 3D World-Space Object Silhouette Highlights + Warning Triangles (▽) + Chevrons (∨) + Distance Callouts
        this.Render3DTargetHighlights(Ctx, W, H, CameraState, Mode);

        // ②b Police Pursuit & RL Self-Play 3D Lidar Rays / Aerial Lock / Holographic Telemetry (zero black boxes)
        this.Host?.Police?.RenderHudOverlay?.(Ctx, W, H, CameraState, Mode);

        // ②c D-Day Assault Tactical AR-HUD (Atlantic Wall distance, Tank Cover brackets, Incoming Bomb rings, Mines & Hull)
        this.Host?.DDay?.RenderHudOverlay?.(Ctx, W, H, CameraState, (WorldPt, Cam, Width, Height) =>
        {
            const P = this.ProjectWorld(WorldPt, Width, Height, Cam);
            return P ? { X: P[0], Y: P[1], Distance: P[2] } : null;
        });

        // ③ Camera-Specific 2D + 2.5D HUD Overlay (pure optical light-on-glass, zero black background boxes):
        //    • "cockpit" -> Collimated Windshield Combiner Trapezoidal AR-HUD (Screenshots 1 & 2)
        //    • "chase"   -> Curved Dual-Wing ADAS Telemetry HUD (Screenshot 3)
        if (Mode === "cockpit")
            this.RenderCockpitWindshieldHud(Ctx, W, H);
        else
            this.RenderChaseDualWingHud(Ctx, W, H);

        // ④ Top Low-Fuel / Low-800V-Battery Optical Advisory (or active robot refueling telemetry)
        this.RenderResourceAndServiceOverlay(Ctx, W, H, Mode);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                           3D GROUND-PROJECTED ADAS RADAR CARPET & FLANK GLOW
    //--------------------------------------------------------------------------------------------------------------------

    Render3DGroundRadarCarpet(Ctx, W, H, Cam, Mode)
    {
        const Vehicle = this.Host?.Vehicle;
        if (!Vehicle)
            return;
        const CarPos = Vehicle.Position;
        const Vel    = Vehicle.LinearVelocity || [0.0, 0.0, 0.0];
        const Speed  = Math.hypot(Vel[0], Vel[1], Vel[2]);
        const Fwd    = Vehicle.QueryForward ? Vehicle.QueryForward() : RotateVector(Vehicle.Orientation, [1.0, 0.0, 0.0]);
        const Up     = RotateVector(Vehicle.Orientation, [0.0, 0.0, 1.0]);
        if (Up[2] < 0.25)
            return;

        const Right = [Fwd[1] * Up[2] - Fwd[2] * Up[1], Fwd[2] * Up[0] - Fwd[0] * Up[2], Fwd[0] * Up[1] - Fwd[1] * Up[0]];
        const GroundOffsetZ = -0.46;

        // Only fade in the forward radar chevrons when approaching an in-lane target (< 38 m) or braking alert!
        // No more rigid green straight lines permanently glued in front of the vehicle on empty open roads.
        const HasLeadLock = this.LeadCorridorDist < 38.0 || this.BrakeAlertActive;
        const FlankActive = this.LeftFlankThreat > 0.08 || this.RightFlankThreat > 0.08;
        if (!HasLeadLock && !FlankActive)
            return;

        // Curve along actual physical velocity + angular yaw-rate arc (ω_z) rather than rigid nose line
        const AngVel = Vehicle.AngularVelocity || [0.0, 0.0, 0.0];
        const YawRate = ClampScalar(AngVel[2] || -(Vehicle.SteeringAngle || 0.0) * Math.min(Speed, 22.0) * 0.18, -1.3, 1.3);
        const EffSpeed = Math.max(Speed, 8.0);

        const WorldCarpetPt = (ForwardM, LateralM) =>
        {
            const T = ForwardM / EffSpeed;
            const HeadingDelta = YawRate * T;
            // Arc integration: x(s) = sin(θ)/κ, y(s) = (1-cos(θ))/κ
            let LocalFwd = ForwardM;
            let CurveLat = 0.0;
            if (Math.abs(HeadingDelta) > 0.02)
            {
                const Radius = EffSpeed / YawRate;
                LocalFwd = Radius * Math.sin(HeadingDelta);
                CurveLat = Radius * (1.0 - Math.cos(HeadingDelta));
            }
            const Lat = LateralM - CurveLat;
            return [
                CarPos[0] + Fwd[0] * LocalFwd + Right[0] * Lat + Up[0] * GroundOffsetZ,
                CarPos[1] + Fwd[1] * LocalFwd + Right[1] * Lat + Up[1] * GroundOffsetZ,
                CarPos[2] + Fwd[2] * LocalFwd + Right[2] * Lat + Up[2] * GroundOffsetZ
            ];
        };

        if (HasLeadLock)
        {
            const MaxCarpet = ClampScalar(this.LeadCorridorDist, 7.0, Mode === "cockpit" ? 32.0 : 36.0);
            const IsBrake   = this.BrakeAlertActive;
            const ContextFade = ClampScalar((38.0 - this.LeadCorridorDist) / 12.0, IsBrake ? 1.0 : 0.0, 1.0);
            const WavePhase = (this.Clock * 2.4) % 1.0;
            const BarCount  = 4;

            for (let I = 0; I < BarCount; ++I)
            {
                const D0 = 6.5 + I * 6.4;
                const D1 = D0 + 3.8;
                if (D0 >= MaxCarpet)
                    break;
                const EndD = Math.min(D1, MaxCarpet);
                const HalfW0 = Lerp(0.88, 0.64, I / BarCount);
                const HalfW1 = Lerp(0.84, 0.60, (I + 0.7) / BarCount);

                const P0 = this.ProjectWorld(WorldCarpetPt(D0,   -HalfW0), W, H, Cam);
                const P1 = this.ProjectWorld(WorldCarpetPt(D0,    HalfW0), W, H, Cam);
                const P2 = this.ProjectWorld(WorldCarpetPt(EndD,  HalfW1), W, H, Cam);
                const P3 = this.ProjectWorld(WorldCarpetPt(EndD, -HalfW1), W, H, Cam);
                if (!P0 || !P1 || !P2 || !P3)
                    continue;

                const NormIdx = I / BarCount;
                const Pulse   = Math.exp(-14.0 * ((NormIdx - WavePhase) ** 2));
                const Alpha   = ContextFade * (0.14 + 0.14 * (1.0 - NormIdx) + 0.14 * Pulse) * this.ModeTransition;

                Ctx.beginPath();
                Ctx.moveTo(P0[0], P0[1]);
                Ctx.lineTo(P1[0], P1[1]);
                Ctx.lineTo(P2[0], P2[1]);
                Ctx.lineTo(P3[0], P3[1]);
                Ctx.closePath();

                if (IsBrake)
                {
                    Ctx.fillStyle   = `rgba(255, 52, 68, ${(Alpha * 1.35).toFixed(3)})`;
                    Ctx.strokeStyle = `rgba(255, 110, 120, ${(Alpha * 2.1).toFixed(3)})`;
                }
                else
                {
                    Ctx.fillStyle   = `rgba(246, 188, 62, ${(Alpha * 1.10).toFixed(3)})`;
                    Ctx.strokeStyle = `rgba(255, 214, 96, ${(Alpha * 1.80).toFixed(3)})`;
                }
                Ctx.fill();
                Ctx.lineWidth = 1.1;
                Ctx.stroke();
            }
        }

        // Adjacent-lane crimson hazard wedge when a train, police cruiser, or obstacle encroaches alongside
        for (const [SideSign, Threat] of [[-1.0, this.LeftFlankThreat], [1.0, this.RightFlankThreat]])
        {
            if (Threat <= 0.08)
                continue;
            const W0 = this.ProjectWorld(WorldCarpetPt(5.0,  SideSign * 1.35), W, H, Cam);
            const W1 = this.ProjectWorld(WorldCarpetPt(5.0,  SideSign * 4.20), W, H, Cam);
            const W2 = this.ProjectWorld(WorldCarpetPt(30.0, SideSign * 3.80), W, H, Cam);
            const W3 = this.ProjectWorld(WorldCarpetPt(30.0, SideSign * 1.25), W, H, Cam);
            if (!W0 || !W1 || !W2 || !W3)
                continue;
            const PulseA = Threat * (0.24 + 0.10 * Math.sin(this.Clock * 9.0));
            Ctx.beginPath();
            Ctx.moveTo(W0[0], W0[1]);
            Ctx.lineTo(W1[0], W1[1]);
            Ctx.lineTo(W2[0], W2[1]);
            Ctx.lineTo(W3[0], W3[1]);
            Ctx.closePath();
            Ctx.fillStyle = `rgba(255, 38, 56, ${PulseA.toFixed(3)})`;
            Ctx.fill();
        }
    }

    // 📝 Projects glowing cyan/emerald 3D ground chevrons curving from ahead of the car toward the nearest Fuel/EV Bay!
    Render3DStationGuidancePath(Ctx, W, H, Cam)
    {
        const Guide   = this.StationGuidance;
        const Vehicle = this.Host?.Vehicle;
        if (!Guide || !Vehicle)
            return;
        const CarPos = Vehicle.Position;
        const BayPos = Guide.Station.BayCenter;
        const IsEV   = Guide.Kind === "electric";
        const ColRGB = IsEV ? "62, 224, 198" : "255, 186, 66";

        const DX = BayPos[0] - CarPos[0];
        const DY = BayPos[1] - CarPos[1];
        const TotalD = Math.hypot(DX, DY);
        if (TotalD < 5.5)
            return;
        const DirX = DX / TotalD, DirY = DY / TotalD;
        const PerpX = -DirY, PerpY = DirX;

        const StepCount = Math.min(7, Math.floor(Math.min(TotalD, 48.0) / 6.0));
        const Scroll    = (this.Clock * 2.2) % 1.0;

        for (let I = 1; I <= StepCount; ++I)
        {
            const DistAlong = (I + Scroll) * 5.8;
            if (DistAlong > TotalD - 3.0 || DistAlong > 46.0)
                continue;
            const CX = CarPos[0] + DirX * DistAlong;
            const CY = CarPos[1] + DirY * DistAlong;
            const CZ = 0.14;

            const Tip   = this.ProjectWorld([CX + DirX * 1.15, CY + DirY * 1.15, CZ], W, H, Cam);
            const Left  = this.ProjectWorld([CX - DirX * 0.65 + PerpX * 0.95, CY - DirY * 0.65 + PerpY * 0.95, CZ], W, H, Cam);
            const Right = this.ProjectWorld([CX - DirX * 0.65 - PerpX * 0.95, CY - DirY * 0.65 - PerpY * 0.95, CZ], W, H, Cam);
            if (!Tip || !Left || !Right)
                continue;

            const Fade = (1.0 - DistAlong / 50.0) * 0.78;
            Ctx.beginPath();
            Ctx.moveTo(Left[0], Left[1]);
            Ctx.lineTo(Tip[0], Tip[1]);
            Ctx.lineTo(Right[0], Right[1]);
            Ctx.strokeStyle = `rgba(${ColRGB}, ${Fade.toFixed(3)})`;
            Ctx.lineWidth = 2.6;
            Ctx.lineCap = "round";
            Ctx.lineJoin = "round";
            Ctx.stroke();
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                   3D WORLD-SPACE OBJECT SILHOUETTE HIGHLIGHTS, TRIANGLES (▽) & CHEVRONS (∨)
    //--------------------------------------------------------------------------------------------------------------------

    Render3DTargetHighlights(Ctx, W, H, Cam, Mode)
    {
        for (const T of this.SortedTargets)
        {
            const IsPinned = this.PinnedTargetId === T.Id;
            const Alpha    = T.Alpha * this.ModeTransition;
            if (Alpha <= 0.04)
                continue;

            const C  = T.Position;
            const HX = T.HalfExtent[0] * T.PopScale;
            const HY = T.HalfExtent[1] * T.PopScale;
            const HZ = T.HalfExtent[2] * T.PopScale;
            const CY = Math.cos(T.Yaw || 0.0), SY = Math.sin(T.Yaw || 0.0);

            const LocalCorners = [
                [-HX, -HY, -HZ], [ HX, -HY, -HZ], [ HX,  HY, -HZ], [-HX,  HY, -HZ],
                [-HX, -HY,  HZ], [ HX, -HY,  HZ], [ HX,  HY,  HZ], [-HX,  HY,  HZ]
            ];

            const ScreenCorners = [];
            let ValidCount = 0;
            let MinX = Infinity, MaxX = -Infinity, MinY = Infinity, MaxY = -Infinity;
            for (let I = 0; I < 8; ++I)
            {
                const [LX, LY, LZ] = LocalCorners[I];
                const WX = C[0] + LX * CY - LY * SY;
                const WY = C[1] + LX * SY + LY * CY;
                const WZ = C[2] + LZ;
                const SP = this.ProjectWorld([WX, WY, WZ], W, H, Cam);
                ScreenCorners.push(SP);
                if (SP)
                {
                    ValidCount++;
                    MinX = Math.min(MinX, SP[0]);
                    MaxX = Math.max(MaxX, SP[0]);
                    MinY = Math.min(MinY, SP[1]);
                    MaxY = Math.max(MaxY, SP[1]);
                }
            }

            if (ValidCount < 3 || MaxX < -40 || MinX > W + 40 || MaxY < -40 || MinY > H + 40)
                continue;

            // Palette by severity / kind
            let RGB = "94, 234, 168"; // emerald/cyan nominal
            if (T.Severity === "critical")
                RGB = "255, 50, 68";
            else if (T.Severity === "caution")
                RGB = "250, 190, 64";
            else if (T.Kind === "station")
                RGB = T.Label.includes("800V") ? "58, 228, 206" : "255, 188, 68";

            const Pulse = 0.85 + 0.15 * Math.sin(this.Clock * (T.Severity === "critical" ? 11.0 : 5.0));

            // ① 3D Convex Hull X-Ray Object Highlight Fill + Wireframe Edges (matches Screenshot 2 red animal highlight!)
            if (this.DisplayStyle === "full" || T.Severity === "critical" || IsPinned)
            {
                const VisiblePts = ScreenCorners.filter(Boolean);
                const Hull = ComputeScreenConvexHull(VisiblePts);
                if (Hull.length >= 3)
                {
                    Ctx.beginPath();
                    Ctx.moveTo(Hull[0][0], Hull[0][1]);
                    for (let I = 1; I < Hull.length; ++I)
                        Ctx.lineTo(Hull[I][0], Hull[I][1]);
                    Ctx.closePath();
                    const FillA = (T.Severity === "critical" ? 0.24 : (IsPinned ? 0.20 : 0.11)) * Alpha * Pulse;
                    Ctx.fillStyle   = `rgba(${RGB}, ${FillA.toFixed(3)})`;
                    Ctx.strokeStyle = `rgba(${RGB}, ${(0.72 * Alpha * Pulse).toFixed(3)})`;
                    Ctx.lineWidth   = T.Severity === "critical" || IsPinned ? 1.9 : 1.25;
                    Ctx.fill();
                    Ctx.stroke();
                }

                // Crisp 3D oriented bounding edges
                if (ValidCount === 8)
                {
                    Ctx.beginPath();
                    for (const [A, B] of BoxEdges)
                    {
                        const PA = ScreenCorners[A], PB = ScreenCorners[B];
                        Ctx.moveTo(PA[0], PA[1]);
                        Ctx.lineTo(PB[0], PB[1]);
                    }
                    Ctx.strokeStyle = `rgba(${RGB}, ${(0.42 * Alpha).toFixed(3)})`;
                    Ctx.lineWidth   = 1.0;
                    Ctx.stroke();
                }
            }

            // ② Overhead Callout Anchor above 3D Top Center of Object
            const TopAnchor = this.ProjectWorld([C[0], C[1], C[2] + HZ + 0.35], W, H, Cam);
            if (!TopAnchor)
                continue;
            const CXScreen = ClampScalar(TopAnchor[0], 68, W - 68);
            const CYScreen = ClampScalar(TopAnchor[1], 46, H - 150);
            const Bob      = Math.sin(this.Clock * 5.2 + C[0] * 0.1) * 3.2;
            const DistFmt  = this.FormatDistance(T.Dist);
            const DistText = `${DistFmt.Value}${DistFmt.Unit}`;

            Ctx.save();
            Ctx.globalAlpha = Alpha;

            if (T.Severity === "critical" || (T.Severity === "caution" && T.Kind !== "rail" && T.Kind !== "signal"))
            {
                // 🔺 Screenshot 2 Style: Glowing Inverted Red/Amber Warning Triangle (▽) + Hazard Glyph + Chevron (∨) + Distance!
                const TriY = CYScreen - 26 + Bob;
                const TriS = (T.Severity === "critical" ? 15.0 : 12.5) * T.PopScale;

                // Animated downward chevron ∨ right above object crown
                Ctx.beginPath();
                Ctx.moveTo(CXScreen - 8, CYScreen - 9 + Bob);
                Ctx.lineTo(CXScreen,     CYScreen - 2 + Bob);
                Ctx.lineTo(CXScreen + 8, CYScreen - 9 + Bob);
                Ctx.strokeStyle = `rgb(${RGB})`;
                Ctx.lineWidth = 2.4;
                Ctx.stroke();

                // Inverted glowing hazard triangle ▽
                Ctx.beginPath();
                Ctx.moveTo(CXScreen - TriS, TriY - TriS * 0.78);
                Ctx.lineTo(CXScreen + TriS, TriY - TriS * 0.78);
                Ctx.lineTo(CXScreen,        TriY + TriS * 0.95);
                Ctx.closePath();
                Ctx.fillStyle   = `rgba(${RGB}, 0.26)`;
                Ctx.strokeStyle = `rgb(${RGB})`;
                Ctx.lineWidth   = 2.2;
                Ctx.fill();
                Ctx.stroke();

                // Exclamation / hazard bar inside triangle
                Ctx.fillStyle = "#ffffff";
                Ctx.font = "700 11px 'JetBrains Mono', monospace";
                Ctx.textAlign = "center";
                Ctx.textBaseline = "middle";
                Ctx.fillText("!", CXScreen, TriY - 1);

                // Micro-header above triangle ("TRAIN HAZARD" / "ROAD OBSTACLE" / "RAISED BOLLARD")
                Ctx.font = "700 9.5px 'JetBrains Mono', monospace";
                Ctx.fillStyle = `rgb(${RGB})`;
                Ctx.fillText(T.Label, CXScreen, TriY - TriS * 0.78 - 8);

                // Crisp distance readout beside triangle (exactly like "19m" in Screenshot 2!)
                Ctx.font = "700 14px 'DM Sans', system-ui, sans-serif";
                Ctx.textAlign = "left";
                Ctx.fillStyle = `rgb(${RGB})`;
                Ctx.fillText(DistText, CXScreen + TriS + 6, TriY + 2);

                this.ScreenHitBoxes.push({ Id: T.Id, X: CXScreen - 46, Y: TriY - 28, W: 108, H: 52 });
            }
            else
            {
                // 🟢 Screenshot 1 Style: Pure Floating Chevron (∨) + Optical Glowing Text (ZERO black textbox!)
                const ChevY = CYScreen - 5 + Bob;
                Ctx.beginPath();
                Ctx.moveTo(CXScreen - 9, ChevY - 7);
                Ctx.lineTo(CXScreen,     ChevY + 1);
                Ctx.lineTo(CXScreen + 9, ChevY - 7);
                Ctx.strokeStyle = `rgb(${RGB})`;
                Ctx.lineWidth = 2.4;
                Ctx.stroke();

                const BadgeText = `${T.Label} · ${DistText}`;
                Ctx.font = "700 12px 'DM Sans', system-ui, sans-serif";
                const TW = Ctx.measureText(BadgeText).width + 14;
                const BX = CXScreen - TW * 0.5;
                const BY = ChevY - 26;

                Ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
                Ctx.shadowBlur  = 6;
                Ctx.fillStyle   = `rgb(${RGB})`;
                Ctx.textAlign   = "center";
                Ctx.textBaseline = "middle";
                Ctx.fillText(BadgeText, CXScreen, BY + 8);
                Ctx.shadowBlur  = 0;

                if (IsPinned)
                {
                    // Open hairline corner ticks only — no filled dark box
                    Ctx.strokeStyle = "#ffffff";
                    Ctx.lineWidth = 1.4;
                    Ctx.beginPath();
                    Ctx.moveTo(BX, BY + 4); Ctx.lineTo(BX, BY); Ctx.lineTo(BX + 6, BY);
                    Ctx.moveTo(BX + TW - 6, BY); Ctx.lineTo(BX + TW, BY); Ctx.lineTo(BX + TW, BY + 4);
                    Ctx.stroke();
                }

                this.ScreenHitBoxes.push({ Id: T.Id, X: BX, Y: BY, W: TW, H: 28 });
            }

            // Expanded floating optical telemetry when user clicks/pins a 3D target (zero black box!)
            if (IsPinned)
            {
                const ClosingKmh = Math.round(T.ClosingVel * (this.SpeedUnit === "mph" ? 2.23694 : 3.6));
                const UnitLbl    = this.SpeedUnit === "mph" ? "MPH" : "KM/H";
                const PinLine    = `LOCK · ΔV ${ClosingKmh >= 0 ? "+" : ""}${ClosingKmh} ${UnitLbl}`
                                 + (T.TTC < 19.0 ? ` · TTC ${T.TTC.toFixed(1)}S` : (T.SubLabel ? ` · ${T.SubLabel}` : ""));
                Ctx.font = "700 10.5px 'JetBrains Mono', monospace";
                Ctx.shadowColor = "rgba(0, 0, 0, 0.78)";
                Ctx.shadowBlur  = 6;
                Ctx.fillStyle   = "#ffffff";
                Ctx.textAlign   = "center";
                Ctx.textBaseline = "middle";
                Ctx.fillText(PinLine, CXScreen, MaxY + 14);
                Ctx.shadowBlur  = 0;
            }

            Ctx.restore();
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                   MODE A: CHASE / EXTERIOR CURVED DUAL-WING ADAS HUD (SCREENSHOT 3)
    //--------------------------------------------------------------------------------------------------------------------

    RenderChaseDualWingHud(Ctx, W, H)
    {
        const Vehicle   = this.Host?.Vehicle;
        const Telemetry = Vehicle?.QueryTelemetry ? Vehicle.QueryTelemetry() : { Gear: "D", EngineRPM: 900 };
        const SpeedVal  = this.FormatSpeed(this.SmoothSpeedMps);
        const UnitStr   = this.SpeedUnit === "mph" ? "MPH" : "KM/H";
        const FuelPct   = Math.round(this.SmoothFuel * 100);
        const BattPct   = Math.round(this.SmoothBattery * 100);

        const SlideInY = (1.0 - this.ModeTransition) * 28.0;
        const CX = W * 0.5 + this.SmoothShiftX;
        const BaseY = H - 36 + this.SmoothShiftY + SlideInY;
        const WingSpan = Math.min(340, Math.max(220, W * 0.30));

        Ctx.save();
        Ctx.globalAlpha = ClampScalar(this.ModeTransition, 0.0, 1.0);
        Ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
        Ctx.shadowBlur  = 6;

        const AccentRGB = this.BrakeAlertActive ? "255, 58, 72" : "58, 224, 210";

        // ① LEFT CURVED WING (Speed + Gear Ring + RPM Arc + Fuel & 800V EV Bars)
        const LeftX0 = CX - WingSpan;
        const LeftX1 = CX - 88;
        const WingGradL = Ctx.createLinearGradient(LeftX0, BaseY, LeftX1, BaseY);
        WingGradL.addColorStop(0.0, this.BrakeAlertActive ? "#ff3b4e" : "#f5c249");
        WingGradL.addColorStop(0.35, this.BrakeAlertActive ? "#ff5c6c" : "#56e39f");
        WingGradL.addColorStop(1.0, `rgba(${AccentRGB}, 0.92)`);

        Ctx.beginPath();
        Ctx.moveTo(LeftX0 - 16, BaseY - 34);
        Ctx.quadraticCurveTo(LeftX0 - 4, BaseY, LeftX0 + 22, BaseY);
        Ctx.lineTo(LeftX1, BaseY);
        Ctx.strokeStyle = WingGradL;
        Ctx.lineWidth = 3.4;
        Ctx.stroke();

        // Large digital speed readout
        Ctx.fillStyle = "#ffffff";
        Ctx.font = "700 38px 'DM Sans', system-ui, sans-serif";
        Ctx.textAlign = "left";
        Ctx.textBaseline = "alphabetic";
        Ctx.fillText(String(SpeedVal), LeftX0 + 18, BaseY - 12);
        const SpdW = Ctx.measureText(String(SpeedVal)).width;
        Ctx.font = "600 11px 'JetBrains Mono', monospace";
        Ctx.fillStyle = "rgba(210, 236, 245, 0.82)";
        Ctx.fillText(UnitStr, LeftX0 + 22 + SpdW, BaseY - 14);

        // Circular Gear / Speed-Limit Ring (open optical ring — no dark fill!)
        const RingX = LeftX0 + 96 + Math.max(0, SpdW - 42);
        const RingY = BaseY - 25;
        const LimitKmh = this.Host?.Police?.QueryPostedSpeedLimitKmh?.() || null;
        Ctx.beginPath();
        Ctx.arc(RingX, RingY, 15.5, 0, Math.PI * 2);
        Ctx.strokeStyle = this.BrakeAlertActive ? "#ff4858" : (LimitKmh ? "#ff5262" : "#f2ad42");
        Ctx.lineWidth = 2.4;
        Ctx.stroke();
        Ctx.fillStyle = "#ffffff";
        Ctx.font = "700 11.5px 'JetBrains Mono', monospace";
        Ctx.textAlign = "center";
        Ctx.textBaseline = "middle";
        const RingLabel = LimitKmh
            ? String(this.SpeedUnit === "mph" ? Math.round(LimitKmh * 0.621371) : LimitKmh)
            : `G${Telemetry.Gear ?? "D"}`;
        Ctx.fillText(RingLabel, RingX, RingY + 0.5);

        // Under-wing Fuel Tank & 800V EV Battery Telemetry Bars
        const DrawMiniBar = (BX, Label, Pct, ColNormal) =>
        {
            const IsLow  = Pct <= 25;
            const IsCrit = Pct <= 14;
            const Col    = IsCrit ? "#ff3b4e" : (IsLow ? "#f7b73b" : ColNormal);
            Ctx.font = "600 10px 'JetBrains Mono', monospace";
            Ctx.textAlign = "left";
            Ctx.textBaseline = "middle";
            Ctx.fillStyle = IsLow ? Col : "rgba(216, 234, 242, 0.85)";
            Ctx.fillText(`${Label} ${Pct}%`, BX, BaseY + 15);
            const BarX = BX + 52;
            const BarW = 54;
            Ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
            Ctx.fillRect(BarX, BaseY + 11, BarW, 6);
            Ctx.fillStyle = Col;
            Ctx.fillRect(BarX, BaseY + 11, BarW * ClampScalar(Pct / 100.0, 0.0, 1.0), 6);
        };
        DrawMiniBar(LeftX0 + 18, "⛽", FuelPct, "#5ce0a8");
        DrawMiniBar(LeftX0 + 136, "⚡", BattPct, "#4ad4f5");

        // ② CENTER ADAS STATUS / BRAKE MODULE (`< [ 🚗 RADAR LOCK / CLEAR ] >`)
        const CenterY = BaseY - 12;
        // Animated chevron brackets <   >
        const Spread = 70 + (this.BrakeAlertActive ? Math.sin(this.Clock * 16.0) * 4.0 : 0.0);
        for (const Dir of [-1, 1])
        {
            Ctx.beginPath();
            Ctx.moveTo(CX + Dir * (Spread - 7), CenterY - 13);
            Ctx.lineTo(CX + Dir * (Spread + 2), CenterY);
            Ctx.lineTo(CX + Dir * (Spread - 7), CenterY + 13);
            Ctx.strokeStyle = `rgba(${AccentRGB}, 0.90)`;
            Ctx.lineWidth = 2.0;
            Ctx.stroke();
        }

        if (this.BrakeAlertActive)
        {
            // Pure glowing crimson BRAKE projection (zero opaque box!)
            const Flash = 0.72 + 0.28 * Math.sin(this.Clock * 18.0);
            Ctx.fillStyle   = `rgba(255, 62, 74, ${Flash.toFixed(3)})`;
            Ctx.shadowColor = "rgba(255, 32, 48, 0.90)";
            Ctx.shadowBlur  = 14;
            Ctx.font = "800 18px 'DM Sans', system-ui, sans-serif";
            Ctx.textAlign = "center";
            Ctx.textBaseline = "middle";
            Ctx.fillText("B R A K E", CX, CenterY);
            Ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
            Ctx.shadowBlur  = 6;
        }
        else
        {
            // Stylized car silhouette + radar distance status
            Ctx.fillStyle = "#e6f9f6";
            Ctx.beginPath();
            Ctx.roundRect(CX - 11, CenterY - 11, 22, 9, 3);
            Ctx.fill();
            const LeadTxt = this.LeadCorridorDist < 48.0
                ? `LEAD ${Math.round(this.LeadCorridorDist)}M`
                : (this.SortedTargets.length > 0 ? `${this.SortedTargets.length} TRACKED` : "PATH CLEAR");
            Ctx.font = "600 10px 'JetBrains Mono', monospace";
            Ctx.fillStyle = `rgb(${AccentRGB})`;
            Ctx.textAlign = "center";
            Ctx.textBaseline = "middle";
            Ctx.fillText(LeadTxt, CX, CenterY + 9);
        }

        // ③ RIGHT CURVED WING (Distance to Station / Target + Sector / Road Name)
        const RightX0 = CX + 88;
        const RightX1 = CX + WingSpan;
        const WingGradR = Ctx.createLinearGradient(RightX0, BaseY, RightX1, BaseY);
        WingGradR.addColorStop(0.0, `rgba(${AccentRGB}, 0.92)`);
        WingGradR.addColorStop(0.65, this.BrakeAlertActive ? "#ff5c6c" : "#56e39f");
        WingGradR.addColorStop(1.0, this.BrakeAlertActive ? "#ff3b4e" : "#44d8f2");

        Ctx.beginPath();
        Ctx.moveTo(RightX0, BaseY);
        Ctx.lineTo(RightX1 - 22, BaseY);
        Ctx.quadraticCurveTo(RightX1 + 4, BaseY, RightX1 + 16, BaseY - 34);
        Ctx.strokeStyle = WingGradR;
        Ctx.lineWidth = 3.4;
        Ctx.stroke();

        // Primary right readout: Nearest Fuel/EV Bay distance if active, else primary target distance or RPM
        let RightMain = `${(Telemetry.EngineRPM / 1000.0).toFixed(1)}`;
        let RightUnit = "KRPM";
        let SubSector = this.ActiveSectorName;
        if (this.StationGuidance && (this.StationGuidance.AutoTriggered || this.StationGuidance.Pinned || this.StationGuidance.Dist < 110.0))
        {
            const DF = this.FormatDistance(this.StationGuidance.Dist);
            RightMain = DF.Value;
            RightUnit = DF.Unit.toUpperCase();
            SubSector = this.StationGuidance.Kind === "electric" ? "⚡ AUTO-800V EV BAY" : "⛽ AUTO-FUEL ROBOT BAY";
        }
        else if (this.SortedTargets.length > 0)
        {
            const DF = this.FormatDistance(this.SortedTargets[0].Dist);
            RightMain = DF.Value;
            RightUnit = DF.Unit.toUpperCase();
            SubSector = `${this.SortedTargets[0].Label} · ${this.ActiveSectorName}`;
        }

        Ctx.fillStyle = "#ffffff";
        Ctx.font = "700 32px 'DM Sans', system-ui, sans-serif";
        Ctx.textAlign = "right";
        Ctx.textBaseline = "alphabetic";
        Ctx.fillText(RightMain, RightX1 - 52, BaseY - 12);
        Ctx.font = "600 11px 'JetBrains Mono', monospace";
        Ctx.fillStyle = "rgba(210, 236, 245, 0.82)";
        Ctx.textAlign = "left";
        Ctx.fillText(RightUnit, RightX1 - 46, BaseY - 14);

        Ctx.font = "600 10.5px 'JetBrains Mono', monospace";
        Ctx.fillStyle = "rgba(226, 242, 248, 0.88)";
        Ctx.textAlign = "right";
        Ctx.fillText(SubSector.slice(0, 30), RightX1 - 16, BaseY + 16);

        Ctx.restore();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //          MODE B: UNIQUE COCKPIT WINDSHIELD COMBINER HOLOGRAPHIC AR-HUD (SCREENSHOTS 1 & 2!)
    //--------------------------------------------------------------------------------------------------------------------

    RenderCockpitWindshieldHud(Ctx, W, H)
    {
        const Vehicle   = this.Host?.Vehicle;
        const Telemetry = Vehicle?.QueryTelemetry ? Vehicle.QueryTelemetry() : { Gear: "D", EngineRPM: 900 };
        const SpeedVal  = this.FormatSpeed(this.SmoothSpeedMps);
        const UnitStr   = this.SpeedUnit === "mph" ? "mph" : "km/h";
        const FuelPct   = Math.round(this.SmoothFuel * 100);
        const BattPct   = Math.round(this.SmoothBattery * 100);

        // Collimated optical projection sits on the lower windshield above the dash cowl
        const HeadShiftX = ClampScalar(-(this.Host?.HeadYaw || 0.0) * 90.0, -45.0, 45.0);
        const HeadShiftY = ClampScalar((this.Host?.HeadPitch || 0.0) * 70.0, -35.0, 35.0);
        const CX    = W * 0.50 + this.SmoothShiftX * 0.75 + HeadShiftX;
        const BaseY = H * 0.835 + this.SmoothShiftY * 0.65 + HeadShiftY + (1.0 - this.ModeTransition) * 20.0;

        const TopHalfW = Math.min(185, W * 0.19);
        const BotHalfW = Math.min(242, W * 0.25);
        const FrameH   = 82;
        const TopY     = BaseY - FrameH;

        const IsBrake   = this.BrakeAlertActive;
        const FrameRGB  = IsBrake ? "255, 50, 64" : "92, 242, 186";

        Ctx.save();
        Ctx.globalAlpha = ClampScalar(this.ModeTransition, 0.0, 1.0);

        // ① Flashing "B R A K E" Holographic Alert Banner directly above Trapezoid (Exact match to Screenshots 1 & 2!)
        if (IsBrake)
        {
            const Flash = 0.68 + 0.32 * Math.sin(this.Clock * 18.0);
            Ctx.font = "700 24px 'DM Sans', system-ui, sans-serif";
            Ctx.textAlign = "center";
            Ctx.textBaseline = "bottom";
            Ctx.fillStyle = `rgba(255, 62, 74, ${Flash.toFixed(3)})`;
            Ctx.shadowColor = "rgba(255, 32, 48, 0.85)";
            Ctx.shadowBlur = 14;
            Ctx.fillText("B R A K E", CX, TopY - 6);
            Ctx.shadowBlur = 0;
        }
        else
        {
            // Subtle collimator header tag
            const LimitTag = this.Host?.Police?.QueryPostedSpeedLimitKmh?.();
            const HeaderStr = LimitTag
                ? `WINDSHIELD AR · LIMIT ${LimitTag} · ${this.ActiveSectorName.slice(0, 18)}`
                : `WINDSHIELD AR · ${this.ActiveSectorName.slice(0, 24)}`;
            Ctx.font = "600 9.5px 'JetBrains Mono', monospace";
            Ctx.textAlign = "center";
            Ctx.textBaseline = "bottom";
            Ctx.fillStyle = "rgba(128, 246, 204, 0.62)";
            Ctx.fillText(HeaderStr, CX, TopY - 5);
        }

        // ② Perspective Trapezoidal Windshield Combiner Frame (`/‾‾‾‾‾‾‾‾‾‾\` — pure optical glass line, zero dark tint!)
        Ctx.beginPath();
        Ctx.moveTo(CX - BotHalfW, BaseY);
        Ctx.lineTo(CX - TopHalfW, TopY);
        Ctx.lineTo(CX + TopHalfW, TopY);
        Ctx.lineTo(CX + BotHalfW, BaseY);
        Ctx.strokeStyle = `rgba(${FrameRGB}, ${IsBrake ? 0.95 : 0.78})`;
        Ctx.lineWidth   = IsBrake ? 2.8 : 2.0;
        Ctx.stroke();

        // ③ LEFT ZONE INSIDE TRAPEZOID: Live Rotating Vector Mini-Radar Grid (pure glowing green/white lines, zero dark box!)
        const MapCX = CX - TopHalfW * 0.66;
        const MapCY = TopY + FrameH * 0.50;
        const MapW  = 78, MapH = 48;
        Ctx.save();
        Ctx.beginPath();
        Ctx.rect(MapCX - MapW * 0.5, MapCY - MapH * 0.5, MapW, MapH);
        Ctx.clip();

        // Grid lines scrolling with vehicle world coordinates
        const CarPos = Vehicle?.Position || [0, 0, 0];
        const Fwd    = Vehicle?.QueryForward ? Vehicle.QueryForward() : [1, 0, 0];
        const Right  = [Fwd[1], -Fwd[0]];
        Ctx.strokeStyle = "rgba(180, 236, 224, 0.25)";
        Ctx.lineWidth = 1.0;
        for (let G = -24; G <= 24; G += 16)
        {
            Ctx.beginPath();
            Ctx.moveTo(MapCX - MapW * 0.5, MapCY + G);
            Ctx.lineTo(MapCX + MapW * 0.5, MapCY + G);
            Ctx.moveTo(MapCX + G, MapCY - MapH * 0.5);
            Ctx.lineTo(MapCX + G, MapCY + MapH * 0.5);
            Ctx.stroke();
        }

        // Plot tracked targets on mini-radar
        for (const T of this.SortedTargets)
        {
            const DX = T.Position[0] - CarPos[0];
            const DY = T.Position[1] - CarPos[1];
            const RFwd  = DX * Fwd[0]   + DY * Fwd[1];
            const RSide = DX * Right[0] + DY * Right[1];
            const PX = MapCX + RSide * 0.45;
            const PY = MapCY - RFwd  * 0.45 + 10;
            Ctx.fillStyle = T.Severity === "critical" ? "#ff3e50" : (T.Kind === "station" ? "#46e8d2" : "#f7c44c");
            Ctx.beginPath();
            Ctx.arc(PX, PY, 2.6, 0, Math.PI * 2);
            Ctx.fill();
        }

        // Bright green route/heading vector arrow (Screenshot 1!)
        Ctx.strokeStyle = "#55f28a";
        Ctx.lineWidth = 2.4;
        Ctx.beginPath();
        Ctx.moveTo(MapCX, MapCY + 18);
        Ctx.lineTo(MapCX, MapCY - 8);
        if (this.StationGuidance)
        {
            const TurnDir = ClampScalar(this.StationGuidance.BearingRad, -1.0, 1.0);
            Ctx.lineTo(MapCX + TurnDir * 18, MapCY - 14);
        }
        Ctx.stroke();
        Ctx.restore();

        // ④ CENTER ZONE INSIDE TRAPEZOID: Collimated Digital Speed + Gear + Fuel/EV Optical Bars
        Ctx.fillStyle = "#f2fffc";
        Ctx.font = "600 34px 'DM Sans', system-ui, sans-serif";
        Ctx.textAlign = "right";
        Ctx.textBaseline = "alphabetic";
        Ctx.fillText(String(SpeedVal), CX + 6, TopY + 46);

        Ctx.font = "500 13px 'DM Sans', system-ui, sans-serif";
        Ctx.textAlign = "left";
        Ctx.fillStyle = "rgba(220, 252, 242, 0.88)";
        Ctx.fillText(`${UnitStr} · G${Telemetry.Gear ?? "D"}`, CX + 11, TopY + 45);

        // Compact collimated Fuel & 800V EV optical bars inside combiner
        const DrawOpticBar = (OX, Icon, Pct, NormalHex) =>
        {
            const Col = Pct <= 14 ? "#ff4254" : (Pct <= 25 ? "#f8be44" : NormalHex);
            Ctx.font = "600 9.5px 'JetBrains Mono', monospace";
            Ctx.fillStyle = Col;
            Ctx.textAlign = "left";
            Ctx.fillText(`${Icon}${Pct}%`, OX, TopY + 64);
            Ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
            Ctx.fillRect(OX + 35, TopY + 58, 34, 4.5);
            Ctx.fillStyle = Col;
            Ctx.fillRect(OX + 35, TopY + 58, 34 * ClampScalar(Pct / 100.0, 0.0, 1.0), 4.5);
        };
        DrawOpticBar(CX - 74, "⛽", FuelPct, "#68f2b8");
        DrawOpticBar(CX + 4,   "⚡", BattPct, "#5ce0fa");

        // ⑤ RIGHT ZONE INSIDE TRAPEZOID: Turn Arrow + Distance (`↱ 42 m`, matching Screenshots 1 & 2!)
        const NavX = CX + TopHalfW * 0.62;
        const NavY = TopY + 38;
        let NavDist = null;
        let TurnAngle = 0.0;
        let NavCaption = "CLEAR";

        if (this.StationGuidance && (this.StationGuidance.AutoTriggered || this.StationGuidance.Pinned || this.StationGuidance.Dist < 130.0))
        {
            NavDist    = this.FormatDistance(this.StationGuidance.Dist);
            TurnAngle  = this.StationGuidance.BearingRad;
            NavCaption = this.StationGuidance.Kind === "electric" ? "800V BAY" : "FUEL BAY";
        }
        else if (this.SortedTargets.length > 0)
        {
            NavDist    = this.FormatDistance(this.SortedTargets[0].Dist);
            TurnAngle  = 0.0;
            NavCaption = this.SortedTargets[0].Kind.toUpperCase();
        }

        // Crisp vector turn arrow (straight ↑, left ↰, or right ↱)
        Ctx.strokeStyle = "#e8fff9";
        Ctx.lineWidth = 2.2;
        Ctx.beginPath();
        if (Math.abs(TurnAngle) > 0.38)
        {
            const Dir = Math.sign(TurnAngle);
            Ctx.moveTo(NavX - 28, NavY + 9);
            Ctx.lineTo(NavX - 28, NavY - 5);
            Ctx.lineTo(NavX - 28 + Dir * 12, NavY - 5);
            Ctx.moveTo(NavX - 28 + Dir * 7, NavY - 10);
            Ctx.lineTo(NavX - 28 + Dir * 12, NavY - 5);
            Ctx.lineTo(NavX - 28 + Dir * 7, NavY);
        }
        else
        {
            Ctx.moveTo(NavX - 24, NavY + 9);
            Ctx.lineTo(NavX - 24, NavY - 8);
            Ctx.moveTo(NavX - 29, NavY - 3);
            Ctx.lineTo(NavX - 24, NavY - 8);
            Ctx.lineTo(NavX - 19, NavY - 3);
        }
        Ctx.stroke();

        if (NavDist)
        {
            Ctx.fillStyle = "#f2fffc";
            Ctx.font = "600 24px 'DM Sans', system-ui, sans-serif";
            Ctx.textAlign = "left";
            Ctx.textBaseline = "alphabetic";
            Ctx.fillText(NavDist.Value, NavX - 8, NavY + 7);
            const DW = Ctx.measureText(NavDist.Value).width;
            Ctx.font = "500 12px 'DM Sans', system-ui, sans-serif";
            Ctx.fillText(NavDist.Unit, NavX - 5 + DW, NavY + 7);
        }
        else
        {
            Ctx.fillStyle = "rgba(180, 248, 224, 0.85)";
            Ctx.font = "600 13px 'JetBrains Mono', monospace";
            Ctx.textAlign = "left";
            Ctx.fillText("CRUISE", NavX - 8, NavY + 5);
        }
        Ctx.font = "600 9px 'JetBrains Mono', monospace";
        Ctx.fillStyle = "rgba(170, 242, 220, 0.72)";
        Ctx.fillText(NavCaption, NavX - 8, NavY + 21);

        // ⑥ Bottom micro-telemetry strip below combiner ("21:08  24°C  TYRE OK", matching "00:20 45°F" in Screenshot 2!)
        const HottestC = this.Host?.Thermal?.Wheels
            ? Math.round(Math.max(...this.Host.Thermal.Wheels.map((Wh) => Wh.Surface)) - 273.15)
            : 28;
        const NowDate = new Date();
        const ClockStr = `${String(NowDate.getUTCHours()).padStart(2, "0")}:${String(NowDate.getUTCMinutes()).padStart(2, "0")}`;
        Ctx.font = "600 10.5px 'JetBrains Mono', monospace";
        Ctx.fillStyle = "rgba(218, 248, 238, 0.78)";
        Ctx.textAlign = "center";
        Ctx.fillText(`${ClockStr}   TYRE ${HottestC}°C   ADAS AR`, CX, BaseY + 14);

        Ctx.restore();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                  LOW-FUEL / LOW-EV WARNING BANNER & LIVE ROBOT ARM REFUELING OVERLAY
    //--------------------------------------------------------------------------------------------------------------------

    RenderResourceAndServiceOverlay(Ctx, W, H, Mode)
    {
        const Service = this.Host?.ServiceStations;
        const Summary = Service ? Service.QuerySummary() : null;

        // ① Active 6-Axis Industrial Robot Arm Refueling / 800V Charging Optical Telemetry (zero black box!)
        if (Summary && Summary.ActiveKind)
        {
            const IsEV  = Summary.ActiveKind === "electric";
            const Pct   = IsEV ? Summary.BatteryPercent : Summary.FuelPercent;
            const Col   = IsEV ? "#46e8d2" : "#ffba42";
            const Title = IsEV ? "⚡ 6-AXIS ROBOT · 800V SUPERCHARGING" : "⛽ 6-AXIS ROBOT · OCTANE-100 REFUELING";
            const Sub   = `${Summary.ActiveState.toUpperCase()} · ${Pct}%`;

            const BX = W * 0.5 - 150, BY = 54;
            Ctx.save();
            Ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
            Ctx.shadowBlur  = 8;
            Ctx.fillStyle   = Col;
            Ctx.font = "700 13px 'DM Sans', system-ui, sans-serif";
            Ctx.textAlign = "center";
            Ctx.fillText(Title, W * 0.5, BY + 14);

            Ctx.fillStyle = "#ffffff";
            Ctx.font = "600 11px 'JetBrains Mono', monospace";
            Ctx.fillText(Sub, W * 0.5, BY + 30);

            Ctx.shadowBlur = 0;
            Ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
            Ctx.fillRect(BX + 20, BY + 36, 260, 3.5);
            Ctx.fillStyle = Col;
            Ctx.fillRect(BX + 20, BY + 36, 260 * ClampScalar(Pct / 100.0, 0.0, 1.0), 3.5);
            Ctx.restore();
            return;
        }

        // ② Low-Fuel / Low-800V-Battery Floating Optical Advisory (zero black box!):
        const FuelPct = Math.round(this.SmoothFuel * 100);
        const BattPct = Math.round(this.SmoothBattery * 100);
        if (FuelPct > 25 && BattPct > 25)
            return;

        const IsCrit  = FuelPct <= 14 || BattPct <= 14;
        const Guide   = this.StationGuidance;
        const LowName = FuelPct <= BattPct ? `LOW FUEL · ${FuelPct}%` : `LOW 800V BATTERY · ${BattPct}%`;
        let DetailTxt = "RESERVE WARNING — VISIT SERVICE BAY";
        if (Guide)
        {
            const DF = this.FormatDistance(Guide.Dist);
            const DirStr = Math.abs(Guide.BearingRad) < 0.35 ? "AHEAD" : (Guide.BearingRad > 0 ? "RIGHT ↱" : "LEFT ↰");
            DetailTxt = Guide.IsClose
                ? `NEAREST ${Guide.Kind === "electric" ? "800V EV" : "FUEL"} BAY · ${DF.Value}${DF.Unit} ${DirStr}`
                : `NEAREST STATION ${DF.Value}${DF.Unit} (${DirStr})`;
        }

        const Pulse = 0.76 + 0.24 * Math.sin(this.Clock * (IsCrit ? 10.0 : 5.0));
        const ColRGB = IsCrit ? "255, 68, 82" : "255, 196, 72";
        const BY = Mode === "cockpit" ? 50 : 52;

        Ctx.save();
        Ctx.globalAlpha = Pulse;
        Ctx.shadowColor = "rgba(0, 0, 0, 0.78)";
        Ctx.shadowBlur  = 8;

        Ctx.fillStyle = `rgb(${ColRGB})`;
        Ctx.font = "700 13px 'DM Sans', system-ui, sans-serif";
        Ctx.textAlign = "center";
        Ctx.fillText(`⚠ ${LowName}`, W * 0.5, BY + 14);

        Ctx.fillStyle = "#f2faf8";
        Ctx.font = "600 10.5px 'JetBrains Mono', monospace";
        Ctx.fillText(DetailTxt, W * 0.5, BY + 30);

        // Crisp hairline optical underline instead of a dark box
        Ctx.shadowBlur = 0;
        Ctx.strokeStyle = `rgba(${ColRGB}, 0.75)`;
        Ctx.lineWidth = 1.5;
        Ctx.beginPath();
        Ctx.moveTo(W * 0.5 - 115, BY + 36);
        Ctx.lineTo(W * 0.5 + 115, BY + 36);
        Ctx.stroke();
        Ctx.restore();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                       SUMMARY FOR INSPECTOR & TESTS
    //--------------------------------------------------------------------------------------------------------------------

    QuerySummary()
    {
        const Mode = this.QueryDisplayMode();
        return {
            Enabled:           this.Enabled,
            ActiveMode:        this.DisplayStyle === "off" ? "off" : Mode,
            DisplayStyle:      this.DisplayStyle,
            SpeedUnit:         this.SpeedUnit,
            TrackedCount:      this.SortedTargets.length,
            BrakeAlertActive:  this.BrakeAlertActive,
            FuelPercent:       Math.round(this.QueryFuelLevel() * 100),
            BatteryPercent:    Math.round(this.QueryBatteryLevel() * 100),
            StationBeaconLive: Boolean(this.StationGuidance?.Show3DBeacon),
            NearestStationM:   this.StationGuidance ? Math.round(this.StationGuidance.Dist) : null,
            SpatialCells:      this.SpatialGrid.size,
            AudioEvents:       { ...this.Audio.Counts }
        };
    }
}

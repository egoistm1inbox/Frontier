//============================================================================================================================================
//                                                         DDAYBATTLESEQUENCE.JS
//============================================================================================================================================
// 🧩 Real-time "D-Day Assault" combat simulation & tactical AR-HUD controller:
//    - Advancing Allied Assault Tanks (dynamic armored cover + take fire & explode into burning wrecks)
//    - Line-of-Sight Bunker / Blast Wall / Tank / Drive-In Shelter cover mechanics (ground + overhead air cover)
//    - Rotating Machine Gun Turrets (visible tracer fire) & Coastal Artillery Cannons (arcing shells + impact rings)
//    - Twin-Engine Bombing Aircraft dropping whistling sticks of bombs + player-callable Air Strike
//    - Armed Proximity Landmines along defensive belts (blast impulse + craters)
//    - Aggressive Enemy Military Patrol Cars (full crash impulse physics, sparks, damage & explosive wrecking)
//    - Atlantic Wall Breach victory loop + WebAudio combat SFX + dynamic lighting / smoke / fireball domes

import { ConstructRigidTransform, ConstructAxisQuaternion, MultiplyQuaternion, RotateVector } from "./TransformProjection.js";
import { VehicleGeometry, ResolveAxleMountLocal } from "./VehicleSpecification.js";
import {
    DDaySpawn, DDayWallReachX, DDayTankSpecs, DDayTurretSpecs, DDayCannonSpecs,
    DDayEnemyCarSpecs, DDayMineCoords, DDayDriveInShelters, BuildDDayCoverBoxes
} from "./DDayStructure.js";

const Gravity            = 9.81;
const TracerPoolSize     = 18;
const ShellPoolSize      = 6;
const BombPoolSize       = 8;
const ExplosionPoolSize  = 8;
const CraterPoolSize     = 14;
const ParkedPosition     = [0.0, 0.0, -55.0];
const IdentityQuat       = [0.0, 0.0, 0.0, 1.0];

function Clamp(V, Lo, Hi) { return V < Lo ? Lo : (V > Hi ? Hi : V); }
function WrapAngle(A)
{
    let R = (A + Math.PI) % (Math.PI * 2.0);
    if (R < 0.0) R += Math.PI * 2.0;
    return R - Math.PI;
}

// 📝 Fast 2D slab intersection test between ray P0 -> P1 and axis-aligned cover box.
export function SegmentHitsBox2D(X0, Y0, X1, Y1, Box)
{
    const DX = X1 - X0;
    const DY = Y1 - Y0;
    let TMin = 0.02;
    let TMax = 0.98;

    if (Math.abs(DX) < 1.0e-6)
    {
        if (X0 < Box.MinX || X0 > Box.MaxX)
            return false;
    }
    else
    {
        const InvX = 1.0 / DX;
        let T1 = (Box.MinX - X0) * InvX;
        let T2 = (Box.MaxX - X0) * InvX;
        if (T1 > T2) { const Tmp = T1; T1 = T2; T2 = Tmp; }
        TMin = Math.max(TMin, T1);
        TMax = Math.min(TMax, T2);
        if (TMin > TMax) return false;
    }

    if (Math.abs(DY) < 1.0e-6)
    {
        if (Y0 < Box.MinY || Y0 > Box.MaxY)
            return false;
    }
    else
    {
        const InvY = 1.0 / DY;
        let T1 = (Box.MinY - Y0) * InvY;
        let T2 = (Box.MaxY - Y0) * InvY;
        if (T1 > T2) { const Tmp = T1; T1 = T2; T2 = Tmp; }
        TMin = Math.max(TMin, T1);
        TMax = Math.min(TMax, T2);
        if (TMin > TMax) return false;
    }

    return TMin <= TMax;
}

export class DDayBattleSequence
{
    constructor(Host)
    {
        this.Host     = Host;
        this.Scene    = Host?.Scene || null;
        this.LevelKey = Host?.LevelKey || "dday";
        this.Active   = this.LevelKey === "dday";

        this.Clock         = 0.0;
        this.MissionClock  = 0.0;
        this.Intensity     = 1.0; // 0 = Peaceful Sightseeing, 1 = Standard D-Day Assault, 1.5 = Heavy Blitz
        this.PlayerMaxHp   = 100.0;
        this.PlayerHp      = 100.0;
        this.PlayerInCover = false;
        this.PlayerUnderAirCover = false;
        this.CoverSource   = "";
        this.LastHitTimer  = 0.0;
        this.LastHitLabel  = "";
        this.WallReached   = false;
        this.BreachTime    = 0.0;
        this.DistanceToWall = 276.0;

        this.CarsSmashed      = 0;
        this.TanksExploded    = 0;
        this.MinesTriggered   = 0;
        this.BombsDropped     = 0;
        this.TurretsSuppressed = 0;

        this.SpectatorTarget = "player"; // "player" | "tank" | "bomber"
        this.CoverOverlayOn  = true;
        this.AirStrikeRequested = false;

        this.CoverBoxes = BuildDDayCoverBoxes();
        this.Seed = 0xDD47;

        this.Tanks      = [];
        this.EnemyCars  = [];
        this.Turrets    = [];
        this.Cannons    = [];
        this.Bombers    = [];
        this.Mines      = [];
        this.Bombs      = [];
        this.Shells     = [];
        this.Tracers    = [];
        this.Explosions = [];
        this.Craters    = [];
        this.CraterCursor = 0;

        this.ControlStrip = null;
        this.DomBtns = null;

        this.InitializeEntities();
        this.MountQuickControls();
        if (this.Active)
            this.SyncAllOccupants(true);
    }

    Rand()
    {
        this.Seed = (Math.imul(this.Seed, 1664525) + 1013904223) >>> 0;
        return this.Seed / 4294967296.0;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                      INITIALIZATION & FULL ASSAULT RESET
    //--------------------------------------------------------------------------------------------------------------------

    InitializeEntities()
    {
        this.Tanks = DDayTankSpecs.map((Spec, Index) => ({
            Index,
            Id:         Spec.Id,
            Name:       Spec.Name,
            Position:   [Spec.Start[0], Spec.Start[1], 0.0],
            Velocity:   [Spec.Speed, 0.0, 0.0],
            Yaw:        0.0,
            TurretYaw:  0.0,
            BarrelPitch: 0.03,
            Recoil:     0.0,
            GoalX:      Spec.GoalX,
            LaneY:      Spec.Start[1],
            CruiseSpeed: Spec.Speed,
            Hp:         180.0,
            MaxHp:      180.0,
            Alive:      true,
            BurningTimer: 0.0,
            RespawnTimer: 0.0,
            FireCooldown: 1.4 + Spec.Phase * 0.6,
            ObstacleBox: {
                Minimum: [Spec.Start[0] - 3.3, Spec.Start[1] - 1.6, 0.0],
                Maximum: [Spec.Start[0] + 3.3, Spec.Start[1] + 1.6, 2.7],
                DynamicDDay: true,
                Velocity: [0.0, 0.0, 0.0]
            }
        }));

        this.EnemyCars = DDayEnemyCarSpecs.map((Spec, Index) =>
        {
            const WP0 = Spec.Waypoints[0];
            const WP1 = Spec.Waypoints[1];
            const Yaw = Math.atan2(WP1[1] - WP0[1], WP1[0] - WP0[0]);
            return {
                Index,
                Id:           Spec.Id,
                Name:         Spec.Name,
                Waypoints:    Spec.Waypoints,
                WpIndex:      1,
                Position:     [WP0[0], WP0[1], VehicleGeometry.CoMHeight + 0.02],
                Velocity:     [Math.cos(Yaw) * Spec.Speed, Math.sin(Yaw) * Spec.Speed, 0.0],
                Yaw,
                SteerAngle:   0.0,
                WheelSpin:    0.0,
                AngularVelZ:  0.0,
                CruiseSpeed:  Spec.Speed,
                Hp:           100.0,
                MaxHp:        100.0,
                Alive:        true,
                BurningTimer: 0.0,
                RespawnTimer: 0.0,
                CrashCooldown: 0.0,
                WreckRoll:    0.0
            };
        });

        this.Turrets = DDayTurretSpecs.map((Spec, Index) => ({
            Index,
            Id:             Spec.Id,
            Name:           Spec.Name,
            Position:       Spec.Position.slice(),
            LowNest:        Spec.LowNest,
            Yaw:            Math.PI, // Initially aimed West toward beachhead
            BurstLeft:      0,
            ShotCooldown:   0.2,
            BurstCooldown:  1.0 + Index * 0.45,
            SuppressedTimer: 0.0,
            MuzzleFlash:    0.0
        }));

        this.Cannons = DDayCannonSpecs.map((Spec, Index) => ({
            Index,
            Id:           Spec.Id,
            Name:         Spec.Name,
            Position:     Spec.Position.slice(),
            Range:        Spec.Range,
            BaseCooldown: Spec.Cooldown,
            Yaw:          Math.PI,
            Cooldown:     1.6 + Spec.Phase,
            Recoil:       0.0,
            MuzzleFlash:  0.0,
            SuppressedTimer: 0.0
        }));

        this.Bombers = [
            { Index: 0, Name: "He-111 Strike 1", CenterX: -12.0, CenterY:  -4.0, RadiusX: 146.0, RadiusY: 46.0,
              Altitude: 36.0, Angle: 0.35, Speed: 34.0, Position: [-12.0, 42.0, 36.0], Yaw: 0.0, Roll: 0.0,
              PropSpin: 0.0, BombInterval: 6.8, BombTimer: 2.2, StickRemaining: 0, StickTimer: 0.0 },
            { Index: 1, Name: "Ju-88 Strike 2",  CenterX:  18.0, CenterY:   6.0, RadiusX: 138.0, RadiusY: 52.0,
              Altitude: 41.0, Angle: 3.45, Speed: 37.0, Position: [18.0, -46.0, 41.0], Yaw: Math.PI, Roll: 0.0,
              PropSpin: 1.4, BombInterval: 7.4, BombTimer: 4.9, StickRemaining: 0, StickTimer: 0.0 }
        ];

        this.Mines = DDayMineCoords.map(([X, Y], Index) => ({
            Index,
            Position: [X, Y, 0.01],
            Armed:    true,
            PulsePhase: Index * 0.55
        }));

        this.Bombs = Array.from({ length: BombPoolSize }, () => ({
            Active: false, Position: ParkedPosition.slice(), Velocity: [0.0, 0.0, 0.0],
            ImpactPos: [0.0, 0.0, 0.0], FromPlayerStrike: false
        }));

        this.Shells = Array.from({ length: ShellPoolSize }, () => ({
            Active: false, Position: ParkedPosition.slice(), Velocity: [0.0, 0.0, 0.0],
            ImpactPos: [0.0, 0.0, 0.0], FromTank: false, Damage: 24.0
        }));

        this.Tracers = Array.from({ length: TracerPoolSize }, () => ({
            Active: false, Position: ParkedPosition.slice(), Velocity: [0.0, 0.0, 0.0],
            Life: 0.0, Damage: 4.5, Hostile: true
        }));

        this.Explosions = Array.from({ length: ExplosionPoolSize }, () => ({
            Active: false, Position: ParkedPosition.slice(), Age: 0.0, Duration: 0.9, MaxRadius: 4.8, Yaw: 0.0
        }));

        this.Craters = Array.from({ length: CraterPoolSize }, () => ({
            Active: false, Position: ParkedPosition.slice(), Yaw: 0.0, Scale: 1.0
        }));
        this.CraterCursor = 0;

        this.RegisterTankObstacles();
    }

    ResetAssault(RespawnPlayer = true)
    {
        this.MissionClock      = 0.0;
        this.PlayerHp          = this.PlayerMaxHp;
        this.PlayerInCover     = false;
        this.PlayerUnderAirCover = false;
        this.CoverSource       = "";
        this.LastHitTimer      = 0.0;
        this.WallReached       = false;
        this.BreachTime        = 0.0;
        this.CarsSmashed       = 0;
        this.TanksExploded     = 0;
        this.MinesTriggered    = 0;
        this.BombsDropped      = 0;
        this.TurretsSuppressed = 0;
        this.SpectatorTarget   = "player";

        this.InitializeEntities();

        if (RespawnPlayer && this.Host?.Vehicle)
        {
            this.Host.Vehicle.Respawn([DDaySpawn.Position[0], DDaySpawn.Position[1], 0.65], DDaySpawn.Yaw);
            this.Host.RestoreTyres?.();
            this.Host.AfterVehicleMoved?.();
        }
        this.SyncAllOccupants(true);
        this.RefreshControlStrip();
        this.Host?.Shell?.Announce("D-DAY ASSAULT RESET — BREACH THE ATLANTIC WALL!");
    }

    RegisterTankObstacles()
    {
        const Obstacles = this.Host?.Vehicle?.Obstacles;
        if (!Array.isArray(Obstacles))
            return;
        for (const Tank of this.Tanks)
        {
            if (!Obstacles.includes(Tank.ObstacleBox))
                Obstacles.push(Tank.ObstacleBox);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                             VIEWPORT TACTICAL QUICK-CONTROLS BAR
    //--------------------------------------------------------------------------------------------------------------------

    MountQuickControls()
    {
        if (typeof document === "undefined")
            return;
        const Stage = document.getElementById("stage");
        if (!Stage)
            return;

        let Strip = document.getElementById("dday-assault-controls");
        if (!Strip)
        {
            Strip = document.createElement("div");
            Strip.id = "dday-assault-controls";
            Strip.className = "pursuit-rl-controls";

            const MakeBtn = (Key, Label, Title, Handler) =>
            {
                const B = document.createElement("button");
                B.type = "button";
                B.className = "ar-hud-pill";
                B.dataset.ddayAction = Key;
                B.title = Title;
                B.textContent = Label;
                B.addEventListener("click", (E) => { E.stopPropagation(); Handler(); });
                Strip.appendChild(B);
                return B;
            };

            this.DomBtns = {
                airstrike: MakeBtn("airstrike", "✈️ AIR STRIKE",  "Call immediate overhead bombing run onto forward defenses", () => this.TriggerManualAirStrike()),
                cover:     MakeBtn("cover",     "🛡️ COVER HUD",   "Toggle tactical cover & threat brackets", () => { this.CoverOverlayOn = !this.CoverOverlayOn; this.RefreshControlStrip(); }),
                cam:       MakeBtn("cam",       "🎥 CAR VIEW",    "Spectate Player Car · Advancing Tank · Overhead Bomber", () => this.CycleSpectatorTarget()),
                intensity: MakeBtn("intensity", "💥 BLITZ 1.0×",  "Cycle combat intensity (Calm Recon · Standard Assault · Heavy Blitz)", () => this.CycleIntensity()),
                reset:     MakeBtn("reset",     "🔄 RESET D-DAY", "Reset beachhead assault, tanks, mines, turrets & wall objective", () => this.ResetAssault(true))
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
        const Hidden = !this.Active || Boolean(this.Host?.FreeCamera) ||
                       this.Host?.RoadEditor?.ActiveWorkspace === "roadstudio" || Boolean(this.Host?.Dock?.Clean);
        this.ControlStrip.classList.toggle("hidden", Hidden);
        this.DomBtns.cover.classList.toggle("active", this.CoverOverlayOn);
        this.DomBtns.cam.textContent = this.SpectatorTarget === "tank"   ? "🎥 TANK CAM" :
                                       this.SpectatorTarget === "bomber" ? "🎥 BOMBER CAM" : "🎥 CAR VIEW";
        this.DomBtns.cam.classList.toggle("active", this.SpectatorTarget !== "player");
        this.DomBtns.intensity.textContent = this.Intensity < 0.2 ? "💥 RECON 0×" :
                                             this.Intensity > 1.2 ? "💥 BLITZ 1.5×" : "💥 ASSAULT 1×";
        this.DomBtns.intensity.classList.toggle("warn", this.Intensity > 1.2);
    }

    CycleSpectatorTarget()
    {
        const Order = ["player", "tank", "bomber"];
        this.SpectatorTarget = Order[(Order.indexOf(this.SpectatorTarget) + 1) % Order.length];
        this.Host?.DrivingHud?.Audio?.PlayUiClick(1.08);
        this.RefreshControlStrip();
    }

    CycleIntensity()
    {
        this.Intensity = this.Intensity < 0.2 ? 1.0 : (this.Intensity < 1.2 ? 1.5 : 0.0);
        this.Host?.DrivingHud?.Audio?.PlayUiClick(1.05);
        this.RefreshControlStrip();
    }

    QuerySpectatorPose()
    {
        if (!this.Active || this.SpectatorTarget === "player")
            return null;
        if (this.SpectatorTarget === "tank")
        {
            const T = this.Tanks.find((Tk) => Tk.Alive) || this.Tanks[0];
            if (!T) return null;
            return {
                Position: [T.Position[0], T.Position[1], 1.2],
                Forward:  [Math.cos(T.Yaw), Math.sin(T.Yaw), 0.0],
                Speed:    Math.hypot(T.Velocity[0], T.Velocity[1])
            };
        }
        if (this.SpectatorTarget === "bomber")
        {
            const B = this.Bombers[0];
            if (!B) return null;
            const FX = Math.cos(B.Yaw), FY = Math.sin(B.Yaw);
            return {
                Eye:    [B.Position[0] - FX * 17.5, B.Position[1] - FY * 17.5, B.Position[2] + 5.0],
                Target: [B.Position[0] + FX * 28.0, B.Position[1] + FY * 28.0, Math.max(0.0, B.Position[2] - 11.0)],
                Up:     [0.0, 0.0, 1.0],
                Fov:    68.0
            };
        }
        return null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                 COVER & LINE-OF-SIGHT GEOMETRY QUERIES
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Checks if a 2D line of sight between Shooter and Target is blocked by ANY bunker, blast wall, shelter wall, or tank hull!
    CheckCoverOcclusion(FromPos, ToPos, IgnoreTankIndex = -1)
    {
        if (FromPos[2] > 20.0)
        {
            // Overhead bombing attacks are blocked ONLY by Drive-In Concrete Shelter roofs
            for (const Box of this.CoverBoxes)
            {
                if (!Box.AirRoof) continue;
                if (ToPos[0] >= Box.InteriorMinX && ToPos[0] <= Box.InteriorMaxX &&
                    ToPos[1] >= Box.InteriorMinY && ToPos[1] <= Box.InteriorMaxY)
                {
                    return { Blocked: true, Source: "DRIVE-IN SHELTER ROOF", HitPos: [ToPos[0], ToPos[1], 4.0] };
                }
            }
            return { Blocked: false, Source: "", HitPos: null };
        }

        // ① Check static concrete bunkers, blast walls, shelter walls & Atlantic Wall bastions
        for (const Box of this.CoverBoxes)
        {
            if (Box.AirRoof) continue;
            if (SegmentHitsBox2D(FromPos[0], FromPos[1], ToPos[0], ToPos[1], Box))
            {
                const MX = 0.5 * (Math.max(Box.MinX, Math.min(FromPos[0], ToPos[0])) + Math.min(Box.MaxX, Math.max(FromPos[0], ToPos[0])));
                const MY = 0.5 * (Math.max(Box.MinY, Math.min(FromPos[1], ToPos[1])) + Math.min(Box.MaxY, Math.max(FromPos[1], ToPos[1])));
                return { Blocked: true, Source: "BUNKER / BLAST WALL", HitPos: [MX, MY, 1.4] };
            }
        }

        // ② Check Allied Assault Tanks (both advancing tanks & smoking tank wrecks provide heavy armored cover!)
        for (const Tank of this.Tanks)
        {
            if (Tank.Index === IgnoreTankIndex)
                continue;
            // Tank must be close enough to shield the target cleanly (within 18 m or strictly between shooter & player)
            const DistTarget = Math.hypot(Tank.Position[0] - ToPos[0], Tank.Position[1] - ToPos[1]);
            if (DistTarget > 24.0)
                continue;
            const Box = {
                MinX: Tank.Position[0] - 3.25, MaxX: Tank.Position[0] + 3.25,
                MinY: Tank.Position[1] - 1.55, MaxY: Tank.Position[1] + 1.55
            };
            if (SegmentHitsBox2D(FromPos[0], FromPos[1], ToPos[0], ToPos[1], Box))
                return { Blocked: true, Source: Tank.Alive ? "TANK ARMOR" : "TANK WRECK", HitPos: [Tank.Position[0], Tank.Position[1], 1.35] };
        }

        return { Blocked: false, Source: "", HitPos: null };
    }

    UpdatePlayerCoverState(PlayerPos, Dt)
    {
        // Check overhead concrete bunker roof cover
        let AirSafe = false;
        for (const Box of this.CoverBoxes)
        {
            if (Box.AirRoof &&
                PlayerPos[0] >= Box.InteriorMinX && PlayerPos[0] <= Box.InteriorMaxX &&
                PlayerPos[1] >= Box.InteriorMinY && PlayerPos[1] <= Box.InteriorMaxY)
            {
                AirSafe = true;
                break;
            }
        }
        this.PlayerUnderAirCover = AirSafe;

        // Player is in tactical cover if inside a bunker shelter OR occluded from ALL nearby active MG turrets (<= 115 m)
        let NearestExposed = false;
        let ActiveInRange = 0;
        let BestShieldSource = AirSafe ? "DRIVE-IN BUNKER" : "";

        for (const Turret of this.Turrets)
        {
            if (Turret.SuppressedTimer > 0.0)
                continue;
            const D = Math.hypot(Turret.Position[0] - PlayerPos[0], Turret.Position[1] - PlayerPos[1]);
            if (D > 115.0)
                continue;
            ActiveInRange++;
            const Occ = this.CheckCoverOcclusion(Turret.Position, PlayerPos);
            if (!Occ.Blocked)
                NearestExposed = true;
            else if (!BestShieldSource)
                BestShieldSource = Occ.Source;
        }

        // Also check proximity behind any tank within 10 m even if no turret is close
        if (!BestShieldSource)
        {
            for (const Tank of this.Tanks)
            {
                const D = Math.hypot(Tank.Position[0] - PlayerPos[0], Tank.Position[1] - PlayerPos[1]);
                if (D < 11.5)
                {
                    BestShieldSource = Tank.Alive ? "TANK ARMOR" : "TANK WRECK";
                    break;
                }
            }
        }

        this.PlayerInCover = AirSafe || (!NearestExposed && (ActiveInRange > 0 || Boolean(BestShieldSource)));
        this.CoverSource   = this.PlayerInCover ? (BestShieldSource || "COVER SHIELD") : "";

        // Gradual field armor repair when tucked cleanly behind cover!
        if (this.PlayerInCover && this.PlayerHp > 0.0 && this.PlayerHp < 78.0)
            this.PlayerHp = Math.min(78.0, this.PlayerHp + 4.2 * Dt);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                          PROJECTILES & EXPLOSIONS
    //--------------------------------------------------------------------------------------------------------------------

    SpawnTracer(StartPos, TargetPos, Damage, Hostile = true)
    {
        const Slot = this.Tracers.find((T) => !T.Active);
        if (!Slot) return;
        const DX = TargetPos[0] - StartPos[0];
        const DY = TargetPos[1] - StartPos[1];
        const DZ = TargetPos[2] - StartPos[2];
        const Dist = Math.hypot(DX, DY, DZ) || 1.0;
        const Speed = Hostile ? 138.0 : 155.0;
        Slot.Active   = true;
        Slot.Position = StartPos.slice();
        Slot.Velocity = [(DX / Dist) * Speed, (DY / Dist) * Speed, (DZ / Dist) * Speed];
        Slot.Life     = Math.min(1.15, Dist / Speed + 0.05);
        Slot.Damage   = Damage;
        Slot.Hostile  = Hostile;
    }

    SpawnArtilleryShell(StartPos, TargetPos, FromTank = false, Damage = 26.0)
    {
        const Slot = this.Shells.find((S) => !S.Active);
        if (!Slot) return;
        const DX = TargetPos[0] - StartPos[0];
        const DY = TargetPos[1] - StartPos[1];
        const DZ = TargetPos[2] - StartPos[2];
        const HorizDist = Math.hypot(DX, DY);
        const Speed = FromTank ? 72.0 : 54.0;
        const FlightTime = Clamp(HorizDist / Speed, 0.35, 2.8);
        Slot.Active    = true;
        Slot.Position  = StartPos.slice();
        Slot.Velocity  = [DX / FlightTime, DY / FlightTime, (DZ + 0.5 * Gravity * FlightTime * FlightTime) / FlightTime];
        Slot.ImpactPos = [TargetPos[0], TargetPos[1], 0.04];
        Slot.FromTank  = FromTank;
        Slot.Damage    = Damage;
    }

    SpawnBomb(OriginPos, ForwardVel, FromPlayerStrike = false)
    {
        const Slot = this.Bombs.find((B) => !B.Active);
        if (!Slot) return null;
        Slot.Active   = true;
        Slot.Position = [OriginPos[0], OriginPos[1], OriginPos[2] - 1.1];
        Slot.Velocity = [ForwardVel[0] * 0.55, ForwardVel[1] * 0.55, -2.5];
        Slot.FromPlayerStrike = FromPlayerStrike;
        // Predict ground impact spot for tactical danger ring
        const H = Math.max(1.0, Slot.Position[2]);
        const Vz = Slot.Velocity[2];
        const TFall = (-Vz + Math.sqrt(Vz * Vz + 2.0 * Gravity * H)) / Gravity;
        Slot.ImpactPos = [Slot.Position[0] + Slot.Velocity[0] * TFall, Slot.Position[1] + Slot.Velocity[1] * TFall, 0.04];
        this.BombsDropped++;
        this.Host?.DrivingHud?.Audio?.PlayBombWhistle(this.Clock);
        return Slot;
    }

    TriggerManualAirStrike()
    {
        const PlayerPos = this.Host?.Vehicle?.Position || DDaySpawn.Position;
        const DropX = Clamp(PlayerPos[0] + 44.0, -110.0, 145.0);
        const DropY = Clamp(PlayerPos[1], -32.0, 32.0);
        // Move Bomber 0 quickly into an impressive low overhead pass or drop directly!
        for (let K = -1; K <= 1; ++K)
            this.SpawnBomb([DropX - 18.0 + K * 14.0, DropY + K * 6.0, 34.0], [34.0, 0.0, 0.0], true);
        this.Host?.Shell?.Announce("ALLIED AIR STRIKE INBOUND — STAND CLEAR!");
    }

    DetonateAt(Pos, Scale = 1.5, Banner = "", DamageFriendly = true)
    {
        const ExpSlot = this.Explosions.find((E) => !E.Active) || this.Explosions[0];
        ExpSlot.Active    = true;
        ExpSlot.Position  = [Pos[0], Pos[1], Math.max(0.2, Pos[2])];
        ExpSlot.Age       = 0.0;
        ExpSlot.Duration  = 0.72 + Scale * 0.22;
        ExpSlot.MaxRadius = 2.6 * Scale;
        ExpSlot.Yaw       = this.Rand() * Math.PI * 2.0;

        // Place persistent scorched blast crater
        const Crater = this.Craters[this.CraterCursor % this.Craters.length];
        this.CraterCursor = (this.CraterCursor + 1) % this.Craters.length;
        Crater.Active   = true;
        Crater.Position = [Pos[0], Pos[1], 0.01];
        Crater.Yaw      = this.Rand() * Math.PI * 2.0;
        Crater.Scale    = Clamp(0.75 + 0.35 * Scale, 0.75, 1.55);

        // Emit bright explosion sparks
        const Sparks = this.Host?.Sparks;
        if (Sparks?.EmitBurst)
            Sparks.EmitBurst([Pos[0], Pos[1], Math.max(0.45, Pos[2] + 0.3)], Math.round(42 * Scale), 16.0 + 5.0 * Scale, 2850.0);

        // Play audio explosion
        const PlayerPos = this.Host?.Vehicle?.Position || [0, 0, 0];
        const PlayerDist = Math.hypot(Pos[0] - PlayerPos[0], Pos[1] - PlayerPos[1]);
        this.Host?.DrivingHud?.Audio?.PlayExplosion(Clamp(Scale * 0.75, 0.6, 1.5), PlayerDist, this.Clock);

        // Apply blast shockwave & damage to Player Vehicle
        const BlastRadius = 7.5 * Scale;
        if (DamageFriendly && this.Host?.Vehicle && PlayerDist < BlastRadius)
        {
            const Occ = (Pos[2] > 1.8) ? this.CheckCoverOcclusion([Pos[0], Pos[1], 24.0], PlayerPos) : { Blocked: false };
            if (!Occ.Blocked)
            {
                const Falloff = 1.0 - PlayerDist / BlastRadius;
                const DX = PlayerPos[0] - Pos[0];
                const DY = PlayerPos[1] - Pos[1];
                const Horiz = Math.hypot(DX, DY) || 1.0;
                const ImpMag = 4600.0 * Scale * Falloff;
                this.Host.Vehicle.ApplyImpulse(
                    [PlayerPos[0], PlayerPos[1], PlayerPos[2] - 0.1],
                    [(DX / Horiz) * ImpMag, (DY / Horiz) * ImpMag, 3800.0 * Scale * Falloff]
                );
                const Dmg = Math.round(28.0 * Scale * Falloff);
                if (Dmg > 0)
                    this.DamagePlayer(Dmg, Banner || "BLAST SHOCKWAVE");
            }
        }

        // Apply damage to Allied Tanks (so bombs & shells visibly blow up tanks!)
        for (const Tank of this.Tanks)
        {
            if (!Tank.Alive) continue;
            const D = Math.hypot(Pos[0] - Tank.Position[0], Pos[1] - Tank.Position[1]);
            if (D < BlastRadius * 1.15)
            {
                const Falloff = 1.0 - D / (BlastRadius * 1.15);
                this.DamageTank(Tank, 62.0 * Scale * Falloff);
            }
        }

        // Apply damage to Enemy Military Patrol Cars
        for (const Car of this.EnemyCars)
        {
            if (!Car.Alive) continue;
            const D = Math.hypot(Pos[0] - Car.Position[0], Pos[1] - Car.Position[1]);
            if (D < BlastRadius * 1.1)
                this.DamageEnemyCar(Car, 75.0 * Scale * (1.0 - D / (BlastRadius * 1.1)));
        }

        // Suppress nearby enemy MG turrets & cannons on air strike / shell hit!
        for (const Turret of this.Turrets)
        {
            const D = Math.hypot(Pos[0] - Turret.Position[0], Pos[1] - Turret.Position[1]);
            if (D < BlastRadius * 1.1 && Turret.SuppressedTimer <= 0.0)
            {
                Turret.SuppressedTimer = 11.0;
                this.TurretsSuppressed++;
            }
        }
    }

    DamagePlayer(Amount, Label)
    {
        if (this.Intensity <= 0.01)
            return;
        this.PlayerHp = Math.max(0.0, this.PlayerHp - Amount * Clamp(this.Intensity, 0.4, 1.3));
        this.LastHitTimer = 1.1;
        this.LastHitLabel = Label;
        if (this.PlayerHp <= 0.0)
        {
            const P = this.Host?.Vehicle?.Position || DDaySpawn.Position;
            this.DetonateAt([P[0], P[1], 0.8], 1.8, "HULL DESTROYED", false);
            this.Host?.Shell?.Announce("VEHICLE DESTROYED — EMERGENCY LANDING REINFORCEMENT!");
            this.PlayerHp = this.PlayerMaxHp;
            if (this.Host?.Vehicle)
            {
                this.Host.Vehicle.Respawn([DDaySpawn.Position[0], DDaySpawn.Position[1], 0.65], DDaySpawn.Yaw);
                this.Host.RestoreTyres?.();
                this.Host.AfterVehicleMoved?.();
            }
        }
    }

    DamageTank(Tank, Amount)
    {
        if (!Tank.Alive) return;
        Tank.Hp -= Amount;
        if (Tank.Hp <= 0.0)
        {
            Tank.Hp = 0.0;
            Tank.Alive = false;
            Tank.Velocity = [0.0, 0.0, 0.0];
            Tank.BurningTimer = 15.0;
            Tank.RespawnTimer = 16.0;
            this.TanksExploded++;
            this.DetonateAt([Tank.Position[0], Tank.Position[1], 1.2], 2.1, `${Tank.Name} EXPLODED`, false);
            this.Host?.Shell?.Announce(`${Tank.Name} HIT & EXPLODED! TAKE COVER!`);
        }
    }

    DamageEnemyCar(Car, Amount)
    {
        if (!Car.Alive) return;
        Car.Hp -= Amount;
        if (Car.Hp <= 0.0)
        {
            Car.Hp = 0.0;
            Car.Alive = false;
            Car.BurningTimer = 12.0;
            Car.RespawnTimer = 13.0;
            Car.WreckRoll = (this.Rand() < 0.5 ? -1 : 1) * 0.28;
            this.CarsSmashed++;
            this.PlayerHp = Math.min(this.PlayerMaxHp, this.PlayerHp + 8.0);
            this.DetonateAt([Car.Position[0], Car.Position[1], 0.9], 1.5, `${Car.Name} WRECKED`, false);
            this.Host?.Shell?.Announce(`PATROL CAR SMASHED! (${this.CarsSmashed} WRECKED)`);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                       MAIN SIMULATION STEP
    //--------------------------------------------------------------------------------------------------------------------

    Advance(DeltaSeconds)
    {
        if (!this.Active)
            return false;

        const Dt = Clamp(Number(DeltaSeconds) || 0.0, 0.0, 0.05);
        if (Dt <= 0.0)
            return false;

        this.Clock        += Dt;
        this.MissionClock += Dt;
        this.LastHitTimer  = Math.max(0.0, this.LastHitTimer - Dt);

        const Vehicle = this.Host?.Vehicle;
        const PlayerPos = Vehicle?.Position || DDaySpawn.Position;
        this.DistanceToWall = Math.max(0.0, DDayWallReachX - PlayerPos[0]);

        // Ensure dynamic tank obstacle boxes stay inside Vehicle.Obstacles (even after fracture re-assignments)
        this.RegisterTankObstacles();

        // ① Check Cover (static bunkers/walls, tanks, overhead drive-in shelters)
        this.UpdatePlayerCoverState(PlayerPos, Dt);

        // ② Advance Allied Tanks toward the Atlantic Wall
        this.AdvanceTanks(Dt);

        // ③ Advance Enemy Military Patrol Cars & resolve car-vs-car crashes!
        this.AdvanceEnemyCars(Dt, PlayerPos, Vehicle);

        // ④ Advance Bunker MG Turrets & Heavy Coastal Cannons
        this.AdvanceTurretsAndCannons(Dt, PlayerPos);

        // ⑤ Advance Twin-Engine Bombers & Falling Bombs
        this.AdvanceBombersAndBombs(Dt, PlayerPos);

        // ⑥ Advance Artillery Shells, Tracers, Landmines & Explosion Domes
        this.AdvanceProjectilesMinesAndBlasts(Dt, PlayerPos, Vehicle);

        // ⑦ Check Atlantic Wall Breach Objective
        if (!this.WallReached && PlayerPos[0] >= DDayWallReachX && Math.abs(PlayerPos[1]) <= 36.0)
        {
            this.WallReached = true;
            this.BreachTime  = this.MissionClock;
            this.Host?.DrivingHud?.Audio?.PlayBreachVictory(this.Clock);
            this.Host?.Sparks?.EmitBurst([PlayerPos[0] + 4.0, PlayerPos[1], 2.2], 80, 22.0, 2900.0);
            this.Host?.Shell?.Announce(`ATLANTIC WALL BREACHED IN ${this.BreachTime.toFixed(1)}s!`);
        }

        this.SyncAllOccupants(false);
        return true;
    }

    AdvanceTanks(Dt)
    {
        for (const Tank of this.Tanks)
        {
            if (Tank.Recoil > 0.0)
                Tank.Recoil = Math.max(0.0, Tank.Recoil - Dt * 1.4);

            if (!Tank.Alive)
            {
                Tank.BurningTimer = Math.max(0.0, Tank.BurningTimer - Dt);
                Tank.RespawnTimer -= Dt;
                if (Tank.RespawnTimer <= 0.0)
                {
                    // Fresh reinforcement landing tank rolls ashore from West surf!
                    Tank.Position     = [-146.0, Tank.LaneY, 0.0];
                    Tank.Yaw          = 0.0;
                    Tank.TurretYaw    = 0.0;
                    Tank.Hp           = Tank.MaxHp;
                    Tank.Alive        = true;
                    Tank.BurningTimer = 0.0;
                }
            }
            else
            {
                const DistToGoal = Tank.GoalX - Tank.Position[0];
                if (DistToGoal > 1.5)
                {
                    // Gentle tactical weaving around static bunkers/cover walls along lane
                    let SteerY = (Tank.LaneY - Tank.Position[1]) * 0.25;
                    for (const Box of this.CoverBoxes)
                    {
                        if (Box.AirRoof) continue;
                        const AheadX = Tank.Position[0] + 6.5;
                        if (AheadX >= Box.MinX - 2.0 && Tank.Position[0] <= Box.MaxX + 2.0 &&
                            Tank.Position[1] >= Box.MinY - 2.2 && Tank.Position[1] <= Box.MaxY + 2.2)
                        {
                            const MidY = 0.5 * (Box.MinY + Box.MaxY);
                            SteerY += (Tank.Position[1] >= MidY ? 1.0 : -1.0) * 3.8;
                        }
                    }
                    const TargetYaw = Clamp(Math.atan2(SteerY, Tank.CruiseSpeed), -0.45, 0.45);
                    Tank.Yaw += WrapAngle(TargetYaw - Tank.Yaw) * Math.min(1.0, Dt * 2.5);
                    const Spd = Tank.CruiseSpeed;
                    Tank.Velocity[0] = Math.cos(Tank.Yaw) * Spd;
                    Tank.Velocity[1] = Math.sin(Tank.Yaw) * Spd;
                    Tank.Position[0] += Tank.Velocity[0] * Dt;
                    Tank.Position[1] = Clamp(Tank.Position[1] + Tank.Velocity[1] * Dt, -46.0, 46.0);
                }
                else
                {
                    Tank.Velocity[0] = 0.0;
                    Tank.Velocity[1] = 0.0;
                }

                // Tank turret aims at active enemy turret/cannon & suppresses defenses!
                const Target = this.Turrets.find((Tu) => Tu.SuppressedTimer <= 0.0 && Math.abs(Tu.Position[0] - Tank.Position[0]) < 125.0)
                            || this.Cannons[0];
                if (Target)
                {
                    const AimYaw = Math.atan2(Target.Position[1] - Tank.Position[1], Target.Position[0] - Tank.Position[0]);
                    Tank.TurretYaw += WrapAngle(AimYaw - Tank.TurretYaw) * Math.min(1.0, Dt * 2.6);
                    Tank.FireCooldown -= Dt;
                    if (Tank.FireCooldown <= 0.0 && this.Intensity > 0.01)
                    {
                        Tank.FireCooldown = 3.4 + this.Rand() * 2.0;
                        Tank.Recoil = 0.65;
                        const Muzzle = [
                            Tank.Position[0] + Math.cos(Tank.TurretYaw) * 3.6,
                            Tank.Position[1] + Math.sin(Tank.TurretYaw) * 3.6,
                            2.1
                        ];
                        this.SpawnArtilleryShell(Muzzle, Target.Position, true, 40.0);
                        const PlayerPos = this.Host?.Vehicle?.Position || [0, 0, 0];
                        this.Host?.DrivingHud?.Audio?.PlayCannonFire(Math.hypot(Muzzle[0] - PlayerPos[0], Muzzle[1] - PlayerPos[1]), this.Clock);
                    }
                }
            }

            // Sync tank dynamic obstacle box
            Tank.ObstacleBox.Minimum[0] = Tank.Position[0] - 3.25;
            Tank.ObstacleBox.Minimum[1] = Tank.Position[1] - 1.55;
            Tank.ObstacleBox.Minimum[2] = 0.0;
            Tank.ObstacleBox.Maximum[0] = Tank.Position[0] + 3.25;
            Tank.ObstacleBox.Maximum[1] = Tank.Position[1] + 1.55;
            Tank.ObstacleBox.Maximum[2] = 2.65;
            Tank.ObstacleBox.Velocity[0] = Tank.Velocity[0];
            Tank.ObstacleBox.Velocity[1] = Tank.Velocity[1];
        }
    }

    AdvanceEnemyCars(Dt, PlayerPos, PlayerVehicle)
    {
        for (const Car of this.EnemyCars)
        {
            Car.CrashCooldown = Math.max(0.0, Car.CrashCooldown - Dt);
            if (!Car.Alive)
            {
                Car.BurningTimer = Math.max(0.0, Car.BurningTimer - Dt);
                Car.RespawnTimer -= Dt;
                // Wreck slides smoothly to a halt
                Car.Position[0] += Car.Velocity[0] * Dt;
                Car.Position[1] += Car.Velocity[1] * Dt;
                Car.Yaw         += Car.AngularVelZ * Dt;
                Car.Velocity[0] *= Math.exp(-3.5 * Dt);
                Car.Velocity[1] *= Math.exp(-3.5 * Dt);
                Car.AngularVelZ *= Math.exp(-4.0 * Dt);

                if (Car.RespawnTimer <= 0.0)
                {
                    const WP = Car.Waypoints[0];
                    Car.Position = [126.0, WP[1], VehicleGeometry.CoMHeight + 0.02];
                    Car.Yaw      = Math.PI;
                    Car.Hp       = Car.MaxHp;
                    Car.Alive    = true;
                    Car.WreckRoll = 0.0;
                    Car.BurningTimer = 0.0;
                }
                continue;
            }

            // Patrol / intercept steering: pursue player if nearby (< 40 m), else follow patrol loop!
            const DistPlayer = Math.hypot(PlayerPos[0] - Car.Position[0], PlayerPos[1] - Car.Position[1]);
            let TargetX, TargetY;
            if (DistPlayer < 38.0 && this.Intensity > 0.01)
            {
                TargetX = PlayerPos[0];
                TargetY = PlayerPos[1];
            }
            else
            {
                const WP = Car.Waypoints[Car.WpIndex];
                if (Math.hypot(WP[0] - Car.Position[0], WP[1] - Car.Position[1]) < 6.5)
                    Car.WpIndex = (Car.WpIndex + 1) % Car.Waypoints.length;
                TargetX = Car.Waypoints[Car.WpIndex][0];
                TargetY = Car.Waypoints[Car.WpIndex][1];
            }

            // Static bunker avoidance steering force
            let DesiredYaw = Math.atan2(TargetY - Car.Position[1], TargetX - Car.Position[0]);
            for (const Box of this.CoverBoxes)
            {
                if (Box.AirRoof) continue;
                const CX = 0.5 * (Box.MinX + Box.MaxX);
                const CY = 0.5 * (Box.MinY + Box.MaxY);
                const DX = Car.Position[0] - CX;
                const DY = Car.Position[1] - CY;
                const R  = 0.5 * Math.hypot(Box.MaxX - Box.MinX, Box.MaxY - Box.MinY) + 4.5;
                const D  = Math.hypot(DX, DY);
                if (D < R && D > 0.05)
                {
                    const Away = Math.atan2(DY, DX);
                    DesiredYaw += WrapAngle(Away - DesiredYaw) * ((R - D) / R) * 0.85;
                }
            }

            const YawErr = WrapAngle(DesiredYaw - Car.Yaw);
            Car.SteerAngle = Clamp(YawErr, -0.52, 0.52);
            const Spd = Math.hypot(Car.Velocity[0], Car.Velocity[1]);
            const TargetSpeed = DistPlayer < 38.0 ? Car.CruiseSpeed * 1.15 : Car.CruiseSpeed;
            const NewSpeed = Spd + (TargetSpeed - Spd) * Math.min(1.0, Dt * 2.8);
            Car.Yaw = WrapAngle(Car.Yaw + (Car.SteerAngle * 2.35 + Car.AngularVelZ) * Dt);
            Car.AngularVelZ *= Math.exp(-3.6 * Dt);
            Car.Velocity[0] = Math.cos(Car.Yaw) * NewSpeed;
            Car.Velocity[1] = Math.sin(Car.Yaw) * NewSpeed;
            Car.Position[0] = Clamp(Car.Position[0] + Car.Velocity[0] * Dt, -148.0, 134.0);
            Car.Position[1] = Clamp(Car.Position[1] + Car.Velocity[1] * Dt, -54.0, 54.0);
            Car.WheelSpin += (NewSpeed / VehicleGeometry.TyreRadius) * Dt;

            // Player vs Enemy Military Car Crash Collision!
            if (PlayerVehicle)
                this.ResolveCarCrash(PlayerVehicle, Car);
        }
    }

    // 📝 Resolves physical car-to-car collision impulse, sparks, crash audio & high-speed ramming damage!
    ResolveCarCrash(PlayerVehicle, EnemyCar)
    {
        const PPos = PlayerVehicle.Position;
        const DX = EnemyCar.Position[0] - PPos[0];
        const DY = EnemyCar.Position[1] - PPos[1];
        const Dist = Math.hypot(DX, DY);
        const MinSep = 3.25; // effective vehicle bounding collision radius sum
        if (Dist >= MinSep || Dist < 1.0e-4)
            return false;

        const NX = DX / Dist;
        const NY = DY / Dist;
        const Overlap = MinSep - Dist;

        // Separate cars cleanly along collision normal
        EnemyCar.Position[0] += NX * Overlap * 0.65;
        EnemyCar.Position[1] += NY * Overlap * 0.65;

        const PVel = PlayerVehicle.LinearVelocity || [0, 0, 0];
        const RelVX = PVel[0] - EnemyCar.Velocity[0];
        const RelVY = PVel[1] - EnemyCar.Velocity[1];
        const ClosingSpeed = RelVX * NX + RelVY * NY;

        if (ClosingSpeed > 0.0 && EnemyCar.CrashCooldown <= 0.0)
        {
            EnemyCar.CrashCooldown = 0.22;
            const ContactPt = [0.5 * (PPos[0] + EnemyCar.Position[0]), 0.5 * (PPos[1] + EnemyCar.Position[1]), 0.65];

            // Momentum transfer: kick enemy car forward + spin yaw, push back gently on heavy player chassis
            const Knock = Math.max(4.5, ClosingSpeed * 1.15);
            EnemyCar.Velocity[0] += NX * Knock;
            EnemyCar.Velocity[1] += NY * Knock;
            const CrossSpin = (NX * EnemyCar.Velocity[1] - NY * EnemyCar.Velocity[0]);
            EnemyCar.AngularVelZ += Clamp(CrossSpin * 0.35 + (this.Rand() - 0.5) * 3.0, -5.5, 5.5);

            if (typeof PlayerVehicle.ApplyImpulse === "function")
            {
                const RecoilMag = -Math.min(7200.0, 420.0 * ClosingSpeed);
                PlayerVehicle.ApplyImpulse(ContactPt, [NX * RecoilMag, NY * RecoilMag, 250.0]);
            }

            this.Host?.Sparks?.EmitBurst(ContactPt, Math.round(Clamp(20 + ClosingSpeed * 2.8, 20, 72)), 14.0, 2600.0);
            this.Host?.DrivingHud?.Audio?.PlayCarCrash(ClosingSpeed, this.Clock);

            // High-speed ramming wrecks enemy patrol cars while absorbing minor scratch damage
            const EnemyDmg = Math.max(22.0, ClosingSpeed * 4.6);
            this.DamageEnemyCar(EnemyCar, EnemyDmg);
            const SelfDmg = Clamp(ClosingSpeed * 0.45, 2.0, 12.0);
            this.DamagePlayer(SelfDmg, "VEHICLE COLLISION");
            return true;
        }
        return false;
    }

    AdvanceTurretsAndCannons(Dt, PlayerPos)
    {
        const IntensityScale = this.Intensity;
        // ① Machine Gun Turrets
        for (const Turret of this.Turrets)
        {
            Turret.MuzzleFlash = Math.max(0.0, Turret.MuzzleFlash - Dt * 8.0);
            if (Turret.SuppressedTimer > 0.0)
            {
                Turret.SuppressedTimer = Math.max(0.0, Turret.SuppressedTimer - Dt);
                continue;
            }

            // Low trench nests can be rammed & crushed by player vehicle or tanks!
            if (Turret.LowNest)
            {
                const DCar = Math.hypot(PlayerPos[0] - Turret.Position[0], PlayerPos[1] - Turret.Position[1]);
                if (DCar < 2.8)
                {
                    Turret.SuppressedTimer = 14.0;
                    this.TurretsSuppressed++;
                    this.DetonateAt([Turret.Position[0], Turret.Position[1], 0.5], 0.95, "MG NEST CRUSHED", false);
                    continue;
                }
            }

            // Choose nearest unoccluded target (Player or Advancing Tank within 115 m)
            let Target = null;
            let BestDist = 115.0;
            const Candidates = [{ Pos: PlayerPos, Tank: null }];
            for (const Tank of this.Tanks)
            {
                if (Tank.Alive)
                    Candidates.push({ Pos: Tank.Position, Tank });
            }
            for (const C of Candidates)
            {
                const D = Math.hypot(C.Pos[0] - Turret.Position[0], C.Pos[1] - Turret.Position[1]);
                if (D < BestDist)
                {
                    const Occ = this.CheckCoverOcclusion(Turret.Position, C.Pos, C.Tank ? C.Tank.Index : -1);
                    if (!Occ.Blocked)
                    {
                        BestDist = D;
                        Target = C;
                    }
                }
            }

            // Rotate smoothly toward player even if occluded so turrets track menacingly, or track unoccluded target
            const TrackPos = Target ? Target.Pos : PlayerPos;
            const DesiredYaw = Math.atan2(TrackPos[1] - Turret.Position[1], TrackPos[0] - Turret.Position[0]);
            Turret.Yaw += WrapAngle(DesiredYaw - Turret.Yaw) * Math.min(1.0, Dt * 4.2);

            if (IntensityScale <= 0.01 || !Target)
                continue;

            Turret.BurstCooldown -= Dt * IntensityScale;
            if (Turret.BurstLeft <= 0 && Turret.BurstCooldown <= 0.0)
            {
                Turret.BurstLeft = 5;
                Turret.BurstCooldown = 1.65 + this.Rand() * 0.9;
            }
            if (Turret.BurstLeft > 0)
            {
                Turret.ShotCooldown -= Dt;
                if (Turret.ShotCooldown <= 0.0)
                {
                    Turret.ShotCooldown = 0.095;
                    Turret.BurstLeft--;
                    Turret.MuzzleFlash = 1.0;
                    const Muzzle = [
                        Turret.Position[0] + Math.cos(Turret.Yaw) * 2.1,
                        Turret.Position[1] + Math.sin(Turret.Yaw) * 2.1,
                        Turret.Position[2] + 0.42
                    ];
                    const Spread = [(this.Rand() - 0.5) * 1.4, (this.Rand() - 0.5) * 1.4, (this.Rand() - 0.5) * 0.4];
                    this.SpawnTracer(Muzzle, [Target.Pos[0] + Spread[0], Target.Pos[1] + Spread[1], 0.8 + Spread[2]], 3.5, true);
                    const PDist = Math.hypot(Muzzle[0] - PlayerPos[0], Muzzle[1] - PlayerPos[1]);
                    this.Host?.DrivingHud?.Audio?.PlayMachineGunShot(PDist, this.Clock);
                }
            }
        }

        // ② Heavy Coastal Artillery Cannons
        for (const Cannon of this.Cannons)
        {
            Cannon.Recoil = Math.max(0.0, Cannon.Recoil - Dt * 1.6);
            Cannon.MuzzleFlash = Math.max(0.0, Cannon.MuzzleFlash - Dt * 5.0);
            if (Cannon.SuppressedTimer > 0.0)
            {
                Cannon.SuppressedTimer = Math.max(0.0, Cannon.SuppressedTimer - Dt);
                continue;
            }

            // Pick target: alternating between advancing Allied Tanks and Player!
            let TargetPos = PlayerPos;
            const LiveTanks = this.Tanks.filter((T) => T.Alive);
            if (LiveTanks.length > 0 && ((Math.floor(this.Clock * 0.35) + Cannon.Index) % 2 === 0))
            {
                const Tk = LiveTanks[Cannon.Index % LiveTanks.length];
                TargetPos = Tk.Position;
            }

            const Dist = Math.hypot(TargetPos[0] - Cannon.Position[0], TargetPos[1] - Cannon.Position[1]);
            const AimYaw = Math.atan2(TargetPos[1] - Cannon.Position[1], TargetPos[0] - Cannon.Position[0]);
            Cannon.Yaw += WrapAngle(AimYaw - Cannon.Yaw) * Math.min(1.0, Dt * 2.2);

            if (IntensityScale <= 0.01 || Dist > Cannon.Range)
                continue;

            Cannon.Cooldown -= Dt * IntensityScale;
            if (Cannon.Cooldown <= 0.0)
            {
                Cannon.Cooldown = Cannon.BaseCooldown + this.Rand() * 1.6;
                Cannon.Recoil = 0.85;
                Cannon.MuzzleFlash = 1.0;
                const Muzzle = [
                    Cannon.Position[0] + Math.cos(Cannon.Yaw) * 5.6,
                    Cannon.Position[1] + Math.sin(Cannon.Yaw) * 5.6,
                    Cannon.Position[2] + 1.35
                ];
                const AimJitter = [(this.Rand() - 0.5) * 6.5, (this.Rand() - 0.5) * 6.5, 0.25];
                this.SpawnArtilleryShell(Muzzle, [TargetPos[0] + AimJitter[0], TargetPos[1] + AimJitter[1], 0.25], false, 26.0);
                const PDist = Math.hypot(Muzzle[0] - PlayerPos[0], Muzzle[1] - PlayerPos[1]);
                this.Host?.DrivingHud?.Audio?.PlayCannonFire(PDist, this.Clock);
            }
        }
    }

    AdvanceBombersAndBombs(Dt, PlayerPos)
    {
        for (const B of this.Bombers)
        {
            const Omega = B.Speed / Math.max(40.0, 0.5 * (B.RadiusX + B.RadiusY));
            B.Angle += Omega * Dt;
            const PrevX = B.Position[0];
            const PrevY = B.Position[1];
            const NextX = B.CenterX + Math.cos(B.Angle) * B.RadiusX;
            const NextY = B.CenterY + Math.sin(B.Angle) * B.RadiusY;
            const VX = (NextX - PrevX) / Math.max(1e-4, Dt);
            const VY = (NextY - PrevY) / Math.max(1e-4, Dt);
            B.Position[0] = NextX;
            B.Position[1] = NextY;
            B.Position[2] = B.Altitude + Math.sin(this.Clock * 0.7 + B.Index) * 1.6;
            const NextYaw = Math.atan2(VY, VX);
            const YawRate = WrapAngle(NextYaw - B.Yaw) / Math.max(1e-4, Dt);
            B.Yaw  = NextYaw;
            B.Roll = Clamp(YawRate * 0.55, -0.45, 0.45);
            B.PropSpin += 38.0 * Dt;

            if (this.Intensity <= 0.01)
                continue;

            B.BombTimer -= Dt * this.Intensity;
            if (B.BombTimer <= 0.0 && Math.abs(B.Position[0]) < 125.0)
            {
                B.BombTimer = B.BombInterval + this.Rand() * 2.5;
                B.StickRemaining = 3;
                B.StickTimer = 0.0;
            }
            if (B.StickRemaining > 0)
            {
                B.StickTimer -= Dt;
                if (B.StickTimer <= 0.0)
                {
                    B.StickTimer = 0.28;
                    B.StickRemaining--;
                    this.SpawnBomb(B.Position, [VX, VY, 0.0], false);
                }
            }
        }

        for (const Bomb of this.Bombs)
        {
            if (!Bomb.Active)
                continue;
            Bomb.Velocity[2] -= Gravity * Dt;
            Bomb.Position[0] += Bomb.Velocity[0] * Dt;
            Bomb.Position[1] += Bomb.Velocity[1] * Dt;
            Bomb.Position[2] += Bomb.Velocity[2] * Dt;

            // Check impact against Drive-In Shelter concrete roofs OR ground plane!
            let HitShelterRoof = false;
            if (Bomb.Position[2] <= 5.0 && Bomb.Position[2] >= 3.2)
            {
                for (const Box of this.CoverBoxes)
                {
                    if (Box.AirRoof &&
                        Bomb.Position[0] >= Box.MinX && Bomb.Position[0] <= Box.MaxX &&
                        Bomb.Position[1] >= Box.MinY && Bomb.Position[1] <= Box.MaxY)
                    {
                        HitShelterRoof = true;
                        break;
                    }
                }
            }

            if (HitShelterRoof || Bomb.Position[2] <= 0.32)
            {
                const DetZ = HitShelterRoof ? 4.95 : 0.35;
                this.DetonateAt([Bomb.Position[0], Bomb.Position[1], DetZ], 1.75, "AERIAL BOMB BLAST", !HitShelterRoof);
                Bomb.Active = false;
            }
        }
    }

    AdvanceProjectilesMinesAndBlasts(Dt, PlayerPos, PlayerVehicle)
    {
        // ① Artillery Shells
        for (const Shell of this.Shells)
        {
            if (!Shell.Active)
                continue;
            Shell.Velocity[2] -= Gravity * Dt;
            Shell.Position[0] += Shell.Velocity[0] * Dt;
            Shell.Position[1] += Shell.Velocity[1] * Dt;
            Shell.Position[2] += Shell.Velocity[2] * Dt;

            if (Shell.Position[2] <= 0.32)
            {
                this.DetonateAt([Shell.Position[0], Shell.Position[1], 0.35], Shell.FromTank ? 1.2 : 1.45,
                                Shell.FromTank ? "" : "COASTAL ARTILLERY HIT", !Shell.FromTank);
                Shell.Active = false;
            }
        }

        // ② High-speed Tracer Bolts (respect Cover LOS!)
        for (const Tr of this.Tracers)
        {
            if (!Tr.Active)
                continue;
            const Prev = Tr.Position.slice();
            Tr.Position[0] += Tr.Velocity[0] * Dt;
            Tr.Position[1] += Tr.Velocity[1] * Dt;
            Tr.Position[2] += Tr.Velocity[2] * Dt;
            Tr.Life -= Dt;

            // Check if tracer hits a bunker, blast wall, shelter, or tank hull!
            const Occ = this.CheckCoverOcclusion(Prev, Tr.Position);
            if (Occ.Blocked)
            {
                this.Host?.Sparks?.EmitBurst(Occ.HitPos || Tr.Position, 6, 8.0, 2300.0);
                Tr.Active = false;
                continue;
            }

            // Check hit on Player Car
            if (Tr.Hostile && Math.hypot(Tr.Position[0] - PlayerPos[0], Tr.Position[1] - PlayerPos[1]) < 2.1 && Tr.Position[2] < 2.2)
            {
                this.Host?.Sparks?.EmitBurst(Tr.Position, 7, 9.0, 2400.0);
                this.DamagePlayer(Tr.Damage, "MG TURRET FIRE");
                Tr.Active = false;
                continue;
            }

            // Check hit on Allied Tank
            for (const Tank of this.Tanks)
            {
                if (!Tank.Alive) continue;
                if (Math.hypot(Tr.Position[0] - Tank.Position[0], Tr.Position[1] - Tank.Position[1]) < 2.6)
                {
                    this.Host?.Sparks?.EmitBurst(Tr.Position, 6, 8.0, 2400.0);
                    this.DamageTank(Tank, Tr.Damage * 0.9);
                    Tr.Active = false;
                    break;
                }
            }

            if (Tr.Life <= 0.0 || Tr.Position[2] <= 0.05)
                Tr.Active = false;
        }

        // ③ Proximity Landmines
        for (const Mine of this.Mines)
        {
            if (!Mine.Armed)
                continue;

            let TriggeredBy = null;
            const PlayerDist = Math.hypot(PlayerPos[0] - Mine.Position[0], PlayerPos[1] - Mine.Position[1]);
            if (PlayerDist < 2.15 && PlayerPos[2] < 2.0)
                TriggeredBy = "player";

            if (!TriggeredBy)
            {
                for (const Tank of this.Tanks)
                {
                    if (Tank.Alive && Math.hypot(Tank.Position[0] - Mine.Position[0], Tank.Position[1] - Mine.Position[1]) < 2.55)
                    {
                        TriggeredBy = Tank;
                        break;
                    }
                }
            }
            if (!TriggeredBy)
            {
                for (const Car of this.EnemyCars)
                {
                    if (Car.Alive && Math.hypot(Car.Position[0] - Mine.Position[0], Car.Position[1] - Mine.Position[1]) < 2.1)
                    {
                        TriggeredBy = Car;
                        break;
                    }
                }
            }

            if (TriggeredBy)
            {
                Mine.Armed = false;
                this.MinesTriggered++;
                if (TriggeredBy === "player" && PlayerVehicle?.ApplyImpulse)
                    PlayerVehicle.ApplyImpulse([PlayerPos[0], PlayerPos[1], PlayerPos[2] - 0.15], [0.0, 0.0, 7400.0]);
                this.DetonateAt([Mine.Position[0], Mine.Position[1], 0.4], 1.45, "LANDMINE DETONATION", true);
            }
        }

        // ④ Explosion Fireball Domes
        for (const Exp of this.Explosions)
        {
            if (!Exp.Active) continue;
            Exp.Age += Dt;
            if (Exp.Age >= Exp.Duration)
                Exp.Active = false;
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                       GPU OCCUPANT SYNCHRONIZATION, SMOKE PLUMES & DYNAMIC LIGHTS
    //--------------------------------------------------------------------------------------------------------------------

    AssignTransform(OccIdx, Pos, Quat = IdentityQuat, Scale = [1.0, 1.0, 1.0])
    {
        if (OccIdx === undefined || OccIdx < 0 || !this.Scene?.Occupants?.[OccIdx])
            return;
        const M = ConstructRigidTransform(Pos, Quat, Scale);
        this.Scene.AssignOccupantTransform(OccIdx, M);
    }

    SyncAllOccupants(Snap = false)
    {
        const Block = this.Scene?.DDayBlock;
        if (!Block)
            return;

        // ① Allied Tanks (Hull + Rotating Turret + Recoiling Cannon Barrel)
        for (let I = 0; I < this.Tanks.length; ++I)
        {
            const T = this.Tanks[I];
            const HullQ = ConstructAxisQuaternion([0.0, 0.0, 1.0], T.Yaw);
            const WreckTilt = T.Alive ? IdentityQuat : ConstructAxisQuaternion([1.0, 0.0, 0.0], 0.16);
            const BodyQ = MultiplyQuaternion(HullQ, WreckTilt);
            this.AssignTransform(Block.TankHulls[I], T.Position, BodyQ);

            const TurretQ = ConstructAxisQuaternion([0.0, 0.0, 1.0], T.TurretYaw);
            const TurretPos = [T.Position[0], T.Position[1], T.Position[2] + (T.Alive ? 1.76 : 1.70)];
            this.AssignTransform(Block.TankTurrets[I], TurretPos, MultiplyQuaternion(TurretQ, WreckTilt));

            const BarrelBack = T.Recoil * 0.45;
            const BPos = [
                TurretPos[0] + Math.cos(T.TurretYaw) * (1.22 - BarrelBack),
                TurretPos[1] + Math.sin(T.TurretYaw) * (1.22 - BarrelBack),
                TurretPos[2] + 0.56
            ];
            this.AssignTransform(Block.TankBarrels[I], BPos, TurretQ);
        }

        // ② Enemy Military Patrol Cars (Body + 4 Wheels at exact authored AxleMount sockets)
        const WheelLocal = [0, 1, 2, 3].map((W) => ResolveAxleMountLocal(W));
        for (let I = 0; I < this.EnemyCars.length; ++I)
        {
            const C = this.EnemyCars[I];
            const BodyYawQ = ConstructAxisQuaternion([0.0, 0.0, 1.0], C.Yaw);
            const RollQ = ConstructAxisQuaternion([1.0, 0.0, 0.0], C.WreckRoll);
            const CarQ = MultiplyQuaternion(BodyYawQ, RollQ);
            this.AssignTransform(Block.EnemyCarBodies[I], C.Position, CarQ);

            for (let W = 0; W < 4; ++W)
            {
                const Steer = W < 2 ? C.SteerAngle : 0.0;
                const SteerQ = ConstructAxisQuaternion([0.0, 0.0, 1.0], C.Yaw + Steer);
                const SpinQ  = ConstructAxisQuaternion([0.0, 1.0, 0.0], C.WheelSpin);
                const WPos   = RotateVector(CarQ, WheelLocal[W]);
                this.AssignTransform(
                    Block.EnemyCarWheels[I * 4 + W],
                    [C.Position[0] + WPos[0], C.Position[1] + WPos[1], C.Position[2] + WPos[2]],
                    MultiplyQuaternion(SteerQ, SpinQ)
                );
            }
        }

        // ③ Machine Gun Turrets & Coastal Artillery Cannons
        for (let I = 0; I < this.Turrets.length; ++I)
        {
            const Tu = this.Turrets[I];
            const Q = ConstructAxisQuaternion([0.0, 0.0, 1.0], Tu.Yaw);
            this.AssignTransform(Block.Turrets[I], Tu.Position, Q);
        }
        for (let I = 0; I < this.Cannons.length; ++I)
        {
            const Ca = this.Cannons[I];
            const Q = ConstructAxisQuaternion([0.0, 0.0, 1.0], Ca.Yaw);
            const Kick = Ca.Recoil * 0.55;
            this.AssignTransform(Block.Cannons[I], [
                Ca.Position[0] - Math.cos(Ca.Yaw) * Kick,
                Ca.Position[1] - Math.sin(Ca.Yaw) * Kick,
                Ca.Position[2]
            ], Q);
        }

        // ④ Twin-Engine Bombers + 4 Spinning Propellers
        for (let I = 0; I < this.Bombers.length; ++I)
        {
            const B = this.Bombers[I];
            const YawQ  = ConstructAxisQuaternion([0.0, 0.0, 1.0], B.Yaw);
            const RollQ = ConstructAxisQuaternion([1.0, 0.0, 0.0], B.Roll);
            const BQ = MultiplyQuaternion(YawQ, RollQ);
            this.AssignTransform(Block.BomberBodies[I], B.Position, BQ);

            const SpinQ = ConstructAxisQuaternion([1.0, 0.0, 0.0], B.PropSpin);
            const PropOffsets = [[2.62, -2.95, 0.56], [2.62, 2.95, 0.56]];
            for (let P = 0; P < 2; ++P)
            {
                const Off = RotateVector(BQ, PropOffsets[P]);
                this.AssignTransform(
                    Block.BomberProps[I * 2 + P],
                    [B.Position[0] + Off[0], B.Position[1] + Off[1], B.Position[2] + Off[2]],
                    MultiplyQuaternion(BQ, SpinQ)
                );
            }
        }

        // ⑤ Aerial Bombs (oriented nose-first along velocity vector)
        for (let I = 0; I < this.Bombs.length; ++I)
        {
            const Bomb = this.Bombs[I];
            if (!Bomb.Active)
            {
                this.AssignTransform(Block.Bombs[I], ParkedPosition, IdentityQuat);
                continue;
            }
            const Horiz = Math.hypot(Bomb.Velocity[0], Bomb.Velocity[1]) || 0.01;
            const Yaw   = Math.atan2(Bomb.Velocity[1], Bomb.Velocity[0]);
            const Pitch = -Math.atan2(Bomb.Velocity[2], Horiz);
            const Q     = MultiplyQuaternion(ConstructAxisQuaternion([0.0, 0.0, 1.0], Yaw), ConstructAxisQuaternion([0.0, 1.0, 0.0], Pitch));
            this.AssignTransform(Block.Bombs[I], Bomb.Position, Q);
        }

        // ⑥ Artillery Shells
        for (let I = 0; I < this.Shells.length; ++I)
        {
            const Sh = this.Shells[I];
            if (!Sh.Active)
            {
                this.AssignTransform(Block.Shells[I], ParkedPosition, IdentityQuat);
                continue;
            }
            const Horiz = Math.hypot(Sh.Velocity[0], Sh.Velocity[1]) || 0.01;
            const Yaw   = Math.atan2(Sh.Velocity[1], Sh.Velocity[0]);
            const Pitch = -Math.atan2(Sh.Velocity[2], Horiz);
            const Q     = MultiplyQuaternion(ConstructAxisQuaternion([0.0, 0.0, 1.0], Yaw), ConstructAxisQuaternion([0.0, 1.0, 0.0], Pitch));
            this.AssignTransform(Block.Shells[I], Sh.Position, Q);
        }

        // ⑦ Tracer Bolts
        for (let I = 0; I < this.Tracers.length; ++I)
        {
            const Tr = this.Tracers[I];
            if (!Tr.Active)
            {
                this.AssignTransform(Block.Tracers[I], ParkedPosition, IdentityQuat);
                continue;
            }
            const Yaw = Math.atan2(Tr.Velocity[1], Tr.Velocity[0]);
            this.AssignTransform(Block.Tracers[I], Tr.Position, ConstructAxisQuaternion([0.0, 0.0, 1.0], Yaw));
        }

        // ⑧ Armed Mines
        for (let I = 0; I < this.Mines.length; ++I)
        {
            const M = this.Mines[I];
            this.AssignTransform(Block.Mines[I], M.Armed ? M.Position : ParkedPosition, IdentityQuat);
        }

        // ⑨ Expanding Fireball Explosion Domes
        for (let I = 0; I < this.Explosions.length; ++I)
        {
            const E = this.Explosions[I];
            if (!E.Active)
            {
                this.AssignTransform(Block.Explosions[I], ParkedPosition, IdentityQuat);
                continue;
            }
            const T = Clamp(E.Age / E.Duration, 0.0, 1.0);
            const S = (T < 0.3 ? (0.4 + 2.4 * (T / 0.3)) : Math.max(0.05, (1.0 - (T - 0.3) / 0.7) * 2.8)) * (E.MaxRadius / 4.2);
            this.AssignTransform(Block.Explosions[I], E.Position, ConstructAxisQuaternion([0.0, 0.0, 1.0], E.Yaw + E.Age * 2.4), [S, S, S]);
        }

        // ⑩ Scorched Blast Craters
        for (let I = 0; I < this.Craters.length; ++I)
        {
            const Cr = this.Craters[I];
            if (!Cr.Active)
            {
                this.AssignTransform(Block.Craters[I], ParkedPosition, IdentityQuat);
                continue;
            }
            this.AssignTransform(Block.Craters[I], Cr.Position, ConstructAxisQuaternion([0.0, 0.0, 1.0], Cr.Yaw), [Cr.Scale, Cr.Scale, 1.0]);
        }

        if (Snap && this.Scene?.RetainOccupantTransform)
        {
            for (const Idx of Block.DistanceIndices) this.Scene.RetainOccupantTransform(Idx);
            for (const Idx of Block.RasterIndices)   this.Scene.RetainOccupantTransform(Idx);
        }
    }

    // 📝 Feeds active explosions, burning tank/car wrecks & suppressed turrets into SmokeSequence!
    QuerySmokeEmissions()
    {
        if (!this.Active)
            return [];
        const Plumes = [];
        for (const E of this.Explosions)
        {
            if (!E.Active || E.Age > 0.6) continue;
            Plumes.push({
                Active: true, Burning: true, Strength: 2.2,
                Position: [E.Position[0], E.Position[1], E.Position[2] + 0.4],
                Hub: E.Position, Radius: 1.4, Expansion: 6.5,
                SmokeRate: 28.0, SootRate: 36.0, FlameRate: 26.0, HeatRate: 58.0,
                Velocity: [0.0, 0.0, 4.8], Plume: null, CombustionPower: 95000.0, Tread: [0, 0, 0]
            });
        }
        for (const T of this.Tanks)
        {
            if (T.Alive || T.BurningTimer <= 0.0) continue;
            Plumes.push({
                Active: true, Burning: true, Strength: 1.8,
                Position: [T.Position[0], T.Position[1], 1.75],
                Hub: T.Position, Radius: 0.95, Expansion: 3.4,
                SmokeRate: 22.0, SootRate: 28.0, FlameRate: 14.0, HeatRate: 42.0,
                Velocity: [0.0, 0.0, 2.4], Plume: null, CombustionPower: 70000.0, Tread: [0, 0, 0]
            });
        }
        for (const C of this.EnemyCars)
        {
            if (C.Alive || C.BurningTimer <= 0.0) continue;
            Plumes.push({
                Active: true, Burning: true, Strength: 1.4,
                Position: [C.Position[0], C.Position[1], 1.05],
                Hub: C.Position, Radius: 0.65, Expansion: 2.8,
                SmokeRate: 18.0, SootRate: 22.0, FlameRate: 10.0, HeatRate: 30.0,
                Velocity: [0.0, 0.0, 1.9], Plume: null, CombustionPower: 52000.0, Tread: [0, 0, 0]
            });
        }
        return Plumes;
    }

    // 📝 Feeds fireball blast flashes & muzzle flares into LightingSystem (schema: { X, Y, Z, Type, Colour, Intensity, Reach })!
    QueryDynamicLightRecords()
    {
        if (!this.Active)
            return [];
        const Lights = [];
        for (const E of this.Explosions)
        {
            if (!E.Active) continue;
            const Fade = Math.max(0.0, 1.0 - E.Age / E.Duration);
            Lights.push({
                Type:      0, // LightType.Omni
                X:         E.Position[0],
                Y:         E.Position[1],
                Z:         E.Position[2] + 1.8,
                Direction: [0.0, 0.0, -1.0],
                Colour:    [1.0, 0.48, 0.12],
                Intensity: 36.0 * Fade,
                Reach:     32.0
            });
        }
        for (const Tu of this.Turrets)
        {
            if (Tu.MuzzleFlash <= 0.05) continue;
            Lights.push({
                Type:      0,
                X:         Tu.Position[0] + Math.cos(Tu.Yaw) * 2.0,
                Y:         Tu.Position[1] + Math.sin(Tu.Yaw) * 2.0,
                Z:         Tu.Position[2] + 0.6,
                Direction: [Math.cos(Tu.Yaw), Math.sin(Tu.Yaw), 0.0],
                Colour:    [1.0, 0.62, 0.18],
                Intensity: 14.0 * Tu.MuzzleFlash,
                Reach:     16.0
            });
        }
        for (const Ca of this.Cannons)
        {
            if (Ca.MuzzleFlash <= 0.05) continue;
            Lights.push({
                Type:      0,
                X:         Ca.Position[0] + Math.cos(Ca.Yaw) * 5.2,
                Y:         Ca.Position[1] + Math.sin(Ca.Yaw) * 5.2,
                Z:         Ca.Position[2] + 1.4,
                Direction: [Math.cos(Ca.Yaw), Math.sin(Ca.Yaw), 0.0],
                Colour:    [1.0, 0.55, 0.15],
                Intensity: 28.0 * Ca.MuzzleFlash,
                Reach:     26.0
            });
        }
        return Lights;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                       OPTICAL 2D + 3D AUGMENTED REALITY D-DAY BATTLE HUD OVERLAY
    //--------------------------------------------------------------------------------------------------------------------

    RenderHudOverlay(Ctx, Width, Height, CameraState, ProjectWorldToScreen)
    {
        if (!this.Active || !Ctx)
            return;

        // ① 3D Optical Brackets (Atlantic Wall objective, Tanks, Cover Bunkers, Bombs/Shell Danger Rings, Mines)
        if (this.CoverOverlayOn && ProjectWorldToScreen)
        {
            // Atlantic Wall Breach Target Chevron
            const WallPt = ProjectWorldToScreen([DDayWallReachX + 10.0, 0.0, 7.5], CameraState, Width, Height);
            if (WallPt)
            {
                const Pulse = 0.72 + 0.28 * Math.sin(this.Clock * 4.5);
                Ctx.save();
                Ctx.strokeStyle = this.WallReached ? "rgba(74, 244, 156, 0.95)" : `rgba(82, 238, 178, ${Pulse.toFixed(2)})`;
                Ctx.fillStyle   = Ctx.strokeStyle;
                Ctx.lineWidth   = 2.0;
                Ctx.beginPath();
                Ctx.moveTo(WallPt.X, WallPt.Y - 12);
                Ctx.lineTo(WallPt.X - 10, WallPt.Y - 26);
                Ctx.lineTo(WallPt.X + 10, WallPt.Y - 26);
                Ctx.closePath();
                Ctx.stroke();
                Ctx.font = '700 11px "Inter", system-ui, sans-serif';
                Ctx.textAlign = "center";
                Ctx.fillText(this.WallReached ? "⚑ ATLANTIC WALL BREACHED" : `⚑ BREACH WALL · ${Math.round(this.DistanceToWall)}m`, WallPt.X, WallPt.Y - 32);
                Ctx.restore();
            }

            // Allied Tanks (show friendly armor bracket + HP% + cover prompt!)
            for (const T of this.Tanks)
            {
                const Pt = ProjectWorldToScreen([T.Position[0], T.Position[1], 3.1], CameraState, Width, Height);
                if (!Pt || Pt.Distance > 165.0) continue;
                Ctx.save();
                Ctx.strokeStyle = T.Alive ? "rgba(116, 232, 146, 0.85)" : "rgba(255, 134, 62, 0.85)";
                Ctx.fillStyle   = Ctx.strokeStyle;
                Ctx.lineWidth   = 1.4;
                Ctx.strokeRect(Pt.X - 24, Pt.Y - 8, 48, 4);
                Ctx.fillRect(Pt.X - 24, Pt.Y - 8, 48 * (T.Hp / T.MaxHp), 4);
                Ctx.font = '700 10px "JetBrains Mono", monospace';
                Ctx.textAlign = "center";
                Ctx.fillText(T.Alive ? `TANK ${Math.round(100 * T.Hp / T.MaxHp)}% · COVER` : "🔥 TANK WRECK", Pt.X, Pt.Y - 14);
                Ctx.restore();
            }

            // Enemy Patrol Cars (crimson crash/intercept brackets)
            for (const C of this.EnemyCars)
            {
                if (!C.Alive) continue;
                const Pt = ProjectWorldToScreen([C.Position[0], C.Position[1], 2.05], CameraState, Width, Height);
                if (!Pt || Pt.Distance > 130.0) continue;
                Ctx.save();
                Ctx.strokeStyle = "rgba(255, 92, 92, 0.9)";
                Ctx.fillStyle   = Ctx.strokeStyle;
                Ctx.lineWidth   = 1.4;
                Ctx.beginPath();
                Ctx.arc(Pt.X, Pt.Y, 10, 0, Math.PI * 2);
                Ctx.stroke();
                Ctx.font = '700 10px "JetBrains Mono", monospace';
                Ctx.textAlign = "center";
                Ctx.fillText(`HOSTILE CAR ${Math.round(C.Hp)}%`, Pt.X, Pt.Y - 14);
                Ctx.restore();
            }

            // Drive-In Cover Shelters
            for (const S of DDayDriveInShelters)
            {
                const Pt = ProjectWorldToScreen([S.CX, S.CY, 5.8], CameraState, Width, Height);
                if (!Pt || Pt.Distance > 140.0) continue;
                Ctx.save();
                Ctx.fillStyle = "rgba(96, 224, 255, 0.90)";
                Ctx.font = '700 10px "Inter", system-ui, sans-serif';
                Ctx.textAlign = "center";
                Ctx.fillText("🛡️ DRIVE-IN AIR COVER", Pt.X, Pt.Y);
                Ctx.restore();
            }

            // Proximity Landmines (< 30 m)
            const PPos = this.Host?.Vehicle?.Position || DDaySpawn.Position;
            for (const M of this.Mines)
            {
                if (!M.Armed) continue;
                const D = Math.hypot(M.Position[0] - PPos[0], M.Position[1] - PPos[1]);
                if (D > 30.0) continue;
                const Pt = ProjectWorldToScreen([M.Position[0], M.Position[1], 0.45], CameraState, Width, Height);
                if (!Pt) continue;
                Ctx.save();
                Ctx.strokeStyle = "rgba(255, 198, 52, 0.88)";
                Ctx.fillStyle   = Ctx.strokeStyle;
                Ctx.lineWidth   = 1.5;
                Ctx.beginPath();
                Ctx.moveTo(Pt.X, Pt.Y - 9); Ctx.lineTo(Pt.X + 8, Pt.Y + 6); Ctx.lineTo(Pt.X - 8, Pt.Y + 6); Ctx.closePath();
                Ctx.stroke();
                Ctx.font = '700 9px "JetBrains Mono", monospace';
                Ctx.textAlign = "center";
                Ctx.fillText(`MINE ${D.toFixed(0)}m`, Pt.X, Pt.Y - 12);
                Ctx.restore();
            }

            // Falling Bombs & Incoming Artillery Ground Danger Markers
            const Incoming = [...this.Bombs.filter((B) => B.Active), ...this.Shells.filter((S) => S.Active)];
            for (const Ord of Incoming)
            {
                const Pt = ProjectWorldToScreen(Ord.ImpactPos, CameraState, Width, Height);
                if (!Pt) continue;
                const PulseR = 14 + 6 * Math.sin(this.Clock * 16.0);
                Ctx.save();
                Ctx.strokeStyle = "rgba(255, 58, 58, 0.95)";
                Ctx.lineWidth   = 2.0;
                Ctx.beginPath();
                Ctx.arc(Pt.X, Pt.Y, PulseR, 0, Math.PI * 2);
                Ctx.stroke();
                Ctx.fillStyle = "rgba(255, 88, 88, 0.95)";
                Ctx.font = '800 10px "JetBrains Mono", monospace';
                Ctx.textAlign = "center";
                Ctx.fillText("⚠ BLAST ZONE", Pt.X, Pt.Y - PulseR - 5);
                Ctx.restore();
            }
        }

        // ② Top Floating Optical Tactical Battle Telemetry (zero opaque box background!)
        const CX = Width * 0.5;
        const TopY = 74.0;
        const TanksAlive = this.Tanks.filter((T) => T.Alive).length;

        Ctx.save();
        Ctx.textAlign = "center";
        Ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
        Ctx.shadowBlur  = 6.0;

        // Primary Cover / Damage / Victory Header
        if (this.WallReached)
        {
            Ctx.fillStyle = "#52f6a4";
            Ctx.font = '800 18px "Inter", system-ui, sans-serif';
            Ctx.fillText(`★ ATLANTIC WALL BREACHED! (${this.BreachTime.toFixed(1)}s) ★`, CX, TopY);
        }
        else if (this.LastHitTimer > 0.0)
        {
            Ctx.fillStyle = "#ff5b52";
            Ctx.font = '800 15px "Inter", system-ui, sans-serif';
            Ctx.fillText(`⚠ UNDER FIRE: ${this.LastHitLabel}`, CX, TopY);
        }
        else if (this.PlayerInCover)
        {
            Ctx.fillStyle = "#5ae6ff";
            Ctx.font = '800 14px "Inter", system-ui, sans-serif';
            Ctx.fillText(this.PlayerUnderAirCover ? `🛡️ AIR & GROUND COVER (${this.CoverSource})` : `🛡️ IN COVER (${this.CoverSource})`, CX, TopY);
        }
        else
        {
            Ctx.fillStyle = "#ffd166";
            Ctx.font = '700 13px "Inter", system-ui, sans-serif';
            Ctx.fillText("⚔️ EXPOSED — USE TANKS, BUNKERS OR BLAST WALLS FOR COVER · REACH THE WALL", CX, TopY);
        }

        // Compact Optical Hull & Battle Readout Line
        const HpFrac = Clamp(this.PlayerHp / this.PlayerMaxHp, 0.0, 1.0);
        Ctx.fillStyle = HpFrac > 0.55 ? "#95f5b2" : (HpFrac > 0.28 ? "#ffd166" : "#ff5a52");
        Ctx.font = '700 12px "JetBrains Mono", monospace';
        Ctx.fillText(
            `HULL ${Math.round(this.PlayerHp)}%   ·   WALL ${Math.round(this.DistanceToWall)}m   ·   TANKS ${TanksAlive}/${this.Tanks.length}   ·   CARS SMASHED ${this.CarsSmashed}`,
            CX, TopY + 20.0
        );
        Ctx.restore();
    }
}

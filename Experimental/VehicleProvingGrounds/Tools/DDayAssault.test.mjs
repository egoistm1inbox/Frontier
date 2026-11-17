import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConstructMaterialSpecification, CourseMaterial } from "../Source/MaterialSpecification.js";
import { ResolveLevelDescriptor, LevelCatalog } from "../Source/LevelStructure.js";
import { SceneStructure, IdentityCeiling } from "../Source/FacetStructure.js";
import { VehicleSolver } from "../Source/VehicleSolver.js";
import { DrivingHudSequence } from "../Source/DrivingHudSequence.js";
import { HudAudioSynthesizer } from "../Source/HudAudio.js";
import { DDayShapes, DDaySpawn, DDayWallReachX, DDayMineCoords, DDayDriveInShelters } from "../Source/DDayStructure.js";
import { DDayBattleSequence } from "../Source/DDayBattleSequence.js";

const RepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function WithArchiveFetch(Fn)
{
    const OrigFetch = globalThis.fetch;
    globalThis.fetch = async (Url) =>
    {
        const Rel = String(Url).replace(/^\.\//, "");
        const FilePath = path.resolve(RepoRoot, Rel);
        const Buf = fs.readFileSync(FilePath);
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => Buf.buffer.slice(Buf.byteOffset, Buf.byteOffset + Buf.byteLength),
            text: async () => Buf.toString("utf8")
        };
    };
    try { return await Fn(); }
    finally { globalThis.fetch = OrigFetch; }
}

function VerifyWatertight2Manifold(Name, Facets)
{
    assert.ok(Facets.length >= 12, `${Name} must emit non-trivial facets`);
    const Q = (V) => `${Math.round(V[0] * 10000)},${Math.round(V[1] * 10000)},${Math.round(V[2] * 10000)}`;
    const Edges = new Map();
    let SignedVol6 = 0.0;

    for (const F of Facets)
    {
        const [A, B, C] = F.Corners;
        const Keys = [Q(A), Q(B), Q(C)];
        if (Keys[0] === Keys[1] || Keys[1] === Keys[2] || Keys[2] === Keys[0])
            continue;
        for (let E = 0; E < 3; ++E)
        {
            const K = `${Keys[E]}->${Keys[(E + 1) % 3]}`;
            Edges.set(K, (Edges.get(K) || 0) + 1);
        }
        SignedVol6 += A[0] * (B[1] * C[2] - B[2] * C[1])
                    - A[1] * (B[0] * C[2] - B[2] * C[0])
                    + A[2] * (B[0] * C[1] - B[1] * C[0]);
    }

    let Unpaired = 0;
    for (const [K, Count] of Edges.entries())
    {
        const [U, V] = K.split("->");
        if ((Edges.get(`${V}->${U}`) || 0) !== Count)
            Unpaired++;
    }
    assert.equal(Unpaired, 0, `${Name} must be closed 2-manifold (unpaired=${Unpaired})`);
    assert.ok(SignedVol6 > 1.0e-4, `${Name} must have positive outward volume (got ${SignedVol6 / 6.0})`);
}

function CreateMockBattleHost(Scene = null)
{
    const Audio = new HudAudioSynthesizer();
    const Sparks = {
        BurstCalls: 0,
        TotalParticles: 0,
        Particles: [],
        EmitBurst(_Origin, Count = 40)
        {
            this.BurstCalls++;
            this.TotalParticles += Count;
            return Count;
        }
    };
    const Descriptor = ResolveLevelDescriptor("dday");
    const Vehicle = new VehicleSolver(Scene ? Scene.QueryObstacleBounds() : []);
    Vehicle.Respawn([DDaySpawn.Position[0], DDaySpawn.Position[1], 0.65], DDaySpawn.Yaw);

    return {
        LevelKey:        "dday",
        LevelDescriptor: Descriptor,
        Scene,
        Vehicle,
        Sparks,
        DrivingHud:      { Audio },
        FreeCamera:      false,
        Settings:        { CameraMode: "Chase" },
        Dock:            { Clean: false },
        RoadEditor:      { ActiveWorkspace: "proving" },
        Shell:           { Announcements: [], Announce(M) { this.Announcements.push(M); } },
        RestoreTyres()   {},
        AfterVehicleMoved() {}
    };
}

test("All 24 D-Day fortifications, vehicles, weapons, bombers, bombs, mines & explosion meshes are closed 2-manifolds", () =>
{
    for (const [Name, Spec] of Object.entries(DDayShapes))
        VerifyWatertight2Manifold(`DDayShapes.${Name}`, Spec.Emit());

    const Mats = ConstructMaterialSpecification();
    assert.ok(Mats[CourseMaterial.MilitaryOlive]);
    assert.ok(Mats[CourseMaterial.WehrmachtSlate]);
    assert.ok(Mats[CourseMaterial.BeachSand]);
    assert.ok(Mats[CourseMaterial.BunkerConcrete]);
    assert.ok(Mats[CourseMaterial.OceanWater]);
    assert.ok(Mats[CourseMaterial.TracerFire].Emission[0] > 10.0);
    assert.ok(Mats[CourseMaterial.ScorchAsh]);
    assert.equal(LevelCatalog[0].Key, "dday");
});

test("D-Day SceneStructure stays under IdentityCeiling (2044) and constructs DDayBlock cleanly", async () =>
{
    const Scene = await WithArchiveFetch(async () =>
    {
        const S = new SceneStructure();
        await S.ConstructScene("Archive", 1536, "dday");
        return S;
    });
    assert.ok(Scene.Occupants.length <= IdentityCeiling, `Occupants ${Scene.Occupants.length} exceeds ${IdentityCeiling}`);
    assert.ok(Scene.DDayBlock, "DDayBlock must be built for level=dday");
    assert.equal(Scene.DDayBlock.TankHulls.length, 4);
    assert.equal(Scene.DDayBlock.TankTurrets.length, 4);
    assert.equal(Scene.DDayBlock.TankBarrels.length, 4);
    assert.equal(Scene.DDayBlock.EnemyCarBodies.length, 5);
    assert.equal(Scene.DDayBlock.EnemyCarWheels.length, 20);
    assert.equal(Scene.DDayBlock.Turrets.length, 6);
    assert.equal(Scene.DDayBlock.Cannons.length, 4);
    assert.equal(Scene.DDayBlock.BomberBodies.length, 2);
    assert.equal(Scene.DDayBlock.BomberProps.length, 4);
    assert.equal(Scene.DDayBlock.Mines.length, DDayMineCoords.length);
});

test("Tanks move toward the wall, shield the player as cover, and explode when shot/bombed", () =>
{
    const Host = CreateMockBattleHost();
    const DDay = new DDayBattleSequence(Host);

    const LeadTank = DDay.Tanks[0];
    const StartX = LeadTank.Position[0];

    // Park player car right behind Tank 0 (west of tank, facing east toward Pillbox MG-1 / Trench MG)
    Host.Vehicle.Respawn([StartX - 6.5, LeadTank.Position[1], 0.65], 0.0);
    assert.ok(Host.Vehicle.Obstacles.includes(LeadTank.ObstacleBox), "Tank dynamic AABB must register in Vehicle.Obstacles");

    for (let Step = 0; Step < 90; ++Step)
        DDay.Advance(1.0 / 60.0);

    assert.ok(LeadTank.Position[0] > StartX + 3.5, `Tank must advance East toward Atlantic Wall (${StartX} -> ${LeadTank.Position[0]})`);

    // Verify Tank & Cover Blast Wall LOS shielding against East MG turret
    const EastTurret = DDay.Turrets.find((Tu) => Tu.Position[0] > LeadTank.Position[0]);
    const PlayerBehindTank = [LeadTank.Position[0] - 5.2, LeadTank.Position[1], 0.65];
    const BehindWall = [-119.5, 14.0, 0.65]; // directly West of Beach Sandbag Cover 1 (CX = -116, CY = 14)
    const OccTank = DDay.CheckCoverOcclusion([LeadTank.Position[0] + 18.0, LeadTank.Position[1], 1.5], PlayerBehindTank);
    const OccWall = DDay.CheckCoverOcclusion([-90.0, 14.0, 1.5], BehindWall);
    assert.equal(OccTank.Blocked, true, "Tank armor must block enemy gunfire LOS");
    assert.equal(OccTank.Source, "TANK ARMOR");
    assert.equal(OccWall.Blocked, true, "Blast wall must block enemy gunfire LOS");

    // Verify tank takes heavy damage and explodes when hit by artillery/bombing
    DDay.DamageTank(LeadTank, LeadTank.Hp + 20.0);
    assert.equal(LeadTank.Alive, false);
    assert.ok(DDay.TanksExploded >= 1);
    assert.ok(DDay.Explosions.some((E) => E.Active), "Destroyed tank must spawn active explosion dome");
    assert.ok(DDay.QuerySmokeEmissions().length >= 1, "Exploding/burning tank must emit smoke & fire plumes");
    assert.ok(Host.Sparks.BurstCalls >= 1);
    assert.ok(Host.DrivingHud.Audio.Counts.Explosion >= 1);
    assert.ok(EastTurret, "Turrets must exist");
});

test("Drive-In Shelter protects from overhead bombers while falling bombs & cannons explode on ground", () =>
{
    const Host = CreateMockBattleHost();
    const DDay = new DDayBattleSequence(Host);

    // Park inside West Beach Drive-In Cover Shelter (-22, 22)
    const Shelter = DDayDriveInShelters[0];
    Host.Vehicle.Respawn([Shelter.CX, Shelter.CY, 0.65], 0.0);
    DDay.Advance(1.0 / 60.0);
    assert.equal(DDay.PlayerInCover, true);
    assert.equal(DDay.PlayerUnderAirCover, true, "Drive-In Shelter must grant overhead air cover");

    // Suppress ground MG turrets momentarily to isolate overhead bombing protection test inside the shelter
    for (const Tu of DDay.Turrets)
        Tu.SuppressedTimer = 10.0;
    for (const Ca of DDay.Cannons)
        Ca.SuppressedTimer = 10.0;

    const HpBefore = DDay.PlayerHp;
    // Drop a bomb directly over the shelter roof!
    const Bomb = DDay.SpawnBomb([Shelter.CX, Shelter.CY, 18.0], [0.0, 0.0, 0.0], false);
    assert.ok(Bomb);
    assert.ok(Host.DrivingHud.Audio.Counts.BombWhistle >= 1);

    let RoofDetonated = false;
    for (let I = 0; I < 150; ++I)
    {
        DDay.Advance(1.0 / 60.0);
        if (!Bomb.Active && Math.abs(Bomb.Position[2] - 5.0) < 0.6)
            RoofDetonated = true;
    }

    assert.ok(RoofDetonated, "Bomb must detonate on shelter roof");
    assert.equal(DDay.PlayerHp, HpBefore, "Driver inside concrete shelter roof must take 0 bomb blast damage");

    // Now move into the open and drop a bomb in open air: verify bomber motion & open blast detonation
    const Bomber0Start = DDay.Bombers[0].Position.slice();
    Host.Vehicle.Respawn([-60.0, 0.0, 0.65], 0.0);
    const OpenBomb = DDay.SpawnBomb([-60.0, 0.0, 12.0], [0.0, 0.0, 0.0], false);
    let GroundDetonated = false;
    for (let I = 0; I < 120; ++I)
    {
        DDay.Advance(1.0 / 60.0);
        if (!OpenBomb.Active && OpenBomb.Position[2] <= 0.4)
            GroundDetonated = true;
    }

    assert.ok(GroundDetonated, "Open-air bomb must fall and detonate on ground");
    assert.ok(Math.hypot(DDay.Bombers[0].Position[0] - Bomber0Start[0], DDay.Bombers[0].Position[1] - Bomber0Start[1]) > 15.0,
              "Overhead bombers must fly dynamically across the beachhead");
    assert.ok(DDay.Craters.some((C) => C.Active), "Ground detonations must stamp scorched blast craters");
});

test("Landmines explode under the vehicle, enemy patrol cars crash & wreck, and reaching the wall triggers victory", () =>
{
    const Host = CreateMockBattleHost();
    const DDay = new DDayBattleSequence(Host);

    // ① Roll directly over Mine 0
    const Mine0 = DDay.Mines[0];
    assert.equal(Mine0.Armed, true);
    Host.Vehicle.Respawn([Mine0.Position[0], Mine0.Position[1], 0.65], 0.0);
    const HpPreMine = DDay.PlayerHp;
    DDay.Advance(1.0 / 60.0);

    assert.equal(Mine0.Armed, false, "Landmine must detonate when driven over");
    assert.equal(DDay.MinesTriggered, 1);
    assert.ok(DDay.PlayerHp < HpPreMine, "Landmine blast must damage player hull");
    assert.ok(Host.Vehicle.LinearVelocity[2] > 0.5, "Landmine blast must kick player vehicle upward");

    // ② High-speed crash into Enemy Military Patrol Car
    const Enemy0 = DDay.EnemyCars[0];
    Enemy0.Position = [0.0, 0.0, 0.65];
    Enemy0.Velocity = [0.0, 0.0, 0.0];
    Enemy0.Yaw = Math.PI;
    Host.Vehicle.Respawn([-2.6, 0.0, 0.65], 0.0);
    Host.Vehicle.LinearVelocity = [26.0, 0.0, 0.0];

    DDay.Advance(1.0 / 60.0);
    assert.ok(Host.DrivingHud.Audio.Counts.CarCrash >= 1, "Car crash must trigger metallic crash SFX");
    assert.ok(Host.Sparks.TotalParticles >= 20, "Car crash must emit collision sparks");
    assert.ok(Enemy0.Hp < Enemy0.MaxHp, "High-speed collision must damage enemy military patrol car");

    // Second lethal slam wrecks & explodes the car
    Enemy0.CrashCooldown = 0.0;
    Host.Vehicle.Respawn([Enemy0.Position[0] - 2.4, Enemy0.Position[1], 0.65], 0.0);
    Host.Vehicle.LinearVelocity = [28.0, 0.0, 0.0];
    DDay.Advance(1.0 / 60.0);
    assert.equal(Enemy0.Alive, false, "Lethal ramming must wreck & explode the enemy patrol car");
    assert.ok(DDay.CarsSmashed >= 1);

    // ③ Reach the Atlantic Wall Breach Gate (X >= DDayWallReachX)
    Host.Vehicle.Respawn([DDayWallReachX + 2.5, 0.0, 0.65], 0.0);
    DDay.Advance(1.0 / 60.0);
    assert.equal(DDay.WallReached, true, "Reaching Atlantic Wall breach line must complete mission objective");
    assert.ok(Host.DrivingHud.Audio.Counts.BreachVictory >= 1);
});

test("D-Day AR-HUD overlay projects Wall objective, Tank cover & Danger rings with zero black boxes", () =>
{
    const Host = CreateMockBattleHost();
    const DDay = new DDayBattleSequence(Host);
    Host.DDay = DDay;
    Host.CameraState = {
        Position: [-148.0, 0.0, 2.6],
        Forward:  [1.0, 0.0, -0.05],
        Right:    [0.0, -1.0, 0.0],
        Up:       [0.05, 0.0, 1.0],
        TanY:     Math.tan(30 * Math.PI / 180),
        Aspect:   16 / 9
    };

    const Hud = new DrivingHudSequence(Host);
    const Texts = [];
    const DarkFills = [];
    let FillStyle = "";
    const MockCtx = {
        get fillStyle() { return FillStyle; },
        set fillStyle(V) { FillStyle = String(V); },
        set strokeStyle(_) {},
        set lineWidth(_) {},
        set font(_) {},
        set textAlign(_) {},
        set shadowColor(_) {},
        set shadowBlur(_) {},
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        stroke() {},
        strokeRect() {},
        fillRect(_X, _Y, W, H)
        {
            if (W > 20 && H > 12 && /rgba\(\s*(?:[0-9]|1[0-9]|2[0-4])\s*,/.test(FillStyle))
                DarkFills.push(FillStyle);
        },
        fillText(T) { Texts.push(String(T)); }
    };

    DDay.SpawnBomb([-120.0, 0.0, 25.0], [0.0, 0.0, 0.0], false);
    DDay.Advance(1.0 / 60.0);
    DDay.RenderHudOverlay(MockCtx, 1280, 720, Host.CameraState, (Pt, Cam, W, H) =>
    {
        const P = Hud.ProjectWorld(Pt, W, H, Cam);
        return P ? { X: P[0], Y: P[1], Distance: P[2] } : null;
    });

    assert.equal(DarkFills.length, 0, "D-Day HUD must use pure optical light-on-glass with zero black boxes");
    assert.ok(Texts.some((T) => T.includes("BREACH WALL")), "HUD must project Atlantic Wall objective marker");
    assert.ok(Texts.some((T) => T.includes("HULL") && T.includes("WALL")), "HUD must display battle status telemetry");
});

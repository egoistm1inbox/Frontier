//============================================================================================================================================
//                                                        INVERSIONARENA.TEST.MJS
//============================================================================================================================================
// 🧩 Verification of the Grand Prix Stunt Race Circuit: watertight 2-manifold solids across all 8 ramp architectures, 3D ray/hull queries,
//    480 Hz hands-free 360° loop -> camelback waves -> tabletop jump, 180° velodrome bowl, heartline S-bridge, 360° pipe corkscrew & camera.

import test from "node:test";
import assert from "node:assert/strict";

import { ConstructBasisQuaternion, CastSurfaceRay, QuerySurfaceHullContact } from "../Source/RampSurfaceProjection.js";
import { InversionArenaSurfaces, InversionArenaShapes, InversionArenaZones,
         InversionArenaTracks, InversionPhysicsCutouts } from "../Source/InversionArenaStructure.js";
import { LevelCatalog, ResolveLevelDescriptor } from "../Source/LevelStructure.js";
import { AssignCourseReliefEnabled, AssignExcavationCutouts, ResolveCourseHeight } from "../Source/CourseStructure.js";
import { BollardSequence } from "../Source/BollardSequence.js";
import { SceneStructure } from "../Source/FacetStructure.js";
import { VehicleSolver } from "../Source/VehicleSolver.js";
import { ConstructHullPoints } from "../Source/HullStructure.js";
import { ChaseCameraSolver } from "../Source/ChaseCameraSolver.js";
import { SweepSpark } from "../Source/SparkCollision.js";
import { ServiceAudio } from "../Source/ServiceAudio.js";
import {
    RoadStudioVertexCapacity,
    CompileStudioProjectForWorld,
    makeDemo,
    makeTemplate,
    templateCatalog
} from "../Source/RoadStudioAdapter.js";
import { RotateVector, CrossVector, DotVector, SubtractVector } from "../Source/TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                                            MANIFOLD & BASIS VERIFICATION
//------------------------------------------------------------------------------------------------------------------------

test("ConstructBasisQuaternion matches orthonormal axes across arbitrary 3D orientations", () =>
{
    for (const Angles of [[0.4, 0.7, -0.9], [1.9, -1.1, 2.4], [Math.PI, 0.0, 0.5]])
    {
        const [Roll, Pitch, Yaw] = Angles;
        const Cr = Math.cos(Roll), Sr = Math.sin(Roll);
        const Cp = Math.cos(Pitch), Sp = Math.sin(Pitch);
        const Cy = Math.cos(Yaw), Sy = Math.sin(Yaw);
        const AxisX = [Cy * Cp, Sy * Cp, -Sp];
        const AxisY = [Cy * Sp * Sr - Sy * Cr, Sy * Sp * Sr + Cy * Cr, Cp * Sr];
        const AxisZ = CrossVector(AxisX, AxisY);
        const Quaternion = ConstructBasisQuaternion(AxisX, AxisY, AxisZ);
        const Rx = RotateVector(Quaternion, [1.0, 0.0, 0.0]);
        const Ry = RotateVector(Quaternion, [0.0, 1.0, 0.0]);
        const Rz = RotateVector(Quaternion, [0.0, 0.0, 1.0]);
        for (let Axis = 0; Axis < 3; ++Axis)
        {
            assert.ok(Math.abs(Rx[Axis] - AxisX[Axis]) < 1.0e-5);
            assert.ok(Math.abs(Ry[Axis] - AxisY[Axis]) < 1.0e-5);
            assert.ok(Math.abs(Rz[Axis] - AxisZ[Axis]) < 1.0e-5);
        }
    }
});

test("Every InversionArena circuit & stunt solid is a closed 2-manifold with positive outward signed volume", () =>
{
    const Quantize = (Point) => Point.map((Coord) => Math.round(Coord * 1.0e4)).join(",");

    for (const [ShapeName, Definition] of Object.entries(InversionArenaShapes))
    {
        const Facets = Definition.Emit();
        assert.ok(Facets.length >= 6, `${ShapeName} must emit at least 6 facets`);

        const DirectedEdges = new Set();
        let SignedSixVolume = 0.0;

        for (const Facet of Facets)
        {
            const Corners = Facet.Corners;
            for (let Index = 0; Index < Corners.length; ++Index)
            {
                const KeyA = Quantize(Corners[Index]);
                const KeyB = Quantize(Corners[(Index + 1) % Corners.length]);
                if (KeyA === KeyB)
                    continue;
                const EdgeTag = `${KeyA}->${KeyB}`;
                assert.ok(!DirectedEdges.has(EdgeTag), `${ShapeName} has duplicate directed edge ${EdgeTag}`);
                DirectedEdges.add(EdgeTag);
            }
            for (let Tri = 1; Tri + 1 < Corners.length; ++Tri)
            {
                const A = Corners[0], B = Corners[Tri], C = Corners[Tri + 1];
                const NormalOut = CrossVector(SubtractVector(B, A), SubtractVector(C, A));
                SignedSixVolume += DotVector(A, NormalOut);
            }
        }
        for (const EdgeTag of DirectedEdges)
        {
            const [From, To] = EdgeTag.split("->");
            assert.ok(DirectedEdges.has(`${To}->${From}`), `${ShapeName} has open boundary edge ${EdgeTag}`);
        }
        assert.ok(SignedSixVolume > 1.0e-2, `${ShapeName} must have positive outward signed volume, got ${SignedSixVolume}`);
    }
});

//------------------------------------------------------------------------------------------------------------------------
//                                           3D RAY & HULL SURFACE QUERIES
//------------------------------------------------------------------------------------------------------------------------

test("CastSurfaceRay resolves all unique circuit ramp architectures (Loop, Pipe, Waves, Tabletop, Bowl, Heartline, Twin-Wing)", () =>
{
    // ① Crown of the 18 m Helical Loop (X = −20, Y = −34, Z = 17.6): strut points UP (+Z) into inverted ceiling (−Z normal)
    const LoopCrownHit = CastSurfaceRay(InversionArenaSurfaces, [-20.0, -34.0, 16.5], [0.0, 0.0, 1.0], 2.5);
    assert.ok(LoopCrownHit, "Upward strut ray must hit inverted loop crown");
    assert.ok(LoopCrownHit.Normal[2] < -0.98);
    assert.ok(Math.abs(LoopCrownHit.Point[2] - 17.6) < 0.06);

    // ② Triple Camelback Wave crest & Skyline Tabletop elevated deck
    const WaveCrestHit = CastSurfaceRay(InversionArenaSurfaces, [42.0, -29.7, 2.0], [0.0, 0.0, -1.0], 2.5);
    assert.ok(WaveCrestHit && WaveCrestHit.Point[2] > 0.85, "Downward ray must hit Camelback Wave crest");
    const TabletopHit = CastSurfaceRay(InversionArenaSurfaces, [114.0, -29.7, 4.2], [0.0, 0.0, -1.0], 2.0);
    assert.ok(TabletopHit && Math.abs(TabletopHit.Point[2] - 3.30) < 0.05, "Downward ray must hit Skyline Tabletop sky-deck");

    // ③ East Turn 1 Superelevated Velodrome Bowl apex (X = 200, Y = 0, R = 36 m -> banked inward toward −X/+Z)
    const BowlApexHit = CastSurfaceRay(InversionArenaSurfaces, [198.0, 0.0, 8.0], [0.6, 0.0, -0.8], 8.0);
    assert.ok(BowlApexHit && BowlApexHit.Normal[0] < -0.45, "Strut ray must resolve inward banking on Velodrome Bowl");

    // ④ Heartline S-Twist Sky-Bridge elevated banked deck
    const HeartlineHit = CastSurfaceRay(InversionArenaSurfaces, [130.0, 35.0, 5.0], [0.0, 0.0, -1.0], 3.0);
    assert.ok(HeartlineHit && Math.abs(HeartlineHit.Normal[1]) > 0.45, "Strut ray must resolve Heartline S-Bridge banking");

    // ⑤ Ceiling of the 13.2 m Full-Pipe Tunnel (X = 26, Y = 35, Z = 13.2): normal is (0, 0, −1)
    const PipeCrownHit = CastSurfaceRay(InversionArenaSurfaces, [26.0, 35.0, 12.0], [0.0, 0.0, 1.0], 2.0);
    assert.ok(PipeCrownHit && PipeCrownHit.Normal[2] < -0.99);

    // ⑥ Hull contact pushes downward out of the inverted loop crown slab
    const HullHit = QuerySurfaceHullContact(InversionArenaSurfaces, [-20.0, -34.0, 17.62], 0.08);
    assert.ok(HullHit && HullHit.Depth > 0.0 && HullHit.Normal[2] < -0.95);
});

//------------------------------------------------------------------------------------------------------------------------
//                                       480 HZ CIRCUIT STUNT & INVERSION RUNS
//------------------------------------------------------------------------------------------------------------------------

test("ControlVehicle launches off Start Grid hands-free through 360° Loop, Camelback Waves, and Tabletop Mega-Jump", () =>
{
    AssignCourseReliefEnabled(false);
    try
    {
        const Car = new VehicleSolver([]);
        Car.Surfaces = InversionArenaSurfaces;
        Car.AeroGripScale = 1.0;
        const GridZone = InversionArenaZones[0];
        Car.Respawn([GridZone.Position[0], GridZone.Position[1], 0.63], 0.0);

        let MinimumUpZ = 1.0;
        let InvertedWithWheelContact = false;
        let ClearedWaves = false;
        for (let Step = 0; Step < 860; ++Step)
        {
            Car.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            const Upward = RotateVector(Car.Orientation, [0.0, 0.0, 1.0]);
            MinimumUpZ = Math.min(MinimumUpZ, Upward[2]);
            if (Upward[2] < -0.85 && Car.Wheels.some((Wheel) => Wheel.Contact))
                InvertedWithWheelContact = true;
            if (Car.Position[0] > 76.0)
                ClearedWaves = true;
        }
        const FinalUpward = RotateVector(Car.Orientation, [0.0, 0.0, 1.0]);
        assert.ok(MinimumUpZ < -0.90, `Vehicle must invert upside-down at loop crown, got UpZ=${MinimumUpZ}`);
        assert.ok(InvertedWithWheelContact, "Vehicle must maintain tyre contact while upside down");
        assert.ok(ClearedWaves, `Vehicle must flow straight from Loop across Triple Camelback Waves, got X=${Car.Position[0]}`);
        assert.ok(FinalUpward[2] > 0.85, `Vehicle must stay upright along outbound straight, got UpZ=${FinalUpward[2]}`);
    }
    finally
    {
        AssignCourseReliefEnabled(true);
    }
});

test("ControlVehicle carves the Heartline S-Bridge (+35°/−35°), Velodrome Bowl, and 360° Full-Pipe Corkscrew", () =>
{
    AssignCourseReliefEnabled(false);
    try
    {
        // ① Heartline S-Twist Sky-Bridge (+Roll -> 0 -> −Roll)
        const HeartCar = new VehicleSolver([]);
        HeartCar.Surfaces = InversionArenaSurfaces;
        HeartCar.AeroGripScale = 1.0;
        const HeartZone = InversionArenaZones[3];
        HeartCar.Respawn([HeartZone.Position[0], HeartZone.Position[1], 0.63], Math.PI);
        let MinSignedRoll = 0.0, MaxSignedRoll = 0.0;
        for (let Step = 0; Step < 560; ++Step)
        {
            const Up = RotateVector(HeartCar.Orientation, [0.0, 0.0, 1.0]);
            const Fwd = RotateVector(HeartCar.Orientation, [1.0, 0.0, 0.0]);
            const YErr = HeartCar.Position[1] - 35.0;
            const YawErr = Math.atan2(-Fwd[1], -Fwd[0]);
            const Steer = Math.max(-1.0, Math.min(1.0, -(YErr * 0.08 + YawErr * 1.8) + Up[1] * 0.22));
            HeartCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer, Handbrake: false }, 1.0 / 60.0);
            const RollDeg = Math.asin(Math.max(-1.0, Math.min(1.0, Up[1]))) * (180.0 / Math.PI);
            MinSignedRoll = Math.min(MinSignedRoll, RollDeg);
            MaxSignedRoll = Math.max(MaxSignedRoll, RollDeg);
            if (HeartCar.Position[0] < 62.0)
                break;
        }
        assert.ok(MaxSignedRoll > 28.0 && MinSignedRoll < -28.0,
                  `Expected bilateral +/− banking across Heartline S-Bridge, got [${MinSignedRoll.toFixed(1)}°, +${MaxSignedRoll.toFixed(1)}°]`);

        // ② 360° Full-Pipe Ceiling Corkscrew (Westbound)
        const PipeCar = new VehicleSolver([]);
        PipeCar.Surfaces = InversionArenaSurfaces;
        PipeCar.AeroGripScale = 1.0;
        const PipeZone = InversionArenaZones[4];
        PipeCar.Respawn([PipeZone.Position[0], PipeZone.Position[1], 0.63], (PipeZone.Yaw * Math.PI) / 180.0);
        let PipeMinUpZ = 1.0;
        for (let Step = 0; Step < 560; ++Step)
        {
            PipeCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            PipeMinUpZ = Math.min(PipeMinUpZ, RotateVector(PipeCar.Orientation, [0.0, 0.0, 1.0])[2]);
        }
        assert.ok(PipeMinUpZ < -0.92, `Expected Full-Pipe ceiling inversion (UpZ < -0.92), got ${PipeMinUpZ}`);
        assert.ok(PipeCar.Position[0] < -2.0, `Expected Full-Pipe West exit past X=-2, got X=${PipeCar.Position[0]}`);
    }
    finally
    {
        AssignCourseReliefEnabled(true);
    }
});

//------------------------------------------------------------------------------------------------------------------------
//                                        3D CHASE CAMERA, SPARKS & DESCRIPTORS
//------------------------------------------------------------------------------------------------------------------------

test("ChaseCameraSolver tracks 90° vertical and 180° inverted orientations without gimbal flip or roof clipping", () =>
{
    const Chase = new ChaseCameraSolver();
    Chase.SnapTo([-20.0, -38.3, 0.6], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], true);
    for (let Step = 1; Step <= 60; ++Step)
    {
        const θ = (Math.PI * Step) / 60;
        const Position = [-20.0 + 8.8 * Math.sin(θ), -38.3 + 4.3 * (θ / Math.PI), 8.8 * (1.0 - Math.cos(θ)) + 0.5];
        const Forward = [Math.cos(θ), 0.0, Math.sin(θ)];
        const Upward = [-Math.sin(θ), 0.0, Math.cos(θ)];
        Chase.AdvanceChase(Position, Forward, 22.0, 1.0 / 60.0, Upward, true);
        assert.ok(Chase.Eye.every(Number.isFinite));
        assert.ok(Chase.Up.every(Number.isFinite));
    }
    assert.ok(Chase.Eye[2] < 17.6, `Camera eye must remain inside loop below crown (Z < 17.6), got ${Chase.Eye[2]}`);
    assert.ok(Chase.Up[2] < -0.7, `Camera Up must invert smoothly with loop crown, got ${Chase.Up[2]}`);
});

test("LevelCatalog exposes D-Day Assault, Inversion Arena, City Pursuit & AI Lab, and Proving Grounds descriptors cleanly", () =>
{
    assert.equal(LevelCatalog.length, 4);
    assert.deepEqual(LevelCatalog.map((L) => L.Key), ["dday", "inversion", "city", "proving"]);
    const DDay      = ResolveLevelDescriptor("dday");
    const Inversion = ResolveLevelDescriptor("inversion");
    const City      = ResolveLevelDescriptor("city");
    const Proving   = ResolveLevelDescriptor("proving");
    assert.equal(DDay.Title, "D-Day Assault");
    assert.equal(DDay.Relief, false);
    assert.ok(DDay.Placements().length >= 30);
    assert.ok(DDay.Zones.length >= 6);
    assert.equal(Inversion.Title, "Inversion Arena");
    assert.equal(City.Title, "City Pursuit & AI Lab");
    assert.equal(City.Relief, false);
    assert.ok(City.Placements().length >= 30);
    assert.ok(City.Zones.length >= 6);
    assert.equal(Inversion.Relief, false);
    assert.equal(Inversion.Tracks.length, 9);
    assert.deepEqual(Inversion.Tracks.map((T) => T.Id),
                     ["trackA", "trackB", "trackC", "trackD", "trackE", "trackF", "trackG", "trackH", "trackI"]);
    assert.equal(Inversion.Surfaces.length, 33);
    assert.equal(Inversion.Zones.length, 23);
    assert.ok(Inversion.PhysicsCutouts.length >= 8);
    assert.equal(Inversion.DistanceCutouts.length, 6);
    assert.equal(Inversion.Bollards().length, 2);
    assert.equal(Inversion.CollapseSpans().length, 2);
    assert.equal(Inversion.Trams().length, 6);
    assert.equal(Inversion.Drones, undefined);
    assert.equal(Inversion.ServiceStations().length, 2);
    assert.equal(Inversion.FactoryRobots().length, 4);
    assert.equal(Inversion.TrafficLights().length, 8);
    assert.equal(Proving.Title, "Proving Grounds");
    assert.equal(Proving.Relief, true);
    assert.equal(Proving.Surfaces.length, 0);
    assert.equal(Proving.TrafficLights().length, 2);
});

test("Track B Split Over/Under: car drives -5.2 m underground through Subway Tunnel, +5.0 m over Sky-Bridge, and across Z=0 Underpass Road", () =>
{
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        // ① Lower Split Fork:Subterranean Subway Tunnel (-5.2 m beneath ground + concrete roof overhead)
        const TunnelCar = new VehicleSolver([]);
        TunnelCar.Surfaces = InversionArenaSurfaces;
        TunnelCar.AeroGripScale = 1.0;
        TunnelCar.Respawn([-44.0, 84.0, 0.63], 0.0);
        const Chase = new ChaseCameraSolver();
        Chase.Surfaces = InversionArenaSurfaces;
        Chase.SnapTo(TunnelCar.Position, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], true);

        let MinTunnelZ = 10.0;
        let MinCameraZ = 10.0;
        for (let Step = 0; Step < 420; ++Step)
        {
            TunnelCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            const Fwd = RotateVector(TunnelCar.Orientation, [1.0, 0.0, 0.0]);
            const Up  = RotateVector(TunnelCar.Orientation, [0.0, 0.0, 1.0]);
            const Speed = Math.hypot(TunnelCar.LinearVelocity[0], TunnelCar.LinearVelocity[1], TunnelCar.LinearVelocity[2]);
            Chase.AdvanceChase(TunnelCar.Position, Fwd, Speed, 1.0 / 60.0, Up, true);
            MinTunnelZ = Math.min(MinTunnelZ, TunnelCar.Position[2]);
            if (TunnelCar.Position[0] > -2.0 && TunnelCar.Position[0] < 28.0)
            {
                MinCameraZ = Math.min(MinCameraZ, Chase.Eye[2]);
                assert.ok(Chase.Eye[2] < -0.80, `Subway chase camera must stay below -0.78 m tunnel ceiling, got Z=${Chase.Eye[2]}`);
            }
            if (TunnelCar.Position[0] > 62.0)
                break;
        }
        assert.ok(MinTunnelZ < -4.3, `Expected car to descend below Z=-4.3 m inside Subway Tunnel, got ${MinTunnelZ}`);
        assert.ok(MinCameraZ < -2.0, `Expected chase camera to follow car underground (Z < -2.0 m), got ${MinCameraZ}`);
        assert.ok(TunnelCar.Position[0] > 60.0 && TunnelCar.Position[2] > 0.3,
                  `Expected car to climb cleanly back to ground daylight past X=60, got X=${TunnelCar.Position[0]}, Z=${TunnelCar.Position[2]}`);

        // ② Upper Split Fork: +5.0 m Sky-Bridge Overpass
        const SkyCar = new VehicleSolver([]);
        SkyCar.Surfaces = InversionArenaSurfaces;
        SkyCar.AeroGripScale = 1.0;
        SkyCar.Respawn([-50.0, 104.0, 0.63], 0.0);
        let MaxBridgeZ = 0.0;
        for (let Step = 0; Step < 360; ++Step)
        {
            SkyCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            MaxBridgeZ = Math.max(MaxBridgeZ, SkyCar.Position[2]);
        }
        assert.ok(MaxBridgeZ > 5.3, `Expected car to crest +5.0 m Sky-Bridge (Z > 5.3 m), got ${MaxBridgeZ}`);

        // ③ Intersecting North Boulevard at X = +12: drives at Z ≈ 0 OVER the -5.2 m Subway Tunnel & UNDER the +5.0 m Sky-Bridge!
        assert.equal(ResolveCourseHeight(12.0, 84.0, 0.5), 0.0, "Ground roadway over Subway Tunnel roof must remain intact for Z >= -0.45 m");
        assert.ok(ResolveCourseHeight(12.0, 84.0, -4.5) < -40.0, "Subterranean cavity below Z = -0.45 m must suppress Z=0 ground plane");
        const UnderpassCar = new VehicleSolver([]);
        UnderpassCar.Surfaces = InversionArenaSurfaces;
        UnderpassCar.Respawn([12.0, 62.0, 0.63], 0.5 * Math.PI);
        for (let Step = 0; Step < 330; ++Step)
            UnderpassCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
        assert.ok(UnderpassCar.Position[1] > 118.0 && Math.abs(UnderpassCar.Position[2] - 0.63) < 0.35,
                  `Expected Underpass Boulevard car to pass cleanly over Subway & under Sky-Bridge to Y>118, got Y=${UnderpassCar.Position[1]}, Z=${UnderpassCar.Position[2]}`);
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
    }
});

test("Track C Over/Under Canyon Crossover & Serpentine Waves: -5.2 m underpass clears +5.0 m viaduct by >9.5 m", () =>
{
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        // Vertical ray at the (X = 78, Y = -94) crossover hits BOTH +5.0 m Viaduct Bridge AND -5.2 m Canyon Underpass floor
        const BridgeHit = CastSurfaceRay(InversionArenaSurfaces, [78.0, -94.0, 8.0], [0.0, 0.0, -1.0], 6.0);
        const CanyonHit = CastSurfaceRay(InversionArenaSurfaces, [78.0, -94.0, 2.0], [0.0, 0.0, -1.0], 10.0);
        assert.ok(BridgeHit && Math.abs(BridgeHit.Point[2] - 5.0) < 0.05, `Expected +5.0 m Viaduct deck at crossover, got ${BridgeHit?.Point[2]}`);
        assert.ok(CanyonHit && Math.abs(CanyonHit.Point[2] - (-5.2)) < 0.05, `Expected -5.2 m Canyon floor at crossover, got ${CanyonHit?.Point[2]}`);
        assert.ok(BridgeHit.Point[2] - CanyonHit.Point[2] > 10.0, "Over/Under vertical separation must exceed 10.0 m");

        // Serpentine Wave alternating-camber ray hits left & right banked crests
        const SerpA = CastSurfaceRay(InversionArenaSurfaces, [-29.0, -166.0, 5.0], [0.0, 0.0, -1.0], 10.0);
        const SerpB = CastSurfaceRay(InversionArenaSurfaces, [-41.0, -166.0, 5.0], [0.0, 0.0, -1.0], 10.0);
        assert.ok(SerpA && SerpB && SerpA.Normal[1] * SerpB.Normal[1] < -0.04,
                  `Expected opposite lateral banking normals on Serpentine Wave, got ${SerpA?.Normal[1]} vs ${SerpB?.Normal[1]}`);
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
    }
});

test("Proximity-triggered BollardSequence opens Linear Strip sequentially and drives counter-phased Travelling Wave Strip", async () =>
{
    const fs = await import("node:fs/promises");
    const PreviousFetch = globalThis.fetch;
    globalThis.fetch = async (Url) =>
    {
        const Buffer = await fs.readFile(new URL(`../${Url}`, import.meta.url));
        return { ok: true, arrayBuffer: async () => Buffer.buffer.slice(Buffer.byteOffset, Buffer.byteOffset + Buffer.byteLength) };
    };
    try
    {
        const Scene = new SceneStructure();
        await Scene.ConstructScene("Archive", 0, "inversion");
        const Vehicle = {
            Position:       [0.0, 0.0, 0.63],
            LinearVelocity: [0.0, 0.0, 0.0],
            Obstacles:      Scene.QueryObstacleBounds(),
            AssignObstacles(List) { this.Obstacles = List; }
        };
        const HostStub = {
            Scene,
            Vehicle,
            Bodies:   null,
            Shell:    null,
            Renderer: { OccupantBuffer: null },
            Device:   { queue: { writeBuffer() {} } }
        };
        const Bollards = new BollardSequence(HostStub);
        assert.equal(Bollards.Zones.length, 2);

        const LinearZone = Bollards.Zones.find((Z) => Z.Id === "linearStrip");
        const WaveZone   = Bollards.Zones.find((Z) => Z.Id === "waveStrip");
        for (let Step = 0; Step < 20; ++Step)
            Bollards.Advance(1.0 / 60.0);
        assert.equal(LinearZone.Triggered, false);
        assert.equal(WaveZone.Triggered, false);
        const StandbyObstacleCount = Vehicle.Obstacles.length;
        assert.ok(StandbyObstacleCount >= 60, "Standby bollards must register blocking obstacles");

        // ① Drive into Proximity Trigger #1 (Track B Linear Bollard Strip)
        Vehicle.Position = [48.0, 166.0, 0.63];
        Vehicle.LinearVelocity = [-22.0, 0.0, 0.0];
        for (let Step = 0; Step < 8; ++Step)
            Bollards.Advance(1.0 / 60.0);
        assert.equal(LinearZone.Triggered, true, "Linear bollard strip must trigger on proximity");

        // Mid-transition: front row (u = 0) drops deeper than back row (u = 1)
        const FrontZMid = Scene.Occupants[LinearZone.Posts[0].OccupantIndex].Transform[14];
        const BackZMid  = Scene.Occupants[LinearZone.Posts[LinearZone.Posts.length - 1].OccupantIndex].Transform[14];
        assert.ok(FrontZMid < BackZMid - 0.15, `Linear strip must retract front-to-back (${FrontZMid} < ${BackZMid})`);

        // Fully open: every post in Linear Strip retracts flush below ground and releases its collider
        for (let Step = 0; Step < 60; ++Step)
            Bollards.Advance(1.0 / 60.0);
        for (const Post of LinearZone.Posts)
        {
            assert.ok(Scene.Occupants[Post.OccupantIndex].Transform[14] <= -Post.Height + 0.05, "Linear bollard must retract flush into socket");
            assert.equal(Post.Solid, false, "Retracted linear bollard must release its obstacle collider");
        }
        assert.equal(Vehicle.Obstacles.length, StandbyObstacleCount - LinearZone.Posts.length,
                     "Opening Linear Strip must remove all 28 retracted bollards from active Vehicle.Obstacles");

        // ② Drive into Proximity Trigger #2 (Track C 84 m Counter-Phased Travelling Wave Bollard Strip)
        Vehicle.Position = [-84.0, -94.0, 0.63];
        Vehicle.LinearVelocity = [20.0, 0.0, 0.0];
        for (let Step = 0; Step < 45; ++Step)
            Bollards.Advance(1.0 / 60.0);
        assert.equal(WaveZone.Triggered, true, "Wave bollard strip must trigger on proximity");

        // Verify counter-phased wave: Left vs Right at same station AND Entry (u=0) vs Far End (u=1) move in opposite vertical directions!
        const EntryLeftZ  = Scene.Occupants[WaveZone.Posts[0].OccupantIndex].Transform[14];
        const EntryRightZ = Scene.Occupants[WaveZone.Posts[1].OccupantIndex].Transform[14];
        const ExitLeftZ   = Scene.Occupants[WaveZone.Posts[WaveZone.Posts.length - 2].OccupantIndex].Transform[14];
        assert.ok(Math.abs(EntryLeftZ - EntryRightZ) > 0.35,
                  `Wave strip Left vs Right ranks must be counter-phased (one up while opposite down): ${EntryLeftZ} vs ${EntryRightZ}`);
        assert.ok(Math.abs(EntryLeftZ - ExitLeftZ) > 0.35,
                  `Wave strip Entry end vs Exit end must be counter-phased (one end up while other end down): ${EntryLeftZ} vs ${ExitLeftZ}`);
    }
    finally
    {
        globalThis.fetch = PreviousFetch;
    }
});

test("SweepSpark detects 3D stunt-ramp ceiling and banked ribbon shells", () =>
{
    AssignCourseReliefEnabled(false);
    const Hit = SweepSpark([26.0, 35.0, 12.4], [26.0, 35.0, 13.8], [], [], InversionArenaSurfaces);
    assert.ok(Hit, "Spark thrown toward Full-Pipe ceiling must hit the 3D shell");
    assert.ok(Hit.Normal[2] < -0.95, `Expected downward ceiling normal, got ${Hit.Normal[2]}`);
    AssignCourseReliefEnabled(true);
});

test("Track D Session-Baked CollapseSequence: unique movie cracks, 2-manifold shards, sand effects, and rear-to-front Bridge & Road escape", async () =>
{
    const fs = await import("node:fs/promises");
    const PreviousFetch = globalThis.fetch;
    globalThis.fetch = async (Url) =>
    {
        const Buffer = await fs.readFile(new URL(`../${Url}`, import.meta.url));
        return { ok: true, arrayBuffer: async () => Buffer.buffer.slice(Buffer.byteOffset, Buffer.byteOffset + Buffer.byteLength) };
    };
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        const Scene = new SceneStructure();
        await Scene.ConstructScene("Archive", 256, "inversion");
        const Collapse = Scene.Collapse;
        assert.ok(Collapse && Collapse.Spans.length === 2, "CollapseSequence must initialize both Bridge and Road spans");

        // ① Verify GPU IdentityCeiling (< 2044) AND exact OccupantDistanceSpace 3D SDF Slice Ceiling (< 2048) at 256 stress objects!
        assert.ok(Scene.DistanceCount <= 2044, `DistanceCount (${Scene.DistanceCount}) must fit within IdentityCeiling = 2044`);
        const RequiredSets = new Set();
        for (const Occupant of Scene.Occupants)
            if (Occupant.Roles & 2) // OccupantRole.Distance
                RequiredSets.add(Occupant.FacetSet);
        let AtlasW = 0, AtlasH = 0, StaticSlices = 0;
        for (const SetIdx of RequiredSets)
        {
            const Set = Scene.FacetSets[SetIdx];
            let Voxel = Set.DistanceVoxel;
            const Extent = [0, 1, 2].map((Axis) => Set.LocalMaximum[Axis] - Set.LocalMinimum[Axis]);
            const Margin = () => Math.max(4.0 * Voxel, 0.12);
            const Longest = Math.max(...Extent.map((L) => L + 2.0 * Margin()));
            if (Longest / Voxel > 128)
                Voxel = Longest / 128;
            const Res = Extent.map((L) => Math.max(8, Math.min(128, Math.ceil((L + 2.0 * Margin()) / Voxel))));
            AtlasW = Math.max(AtlasW, Res[0]);
            AtlasH = Math.max(AtlasH, Res[1]);
            StaticSlices += Res[2] + 1;
        }
        const FragPerRow = Math.floor(Math.max(AtlasW, 12) / 12);
        const FragPerCol = Math.floor(Math.max(AtlasH, 12) / 12);
        const FragLayers = Math.ceil(256 / (FragPerRow * FragPerCol));
        const TotalSlices = StaticSlices + FragLayers * 13;
        assert.ok(TotalSlices < 2048, `Total 3D SDF slices (${TotalSlices}) must stay strictly under WebGPU 2048 ceiling`);

        // ② Every session-baked Voronoi slab, crack prism, and sand clump must be a closed outward-wound 2-manifold!
        const Quantize = (P) => P.map((C) => Math.round(C * 1.0e4)).join(",");
        for (let PieceIdx = 0; PieceIdx < Collapse.Pieces.length; ++PieceIdx)
        {
            const Piece = Collapse.Pieces[PieceIdx];
            const Directed = new Set();
            let SixVol = 0.0;
            for (const Tri of Piece.Triangles)
            {
                const [A, B, C] = Tri.Corners;
                for (const [P, Q] of [[A, B], [B, C], [C, A]])
                {
                    const KP = Quantize(P), KQ = Quantize(Q);
                    if (KP === KQ) continue;
                    const Tag = `${KP}->${KQ}`;
                    assert.ok(!Directed.has(Tag), `Collapse piece ${PieceIdx} has duplicate edge ${Tag}`);
                    Directed.add(Tag);
                }
                SixVol += DotVector(A, CrossVector(SubtractVector(B, A), SubtractVector(C, A)));
            }
            for (const Tag of Directed)
            {
                const [From, To] = Tag.split("->");
                assert.ok(Directed.has(`${To}->${From}`), `Collapse piece ${PieceIdx} has open boundary edge ${Tag}`);
            }
            assert.ok(SixVol > 1.0e-5, `Collapse piece ${PieceIdx} must have positive outward volume, got ${SixVol}`);
        }

        // ③ Session-unique baking: distinct seeds produce genuinely distinct faultline crack & Voronoi shard layouts!
        Collapse.BakeAllSpans(0x13579BDF);
        const SnapshotA = Collapse.Spans[0].Bays.map((B) => B.Cracks[0].RelY.toFixed(4)).join(",");
        Collapse.BakeAllSpans(0x2468ACE0);
        const SnapshotB = Collapse.Spans[0].Bays.map((B) => B.Cracks[0].RelY.toFixed(4)).join(",");
        assert.notEqual(SnapshotA, SnapshotB, "Different session seeds must bake unique movie crack trajectories");
        Collapse.BakeAllSpans(0x13579BDF);
        assert.equal(Collapse.Spans[0].Bays.map((B) => B.Cracks[0].RelY.toFixed(4)).join(","), SnapshotA,
                     "Identical seed must reproduce exact deterministic fracture layout");

        // ④ Collapsing Sky-Bridge (+5.0 m): fast driver escapes across while rear bays collapse & emit sand/dust plumes!
        let SparkBursts = 0;
        const MockSparks = { EmitBurst() { SparkBursts++; } };
        const BridgeCar = new VehicleSolver([]);
        BridgeCar.Surfaces = InversionArenaSurfaces;
        BridgeCar.AeroGripScale = 1.0;
        BridgeCar.Respawn([-92.0, -250.0, 0.63], 0.0);

        let PeakSmokeEmitters = 0;
        let ActiveSandSeen = 0;
        for (let Step = 0; Step < 680; ++Step)
        {
            BridgeCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            Collapse.Advance(BridgeCar.Position, BridgeCar.LinearVelocity, 1.0 / 60.0, MockSparks);
            const SmokeVents = Collapse.QuerySmokeEmissions();
            PeakSmokeEmitters = Math.max(PeakSmokeEmitters, SmokeVents.length);
            for (const Vent of SmokeVents)
            {
                assert.ok(Vent.Radius <= 0.35, `Crack smoke vent must be tightly bound to the crack seam (Radius <= 0.35 m), got ${Vent.Radius}`);
            }
            ActiveSandSeen = Math.max(ActiveSandSeen, Collapse.SandShards.filter((S) => S.Active).length);
            if (BridgeCar.Position[0] > 106.0)
                break;
        }
        const BridgeSpan = Collapse.Spans[0];
        assert.equal(BridgeSpan.Bays[0].Collapsed, true, "Rear bridge bay must have collapsed behind the escaping car");
        assert.equal(BridgeSpan.Surface.BayIntact[0], 0, "Collapsed rear bay must drop its analytical wheel support");
        assert.ok(BridgeSpan.CrackFrontU > BridgeSpan.DropFrontU || BridgeSpan.CrackFrontU >= 1.0,
                  "Movie faultline cracks must propagate ahead of the collapse drop front");
        assert.ok(PeakSmokeEmitters >= 1 && ActiveSandSeen >= 2 && SparkBursts > 5,
                  "Collapse must emit volumetric sand/dust plumes and cascading sand particles");
        assert.ok(BridgeCar.Position[0] > 100.0 && BridgeCar.Position[2] > 0.2,
                  `Fast driver must outrun rear-to-front bridge collapse to far ramp, got X=${BridgeCar.Position[0]}, Z=${BridgeCar.Position[2]}`);

        // ⑤ Collapsing Faultline Road (0.0 m over -5.2 m Sinkhole Chasm): fast driver escapes; lingering car plunges into sinkhole!
        Collapse.ResetAllPoses();
        const RoadCar = new VehicleSolver([]);
        RoadCar.Surfaces = InversionArenaSurfaces;
        RoadCar.AeroGripScale = 1.0;
        RoadCar.Respawn([82.0, -318.0, 0.63], Math.PI);
        for (let Step = 0; Step < 520; ++Step)
        {
            RoadCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            Collapse.Advance(RoadCar.Position, RoadCar.LinearVelocity, 1.0 / 60.0, MockSparks);
            if (RoadCar.Position[0] < -60.0)
                break;
        }
        const RoadSpan = Collapse.Spans[1];
        assert.equal(RoadSpan.Bays[0].Collapsed, true, "Rear bay of Collapsing Sinkhole Road must collapse behind car");
        assert.ok(RoadCar.Position[0] < -56.0 && RoadCar.Position[2] > -0.2,
                  `Fast driver must clear Collapsing Road to solid ground past X=-56, got X=${RoadCar.Position[0]}, Z=${RoadCar.Position[2]}`);

        // Verify a stationary car parked on Bay 1 of the Sinkhole Road physically plunges into the -5.2 m chasm when overtaken!
        Collapse.ResetAllPoses();
        const SlowCar = new VehicleSolver([]);
        SlowCar.Surfaces = InversionArenaSurfaces;
        SlowCar.Respawn([44.0, -318.0, 0.63], Math.PI);
        Collapse.TriggerSpan(RoadSpan);
        for (let Step = 0; Step < 180; ++Step)
        {
            Collapse.Advance(SlowCar.Position, SlowCar.LinearVelocity, 1.0 / 60.0);
            SlowCar.Advance({ Throttle: 0.0, Brake: 1.0, Steer: 0.0, Handbrake: true }, 1.0 / 60.0);
        }
        assert.ok(SlowCar.Position[2] < -2.5, `Stationary car overtaken by road collapse must plunge into sinkhole (Z < -2.5 m), got Z=${SlowCar.Position[2]}`);
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
        globalThis.fetch = PreviousFetch;
    }
});

test("Track E 3-Lane Subway ([road][tunnel down][road] -- [road][road][road] -- [road][tunnel up][road]) & Track F Trams/Trains", async () =>
{
    const fs = await import("node:fs/promises");
    const PreviousFetch = globalThis.fetch;
    globalThis.fetch = async (Url) =>
    {
        const Buffer = await fs.readFile(new URL(`../${Url}`, import.meta.url));
        return { ok: true, arrayBuffer: async () => Buffer.buffer.slice(Buffer.byteOffset, Buffer.byteOffset + Buffer.byteLength) };
    };
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        // ① Exact 3-Lane Subway topology checks:
        //    Entry portal (X = -56): Left [road] (Y = 268.5) & Right [road] (Y = 243.5) at Z = 0; Center (Y = 256.0) diving < 0!
        assert.equal(ResolveCourseHeight(-56.0, 268.5, 0.5), 0.0, "Left outer lane must remain Z=0 [road] alongside tunnel entry");
        assert.equal(ResolveCourseHeight(-56.0, 243.5, 0.5), 0.0, "Right outer lane must remain Z=0 [road] alongside tunnel entry");
        assert.ok(ResolveCourseHeight(-56.0, 256.0, 0.5) < -40.0, "Center portal entry must open downward into subway ramp");
        const EntryRampHit = CastSurfaceRay(InversionArenaSurfaces, [-56.0, 256.0, 2.0], [0.0, 0.0, -1.0], 10.0);
        assert.ok(EntryRampHit && EntryRampHit.Point[2] < -1.5 && EntryRampHit.Point[2] > -4.0,
                  `Center lane at X=-56 must be descending ramp, got Z=${EntryRampHit?.Point[2]}`);

        //    Middle section (X = 0): ALL THREE LANES [road][road][road] at Z = 0, AND -5.20 m subway station directly below center!
        assert.equal(ResolveCourseHeight(0.0, 268.5, 0.5), 0.0, "Middle section Left [road] at Z=0");
        assert.equal(ResolveCourseHeight(0.0, 256.0, 0.5), 0.0, "Middle section Center [road] over subway roof at Z=0");
        assert.equal(ResolveCourseHeight(0.0, 243.5, 0.5), 0.0, "Middle section Right [road] at Z=0");
        const SubwayFloorHit = CastSurfaceRay(InversionArenaSurfaces, [0.0, 256.0, -1.5], [0.0, 0.0, -1.0], 6.0);
        assert.ok(SubwayFloorHit && Math.abs(SubwayFloorHit.Point[2] - (-5.2)) < 0.05,
                  `Underground subway floor must sit at Z=-5.2 m beneath center [road], got ${SubwayFloorHit?.Point[2]}`);

        //    Exit portal (X = +56): Left [road] & Right [road] at Z = 0; Center climbing back up!
        assert.equal(ResolveCourseHeight(56.0, 268.5, 0.5), 0.0, "Left outer lane must remain Z=0 [road] alongside tunnel exit");
        assert.equal(ResolveCourseHeight(56.0, 243.5, 0.5), 0.0, "Right outer lane must remain Z=0 [road] alongside tunnel exit");
        const ExitRampHit = CastSurfaceRay(InversionArenaSurfaces, [56.0, 256.0, 2.0], [0.0, 0.0, -1.0], 10.0);
        assert.ok(ExitRampHit && ExitRampHit.Point[2] < -1.5 && ExitRampHit.Point[2] > -4.0,
                  `Center lane at X=+56 must be ascending exit ramp, got Z=${ExitRampHit?.Point[2]}`);

        //    Drive ControlVehicle straight down Center Subway Portal (-5.2 m) and back up between the outer [road] lanes!
        const SubwayCar = new VehicleSolver([]);
        SubwayCar.Surfaces = InversionArenaSurfaces;
        SubwayCar.AeroGripScale = 1.0;
        SubwayCar.Respawn([-84.0, 256.0, 0.63], 0.0);
        let MinSubwayZ = 10.0;
        for (let Step = 0; Step < 520; ++Step)
        {
            SubwayCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            MinSubwayZ = Math.min(MinSubwayZ, SubwayCar.Position[2]);
            if (SubwayCar.Position[0] > 76.0)
                break;
        }
        assert.ok(MinSubwayZ < -4.3, `Expected car to descend into -5.2 m 3-Lane Subway gallery, got ${MinSubwayZ}`);
        assert.ok(SubwayCar.Position[0] > 72.0 && SubwayCar.Position[2] > 0.3,
                  `Expected car to emerge up the far center ramp to Z>0.3 m, got X=${SubwayCar.Position[0]}, Z=${SubwayCar.Position[2]}`);

        // ② Separate Articulated Streetcar Trams & Express Commuter Trains (TramSequence.js)
        const Scene = new SceneStructure();
        await Scene.ConstructScene("Archive", 0, "inversion");
        const Trams = Scene.Trams;
        assert.ok(Trams, "TramSequence must be constructed separately on Scene");
        const Summary = Trams.QuerySummary();
        assert.equal(Summary.ConsistCount, 6, "Expected 4 articulated trams + 2 express trains");
        assert.equal(Summary.CarCount, 14, "Expected 8 tram cars + 6 express train coaches = 14 railcars");

        const Obstacles = Scene.QueryObstacleBounds();
        Trams.RegisterDynamicObstacles(Obstacles);
        const LeadTramCar = Trams.Consists[0].Cars[0];
        const StartTramX = LeadTramCar.WorldPosition[0];

        const DummyCar = {
            Position:       [StartTramX + 6.0, 314.0, 0.63],
            LinearVelocity: [-8.0, 0.0, 0.0]
        };
        for (let Step = 0; Step < 30; ++Step)
            Trams.Advance(DummyCar, 1.0 / 60.0);

        assert.ok(LeadTramCar.WorldPosition[0] > StartTramX + 1.0, "Eastbound streetcar tram must advance along rail track");
        assert.ok(DummyCar.LinearVelocity[0] > 0.0, "Colliding head-on with moving Eastbound tram must deflect vehicle velocity Eastward");
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
        globalThis.fetch = PreviousFetch;
    }
});

test("True Road Boolean Holes (Underground Portals & Wavy Bollard Shafts), Track G Construction Site (Through-Trench + Dead-End Pit), Waypoint Gantries, Railguards & 4 Cone Types", async () =>
{
    const fs = await import("node:fs/promises");
    const PreviousFetch = globalThis.fetch;
    globalThis.fetch = async (Url) =>
    {
        const Buffer = await fs.readFile(new URL(`../${Url}`, import.meta.url));
        return { ok: true, arrayBuffer: async () => Buffer.buffer.slice(Buffer.byteOffset, Buffer.byteOffset + Buffer.byteLength) };
    };
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        const Inversion = ResolveLevelDescriptor("inversion");
        const GroundFacets = Inversion.EmitGround();

        // ① True Road Boolean Cutouts: verify NO horizontal ground/turf/paint facet (Z in [-0.05, +0.05]) covers the center of
        //    ANY underground portal hole OR ANY Wavy/Linear Bollard shaft, while sunken -1.92 m bollard floors DO exist!
        const PointInTriangle2D = (PX, PY, A, B, C) =>
        {
            const D1 = (PX - B[0]) * (A[1] - B[1]) - (A[0] - B[0]) * (PY - B[1]);
            const D2 = (PX - C[0]) * (B[1] - C[1]) - (B[0] - C[0]) * (PY - C[1]);
            const D3 = (PX - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (PY - A[1]);
            const HasNeg = (D1 < -1e-5) || (D2 < -1e-5) || (D3 < -1e-5);
            const HasPos = (D1 >  1e-5) || (D2 >  1e-5) || (D3 >  1e-5);
            return !(HasNeg && HasPos);
        };
        const HasRoadSheetAt = (TestX, TestY) => GroundFacets.some((F) =>
        {
            const [A, B, C] = F.Corners;
            if (Math.abs(A[2]) > 0.06 || Math.abs(B[2]) > 0.06 || Math.abs(C[2]) > 0.06)
                return false;
            return PointInTriangle2D(TestX, TestY, A, B, C);
        });

        // Check Track B Subway portal, Track C Canyon, Track E 3-Lane Subway entry/exit, Track G Through-Trench, Track G Dead-End Pit!
        for (const [Label, X, Y] of [
            ["Track B Subway Entry",          -24.0,   84.0],
            ["Track C Canyon Underpass",       78.0,  -80.0],
            ["Track E 3-Lane Subway Entry",   -56.0,  256.0],
            ["Track E 3-Lane Subway Exit",     56.0,  256.0],
            ["Track G Construction Trench",     0.0, -386.0],
            ["Track G Construction Dead-End",   0.0, -418.0]
        ])
        {
            assert.equal(HasRoadSheetAt(X, Y), false, `${Label} at (${X}, ${Y}) must be a true open boolean hole with zero blocking grass/asphalt/paint facets`);
        }

        // Check Wavy Bollard & Linear Bollard recessed boolean shafts!
        const BollardZones = Inversion.Bollards();
        const WaveSamplePost = BollardZones[1].Posts[0];
        const LinearSamplePost = BollardZones[0].Posts[0];
        assert.equal(HasRoadSheetAt(WaveSamplePost.Position[0], WaveSamplePost.Position[1]), false,
                     "Wavy bollard must sit inside a true boolean hole cut through all Z=0/-0.02 road layers");
        assert.equal(HasRoadSheetAt(LinearSamplePost.Position[0], LinearSamplePost.Position[1]), false,
                     "Linear bollard must sit inside a true boolean hole cut through all Z=0/-0.02 road layers");
        const SunkenShaftFloors = GroundFacets.filter((F) => F.Corners.every((C) => Math.abs(C[2] - (-1.92)) < 0.02));
        assert.ok(SunkenShaftFloors.length >= 120, `Expected recessed -1.92 m mechanical shaft floors for all 60 bollards, got ${SunkenShaftFloors.length}`);

        // ② [Track G · ConstructionThroughTrench] (North Construction Lane, Y = -386): drives down -5.2 m AND comes back up!
        const TrenchCar = new VehicleSolver([]);
        TrenchCar.Surfaces = InversionArenaSurfaces;
        TrenchCar.AeroGripScale = 1.0;
        TrenchCar.Respawn([-84.0, -386.0, 0.63], 0.0);
        let MinTrenchZ = 10.0;
        for (let Step = 0; Step < 560; ++Step)
        {
            TrenchCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            MinTrenchZ = Math.min(MinTrenchZ, TrenchCar.Position[2]);
            if (TrenchCar.Position[0] > 66.0)
                break;
        }
        assert.ok(MinTrenchZ < -4.3, `Expected Track G Through-Trench descent < -4.3 m, got ${MinTrenchZ}`);
        assert.ok(TrenchCar.Position[0] > 62.0 && TrenchCar.Position[2] > 0.3,
                  `Expected Track G Through-Trench to come cleanly back up onto surface road, got X=${TrenchCar.Position[0]}, Z=${TrenchCar.Position[2]}`);

        // ③ [Track G · ConstructionDeadEndPit] (South Construction Lane, Y = -418): drives down -5.2 m into Dead-End Pit & hits bulkhead wall at X = +32!
        const PitCar = new VehicleSolver([]);
        PitCar.Surfaces = InversionArenaSurfaces;
        PitCar.AeroGripScale = 1.0;
        PitCar.Respawn([-78.0, -418.0, 0.63], 0.0);
        let MinPitZ = 10.0;
        for (let Step = 0; Step < 420; ++Step)
        {
            PitCar.Advance({ Throttle: 0.85, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            MinPitZ = Math.min(MinPitZ, PitCar.Position[2]);
        }
        assert.ok(MinPitZ < -4.3, `Expected Track G Dead-End Pit descent < -4.3 m, got ${MinPitZ}`);
        assert.ok(PitCar.Position[0] > 18.0 && PitCar.Position[0] < 32.5,
                  `Dead-End Bulkhead Wall at X=+32 m must stop car underground without tunnelling, got X=${PitCar.Position[0]}`);

        // ④ Signage, Highway Waypoint Gantries, Construction Lights, Railguards, 4 Cone Types (incl. Lone Cones) & Floating Robot Drones!
        const Placements = Inversion.Placements();
        assert.ok(Placements.filter((P) => P.Shape.startsWith("WaypointBoard")).length >= 11, "Expected >= 11 overhead highway & construction waypoint boards");
        assert.ok(Placements.filter((P) => P.Shape === "WorkLightTower" || P.Shape === "AmberBeaconPost").length >= 28,
                  "Expected >= 28 construction floodlights & amber warning beacons");
        assert.ok(Placements.filter((P) => P.Shape === "GuardrailSection").length >= 80,
                  "Expected >= 80 corrugated steel W-beam highway railguard sections");

        const Cones = Inversion.Cones();
        const ConeShapes = new Set(Cones.map((C) => C.Shape || "Cone"));
        for (const Variant of ["Cone", "ConstructionDrum", "SlimPylonCone", "ShortWorkCone"])
            assert.ok(ConeShapes.has(Variant), `Expected cone variant ${Variant} in InversionArena`);
        assert.ok(Cones.filter((C) => C.Group === "lone").length >= 20, "Expected >= 20 scattered solitary lone cones");
        assert.ok(Cones.some((C) => (C.Position[2] ?? 0) < -4.5), "Expected knockable cones placed down inside the -5.2 m underground pits");

        const Scene = new SceneStructure();
        await Scene.ConstructScene("Archive", 0, "inversion");
        assert.equal(Scene.Drones, undefined, "Flying robot drones must be completely removed");
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
        globalThis.fetch = PreviousFetch;
    }
});

test("Track H Drive-Through Megafactory (Presses, Conveyors, Racks, Silos & 4 Welding Industrial Robot Arms), Auto-Fuel & 800V EV Industrial Robot Arms & Procedural Web Audio", async () =>
{
    const { readFile } = await import("node:fs/promises");
    const PreviousFetch = globalThis.fetch;
    globalThis.fetch = async (Resource) =>
    {
        const Clean = String(Resource).replace(/^\.\//, "");
        const Raw = await readFile(new URL(`../${Clean}`, import.meta.url));
        return { ok: true, status: 200, arrayBuffer: async () => Raw.buffer.slice(Raw.byteOffset, Raw.byteOffset + Raw.byteLength) };
    };
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        const Inversion = ResolveLevelDescriptor("inversion");
        const Placements = Inversion.Placements();
        const Breakables = Inversion.Breakables();

        // ① Verify Drive-Through Megafactory Building + Interior Machinery Props & Smashable Crates/Glass!
        assert.equal(Placements.filter((P) => P.Shape === "FactoryStampingPress").length, 4, "Expected 4 hydraulic stamping presses inside factory");
        assert.equal(Placements.filter((P) => P.Shape === "FactoryConveyorLine").length,  4, "Expected 4 automated conveyor lines inside factory");
        assert.equal(Placements.filter((P) => P.Shape === "FactoryStorageRack").length,   6, "Expected 6 multi-tier storage racks inside factory");
        assert.ok(Placements.filter((P) => P.Shape === "FactoryTankSilo").length >= 3,       "Expected >= 3 industrial tank silos");
        assert.equal(Placements.filter((P) => P.Shape === "FactoryRoofSlab").length,      6, "Expected 6 spanning roof decks over factory hall");
        assert.equal(Placements.filter((P) => P.Shape === "FactoryHighBayLamp").length,  18, "Expected 18 interior high-bay LED lamps");
        assert.ok(Breakables.filter((B) => B.Name.startsWith("Factory ")).length >= 4,       "Expected smashable crates & QA glass inside factory");

        const Scene = new SceneStructure();
        await Scene.ConstructScene("Archive", 0, "inversion");

        // Drive ControlVehicle straight through the Megafactory Hall central aisle (X = 0 -> +132 along Y = +408)!
        const FactoryCar = new VehicleSolver(Scene.QueryObstacleBounds());
        FactoryCar.Surfaces = InversionArenaSurfaces;
        FactoryCar.AeroGripScale = 1.0;
        FactoryCar.Respawn([0.0, 408.0, 0.63], 0.0);
        for (let Step = 0; Step < 500; ++Step)
            FactoryCar.Advance({ Throttle: 0.95, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
        assert.ok(FactoryCar.Position[0] > 124.0,
                  `Car must drive cleanly through West (X=12) and East (X=124) Megafactory portals, reached X=${FactoryCar.Position[0].toFixed(1)}`);
        assert.ok(Math.abs(FactoryCar.Position[1] - 408.0) < 2.5, "Car must stay centered on the OSHA factory assembly aisle");

        // ② Verify Automatic Octane-100 Fuel Bay full cycle with bolted Multi-Axis Industrial Robot Arm (zero butler / zero drones)!
        const Service = Scene.ServiceStations;
        assert.ok(Service && Service.Stations.length === 2, "Expected 2 automatic industrial robot service bays (Fuel + 800V EV)");
        assert.equal(Service.FactoryRobots.length, 4, "Expected 4 Megafactory assembly-line industrial welding robot arms");
        assert.equal(Scene.ServiceBlock.Count, 30, "Expected 30 dynamic occupants (6 industrial robots × 5 links: pedestal/turret/upper/forearm/wrist)");

        const Messages = [];
        Service.OnAnnounce = (M) => Messages.push(M);
        Service.FuelLevel = 0.25;
        const FuelStation = Service.Stations.find((S) => S.Kind === "fuel");
        const PedestalStart = FuelStation.LastIK.PedestalPos.slice();
        const HomeTipBefore = FuelStation.CurrentTipPos.slice();
        assert.ok(HomeTipBefore[2] > 2.0, "Industrial robot arm must start poised in its elevated home stance");

        // Record initial Megafactory welding robot tip positions to prove live assembly-line articulation
        const FactoryInitialTips = Service.FactoryRobots.map((R) => R.CurrentTipPos.slice());
        let MaxFactoryRobotMotion = 0.0;

        const ParkedFuelCar = {
            Position:       [-56.0, 392.0, 0.63],
            Orientation:    [0.0, 0.0, 0.0, 1.0],
            LinearVelocity: [0.0, 0.0, 0.0]
        };
        const SeenFuelStates = new Set();
        let MinCouplerTipDistToPort = Infinity;
        for (let Step = 0; Step < 460; ++Step)
        {
            Service.Advance(ParkedFuelCar, 1.0 / 60.0);
            SeenFuelStates.add(FuelStation.State);
            const Port = FuelStation.TargetPortPos;
            const IK = FuelStation.LastIK;
            // Verify bolted floor pedestal never translates (industrial robot arm, not a wheeled butler!)
            assert.ok(Math.hypot(IK.PedestalPos[0] - PedestalStart[0], IK.PedestalPos[1] - PedestalStart[1]) < 1.0e-6,
                      "Industrial robot pedestal must stay bolted to its concrete plinth");
            // Verify actual 3D wrist end-effector tip (+0.48 m along local +X of Wrist) couples onto vehicle fuel port
            const TipFwd = RotateVector(IK.QWrist, [0.48, 0.0, 0.0]);
            const TipWorld = [IK.WristPos[0] + TipFwd[0], IK.WristPos[1] + TipFwd[1], IK.WristPos[2] + TipFwd[2]];
            MinCouplerTipDistToPort = Math.min(MinCouplerTipDistToPort,
                Math.hypot(TipWorld[0] - Port[0], TipWorld[1] - Port[1], TipWorld[2] - Port[2]));

            for (let RIdx = 0; RIdx < Service.FactoryRobots.length; ++RIdx)
            {
                const Cur = Service.FactoryRobots[RIdx].CurrentTipPos;
                const Ref = FactoryInitialTips[RIdx];
                MaxFactoryRobotMotion = Math.max(MaxFactoryRobotMotion,
                    Math.hypot(Cur[0] - Ref[0], Cur[1] - Ref[1], Cur[2] - Ref[2]));
            }
        }
        for (const Expected of ["stopping", "deploying", "coupling", "dispensing", "retracting", "complete"])
            assert.ok(SeenFuelStates.has(Expected), `Auto-Fuel cycle must pass through '${Expected}', saw [${[...SeenFuelStates].join(", ")}]`);
        assert.equal(Service.QuerySummary().FuelPercent, 100, "Auto-Fuel industrial robot arm must refill vehicle fuel tank to 100%");
        assert.ok(MinCouplerTipDistToPort < 0.01,
                  `6-axis industrial robot coupler tip must mate onto car fuel port within 1 cm, got ${MinCouplerTipDistToPort.toFixed(4)} m`);
        assert.ok(FuelStation.CurrentTipPos[2] > 2.0,
                  "Industrial robot arm must fold cleanly back up to its home pose once refueling completes");
        assert.ok(MaxFactoryRobotMotion > 1.2,
                  `Megafactory industrial welding robot arms must actively articulate across conveyor chassis seams, moved ${MaxFactoryRobotMotion.toFixed(2)} m`);

        // ③ Verify Automatic 800V Electric Charging Station full cycle + coupling sparks + drive-away abort!
        Service.BatteryLevel = 0.22;
        const EVStation = Service.Stations.find((S) => S.Kind === "electric");
        let EmittedSparks = 0;
        const MockSparks = { EmitBurst(Desc) { EmittedSparks += (Desc?.Count || 0); } };
        const ParkedEVCar = {
            Position:       [-56.0, 420.0, 0.63],
            Orientation:    [0.0, 0.0, 0.0, 1.0],
            LinearVelocity: [0.0, 0.0, 0.0]
        };
        for (let Step = 0; Step < 460; ++Step)
            Service.Advance(ParkedEVCar, 1.0 / 60.0, MockSparks);
        assert.equal(EVStation.State, "complete", "Auto-EV 800V station must complete full charge cycle");
        assert.equal(Service.QuerySummary().BatteryPercent, 100, "Auto-EV station must charge 800V battery to 100%");
        assert.ok(EmittedSparks >= 20, `Expected coupling & 800V arc sparks during EV charge, got ${EmittedSparks}`);
        assert.equal(Service.ServicedCount, 2, "Completed services counter must equal 2 (Fuel + EV)");
        assert.ok(Messages.length >= 4, "Service stations must emit HUD status announcements");

        // Drive-away emergency abort test: enter bay, reach dispensing, then floor throttle!
        Service.Reset(true);
        const AbortCar = {
            Position:       [-56.0, 392.0, 0.63],
            Orientation:    [0.0, 0.0, 0.0, 1.0],
            LinearVelocity: [0.0, 0.0, 0.0]
        };
        for (let Step = 0; Step < 180 && FuelStation.State !== "dispensing"; ++Step)
            Service.Advance(AbortCar, 1.0 / 60.0);
        assert.equal(FuelStation.State, "dispensing", "Expected FuelStation in dispensing state prior to drive-away");
        AbortCar.LinearVelocity = [9.5, 0.0, 0.0];
        AbortCar.Position = [-44.0, 392.0, 0.63];
        Service.Advance(AbortCar, 1.0 / 60.0);
        assert.equal(FuelStation.State, "retracting", "Driving away mid-refuel must immediately unlatch & retract butler robot");

        // ④ Verify Procedural Web Audio (safe headless no-op + full oscillator/filter graph synthesis with mock AudioContext)!
        let OscCount = 0, GainCount = 0, FilterCount = 0;
        const MockParam = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
        const PrevAudioCtx = globalThis.AudioContext;
        globalThis.AudioContext = class MockAudioContext
        {
            constructor()
            {
                this.state = "running";
                this.currentTime = 1.0;
                this.destination = {};
            }
            resume() { return Promise.resolve(); }
            createOscillator() { OscCount++; return { type: "sine", frequency: MockParam(), connect() {}, start() {}, stop() {}, disconnect() {} }; }
            createGain() { GainCount++; return { gain: MockParam(), connect() {}, disconnect() {} }; }
            createBiquadFilter() { FilterCount++; return { type: "lowpass", frequency: MockParam(), Q: MockParam(), connect() {}, disconnect() {} }; }
        };
        try
        {
            const Synth = new ServiceAudio();
            assert.equal(Synth.Unlock(), true);
            Synth.PlayStationWelcome("fuel");
            Synth.PlayCouplerLatch("fuel");
            Synth.StartDispensing("fuel");
            Synth.UpdateDispensing(0.30);
            Synth.UpdateDispensing(0.60);
            Synth.StopDispensing();
            Synth.PlayCompletionChime("electric");
            Synth.PlayAbortRelease();
            assert.ok(OscCount >= 12 && GainCount >= 10 && FilterCount >= 1,
                      `Expected procedural Web Audio synthesis nodes, got osc=${OscCount}, gain=${GainCount}, filter=${FilterCount}`);
        }
        finally
        {
            globalThis.AudioContext = PrevAudioCtx;
        }
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
        globalThis.fetch = PreviousFetch;
    }
});

test("Pole-less Hovering Robotic Intersection Traffic Lights (Red/Orange/Yellow/Green) & Cubic Bézier Spline Road Editor (Watertight 2-Manifold + Live 480 Hz Driving)", async () =>
{
    const fs = await import("node:fs/promises");
    const PreviousFetch = globalThis.fetch;
    globalThis.fetch = async (Url) =>
    {
        const Buffer = await fs.readFile(new URL(`../${Url}`, import.meta.url));
        return { ok: true, arrayBuffer: async () => Buffer.buffer.slice(Buffer.byteOffset, Buffer.byteOffset + Buffer.byteLength) };
    };
    AssignCourseReliefEnabled(false);
    AssignExcavationCutouts(InversionPhysicsCutouts);
    try
    {
        const Scene = new SceneStructure();
        await Scene.ConstructScene("Archive", 0, "inversion");

        // ① Pole-less Hovering Robotic Intersection Traffic Lights:
        //    - Housing has NO pole (local Z stays strictly inside [-0.70, +1.15]),
        //    - Hovers in place above intersections (Z ≈ 4.45 m) without following the vehicle,
        //    - Cycles cleanly through GREEN -> YELLOW -> ORANGE -> RED and emits matching colored light poles!
        const HousingFacets = InversionArenaShapes.HoverTrafficHousing.Emit();
        const HousingMinZ = Math.min(...HousingFacets.flatMap((F) => F.Corners.map((C) => C[2])));
        const HousingMaxZ = Math.max(...HousingFacets.flatMap((F) => F.Corners.map((C) => C[2])));
        assert.ok(HousingMinZ > -1.30 && HousingMaxZ < 1.35 && (4.45 + HousingMinZ) > 3.0,
                  `HoverTrafficHousing must be a compact pole-less hovering unit (>3m ground clearance), got Z=[${HousingMinZ}, ${HousingMaxZ}]`);

        const TL = Scene.TrafficLights;
        assert.ok(TL, "SceneStructure must instantiate TrafficLightSequence");
        assert.equal(TL.QuerySummary().ActiveCount, 8);

        const Sig0 = TL.Units[0]; // PhaseOffset = 0.0 -> GREEN (6.5s), YELLOW (2.2s), ORANGE (1.8s), RED (6.0s)
        TL.Clock = 0.0;
        const StepAdvance = (TotalSec) =>
        {
            const Steps = Math.ceil(TotalSec / 0.05);
            for (let S = 0; S < Steps; ++S)
                TL.Advance(TotalSec / Steps);
        };
        StepAdvance(0.5); // 0.5s -> GREEN
        assert.equal(Sig0.CurrentAspect, "GREEN");
        assert.ok(Math.abs(Sig0.WorldPosition[0] - Sig0.Anchor[0]) < 0.01 && Math.abs(Sig0.WorldPosition[1] - Sig0.Anchor[1]) < 0.01,
                  "Intersection traffic light must hover steadily at its intersection anchor, never chase the player");
        assert.ok(Sig0.WorldPosition[2] > 4.2, `Traffic light must hover in midair above intersection, got Z=${Sig0.WorldPosition[2]}`);

        StepAdvance(6.6); // 7.1s -> YELLOW (6.5..8.7s)
        assert.equal(Sig0.CurrentAspect, "YELLOW");

        StepAdvance(2.4); // 9.5s -> ORANGE (8.7..10.5s)
        assert.equal(Sig0.CurrentAspect, "ORANGE");

        StepAdvance(2.0); // 11.5s -> RED (10.5..16.5s)
        assert.equal(Sig0.CurrentAspect, "RED");

        const LightPoles = TL.QueryLightPoles();
        assert.equal(LightPoles.length, 8, "Every active base hovering intersection signal must emit a colored clustered light");
        assert.ok(LightPoles[0].Colour[0] > 0.9 && LightPoles[0].Colour[1] < 0.25, "RED aspect light pole must emit red radiance");

        // Verify manual override & Road Studio junction signal activation!
        TL.OverrideMode = "ORANGE";
        TL.Advance(0.04);
        assert.ok(TL.Units.slice(0, 8).every((S) => S.CurrentAspect === "ORANGE"), "OverrideMode='ORANGE' must set all active signals to ORANGE");
        TL.OverrideMode = "AUTO";
        Scene.RoadEditor.SyncTrafficSignals();
        assert.equal(TL.QuerySummary().ActiveCount, 12, "Connected Demo's 4 signalized junctions must activate hovering signals (8 + 4 = 12)");
        TL.SyncEditorJunctionSignals([{ Name: "Custom Studio Crossroads", Position: [272.0, 0.0, 0.0], Yaw: 0.0 }]);
        assert.equal(TL.QuerySummary().ActiveCount, 9, "Custom Road Studio junction signal must activate dynamically");
        assert.ok(TL.Units[8].Anchor[2] > 4.2, "Custom Road Studio junction signal must hover above the road");

        // Verify Track A GP Lap drill is removed (no lap timers in Inversion Arena)
        const InversionDesc = ResolveLevelDescriptor("inversion");
        assert.ok(!InversionDesc.Drills.some((D) => D.Id === "grandprix" || /GP Lap/i.test(D.Name)),
                  "Track A GP Lap must not exist in InversionArenaDrills");

        // ② Road Studio Core + Adapter + Dedicated In-World Workspace Verification!
        const Editor = Scene.RoadEditor;
        assert.ok(Editor, "SceneStructure must instantiate RoadEditorSequence");
        const StarterSummary = Editor.QuerySummary();
        assert.equal(StarterSummary.Name, "Spline & Highway Bridge Demo");
        assert.deepEqual(StarterSummary.Anchor, [0.0, 0.0, 0.0], "Connected starter demo must live in 1:1 world coordinates");
        assert.equal(StarterSummary.RoadCount, 10, "Connected demo must include 10 spline roads & bridge approaches");
        assert.ok(StarterSummary.BridgeCount >= 1, "Connected demo must include the Steel I-Girder Viaduct highway bridge");
        assert.ok(StarterSummary.TriangleCount > 60000, `Expected rich Road Studio mesh (>60k tris), got ${StarterSummary.TriangleCount}`);
        assert.ok(StarterSummary.PhysicsCount >= 14, `Expected span + exact node-mesh junction physics surfaces, got ${StarterSummary.PhysicsCount}`);

        // Verify workspace mode toggle (`proving` <-> `roadstudio`) & 3D projection / raycasting math
        assert.equal(Editor.ActiveWorkspace, "proving");
        assert.equal(Editor.ToggleWorkspace(), true);
        assert.equal(Editor.ActiveWorkspace, "roadstudio");
        const FwdRaw = [0.72, 0.56, -0.41];
        const FwdLen = Math.hypot(...FwdRaw);
        const Fwd = FwdRaw.map((V) => V / FwdLen);
        const RgtRaw = [Fwd[1], -Fwd[0], 0.0];
        const RgtLen = Math.hypot(...RgtRaw);
        const Rgt = RgtRaw.map((V) => V / RgtLen);
        const UpVec = [
            Rgt[1] * Fwd[2] - Rgt[2] * Fwd[1],
            Rgt[2] * Fwd[0] - Rgt[0] * Fwd[2],
            Rgt[0] * Fwd[1] - Rgt[1] * Fwd[0]
        ];
        const MockCam = {
            Position: [200.0, -70.0, 50.0],
            Forward:  Fwd,
            Right:    Rgt,
            Up:       UpVec,
            TanY:     Math.tan((55.0 * Math.PI) / 360.0),
            Aspect:   16.0 / 9.0
        };
        const ProjPt = Editor.ProjectWorldPoint([272.0, 0.0, 0.0], 1280, 720, MockCam);
        assert.ok(ProjPt && ProjPt.every(Number.isFinite), "ProjectWorldPoint must project world junction onto viewport");
        const Ray = Editor.ScreenToWorldRay(ProjPt[0], ProjPt[1], 1280, 720, MockCam);
        const RayGround = Editor.IntersectRayPlaneZ(Ray, 0.0);
        assert.ok(RayGround && Math.hypot(RayGround[0] - 272.0, RayGround[1] - 0.0) < 1.0e-6,
                  `ScreenToWorldRay -> IntersectRayPlaneZ must round-trip to 1e-6 m, got ${RayGround}`);
        assert.equal(Editor.ToggleWorkspace(), false);
        assert.equal(Editor.ActiveWorkspace, "proving");

        // Verify major Road Studio templates compile cleanly within GPU vertex capacity & East-sector clearance
        assert.ok(templateCatalog.length >= 15, "Expected full 15-template Road Studio catalog");
        for (const TemplateId of ["district", "bridge", "diamond", "roundabout", "race", "europe", "signal", "trumpet", "cloverleaf"])
        {
            const Proj = TemplateId === "district" ? makeDemo() : makeTemplate(TemplateId);
            const Compiled = CompileStudioProjectForWorld(Proj, { LevelKey: "inversion" });
            assert.ok(Compiled.VertexCount > 3000 && Compiled.VertexCount <= RoadStudioVertexCapacity,
                      `Template ${TemplateId} vertex count ${Compiled.VertexCount} must fit within GPU budget ${RoadStudioVertexCapacity}`);
            assert.ok(Compiled.Anchor[0] >= 360.0, `Template ${TemplateId} AnchorX ${Compiled.Anchor[0]} must clear Tracks A-H`);
            assert.ok(Compiled.PhysicsSurfaces.length >= Proj.roads.length,
                      `Template ${TemplateId} must emit physics surfaces for road spans & junctions`);
        }

        // ③ Live In-World Authoring Ops (AddRoadBetween, MoveJunction, InsertBridgeOnRoad, ExportJson/ImportJson)
        const BaseRoadCount = Editor.Project.roads.length;
        const AddedRoad = Editor.AddRoadBetween([210.0, 0.0, -145.0], [890.0, 0.0, -145.0]);
        assert.ok(AddedRoad && AddedRoad.id, "AddRoadBetween must insert a connected world-space road alignment");
        assert.equal(Editor.Project.roads.length, BaseRoadCount + 1);
        assert.equal(Editor.MoveJunction(AddedRoad.end, [910.0, 0.0, -145.0]), true, "MoveJunction must translate node cleanly");
        assert.ok(Editor.InsertBridgeOnRoad(AddedRoad.id), "InsertBridgeOnRoad must atomically split approaches & elevate bridge span");
        const Exported = Editor.ExportJson();
        Editor.ResetToDefault();
        assert.equal(Editor.Project.roads.length, BaseRoadCount);
        assert.equal(Editor.ImportJson(Exported), true, "ImportJson must restore full world-space Road Studio project");
        assert.ok(Editor.QuerySummary().BridgeCount >= 2, "Imported project must retain newly inserted highway bridge");
        Editor.ResetToDefault();

        // ④ Live 480 Hz VehicleSolver Driving:
        //    (a) Straight out of the Inversion Arena (`X = 174, Y = +66`) through the open East Gateway (`X = 220.5`) onto `Arena Gateway Boulevard`!
        const CombinedSurfaces = [...InversionArenaSurfaces, ...Editor.Compiled.PhysicsSurfaces];
        const GatewayCar = new VehicleSolver(Scene.QueryObstacleBounds());
        GatewayCar.Surfaces = CombinedSurfaces;
        GatewayCar.AeroGripScale = 1.0;
        GatewayCar.Respawn([174.0, 66.0, 0.78], (-4.0 * Math.PI) / 180.0);
        for (let Step = 0; Step < 340; ++Step)
        {
            GatewayCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            assert.ok(GatewayCar.Position.every(Number.isFinite), "Vehicle pose across East Gateway spline must stay finite");
        }
        assert.ok(GatewayCar.Position[0] > 232.0,
                  `Car must drive seamlessly from Arena (X=174) through East Gateway (X=220.5) onto Road Studio spline, reached X=${GatewayCar.Position[0].toFixed(1)}`);

        //    (b) Through `Bridge North Approach` junction (`n04`, `Y = 112 -> 96`) & up 2:1 `North Bridge Embankment` (`r03`) onto `+6.2 m` `Steel I-Girder Viaduct` (`r04`) with full 700-point chassis hull!
        const BridgeCar = new VehicleSolver(Scene.QueryObstacleBounds());
        BridgeCar.Surfaces = CombinedSurfaces;
        BridgeCar.AeroGripScale = 1.0;
        BridgeCar.AssignHullPoints(ConstructHullPoints(Scene.FacetSets[Scene.VehicleBodySet].Facets), 0.05);
        BridgeCar.Respawn([333.2, 112.0, 0.85], -Math.PI / 2);
        let PeakZ = 0.0;
        for (let Step = 0; Step < 460; ++Step)
        {
            BridgeCar.Advance({ Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false }, 1.0 / 60.0);
            PeakZ = Math.max(PeakZ, BridgeCar.Position[2]);
            assert.ok(BridgeCar.Position.every(Number.isFinite), "Vehicle pose across junction & highway bridge must stay finite");
        }
        assert.ok(BridgeCar.Position[1] < 30.0, `Car must cross North Approach junction (Y=96) & climb onto Steel I-Girder Viaduct, reached Y=${BridgeCar.Position[1]}`);
        assert.ok(PeakZ > 6.5, `Car must climb smoothly onto the +6.2 m Steel I-Girder Viaduct deck, peak Z=${PeakZ}`);
    }
    finally
    {
        AssignExcavationCutouts([]);
        AssignCourseReliefEnabled(true);
        globalThis.fetch = PreviousFetch;
    }
});

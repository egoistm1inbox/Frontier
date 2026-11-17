import test from "node:test";
import assert from "node:assert/strict";

import { ResolveLevelDescriptor } from "../Source/LevelStructure.js";
import { SceneStructure } from "../Source/FacetStructure.js";
import { VehicleSolver } from "../Source/VehicleSolver.js";
import { DrivingHudSequence } from "../Source/DrivingHudSequence.js";
import { PolicePursuitSequence } from "../Source/PolicePursuitSequence.js";
import { CityPursuitShapes, PolicePursuitShapes, IsPointOccludedFromHelicopter, QueryCitySpeedLimitKmh } from "../Source/CityPursuitStructure.js";

function VerifyWatertight2Manifold(Name, Facets)
{
    assert.ok(Facets.length >= 12, `${Name} should emit non-trivial facet geometry`);
    const Q = (V) => `${Math.round(V[0] * 10000)},${Math.round(V[1] * 10000)},${Math.round(V[2] * 10000)}`;
    const DirectedEdges = new Map();
    let SignedVol6 = 0.0;

    for (const F of Facets)
    {
        const [A, B, C] = F.Corners;
        const Keys = [Q(A), Q(B), Q(C)];
        if (Keys[0] === Keys[1] || Keys[1] === Keys[2] || Keys[2] === Keys[0])
            continue;
        for (let E = 0; E < 3; ++E)
        {
            const EdgeKey = `${Keys[E]}->${Keys[(E + 1) % 3]}`;
            DirectedEdges.set(EdgeKey, (DirectedEdges.get(EdgeKey) || 0) + 1);
        }
        SignedVol6 += A[0] * (B[1] * C[2] - B[2] * C[1])
                    - A[1] * (B[0] * C[2] - B[2] * C[0])
                    + A[2] * (B[0] * C[1] - B[1] * C[0]);
    }

    let Unpaired = 0;
    for (const [EdgeKey, Count] of DirectedEdges.entries())
    {
        const [U, V] = EdgeKey.split("->");
        const RevCount = DirectedEdges.get(`${V}->${U}`) || 0;
        if (RevCount !== Count)
            Unpaired++;
    }
    assert.equal(Unpaired, 0, `${Name} must be watertight 2-manifold (found ${Unpaired} unpaired edges)`);
    assert.ok(SignedVol6 > 1.0e-4, `${Name} must have positive outward signed volume (got ${SignedVol6 / 6.0})`);
}

function CreateInspectableHudContext()
{
    const DarkFillRects = [];
    const LinePoints    = [];
    const Texts         = [];
    let CurrentFill     = "";
    const Grad = {
        Stops: [],
        addColorStop(Offset, Color) { this.Stops.push([Offset, String(Color)]); }
    };
    return {
        DarkFillRects,
        LinePoints,
        Texts,
        get fillStyle() { return CurrentFill; },
        set fillStyle(V) { CurrentFill = typeof V === "string" ? V : "gradient"; },
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo(X, Y) { LinePoints.push([X, Y]); },
        lineTo(X, Y) { LinePoints.push([X, Y]); },
        quadraticCurveTo() {},
        arc() {},
        rect() {},
        clip() {},
        fill()
        {
            if (typeof CurrentFill === "string" && /rgba\(\s*(?:[0-9]|1[0-9]|2[0-4])\s*,/.test(CurrentFill))
                DarkFillRects.push(CurrentFill);
        },
        stroke() {},
        fillRect(_X, _Y, W, H)
        {
            if (W > 20 && H > 12 && typeof CurrentFill === "string" && /rgba\(\s*(?:[0-9]|1[0-9]|2[0-4])\s*,/.test(CurrentFill))
                DarkFillRects.push(CurrentFill);
        },
        roundRect() {},
        setLineDash() {},
        fillText(T) { Texts.push(String(T)); },
        measureText(T) { return { width: String(T).length * 7.0 }; },
        createLinearGradient() { return Grad; }
    };
}

test("All City Pursuit block buildings, skybridges, Police Helicopter & Police Drone shapes are watertight 2-manifolds", () =>
{
    for (const [Key, Shape] of Object.entries(CityPursuitShapes))
        VerifyWatertight2Manifold(`CityPursuitShapes.${Key}`, Shape.Emit());
    for (const [Key, Shape] of Object.entries(PolicePursuitShapes))
        VerifyWatertight2Manifold(`PolicePursuitShapes.${Key}`, Shape.Emit());

    // Alley & bridge helicopter LOS occlusion + speed-limit zoning
    assert.equal(IsPointOccludedFromHelicopter([-120.0, 47.0, 0.63]), true,  "Narrow downtown E-W escape alley must occlude Helicopter LOS");
    assert.equal(IsPointOccludedFromHelicopter([ 105.0,  0.0, 0.63]), true,  "Underneath +6.4 m Highway Overpass must occlude Helicopter LOS");
    assert.equal(IsPointOccludedFromHelicopter([ -55.0,  0.0, 0.63]), false, "Open Central Ave intersection must keep clear Helicopter LOS");
    assert.equal(QueryCitySpeedLimitKmh([-120.0, 47.0, 0.63]), 40,  "Downtown alleys enforce 40 km/h limit");
    assert.equal(QueryCitySpeedLimitKmh([ -55.0,  0.0, 0.63]), 60,  "Downtown streets enforce 60 km/h limit");
    assert.equal(QueryCitySpeedLimitKmh([ 105.0, 20.0, 6.80]), 110, "Elevated Highway enforces 110 km/h limit");
});

test("AR-HUD renders zero black textboxes/backdrops and triggers curved trajectory ribbon only near obstacles", () =>
{
    const Descriptor = ResolveLevelDescriptor("city");
    const MockHost = {
        LevelKey:        "city",
        LevelDescriptor: Descriptor,
        FreeCamera:      false,
        Settings:        { CameraMode: "Cockpit" },
        Dock:            { Clean: false },
        RoadEditor:      { ActiveWorkspace: "proving" },
        Police:          { QueryPostedSpeedLimitKmh: () => 60 },
        CameraState: {
            Position: [-120.0, 0.0, 1.35],
            Forward:  [1.0, 0.0, -0.04],
            Right:    [0.0, -1.0, 0.0],
            Up:       [0.04, 0.0, 1.0],
            TanY:     Math.tan(30 * Math.PI / 180),
            Aspect:   16 / 9
        },
        Vehicle: {
            Hidden:          false,
            Position:        [-120.0, 0.0, 0.63],
            Orientation:     [0.0, 0.0, 0.0, 1.0],
            LinearVelocity:  [18.0, 0.0, 0.0],
            AngularVelocity: [0.0, 0.0, 0.65],
            SteerAngle:      0.24,
            QueryForward:    () => [1.0, 0.0, 0.0],
            QueryTelemetry:  () => ({ Speed: 18.0, Gear: 3, EngineRPM: 4100 })
        }
    };

    const Hud = new DrivingHudSequence(MockHost);
    const Ctx = CreateInspectableHudContext();
    Hud.Canvas = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, style: {}, getContext: () => Ctx };
    Hud.Context = Ctx;

    // 1) Open corridor (LeadCorridorDist = 90 m): zero dark fills AND trajectory corridor stays off
    Hud.LeadCorridorDist = 90.0;
    Hud.BrakeAlertActive = false;
    Hud.Render();
    assert.equal(Ctx.DarkFillRects.length, 0, "Cockpit AR-HUD must not draw any black/dark background textboxes");
    const OpenLineCount = Ctx.LinePoints.length;

    // 2) Close corridor (< 38 m) while turning (AngularVelocity[2] = 0.65 rad/s): curved trajectory activates!
    Ctx.LinePoints.length = 0;
    Hud.LeadCorridorDist = 22.0;
    Hud.Render();
    assert.equal(Ctx.DarkFillRects.length, 0, "Triggered Cockpit AR-HUD must still draw zero black textboxes");
    assert.ok(Ctx.LinePoints.length >= OpenLineCount + 6, "Context-triggered curved trajectory bars should draw when obstacle < 38 m");
    assert.ok(Ctx.Texts.some((T) => T.includes("LIMIT 60")), "Speed ring should display posted 60 km/h city speed limit");

    // 3) Chase HUD also draws zero dark background slabs
    MockHost.Settings.CameraMode = "Chase";
    Hud.Render();
    assert.equal(Ctx.DarkFillRects.length, 0, "Chase AR-HUD must not draw any black/dark background textboxes");
});

test("City Pursuit Scene constructs Police ControlVehicle + Helicopter + 3 Drones, enforces traffic laws, and trains RL policies fast", async () =>
{
    const PreviousFetch = globalThis.fetch;
    const Fs = await import("node:fs/promises");
    const Path = await import("node:path");
    const Root = Path.resolve(import.meta.dirname, "..");
    globalThis.fetch = async (Url) =>
    {
        const Rel = String(Url).replace(/^\.\//, "").split("?")[0];
        const Bytes = await Fs.readFile(Path.join(Root, Rel));
        return { ok: true, arrayBuffer: async () => Bytes.buffer.slice(Bytes.byteOffset, Bytes.byteOffset + Bytes.byteLength) };
    };

    try
    {
    const Scene = new SceneStructure();
    await Scene.ConstructScene("Archive", 0, "city");

    // Verify Police ControlVehicle + Aerial Pursuit Occupants
    assert.ok(Scene.PoliceBlock, "Scene must construct PoliceBlock");
    assert.equal(Scene.PoliceBlock.CruiserCount, 5, "Police Cruiser uses same ControlVehicle body + 4 wheels");
    assert.ok(Scene.PoliceBlock.CruiserFirst + 5 <= Scene.DistanceCount, "Police Cruiser must sit inside GDF DistanceCount");
    assert.equal(Scene.PoliceBlock.AerialCount, 6, "Aerial block must hold Helicopter (body + 2 rotors) + 3 Police Drones");
    assert.ok(Scene.PoliceBlock.AerialFirst > Scene.DistanceCount, "Raster-only Aerial units must sit after DistanceCount");

    // Verify Road Studio City + Highway Interchange network compiled surfaces & signals
    const StudioSummary = Scene.RoadEditor.QuerySummary();
    assert.ok(StudioSummary.RoadCount >= 18, "City Pursuit Road Studio project should compile full downtown + highway interchange");
    assert.ok(StudioSummary.BridgeCount >= 1, "City Pursuit Road Studio project must include elevated highway overpass bridge");

    const Descriptor = ResolveLevelDescriptor("city");
    const Vehicle = new VehicleSolver(Scene.QueryObstacleBounds());
    Vehicle.Surfaces = [...Descriptor.Surfaces];
    Vehicle.Respawn(Descriptor.Spawn.Position.slice(), Descriptor.Spawn.Yaw);

    const Host = {
        LevelKey:        "city",
        LevelDescriptor: Descriptor,
        Scene,
        Vehicle,
        Bodies:          null,
        TrafficLights:   Scene.TrafficLights,
        RoadEditor:      Scene.RoadEditor,
        Cones:           { Metrics: { Hits: 0 } },
        Fracture:        { Metrics: { Breaks: 0 } },
        Sparks:          { Emit() {} },
        Shell:           { Announce() {} }
    };
    Scene.RoadEditor.AttachHost(Host);
    Host.DrivingHud = new DrivingHudSequence(Host);

    const Police = new PolicePursuitSequence(Host);
    Host.Police  = Police;
    assert.equal(Police.PursuitActive, false, "Pursuit starts inactive while driving legally");

    // ① Speeding Violation (> 60 + 14 km/h for >= 0.9 s) deploys Cruiser + Helicopter + 3 Drones + Dynamic Strobe/Spotlight Lights!
    Vehicle.Position = [-120.0, 0.0, 0.63];
    Vehicle.LinearVelocity = [26.0, 0.0, 0.0]; // 93.6 km/h in a 60 km/h zone!
    for (let I = 0; I < 22; ++I)
        Police.Advance(0.05);

    assert.equal(Police.PursuitActive, true, "Sustained speeding in 60 km/h city zone must trigger police pursuit");
    assert.match(Police.ViolationReason, /SPEEDING/);
    assert.equal(Boolean(Scene.Occupants[Scene.PoliceBlock.CruiserBody].Inactive), false);
    assert.equal(Boolean(Scene.Occupants[Scene.PoliceBlock.HeliBody].Inactive), false);
    assert.equal(Boolean(Scene.Occupants[Scene.PoliceBlock.Drones[0]].Inactive), false);

    const EmergencyLights = Police.QueryDynamicLightRecords();
    assert.ok(EmergencyLights.length >= 4, "Active pursuit must emit Cruiser Red/Blue strobe, Helicopter Spotlight, Drone strobe & Headlights");

    // ② Running a RED Hovering Traffic Signal triggers pursuit
    Police.ClearPursuit();
    assert.equal(Police.PursuitActive, false);
    const FirstSig = Scene.TrafficLights.Units[0];
    Scene.TrafficLights.OverrideMode = "RED";
    Scene.TrafficLights.Advance(0.05);
    Vehicle.Position = [FirstSig.Anchor[0] - 4.0, FirstSig.Anchor[1], 0.63];
    Vehicle.LinearVelocity = [11.0, 0.0, 0.0]; // ~40 km/h legal speed, but blowing through RED signal!
    Police.CheckTrafficViolations(0.05);
    Scene.TrafficLights.OverrideMode = "AUTO";
    assert.equal(Police.PursuitActive, true, "Running a RED hovering intersection signal must trigger police pursuit");
    assert.match(Police.ViolationReason, /RED SIGNAL/);

    // ③ Physical PIT Maneuver collision transfers velocity & yaw spin
    Police.PoliceVehicle.Respawn([-40.0, 0.65, 0.63], 0.0);
    Vehicle.Respawn([-37.4, 0.0, 0.63], 0.0);
    Police.PoliceVehicle.LinearVelocity = [24.0, -3.5, 0.0];
    Vehicle.LinearVelocity = [14.0, 0.0, 0.0];
    const Impulse = Police.ResolveVehicleCollision(Vehicle, Police.PoliceVehicle);
    assert.ok(Impulse > 1.0, "Police cruiser PIT contact must exchange chassis collision impulse");
    assert.ok(Math.abs(Vehicle.AngularVelocity[2]) > 0.05, "Rear-quarter PIT impact must impart yaw angular velocity");

    // ④ Hands-Free Fast RL Self-Training Mode ("selfplay"): trains dual 16->20->3 policies rapidly!
    Police.ToggleSelfPlayMode(true);
    assert.equal(Police.ControlMode, "selfplay");
    assert.equal(Police.EvaderBrain.Generation, 1);

    const InitialSigma = Police.EvaderBrain.Sigma;
    Police.FastTrainGenerations(8);
    assert.equal(Police.EvaderBrain.Generation, 9, "FastTrainGenerations(8) must complete 8 full CEM-RL generations (48 episodes)");
    assert.equal(Police.EvaderBrain.RewardHistory.length, 8);
    assert.equal(Police.PoliceBrain.RewardHistory.length, 8);
    assert.ok(Police.EvaderBrain.Sigma < InitialSigma, "Exploration noise Sigma must anneal across RL generations");
    assert.ok(Number.isFinite(Police.EvaderBrain.LastBestReturn) && Number.isFinite(Police.PoliceBrain.LastBestReturn));
    }
    finally
    {
        globalThis.fetch = PreviousFetch;
    }
});

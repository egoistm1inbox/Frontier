import test from "node:test";
import assert from "node:assert/strict";

import { DrivingHudSequence } from "../Source/DrivingHudSequence.js";
import { ResolveLevelDescriptor } from "../Source/LevelStructure.js";
import { SceneStructure } from "../Source/FacetStructure.js";

function CreateMockCanvas2DContext()
{
    const Calls = { FillText: [], RoundRects: 0, Polygons: 0, Strokes: 0 };
    const Grad  = { addColorStop() {} };
    return {
        Calls,
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        closePath() { Calls.Polygons++; },
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        arc() {},
        rect() {},
        clip() {},
        fill() {},
        stroke() { Calls.Strokes++; },
        fillRect() {},
        roundRect() { Calls.RoundRects++; },
        fillText(Text) { Calls.FillText.push(String(Text)); },
        measureText(Text) { return { width: String(Text).length * 7.0 }; },
        createLinearGradient() { return Grad; }
    };
}

test("DrivingHudSequence enforces Chase vs Cockpit camera modes and hides in FreeCamera / Road Studio / HMI", () =>
{
    const Descriptor = ResolveLevelDescriptor("inversion");
    const MockHost = {
        LevelDescriptor: Descriptor,
        FreeCamera:      false,
        Settings:        { CameraMode: "Chase" },
        Dock:            { Clean: false },
        RoadEditor:      { ActiveWorkspace: "proving" },
        Vehicle: {
            Hidden:          false,
            Position:        [0.0, 0.0, 0.63],
            Orientation:     [0.0, 0.0, 0.0, 1.0],
            LinearVelocity:  [12.0, 0.0, 0.0],
            QueryForward:    () => [1.0, 0.0, 0.0],
            QueryTelemetry:  () => ({ Speed: 12.0, Gear: 3, EngineRPM: 3400 })
        },
        ServiceStations: {
            FuelLevel:    0.34,
            BatteryLevel: 0.28,
            Stations:     Descriptor.ServiceStations(),
            QuerySummary: () => ({ FuelPercent: 34, BatteryPercent: 28, ActiveKind: null, ActiveState: "idle" })
        }
    };

    const Hud = new DrivingHudSequence(MockHost);
    assert.equal(Hud.QueryDisplayMode(), "chase", "Chase camera must select exterior Dual-Wing AR-HUD");

    MockHost.Settings.CameraMode = "Hood";
    assert.equal(Hud.QueryDisplayMode(), "chase", "Hood camera must select exterior driving AR-HUD");

    Hud.Advance(1.0 / 60.0);
    MockHost.Settings.CameraMode = "Cockpit";
    assert.equal(Hud.QueryDisplayMode(), "cockpit", "Cockpit camera must select dedicated Windshield Combiner AR-HUD");
    Hud.Advance(1.0 / 60.0);
    assert.ok(Hud.Audio.Counts.ModeSwitch >= 1, "Switching Chase -> Cockpit must trigger collimator mode-switch sound");

    MockHost.Settings.CameraMode = "Passenger";
    assert.equal(Hud.QueryDisplayMode(), "cockpit", "Passenger interior camera must use Windshield Combiner AR-HUD");

    // Must hide in F8 FreeCamera (editor flight)
    MockHost.FreeCamera = true;
    assert.equal(Hud.QueryDisplayMode(), "hidden", "AR-HUD must hide in F8 FreeCamera editor mode");
    MockHost.FreeCamera = false;

    // Must hide in Road Studio workspace
    MockHost.RoadEditor.ActiveWorkspace = "roadstudio";
    assert.equal(Hud.QueryDisplayMode(), "hidden", "AR-HUD must hide in Road Studio editor workspace");
    MockHost.RoadEditor.ActiveWorkspace = "proving";

    // Must hide on close-up HMI tablet & tyre inspection cameras
    MockHost.Settings.CameraMode = "HMI";
    assert.equal(Hud.QueryDisplayMode(), "hidden", "AR-HUD must hide when zoomed into center-stack HMI tablet");
});

test("DrivingHudSequence spatial proximity triggers highlight trains & obstacles, fire BRAKE FCW, and locate nearest Fuel Bay when low", async () =>
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
        await Scene.ConstructScene("Archive", 0, "inversion");
        const Descriptor = ResolveLevelDescriptor("inversion");

        const MockHost = {
            Scene,
            LevelDescriptor: Descriptor,
            FreeCamera:      false,
            Settings:        { CameraMode: "Chase" },
            ScreenExtent:    [1280, 720],
            CameraState: {
                Position: [-130.0, 292.0, 2.4],
                Forward:  [1.0, 0.0, -0.08],
                Right:    [0.0, -1.0, 0.0],
                Up:       [0.08, 0.0, 1.0],
                TanY:     Math.tan(30.0 * Math.PI / 180.0),
                Aspect:   1280.0 / 720.0
            },
            Vehicle: {
                Hidden:          false,
                Position:        [-120.0, 292.0, 0.63],
                Orientation:     [0.0, 0.0, 0.0, 1.0],
                LinearVelocity:  [26.0, 0.0, 0.0],
                SteeringAngle:   0.0,
                QueryForward:    () => [1.0, 0.0, 0.0],
                QueryTelemetry:  () => ({ Speed: 26.0, Gear: 4, EngineRPM: 5200 })
            },
            Cones: {
                Cones: Scene.ConeBlock.Placements.map((P, Index) => ({
                    Index,
                    Shape: P.Shape || "Cone",
                    Rest:  { Position: [P.Position[0], P.Position[1], (P.Position[2] ?? 0.0) + 0.38] },
                    Body:  null,
                    Clock: 0.0,
                    HiddenUntil: -1.0
                }))
            },
            Fracture: {
                Props: Scene.Breakables.map((B, Index) => ({ Index, Definition: B, State: "intact", Pieces: [] }))
            },
            Trams:           Scene.Trams,
            ServiceStations: Scene.ServiceStations,
            TrafficLights:   Scene.TrafficLights
        };

        const Hud = new DrivingHudSequence(MockHost);
        assert.ok(Hud.SpatialGrid.size >= 15, `Expected O(1) spatial hash grid to index arena obstacles, got ${Hud.SpatialGrid.size} cells`);

        // ① Position car directly behind a live Track F rail consist at high closing speed -> verify 3D train highlight + BRAKE alert!
        const LeadCar = Scene.Trams.Consists[0].Cars[0];
        MockHost.Vehicle.Position       = [LeadCar.WorldPosition[0] - 18.0, LeadCar.WorldPosition[1], 0.63];
        MockHost.Vehicle.LinearVelocity = [28.0, 0.0, 0.0];
        MockHost.CameraState.Position   = [MockHost.Vehicle.Position[0] - 6.5, MockHost.Vehicle.Position[1], 2.2];

        for (let Step = 0; Step < 8; ++Step)
            Hud.Advance(1.0 / 60.0);

        const RailLock = Hud.SortedTargets.find((T) => T.Kind === "rail");
        assert.ok(RailLock, "Proximity trigger must lock onto nearby Track F rail train/tram");
        assert.equal(RailLock.Severity, "critical", "Fast closing on in-lane railcar must escalate target highlight to critical red");
        assert.equal(Hud.BrakeAlertActive, true, "Imminent collision TTC must activate flashing red BRAKE warning");
        assert.ok(Hud.Audio.Counts.BrakeAlert >= 1, "BRAKE warning must trigger procedural FCW audio alert");
        assert.ok(Hud.Audio.Counts.TargetLock >= 1, "Proximity hazard lock must trigger procedural radar lock audio");

        // ② Low-Fuel Warning when FAR (> 235 m) vs CLOSE (<= 235 m) to Auto-Fuel Robot Bay
        Scene.ServiceStations.FuelLevel = 0.18; // 18% low fuel!
        MockHost.Vehicle.Position = [0.0, -200.0, 0.63]; // ~595 m away from Track H [-56, 392]
        MockHost.Vehicle.LinearVelocity = [8.0, 0.0, 0.0];
        Hud.ScanAccumulator = 99.0;
        Hud.Advance(1.0 / 60.0);
        assert.ok(Hud.StationGuidance && Hud.StationGuidance.AutoTriggered, "Low fuel (18%) must arm station guidance");
        assert.equal(Hud.StationGuidance.IsClose, false, "At 595 m away, station must be classified as far");
        assert.equal(Hud.StationGuidance.Show3DBeacon, false, "When far (> 235 m), HUD shows warning banner without distant 3D clutter");
        assert.ok(Hud.Audio.Counts.LowFuel >= 1, "Crossing low-fuel threshold must play low-fuel chime");

        // Now move within proximity (64 m from Auto-Fuel Bay [-56, 392]) -> 3D AR Station Beacon + Ground Chevrons activate!
        MockHost.Vehicle.Position     = [-120.0, 392.0, 0.63];
        MockHost.CameraState.Position = [-126.5, 392.0, 2.2];
        Hud.ScanAccumulator = 99.0;
        for (let Step = 0; Step < 6; ++Step)
            Hud.Advance(1.0 / 60.0);
        assert.equal(Hud.StationGuidance.IsClose, true, "At 64 m from Auto-Fuel Bay, station must be classified as close");
        assert.equal(Hud.StationGuidance.Show3DBeacon, true, "Low fuel within proximity must project 3D nearest-station AR beacon");
        assert.ok(Hud.SortedTargets.some((T) => T.Kind === "station"), "Tracked 3D callouts must include nearest Auto-Fuel Bay");

        // ③ Verify both Chase Dual-Wing HUD and Cockpit Windshield Combiner HUD render cleanly + interactive unit toggle!
        const MockCtx = CreateMockCanvas2DContext();
        Hud.Canvas = {
            clientWidth: 1280, clientHeight: 720, width: 1280, height: 720,
            getContext: () => MockCtx
        };
        Hud.Render(MockHost.CameraState);
        assert.ok(MockCtx.Calls.FillText.some((S) => S.includes("KM/H")), "Chase HUD must render KM/H speed readout");
        assert.ok(Hud.ScreenHitBoxes.length >= 1, "3D highlighted callouts must register interactive click-to-lock hitboxes");

        Hud.ToggleSpeedUnits();
        MockHost.Settings.CameraMode = "Cockpit";
        MockCtx.Calls.FillText.length = 0;
        Hud.Advance(1.0 / 60.0);
        Hud.Render(MockHost.CameraState);
        assert.ok(MockCtx.Calls.FillText.some((S) => S.includes("mph")), "Cockpit Windshield Combiner HUD must render toggled mph readout");
        assert.ok(Hud.Audio.Counts.UiClick >= 1, "Interactive HUD unit toggle must play tactile UI micro-click");
    }
    finally
    {
        globalThis.fetch = PreviousFetch;
    }
});

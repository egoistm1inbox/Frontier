//============================================================================================================================================
//                                                          INVERSIONARENAHOOKS.MJS
//============================================================================================================================================
// 🧩 Dawn WebGPU + Jolt WASM + IlluminationHost 6-track validation across [Track A] (360° Loop + Waves),
//    [Track B] (-5.2 m Subterranean Subway + Linear Bollards), [Track C] (84 m Wave Bollards),
//    [Track D] (Session-Baked Collapsing Bridge & Road + Sand Plumes), [Track E] (3-Lane Subway) & [Track F] (Trams/Trains).
//    HOOKS=InversionArenaHooks.mjs node HeadlessHarness.mjs .. 1180 "?capture=1"

import assert from "node:assert/strict";
import { RotateVector } from "../Source/TransformProjection.js";

let Started = false;
let MinimumVehicleUpZ = 1.0;
let MinimumChaseUpZ = 1.0;
let MaximumAltitudeZ = 0.0;
let MinimumSubwayZ = 10.0;
let MinimumThreeLaneSubwayZ = 10.0;
let MinimumConstructionTrenchZ = 10.0;
let ConstructionTrenchExitedUp = false;
let MinimumDeadEndPitZ = 10.0;
let DeadEndBulkheadX = 999.0;
let MaximumFactoryHallX = -150.0;
let AutoFuelCompleted = false;
let AutoEVCompleted = false;
let MaximumTrackAX = -150.0;
let InvertedWheelContacts = 0;
let LinearStripOpened = false;
let WaveStripOpened = false;
let BridgeCollapseTriggered = false;
let RoadCollapseTriggered = false;
let CollapseSandEmitted = false;
let StartTramLeadX = null;
let PeakSplineBridgeZ = 0.0;
let RoadEditorStreamed = false;
const SeenTrafficAspects = new Set();

export default
{
    BeforeFrame(Host, Frame)
    {
        if (!Started)
        {
            Started = true;
            Host.FixedStep = 1.0 / 60.0;
            Host.Training.Arm(Host.Training.QueryDrill("loop360"));
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
            if (Host.Trams && Host.Trams.Consists.length > 0)
                StartTramLeadX = Host.Trams.Consists[0].Cars[0].WorldPosition[0];
        }

        // Phase 2 (Frame 610): Jump to Track B Subterranean Subway Tunnel (-5.2 m below Z = 0)
        if (Frame === 610)
        {
            Host.TeleportVehicle({ Position: [-44.0, 84.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 3 (Frame 885): Jump to Track B Proximity Trigger #1 (Linear Retracting Bollard Strip)
        else if (Frame === 885)
        {
            Host.TeleportVehicle({ Position: [48.0, 166.0], Yaw: 180.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 4 (Frame 908): Jump to Track C Proximity Trigger #2 (84 m Counter-Phased Wave Bollard Strip)
        else if (Frame === 908)
        {
            Host.TeleportVehicle({ Position: [-88.0, -94.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 5a (Frame 930): Rebake unique session cracks on GPU & climb onto Track D Collapsing Sky-Bridge (+5.0 m)
        else if (Frame === 930)
        {
            Host.RebakeCollapseDecks(0x5E15A1C0);
            Host.TeleportVehicle({ Name: "Collapse Bridge", Position: [-62.0, -250.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 5b (Frame 1220): Trigger Track D Collapsing Sinkhole Road (0.0 m)
        else if (Frame === 1220)
        {
            Host.TeleportVehicle({ Name: "Collapse Road", Position: [53.0, -318.0], Yaw: 180.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 6 (Frame 1330): Jump to Track E 3-Lane Center-Portal Subway ([road][tunnel down][road])
        else if (Frame === 1330)
        {
            Host.TeleportVehicle({ Name: "3-Lane Subway", Position: [-72.0, 256.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 7 (Frame 1530): Jump to Track F Articulated Streetcar Tram & Express Rail Boulevard
        else if (Frame === 1530)
        {
            Host.TeleportVehicle({ Name: "Tramway", Position: [-92.0, 314.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 8a (Frame 1565): Jump to Track G Construction Site ("CONSTRUCTION AHEAD" -> Through-Trench -> Comes Back Up!)
        else if (Frame === 1565)
        {
            Host.TeleportVehicle({ Name: "Track G Thru Trench", Position: [-62.0, -386.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 8b (Frame 2095): Jump to Track G Construction Site ("CONSTRUCTION AHEAD" -> Underground Dead-End Pit!)
        else if (Frame === 2095)
        {
            Host.TeleportVehicle({ Name: "Track G Dead-End Pit", Position: [-62.0, -418.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 0.85, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 9a (Frame 2450): Park in Track H Automatic Octane-100 Fuel Station Bay -> Butler Robot + Nozzle + Drone Refuel!
        else if (Frame === 2450)
        {
            if (Host.ServiceStations) Host.ServiceStations.FuelLevel = 0.25;
            Host.TeleportVehicle({ Name: "Track H Auto-Fuel Bay", Position: [-56.0, 392.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 0.0, Brake: 1.0, SteerAngle: 0.0, Handbrake: true, Reverse: false };
        }
        // Phase 9b (Frame 2840): Park in Track H Automatic 800V EV Station Bay -> Butler Robot + Nozzle + Drone Supercharge!
        else if (Frame === 2840)
        {
            if (Host.ServiceStations) Host.ServiceStations.BatteryLevel = 0.25;
            Host.TeleportVehicle({ Name: "Track H Auto-EV Bay", Position: [-56.0, 420.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 0.0, Brake: 1.0, SteerAngle: 0.0, Handbrake: true, Reverse: false };
        }
        // Phase 9c (Frame 3230): Drive straight through Track H Industrial Megafactory Hall (West Portal X=12 -> East Portal X=124)!
        else if (Frame === 3230)
        {
            Host.TeleportVehicle({ Name: "Track H Factory Hall", Position: [6.0, 408.0], Yaw: 0.0 }, true);
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }
        // Phase 10 (Frame 3700): Verify dedicated Road Studio workspace & templates, stream to WebGPU, and drive across Canal Viaduct!
        else if (Frame === 3700)
        {
            if (Host.Shell)
            {
                Host.Shell.Select("trafficlights");
                Host.Shell.Select("roadeditor");
            }
            if (Host.RoadEditor)
            {
                Host.RoadEditor.LoadTemplate("diamond");
                Host.RoadEditor.ResetToDefault();
                RoadEditorStreamed = Host.Scene.FacetSets[Host.Scene.RoadEditorBlock.FacetSet].VertexCount > 100000;
                Host.RoadEditor.DriveOnSelectedRoad({ kind: "road", id: "r04" });
            }
            Host.ScriptedInput = { Throttle: 1.0, Brake: 0.0, SteerAngle: 0.0, Handbrake: false, Reverse: false };
        }

        const VehicleUp = RotateVector(Host.Vehicle.Orientation, [0.0, 0.0, 1.0]);
        MinimumVehicleUpZ = Math.min(MinimumVehicleUpZ, VehicleUp[2]);
        MinimumChaseUpZ = Math.min(MinimumChaseUpZ, Host.Chase.Up[2]);
        MaximumAltitudeZ = Math.max(MaximumAltitudeZ, Host.Vehicle.Position[2]);
        if (Frame >= 610 && Frame < 885)
            MinimumSubwayZ = Math.min(MinimumSubwayZ, Host.Vehicle.Position[2]);
        if (Frame >= 1330 && Frame < 1530)
            MinimumThreeLaneSubwayZ = Math.min(MinimumThreeLaneSubwayZ, Host.Vehicle.Position[2]);
        if (Frame >= 1565 && Frame < 2095)
        {
            MinimumConstructionTrenchZ = Math.min(MinimumConstructionTrenchZ, Host.Vehicle.Position[2]);
            if (MinimumConstructionTrenchZ < -3.5 && Host.Vehicle.Position[0] > 54.0 && Host.Vehicle.Position[2] > 0.2)
                ConstructionTrenchExitedUp = true;
        }
        if (Frame >= 2095 && Frame < 2450)
        {
            MinimumDeadEndPitZ = Math.min(MinimumDeadEndPitZ, Host.Vehicle.Position[2]);
            if (Frame === 2449)
                DeadEndBulkheadX = Host.Vehicle.Position[0];
        }
        if (Frame >= 2450 && Frame < 2840 && Host.ServiceStations?.QuerySummary().FuelPercent === 100)
            AutoFuelCompleted = true;
        if (Frame >= 2840 && Frame < 3230 && Host.ServiceStations?.QuerySummary().BatteryPercent === 100)
            AutoEVCompleted = true;
        if (Frame >= 3230 && Frame < 3700)
            MaximumFactoryHallX = Math.max(MaximumFactoryHallX, Host.Vehicle.Position[0]);
        if (Frame >= 3700)
            PeakSplineBridgeZ = Math.max(PeakSplineBridgeZ, Host.Vehicle.Position[2]);
        if (Host.TrafficLights)
        {
            for (const Unit of Host.TrafficLights.Units)
                if (Unit.Active)
                    SeenTrafficAspects.add(Unit.CurrentAspect);
        }
        if (Frame < 610)
            MaximumTrackAX = Math.max(MaximumTrackAX, Host.Vehicle.Position[0]);
        if (VehicleUp[2] < -0.75)
        {
            const Contacts = Host.Vehicle.Wheels.filter((Wheel) => Wheel.Contact).length;
            InvertedWheelContacts = Math.max(InvertedWheelContacts, Contacts);
        }

        if (Host.Bollards)
        {
            const Linear = Host.Bollards.Zones.find((Z) => Z.Id === "linearStrip");
            const Wave   = Host.Bollards.Zones.find((Z) => Z.Id === "waveStrip");
            if (Linear?.Triggered) LinearStripOpened = true;
            if (Wave?.Triggered)   WaveStripOpened = true;
        }

        if (Host.Collapse)
        {
            if (Host.Collapse.Spans[0]?.State === "collapsing")
                BridgeCollapseTriggered = true;
            if (Host.Collapse.Spans[1]?.State === "collapsing")
                RoadCollapseTriggered = true;
            const Vents = Host.Collapse.QuerySmokeEmissions();
            if (Vents.length > 0)
            {
                CollapseSandEmitted = true;
                for (const V of Vents)
                    assert.ok(V.Radius <= 0.35, `Expected crack-bound smoke vent Radius <= 0.35 m, got ${V.Radius}`);
            }
        }

        if (Host.Camera)
        {
            assert.ok(Host.Camera.Position.every(Number.isFinite), "Camera position must stay finite");
            assert.ok(Host.Camera.Up.every(Number.isFinite), "Camera up vector must stay finite");
        }
    },

    Report(Host)
    {
        assert.equal(Host.LevelKey, "inversion");
        assert.equal(Host.LevelDescriptor.Tracks.length, 9);
        assert.ok(MinimumVehicleUpZ < -0.85, `Expected Track A upside-down loop inversion, got minUpZ=${MinimumVehicleUpZ.toFixed(3)}`);
        assert.ok(MaximumAltitudeZ > 15.5, `Expected Track A loop apex > 15.5 m, got maxZ=${MaximumAltitudeZ.toFixed(2)}`);
        assert.ok(InvertedWheelContacts >= 2, `Expected >= 2 loaded wheels upside-down, got ${InvertedWheelContacts}`);
        assert.ok(MinimumChaseUpZ < -0.35, `Expected 3D ChaseCamera to invert with vehicle, got minChaseUpZ=${MinimumChaseUpZ.toFixed(3)}`);
        assert.ok(MaximumTrackAX > 18.0, `Expected Track A circuit flow through 360° Loop onto Camelback Waves past X=18 m, got maxX=${MaximumTrackAX.toFixed(1)}`);
        assert.ok(Number.isFinite(Host.Training.Best.loop360?.Primary), "Expected 360° Helical Loop stunt drill completion time");
        assert.ok(MinimumSubwayZ < -4.2, `Expected Track B Subway Tunnel descent below Z=-4.2 m, got minZ=${MinimumSubwayZ.toFixed(2)}`);
        assert.ok(LinearStripOpened, "Expected Track B Linear Bollard Strip proximity trigger to activate");
        assert.ok(WaveStripOpened, "Expected Track C Travelling-Wave Bollard Strip proximity trigger to activate");
        assert.ok(BridgeCollapseTriggered, "Expected Track D Collapsing Sky-Bridge to trigger and fracture");
        assert.ok(RoadCollapseTriggered, "Expected Track D Collapsing Sinkhole Road to trigger and fracture");
        assert.ok(CollapseSandEmitted, "Expected Track D collapse to emit volumetric sand plumes");
        assert.ok(MinimumThreeLaneSubwayZ < -3.5, `Expected Track E 3-Lane Subway center descent < -3.5 m, got ${MinimumThreeLaneSubwayZ.toFixed(2)}`);
        assert.ok(Host.Trams && Host.Trams.QuerySummary().CarCount === 14, "Expected Track F 14 articulated tram & train cars");
        assert.notEqual(Host.Trams.Consists[0].Cars[0].WorldPosition[0], StartTramLeadX, "Expected Track F trams to advance along rails");
        assert.ok(MinimumConstructionTrenchZ < -3.8 && ConstructionTrenchExitedUp,
                  `Expected Track G Construction Through-Trench descent (${MinimumConstructionTrenchZ.toFixed(2)} m) AND surface exit`);
        assert.ok(MinimumDeadEndPitZ < -3.8 && DeadEndBulkheadX < 33.0,
                  `Expected Track G Dead-End Pit descent (${MinimumDeadEndPitZ.toFixed(2)} m) & bulkhead stop at X<=33 m (got ${DeadEndBulkheadX.toFixed(1)})`);
        assert.equal(Host.Drones, undefined, "Expected flying drones to be completely removed");
        assert.ok(Host.DrivingHud && Host.DrivingHud.SpatialGrid.size >= 15,
                  "Expected Interactive 2D+3D DrivingHudSequence with O(1) spatial proximity grid");
        assert.equal(Host.DrivingHud.QueryDisplayMode(), "chase",
                     "Expected DrivingHudSequence active in Chase camera mode");
        assert.ok(Host.ServiceStations && Host.ServiceStations.FactoryRobots.length === 4,
                  "Expected 4 Megafactory assembly-line industrial robot arms");
        assert.ok(AutoFuelCompleted, "Expected Track H Automatic Fuel Bay industrial robot arm to refill tank to 100%");
        assert.ok(AutoEVCompleted, "Expected Track H Automatic 800V EV Bay industrial robot arm to charge battery to 100%");
        assert.ok(MaximumFactoryHallX > 124.0,
                  `Expected Track H Megafactory drive-through past East portal X=124 m, got maxX=${MaximumFactoryHallX.toFixed(1)}`);
        assert.ok(RoadEditorStreamed, "Expected RoadEditorSequence to stream >100k Road Studio vertices to WebGPU");
        assert.ok(PeakSplineBridgeZ > 6.5 && Host.Vehicle.Position[2] > 6.0 && Host.Vehicle.Position[1] < -8.0,
                  `Expected ControlVehicle to drive supported across elevated Road Studio Steel I-Girder Viaduct (>6.0 m), got peakZ=${PeakSplineBridgeZ.toFixed(2)}, endPos=[${Host.Vehicle.Position.map((V) => V.toFixed(1)).join(", ")}]`);
        for (const ExpectedAspect of ["GREEN", "YELLOW", "ORANGE", "RED"])
            assert.ok(SeenTrafficAspects.has(ExpectedAspect), `Expected Hovering Intersection Traffic Lights to display ${ExpectedAspect}`);
        console.log(`9-track inversion arena: Track A loop (${Host.Training.Best.loop360.Primary.toFixed(2)} s) · Track B/C boolean bollards · Track D Voronoi collapse+crack-bound smoke · Track E 3-lane subway · Track F 14 railcars · Track G construction thru-trench + dead-end pit · Track H megafactory (4 welding industrial robots) + auto-fuel (100%) + auto-EV (100%) industrial robot arms · Track I Road Studio workspace & highway viaduct (peak Z=${PeakSplineBridgeZ.toFixed(2)} m) · hovering 4-lamp traffic lights (R/O/Y/G) ACTIVE`);
    }
};

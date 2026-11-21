//============================================================================================================================================
//                                                          VEHICLECOMPONENTS.JSX
//============================================================================================================================================
// 🚗 The Vehicle folder: the Component Viewer's ControlVehicle class (Vehicle Movement, Static Mesh body, Sockets, Collision, Lights) as
// outliner rows with their own inspectors. Component data, defaults and socket parameters come straight from
// Experimental/ComponentViewer (Blueprint.js, Sockets.js); the icons are the baked EngineContent set. Browser authoring only.

import React, { useEffect, useRef, useState } from "react";
import { COMPONENT_CLASSES, VEHICLE_SHEET, createComponent } from "../ComponentViewer/Blueprint.js";
import { SOCKET_KINDS, SOCKET_KIND, SOCKET_FIELDS, SOCKET_PARAMS, DRIVES, DOCK_COLORS, socketDefaults, poseLabel, createSocketState, stepSocket, socketReadout } from "../ComponentViewer/Sockets.js";

export const VehiclePanel = "vehicle-component";
export const VehicleSheet = [];

// Id, name, component class, baked icon, description, extra row fields.
const Components = [
  ["vehicle-movement", "Vehicle Movement", "VehicleMovement", "arcade-joystick", "Chassis, suspension, powertrain and aero"],
  ["vehicle-body", "Body", "StaticMesh", "editor-mesh", "Static Mesh · body shell"],
  ["vehicle-suspension", "Front Suspension", "Socket", "editor-pivot", "Spring socket · front axle", { Joint: "spring", Mount: 1.7 }],
  ["vehicle-steering", "Steering", "Socket", "editor-pivot", "Hinge socket · steering knuckle", { Joint: "hinge", Mount: 1.7 }],
  ["vehicle-tow", "Tow Hitch", "Socket", "editor-pivot", "Dock socket · trailer coupling", { Joint: "dock", Mount: -2.6 }],
  ["vehicle-collision", "Chassis Collision", "BoxCollision", "editor-box-collider", "Box collision · blocks all"],
  ["vehicle-bumper", "Bumper Trigger", "SphereCollision", "editor-trigger", "Sphere collision · overlap events", { Trigger: true }],
  ["vehicle-headlights", "Headlights", "SpotLight", "editor-spotlight", "Spot light pair"],
  ["vehicle-brake", "Brake Lights", "PointLight", "editor-brake-light", "Point light pair · rear"],
];
export const VehicleFolder = { Id: "vehicle", Name: "Vehicle", Panel: "group", Icon: "editor-prefab", Parent: null, Description: "Component class · Control Vehicle" };
export const VehicleRows = Components.map(([Id, Name, Component, Icon, Description, Extra = {}]) => ({
  Id,
  Name,
  Panel: VehiclePanel,
  Icon,
  Parent: "vehicle",
  Description,
  Component,
  ...Extra,
}));

// Runs once per saved scene (VehicleRevision), so a later deletion is respected.
export function EnsureVehicleFolder(Rows = [], Revision) {
  if (Revision === 1 || !Array.isArray(Rows) || Rows.some((Row) => Row?.Id === "vehicle")) return Rows;
  return [...Rows, { ...VehicleFolder }, ...VehicleRows.map((Row) => ({ ...Row }))];
}

// Socket mounts for rows saved before rows carried one (metres ahead of the wheelbase centre).
const DefaultMounts = { "vehicle-suspension": 1.7, "vehicle-steering": 1.7, "vehicle-tow": -2.6 };
const MountOf = (Row) => Row.Mount ?? DefaultMounts[Row.Id] ?? 0;

// Defaults straight from the Component Viewer's classes.
const DefaultCache = new Map();
function Defaults(Row) {
  const Key = Row.Component + ":" + (Row.Joint || "") + ":" + MountOf(Row) + (Row.Trigger ? ":t" : "");
  if (!DefaultCache.has(Key)) {
    const Props = createComponent(Row.Component, Row.Name).props;
    if (Row.Component === "Socket") Object.assign(Props, socketDefaults(Row.Joint || "fixed"), Row.Joint === "hinge" ? { angleMin: -35, angleMax: 35 } : {}, { mount: MountOf(Row) });
    if (Row.Component === "BoxCollision") Props.extent = [2.3, 0.7, 1.0];
    if (Row.Component === "SphereCollision") Object.assign(Props, { radius: 0.6, trigger: !!Row.Trigger });
    if (Row.Component === "StaticMesh") Object.assign(Props, { mass: 0, slots: {} });
    DefaultCache.set(Key, Props);
  }
  return DefaultCache.get(Key);
}
const Reader = (Row, Values) => (Key) => (Values[Key] === undefined ? Defaults(Row)[Key] : Values[Key]);

export function VehicleSummary(Row, Values = {}) {
  const V = Reader(Row, Values);
  switch (Row.Component) {
    case "VehicleMovement":
      return `${Math.round(V("mass"))} kg · ${V("wheels")?.length || 4} wheels`;
    case "Socket":
      return `${SOCKET_KIND[V("kind")]?.label || "Fixed"} socket · ${MountSpot(+V("mount") || 0)}`;
    case "BoxCollision":
      return (V("extent") || [0, 0, 0]).map((Each) => (+Each * 2).toFixed(1)).join(" × ") + " m";
    case "SphereCollision":
      return `r ${(+V("radius")).toFixed(2)} m${V("trigger") ? " · trigger" : ""}`;
    case "SpotLight":
      return `${(+V("intensity")).toFixed(0)} cd · ${V("angle")}°`;
    case "PointLight":
      return `${(+V("intensity")).toFixed(1)} cd · ${(+V("range")).toFixed(0)} m`;
    default:
      return V("lod") < 0 ? "Automatic LOD" : `LOD ${V("lod")}`;
  }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SHARED PIECES
//------------------------------------------------------------------------------------------------------------------------

const Wheelbase = VEHICLE_SHEET.axleMount[0][0] - VEHICLE_SHEET.axleMount[2][0];
const Track = VEHICLE_SHEET.axleMount[0][1] - VEHICLE_SHEET.axleMount[1][1];
const Gravity = 9.81;
const Fixed = (Amount, Digits = 0) => (Number.isFinite(Amount) ? Amount.toLocaleString("en-US", { minimumFractionDigits: Digits, maximumFractionDigits: Digits }) : "–");
const Lerp = (A, B, T) => A + (B - A) * T;

function Slider({ Kit, V, Write, Key, Label, Minimum, Maximum, Step = 0.01, Unit = "" }) {
  const Decimals = Math.max(0, Math.min(3, Math.ceil(-Math.log10(Step) - 1e-9)));
  return <Kit.Control Field={{ Label, Minimum, Maximum, Decimals, Unit, Default: V(Key) }} Value={V(Key)} Change={(Next) => Write(Key, Next)} />;
}
const ClassField = (Type, Key) => COMPONENT_CLASSES[Type].props.find((Each) => Each.key === Key) || {};
function ClassSlider({ Kit, V, Write, Type, Key, Label }) {
  const Field = ClassField(Type, Key);
  return <Slider Kit={Kit} V={V} Write={Write} Key={Key} Label={Label || Field.label} Minimum={Field.min} Maximum={Field.max} Step={Field.step} Unit={Field.unit} />;
}
function Readouts({ Kit, Rows }) {
  return (
    <div className="vc-readouts">
      {Rows.map(([Label, Value]) => (
        <Kit.Control key={Label} Field={{ Label, Control: "Readout" }} Value={Value} />
      ))}
    </div>
  );
}

// Side view of the car on its axles, shared by the chassis and body cards.
function SideView({ children, Height = 150, Label = "Vehicle side view", Handlers = {} }) {
  return (
    <svg className="vc-visual" viewBox={`0 0 320 ${Height}`} role="img" aria-label={Label} {...Handlers}>
      <line x1="10" x2="310" y1={Height - 22} y2={Height - 22} stroke="#ffffff1c" />
      <path
        d={`M38 ${Height - 44} L44 ${Height - 66} Q60 ${Height - 72} 96 ${Height - 76} L124 ${Height - 104} Q140 ${Height - 112} 196 ${Height - 110} L232 ${Height - 80} Q272 ${Height - 76} 284 ${Height - 68} L286 ${Height - 44} Z`}
        fill="#2a2a2a"
        stroke="#9a9a9a"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {[86, 238].map((X) => (
        <g key={X}>
          <circle cx={X} cy={Height - 40} r="18" fill="#111" stroke="#bdbdbd" strokeWidth="1.4" />
          <circle cx={X} cy={Height - 40} r="6" fill="none" stroke="#777" />
        </g>
      ))}
      {children}
    </svg>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   VEHICLE MOVEMENT
//------------------------------------------------------------------------------------------------------------------------

function TorqueAt(Curve, Rpm) {
  if (Rpm <= Curve[0][0]) return Curve[0][1];
  for (let Index = 1; Index < Curve.length; Index++)
    if (Rpm <= Curve[Index][0]) {
      const [R0, T0] = Curve[Index - 1], [R1, T1] = Curve[Index];
      return Lerp(T0, T1, (Rpm - R0) / (R1 - R0));
    }
  return Curve[Curve.length - 1][1];
}

function MovementInspector({ Kit, V, Write }) {
  const { Card, Metric } = Kit;
  const Mass = +V("mass"), Front = +V("frontWeight") / 100, Com = +V("comHeight");
  const FrontLoad = Mass * Front, RearLoad = Mass - FrontLoad;
  // Chassis: CoM sits between the axles at the front-weight split; its height scales from the ground line.
  const AxleFront = 238, AxleRear = 86, ComX = Lerp(AxleRear, AxleFront, Front), ComY = 128 - Com * 110;
  const Steer = +V("maxSteer"), Radius = +V("tyreRadius");
  const TurnRadius = Wheelbase / Math.tan(Steer) + Track / 2;
  const Hz = +V("springHz"), Zeta = +V("dampingRatio");
  const Corner = Mass / 4, Stiffness = Corner * (2 * Math.PI * Hz) ** 2;
  const Curve = V("torqueCurve") || VEHICLE_SHEET.torqueCurve;
  const Idle = +V("idleRpm"), Redline = +V("redlineRpm"), Drive = +V("finalDrive");
  const PeakTorque = Math.max(...Curve.map((Point) => Point[1]));
  let PeakPower = 0, PeakPowerRpm = 0;
  for (let Rpm = Idle; Rpm <= Redline; Rpm += 50) {
    const Power = (TorqueAt(Curve, Rpm) * Rpm * 2 * Math.PI) / 60 / 1000;
    if (Power > PeakPower) (PeakPower = Power), (PeakPowerRpm = Rpm);
  }
  const TopGear = VEHICLE_SHEET.gearRatios[VEHICLE_SHEET.gearRatios.length - 1];
  const GearedTop = ((Redline / 60) * 2 * Math.PI * Radius) / (TopGear * Drive) * 3.6;
  const Drag = +V("dragArea"), Lift = +V("liftArea"), Rho = VEHICLE_SHEET.airDensity;
  // Speed where drag + rolling resistance absorb peak wheel power.
  let PowerTop = 0;
  for (let Speed = 1; Speed < 120; Speed += 0.25) {
    const Need = (0.5 * Rho * Drag * Speed ** 3 + VEHICLE_SHEET.rollingResistance * Mass * Gravity * Speed) / 1000;
    if (Need > PeakPower * VEHICLE_SHEET.driveEfficiency) break;
    PowerTop = Speed * 3.6;
  }
  // Step response of the suspension (unit bump), 0–2 s.
  const Response = Array.from({ length: 121 }, (_, Index) => {
    const T = (Index / 120) * 2, W = 2 * Math.PI * Hz;
    if (Zeta < 1) {
      const Wd = W * Math.sqrt(1 - Zeta * Zeta);
      return 1 - Math.exp(-Zeta * W * T) * (Math.cos(Wd * T) + ((Zeta * W) / Wd) * Math.sin(Wd * T));
    }
    return 1 - Math.exp(-W * T) * (1 + W * T);
  });
  const Settle = 4 / Math.max(0.01, Zeta * 2 * Math.PI * Hz);
  const Overshoot = Zeta < 1 ? Math.exp((-Zeta * Math.PI) / Math.sqrt(1 - Zeta * Zeta)) * 100 : 0;
  return (
    <>
      <Card Title="Chassis & mass" Class="vc-card">
        <SideView>
          <line x1={AxleRear} x2={AxleRear} y1="128" y2={128 - (RearLoad / Mass) * 70} stroke="#7cb7ff" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
          <line x1={AxleFront} x2={AxleFront} y1="128" y2={128 - (FrontLoad / Mass) * 70} stroke="#ff9f5a" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
          <line x1={ComX} x2={ComX} y1={ComY} y2="128" stroke="#ffffff40" strokeDasharray="3 3" />
          <circle cx={ComX} cy={ComY} r="7" fill="none" stroke="#f2f2f2" strokeWidth="1.5" />
          <path d={`M${ComX - 7} ${ComY}h14M${ComX} ${ComY - 7}v14`} stroke="#f2f2f2" strokeWidth="1.2" />
          <text x={ComX + 10} y={ComY - 8}>CoM {Com.toFixed(2)} m</text>
          <text x={AxleRear} y="146" textAnchor="middle">{Fixed(RearLoad)} kg</text>
          <text x={AxleFront} y="146" textAnchor="middle">{Fixed(FrontLoad)} kg</text>
        </SideView>
        <Metric Value={Fixed(Mass)} Unit="kg" Caption={`${Fixed(Front * 100, 1)} % on the front axle · wheelbase ${Wheelbase.toFixed(2)} m`} />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="mass" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="frontWeight" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="comHeight" />
        <Readouts Kit={Kit} Rows={[["Static load per front wheel", Fixed((FrontLoad / 2) * Gravity) + " N"], ["Static load per rear wheel", Fixed((RearLoad / 2) * Gravity) + " N"], ["Rollover threshold", Fixed(Track / (2 * Com), 2) + " g"]]} />
      </Card>
      <Card Title="Wheels & steering" Class="vc-card">
        <svg className="vc-visual" viewBox="0 0 320 170" role="img" aria-label="Wheel plan and steering lock">
          <rect x="110" y="20" width="100" height="130" rx="22" fill="#232323" stroke="#8a8a8a" />
          {[[96, 46, true], [224, 46, true], [96, 124, false], [224, 124, false]].map(([X, Y, Steers], Index) => (
            <g key={Index} transform={`translate(${X} ${Y}) rotate(${Steers ? (-Steer * 180) / Math.PI : 0})`}>
              <rect x="-7" y={-Radius * 34} width="14" height={Radius * 68} rx="4" fill="#111" stroke="#cfcfcf" strokeWidth="1.3" />
            </g>
          ))}
          <path d={`M96 46 L${96 - Math.sin(Steer) * 46} ${46 - Math.cos(Steer) * 46}`} stroke="#ff9f5a" strokeDasharray="3 3" />
          <text x="40" y="18">{((Steer * 180) / Math.PI).toFixed(0)}° lock</text>
          <text x="160" y="164" textAnchor="middle">track {Track.toFixed(2)} m</text>
        </svg>
        <Metric Value={Fixed(TurnRadius, 1)} Unit="m turning radius" Caption={`${(V("wheels")?.length || 4)} wheels · tyre Ø ${(Radius * 2).toFixed(2)} m`} />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="maxSteer" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="tyreRadius" />
      </Card>
      <Card Title="Suspension" Class="vc-card">
        <svg className="vc-visual" viewBox="0 0 320 130" role="img" aria-label="Suspension step response">
          <line x1="20" x2="310" y1="40" y2="40" stroke="#ffffff22" strokeDasharray="3 4" />
          <line x1="20" x2="310" y1="110" y2="110" stroke="#ffffff22" />
          <path d={Response.map((Value, Index) => (Index ? "L" : "M") + (20 + (Index / 120) * 290).toFixed(1) + " " + (110 - Value * 70).toFixed(1)).join("")} fill="none" stroke="#5fe0a0" strokeWidth="1.8" />
          {Settle < 2 && <line x1={20 + (Settle / 2) * 290} x2={20 + (Settle / 2) * 290} y1="20" y2="110" stroke="#ffffff30" strokeDasharray="2 3" />}
          <text x="20" y="124">0 s</text>
          <text x="310" y="124" textAnchor="end">2 s · body after a bump</text>
        </svg>
        <Metric Value={Fixed(Overshoot, 1)} Unit="% overshoot" Caption={`Settles in ${Fixed(Settle, 2)} s`} />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="springHz" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="dampingRatio" />
        <Readouts Kit={Kit} Rows={[["Spring rate per corner", Fixed(Stiffness / 1000, 1) + " kN/m"], ["Damping per corner", Fixed((2 * Zeta * Math.sqrt(Stiffness * Corner)) / 1000, 2) + " kN·s/m"]]} />
      </Card>
      <Card Title="Powertrain" Class="vc-card">
        <svg className="vc-visual" viewBox="0 0 320 140" role="img" aria-label="Torque and power curve">
          {(() => {
            const MaxRpm = 9000, X = (Rpm) => 24 + (Rpm / MaxRpm) * 286, Yt = (T) => 116 - (T / 600) * 96, Yp = (P) => 116 - (P / 450) * 96;
            const Torque = [], Power = [];
            for (let Rpm = Curve[0][0]; Rpm <= Math.min(MaxRpm, Curve[Curve.length - 1][0]); Rpm += 100) {
              Torque.push(`${X(Rpm).toFixed(1)} ${Yt(TorqueAt(Curve, Rpm)).toFixed(1)}`);
              Power.push(`${X(Rpm).toFixed(1)} ${Yp((TorqueAt(Curve, Rpm) * Rpm * 2 * Math.PI) / 60 / 1000).toFixed(1)}`);
            }
            return (
              <>
                <rect x={X(Idle)} y="20" width={Math.max(0, X(Redline) - X(Idle))} height="96" fill="#ffffff06" />
                <line x1={X(Redline)} x2={X(Redline)} y1="16" y2="116" stroke="#ff6b6b" strokeDasharray="3 3" />
                <line x1="24" x2="310" y1="116" y2="116" stroke="#ffffff22" />
                <path d={"M" + Torque.join("L")} fill="none" stroke="#ff9f5a" strokeWidth="1.8" />
                <path d={"M" + Power.join("L")} fill="none" stroke="#7cb7ff" strokeWidth="1.8" strokeDasharray="5 3" />
                <text x={X(Redline) - 4} y="14" textAnchor="end">redline {Fixed(Redline)}</text>
                <text x="24" y="132">{Fixed(Idle)} rpm idle</text>
                <text x="310" y="132" textAnchor="end">torque solid · power dashed</text>
              </>
            );
          })()}
        </svg>
        <Metric Value={Fixed(PeakPower)} Unit="kW peak" Caption={`${Fixed(PeakTorque)} N·m peak torque · ${Fixed(PeakPower * 1.341)} hp at ${Fixed(PeakPowerRpm)} rpm`} />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="finalDrive" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="idleRpm" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="redlineRpm" />
        <Readouts Kit={Kit} Rows={[["Gears", VEHICLE_SHEET.gearRatios.map((Ratio) => Ratio.toFixed(1)).join(" · ")], ["Top gear at redline", Fixed(GearedTop) + " km/h"]]} />
      </Card>
      <Card Title="Aerodynamics" Class="vc-card">
        <svg className="vc-visual" viewBox="0 0 320 130" role="img" aria-label="Drag and downforce against speed">
          {(() => {
            const X = (Kmh) => 24 + (Kmh / 300) * 286, Y = (Newtons) => 110 - (Newtons / 6000) * 92;
            const Line = (Area) => Array.from({ length: 61 }, (_, Index) => {
              const Kmh = Index * 5, Speed = Kmh / 3.6;
              return `${X(Kmh).toFixed(1)} ${Math.max(14, Y(0.5 * Rho * Area * Speed * Speed)).toFixed(1)}`;
            });
            return (
              <>
                <line x1="24" x2="310" y1="110" y2="110" stroke="#ffffff22" />
                <path d={"M" + Line(Drag).join("L")} fill="none" stroke="#ff9f5a" strokeWidth="1.8" />
                <path d={"M" + Line(Lift).join("L")} fill="none" stroke="#5fe0a0" strokeWidth="1.8" strokeDasharray="5 3" />
                {PowerTop > 0 && <line x1={X(PowerTop)} x2={X(PowerTop)} y1="14" y2="110" stroke="#ffffff35" strokeDasharray="2 3" />}
                <text x="24" y="124">0</text>
                <text x="310" y="124" textAnchor="end">300 km/h · drag solid · downforce dashed</text>
              </>
            );
          })()}
        </svg>
        <Metric Value={Fixed(PowerTop)} Unit="km/h drag-limited" Caption="Where drag and rolling resistance use all the wheel power" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="dragArea" />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="VehicleMovement" Key="liftArea" />
        <Readouts Kit={Kit} Rows={[["Drag at 100 km/h", Fixed(0.5 * Rho * Drag * (100 / 3.6) ** 2) + " N"], ["Downforce at 200 km/h", Fixed(0.5 * Rho * Lift * (200 / 3.6) ** 2) + " N"]]} />
      </Card>
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SOCKETS
//------------------------------------------------------------------------------------------------------------------------

// A socket inspector is four cards: the live study (the joint moving through a test drive, with a 6 s trace), the socket type,
// the range the joint may move through, and where the socket sits on the car. The study runs the Component Viewer's own
// stepSocket, so what moves here is what moves in Simulate.

const Degree = Math.PI / 180;
const TraceSeconds = 6;
const DriveLoop = 10;
const SocketCentre = 162, PixelsPerMetre = 152 / Wheelbase; // SideView axles sit at x 86 (rear) and 238 (front).

// Test drive the study rides through: accelerate, cruise, brake, stand. The socket sees the acceleration, speed, road
// distance and aero load (Vehicle Movement's default lift area) that Simulate would feed it.
function DrivePhase(Time) {
  const Phase = Time % DriveLoop;
  if (Phase < 3) return { Accel: 3.5, Name: "Accelerating" };
  if (Phase < 6) return { Accel: 0, Name: "Cruising" };
  if (Phase < 8) return { Accel: -5.25, Name: "Braking" };
  return { Accel: 0, Name: "Standing" };
}

// The single number each socket kind is about, with the range it may take.
function Quantity(P, S) {
  switch (P.kind) {
    case "hinge":
      return { Value: S.angle, Low: Math.min(P.angleMin, P.angleMax), High: Math.max(P.angleMin, P.angleMax), Unit: "°", Digits: 0, Caption: `steered angle · ${P.angleMin}° to ${P.angleMax}°` };
    case "slider":
      return { Value: S.travel * 1000, Low: Math.min(P.travelMin, P.travelMax) * 1000, High: Math.max(P.travelMin, P.travelMax) * 1000, Unit: "mm", Digits: 0, Caption: "along the rail from the mount" };
    case "ball":
      return { Value: S.theta / Degree, Low: 0, High: P.cone, Unit: "°", Digits: 0, Caption: `tilt inside the ${P.cone}° cone` };
    case "spring":
      return { Value: S.x * 1000, Low: -P.springTravel * 1000, High: P.springTravel * 1000, Unit: "mm", Digits: 0, Caption: S.x > 0.0005 ? "compressed toward the bump stop" : S.x < -0.0005 ? "extended toward full droop" : "at ride height" };
    case "spin": {
      const Peak = P.spinSource === "vehicle" ? (10.5 / Math.max(0.05, P.spinRadius)) * (60 / (2 * Math.PI)) : Math.max(10, Math.abs(P.rpm));
      return { Value: ((S.rate || 0) * 60) / (2 * Math.PI), Low: -Peak, High: Peak, Unit: "rpm", Digits: 0, Caption: P.spinSource === "vehicle" ? "follows the test drive's road speed" : "fixed rate" };
    }
    case "tether":
      return { Value: S.theta / Degree, Low: -90, High: 90, Unit: "°", Digits: 0, Caption: S.theta > 0 ? "trailing backwards" : S.theta < 0 ? "swinging forwards" : "hanging straight" };
    case "dock":
      return { Value: S.dock.load / 1000, Low: 0, High: (P.breakForce * 1.2) / 1000, Unit: "kN", Digits: 2, Caption: `${S.dock.phase || "released"} · breaks at ${(P.breakForce / 1000).toFixed(2)} kN` };
  }
  return { Value: 0, Low: -1, High: 1, Unit: "", Digits: 0, Caption: "children ride along exactly" };
}

// Steps the socket every frame. The test drive only advances while it runs; parked, springs and pendulums still settle.
function useSocketMotion(P, Mount, Running) {
  const Motion = useRef(null);
  if (!Motion.current) Motion.current = { S: createSocketState(), Drive: { T: 0, Speed: 0, Distance: 0, Accel: 0, Name: "Parked" }, Trace: [], Events: [], Clock: 0, Peak: 0 };
  const Latest = useRef(null);
  Latest.current = { P, Mount, Running };
  const [, Repaint] = useState(0);
  useEffect(() => {
    Motion.current.S = createSocketState();
    Motion.current.Trace = [];
    Motion.current.Events = [];
    Motion.current.Peak = 0;
  }, [P.kind]);
  useEffect(() => {
    Motion.current.S.thetaInit = false;
  }, [P.swing, P.length]);
  useEffect(() => {
    let Handle = 0, Last = performance.now();
    const Advance = (Now) => {
      const Dt = Math.min(0.05, Math.max(0, (Now - Last) / 1000));
      Last = Now;
      const { P, Mount, Running } = Latest.current;
      const M = Motion.current, Drive = M.Drive;
      if (Running) {
        const Before = Drive.T % DriveLoop;
        Drive.T += Dt;
        if (Drive.T % DriveLoop < Before) Drive.Speed = 0;
        Object.assign(Drive, DrivePhase(Drive.T));
        Drive.Speed = Math.max(0, Drive.Speed + Drive.Accel * Dt);
        Drive.Distance += Drive.Speed * Dt;
      } else Object.assign(Drive, { Accel: 0, Speed: 0, Name: "Parked" });
      const Raised = stepSocket(M.S, P, Dt, {
        simulate: Running,
        accel: Drive.Accel,
        speed: Drive.Speed,
        distance: Drive.Distance,
        along: Mount,
        downforce: 0.5 * 1.225 * 1.1 * Drive.Speed ** 2,
        accepts: true,
      });
      M.Clock += Dt;
      Raised.forEach((Event) => M.Events.unshift({ ...Event, At: M.Clock }));
      M.Events.length = Math.min(M.Events.length, 4);
      const Q = Quantity(P, M.S);
      M.Peak = Math.max(M.Peak * Math.exp(-Dt * 0.4), Math.abs(P.kind === "tether" ? M.S.theta : 0));
      M.Trace.push([M.Clock, Q.Value, Drive.Speed]);
      while (M.Trace.length && M.Trace[0][0] < M.Clock - TraceSeconds) M.Trace.shift();
      Repaint((Count) => (Count + 1) & 0xffff);
      Handle = requestAnimationFrame(Advance);
    };
    Handle = requestAnimationFrame(Advance);
    return () => cancelAnimationFrame(Handle);
  }, []);
  const Restart = () => {
    Object.assign(Motion.current, { S: createSocketState(), Trace: [], Events: [], Peak: 0 });
    Object.assign(Motion.current.Drive, { T: 0, Speed: 0, Distance: 0, Accel: 0 });
  };
  return [Motion.current, Restart];
}

// Small drawn glyph per socket kind, for the type picker.
export function SocketGlyph({ Variant, Size = 22 }) {
  const Paths = {
    fixed: (
      <>
        <path d="M12 3.5l7.4 4.2v8.6L12 20.5l-7.4-4.2V7.7z" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
    hinge: (
      <>
        <path d="M7 17L17.5 7.5" strokeWidth="2.4" />
        <path d="M7 17h12" strokeDasharray="2 2.4" />
        <path d="M14.5 17a7.5 7.5 0 0 0-2-5.2" />
        <circle cx="7" cy="17" r="2.2" />
      </>
    ),
    slider: (
      <>
        <path d="M3.5 12h17M3.5 8.5v7M20.5 8.5v7" />
        <rect x="9" y="8" width="6" height="8" rx="1.8" />
      </>
    ),
    ball: (
      <>
        <path d="M12 16.5L6.5 5.5M12 16.5l5.5-11" strokeDasharray="2 2" />
        <path d="M12 16.5L14.6 6" strokeWidth="2.2" />
        <circle cx="12" cy="17.5" r="3" />
      </>
    ),
    spring: <path d="M7 4h10M7 20h10M12 4l4 2.3-8 2.6 8 2.6-8 2.6 8 2.6-4 2.3" />,
    spin: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 1 1-2.1-5" />
        <path d="M17.5 3.5v4h-4" />
      </>
    ),
    tether: (
      <>
        <path d="M5 4h14M12 4l3.6 10.5" />
        <circle cx="16.4" cy="17" r="2.6" />
      </>
    ),
    dock: (
      <>
        <path d="M3.5 7.5h6.5v9H3.5z" />
        <path d="M14 7.5h6.5v9H14z" />
        <path d="M10 12h1.3M12.7 12H14" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={Size} height={Size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Paths[Variant] || Paths.fixed}
    </svg>
  );
}

// Where a socket sits along the car, in words.
function MountSpot(Mount) {
  const Axle = Wheelbase / 2;
  if (Math.abs(Mount - Axle) < 0.25) return "front axle";
  if (Math.abs(Mount + Axle) < 0.25) return "rear axle";
  if (Mount > 2.2) return "front bumper";
  if (Mount < -2.2) return "rear bumper";
  if (Math.abs(Mount) < 0.3) return "centre of the wheelbase";
  return `${Math.abs(Mount).toFixed(2)} m ${Mount > 0 ? "ahead of" : "behind"} centre`;
}

// The joint itself, drawn from the live state. Returns the drawing and how a drag on it maps back to properties.
const Pivot = { X: 160, Y: 72 };
const HingePivot = { X: 160, Y: 100 };
function SocketScene({ P, S, Colour, Peak }) {
  const Arc = (Cx, Cy, From, To, R) => {
    const A = ((From - 90) * Math.PI) / 180, B = ((To - 90) * Math.PI) / 180;
    return `M${Cx + Math.cos(A) * R} ${Cy + Math.sin(A) * R} A${R} ${R} 0 ${Math.abs(To - From) > 180 ? 1 : 0} 1 ${Cx + Math.cos(B) * R} ${Cy + Math.sin(B) * R}`;
  };
  const Polar = (Cx, Cy, Angle, R) => [Cx + Math.sin(Angle * Degree) * R, Cy - Math.cos(Angle * Degree) * R];
  switch (P.kind) {
    case "hinge": {
      const Pivot = HingePivot;
      const Low = Math.min(P.angleMin, P.angleMax), High = Math.max(P.angleMin, P.angleMax);
      const Target = Lerp(P.angleMin, P.angleMax, P.pose);
      const [Tx, Ty] = Polar(Pivot.X, Pivot.Y, S.angle, 58), [Gx, Gy] = Polar(Pivot.X, Pivot.Y, Target, 58);
      const [Lx, Ly] = Polar(Pivot.X, Pivot.Y, Low, 70), [Hx, Hy] = Polar(Pivot.X, Pivot.Y, High, 70);
      return (
        <>
          <path d={`M${Pivot.X} ${Pivot.Y} ${Arc(Pivot.X, Pivot.Y, Low, High, 58).replace(/^M/, "L")} Z`} fill={Colour + "1c"} stroke={Colour} strokeDasharray="3 3" />
          {P.drive === "sweep" && <line x1={Pivot.X} y1={Pivot.Y} x2={Gx} y2={Gy} stroke="#ffffff40" strokeDasharray="2 3" />}
          <line x1={Pivot.X} y1={Pivot.Y} x2={Tx} y2={Ty} stroke="#ededed" strokeWidth="9" strokeLinecap="round" className="vc-grip" />
          <circle cx={Pivot.X} cy={Pivot.Y} r="7" fill="#1b1b1b" stroke={Colour} strokeWidth="2" />
          <text x={Lx} y={Ly + 4} textAnchor="middle">{Low}°</text>
          <text x={Hx} y={Hy + 4} textAnchor="middle">{High}°</text>
        </>
      );
    }
    case "slider": {
      const Low = Math.min(P.travelMin, P.travelMax), High = Math.max(P.travelMin, P.travelMax), Span = Math.max(0.01, High - Low);
      const X = (Travel) => 50 + ((Travel - Low) / Span) * 220;
      return (
        <>
          <line x1="50" x2="270" y1={Pivot.Y} y2={Pivot.Y} stroke={Colour} strokeWidth="5" strokeLinecap="round" opacity="0.45" />
          {[Low, High].map((Stop) => (
            <g key={Stop}>
              <line x1={X(Stop)} x2={X(Stop)} y1={Pivot.Y - 18} y2={Pivot.Y + 18} stroke="#8a8a8a" strokeWidth="2" />
              <text x={X(Stop)} y={Pivot.Y + 34} textAnchor="middle">{Stop.toFixed(2)} m</text>
            </g>
          ))}
          {P.drive === "sweep" && <rect x={X(Lerp(P.travelMin, P.travelMax, P.pose)) - 13} y={Pivot.Y - 15} width="26" height="30" rx="8" fill="none" stroke="#ffffff40" strokeDasharray="2 3" />}
          <rect x={X(S.travel) - 13} y={Pivot.Y - 15} width="26" height="30" rx="8" fill="#ededed" className="vc-grip" />
        </>
      );
    }
    case "ball": {
      const Base = { X: 160, Y: 114 }, Length = 86, Cone = P.cone * Degree, Squash = 0.28;
      const Mouth = { X: Base.X, Y: Base.Y - Length * Math.cos(Cone), R: Length * Math.sin(Cone) };
      const Tip = [Base.X + Length * Math.sin(S.theta) * Math.cos(S.phi), Base.Y - Length * Math.cos(S.theta) + Length * Math.sin(S.theta) * Math.sin(S.phi) * Squash];
      return (
        <>
          <path d={`M${Base.X} ${Base.Y} L${Mouth.X - Mouth.R} ${Mouth.Y} M${Base.X} ${Base.Y} L${Mouth.X + Mouth.R} ${Mouth.Y}`} stroke={Colour} strokeDasharray="3 3" />
          <ellipse cx={Mouth.X} cy={Mouth.Y} rx={Mouth.R} ry={Mouth.R * Squash} fill={Colour + "1c"} stroke={Colour} />
          <line x1={Base.X} y1={Base.Y} x2={Tip[0]} y2={Tip[1]} stroke="#ededed" strokeWidth="5" strokeLinecap="round" />
          <circle cx={Tip[0]} cy={Tip[1]} r="7" fill="#ededed" className="vc-grip" />
          <circle cx={Base.X} cy={Base.Y} r="10" fill="#1b1b1b" stroke={Colour} strokeWidth="2" />
        </>
      );
    }
    case "spring": {
      const Neutral = 74, Scale = 38 / Math.max(0.005, P.springTravel), Base = 124;
      const Top = Neutral - S.x * Scale, Rest = Neutral - Lerp(-P.springTravel, P.springTravel, P.pose) * 0.5 * Scale;
      const Coils = 7, From = Top + 9, To = Base - 2;
      const Zig = Array.from({ length: Coils * 2 + 1 }, (_, Index) => `${160 + (Index && Index < Coils * 2 ? (Index % 2 ? 20 : -20) : 0)} ${From + (Index / (Coils * 2)) * (To - From)}`);
      return (
        <>
          <line x1="226" x2="226" y1={Neutral - 38} y2={Neutral + 38} stroke="#ffffff26" />
          {[
            [Neutral - 38, "bump stop"],
            [Neutral, "ride height"],
            [Neutral + 38, "full droop"],
          ].map(([Y, Name]) => (
            <g key={Name}>
              <line x1="221" x2="231" y1={Y} y2={Y} stroke="#8a8a8a" />
              <text x="238" y={Y + 3}>{Name}</text>
            </g>
          ))}
          <line x1="122" x2="198" y1={Rest} y2={Rest} stroke="#ffffff40" strokeDasharray="2 3" />
          <path d={"M" + Zig.join("L")} fill="none" stroke={Colour} strokeWidth="2.6" strokeLinejoin="round" />
          <rect x="128" y={Top} width="64" height="9" rx="4" fill="#ededed" className="vc-grip" />
          <rect x="128" y={Base} width="64" height="7" rx="3" fill="#565656" />
        </>
      );
    }
    case "spin": {
      const Rate = S.rate || 0;
      return (
        <>
          <circle cx={Pivot.X} cy={Pivot.Y} r="50" fill="#161616" stroke="#2c2c2c" strokeWidth="10" />
          <circle cx={Pivot.X} cy={Pivot.Y} r="55" fill="none" stroke="#8a8a8a" strokeWidth="1.2" />
          <g transform={`rotate(${(S.spin / Degree).toFixed(2)} ${Pivot.X} ${Pivot.Y})`}>
            {[0, 1, 2, 3, 4].map((Index) => (
              <line key={Index} x1={Pivot.X} y1={Pivot.Y} x2={Pivot.X + Math.sin(Index * 1.2566) * 44} y2={Pivot.Y - Math.cos(Index * 1.2566) * 44} stroke={Colour} strokeWidth="3" strokeLinecap="round" />
            ))}
            <circle cx={Pivot.X} cy={Pivot.Y - 50} r="3" fill="#ededed" />
          </g>
          <circle cx={Pivot.X} cy={Pivot.Y} r="9" fill="#1b1b1b" stroke={Colour} strokeWidth="2" />
          {Math.abs(Rate) > 0.01 && <path d={Rate > 0 ? Arc(Pivot.X, Pivot.Y, 30, 110, 64) : Arc(Pivot.X, Pivot.Y, -110, -30, 64)} fill="none" stroke="#ededed" strokeWidth="1.6" markerEnd="url(#VcArrow)" />}
        </>
      );
    }
    case "tether": {
      const Anchor = { X: 160, Y: 16 }, Reach = Math.min(104, 26 + P.length * 34);
      // Rear is to the left, as in the Mount card, so a trailing swing (θ > 0) moves left.
      const [Bx, By] = [Anchor.X - Math.sin(S.theta) * Reach, Anchor.Y + Math.cos(S.theta) * Reach];
      const Envelope = Math.min(85, Math.max(Math.abs(P.swing), Peak / Degree));
      return (
        <>
          <line x1={Anchor.X - 46} x2={Anchor.X + 46} y1={Anchor.Y} y2={Anchor.Y} stroke="#8a8a8a" strokeWidth="3" strokeLinecap="round" />
          {Envelope > 1 && <path d={Arc(Anchor.X, Anchor.Y, 180 - Envelope, 180 + Envelope, Reach)} fill="none" stroke={Colour} strokeDasharray="3 3" opacity="0.7" />}
          <line x1={Anchor.X} y1={Anchor.Y} x2={Bx} y2={By} stroke={Colour} strokeWidth="2" />
          <circle cx={Bx} cy={By} r="10" fill="#ededed" className="vc-grip" />
          <text x={Anchor.X + 52} y={Anchor.Y + 4}>{P.length.toFixed(2)} m</text>
        </>
      );
    }
    case "dock": {
      const Out = Math.max(0.05, P.snapRadius) * 1.8, Scale = 92 / Out, Face = 132;
      const Phase = S.dock.phase || "released";
      const Tint = DOCK_COLORS[Phase] || DOCK_COLORS.seeking;
      const Load = Math.min(1.2, S.dock.load / Math.max(1, P.breakForce));
      return (
        <>
          <rect x={Face} y="48" width={P.snapRadius * Scale} height="48" fill={Colour + "12"} stroke={Colour} strokeDasharray="3 3" />
          <text x={Face + 4} y="42">snap {P.snapRadius.toFixed(2)} m</text>
          <rect x="84" y="50" width={Face - 84} height="44" rx="6" fill="#262626" stroke="#8a8a8a" />
          <rect x={Face + S.dock.gap * Scale} y="56" width="40" height="32" rx="7" fill="#ededed" stroke={Tint} strokeWidth="2.5" className="vc-grip" />
          {S.dock.ripple > 0 && <circle cx={Face} cy="72" r={(0.6 - S.dock.ripple) * 90} fill="none" stroke={DOCK_COLORS.connected} opacity={S.dock.ripple / 0.6} />}
          <rect x="60" y="110" width="200" height="6" rx="3" fill="#ffffff14" />
          <rect x="60" y="110" width={(Load / 1.2) * 200} height="6" rx="3" fill={Load >= 1 ? DOCK_COLORS.rejected : Colour} />
          <line x1={60 + 200 / 1.2} x2={60 + 200 / 1.2} y1="105" y2="121" stroke="#ededed" />
          <text x={60 + 200 / 1.2} y="131" textAnchor="middle">break {(P.breakForce / 1000).toFixed(2)} kN</text>
        </>
      );
    }
  }
  return (
    <>
      <path d={`M160 44 l28 16v32l-28 16-28-16v-32z`} fill="none" stroke={Colour} strokeWidth="2" />
      <rect x="148" y="64" width="24" height="24" rx="6" fill="#ededed" />
      <text x="160" y="126" textAnchor="middle">rigid mount · no motion</text>
    </>
  );
}

// Pointer position on the study → the property change it stands for.
function DragToProperties(P, X, Y) {
  const Fraction = (Value, Low, High) => (High === Low ? null : Math.min(1, Math.max(0, (Value - Low) / (High - Low))));
  switch (P.kind) {
    case "hinge": {
      const Angle = Math.atan2(X - HingePivot.X, -(Y - HingePivot.Y)) / Degree;
      const Pose = Fraction(Angle, P.angleMin, P.angleMax);
      return Pose === null ? null : { pose: +Pose.toFixed(3) };
    }
    case "slider": {
      const Low = Math.min(P.travelMin, P.travelMax), High = Math.max(P.travelMin, P.travelMax), Span = Math.max(0.01, High - Low);
      const Pose = Fraction(Low + ((X - 50) / 220) * Span, P.travelMin, P.travelMax);
      return Pose === null ? null : { pose: +Pose.toFixed(3) };
    }
    case "ball": {
      const Tilt = Math.atan2(Math.abs(X - 160), Math.max(1, 114 - Y)) / Degree;
      return { pose: +Math.min(1, Tilt / Math.max(1, P.cone)).toFixed(3) };
    }
    case "spring": {
      const Rest = (74 - Y) / (38 / Math.max(0.005, P.springTravel));
      return { pose: +Math.min(1, Math.max(0, (Rest / 0.5 + P.springTravel) / (2 * P.springTravel))).toFixed(3) };
    }
    case "tether": {
      const Swing = Math.atan2(160 - X, Math.max(1, Y - 16)) / Degree;
      return { swing: Math.round(Math.min(80, Math.max(-80, Swing))) };
    }
  }
  return null;
}

// 6 s of the socket's quantity (kind colour) over the test drive's speed (grey), limits dashed.
function TraceStrip({ Trace, Q, Colour, Clock, Phase }) {
  const Left = 16, Right = 304, Top = 150, Bottom = 192;
  const X = (Time) => Right - ((Clock - Time) / TraceSeconds) * (Right - Left);
  const Y = (Value) => Bottom - Math.min(1, Math.max(0, (Value - Q.Low) / Math.max(1e-6, Q.High - Q.Low))) * (Bottom - Top);
  const Speed = (Value) => Bottom - Math.min(1, Value / 12) * (Bottom - Top);
  const Line = (Map, Slot) => Trace.map((Sample, Index) => (Index ? "L" : "M") + X(Sample[0]).toFixed(1) + " " + Map(Sample[Slot]).toFixed(1)).join("");
  const Zero = Q.Low < 0 && Q.High > 0 ? Y(0) : null;
  return (
    <g className="vc-trace">
      <line x1={Left} x2={Right} y1={Top} y2={Top} stroke="#ffffff1f" strokeDasharray="2 3" />
      <line x1={Left} x2={Right} y1={Bottom} y2={Bottom} stroke="#ffffff1f" strokeDasharray="2 3" />
      {Zero !== null && <line x1={Left} x2={Right} y1={Zero} y2={Zero} stroke="#ffffff12" />}
      {Trace.some((Sample) => Sample[2] > 0.05) && <path d={Line(Speed, 2)} fill="none" stroke="#ffffff38" strokeWidth="1.2" />}
      {Trace.length > 1 && <path d={Line(Y, 1)} fill="none" stroke={Colour} strokeWidth="1.8" strokeLinejoin="round" />}
      <text x={Left} y={Top - 4}>last {TraceSeconds} s</text>
      <text x={Right} y={Top - 4} textAnchor="end">{Phase}</text>
    </g>
  );
}

function SocketStudy({ Kit, P, Write, M, Restart, Running, SetRunning }) {
  const { Card, Metric } = Kit;
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed, Colour = Variant.color;
  const Q = Quantity(P, M.S);
  const Svg = useRef(null), Dragging = useRef(false);
  const Local = (Event) => {
    const Point = Svg.current.createSVGPoint();
    Point.x = Event.clientX;
    Point.y = Event.clientY;
    return Point.matrixTransform(Svg.current.getScreenCTM().inverse());
  };
  const Apply = (Event) => {
    const { x, y } = Local(Event);
    const Changes = DragToProperties(P, x, y);
    if (Changes) Object.entries(Changes).forEach(([Key, Next]) => Write(Key, Next));
  };
  const Handlers = {
    onPointerDown: (Event) => {
      if (P.kind === "dock") return Write("connected", !P.connected);
      if (!DragToProperties(P, 0, 0)) return;
      Dragging.current = true;
      Event.currentTarget.setPointerCapture(Event.pointerId);
      Apply(Event);
    },
    onPointerMove: (Event) => Dragging.current && Apply(Event),
    onPointerUp: () => (Dragging.current = false),
  };
  const Drive = M.Drive, Last = M.Events[0];
  const Hint = { hinge: "Drag the arm to set the pose", slider: "Drag the carriage to set the pose", ball: "Drag the stick to set the tilt", spring: "Drag the plate to set the preload", tether: "Drag the weight to set the starting swing", dock: "Click to connect or release", spin: "", fixed: "" }[P.kind];
  const Shown = Q.Value.toFixed(Q.Digits).replace(/^-0(\.0+)?$/, "0").replace("-", "−");
  return (
    <Card Title={`${Variant.label} socket`} Class="vc-card vc-socket-study">
      <svg ref={Svg} className={"vc-visual vc-socket-scene" + (DragToProperties(P, 0, 0) || P.kind === "dock" ? " vc-draggable" : "")} viewBox="0 0 320 200" role="img" aria-label={`${Variant.label} socket study`} {...Handlers}>
        <defs>
          <marker id="VcArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#e8e8e8" />
          </marker>
        </defs>
        <text x="16" y="18">axis {P.axis}</text>
        <text x="304" y="18" textAnchor="end">{socketReadout(P, M.S)}</text>
        <SocketScene P={P} S={M.S} Colour={Colour} Peak={M.Peak} />
        <TraceStrip Trace={M.Trace} Q={Q} Colour={Colour} Clock={M.Clock} Phase={Running ? `${Drive.Name} · ${(Drive.Speed * 3.6).toFixed(0)} km/h` : "parked"} />
      </svg>
      <div className="vc-socket-bar">
        <button type="button" className="vc-run" aria-pressed={Running} onClick={() => SetRunning(!Running)}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            {Running ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor" />}
          </svg>
          {Running ? "Stop" : "Run test drive"}
        </button>
        <button type="button" onClick={Restart}>Restart</button>
        {Hint && <span className="vc-hint">{Hint}</span>}
      </div>
      <Metric Value={P.kind === "dock" ? (M.S.dock.phase || "released").replace(/^./, (Letter) => Letter.toUpperCase()) : P.kind === "fixed" ? "Rigid" : Shown} Unit={P.kind === "dock" || P.kind === "fixed" ? "" : Q.Unit} Caption={P.kind === "dock" ? `${Q.Value.toFixed(2)} kN on the coupling · breaks at ${(P.breakForce / 1000).toFixed(2)} kN` : Q.Caption} />
      {Last && (
        <p className="vc-note vc-event" style={{ "--k": DOCK_COLORS[Last.type] || Colour }}>
          <i />
          {Last.type === "released" ? `Released at ${(Last.load / 1000).toFixed(2)} kN` : Last.type === "connected" ? "Snapped home and connected" : "Rejected: key did not match"} · {(M.Clock - Last.At).toFixed(1)} s ago
        </p>
      )}
    </Card>
  );
}

// Range strip: the allowed range, the live value and (where it applies) the pose target.
function RangeStrip({ P, Q, Colour }) {
  const Left = 24, Right = 296, Y = 30;
  const X = (Value) => Left + Math.min(1, Math.max(0, (Value - Q.Low) / Math.max(1e-6, Q.High - Q.Low))) * (Right - Left);
  const Origin = Q.Low < 0 && Q.High > 0 ? X(0) : Left;
  const Target = { hinge: Lerp(P.angleMin, P.angleMax, P.pose), slider: Lerp(P.travelMin, P.travelMax, P.pose) * 1000, ball: P.cone * P.pose, spring: Lerp(-P.springTravel, P.springTravel, P.pose) * 500, tether: P.swing }[P.kind];
  const Label = (Value) => (Q.Digits ? Value.toFixed(Q.Digits) : Math.round(Value)) + " " + Q.Unit;
  return (
    <svg className="vc-visual vc-range" viewBox="0 0 320 58" role="img" aria-label="Range of motion">
      <rect x={Left} y={Y - 3} width={Right - Left} height="6" rx="3" fill="#ffffff14" />
      <rect x={Math.min(Origin, X(Q.Value))} y={Y - 3} width={Math.abs(X(Q.Value) - Origin)} height="6" rx="3" fill={Colour} />
      {Target !== undefined && <line x1={X(Target)} x2={X(Target)} y1={Y - 10} y2={Y + 10} stroke="#ededed" strokeDasharray="2 2" />}
      <circle cx={X(Q.Value)} cy={Y} r="6" fill="#ededed" />
      <text x={Left} y="52">{Label(Q.Low)}</text>
      <text x={Right} y="52" textAnchor="end">{Label(Q.High)}</text>
      {Target !== undefined && (
        <text x={X(Target)} y="11" textAnchor="middle">
          {P.kind === "tether" ? "start" : "pose"}
        </text>
      )}
    </svg>
  );
}

// Figures that follow from the settings, per kind.
function SocketFigures(P) {
  const Sweep = P.drive === "sweep";
  switch (P.kind) {
    case "hinge": {
      const Span = Math.abs(P.angleMax - P.angleMin);
      return [["Range", `${Span}°`], ["Peak rate while sweeping", Sweep ? `${Fixed((Math.PI * Span) / P.period)} °/s` : "holds its pose"]];
    }
    case "slider": {
      const Stroke = Math.abs(P.travelMax - P.travelMin);
      return [["Stroke", `${Fixed(Stroke * 1000)} mm`], ["Peak speed while sweeping", Sweep ? `${Fixed((Math.PI * Stroke) / P.period, 2)} m/s` : "holds its pose"]];
    }
    case "ball": {
      const Solid = 2 * Math.PI * (1 - Math.cos(P.cone * Degree));
      return [["Reachable directions", `${Solid.toFixed(2)} sr`], ["Share of a hemisphere", `${Fixed((Solid / (2 * Math.PI)) * 100, 1)} %`]];
    }
    case "spring": {
      const Omega = 2 * Math.PI * P.springHz, Zeta = P.damping;
      const Overshoot = Zeta < 1 ? Math.exp((-Zeta * Math.PI) / Math.sqrt(1 - Zeta * Zeta)) * 100 : 0;
      return [
        ["Period", `${(1 / P.springHz).toFixed(2)} s`],
        ["Overshoot after a bump", `${Overshoot.toFixed(1)} %`],
        ["Settles in", `${(4 / (Zeta * Omega)).toFixed(2)} s`],
        ["Bumps at 50 km/h", P.bumpSpacing > 0 ? `every ${(P.bumpSpacing / 13.89).toFixed(2)} s` : "smooth road"],
      ];
    }
    case "spin": {
      const Rate = P.spinSource === "vehicle" ? 13.89 / Math.max(0.05, P.spinRadius) : (P.rpm * 2 * Math.PI) / 60;
      return [
        [P.spinSource === "vehicle" ? "Rate at 50 km/h" : "Rate", `${Fixed((Rate * 60) / (2 * Math.PI))} rpm`],
        ["Rim speed", `${(Math.abs(Rate) * P.spinRadius).toFixed(1)} m/s · ${Fixed(Math.abs(Rate) * P.spinRadius * 3.6)} km/h`],
      ];
    }
    case "tether": {
      const Period = 2 * Math.PI * Math.sqrt(Math.max(0.02, P.length) / Gravity);
      return [
        ["Swing period", `${Period.toFixed(2)} s`],
        ["Lean while braking (5.3 m/s²)", `${(Math.atan(5.25 / Gravity) / Degree).toFixed(1)}°`],
        ["Swing halves every", P.tetherDamping > 0 ? `${((2 * Math.LN2) / P.tetherDamping).toFixed(1)} s` : "never (no drag)"],
      ];
    }
    case "dock":
      return [
        ["Holds a hanging mass of", `${Fixed(P.breakForce / Gravity)} kg`],
        ["Pull test breaks after", "2.5 s"],
        ["Accepts", P.key ? `children tagged “${P.key}”` : "any child"],
      ];
  }
  return [];
}

function SocketRange({ Kit, P, Write, S }) {
  const { Card, Control } = Kit;
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed;
  const Drives = DRIVES[P.kind];
  const Title = { hinge: "Range of motion", slider: "Travel", ball: "Swing cone", spring: "Spring & damper", spin: "Rate", tether: "Pendulum", dock: "Coupling" }[P.kind];
  if (!Title) return null;
  const Fields = SOCKET_FIELDS[P.kind].filter((Key) => Key !== "axis" && (Key !== "period" || P.drive === "sweep"));
  return (
    <Card Title={Title} Class="vc-card">
      <RangeStrip P={P} Q={Quantity(P, S)} Colour={Variant.color} />
      {Fields.map((Key) => {
        const Param = SOCKET_PARAMS[Key];
        if (Param.type === "range") return <Slider key={Key} Kit={Kit} V={(Name) => P[Name]} Write={Write} Key={Key} Label={Param.label} Minimum={Param.min} Maximum={Param.max} Step={Param.step} Unit={Param.unit} />;
        if (Param.type === "pose") return <Slider key={Key} Kit={Kit} V={(Name) => P[Name]} Write={Write} Key={Key} Label={`Pose · ${poseLabel(P, P.pose)}`} Minimum={0} Maximum={1} Step={0.01} />;
        if (Param.type === "bool") return <Control key={Key} Field={{ Label: Param.label, Control: "Switch" }} Value={!!P[Key]} Change={(Next) => Write(Key, Next)} />;
        if (Param.type === "drive" && Drives)
          return <Control key={Key} Field={{ Label: "Drive", Control: "Select", Options: Drives.map((Each) => Each[1]) }} Value={Math.max(0, Drives.findIndex((Each) => Each[0] === P.drive))} Change={(Index) => Write("drive", Drives[Index][0])} />;
        if (Param.type === "select")
          return <Control key={Key} Field={{ Label: Param.label, Control: "Select", Options: Param.options.map((Each) => Each[1]) }} Value={Math.max(0, Param.options.findIndex((Each) => Each[0] === P[Key]))} Change={(Index) => Write(Key, Param.options[Index][0])} />;
        if (Param.type === "text")
          return (
            <label key={Key} className="field vc-text">
              <span>{Param.label}</span>
              <input type="text" value={P[Key] || ""} placeholder={Param.placeholder} onChange={(Event) => Write(Key, Event.target.value)} />
            </label>
          );
        return null;
      })}
      <Readouts Kit={Kit} Rows={SocketFigures(P)} />
    </Card>
  );
}

function SocketType({ Kit, P, Write }) {
  const { Card } = Kit;
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed;
  return (
    <Card Title="Socket type" Class="vc-card">
      <div className="vc-socket-kinds" role="radiogroup" aria-label="Socket type">
        {SOCKET_KINDS.map((Each) => (
          <button key={Each.id} type="button" role="radio" aria-checked={Each.id === P.kind} style={{ "--k": Each.color }} onClick={() => Write("kind", Each.id)} title={Each.note}>
            <SocketGlyph Variant={Each.id} />
            {Each.label}
          </button>
        ))}
      </div>
      <p className="vc-note">{Variant.note} Switching type keeps every number, so you can switch back.</p>
    </Card>
  );
}

function SocketMount({ Kit, P, Mount, Write }) {
  const { Card, Control, Metric } = Kit;
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed;
  const X = SocketCentre + Mount * PixelsPerMetre, Y = 82;
  const Dragging = useRef(false);
  const Move = (Event) => {
    const Svg = Event.currentTarget, Point = Svg.createSVGPoint();
    Point.x = Event.clientX;
    Point.y = Event.clientY;
    const Local = Point.matrixTransform(Svg.getScreenCTM().inverse());
    Write("mount", +Math.min(2.8, Math.max(-2.8, (Local.x - SocketCentre) / PixelsPerMetre)).toFixed(2));
  };
  const Arrow = { X: [22, 0], Y: [0, -22], Z: null }[P.axis];
  const Effect =
    P.kind === "spring"
      ? Mount > 0.3
        ? "Front of the car: it dives under braking and lifts under acceleration."
        : Mount < -0.3
          ? "Rear of the car: it squats under acceleration and lifts under braking."
          : "Near the centre, acceleration barely loads it; road bumps still reach it."
      : P.kind === "tether"
        ? "Hangs from here; acceleration swings it backwards, braking forwards."
        : "Children of this socket are placed here and move with the joint.";
  return (
    <Card Title="Mount" Class="vc-card">
      <SideView
        Label={`Socket mounted at the ${MountSpot(Mount)}`}
        Handlers={{
          className: "vc-visual vc-draggable",
          onPointerDown: (Event) => {
            Dragging.current = true;
            Event.currentTarget.setPointerCapture(Event.pointerId);
            Move(Event);
          },
          onPointerMove: (Event) => Dragging.current && Move(Event),
          onPointerUp: () => (Dragging.current = false),
        }}
      >
        <defs>
          <marker id="VcMountArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#ededed" />
          </marker>
        </defs>
        <line x1={X} x2={X} y1="22" y2="128" stroke={Variant.color} strokeDasharray="2 3" opacity="0.6" />
        {Arrow ? (
          <line x1={X} y1={Y} x2={X + Arrow[0]} y2={Y + Arrow[1]} stroke="#ededed" strokeWidth="1.6" markerEnd="url(#VcMountArrow)" />
        ) : (
          <>
            <circle cx={X + 16} cy={Y - 16} r="5" fill="none" stroke="#ededed" />
            <circle cx={X + 16} cy={Y - 16} r="1.4" fill="#ededed" />
          </>
        )}
        <circle cx={X} cy={Y} r="7" fill="#1b1b1b" stroke={Variant.color} strokeWidth="2.4" className="vc-grip" />
        <text x={Math.min(280, Math.max(40, X))} y="16" textAnchor="middle">{MountSpot(Mount)}</text>
        <text x="16" y="146">rear</text>
        <text x="304" y="146" textAnchor="end">front</text>
      </SideView>
      <Metric Value={Mount.toFixed(2).replace("-", "−")} Unit="m" Caption={`${Mount >= 0 ? "Ahead of" : "Behind"} the centre of the wheelbase · ${MountSpot(Mount)}`} />
      <Slider Kit={Kit} V={() => Mount} Write={Write} Key="mount" Label="Position along the car" Minimum={-2.8} Maximum={2.8} Step={0.01} Unit="m" />
      <Control Field={{ Label: "Joint axis", Control: "Select", Options: ["X · along the car", "Y · up", "Z · across the car"] }} Value={["X", "Y", "Z"].indexOf(P.axis)} Change={(Index) => Write("axis", ["X", "Y", "Z"][Index])} />
      <p className="vc-note">{Effect}</p>
    </Card>
  );
}

function SocketInspector({ Kit, V, Write }) {
  const P = { ...socketDefaults(V("kind") || "fixed"), ...Object.fromEntries(Object.keys(SOCKET_PARAMS).concat("kind").map((Key) => [Key, V(Key)]).filter(([, Value]) => Value !== undefined)) };
  const Mount = Number.isFinite(+V("mount")) ? +V("mount") : 0;
  // One live state for the whole inspector, so the study and the range strip show the same moment.
  const [Running, SetRunning] = useState(false);
  const [M, Restart] = useSocketMotion(P, Mount, Running);
  return (
    <>
      <SocketStudy Kit={Kit} P={P} Write={Write} M={M} Restart={Restart} Running={Running} SetRunning={SetRunning} />
      <SocketType Kit={Kit} P={P} Write={Write} />
      <SocketRange Kit={Kit} P={P} Write={Write} S={M.S} />
      <SocketMount Kit={Kit} P={P} Mount={Mount} Write={Write} />
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   COLLISION, LIGHTS, BODY
//------------------------------------------------------------------------------------------------------------------------

function CollisionInspector({ Kit, V, Write, Row }) {
  const { Card, Control, Metric } = Kit;
  const Box = Row.Component === "BoxCollision";
  const Extent = V("extent") || [0.5, 0.5, 0.5], Radius = +V("radius") || 0.5;
  const Volume = Box ? 8 * Extent[0] * Extent[1] * Extent[2] : (4 / 3) * Math.PI * Radius ** 3;
  const Trigger = !!V("trigger");
  const Colour = Trigger ? "#ffb15a" : "#7cb7ff";
  const Iso = ([X, Y, Z]) => [160 + (X - Z) * 0.87 * 34, 88 - Y * 34 + (X + Z) * 0.5 * 34];
  const Scale = Box ? 1 / Math.max(1, ...Extent.map((Each) => Each / 1.4)) : 1 / Math.max(1, Radius / 1.2);
  return (
    <Card Title={Box ? "Box collision" : "Sphere collision"} Class="vc-card">
      <SideView Height={170}>
        {Box ? (
          (() => {
            const [Ex, Ey, Ez] = Extent.map((Each) => Each * Scale);
            const C = [[-Ex, -Ey, -Ez], [Ex, -Ey, -Ez], [Ex, Ey, -Ez], [-Ex, Ey, -Ez], [-Ex, -Ey, Ez], [Ex, -Ey, Ez], [Ex, Ey, Ez], [-Ex, Ey, Ez]].map((Point) => Iso([Point[0], Point[1] - 0.6, Point[2]]));
            const Edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
            return Edges.map(([A, B], Index) => <line key={Index} x1={C[A][0]} y1={C[A][1]} x2={C[B][0]} y2={C[B][1]} stroke={Colour} strokeWidth="1.4" strokeDasharray="4 3" />);
          })()
        ) : (
          <>
            <circle cx="160" cy="92" r={Radius * Scale * 40} fill={Colour + "14"} stroke={Colour} strokeWidth="1.4" strokeDasharray="4 3" />
            <ellipse cx="160" cy="92" rx={Radius * Scale * 40} ry={Radius * Scale * 12} fill="none" stroke={Colour} strokeOpacity="0.6" />
          </>
        )}
      </SideView>
      <Metric Value={Fixed(Volume, 2)} Unit="m³" Caption={Trigger ? "Overlap events · nothing is blocked (OverlapAll)" : "Blocks everything (BlockAll)"} />
      {Box ? (
        ["X", "Y", "Z"].map((Axis, Index) => (
          <Kit.Control
            key={Axis}
            Field={{ Label: `Half extent ${Axis}`, Minimum: 0.05, Maximum: 4, Decimals: 2, Unit: "m", Default: Extent[Index] }}
            Value={Extent[Index]}
            Change={(Next) => Write("extent", Extent.map((Each, Slot) => (Slot === Index ? Next : Each)))}
          />
        ))
      ) : (
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="SphereCollision" Key="radius" />
      )}
      <Control Field={{ Label: "Generate overlap events", Control: "Switch" }} Value={Trigger} Change={(Next) => Write("trigger", Next)} />
    </Card>
  );
}

function LightInspector({ Kit, V, Write, Row }) {
  const { Card, Control, Metric } = Kit;
  const Spot = Row.Component === "SpotLight";
  const Intensity = +V("intensity"), Range = +V("range"), Angle = +V("angle") || 30, Colour = V("color") || "#ffffff";
  const Distance = Math.min(10, Range);
  const Half = (Angle * Math.PI) / 360;
  return (
    <Card Title={Spot ? "Headlight beam" : "Lamp glow"} Class="vc-card">
      <svg className="vc-visual" viewBox="0 0 320 150" role="img" aria-label={Spot ? "Beam cone" : "Radial glow"}>
        <defs>
          <radialGradient id={"VcGlow" + Row.Id}>
            <stop offset="0" stopColor={Colour} stopOpacity="0.9" />
            <stop offset="1" stopColor={Colour} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={"VcBeam" + Row.Id} x1="0" x2="1">
            <stop offset="0" stopColor={Colour} stopOpacity="0.55" />
            <stop offset="1" stopColor={Colour} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Spot ? (
          <>
            <path d={`M40 75 L${40 + 260} ${75 - Math.tan(Half) * 260} L${40 + 260} ${75 + Math.tan(Half) * 260} Z`} fill={`url(#VcBeam${Row.Id})`} />
            <circle cx="40" cy="75" r="9" fill={Colour} />
            <line x1={40 + (Distance / Range) * 260} x2={40 + (Distance / Range) * 260} y1="14" y2="136" stroke="#ffffff30" strokeDasharray="3 3" />
            <text x={44 + (Distance / Range) * 260} y="146">{Distance.toFixed(0)} m</text>
          </>
        ) : (
          <>
            <circle cx="160" cy="75" r={Math.min(70, 14 + Range * 5)} fill={`url(#VcGlow${Row.Id})`} />
            <circle cx="160" cy="75" r="8" fill={Colour} />
            <circle cx="160" cy="75" r={Math.min(70, 14 + Range * 5)} fill="none" stroke="#ffffff22" strokeDasharray="3 4" />
          </>
        )}
        <text x="16" y="18">{Spot ? `${Angle}° outer cone` : `${Range.toFixed(1)} m radius`}</text>
      </svg>
      <Metric Value={Fixed(Intensity / (Distance * Distance), 2)} Unit={`lx at ${Distance.toFixed(0)} m`} Caption={`${Fixed(Intensity, 1)} cd · inverse-square estimate inside the attenuation radius`} />
      <ClassSlider Kit={Kit} V={V} Write={Write} Type={Row.Component} Key="intensity" />
      {Spot && <ClassSlider Kit={Kit} V={V} Write={Write} Type="SpotLight" Key="angle" />}
      <ClassSlider Kit={Kit} V={V} Write={Write} Type={Row.Component} Key="range" />
      <Control Field={{ Label: "Light colour", Control: "Colour" }} Value={Colour} Change={(Next) => Write("color", Next)} />
    </Card>
  );
}

function BodyInspector({ Kit, V, Write }) {
  const { Card, Control, Metric } = Kit;
  const Lod = Math.round(+V("lod"));
  const Presets = ClassField("StaticMesh", "collisionPreset").options;
  const Base = 48000;
  return (
    <Card Title="Static mesh" Class="vc-card">
      <svg className="vc-visual" viewBox="0 0 320 120" role="img" aria-label="Level of detail chain">
        {Array.from({ length: 6 }, (_, Index) => {
          const Width = 44 - Index * 4, X = 18 + Index * 50, Active = Lod < 0 ? Index === 0 : Index === Lod;
          return (
            <g key={Index} opacity={Active ? 1 : 0.45}>
              <rect x={X} y={60 - Width / 2} width={Width} height={Width} rx="10" fill={Active ? "#3a3a3a" : "#222"} stroke={Active ? "#f0f0f0" : "#777"} />
              <text x={X + Width / 2} y="104" textAnchor="middle">LOD{Index}</text>
              <text x={X + Width / 2} y="116" textAnchor="middle">{Fixed(Base / 2 ** Index / 1000, 1)}k</text>
            </g>
          );
        })}
      </svg>
      <Metric Value={Lod < 0 ? "Auto" : "LOD " + Lod} Unit="" Caption={Lod < 0 ? "Detail follows screen size" : `Forced · about ${Fixed(Base / 2 ** Math.min(Lod, 5))} triangles`} />
      <ClassSlider Kit={Kit} V={V} Write={Write} Type="StaticMesh" Key="lod" />
      <Control Field={{ Label: "Collision preset", Control: "Select", Options: Presets }} Value={Math.max(0, Presets.indexOf(V("collisionPreset")))} Change={(Index) => Write("collisionPreset", Presets[Index])} />
      <Control Field={{ Label: "Cast shadow", Control: "Switch" }} Value={!!V("castShadow")} Change={(Next) => Write("castShadow", Next)} />
      <Control Field={{ Label: "Simulate physics", Control: "Switch" }} Value={!!V("simulatePhysics")} Change={(Next) => Write("simulatePhysics", Next)} />
      {V("simulatePhysics") && <ClassSlider Kit={Kit} V={V} Write={Write} Type="StaticMesh" Key="mass" />}
      <p className="vc-note">The mesh asset itself is picked in the Component Viewer; this row carries its rendering and collision settings.</p>
    </Card>
  );
}

export function VehicleInspector({ Subject, Values, Change, Kit }) {
  const V = Reader(Subject, Values);
  const Write = (Key, Next) => Change(Key, Next);
  const Wiring = { Kit, V, Write, Row: Subject };
  const Body =
    Subject.Component === "VehicleMovement" ? <MovementInspector {...Wiring} />
      : Subject.Component === "Socket" ? <SocketInspector {...Wiring} />
        : /Collision/.test(Subject.Component) ? <CollisionInspector {...Wiring} />
          : /Light/.test(Subject.Component) ? <LightInspector {...Wiring} />
            : <BodyInspector {...Wiring} />;
  return (
    <div className="vehicle-inspector" data-component={Subject.Component}>
      {Body}
    </div>
  );
}

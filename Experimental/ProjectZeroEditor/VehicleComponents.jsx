//============================================================================================================================================
//                                                          VEHICLECOMPONENTS.JSX
//============================================================================================================================================
// 🚗 The Vehicle folder: the Component Viewer's ControlVehicle class (Vehicle Movement, Static Mesh body, Sockets, Collision, Lights) as
// outliner rows with their own inspectors. Component data, defaults and socket parameters come straight from
// Experimental/ComponentViewer (Blueprint.js, Sockets.js); the icons are the baked EngineContent set. Browser authoring only.

import React from "react";
import { COMPONENT_CLASSES, VEHICLE_SHEET, createComponent } from "../ComponentViewer/Blueprint.js";
import { SOCKET_KINDS, SOCKET_KIND, SOCKET_FIELDS, SOCKET_PARAMS, DRIVES, socketDefaults, poseLabel } from "../ComponentViewer/Sockets.js";

export const VehiclePanel = "vehicle-component";
export const VehicleSheet = [];

// Id, name, component class, baked icon, description, extra row fields.
const Components = [
  ["vehicle-movement", "Vehicle Movement", "VehicleMovement", "arcade-joystick", "Chassis, suspension, powertrain and aero"],
  ["vehicle-body", "Body", "StaticMesh", "editor-mesh", "Static Mesh · body shell"],
  ["vehicle-suspension", "Front Suspension", "Socket", "editor-pivot", "Spring socket · front axle", { Joint: "spring" }],
  ["vehicle-steering", "Steering", "Socket", "editor-pivot", "Hinge socket · steering knuckle", { Joint: "hinge" }],
  ["vehicle-tow", "Tow Hitch", "Socket", "editor-pivot", "Dock socket · trailer coupling", { Joint: "dock" }],
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

// Defaults straight from the Component Viewer's classes.
const DefaultCache = new Map();
function Defaults(Row) {
  const Key = Row.Component + ":" + (Row.Joint || "") + (Row.Trigger ? ":t" : "");
  if (!DefaultCache.has(Key)) {
    const Props = createComponent(Row.Component, Row.Name).props;
    if (Row.Component === "Socket") Object.assign(Props, socketDefaults(Row.Joint || "fixed"), Row.Joint === "hinge" ? { angleMin: -35, angleMax: 35 } : {});
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
      return `${SOCKET_KIND[V("kind")]?.label || "Fixed"} socket`;
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
function SideView({ children, Height = 150 }) {
  return (
    <svg className="vc-visual" viewBox={`0 0 320 ${Height}`} role="img" aria-label="Vehicle side view">
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

function SocketDiagram({ P }) {
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed, Colour = Variant.color;
  const Cx = 160, Cy = 78;
  const Arc = (From, To, R) => {
    const A = ((From - 90) * Math.PI) / 180, B = ((To - 90) * Math.PI) / 180;
    return `M${Cx + Math.cos(A) * R} ${Cy + Math.sin(A) * R} A${R} ${R} 0 ${Math.abs(To - From) > 180 ? 1 : 0} 1 ${Cx + Math.cos(B) * R} ${Cy + Math.sin(B) * R}`;
  };
  let Body;
  switch (P.kind) {
    case "hinge": {
      const Pose = Lerp(P.angleMin, P.angleMax, P.pose);
      const A = ((Pose - 90) * Math.PI) / 180;
      Body = (
        <>
          <path d={`M${Cx} ${Cy} ${Arc(P.angleMin, P.angleMax, 54).replace(/^M/, "L")} Z`} fill={Colour + "22"} stroke={Colour} strokeDasharray="3 3" />
          <line x1={Cx} y1={Cy} x2={Cx + Math.cos(A) * 60} y2={Cy + Math.sin(A) * 60} stroke="#f0f0f0" strokeWidth="3" strokeLinecap="round" />
          <text x={Cx} y="150" textAnchor="middle">{P.angleMin}° to {P.angleMax}° · pose {poseLabel(P, P.pose)}</text>
        </>
      );
      break;
    }
    case "slider": {
      const X = (Travel) => Cx + Travel * 100;
      Body = (
        <>
          <line x1={X(P.travelMin)} x2={X(P.travelMax)} y1={Cy} y2={Cy} stroke={Colour} strokeWidth="6" strokeLinecap="round" opacity="0.5" />
          <rect x={X(Lerp(P.travelMin, P.travelMax, P.pose)) - 10} y={Cy - 12} width="20" height="24" rx="6" fill="#e8e8e8" />
          <text x={Cx} y="150" textAnchor="middle">{P.travelMin.toFixed(2)} m to {P.travelMax.toFixed(2)} m</text>
        </>
      );
      break;
    }
    case "ball":
      Body = (
        <>
          <path d={`M${Cx} ${Cy + 30} L${Cx - Math.tan((P.cone * Math.PI) / 180) * 70} ${Cy - 40} A70 18 0 0 1 ${Cx + Math.tan((P.cone * Math.PI) / 180) * 70} ${Cy - 40} Z`} fill={Colour + "22"} stroke={Colour} />
          <circle cx={Cx} cy={Cy + 30} r="9" fill="#e8e8e8" />
          <text x={Cx} y="150" textAnchor="middle">{P.cone}° swing cone</text>
        </>
      );
      break;
    case "spring": {
      const Compression = (P.pose - 0.5) * P.springTravel * 120;
      const Top = 24 + Compression, Coils = 7;
      const Zig = Array.from({ length: Coils * 2 + 1 }, (_, Index) => `${Cx + (Index % 2 ? 18 : -18) * (Index && Index < Coils * 2 ? 1 : 0)} ${Top + 14 + (Index / (Coils * 2)) * (110 - Top - 14)}`);
      Body = (
        <>
          <rect x={Cx - 30} y={Top} width="60" height="10" rx="4" fill="#e8e8e8" />
          <path d={"M" + Zig.join("L")} fill="none" stroke={Colour} strokeWidth="2.4" strokeLinejoin="round" />
          <rect x={Cx - 30} y="112" width="60" height="8" rx="3" fill="#555" />
          <text x={Cx} y="150" textAnchor="middle">{P.springHz} Hz · ζ {P.damping} · ±{(P.springTravel * 1000).toFixed(0)} mm</text>
        </>
      );
      break;
    }
    case "spin":
      Body = (
        <>
          <circle cx={Cx} cy={Cy} r="46" fill="none" stroke={Colour} strokeWidth="2" />
          {[0, 1, 2, 3, 4, 5].map((Index) => (
            <line key={Index} x1={Cx} y1={Cy} x2={Cx + Math.cos(Index * 1.047) * 46} y2={Cy + Math.sin(Index * 1.047) * 46} stroke={Colour + "88"} />
          ))}
          <path d={Arc(20, 120, 58)} fill="none" stroke="#e8e8e8" strokeWidth="2" markerEnd="url(#VcArrow)" />
          <text x={Cx} y="150" textAnchor="middle">{P.spinSource === "vehicle" ? "follows vehicle speed" : `${P.rpm} rpm`}</text>
        </>
      );
      break;
    case "tether": {
      const A = (P.swing * Math.PI) / 180, L = Math.min(90, 30 + P.length * 30);
      Body = (
        <>
          <line x1={Cx - 40} x2={Cx + 40} y1="20" y2="20" stroke="#777" strokeWidth="3" />
          <line x1={Cx} y1="20" x2={Cx + Math.sin(A) * L} y2={20 + Math.cos(A) * L} stroke={Colour} strokeWidth="2" />
          <circle cx={Cx + Math.sin(A) * L} cy={20 + Math.cos(A) * L} r="9" fill="#e8e8e8" />
          <text x={Cx} y="150" textAnchor="middle">{P.length.toFixed(2)} m · starts at {P.swing}°</text>
        </>
      );
      break;
    }
    case "dock":
      Body = (
        <>
          <circle cx={Cx} cy={Cy} r={Math.min(60, 20 + P.snapRadius * 60)} fill={Colour + "14"} stroke={Colour} strokeDasharray="4 4" />
          <rect x={Cx - 12} y={Cy - 12} width="24" height="24" rx="7" fill={P.connected ? "#46d267" : "#3a3a3a"} stroke="#e8e8e8" />
          <text x={Cx} y="150" textAnchor="middle">{P.connected ? "connected" : "released"} · snaps within {P.snapRadius.toFixed(2)} m · breaks at {Fixed(P.breakForce)} N</text>
        </>
      );
      break;
    default:
      Body = (
        <>
          <path d={`M${Cx} ${Cy - 30} l26 15v30l-26 15-26-15v-30z`} fill="none" stroke={Colour} strokeWidth="2" />
          <circle cx={Cx} cy={Cy} r="7" fill="#e8e8e8" />
          <text x={Cx} y="150" textAnchor="middle">rigid mount · children ride along exactly</text>
        </>
      );
  }
  return (
    <svg className="vc-visual" viewBox="0 0 320 160" role="img" aria-label={`${Variant.label} socket diagram`}>
      <defs>
        <marker id="VcArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L10 5L0 10z" fill="#e8e8e8" />
        </marker>
      </defs>
      <text x="16" y="18">axis {P.axis}</text>
      {Body}
    </svg>
  );
}

function SocketInspector({ Kit, V, Write }) {
  const { Card, Control } = Kit;
  const P = { ...socketDefaults(V("kind") || "fixed"), ...Object.fromEntries(Object.keys(SOCKET_PARAMS).concat("kind").map((Key) => [Key, V(Key)]).filter(([, Value]) => Value !== undefined)) };
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed;
  const Drives = DRIVES[P.kind];
  return (
    <>
      <Card Title={`${Variant.label} socket`} Class="vc-card">
        <SocketDiagram P={P} />
        <p className="vc-note">{Variant.note}</p>
        <div className="vc-socket-kinds" role="radiogroup" aria-label="Socket type">
          {SOCKET_KINDS.map((Each) => (
            <button key={Each.id} type="button" role="radio" aria-checked={Each.id === P.kind} style={{ "--k": Each.color }} onClick={() => Write("kind", Each.id)} title={Each.note}>
              <i />
              {Each.label}
            </button>
          ))}
        </div>
        {SOCKET_FIELDS[P.kind].map((Key) => {
          const Param = SOCKET_PARAMS[Key];
          if (Param.type === "range") return <Slider key={Key} Kit={Kit} V={(Name) => P[Name]} Write={Write} Key={Key} Label={Param.label} Minimum={Param.min} Maximum={Param.max} Step={Param.step} Unit={Param.unit} />;
          if (Param.type === "pose") return <Slider key={Key} Kit={Kit} V={(Name) => P[Name]} Write={Write} Key={Key} Label={`Pose · ${poseLabel(P, P.pose)}`} Minimum={0} Maximum={1} Step={0.01} />;
          if (Param.type === "bool") return <Control key={Key} Field={{ Label: Param.label, Control: "Switch" }} Value={!!P[Key]} Change={(Next) => Write(Key, Next)} />;
          if (Param.type === "axis")
            return <Control key={Key} Field={{ Label: "Axis", Control: "Select", Options: ["X", "Y", "Z"] }} Value={["X", "Y", "Z"].indexOf(P.axis)} Change={(Index) => Write("axis", ["X", "Y", "Z"][Index])} />;
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
      </Card>
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

//============================================================================================================================================
//                                                          VEHICLECOMPONENTS.JSX
//============================================================================================================================================
// 🚗 The Vehicle folder: the Component Viewer's ControlVehicle class as outliner rows with their own inspectors, in the Component Viewer's
// own tree (Follow-up 63): the Body, and on it each wheel's Suspension (Spring socket), the front wheels' Steer (Hinge socket), the Wheel
// (the tyre mesh) and its Rim; the Tow Hitch and the lights. Collision belongs to the object and movement to the game, so neither is a
// component here. Component data, defaults and socket parameters come straight from
// Experimental/ComponentViewer (Blueprint.js, Sockets.js); the icons are the baked EngineContent set. Browser authoring only.

import React, { useRef } from "react";
import { COMPONENT_CLASSES, VEHICLE_SHEET, createComponent } from "../ComponentViewer/Blueprint.js";
import { ControlVehicleCentres, ControlVehicleMeasures, PartCentre } from "./ControlVehicleModel.js";
import { Carousel, OverviewPage, Card as PageCard, BigFigure } from "./PrimitiveInspector.jsx";
import TransformPanel from "./TransformPanel.jsx";
import MaterialPanel from "./MaterialPanel.jsx";
import { SOCKET_KINDS, SOCKET_KIND, SOCKET_FIELDS, SOCKET_PARAMS, DRIVES, DOCK_COLORS, socketDefaults, poseLabel, createSocketState, socketReadout } from "../ComponentViewer/Sockets.js";

export const VehiclePanel = "vehicle-component";
export const VehicleSheet = [];

// Id, name, component class, baked icon, description, extra row fields (Parent is the component it hangs from). Each wheel hangs from a
// Spring socket at its axle mount, the front ones turn on a Hinge socket between the spring and the wheel, and the rim sits in the tyre,
// as in BP_ControlVehicle (Experimental/ComponentViewer/Main.js). Masses: the body 1,220 kg, each tyre 20 kg, each rim 9 kg.
export const VehicleOwner = "vehicle";
export const Corners = ["FL", "FR", "RL", "RR"]; // VEHICLE_SHEET.axleMount order
const Middle = (VEHICLE_SHEET.axleMount[0][0] + VEHICLE_SHEET.axleMount[2][0]) / 2;
const CornerMount = (Corner) => +(VEHICLE_SHEET.axleMount[Corner][0] - Middle).toFixed(3);
const Components = [
  ["vehicle-body", "Body", "StaticMesh", "vehicle-component-body", "Static Mesh · ControlVehicle Body", { Parent: VehicleOwner, Asset: "Body", Mass: 1220 }],
  ...Corners.flatMap((Name, Corner) => {
    const Slug = Name.toLowerCase(), Front = Corner < 2, Mount = CornerMount(Corner);
    const Holder = Front ? `vehicle-steer-${Slug}` : `vehicle-suspension-${Slug}`;
    return [
      [`vehicle-suspension-${Slug}`, `Suspension${Name}`, "Socket", "vehicle-component-spring", "Spring socket · suspension strut", { Parent: "vehicle-body", Joint: "spring", Mount, Corner }],
      ...(Front ? [[`vehicle-steer-${Slug}`, `Steer${Name}`, "Socket", "vehicle-component-hinge", "Hinge socket · steering knuckle", { Parent: `vehicle-suspension-${Slug}`, Joint: "hinge", Mount, Corner }]] : []),
      [`vehicle-wheel-${Slug}`, `Wheel${Name}`, "StaticMesh", "vehicle-component-tyre", "Static Mesh · ControlVehicle Tyre", { Parent: Holder, Asset: "Tyre", Mass: 20, Corner }],
      [`vehicle-rim-${Slug}`, `Wheel${Name}Rim`, "StaticMesh", "vehicle-component-rim", "Static Mesh · ControlVehicle Rim", { Parent: `vehicle-wheel-${Slug}`, Asset: "Rim", Mass: 9, Corner }],
    ];
  }),
  ["vehicle-tow", "Tow Hitch", "Socket", "vehicle-component-dock", "Dock socket · trailer coupling", { Parent: "vehicle-body", Joint: "dock", Mount: -3.2 }],
  ["vehicle-headlights", "Headlights", "SpotLight", "vehicle-component-spot-light", "Spot light pair", { Parent: "vehicle-body" }],
  ["vehicle-brake", "Brake Lights", "PointLight", "vehicle-component-point-light", "Point light pair · rear", { Parent: "vehicle-body" }],
];
// Follow-up 60: the level's vehicles sit in a Vehicles folder. The Controlled Vehicle (the player's, which keeps Id "vehicle" and holds
// the Component Viewer's ControlVehicle components) is a vehicle model like the others (VehicleAssets.js, VehicleAssetInspector.jsx).
export const VehiclesFolder = { Id: "vehicles", Name: "Vehicles", Panel: "group", Icon: "folder-generic", Parent: null, Description: "Level vehicles" };
export const VehicleFolder = { Id: "vehicle", Name: "Controlled Vehicle", Panel: "vehicle-asset", Icon: "asset-vehicle-controlled", Parent: "vehicles", Model: "controlled", Description: "The player's vehicle · Control Vehicle class" };
export const ParkedVehicles = [
  { Id: "offroad-vehicle", Name: "Off-road Vehicle", Panel: "vehicle-asset", Icon: "asset-vehicle-offroad", Parent: "vehicles", Model: "offroad", Description: "4×4 wagon · parked" },
  { Id: "pickup-truck", Name: "Pickup Truck", Panel: "vehicle-asset", Icon: "asset-vehicle-pickup", Parent: "vehicles", Model: "pickup", Description: "Double-cab pickup · parked" },
];
// A fresh scene's vehicle rows: the folder, the Controlled Vehicle and its components, then the parked vehicles.
export const InitialVehicleRows = () => [{ ...VehiclesFolder }, { ...VehicleFolder }, ...VehicleRows.map((Row) => ({ ...Row })), ...ParkedVehicles.map((Row) => ({ ...Row }))];
export const VehicleRows = Components.map(([Id, Name, Component, Icon, Description, Extra = {}]) => ({
  Id,
  Name,
  Panel: VehiclePanel,
  Icon,
  Description,
  Component,
  ...Extra,
}));

// Whether a row is the Controlled Vehicle or one of its components (at any depth), and the components under a row, depth first, each
// with its depth below the vehicle.
export function InVehicleTree(Rows, Row) {
  const Seen = new Set();
  for (let At = Row; At && !Seen.has(At.Id); At = Rows.find((Each) => Each.Id === At.Parent)) {
    if (At.Id === VehicleOwner) return true;
    Seen.add(At.Id);
  }
  return false;
}
export function VehicleDescendants(Rows, Id = VehicleOwner, Depth = 1, Seen = new Set()) {
  return Rows.filter((Row) => Row.Parent === Id && Row.Panel === VehiclePanel && !Seen.has(Row.Id)).flatMap((Row) => {
    Seen.add(Row.Id);
    return [{ Row, Depth }, ...VehicleDescendants(Rows, Row.Id, Depth + 1, Seen)];
  });
}

// Rows retired from the Vehicle folder; removed from saved scenes on load. Revision 4 retires Vehicle Movement, the chassis collision and
// the single front Suspension and Steering sockets (and any collision or movement component added to the vehicle).
const RetiredRows = new Set(["vehicle-bumper", "vehicle-movement", "vehicle-collision", "vehicle-suspension", "vehicle-steering"]);
const RetiredClasses = new Set(["VehicleMovement", "BoxCollision", "SphereCollision"]);

// Added once per saved scene (VehicleRevision), so a later deletion is respected: revision 1 brought the Vehicle folder and its
// components; revision 2 the Vehicles folder, with the old Vehicle folder turned into the Controlled Vehicle and two parked vehicles;
// revision 3 moves the Tow Hitch from inside the body to the ControlVehicle's tail (−2.6 → −3.2 m), unless it was moved by hand;
// revision 4 (Follow-up 63) builds the Component Viewer's tree: each wheel's suspension, steering, tyre and rim, everything else on the
// Body, which now hangs the rest of the vehicle.
export const VehicleRevision = 4;
export function EnsureVehicleFolder(Rows = [], Revision) {
  if (!Array.isArray(Rows)) return Rows;
  let Kept = Rows.filter((Row) => !RetiredRows.has(Row?.Id) && !(Row?.Panel === VehiclePanel && RetiredClasses.has(Row.Component)));
  if (!(Revision >= 1) && !Kept.some((Row) => Row?.Id === "vehicle")) Kept = [...Kept, { ...VehicleFolder }, ...VehicleRows.map((Row) => ({ ...Row }))];
  if (!(Revision >= 2) && !Kept.some((Row) => Row?.Id === "vehicles")) {
    const At = Kept.findIndex((Row) => Row?.Id === "vehicle");
    Kept = Kept.map((Row) =>
      Row?.Id === "vehicle" && Row.Panel === "group"
        ? { ...Row, ...VehicleFolder, Name: Row.Name === "Vehicle" ? VehicleFolder.Name : Row.Name }
        : Row,
    );
    Kept.splice(At < 0 ? Kept.length : At, 0, { ...VehiclesFolder });
    Kept.push(...ParkedVehicles.filter((Row) => !Kept.some((Each) => Each?.Id === Row.Id)).map((Row) => ({ ...Row })));
  }
  if (!(Revision >= 3)) Kept = Kept.map((Row) => (Row?.Id === "vehicle-tow" && Row.Mount === -2.6 ? { ...Row, Mount: -3.2 } : Row));
  if (!(Revision >= 4) && Kept.some((Row) => Row?.Id === VehicleOwner)) {
    const Ids = new Set(Kept.map((Row) => Row?.Id));
    // Components that hung straight off the vehicle move onto the Body; the wheel rows go in after the Body.
    if (Ids.has("vehicle-body")) Kept = Kept.map((Row) => (Row?.Panel === VehiclePanel && Row.Parent === VehicleOwner && Row.Id !== "vehicle-body" ? { ...Row, Parent: "vehicle-body" } : Row));
    const Missing = VehicleRows.filter((Row) => !Ids.has(Row.Id) && (Row.Parent !== "vehicle-body" || Ids.has("vehicle-body") || Row.Id === "vehicle-body")).map((Row) => ({ ...Row }));
    const After = Kept.findIndex((Row) => Row?.Id === (Ids.has("vehicle-body") ? "vehicle-body" : VehicleOwner));
    Kept.splice(After < 0 ? Kept.length : After + 1, 0, ...Missing);
  }
  return Kept;
}

// Socket mounts for rows saved before rows carried one (metres ahead of the wheelbase centre).
const DefaultMounts = { "vehicle-tow": -3.2 };
const MountOf = (Row) => Row.Mount ?? DefaultMounts[Row.Id] ?? 0;

// Defaults straight from the Component Viewer's classes.
const DefaultCache = new Map();
function Defaults(Row) {
  const Key = Row.Component + ":" + (Row.Joint || "") + ":" + MountOf(Row) + ":" + (Row.Mass ?? "");
  if (!DefaultCache.has(Key)) {
    const Props = createComponent(Row.Component, Row.Name).props;
    if (Row.Component === "Socket") Object.assign(Props, socketDefaults(Row.Joint || "fixed"), Row.Joint === "hinge" ? { angleMin: -35, angleMax: 35 } : {}, { mount: MountOf(Row) });
    if (Row.Component === "StaticMesh") Object.assign(Props, { mass: Row.Mass ?? 0, slots: {} });
    DefaultCache.set(Key, Props);
  }
  return DefaultCache.get(Key);
}
// A socket is attached to the component it hangs from (the Body when it hangs from the vehicle itself).
const DefaultAttach = (Row) => (Row.Parent && Row.Parent !== VehicleOwner ? Row.Parent : "vehicle-body");
const Reader = (Row, Values) => (Key) => (Values[Key] === undefined ? Defaults(Row)[Key] : Values[Key]);
// For the Component Viewer (VehicleComponentViewer.jsx): one component's value (saved or its class default), and a socket's full
// parameters with its mount.
export const ComponentReader = Reader;
export function SocketParameters(Row, Values = {}) {
  const V = Reader(Row, Values);
  const P = { ...socketDefaults(V("kind") || "fixed"), ...Object.fromEntries(Object.keys(SOCKET_PARAMS).concat("kind").map((Key) => [Key, V(Key)]).filter(([, Amount]) => Amount !== undefined)) };
  return { ...P, Mount: Number.isFinite(+V("mount")) ? +V("mount") : 0 };
}

// Follow-up 62: each component's icon (Images/VehicleComponentIcons), by class, for a socket by its current type and for a mesh by its
// asset (the body, a tyre or a rim).
const ClassIcons = { StaticMesh: "body", SpotLight: "spot-light", PointLight: "point-light" };
const AssetIcons = { Body: "body", Tyre: "tyre", Rim: "rim" };
export function ComponentIcon(Row, Values = {}) {
  if (!Row || Row.Panel !== VehiclePanel) return Row?.Icon;
  if (Row.Component === "Socket") return "vehicle-component-" + (Reader(Row, Values)("kind") || "fixed");
  if (Row.Component === "StaticMesh") return "vehicle-component-" + (AssetIcons[Row.Asset] || "body");
  return ClassIcons[Row.Component] ? "vehicle-component-" + ClassIcons[Row.Component] : Row.Icon;
}
// A mesh component's asset name, centre of mass in vehicle space at rest and mass.
export const MeshAssets = { Body: "ControlVehicle Body", Tyre: "ControlVehicle Tyre", Rim: "ControlVehicle Rim" };
export function MeshMass(Row, Values = {}) {
  return Math.max(0, +Reader(Row, Values)("mass") || 0);
}
// Follow-up 70: a mesh's centre of mass is measured from its volume unless its inspector moves it ("Centre of mass", vehicle space, m).
export const RestingCentre = (Row) => PartCentre(Row.Asset || "Body", Row.Corner ?? 0);
export function MeshCentre(Row, Values = {}) {
  const Moved = Values["Centre of mass"];
  return Array.isArray(Moved) && Moved.length === 3 && Moved.every((Each) => Number.isFinite(+Each)) ? Moved.map(Number) : RestingCentre(Row);
}

export function VehicleSummary(Row, Values = {}) {
  const V = Reader(Row, Values);
  switch (Row.Component) {
    case "Socket":
      {
      const Id = Values.attach ?? Row.Attach ?? DefaultAttach(Row);
      return `${SOCKET_KIND[V("kind")]?.label || "Fixed"} socket · on ${VehicleRows.find((Each) => Each.Id === Id)?.Name || "another asset"}`;
    }
    case "StaticMesh":
      return `${MeshAssets[Row.Asset] || MeshAssets.Body} · ${Fixed(MeshMass(Row, Values))} kg`;
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

//------------------------------------------------------------------------------------------------------------------------
//                                                   SOCKETS
//------------------------------------------------------------------------------------------------------------------------

// A socket inspector is four cards: the joint drawn at its pose (drag to set it), the socket type, the range it may move
// through, and the asset it is attached to. Everything is drawn from the settings and nothing animates here; the joint
// moves in Simulate, through the Component Viewer's own stepSocket.

const Degree = Math.PI / 180;
const RoadSpeed = 50 / 3.6; // vehicle-driven spin is quoted at 50 km/h

// The joint resting in its pose: where stepSocket settles with no drive input.
function PosedJoint(P) {
  const S = createSocketState();
  const Clamp = (Amount) => Math.min(1, Math.max(0, Amount));
  switch (P.kind) {
    case "hinge":
      S.angle = Lerp(P.angleMin, P.angleMax, Clamp(P.pose));
      break;
    case "slider":
      S.travel = Lerp(P.travelMin, P.travelMax, Clamp(P.pose));
      break;
    case "ball":
      S.theta = P.cone * Degree * Clamp(P.pose);
      break;
    case "spring":
      S.x = Lerp(-P.springTravel, P.springTravel, Clamp(P.pose)) * 0.5;
      break;
    case "spin":
      S.rate = P.spinSource === "vehicle" ? RoadSpeed / Math.max(0.05, P.spinRadius) : (P.rpm * 2 * Math.PI) / 60;
      break;
    case "tether":
      S.theta = P.swing * Degree;
      break;
    case "dock":
      Object.assign(S.dock, { phase: P.connected ? "connected" : "released", gap: P.connected ? 0 : Math.max(0.05, P.snapRadius) * 1.8 });
      break;
  }
  return S;
}

// The single number each socket kind is about, with the range it may take.
function Quantity(P, S) {
  switch (P.kind) {
    case "hinge":
      return { Value: S.angle, Low: Math.min(P.angleMin, P.angleMax), High: Math.max(P.angleMin, P.angleMax), Unit: "°", Digits: 0, Caption: `posed angle · ${P.angleMin}° to ${P.angleMax}°` };
    case "slider":
      return { Value: S.travel * 1000, Low: Math.min(P.travelMin, P.travelMax) * 1000, High: Math.max(P.travelMin, P.travelMax) * 1000, Unit: "mm", Digits: 0, Caption: "along the rail from the mount" };
    case "ball":
      return { Value: S.theta / Degree, Low: 0, High: P.cone, Unit: "°", Digits: 0, Caption: `tilt inside the ${P.cone}° cone` };
    case "spring":
      return { Value: S.x * 1000, Low: -P.springTravel * 1000, High: P.springTravel * 1000, Unit: "mm", Digits: 0, Caption: S.x > 0.0005 ? "preloaded toward the bump stop" : S.x < -0.0005 ? "set toward full droop" : "rests at ride height" };
    case "spin": {
      const Peak = P.spinSource === "vehicle" ? (RoadSpeed / Math.max(0.05, P.spinRadius)) * (60 / (2 * Math.PI)) : Math.max(10, Math.abs(P.rpm));
      return { Value: ((S.rate || 0) * 60) / (2 * Math.PI), Low: -Peak, High: Peak, Unit: "rpm", Digits: 0, Caption: P.spinSource === "vehicle" ? "follows road speed · shown at 50 km/h" : "fixed rate" };
    }
    case "tether":
      return { Value: S.theta / Degree, Low: -90, High: 90, Unit: "°", Digits: 0, Caption: S.theta > 0 ? "starts trailing backwards" : S.theta < 0 ? "starts swung forwards" : "hangs straight" };
    case "dock":
      return { Value: S.dock.load / 1000, Low: 0, High: (P.breakForce * 1.2) / 1000, Unit: "kN", Digits: 2, Caption: `breaks at ${(P.breakForce / 1000).toFixed(2)} kN` };
  }
  return { Value: 0, Low: -1, High: 1, Unit: "", Digits: 0, Caption: "children ride along exactly" };
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
      return (
        <>
          <rect x={Face} y="48" width={P.snapRadius * Scale} height="48" fill={Colour + "12"} stroke={Colour} strokeDasharray="3 3" />
          <text x={Face + 4} y="42">snap {P.snapRadius.toFixed(2)} m</text>
          <rect x="84" y="50" width={Face - 84} height="44" rx="6" fill="#262626" stroke="#8a8a8a" />
          <rect x={Face + S.dock.gap * Scale} y="56" width="40" height="32" rx="7" fill="#ededed" stroke={Tint} strokeWidth="2.5" className="vc-grip" />
          <text x="160" y="124" textAnchor="middle">{P.connected ? `holds up to ${(P.breakForce / 1000).toFixed(2)} kN` : `snaps home inside ${P.snapRadius.toFixed(2)} m`}</text>
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

function SocketPose({ Kit, P, S, Write }) {
  const { Card, Metric } = Kit;
  const Variant = SOCKET_KIND[P.kind] || SOCKET_KIND.fixed, Colour = Variant.color;
  const Q = Quantity(P, S);
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
  const Draggable = !!DragToProperties(P, 0, 0);
  const Handlers = {
    onPointerDown: (Event) => {
      if (P.kind === "dock") return Write("connected", !P.connected);
      if (!Draggable) return;
      Dragging.current = true;
      Event.currentTarget.setPointerCapture(Event.pointerId);
      Apply(Event);
    },
    onPointerMove: (Event) => Dragging.current && Apply(Event),
    onPointerUp: () => (Dragging.current = false),
  };
  const Hint = { hinge: "drag the arm to set the pose", slider: "drag the carriage to set the pose", ball: "drag the stick to set the tilt", spring: "drag the plate to set the preload", tether: "drag the weight to set the starting swing", dock: "click to connect or release" }[P.kind];
  const Shown = Q.Value.toFixed(Q.Digits).replace(/^-0(\.0+)?$/, "0").replace("-", "−");
  const Word = P.kind === "dock" ? (P.connected ? "Connected" : "Released") : P.kind === "fixed" ? "Rigid" : null;
  return (
    <Card Title={`${Variant.label} socket`} Class="vc-card vc-socket-pose">
      <svg ref={Svg} className={"vc-visual vc-socket-scene" + (Draggable || P.kind === "dock" ? " vc-draggable" : "")} viewBox="0 0 320 150" role="img" aria-label={`${Variant.label} socket at its pose`} {...Handlers}>
        <defs>
          <marker id="VcArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#e8e8e8" />
          </marker>
        </defs>
        <text x="16" y="18">axis {P.axis}</text>
        <text x="304" y="18" textAnchor="end">{socketReadout(P, S)}</text>
        <SocketScene P={P} S={S} Colour={Colour} Peak={0} />
      </svg>
      <Metric Value={Word || Shown} Unit={Word ? "" : Q.Unit} Caption={[Q.Caption, Hint].filter(Boolean).join(" · ")} />
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
      {P.kind !== "dock" && <RangeStrip P={P} Q={Quantity(P, S)} Colour={Variant.color} />}
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

// The asset this socket hangs from, as a link: one click selects it. No picture of the vehicle; the offset is numeric.
function AttachmentTarget(Row, Rows, Values) {
  const Id = Values?.attach ?? Row.Attach ?? DefaultAttach(Row);
  return { Id, Target: Rows.find((Each) => Each.Id === Id) || null };
}
const ComponentLabel = (Row) => COMPONENT_CLASSES[Row?.Component]?.label || (Row?.Panel === "group" ? "Folder" : "Asset");

function SocketAttachment({ Kit, P, Mount, Write, Row, Scene, Values }) {
  const { Card, Control, Icon } = Kit;
  const Rows = Scene?.Rows || [];
  const { Id, Target } = AttachmentTarget(Row, Rows, Values);
  const Candidates = Rows.filter((Each) => Each.Id !== Row.Id && Each.Component !== "Socket" && (Each.Parent === Row.Parent || Each.Id === Row.Parent));
  const Choice = Math.max(0, Candidates.findIndex((Each) => Each.Id === Id));
  return (
    <Card Title="Attached to" Class="vc-card vc-attachment">
      {Target ? (
        <button type="button" className="vc-asset-link" onClick={() => Scene?.SelectRow?.(Target.Id)} title={`Select ${Target.Name}`} data-target={Target.Id}>
          {Icon && <Icon Name={Target.Icon} Size={22} />}
          <span>
            <b>{Target.Name}</b>
            <small>{ComponentLabel(Target)}</small>
          </span>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <p className="vc-asset-link vc-missing">{Id ? "The attached asset was removed" : "Not attached"}</p>
      )}
      {Candidates.length > 1 && (
        <Control Field={{ Label: "Attach to", Control: "Select", Options: Candidates.map((Each) => Each.Name) }} Value={Choice} Change={(Index) => Write("attach", Candidates[Index].Id)} />
      )}
      <Slider Kit={Kit} V={() => Mount} Write={Write} Key="mount" Label="Offset along X" Minimum={-3.4} Maximum={3.4} Step={0.01} Unit="m" />
      <Control Field={{ Label: "Joint axis", Control: "Select", Options: ["X", "Y", "Z"] }} Value={["X", "Y", "Z"].indexOf(P.axis)} Change={(Index) => Write("axis", ["X", "Y", "Z"][Index])} />
    </Card>
  );
}

function SocketInspector({ Kit, V, Write, Row, Scene, Values }) {
  const P = { ...socketDefaults(V("kind") || "fixed"), ...Object.fromEntries(Object.keys(SOCKET_PARAMS).concat("kind").map((Key) => [Key, V(Key)]).filter(([, Value]) => Value !== undefined)) };
  const Mount = Number.isFinite(+V("mount")) ? +V("mount") : 0;
  const S = PosedJoint(P);
  return (
    <>
      <SocketPose Kit={Kit} P={P} S={S} Write={Write} />
      <SocketType Kit={Kit} P={P} Write={Write} />
      <SocketRange Kit={Kit} P={P} Write={Write} S={S} />
      <SocketAttachment Kit={Kit} P={P} Mount={Mount} Write={Write} Row={Row} Scene={Scene} Values={Values} />
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   LIGHTS, MESHES
//------------------------------------------------------------------------------------------------------------------------

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

// Follow-up 70: a mesh component (the body, a tyre or a rim) is inspected like an object in the scene: the same carousel and pages
// (Overview with its checks, tags, quick controls and notes; Geometry; Material with its slots; Physics, where the mass and a transform
// for the centre of mass live; LOD), with the facts measured from its own mesh.
const PartSections = [
  ["overview", "Overview", "overview", "#7cb7ff"],
  ["geometry", "Geometry", "geometry", "#5fe0a0"],
  ["material", "Material", "material", "#ff7eb6"],
  ["physics", "Physics", "physics", "#ffb238"],
  ["lod", "LOD", "lod", "#edc181"],
];
const PartProfiles = {
  Body: { Purpose: "The Controlled Vehicle's bodywork: paint, glass, trim and lights in one mesh.", Reason: "It carries most of the vehicle's mass and sets its silhouette, its collision box and its centre of mass.", Normals: "Angle-weighted (34°)", Collision: "Box" },
  Tyre: { Purpose: "One wheel's tyre: the rubber that meets the road.", Reason: "Its radius sets the rolling speed and its mass the wheel's spin inertia.", Normals: "Smooth", Collision: "Box" },
  Rim: { Purpose: "One wheel's rim: the alloy spokes and hub inside the tyre.", Reason: "It turns with the tyre and adds to the wheel's spin inertia.", Normals: "Angle-weighted (40°)", Collision: "None" },
};
const PartKeys = { "Cast shadows": "castShadow", PHYSICS: "simulatePhysics" };
function MeshInspector({ Kit, V, Write, Row, Values, Hidden = false, ToggleHidden = () => undefined, OpenShader = null }) {
  const { Card, Control, Metric } = Kit;
  const Asset = Row.Asset || "Body";
  const Size = ControlVehicleMeasures()[Asset] || ControlVehicleMeasures().Body;
  const Info = PartProfiles[Asset] || PartProfiles.Body;
  const Lod = Math.round(+V("lod"));
  const Presets = ClassField("StaticMesh", "collisionPreset").options;
  const Triangles = ControlVehicleCentres().Triangles[Asset] || Size.Triangles;
  const Resting = RestingCentre(Row);
  const Centre = MeshCentre(Row, Values);
  const Moved = Centre.some((Each, Axis) => Math.abs(Each - Resting[Axis]) > 1e-4);
  const Mass = MeshMass(Row, {});
  const MassValue = Math.max(0, +V("mass") || 0);
  const Side = Asset === "Body" ? [-3.4, 3.4] : [Resting[0] - 0.7, Resting[0] + 0.7];
  const Across = (X) => 20 + ((X - Side[0]) / (Side[1] - Side[0])) * 280;
  const Up = (Y) => 104 - (Y / (Asset === "Body" ? 1.9 : 1.1)) * 88;
  // The object pages read their usual keys; the mesh's own (castShadow, simulatePhysics) stand behind them.
  const Shown = { ...Values, "Cast shadows": !!V("castShadow"), PHYSICS: !!V("simulatePhysics"), Tags: Array.isArray(Values.Tags) ? Values.Tags : ["vehicle", Asset.toLowerCase()] };
  const Change = (Key, Next) => Write(PartKeys[Key] || Key, Next);
  const Read = (Key, Initial) => (Shown[Key] === undefined ? Initial : Shown[Key]);
  const Profile = { Name: MeshAssets[Asset], Tags: Shown.Tags, Purpose: Info.Purpose, Reason: Info.Reason };
  const Fixed2 = (Amount) => Fixed(Amount, 2);
  const Pages = {
    overview: <OverviewPage Shape="cube" Read={Read} Change={Change} Values={Shown} Hidden={Hidden} ToggleHidden={ToggleHidden} Size={Size} Profile={Profile} />,
    geometry: (
      <>
        <PageCard Title="Mesh" Glyph="ruler" Tone="#5fe0a0" Aside={MeshAssets[Asset]}>
          <BigFigure Whole={Fixed(Triangles)} Unit="tris" Caption="Triangles at full detail" />
          <div className="pi-stat-grid">
            <div><span>Vertices</span><b>{Fixed(Size.Vertices)}</b></div>
            <div><span>Surface</span><b>{Size.Closed ? "Closed" : "Open"}</b></div>
            <div><span>Materials</span><b>{1 + (Array.isArray(Values.MaterialSlots) ? Values.MaterialSlots.length : 0)}</b></div>
          </div>
          <p className="pi-footnote">Facet mesh · {Info.Normals} normals · {Info.Collision.toLowerCase()} collision in the source asset.</p>
        </PageCard>
        <PageCard Title="Footprint" Glyph="ruler" Tone="#5fe0a0" Aside="Mesh bounds">
          <BigFigure Whole={Fixed(Size.Volume, 3)} Unit="m³" Caption={Size.Closed ? "Volume" : "Volume (open surface, an estimate)"} />
          <div className="pi-stat-grid">
            <div><span>Length</span><b>{Fixed2(Size.Bounds[0])}<small> m</small></b></div>
            <div><span>Height</span><b>{Fixed2(Size.Bounds[1])}<small> m</small></b></div>
            <div><span>Width</span><b>{Fixed2(Size.Bounds[2])}<small> m</small></b></div>
          </div>
          <p className="pi-footnote">Surface ≈ {Fixed2(Size.Area)} m².</p>
        </PageCard>
      </>
    ),
    material: <MaterialPanel Subject={Row} Values={Values} Change={Write} Expand={OpenShader || undefined} Compact />,
    physics: (
      <>
        <Card Title="Mass and centre of mass" Class="vc-card vc-mass-card">
          <svg className="vc-visual" viewBox="0 0 320 120" role="img" aria-label="Centre of mass from the side">
            <line x1="12" y1="104" x2="308" y2="104" stroke="#ffffff30" />
            {Moved && <circle cx={Across(Resting[0])} cy={Up(Resting[1])} r="6" fill="none" stroke="#ffffff50" strokeDasharray="2 2" />}
            <line x1={Across(Centre[0])} y1={Up(Centre[1])} x2={Across(Centre[0])} y2="104" stroke="#7fd1ff" strokeDasharray="3 3" />
            <g transform={`translate(${Across(Centre[0])} ${Up(Centre[1])})`}>
              <circle r="9" fill="#f2f2f2" />
              <path d="M0 0V-9A9 9 0 0 1 9 0ZM0 0V9A9 9 0 0 1 -9 0Z" fill="#16171b" />
              <circle r="9" fill="none" stroke="#7fd1ff" strokeWidth="1.2" />
            </g>
            <text x={Across(Centre[0]) + 14} y={Up(Centre[1]) - 10}>{Centre[1].toFixed(2)} m up</text>
          </svg>
          <Metric Value={Fixed(MassValue)} Unit="kg" Caption={`Centre of mass ${Centre.map((Each) => Each.toFixed(2)).join(", ")} m · ${Moved ? "moved by hand" : "from the mesh volume"}`} />
          <Slider Kit={Kit} V={V} Write={Write} Key="mass" Label="Mass" Minimum={0} Maximum={Asset === "Body" ? 3000 : 80} Step={1} Unit="kg" />
          <Readouts Kit={Kit} Rows={[["Ahead of the body centre", `${Centre[0].toFixed(3)} m`], ["Above the ground", `${Centre[1].toFixed(3)} m`], ["Across (right +)", `${Centre[2].toFixed(3)} m`], ["Default mass", `${Fixed(Mass)} kg`]]} />
        </Card>
        <div className="vc-centre-transform" data-centre-transform>
          <TransformPanel
            Values={{ ...Values, "Centre of mass": Centre.map((Each) => +Each.toFixed(3)) }}
            Change={Write}
            Title="Centre of mass"
            Space="VEHICLE SPACE"
            Rows={[["Centre of mass", "m", Resting.map((Each) => +Each.toFixed(3)), -6, 6, 0.005]]}
            Note={Moved ? `Moved ${Centre.map((Each, Axis) => (Each - Resting[Axis] >= 0 ? "+" : "") + (Each - Resting[Axis]).toFixed(3)).join(", ")} m from the mesh volume's centre. The marker in the view follows it.` : "Measured from the mesh volume. Type or drag to move it; the marker in the view follows."}
          />
        </div>
        <Card Title="Collision and simulation" Class="vc-card">
          <Control Field={{ Label: "Collision preset", Control: "Select", Options: Presets }} Value={Math.max(0, Presets.indexOf(V("collisionPreset")))} Change={(Index) => Write("collisionPreset", Presets[Index])} />
          <Control Field={{ Label: "Simulate physics", Control: "Switch" }} Value={!!V("simulatePhysics")} Change={(Next) => Write("simulatePhysics", Next)} />
          <Control Field={{ Label: "Cast shadow", Control: "Switch" }} Value={!!V("castShadow")} Change={(Next) => Write("castShadow", Next)} />
        </Card>
      </>
    ),
    lod: (
      <Card Title="Static mesh" Class="vc-card">
        <svg className="vc-visual" viewBox="0 0 320 120" role="img" aria-label="Level of detail chain">
          {Array.from({ length: 6 }, (_, Index) => {
            const Width = 44 - Index * 4, X = 18 + Index * 50, Active = Lod < 0 ? Index === 0 : Index === Lod;
            return (
              <g key={Index} opacity={Active ? 1 : 0.45}>
                <rect x={X} y={60 - Width / 2} width={Width} height={Width} rx="10" fill={Active ? "#3a3a3a" : "#222"} stroke={Active ? "#f0f0f0" : "#777"} />
                <text x={X + Width / 2} y="104" textAnchor="middle">LOD{Index}</text>
                <text x={X + Width / 2} y="116" textAnchor="middle">{Fixed(Triangles / 2 ** Index / 1000, 1)}k</text>
              </g>
            );
          })}
        </svg>
        <Metric Value={Lod < 0 ? "Auto" : "LOD " + Lod} Unit="" Caption={`${MeshAssets[Asset]} · ${Lod < 0 ? "detail follows screen size" : `forced · about ${Fixed(Triangles / 2 ** Math.min(Lod, 5))} triangles`}`} />
        <ClassSlider Kit={Kit} V={V} Write={Write} Type="StaticMesh" Key="lod" />
      </Card>
    ),
  };
  return (
    <div className="primitive-inspector part-component-inspector">
      <Carousel key={Row.Id} Sections={PartSections} Pages={Pages} Summary={{ Triangles: Fixed(Triangles), Vertices: Fixed(Size.Vertices), Motion: V("simulatePhysics") ? "Dynamic" : "Static" }} />
    </div>
  );
}

export function VehicleInspector({ Subject, Values, Change, Kit, Scene = null, Hidden = false, ToggleHidden, OpenShader = null }) {
  const V = Reader(Subject, Values);
  const Write = (Key, Next) => Change(Key, Next);
  const Wiring = { Kit, V, Write, Row: Subject, Scene, Values, Hidden, ToggleHidden, OpenShader };
  const Body =
    Subject.Component === "Socket" ? <SocketInspector {...Wiring} />
      : /Light/.test(Subject.Component) ? <LightInspector {...Wiring} />
        : <MeshInspector {...Wiring} />;
  return (
    <div className="vehicle-inspector" data-component={Subject.Component}>
      {Body}
    </div>
  );
}

//============================================================================================================================================
//                                                         VEHICLECOMPONENTVIEWER.JSX
//============================================================================================================================================
// 🧩 The Component Viewer panel for the Controlled Vehicle (Follow-up 62), opened from its inspector or by choosing one of its components
// anywhere. Laid out like the Component Viewer (Experimental/ComponentViewer): its own Components outliner (the tree from the Origin
// through the Body to each wheel's suspension, steering, tyre and rim, as in BP_ControlVehicle; Add for native classes, search, eye,
// Delete), the vehicle view, and its own Details, where the chosen component's native inspector edits it; the editor's own selection and
// inspector stay on the vehicle. The view shows the ControlVehicle (ControlVehicleModel.js) with each native component drawn where it
// sits and doing what its values say:
//   • Static Mesh (the Body, each Wheel's tyre and its Rim): the mesh itself, picked and hidden on its own; Cast shadow switches its
//     shadow. Each shows its centre of mass (Follow-up 63), and the Origin the whole vehicle's, weighed by each mesh's mass.
//   • Sockets: at their wheel (or on the centre line at their mount); a socket moves the wheels hung below it in the tree, so each
//     Suspension's spring lifts its own wheel to its pose (and meets bumps in Simulate) and each Steer hinge turns its own wheel.
//   • Tow Hitch (Dock socket): at its mount, connecting, releasing and pull-testing as set.
//   • Spot and Point lights: real lights at the head and tail lamps, with beams and glows in their colour, angle, intensity and range.
// Simulate drives a speed cycle that rolls the wheels. User components (with their own controls) are listed but not drawn. The socket
// looks and motion are the Component Viewer's own (SocketVisuals.js, Sockets.js); the Stage, beams and glows are Shared/Studio's.
// Browser authoring only.

import React, { useEffect, useRef, useState } from "react";
import { THREE, Stage } from "../Shared/Studio/Render.js";
import { beam, glowSprite, addHalo, anchorMark, markDebug } from "../Shared/Studio/Visuals.js";
import { ComMark } from "./DebugMarks.js";
import { socketVisual } from "../ComponentViewer/SocketVisuals.js";
import { createSocketState, stepSocket, socketPose, socketReadout, SOCKET_KIND } from "../ComponentViewer/Sockets.js";
import { COMPONENT_CLASSES } from "../ComponentViewer/Blueprint.js";
import { ControlVehicleParts, ControlVehicleSheet as Sheet, ControlVehicleCentres, Family } from "./ControlVehicleModel.js";
import { VEHICLE_SHEET } from "../ComponentViewer/Blueprint.js";
import { ComponentReader, SocketParameters, VehicleSummary, ComponentIcon, InVehicleTree, VehicleDescendants, VehicleOwner as Owner, MeshAssets, MeshMass, MeshCentre, RestingCentre } from "./VehicleComponents.jsx";
import { ResolveSlots } from "./MaterialSpecification.js";
import { PaintOf } from "./VehicleAssetInspector.jsx";
import "./VehicleComponentViewer.css";

const Rad = Math.PI / 180;
const Accent = "#ffb238";
const ComColour = "#7fd1ff";
const SocketScale = 2.2; // the Component Viewer's socket looks are sized for a desk; at car scale they're drawn bigger
const NativeClasses = new Set(["StaticMesh", "Socket", "SpotLight", "PointLight"]);
export { Owner as VehicleOwner };

// Where a socket sits: at its wheel when it belongs to one (Corner, 0–3 in VEHICLE_SHEET's axle mount order: front left, front right,
// rear left, rear right), along the car by its mount; otherwise on the centre line at its mount.
function SocketPoint(Mount, Corner) {
  const X = Sheet.Middle + Mount;
  const Wheel = VEHICLE_SHEET.axleMount[Corner];
  return Wheel ? [X, Sheet.AxleHeight, -Wheel[1]] : [X, 0.42, 0];
}
const Plumb = (Height, Colour) => {
  const Line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, Height, 6), new THREE.MeshBasicMaterial({ color: Colour, transparent: true, opacity: 0.7 }));
  Line.position.y = -Height / 2;
  return markDebug(Line);
};
const ClassLabel = (Row, Values) =>
  Row.Component === "Socket" ? `${SOCKET_KIND[ComponentReader(Row, Values)("kind")]?.label || "Fixed"} socket` : COMPONENT_CLASSES[Row.Component]?.label || "User component";

// Component classes the Add menu offers (native only; user components bring their own controls).
const AddChoices = [
  ["Lights", [["SpotLight", null, "Spot Light", "Spot light pair"], ["PointLight", null, "Point Light", "Point light pair"]]],
  ["Sockets", ["fixed", "hinge", "slider", "spring", "ball", "spin", "tether", "dock"].map((Joint) => ["Socket", Joint, `${SOCKET_KIND[Joint]?.label || Joint} Socket`, `${SOCKET_KIND[Joint]?.label || Joint} socket`])],
];
// A new component row with a free id and name, hung from the selected component (or the Body), like the Component Viewer's Add; on a
// wheel's branch it belongs to that wheel.
function NewComponent(Rows, [Component, Joint, Label, Description], Under) {
  const Slug = (Joint ? Joint + "-socket" : Label.toLowerCase().replace(/\s+/g, "-"));
  let Number_ = 1;
  while (Rows.some((Row) => Row.Id === `vehicle-${Slug}-${Number_}` || Row.Name === `${Label} ${Number_}`)) Number_++;
  const Holder = Rows.find((Row) => Row.Id === Under && Row.Id !== Owner && NativeClasses.has(Row.Component)) || Rows.find((Row) => Row.Id === "vehicle-body");
  const Corner = Holder?.Corner;
  return {
    Id: `vehicle-${Slug}-${Number_}`,
    Name: `${Label} ${Number_}`,
    Panel: "vehicle-component",
    Parent: Holder?.Id || Owner,
    Component,
    Description,
    Icon: "vehicle-component-" + (Joint || ClassIconName[Component]),
    ...(Joint ? { Joint, Mount: Corner === undefined ? 0 : +(VEHICLE_SHEET.axleMount[Corner][0] - Sheet.Middle).toFixed(3) } : {}),
    ...(Corner === undefined ? {} : { Corner }),
  };
}
const TriangleCount = () => {
  const Count = ControlVehicleCentres().Triangles;
  return Count.Body + 4 * (Count.Tyre + Count.Rim); // the ControlVehicle's body, four tyres and four rims
};
const Eye = ({ Off }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    {Off ? (
      <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4zM3 13 13 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    ) : (
      <>
        <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="1.8" fill="currentColor" />
      </>
    )}
  </svg>
);

// The Components outliner (the Component Viewer's own layout): heading, counts, Add and search, then the tree from the Origin through the
// Body to each wheel's suspension, steering, tyre and rim, each branch folding at its caret; user components follow; the eye hides a
// component in the view.
function ComponentOutliner({ Rows, Values, Hidden, Selected, Select, ToggleHidden, Icon, Add, Fit }) {
  const [Query, SetQuery] = useState("");
  const [Adding, ShowAdd] = useState(false);
  const [Folded, Fold] = useState(() => new Set());
  const Vehicle = Rows.find((Row) => Row.Id === Owner);
  const Tree = VehicleDescendants(Rows);
  const Mine = Tree.map((Each) => Each.Row);
  const Other = Mine.filter((Row) => !NativeClasses.has(Row.Component));
  const HasBranch = (Row) => Mine.some((Each) => Each.Parent === Row.Id && NativeClasses.has(Each.Component));
  const Needle = Query.trim().toLowerCase();
  const Matches = (Row) => !Needle || Row.Name.toLowerCase().includes(Needle) || ClassLabel(Row, Values[Row.Id] || {}).toLowerCase().includes(Needle);
  const Toggle = (Id) =>
    Fold((Previous) => {
      const Next = new Set(Previous);
      Next.has(Id) ? Next.delete(Id) : Next.add(Id);
      return Next;
    });
  const Line = (Row, Depth, { Root = false, Caret = false, User = false } = {}) =>
    Matches(Row) && (
      <div
        key={Row.Id}
        role="treeitem"
        aria-selected={Selected === Row.Id}
        aria-level={Depth + 1}
        aria-expanded={Caret ? !Folded.has(Row.Id) : undefined}
        tabIndex={0}
        className={"vcp-row" + (Selected === Row.Id ? " active" : "") + (Root ? " root" : "") + (Hidden[Row.Id] ? " off" : "")}
        style={{ paddingLeft: 10 + (Needle ? 0 : Depth) * 16, "--vcp-depth": Needle ? 0 : Depth }}
        data-vcv-row={Row.Id}
        data-depth={Depth}
        onClick={() => Select(Row.Id)}
        onDoubleClick={() => {
          Select(Row.Id);
          setTimeout(Fit, 40);
        }}
        onKeyDown={(Event) => {
          if (Event.key === "Enter") Select(Row.Id);
          if (Caret && (Event.key === "ArrowLeft" || Event.key === "ArrowRight") && Folded.has(Row.Id) === (Event.key === "ArrowRight")) Toggle(Row.Id);
        }}
      >
        <span
          className={"vcp-caret" + (Caret ? " on" : "")}
          data-vcp-caret={Caret ? Row.Id : undefined}
          onClick={(Event) => {
            if (!Caret) return;
            Event.stopPropagation();
            Toggle(Row.Id);
          }}
        >
          {Caret ? (Folded.has(Row.Id) ? "▸" : "▾") : ""}
        </span>
        {/* A mesh row shows a render of its mesh (VehiclePartIcon, on a transparent background); the rest show their class or socket icon. */}
        <span className="vcp-row-icon">
          <Icon Name={Root ? "vehicle-component-origin" : ComponentIcon(Row, Values[Row.Id] || {})} Size={!Root && Row.Component === "StaticMesh" ? 22 : 18} />
        </span>
        <span className="vcp-row-text">
          <b>
            {Root ? "Origin" : Row.Name}
            {Root && <em className="vcp-root-tag">ROOT</em>}
          </b>
          <small>{Root ? `${Vehicle?.Name || "Controlled Vehicle"} · ControlVehicle` : User ? "User component · its own controls" : Row.Component === "Socket" ? VehicleSummary(Row, Values[Row.Id] || {}) : Row.Component === "StaticMesh" ? VehicleSummary(Row, Values[Row.Id] || {}) : `${ClassLabel(Row, Values[Row.Id] || {})} · ${VehicleSummary(Row, Values[Row.Id] || {})}`}</small>
        </span>
        {!Root && !User ? (
          <button
            type="button"
            className={"vcp-eye" + (Hidden[Row.Id] ? " off" : "")}
            aria-label={(Hidden[Row.Id] ? "Show " : "Hide ") + Row.Name}
            aria-pressed={!Hidden[Row.Id]}
            onClick={(Event) => {
              Event.stopPropagation();
              ToggleHidden(Row.Id);
            }}
          >
            <Eye Off={Hidden[Row.Id]} />
          </button>
        ) : (
          <span />
        )}
      </div>
    );
  // One branch: each native component under Id, then (unless folded) its own branch.
  const Branch = (Id, Depth) =>
    Mine.filter((Row) => Row.Parent === Id && NativeClasses.has(Row.Component)).flatMap((Row) => {
      const Caret = HasBranch(Row);
      return [Line(Row, Depth, { Caret }), ...(Caret && (Needle || !Folded.has(Row.Id)) ? Branch(Row.Id, Depth + 1) : [])];
    });
  return (
    <section className="vcp-dock vcp-left" aria-label="Components">
      <div className="vcp-tabs">
        <span className="vcp-tab on">Components</span>
      </div>
      <div className="vcp-outliner-heading">
        <h1>Components</h1>
        <small>{Vehicle?.Name || "Controlled Vehicle"}</small>
      </div>
      <div className="vcp-stats">
        <div className="vcp-stat">
          <span className="vcp-disc on" aria-hidden="true">
            <svg viewBox="0 0 12 12" width="11" height="11"><path d="M6 1 10.5 3.5v5L6 11 1.5 8.5v-5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </span>
          <small>Components</small>
          <strong data-vcp-count>{Mine.length + 1}</strong>
        </div>
        <div className="vcp-stat">
          <span className="vcp-disc" aria-hidden="true">
            <svg viewBox="0 0 12 12" width="11" height="11"><path d="M1.5 9.5 6 2l4.5 7.5Z M3.75 5.75h4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          </span>
          <small>Triangles</small>
          <strong>{(TriangleCount() / 1000).toFixed(1)}k</strong>
        </div>
      </div>
      <div className="vcp-add-row">
        <button type="button" className="vcp-add" aria-expanded={Adding} onClick={() => ShowAdd(!Adding)}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Add
        </button>
        <label className="vcp-search">
          <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="m9.2 9.2 3.3 3.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          <input type="search" placeholder="Search components" aria-label="Search components" value={Query} onChange={(Event) => SetQuery(Event.target.value)} />
        </label>
      </div>
      {Adding && (
        <div className="vcp-add-menu" role="menu" aria-label="Add a native component">
          {AddChoices.map(([Group, Choices]) => (
            <React.Fragment key={Group}>
              <p className="vcp-menu-group">{Group.toUpperCase()}</p>
              {Choices.map((Choice) => (
                <button
                  key={Choice[2]}
                  type="button"
                  role="menuitem"
                  className="vcp-menu-item"
                  onClick={() => {
                    const Row = NewComponent(Rows, Choice, Selected);
                    Add(Row);
                    ShowAdd(false);
                    Select(Row.Id);
                  }}
                >
                  <Icon Name={"vehicle-component-" + (Choice[1] || ClassIconName[Choice[0]])} Size={18} />
                  <span>{Choice[2]}</span>
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="vcp-tree" role="tree" aria-label="Vehicle components">
        {Vehicle && Line(Vehicle, 0, { Root: true })}
        {Branch(Owner, 1)}
        {Other.length > 0 && (
          <div className="vcp-divider">
            <span>USER COMPONENTS</span>
            <span className="vcp-count">{Other.length}</span>
          </div>
        )}
        {Other.map((Row) => Line(Row, 0, { User: true }))}
      </div>
      <footer className="vcp-footer">
        <div>
          <i>CLICK</i>edit
        </div>
        <div>
          <i>DBL-CLICK · F</i>fit
        </div>
        <div>
          <i>DEL</i>remove
        </div>
      </footer>
    </section>
  );
}
const ClassIconName = { SpotLight: "spot-light", PointLight: "point-light" };

const Views = [
  ["Three-quarter", 38, 18],
  ["Side", 0, 4],
  ["Front", 90, 6],
  ["Top", 90, 88],
];

// The centre dock: the vehicle with its components drawn (the visual debugs), its heading and tools.
// Debug: the editor's debug-menu switches for the centre-of-mass marks and the socket gizmos (Follow-up 65); the toolbar's buttons
// flip the same switches.
function VehicleComponentView({ Rows, Values, Hidden, Selected, Select, Leave, Remove, Controls, Icon, Debug = null }) {
  const Host = useRef(null);
  const Tag = useRef(null);
  const Scene = useRef(null);
  const Latest = useRef({});
  const [Simulating, Simulate] = useState(false);
  const [XRay, SetXRay] = useState(false);
  const [OnlySelected, SetOnlySelected] = useState(false);
  const [OwnCentres, SetOwnCentres] = useState(true);
  const [OwnSockets, SetOwnSockets] = useState(true);
  const ShowCentres = Debug ? Debug.Centres : OwnCentres;
  const ShowSockets = Debug ? Debug.Sockets : OwnSockets;
  const SetShowCentres = (On) => (Debug ? Debug.Set("Centres", On) : SetOwnCentres(On));
  const SetShowSockets = (On) => (Debug ? Debug.Set("Sockets", On) : SetOwnSockets(On));
  const [Readout, SetReadout] = useState("");
  const Vehicle = Rows.find((Row) => Row.Id === Owner);
  const Mine = VehicleDescendants(Rows).map((Each) => Each.Row);
  const Paint = Vehicle ? PaintOf(Vehicle, Values[Owner] || {}) : "#c9d63a";
  Latest.current = { Rows, Values, Hidden, Selected, Select, Simulating, Mine };

  // The stage and the vehicle, once.
  useEffect(() => {
    const Canvas = document.createElement("canvas");
    Canvas.className = "vcv-canvas";
    Canvas.tabIndex = 0;
    Canvas.setAttribute("aria-label", "Component Viewer viewport");
    Host.current.prepend(Canvas);
    const View = new Stage(Canvas, { background: "#0c0d10", grid: true, shadows: true });
    View.sun.shadow.mapSize.set(1024, 1024);
    // A dark floor that takes the lamps' light (the stage's own ground only catches shadows).
    const Floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ color: "#16171b", roughness: 0.92 }));
    Floor.rotation.x = -Math.PI / 2;
    Floor.position.y = -0.003;
    Floor.receiveShadow = true;
    Floor.raycast = () => {};
    View.scene.add(Floor);
    const Parts = ControlVehicleParts(Paint);
    // The body gets its own materials, so X-ray fades the bodywork and not the tyres that share the finish.
    const Coat = Parts.Finish[Family.BodyCoat];
    const Coats = [];
    Parts.Body.material = Parts.Body.material.map((Material) => {
      const Copy = Material.clone();
      if (Material === Coat) Coats.push(Copy);
      return Copy;
    });
    const Car = new THREE.Group();
    Car.add(Parts.Root);
    const Gizmos = new THREE.Group();
    const Content = new THREE.Group();
    Content.add(Car, Gizmos);
    View.setContent(Content);
    const Box = new THREE.Box3(new THREE.Vector3(-Sheet.Length / 2, 0, -Sheet.Width / 2), new THREE.Vector3(Sheet.Length / 2, Sheet.Height, Sheet.Width / 2)).expandByScalar(0.35);
    // Fits the whole vehicle in view.
    const FitView = (Yaw = 38, Pitch = 18, Animate = true) => View.frame(Box, { yaw: Yaw, pitch: Pitch, animate: Animate });
    requestAnimationFrame(() => {
      View.resize();
      FitView(38, 18, false);
    });
    // Until the view is moved by hand, keep the whole vehicle in view while the viewport settles.
    let Moved = false;
    for (const Name of ["pointerdown", "wheel"]) Canvas.addEventListener(Name, () => (Moved = true), { passive: true });
    const Refit = new ResizeObserver(() => {
      if (Moved) return;
      View.resize();
      FitView(38, 18, false);
    });
    Refit.observe(Host.current);
    const Built = { View, Canvas, Parts, Car, Gizmos, Box, Sockets: new Map(), Motions: new Map(), Anchors: new Map(), WheelMarks: [], Drive: { T: 0, Speed: 0, Accel: 0, Distance: 0 }, Halo: null, Coats, FitView };
    Scene.current = Built;
    Canvas.FrontierView = View; // for the checks
    // Click (no drag) picks a component.
    let Down = null;
    Canvas.addEventListener("pointerdown", (Event) => (Down = { X: Event.clientX, Y: Event.clientY, Button: Event.button }));
    Canvas.addEventListener("pointerup", (Event) => {
      if (!Down || Down.Button !== 0 || Math.hypot(Event.clientX - Down.X, Event.clientY - Down.Y) > 4) return;
      // Gizmos first (they sit inside the body and wheels), then the body, tyres and rims.
      const Hit = View.pick(Event.clientX, Event.clientY, [Gizmos]) || View.pick(Event.clientX, Event.clientY, [Car]);
      Latest.current.Select(Hit ? Hit.componentId : Owner);
    });
    // Each tick: the drive cycle (Simulate), each socket stepped and posed on the wheels it holds, lamps, the tag and the readout.
    const Probe = new THREE.Vector3();
    let Last = "";
    View.frameCallbacks.add((Dt) => {
      const Now = Latest.current, Drive = Built.Drive;
      if (Now.Simulating) {
        Drive.T += Dt;
        const Speed = 13 + 9 * Math.sin(Drive.T * 0.55);
        Drive.Accel = (Speed - Drive.Speed) / Math.max(Dt, 1e-3);
        Drive.Speed = Speed;
        Drive.Distance += Speed * Dt;
        View.grid.position.x = -(Drive.Distance % 1);
      } else Object.assign(Drive, { Speed: 0, Accel: 0 });
      const Wheels = Built.Parts.Wheels;
      for (const Wheel of Wheels) {
        Wheel.Steer.quaternion.identity();
        Wheel.Lift.position.set(0, 0, 0);
        if (Now.Simulating) Wheel.Spin.rotation.z = -Drive.Distance / Sheet.TyreRadius;
      }
      for (const [Id, Socket] of Built.Sockets) {
        let Motion = Built.Motions.get(Id);
        if (!Motion || Motion.Joint !== Socket.P.kind) Built.Motions.set(Id, (Motion = Object.assign(createSocketState(), { Joint: Socket.P.kind })));
        stepSocket(Motion, Socket.P, Dt, { simulate: Now.Simulating, accel: Drive.Accel, speed: Drive.Speed, distance: Now.Simulating ? Drive.Distance : undefined, along: Socket.Points[0][0], accepts: true });
        const Pose = socketPose(Socket.P, Motion);
        for (const Look of Socket.Looks) Look.update(Motion, Pose);
        Socket.Motion = Motion;
        // A socket moves the wheels hung below it in the tree: a hinge (or ball) turns them, a spring (or slider) lifts them.
        for (const Wheel of Socket.Corners.map((Corner) => Wheels[Corner])) {
          if (Socket.P.kind === "hinge" || Socket.P.kind === "ball") Wheel.Steer.quaternion.multiply(new THREE.Quaternion().fromArray(Pose.rotation));
          else if (Socket.P.kind === "spring" || Socket.P.kind === "slider") Wheel.Lift.position.add(new THREE.Vector3().fromArray(Pose.offset));
        }
      }
      // Brake lights flare while slowing in Simulate.
      for (const Lamp of Built.BrakeLamps || []) Lamp.light.intensity = Lamp.base * (Now.Simulating && Drive.Accel < -0.6 ? 2.6 : 1);
      // The tag over the selected component and the live readout.
      const Anchor = Built.Anchors.get(Now.Selected);
      const Socket = Built.Sockets.get(Now.Selected);
      const Text = Socket?.Motion ? socketReadout(Socket.P, Socket.Motion) : Built.Readouts?.[Now.Selected] || "";
      if (Tag.current) {
        if (Anchor) {
          Probe.set(...Anchor).project(View.camera);
          const Visible = Probe.z < 1 && Math.abs(Probe.x) < 1.1 && Math.abs(Probe.y) < 1.1;
          Tag.current.hidden = !Visible;
          Tag.current.style.transform = `translate(${((Probe.x + 1) / 2) * Canvas.clientWidth}px, ${((1 - Probe.y) / 2) * Canvas.clientHeight}px)`;
        } else Tag.current.hidden = true;
      }
      if (Text !== Last) {
        Last = Text;
        SetReadout(Text);
      }
      // For the checks: where each component's anchor lands on screen (0–1), the steering angle and the spring travel.
      const Centres = {};
      for (const [Id, At] of Built.Anchors) {
        Probe.set(...At).project(View.camera);
        Centres[Id] = [+((Probe.x + 1) / 2).toFixed(4), +((1 - Probe.y) / 2).toFixed(4)];
      }
      Canvas.dataset.anchors = JSON.stringify(Centres);
      const Targets = {};
      for (const [Id, At] of Built.Picks || []) {
        Probe.set(...At).project(View.camera);
        Targets[Id] = [+((Probe.x + 1) / 2).toFixed(4), +((1 - Probe.y) / 2).toFixed(4)];
      }
      Canvas.dataset.picks = JSON.stringify(Targets);
      const Front = Wheels.find((Each) => Each.Front);
      Canvas.dataset.steer = (new THREE.Euler().setFromQuaternion(Front.Steer.quaternion, "YXZ").y / Rad).toFixed(1);
      Canvas.dataset.lift = (Front.Lift.position.y * 1000).toFixed(0);
      Canvas.dataset.spin = Front.Spin.rotation.z.toFixed(2);
    });
    // In the panel: Esc closes it (after an open page ring), Space runs Simulate, F fits the selection, Delete removes the selected
    // component — unless typing, or Space on a button.
    const Keys = (Event) => {
      if (Event.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
      const Inside = Event.target === document.body || !!Event.target.closest?.(".vcp");
      if (Event.key === "Escape") {
        if (document.querySelector('.vcp-add[aria-expanded="true"]')) return;
        Event.stopPropagation();
        Latest.current.Leave?.();
      } else if (!Inside) return;
      else if (Event.key === " " && !Event.target.closest?.("button, [role=radio], [role=switch], [role=slider]")) {
        Event.preventDefault();
        Event.stopPropagation();
        Simulate((Previous) => !Previous);
      } else if (Event.key.toLowerCase() === "f" && !Event.ctrlKey && !Event.metaKey) Built.FitSelection?.();
      else if ((Event.key === "Delete" || Event.key === "Backspace") && Latest.current.Selected !== Owner) {
        Event.preventDefault();
        Event.stopPropagation();
        Latest.current.Remove?.(Latest.current.Selected);
      }
    };
    window.addEventListener("keydown", Keys, true);
    return () => {
      window.removeEventListener("keydown", Keys, true);
      Refit.disconnect();
      View.resize = () => {}; // the Stage's own resize watch outlives the canvas
      View.renderer.setAnimationLoop(null);
      View.setContent(null);
      View.renderer.dispose();
      View.renderer.forceContextLoss?.();
      Canvas.remove();
      Scene.current = null;
    };
  }, []);
  Latest.current.Leave = Leave;
  Latest.current.Remove = Remove;
  if (Controls) Controls.current = { Fit: () => Scene.current?.FitSelection?.() };

  // Paint: the body coat follows the Controlled Vehicle's paint.
  useEffect(() => {
    for (const Material of Scene.current?.Coats || []) Material.color.set(Paint);
  }, [Paint]);

  // The components: rebuilt whenever one of them, the selection or the display options change.
  const Signature = JSON.stringify([Mine.map((Row) => [Row.Id, Row.Parent, Row.Component, Row.Mount, Row.Corner, Row.Asset, Values[Row.Id], Hidden[Row.Id]]), Selected, OnlySelected, XRay, ShowCentres, ShowSockets]);
  useEffect(() => {
    const Built = Scene.current;
    if (!Built) return;
    const { View, Parts, Gizmos } = Built;
    const Clear = (Piece) => {
      Piece.parent?.remove(Piece);
      Piece.traverse((Each) => {
        Each.geometry?.dispose?.();
        if (Each.material && !Each.material.isShaderMaterial) (Array.isArray(Each.material) ? Each.material : [Each.material]).forEach((Material) => Material.dispose());
      });
    };
    [...Gizmos.children].forEach(Clear);
    Built.WheelMarks.forEach(Clear);
    Built.WheelMarks = [];
    Built.Massed = [];
    Built.Halo?.();
    Built.Halo = null;
    Built.Sockets.clear();
    Built.Anchors.clear();
    Built.Picks = new Map();
    Built.BrakeLamps = [];
    Built.Readouts = {};
    View.xray = false;
    const Drawn = [];
    const Shown = (Row) => !Hidden[Row.Id] && (!OnlySelected || Selected === Row.Id || Selected === Owner);
    // An invisible ball that a click on this component lands on.
    const Pick = (Id, At, Radius = 0.32) => {
      const Ball = new THREE.Mesh(new THREE.SphereGeometry(Radius, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      Ball.position.set(...At);
      Ball.userData.componentId = Id;
      Gizmos.add(Ball);
      if (!Built.Picks.has(Id)) Built.Picks.set(Id, At);
    };
    const OnTop = (Part) => Part.traverse((Each) => Each.layers.set(1));

    // Static meshes: the Body, each Wheel's tyre and its Rim, each its own component (a mesh with no component is not drawn).
    const Meshes = Mine.filter((Row) => Row.Component === "StaticMesh");
    const MeshOf = (Row) => (Row.Asset === "Tyre" || Row.Asset === "Rim" ? Parts.Wheels[Row.Corner ?? 0]?.[Row.Asset] : Parts.Body);
    const Centres = ControlVehicleCentres();
    for (const Part of [Parts.Body, ...Parts.Wheels.flatMap((Wheel) => [Wheel.Tyre, Wheel.Rim])]) {
      Part.visible = false;
      Part.userData.componentId = undefined;
    }
    let Weight = 0;
    const Balance = [0, 0, 0];
    for (const Row of Meshes) {
      const Part = MeshOf(Row);
      if (!Part) continue;
      const V = ComponentReader(Row, Values[Row.Id] || {});
      const Mass = MeshMass(Row, Values[Row.Id] || {});
      const Centre = MeshCentre(Row, Values[Row.Id] || {});
      const Wheel = Row.Asset === "Tyre" || Row.Asset === "Rim" ? Parts.Wheels[Row.Corner ?? 0] : null;
      // Follow-up 70: its material (slot 0, once one is authored) repaints its main family: the body's paint, the tyre's rubber, the
      // rim's alloy. Each mesh gets its own copies first, so one tyre's material never reaches another.
      if (!Part.userData.ownLook) {
        Part.userData.ownLook = true;
        Part.material = (Array.isArray(Part.material) ? Part.material : [Part.material]).map((Each) => Each.clone());
        Part.userData.resting = Part.material.map((Each) => [Each.color.clone(), Each.roughness, Each.metalness]);
      }
      {
        const Main = Row.Asset === "Tyre" ? Family.Tyre : Row.Asset === "Rim" ? Family.Cap : Family.BodyCoat;
        const Authored = (Values[Row.Id] || {}).Material ? ResolveSlots(Values[Row.Id])[0]?.Channels : null;
        Part.material.forEach((Each, Slot) => {
          if (Part.userData.families?.[Slot] !== Main) return;
          const [Colour, Rough, Metal] = Part.userData.resting[Slot];
          const Fill = (Id, Initial) => Authored?.[Id]?.Fill ?? Initial;
          Each.color.set(Authored ? Fill("colour", "#" + Colour.getHexString()) : Colour);
          Each.roughness = Authored ? +Fill("roughness", Rough) : Rough;
          Each.metalness = Authored ? +Fill("metallic", Metal) : Metal;
        });
      }
      Weight += Mass;
      Centre.forEach((Each, Axis) => (Balance[Axis] += Each * Mass));
      Part.visible = !Hidden[Row.Id];
      Part.castShadow = !!V("castShadow");
      Part.userData.componentId = Row.Id;
      Built.Anchors.set(Row.Id, Wheel ? [Centre[0], Sheet.TyreRadius * 2 + 0.2, Centre[2]] : [0, Sheet.Height + 0.15, 0]);
      Built.Readouts[Row.Id] = `${Math.round(Mass)} kg · centre of mass ${Centre.map((Each) => Each.toFixed(2)).join(", ")} m`;
      // For the checks: where a click lands on this mesh (a tyre's sidewall low and ahead, a rim's spokes, the body's roof).
      const Outward = Math.sign(Centre[2]) || 1;
      if (!Built.Picks.has(Row.Id)) Built.Picks.set(Row.Id, Row.Asset === "Tyre" ? [Centre[0] + 0.3, Centre[1] - 0.3, Centre[2] + Outward * 0.12] : Row.Asset === "Rim" ? [Centre[0] - 0.16, Centre[1] + 0.16, Centre[2] + Outward * 0.1] : [-0.4, Sheet.Height - 0.04, 0]);
      if (!Part.visible) continue;
      Drawn.push(Row.Id);
      // Its centre of mass: a wheel part's rides in the wheel (it turns and lifts with it), the body's is fixed; the selected one gets a
      // plumb line to the ground.
      if (!ShowCentres || (OnlySelected && Selected !== Row.Id && Selected !== Owner)) continue;
      const Chosen = Selected === Row.Id;
      Built.Massed.push(Row.Id);
      const Mark = ComMark(Wheel ? (Row.Asset === "Tyre" ? 0.055 : 0.042) : 0.085, Chosen ? Accent : ComColour, Chosen);
      OnTop(Mark);
      View.xray = true;
      if (Wheel) {
        // A moved centre is carried into the wheel's own space (right-hand wheels face outward, turned half a revolution).
        const Rest = RestingCentre(Row), Flip = (VEHICLE_SHEET.axleMount[Row.Corner ?? 0]?.[1] ?? 1) < 0 ? -1 : 1;
        Mark.position.fromArray(Centres[Row.Asset]).add(new THREE.Vector3((Centre[0] - Rest[0]) * Flip, Centre[1] - Rest[1], (Centre[2] - Rest[2]) * Flip));
        Wheel.Face.add(Mark);
        Built.WheelMarks.push(Mark);
      } else {
        Mark.position.fromArray(Centre);
        Gizmos.add(Mark);
      }
      if (Chosen) {
        const Line = Plumb(Centre[1], Accent);
        Line.position.set(Centre[0], Centre[1] / 2, Centre[2]);
        OnTop(Line);
        Gizmos.add(Line);
      }
    }
    // X-ray: the body as glass, so what is inside it shows.
    const Bodywork = Array.isArray(Parts.Body.material) ? Parts.Body.material : [Parts.Body.material];
    for (const Material of Bodywork) {
      Material.transparent = XRay;
      Material.opacity = XRay ? 0.2 : 1;
      Material.depthWrite = !XRay;
      Material.needsUpdate = true;
    }
    // The whole vehicle's centre of mass (every mesh weighed by its mass), at the Origin's selection or with every mark showing.
    const Whole = Weight > 0 ? Balance.map((Each) => Each / Weight) : [0, 0, 0];
    Built.Whole = { Weight, Centre: Whole };
    Built.Canvas.dataset.massMarks = Built.Massed.join(" ");
    Built.Canvas.dataset.wholeMass = Weight.toFixed(0) + " " + Whole.map((Each) => Each.toFixed(2)).join(",");
    if (ShowCentres && Weight > 0 && (!OnlySelected || Selected === Owner)) {
      const Chosen = Selected === Owner;
      const Mark = ComMark(0.12, Chosen ? Accent : "#ffffff", true);
      Mark.position.fromArray(Whole);
      Mark.add(Plumb(Whole[1], Chosen ? Accent : "#ffffff"));
      OnTop(Mark);
      View.xray = true;
      Gizmos.add(Mark);
      Pick(Owner, Whole, 0.16);
    }

    // Sockets.
    for (const Row of Mine.filter((Each) => Each.Component === "Socket")) {
      const P = SocketParameters(Row, Values[Row.Id] || {});
      const OnWheel = Row.Corner !== undefined && !!VEHICLE_SHEET.axleMount[Row.Corner];
      // On a wheel, the spring sits at the strut top above the wheel centre (the hinge at the wheel centre), so both can be clicked.
      const At = SocketPoint(P.Mount, OnWheel ? Row.Corner : undefined);
      const Points = [[At[0], At[1] + (OnWheel && P.kind === "spring" ? 0.42 : 0), At[2]]];
      // The wheels it moves: those whose tyre or rim hangs below it.
      const Corners = [...new Set(VehicleDescendants(Rows, Row.Id).map((Each) => Each.Row).filter((Each) => Each.Component === "StaticMesh" && Each.Corner !== undefined).map((Each) => Each.Corner))];
      const Axle = OnWheel;
      const Socket = { P, Axle, Points, Corners, Looks: [] };
      Built.Sockets.set(Row.Id, Socket);
      Built.Anchors.set(Row.Id, [Points[Points.length - 1][0], Points[Points.length - 1][1] + 0.45, Points[Points.length - 1][2]]);
      if (!Shown(Row) || !ShowSockets) continue;
      Drawn.push(Row.Id);
      for (const At of Points) {
        const Look = socketVisual(P, { selected: Selected === Row.Id });
        Look.group.scale.setScalar(SocketScale);
        Look.group.position.set(...At);
        if (At[2] > 0 && Axle) Look.group.rotation.y = Math.PI;
        // The selected socket draws over the tyre and body (the x-ray pass).
        if (Selected === Row.Id) {
          OnTop(Look.group);
          View.xray = true;
        }
        Gizmos.add(Look.group);
        Socket.Looks.push(Look);
        // On a wheel the pick stays small, so the tyre and rim around it can be clicked too.
        Pick(Row.Id, At, Axle ? (P.kind === "spring" ? 0.2 : 0.15) : 0.3);
      }
    }

    // Lights: real lights at the lamps, a beam (spots) or a glow (points) in their colour.
    for (const Row of Mine.filter((Each) => /Light$/.test(Each.Component))) {
      const V = ComponentReader(Row, Values[Row.Id] || {});
      const Spot = Row.Component === "SpotLight";
      const Colour = V("color") || "#ffffff", Intensity = +V("intensity") || 0, Range = +V("range") || 1, Angle = +V("angle") || 30;
      const Lamps = Spot ? Sheet.Headlamps : Sheet.Taillamps;
      Built.Anchors.set(Row.Id, [Lamps[1][0] + (Spot ? 0.25 : -0.25), Lamps[1][1] + 0.35, Lamps[1][2]]);
      Built.Readouts[Row.Id] = Spot ? `${Intensity.toFixed(0)} cd · ${Angle}° cone · ${Range.toFixed(0)} m` : `${Intensity.toFixed(1)} cd · ${Range.toFixed(1)} m`;
      if (!Shown(Row)) continue;
      Drawn.push(Row.Id);
      for (const At of Lamps) {
        if (Spot) {
          const Light = new THREE.SpotLight(Colour, Intensity * 0.9, Range, (Angle / 2) * Rad, 0.45, 1.4);
          Light.position.set(...At);
          Light.target.position.set(At[0] + 10, At[1] - 0.7, At[2]);
          Gizmos.add(Light, Light.target);
          const Length = Math.min(Range, 9);
          const Beam = beam({ length: Length, radius: Math.tan((Angle / 2) * Rad) * Length, color: Selected === Row.Id ? Accent : Colour, strength: 0.08 + Math.min(0.3, Intensity / 220) });
          Beam.position.set(...At);
          Beam.rotation.z = -4 * Rad;
          Gizmos.add(Beam);
        } else {
          const Light = new THREE.PointLight(Colour, Intensity * 0.35, Range, 1.6);
          Light.position.set(At[0] - 0.12, At[1], At[2]);
          Gizmos.add(Light);
          Built.BrakeLamps.push({ light: Light, base: Intensity * 0.35 });
          const Glow = glowSprite(Selected === Row.Id ? Accent : Colour, 0.35 + Math.min(1.2, Range * 0.08), 0.85);
          Glow.position.set(At[0] - 0.05, At[1], At[2]);
          Gizmos.add(Glow);
        }
        Pick(Row.Id, At, 0.28);
      }
    }

    // The vehicle itself: an anchor mark at its origin on the ground.
    const Origin = anchorMark(0.3, Selected === Owner ? Accent : "#e8e8e8");
    Gizmos.add(Origin);
    Built.Anchors.set(Owner, [0, Sheet.Height + 0.4, 0]);
    Built.Readouts[Owner] = `${Sheet.Length.toFixed(2)} × ${Sheet.Width.toFixed(2)} × ${Sheet.Height.toFixed(2)} m · ${Math.round(Weight).toLocaleString("en-US")} kg · centre of mass ${Whole.map((Each) => Each.toFixed(2)).join(", ")} m`;

    // The selected mesh glows amber toward its silhouette.
    const SelectedMesh = Meshes.find((Row) => Row.Id === Selected);
    const Glowing = SelectedMesh && MeshOf(SelectedMesh);
    if (Glowing?.visible) Built.Halo = addHalo(Glowing);
    Built.FitSelection = () => {
      const At = Built.Anchors.get(Latest.current.Selected);
      if (!At || Latest.current.Selected === Owner) return Built.FitView(View.rig.yaw / Rad, View.rig.pitch / Rad);
      View.frame(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(At[0], Math.max(0.4, At[1] - 0.45), At[2]), new THREE.Vector3(2.2, 1.6, 2.2)), { keepAngle: true });
    };
    Built.Canvas.dataset.components = Drawn.join(" ");
    Built.Canvas.dataset.selectedComponent = Selected;
    Built.Canvas.dataset.xray = XRay ? "on" : "off";
  }, [Signature]);

  const Subject = Rows.find((Row) => Row.Id === Selected);
  const Native = !Subject || Subject.Id === Owner || NativeClasses.has(Subject.Component);
  const Count = Mine.length + 1;
  return (
    <section className="vcp-dock vcp-centre" aria-label="Vehicle view" data-vcv-simulating={Simulating ? "on" : "off"}>
      <div className="vcp-heading">
        <span className="vcp-heading-icon">
          <Icon Name="vehicle-component-body" Size={22} />
        </span>
        <span className="vcp-heading-title">
          <b>{Vehicle?.Name || "Controlled Vehicle"}</b>
          <small>ControlVehicle class · Pawn · {Count} components</small>
        </span>
        <span className="vcp-state">{Simulating ? "SIMULATING" : "EDITING"}</span>
        <span className="vcp-spacer" />
        <button type="button" className={"vcp-simulate" + (Simulating ? " on" : "")} aria-pressed={Simulating} onClick={() => Simulate(!Simulating)} title="Drive a speed cycle: wheels roll, springs meet bumps, sweeps and pull tests run (Space)">
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            {Simulating ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="M4 2.5v11L13 8z" fill="currentColor" />}
          </svg>
          {Simulating ? "Stop" : "Simulate"}
        </button>
      </div>
      <div className="vcp-tools" role="toolbar" aria-label="Component Viewer tools">
        <div className="vcp-segmented">
          {Views.map(([Name, Yaw, Pitch]) => (
            <button key={Name} type="button" onClick={() => Scene.current?.FitView(Yaw, Pitch)} title={Name + " view"}>
              {Name}
            </button>
          ))}
        </div>
        <span className="vcp-split" />
        <button type="button" className="vcp-tool" aria-pressed={XRay} onClick={() => SetXRay(!XRay)} title="Show the body as glass, so the parts inside it show">
          X-ray
        </button>
        <button type="button" className="vcp-tool" aria-pressed={OnlySelected} onClick={() => SetOnlySelected(!OnlySelected)} title="Draw only the selected component">
          {OnlySelected ? "Selected only" : "All components"}
        </button>
        <button type="button" className="vcp-tool" aria-pressed={ShowCentres} onClick={() => SetShowCentres(!ShowCentres)} title="Show each mesh's centre of mass and the whole vehicle's" data-vcp-centres>
          Centre of mass
        </button>
        <button type="button" className="vcp-tool" aria-pressed={ShowSockets} onClick={() => SetShowSockets(!ShowSockets)} title="Show the socket gizmos (also in the editor's debug menu)" data-vcp-sockets>
          Sockets
        </button>
        <button type="button" className="vcp-tool round" onClick={() => Scene.current?.FitSelection?.()} aria-label="Fit selection" title="Fit the selected component in view (F)">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
          </svg>
        </button>
      </div>
      <div className="vcp-well" ref={Host}>
        <div className="vcp-readout" aria-hidden="true">
          <span>tris</span>
          <b>{(TriangleCount() / 1000).toFixed(1)}k</b>
          <span>parts</span>
          <b>{Count} components</b>
          <span>select</span>
          <b>{Subject ? (Subject.Id === Owner ? "Origin" : Subject.Name) : "—"}</b>
        </div>
        <div className="vcv-tag" ref={Tag} hidden aria-live="polite">
          <b>{Subject?.Id === Owner ? "Origin" : Subject?.Name}</b>
          <small>{Subject ? (Subject.Id === Owner ? Vehicle?.Name : Native ? ClassLabel(Subject, Values[Subject.Id] || {}) : "User component") : ""}</small>
          {Readout && <span>{Readout}</span>}
        </div>
      </div>
      <div className="vcp-strip">COMPONENT VIEWER · {(Vehicle?.Name || "Controlled Vehicle").toUpperCase()} · {Simulating ? "SIMULATING" : "EDITING"}</div>
    </section>
  );
}

// The Component Viewer panel for the Controlled Vehicle, opened from its inspector (or by choosing one of its components anywhere): its
// own Components outliner, the vehicle view and its own Details, where the selected component's native inspector edits it. Choosing a
// component here never changes the editor's selection.
export function VehicleComponentPanel({ Rows, Values, Hidden, Focus, ToggleHidden, Close, Icon, Details, Add, Remove, Debug = null }) {
  const [Selected, Select] = useState(Focus?.Id || Owner);
  const Controls = useRef(null);
  useEffect(() => {
    if (Focus?.Id) Select(Focus.Id);
  }, [Focus?.Stamp]);
  const Subject = Rows.find((Row) => Row.Id === Selected && InVehicleTree(Rows, Row)) || Rows.find((Row) => Row.Id === Owner);
  useEffect(() => {
    if (Subject && Subject.Id !== Selected) Select(Subject.Id);
  }, [Subject?.Id]);
  if (!Subject) return null;
  return (
    <section className="vcp" role="dialog" aria-label="Component Viewer · Controlled Vehicle" data-vcp-selected={Subject.Id}>
      <header className="vcp-bar">
        <span className="vcp-bar-title">
          <Icon Name="component-viewer" Size={18} />
          <b>Component Viewer</b>
          <small>{Subject.Id === Owner ? "Origin" : Subject.Name} · click a component to edit it</small>
        </span>
        <button type="button" className="vcp-close" aria-label="Close Component Viewer" title="Close (Esc)" onClick={Close}>
          ×
        </button>
      </header>
      <div className="vcp-body">
        <ComponentOutliner Rows={Rows} Values={Values} Hidden={Hidden} Selected={Subject.Id} Select={Select} ToggleHidden={ToggleHidden} Icon={Icon} Add={Add} Fit={() => Controls.current?.Fit()} />
        <VehicleComponentView Rows={Rows} Values={Values} Hidden={Hidden} Selected={Subject.Id} Select={Select} Leave={Close} Remove={(Id) => (Remove(Id), Select(Owner))} Controls={Controls} Icon={Icon} Debug={Debug} />
        <section className="vcp-dock vcp-right" aria-label="Details">
          <div className="vcp-tabs">
            <span className="vcp-tab on">Details</span>
          </div>
          <div className="inspector-scroll vcp-details" key={Subject.Id}>
            {Details(Subject, Select)}
          </div>
        </section>
      </div>
    </section>
  );
}

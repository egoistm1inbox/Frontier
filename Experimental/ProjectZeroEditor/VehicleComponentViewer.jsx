//============================================================================================================================================
//                                                         VEHICLECOMPONENTVIEWER.JSX
//============================================================================================================================================
// 🧩 The Component Viewer for the Controlled Vehicle, inside the editor (Follow-up 61). The viewport shows the ControlVehicle alone
// (ControlVehicleModel.js) with each of its native components drawn where it sits and doing what its values say; the component list
// floats on the left. Click a component in the view or in the list and the inspector opens it, so its properties are set there and the
// view follows at once. Built from the Component Viewer's own parts (Experimental/ComponentViewer, used as they are): the socket looks
// and motion (SocketVisuals.js, Sockets.js), and its Stage, collision volumes, beams and glows (Shared/Studio).
//   • Body (Static Mesh): the body shell; Cast shadow switches its shadow.
//   • Front Suspension (Spring socket) and Steering (Hinge socket): on both wheels of the axle they are mounted at; the spring lifts the
//     wheels to its pose (and meets bumps in Simulate), the hinge turns them to its angle (or sweeps).
//   • Tow Hitch (Dock socket): at its mount on the centre line, connecting, releasing and pull-testing as set.
//   • Chassis Collision (Box Collision): the collision shell at its extents, amber when it only reports overlaps.
//   • Headlights (Spot Light pair) and Brake Lights (Point Light pair): real lights at the lamps, with beams and glows in their colour,
//     angle, intensity and range.
//   • Vehicle Movement: the centre of mass from its height and front weight share, the load on each tyre, wheels sized by the tyre
//     radius; Simulate drives a speed cycle that rolls the wheels.
// Other components (made by users, with their own controls) are listed but not drawn: only native components are. Browser authoring
// only; the native renderer is not connected.

import React, { useEffect, useRef, useState } from "react";
import { THREE, Stage } from "../Shared/Studio/Render.js";
import { beam, glowSprite, addHalo, anchorMark, markDebug, fieldShell } from "../Shared/Studio/Visuals.js";
import { socketVisual } from "../ComponentViewer/SocketVisuals.js";
import { createSocketState, stepSocket, socketPose, socketReadout, SOCKET_KIND } from "../ComponentViewer/Sockets.js";
import { COMPONENT_CLASSES } from "../ComponentViewer/Blueprint.js";
import { ControlVehicleParts, ControlVehicleSheet as Sheet, Family } from "./ControlVehicleModel.js";
import { ComponentReader, SocketParameters, VehicleSummary } from "./VehicleComponents.jsx";
import { PaintOf } from "./VehicleAssetInspector.jsx";
import "./VehicleComponentViewer.css";

const Owner = "vehicle";
const Rad = Math.PI / 180;
const Accent = "#ffb238";
const Gravity = 9.81;
const SocketScale = 2.2; // the Component Viewer's socket looks are sized for a desk; at car scale they're drawn bigger
const NativeClasses = new Set(["VehicleMovement", "StaticMesh", "Socket", "BoxCollision", "SphereCollision", "SpotLight", "PointLight"]);
export const InVehicle = (Row) => !!Row && (Row.Id === Owner || Row.Parent === Owner);

// Where a socket sits: on both wheels of an axle when it is mounted there (within 0.4 m), otherwise on the centre line.
function SocketAnchors(Mount) {
  const X = Sheet.Middle + Mount;
  const Axle = [Sheet.FrontAxle, Sheet.RearAxle].find((Each) => Math.abs(Each - X) < 0.4);
  if (Axle !== undefined) return { Axle: Axle === Sheet.FrontAxle ? "front" : "rear", Points: [-1, 1].map((Side) => [Axle, Sheet.AxleHeight, (Side * Sheet.Track) / 2]) };
  return { Axle: null, Points: [[X, 0.42, 0]] };
}
const ClassLabel = (Row, Values) =>
  Row.Component === "Socket" ? `${SOCKET_KIND[ComponentReader(Row, Values)("kind")]?.label || "Fixed"} socket` : COMPONENT_CLASSES[Row.Component]?.label || "User component";

// The list on the left: the vehicle, its scene components under the Body, the actor components, then anything else.
function ComponentTree({ Rows, Values, Hidden, Selected, Select, ToggleHidden, Icon }) {
  const Mine = Rows.filter((Row) => Row.Parent === Owner);
  const Body = Mine.find((Row) => Row.Component === "StaticMesh");
  const Actor = Mine.filter((Row) => Row.Component === "VehicleMovement");
  const Scene = Mine.filter((Row) => Row !== Body && NativeClasses.has(Row.Component) && Row.Component !== "VehicleMovement");
  const Other = Mine.filter((Row) => !NativeClasses.has(Row.Component));
  const Vehicle = Rows.find((Row) => Row.Id === Owner);
  const Line = (Row, Depth, Note = null) => (
    <div
      key={Row.Id}
      role="treeitem"
      aria-selected={Selected === Row.Id}
      tabIndex={0}
      className={"vcv-row" + (Selected === Row.Id ? " on" : "") + (Hidden[Row.Id] ? " off" : "")}
      style={{ "--vcv-depth": Depth }}
      data-vcv-row={Row.Id}
      data-depth={Depth}
      onClick={() => Select(Row.Id)}
      onKeyDown={(Event) => Event.key === "Enter" && Select(Row.Id)}
    >
      {Icon && <Icon Name={Row.Icon} Size={20} />}
      <span className="vcv-row-text">
        <b>{Row.Name}</b>
        <small>{Note ?? (Row.Id === Owner ? "Origin · ControlVehicle" : `${ClassLabel(Row, Values[Row.Id] || {})} · ${VehicleSummary(Row, Values[Row.Id] || {})}`)}</small>
      </span>
      {Row.Id !== Owner && (
        <button
          type="button"
          className="vcv-eye"
          aria-label={(Hidden[Row.Id] ? "Show " : "Hide ") + Row.Name}
          aria-pressed={!Hidden[Row.Id]}
          onClick={(Event) => {
            Event.stopPropagation();
            ToggleHidden(Row.Id);
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            {Hidden[Row.Id] ? (
              <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4zM3 13 13 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            ) : (
              <>
                <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="8" cy="8" r="1.8" fill="currentColor" />
              </>
            )}
          </svg>
        </button>
      )}
    </div>
  );
  return (
    <aside className="vcv-tree" role="tree" aria-label="Vehicle components">
      <header>
        <span>Components</span>
        <small>{Mine.length}</small>
      </header>
      {Vehicle && Line(Vehicle, 0)}
      {Body && Line(Body, 1)}
      {Scene.map((Row) => Line(Row, 2))}
      {Actor.length > 0 && <p className="vcv-section">Actor components</p>}
      {Actor.map((Row) => Line(Row, 1))}
      {Other.length > 0 && <p className="vcv-section">Other components</p>}
      {Other.map((Row) => Line(Row, 1, "User component · its own controls, not drawn here"))}
    </aside>
  );
}

// The Component Viewer's rail button on the viewport's left edge, while the Controlled Vehicle or one of its components is selected.
export function ComponentViewerRail({ Active, Open, Leave }) {
  return (
    <nav className="ws-rail vcv-rail" aria-label="Vehicle tools" data-active={Active ? "components" : ""}>
      <span className="ws-rail-caption">EDIT</span>
      <button type="button" aria-label="Vehicle Component Viewer" aria-pressed={!!Active} data-tool="components" title="Component Viewer · the vehicle with its components; click one to edit it" onClick={() => (Active ? Leave() : Open())}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 14.5 6 10.5h9.5l3.5 4H20.5v2.5h-17z" />
          <circle cx="7.5" cy="17" r="1.8" />
          <circle cx="16.5" cy="17" r="1.8" />
          <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M12 6.6v3.4" strokeDasharray="1.4 1.4" />
        </svg>
        <span className="ws-rail-name">Vehicle Component Viewer</span>
      </button>
    </nav>
  );
}

const Views = [
  ["Three-quarter", 38, 18],
  ["Side", 0, 4],
  ["Front", 90, 6],
  ["Top", 90, 88],
];

export function VehicleComponentView({ Rows, Values, Hidden, Selected, Select, ToggleHidden, Leave, Icon }) {
  const Host = useRef(null);
  const Tag = useRef(null);
  const Scene = useRef(null);
  const Latest = useRef({});
  const [Simulating, Simulate] = useState(false);
  const [XRay, SetXRay] = useState(false);
  const [OnlySelected, SetOnlySelected] = useState(false);
  const [Readout, SetReadout] = useState("");
  const Vehicle = Rows.find((Row) => Row.Id === Owner);
  const Mine = Rows.filter((Row) => Row.Parent === Owner);
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
    // The component list covers the left of the view, so the picture centres in what is left of it: the projection is shifted right by
    // half the list's width (a view offset, with the aspect widened to match so nothing stretches).
    const Plain = View.resize.bind(View);
    View.resize = () => {
      Plain();
      const Width = Math.max(1, Canvas.clientWidth), Height = Math.max(1, Canvas.clientHeight);
      const List = Host.current?.querySelector(".vcv-tree");
      const Covered = List ? Math.min(Width * 0.4, Math.max(0, List.getBoundingClientRect().right - Canvas.getBoundingClientRect().left)) : 0;
      if (Covered < 8) return View.camera.clearViewOffset();
      View.camera.aspect = (Width + Covered) / Height;
      View.camera.setViewOffset(Width + Covered, Height, 0, 0, Width, Height);
    };
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
    Parts.Body.userData.componentId = "vehicle-body";
    for (const Wheel of Parts.Wheels) Wheel.Steer.userData.componentId = "vehicle-movement";
    const Gizmos = new THREE.Group();
    const Colliders = new THREE.Group(); // collision volumes: picked only when nothing else is under the cursor
    const Content = new THREE.Group();
    Content.add(Car, Gizmos, Colliders);
    View.setContent(Content);
    const Box = new THREE.Box3(new THREE.Vector3(-Sheet.Length / 2, 0, -Sheet.Width / 2), new THREE.Vector3(Sheet.Length / 2, Sheet.Height, Sheet.Width / 2)).expandByScalar(0.35);
    // Frames the whole vehicle in the part of the view the list leaves (the aspect is widened by the offset, so the fit is eased back).
    const FitView = (Yaw = 38, Pitch = 18, Animate = true) => {
      const Widened = View.camera.aspect;
      View.camera.aspect = Math.max(1, Canvas.clientWidth - (View.camera.view?.enabled ? View.camera.view.fullWidth - View.camera.view.width : 0)) / Math.max(1, Canvas.clientHeight);
      View.frame(Box, { yaw: Yaw, pitch: Pitch, animate: Animate });
      View.camera.aspect = Widened;
    };
    requestAnimationFrame(() => {
      View.resize();
      FitView(38, 18, false);
    });
    // Until the view is moved by hand, keep the vehicle framed while the viewport settles.
    let Moved = false;
    for (const Name of ["pointerdown", "wheel"]) Canvas.addEventListener(Name, () => (Moved = true), { passive: true });
    const Refit = new ResizeObserver(() => {
      if (Moved) return;
      View.resize();
      FitView(38, 18, false);
    });
    Refit.observe(Host.current);
    const Built = { View, Canvas, Parts, Car, Gizmos, Colliders, Box, Sockets: new Map(), Motions: new Map(), Anchors: new Map(), Drive: { T: 0, Speed: 0, Accel: 0, Distance: 0 }, Halo: null, Coats, FitView };
    Scene.current = Built;
    Canvas.FrontierView = View; // for the checks
    // Click (no drag) picks a component; the collision shell only when nothing else is under the cursor.
    let Down = null;
    Canvas.addEventListener("pointerdown", (Event) => (Down = { X: Event.clientX, Y: Event.clientY, Button: Event.button }));
    Canvas.addEventListener("pointerup", (Event) => {
      if (!Down || Down.Button !== 0 || Math.hypot(Event.clientX - Down.X, Event.clientY - Down.Y) > 4) return;
      // Gizmos first (they sit inside the body and wheels), then the body and wheels, then the collision shell.
      const Hit = View.pick(Event.clientX, Event.clientY, [Gizmos]) || View.pick(Event.clientX, Event.clientY, [Car]) || View.pick(Event.clientX, Event.clientY, [Colliders]);
      Latest.current.Select(Hit ? Hit.componentId : Owner);
    });
    // Every frame: the drive cycle (Simulate), each socket stepped and posed on the wheels it holds, lamps, the tag and the readout.
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
        if (Now.Simulating) Wheel.Spin.rotation.z = -Drive.Distance / (Built.TyreRadius || Sheet.TyreRadius);
      }
      for (const [Id, Socket] of Built.Sockets) {
        let Motion = Built.Motions.get(Id);
        if (!Motion || Motion.Joint !== Socket.P.kind) Built.Motions.set(Id, (Motion = Object.assign(createSocketState(), { Joint: Socket.P.kind })));
        stepSocket(Motion, Socket.P, Dt, { simulate: Now.Simulating, accel: Drive.Accel, speed: Drive.Speed, distance: Now.Simulating ? Drive.Distance : undefined, along: Socket.Points[0][0], accepts: true });
        const Pose = socketPose(Socket.P, Motion);
        for (const Look of Socket.Looks) Look.update(Motion, Pose);
        Socket.Motion = Motion;
        if (!Socket.Axle) continue;
        // A wheel socket moves the wheels of its axle: a hinge (or ball) turns them, a spring (or slider) lifts them.
        for (const Wheel of Wheels.filter((Each) => Each.Front === (Socket.Axle === "front"))) {
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
    // Esc leaves; Space runs Simulate; F frames the selection — unless typing.
    const Keys = (Event) => {
      if (Event.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (Event.key === "Escape") {
        Event.stopPropagation();
        Latest.current.Leave?.();
      } else if (Event.key === " " && (Event.target === document.body || Host.current?.contains(Event.target))) {
        Event.preventDefault();
        Event.stopPropagation();
        Simulate((Previous) => !Previous);
      } else if (Event.key.toLowerCase() === "f" && Host.current?.contains(Event.target)) Built.FitSelection?.();
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

  // Paint: the body coat follows the Controlled Vehicle's paint.
  useEffect(() => {
    for (const Material of Scene.current?.Coats || []) Material.color.set(Paint);
  }, [Paint]);

  // The components: rebuilt whenever one of them, the selection or the display options change.
  const Signature = JSON.stringify([Mine.map((Row) => [Row.Id, Row.Component, Row.Mount, Values[Row.Id], Hidden[Row.Id]]), Selected, OnlySelected, XRay]);
  useEffect(() => {
    const Built = Scene.current;
    if (!Built) return;
    const { View, Parts, Gizmos, Colliders } = Built;
    for (const Group of [Gizmos, Colliders])
      for (const Piece of [...Group.children]) {
        Group.remove(Piece);
        Piece.traverse((Each) => {
          Each.geometry?.dispose?.();
          if (Each.material && !Each.material.isShaderMaterial) (Array.isArray(Each.material) ? Each.material : [Each.material]).forEach((Material) => Material.dispose());
        });
      }
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

    // Body.
    const BodyRow = Mine.find((Row) => Row.Component === "StaticMesh");
    Parts.Body.visible = !BodyRow || !Hidden[BodyRow.Id];
    if (BodyRow) {
      const V = ComponentReader(BodyRow, Values[BodyRow.Id] || {});
      Parts.Body.castShadow = !!V("castShadow");
      Built.Anchors.set(BodyRow.Id, [0, Sheet.Height + 0.15, 0]);
      Built.Readouts[BodyRow.Id] = `${V("lod") < 0 ? "automatic LOD" : "LOD " + V("lod")} · ${V("collisionPreset")}${V("castShadow") ? " · casts shadow" : ""}`;
      if (Parts.Body.visible) Drawn.push(BodyRow.Id);
    }
    // X-ray: the body as glass, so what is inside it shows.
    const Bodywork = Array.isArray(Parts.Body.material) ? Parts.Body.material : [Parts.Body.material];
    for (const Material of Bodywork) {
      Material.transparent = XRay;
      Material.opacity = XRay ? 0.2 : 1;
      Material.depthWrite = !XRay;
      Material.needsUpdate = true;
    }

    // Vehicle Movement: tyre radius, centre of mass, load per tyre.
    const MovementRow = Mine.find((Row) => Row.Component === "VehicleMovement");
    Built.TyreRadius = Sheet.TyreRadius;
    for (const Wheel of Parts.Wheels) {
      Wheel.Size.scale.setScalar(1);
      Wheel.Size.position.y = 0;
    }
    if (MovementRow) {
      const V = ComponentReader(MovementRow, Values[MovementRow.Id] || {});
      const Radius = +V("tyreRadius") || Sheet.TyreRadius;
      Built.TyreRadius = Radius;
      for (const Wheel of Parts.Wheels) {
        Wheel.Size.scale.setScalar(Radius / Sheet.TyreRadius);
        Wheel.Size.position.y = Radius - Sheet.TyreRadius;
      }
      const Mass = +V("mass"), Share = +V("frontWeight") / 100, Height = +V("comHeight");
      const Wheelbase = Sheet.FrontAxle - Sheet.RearAxle;
      const Centre = [Sheet.RearAxle + Wheelbase * Share, Height, 0];
      const Loads = Parts.Wheels.map((Wheel) => ((Wheel.Front ? Share : 1 - Share) * Mass * Gravity) / 2);
      Built.Anchors.set(MovementRow.Id, Centre);
      Built.Readouts[MovementRow.Id] = `${Math.round(Mass)} kg · ${(Share * 100).toFixed(1)} % front · CoM ${Height.toFixed(2)} m · ${(Loads[0] / 1000).toFixed(2)} / ${(Loads[2] / 1000).toFixed(2)} kN per tyre`;
      if (Shown(MovementRow)) {
        Drawn.push(MovementRow.Id);
        const Mark = new THREE.Group();
        const Checker = document.createElement("canvas");
        Checker.width = Checker.height = 64;
        const Brush = Checker.getContext("2d");
        Brush.fillStyle = "#f2f2f2";
        Brush.fillRect(0, 0, 64, 64);
        Brush.fillStyle = "#16171b";
        Brush.fillRect(0, 0, 16, 32);
        Brush.fillRect(32, 0, 16, 32);
        Brush.fillRect(16, 32, 16, 32);
        Brush.fillRect(48, 32, 16, 32);
        const Texture = new THREE.CanvasTexture(Checker);
        Texture.colorSpace = THREE.SRGBColorSpace;
        const Ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshBasicMaterial({ map: Texture }));
        Mark.add(Ball, glowSprite(Selected === MovementRow.Id ? Accent : "#7fd1ff", 0.7, 0.5));
        // The plumb line to the ground and the wheelbase share.
        const Plumb = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, Height, 6), new THREE.MeshBasicMaterial({ color: "#7fd1ff", transparent: true, opacity: 0.7 }));
        Plumb.position.y = -Height / 2;
        Mark.add(Plumb);
        Mark.position.set(...Centre);
        markDebug(Mark);
        // Inside the body, so it always draws on top.
        OnTop(Mark);
        View.xray = true;
        Gizmos.add(Mark);
        Pick(MovementRow.Id, Centre, 0.25);
        // Tyre loads: a disc on the ground under each wheel, sized by its load.
        Parts.Wheels.forEach((Wheel, Index) => {
          const Disc = new THREE.Mesh(
            new THREE.CircleGeometry(0.18 + (Loads[Index] / 4000) * 0.32, 40),
            new THREE.MeshBasicMaterial({ color: Selected === MovementRow.Id ? Accent : "#7fd1ff", transparent: true, opacity: 0.32, depthWrite: false }),
          );
          Disc.rotation.x = -Math.PI / 2;
          Disc.position.set(Wheel.Mount.x, 0.006, Wheel.Mount.z);
          markDebug(Disc);
          Gizmos.add(Disc);
        });
      }
    }

    // Sockets.
    for (const Row of Mine.filter((Each) => Each.Component === "Socket")) {
      const P = SocketParameters(Row, Values[Row.Id] || {});
      const Found = SocketAnchors(P.Mount);
      const Axle = Found.Axle;
      // On a wheel, the spring sits at the strut top above the wheel centre (the hinge at the wheel centre), so both can be clicked.
      const Points = Found.Points.map(([X, Y, Z]) => [X, Y + (Axle && P.kind === "spring" ? 0.42 : 0), Z]);
      const Socket = { P, Axle, Points, Looks: [] };
      Built.Sockets.set(Row.Id, Socket);
      Built.Anchors.set(Row.Id, [Points[Points.length - 1][0], Points[Points.length - 1][1] + 0.45, Points[Points.length - 1][2]]);
      if (!Shown(Row)) continue;
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
        Pick(Row.Id, At, Axle ? 0.36 : 0.3);
      }
    }

    // Collision.
    for (const Row of Mine.filter((Each) => /Collision$/.test(Each.Component))) {
      const V = ComponentReader(Row, Values[Row.Id] || {});
      const Trigger = !!V("trigger");
      const Centre = [0, (Sheet.Clearance + Sheet.Height) / 2, 0];
      const Shape = Row.Component === "BoxCollision" ? { type: "box", centre: [0, 0, 0], half: (V("extent") || [0.5, 0.5, 0.5]).map(Number) } : { type: "sphere", centre: [0, 0, 0], radius: +V("radius") || 0.5 };
      Built.Anchors.set(Row.Id, Shape.type === "box" ? [Shape.half[0] * 0.6, Centre[1] + Shape.half[1] + 0.1, -Shape.half[2]] : [0, Centre[1] + Shape.radius, 0]);
      Built.Readouts[Row.Id] = (Shape.type === "box" ? Shape.half.map((Each) => (Each * 2).toFixed(2)).join(" × ") + " m" : `r ${Shape.radius.toFixed(2)} m`) + (Trigger ? " · overlap only" : " · blocks all");
      if (!Shown(Row)) continue;
      Drawn.push(Row.Id);
      const Colour = Selected === Row.Id ? Accent : Trigger ? "#ffb15a" : "#46d267";
      // Faint unless selected, so it does not cover the vehicle.
      const Volume = fieldShell(Shape, Colour, Selected === Row.Id ? {} : { base: 0.004, rim: 0.11, scan: 0.04, border: 0.2 });
      Volume.position.set(...Centre);
      Gizmos.add(Volume);
      // A click on the shell (where nothing else is) selects it.
      const Target = new THREE.Mesh(
        Shape.type === "box" ? new THREE.BoxGeometry(Shape.half[0] * 2, Shape.half[1] * 2, Shape.half[2] * 2) : new THREE.SphereGeometry(Shape.radius, 16, 12),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
      );
      Target.position.set(...Centre);
      Target.userData.componentId = Row.Id;
      Colliders.add(Target);
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
    Built.Readouts[Owner] = `${Sheet.Length.toFixed(2)} × ${Sheet.Width.toFixed(2)} × ${Sheet.Height.toFixed(2)} m · ${Mine.length} components`;

    // The selected body or wheels glow amber toward their silhouette.
    if (Selected === BodyRow?.Id && Parts.Body.visible) Built.Halo = addHalo(Parts.Body);
    if (Selected === MovementRow?.Id) {
      const Undo = Parts.Wheels.map((Wheel) => addHalo(Wheel.Steer));
      Built.Halo = () => Undo.forEach((Each) => Each());
    }
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
  return (
    <div className="vcv" ref={Host} role="region" aria-label="Component Viewer · Controlled Vehicle" data-vcv-simulating={Simulating ? "on" : "off"}>
      <div className="ws-banner vcv-banner">
        <span className="ws-banner-mode">EDIT</span>
        <span>
          <b>{Vehicle?.Name || "Controlled Vehicle"}</b> · Component Viewer · click a component to edit it in the inspector
        </span>
        <button type="button" onClick={Leave} aria-label="Leave Component Viewer">
          Leave <kbd>Esc</kbd>
        </button>
      </div>
      <ComponentTree Rows={Rows} Values={Values} Hidden={Hidden} Selected={Selected} Select={Select} ToggleHidden={ToggleHidden} Icon={Icon} />
      <div className="vcv-tag" ref={Tag} hidden aria-live="polite">
        <b>{Subject?.Name}</b>
        <small>{Subject ? (Subject.Id === Owner ? "Origin" : Native ? ClassLabel(Subject, Values[Subject.Id] || {}) : "User component") : ""}</small>
        {Readout && <span>{Readout}</span>}
      </div>
      <div className="vcv-tools" role="toolbar" aria-label="Component Viewer tools">
        <button type="button" className={"vcv-simulate" + (Simulating ? " on" : "")} aria-pressed={Simulating} onClick={() => Simulate(!Simulating)} title="Drive a speed cycle: wheels roll, springs meet bumps, sweeps and pull tests run (Space)">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            {Simulating ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="M4 2.5v11L13 8z" fill="currentColor" />}
          </svg>
          {Simulating ? "Stop" : "Simulate"}
          <kbd>Space</kbd>
        </button>
        <span className="vcv-split" />
        <button type="button" aria-pressed={XRay} onClick={() => SetXRay(!XRay)} title="Show the body as glass, so the parts inside it show">
          X-ray
        </button>
        <button type="button" aria-pressed={OnlySelected} onClick={() => SetOnlySelected(!OnlySelected)} title="Draw only the selected component">
          {OnlySelected ? "Selected only" : "All components"}
        </button>
        <span className="vcv-split" />
        {Views.map(([Name, Yaw, Pitch]) => (
          <button key={Name} type="button" onClick={() => Scene.current?.FitView(Yaw, Pitch)} title={Name + " view"}>
            {Name}
          </button>
        ))}
        <button type="button" onClick={() => Scene.current?.FitSelection?.()} title="Fit the view to the selected component (F)">
          Fit <kbd>F</kbd>
        </button>
      </div>
    </div>
  );
}

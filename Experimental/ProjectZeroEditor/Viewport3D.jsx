//============================================================================================================================================
//                                                              VIEWPORT3D.JSX
//============================================================================================================================================
// 🧩 The 3D viewport: the scene's basic shapes, lit by the Sun and under the Atmosphere's sky, drawn with the Component Viewer's
// three.js renderer (Shared/Studio/Render.js, `Stage`, with its orbit camera). Not the native renderer and not SDF.
//   • Shapes: every geometry object (cube, sphere, cylinder, torus, cone) with its size settings, Transform, base colour, roughness and
//     metallic. The Showcase collection stands on a line 1.8 m apart so its five shapes don't overlap at the origin; Position moves an
//     object from its place on that line. Objects rest on the ground.
//   • Sun: direction from the Sun's date, time and place (or its manual direction); colour is its temperature times the sunlight left
//     after the air (SkyShader.js `Transmittance`), so it reddens and fades at sunset; it casts shadows.
//   • Atmosphere: the sky sphere is SkyShader.js baked to an equirectangular image whenever the sky changes; the hemisphere light takes
//     its colour from that image.
// Click an object to select it (Ctrl or Shift adds it). Drag to orbit, right-drag or Shift-drag to pan, wheel to zoom; F frames the
// selection. Frames are drawn only when something changed, so an idle viewport costs nothing.

import React, { useEffect, useRef, useState } from "react";
import { THREE, Stage } from "../Shared/Studio/Render.js";
import { ShapeOf } from "./PrimitiveInspector.jsx";
import { ResolveMaterial } from "./MaterialSpecification.js";
import { Solar } from "./Solar.mjs";
import { SkyMedium, PaintSky, ViewBasis, Direction, KelvinTint, Transmittance } from "./SkyShader.js";

export const ShowcaseSpacing = 1.8;
const Rad = Math.PI / 180;
const Accent = "#ffb238";
const Linear = (Channel) => (Channel <= 0.04045 ? Channel / 12.92 : ((Channel + 0.055) / 1.055) ** 2.4);

// Shape, size and lift (half its height, so it rests on the ground) for one geometry object.
export function ShapeGeometry(Shape, Read) {
  const P = (Key, Initial) => (Number.isFinite(+Read(Key)) && Read(Key) !== null && Read(Key) !== "" ? +Read(Key) : Initial);
  const Segments = Math.max(3, Math.min(96, Math.round(P("Geometry Segments", 32))));
  if (Shape === "sphere") {
    const R = P("Geometry Radius", 0.5);
    return { Geometry: new THREE.SphereGeometry(R, Segments, Math.max(2, Math.min(64, Math.round(P("Geometry Rings", 16))))), Lift: R };
  }
  if (Shape === "cylinder") {
    const R = P("Geometry Radius", 0.5), H = P("Geometry Height", 1);
    return { Geometry: new THREE.CylinderGeometry(R, R, H, Segments), Lift: H / 2 };
  }
  if (Shape === "cone") {
    const R = P("Geometry Radius", 0.5), H = P("Geometry Height", 1);
    return { Geometry: new THREE.ConeGeometry(R, H, Segments), Lift: H / 2 };
  }
  if (Shape === "torus") {
    const Major = P("Geometry Major Radius", 0.5), Minor = P("Geometry Minor Radius", 0.15);
    const Geometry = new THREE.TorusGeometry(Major, Minor, Math.max(3, Math.min(48, Math.round(P("Geometry Sides", 16)))), Math.max(3, Math.min(128, Math.round(P("Geometry Segments", 48)))));
    Geometry.rotateX(Math.PI / 2);
    return { Geometry, Lift: Minor };
  }
  const X = P("Geometry Size X", 1), Y = P("Geometry Size Y", 1), Z = P("Geometry Size Z", 1);
  return { Geometry: new THREE.BoxGeometry(X, Y, Z), Lift: Y / 2 };
}

// Where each geometry object stands: its slot on the Showcase line (if it is in the Showcase) plus its Position.
export function Placements(Rows, Values, Hidden) {
  const HiddenUp = (Row) => {
    const Seen = new Set();
    for (let At = Row; At && !Seen.has(At.Id); At = Rows.find((Each) => Each.Id === At.Parent)) {
      if (Hidden[At.Id]) return true;
      Seen.add(At.Id);
    }
    return false;
  };
  const Shapes = Rows.filter((Row) => Row.Panel === "geometry" && ShapeOf(Row));
  const Showcase = Shapes.filter((Row) => Row.Parent === "showcase");
  return Shapes.filter((Row) => !HiddenUp(Row)).map((Row) => {
    const Slot = Showcase.indexOf(Row);
    const Along = Slot >= 0 ? (Slot - (Showcase.length - 1) / 2) * ShowcaseSpacing : 0;
    const Own = Values[Row.Id] || {};
    const Triple = (Key, Initial) => (Array.isArray(Own[Key]) && Own[Key].length === 3 ? Own[Key].map(Number) : Initial);
    return { Row, Shape: ShapeOf(Row), Along, Position: Triple("Position", [0, 0, 0]), Rotation: Triple("Rotation", [0, 0, 0]), Scale: Triple("Scale", [1, 1, 1]) };
  });
}

// The sun for the viewport: direction, colour and strength.
export function SunLight(Sun, Medium) {
  const Manual = !!Sun("Manual direction");
  const Solved = Solar({ Month: Sun("Month"), Day: Sun("Day of Month"), Latitude: Sun("Latitude"), Longitude: Sun("Longitude"), LocalHours: Sun("Local Hours") ?? 12 });
  const Elevation = Manual ? Sun("Manual elevation") ?? Solved.Elevation : Solved.Elevation;
  const Azimuth = Manual ? Sun("Manual azimuth") ?? Solved.Azimuth : Solved.Azimuth;
  const Tint = KelvinTint(Sun("Temperature") ?? 6500);
  const Through = Transmittance(Medium, Elevation);
  const Colour = Tint.map((C, Channel) => C * Through[Channel]);
  const Strength = Math.max(...Colour);
  return { Elevation, Azimuth, Direction: Direction(Elevation, Azimuth), Tint, Colour: Colour.map((C) => (Strength ? C / Strength : 1)), Strength };
}

export default function Viewport3D({ Rows, Values, Hidden, Selected, Picked = [], Select, Air, Sun, FrameToken = 0 }) {
  const Host = useRef(null), Scene = useRef(null), Latest = useRef({});
  const [Failed, Fail] = useState("");
  const Medium = SkyMedium(Air);
  const Light = SunLight(Sun, Medium);
  const Chosen = new Set([Selected, ...Picked]);
  const Placed = Placements(Rows, Values, Hidden);

  // One renderer for the viewport's life.
  useEffect(() => {
    let Built;
    try {
      const Canvas = document.createElement("canvas");
      Canvas.className = "viewport-3d-canvas";
      Canvas.tabIndex = 0;
      Canvas.setAttribute("aria-label", "3D viewport");
      Host.current.appendChild(Canvas);
      const View = new Stage(Canvas, { background: "#0b0b0d", grid: true, shadows: true });
      View.camera.far = 900;
      View.camera.updateProjectionMatrix();
      View.scene.background = null;
      // Sky sphere around the camera, painted from SkyShader.js.
      const SkyImage = document.createElement("canvas");
      SkyImage.width = 512;
      SkyImage.height = 256;
      const SkyTexture = new THREE.CanvasTexture(SkyImage);
      SkyTexture.colorSpace = THREE.SRGBColorSpace;
      const SkySphere = new THREE.Mesh(new THREE.SphereGeometry(800, 64, 32), new THREE.MeshBasicMaterial({ map: SkyTexture, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false }));
      SkySphere.renderOrder = -10;
      SkySphere.raycast = () => {};
      View.scene.add(SkySphere);
      // The sun's disc: a soft additive sprite far along the sun direction.
      const Glow = document.createElement("canvas");
      Glow.width = Glow.height = 128;
      const Brush = Glow.getContext("2d");
      const Gradient = Brush.createRadialGradient(64, 64, 0, 64, 64, 64);
      Gradient.addColorStop(0, "rgba(255,255,255,1)");
      Gradient.addColorStop(0.12, "rgba(255,255,255,1)");
      Gradient.addColorStop(0.18, "rgba(255,255,255,0.45)");
      Gradient.addColorStop(0.45, "rgba(255,255,255,0.08)");
      Gradient.addColorStop(1, "rgba(255,255,255,0)");
      Brush.fillStyle = Gradient;
      Brush.fillRect(0, 0, 128, 128);
      const Disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(Glow), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      Disc.scale.setScalar(70);
      Disc.renderOrder = -9;
      Disc.raycast = () => {};
      View.scene.add(Disc);
      const Lights = View.scene.children.filter((Each) => Each.isLight);
      const Hemisphere = Lights.find((Each) => Each.isHemisphereLight);
      const Fill = Lights.find((Each) => Each.isDirectionalLight && Each !== View.sun);
      if (Fill) Fill.intensity = 0;
      View.sun.shadow.mapSize.set(1024, 1024);
      // Ground: the Atmosphere's ground colour, out to where it meets the sky's own ground near the horizon.
      View.ground.visible = false;
      const Ground = new THREE.Mesh(new THREE.CircleGeometry(300, 96), new THREE.MeshStandardMaterial({ color: "#808080", roughness: 0.95 }));
      Ground.rotation.x = -Math.PI / 2;
      Ground.position.y = -0.002;
      Ground.receiveShadow = true;
      Ground.raycast = () => {};
      View.scene.add(Ground);
      // The sun light follows the sun direction around whatever is out (frame() would put it back over the camera's shoulder).
      let Around = new THREE.Sphere(new THREE.Vector3(), 4);
      const AimSun = (Sphere = Around) => {
        Around = Sphere;
        const Toward = new THREE.Vector3(...(Latest.current.SunDirection || [0, 1, 0]));
        View.sun.position.copy(Around.center).addScaledVector(Toward, Around.radius + 30);
        View.sun.target.position.copy(Around.center);
        const Reach = Around.radius + 2;
        Object.assign(View.sun.shadow.camera, { left: -Reach, right: Reach, top: Reach, bottom: -Reach, near: 0.1, far: Around.radius * 2 + 60 });
        View.sun.shadow.camera.updateProjectionMatrix();
      };
      // Draw only when something changed: the camera moved, or the scene was touched.
      let Dirty = true, Last = "";
          View.renderer.setAnimationLoop(() => {
        if (!Canvas.offsetParent) return;
        const Now = performance.now();
        const Step = Math.min(0.05, (Now - View.lastTime) / 1000);
        View.lastTime = Now;
        View.rig.update(Step);
        const Seen = View.camera.matrixWorld.elements.map((Each) => Each.toFixed(5)).join(",") + View.camera.fov.toFixed(3) + View.canvas.width + "x" + View.canvas.height;
        if (!Dirty && Seen === Last) return;
        Last = Seen;
        Dirty = false;
        SkySphere.position.copy(View.camera.position);
        const Toward = Latest.current.SunDirection || [0, 1, 0];
        Disc.position.copy(View.camera.position).add(new THREE.Vector3(...Toward).multiplyScalar(700));
        const Floor = View.grid.material.uniforms;
        Floor.uFocus.value.copy(View.rig.target);
        Floor.uRadius.value = Math.max(6, View.rig.distance * 2.6);
        View.renderer.render(View.scene, View.camera);
        Canvas.dataset.frames = String(+(Canvas.dataset.frames || 0) + 1);
        // Where each object's centre lands on the canvas (fractions), for checks and tools that aim at objects.
        const Centres = {};
        for (const Each of View.content.children[0]?.children || []) {
          const At = Each.position.clone().project(View.camera);
          Centres[Each.userData.componentId] = [+((At.x + 1) / 2).toFixed(4), +((1 - At.y) / 2).toFixed(4)];
        }
        Canvas.dataset.centres = JSON.stringify(Centres);
      });
      // Click (no drag) picks.
      let Down = null;
      Canvas.addEventListener("pointerdown", (Event) => (Down = { X: Event.clientX, Y: Event.clientY, Button: Event.button }));
      Canvas.addEventListener("pointerup", (Event) => {
        if (!Down || Down.Button !== 0 || Math.hypot(Event.clientX - Down.X, Event.clientY - Down.Y) > 4) return;
        const Hit = View.pick(Event.clientX, Event.clientY);
        if (Hit) Latest.current.Select?.(Hit.componentId, { Add: Event.ctrlKey || Event.metaKey || Event.shiftKey });
      });
      Canvas.addEventListener("keydown", (Event) => {
        if (Event.key.toLowerCase() === "f") Scene.current?.FrameChosen?.();
      });
      Built = { View, Canvas, SkyImage, SkyTexture, SkySphere, Disc, Hemisphere, Ground, AimSun, Touch: () => (Dirty = true), Framed: false };
      Scene.current = Built;
    } catch (Problem) {
      Fail(String(Problem?.message || Problem));
    }
    return () => {
      if (!Built) return;
      Built.View.resize = () => {}; // its ResizeObserver outlives the canvas
      Built.View.renderer.setAnimationLoop(null);
      Built.View.setContent(null);
      Built.View.renderer.dispose();
      Built.View.renderer.forceContextLoss();
      Built.Canvas.remove();
      Scene.current = null;
    };
  }, []);

  // The renderer's listeners read the latest props from here (the renderer itself is built once).
  Latest.current.Select = Select;
  Latest.current.SunDirection = Light.Direction;
  Latest.current.Chosen = Chosen;

  // Sky and sun.
  const SkyKey = JSON.stringify([Medium, Light.Elevation, Light.Azimuth, Light.Tint]);
  useEffect(() => {
    const Built = Scene.current;
    if (!Built) return;
    PaintSky(Built.SkyImage, Medium, { Sun: Light.Direction, Tint: Light.Tint }, { Mode: "equirect", Basis: ViewBasis([0, 0, 1]), Warp: true, Disc: 0, Glow: 0, Stars: 1, Exposure: 1.1 });
    Built.SkyTexture.needsUpdate = true;
    // Hemisphere light: the sky's average colour a little above the horizon; the ground bounces the albedo.
    const Row = Built.SkyImage.getContext("2d").getImageData(0, 72, 512, 1).data;
    const Mean = [0, 0, 0];
    for (let At = 0; At < Row.length; At += 4) for (let Channel = 0; Channel < 3; Channel++) Mean[Channel] += Linear(Row[At + Channel] / 255) / 512;
    const Brightest = Math.max(...Mean, 1e-4);
    Built.Hemisphere.color.setRGB(...Mean.map((C) => C / Brightest));
    Built.Hemisphere.groundColor.setRGB(...Medium.Ground.map((C) => Math.min(1, C * 2.2 * (0.3 + Light.Strength))));
    Built.Hemisphere.intensity = 0.15 + 1.25 * Math.min(1, Brightest * 1.6);
    // Haze: the ground fades into the sky's colour just above the horizon, hiding where the ground disc ends.
    const Horizon = Built.SkyImage.getContext("2d").getImageData(0, 124, 512, 1).data;
    const Haze = [0, 0, 0];
    for (let At = 0; At < Horizon.length; At += 4) for (let Channel = 0; Channel < 3; Channel++) Haze[Channel] += Linear(Horizon[At + Channel] / 255) / 512;
    Built.View.scene.fog = new THREE.Fog(new THREE.Color().setRGB(...Haze), 40, 290);
    const Beam = Built.View.sun;
    Beam.color.setRGB(...Light.Colour);
    Beam.intensity = 2.6 * Light.Strength * Math.max(0, Math.min(1, (Light.Elevation + 1) / 3));
    Built.AimSun();
    Built.Ground.material.color.setRGB(...Medium.Ground);
    Built.Disc.material.color.setRGB(...Light.Colour.map((C) => C * Math.min(1, 0.2 + Light.Strength)));
    Built.Disc.visible = Light.Elevation > -1.5;
    Built.Touch();
    Built.Canvas.dataset.sky = SkyKey;
  }, [SkyKey]);

  // Shapes.
  const ShapeKey = JSON.stringify(
    Placed.map(({ Row, Along, Position, Rotation, Scale }) => {
      const Own = Values[Row.Id] || {};
      const Material = ResolveMaterial(Own).Channels;
      return [Row.Id, Along, Position, Rotation, Scale, Object.entries(Own).filter(([Key]) => Key.startsWith("Geometry ")), Material.colour?.Fill, Material.roughness?.Fill, Material.metallic?.Fill];
    }),
  );
  useEffect(() => {
    const Built = Scene.current;
    if (!Built) return;
    const Group = new THREE.Group();
    const Bounds = new THREE.Box3();
    for (const { Row, Shape, Along, Position, Rotation, Scale } of Placed) {
      const Own = Values[Row.Id] || {};
      const { Geometry, Lift } = ShapeGeometry(Shape, (Key) => Own[Key]);
      const Material = ResolveMaterial(Own).Channels;
      const Colour = /^#[\da-f]{6}$/i.test(Material.colour?.Fill || "") ? Material.colour.Fill : "#c7ada0";
      const Mesh = new THREE.Mesh(
        Geometry,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(Colour),
          roughness: Math.max(0.04, Math.min(1, +Material.roughness?.Fill || 0.32)),
          metalness: Math.max(0, Math.min(1, +Material.metallic?.Fill || 0)),
        }),
      );
      Mesh.castShadow = Mesh.receiveShadow = true;
      Mesh.position.set(Along + Position[0], Lift * Scale[1] + Position[1], Position[2]);
      Mesh.rotation.set(Rotation[0] * Rad, Rotation[1] * Rad, Rotation[2] * Rad);
      Mesh.scale.set(...Scale);
      Mesh.userData.componentId = Row.Id;
      Group.add(Mesh);
      Mesh.updateMatrixWorld(true);
      Bounds.expandByObject(Mesh);
    }
    Built.View.setContent(Group);
    if (!Built.Framed && !Bounds.isEmpty()) {
      Built.View.frame(Bounds.clone().expandByScalar(0.2), { yaw: 24, pitch: 9, animate: false });
      Built.Framed = true;
    }
    // Shadows cover everything that's out.
    const Sphere = Bounds.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 4) : Bounds.getBoundingSphere(new THREE.Sphere());
    Built.AimSun(Sphere);
    Built.Group = Group;
    Built.FrameChosen = () => {
      const Picks = new THREE.Box3();
      for (const Mesh of Built.Group.children) if (Latest.current.Chosen?.has(Mesh.userData.componentId)) Picks.expandByObject(Mesh);
      if (Picks.isEmpty()) return;
      Built.View.frame(Picks.expandByScalar(0.3), { keepAngle: true });
      Built.AimSun(Sphere);
    };
    Built.Touch();
    Built.Canvas.dataset.objects = String(Placed.length);
  }, [ShapeKey, SkyKey]);

  // Selection outlines: only these change when the selection does, so picking doesn't rebuild the shapes.
  const ChosenKey = [Selected, ...Chosen].join(" ") + "|" + ShapeKey.length;
  useEffect(() => {
    const Built = Scene.current;
    if (!Built?.Group) return;
    for (const Mesh of Built.Group.children) {
      for (const Old of Mesh.children.filter((Each) => Each.userData.outline)) {
        Mesh.remove(Old);
        Old.geometry.dispose();
        Old.material.dispose();
      }
      const Id = Mesh.userData.componentId;
      if (!Chosen.has(Id)) continue;
      const Edges = new THREE.LineSegments(new THREE.EdgesGeometry(Mesh.geometry, 30), new THREE.LineBasicMaterial({ color: Id === Selected ? Accent : "#ffd98a", depthTest: false, transparent: true, opacity: 0.95 }));
      Edges.renderOrder = 5;
      Edges.raycast = () => {};
      Edges.userData.outline = true;
      Mesh.add(Edges);
    }
    Built.Touch();
    Built.Canvas.dataset.chosen = Built.Group.children.map((Mesh) => Mesh.userData.componentId).filter((Id) => Chosen.has(Id)).join(" ");
  }, [ChosenKey, ShapeKey, SkyKey]);

  useEffect(() => {
    if (FrameToken) Scene.current?.FrameChosen?.();
  }, [FrameToken]);

  return (
    <div className="viewport-3d" ref={Host} role="region" aria-label="3D viewport region">
      {Failed && <p className="viewport-3d-failed">The 3D viewport could not start: {Failed}</p>}
      <span className="viewport-3d-caption">3D PREVIEW · THREE.JS · SHOWCASE LINE {ShowcaseSpacing} M APART</span>
    </div>
  );
}

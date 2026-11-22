//============================================================================================================================================
//                                                         COLLISIONWORKSPACE.JSX
//============================================================================================================================================
// 🧩 Collision Fit workspace. Runs the Geometry Compiler's collision fitting and surface checks (Shared/GeometryCompile/Engine/
// MeshAnalysis.js: box, Ritter sphere and long-axis capsule fits, collision volumes, edge-use topology, surface area) on the selection's
// own surface, compares the fits against the enclosed volume, and writes the chosen proxy into the Collision component (Values[owner]
// "Collision Shape" / "Collision Margin"). Only the algorithms come from the compiler; the layout is Project Zero's. Browser authoring only.

import React, { useMemo } from "react";
import { fitCollision, collisionVolume, analyseTopology, surfaceArea, computeBounds } from "../Shared/GeometryCompile/Engine/MeshAnalysis.js";
import { formatLength as FormatLength } from "../FractureEditor/FractureModel.js";
import { PrimitiveSurface, OrbitView, PaintPolygons } from "./WorkspaceGeometry.js";
import { ShapeOf, CollisionProxy } from "./PrimitiveInspector.jsx";
import { Surface, useOrbit, Download, GeometryKeys } from "./WorkspaceSurface.jsx";

// The fits MeshAnalysis can make, with the tone each is drawn in.
export const FitShapes = [
  { Type: "box", Label: "Box", Tone: "#7ab8ff" },
  { Type: "sphere", Label: "Sphere", Tone: "#7be0ad" },
  { Type: "capsule", Label: "Capsule", Tone: "#edc181" },
];
const ProxyNames = { auto: "Automatic", box: "Box", sphere: "Sphere", capsule: "Capsule", convex: "Convex hull", sdf: "Distance field" };

// Enclosed volume by the divergence theorem (signed tetrahedra against the origin); exact for a closed surface.
function EnclosedVolume(P, I) {
  let Sum = 0;
  for (let T = 0; T < I.length; T += 3) {
    const A = I[T] * 3, B = I[T + 1] * 3, C = I[T + 2] * 3;
    Sum += P[A] * (P[B + 1] * P[C + 2] - P[B + 2] * P[C + 1]) - P[A + 1] * (P[B] * P[C + 2] - P[B + 2] * P[C]) + P[A + 2] * (P[B] * P[C + 1] - P[B + 1] * P[C]);
  }
  return Math.abs(Sum) / 6;
}

// Topology needs shared corners; primitives keep hard edges (cylinder cap rims) as duplicated vertices, so weld by position first.
function WeldedIndices(P, I) {
  const Seen = new Map(), Remap = new Uint32Array(P.length / 3);
  for (let V = 0; V < Remap.length; V++) {
    const Key = `${Math.round(P[V * 3] * 1e5)},${Math.round(P[V * 3 + 1] * 1e5)},${Math.round(P[V * 3 + 2] * 1e5)}`;
    if (!Seen.has(Key)) Seen.set(Key, Seen.size);
    Remap[V] = Seen.get(Key);
  }
  return { Indices: I.map((Each) => Remap[Each]), Count: Seen.size };
}

export function useCollisionFit(Subject, Values) {
  const Shape = ShapeOf(Subject);
  const Read = (Name, Initial) => (Values[Name] === undefined ? Initial : Values[Name]);
  const Scale = Array.isArray(Values.Scale) ? Values.Scale.map((Each) => Math.abs(+Each) || 1) : [1, 1, 1];
  const Margin = Math.max(0, +Read("Collision Margin", 0.01) || 0);
  const BodyKey = JSON.stringify([Shape, Scale, GeometryKeys.map((Name) => Values[Name])]);
  const Body = useMemo(() => PrimitiveSurface(Shape, Read, Scale), [BodyKey]);
  const Report = useMemo(() => {
    const P = Body.Positions, I = Body.Indices;
    const Welded = WeldedIndices(P, I);
    const Topology = analyseTopology(Welded.Indices, Welded.Count);
    const Volume = EnclosedVolume(P, I);
    const Fits = FitShapes.map((Each) => {
      const Fit = fitCollision(P, Each.Type, Margin);
      const Enclosing = collisionVolume(Fit);
      return { ...Each, Fit, Volume: Enclosing, Tightness: Topology.closed && Enclosing > 0 ? Volume / Enclosing : null };
    });
    const Ranked = [...Fits].filter((Each) => Each.Tightness !== null).sort((A, B) => B.Tightness - A.Tightness);
    return { Topology, Volume, Area: surfaceArea(P, I), Bounds: computeBounds(P), Fits, Best: Ranked[0]?.Type || "box", Triangles: I.length / 3, Vertices: Welded.Count };
  }, [BodyKey, Margin]);
  const Chosen = CollisionProxy(Shape, Read);
  return { Shape, Body, Report, Margin, Chosen, Stored: Read("Collision Shape", "auto") };
}

// Wire outline of a fitted shape as 3D polylines.
function Outline(Fit) {
  const Ring = (Centre, U, V, Radius, From = 0, To = Math.PI * 2, Steps = 40) =>
    Array.from({ length: Steps + 1 }, (_, Index) => {
      const A = From + ((To - From) * Index) / Steps;
      return [0, 1, 2].map((K) => Centre[K] + Radius * (Math.cos(A) * U[K] + Math.sin(A) * V[K]));
    });
  const Axis = (K) => [0, 1, 2].map((Each) => (Each === K ? 1 : 0));
  if (Fit.type === "box") {
    const [Cx, Cy, Cz] = Fit.centre, [Hx, Hy, Hz] = Fit.half;
    const C = (X, Y, Z) => [Cx + X * Hx, Cy + Y * Hy, Cz + Z * Hz];
    return [
      [C(-1, -1, -1), C(1, -1, -1), C(1, -1, 1), C(-1, -1, 1), C(-1, -1, -1)],
      [C(-1, 1, -1), C(1, 1, -1), C(1, 1, 1), C(-1, 1, 1), C(-1, 1, -1)],
      [C(-1, -1, -1), C(-1, 1, -1)],
      [C(1, -1, -1), C(1, 1, -1)],
      [C(1, -1, 1), C(1, 1, 1)],
      [C(-1, -1, 1), C(-1, 1, 1)],
    ];
  }
  if (Fit.type === "sphere") return [Ring(Fit.centre, Axis(0), Axis(1), Fit.radius), Ring(Fit.centre, Axis(0), Axis(2), Fit.radius), Ring(Fit.centre, Axis(1), Axis(2), Fit.radius)];
  if (Fit.type === "capsule") {
    const A = Fit.axis, U = Axis((A + 1) % 3), V = Axis((A + 2) % 3), W = Axis(A);
    const End = (Sign) => Fit.centre.map((Each, K) => Each + Sign * Fit.halfHeight * W[K]);
    const Top = End(1), Bottom = End(-1);
    const Lines = [Ring(Top, U, V, Fit.radius), Ring(Bottom, U, V, Fit.radius)];
    for (const Side of [U, V]) {
      Lines.push(Ring(Top, Side, W, Fit.radius, 0, Math.PI, 20), Ring(Bottom, Side, W, Fit.radius, Math.PI, Math.PI * 2, 20));
      for (const Sign of [1, -1]) Lines.push([Top.map((Each, K) => Each + Sign * Fit.radius * Side[K]), Bottom.map((Each, K) => Each + Sign * Fit.radius * Side[K])]);
    }
    return Lines;
  }
  return [];
}

const Percent = (Amount) => (Amount === null ? "–" : `${(100 * Amount).toFixed(1)} %`);
const Cubic = (Amount) => (Amount < 0.001 ? `${(Amount * 1e6).toFixed(0)} cm³` : `${Amount.toFixed(3)} m³`);

export function CollisionView({ Subject, Values, Workspace, SetWorkspace }) {
  const Fit = useCollisionFit(Subject, Values);
  const Orbit = useOrbit(Workspace, SetWorkspace);
  const Showing = Workspace.FitPreview || (FitShapes.some((Each) => Each.Type === Fit.Chosen) ? Fit.Chosen : Fit.Report.Best);
  const Paint = (Brush, Width, Height) => {
    const Radius = Fit.Report.Bounds.radius + Fit.Margin;
    const View = OrbitView({ Yaw: Workspace.Yaw ?? 0.7, Pitch: Workspace.Pitch ?? 0.45, Radius: Radius * 1.15, Width, Height, Zoom: Workspace.Zoom ?? 1 });
    const P = Fit.Body.Positions, I = Fit.Body.Indices, Polygons = [];
    for (let T = 0; T < I.length; T += 3) {
      Polygons.push({
        Points: [0, 1, 2].map((K) => [P[I[T + K] * 3], P[I[T + K] * 3 + 1], P[I[T + K] * 3 + 2]]),
        Paint: (B, Screen, Lit) => {
          B.beginPath();
          Screen.forEach(([X, Y], Index) => (Index ? B.lineTo(X, Y) : B.moveTo(X, Y)));
          B.closePath();
          const Level = Math.round(40 + 120 * Lit);
          B.fillStyle = `rgb(${Level},${Level},${Level + 6})`;
          B.fill();
          B.strokeStyle = `rgb(${Level},${Level},${Level + 6})`;
          B.lineWidth = 0.6;
          B.stroke();
        },
      });
    }
    PaintPolygons(Brush, View, Polygons);
    for (const Each of Fit.Report.Fits) {
      const Active = Each.Type === Showing;
      Brush.strokeStyle = Each.Tone;
      Brush.globalAlpha = Active ? 0.95 : 0.18;
      Brush.lineWidth = Active ? 1.6 : 1;
      Brush.setLineDash(Active ? [] : [4, 4]);
      for (const Line of Outline(Each.Fit)) {
        Brush.beginPath();
        Line.map(View.Project).forEach(([X, Y], Index) => (Index ? Brush.lineTo(X, Y) : Brush.moveTo(X, Y)));
        Brush.stroke();
      }
    }
    Brush.globalAlpha = 1;
    Brush.setLineDash([]);
  };
  const Tightest = Math.max(...Fit.Report.Fits.map((Each) => Each.Tightness || 0), 1e-6);
  return (
    <div className="ws-view ws-view-collision">
      <div className="ws-pane">
        <span className="ws-pane-label">
          {FitShapes.find((Each) => Each.Type === Showing)?.Label} fit · margin {FormatLength(Fit.Margin)} · drag to orbit
        </span>
        <Surface Paint={Paint} Label={`${Subject.Name} collision fit`} Deps={[Showing, Fit.Margin]} Handlers={{ ...Orbit, onPointerUp: (Event) => Orbit.End(Event) }} />
      </div>
      <div className="ws-pane ws-fit-compare">
        <span className="ws-pane-label">How much of each shape the object fills · higher is tighter</span>
        <div className="ws-fit-bars" role="list" aria-label="Fit comparison">
          {Fit.Report.Fits.map((Each) => (
            <button
              key={Each.Type}
              type="button"
              role="listitem"
              className={"ws-fit-bar" + (Each.Type === Showing ? " active" : "")}
              data-fit={Each.Type}
              style={{ "--tone": Each.Tone, "--fill": `${(100 * (Each.Tightness || 0)) / Tightest}%` }}
              onClick={() => SetWorkspace((Previous) => ({ ...Previous, FitPreview: Each.Type }))}
            >
              <span className="ws-fit-name">
                <b>{Each.Label}</b>
                {Each.Type === Fit.Report.Best && <small>tightest</small>}
                {Each.Type === Fit.Chosen && <small className="used">in use</small>}
              </span>
              <span className="ws-fit-track">
                <i />
              </span>
              <span className="ws-fit-figure">{Percent(Each.Tightness)}</span>
            </button>
          ))}
        </div>
        <p className="ws-fit-foot">
          Encloses {Cubic(Fit.Report.Volume)} · {Fit.Report.Topology.closed ? "closed surface" : "open surface: fill ratios need a closed surface"}
        </p>
      </div>
    </div>
  );
}

export function CollisionPanel({ Subject, Values, Change, Workspace, SetWorkspace, Kit }) {
  const { Card, Control, Metric } = Kit;
  const Fit = useCollisionFit(Subject, Values);
  const { Report } = Fit;
  const T = Report.Topology;
  const Readout = (Label, Text) => <Control key={Label} Field={{ Label, Control: "Readout" }} Value={Text} />;
  const Showing = Workspace.FitPreview || (FitShapes.some((Each) => Each.Type === Fit.Chosen) ? Fit.Chosen : Report.Best);
  const Name = String(Subject.Name || "geometry").replace(/[^a-z0-9]+/gi, "_");
  const ExportFits = () =>
    Download(
      `${Name}_collision.json`,
      JSON.stringify({ object: Subject.Name, margin: Fit.Margin, enclosedVolume: Report.Volume, closed: T.closed, fits: Report.Fits.map((Each) => ({ ...Each.Fit, volume: Each.Volume, tightness: Each.Tightness })) }, null, 2),
      "application/json",
    );
  return (
    <>
      <Card Title="Surface check" Class="ws-card">
        <Metric Value={T.closed ? "Closed" : "Open"} Unit={T.closed ? "watertight" : `${T.boundary} open edges`} Caption={`${Report.Triangles.toLocaleString("en-US")} triangles · ${Report.Vertices.toLocaleString("en-US")} vertices · ${T.parts} part${T.parts === 1 ? "" : "s"}`} />
        {Readout("Edges", T.edges.toLocaleString("en-US"))}
        {Readout("Open edges", String(T.boundary))}
        {Readout("Non-manifold edges", String(T.nonManifold))}
        {Readout("Surface area", `${Report.Area.toFixed(3)} m²`)}
        {Readout("Enclosed volume", T.closed ? Cubic(Report.Volume) : "– (open)")}
        {Readout("Bounds", Report.Bounds.size.map((Each) => FormatLength(Each)).join(" × "))}
        <p className="ws-note">Edge-use counts from the Geometry Compiler: every edge of a watertight surface is shared by exactly two triangles.</p>
      </Card>
      <Card Title="Fitted shapes" Class="ws-card">
        <Metric Value={ProxyNames[Fit.Chosen] || Fit.Chosen} Unit="in the Collision component" Caption={Fit.Stored === "auto" ? "Automatic picks this for the shape; choose a fit below to set it." : "Set on the object's Collision component."} />
        <div className="ws-fit-table" role="table" aria-label="Fitted shapes">
          <b>SHAPE</b>
          <b>VOLUME</b>
          <b>FILLED</b>
          <b />
          {Report.Fits.map((Each) => (
            <React.Fragment key={Each.Type}>
              <button type="button" className={"ws-fit-pick" + (Each.Type === Showing ? " active" : "")} style={{ "--tone": Each.Tone }} onClick={() => SetWorkspace((Previous) => ({ ...Previous, FitPreview: Each.Type }))}>
                <i />
                {Each.Label}
              </button>
              <span>{Cubic(Each.Volume)}</span>
              <span>{Percent(Each.Tightness)}</span>
              <button type="button" className="ws-fit-use" data-use={Each.Type} disabled={Fit.Stored === Each.Type} onClick={() => Change("Collision Shape", Each.Type)}>
                {Fit.Stored === Each.Type ? "In use" : "Use"}
              </button>
            </React.Fragment>
          ))}
        </div>
        <Control Field={{ Label: "Margin", Minimum: 0, Maximum: 0.1, Decimals: 3, Unit: "m", Default: 0.01 }} Value={Fit.Margin} Change={(Next) => Change("Collision Margin", Next)} />
        <div className="ws-actions">
          <button type="button" disabled={Fit.Stored === "auto"} onClick={() => Change("Collision Shape", "auto")}>
            Back to Automatic
          </button>
          <button type="button" onClick={ExportFits}>
            Export fits as JSON
          </button>
        </div>
        <p className="ws-note">Box is axis aligned, the sphere is Ritter's bound and the capsule runs along the longest side. Convex hull and the distance field stay on the Collision component's own page.</p>
      </Card>
    </>
  );
}

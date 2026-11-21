//============================================================================================================================================
//                                                              WORKSPACES.JSX
//============================================================================================================================================
// 🧰 Edit-mode workspaces. Instead of a dedicated editor window per tool, the selection is isolated in the viewport and the tool works on
// it there, with its controls in the inspector. UV (unwrap, islands, checker) and Fracture (recipe, impact, pieces) are the first two;
// further workspaces register in `WorkspaceTools`. Browser authoring only; the native renderer is not connected.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { unwrapCharts, packCharts, cornerUvs, layoutStatistics } from "../GeometryCompiler/Engine/UvCharts.js";
import { formatObj, formatUvSvg } from "../GeometryCompiler/Engine/ObjExport.js";
import {
  normalize as NormalizeRecipe,
  shatter as Shatter,
  intact as Intact,
  pieceStats as PieceStats,
  histogram as Histogram,
  signature as RecipeSignature,
  bakeState as BakeState,
  STATE_TEXT,
  MATERIALS,
  MATERIAL,
  ENERGY_PRESETS,
  LIMITS,
  formatEnergy as FormatEnergy,
  formatLength as FormatLength,
} from "../FractureEditor/FractureModel.js";
import { PrimitiveSurface, OrbitView, PaintPolygons, TexturedTriangle, CheckerTexture, Normal } from "./WorkspaceGeometry.js";
import { ShapeOf } from "./PrimitiveInspector.jsx";
import "./Workspaces.css";

export const WorkspaceTools = [
  { Tool: "uv", Name: "UV", Caption: "Unwrap islands, move and pack them; the object shows the checker." },
  { Tool: "fracture", Name: "Fracture", Caption: "Shatter with a recipe; click the object to place the impact." },
];
const Hue = (Index) => (Index * 137.508) % 360;
const Clamp = (Amount, Minimum, Maximum) => Math.max(Minimum, Math.min(Maximum, Amount));

function Download(Name, Text, Type = "text/plain") {
  const Link = document.createElement("a");
  Link.href = URL.createObjectURL(new Blob([Text], { type: Type }));
  Link.download = Name;
  Link.click();
  setTimeout(() => URL.revokeObjectURL(Link.href), 2000);
}

// A canvas that repaints on size change and hands the painter CSS-pixel dimensions.
function Surface({ Paint, Label, Class = "", Handlers = {}, Deps = [] }) {
  const Ref = useRef(null);
  const PaintRef = useRef(Paint);
  PaintRef.current = Paint;
  const Draw = () => {
    const Canvas = Ref.current;
    if (!Canvas) return;
    const Width = Canvas.clientWidth || 300, Height = Canvas.clientHeight || 300, Ratio = Math.min(devicePixelRatio || 1, 2);
    if (Canvas.width !== Math.round(Width * Ratio) || Canvas.height !== Math.round(Height * Ratio)) {
      Canvas.width = Math.round(Width * Ratio);
      Canvas.height = Math.round(Height * Ratio);
    }
    const Brush = Canvas.getContext("2d");
    Brush.setTransform(Ratio, 0, 0, Ratio, 0, 0);
    Brush.clearRect(0, 0, Width, Height);
    PaintRef.current(Brush, Width, Height);
  };
  useEffect(() => {
    const Observer = new ResizeObserver(Draw);
    Observer.observe(Ref.current);
    return () => Observer.disconnect();
  }, []);
  useEffect(Draw);
  return <canvas ref={Ref} className={"ws-surface " + Class} role="img" aria-label={Label} {...Handlers} />;
}

// Orbit + click handling shared by both stages: drag turns the view, a click without movement is passed to `Pick`.
function useOrbit(Workspace, SetWorkspace) {
  const Drag = useRef(null);
  return {
    onPointerDown: (Event) => {
      Drag.current = { X: Event.clientX, Y: Event.clientY, Yaw: Workspace.Yaw ?? 0.7, Pitch: Workspace.Pitch ?? 0.45, Moved: false };
      Event.currentTarget.setPointerCapture(Event.pointerId);
    },
    onPointerMove: (Event) => {
      const Start = Drag.current;
      if (!Start) return;
      const Dx = Event.clientX - Start.X, Dy = Event.clientY - Start.Y;
      if (Math.hypot(Dx, Dy) > 3) Start.Moved = true;
      if (Start.Moved) SetWorkspace((Previous) => ({ ...Previous, Yaw: Start.Yaw + Dx * 0.01, Pitch: Clamp(Start.Pitch + Dy * 0.01, -1.45, 1.45) }));
    },
    onWheel: (Event) => SetWorkspace((Previous) => ({ ...Previous, Zoom: Clamp((Previous.Zoom ?? 1) * (Event.deltaY > 0 ? 0.9 : 1.1), 0.4, 4) })),
    End: (Event, Pick) => {
      const Start = Drag.current;
      Drag.current = null;
      if (Start && !Start.Moved && Pick) Pick(Event);
    },
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   UV
//------------------------------------------------------------------------------------------------------------------------

const GeometryKeys = ["Geometry Size X", "Geometry Size Y", "Geometry Size Z", "Geometry Radius", "Geometry Height", "Geometry Segments", "Geometry Rings", "Geometry Major Radius", "Geometry Minor Radius", "Geometry Sides", "Geometry Caps"];

// The unwrap for the selection, with any island edits stored in Values["UV Layout"] re-applied when the mesh has not changed since.
export function useUvLayout(Subject, Values) {
  const Shape = ShapeOf(Subject);
  const Scale = Array.isArray(Values.Scale) ? Values.Scale.map((Each) => Math.abs(+Each) || 1) : [1, 1, 1];
  const Stored = Values["UV Layout"] || {};
  const Angle = Clamp(+Stored.Angle || 60, 15, 89);
  const Key = JSON.stringify([Shape, Scale, Angle, GeometryKeys.map((Name) => Values[Name])]);
  const Base = useMemo(() => {
    const Read = (Name, Initial) => (Values[Name] === undefined ? Initial : Values[Name]);
    const Mesh = PrimitiveSurface(Shape, Read, Scale);
    const Layout = packCharts(unwrapCharts(Mesh.Positions, Mesh.Indices, { normalLimitDeg: Angle }));
    return { Mesh, Layout, Packed: Layout.charts.map((Chart) => ({ R: Chart.rotation, M: !!Chart.mirror, C: Chart.center.slice() })) };
  }, [Key]);
  const Edits = Stored.Key === Key && Array.isArray(Stored.Charts) && Stored.Charts.length === Base.Layout.charts.length ? Stored.Charts : Base.Packed;
  // Apply edits on a shallow copy so the memoised base stays the packed layout.
  const Layout = { ...Base.Layout, charts: Base.Layout.charts.map((Chart, Index) => ({ ...Chart, rotation: Edits[Index].R & 3, mirror: !!Edits[Index].M, center: Edits[Index].C })) };
  const Uvs = cornerUvs(Layout);
  return { Shape, Mesh: Base.Mesh, Layout, Uvs, Key, Edits, Packed: Base.Packed, Angle, Statistics: layoutStatistics(Layout, Uvs) };
}

function IslandOf(Layout, Uvs, U, V) {
  for (let Index = Layout.charts.length - 1; Index >= 0; Index--)
    for (const Triangle of Layout.charts[Index].triangles) {
      const A = Triangle * 6;
      const [X0, Y0, X1, Y1, X2, Y2] = [Uvs[A], Uvs[A + 1], Uvs[A + 2], Uvs[A + 3], Uvs[A + 4], Uvs[A + 5]];
      const D = (Y1 - Y2) * (X0 - X2) + (X2 - X1) * (Y0 - Y2);
      if (Math.abs(D) < 1e-12) continue;
      const L0 = ((Y1 - Y2) * (U - X2) + (X2 - X1) * (V - Y2)) / D, L1 = ((Y2 - Y0) * (U - X2) + (X0 - X2) * (V - Y2)) / D;
      if (L0 >= 0 && L1 >= 0 && L0 + L1 <= 1) return Index;
    }
  return -1;
}

function UvView({ Subject, Values, Change, Workspace, SetWorkspace }) {
  const Unwrap = useUvLayout(Subject, Values);
  const { Mesh, Layout, Uvs } = Unwrap;
  const Selection = new Set(Workspace.Selection || []);
  const Orbit = useOrbit(Workspace, SetWorkspace);
  const Checker = CheckerTexture(Workspace.Cells || 8);
  const Radius = useMemo(() => {
    let Far = 0;
    for (let Index = 0; Index < Mesh.Positions.length; Index += 3) Far = Math.max(Far, Math.hypot(Mesh.Positions[Index], Mesh.Positions[Index + 1], Mesh.Positions[Index + 2]));
    return Far || 1;
  }, [Mesh]);
  const ChartOf = useMemo(() => {
    const Map_ = new Int32Array(Layout.triangleCount);
    Layout.charts.forEach((Chart, Index) => Chart.triangles.forEach((Triangle) => (Map_[Triangle] = Index)));
    return Map_;
  }, [Unwrap.Key]);

  // 3D: every triangle textured with the checker through its current UVs, shaded, selected islands tinted.
  const PaintObject = (Brush, Width, Height) => {
    const View = OrbitView({ Yaw: Workspace.Yaw ?? 0.7, Pitch: Workspace.Pitch ?? 0.45, Radius, Width, Height, Zoom: Workspace.Zoom ?? 1 });
    const P = Mesh.Positions, I = Mesh.Indices, Polygons = [];
    for (let Triangle = 0; Triangle < I.length / 3; Triangle++) {
      const Points = [0, 1, 2].map((Corner) => {
        const V = I[Triangle * 3 + Corner] * 3;
        return [P[V], P[V + 1], P[V + 2]];
      });
      const Island = ChartOf[Triangle], Uv = Uvs.subarray(Triangle * 6, Triangle * 6 + 6);
      Polygons.push({
        Points,
        Paint: (B, Screen, Lit) => {
          if (Workspace.Checker !== false) TexturedTriangle(B, Checker, Screen, Uv);
          else {
            B.beginPath();
            Screen.forEach(([X, Y], Index) => (Index ? B.lineTo(X, Y) : B.moveTo(X, Y)));
            B.closePath();
            B.fillStyle = `hsl(${Hue(Island)} 34% 52%)`;
            B.fill();
          }
          B.beginPath();
          Screen.forEach(([X, Y], Index) => (Index ? B.lineTo(X, Y) : B.moveTo(X, Y)));
          B.closePath();
          B.fillStyle = `rgba(0,0,0,${(1 - Lit) * 0.75})`;
          B.fill();
          if (Selection.has(Island)) {
            B.fillStyle = "rgba(255,190,110,0.28)";
            B.fill();
          }
        },
      });
    }
    PaintPolygons(Brush, View, Polygons);
    // Seams on the object: edges between islands.
    if (Workspace.Seams !== false) {
      Brush.strokeStyle = "#ffb15a";
      Brush.lineWidth = 1.4;
      Brush.beginPath();
      for (const Slot of Layout.seams) {
        const Triangle = (Slot / 3) | 0, Corner = Slot % 3;
        const A = I[Triangle * 3 + Corner] * 3, B_ = I[Triangle * 3 + ((Corner + 1) % 3)] * 3;
        const N = Normal(...[0, 1, 2].map((C) => { const V = I[Triangle * 3 + C] * 3; return [P[V], P[V + 1], P[V + 2]]; }));
        if (N[0] * View.Toward[0] + N[1] * View.Toward[1] + N[2] * View.Toward[2] <= 0) continue;
        const S0 = View.Project([P[A], P[A + 1], P[A + 2]]), S1 = View.Project([P[B_], P[B_ + 1], P[B_ + 2]]);
        Brush.moveTo(S0[0], S0[1]);
        Brush.lineTo(S1[0], S1[1]);
      }
      Brush.stroke();
    }
  };

  // UV square: checker, island fills, outlines, selection.
  const Square = (Width, Height) => {
    const Side = Math.min(Width, Height) - 28;
    return { Left: (Width - Side) / 2, Top: (Height - Side) / 2, Side };
  };
  const PaintUv = (Brush, Width, Height) => {
    const { Left, Top, Side } = Square(Width, Height);
    Brush.globalAlpha = Workspace.Checker !== false ? 0.35 : 0.08;
    Brush.drawImage(Checker, Left, Top, Side, Side);
    Brush.globalAlpha = 1;
    Brush.strokeStyle = "#ffffff30";
    Brush.strokeRect(Left + 0.5, Top + 0.5, Side, Side);
    const X = (U) => Left + U * Side, Y = (V) => Top + (1 - V) * Side;
    Layout.charts.forEach((Chart, Index) => {
      const Selected = Selection.has(Index);
      Brush.beginPath();
      for (const Triangle of Chart.triangles) {
        const A = Triangle * 6;
        Brush.moveTo(X(Uvs[A]), Y(Uvs[A + 1]));
        Brush.lineTo(X(Uvs[A + 2]), Y(Uvs[A + 3]));
        Brush.lineTo(X(Uvs[A + 4]), Y(Uvs[A + 5]));
        Brush.closePath();
      }
      Brush.fillStyle = Selected ? "rgba(255,177,90,0.42)" : `hsla(${Hue(Index)} 40% 55% / 0.32)`;
      Brush.fill();
      Brush.strokeStyle = Selected ? "#ffcf96" : "#ffffff26";
      Brush.lineWidth = 0.6;
      Brush.stroke();
    });
    if (Workspace.Seams !== false) {
      Brush.strokeStyle = "#ffb15a";
      Brush.lineWidth = 1.2;
      Brush.beginPath();
      for (const Slot of Layout.seams) {
        const Triangle = (Slot / 3) | 0, Corner = Slot % 3;
        const A = (Triangle * 3 + Corner) * 2, B = (Triangle * 3 + ((Corner + 1) % 3)) * 2;
        Brush.moveTo(X(Uvs[A]), Y(Uvs[A + 1]));
        Brush.lineTo(X(Uvs[B]), Y(Uvs[B + 1]));
      }
      Brush.stroke();
    }
    Brush.fillStyle = "#8a8a8a";
    Brush.font = "9px sans-serif";
    Brush.fillText("0,0", Left, Top + Side + 12);
    Brush.textAlign = "right";
    Brush.fillText("1,1", Left + Side, Top - 4);
  };
  const UvDrag = useRef(null);
  const UvAt = (Event) => {
    const Rect = Event.currentTarget.getBoundingClientRect();
    const { Left, Top, Side } = Square(Rect.width, Rect.height);
    return [(Event.clientX - Rect.left - Left) / Side, 1 - (Event.clientY - Rect.top - Top) / Side];
  };
  const WriteEdits = (Charts) => Change("UV Layout", { Key: Unwrap.Key, Angle: Unwrap.Angle, Charts });
  const UvHandlers = {
    onPointerDown: (Event) => {
      const [U, V] = UvAt(Event);
      const Island = IslandOf(Layout, Uvs, U, V);
      let Next = new Set(Selection);
      if (Island < 0) Next = Event.shiftKey ? Next : new Set();
      else if (Event.shiftKey || Event.ctrlKey || Event.metaKey) Next.has(Island) ? Next.delete(Island) : Next.add(Island);
      else if (!Next.has(Island)) Next = new Set([Island]);
      SetWorkspace((Previous) => ({ ...Previous, Selection: [...Next] }));
      if (Island >= 0 && Next.has(Island)) {
        UvDrag.current = { U, V, Start: Unwrap.Edits.map((Edit) => ({ ...Edit, C: Edit.C.slice() })), Moving: [...Next] };
        Event.currentTarget.setPointerCapture(Event.pointerId);
      }
    },
    onPointerMove: (Event) => {
      const Drag = UvDrag.current;
      if (!Drag) return;
      const [U, V] = UvAt(Event);
      const Du = U - Drag.U, Dv = V - Drag.V;
      WriteEdits(Drag.Start.map((Edit, Index) => (Drag.Moving.includes(Index) ? { ...Edit, C: [Edit.C[0] + Du, Edit.C[1] + Dv] } : Edit)));
    },
    onPointerUp: () => (UvDrag.current = null),
  };
  return (
    <div className="ws-view ws-view-uv">
      <div className="ws-pane">
        <span className="ws-pane-label">Object · checker through current UVs</span>
        <Surface Paint={PaintObject} Label={`${Subject.Name} with UV checker`} Handlers={{ ...Orbit, onPointerUp: (Event) => Orbit.End(Event) }} />
      </div>
      <div className="ws-pane">
        <span className="ws-pane-label">UV space · {Layout.charts.length} islands · drag to move</span>
        <Surface Paint={PaintUv} Label="UV layout" Class="ws-uv" Handlers={UvHandlers} />
      </div>
    </div>
  );
}

function UvPanel({ Subject, Values, Change, Workspace, SetWorkspace, Kit }) {
  const { Card, Control, Metric } = Kit;
  const Unwrap = useUvLayout(Subject, Values);
  const { Layout, Uvs, Statistics, Edits } = Unwrap;
  const Selection = (Workspace.Selection || []).filter((Index) => Index < Layout.charts.length);
  const Coverage = Statistics.uvArea;
  const WriteEdits = (Charts) => Change("UV Layout", { Key: Unwrap.Key, Angle: Unwrap.Angle, Charts });
  const Targets = Selection.length ? Selection : Layout.charts.map((_, Index) => Index);
  const Apply = (Edit) => WriteEdits(Edits.map((Each, Index) => (Targets.includes(Index) ? Edit(Each) : Each)));
  const Bounds = (Index) => {
    let MinU = Infinity, MinV = Infinity, MaxU = -Infinity, MaxV = -Infinity;
    for (const Triangle of Layout.charts[Index].triangles)
      for (let K = 0; K < 6; K += 2) {
        MinU = Math.min(MinU, Uvs[Triangle * 6 + K]);
        MaxU = Math.max(MaxU, Uvs[Triangle * 6 + K]);
        MinV = Math.min(MinV, Uvs[Triangle * 6 + K + 1]);
        MaxV = Math.max(MaxV, Uvs[Triangle * 6 + K + 1]);
      }
    return [MinU, MinV, MaxU, MaxV];
  };
  const Outside = Layout.charts.filter((_, Index) => {
    const [A, B, C, D] = Bounds(Index);
    return A < -1e-4 || B < -1e-4 || C > 1.0001 || D > 1.0001;
  }).length;
  const Name = String(Subject.Name || "geometry").replace(/[^a-z0-9]+/gi, "_");
  return (
    <>
      <Card Title="UV layout" Class="ws-card">
        <Metric Value={(Coverage * 100).toFixed(1)} Unit="% used" Caption={`${Layout.charts.length} islands · ${Layout.seams.length} seam edges · ${Outside ? Outside + " outside 0–1" : "all inside 0–1"}`} />
        <div className="ws-readouts">
          <Control Field={{ Label: "Texel scale", Control: "Readout" }} Value={(Statistics.texelScale).toFixed(3) + " UV/m"} />
          <Control Field={{ Label: "Selected", Control: "Readout" }} Value={Selection.length ? `${Selection.length} island${Selection.length > 1 ? "s" : ""}` : "none · actions apply to all"} />
        </div>
        <Control
          Field={{ Label: "Unwrap angle", Minimum: 15, Maximum: 89, Decimals: 0, Unit: "°", Default: 60 }}
          Value={Unwrap.Angle}
          Change={(Next) => Change("UV Layout", { Angle: Next })}
        />
        <p className="ws-note">Faces whose normals stay within this angle share an island. Lower splits more; higher makes fewer, more stretched islands.</p>
        <div className="ws-actions">
          <button type="button" onClick={() => Apply((Each) => ({ ...Each, R: (Each.R + 1) & 3 }))}>Rotate 90°</button>
          <button type="button" onClick={() => Apply((Each) => ({ ...Each, M: !Each.M }))}>Mirror U</button>
          <button type="button" onClick={() => {
            // Repack with the edited rotations: re-run the shelf packer on a copy.
            const Copy = { ...Layout, charts: Layout.charts.map((Chart, Index) => ({ ...Chart, rotation: Edits[Index].R & 3, mirror: Edits[Index].M })) };
            packCharts(Copy);
            WriteEdits(Copy.charts.map((Chart) => ({ R: Chart.rotation, M: !!Chart.mirror, C: Chart.center.slice() })));
          }}>Pack</button>
          <button type="button" onClick={() => Change("UV Layout", { Angle: Unwrap.Angle })}>Reset unwrap</button>
        </div>
      </Card>
      <Card Title="Display & export" Class="ws-card">
        <Control Field={{ Label: "Checker on object", Control: "Switch" }} Value={Workspace.Checker !== false} Change={(Next) => SetWorkspace((Previous) => ({ ...Previous, Checker: Next }))} />
        <Control Field={{ Label: "Show seams", Control: "Switch" }} Value={Workspace.Seams !== false} Change={(Next) => SetWorkspace((Previous) => ({ ...Previous, Seams: Next }))} />
        <Control
          Field={{ Label: "Checker cells", Control: "Select", Options: ["4 × 4", "8 × 8", "16 × 16"] }}
          Value={[4, 8, 16].indexOf(Workspace.Cells || 8)}
          Change={(Index) => SetWorkspace((Previous) => ({ ...Previous, Cells: [4, 8, 16][Index] }))}
        />
        <div className="ws-actions">
          <button type="button" onClick={() => {
            const Flat = new Float32Array(Layout.triangleCount * 9), Index = new Uint32Array(Layout.triangleCount * 3);
            for (let Slot = 0; Slot < Layout.triangleCount * 3; Slot++) {
              const V = Unwrap.Mesh.Indices[Slot] * 3;
              Flat.set(Unwrap.Mesh.Positions.subarray(V, V + 3), Slot * 3);
              Index[Slot] = Slot;
            }
            Download(Name + ".obj", formatObj(Flat, Index, Uvs, Name));
          }}>Export OBJ</button>
          <button type="button" onClick={() => Download(Name + "_uv.svg", formatUvSvg(Layout, Uvs, Name), "image/svg+xml")}>Export UV SVG</button>
        </div>
        <p className="ws-note">Projection unwrap with one shared texel density. Island edits are stored on this object and reset when its geometry changes.</p>
      </Card>
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FRACTURE
//------------------------------------------------------------------------------------------------------------------------

const OwnerOf = (Subject, Values) => ({
  Id: Subject.Id,
  Name: Subject.Name,
  Primitive: ShapeOf(Subject),
  Scale: [0, 1, 2].map((Index) => {
    const Amount = Number(Values.Scale?.[Index] ?? 1);
    return Number.isFinite(Amount) ? Math.min(1000, Math.max(0.001, Amount)) : 1;
  }),
});
function useShatter(Subject, Values) {
  const Owner = OwnerOf(Subject, Values);
  const Settings = NormalizeRecipe(Values.Fracture);
  const Key = RecipeSignature(Owner, Settings) + Settings.Enabled;
  return { Owner, Settings, Result: useMemo(() => (Settings.Enabled ? Shatter(Owner, Settings) : Intact(Owner)), [Key]) };
}

function FractureView({ Subject, Values, Change, Workspace, SetWorkspace }) {
  const { Owner, Settings, Result } = useShatter(Subject, Values);
  const Orbit = useOrbit(Workspace, SetWorkspace);
  const Explode = Workspace.Explode ?? 0.25;
  const Last = useRef({ Drawn: [], View: null });
  const Tone = MATERIAL[Settings.Material]?.tone || "#a29d94";
  const Radius = Math.hypot(...Owner.Scale) / 2;
  const Offset = (Cell) => {
    const D = [Cell.centroid[0] - Result.impact[0] * 0.3, Cell.centroid[1] - Result.impact[1] * 0.3, Cell.centroid[2] - Result.impact[2] * 0.3];
    const Length = Math.hypot(...D) || 1;
    return D.map((Each) => (Each / Length) * Explode * Radius * (0.4 + Length / Radius));
  };
  const Paint = (Brush, Width, Height) => {
    const View = OrbitView({ Yaw: Workspace.Yaw ?? 0.7, Pitch: Workspace.Pitch ?? 0.45, Radius: Radius * (1 + Explode * 0.9), Width, Height, Zoom: Workspace.Zoom ?? 1 });
    const Polygons = [];
    const Biggest = Math.max(...Result.cells.map((Cell) => Cell.size)) || 1;
    Result.cells.forEach((Cell, Index) => {
      const Shift = Settings.Enabled ? Offset(Cell) : [0, 0, 0];
      for (const Face of Cell.faces) {
        if (Face.pts.length < 3) continue;
        const Points = Face.pts.map((Point) => [Point[0] + Shift[0], Point[1] + Shift[1], Point[2] + Shift[2]]);
        Polygons.push({
          Points,
          Normal: Normal(Face.pts[0], Face.pts[1], Face.pts[2]),
          Cell: Index,
          Face,
          Shift,
          Paint: (B, Screen, Lit) => {
            B.beginPath();
            Screen.forEach(([X, Y], Slot) => (Slot ? B.lineTo(X, Y) : B.moveTo(X, Y)));
            B.closePath();
            const Inner = Face.kind === "inner";
            const Size = Cell.size / Biggest;
            const Light = Math.round((Inner ? 70 : 40 + Cell.shade * 14 + Size * 10) * Lit);
            B.fillStyle = Inner ? `hsl(28 30% ${Light}%)` : Tone;
            B.fill();
            if (!Inner) {
              B.fillStyle = `rgba(0,0,0,${(1 - Lit) * 0.7 + (1 - Size) * 0.12})`;
              B.fill();
            }
            B.strokeStyle = Inner ? "#00000055" : "#00000080";
            B.lineWidth = 0.7;
            B.stroke();
          },
        });
      }
    });
    Last.current.Drawn = PaintPolygons(Brush, View, Polygons);
    Last.current.View = View;
    // Impact marker.
    if (Settings.Enabled) {
      const [X, Y] = View.Project(Result.impact);
      Brush.strokeStyle = "#ffb15a";
      Brush.lineWidth = 1.5;
      for (const Ring of [5, 10, 16]) {
        Brush.globalAlpha = 1 - Ring / 20;
        Brush.beginPath();
        Brush.arc(X, Y, Ring, 0, Math.PI * 2);
        Brush.stroke();
      }
      Brush.globalAlpha = 1;
    }
  };
  // Click: front-most face under the pointer, then the ray/plane hit in the object's unexploded space.
  const Pick = (Event) => {
    if (!Settings.Enabled) return;
    const Rect = Event.currentTarget.getBoundingClientRect(), Sx = Event.clientX - Rect.left, Sy = Event.clientY - Rect.top;
    const { Drawn, View } = Last.current;
    for (let Index = Drawn.length - 1; Index >= 0; Index--) {
      const { Screen, Polygon } = Drawn[Index];
      let Inside = false;
      for (let A = 0, B = Screen.length - 1; A < Screen.length; B = A++)
        if ((Screen[A][1] > Sy) !== (Screen[B][1] > Sy) && Sx < ((Screen[B][0] - Screen[A][0]) * (Sy - Screen[A][1])) / (Screen[B][1] - Screen[A][1]) + Screen[A][0]) Inside = !Inside;
      if (!Inside) continue;
      const Ray = View.Unproject(Sx, Sy), N = Polygon.Normal, P0 = Polygon.Points[0];
      const Denominator = N[0] * Ray.Direction[0] + N[1] * Ray.Direction[1] + N[2] * Ray.Direction[2];
      if (Math.abs(Denominator) < 1e-9) return;
      const T = (N[0] * (P0[0] - Ray.Origin[0]) + N[1] * (P0[1] - Ray.Origin[1]) + N[2] * (P0[2] - Ray.Origin[2])) / Denominator;
      const Hit = [0, 1, 2].map((Axis) => Ray.Origin[Axis] + Ray.Direction[Axis] * T - Polygon.Shift[Axis]);
      Change("Fracture", { ...Settings, X: +Hit[0].toFixed(3), Y: +Hit[1].toFixed(3), Z: +Hit[2].toFixed(3), EditedAt: Date.now() });
      return;
    }
  };
  return (
    <div className="ws-view ws-view-fracture">
      <div className="ws-pane">
        <span className="ws-pane-label">
          {Settings.Enabled ? `${Result.cells.length} pieces · ${MATERIAL[Settings.Material].name} · click the object to move the impact` : "Fracture is off · enable it in the inspector"}
        </span>
        <Surface Paint={Paint} Label={`${Subject.Name} fracture preview`} Handlers={{ ...Orbit, onPointerUp: (Event) => Orbit.End(Event, Pick) }} />
      </div>
    </div>
  );
}

function FracturePanelBody({ Subject, Values, Change, Workspace, SetWorkspace, Kit }) {
  const { Card, Control, Metric } = Kit;
  const { Owner, Settings, Result } = useShatter(Subject, Values);
  const Assign = (Patch) => Change("Fracture", { ...Settings, ...Patch, EditedAt: Date.now() });
  const Stats = PieceStats(Result.cells), Bars = Histogram(Result.cells, 14), Peak = Math.max(1, ...Bars.bins);
  const State = BakeState(Owner, Settings);
  const Material = MATERIAL[Settings.Material];
  return (
    <>
      <Card Title="Shatter" Class="ws-card">
        <Metric Value={Settings.Enabled ? String(Stats.count) : "Off"} Unit={Settings.Enabled ? "pieces" : ""} Caption={Settings.Enabled ? `${Material.note} Limited by ${Result.budget.limiter}.` : "Turn fracture on to shatter this object."} />
        {Settings.Enabled && (
          <figure className="ws-histogram" aria-label="Piece size distribution">
            <div className="ws-bars">
              {Bars.bins.map((Count, Index) => (
                <i key={Index} style={{ height: `${(Count / Peak) * 100}%` }} title={`${Count} pieces`} />
              ))}
            </div>
            <figcaption>
              <span>{FormatLength(Bars.lo)}</span>
              <span>piece size · median {FormatLength(Stats.median)}</span>
              <span>{FormatLength(Bars.hi)}</span>
            </figcaption>
          </figure>
        )}
        <Control Field={{ Label: "Enable fracture", Control: "Switch" }} Value={Settings.Enabled} Change={(Next) => Assign({ Enabled: Next })} />
        <Control Field={{ Label: "Explode view", Minimum: 0, Maximum: 1, Decimals: 2, Unit: "", Default: 0.25 }} Value={Workspace.Explode ?? 0.25} Change={(Next) => SetWorkspace((Previous) => ({ ...Previous, Explode: Next }))} />
      </Card>
      <Card Title="Recipe" Class="ws-card">
        <div className="ws-materials" role="group" aria-label="Fracture material">
          {MATERIALS.map((Each) => (
            <button key={Each.id} type="button" aria-pressed={Settings.Material === Each.id} onClick={() => Assign({ Material: Each.id })} disabled={!Settings.Enabled}>
              <i style={{ background: Each.tone }} />
              {Each.name}
            </button>
          ))}
        </div>
        <Control
          Field={{ Label: "Impact energy", Minimum: LIMITS.Energy[0], Maximum: LIMITS.Energy[1], Decimals: 0, Unit: "J", Default: 2500, Curve: 3 }}
          Value={Settings.Energy}
          Disabled={!Settings.Enabled}
          Change={(Next) => Assign({ Energy: Math.round(Next) })}
        />
        <div className="ws-actions">
          {ENERGY_PRESETS.map((Preset) => (
            <button key={Preset.id} type="button" disabled={!Settings.Enabled} aria-pressed={Settings.Energy === Preset.joules} onClick={() => Assign({ Energy: Preset.joules })}>
              {Preset.label}
            </button>
          ))}
        </div>
        <Control Field={{ Label: "Piece ceiling", Minimum: LIMITS.Ceiling[0], Maximum: LIMITS.Ceiling[1], Decimals: 0, Unit: "", Default: 48 }} Value={Settings.Ceiling} Disabled={!Settings.Enabled} Change={(Next) => Assign({ Ceiling: Math.round(Next) })} />
        <Control Field={{ Label: "Minimum size", Minimum: LIMITS.MinimumSize[0], Maximum: LIMITS.MinimumSize[1], Decimals: 3, Unit: "m", Default: 0.045 }} Value={Settings.MinimumSize} Disabled={!Settings.Enabled} Change={(Next) => Assign({ MinimumSize: Next })} />
        <Control Field={{ Label: "Seed", Minimum: 1, Maximum: 9999, Decimals: 0, Unit: "", Default: 42 }} Value={Math.min(9999, Settings.Seed)} Disabled={!Settings.Enabled} Change={(Next) => Assign({ Seed: Math.round(Next) })} />
        <div className="ws-readouts">
          <Control Field={{ Label: "Impact point", Control: "Readout" }} Value={`${Settings.X.toFixed(2)}, ${Settings.Y.toFixed(2)}, ${Settings.Z.toFixed(2)} m`} />
          <Control Field={{ Label: "Largest / smallest", Control: "Readout" }} Value={Settings.Enabled ? `${FormatLength(Stats.largest)} / ${FormatLength(Stats.smallest)}` : "–"} />
        </div>
        <div className="ws-actions">
          <button type="button" disabled={!Settings.Enabled} onClick={() => Assign({ X: 0, Y: 0, Z: 0 })}>Centre impact</button>
          <button type="button" disabled={!Settings.Enabled} onClick={() => Assign({ Seed: 1 + Math.floor(Math.random() * 9998) })}>New seed</button>
        </div>
      </Card>
      <Card Title="Bake" Class="ws-card">
        <div className="ws-actions" role="group" aria-label="Fracture execution">
          {[["dynamic", "Dynamic"], ["baked", "Baked"]].map(([Mode, Label]) => (
            <button key={Mode} type="button" disabled={!Settings.Enabled} aria-pressed={Settings.Mode === Mode} onClick={() => Assign({ Mode })}>
              {Label}
            </button>
          ))}
        </div>
        <p className="ws-note">{STATE_TEXT[State]}</p>
        {Settings.Mode === "baked" && Settings.Enabled && (
          <div className="ws-actions">
            <button type="button" onClick={() => Change("Fracture", { ...Settings, Baked: { Signature: RecipeSignature(Owner, Settings), Pieces: Stats.count, At: Date.now() } })}>
              {State === "ready" ? "Bake again" : "Bake pieces"}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SHARED FRAME
//------------------------------------------------------------------------------------------------------------------------

// The viewport while a workspace is open: the selection alone, with the workspace's own view.
export function WorkspaceView(Props) {
  const { Subject, Workspace, SetWorkspace } = Props;
  const Tool = WorkspaceTools.find((Each) => Each.Tool === Workspace.Tool);
  return (
    <div className="ws-viewport" role="region" aria-label={`${Tool?.Name} workspace viewport`}>
      <div className="ws-banner">
        <span className="ws-banner-mode">EDIT</span>
        <span>
          <b>{Subject.Name}</b> isolated · {Tool?.Name} workspace
        </span>
        <button type="button" onClick={() => SetWorkspace(null)} aria-label="Leave workspace">
          Leave <kbd>Esc</kbd>
        </button>
      </div>
      {Workspace.Tool === "uv" ? <UvView {...Props} /> : <FractureView {...Props} />}
    </div>
  );
}

// Inspector: workspace switcher plus the workspace's own cards.
export function WorkspacePanel(Props) {
  const { Subject, Workspace, SetWorkspace } = Props;
  return (
    <div className="ws-panel">
      <section className="ws-switcher" aria-label="Workspaces">
        <header>
          <span>Workspace · {Subject.Name}</span>
          <button type="button" onClick={() => SetWorkspace(null)}>Done</button>
        </header>
        <div className="ws-tabs" role="tablist">
          {WorkspaceTools.map((Each) => (
            <button key={Each.Tool} type="button" role="tab" aria-selected={Workspace.Tool === Each.Tool} onClick={() => SetWorkspace((Previous) => ({ ...Previous, Tool: Each.Tool, Selection: [] }))}>
              <WorkspaceGlyph Tool={Each.Tool} />
              {Each.Name}
            </button>
          ))}
        </div>
      </section>
      {Workspace.Tool === "uv" ? <UvPanel {...Props} /> : <FracturePanelBody {...Props} />}
    </div>
  );
}

// Entry point shown on primitives outside a workspace.
export function WorkspaceLauncher({ Open }) {
  return (
    <section className="ws-launcher" aria-label="Edit workspaces">
      <header>
        <span>Edit in place</span>
        <small>isolates the selection in the viewport</small>
      </header>
      <div className="ws-tabs">
        {WorkspaceTools.map((Each) => (
          <button key={Each.Tool} type="button" onClick={() => Open(Each.Tool)} title={Each.Caption}>
            <WorkspaceGlyph Tool={Each.Tool} />
            {Each.Name}
          </button>
        ))}
      </div>
    </section>
  );
}

function WorkspaceGlyph({ Tool }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {Tool === "uv" ? (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <path d="M4 12h16M12 4v16" opacity="0.55" />
          <rect x="6.5" y="6.5" width="4" height="4" rx="1.2" fill="currentColor" stroke="none" />
        </>
      ) : (
        <>
          <path d="M5.5 6.5 12 3.5l6.5 3v8.5L12 20.5 5.5 15z" />
          <path d="M12 3.5 10.5 10l4 2.5-2.5 8M10.5 10 5.5 12" opacity="0.7" />
        </>
      )}
    </svg>
  );
}
